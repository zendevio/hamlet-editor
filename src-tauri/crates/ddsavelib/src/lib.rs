//! A library to decode and encode the binary Darkest Dungeon save file format.
//!
//! The library can convert between the binary representation used by the game
//! and a JSON representation.
//!
//! The [`File`] type represents a Darkest Dungeon save file. An [`Unhasher`]
//! containing game data names can be provided to the File to JSON conversion
//! to make save files more easily legible and editable. [`name_hash`] is a utility
//! to calculate the hash of a string according to the DD hashing algorithm.
//!
//! ```rust
//! use ddsavelib::{File, Unhasher};
//!
//! let json = r#"{ "__revision_dont_touch": 12345,
//!                 "base_root": { "soldier_class": -2101527251 }
//!            }"#;
//!
//! // Read the JSON file
//! let file1 = File::try_from_json(&mut json.as_bytes()).unwrap();
//!
//! // Convert to binary
//! let mut bin_data = Vec::new();
//! file1.write_to_bin(&mut bin_data).unwrap();
//!
//! // Realize we know Jester is a class
//! let mut unhash = Unhasher::empty();
//! unhash.offer_name("jester");
//!
//! // Convert to JSON
//! let mut json_data = Vec::new();
//! let file2 = File::try_from_bin(&mut &*bin_data).unwrap();
//! file2.write_to_json(&mut json_data, true, &unhash).unwrap();
//! let output_str = std::str::from_utf8(&json_data).unwrap().replace(" ", "").replace("\n", "");
//!
//! // We even managed to unhash Jester!
//! assert_eq!(&*output_str,
//!   r####"{"__revision_dont_touch":12345,"base_root":{"soldier_class":"###jester"}}"####);
//!
//! // The library performs verification of the input and doesn't panic.
//! let mut garbage_data: &[u8] = &[0u8, 50u8, 145u8, 2u8];
//! assert!(File::try_from_bin(&mut garbage_data).is_err());
//! ```
//!
//! Darkest Dungeon save files usually have a `base_root` root field. The `__revision_dont_touch`
//! field is inserted and expected by the library, as this is the single header field that cannot
//! be deduced from the files' contents.
//!
//! ## Features
//!
//! * `string_cache` (default: yes): Uses the `string_cache` crate to intern strings, yielding a
//! performance boost for decoding binary files.

pub mod err;
mod file;
mod util;

pub use file::{File, Unhasher};
pub use util::name_hash;

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal valid save JSON used as a fixture throughout the tests.
    fn simple_json() -> &'static str {
        r#"{
            "__revision_dont_touch": 42,
            "base_root": {
                "soldier_class": -2101527251,
                "resolve_level": 3
            }
        }"#
    }

    // ── json → File ────────────────────────────────────────────────────────

    #[test]
    fn parse_simple_json_succeeds() {
        let file = File::try_from_json(simple_json().as_bytes()).expect("parse should succeed");
        // Write back to JSON and verify the revision field survives.
        let mut out = Vec::new();
        let unhash = Unhasher::<&str>::empty();
        file.write_to_json(&mut out, true, &unhash).unwrap();
        let s = std::str::from_utf8(&out).unwrap();
        assert!(s.contains("42"), "revision field should be present");
    }

    // ── json → binary → json round-trip ───────────────────────────────────

    #[test]
    fn json_binary_json_roundtrip() {
        let file1 = File::try_from_json(simple_json().as_bytes()).expect("parse should succeed");

        // Encode to binary.
        let mut bin = Vec::new();
        file1.write_to_bin(&mut bin).expect("binary write should succeed");
        assert!(!bin.is_empty(), "binary output must not be empty");

        // Decode from binary.
        let file2 = File::try_from_bin(&mut bin.as_slice()).expect("binary read should succeed");

        // Both decoded files should round-trip to JSON with the same field count.
        let unhash = Unhasher::<&str>::empty();
        let mut json1 = Vec::new();
        let mut json2 = Vec::new();
        file1.write_to_json(&mut json1, true, &unhash).unwrap();
        file2.write_to_json(&mut json2, true, &unhash).unwrap();

        let v1: serde_json::Value = serde_json::from_slice(&json1).unwrap();
        let v2: serde_json::Value = serde_json::from_slice(&json2).unwrap();

        // The top-level object must have the same keys.
        let keys1: std::collections::BTreeSet<_> = v1.as_object().unwrap().keys().collect();
        let keys2: std::collections::BTreeSet<_> = v2.as_object().unwrap().keys().collect();
        assert_eq!(keys1, keys2, "top-level field sets must match after round-trip");
    }

    // ── to_json_value / from_json_value bridge API ─────────────────────────

    #[test]
    fn to_json_value_produces_valid_value() {
        let file = File::try_from_json(simple_json().as_bytes()).unwrap();
        let unhash = Unhasher::<&str>::empty();
        let val = file.to_json_value(&unhash);
        assert!(val.is_object(), "to_json_value must return a JSON object");
        assert_eq!(
            val.get("__revision_dont_touch").and_then(|v| v.as_u64()),
            Some(42),
            "revision field must survive to_json_value"
        );
    }

    #[test]
    fn from_json_value_round_trips() {
        let file1 = File::try_from_json(simple_json().as_bytes()).unwrap();
        let unhash = Unhasher::<&str>::empty();
        let val = file1.to_json_value(&unhash);

        // Re-parse from the serde_json::Value.
        let file2 = File::from_json_value(&val).expect("from_json_value should succeed");
        let val2 = file2.to_json_value(&unhash);

        assert_eq!(
            val.get("__revision_dont_touch"),
            val2.get("__revision_dont_touch"),
            "revision field must be identical after from_json_value round-trip"
        );

        // Field counts must match.
        let obj1 = val.as_object().unwrap();
        let obj2 = val2.as_object().unwrap();
        assert_eq!(
            obj1.len(),
            obj2.len(),
            "top-level field count must be identical after from_json_value round-trip"
        );
    }

    // ── binary → File → json_value → File → binary round-trip ─────────────

    #[test]
    fn full_round_trip_binary_json_value_binary() {
        // Start from JSON → binary.
        let file1 = File::try_from_json(simple_json().as_bytes()).unwrap();
        let mut bin1 = Vec::new();
        file1.write_to_bin(&mut bin1).unwrap();

        // binary → File → json_value → File → binary
        let file2 = File::try_from_bin(&mut bin1.as_slice()).unwrap();
        let unhash = Unhasher::<&str>::empty();
        let val = file2.to_json_value(&unhash);
        let file3 = File::from_json_value(&val).unwrap();
        let mut bin2 = Vec::new();
        file3.write_to_bin(&mut bin2).unwrap();

        // Decode both binaries to JSON and compare field counts.
        let f_a = File::try_from_bin(&mut bin1.as_slice()).unwrap();
        let f_b = File::try_from_bin(&mut bin2.as_slice()).unwrap();
        let mut j_a = Vec::new();
        let mut j_b = Vec::new();
        f_a.write_to_json(&mut j_a, true, &unhash).unwrap();
        f_b.write_to_json(&mut j_b, true, &unhash).unwrap();

        let va: serde_json::Value = serde_json::from_slice(&j_a).unwrap();
        let vb: serde_json::Value = serde_json::from_slice(&j_b).unwrap();

        fn count_fields(v: &serde_json::Value) -> usize {
            match v {
                serde_json::Value::Object(m) => m.len() + m.values().map(count_fields).sum::<usize>(),
                serde_json::Value::Array(a) => a.iter().map(count_fields).sum(),
                _ => 0,
            }
        }

        assert_eq!(
            count_fields(&va),
            count_fields(&vb),
            "total field count must be identical after full round-trip"
        );
    }

    // ── garbage input is rejected without panic ────────────────────────────

    #[test]
    fn garbage_binary_returns_error() {
        let mut garbage: &[u8] = &[0u8, 50u8, 145u8, 2u8];
        assert!(
            File::try_from_bin(&mut garbage).is_err(),
            "garbage binary must not be accepted"
        );
    }

    #[test]
    fn garbage_json_returns_error() {
        let bad = b"this is not json";
        assert!(
            File::try_from_json(&bad[..]).is_err(),
            "garbage JSON must not be accepted"
        );
    }
}
