//! A REPL session: global environment, prelude, and a resumable evaluation of a source buffer.

use crate::eval::{Machine, StepResult};
use crate::heap::Heap;
use crate::printer::print;
use crate::reader::{Datum, Reader};
use crate::value::{Idx, SchemeError, Value};

pub const PRELUDE: &str = include_str!("../prelude.scm");

/// Machine steps between GC safe points.
const GC_SLICE: u64 = 4096;

#[derive(Debug, Clone, PartialEq)]
pub enum Status {
    /// Whole buffer evaluated. `values` holds the printed value of each top-level form.
    Done { values: Vec<String> },
    /// Step budget exhausted; call `resume`.
    Paused,
    Error(SchemeError),
}

pub struct Session {
    pub heap: Heap,
    pub global: Idx,
    pending: Vec<Datum>,
    machine: Option<Machine>,
    values: Vec<String>,
    pub output: String,
}

impl Session {
    pub fn new() -> Self {
        let mut heap = Heap::new();
        let global = heap.new_env(None);
        crate::prims::install(&mut heap, global);
        let mut s = Session { heap, global, pending: Vec::new(), machine: None, values: Vec::new(), output: String::new() };
        if let Status::Error(e) = s.eval(PRELUDE, u64::MAX) {
            panic!("prelude failed: {}", e);
        }
        s.output.clear();
        s
    }

    /// Start evaluating `src`. Returns after `budget` machine steps at most.
    pub fn eval(&mut self, src: &str, budget: u64) -> Status {
        self.values.clear();
        self.machine = None;
        let mut reader = Reader::new(src);
        match reader.read_all(&mut self.heap) {
            Ok(d) => {
                self.pending = d;
                self.pending.reverse();
            }
            Err(e) => return Status::Error(e),
        }
        self.resume(budget)
    }

    pub fn resume(&mut self, budget: u64) -> Status {
        let mut remaining = budget;
        loop {
            if self.machine.is_none() {
                match self.pending.pop() {
                    None => return Status::Done { values: std::mem::take(&mut self.values) },
                    Some(d) => self.machine = Some(Machine::new(&mut self.heap, d.value, self.global)),
                }
            }
            let m = self.machine.as_mut().unwrap();
            let slice = remaining.min(GC_SLICE);
            match m.run(&mut self.heap, &mut self.output, slice) {
                Ok(StepResult::Done(v)) => {
                    self.values.push(print(&self.heap, v));
                    self.machine = None;
                }
                Ok(StepResult::OutOfBudget) => {
                    remaining -= slice;
                    if remaining == 0 {
                        return Status::Paused;
                    }
                }
                Err(e) => {
                    self.machine = None;
                    self.pending.clear();
                    return Status::Error(e);
                }
            }
            self.maybe_gc();
        }
    }

    pub fn interrupt(&mut self) {
        self.machine = None;
        self.pending.clear();
    }

    fn maybe_gc(&mut self) {
        let extra = self.machine.as_ref().map(|m| m.roots()).unwrap_or_default();
        self.maybe_gc_with(&extra);
    }

    /// GC at a machine step boundary. `extra` carries the roots of the evaluation in progress
    /// plus any data the caller still owns; `transcript` runs a machine that is not in
    /// `self.machine`, so it has to hand those in.
    fn maybe_gc_with(&mut self, extra: &[Value]) {
        if !self.heap.should_gc() {
            return;
        }
        let mut roots = vec![Value::Env(self.global)];
        roots.extend_from_slice(extra);
        for d in &self.pending {
            roots.push(d.value);
        }
        self.heap.gc(&roots);
    }

    pub fn env_names(&self) -> Vec<String> {
        self.heap.env_names(self.global)
    }

    /// Convenience for tests: evaluate fully and return a transcript in MIT REPL style.
    pub fn transcript(&mut self, src: &str) -> String {
        let mut out = String::new();
        let mut reader = Reader::new(src);
        let data = match reader.read_all(&mut self.heap) {
            Ok(d) => d,
            Err(e) => return format!("{}\n", e),
        };
        for (i, d) in data.iter().enumerate() {
            self.output.clear();
            let mut m = Machine::new(&mut self.heap, d.value, self.global);
            // Top-level forms we have not reached yet are live data, but they live in `data`
            // rather than the heap roots, so they have to be rooted explicitly.
            let unread: Vec<Value> = data[i + 1..].iter().map(|d| d.value).collect();
            // Run in slices so a long-running form still reaches a GC safe point.
            let res = loop {
                match m.run(&mut self.heap, &mut self.output, GC_SLICE) {
                    Ok(StepResult::OutOfBudget) => {
                        let mut roots = m.roots();
                        roots.extend_from_slice(&unread);
                        self.maybe_gc_with(&roots);
                    }
                    other => break other,
                }
            };
            match res {
                Ok(StepResult::Done(v)) => {
                    out.push_str(&self.output);
                    let p = print(&self.heap, v);
                    if !p.is_empty() {
                        out.push_str(";Value: ");
                        out.push_str(&p);
                        out.push('\n');
                    }
                }
                Ok(StepResult::OutOfBudget) => unreachable!(),
                Err(e) => {
                    out.push_str(&self.output);
                    out.push_str(&format!("{}\n", e));
                }
            }
            self.maybe_gc_with(&unread);
        }
        out
    }
}

impl Default for Session {
    fn default() -> Self {
        Self::new()
    }
}
