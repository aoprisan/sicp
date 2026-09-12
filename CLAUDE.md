# SICP PWA — project brief for Claude Code

Goal: bundle *Structure and Interpretation of Computer Programs* (2nd ed., CC BY-SA 4.0)
into an offline-first PWA with a Scheme interpreter written from scratch in Rust → WASM,
so the whole book is readable *and workable* on a phone.

Owner: Andrei (aoprisan). Stack: Rust (interpreter), TypeScript + Vite (shell), GitHub Pages.
Workflow: everything runs through the `justfile`. Read `docs/SPEC.md` before touching code.

## Layout
- `scheme/` — Rust crate `sicp-scheme`. CEK evaluator, arena heap + mark/sweep GC, bignum/rational
  numerics, MIT-Scheme-style printer. Compiled with `wasm-pack` to `app/src/wasm/`.
- `book/`  — pipeline that fetches the BY-SA text (sarabander/sicp) and emits JSON chunks into
  `app/public/book/`. The book text is NOT committed; run `just book`. Everything derived from it is
  CC BY-SA 4.0 — see `book/ATTRIBUTION.md`.
- `app/`   — PWA shell: reader, editor with radial selector, REPL worker, service worker.
- `docs/`  — spec, decisions, design notes.

## Licensing (do not mix)
- Code under `scheme/`, `app/`, `book/scripts/`: MIT.
- Book text and every adaptation of it (chunks, rendered HTML, extracted code snippets in
  `scheme/tests/cases/`): CC BY-SA 4.0 with attribution to Abelson, Sussman, Sussman / MIT Press.

## Conventions
- No recursive `eval` on the host stack. The evaluator is an explicit-continuation loop (see
  `scheme/src/eval.rs`). Deep recursion in user code must never overflow the WASM stack.
- Proper tail calls are a hard requirement. Add a test for every tail-position construct.
- Heap objects are indexed handles into an arena, not `Rc`. Mutation (`set-car!`) creates cycles.
- Printer output must match MIT Scheme where the book shows output (`(1 . 2)`, `#t`, `1/3`,
  `#[compound-procedure 12 fib]`).
- Every book code example gets a snapshot test in `scheme/tests/cases/` (`*.scm` + `*.expected`).
- The interpreter runs in a Web Worker with a step budget; the UI must always be able to kill it.
- Mobile first. Test layouts at 360×640 before anything else.

## Phases (do them in order, one PR-sized commit each)
1. `scheme/`: reader + values + heap + CEK eval + ch.1 primitives. `just test` green on `ch1_*` cases.
2. Numerics: bignum + rationals + floats with MIT-style printing.
3. Ch.2/3 primitives, `cons-stream`/`delay`/`force`, `set-car!`/`set-cdr!`, `apply`, `error`, GC.
4. wasm-pack build + worker protocol (`docs/SPEC.md` § worker).
5. `book/` pipeline → chunks. Reader UI.
6. Editor: custom key row, auto-close, indentation, radial selector (port of `app/src/editor/radial.ts`).
7. Inline "Run"/"→ scratch" on every code block; per-exercise buffers in IndexedDB.
8. Picture language canvas backend; service worker precache; Pages deploy.
