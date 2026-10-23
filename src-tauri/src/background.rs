//! The two loops that make Vera work with its window closed: the watched folder (every 4 s) and the Kobo
//! (every 3 s). Their state is kept here for the interface, which is told of each change by an event.
use serde::Serialize;
use std::{
    path::Path,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{image::Image, menu::MenuItem, tray::TrayIcon, AppHandle, Emitter, Manager, Wry};
use tauri_plugin_notification::NotificationExt;
use vera_core::{
    kobo::{self, Device, Options, Outcome, Report, Step},
    scan::{Pass, Watcher},
    store::Store,
    util::now,
};

pub struct TrayItems {
    pub status: MenuItem<Wry>,
    pub eject: MenuItem<Wry>,
    /// « Installer Vera x.y.z… » once a new version is found (update.rs).
    pub update: MenuItem<Wry>,
    pub tray: TrayIcon<Wry>,
    /// Vera's icon; the states add a dot to it, as Windows apps do in the notification area.
    pub icon: Image<'static>,
}

/// What the notification-area icon tells at a glance.
#[derive(Clone, Copy, PartialEq)]
enum Mark {
    Quiet,
    Busy,
    Done,
    Trouble,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderState {
    /// Why the watched folder cannot be read (Drive not started, disk unplugged); None when it can.
    pub error: Option<String>,
    /// While books are being read: (done, total).
    pub reading: Option<(usize, usize)>,
    pub last: Option<Pass>,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KoboState {
    pub device: Option<Device>,
    pub syncing: bool,
    pub step: Option<Step>,
    pub report: Option<Report>,
    pub error: Option<String>,
    pub ejecting: bool,
    /// Ejected and still mounted for a moment: « Tu peux débrancher la Kobo ».
    pub ejected: bool,
}

pub struct Shared {
    pub store: Store,
    pub folder: Mutex<FolderState>,
    pub kobo: Mutex<KoboState>,
    pub watcher: Mutex<Watcher>,
    sync_lock: Mutex<()>,
    items: TrayItems,
    mark: Mutex<Option<Mark>>,
}

impl Shared {
    /// The notification area's update line: the version waiting, or none.
    pub fn set_update_item(&self, version: Option<&str>) {
        let item = &self.items.update;
        match version {
            Some(v) => {
                let _ = item.set_text(format!("Installer Vera {v}…"));
                let _ = item.set_enabled(true);
            }
            None => {
                let _ = item.set_text("Vera est à jour");
                let _ = item.set_enabled(false);
            }
        }
    }
}

/// Below this, the Kobo is said to be nearly full.
pub const LOW_SPACE: u64 = 500 * 1024 * 1024;

/// Vera's icon with a dot in its lower right corner: blue while busy, green when the Kobo is up to date, red when
/// something needs a look.
fn marked(icon: &Image<'_>, mark: Mark) -> Image<'static> {
    let (w, h) = (icon.width(), icon.height());
    let mut rgba = icon.rgba().to_vec();
    let colour: [u8; 3] = match mark {
        Mark::Quiet => return Image::new_owned(rgba, w, h),
        Mark::Busy => [0x0A, 0x84, 0xFF],
        Mark::Done => [0x30, 0xD1, 0x58],
        Mark::Trouble => [0xFF, 0x45, 0x3A],
    };
    let r = w.min(h) as f32 * 0.24;
    let (cx, cy) = (w as f32 - r - 0.5, h as f32 - r - 0.5);
    for y in 0..h {
        for x in 0..w {
            let d = ((x as f32 + 0.5 - cx).powi(2) + (y as f32 + 0.5 - cy).powi(2)).sqrt();
            // A transparent ring cuts the dot out of the icon, as Windows draws badges; edges are smoothed.
            let (fill, ring) = ((r - d).clamp(0.0, 1.0), (r + w as f32 * 0.07 - d).clamp(0.0, 1.0));
            if ring == 0.0 {
                continue;
            }
            let i = ((y * w + x) * 4) as usize;
            let kept = rgba[i + 3] as f32 / 255.0 * (1.0 - ring);
            let alpha = kept + fill;
            for c in 0..3 {
                rgba[i + c] = if alpha > 0.0 { ((rgba[i + c] as f32 * kept + colour[c] as f32 * fill) / alpha) as u8 } else { 0 };
            }
            rgba[i + 3] = (alpha.min(1.0) * 255.0) as u8;
        }
    }
    Image::new_owned(rgba, w, h)
}

impl Shared {
    pub fn new(store: Store, items: TrayItems) -> Self {
        Self {
            store,
            folder: Mutex::default(),
            kobo: Mutex::default(),
            watcher: Mutex::default(),
            sync_lock: Mutex::new(()),
            items,
            mark: Mutex::new(None),
        }
    }
}

pub fn start(app: AppHandle, shared: Arc<Shared>) {
    let (a, s) = (app.clone(), shared.clone());
    std::thread::spawn(move || loop {
        scan_once(&a, &s);
        std::thread::sleep(Duration::from_secs(4));
    });
    std::thread::spawn(move || {
        let mut present: Option<String> = None;
        loop {
            let found = kobo::find().and_then(|root| kobo::identify(&root).ok());
            match (&present, &found) {
                (None, Some(device)) => {
                    present = Some(device.id.clone());
                    // Let Windows finish mounting the volume.
                    std::thread::sleep(Duration::from_secs(2));
                    update_kobo(&app, &shared, |k| {
                        *k = KoboState { device: Some(device.clone()), ..KoboState::default() };
                    });
                    if shared.store.settings().is_ok_and(|s| s.kobo_sync) {
                        sync(&app, &shared);
                    }
                }
                (Some(_), None) => {
                    present = None;
                    update_kobo(&app, &shared, |k| *k = KoboState { report: k.report.clone(), ..KoboState::default() });
                }
                _ => {}
            }
            std::thread::sleep(Duration::from_secs(3));
        }
    });
}

/// One look at the watched folder; the interface is told when the list or the folder's state changed.
pub fn scan_once(app: &AppHandle, shared: &Shared) {
    let Ok(settings) = shared.store.settings() else { return };
    let Some(dir) = settings.watch_dir else { return };
    let last = Mutex::new(Instant::now());
    let progress = |done: usize, total: usize| {
        let mut last = last.lock().unwrap();
        if total > 0 && (done == total || last.elapsed() > Duration::from_millis(120)) {
            *last = Instant::now();
            shared.folder.lock().unwrap().reading = (done < total).then_some((done, total));
            let _ = app.emit("folder", shared.folder.lock().unwrap().clone());
        }
    };
    let result = shared.watcher.lock().unwrap().pass(&shared.store, Path::new(&dir), now(), &progress);
    let mut folder = shared.folder.lock().unwrap();
    let before = (folder.error.clone(), folder.last.clone());
    match result {
        Ok(pass) => {
            folder.error = None;
            folder.reading = None;
            // Thumbnails for covers read by an earlier version, and covers for books without one, a few per
            // look so the folder stays responsive.
            let thumbs = shared.store.refresh_thumbs(24).unwrap_or(0);
            let made = shared.store.make_covers(3).unwrap_or(0);
            if pass.changed() || thumbs > 0 || made > 0 {
                let _ = app.emit("library", ());
            }
            folder.last = Some(pass);
        }
        Err(_) => folder.error = Some(format!("{dir} est introuvable.")),
    }
    if (folder.error.clone(), folder.last.clone()) != before {
        let _ = app.emit("folder", folder.clone());
        refresh_tray(shared, &folder, &shared.kobo.lock().unwrap());
    }
}

fn update_kobo(app: &AppHandle, shared: &Shared, change: impl FnOnce(&mut KoboState)) {
    let state = {
        let mut kobo = shared.kobo.lock().unwrap();
        change(&mut kobo);
        kobo.clone()
    };
    let _ = app.emit("kobo", &state);
    refresh_tray(shared, &shared.folder.lock().unwrap(), &state);
}

fn refresh_tray(shared: &Shared, folder: &FolderState, kobo: &KoboState) {
    let (line, mark) = if kobo.syncing {
        ("Synchronisation de la Kobo…".to_string(), Mark::Busy)
    } else if kobo.error.is_some() {
        ("Synchronisation interrompue".into(), Mark::Trouble)
    } else if kobo.device.is_some() && !kobo.ejected {
        match &kobo.report {
            Some(r) if r.count(Outcome::NoSpace) > 0 => ("Kobo branchée · plus de place".into(), Mark::Trouble),
            Some(r) if !r.removable.is_empty() => (format!("Kobo branchée · {} à retirer", plural(r.removable.len(), "livre", "livres")), Mark::Done),
            Some(r) if r.free_bytes < LOW_SPACE => ("Kobo branchée · à jour, presque pleine".into(), Mark::Done),
            Some(_) => ("Kobo branchée · à jour".into(), Mark::Done),
            None => ("Kobo branchée".into(), Mark::Busy),
        }
    } else if folder.error.is_some() {
        ("Dossier de livres introuvable".into(), Mark::Trouble)
    } else {
        ("Vera surveille tes livres".into(), Mark::Quiet)
    };
    let mut current = shared.mark.lock().unwrap();
    if *current != Some(mark) {
        *current = Some(mark);
        let _ = shared.items.tray.set_icon(Some(marked(&shared.items.icon, mark)));
    }
    let _ = shared.items.status.set_text(&line);
    let _ = shared.items.eject.set_enabled(kobo.device.is_some() && !kobo.syncing && !kobo.ejected);
    let _ = shared.items.tray.set_tooltip(Some(format!("Vera — {line}")));
}

/// Synchronises the plugged Kobo, unless a synchronisation is already running.
pub fn sync(app: &AppHandle, shared: &Shared) {
    let Ok(_guard) = shared.sync_lock.try_lock() else { return };
    let Some(device) = shared.kobo.lock().unwrap().device.clone() else { return };
    let settings = shared.store.settings().unwrap_or_default();
    // Read what the folder holds right now, so a book added a moment ago leaves too.
    scan_once(app, shared);
    update_kobo(app, shared, |k| {
        k.syncing = true;
        k.error = None;
        k.step = Some(Step::Reading);
    });
    let tool = std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.join("kepubify.exe"))).filter(|p| p.is_file());
    let options = Options { kepubify: tool, replace_edited: settings.replace_edited };
    let last = Mutex::new(Instant::now());
    let progress = |step: Step| {
        let mut last = last.lock().unwrap();
        let finished = matches!(&step, Step::Sending { done, size, .. } if done == size);
        if finished || !matches!(step, Step::Sending { .. }) || last.elapsed() > Duration::from_millis(120) {
            *last = Instant::now();
            update_kobo(app, shared, |k| k.step = Some(step));
        }
    };
    let result = kobo::sync(&shared.store, &device, &options, &progress);
    match result {
        Ok(mut report) => {
            // Nothing is offered for removal while the folder cannot be read: its books only look gone.
            if shared.folder.lock().unwrap().error.is_some() {
                report.removable.clear();
            }
            notify_report(app, &report);
            notify_removable(app, &report);
            update_kobo(app, shared, |k| {
                k.syncing = false;
                k.step = None;
                k.report = Some(report);
            });
            let _ = app.emit("library", ());
        }
        Err(error) => {
            let _ = app.notification().builder().title("Kobo : synchronisation interrompue").body(&error).show();
            update_kobo(app, shared, |k| {
                k.syncing = false;
                k.step = None;
                k.error = Some(error);
            });
        }
    }
}

fn plural(n: usize, one: &str, many: &str) -> String {
    format!("{n} {}", if n > 1 { many } else { one })
}

/// One notification per synchronisation, at its end, and none when nothing happened.
fn notify_report(app: &AppHandle, report: &Report) {
    let copied: Vec<&str> = report.results.iter().filter(|r| matches!(r.outcome, Outcome::Copied | Outcome::Updated)).map(|r| r.title.as_str()).collect();
    let no_space = report.count(Outcome::NoSpace);
    let failed = report.count(Outcome::Failed);
    let (title, body) = if no_space > 0 {
        (
            format!("Kobo pleine : {} pas pu partir", plural(no_space, "livre n’a", "livres n’ont")),
            format!("Il manque {} Mo. {}", report.missing_bytes.div_ceil(1024 * 1024), if copied.is_empty() { "Libère de la place sur la Kobo, puis rebranche-la.".to_string() } else { "Les autres livres sont bien sur la Kobo.".to_string() }),
        )
    } else if !copied.is_empty() {
        let mut names = copied.iter().take(3).copied().collect::<Vec<_>>().join(", ");
        if copied.len() > 3 {
            names.push_str(&format!(" et {}", plural(copied.len() - 3, "autre", "autres")));
        }
        if report.free_bytes < LOW_SPACE {
            names.push_str(&format!(". Il ne reste que {} Mo sur la Kobo", report.free_bytes / (1024 * 1024)));
        }
        (format!("{} à la Kobo", plural(copied.len(), "livre ajouté", "livres ajoutés")), format!("{names}."))
    } else if failed > 0 {
        (format!("Kobo : {} à vérifier", plural(failed, "livre", "livres")), "Ouvre Vera pour voir lesquels.".into())
    } else {
        return;
    };
    let _ = app.notification().builder().title(title).body(body).show();
}

/// The copies whose book left the folder wait for the owner's word: one notification invites to open Vera.
fn notify_removable(app: &AppHandle, report: &Report) {
    let n = report.removable.len();
    if n == 0 {
        return;
    }
    let _ = app
        .notification()
        .builder()
        .title(format!("{} ton dossier", plural(n, "livre a quitté", "livres ont quitté")))
        .body("Ouvre Vera pour les retirer aussi de la Kobo, ou les garder.")
        .show();
}

/// Removes from the plugged Kobo the copies the owner confirmed (docs/DECISIONS.md, section N).
pub fn remove(app: &AppHandle, hashes: Vec<String>) -> Result<usize, String> {
    let shared = app.state::<Arc<Shared>>();
    let Ok(_guard) = shared.sync_lock.try_lock() else { return Err("La synchronisation n’est pas terminée.".into()) };
    let Some(device) = shared.kobo.lock().unwrap().device.clone() else { return Err("Branche la Kobo pour retirer ces livres.".into()) };
    if shared.folder.lock().unwrap().error.is_some() {
        return Err("Ton dossier de livres est introuvable : rien n’est retiré tant qu’il ne l’est pas.".into());
    }
    let removed = kobo::remove(&shared.store, &device, &hashes, now())?;
    let left = kobo::removable(&shared.store, &device, now())?;
    update_kobo(app, &shared, |k| {
        if let Some(report) = k.report.as_mut() {
            report.removable = left;
        }
    });
    let _ = app.emit("library", ());
    Ok(removed)
}

/// Asks Windows to eject the Kobo, as the Explorer's « Éjecter » does.
pub fn eject(app: &AppHandle) -> Result<(), String> {
    let shared = app.state::<Arc<Shared>>();
    let Some(device) = shared.kobo.lock().unwrap().device.clone() else { return Err("Aucune Kobo branchée.".into()) };
    if shared.kobo.lock().unwrap().syncing {
        return Err("La synchronisation n’est pas terminée.".into());
    }
    update_kobo(app, &shared, |k| k.ejecting = true);
    let result = eject_drive(&device.root);
    update_kobo(app, &shared, |k| {
        k.ejecting = false;
        k.ejected = result.is_ok();
    });
    result
}

fn eject_drive(root: &Path) -> Result<(), String> {
    let drive = root.to_string_lossy().trim_end_matches('\\').to_string();
    if drive.len() != 2 || !drive.ends_with(':') {
        return Err("Lecteur Kobo inattendu.".into());
    }
    let mut command = std::process::Command::new("powershell.exe");
    command.args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        &format!("(New-Object -ComObject Shell.Application).Namespace(17).ParseName('{drive}').InvokeVerb('Eject')"),
    ]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let status = command.status().map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("Windows n’a pas éjecté la Kobo.".into());
    }
    for _ in 0..20 {
        if !root.join(".kobo").join("version").exists() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    Err("La Kobo est toujours montée : ferme les fichiers ouverts dessus, puis réessaie.".into())
}
