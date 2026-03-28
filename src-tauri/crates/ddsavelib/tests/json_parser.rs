//! Integration tests for the ddsavelib JSON parser.
//!
//! Covers whitespace handling, string escape round-trips, number parsing,
//! boolean parsing, trailing-comma behaviour, output formatting, and general
//! edge cases.  Every test carries a real assertion; there are no stubs.

use ddsavelib::{File, Unhasher};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Return an `Unhasher` that recognises no names (the minimal case needed for
/// most tests).
fn empty_unhash() -> Unhasher<&'static str> {
    Unhasher::empty()
}

/// Parse a JSON string and panic with a descriptive message on failure.
fn parse(json: &str) -> File {
    File::try_from_json(json.as_bytes())
        .unwrap_or_else(|e| panic!("parse failed: {e}\ninput: {json}"))
}

/// Parse a JSON string and expect failure.
fn parse_err(json: &str) -> ddsavelib::err::FromJsonError {
    File::try_from_json(json.as_bytes())
        .expect_err(&format!("expected parse to fail, but it succeeded\ninput: {json}"))
}

/// Parse → write_to_json → return the JSON bytes.
fn round_trip_bytes(json: &str) -> Vec<u8> {
    let file = parse(json);
    let mut out = Vec::new();
    file.write_to_json(&mut out, true, &empty_unhash())
        .expect("write_to_json should not fail");
    out
}

/// Parse → write_to_json → parse the output again with serde_json.
fn to_serde_value(json: &str) -> serde_json::Value {
    let bytes = round_trip_bytes(json);
    serde_json::from_slice(&bytes)
        .unwrap_or_else(|e| panic!("serde_json could not parse ddsavelib output: {e}"))
}

/// A minimal valid save JSON that uses a plain-integer field value so that the
/// type can be inferred without a hardcoded name.
fn minimal(revision: u32, field_name: &str, field_value: i32) -> String {
    format!(
        r#"{{ "__revision_dont_touch": {revision}, "base_root": {{ "{field_name}": {field_value} }} }}"#
    )
}

/// Build a save JSON where "base_root" contains a string-valued field.
fn with_string_field(value: &str) -> String {
    // Escape the value for embedding inside the JSON literal.
    // We use serde_json to produce a correctly-escaped JSON string.
    let json_string = serde_json::to_string(value).unwrap();
    format!(
        r#"{{ "__revision_dont_touch": 0, "base_root": {{ "label": {json_string} }} }}"#
    )
}

// ---------------------------------------------------------------------------
// 1. Whitespace handling
// ---------------------------------------------------------------------------

#[test]
fn compact_json_parses() {
    // No whitespace at all between tokens.
    let json = r#"{"__revision_dont_touch":42,"base_root":{"x":1}}"#;
    let val = to_serde_value(json);
    assert_eq!(
        val.get("__revision_dont_touch").and_then(|v| v.as_u64()),
        Some(42),
        "revision must survive compact parse"
    );
}

#[test]
fn excessive_whitespace_parses() {
    let json = r#"   {
        "__revision_dont_touch"   :    100   ,
        "base_root"  :  {
            "x"  :  99
        }
    }  "#;
    let val = to_serde_value(json);
    assert_eq!(
        val.get("__revision_dont_touch").and_then(|v| v.as_u64()),
        Some(100)
    );
}

#[test]
fn tab_cr_newline_whitespace_parses() {
    // Mix tabs, carriage returns, and newlines as separators.
    let json = "{\r\n\t\"__revision_dont_touch\"\t:\t7,\r\n\t\"base_root\"\t:\t{\"z\":3}\r\n}";
    let val = to_serde_value(json);
    assert_eq!(
        val.get("__revision_dont_touch").and_then(|v| v.as_u64()),
        Some(7)
    );
}

// ---------------------------------------------------------------------------
// 2–11. String escape round-trips
//
// Strategy: build a save JSON whose "base_root" contains a "label" string
// field.  Parse it, write it back to JSON, parse *that* with serde_json, and
// check the value matches the original string.
// ---------------------------------------------------------------------------

/// Parse a save JSON containing a string field, then recover the string value
/// from the output JSON using serde_json.
fn string_round_trip(original: &str) -> String {
    let input_json = with_string_field(original);
    let output_bytes = round_trip_bytes(&input_json);
    let val: serde_json::Value = serde_json::from_slice(&output_bytes)
        .expect("output must be valid JSON");
    val.pointer("/base_root/label")
        .and_then(|v| v.as_str())
        .unwrap_or_else(|| panic!("label field missing in output:\n{}", std::str::from_utf8(&output_bytes).unwrap()))
        .to_owned()
}

#[test]
fn escape_backslash_round_trips() {
    // A raw backslash must survive write → parse.
    let original = r#"hello\world"#;
    assert_eq!(string_round_trip(original), original);
}

#[test]
fn escape_double_quote_round_trips() {
    let original = r#"say "hello""#;
    assert_eq!(string_round_trip(original), original);
}

#[test]
fn escape_newline_round_trips() {
    let original = "line1\nline2";
    assert_eq!(string_round_trip(original), original);
}

#[test]
fn escape_tab_round_trips() {
    let original = "col1\tcol2";
    assert_eq!(string_round_trip(original), original);
}

#[test]
fn escape_carriage_return_round_trips() {
    let original = "before\rafter";
    assert_eq!(string_round_trip(original), original);
}

#[test]
fn escape_backspace_round_trips() {
    // 0x08 = backspace
    let original = "a\x08b";
    assert_eq!(string_round_trip(original), original);
}

#[test]
fn escape_form_feed_round_trips() {
    // 0x0C = form feed
    let original = "page1\x0Cpage2";
    assert_eq!(string_round_trip(original), original);
}

#[test]
fn escape_all_seven_combined_round_trips() {
    // All 7 escapable characters in one string.
    let original = "\\\"\n\t\r\x08\x0C";
    assert_eq!(string_round_trip(original), original);
}

// Also verify the raw JSON bytes produced by write_to_json for a couple of
// these, to confirm the *encoding* (not just the round-trip value) is correct.

#[test]
fn output_encodes_backslash_as_double_backslash() {
    let input = with_string_field(r#"a\b"#);
    let output = round_trip_bytes(&input);
    let output_str = std::str::from_utf8(&output).unwrap();
    // The JSON bytes must contain the two-character sequence \\
    assert!(
        output_str.contains(r#"a\\b"#),
        "backslash must be encoded as \\\\ in JSON output; got: {output_str}"
    );
}

#[test]
fn output_encodes_newline_as_backslash_n() {
    let input = with_string_field("a\nb");
    let output = round_trip_bytes(&input);
    let output_str = std::str::from_utf8(&output).unwrap();
    assert!(
        output_str.contains(r#"a\nb"#),
        "newline must be encoded as \\n in JSON output; got: {output_str}"
    );
}

// ---------------------------------------------------------------------------
// 12–16. Number parsing
// ---------------------------------------------------------------------------

#[test]
fn number_positive_integer() {
    let val = to_serde_value(&minimal(0, "n", 42));
    assert_eq!(
        val.pointer("/base_root/n").and_then(|v| v.as_i64()),
        Some(42)
    );
}

#[test]
fn number_negative_integer() {
    let val = to_serde_value(&minimal(0, "n", -1));
    assert_eq!(
        val.pointer("/base_root/n").and_then(|v| v.as_i64()),
        Some(-1)
    );
}

#[test]
fn number_zero() {
    let val = to_serde_value(&minimal(0, "n", 0));
    assert_eq!(
        val.pointer("/base_root/n").and_then(|v| v.as_i64()),
        Some(0)
    );
}

#[test]
fn number_i32_max() {
    let val = to_serde_value(&minimal(0, "n", i32::MAX));
    assert_eq!(
        val.pointer("/base_root/n").and_then(|v| v.as_i64()),
        Some(i32::MAX as i64)
    );
}

#[test]
fn number_i32_min() {
    let val = to_serde_value(&minimal(0, "n", i32::MIN));
    assert_eq!(
        val.pointer("/base_root/n").and_then(|v| v.as_i64()),
        Some(i32::MIN as i64)
    );
}

// ---------------------------------------------------------------------------
// 17. Boolean parsing
// ---------------------------------------------------------------------------

#[test]
fn bool_true_parses() {
    let json = r#"{ "__revision_dont_touch": 0, "base_root": { "flag": true } }"#;
    let val = to_serde_value(json);
    assert_eq!(
        val.pointer("/base_root/flag").and_then(|v| v.as_bool()),
        Some(true),
        "bool true must survive round-trip"
    );
}

#[test]
fn bool_false_parses() {
    let json = r#"{ "__revision_dont_touch": 0, "base_root": { "flag": false } }"#;
    let val = to_serde_value(json);
    assert_eq!(
        val.pointer("/base_root/flag").and_then(|v| v.as_bool()),
        Some(false),
        "bool false must survive round-trip"
    );
}

// ---------------------------------------------------------------------------
// 18–19. Trailing comma behaviour
//
// The hand-rolled parser's Object block reads the *next* token after consuming
// a comma.  If that token is `}`, it no longer matches the EndObject early-exit
// branch (which only fires before comma-consumption).  As a result, trailing
// commas in objects cause a parse error rather than being silently accepted.
// The same logic applies to arrays.
// ---------------------------------------------------------------------------

#[test]
fn trailing_comma_in_object_is_rejected() {
    // `{"x": 1,}` — comma is consumed, then `}` is seen where a field-name
    // string is expected, so the parser should return an error.
    let json = r#"{"__revision_dont_touch": 42, "base_root": {"x": 1,}}"#;
    let _err = parse_err(json);
    // Just reaching here (i.e., the call returned Err rather than Ok) is the
    // meaningful assertion.
}

#[test]
fn trailing_comma_in_array_is_rejected() {
    // Use a hardcoded IntVector field so the parser enters the array-reading
    // path.  A trailing comma after the last element should be rejected.
    let json = r#"{
        "__revision_dont_touch": 0,
        "base_root": {
            "read_page_indexes": [1, 2,]
        }
    }"#;
    let _err = parse_err(json);
}

// ---------------------------------------------------------------------------
// 20. Non-standard number: `+` prefix
//
// The old hand-rolled lexer accepted `+42` because it treated `+` as a number
// start character. The serde-based parser correctly rejects it per RFC 8259.
// No real DD save files use this notation.
// ---------------------------------------------------------------------------

#[test]
fn plus_prefix_number_is_rejected() {
    let json = r#"{"__revision_dont_touch": 0, "base_root": {"x": +42}}"#;
    assert!(
        File::try_from_json(json.as_bytes()).is_err(),
        "`+42` is invalid JSON and must be rejected by the serde parser"
    );
}

// ---------------------------------------------------------------------------
// 21. JSON output formatting
// ---------------------------------------------------------------------------

#[test]
fn output_is_valid_json() {
    // Any output from write_to_json must be parseable by a standards-compliant
    // JSON library (serde_json).
    let input = r#"{ "__revision_dont_touch": 5, "base_root": { "a": 1, "b": true } }"#;
    let bytes = round_trip_bytes(input);
    let result: Result<serde_json::Value, _> = serde_json::from_slice(&bytes);
    assert!(
        result.is_ok(),
        "write_to_json output must be valid JSON; got: {}",
        std::str::from_utf8(&bytes).unwrap_or("<invalid utf-8>")
    );
}

#[test]
fn output_revision_appears_before_root() {
    // Regardless of input field order, `__revision_dont_touch` must be the
    // very first field in the output object.
    let input = r#"{ "__revision_dont_touch": 99, "base_root": { "x": 7 } }"#;
    let bytes = round_trip_bytes(input);
    let output = std::str::from_utf8(&bytes).unwrap();

    let rev_pos = output
        .find("__revision_dont_touch")
        .expect("__revision_dont_touch must appear in output");
    let root_pos = output.find("base_root").expect("root must appear in output");

    assert!(
        rev_pos < root_pos,
        "__revision_dont_touch ({rev_pos}) must precede the root field ({root_pos})"
    );
}

#[test]
fn output_uses_four_space_indentation() {
    // The first content line of the output (after the opening `{`) should be
    // indented with exactly four spaces.
    let input = r#"{ "__revision_dont_touch": 1, "base_root": { "x": 2 } }"#;
    let bytes = round_trip_bytes(input);
    let output = std::str::from_utf8(&bytes).unwrap();

    // Find the line containing `__revision_dont_touch`.
    let rev_line = output
        .lines()
        .find(|l| l.contains("__revision_dont_touch"))
        .expect("must have a revision line");

    // That line should start with exactly 4 spaces (and no tabs).
    assert!(
        rev_line.starts_with("    ") && !rev_line.starts_with("     "),
        "revision line must be indented by exactly 4 spaces; got: {rev_line:?}"
    );
}

// ---------------------------------------------------------------------------
// 22. Edge cases
// ---------------------------------------------------------------------------

#[test]
fn empty_root_object_parses() {
    let json = r#"{ "__revision_dont_touch": 0, "base_root": {} }"#;
    let val = to_serde_value(json);
    assert!(
        val.get("__revision_dont_touch").is_some(),
        "revision must be present after empty-root parse"
    );
    assert!(
        val.get("base_root").map(|v| v.is_object()).unwrap_or(false),
        "base_root must be an object"
    );
}

#[test]
fn single_field_in_root_parses() {
    let json = r#"{ "__revision_dont_touch": 1, "base_root": { "x": 1 } }"#;
    let val = to_serde_value(json);
    assert_eq!(
        val.pointer("/base_root/x").and_then(|v| v.as_i64()),
        Some(1)
    );
}

#[test]
fn custom_root_name_parses() {
    // The root field does not need to be named "base_root".
    let json = r#"{ "__revision_dont_touch": 3, "custom_root": { "n": 5 } }"#;
    let val = to_serde_value(json);
    assert_eq!(
        val.get("__revision_dont_touch").and_then(|v| v.as_u64()),
        Some(3)
    );
    assert!(
        val.get("custom_root").map(|v| v.is_object()).unwrap_or(false),
        "custom_root must be present and be an object"
    );
}

#[test]
fn very_long_field_name_round_trips() {
    // A field name that is 100 characters long must survive the round-trip.
    let long_name: String = "a".repeat(100);
    let json = format!(
        r#"{{ "__revision_dont_touch": 0, "base_root": {{ "{long_name}": 7 }} }}"#
    );
    let val = to_serde_value(&json);
    assert_eq!(
        val.pointer(&format!("/base_root/{long_name}"))
            .and_then(|v| v.as_i64()),
        Some(7),
        "100-char field name must survive round-trip"
    );
}

#[test]
fn very_long_string_value_round_trips() {
    // A string value that is 1000 characters long must survive the round-trip.
    let long_value: String = "x".repeat(1000);
    let recovered = string_round_trip(&long_value);
    assert_eq!(
        recovered.len(),
        long_value.len(),
        "1000-char string value length must survive round-trip"
    );
    assert_eq!(
        recovered, long_value,
        "1000-char string value content must survive round-trip"
    );
}

// ---------------------------------------------------------------------------
// Additional: revision field after root (parser must accept both orderings)
// ---------------------------------------------------------------------------

#[test]
fn revision_after_root_is_accepted() {
    // The spec says `__revision_dont_touch` can appear either before or after
    // the root field.
    let json = r#"{ "base_root": { "x": 1 }, "__revision_dont_touch": 55 }"#;
    let val = to_serde_value(json);
    assert_eq!(
        val.get("__revision_dont_touch").and_then(|v| v.as_u64()),
        Some(55),
        "revision must be captured even when it appears after the root field"
    );
}

// ---------------------------------------------------------------------------
// Additional: garbage input is cleanly rejected
// ---------------------------------------------------------------------------

#[test]
fn garbage_json_is_rejected() {
    let _err = parse_err("not json at all");
}

#[test]
fn missing_revision_field_is_rejected() {
    // A JSON object with only a root field but no __revision_dont_touch must
    // be rejected: the parser will look for the revision field after the root
    // and find `}` instead.
    let json = r#"{ "base_root": { "x": 1 } }"#;
    let _err = parse_err(json);
}

#[test]
fn missing_root_field_is_rejected() {
    // Only the revision field, no root object.
    let json = r#"{ "__revision_dont_touch": 0 }"#;
    // The parser expects to read a root field name after __revision_dont_touch.
    // If the next token is `}`, that is `EndObject` which is not a `FieldName`,
    // so an error is returned.
    let _err = parse_err(json);
}
