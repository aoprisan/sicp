/// Loads book chunks and wires Run / → scratch chips onto every code block.
import type { Entry } from "./contents";

export class Reader {
  onRun: (src: string, resultEl: HTMLElement) => void = () => {};
  onScratch: (src: string) => void = () => {};
  constructor(private root: HTMLElement, private crumb: HTMLElement) {}

  async load(id: string) {
    const base = import.meta.env.BASE_URL;
    const res = await fetch(`${base}book/chunks/${id}.json`);
    if (!res.ok) { this.root.innerHTML = "<p>Run <code>just book</code> to build the book chunks.</p>"; return; }
    const chunk = await res.json();
    this.crumb.textContent = chunk.breadcrumb.join(" › ");
    this.root.innerHTML = chunk.html; // sanitised at build time
    // Figures keep their path relative to book/ so the same chunks work at / and at /sicp/.
    this.root.querySelectorAll<HTMLImageElement>("img[data-src]").forEach((img) => {
      img.src = `${base}book/${img.dataset.src}`;
    });
    this.root.querySelectorAll("pre.lisp").forEach((pre) => {
      const src = pre.textContent ?? "";
      const run = document.createElement("button");
      run.className = "run"; run.textContent = "Run";
      const result = document.createElement("div"); result.className = "result";
      run.addEventListener("click", () => this.onRun(src, result));
      pre.appendChild(run);
      pre.insertAdjacentElement("afterend", result);
      pre.addEventListener("dblclick", () => this.onScratch(src));
    });
    window.scrollTo(0, 0);
  }

  /** The foot of the page, where a book says what comes next. Call after `load`, which clears it. */
  turn(prev: Entry | null, next: Entry | null) {
    if (!prev && !next) return;
    const nav = document.createElement("nav");
    nav.className = "turn";
    nav.setAttribute("aria-label", "Book");
    if (prev) nav.appendChild(turnLink(prev, "prev"));
    if (next) nav.appendChild(turnLink(next, "next"));
    this.root.appendChild(nav);
  }
}

function turnLink(to: Entry, dir: "prev" | "next"): HTMLAnchorElement {
  const a = document.createElement("a");
  a.className = dir;
  a.rel = dir;
  a.href = `#${to.id}`;
  a.textContent = dir === "prev" ? `‹ ${to.label}` : `${to.label} ›`;
  return a;
}
