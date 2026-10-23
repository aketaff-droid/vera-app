//! One synchronisation, at each plug: every readable book of the list that the Kobo does not have goes to
//! `Vera/<sha256>.kepub.epub|epub|pdf`, then the shelves follow the collections. The folder is the reference
//! (docs/DECISIONS.md, section N): a book deleted on the Kobo but still in the folder is sent again, and Vera's
//! copies of books that left the folder a day ago or more are listed — they are removed only when the owner
//! confirms. Nothing else on the Kobo is ever deleted.
use crate::{
    edit, kepub,
    shelves::{self, ShelfReport, MAX_NAME, ONBOARD},
    store::{Book, Store},
    util::{free_space, hash_file, now, stamp},
    Result,
};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use std::{
    collections::{BTreeMap, HashMap},
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};

/// Room kept free on the liseuse after each copy.
const MARGIN: u64 = 16 * 1024 * 1024;
const NAMES: [&str; 3] = ["kepub.epub", "epub", "pdf"];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    #[serde(skip)]
    pub root: PathBuf,
    pub id: String,
    pub firmware: String,
    pub model: String,
}

/// The liseuse mounted at `root`, from its `.kobo/version` file (serial, …, firmware, …, model id).
pub fn identify(root: &Path) -> Result<Device> {
    let version = root.join(".kobo").join("version");
    if version.metadata().map_err(|_| "Ce n’est pas une Kobo.")?.len() > 16 * 1024 || !shelves::catalogue(root).is_file() {
        return Err("Ce n’est pas une Kobo.".into());
    }
    let text = fs::read_to_string(&version).map_err(|e| e.to_string())?;
    let fields: Vec<&str> = text.trim().split(',').collect();
    if fields.len() < 3 || fields[0].is_empty() {
        return Err("Identité Kobo incomplète.".into());
    }
    let model = match fields.last().copied() {
        Some("00000000-0000-0000-0000-000000000393") => "Kobo Clara Colour",
        _ => "Kobo",
    };
    Ok(Device { root: root.to_path_buf(), id: crate::util::hash_bytes(fields[0].as_bytes()), firmware: fields[2].to_string(), model: model.into() })
}

/// The Kobo plugged into this PC, if any.
pub fn find() -> Option<PathBuf> {
    if cfg!(windows) {
        (b'D'..=b'Z').map(|l| PathBuf::from(format!("{}:\\", l as char))).find(|r| identify(r).is_ok())
    } else {
        None
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "stage", rename_all = "camelCase")]
pub enum Step {
    Reading,
    #[serde(rename_all = "camelCase")]
    Sending { index: usize, total: usize, title: String, done: u64, size: u64 },
    Shelves,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Outcome {
    Copied,
    Updated,
    NoSpace,
    Failed,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sent {
    pub hash: String,
    pub title: String,
    pub outcome: Outcome,
    pub bytes: u64,
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub device: String,
    pub model: String,
    pub at: i64,
    pub results: Vec<Sent>,
    /// Books already on the liseuse.
    pub present: usize,
    /// Books deleted on the liseuse but still in the folder: sent again.
    pub resent: usize,
    /// Vera's copies whose book left the folder a day ago or more: removed if the owner confirms.
    pub removable: Vec<Removable>,
    /// Bytes missing for the books that did not fit.
    pub missing_bytes: u64,
    pub free_bytes: u64,
    pub shelves: Option<ShelfReport>,
    pub shelves_error: Option<String>,
}

impl Report {
    pub fn count(&self, outcome: Outcome) -> usize {
        self.results.iter().filter(|r| r.outcome == outcome).count()
    }
}

pub struct Options {
    pub kepubify: Option<PathBuf>,
    pub replace_edited: bool,
}

enum Action {
    Present(String),
    Send,
    Resend,
    Update(String),
}

enum Failure {
    NoSpace(u64),
    Other(String),
}

/// Hashes of the EPUB and PDF files on the liseuse outside Vera's folder, by hash → path from the root.
/// Hashes are cached by size and date: a plug does not read the whole liseuse again.
fn inventory(store: &Store, device: &Device) -> Result<HashMap<String, String>> {
    let db = store.db()?;
    let mut cached: HashMap<String, (i64, i64, String)> = HashMap::new();
    {
        let mut stmt = db.prepare("SELECT relative, size, modified, hash FROM device_files WHERE device=?1").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([&device.id], |r| Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?, r.get(3)?)))).map_err(|e| e.to_string())?;
        for row in rows {
            let (relative, value) = row.map_err(|e| e.to_string())?;
            cached.insert(relative, value);
        }
    }
    let mut found = HashMap::new();
    let mut seen = Vec::new();
    let mut pending = vec![device.root.clone()];
    while let Some(dir) = pending.pop() {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let path = entry.path();
            let Ok(meta) = path.symlink_metadata() else { continue };
            if name.starts_with('.') || name == "System Volume Information" || meta.file_type().is_symlink() {
                continue;
            }
            let relative = path.strip_prefix(&device.root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
            if meta.is_dir() {
                if relative != "Vera" {
                    pending.push(path);
                }
                continue;
            }
            if !crate::scan::is_book(&path) {
                continue;
            }
            let Ok(s) = stamp(&path) else { continue };
            let hash = match cached.get(&relative) {
                Some((size, modified, hash)) if *size == s.size as i64 && *modified == s.modified => hash.clone(),
                _ => {
                    let Ok(hash) = hash_file(&path) else { continue };
                    db.execute(
                        "INSERT OR REPLACE INTO device_files VALUES(?1, ?2, ?3, ?4, ?5)",
                        params![device.id, relative, s.size as i64, s.modified, hash],
                    )
                    .map_err(|e| e.to_string())?;
                    hash
                }
            };
            seen.push(relative.clone());
            found.insert(hash, relative);
        }
    }
    let stale: Vec<&String> = cached.keys().filter(|r| !seen.contains(r)).collect();
    for relative in stale {
        db.execute("DELETE FROM device_files WHERE device=?1 AND relative=?2", params![device.id, relative]).map_err(|e| e.to_string())?;
    }
    Ok(found)
}

fn named(device: &Device, hash: &str) -> Option<String> {
    NAMES.iter().map(|ext| format!("Vera/{hash}.{ext}")).find(|r| device.root.join(r).is_file())
}

fn transfer_row(store: &Store, device: &str, hash: &str) -> Result<Option<i64>> {
    store
        .db()?
        .query_row("SELECT revision FROM transfers WHERE device=?1 AND hash=?2", [device, hash], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())
}

fn record(store: &Store, device: &str, hash: &str, relative: &str, revision: i64) -> Result<()> {
    store
        .db()?
        .execute(
            "INSERT INTO transfers VALUES(?1, ?2, ?3, ?4, ?5) ON CONFLICT(device, hash) DO UPDATE SET relative=excluded.relative, revision=excluded.revision, at=excluded.at",
            params![device, hash, relative, revision, now()],
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn plan(store: &Store, device: &Device, books: &[Book], options: &Options) -> Result<Vec<Action>> {
    let hashes = inventory(store, device)?;
    let mut actions = Vec::new();
    for book in books {
        let sent = transfer_row(store, &device.id, &book.hash)?;
        let action = if let Some(relative) = named(device, &book.hash) {
            let revision = store.edit(&book.hash)?.map(|(_, r)| r).unwrap_or(0);
            match sent {
                None => {
                    record(store, &device.id, &book.hash, &relative, 0)?;
                    if options.replace_edited && revision > 0 { Action::Update(relative) } else { Action::Present(relative) }
                }
                Some(done) if options.replace_edited && revision > done => Action::Update(relative),
                Some(_) => Action::Present(relative),
            }
        } else if let Some(relative) = hashes.get(&book.hash) {
            Action::Present(relative.clone())
        } else if sent.is_some() {
            // Sent before, deleted there since: the folder decides, it goes back.
            Action::Resend
        } else {
            Action::Send
        };
        actions.push(action);
    }
    Ok(actions)
}

/// The books that will leave at the next plug of the liseuse `device` (from what Vera last saw of it).
pub fn waiting(store: &Store, device: &str) -> Result<Vec<String>> {
    let db = store.db()?;
    let mut stmt = db
        .prepare(
            "SELECT b.hash FROM books b WHERE b.problem IS NULL
               AND NOT EXISTS(SELECT 1 FROM transfers t WHERE t.device=?1 AND t.hash=b.hash)
               AND NOT EXISTS(SELECT 1 FROM device_files d WHERE d.device=?1 AND d.hash=b.hash)",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([device], |r| r.get(0)).map_err(|e| e.to_string())?;
    rows.collect::<std::result::Result<_, _>>().map_err(|e| e.to_string())
}

/// Synchronises the liseuse. A book that fails never stops the others; an unplugged liseuse stops everything.
pub fn sync(store: &Store, device: &Device, options: &Options, progress: &dyn Fn(Step)) -> Result<Report> {
    progress(Step::Reading);
    let library = store.library()?;
    let books: Vec<Book> = library.books.iter().filter(|b| b.problem.is_none()).cloned().collect();
    let actions = plan(store, device, &books, options)?;
    let mut report = Report { device: device.id.clone(), model: device.model.clone(), at: now(), ..Report::default() };
    let mut where_is: HashMap<String, String> = HashMap::new();
    let todo: Vec<usize> = actions.iter().enumerate().filter(|(_, a)| matches!(a, Action::Send | Action::Resend | Action::Update(_))).map(|(i, _)| i).collect();
    for (i, action) in actions.iter().enumerate() {
        match action {
            Action::Present(relative) => {
                report.present += 1;
                where_is.insert(books[i].hash.clone(), relative.clone());
            }
            Action::Resend => report.resent += 1,
            _ => {}
        }
    }
    for (index, &i) in todo.iter().enumerate() {
        let book = &books[i];
        let update = matches!(actions[i], Action::Update(_));
        let step = |done: u64, size: u64| progress(Step::Sending { index, total: todo.len(), title: book.title.clone(), done, size });
        match send(store, device, book, options, update, &step) {
            Ok((relative, bytes)) => {
                where_is.insert(book.hash.clone(), relative);
                let outcome = if update { Outcome::Updated } else { Outcome::Copied };
                report.results.push(Sent { hash: book.hash.clone(), title: book.title.clone(), outcome, bytes, detail: None });
            }
            Err(failure) => {
                if !device.root.join(".kobo").join("version").exists() {
                    return Err("Kobo débranchée pendant la copie. Rien n’est abîmé : on reprendra au prochain branchement.".into());
                }
                if let Action::Update(relative) = &actions[i] {
                    where_is.insert(book.hash.clone(), relative.clone());
                }
                let (outcome, detail) = match failure {
                    Failure::NoSpace(missing) => {
                        report.missing_bytes += missing;
                        (Outcome::NoSpace, None)
                    }
                    Failure::Other(error) => (Outcome::Failed, Some(error)),
                };
                report.results.push(Sent { hash: book.hash.clone(), title: book.title.clone(), outcome, bytes: 0, detail });
            }
        }
    }
    report.free_bytes = free_space(&device.root).unwrap_or(0);

    progress(Step::Shelves);
    let mut wanted: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for collection in library.collections.iter().filter(|c| c.count > 0 && c.name.chars().count() <= MAX_NAME) {
        wanted.insert(collection.name.clone(), Vec::new());
    }
    for book in &books {
        if let (Some(collection), Some(relative)) = (&book.collection, where_is.get(&book.hash)) {
            if let Some(ids) = wanted.get_mut(collection) {
                ids.push(format!("{ONBOARD}{relative}"));
            }
        }
    }
    let managed: Vec<String> = {
        let db = store.db()?;
        let mut stmt = db.prepare("SELECT name FROM shelves WHERE device=?1").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([&device.id], |r| r.get(0)).map_err(|e| e.to_string())?;
        rows.collect::<std::result::Result<_, _>>().map_err(|e| e.to_string())?
    };
    match shelves::apply(&device.root, &store.root.join("backups"), &wanted, &managed) {
        Ok(shelf_report) => {
            let mut db = store.db()?;
            let tx = db.transaction().map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM shelves WHERE device=?1", [&device.id]).map_err(|e| e.to_string())?;
            for name in wanted.keys() {
                tx.execute("INSERT INTO shelves VALUES(?1, ?2)", [&device.id, name]).map_err(|e| e.to_string())?;
            }
            tx.commit().map_err(|e| e.to_string())?;
            report.shelves = Some(shelf_report);
        }
        // The copies already made stay; shelves are tried again at the next plug.
        Err(error) => report.shelves_error = Some(unknown_format(error)),
    }
    // Where each book is on the liseuse, and its highlights: read only, kept in Vera. A catalogue Vera cannot read
    // (a firmware change) costs only this.
    let _ = snapshot_reading(store, device);
    report.removable = removable(store, device, now())?;
    let json = serde_json::to_string(&report).map_err(|e| e.to_string())?;
    store.set_fact(&format!("sync:{}", device.id), &json)?;
    store.log_sync(report.at, &json)?;
    store.set_fact("device", &device.id)?;
    Ok(report)
}

/// Copies, from the liseuse's catalogue opened read-only, where each of Vera's books is (percentage, status) and its
/// highlights and notes. Nothing is written on the Kobo; annotations are kept in Vera even after a book leaves.
pub fn snapshot_reading(store: &Store, device: &Device) -> Result<usize> {
    let path = shelves::catalogue(&device.root);
    shelves::no_journal(&path)?;
    let kobo = rusqlite::Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())?;
    let hash_of = |content: &str| -> Option<String> {
        let name = content.strip_prefix(&format!("{ONBOARD}Vera/"))?;
        let hash = name.split('.').next()?;
        (hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit())).then(|| hash.to_string())
    };
    let readings: Vec<(String, i64, i64, Option<String>)> = {
        let mut stmt = kobo
            .prepare("SELECT ContentID, coalesce(___PercentRead, 0), coalesce(ReadStatus, 0), DateLastRead FROM content WHERE ContentType=6 AND ContentID LIKE ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([format!("{ONBOARD}Vera/%")], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).map_err(|e| e.to_string())?;
        rows.collect::<std::result::Result<_, _>>().map_err(|e| e.to_string())?
    };
    let notes: Vec<(String, String, String, String, f64, String, String)> = {
        let mut stmt = kobo
            .prepare(
                "SELECT BookmarkID, VolumeID, coalesce(Text, ''), coalesce(Annotation, ''), coalesce(ChapterProgress, 0), coalesce(DateCreated, ''), coalesce(Type, '')
                 FROM Bookmark WHERE VolumeID LIKE ?1 AND coalesce(Hidden, 'false') IN (0, 'false')",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([format!("{ONBOARD}Vera/%")], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)))
            .map_err(|e| e.to_string())?;
        rows.collect::<std::result::Result<_, _>>().map_err(|e| e.to_string())?
    };
    let mut db = store.db()?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM kobo_reading WHERE device=?1", [&device.id]).map_err(|e| e.to_string())?;
    for (content, percent, status, last) in readings {
        if let Some(hash) = hash_of(&content) {
            tx.execute(
                "INSERT OR REPLACE INTO kobo_reading VALUES(?1, ?2, ?3, ?4, ?5)",
                params![device.id, hash, percent.clamp(0, 100), status.clamp(0, 2), last],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    let mut kept = 0;
    for (id, volume, text, note, progress, created, kind) in notes {
        let Some(hash) = hash_of(&volume) else { continue };
        if text.trim().is_empty() && note.trim().is_empty() {
            continue;
        }
        tx.execute(
            "INSERT INTO annotations VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(device, id) DO UPDATE SET text=excluded.text, note=excluded.note, progress=excluded.progress",
            params![device.id, id, hash, text, note, progress.clamp(0.0, 1.0), created, kind],
        )
        .map_err(|e| e.to_string())?;
        kept += 1;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(kept)
}

/// A book leaves the Kobo only after it has been out of the folder this long (a Drive glitch, a move done in two
/// steps, a folder renamed and renamed back do not cost a book).
pub const LEAVE_AFTER: i64 = 24 * 3600;

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Removable {
    pub hash: String,
    pub title: String,
    pub authors: String,
    /// Its path on the liseuse, « Vera/<sha256>.kepub.epub ».
    pub relative: String,
    pub size: u64,
    /// When it left the folder.
    pub left_at: i64,
    /// How far it was read on the Kobo (its progress leaves with it).
    pub percent: Option<u8>,
    /// Highlights and notes kept in Vera.
    pub notes: usize,
}

/// Vera's copies on this liseuse whose book left the folder at least `LEAVE_AFTER` before `at`. Only files Vera put
/// in its own folder of the liseuse are ever listed.
pub fn removable(store: &Store, device: &Device, at: i64) -> Result<Vec<Removable>> {
    let db = store.db()?;
    // Copies sent before departures were recorded (or by Vera 1.x) start their day now.
    db.execute(
        "INSERT OR IGNORE INTO departed(hash, at, title, authors)
         SELECT t.hash, ?2, '', '' FROM transfers t
         WHERE t.device=?1 AND t.relative LIKE 'Vera/%' AND NOT EXISTS(SELECT 1 FROM books b WHERE b.hash=t.hash)",
        params![device.id, at],
    )
    .map_err(|e| e.to_string())?;
    let rows: Vec<(String, String, i64, String, String)> = {
        let mut stmt = db
            .prepare(
                "SELECT t.hash, t.relative, d.at, d.title, d.authors FROM transfers t JOIN departed d ON d.hash=t.hash
                 WHERE t.device=?1 AND t.relative LIKE 'Vera/%' AND d.at<=?2 AND NOT EXISTS(SELECT 1 FROM books b WHERE b.hash=t.hash)
                 ORDER BY d.at, t.hash",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![device.id, at - LEAVE_AFTER], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))).map_err(|e| e.to_string())?;
        rows.collect::<std::result::Result<_, _>>().map_err(|e| e.to_string())?
    };
    let mut out = Vec::new();
    for (hash, _, left_at, title, authors) in rows {
        // The copy as it is on the liseuse now (an EPUB may have become a KEPUB).
        let Some(relative) = named(device, &hash) else { continue };
        let path = device.root.join(&relative);
        let size = path.metadata().map(|m| m.len()).unwrap_or(0);
        let (title, authors) = if title.is_empty() {
            match crate::metadata::inspect(&path) {
                Ok(read) => (read.metadata.title, read.metadata.authors),
                Err(_) => (relative.clone(), String::new()),
            }
        } else {
            (title, authors)
        };
        let percent: Option<i64> = db
            .query_row("SELECT percent FROM kobo_reading WHERE device=?1 AND hash=?2", params![device.id, hash], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        let notes: i64 = db.query_row("SELECT count(*) FROM annotations WHERE hash=?1", [&hash], |r| r.get(0)).map_err(|e| e.to_string())?;
        out.push(Removable { hash, title, authors, relative, size, left_at, percent: percent.map(|p| p.clamp(0, 100) as u8), notes: notes as usize });
    }
    Ok(out)
}

/// Removes from the liseuse the copies the owner confirmed, if they are still removable; returns how many went.
/// Only `Vera/<sha256>.*` files are deleted; a book that comes back to the folder will be sent again.
pub fn remove(store: &Store, device: &Device, hashes: &[String], at: i64) -> Result<usize> {
    let allowed = removable(store, device, at)?;
    let folder = device.root.join("Vera");
    let mut removed = 0;
    for item in allowed.iter().filter(|r| hashes.contains(&r.hash)) {
        let path = device.root.join(&item.relative);
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        if path.parent() != Some(folder.as_path()) || !name.starts_with(&format!("{}.", item.hash)) {
            continue;
        }
        fs::remove_file(&path).map_err(|e| format!("« {} » n’a pas pu être retiré : {e}", item.title))?;
        store
            .db()?
            .execute("DELETE FROM transfers WHERE device=?1 AND hash=?2", params![device.id, item.hash])
            .map_err(|e| e.to_string())?;
        removed += 1;
    }
    // A departure no liseuse still holds is forgotten.
    store
        .db()?
        .execute("DELETE FROM departed WHERE NOT EXISTS(SELECT 1 FROM transfers t WHERE t.hash=departed.hash)", [])
        .map_err(|e| e.to_string())?;
    Ok(removed)
}

/// A Kobo update that changed its catalogue is said plainly: nothing was written (shelves.rs checks before it
/// writes), the books themselves were sent.
fn unknown_format(error: String) -> String {
    let lower = error.to_lowercase();
    if lower.contains("no such column") || lower.contains("no such table") || lower.contains("has no column") {
        "la Kobo utilise un format de catalogue que Vera ne connaît pas encore (mise à jour de la liseuse ?). Rien n’y a été modifié ; les livres sont bien envoyés, seules les étagères attendent une nouvelle version de Vera.".into()
    } else {
        error
    }
}

/// The latest report for a liseuse, as saved by `sync`.
pub fn last_report(store: &Store, device: &str) -> Result<Option<serde_json::Value>> {
    Ok(store.fact(&format!("sync:{device}"))?.and_then(|json| serde_json::from_str(&json).ok()))
}

struct Workspace(PathBuf);
impl Drop for Workspace {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn send(store: &Store, device: &Device, book: &Book, options: &Options, update: bool, step: &dyn Fn(u64, u64)) -> std::result::Result<(String, u64), Failure> {
    let other = Failure::Other;
    let source = PathBuf::from(&book.path);
    if hash_file(&source).map_err(other)? != book.hash {
        return Err(Failure::Other("Le fichier a changé depuis sa lecture ; il partira au prochain branchement.".into()));
    }
    let work = Workspace(store.root.join("staging").join(format!("{}-{}", &book.hash[..16], now())));
    fs::create_dir_all(&work.0).map_err(|e| Failure::Other(e.to_string()))?;
    let edit = store.edit(&book.hash).map_err(other)?;
    let base = edit::corrected_copy(store, book, &work.0).map_err(other)?;
    let (artifact, ext) = match (book.format.as_str(), &options.kepubify) {
        ("epub", Some(tool)) => {
            let kepub = work.0.join("livre.kepub.epub");
            match kepub::convert(tool, &base, &kepub) {
                Ok(()) => (kepub, "kepub.epub"),
                Err(_) => (base.clone(), "epub"),
            }
        }
        ("epub", None) => (base.clone(), "epub"),
        _ => (base.clone(), "pdf"),
    };
    let size = artifact.metadata().map_err(|e| Failure::Other(e.to_string()))?.len();
    let free = free_space(&device.root).map_err(other)?;
    if free < size + MARGIN {
        return Err(Failure::NoSpace(size + MARGIN - free));
    }
    let folder = device.root.join("Vera");
    fs::create_dir_all(&folder).map_err(|e| Failure::Other(e.to_string()))?;
    let relative = format!("Vera/{}.{ext}", book.hash);
    let target = device.root.join(&relative);
    let partial = PathBuf::from(format!("{}.vera-part", target.display()));
    // Only Vera ever writes this name, and the firmware never imports it.
    let _ = fs::remove_file(&partial);
    let expected = hash_file(&artifact).map_err(other)?;
    copy(&artifact, &partial, size, step).map_err(|e| {
        let _ = fs::remove_file(&partial);
        Failure::Other(e)
    })?;
    if hash_file(&partial).map_err(other)? != expected {
        let _ = fs::remove_file(&partial);
        return Err(Failure::Other("Copie incomplète sur la Kobo ; elle sera refaite au prochain branchement.".into()));
    }
    // Vera's own previous copies of this book (an update, or an EPUB that became a KEPUB) give way.
    for old in NAMES.iter().map(|e| device.root.join(format!("Vera/{}.{e}", book.hash))) {
        if old.is_file() && (update || old != target) {
            fs::remove_file(&old).map_err(|e| Failure::Other(e.to_string()))?;
        }
    }
    fs::rename(&partial, &target).map_err(|e| Failure::Other(e.to_string()))?;
    let revision = edit.map(|(_, r)| r).unwrap_or(0);
    record(store, &device.id, &book.hash, &relative, revision).map_err(other)?;
    Ok((relative, size))
}

fn copy(from: &Path, to: &Path, size: u64, step: &dyn Fn(u64, u64)) -> Result<()> {
    let mut input = File::open(from).map_err(|e| e.to_string())?;
    let mut output = File::options().write(true).create_new(true).open(to).map_err(|e| e.to_string())?;
    let mut buffer = vec![0; 256 * 1024];
    let mut done = 0;
    step(0, size);
    loop {
        let n = input.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        output.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
        done += n as u64;
        step(done, size);
    }
    output.sync_all().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        scan::Watcher,
        shelves::tests::{device as simulated, import},
        store::{plain, tests::{fixture, Sandbox}, Settings},
    };

    struct Setup {
        sandbox: Sandbox,
        store: Store,
        folder: PathBuf,
        kobo: Device,
    }

    fn setup() -> Setup {
        let sandbox = Sandbox::new();
        let store = sandbox.store();
        let folder = sandbox.0.join("Mes livres");
        fs::create_dir_all(folder.join("Classiques/Dumas")).unwrap();
        fs::copy(fixture("first.epub"), folder.join("Classiques/a.epub")).unwrap();
        fs::copy(fixture("second.epub"), folder.join("Classiques/Dumas/b.epub")).unwrap();
        fs::copy(fixture("sample.pdf"), folder.join("c.pdf")).unwrap();
        fs::copy(fixture("broken.epub"), folder.join("abime.epub")).unwrap();
        store.save_settings(Settings { watch_dir: Some(plain(&folder)), ..Settings::default() }).unwrap();
        let mut watcher = Watcher::default();
        watcher.pass(&store, &folder, 0, &|_, _| {}).unwrap();
        watcher.pass(&store, &folder, 4, &|_, _| {}).unwrap();
        let kobo = identify(&simulated(&sandbox)).unwrap();
        Setup { sandbox, store, folder, kobo }
    }

    fn plain_epub() -> Options {
        Options { kepubify: None, replace_edited: false }
    }

    fn hash_of(path: &Path) -> String {
        hash_file(path).unwrap()
    }

    #[test]
    fn identity_comes_from_the_version_file() {
        let s = setup();
        assert_eq!(s.kobo.model, "Kobo Clara Colour");
        assert_eq!(s.kobo.id, crate::util::hash_bytes(b"SIMULATED-ONLY"));
        assert!(identify(&s.sandbox.0).is_err());
    }

    #[test]
    fn readable_books_go_once_without_duplicates_and_come_back_if_deleted_there() {
        let s = setup();
        let steps = std::cell::RefCell::new(Vec::new());
        let first = sync(&s.store, &s.kobo, &plain_epub(), &|step| steps.borrow_mut().push(step)).unwrap();
        assert_eq!(first.count(Outcome::Copied), 3, "the damaged EPUB is never sent");
        let a = hash_of(&s.folder.join("Classiques/a.epub"));
        assert_eq!(hash_of(&s.kobo.root.join(format!("Vera/{a}.epub"))), a, "a plain EPUB arrives byte for byte");
        assert!(steps.borrow().iter().any(|s| matches!(s, Step::Sending { .. })));
        assert!(fs::read_dir(s.store.root.join("staging")).unwrap().next().is_none(), "no work file left on the PC");

        let again = sync(&s.store, &s.kobo, &plain_epub(), &|_| {}).unwrap();
        assert_eq!((again.results.len(), again.present), (0, 3));

        // Deleted on the Kobo but still in the folder: the folder decides, it goes back.
        fs::remove_file(s.kobo.root.join(format!("Vera/{a}.epub"))).unwrap();
        let after = sync(&s.store, &s.kobo, &plain_epub(), &|_| {}).unwrap();
        assert_eq!((after.count(Outcome::Copied), after.resent), (1, 1));
        assert!(s.kobo.root.join(format!("Vera/{a}.epub")).is_file());
        assert!(fs::read_dir(s.folder.join("Classiques")).unwrap().count() > 0, "the folder is untouched");
    }

    #[test]
    fn a_book_already_on_the_kobo_elsewhere_is_not_copied_again() {
        let s = setup();
        fs::create_dir_all(s.kobo.root.join("Mes achats")).unwrap();
        fs::copy(s.folder.join("c.pdf"), s.kobo.root.join("Mes achats/c.pdf")).unwrap();
        let report = sync(&s.store, &s.kobo, &plain_epub(), &|_| {}).unwrap();
        assert_eq!((report.count(Outcome::Copied), report.present), (2, 1));
        assert!(!s.kobo.root.join(format!("Vera/{}.pdf", hash_of(&s.folder.join("c.pdf")))).exists());
    }

    #[test]
    fn shelves_wait_for_the_import_then_follow_the_folders() {
        let s = setup();
        let first = sync(&s.store, &s.kobo, &plain_epub(), &|_| {}).unwrap();
        let shelves = first.shelves.unwrap();
        assert_eq!((shelves.created, shelves.added, shelves.waiting), (2, 0, 2), "books not imported yet");
        // The Kobo imports the new books at ejection.
        let a = hash_of(&s.folder.join("Classiques/a.epub"));
        let b = hash_of(&s.folder.join("Classiques/Dumas/b.epub"));
        import(&s.kobo.root, &format!("{ONBOARD}Vera/{a}.epub"));
        import(&s.kobo.root, &format!("{ONBOARD}Vera/{b}.epub"));
        let second = sync(&s.store, &s.kobo, &plain_epub(), &|_| {}).unwrap();
        assert_eq!(second.shelves.unwrap().added, 2);
        let c = rusqlite::Connection::open(shelves::catalogue(&s.kobo.root)).unwrap();
        let shelf: String = c.query_row("SELECT ShelfName FROM ShelfContent WHERE ContentId LIKE ?1", [format!("%{b}%")], |r| r.get(0)).unwrap();
        assert_eq!(shelf, "Classiques › Dumas");
    }

    #[test]
    fn corrections_travel_in_the_copy_and_replace_it_only_when_allowed() {
        let s = setup();
        let a = hash_of(&s.folder.join("Classiques/a.epub"));
        let mut card = s.store.detail(&a).unwrap().metadata;
        card.title = "Titre corrigé".into();
        s.store.save_edit(&a, card.clone(), 0).unwrap();
        sync(&s.store, &s.kobo, &plain_epub(), &|_| {}).unwrap();
        let sent = s.kobo.root.join(format!("Vera/{a}.epub"));
        assert_eq!(crate::metadata::inspect(&sent).unwrap().metadata.title, "Titre corrigé");
        assert_eq!(hash_of(&s.folder.join("Classiques/a.epub")), a, "the original keeps its bytes");

        card.title = "Encore corrigé".into();
        s.store.save_edit(&a, card, 1).unwrap();
        let kept = sync(&s.store, &s.kobo, &plain_epub(), &|_| {}).unwrap();
        assert!(kept.results.is_empty(), "no replacement until it is allowed");
        let replaced = sync(&s.store, &s.kobo, &Options { kepubify: None, replace_edited: true }, &|_| {}).unwrap();
        assert_eq!(replaced.count(Outcome::Updated), 1);
        assert_eq!(crate::metadata::inspect(&sent).unwrap().metadata.title, "Encore corrigé");
    }

    #[test]
    fn an_epub_without_a_cover_arrives_with_the_one_vera_made() {
        let s = setup();
        let bare = s.folder.join("sans couverture.epub");
        crate::edit::tests::epub_without_cover(&fixture("representative.epub"), &bare);
        stamp_now(&bare);
        let mut watcher = Watcher::default();
        watcher.pass(&s.store, &s.folder, 0, &|_, _| {}).unwrap();
        watcher.pass(&s.store, &s.folder, 4, &|_, _| {}).unwrap();
        let hash = hash_of(&bare);
        assert_eq!(s.store.make_covers(10).unwrap(), 2, "the PDF and the EPUB without a cover, not the others");
        let made = fs::read(s.store.detail(&hash).unwrap().book.cover.unwrap()).unwrap();
        let report = sync(&s.store, &s.kobo, &plain_epub(), &|_| {}).unwrap();
        assert_eq!(report.count(Outcome::Copied), 4);
        let sent = crate::metadata::inspect(&s.kobo.root.join(format!("Vera/{hash}.epub"))).unwrap();
        assert_eq!(sent.cover.map(|c| c.bytes), Some(made), "the copy carries Vera's cover");
        assert_eq!(hash_of(&bare), hash, "the folder's file is untouched");
        let a = hash_of(&s.folder.join("Classiques/a.epub"));
        assert_eq!(hash_of(&s.kobo.root.join(format!("Vera/{a}.epub"))), a, "a book with its own cover is sent as it is");
        assert_eq!(s.store.journal(10).unwrap().len(), 1);
    }

    fn stamp_now(path: &Path) {
        File::options().write(true).open(path).unwrap().set_modified(std::time::SystemTime::now()).unwrap();
    }

    /// Watcher passes long enough apart for missing files to be forgotten.
    fn rescan(s: &Setup) {
        let mut watcher = Watcher::default();
        watcher.pass(&s.store, &s.folder, 0, &|_, _| {}).unwrap();
        watcher.pass(&s.store, &s.folder, crate::scan::GRACE + 1, &|_, _| {}).unwrap();
    }

    #[test]
    fn copies_of_books_that_left_the_folder_are_offered_after_a_day_and_removed_only_on_confirmation() {
        let s = setup();
        // A book bought elsewhere and copied by hand on the Kobo: never Vera's to remove.
        fs::create_dir_all(s.kobo.root.join("Mes achats")).unwrap();
        fs::copy(s.folder.join("c.pdf"), s.kobo.root.join("Mes achats/c.pdf")).unwrap();
        sync(&s.store, &s.kobo, &plain_epub(), &|_| {}).unwrap();
        let a = hash_of(&s.folder.join("Classiques/a.epub"));
        let c = hash_of(&s.folder.join("c.pdf"));
        let sent = s.kobo.root.join(format!("Vera/{a}.epub"));
        assert!(sent.is_file());

        // The owner removes both books from the folder (the PDF was converted, say).
        let kept = s.sandbox.0.join("ailleurs");
        fs::create_dir_all(&kept).unwrap();
        fs::rename(s.folder.join("Classiques/a.epub"), kept.join("a.epub")).unwrap();
        fs::rename(s.folder.join("c.pdf"), kept.join("c.pdf")).unwrap();
        rescan(&s);
        assert!(removable(&s.store, &s.kobo, now()).unwrap().is_empty(), "not before a day");
        let report = sync(&s.store, &s.kobo, &plain_epub(), &|_| {}).unwrap();
        assert!(report.removable.is_empty());

        let tomorrow = now() + LEAVE_AFTER + 60;
        let offered = removable(&s.store, &s.kobo, tomorrow).unwrap();
        assert_eq!(offered.len(), 1, "only Vera's copy, not the hand-copied PDF");
        assert_eq!((offered[0].hash.as_str(), offered[0].relative.clone()), (a.as_str(), format!("Vera/{a}.epub")));
        assert!(!offered[0].title.is_empty() && offered[0].size > 0);

        // Nothing goes without the owner's word, and only what was offered.
        assert_eq!(remove(&s.store, &s.kobo, std::slice::from_ref(&c), tomorrow).unwrap(), 0);
        assert!(sent.is_file());
        assert_eq!(remove(&s.store, &s.kobo, std::slice::from_ref(&a), tomorrow).unwrap(), 1);
        assert!(!sent.exists());
        assert!(s.kobo.root.join("Mes achats/c.pdf").is_file(), "a book Vera did not send stays");
        assert!(removable(&s.store, &s.kobo, tomorrow).unwrap().is_empty());

        // Back in the folder: back on the Kobo.
        fs::rename(kept.join("a.epub"), s.folder.join("Classiques/a.epub")).unwrap();
        rescan(&s);
        let back = sync(&s.store, &s.kobo, &plain_epub(), &|_| {}).unwrap();
        assert_eq!(back.count(Outcome::Copied), 1);
        assert!(sent.is_file());
    }

    #[test]
    fn a_kobo_whose_catalogue_changed_gets_its_books_and_a_plain_message() {
        let s = setup();
        // As if a firmware update had renamed a column Vera relies on.
        rusqlite::Connection::open(shelves::catalogue(&s.kobo.root)).unwrap().execute_batch("ALTER TABLE ShelfContent RENAME COLUMN _IsDeleted TO _Removed;").unwrap();
        let report = sync(&s.store, &s.kobo, &plain_epub(), &|_| {}).unwrap();
        assert_eq!(report.count(Outcome::Copied), 3, "the books still go");
        let message = report.shelves_error.unwrap();
        assert!(message.contains("format de catalogue") && message.contains("Rien n’y a été modifié"), "{message}");
    }

    #[test]
    fn progress_and_highlights_are_read_from_the_kobo_and_kept_after_the_book_leaves() {
        let s = setup();
        sync(&s.store, &s.kobo, &plain_epub(), &|_| {}).unwrap();
        let a = hash_of(&s.folder.join("Classiques/a.epub"));
        let content = format!("{ONBOARD}Vera/{a}.epub");
        import(&s.kobo.root, &content);
        let catalogue = shelves::catalogue(&s.kobo.root);
        {
            let c = rusqlite::Connection::open(&catalogue).unwrap();
            c.execute("UPDATE content SET ___PercentRead=34, ReadStatus=1, DateLastRead='2026-10-22T20:00:00Z' WHERE ContentID=?1", [&content]).unwrap();
            let mark = "INSERT INTO Bookmark(BookmarkID, VolumeID, ContentID, StartContainerPath, StartContainerChildIndex, StartOffset, EndContainerPath, EndContainerChildIndex, EndOffset, Text, Annotation, ChapterProgress, Hidden, DateCreated, Type)
                        VALUES(?1, ?2, ?2, '', 0, 0, '', 0, 0, ?3, ?4, ?5, ?6, '2026-10-22T20:00:00Z', 'highlight')";
            c.execute(mark, rusqlite::params!["b1", content, "Un passage surligné.", "", 0.4, "false"]).unwrap();
            c.execute(mark, rusqlite::params!["b2", content, "Un autre.", "Ma note", 0.1, "false"]).unwrap();
            c.execute(mark, rusqlite::params!["b3", content, "Caché", "", 0.2, "true"]).unwrap();
        }
        // Reading the progress and highlights writes nothing on the Kobo.
        let untouched = hash_of(&catalogue);
        assert_eq!(snapshot_reading(&s.store, &s.kobo).unwrap(), 2);
        assert_eq!(hash_of(&catalogue), untouched, "the catalogue is only read");
        sync(&s.store, &s.kobo, &plain_epub(), &|_| {}).unwrap();
        let book = s.store.books().unwrap().into_iter().find(|b| b.hash == a).unwrap();
        assert_eq!(book.kobo, Some(crate::store::KoboReading { percent: 34, status: 1 }));
        assert_eq!(book.notes, 2, "the hidden one is left out");
        let notes = s.store.annotations(&a).unwrap();
        assert_eq!(notes[0].note, "Ma note", "in reading order");
        let page = s.store.annotations_markdown(&a, &book.title, &book.authors).unwrap();
        assert!(page.contains("> Un passage surligné.") && page.contains("**Note :** Ma note"));

        // The book leaves the folder: its notes stay in Vera, and the removal list says what goes.
        fs::remove_file(s.folder.join("Classiques/a.epub")).unwrap();
        rescan(&s);
        let offered = removable(&s.store, &s.kobo, now() + LEAVE_AFTER + 60).unwrap();
        assert_eq!((offered[0].percent, offered[0].notes), (Some(34), 2));
        remove(&s.store, &s.kobo, std::slice::from_ref(&a), now() + LEAVE_AFTER + 60).unwrap();
        assert_eq!(s.store.annotations(&a).unwrap().len(), 2);
    }

    #[test]
    fn a_book_that_comes_back_within_the_day_is_not_offered() {
        let s = setup();
        sync(&s.store, &s.kobo, &plain_epub(), &|_| {}).unwrap();
        let away = s.sandbox.0.join("a.epub");
        fs::rename(s.folder.join("Classiques/a.epub"), &away).unwrap();
        rescan(&s);
        fs::rename(&away, s.folder.join("Classiques/a.epub")).unwrap();
        rescan(&s);
        assert!(removable(&s.store, &s.kobo, now() + LEAVE_AFTER * 3).unwrap().is_empty());
    }

    #[test]
    fn the_waiting_list_is_known_without_the_kobo() {
        let s = setup();
        assert_eq!(waiting(&s.store, &s.kobo.id).unwrap().len(), 3);
        sync(&s.store, &s.kobo, &plain_epub(), &|_| {}).unwrap();
        assert!(waiting(&s.store, &s.kobo.id).unwrap().is_empty());
        assert!(last_report(&s.store, &s.kobo.id).unwrap().is_some());
    }

    #[cfg(unix)]
    #[test]
    fn epubs_become_kepubs_when_the_tool_is_there() {
        use std::os::unix::fs::PermissionsExt;
        let s = setup();
        // A stand-in for kepubify: adds the Kobo spans to whatever EPUB it is given.
        let tool = s.sandbox.0.join("kepubify");
        let helper = s.sandbox.0.join("helper.kepub.epub");
        crate::kepub::tests::fake_kepub(&fixture("first.epub"), &helper, false);
        fs::write(&tool, format!("#!/bin/sh\ncp '{}' \"$3\"\n", helper.display())).unwrap();
        fs::set_permissions(&tool, fs::Permissions::from_mode(0o755)).unwrap();
        let report = sync(&s.store, &s.kobo, &Options { kepubify: Some(tool), replace_edited: false }, &|_| {}).unwrap();
        let a = hash_of(&s.folder.join("Classiques/a.epub"));
        assert!(s.kobo.root.join(format!("Vera/{a}.kepub.epub")).is_file(), "faithful KEPUB kept");
        let b = hash_of(&s.folder.join("Classiques/Dumas/b.epub"));
        assert!(s.kobo.root.join(format!("Vera/{b}.epub")).is_file(), "an unfaithful KEPUB falls back to the EPUB");
        assert_eq!(report.count(Outcome::Copied), 3);
    }
}
