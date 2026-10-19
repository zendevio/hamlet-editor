/// Parity tests between the old hand-rolled JSON parser and the new serde_json-based parser.
///
/// Every test verifies that `File::try_from_json_serde` (new) produces a `File` that
/// encodes to identical binary bytes as `File::try_from_json` (old).  Binary identity
/// is the strongest possible functional-equivalence guarantee.
///
/// A separate suite verifies that `File::from_json_value_direct` matches
/// `File::from_json_value` (the old bridge that serialises to a string first).
use ddsavelib::{File, Unhasher};

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

fn parse_old(json: &str) -> File {
    File::try_from_json(json.as_bytes()).expect("old parser should succeed")
}

fn parse_new(json: &str) -> File {
    File::try_from_json_serde(json.as_bytes()).expect("new parser should succeed")
}

fn to_bin(file: &File) -> Vec<u8> {
    let mut buf = Vec::new();
    file.write_to_bin(&mut buf)
        .expect("binary write should succeed");
    buf
}

/// Parse `json` with both parsers and assert the binary outputs are byte-identical.
fn assert_parity(json: &str) {
    let old = parse_old(json);
    let new = parse_new(json);
    let bin_old = to_bin(&old);
    let bin_new = to_bin(&new);
    assert_eq!(
        bin_old, bin_new,
        "binary output must be identical between old and new parser"
    );
}

/// Walk an already-parsed `File` through `to_json_value` and then compare
/// `from_json_value` (old bridge) vs `from_json_value_direct` (new direct).
fn assert_value_parity(json: &str) {
    let old = parse_old(json);
    let unhash = Unhasher::<&str>::empty();
    let value = old.to_json_value(&unhash);

    let from_old_bridge = File::from_json_value(&value).expect("old bridge should succeed");
    let from_new_direct = File::from_json_value_direct(&value).expect("new direct should succeed");

    let bin_old = to_bin(&from_old_bridge);
    let bin_new = to_bin(&from_new_direct);
    assert_eq!(
        bin_old, bin_new,
        "from_json_value_direct must match from_json_value"
    );
}

// ---------------------------------------------------------------------------
// 1. parity_minimal_file
// ---------------------------------------------------------------------------

#[test]
fn parity_minimal_file() {
    assert_parity(r#"{"__revision_dont_touch": 42, "base_root": {}}"#);
}

// ---------------------------------------------------------------------------
// 2. parity_int_field
// ---------------------------------------------------------------------------

#[test]
fn parity_int_field() {
    assert_parity(r#"{"__revision_dont_touch": 1, "base_root": {"x": 42}}"#);
}

// ---------------------------------------------------------------------------
// 3. parity_negative_int
// ---------------------------------------------------------------------------

#[test]
fn parity_negative_int() {
    assert_parity(r#"{"__revision_dont_touch": 1, "base_root": {"x": -1}}"#);
}

// ---------------------------------------------------------------------------
// 4. parity_i32_min
// ---------------------------------------------------------------------------

#[test]
fn parity_i32_min() {
    assert_parity(r#"{"__revision_dont_touch": 1, "base_root": {"x": -2147483648}}"#);
}

// ---------------------------------------------------------------------------
// 5. parity_i32_max
// ---------------------------------------------------------------------------

#[test]
fn parity_i32_max() {
    assert_parity(r#"{"__revision_dont_touch": 1, "base_root": {"x": 2147483647}}"#);
}

// ---------------------------------------------------------------------------
// 6. parity_bool_true
// ---------------------------------------------------------------------------

#[test]
fn parity_bool_true() {
    assert_parity(r#"{"__revision_dont_touch": 1, "base_root": {"x": true}}"#);
}

// ---------------------------------------------------------------------------
// 7. parity_bool_false
// ---------------------------------------------------------------------------

#[test]
fn parity_bool_false() {
    assert_parity(r#"{"__revision_dont_touch": 1, "base_root": {"x": false}}"#);
}

// ---------------------------------------------------------------------------
// 8. parity_string_simple
// ---------------------------------------------------------------------------

#[test]
fn parity_string_simple() {
    assert_parity(r#"{"__revision_dont_touch": 1, "base_root": {"x": "hello"}}"#);
}

// ---------------------------------------------------------------------------
// 9. parity_string_empty
// ---------------------------------------------------------------------------

#[test]
fn parity_string_empty() {
    assert_parity(r#"{"__revision_dont_touch": 1, "base_root": {"x": ""}}"#);
}

// ---------------------------------------------------------------------------
// 10. parity_string_with_escapes
// ---------------------------------------------------------------------------

#[test]
fn parity_control_strings_are_rejected() {
    let value = serde_json::json!({"__revision_dont_touch":1,"base_root":{"x":"hello\nworld"}});
    assert!(File::try_from_json(value.to_string().as_bytes()).is_err());
    assert!(File::from_json_value(&value).is_err());
}

// ---------------------------------------------------------------------------
// 11. parity_nested_objects
// ---------------------------------------------------------------------------

#[test]
fn parity_nested_objects() {
    assert_parity(
        r#"{
            "__revision_dont_touch": 1,
            "base_root": {
                "level1": {
                    "level2": {
                        "deep_value": 99
                    }
                }
            }
        }"#,
    );
}

// ---------------------------------------------------------------------------
// 12. parity_empty_nested_object
// ---------------------------------------------------------------------------

#[test]
fn parity_empty_nested_object() {
    assert_parity(r#"{"__revision_dont_touch": 1, "base_root": {"inner": {}}}"#);
}

// ---------------------------------------------------------------------------
// 13. parity_multiple_siblings
// ---------------------------------------------------------------------------

#[test]
fn parity_multiple_siblings() {
    assert_parity(
        r#"{
            "__revision_dont_touch": 1,
            "base_root": {
                "a": 1,
                "b": 2,
                "c": 3,
                "d": 4,
                "e": 5
            }
        }"#,
    );
}

// ---------------------------------------------------------------------------
// 14. parity_sibling_objects
// ---------------------------------------------------------------------------

#[test]
fn parity_sibling_objects() {
    assert_parity(
        r#"{
            "__revision_dont_touch": 1,
            "base_root": {
                "obj_a": {"val": 1},
                "obj_b": {"val": 2}
            }
        }"#,
    );
}

// ---------------------------------------------------------------------------
// 15. parity_float_current_hp
// ---------------------------------------------------------------------------

#[test]
fn parity_float_current_hp() {
    // current_hp is a hardcoded Float field.
    assert_parity(r#"{"__revision_dont_touch": 1, "base_root": {"current_hp": 42.5}}"#);
}

// ---------------------------------------------------------------------------
// 16. parity_float_integer_value
// ---------------------------------------------------------------------------

#[test]
fn parity_float_integer_value() {
    // current_hp with an integer-looking value must still be treated as Float.
    assert_parity(r#"{"__revision_dont_touch": 1, "base_root": {"current_hp": 100}}"#);
}

// ---------------------------------------------------------------------------
// 17. parity_float_zero
// ---------------------------------------------------------------------------

#[test]
fn parity_float_zero() {
    assert_parity(r#"{"__revision_dont_touch": 1, "base_root": {"current_hp": 0.0}}"#);
}

// ---------------------------------------------------------------------------
// 18. parity_int_vector
// ---------------------------------------------------------------------------

#[test]
fn parity_int_vector() {
    // read_page_indexes is a hardcoded IntVector field.
    assert_parity(r#"{"__revision_dont_touch": 1, "base_root": {"read_page_indexes": [1, 2, 3]}}"#);
}

// ---------------------------------------------------------------------------
// 19. parity_int_vector_empty
// ---------------------------------------------------------------------------

#[test]
fn parity_int_vector_empty() {
    assert_parity(r#"{"__revision_dont_touch": 1, "base_root": {"read_page_indexes": []}}"#);
}

// ---------------------------------------------------------------------------
// 20. parity_string_vector
// ---------------------------------------------------------------------------

#[test]
fn parity_string_vector() {
    // goal_ids is a hardcoded StringVector field.
    assert_parity(r#"{"__revision_dont_touch": 1, "base_root": {"goal_ids": ["a", "b"]}}"#);
}

// ---------------------------------------------------------------------------
// 21. parity_float_array
// ---------------------------------------------------------------------------

#[test]
fn parity_float_array() {
    // map > bounds is a hardcoded FloatArray field.
    assert_parity(
        r#"{
            "__revision_dont_touch": 1,
            "base_root": {
                "map": {"bounds": [1.0, 2.0, 3.0, 4.0]}
            }
        }"#,
    );
}

// ---------------------------------------------------------------------------
// 22. parity_two_int
// ---------------------------------------------------------------------------

#[test]
fn parity_two_int() {
    // killRange is a hardcoded TwoInt field.
    assert_parity(r#"{"__revision_dont_touch": 1, "base_root": {"killRange": [1, 5]}}"#);
}

// ---------------------------------------------------------------------------
// 23. parity_two_bool
// ---------------------------------------------------------------------------

#[test]
fn parity_two_bool() {
    // quest_select_warnings under profile_options > values is a hardcoded TwoBool field.
    assert_parity(
        r#"{
            "__revision_dont_touch": 1,
            "base_root": {
                "profile_options": {
                    "values": {
                        "quest_select_warnings": [true, false]
                    }
                }
            }
        }"#,
    );
}

// ---------------------------------------------------------------------------
// 24. parity_char
// ---------------------------------------------------------------------------

#[test]
fn parity_char() {
    // requirement_code is a hardcoded Char field.
    assert_parity(r#"{"__revision_dont_touch": 1, "base_root": {"requirement_code": "A"}}"#);
}

// ---------------------------------------------------------------------------
// 25. parity_float_wildcard_path
// ---------------------------------------------------------------------------

#[test]
fn parity_float_wildcard_path() {
    // amount under actor > buff_group > * matches the wildcard Float path.
    assert_parity(
        r#"{
            "__revision_dont_touch": 1,
            "base_root": {
                "actor": {
                    "buff_group": {
                        "g1": {"amount": 1.5}
                    }
                }
            }
        }"#,
    );
}

// ---------------------------------------------------------------------------
// 26. parity_hash_prefix
// ---------------------------------------------------------------------------

#[test]
fn parity_hash_prefix() {
    // "###jester" is hashed by the parser and stored as Int(name_hash("jester")).
    assert_parity(
        r####"{"__revision_dont_touch": 1, "base_root": {"soldier_class": "###jester"}}"####,
    );
}

// ---------------------------------------------------------------------------
// 27. parity_hash_in_int_vector
// ---------------------------------------------------------------------------

#[test]
fn parity_hash_in_int_vector() {
    // "###jester" as an element of an IntVector must be hashed by both parsers.
    assert_parity(
        r####"{"__revision_dont_touch": 1, "base_root": {"read_page_indexes": [1, "###jester", 3]}}"####,
    );
}

// ---------------------------------------------------------------------------
// 28. parity_hash_empty_suffix
// ---------------------------------------------------------------------------

#[test]
fn parity_hash_empty_suffix() {
    // "###" with no suffix must be stored as Int(0) (name_hash("") == 0).
    assert_parity(r####"{"__revision_dont_touch": 1, "base_root": {"x": "###"}}"####);
}

// ---------------------------------------------------------------------------
// 29. parity_raw_data
// ---------------------------------------------------------------------------

#[test]
fn parity_raw_data() {
    // raw_data triggers recursive embedded-DSON parsing.
    assert_parity(
        r#"{
            "__revision_dont_touch": 1,
            "base_root": {
                "hero": {
                    "raw_data": {
                        "__revision_dont_touch": 100,
                        "base_root": {"hp": 5}
                    }
                }
            }
        }"#,
    );
}

// ---------------------------------------------------------------------------
// 30. parity_static_save
// ---------------------------------------------------------------------------

#[test]
fn parity_static_save() {
    // static_save triggers the same recursive parsing as raw_data.
    assert_parity(
        r#"{
            "__revision_dont_touch": 1,
            "base_root": {
                "hero": {
                    "static_save": {
                        "__revision_dont_touch": 55,
                        "base_root": {"level": 3}
                    }
                }
            }
        }"#,
    );
}

// ---------------------------------------------------------------------------
// 31. parity_nested_raw_data
// ---------------------------------------------------------------------------

#[test]
fn parity_nested_raw_data() {
    // raw_data within raw_data (DSON within DSON within DSON).
    assert_parity(
        r#"{
            "__revision_dont_touch": 1,
            "base_root": {
                "outer": {
                    "raw_data": {
                        "__revision_dont_touch": 2,
                        "base_root": {
                            "inner": {
                                "raw_data": {
                                    "__revision_dont_touch": 3,
                                    "base_root": {"deepest": 999}
                                }
                            }
                        }
                    }
                }
            }
        }"#,
    );
}

// ---------------------------------------------------------------------------
// 32. parity_revision_before_root
// ---------------------------------------------------------------------------

#[test]
fn parity_revision_before_root() {
    // Standard order: __revision_dont_touch appears before the root field.
    assert_parity(r#"{"__revision_dont_touch": 42, "base_root": {"x": 1}}"#);
}

// ---------------------------------------------------------------------------
// 33. parity_revision_after_root
// ---------------------------------------------------------------------------

#[test]
fn parity_revision_after_root() {
    // Non-standard order: __revision_dont_touch appears after the root field.
    assert_parity(r#"{"base_root": {"x": 1}, "__revision_dont_touch": 42}"#);
}

// ---------------------------------------------------------------------------
// 34. parity_revision_zero
// ---------------------------------------------------------------------------

#[test]
fn parity_revision_zero() {
    assert_parity(r#"{"__revision_dont_touch": 0, "base_root": {}}"#);
}

// ---------------------------------------------------------------------------
// 35. parity_revision_u32_max
// ---------------------------------------------------------------------------

#[test]
fn parity_revision_u32_max() {
    // u32::MAX = 4294967295
    assert_parity(r#"{"__revision_dont_touch": 4294967295, "base_root": {}}"#);
}

// ---------------------------------------------------------------------------
// 36. serde_duplicate_keys_preserved
//
// The new serde_json-based parser must preserve duplicate keys (unlike a
// standard serde_json::Map which drops them). We verify this by writing back
// to JSON with allow_dupes=true and counting occurrences of "x".
// ---------------------------------------------------------------------------

#[test]
fn serde_duplicate_keys_preserved() {
    let json = r#"{"__revision_dont_touch": 1, "base_root": {"x": 1, "x": 2}}"#;
    let file = File::try_from_json_serde(json.as_bytes())
        .expect("new parser should accept duplicate keys");

    let unhash = Unhasher::<&str>::empty();
    let mut buf = Vec::new();
    file.write_to_json(&mut buf, true, &unhash)
        .expect("write_to_json should succeed");
    let output = std::str::from_utf8(&buf).expect("output should be valid UTF-8");

    // Count non-overlapping occurrences of the key "x" in the JSON output.
    let mut count = 0usize;
    let mut start = 0;
    let needle = "\"x\"";
    while let Some(pos) = output[start..].find(needle) {
        count += 1;
        start += pos + needle.len();
    }
    assert_eq!(
        count, 2,
        "serde parser must preserve both duplicate 'x' entries; output was:\n{output}"
    );
}

// ---------------------------------------------------------------------------
// 37. value_parity_simple
// ---------------------------------------------------------------------------

#[test]
fn value_parity_simple() {
    assert_value_parity(
        r#"{"__revision_dont_touch": 1, "base_root": {"score": 100, "alive": true}}"#,
    );
}

// ---------------------------------------------------------------------------
// 38. value_parity_nested
// ---------------------------------------------------------------------------

#[test]
fn value_parity_nested() {
    assert_value_parity(
        r#"{
            "__revision_dont_touch": 7,
            "base_root": {
                "level1": {
                    "level2": {"leaf": 42}
                }
            }
        }"#,
    );
}

// ---------------------------------------------------------------------------
// 39. value_parity_all_types
// ---------------------------------------------------------------------------

#[test]
fn value_parity_all_types() {
    // File with Int, String, Bool, and nested objects.
    assert_value_parity(
        r#"{
            "__revision_dont_touch": 5,
            "base_root": {
                "count": 7,
                "name": "hero",
                "active": true,
                "nested": {
                    "depth": 1,
                    "flag": false
                }
            }
        }"#,
    );
}

// ---------------------------------------------------------------------------
// 40. value_parity_embedded
// ---------------------------------------------------------------------------

#[test]
fn value_parity_embedded() {
    // File with a raw_data embedded sub-file.
    assert_value_parity(
        r#"{
            "__revision_dont_touch": 1,
            "base_root": {
                "actor": {
                    "raw_data": {
                        "__revision_dont_touch": 33,
                        "base_root": {"hp": 99, "dead": false}
                    }
                }
            }
        }"#,
    );
}

// ---------------------------------------------------------------------------
// 41. parity_field_order
//
// Fields are declared in z, a, m order. Binary parity guarantees that insertion
// order is preserved identically by both parsers.
// ---------------------------------------------------------------------------

#[test]
fn parity_field_order() {
    assert_parity(
        r#"{
            "__revision_dont_touch": 1,
            "base_root": {
                "z_field": 26,
                "a_field": 1,
                "m_field": 13
            }
        }"#,
    );
}

// ---------------------------------------------------------------------------
// 42. parity_complex_file
//
// A file with multiple types: Int, String, Bool, nested objects, Float
// (current_hp), and IntVector (read_page_indexes), all in one JSON.
// ---------------------------------------------------------------------------

#[test]
fn parity_complex_file() {
    assert_parity(
        r#"{
            "__revision_dont_touch": 99,
            "base_root": {
                "resolve_level": 3,
                "hero_name": "Dismas",
                "in_raid": false,
                "current_hp": 27.5,
                "read_page_indexes": [1, 2, 3],
                "stats": {
                    "speed": 6,
                    "dodge": 10,
                    "alive": true
                }
            }
        }"#,
    );
}
