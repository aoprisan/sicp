//! Primitive procedures. Numeric tower: i64 → BigInt → BigRational, plus f64.
//! Primitives that need the machine (apply, force, eval, call/cc) are dispatched in eval.rs.

use crate::heap::{Cell, Heap};
use crate::printer::print;
use crate::value::{err, Idx, Result, SchemeError, Value};
use num_bigint::BigInt;
use num_integer::Integer;
use num_rational::BigRational;
use num_traits::{One, Signed, ToPrimitive, Zero};

pub const PRIM_APPLY: u16 = 0;
pub const PRIM_FORCE: u16 = 1;
pub const PRIM_EVAL: u16 = 2;
pub const PRIM_CALLCC: u16 = 3;
pub const PRIM_CONS: u16 = 4;

type PrimFn = fn(&mut Heap, &[Value], &mut String) -> Result<Value>;

/// (name, function). Index == Value::Prim id. The first entries are machine-level and have a
/// dummy fn here; eval.rs intercepts them before `call`.
pub static PRIMS: &[(&str, PrimFn)] = &[
    ("apply", |_, _, _| err("internal")),
    ("force", |_, _, _| err("internal")),
    ("eval", |_, _, _| err("internal")),
    ("call-with-current-continuation", |_, _, _| err("internal")),
    ("cons", |h, a, _| {
        check_arity("cons", a, 2)?;
        Ok(h.cons(a[0], a[1]))
    }),
    ("car", |h, a, _| pair_part(h, a, "car", true)),
    ("cdr", |h, a, _| pair_part(h, a, "cdr", false)),
    ("set-car!", |h, a, _| {
        check_arity("set-car!", a, 2)?;
        if let Value::Pair(i) = a[0] {
            if let Cell::Pair(x, _) = h.get_mut(i) {
                *x = a[1];
            }
            Ok(Value::Unspecified)
        } else {
            wrong_type(h, a[0], 1, "set-car!")
        }
    }),
    ("set-cdr!", |h, a, _| {
        check_arity("set-cdr!", a, 2)?;
        if let Value::Pair(i) = a[0] {
            if let Cell::Pair(_, x) = h.get_mut(i) {
                *x = a[1];
            }
            Ok(Value::Unspecified)
        } else {
            wrong_type(h, a[0], 1, "set-cdr!")
        }
    }),
    ("list", |h, a, _| Ok(h.list(a))),
    ("null?", |_, a, _| Ok(Value::Bool(a.first() == Some(&Value::Nil)))),
    ("pair?", |_, a, _| Ok(Value::Bool(matches!(a.first(), Some(Value::Pair(_)))))),
    ("symbol?", |_, a, _| Ok(Value::Bool(matches!(a.first(), Some(Value::Sym(_)))))),
    ("string?", |_, a, _| Ok(Value::Bool(matches!(a.first(), Some(Value::Str(_)))))),
    ("number?", |_, a, _| Ok(Value::Bool(matches!(a.first(), Some(Value::Int(_) | Value::Big(_) | Value::Rat(_) | Value::Real(_)))))),
    ("integer?", |h, a, _| Ok(Value::Bool(match a.first() {
        Some(Value::Int(_) | Value::Big(_)) => true,
        Some(Value::Real(f)) => f.fract() == 0.0,
        Some(Value::Rat(i)) => matches!(h.get(*i), Cell::Rat(r) if r.is_integer()),
        _ => false,
    }))),
    ("boolean?", |_, a, _| Ok(Value::Bool(matches!(a.first(), Some(Value::Bool(_)))))),
    ("procedure?", |_, a, _| Ok(Value::Bool(matches!(a.first(), Some(Value::Closure(_) | Value::Prim(_) | Value::Cont(_)))))),
    ("eq?", |h, a, _| {
        check_arity("eq?", a, 2)?;
        Ok(Value::Bool(eqv(h, a[0], a[1])))
    }),
    ("eqv?", |h, a, _| {
        check_arity("eqv?", a, 2)?;
        Ok(Value::Bool(eqv(h, a[0], a[1])))
    }),
    ("equal?", |h, a, _| {
        check_arity("equal?", a, 2)?;
        Ok(Value::Bool(equal(h, a[0], a[1])))
    }),
    ("+", |h, a, _| fold_num(h, a, Num::Int(0), num_add)),
    ("*", |h, a, _| fold_num(h, a, Num::Int(1), num_mul)),
    ("-", |h, a, _| {
        if a.is_empty() {
            return err("- has been called with 0 arguments; it requires at least 1 argument.");
        }
        let first = to_num(h, a[0], 1, "-")?;
        if a.len() == 1 {
            return Ok(from_num(h, num_sub(Num::Int(0), first)));
        }
        let mut acc = first;
        for (i, v) in a[1..].iter().enumerate() {
            acc = num_sub(acc, to_num(h, *v, i + 2, "-")?);
        }
        Ok(from_num(h, acc))
    }),
    ("/", |h, a, _| {
        if a.is_empty() {
            return err("/ has been called with 0 arguments; it requires at least 1 argument.");
        }
        let first = to_num(h, a[0], 1, "/")?;
        if a.len() == 1 {
            return Ok(from_num(h, num_div(Num::Int(1), first)?));
        }
        let mut acc = first;
        for (i, v) in a[1..].iter().enumerate() {
            acc = num_div(acc, to_num(h, *v, i + 2, "/")?)?;
        }
        Ok(from_num(h, acc))
    }),
    ("=", |h, a, _| compare(h, a, "=", |o| o == std::cmp::Ordering::Equal)),
    ("<", |h, a, _| compare(h, a, "<", |o| o == std::cmp::Ordering::Less)),
    (">", |h, a, _| compare(h, a, ">", |o| o == std::cmp::Ordering::Greater)),
    ("<=", |h, a, _| compare(h, a, "<=", |o| o != std::cmp::Ordering::Greater)),
    (">=", |h, a, _| compare(h, a, ">=", |o| o != std::cmp::Ordering::Less)),
    ("quotient", |h, a, _| int_op(h, a, "quotient", |x, y| x / y)),
    ("remainder", |h, a, _| int_op(h, a, "remainder", |x, y| x % y)),
    ("modulo", |h, a, _| int_op(h, a, "modulo", |x, y| x.mod_floor(&y))),
    ("gcd", |h, a, _| int_op(h, a, "gcd", |x, y| x.gcd(&y))),
    ("abs", |h, a, _| {
        check_arity("abs", a, 1)?;
        let n = to_num(h, a[0], 1, "abs")?;
        Ok(from_num(h, if num_cmp(&n, &Num::Int(0)) == std::cmp::Ordering::Less { num_sub(Num::Int(0), n) } else { n }))
    }),
    ("min", |h, a, _| extremum(h, a, "min", std::cmp::Ordering::Less)),
    ("max", |h, a, _| extremum(h, a, "max", std::cmp::Ordering::Greater)),
    ("sqrt", |h, a, _| {
        check_arity("sqrt", a, 1)?;
        let n = to_num(h, a[0], 1, "sqrt")?;
        if let Num::Int(i) = n {
            if i >= 0 {
                let r = (i as f64).sqrt() as i64;
                if r * r == i {
                    return Ok(Value::Int(r));
                }
            }
        }
        Ok(Value::Real(num_to_f64(&n).sqrt()))
    }),
    ("exp", |h, a, _| float1(h, a, "exp", f64::exp)),
    ("log", |h, a, _| float1(h, a, "log", f64::ln)),
    ("sin", |h, a, _| float1(h, a, "sin", f64::sin)),
    ("cos", |h, a, _| float1(h, a, "cos", f64::cos)),
    ("tan", |h, a, _| float1(h, a, "tan", f64::tan)),
    ("atan", |h, a, _| {
        if a.len() == 2 {
            let y = num_to_f64(&to_num(h, a[0], 1, "atan")?);
            let x = num_to_f64(&to_num(h, a[1], 2, "atan")?);
            return Ok(Value::Real(y.atan2(x)));
        }
        float1(h, a, "atan", f64::atan)
    }),
    ("expt", |h, a, _| {
        check_arity("expt", a, 2)?;
        let b = to_num(h, a[0], 1, "expt")?;
        let e = to_num(h, a[1], 2, "expt")?;
        match (&b, &e) {
            (Num::Int(_) | Num::Big(_), Num::Int(n)) if *n >= 0 => {
                let mut acc = Num::Int(1);
                for _ in 0..*n {
                    acc = num_mul(acc, b.clone());
                }
                Ok(from_num(h, acc))
            }
            _ => Ok(Value::Real(num_to_f64(&b).powf(num_to_f64(&e)))),
        }
    }),
    ("floor", |h, a, _| round_op(h, a, "floor", f64::floor)),
    ("ceiling", |h, a, _| round_op(h, a, "ceiling", f64::ceil)),
    ("round", |h, a, _| round_op(h, a, "round", |f| {
        let r = f.round();
        if (f - f.trunc()).abs() == 0.5 && r % 2.0 != 0.0 { r - f.signum() } else { r }
    })),
    ("truncate", |h, a, _| round_op(h, a, "truncate", f64::trunc)),
    ("even?", |h, a, _| int_pred(h, a, "even?", |x| x.is_even())),
    ("odd?", |h, a, _| int_pred(h, a, "odd?", |x| x.is_odd())),
    ("zero?", |h, a, _| Ok(Value::Bool(num_cmp(&to_num(h, a[0], 1, "zero?")?, &Num::Int(0)) == std::cmp::Ordering::Equal))),
    ("positive?", |h, a, _| Ok(Value::Bool(num_cmp(&to_num(h, a[0], 1, "positive?")?, &Num::Int(0)) == std::cmp::Ordering::Greater))),
    ("negative?", |h, a, _| Ok(Value::Bool(num_cmp(&to_num(h, a[0], 1, "negative?")?, &Num::Int(0)) == std::cmp::Ordering::Less))),
    ("exact->inexact", |h, a, _| Ok(Value::Real(num_to_f64(&to_num(h, a[0], 1, "exact->inexact")?)))),
    ("inexact->exact", |h, a, _| {
        let n = to_num(h, a[0], 1, "inexact->exact")?;
        match n {
            Num::Real(f) => match BigRational::from_float(f) {
                Some(r) => Ok(from_num(h, Num::Rat(r))),
                None => Ok(Value::Real(f)),
            },
            other => Ok(from_num(h, other)),
        }
    }),
    ("exact?", |_, a, _| Ok(Value::Bool(matches!(a.first(), Some(Value::Int(_) | Value::Big(_) | Value::Rat(_)))))),
    ("inexact?", |_, a, _| Ok(Value::Bool(matches!(a.first(), Some(Value::Real(_)))))),
    ("numerator", |h, a, _| match to_num(h, a[0], 1, "numerator")? {
        Num::Rat(r) => Ok(from_num(h, Num::Big(r.numer().clone()))),
        n => Ok(from_num(h, n)),
    }),
    ("denominator", |h, a, _| match to_num(h, a[0], 1, "denominator")? {
        Num::Rat(r) => Ok(from_num(h, Num::Big(r.denom().clone()))),
        _ => Ok(Value::Int(1)),
    }),
    ("random", |h, a, _| {
        check_arity("random", a, 1)?;
        let r = next_random();
        match to_num(h, a[0], 1, "random")? {
            Num::Real(f) => Ok(Value::Real(f * (r as f64 / u64::MAX as f64))),
            n => {
                let m = num_to_f64(&n) as i64;
                if m <= 0 {
                    return err("random: argument must be positive");
                }
                Ok(Value::Int((r % m as u64) as i64))
            }
        }
    }),
    ("runtime", |_, _, _| Ok(Value::Real(runtime_seconds()))),
    ("display", |h, a, out, | {
        check_arity("display", a, 1)?;
        out.push_str(&crate::printer::display(h, a[0]));
        Ok(Value::Unspecified)
    }),
    ("write", |h, a, out| {
        check_arity("write", a, 1)?;
        out.push_str(&print(h, a[0]));
        Ok(Value::Unspecified)
    }),
    ("newline", |_, _, out| {
        out.push('\n');
        Ok(Value::Unspecified)
    }),
    ("error", |h, a, _| {
        let msg = a.first().map(|v| crate::printer::display(h, *v)).unwrap_or_default();
        let irritants = a.iter().skip(1).map(|v| print(h, *v)).collect();
        Err(SchemeError { message: msg, irritants, span: None })
    }),
    ("symbol->string", |h, a, _| match a.first() {
        Some(Value::Sym(i)) => {
            let s = h.sym_name(*i).to_string();
            Ok(Value::Str(h.alloc(Cell::Str(s))))
        }
        Some(v) => wrong_type(h, *v, 1, "symbol->string"),
        None => err("symbol->string: needs 1 argument"),
    }),
    ("string->symbol", |h, a, _| match a.first() {
        Some(Value::Str(i)) => {
            let s = match h.get(*i) { Cell::Str(s) => s.clone(), _ => unreachable!() };
            Ok(Value::Sym(h.intern(&s)))
        }
        Some(v) => wrong_type(h, *v, 1, "string->symbol"),
        None => err("string->symbol: needs 1 argument"),
    }),
    ("number->string", |h, a, _| {
        let s = crate::printer::display(h, a[0]);
        Ok(Value::Str(h.alloc(Cell::Str(s))))
    }),
    ("string->number", |h, a, _| match a.first() {
        Some(Value::Str(i)) => {
            let s = match h.get(*i) { Cell::Str(s) => s.clone(), _ => unreachable!() };
            match crate::reader::parse_atom(&s, h) {
                Value::Sym(_) => Ok(Value::Bool(false)),
                v => Ok(v),
            }
        }
        _ => Ok(Value::Bool(false)),
    }),
    ("string-append", |h, a, _| {
        let mut s = String::new();
        for v in a {
            if let Value::Str(i) = v {
                if let Cell::Str(t) = h.get(*i) {
                    s.push_str(t);
                }
            } else {
                return wrong_type(h, *v, 1, "string-append");
            }
        }
        Ok(Value::Str(h.alloc(Cell::Str(s))))
    }),
    ("string-length", |h, a, _| match a.first() {
        Some(Value::Str(i)) => Ok(Value::Int(match h.get(*i) { Cell::Str(s) => s.chars().count() as i64, _ => 0 })),
        Some(v) => wrong_type(h, *v, 1, "string-length"),
        None => err("string-length: needs 1 argument"),
    }),
    ("string=?", |h, a, _| {
        check_arity("string=?", a, 2)?;
        Ok(Value::Bool(equal(h, a[0], a[1])))
    }),
    ("length", |h, a, _| {
        check_arity("length", a, 1)?;
        match h.list_to_vec(a[0]) {
            Some(v) => Ok(Value::Int(v.len() as i64)),
            None => wrong_type(h, a[0], 1, "length"),
        }
    }),
    ("append", |h, a, _| {
        if a.is_empty() {
            return Ok(Value::Nil);
        }
        let mut items = Vec::new();
        for v in &a[..a.len() - 1] {
            items.extend(h.list_to_vec(*v).ok_or_else(|| SchemeError { message: format!("The object {}, passed as an argument to append, is not a list.", print(h, *v)), irritants: vec![], span: None })?);
        }
        let mut acc = *a.last().unwrap();
        for v in items.into_iter().rev() {
            acc = h.cons(v, acc);
        }
        Ok(acc)
    }),
    ("reverse", |h, a, _| {
        check_arity("reverse", a, 1)?;
        let mut items = h.list_to_vec(a[0]).ok_or_else(|| SchemeError { message: "reverse: not a list".into(), irritants: vec![], span: None })?;
        items.reverse();
        Ok(h.list(&items))
    }),
    ("list-ref", |h, a, _| {
        check_arity("list-ref", a, 2)?;
        let items = h.list_to_vec(a[0]).ok_or_else(|| SchemeError { message: "list-ref: not a list".into(), irritants: vec![], span: None })?;
        match a[1] {
            Value::Int(i) if i >= 0 && (i as usize) < items.len() => Ok(items[i as usize]),
            _ => wrong_type(h, a[1], 2, "list-ref"),
        }
    }),
    ("memq", |h, a, _| member_generic(h, a, "memq", eqv)),
    ("member", |h, a, _| member_generic(h, a, "member", equal)),
    ("assq", |h, a, _| assoc_generic(h, a, "assq", eqv)),
    ("assoc", |h, a, _| assoc_generic(h, a, "assoc", equal)),
    ("not", |_, a, _| Ok(Value::Bool(a.first() == Some(&Value::Bool(false))))),
    ("list?", |h, a, _| Ok(Value::Bool(h.list_to_vec(a[0]).is_some()))),
    ("promise?", |_, a, _| Ok(Value::Bool(matches!(a.first(), Some(Value::Promise(_)))))),
    ("1+", |h, a, _| Ok(from_num(h, num_add(to_num(h, a[0], 1, "1+")?, Num::Int(1))))),
    ("-1+", |h, a, _| Ok(from_num(h, num_sub(to_num(h, a[0], 1, "-1+")?, Num::Int(1))))),
    ("void", |_, _, _| Ok(Value::Unspecified)),
    ("gc-flip", |_, _, _| Ok(Value::Unspecified)),
    ("user-initial-environment", |_, _, _| err("internal: replaced at install")),
];

pub fn prim_name(p: u16) -> &'static str {
    PRIMS.get(p as usize).map(|(n, _)| *n).unwrap_or("?")
}

pub fn call(p: u16, heap: &mut Heap, args: &[Value], out: &mut String) -> Result<Value> {
    match PRIMS.get(p as usize) {
        Some((_, f)) => f(heap, args, out),
        None => err(format!("Unknown primitive {}", p)),
    }
}

pub fn install(heap: &mut Heap, env: Idx) {
    for (i, (name, _)) in PRIMS.iter().enumerate() {
        let sym = heap.intern(name);
        heap.define(env, sym, Value::Prim(i as u16));
    }
    let callcc = heap.intern("call/cc");
    heap.define(env, callcc, Value::Prim(PRIM_CALLCC));
    let uie = heap.intern("user-initial-environment");
    heap.define(env, uie, Value::Env(env));
    let empty = heap.intern("the-empty-stream");
    heap.define(env, empty, Value::Nil);
    let t = heap.intern("true");
    heap.define(env, t, Value::Bool(true));
    let f = heap.intern("false");
    heap.define(env, f, Value::Bool(false));
    let nil = heap.intern("nil");
    heap.define(env, nil, Value::Nil);
}

// ---------- numeric tower ----------

#[derive(Clone, Debug)]
pub enum Num {
    Int(i64),
    Big(BigInt),
    Rat(BigRational),
    Real(f64),
}

pub fn make_rational(heap: &mut Heap, r: BigRational) -> Value {
    from_num(heap, Num::Rat(r))
}

fn to_num(h: &Heap, v: Value, argno: usize, who: &str) -> Result<Num> {
    match v {
        Value::Int(i) => Ok(Num::Int(i)),
        Value::Big(i) => match h.get(i) { Cell::Big(b) => Ok(Num::Big(b.clone())), _ => unreachable!() },
        Value::Rat(i) => match h.get(i) { Cell::Rat(r) => Ok(Num::Rat(r.clone())), _ => unreachable!() },
        Value::Real(f) => Ok(Num::Real(f)),
        other => wrong_type(h, other, argno, who),
    }
}

fn normalize(n: Num) -> Num {
    match n {
        Num::Big(b) => match b.to_i64() { Some(i) => Num::Int(i), None => Num::Big(b) },
        Num::Rat(r) => {
            if r.is_integer() {
                normalize(Num::Big(r.to_integer()))
            } else {
                Num::Rat(r)
            }
        }
        other => other,
    }
}

fn from_num(h: &mut Heap, n: Num) -> Value {
    match normalize(n) {
        Num::Int(i) => Value::Int(i),
        Num::Big(b) => Value::Big(h.alloc(Cell::Big(b))),
        Num::Rat(r) => Value::Rat(h.alloc(Cell::Rat(r))),
        Num::Real(f) => Value::Real(f),
    }
}

fn num_to_f64(n: &Num) -> f64 {
    match n {
        Num::Int(i) => *i as f64,
        Num::Big(b) => b.to_f64().unwrap_or(f64::INFINITY),
        Num::Rat(r) => r.to_f64().unwrap_or(f64::NAN),
        Num::Real(f) => *f,
    }
}

fn to_rat(n: &Num) -> BigRational {
    match n {
        Num::Int(i) => BigRational::from_integer(BigInt::from(*i)),
        Num::Big(b) => BigRational::from_integer(b.clone()),
        Num::Rat(r) => r.clone(),
        Num::Real(_) => unreachable!(),
    }
}

fn binop(a: Num, b: Num, int_op: fn(i64, i64) -> Option<i64>, rat_op: fn(BigRational, BigRational) -> BigRational, f_op: fn(f64, f64) -> f64) -> Num {
    match (&a, &b) {
        (Num::Real(_), _) | (_, Num::Real(_)) => Num::Real(f_op(num_to_f64(&a), num_to_f64(&b))),
        (Num::Int(x), Num::Int(y)) => match int_op(*x, *y) {
            Some(r) => Num::Int(r),
            None => normalize(Num::Rat(rat_op(to_rat(&a), to_rat(&b)))),
        },
        _ => normalize(Num::Rat(rat_op(to_rat(&a), to_rat(&b)))),
    }
}

fn num_add(a: Num, b: Num) -> Num { binop(a, b, i64::checked_add, |x, y| x + y, |x, y| x + y) }
fn num_sub(a: Num, b: Num) -> Num { binop(a, b, i64::checked_sub, |x, y| x - y, |x, y| x - y) }
fn num_mul(a: Num, b: Num) -> Num { binop(a, b, i64::checked_mul, |x, y| x * y, |x, y| x * y) }
fn num_div(a: Num, b: Num) -> Result<Num> {
    let zero = matches!(b, Num::Int(0)) || matches!(&b, Num::Big(z) if z.is_zero());
    if zero {
        return err("Division by zero signalled by /.");
    }
    Ok(match (&a, &b) {
        (Num::Real(_), _) | (_, Num::Real(_)) => Num::Real(num_to_f64(&a) / num_to_f64(&b)),
        _ => normalize(Num::Rat(to_rat(&a) / to_rat(&b))),
    })
}

fn num_cmp(a: &Num, b: &Num) -> std::cmp::Ordering {
    match (a, b) {
        (Num::Int(x), Num::Int(y)) => x.cmp(y),
        (Num::Real(_), _) | (_, Num::Real(_)) => num_to_f64(a).partial_cmp(&num_to_f64(b)).unwrap_or(std::cmp::Ordering::Equal),
        _ => to_rat(a).cmp(&to_rat(b)),
    }
}

fn fold_num(h: &mut Heap, a: &[Value], init: Num, op: fn(Num, Num) -> Num) -> Result<Value> {
    let mut acc = init;
    for (i, v) in a.iter().enumerate() {
        acc = op(acc, to_num(h, *v, i + 1, "arith")?);
    }
    Ok(from_num(h, acc))
}

fn compare(h: &Heap, a: &[Value], who: &str, ok: fn(std::cmp::Ordering) -> bool) -> Result<Value> {
    if a.len() < 2 {
        return err(format!("{} has been called with {} arguments; it requires at least 2 arguments.", who, a.len()));
    }
    for i in 0..a.len() - 1 {
        let x = to_num(h, a[i], i + 1, who)?;
        let y = to_num(h, a[i + 1], i + 2, who)?;
        if !ok(num_cmp(&x, &y)) {
            return Ok(Value::Bool(false));
        }
    }
    Ok(Value::Bool(true))
}

fn to_bigint(h: &Heap, v: Value, argno: usize, who: &str) -> Result<BigInt> {
    match to_num(h, v, argno, who)? {
        Num::Int(i) => Ok(BigInt::from(i)),
        Num::Big(b) => Ok(b),
        Num::Real(f) if f.fract() == 0.0 => Ok(BigInt::from(f as i64)),
        _ => wrong_type(h, v, argno, who),
    }
}

fn int_op(h: &mut Heap, a: &[Value], who: &str, f: fn(BigInt, BigInt) -> BigInt) -> Result<Value> {
    check_arity(who, a, 2)?;
    let y = to_bigint(h, a[1], 2, who)?;
    if y.is_zero() && who != "gcd" {
        return err(format!("Division by zero signalled by {}.", who));
    }
    let x = to_bigint(h, a[0], 1, who)?;
    let inexact = matches!(a[0], Value::Real(_)) || matches!(a[1], Value::Real(_));
    let r = f(x, y);
    if inexact {
        Ok(Value::Real(r.to_f64().unwrap_or(0.0)))
    } else {
        Ok(from_num(h, Num::Big(r)))
    }
}

fn int_pred(h: &Heap, a: &[Value], who: &str, f: fn(&BigInt) -> bool) -> Result<Value> {
    check_arity(who, a, 1)?;
    Ok(Value::Bool(f(&to_bigint(h, a[0], 1, who)?)))
}

fn float1(h: &Heap, a: &[Value], who: &str, f: fn(f64) -> f64) -> Result<Value> {
    check_arity(who, a, 1)?;
    let n = to_num(h, a[0], 1, who)?;
    if let Num::Int(0) = n {
        if who == "exp" {
            return Ok(Value::Int(1));
        }
    }
    Ok(Value::Real(f(num_to_f64(&n))))
}

fn round_op(h: &mut Heap, a: &[Value], who: &str, f: fn(f64) -> f64) -> Result<Value> {
    check_arity(who, a, 1)?;
    match to_num(h, a[0], 1, who)? {
        Num::Real(x) => Ok(Value::Real(f(x))),
        Num::Rat(r) => {
            let x = r.to_f64().unwrap_or(0.0);
            Ok(from_num(h, Num::Big(BigInt::from(f(x) as i64))))
        }
        n => Ok(from_num(h, n)),
    }
}

fn extremum(h: &mut Heap, a: &[Value], who: &str, want: std::cmp::Ordering) -> Result<Value> {
    if a.is_empty() {
        return err(format!("{}: needs at least 1 argument", who));
    }
    let mut best = to_num(h, a[0], 1, who)?;
    let mut inexact = matches!(best, Num::Real(_));
    for (i, v) in a[1..].iter().enumerate() {
        let n = to_num(h, *v, i + 2, who)?;
        inexact |= matches!(n, Num::Real(_));
        if num_cmp(&n, &best) == want {
            best = n;
        }
    }
    if inexact {
        Ok(Value::Real(num_to_f64(&best)))
    } else {
        Ok(from_num(h, best))
    }
}

// ---------- equality ----------

pub fn eqv(h: &Heap, a: Value, b: Value) -> bool {
    match (a, b) {
        (Value::Big(x), Value::Big(y)) => matches!((h.get(x), h.get(y)), (Cell::Big(p), Cell::Big(q)) if p == q),
        (Value::Rat(x), Value::Rat(y)) => matches!((h.get(x), h.get(y)), (Cell::Rat(p), Cell::Rat(q)) if p == q),
        (Value::Str(x), Value::Str(y)) => x == y,
        _ => a == b,
    }
}

pub fn equal(h: &Heap, a: Value, b: Value) -> bool {
    let mut stack = vec![(a, b)];
    while let Some((a, b)) = stack.pop() {
        match (a, b) {
            (Value::Pair(x), Value::Pair(y)) => {
                if x == y {
                    continue;
                }
                let (a1, d1) = match h.get(x) { Cell::Pair(a, d) => (*a, *d), _ => unreachable!() };
                let (a2, d2) = match h.get(y) { Cell::Pair(a, d) => (*a, *d), _ => unreachable!() };
                stack.push((d1, d2));
                stack.push((a1, a2));
            }
            (Value::Str(x), Value::Str(y)) => {
                if !matches!((h.get(x), h.get(y)), (Cell::Str(p), Cell::Str(q)) if p == q) {
                    return false;
                }
            }
            _ => {
                if !eqv(h, a, b) {
                    return false;
                }
            }
        }
    }
    true
}

// ---------- helpers ----------

fn check_arity(who: &str, a: &[Value], n: usize) -> Result<()> {
    if a.len() != n {
        return err(format!("The procedure #[compiled-procedure {}] has been called with {} argument{}; it requires exactly {} argument{}.", who, a.len(), if a.len() == 1 { "" } else { "s" }, n, if n == 1 { "" } else { "s" }));
    }
    Ok(())
}

fn ordinal(n: usize) -> &'static str {
    ["zeroth", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth"].get(n).copied().unwrap_or("nth")
}

pub fn wrong_type<T>(h: &Heap, v: Value, argno: usize, who: &str) -> Result<T> {
    err(format!("The object {}, passed as the {} argument to {}, is not the correct type.", print(h, v), ordinal(argno), who))
}

fn pair_part(h: &Heap, a: &[Value], who: &str, car: bool) -> Result<Value> {
    check_arity(who, a, 1)?;
    match a[0] {
        Value::Pair(i) => match h.get(i) {
            Cell::Pair(x, y) => Ok(if car { *x } else { *y }),
            _ => unreachable!(),
        },
        v => wrong_type(h, v, 1, who),
    }
}

fn member_generic(h: &Heap, a: &[Value], who: &str, eq: fn(&Heap, Value, Value) -> bool) -> Result<Value> {
    check_arity(who, a, 2)?;
    let mut cur = a[1];
    while let Value::Pair(_) = cur {
        if eq(h, a[0], h.car(cur).unwrap()) {
            return Ok(cur);
        }
        cur = h.cdr(cur).unwrap();
    }
    Ok(Value::Bool(false))
}

fn assoc_generic(h: &Heap, a: &[Value], who: &str, eq: fn(&Heap, Value, Value) -> bool) -> Result<Value> {
    check_arity(who, a, 2)?;
    let mut cur = a[1];
    while let Value::Pair(_) = cur {
        let entry = h.car(cur).unwrap();
        if let Some(k) = h.car(entry) {
            if eq(h, a[0], k) {
                return Ok(entry);
            }
        }
        cur = h.cdr(cur).unwrap();
    }
    Ok(Value::Bool(false))
}

// Deterministic xorshift so tests are reproducible; the host may reseed via `seed_random`.
static mut RNG: u64 = 0x9E3779B97F4A7C15;
pub fn seed_random(s: u64) {
    unsafe { RNG = if s == 0 { 1 } else { s } }
}
fn next_random() -> u64 {
    unsafe {
        let mut x = RNG;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        RNG = x;
        x
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn runtime_seconds() -> f64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}
#[cfg(target_arch = "wasm32")]
fn runtime_seconds() -> f64 {
    // Filled in by the host via `set_runtime_hook` in wasm.rs; default is a monotonic step count.
    crate::wasm::runtime_seconds()
}

#[allow(dead_code)]
fn _touch() {
    let _ = BigInt::one();
    let _ = BigInt::from(1).is_positive();
}
