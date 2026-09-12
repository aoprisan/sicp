# SICP PWA — specification

## 1. Interpreter (`scheme/`)

### 1.1 Dialect
The subset of MIT Scheme that the book uses. Not R7RS. Non-standard forms the book relies on are
first-class:

| Form / primitive | Chapter | Notes |
|---|---|---|
| `define` (both forms, incl. curried `(define ((f a) b) …)`), `lambda`, `if`, `cond` (+ `else`, `=>`), `and`, `or`, `let`, `let*`, `letrec`, `begin`, `quote`/`'`, `set!` | 1–3 | internal defines scanned out to the frame |
| `cons-stream` | 3.5 | special form; `(cons a (delay b))`, memoised |
| `delay`, `force`, `make-promise` | 3.5 | memoised |
| `the-empty-stream`, `stream-null?`, `stream-car`, `stream-cdr` | 3.5 | prelude |
| `set-car!`, `set-cdr!` | 3.3 | mutation → cycles → GC required |
| `apply`, `eval` (with env arg), `the-environment`, `user-initial-environment` | 4 | needed by metacircular evaluator |
| `error` (message + irritants), `runtime`, `random`, `display`, `newline` | 1–5 | |
| `call/cc` | — | free with CEK; optional |
| `assoc`, `assq`, `member`, `memq`, `append`, `length`, `list-ref`, `reverse`, `map` (n-ary), `for-each`, `filter`, `reduce`/`fold-left`/`fold-right`, `list-copy`, `last-pair` | 2 | prelude in Scheme where possible |
| `number?`, `symbol?`, `string?`, `pair?`, `null?`, `procedure?`, `boolean?` | 2–4 | |
| `eq?`, `eqv?`, `equal?` | 2 | `eq?` on pairs is handle identity |
| `symbol->string`, `string->symbol`, `number->string`, `string-append` | 2 | |
| `exact->inexact`, `inexact->exact`, `quotient`, `remainder`, `modulo`, `gcd`, `abs`, `min`, `max`, `sqrt`, `exp`, `log`, `sin`, `cos`, `atan`, `expt`, `floor`, `round`, `truncate`, `even?`, `odd?`, `zero?`, `positive?`, `negative?`, `=`, `<`, `>`, `<=`, `>=`, `1+`, `-1+` | 1 | |
| `vector?`, `make-vector`, `vector`, `vector-length`, `vector-ref`, `vector-set!`, `vector->list`, `list->vector`, `vector-fill!`, `vector-grow`, `subvector`, `vector-map`, `vector-for-each`, `#(...)` literals | 5.3 | the register machine's memory model; `make-vector` fills with `#f` like MIT, `equal?` compares element-wise |
| picture language: `make-vect`, `vector-xcor`, …, `make-frame`, `make-segment`, `segments->painter`, `paint`, `wave`, `rogers`, `einstein` primitives | 2.2.4 | `paint` returns a `Picture` value; host renders |

Prelude (`scheme/prelude.scm`) defines `square`, `cube`, `average`, `inc`, `dec`, `identity`,
`compose`, `accumulate`, `enumerate-interval`, `flatmap`, every `c[ad]{2,4}r` composition,
`vector-map`/`vector-for-each` (a primitive cannot apply a Scheme procedure), and the stream
helpers — all visible to users.

### 1.2 Values & heap
```
enum Value { Nil, Bool, Int(i64), Big(idx), Rat(idx), Real(f64), Sym(idx), Str(idx),
             Pair(idx), Closure(idx), Prim(u16), Promise(idx), Env(idx), Cont(idx),
             Picture(idx), Vector(idx), Unspecified, Eof }
```
- `Heap` = `Vec<Cell>` arena with free list; handles are `u32`.
- `Cell::Vector(Vec<Value>)` for vectors; the mark phase traces into their elements, so a
  vector can be the only thing keeping its contents alive.
- Mark/sweep, roots = current CEK state + globals + host-pinned handles. GC runs when allocation
  count since last GC exceeds threshold; never mid-primitive.
- Symbols interned in a `Vec<String>` + `HashMap`.
- Integers: `i64` fast path, promote to `num_bigint::BigInt` on overflow; `num_rational::Ratio` for
  exact division. Printing follows MIT: `1/3`, `3.`, `.5`, `1e100`.

### 1.3 Evaluator
CEK machine: `(control, env, kont)` stepped in a loop. Continuation frames are heap-allocated
(so `call/cc` and GC work). Tail calls: `Apply` on a closure replaces control/env without pushing.
`step(budget) -> Status { Done(Value) | Paused | Error(SchemeError) | Output(String) }` so the
host can interleave output and interrupt.

### 1.4 Errors
MIT-style messages: `;Unbound variable: foo`, `;The object (), passed as the first argument to
car, is not the correct type.`, `;Aborting!: maximum recursion depth exceeded` (for the cases the
book deliberately triggers). Errors carry the offending datum and, when available, a source span
from the reader (byte offsets into the buffer).

### 1.5 WASM API (`--features wasm`)
```
new_session() -> SessionId
drop_session(session)
eval_source(session, src: &str, budget: u32) -> JSON { status, output, values, error, span }
resume(session, budget) -> same
interrupt(session)
env_names(session) -> [String]         // for the "recent" radial wedge
form_at_cursor(src, cursor) -> JSON { head, depth, span }   // context-sensitive radial menu
gc_stats(session) -> { live, capacity }
set_runtime(seconds)                   // host clock, so `(runtime)` works in the sandbox
```

### 1.6 Tests
`scheme/tests/cases/<chapter>_<name>.scm` with a paired `.expected` holding the transcript that
MIT Scheme would print. Runner evaluates each top-level form, appends printed value/output, diffs.
Seed cases are in `tests/cases/`; the book pipeline can emit more (`just book` writes
`book/generated-cases/`, review before promoting).

## 2. Book pipeline (`book/`)
- Source: https://github.com/sarabander/sicp (CC BY-SA 4.0 HTML5 edition with SVG figures).
  `fetch.sh` clones to `book/src/` (gitignored).
- `build_chunks.mjs`: parse `html/`, split by `<h3>`/exercise, emit
  `app/public/book/{toc.json, chunks/<id>.json}`. Each chunk: `{id, title, breadcrumb[], html,
  code[]: {id, src, expected?}, exercises[]: {id, html, referencedCode[]}}`.
- Figures copied as SVG into `app/public/book/fig/`. The book embeds them as
  `<object data="fig/…svg">`; the builder rewrites each one to
  `<img class="fig" data-src="fig/…svg" alt="Figure n.m">` and the reader sets `src` to
  `${BASE_URL}book/<data-src>` after injecting the chunk. Chunks therefore stay base-agnostic
  (same JSON serves `/` and `/sicp/`), and a stale relative URL can no longer fall back to
  `index.html` and load the whole app inside a figure box. Math already rendered (MathJax → keep,
  or pre-render to SVG with `mathjax-node` at build).
- Sanitise HTML with `sanitize-html`; strip nav.

## 3. App (`app/`)
### 3.1 Layout
- Portrait: reader full-bleed; REPL as a bottom sheet with three snap points (peek 56px, half,
  full). Landscape/tablet: split view.
- Reader: sticky breadcrumb, footnotes as bottom sheets, code blocks with `Run` and `→ scratch`.
- Each `Run` evaluates in the session and shows result inline under the block.
### 3.2 Editor
- Plain textarea under the hood (`autocorrect=off autocapitalize=off spellcheck=false`),
  overlay-rendered highlighting, rainbow depth for the enclosing form.
- Custom key row: `( ) ' [ ] ; ← → ⏎ run kill`.
- Auto-close `(`; Scheme-aware indentation on Enter; slurp/barf/wrap/unwrap buttons.
- Radial selector (`src/editor/radial.ts`): long-press or thumb button opens a ring anchored in a
  configurable thumb zone; wedges depend on `form_at(cursor)`; templates with `▢` holes; "next
  hole" gesture; second ring for recent identifiers from `env_names`. Haptics via
  `navigator.vibrate` where available.
### 3.3 Worker protocol
```
→ {type:'eval', id, src, budget}
← {type:'output', id, text} | {type:'result', id, value} | {type:'error', id, message, span}
  | {type:'paused', id}   // host replies {type:'resume', id} or {type:'interrupt', id}
  | {type:'picture', id, ops:[...]}
```
Budget ≈ 200k steps per slice; the worker yields so `interrupt` can land.
### 3.4 Persistence
IndexedDB (`idb`): `buffers` keyed by exercise id, `sessions` (last transcript), `settings`.
Export all buffers as a single `.scm`.
### 3.5 Offline
Vite PWA plugin; precache app + wasm + all chunks + figures. Update prompt on new SW.

## 4. Non-goals (v1)
Multiplayer, accounts, server-side anything, R7RS conformance, `define-syntax`.
