/// Integration tests for `raw_data` and `static_save` embedded DSON file handling.
///
/// When the JSON parser encounters a field named `raw_data` or `static_save` whose
/// value is `{`, it recursively parses the content as a complete nested DSON file
/// (with its own `__revision_dont_touch` and root object). In binary, these are
/// length-prefixed embedded DSON blobs. These tests verify the full round-trip
/// behaviour for both paths.
use ddsavelib::{File, Unhasher};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Encode `file` to binary bytes.
fn to_bin(file: &File) -> Vec<u8> {
    let mut bin = Vec::new();
    file.write_to_bin(&mut bin)
        .expect("write_to_bin should not fail on a Vec");
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
// Test 1: raw_data basic – simple nested DSON
// ---------------------------------------------------------------------------

#[test]
fn raw_data_basic_nested_file() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "hero": {
                "raw_data": {
                    "__revision_dont_touch": 100,
                    "base_root": {
                        "hp": 5
                    }
                }
            }
        }
    }"#;

    let val = bin_roundtrip(json);

    // Outer revision survives.
    assert_eq!(
        val.get("__revision_dont_touch").and_then(|v| v.as_u64()),
        Some(1),
        "outer revision must be 1"
    );

    // Inner file content survives: hp = 5.
    let hp = val
        .get("base_root")
        .and_then(|v| v.get("hero"))
        .and_then(|v| v.get("raw_data"))
        .and_then(|v| v.get("base_root"))
        .and_then(|v| v.get("hp"))
        .and_then(|v| v.as_i64());
    assert_eq!(hp, Some(5), "inner hp field must survive as 5");

    // Inner revision survives.
    let inner_rev = val
        .get("base_root")
        .and_then(|v| v.get("hero"))
        .and_then(|v| v.get("raw_data"))
        .and_then(|v| v.get("__revision_dont_touch"))
        .and_then(|v| v.as_u64());
    assert_eq!(inner_rev, Some(100), "inner revision must survive as 100");
}

// ---------------------------------------------------------------------------
// Test 2: raw_data with multiple fields in inner file
// ---------------------------------------------------------------------------

#[test]
fn raw_data_multiple_inner_fields() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "actor": {
                "raw_data": {
                    "__revision_dont_touch": 50,
                    "base_root": {
                        "name": "hero_1",
                        "level": 3,
                        "alive": true
                    }
                }
            }
        }
    }"#;

    let val = bin_roundtrip(json);

    let inner_root = val
        .get("base_root")
        .and_then(|v| v.get("actor"))
        .and_then(|v| v.get("raw_data"))
        .and_then(|v| v.get("base_root"))
        .expect("inner base_root must exist");

    assert_eq!(
        inner_root.get("name").and_then(|v| v.as_str()),
        Some("hero_1"),
        "inner name field must survive"
    );
    assert_eq!(
        inner_root.get("level").and_then(|v| v.as_i64()),
        Some(3),
        "inner level field must survive as 3"
    );
    assert_eq!(
        inner_root.get("alive").and_then(|v| v.as_bool()),
        Some(true),
        "inner alive bool field must survive as true"
    );

    // Inner revision.
    let inner_rev = val
        .get("base_root")
        .and_then(|v| v.get("actor"))
        .and_then(|v| v.get("raw_data"))
        .and_then(|v| v.get("__revision_dont_touch"))
        .and_then(|v| v.as_u64());
    assert_eq!(inner_rev, Some(50), "inner revision must be 50");
}

// ---------------------------------------------------------------------------
// Test 3: raw_data with nested objects inside the inner file
// ---------------------------------------------------------------------------

#[test]
fn raw_data_nested_objects_in_inner_file() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "container": {
                "raw_data": {
                    "__revision_dont_touch": 7,
                    "base_root": {
                        "stats": {
                            "strength": 10,
                            "speed": 6
                        }
                    }
                }
            }
        }
    }"#;

    let val = bin_roundtrip(json);

    let stats = val
        .get("base_root")
        .and_then(|v| v.get("container"))
        .and_then(|v| v.get("raw_data"))
        .and_then(|v| v.get("base_root"))
        .and_then(|v| v.get("stats"))
        .expect("inner stats object must exist");

    assert_eq!(
        stats.get("strength").and_then(|v| v.as_i64()),
        Some(10),
        "inner strength must survive as 10"
    );
    assert_eq!(
        stats.get("speed").and_then(|v| v.as_i64()),
        Some(6),
        "inner speed must survive as 6"
    );
}

// ---------------------------------------------------------------------------
// Test 4: static_save triggers the same recursive parsing as raw_data
// ---------------------------------------------------------------------------

#[test]
fn static_save_basic_nested_file() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "hero": {
                "static_save": {
                    "__revision_dont_touch": 100,
                    "base_root": {
                        "hp": 5
                    }
                }
            }
        }
    }"#;

    let val = bin_roundtrip(json);

    // Inner revision survives.
    let inner_rev = val
        .get("base_root")
        .and_then(|v| v.get("hero"))
        .and_then(|v| v.get("static_save"))
        .and_then(|v| v.get("__revision_dont_touch"))
        .and_then(|v| v.as_u64());
    assert_eq!(
        inner_rev,
        Some(100),
        "static_save inner revision must survive as 100"
    );

    // Inner field survives.
    let hp = val
        .get("base_root")
        .and_then(|v| v.get("hero"))
        .and_then(|v| v.get("static_save"))
        .and_then(|v| v.get("base_root"))
        .and_then(|v| v.get("hp"))
        .and_then(|v| v.as_i64());
    assert_eq!(hp, Some(5), "static_save inner hp must survive as 5");
}

// ---------------------------------------------------------------------------
// Test 5: Independent revisions – outer 42, inner 100
// ---------------------------------------------------------------------------

#[test]
fn independent_revisions_outer_42_inner_100() {
    let json = r#"{
        "__revision_dont_touch": 42,
        "base_root": {
            "entity": {
                "raw_data": {
                    "__revision_dont_touch": 100,
                    "base_root": {
                        "value": 1
                    }
                }
            }
        }
    }"#;

    let val = bin_roundtrip(json);

    let outer_rev = val.get("__revision_dont_touch").and_then(|v| v.as_u64());
    assert_eq!(outer_rev, Some(42), "outer revision must be 42");

    let inner_rev = val
        .get("base_root")
        .and_then(|v| v.get("entity"))
        .and_then(|v| v.get("raw_data"))
        .and_then(|v| v.get("__revision_dont_touch"))
        .and_then(|v| v.as_u64());
    assert_eq!(
        inner_rev,
        Some(100),
        "inner revision must be 100, independent of outer"
    );
}

// ---------------------------------------------------------------------------
// Test 6: Independent revisions – outer 0, inner u32::MAX
// ---------------------------------------------------------------------------

#[test]
fn independent_revisions_outer_0_inner_u32_max() {
    let json = format!(
        r#"{{
        "__revision_dont_touch": 0,
        "base_root": {{
            "entity": {{
                "raw_data": {{
                    "__revision_dont_touch": {},
                    "base_root": {{
                        "flag": 1
                    }}
                }}
            }}
        }}
    }}"#,
        u32::MAX
    );

    let val = bin_roundtrip(&json);

    let outer_rev = val.get("__revision_dont_touch").and_then(|v| v.as_u64());
    assert_eq!(outer_rev, Some(0), "outer revision must be 0");

    let inner_rev = val
        .get("base_root")
        .and_then(|v| v.get("entity"))
        .and_then(|v| v.get("raw_data"))
        .and_then(|v| v.get("__revision_dont_touch"))
        .and_then(|v| v.as_u64());
    assert_eq!(
        inner_rev,
        Some(u32::MAX as u64),
        "inner revision must be u32::MAX, independent of outer"
    );
}

// ---------------------------------------------------------------------------
// Test 7: Sibling fields before and after raw_data in the same object
// ---------------------------------------------------------------------------

#[test]
fn sibling_fields_before_and_after_raw_data() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "before_field": 1,
            "hero": {
                "name": "test",
                "raw_data": {
                    "__revision_dont_touch": 10,
                    "base_root": {
                        "x": 1
                    }
                },
                "after_field": 2
            }
        }
    }"#;

    let val = bin_roundtrip(json);

    // Outer sibling field.
    let before = val
        .get("base_root")
        .and_then(|v| v.get("before_field"))
        .and_then(|v| v.as_i64());
    assert_eq!(before, Some(1), "before_field must survive as 1");

    // Fields inside the same object as raw_data.
    let hero = val
        .get("base_root")
        .and_then(|v| v.get("hero"))
        .expect("hero object must exist");

    assert_eq!(
        hero.get("name").and_then(|v| v.as_str()),
        Some("test"),
        "hero.name must survive as 'test'"
    );
    assert_eq!(
        hero.get("after_field").and_then(|v| v.as_i64()),
        Some(2),
        "after_field must survive as 2"
    );

    // Inner embedded file field.
    let x = hero
        .get("raw_data")
        .and_then(|v| v.get("base_root"))
        .and_then(|v| v.get("x"))
        .and_then(|v| v.as_i64());
    assert_eq!(x, Some(1), "inner x must survive as 1");
}

// ---------------------------------------------------------------------------
// Test 8: Nested embedded files (DSON within DSON within DSON)
// ---------------------------------------------------------------------------

#[test]
fn nested_embedded_files_three_levels_deep() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "outer": {
                "raw_data": {
                    "__revision_dont_touch": 2,
                    "base_root": {
                        "inner": {
                            "raw_data": {
                                "__revision_dont_touch": 3,
                                "base_root": {
                                    "deepest": 999
                                }
                            }
                        }
                    }
                }
            }
        }
    }"#;

    let val = bin_roundtrip(json);

    // Outer revision.
    assert_eq!(
        val.get("__revision_dont_touch").and_then(|v| v.as_u64()),
        Some(1),
        "outermost revision must be 1"
    );

    // Middle (level-2) embedded file revision.
    let mid_rev = val
        .get("base_root")
        .and_then(|v| v.get("outer"))
        .and_then(|v| v.get("raw_data"))
        .and_then(|v| v.get("__revision_dont_touch"))
        .and_then(|v| v.as_u64());
    assert_eq!(mid_rev, Some(2), "mid-level revision must be 2");

    // Innermost (level-3) embedded file revision.
    let inner_rev = val
        .get("base_root")
        .and_then(|v| v.get("outer"))
        .and_then(|v| v.get("raw_data"))
        .and_then(|v| v.get("base_root"))
        .and_then(|v| v.get("inner"))
        .and_then(|v| v.get("raw_data"))
        .and_then(|v| v.get("__revision_dont_touch"))
        .and_then(|v| v.as_u64());
    assert_eq!(inner_rev, Some(3), "innermost revision must be 3");

    // Deepest value.
    let deepest = val
        .get("base_root")
        .and_then(|v| v.get("outer"))
        .and_then(|v| v.get("raw_data"))
        .and_then(|v| v.get("base_root"))
        .and_then(|v| v.get("inner"))
        .and_then(|v| v.get("raw_data"))
        .and_then(|v| v.get("base_root"))
        .and_then(|v| v.get("deepest"))
        .and_then(|v| v.as_i64());
    assert_eq!(deepest, Some(999), "deepest value must survive as 999");
}

// ---------------------------------------------------------------------------
// Test 9: Empty inner root in raw_data
// ---------------------------------------------------------------------------

#[test]
fn raw_data_with_empty_inner_root() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "empty_embed": {
                "raw_data": {
                    "__revision_dont_touch": 1,
                    "base_root": {}
                }
            }
        }
    }"#;

    let val = bin_roundtrip(json);

    // The raw_data object must exist.
    let raw_data = val
        .get("base_root")
        .and_then(|v| v.get("empty_embed"))
        .and_then(|v| v.get("raw_data"))
        .expect("raw_data must exist after round-trip");

    assert!(raw_data.is_object(), "raw_data must be an object");

    // Inner revision.
    assert_eq!(
        raw_data
            .get("__revision_dont_touch")
            .and_then(|v| v.as_u64()),
        Some(1),
        "inner revision must be 1"
    );

    // Inner base_root must be empty object.
    let inner_root = raw_data
        .get("base_root")
        .expect("inner base_root must exist");
    assert!(inner_root.is_object(), "inner base_root must be an object");
    assert_eq!(
        inner_root.as_object().unwrap().len(),
        0,
        "inner base_root must be empty"
    );
}

// ---------------------------------------------------------------------------
// Test 10: Binary round-trip byte-for-byte equality for embedded files
// ---------------------------------------------------------------------------

#[test]
fn raw_data_binary_double_roundtrip_byte_identical() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "hero": {
                "raw_data": {
                    "__revision_dont_touch": 100,
                    "base_root": {
                        "hp": 5
                    }
                }
            }
        }
    }"#;

    let file1 = from_json(json);
    let bin1 = to_bin(&file1);

    // Second encode from the decoded binary.
    let file2 = from_bin(&bin1);
    let bin2 = to_bin(&file2);

    assert_eq!(
        bin1, bin2,
        "binary output must be byte-for-byte identical after JSON->bin->bin"
    );
}

#[test]
fn static_save_binary_double_roundtrip_byte_identical() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "hero": {
                "static_save": {
                    "__revision_dont_touch": 55,
                    "base_root": {
                        "level": 3
                    }
                }
            }
        }
    }"#;

    let file1 = from_json(json);
    let bin1 = to_bin(&file1);

    let file2 = from_bin(&bin1);
    let bin2 = to_bin(&file2);

    assert_eq!(
        bin1, bin2,
        "static_save binary output must be byte-for-byte identical after double round-trip"
    );
}

#[test]
fn nested_embedded_files_binary_double_roundtrip_byte_identical() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "outer": {
                "raw_data": {
                    "__revision_dont_touch": 2,
                    "base_root": {
                        "inner": {
                            "raw_data": {
                                "__revision_dont_touch": 3,
                                "base_root": {
                                    "deepest": 999
                                }
                            }
                        }
                    }
                }
            }
        }
    }"#;

    let file1 = from_json(json);
    let bin1 = to_bin(&file1);

    let file2 = from_bin(&bin1);
    let bin2 = to_bin(&file2);

    assert_eq!(
        bin1, bin2,
        "three-level nested embedded file binary must be byte-for-byte identical after double round-trip"
    );
}

#[test]
fn empty_inner_root_binary_double_roundtrip_byte_identical() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "thing": {
                "raw_data": {
                    "__revision_dont_touch": 1,
                    "base_root": {}
                }
            }
        }
    }"#;

    let file1 = from_json(json);
    let bin1 = to_bin(&file1);

    let file2 = from_bin(&bin1);
    let bin2 = to_bin(&file2);

    assert_eq!(
        bin1, bin2,
        "empty inner root binary output must be byte-for-byte identical after double round-trip"
    );
}

#[test]
fn json_then_binary_then_json_then_binary_all_match() {
    // JSON -> bin1 -> JSON -> bin2: bin1 must equal bin2.
    let json = r#"{
        "__revision_dont_touch": 42,
        "base_root": {
            "hero": {
                "raw_data": {
                    "__revision_dont_touch": 7,
                    "base_root": {
                        "strength": 12,
                        "alive": true,
                        "name": "test_hero"
                    }
                }
            }
        }
    }"#;

    let file1 = from_json(json);
    let bin1 = to_bin(&file1);

    // Decode bin1 to JSON text, then re-parse that JSON text.
    let unhash = Unhasher::<&str>::empty();
    let mut json2_bytes = Vec::new();
    file1
        .write_to_json(&mut json2_bytes, true, &unhash)
        .expect("write_to_json must not fail");

    let file2 = File::try_from_json(&*json2_bytes).expect("re-parsing JSON output must succeed");
    let bin2 = to_bin(&file2);

    assert_eq!(
        bin1, bin2,
        "JSON->bin->JSON->bin must produce identical binary"
    );
}

// ---------------------------------------------------------------------------
// Test 11: Bridge API (to_json_value) – raw_data appears as nested JSON object
// ---------------------------------------------------------------------------

#[test]
fn bridge_api_raw_data_appears_as_nested_object_with_revision() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "hero": {
                "raw_data": {
                    "__revision_dont_touch": 77,
                    "base_root": {
                        "level": 5
                    }
                }
            }
        }
    }"#;

    let file = from_json(json);
    let val = to_value(&file);

    // raw_data must appear as a nested object (not as opaque bytes or null).
    let raw_data = val
        .get("base_root")
        .and_then(|v| v.get("hero"))
        .and_then(|v| v.get("raw_data"))
        .expect("raw_data must be present in to_json_value output");

    assert!(
        raw_data.is_object(),
        "raw_data must be a JSON object in to_json_value output"
    );

    // Inner revision.
    assert_eq!(
        raw_data
            .get("__revision_dont_touch")
            .and_then(|v| v.as_u64()),
        Some(77),
        "inner __revision_dont_touch must be 77"
    );

    // Inner base_root.
    let inner_root = raw_data
        .get("base_root")
        .expect("inner base_root must exist in to_json_value output");
    assert_eq!(
        inner_root.get("level").and_then(|v| v.as_i64()),
        Some(5),
        "inner level must be 5"
    );
}

// ---------------------------------------------------------------------------
// Test 12: Bridge API round-trip – to_json_value -> from_json_value -> to_json_value
// ---------------------------------------------------------------------------

#[test]
fn bridge_api_to_from_to_json_value_idempotent() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "actor": {
                "raw_data": {
                    "__revision_dont_touch": 33,
                    "base_root": {
                        "hp": 99,
                        "dead": false
                    }
                }
            }
        }
    }"#;

    let file1 = from_json(json);
    let val1 = to_value(&file1);

    // Re-parse from the serde_json::Value.
    let file2 = File::from_json_value(&val1).expect("from_json_value should succeed");
    let val2 = to_value(&file2);

    // Top-level revision must match.
    assert_eq!(
        val1.get("__revision_dont_touch"),
        val2.get("__revision_dont_touch"),
        "outer revision must be identical after to->from->to round-trip"
    );

    // Inner revision must match.
    let inner_rev1 = val1
        .get("base_root")
        .and_then(|v| v.get("actor"))
        .and_then(|v| v.get("raw_data"))
        .and_then(|v| v.get("__revision_dont_touch"));
    let inner_rev2 = val2
        .get("base_root")
        .and_then(|v| v.get("actor"))
        .and_then(|v| v.get("raw_data"))
        .and_then(|v| v.get("__revision_dont_touch"));
    assert_eq!(
        inner_rev1, inner_rev2,
        "inner revision must be identical after to->from->to round-trip"
    );

    // Inner fields must match.
    let hp1 = val1
        .get("base_root")
        .and_then(|v| v.get("actor"))
        .and_then(|v| v.get("raw_data"))
        .and_then(|v| v.get("base_root"))
        .and_then(|v| v.get("hp"));
    let hp2 = val2
        .get("base_root")
        .and_then(|v| v.get("actor"))
        .and_then(|v| v.get("raw_data"))
        .and_then(|v| v.get("base_root"))
        .and_then(|v| v.get("hp"));
    assert_eq!(
        hp1, hp2,
        "inner hp must be identical after to->from->to round-trip"
    );

    let dead1 = val1
        .get("base_root")
        .and_then(|v| v.get("actor"))
        .and_then(|v| v.get("raw_data"))
        .and_then(|v| v.get("base_root"))
        .and_then(|v| v.get("dead"));
    let dead2 = val2
        .get("base_root")
        .and_then(|v| v.get("actor"))
        .and_then(|v| v.get("raw_data"))
        .and_then(|v| v.get("base_root"))
        .and_then(|v| v.get("dead"));
    assert_eq!(
        dead1, dead2,
        "inner dead bool must be identical after to->from->to round-trip"
    );
}

#[test]
fn bridge_api_to_from_to_json_value_full_equality() {
    // Stricter check: the entire serde_json::Value must compare equal.
    let json = r#"{
        "__revision_dont_touch": 5,
        "base_root": {
            "slot": {
                "raw_data": {
                    "__revision_dont_touch": 8,
                    "base_root": {
                        "xp": 200
                    }
                }
            }
        }
    }"#;

    let file1 = from_json(json);
    let val1 = to_value(&file1);

    let file2 = File::from_json_value(&val1).expect("from_json_value should succeed");
    let val2 = to_value(&file2);

    assert_eq!(
        val1, val2,
        "to_json_value output must be fully equal after from_json_value round-trip"
    );
}

// ---------------------------------------------------------------------------
// Test 13: Multiple raw_data fields in different objects
// ---------------------------------------------------------------------------

#[test]
fn multiple_raw_data_fields_in_different_objects() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "hero_a": {
                "raw_data": {
                    "__revision_dont_touch": 10,
                    "base_root": {
                        "hp": 20
                    }
                }
            },
            "hero_b": {
                "raw_data": {
                    "__revision_dont_touch": 20,
                    "base_root": {
                        "hp": 30
                    }
                }
            }
        }
    }"#;

    let val = bin_roundtrip(json);

    // hero_a inner hp.
    let hp_a = val
        .get("base_root")
        .and_then(|v| v.get("hero_a"))
        .and_then(|v| v.get("raw_data"))
        .and_then(|v| v.get("base_root"))
        .and_then(|v| v.get("hp"))
        .and_then(|v| v.as_i64());
    assert_eq!(hp_a, Some(20), "hero_a inner hp must survive as 20");

    // hero_a inner revision.
    let rev_a = val
        .get("base_root")
        .and_then(|v| v.get("hero_a"))
        .and_then(|v| v.get("raw_data"))
        .and_then(|v| v.get("__revision_dont_touch"))
        .and_then(|v| v.as_u64());
    assert_eq!(rev_a, Some(10), "hero_a inner revision must be 10");

    // hero_b inner hp.
    let hp_b = val
        .get("base_root")
        .and_then(|v| v.get("hero_b"))
        .and_then(|v| v.get("raw_data"))
        .and_then(|v| v.get("base_root"))
        .and_then(|v| v.get("hp"))
        .and_then(|v| v.as_i64());
    assert_eq!(hp_b, Some(30), "hero_b inner hp must survive as 30");

    // hero_b inner revision.
    let rev_b = val
        .get("base_root")
        .and_then(|v| v.get("hero_b"))
        .and_then(|v| v.get("raw_data"))
        .and_then(|v| v.get("__revision_dont_touch"))
        .and_then(|v| v.as_u64());
    assert_eq!(rev_b, Some(20), "hero_b inner revision must be 20");

    // The two embedded files must be independent: different revisions and hp values.
    assert_ne!(hp_a, hp_b, "the two heroes must have different hp values");
    assert_ne!(
        rev_a, rev_b,
        "the two embedded files must have different revisions"
    );
}

#[test]
fn multiple_raw_data_fields_binary_double_roundtrip_byte_identical() {
    let json = r#"{
        "__revision_dont_touch": 1,
        "base_root": {
            "hero_a": {
                "raw_data": {
                    "__revision_dont_touch": 10,
                    "base_root": {
                        "hp": 20
                    }
                }
            },
            "hero_b": {
                "raw_data": {
                    "__revision_dont_touch": 20,
                    "base_root": {
                        "hp": 30
                    }
                }
            }
        }
    }"#;

    let file1 = from_json(json);
    let bin1 = to_bin(&file1);

    let file2 = from_bin(&bin1);
    let bin2 = to_bin(&file2);

    assert_eq!(
        bin1, bin2,
        "multiple raw_data fields binary output must be byte-for-byte identical after double round-trip"
    );
}
