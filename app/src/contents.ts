/// The book's table of contents, as a drawer over the page, plus the page-turn links under it.
///
/// `just book` writes the outline into `book/toc.json`: the reading order, the label the book
/// gives each part ("1.1 The Elements of Programming") and its level — 0 for front matter,
/// chapters and back matter, 1 for the sections inside a chapter. Navigation is by hash, so every
/// entry is an ordinary link: the back button works, and a chapter can be bookmarked.

export interface Entry {
  id: string;
  label: string;
  level: number;
}

function span(cls: string, text: string): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = cls;
  el.textContent = text;
  return el;
}

export class Contents {
  private entries: Entry[] = [];
  private at = new Map<string, number>();
  private links = new Map<string, HTMLAnchorElement>();
  private list = document.createElement("ol");

  constructor(private panel: HTMLElement, private veil: HTMLElement, private button: HTMLElement) {
    this.list.className = "toc";
    const head = document.createElement("div");
    head.className = "toc-head";
    head.append(span("toc-title", "Contents"));
    // The veil covers the header, so the button that opened the drawer cannot close it: give the
    // drawer its own way out, next to the title where a thumb already is.
    const shut = document.createElement("button");
    shut.type = "button";
    shut.className = "toc-close";
    shut.setAttribute("aria-label", "Close contents");
    shut.textContent = "×";
    shut.addEventListener("click", () => this.close());
    head.appendChild(shut);
    this.panel.append(head, this.list);
    this.button.addEventListener("click", () => this.toggle());
    this.veil.addEventListener("click", () => this.close());
    // A drawer that cannot be dismissed from the keyboard is a trap; Escape always closes it.
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") this.close(); });
    // Picking an entry navigates by hash; the drawer's job is done the moment one is chosen.
    this.list.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest("a")) this.close(); });
  }

  /** Read the outline and build the menu. Without a book the button stays inert rather than lying. */
  async load(): Promise<void> {
    const res = await fetch(`${import.meta.env.BASE_URL}book/toc.json`);
    if (!res.ok) return;
    const toc = await res.json();
    this.entries = (toc.chunks ?? []).map((c: Entry) => ({ id: c.id, label: c.label ?? c.id, level: c.level ?? 0 }));
    this.entries.forEach((e, i) => this.at.set(e.id, i));
    for (const e of this.entries) {
      const li = document.createElement("li");
      li.className = `l${e.level}`;
      const a = document.createElement("a");
      a.href = `#${e.id}`;
      // The book numbers its parts and sets the numbers apart; the menu keeps that.
      const numbered = e.label.match(/^(\d+(?:\.\d+)*)\s+(.*)$/);
      if (numbered) a.append(span("num", numbered[1]), span("name", numbered[2]));
      else a.textContent = e.label;
      li.appendChild(a);
      this.list.appendChild(li);
      this.links.set(e.id, a);
    }
    this.button.hidden = false;
  }

  /** Say where the reader is, in the menu and to anything reading the page aloud. */
  mark(id: string) {
    for (const [key, a] of this.links) {
      const here = key === id;
      a.classList.toggle("on", here);
      if (here) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    }
  }

  prev(id: string): Entry | null { return this.neighbour(id, -1); }
  next(id: string): Entry | null { return this.neighbour(id, 1); }

  private neighbour(id: string, step: number): Entry | null {
    const i = this.at.get(id);
    return i === undefined ? null : this.entries[i + step] ?? null;
  }

  private toggle() { document.body.classList.contains("nav-open") ? this.close() : this.open(); }

  open() {
    if (!this.entries.length) return;
    document.body.classList.add("nav-open");
    this.button.setAttribute("aria-expanded", "true");
    this.behind(true);
    // Open where the reader is, not at the cover: forty entries is a long way to scroll back to
    // chapter 4 on a phone.
    const here = this.list.querySelector<HTMLAnchorElement>("a.on");
    here?.scrollIntoView({ block: "center" });
    // Nothing `visibility: hidden` can take focus, and the class that reveals the panel has not
    // been applied to style yet — read a layout property to force it through, then focus.
    void this.panel.offsetHeight;
    (here ?? this.list.querySelector("a"))?.focus({ preventScroll: true });
  }

  close() {
    if (!document.body.classList.contains("nav-open")) return;
    document.body.classList.remove("nav-open");
    this.button.setAttribute("aria-expanded", "false");
    this.behind(false);
    this.button.focus({ preventScroll: true });
  }

  /** While the drawer is over the book, the book is not there to be tabbed into. */
  private behind(inert: boolean) {
    for (const id of ["reader", "sheet"]) {
      const el = document.getElementById(id);
      if (el) el.inert = inert;
    }
  }
}
