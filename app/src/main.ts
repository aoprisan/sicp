import { SchemeWorker } from "./worker-client";
import { Editor } from "./editor/editor";
import { KeyRow } from "./editor/keyrow";
import { Radial } from "./editor/radial";
import { Reader } from "./reader";

const worker = new SchemeWorker();
const output = document.getElementById("output")!;
const editor = new Editor(document.getElementById("editor-host")!);
const keyrow = new KeyRow(document.getElementById("keyrow")!, editor);
const radial = new Radial(editor, worker);
const sheet = document.getElementById("sheet")!;
const reader = new Reader(document.getElementById("reader")!, document.getElementById("crumb")!);

function appendOut(text: string, cls = "") {
  const el = document.createElement("div");
  el.textContent = text;
  if (cls) el.className = cls;
  output.appendChild(el);
  output.scrollTop = output.scrollHeight;
}

async function run(src: string, echo = true): Promise<string> {
  if (echo) appendOut("1 ]=> " + src);
  const r = await worker.eval(src, (out) => appendOut(out));
  if (r.status === "error") {
    appendOut(r.error!, "err");
    if (r.span) editor.markError(r.span);
    return r.error!;
  }
  const shown = r.values.filter((v) => v !== "").map((v) => ";Value: " + v).join("\n");
  if (shown) appendOut(shown);
  return shown;
}

keyrow.onRun = () => run(editor.value).then(() => editor.clearIfWanted());
keyrow.onKill = () => worker.interrupt();
keyrow.onRadial = (x, y) => radial.open(x, y);
editor.onLongPress = (x, y) => radial.open(x, y);

reader.onRun = async (src, resultEl) => {
  resultEl.textContent = "…";
  resultEl.textContent = await run(src, false);
};
reader.onScratch = (src) => {
  editor.value = src;
  sheet.className = "half";
  editor.focus();
};

// Bottom sheet snap points
let snaps = ["", "half", "full"];
let idx = 0;
document.getElementById("sheet-handle")!.addEventListener("click", () => {
  idx = (idx + 1) % snaps.length;
  sheet.className = snaps[idx];
});

// Boot
worker.ready.then(async () => {
  appendOut("SICP Scheme ready.");
  await reader.load(location.hash.slice(1) || "c000");
});
window.addEventListener("hashchange", () => reader.load(location.hash.slice(1)));
