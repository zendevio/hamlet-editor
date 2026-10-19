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
        .any(|c| c.is_control() || matches!(c, '\\' | '"'))
    {
        let mut s = String::new();
        for c in arg.chars() {
            match c {
                '"' => s.push_str("\\\""),
                '\\' => s.push_str("\\\\"),
                c if c.is_control() => {
                    use std::fmt::Write;
                    write!(&mut s, "\\u{:04x}", c as u32).unwrap();
                }
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
        assert!(escaped.contains("\\u0009"));
        assert!(escaped.contains("\\u000a"));
        assert!(escaped.contains("\\u000d"));
        assert!(escaped.contains("\\u0008"));
        assert!(escaped.contains("\\u000c"));
        assert!(escaped.contains("\\\""));
        assert!(escaped.contains("\\\\"));
    }
}
