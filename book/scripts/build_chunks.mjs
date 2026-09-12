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

// Where the book actually lives. This app is two removes from it — the MIT Press text, Andres
// Raba's HTML5 edition, then our chunks — and CC BY-SA asks that the trail stay visible, so the
// cover names it and `toc.json` carries it for anything else that needs to cite the source.
const SOURCE = {
  original: { href: "https://mitpress.mit.edu/sicp", label: "mitpress.mit.edu/sicp" },
  edition: { href: "https://sarabander.github.io/sicp", label: "sarabander.github.io/sicp" },
  editionSource: { href: "https://github.com/sarabander/sicp", label: "github.com/sarabander/sicp" },
  license: { href: "https://creativecommons.org/licenses/by-sa/4.0/", label: "CC BY-SA 4.0" },
};

const COVER_ID = "c000";  // the cover is chunk zero; the book's own files start at c001
const COVER_PLATE = "fig/bookwheel.jpg";  // the engraving on this edition's cover page

if (!existsSync(srcDir)) {
  console.error("book/src/html missing — run `just book` (fetch.sh) first");
  process.exit(1);
}
mkdirSync(join(outDir, "chunks"), { recursive: true });

const outline = outlineOf(readdirSync(srcDir).filter((f) => f.endsWith(".xhtml") || f.endsWith(".html")).sort());
const files = outline.map((e) => e.file);
const ids = new Map(files.map((f, i) => [f, `c${String(i + 1).padStart(3, "0")}`]));
const outlined = new Map(outline.map((e) => [e.file, e]));
const toc = [];
const assets = new Set(); // relative paths under book/, collected while rewriting figures
const written = new Set(); // absolute paths, so a rebuild can prune what the book no longer has
writeCover(files[0], assets);
for (const f of files) {
  const html = readFileSync(join(srcDir, f), "utf8");
  const title = (html.match(/<title>([^<]*)<\/title>/) || [, f])[1]
    .replace(/^Structure and Interpretation of Computer Programs,\s*2e:\s*/, "").trim();
  let body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/) || [, html])[1];
  // TODO(claude-code): split `body` at section/exercise boundaries; keep <a> anchors for cross-refs.
  body = stripScripts(body);
  body = stripWebNav(body);
  body = rewriteLinks(body);
  body = rewriteFigures(body, assets);
  body = wrapMath(body);
  const code = [...body.matchAll(/<pre class="lisp"[^>]*>([\s\S]*?)<\/pre>/g)].map((m, i) => ({
    id: `${f}#code${i}`,
    src: decodeEntities(m[1].replace(/<[^>]+>/g, "")),
  }));
  const id = ids.get(f);
  const { label, level } = outlined.get(f);
  toc.push({ id, title, file: f, label: label ?? title, level });
  write(join(outDir, "chunks", `${id}.json`), JSON.stringify({ id, title, breadcrumb: breadcrumbOf(body, title), html: body, code, exercises: [] }));
}
write(join(outDir, "toc.json"), JSON.stringify({ license: "CC BY-SA 4.0", attribution: "book/ATTRIBUTION.md", source: SOURCE, cover: COVER_ID, chunks: toc }, null, 1));
copyAssets(assets);
copyFonts();
prune(outDir);
console.log(`wrote ${toc.length} chunks and ${assets.size} figures to ${outDir}`);

// Texinfo names its files after sections, and readdir hands them back alphabetically: the book
// would open at 1.1 and keep its title page and table of contents filed after the back matter.
// index.xhtml's own table of contents has what the reader needs instead — the order, the nesting,
// and better names than the <title> tags ("1.1 The Elements of Programming", not "1.1"). Walk it
// once, keep each file's first mention, and append anything it does not list so none is dropped.
//
// Depth becomes `level`: 0 for front matter, chapters and back matter, 1 for the sections inside a
// chapter. Deeper entries (1.1.3 and the like) are anchors in a file already listed, so the `seen`
// check drops them — the reader's menu stops where the chunks stop.
function outlineOf(files) {
  const first = files.includes("index.xhtml") ? "index.xhtml" : files[0];
  const body = readFileSync(join(srcDir, first), "utf8").replace(/<head>[\s\S]*?<\/head>/, "");
  const contents = (body.match(/<div class="contents">[\s\S]*?<\/div>/) || [body])[0];
  const seen = new Set([first]);
  const outline = [{ file: first, label: "Title page", level: 0 }];
  let depth = 0;
  const ENTRY = /<ul\b[^>]*>|<\/ul>|<a\b[^>]*href="([^"#]+\.x?html)(?:#[^"]*)?"[^>]*>([\s\S]*?)<\/a>/g;
  for (const m of contents.matchAll(ENTRY)) {
    if (m[0] === "</ul>") depth--;
    else if (m[0].startsWith("<ul")) depth++;
    else if (files.includes(m[1]) && !seen.has(m[1])) {
      seen.add(m[1]);
      outline.push({ file: m[1], label: plain(m[2]), level: Math.max(0, depth - 1) });
    }
  }
  // A file the contents never mentions still gets a chunk; it falls back to its own <title>.
  for (const f of files) if (!seen.has(f)) outline.push({ file: f, label: null, level: 0 });
  return outline;
}

function plain(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

// A book opens on its cover. Emitted as chunk zero, ahead of the book's own files: the title page
// as this edition sets it, the bookwheel from its cover plate, and — because the reader is an
// adaptation several removes from the text — where the original is published.
function writeCover(firstFile, assets) {
  assets.add(COVER_PLATE);
  const title = "Structure and Interpretation of Computer Programs";
  const html = `<section class="cover">
<p class="cover-edition">Second Edition</p>
<h1 class="cover-title">Structure and Interpretation<br />of Computer Programs</h1>
<p class="cover-byline">Harold Abelson and Gerald Jay Sussman<br />with Julie Sussman<br />
<span class="cover-foreword">foreword by Alan J. Perlis</span></p>
<img class="cover-plate" data-src="${COVER_PLATE}" width="897" height="1302" decoding="async"
 alt="Agostino Ramelli&#39;s bookwheel of 1588: a reader at a turning wheel of open books" />
<p class="cover-enter"><a href="#${ids.get(firstFile)}">Open the book &#8250;</a></p>
<div class="cover-colophon">
<p>&#169;&#8201;1996 Massachusetts Institute of Technology, published by The <abbr>MIT</abbr> Press
and licensed ${ext(SOURCE.license)}.</p>
<p>The original is at ${ext(SOURCE.original)}. This reader is built from the
<abbr>HTML5</abbr> edition prepared by Andres Raba, ${ext(SOURCE.edition)}
(${ext(SOURCE.editionSource, "source")}); the text and everything adapted from it here stays under
the same licence.</p>
<p>Cover plate: Agostino Ramelli&#8217;s bookwheel, 1588.</p>
</div>
</section>`;
  toc.push({ id: COVER_ID, title: "Cover", file: null, label: "Cover", level: 0 });
  write(join(outDir, "chunks", `${COVER_ID}.json`),
    JSON.stringify({ id: COVER_ID, title, breadcrumb: ["SICP", "Second Edition"], html, code: [], exercises: [] }));
}

// Links off the cover leave the app; a PWA that navigates away in place cannot be navigated back.
function ext({ href, label }, text = label) {
  return `<a href="${href}" target="_blank" rel="noreferrer">${text}</a>`;
}

// The book text pulls jQuery + its own footnote scripts; the PWA supplies its own behaviour.
function stripScripts(html) {
  return html.replace(/<script\b[\s\S]*?<\/script>/g, "");
}

// A running head, the way a book has one: the number and the title of the section on the page.
function breadcrumbOf(body, title) {
  const num = (body.match(/<span class="(?:secnum|chapnum)">([^<]*)<\/span>/) || [])[1];
  const name = (body.match(/<span class="(?:sectitle|chaptitle)">([\s\S]*?)<\/span>/) || [])[1];
  if (num && name) return [num.trim(), decodeEntities(name.replace(/<[^>]+>/g, "")).trim()];
  const head = (body.match(/<h[1-5][^>]*>([\s\S]*?)<\/h[1-5]>/) || [])[1];
  return [head ? decodeEntities(head.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim() : title];
}

// The Texinfo nav bars ("Next: 1.3, Prev: 1.1") and the fixed jump-to-top arrows are artefacts of
// a paginated website; the reader has its own breadcrumb and the arrows would float over the REPL.
function stripWebNav(html) {
  return html
    .replace(/<nav class="header">[\s\S]*?<\/nav>/g, "")
    .replace(/<span class="(?:top|bottom) jump"[^>]*>[\s\S]*?<\/span>/g, "")
    .replace(/<hr\s*\/?>\s*(?=<\/section>)/g, "");
}

// Cross-references point at the source filenames ("1_002e3.xhtml#g_t1_002e3"). Point them at the
// chunk that file became instead; in-page anchors (footnotes, figures) are left alone.
function rewriteLinks(html) {
  html = html.replace(/href="([^"#]+\.x?html)(#[^"]*)?"/g, (m, file, frag) => {
    const id = ids.get(file);
    return id ? `href="#${id}"` : m;
  });
  // The handful of links that leave the book — the title page's reference to the original at
  // mitpress.mit.edu, the colophon's credits — open in a new tab like the cover's do: followed in
  // place they replace the app, and an installed PWA has no back button to return with.
  return html.replace(/<a\b([^>]*\bhref="https?:[^"]*"[^>]*)>/g, '<a$1 target="_blank" rel="noreferrer">');
}

// The book is set in Linux Libertine/Biolinum, Inconsolata LGC and STIX; ship those webfonts with
// the app so the reader looks like the book offline. GPL-with-font-exception and OFL — the licence
// files travel with them (see book/ATTRIBUTION.md).
function copyFonts() {
  const fontDir = join(srcDir, "css", "fonts");
  if (!existsSync(fontDir)) { console.error("book/src/html/css/fonts missing"); process.exit(1); }
  const outFonts = join(outDir, "fonts");
  mkdirSync(outFonts, { recursive: true });
  for (const name of readdirSync(fontDir)) {
    if (!/\.(woff2?|txt)$/.test(name)) continue;
    const to = join(outFonts, name);
    copyFileSync(join(fontDir, name), to);
    written.add(to);
  }
  // font-display:swap so the text is readable while ~600 KB of webfonts arrive on a phone.
  const css = readFileSync(join(fontDir, "fonts.css"), "utf8")
    .replace(/(@font-face\s*\{)/g, "$1\n  font-display: swap;");
  write(join(outFonts, "fonts.css"), css);
}

// A browser lays out MathML with its own math engine, and only for as long as the <math> element
// keeps the `display` it was born with. Give it any CSS display — `inline-block` to stop a wide
// formula pushing the page sideways, `block` to set a displayed one off — and the engine hands the
// formula back to ordinary CSS box layout: fraction bars run the full width of the column,
// numerators sit above them like paragraphs, and a summation's limits stack under the sign. The
// page still needs a box it can clamp and scroll on a phone, so give it one of its own around each
// formula and leave the math itself alone (`app/src/styles.css`, `span.math`/`span.math-block`).
// A span, not a div: the book sets displayed equations inside the paragraph that introduces them,
// and a block element there would split the paragraph in two.
function wrapMath(html) {
  return html.replace(/<math\b([^>]*)>[\s\S]*?<\/math>/g, (m, attrs) =>
    `<span class="${/\bdisplay="block"/.test(attrs) ? "math-block" : "math"}">${m}</span>`);
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
  // Stray objects outside a <figure>: the licence marks on the title page, set inline with text.
  return html.replace(OBJECT_RE, (m, attrs) => imgTag(attrs, null, assets, "fig icon") ?? m);
}

function imgTag(attrs, alt, assets, cls = "fig") {
  const path = (attrs.match(/\bdata="([^"]+)"/) || [])[1];
  if (!path || /^[a-z]+:|^\/\//i.test(path)) return null; // leave absolute/remote embeds alone
  assets.add(path);
  const size = (attrs.match(/width:\s*([\d.]+)ex;\s*height:\s*([\d.]+)ex/) || []).slice(1);
  // Keep the typeset width, but let CSS shrink it on a phone — hence aspect-ratio, not height.
  const style = size.length === 2 ? ` style="width:${size[0]}ex;aspect-ratio:${size[0]}/${size[1]}"` : "";
  const label = alt ?? ICON_ALT[(path.match(/([^/]+?)\.std\.svg$/) || [])[1]] ?? path.split("/").pop();
  return `<img class="${cls}" data-src="${path}" alt="${escapeAttr(label)}" loading="lazy" decoding="async"${style} />`;
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
