// Classic USQL (user session query language, DTAQL tiles) -> DQL on new RUM data (user.sessions / user.events).
//
// Supported: SELECT list with COUNT(*), COUNT(DISTINCT x), AVG/SUM/MIN/MAX/MEDIAN/PERCENTILE, TOP(x, n), DATETIME(...)
// buckets and AS aliases; FROM usersession | useraction; WHERE with = != <> < > <= >=, AND/OR/NOT, IN (...), IS [NOT]
// NULL, LIKE, STARTSWITH; GROUP BY; ORDER BY; LIMIT. FUNNEL and conversions are reported as manual.
// Field names are mapped to the new RUM schema (verified on a demo tenant); unknown fields are kept and flagged.

import type { Confidence } from "./types";
import { dqlStr, fieldRef } from "./metricSelector";

type Tok = { t: "id" | "str" | "num" | "op" | "punc" | "kw"; v: string };
const KW = new Set(["SELECT", "FROM", "WHERE", "GROUP", "BY", "ORDER", "LIMIT", "AS", "AND", "OR", "NOT", "IN", "IS", "NULL", "LIKE", "ASC", "DESC", "DISTINCT", "TRUE", "FALSE", "BETWEEN"]);

function lex(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      let v = "";
      i++;
      while (i < s.length && !(s[i] === c && s[i + 1] !== c)) {
        if (s[i] === c && s[i + 1] === c) {
          v += c;
          i += 2;
        } else v += s[i++];
      }
      i++;
      out.push({ t: "str", v });
      continue;
    }
    const num = /^[0-9]+(\.[0-9]+)?/.exec(s.slice(i));
    if (num) {
      out.push({ t: "num", v: num[0] });
      i += num[0].length;
      continue;
    }
    const op = /^(<>|!=|<=|>=|=|<|>|\*|\+|-|\/)/.exec(s.slice(i));
    if (op) {
      out.push({ t: "op", v: op[0] });
      i += op[0].length;
      continue;
    }
    if ("(),".includes(c)) {
      out.push({ t: "punc", v: c });
      i++;
      continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(s.slice(i));
    if (id) {
      const up = id[0].toUpperCase();
      out.push(KW.has(up) ? { t: "kw", v: up } : { t: "id", v: id[0] });
      i += id[0].length;
      continue;
    }
    throw new Error(`Unexpected character "${c}" in the USQL query.`);
  }
  return out;
}

type Node =
  | { k: "field"; name: string }
  | { k: "lit"; v: string; str: boolean }
  | { k: "star" }
  | { k: "call"; fn: string; args: Node[]; distinct?: boolean }
  | { k: "bin"; op: string; l: Node; r: Node }
  | { k: "not"; e: Node }
  | { k: "in"; e: Node; list: Node[]; neg: boolean }
  | { k: "isnull"; e: Node; neg: boolean };

class Parser {
  i = 0;
  constructor(readonly toks: Tok[]) {}
  peek(o = 0) {
    return this.toks[this.i + o];
  }
  isKw(v: string, o = 0) {
    const t = this.peek(o);
    return t?.t === "kw" && t.v === v;
  }
  eatKw(v: string) {
    if (!this.isKw(v)) throw new Error(`Expected ${v} in the USQL query.`);
    this.i++;
  }
  isP(v: string) {
    const t = this.peek();
    return t?.t === "punc" && t.v === v;
  }
  eatP(v: string) {
    if (!this.isP(v)) throw new Error(`Expected "${v}" in the USQL query.`);
    this.i++;
  }
  list<T>(f: () => T): T[] {
    const out = [f()];
    while (this.isP(",")) {
      this.i++;
      out.push(f());
    }
    return out;
  }
  // precedence: OR < AND < NOT < comparison < additive < multiplicative < primary
  or(): Node {
    let l = this.and();
    while (this.isKw("OR")) {
      this.i++;
      l = { k: "bin", op: "or", l, r: this.and() };
    }
    return l;
  }
  and(): Node {
    let l = this.not();
    while (this.isKw("AND")) {
      this.i++;
      l = { k: "bin", op: "and", l, r: this.not() };
    }
    return l;
  }
  not(): Node {
    if (this.isKw("NOT")) {
      this.i++;
      return { k: "not", e: this.not() };
    }
    return this.cmp();
  }
  cmp(): Node {
    const l = this.add();
    const t = this.peek();
    if (t?.t === "op" && ["=", "!=", "<>", "<", ">", "<=", ">="].includes(t.v)) {
      this.i++;
      return { k: "bin", op: t.v, l, r: this.add() };
    }
    const neg = this.isKw("NOT") && (this.isKw("IN", 1) || this.isKw("LIKE", 1));
    if (neg) this.i++;
    if (this.isKw("IN")) {
      this.i++;
      this.eatP("(");
      const list = this.list(() => this.add());
      this.eatP(")");
      return { k: "in", e: l, list, neg };
    }
    if (this.isKw("LIKE")) {
      this.i++;
      const r = this.add();
      const like: Node = { k: "bin", op: "like", l, r };
      return neg ? { k: "not", e: like } : like;
    }
    if (this.isKw("IS")) {
      this.i++;
      const n = this.isKw("NOT");
      if (n) this.i++;
      this.eatKw("NULL");
      return { k: "isnull", e: l, neg: n };
    }
    return l;
  }
  add(): Node {
    let l = this.mul();
    for (let t = this.peek(); t?.t === "op" && (t.v === "+" || t.v === "-"); t = this.peek()) {
      this.i++;
      l = { k: "bin", op: t.v, l, r: this.mul() };
    }
    return l;
  }
  mul(): Node {
    let l = this.prim();
    for (let t = this.peek(); t?.t === "op" && (t.v === "*" || t.v === "/"); t = this.peek()) {
      this.i++;
      l = { k: "bin", op: t.v, l, r: this.prim() };
    }
    return l;
  }
  prim(): Node {
    const t = this.peek();
    if (!t) throw new Error("Unexpected end of the USQL query.");
    if (t.t === "op" && t.v === "*") {
      this.i++;
      return { k: "star" };
    }
    if (this.isP("(")) {
      this.i++;
      const e = this.or();
      this.eatP(")");
      return e;
    }
    if (t.t === "str") {
      this.i++;
      return { k: "lit", v: t.v, str: true };
    }
    if (t.t === "num") {
      this.i++;
      return { k: "lit", v: t.v, str: false };
    }
    if (t.t === "kw" && (t.v === "TRUE" || t.v === "FALSE" || t.v === "NULL")) {
      this.i++;
      return { k: "lit", v: t.v.toLowerCase(), str: false };
    }
    if (t.t === "id") {
      this.i++;
      if (this.isP("(")) {
        this.i++;
        let distinct = false;
        if (this.isKw("DISTINCT")) {
          this.i++;
          distinct = true;
        }
        const args = this.isP(")") ? [] : this.list(() => this.or());
        this.eatP(")");
        return { k: "call", fn: t.v.toUpperCase(), args, distinct };
      }
      return { k: "field", name: t.v };
    }
    throw new Error(`Unexpected "${t.v}" in the USQL query.`);
  }
}

type Select = { e: Node; alias?: string };
type Query = { select: Select[]; from: string; where?: Node; groupBy: Node[]; orderBy: { e: Node; dir: "asc" | "desc" }[]; limit?: number };

function parse(q: string): Query {
  const p = new Parser(lex(q));
  p.eatKw("SELECT");
  const select = p.list<Select>(() => {
    const e = p.or();
    let alias: string | undefined;
    if (p.isKw("AS")) {
      p.i++;
      const a = p.peek();
      alias = a.v;
      p.i++;
    }
    return { e, alias };
  });
  p.eatKw("FROM");
  const from = p.peek().v.toLowerCase();
  p.i++;
  let where: Node | undefined;
  if (p.isKw("WHERE")) {
    p.i++;
    where = p.or();
  }
  let groupBy: Node[] = [];
  if (p.isKw("GROUP")) {
    p.i++;
    p.eatKw("BY");
    groupBy = p.list(() => p.add());
  }
  const orderBy: Query["orderBy"] = [];
  if (p.isKw("ORDER")) {
    p.i++;
    p.eatKw("BY");
    orderBy.push(
      ...p.list(() => {
        const e = p.add();
        let dir: "asc" | "desc" = "asc";
        if (p.isKw("DESC") || p.isKw("ASC")) {
          dir = p.peek().v === "DESC" ? "desc" : "asc";
          p.i++;
        }
        return { e, dir };
      }),
    );
  }
  let limit: number | undefined;
  if (p.isKw("LIMIT")) {
    p.i++;
    limit = Number(p.peek().v);
    p.i++;
  }
  if (p.peek()) throw new Error(`Unexpected "${p.peek().v}" after the end of the USQL query.`);
  return { select, from, where, groupBy, orderBy, limit };
}

// ---------------------------------------------------------------------------------------------------------------------
// Field mapping (classic RUM -> new RUM). Durations: classic USQL uses milliseconds; Grail durations are nanoseconds.
// ---------------------------------------------------------------------------------------------------------------------
type FieldMap = { to: string; duration?: boolean; lowerValues?: boolean; note?: string };
const SESSION_FIELDS: Record<string, FieldMap> = {
  usersessionid: { to: "dt.rum.session.id" },
  internaluserid: { to: "dt.rum.instance.id", note: "internalUserId maps to dt.rum.instance.id (browser instance), not a tagged user." },
  starttime: { to: "start_time" },
  endtime: { to: "end_time" },
  duration: { to: "duration", duration: true },
  useractioncount: { to: "user_action_count" },
  totalerrorcount: { to: "error.count" },
  errorcount: { to: "error.count" },
  browserfamily: { to: "browser.name", note: "browserFamily maps to browser.name (new RUM has no separate family field)." },
  browsertype: { to: "browser.name" },
  browsermajorversion: { to: "browser.version" },
  osfamily: { to: "os.name" },
  osversion: { to: "os.version" },
  devicetype: { to: "device.type" },
  usertype: { to: "dt.rum.user_type", lowerValues: true },
  hassessionreplay: { to: "characteristics.has_replay" },
  application: { to: "frontend.name" },
  "useraction.application": { to: "frontend.name" },
  country: { to: "geo.country.name" },
  continent: { to: "geo.continent.name" },
  region: { to: "geo.region.name" },
  city: { to: "geo.city.name" },
  screenwidth: { to: "browser.window.width" },
  screenheight: { to: "browser.window.height" },
  endreason: { to: "end_reason", lowerValues: true },
  "useraction.name": { to: "frontend.name", note: "useraction.name on usersession has no session-level equivalent; query user.events (FROM useraction) for action names." },
};
const ACTION_FIELDS: Record<string, FieldMap> = {
  name: { to: "page.name", note: "Classic user action names map to page.name (or view.name for single-page apps)." },
  "useraction.name": { to: "page.name" },
  application: { to: "frontend.name" },
  "useraction.application": { to: "frontend.name" },
  duration: { to: "duration", duration: true },
  "useraction.duration": { to: "duration", duration: true },
  starttime: { to: "start_time" },
  "useraction.starttime": { to: "start_time" },
  endtime: { to: "end_time" },
  type: { to: "characteristics.classifier", lowerValues: true },
  "usersession.browserfamily": { to: "browser.name" },
  "usersession.country": { to: "geo.country.name" },
  "usersession.usertype": { to: "dt.rum.user_type", lowerValues: true },
  "usersession.devicetype": { to: "device.type" },
  "usersession.osfamily": { to: "os.name" },
  "usersession.city": { to: "geo.city.name" },
};

export type UsqlResult = { dql: string; visualization: string; confidence: Confidence; notes: string[] };

/** classic DTAQL tile type -> Gen3 visualization. */
const VIS: Record<string, string> = { TABLE: "table", COLUMN_CHART: "categoricalBarChart", PIE_CHART: "pieChart", SINGLE_VALUE: "singleValue", LINE_CHART: "lineChart", FUNNEL: "table" };

export function translateUsql(usql: string, tileType = "TABLE"): UsqlResult {
  const notes: string[] = [];
  let confidence: Confidence = "exact";
  const note = (n: string, c: Confidence = "approximate") => {
    if (!notes.includes(n)) notes.push(n);
    if (c === "manual" || (c === "approximate" && confidence === "exact")) confidence = c;
  };

  if (/\bFUNNEL\s*\(/i.test(usql)) {
    note("FUNNEL queries have no direct DQL form; build the funnel from user.events with countIf() per step.", "manual");
  }
  let q: Query;
  try {
    q = parse(usql);
  } catch (e) {
    return { dql: "", visualization: VIS[tileType] ?? "table", confidence: "manual", notes: [`The USQL query could not be parsed: ${(e as Error).message}`] };
  }

  const isAction = q.from === "useraction";
  if (q.from !== "usersession" && q.from !== "useraction") note(`FROM ${q.from} is not supported; the query reads user.sessions.`, "manual");
  const map = isAction ? ACTION_FIELDS : SESSION_FIELDS;
  const source = isAction ? "user.events" : "user.sessions";
  note("USQL reads classic RUM data; the DQL reads new RUM (Grail) data, which only exists for frontends monitored with new RUM.");

  const fieldOf = (name: string): FieldMap => {
    const m = map[name.toLowerCase()];
    if (m) {
      if (m.note) note(m.note);
      return m;
    }
    note(`Field ${name} has no known new RUM equivalent; it was kept as is. Check the field name in user.${isAction ? "events" : "sessions"}.`);
    return { to: name };
  };
  let bucket: { field: string; interval: string } | null = null;

  const expr = (n: Node, ctxDuration = false): string => {
    switch (n.k) {
      case "field":
        return fieldRef(fieldOf(n.name).to);
      case "star":
        return "*";
      case "lit":
        if (n.str) return dqlStr(n.v);
        return ctxDuration && /^[0-9.]+$/.test(n.v) ? `${n.v}ms` : n.v;
      case "not":
        return `not(${expr(n.e)})`;
      case "isnull":
        return `${n.neg ? "isNotNull" : "isNull"}(${expr(n.e)})`;
      case "in": {
        const fm = n.e.k === "field" ? fieldOf(n.e.name) : null;
        const vals = n.list.map((x) => (x.k === "lit" && x.str && fm?.lowerValues ? dqlStr(x.v.toLowerCase()) : expr(x, !!fm?.duration)));
        const s = `in(${expr(n.e)}, array(${vals.join(", ")}))`;
        return n.neg ? `not(${s})` : s;
      }
      case "bin": {
        if (n.op === "and" || n.op === "or") return `(${expr(n.l)} ${n.op} ${expr(n.r)})`;
        const fm = n.l.k === "field" ? fieldOf(n.l.name) : null;
        const lowerLit = (x: Node) => (x.k === "lit" && x.str && fm?.lowerValues ? dqlStr(x.v.toLowerCase()) : expr(x, !!fm?.duration));
        if (n.op === "like") {
          const pat = n.r.k === "lit" ? n.r.v : "";
          const inner = pat.replace(/^%|%$/g, "");
          if (/^%.*%$/.test(pat)) return `contains(${expr(n.l)}, ${dqlStr(inner)})`;
          if (pat.endsWith("%")) return `startsWith(${expr(n.l)}, ${dqlStr(inner)})`;
          if (pat.startsWith("%")) return `endsWith(${expr(n.l)}, ${dqlStr(inner)})`;
          return `${expr(n.l)} == ${dqlStr(pat)}`;
        }
        const op = n.op === "=" ? "==" : n.op === "<>" ? "!=" : n.op;
        return `${expr(n.l)} ${op} ${lowerLit(n.r)}`;
      }
      case "call": {
        const a = n.args;
        switch (n.fn) {
          case "COUNT":
            if (!a.length || a[0].k === "star") return "count()";
            return n.distinct ? `countDistinct(${expr(a[0])})` : `countIf(isNotNull(${expr(a[0])}))`;
          case "AVG":
          case "SUM":
          case "MIN":
          case "MAX":
            return `${n.fn.toLowerCase()}(${expr(a[0])})`;
          case "MEDIAN":
            return `median(${expr(a[0])})`;
          case "PERCENTILE":
            return `percentile(${expr(a[0])}, ${a[1] ? expr(a[1]) : "50"})`;
          case "STARTSWITH":
            return `startsWith(${expr(a[0])}, ${expr(a[1])})`;
          case "ENDSWITH":
            return `endsWith(${expr(a[0])}, ${expr(a[1])})`;
          case "TOP":
            return expr(a[0]);
          case "DATETIME": {
            const interval = a[2]?.k === "lit" ? a[2].v : "1h";
            const f = a[0] ? expr(a[0]) : "start_time";
            bucket = { field: f, interval };
            return `bin(${f}, ${interval})`;
          }
          case "CONDITION":
            note("CONDITION() was replaced by countIf(); check the condition.");
            return a[0] ? `countIf(${expr(a[0])})` : "count()";
          default:
            note(`USQL function ${n.fn}() is not supported; it was kept as is.`, "manual");
            return `${n.fn.toLowerCase()}(${a.map((x) => expr(x)).join(", ")})`;
        }
      }
    }
  };

  const isAgg = (n: Node): boolean => n.k === "call" && ["COUNT", "AVG", "SUM", "MIN", "MAX", "MEDIAN", "PERCENTILE", "CONDITION"].includes(n.fn);
  const keyOf = (n: Node) => JSON.stringify(n).toLowerCase();
  const nameFor = (s: Select, i: number): string => {
    if (s.alias) return s.alias.replace(/[^A-Za-z0-9_]/g, "_");
    const n = s.e;
    if (n.k === "field") return fieldOf(n.name).to;
    if (n.k === "call" && n.fn === "DATETIME") return "time";
    if (n.k === "call" && n.fn === "TOP" && n.args[0]?.k === "field") return fieldOf(n.args[0].name).to;
    if (n.k === "call") {
      const arg = n.args[0]?.k === "field" ? `_${fieldOf(n.args[0].name).to.replace(/[^A-Za-z0-9]+/g, "_")}` : "";
      return `${n.fn.toLowerCase()}${n.distinct ? "_distinct" : ""}${arg}` || `col${i}`;
    }
    return `col${i}`;
  };

  // TOP(x, n) in the select list implies a limit on that group.
  let topLimit: number | undefined;
  for (const s of q.select) if (s.e.k === "call" && s.e.fn === "TOP" && s.e.args[1]?.k === "lit") topLimit = Number(s.e.args[1].v);

  const lines = [`fetch ${source}`];
  if (isAction) {
    lines.push(`| filter in(characteristics.classifier, array("user_action", "navigation", "user_interaction", "page_summary"))`);
    note("Classic user actions map to user.events of the classifiers user_action, navigation, user_interaction and page_summary.");
  }
  if (q.where) lines.push(`| filter ${expr(q.where).replace(/^\((.*)\)$/s, "$1")}`);

  const aggs = q.select.map((s, i) => ({ s, i, name: nameFor(s, i) })).filter((x) => isAgg(x.s.e));
  const dims = q.select.map((s, i) => ({ s, i, name: nameFor(s, i) })).filter((x) => !isAgg(x.s.e));
  // GROUP BY items not in the select list still group.
  const groupKeys = new Set(q.groupBy.map(keyOf));
  // TOP(x, n) groups by x, so GROUP BY x is the same dimension.
  const dimKey = (n: Node) => keyOf(n.k === "call" && n.fn === "TOP" && n.args[0] ? n.args[0] : n);
  for (const g of q.groupBy) if (!dims.some((d) => dimKey(d.s.e) === keyOf(g))) dims.push({ s: { e: g }, i: dims.length, name: nameFor({ e: g }, dims.length) });
  const groupDims = dims.filter((d) => groupKeys.has(dimKey(d.s.e)) || (d.s.e.k === "call" && d.s.e.fn === "TOP") || aggs.length > 0);
  // by: {name = expr} only when the name differs from the plain field
  const byItem = (d: { s: Select; name: string }) => {
    const ex = expr(d.s.e);
    return ex === fieldRef(d.name) ? ex : `${fieldRef(d.name)} = ${ex}`;
  };

  const named = new Map<string, string>(); // node key -> output field name
  let vis = VIS[tileType] ?? "table";
  if (aggs.length) {
    const aggText = aggs.map((a) => `${fieldRef(a.name)} = ${expr(a.s.e)}`);
    aggs.forEach((a) => named.set(keyOf(a.s.e), a.name));
    const nonTime = groupDims.filter((d) => !(d.s.e.k === "call" && d.s.e.fn === "DATETIME"));
    const timeDim = groupDims.find((d) => d.s.e.k === "call" && d.s.e.fn === "DATETIME");
    if (timeDim) expr(timeDim.s.e); // sets bucket
    const b = bucket as { field: string; interval: string } | null;
    const simple = aggs.every((a) => a.s.e.k === "call" && ["COUNT", "AVG", "SUM", "MIN", "MAX"].includes(a.s.e.fn));
    if (b && simple) {
      // Time-bucketed: a real time series for line / column charts.
      const byTxt = nonTime.length ? `, by: {${nonTime.map(byItem).join(", ")}}` : "";
      lines.push(`| makeTimeseries {${aggText.join(", ")}}${byTxt}, time: ${b.field}, interval: ${b.interval}`);
      if (vis === "categoricalBarChart") vis = "barChart";
      else if (vis !== "table") vis = "lineChart";
    } else {
      const byTxt = groupDims.length ? `, by: {${groupDims.map(byItem).join(", ")}}` : "";
      lines.push(`| summarize {${aggText.join(", ")}}${byTxt}`);
      if (b) vis = vis === "lineChart" || vis === "categoricalBarChart" ? "barChart" : vis;
    }
    if (vis === "singleValue" && groupDims.length) vis = "table";
  } else {
    lines.push(`| fields ${dims.map((d) => (d.s.e.k === "field" && !d.s.alias ? expr(d.s.e) : `${fieldRef(d.name)} = ${expr(d.s.e)}`)).join(", ")}`);
    if (vis !== "table") vis = "table";
  }
  dims.forEach((d) => named.set(keyOf(d.s.e), d.name));

  if (q.orderBy.length) {
    const parts = q.orderBy.map((o) => {
      // ORDER BY can name a select alias, repeat a select expression, or use a raw field.
      const n = named.get(keyOf(o.e));
      const aliasHit = o.e.k === "field" ? [...aggs, ...dims].find((x) => x.s.alias && x.s.alias.toLowerCase() === (o.e as { name: string }).name.toLowerCase()) : undefined;
      const f = aliasHit ? aliasHit.name : n ?? expr(o.e);
      return `${fieldRef(f)} ${o.dir}`;
    });
    lines.push(`| sort ${parts.join(", ")}`);
  } else if (topLimit !== undefined && aggs[0]) {
    lines.push(`| sort ${fieldRef(aggs[0].name)} desc`);
  }
  const lim = q.limit ?? topLimit;
  if (lim !== undefined) lines.push(`| limit ${lim}`);

  return { dql: lines.join("\n"), visualization: vis, confidence, notes };
}
