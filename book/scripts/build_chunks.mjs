// Build app/public/book/{toc.json,chunks/*.json} from book/src/html.
// Deliberately a skeleton: Claude Code should flesh out the splitting rules after inspecting
// the actual markup (section headings, <pre class="lisp">, exercise anchors, footnotes, figures).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src", "html");
const outDir = join(here, "..", "..", "app", "public", "book");

if (!existsSync(srcDir)) {
  console.error("book/src/html missing — run `just book` (fetch.sh) first");
  process.exit(1);
}
mkdirSync(join(outDir, "chunks"), { recursive: true });
if (existsSync(join(srcDir, "fig"))) cpSync(join(srcDir, "fig"), join(outDir, "fig"), { recursive: true });

const files = readdirSync(srcDir).filter((f) => f.endsWith(".xhtml") || f.endsWith(".html")).sort();
const toc = [];
let n = 0;
for (const f of files) {
  const html = readFileSync(join(srcDir, f), "utf8");
  const title = (html.match(/<title>([^<]*)<\/title>/) || [, f])[1].trim();
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/) || [, html])[1];
  // TODO(claude-code): split `body` at section/exercise boundaries; extract <pre class="lisp">
  // blocks into `code[]` with stable ids; keep <a> anchors for cross-refs; sanitise.
  const code = [...body.matchAll(/<pre class="lisp"[^>]*>([\s\S]*?)<\/pre>/g)].map((m, i) => ({
    id: `${f}#code${i}`,
    src: decodeEntities(m[1].replace(/<[^>]+>/g, "")),
  }));
  const id = `c${String(n++).padStart(3, "0")}`;
  toc.push({ id, title, file: f });
  writeFileSync(join(outDir, "chunks", `${id}.json`), JSON.stringify({ id, title, breadcrumb: [title], html: body, code, exercises: [] }));
}
writeFileSync(join(outDir, "toc.json"), JSON.stringify({ license: "CC BY-SA 4.0", attribution: "book/ATTRIBUTION.md", chunks: toc }, null, 1));
console.log(`wrote ${toc.length} chunks to ${outDir}`);

function decodeEntities(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
