//! S-expression reader. Produces heap values; records byte spans of top-level forms so the
//! editor can highlight errors and the radial menu can ask "which form is the cursor in".

use crate::heap::{Cell, Heap};
use crate::value::{err, Result, SchemeError, Value};

pub struct Reader<'a> {
    src: &'a str,
    pos: usize,
}

#[derive(Debug, Clone)]
pub struct Datum {
    pub value: Value,
    pub span: (usize, usize),
}

impl<'a> Reader<'a> {
    pub fn new(src: &'a str) -> Self {
        Reader { src, pos: 0 }
    }

    pub fn read_all(&mut self, heap: &mut Heap) -> Result<Vec<Datum>> {
        let mut out = Vec::new();
        loop {
            self.skip_ws();
            if self.pos >= self.src.len() {
                return Ok(out);
            }
            let start = self.pos;
            let value = self.read(heap)?;
            out.push(Datum { value, span: (start, self.pos) });
        }
    }

    fn peek(&self) -> Option<char> {
        self.src[self.pos..].chars().next()
    }
    fn bump(&mut self) -> Option<char> {
        let c = self.peek()?;
        self.pos += c.len_utf8();
        Some(c)
    }

    fn skip_ws(&mut self) {
        while let Some(c) = self.peek() {
            if c.is_whitespace() {
                self.bump();
            } else if c == ';' {
                while let Some(c) = self.bump() {
                    if c == '\n' {
                        break;
                    }
                }
            } else if self.src[self.pos..].starts_with("#|") {
                let mut depth = 0;
                while self.pos < self.src.len() {
                    if self.src[self.pos..].starts_with("#|") {
                        depth += 1;
                        self.pos += 2;
                    } else if self.src[self.pos..].starts_with("|#") {
                        depth -= 1;
                        self.pos += 2;
                        if depth == 0 {
                            break;
                        }
                    } else {
                        self.bump();
                    }
                }
            } else {
                break;
            }
        }
    }

    fn fail<T>(&self, msg: &str, start: usize) -> Result<T> {
        Err(SchemeError { message: msg.to_string(), irritants: vec![], span: Some((start, self.pos)) })
    }

    pub fn read(&mut self, heap: &mut Heap) -> Result<Value> {
        self.skip_ws();
        let start = self.pos;
        match self.peek() {
            None => self.fail("Unexpected end of input", start),
            Some('(') | Some('[') => {
                let close = if self.bump() == Some('(') { ')' } else { ']' };
                let mut items = Vec::new();
                let mut tail = Value::Nil;
                loop {
                    self.skip_ws();
                    match self.peek() {
                        None => return self.fail("Unbalanced parentheses", start),
                        Some(c) if c == close => {
                            self.bump();
                            break;
                        }
                        Some('.') if self.is_delim_at(self.pos + 1) => {
                            self.bump();
                            tail = self.read(heap)?;
                            self.skip_ws();
                            if self.bump() != Some(close) {
                                return self.fail("Bad dotted list", start);
                            }
                            break;
                        }
                        Some(_) => items.push(self.read(heap)?),
                    }
                }
                let mut acc = tail;
                for v in items.into_iter().rev() {
                    acc = heap.cons(v, acc);
                }
                Ok(acc)
            }
            Some(')') | Some(']') => {
                self.bump();
                self.fail("Unexpected closing parenthesis", start)
            }
            Some('\'') => self.read_abbrev(heap, "quote"),
            Some('`') => self.read_abbrev(heap, "quasiquote"),
            Some(',') => {
                if self.src[self.pos..].starts_with(",@") {
                    self.bump();
                    self.read_abbrev(heap, "unquote-splicing")
                } else {
                    self.read_abbrev(heap, "unquote")
                }
            }
            Some('"') => {
                self.bump();
                let mut s = String::new();
                loop {
                    match self.bump() {
                        None => return self.fail("Unterminated string", start),
                        Some('"') => break,
                        Some('\\') => match self.bump() {
                            Some('n') => s.push('\n'),
                            Some('t') => s.push('\t'),
                            Some(c) => s.push(c),
                            None => return self.fail("Unterminated string", start),
                        },
                        Some(c) => s.push(c),
                    }
                }
                Ok(Value::Str(heap.alloc(Cell::Str(s))))
            }
            Some('#') => {
                let tok = self.read_token();
                match tok.as_str() {
                    "#t" | "#true" => Ok(Value::Bool(true)),
                    "#f" | "#false" => Ok(Value::Bool(false)),
                    _ => self.fail(&format!("Unknown syntax {}", tok), start),
                }
            }
            Some(_) => {
                let tok = self.read_token();
                Ok(parse_atom(&tok, heap))
            }
        }
    }

    fn read_abbrev(&mut self, heap: &mut Heap, name: &str) -> Result<Value> {
        self.bump();
        let inner = self.read(heap)?;
        let sym = Value::Sym(heap.intern(name));
        Ok(heap.list(&[sym, inner]))
    }

    fn is_delim_at(&self, p: usize) -> bool {
        match self.src[p.min(self.src.len())..].chars().next() {
            None => true,
            Some(c) => c.is_whitespace() || "()[]\";".contains(c),
        }
    }

    fn read_token(&mut self) -> String {
        let start = self.pos;
        while let Some(c) = self.peek() {
            if c.is_whitespace() || "()[]\";".contains(c) {
                break;
            }
            self.bump();
        }
        self.src[start..self.pos].to_string()
    }
}

pub fn parse_atom(tok: &str, heap: &mut Heap) -> Value {
    if let Ok(i) = tok.parse::<i64>() {
        return Value::Int(i);
    }
    if let Ok(b) = tok.parse::<num_bigint::BigInt>() {
        return Value::Big(heap.alloc(Cell::Big(b)));
    }
    if let Some((n, d)) = tok.split_once('/') {
        if let (Ok(n), Ok(d)) = (n.parse::<num_bigint::BigInt>(), d.parse::<num_bigint::BigInt>()) {
            if d != num_bigint::BigInt::from(0) {
                return crate::prims::make_rational(heap, num_rational::BigRational::new(n, d));
            }
        }
    }
    if let Ok(f) = tok.parse::<f64>() {
        if tok.chars().any(|c| c == '.' || c == 'e' || c == 'E') {
            return Value::Real(f);
        }
    }
    Value::Sym(heap.intern(&tok.to_lowercase()))
}

/// Innermost form containing `cursor`, for the editor's context-sensitive menu.
/// Returns (head symbol or "", depth, span). Pure text scan; tolerant of unbalanced input.
pub fn form_at(src: &str, cursor: usize) -> (String, usize, (usize, usize)) {
    let bytes = src.as_bytes();
    let mut stack: Vec<usize> = Vec::new();
    let mut in_str = false;
    let mut i = 0;
    let cursor = cursor.min(bytes.len());
    while i < cursor {
        let c = bytes[i];
        if in_str {
            if c == b'\\' {
                i += 1;
            } else if c == b'"' {
                in_str = false;
            }
        } else if c == b'"' {
            in_str = true;
        } else if c == b';' {
            while i < cursor && bytes[i] != b'\n' {
                i += 1;
            }
        } else if c == b'(' || c == b'[' {
            stack.push(i);
        } else if c == b')' || c == b']' {
            stack.pop();
        }
        i += 1;
    }
    let depth = stack.len();
    match stack.last() {
        None => (String::new(), 0, (0, src.len())),
        Some(&open) => {
            let rest = &src[open + 1..];
            let head: String = rest
                .trim_start()
                .chars()
                .take_while(|c| !c.is_whitespace() && !"()[]".contains(*c))
                .collect();
            let mut d = 0usize;
            let mut end = src.len();
            for (j, ch) in src[open..].char_indices() {
                match ch {
                    '(' | '[' => d += 1,
                    ')' | ']' => {
                        d -= 1;
                        if d == 0 {
                            end = open + j + 1;
                            break;
                        }
                    }
                    _ => {}
                }
            }
            (head, depth, (open, end))
        }
    }
}

#[allow(dead_code)]
fn _unused(_: SchemeError) {
    let _ = err::<()>("");
}
