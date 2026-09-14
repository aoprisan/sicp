import { SchemeWorker } from "./worker-client";
import { Editor } from "./editor/editor";
import { highlight } from "./editor/highlight";
import { KeyRow } from "./editor/keyrow";
import { Radial } from "./editor/radial";
import { Reader } from "./reader";
import { Contents, BENCH_ID } from "./contents";

const worker = new SchemeWorker();
const output = document.getElementById("output")!;
const editor = new Editor(document.getElementById("editor-host")!);
const keyrow = new KeyRow(document.getElementById("keyrow")!, editor);
const radial = new Radial(editor, worker);
const sheet = document.getElementById("sheet")!;
const crumbText = document.getElementById("crumb-text")!;
const reader = new Reader(document.getElementById("reader")!, crumbText);
const contents = new Contents(
  document.getElementById("contents")!,
  document.getElementById("veil")!,
  document.getElementById("contents-open")!,
);

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

// One way to evaluate, whether it is pressed with a thumb or with Ctrl/⌘-Enter.
const runBuffer = () => run(editor.value).then(() => editor.clearIfWanted());
keyrow.onRun = runBuffer;
editor.onRun = runBuffer;
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

// Two views over the one page, and both are hashes, so the menu's entries stay ordinary links and
// the back button walks between book and bench like any other pair of pages. The book is put away
// rather than unloaded — `#scheme` hides it and hands the whole screen to the REPL (see the
// `view-bench` rules in styles.css), and the page it was open at is still there on the way back.
let lastChunk = "c000";
// Where the page was when the bench took the screen. The book is hidden, not unloaded, but a
// hidden page is a page of no height: the browser drops the scroll offset to 0 the moment it
// goes, so the way back has to put it back.
let leftOff = 0;

// One way in and out of a chunk: the page, the running head, the menu's current entry and the
// page-turn links at the foot all come from the same id.
async function show(id: string) {
  lastChunk = id;
  // Coming back from the bench is not a page turn: reload only a chunk we are not already on, or
  // the reader would lose its scroll position and every result a `Run` had printed.
  if (reader.at !== id) {
    await reader.load(id);
    reader.turn(contents.prev(id), contents.next(id));
  } else {
    reader.reheading();          // the bench had the running head; the page takes it back
  }
  contents.mark(id);
}

const onBench = () => document.body.classList.contains("view-bench");

function bench() {
  if (onBench()) return;
  leftOff = window.scrollY;
  document.body.classList.add("view-bench");
  document.title = "Scheme — SICP";
  crumbText.textContent = "Scheme interpreter";
  contents.mark(BENCH_ID);
  // With the book put away the bench is the page, and a page needs a landmark: the reader's
  // `<main>` is not there to be one.
  sheet.setAttribute("role", "main");
  // A view that is nothing but a REPL should be ready to type into. On a phone an uninvited
  // keyboard would eat the transcript, so only where there is a pointer to have put one there.
  if (matchMedia("(hover: hover) and (pointer: fine)").matches) editor.focus();
}

function route(boot = false) {
  if (location.hash.slice(1) === BENCH_ID) return bench();
  const chunk = chunkFromHash();
  // An in-page anchor belongs to the page it is on; only leave the bench for a real destination.
  if (!chunk && location.hash && !onBench() && !boot) return;
  const id = chunk ?? lastChunk;
  // Coming off the bench onto the page it was opened over: the same page, so put it back where
  // it was. Going to any other entry is a page turn, and a page turn starts at the top.
  const resume = onBench() && reader.at === id ? leftOff : null;
  document.body.classList.remove("view-bench");
  document.title = "SICP";
  sheet.removeAttribute("role");
  show(id).then(() => {
    if (resume === null) return;
    void document.body.offsetHeight;   // the book has its height back only once layout has run
    window.scrollTo(0, resume);
  });
}

// Boot. The book does not wait on the interpreter: paper first, the bench when it is ready.
contents.load().then(() => route(true));
worker.ready.then(() => appendOut("SICP Scheme ready."));
window.addEventListener("hashchange", () => route());
