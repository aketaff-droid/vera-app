//! Sharing books from the window (docs/DECISIONS.md, section M). vera-core prepares and sends; this shell keeps
//! the secrets in Windows' credential store, puts files on the clipboard, opens WhatsApp, Discord or the mail
//! application, and shows the small guide window beside them.
use crate::background::Shared;
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use vera_core::{
    share::{self, Mail, MailAccount, Prepared, SharedFile},
    store::{Channel, Settings},
};

type Result<T> = std::result::Result<T, String>;

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|e| e.to_string())?
}

/* ——— Secrets: Windows' credential store, « Vera » entries ——— */

#[cfg(windows)]
mod secrets {
    fn entry(key: &str) -> super::Result<keyring::Entry> {
        keyring::Entry::new("Vera", key).map_err(|e| e.to_string())
    }
    pub fn set(key: &str, value: &str) -> super::Result<()> {
        entry(key)?.set_password(value).map_err(|e| format!("Coffre de Windows inaccessible : {e}"))
    }
    pub fn get(key: &str) -> super::Result<String> {
        entry(key)?.get_password().map_err(|_| "Mot de passe introuvable dans le coffre de Windows : relie de nouveau ce compte.".to_string())
    }
    pub fn forget(key: &str) {
        if let Ok(e) = entry(key) {
            let _ = e.delete_credential();
        }
    }
}

#[cfg(not(windows))]
mod secrets {
    // The credential store is Windows'; elsewhere (tests of the shell) nothing is kept.
    pub fn set(_: &str, _: &str) -> super::Result<()> {
        Err("Disponible sous Windows seulement.".into())
    }
    pub fn get(_: &str) -> super::Result<String> {
        Err("Disponible sous Windows seulement.".into())
    }
    pub fn forget(_: &str) {}
}

fn mail_key(address: &str) -> String {
    format!("mail:{}", address.trim().to_lowercase())
}

fn channel_key(id: &str) -> String {
    format!("discord:{id}")
}

/* ——— Commands ——— */

#[tauri::command]
pub async fn share_prepare(shared: State<'_, Arc<Shared>>, hashes: Vec<String>, corrected: bool, zip: bool) -> Result<Prepared> {
    let shared = shared.inner().clone();
    blocking(move || share::prepare(&shared.store, &hashes, corrected, zip)).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Targets {
    whatsapp: bool,
    discord: bool,
}

/// The applications installed on this PC that the guide can open (their link protocol is registered).
#[tauri::command]
pub async fn share_targets() -> Result<Targets> {
    blocking(|| Ok(Targets { whatsapp: protocol("whatsapp"), discord: protocol("discord") })).await
}

#[cfg(windows)]
fn protocol(name: &str) -> bool {
    use std::os::windows::process::CommandExt;
    std::process::Command::new("reg")
        .args(["query", &format!(r"HKCR\{name}"), "/v", "URL Protocol"])
        .creation_flags(0x0800_0000)
        .output()
        .is_ok_and(|o| o.status.success())
}

#[cfg(not(windows))]
fn protocol(_: &str) -> bool {
    false
}

/// Links an address: checks it with the server, then keeps its application password in the credential store.
#[tauri::command]
pub async fn share_mail_setup(app: AppHandle, shared: State<'_, Arc<Shared>>, account: MailAccount, password: String) -> Result<Settings> {
    let shared = shared.inner().clone();
    let saved = blocking(move || {
        share::check_account(&account)?;
        share::test_account(&account, &password)?;
        secrets::set(&mail_key(&account.address), password.replace(' ', "").as_str())?;
        let mut settings = shared.store.settings()?;
        if let Some(old) = settings.share.mail.as_ref().filter(|old| !old.address.eq_ignore_ascii_case(&account.address)) {
            secrets::forget(&mail_key(&old.address));
        }
        settings.share.mail = Some(account);
        shared.store.save_settings(settings)
    })
    .await?;
    let _ = app.emit("settings", &saved);
    Ok(saved)
}

/// The usual sending server for an address, if Vera knows it.
#[tauri::command]
pub fn share_mail_provider(address: String) -> Option<MailAccount> {
    share::provider(&address)
}

#[tauri::command]
pub async fn share_mail_forget(app: AppHandle, shared: State<'_, Arc<Shared>>) -> Result<Settings> {
    let shared = shared.inner().clone();
    let saved = blocking(move || {
        let mut settings = shared.store.settings()?;
        if let Some(account) = settings.share.mail.take() {
            secrets::forget(&mail_key(&account.address));
        }
        shared.store.save_settings(settings)
    })
    .await?;
    let _ = app.emit("settings", &saved);
    Ok(saved)
}

#[tauri::command]
pub async fn share_mail_send(app: AppHandle, shared: State<'_, Arc<Shared>>, mail: Mail, files: Vec<SharedFile>) -> Result<()> {
    let shared = shared.inner().clone();
    let saved = blocking(move || {
        let files = own(&shared, files)?;
        let account = shared.store.settings()?.share.mail.ok_or("Aucune adresse reliée : relie d’abord ton adresse e-mail.")?;
        let password = secrets::get(&mail_key(&account.address))?;
        share::send_mail(&account, &password, &mail, &files)?;
        shared.store.remember_recipients(&mail.to)?;
        shared.store.settings()
    })
    .await?;
    let _ = app.emit("settings", &saved);
    Ok(())
}

/// Adds a Discord channel from its webhook address, kept in the credential store.
#[tauri::command]
pub async fn share_discord_add(app: AppHandle, shared: State<'_, Arc<Shared>>, name: String, url: String) -> Result<Settings> {
    let shared = shared.inner().clone();
    let saved = blocking(move || {
        share::check_webhook(&url)?;
        let name = name.trim().to_string();
        if name.is_empty() {
            return Err("Donne un nom à ce salon (par exemple « #livres · Serveur des amis »).".into());
        }
        let id = vera_core::util::hash_bytes(format!("{url}{}", vera_core::util::now()).as_bytes())[..16].to_string();
        secrets::set(&channel_key(&id), url.trim())?;
        let mut settings = shared.store.settings()?;
        settings.share.channels.push(Channel { id, name });
        shared.store.save_settings(settings)
    })
    .await?;
    let _ = app.emit("settings", &saved);
    Ok(saved)
}

#[tauri::command]
pub async fn share_discord_remove(app: AppHandle, shared: State<'_, Arc<Shared>>, id: String) -> Result<Settings> {
    let shared = shared.inner().clone();
    let saved = blocking(move || {
        let mut settings = shared.store.settings()?;
        settings.share.channels.retain(|c| c.id != id);
        secrets::forget(&channel_key(&id));
        shared.store.save_settings(settings)
    })
    .await?;
    let _ = app.emit("settings", &saved);
    Ok(saved)
}

#[tauri::command]
pub async fn share_discord_send(shared: State<'_, Arc<Shared>>, id: String, message: String, files: Vec<SharedFile>) -> Result<()> {
    let shared = shared.inner().clone();
    blocking(move || {
        let files = own(&shared, files)?;
        if !shared.store.settings()?.share.channels.iter().any(|c| c.id == id) {
            return Err("Ce salon n’est plus dans Vera.".into());
        }
        let url = secrets::get(&channel_key(&id))?;
        share::send_discord(&url, &message, &files)
    })
    .await
}

/// Puts the files on the clipboard, as the Explorer's « Copier » does: Ctrl+V pastes them in WhatsApp or Discord.
#[tauri::command]
pub async fn share_copy(shared: State<'_, Arc<Shared>>, files: Vec<SharedFile>) -> Result<()> {
    let shared = shared.inner().clone();
    blocking(move || {
        let files = own(&shared, files)?;
        copy_files(&files.iter().map(|f| f.path.clone()).collect::<Vec<_>>())
    })
    .await
}

#[cfg(windows)]
fn copy_files(paths: &[String]) -> Result<()> {
    use clipboard_win::Setter;
    let _clipboard = clipboard_win::Clipboard::new_attempts(10).map_err(|e| format!("Presse-papiers occupé : {e}"))?;
    clipboard_win::raw::empty().map_err(|e| e.to_string())?;
    clipboard_win::formats::FileList.write_clipboard(paths).map_err(|e| format!("Copie impossible : {e}"))
}

#[cfg(not(windows))]
fn copy_files(_: &[String]) -> Result<()> {
    Err("Disponible sous Windows seulement.".into())
}

/// Opens WhatsApp, Discord, or the default mail application on a new message.
#[tauri::command]
pub fn share_open(app: AppHandle, target: String, subject: Option<String>, body: Option<String>) -> Result<()> {
    let url = match target.as_str() {
        "whatsapp" => "whatsapp://".to_string(),
        "discord" => "discord://".to_string(),
        "google-app-passwords" => "https://myaccount.google.com/apppasswords".to_string(),
        "google-two-step" => "https://myaccount.google.com/signinoptions/twosv".to_string(),
        "mail" => {
            let enc = |s: &str| percent(s);
            format!("mailto:?subject={}&body={}", enc(subject.as_deref().unwrap_or("")), enc(body.as_deref().unwrap_or("")))
        }
        _ => return Err("Application inconnue.".into()),
    };
    app.opener().open_url(url, None::<&str>).map_err(|e| format!("Impossible d’ouvrir l’application : {e}"))
}

fn percent(text: &str) -> String {
    text.bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}

/// Shows the prepared files in the Explorer, selected, for dragging into a message.
#[tauri::command]
pub async fn share_reveal(app: AppHandle, shared: State<'_, Arc<Shared>>, files: Vec<SharedFile>) -> Result<()> {
    let shared = shared.inner().clone();
    let files = blocking(move || own(&shared, files)).await?;
    let first = files.first().ok_or("Aucun fichier.")?;
    app.opener().reveal_item_in_dir(&first.path).map_err(|e| e.to_string())
}

/// Saves a copy of the files in a folder the owner picks (a USB key…); never in the watched folder.
#[tauri::command]
pub async fn share_save(app: AppHandle, shared: State<'_, Arc<Shared>>, files: Vec<SharedFile>) -> Result<Option<String>> {
    let shared = shared.inner().clone();
    blocking(move || {
        let files = own(&shared, files)?;
        let Some(picked) = app.dialog().file().set_title("Où enregistrer les livres ?").blocking_pick_folder() else { return Ok(None) };
        let dir = picked.into_path().map_err(|e| e.to_string())?;
        if let Some(watched) = shared.store.settings()?.watch_dir {
            let inside = std::fs::canonicalize(&dir).ok().zip(std::fs::canonicalize(&watched).ok()).is_some_and(|(d, w)| d.starts_with(w));
            if inside {
                return Err("Choisis un autre dossier : Vera n’écrit jamais dans ton dossier de livres.".into());
            }
        }
        for file in &files {
            let mut to = dir.join(&file.name);
            let mut n = 2;
            while to.exists() {
                let (stem, ext) = file.name.rsplit_once('.').unwrap_or((&file.name, ""));
                to = dir.join(format!("{stem} ({n}).{ext}"));
                n += 1;
            }
            std::fs::copy(&file.path, &to).map_err(|e| format!("Copie impossible : {e}"))?;
        }
        Ok(Some(vera_core::store::plain(&dir)))
    })
    .await
}

/// Only files Vera prepared itself (in its sharing folder) are sent, copied or revealed.
fn own(shared: &Shared, files: Vec<SharedFile>) -> Result<Vec<SharedFile>> {
    let root = std::fs::canonicalize(shared.store.root.join(share::FOLDER)).map_err(|_| "Aucun livre préparé.")?;
    files
        .into_iter()
        .map(|mut f| {
            let path = std::fs::canonicalize(PathBuf::from(&f.path)).map_err(|_| "Fichier préparé introuvable : recommence le partage.")?;
            if !path.starts_with(&root) {
                return Err("Fichier hors du dossier de partage de Vera.".to_string());
            }
            f.size = path.metadata().map_err(|e| e.to_string())?.len();
            f.path = vera_core::store::plain(&path);
            Ok(f)
        })
        .collect()
}

/// The files the guide window works with (« Recopier les livres »).
static GUIDE_FILES: Mutex<Vec<SharedFile>> = Mutex::new(Vec::new());

/// The small guide window, always on top at the right of the screen, beside WhatsApp or Discord. The main window
/// steps aside while it is open.
#[tauri::command]
pub async fn share_guide_open(app: AppHandle, shared: State<'_, Arc<Shared>>, query: String, files: Vec<SharedFile>) -> Result<()> {
    if query.len() > 8000 || query.contains('#') {
        return Err("Guide invalide.".into());
    }
    let shared = shared.inner().clone();
    *GUIDE_FILES.lock().unwrap() = blocking(move || own(&shared, files)).await?;
    if let Some(old) = app.get_webview_window("guide") {
        let _ = old.destroy();
    }
    let window = WebviewWindowBuilder::new(&app, "guide", WebviewUrl::App(format!("index.html?guide=1&{query}").into()))
        .title("Vera — partage")
        .inner_size(360.0, 600.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(false)
        .build()
        .map_err(|e| e.to_string())?;
    if let Ok(Some(monitor)) = window.current_monitor() {
        let scale = monitor.scale_factor();
        let size = monitor.size().to_logical::<f64>(scale);
        let _ = window.set_position(tauri::LogicalPosition::new(size.width - 380.0, 60.0));
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.minimize();
    }
    Ok(())
}

/// Puts the guide's files on the clipboard again.
#[tauri::command]
pub async fn share_guide_recopy() -> Result<()> {
    let paths: Vec<String> = GUIDE_FILES.lock().unwrap().iter().map(|f| f.path.clone()).collect();
    if paths.is_empty() {
        return Err("Plus aucun livre à copier : recommence le partage.".into());
    }
    blocking(move || copy_files(&paths)).await
}

#[tauri::command]
pub fn share_guide_close(app: AppHandle) {
    GUIDE_FILES.lock().unwrap().clear();
    if let Some(guide) = app.get_webview_window("guide") {
        let _ = guide.destroy();
    }
    crate::open_window(&app);
}
