use crate::NameTableState;
use ddsavelib::{File, Unhasher};
use std::io::Cursor;
use std::path::Path;
use tauri::State;

/// Decode a binary DSON save file to a JSON value.
///
/// Reads the file at `path`, decodes it from binary DSON format,
/// converts to JSON (with `allow_dupes: true`) using `name_table` to
/// resolve hashed field names. Pass an empty slice if no name table is
/// available.
pub(crate) fn decode_save_file(path: String, names: &[String]) -> Result<serde_json::Value, String> {
    let data = std::fs::read(&path).map_err(|e| format!("Failed to read {path}: {e}"))?;

    let file = File::try_from_bin(Cursor::new(&data))
        .map_err(|e| format!("Failed to decode DSON: {e}"))?;

    let mut unhasher = Unhasher::<String>::new();
    unhasher.offer_names(names.iter().cloned());

    Ok(file.to_json_value(&unhasher))
}

/// Encode a JSON value back into a binary DSON save file.
///
/// Converts the `serde_json::Value` via ddsavelib's JSON reader, encodes
/// to binary, and performs an atomic write (write to temp file, then rename).
pub(crate) fn encode_save_file(path: String, data: &serde_json::Value) -> Result<(), String> {
    let file = File::from_json_value(data)
        .map_err(|e| format!("Failed to parse JSON input: {e}"))?;

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

/// Load all save files from a profile directory.
///
/// Reads all `persist.*.json` files and `novelty_tracker.json` from the
/// given directory, decodes each from binary DSON using the cached name
/// table (if any), and returns a JSON object mapping filename to decoded
/// content.
#[tauri::command]
pub fn load_profile(
    profile_path: String,
    state: State<'_, NameTableState>,
) -> Result<serde_json::Value, String> {
    let dir = Path::new(&profile_path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {profile_path}"));
    }

    // Snapshot the name table so we hold the lock for as short a time as
    // possible.
    let names: Vec<String> = state
        .0
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?
        .clone();

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

        let value = decode_save_file(path_str, &names)
            .map_err(|e| format!("Failed to decode {name}: {e}"))?;

        result.insert(name.to_string(), value);
    }

    Ok(serde_json::Value::Object(result))
}

/// Save all modified files back to a profile directory.
///
/// For each key in the `data` object, encodes the value as binary DSON
/// and writes it to the corresponding file in the profile directory.
/// Uses atomic writes (temp file + rename) for safety.
#[tauri::command]
pub fn save_profile(profile_path: String, data: serde_json::Value) -> Result<(), String> {
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
            return Err(format!("Invalid filename (path separators not allowed): {filename}"));
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
