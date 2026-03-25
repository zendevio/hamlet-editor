use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Read a file from the game installation directory and return its raw bytes.
///
/// `game_path` is the validated game data root (already resolved by
/// `detect_game_installations` / `validate_game_directory`).
/// `asset_relative_path` is a forward-slash-separated path relative to that
/// root, e.g. `"heroes/crusader/skins/default/crusader.icon.png"`.
///
/// On macOS, if reading from `game_path` directly fails, the function
/// transparently probes `_osx/Darkest.app/Contents/Resources/data/` under
/// the same root before giving up.
#[tauri::command]
pub fn load_game_asset(
    game_path: String,
    asset_relative_path: String,
) -> Result<Vec<u8>, String> {
    let base = PathBuf::from(&game_path);
    let relative = Path::new(&asset_relative_path);

    // Primary probe: game_path is already the data root.
    let primary = base.join(relative);
    if primary.is_file() {
        return std::fs::read(&primary)
            .map_err(|e| format!("Failed to read asset '{}': {}", primary.display(), e));
    }

    // macOS fallback: game_path might be the Steam install root rather than
    // the resolved data root.  Probe the app bundle sub-path.
    #[cfg(target_os = "macos")]
    {
        let osx_data = base.join("_osx/Darkest.app/Contents/Resources/data");
        let fallback = osx_data.join(relative);
        if fallback.is_file() {
            return std::fs::read(&fallback).map_err(|e| {
                format!("Failed to read asset '{}': {}", fallback.display(), e)
            });
        }
    }

    Err(format!(
        "Asset not found: '{}'  (game_path: '{}')",
        asset_relative_path, game_path
    ))
}
