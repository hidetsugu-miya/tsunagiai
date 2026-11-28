//! The entry of the mail operations: the kind of the account (`accounts.json`) picks the backend that runs them (M-13).
//! The commands of `gmail.rs` and `mail_send.rs` and the tools of `tsunagiai-mcp` come in here, and nothing else reaches `gmail` for an account.

use std::path::Path;

use crate::{
    accounts::{self, AccountKind},
    auth::Auth,
    gmail::{self, ApiError, InlineCache, ThreadDetail},
    icloud,
    mail_send::{self, OutgoingMail},
};

/// What runs the mail operations of an account. A kind with no backend has no variant: `backend` refuses it.
/// An iCloud account reads its mail, changes it (read, archive, delete and their undo) and syncs (M-13); sending comes with a later part, and `send` refuses it until then.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Backend {
    Gmail,
    Icloud,
}

pub fn backend(kind: AccountKind) -> Result<Backend, String> {
    match kind {
        AccountKind::Gmail => Ok(Backend::Gmail),
        AccountKind::Icloud => Ok(Backend::Icloud),
    }
}

/// What an entry says of an operation that an iCloud account cannot do yet.
fn icloud_unsupported(what: &str) -> ApiError {
    format!("iCloud のメールの{what}にはまだ対応していません").into()
}

/// Does the move `how` to the thread `id` of the iCloud account `account`.
async fn icloud_move(account: &str, id: &str, how: icloud::Move) -> Result<Option<bool>, ApiError> {
    icloud::change(account, id, icloud::Change::Move(how)).await
}

/// The backend of `account`, by the kind `accounts.json` gives it.
pub fn backend_of(dir: &Path, account: &str) -> Result<Backend, String> {
    backend(accounts::kind(dir, account)?)
}

/// `Ok(None)` means `account` must log in again, as in `gmail`.
pub async fn fetch_thread(
    dir: &Path,
    auth: &Auth,
    cache: &InlineCache,
    account: &str,
    id: &str,
    prefer_plain: bool,
) -> Result<Option<ThreadDetail>, ApiError> {
    match backend_of(dir, account)? {
        Backend::Gmail => gmail::fetch_thread(dir, auth, cache, account, id, prefer_plain).await,
        Backend::Icloud => icloud::fetch_thread(account, id, prefer_plain).await,
    }
}

pub async fn trash_thread(
    dir: &Path,
    auth: &Auth,
    account: &str,
    id: &str,
) -> Result<Option<bool>, ApiError> {
    match backend_of(dir, account)? {
        Backend::Gmail => gmail::trash_thread(dir, auth, account, id).await,
        Backend::Icloud => icloud_move(account, id, icloud::Move::Trash).await,
    }
}

/// Takes the thread out of the trash and back into the inbox.
pub async fn untrash_thread(
    dir: &Path,
    auth: &Auth,
    account: &str,
    id: &str,
) -> Result<Option<bool>, ApiError> {
    match backend_of(dir, account)? {
        Backend::Gmail => {
            // threads.untrash may not bring INBOX back, so put it on again.
            if gmail::untrash_thread(dir, auth, account, id)
                .await?
                .is_none()
            {
                return Ok(None);
            }
            gmail::unarchive_thread(dir, auth, account, id).await
        }
        Backend::Icloud => icloud_move(account, id, icloud::Move::Untrash).await,
    }
}

pub async fn archive_thread(
    dir: &Path,
    auth: &Auth,
    account: &str,
    id: &str,
) -> Result<Option<bool>, ApiError> {
    match backend_of(dir, account)? {
        Backend::Gmail => gmail::archive_thread(dir, auth, account, id).await,
        Backend::Icloud => icloud_move(account, id, icloud::Move::Archive).await,
    }
}

pub async fn unarchive_thread(
    dir: &Path,
    auth: &Auth,
    account: &str,
    id: &str,
) -> Result<Option<bool>, ApiError> {
    match backend_of(dir, account)? {
        Backend::Gmail => gmail::unarchive_thread(dir, auth, account, id).await,
        Backend::Icloud => icloud_move(account, id, icloud::Move::Unarchive).await,
    }
}

pub async fn set_thread_read(
    dir: &Path,
    auth: &Auth,
    account: &str,
    id: &str,
    read: bool,
) -> Result<Option<bool>, ApiError> {
    match backend_of(dir, account)? {
        Backend::Gmail => gmail::set_thread_read(dir, auth, account, id, read).await,
        Backend::Icloud => icloud::change(account, id, icloud::Change::Read(read)).await,
    }
}

pub async fn send(
    dir: &Path,
    auth: &Auth,
    account: &str,
    mail: &OutgoingMail,
) -> Result<Option<bool>, ApiError> {
    match backend_of(dir, account)? {
        Backend::Gmail => mail_send::send(dir, auth, account, mail).await,
        Backend::Icloud => Err(icloud_unsupported("送信")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::accounts::{save_accounts, Account};

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("tsunagiai-test-{}-mail-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn with_icloud(dir: &Path) {
        let icloud = Account {
            address: "b@icloud.com".into(),
            kind: AccountKind::Icloud,
        };
        save_accounts(dir, &[Account::gmail("a@example.com"), icloud]).unwrap();
    }

    #[test]
    fn each_kind_has_its_backend() {
        assert_eq!(backend(AccountKind::Gmail), Ok(Backend::Gmail));
        assert_eq!(backend(AccountKind::Icloud), Ok(Backend::Icloud));
    }

    #[test]
    fn the_backend_follows_the_kind_in_accounts_json() {
        let dir = temp_dir("backend");
        // No file, and an address that is not listed: Gmail, so its own login check answers.
        assert_eq!(backend_of(&dir, "a@example.com"), Ok(Backend::Gmail));
        with_icloud(&dir);
        assert_eq!(backend_of(&dir, "a@example.com"), Ok(Backend::Gmail));
        assert_eq!(backend_of(&dir, "x@example.com"), Ok(Backend::Gmail));
        assert_eq!(backend_of(&dir, "b@icloud.com"), Ok(Backend::Icloud));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_broken_accounts_json_is_an_error_not_gmail() {
        let dir = temp_dir("broken");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("accounts.json"), "not json").unwrap();
        assert!(backend_of(&dir, "a@example.com")
            .unwrap_err()
            .contains("形式が不正"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// Sending, which an iCloud account cannot do yet, is refused before it builds a request: no token is read and nothing is sent.
    /// (The reads and the changes are not here: they read the keychain and ask iCloud.)
    #[test]
    fn the_operations_an_icloud_account_cannot_do_yet_are_refused() {
        let dir = temp_dir("entries");
        with_icloud(&dir);
        let auth = Auth::new();
        let mail = OutgoingMail {
            to: vec!["a@example.com".into()],
            cc: vec![],
            bcc: vec![],
            subject: "s".into(),
            body: "b".into(),
            markdown: None,
            reply_thread_id: None,
            attachments: None,
        };
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let (d, a, who) = (dir.as_path(), &auth, "b@icloud.com");
        let refused = |e: ApiError| {
            e.to_string().contains("iCloud") && e.to_string().contains("まだ対応していません")
        };
        assert!(rt.block_on(send(d, a, who, &mail)).is_err_and(refused));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
