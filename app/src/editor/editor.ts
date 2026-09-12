/// Minimal mobile-first Scheme editor over a plain textarea: auto-close parens, Scheme indentation,
/// hole navigation for templates, long-press hook for the radial menu.
export const HOLE = "▢";

export class Editor {
  ta: HTMLTextAreaElement;
  onLongPress: (x: number, y: number) => void = () => {};
  private pressTimer = 0;

  constructor(host: HTMLElement) {
    this.ta = document.createElement("textarea");
    this.ta.setAttribute("autocorrect", "off");
    this.ta.setAttribute("autocapitalize", "off");
    this.ta.setAttribute("spellcheck", "false");
    this.ta.placeholder = "(define (f x) ...)";
    host.appendChild(this.ta);
    this.ta.addEventListener("keydown", (e) => this.keydown(e));
    this.ta.addEventListener("pointerdown", (e) => {
      this.pressTimer = window.setTimeout(() => this.onLongPress(e.clientX, e.clientY), 450);
    });
    for (const ev of ["pointerup", "pointermove", "pointercancel"]) this.ta.addEventListener(ev, () => clearTimeout(this.pressTimer));
  }

  get value() { return this.ta.value; }
  set value(v: string) { this.ta.value = v; this.ta.setSelectionRange(v.length, v.length); }
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
    this.ta.dispatchEvent(new Event("input"));
  }

  /** Type a paren: auto-close, and step over an existing closer. */
  typeParen(open: boolean) {
    const { selectionStart: s, value } = this.ta;
    if (!open && value[s] === ")") { this.ta.setSelectionRange(s + 1, s + 1); return; }
    if (open) { this.ta.setRangeText("()", s, this.ta.selectionEnd, "start"); this.ta.setSelectionRange(s + 1, s + 1); }
    else this.ta.setRangeText(")", s, this.ta.selectionEnd, "end");
  }

  nextHole() {
    const v = this.ta.value; const from = this.ta.selectionStart + 1;
    let i = v.indexOf(HOLE, from); if (i < 0) i = v.indexOf(HOLE);
    if (i >= 0) this.ta.setSelectionRange(i, i);
  }

  wrap() { const { selectionStart: s, selectionEnd: e, value } = this.ta; this.ta.setRangeText("(" + value.slice(s, e) + ")", s, e, "end"); }

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
