/// Minimal mobile-first Scheme editor over a plain textarea: auto-close parens, Scheme indentation,
/// hole navigation for templates, long-press hook for the radial menu.
///
/// Highlighting is painted, not edited: a <pre> under the textarea holds the coloured copy, the
/// textarea above it keeps its own glyphs transparent and lends only its caret and selection.
/// Nothing in the input path changes, so the keyboard, autocorrect settings, undo stack and
/// caret placement on a phone stay exactly what the platform gives a plain textarea.
import { highlight } from "./highlight";

export const HOLE = "▢";

export class Editor {
  ta: HTMLTextAreaElement;
  onLongPress: (x: number, y: number) => void = () => {};
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
      diffing, and the buffer is a REPL entry rather than a file. */
  private repaint() {
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

  get value() { return this.ta.value; }
  set value(v: string) { this.ta.value = v; this.ta.setSelectionRange(v.length, v.length); this.edited(); }
  get cursor() { return this.ta.selectionStart; }
  focus() { this.ta.focus(); }
  clearIfWanted() { /* keep buffer by default; exercise buffers persist in IndexedDB later */ }

  insert(text: string) {
    const { selectionStart: s, selectionEnd: e, value } = this.ta;
    const replacingHole = value[s] === HOLE && s === e;
    const end = replacingHole ? s + 1 : e;
    this.ta.setRangeText(text, s, end, "end");
    const hole = text.indexOf(HOLE);
    if (hole >= 0) this.ta.setSelectionRange(s + hole, s + hole);
    this.edited();
  }

  /** Type a paren: auto-close, and step over an existing closer. */
  typeParen(open: boolean) {
    const { selectionStart: s, value } = this.ta;
    if (!open && value[s] === ")") { this.ta.setSelectionRange(s + 1, s + 1); return; }
    if (open) { this.ta.setRangeText("()", s, this.ta.selectionEnd, "start"); this.ta.setSelectionRange(s + 1, s + 1); }
    else this.ta.setRangeText(")", s, this.ta.selectionEnd, "end");
    this.edited();
  }

  nextHole() {
    const v = this.ta.value; const from = this.ta.selectionStart + 1;
    let i = v.indexOf(HOLE, from); if (i < 0) i = v.indexOf(HOLE);
    if (i >= 0) this.ta.setSelectionRange(i, i);
  }

  wrap() { const { selectionStart: s, selectionEnd: e, value } = this.ta; this.ta.setRangeText("(" + value.slice(s, e) + ")", s, e, "end"); this.edited(); }

  markError(span: [number, number]) { this.ta.setSelectionRange(span[0], span[1]); this.ta.focus(); }

  private keydown(e: KeyboardEvent) {
    if (e.key === "(") { e.preventDefault(); this.typeParen(true); }
    else if (e.key === ")") { e.preventDefault(); this.typeParen(false); }
    else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.newlineIndent(); }
    else if (e.key === "Tab") { e.preventDefault(); this.nextHole(); }
  }

  /** Lisp indentation: align under the second element of the enclosing form, or +2 for bodies. */
  private newlineIndent() {
    const { selectionStart: s, value } = this.ta;
    const indent = schemeIndent(value.slice(0, s));
    this.ta.setRangeText("\n" + " ".repeat(indent), s, this.ta.selectionEnd, "end");
    this.edited();
  }
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
