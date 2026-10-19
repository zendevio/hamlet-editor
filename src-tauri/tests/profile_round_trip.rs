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
    fn profile(&self) -> PathBuf {
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

fn reorder_objects(value: &mut Value) {
    if let Some(map) = value.as_object_mut() {
        for child in map.values_mut() {
            reorder_objects(child);
        }
        let mut entries: Vec<_> = std::mem::take(map).into_iter().collect();
        entries.reverse();
        map.extend(entries);
    } else if let Some(array) = value.as_array_mut() {
        for child in array {
            reorder_objects(child);
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
        reorder_objects(&mut data);
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
    reorder_objects(&mut data);
    sandbox.save(&mut table, data.clone()).unwrap();
    data["persist.game.json"]["base_root"]["estatename"] = json!("Second edit");
    sandbox.save(&mut table, data).unwrap();
    assert_eq!(
        fs::read(sandbox.profile().join("persist.progression.json")).unwrap(),
        normalized(&original)
    );
}

#[test]
fn encoding_failure_preserves_all_files_and_pending_deletions() {
    let sandbox = Sandbox::new();
    sandbox.activate_raid();
    let before = tree(&sandbox.profile());
    let (mut table, mut data) = sandbox.load();
    data["persist.estate.json"]["base_root"]["bad_integer"] = json!(99_999_999_999_i64);
    data["persist.game.json"]["base_root"]["estatename"] = json!("Must not be written");
    data["_deleted"] = json!(["persist.raid.json"]);
    data.as_object_mut().unwrap().remove("persist.raid.json");
    let error = sandbox.save(&mut table, data).unwrap_err();
    assert!(error.contains("persist.estate.json"), "{error}");
    assert!(error.contains("base_root.bad_integer"), "{error}");
    assert_eq!(tree(&sandbox.profile()), before);
}

#[test]
fn raid_subfolder_float_edit_and_deletion_leave_unsupported_map_untouched() {
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
    data["persist.game.json"]["base_root"]["raid_save"] = json!("");
    sandbox.save(&mut table, json!({"persist.game.json": data["persist.game.json"], "_deleted": ["persist.raid.json"]})).unwrap();
    assert!(!sandbox
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
    backup::restore_backup_with_detector(&backup, &sandbox.profile(), &sandbox.backups(), || {
        Ok(false)
    })
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
    assert!(backup::restore_backup_with_detector(
        &backup,
        &second.profile(),
        &second.backups(),
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
    let error = backup::restore_backup_with_detector(
        &backup,
        &sandbox.profile(),
        &sandbox.backups(),
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
    let error = backup::restore_backup_with_detector(
        Path::new("missing-backup"),
        &sandbox.profile(),
        &sandbox.backups(),
        || Ok(true),
    )
    .unwrap_err();
    assert!(error.starts_with("Darkest Dungeon is running"));
    let error =
        backup::restore_game_backup_with_detector(&sandbox.profile(), &sandbox.backups(), || {
            Ok(true)
        })
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
    backup::restore_game_backup_with_detector(&sandbox.profile(), &sandbox.backups(), || Ok(false))
        .unwrap();
    assert!(!sandbox.profile().join("persist.raid.json").exists());
    assert!(!sandbox.profile().join("persist.map.json").exists());
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
fn deletion_allow_list_refuses_every_non_raid_file_before_writing() {
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
        assert!(
            error.contains("only persist.raid.json can be deleted"),
            "{error}"
        );
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
fn inactive_raid_references_are_read_only_and_include_non_party_hero_fields() {
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
    assert_eq!(
        loaded["inactive_raid_hero_guids"],
        json!([1, 34, 44, 48, 96])
    );
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
    assert_eq!(loaded["inactive_raid_hero_guids"], json!([]));
    assert!(loaded["data"].get("persist.raid.json").is_some());
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
