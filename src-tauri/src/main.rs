#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
//! Vera's Windows shell around vera-core: the window, the tray icon, Windows notifications, and two background
//! loops — the watched folder and the Kobo. Every rule about books lives in vera-core.
mod background;
mod commands;
mod share;
mod update;

use background::Shared;
use std::sync::Arc;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};
use tauri_plugin_autostart::ManagerExt as _;
use vera_core::store::Store;

pub fn open_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    } else if let Ok(builder) = tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0]) {
        let _ = builder.build();
    }
}

fn main() {
    let autostarted = std::env::args().any(|a| a == "--autostart");
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| open_window(app)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::Builder::new().app_name("Vera").arg("--autostart").build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::state,
            commands::library,
            commands::detail,
            commands::save_card,
            commands::lookup,
            commands::save_settings,
            commands::choose_folder,
            commands::suggest_folder,
            commands::sync_now,
            commands::eject,
            commands::kobo_remove,
            commands::reveal,
            commands::open_folder,
            commands::open_data,
            commands::quit,
            commands::dismiss_twins,
            commands::journal,
            commands::annotations,
            commands::export_annotations,
            commands::book_file,
            commands::reading_position,
            commands::save_reading,
            share::share_prepare,
            share::share_targets,
            share::share_mail_provider,
            share::share_mail_setup,
            share::share_mail_forget,
            share::share_mail_send,
            share::share_discord_add,
            share::share_discord_remove,
            share::share_discord_send,
            share::share_copy,
            share::share_open,
            share::share_reveal,
            share::share_save,
            share::share_guide_open,
            share::share_guide_recopy,
            share::share_guide_close,
            update::update_status,
            update::update_check,
            update::update_install,
        ])
        .setup(move |app| {
            let root = app.path().app_data_dir()?;
            let store = Store::open(root).map_err(|error| {
                use tauri_plugin_dialog::DialogExt;
                app.dialog()
                    .message(format!("{error}\nRien n’a été modifié ni supprimé."))
                    .title("Vera — catalogue inaccessible")
                    .blocking_show();
                std::io::Error::other(error)
            })?;
            app.asset_protocol_scope().allow_directory(store.root.join("covers"), false)?;
            let settings = store.settings().map_err(std::io::Error::other)?;
            if !cfg!(debug_assertions) {
                let _ = if settings.autostart { app.autolaunch().enable() } else { app.autolaunch().disable() };
            }

            let status = MenuItem::with_id(app, "status", "Vera", false, None::<&str>)?;
            let eject = MenuItem::with_id(app, "eject", "Éjecter la Kobo", false, None::<&str>)?;
            let update = MenuItem::with_id(app, "update", "Vera est à jour", false, None::<&str>)?;
            let open = MenuItem::with_id(app, "open", "Ouvrir Vera", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quitter Vera", true, None::<&str>)?;
            let separator = tauri::menu::PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&status, &eject, &update, &open, &separator, &quit])?;
            // The notification area gets the logo's small optical size (sturdier hairlines, no chain).
            let icon = Image::from_bytes(include_bytes!("../icons/tray.png"))?.to_owned();
            let tray = TrayIconBuilder::with_id("vera")
                .tooltip("Vera")
                .icon(icon.clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => open_window(app),
                    "update" => {
                        open_window(app);
                        let _ = tauri::Emitter::emit(app, "show-update", ());
                    }
                    "eject" => {
                        let app = app.clone();
                        std::thread::spawn(move || background::eject(&app));
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                        open_window(tray.app_handle());
                    }
                })
                .build(app)?;

            let shared = Arc::new(Shared::new(store, background::TrayItems { status, eject, update, tray, icon }));
            app.manage(shared.clone());
            background::start(app.handle().clone(), shared);
            update::start(app.handle().clone());
            if !autostarted {
                open_window(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window keeps Vera running in the notification area, without the window's memory.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Some(window) = window.app_handle().get_webview_window(window.label()) {
                    let _ = window.destroy();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("Démarrage de Vera")
        .run(|_, event| {
            if let tauri::RunEvent::ExitRequested { code: None, api, .. } = event {
                api.prevent_exit();
            }
        });
}
