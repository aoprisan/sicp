/// Radial (pie) selector for inserting Scheme forms by direction. Press → drag → release.
/// Wedge contents depend on the enclosing form at the cursor (asked from the interpreter).
import { Editor, HOLE } from "./editor";
import type { SchemeWorker } from "../worker-client";

type Item = [label: string, template: string | null]; // null = opens the "recent names" sub-ring

const H = HOLE;
const MENUS: Record<string, Item[]> = {
  top: [["define", `(define (${H} ${H})\n  ${H})`], ["lambda", `(lambda (${H}) ${H})`], ["let", `(let ((${H} ${H}))\n  ${H})`], ["cond", `(cond (${H} ${H})\n      (else ${H}))`], ["if", `(if ${H} ${H} ${H})`], ["( )", `(${H})`], ["'", `'${H}`], ["recent", null]],
  cond: [["clause", `(${H} ${H})`], ["else", `(else ${H})`], ["( )", `(${H})`], ["if", `(if ${H} ${H} ${H})`], ["and", `(and ${H} ${H})`], ["or", `(or ${H} ${H})`], ["not", `(not ${H})`], ["=", `(= ${H} ${H})`]],
  let: [["binding", `(${H} ${H})`], ["( )", `(${H})`], ["lambda", `(lambda (${H}) ${H})`], ["if", `(if ${H} ${H} ${H})`], ["recent", null]],
  call: [["+", `(+ ${H} ${H})`], ["-", `(- ${H} ${H})`], ["*", `(* ${H} ${H})`], ["/", `(/ ${H} ${H})`], ["car", `(car ${H})`], ["cdr", `(cdr ${H})`], ["cons", `(cons ${H} ${H})`], ["recent", null]],
};
const HEAD_TO_MENU: Record<string, string> = { cond: "cond", let: "let", "let*": "let", letrec: "let", define: "top", lambda: "top", if: "top", begin: "top", "": "top" };

export class Radial {
  private svg: SVGSVGElement;
  private items: Item[] = [];
  private active = -1;
  private cx = 0; private cy = 0;
  private sub = false;
  private open_ = false;

  constructor(private editor: Editor, private worker: SchemeWorker) {
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.id = "radial";
    this.svg.setAttribute("viewBox", "-110 -110 220 220");
    document.body.appendChild(this.svg);
    window.addEventListener("pointermove", (e) => this.move(e));
    window.addEventListener("pointerup", () => this.release());
    window.addEventListener("pointercancel", () => this.release());
  }

  async open(x: number, y: number) {
    const { head } = await this.worker.formAt(this.editor.value, this.editor.cursor);
    const menu = HEAD_TO_MENU[head] ?? "call";
    this.build(MENUS[menu]);
    // Offset upward so the thumb doesn't hide the ring.
    this.cx = x; this.cy = y - 40;
    Object.assign(this.svg.style, { display: "block", left: `${this.cx - 110}px`, top: `${this.cy - 110}px` });
    this.sub = false; this.active = -1; this.open_ = true;
  }

  private build(list: Item[]) {
    this.items = list;
    const ns = "http://www.w3.org/2000/svg";
    this.svg.innerHTML = "";
    const n = list.length;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2 - Math.PI / 2 - Math.PI / n, a1 = a0 + (Math.PI * 2) / n;
      const p = (r: number, a: number) => [r * Math.cos(a), r * Math.sin(a)];
      const [x0, y0] = p(34, a0), [x1, y1] = p(100, a0), [x2, y2] = p(100, a1), [x3, y3] = p(34, a1);
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", `M${x0} ${y0}L${x1} ${y1}A100 100 0 0 1 ${x2} ${y2}L${x3} ${y3}A34 34 0 0 0 ${x0} ${y0}Z`);
      path.setAttribute("fill", "var(--paper)"); path.setAttribute("stroke", "var(--rule)");
      this.svg.appendChild(path);
      const [tx, ty] = p(68, (a0 + a1) / 2);
      const t = document.createElementNS(ns, "text");
      t.setAttribute("x", String(tx)); t.setAttribute("y", String(ty));
      t.setAttribute("text-anchor", "middle"); t.setAttribute("dominant-baseline", "middle");
      t.setAttribute("font-size", "13"); t.setAttribute("font-family", "ui-monospace, monospace"); t.setAttribute("fill", "var(--ink)");
      t.textContent = list[i][0];
      this.svg.appendChild(t);
    }
    const c = document.createElementNS(ns, "circle");
    c.setAttribute("r", "30"); c.setAttribute("fill", "var(--panel)"); c.setAttribute("stroke", "var(--rule)");
    this.svg.appendChild(c);
  }

  private highlight(i: number) {
    this.svg.querySelectorAll("path").forEach((p, k) => {
      p.setAttribute("fill", k === i ? "var(--accent-bg)" : "var(--paper)");
      p.setAttribute("stroke", k === i ? "var(--accent)" : "var(--rule)");
    });
  }

  private pick(x: number, y: number) {
    const dx = x - this.cx, dy = y - this.cy;
    if (Math.hypot(dx, dy) < 30) return -1;
    const n = this.items.length;
    let a = Math.atan2(dy, dx) + Math.PI / 2 + Math.PI / n;
    if (a < 0) a += Math.PI * 2;
    return Math.floor((a / (Math.PI * 2)) * n) % n;
  }

  private async move(e: PointerEvent) {
    if (!this.open_) return;
    const i = this.pick(e.clientX, e.clientY);
    if (i === this.active) return;
    this.active = i; this.highlight(i);
    if (i >= 0 && navigator.vibrate) navigator.vibrate(8);
    if (i >= 0 && this.items[i][1] === null && !this.sub) {
      this.sub = true;
      const names = (await this.worker.envNames()).slice(-8).reverse();
      this.build(names.map((n) => [n, n] as Item));
      this.highlight(-1); this.active = -1;
    }
  }

  private release() {
    if (!this.open_) return;
    this.open_ = false;
    this.svg.style.display = "none";
    const it = this.active >= 0 ? this.items[this.active] : undefined;
    if (it && it[1] !== null) this.editor.insert(it[1]);
    this.editor.focus();
  }
}
