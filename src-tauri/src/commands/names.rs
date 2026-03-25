use std::collections::HashMap;

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Generate a name table by scanning the game installation for known string
/// identifiers used as DSON name hashes.
///
/// # TODO — file patterns to scan (15 total)
///
/// When fully implemented this command should walk `game_path` and collect
/// every unique identifier from the following file types:
///
///  1.  `heroes/**/*.info.darkest`            — hero class names, skill IDs
///  2.  `heroes/**/*.art.darkest`             — sprite/art identifiers
///  3.  `heroes/**/*.upgrades.darkest`        — upgrade tree node names
///  4.  `campaign/quest/*.quest.darkest`      — quest IDs and goal names
///  5.  `campaign/dungeon/*.dungeon.darkest`  — dungeon/region identifiers
///  6.  `campaign/loot/*.loot.darkest`        — loot table identifiers
///  7.  `campaign/effect/*.effect.darkest`    — buff/debuff effect names
///  8.  `campaign/quirk/*.quirk.darkest`      — quirk/affliction identifiers
///  9.  `campaign/disease/*.disease.darkest`  — disease identifiers
/// 10.  `campaign/town_event/*.town_event.darkest` — town event identifiers
/// 11.  `campaign/activity/*.activity.darkest`     — activity identifiers
/// 12.  `campaign/curio/*.curio.darkest`      — curio identifiers
/// 13.  `monsters/**/*.info.darkest`          — monster class/type names
/// 14.  `dlc/**/*.info.darkest`               — DLC hero/monster names
/// 15.  `dlc/**/*.quest.darkest`              — DLC quest identifiers
///
/// Each file should be parsed for bare identifier tokens (not quoted strings)
/// and the results deduplicated before returning.
#[tauri::command]
pub fn generate_name_table(_game_path: String) -> Result<Vec<String>, String> {
    // Hardcoded seed list — the 10 stat event names always present in saves.
    let names = vec![
        "MONSTER_ENCOUNTERED".to_string(),
        "MONSTER_KILLED".to_string(),
        "HERO_KILLED".to_string(),
        "HERO_RECRUITED".to_string(),
        "HERO_UPGRADED".to_string(),
        "QUEST_COMPLETE".to_string(),
        "QUEST_FAILED".to_string(),
        "DUNGEON_ENTERED".to_string(),
        "DUNGEON_EXITED".to_string(),
        "TOWN_VISITED".to_string(),
    ];

    Ok(names)
}

/// Load localisation strings from the game installation.
///
/// # TODO — parsing `*.string_table.xml` files
///
/// When fully implemented this command should:
///
///  1.  Walk `game_path` recursively for files matching `*.string_table.xml`.
///  2.  Parse each XML file (simple SAX/DOM walk — the format is:
///      `<string_table><entry id="KEY">VALUE</entry>…</string_table>`).
///  3.  Collect all `id → inner-text` pairs into the returned HashMap.
///  4.  Later entries for the same key should overwrite earlier ones so that
///      DLC string tables can override base-game entries.
///  5.  Paths to check at minimum:
///        - `<game_path>/localization/`
///        - `<game_path>/dlc/*/localization/`
///        - `<game_path>/mods/*/localization/`  (mod support, lower priority)
#[tauri::command]
pub fn load_localization(_game_path: String) -> Result<HashMap<String, String>, String> {
    // Scaffold only — returns empty map until XML parsing is implemented.
    Ok(HashMap::new())
}
