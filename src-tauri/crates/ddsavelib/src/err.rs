//! Provides the various errors that can occur when deserializing from Binary or JSON.
//!
//! Serializing should, save for I/O errors, always succeed. I/O errors can be avoided
//! by using [`Write`](std::io::Write) or [`Read`](std::io::Read) implementations that do not error (like memory buffers).

use thiserror::Error;

/// Errors that can occur when deserializing from Binary
#[derive(Debug, Error)]
pub enum FromBinError {
    /// An I/O error occured.
    #[error("I/O error: {0}")]
    IoError(#[from] std::io::Error),

    /// Magic number mismatched
    #[error("Not a DSON binary file (invalid magic number)")]
    NotBinFile,

    /// A field's type was not identified by looking up the hardcoded
    /// names or applying a heuristic.
    #[error("Unknown field type for '{0}'")]
    UnknownField(String),

    /// EOF
    #[error("Unexpected end of file")]
    Eof,

    /// A section of the file was not at the location specified
    /// in the header
    #[error("Offset mismatch: expected {exp}, got {is}")]
    OffsetMismatch { exp: u64, is: u64 },

    /// The hash of a field name mismatched the hash specified in the
    /// file.
    #[error("Hash mismatch for field name")]
    HashMismatch,

    /// A string did not contain valid UTF-8.
    #[error("Invalid UTF-8 in field: {0}")]
    Utf8Error(#[from] std::str::Utf8Error),

    /// A string was not NUL-terminated, or contained an interior
    /// NUL-character.
    #[error("Invalid null-terminated string: {0}")]
    FromBytesWithNulError(#[from] std::ffi::FromBytesWithNulError),

    /// A char field did not contain a single ASCII character.
    #[error("Invalid character value: 0x{0:02X}")]
    CharError(u8),

    /// Memory allocation to hold a collection's or string's elements failed.
    #[error("Memory allocation failed: {0}")]
    TryReserveError(#[from] std::collections::TryReserveError),

    /// The file did not contain a single root object.
    #[error("Missing root object")]
    MissingRoot,

    /// An arithmetic error, probably involving offsets, occured.
    #[error("Arithmetic overflow in offset calculation")]
    Arith,

    /// Generic Binary format error.
    #[error("Binary format error")]
    FormatErr,
}

/// Errors that can occur when deserializing from JSON
#[derive(Debug, Error)]
pub enum FromJsonError {
    /// An I/O error occured while writing.
    #[error("I/O error: {0}")]
    IoError(#[from] std::io::Error),

    /// At this location, a different token was expected.
    #[error("Expected {0} at {1}:{2}")]
    Expected(String, usize, usize),

    /// The literal did not conform to the restrictions of
    /// the save format.
    #[error("Invalid literal format '{0}' at {1}:{2}")]
    LiteralFormat(String, usize, usize),

    /// Invalid JSON syntax
    #[error("Invalid JSON syntax at {0}:{1}")]
    JsonErr(usize, usize),

    /// The file ended unexpectedly
    #[error("Unexpected end of file")]
    UnexpEof,

    /// We ran out of indices
    #[error("Integer overflow: too many fields or objects")]
    IntegerErr,

    /// An integer representing a size or offset was too large to be represented in the file
    #[error("Arithmetic overflow in size or offset calculation")]
    ArithError,

    /// The String contained invalid bare control characters.
    #[error("Encoding error '{0}' at {1}:{2}")]
    EncodingErr(String, usize, usize),

    /// A serde_json deserialization error.
    #[error("serde_json error: {0}")]
    SerdeJson(String),
}

// Custom: maps TryFromIntError to IntegerErr (source is discarded)
impl From<std::num::TryFromIntError> for FromJsonError {
    fn from(_: std::num::TryFromIntError) -> Self {
        Self::IntegerErr
    }
}

// Custom: maps Utf8Error to EncodingErr with position info extracted from the error
impl From<std::str::Utf8Error> for FromJsonError {
    fn from(err: std::str::Utf8Error) -> Self {
        let begin = err.valid_up_to();
        let end = begin + err.error_len().unwrap_or(1);
        Self::EncodingErr("not utf-8".to_owned(), begin, end)
    }
}
