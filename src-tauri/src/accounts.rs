use std::path::Path;

use serde::{Deserialize, Serialize};

const FILE: &str = "accounts.json";

/// The kind of a mail account. It picks the backend that runs the account's mail operations (`mail::backend`).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AccountKind {
    #[default]
    Gmail,
    Icloud,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Account {
    pub address: String,
    pub kind: AccountKind,
}

impl Account {
    pub fn gmail(address: &str) -> Self {
        Self {
            address: address.to_owned(),
            kind: AccountKind::Gmail,
        }
    }
}

/// One row of `accounts`. A row that is only an address is a Gmail account (the file as it was before kinds existed),
/// and a Gmail account is written that way still, so a file without other kinds is the same as it always was.
#[derive(Serialize, Deserialize)]
#[serde(untagged)]
enum Entry {
    Address(String),
    Kinded {
        address: String,
        #[serde(default)]
        kind: AccountKind,
    },
}

impl From<Entry> for Account {
    fn from(entry: Entry) -> Self {
        match entry {
            Entry::Address(address) => Account::gmail(&address),
            Entry::Kinded { address, kind } => Account { address, kind },
        }
    }
}

impl From<&Account> for Entry {
    fn from(account: &Account) -> Self {
        match account.kind {
            AccountKind::Gmail => Entry::Address(account.address.clone()),
            kind => Entry::Kinded {
                address: account.address.clone(),
                kind,
            },
        }
    }
}

#[derive(Serialize, Deserialize)]
struct AccountsFile {
    accounts: Vec<Entry>,
}

/// The addresses of every account, whatever its kind. `None` means accounts.json does not exist yet.
pub fn load(dir: &Path) -> Result<Option<Vec<String>>, String> {
    Ok(load_accounts(dir)?.map(|list| list.into_iter().map(|a| a.address).collect()))
}

/// The accounts with their kinds. `None` means accounts.json does not exist yet.
pub fn load_accounts(dir: &Path) -> Result<Option<Vec<Account>>, String> {
    let path = dir.join(FILE);
    match std::fs::read_to_string(&path) {
        Ok(text) => parse(&text)
            .map(Some)
            .map_err(|e| format!("{} の形式が不正です: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{} を読めません: {e}", path.display())),
    }
}

/// The kind of `address`. An address that is not listed counts as Gmail, as it did before kinds existed:
/// the Gmail side then answers that the account must log in again.
pub fn kind(dir: &Path, address: &str) -> Result<AccountKind, String> {
    Ok(kind_of(&load_accounts(dir)?.unwrap_or_default(), address))
}

fn kind_of(list: &[Account], address: &str) -> AccountKind {
    list.iter()
        .find(|a| a.address == address)
        .map_or(AccountKind::Gmail, |a| a.kind)
}

pub fn save_accounts(dir: &Path, accounts: &[Account]) -> Result<(), String> {
    write_atomic(dir, FILE, &render(accounts)?)
}

/// Saves `addresses` as Gmail accounts, for the tests of the modules that only need a list of addresses.
#[cfg(test)]
pub fn save(dir: &Path, addresses: &[String]) -> Result<(), String> {
    let list: Vec<_> = addresses.iter().map(|a| Account::gmail(a)).collect();
    save_accounts(dir, &list)
}

/// Writes `text` to `file` in `dir` (made when missing) through `{file}.tmp` and a rename.
/// Renaming over the target means a crash mid-write leaves the old file, not a truncated one.
pub(crate) fn write_atomic(dir: &Path, file: &str, text: &str) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let (path, tmp) = (dir.join(file), dir.join(format!("{file}.tmp")));
    write_synced(&tmp, text)
        .and_then(|()| std::fs::rename(&tmp, &path))
        .map_err(|e| format!("{} を書けません: {e}", path.display()))
}

pub(crate) fn write_synced(path: &Path, text: &str) -> std::io::Result<()> {
    use std::io::Write;
    let mut file = std::fs::File::create(path)?;
    file.write_all(text.as_bytes())?;
    file.sync_all()
}

fn parse(text: &str) -> Result<Vec<Account>, serde_json::Error> {
    serde_json::from_str::<AccountsFile>(text)
        .map(|f| f.accounts.into_iter().map(Account::from).collect())
}

fn render(accounts: &[Account]) -> Result<String, String> {
    serde_json::to_string_pretty(&AccountsFile {
        accounts: accounts.iter().map(Entry::from).collect(),
    })
    .map_err(|e| e.to_string())
}

/// Appends `account` unless its address is already listed (re-login of the same account keeps one entry, with the kind it has).
pub fn with_account(mut accounts: Vec<Account>, account: Account) -> Vec<Account> {
    if !accounts.iter().any(|a| a.address == account.address) {
        accounts.push(account);
    }
    accounts
}

/// Drops `address`; an address not listed leaves the list as it is.
pub fn without_account(accounts: Vec<Account>, address: &str) -> Vec<Account> {
    accounts
        .into_iter()
        .filter(|a| a.address != address)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn without_account_drops_only_that_account_and_it_can_be_added_again() {
        let list = vec![
            Account::gmail("a@example.com"),
            Account::gmail("b@example.com"),
        ];
        let list = without_account(list, "a@example.com");
        assert_eq!(list, vec![Account::gmail("b@example.com")]);
        assert_eq!(without_account(list.clone(), "x@example.com"), list);
        assert_eq!(
            with_account(
                without_account(list, "b@example.com"),
                Account::gmail("b@example.com")
            ),
            vec![Account::gmail("b@example.com")]
        );
    }

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("tsunagiai-test-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn render_then_parse_round_trips() {
        let list = vec![Account::gmail("a@example.com"), icloud("b@icloud.com")];
        assert_eq!(parse(&render(&list).unwrap()).unwrap(), list);
    }

    fn icloud(address: &str) -> Account {
        Account {
            address: address.to_owned(),
            kind: AccountKind::Icloud,
        }
    }

    #[test]
    fn a_row_without_a_kind_is_gmail() {
        let list = parse(
            r#"{"accounts": ["a@example.com", {"address": "b@example.com"}, {"address": "c@icloud.com", "kind": "icloud"}]}"#,
        )
        .unwrap();
        assert_eq!(
            list,
            vec![
                Account::gmail("a@example.com"),
                Account::gmail("b@example.com"),
                icloud("c@icloud.com")
            ]
        );
    }

    #[test]
    fn gmail_accounts_are_written_as_the_file_always_was() {
        let list = vec![
            Account::gmail("a@example.com"),
            Account::gmail("b@example.com"),
        ];
        let old = serde_json::to_string_pretty(&serde_json::json!({
            "accounts": ["a@example.com", "b@example.com"]
        }))
        .unwrap();
        assert_eq!(render(&list).unwrap(), old);
        let mixed = render(&[Account::gmail("a@example.com"), icloud("b@icloud.com")]).unwrap();
        assert!(mixed.contains(r#""kind": "icloud""#), "{mixed}");
    }

    #[test]
    fn an_unknown_kind_is_refused() {
        assert!(parse(r#"{"accounts": [{"address": "a@x.com", "kind": "outlook"}]}"#).is_err());
    }

    #[test]
    fn kind_is_looked_up_by_address_and_unlisted_counts_as_gmail() {
        let list = vec![Account::gmail("a@example.com"), icloud("b@icloud.com")];
        assert_eq!(kind_of(&list, "a@example.com"), AccountKind::Gmail);
        assert_eq!(kind_of(&list, "b@icloud.com"), AccountKind::Icloud);
        assert_eq!(kind_of(&list, "x@example.com"), AccountKind::Gmail);
        assert_eq!(kind_of(&[], "b@icloud.com"), AccountKind::Gmail);
    }

    #[test]
    fn kind_reads_the_file_and_keeps_the_kind_of_a_listed_account_on_re_login() {
        let dir = temp_dir("kind");
        assert_eq!(kind(&dir, "b@icloud.com"), Ok(AccountKind::Gmail));
        save_accounts(
            &dir,
            &[Account::gmail("a@example.com"), icloud("b@icloud.com")],
        )
        .unwrap();
        assert_eq!(kind(&dir, "b@icloud.com"), Ok(AccountKind::Icloud));
        assert_eq!(kind(&dir, "a@example.com"), Ok(AccountKind::Gmail));
        // The addresses of every kind are listed by `load`.
        assert_eq!(
            load(&dir),
            Ok(Some(vec![
                "a@example.com".to_string(),
                "b@icloud.com".to_string()
            ]))
        );
        let list = load_accounts(&dir).unwrap().unwrap();
        let again = with_account(list.clone(), Account::gmail("b@icloud.com"));
        assert_eq!(again, list);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn parse_rejects_wrong_shape() {
        assert!(parse(r#"["a@example.com"]"#).is_err());
        assert!(parse("").is_err());
    }

    #[test]
    fn with_account_appends_new_and_keeps_existing_once() {
        let list = with_account(vec![], Account::gmail("a@example.com"));
        let list = with_account(list, Account::gmail("b@example.com"));
        let list = with_account(list, Account::gmail("a@example.com"));
        assert_eq!(
            list,
            vec![
                Account::gmail("a@example.com"),
                Account::gmail("b@example.com")
            ]
        );
    }

    #[test]
    fn load_is_none_without_file_and_save_creates_dir_and_file() {
        let dir = temp_dir("save");
        assert_eq!(load(&dir), Ok(None));
        save(&dir, &["a@example.com".to_string()]).unwrap();
        assert_eq!(load(&dir), Ok(Some(vec!["a@example.com".to_string()])));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn failed_save_leaves_the_existing_file_untouched() {
        let dir = temp_dir("atomic");
        save(&dir, &["a@example.com".to_string()]).unwrap();
        // A directory in the temporary file's place makes the write fail before the rename.
        std::fs::create_dir(dir.join("accounts.json.tmp")).unwrap();
        assert!(save(&dir, &["b@example.com".to_string()]).is_err());
        assert_eq!(load(&dir), Ok(Some(vec!["a@example.com".to_string()])));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn save_replaces_the_file_without_leaving_the_temporary_one() {
        let dir = temp_dir("replace");
        save(&dir, &["a@example.com".to_string()]).unwrap();
        save(&dir, &["b@example.com".to_string()]).unwrap();
        assert_eq!(load(&dir), Ok(Some(vec!["b@example.com".to_string()])));
        assert!(!dir.join("accounts.json.tmp").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn write_atomic_makes_the_folder_and_replaces_the_file_without_a_temporary_one() {
        let dir = temp_dir("write-atomic").join("nested");
        write_atomic(&dir, "a.json", "one").unwrap();
        write_atomic(&dir, "a.json", "two").unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("a.json")).unwrap(), "two");
        assert!(!dir.join("a.json.tmp").exists());
        std::fs::remove_dir_all(dir.parent().unwrap()).unwrap();
    }

    #[test]
    fn write_atomic_keeps_the_old_file_and_names_the_path_when_the_write_fails() {
        let dir = temp_dir("write-atomic-fail");
        write_atomic(&dir, "a.json", "one").unwrap();
        // A directory in the temporary file's place makes the write fail before the rename.
        std::fs::create_dir(dir.join("a.json.tmp")).unwrap();
        let err = write_atomic(&dir, "a.json", "two").unwrap_err();
        assert!(err.starts_with(&format!("{} を書けません", dir.join("a.json").display())));
        assert_eq!(std::fs::read_to_string(dir.join("a.json")).unwrap(), "one");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn load_reports_broken_file() {
        let dir = temp_dir("broken");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(FILE), "not json").unwrap();
        assert!(load(&dir).unwrap_err().contains("形式が不正"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
