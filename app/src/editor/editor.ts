/// Minimal mobile-first Scheme editor over a plain textarea: auto-close parens, Scheme indentation,
/// hole navigation for templates, long-press hook for the radial menu.
///
/// Highlighting is painted, not edited: a <pre> under the textarea holds the coloured copy, the
/// textarea above it keeps its own glyphs transparent and lends only its caret and selection.
/// Nothing in the input path changes, so the keyboard, autocorrect settings, undo stack and
/// caret placement on a phone stay exactly what the platform gives a plain textarea. The helpers
/// hold up their end of that through `splice`: every edit they make goes in as the platform's own
/// insertion, so Ctrl+Z walks back over an auto-closed paren like any other typing.
import { highlight } from "./highlight";

export const HOLE = "▢";

export class Editor {
  ta: HTMLTextAreaElement;
  onLongPress: (x: number, y: number) => void = () => {};
  /** Ctrl/⌘-Enter. Run is a thumb's affordance on the key row; this is the same thing for anyone
      working from a keyboard, which otherwise has no way to evaluate at all. */
  onRun: () => void = () => {};
  private paint: HTMLElement;
  private pressTimer = 0;

  constructor(host: HTMLElement) {
    this.paint = document.createElement("pre");
    this.paint.className = "paint";
    this.paint.setAttribute("aria-hidden", "true");   // the textarea is the accessible copy
    host.appendChild(this.paint);
    this.ta = document.createElement("textarea");
    this.ta.setAttribute("autocorrect", "off");
    this.ta.setAttribute("autocapitalize", "off");
    this.ta.setAttribute("spellcheck", "false");
    this.ta.placeholder = "(define (f x) ...)";
    host.appendChild(this.ta);
    this.ta.addEventListener("keydown", (e) => this.keydown(e));
    this.ta.addEventListener("input", () => this.repaint());
    // Scrolled by the caret leaving the box, or by a finger: the layers move together or the
    // colour slides off the code.
    this.ta.addEventListener("scroll", () => this.scrollPaint());
    // Moving the caret alone re-marks the enclosing parens; only ours, and only while focused.
    document.addEventListener("selectionchange", () => {
      if (document.activeElement === this.ta) this.repaint();
    });
    this.ta.addEventListener("pointerdown", (e) => {
      this.pressTimer = window.setTimeout(() => this.onLongPress(e.clientX, e.clientY), 450);
    });
    for (const ev of ["pointerup", "pointermove", "pointercancel"]) this.ta.addEventListener(ev, () => clearTimeout(this.pressTimer));
    this.repaint();
  }

  /** Re-colour the layer underneath. Cheap enough to run on every keystroke: one pass, no DOM
      diffing, and the buffer is a REPL entry rather than a file. Public because the helpers that
      move the caret without editing have to re-mark the enclosing parens themselves: a caret the
      key row moved while the textarea is not focused fires no `selectionchange` we listen for. */
  repaint() {
    // The trailing newline gives the last line a box of its own, so a buffer ending in Enter
    // scrolls in step with the textarea instead of one line short.
    this.paint.innerHTML = highlight(this.ta.value + "\n", this.ta.selectionStart);
    this.scrollPaint();
  }

  private scrollPaint() {
    this.paint.scrollTop = this.ta.scrollTop;
    this.paint.scrollLeft = this.ta.scrollLeft;
  }

  /** Programmatic edits (key row, radial menu) don't fire `input`; route them through here. */
  private edited() { this.ta.dispatchEvent(new Event("input")); }

  /**
   * Replace `start`..`end` with `text` and leave the caret at `caret`.
   *
   * Every edit a helper makes goes through here, and it goes in as `insertText` — the platform's
   * own editing command — rather than as `setRangeText`, which writes nothing to the undo stack.
   * That difference is not cosmetic: with `setRangeText`, typing `(+ 1 2` and undoing walked back
   * over the characters the user typed and left the closer the editor had inserted, so the buffer
   * could never be undone to empty. `insertText` needs the textarea focused and is refused in
   * some contexts, so `setRangeText` stays as the fallback.
   */
  private splice(text: string, start: number, end: number, caret = start + text.length) {
    this.ta.setSelectionRange(start, end);
    let native = false;
    try { native = document.execCommand("insertText", false, text); } catch { native = false; }
    if (!native) { this.ta.setRangeText(text, start, end, "end"); this.edited(); }
    this.ta.setSelectionRange(caret, caret);
    this.repaint();
  }

  get value() { return this.ta.value; }
  set value(v: string) { this.ta.value = v; this.ta.setSelectionRange(v.length, v.length); this.edited(); }
  get cursor() { return this.ta.selectionStart; }
  focus() { this.ta.focus(); }
  clearIfWanted() { /* keep buffer by default; exercise buffers persist in IndexedDB later */ }

  insert(text: string) {
    const { selectionStart: s, selectionEnd: e, value } = this.ta;
    const replacingHole = value[s] === HOLE && s === e;
    this.splice(text, s, replacingHole ? s + 1 : e);
    // Land on the template's first hole with it selected, so the next keystroke fills it.
    const hole = text.indexOf(HOLE);
    if (hole >= 0) this.select(s + hole, s + hole + 1);
  }

  /** Move the caret, or put a selection on the range, and re-mark the parens around it. */
  private select(start: number, end = start) {
    this.ta.setSelectionRange(start, end);
    this.repaint();
  }

  /**
   * Step the caret one place, for the key row's arrows.
   *
   * With a selection, the first press collapses it to the edge you are heading for, the way an
   * arrow key behaves everywhere else. Stepping from `selectionStart` in both directions — what
   * the key row used to do, reaching into the textarea itself — moved the caret *backwards* into
   * the middle of what had just been selected.
   */
  step(by: -1 | 1) {
    const { selectionStart: s, selectionEnd: e, value } = this.ta;
    this.select(s === e ? Math.max(0, Math.min(value.length, s + by)) : by < 0 ? s : e);
  }

  /**
   * Type a paren: auto-close, and step over an existing closer.
   *
   * Inside a string or a comment a paren is just a character. The highlighter has always known
   * that; the key did not, and planted a closer in `(display "a b` and in `; a comment` alike —
   * text the reader never looks at, and a closer the user then has to go and delete.
   */
  typeParen(open: boolean) {
    const { selectionStart: s, selectionEnd: e, value } = this.ta;
    const code = context(value.slice(0, s)) === "code";
    // Stepping over a closer is for a caret, not a selection: with text selected, `)` replaces it.
    if (!open && code && s === e && value[s] === ")") return this.select(s + 1);
    if (open) this.splice(code ? "()" : "(", s, e, s + 1);
    else this.splice(")", s, e);
  }

  /**
   * Select the next hole in the buffer, wrapping round. Returns false when there is none.
   *
   * Selected, not merely stepped onto: only `insert` used to consume a hole, so typing a name
   * over one left it in place — `(define (square▢ x) …)` reads perfectly well and defines
   * `square▢`, and since `square` comes from the prelude nothing ever errors. The definition the
   * user wrote is simply dead. A selected hole is replaced by the next keystroke, whatever it is.
   */
  nextHole(): boolean {
    const v = this.ta.value; const from = this.ta.selectionStart + 1;
    let i = v.indexOf(HOLE, from); if (i < 0) i = v.indexOf(HOLE);
    if (i < 0) return false;
    this.select(i, i + 1);
    return true;
  }

  /** Parens around the selection — or, with nothing selected, the `(` key with its closer
      already there: land inside the new form rather than past the end of it. */
  wrap() {
    const { selectionStart: s, selectionEnd: e, value } = this.ta;
    this.splice("(" + value.slice(s, e) + ")", s, e, s === e ? s + 1 : e + 2);
  }

  markError(span: [number, number]) { this.ta.focus(); this.select(span[0], span[1]); }

  private keydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); this.onRun(); }
    else if (e.ctrlKey || e.metaKey) return;    // Ctrl+Z and the rest belong to the platform
    else if (e.key === "(") { e.preventDefault(); this.typeParen(true); }
    else if (e.key === ")") { e.preventDefault(); this.typeParen(false); }
    else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.newlineIndent(); }
    // Tab steps through a template's holes for as long as there are any. With none left it has to
    // do what Tab does everywhere else and move focus on — an editor a keyboard cannot leave is a
    // trap, and the key row sits on the other side of it — and Shift+Tab always leaves.
    else if (e.key === "Tab" && !e.shiftKey) { if (this.nextHole()) e.preventDefault(); }
  }

  /** Lisp indentation: align under the second element of the enclosing form, or +2 for bodies. */
  private newlineIndent() {
    const { selectionStart: s, selectionEnd: e, value } = this.ta;
    this.splice("\n" + " ".repeat(schemeIndent(value.slice(0, s))), s, e);
  }
}

/**
 * What the text before the caret leaves it inside: a string, a line comment, or code.
 *
 * A second small scanner rather than a flag out of `schemeIndent`: that one needs the paren stack
 * in the same pass and answers a different question. Both agree with `highlight`'s scanner on
 * where a string ends and where a comment runs to.
 */
export function context(before: string): "code" | "string" | "comment" {
  let inStr = false;
  for (let i = 0; i < before.length; i++) {
    const c = before[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === ";") { const nl = before.indexOf("\n", i); if (nl < 0) return "comment"; i = nl; }
  }
  return inStr ? "string" : "code";
}

const BODY_FORMS = new Set(["define", "lambda", "let", "let*", "letrec", "cond", "begin", "if", "when", "unless", "do"]);

export function schemeIndent(before: string): number {
  const stack: number[] = [];
  let inStr = false;
  for (let i = 0; i < before.length; i++) {
    const c = before[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === ";") { while (i < before.length && before[i] !== "\n") i++; }
    else if (c === "(" || c === "[") stack.push(i);
    else if (c === ")" || c === "]") stack.pop();
  }
  if (!stack.length) return 0;
  const open = stack[stack.length - 1];
  const lineStart = before.lastIndexOf("\n", open) + 1;
  const col = open - lineStart;
  const rest = before.slice(open + 1);
  const head = rest.match(/^\s*([^\s()\[\]]+)/)?.[1] ?? "";
  if (BODY_FORMS.has(head) || rest.trim() === "") return col + 2;
  const afterHead = rest.match(/^\s*[^\s()\[\]]+\s+(\S)/);
  if (afterHead && !rest.includes("\n")) return col + 1 + (afterHead.index ?? 0) + afterHead[0].length - 1;
  return col + 1;
}
