// Classic dashboard -> list of translated tiles -> Gen3 (Grail) dashboard document content.

import { Ctx, FoldMode, SelectorParseError, dqlStr, fieldRef, translateSelector } from "./metricSelector";
import { translateUsql } from "./usql";
import type { ClassicDEQuery, ClassicDashboard, ClassicFilterBy, ClassicSeries, ClassicTile, Confidence, Layout, MigrationResult, TranslatedTile } from "./types";

// ---------------------------------------------------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------------------------------------------------
/** Accepts the Config API JSON, the classic UI "Edit JSON" text, or an export wrapper ({ dashboards: [...] } -> first). */
export function parseClassicDashboard(text: string): ClassicDashboard {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch (e) {
    throw new Error(`Not valid JSON: ${(e as Error).message}`);
  }
  const o = j as Record<string, unknown>;
  const candidate = (Array.isArray(o?.dashboards) ? (o.dashboards as unknown[])[0] : o) as Record<string, unknown> | undefined;
  if (!candidate || !Array.isArray(candidate.tiles)) {
    if (o && typeof o === "object" && "content" in o && "type" in o) throw new Error("This looks like a new (Gen3) dashboard document, not a classic dashboard.");
    throw new Error('Not a classic dashboard: expected a "tiles" array (Config API /api/config/v1/dashboards/{id} or the classic dashboard JSON).');
  }
  const meta = (candidate.dashboardMetadata ?? {}) as ClassicDashboard["dashboardMetadata"];
  return { id: candidate.id as string | undefined, dashboardMetadata: { ...meta, name: meta.name || "Migrated dashboard" }, tiles: candidate.tiles as ClassicTile[] };
}

// ---------------------------------------------------------------------------------------------------------------------
// Layout: classic tiles are positioned in pixels on a 38 px grid; Gen3 uses a 24-column grid.
// ---------------------------------------------------------------------------------------------------------------------
const UNIT = 38;
export function layoutTiles(bounds: ({ top: number; left: number; width: number; height: number } | undefined)[]): Layout[] {
  const right = Math.max(UNIT * 24, ...bounds.map((b) => (b ? b.left + b.width : 0)));
  const scale = 24 / (right / UNIT);
  let fallbackY = 0;
  const raw = bounds.map((b) => {
    if (!b) {
      const l = { x: 0, y: 10_000 + fallbackY, w: 12, h: 6 };
      fallbackY += 6;
      return l;
    }
    // Round both edges (not left and width separately) so neighbours that touch in classic still touch, not overlap.
    const x = Math.min(23, Math.round((b.left / UNIT) * scale));
    const xr = Math.min(24, Math.round(((b.left + b.width) / UNIT) * scale));
    const w = Math.max(2, Math.min(24 - x, xr - x));
    return { x, y: Math.round(b.top / UNIT), w, h: Math.max(1, Math.round(b.height / UNIT)) };
  });
  // Rounding can make neighbours overlap: push each tile below whatever it collides with.
  const order = raw.map((l, i) => ({ l: { ...l }, i })).sort((a, b) => a.l.y - b.l.y || a.l.x - b.l.x);
  const placed: Layout[] = [];
  const hit = (a: Layout, b: Layout) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const o of order) {
    for (let guard = 0; guard < 500; guard++) {
      const c = placed.find((p) => hit(p, o.l));
      if (!c) break;
      o.l.y = c.y + c.h;
    }
    placed.push(o.l);
  }
  const out: Layout[] = new Array(raw.length);
  order.forEach((o) => (out[o.i] = o.l));
  // Compact the fallback (no bounds) tiles right below the rest.
  const maxY = Math.max(0, ...out.filter((l, i) => bounds[i]).map((l) => l.y + l.h));
  out.forEach((l, i) => {
    if (!bounds[i]) l.y = l.y - 10_000 + maxY;
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Timeframes ("-2h", "-7d", "today", "-30m to now") -> DQL relative expressions
// ---------------------------------------------------------------------------------------------------------------------
export function classicTimeframe(tf: string | null | undefined): { from: string; to: string } | undefined {
  if (!tf) return undefined;
  const t = tf.trim().toLowerCase();
  const rel = /^-(\d+)\s*([smhdwqy]|min|mins|minutes?|hours?|days?|weeks?|months?)$/.exec(t);
  if (rel) {
    const u = rel[2];
    const unit = u.startsWith("min") ? "m" : u.startsWith("hour") ? "h" : u.startsWith("day") ? "d" : u.startsWith("week") || u === "w" ? "d" : u.startsWith("month") ? "d" : u === "q" ? "d" : u === "y" ? "d" : u;
    const mult = u.startsWith("week") || u === "w" ? 7 : u.startsWith("month") ? 30 : u === "q" ? 90 : u === "y" ? 365 : 1;
    return { from: `now()-${Number(rel[1]) * mult}${unit}`, to: "now()" };
  }
  if (t === "today") return { from: "now()@d", to: "now()" };
  if (t === "yesterday") return { from: "now()-1d@d", to: "now()@d" };
  if (t === "this week" || t === "thisweek") return { from: "now()@w", to: "now()" };
  const range = /^(-\d+[smhdw])\s+to\s+(now|-\d+[smhdw])$/.exec(t);
  if (range) return { from: `now()${range[1]}`, to: range[2] === "now" ? "now()" : `now()${range[2]}` };
  return undefined;
}

const withTimeframe = (dql: string, tf?: { from: string; to: string }) => {
  if (!tf) return dql;
  const [first, ...rest] = dql.split("\n");
  const toPart = tf.to === "now()" ? "" : `, to: ${tf.to}`;
  let head = first;
  if (/^timeseries /.test(first) && !first.includes("{")) head = `${first}, from: ${tf.from}${toPart}`;
  else if (/^timeseries \{/.test(first)) {
    // multi-line timeseries: append to the line closing the aggregation block
    const idx = rest.findIndex((l) => /^\s*\}/.test(l));
    if (idx >= 0) rest[idx] = `${rest[idx]}, from: ${tf.from}${toPart}`;
  } else if (/^fetch /.test(first)) head = `${first}, from: ${tf.from}${toPart}`;
  return [head, ...rest].join("\n");
};

// ---------------------------------------------------------------------------------------------------------------------
// Data explorer / custom charting -> selector text
// ---------------------------------------------------------------------------------------------------------------------
const esc = (s: string) => s.replace(/~/g, "~~").replace(/"/g, '~"');

function filterByToSelector(f: ClassicFilterBy | undefined): string | null {
  if (!f) return null;
  const parts: string[] = [];
  for (const n of f.nestedFilters ?? []) {
    const p = filterByToSelector(n);
    if (p) parts.push(p);
  }
  if (f.filter && f.criteria?.length) {
    const dim = f.filter;
    const crit = f.criteria.map((c) => {
      const v = c.value;
      switch (f.filterType) {
        case "NAME":
          return `in("${esc(dim)}",entitySelector("type(${(dim.split(".").pop() ?? "").toUpperCase()}),entityName.equals(~"${esc(v)}~")"))`;
        case "TAG":
          return `in("${esc(dim)}",entitySelector("type(${(dim.split(".").pop() ?? "").toUpperCase()}),tag(~"${esc(v)}~")"))`;
        case "ENTITY_ATTRIBUTE":
          return `in("${esc(dim)}",entitySelector("type(${(dim.split(".").pop() ?? "").toUpperCase()}),${f.entityAttribute ?? "entityName"}(~"${esc(v)}~")"))`;
        default:
          return c.evaluator === "NE" ? `ne("${esc(dim)}","${esc(v)}")` : `eq("${esc(dim)}","${esc(v)}")`;
      }
    });
    parts.push(crit.length === 1 ? crit[0] : `or(${crit.join(",")})`);
  }
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  return `${(f.filterOperator ?? "AND").toUpperCase() === "OR" ? "or" : "and"}(${parts.join(",")})`;
}

const SPACE_AGG: Record<string, string> = { AVG: "avg", SUM: "sum", MIN: "min", MAX: "max", COUNT: "count", MEDIAN: "median", AUTO: "auto", VALUE: "value" };
function spaceAgg(a?: string): string {
  if (!a) return "auto";
  const pct = /^PERCENTILE_(\d+)$/.exec(a);
  if (pct) return `percentile(${pct[1]})`;
  return SPACE_AGG[a] ?? "auto";
}

/** Rebuilds a selector from a data explorer query (when the tile has no metricExpressions). */
export function deQueryToSelector(q: ClassicDEQuery): string | null {
  if (q.metricSelector) return q.metricSelector;
  if (!q.metric) return null;
  const f = filterByToSelector(q.filterBy);
  const agg = spaceAgg(q.spaceAggregation);
  let s = q.metric;
  if (f) s += `:filter(${f})`;
  s += `:splitBy(${(q.splitBy ?? []).map((d) => `"${esc(d)}"`).join(",")})`;
  if (q.rate && q.rate !== "NONE") s += `:rate(${q.rate.toLowerCase().replace("per_", "1").replace("second", "s").replace("minute", "m").replace("hour", "h")})`;
  s += `:${agg}`;
  if (q.sortBy && q.sortBy !== "NONE") s += `:sort(value(${agg.startsWith("percentile") ? "avg" : agg === "auto" ? "avg" : agg},${q.sortBy === "ASC" ? "ascending" : "descending"}))`;
  if (q.limit) s += `:limit(${q.limit})`;
  return s;
}

const AGG_CC: Record<string, string> = { AVG: "avg", SUM: "sum", MIN: "min", MAX: "max", COUNT: "count", MEDIAN: "median", NONE: "auto" };
function seriesToSelector(s: ClassicSeries, filters: Record<string, Record<string, string[]>> | undefined): string {
  const conds: string[] = [];
  const dims = s.dimensions ?? [];
  const entityDim = dims.find((d) => d.entityDimension)?.name ?? (s.entityType ? `dt.entity.${s.entityType.toLowerCase()}` : undefined);
  const ef = s.entityType ? filters?.[s.entityType] : undefined;
  if (ef && entityDim) {
    const sel: string[] = [`type(${s.entityType})`];
    if (ef.SPECIFIC_ENTITIES?.length) sel.push(`entityId(${ef.SPECIFIC_ENTITIES.map((i) => `~"${esc(i)}~"`).join(",")})`);
    for (const t of ef.AUTO_TAGS ?? []) sel.push(`tag(~"${esc(t)}~")`);
    for (const t of ef.TAGS ?? []) sel.push(`tag(~"${esc(t)}~")`);
    if (sel.length > 1) conds.push(`in("${esc(entityDim)}",entitySelector("${sel.join(",")}"))`);
  }
  for (const d of dims) if (d.name && d.values?.length) conds.push(d.values.length === 1 ? `eq("${esc(d.name)}","${esc(d.values[0])}")` : `or(${d.values.map((v) => `eq("${esc(d.name!)}","${esc(v)}")`).join(",")})`);
  let sel = s.metric;
  if (conds.length) sel += `:filter(${conds.length === 1 ? conds[0] : `and(${conds.join(",")})`})`;
  sel += `:splitBy(${dims.filter((d) => d.name).map((d) => `"${esc(d.name!)}"`).join(",")})`;
  const agg = s.aggregation === "PERCENTILE" ? `percentile(${s.percentile ?? 50})` : AGG_CC[s.aggregation ?? "NONE"] ?? "auto";
  sel += `:${agg}`;
  if (s.sortColumn) sel += `:sort(value(${agg.startsWith("percentile") || agg === "auto" ? "avg" : agg},${s.sortAscending ? "ascending" : "descending"}))`;
  return sel;
}

// Data explorer visual types -> Gen3 visualization + fold mode
const DE_VIS: Record<string, { vis: string; fold: FoldMode }> = {
  GRAPH_CHART: { vis: "lineChart", fold: "none" },
  LINE: { vis: "lineChart", fold: "none" },
  STACKED_AREA: { vis: "areaChart", fold: "none" },
  AREA: { vis: "areaChart", fold: "none" },
  STACKED_COLUMN: { vis: "barChart", fold: "none" },
  COLUMN: { vis: "barChart", fold: "none" },
  SINGLE_VALUE: { vis: "singleValue", fold: "single" },
  TABLE: { vis: "table", fold: "perRow" },
  TOP_LIST: { vis: "categoricalBarChart", fold: "perRow" },
  PIE_CHART: { vis: "pieChart", fold: "perRow" },
  HONEYCOMB: { vis: "honeycomb", fold: "perRow" },
  HEATMAP: { vis: "lineChart", fold: "none" },
};
const CC_VIS: Record<string, { vis: string; fold: FoldMode }> = {
  TIMESERIES: { vis: "lineChart", fold: "none" },
  TOP_LIST: { vis: "categoricalBarChart", fold: "perRow" },
  PIE: { vis: "pieChart", fold: "perRow" },
  SINGLE_VALUE: { vis: "singleValue", fold: "single" },
  BAR: { vis: "barChart", fold: "none" },
};

// ---------------------------------------------------------------------------------------------------------------------
// Classic log query (LOG_ANALYTICS / LOG tiles) -> fetch logs
// ---------------------------------------------------------------------------------------------------------------------
export function translateLogQuery(q: string): { dql: string; notes: string[] } {
  const notes = ["Classic log viewer queries are translated term by term; check operators and field names against the logs schema."];
  const tokens = q.match(/"[^"]*"|\(|\)|[^\s()]+/g) ?? [];
  const out: string[] = [];
  for (const tok of tokens) {
    const up = tok.toUpperCase();
    if (up === "AND" || up === "OR") out.push(up.toLowerCase());
    else if (up === "NOT") out.push("not");
    else if (tok === "(" || tok === ")") out.push(tok);
    else {
      const kv = /^([A-Za-z_][\w.]*)\s*(!?=|:)\s*(.+)$/.exec(tok);
      if (kv) {
        const v = kv[3].replace(/^"|"$/g, "");
        const field = kv[1].toLowerCase() === "content" ? "content" : kv[1];
        if (v.includes("*")) out.push(`${kv[2] === "!=" ? "not " : ""}matchesValue(${fieldRef(field)}, ${dqlStr(v)})`);
        else if (field === "content") out.push(`${kv[2] === "!=" ? "not " : ""}matchesPhrase(content, ${dqlStr(v)})`);
        else out.push(`${fieldRef(field)} ${kv[2] === "!=" ? "!=" : "=="} ${dqlStr(v)}`);
      } else out.push(`matchesPhrase(content, ${dqlStr(tok.replace(/^"|"$/g, ""))})`);
    }
  }
  // implicit AND between adjacent conditions
  const joined: string[] = [];
  out.forEach((t, i) => {
    const prev = out[i - 1];
    if (i > 0 && !["and", "or", "not", "("].includes(prev) && !["and", "or", ")"].includes(t)) joined.push("and");
    joined.push(t);
  });
  const cond = joined.join(" ").replace(/\( /g, "(").replace(/ \)/g, ")");
  return { dql: `fetch logs${cond ? `\n| filter ${cond}` : ""}\n| sort timestamp desc\n| limit 100`, notes };
}

// ---------------------------------------------------------------------------------------------------------------------
// Built-in (non-query) classic tiles
// ---------------------------------------------------------------------------------------------------------------------
type Builtin = { dql: string; vis: string; note: string; confidence: Confidence; keys?: string[] };
const BUILTIN: Record<string, Builtin> = {
  OPEN_PROBLEMS: {
    dql: 'fetch dt.davis.problems\n| filter event.status == "ACTIVE" and not(dt.davis.is_duplicate)\n| summarize problems = count()',
    vis: "singleValue",
    note: "Open problems tile: counts active Davis problems.",
    confidence: "exact",
  },
  HOSTS: {
    dql: "timeseries cpu = avg(dt.host.cpu.usage), by: {dt.entity.host}\n| fieldsAdd entityName(dt.entity.host)\n| fieldsAdd cpu = arrayAvg(cpu)\n| fields dt.entity.host.name, cpu",
    vis: "honeycomb",
    note: "Hosts tile: rebuilt as a honeycomb of average host CPU.",
    confidence: "approximate",
    keys: ["dt.host.cpu.usage"],
  },
  HOST: {
    dql: "timeseries cpu = avg(dt.host.cpu.usage), by: {dt.entity.host}@FILTER@\n| fieldsAdd entityName(dt.entity.host)",
    vis: "lineChart",
    note: "Host tile: rebuilt as CPU usage of the assigned host.",
    confidence: "approximate",
    keys: ["dt.host.cpu.usage"],
  },
  SERVICES: {
    dql: "timeseries {\n    requests = sum(dt.service.request.count),\n    failures = sum(dt.service.request.failure_count)\n  }, by: {dt.entity.service}\n| fieldsAdd entityName(dt.entity.service)\n| fieldsAdd requests = arraySum(requests), failure_rate = arraySum(failures) / arraySum(requests) * 100\n| fields dt.entity.service.name, requests, failure_rate\n| sort requests desc\n| limit 50",
    vis: "table",
    note: "Services tile: rebuilt as a table of requests and failure rate per service.",
    confidence: "approximate",
    keys: ["dt.service.request.count", "dt.service.request.failure_count"],
  },
  SERVICE_VERSATILE: {
    dql: "timeseries response_time = avg(dt.service.request.response_time), by: {dt.entity.service}@FILTER@\n| fieldsAdd entityName(dt.entity.service)",
    vis: "lineChart",
    note: "Service tile: rebuilt as the response time of the assigned service.",
    confidence: "approximate",
    keys: ["dt.service.request.response_time"],
  },
  APPLICATIONS: {
    dql: "fetch user.sessions\n| summarize sessions = count(), by: {frontend.name}\n| sort sessions desc\n| limit 20",
    vis: "categoricalBarChart",
    note: "Applications tile: rebuilt as sessions per frontend from new RUM (user.sessions).",
    confidence: "approximate",
  },
  APPLICATION: {
    dql: "fetch user.sessions\n| summarize sessions = count(), by: {frontend.name}\n| sort sessions desc\n| limit 20",
    vis: "categoricalBarChart",
    note: "Application tile: rebuilt as sessions per frontend (new RUM); filter on frontend.name for the one you need.",
    confidence: "approximate",
  },
  UEM_ACTIVE_SESSIONS: {
    dql: "timeseries sessions = sum(dt.frontend.session.active.estimated_count), by: {frontend.name}",
    vis: "lineChart",
    note: "Active sessions tile: rebuilt from the new RUM active session metric.",
    confidence: "approximate",
    keys: ["dt.frontend.session.active.estimated_count"],
  },
  SYNTHETIC_TESTS: {
    dql: "timeseries availability = avg(dt.synthetic.browser.availability)",
    vis: "lineChart",
    note: "Synthetic tile: rebuilt as browser monitor availability.",
    confidence: "approximate",
    keys: ["dt.synthetic.browser.availability"],
  },
  SYNTHETIC_SINGLE_WEBCHECK: {
    dql: "timeseries availability = avg(dt.synthetic.browser.availability)",
    vis: "lineChart",
    note: "Synthetic monitor tile: rebuilt as browser monitor availability; add a filter for the monitor.",
    confidence: "approximate",
    keys: ["dt.synthetic.browser.availability"],
  },
  SYNTHETIC_HTTP_MONITOR: {
    dql: "timeseries availability = avg(dt.synthetic.http.availability)",
    vis: "lineChart",
    note: "HTTP monitor tile: rebuilt as HTTP monitor availability; add a filter for the monitor.",
    confidence: "approximate",
    keys: ["dt.synthetic.http.availability"],
  },
  DATABASES_OVERVIEW: {
    dql: 'timeseries response_time = avg(dt.service.request.response_time), by: {dt.entity.service}, filter: in(dt.entity.service, classicEntitySelector("type(SERVICE),serviceType(DATABASE_SERVICE)"))\n| fieldsAdd entityName(dt.entity.service)',
    vis: "lineChart",
    note: "Databases tile: rebuilt as response time of database services.",
    confidence: "approximate",
    keys: ["dt.service.request.response_time"],
  },
};

// ---------------------------------------------------------------------------------------------------------------------
// One tile
// ---------------------------------------------------------------------------------------------------------------------
const titleOf = (t: ClassicTile) => t.customName || t.filterConfig?.customName || t.name || t.tileType;

export function translateTile(t: ClassicTile, key: string, layout: Layout, dashMz: ClassicDashboard["dashboardMetadata"]["dashboardFilter"]): TranslatedTile {
  const base: TranslatedTile = {
    key,
    title: titleOf(t),
    classicType: t.tileType,
    sourceLanguage: "none",
    source: "",
    kind: "data",
    confidence: "exact",
    notes: [],
    layout,
    metricKeys: [],
    guessedKeys: [],
  };
  const tf = classicTimeframe(t.tileFilter?.timeframe ?? undefined);
  if (tf) base.timeframe = tf;
  const mz = t.tileFilter?.managementZone ?? dashMz?.managementZone ?? null;

  const markdown = (md: string, conf: Confidence, note?: string, src: TranslatedTile["sourceLanguage"] = "markdown"): TranslatedTile => ({
    ...base,
    kind: "markdown",
    markdown: md,
    sourceLanguage: src,
    source: src === "markdown" ? md : base.source,
    confidence: conf,
    notes: note ? [note] : [],
  });

  switch (t.tileType) {
    case "MARKDOWN":
      return markdown(t.markdown ?? "", "exact");
    case "HEADER":
      return markdown(`## ${t.name ?? ""}`, "exact", undefined, "markdown");
    case "IMAGE":
      return markdown(`*Image tile from the classic dashboard.* Re-add the image as a markdown tile: \`![alt](https://...)\`.`, "manual", "Image tiles embed the image data; upload it somewhere reachable and reference it from markdown.");
    case "SLO":
      return markdown(
        `**SLO** ${(t.assignedEntities ?? []).join(", ")}\n\nUpgrade the classic SLO to a platform SLO, then replace this tile with an SLO tile.`,
        "manual",
        "Classic SLO tiles reference classic SLO IDs; Gen3 SLO tiles need a platform SLO.",
        "built-in tile",
      );
  }

  // Query-backed tiles share the metric selector context
  const ctx: Ctx = { notes: [], confidence: "exact", metricKeys: new Set(), guessedKeys: new Set(), mz };
  const finish = (dql: string, vis: string, src: TranslatedTile["sourceLanguage"], source: string): TranslatedTile => ({
    ...base,
    sourceLanguage: src,
    source,
    dql: withTimeframe(dql, tf),
    visualization: vis,
    confidence: ctx.confidence,
    notes: [...ctx.notes, ...(tf ? [`The classic tile timeframe (${t.tileFilter?.timeframe}) is kept as from: ${tf.from} in the query.`] : [])],
    metricKeys: [...ctx.metricKeys],
    guessedKeys: [...ctx.guessedKeys],
  });

  if (t.tileType === "DATA_EXPLORER" || t.tileType === "CUSTOM_CHARTING") {
    const isDE = t.tileType === "DATA_EXPLORER";
    const visKey = isDE ? t.visualConfig?.type ?? "GRAPH_CHART" : t.filterConfig?.chartConfig?.type ?? "TIMESERIES";
    const m = (isDE ? DE_VIS : CC_VIS)[visKey] ?? { vis: "lineChart", fold: "none" as FoldMode };
    if (isDE && visKey === "HEATMAP") ctx.notes.push("Classic heatmaps are shown as a line chart; switch the visualization if you need a heatmap.");

    // Prefer the expressions the classic UI generated (they include everything the editor set), else rebuild.
    let selectors: string[] = [];
    if (t.metricExpressions?.length) {
      selectors = t.metricExpressions.map((s) => s.replace(/^resolution=[^&]*&/, ""));
      // Data explorer stores one combined expression per query; keep those that are not the global wrapper duplicates.
      selectors = [...new Set(selectors)];
    } else if (isDE) {
      selectors = (t.queries ?? []).filter((q) => q.enabled !== false).map(deQueryToSelector).filter((s): s is string => !!s);
    } else {
      selectors = (t.filterConfig?.chartConfig?.series ?? []).map((s) => seriesToSelector(s, t.filterConfig?.filtersPerEntityType));
    }
    if (!isDE && (t.filterConfig?.filtersPerEntityType && Object.values(t.filterConfig.filtersPerEntityType).some((f) => Object.keys(f).some((k) => !["SPECIFIC_ENTITIES", "AUTO_TAGS", "TAGS"].includes(k))))) {
      ctx.notes.push("Some custom chart entity filters (e.g. host groups, data centers) were not translated.");
      ctx.confidence = "approximate";
    }
    if (!selectors.length) return { ...base, kind: "markdown", markdown: `**${base.title}**\n\nThe classic tile has no queries.`, sourceLanguage: "none", confidence: "manual", notes: ["No enabled queries in the classic tile."] };

    try {
      // Validate every selector first; a metric with no Grail form (calc:, func:) makes the tile a placeholder.
      const probe: Ctx = { ...ctx, notes: [], metricKeys: new Set(), guessedKeys: new Set(), unsupported: [] };
      selectors.forEach((s) => translateSelector(probe, s, m.fold));
      if (probe.unsupported?.length) {
        return {
          ...base,
          kind: "markdown",
          markdown: `**${base.title}**\n\nNot migrated automatically: ${probe.unsupported.map((k) => `\`${k}\``).join(", ")} has no Grail metric.\n\n\`\`\`\n${selectors.join("\n")}\n\`\`\``,
          sourceLanguage: isDE ? "metric selector" : "custom chart",
          source: selectors.join("\n"),
          confidence: "manual",
          notes: probe.notes.filter((n) => probe.unsupported!.some((k) => n.includes(k))),
        };
      }
      if (selectors.length === 1) {
        const r = translateSelector(ctx, selectors[0], m.fold);
        return finish(r.dql, m.vis, isDE ? "metric selector" : "custom chart", selectors[0]);
      }
      // Several queries in one tile: one timeseries per query appended together (works for charts and tables).
      const parts = selectors.map((s) => translateSelector(ctx, s, m.fold));
      ctx.notes.push(`The classic tile has ${selectors.length} queries; they are combined with append, one result per query.`);
      if (ctx.confidence === "exact") ctx.confidence = "approximate";
      const [first, ...rest] = parts;
      const dql = [first.dql, ...rest.map((p) => `| append [\n  ${p.dql.split("\n").join("\n  ")}\n]`)].join("\n");
      return finish(dql, m.vis, isDE ? "metric selector" : "custom chart", selectors.join("\n"));
    } catch (e) {
      const message = e instanceof SelectorParseError ? e.message : (e as Error).message;
      return { ...base, kind: "markdown", markdown: `**${base.title}**\n\nCould not translate:\n\n\`\`\`\n${selectors.join("\n")}\n\`\`\``, sourceLanguage: "metric selector", source: selectors.join("\n"), confidence: "manual", notes: [`Parse error: ${message}`] };
    }
  }

  if (t.tileType === "DTAQL") {
    const r = translateUsql(t.query ?? "", t.type ?? "TABLE");
    if (!r.dql) return { ...base, kind: "markdown", markdown: `**${base.title}**\n\nCould not translate the USQL query:\n\n\`\`\`\n${t.query ?? ""}\n\`\`\``, sourceLanguage: "USQL", source: t.query ?? "", confidence: "manual", notes: r.notes };
    ctx.confidence = r.confidence;
    ctx.notes.push(...r.notes);
    return finish(r.dql, r.visualization, "USQL", t.query ?? "");
  }

  if (t.tileType === "LOG_ANALYTICS" || t.tileType === "LOGS") {
    const q = String(t.query ?? "");
    const r = translateLogQuery(q);
    ctx.notes.push(...r.notes);
    ctx.confidence = "approximate";
    return finish(r.dql, "table", "log query", q);
  }

  const b = BUILTIN[t.tileType];
  if (b) {
    let dql = b.dql;
    const ent = t.assignedEntities?.[0];
    if (dql.includes("@FILTER@")) {
      if (ent) {
        const dim = ent.startsWith("HOST-") ? "dt.entity.host" : ent.startsWith("SERVICE-") ? "dt.entity.service" : null;
        dql = dql.replace("@FILTER@", dim ? `, filter: ${dim} == ${dqlStr(ent)}` : "");
      } else dql = dql.replace("@FILTER@", "");
    }
    ctx.confidence = b.confidence;
    ctx.notes.push(b.note);
    (b.keys ?? []).forEach((k) => ctx.metricKeys.add(k));
    if (mz && (mz.name || mz.id)) {
      ctx.notes.push(`Management zone "${mz.name ?? mz.id}" was not applied to this built-in tile; add a segment or filter.`);
      ctx.confidence = ctx.confidence === "exact" ? "approximate" : ctx.confidence;
    }
    return finish(dql, b.vis, "built-in tile", t.tileType);
  }

  return markdown(
    `**${base.title}**\n\nClassic tile type \`${t.tileType}\` has no automatic translation. Rebuild it with a DQL query.`,
    "manual",
    `Tile type ${t.tileType} is not translated automatically.`,
    "built-in tile",
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Whole dashboard
// ---------------------------------------------------------------------------------------------------------------------
export function translateDashboard(d: ClassicDashboard): MigrationResult {
  const tiles = d.tiles ?? [];
  const layouts = layoutTiles(tiles.map((t) => t.bounds));
  const out = tiles.map((t, i) => translateTile(t, String(i), layouts[i], d.dashboardMetadata.dashboardFilter));
  const notes: string[] = [];
  const dtf = classicTimeframe(d.dashboardMetadata.dashboardFilter?.timeframe ?? undefined);
  if (d.dashboardMetadata.dashboardFilter?.timeframe) {
    notes.push(`Classic default timeframe: ${d.dashboardMetadata.dashboardFilter.timeframe}. Set it in the new dashboard's timeframe selector.`);
  }
  const mz = d.dashboardMetadata.dashboardFilter?.managementZone;
  if (mz && (mz.name || mz.id)) notes.push(`The classic dashboard is filtered to management zone "${mz.name ?? mz.id}"; each query applies it with classicEntitySelector(mzName(...)). Segments are the Gen3 replacement.`);
  const unconfigured = tiles.filter((t) => t.configured === false).length;
  if (unconfigured) notes.push(`${unconfigured} classic tile${unconfigured === 1 ? " is" : "s are"} not configured.`);
  return { name: d.dashboardMetadata.name, classicId: d.id, tiles: out, dashboardNotes: notes, defaultTimeframe: dtf };
}

/** Gen3 dashboard document content (version 21) for the tiles the user kept. */
export function buildGen3Dashboard(r: MigrationResult, tiles: TranslatedTile[], opts: { addMigrationNotes: boolean; sourceLabel?: string }): Record<string, unknown> {
  const content: { version: number; variables: unknown[]; tiles: Record<string, unknown>; layouts: Record<string, Layout> } = { version: 21, variables: [], tiles: {}, layouts: {} };
  let id = 0;
  let shiftY = 0;
  if (opts.addMigrationNotes) {
    const counts = { exact: 0, approximate: 0, manual: 0 };
    tiles.forEach((t) => counts[t.confidence]++);
    const lines = [
      `#### Migrated from classic dashboard "${r.name}"`,
      `${opts.sourceLabel ? `${opts.sourceLabel} · ` : ""}${tiles.length} tiles: ${counts.exact} exact, ${counts.approximate} approximate, ${counts.manual} need manual work. Generated by Dashboard Migrator on ${new Date().toISOString().slice(0, 10)}.`,
      ...r.dashboardNotes.map((n) => `- ${n}`),
    ];
    content.tiles[String(id)] = { type: "markdown", title: "", content: lines.join("\n\n") };
    content.layouts[String(id)] = { x: 0, y: 0, w: 24, h: Math.min(4, 2 + Math.ceil(r.dashboardNotes.length / 2)) };
    shiftY = content.layouts[String(id)].h;
    id++;
  }
  for (const t of tiles) {
    const k = String(id++);
    if (t.kind === "markdown") content.tiles[k] = { type: "markdown", title: "", content: t.markdown ?? "" };
    else content.tiles[k] = { type: "data", title: t.title, query: t.dql ?? "", visualization: t.visualization ?? "table", visualizationSettings: {}, querySettings: {} };
    content.layouts[k] = { ...t.layout, y: t.layout.y + shiftY };
  }
  return content;
}
