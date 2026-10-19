use ddsavelib::{File, Unhasher};
use serde_json::json;

fn binary(file: &File) -> Vec<u8> {
    let mut bytes = Vec::new();
    file.write_to_bin(&mut bytes).unwrap();
    bytes
}

fn text(file: &File) -> String {
    let mut bytes = Vec::new();
    file.write_to_json(&mut bytes, true, &Unhasher::empty())
        .unwrap();
    String::from_utf8(bytes).unwrap()
}

#[test]
fn torchlight_fields_are_float_bits_in_both_json_input_paths() {
    let value = json!({"__revision_dont_touch": 1, "base_root": {"torchlight": 100, "ambush_start_torchlight": 42.5}});
    for file in [
        File::from_json_value(&value).unwrap(),
        File::try_from_json(value.to_string().as_bytes()).unwrap(),
    ] {
        let bytes = binary(&file);
        let decoded = File::try_from_bin(bytes.as_slice())
            .unwrap()
            .to_json_value(&Unhasher::empty());
        assert_eq!(decoded["base_root"]["torchlight"], 100.0);
        assert_eq!(decoded["base_root"]["ambush_start_torchlight"], 42.5);
        assert!(bytes.windows(4).any(|b| b == 100.0_f32.to_le_bytes()));
    }
}

#[test]
fn merge_keeps_nested_duplicates_order_and_appends_new_keys() {
    let file = File::try_from_json(br#"{"__revision_dont_touch":1,"base_root":{"heroes":{"9":{"name":"first"},"2":{"name":"second"}},"x":{"earlier":1},"x":{"visible":2},"unrelated":3}}"#.as_slice()).unwrap();
    let mut value = file.to_json_value(&Unhasher::empty());
    value["base_root"]["x"]["visible"] = json!(4);
    value["base_root"]["added"] = json!(5);
    let merged = file.merge_json_value(&value).unwrap();
    let output = text(&merged);
    assert_eq!(output.matches("\"x\"").count(), 2);
    assert!(output.contains("\"earlier\" : 1"), "{output}");
    assert!(output.contains("\"visible\" : 4"), "{output}");
    assert!(output.find("\"9\"") < output.find("\"2\""));
    assert!(output.find("\"unrelated\"") < output.find("\"added\""));
    value["base_root"].as_object_mut().unwrap().remove("x");
    assert!(!text(&merged.merge_json_value(&value).unwrap()).contains("\"x\""));
}

#[test]
fn control_characters_are_rejected_in_strings_keys_chars_and_vectors() {
    for control in ['\0', '\u{1}', '\n', '\u{7f}'] {
        for value in [
            json!({"__revision_dont_touch": 1, "base_root": {"name": format!("A{control}B")}}),
            json!({"__revision_dont_touch": 1, "base_root": {"tree_id": format!("###A{control}B")}}),
            json!({"__revision_dont_touch": 1, "base_root": {"last_party_guids": [format!("###A{control}B")]}}),
            json!({"__revision_dont_touch": 1, "base_root": {format!("A{control}B"): 1}}),
            json!({"__revision_dont_touch": 1, "base_root": {"requirement_code": control.to_string()}}),
            json!({"__revision_dont_touch": 1, "base_root": {"goal_ids": [format!("A{control}B")]}}),
        ] {
            for error in [
                File::from_json_value(&value).unwrap_err(),
                File::try_from_json(value.to_string().as_bytes()).unwrap_err(),
            ] {
                assert!(
                    error.to_string().contains("control characters or NUL"),
                    "{error}"
                );
            }
        }
    }
}

#[test]
fn binary_control_character_input_returns_an_error_without_panicking() {
    let file =
        File::from_json_value(&json!({"__revision_dont_touch":1,"base_root":{"name":"Alice"}}))
            .unwrap();
    let original = binary(&file);
    let offset = original.windows(5).position(|b| b == b"Alice").unwrap();
    for control in [0, 1, 10, 127] {
        let mut corrupted = original.clone();
        corrupted[offset + 2] = control;
        let result = std::panic::catch_unwind(|| File::try_from_bin(corrupted.as_slice()));
        assert!(result.is_ok(), "decoder panicked for control {control}");
        assert!(result.unwrap().is_err());
    }
}

#[test]
fn float_overflow_returns_an_error_instead_of_invalid_json() {
    let value = json!({"__revision_dont_touch":1,"base_root":{"torchlight": 1e100}});
    assert!(File::from_json_value(&value).is_err());
    assert!(File::try_from_json(value.to_string().as_bytes()).is_err());
}

#[test]
fn quoted_field_names_generate_valid_json_without_panicking() {
    let value = json!({"__revision_dont_touch":1,"base_root":{"quoted\"name\\": "Alice"}});
    let file = File::from_json_value(&value).unwrap();
    let bytes = binary(&file);
    assert_eq!(
        File::try_from_bin(bytes.as_slice())
            .unwrap()
            .to_json_value(&Unhasher::empty()),
        value
    );
}
