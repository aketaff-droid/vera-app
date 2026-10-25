//! What the interface may ask of Vera. Each command runs off the interface thread when it touches the disk.
use crate::background::{self, FolderState, KoboState, Shared};
use serde::Serialize;
use std::{path::PathBuf, sync::Arc};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use vera_core::{
    kobo,
    metadata::Metadata,
    openlibrary,
    scan,
    store::{Annotation, Detail, Library, Reading, Settings},
};

type Result<T> = std::result::Result<T, String>;

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    settings: Settings,
    folder: FolderState,
    kobo: KoboState,
    /// Books that will leave at the next plug of the last Kobo seen.
    waiting: Vec<String>,
    /// A Kobo was synchronised at least once, and when its last synchronisation ended.
    device_known: bool,
    last_sync_at: Option<i64>,
    /// Free space on that Kobo at its last synchronisation.
    last_free: Option<u64>,
    /// A new version of Vera waiting to be installed.
    update: Option<crate::update::UpdateInfo>,
    data_dir: String,
}

#[tauri::command]
pub async fn state(shared: State<'_, Arc<Shared>>) -> Result<AppState> {
    let shared = shared.inner().clone();
    blocking(move || {
        let device = shared.store.fact("device")?;
        let last = match &device {
            Some(device) => kobo::last_report(&shared.store, device)?,
            None => None,
        };
        Ok(AppState {
            device_known: device.is_some(),
            last_sync_at: last.as_ref().and_then(|r| r["at"].as_i64()),
            last_free: last.as_ref().and_then(|r| r["freeBytes"].as_u64()),
            update: crate::update::update_status(),
            settings: shared.store.settings()?,
            folder: shared.folder.lock().unwrap().clone(),
            kobo: shared.kobo.lock().unwrap().clone(),
            waiting: match device {
                Some(device) => kobo::waiting(&shared.store, &device)?,
                None => Vec::new(),
            },
            data_dir: shared.store.root.to_string_lossy().into_owned(),
        })
    })
    .await
}

#[tauri::command]
pub async fn library(shared: State<'_, Arc<Shared>>) -> Result<Library> {
    let shared = shared.inner().clone();
    blocking(move || shared.store.library()).await
}

#[tauri::command]
pub async fn detail(shared: State<'_, Arc<Shared>>, hash: String) -> Result<Detail> {
    let shared = shared.inner().clone();
    blocking(move || shared.store.detail(&hash)).await
}

#[tauri::command]
pub async fn save_card(app: AppHandle, shared: State<'_, Arc<Shared>>, hash: String, metadata: Metadata, revision: i64) -> Result<i64> {
    let shared = shared.inner().clone();
    let saved = blocking(move || {
        let saved = shared.store.save_edit(&hash, metadata, revision)?;
        // A drawn cover follows the corrected title; failing to redraw it never undoes the correction.
        let _ = shared.store.redraw_cover(&hash);
        Ok(saved)
    })
    .await?;
    let _ = app.emit("library", ());
    Ok(saved)
}

#[tauri::command]
pub async fn lookup(isbn: String) -> Result<openlibrary::Found> {
    blocking(move || openlibrary::lookup(&isbn, &openlibrary::Web, &|| std::thread::sleep(std::time::Duration::from_millis(1100)))).await
}

#[tauri::command]
pub async fn save_settings(app: AppHandle, shared: State<'_, Arc<Shared>>, settings: Settings) -> Result<Settings> {
    let shared = shared.inner().clone();
    let a = app.clone();
    let saved = blocking(move || {
        let saved = shared.store.save_settings(settings)?;
        if !cfg!(debug_assertions) {
            let launcher = a.autolaunch();
            if saved.autostart { launcher.enable() } else { launcher.disable() }.map_err(|e| e.to_string())?;
        }
        // A new folder is read at once rather than at the next tick.
        background::scan_once(&a, &shared);
        Ok(saved)
    })
    .await?;
    let _ = app.emit("settings", &saved);
    Ok(saved)
}

#[tauri::command]
pub async fn choose_folder(app: AppHandle) -> Result<Option<String>> {
    blocking(move || {
        let picked = app.dialog().file().set_title("Choisir le dossier de tes livres").blocking_pick_folder();
        picked.map(|p| p.into_path().map(|p| p.to_string_lossy().into_owned()).map_err(|e| e.to_string())).transpose()
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    path: String,
    books: usize,
    drive: bool,
}

/// The likely folder of books: a « Livres » (or « Books ») folder of Google Drive for desktop.
#[tauri::command]
pub async fn suggest_folder() -> Result<Option<Suggestion>> {
    blocking(|| {
        if !cfg!(windows) {
            return Ok(None);
        }
        for letter in b'C'..=b'Z' {
            for drive in ["Mon Drive", "My Drive"] {
                for name in ["Livres", "Books", "Ebooks", "eBooks"] {
                    let path = PathBuf::from(format!("{}:\\{drive}\\{name}", letter as char));
                    if path.is_dir() {
                        let books = scan::tree(&path).map(|t| t.len()).unwrap_or(0);
                        return Ok(Some(Suggestion { path: path.to_string_lossy().into_owned(), books, drive: true }));
                    }
                }
            }
        }
        Ok(None)
    })
    .await
}

#[tauri::command]
pub async fn sync_now(app: AppHandle) -> Result<()> {
    blocking(move || {
        let shared = app.state::<Arc<Shared>>().inner().clone();
        if shared.kobo.lock().unwrap().device.is_none() {
            return Err("Aucune Kobo branchée.".into());
        }
        background::sync(&app, &shared);
        Ok(())
    })
    .await
}

/// Removes from the Kobo the copies the owner confirmed in the window.
#[tauri::command]
pub async fn kobo_remove(app: AppHandle, hashes: Vec<String>) -> Result<usize> {
    blocking(move || background::remove(&app, hashes)).await
}

#[tauri::command]
pub async fn eject(app: AppHandle) -> Result<()> {
    blocking(move || background::eject(&app)).await
}

/// Shows a book's file in the Explorer.
#[tauri::command]
pub async fn reveal(app: AppHandle, shared: State<'_, Arc<Shared>>, hash: String) -> Result<()> {
    let shared = shared.inner().clone();
    let path = blocking(move || shared.store.detail(&hash).map(|d| d.book.path)).await?;
    app.opener().reveal_item_in_dir(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_folder(app: AppHandle, shared: State<'_, Arc<Shared>>) -> Result<()> {
    let dir = shared.store.settings()?.watch_dir.ok_or("Aucun dossier choisi.")?;
    app.opener().open_path(dir, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_data(app: AppHandle, shared: State<'_, Arc<Shared>>) -> Result<()> {
    app.opener().open_path(shared.store.root.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

/// « Ce ne sont pas des doublons ».
#[tauri::command]
pub async fn dismiss_twins(app: AppHandle, shared: State<'_, Arc<Shared>>, hashes: Vec<String>) -> Result<()> {
    let shared = shared.inner().clone();
    blocking(move || shared.store.dismiss_twins(&hashes)).await?;
    let _ = app.emit("library", ());
    Ok(())
}

/// A book's file for the reader, as raw bytes (no JSON on the way). The file is only read.
#[tauri::command]
pub async fn book_file(shared: State<'_, Arc<Shared>>, hash: String) -> Result<tauri::ipc::Response> {
    let shared = shared.inner().clone();
    blocking(move || shared.store.book_file(&hash)).await.map(tauri::ipc::Response::new)
}

/// Where the reader left a book, if it was opened in Vera.
#[tauri::command]
pub async fn reading_position(shared: State<'_, Arc<Shared>>, hash: String) -> Result<Option<Reading>> {
    let shared = shared.inner().clone();
    blocking(move || shared.store.reading(&hash)).await
}

/// Keeps the reader's place in Vera's catalogue (never on the Kobo).
#[tauri::command]
pub async fn save_reading(shared: State<'_, Arc<Shared>>, hash: String, position: String, fraction: f64) -> Result<()> {
    let shared = shared.inner().clone();
    blocking(move || shared.store.save_reading(&hash, &position, fraction)).await
}

/// The highlights and notes of a book, copied from the Kobo.
#[tauri::command]
pub async fn annotations(shared: State<'_, Arc<Shared>>, hash: String) -> Result<Vec<Annotation>> {
    let shared = shared.inner().clone();
    blocking(move || shared.store.annotations(&hash)).await
}

/// Passages for « Vera rêve » (the owner's highlights and Kobo notes).
#[tauri::command]
pub async fn passages(shared: State<'_, Arc<Shared>>) -> Result<Vec<vera_core::store::Passage>> {
    let shared = shared.inner().clone();
    blocking(move || shared.store.passages(30)).await
}

/// A book's thumbnail, for the window's dust animations (read as bytes: pixels of a picture from another origin could
/// not be read by the page).
#[tauri::command]
pub async fn cover_thumb(shared: State<'_, Arc<Shared>>, hash: String) -> Result<tauri::ipc::Response> {
    let shared = shared.inner().clone();
    blocking(move || shared.store.thumb_bytes(&hash)).await.map(tauri::ipc::Response::new)
}

/// The passages highlighted in Vera's reader (kept in the catalogue only).
#[tauri::command]
pub async fn highlights(shared: State<'_, Arc<Shared>>, hash: String) -> Result<Vec<vera_core::store::Highlight>> {
    let shared = shared.inner().clone();
    blocking(move || shared.store.highlights(&hash)).await
}

#[tauri::command]
pub async fn save_highlight(shared: State<'_, Arc<Shared>>, hash: String, highlight: vera_core::store::Highlight) -> Result<vera_core::store::Highlight> {
    let shared = shared.inner().clone();
    blocking(move || shared.store.save_highlight(&hash, &highlight)).await
}

#[tauri::command]
pub async fn delete_highlight(shared: State<'_, Arc<Shared>>, hash: String, id: String) -> Result<()> {
    let shared = shared.inner().clone();
    blocking(move || shared.store.delete_highlight(&hash, &id)).await
}

/// Saves a book's highlights as a Markdown file where the owner chooses (never in the watched folder).
#[tauri::command]
pub async fn export_annotations(app: AppHandle, shared: State<'_, Arc<Shared>>, hash: String, title: String, authors: String) -> Result<Option<String>> {
    let shared = shared.inner().clone();
    blocking(move || {
        let page = shared.store.annotations_markdown(&hash, &title, &authors)?;
        let name = vera_core::share::file_name(&format!("{title} — notes"), "", "md");
        let Some(picked) = app.dialog().file().set_title("Enregistrer les notes").set_file_name(&name).add_filter("Markdown", &["md"]).blocking_save_file() else {
            return Ok(None);
        };
        let path = picked.into_path().map_err(|e| e.to_string())?;
        if let Some(watched) = shared.store.settings()?.watch_dir {
            let parent = path.parent().and_then(|p| std::fs::canonicalize(p).ok());
            if parent.zip(std::fs::canonicalize(&watched).ok()).is_some_and(|(p, w)| p.starts_with(w)) {
                return Err("Choisis un autre dossier : Vera n’écrit jamais dans ton dossier de livres.".into());
            }
        }
        std::fs::write(&path, page).map_err(|e| format!("Enregistrement impossible : {e}"))?;
        Ok(Some(vera_core::store::plain(&path)))
    })
    .await
}

/// The last synchronisations, newest first.
#[tauri::command]
pub async fn journal(shared: State<'_, Arc<Shared>>) -> Result<Vec<serde_json::Value>> {
    let shared = shared.inner().clone();
    blocking(move || shared.store.journal(50)).await
}

#[tauri::command]
pub fn quit(app: AppHandle) {
    app.exit(0);
}
