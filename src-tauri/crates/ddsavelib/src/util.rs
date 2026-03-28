use std::borrow::Cow;

/// Calculate the hash of a given string according to the DD hashing algorithm.
pub fn name_hash(s: &'_ str) -> i32 {
    s.bytes().fold(0i32, |acc, c| {
        acc.wrapping_mul(53).wrapping_add(i32::from(c))
    })
}

pub fn escape(arg: &str) -> Cow<'_, str> {
    if arg
        .chars()
        .any(|c| matches!(c, '\x08' | '\x0C' | '\n' | '\r' | '\t' | '\\' | '"'))
    {
        let mut s = String::new();
        for c in arg.chars() {
            match c {
                '\x08' => s.push_str("\\b"),
                '\x0C' => s.push_str("\\f"),
                '\n' => s.push_str("\\n"),
                '\r' => s.push_str("\\r"),
                '\t' => s.push_str("\\t"),
                '"' => s.push_str("\\\""),
                '\\' => s.push_str("\\\\"),
                _ => s.push(c),
            }
        }
        Cow::Owned(s)
    } else {
        Cow::Borrowed(arg)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_escape_backslash() {
        let input = r#"hello\world"#;
        let escaped = escape(input);
        assert_eq!(escaped.as_ref(), r#"hello\\world"#);
    }

    #[test]
    fn test_escape_all_sequences() {
        let input = "tab\there\nnewline\rcarriage\x08back\x0Cform\"quote\\backslash";
        let escaped = escape(input);
        assert!(escaped.contains("\\t"));
        assert!(escaped.contains("\\n"));
        assert!(escaped.contains("\\r"));
        assert!(escaped.contains("\\b"));
        assert!(escaped.contains("\\f"));
        assert!(escaped.contains("\\\""));
        assert!(escaped.contains("\\\\"));
    }
}
