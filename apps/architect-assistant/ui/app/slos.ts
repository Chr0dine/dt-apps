import { queryExecutionClient } from "@dynatrace-sdk/client-query";
import { serviceLevelObjectivesClient } from "@dynatrace-sdk/client-classic-environment-v2";
import { httpClient } from "@dynatrace-sdk/http-client";
import { getIntentLink } from "@dynatrace-sdk/navigation";
import type { DocLink, ManualAction } from "./remediation";

// ---------------------------------------------------------------------------
// Classic SLO -> SLO (Grail) upgrade. Classic SLOs come from the classic SLO API (metric expression + entity
// selector); SLOs from the platform SLO API (one DQL query returning `sli`). A classic SLO counts as upgraded when an
// SLO with the same name exists.
// There is no API that converts a metric expression to DQL (Data Explorer's converter is UI only), so conversion is
// recipe based: the metric expressions of the classic SLO templates and other common shapes map to Grail metrics, and
// the entity selector is kept as is with DQL's classicEntitySelector(). Anything else is a manual upgrade.
// Every recipe query was run against the demo tenant with dtctl. API specs: `dtctl describe api SLO`.
// ---------------------------------------------------------------------------

const SLO_API = "/platform/slo/v1/slos";
const EXTERNAL_PREFIX = "architect-assistant-slo-";
const NAME_MAX = 200;
const DESCRIPTION_MAX = 250;
/** Classic API: evaluated SLOs come in pages of at most 25. */
const EVAL_PAGE = 25;

const DOC = {
  upgrade: { title: "Upgrade from Service-Level Objectives Classic", url: "https://docs.dynatrace.com/docs/platform/upgrade/keep-problems-and-alerting-working/service-level-objective-upgrade-classic" },
  selector: { title: "Metric selector conversion", url: "https://docs.dynatrace.com/docs/platform/upgrade/preserve-metrics-and-service-visibility/metrics/metric-selector-conversion" },
  templates: { title: "Service-level objective templates", url: "https://docs.dynatrace.com/docs/deliver/service-level-objectives/service-level-objective-templates" },
} satisfies Record<string, DocLink>;
export const SLO_DOCS: DocLink[] = [DOC.upgrade, DOC.selector, DOC.templates];

// --- Small helpers ------------------------------------------------------------

/** FNV-1a 32-bit, hex. Stable short ID per SLO name. */
function nameHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
export const externalIdFor = (name: string) => `${EXTERNAL_PREFIX}${nameHash(name)}`;

async function errorFromResponse(e: unknown): Promise<string> {
  const anyE = e as any;
  const res = anyE?.response;
  if (res?.body) {
    try {
      const b = (await res.body("json")) as any;
      const details = b?.error?.details?.constraintViolations?.map?.((v: any) => [v?.path, v?.message].filter(Boolean).join(": ")).filter(Boolean).join("; ");
      return [b?.error?.message, details].filter(Boolean).join(": ") || String(anyE?.message ?? e);
    } catch {
      /* fall through */
    }
  }
  return anyE?.body?.error?.message ?? anyE?.data?.error?.message ?? anyE?.message ?? String(e);
}

const intentLink = (props: Record<string, unknown>, app: string, intent: string): string | undefined => {
  try {
    return getIntentLink(props, app, intent);
  } catch {
    return undefined;
  }
};
/** Intents read from the tenant with `dtctl get intent <app>/<intent>`. */
export const classicSloLink = (id: string) => intentLink({ "slo.id": id }, "dynatrace.classic.slo", "view-slo");
export const sloLink = (id: string) => intentLink({ "dt.slo.id": id }, "dynatrace.service.level.objectives", "view-slo");

// --- Reads ---------------------------------------------------------------------

export type ClassicSlo = {
  id: string;
  name: string;
  enabled: boolean;
  metricExpression: string;
  filter: string;
  target: number;
  warning: number;
  timeframe: string;
  metricName: string;
  description: string;
};

/** Every classic SLO, enabled and disabled (not evaluated, so one page of up to 10,000). */
export async function listClassicSlos(): Promise<ClassicSlo[]> {
  const out: ClassicSlo[] = [];
  let nextPageKey: string | undefined;
  do {
    const res = await serviceLevelObjectivesClient.getSlo(nextPageKey ? { nextPageKey } : { pageSize: 10000, evaluate: "false", enabledSlos: "all" });
    for (const s of res.slo ?? []) {
      out.push({
        id: s.id,
        name: s.name,
        enabled: s.enabled,
        metricExpression: s.metricExpression ?? "",
        filter: s.filter ?? "",
        target: s.target,
        warning: s.warning,
        timeframe: s.timeframe,
        metricName: s.metricName ?? "",
        description: s.description ?? "",
      });
    }
    nextPageKey = res.nextPageKey ?? undefined;
  } while (nextPageKey);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export type NewSlo = { id: string; name: string; version: string; externalId?: string };

export async function listNewSlos(): Promise<NewSlo[]> {
  const out: NewSlo[] = [];
  let pageKey: string | undefined;
  do {
    const res = await httpClient.send({ url: pageKey ? `${SLO_API}?page-key=${encodeURIComponent(pageKey)}` : `${SLO_API}?page-size=500`, method: "GET" });
    const body = (await res.body("json")) as { slos?: any[]; nextPageKey?: string | null };
    for (const s of body.slos ?? []) out.push({ id: String(s.id), name: String(s.name ?? ""), version: String(s.version ?? ""), externalId: s.externalId ?? undefined });
    pageKey = body.nextPageKey ?? undefined;
  } while (pageKey);
  return out;
}

/** Classic evaluated percentage per classic SLO ID (own timeframe); one call per 25 SLOs. -1 or missing = no value. */
export async function evaluateClassic(ids: string[]): Promise<Map<string, { value: number | null; error?: string }>> {
  const out = new Map<string, { value: number | null; error?: string }>();
  for (let i = 0; i < ids.length; i += EVAL_PAGE) {
    const chunk = ids.slice(i, i + EVAL_PAGE);
    const selector = `id(${chunk.map((id) => `"${id.replace(/[~"]/g, (c) => `~${c}`)}"`).join(",")})`;
    const res = await serviceLevelObjectivesClient.getSlo({ sloSelector: selector, evaluate: "true", enabledSlos: "all", pageSize: EVAL_PAGE });
    for (const s of res.slo ?? []) {
      const ok = s.error === "NONE" && s.evaluatedPercentage >= 0;
      out.set(s.id, { value: ok ? s.evaluatedPercentage : null, error: ok ? undefined : s.error });
    }
  }
  return out;
}

// --- Matching -------------------------------------------------------------------

export type SloRow = ClassicSlo & { match?: NewSlo; managed: boolean };

/** Pairs every classic SLO with the SLO of the same name (the one this app created wins when several share a name). */
export function matchSlos(classic: ClassicSlo[], slos: NewSlo[]): SloRow[] {
  const byName = new Map<string, NewSlo>();
  slos.forEach((s) => {
    const cur = byName.get(s.name);
    if (!cur || s.externalId === externalIdFor(s.name)) byName.set(s.name, s);
  });
  return classic.map((c) => {
    const match = byName.get(c.name);
    return { ...c, match, managed: !!match && match.externalId === externalIdFor(c.name) };
  });
}

// --- Conversion recipes -----------------------------------------------------------

/**
 * Removes whitespace and every `:splitBy(...)` (an aggregate classic SLO resolves to one value, so the split does not
 * change the result). `bare` also drops parentheses, so `(100)*((a)/(b))` and `(100)*(a)/(b)` compare equal.
 */
function normalize(expr: string): { norm: string; bare: string } {
  const norm = expr.replace(/\s+/g, "").replace(/:splitBy\([^)]*\)/g, "");
  return { norm, bare: norm.replace(/[()]/g, "") };
}
const ratioForms = (a: string, b: string) => [`100*${a}/${b}`, `${a}/${b}*100`];

type Recipe = {
  id: string;
  label: string;
  /** Grail entity dimension the classic entity selector filters on. */
  entity: string;
  /** Classic entity type (for checking the selector's type()). */
  entityType: string;
  match: (e: { norm: string; bare: string }) => RegExpMatchArray | boolean;
  build: (filter: string, m: RegExpMatchArray | boolean) => string;
  notes: string[];
};

const avgOf = (metric: string) => (filter: string) => `timeseries sli = avg(${metric})${filter}`;

const ratioOf = (a: string, b: string, rollup: boolean) => (filter: string) => {
  const agg = (m: string) => (rollup ? `sum(${m}, rollup: avg)` : `sum(${m})`);
  return `timeseries { a = ${agg(a)}, b = ${agg(b)} }${filter}\n| fieldsAdd sli = a[] / b[] * 100\n| fieldsRemove a, b`;
};

const availability = (filter: string) =>
  `timeseries { total = sum(dt.service.request.count), failures = sum(dt.service.request.failure_count) }${filter}\n| fieldsAdd sli = (total[] - failures[]) / total[] * 100\n| fieldsRemove total, failures`;

/** `((builtin:service.response.time:avg:partition("x",value("good",lt(T))):count:default(0))/(builtin:service.response.time:avg:count)*(100))[:default(100,always)]` */
const PERF_RE =
  /^\(*builtin:service\.response\.time:avg:partition\("[^"]*",value\("good",lt\((\d+(?:\.\d+)?)\)\)\):count:default\(0\)\)\/\(builtin:service\.response\.time:avg:count\)\*\(100\)\)*(?::default\(100(?:\.0)?,always\))?$/;

const COMPARE_NOTE = "Run both SLOs for one evaluation period and compare the values before you retire the classic SLO.";

const RECIPES: Recipe[] = [
  {
    id: "service-availability",
    label: "Service availability (server-side)",
    entity: "dt.entity.service",
    entityType: "SERVICE",
    match: ({ bare }) =>
      ratioForms("builtin:service.errors.server.successCount", "builtin:service.requestCount.server").includes(bare) || bare === "100-builtin:service.errors.server.rate",
    build: availability,
    notes: ["Successful = requests minus dt.service.request.failure_count (failure detection), per Grail interval."],
  },
  {
    id: "service-availability-total",
    label: "Service availability (all errors)",
    entity: "dt.entity.service",
    entityType: "SERVICE",
    match: ({ bare }) =>
      ratioForms("builtin:service.errors.total.successCount", "builtin:service.requestCount.total").includes(bare) || bare === "100-builtin:service.errors.total.rate",
    build: availability,
    notes: ["The classic metric counted client-side errors too; Grail has one failure count (failure detection), so values can be slightly higher."],
  },
  {
    id: "service-performance",
    label: "Service performance (response time threshold)",
    entity: "dt.entity.service",
    entityType: "SERVICE",
    match: ({ norm }) => norm.match(PERF_RE) ?? false,
    build: (filter, m) => {
      const threshold = Array.isArray(m) ? m[1] : "0";
      return [
        `timeseries rt = avg(dt.service.request.response_time), by: { dt.entity.service }${filter}`,
        `| fieldsAdd good = iCollectArray(if(rt[] < ${threshold}, 1, else: 0)), counted = iCollectArray(if(isNull(rt[]), 0, else: 1))`,
        `| summarize { good = sum(good[]), counted = sum(counted[]) }, by: { timeframe, interval }`,
        `| fieldsAdd sli = 100 * good[] / counted[]`,
        `| fields timeframe, interval, sli`,
      ].join("\n");
    },
    notes: [
      "Threshold kept in microseconds (both metrics use µs).",
      "Classic counted 1-minute data points per service under the threshold; DQL counts data points at the query resolution, so the value can differ slightly.",
    ],
  },
  {
    id: "synthetic-browser",
    label: "Browser monitor availability",
    entity: "dt.entity.synthetic_test",
    entityType: "SYNTHETIC_TEST",
    match: ({ bare }) => /^builtin:synthetic\.browser\.availability\.location\.total(WoMaintenanceWindow)?$/.test(bare),
    build: avgOf("dt.synthetic.browser.availability"),
    notes: ["If the classic metric excluded maintenance windows (totalWoMaintenanceWindow), check the result during a maintenance window."],
  },
  {
    id: "synthetic-http",
    label: "HTTP monitor availability",
    entity: "dt.entity.http_check",
    entityType: "HTTP_CHECK",
    match: ({ bare }) => /^builtin:synthetic\.http\.availability\.location\.total(WoMaintenanceWindow)?$/.test(bare),
    build: avgOf("dt.synthetic.http.availability"),
    notes: ["If the classic metric excluded maintenance windows (totalWoMaintenanceWindow), check the result during a maintenance window."],
  },
  { id: "host-cpu", label: "Host CPU usage", entity: "dt.entity.host", entityType: "HOST", match: ({ bare }) => bare === "builtin:host.cpu.usage", build: avgOf("dt.host.cpu.usage"), notes: [] },
  { id: "host-memory", label: "Host memory usage", entity: "dt.entity.host", entityType: "HOST", match: ({ bare }) => bare === "builtin:host.mem.usage", build: avgOf("dt.host.memory.usage"), notes: [] },
  { id: "host-disk", label: "Host disk used %", entity: "dt.entity.host", entityType: "HOST", match: ({ bare }) => bare === "builtin:host.disk.usedPct", build: avgOf("dt.host.disk.used.percent"), notes: [] },
  {
    id: "k8s-namespace-memory",
    label: "Kubernetes namespace memory efficiency",
    entity: "dt.entity.cloud_application_namespace",
    entityType: "CLOUD_APPLICATION_NAMESPACE",
    match: ({ bare }) => ratioForms("builtin:kubernetes.workload.memory_working_set", "builtin:kubernetes.workload.requests_memory").includes(bare),
    build: ratioOf("dt.kubernetes.container.memory_working_set", "dt.kubernetes.container.requests_memory", true),
    notes: [],
  },
  {
    id: "k8s-namespace-cpu",
    label: "Kubernetes namespace CPU efficiency",
    entity: "dt.entity.cloud_application_namespace",
    entityType: "CLOUD_APPLICATION_NAMESPACE",
    match: ({ bare }) => ratioForms("builtin:kubernetes.workload.cpu_usage", "builtin:kubernetes.workload.requests_cpu").includes(bare),
    build: ratioOf("dt.kubernetes.container.cpu_usage", "dt.kubernetes.container.requests_cpu", true),
    notes: [],
  },
  {
    id: "k8s-cluster-memory",
    label: "Kubernetes cluster memory requests",
    entity: "dt.entity.kubernetes_cluster",
    entityType: "KUBERNETES_CLUSTER",
    match: ({ bare }) => ratioForms("builtin:kubernetes.node.requests_memory", "builtin:kubernetes.node.memory_allocatable").includes(bare),
    build: ratioOf("dt.kubernetes.container.requests_memory", "dt.kubernetes.node.memory_allocatable", true),
    notes: [],
  },
  {
    id: "k8s-cluster-cpu",
    label: "Kubernetes cluster CPU requests",
    entity: "dt.entity.kubernetes_cluster",
    entityType: "KUBERNETES_CLUSTER",
    match: ({ bare }) => ratioForms("builtin:kubernetes.node.requests_cpu", "builtin:kubernetes.node.cpu_allocatable").includes(bare),
    build: ratioOf("dt.kubernetes.container.requests_cpu", "dt.kubernetes.node.cpu_allocatable", true),
    notes: [],
  },
];

function findRecipe(expr: string): { recipe: Recipe; m: RegExpMatchArray | boolean } | null {
  const e = normalize(expr);
  for (const recipe of RECIPES) {
    const m = recipe.match(e);
    if (m) return { recipe, m };
  }
  return null;
}

/** Label of the conversion recipe for a metric expression, or null when it needs a manual upgrade. */
export const recipeLabel = (expr: string): string | null => findRecipe(expr)?.recipe.label ?? null;

/** Entity types named in the selector's type(...) clauses (quotes optional, case-insensitive). */
const selectorTypes = (filter: string) => Array.from(filter.matchAll(/type\(\s*"?([A-Za-z_]+)"?\s*\)/g), (m) => m[1].toUpperCase());

/** Classic timeframe ("-1w", "-14d to now", "now-2d") -> SLO criteria start ("now-7d"). Null when it is not a plain relative window. */
export function toTimeframeFrom(tf: string): string | null {
  const m = tf.trim().match(/^(?:now)?-(\d+)\s*(m|h|d|w)(?:\s*to\s*now)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === "w" ? `now-${n * 7}d` : `now-${n}${m[2]}`;
}
/** Window length in ms for a criteria start produced by toTimeframeFrom. */
function windowMs(from: string): number {
  const m = from.match(/^now-(\d+)(m|h|d)$/);
  if (!m) return 7 * 86_400_000;
  return Number(m[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as "m" | "h" | "d"];
}

// --- Plan ---------------------------------------------------------------------------

export type SloPlan = {
  classic: ClassicSlo;
  recipe: { id: string; label: string };
  query: string;
  notes: string[];
  body: Record<string, unknown>;
  /** Set when this app created the SLO before: PUT instead of POST. */
  existing?: NewSlo;
};
export type PlanResult = { plan: SloPlan; problem: null } | { plan: null; problem: string; manual: boolean };

export function planUpgrade(row: SloRow, duplicateName: boolean): PlanResult {
  const c: ClassicSlo = row;
  if (c.name.length > NAME_MAX) return { plan: null, problem: `Name longer than ${NAME_MAX} characters (SLO name limit).`, manual: false };
  if (row.match && !row.managed) return { plan: null, problem: "An SLO with this name exists and was not created by this app; left unchanged.", manual: false };
  if (duplicateName) return { plan: null, problem: "Another classic SLO has the same name; SLOs need a unique externalId, so only the first one is upgraded.", manual: false };
  const found = findRecipe(c.metricExpression);
  if (!found) return { plan: null, problem: "Metric expression has no automatic conversion. Upgrade it manually (see the manual action).", manual: true };
  const types = selectorTypes(c.filter);
  if (types.some((t) => t !== found.recipe.entityType)) {
    return { plan: null, problem: `Entity selector type ${types.join(", ")} does not match the metric's entity (${found.recipe.entityType}).`, manual: true };
  }
  const from = toTimeframeFrom(c.timeframe);
  if (!from) return { plan: null, problem: `Timeframe "${c.timeframe}" is not a relative window ending now; set the criteria manually.`, manual: true };
  const filter = c.filter.trim() ? `, filter: { in(${found.recipe.entity}, classicEntitySelector(${JSON.stringify(c.filter.trim())})) }` : "";
  const query = found.recipe.build(filter, found.m);
  const criteria: Record<string, unknown> = { timeframeFrom: from, timeframeTo: "now", target: c.target };
  if (Number.isFinite(c.warning) && c.warning > c.target && c.warning <= 100) criteria.warning = c.warning;
  const description = (c.description.trim() || `Upgraded from classic SLO "${c.name}" by Architect Assistant.`).slice(0, DESCRIPTION_MAX);
  return {
    problem: null,
    plan: {
      classic: c,
      recipe: { id: found.recipe.id, label: found.recipe.label },
      query,
      notes: [...found.recipe.notes, ...(c.filter.trim() ? [] : ["No entity selector: every entity with this metric is included."]), COMPARE_NOTE],
      existing: row.managed ? row.match : undefined,
      body: {
        name: c.name,
        description,
        externalId: externalIdFor(c.name),
        tags: c.metricName ? [`classic-slo:${c.metricName}`] : [],
        criteria: [criteria],
        customSli: { indicator: query },
      },
    },
  };
}

/** Plans for the selected rows; classic SLOs that share a name after the first are skipped. */
export function planUpgrades(rows: SloRow[]): { row: SloRow; result: PlanResult }[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    const dup = seen.has(row.name);
    seen.add(row.name);
    return { row, result: planUpgrade(row, dup) };
  });
}

// --- Validate: run each SLI query over the classic timeframe ----------------------------

/** `nodata`: the query is valid but found nothing (entities gone); `error`: the query itself failed. */
export type Preview = { ok: boolean; kind: "ok" | "nodata" | "error"; message: string; value: number | null; records: number };

/** Runs the SLI query over the SLO's window and averages every `sli` data point (a preview, not the SLO evaluation). */
export async function previewSli(plan: SloPlan): Promise<Preview> {
  const from = String((plan.body.criteria as any[])[0].timeframeFrom);
  const end = new Date();
  const start = new Date(end.getTime() - windowMs(from));
  try {
    const started = await queryExecutionClient.queryExecute({
      body: { query: plan.query, defaultTimeframeStart: start.toISOString(), defaultTimeframeEnd: end.toISOString(), requestTimeoutMilliseconds: 30000 },
    });
    let { state, result } = started;
    while (state === "RUNNING" || state === "NOT_STARTED") {
      const p = await queryExecutionClient.queryPoll({ requestToken: started.requestToken ?? "", requestTimeoutMilliseconds: 30000 });
      state = p.state;
      result = p.result;
    }
    if (state !== "SUCCEEDED") return { ok: false, kind: "error", message: `Query ${state.toLowerCase()}.`, value: null, records: 0 };
    const records = (result?.records ?? []).filter(Boolean) as Record<string, any>[];
    const points = records.flatMap((r) => (Array.isArray(r.sli) ? r.sli : [])).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (records.length === 0 || points.length === 0) {
      return { ok: false, kind: "nodata", message: "Query ran but returned no data for this window (entities not found or no data).", value: null, records: records.length };
    }
    return { ok: true, kind: "ok", message: `Returns sli (${records.length} series).`, value: points.reduce((a, b) => a + b, 0) / points.length, records: records.length };
  } catch (e) {
    return { ok: false, kind: "error", message: `Query failed: ${await errorFromResponse(e)}`, value: null, records: 0 };
  }
}

// --- Writes -----------------------------------------------------------------------

export type UpgradeResult = { name: string; ok: boolean; message: string; id?: string };

export async function upgradeOne(plan: SloPlan): Promise<UpgradeResult> {
  const name = plan.classic.name;
  try {
    if (plan.existing) {
      await httpClient.send({
        url: `${SLO_API}/${encodeURIComponent(plan.existing.id)}?optimistic-locking-version=${encodeURIComponent(plan.existing.version)}`,
        method: "PUT",
        requestBodyType: "json",
        body: plan.body,
      });
      return { name, ok: true, message: "SLO updated (same ID).", id: plan.existing.id };
    }
    const res = await httpClient.send({ url: SLO_API, method: "POST", requestBodyType: "json", body: plan.body });
    const created = (await res.body("json")) as { id?: string };
    return { name, ok: true, message: "SLO created.", id: created?.id };
  } catch (e) {
    return { name, ok: false, message: `${plan.existing ? "Update" : "Creation"} failed: ${await errorFromResponse(e)}` };
  }
}

/** One POST (or PUT) per SLO; the API has no bulk create. Runs one at a time so each failure is reported per SLO. */
export async function upgradeSlos(plans: SloPlan[], onProgress?: (done: number) => void): Promise<UpgradeResult[]> {
  const out: UpgradeResult[] = [];
  for (const p of plans) {
    out.push(await upgradeOne(p));
    onProgress?.(out.length);
  }
  return out;
}

export type Evaluation = { status: string; value: number | null; message?: string };

/** Evaluates an SLO with the SLO service (start, then poll until done). */
export async function evaluateSlo(id: string): Promise<Evaluation> {
  try {
    const res = await httpClient.send({ url: `${SLO_API}/evaluation:start`, method: "POST", requestBodyType: "json", body: { id, requestTimeoutMilliseconds: 20000 } });
    let body = (await res.body("json")) as any;
    for (let i = 0; i < 6 && !body?.evaluationResults && body?.evaluationToken; i++) {
      const p = await httpClient.send({
        url: `${SLO_API}/evaluation:poll?evaluation-token=${encodeURIComponent(body.evaluationToken)}&request-timeout-milliseconds=10000`,
        method: "GET",
      });
      body = await p.body("json");
    }
    const r = body?.evaluationResults?.[0];
    if (!r) return { status: "PENDING", value: null, message: "Evaluation did not finish; open the SLO to see it." };
    return { status: String(r.status), value: typeof r.value === "number" ? r.value : null, message: r.message };
  } catch (e) {
    return { status: "ERROR", value: null, message: await errorFromResponse(e) };
  }
}

// --- Manual guidance -----------------------------------------------------------------

export const manualUpgradeAction: ManualAction = {
  id: "slo-manual",
  title: "Upgrade a classic SLO manually (Data Explorer converter)",
  steps: [
    "In Service-Level Objectives Classic, open the SLO and select Actions > View in Data Explorer.",
    "In Data Explorer, select Open with… > Add to notebook. The metric expression is converted to DQL.",
    "In the notebook, name the last result field `sli` (required) and check the result.",
    "In Service-Level Objectives, select Service-level objective > Custom SLO and paste the query into Custom DQL; Refresh shows the preview.",
    "Under Criteria, set the same target, warning and evaluation period as the classic SLO.",
    "Use the same name as the classic SLO so this tab counts it as upgraded, then save.",
  ],
  variants: [
    {
      label: "Entity selector to DQL",
      language: "text",
      code: [
        '// Keep the classic selector as is:',
        '| filter in(dt.entity.service, classicEntitySelector("type(SERVICE),tag(\\"criticality:Gold\\")"))',
        "",
        "// type(SERVICE)        -> by: { dt.entity.service }",
        '// entityId("SERVICE-…") -> filter: { in(dt.entity.service, { "SERVICE-…" }) }',
        "// mzName / mzId          -> use a segment (segments do not restrict access)",
      ].join("\n"),
    },
  ],
  notes: [
    "Not every metric selector converts automatically; parents, smooth, lastReal and toUnit have no DQL equivalent, and rollup(count) / percentiles can differ.",
    "If a classic SLO came from a template, Dynatrace recommends reviewing the SLI rather than copying it one to one (business hours, key requests, segments).",
    COMPARE_NOTE,
  ],
  docs: SLO_DOCS,
};
