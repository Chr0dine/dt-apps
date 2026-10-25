import {
  GLOBAL_HINTS,
  IAM_DOCS,
  attributeOf,
  conditionOf,
  globalOperators,
  grailTableOf,
  isListOperator,
  serviceOf,
  sortOperators,
  type CatalogIndex,
} from "./iamCatalog";
import type { AppLevel, AppSummary } from "./iamApps";

const BUCKETS = "storage:buckets:read";

// ---------------------------------------------------------------------------
// IAM policy and boundary engine for the IAM Policy Creator / IAM Boundary Creator tabs. Pure functions:
// - drafts (what the GUI edits) -> statement text; the Policy Creator writes one ALLOW line per permission, grouped
//   into blocks (apps, app state, Read / Write / Execute, data access, individual permissions),
// - statement / boundary text (generated or typed) -> parsed form with character offsets -> diagnostics for the editor,
// - policy text + boundary -> effective statements, following "How are policy boundaries applied?" in the boundary docs,
// - text -> draft, so an existing policy can be loaded into the builder.
// Syntax rules come from the IAM policy statement syntax page; limits from the boundary and IAM limits pages.
// ---------------------------------------------------------------------------

export const MAX_STATEMENTS = 100;
export const MAX_BOUNDARY_CONDITIONS = 10;

export type Effect = "ALLOW" | "DENY";
/** One condition in a draft. For dimensions `key` is the attribute without its service prefix (e.g. dt.security_context). */
export type Cond = { id: string; key: string; op: string; values: string[] };
export type PermRow = { id: string; permission: string; effect: Effect; conditions: Cond[]; /** Apply the Dimensional data conditions. */ scoped: boolean };
export type PolicyStep = 1 | 2 | 3;

export type PolicyDraft = {
  name: string;
  /** Step 1: let the group open every app (app-engine:apps:run without a condition). */
  allApps: boolean;
  /** Step 1: selected apps (App Registry ID) -> access levels; [] = open the app only. */
  appLevels: Record<string, AppLevel[]>;
  /** Step 1: per app, the manifest permissions the user left out. */
  appExclude: Record<string, string[]>;
  /** Limit app state / app settings permissions to the selected apps (shared:app-id). */
  limitOwned: boolean;
  /** Step 2: add the Grail data permissions the selected apps read (opt-in). */
  dataEnabled: boolean;
  /** Step 2: per data permission, included or not; missing = included when a selected app requires it. */
  dataInclude: Record<string, boolean>;
  dims: Cond[];
  /** all = one statement per permission with every applicable dimension (AND); any = one statement per dimension (OR). */
  dimMode: "all" | "any";
  /** Step 3: individual permissions with their own conditions. */
  rows: PermRow[];
  globals: Cond[];
  comments: boolean;
  /** Combine statements with the same conditions (off: every permission on its own ALLOW line). */
  combine: boolean;
  step: PolicyStep;
};

export type BoundaryDim = Cond & { /** Services the dimension is written for (storage, settings, …); one boundary line each. */ services: string[] };
export type BoundaryDraft = {
  name: string;
  apps: { op: string; ids: string[] };
  dims: BoundaryDim[];
  conds: Cond[];
};

let seq = 0;
export const uid = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;

export const emptyPolicy = (): PolicyDraft => ({
  name: "",
  allApps: false,
  appLevels: {},
  appExclude: {},
  limitOwned: true,
  dataEnabled: false,
  dataInclude: {},
  dims: [],
  dimMode: "all",
  rows: [],
  globals: [],
  comments: true,
  combine: false,
  step: 1,
});
export const emptyBoundary = (): BoundaryDraft => ({ name: "", apps: { op: "IN", ids: [] }, dims: [], conds: [] });

// --- Rendering -----------------------------------------------------------------------------------------------------
export type CondValue = { key: string; op: string; values: string[] };
export type Statement = { effect: Effect; permissions: string[]; conditions: CondValue[] };
/** A policy line: a statement (with an optional trailing comment) or a comment line (warnings are always written). */
export type PolicyLine = { statement: Statement; note?: string } | { comment: string };
export type PolicyBlock = { title: string; lines: PolicyLine[] };
export type AppIndex = Map<string, AppSummary>;

const quote = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
export const renderCondition = (c: CondValue) =>
  `${c.key} ${c.op} ${isListOperator(c.op) ? `(${c.values.map(quote).join(", ")})` : quote(c.values[0] ?? "")}`;
export const renderStatement = (s: { effect: string; permissions: string[]; conditions: CondValue[] }) =>
  `${s.effect} ${s.permissions.join(", ")}${s.conditions.length ? ` WHERE ${s.conditions.map(renderCondition).join(" AND ")}` : ""};`;
/** A condition counts once it has a value (blank rows in the GUI are left out). */
export const filled = <T extends CondValue>(cs: T[]) => cs.filter((c) => c.values.some((v) => v.trim() !== ""));
const clean = (c: CondValue): CondValue => ({ key: c.key, op: c.op, values: (isListOperator(c.op) ? c.values : c.values.slice(0, 1)).filter((v) => v.trim() !== "") });
const listOf = (key: string, values: string[]): CondValue => ({ key, op: values.length > 1 ? "IN" : "=", values });

/**
 * The operator to write for a permission that does not support the chosen one, when an equivalent exists: MATCH without
 * wildcards = IN (or = for one value); MATCH with one "prefix*" = startsWith; IN with one value = =. On entities, IN and
 * startsWith already match any element of a multi-value security context (Grant access to entities with security
 * context). null = no equivalent (the editor reports the unsupported operator).
 */
export function adaptOperator(op: string, values: string[], supported: string[]): string | null {
  if (supported.includes(op)) return op;
  const vs = values.filter((v) => v.trim() !== "");
  const exact = vs.length === 1 && supported.includes("=") ? "=" : supported.includes("IN") ? "IN" : null;
  if (op === "MATCH" && vs.every((v) => !v.includes("*"))) return exact;
  if (op === "MATCH" && vs.length === 1 && /^[^*]+\*$/.test(vs[0]) && supported.includes("startsWith")) return "startsWith";
  if (op === "IN" && vs.length === 1 && supported.includes("=")) return "=";
  return null;
}

/** The Dimensional data conditions that apply to a permission: one per condition key with the same attribute name. */
export function dimensionConditions(permission: string, dims: Cond[], ix: CatalogIndex): CondValue[] {
  const p = ix.permissions.get(permission);
  if (!p) return [];
  return filled(dims).flatMap((d) =>
    p.conditions
      .filter((c) => attributeOf(c.key) === d.key)
      .map((c) => {
        const op = adaptOperator(d.op, d.values, c.operators) ?? d.op;
        const values = op === "startsWith" && d.op === "MATCH" ? d.values.map((v) => v.replace(/\*$/, "")) : d.values;
        return clean({ key: c.key, op, values });
      }),
  );
}
/** One condition set per statement: all dimensions together (AND), or one statement per dimension (OR). */
const dimVariants = (dims: CondValue[], mode: PolicyDraft["dimMode"]) => (mode === "any" && dims.length > 1 ? dims.map((c) => [c]) : [dims]);

export const selectedApps = (d: PolicyDraft) => Object.keys(d.appLevels);

export type DataNeed = { permission: string; required: string[]; optional: string[]; included: boolean };

/** Grail data permissions the selected apps (with Read) request, and whether the Data access step includes them. */
export function dataNeeds(d: PolicyDraft, apps: AppIndex): DataNeed[] {
  const m = new Map<string, { required: string[]; optional: string[] }>();
  for (const id of selectedApps(d)) {
    const s = apps.get(id);
    if (!s || !d.appLevels[id].includes("read")) continue;
    const excl = new Set(d.appExclude[id] ?? []);
    for (const p of s.data) {
      if (excl.has(p.permission)) continue;
      const cur = m.get(p.permission) ?? { required: [], optional: [] };
      (p.optional ? cur.optional : cur.required).push(s.app.name);
      m.set(p.permission, cur);
    }
  }
  return [...m]
    .map(([permission, v]) => ({ permission, ...v, included: d.dataEnabled && (d.dataInclude[permission] ?? v.required.length > 0) }))
    .sort((a, b) => Number(b.required.length > 0) - Number(a.required.length > 0) || a.permission.localeCompare(b.permission));
}

export type AppGap = { id: string; name: string; missing: string[] };
/** Selected apps whose required data is not granted by the Data access step. */
export function appDataGaps(d: PolicyDraft, apps: AppIndex): AppGap[] {
  const granted = new Set(dataNeeds(d, apps).filter((n) => n.included).map((n) => n.permission));
  return selectedApps(d)
    .map((id) => apps.get(id))
    .filter((s): s is AppSummary => !!s && d.appLevels[s.app.id].includes("read"))
    .map((s) => ({ id: s.app.id, name: s.app.name, missing: s.requiredData.filter((p) => !(d.appExclude[s.app.id] ?? []).includes(p) && !granted.has(p)) }))
    .filter((g) => g.missing.length > 0);
}

export function policyBlocks(d: PolicyDraft, ix: CatalogIndex, apps: AppIndex | null): PolicyBlock[] {
  const globals = filled(d.globals).map(clean);
  const allow = (permission: string, conds: CondValue[] = []): Statement => ({ effect: "ALLOW", permissions: [permission], conditions: [...conds, ...globals] });
  const name = (id: string) => apps?.get(id)?.app.name ?? id;
  const names = (ids: string[]) => ids.map(name).sort((a, b) => a.localeCompare(b)).join(", ");
  const short = (p: string) => p.replace(/^storage:/, "").replace(/:read$/, "");
  const ids = selectedApps(d).sort((a, b) => name(a).localeCompare(name(b)));
  const blocks: PolicyBlock[] = [];

  // Step 1: one app-engine:apps:run line per app, then the permissions the apps request, one per line.
  const run: PolicyLine[] = d.allApps ? [{ statement: allow("app-engine:apps:run"), note: "every installed app" }] : ids.map((id) => ({ statement: allow("app-engine:apps:run", [listOf("shared:app-id", [id])]), note: name(id) }));
  if (run.length) blocks.push({ title: "Apps", lines: run });
  if (apps && ids.length) {
    const owned = new Map<string, string[]>();
    const byLevel: Record<AppLevel, Map<string, string[]>> = { read: new Map(), write: new Map(), execute: new Map() };
    const add = (m: Map<string, string[]>, p: string, id: string) => m.set(p, [...(m.get(p) ?? []), id]);
    for (const id of ids) {
      const s = apps.get(id);
      if (!s) continue;
      const excl = new Set(d.appExclude[id] ?? []);
      s.owned.forEach((p) => !excl.has(p.permission) && add(owned, p.permission, id));
      for (const level of d.appLevels[id]) s.byLevel[level].forEach((p) => !excl.has(p.permission) && add(byLevel[level], p.permission, id));
    }
    const lines = (m: Map<string, string[]>, conds?: (appIds: string[]) => CondValue[]) =>
      [...m].sort(([a], [b]) => a.localeCompare(b)).map(([p, appIds]): PolicyLine => ({ statement: allow(p, conds?.(appIds) ?? []), note: names(appIds) }));
    if (owned.size) blocks.push({ title: `App state and app settings${d.limitOwned ? " (limited to the selected apps)" : ""}`, lines: lines(owned, d.limitOwned ? (appIds) => [listOf("shared:app-id", appIds)] : undefined) });
    for (const level of ["read", "write", "execute"] as AppLevel[]) if (byLevel[level].size) blocks.push({ title: `${level[0].toUpperCase()}${level.slice(1)}`, lines: lines(byLevel[level]) });

    // Step 2: data permissions with the dimensional data, bucket access for their tables, and what is still missing.
    const needs = dataNeeds(d, apps);
    const data: PolicyLine[] = [];
    const included = needs.filter((n) => n.included);
    for (const n of included)
      for (const v of dimVariants(dimensionConditions(n.permission, d.dims, ix), d.dimMode)) data.push({ statement: allow(n.permission, v), note: [...n.required, ...n.optional].sort((a, b) => a.localeCompare(b)).join(", ") });
    const tables = [...new Set(included.map((n) => grailTableOf(n.permission)).filter((t): t is string => !!t))];
    if (tables.length) {
      const bucketDims = dimensionConditions(BUCKETS, d.dims, ix);
      data.push({ statement: allow(BUCKETS, bucketDims.length ? bucketDims : [listOf("storage:table-name", tables)]), note: "bucket access for the tables above" });
    }
    for (const g of appDataGaps(d, apps)) data.push({ comment: `⚠ ${g.name} shows Grail data this policy does not grant yet (${g.missing.map(short).join(", ")}): add it in step 2, Data access` });
    if (data.length) blocks.push({ title: "Data access", lines: data });
  } else if (ids.length && !apps) blocks.push({ title: "App permissions", lines: [{ comment: "Reading the permissions the selected apps request…" }] });

  // Step 3: individual permissions, grouped by service.
  const byService = new Map<string, PolicyLine[]>();
  for (const row of d.rows) {
    const group = ix.permissions.get(row.permission)?.service.title || serviceOf(row.permission);
    const base = filled(row.conditions).map(clean);
    const dims = row.scoped ? dimensionConditions(row.permission, d.dims, ix) : [];
    for (const v of dimVariants(dims, d.dimMode))
      byService.set(group, [...(byService.get(group) ?? []), { statement: { effect: row.effect, permissions: [row.permission], conditions: [...base, ...v, ...globals] } }]);
  }
  byService.forEach((lines, title) => blocks.push({ title, lines }));
  return d.combine ? blocks.map(combineBlock) : blocks;
}

/** Statements of a block with the same effect and conditions become one statement listing every permission. */
function combineBlock(b: PolicyBlock): PolicyBlock {
  const out: PolicyLine[] = [];
  const bySig = new Map<string, { statement: Statement; note?: string }>();
  for (const l of b.lines) {
    if (!("statement" in l)) {
      out.push(l);
      continue;
    }
    const sig = `${l.statement.effect}|${l.statement.conditions.map(renderCondition).join(" AND ")}`;
    const cur = bySig.get(sig);
    if (!cur) {
      const copy = { statement: { ...l.statement, permissions: [...l.statement.permissions] }, note: l.note };
      bySig.set(sig, copy);
      out.push(copy);
    } else {
      l.statement.permissions.forEach((p) => !cur.statement.permissions.includes(p) && cur.statement.permissions.push(p));
      const notes = new Set([...(cur.note ?? "").split(", "), ...(l.note ?? "").split(", ")].filter(Boolean));
      cur.note = [...notes].join(", ") || undefined;
    }
  }
  return { ...b, lines: out };
}

export const policyStatements = (d: PolicyDraft, ix: CatalogIndex, apps: AppIndex | null): Statement[] =>
  policyBlocks(d, ix, apps).flatMap((b) => b.lines.flatMap((l) => ("statement" in l ? [l.statement] : [])));

export function renderPolicy(d: PolicyDraft, ix: CatalogIndex, docsDate: string | null, apps: AppIndex | null): string {
  const blocks = policyBlocks(d, ix, apps);
  if (!blocks.some((b) => b.lines.some((l) => "statement" in l))) return "";
  const lines: string[] = [];
  if (d.comments) {
    if (d.name.trim()) lines.push(`// ${d.name.trim()}`);
    lines.push(`// Built with Architect Assistant against the IAM policy reference${docsDate ? ` (updated ${docsDate})` : ""}`);
  }
  for (const b of blocks) {
    if (d.comments) {
      if (lines.length) lines.push("");
      lines.push(`// ${b.title}`);
    }
    for (const l of b.lines) lines.push("statement" in l ? `${renderStatement(l.statement)}${d.comments && l.note ? `  // ${l.note}` : ""}` : `// ${l.comment}`);
  }
  return lines.join("\n") + "\n";
}

export type BoundaryLine = CondValue & { origin: string };
export function boundaryLines(b: BoundaryDraft, ix: CatalogIndex): BoundaryLine[] {
  const out: BoundaryLine[] = [];
  if (b.apps.ids.length) out.push({ ...clean({ key: "shared:app-id", op: b.apps.op, values: b.apps.ids }), origin: "Apps" });
  for (const d of filled(b.dims)) for (const s of d.services) if (ix.conditionKeys.has(`${s}:${d.key}`)) out.push({ ...clean({ key: `${s}:${d.key}`, op: d.op, values: d.values }), origin: "Dimensional data" });
  for (const c of filled(b.conds)) out.push({ ...clean(c), origin: "Condition" });
  return out;
}
export const renderBoundary = (b: BoundaryDraft, ix: CatalogIndex) => {
  const lines = boundaryLines(b, ix);
  return lines.length ? lines.map((c) => `${renderCondition(c)};`).join("\n") + "\n" : "";
};

// --- Parsing -------------------------------------------------------------------------------------------------------
export type Severity = "error" | "warning" | "info";
export type Diagnostic = { from: number; to: number; severity: Severity; message: string };
type Seg = { from: number; to: number };
export type ParsedCondition = CondValue & Seg & { list: boolean; valuesAt: Seg };
export type ParsedStatement = Seg & {
  effect: Effect;
  permissions: (Seg & { id: string })[];
  conditions: ParsedCondition[];
  terminated: boolean;
  ok: boolean;
};

/** `//` comments blanked out (same length, so offsets stay valid); quotes left open at a line end are reported. */
function maskComments(text: string): { masked: string; open: number[] } {
  let out = "";
  let q: string | null = null;
  let qAt = 0;
  const open: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === "\\" && i + 1 < text.length && text[i + 1] !== "\n") {
        out += ch + text[++i];
        continue;
      }
      if (ch === q) q = null;
      else if (ch === "\n") {
        open.push(qAt);
        q = null;
      }
      out += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      q = ch;
      qAt = i;
    } else if (ch === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i);
      const end = nl < 0 ? text.length : nl;
      out += " ".repeat(end - i);
      i = end - 1;
      continue;
    }
    out += ch;
  }
  if (q) open.push(qAt);
  return { masked: out, open };
}

/** Positions in [from, to) outside quotes and parentheses where `re` (sticky, case-insensitive) matches as a whole word or symbol. */
function topLevel(s: string, from: number, to: number, re: RegExp): Seg[] {
  const hits: Seg[] = [];
  let q: string | null = null;
  let depth = 0;
  for (let i = from; i < to; i++) {
    const ch = s[i];
    if (q) {
      if (ch === "\\" && s[i + 1] !== "\n") i++;
      else if (ch === q || ch === "\n") q = null; // a quote left open ends at the line break (reported by maskComments)
      continue;
    }
    if (ch === '"' || ch === "'") q = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      re.lastIndex = i;
      const m = re.exec(s);
      if (m && i + m[0].length <= to && (/\w/.test(m[0][0]) ? !/\w/.test(s[i - 1] ?? " ") && !/\w/.test(s[i + m[0].length] ?? " ") : true)) {
        hits.push({ from: i, to: i + m[0].length });
        i += m[0].length - 1;
      }
    }
  }
  return hits;
}
const splitAt = (from: number, to: number, cuts: Seg[]): Seg[] => {
  const out: Seg[] = [];
  let start = from;
  for (const c of cuts) {
    out.push({ from: start, to: c.from });
    start = c.to;
  }
  out.push({ from: start, to });
  return out;
};
const trimSeg = (s: string, g: Seg): Seg => {
  let { from, to } = g;
  while (from < to && /\s/.test(s[from])) from++;
  while (to > from && /\s/.test(s[to - 1])) to--;
  return { from, to };
};

const OP_CANON: Record<string, string> = { "=": "=", "!=": "!=", "<": "<", ">": ">", IN: "IN", "NOT IN": "NOT IN", STARTSWITH: "startsWith", "NOT STARTSWITH": "NOT startsWith", MATCH: "MATCH" };
const COND_RE = /^([A-Za-z][\w.:-]*)\s*(NOT\s+IN\b|NOT\s+startsWith\b|IN\b|startsWith\b|MATCH\b|!=|=|<|>)\s*/i;

function parseValue(s: string, g: Seg, diags: Diagnostic[]): string | null {
  const raw = s.slice(g.from, g.to);
  const m = /^"((?:[^"\\]|\\.)*)"$/.exec(raw) ?? /^'((?:[^'\\]|\\.)*)'$/.exec(raw);
  if (m) return m[1].replace(/\\(.)/g, "$1");
  diags.push({
    ...g,
    severity: "error",
    message: /[“”‘’]/.test(raw) ? 'Use straight quotes (") around values, not typographic quotes.' : raw ? 'Put the value in double quotes, e.g. "value".' : "Add a value.",
  });
  return null;
}

/** Parses one condition `key op value`; false when it cannot be read. */
function parseCondition(s: string, g: Seg, diags: Diagnostic[]): ParsedCondition | null {
  const raw = s.slice(g.from, g.to);
  const m = COND_RE.exec(raw);
  if (!m) {
    diags.push({ ...g, severity: "error", message: "Write the condition as <service:attribute> <operator> \"value\" (operators: =, !=, IN, NOT IN, startsWith, NOT startsWith, MATCH, <, >)." });
    return null;
  }
  const op = OP_CANON[m[2].toUpperCase().replace(/\s+/g, " ")] ?? m[2];
  const vs = trimSeg(s, { from: g.from + m[0].length, to: g.to });
  const list = s[vs.from] === "(";
  const values: string[] = [];
  let ok = true;
  if (list) {
    if (s[vs.to - 1] !== ")") {
      diags.push({ ...vs, severity: "error", message: "Close the list of values with )." });
      return null;
    }
    const items = splitAt(vs.from + 1, vs.to - 1, topLevel(s, vs.from + 1, vs.to - 1, /,/y)).map((x) => trimSeg(s, x));
    if (items.length === 1 && items[0].from === items[0].to) {
      diags.push({ ...vs, severity: "error", message: "The list is empty." });
      ok = false;
    } else
      for (const it of items) {
        const v = parseValue(s, it, diags);
        if (v === null) ok = false;
        else values.push(v);
      }
  } else {
    const v = parseValue(s, vs, diags);
    if (v === null) ok = false;
    else values.push(v);
  }
  if (!ok) return null;
  if (isListOperator(op) && !list) diags.push({ ...vs, severity: "error", message: `${op} takes a list in parentheses, e.g. ("a", "b").` });
  if (!isListOperator(op) && list) diags.push({ ...vs, severity: "error", message: `${op} takes one value; use IN (or MATCH) for a list.` });
  return { key: m[1], op, values, list, from: g.from, to: g.to, valuesAt: vs };
}

/** Splits policy text into statements and parses each one. Syntax problems are added to `diags`. */
export function parsePolicy(text: string, diags: Diagnostic[] = []): ParsedStatement[] {
  const { masked, open } = maskComments(text);
  open.forEach((at) => diags.push({ from: at, to: Math.min(text.length, at + 1), severity: "error", message: "This quote is never closed." }));
  const out: ParsedStatement[] = [];
  const semis = topLevel(masked, 0, masked.length, /;/y);
  const segs = splitAt(0, masked.length, semis);
  segs.forEach((seg, i) => {
    const g = trimSeg(masked, seg);
    if (g.from === g.to) return;
    const terminated = i < semis.length;
    const head = /^(ALLOW|DENY)\b\s*/i.exec(masked.slice(g.from, g.to));
    if (!head) {
      diags.push({ ...g, severity: "error", message: "A statement starts with ALLOW or DENY, e.g. ALLOW storage:logs:read;" });
      return;
    }
    const st: ParsedStatement = { ...g, effect: head[1].toUpperCase() as Effect, permissions: [], conditions: [], terminated, ok: true };
    const bodyFrom = g.from + head[0].length;
    const where = topLevel(masked, bodyFrom, g.to, /WHERE/iy)[0];
    const permEnd = where ? where.from : g.to;
    for (const p of splitAt(bodyFrom, permEnd, topLevel(masked, bodyFrom, permEnd, /,/y)).map((x) => trimSeg(masked, x))) {
      const id = masked.slice(p.from, p.to);
      if (!id) {
        diags.push({ from: p.from, to: Math.max(p.to, p.from + 1), severity: "error", message: "Missing permission." });
        st.ok = false;
      } else st.permissions.push({ ...p, id });
    }
    if (where) {
      const condFrom = where.to;
      const parts = splitAt(condFrom, g.to, topLevel(masked, condFrom, g.to, /AND/iy)).map((x) => trimSeg(masked, x));
      for (const c of parts) {
        if (c.from === c.to) {
          diags.push({ from: where.from, to: where.to, severity: "error", message: "WHERE (or AND) is not followed by a condition." });
          st.ok = false;
          continue;
        }
        const orAt = topLevel(masked, c.from, c.to, /OR/iy)[0];
        if (orAt) {
          diags.push({ ...orAt, severity: "error", message: "OR is not supported. Write a second statement instead; statements are combined with OR." });
          st.ok = false;
          continue;
        }
        const pc = parseCondition(masked, c, diags);
        if (pc) st.conditions.push(pc);
        else st.ok = false;
      }
    }
    out.push(st);
  });
  return out;
}

// --- Validation ----------------------------------------------------------------------------------------------------
const PERMISSION_FORMAT = /^[a-z0-9-]+:[a-z0-9.-]+:[a-z0-9.-]+$/i;
const TZ_RE = /(Z|[+-]\d{2}:\d{2})$/;
const BIND_RE = /\$\{bindParam:[^}]+\}/;

/** Checks a condition's values against what the docs say about that key. */
function valueChecks(c: ParsedCondition, diags: Diagnostic[]) {
  const at = c.valuesAt;
  if (c.key === "storage:query-consumption" && c.values.some((v) => v !== "INCLUDED" && v !== "ON_DEMAND"))
    diags.push({ ...at, severity: "warning", message: 'storage:query-consumption must be "INCLUDED" or "ON_DEMAND"; for any other value the statement is ignored.' });
  const days = GLOBAL_HINTS["global:week-day"].values ?? [];
  if (c.key === "global:week-day" && c.values.some((v) => !days.includes(v))) diags.push({ ...at, severity: "warning", message: "Use a day name: Monday … Sunday (GMT)." });
  if (["global:date", "global:date-time", "global:time-of-day"].includes(c.key) && c.values.some((v) => !TZ_RE.test(v)))
    diags.push({ ...at, severity: "warning", message: `${c.key} needs a time zone (Z for UTC, or +hh:mm), e.g. ${c.key === "global:date" ? '"2026-05-03Z"' : c.key === "global:time-of-day" ? '"09:00+01:00"' : '"2026-05-03T05:00:00+01:00"'}.` });
  if (c.values.some((v) => BIND_RE.test(v)))
    diags.push({ ...at, severity: "info", message: "Binding parameter: its value is set when the policy is bound to a group, which only the Account Management API supports (see Policy templating)." });
  if (c.op === "MATCH" && c.values.some((v) => /\*/.test(v) && !/(^\*|[-_./]\*|\*$|\*[-_./])/.test(v)))
    diags.push({ ...at, severity: "info", message: "MATCH performs best with wildcards next to a word separator (-, _, . or /), e.g. \"db-tech-*\"." });
}

export type PolicyCheck = { statements: ParsedStatement[]; diagnostics: Diagnostic[] };

export function validatePolicy(text: string, ix: CatalogIndex, sourceLabel: string): PolicyCheck {
  const diags: Diagnostic[] = [];
  const statements = parsePolicy(text, diags);
  const tablePerms: (Seg & { id: string })[] = [];
  let hasBuckets = false;
  let denyNoted = false;
  statements.forEach((st, i) => {
    if (i === MAX_STATEMENTS) diags.push({ from: st.from, to: st.to, severity: "error", message: `A policy can hold at most ${MAX_STATEMENTS} statements; split it into several policies or combine permissions that share conditions.` });
    if (!st.terminated) diags.push({ from: Math.max(st.from, st.to - 1), to: st.to, severity: "warning", message: "End the statement with a semicolon (;)." });
    const known = st.permissions.map((p) => {
      if (!PERMISSION_FORMAT.test(p.id)) {
        diags.push({ ...p, severity: "error", message: "A permission has the form service:resource:action, e.g. storage:logs:read." });
        return null;
      }
      const info = ix.permissions.get(p.id);
      if (!info) diags.push({ ...p, severity: "warning", message: `${p.id} is not in the IAM policy reference (${sourceLabel}). Check the spelling, or the docs if it is new.` });
      if (p.id === "storage:buckets:read") hasBuckets = true;
      if (grailTableOf(p.id)) tablePerms.push(p);
      return info ?? null;
    });
    for (const c of st.conditions) {
      if (c.key.startsWith("global:")) {
        const g = ix.globals.get(c.key);
        if (!g) diags.push({ from: c.from, to: c.from + c.key.length, severity: "warning", message: `${c.key} is not a documented global condition.` });
        else if (!globalOperators(g).includes(c.op))
          diags.push({ ...c, severity: g.operators.length ? "error" : "info", message: g.operators.length ? `${c.op} is not supported for ${c.key} (supported: ${g.operators.join(", ")}).` : `The docs list no operators for ${c.key}; their examples use =.` });
      } else if (!ix.conditionKeys.has(c.key)) {
        diags.push({ from: c.from, to: c.from + c.key.length, severity: "error", message: `${c.key} is not a condition of any permission in the IAM policy reference (${sourceLabel}).` });
      } else {
        st.permissions.forEach((p, k) => {
          const info = known[k];
          if (!info) return;
          const cond = conditionOf(info, c.key);
          if (!cond) diags.push({ from: c.from, to: c.from + c.key.length, severity: "error", message: `${p.id} does not support ${c.key}${info.conditions.length ? ` (supported: ${info.conditions.map((x) => x.key).join(", ")})` : " (it has no conditions)"}.` });
          else if (!cond.operators.includes(c.op)) diags.push({ ...c, severity: "error", message: `${c.op} is not supported for ${c.key} on ${p.id} (supported: ${sortOperators(cond.operators).join(", ")}).` });
        });
      }
      valueChecks(c, diags);
    }
    if (st.effect === "DENY") {
      const grail = st.permissions.filter((p) => p.id.startsWith("storage:") && p.id !== "storage:buckets:read" && grailTableOf(p.id));
      if (st.conditions.length && grail.length)
        diags.push({ from: st.from, to: st.from + 4, severity: "warning", message: `Conditional DENY is not supported on Grail table permissions (${grail.map((p) => p.id).join(", ")}): it runs as an unconditional DENY.` });
      else if (!st.conditions.length)
        diags.push({ from: st.from, to: st.from + 4, severity: "warning", message: "An unconditional DENY blocks the permission for everyone this policy is bound to, whatever else they are granted. Prefer ALLOW statements with conditions, or boundaries." });
      if (!denyNoted) diags.push({ from: st.from, to: st.from + 4, severity: "info", message: "Boundaries never apply to DENY statements." });
      denyNoted = true;
    }
  });
  if (tablePerms.length && !hasBuckets)
    diags.push({ ...tablePerms[0], severity: "info", message: "Grail table permissions also need storage:buckets:read for the buckets that hold the data." });
  return { statements, diagnostics: diags.sort((a, b) => a.from - b.from) };
}

export type BoundaryCheck = { conditions: ParsedCondition[]; diagnostics: Diagnostic[] };

export function validateBoundary(text: string, ix: CatalogIndex, sourceLabel: string): BoundaryCheck {
  const diags: Diagnostic[] = [];
  const conditions: ParsedCondition[] = [];
  const seen = new Map<string, number>();
  let offset = 0;
  for (const line of text.split("\n")) {
    const from = offset;
    offset += line.length + 1;
    const { masked, open } = maskComments(line);
    open.forEach((at) => diags.push({ from: from + at, to: from + at + 1, severity: "error", message: "This quote is never closed." }));
    if (masked.trim() !== line.trim()) diags.push({ from: from + masked.trimEnd().length, to: from + line.length, severity: "warning", message: "Comments are not documented for boundaries; remove them before saving the boundary." });
    const g = trimSeg(masked, { from: 0, to: masked.length });
    if (g.from === g.to) continue;
    const abs = (x: Seg): Seg => ({ from: from + x.from, to: from + x.to });
    if (/^(ALLOW|DENY)\b|^WHERE\b/i.test(masked.slice(g.from)))
      diags.push({ ...abs(g), severity: "error", message: "A boundary holds conditions only, one per line (no ALLOW, DENY or WHERE), e.g. storage:k8s.namespace.name = \"DEV\";" });
    const semis = topLevel(masked, g.from, g.to, /;/y);
    const parts = splitAt(g.from, g.to, semis).map((x) => trimSeg(masked, x)).filter((x) => x.from < x.to);
    if (!semis.length) diags.push({ from: from + g.to - 1, to: from + g.to, severity: "warning", message: "End the condition with a semicolon (;)." });
    if (parts.length > 1) diags.push({ ...abs(parts[1]), severity: "error", message: "Put each condition on its own line." });
    for (const p of parts.slice(0, 1)) {
      const and = topLevel(masked, p.from, p.to, /AND|OR/iy)[0];
      if (and) {
        diags.push({ ...abs(and), severity: "error", message: "Boundaries do not support AND or OR: put each condition on its own line (lines are applied separately)." });
        continue;
      }
      const local: Diagnostic[] = [];
      const c = parseCondition(masked, p, local);
      local.forEach((d) => diags.push({ ...d, ...abs(d) }));
      if (!c) continue;
      const pc: ParsedCondition = { ...c, ...abs(c), valuesAt: abs(c.valuesAt) };
      conditions.push(pc);
      if (conditions.length === MAX_BOUNDARY_CONDITIONS + 1)
        diags.push({ ...abs(p), severity: "error", message: `A boundary holds at most ${MAX_BOUNDARY_CONDITIONS} conditions; create another boundary and assign both.` });
      seen.set(pc.key, (seen.get(pc.key) ?? 0) + 1);
      if (seen.get(pc.key) === 2)
        diags.push({ from: pc.from, to: pc.from + pc.key.length, severity: "info", message: `${pc.key} is repeated: each policy statement it applies to is multiplied, one copy per ${pc.key} line (any of them grants access).` });
      if (pc.key.startsWith("global:")) {
        const gl = ix.globals.get(pc.key);
        if (!gl) diags.push({ from: pc.from, to: pc.from + pc.key.length, severity: "warning", message: `${pc.key} is not a documented global condition.` });
        else if (!globalOperators(gl).includes(pc.op)) diags.push({ ...pc, severity: "error", message: `${pc.op} is not supported for ${pc.key} (supported: ${globalOperators(gl).join(", ")}).` });
        else diags.push({ from: pc.from, to: pc.from + pc.key.length, severity: "info", message: "Global conditions apply to every permission of the policies this boundary is bound with." });
      } else {
        const info = ix.conditionKeys.get(pc.key);
        if (!info) diags.push({ from: pc.from, to: pc.from + pc.key.length, severity: "error", message: `${pc.key} is not a condition of any permission in the IAM policy reference (${sourceLabel}), so it would restrict nothing.` });
        else {
          const unsupported = info.permissions.filter((id) => !conditionOf(ix.permissions.get(id), pc.key)?.operators.includes(pc.op));
          if (unsupported.length === info.permissions.length) diags.push({ ...pc, severity: "error", message: `${pc.op} is not supported for ${pc.key} (supported: ${info.operators.join(", ")}).` });
          else if (unsupported.length) diags.push({ ...pc, severity: "warning", message: `${pc.op} is not supported for ${pc.key} on ${unsupported.join(", ")}.` });
        }
      }
      valueChecks(pc, diags);
    }
  }
  return { conditions, diagnostics: diags.sort((a, b) => a.from - b.from) };
}

// --- Boundaries applied to a policy ------------------------------------------------------------------------------
export type EffectiveRow = {
  permission: string;
  effect: Effect;
  text: string;
  narrowed: boolean;
  ownConditions: boolean;
  /** Structured form of `text` (used by the Permissions Test tab): one permission per ALLOW row, all of a DENY's. */
  permissions: string[];
  conditions: CondValue[];
};

/**
 * Effective statements of a policy bound with one boundary, per the boundary docs: statements are split into one per
 * permission; only boundary conditions the permission supports apply (global ones always do); repeated condition names
 * multiply the statement (one copy per value); boundary conditions are added to the statement's own conditions; DENY
 * statements are left as they are.
 */
export function applyBoundary(statements: ParsedStatement[], boundary: CondValue[], ix: CatalogIndex): EffectiveRow[] {
  const out: EffectiveRow[] = [];
  for (const st of statements.filter((s) => s.ok)) {
    const own: CondValue[] = st.conditions.map((c) => ({ key: c.key, op: c.op, values: c.values }));
    if (st.effect === "DENY") {
      const ids = st.permissions.map((p) => p.id);
      out.push({ permission: ids.join(", "), effect: "DENY", text: renderStatement({ effect: "DENY", permissions: ids, conditions: own }), narrowed: false, ownConditions: own.length > 0, permissions: ids, conditions: own });
      continue;
    }
    for (const p of st.permissions) {
      const info = ix.permissions.get(p.id);
      const applicable = boundary.filter((c) => c.key.startsWith("global:") || !!conditionOf(info, c.key));
      const byKey = new Map<string, CondValue[]>();
      applicable.forEach((c) => byKey.set(c.key, [...(byKey.get(c.key) ?? []), c]));
      let combos: CondValue[][] = [[]];
      for (const group of byKey.values()) combos = combos.flatMap((combo) => group.map((c) => [...combo, c]));
      for (const combo of combos) {
        const conditions = [...own, ...combo];
        out.push({ permission: p.id, effect: "ALLOW", text: renderStatement({ effect: "ALLOW", permissions: [p.id], conditions }), narrowed: combo.length > 0, ownConditions: own.length > 0, permissions: [p.id], conditions });
      }
    }
  }
  return out;
}

// --- Text -> draft -------------------------------------------------------------------------------------------------
export function draftFromPolicyText(text: string, base: PolicyDraft): { draft: PolicyDraft; loaded: number; skipped: string[] } {
  const diags: Diagnostic[] = [];
  const statements = parsePolicy(text, diags);
  const bad = new Set(diags.filter((d) => d.severity === "error").flatMap((d) => statements.filter((s) => d.from >= s.from && d.from <= s.to)));
  // Loaded text becomes apps (open only) plus individual permissions; the app levels and data step start empty.
  const draft: PolicyDraft = { ...base, allApps: false, appLevels: {}, appExclude: {}, dataEnabled: false, dataInclude: {}, dims: [], rows: [], globals: [], step: 3 };
  const skipped: string[] = [];
  let loaded = 0;
  const usable = statements.filter((st) => st.ok && !bad.has(st));
  // Global conditions on every statement go back to the Global conditions section (that is how the builder writes them).
  const sharedGlobals = usable.length
    ? usable[0].conditions.filter((c) => c.key.startsWith("global:") && usable.every((st) => st.conditions.some((x) => renderCondition(x) === renderCondition(c))))
    : [];
  const shared = new Set(sharedGlobals.map(renderCondition));
  draft.globals = sharedGlobals.map((c) => ({ id: uid(), key: c.key, op: c.op, values: c.values }));
  for (const st of statements) {
    if (!st.ok || bad.has(st)) {
      skipped.push(text.slice(st.from, st.to).trim());
      continue;
    }
    loaded++;
    const ids = st.permissions.map((p) => p.id);
    const conds = st.conditions.filter((c) => !shared.has(renderCondition(c))).map((c) => ({ id: uid(), key: c.key, op: c.op, values: c.values }));
    if (st.effect === "ALLOW" && ids.length === 1 && ids[0] === "app-engine:apps:run") {
      if (!conds.length) {
        draft.allApps = true;
        continue;
      }
      if (conds.length === 1 && conds[0].key === "shared:app-id" && (conds[0].op === "=" || conds[0].op === "IN")) {
        conds[0].values.forEach((v) => (draft.appLevels[v] ??= []));
        continue;
      }
    }
    for (const id of ids) draft.rows.push({ id: uid(), permission: id, effect: st.effect, conditions: conds.map((c) => ({ ...c, id: uid() })), scoped: false });
  }
  // Text that parsed but sits outside every statement (e.g. a stray word) is reported too.
  if (!statements.length && text.trim()) skipped.push(text.trim());
  return { draft, loaded, skipped };
}

export function draftFromBoundaryText(text: string, ix: CatalogIndex, base: BoundaryDraft): { draft: BoundaryDraft; loaded: number; skipped: string[] } {
  const check = validateBoundary(text, ix, "");
  const errorsAt = check.diagnostics.filter((d) => d.severity === "error");
  const draft: BoundaryDraft = { ...base, apps: { op: "IN", ids: [] }, dims: [], conds: [] };
  for (const c of check.conditions) {
    if (errorsAt.some((d) => d.from >= c.from && d.from <= c.to)) continue;
    if (c.key === "shared:app-id" && !draft.apps.ids.length) draft.apps = { op: c.op, ids: c.values };
    else draft.conds.push({ id: uid(), key: c.key, op: c.op, values: c.values });
  }
  const loaded = draft.conds.length + (draft.apps.ids.length ? 1 : 0);
  const skipped = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//") && !check.conditions.some((c) => l.startsWith(c.key) && !errorsAt.some((d) => d.from >= c.from && d.from <= c.to)));
  return { draft, loaded, skipped };
}

// --- Templates (statements copied from the docs pages they cite) ---------------------------------------------------
export const POLICY_TEMPLATES: { id: string; label: string; doc: { title: string; url: string }; text: string }[] = [
  {
    id: "default-monitoring",
    label: "Read all default monitoring data",
    doc: IAM_DOCS.grail,
    text: 'ALLOW storage:buckets:read WHERE storage:bucket-name MATCH ("default_*");\nALLOW storage:events:read, storage:logs:read, storage:metrics:read, storage:entities:read, storage:bizevents:read, storage:spans:read, storage:smartscape:read;\n',
  },
  {
    id: "all-data",
    label: "Read all data",
    doc: IAM_DOCS.grail,
    text: "ALLOW storage:buckets:read;\nALLOW storage:system:read, storage:events:read, storage:security.events:read, storage:logs:read, storage:metrics:read, storage:entities:read, storage:bizevents:read, storage:spans:read, storage:smartscape:read;\n",
  },
  { id: "system-data", label: "Read all system data", doc: IAM_DOCS.grail, text: 'ALLOW storage:buckets:read WHERE storage:bucket-name MATCH ("dt_*");\nALLOW storage:system:read;\n' },
  { id: "all-logs", label: "Access to all logs", doc: IAM_DOCS.grail, text: 'ALLOW storage:buckets:read WHERE storage:table-name = "logs";\nALLOW storage:logs:read;\n' },
  { id: "settings-reader", label: "Settings Reader", doc: IAM_DOCS.settings, text: "ALLOW settings:objects:read, settings:schemas:read;\n" },
  { id: "settings-writer", label: "Settings Writer", doc: IAM_DOCS.settings, text: "ALLOW settings:objects:read, settings:objects:write, settings:schemas:read;\n" },
];
export const BOUNDARY_TEMPLATES: { id: string; label: string; text: string }[] = [
  { id: "k8s-dev", label: "Kubernetes development namespaces", text: 'storage:k8s.namespace.name IN ("DEVELOPMENT", "HARDENING");\n' },
  { id: "k8s-mz", label: "Kubernetes management zones and namespaces", text: 'environment:management-zone startsWith "[Kubernetes]";\nstorage:k8s.namespace.name IN ("DEV", "PREPROD");\n' },
];
