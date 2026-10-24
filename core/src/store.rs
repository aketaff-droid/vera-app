//! The catalogue (`vera2.sqlite`): references to the books of the watched folder, never copies of them.
//! A book is identified by the SHA-256 of its file; the same file at two places is one book.
use crate::{
    metadata::{Inspected, Metadata},
    util::{now, path_key, Stamp},
    Result, SEP,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

pub const FILE: &str = "vera2.sqlite";
pub const ACCENTS: [&str; 9] = ["maison", "blue", "purple", "pink", "red", "orange", "yellow", "green", "graphite"];
/// The looks of the window (docs/DECISIONS.md, section P); the reader keeps its own backgrounds.
pub const THEMES: [&str; 5] = ["vera", "papier", "citadelle", "encre", "reflet"];
/// The 1.x catalogue, read once (never written) to keep what it knew of the Kobo.
pub const LEGACY: &str = "catalogue.sqlite";
const SCHEMA: i64 = 2;
/// `books.made_cover`: none yet, made by Vera, or impossible to make (never tried again).
const MADE: i64 = 1;
/// Books above this size are not opened in Vera's reader (the whole file goes to the window).
const MAX_READ: u64 = 512 * 1024 * 1024;
const UNMADE: i64 = 2;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub watch_dir: Option<String>,
    pub autostart: bool,
    pub kobo_sync: bool,
    /// The accent colour: "maison" (the theme's own) or, as on macOS, blue, purple, pink, red, orange, yellow, green
    /// or graphite.
    pub accent: String,
    /// The look of the window: vera, papier, citadelle, encre or reflet.
    pub theme: String,
    /// "auto", "light" or "dark".
    pub appearance: String,
    /// Replace Vera's copy on the Kobo after a correction. Off until checked on the real liseuse that
    /// a replaced file keeps its reading position (docs/CAHIER-DES-CHARGES-2.0.md, §5).
    pub replace_edited: bool,
    pub onboarded: bool,
    /// The guided start was shown (or skipped).
    pub toured: bool,
    /// How books are shown in Vera's reader.
    pub reader: ReaderSettings,
    /// Sharing: the mail account and Discord channels (their secrets are in Windows' credential store, never
    /// here) and the recent recipients.
    pub share: ShareSettings,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ShareSettings {
    pub mail: Option<crate::share::MailAccount>,
    pub channels: Vec<Channel>,
    /// Addresses the books were last sent to, newest first.
    pub recent: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Channel {
    /// Key of its webhook in the credential store.
    pub id: String,
    /// What the owner calls it, « #livres · Serveur des amis ».
    pub name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ReaderSettings {
    /// Text size in pixels, 14 to 32.
    pub size: u32,
    /// Background: "blanc", "papier", "calme" or "nuit".
    pub theme: String,
    /// "serif" (Literata) or "sans" (the system's).
    pub font: String,
}

impl Default for ReaderSettings {
    fn default() -> Self {
        Self { size: 19, theme: "papier".into(), font: "serif".into() }
    }
}

/// Where the reader left a book: a position the reader understands (a CFI for an EPUB, a page for a PDF) and
/// how far it is, from 0 to 1.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Reading {
    pub position: String,
    pub fraction: f64,
    pub at: i64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            watch_dir: None,
            autostart: true,
            kobo_sync: true,
            accent: "orange".into(),
            theme: "vera".into(),
            appearance: "auto".into(),
            replace_edited: false,
            onboarded: false,
            toured: false,
            reader: ReaderSettings::default(),
            share: ShareSettings::default(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub hash: String,
    pub title: String,
    pub authors: String,
    pub format: String,
    pub size: u64,
    pub path: String,
    /// Its folder below the watched one, « A › B »; None at the root.
    pub collection: Option<String>,
    pub cover: Option<String>,
    /// A light copy of the cover for the grids (cover.rs); None until made.
    pub thumb: Option<String>,
    /// The cover's colours (vivid, deep), « #rrggbb »; empty without a cover.
    pub tint: Vec<String>,
    /// The cover was made by Vera (first page of a PDF, or drawn for an EPUB without one).
    pub made_cover: bool,
    /// Another book with the same title and author: probably the same book in two files (never removed).
    pub twin: bool,
    /// How far it has been read in Vera, from 0 to 1; None if never opened there.
    pub read: Option<f64>,
    /// Where it is on the Kobo, as the liseuse last said (read, never written).
    pub kobo: Option<KoboReading>,
    /// Highlights and notes made on the Kobo, kept in Vera.
    pub notes: usize,
    pub added_at: i64,
    /// Why the file cannot be read; such a book is never sent.
    pub problem: Option<String>,
    pub edited: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KoboReading {
    /// 0 to 100.
    pub percent: u8,
    /// 0 not started, 1 reading, 2 finished (the Kobo's ReadStatus).
    pub status: u8,
}

/// A highlight or a note made on the Kobo.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub text: String,
    pub note: String,
    /// Where in the book, 0 to 1.
    pub progress: f64,
    pub created: String,
}

/// A passage highlighted in Vera's reader (docs/DECISIONS.md, section P). Kept in the catalogue only: never in the
/// book's file, never on the Kobo.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Highlight {
    pub id: String,
    /// Where in the book: an EPUB CFI range.
    pub position: String,
    pub text: String,
    /// jaune, vert, bleu or rose.
    pub color: String,
    pub note: String,
    /// Where in the book, 0 to 1, to sort and to show.
    pub fraction: f64,
    #[serde(default)]
    pub created: i64,
}
pub const HIGHLIGHT_COLORS: [&str; 4] = ["jaune", "vert", "bleu", "rose"];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub name: String,
    pub label: String,
    pub parent: Option<String>,
    /// Books directly in it, and in it with its sub-collections.
    pub count: usize,
    pub total: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    pub books: Vec<Book>,
    pub collections: Vec<Collection>,
    /// Probable duplicates: groups of books with the same title and author, as hashes.
    pub twins: Vec<Vec<String>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detail {
    pub book: Book,
    pub original: Metadata,
    pub metadata: Metadata,
    pub revision: i64,
}

pub struct Store {
    pub root: PathBuf,
}

impl Store {
    pub fn open(root: PathBuf) -> Result<Self> {
        for dir in ["covers", "staging", "backups"] {
            fs::create_dir_all(root.join(dir)).map_err(|e| e.to_string())?;
        }
        let store = Self { root };
        let fresh = !store.root.join(FILE).exists();
        let db = store.db()?;
        let version: i64 = db.pragma_query_value(None, "user_version", |r| r.get(0)).map_err(|e| e.to_string())?;
        if version > SCHEMA {
            return Err("Catalogue créé par une version plus récente de Vera ; rien n’a été modifié.".into());
        }
        db.pragma_update(None, "journal_mode", "WAL").map_err(|e| e.to_string())?;
        db.execute_batch(
            "BEGIN;
            CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS books(hash TEXT PRIMARY KEY, format TEXT NOT NULL, size INTEGER NOT NULL,
                metadata TEXT NOT NULL, cover TEXT, problem TEXT, added_at INTEGER NOT NULL,
                thumb TEXT, tint TEXT, made_cover INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY COLLATE NOCASE, hash TEXT NOT NULL REFERENCES books(hash),
                size INTEGER NOT NULL, modified INTEGER NOT NULL);
            CREATE INDEX IF NOT EXISTS files_by_hash ON files(hash);
            CREATE TABLE IF NOT EXISTS edits(hash TEXT PRIMARY KEY, metadata TEXT NOT NULL, revision INTEGER NOT NULL, at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS transfers(device TEXT NOT NULL, hash TEXT NOT NULL, relative TEXT NOT NULL,
                revision INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, PRIMARY KEY(device, hash));
            CREATE TABLE IF NOT EXISTS device_files(device TEXT NOT NULL, relative TEXT NOT NULL, size INTEGER NOT NULL,
                modified INTEGER NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(device, relative));
            CREATE TABLE IF NOT EXISTS shelves(device TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY(device, name));
            CREATE TABLE IF NOT EXISTS facts(key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS twins_ok(key TEXT PRIMARY KEY);
            CREATE TABLE IF NOT EXISTS journal(id INTEGER PRIMARY KEY, at INTEGER NOT NULL, report TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS reading(hash TEXT PRIMARY KEY, position TEXT NOT NULL, fraction REAL NOT NULL, at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS departed(hash TEXT PRIMARY KEY, at INTEGER NOT NULL, title TEXT NOT NULL, authors TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS kobo_reading(device TEXT NOT NULL, hash TEXT NOT NULL, percent INTEGER NOT NULL, status INTEGER NOT NULL,
                last_read TEXT, PRIMARY KEY(device, hash));
            CREATE TABLE IF NOT EXISTS annotations(device TEXT NOT NULL, id TEXT NOT NULL, hash TEXT NOT NULL, text TEXT NOT NULL, note TEXT NOT NULL,
                progress REAL NOT NULL, created TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY(device, id));
            CREATE INDEX IF NOT EXISTS annotations_by_book ON annotations(hash);
            CREATE TABLE IF NOT EXISTS highlights(hash TEXT NOT NULL, id TEXT NOT NULL, position TEXT NOT NULL, text TEXT NOT NULL,
                color TEXT NOT NULL, note TEXT NOT NULL, fraction REAL NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(hash, id));
            COMMIT;",
        )
        .map_err(|e| e.to_string())?;
        // 2.0 essai 1 → thumbnails, cover colours and covers made by Vera; only the columns still missing.
        let columns: Vec<String> = db
            .prepare("SELECT name FROM pragma_table_info('books')")
            .and_then(|mut s| s.query_map([], |r| r.get(0))?.collect())
            .map_err(|e| e.to_string())?;
        for (column, kind) in [("thumb", "TEXT"), ("tint", "TEXT"), ("made_cover", "INTEGER NOT NULL DEFAULT 0")] {
            if !columns.iter().any(|c| c == column) {
                db.execute(&format!("ALTER TABLE books ADD COLUMN {column} {kind}"), []).map_err(|e| e.to_string())?;
            }
        }
        db.pragma_update(None, "user_version", SCHEMA).map_err(|e| e.to_string())?;
        db.execute(
            "INSERT OR IGNORE INTO settings VALUES(1, ?1)",
            [serde_json::to_string(&Settings::default()).map_err(|e| e.to_string())?],
        )
        .map_err(|e| e.to_string())?;
        if fresh {
            store.adopt_legacy()?;
        }
        Ok(store)
    }

    pub fn db(&self) -> Result<Connection> {
        let db = Connection::open(self.root.join(FILE)).map_err(|e| format!("Catalogue inaccessible : {e}"))?;
        db.busy_timeout(Duration::from_secs(5)).map_err(|e| e.to_string())?;
        db.pragma_update(None, "foreign_keys", true).map_err(|e| e.to_string())?;
        Ok(db)
    }

    pub fn settings(&self) -> Result<Settings> {
        let json: String =
            self.db()?.query_row("SELECT json FROM settings WHERE id=1", [], |r| r.get(0)).map_err(|e| e.to_string())?;
        serde_json::from_str(&json).map_err(|e| format!("Réglages illisibles : {e}"))
    }

    pub fn save_settings(&self, mut settings: Settings) -> Result<Settings> {
        let reader = &settings.reader;
        if !ACCENTS.contains(&settings.accent.as_str())
            || !THEMES.contains(&settings.theme.as_str())
            || !["auto", "light", "dark"].contains(&settings.appearance.as_str())
            || !(14..=32).contains(&reader.size)
            || !["blanc", "papier", "calme", "nuit"].contains(&reader.theme.as_str())
            || !["serif", "sans"].contains(&reader.font.as_str())
        {
            return Err("Réglage hors des valeurs permises.".into());
        }
        let share = &settings.share;
        if let Some(account) = &share.mail {
            crate::share::check_account(account)?;
        }
        if share.channels.len() > 20
            || share.channels.iter().any(|c| c.name.trim().is_empty() || c.name.chars().count() > 100 || c.id.is_empty() || c.id.len() > 64 || !c.id.chars().all(|x| x.is_ascii_alphanumeric() || x == '-'))
            || share.recent.len() > 12
            || share.recent.iter().any(|r| r.len() > 320 || !r.contains('@'))
        {
            return Err("Réglages de partage invalides.".into());
        }
        if let Some(dir) = &settings.watch_dir {
            let dir = fs::canonicalize(dir).map_err(|_| "Ce dossier n’est pas accessible.")?;
            let data = fs::canonicalize(&self.root).map_err(|e| e.to_string())?;
            if !dir.is_dir() || dir.parent().is_none() || dir.starts_with(&data) || data.starts_with(&dir) {
                return Err("Choisis un dossier de livres, distinct d’une racine de disque et des données de Vera.".into());
            }
            settings.watch_dir = Some(plain(&dir));
        }
        let json = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
        self.db()?.execute("UPDATE settings SET json=?1 WHERE id=1", [json]).map_err(|e| e.to_string())?;
        Ok(settings)
    }

    pub fn fact(&self, key: &str) -> Result<Option<String>> {
        self.db()?
            .query_row("SELECT value FROM facts WHERE key=?1", [key], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())
    }

    pub fn set_fact(&self, key: &str, value: &str) -> Result<()> {
        self.db()?
            .execute("INSERT INTO facts VALUES(?1, ?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key, value])
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    /// The highlights and notes of a book, in reading order (kept even after the book left the Kobo).
    pub fn annotations(&self, hash: &str) -> Result<Vec<Annotation>> {
        let db = self.db()?;
        let mut stmt = db
            .prepare("SELECT text, note, progress, created FROM annotations WHERE hash=?1 GROUP BY text, note ORDER BY progress, created")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([hash], |r| Ok(Annotation { text: r.get(0)?, note: r.get(1)?, progress: r.get(2)?, created: r.get(3)? }))
            .map_err(|e| e.to_string())?;
        rows.collect::<std::result::Result<_, _>>().map_err(|e| e.to_string())
    }

    /// The annotations as a Markdown page: the book, then each highlight as a quote with its note.
    pub fn annotations_markdown(&self, hash: &str, title: &str, authors: &str) -> Result<String> {
        let notes = self.annotations(hash)?;
        let marks = self.highlights(hash)?;
        let mut out = format!("# {title}\n\n");
        if !authors.is_empty() {
            out.push_str(&format!("{authors}\n\n"));
        }
        out.push_str(&format!("{} exporté{} par Vera depuis la Kobo.\n", notes.len(), if notes.len() > 1 { "s" } else { "" }));
        for n in notes {
            out.push_str(&format!("\n---\n\n*{} %*\n\n", (n.progress * 100.0).round() as i64));
            if !n.text.trim().is_empty() {
                for line in n.text.trim().lines() {
                    out.push_str(&format!("> {line}\n"));
                }
            }
            if !n.note.trim().is_empty() {
                out.push_str(&format!("\n**Note :** {}\n", n.note.trim()));
            }
        }
        if !marks.is_empty() {
            out.push_str(&format!("\n## Surlignés dans Vera\n\n{} passage{}.\n", marks.len(), if marks.len() > 1 { "s" } else { "" }));
            for m in marks {
                out.push_str(&format!("\n---\n\n*{} % · {}*\n\n", (m.fraction * 100.0).round() as i64, m.color));
                for line in m.text.lines() {
                    out.push_str(&format!("> {line}\n"));
                }
                if !m.note.is_empty() {
                    out.push_str(&format!("\n**Note :** {}\n", m.note));
                }
            }
        }
        Ok(out)
    }

    /// Puts the addresses a mail was just sent to first in the recent recipients (twelve at most).
    pub fn remember_recipients(&self, to: &[String]) -> Result<()> {
        let mut settings = self.settings()?;
        let mut recent: Vec<String> = to.iter().map(|t| t.trim().to_string()).filter(|t| t.contains('@') && t.len() <= 320).collect();
        for old in settings.share.recent {
            if !recent.iter().any(|r| r.eq_ignore_ascii_case(&old)) {
                recent.push(old);
            }
        }
        recent.truncate(12);
        settings.share.recent = recent;
        self.save_settings(settings).map(|_| ())
    }

    /// Keeps a synchronisation's report in the journal, which holds the last 50.
    pub fn log_sync(&self, at: i64, report: &str) -> Result<()> {
        let db = self.db()?;
        db.execute("INSERT INTO journal(at, report) VALUES(?1, ?2)", params![at, report]).map_err(|e| e.to_string())?;
        db.execute("DELETE FROM journal WHERE id NOT IN (SELECT id FROM journal ORDER BY id DESC LIMIT 50)", [])
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    /// The journal of synchronisations, newest first.
    pub fn journal(&self, limit: usize) -> Result<Vec<serde_json::Value>> {
        let db = self.db()?;
        let mut stmt = db.prepare("SELECT report FROM journal ORDER BY id DESC LIMIT ?1").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([limit as i64], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).map(|json| serde_json::from_str(&json).map_err(|e| e.to_string())).collect()
    }

    /// Every file Vera knows, by path key: its path, stamp and book.
    pub fn files(&self) -> Result<HashMap<String, (PathBuf, Stamp, String)>> {
        let db = self.db()?;
        let mut stmt = db.prepare("SELECT path, size, modified, hash FROM files").map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                let path: String = r.get(0)?;
                Ok((PathBuf::from(&path), Stamp { size: r.get::<_, i64>(1)? as u64, modified: r.get(2)? }, r.get(3)?))
            })
            .map_err(|e| e.to_string())?;
        let mut files = HashMap::new();
        for row in rows {
            let (path, stamp, hash): (PathBuf, Stamp, String) = row.map_err(|e| e.to_string())?;
            files.insert(path_key(&path), (path, stamp, hash));
        }
        Ok(files)
    }

    pub fn has_book(&self, hash: &str) -> Result<bool> {
        self.db()?
            .query_row("SELECT EXISTS(SELECT 1 FROM books WHERE hash=?1)", [hash], |r| r.get(0))
            .map_err(|e| e.to_string())
    }

    /// Records a new book read from its file, or one whose file could not be read (`Err`: the reason).
    pub fn add_book(&self, hash: &str, path: &Path, stamp: Stamp, read: Result<Inspected>) -> Result<()> {
        let format = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        let (metadata, cover, problem) = match read {
            Ok(Inspected { metadata, cover }) => (metadata, cover, None),
            Err(problem) => {
                let title = path.file_stem().unwrap_or_default().to_string_lossy().into_owned();
                (Metadata { title, ..Metadata::default() }, None, Some(problem))
            }
        };
        let cover = cover.map(|c| self.write_cover(hash, c.extension, &c.bytes)).transpose()?;
        let (cover, thumb, tint) = match cover {
            Some((cover, thumb, tint)) => (Some(cover), thumb, tint),
            None => (None, None, None),
        };
        let mut db = self.db()?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT OR IGNORE INTO books(hash, format, size, metadata, cover, problem, added_at, thumb, tint) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![hash, format, stamp.size as i64, serde_json::to_string(&metadata).map_err(|e| e.to_string())?, cover, problem, now(), thumb, tint],
        )
        .map_err(|e| e.to_string())?;
        put_file(&tx, path, stamp, hash)?;
        // Back in the folder: no longer leaving.
        tx.execute("DELETE FROM departed WHERE hash=?1", [hash]).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }

    /// A known book seen at a (new) place: a move or a rename keeps the book.
    pub fn place_file(&self, path: &Path, stamp: Stamp, hash: &str) -> Result<()> {
        put_file(&self.db()?, path, stamp, hash)
    }

    /// Forgets a file that left the folder; its book leaves the list once no file holds it. Nothing on disk
    /// or on the Kobo is touched, except Vera's own cover image.
    pub fn forget_file(&self, path: &Path) -> Result<()> {
        let mut db = self.db()?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        let hash: Option<String> = tx
            .query_row("SELECT hash FROM files WHERE path=?1", [plain(path)], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        let Some(hash) = hash else { return Ok(()) };
        tx.execute("DELETE FROM files WHERE path=?1", [plain(path)]).map_err(|e| e.to_string())?;
        let left: bool = tx
            .query_row("SELECT EXISTS(SELECT 1 FROM files WHERE hash=?1)", [&hash], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let mut images: Vec<Option<String>> = Vec::new();
        if !left {
            if let Some(pair) = tx
                .query_row("SELECT cover, thumb FROM books WHERE hash=?1", [&hash], |r| Ok(vec![r.get(0)?, r.get(1)?]))
                .optional()
                .map_err(|e| e.to_string())?
            {
                images = pair;
            }
            // When the book left the folder, and what it was: its Kobo copy is offered for removal a day later.
            let (original, edit): (String, Option<String>) = tx
                .query_row("SELECT b.metadata, e.metadata FROM books b LEFT JOIN edits e ON e.hash=b.hash WHERE b.hash=?1", [&hash], |r| Ok((r.get(0)?, r.get(1)?)))
                .map_err(|e| e.to_string())?;
            let card: Metadata = serde_json::from_str(edit.as_deref().unwrap_or(&original)).unwrap_or_default();
            tx.execute("INSERT OR IGNORE INTO departed VALUES(?1, ?2, ?3, ?4)", params![hash, now(), card.title, card.authors])
                .map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM reading WHERE hash=?1", [&hash]).map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM books WHERE hash=?1", [&hash]).map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        for image in images.into_iter().flatten().map(PathBuf::from) {
            if image.starts_with(self.root.join("covers")) {
                let _ = fs::remove_file(image);
            }
        }
        Ok(())
    }

    fn books_where(&self, filter: &str, arg: Option<&str>) -> Result<Vec<Book>> {
        let watch = self.settings()?.watch_dir.map(PathBuf::from);
        let db = self.db()?;
        let sql = format!(
            "SELECT b.hash, b.format, b.size, b.metadata, b.cover, b.problem, b.added_at, e.metadata,
                (SELECT group_concat(path, char(31)) FROM files f WHERE f.hash=b.hash), b.thumb, b.tint, b.made_cover, r.fraction,
                (SELECT k.percent FROM kobo_reading k WHERE k.hash=b.hash ORDER BY k.last_read DESC LIMIT 1),
                (SELECT k.status FROM kobo_reading k WHERE k.hash=b.hash ORDER BY k.last_read DESC LIMIT 1),
                (SELECT count(*) FROM annotations a WHERE a.hash=b.hash)
             FROM books b LEFT JOIN edits e ON e.hash=b.hash LEFT JOIN reading r ON r.hash=b.hash {filter} ORDER BY b.added_at DESC, b.hash"
        );
        let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
        let map = |r: &rusqlite::Row| -> rusqlite::Result<(Book, String, Option<String>)> {
            // A book in several places takes the first one in a collection: a copy left at the root of the folder
            // does not take it out of its collection.
            let paths: Option<String> = r.get(8)?;
            let mut paths: Vec<&str> = paths.as_deref().unwrap_or("").split('\u{1f}').filter(|p| !p.is_empty()).collect();
            paths.sort_unstable();
            let placed = paths.iter().find_map(|p| watch.as_deref().and_then(|w| collection_of(w, Path::new(p))).map(|c| (p.to_string(), Some(c))));
            let (path, collection) = placed.unwrap_or_else(|| (paths.first().map(|p| p.to_string()).unwrap_or_default(), None));
            let tint: Option<String> = r.get(10)?;
            let book = Book {
                collection,
                hash: r.get(0)?,
                title: String::new(),
                authors: String::new(),
                format: r.get(1)?,
                size: r.get::<_, i64>(2)? as u64,
                path,
                cover: r.get(4)?,
                thumb: r.get(9)?,
                tint: tint.and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default(),
                made_cover: r.get::<_, i64>(11)? == MADE,
                twin: false,
                read: r.get(12)?,
                kobo: match (r.get::<_, Option<i64>>(13)?, r.get::<_, Option<i64>>(14)?) {
                    (Some(percent), Some(status)) => Some(KoboReading { percent: percent.clamp(0, 100) as u8, status: status.clamp(0, 2) as u8 }),
                    _ => None,
                },
                notes: r.get::<_, i64>(15)? as usize,
                added_at: r.get(6)?,
                problem: r.get(5)?,
                edited: false,
            };
            Ok((book, r.get(3)?, r.get(7)?))
        };
        let rows: Vec<_> = match arg {
            Some(arg) => stmt.query_map([arg], map),
            None => stmt.query_map([], map),
        }
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string())?;
        rows.into_iter()
            .map(|(mut book, original, edit)| {
                book.edited = edit.is_some();
                let metadata: Metadata = serde_json::from_str(edit.as_deref().unwrap_or(&original)).map_err(|e| e.to_string())?;
                book.title = metadata.title;
                book.authors = metadata.authors;
                Ok(book)
            })
            .collect()
    }

    /// Saves a cover image of a book with its thumbnail and colours: (cover, thumbnail, colours as JSON).
    /// `name` is the book's hash, followed for a made cover by a stamp: a new image gets a new address, which the
    /// interface cannot have kept in its cache.
    fn write_cover(&self, name: &str, extension: &str, bytes: &[u8]) -> Result<(String, Option<String>, Option<String>)> {
        let file = self.root.join("covers").join(format!("{name}.{extension}"));
        fs::write(&file, bytes).map_err(|e| e.to_string())?;
        // A cover that cannot be decoded is still kept: the Kobo copy is not affected.
        let Ok(prepared) = crate::cover::prepare(bytes) else { return Ok((plain(&file), None, None)) };
        let thumb = self.root.join("covers").join(format!("{name}.thumb.jpg"));
        fs::write(&thumb, &prepared.thumb).map_err(|e| e.to_string())?;
        Ok((plain(&file), Some(plain(&thumb)), serde_json::to_string(&prepared.tint).ok()))
    }

    /// A cover made by Vera for a book that has none (first page of a PDF, or one drawn for an EPUB).
    /// A book whose file has a cover keeps it: this never replaces a real cover.
    pub fn set_made_cover(&self, hash: &str, png: &[u8]) -> Result<bool> {
        let current: Option<(Option<String>, Option<String>, bool)> = self
            .db()?
            .query_row("SELECT cover, thumb, made_cover FROM books WHERE hash=?1", [hash], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get::<_, i64>(2)? == MADE))
            })
            .optional()
            .map_err(|e| e.to_string())?;
        let old = match current {
            None => return Err("Livre introuvable.".into()),
            Some((Some(_), _, false)) => return Ok(false),
            Some((cover, thumb, _)) => [cover, thumb],
        };
        if png.len() > 16 * 1024 * 1024 || !png.starts_with(b"\x89PNG") {
            return Err("Couverture créée invalide.".into());
        }
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let (cover, thumb, tint) = self.write_cover(&format!("{hash}-{stamp:x}"), "png", png)?;
        self.db()?
            .execute("UPDATE books SET cover=?2, thumb=?3, tint=?4, made_cover=?5 WHERE hash=?1", params![hash, cover, thumb, tint, MADE])
            .map_err(|e| e.to_string())?;
        for image in old.into_iter().flatten().map(PathBuf::from) {
            if image.starts_with(self.root.join("covers")) {
                let _ = fs::remove_file(image);
            }
        }
        Ok(true)
    }

    /// Covers for books that have none, a few at a time: the first page of a PDF, else one drawn from the card.
    /// Returns how many were made.
    pub fn make_covers(&self, limit: usize) -> Result<usize> {
        let todo: Vec<String> = {
            let db = self.db()?;
            let mut stmt = db
                .prepare("SELECT hash FROM books WHERE cover IS NULL AND problem IS NULL AND made_cover=0 ORDER BY added_at DESC LIMIT ?1")
                .map_err(|e| e.to_string())?;
            let rows = stmt.query_map([limit as i64], |r| r.get(0)).map_err(|e| e.to_string())?;
            rows.collect::<std::result::Result<_, _>>().map_err(|e| e.to_string())?
        };
        let mut made = 0;
        for hash in todo {
            let book = self.detail(&hash)?.book;
            let png = match book.format.as_str() {
                "pdf" => crate::cover::first_page(Path::new(&book.path)),
                _ => Err(String::new()),
            }
            .or_else(|_| crate::cover::drawn(&book.title, &book.authors, &hash));
            match png.and_then(|png| self.set_made_cover(&hash, &png)) {
                Ok(true) => made += 1,
                Ok(false) => {}
                Err(_) => {
                    self.db()?.execute("UPDATE books SET made_cover=?2 WHERE hash=?1", params![hash, UNMADE]).map_err(|e| e.to_string())?;
                }
            }
        }
        Ok(made)
    }

    /// After a correction, a drawn cover shows the new title and author. A PDF keeps its first page.
    pub fn redraw_cover(&self, hash: &str) -> Result<bool> {
        let book = self.detail(hash)?.book;
        if !book.made_cover || book.format != "epub" {
            return Ok(false);
        }
        self.set_made_cover(hash, &crate::cover::drawn(&book.title, &book.authors, hash)?)
    }

    /// Thumbnails and colours for covers read before they existed (catalogue of 2.0 essai 1), a few at a time.
    pub fn refresh_thumbs(&self, limit: usize) -> Result<usize> {
        let todo: Vec<(String, String)> = {
            let db = self.db()?;
            let mut stmt = db
                .prepare("SELECT hash, cover FROM books WHERE cover IS NOT NULL AND thumb IS NULL LIMIT ?1")
                .map_err(|e| e.to_string())?;
            let rows = stmt.query_map([limit as i64], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?;
            rows.collect::<std::result::Result<_, _>>().map_err(|e| e.to_string())?
        };
        let mut done = 0;
        for (hash, cover) in todo {
            let Ok(bytes) = fs::read(&cover) else { continue };
            let Ok(prepared) = crate::cover::prepare(&bytes) else {
                // Undecodable: never tried again.
                self.db()?.execute("UPDATE books SET thumb=cover WHERE hash=?1", [&hash]).map_err(|e| e.to_string())?;
                continue;
            };
            let thumb = self.root.join("covers").join(format!("{hash}.thumb.jpg"));
            fs::write(&thumb, &prepared.thumb).map_err(|e| e.to_string())?;
            let tint = serde_json::to_string(&prepared.tint).map_err(|e| e.to_string())?;
            self.db()?
                .execute("UPDATE books SET thumb=?2, tint=?3 WHERE hash=?1", params![hash, plain(&thumb), tint])
                .map_err(|e| e.to_string())?;
            done += 1;
        }
        Ok(done)
    }

    /// The bytes of a book, for Vera's reader: its file in the watched folder, only read, and only if it is still
    /// the book the catalogue knows.
    pub fn book_file(&self, hash: &str) -> Result<Vec<u8>> {
        let book = self.detail(hash)?.book;
        if let Some(problem) = book.problem {
            return Err(format!("Ce fichier ne peut pas être lu : {problem}"));
        }
        let path = Path::new(&book.path);
        let size = path.metadata().map_err(|_| "Fichier introuvable : Google Drive est-il lancé ?")?.len();
        if size > MAX_READ {
            return Err("Livre trop lourd pour être ouvert dans Vera.".into());
        }
        let bytes = fs::read(path).map_err(|e| format!("Lecture impossible : {e}"))?;
        if crate::util::hash_bytes(&bytes) != hash {
            return Err("Le fichier a changé depuis sa lecture ; Vera le relit, réessaie dans un instant.".into());
        }
        Ok(bytes)
    }

    /// Where the reader left a book, if it was opened in Vera.
    pub fn reading(&self, hash: &str) -> Result<Option<Reading>> {
        self.db()?
            .query_row("SELECT position, fraction, at FROM reading WHERE hash=?1", [hash], |r| {
                Ok(Reading { position: r.get(0)?, fraction: r.get(1)?, at: r.get(2)? })
            })
            .optional()
            .map_err(|e| e.to_string())
    }

    /// Keeps where the reader is in a book. Only Vera's catalogue is written; the Kobo's reading state is never
    /// touched.
    /// A book's highlights, in reading order.
    pub fn highlights(&self, hash: &str) -> Result<Vec<Highlight>> {
        let db = self.db()?;
        let mut q = db
            .prepare("SELECT id, position, text, color, note, fraction, created FROM highlights WHERE hash=?1 ORDER BY fraction, created")
            .map_err(|e| e.to_string())?;
        let rows = q
            .query_map([hash], |r| {
                Ok(Highlight { id: r.get(0)?, position: r.get(1)?, text: r.get(2)?, color: r.get(3)?, note: r.get(4)?, fraction: r.get(5)?, created: r.get(6)? })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<std::result::Result<_, _>>().map_err(|e| e.to_string())
    }

    /// Adds a highlight, or changes its colour or note.
    pub fn save_highlight(&self, hash: &str, h: &Highlight) -> Result<Highlight> {
        let clean = |s: &str| !s.contains('\0');
        if h.id.is_empty() || h.id.len() > 64 || !h.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
            || h.position.is_empty() || h.position.len() > 4096 || !clean(&h.position)
            || h.text.trim().is_empty() || h.text.len() > 20_000 || !clean(&h.text)
            || h.note.len() > 20_000 || !clean(&h.note)
            || !HIGHLIGHT_COLORS.contains(&h.color.as_str()) || !(0.0..=1.0).contains(&h.fraction)
        {
            return Err("Surlignage invalide.".into());
        }
        if !self.has_book(hash)? {
            return Err("Livre introuvable.".into());
        }
        let created = if h.created > 0 { h.created } else { now() };
        self.db()?
            .execute(
                "INSERT INTO highlights VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT(hash, id) DO UPDATE SET color=excluded.color, note=excluded.note",
                params![hash, h.id, h.position, h.text.trim(), h.color, h.note.trim(), h.fraction, created],
            )
            .map_err(|e| e.to_string())?;
        Ok(Highlight { created, text: h.text.trim().into(), note: h.note.trim().into(), ..h.clone() })
    }

    pub fn delete_highlight(&self, hash: &str, id: &str) -> Result<()> {
        self.db()?.execute("DELETE FROM highlights WHERE hash=?1 AND id=?2", params![hash, id]).map(|_| ()).map_err(|e| e.to_string())
    }

    pub fn save_reading(&self, hash: &str, position: &str, fraction: f64) -> Result<()> {
        if position.is_empty() || position.len() > 4096 || position.contains('\0') || !(0.0..=1.0).contains(&fraction) {
            return Err("Position de lecture invalide.".into());
        }
        if !self.has_book(hash)? {
            return Err("Livre introuvable.".into());
        }
        self.db()?
            .execute(
                "INSERT INTO reading VALUES(?1, ?2, ?3, ?4) ON CONFLICT(hash) DO UPDATE SET position=excluded.position, fraction=excluded.fraction, at=excluded.at",
                params![hash, position, fraction, now()],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    pub fn books(&self) -> Result<Vec<Book>> {
        self.books_where("", None)
    }

    /// The books with their collections: one per sub-folder holding books, with every level above it.
    pub fn library(&self) -> Result<Library> {
        let books = self.books()?;
        let mut names: Vec<String> = Vec::new();
        for name in books.iter().filter_map(|b| b.collection.as_ref()) {
            let parts: Vec<&str> = name.split(SEP).collect();
            for depth in 1..=parts.len() {
                let path = parts[..depth].join(SEP);
                if !names.contains(&path) {
                    names.push(path);
                }
            }
        }
        names.sort_by_key(|n| n.to_lowercase());
        let collections = names
            .iter()
            .map(|name| {
                let prefix = format!("{name}{SEP}");
                let count = books.iter().filter(|b| b.collection.as_deref() == Some(name)).count();
                let total = books
                    .iter()
                    .filter(|b| b.collection.as_deref().is_some_and(|c| c == name || c.starts_with(&prefix)))
                    .count();
                Collection {
                    label: name.rsplit(SEP).next().unwrap_or(name).to_string(),
                    parent: name.rsplit_once(SEP).map(|(p, _)| p.to_string()),
                    name: name.clone(),
                    count,
                    total,
                }
            })
            .collect();
        let mut books = books;
        let twins = self.twins(&books)?;
        for book in books.iter_mut() {
            book.twin = twins.iter().any(|group| group.contains(&book.hash));
        }
        Ok(Library { books, collections, twins })
    }

    /// Books that are probably the same work in two files (another edition, another format): same title and
    /// authors once case, accents and punctuation are set aside. Only reported, never removed; a group the owner
    /// dismissed is not reported again.
    fn twins(&self, books: &[Book]) -> Result<Vec<Vec<String>>> {
        let dismissed: Vec<String> = {
            let db = self.db()?;
            let mut stmt = db.prepare("SELECT key FROM twins_ok").map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |r| r.get(0)).map_err(|e| e.to_string())?;
            rows.collect::<std::result::Result<_, _>>().map_err(|e| e.to_string())?
        };
        let mut groups: HashMap<String, Vec<String>> = HashMap::new();
        for book in books.iter().filter(|b| b.problem.is_none()) {
            if let Some(key) = twin_key(&book.title, &book.authors) {
                groups.entry(key).or_default().push(book.hash.clone());
            }
        }
        let mut twins: Vec<Vec<String>> = groups
            .into_iter()
            .filter(|(key, group)| group.len() > 1 && !dismissed.contains(&dismissal(key, group)))
            .map(|(_, mut group)| {
                group.sort();
                group
            })
            .collect();
        twins.sort();
        Ok(twins)
    }

    /// « Ce ne sont pas des doublons »: this group, with exactly these files, is not reported again.
    pub fn dismiss_twins(&self, hashes: &[String]) -> Result<()> {
        let books = self.books()?;
        let group: Vec<&Book> = books.iter().filter(|b| hashes.contains(&b.hash)).collect();
        let key = group.first().and_then(|b| twin_key(&b.title, &b.authors)).ok_or("Livres introuvables.")?;
        let hashes: Vec<String> = group.iter().map(|b| b.hash.clone()).collect();
        self.db()?
            .execute("INSERT OR IGNORE INTO twins_ok VALUES(?1)", [dismissal(&key, &hashes)])
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    pub fn detail(&self, hash: &str) -> Result<Detail> {
        let book = self.books_where("WHERE b.hash=?1", Some(hash))?.pop().ok_or("Livre introuvable.")?;
        let (original, edit, revision): (String, Option<String>, Option<i64>) = self
            .db()?
            .query_row(
                "SELECT b.metadata, e.metadata, e.revision FROM books b LEFT JOIN edits e ON e.hash=b.hash WHERE b.hash=?1",
                [hash],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(|e| e.to_string())?;
        let original: Metadata = serde_json::from_str(&original).map_err(|e| e.to_string())?;
        let metadata = match edit {
            Some(edit) => serde_json::from_str(&edit).map_err(|e| e.to_string())?,
            None => original.clone(),
        };
        Ok(Detail { book, original, metadata, revision: revision.unwrap_or(0) })
    }

    /// Saves a corrected card. `expected` is the revision the user started from: a concurrent change is refused.
    pub fn save_edit(&self, hash: &str, metadata: Metadata, expected: i64) -> Result<i64> {
        validate(&metadata)?;
        let mut db = self.db()?;
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let original: String = tx
            .query_row("SELECT metadata FROM books WHERE hash=?1", [hash], |r| r.get(0))
            .map_err(|_| "Livre introuvable.")?;
        let revision: i64 = tx
            .query_row("SELECT revision FROM edits WHERE hash=?1", [hash], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or(0);
        if revision != expected {
            return Err("La fiche a changé entre-temps ; rouvre-la avant de la corriger.".into());
        }
        let json = serde_json::to_string(&metadata).map_err(|e| e.to_string())?;
        // Back to the file's own values: no correction left.
        if json == original {
            tx.execute("DELETE FROM edits WHERE hash=?1", [hash]).map_err(|e| e.to_string())?;
        } else {
            tx.execute(
                "INSERT INTO edits VALUES(?1, ?2, ?3, ?4) ON CONFLICT(hash) DO UPDATE SET metadata=excluded.metadata, revision=excluded.revision, at=excluded.at",
                params![hash, json, revision + 1, now()],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(revision + 1)
    }

    /// The correction to write into the copy sent to the Kobo, with its revision; None when the card is untouched.
    pub fn edit(&self, hash: &str) -> Result<Option<(Metadata, i64)>> {
        let row: Option<(String, i64)> = self
            .db()?
            .query_row("SELECT metadata, revision FROM edits WHERE hash=?1", [hash], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()
            .map_err(|e| e.to_string())?;
        row.map(|(json, revision)| Ok((serde_json::from_str(&json).map_err(|e| e.to_string())?, revision))).transpose()
    }

    /// The 1.x catalogue beside this one, if any: what it sent to each Kobo (so nothing is sent twice), the
    /// shelves it made, the corrected cards and the settings that still apply. The old file is only read.
    fn adopt_legacy(&self) -> Result<()> {
        let path = self.root.join(LEGACY);
        if !path.is_file() {
            return Ok(());
        }
        let uri = format!("file:{}?mode=ro", path.to_string_lossy().replace('\\', "/"));
        let old = Connection::open_with_flags(
            uri,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
        )
        .map_err(|e| format!("Ancien catalogue illisible : {e}"))?;
        let table = |name: &str| -> bool {
            old.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)", [name], |r| r.get(0))
                .unwrap_or(false)
        };
        let mut db = self.db()?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        if table("kobo_transfers") {
            let mut stmt = old
                .prepare("SELECT device_id, sha256, relative, at FROM kobo_transfers WHERE state IN ('copied','present') AND relative LIKE 'Vera/%'")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, i64>(3)?)))
                .map_err(|e| e.to_string())?;
            for row in rows.flatten() {
                tx.execute("INSERT OR IGNORE INTO transfers VALUES(?1, ?2, ?3, 0, ?4)", params![row.0, row.1, row.2, row.3])
                    .map_err(|e| e.to_string())?;
            }
        }
        if table("kobo_shelves") {
            let mut stmt = old.prepare("SELECT device_id, name FROM kobo_shelves").map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))).map_err(|e| e.to_string())?;
            for (device, name) in rows.flatten() {
                tx.execute("INSERT OR IGNORE INTO shelves VALUES(?1, ?2)", [device, name]).map_err(|e| e.to_string())?;
            }
        }
        if table("book_edits") && table("books") {
            let mut stmt = old
                .prepare("SELECT b.hash, e.json FROM book_edits e JOIN books b ON b.id=e.book_id")
                .map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))).map_err(|e| e.to_string())?;
            for (hash, json) in rows.flatten() {
                if let Ok(metadata) = serde_json::from_str::<Metadata>(&json) {
                    let json = serde_json::to_string(&metadata).map_err(|e| e.to_string())?;
                    tx.execute("INSERT OR IGNORE INTO edits VALUES(?1, ?2, 1, ?3)", params![hash, json, now()])
                        .map_err(|e| e.to_string())?;
                }
            }
        }
        if table("preferences") {
            let json: Option<String> = old.query_row("SELECT json FROM preferences WHERE id=1", [], |r| r.get(0)).optional().ok().flatten();
            if let Some(old) = json.and_then(|j| serde_json::from_str::<serde_json::Value>(&j).ok()) {
                let mut settings = Settings::default();
                if old["watch_enabled"] == true {
                    settings.watch_dir = old["watch_dir"].as_str().map(String::from);
                    settings.onboarded = settings.watch_dir.is_some();
                }
                settings.autostart = old["autostart"].as_bool().unwrap_or(true);
                settings.kobo_sync = old["kobo_sync"].as_bool().unwrap_or(true);
                let json = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
                tx.execute("UPDATE settings SET json=?1 WHERE id=1", [json]).map_err(|e| e.to_string())?;
            }
        }
        tx.execute("INSERT OR REPLACE INTO facts VALUES('legacy', ?1)", [now().to_string()]).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }
}

fn put_file(db: &Connection, path: &Path, stamp: Stamp, hash: &str) -> Result<()> {
    db.execute(
        "INSERT INTO files VALUES(?1, ?2, ?3, ?4) ON CONFLICT(path) DO UPDATE SET hash=excluded.hash, size=excluded.size, modified=excluded.modified",
        params![plain(path), hash, stamp.size as i64, stamp.modified],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// Title and authors reduced to what identifies a work: lower case, no accents or punctuation, authors in any
/// order (« Hugo, Victor » is « Victor Hugo »). None for titles too short to tell anything.
fn twin_key(title: &str, authors: &str) -> Option<String> {
    let words = |text: &str| -> Vec<String> {
        fold(text).split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(String::from).collect()
    };
    let title = words(title).join(" ");
    if title.chars().count() < 3 {
        return None;
    }
    let mut names = words(authors);
    names.sort();
    names.dedup();
    Some(format!("{title}|{}", names.join(" ")))
}

/// A dismissed group is remembered with its files: a third copy brings the question back.
fn dismissal(key: &str, hashes: &[String]) -> String {
    let mut hashes = hashes.to_vec();
    hashes.sort();
    format!("{key}|{}", hashes.join(","))
}

/// Lower case without the accents of the Latin alphabets.
fn fold(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .map(|c| match c {
            'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' => 'a',
            'ç' | 'ć' | 'č' => 'c',
            'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ę' | 'ě' => 'e',
            'ì' | 'í' | 'î' | 'ï' | 'ī' => 'i',
            'ñ' | 'ń' | 'ň' => 'n',
            'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' => 'o',
            'ù' | 'ú' | 'û' | 'ü' | 'ū' | 'ů' => 'u',
            'ý' | 'ÿ' => 'y',
            'š' | 'ś' => 's',
            'ž' | 'ź' | 'ż' => 'z',
            'ł' => 'l',
            'ř' => 'r',
            other => other,
        })
        .collect::<String>()
        .replace('œ', "oe")
        .replace('æ', "ae")
        .replace('ß', "ss")
}

/// A path as stored: without Windows' extended-length prefix.
pub fn plain(path: &Path) -> String {
    path.to_string_lossy().trim_start_matches(r"\\?\").to_string()
}

/// The collection of a file: its folder below the watched one, « A › B »; None at the root.
pub fn collection_of(root: &Path, file: &Path) -> Option<String> {
    // Compared the Windows way (case ignored, either slash), the folder names keep their own spelling.
    let root: Vec<String> = parts(root);
    let mut parent: Vec<String> = parts(file);
    parent.pop()?;
    let lower = |v: &[String]| v.iter().map(|p| p.to_lowercase()).collect::<Vec<_>>();
    if parent.len() < root.len() || lower(&parent[..root.len()]) != lower(&root) {
        return None;
    }
    let levels: Vec<String> = parent[root.len()..]
        .iter()
        .map(|l| l.replace('›', "-").trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    (!levels.is_empty()).then(|| levels.join(SEP))
}

fn parts(path: &Path) -> Vec<String> {
    plain(path).split(['/', '\\']).filter(|p| !p.is_empty()).map(String::from).collect()
}

fn validate(m: &Metadata) -> Result<()> {
    if m.title.trim().is_empty() {
        return Err("Le titre doit être renseigné.".into());
    }
    let limits = [(&m.title, 500), (&m.authors, 1000), (&m.language, 32), (&m.publisher, 500), (&m.published, 100), (&m.description, 20000)];
    if limits.iter().any(|(v, max)| v.chars().count() > *max || v.contains('\0')) {
        return Err("Information trop longue ou contenant un caractère interdit.".into());
    }
    if m.subjects.len() > 100 || m.subjects.iter().any(|s| s.chars().count() > 200 || s.contains('\0')) {
        return Err("Sujets trop nombreux ou trop longs.".into());
    }
    if m.isbn.as_ref().is_some_and(|i| crate::metadata::isbn(i).is_none()) {
        return Err("ISBN invalide : vérifie ses chiffres.".into());
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::metadata::inspect;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT: AtomicU64 = AtomicU64::new(0);
    pub struct Sandbox(pub PathBuf);
    impl Sandbox {
        pub fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("vera2-{}-{}-{}", std::process::id(), now(), NEXT.fetch_add(1, Ordering::Relaxed)));
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
        pub fn store(&self) -> Store {
            Store::open(self.0.join("data")).unwrap()
        }
    }
    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    pub fn fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures").join(name)
    }

    #[test]
    fn collections_follow_folders() {
        let root = Path::new("/livres");
        assert_eq!(collection_of(root, Path::new("/livres/a.epub")), None);
        assert_eq!(collection_of(root, Path::new("/livres/Classiques/Dumas/a.epub")).as_deref(), Some("Classiques › Dumas"));
        assert_eq!(collection_of(root, Path::new("/ailleurs/a.epub")), None);
        assert_eq!(collection_of(Path::new("G:\\Mon Drive\\Livres"), Path::new("g:\\mon drive\\livres\\Gothique\\a.epub")).as_deref(), Some("Gothique"));
        assert_eq!(collection_of(Path::new("/livres"), Path::new("/livres-bis/X/a.epub")), None);
    }

    #[test]
    fn a_book_is_its_file_and_leaves_the_list_with_its_last_copy() {
        let sandbox = Sandbox::new();
        let store = sandbox.store();
        let folder = sandbox.0.join("Livres");
        fs::create_dir_all(folder.join("Classiques/Dumas")).unwrap();
        let folder = PathBuf::from(plain(&fs::canonicalize(folder).unwrap()));
        let a = folder.join("Classiques/Dumas/a.epub");
        fs::copy(fixture("first.epub"), &a).unwrap();
        store.save_settings(Settings { watch_dir: Some(plain(&folder)), ..Settings::default() }).unwrap();
        let hash = crate::util::hash_file(&a).unwrap();
        store.add_book(&hash, &a, crate::util::stamp(&a).unwrap(), inspect(&a)).unwrap();
        let b = folder.join("A copie.epub");
        fs::copy(&a, &b).unwrap();
        store.place_file(&b, crate::util::stamp(&b).unwrap(), &hash).unwrap();
        let library = store.library().unwrap();
        assert_eq!(library.books.len(), 1);
        assert_eq!(library.books[0].collection.as_deref(), Some("Classiques › Dumas"), "the copy at the root does not take it out");
        let names: Vec<_> = library.collections.iter().map(|c| (c.name.as_str(), c.count, c.total)).collect();
        assert_eq!(names, vec![("Classiques", 0, 1), ("Classiques › Dumas", 1, 1)]);
        store.forget_file(&a).unwrap();
        assert_eq!(store.books().unwrap().len(), 1);
        store.forget_file(&b).unwrap();
        assert!(store.books().unwrap().is_empty());
        assert!(a.exists() && b.exists(), "the folder is never touched");
    }

    #[test]
    fn unreadable_files_are_listed_with_their_reason() {
        let sandbox = Sandbox::new();
        let store = sandbox.store();
        let broken = fixture("broken.epub");
        let hash = crate::util::hash_file(&broken).unwrap();
        store.add_book(&hash, &broken, crate::util::stamp(&broken).unwrap(), inspect(&broken)).unwrap();
        let book = &store.books().unwrap()[0];
        assert_eq!(book.title, "broken");
        assert!(book.problem.is_some());
    }

    #[test]
    fn corrections_are_versioned_and_can_be_undone() {
        let sandbox = Sandbox::new();
        let store = sandbox.store();
        let file = fixture("first.epub");
        let hash = crate::util::hash_file(&file).unwrap();
        store.add_book(&hash, &file, crate::util::stamp(&file).unwrap(), inspect(&file)).unwrap();
        let detail = store.detail(&hash).unwrap();
        let mut fixed = detail.metadata.clone();
        fixed.title = "Titre corrigé".into();
        assert_eq!(store.save_edit(&hash, fixed.clone(), 0).unwrap(), 1);
        assert!(store.save_edit(&hash, fixed.clone(), 0).is_err(), "stale revision refused");
        assert_eq!(store.books().unwrap()[0].title, "Titre corrigé");
        assert_eq!(store.edit(&hash).unwrap().unwrap().1, 1);
        store.save_edit(&hash, detail.original.clone(), 1).unwrap();
        assert!(store.edit(&hash).unwrap().is_none());
        let mut bad = detail.original;
        bad.isbn = Some("123".into());
        assert!(store.save_edit(&hash, bad, 0).is_err());
    }

    #[test]
    fn covers_get_thumbnails_and_colours_and_made_covers_never_replace_real_ones() {
        let sandbox = Sandbox::new();
        let store = sandbox.store();
        let epub = fixture("first.epub");
        let hash = crate::util::hash_file(&epub).unwrap();
        store.add_book(&hash, &epub, crate::util::stamp(&epub).unwrap(), inspect(&epub)).unwrap();
        let book = &store.books().unwrap()[0];
        assert!(book.thumb.as_ref().is_some_and(|t| Path::new(t).is_file()));
        assert_eq!(book.tint.len(), 2);
        let png = fs::read(store.books().unwrap()[0].cover.clone().unwrap()).unwrap();
        assert!(!store.set_made_cover(&hash, &png).unwrap(), "a real cover is kept");

        let pdf = fixture("sample.pdf");
        let pdf_hash = crate::util::hash_file(&pdf).unwrap();
        store.add_book(&pdf_hash, &pdf, crate::util::stamp(&pdf).unwrap(), inspect(&pdf)).unwrap();
        assert!(store.set_made_cover(&pdf_hash, &png).unwrap());
        let made = store.detail(&pdf_hash).unwrap().book;
        assert!(made.made_cover && made.thumb.is_some());
        assert!(store.set_made_cover(&pdf_hash, b"not a png").is_err());
    }

    #[test]
    fn books_without_a_cover_get_one_made_and_a_redrawn_one_after_a_correction() {
        let sandbox = Sandbox::new();
        let store = sandbox.store();
        let pdf = fixture("sample.pdf");
        let pdf_hash = crate::util::hash_file(&pdf).unwrap();
        store.add_book(&pdf_hash, &pdf, crate::util::stamp(&pdf).unwrap(), inspect(&pdf)).unwrap();
        // An EPUB read without its cover stands for one that has none.
        let epub = fixture("second.epub");
        let hash = crate::util::hash_file(&epub).unwrap();
        let mut read = inspect(&epub).unwrap();
        read.cover = None;
        store.add_book(&hash, &epub, crate::util::stamp(&epub).unwrap(), Ok(read)).unwrap();
        assert_eq!(store.make_covers(10).unwrap(), 2);
        assert_eq!(store.make_covers(10).unwrap(), 0, "made once");
        let book = store.detail(&hash).unwrap().book;
        assert!(book.made_cover && book.thumb.is_some() && book.tint.len() == 2);
        let first = book.cover.clone().unwrap();

        let mut card = store.detail(&hash).unwrap().metadata;
        card.title = "Un autre titre".into();
        store.save_edit(&hash, card, 0).unwrap();
        assert!(store.redraw_cover(&hash).unwrap());
        let redrawn = store.detail(&hash).unwrap().book.cover.unwrap();
        assert_ne!(redrawn, first, "a new address for the new image");
        assert!(!Path::new(&first).exists() && Path::new(&redrawn).exists(), "the old image is removed");
        assert!(!store.redraw_cover(&pdf_hash).unwrap(), "a PDF keeps its first page");
    }

    #[test]
    fn a_book_is_read_from_its_file_and_its_place_kept_in_the_catalogue() {
        let sandbox = Sandbox::new();
        let store = sandbox.store();
        let folder = sandbox.0.join("Livres");
        fs::create_dir_all(&folder).unwrap();
        let file = folder.join("a.epub");
        fs::copy(fixture("first.epub"), &file).unwrap();
        let hash = crate::util::hash_file(&file).unwrap();
        store.add_book(&hash, &file, crate::util::stamp(&file).unwrap(), inspect(&file)).unwrap();
        assert_eq!(store.book_file(&hash).unwrap(), fs::read(&file).unwrap());
        assert_eq!(crate::util::hash_file(&file).unwrap(), hash, "only read");

        assert!(store.reading(&hash).unwrap().is_none());
        assert_eq!(store.books().unwrap()[0].read, None);
        store.save_reading(&hash, "epubcfi(/6/4!/4/2/1:0)", 0.34).unwrap();
        store.save_reading(&hash, "epubcfi(/6/8!/4/2/1:0)", 0.5).unwrap();
        let place = store.reading(&hash).unwrap().unwrap();
        assert_eq!((place.position.as_str(), place.fraction), ("epubcfi(/6/8!/4/2/1:0)", 0.5));
        assert_eq!(store.books().unwrap()[0].read, Some(0.5));
        assert!(store.save_reading(&hash, "x", 1.5).is_err());
        assert!(store.save_reading(&hash, "", 0.1).is_err());
        assert!(store.save_reading("inconnu", "x", 0.1).is_err());

        // Highlights: kept in the catalogue, in reading order; colour and note can change; the file stays as it was.
        let mark = |id: &str, fraction: f64| Highlight { id: id.into(), position: format!("epubcfi(/6/4!/4/2,/1:{id},/1:9)"), text: " Un passage ".into(),
            color: "jaune".into(), note: String::new(), fraction, created: 0 };
        store.save_highlight(&hash, &mark("b2", 0.6)).unwrap();
        let first = store.save_highlight(&hash, &mark("a1", 0.2)).unwrap();
        assert_eq!(first.text, "Un passage");
        store.save_highlight(&hash, &Highlight { color: "bleu".into(), note: "À relire".into(), ..first.clone() }).unwrap();
        let all = store.highlights(&hash).unwrap();
        assert_eq!(all.iter().map(|h| h.id.as_str()).collect::<Vec<_>>(), ["a1", "b2"]);
        assert_eq!((all[0].color.as_str(), all[0].note.as_str(), all[0].created), ("bleu", "À relire", first.created));
        for bad in [Highlight { color: "rouge".into(), ..mark("c", 0.1) }, Highlight { text: "  ".into(), ..mark("d", 0.1) },
            Highlight { id: "../x".into(), ..mark("e", 0.1) }, Highlight { fraction: 2.0, ..mark("f", 0.1) }] {
            assert!(store.save_highlight(&hash, &bad).is_err());
        }
        assert!(store.save_highlight("inconnu", &mark("g", 0.1)).is_err());
        let md = store.annotations_markdown(&hash, "Titre", "Auteur").unwrap();
        assert!(md.contains("## Surlignés dans Vera") && md.contains("> Un passage") && md.contains("**Note :** À relire"));
        store.delete_highlight(&hash, "b2").unwrap();
        assert_eq!(store.highlights(&hash).unwrap().len(), 1);
        assert_eq!(crate::util::hash_file(&file).unwrap(), hash, "the file is never touched");

        // A file changed behind Vera's back is not shown as the book the catalogue knows.
        fs::write(&file, b"autre chose").unwrap();
        assert!(store.book_file(&hash).is_err());
        store.forget_file(&file).unwrap();
        assert!(store.reading(&hash).unwrap().is_none(), "the place leaves with the book");
    }

    #[test]
    fn reader_settings_stay_within_their_values() {
        let sandbox = Sandbox::new();
        let store = sandbox.store();
        let mut settings = store.settings().unwrap();
        assert_eq!(settings.reader, ReaderSettings::default());
        settings.reader = ReaderSettings { size: 24, theme: "nuit".into(), font: "sans".into() };
        assert_eq!(store.save_settings(settings.clone()).unwrap().reader.theme, "nuit");
        for bad in [ReaderSettings { size: 80, ..ReaderSettings::default() }, ReaderSettings { theme: "rose".into(), ..ReaderSettings::default() }] {
            assert!(store.save_settings(Settings { reader: bad, ..settings.clone() }).is_err());
        }
        // Settings saved before the reader existed are read with its defaults.
        let old: Settings = serde_json::from_str(r#"{"watchDir":null,"accent":"blue"}"#).unwrap();
        assert_eq!(old.reader, ReaderSettings::default());
        // ... and with the first theme, keeping their accent.
        assert_eq!((old.theme.as_str(), old.accent.as_str()), ("vera", "blue"));
        let themed = store.save_settings(Settings { theme: "papier".into(), accent: "maison".into(), ..settings.clone() }).unwrap();
        assert_eq!((themed.theme.as_str(), themed.accent.as_str()), ("papier", "maison"));
        assert!(store.save_settings(Settings { theme: "rose".into(), ..settings.clone() }).is_err());
    }

    #[test]
    fn share_settings_keep_no_secret_and_the_last_recipients_first() {
        let sandbox = Sandbox::new();
        let store = sandbox.store();
        let mut settings = store.settings().unwrap();
        settings.share.mail = crate::share::provider("toi@gmail.com");
        settings.share.channels = vec![Channel { id: "c1".into(), name: "#livres · Serveur des amis".into() }];
        store.save_settings(settings.clone()).unwrap();
        store.remember_recipients(&["paul@exemple.fr".into()]).unwrap();
        store.remember_recipients(&["lea@exemple.fr".into(), "PAUL@exemple.fr".into()]).unwrap();
        assert_eq!(store.settings().unwrap().share.recent, vec!["lea@exemple.fr", "PAUL@exemple.fr"]);
        let json: String = store.db().unwrap().query_row("SELECT json FROM settings", [], |r| r.get(0)).unwrap();
        assert!(!json.to_lowercase().contains("password") && !json.contains("webhooks"), "no secret in the catalogue");
        settings.share.channels[0].id = "../x".into();
        assert!(store.save_settings(settings).is_err());
    }

    #[test]
    fn probable_duplicates_are_reported_until_dismissed() {
        assert_eq!(twin_key("Les Misérables", "Victor Hugo"), twin_key("LES MISERABLES !", "Hugo, Victor"));
        assert_ne!(twin_key("Les Misérables", "Victor Hugo"), twin_key("Les Misérables 2", "Victor Hugo"));
        assert_eq!(twin_key("Œuvre", ""), twin_key("oeuvre", ""));
        assert_eq!(twin_key("A", "X"), None);
        let sandbox = Sandbox::new();
        let store = sandbox.store();
        let a = fixture("first.epub");
        let b = fixture("representative.epub");
        for file in [&a, &b] {
            let mut read = inspect(file).unwrap();
            read.metadata.title = "Le Comte de Monte-Cristo".into();
            read.metadata.authors = if file == &a { "Alexandre Dumas".into() } else { "Dumas, Alexandre".into() };
            store.add_book(&crate::util::hash_file(file).unwrap(), file, crate::util::stamp(file).unwrap(), Ok(read)).unwrap();
        }
        let library = store.library().unwrap();
        assert_eq!(library.twins.len(), 1);
        assert!(library.books.iter().all(|b| b.twin));
        store.dismiss_twins(&library.twins[0]).unwrap();
        let library = store.library().unwrap();
        assert!(library.twins.is_empty() && library.books.iter().all(|b| !b.twin));
    }

    #[test]
    fn a_catalogue_of_essai_1_gets_its_thumbnails_later() {
        let sandbox = Sandbox::new();
        let store = sandbox.store();
        let epub = fixture("first.epub");
        let hash = crate::util::hash_file(&epub).unwrap();
        store.add_book(&hash, &epub, crate::util::stamp(&epub).unwrap(), inspect(&epub)).unwrap();
        // As written by the first version of the schema.
        let db = store.db().unwrap();
        db.execute_batch("UPDATE books SET thumb=NULL, tint=NULL; PRAGMA user_version=1;").unwrap();
        drop(db);
        let store = Store::open(store.root.clone()).unwrap();
        assert!(store.books().unwrap()[0].thumb.is_none());
        assert_eq!(store.refresh_thumbs(10).unwrap(), 1);
        assert_eq!(store.refresh_thumbs(10).unwrap(), 0);
        assert!(store.books().unwrap()[0].thumb.is_some());
    }

    #[test]
    fn the_old_catalogue_is_read_once_and_left_untouched() {
        let sandbox = Sandbox::new();
        let data = sandbox.0.join("data");
        fs::create_dir_all(&data).unwrap();
        let legacy = data.join(LEGACY);
        {
            let old = Connection::open(&legacy).unwrap();
            old.execute_batch(
                "CREATE TABLE books(id INTEGER PRIMARY KEY, hash TEXT);
                 CREATE TABLE book_edits(book_id INTEGER PRIMARY KEY, json TEXT);
                 CREATE TABLE kobo_transfers(book_id INTEGER, device_id TEXT, sha256 TEXT, relative TEXT, state TEXT, at INTEGER);
                 CREATE TABLE kobo_shelves(device_id TEXT, name TEXT);
                 CREATE TABLE preferences(id INTEGER PRIMARY KEY, json TEXT);
                 INSERT INTO books VALUES(1, 'h1');
                 INSERT INTO book_edits VALUES(1, '{\"title\":\"Corrigé\",\"authors\":\"A\",\"language\":\"fr\",\"isbn\":null,\"publisher\":\"\",\"published\":\"\",\"subjects\":[],\"description\":\"\"}');
                 INSERT INTO kobo_transfers VALUES(1, 'dev', 'h1', 'Vera/h1.kepub.epub', 'copied', 5);
                 INSERT INTO kobo_transfers VALUES(1, 'dev', 'x', 'Livres/x.epub', 'origin', 5);
                 INSERT INTO kobo_shelves VALUES('dev', 'Classiques');
                 INSERT INTO preferences VALUES(1, '{\"watch_dir\":\"G:\\\\Livres\",\"watch_enabled\":true,\"autostart\":false,\"kobo_sync\":true}');",
            )
            .unwrap();
        }
        let before = crate::util::hash_file(&legacy).unwrap();
        let store = Store::open(data.clone()).unwrap();
        let db = store.db().unwrap();
        let count = |sql: &str| db.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap();
        assert_eq!(count("SELECT count(*) FROM transfers"), 1);
        assert_eq!(count("SELECT count(*) FROM shelves"), 1);
        assert_eq!(count("SELECT count(*) FROM edits"), 1);
        let settings = store.settings().unwrap();
        assert_eq!(settings.watch_dir.as_deref(), Some("G:\\Livres"));
        assert!(!settings.autostart && settings.onboarded);
        assert_eq!(crate::util::hash_file(&legacy).unwrap(), before);
        drop(db);
        // Opened again: nothing is imported twice.
        let store = Store::open(data).unwrap();
        assert_eq!(store.db().unwrap().query_row("SELECT count(*) FROM transfers", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
    }
}
