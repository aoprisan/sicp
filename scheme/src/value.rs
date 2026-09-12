use std::fmt;

/// Handle into the arena heap.
pub type Idx = u32;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Value {
    Nil,
    Bool(bool),
    Int(i64),
    Big(Idx),
    Rat(Idx),
    Real(f64),
    Sym(Idx),
    Str(Idx),
    Pair(Idx),
    Closure(Idx),
    Prim(u16),
    Promise(Idx),
    Env(Idx),
    Cont(Idx),
    Picture(Idx),
    Vector(Idx),
    Unspecified,
    Eof,
}

impl Value {
    pub fn is_true(self) -> bool { !matches!(self, Value::Bool(false)) }
    pub fn is_heap(self) -> Option<Idx> {
        match self {
            Value::Big(i) | Value::Rat(i) | Value::Str(i) | Value::Pair(i) | Value::Closure(i)
            | Value::Promise(i) | Value::Env(i) | Value::Cont(i) | Value::Picture(i)
            | Value::Vector(i) => Some(i),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SchemeError {
    pub message: String,
    pub irritants: Vec<String>,
    pub span: Option<(usize, usize)>,
}

impl fmt::Display for SchemeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, ";{}", self.message)?;
        for i in &self.irritants { write!(f, " {}", i)?; }
        Ok(())
    }
}

pub type Result<T> = std::result::Result<T, SchemeError>;

pub fn err<T>(msg: impl Into<String>) -> Result<T> {
    Err(SchemeError { message: msg.into(), irritants: vec![], span: None })
}
