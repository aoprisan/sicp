/// Runs the WASM interpreter off the main thread with a step budget so `interrupt` can land.
// The wasm package is produced by `just wasm` into src/wasm/.
import init, * as scheme from "./wasm/sicp_scheme.js";

const BUDGET = 200_000;
let session = 0;
let interrupted = false;

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

async function main() {
  await init();
  session = scheme.new_session();
  post({ type: "ready" });
}
main();

self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  if (m.type === "interrupt") { interrupted = true; scheme.interrupt(session); return; }
  if (m.type === "names") { post({ type: "names", id: m.id, names: JSON.parse(scheme.env_names(session)) }); return; }
  if (m.type === "form") { post({ type: "form", id: m.id, ...JSON.parse(scheme.form_at_cursor(m.src, m.cursor)) }); return; }
  if (m.type === "eval") {
    interrupted = false;
    scheme.set_runtime(performance.now() / 1000);
    let r = JSON.parse(scheme.eval_source(session, m.src, BUDGET));
    while (r.status === "paused" && !interrupted) {
      if (r.output) post({ type: "output", id: m.id, text: r.output });
      await new Promise((res) => setTimeout(res, 0)); // let interrupt messages arrive
      scheme.set_runtime(performance.now() / 1000);
      r = JSON.parse(scheme.resume(session, BUDGET));
    }
    if (interrupted && r.status === "paused") r = { status: "error", output: r.output, values: [], error: ";Quit!" };
    if (r.output) post({ type: "output", id: m.id, text: r.output });
    r.output = "";
    post({ type: "result", id: m.id, result: r });
  }
};
