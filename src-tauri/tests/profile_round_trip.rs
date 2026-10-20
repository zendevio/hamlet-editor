use ddsavelib::{File, Unhasher};
use hamlet_editor_lib::NameTable;
use hamlet_editor_lib::{backup, save};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT: AtomicU64 = AtomicU64::new(0);

struct Sandbox(PathBuf);

impl Sandbox {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "hamlet-integration-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/profile_0");
        copy_tree(&fixture, &path.join("profile_0"));
        Self(path)
    }
    fn steam() -> Self {
        let sandbox = Self::new();
        let remote = sandbox.0.join("userdata/123/262060/remote");
        fs::create_dir_all(&remote).unwrap();
        fs::rename(sandbox.profile(), remote.join("profile_0")).unwrap();
        sandbox
    }
    fn profile(&self) -> PathBuf {
        let steam = self.0.join("userdata/123/262060/remote/profile_0");
        if steam.is_dir() {
            return steam;
        }
        self.0.join("profile_0")
    }
    fn backups(&self) -> PathBuf {
        self.0.join("editor-backups")
    }
    fn activate_raid(&self) {
        let path = self.profile().join("persist.game.json");
        let original = fs::read(&path).unwrap();
        let file = File::try_from_bin(original.as_slice()).unwrap();
        let mut value = file.to_json_value(&Unhasher::empty());
        value["base_root"]["inraid"] = json!(true);
        let mut bytes = Vec::new();
        file.merge_json_value(&value)
            .unwrap()
            .write_to_bin(&mut bytes)
            .unwrap();
        fs::write(path, bytes).unwrap();
    }
    fn load(&self) -> (NameTable, Value) {
        let mut table = NameTable {
            names: serde_json::from_str(include_str!("fixtures/upgrade-names.json")).unwrap(),
            version: 1,
            ..NameTable::default()
        };
        let value = save::load_profile_with_table(
            self.profile().to_string_lossy().into_owned(),
            &mut table,
        )
        .unwrap();
        (table, value["data"].clone())
    }
    fn save(&self, table: &mut NameTable, value: Value) -> Result<(), String> {
        save::save_profile_with_detector(
            self.profile().to_string_lossy().into_owned(),
            value,
            1,
            table,
            || Ok(false),
        )
    }
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn copy_tree(source: &Path, target: &Path) {
    fs::create_dir(target).unwrap();
    for entry in fs::read_dir(source).unwrap() {
        let entry = entry.unwrap();
        let destination = target.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_tree(&entry.path(), &destination);
        } else {
            fs::write(destination, fs::read(entry.path()).unwrap()).unwrap();
        }
    }
}

fn tree(root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    fn visit(root: &Path, relative: &Path, files: &mut BTreeMap<PathBuf, Vec<u8>>) {
        for entry in fs::read_dir(root.join(relative)).unwrap() {
            let entry = entry.unwrap();
            let path = relative.join(entry.file_name());
            if entry.file_type().unwrap().is_dir() {
                visit(root, &path, files);
            } else {
                files.insert(path, fs::read(entry.path()).unwrap());
            }
        }
    }
    let mut files = BTreeMap::new();
    visit(root, Path::new(""), &mut files);
    files
}

fn normalized(bytes: &[u8]) -> Vec<u8> {
    let mut result = Vec::new();
    File::try_from_bin(bytes)
        .unwrap()
        .write_to_bin(&mut result)
        .unwrap();
    result
}

fn raw_json(bytes: &[u8]) -> String {
    let mut output = Vec::new();
    File::try_from_bin(bytes)
        .unwrap()
        .write_to_json(&mut output, true, &Unhasher::empty())
        .unwrap();
    String::from_utf8(output).unwrap()
}

// Model JSON.stringify numbers and reverse keys to stress order restoration.
fn simulate_frontend_json(value: &mut Value) {
    if let Some(map) = value.as_object_mut() {
        for child in map.values_mut() {
            simulate_frontend_json(child);
        }
        let mut entries: Vec<_> = std::mem::take(map).into_iter().collect();
        entries.reverse();
        map.extend(entries);
    } else if let Some(array) = value.as_array_mut() {
        for child in array {
            simulate_frontend_json(child);
        }
    } else if let Value::Number(n) = value {
        if n.is_f64() && n.as_f64().unwrap().fract() == 0.0 {
            *value = json!(n.as_f64().unwrap() as i64);
        }
    }
}

#[test]
fn no_edit_frontend_round_trip_preserves_every_file_and_roster_order() {
    for active in [false, true] {
        let sandbox = Sandbox::new();
        if active {
            sandbox.activate_raid();
        }
        let before = tree(&sandbox.profile());
        let (mut table, mut data) = sandbox.load();
        assert_eq!(data.get("persist.raid.json").is_some(), active);
        assert!(data.get("persist.map.json").is_none());
        let loaded_paths: Vec<_> = table
            .loaded_files
            .values()
            .map(|file| file.relative_path.clone())
            .collect();
        simulate_frontend_json(&mut data);
        sandbox.save(&mut table, data).unwrap();
        let after = tree(&sandbox.profile());
        assert_eq!(before.len(), after.len());
        for (path, bytes) in &before {
            let expected = if loaded_paths.contains(path) {
                normalized(bytes)
            } else {
                bytes.clone()
            };
            assert_eq!(after[path], expected, "{}", path.display());
        }
        let progression = raw_json(&after[Path::new("persist.progression.json")]);
        assert_eq!(
            progression
                .matches("\"slay_a_squiffy_with_jester\" : {")
                .count(),
            2
        );
        assert_eq!(
            raw_json(&before[Path::new("persist.roster.json")]),
            raw_json(&after[Path::new("persist.roster.json")])
        );
    }
}

#[test]
fn duplicate_achievement_survives_unrelated_edits_and_repeated_saves() {
    let sandbox = Sandbox::new();
    let original = fs::read(sandbox.profile().join("persist.progression.json")).unwrap();
    let (mut table, mut data) = sandbox.load();
    data["persist.game.json"]["base_root"]["estatename"] = json!("Fixture estate");
    simulate_frontend_json(&mut data);
    sandbox.save(&mut table, data.clone()).unwrap();
    data["persist.game.json"]["base_root"]["estatename"] = json!("Second edit");
    sandbox.save(&mut table, data).unwrap();
    assert_eq!(
        fs::read(sandbox.profile().join("persist.progression.json")).unwrap(),
        normalized(&original)
    );
}

#[test]
fn encoding_failure_preserves_all_files() {
    let sandbox = Sandbox::new();
    sandbox.activate_raid();
    let before = tree(&sandbox.profile());
    let (mut table, mut data) = sandbox.load();
    data["persist.estate.json"]["base_root"]["bad_integer"] = json!(99_999_999_999_i64);
    data["persist.game.json"]["base_root"]["estatename"] = json!("Must not be written");
    data.as_object_mut().unwrap().remove("persist.raid.json");
    let error = sandbox.save(&mut table, data).unwrap_err();
    assert!(error.contains("persist.estate.json"), "{error}");
    assert!(error.contains("base_root.bad_integer"), "{error}");
    assert_eq!(tree(&sandbox.profile()), before);
}

#[test]
fn raid_subfolder_edit_and_abandon_preserve_raid_path_and_unsupported_map() {
    let sandbox = Sandbox::new();
    sandbox.activate_raid();
    let map_path = sandbox
        .profile()
        .join("plot_crimson_court_1/persist.map.json");
    let map = fs::read(&map_path).unwrap();
    fs::write(sandbox.profile().join("persist.undecodable.json"), &map).unwrap();
    let (mut table, mut data) = sandbox.load();
    assert!(data.get("persist.undecodable.json").is_none());
    assert_eq!(data["persist.raid.json"]["base_root"]["torchlight"], 100.0);
    assert_eq!(100.0_f32.to_bits(), 1_120_403_456);
    data["persist.raid.json"]["base_root"]["torchlight"] = json!(77.5);
    sandbox
        .save(
            &mut table,
            json!({"persist.raid.json": data["persist.raid.json"]}),
        )
        .unwrap();
    let raid = fs::read(
        sandbox
            .profile()
            .join("plot_crimson_court_1/persist.raid.json"),
    )
    .unwrap();
    assert_eq!(
        File::try_from_bin(raid.as_slice())
            .unwrap()
            .to_json_value(&Unhasher::empty())["base_root"]["torchlight"],
        77.5
    );
    assert!(!sandbox.profile().join("persist.raid.json").exists());
    assert_eq!(fs::read(&map_path).unwrap(), map);
    assert!(sandbox
        .save(
            &mut table,
            json!({"persist.undecodable.json": data["persist.game.json"]})
        )
        .is_err());
    data["persist.game.json"]["base_root"]["inraid"] = json!(false);
    sandbox
        .save(
            &mut table,
            json!({"persist.game.json": data["persist.game.json"]}),
        )
        .unwrap();
    assert_eq!(
        fs::read(
            sandbox
                .profile()
                .join("plot_crimson_court_1/persist.raid.json")
        )
        .unwrap(),
        raid
    );
    let (_, reloaded) = sandbox.load();
    assert_eq!(
        reloaded["persist.game.json"]["base_root"]["raid_save"],
        "plot_crimson_court_1/"
    );
    assert!(reloaded.get("persist.raid.json").is_none());
    assert!(sandbox
        .profile()
        .join("plot_crimson_court_1/persist.raid.json")
        .exists());
    assert_eq!(fs::read(map_path).unwrap(), map);
}

#[test]
fn backup_restore_recurses_keeps_raw_bytes_and_scopes_deletion() {
    let sandbox = Sandbox::new();
    let before = tree(&sandbox.profile());
    let backup = backup::create_backup_at(&sandbox.profile(), &sandbox.backups()).unwrap();
    assert_ne!(
        backup,
        backup::create_backup_at(&sandbox.profile(), &sandbox.backups()).unwrap()
    );
    assert_eq!(
        fs::read(backup.join("plot_crimson_court_1/persist.map.json")).unwrap(),
        before[Path::new("plot_crimson_court_1/persist.map.json")]
    );
    fs::write(
        sandbox
            .profile()
            .join("plot_crimson_court_1/persist.map.json"),
        b"changed map",
    )
    .unwrap();
    fs::remove_file(sandbox.profile().join("persist.roster.json")).unwrap();
    fs::create_dir(sandbox.profile().join("stale_raid")).unwrap();
    fs::write(
        sandbox.profile().join("stale_raid/persist.raid.json"),
        b"stale",
    )
    .unwrap();
    fs::write(sandbox.profile().join("notes.txt"), b"unrelated").unwrap();
    fs::write(
        sandbox.profile().join("persist.unrelated.json"),
        b"unrelated save name",
    )
    .unwrap();
    let mut permissions = fs::metadata(backup.join("persist.roster.json"))
        .unwrap()
        .permissions();
    permissions.set_readonly(true);
    fs::set_permissions(backup.join("persist.roster.json"), permissions).unwrap();
    backup::restore_backup_with_detectors(
        &backup,
        &sandbox.profile(),
        &sandbox.backups(),
        || Ok(false),
        || Ok(false),
    )
    .unwrap();
    let after = tree(&sandbox.profile());
    for (path, bytes) in before {
        assert_eq!(after[&path], bytes, "{}", path.display());
    }
    assert!(!sandbox
        .profile()
        .join("stale_raid/persist.raid.json")
        .exists());
    assert_eq!(after[Path::new("notes.txt")], b"unrelated");
    assert_eq!(
        after[Path::new("persist.unrelated.json")],
        b"unrelated save name"
    );
    assert!(!fs::metadata(sandbox.profile().join("persist.roster.json"))
        .unwrap()
        .permissions()
        .readonly());
}

#[test]
fn backup_listing_uses_exact_source_and_keeps_legacy_profile_ids() {
    let first = Sandbox::new();
    let second = Sandbox::new();
    let backup = backup::create_backup_at(&first.profile(), &first.backups()).unwrap();
    assert_eq!(
        backup::list_backups_at(&first.profile(), &first.backups())
            .unwrap()
            .len(),
        1
    );
    assert!(backup::list_backups_at(&second.profile(), &first.backups())
        .unwrap()
        .is_empty());
    assert!(backup::restore_backup_with_detectors(
        &backup,
        &second.profile(),
        &second.backups(),
        || Ok(false),
        || Ok(false)
    )
    .unwrap_err()
    .contains("different source"));
    fs::create_dir(first.backups().join("profile_0__2026-01-01__12-00-00")).unwrap();
    fs::create_dir(first.backups().join("profile_1__2026-01-01__12-00-00")).unwrap();
    assert_eq!(
        backup::list_backups_at(&first.profile(), &first.backups())
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        backup::list_backups_at(&second.profile(), &first.backups())
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn incomplete_backup_manifest_blocks_restore_before_mutation() {
    let sandbox = Sandbox::new();
    let backup = backup::create_backup_at(&sandbox.profile(), &sandbox.backups()).unwrap();
    fs::remove_file(backup.join("plot_crimson_court_1/persist.map.json")).unwrap();
    let before = tree(&sandbox.profile());
    let count = fs::read_dir(sandbox.backups()).unwrap().count();
    let error = backup::restore_backup_with_detectors(
        &backup,
        &sandbox.profile(),
        &sandbox.backups(),
        || Ok(false),
        || Ok(false),
    )
    .unwrap_err();
    assert_eq!(
        error,
        "Backup files do not match the manifest. Restore was not started."
    );
    assert_eq!(tree(&sandbox.profile()), before);
    assert_eq!(fs::read_dir(sandbox.backups()).unwrap().count(), count);
}

#[test]
fn all_three_write_commands_refuse_a_running_game_before_any_changes() {
    let sandbox = Sandbox::new();
    let (mut table, data) = sandbox.load();
    let before = tree(&sandbox.profile());
    let error = save::save_profile_with_detector(
        sandbox.profile().to_string_lossy().into_owned(),
        data,
        1,
        &mut table,
        || Ok(true),
    )
    .unwrap_err();
    assert!(error.starts_with("Darkest Dungeon is running"));
    let error = backup::restore_backup_with_detectors(
        Path::new("missing-backup"),
        &sandbox.profile(),
        &sandbox.backups(),
        || Ok(true),
        || panic!("Steam detection must not precede the game-running guard"),
    )
    .unwrap_err();
    assert!(error.starts_with("Darkest Dungeon is running"));
    let error = backup::restore_game_backup_with_detectors(
        &sandbox.profile(),
        &sandbox.backups(),
        || Ok(true),
        || panic!("Steam detection must not precede the game-running guard"),
    )
    .unwrap_err();
    assert!(error.starts_with("Darkest Dungeon is running"));
    assert_eq!(tree(&sandbox.profile()), before);
    assert!(!sandbox.backups().exists());
}

#[test]
fn game_backup_restore_does_not_transplant_stale_raid_or_map_to_root() {
    let sandbox = Sandbox::new();
    let raid = fs::read(
        sandbox
            .profile()
            .join("plot_crimson_court_1/persist.raid.json"),
    )
    .unwrap();
    backup::restore_game_backup_with_detectors(
        &sandbox.profile(),
        &sandbox.backups(),
        || Ok(false),
        || Ok(false),
    )
    .unwrap();
    assert!(!sandbox.profile().join("persist.raid.json").exists());
    assert!(!sandbox.profile().join("persist.map.json").exists());
    assert!(!sandbox
        .profile()
        .join("persist.loading_screen.json")
        .exists());
    assert_eq!(
        fs::read(
            sandbox
                .profile()
                .join("plot_crimson_court_1/persist.raid.json")
        )
        .unwrap(),
        raid
    );
    assert_eq!(
        fs::read(sandbox.profile().join("persist.roster.json")).unwrap(),
        fs::read(sandbox.profile().join("backup/persist.roster.json")).unwrap()
    );
}

#[test]
fn control_character_save_errors_name_the_file_and_field_without_writing() {
    let sandbox = Sandbox::new();
    let (mut table, mut data) = sandbox.load();
    let before = tree(&sandbox.profile());
    for name in ["Name\0suffix", "Name\u{1}suffix", "Name\nsuffix"] {
        data["persist.game.json"]["base_root"]["estatename"] = json!(name);
        let error = sandbox.save(&mut table, data.clone()).unwrap_err();
        assert!(error.contains("persist.game.json"), "{error}");
        assert!(error.contains("base_root.estatename"), "{error}");
        assert!(error.contains("control characters or NUL"), "{error}");
    }
    assert_eq!(tree(&sandbox.profile()), before);
}

#[test]
fn disk_changes_file_addition_removal_and_inactive_subfolder_changes_block_all_writes() {
    for mode in ["modify", "add", "remove", "raid", "map"] {
        let sandbox = Sandbox::new();
        let (mut table, mut data) = sandbox.load();
        match mode {
            "modify" => fs::write(
                sandbox.profile().join("persist.roster.json"),
                b"new game data",
            )
            .unwrap(),
            "add" => fs::write(sandbox.profile().join("persist.new.json"), b"new save").unwrap(),
            "remove" => fs::remove_file(sandbox.profile().join("persist.estate.json")).unwrap(),
            "raid" => fs::write(
                sandbox
                    .profile()
                    .join("plot_crimson_court_1/persist.raid.json"),
                b"new raid",
            )
            .unwrap(),
            "map" => fs::write(
                sandbox
                    .profile()
                    .join("plot_crimson_court_1/persist.map.json"),
                b"new map",
            )
            .unwrap(),
            _ => unreachable!(),
        }
        let before = tree(&sandbox.profile());
        data["persist.game.json"]["base_root"]["estatename"] = json!("Must not overwrite the game");
        let error = sandbox.save(&mut table, data).unwrap_err();
        assert!(
            error.contains("Save files changed on disk since load; reload"),
            "{mode}: {error}"
        );
        assert_eq!(tree(&sandbox.profile()), before, "{mode}");
    }
}

#[test]
fn unknown_mod_upgrade_hash_loads_and_round_trips_when_other_purchases_change() {
    let sandbox = Sandbox::new();
    let path = sandbox.profile().join("persist.upgrades.json");
    let file = File::try_from_bin(fs::read(&path).unwrap().as_slice()).unwrap();
    let mut value = file.to_json_value(&Unhasher::empty());
    let purchases = value["base_root"]["purchases"].as_object_mut().unwrap();
    let unknown_key = purchases
        .iter()
        .find(|(_, p)| p["instance_number"] == 221)
        .unwrap()
        .0
        .clone();
    purchases[&unknown_key]["tree_id"] = json!(-123456789);
    let mut bytes = Vec::new();
    file.merge_json_value(&value)
        .unwrap()
        .write_to_bin(&mut bytes)
        .unwrap();
    fs::write(&path, bytes).unwrap();
    let (mut table, mut data) = sandbox.load();
    assert_eq!(
        data["persist.upgrades.json"]["base_root"]["purchases"][&unknown_key]["tree_id"],
        -123456789
    );
    let known = data["persist.upgrades.json"]["base_root"]["purchases"]
        .as_object_mut()
        .unwrap()
        .values_mut()
        .find(|p| p["tree_id"].is_string())
        .unwrap();
    known["is_purchased"] = json!(!known["is_purchased"].as_bool().unwrap());
    sandbox
        .save(
            &mut table,
            json!({"persist.upgrades.json": data["persist.upgrades.json"]}),
        )
        .unwrap();
    let decoded = File::try_from_bin(fs::read(path).unwrap().as_slice())
        .unwrap()
        .to_json_value(&Unhasher::empty());
    assert_eq!(
        decoded["base_root"]["purchases"][&unknown_key]["tree_id"],
        -123456789
    );
}

#[test]
fn core_decode_failure_is_visible_and_clears_write_authorization() {
    for name in [
        "persist.game.json",
        "persist.roster.json",
        "persist.estate.json",
        "persist.town.json",
        "persist.upgrades.json",
        "persist.campaign_log.json",
        "persist.progression.json",
    ] {
        let sandbox = Sandbox::new();
        let (mut table, _) = sandbox.load();
        fs::write(sandbox.profile().join(name), b"not a DSON file").unwrap();
        let before = tree(&sandbox.profile());
        let error = save::load_profile_with_table(
            sandbox.profile().to_string_lossy().into_owned(),
            &mut table,
        )
        .unwrap_err();
        assert!(
            error.contains(name) && error.contains("Failed to decode core save"),
            "{error}"
        );
        assert!(table.loaded_profile.is_none());
        assert!(sandbox.save(&mut table, json!({})).is_err());
        assert_eq!(tree(&sandbox.profile()), before);
    }
}

#[test]
fn profile_save_refuses_deletion_requests_before_writing() {
    let sandbox = Sandbox::new();
    let (mut table, data) = sandbox.load();
    let before = tree(&sandbox.profile());
    for name in data.as_object().unwrap().keys() {
        let error = sandbox
            .save(
                &mut table,
                json!({"_deleted": [name], "persist.game.json": data["persist.game.json"]}),
            )
            .unwrap_err();
        assert!(error.contains("Invalid save filename: _deleted"), "{error}");
        assert_eq!(tree(&sandbox.profile()), before);
    }
}

#[test]
fn progression_duplicate_scalar_edits_reach_both_copies_and_repeat_safely() {
    let sandbox = Sandbox::new();
    let (mut table, mut data) = sandbox.load();
    let achievement = &mut data["persist.progression.json"]["base_root"]["real_achievements"]
        ["slay_a_squiffy_with_jester"];
    assert!(achievement.is_object());
    // Use the actual scalar field names and types from the duplicated achievement.
    let key = achievement
        .as_object()
        .unwrap()
        .iter()
        .find(|(_, v)| v.is_i64())
        .unwrap()
        .0
        .clone();
    achievement[&key] = json!(17);
    sandbox
        .save(
            &mut table,
            json!({"persist.progression.json": data["persist.progression.json"]}),
        )
        .unwrap();
    let bytes = fs::read(sandbox.profile().join("persist.progression.json")).unwrap();
    let text = raw_json(&bytes);
    let copies: Vec<_> = text
        .split("\"slay_a_squiffy_with_jester\" : {")
        .skip(1)
        .map(|s| s.split('}').next().unwrap())
        .collect();
    assert_eq!(copies.len(), 2);
    for copy in copies {
        assert!(copy.contains(&format!("\"{key}\" : 17")), "{copy}");
    }
    sandbox
        .save(
            &mut table,
            json!({"persist.progression.json": data["persist.progression.json"]}),
        )
        .unwrap();
    assert_eq!(
        fs::read(sandbox.profile().join("persist.progression.json")).unwrap(),
        bytes
    );
}

#[test]
fn last_party_guid_replacement_preserves_four_slots_through_binary_round_trip() {
    let sandbox = Sandbox::new();
    let (mut table, mut data) = sandbox.load();
    assert_eq!(
        data["persist.roster.json"]["base_root"]["last_party"]["last_party_guids"],
        json!([1, 48, 34, -1])
    );
    data["persist.roster.json"]["base_root"]["last_party"]["last_party_guids"] =
        json!([1, 48, -1, -1]);
    sandbox
        .save(
            &mut table,
            json!({"persist.roster.json":data["persist.roster.json"]}),
        )
        .unwrap();
    let (_, reloaded) = sandbox.load();
    assert_eq!(
        reloaded["persist.roster.json"]["base_root"]["last_party"]["last_party_guids"],
        json!([1, 48, -1, -1])
    );
}

#[test]
fn inactive_raid_is_ignored_but_active_raid_still_resolves_the_subfolder() {
    let sandbox = Sandbox::new();
    let raid_path = sandbox
        .profile()
        .join("plot_crimson_court_1/persist.raid.json");
    let bytes = fs::read(&raid_path).unwrap();
    let file = File::try_from_bin(bytes.as_slice()).unwrap();
    let mut raid = file.to_json_value(&Unhasher::empty());
    raid["base_root"]["boss_last_blow_hero_guid"] = json!(44);
    let mut bytes = Vec::new();
    file.merge_json_value(&raid)
        .unwrap()
        .write_to_bin(&mut bytes)
        .unwrap();
    fs::write(&raid_path, &bytes).unwrap();
    let mut table = NameTable {
        names: serde_json::from_str(include_str!("fixtures/upgrade-names.json")).unwrap(),
        version: 1,
        ..NameTable::default()
    };
    let loaded =
        save::load_profile_with_table(sandbox.profile().to_string_lossy().into_owned(), &mut table)
            .unwrap();
    assert_eq!(
        loaded["data"]["persist.game.json"]["base_root"]["inraid"],
        false
    );
    assert!(loaded.get("inactive_raid_hero_guids").is_none());
    assert!(loaded.get("inactive_raid_error").is_none());
    assert!(loaded["data"].get("persist.raid.json").is_none());
    assert!(!table.loaded_files.contains_key("persist.raid.json"));
    let error = sandbox
        .save(&mut table, json!({"persist.raid.json": raid}))
        .unwrap_err();
    assert_eq!(
        error,
        "persist.raid.json was not decoded at load. Reload the profile before saving."
    );
    assert_eq!(fs::read(raid_path).unwrap(), bytes);
    sandbox.activate_raid();
    let loaded =
        save::load_profile_with_table(sandbox.profile().to_string_lossy().into_owned(), &mut table)
            .unwrap();
    assert!(loaded.get("inactive_raid_hero_guids").is_none());
    assert!(loaded["data"].get("persist.raid.json").is_some());
}

#[test]
fn undecodable_inactive_raids_are_ignored_and_active_decode_errors_remain_fatal() {
    for top_level in [false, true] {
        let sandbox = Sandbox::new();
        let raid_path = if top_level {
            let game_path = sandbox.profile().join("persist.game.json");
            let bytes = fs::read(&game_path).unwrap();
            let file = File::try_from_bin(bytes.as_slice()).unwrap();
            let mut game = file.to_json_value(&Unhasher::empty());
            game["base_root"]["raid_save"] = json!("");
            let mut bytes = Vec::new();
            file.merge_json_value(&game)
                .unwrap()
                .write_to_bin(&mut bytes)
                .unwrap();
            fs::write(game_path, bytes).unwrap();
            sandbox.profile().join("persist.raid.json")
        } else {
            sandbox
                .profile()
                .join("plot_crimson_court_1/persist.raid.json")
        };
        fs::write(&raid_path, b"undecodable inactive raid").unwrap();
        let (mut table, _) = sandbox.load();
        let loaded = save::load_profile_with_table(
            sandbox.profile().to_string_lossy().into_owned(),
            &mut table,
        )
        .unwrap();
        assert!(loaded.get("inactive_raid_hero_guids").is_none());
        assert!(loaded["data"].get("persist.raid.json").is_none());
        assert!(!table.loaded_files.contains_key("persist.raid.json"));
        let mut game = loaded["data"]["persist.game.json"].clone();
        game["base_root"]["estatename"] = json!("Still editable");
        sandbox
            .save(&mut table, json!({"persist.game.json":game}))
            .unwrap();
        assert_eq!(fs::read(&raid_path).unwrap(), b"undecodable inactive raid");
        sandbox.activate_raid();
        let error = save::load_profile_with_table(
            sandbox.profile().to_string_lossy().into_owned(),
            &mut table,
        )
        .unwrap_err();
        assert!(
            error.starts_with("Failed to decode core save persist.raid.json:"),
            "{error}"
        );
    }
}

#[test]
fn review_probe_edits_round_trip_with_javascript_numbers() {
    let sandbox = Sandbox::new();
    let (mut table, mut data) = sandbox.load();
    // Exercise the captured save: compact purchases, append estate trinkets,
    // remove a roster hero and replace the last party vector.
    let purchases = data["persist.upgrades.json"]["base_root"]["purchases"]
        .as_object()
        .unwrap();
    let remaining: Vec<_> = purchases
        .values()
        .filter(|purchase| purchase["instance_number"] != json!(44))
        .cloned()
        .collect();
    assert_eq!((purchases.len(), remaining.len()), (1298, 1275));
    data["persist.upgrades.json"]["base_root"]["purchases"] = Value::Object(
        remaining
            .into_iter()
            .enumerate()
            .map(|(index, value)| (index.to_string(), value))
            .collect(),
    );
    let items = data["persist.estate.json"]["base_root"]["trinkets"]["items"]
        .as_object_mut()
        .unwrap();
    assert_eq!(items.len(), 82);
    items.insert(
        "82".into(),
        json!({"id":"sun_ring","type":"trinket","amount":1}),
    );
    items.insert("83".into(), json!({"id":"a","type":"trinket","amount":1}));
    data["persist.roster.json"]["base_root"]["last_party"]["last_party_guids"] =
        json!([1, 48, -1, -1]);
    data["persist.roster.json"]["base_root"]["heroes"]
        .as_object_mut()
        .unwrap()
        .remove("44");
    let mut edits = json!({
        "persist.upgrades.json": data["persist.upgrades.json"],
        "persist.estate.json": data["persist.estate.json"],
        "persist.roster.json": data["persist.roster.json"],
    });
    simulate_frontend_json(&mut edits);
    sandbox.save(&mut table, edits.clone()).unwrap();
    let (_, mut reloaded) = sandbox.load();
    for (name, expected) in edits.as_object().unwrap() {
        simulate_frontend_json(&mut reloaded[name]);
        assert_eq!(&reloaded[name], expected, "{name}");
    }
}

#[test]
fn backup_listing_uses_manifest_counts_and_skips_invalid_entries() {
    let sandbox = Sandbox::new();
    let good = backup::create_backup_at(&sandbox.profile(), &sandbox.backups()).unwrap();
    let expected_count = tree(&good).len() - 1;
    // A manifest listing does not read each save's bytes, even if a file is gone.
    fs::remove_file(good.join("persist.roster.json")).unwrap();
    let bad = sandbox.backups().join("profile_0__bad");
    fs::create_dir(&bad).unwrap();
    fs::write(bad.join(".hamlet-backup.json"), b"invalid manifest").unwrap();
    let listed = backup::list_backups_at(&sandbox.profile(), &sandbox.backups()).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].file_count, expected_count);
}

#[test]
fn editor_restore_checks_steam_before_safety_backup_or_mutation() {
    for change in ["create", "nested-create", "delete", "overwrite"] {
        for steam_running in [false, true] {
            let sandbox = Sandbox::steam();
            let original = tree(&sandbox.profile());
            let backup_root = sandbox.0.join("source-backups");
            let snapshot = backup::create_backup_at(&sandbox.profile(), &backup_root).unwrap();
            match change {
                "create" => fs::remove_file(sandbox.profile().join("persist.roster.json")).unwrap(),
                "nested-create" => {
                    fs::remove_dir_all(sandbox.profile().join("plot_crimson_court_1")).unwrap()
                }
                "delete" => {
                    fs::write(sandbox.profile().join("persist.raid.json"), b"new raid").unwrap()
                }
                _ => fs::write(
                    sandbox.profile().join("persist.roster.json"),
                    b"changed roster",
                )
                .unwrap(),
            }
            let before = tree(&sandbox.profile());
            let check = backup::check_restore_with_detectors(
                Some(&snapshot),
                &sandbox.profile(),
                || Ok(false),
                || {
                    if change == "overwrite" {
                        panic!("overwrite preflight detection");
                    }
                    Ok(steam_running)
                },
            )
            .unwrap();
            let expected_adds = match change {
                "create" => 1,
                "nested-create" => 2,
                _ => 0,
            };
            assert_eq!(
                (check.adds, check.removes),
                (expected_adds, usize::from(change == "delete"))
            );
            assert_eq!(
                check.blocked_reason.is_some(),
                steam_running && change != "overwrite"
            );
            assert_eq!(tree(&sandbox.profile()), before);
            assert!(!sandbox.backups().exists());
            let result = backup::restore_backup_with_detectors(
                &snapshot,
                &sandbox.profile(),
                &sandbox.backups(),
                || Ok(false),
                || {
                    if change == "overwrite" {
                        panic!("overwrite must skip Steam detection");
                    }
                    Ok(steam_running)
                },
            );
            if steam_running && change != "overwrite" {
                assert!(result.unwrap_err().starts_with("Quit Steam completely"));
                assert_eq!(tree(&sandbox.profile()), before);
                assert!(!sandbox.backups().exists());
            } else {
                result.unwrap();
                assert_eq!(tree(&sandbox.profile()), original);
                assert_eq!(fs::read_dir(sandbox.backups()).unwrap().count(), 1);
            }
        }
    }
}

#[test]
fn game_restore_checks_creates_but_allows_overwrites_and_preserves_extra_files() {
    for creates in [false, true] {
        for steam_running in [false, true] {
            let sandbox = Sandbox::steam();
            // The fixture's game backup includes files absent from the profile.
            // Populate its restore targets so only the roster controls creation.
            for (path, bytes) in tree(&sandbox.profile().join("backup")) {
                if ![
                    "persist.raid.json",
                    "persist.map.json",
                    "persist.loading_screen.json",
                ]
                .iter()
                .any(|name| path == Path::new(name))
                {
                    fs::write(sandbox.profile().join(path), bytes).unwrap();
                }
            }
            if creates {
                fs::remove_file(sandbox.profile().join("persist.roster.json")).unwrap();
            } else {
                fs::write(
                    sandbox.profile().join("persist.roster.json"),
                    b"changed roster",
                )
                .unwrap();
            }
            fs::write(sandbox.profile().join("persist.raid.json"), b"keep raid").unwrap();
            let before = tree(&sandbox.profile());
            let result = backup::restore_game_backup_with_detectors(
                &sandbox.profile(),
                &sandbox.backups(),
                || Ok(false),
                || {
                    if !creates {
                        panic!("overwrite must skip Steam detection");
                    }
                    Ok(steam_running)
                },
            );
            if creates && steam_running {
                assert!(result.unwrap_err().starts_with("Quit Steam completely"));
                assert_eq!(tree(&sandbox.profile()), before);
                assert!(!sandbox.backups().exists());
            } else {
                result.unwrap();
                assert_eq!(
                    fs::read(sandbox.profile().join("persist.roster.json")).unwrap(),
                    fs::read(sandbox.profile().join("backup/persist.roster.json")).unwrap()
                );
                assert_eq!(
                    fs::read(sandbox.profile().join("persist.raid.json")).unwrap(),
                    b"keep raid"
                );
                assert_eq!(fs::read_dir(sandbox.backups()).unwrap().count(), 1);
            }
        }
    }
}

#[test]
fn normal_save_refuses_missing_files_before_writing_anything() {
    let sandbox = Sandbox::new();
    let (mut table, mut data) = sandbox.load();
    let before = tree(&sandbox.profile());
    data["persist.new_optional.json"] = json!({"__revision_dont_touch": 1, "base_root": {}});
    data["persist.roster.json"]["base_root"]["test_field"] = json!(1);
    let error = sandbox.save(&mut table, data).unwrap_err();
    assert!(error.starts_with("Cannot create save file persist.new_optional.json."));
    assert_eq!(tree(&sandbox.profile()), before);
}

#[test]
fn preflight_and_restore_share_checks_without_preflight_writes() {
    for game_backup in [false, true] {
        let sandbox = Sandbox::steam();
        let snapshot =
            backup::create_backup_at(&sandbox.profile(), &sandbox.0.join("source")).unwrap();
        let selected = if game_backup {
            None
        } else {
            Some(snapshot.as_path())
        };
        let original = tree(&sandbox.profile());
        let check = backup::check_restore_with_detectors(
            selected,
            &sandbox.profile(),
            || Ok(false),
            || panic!("overwrite detection"),
        )
        .unwrap();
        assert_eq!((check.adds, check.removes), (0, 0));
        assert!(check.blocked_reason.is_none());
        assert_eq!(tree(&sandbox.profile()), original);
        assert!(!sandbox.backups().exists());
        fs::remove_file(sandbox.profile().join("persist.roster.json")).unwrap();
        let before = tree(&sandbox.profile());
        let check = backup::check_restore_with_detectors(
            selected,
            &sandbox.profile(),
            || Ok(false),
            || Ok(true),
        )
        .unwrap();
        assert_eq!((check.adds, check.removes), (1, 0));
        assert!(check
            .blocked_reason
            .unwrap()
            .starts_with("Quit Steam completely"));
        let stopped = backup::check_restore_with_detectors(
            selected,
            &sandbox.profile(),
            || Ok(false),
            || Ok(false),
        )
        .unwrap();
        assert!(stopped.blocked_reason.is_none());
        assert_eq!(tree(&sandbox.profile()), before);
        assert!(!sandbox.backups().exists());
        for preflight in [true, false] {
            let result = if preflight {
                backup::check_restore_with_detectors(
                    selected,
                    &sandbox.profile(),
                    || Ok(false),
                    || Err("Steam detector failed".into()),
                )
                .map(|_| ())
            } else if game_backup {
                backup::restore_game_backup_with_detectors(
                    &sandbox.profile(),
                    &sandbox.backups(),
                    || Ok(false),
                    || Err("Steam detector failed".into()),
                )
            } else {
                backup::restore_backup_with_detectors(
                    &snapshot,
                    &sandbox.profile(),
                    &sandbox.backups(),
                    || Ok(false),
                    || Err("Steam detector failed".into()),
                )
            };
            assert_eq!(result.unwrap_err(), "Steam detector failed");
            assert_eq!(tree(&sandbox.profile()), before);
            assert!(!sandbox.backups().exists());
        }
        let error = backup::check_restore_with_detectors(
            selected,
            &sandbox.profile(),
            || Ok(true),
            || panic!("game guard first"),
        )
        .unwrap_err();
        assert!(error.starts_with("Darkest Dungeon is running"));
        if !game_backup {
            fs::remove_file(snapshot.join("persist.roster.json")).unwrap();
            assert_eq!(
                backup::check_restore_with_detectors(
                    selected,
                    &sandbox.profile(),
                    || Ok(false),
                    || panic!("validation first")
                )
                .unwrap_err(),
                "Backup files do not match the manifest. Restore was not started."
            );
        }
        assert_eq!(tree(&sandbox.profile()), before);
        assert!(!sandbox.backups().exists());
    }
}

#[test]
fn non_steam_profiles_skip_steam_guard_for_set_changes() {
    for editor in [false, true] {
        let sandbox = Sandbox::new();
        let snapshot =
            backup::create_backup_at(&sandbox.profile(), &sandbox.0.join("source")).unwrap();
        fs::remove_file(sandbox.profile().join("persist.roster.json")).unwrap();
        let check = backup::check_restore_with_detectors(
            editor.then_some(snapshot.as_path()),
            &sandbox.profile(),
            || Ok(false),
            || panic!("manual profile must skip Steam"),
        )
        .unwrap();
        assert_eq!(check.adds, 1);
        assert!(check.blocked_reason.is_none());
        if editor {
            backup::restore_backup_with_detectors(
                &snapshot,
                &sandbox.profile(),
                &sandbox.backups(),
                || Ok(false),
                || panic!("manual profile must skip Steam"),
            )
            .unwrap();
        } else {
            backup::restore_game_backup_with_detectors(
                &sandbox.profile(),
                &sandbox.backups(),
                || Ok(false),
                || panic!("manual profile must skip Steam"),
            )
            .unwrap();
        }
    }
}

#[test]
fn untouched_game_fixture_excludes_transient_snapshots() {
    for steam_running in [false, true] {
        let sandbox = Sandbox::steam();
        let before = tree(&sandbox.profile());
        let check = backup::check_restore_with_detectors(
            None,
            &sandbox.profile(),
            || Ok(false),
            || Ok(steam_running),
        )
        .unwrap();
        assert_eq!((check.adds, check.removes), (0, 0));
        assert!(check.blocked_reason.is_none());
        backup::restore_game_backup_with_detectors(
            &sandbox.profile(),
            &sandbox.backups(),
            || Ok(false),
            || Ok(steam_running),
        )
        .unwrap();
        assert_eq!(
            tree(&sandbox.profile()).keys().collect::<Vec<_>>(),
            before.keys().collect::<Vec<_>>()
        );
        for name in [
            "persist.raid.json",
            "persist.map.json",
            "persist.loading_screen.json",
        ] {
            assert!(!sandbox.profile().join(name).exists());
        }
    }
}

#[test]
fn unfiltered_game_fixture_requires_steam_stopped_when_restored_as_legacy_snapshot() {
    for steam_running in [false, true] {
        let sandbox = Sandbox::steam();
        let snapshot = sandbox.0.join("profile_0__legacy");
        copy_tree(&sandbox.profile().join("backup"), &snapshot);
        let before = tree(&sandbox.profile());
        let result = backup::restore_backup_with_detectors(
            &snapshot,
            &sandbox.profile(),
            &sandbox.backups(),
            || Ok(false),
            || Ok(steam_running),
        );
        if steam_running {
            assert!(result.unwrap_err().starts_with("Quit Steam completely"));
            assert_eq!(tree(&sandbox.profile()), before);
            assert!(!sandbox.backups().exists());
        } else {
            result.unwrap();
            assert!(sandbox
                .profile()
                .join("persist.loading_screen.json")
                .exists());
        }
    }
}

#[cfg(unix)]
#[test]
fn steam_guard_uses_canonical_destination_through_manual_alias() {
    let sandbox = Sandbox::steam();
    let alias = sandbox.0.join("manual-profile");
    std::os::unix::fs::symlink(sandbox.profile(), &alias).unwrap();
    fs::remove_file(sandbox.profile().join("persist.roster.json")).unwrap();
    let before = tree(&sandbox.profile());
    let check =
        backup::check_restore_with_detectors(None, &alias, || Ok(false), || Ok(true)).unwrap();
    assert_eq!(check.adds, 1);
    assert!(check.blocked_reason.is_some());
    assert_eq!(tree(&sandbox.profile()), before);
    assert!(!sandbox.backups().exists());
}

#[test]
fn preflight_validates_transaction_targets_before_safety_backup() {
    for game_backup in [false, true] {
        let sandbox = Sandbox::steam();
        let snapshot =
            backup::create_backup_at(&sandbox.profile(), &sandbox.0.join("source")).unwrap();
        fs::remove_file(sandbox.profile().join("persist.roster.json")).unwrap();
        fs::create_dir(sandbox.profile().join("persist.roster.json")).unwrap();
        let before = tree(&sandbox.profile());
        let selected = if game_backup {
            None
        } else {
            Some(snapshot.as_path())
        };
        let error = backup::check_restore_with_detectors(
            selected,
            &sandbox.profile(),
            || Ok(false),
            || panic!("validation precedes Steam"),
        )
        .unwrap_err();
        assert!(error.starts_with("Save target is not a file:"), "{error}");
        let result = if game_backup {
            backup::restore_game_backup_with_detectors(
                &sandbox.profile(),
                &sandbox.backups(),
                || Ok(false),
                || panic!("validation precedes Steam"),
            )
        } else {
            backup::restore_backup_with_detectors(
                &snapshot,
                &sandbox.profile(),
                &sandbox.backups(),
                || Ok(false),
                || panic!("validation precedes Steam"),
            )
        };
        assert_eq!(result.unwrap_err(), error);
        assert_eq!(tree(&sandbox.profile()), before);
        assert!(!sandbox.backups().exists());
    }
}

#[cfg(unix)]
#[test]
fn steam_guard_uses_supplied_steam_path_to_external_profile() {
    let sandbox = Sandbox::new();
    let remote = sandbox.0.join("userdata/123/262060/remote");
    fs::create_dir_all(&remote).unwrap();
    let alias = remote.join("profile_0_link");
    std::os::unix::fs::symlink(sandbox.profile(), &alias).unwrap();
    let snapshot = backup::create_backup_at(&sandbox.profile(), &sandbox.0.join("source")).unwrap();
    fs::remove_file(sandbox.profile().join("persist.roster.json")).unwrap();
    let before = tree(&sandbox.profile());
    for editor in [false, true] {
        let check = backup::check_restore_with_detectors(
            editor.then_some(snapshot.as_path()),
            &alias,
            || Ok(false),
            || Ok(true),
        )
        .unwrap();
        assert_eq!(check.adds, 1);
        assert!(check.blocked_reason.is_some());
        let result = if editor {
            backup::restore_backup_with_detectors(
                &snapshot,
                &alias,
                &sandbox.backups(),
                || Ok(false),
                || Ok(true),
            )
        } else {
            backup::restore_game_backup_with_detectors(
                &alias,
                &sandbox.backups(),
                || Ok(false),
                || Ok(true),
            )
        };
        assert!(result.unwrap_err().starts_with("Quit Steam completely"));
        assert_eq!(tree(&sandbox.profile()), before);
        assert!(!sandbox.backups().exists());
    }
}

#[cfg(target_os = "linux")]
#[test]
fn preflight_rejects_non_utf8_profile_id_without_writes() {
    use std::os::unix::ffi::OsStringExt;
    let sandbox = Sandbox::new();
    let destination = sandbox
        .0
        .join(std::ffi::OsString::from_vec(b"profile_\xff".to_vec()));
    fs::rename(sandbox.profile(), &destination).unwrap();
    let before = tree(&destination);
    let check = backup::check_restore_with_detectors(
        None,
        &destination,
        || Ok(false),
        || panic!("invalid ID must fail first"),
    );
    assert_eq!(check.unwrap_err(), "Invalid profile ID");
    assert_eq!(tree(&destination), before);
    assert!(!sandbox.backups().exists());
}

#[test]
fn restore_safety_backup_matches_a_normal_backup_of_the_profile() {
    let without_manifest = |root: &Path| {
        let mut files = tree(root);
        files.remove(Path::new(".hamlet-backup.json"));
        files
    };
    for game in [false, true] {
        let sandbox = Sandbox::new();
        let backup = backup::create_backup_at(&sandbox.profile(), &sandbox.backups()).unwrap();
        fs::write(sandbox.profile().join("persist.roster.json"), b"changed").unwrap();
        fs::write(
            sandbox.profile().join("backup/persist.estate.json"),
            b"changed backup copy",
        )
        .unwrap();
        let reference_root = sandbox.0.join("reference-backups");
        let reference = backup::create_backup_at(&sandbox.profile(), &reference_root).unwrap();
        if game {
            backup::restore_game_backup_with_detectors(
                &sandbox.profile(),
                &sandbox.backups(),
                || Ok(false),
                || Ok(false),
            )
            .unwrap();
        } else {
            backup::restore_backup_with_detectors(
                &backup,
                &sandbox.profile(),
                &sandbox.backups(),
                || Ok(false),
                || Ok(false),
            )
            .unwrap();
        }
        let safety: Vec<_> = fs::read_dir(sandbox.backups())
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| *path != backup)
            .collect();
        assert_eq!(safety.len(), 1);
        let expected = without_manifest(&reference);
        assert!(expected.contains_key(Path::new("backup/persist.estate.json")));
        assert!(expected.contains_key(Path::new("plot_crimson_court_1/persist.raid.json")));
        assert_eq!(without_manifest(&safety[0]), expected);
    }
}
