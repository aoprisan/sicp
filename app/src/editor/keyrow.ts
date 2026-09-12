import type { Editor } from "./editor";

export class KeyRow {
  onRun: () => void = () => {};
  onKill: () => void = () => {};
  onRadial: (x: number, y: number) => void = () => {};

  constructor(host: HTMLElement, editor: Editor) {
    const keys: [string, (e: PointerEvent) => void, string?][] = [
      ["(", () => editor.typeParen(true)],
      [")", () => editor.typeParen(false)],
      ["'", () => editor.insert("'")],
      ["▢→", () => editor.nextHole()],
      ["( )", () => editor.wrap()],
      ["λ", (e) => this.onRadial(e.clientX, e.clientY)],
      ["←", () => { const c = editor.cursor; editor.ta.setSelectionRange(Math.max(0, c - 1), Math.max(0, c - 1)); }],
      ["→", () => { const c = editor.cursor; editor.ta.setSelectionRange(c + 1, c + 1); }],
      ["Run", () => this.onRun(), "primary"],
      ["Stop", () => this.onKill()],
    ];
    for (const [label, fn, cls] of keys) {
      const b = document.createElement("button");
      b.textContent = label; if (cls) b.className = cls;
      b.addEventListener("pointerdown", (e) => { e.preventDefault(); fn(e); editor.focus(); });
      host.appendChild(b);
    }
  }
}
