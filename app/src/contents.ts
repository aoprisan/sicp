/// The book's table of contents, as a drawer over the page, plus the page-turn links under it.
///
/// `just book` writes the outline into `book/toc.json`: the reading order, the label the book
/// gives each part ("1.1 The Elements of Programming") and its level — 0 for front matter,
/// chapters and back matter, 1 for the sections inside a chapter. Navigation is by hash, so every
/// entry is an ordinary link: the back button works, and a chapter can be bookmarked.
///
/// The drawer also carries what is not in the book: the interpreter on its own, above the outline,
/// on the same terms — one hash, one link, one marked entry.

/** The interpreter's own view, reached from the menu like any chunk. It is not part of the
    book's reading order, so it has no page-turn neighbours and no place in `toc.json`. */
export const BENCH_ID = "scheme";

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
    this.panel.append(head, this.tools(), this.list);
    // The menu always leads somewhere now — the bench needs no book — so the button is never inert.
    this.button.hidden = false;
    this.button.addEventListener("click", () => this.toggle());
    this.veil.addEventListener("click", () => this.close());
    // A drawer that cannot be dismissed from the keyboard is a trap; Escape always closes it.
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") this.close(); });
    // Picking an entry navigates by hash; the drawer's job is done the moment one is chosen.
    this.panel.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest("a")) this.close(); });
  }

  /** Read the outline and add the book to the menu. Without a book the drawer still opens on
      the bench rather than on nothing — and an outline that cannot be read must not take the app
      down with it, since the caller boots the view on the back of this promise. A dev server
      answering 200 with `index.html` for a missing chunk lands here too. */
  async load(): Promise<void> {
    const toc = await fetch(`${import.meta.env.BASE_URL}book/toc.json`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
    if (!toc) return;
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
  }

  /** The standing entry: the interpreter is a place in the app, not a chapter, so it sits on its
      own list above the outline and is reachable before `just book` has written a single chunk. */
  private tools(): HTMLElement {
    const ol = document.createElement("ol");
    ol.className = "toc tools";
    const li = document.createElement("li");
    li.className = "l0";
    const a = document.createElement("a");
    a.href = `#${BENCH_ID}`;
    a.append(span("num", "λ"), span("name", "Scheme interpreter"));
    li.appendChild(a);
    ol.appendChild(li);
    this.links.set(BENCH_ID, a);
    return ol;
  }

  /** Say where the reader is — a chunk, or the bench — in the menu and to anything reading the
      page aloud. */
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
    document.body.classList.add("nav-open");
    this.button.setAttribute("aria-expanded", "true");
    this.behind(true);
    // Open where the reader is, not at the cover: forty entries is a long way to scroll back to
    // chapter 4 on a phone.
    const here = this.panel.querySelector<HTMLAnchorElement>("a.on");
    here?.scrollIntoView({ block: "center" });
    // Nothing `visibility: hidden` can take focus, and the class that reveals the panel has not
    // been applied to style yet — read a layout property to force it through, then focus.
    void this.panel.offsetHeight;
    (here ?? this.panel.querySelector(".toc a"))?.focus({ preventScroll: true });
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
