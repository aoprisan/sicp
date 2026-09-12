//! sicp-scheme: a Scheme interpreter for the SICP dialect.
//!
//! Design: explicit-continuation (CEK) evaluator over an arena heap. No host recursion during
//! evaluation, proper tail calls, interruptible via a step budget. See docs/SPEC.md.

pub mod value;
pub mod heap;
pub mod reader;
pub mod printer;
pub mod eval;
pub mod prims;
pub mod session;

#[cfg(feature = "wasm")]
pub mod wasm;

pub use session::{Session, Status};
pub use value::Value;
