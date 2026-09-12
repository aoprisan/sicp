//! CEK machine. `control` is either an expression to evaluate or a value to hand to the
//! continuation. Continuation frames live on the heap (`Cell::Kont`). No host recursion:
//! the WASM stack depth is constant regardless of user code.

use crate::heap::{Cell, Frame, Heap};
use crate::prims::{self, PRIM_APPLY, PRIM_CALLCC, PRIM_EVAL, PRIM_FORCE};
use crate::value::{err, Idx, Result, SchemeError, Value};

#[derive(Clone, Copy, Debug)]
pub enum Control {
    Eval(Value),
    Ret(Value),
}

/// Symbols the evaluator dispatches on, interned once.
#[derive(Clone, Copy)]
pub struct Syms {
    pub quote: Idx,
    pub define: Idx,
    pub lambda: Idx,
    pub if_: Idx,
    pub cond: Idx,
    pub else_: Idx,
    pub arrow: Idx,
    pub and: Idx,
    pub or: Idx,
    pub let_: Idx,
    pub let_star: Idx,
    pub letrec: Idx,
    pub begin: Idx,
    pub set: Idx,
    pub cons_stream: Idx,
    pub delay: Idx,
    pub the_environment: Idx,
    pub dot: Idx,
}

impl Syms {
    pub fn new(h: &mut Heap) -> Self {
        Syms {
            quote: h.intern("quote"),
            define: h.intern("define"),
            lambda: h.intern("lambda"),
            if_: h.intern("if"),
            cond: h.intern("cond"),
            else_: h.intern("else"),
            arrow: h.intern("=>"),
            and: h.intern("and"),
            or: h.intern("or"),
            let_: h.intern("let"),
            let_star: h.intern("let*"),
            letrec: h.intern("letrec"),
            begin: h.intern("begin"),
            set: h.intern("set!"),
            cons_stream: h.intern("cons-stream"),
            delay: h.intern("delay"),
            the_environment: h.intern("the-environment"),
            dot: h.intern("."),
        }
    }
}

pub struct Machine {
    pub control: Control,
    pub env: Idx,
    pub kont: Option<Idx>,
    pub syms: Syms,
    pub steps: u64,
}

pub enum StepResult {
    Done(Value),
    OutOfBudget,
}

impl Machine {
    pub fn new(heap: &mut Heap, expr: Value, env: Idx) -> Self {
        let syms = Syms::new(heap);
        let halt = heap.push_kont(Frame::Halt, None);
        Machine { control: Control::Eval(expr), env, kont: Some(halt), syms, steps: 0 }
    }

    pub fn roots(&self) -> Vec<Value> {
        let mut r = vec![Value::Env(self.env)];
        match self.control {
            Control::Eval(v) | Control::Ret(v) => r.push(v),
        }
        if let Some(k) = self.kont {
            r.push(Value::Cont(k));
        }
        r
    }

    fn push(&mut self, heap: &mut Heap, f: Frame) {
        self.kont = Some(heap.push_kont(f, self.kont));
    }

    fn pop(&mut self, heap: &Heap) -> Option<Frame> {
        let k = self.kont?;
        if let Cell::Kont { frame, next } = heap.get(k) {
            let f = frame.clone();
            self.kont = *next;
            Some(f)
        } else {
            None
        }
    }

    pub fn run(&mut self, heap: &mut Heap, out: &mut String, budget: u64) -> Result<StepResult> {
        let mut n = 0u64;
        loop {
            if n >= budget {
                return Ok(StepResult::OutOfBudget);
            }
            n += 1;
            self.steps += 1;
            match self.control {
                Control::Eval(e) => self.eval(heap, e)?,
                Control::Ret(v) => {
                    let frame = match self.pop(heap) {
                        None => return Ok(StepResult::Done(v)),
                        Some(f) => f,
                    };
                    if let Frame::Halt = frame {
                        return Ok(StepResult::Done(v));
                    }
                    self.ret(heap, out, v, frame)?;
                }
            }
        }
    }

    fn eval(&mut self, heap: &mut Heap, e: Value) -> Result<()> {
        let s = self.syms;
        match e {
            Value::Sym(name) => {
                let v = heap
                    .lookup(self.env, name)
                    .ok_or_else(|| SchemeError { message: format!("Unbound variable: {}", heap.sym_name(name)), irritants: vec![], span: None })?;
                self.control = Control::Ret(v);
            }
            Value::Pair(_) => {
                let head = heap.car(e).unwrap();
                let rest = heap.cdr(e).unwrap();
                if let Value::Sym(h) = head {
                    if h == s.quote {
                        self.control = Control::Ret(heap.car(rest).ok_or_else(|| bad("quote", heap, e))?);
                        return Ok(());
                    }
                    if h == s.if_ {
                        let items = heap.list_to_vec(rest).ok_or_else(|| bad("if", heap, e))?;
                        if items.len() < 2 || items.len() > 3 {
                            return Err(bad("if", heap, e));
                        }
                        let alt = items.get(2).copied().unwrap_or(Value::Unspecified);
                        self.push(heap, Frame::IfK { conseq: items[1], alt, env: self.env });
                        self.control = Control::Eval(items[0]);
                        return Ok(());
                    }
                    if h == s.define {
                        let target = heap.car(rest).ok_or_else(|| bad("define", heap, e))?;
                        let body = heap.cdr(rest).unwrap();
                        match target {
                            Value::Sym(name) => {
                                let ve = heap.car(body).unwrap_or(Value::Unspecified);
                                self.push(heap, Frame::Define { name, env: self.env });
                                self.control = Control::Eval(ve);
                            }
                            Value::Pair(_) => {
                                // (define (name . params) body...)  — also curried (define ((f a) b) ...)
                                let mut target = target;
                                let mut body = body;
                                loop {
                                    let name = heap.car(target).unwrap();
                                    let params = heap.cdr(target).unwrap();
                                    let lam = self.make_lambda_expr(heap, params, body);
                                    match name {
                                        Value::Sym(n) => {
                                            self.push(heap, Frame::Define { name: n, env: self.env });
                                            self.control = Control::Eval(lam);
                                            break;
                                        }
                                        Value::Pair(_) => {
                                            body = heap.list(&[lam]);
                                            target = name;
                                        }
                                        _ => return Err(bad("define", heap, e)),
                                    }
                                }
                            }
                            _ => return Err(bad("define", heap, e)),
                        }
                        return Ok(());
                    }
                    if h == s.lambda {
                        let params = heap.car(rest).ok_or_else(|| bad("lambda", heap, e))?;
                        let body = heap.cdr(rest).unwrap();
                        let v = self.make_closure(heap, params, body, None)?;
                        self.control = Control::Ret(v);
                        return Ok(());
                    }
                    if h == s.begin {
                        self.eval_sequence(heap, rest);
                        return Ok(());
                    }
                    if h == s.set {
                        let name = match heap.car(rest) {
                            Some(Value::Sym(n)) => n,
                            _ => return Err(bad("set!", heap, e)),
                        };
                        let ve = heap.cdr(rest).and_then(|r| heap.car(r)).ok_or_else(|| bad("set!", heap, e))?;
                        self.push(heap, Frame::Set { name, env: self.env });
                        self.control = Control::Eval(ve);
                        return Ok(());
                    }
                    if h == s.cond {
                        self.eval_cond(heap, rest)?;
                        return Ok(());
                    }
                    if h == s.and {
                        if rest == Value::Nil {
                            self.control = Control::Ret(Value::Bool(true));
                        } else {
                            let first = heap.car(rest).unwrap();
                            let tail = heap.cdr(rest).unwrap();
                            if tail != Value::Nil {
                                self.push(heap, Frame::AndK { rest: tail, env: self.env });
                            }
                            self.control = Control::Eval(first);
                        }
                        return Ok(());
                    }
                    if h == s.or {
                        if rest == Value::Nil {
                            self.control = Control::Ret(Value::Bool(false));
                        } else {
                            let first = heap.car(rest).unwrap();
                            let tail = heap.cdr(rest).unwrap();
                            if tail != Value::Nil {
                                self.push(heap, Frame::OrK { rest: tail, env: self.env });
                            }
                            self.control = Control::Eval(first);
                        }
                        return Ok(());
                    }
                    if h == s.let_ || h == s.let_star || h == s.letrec {
                        self.eval_let(heap, h, rest, e)?;
                        return Ok(());
                    }
                    if h == s.cons_stream {
                        let a = heap.car(rest).ok_or_else(|| bad("cons-stream", heap, e))?;
                        let b = heap.cdr(rest).and_then(|r| heap.car(r)).ok_or_else(|| bad("cons-stream", heap, e))?;
                        // (cons-stream a b) == (cons a (delay b)). Build the promise now, then
                        // evaluate `a` with an Args frame whose remaining operand is the quoted promise.
                        let p = heap.alloc(Cell::Promise { forced: false, value: Value::Unspecified, expr: b, env: self.env });
                        let quoted = heap.list(&[Value::Sym(s.quote), Value::Promise(p)]);
                        let remaining = heap.list(&[quoted]);
                        self.push(heap, Frame::Args { done: vec![Value::Prim(prims::PRIM_CONS)], rest: remaining, env: self.env });
                        self.control = Control::Eval(a);
                        return Ok(());
                    }
                    if h == s.delay {
                        let b = heap.car(rest).ok_or_else(|| bad("delay", heap, e))?;
                        let p = heap.alloc(Cell::Promise { forced: false, value: Value::Unspecified, expr: b, env: self.env });
                        self.control = Control::Ret(Value::Promise(p));
                        return Ok(());
                    }
                    if h == s.the_environment {
                        self.control = Control::Ret(Value::Env(self.env));
                        return Ok(());
                    }
                }
                // Application: evaluate operator, then operands left to right.
                self.push(heap, Frame::Args { done: vec![], rest, env: self.env });
                self.control = Control::Eval(head);
            }
            // Self-evaluating
            other => self.control = Control::Ret(other),
        }
        Ok(())
    }

    fn make_lambda_expr(&self, heap: &mut Heap, params: Value, body: Value) -> Value {
        let lam = Value::Sym(self.syms.lambda);
        let inner = heap.cons(params, body);
        heap.cons(lam, inner)
    }

    fn make_closure(&self, heap: &mut Heap, params: Value, body: Value, name: Option<Idx>) -> Result<Value> {
        let mut ps = Vec::new();
        let mut rest = None;
        let mut cur = params;
        loop {
            match cur {
                Value::Nil => break,
                Value::Sym(r) => {
                    rest = Some(r);
                    break;
                }
                Value::Pair(_) => {
                    match heap.car(cur).unwrap() {
                        Value::Sym(p) => ps.push(p),
                        _ => return err("Ill-formed special form: lambda"),
                    }
                    cur = heap.cdr(cur).unwrap();
                }
                _ => return err("Ill-formed special form: lambda"),
            }
        }
        if body == Value::Nil {
            return err("Ill-formed special form: lambda (empty body)");
        }
        Ok(Value::Closure(heap.alloc(Cell::Closure { params: ps, rest, body, env: self.env, name })))
    }

    fn eval_sequence(&mut self, heap: &mut Heap, body: Value) {
        match body {
            Value::Nil => self.control = Control::Ret(Value::Unspecified),
            _ => {
                let first = heap.car(body).unwrap();
                let rest = heap.cdr(body).unwrap();
                if rest != Value::Nil {
                    self.push(heap, Frame::Seq { rest, env: self.env });
                }
                self.control = Control::Eval(first);
            }
        }
    }

    fn eval_cond(&mut self, heap: &mut Heap, clauses: Value) -> Result<()> {
        if clauses == Value::Nil {
            self.control = Control::Ret(Value::Unspecified);
            return Ok(());
        }
        let clause = heap.car(clauses).unwrap();
        let rest = heap.cdr(clauses).unwrap();
        let test = heap.car(clause).ok_or_else(|| bad("cond", heap, clauses))?;
        let body = heap.cdr(clause).unwrap();
        if test == Value::Sym(self.syms.else_) {
            self.eval_sequence(heap, body);
            return Ok(());
        }
        self.push(heap, Frame::CondK { clauses, env: self.env });
        self.control = Control::Eval(test);
        Ok(())
    }

    fn eval_let(&mut self, heap: &mut Heap, kind: Idx, rest: Value, whole: Value) -> Result<()> {
        let s = self.syms;
        let bindings = heap.car(rest).ok_or_else(|| bad("let", heap, whole))?;
        let body = heap.cdr(rest).unwrap();
        // Named let: (let name ((v e) ...) body)
        if let Value::Sym(name) = bindings {
            let bindings = heap.cdr(rest).and_then(|r| heap.car(r)).ok_or_else(|| bad("let", heap, whole))?;
            let body = heap.cdr(rest).and_then(|r| heap.cdr(r)).unwrap();
            let bs = heap.list_to_vec(bindings).ok_or_else(|| bad("let", heap, whole))?;
            let mut names = Vec::new();
            let mut inits = Vec::new();
            for b in bs {
                names.push(heap.car(b).unwrap());
                inits.push(heap.cdr(b).and_then(|r| heap.car(r)).unwrap_or(Value::Unspecified));
            }
            // ((letrec ((name (lambda names body...))) name) inits...)
            let params = heap.list(&names);
            let lam = self.make_lambda_expr(heap, params, body);
            let binding = heap.list(&[Value::Sym(name), lam]);
            let bl = heap.list(&[binding]);
            let letrec = heap.list(&[Value::Sym(s.letrec), bl, Value::Sym(name)]);
            let mut call = vec![letrec];
            call.extend(inits);
            let call = heap.list(&call);
            self.control = Control::Eval(call);
            return Ok(());
        }
        let bs = heap.list_to_vec(bindings).ok_or_else(|| bad("let", heap, whole))?;
        if kind == s.let_star {
            // (let* ((a 1) (b 2)) body) => (let ((a 1)) (let* ((b 2)) body))
            if bs.is_empty() {
                let tail = heap_pair(heap, Value::Nil, body);
                let e = heap.cons(Value::Sym(s.let_), tail);
                self.control = Control::Eval(e);
                return Ok(());
            }
            let first = heap.list(&[bs[0]]);
            let inner_bs = heap.list(&bs[1..]);
            let inner_tail = heap_pair(heap, inner_bs, body);
            let inner = heap.cons(Value::Sym(s.let_star), inner_tail);
            let ib = heap.list(&[inner]);
            let outer_tail = heap_pair(heap, first, ib);
            let outer = heap.cons(Value::Sym(s.let_), outer_tail);
            self.control = Control::Eval(outer);
            return Ok(());
        }
        if kind == s.letrec {
            // new env with names bound to unspecified, then sequential set!, then body
            let env = heap.new_env(Some(self.env));
            let mut forms = Vec::new();
            for b in &bs {
                let name = heap.car(*b).unwrap();
                let init = heap.cdr(*b).and_then(|r| heap.car(r)).unwrap_or(Value::Unspecified);
                if let Value::Sym(n) = name {
                    heap.define(env, n, Value::Unspecified);
                }
                forms.push(heap.list(&[Value::Sym(s.set), name, init]));
            }
            let mut seq = forms;
            seq.extend(heap.list_to_vec(body).unwrap_or_default());
            let seq = heap.list(&seq);
            self.env = env;
            self.eval_sequence(heap, seq);
            return Ok(());
        }
        // plain let
        let mut names = Vec::new();
        let mut inits = Vec::new();
        for b in &bs {
            match heap.car(*b) {
                Some(Value::Sym(n)) => names.push(n),
                _ => return Err(bad("let", heap, whole)),
            }
            inits.push(heap.cdr(*b).and_then(|r| heap.car(r)).unwrap_or(Value::Unspecified));
        }
        if inits.is_empty() {
            let env = heap.new_env(Some(self.env));
            self.env = env;
            self.eval_sequence(heap, body);
            return Ok(());
        }
        let rest_inits = heap.list(&inits[1..]);
        self.push(heap, Frame::LetK { names, done: vec![], rest: rest_inits, body, env: self.env });
        self.control = Control::Eval(inits[0]);
        Ok(())
    }

    fn ret(&mut self, heap: &mut Heap, out: &mut String, v: Value, frame: Frame) -> Result<()> {
        match frame {
            Frame::Halt => unreachable!(),
            Frame::IfK { conseq, alt, env } => {
                self.env = env;
                self.control = Control::Eval(if v.is_true() { conseq } else { alt });
            }
            Frame::Seq { rest, env } => {
                self.env = env;
                self.eval_sequence(heap, rest);
            }
            Frame::Define { name, env } => {
                if let Value::Closure(c) = v {
                    if let Cell::Closure { name: n, .. } = heap.get_mut(c) {
                        if n.is_none() {
                            *n = Some(name);
                        }
                    }
                }
                heap.define(env, name, v);
                self.env = env;
                self.control = Control::Ret(Value::Sym(name));
            }
            Frame::Set { name, env } => {
                if !heap.set(env, name, v) {
                    return err(format!("Unbound variable: {}", heap.sym_name(name)));
                }
                self.env = env;
                self.control = Control::Ret(Value::Unspecified);
            }
            Frame::CondK { clauses, env } => {
                self.env = env;
                if v.is_true() {
                    let clause = heap.car(clauses).unwrap();
                    let body = heap.cdr(clause).unwrap();
                    if body == Value::Nil {
                        self.control = Control::Ret(v);
                    } else if heap.car(body) == Some(Value::Sym(self.syms.arrow)) {
                        let f = heap.cdr(body).and_then(|r| heap.car(r)).unwrap();
                        let q = heap.list(&[Value::Sym(self.syms.quote), v]);
                        let call = heap.list(&[f, q]);
                        self.control = Control::Eval(call);
                    } else {
                        self.eval_sequence(heap, body);
                    }
                } else {
                    let rest = heap.cdr(clauses).unwrap();
                    self.eval_cond(heap, rest)?;
                }
            }
            Frame::AndK { rest, env } => {
                self.env = env;
                if !v.is_true() {
                    self.control = Control::Ret(v);
                } else {
                    let first = heap.car(rest).unwrap();
                    let tail = heap.cdr(rest).unwrap();
                    if tail != Value::Nil {
                        self.push(heap, Frame::AndK { rest: tail, env });
                    }
                    self.control = Control::Eval(first);
                }
            }
            Frame::OrK { rest, env } => {
                self.env = env;
                if v.is_true() {
                    self.control = Control::Ret(v);
                } else {
                    let first = heap.car(rest).unwrap();
                    let tail = heap.cdr(rest).unwrap();
                    if tail != Value::Nil {
                        self.push(heap, Frame::OrK { rest: tail, env });
                    }
                    self.control = Control::Eval(first);
                }
            }
            Frame::LetK { names, mut done, rest, body, env } => {
                done.push(v);
                self.env = env;
                if rest == Value::Nil {
                    let new_env = heap.new_env(Some(env));
                    for (n, val) in names.iter().zip(done.iter()) {
                        heap.define(new_env, *n, *val);
                    }
                    self.env = new_env;
                    self.eval_sequence(heap, body);
                } else {
                    let first = heap.car(rest).unwrap();
                    let tail = heap.cdr(rest).unwrap();
                    self.push(heap, Frame::LetK { names, done, rest: tail, body, env });
                    self.control = Control::Eval(first);
                }
            }
            Frame::Force { promise } => {
                if let Cell::Promise { forced, value, .. } = heap.get_mut(promise) {
                    *forced = true;
                    *value = v;
                }
                self.control = Control::Ret(v);
            }
            Frame::Args { mut done, rest, env } => {
                done.push(v);
                self.env = env;
                if rest == Value::Nil {
                    let f = done[0];
                    let args = done[1..].to_vec();
                    self.apply(heap, out, f, args)?;
                } else {
                    let first = heap.car(rest).unwrap();
                    let tail = heap.cdr(rest).unwrap();
                    self.push(heap, Frame::Args { done, rest: tail, env });
                    self.control = Control::Eval(first);
                }
            }
        }
        Ok(())
    }

    /// Tail call: does not push a frame.
    pub fn apply(&mut self, heap: &mut Heap, out: &mut String, f: Value, args: Vec<Value>) -> Result<()> {
        match f {
            Value::Closure(c) => {
                let (params, rest, body, cenv) = match heap.get(c) {
                    Cell::Closure { params, rest, body, env, .. } => (params.clone(), *rest, *body, *env),
                    _ => unreachable!(),
                };
                if args.len() < params.len() || (rest.is_none() && args.len() > params.len()) {
                    let name = crate::printer::print(heap, f);
                    return err(format!("The procedure {} has been called with {} arguments; it requires exactly {} argument{}", name, args.len(), params.len(), if params.len() == 1 { "" } else { "s" }));
                }
                let env = heap.new_env(Some(cenv));
                for (p, a) in params.iter().zip(args.iter()) {
                    heap.define(env, *p, *a);
                }
                if let Some(r) = rest {
                    let extra = heap.list(&args[params.len()..]);
                    heap.define(env, r, extra);
                }
                self.env = env;
                self.eval_sequence(heap, body);
                Ok(())
            }
            Value::Prim(PRIM_APPLY) => {
                if args.is_empty() {
                    return err("apply: needs a procedure");
                }
                let f2 = args[0];
                let mut flat: Vec<Value> = args[1..args.len().saturating_sub(1)].to_vec();
                if let Some(last) = args.last() {
                    if args.len() > 1 {
                        let l = heap.list_to_vec(*last).ok_or_else(|| SchemeError { message: "The object, passed as the last argument to apply, is not a list.".into(), irritants: vec![crate::printer::print(heap, *last)], span: None })?;
                        flat.extend(l);
                    }
                }
                self.apply(heap, out, f2, flat)
            }
            Value::Prim(PRIM_FORCE) => {
                match args.first() {
                    Some(Value::Promise(p)) => {
                        let p = *p;
                        let (forced, value, expr, penv) = match heap.get(p) {
                            Cell::Promise { forced, value, expr, env } => (*forced, *value, *expr, *env),
                            _ => unreachable!(),
                        };
                        if forced {
                            self.control = Control::Ret(value);
                        } else {
                            self.push(heap, Frame::Force { promise: p });
                            self.env = penv;
                            self.control = Control::Eval(expr);
                        }
                        Ok(())
                    }
                    Some(v) => {
                        self.control = Control::Ret(*v);
                        Ok(())
                    }
                    None => err("force: needs an argument"),
                }
            }
            Value::Prim(PRIM_EVAL) => {
                let expr = *args.first().ok_or_else(|| SchemeError { message: "eval: needs an expression".into(), irritants: vec![], span: None })?;
                if let Some(Value::Env(e)) = args.get(1) {
                    self.env = *e;
                }
                self.control = Control::Eval(expr);
                Ok(())
            }
            Value::Prim(PRIM_CALLCC) => {
                let f2 = *args.first().ok_or_else(|| SchemeError { message: "call/cc: needs a procedure".into(), irritants: vec![], span: None })?;
                let k = Value::Cont(self.kont.unwrap_or_else(|| heap.push_kont(Frame::Halt, None)));
                self.apply(heap, out, f2, vec![k])
            }
            Value::Cont(k) => {
                self.kont = Some(k);
                self.control = Control::Ret(args.first().copied().unwrap_or(Value::Unspecified));
                Ok(())
            }
            Value::Prim(p) => {
                let v = prims::call(p, heap, &args, out)?;
                self.control = Control::Ret(v);
                Ok(())
            }
            other => {
                let s = crate::printer::print(heap, other);
                err(format!("The object {} is not applicable.", s))
            }
        }
    }
}

fn bad(_form: &str, heap: &Heap, e: Value) -> SchemeError {
    SchemeError { message: format!("Ill-formed special form: {}", crate::printer::print(heap, e)), irritants: vec![], span: None }
}

fn heap_pair(heap: &mut Heap, a: Value, d: Value) -> Value {
    heap.cons(a, d)
}
