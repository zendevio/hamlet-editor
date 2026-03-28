/// Integration tests for ddsavelib binary (DSON) format handling.
///
/// All tests use JSON as the construction path, then exercise the binary
/// encode/decode path and verify invariants on the round-tripped output.
use ddsavelib::{File, Unhasher};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Encode `file` to binary bytes.
fn to_bin(file: &File) -> Vec<u8> {
    let mut bin = Vec::new();
    file.write_to_bin(&mut bin).expect("write_to_bin should not fail on a Vec");
    bin
}

/// Decode binary bytes to a File.
fn from_bin(bin: &[u8]) -> File {
    File::try_from_bin(&mut &*bin).expect("try_from_bin should succeed on valid data")
}

/// Parse JSON to a File.
fn from_json(json: &str) -> File {
    File::try_from_json(json.as_bytes()).expect("try_from_json should succeed on valid JSON")
}

/// Convert a File to a serde_json::Value using an empty unhasher.
fn to_value(file: &File) -> serde_json::Value {
    let unhash = Unhasher::<&str>::empty();
    file.to_json_value(&unhash)
}

/// Full binary round-trip: JSON -> File -> binary -> File -> serde_json::Value.
fn bin_roundtrip(json: &str) -> serde_json::Value {
    let file = from_json(json);
    let bin = to_bin(&file);
    let file2 = from_bin(&bin);
    to_value(&file2)
}

// ---------------------------------------------------------------------------
// 1. Minimal valid file
// ---------------------------------------------------------------------------

#[test]
fn minimal_valid_file_roundtrip() {
    let json = r#"{ "__revision_dont_touch": 42, "base_root": {} }"#;
    let val = bin_roundtrip(json);

    assert!(val.is_object(), "output must be a JSON object");
    assert_eq!(
        val.get("__revision_dont_touch").and_then(|v| v.as_u64()),
        Some(42),
        "revision must survive binary round-trip"
    );
    let base_root = val.get("base_root").expect("base_root must exist");
    assert!(base_root.is_object(), "base_root must be an object");
    assert_eq!(
        base_root.as_object().unwrap().len(),
        0,
        "base_root must be empty"
    );
}

// ---------------------------------------------------------------------------
// 2. Revision value preservation
// ---------------------------------------------------------------------------

#[test]
fn revision_zero_survives_binary_roundtrip() {
    let json = r#"{ "__revision_dont_touch": 0, "base_root": {} }"#;
    let val = bin_roundtrip(json);
    assert_eq!(
        val.get("__revision_dont_touch").and_then(|v| v.as_u64()),
        Some(0),
        "revision 0 must survive"
    );
}

#[test]
fn revision_one_survives_binary_roundtrip() {
    let json = r#"{ "__revision_dont_touch": 1, "base_root": {} }"#;
    let val = bin_roundtrip(json);
    assert_eq!(
        val.get("__revision_dont_touch").and_then(|v| v.as_u64()),
        Some(1),
        "revision 1 must survive"
    );
}

#[test]
fn revision_12345_survives_binary_roundtrip() {
    let json = r#"{ "__revision_dont_touch": 12345, "base_root": {} }"#;
    let val = bin_roundtrip(json);
    assert_eq!(
        val.get("__revision_dont_touch").and_then(|v| v.as_u64()),
        Some(12345),
        "revision 12345 must survive"
    );
}

#[test]
fn revision_u32_max_survives_binary_roundtrip() {
    // u32::MAX = 4294967295
    let json = r#"{ "__revision_dont_touch": 4294967295, "base_root": {} }"#;
    let val = bin_roundtrip(json);
    assert_eq!(
        val.get("__revision_dont_touch").and_then(|v| v.as_u64()),
        Some(4_294_967_295),
        "revision u32::MAX must survive"
    );
}

// ---------------------------------------------------------------------------
// 3. Single Int field
// ---------------------------------------------------------------------------

#[test]
fn single_int_field_binary_roundtrip() {
    let json = r#"{
        "__revision_dont_touch": 42,
        "base_root": { "resolve_level": 3 }
    }"#;
    let val = bin_roundtrip(json);
    let root = val.get("base_root").unwrap().as_object().unwrap();
    assert_eq!(
        root.get("resolve_level").and_then(|v| v.as_i64()),
        Some(3),
        "resolve_level must survive binary round-trip as 3"
    );
}

// ---------------------------------------------------------------------------
// 4. Negative Int fields
// ---------------------------------------------------------------------------

#[test]
fn negative_one_int_binary_roundtrip() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": { "status_code": -1 }
    }"#;
    let val = bin_roundtrip(json);
    let root = val.get("base_root").unwrap().as_object().unwrap();
    assert_eq!(
        root.get("status_code").and_then(|v| v.as_i64()),
        Some(-1),
        "value -1 must survive binary round-trip"
    );
}

#[test]
fn i32_min_as_negative_int_binary_roundtrip() {
    // i32::MIN = -2147483648
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": { "boundary_val": -2147483648 }
    }"#;
    let val = bin_roundtrip(json);
    let root = val.get("base_root").unwrap().as_object().unwrap();
    assert_eq!(
        root.get("boundary_val").and_then(|v| v.as_i64()),
        Some(-2_147_483_648),
        "i32::MIN must survive binary round-trip"
    );
}

// ---------------------------------------------------------------------------
// 5. i32 boundary values
// ---------------------------------------------------------------------------

#[test]
fn i32_min_binary_roundtrip() {
    let json = format!(
        r#"{{ "__revision_dont_touch": 1, "base_root": {{ "minval": {} }} }}"#,
        i32::MIN
    );
    let val = bin_roundtrip(&json);
    let root = val.get("base_root").unwrap().as_object().unwrap();
    assert_eq!(
        root.get("minval").and_then(|v| v.as_i64()),
        Some(i32::MIN as i64),
        "i32::MIN must survive"
    );
}

#[test]
fn i32_max_binary_roundtrip() {
    let json = format!(
        r#"{{ "__revision_dont_touch": 1, "base_root": {{ "maxval": {} }} }}"#,
        i32::MAX
    );
    let val = bin_roundtrip(&json);
    let root = val.get("base_root").unwrap().as_object().unwrap();
    assert_eq!(
        root.get("maxval").and_then(|v| v.as_i64()),
        Some(i32::MAX as i64),
        "i32::MAX must survive"
    );
}

#[test]
fn i32_zero_binary_roundtrip() {
    let json = r#"{ "__revision_dont_touch": 1, "base_root": { "zeroval": 0 } }"#;
    let val = bin_roundtrip(json);
    let root = val.get("base_root").unwrap().as_object().unwrap();
    assert_eq!(
        root.get("zeroval").and_then(|v| v.as_i64()),
        Some(0),
        "zero must survive binary round-trip"
    );
}

// ---------------------------------------------------------------------------
// 6. Bool fields
// ---------------------------------------------------------------------------

#[test]
fn bool_true_binary_roundtrip() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": { "is_active": true }
    }"#;
    let val = bin_roundtrip(json);
    let root = val.get("base_root").unwrap().as_object().unwrap();
    assert_eq!(
        root.get("is_active").and_then(|v| v.as_bool()),
        Some(true),
        "bool true must survive binary round-trip"
    );
}

#[test]
fn bool_false_binary_roundtrip() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": { "is_dead": false }
    }"#;
    let val = bin_roundtrip(json);
    let root = val.get("base_root").unwrap().as_object().unwrap();
    assert_eq!(
        root.get("is_dead").and_then(|v| v.as_bool()),
        Some(false),
        "bool false must survive binary round-trip"
    );
}

// ---------------------------------------------------------------------------
// 7. String fields
// ---------------------------------------------------------------------------

#[test]
fn simple_ascii_string_binary_roundtrip() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": { "hero_name": "Reynauld" }
    }"#;
    let val = bin_roundtrip(json);
    let root = val.get("base_root").unwrap().as_object().unwrap();
    assert_eq!(
        root.get("hero_name").and_then(|v| v.as_str()),
        Some("Reynauld"),
        "ASCII string must survive binary round-trip"
    );
}

#[test]
fn empty_string_binary_roundtrip() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": { "empty_field": "" }
    }"#;
    let val = bin_roundtrip(json);
    let root = val.get("base_root").unwrap().as_object().unwrap();
    assert_eq!(
        root.get("empty_field").and_then(|v| v.as_str()),
        Some(""),
        "empty string must survive binary round-trip"
    );
}

// ---------------------------------------------------------------------------
// 8. String with special characters
// ---------------------------------------------------------------------------

#[test]
fn string_with_backslash_binary_roundtrip() {
    // JSON-encode the backslash: "path\\to\\file"
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": { "file_path": "path\\to\\file" }
    }"#;
    let val = bin_roundtrip(json);
    let root = val.get("base_root").unwrap().as_object().unwrap();
    assert_eq!(
        root.get("file_path").and_then(|v| v.as_str()),
        Some("path\\to\\file"),
        "backslashes in strings must survive binary round-trip"
    );
}

#[test]
fn string_with_quotes_binary_roundtrip() {
    // JSON-encode the quote: "say \"hello\""
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": { "quote_field": "say \"hello\"" }
    }"#;
    let val = bin_roundtrip(json);
    let root = val.get("base_root").unwrap().as_object().unwrap();
    assert_eq!(
        root.get("quote_field").and_then(|v| v.as_str()),
        Some("say \"hello\""),
        "double-quotes in strings must survive binary round-trip"
    );
}

#[test]
fn string_with_newline_binary_roundtrip() {
    // JSON-encode the newline: "line1\nline2"
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": { "multiline": "line1\nline2" }
    }"#;
    let val = bin_roundtrip(json);
    let root = val.get("base_root").unwrap().as_object().unwrap();
    assert_eq!(
        root.get("multiline").and_then(|v| v.as_str()),
        Some("line1\nline2"),
        "newline in strings must survive binary round-trip"
    );
}

// ---------------------------------------------------------------------------
// 9. Nested objects (3 levels deep)
// ---------------------------------------------------------------------------

#[test]
fn nested_objects_three_levels_binary_roundtrip() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "level1": {
                "level2": {
                    "deep_value": 99
                }
            }
        }
    }"#;
    let val = bin_roundtrip(json);
    let deep = val
        .get("base_root")
        .and_then(|v| v.get("level1"))
        .and_then(|v| v.get("level2"))
        .and_then(|v| v.get("deep_value"))
        .and_then(|v| v.as_i64());
    assert_eq!(deep, Some(99), "3-level nested value must survive binary round-trip");
}

// ---------------------------------------------------------------------------
// 10. Empty nested object
// ---------------------------------------------------------------------------

#[test]
fn empty_nested_object_binary_roundtrip() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "inner": {}
        }
    }"#;
    let val = bin_roundtrip(json);
    let inner = val
        .get("base_root")
        .and_then(|v| v.get("inner"))
        .expect("inner must exist");
    assert!(inner.is_object(), "inner must be an object");
    assert_eq!(
        inner.as_object().unwrap().len(),
        0,
        "inner must be empty after binary round-trip"
    );
}

// ---------------------------------------------------------------------------
// 11. Multiple sibling fields
// ---------------------------------------------------------------------------

#[test]
fn multiple_sibling_fields_binary_roundtrip() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "field_a": 10,
            "field_b": 20,
            "field_c": 30
        }
    }"#;
    let val = bin_roundtrip(json);
    let root = val.get("base_root").unwrap().as_object().unwrap();
    assert_eq!(root.get("field_a").and_then(|v| v.as_i64()), Some(10), "field_a must be 10");
    assert_eq!(root.get("field_b").and_then(|v| v.as_i64()), Some(20), "field_b must be 20");
    assert_eq!(root.get("field_c").and_then(|v| v.as_i64()), Some(30), "field_c must be 30");
    assert_eq!(root.len(), 3, "all 3 sibling fields must be present");
}

// ---------------------------------------------------------------------------
// 12. Multiple sibling objects
// ---------------------------------------------------------------------------

#[test]
fn multiple_sibling_objects_binary_roundtrip() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "obj_alpha": { "val": 1 },
            "obj_beta":  { "val": 2 }
        }
    }"#;
    let val = bin_roundtrip(json);
    let root = val.get("base_root").unwrap().as_object().unwrap();
    assert_eq!(root.len(), 2, "two sibling objects must be present");
    assert_eq!(
        root.get("obj_alpha")
            .and_then(|v| v.get("val"))
            .and_then(|v| v.as_i64()),
        Some(1),
        "obj_alpha.val must be 1"
    );
    assert_eq!(
        root.get("obj_beta")
            .and_then(|v| v.get("val"))
            .and_then(|v| v.as_i64()),
        Some(2),
        "obj_beta.val must be 2"
    );
}

// ---------------------------------------------------------------------------
// 13. Binary byte-for-byte equality: JSON->bin1->JSON->bin2 must match
// ---------------------------------------------------------------------------

#[test]
fn binary_byte_for_byte_equality_after_double_roundtrip() {
    let json = r#"{
        "__revision_dont_touch": 55,
        "base_root": {
            "hero_id": 42,
            "name": "Dismas",
            "alive": true
        }
    }"#;

    let file1 = from_json(json);
    let bin1 = to_bin(&file1);

    // Decode and re-encode from the binary output.
    let file2 = from_bin(&bin1);
    let bin2 = to_bin(&file2);

    assert_eq!(
        bin1, bin2,
        "two successive binary encodes of the same logical content must be byte-for-byte identical"
    );
}

// ---------------------------------------------------------------------------
// 14. Garbage binary rejected
// ---------------------------------------------------------------------------

#[test]
fn random_garbage_bytes_rejected() {
    let mut garbage: &[u8] = &[0x00u8, 0x50, 0x91, 0x02, 0xFF, 0x10, 0x44, 0x77];
    assert!(
        File::try_from_bin(&mut garbage).is_err(),
        "random garbage bytes must be rejected"
    );
}

#[test]
fn too_short_input_rejected() {
    // Only 4 bytes – far shorter than the 64-byte header.
    let mut short: &[u8] = &[0x01u8, 0xB1, 0x00, 0x00];
    assert!(
        File::try_from_bin(&mut short).is_err(),
        "too-short input must be rejected"
    );
}

#[test]
fn empty_input_rejected() {
    let mut empty: &[u8] = &[];
    assert!(
        File::try_from_bin(&mut empty).is_err(),
        "empty input must be rejected"
    );
}

// ---------------------------------------------------------------------------
// 15. Header magic validation
// ---------------------------------------------------------------------------

#[test]
fn wrong_magic_number_rejected() {
    // Build a valid file first so we have a proper binary layout to corrupt.
    let json = r#"{ "__revision_dont_touch": 1, "base_root": {} }"#;
    let file = from_json(json);
    let mut bin = to_bin(&file);

    // The first 4 bytes are the magic: 0x01 0xB1 0x00 0x00.
    // Corrupt the magic to something that should be rejected.
    bin[0] = 0xFF;
    bin[1] = 0xFF;

    assert!(
        File::try_from_bin(&mut &*bin).is_err(),
        "corrupted magic number must be rejected"
    );
}

#[test]
fn all_zero_magic_rejected() {
    let json = r#"{ "__revision_dont_touch": 1, "base_root": {} }"#;
    let file = from_json(json);
    let mut bin = to_bin(&file);
    // Zero out the magic bytes.
    bin[0] = 0x00;
    bin[1] = 0x00;
    bin[2] = 0x00;
    bin[3] = 0x00;
    assert!(
        File::try_from_bin(&mut &*bin).is_err(),
        "all-zero magic must be rejected"
    );
}

// ---------------------------------------------------------------------------
// 16. Deeply nested objects (10 levels)
// ---------------------------------------------------------------------------

#[test]
fn deeply_nested_objects_ten_levels_binary_roundtrip() {
    // Build JSON with 10 levels of nesting (l1..l9 = 9 named object layers + leaf).
    let json = r#"{"__revision_dont_touch":1,"base_root":{"l1":{"l2":{"l3":{"l4":{"l5":{"l6":{"l7":{"l8":{"l9":{"leaf":42}}}}}}}}}}}"#;
    let val = bin_roundtrip(json);

    let leaf = val
        .get("base_root")
        .and_then(|v| v.get("l1"))
        .and_then(|v| v.get("l2"))
        .and_then(|v| v.get("l3"))
        .and_then(|v| v.get("l4"))
        .and_then(|v| v.get("l5"))
        .and_then(|v| v.get("l6"))
        .and_then(|v| v.get("l7"))
        .and_then(|v| v.get("l8"))
        .and_then(|v| v.get("l9"))
        .and_then(|v| v.get("leaf"))
        .and_then(|v| v.as_i64());

    assert_eq!(leaf, Some(42), "leaf value must survive 10-level deep nesting round-trip");
}

// ---------------------------------------------------------------------------
// 17. Object with many children (50 fields)
// ---------------------------------------------------------------------------

#[test]
fn object_with_fifty_fields_binary_roundtrip() {
    // Build a JSON object with 50 integer fields.
    let mut fields = String::new();
    for i in 0..50u32 {
        if i > 0 {
            fields.push_str(", ");
        }
        fields.push_str(&format!(r#""field_{:02}": {}"#, i, i));
    }
    let json = format!(
        r#"{{ "__revision_dont_touch": 1, "base_root": {{ {} }} }}"#,
        fields
    );

    let val = bin_roundtrip(&json);
    let root = val.get("base_root").unwrap().as_object().unwrap();

    assert_eq!(root.len(), 50, "all 50 fields must survive binary round-trip");

    for i in 0..50u64 {
        let key = format!("field_{:02}", i);
        assert_eq!(
            root.get(&key).and_then(|v| v.as_i64()),
            Some(i as i64),
            "field_{:02} must have value {}",
            i,
            i
        );
    }
}

// ---------------------------------------------------------------------------
// 18. Field ordering preservation
// ---------------------------------------------------------------------------

#[test]
fn field_ordering_preserved_after_binary_roundtrip() {
    // Fields are declared in z, a, m order – they must come back in that order.
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "z_field": 26,
            "a_field": 1,
            "m_field": 13
        }
    }"#;

    // Round-trip through binary.
    let file = from_json(json);
    let bin = to_bin(&file);
    let file2 = from_bin(&bin);

    // Emit JSON and check the raw text order of keys.
    let unhash = Unhasher::<&str>::empty();
    let mut json_out = Vec::new();
    file2
        .write_to_json(&mut json_out, true, &unhash)
        .expect("write_to_json must not fail");
    let json_str = std::str::from_utf8(&json_out).expect("output must be valid UTF-8");

    let z_pos = json_str.find("z_field").expect("z_field must be present");
    let a_pos = json_str.find("a_field").expect("a_field must be present");
    let m_pos = json_str.find("m_field").expect("m_field must be present");

    assert!(
        z_pos < a_pos,
        "z_field must appear before a_field in JSON output"
    );
    assert!(
        a_pos < m_pos,
        "a_field must appear before m_field in JSON output"
    );

    // Also verify values are intact.
    let val = to_value(&file2);
    let root = val.get("base_root").unwrap().as_object().unwrap();
    assert_eq!(root.get("z_field").and_then(|v| v.as_i64()), Some(26));
    assert_eq!(root.get("a_field").and_then(|v| v.as_i64()), Some(1));
    assert_eq!(root.get("m_field").and_then(|v| v.as_i64()), Some(13));
}
