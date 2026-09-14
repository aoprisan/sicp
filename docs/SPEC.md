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
- Source: https://github.com/sarabander/sicp (CC BY-SA 4.0 HTML5 edition with SVG figures),
  the edition published at https://sarabander.github.io/sicp, itself prepared from the MIT Press
  text at https://mitpress.mit.edu/sicp. `fetch.sh` clones to `book/src/` (gitignored).
  Those URLs live in one `SOURCE` constant in `build_chunks.mjs` and are copied into `toc.json`,
  so the app can name its source without hard-coding it twice.
- `build_chunks.mjs`: parse `html/`, split by `<h3>`/exercise, emit
  `app/public/book/{toc.json, chunks/<id>.json}`. Each chunk: `{id, title, breadcrumb[], html,
  code[]: {id, src, expected?}, exercises[]: {id, html, referencedCode[]}}`.
- `toc.json` is the book's outline, and the app's menu is built from it: each entry is
  `{id, title, file, label, level}`. `label` is the name the book gives that part ("1.1 The
  Elements of Programming" — better than the `<title>`, which is just "1.1"), and `level` is 0 for
  front matter, chapters and back matter, 1 for the sections inside a chapter.
- Chunks are numbered in the book's reading order, not in `readdir` order: Texinfo's filenames
  sort `1_002e1.xhtml` ahead of the title page, which would open the app at §1.1. Order, labels
  and levels all come from the table of contents in `index.xhtml`; any file it does not mention is
  appended. Entries below section level (1.1.3 and the like) are anchors inside a file already
  listed, so the outline stops where the chunks stop.
- `c000` is a generated cover — title, byline, the edition's cover plate
  (`fig/bookwheel.jpg`), a link into the title page, and the provenance CC BY-SA asks for, with
  links out to the MIT Press text and to the edition. The book's own files start at `c001`
  (`index.xhtml`, the title page and table of contents). External links on the cover carry
  `target="_blank" rel="noreferrer"` — a PWA cannot navigate back after leaving in place.
- Figures copied as SVG into `app/public/book/fig/`. The book embeds them as
  `<object data="fig/…svg">`; the builder rewrites each one to
  `<img class="fig" data-src="fig/…svg" alt="Figure n.m">` and the reader sets `src` to
  `${BASE_URL}book/<data-src>` after injecting the chunk. Chunks therefore stay base-agnostic
  (same JSON serves `/` and `/sicp/`), and a stale relative URL can no longer fall back to
  `index.html` and load the whole app inside a figure box.
- Formulas are the edition's own MathML, kept as markup and laid out by the browser. The builder
  wraps each one in `<span class="math">`, or `<span class="math-block">` where the source says
  `display="block"`, and that wrapper — never `<math>` itself — carries what a 360px column needs:
  the clamp that keeps a formula set late in a line from pushing the page sideways, and the
  horizontal scroll for a displayed one too wide to fit. A browser lays MathML out with its math
  engine only for as long as the element keeps the `display` it was born with; override it, to
  `inline-block` or to `block` alike, and the formula falls back to ordinary CSS boxes — fraction
  bars ruled across the column, a summation's limits stacked underneath the sign. A span rather
  than a div because the book sets displayed equations inside the paragraph that introduces them.
- The Texinfo nav bars and jump-to-top arrows are dropped, `<script>` tags stripped, and
  cross-references (`1_002e3.xhtml#…`) rewritten to the chunk hash (`#c002`) so links stay inside
  the app. `breadcrumb` is the running head: `[number, title]` from the section heading.
- The edition's webfonts (Linux Libertine/Biolinum, Inconsolata LGC, STIX) are copied to
  `app/public/book/fonts/` with `font-display: swap`, and loaded from `index.html`; the reader is
  set in the same faces as the book, offline. Licences ship alongside (see `book/ATTRIBUTION.md`).
- Sanitise HTML with `sanitize-html`.

## 3. App (`app/`)
### 3.1 Layout
- Portrait: reader full-bleed; REPL as a bottom sheet with three snap points (peek 56px, half,
  full). Landscape/tablet: split view.
- Reader: sticky running head, footnotes as bottom sheets, code blocks with `Run` and `→ scratch`.
- Navigation (`src/contents.ts`) is by hash, so every route is an ordinary link and the back
  button and bookmarks work: the running head carries the menu button, which opens the contents as
  a drawer over the page — the whole outline, sections indented under their chapter, the current
  entry marked and scrolled to. It closes on Escape, on the veil, on its own × (the veil covers
  the header, so the button that opened it cannot close it), and on picking an entry; while it is
  open the book and the bench are `inert`. Under each chunk, page-turn links to the previous and
  next entry in the same outline. Above the outline, on its own list and ruled off from it, the
  drawer carries the one entry that is not a chunk: `λ Scheme interpreter`.
- Two views, both hashes (`src/main.ts` `route()`), so the menu's entries stay ordinary links and
  the back button walks between them: the book (`#c000`…), and `#scheme` — the interpreter alone,
  the sheet no longer a sheet but the whole screen under the running head, with no handle and no
  snap points (`body.view-bench`). The bench view needs no book: its menu entry is there before
  `just book` has written a chunk, which is also the one way into the app when there is no text
  to read. Leaving the book does not unload it — the reader reloads a chunk only when the id
  changes (`Reader.at`), so coming back lands on the same page, at the same scroll, with the
  results each `Run` printed still under their listings.
- The book does not wait on the interpreter: the reader boots from `toc.json` and the worker's
  ready line arrives when it arrives.
- The app opens on the cover chunk (`c000`): the title page set centred over Ramelli's bookwheel,
  sized so title, plate and the way in clear the REPL's peek strip at 360×640, with the colophon
  and source links a scroll below.
- Visual identity follows the book: Libertine text on near-white stock, Biolinum for headings and
  labels, maroon cross-references, periwinkle numbering, chapter openers with the drop cap and
  small-caps first line, listings in the edition's own prettify colours. The REPL is deliberately
  *not* paper — a slate bench under the page, one status line at rest.
- Each `Run` evaluates in the session and shows result inline under the block.
### 3.2 Editor
- Plain textarea under the hood (`autocorrect=off autocapitalize=off spellcheck=false`),
  overlay-rendered highlighting, rainbow depth for the enclosing form.
- Highlighting (`src/editor/highlight.ts`) is painted, never edited into the input: a `<pre>`
  holds the coloured copy, the textarea sits on it with `color: transparent` and lends the
  platform's caret, selection, keyboard and undo stack. Both layers carry the same font, padding
  and wrapping so the glyphs line up; the editor syncs `scrollTop`/`scrollLeft` between them.
- The scanner is for display only — `scheme/src/reader.rs` stays the authority on the language —
  and must be total: half-typed input is the normal case. It marks comments, strings (including
  unterminated ones), numbers as `parse_atom` reads them (integers, `1/3`, reals), `#t`/`#f`,
  special forms, quotes, `#[…]` objects from the printer, and closers with nothing open. Parens
  cycle three hues by depth, and the pair enclosing the cursor is lit.
- The transcript paints with the same module: echoed entries and printed values, so a value reads
  the same on the way out as the expression did on the way in. `highlight()` escapes everything it
  emits — it is the only thing that may be assigned into `#output`'s `innerHTML`.
- The palette is `--s-*` in `:root` and does not change with the theme: the bench is slate in both.
- Custom key row: `( ) ' [ ] ; ← → ⏎ run kill`. Each key answers to a fingertip and to a keyboard:
  `pointerdown` with its default prevented is what keeps the on-screen keyboard from closing under
  a thumb, and a `keydown` handler beside it is what makes Enter and Space press the key for anyone
  walking the row with Tab. The symbol keys carry `aria-label`s, since `▢→` and `( )` do not read
  aloud.
- Auto-close `(`; Scheme-aware indentation on Enter; slurp/barf/wrap/unwrap buttons. A paren typed
  inside a string or a comment is just a character and does not auto-close (`Editor.context`).
- Every edit the helpers make goes in through `Editor.splice` as `insertText`, the platform's own
  editing command, not as `setRangeText` — which records nothing, so an auto-inserted closer could
  never be undone and the buffer could not be undone to empty. `setRangeText` is the fallback where
  `insertText` is refused.
- Keyboard, in the editor: `(`/`)` auto-close and step over, Enter indents, Shift+Enter is a plain
  newline, Ctrl/⌘-Enter evaluates (Run is the thumb's affordance; this is the keyboard's), and Tab
  walks the holes of a template — but only while there are holes. With none it must fall through
  and move focus on, and Shift+Tab always does: an editor a keyboard cannot leave is a trap, and
  the key row is on the other side of it.
- Holes are *selected*, not just stepped onto (`Editor.nextHole`), so the next keystroke replaces
  one whatever it is. A hole typed past rather than filled leaves a legal symbol behind —
  `(define (square▢ x) …)` reads, defines `square▢`, and never errors, because `square` is in the
  prelude; the definition is simply dead.
- Radial selector (`src/editor/radial.ts`): long-press or thumb button opens a ring anchored in a
  configurable thumb zone; wedges depend on `form_at(cursor)`; templates with `▢` holes, the first
  of them selected on insertion; "next hole" gesture; second ring for recent identifiers from
  `env_names`. Haptics via `navigator.vibrate` where available.
- The ring cannot open until the worker says what form the cursor is in, and the worker answers
  between slices of whatever it is evaluating — so every press carries a gesture number that a
  release bumps, and an answer that arrives after its own gesture ended is dropped. Without that,
  a tap on λ during a long run opened a ring with no finger down, which stayed up until the next
  unrelated tap closed it and inserted whichever wedge the pointer was over.
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
