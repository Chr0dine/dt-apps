/* global process, console, fetch */
// Refreshes the bundled IAM permission catalogue (ui/app/iamSnapshot.json) from the IAM policy reference and the global
// conditions page, with the same parser the iam-reference app function uses at runtime (api/iam-reference-parser.ts).
// The IAM tabs use the live catalogue when that function can reach docs.dynatrace.com and fall back to this snapshot,
// so re-run it whenever the docs change (the tabs show what differs from the snapshot).
//
//   npm run sync-iam             list permissions, conditions and operators that differ from the snapshot; exits 1 if any
//   npm run sync-iam -- --write  write the current docs into ui/app/iamSnapshot.json
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const ts = require("typescript");
const SNAPSHOT = path.join(root, "ui/app/iamSnapshot.json");
const write = process.argv.includes("--write");

function parser() {
  const src = fs.readFileSync(path.join(root, "api/iam-reference-parser.ts"), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", js)(mod, mod.exports, require);
  return mod.exports;
}

async function page(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  return res.text();
}

const p = parser();
const [refHtml, globHtml] = await Promise.all([page(p.POLICY_REFERENCE_URL), page(p.GLOBAL_CONDITIONS_URL)]);
const ref = p.parsePolicyReference(refHtml);
const glob = p.parseGlobalConditions(globHtml);
if (ref.services.length < 5) {
  console.error(`The IAM policy reference parsed to ${ref.services.length} services; the page layout may have changed. Fix api/iam-reference-parser.ts first.`);
  process.exit(1);
}
const catalog = { updated: ref.updated, globalsUpdated: glob.updated, services: ref.services, globals: glob.globals };

const old = fs.existsSync(SNAPSHOT) ? JSON.parse(fs.readFileSync(SNAPSHOT, "utf8")) : null;
const index = (c) => new Map((c?.services ?? []).flatMap((s) => s.permissions.map((x) => [x.id, x])));
const condSig = (x) => x.conditions.map((c) => `${c.key} [${c.operators.join(", ")}]`);
const before = index(old?.catalog);
const after = index(catalog);
const lines = [];
for (const [id, x] of after) {
  const was = before.get(id);
  if (!was) {
    lines.push(`  NEW         ${id}`);
    continue;
  }
  const a = new Set(condSig(was));
  const b = new Set(condSig(x));
  for (const c of b) if (!a.has(c)) lines.push(`  CONDITION+  ${id}  ${c}`);
  for (const c of a) if (!b.has(c)) lines.push(`  CONDITION-  ${id}  ${c}`);
}
for (const id of before.keys()) if (!after.has(id)) lines.push(`  REMOVED     ${id}`);
const oldGlobals = new Map((old?.catalog?.globals ?? []).map((g) => [g.key, g.operators.join(", ")]));
for (const g of catalog.globals) if (oldGlobals.get(g.key) !== g.operators.join(", ")) lines.push(`  GLOBAL      ${g.key} [${g.operators.join(", ")}]`);
for (const k of oldGlobals.keys()) if (!catalog.globals.some((g) => g.key === k)) lines.push(`  GLOBAL-     ${k}`);

console.log(`IAM policy reference updated ${catalog.updated ?? "?"}: ${catalog.services.length} services, ${after.size} permissions, ${catalog.globals.length} global conditions. Snapshot: ${old?.captured ?? "none"}.`);
if (lines.length) lines.forEach((l) => console.log(l));
else console.log("  No differences from the snapshot.");

if (write) {
  fs.writeFileSync(SNAPSHOT, JSON.stringify({ captured: new Date().toLocaleDateString("en-CA"), catalog }, null, 2) + "\n");
  console.log(`Wrote ${path.relative(root, SNAPSHOT)}.`);
} else if (lines.length) {
  console.log("Review the changes, then run: npm run sync-iam -- --write");
  process.exit(1);
}
