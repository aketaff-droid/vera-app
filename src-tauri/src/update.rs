//! Updates from Vera itself (docs/DECISIONS.md, section O): Vera looks for a new version on its public GitHub
//! repository a moment after it starts and every six hours, says so once per version (notification, notification
//! area, window), and installs it only when the owner clicks. The update is checked against Vera's public key
//! (tauri.conf.json) before it runs: a file not signed with Vera's private key is refused.
use crate::background::Shared;
use serde::Serialize;
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::UpdaterExt;

type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    /// What the new version brings, as written on its release.
    pub notes: Option<String>,
}

static AVAILABLE: Mutex<Option<UpdateInfo>> = Mutex::new(None);

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Let the folder and the Kobo be looked at first.
        tokio_sleep(Duration::from_secs(90)).await;
        loop {
            let _ = check_and_tell(&app).await;
            tokio_sleep(Duration::from_secs(6 * 3600)).await;
        }
    });
}

async fn tokio_sleep(duration: Duration) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(duration)).await;
}

async fn check_and_tell(app: &AppHandle) -> Result<Option<UpdateInfo>> {
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(message)?;
    let info = update.map(|u| UpdateInfo { version: u.version.clone(), notes: u.body.clone() });
    *AVAILABLE.lock().unwrap() = info.clone();
    let _ = app.emit("update", &info);
    if let Some(info) = &info {
        let shared = app.state::<Arc<Shared>>();
        shared.set_update_item(Some(&info.version));
        // One notification per version.
        if shared.store.fact("update-notified").ok().flatten().as_deref() != Some(info.version.as_str()) {
            let _ = app
                .notification()
                .builder()
                .title(format!("Vera {} est disponible", info.version))
                .body("Ouvre Vera pour l’installer : tes réglages et ta bibliothèque sont gardés.")
                .show();
            let _ = shared.store.set_fact("update-notified", &info.version);
        }
    }
    Ok(info)
}

fn message(error: tauri_plugin_updater::Error) -> String {
    let text = error.to_string();
    if text.to_lowercase().contains("signature") {
        "La mise à jour n’est pas signée par Vera : elle est refusée.".into()
    } else {
        format!("Impossible de vérifier les mises à jour (connexion ?) : {text}")
    }
}

/// The version waiting to be installed, as last found.
#[tauri::command]
pub fn update_status() -> Option<UpdateInfo> {
    AVAILABLE.lock().unwrap().clone()
}

/// « Rechercher une mise à jour » in the settings.
#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Option<UpdateInfo>> {
    check_and_tell(&app).await
}

/// Downloads the new version, checks its signature, and runs its installer; Vera then restarts on its own.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<()> {
    {
        let shared = app.state::<Arc<Shared>>();
        if shared.kobo.lock().unwrap().syncing {
            return Err("Attends la fin de la synchronisation de la Kobo.".into());
        }
    }
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(message)?.ok_or("Vera est déjà à jour.")?;
    let mut done = 0usize;
    let progress = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                done += chunk;
                let _ = progress.emit("update-progress", (done as u64, total));
            },
            || {},
        )
        .await
        .map_err(message)?;
    // On Windows the installer closes Vera itself; elsewhere, restart.
    app.restart();
}
