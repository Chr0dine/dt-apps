import type { CheckStatus, Instance } from "./deepMonitoring";
import { DOC, techInfo, type TechInfo } from "./deepTech";
import type { DocLink, ManualAction } from "./remediation";

// ---------------------------------------------------------------------------
// Kubernetes tab model: monitoring modes and injection statuses computed by the queries in queries.ts (Kubernetes tab), their
// labels and colours, the diagnosis of one workload or namespace, and the documented manual fixes. Annotation names,
// defaults and steps come from the Dynatrace Operator docs in DOC (deepTech.ts), fetched on 2026-10-24.
// ---------------------------------------------------------------------------

type Row = Record<string, any>;
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const bool = (v: unknown) => v === true || v === "true";
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : v ? [str(v)] : []);

// --- Categories ------------------------------------------------------------------
// Categorical slots of the validated chart palette (dataviz reference palette, light / dark steps). Each category owns a
// fixed slot so its colour never changes with the data; "Excluded by design" and mixed values use the neutral grey.
const SLOTS: [light: string, dark: string][] = [
  ["#2a78d6", "#3987e5"], // 1 blue
  ["#eb6834", "#d95926"], // 2 orange
  ["#1baf7a", "#199e70"], // 3 aqua
  ["#eda100", "#c98500"], // 4 yellow
  ["#e87ba4", "#d55181"], // 5 magenta
  ["#008300", "#008300"], // 6 green
  ["#6250d6", "#9085e9"], // 7 violet
  ["#e34948", "#e66767"], // 8 red
];
const NEUTRAL: [string, string] = ["#898781", "#898781"];
export type Theme = "light" | "dark";

export type Category = { id: string; label: string; slot: number | null; detail: string };
export const categoryColor = (c: Category, theme: Theme) => (c.slot ? SLOTS[c.slot - 1] : NEUTRAL)[theme === "dark" ? 1 : 0];

/** Monitoring mode of a namespace: the mode of the DynaKube that selects it. Pods, workloads and containers inherit it. */
export const MODES: Category[] = [
  { id: "CLOUD_NATIVE_FULL_STACK", label: "Cloud-native full-stack", slot: 1, detail: "Code modules injected into pods by the webhook plus a host OneAgent per node: full-stack monitoring." },
  { id: "CLASSIC_FULL_STACK", label: "Classic full-stack", slot: 2, detail: "The host OneAgent DaemonSet injects every container. Legacy: not supported with platform tokens or in Latest Dynatrace environments." },
  { id: "APPLICATION_MONITORING", label: "Application monitoring", slot: 3, detail: "Code modules only, no host OneAgent: traces and code-level data, but no host or container infrastructure monitoring from OneAgent." },
  { id: "OTEL", label: "OpenTelemetry", slot: 4, detail: "No DynaKube selects the namespace; its pods are instrumented with OpenTelemetry." },
  { id: "HOST_MONITORING", label: "Host monitoring only", slot: 5, detail: "Host OneAgent only (infrastructure): no code modules, so no traces or code-level data." },
  { id: "KUBERNETES_ONLY", label: "No OneAgent (ActiveGate only)", slot: 6, detail: "The DynaKube deploys no OneAgent: Kubernetes API monitoring (and KSPM) only." },
  { id: "NOT_SELECTED", label: "Not selected by a DynaKube", slot: 7, detail: "The cluster has an injecting DynaKube, but its namespaceSelector (or a default exclusion) does not match this namespace." },
  { id: "NO_DYNAKUBE", label: "No DynaKube", slot: 8, detail: "No Dynatrace Operator DynaKube in the cluster." },
  { id: "DYNATRACE", label: "Dynatrace components", slot: null, detail: "The Operator's own namespace: never injected." },
  { id: "MIXED", label: "Mixed", slot: null, detail: "Pods of this workload are in different modes." },
  { id: "UNKNOWN", label: "Unknown", slot: null, detail: "The container's pod is not in Smartscape." },
];

/** Injection status of a pod (from its annotations and spec); workloads add PARTIAL, containers CONTAINER_BLOCK / HOST_ONEAGENT. */
export const STATUSES: Record<string, { label: string; group: string; detail: string }> = {
  ONEAGENT: { label: "OneAgent injected", group: "ONEAGENT", detail: "The webhook injected the OneAgent code module (oneagent.dynatrace.com/injected: true)." },
  CLASSIC: { label: "Host OneAgent (classic full-stack)", group: "ONEAGENT", detail: "Classic full-stack: the host OneAgent injects the containers, so the pod carries no webhook annotation." },
  ONEAGENT_OTEL: { label: "OneAgent + OpenTelemetry", group: "ONEAGENT_OTEL", detail: "OneAgent injected and the pod is also instrumented with OpenTelemetry: risk of duplicate spans and extra overhead." },
  OTEL: { label: "OpenTelemetry only", group: "OTEL", detail: "Instrumented with OpenTelemetry (Operator OTLP auto-configuration, OpenTelemetry Operator or an OTLP exporter), not OneAgent." },
  RESTART_REQUIRED: { label: "Roll out required", group: "ROLLOUT", detail: "Selected namespace, nothing blocks injection, but the pod has no injection annotation: it was created before the namespace was selected or the Operator was installed." },
  PARTIAL: { label: "Partially injected", group: "ROLLOUT", detail: "Pods of the workload differ (for example older pods from before a rollout)." },
  POD_BLOCK: { label: "Pod opt-out annotation", group: "OPT_OUT", detail: 'dynatrace.com/inject or oneagent.dynatrace.com/inject is "false" on the pod.' },
  CONTAINER_BLOCK: { label: "Container excluded", group: "OPT_OUT", detail: 'container.inject.dynatrace.com/<container>: "false" excludes this container from injection.' },
  NAMESPACE_BLOCK: { label: "Namespace not selected", group: "NAMESPACE", detail: "No DynaKube namespaceSelector matches the namespace." },
  METADATA_ONLY: { label: "Metadata enrichment only", group: "NAMESPACE", detail: "The webhook processed the pod but did not inject OneAgent: only a metadata-enrichment selector matches the namespace." },
  OPT_IN_REQUIRED: { label: "Opt-in required", group: "CONFIG", detail: 'automatic-injection is "false" on the DynaKube, so pods need oneagent.dynatrace.com/inject: "true".' },
  NO_INJECTION: { label: "Mode does not inject", group: "CONFIG", detail: "The cluster's DynaKubes run host monitoring or no OneAgent, so nothing injects code modules." },
  FAILED: { label: "Injection failed", group: "CONFIG", detail: 'The webhook skipped OneAgent (oneagent.dynatrace.com/injected: "false"); the reason annotation says why.' },
  NO_DYNAKUBE: { label: "No DynaKube", group: "NO_OPERATOR", detail: "No Dynatrace Operator DynaKube in the cluster." },
  HOST_ONEAGENT: { label: "Host OneAgent, no Operator", group: "NO_OPERATOR", detail: "Seen by a host-installed OneAgent in a cluster without a DynaKube or Kubernetes monitoring." },
  NO_POD: { label: "Pod not found", group: "NO_OPERATOR", detail: "The container's pod is not in Smartscape." },
  SYSTEM: { label: "System namespace", group: "EXCLUDED", detail: "kube-* and openshift-* namespaces are excluded from injection by default." },
  DYNATRACE: { label: "Dynatrace components", group: "EXCLUDED", detail: "The Operator's own namespace is never injected." },
};

/** Donut slices for injection status: 8 groups (one palette slot each) plus "Excluded by design". */
export const STATUS_GROUPS: Category[] = [
  { id: "ONEAGENT", label: "OneAgent", slot: 1, detail: "Injected by the webhook, or by the host OneAgent in classic full-stack." },
  { id: "ONEAGENT_OTEL", label: "OneAgent + OpenTelemetry", slot: 2, detail: STATUSES.ONEAGENT_OTEL.detail },
  { id: "OTEL", label: "OpenTelemetry only", slot: 3, detail: STATUSES.OTEL.detail },
  { id: "ROLLOUT", label: "Roll out required", slot: 4, detail: "Nothing blocks injection, but pods were created before it was enabled (or only some pods are injected)." },
  { id: "OPT_OUT", label: "Pod or container opt-out", slot: 5, detail: "An annotation excludes the pod or one of its containers." },
  { id: "NAMESPACE", label: "Namespace not selected", slot: 6, detail: "No DynaKube's OneAgent namespaceSelector matches the namespace." },
  { id: "CONFIG", label: "Not injected (mode, opt-in, failure)", slot: 7, detail: "The DynaKube mode does not inject, opt-in is required, or the webhook skipped the pod." },
  { id: "NO_OPERATOR", label: "No Operator", slot: 8, detail: "The cluster has no DynaKube." },
  { id: "EXCLUDED", label: "Excluded by design", slot: null, detail: "System namespaces and the Operator's own components." },
];

/** Namespace injection coverage (share of its pods with OneAgent). */
export const NAMESPACE_STATUSES: Category[] = [
  { id: "ALL", label: "All pods with OneAgent", slot: 1, detail: "Every pod in the namespace has OneAgent." },
  { id: "PARTIAL", label: "Some pods with OneAgent", slot: 4, detail: "Some pods are not injected." },
  { id: "OTEL", label: "OpenTelemetry only", slot: 3, detail: "No pod has OneAgent, some use OpenTelemetry." },
  { id: "NONE", label: "No pod injected", slot: 8, detail: "The namespace has pods, none with OneAgent or OpenTelemetry." },
  { id: "NO_PODS", label: "No pods", slot: null, detail: "No running pods." },
  { id: "SYSTEM", label: "System namespace", slot: null, detail: STATUSES.SYSTEM.detail },
  { id: "DYNATRACE", label: "Dynatrace components", slot: null, detail: MODES.find((m) => m.id === "DYNATRACE")!.detail },
];
/** Namespace statuses left out of the "Namespaces with OneAgent" gauge. */
export const NAMESPACE_EXCLUDED = ["NO_PODS", "SYSTEM", "DYNATRACE"];

export const modeOf = (id: string): Category => MODES.find((m) => m.id === id) ?? { id, label: id, slot: null, detail: "" };
export const statusLabel = (id: string) => STATUSES[id]?.label ?? id;
export const statusGroupOf = (id: string): Category => STATUS_GROUPS.find((g) => g.id === (STATUSES[id]?.group ?? "EXCLUDED")) ?? STATUS_GROUPS[STATUS_GROUPS.length - 1];
/** Pod / workload / container statuses that belong to a donut group (for the search filter). */
export const statusesInGroup = (group: string) => Object.keys(STATUSES).filter((s) => STATUSES[s].group === group);

/** Statuses that count as instrumented / eligible for the "Pods with OneAgent" gauge. */
export const ONEAGENT_STATUSES = ["ONEAGENT", "CLASSIC", "ONEAGENT_OTEL"];
export const EXCLUDED_STATUSES = ["SYSTEM", "DYNATRACE"];

// --- Clusters and deployments ----------------------------------------------------
/** Managed cluster from a cloud integration (EKS / AKS / GKE), on the row of the Kubernetes cluster it is, or on its own row. */
export type CloudCluster = { id: string; name: string; provider: string; account: string; location: string; resourceGroup: string; version: string; state: string };
export const CLOUD_LABEL: Record<string, string> = { EKS: "Amazon EKS", AKS: "Azure AKS", GKE: "Google GKE" };
export const CLOUD_INTEGRATION: Record<string, string> = { EKS: "AWS", AKS: "Azure", GKE: "Google Cloud" };

export type Dynakube = {
  id: string;
  name: string;
  cluster: string;
  clusterId?: string;
  clusterUid: string;
  namespace: string;
  mode: string;
  autoInjection: boolean;
  phase: string;
  operatorVersions: string[];
  oneAgentVersion: string;
  codeModulesVersion: string;
  activeGateVersion: string;
  activeGateCapabilities: string[];
  hostGroup: string;
  features: string[];
  selected: number;
  nsMatch: string;
  /** OneAgent namespaceSelector as JSON text; empty = none (every namespace except the default exclusions). */
  namespaceSelector: string;
  failing: string[];
  apiVersion: string;
  annotations: Record<string, string>;
  /** Cluster rows without a DynaKube: whether Kubernetes monitoring sees the cluster, and how many containers a host OneAgent reports. */
  k8sMonitoring: boolean;
  containers: number;
  /** Set when the cluster is (or is only) a managed cluster from a cloud integration. */
  cloud?: CloudCluster;
};

const parseJson = (s: unknown): Record<string, string> => {
  try {
    const v = JSON.parse(str(s) || "{}");
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
};

export function toDynakube(r: Row): Dynakube {
  const features = [
    bool(r.metadataEnrichment) && "Metadata enrichment",
    bool(r.logMonitoring) && "Log monitoring",
    bool(r.kspm) && "KSPM",
    bool(r.extensions) && "Extensions",
    bool(r.telemetryIngest) && "Telemetry ingest (Collector)",
    bool(r.otlpExporter) && "OTLP exporter auto-config",
  ].filter((f): f is string => !!f);
  return {
    id: str(r.id),
    name: str(r.name),
    cluster: str(r.cluster),
    clusterId: r.clusterId ? str(r.clusterId) : undefined,
    clusterUid: str(r.clusterUid),
    namespace: str(r.namespace),
    mode: str(r.mode),
    autoInjection: r.autoInjection === undefined || r.autoInjection === null ? true : bool(r.autoInjection),
    phase: str(r.phase),
    operatorVersions: strings(r.operatorVersions),
    oneAgentVersion: str(r.oneAgentVersion),
    codeModulesVersion: str(r.codeModulesVersion),
    activeGateVersion: str(r.activeGateVersion),
    activeGateCapabilities: strings(r.activeGateCapabilities),
    hostGroup: str(r.hostGroup),
    features,
    selected: Number(r.selected ?? 0) || 0,
    nsMatch: str(r.nsMatch),
    namespaceSelector: str(r.namespaceSelector) === "{}" ? "" : str(r.namespaceSelector),
    failing: strings(r.failing),
    apiVersion: str(r.apiVersion),
    annotations: parseJson(r.annotations),
    k8sMonitoring: r.k8sMonitoring === undefined || r.k8sMonitoring === null ? true : bool(r.k8sMonitoring),
    containers: Number(r.containers ?? 0) || 0,
    cloud: r.cloudId
      ? {
          id: str(r.cloudId),
          name: str(r.cloudName),
          provider: str(r.cloudProvider),
          account: str(r.cloudAccount),
          location: str(r.cloudLocation),
          resourceGroup: str(r.cloudResourceGroup),
          version: str(r.cloudVersion),
          state: str(r.cloudState),
        }
      : undefined,
  };
}

/** One per cluster: Kubernetes clusters (by UID) and cloud-integration clusters without a Kubernetes match (by cloud node ID). */
export type ClusterSummary = {
  key: string;
  uid: string;
  name: string;
  /** DynaKube modes; empty = no DynaKube. */
  modes: string[];
  k8sMonitoring: boolean;
  containers: number;
  cloud?: CloudCluster;
  /** Seen only through a cloud integration: no Operator, no Kubernetes monitoring. */
  cloudOnly: boolean;
};

export function toClusters(rows: Dynakube[]): ClusterSummary[] {
  const m = new Map<string, ClusterSummary>();
  for (const d of rows) {
    const key = d.clusterUid || d.cloud?.id || d.cluster;
    const c = m.get(key) ?? { key, uid: d.clusterUid, name: d.cluster || d.clusterUid, modes: [], k8sMonitoring: d.k8sMonitoring, containers: d.containers, cloud: d.cloud, cloudOnly: !d.clusterUid && !!d.cloud };
    if (d.mode !== "NONE") c.modes.push(d.mode);
    c.cloud ??= d.cloud;
    m.set(key, c);
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** A cluster gets full-stack monitoring from cloud-native or classic full-stack, or application monitoring plus host monitoring. */
export const isFullStack = (modes: string[]) =>
  modes.some((x) => x === "CLOUD_NATIVE_FULL_STACK" || x === "CLASSIC_FULL_STACK") || (modes.includes("APPLICATION_MONITORING") && modes.includes("HOST_MONITORING"));

export const cloudText = (c: CloudCluster) =>
  [
    `${CLOUD_LABEL[c.provider] ?? c.provider} ${c.name}`,
    c.account,
    c.provider === "AKS" && c.resourceGroup ? `resource group ${c.resourceGroup}` : "",
    c.location,
    c.version && `Kubernetes ${c.version}`,
    c.state,
  ]
    .filter(Boolean)
    .join(" · ");

export const DK_MODE_LABEL: Record<string, string> = {
  CLOUD_NATIVE_FULL_STACK: "Cloud-native full-stack",
  APPLICATION_MONITORING: "Application monitoring",
  CLASSIC_FULL_STACK: "Classic full-stack",
  HOST_MONITORING: "Host monitoring",
  KUBERNETES_ONLY: "No OneAgent (ActiveGate only)",
  NONE: "No DynaKube",
};

/** Containers a DynaKube excludes from injection for every pod (container.inject.dynatrace.com/<container>: "false"). */
export const dkContainerExclusions = (dk: Dynakube) =>
  Object.entries(dk.annotations)
    .filter(([k, v]) => k.startsWith("container.inject.dynatrace.com/") && v === "false")
    .map(([k]) => k.slice("container.inject.dynatrace.com/".length));

// --- Diagnosis -------------------------------------------------------------------
/** "cluster" targets are clusters without a DynaKube, diagnosed from the cluster row alone (there are no pods to read). */
export type Target = { kind: "workload" | "namespace" | "cluster"; clusterUid: string; cluster: string; namespace: string; workloadKind?: string; workload?: string; nodeId?: string; cloud?: CloudCluster };
export const targetName = (t: Target) =>
  t.kind === "workload" ? `${t.workloadKind}/${t.workload} in ${t.namespace} (${t.cluster})` : t.kind === "namespace" ? `namespace ${t.namespace} (${t.cluster})` : `cluster ${t.cluster}`;

export type Pod = {
  id: string;
  name: string;
  uid: string;
  workload: string;
  status: string;
  mode: string;
  reason: string;
  oneAgent: boolean;
  otelDynatrace: boolean;
  otelOperator: boolean;
  otelSdk: boolean;
  podBlock: boolean;
  optIn: boolean;
  system: boolean;
  nsDk: string;
  nsDkMode: string;
  nsAutoInjection: boolean | null;
  /** Containers this pod excludes from injection. */
  excludedContainers: string[];
  /** The opt-out annotation keys set to "false" on the pod. */
  optOutKeys: string[];
  phase: string;
};

export function toPod(r: Row): Pod {
  const a = parseJson(r.annotations);
  return {
    id: str(r.id),
    name: str(r.name),
    uid: str(r.podUid),
    workload: r.workload ? `${str(r.workloadKind)}/${str(r.workload)}` : "",
    status: str(r.status),
    mode: str(r.mode),
    reason: str(r.reason),
    oneAgent: bool(r.oneAgent),
    otelDynatrace: bool(r.otelDynatrace),
    otelOperator: bool(r.otelOperator),
    otelSdk: bool(r.otelSdk),
    podBlock: bool(r.podBlock),
    optIn: bool(r.optIn),
    system: bool(r.system),
    nsDk: str(r.nsDk),
    nsDkMode: str(r.nsDkMode),
    nsAutoInjection: r.nsAutoInjection === null || r.nsAutoInjection === undefined ? null : bool(r.nsAutoInjection),
    excludedContainers: Object.entries(a)
      .filter(([k, v]) => k.startsWith("container.inject.dynatrace.com/") && v === "false")
      .map(([k]) => k.slice("container.inject.dynatrace.com/".length)),
    optOutKeys: ["dynatrace.com/inject", "oneagent.dynatrace.com/inject"].filter((k) => a[k] === "false"),
    phase: str(r.phase),
  };
}

export type OpFix =
  | "install"
  | "mode"
  | "health"
  | "namespace"
  | "pod-optout"
  | "container-optout"
  | "opt-in"
  | "rollout"
  | "otel-double"
  | "otel-collector"
  | "unsupported-tech"
  | "failed"
  | "deep";
export type OpCheck = { id: string; status: CheckStatus; title: string; detail: string; fix?: OpFix };

/** One technology without a OneAgent code module found in the target's processes. */
export type UnsupportedTech = { info: TechInfo; processes: string[] };

export type OpDiagnosis = {
  target: Target;
  dynakubes: Dynakube[];
  pods: Pod[];
  processes: Instance[];
  unsupported: UnsupportedTech[];
  checks: OpCheck[];
};

const list = (xs: string[], max = 4) => `${xs.slice(0, max).join(", ")}${xs.length > max ? `, … (${xs.length} in total)` : ""}`;
const n = (x: number, one: string, many = `${one}s`) => `${x.toLocaleString()} ${x === 1 ? one : many}`;
/** "1 pod has" / "2 pods have". */
const nv = (x: number, one: string, many: string, verbOne: string, verbMany: string) => `${n(x, one, many)} ${x === 1 ? verbOne : verbMany}`;
const INJECTING = ["CLOUD_NATIVE_FULL_STACK", "APPLICATION_MONITORING"];

/** Why a cluster without a DynaKube is not monitored by the Operator: cloud integration only, host OneAgents only, or ActiveGate only. */
export function diagnoseCluster(target: Target, c: ClusterSummary): OpDiagnosis {
  const checks: OpCheck[] = [];
  const cloud = c.cloud;
  if (c.cloudOnly && cloud) {
    checks.push({
      id: "operator",
      status: "fail",
      title: `Seen only through the ${CLOUD_INTEGRATION[cloud.provider] ?? cloud.provider} integration: no Dynatrace Operator`,
      detail: `${cloudText(cloud)}. Dynatrace knows the managed cluster resource and its cloud metrics, but no nodes, namespaces, workloads or pods, and nothing is injected. No Kubernetes-monitored cluster matches it (by EKS node group, AKS node resource group, GKE node names, or by name).`,
      fix: "install",
    });
  } else {
    checks.push({ id: "operator", status: "fail", title: "No Dynatrace Operator in the cluster", detail: `No DynaKube was found in ${target.cluster}${cloud ? ` (${cloudText(cloud)})` : ""}.`, fix: "install" });
    if (c.k8sMonitoring) {
      checks.push({ id: "k8s", status: "info", title: "Kubernetes API monitoring without a DynaKube", detail: "The cluster is monitored through the Kubernetes API (an ActiveGate outside the Operator), so namespaces and workloads are visible, but nothing injects OneAgent into pods." });
    } else if (c.containers > 0) {
      checks.push({
        id: "host",
        status: "warn",
        title: "Host-installed OneAgents only",
        detail: `OneAgents installed on the nodes report ${n(c.containers, "running container")}, but the cluster has no Kubernetes monitoring: no namespaces, workloads or pods in Smartscape, no metadata enrichment and no per-namespace control. Replace them with the Operator (cloud-native full-stack).`,
        fix: "install",
      });
    }
  }
  return { target, dynakubes: [], pods: [], processes: [], unsupported: [], checks };
}

/** Why the selected workload / namespace is (or isn't) full-stack monitored, from its pods, the cluster's DynaKubes and its processes. */
export function diagnoseTarget(target: Target, clusterDks: Dynakube[], pods: Pod[], processes: Instance[]): OpDiagnosis {
  const checks: OpCheck[] = [];
  const dks = clusterDks.filter((d) => d.mode !== "NONE");
  const nsDkName = pods.find((p) => p.nsDk)?.nsDk ?? "";
  const nsDk = dks.find((d) => d.name === nsDkName);
  const operatorNs = dks.some((d) => d.namespace === target.namespace);
  const system = /^(kube-|openshift-)/.test(target.namespace);
  const unsupported = new Map<string, UnsupportedTech>();
  for (const p of processes) {
    const info = techInfo(p.processType);
    if (info.kind !== "none" || info.alternativeKind === "system") continue;
    const u = unsupported.get(info.key) ?? { info, processes: [] };
    u.processes.push(p.name);
    unsupported.set(info.key, u);
  }
  const unsupportedList = [...unsupported.values()];
  const out = (): OpDiagnosis => ({ target, dynakubes: dks, pods, processes, unsupported: unsupportedList, checks });

  // 1. Operator in the cluster.
  if (dks.length === 0) {
    checks.push({ id: "operator", status: "fail", title: "No Dynatrace Operator in the cluster", detail: `No DynaKube was found in ${target.cluster}. Install the Dynatrace Operator and apply a DynaKube in cloud-native full-stack mode.`, fix: "install" });
    return out();
  }
  checks.push({ id: "operator", status: "pass", title: "Dynatrace Operator installed", detail: `${n(dks.length, "DynaKube")} in ${target.cluster}: ${dks.map((d) => `${d.name} (${DK_MODE_LABEL[d.mode] ?? d.mode}, Operator ${d.operatorVersions.join(" / ") || "version unknown"})`).join("; ")}.` });

  // 2. Health.
  const unhealthy = dks.filter((d) => d.phase && d.phase !== "Running");
  const failing = dks.filter((d) => d.failing.length > 0);
  if (unhealthy.length || failing.length) {
    checks.push({
      id: "health",
      status: "warn",
      title: "DynaKube not healthy",
      detail: [...unhealthy.map((d) => `${d.name} is in phase ${d.phase}`), ...failing.map((d) => `${d.name} has failing conditions: ${d.failing.join(", ")}`)].join("; ") + ".",
      fix: "health",
    });
  }

  // 3. Operator's own namespace / system namespaces.
  if (operatorNs) {
    checks.push({ id: "namespace", status: "info", title: "Dynatrace Operator namespace", detail: "The Operator's own namespace is never injected; its components are monitored through the DynaKube." });
    return out();
  }

  // 4. Mode.
  const hostDk = dks.find((d) => ["CLOUD_NATIVE_FULL_STACK", "CLASSIC_FULL_STACK", "HOST_MONITORING"].includes(d.mode));
  const classic = dks.find((d) => d.mode === "CLASSIC_FULL_STACK");
  const injecting = dks.filter((d) => INJECTING.includes(d.mode));
  if (classic) {
    checks.push({ id: "mode", status: "warn", title: "Classic full-stack mode", detail: `${classic.name} runs classic full-stack: the host OneAgent injects every container (full-stack), but the mode is legacy and not supported with platform tokens or in Latest Dynatrace environments. Migrate to cloud-native full-stack.`, fix: "mode" });
  } else if (injecting.length === 0) {
    checks.push({
      id: "mode",
      status: "fail",
      title: "No DynaKube injects code modules",
      detail: `${dks.map((d) => `${d.name}: ${DK_MODE_LABEL[d.mode] ?? d.mode}`).join("; ")}. Without cloudNativeFullStack or applicationMonitoring nothing injects OneAgent into pods, so there are no traces or code-level data. Switch the DynaKube to cloud-native full-stack.`,
      fix: "mode",
    });
  } else if (nsDk?.mode === "APPLICATION_MONITORING" && !hostDk) {
    checks.push({ id: "mode", status: "warn", title: "Application monitoring only (not full-stack)", detail: `${nsDk.name} injects code modules without a host OneAgent: traces and code-level data, but no host, process network or container infrastructure monitoring from OneAgent. Switch to cloud-native full-stack for full-stack monitoring.`, fix: "mode" });
  } else if (nsDk?.mode === "APPLICATION_MONITORING") {
    checks.push({ id: "mode", status: "pass", title: "Application monitoring with host monitoring", detail: `${nsDk.name} injects code modules and ${hostDk!.name} runs a host OneAgent on the nodes.` });
  } else if (nsDk) {
    checks.push({ id: "mode", status: "pass", title: "Cloud-native full-stack", detail: `${nsDk.name} injects code modules into the namespace's pods and runs a host OneAgent on every node.` });
  }

  // 5. Namespace selection (classic full-stack injects from the host, without the webhook).
  if (system && (classic || injecting.length === 0)) {
    checks.push({ id: "namespace", status: "info", title: "System namespace", detail: "Namespaces prefixed with kube- or openshift- are excluded from webhook injection by default; instrumenting them is rarely useful." });
  } else if (!classic && injecting.length > 0) {
    if (system) {
      checks.push({ id: "namespace", status: "info", title: "System namespace (excluded by default)", detail: "Namespaces prefixed with kube- or openshift- are excluded from injection by default; on AKS, namespaces labelled kubernetes.azure.com/managedby: aks too. Instrumenting them is rarely useful." });
    } else if (!nsDk) {
      checks.push({
        id: "namespace",
        status: "fail",
        title: "Namespace not selected by a DynaKube",
        detail: `${target.namespace} has no dynakube.internal.dynatrace.com/instance label, so no injecting DynaKube selects it. ${injecting
          .map((d) =>
            d.namespaceSelector
              ? `${d.name} selects ${d.selected ? n(d.selected, "namespace") : "no namespace"} with namespaceSelector ${d.namespaceSelector}`
              : `${d.name} has no namespaceSelector (every namespace except kube-*, openshift-* and its own should match) yet selects ${n(d.selected, "namespace")}: managed platforms can protect their own namespaces from admission webhooks (for example AKS: kubernetes.azure.com/managedby: aks)`,
          )
          .join("; ")}.`,
        fix: "namespace",
      });
    } else {
      const metadataOnly = pods.filter((p) => p.status === "METADATA_ONLY");
      checks.push(
        metadataOnly.length
          ? { id: "namespace", status: "fail", title: "Selected for metadata enrichment only", detail: `${nsDk.name} processes the namespace's pods, but its OneAgent namespaceSelector does not match: ${n(metadataOnly.length, "pod")} only got metadata enrichment.`, fix: "namespace" }
          : { id: "namespace", status: "pass", title: "Namespace selected", detail: `${nsDk.name} selects ${target.namespace}.` },
      );
    }
  }

  // 6. Automatic injection (feature flag).
  if (nsDk && !nsDk.autoInjection) {
    const optedIn = pods.filter((p) => p.optIn).length;
    checks.push(
      optedIn === pods.length && pods.length > 0
        ? { id: "opt-in", status: "pass", title: "Pods opt in", detail: `${nsDk.name} has automatic injection off; every pod sets oneagent.dynatrace.com/inject: "true".` }
        : { id: "opt-in", status: "fail", title: "Automatic injection off: opt-in required", detail: `${nsDk.name} sets feature.dynatrace.com/automatic-injection: "false", so only pods with oneagent.dynatrace.com/inject: "true" are injected (${optedIn} of ${n(pods.length, "pod")} opt in).`, fix: "opt-in" },
    );
  }

  // 7. Pod opt-out, container exclusions.
  const blocked = pods.filter((p) => p.podBlock);
  if (blocked.length) {
    const keys = [...new Set(blocked.flatMap((p) => p.optOutKeys))];
    const otel = blocked.filter((p) => p.otelDynatrace || p.otelOperator || p.otelSdk).length;
    checks.push({
      id: "pod-optout",
      status: "fail",
      title: "Pod opt-out annotation",
      detail: `${nv(blocked.length, "pod", "pods", "sets", "set")} ${keys.map((k) => `${k}: "false"`).join(" / ")}${otel ? `; ${otel === blocked.length ? (otel === 1 ? "it uses" : "all of them use") : `${otel} of them use`} OpenTelemetry, so the opt-out is probably deliberate` : ""}.`,
      fix: "pod-optout",
    });
  } else if (pods.length) {
    checks.push({ id: "pod-optout", status: "pass", title: "No pod opt-out", detail: "No pod sets dynatrace.com/inject or oneagent.dynatrace.com/inject to false." });
  }
  const containers = [...new Set(pods.flatMap((p) => p.excludedContainers))];
  const dkContainers = nsDk ? dkContainerExclusions(nsDk) : [];
  if (containers.length || dkContainers.length) {
    checks.push({
      id: "container-optout",
      status: "warn",
      title: "Containers excluded from injection",
      detail: [containers.length && `Pod annotation excludes ${list(containers)}`, dkContainers.length && `the DynaKube ${nsDk!.name} excludes ${list(dkContainers)} in every pod`].filter(Boolean).join("; ") + ' (container.inject.dynatrace.com/<container>: "false").',
      fix: "container-optout",
    });
  }

  // 8. OpenTelemetry.
  const otelPods = pods.filter((p) => p.otelDynatrace || p.otelOperator || p.otelSdk);
  const double = otelPods.filter((p) => p.oneAgent);
  const how = (ps: Pod[]) =>
    [
      ps.some((p) => p.otelDynatrace) && "Operator OTLP exporter auto-configuration",
      ps.some((p) => p.otelOperator) && "OpenTelemetry Operator auto-instrumentation",
      ps.some((p) => p.otelSdk && !p.otelDynatrace) && "an OTLP exporter in the pod spec",
    ]
      .filter(Boolean)
      .join(", ");
  if (double.length) {
    checks.push({ id: "otel-double", status: "warn", title: "OneAgent and OpenTelemetry on the same pods", detail: `${nv(double.length, "pod", "pods", "has", "have")} OneAgent and ${how(double)}. When both instrument the same technology, traces get duplicate spans and extra overhead; keep one per signal.`, fix: "otel-double" });
  }
  const otelOnly = otelPods.filter((p) => !p.oneAgent);
  if (otelOnly.length) {
    checks.push({ id: "otel", status: "info", title: "Instrumented with OpenTelemetry instead of OneAgent", detail: `${nv(otelOnly.length, "pod", "pods", "uses", "use")} ${how(otelOnly)}. Send the data to Dynatrace over OTLP (directly or through the Dynatrace Collector), or remove the opt-out to use OneAgent.`, fix: "otel-collector" });
  }

  // 9. Injection result.
  const injected = pods.filter((p) => p.oneAgent || p.status === "CLASSIC");
  const failed = pods.filter((p) => p.status === "FAILED");
  const rollout = pods.filter((p) => p.status === "RESTART_REQUIRED");
  if (failed.length) {
    checks.push({ id: "failed", status: "fail", title: "Webhook skipped OneAgent injection", detail: `${n(failed.length, "pod")}: ${[...new Set(failed.map((p) => p.reason || "no reason given"))].join(", ")}.`, fix: "failed" });
  }
  if (rollout.length) {
    checks.push({ id: "rollout", status: "fail", title: "Roll out required", detail: `${n(rollout.length, "pod")} (${list(rollout.map((p) => p.name), 3)}) could be injected but ${rollout.length === 1 ? "has" : "have"} no injection annotation: ${rollout.length === 1 ? "it" : "they"} started before the namespace was selected or the Operator was installed. The webhook only injects when a pod is created.`, fix: "rollout" });
  }
  if (pods.length === 0) checks.push({ id: "pods", status: "info", title: "No running pods", detail: "No pods of this target are running now (seen in the last 15 minutes)." });
  else checks.push({ id: "injected", status: injected.length === pods.length ? "pass" : injected.length ? "warn" : "info", title: `${injected.length} of ${n(pods.length, "pod")} with OneAgent`, detail: injected.length === pods.length ? "Every pod is injected." : "The checks above explain the pods without OneAgent." });

  // 10. Technologies in the injected pods.
  if (unsupportedList.length) {
    checks.push({
      id: "tech",
      status: "warn",
      title: "Technology without a OneAgent code module",
      detail: `${unsupportedList.map((u) => `${u.info.label} (${list(u.processes, 2)})`).join("; ")}. OneAgent monitors these processes' resources but cannot trace them; instrument them with OpenTelemetry (static Go entrypoints are not supported with cloud-native full-stack either).`,
      fix: "unsupported-tech",
    });
  }
  const notDeep = processes.filter((p) => !p.deep && techInfo(p.processType).kind === "deep");
  if (notDeep.length && injected.length) {
    checks.push({ id: "deep", status: "info", title: "Injected, but processes without a code module", detail: `${n(notDeep.length, "process", "processes")} of a supported technology (${list(notDeep.map((p) => p.name), 2)}) show no code module. Use Diagnose on the Deep Monitoring tab for the process-level settings.`, fix: "deep" });
  } else if (processes.some((p) => p.deep) && processes.every((p) => p.deep || techInfo(p.processType).kind !== "deep")) {
    checks.push({ id: "deep", status: "pass", title: "Supported processes deep monitored", detail: `${n(processes.filter((p) => p.deep).length, "process", "processes")} with a OneAgent code module.` });
  }
  return out();
}

// --- Manual actions --------------------------------------------------------------
const K8S_BASE_DOCS: DocLink[] = [DOC.k8sAnnotate, DOC.dynakubeParams];
const ns = (t?: Target) => t?.namespace ?? "<namespace>";
const wl = (t?: Target) => (t?.kind === "workload" ? `${t.workloadKind}/${t.workload}` : "deployment/<workload>");
const dkName = (d?: Dynakube) => d?.name ?? "<dynakube>";
const dkNs = (d?: Dynakube) => d?.namespace || "dynatrace";

/** kubectl context for a managed cloud cluster (standard cloud CLI commands). */
function connectVariants(c?: CloudCluster): ManualAction["variants"] {
  if (c?.provider === "EKS") return [{ label: "Connect kubectl (EKS)", language: "bash", code: `aws eks update-kubeconfig --name ${c.name} --region ${c.location || "<region>"}` }];
  if (c?.provider === "AKS") return [{ label: "Connect kubectl (AKS)", language: "bash", code: `az aks get-credentials --resource-group ${c.resourceGroup || "<resource group>"} --name ${c.name}${c.account ? ` --subscription ${c.account}` : ""}` }];
  if (c?.provider === "GKE") return [{ label: "Connect kubectl (GKE)", language: "bash", code: `gcloud container clusters get-credentials ${c.name} --location ${c.location || "<location>"} --project ${c.account || "<project>"}` }];
  return [];
}

export const installAction = (t?: Target): ManualAction => ({
  id: "install",
  title: "Install the Dynatrace Operator",
  steps: [
    ...(t?.cloud ? [`Point kubectl at the ${CLOUD_LABEL[t.cloud.provider] ?? t.cloud.provider} cluster ${t.cloud.name}.`] : []),
    `Install the Operator with Helm into the dynatrace namespace${t ? ` of ${t.cluster}` : ""}.`,
    "Create the dynakube secret with an Operator token (apiToken) and a data ingest token.",
    "Apply a DynaKube with spec.oneAgent.cloudNativeFullStack (the Dynatrace UI's Kubernetes onboarding generates it), then roll out the application workloads.",
  ],
  variants: [
    ...connectVariants(t?.cloud),
    { label: "Helm", language: "bash", code: "helm install dynatrace-operator oci://public.ecr.aws/dynatrace/dynatrace-operator \\\n  --create-namespace --namespace dynatrace --atomic\n# Helm 4: --rollback-on-failure instead of --atomic" },
    { label: "Tokens secret", language: "bash", code: 'kubectl -n dynatrace create secret generic dynakube \\\n  --from-literal="apiToken=<operator token>" \\\n  --from-literal="dataIngestToken=<data ingest token>"' },
    {
      label: "DynaKube (cloud-native full-stack)",
      language: "yaml",
      code: "apiVersion: dynatrace.com/v1beta6\nkind: DynaKube\nmetadata:\n  name: dynakube\n  namespace: dynatrace\nspec:\n  apiUrl: https://<environment-id>.live.dynatrace.com/api\n  metadataEnrichment:\n    enabled: true\n  oneAgent:\n    cloudNativeFullStack: {}\n  activeGate:\n    capabilities:\n      - routing\n      - kubernetes-monitoring",
    },
  ],
  notes: [
    "Clusters monitored only by host-installed OneAgents report containers but no Kubernetes objects; the Operator adds Kubernetes monitoring, metadata enrichment and per-namespace control.",
    "Managed clusters from a cloud integration (EKS, AKS, GKE) only show the cloud resource until the Operator is installed; the integration keeps reporting it afterwards, and this tab matches the two.",
    "Latest Operator in the docs: 1.11.0 (DynaKube apiVersion dynatrace.com/v1beta6).",
  ],
  docs: [DOC.k8sInstallFullStack, DOC.k8sDeployment, DOC.dynakubeParams],
});

export const switchModeAction = (d?: Dynakube): ManualAction => {
  const classic = d?.mode === "CLASSIC_FULL_STACK";
  return {
    id: "switch-mode",
    title: "Switch the DynaKube to cloud-native full-stack",
    steps: [
      `Edit ${dkName(d)}: replace spec.oneAgent.${d ? ({ CLASSIC_FULL_STACK: "classicFullStack", APPLICATION_MONITORING: "applicationMonitoring", HOST_MONITORING: "hostMonitoring" } as Record<string, string>)[d.mode] ?? "<mode>" : "<mode>"} with cloudNativeFullStack (keep a namespaceSelector if you only want some namespaces).`,
      classic ? "Classic full-stack only: install the CSI driver first (Helm csidriver.enabled=true, or the kubernetes-csi.yaml / openshift-csi.yaml manifest)." : "Make sure the CSI driver is deployed (default with Helm).",
      "Apply the DynaKube and wait for the new OneAgent pods to become ready.",
      "Restart (roll out) all application workloads promptly: code modules are only injected when a pod is created.",
    ],
    variants: [
      { label: "DynaKube spec", language: "yaml", code: `spec:\n  oneAgent:\n    cloudNativeFullStack:\n      # optional: only namespaces with this label\n      namespaceSelector:\n        matchLabels:\n          dt-monitoring: "true"` },
      { label: "Apply", language: "bash", code: `kubectl apply -f dynakube.yaml\nkubectl get dynakube ${dkName(d)} -n ${dkNs(d)}   # wait for phase Running` },
      { label: "Roll out workloads", language: "bash", code: "kubectl rollout restart deployment -n <namespace>\nkubectl rollout restart statefulset -n <namespace>\nkubectl rollout restart daemonset -n <namespace>" },
    ],
    notes: [
      "Classic to cloud-native: host IDs change (old and new hosts appear side by side), container monitoring rules are ignored (use the namespaceSelector), and CRI-O clusters need OneAgent 1.281+.",
      "There is no documented migration guide from application monitoring to cloud-native; the change is the spec edit above plus a rollout.",
      "Moving from applicationMonitoring or cloudNativeFullStack to classicFullStack or hostMonitoring requires restarting every previously instrumented pod.",
    ],
    docs: [DOC.k8sFullStack, DOC.k8sMigration, ...(classic ? [DOC.k8sClassicToCloudNative] : []), DOC.k8sAppMon, DOC.dynakubeParams],
  };
};

export const namespaceAction = (t?: Target, d?: Dynakube): ManualAction => ({
  id: "namespace",
  title: "Select the namespace for injection (namespace block)",
  steps: [
    "Without a namespaceSelector the Operator injects every namespace except kube-*, openshift-* and its own namespace.",
    `With a namespaceSelector, label ${ns(t)} so it matches (the DynaKube injects every namespace matching all of its selectors), or widen the selector.`,
    "To exclude namespaces on purpose, use matchExpressions with NotIn instead of removing the label.",
    "Roll out the namespace's workloads: pods are only injected when they are created.",
  ],
  variants: [
    { label: "Label the namespace", language: "bash", code: `kubectl label namespace ${ns(t)} dt-monitoring=true --overwrite` },
    { label: "namespaceSelector (matchLabels)", language: "yaml", code: `spec:\n  oneAgent:\n    cloudNativeFullStack:   # or applicationMonitoring\n      namespaceSelector:\n        matchLabels:\n          dt-monitoring: "true"` },
    { label: "namespaceSelector (exclude)", language: "yaml", code: "spec:\n  oneAgent:\n    cloudNativeFullStack:\n      namespaceSelector:\n        matchExpressions:\n          - key: kubernetes.io/metadata.name\n            operator: NotIn\n            values:\n              - <excluded namespace>" },
    { label: "Check the selection", language: "bash", code: `kubectl get namespaces -L dynakube.internal.dynatrace.com/instance\nkubectl get dynakube ${dkName(d)} -n ${dkNs(d)} -o jsonpath='{.status.conditions[?(@.type=="OneAgentNamespacesMonitored")].message}'` },
  ],
  notes: [
    "Selectors only affect webhook injection: ActiveGate Kubernetes API monitoring and host-level OneAgent monitoring are not filtered.",
    "metadataEnrichment and otlpExporterConfiguration have their own namespaceSelector; a namespace matched only by those gets no OneAgent.",
    "On AKS the admissions enforcer also skips namespaces labelled kubernetes.azure.com/managedby: aks.",
  ],
  docs: [DOC.k8sAnnotate, DOC.dynakubeParams, DOC.k8sFullStack],
});

export const podOptOutAction = (t?: Target): ManualAction => ({
  id: "pod-optout",
  title: "Remove the pod opt-out annotation (pod block)",
  steps: [
    'Find where the pod template sets dynatrace.com/inject: "false" or oneagent.dynatrace.com/inject: "false" (Helm values, kustomize, GitOps).',
    "Check why first: pods instrumented with OpenTelemetry are often excluded on purpose to avoid double instrumentation.",
    "Remove the annotation from the pod template (not only the running pod), then roll out the workload.",
  ],
  variants: [
    { label: "Find the annotation", language: "bash", code: `kubectl get ${wl(t)} -n ${ns(t)} -o jsonpath='{.spec.template.metadata.annotations}'` },
    { label: "Remove it (patch)", language: "bash", code: `kubectl patch ${wl(t)} -n ${ns(t)} --type=json -p='[{"op":"remove","path":"/spec/template/metadata/annotations/dynatrace.com~1inject"}]'\n# or: .../annotations/oneagent.dynatrace.com~1inject` },
    { label: "Pod template", language: "yaml", code: 'spec:\n  template:\n    metadata:\n      annotations:\n        # remove these, or set oneagent.dynatrace.com/inject: "true" when opt-in is required\n        dynatrace.com/inject: "false"\n        oneagent.dynatrace.com/inject: "false"' },
  ],
  notes: [
    'dynatrace.com/inject: "false" disables all injection (OneAgent, metadata enrichment, OTLP); "true" has no effect.',
    'oneagent.dynatrace.com/inject: "false" disables only OneAgent; metadata-enrichment.dynatrace.com/inject and otlp-exporter-configuration.dynatrace.com/inject control the others.',
  ],
  docs: K8S_BASE_DOCS,
});

export const containerOptOutAction = (containers: string[] = [], t?: Target, d?: Dynakube): ManualAction => {
  const c = containers[0] ?? "<container>";
  return {
    id: "container-optout",
    title: "Re-enable injection for an excluded container (container block)",
    steps: [
      `Remove container.inject.dynatrace.com/${c}: "false" from the pod template, or from the DynaKube's annotations where it applies to every pod.`,
      "Keep the exclusion for sidecars and helper containers that should not be instrumented.",
      "Roll out the workload (pod-level change) or wait for new pods (DynaKube-level change).",
    ],
    variants: [
      { label: "Pod template", language: "yaml", code: `spec:\n  template:\n    metadata:\n      annotations:\n        container.inject.dynatrace.com/${c}: "false"   # remove to inject this container` },
      { label: "DynaKube (all pods)", language: "bash", code: `kubectl annotate dynakube ${dkName(d)} -n ${dkNs(d)} container.inject.dynatrace.com/${c}-` },
      { label: "Roll out", language: "bash", code: `kubectl rollout restart ${wl(t)} -n ${ns(t)}` },
    ],
    notes: ["Needs Operator 1.0.0+. Excludes the container from every type of injection (OneAgent and metadata)."],
    docs: K8S_BASE_DOCS,
  };
};

export const optInAction = (t?: Target, d?: Dynakube): ManualAction => ({
  id: "opt-in",
  title: "Opt pods in (automatic injection off)",
  steps: [
    `${dkName(d)} sets feature.dynatrace.com/automatic-injection: "false": only pods that opt in are injected.`,
    'Add oneagent.dynatrace.com/inject: "true" to the pod template (and metadata-enrichment.dynatrace.com/inject: "true" for enrichment), or remove the feature flag to inject every selected namespace.',
    "Roll out the workload.",
  ],
  variants: [
    { label: "Pod template", language: "yaml", code: 'spec:\n  template:\n    metadata:\n      annotations:\n        oneagent.dynatrace.com/inject: "true"\n        metadata-enrichment.dynatrace.com/inject: "true"' },
    { label: "Remove the feature flag", language: "bash", code: `kubectl annotate dynakube ${dkName(d)} -n ${dkNs(d)} feature.dynatrace.com/automatic-injection-` },
    { label: "Roll out", language: "bash", code: `kubectl rollout restart ${wl(t)} -n ${ns(t)}` },
  ],
  docs: [DOC.dynakubeFlags, DOC.k8sAnnotate],
});

export const rolloutAction = (t?: Target): ManualAction => ({
  id: "rollout",
  title: "Roll out the workload to inject OneAgent",
  steps: [
    "The webhook only mutates pods when they are created; pods that were running before the namespace was selected (or the Operator was installed) stay uninstrumented.",
    "Restart the workload in a maintenance window; the new pods get the code module.",
    'Check the new pods for oneagent.dynatrace.com/injected: "true".',
  ],
  variants: [
    { label: "Roll out", language: "bash", code: `kubectl rollout restart ${wl(t)} -n ${ns(t)}\nkubectl rollout status ${wl(t)} -n ${ns(t)}` },
    { label: "Whole namespace", language: "bash", code: `kubectl rollout restart deployment,statefulset,daemonset -n ${ns(t)}` },
    { label: "Check injection", language: "bash", code: `kubectl get pods -n ${ns(t)} -o custom-columns='POD:.metadata.name,INJECTED:.metadata.annotations.oneagent\\.dynatrace\\.com/injected'` },
  ],
  notes: ['With feature.dynatrace.com/injection-failure-policy: "fail" a pod whose injection fails does not start; the default "silent" starts it uninstrumented.'],
  docs: [DOC.k8sMutation, DOC.k8sAnnotate, DOC.dynakubeFlags],
});

export const troubleshootAction = (d?: Dynakube): ManualAction => ({
  id: "troubleshoot",
  title: "Troubleshoot the Operator and injection",
  steps: [
    "Run the Operator's troubleshoot command: it checks the DynaKube, tokens, image pulls and the webhook.",
    "Check the DynaKube's status conditions and the injected pod annotations.",
    "Skipped pods carry oneagent.dynatrace.com/injected: \"false\" and a reason (NoBootstrapperConfig, NoMutationNeeded, OwnerLookupFailed, MissingTenantUUID, DynaKubeStatusNotReady).",
  ],
  variants: [
    { label: "Operator troubleshoot", language: "bash", code: `kubectl exec deploy/dynatrace-operator -n ${dkNs(d)} -- dynatrace-operator troubleshoot${d ? ` --dynakube ${d.name}` : ""}` },
    { label: "DynaKube status", language: "bash", code: `kubectl get dynakube -n ${dkNs(d)}\nkubectl describe dynakube ${dkName(d)} -n ${dkNs(d)}` },
    { label: "Pod injection reason", language: "bash", code: "kubectl get pod <pod> -n <namespace> -o jsonpath='{.metadata.annotations.oneagent\\.dynatrace\\.com/injected}{\" \"}{.metadata.annotations.oneagent\\.dynatrace\\.com/reason}{\" \"}{.metadata.annotations.dynakube\\.dynatrace\\.com/reason}{\"\\n\"}'" },
    { label: "Support archive", language: "bash", code: `kubectl exec deploy/dynatrace-operator -n ${dkNs(d)} -- dynatrace-operator support-archive` },
  ],
  notes: ["DynaKubeStatusNotReady usually means the DynaKube is still deploying or failing: fix its conditions first, then roll out the pods."],
  docs: [DOC.k8sTroubleshoot, DOC.k8sMonitoringTroubleshoot, DOC.k8sMutation],
});

export const otelCollectorAction = (d?: Dynakube): ManualAction => ({
  id: "otel-collector",
  title: "OpenTelemetry: send through the Dynatrace Collector or OTLP auto-configuration",
  steps: [
    "Keep OpenTelemetry where it is the chosen instrumentation (unsupported technologies, existing OTel SDKs) and make sure its data reaches Dynatrace.",
    "spec.telemetryIngest deploys the Dynatrace Collector in the cluster (OTLP gRPC 4317 / HTTP 4318, Zipkin, Jaeger, StatsD); point exporters at its service.",
    "Or let the Operator configure the OTLP exporter in pods (spec.otlpExporterConfiguration, Operator 1.8+): it skips pods that already set OTEL_EXPORTER_OTLP_* unless overrideEnvVars is true, and always uses http/protobuf.",
  ],
  variants: [
    { label: "Telemetry ingest (Collector)", language: "yaml", code: "spec:\n  telemetryIngest:\n    protocols:\n      - otlp\n  templates:\n    otelCollector:\n      imageRef:\n        repository: public.ecr.aws/dynatrace/dynatrace-otel-collector\n        tag: <version>" },
    { label: "OTLP exporter auto-configuration", language: "yaml", code: 'spec:\n  otlpExporterConfiguration:\n    signals:\n      metrics: {}\n      traces: {}\n      logs: {}\n    namespaceSelector:\n      matchLabels:\n        otel-export: "true"' },
    { label: "Exporter to the Collector", language: "bash", code: `OTEL_EXPORTER_OTLP_ENDPOINT=http://${dkName(d)}-telemetry-ingest.${dkNs(d)}:4318\nOTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf` },
  ],
  notes: [
    "The Collector service is <dynakube>-telemetry-ingest by default (spec.telemetryIngest.serviceName).",
    'Pods opt out of OTLP auto-configuration with otlp-exporter-configuration.dynatrace.com/inject: "false"; the result is in otlp-exporter-configuration.dynatrace.com/injected.',
  ],
  docs: [DOC.k8sTelemetryIngest, DOC.k8sOtlpAutoConfig, DOC.otlp, DOC.otel],
});

export const otelDoubleAction = (t?: Target): ManualAction => ({
  id: "otel-double",
  title: "Avoid double instrumentation (OneAgent + OpenTelemetry)",
  steps: [
    "Decide per workload which agent traces it: OneAgent for supported technologies, OpenTelemetry for the rest.",
    'To keep OneAgent: remove the OpenTelemetry Operator annotation (instrumentation.opentelemetry.io/inject-<language>) or set it to "false", and turn off the SDK\'s trace exporter.',
    'To keep OpenTelemetry: add oneagent.dynatrace.com/inject: "false" to the pod template.',
    "Roll out the workload.",
  ],
  variants: [
    { label: "Keep OneAgent", language: "yaml", code: 'spec:\n  template:\n    metadata:\n      annotations:\n        instrumentation.opentelemetry.io/inject-java: "false"   # or remove; also -nodejs, -python, -dotnet, -go' },
    { label: "Keep OpenTelemetry", language: "yaml", code: 'spec:\n  template:\n    metadata:\n      annotations:\n        oneagent.dynatrace.com/inject: "false"' },
    { label: "Roll out", language: "bash", code: `kubectl rollout restart ${wl(t)} -n ${ns(t)}` },
  ],
  notes: [
    "With OneAgent and OpenTelemetry sensors on the same technology, traces get duplicate nodes and overhead goes up.",
    "Exporting only OpenTelemetry metrics or logs next to OneAgent traces is fine; duplicates come from two tracers.",
  ],
  docs: [DOC.oneagentOtel, DOC.otel],
});

/** Actions offered before a workload or namespace is diagnosed. */
export const genericOperatorActions = (): ManualAction[] => [
  switchModeAction(),
  namespaceAction(),
  podOptOutAction(),
  containerOptOutAction(),
  rolloutAction(),
  otelCollectorAction(),
  otelDoubleAction(),
  installAction(),
  troubleshootAction(),
];
