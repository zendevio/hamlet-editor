use ddsavelib::{File, Unhasher};
use serde_json::{json, Value};

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

// Reuse bulk review 3's float_dup probe: JSON.stringify turns integral floats into integers.
fn js_numbers(value: &Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(key, value)| (key.clone(), js_numbers(value)))
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.iter().map(js_numbers).collect()),
        Value::Number(n) if n.is_f64() && n.as_f64().unwrap().fract() == 0.0 => {
            json!(n.as_f64().unwrap() as i64)
        }
        _ => value.clone(),
    }
}

#[test]
fn js_integral_floats_preserve_duplicate_scalars_objects_and_array_elements() {
    let source = r#"{"__revision_dont_touch":1,"base_root":{"x":{"current_hp":5.0,"m_Stress":10.0,"map":{"bounds":[1.0,3.0]}},"x":{"current_hp":7.0,"m_Stress":20.0,"map":{"bounds":[2.0,4.0]}},"torchlight":50.0,"torchlight":60.0,"other":0}}"#;
    let file = File::try_from_json(source.as_bytes()).unwrap();
    let mut value = js_numbers(&file.to_json_value(&Unhasher::empty()));
    assert!(value["base_root"]["x"]["current_hp"].is_u64());
    assert_eq!(
        binary(&file.merge_json_value(&value).unwrap()),
        binary(&file)
    );

    // Editing an unrelated field must not spread the visible float over earlier copies.
    value["base_root"]["other"] = json!(1);
    let expected =
        File::try_from_json(source.replace("\"other\":0", "\"other\":1").as_bytes()).unwrap();
    assert_eq!(
        binary(&file.merge_json_value(&value).unwrap()),
        binary(&expected)
    );

    // A real edit reaches both copies, retaining unequal unedited floats and array positions.
    value["base_root"]["x"]["current_hp"] = json!(9);
    value["base_root"]["x"]["map"]["bounds"][1] = json!(6);
    let expected = File::try_from_json(br#"{"__revision_dont_touch":1,"base_root":{"x":{"current_hp":9.0,"m_Stress":10.0,"map":{"bounds":[1.0,6.0]}},"x":{"current_hp":9.0,"m_Stress":20.0,"map":{"bounds":[2.0,6.0]}},"torchlight":50.0,"torchlight":60.0,"other":1}}"#.as_slice()).unwrap();
    assert_eq!(
        binary(&file.merge_json_value(&value).unwrap()),
        binary(&expected)
    );
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
    assert_eq!(output.matches("\"visible\" : 4").count(), 2);
    assert!(output.contains("\"visible\" : 4"), "{output}");
    assert!(output.find("\"9\"") < output.find("\"2\""));
    assert!(output.find("\"unrelated\"") < output.find("\"added\""));
    value["base_root"].as_object_mut().unwrap().remove("x");
    assert!(!text(&merged.merge_json_value(&value).unwrap()).contains("\"x\""));
}

#[test]
fn merge_preserves_unedited_duplicate_values_and_only_applies_visible_delta() {
    let file = File::try_from_json(br#"{"__revision_dont_touch":1,"base_root":{"x":{"earlier":1,"shared":10,"changed":1,"removed":7,"nested":{"private":3,"same":1,"edit":1},"goal_ids":["early","old"]},"x":{"visible":2,"shared":20,"changed":2,"removed":8,"nested":{"same":2,"edit":2},"goal_ids":["late","old"]},"scalar":1,"scalar":2,"other":0}}"#.as_slice()).unwrap();
    let mut value = file.to_json_value(&Unhasher::empty());
    value["base_root"]["other"] = json!(1);
    let unrelated = text(&file.merge_json_value(&value).unwrap());
    for fragment in [
        "\"earlier\" : 1",
        "\"shared\" : 10",
        "\"shared\" : 20",
        "\"scalar\" : 1",
        "\"scalar\" : 2",
        "\"changed\" : 1",
        "\"changed\" : 2",
    ] {
        assert!(unrelated.contains(fragment), "{unrelated}");
    }
    // The visible last-copy edit reaches both copies, while untouched fields differ.
    let x = &mut value["base_root"]["x"];
    x["changed"] = json!(9);
    x["nested"]["edit"] = json!(6);
    x["goal_ids"][1] = json!("new");
    x.as_object_mut().unwrap().remove("removed");
    value["base_root"]["scalar"] = json!(4);
    let output = text(&file.merge_json_value(&value).unwrap());
    for fragment in [
        "\"earlier\" : 1",
        "\"shared\" : 10",
        "\"shared\" : 20",
        "\"private\" : 3",
        "\"same\" : 1",
        "\"same\" : 2",
        "\"early\"",
        "\"late\"",
    ] {
        assert!(output.contains(fragment), "{output}");
    }
    for fragment in [
        "\"changed\" : 9",
        "\"edit\" : 6",
        "\"scalar\" : 4",
        "\"new\"",
    ] {
        assert_eq!(output.matches(fragment).count(), 2, "{output}");
    }
    assert!(!output.contains("\"removed\""), "{output}");
    assert_eq!(output.matches("\"visible\"").count(), 1, "{output}");
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
fn binary_controls_are_escaped_preserved_on_unrelated_edits_and_rejected_when_edited() {
    let file = File::from_json_value(
        &json!({"__revision_dont_touch":1,"base_root":{"name":"Alice", "counter":1}}),
    )
    .unwrap();
    let original = binary(&file);
    let offset = original.windows(5).position(|b| b == b"Alice").unwrap();
    for control in [1, 9, 10, 13, 31, 127] {
        let mut bytes = original.clone();
        bytes[offset + 2] = control;
        let decoded = File::try_from_bin(bytes.as_slice()).unwrap();
        let mut value = decoded.to_json_value(&Unhasher::empty());
        assert_eq!(
            value["base_root"]["name"].as_str().unwrap().as_bytes()[2],
            control
        );
        assert_eq!(binary(&decoded), bytes);
        value["base_root"]["counter"] = json!(2);
        let merged = decoded.merge_json_value(&value).unwrap();
        assert_eq!(merged.to_json_value(&Unhasher::empty()), value);
        assert!(binary(&merged)
            .windows(5)
            .any(|b| b == &bytes[offset..offset + 5]));
        value["base_root"]["name"] = json!(format!("New{}Name", control as char));
        assert!(decoded
            .merge_json_value(&value)
            .unwrap_err()
            .to_string()
            .contains("control characters or NUL"));
    }
    let mut nul = original;
    nul[offset + 2] = 0;
    assert!(File::try_from_bin(nul.as_slice()).is_err());
}

#[test]
fn merge_preserves_original_string_type_for_hash_prefix_names_including_embedded_files() {
    let value = json!({"__revision_dont_touch":1,"base_root":{"name":"Alice", "hero_file_data":{"raw_data":{"__revision_dont_touch":1,"base_root":{"name":"Alice"}}}}});
    let original = File::from_json_value(&value).unwrap();
    let mut edited = value;
    edited["base_root"]["name"] = json!("###Estate");
    edited["base_root"]["hero_file_data"]["raw_data"]["base_root"]["name"] = json!("###Hero");
    let merged = original.merge_json_value(&edited).unwrap();
    assert_eq!(
        File::try_from_bin(binary(&merged).as_slice())
            .unwrap()
            .to_json_value(&Unhasher::empty()),
        edited
    );
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
