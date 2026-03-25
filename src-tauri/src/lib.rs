mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
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
      commands::save::decode_save_file,
      commands::save::encode_save_file,
      commands::save::load_profile,
      commands::save::save_profile,
      commands::detect::detect_save_locations,
      commands::detect::detect_game_installations,
      commands::detect::is_game_running,
      commands::detect::validate_save_directory,
      commands::detect::validate_game_directory,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
