// Build app/public/book/{toc.json,chunks/*.json,fig/**} from book/src/html.
// Still a skeleton: the splitting rules (section headings, exercise anchors, footnotes) are
// TODO; figures, scripts and asset paths are handled.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src", "html");
const outDir = join(here, "..", "..", "app", "public", "book");

const OBJECT_RE = /<object\b([^>]*)>[\s\S]*?<\/object>/g;

const ICON_ALT = { cc: "Creative Commons", by: "Attribution", sa: "ShareAlike" };

if (!existsSync(srcDir)) {
  console.error("book/src/html missing — run `just book` (fetch.sh) first");
  process.exit(1);
}
mkdirSync(join(outDir, "chunks"), { recursive: true });

const files = readdirSync(srcDir).filter((f) => f.endsWith(".xhtml") || f.endsWith(".html")).sort();
const toc = [];
const assets = new Set(); // relative paths under book/, collected while rewriting figures
const written = new Set(); // absolute paths, so a rebuild can prune what the book no longer has
let n = 0;
for (const f of files) {
  const html = readFileSync(join(srcDir, f), "utf8");
  const title = (html.match(/<title>([^<]*)<\/title>/) || [, f])[1].trim();
  let body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/) || [, html])[1];
  // TODO(claude-code): split `body` at section/exercise boundaries; keep <a> anchors for cross-refs.
  body = stripScripts(body);
  body = rewriteFigures(body, assets);
  const code = [...body.matchAll(/<pre class="lisp"[^>]*>([\s\S]*?)<\/pre>/g)].map((m, i) => ({
    id: `${f}#code${i}`,
    src: decodeEntities(m[1].replace(/<[^>]+>/g, "")),
  }));
  const id = `c${String(n++).padStart(3, "0")}`;
  toc.push({ id, title, file: f });
  write(join(outDir, "chunks", `${id}.json`), JSON.stringify({ id, title, breadcrumb: [title], html: body, code, exercises: [] }));
}
write(join(outDir, "toc.json"), JSON.stringify({ license: "CC BY-SA 4.0", attribution: "book/ATTRIBUTION.md", chunks: toc }, null, 1));
copyAssets(assets);
prune(outDir);
console.log(`wrote ${toc.length} chunks and ${assets.size} figures to ${outDir}`);

// The book text pulls jQuery + its own footnote scripts; the PWA supplies its own behaviour.
function stripScripts(html) {
  return html.replace(/<script\b[\s\S]*?<\/script>/g, "");
}

// SICP embeds every figure as <object data="fig/…svg">. Injected into the reader those relative
// URLs resolve against the app's own route, not against book/, so each one 404s into the SPA
// fallback and the whole app renders itself inside the figure box. Emit <img> instead, and keep
// the path in data-src so the reader can resolve it against the deploy's base URL at load time
// (the same chunks have to work at / and at /sicp/).
function rewriteFigures(html, assets) {
  html = html.replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/g, (fig) => {
    const alt = figureLabel(fig) ?? captionOf(fig);
    return fig.replace(OBJECT_RE, (m, attrs) => imgTag(attrs, alt, assets) ?? m);
  });
  // Stray objects outside a <figure>: the licence marks on the title page.
  return html.replace(OBJECT_RE, (m, attrs) => imgTag(attrs, null, assets) ?? m);
}

function imgTag(attrs, alt, assets) {
  const path = (attrs.match(/\bdata="([^"]+)"/) || [])[1];
  if (!path || /^[a-z]+:|^\/\//i.test(path)) return null; // leave absolute/remote embeds alone
  assets.add(path);
  const size = (attrs.match(/width:\s*([\d.]+)ex;\s*height:\s*([\d.]+)ex/) || []).slice(1);
  // Keep the typeset width, but let CSS shrink it on a phone — hence aspect-ratio, not height.
  const style = size.length === 2 ? ` style="width:${size[0]}ex;aspect-ratio:${size[0]}/${size[1]}"` : "";
  const label = alt ?? ICON_ALT[(path.match(/([^/]+?)\.std\.svg$/) || [])[1]] ?? path.split("/").pop();
  return `<img class="fig" data-src="${path}" alt="${escapeAttr(label)}" loading="lazy" decoding="async"${style} />`;
}

// The caption is right next to the image, so the figure's own anchor ("Figure 5.16") is the
// alt text that adds something; the caption is only a fallback for figures without one.
function figureLabel(fig) {
  const id = (fig.match(/<a id="Figure-(\w+)"/) || [])[1];
  return id ? `Figure ${id.replace(/_002e/g, ".")}` : null;
}

function captionOf(fig) {
  const cap = fig.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/);
  if (!cap) return null;
  const text = decodeEntities(cap[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return text || null;
}

function copyAssets(assets) {
  const missing = [];
  for (const rel of assets) {
    const from = join(srcDir, rel);
    if (!existsSync(from)) { missing.push(rel); continue; }
    const to = join(outDir, rel);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    written.add(to);
  }
  if (missing.length) {
    console.error(`missing ${missing.length} figure file(s) under book/src/html, e.g. ${missing[0]}`);
    process.exit(1);
  }
}

function write(path, data) {
  writeFileSync(path, data);
  written.add(path);
}

// Drop output from an earlier build that this one no longer produces. Deleting the directories
// themselves would pull them out from under a running `vite dev`, so only files go.
function prune(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) prune(p);
    else if (!written.has(p)) rmSync(p);
  }
}

function escapeAttr(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function decodeEntities(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
