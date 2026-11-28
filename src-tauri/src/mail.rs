//! The entry of the mail operations: the kind of the account (`accounts.json`) picks the backend that runs them (M-13).
//! The commands of `gmail.rs` and `mail_send.rs` and the tools of `tsunagiai-mcp` come in here, and nothing else reaches `gmail` for an account.

use std::path::Path;

use crate::{
    accounts::{self, AccountKind},
    auth::Auth,
    gmail::{self, ApiError, InlineCache, ThreadDetail},
    mail_send::{self, OutgoingMail},
};

/// What runs the mail operations of an account. A kind with no backend yet has no variant: `backend` refuses it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Backend {
    Gmail,
}

pub fn backend(kind: AccountKind) -> Result<Backend, String> {
    match kind {
        AccountKind::Gmail => Ok(Backend::Gmail),
        AccountKind::Icloud => Err("iCloud のメールにはまだ対応していません".into()),
    }
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
    fn gmail_has_a_backend_and_icloud_is_refused_in_japanese() {
        assert_eq!(backend(AccountKind::Gmail), Ok(Backend::Gmail));
        let err = backend(AccountKind::Icloud).unwrap_err();
        assert!(
            err.contains("iCloud") && err.contains("対応していません"),
            "{err}"
        );
    }

    #[test]
    fn the_backend_follows_the_kind_in_accounts_json() {
        let dir = temp_dir("backend");
        // No file, and an address that is not listed: Gmail, so its own login check answers.
        assert_eq!(backend_of(&dir, "a@example.com"), Ok(Backend::Gmail));
        with_icloud(&dir);
        assert_eq!(backend_of(&dir, "a@example.com"), Ok(Backend::Gmail));
        assert_eq!(backend_of(&dir, "x@example.com"), Ok(Backend::Gmail));
        assert!(backend_of(&dir, "b@icloud.com").is_err());
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

    /// Every entry refuses an iCloud account before it builds a request: no token is read and nothing is sent.
    #[test]
    fn every_entry_refuses_an_icloud_account() {
        let dir = temp_dir("entries");
        with_icloud(&dir);
        let auth = Auth::new();
        let cache = InlineCache::default();
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
        let (d, a, who, id) = (dir.as_path(), &auth, "b@icloud.com", "t1");
        let refused = |e: ApiError| e.to_string().contains("iCloud");
        assert!(rt
            .block_on(fetch_thread(d, a, &cache, who, id, true))
            .is_err_and(refused));
        assert!(rt.block_on(trash_thread(d, a, who, id)).is_err_and(refused));
        assert!(rt
            .block_on(untrash_thread(d, a, who, id))
            .is_err_and(refused));
        assert!(rt
            .block_on(archive_thread(d, a, who, id))
            .is_err_and(refused));
        assert!(rt
            .block_on(unarchive_thread(d, a, who, id))
            .is_err_and(refused));
        assert!(rt
            .block_on(set_thread_read(d, a, who, id, true))
            .is_err_and(refused));
        assert!(rt.block_on(send(d, a, who, &mail)).is_err_and(refused));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
