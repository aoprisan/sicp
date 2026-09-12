//! wasm-bindgen surface. Keep it flat and JSON-in/JSON-out; the worker wraps it.

use crate::reader::form_at;
use crate::session::{Session, Status};
use serde::Serialize;
use std::cell::RefCell;
use wasm_bindgen::prelude::*;

thread_local! {
    static SESSIONS: RefCell<Vec<Option<Session>>> = RefCell::new(Vec::new());
    static RUNTIME: RefCell<f64> = RefCell::new(0.0);
}

#[derive(Serialize)]
struct EvalResult {
    status: &'static str,
    output: String,
    values: Vec<String>,
    error: Option<String>,
    span: Option<(usize, usize)>,
}

fn status_json(s: &mut Session, st: Status) -> String {
    let output = std::mem::take(&mut s.output);
    let r = match st {
        Status::Done { values } => EvalResult { status: "done", output, values, error: None, span: None },
        Status::Paused => EvalResult { status: "paused", output, values: vec![], error: None, span: None },
        Status::Error(e) => EvalResult { status: "error", output, values: vec![], error: Some(e.to_string()), span: e.span },
    };
    serde_json::to_string(&r).unwrap()
}

#[wasm_bindgen]
pub fn new_session() -> u32 {
    SESSIONS.with(|s| {
        let mut v = s.borrow_mut();
        v.push(Some(Session::new()));
        (v.len() - 1) as u32
    })
}

#[wasm_bindgen]
pub fn drop_session(id: u32) {
    SESSIONS.with(|s| {
        if let Some(slot) = s.borrow_mut().get_mut(id as usize) {
            *slot = None;
        }
    })
}

fn with_session<R>(id: u32, f: impl FnOnce(&mut Session) -> R) -> Option<R> {
    SESSIONS.with(|s| s.borrow_mut().get_mut(id as usize).and_then(|o| o.as_mut()).map(f))
}

// ES modules are strict mode, where `eval` is not a legal binding name, so wasm-bindgen would
// silently rename this to `_eval`. Name it here instead of depending on that mangling.
#[wasm_bindgen(js_name = eval_source)]
pub fn eval(id: u32, src: &str, budget: u32) -> String {
    with_session(id, |s| {
        let st = s.eval(src, budget as u64);
        status_json(s, st)
    })
    .unwrap_or_else(|| "{\"status\":\"error\",\"error\":\"no such session\"}".into())
}

#[wasm_bindgen]
pub fn resume(id: u32, budget: u32) -> String {
    with_session(id, |s| {
        let st = s.resume(budget as u64);
        status_json(s, st)
    })
    .unwrap_or_else(|| "{\"status\":\"error\",\"error\":\"no such session\"}".into())
}

#[wasm_bindgen]
pub fn interrupt(id: u32) {
    with_session(id, |s| s.interrupt());
}

#[wasm_bindgen]
pub fn env_names(id: u32) -> String {
    serde_json::to_string(&with_session(id, |s| s.env_names()).unwrap_or_default()).unwrap()
}

#[wasm_bindgen]
pub fn form_at_cursor(src: &str, cursor: u32) -> String {
    let (head, depth, span) = form_at(src, cursor as usize);
    serde_json::json!({ "head": head, "depth": depth, "span": span }).to_string()
}

#[wasm_bindgen]
pub fn gc_stats(id: u32) -> String {
    with_session(id, |s| serde_json::json!({ "live": s.heap.live(), "capacity": s.heap.capacity() }).to_string()).unwrap_or_default()
}

/// Host calls this periodically with `performance.now()/1000` so `(runtime)` works.
#[wasm_bindgen]
pub fn set_runtime(seconds: f64) {
    RUNTIME.with(|r| *r.borrow_mut() = seconds);
}

pub fn runtime_seconds() -> f64 {
    RUNTIME.with(|r| *r.borrow())
}
