export interface EvalResult {
  status: "done" | "paused" | "error";
  output: string;
  values: string[];
  error?: string;
  span?: [number, number];
}

type Msg =
  | { type: "ready" }
  | { type: "output"; id: number; text: string }
  | { type: "result"; id: number; result: EvalResult }
  | { type: "names"; id: number; names: string[] }
  | { type: "form"; id: number; head: string; depth: number; span: [number, number] };

export class SchemeWorker {
  private w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  private next = 1;
  private waiting = new Map<number, { resolve: (v: any) => void; onOutput?: (t: string) => void }>();
  ready: Promise<void>;

  constructor() {
    this.ready = new Promise((res) => {
      this.w.addEventListener("message", (e: MessageEvent<Msg>) => {
        const m = e.data;
        if (m.type === "ready") return res();
        const p = this.waiting.get(m.id);
        if (!p) return;
        if (m.type === "output") p.onOutput?.(m.text);
        else {
          this.waiting.delete(m.id);
          p.resolve(m.type === "result" ? m.result : m.type === "names" ? m.names : m);
        }
      });
    });
  }

  eval(src: string, onOutput?: (t: string) => void): Promise<EvalResult> {
    const id = this.next++;
    return new Promise((resolve) => {
      this.waiting.set(id, { resolve, onOutput });
      this.w.postMessage({ type: "eval", id, src });
    });
  }
  interrupt() { this.w.postMessage({ type: "interrupt" }); }
  envNames(): Promise<string[]> {
    const id = this.next++;
    return new Promise((resolve) => { this.waiting.set(id, { resolve }); this.w.postMessage({ type: "names", id }); });
  }
  formAt(src: string, cursor: number): Promise<{ head: string; depth: number; span: [number, number] }> {
    const id = this.next++;
    return new Promise((resolve) => { this.waiting.set(id, { resolve }); this.w.postMessage({ type: "form", id, src, cursor }); });
  }
}
