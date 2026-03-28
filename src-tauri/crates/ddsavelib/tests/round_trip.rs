//! Round-trip integrity tests for `ddsavelib`.
//!
//! Coverage:
//!   - JSON → Binary → JSON identity (Value equality)
//!   - Binary → JSON → Binary byte equality (starting from JSON)
//!   - Float precision round-trip (ryu f32-as-f64 formatting)
//!   - `to_json_value` / `from_json_value` bridge
//!   - Unhasher integration
//!   - Field ordering preservation
//!   - Mixed field types
//!   - Revision edge cases (0, u32::MAX, arbitrary)
//!   - Edge cases: empty objects, deep nesting, escape sequences

use ddsavelib::{name_hash, File, Unhasher};

// ─── helpers ────────────────────────────────────────────────────────────────

/// Parse JSON, encode to binary, decode from binary, re-encode to JSON.
/// Returns `(value_from_file1, value_from_file2)` for comparison.
fn json_bin_json(json: &str) -> (serde_json::Value, serde_json::Value) {
    let unhash = Unhasher::<&str>::empty();

    let file1 = File::try_from_json(json.as_bytes()).expect("parse JSON");

    let mut bin = Vec::new();
    file1.write_to_bin(&mut bin).expect("encode binary");
    assert!(!bin.is_empty(), "binary must not be empty");

    let file2 = File::try_from_bin(&mut bin.as_slice()).expect("decode binary");

    let mut j1 = Vec::new();
    let mut j2 = Vec::new();
    file1.write_to_json(&mut j1, true, &unhash).unwrap();
    file2.write_to_json(&mut j2, true, &unhash).unwrap();

    let v1: serde_json::Value = serde_json::from_slice(&j1).unwrap();
    let v2: serde_json::Value = serde_json::from_slice(&j2).unwrap();
    (v1, v2)
}

/// Parse JSON → binary1 → JSON → binary2. Returns (binary1, binary2).
fn json_bin_json_bin(json: &str) -> (Vec<u8>, Vec<u8>) {
    let unhash = Unhasher::<&str>::empty();

    let file1 = File::try_from_json(json.as_bytes()).expect("parse JSON");
    let mut bin1 = Vec::new();
    file1.write_to_bin(&mut bin1).expect("encode binary 1");

    let file2 = File::try_from_bin(&mut bin1.as_slice()).expect("decode binary");
    let mut j2 = Vec::new();
    file2.write_to_json(&mut j2, true, &unhash).unwrap();

    let file3 = File::try_from_json(j2.as_slice()).expect("re-parse JSON");
    let mut bin2 = Vec::new();
    file3.write_to_bin(&mut bin2).expect("encode binary 2");

    (bin1, bin2)
}

// ─── JSON → Binary → JSON identity ──────────────────────────────────────────

/// Test 1: simple file with Int, String, Bool fields.
#[test]
fn jbj_simple_fields() {
    let json = r#"{
        "__revision_dont_touch": 42,
        "base_root": {
            "resolve_level": 3,
            "hero_name": "Dismas",
            "in_raid": false
        }
    }"#;
    let (v1, v2) = json_bin_json(json);
    assert_eq!(v1, v2, "JSON → binary → JSON must produce identical Values");
    // Spot-check individual fields survive
    let root = v2["base_root"].as_object().unwrap();
    assert_eq!(root["resolve_level"], serde_json::json!(3));
    assert_eq!(root["hero_name"], serde_json::json!("Dismas"));
    assert_eq!(root["in_raid"], serde_json::json!(false));
    assert_eq!(v2["__revision_dont_touch"], serde_json::json!(42));
}

/// Test 2: nested objects (3 levels deep).
#[test]
fn jbj_nested_three_levels() {
    let json = r#"{
        "__revision_dont_touch": 7,
        "base_root": {
            "level1": {
                "level2": {
                    "leaf_value": 99
                }
            }
        }
    }"#;
    let (v1, v2) = json_bin_json(json);
    assert_eq!(v1, v2);
    // Verify hierarchy survived
    assert_eq!(v2["base_root"]["level1"]["level2"]["leaf_value"], 99);
}

/// Test 3: file with 20+ fields — all must survive.
#[test]
fn jbj_many_fields() {
    let json = r#"{
        "__revision_dont_touch": 100,
        "base_root": {
            "f01": 1, "f02": 2,  "f03": 3,  "f04": 4,  "f05": 5,
            "f06": 6, "f07": 7,  "f08": 8,  "f09": 9,  "f10": 10,
            "f11": 11,"f12": 12, "f13": 13, "f14": 14, "f15": 15,
            "f16": 16,"f17": 17, "f18": 18, "f19": 19, "f20": 20,
            "f21": 21,"f22": 22
        }
    }"#;
    let (v1, v2) = json_bin_json(json);
    assert_eq!(v1, v2);
    let root = v2["base_root"].as_object().unwrap();
    assert_eq!(root.len(), 22, "all 22 fields must survive");
    for i in 1..=22u64 {
        let key = format!("f{i:02}");
        assert_eq!(root[&key], serde_json::json!(i), "field {key} must survive");
    }
}

/// Test 4: empty objects survive.
#[test]
fn jbj_empty_object() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {}
    }"#;
    let (v1, v2) = json_bin_json(json);
    assert_eq!(v1, v2);
    assert!(
        v2["base_root"].as_object().unwrap().is_empty(),
        "empty object must remain empty"
    );
}

// ─── Binary → JSON → Binary byte equality ───────────────────────────────────

/// Test 5: JSON → bin1 → JSON → bin2; bin1 == bin2.
#[test]
fn bjb_byte_equality_simple() {
    let json = r#"{
        "__revision_dont_touch": 55,
        "base_root": {
            "score": 1234,
            "alive": true
        }
    }"#;
    let (bin1, bin2) = json_bin_json_bin(json);
    assert_eq!(
        bin1, bin2,
        "binary output must be identical after JSON → bin → JSON → bin"
    );
}

/// Test 6: byte equality with multiple field types.
#[test]
fn bjb_byte_equality_mixed_types() {
    let json = r#"{
        "__revision_dont_touch": 77,
        "base_root": {
            "count": 42,
            "label": "hero",
            "active": true,
            "nested": {
                "depth": 1,
                "flag": false
            }
        }
    }"#;
    let (bin1, bin2) = json_bin_json_bin(json);
    assert_eq!(bin1, bin2, "byte equality with mixed types");
}

// ─── Float precision round-trip ─────────────────────────────────────────────
//
// `current_hp` is a hardcoded Float field.  The writer formats `f32` via
// `ryu::Buffer::format(*f as f64)`, so e.g. `1.0f32 as f64` → "1.0".
// The reader parses that string back as `f32`.  All round-trips below start
// from JSON so we never deal with game-file garbage bits.

fn float_roundtrip_bin_equal(float_str: &str) {
    let json = format!(
        r#"{{
            "__revision_dont_touch": 1,
            "base_root": {{
                "current_hp": {}
            }}
        }}"#,
        float_str
    );
    let (bin1, bin2) = json_bin_json_bin(&json);
    assert_eq!(
        bin1, bin2,
        "float {float_str}: binary must be identical after full round-trip"
    );
}

fn float_json_contains_number(float_str: &str) {
    let json = format!(
        r#"{{
            "__revision_dont_touch": 1,
            "base_root": {{
                "current_hp": {}
            }}
        }}"#,
        float_str
    );
    let unhash = Unhasher::<&str>::empty();
    let file = File::try_from_json(json.as_bytes()).expect("parse float JSON");
    let mut bin = Vec::new();
    file.write_to_bin(&mut bin).unwrap();
    let file2 = File::try_from_bin(&mut bin.as_slice()).unwrap();
    let mut out = Vec::new();
    file2.write_to_json(&mut out, true, &unhash).unwrap();
    let val: serde_json::Value = serde_json::from_slice(&out).unwrap();
    let hp = &val["base_root"]["current_hp"];
    assert!(
        hp.is_number(),
        "current_hp must be a JSON number after round-trip, got {:?}",
        hp
    );
}

/// Test 7: `current_hp: 1.0`
#[test]
fn float_one() {
    float_json_contains_number("1.0");
    float_roundtrip_bin_equal("1.0");
}

/// Test 8: `current_hp: 0.5` (exactly representable as f32)
#[test]
fn float_half() {
    float_json_contains_number("0.5");
    float_roundtrip_bin_equal("0.5");
}

/// Test 9: `current_hp: 0.0`
#[test]
fn float_zero() {
    float_json_contains_number("0.0");
    float_roundtrip_bin_equal("0.0");
}

/// Test 10: `current_hp: -1.5` (negative)
#[test]
fn float_negative() {
    float_json_contains_number("-1.5");
    float_roundtrip_bin_equal("-1.5");
}

/// Test 11: `current_hp: 100.0` (common game value)
#[test]
fn float_hundred() {
    float_json_contains_number("100.0");
    float_roundtrip_bin_equal("100.0");
}

/// Test 12: `current_hp: 33.0` (common HP value)
#[test]
fn float_thirty_three() {
    float_json_contains_number("33.0");
    float_roundtrip_bin_equal("33.0");
}

// ─── to_json_value / from_json_value bridge ──────────────────────────────────

fn simple_file() -> File {
    let json = r#"{
        "__revision_dont_touch": 42,
        "base_root": {
            "soldier_class": -2101527251,
            "resolve_level": 3,
            "in_raid": true
        }
    }"#;
    File::try_from_json(json.as_bytes()).expect("simple_file")
}

/// Test 13: File → to_json_value → from_json_value → to_json_value; Values equal.
#[test]
fn bridge_value_round_trip() {
    let file1 = simple_file();
    let unhash = Unhasher::<&str>::empty();

    let val1 = file1.to_json_value(&unhash);
    let file2 = File::from_json_value(&val1).expect("from_json_value");
    let val2 = file2.to_json_value(&unhash);

    assert_eq!(
        val1, val2,
        "to_json_value → from_json_value → to_json_value must be identity"
    );
}

/// Test 14: File → to_json_value → from_json_value → to_json_value matches; data survives.
///
/// Note: `serde_json` Map serialisation (used inside `from_json_value`) sorts keys
/// alphabetically, so the binary produced by the bridge path will have a different
/// field order from the original and therefore differs byte-for-byte.  What must
/// hold is that both decode to semantically identical JSON Values.
#[test]
fn bridge_value_to_bin_equality() {
    let file1 = simple_file();
    let unhash = Unhasher::<&str>::empty();

    // Forward: File → to_json_value
    let val1 = file1.to_json_value(&unhash);

    // Bridge: val1 → File → to_json_value
    let file2 = File::from_json_value(&val1).expect("from_json_value");
    let val2 = file2.to_json_value(&unhash);

    // The two Values must be equal (content, not byte-order in binary)
    assert_eq!(
        val1, val2,
        "to_json_value must produce identical Values before and after from_json_value bridge"
    );

    // Both paths must produce valid binary that decodes without error
    let mut bin1 = Vec::new();
    file1.write_to_bin(&mut bin1).unwrap();
    let mut bin2 = Vec::new();
    file2.write_to_bin(&mut bin2).unwrap();
    File::try_from_bin(&mut bin1.as_slice()).expect("bin1 must decode");
    File::try_from_bin(&mut bin2.as_slice()).expect("bin2 must decode");
}

/// Test 15: to_json_value includes `__revision_dont_touch` with correct value.
#[test]
fn bridge_revision_in_value() {
    let json = r#"{ "__revision_dont_touch": 9999, "base_root": { "x": 1 } }"#;
    let file = File::try_from_json(json.as_bytes()).unwrap();
    let unhash = Unhasher::<&str>::empty();
    let val = file.to_json_value(&unhash);
    assert_eq!(
        val["__revision_dont_touch"].as_u64(),
        Some(9999),
        "__revision_dont_touch must be 9999"
    );
}

/// Test 16: from_json_value preserves all field values.
#[test]
fn bridge_from_json_value_preserves_fields() {
    let json = r#"{
        "__revision_dont_touch": 5,
        "base_root": {
            "alpha": 10,
            "beta": "hello",
            "gamma": false
        }
    }"#;
    let file1 = File::try_from_json(json.as_bytes()).unwrap();
    let unhash = Unhasher::<&str>::empty();
    let val = file1.to_json_value(&unhash);
    let file2 = File::from_json_value(&val).unwrap();
    let val2 = file2.to_json_value(&unhash);

    let root = val2["base_root"].as_object().unwrap();
    assert_eq!(root["alpha"], serde_json::json!(10));
    assert_eq!(root["beta"], serde_json::json!("hello"));
    assert_eq!(root["gamma"], serde_json::json!(false));
}

// ─── Unhasher round-trip ─────────────────────────────────────────────────────

/// Test 17: Int whose value == name_hash("jester") → write with Unhasher →
/// JSON contains "###jester" → read back → binary identical.
#[test]
fn unhasher_jester_round_trip() {
    let jester_hash = name_hash("jester"); // -2101527251
    let json = format!(
        r#"{{
            "__revision_dont_touch": 12345,
            "base_root": {{
                "soldier_class": {}
            }}
        }}"#,
        jester_hash
    );

    let file1 = File::try_from_json(json.as_bytes()).expect("parse jester JSON");
    let mut bin1 = Vec::new();
    file1.write_to_bin(&mut bin1).unwrap();

    // Write JSON with Unhasher that knows "jester"
    let mut unhash = Unhasher::empty();
    unhash.offer_name("jester");
    let mut j_with_unhash = Vec::new();
    let file_from_bin = File::try_from_bin(&mut bin1.as_slice()).unwrap();
    file_from_bin
        .write_to_json(&mut j_with_unhash, true, &unhash)
        .unwrap();
    let unhashed_str = std::str::from_utf8(&j_with_unhash).unwrap();
    assert!(
        unhashed_str.contains("###jester"),
        "output with Unhasher must contain '###jester', got: {unhashed_str}"
    );

    // Read that JSON back and re-encode to binary
    let file3 = File::try_from_json(j_with_unhash.as_slice()).expect("re-parse ###jester JSON");
    let mut bin2 = Vec::new();
    file3.write_to_bin(&mut bin2).unwrap();

    assert_eq!(
        bin1, bin2,
        "binary after ###jester round-trip must be identical"
    );
}

/// Test 18: Same but with Unhasher::empty() — raw integer, round-trip still works.
#[test]
fn unhasher_empty_raw_int_round_trip() {
    let jester_hash = name_hash("jester");
    let json = format!(
        r#"{{
            "__revision_dont_touch": 12345,
            "base_root": {{
                "soldier_class": {}
            }}
        }}"#,
        jester_hash
    );

    let file1 = File::try_from_json(json.as_bytes()).unwrap();
    let mut bin1 = Vec::new();
    file1.write_to_bin(&mut bin1).unwrap();

    let empty_unhash = Unhasher::<&str>::empty();
    let file2 = File::try_from_bin(&mut bin1.as_slice()).unwrap();
    let mut j2 = Vec::new();
    file2.write_to_json(&mut j2, true, &empty_unhash).unwrap();
    let j2_str = std::str::from_utf8(&j2).unwrap();

    // Must contain the raw integer, not "###jester"
    assert!(
        !j2_str.contains("###jester"),
        "empty Unhasher must not unhash jester"
    );
    assert!(
        j2_str.contains(&jester_hash.to_string()),
        "raw integer must be present in JSON"
    );

    // Re-encode and compare
    let file3 = File::try_from_json(j2.as_slice()).unwrap();
    let mut bin2 = Vec::new();
    file3.write_to_bin(&mut bin2).unwrap();
    assert_eq!(bin1, bin2, "raw-int round-trip binary must be identical");
}

// ─── Field ordering ──────────────────────────────────────────────────────────

/// Test 19: Non-alphabetical field order is preserved through binary round-trip.
#[test]
fn field_order_preserved() {
    // Deliberately non-alphabetical: z, a, m
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "z_field": 3,
            "a_field": 1,
            "m_field": 2
        }
    }"#;
    let unhash = Unhasher::<&str>::empty();
    let file1 = File::try_from_json(json.as_bytes()).unwrap();
    let mut bin = Vec::new();
    file1.write_to_bin(&mut bin).unwrap();
    let file2 = File::try_from_bin(&mut bin.as_slice()).unwrap();
    let mut out = Vec::new();
    file2.write_to_json(&mut out, true, &unhash).unwrap();

    let out_str = std::str::from_utf8(&out).unwrap();
    let z_pos = out_str.find("z_field").unwrap();
    let a_pos = out_str.find("a_field").unwrap();
    let m_pos = out_str.find("m_field").unwrap();
    assert!(
        z_pos < a_pos && a_pos < m_pos,
        "original field order (z, a, m) must be preserved, got positions z={z_pos} a={a_pos} m={m_pos}"
    );
}

// ─── Mixed types ─────────────────────────────────────────────────────────────

/// Test 20: Int, String, Bool, nested Object — full JSON → binary → JSON.
#[test]
fn mixed_types_full_round_trip() {
    let json = r#"{
        "__revision_dont_touch": 200,
        "base_root": {
            "int_val": -42,
            "str_val": "hero",
            "bool_val": true,
            "nested_obj": {
                "inner_int": 7,
                "inner_bool": false
            }
        }
    }"#;
    let (v1, v2) = json_bin_json(json);
    assert_eq!(v1, v2);

    let root = v2["base_root"].as_object().unwrap();
    assert_eq!(root["int_val"], serde_json::json!(-42));
    assert_eq!(root["str_val"], serde_json::json!("hero"));
    assert_eq!(root["bool_val"], serde_json::json!(true));
    assert_eq!(root["nested_obj"]["inner_int"], serde_json::json!(7));
    assert_eq!(root["nested_obj"]["inner_bool"], serde_json::json!(false));
}

// ─── Revision round-trip ─────────────────────────────────────────────────────

fn revision_survives(rev: u32) {
    let json = format!(
        r#"{{ "__revision_dont_touch": {}, "base_root": {{ "x": 1 }} }}"#,
        rev
    );
    let unhash = Unhasher::<&str>::empty();
    let file1 = File::try_from_json(json.as_bytes()).expect("parse revision JSON");
    let mut bin = Vec::new();
    file1.write_to_bin(&mut bin).unwrap();
    let file2 = File::try_from_bin(&mut bin.as_slice()).unwrap();
    let val = file2.to_json_value(&unhash);
    assert_eq!(
        val["__revision_dont_touch"].as_u64(),
        Some(rev as u64),
        "revision {rev} must survive binary round-trip"
    );
}

/// Test 21: revision 0 survives.
#[test]
fn revision_zero() {
    revision_survives(0);
}

/// Test 22: revision u32::MAX survives.
#[test]
fn revision_u32_max() {
    revision_survives(u32::MAX);
}

/// Test 23: revision 12345 survives.
#[test]
fn revision_arbitrary() {
    revision_survives(12345);
}

// ─── Edge cases ───────────────────────────────────────────────────────────────

/// Test 24: empty root object `{}` round-trip.
#[test]
fn edge_empty_root_object() {
    let json = r#"{ "__revision_dont_touch": 1, "base_root": {} }"#;
    let (v1, v2) = json_bin_json(json);
    assert_eq!(v1, v2);
    assert!(v2["base_root"].as_object().unwrap().is_empty());
}

/// Test 25: deeply nested (5 levels) with leaf values.
#[test]
fn edge_deep_nesting() {
    let json = r#"{
        "__revision_dont_touch": 3,
        "base_root": {
            "l1": {
                "l2": {
                    "l3": {
                        "l4": {
                            "l5_leaf": 42
                        }
                    }
                }
            }
        }
    }"#;
    let (v1, v2) = json_bin_json(json);
    assert_eq!(v1, v2);
    assert_eq!(v2["base_root"]["l1"]["l2"]["l3"]["l4"]["l5_leaf"], 42);
}

/// Test 26: String with escape sequences survives binary round-trip unchanged.
#[test]
fn edge_string_escapes() {
    // Tab, newline, and backslash are all escape-worthy characters.
    // We encode them in JSON notation here; the parser will un-escape them,
    // the binary stores the raw bytes, and the JSON writer re-escapes them.
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "path": "C:\\Users\\hero",
            "note": "line1\nline2",
            "tab_sep": "a\tb"
        }
    }"#;
    let unhash = Unhasher::<&str>::empty();
    let file1 = File::try_from_json(json.as_bytes()).unwrap();
    let mut bin = Vec::new();
    file1.write_to_bin(&mut bin).unwrap();
    let file2 = File::try_from_bin(&mut bin.as_slice()).unwrap();
    let val = file2.to_json_value(&unhash);

    // serde_json will have un-escaped the strings when building the Value
    let root = val["base_root"].as_object().unwrap();
    assert_eq!(
        root["path"].as_str().unwrap(),
        r"C:\Users\hero",
        "backslash string must survive"
    );
    assert_eq!(
        root["note"].as_str().unwrap(),
        "line1\nline2",
        "newline string must survive"
    );
    assert_eq!(
        root["tab_sep"].as_str().unwrap(),
        "a\tb",
        "tab string must survive"
    );

    // Byte-level binary identity: encode file2 (decoded from bin) → binary.
    // This stays within the direct binary path (no serde_json Map reordering).
    let mut bin2 = Vec::new();
    file2.write_to_bin(&mut bin2).unwrap();
    assert_eq!(bin, bin2, "binary must be identical after escape round-trip");
}
