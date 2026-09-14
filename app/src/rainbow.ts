/// Depth-colouring for the parens in the book's own listings.
///
/// The bench has had this from the start — `highlight.ts` cycles three hues by nesting depth, and
/// on a phone it is the only thing that tells you where you are in a form ten deep. The page did
/// not: the edition's listings arrive already marked up by its prettifier, every paren in one
/// grey, so the same expression read one way in the editor and another way on the page above it.
///
/// This adds the depth the markup is missing rather than re-highlighting the listing. The book's
/// own classes stay exactly as the edition set them — `kwd`, `lit`, `str`, `com`, and the `roman`
/// spans it uses for the prose inside a form — and each paren simply gains a `d0`/`d1`/`d2` to
/// colour it by. Parens the edition put inside a string or a comment are not `opn`/`clo` spans at
/// all, so they neither take a colour nor move the depth, which is what the bench's scanner does
/// with them too.
import { RAINBOW } from "./editor/highlight";

/**
 * Colour every paren in one listing by its nesting depth.
 *
 * Depth runs across the whole listing, not per line: a book listing often holds several top-level
 * forms with their printed values between them, and each form balances back to zero on its own.
 */
export function rainbow(pre: Element): void {
  let depth = 0;
  /** The hue a paren takes, and the depth that follows it. A closer takes the depth it closes. */
  const hue = (ch: string): number => {
    if (ch === "(" || ch === "[") return depth++ % RAINBOW;
    // A closer with nothing open would be a fault in the edition's own markup rather than
    // anything the reader can show usefully: hold the floor at zero, outermost hue.
    depth = Math.max(0, depth - 1);
    return depth % RAINBOW;
  };
  for (const span of pre.querySelectorAll("span.opn, span.clo")) {
    const text = span.textContent ?? "";
    // The common case is one paren to a span; a run like `))))` is one span in the edition's
    // markup and four different depths on the page, so that one has to be split first.
    if (text.length === 1) { span.classList.add(`d${hue(text)}`); continue; }
    const parts = document.createDocumentFragment();
    for (const ch of text) {
      const one = document.createElement("span");
      one.className = `d${hue(ch)}`;
      one.textContent = ch;
      parts.appendChild(one);
    }
    span.replaceChildren(parts);
  }
}
