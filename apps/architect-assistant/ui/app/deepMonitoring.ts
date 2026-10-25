import { settingsObjectsClient } from "@dynatrace-sdk/client-classic-environment-v2";
import { getIntentLink } from "@dynatrace-sdk/navigation";
import { errorMessage, type SubmitResult } from "./remediation";
import {
  BUILTIN_RULES,
  DOTNET_CORE,
  GO_STATIC,
  MONITORED_SCHEMAS,
  compareVersions,
  supportStatus,
  techInfo,
  type MonitoredSwitch,
  type SupportStatus,
} from "./deepTech";

// ---------------------------------------------------------------------------
// Deep monitoring: data shaping, the settings that decide code-module injection,
// the diagnosis for one process / process group, and the Settings API fixes.
// Schemas and enums were read from the tenant with `dtctl get settings-schema`.
// Every read is ONE paged GET for all schemas and scopes involved; every write is
// one request (POST / PUT) per settings object it changes.
//
// Decision order (Process deep monitoring docs): a host-level process group setting,
// then the process group setting, then custom rules (host group, then environment),
// then built-in rules, then "Enable automatic deep monitoring". Go, .NET (outside
// IIS / containers) and Python are only deep monitored when a rule includes them.
// The Monitored technologies switches, host monitoring mode and container injection
// apply on top of that.
// ---------------------------------------------------------------------------

export const PG_STATE_SCHEMA = "builtin:process-group.monitoring.state"; // scope PROCESS_GROUP; MonitoringState
export const HOST_PG_STATE_SCHEMA = "builtin:host.process-groups.monitoring-state"; // scope HOST; ProcessGroup + MonitoringState
export const AUTO_MONITORING_SCHEMA = "builtin:process.process-monitoring"; // scope HOST_GROUP / environment; autoMonitoring
export const CUSTOM_RULE_SCHEMA = "builtin:process.custom-process-monitoring-rule"; // scope HOST_GROUP / environment
export const BUILTIN_RULE_SCHEMA = "builtin:process.built-in-process-monitoring-rule"; // scope HOST_GROUP / environment; "-<id>": boolean
export const CONTAINER_TECH_SCHEMA = "builtin:container.technology"; // scope HOST / HOST_GROUP / environment
export const CONTAINER_RULE_SCHEMA = "builtin:container.monitoring-rule"; // scope environment

export type ContainerKey = "boshProcessManager" | "containerd" | "crio" | "docker" | "dockerWindows" | "garden" | "podman" | "winc";
/** Schema defaults (used when no object exists at any scope). */
export const CONTAINER_TECH_DEFAULTS: Record<ContainerKey, boolean> = {
  boshProcessManager: true,
  containerd: true,
  crio: true,
  docker: true,
  dockerWindows: false,
  garden: true,
  podman: false,
  winc: false,
};
export const CONTAINER_LABELS: Record<ContainerKey, string> = {
  boshProcessManager: "BOSH Process Manager",
  containerd: "containerd",
  crio: "CRI-O",
  docker: "Docker",
  dockerWindows: "Docker for Windows Server",
  garden: "Garden",
  podman: "Podman",
  winc: "Winc",
};
/** Namespaces the Dynatrace Operator does not inject into by default (plus its own namespace). */
const OPERATOR_EXCLUDED_NS = /^(kube-|openshift-)|^dynatrace$/;

// --- Instances -----------------------------------------------------------------

export type SoftwareTech = { type: string; edition: string | null; version: string | null };

/** "type:JAVA,edition:OpenJDK,version:11.0.5" -> { type, edition, version } ("null" becomes null). */
export function parseSoftwareTech(raw: unknown): SoftwareTech[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => {
    const out: Record<string, string | null> = {};
    for (const part of String(s).split(",")) {
      const i = part.indexOf(":");
      if (i < 0) continue;
      const v = part.slice(i + 1).trim();
      out[part.slice(0, i).trim()] = v === "null" || v === "" ? null : v;
    }
    return { type: out.type ?? "", edition: out.edition ?? null, version: out.version ?? null };
  });
}

const cleanVersion = (v: string) => v.replace(/^[a-z-]+\//i, "").replace(/^go(?=\d)/, "").trim(); // "nginx/1.26.3" -> "1.26.3"

/** Runtime version (and edition) of the process's main technology, e.g. "11.0.5" (Java), "22.16.0" (Node.js), "1.26.3" (NGINX). */
export function techVersion(processType: string | null, techs: SoftwareTech[], jvmClrVersion?: unknown, appVersion?: unknown): { version: string | null; edition: string | null } {
  const info = techInfo(processType);
  for (const t of info.versionTypes) {
    const hit = techs.find((s) => s.type === t && s.version);
    if (hit?.version) return { version: cleanVersion(hit.version), edition: hit.edition };
  }
  const edition = techs.find((s) => info.versionTypes.includes(s.type) && s.edition)?.edition ?? null;
  const fallback = info.fallback === "jvm" ? jvmClrVersion : info.fallback === "app" ? appVersion : null;
  return { version: fallback ? cleanVersion(String(fallback)) : null, edition };
}

const CONTAINER_TYPES: Record<string, ContainerKey> = { CONTAINERD: "containerd", CRIO: "crio", DOCKER: "docker", PODMAN: "podman", GARDEN: "garden" };

export type Instance = {
  id: string;
  sid?: string;
  name: string;
  pg: string;
  pgName: string;
  host?: string;
  hostName?: string;
  hostGroup?: string;
  hostGroupId?: string;
  monitoringMode?: string;
  hostAgentVersion?: string;
  osType?: string;
  /** Technology key: classic processType, or the app's split-out type (IIS_SERVICE_HOST); null = unclassified. */
  processType: string | null;
  version: string | null;
  edition: string | null;
  vendor?: string;
  musl: boolean;
  installerVersion?: string;
  /** Deep monitored: evidence only a code module produces (see queries.ts, DEEP_FLAG). */
  deep: boolean;
  /** Human-readable evidence, e.g. "OneAgent 1.347.64 injected", "3 services from the DOTNET, IIS code modules". */
  evidence: string[];
  codeServices: number;
  runtimeMetrics: string[];
  container: ContainerKey | null;
  kubernetes: boolean;
  /** Process metadata keyed by normalized key (see normKey). */
  metadata: Record<string, string>;
};

/** Normalized metadata / rule item key: underscores removed, upper case (NODEJS_APP_NAME == NODE_JS_APP_NAME). */
export const normKey = (k: string) => k.replace(/_/g, "").toUpperCase();
export const meta = (i: Instance, key: string) => i.metadata[normKey(key)];

function parseMetadata(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(raw)) return out;
  for (const s of raw) {
    const str = String(s);
    const i = str.indexOf(":");
    if (i > 0) out[normKey(str.slice(0, i))] = str.slice(i + 1);
  }
  return out;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined).map(String) : []);

/** What proves the code module: the injecting OneAgent build, services a code module detected, code-module runtime metrics. */
function evidenceOf(r: Record<string, any>): string[] {
  const out: string[] = [];
  if (r.installerVersion) out.push(`OneAgent ${shortVersion(String(r.installerVersion))} injected`);
  const svc = Number(r.codeServices ?? 0);
  if (svc > 0) out.push(`${svc === 1 ? "1 service" : `${svc} services`} from the ${strings(r.serviceAgents).join(", ") || "OneAgent"} code module`);
  const rt = strings(r.runtimeMetrics);
  if (rt.length) out.push(`runtime metrics (${rt.slice(0, 2).join(", ")}${rt.length > 2 ? ", …" : ""})`);
  return out;
}

export function toInstance(r: Record<string, any>): Instance {
  const tech = r.technology ? String(r.technology) : r.processType ? String(r.processType) : null;
  const processType = tech === "OTHER" ? null : tech;
  const techs = parseSoftwareTech(r.softwareTechnologies);
  const metadata = parseMetadata(r.metadata);
  if (r.hostGroup) metadata[normKey("HOST_GROUP")] = String(r.hostGroup);
  const runtime = techs.map((t) => CONTAINER_TYPES[t.type]).find(Boolean) ?? null;
  const windows = String(r.osType ?? "").toUpperCase() === "WINDOWS";
  const { version, edition } = techVersion(processType, techs, r.jvmClrVersion, r.appVersion);
  return {
    id: String(r.id),
    sid: r.sid ? String(r.sid) : undefined,
    name: String(r.name ?? ""),
    pg: String(r.pg ?? ""),
    pgName: String(r.pgName ?? r.pg ?? ""),
    host: r.host ? String(r.host) : undefined,
    hostName: r.hostName ? String(r.hostName) : undefined,
    hostGroup: r.hostGroup ? String(r.hostGroup) : undefined,
    hostGroupId: r.hostGroupId ? String(r.hostGroupId) : undefined,
    monitoringMode: r.monitoringMode ? String(r.monitoringMode) : undefined,
    hostAgentVersion: r.hostAgentVersion ? String(r.hostAgentVersion) : undefined,
    osType: r.osType ? String(r.osType) : undefined,
    processType,
    version,
    edition: edition ?? (r.jvmVendor ? String(r.jvmVendor) : null),
    vendor: r.jvmVendor ? String(r.jvmVendor) : (edition ?? undefined),
    musl: techs.some((t) => t.type === "LIBC" && t.edition === "musl"),
    installerVersion: r.installerVersion ? String(r.installerVersion) : undefined,
    deep: r.isDeep === null || r.isDeep === undefined ? !!r.installerVersion : r.isDeep === true || r.isDeep === "true",
    evidence: evidenceOf(r),
    codeServices: Number(r.codeServices ?? 0) || 0,
    runtimeMetrics: strings(r.runtimeMetrics),
    container: runtime === "docker" && windows ? "dockerWindows" : runtime,
    kubernetes: !!metadata[normKey("KUBERNETES_NAMESPACE")] || techs.some((t) => t.type === "KUBERNETES"),
    metadata,
  };
}

// --- Settings snapshot -----------------------------------------------------------

export type Obj = { objectId: string; updateToken?: string; scope: string; value: Record<string, any> };
export type Rule = Obj & { schemaId: string; enabled: boolean; mode: string; item: string; operator: string; match: string; envVar?: string };

export type DeepSettings = {
  pgState: Map<string, Obj>; // PROCESS_GROUP-x -> object
  hostPgState: Obj[]; // host-level process group settings (value.ProcessGroup, value.MonitoringState)
  autoMonitoring: Map<string, Obj>; // environment / HOST_GROUP-x -> object
  builtin: Map<string, Obj>; // environment / HOST_GROUP-x -> built-in rule switches
  monitored: Map<string, Map<string, Obj>>; // monitored-technologies schema -> environment / HOST-x -> object
  containerTech: Map<string, Obj>; // environment / HOST_GROUP-x / HOST-x -> object
  processRules: Rule[]; // in list order
  containerRules: Rule[];
};
export const EMPTY_SETTINGS: DeepSettings = {
  pgState: new Map(),
  hostPgState: [],
  autoMonitoring: new Map(),
  builtin: new Map(),
  monitored: new Map(),
  containerTech: new Map(),
  processRules: [],
  containerRules: [],
};

const SCHEMAS = [PG_STATE_SCHEMA, HOST_PG_STATE_SCHEMA, AUTO_MONITORING_SCHEMA, CUSTOM_RULE_SCHEMA, BUILTIN_RULE_SCHEMA, CONTAINER_TECH_SCHEMA, CONTAINER_RULE_SCHEMA, ...MONITORED_SCHEMAS];
/** Hosts sent with a diagnosis read are capped; hosts of instances without a code module go first. */
export const MAX_HOST_SCOPES = 50;
/** Scope IDs per GET, so the request URL stays well below common limits (~35 characters each). */
const SCOPES_PER_REQUEST = 80;

/** One paged GET for all schemas and the given scopes. */
async function readScopes(scopes: string[]): Promise<any[]> {
  const items: any[] = [];
  let page = await settingsObjectsClient.getSettingsObjects({
    schemaIds: SCHEMAS.join(","),
    scopes: scopes.join(","),
    fields: "objectId,schemaId,scope,value,updateToken",
    pageSize: 500,
  });
  items.push(...(page.items ?? []));
  while (page.nextPageKey) {
    page = await settingsObjectsClient.getSettingsObjects({ nextPageKey: page.nextPageKey });
    items.push(...(page.items ?? []));
  }
  return items;
}

/**
 * Reads every setting that decides whether these instances get a code module. One GET (paged) for all schemas and
 * scopes; when there are more than SCOPES_PER_REQUEST scopes (search results), one GET per chunk, in parallel.
 */
export async function readDeepSettings(instances: Instance[], maxHosts = MAX_HOST_SCOPES): Promise<DeepSettings> {
  const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  const ordered = [...instances.filter((i) => !i.deep), ...instances.filter((i) => i.deep)];
  const scopes = ["environment", ...uniq(instances.map((i) => i.pg)), ...uniq(instances.map((i) => i.hostGroupId)), ...uniq(ordered.map((i) => i.host)).slice(0, maxHosts)];
  const chunks: string[][] = [];
  for (let n = 0; n < scopes.length; n += SCOPES_PER_REQUEST) chunks.push(scopes.slice(n, n + SCOPES_PER_REQUEST));
  const items = (await Promise.all(chunks.map(readScopes))).flat();
  const s: DeepSettings = { pgState: new Map(), hostPgState: [], autoMonitoring: new Map(), builtin: new Map(), monitored: new Map(), containerTech: new Map(), processRules: [], containerRules: [] };
  for (const it of items) {
    const o: Obj = { objectId: String(it.objectId), updateToken: it.updateToken, scope: String(it.scope), value: (it.value ?? {}) as Record<string, any> };
    const schemaId = String(it.schemaId);
    if (MONITORED_SCHEMAS.includes(schemaId)) {
      if (!s.monitored.has(schemaId)) s.monitored.set(schemaId, new Map());
      s.monitored.get(schemaId)!.set(o.scope, o);
      continue;
    }
    switch (schemaId) {
      case PG_STATE_SCHEMA:
        s.pgState.set(o.scope, o);
        break;
      case HOST_PG_STATE_SCHEMA:
        s.hostPgState.push(o);
        break;
      case AUTO_MONITORING_SCHEMA:
        s.autoMonitoring.set(o.scope, o);
        break;
      case BUILTIN_RULE_SCHEMA:
        s.builtin.set(o.scope, o);
        break;
      case CONTAINER_TECH_SCHEMA:
        s.containerTech.set(o.scope, o);
        break;
      case CUSTOM_RULE_SCHEMA: {
        const c = o.value.condition ?? {};
        s.processRules.push({ ...o, schemaId, enabled: o.value.enabled !== false, mode: String(o.value.mode ?? ""), item: String(c.item ?? ""), operator: String(c.operator ?? ""), match: String(c.value ?? ""), envVar: c.envVar });
        break;
      }
      case CONTAINER_RULE_SCHEMA:
        s.containerRules.push({ ...o, schemaId, enabled: o.value.enabled !== false, mode: String(o.value.mode ?? ""), item: String(o.value.property ?? ""), operator: String(o.value.operator ?? ""), match: String(o.value.value ?? "") });
        break;
    }
  }
  return s;
}

/** Process group monitoring state (MONITORING_ON / MONITORING_OFF; DEFAULT when no object) per process group: one GET per 80 groups. */
export async function readPgStates(pgIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(pgIds.filter((id) => id.startsWith("PROCESS_GROUP-")))];
  const out = new Map<string, string>(ids.map((id) => [id, "DEFAULT"]));
  const chunks: string[][] = [];
  for (let n = 0; n < ids.length; n += SCOPES_PER_REQUEST) chunks.push(ids.slice(n, n + SCOPES_PER_REQUEST));
  await Promise.all(
    chunks.map(async (scopes) => {
      let page = await settingsObjectsClient.getSettingsObjects({ schemaIds: PG_STATE_SCHEMA, scopes: scopes.join(","), fields: "scope,value", pageSize: 500 });
      for (;;) {
        for (const it of page.items ?? []) out.set(String(it.scope), String((it.value as Record<string, any>)?.MonitoringState ?? "DEFAULT"));
        if (!page.nextPageKey) break;
        page = await settingsObjectsClient.getSettingsObjects({ nextPageKey: page.nextPageKey });
      }
    }),
  );
  return out;
}

/** Effective automatic deep monitoring: host group object, else environment object, else the default (on). */
export function effectiveAutoMonitoring(s: DeepSettings, i: Instance): { on: boolean; origin: string; obj?: Obj } {
  const hg = i.hostGroupId ? s.autoMonitoring.get(i.hostGroupId) : undefined;
  if (hg) return { on: hg.value.autoMonitoring !== false, origin: `host group ${i.hostGroup ?? i.hostGroupId}`, obj: hg };
  const env = s.autoMonitoring.get("environment");
  if (env) return { on: env.value.autoMonitoring !== false, origin: "environment", obj: env };
  return { on: true, origin: "environment (default)" };
}

export type SwitchState = { on: boolean; origin: string; hostObj?: Obj; envObj?: Obj; value: Record<string, boolean>; envValue: Record<string, boolean>; sw: MonitoredSwitch };
/** Effective Monitored technologies switch: host object, else environment object, else the schema default. */
export function effectiveSwitch(s: DeepSettings, sw: MonitoredSwitch, i: Instance): SwitchState {
  const objs = s.monitored.get(sw.schema);
  const hostObj = i.host ? objs?.get(i.host) : undefined;
  const envObj = objs?.get("environment");
  const envValue = { ...sw.defaults, ...(envObj?.value ?? {}) } as Record<string, boolean>;
  const value = { ...envValue, ...(hostObj?.value ?? {}) } as Record<string, boolean>;
  return { on: value[sw.prop] !== false, origin: hostObj ? `host ${i.hostName ?? i.host}` : envObj ? "environment" : "environment (default)", hostObj, envObj, value, envValue, sw };
}

/** Effective container injection for the instance's container runtime: host, then host group, then environment, then default. */
export function effectiveContainerTech(s: DeepSettings, i: Instance): { on: boolean; key: ContainerKey; origin: string; scope: string; obj?: Obj; value: Record<string, boolean> } | null {
  if (!i.container) return null;
  const key = i.container;
  const candidates: [string | undefined, string][] = [
    [i.host, `host ${i.hostName ?? i.host}`],
    [i.hostGroupId, `host group ${i.hostGroup ?? i.hostGroupId}`],
    ["environment", "environment"],
  ];
  for (const [scope, origin] of candidates) {
    const o = scope ? s.containerTech.get(scope) : undefined;
    if (o) {
      const value = { ...CONTAINER_TECH_DEFAULTS, ...o.value } as Record<string, boolean>;
      return { on: value[key] !== false, key, origin, scope: o.scope, obj: o, value };
    }
  }
  return { on: CONTAINER_TECH_DEFAULTS[key], key, origin: "environment (default)", scope: "environment", value: { ...CONTAINER_TECH_DEFAULTS } };
}

// --- Rule evaluation -----------------------------------------------------------------

export type Match = "match" | "no" | "unknown";
// Rule items that are named differently from the process metadata key (both normalized).
const ITEM_ALIASES: Record<string, string> = {
  IMAGENAME: "CONTAINERIMAGENAME",
  NODEJSAPPBASEDIR: "NODEJSAPPBASEDIRECTORY",
  PHPCLISCRIPTPATH: "PHPSCRIPTPATH",
  PHPCLIWORKINGDIR: "PHPWORKINGDIRECTORY",
};

// Properties OneAgent evaluates but never reports in the process metadata, so rules on them cannot be checked here.
const UNREPORTED = new Set(["UNKNOWN", "GOBINARYLINKAGE"]);

/** Evaluates a rule condition (custom, built-in or container) against an instance's metadata. */
export function evaluateCondition(item: string, operator: string, v: string, i: Instance): Match {
  const key = normKey(item);
  if (UNREPORTED.has(key)) return "unknown"; // e.g. environment-variable conditions: the value is not reported to Grail
  const actual = i.metadata[ITEM_ALIASES[key] ?? key];
  if (operator === "EXISTS") return actual !== undefined ? "match" : "no";
  if (operator === "NOT_EXISTS") return actual === undefined ? "match" : "no";
  if (actual === undefined) return "no"; // the process has no such property (for example no JAR file on a Node.js process)
  const ok: Record<string, () => boolean> = {
    STARTS: () => actual.startsWith(v),
    NOT_STARTS: () => !actual.startsWith(v),
    ENDS: () => actual.endsWith(v),
    NOT_ENDS: () => !actual.endsWith(v),
    CONTAINS: () => actual.includes(v),
    NOT_CONTAINS: () => !actual.includes(v),
    EQUALS: () => actual === v,
    NOT_EQUALS: () => actual !== v,
  };
  const f = ok[operator];
  return f ? (f() ? "match" : "no") : "unknown";
}
export const evaluateRule = (r: Rule, i: Instance) => evaluateCondition(r.item, r.operator, r.match, i);

const OPERATOR_TEXT: Record<string, string> = {
  STARTS: "begins with",
  NOT_STARTS: "does not begin with",
  ENDS: "ends with",
  NOT_ENDS: "does not end with",
  CONTAINS: "contains",
  NOT_CONTAINS: "does not contain",
  EQUALS: "equals",
  NOT_EQUALS: "does not equal",
  EXISTS: "exists",
  NOT_EXISTS: "does not exist",
};
const itemText = (item: string, envVar?: string) => (item === "UNKNOWN" ? `environment variable ${envVar ?? ""}`.trim() : item.toLowerCase().replace(/_/g, " "));
export const conditionText = (mode: string, item: string, operator: string, value: string, envVar?: string) =>
  `${mode === "MONITORING_ON" || mode === "ON" ? "Monitor" : "Do not monitor"} if ${itemText(item, envVar)} ${OPERATOR_TEXT[operator] ?? operator}${operator.endsWith("EXISTS") ? "" : ` "${value}"`}`;
export const ruleText = (r: Rule) => `${conditionText(r.mode, r.item, r.operator, r.match, r.envVar)}${r.scope === "environment" ? "" : ` (${r.scope})`}`;

function builtinEnabled(s: DeepSettings, i: Instance, id: number): boolean {
  const o = (i.hostGroupId ? s.builtin.get(i.hostGroupId) : undefined) ?? s.builtin.get("environment");
  return o?.value[String(id)] !== false;
}

// --- Diagnosis -------------------------------------------------------------------------

export type CheckStatus = "fail" | "warn" | "pass" | "info";
export type FixId =
  | "pg-on"
  | "host-pg-on"
  | "auto-monitoring"
  | "disable-rules"
  | "monitor-rule"
  | "monitored-tech"
  | "dotnet-core"
  | "go-static"
  | "container-tech"
  | "disable-container-rules"
  | "full-stack"
  | "update-agent"
  | "restart"
  | "kubernetes"
  | "upgrade"
  | "alternative";
/** `confirm`: the app inferred this (no setting explains it), so the UI asks to confirm it on the process page first. */
export type Check = { id: string; status: CheckStatus; title: string; detail: string; fix?: FixId; confirm?: boolean };

type Decision = { key: string; status: CheckStatus; title: string; detail: string; fix?: FixId; rule?: Rule };

/** Which setting decides deep monitoring for one instance (first match in the documented order). */
function decide(i: Instance, s: DeepSettings): Decision {
  const info = techInfo(i.processType);
  const host = s.hostPgState.find((o) => o.scope === i.host && String(o.value.ProcessGroup ?? "") === i.pg);
  if (host?.value.MonitoringState === "MONITORING_OFF")
    return { key: "host-pg-off", status: "fail", title: "Disabled for this process group on the host", detail: "The host's Process group monitoring setting turns deep monitoring off for this process group.", fix: "host-pg-on" };
  if (host?.value.MonitoringState === "MONITORING_ON") return { key: "host-pg-on", status: "pass", title: "Set to Monitor on the host", detail: "The host's Process group monitoring setting turns deep monitoring on for this process group." };
  const pg = String(s.pgState.get(i.pg)?.value.MonitoringState ?? "DEFAULT");
  if (pg === "MONITORING_OFF") return { key: "pg-off", status: "fail", title: "Process group set to “Do not monitor”", detail: "Deep monitoring is switched off in this process group's Process group monitoring setting.", fix: "pg-on" };
  if (pg === "MONITORING_ON") return { key: "pg-on", status: "pass", title: "Process group set to Monitor", detail: "This process group is explicitly deep monitored; rules and the automatic setting do not apply." };
  const rules = s.processRules.filter((r) => r.enabled && (r.scope === i.hostGroupId || r.scope === "environment")).sort((a, b) => (a.scope === "environment" ? 1 : 0) - (b.scope === "environment" ? 1 : 0));
  const rule = rules.find((r) => evaluateRule(r, i) === "match");
  if (rule?.mode === "MONITORING_OFF") return { key: `rule:${rule.objectId}`, status: "fail", title: "Excluded by a custom monitoring rule", detail: ruleText(rule), fix: "disable-rules", rule };
  if (rule) return { key: `rule:${rule.objectId}`, status: "pass", title: "Included by a custom monitoring rule", detail: ruleText(rule), rule };
  const builtin = BUILTIN_RULES.find(([id, , item, op, v]) => builtinEnabled(s, i, id) && evaluateCondition(item, op, v, i) === "match");
  if (builtin?.[1] === "OFF") {
    return {
      key: `builtin:${builtin[0]}`,
      status: "info",
      title: `Not monitored on purpose (built-in rule ${builtin[0]})`,
      detail: `${conditionText("OFF", builtin[2], builtin[3], builtin[4])}. Built-in exclusions cover tooling and helper processes; to monitor it anyway, set the process group to Monitor or add a custom Monitor rule.`,
      fix: "pg-on",
    };
  }
  if (builtin) return { key: `builtin:${builtin[0]}`, status: "pass", title: `Included by built-in rule ${builtin[0]}`, detail: conditionText("ON", builtin[2], builtin[3], builtin[4]) };
  if (info.needsRule) return { key: "needs-rule", status: "fail", title: "No rule includes it", detail: info.needsRule, fix: "monitor-rule" };
  const auto = effectiveAutoMonitoring(s, i);
  if (!auto.on) return { key: "auto-off", status: "fail", title: "Automatic deep monitoring off", detail: `Off for the ${auto.origin}: only process groups set to Monitor or matching a Monitor rule are deep monitored.`, fix: "auto-monitoring" };
  return { key: "auto-on", status: "pass", title: "Automatic deep monitoring on", detail: `No setting excludes it, and new processes are deep monitored automatically (${auto.origin}).` };
}

export type Diagnosis = {
  instances: Instance[];
  target: Instance; // the selected process, or the first group instance without a code module
  missing: Instance[]; // instances without a code module
  support: SupportStatus;
  checks: Check[];
  // Inputs for the API fixes.
  pgObject?: Obj;
  /** Current process group monitoring state (MONITORING_ON / MONITORING_OFF / DEFAULT). */
  pgState: string;
  /** Setting the process group to Monitor would lift what blocks it (see `pgOverridable`). */
  pgOnRelevant: boolean;
  hostPgOff: Obj[];
  auto: ReturnType<typeof effectiveAutoMonitoring>;
  offRules: Rule[];
  offContainerRules: Rule[];
  container: ReturnType<typeof effectiveContainerTech>;
  switches: { tech?: SwitchState; dotnetCore?: SwitchState; goStatic?: SwitchState };
  notFullStack: Instance[];
};

/**
 * Decisions a process-group “Monitor” setting overrides: it wins over the group's own Do-not-monitor, custom and
 * built-in rules, a missing Monitor rule and the automatic setting. A host-level setting is evaluated first, so it does not.
 */
const pgOverridable = (d: Decision) =>
  d.status !== "pass" && (d.key === "pg-off" || d.key === "needs-rule" || d.key === "auto-off" || d.key.startsWith("rule:") || d.key.startsWith("builtin:"));

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const MODE_LABEL: Record<string, string> = { INFRASTRUCTURE: "Infrastructure", INFRA_ONLY: "Infrastructure", DISCOVERY: "Discovery" };
/** "1.347.64.20261021-162634" -> "1.347.64". */
export const shortVersion = (v: string) => v.split(".").slice(0, 3).join(".");

export function diagnose(instances: Instance[], s: DeepSettings): Diagnosis {
  const missing = instances.filter((i) => !i.deep);
  const target = missing[0] ?? instances[0];
  const info = techInfo(target.processType);
  const support = supportStatus(target);
  const group = instances.length > 1;
  const of = (n: number) => (group ? ` (${n} of ${plural(missing.length, "instance")} without a code module)` : "");
  const checks: Check[] = [];
  const deepCapable = info.kind === "deep";
  const relevant = deepCapable ? missing : [];

  // Which setting decides deep monitoring, per instance without a code module (grouped by outcome).
  const decisions = new Map<string, { d: Decision; n: number }>();
  for (const i of relevant) {
    const d = decide(i, s);
    const cur = decisions.get(d.key);
    decisions.set(d.key, { d, n: (cur?.n ?? 0) + 1 });
  }
  const decided = [...decisions.values()].map(({ d }) => d);
  const onPurpose = decided.length > 0 && decided.every((d) => d.key.startsWith("builtin:") && d.status !== "pass");
  const allowed = decided.length > 0 && decided.every((d) => d.status === "pass");

  // Code module present?
  if (missing.length === 0) {
    checks.push({
      id: "injected",
      status: "pass",
      title: "Deep monitored",
      detail: `${group ? `All ${plural(instances.length, "instance")} show` : "The process shows"} evidence only a OneAgent code module produces: ${target.evidence.join("; ") || "code module present"}${group ? " (first instance)" : ""}.`,
    });
  } else {
    const others = instances.length - missing.length;
    checks.push({
      id: "injected",
      status: !deepCapable || onPurpose ? "info" : "fail",
      title: "No code module injected",
      detail: `${group ? `${plural(missing.length, "instance")} of this process group show` : "This process shows"} no code-module evidence: no injecting OneAgent version, no services detected by a code module and no code-module runtime metrics, so there are no traces or code-level metrics.${group && others > 0 ? ` ${plural(others, "other instance")} of the group ${others === 1 ? "is" : "are"} deep monitored.` : ""}`,
    });
  }

  // Technology and version support.
  if (info.kind === "none") {
    checks.push({ id: "technology", status: info.alternativeKind === "system" ? "info" : "warn", title: `${info.label}: no OneAgent code module`, detail: info.alternative ?? "OneAgent has no code module for this technology.", fix: info.alternativeKind === "system" ? undefined : "alternative" });
  } else if (info.kind === "dynatrace") {
    checks.push({ id: "technology", status: "info", title: "Dynatrace component", detail: "A Dynatrace process (OneAgent or ActiveGate helper); it is not scored and needs no action." });
  } else {
    const st = support.state;
    checks.push({
      id: "technology",
      status: st === "unsupported" ? (missing.length ? "fail" : "warn") : st === "ending" || st === "limited" ? "warn" : st === "unknown" ? "info" : "pass",
      title: `${info.label}${target.version ? ` ${target.version}` : ""}${target.edition && !/null/i.test(target.edition) ? ` (${target.edition})` : ""}: ${{ supported: "supported", ending: "support ending", limited: "limited support", unsupported: "not supported", unknown: "support not confirmed" }[st]}`,
      detail: support.text,
      fix: st === "unsupported" || st === "ending" || st === "limited" ? "upgrade" : undefined,
    });
    if (support.minAgent && target.hostAgentVersion && compareVersions(target.hostAgentVersion, support.minAgent) < 0) {
      checks.push({ id: "min-agent", status: missing.length ? "fail" : "warn", title: `OneAgent ${shortVersion(target.hostAgentVersion)} is too old for this version`, detail: `${info.label} ${target.version} needs OneAgent ${support.minAgent} or later on the host.`, fix: "update-agent" });
    }
  }

  // Host monitoring mode: code modules are only injected in Full-Stack mode.
  const notFullStack = relevant.filter((i) => i.monitoringMode && i.monitoringMode !== "FULL_STACK");
  // Hosts without a reported mode (for example z/OS via zRemote) are not judged.
  if (relevant.some((i) => i.monitoringMode)) {
    const modes = [...new Set(notFullStack.map((i) => MODE_LABEL[i.monitoringMode ?? ""] ?? i.monitoringMode))].join(" / ");
    const hostCount = new Set(notFullStack.map((i) => i.host)).size;
    checks.push(
      notFullStack.length
        ? { id: "mode", status: "fail", title: "Host not in Full-Stack mode", detail: `${plural(hostCount, "host")} ${hostCount === 1 ? "runs" : "run"} OneAgent in ${modes} mode${of(notFullStack.length)}; code modules are only injected in Full-Stack mode (Infrastructure mode injects Java backing services only).`, fix: "full-stack" }
        : { id: "mode", status: "pass", title: "Host in Full-Stack mode", detail: "OneAgent on the host runs in Full-Stack mode." },
    );
  }

  // Monitored technologies switches (host, then environment).
  const switches: Diagnosis["switches"] = {};
  if (relevant.length && info.monitored) {
    const sw = effectiveSwitch(s, info.monitored, target);
    switches.tech = sw;
    checks.push(
      sw.on
        ? { id: "switch", status: "pass", title: `“${sw.sw.label}” on`, detail: `Monitored technologies (${sw.origin}).` }
        : { id: "switch", status: "fail", title: `“${sw.sw.label}” off`, detail: `Monitored technologies turns ${info.label} monitoring off (${sw.origin}${sw.origin.endsWith("(default)") ? "; off by default" : ""}).`, fix: "monitored-tech" },
    );
  }
  if (relevant.length && info.monitored?.schema === DOTNET_CORE.schema && !/framework/i.test(target.edition ?? "")) {
    const sw = effectiveSwitch(s, DOTNET_CORE, target);
    switches.dotnetCore = sw;
    if (!sw.on) checks.push({ id: "dotnet-core", status: "fail", title: "“Enable .NET Core” off", detail: `.NET Core / .NET 5+ processes are not instrumented (${sw.origin}).`, fix: "dotnet-core" });
  }

  // Process group / rules / automatic setting: the first deciding setting per instance.
  for (const { d, n } of decisions.values()) checks.push({ id: `decide-${d.key}`, status: d.status, title: d.title, detail: `${d.detail}${of(n)}`, fix: d.fix });
  // A process group / host setting decides first; Do-not-monitor rules behind it would apply if it went back to Default.
  const shadowed =
    decisions.has("pg-off") || decisions.has("host-pg-off")
      ? s.processRules.filter((r) => r.enabled && r.mode === "MONITORING_OFF" && (r.scope === "environment" || relevant.some((i) => i.hostGroupId === r.scope)) && relevant.some((i) => evaluateRule(r, i) === "match"))
      : [];
  if (shadowed.length) checks.push({ id: "rules-shadowed", status: "warn", title: `Also excluded by ${plural(shadowed.length, "custom rule")}`, detail: `${shadowed.map(ruleText).join("; ")}. Set the process group to Monitor (which wins over rules) rather than back to Default, or disable the rule.`, fix: "disable-rules" });
  const offRules = [...new Set([...decided.map((d) => d.rule).filter((r): r is Rule => !!r && r.mode === "MONITORING_OFF"), ...shadowed])];
  const unknownRules = relevant.length
    ? s.processRules.filter((r) => r.enabled && r.mode === "MONITORING_OFF" && !offRules.includes(r) && (r.scope === "environment" || relevant.some((i) => i.hostGroupId === r.scope)) && relevant.some((i) => evaluateRule(r, i) === "unknown"))
    : [];
  if (unknownRules.length) checks.push({ id: "rules-unknown", status: "info", title: `${plural(unknownRules.length, "custom rule")} could not be checked`, detail: `${unknownRules.map(ruleText).join("; ")}. The property is not in the reported process metadata (for example an environment variable); check it on the host.` });
  const hostIds = new Set(relevant.map((i) => i.host));
  const hostPgOff = s.hostPgState.filter((o) => hostIds.has(o.scope) && String(o.value.ProcessGroup ?? "") === target.pg && o.value.MonitoringState === "MONITORING_OFF");

  // Go: statically linked binaries need Go static monitoring (off by default); linkage is not reported, so this is a hint.
  if (relevant.length && target.processType === "GO") {
    const sw = effectiveSwitch(s, GO_STATIC, target);
    switches.goStatic = sw;
    if (!sw.on) checks.push({ id: "go-static", status: "warn", title: "Go static monitoring off", detail: `If the binary is statically linked (CGO_ENABLED=0, common for container and Kubernetes components), built-in rule -47 skips it until “Enable Go static application monitoring” is on (${sw.origin}) and a Monitor rule covers it.`, fix: "go-static" });
  }

  // Containers: runtime injection switch and container monitoring rules.
  const container = effectiveContainerTech(s, target);
  let offContainerRules: Rule[] = [];
  if (relevant.length && container) {
    checks.push(
      container.on
        ? { id: "container", status: "pass", title: `Injection into ${CONTAINER_LABELS[container.key]} containers on`, detail: `Container monitoring allows code modules in ${CONTAINER_LABELS[container.key]} containers (${container.origin}).` }
        : { id: "container", status: "fail", title: `Injection into ${CONTAINER_LABELS[container.key]} containers off`, detail: `Container monitoring disables code-module injection for ${CONTAINER_LABELS[container.key]} (${container.origin}${container.origin.endsWith("(default)") ? "; off by default" : ""}).`, fix: "container-tech" },
    );
    offContainerRules = s.containerRules.filter((r) => r.enabled && r.mode === "MONITORING_OFF" && relevant.some((i) => evaluateRule(r, i) === "match"));
    if (offContainerRules.length) checks.push({ id: "container-rules", status: "fail", title: `Excluded by ${plural(offContainerRules.length, "container monitoring rule")}`, detail: offContainerRules.map(ruleText).join("; "), fix: "disable-container-rules" });
  }

  // Kubernetes: the Dynatrace Operator injects at pod creation; some namespaces are excluded by default.
  const k8s = relevant.filter((i) => i.kubernetes);
  if (k8s.length) {
    const ns = [...new Set(k8s.map((i) => meta(i, "KUBERNETES_NAMESPACE")).filter(Boolean))];
    const excluded = ns.filter((n) => OPERATOR_EXCLUDED_NS.test(n));
    if (excluded.length) {
      checks.push({ id: "k8s", status: "fail", title: "Namespace not injected by default", detail: `The Dynatrace Operator does not inject into ${excluded.join(", ")} by default (kube-*, openshift-* and the Operator's namespace are excluded). Usually intentional for platform components; include the namespace only if you need its traces.`, fix: "kubernetes" });
    } else if (allowed) {
      // Settings allow injection, so the Operator side is the likely gap.
      checks.push({ id: "k8s", status: "warn", title: "Kubernetes workload", detail: `The Dynatrace Operator injects at pod creation${ns.length ? ` (namespace ${ns.slice(0, 3).join(", ")}${ns.length > 3 ? ", …" : ""})` : ""}: check the DynaKube mode and namespace selector and the pod's inject annotations, then roll out the workload.`, fix: "kubernetes", confirm: true });
    }
  }

  // CICS is instrumented by the CICS module, not by automatic injection.
  if (relevant.length && info.cics) checks.push({ id: "cics", status: "warn", title: "CICS module", detail: "CICS regions are instrumented by the Dynatrace CICS module (PLT program ZDTPLT) through the zDC and zRemote, not by OneAgent auto-injection. Check the module installation.", fix: "restart" });

  // Restart: nothing above blocks injection, so the process most likely started before OneAgent (or the change).
  const blocked = onPurpose || checks.some((c) => (c.status === "fail" || c.status === "warn") && c.id !== "injected" && c.fix !== "upgrade");
  if (relevant.length && !blocked) {
    checks.push({
      id: "restart",
      status: "warn",
      title: "Restart likely required",
      detail:
        "Nothing in the settings blocks injection. Code modules are loaded at process start, so processes started before OneAgent was installed (or before a setting changed) need a restart. This is inferred, not reported by OneAgent: confirm it on the process page first.",
      fix: "restart",
      confirm: true,
    });
  }

  // Deep monitored, but the code module is older than the host's OneAgent: a restart loads the current one.
  if (!missing.length && target.installerVersion && target.hostAgentVersion && compareVersions(target.installerVersion, target.hostAgentVersion) < 0) {
    checks.push({ id: "stale", status: "warn", title: "Code module older than OneAgent", detail: `Code module ${shortVersion(target.installerVersion)} vs OneAgent ${shortVersion(target.hostAgentVersion)} on the host. Code modules are updated when the process restarts.`, fix: "restart", confirm: true });
  }

  // Without another blocker, the missing code module is the expected state until the restart / rollout, not a blocker itself.
  const injected = checks.find((c) => c.id === "injected");
  if (injected && injected.status === "fail" && !checks.some((c) => c.status === "fail" && c.id !== "injected")) {
    injected.status = "info";
    injected.title = "No code module yet";
    injected.detail = `${injected.detail} It is loaded when the ${relevant.some((i) => i.kubernetes) ? "pod is re-created" : "process restarts"}.`;
  }

  const pgObject = s.pgState.get(target.pg);
  const pgState = String(pgObject?.value.MonitoringState ?? "DEFAULT");
  const pgOnRelevant = deepCapable && !info.cics && pgState !== "MONITORING_ON" && decided.some(pgOverridable);
  return { instances, target, missing, support, checks, pgObject, pgState, pgOnRelevant, hostPgOff, auto: effectiveAutoMonitoring(s, target), offRules, offContainerRules, container, switches, notFullStack };
}

// --- Per-process status (search results) ---------------------------------------------------

export type StatusKey = "deep" | "update" | "restart" | "operator" | "blocked" | "check" | "purpose" | "no-module" | "dynatrace";
export type StatusTone = "good" | "warn" | "bad" | "neutral";
export type ProcessStatus = { key: StatusKey; label: string; detail: string; tone: StatusTone };
export const STATUS_KEYS: { key: StatusKey; label: string }[] = [
  { key: "restart", label: "Restart required" },
  { key: "update", label: "Restart to update" },
  { key: "operator", label: "Roll out pod" },
  { key: "blocked", label: "Blocked by a setting" },
  { key: "check", label: "Check" },
  { key: "purpose", label: "Not monitored on purpose" },
  { key: "no-module", label: "No code module for the technology" },
  { key: "deep", label: "Deep monitored" },
  { key: "dynatrace", label: "Dynatrace component" },
];

/**
 * Monitoring status of one process: the code-module state combined with the settings (the same checks as Diagnose).
 * "Restart required" = no code module and nothing in the settings blocks injection, so the process started before
 * OneAgent (or before the change); "Restart to update" = deep monitored with a code module older than the host's OneAgent.
 * Grail has no per-process restart flag, so this is derived, not read.
 */
export function processStatus(i: Instance, s: DeepSettings): ProcessStatus {
  const info = techInfo(i.processType);
  const d = diagnose([i], s);
  const has = (id: string) => d.checks.find((c) => c.id === id);
  if (i.deep) {
    const stale = has("stale");
    return stale ? { key: "update", label: "Restart to update", detail: stale.detail, tone: "warn" } : { key: "deep", label: "Deep monitored", detail: i.evidence.join("; ") || "Code module present.", tone: "good" };
  }
  if (info.kind === "dynatrace") return { key: "dynatrace", label: "Dynatrace component", detail: "Not scored.", tone: "neutral" };
  if (info.kind === "none") return { key: "no-module", label: info.alternativeKind === "system" ? "Not instrumented by design" : "No code module", detail: info.alternative ?? "OneAgent has no code module for this technology.", tone: "neutral" };
  const fails = d.checks.filter((c) => c.status === "fail" && c.id !== "injected");
  if (fails.length) return { key: "blocked", label: `Blocked: ${fails[0].title}`, detail: fails.map((c) => c.title).join("; "), tone: "bad" };
  const purpose = d.checks.find((c) => c.id.startsWith("decide-builtin:") && c.status === "info");
  if (purpose) return { key: "purpose", label: "Not monitored on purpose", detail: purpose.title, tone: "neutral" };
  if (has("k8s")) return { key: "operator", label: "Roll out pod", detail: "Settings allow injection; the Dynatrace Operator injects when the pod is created.", tone: "warn" };
  const restart = has("restart");
  if (restart) return { key: "restart", label: "Restart required", detail: restart.detail, tone: "warn" };
  const warn = d.checks.find((c) => c.status === "warn");
  return { key: "check", label: `Check: ${warn?.title ?? "see Diagnose"}`, detail: warn?.detail ?? "Use Diagnose for details.", tone: "warn" };
}

// --- Monitor rule candidates ---------------------------------------------------------------

// Custom rule condition targets, most specific first. Values may not contain , : or ; (schema pattern).
const RULE_ITEMS = [
  "JAVA_JAR_FILE",
  "JAVA_MAIN_CLASS",
  "SPRINGBOOT_APP_NAME",
  "DOTNET_COMMAND",
  "IIS_APP_POOL",
  "NODEJS_APP_NAME",
  "NODEJS_SCRIPT_NAME",
  "PYTHON_SCRIPT",
  "PHP_CLI_SCRIPT_PATH",
  "RUBY_SCRIPT_PATH",
  "KUBERNETES_CONTAINERNAME",
  "KUBERNETES_BASEPODNAME",
  "EXE_PATH",
  "EXE_NAME",
];
export type RuleCandidate = { item: string; value: string; label: string };
export function ruleCandidates(i: Instance): RuleCandidate[] {
  const out: RuleCandidate[] = [];
  for (const item of RULE_ITEMS) {
    const key = normKey(item);
    const value = i.metadata[ITEM_ALIASES[key] ?? key];
    if (!value || /[;,:]/.test(value) || value.length > 1000) continue;
    out.push({ item, value, label: `${itemText(item)} equals "${value}"` });
  }
  return out;
}
export const monitorRuleBody = (scope: string, c: RuleCandidate) => [
  { schemaId: CUSTOM_RULE_SCHEMA, scope, value: { enabled: true, mode: "MONITORING_ON", condition: { item: c.item, operator: "EQUALS", value: c.value } } },
];

// --- Settings API fixes ------------------------------------------------------------------

const firstError = (res: { code: number; error?: { message?: string } }[] | undefined) => (res ?? []).find((r) => r.code >= 400);
const ok = (validateOnly: boolean, done: string): SubmitResult => ({ ok: true, message: validateOnly ? "Validation passed. Nothing was changed." : done });

/** Creates settings objects in one POST. */
export async function postObjects(body: { schemaId: string; scope: string; value: Record<string, unknown> }[], validateOnly: boolean, done: string): Promise<SubmitResult> {
  try {
    const err = firstError(await settingsObjectsClient.postSettingsObjects({ body, validateOnly }));
    if (err) return { ok: false, message: err.error?.message ?? `Rejected (HTTP ${err.code}).` };
    return ok(validateOnly, done);
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}

/** Updates existing objects (one PUT per object; the Settings API has no bulk update). */
export async function putObjects(objs: { obj: Obj; value: Record<string, unknown> }[], validateOnly: boolean, done: string): Promise<SubmitResult> {
  try {
    const res = await Promise.all(objs.map(({ obj, value }) => settingsObjectsClient.putSettingsObjectByObjectId({ objectId: obj.objectId, body: { value, updateToken: obj.updateToken }, validateOnly })));
    const failed = res.filter((r) => r && r.code >= 400);
    if (failed.length) return { ok: false, message: `${failed.length} of ${objs.length} rejected: ${failed[0]?.error?.message ?? `HTTP ${failed[0]?.code}`}` };
    return ok(validateOnly, done);
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}

/** PUT the existing object at the scope, else POST a new one (1 call either way). */
export const upsert = (schemaId: string, scope: string, existing: Obj | undefined, value: Record<string, unknown>, validateOnly: boolean, done: string) =>
  existing && existing.scope === scope ? putObjects([{ obj: existing, value }], validateOnly, done) : postObjects([{ schemaId, scope, value }], validateOnly, done);

export const pgOnBody = (pg: string) => [{ schemaId: PG_STATE_SCHEMA, scope: pg, value: { MonitoringState: "MONITORING_ON" } }];

/**
 * Enables deep monitoring for a process group: POST /settings/objects with MonitoringState = MONITORING_ON (1 call).
 * The schema allows one object per process group and the API docs do not say whether a POST replaces an existing one,
 * so when the group already has an object and the POST is rejected, the same value is written with one PUT instead.
 */
export async function enablePgDeepMonitoring(pg: string, existing: Obj | undefined, validateOnly: boolean): Promise<SubmitResult> {
  const done = "Deep monitoring enabled for the process group (Monitor). Restart its processes to inject the code module.";
  let rejected: string;
  try {
    const res = await settingsObjectsClient.postSettingsObjects({ body: pgOnBody(pg), validateOnly });
    const err = firstError(res);
    if (!err) return { ...ok(validateOnly, done), objectId: res?.[0]?.objectId };
    rejected = err.error?.message ?? `Rejected (HTTP ${err.code}).`;
  } catch (e) {
    rejected = errorMessage(e);
  }
  if (!existing) return { ok: false, message: rejected };
  const put = await putObjects([{ obj: existing, value: { MonitoringState: "MONITORING_ON" } }], validateOnly, done);
  return put.ok ? { ...put, message: `${put.message} (The group already had a setting, so it was updated with PUT.)` } : put;
}
export const setHostPgMonitoringOn = (objs: Obj[], validateOnly: boolean) =>
  putObjects(objs.map((obj) => ({ obj, value: { ...obj.value, MonitoringState: "MONITORING_ON" } })), validateOnly, `${plural(objs.length, "host setting")} set to Monitor. Restart the processes.`);
export const disableRules = (rules: Rule[], validateOnly: boolean) =>
  putObjects(rules.map((r) => ({ obj: r, value: { ...r.value, enabled: false } })), validateOnly, `${plural(rules.length, "rule")} disabled. Restart the affected processes.`);

// --- Links ---------------------------------------------------------------------------------

/** Same setting in Settings Classic, which takes the scope explicitly (intent `dynatrace.classic.settings/settings-open-settings`). */
export function settingsClassicLink(schemaId: string, scope?: string): string | undefined {
  try {
    return getIntentLink({ "dt.settings.schema": schemaId, ...(scope && scope !== "environment" ? { "dt.settings.scope": scope } : {}) }, "dynatrace.classic.settings", "settings-open-settings");
  } catch {
    return undefined;
  }
}

/** Settings page for a schema (optionally for one entity scope). Intent read from the tenant with `dtctl get intents`. */
export function settingsLink(schemaId: string, entityId?: string): string | undefined {
  try {
    return getIntentLink({ "settings.schemaId": schemaId, ...(entityId && entityId !== "environment" ? { "settings.entityId": entityId } : {}) }, "dynatrace.settings", "open_settings_for_schema");
  } catch {
    return undefined;
  }
}
