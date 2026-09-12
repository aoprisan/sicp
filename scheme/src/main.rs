//! Native CLI: `sicp-scheme file.scm` prints an MIT-style transcript; no args → simple REPL.

use sicp_scheme::Session;
use std::io::{self, BufRead, Write};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut s = Session::new();
    if let Some(path) = args.get(1) {
        let src = std::fs::read_to_string(path).expect("read file");
        print!("{}", s.transcript(&src));
        return;
    }
    let stdin = io::stdin();
    let mut buf = String::new();
    loop {
        print!("1 ]=> ");
        io::stdout().flush().unwrap();
        let mut line = String::new();
        if stdin.lock().read_line(&mut line).unwrap() == 0 {
            break;
        }
        buf.push_str(&line);
        if balanced(&buf) {
            print!("{}", s.transcript(&buf));
            buf.clear();
        }
    }
}

fn balanced(s: &str) -> bool {
    let mut d = 0i32;
    for c in s.chars() {
        match c {
            '(' | '[' => d += 1,
            ')' | ']' => d -= 1,
            _ => {}
        }
    }
    d <= 0
}
