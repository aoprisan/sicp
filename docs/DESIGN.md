# Design notes

## Reading surface
Warm paper, serif body (system Palatino/Iowan stack — no webfont download, the book should open
instantly offline). 40rem measure. Code blocks sit in a cooler panel with a `Run` chip; results
render inline under the block in the accent colour. Dark mode inverts paper/ink, keeps the accent.

## REPL sheet
Bottom sheet with three snap points: peek (last result only), half, full. Landscape ≥900px: split
view, sheet becomes a right column. Editor is a plain textarea with autocorrect off; the custom key
row supplies parens, quote, hole navigation, wrap, radial trigger, run, stop.

## Radial selector
- Trigger: long-press in the editor, or the `λ` key in the key row (thumb zone).
- Ring is offset 40px above the touch point so the thumb doesn't cover it.
- 8 wedges max per ring; the `recent` wedge opens a second ring of the last 8 names defined in
  the session (from `env_names`).
- Menu is chosen by the head of the innermost form at the cursor (`form_at_cursor`):
  `cond` → clause/else…, `let*` → binding…, other calls → arithmetic/list ops, top level → forms.
- Templates insert `▢` holes; Tab / `▢→` moves to the next hole. Inserting into a hole replaces it.
- Haptic tick on wedge change where `navigator.vibrate` exists (Android). iOS: rely on highlight.
- Release in the centre cancels.

## Things still to decide
- Whether to render the editor through an overlay for rainbow-depth highlighting (needs a
  mirror `<pre>` behind a transparent textarea) or leave plain text for v1.
- Exercise buffers: one per exercise id, autosaved on input to IndexedDB (`idb`), listed in an
  "My work" screen with export-as-.scm.
- Picture language: `paint` returns ops `[{type:"line",x1,y1,x2,y2}]` in unit-square coords; the
  reader renders them on a `<canvas>` under the result.
