import { EXT_OK, EXT_STATUS_TEXT, extensionAction, type ExtConfig } from "./activeGates";
import { listExtensions, readMonitoringConfigs, type AgGroup, type ExistingConfig } from "./databases";
import { DOC } from "./deepTech";
import type { CheckStatus } from "./deepMonitoring";
import type { Category } from "./kubernetes";
import { EXT_REC_MATCH, EXT_SCOPE_LOOKBACK } from "./queries";
import type { ManualAction } from "./remediation";

// ---------------------------------------------------------------------------
// Extensions tab: every monitoring configuration in the environment (local, remote, Kubernetes, cloud) with its status,
// the extension framework's fastcheck and assignment results, and extensions for technologies OneAgent sees on processes.
// Scope, activation context and enabled come from the Extensions API (/platform/extensions/v2); status from extension
// self-monitoring (dt.sfm.extension.status); fastcheck from extension framework events (dt.system.events). What each
// source carries was checked on the demo tenant: see the Extensions section in queries.ts.
// ---------------------------------------------------------------------------

type Row = Record<string, any>;
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown): number => Number(v) || 0;
export const day = (iso?: string) => (iso ? iso.slice(0, 16).replace("T", " ") : "");

// --- Kinds and scopes ----------------------------------------------------------------------------------------------
export type ExtKind = "LOCAL" | "REMOTE" | "KUBERNETES" | "CLOUD";
export const KINDS: (Category & { id: ExtKind })[] = [
  { id: "LOCAL", label: "Local (OneAgent)", slot: 1, detail: "Runs in OneAgent on the hosts in its scope: one host, a host group or the whole environment." },
  { id: "REMOTE", label: "Remote (ActiveGate)", slot: 2, detail: "Runs on an ActiveGate of the ActiveGate group it targets and reaches its endpoints over the network." },
  { id: "KUBERNETES", label: "Kubernetes", slot: 3, detail: "Runs inside a Kubernetes cluster (scope kubernetes)." },
  { id: "CLOUD", label: "Cloud integration", slot: 7, detail: "Cloud data acquisition (scope integration-aws / -azure / -gcp). It reports no extension status." },
];
export const kindInfo = (id: string) => KINDS.find((k) => k.id === id) ?? KINDS[0];

export type ScopeType = "environment" | "host" | "host_group" | "management_zone" | "ag_group" | "kubernetes" | "integration" | "unknown";

/** API scope -> type and ID: environment, HOST-…, HOST_GROUP-…, ag_group-<name>, kubernetes, integration-<cloud>. */
export function parseScope(scope: string): { type: ScopeType; id: string } {
  if (scope === "environment") return { type: "environment", id: "" };
  if (scope.startsWith("HOST_GROUP-")) return { type: "host_group", id: scope };
  if (scope.startsWith("HOST-")) return { type: "host", id: scope };
  if (/^management_zone-/i.test(scope)) return { type: "management_zone", id: scope.replace(/^management_zone-/i, "") };
  if (scope.startsWith("ag_group-")) return { type: "ag_group", id: scope.slice("ag_group-".length) };
  if (scope === "kubernetes") return { type: "kubernetes", id: "" };
  if (scope.startsWith("integration-")) return { type: "integration", id: scope.slice("integration-".length) };
  return { type: "unknown", id: scope };
}

const CONTEXT_KIND: Record<string, ExtKind> = { LOCAL: "LOCAL", REMOTE: "REMOTE", CONTAINER: "KUBERNETES", DATA_ACQUISITION: "CLOUD" };

/** Kind from the activation context; configurations of older extension versions have none (Hyper-V 2.2.21), so the scope decides. */
export function kindFrom(activationContext: string | undefined, scope: ScopeType): ExtKind {
  const k = activationContext ? CONTEXT_KIND[activationContext] : undefined;
  if (k) return k;
  return scope === "ag_group" ? "REMOTE" : scope === "kubernetes" ? "KUBERNETES" : scope === "integration" ? "CLOUD" : "LOCAL";
}

// --- Extensions API ------------------------------------------------------------------------------------------------
export type ApiConfig = ExistingConfig & { extension: string };
export type ApiConfigs = { configs: ApiConfig[]; extensions: Map<string, string>; failed: string[] };
const CONCURRENCY = 6;

/**
 * Every monitoring configuration in the environment: the extension list, then one GET per extension (6 at a time; no
 * status call, the status comes from DQL). Extensions whose configurations cannot be read are listed in `failed`.
 */
export async function readAllConfigs(): Promise<ApiConfigs> {
  const exts = await listExtensions();
  const configs: ApiConfig[] = [];
  const failed: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < exts.length) {
      const e = exts[next++];
      try {
        for (const c of await readMonitoringConfigs(e.name, false)) configs.push({ ...c, extension: e.name });
      } catch {
        failed.push(e.name);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, exts.length) }, worker));
  return { configs, extensions: new Map(exts.map((e) => [e.name, e.version])), failed };
}

// --- Fastcheck -----------------------------------------------------------------------------------------------------
export type FastcheckResult = "failed" | "passed" | "unassigned" | "created" | "other";
export type FastcheckRow = {
  configId: string;
  extension: string;
  status: string;
  level: string;
  content: string;
  group: string;
  agId: string;
  occurrences: number;
  firstAt: string;
  lastAt: string;
  result: FastcheckResult;
};

/** Framework messages seen on the tenant: "Failed to assign … Reason: …", "Successfully assigned …", "… has not been picked up …", "Monitoring configuration created …". */
export function fastcheckResult(content: string): FastcheckResult {
  if (content.startsWith("Failed to assign")) return "failed";
  if (content.startsWith("Successfully assigned")) return "passed";
  if (content.includes("has not been picked up")) return "unassigned";
  if (content.startsWith("Monitoring configuration created")) return "created";
  if (/fast ?check/i.test(content)) return /fail|error/i.test(content) ? "failed" : "other";
  return "other";
}
export const FASTCHECK_LABEL: Record<FastcheckResult, string> = {
  failed: "Fastcheck failed",
  passed: "Passed, assigned",
  unassigned: "Not picked up",
  created: "Created",
  other: "Message",
};
/** The reason without the framework's prefix: "Fast check failed for 1 endpoint(s). Cannot connect to …". */
export const fastcheckReason = (content: string) => content.replace(/^Failed to assign monitoring configuration to ActiveGate\.\s*Reason:\s*/, "");

export const toFastcheck = (r: Row): FastcheckRow => {
  const content = str(r.content);
  return {
    configId: str(r.configId),
    extension: str(r.extension),
    status: str(r.status),
    level: str(r.loglevel),
    content,
    group: str(r.group),
    agId: str(r.agId),
    occurrences: num(r.occurrences),
    firstAt: str(r.firstAt),
    lastAt: str(r.lastAt),
    result: fastcheckResult(content),
  };
};

// --- Monitoring configurations (API + DQL) -------------------------------------------------------------------------
export type HostStatus = { host: string; hostName: string; status: string };
export type StatusSource = "dql" | "event" | "none";

export type MonConfig = {
  configId: string;
  extension: string;
  description: string;
  enabled: boolean;
  /** Raw API scope; empty when the configuration is only known from DQL. */
  scope: string;
  scopeType: ScopeType;
  scopeId: string;
  kind: ExtKind;
  version: string;
  configEntity?: string;
  dataSource: string;
  /** dt.extension.status, or DISABLED / NO_DATA / NOT_REPORTED (see CONFIG_STATUS_TEXT). Local: the worst host status. */
  status: string;
  statusSource: StatusSource;
  /** Local: latest status per host that reports the configuration. */
  hosts: HostStatus[];
  group: string;
  agId?: string;
  message?: string;
  messageLevel?: string;
  messageAt?: string;
  /** Fastcheck and assignment results, newest first. */
  fastcheck: FastcheckRow[];
  inApi: boolean;
  /** The API was readable but does not list it: deleted in the timeframe, or not an Extensions 2.0 configuration. */
  gone: boolean;
};

export const CONFIG_STATUS_TEXT: Record<string, string> = {
  ...EXT_STATUS_TEXT,
  DISABLED: "Disabled in the configuration",
  NO_DATA: "No status in the timeframe",
  NOT_REPORTED: "Cloud data acquisition reports no status",
};
/** UNASSIGNED means no ActiveGate picked it up; for local and Kubernetes configurations nothing ran it. */
export const statusText = (c: MonConfig) => (c.status === "UNASSIGNED" && c.kind !== "REMOTE" ? "Not picked up for execution" : CONFIG_STATUS_TEXT[c.status] ?? "");
const QUIET = [...EXT_OK, "DISABLED", "NOT_REPORTED"];
/** Not running as configured: enabled and in any state except OK / IDLE (Extensions health docs), including no status at all. */
export const isBroken = (c: MonConfig) => c.enabled && !c.gone && !QUIET.includes(c.status);
/** Counts toward "configurations OK": enabled, still in the environment and with a status that can be judged. */
export const isJudged = (c: MonConfig) => c.enabled && !c.gone && c.status !== "NOT_REPORTED";

const STATUS_RANK = (s: string) => (s === "OK" ? 0 : s === "IDLE" ? 1 : s === "WARNING" ? 2 : s === "UNASSIGNED" ? 3 : 4);
const worstOf = (statuses: string[]) => statuses.reduce((w, s) => (STATUS_RANK(s) > STATUS_RANK(w) ? s : w), statuses[0] ?? "");

export function mergeConfigs(input: { api: ApiConfigs | null; remote: Row[]; local: Row[]; events: Row[]; fastcheck: FastcheckRow[] }): MonConfig[] {
  const { api, remote, local, events, fastcheck } = input;
  const byId = new Map<string, MonConfig>();
  const blank = (configId: string, extension: string): MonConfig => ({
    configId,
    extension,
    description: "",
    enabled: true,
    scope: "",
    scopeType: "unknown",
    scopeId: "",
    kind: "LOCAL",
    version: "",
    dataSource: "",
    status: "",
    statusSource: "none",
    hosts: [],
    group: "",
    fastcheck: [],
    inApi: false,
    gone: false,
  });
  for (const a of api?.configs ?? []) {
    const s = parseScope(a.scope);
    byId.set(a.objectId, {
      ...blank(a.objectId, a.extension),
      description: a.description,
      enabled: a.enabled,
      scope: a.scope,
      scopeType: s.type,
      scopeId: s.id,
      kind: kindFrom(a.activationContext, s.type),
      version: a.version ?? "",
      group: s.type === "ag_group" ? s.id : "",
      inApi: true,
    });
  }
  const get = (r: Row) => {
    const id = str(r.configId);
    let c = byId.get(id);
    if (!c) {
      c = { ...blank(id, str(r.extension)), gone: !!api && api.failed.length === 0 };
      byId.set(id, c);
    }
    if (!c.configEntity && r.configEntity) c.configEntity = str(r.configEntity);
    if (!c.dataSource && r.dataSource) c.dataSource = str(r.dataSource);
    return c;
  };
  for (const r of remote) {
    const c = get(r);
    c.status = str(r.status);
    c.statusSource = "dql";
    c.group = str(r.group) || c.group;
    c.agId = r.agId ? str(r.agId) : undefined;
    if (!c.inApi) {
      c.kind = "REMOTE";
      c.scopeType = "ag_group";
      c.scopeId = c.group;
    }
  }
  const localStatuses = new Map<string, string[]>();
  for (const r of local) {
    const c = get(r);
    if (r.host) c.hosts.push({ host: str(r.host), hostName: str(r.hostName) || str(r.host), status: str(r.status) });
    localStatuses.set(c.configId, [...(localStatuses.get(c.configId) ?? []), str(r.status)]);
    if (!c.inApi) c.kind = r.host ? "LOCAL" : "KUBERNETES";
  }
  for (const [id, statuses] of localStatuses) {
    const c = byId.get(id)!;
    c.status = worstOf(statuses);
    c.statusSource = "dql";
  }
  for (const r of events) {
    const c = byId.get(str(r.configId));
    if (!c) continue;
    c.message = str(r.content);
    c.messageLevel = str(r.loglevel);
    c.messageAt = str(r.timestamp);
  }
  for (const f of fastcheck) byId.get(f.configId)?.fastcheck.push(f);
  for (const c of byId.values()) {
    c.fastcheck.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    c.hosts.sort((a, b) => STATUS_RANK(b.status) - STATUS_RANK(a.status) || a.hostName.localeCompare(b.hostName));
    if (!c.enabled) c.status = "DISABLED";
    else if (c.statusSource === "dql") continue;
    else if (c.kind === "CLOUD") c.status = "NOT_REPORTED";
    else {
      // No status series in the timeframe: the latest error the framework reported for it (for example "not picked up").
      const latest = c.fastcheck.find((f) => f.level === "ERROR" && f.status);
      if (latest) {
        c.status = latest.status;
        c.statusSource = "event";
      } else c.status = "NO_DATA";
    }
  }
  return [...byId.values()].sort((a, b) => Number(isBroken(b)) - Number(isBroken(a)) || STATUS_RANK(b.status) - STATUS_RANK(a.status) || a.extension.localeCompare(b.extension));
}

/** The configuration as the ActiveGates tab models it (reuses its manual action). */
export const toExtConfig = (c: MonConfig): ExtConfig => ({
  configId: c.configId,
  configEntity: c.configEntity,
  extension: c.extension,
  dataSource: c.dataSource,
  status: c.status,
  group: c.group,
  agId: c.agId,
  message: c.message,
  messageAt: c.messageAt,
  messageLevel: c.messageLevel,
});

// --- Scope names ---------------------------------------------------------------------------------------------------
export type ScopeInfo = { id: string; name: string; lastSeen?: string; monitoringMode?: string; hostGroup?: string; hosts?: number };
export const toScopeInfo = (r: Row): ScopeInfo => ({
  id: str(r.id),
  name: str(r.name) || str(r.id),
  lastSeen: r.lastSeen ? str(r.lastSeen) : undefined,
  monitoringMode: r.monitoringMode ? str(r.monitoringMode) : undefined,
  hostGroup: r.hostGroup ? str(r.hostGroup) : undefined,
  hosts: r.id && str(r.id).startsWith("HOST_GROUP-") ? num(r.hosts) : undefined,
});
/** Hosts and host groups named by scopes or reporting hosts (input of extensionScopeNamesQuery). */
export const scopeIds = (configs: MonConfig[]) => [...new Set(configs.flatMap((c) => (c.scopeType === "host" || c.scopeType === "host_group" ? [c.scopeId] : [])))].sort();

// --- Diagnosis -----------------------------------------------------------------------------------------------------
export type ExtCheck = { id: string; status: CheckStatus; title: string; detail: string };
export type DiagnosisContext = { scopes: Map<string, ScopeInfo>; scopesLoaded: boolean; groups: AgGroup[] | null };

export function diagnoseConfig(c: MonConfig, ctx: DiagnosisContext): ExtCheck[] {
  const out: ExtCheck[] = [];
  const text = statusText(c) || c.status;
  if (!c.enabled) return [{ id: "status", status: "info", title: "Disabled", detail: "The configuration is disabled: it does not run until it is enabled again." }];
  if (c.gone) return [{ id: "status", status: "info", title: "Not in the Extensions API", detail: "The configuration reported in the timeframe but is no longer listed: deleted, or not an Extensions 2.0 configuration." }];
  out.push({
    id: "status",
    status: !isBroken(c) ? "pass" : c.status === "WARNING" ? "warn" : "fail",
    title: `Status: ${c.status}`,
    detail:
      c.statusSource === "event"
        ? `${text}. No status series in the timeframe; this is the status of the latest framework error.`
        : c.status === "NO_DATA"
          ? "The configuration is enabled but reported no dt.sfm.extension.status series and no framework error in the timeframe: nothing runs it."
          : text,
  });

  const s = c.scopeId ? ctx.scopes.get(c.scopeId) : undefined;
  if (c.scopeType === "host") {
    if (ctx.scopesLoaded && !s)
      out.push({
        id: "scope",
        status: "fail",
        title: `Scope host not seen in the last ${EXT_SCOPE_LOOKBACK}`,
        detail: `${c.scopeId} reported nothing in the last ${EXT_SCOPE_LOOKBACK}: the host is gone, so the configuration cannot run. Delete it, or scope it to a host group so new hosts get it.`,
      });
    else if (s) {
      const reports = c.hosts.some((h) => h.host === c.scopeId);
      out.push({
        id: "scope",
        status: reports ? "pass" : "warn",
        title: `Scope: host ${s.name}`,
        detail: reports ? "The host reports a status for this configuration." : `The host was last seen ${day(s.lastSeen)} (${s.monitoringMode ?? "unknown mode"}) but reports no status for this configuration in the timeframe.`,
      });
    }
  }
  if (c.scopeType === "host_group") {
    if (ctx.scopesLoaded && (!s || !s.hosts))
      out.push({ id: "scope", status: "fail", title: "Scope host group has no hosts", detail: `No host of ${s?.name ?? c.scopeId} reported in the last ${EXT_SCOPE_LOOKBACK}, so the configuration runs nowhere.` });
    else if (s) out.push({ id: "scope", status: "info", title: `Scope: host group ${s.name}`, detail: `${s.hosts} hosts in the group in the last ${EXT_SCOPE_LOOKBACK}; ${c.hosts.length} report this configuration in the timeframe.` });
  }
  if (c.scopeType === "environment") out.push({ id: "scope", status: "info", title: "Scope: environment", detail: `Every host in the environment gets it; ${c.hosts.length} report this configuration in the timeframe.` });
  if (c.kind === "LOCAL" || c.kind === "KUBERNETES") {
    const bad = c.hosts.filter((h) => !EXT_OK.includes(h.status));
    if (bad.length)
      out.push({
        id: "hosts",
        status: bad.some((h) => h.status !== "WARNING") ? "fail" : "warn",
        title: `${bad.length} of ${c.hosts.length} hosts not OK`,
        detail: `${bad.slice(0, 8).map((h) => `${h.hostName} (${h.status})`).join(", ")}${bad.length > 8 ? ", …" : ""}`,
      });
  }
  if (c.kind === "REMOTE" && c.group && ctx.groups) {
    const g = ctx.groups.find((x) => x.group === c.group);
    if (!g)
      out.push({ id: "group", status: "fail", title: `No ActiveGate in ${c.group} runs extensions`, detail: "Remote configurations run only on ActiveGates in the group they target with the Extensions module enabled (extension_controller_enabled)." });
    else if (!g.online) out.push({ id: "group", status: "fail", title: `No ActiveGate online in ${c.group}`, detail: `${g.activeGates} ActiveGates in the group have the Extensions module, none is connected.` });
    else out.push({ id: "group", status: "pass", title: `ActiveGate group ${c.group}`, detail: `${g.online} of ${g.activeGates} ActiveGates with the Extensions module are connected.` });
  }
  const last = c.fastcheck.find((f) => f.result === "failed" || f.result === "passed" || f.result === "unassigned");
  if (last?.result === "failed")
    out.push({
      id: "fastcheck",
      status: last.level === "ERROR" ? "fail" : "warn",
      title: "Fastcheck failed",
      detail: `${fastcheckReason(last.content)} (${last.occurrences.toLocaleString()}× between ${day(last.firstAt)} and ${day(last.lastAt)} UTC)`,
    });
  else if (last?.result === "unassigned") out.push({ id: "fastcheck", status: "fail", title: "Not picked up for execution", detail: `${last.content} (last ${day(last.lastAt)} UTC)` });
  else if (last?.result === "passed") out.push({ id: "fastcheck", status: "pass", title: "Fastcheck passed", detail: `Assigned to ActiveGate ${last.agId || "?"} in ${last.group || "?"} on ${day(last.lastAt)} UTC.` });
  if (c.message && isBroken(c) && c.message !== last?.content)
    out.push({ id: "reason", status: c.messageLevel === "ERROR" ? "fail" : "warn", title: `Latest ${c.messageLevel === "ERROR" ? "error" : "warning"} (${day(c.messageAt)} UTC)`, detail: c.message.slice(0, 600) });
  return out;
}

// --- Manual actions ------------------------------------------------------------------------------------------------
const framework = (configId?: string) =>
  `fetch dt.system.events, from:now()-7d\n| filter event.kind == "EXTENSIONS_EVENT" and event.provider == "EXTENSION_FRAMEWORK_CORE"${configId ? ` and dt.extension.config.id == "${configId}"` : ""}\n| fields timestamp, loglevel, dt.extension.status, content, dt.active_gate.group.name, dt.active_gate.id\n| sort timestamp desc`;

export const fastcheckAction = (c?: MonConfig): ManualAction => ({
  id: "fastcheck",
  title: c ? `Fastcheck failed: ${c.extension}` : "Fastcheck failed",
  steps: [
    "Fastcheck is the first check for a monitoring configuration, before any data is collected (for SNMP: one Get of the device's system name, with 18 seconds to respond). When it fails, the framework does not assign the configuration to the ActiveGate (Failed to assign … Reason: …).",
    "The reason names the endpoint and the error. Wrong credentials, a firewall between the ActiveGates of the group and the endpoint, or an endpoint that refuses the query are the usual causes.",
    "Fix the endpoint, the credentials or the network path, then watch the next fastcheck result in the log below (on this tenant the framework repeats a failed check about every hour).",
  ],
  variants: [{ label: "DQL: fastcheck and assignment results", language: "dql", code: framework(c?.configId) }],
  docs: [DOC.extSnmpTroubleshoot, DOC.extHealth, DOC.extManage],
});

export const localConfigAction = (c?: MonConfig): ManualAction => ({
  id: "local",
  title: c ? `${c.kind === "KUBERNETES" ? "Kubernetes" : "Local"} configuration not running: ${c.extension}` : "Local configuration not running",
  steps: [
    "Local extensions run in OneAgent on the hosts in the configuration's scope. Settings are defined at the environment level; a host group inherits them and a host inherits from its host group.",
    "A configuration scoped to one host runs only while that host reports with OneAgent. If the host is gone, delete the configuration, or scope it to a host group so new hosts get it.",
    "Every state except OK and IDLE is an error. Right after a change, allow at least 5 minutes while the configuration is scheduled and validated.",
    "Open the configuration in the Extensions app (Monitoring configurations: Health, Log viewer) for the full message per host.",
  ],
  variants: [
    {
      label: "DQL: status per host",
      language: "dql",
      code: `timeseries c = count(dt.sfm.extension.status), by:{dt.entity.host, dt.extension.status}${c ? `, filter:{dt.extension.config.id == "${c.configId}"}` : ""}, from:now()-24h`,
    },
    { label: "DQL: framework messages", language: "dql", code: framework(c?.configId) },
  ],
  docs: [DOC.extConcepts, DOC.extHealth, DOC.extManage, DOC.extStatusField],
});

/** Actions for one configuration: fastcheck first when it failed, then the remote (ActiveGates tab) or local steps. */
export function configActions(c: MonConfig): ManualAction[] {
  const out: ManualAction[] = [];
  if (c.fastcheck.some((f) => f.result === "failed")) out.push(fastcheckAction(c));
  out.push(c.kind === "REMOTE" ? extensionAction(toExtConfig(c)) : localConfigAction(c));
  return out;
}
export const genericExtActions = (): ManualAction[] => [fastcheckAction(), extensionAction(), localConfigAction()];

// --- Recommendations -----------------------------------------------------------------------------------------------
/** Display names per EXT_REC_MATCH technology; `hubName` is the Dynatrace Hub title of the extension (2026-10-24). */
export const EXT_REC_INFO: Record<string, { label: string; hubName: string; note?: string }> = {
  TOMCAT: { label: "Apache Tomcat", hubName: "Tomcat (JMX)", note: "Embedded Tomcat (Spring Boot 2.2 and later) registers no Tomcat MBeans unless server.tomcat.mbeanregistry.enabled=true." },
  JBOSS: { label: "JBoss / WildFly", hubName: "Connection Pools: JBoss" },
  WEBLOGIC: { label: "Oracle WebLogic", hubName: "Connection Pools: WebLogic" },
  WEBSPHERE: { label: "IBM WebSphere Application Server", hubName: "IBM WebSphere Application Server" },
  KAFKA: { label: "Apache Kafka broker", hubName: "Apache Kafka" },
  ZOOKEEPER: { label: "Apache ZooKeeper", hubName: "Apache ZooKeeper" },
  ACTIVEMQ: { label: "Apache ActiveMQ Classic", hubName: "Apache ActiveMQ Classic" },
  HADOOP: { label: "Apache Hadoop", hubName: "Hadoop" },
  SPARK: { label: "Apache Spark", hubName: "Apache Spark" },
  JENKINS: { label: "Jenkins", hubName: "Jenkins infrastructure performance" },
  RABBITMQ: { label: "RabbitMQ broker", hubName: "RabbitMQ (Management API)" },
  IBM_MQ: { label: "IBM MQ queue manager", hubName: "IBM MQ" },
  TIBCO_EMS: { label: "TIBCO EMS", hubName: "TIBCO EMS" },
  HAPROXY: { label: "HAProxy", hubName: "HAProxy" },
  IIS: { label: "Microsoft IIS", hubName: "Microsoft IIS" },
  MSMQ: { label: "Microsoft Message Queuing", hubName: "Microsoft Message Queuing (MSMQ)" },
  EXCHANGE: { label: "Microsoft Exchange Server", hubName: "Microsoft Exchange Server" },
  HYPERV: { label: "Microsoft Hyper-V", hubName: "Microsoft Hyper-V Infrastructure" },
  CITRIX_VDA: { label: "Citrix VDA", hubName: "Citrix DaaS & Virtual Apps and Desktops" },
  SAP_ABAP: { label: "SAP ABAP application server", hubName: "SAP GUI and ABAP Platform" },
  PHP_FPM: { label: "PHP-FPM", hubName: "PHP-FPM" },
  SQUID: { label: "Squid", hubName: "Squid" },
  COREDNS: { label: "CoreDNS", hubName: "CoreDNS (2.0)" },
  ETCD: { label: "etcd", hubName: "etcd for OpenShift" },
  OPENSHIFT_CONTROL_PLANE: { label: "OpenShift API server", hubName: "OpenShift Control Plane" },
  ISTIO: { label: "Istio control plane (istiod)", hubName: "Istio Service Mesh" },
  CONSUL: { label: "HashiCorp Consul", hubName: "Consul Service Mesh (StatsD)" },
  OTEL_COLLECTOR: { label: "OpenTelemetry Collector", hubName: "OpenTelemetry Collector Extension" },
  ALERTMANAGER: { label: "Prometheus Alertmanager", hubName: "Prometheus Alertmanager (v2)" },
  CEPH: { label: "Ceph", hubName: "Ceph storage" },
  REDPANDA: { label: "Redpanda", hubName: "Redpanda" },
};
export const recInfo = (tech: string) => EXT_REC_INFO[tech] ?? { label: tech, hubName: tech };

export type RecState = "none" | "partial" | "covered";
export type RecRow = {
  tech: string;
  label: string;
  hubName: string;
  note?: string;
  extension: string;
  processes: number;
  hosts: number;
  coveredHosts: number;
  uncoveredHosts: number;
  /** null: the extension list was not readable. */
  installed: boolean | null;
  version?: string;
  /** Enabled configurations of the extension in the environment, and how many of them are broken. */
  configs: number;
  brokenConfigs: number;
  /** A local configuration of the extension is scoped to the whole environment. */
  envWide: boolean;
  state: RecState;
};
const REC_ORDER: RecState[] = ["none", "partial", "covered"];

export function toRecRows(rows: Row[], api: ApiConfigs | null, configs: MonConfig[]): RecRow[] {
  return rows
    .map((r): RecRow => {
      const tech = str(r.recTech);
      const info = recInfo(tech);
      const extension = EXT_REC_MATCH.find((m) => m.tech === tech)?.extension ?? "";
      const own = configs.filter((c) => c.extension === extension && c.enabled && !c.gone);
      const hosts = num(r.hosts);
      const coveredHosts = num(r.coveredHosts);
      return {
        tech,
        label: info.label,
        hubName: info.hubName,
        note: info.note,
        extension,
        processes: num(r.processes),
        hosts,
        coveredHosts,
        uncoveredHosts: Math.max(0, hosts - coveredHosts),
        installed: api ? api.extensions.has(extension) : null,
        version: api?.extensions.get(extension),
        configs: own.length,
        brokenConfigs: own.filter(isBroken).length,
        envWide: own.some((c) => c.kind === "LOCAL" && c.scopeType === "environment"),
        state: coveredHosts >= hosts ? "covered" : coveredHosts > 0 ? "partial" : "none",
      };
    })
    .sort((a, b) => REC_ORDER.indexOf(a.state) - REC_ORDER.indexOf(b.state) || b.uncoveredHosts - a.uncoveredHosts || a.label.localeCompare(b.label));
}

// --- Network devices (SNMP) ----------------------------------------------------------------------------------------
// Network devices run no OneAgent, so SNMP coverage is judged from the extensions and their monitoring configurations,
// not from processes. Hub IDs and names verified 2026-10-24. SNMP Autodiscovery (docs): scans subnets and IP ranges for
// SNMP-enabled devices (SNMP v2c / v3), reports each one as an entity that is the entry point to the device extension
// that fits it, and builds a topology for devices monitored by the extensions in SNMP_DEVICE_EXTENSIONS.
export const SNMP_AUTODISCOVERY = { id: "com.dynatrace.extension.snmp-auto-discovery", hubName: "SNMP Autodiscovery" };
export const SNMP_DEVICE_EXTENSIONS = [
  { id: "com.dynatrace.extension.snmp-generic-device", hubName: "Generic network device" },
  { id: "com.dynatrace.extension.snmp-generic-cisco-device", hubName: "Generic Cisco Device" },
  { id: "com.dynatrace.extension.snmp-generic-juniper", hubName: "Juniper Networks (SNMP)" },
  { id: "com.dynatrace.extension.f5.bigip", hubName: "F5 BIG-IP" },
  { id: "com.dynatrace.extension.palo-alto-generic", hubName: "Palo Alto firewalls" },
];
/** Device extensions: the topology ones above plus any other SNMP extension (name contains "snmp"); traps are events, not devices. */
const isSnmpDeviceExt = (name: string) =>
  SNMP_DEVICE_EXTENSIONS.some((e) => e.id === name) || (/snmp/i.test(name) && name !== SNMP_AUTODISCOVERY.id && !/snmp-traps/i.test(name));

const shortName = (name: string) => SNMP_DEVICE_EXTENSIONS.find((e) => e.id === name)?.hubName ?? name.replace(/^com\.dynatrace\.(extensions?\.)?/, "");

export type SnmpState = "none" | "installed" | "broken" | "in-use" | "unknown";
export type SnmpRow = {
  id: "autodiscovery" | "devices";
  label: string;
  /** Extension the setup link opens (the generic one for devices when none is installed). */
  extension: string;
  hubName: string;
  /** null: the extension list was not readable. */
  installed: boolean | null;
  /** SNMP extensions in the environment, and enabled configurations of them (broken ones counted separately). */
  extensions: string[];
  configs: number;
  broken: number;
  state: SnmpState;
  advice: string;
  docs: { title: string; url: string }[];
};

export function snmpRows(api: ApiConfigs | null, configs: MonConfig[]): SnmpRow[] {
  const installedNames = api ? [...api.extensions.keys()] : [];
  const row = (id: SnmpRow["id"], match: (name: string) => boolean, fallback: { id: string; hubName: string }, label: string, docs: SnmpRow["docs"]): SnmpRow => {
    const extensions = installedNames.filter(match).sort();
    const own = configs.filter((c) => match(c.extension) && c.enabled && !c.gone);
    const broken = own.filter(isBroken).length;
    const installed = api ? extensions.length > 0 : null;
    const state: SnmpState = own.length > broken ? "in-use" : own.length ? "broken" : installed === null ? "unknown" : installed ? "installed" : "none";
    const ext = SNMP_DEVICE_EXTENSIONS.find((e) => extensions.includes(e.id)) ?? (extensions[0] ? { id: extensions[0], hubName: extensions[0] } : fallback);
    return { id, label, extension: id === "autodiscovery" ? fallback.id : ext.id, hubName: id === "autodiscovery" ? fallback.hubName : ext.hubName, installed, extensions, configs: own.length, broken, state, advice: "", docs };
  };
  const auto = row("autodiscovery", (n) => n === SNMP_AUTODISCOVERY.id, SNMP_AUTODISCOVERY, "SNMP Autodiscovery", [DOC.snmpAutodiscovery]);
  const dev = row("devices", isSnmpDeviceExt, SNMP_DEVICE_EXTENSIONS[0], "SNMP device extensions", [DOC.snmpGeneric, DOC.snmpAutodiscovery]);
  const n = (x: number, one: string) => `${x} ${one}${x === 1 ? "" : "s"}`;
  auto.advice = {
    none: "Not in use. Add SNMP Autodiscovery from Dynatrace Hub: it scans your subnets and IP ranges for SNMP-enabled network devices (SNMP v2c / v3), lists them as entities and points each one to the extension that monitors it best. Needs an ActiveGate 1.280+ with the API routing module (restInterface) and a platform token with storage:buckets:read and storage:smartscape:read.",
    installed: "In the environment without a monitoring configuration: add one with the subnets or IP ranges to scan and the SNMP credentials, on an ActiveGate group that reaches those networks.",
    broken: `${n(auto.configs, "configuration")}, none running: fix ${auto.configs === 1 ? "it" : "them"} in Broken monitoring configurations above.`,
    "in-use": `In use: ${n(auto.configs, "configuration")}${auto.broken ? `, ${auto.broken} broken` : ""}.`,
    unknown: "Not known: the Extensions API was not readable and no SNMP Autodiscovery configuration reports a status.",
  }[auto.state];
  const used = [...new Set(configs.filter((c) => isSnmpDeviceExt(c.extension) && c.enabled && !c.gone).map((c) => c.extension))].sort();
  dev.advice = {
    none: "No network device is monitored over SNMP. Add the Generic network device extension (interfaces, traffic, SNMP health) or the vendor extension for your devices (Cisco, Juniper, F5 BIG-IP, Palo Alto); devices monitored by these appear in the SNMP Autodiscovery topology.",
    installed: `${dev.extensions.map(shortName).join(", ")} ${dev.extensions.length === 1 ? "is" : "are"} in the environment without a monitoring configuration: add one per device or device group, on an ActiveGate group that reaches the devices.`,
    broken: `${n(dev.configs, "configuration")}, none running: fix ${dev.configs === 1 ? "it" : "them"} in Broken monitoring configurations above.`,
    "in-use": `In use: ${n(dev.configs, "configuration")} of ${used.map(shortName).join(", ")}${dev.broken ? `, ${dev.broken} broken` : ""}.`,
    unknown: "Not known: the Extensions API was not readable and no SNMP device configuration reports a status.",
  }[dev.state];
  return [auto, dev];
}

/** What to do for a recommendation, in one line. */
export function recAdvice(r: RecRow): string {
  if (r.state === "covered") return `Covered: the extension reports from all ${r.hosts.toLocaleString()} hosts.`;
  const where = `${r.uncoveredHosts.toLocaleString()} of ${r.hosts.toLocaleString()} hosts`;
  if (r.installed === false) return `Add ${r.hubName} from Dynatrace Hub, then a monitoring configuration for ${where}.`;
  if (!r.configs) return `${r.hubName} is in the environment without a monitoring configuration: add one for ${where}.`;
  const n = `${r.configs} configuration${r.configs === 1 ? "" : "s"}`;
  if (r.brokenConfigs === r.configs) return `${n}, all broken (see Broken monitoring configurations): fix or re-scope ${r.configs === 1 ? "it" : "them"} to cover ${where}.`;
  if (r.envWide) return `An environment-wide configuration exists, but ${where} report no status for it: open Processes for those hosts and the configuration's Health in the Extensions app.`;
  return `${n} exist${r.configs === 1 ? "s" : ""}, but none reports from ${where}: scope one to their host groups (or the environment), or check that a remote one targets these endpoints.`;
}
