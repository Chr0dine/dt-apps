import {
  activeGatesAutoUpdateJobsClient,
  activeGatesRemoteConfigurationManagementClient,
  isRemoteConfigurationManagementValidationResultError,
  settingsObjectsClient,
} from "@dynatrace-sdk/client-classic-environment-v2";
import { httpClient } from "@dynatrace-sdk/http-client";
import { AG_OFFLINE_MINUTES } from "./queries";
import { postObjects, putObjects, type CheckStatus, type Obj } from "./deepMonitoring";
import { DOC } from "./deepTech";
import { errorMessage, type ManualAction, type SubmitResult } from "./remediation";

// ---------------------------------------------------------------------------
// ActiveGates tab model: inventory rows (Smartscape), self-monitoring (dsfm) values, module states, the diagnosis of
// one ActiveGate, and the documented fixes. Metric meanings, thresholds, commands and paths come from the ActiveGate
// docs in DOC (deepTech.ts), fetched on 2026-10-24. APIs: Settings `builtin:deployment.activegate.updates` (update
// mode; the classic auto-update configuration API is deprecated), the classic update-job API (update now), and the
// Fleet Management API (target version, ActiveGate tokens, support archives).
// ---------------------------------------------------------------------------

type Row = Record<string, any>;
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : v ? [str(v)] : []);
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const plural = (x: number, one: string, many = `${one}s`) => `${x.toLocaleString()} ${x === 1 ? one : many}`;
const list = (xs: string[], max = 4) => `${xs.slice(0, max).join(", ")}${xs.length > max ? `, … (${xs.length} in total)` : ""}`;

// --- Inventory ---------------------------------------------------------------------
export type ActiveGate = {
  /** Smartscape node ID (ACTIVEGATE-…, SYNTHETIC_ENGINE-…, ZREMOTE-…): support archives are addressed by it. */
  id: string;
  /** dt.active_gate.id (0x…): metrics, the settings scope and update jobs use it. */
  agId: string;
  name: string;
  type: string;
  group: string;
  networkZone: string;
  version: string;
  modules: string[];
  containerized: boolean;
  clusterName: string;
  clusterId?: string;
  startup: string;
  lastSeen: string;
  online: boolean;
  tokenId: string;
  extVersion: string;
  syntheticVersion: string;
  zremoteVersion: string;
  fips: boolean;
  osType: string;
  osVersion: string;
};

export function toActiveGate(r: Row): ActiveGate {
  return {
    id: str(r.id),
    agId: str(r.agId),
    name: str(r.name) || str(r.agId),
    type: str(r.type),
    group: str(r.group),
    networkZone: str(r.networkZone),
    version: str(r.version),
    modules: strings(r.modules),
    containerized: r.containerized === true || r.containerized === "true",
    clusterName: str(r.clusterName),
    clusterId: r.clusterId ? str(r.clusterId) : undefined,
    startup: str(r.startup),
    lastSeen: str(r.lastSeen),
    online: r.online === true || r.online === "true",
    tokenId: str(r.tokenId),
    extVersion: str(r.extVersion),
    syntheticVersion: str(r.syntheticVersion),
    zremoteVersion: str(r.zremoteVersion),
    fips: r.fips === true || r.fips === "true",
    osType: str(r.osType).replace(/^OS_TYPE_/, ""),
    osVersion: str(r.osVersion),
  };
}

/** Purpose of the ActiveGate, from its Smartscape node type. */
export const TYPE_LABEL: Record<string, string> = { ACTIVEGATE: "Environment ActiveGate", SYNTHETIC_ENGINE: "Synthetic", ZREMOTE: "zRemote" };
export const deploymentOf = (ag: ActiveGate) => (ag.type === "SYNTHETIC_ENGINE" ? "SYNTHETIC" : ag.type === "ZREMOTE" ? "ZREMOTE" : ag.containerized ? "KUBERNETES" : "HOST");
export const DEPLOYMENT_LABEL: Record<string, string> = { HOST: "Host-based (routing / monitoring)", KUBERNETES: "Kubernetes (Operator)", SYNTHETIC: "Synthetic", ZREMOTE: "zRemote" };

// --- Self-monitoring ---------------------------------------------------------------------
const HEALTH_KEYS = [
  "dropped",
  "rejected",
  "resent",
  "queueMax",
  "heapUsed",
  "heapAvail",
  "jvmCpu",
  "sysCpu",
  "volFree",
  "volTotal",
  "threadQueue",
  "ingestRejected",
  "otlpRejected",
  "awsLost",
  "awsBad",
  "awsEmpty",
  "awsDelay",
  "k8sEvictions",
  "eecLinesRejected",
  "eecLogsRejected",
  "awsRequests",
  "k8sQueries",
  "agents",
  "beacons",
  "restRequests",
  "grailAccepted",
  "otlpReceived",
  "eventsIn",
  "eecCpu",
  "synthUtil",
] as const;
export type HealthKey = (typeof HEALTH_KEYS)[number];
/** null = the ActiveGate reported no data point for that metric in the timeframe. */
export type AgHealth = Record<HealthKey, number | null>;

export function toHealth(r: Row): AgHealth {
  const h = {} as AgHealth;
  for (const k of HEALTH_KEYS) h[k] = numOrNull(r[k]);
  return h;
}

/** Heap used as a share of the heap size (jvm.heap_memory_available is the "heap memory size" in the docs). */
export const heapPct = (h?: AgHealth) => (h && h.heapUsed !== null && h.heapAvail ? Math.round((100 * h.heapUsed) / h.heapAvail) : null);
/** Free share of the ActiveGate's storage volume (both MiB). */
export const diskFreePct = (h?: AgHealth) => (h && h.volFree !== null && h.volTotal ? Math.round((100 * h.volFree) / h.volTotal) : null);

/** One row of the long-format module detail query. */
export type DetailRow = { agId: string; metric: string; key: string; n: number };
export const toDetail = (r: Row): DetailRow => ({ agId: str(r.agId), metric: str(r.metric), key: str(r.key), n: Number(r.n ?? 0) || 0 });

/** Kubernetes API status codes that are not errors of the ActiveGate: 403 = RBAC does not allow it, 404 on OpenShift-only APIs. */
const k8sCode = (key: string) => key.split(" ")[0];
const k8sPath = (key: string) => key.slice(key.indexOf(" ") + 1);
export const isK8sBenign = (key: string) => k8sCode(key) === "404" && k8sPath(key).includes("openshift.io");
export const isK8sForbidden = (key: string) => k8sCode(key) === "403";
export const isK8sFailure = (key: string) => !isK8sBenign(key) && !isK8sForbidden(key);

// --- Extensions ---------------------------------------------------------------------------
export type ExtConfig = {
  configId: string;
  configEntity?: string;
  extension: string;
  dataSource: string;
  status: string;
  group: string;
  agId?: string;
  message?: string;
  messageAt?: string;
  messageLevel?: string;
};

/** Configuration statuses that are not errors (Extensions health docs: every state except OK and IDLE is an error). */
export const EXT_OK = ["OK", "IDLE"];
export const extIsProblem = (c: ExtConfig) => !EXT_OK.includes(c.status);

export function toExtConfigs(statusRows: Row[], eventRows: Row[]): ExtConfig[] {
  const events = new Map(eventRows.map((e) => [str(e.configId), e]));
  return statusRows.map((r) => {
    const e = events.get(str(r.configId));
    return {
      configId: str(r.configId),
      configEntity: r.configEntity ? str(r.configEntity) : undefined,
      extension: str(r.extension),
      dataSource: str(r.dataSource),
      status: str(r.status),
      group: str(r.group),
      agId: r.agId ? str(r.agId) : undefined,
      message: e ? str(e.content) : undefined,
      messageAt: e ? str(e.timestamp) : undefined,
      messageLevel: e ? str(e.loglevel) : undefined,
    };
  });
}

/** Status meanings from the semantic dictionary (dt.extension.status); UNASSIGNED / CUSTOM_ERROR / AUTH_ERROR from the events seen on the tenant. */
export const EXT_STATUS_TEXT: Record<string, string> = {
  OK: "Running",
  IDLE: "Idle (nothing to do)",
  WARNING: "Running with warnings",
  UNASSIGNED: "Not picked up by any ActiveGate",
  GENERIC_ERROR: "Job failed",
  CUSTOM_ERROR: "Failed (extension-specific)",
  AUTH_ERROR: "Authentication failed",
  AUTHENTICATION_ERROR: "Authentication failed",
  DEVICE_CONNECTION_ERROR: "Cannot connect to the device",
  EEC_CONNECTION_ERROR: "Cannot connect to the extension controller",
  INVALID_ARGS_ERROR: "Invalid arguments",
  INVALID_CONFIG_ERROR: "Invalid configuration",
  NO_RESPONSE: "No response from the endpoint",
  UNKNOWN_ERROR: "Unknown error",
};

// --- Modules ------------------------------------------------------------------------------
export type ModuleGroup = "Routing & ingest" | "Cloud & platform" | "Extensions & databases" | "Synthetic & mainframe" | "Operations";
export const MODULE_GROUPS: ModuleGroup[] = ["Routing & ingest", "Cloud & platform", "Extensions & databases", "Synthetic & mainframe", "Operations"];

/** Inputs every module check reads (one ActiveGate). */
export type AgContext = { health?: AgHealth; detail: DetailRow[]; configs: ExtConfig[] };

export type ModuleDef = {
  /** Smartscape `modules` value. */
  id: string;
  label: string;
  short: string;
  group: ModuleGroup;
  detail: string;
  /** custom.properties section and key (configure-activegate docs). */
  section?: string;
  key?: string;
  /** agctl module name, only where the docs show it. */
  agctl?: string;
  /** Needs an installation with that purpose; cannot be switched on with a property. */
  installOnly?: boolean;
  /** Activity in the timeframe from a self-monitoring metric; undefined = no metric shows this module's activity. */
  activity?: (c: AgContext) => number | null;
  activityText?: string;
  /** Module-specific problems (empty = none). */
  issues?: (c: AgContext) => string[];
};

const sumDetail = (c: AgContext, metric: string, pick: (r: DetailRow) => boolean = () => true) => c.detail.filter((r) => r.metric === metric && pick(r)).reduce((s, r) => s + r.n, 0);

export const MODULES: ModuleDef[] = [
  {
    id: "AGENT_ROUTING",
    label: "OneAgent routing",
    short: "Routing",
    group: "Routing & ingest",
    detail: "Routes OneAgent traffic to Dynatrace.",
    section: "collector",
    key: "MSGrouter",
    agctl: "MSGrouter",
    activity: (c) => c.health?.agents ?? null,
    activityText: "connected OneAgent modules (peak)",
  },
  { id: "ODIN_COLLECTOR", label: "ODIN collector", short: "ODIN", group: "Routing & ingest", detail: "Reported by Smartscape as ODIN_COLLECTOR. No self-monitoring metric shows its activity, so it is not rated." },
  {
    id: "METRICS_INGEST",
    label: "Metrics ingest",
    short: "Metrics",
    group: "Routing & ingest",
    detail: "Metric ingest API on the ActiveGate.",
    section: "metrics_ingest",
    key: "metrics_ingest_enabled",
    agctl: "metrics_ingest",
    activity: (c) => c.health?.grailAccepted ?? null,
    activityText: "data points accepted",
    issues: (c) => (c.health?.ingestRejected ? [`${plural(c.health.ingestRejected, "data point")} rejected (${list(c.detail.filter((r) => r.metric === "metrics.rejected").map((r) => r.key), 3) || "reason not reported"})`] : []),
  },
  {
    id: "OTLP_INGEST",
    label: "OTLP ingest",
    short: "OTLP",
    group: "Routing & ingest",
    detail: "OpenTelemetry (OTLP) ingest on the ActiveGate.",
    section: "otlp_ingest",
    key: "otlp_ingest_enabled",
    agctl: "otlp_ingest",
    activity: (c) => c.health?.otlpReceived ?? null,
    activityText: "OTLP data points received",
    issues: (c) => (c.health?.otlpRejected ? [`${plural(c.health.otlpRejected, "OTLP data point")} rejected (${list(c.detail.filter((r) => r.metric === "otlp.rejected").map((r) => r.key), 3) || "reason not reported"})`] : []),
  },
  { id: "LOG_ANALYTICS_COLLECTOR", label: "Log ingest", short: "Logs", group: "Routing & ingest", detail: "Log Monitoring ingest through the ActiveGate.", section: "log_analytics_collector", key: "log_analytics_collector_enabled" },
  {
    id: "BEACON_FORWARDER",
    label: "RUM beacon forwarder",
    short: "Beacons",
    group: "Routing & ingest",
    detail: "Forwards RUM beacons.",
    section: "beacon_forwarder",
    key: "beacon_forwarder_enabled",
    activity: (c) => c.health?.beacons ?? null,
    activityText: "beacons forwarded",
  },
  {
    id: "AWS_MONITORING",
    label: "AWS monitoring",
    short: "AWS",
    group: "Cloud & platform",
    detail: "Polls CloudWatch for AWS connections. Not supported in containerized ActiveGates.",
    section: "aws_monitoring",
    key: "aws_monitoring_enabled",
    agctl: "aws_monitoring",
    activity: (c) => c.health?.awsRequests ?? null,
    activityText: "AWS API requests",
    issues: (c) => {
      const out: string[] = [];
      const lost = c.detail.filter((r) => r.metric === "aws.data_lost").map((r) => r.key);
      if (c.health?.awsLost || lost.length) out.push(`Some data lost (data_lost_monitoring_status = 1)${lost.length ? `: ${list(lost, 3)}` : ""}`);
      const total = sumDetail(c, "aws.requests");
      const failed = c.detail.filter((r) => r.metric === "aws.requests" && r.key !== "ok" && r.n > 0);
      if (failed.length) out.push(`${plural(failed.reduce((s, r) => s + r.n, 0), "failed request")} of ${total.toLocaleString()} (${failed.map((r) => `${r.key} ${r.n.toLocaleString()}`).join(", ")})`);
      if (c.health?.awsBad) out.push(`${plural(c.health.awsBad, "element")} retrieved but failed later (for example parsing)`);
      return out;
    },
  },
  { id: "AZURE_MONITORING", label: "Azure monitoring", short: "Azure", group: "Cloud & platform", detail: "Azure monitoring through the ActiveGate.", section: "azure_monitoring", key: "azure_monitoring_enabled", agctl: "azure_monitoring" },
  { id: "VMWARE_MONITORING", label: "VMware monitoring", short: "VMware", group: "Cloud & platform", detail: "VMware monitoring through the ActiveGate.", section: "vmware_monitoring", key: "vmware_monitoring_enabled" },
  { id: "CLOUD_FOUNDRY", label: "Cloud Foundry monitoring", short: "CF", group: "Cloud & platform", detail: "Cloud Foundry monitoring through the ActiveGate.", section: "cloudfoundry_monitoring", key: "cloudfoundry_monitoring_enabled" },
  {
    id: "KUBERNETES",
    label: "Kubernetes monitoring",
    short: "K8s",
    group: "Cloud & platform",
    detail: "Kubernetes API monitoring.",
    section: "kubernetes_monitoring",
    key: "kubernetes_monitoring_enabled",
    activity: (c) => c.health?.k8sQueries ?? null,
    activityText: "Kubernetes API queries",
    issues: (c) => {
      const failed = c.detail.filter((r) => r.metric === "k8s.api_errors" && isK8sFailure(r.key));
      return failed.length ? [`Kubernetes API calls failed: ${list(failed.map((r) => `${r.key} (${r.n.toLocaleString()})`), 3)}`] : [];
    },
  },
  {
    id: "EXTENSION_CONTROLLER",
    label: "Extensions (EEC)",
    short: "EEC",
    group: "Extensions & databases",
    detail: "Extension Execution Controller: runs Extensions assigned to the ActiveGate's group.",
    section: "extension_controller",
    key: "extension_controller_enabled",
    activity: (c) => c.configs.length,
    activityText: "monitoring configurations on this ActiveGate",
    issues: (c) => {
      const out: string[] = [];
      const bad = c.configs.filter(extIsProblem);
      if (bad.length) out.push(`${plural(bad.length, "monitoring configuration")} not OK: ${list(bad.map((b) => `${b.extension} (${b.status})`), 3)}`);
      const rejected = (c.health?.eecLinesRejected ?? 0) + (c.health?.eecLogsRejected ?? 0);
      if (rejected) out.push(`${plural(rejected, "metric line or log record", "metric lines or log records")} rejected at ingest`);
      return out;
    },
  },
  { id: "DBINSIGHTS_ORACLE", label: "DB insights (Oracle)", short: "DB", group: "Extensions & databases", detail: "Database insights.", section: "dbAgent", key: "dbAgent_enabled" },
  { id: "MEMORY_DUMPS", label: "Memory dumps", short: "Dumps", group: "Extensions & databases", detail: "Memory dump collection. Not supported in containerized ActiveGates.", section: "memory_dumps", key: "memory_dumps_enabled", agctl: "memory_dumps" },
  { id: "DEBUGGING", label: "Debugging", short: "Debug", group: "Extensions & databases", detail: "Debugging module.", section: "debugging", key: "debugging_enabled" },
  {
    id: "SYNTHETIC",
    label: "Synthetic monitoring",
    short: "Synth",
    group: "Synthetic & mainframe",
    detail: "Private synthetic location engine. Needs an installation with the synthetic purpose.",
    section: "synthetic",
    key: "synthetic_enabled",
    agctl: "synthetic",
    installOnly: true,
    activity: (c) => c.health?.synthUtil ?? null,
    activityText: "% engine utilization (average)",
  },
  {
    id: "ZREMOTE",
    label: "zRemote (mainframe)",
    short: "zRemote",
    group: "Synthetic & mainframe",
    detail: "Connects z/OS agents. Needs an installation with the zRemote purpose.",
    section: "zremote",
    key: "zremote_enabled",
    installOnly: true,
    activity: (c) => c.health?.agents ?? null,
    activityText: "connected agent modules (peak)",
  },
  { id: "AUTOUPDATE", label: "Auto-update service", short: "Update", group: "Operations", detail: "Installs updates on host-based ActiveGates; whether it runs is the update mode setting." },
];

export const moduleDef = (id: string): ModuleDef =>
  MODULES.find((m) => m.id === id) ?? { id, label: id.charAt(0) + id.slice(1).toLowerCase().replace(/_/g, " "), short: id.slice(0, 6), group: "Operations", detail: "Module reported by Smartscape." };

/** active = enabled with activity; idle = enabled, measurable, but no activity in the timeframe; on = enabled, not measurable. */
export type ModuleState = "active" | "idle" | "issue" | "on" | "off";
export const MODULE_STATE_LABEL: Record<ModuleState, string> = {
  active: "Enabled, in use",
  issue: "Enabled, with problems",
  idle: "Enabled, not in use",
  on: "Enabled (no activity metric)",
  off: "Not enabled",
};

export function moduleState(m: ModuleDef, ag: ActiveGate, c: AgContext): { state: ModuleState; text: string } {
  if (!ag.modules.includes(m.id)) return { state: "off", text: MODULE_STATE_LABEL.off };
  const issues = m.issues?.(c) ?? [];
  if (issues.length) return { state: "issue", text: issues.join("; ") };
  if (!m.activity) return { state: "on", text: m.detail };
  const v = m.activity(c);
  if (v && v > 0) return { state: "active", text: `${Math.round(v).toLocaleString()} ${m.activityText ?? ""}`.trim() };
  return { state: "idle", text: `Enabled, but no ${m.activityText ?? "activity"} in the timeframe: not configured for this ActiveGate yet, or not needed here.` };
}

// --- Versions -----------------------------------------------------------------------------
/** "1.347.60.20261022-192608" -> 347. Releases go up by 2 (1.343, 1.345, 1.347). */
export const minorOf = (v: string) => Number(String(v).split(".")[1]) || 0;
export const shortVersion = (v: string) => (v ? v.split(".").slice(0, 3).join(".") : "");
export const releasesBehind = (version: string, target: string) => (version && target ? Math.max(0, Math.ceil((minorOf(target) - minorOf(version)) / 2)) : null);
/** Fleet Management flags an ActiveGate that is behind by more than five versions (Update ActiveGate docs). */
export const BEHIND_WARN = 5;

export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((s) => parseInt(s, 10) || 0);
  const pb = b.split(/[.-]/).map((s) => parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

// --- Update settings (builtin:deployment.activegate.updates) -------------------------------
// Scopes: `environment` and ENVIRONMENT_ACTIVE_GATE-<16 hex digits of dt.active_gate.id>; one object per scope; an
// ActiveGate object overrides the environment one. Enum and default (AUTOMATIC, target "latest") read from the tenant
// with `dtctl describe settings-schema`. AUTOMATIC_DURING_UW also needs update windows, so the app only switches
// between AUTOMATIC and MANUAL and links to the setting for windows.
export const AG_UPDATES_SCHEMA = "builtin:deployment.activegate.updates";
export const UPDATE_MODE_LABEL: Record<string, string> = {
  AUTOMATIC: "Automatic (earliest convenience)",
  AUTOMATIC_DURING_UW: "Automatic (during update window)",
  MANUAL: "No automatic updates",
  OPERATOR: "Kubernetes: Dynatrace Operator",
  UNKNOWN: "Not read",
};
export const agScope = (agId: string) => `ENVIRONMENT_ACTIVE_GATE-${agId.replace(/^0x/i, "").toUpperCase().padStart(16, "0")}`;

export type AgUpdateSettings = { env?: Obj; byScope: Map<string, Obj> };
export type EffectiveUpdate = { mode: string; targetVersion: string; origin: "ActiveGate" | "environment" | "default"; obj?: Obj };

export async function readAgUpdateSettings(): Promise<AgUpdateSettings> {
  const items: any[] = [];
  let page = await settingsObjectsClient.getSettingsObjects({ schemaIds: AG_UPDATES_SCHEMA, fields: "objectId,scope,value,updateToken", pageSize: 500 });
  items.push(...(page.items ?? []));
  while (page.nextPageKey) {
    page = await settingsObjectsClient.getSettingsObjects({ nextPageKey: page.nextPageKey });
    items.push(...(page.items ?? []));
  }
  const out: AgUpdateSettings = { byScope: new Map() };
  for (const it of items) {
    const o: Obj = { objectId: String(it.objectId), updateToken: it.updateToken, scope: String(it.scope), value: (it.value ?? {}) as Record<string, any> };
    if (o.scope === "environment") out.env = o;
    else out.byScope.set(o.scope, o);
  }
  return out;
}

export function effectiveUpdate(ag: ActiveGate, s: AgUpdateSettings): EffectiveUpdate {
  const own = s.byScope.get(agScope(ag.agId));
  const pick = (o: Obj | undefined, origin: EffectiveUpdate["origin"]): EffectiveUpdate => ({ mode: str(o?.value.updateMode) || "AUTOMATIC", targetVersion: str(o?.value.targetVersion) || "latest", origin, obj: o });
  if (own) return pick(own, "ActiveGate");
  if (s.env) return pick(s.env, "environment");
  return pick(undefined, "default");
}

/** Auto-update and one-click update only apply to host-based installations (Update ActiveGate docs). */
export const updatable = (ag: ActiveGate) => !ag.containerized;

export type UpdatePlan = { post: { schemaId: string; scope: string; value: Record<string, unknown> }[]; put: { obj: Obj; value: Record<string, unknown> }[] };

/** One POST for scopes without an object, one PUT per existing object (the Settings API has no bulk update). Keeps a pinned target version. */
export function updatePlan(scopes: string[], s: AgUpdateSettings, mode: "AUTOMATIC" | "MANUAL"): UpdatePlan {
  const plan: UpdatePlan = { post: [], put: [] };
  for (const scope of [...new Set(scopes)]) {
    const existing = scope === "environment" ? s.env : s.byScope.get(scope);
    const value = { updateMode: mode, targetVersion: str(existing?.value.targetVersion) || "latest" };
    if (existing) {
      if (existing.value.updateMode !== mode) plan.put.push({ obj: existing, value });
    } else plan.post.push({ schemaId: AG_UPDATES_SCHEMA, scope, value });
  }
  return plan;
}
export const planCalls = (p: UpdatePlan) => (p.post.length ? 1 : 0) + p.put.length;

export async function applyUpdatePlan(p: UpdatePlan, validateOnly: boolean, done: string): Promise<SubmitResult> {
  if (planCalls(p) === 0) return { ok: true, message: "Nothing to change: every selected scope already has this update mode." };
  if (p.post.length) {
    const r = await postObjects(p.post, validateOnly, done);
    if (!r.ok) return r;
  }
  return p.put.length ? putObjects(p.put, validateOnly, done) : { ok: true, message: validateOnly ? "Validation passed. Nothing was changed." : done };
}

// --- ActiveGate groups and network zones --------------------------------------------------------
// Network zones are Settings objects: `builtin:networkzones.zones` (environment scope, one object per zone: id,
// description, alternativeZones, fallbackMode) and `builtin:networkzones` (enabled; schema default false). The classic
// network zones API is deprecated. The default zone cannot be modified (schema validator). Fallback (OneAgent
// connectivity docs): Any ActiveGate = priority groups 1-4 (same zone, alternative zones, default zone, all others),
// Only default zone = 1-3, None = 1-2. Group and zone of host-based ActiveGates 1.237+ can be set with ONE remote
// configuration job for many ActiveGates (no restart, up to 10 minutes; containerized ActiveGates are not supported).
export const ZONES_SCHEMA = "builtin:networkzones.zones";
export const ZONES_ENABLE_SCHEMA = "builtin:networkzones";
export const DEFAULT_ZONE = "default";
export type FallbackMode = "ANY_ACTIVE_GATE" | "ONLY_DEFAULT_ZONE" | "NONE";
export const FALLBACK_MODES: FallbackMode[] = ["ANY_ACTIVE_GATE", "ONLY_DEFAULT_ZONE", "NONE"];
export const FALLBACK_LABEL: Record<string, string> = { ANY_ACTIVE_GATE: "Any ActiveGate", ONLY_DEFAULT_ZONE: "Only default zone", NONE: "None (drop traffic)" };
export const FALLBACK_TEXT: Record<string, string> = {
  ANY_ACTIVE_GATE: "When no ActiveGate of the zone or its alternative zones is available, traffic goes to any available ActiveGate, including the default zone.",
  ONLY_DEFAULT_ZONE: "When no ActiveGate of the zone or its alternative zones is available, traffic goes only to the default zone; ActiveGates in other zones are not used.",
  NONE: "Traffic stays within the zone and its alternative zones; when none of their ActiveGates is available, OneAgents send no data to another zone.",
};
/** Network zone names: lowercase alphanumerics, hyphens, underscores and dots, not starting with a dot, at most 256 (schema constraint). */
export const ZONE_RE = /^[a-z0-9-_][a-z0-9-_.]{0,255}$/;
const zoneKey = (z: string) => (z || DEFAULT_ZONE).toLowerCase();

export type ZoneSettings = { enabled: boolean; enabledObj?: Obj; zones: Map<string, Obj> };

/** Both network zone schemas in one paged GET. */
export async function readNetworkZones(): Promise<ZoneSettings> {
  const items: any[] = [];
  let page = await settingsObjectsClient.getSettingsObjects({ schemaIds: `${ZONES_SCHEMA},${ZONES_ENABLE_SCHEMA}`, scopes: "environment", fields: "objectId,schemaId,scope,value,updateToken", pageSize: 500 });
  items.push(...(page.items ?? []));
  while (page.nextPageKey) {
    page = await settingsObjectsClient.getSettingsObjects({ nextPageKey: page.nextPageKey });
    items.push(...(page.items ?? []));
  }
  const out: ZoneSettings = { enabled: false, zones: new Map() };
  for (const it of items) {
    const o: Obj = { objectId: String(it.objectId), updateToken: it.updateToken, scope: String(it.scope), value: (it.value ?? {}) as Record<string, any> };
    if (it.schemaId === ZONES_ENABLE_SCHEMA) {
      out.enabledObj = o;
      out.enabled = o.value.enabled === true;
    } else out.zones.set(zoneKey(str(o.value.id)), o);
  }
  return out;
}

export type ZoneRow = {
  zone: string;
  /** A settings object exists for the zone (otherwise the schema defaults apply). */
  configured: boolean;
  fallback: string;
  alternatives: string[];
  ags: ActiveGate[];
  online: number;
  oneAgents: number;
  status: CheckStatus;
  note: string;
};

/** One row per zone that is configured, or used by an ActiveGate or a OneAgent. */
export function zoneRows(ags: ActiveGate[], oneAgents: Map<string, number>, s?: ZoneSettings): ZoneRow[] {
  const names = new Set<string>([...ags.map((a) => zoneKey(a.networkZone)), ...oneAgents.keys(), ...(s ? s.zones.keys() : [])].map(zoneKey));
  const onlineIn = (z: string) => ags.filter((a) => zoneKey(a.networkZone) === z && a.online).length;
  const rows: ZoneRow[] = [];
  for (const zone of names) {
    const obj = s?.zones.get(zone);
    const fallback = s ? str(obj?.value.fallbackMode) || "ANY_ACTIVE_GATE" : "";
    const alternatives = strings(obj?.value.alternativeZones).map(zoneKey);
    const zoneAgs = ags.filter((a) => zoneKey(a.networkZone) === zone);
    const online = onlineIn(zone);
    const agents = oneAgents.get(zone) ?? 0;
    const altOnline = alternatives.reduce((n, z) => n + onlineIn(z), 0);
    let status: CheckStatus = "pass";
    let note = s ? `Fallback ${FALLBACK_LABEL[fallback] ?? fallback}${obj ? "" : " (not configured: schema default)"}.` : "Fallback not read.";
    if (agents > 0 && online === 0) {
      if (fallback === "NONE" && altOnline === 0) {
        status = "fail";
        note = `${plural(agents, "OneAgent")} in this zone, no connected ActiveGate in it or its alternative zones, and fallback None: their traffic is dropped.`;
      } else if (fallback === "ONLY_DEFAULT_ZONE" && altOnline === 0 && onlineIn(DEFAULT_ZONE) === 0) {
        status = "fail";
        note = `${plural(agents, "OneAgent")} in this zone, no connected ActiveGate in it, its alternative zones or the default zone (fallback Only default zone).`;
      } else {
        status = "info";
        note = `${plural(agents, "OneAgent")}, no connected ActiveGate in the zone: they use ${altOnline ? "the alternative zones" : fallback === "ONLY_DEFAULT_ZONE" ? "the default zone" : "ActiveGates of other zones"} (fallback ${FALLBACK_LABEL[fallback] ?? "not read"}).`;
      }
    } else if (zoneAgs.length > 0 && online === 0) {
      status = "warn";
      note = `No ActiveGate of the zone is connected. ${note}`;
    } else if (fallback === "NONE") {
      status = "info";
      note = `Fallback None: ${FALLBACK_TEXT.NONE}`;
    } else if (s && !obj && zone !== DEFAULT_ZONE) {
      status = "info";
    } else if (zoneAgs.length === 0 && agents === 0) {
      status = "info";
      note = `Configured, but no ActiveGate or OneAgent uses it. ${note}`;
    }
    rows.push({ zone, configured: !!obj, fallback, alternatives, ags: zoneAgs, online, oneAgents: agents, status, note });
  }
  const rank: CheckStatus[] = ["fail", "warn", "info", "pass"];
  return rows.sort((a, b) => rank.indexOf(a.status) - rank.indexOf(b.status) || b.ags.length - a.ags.length || a.zone.localeCompare(b.zone));
}

export type GroupRow = { group: string; ags: ActiveGate[]; eec: number; configs: number; problems: number; unassigned: number; zones: string[]; status: CheckStatus; note: string };

/** One row per ActiveGate group (from the ActiveGates and from extension configurations that target a group). */
export function groupRows(ags: ActiveGate[], configs: ExtConfig[]): GroupRow[] {
  const names = new Set([...ags.map((a) => a.group).filter(Boolean), ...configs.map((c) => c.group).filter(Boolean)]);
  const rows: GroupRow[] = [...names].map((group) => {
    const members = ags.filter((a) => a.group === group);
    const eec = members.filter((a) => a.modules.includes("EXTENSION_CONTROLLER")).length;
    const cs = configs.filter((c) => c.group === group);
    const unassigned = cs.filter((c) => c.status === "UNASSIGNED").length;
    const problems = cs.filter(extIsProblem).length;
    let status: CheckStatus = "pass";
    let note = cs.length ? `${plural(cs.length, "extension configuration")} target this group.` : "No extension configuration targets this group.";
    if (cs.length && members.length === 0) {
      status = "fail";
      note = `${plural(cs.length, "extension configuration")} target this group, but no ActiveGate is in it.`;
    } else if (cs.length && eec === 0) {
      status = "fail";
      note = `${plural(cs.length, "extension configuration")} target this group, but no ActiveGate in it has the Extensions module.`;
    } else if (unassigned) {
      status = "fail";
      note = `${plural(unassigned, "configuration")} not picked up by any of the ${plural(eec, "ActiveGate")} with the Extensions module.`;
    } else if (problems) {
      status = "warn";
      note = `${plural(problems, "configuration")} not OK.`;
    }
    return { group, ags: members, eec, configs: cs.length, problems, unassigned, zones: [...new Set(members.map((a) => zoneKey(a.networkZone)))], status, note };
  });
  const rank: CheckStatus[] = ["fail", "warn", "info", "pass"];
  return rows.sort((a, b) => rank.indexOf(a.status) - rank.indexOf(b.status) || b.ags.length - a.ags.length || a.group.localeCompare(b.group));
}

/** Remote configuration only works for host-based ActiveGates (bulk configuration docs: containerized ones are not supported). */
export const remotelyConfigurable = (ag: ActiveGate) => !ag.containerized;
export type RemoteAttr = "group" | "networkZone";
export const REMOTE_ATTR_LABEL: Record<RemoteAttr, string> = { group: "ActiveGate group", networkZone: "Network zone" };

export function checkRemoteValue(attr: RemoteAttr, op: "set" | "clear", value: string): string | null {
  if (op === "clear") return null;
  const v = value.trim();
  if (!v) return `Enter the ${REMOTE_ATTR_LABEL[attr].toLowerCase()}.`;
  if (attr === "networkZone" && !ZONE_RE.test(v.toLowerCase())) return "Network zone names use lowercase alphanumerics, hyphens, underscores and dots, must not start with a dot, and have at most 256 characters.";
  if (v.length > 256) return "At most 256 characters.";
  return null;
}

export type RemotePlan = { ok: boolean; message: string; valid: string[]; invalid: { entity: string; reasons: string[] }[]; preview?: { alreadyConfigured: number; target: number } };
const remoteOps = (attr: RemoteAttr, op: "set" | "clear", value: string) => [{ attribute: attr, operation: op, ...(op === "set" ? { value: attr === "networkZone" ? value.trim().toLowerCase() : value.trim() } : {}) }];

/** Validates (dropping ActiveGates the API rejects, once) and previews. Changes nothing. */
export async function planAgRemoteConfig(agIds: string[], attr: RemoteAttr, op: "set" | "clear", value: string): Promise<RemotePlan> {
  let valid = [...agIds];
  let invalid: RemotePlan["invalid"] = [];
  const operations = remoteOps(attr, op, value);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await activeGatesRemoteConfigurationManagementClient.validateRemoteIdentityOperation({ body: { entities: valid, operations } });
        break;
      } catch (e) {
        if (attempt === 0 && isRemoteConfigurationManagementValidationResultError(e)) {
          const data = (e as any).data ?? {};
          const badOps = data.invalidOperations ?? [];
          if (badOps.length) return { ok: false, message: `Rejected: ${badOps[0]?.reason ?? "invalid operation"}`, valid: [], invalid };
          invalid = (data.invalidEntities ?? []).map((b: any) => ({ entity: b.entity ?? "?", reasons: b.reasons ?? [] }));
          const bad = new Set(invalid.map((b) => b.entity));
          valid = valid.filter((id) => !bad.has(id));
          if (valid.length === 0) return { ok: false, message: "No selected ActiveGate accepts this change.", valid, invalid };
          continue;
        }
        throw e;
      }
    }
    const pv = await activeGatesRemoteConfigurationManagementClient.createRemoteIdentityOperationPreview({ body: { entities: valid, operations } });
    const p = pv.previews?.[0];
    return {
      ok: true,
      message: `Validation passed: ${plural(valid.length, "ActiveGate")} can be changed${invalid.length ? `, ${invalid.length} skipped` : ""}. Nothing was changed.`,
      valid,
      invalid,
      preview: p ? { alreadyConfigured: p.alreadyConfiguredEntitiesCount ?? 0, target: p.targetEntitiesCount ?? valid.length } : undefined,
    };
  } catch (e) {
    return { ok: false, message: fleetError(e, "fleet-management:activegates:write"), valid: [], invalid };
  }
}

/** Starts the single remote configuration job. Only one bulk action can run at a time. */
export async function runAgRemoteConfig(agIds: string[], attr: RemoteAttr, op: "set" | "clear", value: string): Promise<SubmitResult> {
  try {
    const job = await activeGatesRemoteConfigurationManagementClient.createRemoteIdentityOperationJob({ body: { entities: agIds, operations: remoteOps(attr, op, value) } });
    return { ok: true, message: `Job started for ${plural(job.totalEntitiesCount ?? agIds.length, "ActiveGate")}. No restart is needed; changes take up to 10 minutes.`, objectId: job.id };
  } catch (e) {
    const status = (e as any)?.response?.status ?? (e as any)?.status;
    if (status === 409) return { ok: false, message: "Another remote configuration job is already running. Try again when it finishes." };
    return { ok: false, message: fleetError(e, "fleet-management:activegates:write") };
  }
}

/** Value for a zone's settings object: the existing one with the new fallback and alternatives, or a new object. */
export function zoneValue(zone: string, s: ZoneSettings, fallback: FallbackMode, alternatives: string[]) {
  const existing = s.zones.get(zoneKey(zone));
  return { existing, value: { ...(existing?.value ?? { id: zoneKey(zone) }), fallbackMode: fallback, alternativeZones: alternatives.map(zoneKey) } };
}

export async function applyZoneFallback(zone: string, s: ZoneSettings, fallback: FallbackMode, alternatives: string[], validateOnly: boolean): Promise<SubmitResult> {
  if (zoneKey(zone) === DEFAULT_ZONE) return { ok: false, message: "The default network zone cannot be modified." };
  const { existing, value } = zoneValue(zone, s, fallback, alternatives);
  const done = `Network zone ${zoneKey(zone)}: fallback ${FALLBACK_LABEL[fallback]}${alternatives.length ? `, alternative zones ${alternatives.join(", ")}` : ""}.`;
  return existing ? putObjects([{ obj: existing, value }], validateOnly, done) : postObjects([{ schemaId: ZONES_SCHEMA, scope: "environment", value }], validateOnly, done);
}

export async function enableNetworkZones(s: ZoneSettings, validateOnly: boolean): Promise<SubmitResult> {
  const done = "Network zones turned on for the environment.";
  return s.enabledObj
    ? putObjects([{ obj: s.enabledObj, value: { ...s.enabledObj.value, enabled: true } }], validateOnly, done)
    : postObjects([{ schemaId: ZONES_ENABLE_SCHEMA, scope: "environment", value: { enabled: true } }], validateOnly, done);
}

// --- Routing through network zones (what the zone map draws) --------------------------------------
// OneAgent connectivity docs: OneAgents try ActiveGates in priority groups, lowest first, and are load-balanced within
// the first group that has an available ActiveGate: 1 same zone, 2 alternative zones, 3 default zone, 4 all others.
// The fallback mode limits the groups: Any ActiveGate 1-4, Only default zone 1-3, None 1-2 (else the traffic is
// dropped). Only ActiveGates with OneAgent routing (module AGENT_ROUTING, [collector] MSGrouter) take OneAgent traffic.
export const routesOneAgents = (ag: ActiveGate) => ag.modules.includes("AGENT_ROUTING");
export const FALLBACK_GROUPS: Record<string, number[]> = { ANY_ACTIVE_GATE: [1, 2, 3, 4], ONLY_DEFAULT_ZONE: [1, 2, 3], NONE: [1, 2] };
export const PRIORITY_LABEL: Record<number, string> = { 1: "Same zone", 2: "Alternative zones", 3: "Default zone", 4: "Any other ActiveGate" };

export type PriorityGroup = {
  prio: 1 | 2 | 3 | 4;
  label: string;
  zones: string[];
  /** Every ActiveGate in the group (first group wins when one would be in two). */
  ags: ActiveGate[];
  /** Connected, OneAgent routing on, and not failed in the simulation. */
  available: ActiveGate[];
  /** The zone's fallback mode lets OneAgents use this group. */
  allowed: boolean;
  /** Group 3 of the default zone is group 1 again. */
  sameAsFirst?: boolean;
};
export type RoutingPlan = { zone: string; fallback: string; groups: PriorityGroup[]; target: PriorityGroup | null; dropped: boolean };

export function routingPlan(zone: string, rows: ZoneRow[], ags: ActiveGate[], failed: ReadonlySet<string>, fallbackOverride?: string): RoutingPlan {
  const z = zoneKey(zone);
  const row = rows.find((r) => r.zone === z);
  const fallback = fallbackOverride || row?.fallback || "ANY_ACTIVE_GATE";
  const allowed = FALLBACK_GROUPS[fallback] ?? FALLBACK_GROUPS.ANY_ACTIVE_GATE;
  const alternatives = (row?.alternatives ?? []).filter((a) => a !== z);
  const usable = (a: ActiveGate) => a.online && routesOneAgents(a) && !failed.has(a.agId);
  const taken = new Set<string>();
  const group = (prio: 1 | 2 | 3 | 4, zones: string[] | null, sameAsFirst = false): PriorityGroup => {
    const members = sameAsFirst ? [] : ags.filter((a) => !taken.has(a.agId) && (zones === null || zones.includes(zoneKey(a.networkZone))));
    members.forEach((a) => taken.add(a.agId));
    return { prio, label: PRIORITY_LABEL[prio], zones: zones ?? [], ags: members, available: members.filter(usable), allowed: allowed.includes(prio), sameAsFirst };
  };
  const groups = [group(1, [z]), group(2, alternatives), group(3, [DEFAULT_ZONE], z === DEFAULT_ZONE), group(4, null)];
  const target = groups.find((g) => g.allowed && g.available.length > 0) ?? null;
  return { zone: z, fallback, groups, target, dropped: !target };
}

// --- Update job (update now) -----------------------------------------------------------------
// POST /api/v2/activeGates/{agId}/updateJobs with targetVersion "latest" (the job API is not deprecated; it has a validate
// endpoint). Scopes: fleet-management:activegates:read / :write.
export type UpdateJobInfo = { state: string; startVersion: string; targetVersion: string; method: string; error: string; timestamp?: number };

export async function runUpdateJob(agId: string, validateOnly: boolean): Promise<SubmitResult> {
  const body = { targetVersion: "latest", updateType: "ACTIVE_GATE" as const };
  try {
    if (validateOnly) {
      await activeGatesAutoUpdateJobsClient.validateUpdateJobForAg({ agId, body });
      return { ok: true, message: "Validation passed: the ActiveGate accepts an update job to the latest version. Nothing was started." };
    }
    const job = await activeGatesAutoUpdateJobsClient.createUpdateJobForAg({ agId, body });
    return { ok: true, message: `Update job ${(job.jobState ?? "created").toLowerCase()}: ${shortVersion(job.startVersion ?? "") || "current version"} → ${job.targetVersion}. The version on this tab changes once the ActiveGate reports the new one.`, objectId: job.jobId };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}

export async function readLastUpdateJobs(agId: string): Promise<UpdateJobInfo[]> {
  const res = await activeGatesAutoUpdateJobsClient.getUpdateJobListByAgId({ agId, lastUpdates: true });
  return (res.updateJobs ?? []).map((j) => ({ state: str(j.jobState), startVersion: str(j.startVersion), targetVersion: str(j.targetVersion), method: str(j.updateMethod), error: str(j.error), timestamp: j.timestamp }));
}

// --- Fleet Management API (target version, tokens, support archives) -----------------------
const FLEET = "/platform/fleet-management/v1";

/** Readable message for a failed API call; 403 names the scope to add. */
export function fleetError(e: unknown, scope: string): string {
  const status = (e as any)?.response?.status ?? (e as any)?.status;
  if (status === 403) return `Access denied (HTTP 403): the app needs the scope ${scope} and you need the matching permission.`;
  if (status === 404) return "Not found (HTTP 404).";
  return errorMessage(e);
}

async function fleetJson<T>(path: string, init: { method?: "GET" | "POST" | "DELETE"; body?: unknown } = {}): Promise<T> {
  const res = await httpClient.send({
    url: `${FLEET}${path}`,
    method: init.method ?? "GET",
    ...(init.body !== undefined ? { requestBodyType: "json" as const, body: init.body, headers: { "Content-Type": "application/json; charset=utf-8" } } : {}),
  });
  if (res.status === 204) return undefined as T;
  return (await res.body("json")) as T;
}

/** Target version configured for the tenant, else the latest available (scope fleet-management:activegates:download; nothing is downloaded). */
export async function readTargetVersion(): Promise<string> {
  const r = await fleetJson<{ version?: string }>("/activegate/installer/version/target");
  return str(r?.version);
}

export type AgToken = { id: string; name: string; owner: string; creationDate: string; expirationDate?: string; lastUsedDate?: string; seedToken: boolean };

/** Every ActiveGate token's metadata (scope fleet-management:activegate.tokens:read); Smartscape carries each ActiveGate's token ID. */
export async function readAgTokens(): Promise<Map<string, AgToken>> {
  const out = new Map<string, AgToken>();
  let key: string | undefined;
  do {
    const r: any = await fleetJson(`/activegate/tokens${key ? `?page-key=${encodeURIComponent(key)}` : "?page-size=3000"}`);
    for (const t of r?.activeGateTokens ?? []) {
      out.set(str(t.id), { id: str(t.id), name: str(t.name), owner: str(t.owner), creationDate: str(t.creationDate), expirationDate: t.expirationDate ? str(t.expirationDate) : undefined, lastUsedDate: t.lastUsedDate ? str(t.lastUsedDate) : undefined, seedToken: t.seedToken === true });
    }
    key = r?.nextPageKey ?? undefined;
  } while (key);
  return out;
}

/** Days until the token expires (negative = expired); null = never expires. */
export const tokenDaysLeft = (t: AgToken, now = Date.now()) => (t.expirationDate ? Math.floor((Date.parse(t.expirationDate) - now) / 86_400_000) : null);
/** ActiveGate security docs: a token is Expiring with 30 or fewer days left. */
export const TOKEN_EXPIRING_DAYS = 30;

export type SupportArchive = { id: string; description: string; lookbackDays: number; status: string; collectedBy: string; collectionTimestamp?: string; sizeKb?: number };

export const ARCHIVE_STATUS_LABEL: Record<string, string> = {
  COLLECT_IN_PROGRESS: "Collecting",
  COLLECTED: "Collected",
  COLLECT_ERROR: "Collection failed",
  CANCELED: "Canceled",
  SENDING_IN_PROGRESS: "Sending to Dynatrace",
  SENT_TO_DYNATRACE_CLOUD: "Sent to Dynatrace",
  SENDING_FAILED: "Sending failed",
  ANALYZING_ARCHIVE: "Analyzing",
  ANALYZING_DONE: "Analyzed",
  ANALYZING_FAILED: "Analysis failed",
  REANALYZING_NEEDED: "Re-analysis needed",
  MANUAL_CLEANUP: "Manual cleanup",
  DELETE_IN_PROGRESS: "Deleting",
  DELETED: "Deleted",
  DELETE_ERROR: "Delete failed",
};
const NOT_DOWNLOADABLE = ["COLLECT_IN_PROGRESS", "COLLECT_ERROR", "CANCELED", "DELETE_IN_PROGRESS", "DELETED", "DELETE_ERROR"];
export const archiveDownloadable = (a: SupportArchive) => !!a.collectionTimestamp && !NOT_DOWNLOADABLE.includes(a.status);
export const archiveFailed = (a: SupportArchive) => ["COLLECT_ERROR", "SENDING_FAILED", "ANALYZING_FAILED", "DELETE_ERROR"].includes(a.status);
export const archiveRunning = (a: SupportArchive) => a.status === "COLLECT_IN_PROGRESS" || a.status === "DELETE_IN_PROGRESS";

const toArchive = (a: any): SupportArchive => ({
  id: str(a.id),
  description: str(a.description),
  lookbackDays: Number(a.lookbackDays ?? 0) || 0,
  status: str(a.resourceStatus?.status),
  collectedBy: str(a.collectedBy),
  collectionTimestamp: a.collectionTimestamp ? str(a.collectionTimestamp) : undefined,
  sizeKb: a.sizeKb !== undefined && a.sizeKb !== null ? Number(a.sizeKb) : undefined,
});
const archivePath = (nodeId: string, id?: string) => `/activegate/support-archives/${encodeURIComponent(nodeId)}${id ? `/${encodeURIComponent(id)}` : ""}`;

export async function listSupportArchives(nodeId: string): Promise<SupportArchive[]> {
  const r: any = await fleetJson(`${archivePath(nodeId)}?page-size=100`);
  return (r?.items ?? []).map(toArchive).sort((a: SupportArchive, b: SupportArchive) => (b.collectionTimestamp ?? "9").localeCompare(a.collectionTimestamp ?? "9"));
}

/** Starts the collection (1–7 days of logs). Valid node types: ACTIVEGATE, SYNTHETIC_ENGINE, ZREMOTE. */
export async function startSupportArchive(nodeId: string, description: string, lookbackDays: number): Promise<SubmitResult> {
  try {
    const r = await fleetJson<{ id?: string }>(archivePath(nodeId), { method: "POST", body: { description: description.trim(), lookbackDays } });
    return { ok: true, message: "Collection started. The ActiveGate gathers its logs and configuration; this list refreshes until it finishes.", objectId: r?.id };
  } catch (e) {
    return { ok: false, message: fleetError(e, "fleet-management:activegate.support-archives:write") };
  }
}

/** Cancels a running collection or deletes a finished archive. */
export async function deleteSupportArchive(nodeId: string, id: string): Promise<SubmitResult> {
  try {
    await fleetJson(archivePath(nodeId, id), { method: "DELETE" });
    return { ok: true, message: "Archive canceled or deleted." };
  } catch (e) {
    return { ok: false, message: fleetError(e, "fleet-management:activegate.support-archives:delete") };
  }
}

/** Downloads the ZIP through the app session and saves it in the browser. */
export async function downloadSupportArchive(nodeId: string, a: SupportArchive, agName: string): Promise<SubmitResult> {
  try {
    const res = await httpClient.send({ url: `${FLEET}${archivePath(nodeId, a.id)}:download`, method: "GET" });
    const blob = await res.body("blob");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `activegate-${agName.replace(/[^A-Za-z0-9._-]+/g, "_")}-${a.id}.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return { ok: true, message: `Downloaded ${link.download}.` };
  } catch (e) {
    return { ok: false, message: fleetError(e, "fleet-management:activegate.support-archives:download") };
  }
}

// --- Diagnosis ----------------------------------------------------------------------------
export type AgFix =
  | "connectivity"
  | "update"
  | "update-k8s"
  | "auto-update"
  | "token"
  | "rejected"
  | "dropped"
  | "resources"
  | "module"
  | "aws"
  | "k8s"
  | "extensions"
  | "ingest"
  | "group"
  | "zone";
export type AgCheck = { id: string; status: CheckStatus; title: string; detail: string; fix?: AgFix; module?: string };

export type DiagnoseInput = {
  ctx: AgContext;
  /** Configurations assigned to this ActiveGate's group that no ActiveGate picked up (only for ActiveGates with the Extensions module). */
  unassigned: ExtConfig[];
  target: string;
  update?: EffectiveUpdate;
  token?: AgToken | null;
  group?: GroupRow;
  zone?: ZoneRow;
  /** undefined = the network zone settings were not read. */
  zonesEnabled?: boolean;
  now?: number;
};

const since = (iso: string, now: number) => {
  const min = Math.round((now - Date.parse(iso)) / 60_000);
  return min < 120 ? `${min} minutes` : min < 2880 ? `${Math.round(min / 60)} hours` : `${Math.round(min / 1440)} days`;
};

export function diagnoseActiveGate(ag: ActiveGate, d: DiagnoseInput): AgCheck[] {
  const now = d.now ?? Date.now();
  const h = d.ctx.health;
  const checks: AgCheck[] = [];

  // 1. Connectivity (Fleet Management: critical when connectivity is lost).
  checks.push(
    ag.online
      ? { id: "online", status: "pass", title: "Connected", detail: `Reported to Smartscape within the last ${AG_OFFLINE_MINUTES} minutes${ag.startup ? `; running since ${ag.startup.slice(0, 10)}` : ""}.` }
      : { id: "online", status: "fail", title: `Not connected for ${since(ag.lastSeen, now)}`, detail: `Last seen ${ag.lastSeen.slice(0, 16).replace("T", " ")} UTC. The ActiveGate sends no data until it reconnects.`, fix: "connectivity" },
  );

  // 2. Version against the tenant's target version.
  const behind = releasesBehind(ag.version, d.target);
  if (behind === null) checks.push({ id: "version", status: "info", title: `Version ${shortVersion(ag.version) || "unknown"}`, detail: "The target version could not be read, so the version is not compared." });
  else if (behind > BEHIND_WARN) checks.push({ id: "version", status: "warn", title: `${behind} releases behind the target version`, detail: `${shortVersion(ag.version)} vs target ${shortVersion(d.target)}. Fleet Management warns when an ActiveGate is behind by more than five versions; old versions fall out of the supported range.`, fix: ag.containerized ? "update-k8s" : "update" });
  else if (behind > 0) checks.push({ id: "version", status: "info", title: `Update available (${plural(behind, "release")} behind)`, detail: `${shortVersion(ag.version)} → ${shortVersion(d.target)}.`, fix: ag.containerized ? "update-k8s" : "update" });
  else checks.push({ id: "version", status: "pass", title: "On the target version", detail: `${shortVersion(ag.version)} (target ${shortVersion(d.target)}).` });

  // 3. Update mode (host-based only; the Operator updates containerized ActiveGates).
  if (!updatable(ag)) {
    checks.push({ id: "auto-update", status: "info", title: "Updated by the Dynatrace Operator", detail: "Containerized: the ActiveGate target version configured in Dynatrace decides the image unless the DynaKube pins spec.activeGate.image. Fleet Management auto-update does not apply." });
  } else if (d.update) {
    checks.push(
      d.update.mode === "MANUAL"
        ? { id: "auto-update", status: "warn", title: "Automatic updates off", detail: `Update mode "${UPDATE_MODE_LABEL.MANUAL}" from the ${d.update.origin === "ActiveGate" ? "ActiveGate's own setting" : `${d.update.origin} setting`}. The docs do not recommend it: ActiveGates can fall out of the supported version range.`, fix: "auto-update" }
        : { id: "auto-update", status: "pass", title: UPDATE_MODE_LABEL[d.update.mode] ?? d.update.mode, detail: `Target ${d.update.targetVersion}, from the ${d.update.origin === "ActiveGate" ? "ActiveGate's own setting" : `${d.update.origin} setting`}.` },
    );
  }

  // 4. Token (ActiveGate security: Expiring = 30 days or less; the ActiveGate disconnects when it expires).
  if (d.token === null) checks.push({ id: "token", status: "info", title: "Token not in the token list", detail: `${ag.tokenId || "No token ID"} is not an ActiveGate token of this environment (for example a tenant token), so its expiry cannot be checked.`, fix: "token" });
  else if (d.token) {
    const days = tokenDaysLeft(d.token, now);
    if (days === null) checks.push({ id: "token", status: "pass", title: "Token never expires", detail: `${d.token.id} (${d.token.name}).` });
    else if (days < 0) checks.push({ id: "token", status: "fail", title: "Token expired", detail: `${d.token.id} expired on ${d.token.expirationDate?.slice(0, 10)}. With token enforcement the ActiveGate loses its connection.`, fix: "token" });
    else if (days <= TOKEN_EXPIRING_DAYS) checks.push({ id: "token", status: "warn", title: `Token expires in ${plural(days, "day")}`, detail: `${d.token.id} expires on ${d.token.expirationDate?.slice(0, 10)}. The ActiveGate loses its connection once the token expires.`, fix: "token" });
    else checks.push({ id: "token", status: "pass", title: "Token valid", detail: `${d.token.id} until ${d.token.expirationDate?.slice(0, 10)}.` });
  }

  // 5. Communication (dsfm docs: rejected = authorization, data loss; dropped = timeouts, may be data loss; resent = early warning).
  if (h) {
    if (h.rejected) checks.push({ id: "rejected", status: "fail", title: `${plural(h.rejected, "message")} rejected`, detail: "Rejected due to authorization issues. A non-zero value indicates data loss.", fix: "rejected" });
    if (h.dropped) checks.push({ id: "dropped", status: "warn", title: `${plural(h.dropped, "message")} dropped`, detail: "Dropped due to timeouts; may indicate data loss.", fix: "dropped" });
    if (h.resent) checks.push({ id: "resent", status: "info", title: `${plural(h.resent, "message")} resent`, detail: "A communication issue that may eventually result in dropped messages.", fix: "dropped" });
    if (!h.rejected && !h.dropped && !h.resent) checks.push({ id: "messages", status: "pass", title: "No dropped, rejected or resent messages", detail: `Outgoing queue peaked at ${(h.queueMax ?? 0).toLocaleString()} messages.` });

    // 6. Resources.
    const heap = heapPct(h);
    if (heap !== null && heap >= 80) checks.push({ id: "heap", status: "warn", title: `Java heap ${heap}% used`, detail: `${Math.round((h.heapUsed ?? 0) / 1048576).toLocaleString()} of ${Math.round((h.heapAvail ?? 0) / 1048576).toLocaleString()} MiB (average over the timeframe).`, fix: "resources" });
    const disk = diskFreePct(h);
    if (disk !== null && disk < 10) checks.push({ id: "disk", status: "warn", title: `Storage volume ${disk}% free`, detail: `${(h.volFree ?? 0).toLocaleString()} of ${(h.volTotal ?? 0).toLocaleString()} MiB free at the lowest point.`, fix: "resources" });
    if (h.sysCpu !== null && h.sysCpu >= 95) checks.push({ id: "cpu", status: "warn", title: `Host CPU peaked at ${Math.round(h.sysCpu)}%`, detail: "Operating system CPU usage of the ActiveGate host (peak over the timeframe).", fix: "resources" });
  } else {
    checks.push({ id: "messages", status: "info", title: "No self-monitoring data", detail: "The ActiveGate reported no dsfm:active_gate metrics in the timeframe." });
  }

  // 7. Modules.
  for (const id of ag.modules) {
    const m = moduleDef(id);
    const s = moduleState(m, ag, d.ctx);
    if (s.state !== "issue") continue;
    const fix: AgFix = id === "AWS_MONITORING" ? "aws" : id === "KUBERNETES" ? "k8s" : id === "EXTENSION_CONTROLLER" ? "extensions" : "ingest";
    checks.push({ id: `module-${id}`, status: "warn", title: `${m.label}: problems`, detail: s.text, fix, module: id });
  }
  const forbidden = d.ctx.detail.filter((r) => r.metric === "k8s.api_errors" && isK8sForbidden(r.key));
  if (forbidden.length) checks.push({ id: "k8s-forbidden", status: "info", title: "Kubernetes API: access denied (403)", detail: `${list(forbidden.map((r) => `${k8sPath(r.key)} (${r.n.toLocaleString()})`), 3)}: the ActiveGate's service account may not call these APIs.`, fix: "k8s", module: "KUBERNETES" });
  const idle = ag.modules.map(moduleDef).filter((m) => moduleState(m, ag, d.ctx).state === "idle");
  if (idle.length) checks.push({ id: "idle", status: "info", title: `Enabled, not in use: ${idle.map((m) => m.label).join(", ")}`, detail: "These modules are enabled but showed no activity in the timeframe: not configured for this ActiveGate yet, or not needed here.", fix: "module" });

  // 8. Group and network zone.
  if (d.group) {
    checks.push({
      id: "group",
      status: "info",
      title: `ActiveGate group ${ag.group}`,
      detail: `${plural(d.group.ags.length, "ActiveGate")} in the group, ${d.group.eec} with the Extensions module. ${d.group.note}${remotelyConfigurable(ag) ? "" : " Containerized: the group is set in the DynaKube (spec.activeGate.group)."}`,
      fix: "group",
    });
  }
  if (d.zone) {
    const off = d.zonesEnabled === false;
    checks.push({
      id: "zone",
      status: off ? "info" : d.zone.fallback === "NONE" ? "info" : "pass",
      title: `Network zone ${d.zone.zone}: fallback ${FALLBACK_LABEL[d.zone.fallback] ?? "not read"}${d.zone.configured ? "" : " (default)"}`,
      detail: `${off ? "Network zones are turned off for the environment (Settings › Preferences › Network zones), so zones and fallback do not route traffic. " : ""}${FALLBACK_TEXT[d.zone.fallback] ?? ""} ${plural(d.zone.online, "connected ActiveGate")} and ${plural(d.zone.oneAgents, "OneAgent")} in the zone${d.zone.alternatives.length ? `; alternative zones ${d.zone.alternatives.join(", ")}` : "; no alternative zone"}.`,
      fix: "zone",
    });
  }

  // 9. Extensions assigned to the group that no ActiveGate runs.
  if (d.unassigned.length) {
    checks.push({
      id: "unassigned",
      status: "fail",
      title: `${plural(d.unassigned.length, "extension configuration")} not picked up in group ${ag.group}`,
      detail: `${list(d.unassigned.map((c) => c.extension), 3)}. This ActiveGate is in the group and has the Extensions module, but runs none of them; the message on each configuration says why (for example a failed connection check to the endpoint).`,
      fix: "extensions",
      module: "EXTENSION_CONTROLLER",
    });
  }
  return checks;
}

/** Worst status of a set of checks (fail > warn > info > pass). */
export const worstStatus = (checks: AgCheck[]): CheckStatus => (["fail", "warn", "info", "pass"] as CheckStatus[]).find((s) => checks.some((c) => c.status === s)) ?? "pass";

// --- Manual actions (doc-backed) --------------------------------------------------------------
const agName = (ag?: ActiveGate) => ag?.name ?? "<activegate>";
const k8s = (ag?: ActiveGate) => !!ag?.containerized;

const COLLECTION_DQL = (agId?: string) =>
  `timeseries {\n  dropped = sum(dt.sfm.active_gate.communication.messages.dropped),\n  rejected = sum(dt.sfm.active_gate.communication.messages.rejected),\n  resent = sum(dt.sfm.active_gate.communication.messages.resent),\n  queue = max(dt.sfm.active_gate.communication.queue.outgoing.usage)\n}, by:{dt.active_gate.id}${agId ? `, filter:{dt.active_gate.id == "${agId}"}` : ""}, from:now()-24h`;

export const supportArchiveAction = (ag?: ActiveGate): ManualAction => ({
  id: "support-archive-agctl",
  title: "Collect ActiveGate logs on the host (agctl support archive)",
  steps: [
    "Use this when the ActiveGate cannot connect or does not start; otherwise collect the archive through Dynatrace (the API action, or Fleet Management › the ActiveGate › Support archive).",
    "ActiveGate 1.333+: run agctl support-archive create on the host (Linux: a user in the ActiveGate service group, dtuserag by default; Windows: cmd.exe as administrator, PowerShell is not supported).",
    "--days defaults to 30 and --directory to the current directory; --modules limits it to some modules, for example zremote,synthetic.",
    "Attach the ZIP to the support ticket. The ActiveGate keeps no copy; archives collected through Dynatrace are deleted after 30 days.",
  ],
  variants: [
    { label: "Linux", language: "bash", code: "agctl support-archive create --days=7 --directory=/tmp" },
    { label: "Windows (cmd.exe as administrator)", language: "bat", code: '"C:\\Program Files\\dynatrace\\gateway\\agctl.bat" support-archive create --days=7' },
    { label: "Kubernetes", language: "bash", code: `kubectl exec -n dynatrace ${k8s(ag) ? agName(ag) : "<activegate-pod>"} -- agctl support-archive create --stdout > ag-support-archive.zip 2> output-logs.txt` },
    { label: "ActiveGate 1.331 and earlier", language: "bash", code: '# Linux\nsudo -u dtuserag /opt/dynatrace/gateway/agctl create-support-archive\n# Windows (as administrator)\n"C:\\Program Files\\dynatrace\\gateway\\agctl.bat" create-support-archive' },
    {
      label: "Log directories",
      language: "text",
      code: "Linux\n  /var/log/dynatrace/gateway              ActiveGate\n  /var/log/dynatrace/autoupdater          auto-update\n  /var/log/dynatrace/synthetic            synthetic engine\n  /var/log/dynatrace/zremote              zRemote\n  /var/lib/dynatrace/remotepluginmodule   extensions (config, logs, cache)\nWindows\n  %PROGRAMDATA%\\dynatrace\\gateway\\log\n  %PROGRAMDATA%\\dynatrace\\autoupdater\\log\n  %PROGRAMDATA%\\dynatrace\\synthetic\\log\n  %PROGRAMDATA%\\dynatrace\\zremote\\log\n  %PROGRAMDATA%\\dynatrace\\remotepluginmodule",
    },
  ],
  notes: [
    "Support archives collected through Dynatrace mask sensitive data. For a multi-environment ActiveGate they can only be collected from its main environment.",
    "Containerized ActiveGates 1.325+ support --stdout; older ones write with --directory and the file is copied out of the pod.",
  ],
  docs: [DOC.agDiagnostics, DOC.agctl, DOC.agDirectories, DOC.fleetManagement],
});

export const connectivityAction = (ag?: ActiveGate): ManualAction => ({
  id: "connectivity",
  title: "Restore the ActiveGate connection",
  steps: [
    "Fleet Management reports an ActiveGate as critical when connectivity is lost: investigate the connection.",
    "Check that the ActiveGate main service runs, and restart it.",
    "Check the endpoint, network zone and proxy it uses (agctl outgoing-endpoint get; proxy-server / proxy-port in the [http.client] section of custom.properties).",
    "Check its token: with token enforcement an expired token disconnects the ActiveGate.",
    "Still offline: collect a support archive locally with agctl and open a support ticket.",
  ],
  variants: k8s(ag)
    ? [{ label: "Kubernetes", language: "bash", code: `kubectl get pods -n dynatrace -o wide\nkubectl describe pod ${agName(ag)} -n dynatrace\nkubectl exec -n dynatrace ${agName(ag)} -- agctl outgoing-endpoint get` }]
    : [
        { label: "Linux", language: "bash", code: "sudo systemctl status dynatracegateway\nsudo systemctl restart dynatracegateway\nagctl outgoing-endpoint get\nagctl network-zone get\nagctl property get --section=http.client --key=proxy-server" },
        { label: "Windows (cmd.exe as administrator)", language: "bat", code: 'net stop "Dynatrace Gateway"\nnet start "Dynatrace Gateway"\n"C:\\Program Files\\dynatrace\\gateway\\agctl.bat" outgoing-endpoint get' },
      ],
  notes: ["agctl needs ActiveGate 1.333+. Restart the ActiveGate after changing its configuration."],
  docs: [DOC.agHealth, DOC.agRestart, DOC.agctl, DOC.agConfig, DOC.agSecurity],
});

export const tokenAction = (ag?: ActiveGate): ManualAction => ({
  id: "token",
  title: "Rotate the ActiveGate token",
  steps: [
    "Tokens with 30 or fewer days left show as Expiring; with token enforcement the ActiveGate loses its connection when the token expires. Absent, Invalid and Unknown tokens also need a new token.",
    "Create an ActiveGate token: an API token with the Create ActiveGate tokens (or Write ActiveGate tokens) scope calls POST /api/v2/activeGateTokens with seedToken false, activeGateType ENVIRONMENT and an expiration date at most 2 years ahead.",
    k8s(ag)
      ? "Kubernetes: the Dynatrace Operator creates and rotates the ActiveGate token itself when its token has the activeGateTokenManagement.create scope (Operator 0.9.0+)."
      : "Set authToken to the new token in authorization.properties (configuration directory), then restart the ActiveGate main service.",
    "Find every affected ActiveGate in Fleet Management: filter Alert type › Token.",
  ],
  variants: [
    {
      label: "Create the token (API)",
      language: "bash",
      code: `curl -X POST "https://<environment-id>.live.dynatrace.com/api/v2/activeGateTokens" \\\n  -H "Authorization: Api-Token <token with Create ActiveGate tokens>" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name": "${agName(ag)}", "seedToken": false, "activeGateType": "ENVIRONMENT", "expirationDate": "<at most 2 years ahead>"}'`,
    },
    { label: "authorization.properties (Linux)", language: "bash", code: "# /var/lib/dynatrace/gateway/config/authorization.properties (root)\nauthToken = <new ActiveGate token>\n\nsudo systemctl restart dynatracegateway" },
    { label: "authorization.properties (Windows)", language: "bat", code: 'REM %PROGRAMDATA%\\dynatrace\\gateway\\config\\authorization.properties\nREM authToken = <new ActiveGate token>\nnet stop "Dynatrace Gateway"\nnet start "Dynatrace Gateway"' },
  ],
  notes: ["Tokens not used for 2 years are deleted automatically (1.272+); check lastUsedDate.", 'The alerting profile "Default for ActiveGate Token Expiry" notifies before tokens expire.'],
  docs: [DOC.agSecurity, DOC.agDirectories, DOC.agRestart],
});

export const rejectedAction = (ag?: ActiveGate): ManualAction => ({
  id: "rejected",
  title: "Messages rejected (authorization)",
  steps: [
    "dsfm:active_gate.communication.messages.rejected counts messages rejected due to authorization issues; any non-zero value is data loss.",
    "Check this ActiveGate's token (the token check above, or Fleet Management › Alert type › Token) and rotate it if it is expiring, invalid, unknown or absent.",
    "Authorization also applies to what sends through the ActiveGate: check the tokens of the OneAgents, extensions and API clients that use it.",
    "If the token is fine, collect a support archive and open a support ticket.",
  ],
  variants: [{ label: "DQL: messages over time", language: "dql", code: COLLECTION_DQL(ag?.agId) }],
  docs: [DOC.agSfm, DOC.agSecurity, DOC.agHealth],
});

export const droppedAction = (ag?: ActiveGate): ManualAction => ({
  id: "dropped",
  title: "Dropped or resent messages (network)",
  steps: [
    "Dropped messages (timeouts) may mean data loss; resent messages are an early warning of a communication issue that can end in dropped messages.",
    "A growing outgoing queue means messages arrive faster than they are sent out; network performance is a common root cause.",
    "Check the network path to Dynatrace: the endpoint, proxy and firewall the ActiveGate uses.",
    "Check the ActiveGate's CPU and heap in the charts above.",
  ],
  variants: [
    { label: "Endpoint and proxy (agctl)", language: "bash", code: "agctl outgoing-endpoint get\nagctl network-zone get\nagctl property get --section=http.client --key=proxy-server\nagctl property get --section=http.client --key=proxy-port" },
    { label: "DQL: messages over time", language: "dql", code: COLLECTION_DQL(ag?.agId) },
  ],
  docs: [DOC.agSfm, DOC.agctl, DOC.agConfig],
});

export const updateAction = (ag?: ActiveGate): ManualAction => ({
  id: "update",
  title: "Update the ActiveGate (host-based)",
  steps: [
    "Settings › Fleet management › ActiveGate version and updates › Configure updates: set the update mode and target version for the environment or for this ActiveGate.",
    "Auto-update disabled is not recommended: ActiveGates can fall out of the supported version range. Fleet Management warns when an ActiveGate is behind by more than five versions.",
    "Update now: the Update now (API) action here, or the one-click Update in Deployment status (only offered while automatic updates are off for that ActiveGate).",
    "Manual: run the new installer over the existing one; custom.properties and launcheruserconfig.conf are kept (back them up first).",
  ],
  variants: [{ label: "Check the version", language: "bash", code: `agctl version get   # on ${agName(ag)}, before and after` }],
  notes: ["Auto-update and one-click update only apply to host-based installations. The availability check runs every 30 minutes."],
  docs: [DOC.agUpdate, DOC.fleetManagement, DOC.agHealth],
});

export const updateK8sAction = (ag?: ActiveGate): ManualAction => ({
  id: "update-k8s",
  title: "Update a containerized ActiveGate (Dynatrace Operator)",
  steps: [
    "The ActiveGate target version configured in Dynatrace decides the image the Operator deploys; the Operator checks every 15 minutes and updates the pods when it finds a new version.",
    "A pinned image (spec.activeGate.image in the DynaKube) disables auto-update: remove it, or set its tag to the target version.",
    "Check which image source the DynaKube uses.",
  ],
  variants: [
    { label: "DynaKube", language: "yaml", code: "spec:\n  activeGate:\n    # remove to follow the target version configured in Dynatrace\n    image: public.ecr.aws/dynatrace/dynatrace-activegate:<tag>" },
    { label: "Check", language: "bash", code: `kubectl get dynakube <dynakube-name> -n dynatrace -o jsonpath='{.status.activeGate.source}'\nkubectl get pods -n dynatrace -o wide${ag ? `   # ${agName(ag)}` : ""}` },
  ],
  notes: ["Containerized ActiveGates are deployed and updated with cloud-specific tooling; Fleet Management auto-update and one-click update do not apply to them."],
  docs: [DOC.k8sComponentUpdates, DOC.agUpdate, DOC.dynakubeParams],
});

export const moduleAction = (moduleId?: string, ag?: ActiveGate): ManualAction => {
  const m = moduleId ? moduleDef(moduleId) : undefined;
  const on = !!m && !!ag && ag.modules.includes(m.id);
  const section = m?.section ?? "<section>";
  const key = m?.key ?? "<module>_enabled";
  return {
    id: `module${m ? `-${m.id}` : ""}`,
    title: m ? `${on ? "Disable" : "Enable"} ${m.label}` : "Enable or disable an ActiveGate module",
    steps: [
      "Host-based: switch the module in custom.properties (never edit config.properties)" + (m?.agctl ? ` or with agctl modules (1.333+, module name ${m.agctl})` : "") + ".",
      "Restart the ActiveGate main service to apply the change.",
      ...(m?.installOnly ? [`${m.label} needs an installation with that purpose; it cannot be switched on with a property.`] : []),
      "Containerized: no module is enabled by default; set the capabilities (DT_CAPABILITIES, or spec.activeGate.capabilities in the DynaKube). The capabilities page lists AWS, Extensions and Memory dumps as not supported in containers.",
      ...(on ? ["An enabled module that shows no activity is either not configured for this ActiveGate yet (for example no AWS connection or Kubernetes cluster uses it) or not needed here."] : []),
    ],
    variants: [
      { label: "custom.properties", language: "ini", code: `# Linux: /var/lib/dynatrace/gateway/config/custom.properties\n# Windows: %PROGRAMDATA%\\dynatrace\\gateway\\config\\custom.properties\n[${section}]\n${key} = ${on ? "false" : "true"}` },
      ...(m?.agctl ? [{ label: "agctl", language: "bash", code: `agctl modules get\nagctl modules ${on ? "disable" : "enable"} ${m.agctl}\nsudo systemctl restart dynatracegateway` }] : []),
      { label: "Restart (Linux / Windows)", language: "bash", code: 'sudo systemctl restart dynatracegateway\n# Windows: net stop "Dynatrace Gateway" && net start "Dynatrace Gateway"' },
      { label: "Kubernetes (DynaKube)", language: "yaml", code: "spec:\n  activeGate:\n    capabilities:\n      - routing\n      - kubernetes-monitoring" },
    ],
    docs: [DOC.agConfig, DOC.agctl, DOC.agRestart, DOC.agContainerConfig, DOC.agCapabilities],
  };
};

export const awsAction = (): ManualAction => ({
  id: "aws",
  title: "AWS monitoring: data lost or failed requests",
  steps: [
    "data_lost_monitoring_status = 1 means some data could not be obtained; failed requests by status (timeout, network error, authentication error) show why.",
    "Timeouts and network errors: since Dynatrace 1.329 the global AWS STS endpoint is not supported. Allow the regional STS endpoint and tagging.<REGION>.amazonaws.com, monitoring.<REGION>.amazonaws.com, ec2.<REGION>.amazonaws.com; missing allowed URLs cause communication or timeout errors.",
    "Behind a proxy: add the proxy's CA certificate to the ActiveGate trust store (the most frequent certificate issue).",
    "Authentication errors: check the role or keys of the AWS connection and its IAM policy. Role-based access needs the ActiveGate on EC2.",
    "Fewer API calls: Settings › Cloud and virtualization › AWS › the connection › Resources to be monitored › Monitor resources selected by tags (up to 10 tags, ORed).",
    "A connection shown as unassigned has no ActiveGate running it.",
  ],
  variants: [
    {
      label: "IAM policy (base actions)",
      language: "json",
      code: '{\n  "Version": "2012-10-17",\n  "Statement": [{\n    "Effect": "Allow",\n    "Action": [\n      "cloudwatch:GetMetricData", "cloudwatch:GetMetricStatistics", "cloudwatch:ListMetrics",\n      "sts:GetCallerIdentity", "tag:GetResources", "tag:GetTagKeys", "ec2:DescribeAvailabilityZones"\n    ],\n    "Resource": "*"\n  }]\n}\n// plus the actions of each monitored service',
    },
    { label: "Trust store and proxy (agctl)", language: "bash", code: "agctl trust-store get\nagctl property get --section=http.client --key=proxy-server" },
  ],
  notes: ["CloudWatch data is collected in five-minute intervals.", "An Environment ActiveGate is needed above 2,000 resources or for non-default services."],
  docs: [DOC.awsCloudWatch, DOC.awsLimitTags, DOC.agSfm, DOC.agctl],
});

export const k8sAction = (ag?: ActiveGate): ManualAction => ({
  id: "k8s",
  title: "Kubernetes monitoring: API errors and sizing",
  steps: [
    "403 (access denied): the ActiveGate's service account may not call that Kubernetes API. Compare the cluster role the Operator deployed with the features you enabled.",
    "404 on apps.openshift.io deploymentconfigs is expected on clusters that are not OpenShift.",
    "Status -1 (no HTTP response) on /metrics or /metrics/cadvisor: the node metrics endpoints could not be reached.",
    "Sizing: CPU throttling consistently above 10% → raise the CPU request; memory working set above 80% → raise memory requests; any OOM kill → raise memory limits; kubernetes.pipeline_duration consistently above 50–60 s → more CPU. Rising GC time means the ActiveGate is under-provisioned.",
  ],
  variants: [
    { label: "RBAC", language: "bash", code: "kubectl get clusterrole | grep dynatrace\nkubectl describe clusterrole <dynatrace-kubernetes-monitoring role>" },
    { label: "Resources", language: "bash", code: `kubectl top pod -n dynatrace${ag ? `   # ${agName(ag)}` : ""}\nkubectl get dynakube <dynakube-name> -n dynatrace -o jsonpath='{.spec.activeGate.resources}'` },
    { label: "DynaKube resources", language: "yaml", code: "spec:\n  activeGate:\n    resources:\n      requests:\n        cpu: <cpu>\n        memory: <memory>\n      limits:\n        cpu: <cpu>\n        memory: <memory>" },
  ],
  docs: [DOC.k8sAgSizing, DOC.k8sMonitoringTroubleshoot, DOC.dynakubeParams],
});

export const extensionAction = (c?: ExtConfig): ManualAction => ({
  id: "extensions",
  title: c ? `Extension not running: ${c.extension}` : "Extension not running on the ActiveGate",
  steps: [
    `Every ActiveGate that runs an extension must be in an ActiveGate group; the monitoring configuration targets the group${c?.group ? ` (${c.group})` : ""}.`,
    "Not picked up (UNASSIGNED): no ActiveGate in the group runs it. Check that an ActiveGate in the group is connected, has the Extensions module (extension_controller_enabled) and passes the configuration's check; the message shows the failing endpoint.",
    "Every state except OK and IDLE is an error. Right after a change, allow at least 5 minutes while the configuration is scheduled and validated.",
    "Resource limits: each data source runs under a performance profile (Default: 5% CPU and 500 MB per data source on an ActiveGate). Above the soft limit new tasks are rejected; above the hard limit the newest task is stopped. Use High limits or Dedicated limits on ActiveGates that run many extensions.",
    "Open the configuration in Extensions › Manage › the extension › Monitoring configurations (Health tab, Log viewer).",
  ],
  variants: [
    { label: "Group and modules (agctl)", language: "bash", code: "agctl group get\nagctl modules get" },
    { label: "custom.properties", language: "ini", code: "[extension_controller]\nextension_controller_enabled = true" },
    {
      label: "DQL: framework messages",
      language: "dql",
      code: `fetch dt.system.events, from:now()-24h\n| filter event.kind == "EXTENSIONS_EVENT"${c ? ` and dt.extension.config.id == "${c.configId}"` : ""}\n| fields timestamp, loglevel, dt.extension.name, dt.extension.status, content, dt.active_gate.id\n| sort timestamp desc`,
    },
  ],
  notes: ["Extensions run on x86-64 only; cluster and multi-environment ActiveGates cannot run them."],
  docs: [DOC.extConcepts, DOC.extHealth, DOC.extManage, DOC.extStatusField, DOC.agConfig],
});

export const resourcesAction = (ag?: ActiveGate): ManualAction => ({
  id: "resources",
  title: "ActiveGate heap, CPU or disk",
  steps: [
    "Heap: compare jvm.heap_memory_used with the heap size (jvm.heap_memory_available); rising GC time means the ActiveGate is under-provisioned.",
    k8s(ag)
      ? "Kubernetes: memory working set above 80% → raise memory requests; CPU throttling above 10% → raise the CPU request; OOM kills → raise memory limits."
      : "Host-based: check what else runs on the host and give the ActiveGate host more CPU or memory.",
    "Disk: the ActiveGate buffers on disk (generic ingest disk queue, 300 MB by default; file cache 2 GB, 14 days). Keep free space on its volume.",
  ],
  variants: k8s(ag)
    ? [{ label: "Kubernetes", language: "bash", code: `kubectl top pod -n dynatrace   # ${agName(ag)}` }]
    : [{ label: "Linux", language: "bash", code: "df -h /var/lib/dynatrace /var/tmp/dynatrace /var/log/dynatrace\ntop -b -n 1 | head -20" }],
  docs: [DOC.agSfm, DOC.k8sAgSizing, DOC.agConfig, DOC.agDirectories],
});

export const ingestAction = (): ManualAction => ({
  id: "ingest",
  title: "Rejected metric or OTLP data points",
  steps: [
    "The metrics ingest metrics are split by the reason of rejection (for example an unsupported metric type).",
    "Fix the sender: change the data it sends to a supported format, or stop sending what is rejected.",
  ],
  variants: [{ label: "DQL: rejections by reason", language: "dql", code: "timeseries rejected = sum(dt.sfm.active_gate.metrics.ingest.grail.datapoints.rejected), by:{dt.active_gate.id, reason}, from:now()-24h" }],
  docs: [DOC.agSfm],
});

export const groupZoneAction = (ag?: ActiveGate): ManualAction => ({
  id: "group-zone",
  title: "Set the ActiveGate group or network zone on the ActiveGate",
  steps: [
    "Host-based ActiveGates 1.237+ are easiest to change with the remote configuration API action (one job for many ActiveGates, no restart, up to 10 minutes).",
    "On the host: agctl group set / network-zone set (1.333+), or the group key in [collector] and networkZone in [connectivity] of custom.properties; restart the ActiveGate after changing its configuration.",
    "Containerized (Dynatrace Operator): spec.activeGate.group and spec.networkZone in the DynaKube (spec.networkZone applies to the OneAgent and ActiveGate pods); remote configuration does not support containerized ActiveGates.",
    "Extensions run only on ActiveGates in a group, and a monitoring configuration targets one group. OneAgents prefer ActiveGates of their own network zone.",
  ],
  variants: [
    { label: "agctl (Linux)", language: "bash", code: `agctl group set <group>\nagctl network-zone set <zone>\nagctl group get\nagctl network-zone get\nsudo systemctl restart dynatracegateway${ag ? `   # on ${ag.name}` : ""}` },
    { label: "custom.properties", language: "ini", code: "# Linux: /var/lib/dynatrace/gateway/config/custom.properties\n# Windows: %PROGRAMDATA%\\dynatrace\\gateway\\config\\custom.properties\n[collector]\ngroup = <group>\n\n[connectivity]\nnetworkZone = <zone>" },
    { label: "DynaKube", language: "yaml", code: "spec:\n  networkZone: <zone>        # OneAgent and ActiveGate pods\n  activeGate:\n    group: <group>" },
  ],
  notes: ["Network zone names: lowercase alphanumerics, hyphens, underscores and dots (a dot only as separator, not first), up to 256 characters; recommended pattern provider.region.availability-zone.datacenter.tier."],
  docs: [DOC.bulkConfig, DOC.agctl, DOC.agConfig, DOC.dynakubeParams, DOC.networkZones],
});

export const zoneFallbackAction = (zone?: string): ManualAction => ({
  id: "zone-fallback",
  title: `Network zone${zone ? ` ${zone}` : ""}: alternative zones and fallback`,
  steps: [
    "Turn network zones on: Settings › Preferences › Network zones › Enable network zones in this environment.",
    "Alternative zones and fallback: Deployment Status › Network zones › the zone › Edit (or the Settings API, builtin:networkzones.zones). Alternative zone ActiveGates must be reachable by the zone's OneAgents.",
    "Fallback Any ActiveGate (default): same zone, alternative zones, default zone, then any other ActiveGate. Only default zone: the first three. None (drop traffic): only the zone and its alternative zones; OneAgents send no data elsewhere.",
    "The default network zone cannot be modified.",
  ],
  variants: [
    { label: "Settings object", language: "json", code: `{\n  "schemaId": "builtin:networkzones.zones",\n  "scope": "environment",\n  "value": {\n    "id": "${zone ?? "<zone>"}",\n    "alternativeZones": ["<alternative zone>"],\n    "fallbackMode": "ANY_ACTIVE_GATE"\n  }\n}` },
  ],
  docs: [DOC.networkZones, DOC.networkZoneConnectivity],
});

/** Actions offered before an ActiveGate is selected. */
export const genericAgActions = (): ManualAction[] => [
  groupZoneAction(),
  zoneFallbackAction(),
  updateAction(),
  updateK8sAction(),
  tokenAction(),
  rejectedAction(),
  droppedAction(),
  moduleAction(),
  extensionAction(),
  awsAction(),
  k8sAction(),
  resourcesAction(),
  connectivityAction(),
  supportArchiveAction(),
];
