use crate::{NameTable, NameTableState};
use ddsavelib::{name_hash, File, Unhasher};
use std::collections::HashMap;
use std::io::Cursor;
use std::path::Path;
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

/// Encode a JSON value back into a binary DSON save file.
///
/// Converts the `serde_json::Value` via ddsavelib's JSON reader, encodes
/// to binary, and performs an atomic write (write to temp file, then rename).
pub(crate) fn encode_save_file(path: String, data: &serde_json::Value) -> Result<(), String> {
    let file =
        File::from_json_value(data).map_err(|e| format!("Failed to parse JSON input: {e}"))?;

    let mut bin_buf = Vec::new();
    file.write_to_bin(&mut bin_buf)
        .map_err(|e| format!("Failed to encode DSON: {e}"))?;

    let tmp_path = format!("{path}.tmp");
    std::fs::write(&tmp_path, &bin_buf)
        .map_err(|e| format!("Failed to write temp file {tmp_path}: {e}"))?;

    std::fs::rename(&tmp_path, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path);
        format!("Failed to rename {tmp_path} -> {path}: {e}")
    })?;

    Ok(())
}

/// Load using a ready name table and return its version with the profile.
#[tauri::command]
pub fn load_profile(
    profile_path: String,
    state: State<'_, NameTableState>,
) -> Result<serde_json::Value, String> {
    let mut table = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;
    load_profile_with_table(profile_path, &mut table)
}

fn load_profile_with_table(
    profile_path: String,
    table: &mut NameTable,
) -> Result<serde_json::Value, String> {
    table.loaded_profile = None;
    if table.names.is_empty() {
        return Err(
            "Name table is not loaded. Load game data before loading a profile.".to_string(),
        );
    }
    let dir = Path::new(&profile_path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {profile_path}"));
    }

    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("Failed to read directory {profile_path}: {e}"))?;

    let mut result = serde_json::Map::new();

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {e}"))?;
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();

        if !super::is_save_file(&name) {
            continue;
        }

        let file_path = entry.path();
        let path_str = file_path.to_string_lossy().to_string();

        let mut value =
            decode_save_file(path_str).map_err(|e| format!("Failed to decode {name}: {e}"))?;

        if name == "persist.upgrades.json" {
            resolve_upgrade_ids(&mut value, &table.names)?;
        }
        result.insert(name.to_string(), value);
    }

    table.loaded_profile = Some(
        dir.canonicalize()
            .map_err(|e| format!("Invalid profile path: {e}"))?,
    );
    Ok(serde_json::json!({ "data": result, "name_table_version": table.version }))
}

/// Save all modified files back to a profile directory.
///
/// For each key in the `data` object, encodes the value as binary DSON
/// and writes it to the corresponding file in the profile directory.
/// Uses atomic writes (temp file + rename) for safety.
#[tauri::command]
pub fn save_profile(
    profile_path: String,
    data: serde_json::Value,
    name_table_version: u64,
    state: State<'_, NameTableState>,
) -> Result<(), String> {
    let table = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;
    save_profile_with_table(profile_path, data, name_table_version, &table)
}

fn save_profile_with_table(
    profile_path: String,
    mut data: serde_json::Value,
    name_table_version: u64,
    table: &NameTable,
) -> Result<(), String> {
    if table.names.is_empty() || table.version != name_table_version {
        return Err(
            "Name table is missing or changed. Reload game data and the profile before saving."
                .to_string(),
        );
    }
    let canonical = Path::new(&profile_path)
        .canonicalize()
        .map_err(|e| format!("Invalid profile path: {e}"))?;
    if table.loaded_profile.as_ref() != Some(&canonical) {
        return Err(
            "Profile was not loaded with the current name table. Reload the profile before saving."
                .to_string(),
        );
    }
    if let Some(upgrades) = data.get_mut("persist.upgrades.json") {
        restore_upgrade_hashes(upgrades, &table.names)?;
    }
    let dir = Path::new(&profile_path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {profile_path}"));
    }

    let obj = data
        .as_object()
        .ok_or_else(|| "Expected a JSON object for profile data".to_string())?;

    // Handle _deleted: delete listed files before encoding the rest
    if let Some(deleted) = obj.get("_deleted") {
        let names = deleted
            .as_array()
            .ok_or_else(|| "_deleted must be an array".to_string())?;
        for name_val in names {
            let filename = name_val
                .as_str()
                .ok_or_else(|| "_deleted entries must be strings".to_string())?;
            if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
                return Err(format!(
                    "Invalid filename in _deleted (path traversal detected): {filename}"
                ));
            }
            if !super::is_save_file(filename) {
                return Err(format!("Invalid save filename in _deleted: {filename}"));
            }
            let file_path = dir.join(filename);
            if file_path.exists() {
                std::fs::remove_file(&file_path)
                    .map_err(|e| format!("Failed to delete {filename}: {e}"))?;
            }
        }
    }

    for (filename, value) in obj {
        // Skip the _deleted control key
        if filename == "_deleted" {
            continue;
        }

        if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
            return Err(format!(
                "Invalid filename (path separators not allowed): {filename}"
            ));
        }
        if !super::is_save_file(filename) {
            return Err(format!("Invalid save filename: {filename}"));
        }

        let file_path = dir.join(filename);
        let path_str = file_path.to_string_lossy().to_string();

        encode_save_file(path_str, value)
            .map_err(|e| format!("Failed to encode {filename}: {e}"))?;
    }

    Ok(())
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
            loaded_profile: None,
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
            &names
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
            save_profile_with_table(profile.path(), deletion.clone(), 0, &names)
                .unwrap_err()
                .contains("missing or changed")
        );
        assert!(save_profile_with_table(other.path(), deletion, 1, &names)
            .unwrap_err()
            .contains("Profile was not loaded"));
        assert!(Path::new(&profile.upgrades()).exists());
        assert!(Path::new(&other.upgrades()).exists());
        names.version += 1;
        assert!(save_profile_with_table(profile.path(), json!({}), 1, &names).is_err());
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
        save_profile_with_table(profile.path(), loaded["data"].clone(), 1, &names).unwrap();
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
                save_profile_with_table(profile.path(), loaded["data"].clone(), 1, &names).is_err()
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
            loaded_profile: None,
        };
        let loaded = load_profile_with_table(profile.path(), &mut names).unwrap();
        let purchases = loaded["data"]["persist.upgrades.json"]["base_root"]["purchases"]
            .as_object()
            .unwrap();
        assert!(!purchases.is_empty());
        assert!(purchases.values().all(|p| p["tree_id"]
            .as_str()
            .is_some_and(|id| id.starts_with("###"))));
        save_profile_with_table(profile.path(), loaded["data"].clone(), 1, &names).unwrap();
        assert_eq!(decode_save_file(profile.upgrades()).unwrap(), original);
    }
}
