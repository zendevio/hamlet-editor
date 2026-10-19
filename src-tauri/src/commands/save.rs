use crate::{NameTable, NameTableState};
use ddsavelib::{name_hash, File, Unhasher};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use tauri::State;

/// Decode without name substitution so ordinary integers stay integers.
pub(crate) fn decode_save_file(path: String) -> Result<serde_json::Value, String> {
    let data = std::fs::read(&path).map_err(|e| format!("Failed to read {path}: {e}"))?;
    let file = File::try_from_bin(Cursor::new(&data))
        .map_err(|e| format!("Failed to decode DSON: {e}"))?;
    Ok(file.to_json_value(&Unhasher::<String>::new()))
}

/// Only upgrade tree IDs need name resolution for editing. Never unhash
/// arbitrary integers such as hero GUIDs, counters, or treatment slot values.
fn resolve_upgrade_ids(data: &mut serde_json::Value, names: &[String]) -> Result<(), String> {
    let mut ids = HashMap::new();
    for name in names.iter().filter(|name| name.contains('.')) {
        let hash = name_hash(name);
        if let Some(previous) = ids.insert(hash, name) {
            if previous != name {
                return Err(format!(
                    "Ambiguous upgrade name hash: {previous} and {name}"
                ));
            }
        }
    }
    if let Some(purchases) = data
        .pointer_mut("/base_root/purchases")
        .and_then(|v| v.as_object_mut())
    {
        for purchase in purchases.values_mut() {
            let id = purchase
                .get_mut("tree_id")
                .ok_or("Upgrade purchase has no tree_id")?;
            let hash = id
                .as_i64()
                .and_then(|n| i32::try_from(n).ok())
                .ok_or("Upgrade tree_id is not a DSON hash")?;
            let name = ids.get(&hash).ok_or_else(|| format!(
                "Name table is incomplete: upgrade tree hash {hash} is unresolved. Load the matching game and mod data, then reload the profile."
            ))?;
            *id = serde_json::Value::String(format!("###{name}"));
        }
    }
    Ok(())
}

fn restore_upgrade_hashes(data: &mut serde_json::Value, names: &[String]) -> Result<(), String> {
    if let Some(purchases) = data
        .pointer_mut("/base_root/purchases")
        .and_then(|v| v.as_object_mut())
    {
        for purchase in purchases.values_mut() {
            let id = purchase
                .get_mut("tree_id")
                .ok_or("Upgrade purchase has no tree_id")?;
            let name = id
                .as_str()
                .and_then(|s| s.strip_prefix("###"))
                .ok_or("Upgrade IDs were not resolved. Reload the profile before saving.")?;
            if !names.iter().any(|n| n == name) {
                return Err(format!(
                    "Unknown upgrade tree {name}. Reload game data and the profile before saving."
                ));
            }
            *id = serde_json::json!(name_hash(name));
        }
    }
    Ok(())
}

/// A decoded snapshot retains order and duplicate fields that JSON maps cannot.
#[derive(Clone, Debug)]
pub struct LoadedSave {
    pub relative_path: PathBuf,
    pub file: File,
}

#[cfg(test)]
pub(crate) fn encode_save_file(path: String, data: &serde_json::Value) -> Result<(), String> {
    let file = File::from_json_value(data).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.write_to_bin(&mut bytes).map_err(|e| e.to_string())?;
    let path = Path::new(&path);
    super::transaction::apply_changes(
        path.parent().unwrap(),
        &BTreeMap::from([(PathBuf::from(path.file_name().unwrap()), bytes)]),
        &BTreeSet::new(),
    )
}

/// Resolve only relative game-provided raid paths inside the profile.
pub(crate) fn raid_relative_path(game: &serde_json::Value) -> Result<PathBuf, String> {
    let folder = game
        .pointer("/base_root/raid_save")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if folder.is_empty() {
        return Ok(PathBuf::from("persist.raid.json"));
    }
    let folder = Path::new(folder.trim_end_matches('/'));
    super::transaction::validate_relative(folder)?;
    Ok(folder.join("persist.raid.json"))
}

#[tauri::command]
pub fn load_profile(
    profile_path: String,
    state: State<'_, NameTableState>,
) -> Result<serde_json::Value, String> {
    let mut table = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;
    load_profile_with_table(profile_path, &mut table)
}

/// Load using a ready name table. Also used by the filesystem integration tests.
pub fn load_profile_with_table(
    profile_path: String,
    table: &mut NameTable,
) -> Result<serde_json::Value, String> {
    table.loaded_profile = None;
    table.loaded_files.clear();
    if table.names.is_empty() {
        return Err("Name table is not loaded. Load game data before loading a profile.".into());
    }
    let dir = Path::new(&profile_path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {profile_path}"));
    }
    let mut result = serde_json::Map::new();
    let mut snapshots = HashMap::new();
    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("Failed to read directory {profile_path}: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {e}"))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !super::is_save_file(&name)
            || name == "persist.raid.json"
            || !entry.file_type().map_err(|e| e.to_string())?.is_file()
        {
            continue;
        }
        load_one(
            dir,
            &name,
            PathBuf::from(&name),
            &table.names,
            &mut result,
            &mut snapshots,
        )?;
    }
    let game = result.get("persist.game.json").cloned().unwrap_or_default();
    let raid_path = raid_relative_path(&game)?;
    let active = game
        .pointer("/base_root/inraid")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if (active || raid_path == Path::new("persist.raid.json")) && dir.join(&raid_path).is_file() {
        load_one(
            dir,
            "persist.raid.json",
            raid_path,
            &table.names,
            &mut result,
            &mut snapshots,
        )?;
    }
    table.loaded_profile = Some(
        dir.canonicalize()
            .map_err(|e| format!("Invalid profile path: {e}"))?,
    );
    table.loaded_files = snapshots;
    Ok(serde_json::json!({ "data": result, "name_table_version": table.version }))
}

fn load_one(
    dir: &Path,
    name: &str,
    relative_path: PathBuf,
    names: &[String],
    result: &mut serde_json::Map<String, serde_json::Value>,
    snapshots: &mut HashMap<String, LoadedSave>,
) -> Result<(), String> {
    let path = dir.join(&relative_path);
    let bytes =
        std::fs::read(&path).map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    let file = match File::try_from_bin(bytes.as_slice()) {
        Ok(file) => file,
        Err(e) => {
            log::warn!("Skipping undecodable save {}: {e}", path.display());
            return Ok(());
        }
    };
    let mut value = file.to_json_value(&Unhasher::empty());
    if name == "persist.upgrades.json" {
        resolve_upgrade_ids(&mut value, names)?;
    }
    result.insert(name.to_owned(), value);
    snapshots.insert(
        name.to_owned(),
        LoadedSave {
            relative_path,
            file,
        },
    );
    Ok(())
}

#[tauri::command]
pub fn save_profile(
    profile_path: String,
    data: serde_json::Value,
    name_table_version: u64,
    state: State<'_, NameTableState>,
) -> Result<(), String> {
    let mut table = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;
    save_profile_with_detector(
        profile_path,
        data,
        name_table_version,
        &mut table,
        super::detect::is_game_running,
    )
}

/// Detector injection lets tests exercise the same guard as the Tauri command.
pub fn save_profile_with_detector(
    profile_path: String,
    mut data: serde_json::Value,
    name_table_version: u64,
    table: &mut NameTable,
    detector: impl FnOnce() -> Result<bool, String>,
) -> Result<(), String> {
    super::detect::ensure_game_stopped(detector)?;
    if table.names.is_empty() || table.version != name_table_version {
        return Err(
            "Name table is missing or changed. Reload game data and the profile before saving."
                .into(),
        );
    }
    let canonical = Path::new(&profile_path)
        .canonicalize()
        .map_err(|e| format!("Invalid profile path: {e}"))?;
    if table.loaded_profile.as_ref() != Some(&canonical) {
        return Err(
            "Profile was not loaded with the current name table. Reload the profile before saving."
                .into(),
        );
    }
    if let Some(upgrades) = data.get_mut("persist.upgrades.json") {
        restore_upgrade_hashes(upgrades, &table.names)
            .map_err(|e| format!("persist.upgrades.json: {e}"))?;
    }
    let obj = data
        .as_object()
        .ok_or("Expected a JSON object for profile data")?;
    let relative_for = |name: &str| -> Result<PathBuf, String> {
        if !super::is_save_file(name)
            || name.contains('/')
            || name.contains('\\')
            || name.contains("..")
        {
            return Err(format!("Invalid save filename: {name}"));
        }
        if let Some(loaded) = table.loaded_files.get(name) {
            return Ok(loaded.relative_path.clone());
        }
        // An existing file omitted at load may be undecodable. Never overwrite it.
        if canonical.join(name).exists() || name == "persist.raid.json" {
            return Err(format!(
                "{name} was not decoded at load. Reload the profile before saving."
            ));
        }
        Ok(PathBuf::from(name))
    };
    let mut deletes = BTreeSet::new();
    let mut deleted_names = Vec::new();
    if let Some(deleted) = obj.get("_deleted") {
        for value in deleted.as_array().ok_or("_deleted must be an array")? {
            let name = value.as_str().ok_or("_deleted entries must be strings")?;
            deletes.insert(relative_for(name)?);
            deleted_names.push(name.to_owned());
        }
    }
    let mut writes = BTreeMap::new();
    let mut updated = HashMap::new();
    // Validate and encode every file in memory before creating any temp files.
    for (name, value) in obj {
        if name == "_deleted" {
            continue;
        }
        let relative_path = relative_for(name)?;
        let file = if let Some(original) = table.loaded_files.get(name) {
            original.file.merge_json_value(value)
        } else {
            File::from_json_value(value)
        }
        .map_err(|e| format!("Failed to encode {name}: {e}"))?;
        let mut bytes = Vec::new();
        file.write_to_bin(&mut bytes)
            .map_err(|e| format!("Failed to encode {name}: {e}"))?;
        writes.insert(relative_path.clone(), bytes);
        updated.insert(
            name.clone(),
            LoadedSave {
                relative_path,
                file,
            },
        );
    }
    super::transaction::apply_changes(&canonical, &writes, &deletes)?;
    for name in deleted_names {
        table.loaded_files.remove(&name);
    }
    table.loaded_files.extend(updated);
    Ok(())
}

#[cfg(test)]
fn save_profile_with_table(
    profile_path: String,
    data: serde_json::Value,
    name_table_version: u64,
    table: &mut NameTable,
) -> Result<(), String> {
    save_profile_with_detector(profile_path, data, name_table_version, table, || Ok(false))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_PROFILE: AtomicU64 = AtomicU64::new(0);

    struct Profile(PathBuf);

    impl Profile {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "hamlet-save-{}-{}",
                std::process::id(),
                NEXT_PROFILE.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn path(&self) -> String {
            self.0.to_string_lossy().into_owned()
        }
        fn upgrades(&self) -> String {
            self.0
                .join("persist.upgrades.json")
                .to_string_lossy()
                .into_owned()
        }
        fn write(&self) {
            encode_save_file(
                self.upgrades(),
                &json!({
                    "__revision_dont_touch": 1,
                    "base_root": { "purchases": { "0": {
                        "instance_number": 0,
                        "tree_id": name_hash("abbey.meditation"),
                        "requirement_code": "a", "is_purchased": true
                    } }, "ordinary_integer": name_hash("abbey.meditation") }
                }),
            )
            .unwrap();
        }
    }
    impl Drop for Profile {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn table() -> NameTable {
        NameTable {
            names: vec!["abbey.meditation".into()],
            version: 1,
            ..NameTable::default()
        }
    }

    #[test]
    fn missing_or_incomplete_names_never_authorize_a_write() {
        let profile = Profile::new();
        profile.write();
        let original = std::fs::read(profile.upgrades()).unwrap();
        let mut names = NameTable::default();
        assert!(load_profile_with_table(profile.path(), &mut names)
            .unwrap_err()
            .contains("Name table is not loaded"));
        names.names = vec!["abbey".into(), "meditation".into()];
        names.version = 1;
        let error = load_profile_with_table(profile.path(), &mut names).unwrap_err();
        assert!(error.contains("Name table is incomplete"));
        assert!(names.loaded_profile.is_none());
        assert!(save_profile_with_table(
            profile.path(),
            json!({ "_deleted": ["persist.upgrades.json"] }),
            1,
            &mut names
        )
        .is_err());
        assert_eq!(std::fs::read(profile.upgrades()).unwrap(), original);
    }

    #[test]
    fn stale_table_version_and_wrong_profile_are_blocked_before_deletion() {
        let profile = Profile::new();
        profile.write();
        let other = Profile::new();
        other.write();
        let mut names = table();
        load_profile_with_table(profile.path(), &mut names).unwrap();
        let deletion = json!({ "_deleted": ["persist.upgrades.json"] });
        assert!(
            save_profile_with_table(profile.path(), deletion.clone(), 0, &mut names)
                .unwrap_err()
                .contains("missing or changed")
        );
        assert!(
            save_profile_with_table(other.path(), deletion, 1, &mut names)
                .unwrap_err()
                .contains("Profile was not loaded")
        );
        assert!(Path::new(&profile.upgrades()).exists());
        assert!(Path::new(&other.upgrades()).exists());
        names.version += 1;
        assert!(save_profile_with_table(profile.path(), json!({}), 1, &mut names).is_err());
    }

    #[test]
    fn upgrade_edit_reencodes_clean_hashes_and_preserves_other_integers() {
        let profile = Profile::new();
        profile.write();
        let mut names = table();
        let mut loaded = load_profile_with_table(profile.path(), &mut names).unwrap();
        assert_eq!(loaded["name_table_version"], 1);
        let upgrades = &mut loaded["data"]["persist.upgrades.json"];
        assert_eq!(
            upgrades["base_root"]["purchases"]["0"]["tree_id"],
            "###abbey.meditation"
        );
        assert_eq!(
            upgrades["base_root"]["ordinary_integer"],
            name_hash("abbey.meditation")
        );
        upgrades["base_root"]["purchases"]["0"]["is_purchased"] = json!(false);
        save_profile_with_table(profile.path(), loaded["data"].clone(), 1, &mut names).unwrap();
        let clean = decode_save_file(profile.upgrades()).unwrap();
        assert_eq!(
            clean["base_root"]["purchases"]["0"]["tree_id"],
            name_hash("abbey.meditation")
        );
        assert_eq!(
            clean["base_root"]["ordinary_integer"],
            name_hash("abbey.meditation")
        );
        assert_eq!(clean["base_root"]["purchases"]["0"]["is_purchased"], false);
        let reloaded = load_profile_with_table(profile.path(), &mut names).unwrap();
        assert_eq!(reloaded, loaded);
    }

    #[test]
    fn unresolved_or_unknown_upgrade_input_is_blocked_before_deletion() {
        let profile = Profile::new();
        profile.write();
        let mut names = table();
        let mut loaded = load_profile_with_table(profile.path(), &mut names).unwrap();
        for value in [
            json!(name_hash("abbey.meditation")),
            json!("###unknown.tree"),
        ] {
            loaded["data"]["persist.upgrades.json"]["base_root"]["purchases"]["0"]["tree_id"] =
                value;
            loaded["data"]["_deleted"] = json!(["persist.upgrades.json"]);
            assert!(
                save_profile_with_table(profile.path(), loaded["data"].clone(), 1, &mut names)
                    .is_err()
            );
            assert!(Path::new(&profile.upgrades()).exists());
        }
    }

    /// Reads only game data and the supplied decoded reference. All writes use a temp profile.
    #[test]
    #[ignore = "requires HAMLET_REFERENCE_JSON and HAMLET_GAME_DATA read-only fixture paths"]
    fn reference_upgrades_resolve_and_round_trip_with_installed_game_names() {
        let reference = std::env::var("HAMLET_REFERENCE_JSON").expect("decoded upgrades JSON path");
        let game_path = std::env::var("HAMLET_GAME_DATA").expect("game data directory");
        let original: serde_json::Value =
            serde_json::from_slice(&std::fs::read(reference).unwrap()).unwrap();
        let profile = Profile::new();
        encode_save_file(profile.upgrades(), &original).unwrap();
        let mut names = NameTable {
            names: crate::commands::names::generate_name_table(game_path).unwrap(),
            version: 1,
            ..NameTable::default()
        };
        let loaded = load_profile_with_table(profile.path(), &mut names).unwrap();
        let purchases = loaded["data"]["persist.upgrades.json"]["base_root"]["purchases"]
            .as_object()
            .unwrap();
        assert!(!purchases.is_empty());
        assert!(purchases.values().all(|p| p["tree_id"]
            .as_str()
            .is_some_and(|id| id.starts_with("###"))));
        save_profile_with_table(profile.path(), loaded["data"].clone(), 1, &mut names).unwrap();
        assert_eq!(decode_save_file(profile.upgrades()).unwrap(), original);
    }
}
