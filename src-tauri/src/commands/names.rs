use crate::NameTableState;
use regex::Regex;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
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

pub const GAME_TEXT_LANGUAGES: &[&str] = &[
    "english",
    "french",
    "german",
    "spanish",
    "italian",
    "brazilian",
    "polish",
    "czech",
    "russian",
    "schinese",
    "japanese",
    "koreana",
];

/// Load display text with per-key English fallback, outside the main thread.
#[tauri::command(async)]
pub fn load_localization(
    game_path: String,
    language: String,
) -> Result<HashMap<String, String>, String> {
    if !GAME_TEXT_LANGUAGES.contains(&language.as_str()) {
        return Err(format!("Unknown game text language: {language}"));
    }
    let files = localization_files(&resolve_data_root(Path::new(&game_path)));
    let mut english = HashMap::new();
    let mut translated = HashMap::new();
    let mut arena_english = HashMap::new();
    let mut arena_translated = HashMap::new();
    // Read each file once; campaign text, even its English fallback, takes
    // precedence over arena definitions of campaign keys.
    for path in files {
        if let Ok(content) = std::fs::read_to_string(&path) {
            let (fallback, selected) = if is_arena_table(&path) {
                (&mut arena_english, &mut arena_translated)
            } else {
                (&mut english, &mut translated)
            };
            parse_string_table(&content, fallback, "english");
            if language != "english" {
                parse_string_table(&content, selected, &language);
            }
        }
    }
    arena_english.extend(arena_translated);
    arena_english.extend(english);
    arena_english.extend(translated);
    Ok(arena_english)
}

/// Discover supported installed language blocks outside the main thread.
#[tauri::command(async)]
pub fn available_game_text_languages(game_path: String) -> Vec<String> {
    let mut found = HashSet::from(["english".to_string()]);
    for path in localization_files(&resolve_data_root(Path::new(&game_path))) {
        // Arena text ranks below campaign English, so it cannot make a language usable.
        if is_arena_table(&path) {
            continue;
        }
        if let Ok(content) = std::fs::read_to_string(path) {
            found.extend(languages_with_text(&content));
        }
    }
    GAME_TEXT_LANGUAGES
        .iter()
        .filter(|id| found.contains(**id))
        .map(|id| id.to_string())
        .collect()
}

fn localization_files(root: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![root.join("localization")];
    if let Ok(entries) = std::fs::read_dir(root.join("dlc")) {
        let mut dlcs: Vec<_> = entries
            .flatten()
            .map(|entry| entry.path().join("localization"))
            .collect();
        dlcs.sort();
        dirs.extend(dlcs);
    }
    let mut files = Vec::new();
    for dir in dirs {
        if let Ok(entries) = std::fs::read_dir(dir) {
            let mut paths: Vec<_> = entries
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| {
                    path.is_file()
                        && path
                            .file_name()
                            .and_then(|name| name.to_str())
                            .is_some_and(|name| name.ends_with(".string_table.xml"))
                })
                .collect();
            paths.sort();
            files.extend(paths);
        }
    }
    files
}

fn is_arena_table(path: &Path) -> bool {
    path.components()
        .any(|part| part.as_os_str() == "1117860_arena_mp")
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

// Shared by discovery and parsing, including empty/self-closing language blocks.
static LANGUAGE_TAG: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"<language\s+id="([^"]+)"\s*(/?)>|</language\s*>"#).unwrap());
static ENTRY_OPEN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"<entry\s+id="([^"]+)"\s*>"#).unwrap());

/// Open (non-self-closing) language blocks as `(id, body)`. A block ends at the
/// next language tag or, when its closing tag is missing, at the end of the file.
/// `None` means the file has no language tags at all.
fn language_blocks(content: &str) -> Option<Vec<(&str, &str)>> {
    let tags: Vec<_> = LANGUAGE_TAG.captures_iter(content).collect();
    if tags.is_empty() {
        return None;
    }
    let mut blocks = Vec::new();
    for (i, cap) in tags.iter().enumerate() {
        let (Some(id), Some(slash)) = (cap.get(1), cap.get(2)) else {
            continue;
        };
        if !slash.as_str().is_empty() {
            continue;
        }
        let start = cap.get(0).unwrap().end();
        let end = tags
            .get(i + 1)
            .map_or(content.len(), |next| next.get(0).unwrap().start());
        blocks.push((id.as_str(), &content[start..end]));
    }
    Some(blocks)
}

/// Parse only complete entries inside the selected language block.
/// CDATA ends at its first terminator; malformed entries cannot consume siblings.
fn parse_string_table(content: &str, map: &mut HashMap<String, String>, language: &str) {
    match language_blocks(content) {
        Some(blocks) => {
            for (id, body) in blocks {
                if id == language {
                    parse_entries(body, map);
                }
            }
        }
        None if language == "english" => parse_entries(content, map),
        None => {}
    }
}

/// Languages that have at least one entry the parser accepts, using the same
/// rules as loading so the two can never disagree.
fn languages_with_text(content: &str) -> HashSet<String> {
    let mut found = HashSet::new();
    for (id, body) in language_blocks(content).unwrap_or_default() {
        let mut probe = HashMap::new();
        parse_entries(body, &mut probe);
        if !probe.is_empty() {
            found.insert(id.to_string());
        }
    }
    found
}

fn parse_entries(content: &str, map: &mut HashMap<String, String>) {
    for cap in ENTRY_OPEN.captures_iter(content) {
        let rest = &content[cap.get(0).unwrap().end()..];
        let Some(end) = rest.find("</entry>") else {
            continue;
        };
        let body = rest[..end].trim();
        let Some(cdata) = body.strip_prefix("<![CDATA[") else {
            continue;
        };
        let Some(end) = cdata.find("]]>") else {
            continue;
        };
        // Anything after the first CDATA terminator invalidates this entry.
        // Reject nested entries too, rather than swallowing the next valid key.
        if !cdata[end + 3..].trim().is_empty() || cdata[..end].contains("<entry") {
            continue;
        }
        let text = &cdata[..end];
        if !text.trim().is_empty() {
            map.insert(cap[1].to_string(), text.to_string());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovery_uses_the_same_rules_as_loading() {
        let table = r#"
<language id="english"><entry id="a"><![CDATA[A]]></entry></language>
<language id="german"></language>
<language id="french">   </language>
<language id="spanish"><entry id="a"><![CDATA[  ]]></entry></language>
<language id="italian" />
<language id="polish"><entry id="a"><![CDATA[P]]>junk</entry></language>
<language id="russian"><entry id="a"><![CDATA[R]]></entry>"#;
        let mut found: Vec<_> = languages_with_text(table).into_iter().collect();
        found.sort();
        assert_eq!(found, ["english", "russian"]);
        for language in ["german", "french", "spanish", "italian", "polish"] {
            let mut map = HashMap::new();
            parse_string_table(table, &mut map, language);
            assert!(map.is_empty(), "{language} must load nothing");
        }
        // An unclosed last block is loaded, matching discovery.
        let mut map = HashMap::new();
        parse_string_table(table, &mut map, "russian");
        assert_eq!(map["a"], "R");
    }

    #[test]
    fn localization_selection_fallback_and_available_languages() {
        let dir = std::env::temp_dir().join(format!("hamlet-localization-{}", std::process::id()));
        let loc = dir.join("localization");
        let dlc = dir.join("dlc/test/localization");
        std::fs::create_dir_all(&loc).unwrap();
        std::fs::create_dir_all(&dlc).unwrap();
        std::fs::write(
            loc.join("base.string_table.xml"),
            include_str!("../../tests/fixtures/localization/base.string_table.xml"),
        )
        .unwrap();
        std::fs::write(
            dlc.join("dlc.string_table.xml"),
            include_str!("../../tests/fixtures/localization/dlc.string_table.xml"),
        )
        .unwrap();
        let arena = dir.join("dlc/1117860_arena_mp/localization");
        std::fs::create_dir_all(&arena).unwrap();
        std::fs::write(
            arena.join("arena.string_table.xml"),
            include_str!("../../tests/fixtures/localization/arena.string_table.xml"),
        )
        .unwrap();
        let path = dir.to_string_lossy().to_string();
        let chinese = load_localization(path.clone(), "schinese".into()).unwrap();
        assert_eq!(chinese["str_quirk_name_resolution"], "戒酒");
        assert_eq!(
            chinese["str_quirk_description_resolution"],
            "在城镇从不饮酒。"
        );
        assert_eq!(chinese["english_only"], "English fallback");
        assert_eq!(chinese["brackets"], "[quoted] text");
        assert_eq!(chinese["dlc_only"], "扩展");
        assert_eq!(chinese["campaign_title"], "战役");
        assert_eq!(chinese["campaign_fallback"], "Campaign fallback");
        assert_eq!(chinese["dlc_title"], "战役扩展");
        assert_eq!(chinese["arena_only"], "Arena fallback");
        assert_eq!(chinese["empty_preserves"], "Nonempty");
        assert_eq!(chinese["multiline"], "first line\nsecond line");
        assert_eq!(chinese["after_malformed"], "Still intact");
        assert!(!chinese.contains_key("malformed"));
        assert!(!chinese.contains_key("unclosed"));
        assert!(!chinese.contains_key("arena_priority"));
        let japanese = load_localization(path.clone(), "japanese".into()).unwrap();
        assert_eq!(japanese["str_quirk_name_resolution"], "禁酒");
        assert_eq!(
            japanese["str_quirk_description_resolution"],
            "In town, will never Drink."
        );
        assert_eq!(japanese["dlc_only"], "DLC fallback");
        let english = load_localization(path.clone(), "english".into()).unwrap();
        assert_eq!(english["campaign_title"], "Campaign English");
        assert_eq!(
            english["str_quirk_name_resolution"],
            "Resolution DLC fallback"
        );
        assert_eq!(
            available_game_text_languages(path.clone()),
            vec!["english", "schinese", "japanese"]
        );
        assert_eq!(
            load_localization(path, "unknown".into()).unwrap_err(),
            "Unknown game text language: unknown"
        );
        std::fs::remove_dir_all(dir).unwrap();
        assert_eq!(
            available_game_text_languages("/nonexistent/hamlet-language-fixture".into()),
            vec!["english"]
        );
    }

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
