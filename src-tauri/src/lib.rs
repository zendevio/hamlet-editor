mod commands;

use std::sync::Mutex;

// ── Managed state ──

/// Shared name table used by save decode commands to un-hash DSON field names.
pub struct NameTableState(pub Mutex<Vec<String>>);

impl Default for NameTableState {
    fn default() -> Self {
        Self(Mutex::new(Vec::new()))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .manage(NameTableState::default())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
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
            commands::assets::load_game_asset,
            commands::names::generate_name_table,
            commands::names::load_localization,
            commands::mods::scan_mod_directories,
            commands::gamedata::load_quirk_library,
            commands::gamedata::load_trinket_library,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
