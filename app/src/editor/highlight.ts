/// Scheme highlighting for the bench: the REPL editor paints through this on every keystroke,
/// and the transcript paints echoed input and printed values with it too.
///
/// This is a scanner for display, not a reader — `scheme/src/reader.rs` is the authority on what
/// the language is, and this file only has to agree with it about token boundaries. It must be
/// total and never throw: most keystrokes leave the buffer mid-token, and half of a form is the
/// normal case, not the error case.

/** Delimiters, as the reader has them: whitespace plus these. */
const DELIM = '()[]";';

/** Special forms. Everything else that reads as a name is just a name. */
const SPECIAL = new Set([
  "define", "lambda", "if", "cond", "else", "=>", "and", "or", "let", "let*", "letrec",
  "begin", "quote", "quasiquote", "unquote", "set!", "do", "when", "unless",
  "cons-stream", "delay", "named-lambda", "the-environment",
]);

/** How many colours the parens cycle through before repeating. The book's listings cycle through
    the same number, from `rainbow.ts`: one nesting reads the same on the page and on the bench. */
export const RAINBOW = 3;

export interface Token {
  start: number;
  end: number;
  cls: string;
}

/**
 * Split `src` into display tokens. Unterminated strings and unmatched closers are tokens too —
 * the editor shows them as what they are rather than giving up on the rest of the line.
 */
export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let depth = 0;
  let i = 0;
  const push = (start: number, end: number, cls: string) => { out.push({ start, end, cls }); return end; };
  const tokenEnd = (from: number) => {
    let j = from;
    while (j < src.length && !/\s/.test(src[j]) && !DELIM.includes(src[j])) j++;
    return j;
  };

  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }

    if (c === ";") {
      const nl = src.indexOf("\n", i);
      i = push(i, nl < 0 ? src.length : nl, "s-com");
    } else if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
      i = push(i, Math.min(j + 1, src.length), "s-str");
    } else if (c === "(" || c === "[") {
      i = push(i, i + 1, `s-par d${depth % RAINBOW}`);
      depth++;
    } else if (c === ")" || c === "]") {
      // A closer with nothing open is the one thing worth painting as wrong while typing.
      i = depth === 0 ? push(i, i + 1, "s-bad") : push(i, i + 1, `s-par d${--depth % RAINBOW}`);
    } else if (c === "'" || c === "`" || c === ",") {
      i = push(i, i + (src[i + 1] === "@" ? 2 : 1), "s-pun");
    } else if (c === "#" && src[i + 1] === "(") {
      i = push(i, i + 2, `s-par d${depth % RAINBOW}`);   // #(1 2 3), a vector literal
      depth++;
    } else if (c === "#") {
      i = hash(src, i, push);
    } else {
      const end = tokenEnd(i);
      const tok = src.slice(i, end);
      i = push(i, end, tok === "." ? "s-pun" : isNumber(tok) ? "s-num" : SPECIAL.has(tok.toLowerCase()) ? "s-kwd" : "s-sym");
    }
  }
  return out;
}

/** `#t`/`#f`, and the `#[compound-procedure 12 fib]` the printer prints. */
function hash(src: string, i: number, push: (s: number, e: number, cls: string) => number): number {
  // MIT prints objects that cannot be read back as #[…]; they arrive here through the transcript.
  if (src[i + 1] === "[") {
    const close = src.indexOf("]", i);
    return push(i, close < 0 ? src.length : close + 1, "s-obj");
  }
  let j = i + 1;
  while (j < src.length && !/\s/.test(src[j]) && !DELIM.includes(src[j])) j++;
  const tok = src.slice(i, j).toLowerCase();
  return push(i, j, tok === "#t" || tok === "#f" || tok === "#true" || tok === "#false" ? "s-bool" : "s-bad");
}

/** Integers, bignums, rationals and reals — what `parse_atom` accepts, and nothing else. */
function isNumber(tok: string): boolean {
  if (/^[+-]?\d+$/.test(tok)) return true;                       // fixnum or bignum
  if (/^[+-]?\d+\/0*[1-9]\d*$/.test(tok)) return true;           // exact rational, denominator ≠ 0
  return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(tok) && /[.e]/i.test(tok);
}

/**
 * Render `src` as HTML. With a `cursor`, the parens of the form around it are marked `on` — the
 * one piece of state that tells you where you are in a nest ten deep on a phone screen.
 */
export function highlight(src: string, cursor = -1): string {
  const toks = tokenize(src);
  const pair = cursor < 0 ? null : enclosing(src, toks, cursor);
  let html = "";
  let pos = 0;
  for (const t of toks) {
    if (t.start > pos) html += escape(src.slice(pos, t.start));
    const on = pair && (t === pair[0] || t === pair[1]) ? " on" : "";
    html += `<span class="${t.cls}${on}">${escape(src.slice(t.start, t.end))}</span>`;
    pos = t.end;
  }
  return html + escape(src.slice(pos));
}

/** The innermost paren pair containing `cursor`. An unclosed form counts, and marks its opener. */
function enclosing(src: string, toks: Token[], cursor: number): [Token, Token | null] | null {
  const open: Token[] = [];
  let best: [Token, Token | null] | null = null;
  let bestSpan = Infinity;
  const consider = (o: Token, c: Token | null) => {
    const end = c ? c.end : src.length;
    if (o.start > cursor || cursor > end) return;
    if (end - o.start < bestSpan) { bestSpan = end - o.start; best = [o, c]; }
  };
  for (const t of toks) {
    if (!t.cls.startsWith("s-par")) continue;
    const last = src[t.end - 1];                       // "(", "[" — or the "(" of a "#(" literal
    if (last === "(" || last === "[") open.push(t);
    else { const o = open.pop(); if (o) consider(o, t); }
  }
  for (const o of open) consider(o, null);  // still being typed
  return best;
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
