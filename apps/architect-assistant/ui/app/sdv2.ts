import { settingsObjectsClient } from "@dynatrace-sdk/client-classic-environment-v2";
import { DOC } from "./deepTech";
import { postObjects, putObjects, type Obj } from "./deepMonitoring";
import type { Category } from "./kubernetes";
import { dqlString } from "./queries";
import type { DocLink, ManualAction, SubmitResult } from "./remediation";

// ---------------------------------------------------------------------------
// Service Detection v2 adoption model: which services already use SDv2, where SDv2 for OneAgent can be switched on
// (Kubernetes and AWS Lambda: generally available; generic workloads outside them: Early Access), which workloads the
// docs say to keep on SDv1, the tenant's SDv2 settings and the built-in rules the docs recommend. Facts and steps come
// from the SDv2 pages in DOC (deepTech.ts), fetched 2026-10-24; the docs-freshness check flags them when they change.
// Schemas, defaults and property names were read from the tenant with `dtctl get settings-schema`.
// ---------------------------------------------------------------------------

export const SDV2_SCHEMA = "builtin:service-detection-v2-for-oneagent";
export const DETECTION_SCHEMA = "builtin:service-detection-rules";
export const SPLITTING_SCHEMA = "builtin:service-splitting-rules";
export const ENDPOINT_SCHEMA = "builtin:endpoint-detection-rules";
export const ENDPOINT_OPT_IN_SCHEMA = "builtin:endpoint-detection-rules-opt-in";
export const URL_PATTERN_SCHEMA = "builtin:url-path-pattern-matching-rules";
export const FAILURE_SCHEMA = "builtin:failure-detection-rulesets";
const READ_SCHEMAS = [SDV2_SCHEMA, DETECTION_SCHEMA, SPLITTING_SCHEMA, ENDPOINT_SCHEMA, ENDPOINT_OPT_IN_SCHEMA, URL_PATTERN_SCHEMA];

/** Schema defaults (tenant schema v1). The generic-workload default `false …` matches nothing until it is replaced. */
export const DEFAULT_FAAS_CONDITION = "isNotNull(aws.region) and isNotNull(aws.account.id)";
const DEFAULT_ANY_PREFIX = "false";
/** Every condition property is limited to 1000 characters by the schema. */
export const MAX_CONDITION = 1000;

export const SDV2_DOCS = {
  overview: DOC.sdv2,
  oneAgent: DOC.sdv2OneAgent,
  rules: DOC.sdv2Rules,
  endpoints: DOC.sdv2Endpoints,
  failures: DOC.sdv2Failures,
  splitting: DOC.sdv2Splitting,
  urlPatterns: DOC.sdv2UrlPatterns,
  detection: DOC.serviceDetection,
  naming: DOC.serviceNaming,
  namingUpgrade: DOC.namingUpgrade,
  schema: DOC.sdv2Schema,
  rulesSchema: DOC.sdRulesSchema,
  splittingSchema: DOC.splittingSchema,
} satisfies Record<string, DocLink>;
export const ALL_SDV2_DOCS: DocLink[] = Object.values(SDV2_DOCS);

// --- Services ---------------------------------------------------------------------

type Row = Record<string, any>;
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
export type Ref = { id: string; name: string };
const refs = (v: unknown): Ref[] => {
  if (!Array.isArray(v)) return [];
  const seen = new Map<string, Ref>();
  for (const x of v) if (x && (x.id || x.name)) seen.set(str(x.id) || str(x.name), { id: str(x.id), name: str(x.name) || str(x.id) });
  return [...seen.values()];
};

/** Where the service runs; decides which SDv2 for OneAgent switch applies. */
export type Context = "K8S" | "FAAS" | "GENERIC" | "MAINFRAME" | "OTHER";
export const CONTEXT_LABEL: Record<Context, string> = {
  K8S: "Kubernetes",
  FAAS: "AWS Lambda",
  GENERIC: "Host / VM (generic workload)",
  MAINFRAME: "Mainframe (CICS / IMS)",
  OTHER: "No OneAgent process",
};

export type Verdict = "SDV2" | "ENABLE" | "PILOT" | "REVIEW" | "KEEP";
/** Palette slots (kubernetes.ts) per verdict; fixed so a verdict keeps its colour everywhere. */
export const VERDICTS: Category[] = [
  { id: "SDV2", label: "On SDv2", slot: 6, detail: "Detected by SDv2 already (OpenTelemetry services always are)." },
  { id: "ENABLE", label: "Enable (GA)", slot: 1, detail: "Kubernetes or AWS Lambda service on OneAgent: SDv2 is generally available and the recommended default." },
  { id: "PILOT", label: "Pilot (Early Access)", slot: 3, detail: "One service per process outside Kubernetes and Lambda (web servers, single-service apps): SDv2 for generic workloads, Early Access." },
  { id: "REVIEW", label: "Review first", slot: 4, detail: "Fits SDv2 for generic workloads, but something changes beyond the new service ID (custom services are ignored under SDv2)." },
  { id: "KEEP", label: "Keep on SDv1", slot: null, detail: "The docs say to keep these on SDv1 for now, or no SDv2 for OneAgent scope covers them." },
];
export const CONTEXTS: Category[] = [
  { id: "K8S", label: CONTEXT_LABEL.K8S, slot: 1, detail: "" },
  { id: "FAAS", label: CONTEXT_LABEL.FAAS, slot: 2, detail: "" },
  { id: "GENERIC", label: CONTEXT_LABEL.GENERIC, slot: 3, detail: "" },
  { id: "MAINFRAME", label: CONTEXT_LABEL.MAINFRAME, slot: 5, detail: "" },
  { id: "OTHER", label: "No OneAgent process (OpenTelemetry, ingest)", slot: 7, detail: "" },
];
export const verdictOf = (id: string) => VERDICTS.find((v) => v.id === id) ?? VERDICTS[VERDICTS.length - 1];

export type ServiceRow = {
  id: string;
  name: string;
  version: 1 | 2;
  sdv1Type: string;
  tech: string;
  context: Context;
  verdict: Verdict;
  /** Why the verdict (shown in the table and the AI Assist panel). */
  reasons: string[];
  namespaces: (Ref & { cluster: string })[];
  clusters: Ref[];
  workloads: string[];
  hostGroups: Ref[];
  processGroups: Ref[];
  lambdas: number;
  processes: number;
  servicesOnProcess: number;
  appsOnProcess: number;
  containerized: boolean;
  /** Frontends calling the service and HTTP monitors watching it: both reference the SDv1 service ID. */
  frontends: number;
  monitors: number;
  appServer: string | null;
};

// "Keep SDv1 for now" in the docs: WebSphere, WebLogic, J2EE multi-context JVMs, multi-context ColdFusion (several web
// applications / context roots in one process), and background workloads without an inbound request.
const APP_SERVER_RE = /WEBSPHERE|WEBLOGIC/i;
const WEB_SERVERS = ["NGINX", "APACHE", "IIS"];
const MAINFRAME_TYPES = /^(CICS|IMS)/;

export function toService(r: Row): ServiceRow {
  const techs: string[] = Array.isArray(r.softwareTechnologies) ? r.softwareTechnologies.map(str) : [];
  const appServer = techs.map((t) => /type:([^,]+)/.exec(t)?.[1] ?? "").find((t) => APP_SERVER_RE.test(t)) ?? null;
  const s: ServiceRow = {
    id: str(r.id),
    name: str(r.name),
    version: str(r.sdVersion) === "2" ? 2 : 1,
    sdv1Type: str(r.sdv1Type),
    tech: str(r.tech) === "N/A" ? "" : str(r.tech),
    context: "OTHER",
    verdict: "KEEP",
    reasons: [],
    namespaces: refs(r.namespaces).map((n) => ({ ...n, cluster: str((r.namespaces as Row[]).find((x) => str(x?.id) === n.id)?.cluster) })),
    clusters: refs(r.clusters),
    workloads: Array.isArray(r.workloads) ? r.workloads.map(str).filter(Boolean) : [],
    hostGroups: refs(r.hostGroups),
    processGroups: refs(r.processGroups),
    lambdas: num(r.lambdas),
    processes: num(r.processes),
    servicesOnProcess: num(r.servicesOnProcess),
    appsOnProcess: num(r.appsOnProcess),
    containerized: num(r.containerized) > 0,
    frontends: num(r.frontends),
    monitors: num(r.monitors),
    appServer,
  };
  s.context =
    s.lambdas > 0 ? "FAAS" : s.namespaces.length ? "K8S" : MAINFRAME_TYPES.test(s.sdv1Type) || s.tech === "Z" ? "MAINFRAME" : s.processes > 0 ? "GENERIC" : "OTHER";
  classify(s);
  return s;
}

function classify(s: ServiceRow): void {
  const r = s.reasons;
  if (s.version === 2) {
    s.verdict = "SDV2";
    r.push(s.context === "OTHER" ? "OpenTelemetry or ingested service: always detected by SDv2." : "Already detected by SDv2.");
    return;
  }
  const merge = s.servicesOnProcess > 1 ? `${s.servicesOnProcess} SDv1 services in this process become one SDv2 service (their requests stay apart as endpoints).` : null;
  const custom = s.sdv1Type === "CUSTOM_SERVICE" ? "Custom service: SDv2 ignores SDv1 custom services; these spans join the process's SDv2 service." : null;
  switch (s.context) {
    case "K8S":
    case "FAAS":
      s.verdict = "ENABLE";
      r.push(s.context === "K8S" ? "Kubernetes on OneAgent: SDv2 is GA and the recommended default." : "AWS Lambda on OneAgent: SDv2 is GA (needs the [Built-in] FaaS name rule).");
      if (merge) r.push(merge);
      if (custom) r.push(custom);
      return;
    case "MAINFRAME":
      s.verdict = "KEEP";
      r.push("CICS / IMS service: not one of the SDv2 for OneAgent scenarios (Kubernetes, AWS Lambda, generic workloads).");
      return;
    case "OTHER":
      s.verdict = "KEEP";
      r.push("No process, Kubernetes or Lambda context, so no SDv2 for OneAgent scope applies.");
      return;
  }
  // Generic workload (Early Access).
  if (s.sdv1Type === "BACKGROUND_ACTIVITY") {
    s.verdict = "KEEP";
    r.push("Background activity without an inbound request: SDv2 detection is built around inbound request spans; keep SDv1 for now.");
  } else if (s.appServer) {
    s.verdict = "KEEP";
    r.push(`${s.appServer.replace(/_/g, " ")} application server: keep SDv1 for now while Dynatrace tests these setups.`);
  } else if (s.appsOnProcess > 1) {
    s.verdict = "KEEP";
    r.push(`${s.appsOnProcess} web applications / context roots run in one process: SDv2 would group them into one service; keep SDv1 for the per-application split.`);
  } else if (custom) {
    s.verdict = "REVIEW";
    r.push(custom);
  } else {
    s.verdict = "PILOT";
    r.push(WEB_SERVERS.includes(s.tech) ? "Web server outside Kubernetes: a good fit for generic workloads (Early Access)." : "One application per process outside Kubernetes: fits generic workloads (Early Access).");
  }
  if (merge && s.verdict !== "KEEP") r.push(merge);
  if (s.containerized && s.verdict !== "KEEP") r.push("Containerized, but not linked to a Kubernetes namespace: on ECS, Cloud Run or Container Apps add the cloud connection first so SDv2 can use cloud attributes.");
}

// --- Settings ---------------------------------------------------------------------

export type RuleObj = Obj & { schemaId: string; enabled: boolean; name: string };
export type Sdv2Value = {
  enableSDV2ForKubernetesWorkloads?: boolean;
  condition?: string;
  enableSDV2ForFaaS?: boolean | null;
  conditionForFaaS?: string;
  enableSDV2ForAnyWorkload?: boolean | null;
  conditionForAnyWorkload?: string;
};
export type Sdv2Settings = {
  /** builtin:service-detection-v2-for-oneagent, one object per scope (environment, HOST_GROUP-…, KUBERNETES_CLUSTER-…, CLOUD_APPLICATION_NAMESPACE-…). */
  objects: Map<string, Obj>;
  detection: RuleObj[];
  splitting: RuleObj[];
  endpoints: RuleObj[];
  /** null = no object: the tenant already uses the configurable endpoint rules (docs: the setting is then not shown). */
  endpointOptIn: Obj | null;
  urlPatterns: RuleObj[];
};

/** Every SDv2-related setting in one paged GET (all scopes). */
export async function readSdv2Settings(): Promise<Sdv2Settings> {
  const items: any[] = [];
  let page = await settingsObjectsClient.getSettingsObjects({ schemaIds: READ_SCHEMAS.join(","), fields: "objectId,schemaId,scope,value,updateToken", pageSize: 500 });
  items.push(...(page.items ?? []));
  while (page.nextPageKey) {
    page = await settingsObjectsClient.getSettingsObjects({ nextPageKey: page.nextPageKey });
    items.push(...(page.items ?? []));
  }
  const s: Sdv2Settings = { objects: new Map(), detection: [], splitting: [], endpoints: [], endpointOptIn: null, urlPatterns: [] };
  for (const it of items) {
    const o: Obj = { objectId: String(it.objectId), updateToken: it.updateToken, scope: String(it.scope), value: (it.value ?? {}) as Record<string, any> };
    const rule = (): RuleObj => ({ ...o, schemaId: String(it.schemaId), enabled: o.value.enabled !== false, name: str(o.value.rule?.ruleName) });
    switch (String(it.schemaId)) {
      case SDV2_SCHEMA:
        s.objects.set(o.scope, o);
        break;
      case DETECTION_SCHEMA:
        s.detection.push(rule());
        break;
      case SPLITTING_SCHEMA:
        s.splitting.push(rule());
        break;
      case ENDPOINT_SCHEMA:
        s.endpoints.push(rule());
        break;
      case URL_PATTERN_SCHEMA:
        s.urlPatterns.push(rule());
        break;
      case ENDPOINT_OPT_IN_SCHEMA:
        if (o.scope === "environment") s.endpointOptIn = o;
        break;
    }
  }
  return s;
}

const isCustom = (r: RuleObj) => !r.name.startsWith("[Built-in]");
export const customRuleCount = (rules: RuleObj[]) => rules.filter(isCustom).length;

export type SwitchState = { enabled: boolean; condition: string; scope: string | null };
const OFF: SwitchState = { enabled: false, condition: "", scope: null };
const anyMatches = (c: string) => !!c.trim() && !c.trim().toLowerCase().startsWith(DEFAULT_ANY_PREFIX);

/**
 * Effective SDv2 switch for a set of scopes, most specific first (namespace > cluster > environment, host group >
 * environment): the first scope with an object decides, as in the Settings hierarchy.
 */
export function effectiveSwitch(s: Sdv2Settings, kind: "k8s" | "faas" | "any", scopes: string[]): SwitchState {
  for (const scope of [...scopes, "environment"]) {
    const v = s.objects.get(scope)?.value as Sdv2Value | undefined;
    if (!v) continue;
    if (kind === "k8s") return { enabled: !!v.enableSDV2ForKubernetesWorkloads, condition: str(v.condition), scope };
    if (kind === "faas") return { enabled: !!v.enableSDV2ForFaaS, condition: str(v.conditionForFaaS ?? DEFAULT_FAAS_CONDITION), scope };
    return { enabled: !!v.enableSDV2ForAnyWorkload && anyMatches(str(v.conditionForAnyWorkload)), condition: str(v.conditionForAnyWorkload), scope };
  }
  return OFF;
}

export const scopeLabel = (scope: string, names: Map<string, string>) =>
  scope === "environment"
    ? "Environment"
    : scope.startsWith("HOST_GROUP-")
      ? `Host group ${names.get(scope) ?? scope}`
      : scope.startsWith("KUBERNETES_CLUSTER-")
        ? `Cluster ${names.get(scope) ?? scope}`
        : scope.startsWith("CLOUD_APPLICATION_NAMESPACE-")
          ? `Namespace ${names.get(scope) ?? scope}`
          : scope;

/** One line per SDv2 for OneAgent object: which switches it turns on and with which condition. */
export function describeObject(v: Sdv2Value): string[] {
  const out: string[] = [];
  if (v.enableSDV2ForKubernetesWorkloads) out.push(`Kubernetes: on${v.condition ? ` where ${v.condition}` : " (all workloads)"}`);
  else out.push("Kubernetes: off");
  if (v.enableSDV2ForFaaS) out.push(`FaaS: on where ${v.conditionForFaaS || "(always)"}`);
  else if (v.enableSDV2ForFaaS === false) out.push("FaaS: off");
  if (v.enableSDV2ForAnyWorkload) out.push(`Generic workloads: on where ${v.conditionForAnyWorkload || "(always)"}${anyMatches(str(v.conditionForAnyWorkload)) ? "" : " — matches nothing"}`);
  else if (v.enableSDV2ForAnyWorkload === false) out.push("Generic workloads: off");
  return out;
}

// --- Scope recommendations --------------------------------------------------------

export type ScopeKind = "NAMESPACE" | "HOST_GROUP" | "NO_HOST_GROUP" | "FAAS";
export type ScopeVerdict = "ENABLE" | "PILOT" | "PILOT_SELECTED" | "KEEP" | "DONE";
export const SCOPE_VERDICT_LABEL: Record<ScopeVerdict, string> = {
  ENABLE: "Enable SDv2 (GA)",
  PILOT: "Pilot the host group (Early Access)",
  PILOT_SELECTED: "Pilot selected process groups (Early Access)",
  KEEP: "Keep on SDv1",
  DONE: "Done: all on SDv2",
};
export type ScopeRow = {
  key: string;
  kind: ScopeKind;
  /** Settings scope the switch would be written to. */
  scope: string;
  label: string;
  cluster?: Ref;
  sdv1: number;
  sdv2: number;
  /** Estimated SDv2 services after the switch: distinct workloads (Kubernetes) or process groups (generic). */
  after: number;
  verdict: ScopeVerdict;
  dependents: number;
  /** Process groups that can be piloted / must stay on SDv1 (generic scopes). */
  candidates: Ref[];
  kept: Ref[];
  setting: SwitchState;
  services: ServiceRow[];
};

export function scopeRows(services: ServiceRow[], s: Sdv2Settings | null): ScopeRow[] {
  const settings = s ?? { objects: new Map(), detection: [], splitting: [], endpoints: [], endpointOptIn: null, urlPatterns: [] };
  const groups = new Map<string, ScopeRow>();
  const get = (key: string, init: () => Omit<ScopeRow, "sdv1" | "sdv2" | "after" | "verdict" | "dependents" | "candidates" | "kept" | "services">) => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { ...init(), sdv1: 0, sdv2: 0, after: 0, verdict: "KEEP", dependents: 0, candidates: [], kept: [], services: [] }));
    return g;
  };
  for (const svc of services) {
    let g: ScopeRow | null = null;
    if (svc.context === "K8S") {
      const ns = svc.namespaces[0];
      const cl = svc.clusters[0];
      g = get(`ns:${ns.id}`, () => ({
        key: `ns:${ns.id}`,
        kind: "NAMESPACE",
        scope: ns.id,
        label: `${ns.cluster || cl?.name || "?"} / ${ns.name}`,
        cluster: cl,
        setting: effectiveSwitch(settings, "k8s", [ns.id, ...(cl ? [cl.id] : [])]),
      }));
    } else if (svc.context === "FAAS") {
      g = get("faas", () => ({ key: "faas", kind: "FAAS", scope: "environment", label: "AWS Lambda functions", setting: effectiveSwitch(settings, "faas", []) }));
    } else if (svc.context === "GENERIC") {
      const hg = svc.hostGroups.find((h) => h.id);
      g = hg
        ? get(`hg:${hg.id}`, () => ({ key: `hg:${hg.id}`, kind: "HOST_GROUP", scope: hg.id, label: hg.name, setting: effectiveSwitch(settings, "any", [hg.id]) }))
        : get("hg:none", () => ({ key: "hg:none", kind: "NO_HOST_GROUP", scope: "environment", label: "Hosts without a host group", setting: effectiveSwitch(settings, "any", []) }));
    }
    if (!g) continue;
    g.services.push(svc);
    if (svc.version === 2) g.sdv2++;
    else {
      g.sdv1++;
      g.dependents += svc.frontends + svc.monitors;
    }
  }
  for (const g of groups.values()) {
    const v1 = g.services.filter((x) => x.version === 1);
    if (g.kind === "NAMESPACE" || g.kind === "FAAS") {
      g.after = g.kind === "NAMESPACE" ? new Set(v1.flatMap((x) => (x.workloads.length ? x.workloads : [x.id]))).size : v1.length;
      g.verdict = v1.length ? "ENABLE" : "DONE";
      continue;
    }
    const kept = new Map<string, Ref>();
    const cand = new Map<string, Ref>();
    for (const x of v1) for (const pg of x.processGroups) (x.verdict === "KEEP" ? kept : cand).set(pg.id, pg);
    for (const id of kept.keys()) cand.delete(id); // a process group with any SDv1-only service stays on SDv1
    g.candidates = [...cand.values()];
    g.kept = [...kept.values()];
    g.after = g.candidates.length;
    g.verdict = !v1.length ? "DONE" : !g.candidates.length ? "KEEP" : g.kept.length || g.kind === "NO_HOST_GROUP" ? "PILOT_SELECTED" : "PILOT";
  }
  const order: ScopeVerdict[] = ["ENABLE", "PILOT", "PILOT_SELECTED", "KEEP", "DONE"];
  return [...groups.values()].sort((a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict) || b.sdv1 - a.sdv1 || a.label.localeCompare(b.label));
}

// --- Writes: SDv2 for OneAgent ------------------------------------------------------

export type Sdv2Change = { scope: string; label: string; existing?: Obj; value: Sdv2Value; note?: string };
const baseValue = (existing?: Obj): Sdv2Value => ({ enableSDV2ForKubernetesWorkloads: false, ...((existing?.value ?? {}) as Sdv2Value) });

export const hostGroupCondition = (name: string) => `dt.host_group.id == ${dqlString(name)}`;
export const processGroupCondition = (names: string[]) => names.map((n) => `dt.process_group.detected_name == ${dqlString(n)}`).join(" or ");

/** Kubernetes switch for each scope; `condition` "" = every workload in the scope (schema: empty always matches). */
export function k8sChanges(targets: { scope: string; label: string }[], condition: string, s: Sdv2Settings): Sdv2Change[] {
  return targets.map(({ scope, label }) => {
    const existing = s.objects.get(scope);
    return { scope, label, existing, value: { ...baseValue(existing), enableSDV2ForKubernetesWorkloads: true, condition: condition.trim() } };
  });
}

export function faasChanges(scope: string, label: string, condition: string, s: Sdv2Settings): Sdv2Change[] {
  const existing = s.objects.get(scope);
  return [{ scope, label, existing, value: { ...baseValue(existing), enableSDV2ForFaaS: true, conditionForFaaS: condition.trim() || DEFAULT_FAAS_CONDITION } }];
}

/**
 * Generic-workload switch per scope. A condition that already matches something is kept and OR-ed with the new one,
 * so a staged rollout adds process groups instead of replacing earlier pilots.
 */
export function genericChanges(targets: { scope: string; label: string; condition: string }[], s: Sdv2Settings): Sdv2Change[] {
  return targets.map(({ scope, label, condition }) => {
    const existing = s.objects.get(scope);
    const old = str((existing?.value as Sdv2Value | undefined)?.conditionForAnyWorkload);
    const wasOn = !!(existing?.value as Sdv2Value | undefined)?.enableSDV2ForAnyWorkload && anyMatches(old);
    const merged = wasOn && !old.includes(condition) ? `(${old}) or (${condition})` : wasOn ? old : condition;
    return {
      scope,
      label,
      existing,
      value: { ...baseValue(existing), enableSDV2ForAnyWorkload: true, conditionForAnyWorkload: merged },
      note: wasOn && merged !== old ? "Keeps the current condition and adds the new one with OR." : undefined,
    };
  });
}

export function checkChanges(changes: Sdv2Change[]): string | null {
  if (!changes.length) return "Select at least one scope.";
  for (const c of changes) {
    for (const k of ["condition", "conditionForFaaS", "conditionForAnyWorkload"] as const) {
      const v = c.value[k];
      if (typeof v === "string" && v.length > MAX_CONDITION) return `${c.label}: the condition has ${v.length} characters; the schema allows ${MAX_CONDITION}. Select fewer process groups or pilot the host group.`;
    }
  }
  return null;
}

/** One POST for scopes without an object, one PUT per existing object (the Settings API has no bulk update). */
export async function applyChanges(changes: Sdv2Change[], validateOnly: boolean, done: string): Promise<SubmitResult> {
  const post = changes.filter((c) => !c.existing).map((c) => ({ schemaId: SDV2_SCHEMA, scope: c.scope, value: c.value as Record<string, unknown> }));
  const put = changes.filter((c) => c.existing).map((c) => ({ obj: c.existing!, value: c.value as Record<string, unknown> }));
  if (post.length) {
    const r = await postObjects(post, validateOnly, done);
    if (!r.ok || !put.length) return r;
  }
  return put.length ? putObjects(put, validateOnly, done) : { ok: true, message: validateOnly ? "Validation passed. Nothing was changed." : done };
}

export const requestText = (changes: Sdv2Change[]) => {
  const post = changes.filter((c) => !c.existing);
  const put = changes.filter((c) => c.existing);
  const parts: string[] = [];
  if (post.length) parts.push(`// POST /api/v2/settings/objects (1 call)\n${JSON.stringify(post.map((c) => ({ schemaId: SDV2_SCHEMA, scope: c.scope, value: c.value })), null, 2)}`);
  for (const c of put) parts.push(`// PUT /api/v2/settings/objects/${c.existing!.objectId}\n${JSON.stringify({ value: c.value }, null, 2)}`);
  return parts.join("\n\n");
};

// --- Built-in rule hygiene ----------------------------------------------------------

export type RuleCheck = {
  id: string;
  title: string;
  /** Rule display name in the settings page. */
  rule: string;
  schemaId: string;
  obj: Obj | null;
  /** Value the docs recommend. */
  want: boolean;
  ok: boolean;
  /** Pre-selected in the fix form. */
  recommended: boolean;
  why: string;
  impact: string;
  docs: DocLink[];
};

const byName = (rules: RuleObj[], name: string) => rules.find((r) => r.name.toLowerCase() === name.toLowerCase()) ?? null;

/** Built-in rules the SDv2 docs recommend (footnotes of the default-rule tables). Checks whose object is missing are left out. */
export function ruleChecks(s: Sdv2Settings, services: ServiceRow[]): RuleCheck[] {
  const hasFaas = services.some((x) => x.context === "FAAS");
  const hasGeneric = services.some((x) => x.context === "GENERIC");
  const idChange = "Changes the service IDs of SDv2 services the rule matches (new IDs, historical data stays under the old ones).";
  const checks: Omit<RuleCheck, "ok">[] = [
    {
      id: "otel-name",
      title: "Use the current OpenTelemetry service name rule",
      rule: "[Built-in] OpenTelemetry service name",
      schemaId: DETECTION_SCHEMA,
      obj: byName(s.detection, "[Built-in] OpenTelemetry service name"),
      want: true,
      recommended: true,
      why: "The docs recommend enabling it (it skips service.name = unknown_service); it is on by default for environments created in 1.337+.",
      impact: idChange,
      docs: [SDV2_DOCS.rules],
    },
    {
      id: "otel-name-deprecated",
      title: "Disable the deprecated OpenTelemetry service name rule",
      rule: "[Built-in] OpenTelemetry service name (deprecated)",
      schemaId: DETECTION_SCHEMA,
      obj: byName(s.detection, "[Built-in] OpenTelemetry service name (deprecated)"),
      want: false,
      recommended: true,
      why: "The docs recommend disabling it in favour of the rule above.",
      impact: idChange,
      docs: [SDV2_DOCS.rules],
    },
    {
      id: "split-cluster-ns",
      title: "Split Kubernetes services by cluster and namespace",
      rule: "[Built-in] Split services by k8s cluster and namespace",
      schemaId: SPLITTING_SCHEMA,
      obj: byName(s.splitting, "[Built-in] Split services by k8s cluster and namespace"),
      want: true,
      recommended: true,
      why: "Default for environments created in 1.317+: the same workload name in two clusters is two services instead of one.",
      impact: idChange,
      docs: [SDV2_DOCS.splitting],
    },
    {
      id: "split-ns-deprecated",
      title: "Disable the deprecated namespace-only split",
      rule: "[Built-in] Split services by k8s namespace (deprecated)",
      schemaId: SPLITTING_SCHEMA,
      obj: byName(s.splitting, "[Built-in] Split services by k8s namespace (deprecated)"),
      want: false,
      recommended: true,
      why: "Replaced by the cluster-and-namespace split; disabled by default for environments created in 1.317+.",
      impact: idChange,
      docs: [SDV2_DOCS.splitting],
    },
    {
      id: "split-hostgroup",
      title: "Split services by host group and primary cloud fields",
      rule: "[Built-in] Split services by host group and primary cloud fields",
      schemaId: SPLITTING_SCHEMA,
      obj: byName(s.splitting, "[Built-in] Split services by host group and primary cloud fields"),
      want: true,
      recommended: hasGeneric,
      why: "Default for environments created in 1.337+: keeps the same service in different host groups, AWS accounts / regions, Azure subscriptions or GCP projects apart (useful before piloting generic workloads).",
      impact: idChange,
      docs: [SDV2_DOCS.splitting],
    },
    {
      id: "faas-name",
      title: "Keep the FaaS name rule enabled",
      rule: "[Built-in] FaaS name",
      schemaId: DETECTION_SCHEMA,
      obj: byName(s.detection, "[Built-in] FaaS name"),
      want: true,
      recommended: true,
      why: hasFaas ? "SDv2 for AWS Lambda only works when this rule is enabled." : "SDv2 for AWS Lambda only works when this rule is enabled (no Lambda services found).",
      impact: "Lambda services detected by SDv2 are named after faas.name.",
      docs: [SDV2_DOCS.oneAgent, SDV2_DOCS.rules],
    },
    {
      id: "derived-route",
      title: "Use automatic endpoint names for services without http.route",
      rule: "[Built-in] HTTP fallback for derived route (legacy naming)",
      schemaId: ENDPOINT_SCHEMA,
      obj: byName(s.endpoints, "[Built-in] HTTP fallback for derived route (legacy naming)"),
      want: false,
      recommended: true,
      why: "Environments created before 1.342 keep GET /* endpoint names; disabling this rule activates the derived routes (GET /shop/products/ instead of GET /*).",
      impact: "Endpoint names of matching services change (new endpoints, the old ones stop receiving data).",
      docs: [SDV2_DOCS.endpoints],
    },
  ];
  const out: RuleCheck[] = checks
    .filter((c) => c.obj)
    .map((c) => ({ ...c, ok: ((c.obj as RuleObj).enabled ?? true) === c.want }));
  if (s.endpointOptIn) {
    const on = s.endpointOptIn.value.enabled === true;
    out.push({
      id: "endpoint-opt-in",
      title: "Opt in to the configurable endpoint detection",
      rule: "Enable endpoint detection",
      schemaId: ENDPOINT_OPT_IN_SCHEMA,
      obj: s.endpointOptIn,
      want: true,
      ok: on,
      recommended: true,
      why: "Endpoints created before August 2025 use hard-coded rules; the opt-in enables the default rule set (server and consumer spans only) and custom endpoint rules.",
      impact: "Breaks existing SDv2 endpoints: compare them first (the docs link a comparison dashboard).",
      docs: [SDV2_DOCS.endpoints],
    });
  }
  return out;
}

export const checkFixValue = (c: RuleCheck): Record<string, unknown> => ({ ...(c.obj?.value ?? {}), enabled: c.want });

export async function applyRuleFixes(checks: RuleCheck[], validateOnly: boolean): Promise<SubmitResult> {
  const objs = checks.filter((c) => c.obj).map((c) => ({ obj: c.obj!, value: checkFixValue(c) }));
  if (!objs.length) return { ok: false, message: "Select at least one rule." };
  return putObjects(objs, validateOnly, `${objs.length} ${objs.length === 1 ? "rule" : "rules"} updated. New detection applies to data received from now on.`);
}

// --- Manual actions ------------------------------------------------------------------

export const SDV2_SERVICES_DQL = `smartscapeNodes "SERVICE", from:now()-2h
| filter dt.service_detection.version == "2"
| fields id, name
| sort name asc`;

export const updateReferencesAction: ManualAction = {
  id: "sdv2-references",
  title: "Update dashboards, alerts and SLOs after the switch",
  steps: [
    "SDv2 assigns new service IDs (and new metric keys) to the services that match: list what references the SDv1 services before you switch a scope.",
    "Review string-based references: DQL queries, dashboards, SLO filters and alert conditions that match services by ID or name.",
    "Switch the scope (start in lower environments; the matching condition can limit it to one language or namespace).",
    "Find the new services in Services > Explorer: the dt.service_detection.version property is 2 (or run the query above).",
    "Point the references at the new service IDs and confirm that queries return data, SLOs compute and alerts behave as expected.",
  ],
  variants: [{ label: "New SDv2 services (DQL)", language: "dql", code: SDV2_SERVICES_DQL }],
  notes: ["Historical data stays under the SDv1 service IDs; the new services only have data from the switch on."],
  docs: [SDV2_DOCS.oneAgent, SDV2_DOCS.namingUpgrade],
};

export const serviceNameAction: ManualAction = {
  id: "sdv2-service-name",
  title: "Name services at the source (OTEL_SERVICE_NAME)",
  steps: [
    "Set OTEL_SERVICE_NAME (or service.name in OTEL_RESOURCE_ATTRIBUTES) as an environment variable on the application process. This works with OneAgent; the OpenTelemetry SDK is not needed.",
    "Restart the process. SDv2 services use service.name as the name; SDv1 services show service.name (detected name).",
    "Keep context such as environment, region or team out of the name: use primary Grail fields and tags as dimensions instead.",
  ],
  variants: [
    { label: "Environment variable", language: "bash", code: "OTEL_SERVICE_NAME=my-checkout-service" },
    { label: "With other resource attributes", language: "bash", code: "OTEL_RESOURCE_ATTRIBUTES=service.name=my-checkout-service" },
  ],
  notes: [
    "service.name is a process-level attribute: every service in the process shares it.",
    "New names apply to telemetry sent after the change; existing data keeps the name it was recorded with.",
  ],
  docs: [SDV2_DOCS.naming, SDV2_DOCS.namingUpgrade],
};

export const urlPatternAction: ManualAction = {
  id: "sdv2-url-patterns",
  title: "Replace GET /* endpoint names with URL path patterns",
  steps: [
    "Only for services without http.route (web servers, reverse proxies): frameworks such as Spring, Express and .NET Core set it already.",
    "Go to Settings > Process and contextualize > Services > URL path pattern matching and select New rule.",
    "Scope the matching condition to the workload; outside Kubernetes use dt.host_group.id rather than k8s.workload.name.",
    "Add URL path patterns: literal segments, {placeholder} for IDs, _ to keep a segment (such as the API version), * for any trailing segments.",
    "Order the patterns (the first match wins) and the rules (more specific rules first), then save.",
  ],
  variants: [
    {
      label: "Example rule (Settings API value)",
      language: "json",
      code: JSON.stringify(
        {
          schemaId: URL_PATTERN_SCHEMA,
          scope: "environment",
          value: { enabled: true, rule: { ruleName: "orders-demo endpoints", condition: 'dt.host_group.id == "orders-demo-vm"', urlPathPatterns: ["/api/_/orders/{id}", "/internal/*"] } },
        },
        null,
        2,
      ),
    },
  ],
  notes: ["The raw URL path stays available (View URLs next to an endpoint).", "Patterns are plain strings of up to 256 characters each (tenant schema)."],
  docs: [SDV2_DOCS.urlPatterns, SDV2_DOCS.endpoints],
};

export const detectionRuleAction: ManualAction = {
  id: "sdv2-detection-rule",
  title: "Adjust SDv2 service names with a detection rule",
  steps: [
    "Go to Settings > Process and contextualize > Services > Service detection and select Add rule. Custom rules are evaluated before the built-in ones; the first match wins.",
    "Enter a matching condition (DQL matcher) and a service name template with resource attributes in braces, for example {k8s.workload.name}.",
    "Every attribute in the template and in Additional service detection attributes must exist on the span, or the rule does not apply.",
    "To drop an attribute from the name without changing the service ID, remove it from the template and add it to Additional service detection attributes.",
  ],
  variants: [
    {
      label: "Example rule (Settings API value)",
      language: "json",
      code: JSON.stringify(
        {
          schemaId: DETECTION_SCHEMA,
          scope: "environment",
          value: { enabled: true, rule: { ruleName: "Payments workloads", condition: 'k8s.namespace.name == "payments"', serviceNameTemplate: "{k8s.workload.name}", additionalRequiredAttributes: [] } },
        },
        null,
        2,
      ),
    },
  ],
  notes: [
    "Placeholders are case-sensitive.",
    "Changing static text or the order of attributes keeps the service ID; adding or removing an attribute creates a new one.",
    "Primary Grail fields and tags are not recommended in name templates: use them as dimensions.",
  ],
  docs: [SDV2_DOCS.rules, SDV2_DOCS.naming],
};
