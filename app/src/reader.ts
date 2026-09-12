/// Loads book chunks and wires Run / → scratch chips onto every code block.
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
    this.root.querySelectorAll("pre").forEach((pre) => {
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
}
