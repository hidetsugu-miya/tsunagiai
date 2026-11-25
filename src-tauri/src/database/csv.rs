//! The CSV file of the SQL tab (D-6, #1438): the rows of one statement, each value as MySQL wrote it, with nothing cut.
//!
//! The statement is sent as text (`sql::run_csv`), so a number, a date and a time are the characters MySQL wrote, and they are written as they came.
//! The file is UTF-8 with no BOM, its fields are cut by commas and its lines by CRLF, and the first line holds the names of the columns.
//! A field that holds a comma, a quote or a line break is between quotes with each quote doubled (`field`).
//! NULL is an empty field. The binary types and bytes that are not UTF-8 are `0x` and the bytes in hexadecimal, so no value is cut or lost.
//! The rows are written to a temporary file next to the place the person chose, which is renamed onto it when the run is done and deleted when it is not (`create`, `finish`).

use std::{
    borrow::Cow,
    fmt::Write as _,
    fs::File,
    io::{self, BufWriter, Write},
    path::{Path, PathBuf},
};

/// The types whose value is bytes and no text, in the text protocol as in the binary one (a number is the characters of its digits in the text protocol, so the number types are not here).
const BINARY_TYPES: [&str; 8] = [
    "BINARY",
    "VARBINARY",
    "TINYBLOB",
    "BLOB",
    "MEDIUMBLOB",
    "LONGBLOB",
    "GEOMETRY",
    "BIT",
];
const NO_PLACE: &str = "保存先の場所が正しくありません";

/// `bytes` as `0x` and two hexadecimal digits for each byte.
fn hex(bytes: &[u8]) -> String {
    let mut text = String::with_capacity(2 + bytes.len() * 2);
    text.push_str("0x");
    for b in bytes {
        let _ = write!(text, "{b:02X}");
    }
    text
}

/// The text of one value of a column of type `type_name` (sqlx's name of the type) as it goes in a field: none (NULL) is empty, a binary type and bytes that are not UTF-8 are hexadecimal, any other is its text, whole.
pub fn value(type_name: &str, bytes: Option<&[u8]>) -> String {
    let Some(bytes) = bytes else {
        return String::new();
    };
    if BINARY_TYPES.contains(&type_name) {
        return hex(bytes);
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_owned(),
        Err(_) => hex(bytes),
    }
}

/// A field of a line: as it is, or, when it holds a comma, a quote or a line break, between quotes with each quote doubled.
pub fn field(text: &str) -> Cow<'_, str> {
    if text.contains([',', '"', '\r', '\n']) {
        Cow::Owned(format!("\"{}\"", text.replace('"', "\"\"")))
    } else {
        Cow::Borrowed(text)
    }
}

/// A line of `fields`, with the CRLF that ends it.
pub fn line<S: AsRef<str>>(fields: &[S]) -> String {
    let mut text = fields
        .iter()
        .map(|f| field(f.as_ref()))
        .collect::<Vec<_>>()
        .join(",");
    text.push_str("\r\n");
    text
}

/// The name the save dialog starts with.
pub fn suggested_name(database: &str) -> String {
    format!("{database}.csv")
}

/// How a run that wrote rows ended, other than by the error of the session (which is the `sqlx::Error` of the run).
#[derive(Debug, PartialEq)]
pub enum Outcome {
    /// The statement gave its rows, and every one was written.
    Done,
    /// The statement gave no row, so there are no column names to write.
    NoRows,
    /// A row could not be written to the file.
    WriteFailed(String),
}

/// The lines of a CSV file, written to `out` as they come, and how many rows (not counting the line of the names) were written.
pub struct CsvWriter<W: Write> {
    out: W,
    rows: u64,
}

impl<W: Write> CsvWriter<W> {
    pub fn new(out: W) -> Self {
        Self { out, rows: 0 }
    }

    /// The rows written so far.
    pub fn rows(&self) -> u64 {
        self.rows
    }

    /// The first line, with the names of the columns.
    pub fn header(&mut self, columns: &[String]) -> io::Result<()> {
        self.out.write_all(line(columns).as_bytes())
    }

    /// One row.
    pub fn row(&mut self, fields: &[String]) -> io::Result<()> {
        self.out.write_all(line(fields).as_bytes())?;
        self.rows += 1;
        Ok(())
    }

    fn into_inner(self) -> W {
        self.out
    }
}

/// The temporary file that the rows go to before `dest` is made: a file next to it, so that the rename is within one folder.
pub fn tmp_path(dest: &Path) -> Option<PathBuf> {
    let name = dest.file_name()?.to_string_lossy();
    Some(dest.with_file_name(format!(".{name}.tmp")))
}

/// Opens the temporary file of `dest` for the rows, and gives its place too. A `dest` with no file name is refused.
pub fn create(dest: &Path) -> Result<(CsvWriter<BufWriter<File>>, PathBuf), String> {
    let tmp = tmp_path(dest).ok_or_else(|| NO_PLACE.to_owned())?;
    let file = File::create(&tmp).map_err(|e| format!("{} を書けません: {e}", dest.display()))?;
    Ok((CsvWriter::new(BufWriter::new(file)), tmp))
}

/// Ends the file: a run that is `Done` is flushed, synced and renamed onto `dest` and gives its rows, and any other end (the words of a failure of the run included) deletes the temporary file and gives its words. A file already at `dest` is replaced only when the rename is made.
pub fn finish(
    out: CsvWriter<BufWriter<File>>,
    tmp: &Path,
    dest: &Path,
    outcome: Result<Outcome, String>,
    no_rows: &str,
) -> Result<u64, String> {
    let rows = out.rows();
    let write_failed = |e: io::Error| format!("{} を書けません: {e}", dest.display());
    let result = match outcome {
        Ok(Outcome::Done) => out
            .into_inner()
            .into_inner()
            .map_err(|e| e.into_error())
            .and_then(|file| file.sync_all())
            .and_then(|()| std::fs::rename(tmp, dest))
            .map(|()| rows)
            .map_err(write_failed),
        Ok(Outcome::NoRows) => Err(no_rows.to_owned()),
        Ok(Outcome::WriteFailed(message)) => Err(message),
        Err(message) => Err(message),
    };
    if result.is_err() {
        let _ = std::fs::remove_file(tmp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(rows: &[&[&str]]) -> String {
        rows.iter().map(|r| line(r)).collect()
    }

    #[test]
    fn a_field_with_a_comma_a_quote_or_a_line_break_is_between_quotes_with_each_quote_doubled() {
        assert_eq!(field("plain"), "plain");
        assert_eq!(field(""), "");
        assert_eq!(field("a,b"), "\"a,b\"");
        assert_eq!(field("say \"hi\""), "\"say \"\"hi\"\"\"");
        assert_eq!(field("a\nb"), "\"a\nb\"");
        assert_eq!(field("a\rb"), "\"a\rb\"");
        assert_eq!(field("a\r\nb"), "\"a\r\nb\"");
        // A tab, a space and a non-ASCII letter need no quotes.
        assert_eq!(field(" a\tあ "), " a\tあ ");
    }

    #[test]
    fn a_line_has_its_fields_cut_by_commas_and_ends_with_crlf() {
        assert_eq!(line(&["id", "name"]), "id,name\r\n");
        assert_eq!(line(&["1", "a,b", "\"q\""]), "1,\"a,b\",\"\"\"q\"\"\"\r\n");
        assert_eq!(line(&[""; 3]), ",,\r\n");
        assert_eq!(line(&["a\nb"]), "\"a\nb\"\r\n");
        assert_eq!(line(&[String::from("x")]), "x\r\n");
    }

    #[test]
    fn null_is_an_empty_field_and_an_empty_text_is_one_too() {
        assert_eq!(value("VARCHAR", None), "");
        assert_eq!(value("VARCHAR", Some(b"")), "");
        assert_eq!(value("INT", None), "");
    }

    #[test]
    fn a_number_a_date_and_a_text_are_written_as_they_came_and_a_long_text_is_not_cut() {
        assert_eq!(value("INT", Some(b"-12")), "-12");
        assert_eq!(value("DECIMAL", Some(b"1.50")), "1.50");
        assert_eq!(
            value("DATETIME", Some(b"2026-11-25 12:00:00")),
            "2026-11-25 12:00:00"
        );
        assert_eq!(value("VARCHAR", Some("あいう".as_bytes())), "あいう");
        let long = "あ".repeat(5000);
        assert_eq!(value("LONGTEXT", Some(long.as_bytes())), long);
    }

    #[test]
    fn a_binary_type_is_hexadecimal_with_0x_whatever_its_bytes_are() {
        for name in [
            "BINARY",
            "VARBINARY",
            "TINYBLOB",
            "BLOB",
            "MEDIUMBLOB",
            "LONGBLOB",
            "GEOMETRY",
            "BIT",
        ] {
            assert_eq!(value(name, Some(b"ab")), "0x6162", "{name}");
        }
        assert_eq!(value("BLOB", Some(&[0x00, 0xde, 0xAD])), "0x00DEAD");
        assert_eq!(value("BLOB", Some(b"")), "0x");
        assert_eq!(value("BIT", Some(&[0x01])), "0x01");
    }

    #[test]
    fn bytes_that_are_not_utf8_are_hexadecimal_even_in_a_text_type() {
        assert_eq!(value("VARCHAR", Some(&[0x61, 0xff, 0xfe])), "0x61FFFE");
    }

    #[test]
    fn the_names_of_the_columns_are_the_first_line_and_the_rows_follow_it() {
        let mut csv = CsvWriter::new(Vec::new());
        assert_eq!(csv.rows(), 0);
        csv.header(&["id".to_owned(), "memo, long".to_owned()])
            .unwrap();
        assert_eq!(csv.rows(), 0);
        csv.row(&["1".to_owned(), "a\nb".to_owned()]).unwrap();
        csv.row(&["2".to_owned(), String::new()]).unwrap();
        assert_eq!(csv.rows(), 2);
        assert_eq!(
            String::from_utf8(csv.into_inner()).unwrap(),
            text(&[&["id", "memo, long"], &["1", "a\nb"], &["2", ""]])
        );
        assert_eq!(
            text(&[&["id", "memo, long"], &["1", "a\nb"]]),
            "id,\"memo, long\"\r\n1,\"a\nb\"\r\n"
        );
    }

    #[test]
    fn the_temporary_file_is_a_hidden_file_next_to_the_place_and_a_place_with_no_name_is_refused() {
        assert_eq!(
            tmp_path(Path::new("/a/b/shop.csv")),
            Some(PathBuf::from("/a/b/.shop.csv.tmp"))
        );
        assert_eq!(tmp_path(Path::new("/")), None);
        assert_eq!(
            create(Path::new("/")).err().as_deref(),
            Some("保存先の場所が正しくありません")
        );
        assert_eq!(suggested_name("shop"), "shop.csv");
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tsunagiai-csv-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_finished_run_is_renamed_onto_the_place_and_replaces_the_file_that_was_there() {
        let dir = temp_dir("done");
        let dest = dir.join("shop.csv");
        std::fs::write(&dest, "old").unwrap();
        let (mut csv, tmp) = create(&dest).unwrap();
        assert!(tmp.exists());
        csv.header(&["n".to_owned()]).unwrap();
        csv.row(&["1".to_owned()]).unwrap();
        let rows = finish(csv, &tmp, &dest, Ok(Outcome::Done), "none").unwrap();
        assert_eq!(rows, 1);
        assert_eq!(std::fs::read_to_string(&dest).unwrap(), "n\r\n1\r\n");
        assert!(!tmp.exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_run_that_did_not_finish_deletes_the_temporary_file_and_leaves_the_file_that_was_there() {
        let dir = temp_dir("failed");
        let dest = dir.join("shop.csv");
        std::fs::write(&dest, "old").unwrap();
        let ends = [
            (Ok(Outcome::NoRows), "none"),
            (Ok(Outcome::WriteFailed("disk".to_owned())), "disk"),
            (
                Err("MySQL との接続が切れました".to_owned()),
                "MySQL との接続が切れました",
            ),
        ];
        for (outcome, words) in ends {
            let (mut csv, tmp) = create(&dest).unwrap();
            csv.header(&["n".to_owned()]).unwrap();
            assert_eq!(
                finish(csv, &tmp, &dest, outcome, "none"),
                Err(words.to_owned())
            );
            assert!(!tmp.exists());
            assert_eq!(std::fs::read_to_string(&dest).unwrap(), "old");
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_place_that_cannot_be_written_is_told_with_its_path_before_anything_is_run() {
        let dir = temp_dir("missing");
        let dest = dir.join("no-folder").join("shop.csv");
        let told = create(&dest).err().unwrap();
        assert!(told.starts_with(&format!("{} を書けません", dest.display())));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
