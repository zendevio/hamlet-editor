pub mod assets;
pub mod backup;
pub mod detect;
pub mod mods;
pub mod names;
pub mod save;

/// Check whether a filename matches the DD1 save file pattern:
/// `persist.*.json` or `novelty_tracker.json`.
pub(crate) fn is_save_file(name: &str) -> bool {
    (name.starts_with("persist.") && name.ends_with(".json")) || name == "novelty_tracker.json"
}
