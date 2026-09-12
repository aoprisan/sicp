import { SchemeWorker } from "./worker-client";
import { Editor } from "./editor/editor";
import { highlight } from "./editor/highlight";
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

// What the transcript echoes and prints back is Scheme, so it is painted by the same highlighter
// as the editor: a value reads the same on the way out as the expression did on the way in. The
// HTML here is built from `highlight`, which escapes everything it is given — nothing else goes in.
function appendPainted(html: string, cls: string) {
  const el = document.createElement("div");
  el.className = cls;
  el.innerHTML = html;
  output.appendChild(el);
  output.scrollTop = output.scrollHeight;
}

async function run(src: string, echo = true): Promise<string> {
  if (echo) appendPainted('<span class="prompt">1 ]=&gt; </span>' + highlight(src), "echo");
  const r = await worker.eval(src, (out) => appendOut(out));
  if (r.status === "error") {
    appendOut(r.error!, "err");
    if (r.span) editor.markError(r.span);
    return r.error!;
  }
  const values = r.values.filter((v) => v !== "");
  if (values.length) {
    appendPainted(values.map((v) => '<span class="tag">;Value:</span> ' + highlight(v)).join("\n"), "value");
  }
  return values.map((v) => ";Value: " + v).join("\n");
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

// Chunk ids are c000…; any other hash is an in-page anchor (footnote, figure) — leave it to
// the browser to scroll to, or it would replace the page the reader is on.
const chunkFromHash = () => {
  const h = location.hash.slice(1);
  return /^c\d{3}$/.test(h) ? h : null;
};

// Boot
worker.ready.then(async () => {
  appendOut("SICP Scheme ready.");
  await reader.load(chunkFromHash() ?? "c000");
});
window.addEventListener("hashchange", () => {
  const id = chunkFromHash();
  if (id) reader.load(id);
});
