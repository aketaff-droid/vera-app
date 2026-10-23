//! Keeps the list in line with the watched folder. Only the list changes: no file is ever written, moved
//! or deleted in the folder.
use crate::{
    metadata,
    store::Store,
    util::{hash_file, now, path_key, stamp, Stamp},
    Result, FORMATS,
};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

/// Seconds a known file may be missing before it leaves the list: Google Drive moves a file in two steps.
pub const GRACE: i64 = 120;
/// A file untouched for this long is complete; a newer one must keep the same size and date over two passes.
const SETTLED_MS: i64 = 30_000;

/// Every EPUB and PDF below `dir`. Links, reparse points and hidden or temporary entries (a leading dot, as
/// Google Drive uses while downloading, or Office's ~$ files) are skipped.
pub fn tree(dir: &Path) -> Result<Vec<PathBuf>> {
    let mut pending = vec![dir.to_path_buf()];
    let mut found = Vec::new();
    let mut folders = 0;
    while let Some(dir) = pending.pop() {
        let entries = fs::read_dir(&dir).map_err(|e| format!("{} : {e}", dir.display()))?;
        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let Ok(meta) = entry.path().symlink_metadata() else { continue };
            if meta.file_type().is_symlink() || name.starts_with('.') || name.starts_with("~$") {
                continue;
            }
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                // FILE_ATTRIBUTE_REPARSE_POINT
                if meta.file_attributes() & 0x400 != 0 {
                    continue;
                }
            }
            if meta.is_dir() {
                folders += 1;
                if folders > 20_000 {
                    return Err("Plus de 20 000 dossiers : choisis un dossier plus petit.".into());
                }
                pending.push(entry.path());
            } else if is_book(&entry.path()) {
                found.push(entry.path());
                if found.len() > 50_000 {
                    return Err("Plus de 50 000 livres : choisis un dossier plus petit.".into());
                }
            }
        }
    }
    found.sort();
    Ok(found)
}

pub fn is_book(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| FORMATS.contains(&e.to_lowercase().as_str()))
}

#[derive(Debug, Default, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pass {
    pub added: usize,
    pub placed: usize,
    pub forgotten: usize,
    /// Files still being written, or missing for less than GRACE.
    pub waiting: usize,
    pub total: usize,
}

impl Pass {
    pub fn changed(&self) -> bool {
        self.added + self.placed + self.forgotten > 0
    }
}

/// What one watched folder looked like on the previous passes.
#[derive(Default)]
pub struct Watcher {
    root: Option<PathBuf>,
    pending: HashMap<String, Stamp>,
    missing: HashMap<String, i64>,
}

impl Watcher {
    /// One look at the folder. `at` is the current time in seconds; `progress(done, total)` follows the books
    /// being read. An unreachable folder is an error and changes nothing.
    pub fn pass(&mut self, store: &Store, root: &Path, at: i64, progress: &dyn Fn(usize, usize)) -> Result<Pass> {
        // One spelling of the folder for every path stored (Windows also knows short 8.3 names and any case).
        let canonical = fs::canonicalize(root).map_err(|e| format!("{} : {e}", root.display()))?;
        let root = PathBuf::from(crate::store::plain(&canonical));
        if self.root.as_deref() != Some(root.as_path()) {
            *self = Watcher { root: Some(root.clone()), ..Watcher::default() };
        }
        let files = tree(&root)?;
        let known = store.files()?;
        let mut pass = Pass { total: files.len(), ..Pass::default() };
        let present: HashSet<String> = files.iter().map(|f| path_key(f)).collect();

        // A folder that empties all at once (a drive starting up, a sync glitch) is not believed.
        let vanished = known.keys().filter(|k| !present.contains(*k)).count();
        let believe_missing = !(files.is_empty() && known.len() >= 5);

        let mut ready = Vec::new();
        for path in &files {
            let key = path_key(path);
            self.missing.remove(&key);
            let Ok(now_stamp) = stamp(path) else { continue };
            if known.get(&key).is_some_and(|(_, s, _)| *s == now_stamp) {
                self.pending.remove(&key);
                continue;
            }
            let settled = wall_ms() - now_stamp.modified > SETTLED_MS;
            let steady = self.pending.get(&key) == Some(&now_stamp);
            if settled || steady {
                self.pending.remove(&key);
                ready.push((path.clone(), now_stamp));
            } else {
                self.pending.insert(key, now_stamp);
                pass.waiting += 1;
            }
        }

        let total = ready.len();
        for (index, (path, file_stamp)) in ready.into_iter().enumerate() {
            progress(index, total);
            let key = path_key(&path);
            // Read failed (file locked, Drive still downloading): try again on the next pass.
            let Ok(hash) = hash_file(&path) else {
                pass.waiting += 1;
                continue;
            };
            if stamp(&path).ok() != Some(file_stamp) {
                pass.waiting += 1;
                continue;
            }
            // The same path now holds another file: its old book loses this place first.
            if known.get(&key).is_some_and(|(_, _, h)| *h != hash) {
                store.forget_file(&path)?;
            }
            if store.has_book(&hash)? {
                store.place_file(&path, file_stamp, &hash)?;
                pass.placed += 1;
            } else {
                let read = std::panic::catch_unwind(|| metadata::inspect(&path))
                    .unwrap_or_else(|_| Err("Ce fichier n’a pas pu être lu.".into()));
                store.add_book(&hash, &path, file_stamp, read)?;
                pass.added += 1;
            }
        }
        progress(total, total);

        if believe_missing {
            for (key, (path, _, _)) in &known {
                if present.contains(key) {
                    continue;
                }
                let since = *self.missing.entry(key.clone()).or_insert(at);
                if at - since >= GRACE {
                    store.forget_file(path)?;
                    self.missing.remove(key);
                    pass.forgotten += 1;
                } else {
                    pass.waiting += 1;
                }
            }
        } else {
            pass.waiting += vanished;
        }
        Ok(pass)
    }
}

fn wall_ms() -> i64 {
    now() * 1000
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{
        plain,
        tests::{fixture, Sandbox},
        Settings,
    };

    fn setup() -> (Sandbox, Store, PathBuf) {
        let sandbox = Sandbox::new();
        let store = sandbox.store();
        let folder = sandbox.0.join("Mes livres");
        fs::create_dir_all(folder.join("Classiques")).unwrap();
        let folder = PathBuf::from(plain(&fs::canonicalize(folder).unwrap()));
        store.save_settings(Settings { watch_dir: Some(plain(&folder)), ..Settings::default() }).unwrap();
        (sandbox, store, folder)
    }

    #[test]
    fn only_epub_and_pdf_and_no_hidden_files() {
        let (_s, _store, folder) = setup();
        fs::copy(fixture("first.epub"), folder.join("a.epub")).unwrap();
        fs::copy(fixture("sample.pdf"), folder.join("Classiques/b.PDF")).unwrap();
        fs::write(folder.join("notes.docx"), b"x").unwrap();
        fs::write(folder.join(".tmp.epub"), b"x").unwrap();
        fs::write(folder.join("~$a.epub"), b"x").unwrap();
        assert_eq!(tree(&folder).unwrap().len(), 2);
    }

    #[test]
    fn new_files_wait_for_a_steady_size_then_join_the_list() {
        let (_s, store, folder) = setup();
        let path = folder.join("Classiques/a.epub");
        fs::copy(fixture("first.epub"), &path).unwrap();
        // Windows keeps the source's date on a copy: this one is marked as just written.
        fs::File::options().write(true).open(&path).unwrap().set_modified(std::time::SystemTime::now()).unwrap();
        let mut watcher = Watcher::default();
        let first = watcher.pass(&store, &folder, 0, &|_, _| {}).unwrap();
        assert_eq!((first.added, first.waiting), (0, 1), "just written: not read yet");
        let second = watcher.pass(&store, &folder, 4, &|_, _| {}).unwrap();
        assert_eq!(second.added, 1);
        let library = store.library().unwrap();
        assert_eq!(library.books[0].collection.as_deref(), Some("Classiques"));
        let third = watcher.pass(&store, &folder, 8, &|_, _| {}).unwrap();
        assert!(!third.changed(), "a known file is not read again");
    }

    #[test]
    fn a_moved_book_keeps_its_identity_and_a_vanished_one_leaves_after_the_grace() {
        let (_s, store, folder) = setup();
        fs::copy(fixture("first.epub"), folder.join("a.epub")).unwrap();
        fs::copy(fixture("second.epub"), folder.join("b.epub")).unwrap();
        let mut watcher = Watcher::default();
        watcher.pass(&store, &folder, 0, &|_, _| {}).unwrap();
        watcher.pass(&store, &folder, 4, &|_, _| {}).unwrap();
        let hash = crate::util::hash_file(&folder.join("a.epub")).unwrap();
        let mut fixed = store.detail(&hash).unwrap().metadata;
        fixed.title = "Corrigé".into();
        store.save_edit(&hash, fixed, 0).unwrap();

        fs::rename(folder.join("a.epub"), folder.join("Classiques/a.epub")).unwrap();
        fs::remove_file(folder.join("b.epub")).unwrap();
        watcher.pass(&store, &folder, 10, &|_, _| {}).unwrap();
        watcher.pass(&store, &folder, 14, &|_, _| {}).unwrap();
        assert_eq!(store.books().unwrap().len(), 2, "b is missing for less than the grace");
        let late = watcher.pass(&store, &folder, 10 + GRACE, &|_, _| {}).unwrap();
        assert_eq!(late.forgotten, 2, "the old place of a, and b");
        let books = store.books().unwrap();
        assert_eq!(books.len(), 1);
        assert_eq!(books[0].title, "Corrigé", "the moved book keeps its correction");
        assert_eq!(books[0].collection.as_deref(), Some("Classiques"));
    }

    #[test]
    fn an_unreachable_or_suddenly_empty_folder_changes_nothing() {
        let (sandbox, store, folder) = setup();
        for i in 0..5 {
            fs::copy(fixture("first.epub"), folder.join(format!("{i}.epub"))).unwrap();
        }
        let mut watcher = Watcher::default();
        watcher.pass(&store, &folder, 0, &|_, _| {}).unwrap();
        watcher.pass(&store, &folder, 4, &|_, _| {}).unwrap();
        assert_eq!(store.files().unwrap().len(), 5);
        assert!(watcher.pass(&store, &sandbox.0.join("absent"), 10, &|_, _| {}).is_err());
        for i in 0..5 {
            fs::remove_file(folder.join(format!("{i}.epub"))).unwrap();
        }
        let pass = watcher.pass(&store, &folder, 10 + 10 * GRACE, &|_, _| {}).unwrap();
        assert_eq!(pass.forgotten, 0);
        assert_eq!(store.files().unwrap().len(), 5);
    }

    #[test]
    fn a_file_replaced_in_place_becomes_the_new_book() {
        let (_s, store, folder) = setup();
        let path = folder.join("a.epub");
        fs::copy(fixture("first.epub"), &path).unwrap();
        let mut watcher = Watcher::default();
        watcher.pass(&store, &folder, 0, &|_, _| {}).unwrap();
        watcher.pass(&store, &folder, 4, &|_, _| {}).unwrap();
        let before = store.books().unwrap()[0].hash.clone();
        fs::copy(fixture("second.epub"), &path).unwrap();
        watcher.pass(&store, &folder, 8, &|_, _| {}).unwrap();
        watcher.pass(&store, &folder, 12, &|_, _| {}).unwrap();
        let books = store.books().unwrap();
        assert_eq!(books.len(), 1);
        assert_ne!(books[0].hash, before);
    }
}
