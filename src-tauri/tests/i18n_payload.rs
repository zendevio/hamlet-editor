use ddsavelib::File;
use hamlet_editor_lib::{save, NameTable};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

/// H1 compares actual captured payloads. Encode that fixture through the normal
/// loaded-profile merge, provenance guards and transaction, then pin its bytes.
#[test]
fn i18n_edit_payload_has_stable_production_save_bytes() {
    fn add_dev_fixture_revisions(value: &mut Value) {
        match value {
            Value::Object(object) => {
                for child in object.values_mut() {
                    add_dev_fixture_revisions(child);
                }
                if object.contains_key("base_root") {
                    object.insert("__revision_dont_touch".into(), Value::from(513));
                }
            }
            Value::Array(array) => array.iter_mut().for_each(add_dev_fixture_revisions),
            _ => {}
        }
    }
    struct Profile(std::path::PathBuf);
    impl Drop for Profile {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    let profile =
        Profile(std::env::temp_dir().join(format!("hamlet-i18n-payload-{}", std::process::id())));
    std::fs::create_dir(&profile.0).unwrap();
    let mut payload: Value =
        serde_json::from_str(include_str!("../../tests/fixtures/i18n-save-payload.json")).unwrap();
    add_dev_fixture_revisions(&mut payload);
    for (name, value) in payload.as_object().unwrap() {
        let mut baseline = value.clone();
        let hero = baseline
            .pointer_mut("/base_root/heroes/7/hero_file_data/raw_data/base_root")
            .unwrap();
        hero["actor"]["name"] = Value::from("Before edit");
        hero["quirks"]
            .as_object_mut()
            .unwrap()
            .remove("unknown_mod_quirk");
        let mut bytes = Vec::new();
        File::from_json_value(&baseline)
            .unwrap()
            .write_to_bin(&mut bytes)
            .unwrap();
        std::fs::write(profile.0.join(name), bytes).unwrap();
    }
    let path = profile.0.to_string_lossy().into_owned();
    let mut table = NameTable {
        names: vec!["stage_coach.rostersize".into()],
        version: 17,
        ..NameTable::default()
    };
    save::load_profile_with_table(path.clone(), &mut table).unwrap();
    save::save_profile_with_detector(path, payload, 17, &mut table, || Ok(false)).unwrap();
    let hashes: BTreeMap<_, _> = table
        .loaded_files
        .keys()
        .map(|name| {
            let bytes = std::fs::read(profile.0.join(name)).unwrap();
            (name.as_str(), format!("{:x}", Sha256::digest(bytes)))
        })
        .collect();
    assert_eq!(
        hashes,
        BTreeMap::from([(
            "persist.roster.json",
            "db99565de83d5d98be1f4935d777db6ef8af7f0988763029aecc52933ec94ab7".to_owned()
        )])
    );
}
