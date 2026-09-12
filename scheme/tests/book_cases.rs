//! Snapshot runner: every tests/cases/*.scm is evaluated in a fresh session and the transcript
//! is compared with the sibling .expected file. Run with UPDATE=1 to rewrite expectations.

use sicp_scheme::Session;
use std::fs;
use std::path::Path;

#[test]
fn book_cases() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/cases");
    let mut failures = Vec::new();
    let mut entries: Vec<_> = fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.extension().map(|x| x == "scm").unwrap_or(false)).collect();
    entries.sort();
    assert!(!entries.is_empty(), "no cases found");
    for scm in entries {
        let src = fs::read_to_string(&scm).unwrap();
        let expected_path = scm.with_extension("expected");
        let mut s = Session::new();
        let got = s.transcript(&src);
        if std::env::var("UPDATE").is_ok() {
            fs::write(&expected_path, &got).unwrap();
            continue;
        }
        let expected = fs::read_to_string(&expected_path).unwrap_or_default();
        if got != expected {
            failures.push(format!("--- {}\nexpected:\n{}\ngot:\n{}", scm.display(), expected, got));
        }
    }
    if !failures.is_empty() {
        panic!("{} case(s) failed:\n{}", failures.len(), failures.join("\n"));
    }
}

#[test]
fn deep_recursion_does_not_overflow() {
    let mut s = Session::new();
    let t = s.transcript("(define (count n) (if (= n 0) 0 (+ 1 (count (- n 1))))) (count 200000)");
    assert!(t.contains(";Value: 200000"), "{}", t);
}

#[test]
fn tail_calls_run_in_constant_space() {
    let mut s = Session::new();
    let t = s.transcript("(define (loop n acc) (if (= n 0) acc (loop (- n 1) (+ acc 1)))) (loop 3000000 0)");
    assert!(t.contains(";Value: 3000000"), "{}", t);
    assert!(s.heap.capacity() < 5_000_000, "heap grew to {}", s.heap.capacity());
}

#[test]
fn interrupt_and_resume() {
    use sicp_scheme::Status;
    let mut s = Session::new();
    let st = s.eval("(define (f n) (if (= n 0) 'ok (f (- n 1)))) (f 1000000)", 1000);
    assert_eq!(st, Status::Paused);
    let mut st = s.resume(1_000_000);
    while st == Status::Paused {
        st = s.resume(1_000_000);
    }
    assert!(matches!(st, Status::Done { .. }), "{:?}", st);
}
