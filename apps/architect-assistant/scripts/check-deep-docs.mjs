/* global process, console, fetch */
// Checks the Dynatrace docs pages behind the Deep Monitoring catalogue and the Service Detection v2 tab
// (ui/app/deepTech.ts, DOC) against the docs sitemap, which carries a lastmod date for every page. Watched sections
// (DOC_SECTIONS) are listed in full, so pages published there since the last review are reported as well.
//
//   npm run check-docs               list pages updated since the last review, pages missing from the sitemap
//                                    (moved or removed) and cited pages not reviewed yet; exits 1 if there are any
//   npm run check-docs -- --accept   after reading those pages and updating deepTech.ts / sdv2.ts, record their
//                                    current lastmod (cited pages and every page of the watched sections) and
//                                    today's date in ui/app/deepDocsSnapshot.json
//
// The app runs the same comparison at runtime (app function docs-freshness) and flags affected fixes; this script is
// for updating the catalogue itself. Vendor pages (nodejs.org, go.dev, ...) have no sitemap date and are not tracked.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const ts = require("typescript");
const SNAPSHOT = path.join(root, "ui/app/deepDocsSnapshot.json");
const SITEMAP = "https://docs.dynatrace.com/docs/sitemap.xml";
const accept = process.argv.includes("--accept");

/** Dynatrace doc URLs cited by the catalogue and the watched sections, read from deepTech.ts itself (no second list to keep in sync). */
function catalogue() {
  const src = fs.readFileSync(path.join(root, "ui/app/deepTech.ts"), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", js)(mod, mod.exports, require);
  const seen = new Map();
  for (const d of Object.values(mod.exports.DOC)) if (d.url.startsWith("https://docs.dynatrace.com/")) seen.set(d.url, d.title);
  return { docs: seen, sections: mod.exports.DOC_SECTIONS ?? [] };
}

async function sitemap() {
  const res = await fetch(SITEMAP);
  if (!res.ok) throw new Error(`${SITEMAP} returned HTTP ${res.status}`);
  const text = await res.text();
  const out = new Map();
  for (const m of text.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)) out.set(m[1].replace(/\/+$/, ""), m[2]);
  return out;
}

const { docs, sections } = catalogue();
const live = await sitemap();
const inSection = (url, prefix) => url === prefix || url.startsWith(`${prefix}/`);
const sectionOf = (url) => sections.find((s) => inSection(url, s.prefix));
const snap = fs.existsSync(SNAPSHOT) ? JSON.parse(fs.readFileSync(SNAPSHOT, "utf8")) : { reviewed: null, pages: {} };
const day = (iso) => (iso ? iso.slice(0, 10) : "—");

const changed = [];
const missing = [];
const unreviewed = [];
for (const [url, title] of docs) {
  const now = live.get(url);
  const then = snap.pages[url];
  if (!now) missing.push({ url, title });
  else if (!then) unreviewed.push({ url, title, now });
  else if (now > then) changed.push({ url, title, then, now });
}
// Watched sections: every live page under the prefix, plus snapshot pages that left the sitemap.
const sectionPages = [...live.keys()].filter((u) => sectionOf(u));
const uncited = [];
for (const url of sectionPages) {
  if (docs.has(url)) continue;
  const now = live.get(url);
  const then = snap.pages[url];
  const title = `(${sectionOf(url).title} section, not cited)`;
  if (!then) uncited.push({ url, title, now });
  else if (now > then) changed.push({ url, title, then, now });
}
for (const url of Object.keys(snap.pages)) if (!docs.has(url) && sectionOf(url) && !live.has(url)) missing.push({ url, title: `(${sectionOf(url).title} section)` });

console.log(`Catalogue docs: ${docs.size} Dynatrace pages cited, ${sectionPages.length} pages in watched sections (${sections.map((s) => s.title).join(", ") || "none"}), last reviewed ${snap.reviewed ?? "never"}.`);
for (const c of changed) console.log(`  UPDATED     ${day(c.then)} -> ${day(c.now)}  ${c.title}  ${c.url}`);
for (const m of missing) console.log(`  NOT FOUND   (moved or removed)  ${m.title}  ${m.url}`);
for (const u of unreviewed) console.log(`  NEW         ${day(u.now)}  ${u.title}  ${u.url}`);
for (const u of uncited) console.log(`  NEW PAGE    ${day(u.now)}  ${u.title}  ${u.url}`);
if (!changed.length && !missing.length && !unreviewed.length && !uncited.length) console.log("  All pages unchanged since the review.");

if (accept) {
  if (missing.some((m) => docs.has(m.url))) {
    console.error("Not accepting: fix or replace the missing URLs in deepTech.ts first.");
    process.exit(1);
  }
  const pages = Object.fromEntries([...new Set([...docs.keys(), ...sectionPages])].sort().map((url) => [url, live.get(url)]));
  fs.writeFileSync(SNAPSHOT, JSON.stringify({ reviewed: new Date().toLocaleDateString("en-CA"), pages }, null, 2) + "\n");
  console.log(`Recorded ${Object.keys(pages).length} pages in ${path.relative(root, SNAPSHOT)}.`);
} else if (changed.length || missing.length || unreviewed.length || uncited.length) {
  console.log("Review these pages, update ui/app/deepTech.ts / deepActions.ts / sdv2.ts (cite new pages in DOC if they matter), then run: npm run check-docs -- --accept");
  process.exit(1);
}
