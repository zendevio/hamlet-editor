mod commands;

pub use commands::{backup, save};

use std::path::PathBuf;
use std::sync::Mutex;

// ── Managed state ──

/// Upgrade reference names and the provenance of the loaded profile.
#[derive(Default)]
pub struct NameTable {
    pub names: Vec<String>,
    pub version: u64,
    pub loaded_profile: Option<PathBuf>,
    pub loaded_fingerprint: std::collections::BTreeMap<PathBuf, [u8; 32]>,
    pub loaded_files: std::collections::HashMap<String, commands::save::LoadedSave>,
}

pub struct NameTableState(pub Mutex<NameTable>);

impl Default for NameTableState {
    fn default() -> Self {
        Self(Mutex::new(NameTable::default()))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .manage(NameTableState::default())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Optional startup window mode for test runs:
            // HAMLET_WINDOW=maximized | fullscreen. Unset keeps the configured size.
            // Set the initial native window state before the single visible build.
            // macOS queues maximize/fullscreen requests on an existing window.
            let config = app
                .config()
                .app
                .windows
                .first()
                .ok_or("Missing main window config")?;
            let mut window = tauri::WebviewWindowBuilder::from_config(app, config)?.visible(true);
            if let Ok(mode) = std::env::var("HAMLET_WINDOW") {
                window = match mode.as_str() {
                    "maximized" => window.maximized(true),
                    "fullscreen" => window.fullscreen(true),
                    other => {
                        log::warn!("Ignoring unknown HAMLET_WINDOW value: {other}");
                        window
                    }
                };
            }
            window.build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::names::set_name_table,
            commands::save::load_profile,
            commands::save::save_profile,
            commands::detect::detect_save_locations,
            commands::detect::detect_game_installations,
            commands::detect::is_game_running,
            commands::detect::validate_save_directory,
            commands::detect::validate_game_directory,
            commands::detect::list_profiles,
            commands::backup::create_backup,
            commands::backup::list_backups,
            commands::backup::restore_backup,
            commands::backup::restore_game_backup,
            commands::backup::open_backup_folder,
            commands::assets::load_game_asset,
            commands::names::generate_name_table,
            commands::names::load_localization,
            commands::mods::scan_mod_directories,
            commands::gamedata::load_quirk_library,
            commands::gamedata::load_trinket_library,
            commands::gamedata::load_class_stats,
            commands::gamedata::load_class_skills,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
