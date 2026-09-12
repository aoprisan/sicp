use crate::value::{Idx, Value};
use num_bigint::BigInt;
use num_rational::BigRational;
use std::collections::HashMap;

/// Continuation frames. Heap-allocated so `call/cc` and GC see them.
#[derive(Clone, Debug)]
pub enum Frame {
    /// Operator/operands being evaluated: values so far, remaining operand list, env.
    Args { done: Vec<Value>, rest: Value, env: Idx },
    IfK { conseq: Value, alt: Value, env: Idx },
    Seq { rest: Value, env: Idx },
    Define { name: Idx, env: Idx },
    Set { name: Idx, env: Idx },
    CondK { clauses: Value, env: Idx },
    AndK { rest: Value, env: Idx },
    OrK { rest: Value, env: Idx },
    LetK { names: Vec<Idx>, done: Vec<Value>, rest: Value, body: Value, env: Idx },
    Force { promise: Idx },
    Halt,
}

#[derive(Clone, Debug)]
pub enum Cell {
    Free(Option<Idx>),
    Pair(Value, Value),
    Str(String),
    Big(BigInt),
    Rat(BigRational),
    Closure { params: Vec<Idx>, rest: Option<Idx>, body: Value, env: Idx, name: Option<Idx> },
    Promise { forced: bool, value: Value, expr: Value, env: Idx },
    Env { vars: HashMap<Idx, Value>, parent: Option<Idx> },
    Kont { frame: Frame, next: Option<Idx> },
    Picture(Vec<u8>),
}

pub struct Heap {
    cells: Vec<Cell>,
    marks: Vec<bool>,
    free: Option<Idx>,
    allocs_since_gc: usize,
    pub gc_threshold: usize,
    symbols: Vec<String>,
    symtab: HashMap<String, Idx>,
}

impl Heap {
    pub fn new() -> Self {
        Heap {
            cells: Vec::new(),
            marks: Vec::new(),
            free: None,
            allocs_since_gc: 0,
            gc_threshold: 200_000,
            symbols: Vec::new(),
            symtab: HashMap::new(),
        }
    }

    pub fn intern(&mut self, s: &str) -> Idx {
        if let Some(&i) = self.symtab.get(s) {
            return i;
        }
        let i = self.symbols.len() as Idx;
        self.symbols.push(s.to_string());
        self.symtab.insert(s.to_string(), i);
        i
    }
    pub fn sym_name(&self, i: Idx) -> &str {
        &self.symbols[i as usize]
    }

    pub fn alloc(&mut self, c: Cell) -> Idx {
        self.allocs_since_gc += 1;
        if let Some(i) = self.free {
            if let Cell::Free(next) = self.cells[i as usize] {
                self.free = next;
            }
            self.cells[i as usize] = c;
            i
        } else {
            self.cells.push(c);
            self.marks.push(false);
            (self.cells.len() - 1) as Idx
        }
    }
    pub fn get(&self, i: Idx) -> &Cell {
        &self.cells[i as usize]
    }
    pub fn get_mut(&mut self, i: Idx) -> &mut Cell {
        &mut self.cells[i as usize]
    }

    pub fn cons(&mut self, a: Value, d: Value) -> Value {
        Value::Pair(self.alloc(Cell::Pair(a, d)))
    }
    pub fn car(&self, v: Value) -> Option<Value> {
        if let Value::Pair(i) = v {
            if let Cell::Pair(a, _) = self.get(i) {
                return Some(*a);
            }
        }
        None
    }
    pub fn cdr(&self, v: Value) -> Option<Value> {
        if let Value::Pair(i) = v {
            if let Cell::Pair(_, d) = self.get(i) {
                return Some(*d);
            }
        }
        None
    }
    pub fn list(&mut self, items: &[Value]) -> Value {
        let mut acc = Value::Nil;
        for v in items.iter().rev() {
            acc = self.cons(*v, acc);
        }
        acc
    }
    pub fn list_to_vec(&self, mut v: Value) -> Option<Vec<Value>> {
        let mut out = Vec::new();
        loop {
            match v {
                Value::Nil => return Some(out),
                Value::Pair(_) => {
                    out.push(self.car(v)?);
                    v = self.cdr(v)?;
                }
                _ => return None,
            }
        }
    }

    pub fn new_env(&mut self, parent: Option<Idx>) -> Idx {
        self.alloc(Cell::Env { vars: HashMap::new(), parent })
    }
    pub fn define(&mut self, env: Idx, name: Idx, v: Value) {
        if let Cell::Env { vars, .. } = self.get_mut(env) {
            vars.insert(name, v);
        }
    }
    pub fn lookup(&self, mut env: Idx, name: Idx) -> Option<Value> {
        loop {
            if let Cell::Env { vars, parent } = self.get(env) {
                if let Some(v) = vars.get(&name) {
                    return Some(*v);
                }
                match parent {
                    Some(p) => env = *p,
                    None => return None,
                }
            } else {
                return None;
            }
        }
    }
    pub fn set(&mut self, mut env: Idx, name: Idx, v: Value) -> bool {
        loop {
            let parent = if let Cell::Env { vars, parent } = self.get_mut(env) {
                if vars.contains_key(&name) {
                    vars.insert(name, v);
                    return true;
                }
                *parent
            } else {
                return false;
            };
            match parent {
                Some(p) => env = p,
                None => return false,
            }
        }
    }
    pub fn env_names(&self, env: Idx) -> Vec<String> {
        let mut out = Vec::new();
        if let Cell::Env { vars, .. } = self.get(env) {
            for k in vars.keys() {
                out.push(self.sym_name(*k).to_string());
            }
        }
        out.sort();
        out
    }

    pub fn push_kont(&mut self, frame: Frame, next: Option<Idx>) -> Idx {
        self.alloc(Cell::Kont { frame, next })
    }

    pub fn should_gc(&self) -> bool {
        self.allocs_since_gc >= self.gc_threshold
    }
    pub fn live(&self) -> usize {
        self.cells.iter().filter(|c| !matches!(c, Cell::Free(_))).count()
    }
    pub fn capacity(&self) -> usize {
        self.cells.len()
    }

    /// Mark/sweep. `roots`: global env, current CEK state, host-pinned handles.
    pub fn gc(&mut self, roots: &[Value]) {
        for m in self.marks.iter_mut() {
            *m = false;
        }
        let mut stack: Vec<Idx> = roots.iter().filter_map(|v| v.is_heap()).collect();
        while let Some(i) = stack.pop() {
            if self.marks[i as usize] {
                continue;
            }
            self.marks[i as usize] = true;
            let mut children: Vec<Idx> = Vec::new();
            let mut pv = |v: Value| {
                if let Some(j) = v.is_heap() {
                    children.push(j);
                }
            };
            match &self.cells[i as usize] {
                Cell::Pair(a, d) => {
                    pv(*a);
                    pv(*d);
                }
                Cell::Closure { body, env, .. } => {
                    pv(*body);
                    children.push(*env);
                }
                Cell::Promise { value, expr, env, .. } => {
                    pv(*value);
                    pv(*expr);
                    children.push(*env);
                }
                Cell::Env { vars, parent } => {
                    for v in vars.values() {
                        pv(*v);
                    }
                    if let Some(p) = parent {
                        children.push(*p);
                    }
                }
                Cell::Kont { frame, next } => {
                    if let Some(n) = next {
                        children.push(*n);
                    }
                    match frame {
                        Frame::Args { done, rest, env } => {
                            for v in done {
                                pv(*v);
                            }
                            pv(*rest);
                            children.push(*env);
                        }
                        Frame::IfK { conseq, alt, env } => {
                            pv(*conseq);
                            pv(*alt);
                            children.push(*env);
                        }
                        Frame::Seq { rest, env }
                        | Frame::CondK { clauses: rest, env }
                        | Frame::AndK { rest, env }
                        | Frame::OrK { rest, env } => {
                            pv(*rest);
                            children.push(*env);
                        }
                        Frame::Define { env, .. } | Frame::Set { env, .. } => children.push(*env),
                        Frame::LetK { done, rest, body, env, .. } => {
                            for v in done {
                                pv(*v);
                            }
                            pv(*rest);
                            pv(*body);
                            children.push(*env);
                        }
                        Frame::Force { promise } => children.push(*promise),
                        Frame::Halt => {}
                    }
                }
                Cell::Str(_) | Cell::Big(_) | Cell::Rat(_) | Cell::Picture(_) | Cell::Free(_) => {}
            }
            stack.extend(children);
        }
        for i in 0..self.cells.len() {
            if !self.marks[i] && !matches!(self.cells[i], Cell::Free(_)) {
                self.cells[i] = Cell::Free(self.free);
                self.free = Some(i as Idx);
            }
        }
        self.allocs_since_gc = 0;
    }
}

impl Default for Heap {
    fn default() -> Self {
        Self::new()
    }
}
