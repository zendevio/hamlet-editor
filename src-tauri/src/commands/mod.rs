pub mod assets;
pub mod backup;
pub mod detect;
pub mod error;
pub mod gamedata;
pub mod language;
pub mod links;
pub mod mods;
pub mod names;
pub mod native_menu;
pub mod save;
pub mod settings;
pub(crate) mod transaction;

/// Check whether a filename matches the DD1 save file pattern:
/// `persist.*.json` or `novelty_tracker.json`.
pub(crate) fn is_save_file(name: &str) -> bool {
    (name.starts_with("persist.") && name.ends_with(".json")) || name == "novelty_tracker.json"
}
