// Classic metric selector -> DQL `timeseries`.
//
// Supported: metric keys (builtin:/ext:/custom), :filter(and/or/not/eq/ne/in(entitySelector)/prefix/suffix/contains/
// existsKey/series), :splitBy, space aggregations (:avg :sum :min :max :count :median :percentile(n) :auto :value),
// :fold, :last, :sort(value(...)|dimension(...)), :limit, :names, :rate, :default, :timeshift, :toUnit (common units),
// and arithmetic between selectors and numbers (+ - * /, parentheses, outer transformations on a group).
// Everything else is kept out of the DQL and reported as a note with lowered confidence.

import { Agg, MetricMapping, entityTypeOfDim, mapMetricKey } from "./metrics";
import type { Confidence } from "./types";

// ---------------------------------------------------------------------------------------------------------------------
// AST + parser
// ---------------------------------------------------------------------------------------------------------------------
export type Arg = { t: "str"; v: string } | { t: "num"; v: number } | { t: "id"; v: string } | { t: "call"; name: string; args: Arg[] };
export type Tx = { name: string; args: Arg[] };
export type MExpr =
  | { t: "sel"; key: string; tx: Tx[] }
  | { t: "num"; v: number }
  | { t: "bin"; op: "+" | "-" | "*" | "/"; l: MExpr; r: MExpr }
  | { t: "grp"; e: MExpr; tx: Tx[] };

const KEY_PREFIXES = new Set(["builtin", "ext", "calc", "func", "dsfm", "cloud"]);

export class SelectorParseError extends Error {}

class P {
  i = 0;
  constructor(readonly s: string) {}
  ws() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }
  peek() {
    this.ws();
    return this.s[this.i];
  }
  eat(c: string) {
    if (this.peek() !== c) throw new SelectorParseError(`Expected "${c}" at position ${this.i} of the metric selector.`);
    this.i++;
  }
  expr(): MExpr {
    let l = this.term();
    for (let c = this.peek(); c === "+" || c === "-"; c = this.peek()) {
      this.i++;
      l = { t: "bin", op: c, l, r: this.term() };
    }
    return l;
  }
  term(): MExpr {
    let l = this.factor();
    for (let c = this.peek(); c === "*" || c === "/"; c = this.peek()) {
      this.i++;
      l = { t: "bin", op: c, l, r: this.factor() };
    }
    return l;
  }
  factor(): MExpr {
    const c = this.peek();
    if (c === "(") {
      this.i++;
      const e = this.expr();
      this.eat(")");
      const tx = this.transforms();
      return tx.length ? { t: "grp", e, tx } : e;
    }
    if (c !== undefined && /[0-9]/.test(c)) {
      const m = /^[0-9]+(\.[0-9]+)?/.exec(this.s.slice(this.i))!;
      this.i += m[0].length;
      return { t: "num", v: Number(m[0]) };
    }
    if (c === "-") {
      this.i++;
      const f = this.factor();
      return { t: "bin", op: "*", l: { t: "num", v: -1 }, r: f };
    }
    const key = this.metricKey();
    return { t: "sel", key, tx: this.transforms() };
  }
  metricKey(): string {
    this.ws();
    const seg = () => {
      const start = this.i;
      while (this.i < this.s.length) {
        const ch = this.s[this.i];
        if (/[A-Za-z0-9_.]/.test(ch)) this.i++;
        // '-' inside a key (log.my-metric) only between word characters, never around spaces (that is a minus)
        else if (ch === "-" && /[A-Za-z0-9_]/.test(this.s[this.i - 1] ?? "") && /[A-Za-z]/.test(this.s[this.i + 1] ?? "")) this.i++;
        else break;
      }
      return this.s.slice(start, this.i);
    };
    let key = seg();
    if (!key) throw new SelectorParseError(`Expected a metric key at position ${this.i}.`);
    if (this.s[this.i] === ":" && KEY_PREFIXES.has(key)) {
      this.i++;
      key = `${key}:${seg()}`;
    }
    return key;
  }
  transforms(): Tx[] {
    const out: Tx[] = [];
    while (this.peek() === ":") {
      this.i++;
      const m = /^[A-Za-z]+/.exec(this.s.slice(this.i));
      if (!m) throw new SelectorParseError(`Expected a transformation name at position ${this.i}.`);
      this.i += m[0].length;
      let args: Arg[] = [];
      if (this.s[this.i] === "(") {
        this.i++;
        args = this.args();
        this.eat(")");
      }
      out.push({ name: m[0], args });
    }
    return out;
  }
  args(): Arg[] {
    const out: Arg[] = [];
    if (this.peek() === ")") return out;
    for (;;) {
      out.push(this.arg());
      if (this.peek() === ",") {
        this.i++;
        continue;
      }
      return out;
    }
  }
  arg(): Arg {
    const c = this.peek();
    if (c === '"' || c === "'") {
      this.i++;
      let v = "";
      while (this.i < this.s.length && this.s[this.i] !== c) {
        if (this.s[this.i] === "\\" || this.s[this.i] === "~") {
          // classic selectors escape with ~ (and some exports with \)
          v += this.s[this.i + 1] ?? "";
          this.i += 2;
        } else v += this.s[this.i++];
      }
      this.i++;
      return { t: "str", v };
    }
    const m = /^-?[A-Za-z0-9_.+-]+/.exec(this.s.slice(this.i));
    if (!m) throw new SelectorParseError(`Unexpected "${c}" at position ${this.i}.`);
    this.i += m[0].length;
    if (this.peek() === "(") {
      this.i++;
      const args = this.args();
      this.eat(")");
      return { t: "call", name: m[0], args };
    }
    return /^-?[0-9]+(\.[0-9]+)?$/.test(m[0]) ? { t: "num", v: Number(m[0]) } : { t: "id", v: m[0] };
  }
}

/** Strips the data explorer prefix "resolution=Inf&(...)" and parses. */
export function parseSelector(raw: string): MExpr {
  const s = raw.trim().replace(/^resolution=[^&]*&/, "");
  const p = new P(s);
  const e = p.expr();
  p.ws();
  if (p.i < s.length) throw new SelectorParseError(`Unexpected "${s.slice(p.i, p.i + 20)}" at position ${p.i}.`);
  return e;
}

// ---------------------------------------------------------------------------------------------------------------------
// DQL generation
// ---------------------------------------------------------------------------------------------------------------------
export const fieldRef = (name: string) => (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `\`${name.replace(/`/g, "")}\``);
export const dqlStr = (v: string) => JSON.stringify(v);

/** Classic dimension keys whose Grail metric dimension has another name. */
const DIM_MAP: Record<string, { to: string; note: string }> = {
  "dt.entity.service_method": { to: "endpoint.name", note: "Key request dimension dt.entity.service_method maps to endpoint.name (an endpoint name, not an entity ID)." },
  "dt.entity.cloud_application": { to: "k8s.workload.name", note: "dt.entity.cloud_application maps to k8s.workload.name." },
  "dt.entity.cloud_application_namespace": { to: "k8s.namespace.name", note: "dt.entity.cloud_application_namespace maps to k8s.namespace.name." },
  "dt.entity.kubernetes_cluster": { to: "k8s.cluster.name", note: "dt.entity.kubernetes_cluster maps to k8s.cluster.name." },
};

export type Ctx = {
  notes: string[];
  confidence: Confidence;
  metricKeys: Set<string>;
  guessedKeys: Set<string>;
  /** Classic keys that have no Grail form at all (calc:, func:): the tile becomes a placeholder. */
  unsupported?: string[];
  /** Management zone of the dashboard / tile. */
  mz?: { id?: string; name?: string } | null;
};
const downgrade = (ctx: Ctx, to: Confidence, note?: string) => {
  if (note && !ctx.notes.includes(note)) ctx.notes.push(note);
  if (to === "manual" || (to === "approximate" && ctx.confidence === "exact")) ctx.confidence = to;
};
const mapDim = (ctx: Ctx, d: string) => {
  const m = DIM_MAP[d];
  if (m) {
    downgrade(ctx, "approximate", m.note);
    return m.to;
  }
  return d;
};

const argStr = (a: Arg | undefined): string | undefined => (a?.t === "str" || a?.t === "id" ? a.v : a?.t === "num" ? String(a.v) : undefined);

/** Classic :filter(...) condition -> DQL condition. Returns null for series() conditions (handled after the timeseries). */
function filterCond(ctx: Ctx, a: Arg, post: { cond: string }[]): string | null {
  if (a.t !== "call") {
    downgrade(ctx, "approximate", `Ignored a filter argument the translator does not understand (${argStr(a) ?? a.t}).`);
    return null;
  }
  const name = a.name.toLowerCase();
  const dim = () => fieldRef(mapDim(ctx, argStr(a.args[0]) ?? ""));
  const val = (i = 1) => dqlStr(argStr(a.args[i]) ?? "");
  const sub = () => a.args.map((x) => filterCond(ctx, x, post)).filter((x): x is string => !!x);
  switch (name) {
    case "and": {
      const p = sub();
      return p.length ? (p.length === 1 ? p[0] : `(${p.join(" and ")})`) : null;
    }
    case "or": {
      const p = sub();
      return p.length ? (p.length === 1 ? p[0] : `(${p.join(" or ")})`) : null;
    }
    case "not": {
      const p = sub();
      return p.length ? `not(${p[0]})` : null;
    }
    case "eq":
      return `${dim()} == ${val()}`;
    case "ne":
      return `${dim()} != ${val()}`;
    case "prefix":
      return `startsWith(${dim()}, ${val()})`;
    case "suffix":
      return `endsWith(${dim()}, ${val()})`;
    case "contains":
      return `contains(${dim()}, ${val()})`;
    case "existskey":
      return `isNotNull(${dim()})`;
    case "in": {
      const rest = a.args.slice(1);
      if (rest.length === 1 && rest[0].t === "call" && rest[0].name.toLowerCase() === "entityselector") {
        return `in(${dim()}, classicEntitySelector(${dqlStr(argStr(rest[0].args[0]) ?? "")}))`;
      }
      return `in(${dim()}, array(${rest.map((r) => dqlStr(argStr(r) ?? "")).join(", ")}))`;
    }
    case "series": {
      // series(avg, gt(10)) filters whole series by their aggregate: applied after the timeseries command.
      const agg = argStr(a.args[0]) ?? "avg";
      const cmp = a.args[1];
      if (cmp?.t === "call") {
        const ops: Record<string, string> = { gt: ">", lt: "<", ge: ">=", le: "<=", eq: "==", ne: "!=" };
        const op = ops[cmp.name.toLowerCase()];
        const n = argStr(cmp.args[0]);
        if (op && n !== undefined) {
          post.push({ cond: `${arrayFn(agg)}(@SERIES@) ${op} ${n}` });
          return null;
        }
      }
      downgrade(ctx, "approximate", "Could not translate a series() filter; it was dropped.");
      return null;
    }
    default:
      downgrade(ctx, "approximate", `Filter function ${a.name}() is not supported; it was dropped.`);
      return null;
  }
}

/** Time-fold function for an aggregation: total for counters, average otherwise. */
export function arrayFn(agg: string): string {
  switch (agg.toLowerCase()) {
    case "sum":
    case "count":
      return "arraySum";
    case "max":
      return "arrayMax";
    case "min":
      return "arrayMin";
    case "last":
      return "arrayLast";
    case "median":
      return "arrayMedian";
    default:
      return "arrayAvg";
  }
}

type Leaf = {
  classicKey: string;
  mapping: MetricMapping;
  filters: string[];
  postFilters: { cond: string }[];
  by: string[] | null;
  agg: Agg | null;
  percentile?: number;
  rate?: string;
  def?: string;
  shift?: string;
  unitFactor?: number;
};

type Post = {
  sort?: { kind: "value"; agg: string; dir: "asc" | "desc" } | { kind: "dim"; dim: string; dir: "asc" | "desc" };
  limit?: number;
  fold?: string;
  names?: boolean;
};

const UNIT_FACTORS: Record<string, number> = {
  "microsecond>millisecond": 1 / 1000,
  "microsecond>second": 1 / 1e6,
  "nanosecond>millisecond": 1 / 1e6,
  "millisecond>second": 1 / 1000,
  "byte>kilobyte": 1 / 1000,
  "byte>megabyte": 1 / 1e6,
  "byte>gigabyte": 1 / 1e9,
  "byte>kibibyte": 1 / 1024,
  "byte>mebibyte": 1 / 1048576,
  "byte>gibibyte": 1 / 1073741824,
};

const AGG_TX = new Set(["avg", "sum", "min", "max", "count", "median", "percentile", "auto", "value", "last"]);

/** Applies transformations to a leaf (metric-level) or to `post` (result-level). Returns transformations left over. */
function applyTx(ctx: Ctx, tx: Tx[], leaf: Leaf | null, post: Post, leaves: Leaf[]) {
  const forLeaves = (fn: (l: Leaf) => void) => (leaf ? fn(leaf) : leaves.forEach(fn));
  for (const t of tx) {
    const n = t.name.toLowerCase();
    if (n === "filter") {
      forLeaves((l) => {
        for (const a of t.args) {
          const c = filterCond(ctx, a, l.postFilters);
          if (c) l.filters.push(c);
        }
      });
    } else if (n === "splitby") {
      const dims = t.args.map((a) => mapDim(ctx, argStr(a) ?? "")).filter(Boolean);
      forLeaves((l) => (l.by = dims));
    } else if (AGG_TX.has(n)) {
      forLeaves((l) => {
        if (n === "auto" || n === "value") l.agg = l.agg ?? null;
        else if (n === "median") {
          l.agg = "percentile";
          l.percentile = 50;
        } else if (n === "percentile") {
          l.agg = "percentile";
          l.percentile = Number(argStr(t.args[0]) ?? 50);
        } else if (n === "last") {
          post.fold = post.fold ?? "last";
        } else l.agg = n as Agg;
      });
    } else if (n === "fold") {
      post.fold = argStr(t.args[0]) ?? "auto";
    } else if (n === "sort") {
      const a = t.args[0];
      if (a?.t === "call" && a.name.toLowerCase() === "value") {
        post.sort = { kind: "value", agg: argStr(a.args[0]) ?? "avg", dir: /asc/i.test(argStr(a.args[1]) ?? "") ? "asc" : "desc" };
      } else if (a?.t === "call" && a.name.toLowerCase() === "dimension") {
        post.sort = { kind: "dim", dim: mapDim(ctx, argStr(a.args[0]) ?? ""), dir: /desc/i.test(argStr(a.args[1]) ?? "") ? "desc" : "asc" };
      }
    } else if (n === "limit") {
      const v = Number(argStr(t.args[0]));
      if (isFinite(v)) post.limit = post.limit === undefined ? v : Math.min(post.limit, v);
    } else if (n === "names") {
      post.names = true;
    } else if (n === "rate") {
      forLeaves((l) => (l.rate = argStr(t.args[0]) ?? "1m"));
    } else if (n === "default") {
      forLeaves((l) => (l.def = argStr(t.args[0]) ?? "0"));
    } else if (n === "timeshift") {
      forLeaves((l) => (l.shift = argStr(t.args[0])));
    } else if (n === "tounit") {
      const k = `${(argStr(t.args[0]) ?? "").toLowerCase()}>${(argStr(t.args[1]) ?? "").toLowerCase()}`;
      const f = UNIT_FACTORS[k];
      if (f) forLeaves((l) => (l.unitFactor = (l.unitFactor ?? 1) * f));
      else downgrade(ctx, "approximate", `toUnit(${argStr(t.args[0])}, ${argStr(t.args[1])}) was dropped; set the unit in the tile's visualization settings instead.`);
    } else if (n === "parents") {
      downgrade(ctx, "approximate", ":parents was dropped; add the parent entity with entityAttr() or a lookup if you need it.");
    } else if (n === "setunit") {
      downgrade(ctx, "exact", "setUnit was dropped; set the unit in the tile's visualization settings.");
    } else if (n === "splitby" || n === "auto") {
      // handled above
    } else {
      downgrade(ctx, "approximate", `Transformation :${t.name} has no DQL equivalent here and was dropped.`);
    }
  }
}

function collectLeaves(ctx: Ctx, e: MExpr, post: Post, out: Leaf[]): void {
  if (e.t === "sel") {
    const { mapping, guessed, unsupported } = mapMetricKey(e.key);
    if (unsupported) {
      downgrade(ctx, "manual", unsupported);
      (ctx.unsupported ??= []).push(e.key);
    }
    if (guessed && !unsupported) {
      ctx.guessedKeys.add(e.key);
      downgrade(ctx, "approximate", `${e.key} is not in the known mapping table; it was mapped to ${mapping.key}. Check that the key exists (see the metric check below).`);
    }
    if (mapping.note) downgrade(ctx, "approximate", mapping.note);
    const leaf: Leaf = { classicKey: e.key, mapping, filters: [], postFilters: [], by: null, agg: null };
    applyTx(ctx, e.tx, leaf, post, []);
    out.push(leaf);
  } else if (e.t === "bin") {
    collectLeaves(ctx, e.l, post, out);
    collectLeaves(ctx, e.r, post, out);
  } else if (e.t === "grp") {
    const inner: Leaf[] = [];
    collectLeaves(ctx, e.e, post, inner);
    applyTx(ctx, e.tx, null, post, inner);
    out.push(...inner);
  }
}

const aliasOf = (key: string) => {
  const parts = key.split(".");
  const tail = (key.startsWith("dt.") ? parts.slice(2) : parts.slice(-2)).join("_") || parts[parts.length - 1];
  const a = tail.replace(/[^A-Za-z0-9_]/g, "_").replace(/^([0-9])/, "m$1");
  return a || "value";
};

const aggCall = (key: string, agg: Agg, l: Leaf, extraFilter?: string) => {
  const params: string[] = [];
  if (l.rate) params.push(`rate: ${l.rate}`);
  if (l.def !== undefined) params.push(`default: ${l.def}`);
  if (extraFilter) params.push(`filter: ${extraFilter}`);
  const head = agg === "percentile" ? `percentile(${key}, ${l.percentile ?? 50}` : `${agg}(${key}`;
  return `${head}${params.length ? `, ${params.join(", ")}` : ""})`;
};

export type SelectorDql = {
  dql: string;
  /** Name of the main series / value field (for visualization settings). */
  valueField: string;
  /** Whether the result is time series (true) or folded to one value per row (false). */
  timeseries: boolean;
  /** Entity dimensions the result is split by. */
  entityDims: string[];
  splitDims: string[];
};

export type FoldMode = "none" | "perRow" | "single";

/**
 * Builds DQL for a parsed selector.
 * fold: "none" keeps time series (line/area/bar charts), "perRow" folds each series to one value (table, top list, pie,
 * honeycomb), "single" folds and aggregates everything to one value (single value tiles).
 */
export function selectorToDql(ctx: Ctx, e: MExpr, fold: FoldMode, valueName?: string): SelectorDql {
  const post: Post = {};
  const leaves: Leaf[] = [];
  collectLeaves(ctx, e, post, leaves);
  if (post.fold && fold === "none") fold = "perRow";

  // Common split: classic splitBy must match for arithmetic; use the union and note when they differ.
  const bys = leaves.map((l) => l.by);
  const anySplit = bys.some((b) => b && b.length);
  const union = [...new Set(bys.flatMap((b) => b ?? []))];
  if (anySplit && new Set(bys.map((b) => JSON.stringify(b ?? []))).size > 1) {
    downgrade(ctx, "approximate", "The operands of the expression are split by different dimensions; the DQL splits all of them by the union of those dimensions.");
  }
  if (leaves.length === 1 && leaves[0].by === null && !leaves[0].mapping.derived) {
    downgrade(ctx, "exact", "Without :splitBy a classic selector returns one series per dimension combination; the DQL aggregates them into one series. Add by:{...} if you need the split.");
  }
  const by = union;

  // Management zone: filter on the metric's main entity (or the split entity).
  if (ctx.mz && (ctx.mz.name || ctx.mz.id)) {
    const mzSel = ctx.mz.name ? `mzName(${dqlStr(ctx.mz.name)})` : `mzId(${ctx.mz.id})`;
    for (const l of leaves) {
      const ent = (l.by ?? []).find((d) => d.startsWith("dt.entity.")) ?? l.mapping.entity;
      const type = ent ? entityTypeOfDim(ent) : null;
      if (ent && type) l.filters.push(`in(${ent}, classicEntitySelector(${dqlStr(`type(${type}),${mzSel}`)}))`);
      else downgrade(ctx, "approximate", `The management zone filter (${ctx.mz.name ?? ctx.mz.id}) could not be applied to ${l.classicKey}: no entity dimension. Use a segment instead.`);
    }
    downgrade(ctx, "exact", `Management zone "${ctx.mz.name ?? ctx.mz.id}" is applied with classicEntitySelector(mzName(...)); consider replacing it with a segment.`);
  }

  // Field names per leaf (derived metrics expand to several aggregations).
  const used = new Set<string>();
  const uniq = (a: string) => {
    let n = a;
    for (let i = 2; used.has(n); i++) n = `${a}_${i}`;
    used.add(n);
    return n;
  };
  const sameFilters = new Set(leaves.map((l) => JSON.stringify(l.filters))).size <= 1;
  const sharedFilter = sameFilters && leaves[0]?.filters.length ? leaves[0].filters.join(" and ") : undefined;
  const shifts = [...new Set(leaves.map((l) => l.shift).filter(Boolean))];
  if (shifts.length > 1) downgrade(ctx, "approximate", "Operands use different :timeshift values; only the first one is applied.");

  const aggs: string[] = [];
  const leafExpr = new Map<Leaf, string>();
  const tempFields: string[] = [];
  for (const l of leaves) {
    const own = !sameFilters && l.filters.length ? l.filters.join(" and ") : undefined;
    if (l.mapping.derived) {
      let expr = l.mapping.derived.expr;
      for (const [name, s] of Object.entries(l.mapping.derived.series)) {
        const f = uniq(name);
        tempFields.push(f);
        ctx.metricKeys.add(s.key);
        aggs.push(`${f} = ${aggCall(s.key, s.agg, l, own)}`);
        expr = expr.replace(new RegExp(`\\b${name}\\[\\]`, "g"), `${f}[]`);
      }
      leafExpr.set(l, `(${expr})`);
    } else {
      const f = uniq(aliasOf(l.mapping.key));
      ctx.metricKeys.add(l.mapping.key);
      aggs.push(`${f} = ${aggCall(l.mapping.key, l.agg ?? l.mapping.agg, l, own)}`);
      leafExpr.set(l, l.unitFactor ? `(${f}[] * ${l.unitFactor})` : `${f}[]`);
      if (l.unitFactor) tempFields.push(f);
    }
  }

  // Result field: the single leaf's own field, or a computed expression.
  let valueField: string;
  const extra: string[] = [];
  const single = leaves.length === 1 && e.t !== "bin" && !(e.t === "grp" && e.e.t === "bin");
  if (single && !leaves[0].mapping.derived && !leaves[0].unitFactor) {
    // The single metric's own field (the tile title carries any custom name).
    valueField = aggs[0].split(" = ")[0];
  } else {
    valueField = uniq(valueName && /^[A-Za-z_][A-Za-z0-9_]*$/.test(valueName) ? valueName : single ? (leaves[0].mapping.derived ? "error_rate" : aliasOf(leaves[0].mapping.key)) : "value");
    // Leaves were collected left to right; render the expression consuming them in the same order, so two operands with
    // the same key but different transformations map one-to-one.
    const queue = [...leaves];
    const renderOrdered = (x: MExpr): string => {
      if (x.t === "num") return String(x.v);
      if (x.t === "sel") {
        const idx = queue.findIndex((l) => l.classicKey === x.key);
        const l = queue.splice(idx, 1)[0];
        return leafExpr.get(l) ?? "0";
      }
      if (x.t === "grp") return `(${renderOrdered(x.e)})`;
      return `${renderOrdered(x.l)} ${x.op} ${renderOrdered(x.r)}`;
    };
    const exprText = renderOrdered(e.t === "grp" ? e.e : e);
    extra.push(`| fieldsAdd ${valueField} = ${exprText}`);
    const drop = [...new Set([...tempFields, ...aggs.map((a) => a.split(" = ")[0])])].filter((f) => f !== valueField);
    if (drop.length) extra.push(`| fieldsRemove ${drop.join(", ")}`);
  }

  // timeseries command
  const params: string[] = [];
  if (by.length) params.push(`by: {${by.map(fieldRef).join(", ")}}`);
  if (sharedFilter) params.push(`filter: ${sharedFilter}`);
  if (shifts[0]) params.push(`shift: ${shifts[0]}`);
  const head = aggs.length === 1 ? `timeseries ${aggs[0]}` : `timeseries {\n    ${aggs.join(",\n    ")}\n  }`;
  const lines = [`${head}${params.length ? `, ${params.join(", ")}` : ""}`, ...extra];

  for (const l of leaves) for (const p of l.postFilters) lines.push(`| filter ${p.cond.replace("@SERIES@", valueField)}`);

  const entityDims = by.filter((d) => d.startsWith("dt.entity."));
  // Classic UIs always show entity names; Gen3 shows IDs unless we add them.
  if (entityDims.length) lines.push(`| fieldsAdd ${entityDims.map((d) => `entityName(${d})`).join(", ")}`);

  // Folding over time: counters of a single metric add up; ratios, gauges and expressions average.
  const foldAgg = post.fold && post.fold !== "auto" ? post.fold : single && !leaves[0]?.mapping.derived ? (leaves[0]?.agg ?? leaves[0]?.mapping.agg ?? "avg") : "avg";
  const fn = arrayFn(foldAgg === "percentile" ? "avg" : foldAgg);
  let timeseries = true;
  if (fold !== "none") {
    timeseries = false;
    lines.push(`| fieldsAdd ${valueField} = ${fn}(${valueField})`);
  }
  if (post.sort?.kind === "value") lines.push(`| sort ${fold !== "none" ? valueField : `${arrayFn(post.sort.agg)}(${valueField})`} ${post.sort.dir}`);
  else if (post.sort?.kind === "dim") lines.push(`| sort ${fieldRef(post.sort.dim)} ${post.sort.dir}`);
  if (post.limit !== undefined && fold !== "single") lines.push(`| limit ${post.limit}`);

  if (fold === "single") {
    const total = /sum|count/.test(foldAgg) ? "sum" : foldAgg === "max" ? "max" : foldAgg === "min" ? "min" : "avg";
    lines.push(by.length ? `| summarize ${valueField} = ${total}(${valueField})` : `| fields ${valueField}`);
  } else if (fold === "perRow") {
    const keep = [...entityDims.map((d) => `${d}.name`), ...by, valueField];
    lines.push(`| fields ${[...new Set(keep)].map(fieldRef).join(", ")}`);
  }

  return { dql: lines.join("\n"), valueField, timeseries, entityDims, splitDims: by };
}

/** Convenience: selector text -> DQL (throws SelectorParseError). */
export function translateSelector(ctx: Ctx, selector: string, fold: FoldMode, valueName?: string): SelectorDql {
  return selectorToDql(ctx, parseSelector(selector), fold, valueName);
}
