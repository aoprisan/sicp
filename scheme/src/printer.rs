//! Prints values the way MIT Scheme does, because that is what readers compare against.
//!
//! Two representations, as in the report: `display` renders strings verbatim, `write` quotes and
//! escapes them. The REPL's `;Value:` line and error messages both use `write`, which is why it
//! is the default here (`(car "abc")` reports `The object "abc", ...`, with the quotes).

use crate::heap::{Cell, Heap};
use crate::value::Value;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mode {
    /// Strings verbatim, for the `display` primitive.
    Display,
    /// Strings quoted and escaped, for `write`, `;Value:` lines and error messages.
    Write,
}

/// `write` representation. This is what the REPL prints after `;Value: `.
pub fn print(heap: &Heap, v: Value) -> String {
    print_mode(heap, v, Mode::Write)
}

/// `display` representation.
pub fn display(heap: &Heap, v: Value) -> String {
    print_mode(heap, v, Mode::Display)
}

pub fn print_mode(heap: &Heap, v: Value, mode: Mode) -> String {
    let mut s = String::new();
    write(heap, v, &mut s, 0, mode);
    s
}

fn write(heap: &Heap, v: Value, out: &mut String, depth: usize, mode: Mode) {
    if depth > 10_000 {
        out.push_str("...");
        return;
    }
    match v {
        Value::Nil => out.push_str("()"),
        Value::Bool(true) => out.push_str("#t"),
        Value::Bool(false) => out.push_str("#f"),
        Value::Int(i) => out.push_str(&i.to_string()),
        Value::Big(i) => {
            if let Cell::Big(b) = heap.get(i) {
                out.push_str(&b.to_string());
            }
        }
        Value::Rat(i) => {
            if let Cell::Rat(r) = heap.get(i) {
                out.push_str(&format!("{}/{}", r.numer(), r.denom()));
            }
        }
        Value::Real(f) => out.push_str(&format_real(f)),
        Value::Sym(i) => out.push_str(heap.sym_name(i)),
        Value::Str(i) => {
            if let Cell::Str(s) = heap.get(i) {
                match mode {
                    Mode::Display => out.push_str(s),
                    Mode::Write => escape_string(s, out),
                }
            }
        }
        Value::Pair(_) => {
            out.push('(');
            let mut cur = v;
            let mut first = true;
            let mut count = 0;
            loop {
                match cur {
                    Value::Pair(i) => {
                        if !first {
                            out.push(' ');
                        }
                        first = false;
                        if let Cell::Pair(a, d) = heap.get(i) {
                            write(heap, *a, out, depth + 1, mode);
                            cur = *d;
                        }
                        count += 1;
                        if count > 100_000 {
                            out.push_str(" ...");
                            break;
                        }
                    }
                    Value::Nil => break,
                    other => {
                        out.push_str(" . ");
                        write(heap, other, out, depth + 1, mode);
                        break;
                    }
                }
            }
            out.push(')');
        }
        Value::Closure(i) => {
            if let Cell::Closure { name, .. } = heap.get(i) {
                match name {
                    Some(n) => out.push_str(&format!("#[compound-procedure {} {}]", i, heap.sym_name(*n))),
                    None => out.push_str(&format!("#[compound-procedure {}]", i)),
                }
            }
        }
        Value::Prim(p) => out.push_str(&format!("#[compiled-procedure {} {}]", p, crate::prims::prim_name(p))),
        Value::Promise(i) => out.push_str(&format!("#[promise {}]", i)),
        Value::Env(i) => out.push_str(&format!("#[environment {}]", i)),
        Value::Cont(i) => out.push_str(&format!("#[continuation {}]", i)),
        Value::Vector(i) => {
            out.push_str("#(");
            if let Cell::Vector(elems) = heap.get(i) {
                for (n, e) in elems.iter().enumerate() {
                    if n > 0 {
                        out.push(' ');
                    }
                    write(heap, *e, out, depth + 1, mode);
                }
            }
            out.push(')');
        }
        Value::Picture(i) => out.push_str(&format!("#[picture {}]", i)),
        // MIT has a distinct object here. Printing it as nothing made a one-element list of it
        // come out as `()`, so it needs a name even though the REPL reports it as
        // ";Unspecified return value" rather than as a value.
        Value::Unspecified => out.push_str("#!unspecific"),
        Value::Eof => out.push_str("#[eof]"),
    }
}

/// MIT writes `"a\"b"` for a string containing a quote; control characters use the usual escapes.
fn escape_string(s: &str, out: &mut String) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            '\r' => out.push_str("\\r"),
            _ => out.push(c),
        }
    }
    out.push('"');
}

/// MIT prints 3.0 as `3.`, 0.5 as `.5`, -0.25 as `-.25`.
pub fn format_real(f: f64) -> String {
    if f.is_nan() {
        return "+nan.0".into();
    }
    if f.is_infinite() {
        return if f > 0.0 { "+inf.0".into() } else { "-inf.0".into() };
    }
    if f == f.trunc() && f.abs() < 1e21 {
        return format!("{}.", f as i128);
    }
    let s = format!("{}", f);
    if let Some(rest) = s.strip_prefix("0.") {
        return format!(".{}", rest);
    }
    if let Some(rest) = s.strip_prefix("-0.") {
        return format!("-.{}", rest);
    }
    s
}
