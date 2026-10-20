/// Integration tests for ddsavelib duplicate field handling, `###` hash prefix
/// behavior, and `__revision_dont_touch` positioning.
///
/// Key invariants exercised:
/// - The hand-rolled JSON parser preserves duplicate field names in the same object.
/// - `write_to_json` with `allow_dupes=true` emits ALL fields including duplicates;
///   `allow_dupes=false` deduplicates by keeping the first occurrence.
/// - String values starting with `###` are re-hashed via `name_hash(&value[3..])`
///   and stored as `Int` fields, not as strings.
/// - `###` applies to `Int` (heuristic path) and `IntVector` elements.
/// - `StringVector` stores `###…` strings literally without hashing.
/// - `__revision_dont_touch` may appear before or after the root field;
///   output always places it first.
use ddsavelib::{name_hash, File, Unhasher};

// ---------------------------------------------------------------------------
// Helpers (mirrors binary_format.rs style)
// ---------------------------------------------------------------------------

fn from_json(json: &str) -> File {
    File::try_from_json(json.as_bytes()).expect("try_from_json should succeed on valid JSON")
}

fn to_bin(file: &File) -> Vec<u8> {
    let mut bin = Vec::new();
    file.write_to_bin(&mut bin)
        .expect("write_to_bin should not fail on a Vec");
    bin
}

fn from_bin(bin: &[u8]) -> File {
    File::try_from_bin(&mut &*bin).expect("try_from_bin should succeed on valid data")
}

/// Write a File to a raw JSON string with the given `allow_dupes` flag.
fn to_json_str(file: &File, allow_dupes: bool) -> String {
    let unhash = Unhasher::<&str>::empty();
    let mut buf = Vec::new();
    file.write_to_json(&mut buf, allow_dupes, &unhash)
        .expect("write_to_json should not fail on a Vec");
    String::from_utf8(buf).expect("write_to_json should produce valid UTF-8")
}

/// Write a File to a raw JSON string using a provided Unhasher.
fn to_json_str_with_unhash<T: AsRef<str>>(
    file: &File,
    allow_dupes: bool,
    unhash: &Unhasher<T>,
) -> String {
    let mut buf = Vec::new();
    file.write_to_json(&mut buf, allow_dupes, unhash)
        .expect("write_to_json should not fail on a Vec");
    String::from_utf8(buf).expect("write_to_json should produce valid UTF-8")
}

/// Count non-overlapping occurrences of a pattern in a string.
fn count_occurrences(haystack: &str, needle: &str) -> usize {
    let mut count = 0;
    let mut start = 0;
    while let Some(pos) = haystack[start..].find(needle) {
        count += 1;
        start += pos + needle.len();
    }
    count
}

// ===========================================================================
// DUPLICATE FIELD NAMES
// ===========================================================================

// ---------------------------------------------------------------------------
// Test 1: allow_dupes=true emits both duplicate scalar fields
// ---------------------------------------------------------------------------

#[test]
fn duplicate_scalar_fields_both_emitted_with_allow_dupes() {
    // Both "x" fields must appear in the output when allow_dupes=true.
    let json = r#"{ "__revision_dont_touch": 1, "base_root": { "x": 1, "x": 2 } }"#;
    let file = from_json(json);
    let out = to_json_str(&file, true);

    // The output should contain "x" as a JSON key twice.
    // The writer emits keys as `"x" : value`, so we count `"x"`.
    let count = count_occurrences(&out, "\"x\"");
    assert_eq!(
        count, 2,
        "allow_dupes=true must emit both duplicate 'x' entries; output was:\n{out}"
    );
}

// ---------------------------------------------------------------------------
// Test 2: Duplicate fields survive a full JSON -> binary -> JSON round-trip
// ---------------------------------------------------------------------------

#[test]
fn duplicate_fields_survive_binary_roundtrip() {
    let json = r#"{ "__revision_dont_touch": 1, "base_root": { "x": 1, "x": 2 } }"#;
    let file = from_json(json);

    let bin = to_bin(&file);
    let file2 = from_bin(&bin);

    let out = to_json_str(&file2, true);
    let count = count_occurrences(&out, "\"x\"");
    assert_eq!(
        count, 2,
        "both duplicate 'x' entries must survive JSON -> binary -> JSON round-trip; output was:\n{out}"
    );
}

// ---------------------------------------------------------------------------
// Test 3: allow_dupes=false deduplicates, keeping the first occurrence
// ---------------------------------------------------------------------------

#[test]
fn duplicate_scalar_fields_deduplicated_with_allow_dupes_false() {
    let json = r#"{ "__revision_dont_touch": 1, "base_root": { "x": 10, "x": 20 } }"#;
    let file = from_json(json);
    let out = to_json_str(&file, false);

    // Exactly one "x" key in the output.
    let key_count = count_occurrences(&out, "\"x\"");
    assert_eq!(
        key_count, 1,
        "allow_dupes=false must deduplicate 'x' to a single entry; output was:\n{out}"
    );

    // The surviving value must be the first one (10), not the second (20).
    // Find the position of the key and check the value that follows it.
    let x_pos = out.find("\"x\"").expect("'x' key must be present");
    let after_key = &out[x_pos..];
    // The writer formats: `"x" : 10\n` — value comes after ` : `.
    let value_start = after_key.find(": ").expect("': ' must follow the key") + 2;
    let value_fragment = after_key[value_start..].trim_start();
    assert!(
        value_fragment.starts_with("10"),
        "surviving 'x' must have the first value (10), not the second (20); output was:\n{out}"
    );
}

// ---------------------------------------------------------------------------
// Test 4: Duplicate object-typed fields both survive with allow_dupes=true
// ---------------------------------------------------------------------------

#[test]
fn duplicate_object_fields_both_emitted_with_allow_dupes() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "obj": { "a": 1 },
            "obj": { "b": 2 }
        }
    }"#;
    let file = from_json(json);
    let out = to_json_str(&file, true);

    // Both "obj" keys must appear.
    let count = count_occurrences(&out, "\"obj\"");
    assert_eq!(
        count, 2,
        "allow_dupes=true must emit both duplicate 'obj' entries; output was:\n{out}"
    );

    // And the fields inside them should also be present.
    assert!(
        out.contains("\"a\""),
        "'a' from first 'obj' must appear in output"
    );
    assert!(
        out.contains("\"b\""),
        "'b' from second 'obj' must appear in output"
    );
}

// ---------------------------------------------------------------------------
// Test 5: Duplicates at different nesting levels are independent
// ---------------------------------------------------------------------------

#[test]
fn duplicates_at_different_nesting_levels_are_independent() {
    // "foo" appears twice at the base_root level.
    // "bar" appears twice inside a nested object.
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "foo": 1,
            "nested": { "bar": 10, "bar": 20 },
            "foo": 2
        }
    }"#;
    let file = from_json(json);
    let out = to_json_str(&file, true);

    let foo_count = count_occurrences(&out, "\"foo\"");
    let bar_count = count_occurrences(&out, "\"bar\"");

    assert_eq!(
        foo_count, 2,
        "'foo' must appear twice (once at each root-level occurrence); output was:\n{out}"
    );
    assert_eq!(
        bar_count, 2,
        "'bar' must appear twice (once at each nested occurrence); output was:\n{out}"
    );
}

// ===========================================================================
// ### PREFIX (NAME HASHING)
// ===========================================================================

// ---------------------------------------------------------------------------
// Test 6: "###jester" parses as Int(name_hash("jester")), writes as integer
//         when no Unhasher is provided.
// ---------------------------------------------------------------------------

#[test]
fn hash_prefix_jester_parsed_as_int_written_as_integer_without_unhasher() {
    let json = r####"{
        "__revision_dont_touch": 1,
        "base_root": { "soldier_class": "###jester" }
    }"####;
    let file = from_json(json);
    let out = to_json_str(&file, true);

    let expected_hash = name_hash("jester");

    // The output must contain the integer representation of the hash.
    let expected_str = expected_hash.to_string();
    assert!(
        out.contains(&expected_str),
        "'###jester' must be stored as Int({expected_hash}) and written as {expected_hash}; output was:\n{out}"
    );

    // The literal "###jester" must NOT appear (no Unhasher was given).
    assert!(
        !out.contains("###jester"),
        "without an Unhasher, '###jester' must not appear in output; output was:\n{out}"
    );
}

// ---------------------------------------------------------------------------
// Test 7: name_hash("jester") == -2101527251 (matches the crate's doc example)
// ---------------------------------------------------------------------------

#[test]
fn name_hash_jester_equals_known_constant() {
    assert_eq!(
        name_hash("jester"),
        -2_101_527_251_i32,
        "name_hash(\"jester\") must equal -2101527251"
    );
}

// ---------------------------------------------------------------------------
// Test 8: Round-trip WITH Unhasher: Int(hash) -> "###jester" -> Int(hash)
// ---------------------------------------------------------------------------

#[test]
fn hash_round_trip_with_unhasher_produces_triple_hash_prefix() {
    // Parse with the raw integer; the file stores Int(name_hash("jester")).
    let json = format!(
        r#"{{ "__revision_dont_touch": 1, "base_root": {{ "soldier_class": {} }} }}"#,
        name_hash("jester")
    );
    let file = from_json(&json);

    // Write with an Unhasher that knows "jester".
    let mut unhash = Unhasher::empty();
    unhash.offer_name("jester");
    let out = to_json_str_with_unhash(&file, true, &unhash);

    assert!(
        out.contains("\"###jester\""),
        "with Unhasher containing 'jester', the integer must be written as '###jester'; output was:\n{out}"
    );

    // Re-parse that output. The Int value must survive.
    let file2 = from_json(&out);
    let unhash_empty = Unhasher::<&str>::empty();
    let out2 = to_json_str_with_unhash(&file2, true, &unhash_empty);

    let expected_hash = name_hash("jester");
    let expected_str = expected_hash.to_string();
    assert!(
        out2.contains(&expected_str),
        "re-parsing '###jester' must yield Int({expected_hash}); output was:\n{out2}"
    );
}

// ---------------------------------------------------------------------------
// Test 9: Round-trip WITHOUT Unhasher: Int(hash) writes as raw integer
// ---------------------------------------------------------------------------

#[test]
fn hash_round_trip_without_unhasher_writes_raw_integer() {
    let hash_val = name_hash("jester");
    let json = format!(
        r#"{{ "__revision_dont_touch": 1, "base_root": {{ "soldier_class": {} }} }}"#,
        hash_val
    );
    let file = from_json(&json);

    // Write with an empty Unhasher – no name known.
    let out = to_json_str(&file, true);

    let expected_str = hash_val.to_string();
    assert!(
        out.contains(&expected_str),
        "without Unhasher, Int({hash_val}) must appear as a raw integer; output was:\n{out}"
    );
    assert!(
        !out.contains("###"),
        "without Unhasher, no '###' prefix must appear in output; output was:\n{out}"
    );
}

// ---------------------------------------------------------------------------
// Test 10: "###" with empty suffix -> name_hash("") = 0
// ---------------------------------------------------------------------------

#[test]
fn hash_prefix_empty_suffix_is_zero() {
    // name_hash("") folds over an empty iterator, returning the initial value 0.
    assert_eq!(name_hash(""), 0, "name_hash(\"\") must equal 0");

    let json = r####"{ "__revision_dont_touch": 1, "base_root": { "field": "###" } }"####;
    let file = from_json(json);
    let out = to_json_str(&file, true);

    // Must write the integer 0.
    assert!(
        out.contains(": 0"),
        "'###' must be stored as Int(0) and written as 0; output was:\n{out}"
    );
    assert!(
        !out.contains("###"),
        "without Unhasher, '###' prefix must not appear in output; output was:\n{out}"
    );
}

// ---------------------------------------------------------------------------
// Test 11: ### in IntVector elements
//          read_page_indexes is a hardcoded IntVector field.
// ---------------------------------------------------------------------------

#[test]
fn hash_prefix_in_intvector_elements() {
    // read_page_indexes is a hardcoded IntVector. Its elements that start with
    // "###" must be stored as name_hash of the suffix.
    let json = r####"{
        "__revision_dont_touch": 1,
        "base_root": {
            "read_page_indexes": [1, "###jester", 3]
        }
    }"####;
    let file = from_json(json);

    // Write back without an Unhasher so we see raw integers.
    let out = to_json_str(&file, true);

    let jester_hash = name_hash("jester");

    // The output array must contain 1, jester_hash, 3 in order.
    let array_start = out
        .find('[')
        .expect("output must contain an array opening '['");
    let array_end = out[array_start..]
        .find(']')
        .expect("output must contain ']'")
        + array_start;
    let array_content = &out[array_start..=array_end];

    assert!(
        array_content.contains("1"),
        "element 0 (value 1) must be present in IntVector output; array was: {array_content}"
    );
    assert!(
        array_content.contains(&jester_hash.to_string()),
        "element 1 ('###jester' -> {jester_hash}) must be present in IntVector output; array was: {array_content}"
    );
    assert!(
        array_content.contains("3"),
        "element 2 (value 3) must be present in IntVector output; array was: {array_content}"
    );

    // Verify the integer 1 precedes the hash, which precedes 3.
    let pos_1 = array_content.find('1').unwrap();
    let pos_hash = array_content
        .find(&jester_hash.to_string())
        .expect("jester hash must appear in array");
    let pos_3 = array_content.rfind('3').unwrap();
    assert!(
        pos_1 < pos_hash,
        "element 1 must precede hash element in array"
    );
    assert!(
        pos_hash < pos_3,
        "hash element must precede element 3 in array"
    );
}

// ---------------------------------------------------------------------------
// Test 12: Multiple ### fields all hash correctly
// ---------------------------------------------------------------------------

#[test]
fn multiple_hash_prefix_fields_all_hash_correctly() {
    let json = r####"{
        "__revision_dont_touch": 1,
        "base_root": {
            "class_a": "###jester",
            "class_b": "###hellion",
            "class_c": "###plague_doctor"
        }
    }"####;
    let file = from_json(json);
    let out = to_json_str(&file, true);

    let jester_hash = name_hash("jester").to_string();
    let hellion_hash = name_hash("hellion").to_string();
    let plague_doctor_hash = name_hash("plague_doctor").to_string();

    assert!(
        out.contains(&jester_hash),
        "'###jester' must hash to {jester_hash}; output was:\n{out}"
    );
    assert!(
        out.contains(&hellion_hash),
        "'###hellion' must hash to {hellion_hash}; output was:\n{out}"
    );
    assert!(
        out.contains(&plague_doctor_hash),
        "'###plague_doctor' must hash to {plague_doctor_hash}; output was:\n{out}"
    );

    // None of the original ### strings must appear in the output (no Unhasher).
    assert!(
        !out.contains("###"),
        "without Unhasher, no '###' prefix must appear; output was:\n{out}"
    );
}

// ---------------------------------------------------------------------------
// Test 13: name_hash function - known values and determinism
// ---------------------------------------------------------------------------

#[test]
fn name_hash_known_values_and_determinism() {
    // Empty string -> fold returns initial accumulator.
    assert_eq!(name_hash(""), 0, "name_hash(\"\") must equal 0");

    // "a" -> 0 * 53 + 97 = 97.
    assert_eq!(name_hash("a"), 97, "name_hash(\"a\") must equal 97");

    // Known constant from the library documentation.
    assert_eq!(
        name_hash("jester"),
        -2_101_527_251_i32,
        "name_hash(\"jester\") must equal -2101527251"
    );

    // Determinism: two calls with the same input must return the same value.
    let first = name_hash("some_arbitrary_name");
    let second = name_hash("some_arbitrary_name");
    assert_eq!(first, second, "name_hash must be deterministic");

    // Determinism for jester specifically.
    assert_eq!(
        name_hash("jester"),
        name_hash("jester"),
        "name_hash(\"jester\") must return the same value on repeated calls"
    );
}

// ===========================================================================
// __revision_dont_touch POSITIONING
// ===========================================================================

// ---------------------------------------------------------------------------
// Test 14: Revision BEFORE root (standard order) parses successfully
// ---------------------------------------------------------------------------

#[test]
fn revision_before_root_parses_and_value_correct() {
    let json = r#"{ "__revision_dont_touch": 42, "base_root": { "x": 1 } }"#;
    let file = from_json(json);
    let out = to_json_str(&file, true);

    assert!(
        out.contains("42"),
        "revision value 42 must appear in output; output was:\n{out}"
    );
}

// ---------------------------------------------------------------------------
// Test 15: Revision AFTER root parses successfully
// ---------------------------------------------------------------------------

#[test]
fn revision_after_root_parses_successfully() {
    let json = r#"{ "base_root": { "x": 1 }, "__revision_dont_touch": 42 }"#;
    // This must not panic or return an error.
    let file =
        File::try_from_json(json.as_bytes()).expect("revision after root must parse successfully");

    let out = to_json_str(&file, true);
    assert!(
        out.contains("42"),
        "revision value 42 must appear in output when revision was after root; output was:\n{out}"
    );
}

// ---------------------------------------------------------------------------
// Test 16: Output always puts revision FIRST regardless of input order
// ---------------------------------------------------------------------------

#[test]
fn output_always_places_revision_before_root() {
    // Parse with revision appearing AFTER the root field.
    let json = r#"{ "base_root": { "x": 1 }, "__revision_dont_touch": 99 }"#;
    let file = from_json(json);
    let out = to_json_str(&file, true);

    let revision_pos = out
        .find("__revision_dont_touch")
        .expect("__revision_dont_touch must appear in output");
    let root_pos = out
        .find("base_root")
        .expect("base_root must appear in output");

    assert!(
        revision_pos < root_pos,
        "__revision_dont_touch must appear before base_root in output, \
         but revision was at {revision_pos} and root was at {root_pos}; output was:\n{out}"
    );
}

// ---------------------------------------------------------------------------
// Test 17: Revision value 0 round-trips correctly
// ---------------------------------------------------------------------------

#[test]
fn revision_value_zero_round_trips() {
    let json = r#"{ "__revision_dont_touch": 0, "base_root": { "val": 7 } }"#;
    let file = from_json(json);

    // JSON round-trip.
    let out = to_json_str(&file, true);
    let reparsed = from_json(&out);
    let out2 = to_json_str(&reparsed, true);

    // The revision 0 must appear in both outputs.
    // Look for the revision followed by `: 0` since `: 0` is unambiguous as revision.
    assert!(
        out.contains("__revision_dont_touch"),
        "__revision_dont_touch must appear in first output"
    );
    assert!(
        out2.contains("__revision_dont_touch"),
        "__revision_dont_touch must appear in second output"
    );

    // Find the integer value immediately after the revision key.
    let rev_key = "__revision_dont_touch";
    let check_revision_zero = |s: &str| {
        let pos = s.find(rev_key).unwrap();
        let after = &s[pos + rev_key.len()..];
        let colon_pos = after.find(':').unwrap();
        let value_str = after[colon_pos + 1..].trim_start();
        value_str.starts_with('0')
    };

    assert!(
        check_revision_zero(&out),
        "revision 0 must be emitted as 0; output was:\n{out}"
    );
    assert!(
        check_revision_zero(&out2),
        "revision 0 must survive re-parse; output was:\n{out2}"
    );
}

// ---------------------------------------------------------------------------
// Test 18: Revision value u32::MAX (4294967295) round-trips correctly
// ---------------------------------------------------------------------------

#[test]
fn revision_value_u32_max_round_trips() {
    let json = r#"{ "__revision_dont_touch": 4294967295, "base_root": { "val": 1 } }"#;
    let file = from_json(json);

    let out = to_json_str(&file, true);
    assert!(
        out.contains("4294967295"),
        "revision u32::MAX (4294967295) must appear in output; output was:\n{out}"
    );

    // Re-parse and verify it survives the second pass.
    let reparsed = from_json(&out);
    let out2 = to_json_str(&reparsed, true);
    assert!(
        out2.contains("4294967295"),
        "revision u32::MAX must survive re-parse; output was:\n{out2}"
    );
}

// ===========================================================================
// ### NOT APPLIED TO StringVector FIELDS
// ===========================================================================

// ---------------------------------------------------------------------------
// Test 19: StringVector stores "###test" as a literal string, not a hash
// ---------------------------------------------------------------------------

#[test]
fn string_vector_preserves_hash_prefix_as_literal_string() {
    // goal_ids is a hardcoded StringVector field; "###test" must be stored as-is.
    let json = r####"{
        "__revision_dont_touch": 1,
        "base_root": { "goal_ids": ["###test", "plain"] }
    }"####;
    let file = from_json(json);
    let out = to_json_str(&file, true);

    // The literal string "###test" must appear in the JSON output.
    assert!(
        out.contains("\"###test\""),
        "StringVector must preserve '###test' as a literal string; output was:\n{out}"
    );

    // The integer hash of "test" must NOT appear as a value here.
    let test_hash = name_hash("test").to_string();
    // We check that the test_hash isn't present as a bare number in the array.
    // (The output is a string array, so no integer should appear inside it.)
    // We look for the array content to verify it contains strings only.
    let array_start = out.find('[').expect("must find '[' in output");
    let array_end = out[array_start..].find(']').unwrap() + array_start;
    let array_content = &out[array_start..=array_end];

    // The array content must not contain the numeric hash.
    assert!(
        !array_content.contains(&test_hash),
        "StringVector must not hash '###test'; hash {test_hash} must not appear in array; array was: {array_content}"
    );
}

// ===========================================================================
// name_hash WRAPPING (OVERFLOW)
// ===========================================================================

// ---------------------------------------------------------------------------
// Test 20: Hash of a long string that causes i32 wrapping – must be consistent
// ---------------------------------------------------------------------------

#[test]
fn name_hash_long_string_wraps_consistently() {
    // A string long enough to overflow i32 with the wrapping_mul(53) algorithm.
    let long_name = "a".repeat(200);

    let hash1 = name_hash(&long_name);
    let hash2 = name_hash(&long_name);

    assert_eq!(
        hash1, hash2,
        "name_hash must be consistent across calls for the same long input"
    );

    // Also verify the result is a valid i32 (always true by type, but confirms
    // no panic from wrapping arithmetic).
    let _ = i32::from(hash1 as i16); // just accesses the value without panic
                                     // The result could be any i32; we only require determinism.
    let hash3 = name_hash(&long_name);
    assert_eq!(
        hash1, hash3,
        "name_hash must be deterministic on third call too"
    );
}
