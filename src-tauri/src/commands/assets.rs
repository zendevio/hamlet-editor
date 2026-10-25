use super::error::AppError;
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
) -> Result<Vec<u8>, AppError> {
    let base = PathBuf::from(&game_path);
    let relative = Path::new(&asset_relative_path);

    // Primary probe: game_path is already the data root.
    let primary_path = base.join(relative);
    if primary_path.is_file() {
        let resolved = std::fs::canonicalize(&primary_path).map_err(|e| {
            AppError::new("asset_missing")
                .param("path", asset_relative_path.clone())
                .param("gamePath", game_path.clone())
                .detail(e)
        })?;
        let base_canon = std::fs::canonicalize(&base).map_err(|e| {
            AppError::new("game_path_invalid")
                .param("path", game_path.clone())
                .detail(e)
        })?;
        if !resolved.starts_with(&base_canon) {
            return Err(AppError::new("asset_path_invalid"));
        }
        return std::fs::read(&resolved).map_err(|e| {
            AppError::new("asset_read")
                .param("path", resolved.display().to_string())
                .detail(e)
        });
    }

    // macOS fallback: game_path might be the Steam install root rather than
    // the resolved data root.  Probe the app bundle sub-path.
    #[cfg(target_os = "macos")]
    {
        let osx_data = base.join("_osx/Darkest.app/Contents/Resources/data");
        let fallback_path = osx_data.join(relative);
        if fallback_path.is_file() {
            let resolved = std::fs::canonicalize(&fallback_path).map_err(|e| {
                AppError::new("asset_missing")
                    .param("path", asset_relative_path.clone())
                    .param("gamePath", game_path.clone())
                    .detail(e)
            })?;
            let base_canon = std::fs::canonicalize(&base).map_err(|e| {
                AppError::new("game_path_invalid")
                    .param("path", game_path.clone())
                    .detail(e)
            })?;
            if !resolved.starts_with(&base_canon) {
                return Err(AppError::new("asset_path_invalid"));
            }
            return std::fs::read(&resolved).map_err(|e| {
                AppError::new("asset_read")
                    .param("path", resolved.display().to_string())
                    .detail(e)
            });
        }
    }

    Err(AppError::new("asset_missing")
        .param("path", asset_relative_path)
        .param("gamePath", game_path))
}

#[cfg(test)]
mod error_tests {
    use super::*;

    #[test]
    fn missing_asset_has_both_requested_paths() {
        let root = std::env::temp_dir().join(super::super::transaction::unique_suffix());
        let error = load_game_asset(root.display().to_string(), "missing.png".into()).unwrap_err();
        assert_eq!(
            error,
            AppError::new("asset_missing")
                .param("path", "missing.png")
                .param("gamePath", root.display().to_string())
        );
    }

    #[cfg(unix)]
    #[test]
    fn asset_traversal_remains_blocked() {
        let root = std::env::temp_dir().join(super::super::transaction::unique_suffix());
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("outside.png"), b"fixture").unwrap();
        let inside = root.join("game");
        std::fs::create_dir(&inside).unwrap();
        let error =
            load_game_asset(inside.display().to_string(), "../outside.png".into()).unwrap_err();
        assert_eq!(error, AppError::new("asset_path_invalid"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
