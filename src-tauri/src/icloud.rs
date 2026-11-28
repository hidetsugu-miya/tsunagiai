//! iCloud mail accounts (M-13): adding one (the address and an App-specific password, tried with an IMAP LOGIN before anything is kept), the state of each, and removing one.
//! iCloud has no mail API and no OAuth for other apps, so the account is IMAP at `imap.mail.me.com:993` (TLS) with the App-specific password.
//! The password is in the keychain (service `jp.mysis.tsunagiai.icloud`, the address as the user), never in `accounts.json`, a log or an error text; the row in `accounts.json` has the kind `icloud`.
//! Reading the mail of an account is `read.rs` (the inbox as threads and one thread, with `message.rs` turning a mail into what the screen draws and `threading.rs` joining mails into threads);
//! what else an iCloud account does with its mail comes with the later parts of M-13.

use std::{fmt, path::Path, sync::Arc, time::Duration};

mod message;
mod modify;
mod read;
mod sync;
mod threading;

pub use modify::{Change, Move};
use rustls::{pki_types::ServerName, ClientConfig};
use rustls_platform_verifier::BuilderVerifierExt;
use serde::Serialize;
use tauri::{AppHandle, State};
use tokio::{
    io::{AsyncRead, AsyncWrite},
    net::TcpStream,
};
use tokio_rustls::{client::TlsStream, TlsConnector};

use crate::{
    accounts::{self, Account, AccountKind},
    auth::config_dir,
    disk_cache,
    gmail::{log_failure, ApiError, Sync, SyncState, ThreadDetail, ThreadItem},
    keychain,
};

const HOST: &str = "imap.mail.me.com";
const PORT: u16 = 993;
const KEYRING_SERVICE: &str = "jp.mysis.tsunagiai.icloud";
/// The connection, the TLS handshake and the login together.
const LOGIN_TIMEOUT: Duration = Duration::from_secs(20);
/// What one read of the mail may take after the login: the list reads up to 50 mails.
const READ_TIMEOUT: Duration = Duration::from_secs(60);
/// What the list says of an account whose kept password iCloud refuses: the Google card knows only Google accounts, so the words name the iCloud tab.
pub const PASSWORD_REFUSED: &str =
    "App 用パスワードが無効です。設定の iCloud タブで入れ直してください";

/// An iCloud account of the settings' iCloud card.
#[derive(Serialize, Debug, PartialEq, Eq)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
pub struct IcloudAccount {
    pub address: String,
}

/// What iCloud says about a kept password: it logs in, it is refused (so it must be entered again), or iCloud could not be asked.
#[derive(Serialize, Debug, PartialEq, Eq)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(tag = "state", rename_all = "camelCase")]
#[cfg_attr(test, ts(export, export_to = crate::BINDINGS))]
pub enum IcloudCheck {
    Ok,
    NeedsLogin,
    Error { message: String },
}

/// Why a login did not succeed. A refusal is the server's NO; anything else (no network, a broken TLS, a timeout) says nothing about the password.
#[derive(Debug, PartialEq, Eq)]
enum LoginError {
    Rejected,
    Failed(String),
}

fn failed(what: &str, e: impl fmt::Display) -> LoginError {
    LoginError::Failed(format!("iCloud {what}: {e}"))
}

/// Logs in over an open stream. The password is only in the LOGIN command.
async fn login_session<S>(
    stream: S,
    user: &str,
    password: &str,
) -> Result<async_imap::Session<S>, LoginError>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + fmt::Debug,
{
    let mut client = async_imap::Client::new(stream);
    match client.read_response().await {
        Ok(Some(_)) => {}
        Ok(None) => return Err(failed("との通信に失敗しました", "接続が閉じられました")),
        Err(e) => return Err(failed("に接続できません", e)),
    }
    match client.login(user, password).await {
        Ok(session) => Ok(session),
        Err((async_imap::error::Error::No(_), _)) => Err(LoginError::Rejected),
        Err((e, _)) => Err(failed("との通信に失敗しました", e)),
    }
}

/// Logs in over an open stream and logs out: the tests' way to try a login on a stream of their own.
#[cfg(test)]
async fn login_over<S>(stream: S, user: &str, password: &str) -> Result<(), LoginError>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + fmt::Debug,
{
    let mut session = login_session(stream, user, password).await?;
    let _ = session.logout().await;
    Ok(())
}

/// The TLS client of the app (rustls with `aws_lc_rs`), trusting what the OS trusts, as `reqwest` does.
fn tls_config() -> Result<ClientConfig, rustls::Error> {
    let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
    Ok(ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()?
        .with_platform_verifier()?
        .with_no_client_auth())
}

async fn tls_stream() -> Result<TlsStream<TcpStream>, LoginError> {
    let config = tls_config().map_err(|e| failed("への接続を準備できません", e))?;
    let tcp = TcpStream::connect((HOST, PORT))
        .await
        .map_err(|e| failed("に接続できません", e))?;
    let name = ServerName::try_from(HOST).map_err(|e| failed("に接続できません", e))?;
    TlsConnector::from(Arc::new(config))
        .connect(name, tcp)
        .await
        .map_err(|e| failed("に接続できません", e))
}

async fn open_tls(
    user: &str,
    password: &str,
) -> Result<async_imap::Session<TlsStream<TcpStream>>, LoginError> {
    login_session(tls_stream().await?, user, password).await
}

async fn login_tls(user: &str, password: &str) -> Result<(), LoginError> {
    let mut session = open_tls(user, password).await?;
    let _ = session.logout().await;
    Ok(())
}

async fn login(address: &str, password: &str) -> Result<(), LoginError> {
    tokio::time::timeout(LOGIN_TIMEOUT, login_tls(address, password))
        .await
        .unwrap_or_else(|_| {
            Err(LoginError::Failed(
                "iCloud への接続がタイムアウトしました".into(),
            ))
        })
}

/// A logged-in session with the kept password. `Ok(None)` means that password is not kept or iCloud refuses it: it must be entered again in the iCloud tab.
async fn open(address: &str) -> Result<Option<async_imap::Session<TlsStream<TcpStream>>>, String> {
    let owned = address.to_owned();
    let Some(password) = blocking(move || keychain::read(KEYRING_SERVICE, &owned)).await? else {
        return Ok(None);
    };
    match tokio::time::timeout(LOGIN_TIMEOUT, open_tls(address, &password)).await {
        Ok(Ok(session)) => Ok(Some(session)),
        Ok(Err(LoginError::Rejected)) => Ok(None),
        Ok(Err(LoginError::Failed(message))) => Err(message),
        Err(_) => Err("iCloud への接続がタイムアウトしました".into()),
    }
}

/// Logs out of a session that has been read; what the server says to that no longer matters.
async fn close(mut session: async_imap::Session<TlsStream<TcpStream>>) {
    let _ = tokio::time::timeout(Duration::from_secs(5), session.logout()).await;
}

fn read_timeout() -> ApiError {
    "iCloud からの読み込みがタイムアウトしました".into()
}

/// The threads of the newest mails of the inbox of `address` (as many as Gmail's list holds), newest first, and the position the sync of the account starts from (empty when iCloud did not tell it).
/// The position is asked before the mails are read, so that what changes meanwhile is read again by the sync.
/// `Ok(None)` means the password must be entered again.
pub async fn inbox_threads(address: &str) -> Result<Option<(Vec<ThreadItem>, String)>, ApiError> {
    let Some(mut session) = open(address).await? else {
        return Ok(None);
    };
    let read = tokio::time::timeout(READ_TIMEOUT, async {
        let position = sync::position(&mut session).await;
        let threads = read::inbox_threads(&mut session, address).await?;
        Ok::<_, String>((
            threads,
            position.map_or_else(String::new, sync::Position::text),
        ))
    })
    .await;
    close(session).await;
    Ok(Some(read.map_err(|_| read_timeout())??))
}

/// One round of the sync of `address` from `start`, the position that the last load or sync gave (see `sync.rs`).
/// A password that iCloud refuses is `Sync::NeedsLogin`. A server that cannot be reached is a `throttled` failure, so that `SyncState` leaves the account alone for a while as it does after a rate limit.
pub async fn sync(address: &str, start: &str) -> Result<Sync, ApiError> {
    let mut session = match open(address).await {
        Ok(Some(session)) => session,
        Ok(None) => return Ok(Sync::NeedsLogin),
        Err(message) => return Err(ApiError::throttled(message)),
    };
    let read = tokio::time::timeout(READ_TIMEOUT, sync::sync(&mut session, address, start)).await;
    close(session).await;
    match read {
        Ok(synced) => Ok(synced?),
        Err(_) => Err(ApiError::throttled(read_timeout().to_string())),
    }
}

/// The thread `id` of `address` (an ID that `inbox_threads` gave) as the screen draws it. `Ok(None)` means the password must be entered again.
pub async fn fetch_thread(
    address: &str,
    id: &str,
    prefer_plain: bool,
) -> Result<Option<ThreadDetail>, ApiError> {
    let key = threading::key_of(id).ok_or("スレッド ID が不正です")?;
    let Some(mut session) = open(address).await? else {
        return Ok(None);
    };
    let read = tokio::time::timeout(READ_TIMEOUT, read::thread_mails(&mut session, &key)).await;
    close(session).await;
    let mails = read.map_err(|_| read_timeout())??;
    read::thread(id, address, &mails, prefer_plain)
        .map(Some)
        .ok_or_else(|| "スレッドが見つかりません".into())
}

/// Does `change` (read or unread, archive, delete, or taking one of the last two back) to the thread `id` of `address`, with the mails that the thread has in the folder it is in.
/// `Ok(None)` means the password must be entered again; `Ok(Some(true))` means it was done.
pub async fn change(address: &str, id: &str, change: Change) -> Result<Option<bool>, ApiError> {
    let key = threading::key_of(id).ok_or("スレッド ID が不正です")?;
    let Some(mut session) = open(address).await? else {
        return Ok(None);
    };
    let done = tokio::time::timeout(READ_TIMEOUT, modify::apply(&mut session, &key, change)).await;
    close(session).await;
    done.map_err(|_| ApiError::from("iCloud のメールの変更がタイムアウトしました"))??;
    // `true`, not `()`: `Some(())` reaches JS as null, the same as `None` (login required).
    Ok(Some(true))
}

/// The address as it is kept: trimmed and in lower case (an address has one entry however it is typed), with one `@` between a name and a domain.
fn normalize_address(input: &str) -> Result<String, String> {
    let address = input.trim().to_lowercase();
    let valid = address.split_once('@').is_some_and(|(name, domain)| {
        !name.is_empty() && !domain.is_empty() && !domain.contains('@')
    }) && !address.chars().any(|c| c.is_whitespace() || c.is_control());
    if valid {
        Ok(address)
    } else {
        Err("メールアドレスの形式が正しくありません".into())
    }
}

fn normalize_password(input: &str) -> Result<String, String> {
    let password = input.trim();
    if password.is_empty() {
        return Err("App 用パスワードを入力してください".into());
    }
    if password.chars().any(char::is_control) {
        return Err("App 用パスワードに使えない文字があります".into());
    }
    Ok(password.to_owned())
}

/// Whether `address` may be added as an iCloud account: an address of a Google account is refused, as the two kinds share one list.
fn check_addable(list: &[Account], address: &str) -> Result<(), String> {
    match list.iter().find(|a| a.address == address) {
        Some(a) if a.kind == AccountKind::Gmail => Err(format!(
            "{address} は Google のアカウントとして登録されています"
        )),
        _ => Ok(()),
    }
}

fn icloud_list(list: &[Account]) -> Vec<IcloudAccount> {
    list.iter()
        .filter(|a| a.kind == AccountKind::Icloud)
        .map(|a| IcloudAccount {
            address: a.address.clone(),
        })
        .collect()
}

fn ensure_listed(list: &[Account], address: &str) -> Result<(), String> {
    if list
        .iter()
        .any(|a| a.address == address && a.kind == AccountKind::Icloud)
    {
        Ok(())
    } else {
        Err("登録されていないアカウントです".into())
    }
}

fn read_accounts(dir: &Path) -> Result<Vec<Account>, String> {
    Ok(accounts::load_accounts(dir)?.unwrap_or_default())
}

/// Lists `address` as an iCloud account (it stays one entry when it is listed already), under the lock that the other writers of the list take.
fn register(dir: &Path, address: &str) -> Result<Vec<IcloudAccount>, String> {
    disk_cache::exclusive(|| {
        let list = read_accounts(dir)?;
        check_addable(&list, address)?;
        let list = accounts::with_account(list, Account::icloud(address));
        accounts::save_accounts(dir, &list)?;
        Ok(icloud_list(&list))
    })
}

fn unregister(dir: &Path, address: &str) -> Result<Vec<IcloudAccount>, String> {
    disk_cache::exclusive(|| {
        let list = read_accounts(dir)?;
        ensure_listed(&list, address)?;
        let list = accounts::without_account(list, address);
        accounts::save_accounts(dir, &list)?;
        Ok(icloud_list(&list))
    })
}

/// Keychain calls may wait for the OS to ask for permission, so they run off the async workers.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

fn fail(command: &str, address: &str, message: impl Into<String>) -> String {
    log_failure(command, address, message.into())
}

/// The iCloud accounts, in the order of the list.
#[tauri::command]
pub async fn icloud_accounts(app: AppHandle) -> Result<Vec<IcloudAccount>, String> {
    let dir = config_dir(&app)?;
    read_accounts(&dir)
        .map(|list| icloud_list(&list))
        .map_err(|e| fail("icloud_accounts", "-", e))
}

/// Logs in with the kept password. iCloud is asked once here, and nothing is written.
#[tauri::command]
pub async fn icloud_check(app: AppHandle, address: String) -> Result<IcloudCheck, String> {
    let dir = config_dir(&app)?;
    ensure_listed(&read_accounts(&dir)?, &address)
        .map_err(|e| fail("icloud_check", &address, e))?;
    let owned = address.clone();
    let password = match blocking(move || keychain::read(KEYRING_SERVICE, &owned)).await {
        Ok(Some(password)) => password,
        Ok(None) => return Ok(IcloudCheck::NeedsLogin),
        Err(e) => {
            return Ok(IcloudCheck::Error {
                message: fail("icloud_check", &address, e),
            })
        }
    };
    Ok(match login(&address, &password).await {
        Ok(()) => IcloudCheck::Ok,
        Err(LoginError::Rejected) => IcloudCheck::NeedsLogin,
        Err(LoginError::Failed(message)) => IcloudCheck::Error {
            message: fail("icloud_check", &address, message),
        },
    })
}

/// Adds the account, or enters the password of a listed one again: the password is kept only after iCloud accepted it.
#[tauri::command]
pub async fn icloud_add_account(
    app: AppHandle,
    address: String,
    password: String,
) -> Result<Vec<IcloudAccount>, String> {
    let dir = config_dir(&app)?;
    let address = normalize_address(&address)?;
    let password = normalize_password(&password)?;
    check_addable(&read_accounts(&dir)?, &address)
        .map_err(|e| fail("icloud_add_account", &address, e))?;
    match login(&address, &password).await {
        Ok(()) => {}
        Err(LoginError::Rejected) => {
            return Err(fail(
                "icloud_add_account",
                &address,
                "メールアドレスか App 用パスワードが違います",
            ));
        }
        Err(LoginError::Failed(message)) => {
            return Err(fail("icloud_add_account", &address, message))
        }
    }
    let owned = address.clone();
    blocking(move || keychain::write(KEYRING_SERVICE, &owned, &password))
        .await
        .map_err(|e| fail("icloud_add_account", &address, e))?;
    register(&dir, &address).map_err(|e| fail("icloud_add_account", &address, e))
}

/// Deletes the password and the row; nothing of the mail on iCloud is touched.
#[tauri::command]
pub async fn icloud_remove_account(
    app: AppHandle,
    sync: State<'_, SyncState>,
    address: String,
) -> Result<Vec<IcloudAccount>, String> {
    let dir = config_dir(&app)?;
    sync.forget(&address);
    ensure_listed(&read_accounts(&dir)?, &address)
        .map_err(|e| fail("icloud_remove_account", &address, e))?;
    let owned = address.clone();
    blocking(move || keychain::delete(KEYRING_SERVICE, &owned))
        .await
        .map_err(|e| fail("icloud_remove_account", &address, e))?;
    unregister(&dir, &address).map_err(|e| fail("icloud_remove_account", &address, e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{
        io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
        net::TcpListener,
    };

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "tsunagiai-test-{}-icloud-{name}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    /// A server of one connection: it greets, answers the LOGIN with `login_reply` (or hangs up when that is empty), and answers the LOGOUT.
    /// What it received is the value of the join handle.
    async fn serve(login_reply: &'static str) -> (TcpStream, tokio::task::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let (read, mut write) = stream.into_split();
            write.write_all(b"* OK IMAP ready\r\n").await.unwrap();
            let mut lines = BufReader::new(read).lines();
            let mut seen = Vec::new();
            while let Some(line) = lines.next_line().await.unwrap() {
                let tag = line.split(' ').next().unwrap().to_owned();
                let command = line.split(' ').nth(1).unwrap_or("").to_owned();
                seen.push(line);
                match command.as_str() {
                    "LOGIN" if login_reply.is_empty() => break,
                    "LOGIN" => write
                        .write_all(format!("{tag} {login_reply}\r\n").as_bytes())
                        .await
                        .unwrap(),
                    "LOGOUT" => {
                        write
                            .write_all(
                                format!("* BYE bye\r\n{tag} OK LOGOUT completed\r\n").as_bytes(),
                            )
                            .await
                            .unwrap();
                        break;
                    }
                    _ => {}
                }
            }
            seen
        });
        (TcpStream::connect(addr).await.unwrap(), server)
    }

    #[tokio::test]
    async fn a_login_the_server_accepts_sends_the_credentials_and_logs_out() {
        let (stream, server) = serve("OK Logged in").await;
        assert_eq!(
            login_over(stream, "me@icloud.com", "abcd-efgh").await,
            Ok(())
        );
        let seen = server.await.unwrap();
        assert_eq!(
            seen[0].split_once(' ').unwrap().1,
            r#"LOGIN "me@icloud.com" "abcd-efgh""#
        );
        assert!(seen[1].contains("LOGOUT"), "{seen:?}");
    }

    #[tokio::test]
    async fn a_password_with_a_quote_or_a_backslash_is_sent_escaped() {
        let (stream, server) = serve("OK Logged in").await;
        login_over(stream, "me@icloud.com", r#"a"b\c"#)
            .await
            .unwrap();
        let seen = server.await.unwrap();
        assert_eq!(
            seen[0].split_once(' ').unwrap().1,
            r#"LOGIN "me@icloud.com" "a\"b\\c""#
        );
    }

    #[tokio::test]
    async fn a_no_from_the_server_is_a_refusal_of_the_password() {
        let (stream, server) = serve("NO [AUTHENTICATIONFAILED] Invalid credentials").await;
        assert_eq!(
            login_over(stream, "me@icloud.com", "wrong").await,
            Err(LoginError::Rejected)
        );
        server.abort();
    }

    #[tokio::test]
    async fn a_bad_or_a_hang_up_says_nothing_about_the_password() {
        let (stream, server) = serve("BAD command unknown").await;
        let err = login_over(stream, "me@icloud.com", "x").await.unwrap_err();
        assert!(
            matches!(&err, LoginError::Failed(m) if m.starts_with("iCloud")),
            "{err:?}"
        );
        server.abort();
        let (stream, server) = serve("").await;
        let err = login_over(stream, "me@icloud.com", "x").await.unwrap_err();
        assert!(
            matches!(&err, LoginError::Failed(m) if m.starts_with("iCloud")),
            "{err:?}"
        );
        server.abort();
    }

    #[tokio::test]
    async fn a_server_that_sends_no_greeting_is_a_failure() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            drop(stream);
        });
        let stream = TcpStream::connect(addr).await.unwrap();
        let err = login_over(stream, "me@icloud.com", "x").await.unwrap_err();
        assert!(matches!(err, LoginError::Failed(_)), "{err:?}");
        server.await.unwrap();
    }

    #[test]
    fn the_address_is_trimmed_lowercased_and_checked() {
        assert_eq!(
            normalize_address("  Me@iCloud.com \n"),
            Ok("me@icloud.com".to_owned())
        );
        for bad in [
            "",
            "me",
            "@icloud.com",
            "me@",
            "a@b@c",
            "me @icloud.com",
            "me@icloud.com\r\nX",
        ] {
            assert!(normalize_address(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn the_password_is_trimmed_and_refused_when_empty_or_holding_a_control_character() {
        assert_eq!(
            normalize_password(" abcd-efgh-ijkl-mnop\n"),
            Ok("abcd-efgh-ijkl-mnop".to_owned())
        );
        assert!(normalize_password("   ").is_err());
        assert!(normalize_password("ab\ncd").is_err());
        assert!(normalize_password("ab\0cd").is_err());
    }

    #[test]
    fn an_added_account_is_listed_as_icloud_once_and_the_google_accounts_stay_out_of_the_list() {
        let dir = temp_dir("register");
        accounts::save_accounts(&dir, &[Account::gmail("g@example.com")]).unwrap();
        let list = register(&dir, "me@icloud.com").unwrap();
        assert_eq!(
            list,
            vec![IcloudAccount {
                address: "me@icloud.com".into()
            }]
        );
        // The same address again (the password entered again) is still one entry.
        assert_eq!(register(&dir, "me@icloud.com").unwrap(), list);
        let all = accounts::load_accounts(&dir).unwrap().unwrap();
        assert_eq!(
            all,
            vec![
                Account::gmail("g@example.com"),
                Account::icloud("me@icloud.com")
            ]
        );
        // The Google side sees only its own account.
        assert_eq!(
            accounts::load(&dir),
            Ok(Some(vec!["g@example.com".to_owned()]))
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn an_address_of_a_google_account_is_not_added_as_icloud() {
        let dir = temp_dir("gmail-address");
        accounts::save_accounts(&dir, &[Account::gmail("g@example.com")]).unwrap();
        let err = register(&dir, "g@example.com").unwrap_err();
        assert!(err.contains("Google"), "{err}");
        assert_eq!(
            accounts::load_accounts(&dir).unwrap().unwrap(),
            vec![Account::gmail("g@example.com")]
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_removal_drops_only_that_icloud_account_and_refuses_one_that_is_not_listed_or_is_google() {
        let dir = temp_dir("unregister");
        accounts::save_accounts(
            &dir,
            &[
                Account::gmail("g@example.com"),
                Account::icloud("a@icloud.com"),
                Account::icloud("b@icloud.com"),
            ],
        )
        .unwrap();
        let left = unregister(&dir, "a@icloud.com").unwrap();
        assert_eq!(
            left,
            vec![IcloudAccount {
                address: "b@icloud.com".into()
            }]
        );
        assert_eq!(
            accounts::load_accounts(&dir).unwrap().unwrap(),
            vec![
                Account::gmail("g@example.com"),
                Account::icloud("b@icloud.com")
            ]
        );
        assert!(unregister(&dir, "a@icloud.com").is_err());
        assert!(unregister(&dir, "g@example.com").is_err());
        assert_eq!(
            accounts::load(&dir),
            Ok(Some(vec!["g@example.com".to_owned()]))
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn an_account_without_a_file_is_added_and_removed() {
        let dir = temp_dir("no-file");
        assert_eq!(register(&dir, "me@icloud.com").unwrap().len(), 1);
        assert_eq!(unregister(&dir, "me@icloud.com").unwrap(), vec![]);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
