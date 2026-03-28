use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// HP stats per armour rank (ranks 0-4) for a hero class, parsed from the
/// class's `.info.darkest` file.
#[derive(Debug, Serialize)]
pub struct ClassStats {
    pub class_id: String,
    pub hp_by_rank: Vec<i32>,
}

/// All available skill IDs for a hero class, parsed from game data files.
#[derive(Debug, Serialize)]
pub struct ClassSkills {
    pub class_id: String,
    pub combat_skills: Vec<String>,
    pub camping_skills: Vec<String>,
}

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

/// Load hero class HP stats from `heroes/<class>/<class>.info.darkest` files.
///
/// Parses the `armour:` lines in each file and extracts the `.hp` value for
/// armour ranks 0-4. Handles base-game classes, plus the three DLC classes:
/// Flagellant (Crimson Court), Shieldbreaker, and Musketeer.
///
/// Missing or malformed files are silently skipped.
#[tauri::command]
pub fn load_class_stats(game_path: String) -> Result<Vec<ClassStats>, String> {
    let data_root = resolve_data_root(Path::new(&game_path));
    let mut stats: Vec<ClassStats> = Vec::new();

    // Collect (class_id, path_to_info_darkest) pairs.
    let mut candidates: Vec<(String, PathBuf)> = Vec::new();

    // Base-game heroes: heroes/<class>/<class>.info.darkest
    let heroes_dir = data_root.join("heroes");
    if heroes_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&heroes_dir) {
            for entry in entries.flatten() {
                let class_dir = entry.path();
                if class_dir.is_dir() {
                    if let Some(class_id) = class_dir.file_name().and_then(|n| n.to_str()) {
                        let darkest = class_dir.join(format!("{class_id}.info.darkest"));
                        candidates.push((class_id.to_string(), darkest));
                    }
                }
            }
        }
    }

    // DLC heroes with non-standard paths.
    let dlc_extras = [
        (
            "flagellant",
            "dlc/580100_crimson_court/features/flagellant/heroes/flagellant/flagellant.info.darkest",
        ),
        (
            "shieldbreaker",
            "dlc/702540_shieldbreaker/heroes/shieldbreaker/shieldbreaker.info.darkest",
        ),
        (
            "musketeer",
            "dlc/445700_musketeer/heroes/musketeer/musketeer.info.darkest",
        ),
    ];
    for (class_id, rel_path) in &dlc_extras {
        let full = data_root.join(rel_path);
        // Only add if not already found under heroes/.
        if !candidates.iter().any(|(id, _)| id == class_id) {
            candidates.push((class_id.to_string(), full));
        }
    }

    // Parse each candidate file.
    let re = Regex::new(r"armour:\s+.*?\.hp\s+(\d+)").unwrap();
    for (class_id, path) in candidates {
        if let Some(class_stats) = parse_darkest_armour_hp(&class_id, &path, &re) {
            stats.push(class_stats);
        }
    }

    Ok(stats)
}

/// Load combat and camping skill IDs for every hero class.
///
/// **Combat skills** are parsed from `heroes/<class>/<class>.info.darkest`
/// (plus the three DLC paths). The regex extracts unique skill IDs from
/// `combat_skill: .id "..."` lines; duplicate IDs (same skill at multiple
/// upgrade levels) are deduplicated while preserving first-seen order.
///
/// **Camping skills** are parsed from `raid/camping/*.camping_skills.json`.
/// Each file lists skills with their `hero_classes` arrays; the function
/// inverts this to build a per-class list.
///
/// Missing or malformed files are silently skipped.
#[tauri::command]
pub fn load_class_skills(game_path: String) -> Result<Vec<ClassSkills>, String> {
    let data_root = resolve_data_root(Path::new(&game_path));

    // ── 1. Collect (class_id, path_to_info_darkest) candidates ──────────────
    let mut candidates: Vec<(String, PathBuf)> = Vec::new();

    let heroes_dir = data_root.join("heroes");
    if heroes_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&heroes_dir) {
            for entry in entries.flatten() {
                let class_dir = entry.path();
                if class_dir.is_dir() {
                    if let Some(class_id) = class_dir.file_name().and_then(|n| n.to_str()) {
                        let darkest = class_dir.join(format!("{class_id}.info.darkest"));
                        candidates.push((class_id.to_string(), darkest));
                    }
                }
            }
        }
    }

    let dlc_extras = [
        (
            "flagellant",
            "dlc/580100_crimson_court/features/flagellant/heroes/flagellant/flagellant.info.darkest",
        ),
        (
            "shieldbreaker",
            "dlc/702540_shieldbreaker/heroes/shieldbreaker/shieldbreaker.info.darkest",
        ),
        (
            "musketeer",
            "dlc/445700_musketeer/heroes/musketeer/musketeer.info.darkest",
        ),
    ];
    for (class_id, rel_path) in &dlc_extras {
        let full = data_root.join(rel_path);
        if !candidates.iter().any(|(id, _)| id == class_id) {
            candidates.push((class_id.to_string(), full));
        }
    }

    // ── 2. Parse combat skills from each .info.darkest file ─────────────────
    let combat_re = Regex::new(r#"combat_skill:\s+\.id\s+"([^"]+)""#).unwrap();
    // Map from class_id -> ClassSkills (combat filled, camping empty for now).
    let mut map: std::collections::HashMap<String, ClassSkills> =
        std::collections::HashMap::new();

    for (class_id, path) in &candidates {
        let content = match std::fs::read_to_string(path) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut combat_skills: Vec<String> = Vec::new();
        for cap in combat_re.captures_iter(&content) {
            if let Some(id) = cap.get(1).map(|m| m.as_str().to_string()) {
                if seen.insert(id.clone()) {
                    combat_skills.push(id);
                }
            }
        }
        if !combat_skills.is_empty() {
            map.insert(
                class_id.clone(),
                ClassSkills {
                    class_id: class_id.clone(),
                    combat_skills,
                    camping_skills: Vec::new(),
                },
            );
        }
    }

    // ── 3. Parse camping skills from raid/camping/*.camping_skills.json ──────
    let camping_dir = data_root.join("raid/camping");
    if camping_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&camping_dir) {
            for entry in entries.flatten() {
                let fp = entry.path();
                if fp.is_file() {
                    if let Some(name) = fp.file_name().and_then(|n| n.to_str()) {
                        if name.ends_with(".camping_skills.json") {
                            parse_camping_skills_file(&fp, &mut map);
                        }
                    }
                }
            }
        }
    }

    // ── 4. Collect into a sorted Vec ─────────────────────────────────────────
    let mut result: Vec<ClassSkills> = map.into_values().collect();
    result.sort_by(|a, b| a.class_id.cmp(&b.class_id));

    Ok(result)
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

/// Parse a `.info.darkest` file and extract HP values from `armour:` lines.
/// Returns `None` if the file cannot be read or contains no armour entries.
fn parse_darkest_armour_hp(class_id: &str, path: &Path, re: &Regex) -> Option<ClassStats> {
    let content = std::fs::read_to_string(path).ok()?;
    let hp_by_rank: Vec<i32> = re
        .captures_iter(&content)
        .filter_map(|cap| cap.get(1)?.as_str().parse::<i32>().ok())
        .collect();
    if hp_by_rank.is_empty() {
        return None;
    }
    Some(ClassStats { class_id: class_id.to_string(), hp_by_rank })
}

/// Parse a `*.camping_skills.json` file and append skill IDs to the
/// per-class entries already present in `map`. Classes not yet in `map`
/// (i.e. no `.info.darkest` was found for them) are skipped.
/// Silently returns if the file does not exist or cannot be parsed.
fn parse_camping_skills_file(
    path: &Path,
    map: &mut std::collections::HashMap<String, ClassSkills>,
) {
    let v = read_json(path);
    let skills = match v.get("skills").and_then(|s| s.as_array()) {
        Some(arr) => arr,
        None => return,
    };
    for skill in skills {
        let skill_id = match skill.get("id").and_then(|i| i.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => continue,
        };
        let hero_classes = match skill.get("hero_classes").and_then(|c| c.as_array()) {
            Some(arr) => arr,
            None => continue,
        };
        for class_val in hero_classes {
            let class_id = match class_val.as_str() {
                Some(s) if !s.is_empty() => s,
                _ => continue,
            };
            if let Some(entry) = map.get_mut(class_id) {
                if !entry.camping_skills.contains(&skill_id) {
                    entry.camping_skills.push(skill_id.clone());
                }
            }
        }
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
