/// The row of keys under the editor: what a phone keyboard does not give you — parens, quote,
/// hole navigation, the radial menu — plus Run and Stop.
///
/// Each key answers to a fingertip *and* to a keyboard. `pointerdown` with its default prevented
/// is what keeps the on-screen keyboard from closing under a thumb, but it is also invisible to
/// Enter and Space: with only that binding, a focused Run did nothing, and since Tab used to be
/// swallowed by the editor there was no way to evaluate from a keyboard at all.
import type { Editor } from "./editor";

/** Label, what it does, where the label is unreadable aloud, and the class for Run. */
type Key = [label: string, run: (x: number, y: number) => void, aria?: string, cls?: string];

export class KeyRow {
  onRun: () => void = () => {};
  onKill: () => void = () => {};
  onRadial: (x: number, y: number) => void = () => {};

  constructor(host: HTMLElement, editor: Editor) {
    const keys: Key[] = [
      ["(", () => editor.typeParen(true), "Open paren"],
      [")", () => editor.typeParen(false), "Close paren"],
      ["'", () => editor.insert("'"), "Quote"],
      ["▢→", () => editor.nextHole(), "Next hole"],
      ["( )", () => editor.wrap(), "Wrap in parens"],
      ["λ", (x, y) => this.onRadial(x, y), "Insert a form"],
      ["←", () => editor.step(-1), "Left"],
      ["→", () => editor.step(1), "Right"],
      ["Run", () => this.onRun(), undefined, "primary"],
      ["Stop", () => this.onKill()],
    ];
    for (const [label, run, aria, cls] of keys) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      if (aria) b.setAttribute("aria-label", aria);
      if (cls) b.className = cls;
      // The radial opens where the finger is; pressed from the keyboard, over the key itself.
      const middle = () => {
        const r = b.getBoundingClientRect();
        return [r.left + r.width / 2, r.top + r.height / 2] as const;
      };
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        editor.focus();               // before the edit: `insertText` writes to the focused field
        run(e.clientX, e.clientY);
      });
      b.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        const [x, y] = middle();
        // The edit needs the textarea focused, but the row is being walked with Tab: hand focus
        // back, or every key would cost a Tab to return to.
        editor.focus();
        run(x, y);
        b.focus();
        editor.repaint();
      });
      host.appendChild(b);
    }
  }
}
