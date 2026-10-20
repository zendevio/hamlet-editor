use crate::NameTableState;
use regex::Regex;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use tauri::State;

// ---------------------------------------------------------------------------
// Hardcoded seed names — always present regardless of game path
// ---------------------------------------------------------------------------

const HARDCODED_EVENT_NAMES: &[&str] = &[
    "MONSTER_ENCOUNTERED",
    "AMBUSHED",
    "CURIO_INVESTIGATED",
    "TRAIT_APPLIED",
    "DEATHS_DOOR_APPLIED",
    "ROOM_VISITED",
    "BATTLE_COMPLETED",
    "HALLWAY_STEP_COMPLETED",
    "MONSTER_DEFEATED",
    "UNDEFINED",
];

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Generate a name table by scanning the game installation for known string
/// identifiers used as DSON name hashes.
///
/// Walks `game_path` recursively and collects every unique identifier from
/// 15 file patterns, plus 10 hardcoded event names. Returns a sorted,
/// deduplicated Vec<String>.
#[tauri::command]
pub fn generate_name_table(game_path: String) -> Result<Vec<String>, String> {
    let data_root = resolve_data_root(Path::new(&game_path));
    if !is_data_root(&data_root) {
        return Err(format!(
            "Game data not found at {game_path}. Select a valid game installation."
        ));
    }
    let mut names: HashSet<String> = HashSet::new();

    // Always add hardcoded event names.
    for name in HARDCODED_EVENT_NAMES {
        names.insert(name.to_string());
    }

    // Walk the directory tree, collecting names from each matching file.
    walk_dir(&data_root, &mut names);

    let mut sorted: Vec<String> = names.into_iter().collect();
    sorted.sort();
    Ok(sorted)
}

/// Load localisation strings from the game installation.
///
/// Walks `<game_path>/localization/` and `<game_path>/dlc/*/localization/`
/// for `*.string_table.xml` files and parses each one into a HashMap
/// mapping entry id → display text (CDATA content).
#[tauri::command]
pub fn load_localization(game_path: String) -> Result<HashMap<String, String>, String> {
    let data_root = resolve_data_root(Path::new(&game_path));
    let mut map: HashMap<String, String> = HashMap::new();

    // Base game localization directory.
    let loc_dir = data_root.join("localization");
    if loc_dir.is_dir() {
        scan_localization_dir(&loc_dir, &mut map);
    }

    // DLC localization directories.
    let dlc_dir = data_root.join("dlc");
    if dlc_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&dlc_dir) {
            for entry in entries.flatten() {
                let dlc_path = entry.path();
                if dlc_path.is_dir() {
                    let dlc_loc = dlc_path.join("localization");
                    if dlc_loc.is_dir() {
                        scan_localization_dir(&dlc_loc, &mut map);
                    }
                }
            }
        }
    }

    Ok(map)
}

/// Store the name table in Tauri managed state so that subsequent
/// `load_profile` calls can resolve upgrade tree hashes.
#[tauri::command]
pub fn set_name_table(names: Vec<String>, state: State<'_, NameTableState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;
    guard.version += 1;
    guard.loaded_profile = None;
    guard.loaded_files.clear();
    guard.loaded_fingerprint.clear();
    guard.names = names;
    if guard.names.is_empty() {
        return Err("Name table is empty. Load game data before loading a profile.".to_string());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Name-table scanning helpers
// ---------------------------------------------------------------------------

/// Walk a directory tree and collect name identifiers into `names`.
fn walk_dir(dir: &Path, names: &mut HashSet<String>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_dir(&path, names);
        } else if path.is_file() {
            collect_from_file(&path, names);
        }
    }
}

/// Dispatch to the correct extraction function based on file name / extension.
fn collect_from_file(path: &Path, names: &mut HashSet<String>) {
    let file_name = match path.file_name().and_then(|n| n.to_str()) {
        Some(n) => n,
        None => return,
    };

    // Specific named files first.
    if file_name == "quirk_library.json" {
        extract_quirk_library(path, names);
        return;
    }
    if file_name == "curio_props.csv" {
        extract_curio_props_csv(path, names);
        return;
    }
    if file_name == "obstacle_definitions.json" {
        extract_obstacle_definitions(path, names);
        return;
    }
    if file_name == "quest.plot_quests.json" {
        extract_plot_quests(path, names);
        return;
    }

    // Pattern-matched files by suffix.
    if file_name.ends_with(".info.darkest") {
        // Base filename (strip everything from first `.`)
        if let Some(base) = base_name_no_ext(file_name) {
            names.insert(base);
        }
        return;
    }
    if file_name.ends_with(".upgrades.json") {
        if let Some(base) = base_name_no_ext(file_name) {
            names.insert(base);
        }
        extract_upgrades_json(path, names);
        return;
    }
    if file_name.ends_with(".camping_skills.json") {
        extract_camping_skills_json(path, names);
        return;
    }
    if file_name.ends_with(".dungeon.json") {
        if let Some(base) = base_name_no_ext(file_name) {
            names.insert(base);
        }
        return;
    }
    if file_name.ends_with(".types.json") {
        extract_types_json(path, names);
        return;
    }
    if file_name.ends_with(".building.json") {
        if let Some(base) = base_name_no_ext(file_name) {
            names.insert(base);
        }
        extract_building_json(path, names);
        return;
    }
    if file_name.ends_with(".events.json") {
        if let Some(base) = base_name_no_ext(file_name) {
            names.insert(base);
        }
        extract_events_json(path, names);
        return;
    }
    if file_name.ends_with(".inventory.items.darkest")
        || file_name.ends_with(".inventory.system_configs.darkest")
    {
        extract_inventory_darkest(path, names);
        return;
    }
    if file_name.ends_with(".trinkets.json") {
        extract_trinkets_json(path, names);
        return;
    }
    if file_name.ends_with(".png") {
        extract_tutorial_popup_png(file_name, names);
    }
}

/// Strip everything from the first `.` in `file_name`, returning the base.
/// E.g. `hellion.info.darkest` → `hellion`.
fn base_name_no_ext(file_name: &str) -> Option<String> {
    let base = file_name.split('.').next()?;
    if base.is_empty() {
        None
    } else {
        Some(base.to_string())
    }
}

/// On macOS the actual game data lives inside the app bundle.
/// If the given path doesn't look like a valid data root, probe `_osx/`.
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

// ---------------------------------------------------------------------------
// File-specific extractors
// ---------------------------------------------------------------------------

/// `*.upgrades.json` → full `trees[].id` hashes and their component names.
fn extract_upgrades_json(path: &Path, names: &mut HashSet<String>) {
    let v = read_json(path);
    if let Some(trees) = v.get("trees").and_then(|t| t.as_array()) {
        for tree in trees {
            if let Some(id) = tree.get("id").and_then(|i| i.as_str()) {
                if !id.is_empty() {
                    names.insert(id.to_string());
                }
                for part in id.split('.') {
                    if !part.is_empty() {
                        names.insert(part.to_string());
                    }
                }
            }
        }
    }
}

/// `*.camping_skills.json` → `skills[].id` + `skills[].hero_classes[]` → `class.skill`
fn extract_camping_skills_json(path: &Path, names: &mut HashSet<String>) {
    let v = read_json(path);
    if let Some(skills) = v.get("skills").and_then(|s| s.as_array()) {
        for skill in skills {
            let skill_id = skill.get("id").and_then(|i| i.as_str()).unwrap_or("");
            if !skill_id.is_empty() {
                names.insert(skill_id.to_string());
            }
            if let Some(classes) = skill.get("hero_classes").and_then(|c| c.as_array()) {
                for cls in classes {
                    if let Some(class_str) = cls.as_str() {
                        names.insert(class_str.to_string());
                        if !skill_id.is_empty() {
                            names.insert(format!("{class_str}.{skill_id}"));
                        }
                    }
                }
            }
        }
    }
}

/// `*.types.json` → parse `types[].id` and `goals[].id`
fn extract_types_json(path: &Path, names: &mut HashSet<String>) {
    let v = read_json(path);
    for key in &["types", "goals"] {
        if let Some(arr) = v.get(key).and_then(|a| a.as_array()) {
            for item in arr {
                if let Some(id) = item.get("id").and_then(|i| i.as_str()) {
                    if !id.is_empty() {
                        names.insert(id.to_string());
                    }
                }
            }
        }
    }
}

/// `quirk_library.json` → `quirks[].id`
fn extract_quirk_library(path: &Path, names: &mut HashSet<String>) {
    let v = read_json(path);
    if let Some(quirks) = v.get("quirks").and_then(|q| q.as_array()) {
        for quirk in quirks {
            if let Some(id) = quirk.get("id").and_then(|i| i.as_str()) {
                if !id.is_empty() {
                    names.insert(id.to_string());
                }
            }
        }
    }
}

/// `*.building.json` → `data.activities[].id`
fn extract_building_json(path: &Path, names: &mut HashSet<String>) {
    let v = read_json(path);
    if let Some(activities) = v
        .get("data")
        .and_then(|d| d.get("activities"))
        .and_then(|a| a.as_array())
    {
        for activity in activities {
            if let Some(id) = activity.get("id").and_then(|i| i.as_str()) {
                if !id.is_empty() {
                    names.insert(id.to_string());
                }
            }
        }
    }
}

/// `*.events.json` → `events[].id`
fn extract_events_json(path: &Path, names: &mut HashSet<String>) {
    let v = read_json(path);
    if let Some(events) = v.get("events").and_then(|e| e.as_array()) {
        for event in events {
            if let Some(id) = event.get("id").and_then(|i| i.as_str()) {
                if !id.is_empty() {
                    names.insert(id.to_string());
                }
            }
        }
    }
}

/// `*.inventory.items.darkest` / `*.inventory.system_configs.darkest` →
/// regex `inventory_item:.*\.type\s+"([^"]+)".*\.id\s+"([^"]+)"`
fn extract_inventory_darkest(path: &Path, names: &mut HashSet<String>) {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return,
    };

    // Build regexes once (performance note: these are compiled per-file call,
    // but game files number in the dozens so it's acceptable).
    let re_type = Regex::new(r#"\.type\s+"([^"]+)""#).unwrap();
    let re_id = Regex::new(r#"\.id\s+"([^"]+)""#).unwrap();

    // Collect types and ids independently as the format may span multiple lines
    // within a single inventory_item block.
    for cap in re_type.captures_iter(&content) {
        if let Some(m) = cap.get(1) {
            names.insert(m.as_str().to_string());
        }
    }
    for cap in re_id.captures_iter(&content) {
        if let Some(m) = cap.get(1) {
            names.insert(m.as_str().to_string());
        }
    }
}

/// `*.trinkets.json` → `entries[].id`
fn extract_trinkets_json(path: &Path, names: &mut HashSet<String>) {
    let v = read_json(path);
    if let Some(entries) = v.get("entries").and_then(|e| e.as_array()) {
        for entry in entries {
            if let Some(id) = entry.get("id").and_then(|i| i.as_str()) {
                if !id.is_empty() {
                    names.insert(id.to_string());
                }
            }
        }
    }
}

/// `curio_props.csv` → first column of each row (skip header row).
fn extract_curio_props_csv(path: &Path, names: &mut HashSet<String>) {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return,
    };
    for (i, line) in content.lines().enumerate() {
        if i == 0 {
            // Skip header row.
            continue;
        }
        if let Some(first_col) = line.split(',').next() {
            let trimmed = first_col.trim();
            if !trimmed.is_empty() {
                names.insert(trimmed.to_string());
            }
        }
    }
}

/// `obstacle_definitions.json` → `props[].name`
fn extract_obstacle_definitions(path: &Path, names: &mut HashSet<String>) {
    let v = read_json(path);
    if let Some(props) = v.get("props").and_then(|p| p.as_array()) {
        for prop in props {
            if let Some(name) = prop.get("name").and_then(|n| n.as_str()) {
                if !name.is_empty() {
                    names.insert(name.to_string());
                }
            }
        }
    }
}

/// `quest.plot_quests.json` → `plot_quests[].id`
fn extract_plot_quests(path: &Path, names: &mut HashSet<String>) {
    let v = read_json(path);
    if let Some(quests) = v.get("plot_quests").and_then(|q| q.as_array()) {
        for quest in quests {
            if let Some(id) = quest.get("id").and_then(|i| i.as_str()) {
                if !id.is_empty() {
                    names.insert(id.to_string());
                }
            }
        }
    }
}

/// `*.png` → regex `tutorial_popup\.([a-z_]+)\.png` from filename
fn extract_tutorial_popup_png(file_name: &str, names: &mut HashSet<String>) {
    let re = Regex::new(r"tutorial_popup\.([a-z_]+)\.png").unwrap();
    if let Some(cap) = re.captures(file_name) {
        if let Some(m) = cap.get(1) {
            names.insert(m.as_str().to_string());
        }
    }
}

/// Read a file as JSON, returning `serde_json::Value::Null` on any error.
fn read_json(path: &Path) -> serde_json::Value {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::Value::Null)
}

// ---------------------------------------------------------------------------
// Localization helpers
// ---------------------------------------------------------------------------

/// Scan a localization directory for `*.string_table.xml` files.
fn scan_localization_dir(dir: &Path, map: &mut HashMap<String, String>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.ends_with(".string_table.xml") {
                    parse_string_table(&path, map, "english");
                }
            }
        }
    }
}

/// Parse a `*.string_table.xml` file extracting `id → CDATA` pairs.
///
/// Only entries inside the `<language id="{language}">` block are collected.
/// Entries from other language blocks are skipped so that later languages
/// (e.g. Korean) do not overwrite English entries.
///
/// Expected format:
/// ```xml
/// <language id="english">
///   <entry id="KEY"><![CDATA[display text]]></entry>
/// </language>
/// ```
fn parse_string_table(path: &Path, map: &mut HashMap<String, String>, language: &str) {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return,
    };

    let re_lang_open = Regex::new(r#"<language id="([^"]+)">"#).unwrap();
    let re_lang_close = Regex::new(r"</language>").unwrap();
    let re_entry = Regex::new(r#"<entry id="([^"]+)"><!\[CDATA\[([^\]]*)\]\]></entry>"#).unwrap();

    // Walk through the file tracking which language block we are inside.
    // We collect byte positions of language open/close tags, then only extract
    // entries that fall within the target language's span.
    struct Span {
        start: usize,
        end: usize,
    }

    let mut target_spans: Vec<Span> = Vec::new();
    let mut open_stack: Vec<(usize, bool)> = Vec::new(); // (start_pos, is_target)

    for cap in re_lang_open.captures_iter(&content) {
        let is_target = &cap[1] == language;
        let start = cap.get(0).unwrap().start();
        open_stack.push((start, is_target));
    }

    // Match close tags in order and pair with open tags.
    let closes: Vec<usize> = re_lang_close.find_iter(&content).map(|m| m.end()).collect();

    for (i, close_end) in closes.iter().enumerate() {
        if let Some((start, is_target)) = open_stack.get(i) {
            if *is_target {
                target_spans.push(Span {
                    start: *start,
                    end: *close_end,
                });
            }
        }
    }

    // If no language blocks were found at all (flat format without <language> wrappers),
    // fall back to parsing the whole file so older/simpler string tables still work.
    if open_stack.is_empty() {
        for cap in re_entry.captures_iter(&content) {
            let id = cap[1].to_string();
            let text = cap[2].to_string();
            map.insert(id, text);
        }
        return;
    }

    for cap in re_entry.captures_iter(&content) {
        let entry_pos = cap.get(0).unwrap().start();
        let in_target = target_spans
            .iter()
            .any(|s| entry_pos >= s.start && entry_pos < s.end);
        if in_target {
            let id = cap[1].to_string();
            let text = cap[2].to_string();
            map.insert(id, text);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_full_upgrade_tree_ids_and_parts() {
        let dir = std::env::temp_dir().join(format!("hamlet-names-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("abbey.upgrades.json");
        std::fs::write(
            &path,
            r#"{"trees":[{"id":"abbey.meditation"},{"id":"camping_trainer.cost"},{"id":""},{}]}"#,
        )
        .unwrap();
        let mut names = HashSet::new();
        collect_from_file(&path, &mut names);
        assert_eq!(
            names,
            HashSet::from(
                [
                    "abbey",
                    "meditation",
                    "abbey.meditation",
                    "camping_trainer",
                    "cost",
                    "camping_trainer.cost"
                ]
                .map(str::to_string)
            )
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn invalid_game_directory_does_not_produce_a_seed_only_table() {
        let error = generate_name_table("/nonexistent/hamlet-game-data".to_string()).unwrap_err();
        assert!(error.contains("Game data not found"));
    }
}
