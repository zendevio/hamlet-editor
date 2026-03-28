use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
pub struct QuirkDef {
    pub id: String,
    pub is_positive: bool,
    pub is_disease: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TrinketDef {
    pub id: String,
    pub rarity: Option<String>,
    pub class_restriction: Option<String>,
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Load all quirk definitions from the game's quirk library JSON files.
///
/// Reads the base quirk library plus any DLC quirk libraries found in the
/// game directory. Returns an empty Vec if no files are found.
#[tauri::command]
pub fn load_quirk_library(game_path: String) -> Result<Vec<QuirkDef>, String> {
    let data_root = resolve_data_root(Path::new(&game_path));
    let mut quirks: Vec<QuirkDef> = Vec::new();

    // Base game quirk library
    let base = data_root.join("shared/quirk/quirk_library.json");
    parse_quirk_library(&base, &mut quirks);

    // DLC: Crimson Court
    let cc = data_root.join(
        "dlc/580100_crimson_court/features/crimson_court/shared/quirk/crimson_court.quirk_library.json",
    );
    parse_quirk_library(&cc, &mut quirks);

    // DLC: Color of Madness
    let com = data_root.join("dlc/735730_color_of_madness/shared/quirk/com.quirk_library.json");
    parse_quirk_library(&com, &mut quirks);

    Ok(quirks)
}

/// Load all trinket definitions from the game's trinket JSON files.
///
/// Reads the base trinket file plus any DLC trinket files found in the
/// game directory. Returns an empty Vec if no files are found.
#[tauri::command]
pub fn load_trinket_library(game_path: String) -> Result<Vec<TrinketDef>, String> {
    let data_root = resolve_data_root(Path::new(&game_path));
    let mut trinkets: Vec<TrinketDef> = Vec::new();

    // Base game trinkets
    let base = data_root.join("trinkets/base.entries.trinkets.json");
    parse_trinket_file(&base, &mut trinkets);

    // DLC trinket files: scan dlc/*/trinkets/*.trinkets.json
    let dlc_dir = data_root.join("dlc");
    if dlc_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&dlc_dir) {
            for entry in entries.flatten() {
                let dlc_path = entry.path();
                if dlc_path.is_dir() {
                    let trinkets_dir = dlc_path.join("trinkets");
                    if trinkets_dir.is_dir() {
                        if let Ok(files) = std::fs::read_dir(&trinkets_dir) {
                            for file in files.flatten() {
                                let fp = file.path();
                                if fp.is_file() {
                                    if let Some(name) = fp.file_name().and_then(|n| n.to_str()) {
                                        if name.ends_with(".trinkets.json") {
                                            parse_trinket_file(&fp, &mut trinkets);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(trinkets)
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/// Parse a quirk library JSON file and append results into `out`.
/// Silently returns if the file does not exist or cannot be parsed.
fn parse_quirk_library(path: &Path, out: &mut Vec<QuirkDef>) {
    let v = read_json(path);
    let quirks = match v.get("quirks").and_then(|q| q.as_array()) {
        Some(arr) => arr,
        None => return,
    };
    for quirk in quirks {
        let id = match quirk.get("id").and_then(|i| i.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => continue,
        };
        let is_positive = quirk
            .get("is_positive")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let is_disease = quirk
            .get("is_disease")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        out.push(QuirkDef { id, is_positive, is_disease });
    }
}

/// Parse a trinkets JSON file and append results into `out`.
/// Silently returns if the file does not exist or cannot be parsed.
fn parse_trinket_file(path: &Path, out: &mut Vec<TrinketDef>) {
    let v = read_json(path);
    let entries = match v.get("entries").and_then(|e| e.as_array()) {
        Some(arr) => arr,
        None => return,
    };
    for entry in entries {
        let id = match entry.get("id").and_then(|i| i.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => continue,
        };
        let rarity = entry
            .get("rarity")
            .and_then(|r| r.as_str())
            .map(|s| s.to_string());
        let class_restriction = entry
            .get("hero_class_requirements")
            .and_then(|c| c.as_array())
            .and_then(|arr| arr.first())
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        out.push(TrinketDef { id, rarity, class_restriction });
    }
}

// ---------------------------------------------------------------------------
// Path helpers (mirrors names.rs)
// ---------------------------------------------------------------------------

fn resolve_data_root(install_dir: &Path) -> PathBuf {
    if is_data_root(install_dir) {
        return install_dir.to_path_buf();
    }
    let osx_data = install_dir.join("_osx/Darkest.app/Contents/Resources/data");
    if is_data_root(&osx_data) {
        return osx_data;
    }
    install_dir.to_path_buf()
}

fn is_data_root(dir: &Path) -> bool {
    dir.join("heroes").is_dir()
        || dir.join("campaign").is_dir()
        || dir.join("localization").is_dir()
}

fn read_json(path: &Path) -> serde_json::Value {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::Value::Null)
}
