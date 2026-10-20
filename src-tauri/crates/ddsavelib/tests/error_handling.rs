/// Integration tests for ddsavelib error handling and edge cases.
///
/// All tests verify that invalid inputs are rejected gracefully (returning Err)
/// without panicking. Specific error variant shapes are intentionally not checked -
/// only whether the operation fails.
use ddsavelib::File;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn parse_json(json: &str) -> Result<File, ddsavelib::err::FromJsonError> {
    File::try_from_json(json.as_bytes())
}

fn parse_bin(data: &[u8]) -> Result<File, ddsavelib::err::FromBinError> {
    File::try_from_bin(&mut &*data)
}

// ---------------------------------------------------------------------------
// 1. Missing / invalid revision field
// ---------------------------------------------------------------------------

#[test]
fn missing_revision_field_is_rejected() {
    // No __revision_dont_touch at all.
    assert!(
        parse_json(r#"{"base_root": {"x": 1}}"#).is_err(),
        "missing revision field must be rejected"
    );
}

#[test]
fn wrong_revision_field_name_is_rejected() {
    assert!(
        parse_json(r#"{"__wrong_name": 42, "base_root": {}}"#).is_err(),
        "wrong revision field name must be rejected"
    );
}

#[test]
fn revision_with_string_value_is_rejected() {
    assert!(
        parse_json(r#"{"__revision_dont_touch": "hello", "base_root": {}}"#).is_err(),
        "string revision value must be rejected"
    );
}

#[test]
fn revision_with_float_value_is_rejected() {
    // 42.5 is not a valid u32, so the `parse::<u32>()` call must fail.
    assert!(
        parse_json(r#"{"__revision_dont_touch": 42.5, "base_root": {}}"#).is_err(),
        "float revision value must be rejected"
    );
}

#[test]
fn revision_with_negative_value_is_rejected() {
    // -1 cannot be parsed as u32.
    assert!(
        parse_json(r#"{"__revision_dont_touch": -1, "base_root": {}}"#).is_err(),
        "negative revision value must be rejected"
    );
}

// ---------------------------------------------------------------------------
// 2. Invalid JSON structure
// ---------------------------------------------------------------------------

#[test]
fn empty_input_json_is_rejected() {
    assert!(parse_json("").is_err(), "empty input must be rejected");
}

#[test]
fn plain_text_input_is_rejected() {
    assert!(
        parse_json("this is not json").is_err(),
        "non-JSON text must be rejected"
    );
}

#[test]
fn bare_number_as_top_level_is_rejected() {
    assert!(
        parse_json("42").is_err(),
        "bare number as top-level input must be rejected"
    );
}

#[test]
fn bare_string_as_top_level_is_rejected() {
    assert!(
        parse_json(r#""hello""#).is_err(),
        "bare string as top-level input must be rejected"
    );
}

#[test]
fn missing_opening_brace_is_rejected() {
    assert!(
        parse_json(r#""__revision_dont_touch": 42}"#).is_err(),
        "JSON without opening brace must be rejected"
    );
}

#[test]
fn unclosed_object_is_rejected() {
    assert!(
        parse_json(r#"{"__revision_dont_touch": 42, "base_root": {"#).is_err(),
        "unclosed JSON object must be rejected"
    );
}

#[test]
fn unterminated_string_is_rejected() {
    // The lexer's string scanner loops until it finds the closing quote or runs
    // out of input (next() returns None inside the loop). On None the lexer's
    // `next()` returns None, which the parser sees as EOF -> UnexpEof.
    assert!(
        parse_json(r#"{"__revision_dont_touch": 42, "base_root": {"k": "unclosed}"#).is_err(),
        "unterminated string must be rejected"
    );
}

// ---------------------------------------------------------------------------
// 3. Null values (not supported as field values)
// ---------------------------------------------------------------------------

#[test]
fn null_field_value_is_rejected() {
    // `null` is a valid JSON token but is not supported for field values.
    // The heuristic branch in FieldType::try_from_json does not handle Null,
    // falling through to the LiteralFormat error.
    assert!(
        parse_json(r#"{"__revision_dont_touch": 1, "base_root": {"x": null}}"#).is_err(),
        "null field value must be rejected"
    );
}

// ---------------------------------------------------------------------------
// 4. Invalid field values for non-hardcoded fields
// ---------------------------------------------------------------------------

#[test]
fn array_for_unknown_field_is_rejected() {
    // Arrays are only legal for hardcoded field names (e.g. IntVector fields).
    // An unknown field name receiving an array has no hardcoded type and the
    // heuristic branch will encounter BeginArray and return LiteralFormat.
    assert!(
        parse_json(r#"{"__revision_dont_touch": 1, "base_root": {"unknown_field": [1, 2, 3]}}"#)
            .is_err(),
        "array for unknown field must be rejected"
    );
}

#[test]
fn float_for_unknown_field_is_rejected() {
    // For non-hardcoded fields, the heuristic treats Number tokens as i32.
    // 3.14 cannot be parsed as i32, so it must be rejected.
    assert!(
        parse_json(r#"{"__revision_dont_touch": 1, "base_root": {"unknown_field": 3.14}}"#)
            .is_err(),
        "float for non-hardcoded field must be rejected (must be i32)"
    );
}

// ---------------------------------------------------------------------------
// 5. Invalid binary input
// ---------------------------------------------------------------------------

#[test]
fn empty_bytes_is_rejected() {
    assert!(parse_bin(&[]).is_err(), "empty byte slice must be rejected");
}

#[test]
fn too_short_binary_is_rejected() {
    // Header requires exactly 64 bytes; 32 bytes is too short.
    assert!(
        parse_bin(&[0u8; 32]).is_err(),
        "32-byte input (shorter than 64-byte header) must be rejected"
    );
}

#[test]
fn wrong_magic_number_is_rejected() {
    // Build 64 bytes where the first 4 bytes are NOT the valid magic [0x01,0xB1,0x00,0x00].
    let mut buf = [0u8; 64];
    buf[0] = 0xFF;
    buf[1] = 0xFF;
    buf[2] = 0xFF;
    buf[3] = 0xFF;
    assert!(
        parse_bin(&buf).is_err(),
        "wrong magic number must be rejected"
    );
}

#[test]
fn random_garbage_binary_is_rejected() {
    assert!(
        parse_bin(&[0xDE, 0xAD, 0xBE, 0xEF]).is_err(),
        "4-byte garbage input must be rejected"
    );
}

#[test]
fn all_zeros_binary_is_rejected() {
    // 64 zero bytes have a valid length but wrong magic number.
    assert!(
        parse_bin(&[0u8; 64]).is_err(),
        "64 zero bytes must be rejected (wrong magic)"
    );
}

// ---------------------------------------------------------------------------
// 6. Unsupported JSON escape sequences
// ---------------------------------------------------------------------------

#[test]
fn unicode_escape_in_string_is_accepted() {
    // serde_json correctly handles \uXXXX per RFC 8259.
    let file = parse_json(r#"{"__revision_dont_touch": 1, "base_root": {"x": "\u0041"}}"#)
        .expect(r"\uXXXX escape should be accepted by serde parser");
    let unhash = ddsavelib::Unhasher::<&str>::empty();
    let val = file.to_json_value(&unhash);
    assert_eq!(val["base_root"]["x"].as_str(), Some("A"));
}

#[test]
fn forward_slash_escape_in_string_is_accepted() {
    // serde_json correctly handles \/ per RFC 8259.
    let file = parse_json(r#"{"__revision_dont_touch": 1, "base_root": {"x": "a\/b"}}"#)
        .expect(r"\/ escape should be accepted by serde parser");
    let unhash = ddsavelib::Unhasher::<&str>::empty();
    let val = file.to_json_value(&unhash);
    assert_eq!(val["base_root"]["x"].as_str(), Some("a/b"));
}

// ---------------------------------------------------------------------------
// 7. Integer overflow for non-hardcoded fields
// ---------------------------------------------------------------------------

#[test]
fn number_exceeding_i32_max_is_rejected() {
    // i32::MAX is 2147483647; 2147483648 overflows i32.
    assert!(
        parse_json(r#"{"__revision_dont_touch": 1, "base_root": {"x": 2147483648}}"#).is_err(),
        "i32::MAX + 1 must be rejected for a non-hardcoded int field"
    );
}

#[test]
fn number_below_i32_min_is_rejected() {
    // i32::MIN is -2147483648; -2147483649 underflows i32.
    assert!(
        parse_json(r#"{"__revision_dont_touch": 1, "base_root": {"x": -2147483649}}"#).is_err(),
        "i32::MIN - 1 must be rejected for a non-hardcoded int field"
    );
}

// ---------------------------------------------------------------------------
// 8. Char type errors (requirement_code is the only Char field)
// ---------------------------------------------------------------------------

#[test]
fn empty_string_for_char_field_is_rejected() {
    // requirement_code is hardcoded as Char. It requires exactly one ASCII byte.
    assert!(
        parse_json(r#"{"__revision_dont_touch": 1, "base_root": {"requirement_code": ""}}"#)
            .is_err(),
        "empty string for Char field must be rejected"
    );
}

#[test]
fn multi_char_string_for_char_field_is_rejected() {
    assert!(
        parse_json(r#"{"__revision_dont_touch": 1, "base_root": {"requirement_code": "AB"}}"#)
            .is_err(),
        "multi-char string for Char field must be rejected"
    );
}

// ---------------------------------------------------------------------------
// 9. TwoBool / TwoInt wrong element count
// ---------------------------------------------------------------------------

#[test]
fn twobool_with_one_element_is_rejected() {
    // quest_select_warnings under profile_options > values is hardcoded as TwoBool.
    // Providing only one element means the parser reads b1, then tries b2 but gets
    // EndArray, causing a parse failure.
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "profile_options": {
                "values": {
                    "quest_select_warnings": [true]
                }
            }
        }
    }"#;
    assert!(
        parse_json(json).is_err(),
        "TwoBool with only 1 element must be rejected"
    );
}

#[test]
fn twoint_with_three_elements_uses_first_two() {
    // killRange is hardcoded as TwoInt. The serde parser reads the first two
    // elements and drains extras. It uses only the first two values.
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "killRange": [1, 2, 3]
        }
    }"#;
    let file = parse_json(json).expect("TwoInt with extra elements should parse");
    let unhash = ddsavelib::Unhasher::<&str>::empty();
    let val = file.to_json_value(&unhash);
    let kr = val["base_root"]["killRange"].as_array().unwrap();
    assert_eq!(kr[0].as_i64(), Some(1));
    assert_eq!(kr[1].as_i64(), Some(2));
}

// ---------------------------------------------------------------------------
// 10. Robustness - various malformed inputs must not panic
// ---------------------------------------------------------------------------

#[test]
fn lone_open_brace_does_not_panic() {
    assert!(
        parse_json("{").is_err(),
        "lone {{ must be rejected without panic"
    );
}

#[test]
fn lone_close_brace_does_not_panic() {
    assert!(
        parse_json("}").is_err(),
        "lone }} must be rejected without panic"
    );
}

#[test]
fn lone_open_bracket_does_not_panic() {
    assert!(
        parse_json("[").is_err(),
        "lone [ must be rejected without panic"
    );
}

#[test]
fn lone_close_bracket_does_not_panic() {
    assert!(
        parse_json("]").is_err(),
        "lone ] must be rejected without panic"
    );
}

#[test]
fn double_open_brace_does_not_panic() {
    assert!(
        parse_json("{{").is_err(),
        "{{ must be rejected without panic"
    );
}

#[test]
fn object_with_empty_key_and_missing_value_does_not_panic() {
    assert!(
        parse_json(r#"{"": }"#).is_err(),
        "{{\"\":}} must be rejected without panic"
    );
}

// ---------------------------------------------------------------------------
// 11. from_json_value errors (serde_json::Value bridge)
// ---------------------------------------------------------------------------

#[test]
fn from_json_value_null_is_rejected() {
    let val = serde_json::Value::Null;
    assert!(
        File::from_json_value(&val).is_err(),
        "from_json_value(Null) must be rejected"
    );
}

#[test]
fn from_json_value_bare_number_is_rejected() {
    let val = serde_json::Value::Number(serde_json::Number::from(42i64));
    assert!(
        File::from_json_value(&val).is_err(),
        "from_json_value(Number) must be rejected (not an object)"
    );
}

#[test]
fn from_json_value_bare_string_is_rejected() {
    let val = serde_json::Value::String("hello".to_owned());
    assert!(
        File::from_json_value(&val).is_err(),
        "from_json_value(String) must be rejected (not an object)"
    );
}
