/// Integration tests for the hardcoded type dispatch table in ddsavelib.
///
/// The table maps (field name, optional ancestor path) -> FieldType variant.
/// Without it, every 4-byte-aligned field defaults to Int. These tests verify
/// that Float, IntVector, StringVector, FloatArray, TwoInt, TwoBool, and Char
/// fields survive JSON -> binary -> JSON round-trips with the correct type.
use ddsavelib::{File, Unhasher};

// ---------------------------------------------------------------------------
// Helpers shared across all tests
// ---------------------------------------------------------------------------

/// Parse JSON into a File. Panics with the source error on failure.
fn from_json(json: &str) -> File {
    File::try_from_json(json.as_bytes()).unwrap_or_else(|e| panic!("try_from_json failed: {e}"))
}

/// Encode a File to binary bytes.
fn to_bin(file: &File) -> Vec<u8> {
    let mut bin = Vec::new();
    file.write_to_bin(&mut bin)
        .expect("write_to_bin must not fail writing to Vec");
    bin
}

/// Decode binary bytes to a File.
fn from_bin(bin: &[u8]) -> File {
    File::try_from_bin(&mut &*bin).unwrap_or_else(|e| panic!("try_from_bin failed: {e}"))
}

/// Full round-trip: JSON -> binary -> JSON, returned as a serde_json::Value.
fn roundtrip(json: &str) -> serde_json::Value {
    let file = from_json(json);
    let bin = to_bin(&file);
    let file2 = from_bin(&bin);
    let unhash = Unhasher::<&str>::empty();
    file2.to_json_value(&unhash)
}

/// Navigate a serde_json::Value via a dot-separated path like "base_root.actor.hp".
/// Returns `None` if any segment is missing.
fn get_path<'v>(mut v: &'v serde_json::Value, path: &str) -> Option<&'v serde_json::Value> {
    for segment in path.split('.') {
        v = v.as_object()?.get(segment)?;
    }
    Some(v)
}

/// Return true when a serde_json number value is represented with a decimal point
/// (i.e. the serialised form is floating-point, not integer).
fn looks_like_float(v: &serde_json::Value) -> bool {
    // serde_json::Value::Number stores the original string representation only for
    // arbitrary precision; for standard f64/i64 we must serialise back to text and inspect it.
    let s = serde_json::to_string(v).expect("serialize number");
    s.contains('.') || s.contains('e') || s.contains('E')
}

// ---------------------------------------------------------------------------
// Float fields
// ---------------------------------------------------------------------------

/// Test 1 - current_hp with fractional value 42.5.
#[test]
fn float_current_hp_fractional() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "current_hp": 42.5
        }
    }"#;
    let val = roundtrip(json);
    let hp = get_path(&val, "base_root.current_hp")
        .expect("current_hp must be present after round-trip");
    assert!(
        looks_like_float(hp),
        "current_hp=42.5 must round-trip as float, got: {hp}"
    );
    // Value must be numerically preserved (f32 precision).
    let num = hp.as_f64().expect("current_hp must be a number");
    assert!(
        (num - 42.5).abs() < 1e-5,
        "current_hp must round-trip to 42.5, got: {num}"
    );
}

/// Test 2 - current_hp with integer-looking value 100.
/// Must still be treated as Float: binary stores f32, so JSON output must
/// contain "100.0" (or similar float notation), never bare "100".
#[test]
fn float_current_hp_integer_looking_value() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "current_hp": 100
        }
    }"#;
    let val = roundtrip(json);
    let hp = get_path(&val, "base_root.current_hp")
        .expect("current_hp must be present after round-trip");
    assert!(
        looks_like_float(hp),
        "current_hp=100 must round-trip as float (e.g. 100.0), not as int; got: {hp}"
    );
    let num = hp.as_f64().expect("current_hp must be a number");
    assert!(
        (num - 100.0).abs() < 1e-5,
        "current_hp value must be 100.0, got: {num}"
    );
}

/// Test 3 - m_Stress with value 0.0.
#[test]
fn float_m_stress_zero() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "m_Stress": 0.0
        }
    }"#;
    let val = roundtrip(json);
    let stress =
        get_path(&val, "base_root.m_Stress").expect("m_Stress must be present after round-trip");
    assert!(
        looks_like_float(stress),
        "m_Stress=0.0 must round-trip as float; got: {stress}"
    );
    let num = stress.as_f64().expect("m_Stress must be a number");
    assert!(
        num.abs() < 1e-10,
        "m_Stress must round-trip to 0.0, got: {num}"
    );
}

/// Test 4 - `amount` under actor > buff_group > * wildcard path.
/// The hardcoded path ["actor", "buff_group", "*", "amount"] uses a wildcard
/// for the group name, so any intermediate object name matches.
#[test]
fn float_amount_wildcard_path_matches() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "actor": {
                "buff_group": {
                    "buff_fire": {
                        "amount": 1.5
                    }
                }
            }
        }
    }"#;
    let val = roundtrip(json);
    let amount = get_path(&val, "base_root.actor.buff_group.buff_fire.amount")
        .expect("amount must be present after round-trip");
    assert!(
        looks_like_float(amount),
        "amount under actor>buff_group>* must be Float; got: {amount}"
    );
    let num = amount.as_f64().expect("amount must be a number");
    assert!(
        (num - 1.5).abs() < 1e-5,
        "amount must round-trip to 1.5, got: {num}"
    );
}

/// Test 5 - `amount` under WRONG ancestors must be Int, not Float.
/// The hardcoded path requires ["actor", "buff_group", "*"] as ancestors.
/// Here we use a completely different ancestor chain, so it falls back to Int.
/// We use value 7: as Int it round-trips to 7 (no decimal); as Float it would
/// be 7.0.
#[test]
fn float_amount_wrong_ancestors_is_int() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "inventory": {
                "slot_1": {
                    "amount": 7
                }
            }
        }
    }"#;
    let val = roundtrip(json);
    let amount = get_path(&val, "base_root.inventory.slot_1.amount")
        .expect("amount must be present after round-trip");
    assert!(
        !looks_like_float(amount),
        "amount under wrong ancestors must be Int (no decimal), got: {amount}"
    );
    let num = amount.as_i64().expect("amount must be an integer");
    assert_eq!(num, 7, "amount must round-trip to 7, got: {num}");
}

// ---------------------------------------------------------------------------
// IntVector fields
// ---------------------------------------------------------------------------

/// Test 6 - read_page_indexes with [1, 2, 3].
#[test]
fn intvector_read_page_indexes_basic() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "read_page_indexes": [1, 2, 3]
        }
    }"#;
    let val = roundtrip(json);
    let pages =
        get_path(&val, "base_root.read_page_indexes").expect("read_page_indexes must be present");
    let arr = pages
        .as_array()
        .expect("read_page_indexes must be an array");
    assert_eq!(arr.len(), 3, "must have 3 elements");
    let nums: Vec<i64> = arr
        .iter()
        .map(|v| v.as_i64().expect("must be integer"))
        .collect();
    assert_eq!(nums, vec![1, 2, 3]);
}

/// Test 7 - read_page_indexes with empty [].
#[test]
fn intvector_read_page_indexes_empty() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "read_page_indexes": []
        }
    }"#;
    let val = roundtrip(json);
    let pages =
        get_path(&val, "base_root.read_page_indexes").expect("read_page_indexes must be present");
    let arr = pages.as_array().expect("must be an array");
    assert!(arr.is_empty(), "empty IntVector must round-trip to []");
}

/// Test 8 - dungeon_history with negative values.
#[test]
fn intvector_dungeon_history_negative_values() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "dungeon_history": [-1, 0, 5]
        }
    }"#;
    let val = roundtrip(json);
    let hist =
        get_path(&val, "base_root.dungeon_history").expect("dungeon_history must be present");
    let arr = hist.as_array().expect("must be an array");
    assert_eq!(arr.len(), 3);
    let nums: Vec<i64> = arr
        .iter()
        .map(|v| v.as_i64().expect("must be integer"))
        .collect();
    assert_eq!(nums, vec![-1, 0, 5]);
}

// ---------------------------------------------------------------------------
// StringVector fields
// ---------------------------------------------------------------------------

/// Test 9 - goal_ids with two strings.
#[test]
fn stringvector_goal_ids_basic() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "goal_ids": ["quest_1", "quest_2"]
        }
    }"#;
    let val = roundtrip(json);
    let ids = get_path(&val, "base_root.goal_ids").expect("goal_ids must be present");
    let arr = ids.as_array().expect("goal_ids must be an array");
    assert_eq!(arr.len(), 2);
    assert_eq!(arr[0].as_str().unwrap(), "quest_1");
    assert_eq!(arr[1].as_str().unwrap(), "quest_2");
}

/// Test 10 - goal_ids with empty [].
#[test]
fn stringvector_goal_ids_empty() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "goal_ids": []
        }
    }"#;
    let val = roundtrip(json);
    let ids = get_path(&val, "base_root.goal_ids").expect("goal_ids must be present");
    let arr = ids.as_array().expect("must be an array");
    assert!(arr.is_empty(), "empty StringVector must round-trip to []");
}

/// Test 11 - goal_ids with strings of varying lengths (alignment stress test).
/// Binary StringVector entries are 4-byte aligned; strings of lengths 1-4 exercise
/// each possible alignment-skip value.
#[test]
fn stringvector_goal_ids_varying_lengths() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "goal_ids": ["a", "ab", "abc", "abcd"]
        }
    }"#;
    let val = roundtrip(json);
    let ids = get_path(&val, "base_root.goal_ids").expect("goal_ids must be present");
    let arr = ids.as_array().expect("must be an array");
    assert_eq!(arr.len(), 4);
    let strings: Vec<&str> = arr
        .iter()
        .map(|v| v.as_str().expect("must be string"))
        .collect();
    assert_eq!(strings, vec!["a", "ab", "abc", "abcd"]);
}

// ---------------------------------------------------------------------------
// FloatArray fields
// ---------------------------------------------------------------------------

/// Test 12 - map > bounds with four float values.
/// FloatArray in binary has NO count prefix; length is inferred from the data size.
#[test]
fn floatarray_map_bounds_basic() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "map": {
                "bounds": [0.0, 1.0, 100.0, 200.0]
            }
        }
    }"#;
    let val = roundtrip(json);
    let bounds = get_path(&val, "base_root.map.bounds").expect("bounds must be present");
    let arr = bounds.as_array().expect("bounds must be an array");
    assert_eq!(
        arr.len(),
        4,
        "FloatArray must have 4 elements after round-trip"
    );
    let expected = [0.0f64, 1.0, 100.0, 200.0];
    for (i, (got, &exp)) in arr.iter().zip(expected.iter()).enumerate() {
        let f = got.as_f64().expect("must be number");
        assert!(
            (f - exp).abs() < 1e-3,
            "bounds[{i}] expected {exp}, got {f}"
        );
        assert!(
            looks_like_float(got),
            "bounds[{i}] must be represented as float, got: {got}"
        );
    }
}

/// Test 13 - map > bounds with empty [].
/// An empty FloatArray must survive: binary encodes zero bytes (only alignment
/// padding), and the decoder infers length 0 from the data size.
#[test]
fn floatarray_map_bounds_empty() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "map": {
                "bounds": []
            }
        }
    }"#;
    let val = roundtrip(json);
    let bounds = get_path(&val, "base_root.map.bounds").expect("bounds must be present");
    let arr = bounds.as_array().expect("bounds must be an array");
    assert!(arr.is_empty(), "empty FloatArray must round-trip to []");
}

// ---------------------------------------------------------------------------
// TwoInt fields
// ---------------------------------------------------------------------------

/// Test 14 - killRange with [1, 5].
#[test]
fn twoint_kill_range_basic() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "killRange": [1, 5]
        }
    }"#;
    let val = roundtrip(json);
    let kr = get_path(&val, "base_root.killRange").expect("killRange must be present");
    let arr = kr.as_array().expect("killRange must be an array");
    assert_eq!(arr.len(), 2, "TwoInt must have exactly 2 elements");
    assert_eq!(arr[0].as_i64().unwrap(), 1);
    assert_eq!(arr[1].as_i64().unwrap(), 5);
}

/// Test 15 - killRange with negative values.
#[test]
fn twoint_kill_range_negative() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "killRange": [-1, -5]
        }
    }"#;
    let val = roundtrip(json);
    let kr = get_path(&val, "base_root.killRange").expect("killRange must be present");
    let arr = kr.as_array().expect("killRange must be an array");
    assert_eq!(arr.len(), 2);
    assert_eq!(arr[0].as_i64().unwrap(), -1);
    assert_eq!(arr[1].as_i64().unwrap(), -5);
}

// ---------------------------------------------------------------------------
// TwoBool fields
// ---------------------------------------------------------------------------

/// Test 16 - quest_select_warnings under profile_options > values with [true, false].
#[test]
fn twobool_quest_select_warnings_true_false() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "profile_options": {
                "values": {
                    "quest_select_warnings": [true, false]
                }
            }
        }
    }"#;
    let val = roundtrip(json);
    let qsw = get_path(
        &val,
        "base_root.profile_options.values.quest_select_warnings",
    )
    .expect("quest_select_warnings must be present");
    let arr = qsw.as_array().expect("TwoBool must be an array");
    assert_eq!(arr.len(), 2);
    assert!(arr[0].as_bool().unwrap());
    assert!(!arr[1].as_bool().unwrap());
}

/// Test 17 - corpses under profile_options > values with [false, false].
#[test]
fn twobool_corpses_both_false() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "profile_options": {
                "values": {
                    "corpses": [false, false]
                }
            }
        }
    }"#;
    let val = roundtrip(json);
    let corpses = get_path(&val, "base_root.profile_options.values.corpses")
        .expect("corpses must be present");
    let arr = corpses.as_array().expect("TwoBool must be an array");
    assert_eq!(arr.len(), 2);
    assert!(!arr[0].as_bool().unwrap());
    assert!(!arr[1].as_bool().unwrap());
}

/// Test 18 - corpses under profile_options > values with [true, true].
#[test]
fn twobool_corpses_both_true() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "profile_options": {
                "values": {
                    "corpses": [true, true]
                }
            }
        }
    }"#;
    let val = roundtrip(json);
    let corpses = get_path(&val, "base_root.profile_options.values.corpses")
        .expect("corpses must be present");
    let arr = corpses.as_array().expect("TwoBool must be an array");
    assert_eq!(arr.len(), 2);
    assert!(arr[0].as_bool().unwrap());
    assert!(arr[1].as_bool().unwrap());
}

// ---------------------------------------------------------------------------
// Char fields
// ---------------------------------------------------------------------------

/// Test 19 - requirement_code with "A" (letter char).
/// Char is stored as a single byte in binary with no alignment padding.
#[test]
fn char_requirement_code_letter() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "requirement_code": "A"
        }
    }"#;
    let val = roundtrip(json);
    let rc =
        get_path(&val, "base_root.requirement_code").expect("requirement_code must be present");
    let s = rc.as_str().expect("Char must round-trip as a JSON string");
    assert_eq!(s, "A", "requirement_code must round-trip to 'A'");
    assert_eq!(s.len(), 1, "Char must be exactly one character");
}

/// Test 20 - requirement_code with "0" (numeric char).
#[test]
fn char_requirement_code_digit() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "requirement_code": "0"
        }
    }"#;
    let val = roundtrip(json);
    let rc =
        get_path(&val, "base_root.requirement_code").expect("requirement_code must be present");
    let s = rc.as_str().expect("Char must round-trip as a JSON string");
    assert_eq!(s, "0", "requirement_code must round-trip to '0'");
    assert_eq!(s.len(), 1, "Char must be exactly one character");
}

// ---------------------------------------------------------------------------
// Non-hardcoded defaults (type inference)
// ---------------------------------------------------------------------------

/// Test 21 - Unknown field name with integer value defaults to Int (not Float).
/// Value 99 as Int round-trips to 99 (no decimal); as Float it would be 99.0.
#[test]
fn default_unknown_int_field() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "completely_unknown_field_xyzzy": 99
        }
    }"#;
    let val = roundtrip(json);
    let f = get_path(&val, "base_root.completely_unknown_field_xyzzy")
        .expect("unknown int field must survive round-trip");
    assert!(
        !looks_like_float(f),
        "unknown field with integer value must default to Int, not Float; got: {f}"
    );
    assert_eq!(f.as_i64().unwrap(), 99);
}

/// Test 22 - Unknown field name with string value defaults to String.
#[test]
fn default_unknown_string_field() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "completely_unknown_string_xyzzy": "hello_world"
        }
    }"#;
    let val = roundtrip(json);
    let f = get_path(&val, "base_root.completely_unknown_string_xyzzy")
        .expect("unknown string field must survive round-trip");
    assert_eq!(
        f.as_str().unwrap(),
        "hello_world",
        "unknown field with string value must default to String"
    );
}

/// Test 23 - Unknown field name with boolean value defaults to Bool.
#[test]
fn default_unknown_bool_field() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "completely_unknown_bool_xyzzy": true
        }
    }"#;
    let val = roundtrip(json);
    let f = get_path(&val, "base_root.completely_unknown_bool_xyzzy")
        .expect("unknown bool field must survive round-trip");
    assert!(
        f.as_bool().unwrap(),
        "unknown field with bool value must default to Bool"
    );
}

// ---------------------------------------------------------------------------
// Path matching edge cases
// ---------------------------------------------------------------------------

/// Test 24 - The hardcoded table entry `[Float, "chances", "*"]` registers a
/// field whose name is the literal string `"*"` under a parent object called
/// `"chances"`. The `"*"` in the table's last position is the actual field
/// name (the HashMap key), not a wildcard - wildcards only apply inside the
/// ancestor path portion (all elements before the last one).
///
/// A field literally named `"*"` inside `"chances"` must therefore be Float.
#[test]
fn float_literal_star_field_under_chances() {
    // Field name is literally "*" - that is what the hardcoded entry registers.
    let json = "{\"__revision_dont_touch\":1,\"base_root\":{\"chances\":{\"*\":0.75}}}";
    let val = roundtrip(json);
    // Navigate to base_root -> chances -> "*"
    let chances_obj = get_path(&val, "base_root.chances")
        .expect("chances must be present after round-trip")
        .as_object()
        .expect("chances must be an object");
    let star_field = chances_obj
        .get("*")
        .expect("field named '*' must be present under chances");
    assert!(
        looks_like_float(star_field),
        "field '*' under 'chances' must be Float; got: {star_field}"
    );
    let num = star_field.as_f64().expect("must be a number");
    assert!(
        (num - 0.75).abs() < 1e-5,
        "chances.'*' must round-trip to 0.75, got: {num}"
    );
}

/// Test 25 - Same field name `amount` at two different depths in one file:
/// one under the correct wildcard path (Float) and one under wrong ancestors (Int).
/// Both must get their correct types independently.
#[test]
fn float_amount_correct_and_wrong_path_in_same_file() {
    // "actor > buff_group > buff_fire > amount" -> Float (matches hardcoded path)
    // "inventory > slot_1 > amount" -> Int (no hardcoded match)
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "actor": {
                "buff_group": {
                    "buff_fire": {
                        "amount": 3.0
                    }
                }
            },
            "inventory": {
                "slot_1": {
                    "amount": 5
                }
            }
        }
    }"#;
    let val = roundtrip(json);

    // The hardcoded-path amount must be Float.
    let float_amount = get_path(&val, "base_root.actor.buff_group.buff_fire.amount")
        .expect("buff_fire.amount must be present");
    assert!(
        looks_like_float(float_amount),
        "amount under actor>buff_group>buff_fire must be Float; got: {float_amount}"
    );
    let float_num = float_amount.as_f64().expect("must be a number");
    assert!(
        (float_num - 3.0).abs() < 1e-5,
        "buff_fire.amount must round-trip to 3.0, got: {float_num}"
    );

    // The wrong-path amount must be Int (no decimal).
    let int_amount =
        get_path(&val, "base_root.inventory.slot_1.amount").expect("slot_1.amount must be present");
    assert!(
        !looks_like_float(int_amount),
        "amount under wrong ancestors must be Int; got: {int_amount}"
    );
    assert_eq!(
        int_amount.as_i64().unwrap(),
        5,
        "slot_1.amount must round-trip to 5"
    );
}
