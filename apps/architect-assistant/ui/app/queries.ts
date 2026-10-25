// All DQL for the app lives here. Every query was validated with dtctl against
// the demo tenant and carries an explicit `from:` timeframe.
// Smartscape (`smartscapeNodes`) is used instead of scanning logs/events/metrics:
// it is cheap and carries the primary Grail fields on each entity.

export type Timeframe = "24h" | "7d" | "30d";
export const TIMEFRAMES: { label: string; value: Timeframe }[] = [
  { label: "Last 24 hours", value: "24h" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
];
export const DEFAULT_TIMEFRAME: Timeframe = "24h";

const from = (tf: Timeframe) => `from:now()-${tf}`;

// Entity types covered by the primary-field coverage matrix.
export const ENTITY_TYPES = [
  "HOST",
  "PROCESS",
  "SERVICE",
  "CONTAINER",
  "K8S_CLUSTER",
  "K8S_NODE",
  "K8S_NAMESPACE",
  "K8S_DEPLOYMENT",
  "K8S_POD",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/** Display names: [singular title, plural noun used in sentences]. */
export const ENTITY_LABELS: Record<EntityType, { title: string; plural: string }> = {
  HOST: { title: "Hosts", plural: "hosts" },
  PROCESS: { title: "Processes", plural: "processes" },
  SERVICE: { title: "Services", plural: "services" },
  CONTAINER: { title: "Containers", plural: "containers" },
  K8S_CLUSTER: { title: "Kubernetes clusters", plural: "Kubernetes clusters" },
  K8S_NODE: { title: "Kubernetes nodes", plural: "Kubernetes nodes" },
  K8S_NAMESPACE: { title: "Kubernetes namespaces", plural: "Kubernetes namespaces" },
  K8S_DEPLOYMENT: { title: "Kubernetes deployments", plural: "Kubernetes deployments" },
  K8S_POD: { title: "Kubernetes pods", plural: "Kubernetes pods" },
};

// Ownership: the keys come from the tenant's builtin:ownership.config (dt.owner, owner, team). Ownership is a
// key/value on hosts (host properties), processes (DT_CUSTOM_PROP) and Kubernetes objects (labels/annotations).
export const OWNER_KEYS = ["dt.owner", "owner", "team"];
export const OWNER_EXPR = `coalesce(${OWNER_KEYS.flatMap((k) => [
  `host.custom.metadata[\`${k}\`]`,
  `custom_metadata[\`${k}\`]`,
  `\`tags:k8s.labels\`[\`${k}\`]`,
  `\`tags:k8s.annotations\`[\`${k}\`]`,
]).join(", ")})`;
// Entity types that can carry an ownership key: those with a property or label/annotation map. Classic services,
// containers and Kubernetes clusters have none, so they cannot be scored.
export const OWNER_TYPES: EntityType[] = ["HOST", "PROCESS", "K8S_NAMESPACE", "K8S_NODE", "K8S_DEPLOYMENT", "K8S_POD"];

// Primary fields checked on each entity (security, cost, host group, ownership). `present`/`missing` are DQL predicates.
export const PRIMARY_FIELDS = {
  security: { label: "Security context", field: "dt.security_context", present: "arraySize(dt.security_context) > 0", missing: "isNull(dt.security_context) or arraySize(dt.security_context) == 0" },
  costcenter: { label: "Cost center", field: "dt.cost.costcenter", present: "isNotNull(dt.cost.costcenter)", missing: "isNull(dt.cost.costcenter)" },
  product: { label: "Cost product", field: "dt.cost.product", present: "isNotNull(dt.cost.product)", missing: "isNull(dt.cost.product)" },
  hostgroup: { label: "Host group", field: "dt.host_group.id", present: "isNotNull(dt.host_group.id)", missing: "isNull(dt.host_group.id)" },
  owner: { label: "Ownership team", field: OWNER_EXPR, present: `isNotNull(${OWNER_EXPR})`, missing: `isNull(${OWNER_EXPR})` },
} as const;
export type PrimaryFieldKey = keyof typeof PRIMARY_FIELDS;

// Host group is a host-level attribute, inherited by processes and containers only.
const HOST_GROUP_TYPES: EntityType[] = ["HOST", "PROCESS", "CONTAINER"];
export type FieldKey = PrimaryFieldKey;
export const fieldApplies = (type: EntityType, field: FieldKey) =>
  field === "hostgroup" ? HOST_GROUP_TYPES.includes(type) : field === "owner" ? OWNER_TYPES.includes(type) : true;
export const fieldLabel = (k: FieldKey) => PRIMARY_FIELDS[k].label;
const fieldMissing = (k: FieldKey) => PRIMARY_FIELDS[k].missing;

const typeList = ENTITY_TYPES.map((t) => `"${t}"`).join(", ");

/** One query: compliant + total per entity type for every primary field. */
export const coverageQuery = (tf: Timeframe) => `smartscapeNodes ${typeList}, ${from(tf)}
| summarize total = count(),
    security = countIf(${PRIMARY_FIELDS.security.present}),
    costcenter = countIf(${PRIMARY_FIELDS.costcenter.present}),
    product = countIf(${PRIMARY_FIELDS.product.present}),
    hostgroup = countIf(${PRIMARY_FIELDS.hostgroup.present}),
    owner = countIf(${PRIMARY_FIELDS.owner.present}),
    by:{type}`;

/** Drill-down: entities of one type missing one primary field. Run on demand. */
export const missingEntitiesQuery = (tf: Timeframe, type: EntityType, key: FieldKey) =>
  `smartscapeNodes "${type}", ${from(tf)}
| filter ${fieldMissing(key)}
| fields id, name, type
| sort name asc
| limit 500`;

// --- Dimensional data (metrics, logs, events, business events) ---------------
export type DimensionalKind = "metrics" | "logs" | "events" | "bizevents";
export const DIMENSIONAL_KINDS: DimensionalKind[] = ["metrics", "logs", "events", "bizevents"];
export const DIMENSIONAL_INFO: Record<DimensionalKind, { title: string; unit: string; note: string }> = {
  metrics: { title: "Metrics", unit: "series", note: "Metric series (key + dimensions); the first 100,000 series are evaluated." },
  logs: { title: "Logs", unit: "records", note: "Sampled estimate; the sampling ratio grows with the selected timeframe." },
  events: { title: "Events", unit: "events", note: "Events do not support sampling, so the scan is capped at 5 GB." },
  bizevents: { title: "Business events", unit: "events", note: "Business events do not support sampling, so the scan is capped at 5 GB." },
};
export const SCAN_CAP_GB = 5;
// Only logs support sampling (events/bizevents ignored the ratio when validated against the tenant).
const LOG_SAMPLING: Record<Timeframe, number> = { "24h": 10000, "7d": 100000, "30d": 100000 };

/** Share of metric series / log records / events carrying security context, cost center and cost product. */
export const dimensionalQuery = (tf: Timeframe, kind: DimensionalKind) => {
  const summarize = `| summarize total = count(),
    security = countIf(isNotNull(dt.security_context)),
    costcenter = countIf(isNotNull(dt.cost.costcenter)),
    product = countIf(isNotNull(dt.cost.product))`;
  switch (kind) {
    case "metrics":
      return `metrics ${from(tf)}\n${summarize}`;
    case "logs":
      return `fetch logs, ${from(tf)}, samplingRatio:${LOG_SAMPLING[tf]}, scanLimitGBytes:${SCAN_CAP_GB}\n${summarize}`;
    case "events":
      return `fetch events, ${from(tf)}, scanLimitGBytes:${SCAN_CAP_GB}\n${summarize}`;
    case "bizevents":
      return `fetch bizevents, ${from(tf)}, scanLimitGBytes:${SCAN_CAP_GB}\n${summarize}`;
  }
};

// --- Customer-defined primary tags (primary_tags.<name>) ---------------------
export const TAG_NAME_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,62}$/;

/** Coverage of each listed primary tag per entity type, in one query. Names must pass TAG_NAME_RE. */
export const tagsQuery = (tf: Timeframe, names: string[]) => `smartscapeNodes ${typeList}, ${from(tf)}
| summarize total = count(),
${names.map((n, i) => `    t${i} = countIf(isNotNull(\`primary_tags.${n}\`)),`).join("\n")}
    by:{type}`;

/** Hosts per host group (null group = hosts without one). */
export const hostGroupsQuery = (tf: Timeframe) => `smartscapeNodes "HOST", ${from(tf)}
| summarize hosts = count(), by:{hostGroup = dt.host_group.id}
| sort hosts desc`;

/** Hosts without a host group. */
export const hostsWithoutGroupQuery = (tf: Timeframe) => `smartscapeNodes "HOST", ${from(tf)}
| filter isNull(dt.host_group.id)
| fields id, name, cloud.provider, os.type, k8s.cluster.name
| sort name asc
| limit 500`;

/** OneAgent monitoring mode + version spread. */
export const oneAgentQuery = (tf: Timeframe) => `smartscapeNodes "ONEAGENT", ${from(tf)}
| summarize agents = count(), by:{mode = dt.agent.monitoring_mode, version = dt.agent.module.version}
| sort agents desc`;

// --- Entity search (Host group, Security context, Cost, Primary tags pages) ---
export type SearchMode = "has" | "equals" | "contains" | "missing";
export type SearchField = { key: string; label: string; /** DQL field expression, backtick-quoted when needed. */ expr: string; array?: boolean };

export const dqlString = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** Find entities by one property: has a value / equals / contains / is missing, optionally narrowed by name. Max 500 rows. */
export function entitySearchQuery(tf: Timeframe, types: EntityType[], field: SearchField, mode: SearchMode, value: string, name: string): string {
  const e = field.expr;
  const conds: string[] = [];
  if (name) conds.push(`contains(name, ${dqlString(name)}, caseSensitive:false)`);
  if (mode === "has") conds.push(field.array ? `arraySize(${e}) > 0` : `isNotNull(${e})`);
  if (mode === "missing") conds.push(field.array ? `(isNull(${e}) or arraySize(${e}) == 0)` : `isNull(${e})`);
  if (mode === "equals") conds.push(field.array ? `in(${dqlString(value)}, ${e})` : `toString(${e}) == ${dqlString(value)}`);
  if (mode === "contains") conds.push(`contains(toString(${e}), ${dqlString(value)}, caseSensitive:false)`);
  return `smartscapeNodes ${types.map((t) => `"${t}"`).join(", ")}, ${from(tf)}
| filter ${conds.join(" and ")}
| fieldsAdd value = toString(${e})
| fields id, name, type, value
| sort name asc
| limit 500`;
}

// --- OneAgent: host search and monitoring-mode breakdown ----------------------
/** OneAgents per monitoring mode (pie chart on the Entity Overview). */
export const oneAgentModesQuery = (tf: Timeframe) => `smartscapeNodes "ONEAGENT", ${from(tf)}
| summarize agents = count(), by:{mode = dt.agent.monitoring_mode}
| sort agents desc`;

/** Sentinel for "hosts without a host group" in the OneAgent search. */
export const NO_HOST_GROUP = "__none__";

/**
 * Hosts whose OneAgent matches version / monitoring mode / host name / host group.
 * Agent filters run on the ONEAGENT nodes, then `traverse` follows the "monitors" edge to the HOST node
 * (which carries the host group) while keeping the agent's version and mode in dt.traverse.history.
 */
export function oneAgentSearchQuery(tf: Timeframe, f: { name: string; version: string; mode: string; hostGroup: string }): string {
  const agent: string[] = [];
  if (f.name) agent.push(`contains(name, ${dqlString(f.name)}, caseSensitive:false)`);
  if (f.version) agent.push(`(dt.agent.module.version == ${dqlString(f.version)} or startsWith(dt.agent.module.version, ${dqlString(f.version + "-")}))`);
  if (f.mode) agent.push(`dt.agent.monitoring_mode == ${dqlString(f.mode)}`);
  const host: string[] = [];
  if (f.hostGroup === NO_HOST_GROUP) host.push("isNull(dt.host_group.id)");
  else if (f.hostGroup) host.push(`toString(dt.host_group.id) == ${dqlString(f.hostGroup)}`);
  return `smartscapeNodes "ONEAGENT", ${from(tf)}
${agent.length ? `| filter ${agent.join(" and ")}\n` : ""}| traverse edgeTypes:{monitors}, targetTypes:{HOST}, fieldsKeep:{dt.agent.module.version, dt.agent.monitoring_mode}
${host.length ? `| filter ${host.join(" and ")}\n` : ""}| fieldsAdd agent = dt.traverse.history[0]
| fieldsAdd version = agent[\`dt.agent.module.version\`], mode = agent[\`dt.agent.monitoring_mode\`]
| fields id, name, version, mode, hostGroup = dt.host_group.id
| sort name asc
| limit 500`;
}

/** Host groups matching a search string (server-side, top 100 by host count), for a searchable selector. */
export const hostGroupSearchQuery = (tf: Timeframe, search: string) => `smartscapeNodes "HOST", ${from(tf)}
| filter isNotNull(dt.host_group.id)${search ? ` and contains(toString(dt.host_group.id), ${dqlString(search)}, caseSensitive:false)` : ""}
| summarize hosts = count(), by:{hostGroup = dt.host_group.id}
| sort hosts desc
| limit 100`;

// --- Kubernetes tab (Dynatrace Operator, cloud-integration clusters) ---------
// DynaKubes are Smartscape K8S_DYNAKUBE nodes; k8s.object holds the whole custom resource (spec + status) as JSON, and
// tags:k8s.annotations its annotations (feature flags). Injection evidence, validated on the tenant:
//   - namespaces a DynaKube selects carry the label dynakube.internal.dynatrace.com/instance=<dynakube> (set by the Operator);
//   - the webhook annotates every pod it processes: dynakube.dynatrace.com/injected, and per feature
//     oneagent.dynatrace.com/injected / metadata-enrichment.dynatrace.com/injected ("true", or "false" plus a reason, which
//     the docs put under oneagent.dynatrace.com/reason or dynakube.dynatrace.com/reason);
//   - opt-outs: dynatrace.com/inject or oneagent.dynatrace.com/inject = "false" on the pod (pod block),
//     container.inject.dynatrace.com/<container> = "false" on the pod or the DynaKube (container block);
//   - OpenTelemetry: the Operator's OTLP exporter auto-configuration (otlp-exporter-configuration.dynatrace.com/injected),
//     the OpenTelemetry Operator's auto-instrumentation init container (opentelemetry-auto-instrumentation-*) or an OTLP
//     exporter endpoint (OTEL_EXPORTER_OTLP_ENDPOINT) in the pod spec.
// Classic full-stack injects from the host OneAgent, without the webhook, so those pods carry no injection annotation.
// Pods, workloads and containers inherit the monitoring mode of their namespace (the DynaKube that selects it).
// Pods and containers are counted as they are now (nodes seen in the last K8S_LIVE_MINUTES): over a timeframe,
// finished Job pods and replaced replicas outnumber the running ones (742 vs 244 pods in 24 hours on the demo tenant)
// and turn rolled-out workloads into PARTIAL. Namespaces, DynaKubes and clusters use the selected timeframe.
export const K8S_LIVE_MINUTES = 15;
const live = `from:now()-${K8S_LIVE_MINUTES}m`;

const DK_MODE = `if(isNotNull(o[spec][oneAgent][cloudNativeFullStack]), "CLOUD_NATIVE_FULL_STACK",
      else: if(isNotNull(o[spec][oneAgent][applicationMonitoring]), "APPLICATION_MONITORING",
      else: if(isNotNull(o[spec][oneAgent][classicFullStack]), "CLASSIC_FULL_STACK",
      else: if(isNotNull(o[spec][oneAgent][hostMonitoring]), "HOST_MONITORING", else: "KUBERNETES_ONLY"))))`;

const dynakubes = (tf: Timeframe) => `smartscapeNodes "K8S_DYNAKUBE", ${from(tf)}
    | parse k8s.object, "JSON:o"
    | fieldsAdd dkMode = ${DK_MODE},
        autoInjection = coalesce(\`tags:k8s.annotations\`[\`feature.dynatrace.com/automatic-injection\`], "true") != "false"`;

// Per cluster: every DynaKube's mode and the namespaces the DynaKubes live in (the Operator's own namespace).
const clusterDkLookup = (tf: Timeframe) => `| lookup [${dynakubes(tf)}
    | summarize dkModes = collectDistinct(dkMode), dkNamespaces = collectDistinct(k8s.namespace.name), by:{k8s.cluster.uid}
  ], sourceField:k8s.cluster.uid, lookupField:k8s.cluster.uid, fields:{dkModes, dkNamespaces}`;

// Per namespace (cluster UID + name): the DynaKube that selects it, that DynaKube's mode and automatic-injection flag.
const namespaceDk = (tf: Timeframe) => `smartscapeNodes "K8S_NAMESPACE", ${from(tf)}
    | fieldsAdd nsKey = concat(k8s.cluster.uid, "/", k8s.namespace.name), nsDk = \`tags:k8s.labels\`[\`dynakube.internal.dynatrace.com/instance\`]
    | fieldsAdd dkKey = concat(k8s.cluster.uid, "/", nsDk)
    | lookup [${dynakubes(tf)} | fields dkKey = concat(k8s.cluster.uid, "/", name), nsDkMode = dkMode, nsAutoInjection = autoInjection], sourceField:dkKey, lookupField:dkKey, fields:{nsDkMode, nsAutoInjection}`;

const MODE_FLAGS = `| fieldsAdd injecting = coalesce(in("CLOUD_NATIVE_FULL_STACK", dkModes) or in("APPLICATION_MONITORING", dkModes), false),
    hostAgent = coalesce(in("CLOUD_NATIVE_FULL_STACK", dkModes) or in("CLASSIC_FULL_STACK", dkModes) or in("HOST_MONITORING", dkModes), false),
    classic = coalesce(in("CLASSIC_FULL_STACK", dkModes), false),
    dynatraceNs = coalesce(in(k8s.namespace.name, dkNamespaces), false)`;

/** Monitoring mode of a namespace (or a pod in it); `otel` = OpenTelemetry evidence for the pod / any pod of the namespace. */
const modeExpr = (otel: string) => `if(dynatraceNs, "DYNATRACE",
      else: if(isNotNull(nsDkMode), nsDkMode,
      else: if(classic, "CLASSIC_FULL_STACK",
      else: if(${otel}, "OTEL",
      else: if(isNull(dkModes), "NO_DYNAKUBE",
      else: if(injecting, "NOT_SELECTED",
      else: if(hostAgent, "HOST_MONITORING", else: "KUBERNETES_ONLY")))))))`;

/** Every pod with its injection evidence, monitoring mode and injection status. */
const k8sPods = (tf: Timeframe) => `smartscapeNodes "K8S_POD", ${live}
| fieldsAdd a = \`tags:k8s.annotations\`, nsKey = concat(k8s.cluster.uid, "/", k8s.namespace.name)
${clusterDkLookup(tf)}
| lookup [${namespaceDk(tf)} | fields nsKey, nsDk, nsDkMode, nsAutoInjection], sourceField:nsKey, lookupField:nsKey, fields:{nsDk, nsDkMode, nsAutoInjection}
| fieldsAdd oneAgent = coalesce(a[\`oneagent.dynatrace.com/injected\`] == "true", false),
    injectFailed = coalesce(a[\`oneagent.dynatrace.com/injected\`] == "false", false),
    reason = coalesce(a[\`oneagent.dynatrace.com/reason\`], a[\`dynakube.dynatrace.com/reason\`]),
    metadataOnly = coalesce(a[\`oneagent.dynatrace.com/injected\`] != "true", true)
      and coalesce(a[\`dynakube.dynatrace.com/injected\`] == "true" or a[\`metadata-enrichment.dynatrace.com/injected\`] == "true", false),
    podBlock = coalesce(a[\`dynatrace.com/inject\`] == "false" or a[\`oneagent.dynatrace.com/inject\`] == "false", false),
    optIn = coalesce(a[\`oneagent.dynatrace.com/inject\`] == "true", false),
    containerBlock = contains(toString(a), "\\"container.inject.dynatrace.com/"),
    otelDynatrace = coalesce(a[\`otlp-exporter-configuration.dynatrace.com/injected\`] == "true", false),
    otelOperator = contains(k8s.object, "opentelemetry-auto-instrumentation"),
    otelSdk = contains(k8s.object, "OTEL_EXPORTER_OTLP_ENDPOINT"),
    system = matchesValue(k8s.namespace.name, "kube-*") or matchesValue(k8s.namespace.name, "openshift-*")
| fieldsAdd otel = otelDynatrace or otelOperator or otelSdk
${MODE_FLAGS}
| fieldsAdd mode = ${modeExpr("otel")}
| fieldsAdd status = if(mode == "DYNATRACE", "DYNATRACE",
      else: if(oneAgent and otel, "ONEAGENT_OTEL",
      else: if(oneAgent, "ONEAGENT",
      else: if(mode == "CLASSIC_FULL_STACK", "CLASSIC",
      else: if(otel, "OTEL",
      else: if(injectFailed, "FAILED",
      else: if(podBlock, "POD_BLOCK",
      else: if(mode == "NO_DYNAKUBE", "NO_DYNAKUBE",
      else: if(mode == "HOST_MONITORING" or mode == "KUBERNETES_ONLY", "NO_INJECTION",
      else: if(mode == "NOT_SELECTED", if(system, "SYSTEM", else: "NAMESPACE_BLOCK"),
      else: if(metadataOnly, "METADATA_ONLY",
      else: if(nsAutoInjection == false and not optIn, "OPT_IN_REQUIRED", else: "RESTART_REQUIRED"))))))))))))`;

/** Workload key: pods carry k8s.workload.kind ("deployment") and name; Smartscape workload nodes are typed K8S_DEPLOYMENT. */
const WORKLOAD_KEY = `concat(k8s.cluster.uid, "/", k8s.namespace.name, "/", k8s.workload.kind, "/", k8s.workload.name)`;
const WORKLOAD_TYPES = ["K8S_DEPLOYMENT", "K8S_STATEFULSET", "K8S_DAEMONSET", "K8S_JOB", "K8S_CRONJOB", "K8S_REPLICASET", "K8S_REPLICATIONCONTROLLER", "K8S_DEPLOYMENTCONFIG"];

const workloadRollup = `| summarize pods = count(), oneAgentPods = countIf(oneAgent), otelPods = countIf(otel), blockedPods = countIf(podBlock), containerBlockPods = countIf(containerBlock),
    statuses = collectDistinct(status), modes = collectDistinct(mode),
    by:{k8s.cluster.name, k8s.cluster.uid, k8s.namespace.name, k8s.workload.kind, k8s.workload.name}
| fieldsAdd status = if(arraySize(statuses) == 1, statuses[0], else: "PARTIAL"), mode = if(arraySize(modes) == 1, modes[0], else: "MIXED")`;

/** Pods per monitoring mode and injection status (Kubernetes donut). */
export const k8sPodSummaryQuery = (tf: Timeframe) => `${k8sPods(tf)}
| summarize n = count(), by:{mode, status}`;

/** Workloads (pods grouped by controller) per monitoring mode and injection status; PARTIAL = pods differ. */
export const k8sWorkloadSummaryQuery = (tf: Timeframe) => `${k8sPods(tf)}
| filter isNotNull(k8s.workload.name)
${workloadRollup}
| summarize n = count(), by:{mode, status}`;

/**
 * Containers per monitoring mode and injection status: the pod's status, or CONTAINER_BLOCK when the pod excludes the
 * container. Containers in Kubernetes namespaces without a pod node come from a host-installed OneAgent in a cluster
 * without Kubernetes monitoring or a DynaKube (HOST_ONEAGENT).
 */
export const k8sContainerSummaryQuery = (tf: Timeframe) => `smartscapeNodes "CONTAINER", ${live}
| filter isNotNull(k8s.namespace.name)
| lookup [${k8sPods(tf).replace(/\n/g, "\n  ")}
  | fields k8s.pod.uid, podStatus = status, podMode = mode, ann = toString(a)], sourceField:k8s.pod.uid, lookupField:k8s.pod.uid, fields:{podStatus, podMode, ann}
${clusterDkLookup(tf)}
| fieldsAdd containerBlock = contains(ann, concat("\\"container.inject.dynatrace.com/", k8s.container.name, "\\":\\"false\\""))
| fieldsAdd status = if(containerBlock and in(podStatus, array("ONEAGENT", "ONEAGENT_OTEL", "RESTART_REQUIRED", "OPT_IN_REQUIRED", "METADATA_ONLY")), "CONTAINER_BLOCK",
      else: coalesce(podStatus, if(isNull(dkModes), "HOST_ONEAGENT", else: "NO_POD"))),
    mode = coalesce(podMode, if(isNull(dkModes), "NO_DYNAKUBE", else: "UNKNOWN"))
| summarize n = count(), by:{mode, status}`;

/** Namespaces per monitoring mode and injection coverage of their pods (ALL / PARTIAL / OTEL / NONE / NO_PODS). */
export const k8sNamespaceSummaryQuery = (tf: Timeframe) => `${k8sNamespacesBase(tf)}
| summarize n = count(), by:{mode, status}`;

const k8sNamespacesBase = (tf: Timeframe) => `${namespaceDk(tf)}
${clusterDkLookup(tf)}
| lookup [${k8sPods(tf).replace(/\n/g, "\n  ")}
  | summarize pods = count(), oneAgentPods = countIf(oneAgent or status == "CLASSIC"), otelPods = countIf(otel), by:{nsKey}], sourceField:nsKey, lookupField:nsKey, fields:{pods, oneAgentPods, otelPods}
| fieldsAdd pods = coalesce(pods, 0), oneAgentPods = coalesce(oneAgentPods, 0), otelPods = coalesce(otelPods, 0)
${MODE_FLAGS}
| fieldsAdd mode = ${modeExpr("otelPods > 0")}
| fieldsAdd status = if(mode == "DYNATRACE", "DYNATRACE",
      else: if(pods == 0, "NO_PODS",
      else: if(oneAgentPods == 0 and (matchesValue(k8s.namespace.name, "kube-*") or matchesValue(k8s.namespace.name, "openshift-*")), "SYSTEM",
      else: if(oneAgentPods == pods, "ALL",
      else: if(oneAgentPods > 0, "PARTIAL",
      else: if(otelPods > 0, "OTEL", else: "NONE"))))))`;

// Managed Kubernetes clusters from the cloud integrations (EKS, AKS, GKE), matched to the Kubernetes-monitored cluster they
// are through the cluster's nodes (no Smartscape edge links them, and the DynaKube's cluster name is free text: the EKS
// cluster "live" is monitored as "eks-live" on the demo tenant). Keys, validated on the tenant:
//   - EKS: node label eks.amazonaws.com/nodegroup -> AWS_EKS_NODEGROUP (its configuration names the cluster) -> account/region/cluster;
//   - AKS: node label kubernetes.azure.com/cluster = the managed cluster's node resource group;
//   - GKE: node providerID gce://<project>/<zone>/<node>, node name gke-<cluster>-<node pool>-<hash>.
// Fallback: same name and distribution (k8s.cluster.distribution EKS / AKS / GKE).
export const CLOUD_CLUSTER_TYPES = ["AWS_EKS_CLUSTER", "AZURE_MICROSOFT_CONTAINERSERVICE_MANAGEDCLUSTERS", "GCP_CONTAINER_GOOGLEAPIS_COM_CLUSTER"];
const AKS_TYPE = CLOUD_CLUSTER_TYPES[1];

const k8sNodeCloudKeys = (tf: Timeframe) => `smartscapeNodes "K8S_NODE", ${from(tf)}
    | parse k8s.object, "JSON:o"
    | fieldsAdd lbl = \`tags:k8s.labels\`, providerID = toString(o[spec][providerID])
    | fieldsAdd ng = lbl[\`eks.amazonaws.com/nodegroup\`], aksRg = lbl[\`kubernetes.azure.com/cluster\`], gkePool = lbl[\`cloud.google.com/gke-nodepool\`]
    | lookup [smartscapeNodes "AWS_EKS_NODEGROUP", ${from(tf)} | parse aws.object, "JSON:g" | fields ng = name, eksKey = concat("EKS/", aws.account.id, "/", aws.region, "/", g[configuration][clusterName])], sourceField:ng, lookupField:ng, fields:{eksKey}
    | fieldsAdd poolAt = if(isNotNull(gkePool) and startsWith(name, "gke-"), indexOf(name, concat("-", gkePool, "-")))
    | fieldsAdd gkeKey = if(startsWith(providerID, "gce://") and poolAt > 4, concat("GKE/", splitString(substring(providerID, from:6), "/")[0], "/", substring(name, from:4, to:poolAt)))
    | fieldsAdd cloudKey = coalesce(eksKey, if(isNotNull(aksRg), concat("AKS/", lower(aksRg))), gkeKey)
    | filter isNotNull(cloudKey)
    | summarize k8sUid = takeAny(k8s.cluster.uid), by:{cloudKey}`;

/** Cloud-integration clusters with the Kubernetes-monitored cluster (k8sUid) each one is, if any. */
const cloudClusters = (tf: Timeframe) => `smartscapeNodes ${CLOUD_CLUSTER_TYPES.map((t) => `"${t}"`).join(", ")}, ${from(tf)}
    | parse coalesce(aws.object, azure.object, gcp.object), "JSON:o"
    | fieldsAdd provider = if(type == "AWS_EKS_CLUSTER", "EKS", else: if(type == "${AKS_TYPE}", "AKS", else: "GKE"))
    | fieldsAdd cloudKey = if(provider == "EKS", concat("EKS/", aws.account.id, "/", aws.region, "/", name),
          else: if(provider == "AKS", concat("AKS/", lower(o[configuration][properties][nodeResourceGroup])), else: concat("GKE/", gcp.project.id, "/", name))),
        nameKey = concat(provider, "/", name)
    | lookup [${k8sNodeCloudKeys(tf).replace(/\n {4}/g, "\n        ")}
      ], sourceField:cloudKey, lookupField:cloudKey, fields:{k8sUid}
    | lookup [smartscapeNodes "K8S_CLUSTER", ${from(tf)} | fields nameKey = concat(k8s.cluster.distribution, "/", k8s.cluster.name), byName = k8s.cluster.uid], sourceField:nameKey, lookupField:nameKey, fields:{byName}
    | fields cloudId = id, cloudName = name, cloudProvider = provider, k8sUid = coalesce(k8sUid, byName),
        cloudAccount = coalesce(aws.account.id, azure.subscription, gcp.project.id), cloudLocation = coalesce(aws.region, azure.location, gcp.location),
        cloudResourceGroup = azure.resource.group,
        cloudVersion = coalesce(o[configuration][version], o[configuration][properties][kubernetesVersion], o[configuration][resource][currentMasterVersion]),
        cloudState = coalesce(aws.state, azure.provisioning_state, o[configuration][resource][status])`;

const CLOUD_FIELDS = "cloudId, cloudName, cloudProvider, cloudAccount, cloudLocation, cloudResourceGroup, cloudVersion, cloudState";

/** Cloud-integration clusters with their Kubernetes match (Kubernetes tab: clusters gauge and table). */
export const k8sCloudClustersQuery = (tf: Timeframe) => cloudClusters(tf).replace(/\n {4}/g, "\n");

/**
 * One row per DynaKube (spec, status, Operator version) plus one per cluster without a DynaKube: Kubernetes clusters in
 * Smartscape, cluster UIDs reported only on containers (host-installed OneAgent, no Kubernetes monitoring), and managed
 * clusters seen only through a cloud integration (no Kubernetes monitoring, no Operator). Clusters that are also cloud
 * clusters carry the cloud cluster's fields (cloud*).
 */
export const k8sClustersQuery = (tf: Timeframe) => `${dynakubes(tf).replace(/\n {4}/g, "\n")}
| fieldsAdd conds = o[status][conditions]
| fieldsAdd failing = if(conds[][status] != "True", conds[][type]), nsMatch = if(conds[][type] == "OneAgentNamespacesMonitored", conds[][message])
| fieldsAdd failing = arrayRemoveNulls(failing), nsMatch = arrayFirst(arrayRemoveNulls(nsMatch)), dkKey = concat(k8s.cluster.uid, "/", name)
| lookup [smartscapeNodes "K8S_NAMESPACE", ${from(tf)}
    | fieldsAdd dk = \`tags:k8s.labels\`[\`dynakube.internal.dynatrace.com/instance\`]
    | filter isNotNull(dk)
    | summarize selected = count(), by:{dkKey = concat(k8s.cluster.uid, "/", dk)}
  ], sourceField:dkKey, lookupField:dkKey, fields:{selected}
| lookup [smartscapeNodes "CONTAINER", ${from(tf)}
    | filter k8s.container.name == "operator" and endsWith(container.image.name, "/dynatrace-operator")
    | summarize operatorVersions = collectDistinct(container.image.version), by:{k8s.cluster.uid}
  ], sourceField:k8s.cluster.uid, lookupField:k8s.cluster.uid, fields:{operatorVersions}
| lookup [smartscapeNodes "K8S_CLUSTER", ${from(tf)} | fields k8s.cluster.uid, clusterId = id], sourceField:k8s.cluster.uid, lookupField:k8s.cluster.uid, fields:{clusterId}
| fields id, name, clusterId, cluster = k8s.cluster.name, clusterUid = k8s.cluster.uid, namespace = k8s.namespace.name, mode = dkMode, autoInjection, k8sMonitoring = isNotNull(clusterId),
    apiVersion = o[apiVersion], phase = o[status][phase], operatorVersions,
    oneAgentVersion = o[status][oneAgent][version], codeModulesVersion = o[status][codeModules][version],
    activeGateVersion = o[status][activeGate][version], activeGateCapabilities = o[spec][activeGate][capabilities],
    hostGroup = o[spec][oneAgent][hostGroup],
    metadataEnrichment = coalesce(o[spec][metadataEnrichment][enabled], false), logMonitoring = isNotNull(o[spec][logMonitoring]),
    kspm = isNotNull(o[spec][kspm]), extensions = isNotNull(o[spec][extensions]), telemetryIngest = isNotNull(o[spec][telemetryIngest]),
    namespaceSelector = toString(coalesce(o[spec][oneAgent][cloudNativeFullStack][namespaceSelector], o[spec][oneAgent][applicationMonitoring][namespaceSelector])),
    otlpExporter = isNotNull(o[spec][otlpExporterConfiguration]), selected, nsMatch, failing, updated = o[status][updatedTimestamp],
    annotations = toString(\`tags:k8s.annotations\`)
| append [smartscapeNodes "K8S_CLUSTER", "CONTAINER", ${from(tf)}
    | filter isNotNull(k8s.cluster.uid)
    | summarize clusterIds = collectDistinct(if(type == "K8S_CLUSTER", id)), names = collectDistinct(coalesce(k8s.cluster.name, if(type == "K8S_CLUSTER", name))),
        containers = countIf(type == "CONTAINER" and lifetime[end] >= now() - ${K8S_LIVE_MINUTES}m), by:{k8s.cluster.uid}
    | lookup [smartscapeNodes "K8S_DYNAKUBE", ${from(tf)} | summarize dks = count(), by:{k8s.cluster.uid}], sourceField:k8s.cluster.uid, lookupField:k8s.cluster.uid, fields:{dks}
    | filter isNull(dks)
    | fieldsAdd clusterIds = arrayRemoveNulls(clusterIds), names = arrayRemoveNulls(names)
    | fields clusterId = arrayFirst(clusterIds), cluster = coalesce(arrayFirst(names), k8s.cluster.uid), clusterUid = k8s.cluster.uid, mode = "NONE",
        k8sMonitoring = arraySize(clusterIds) > 0, containers]
| lookup [${cloudClusters(tf)}
    | filter isNotNull(k8sUid)
  ], sourceField:clusterUid, lookupField:k8sUid, fields:{${CLOUD_FIELDS}}
| append [${cloudClusters(tf)}
    | filter isNull(k8sUid)
    | fields cluster = cloudName, mode = "NONE", k8sMonitoring = false, containers = 0, ${CLOUD_FIELDS}]
| sort cluster asc, name asc`;

export type K8sView = "workload" | "namespace";
/** `statuses`: injection statuses to match (any of them; empty = any status). */
export type K8sSearch = { view: K8sView; cluster: string; namespace: string; name: string; mode: string; statuses: string[] };
export const K8S_SEARCH_LIMIT = 500;

/**
 * Workloads (or namespaces) matching cluster / namespace / name / monitoring mode / injection status, with their Smartscape
 * node ID for the overview link. The status filter on workloads matches any pod with that status. Max K8S_SEARCH_LIMIT rows.
 */
export function k8sSearchQuery(tf: Timeframe, f: K8sSearch): string {
  const scope: string[] = [];
  if (f.cluster) scope.push(`k8s.cluster.uid == ${dqlString(f.cluster)}`);
  if (f.namespace) scope.push(`contains(k8s.namespace.name, ${dqlString(f.namespace)}, caseSensitive:false)`);
  const where = (c: string[]) => (c.length ? `\n| filter ${c.join(" and ")}` : "");
  const anyOf = (c: string[]) => (c.length === 1 ? c[0] : `(${c.join(" or ")})`);
  if (f.view === "namespace") {
    const after: string[] = [];
    if (f.mode) after.push(`mode == ${dqlString(f.mode)}`);
    if (f.statuses.length) after.push(`in(status, array(${f.statuses.map(dqlString).join(", ")}))`);
    return `${k8sNamespacesBase(tf)}${where([...scope, ...after])}
| fields id, cluster = k8s.cluster.name, clusterUid = k8s.cluster.uid, namespace = k8s.namespace.name, dynakube = nsDk, mode, status, pods, oneAgentPods, otelPods
| sort cluster asc, namespace asc
| limit ${K8S_SEARCH_LIMIT}`;
  }
  const pre = [...scope, "isNotNull(k8s.workload.name)"];
  if (f.name) pre.push(`contains(k8s.workload.name, ${dqlString(f.name)}, caseSensitive:false)`);
  const post: string[] = [];
  if (f.mode) post.push(f.mode === "MIXED" ? `mode == "MIXED"` : `in(${dqlString(f.mode)}, modes)`);
  if (f.statuses.length) {
    post.push(
      anyOf(f.statuses.map((s) => (s === "PARTIAL" ? `status == "PARTIAL"` : s === "CONTAINER_BLOCK" ? `(containerBlockPods > 0 and mode != "DYNATRACE")` : `in(${dqlString(s)}, statuses)`))),
    );
  }
  return `${k8sPods(tf)}${where(pre)}
${workloadRollup}${where(post)}
| fieldsAdd wKey = ${WORKLOAD_KEY}
| lookup [smartscapeNodes ${WORKLOAD_TYPES.map((t) => `"${t}"`).join(", ")}, ${from(tf)}
    | fields wKey = concat(k8s.cluster.uid, "/", k8s.namespace.name, "/", lower(substring(type, from:4)), "/", name), nodeId = id, nodeType = type
  ], sourceField:wKey, lookupField:wKey, fields:{nodeId, nodeType}
| fields nodeId, nodeType, cluster = k8s.cluster.name, clusterUid = k8s.cluster.uid, namespace = k8s.namespace.name, kind = k8s.workload.kind, workload = k8s.workload.name,
    mode, status, statuses, pods, oneAgentPods, otelPods, blockedPods, containerBlockPods
| sort cluster asc, namespace asc, workload asc
| limit ${K8S_SEARCH_LIMIT}`;
}

export type K8sTarget = { kind: "workload" | "namespace"; clusterUid: string; namespace: string; workloadKind?: string; workload?: string };

/** Running pods of one workload or namespace with every field the diagnosis needs (annotations as JSON text). Max 200 pods. */
export const k8sTargetPodsQuery = (tf: Timeframe, t: K8sTarget) => `${k8sPods(tf)}
| filter k8s.cluster.uid == ${dqlString(t.clusterUid)} and k8s.namespace.name == ${dqlString(t.namespace)}${
  t.kind === "workload" ? ` and k8s.workload.kind == ${dqlString(t.workloadKind ?? "")} and k8s.workload.name == ${dqlString(t.workload ?? "")}` : ""
}
| fields id, name, podUid = k8s.pod.uid, workloadKind = k8s.workload.kind, workload = k8s.workload.name, nsDk, nsDkMode, nsAutoInjection, dkModes,
    mode, status, reason, oneAgent, otelDynatrace, otelOperator, otelSdk, podBlock, optIn, containerBlock, metadataOnly, system, annotations = toString(a),
    phase = k8s.pod.phase, start = lifetime[start], end = lifetime[end]
| sort end desc
| limit 200`;

/**
 * Process instances in the given pods (classic process group instances carry KUBERNETES_POD_UID), with their deep-monitoring
 * evidence. One iAny() expression: an or-chain of in() calls exceeds the expression limit beyond ~80 pods.
 */
export const k8sTargetProcessesQuery = (tf: Timeframe, podUids: string[]) => `${pgiBase(tf)}
| filter iAny(in(metadata[], array(${(podUids.length ? podUids : [""]).map((u) => dqlString(`KUBERNETES_POD_UID:${u}`)).join(", ")})))
${detailTail(tf, 200)}`;

// --- ActiveGates ------------------------------------------------------------------
// Inventory: Smartscape ACTIVEGATE, SYNTHETIC_ENGINE and ZREMOTE nodes (environment ActiveGates by purpose). `modules`
// lists the modules the ActiveGate reports as enabled; one ActiveGate can appear under two node types when it was
// reinstalled with another purpose (0x79e53f91 on the demo tenant), so rows are deduplicated by dt.active_gate.id.
// Health: ActiveGate self-monitoring metrics (dsfm:active_gate.*, dt.sfm.* in Grail), keyed by dt.active_gate.id. A
// timeseries takes at most 10 metric keys, so the per-ActiveGate values are three appended blocks merged by summarize.
// OneAgent-embedded ActiveGates (working_mode "embedded") report the same metrics and are left out; extension and
// synthetic metrics carry no working_mode, hence isFalseOrNull (a plain != drops them).
export const AG_OFFLINE_MINUTES = 20;
const NOT_EMBEDDED = `filter:{isFalseOrNull(dt.active_gate.working_mode == "embedded")}`;

/** One row per environment ActiveGate: purpose, group, network zone, version, enabled modules, deployment, token ID. */
export const activeGatesQuery = (tf: Timeframe) => `smartscapeNodes "ACTIVEGATE", "SYNTHETIC_ENGINE", "ZREMOTE", ${from(tf)}
| fieldsAdd lastSeen = lifetime[end]
| dedup dt.active_gate.id, sort:{lastSeen desc}
| lookup [smartscapeNodes "K8S_CLUSTER", ${from(tf)} | fields k8s.cluster.uid, clusterName = name, clusterId = id], sourceField:k8s.cluster.uid, lookupField:k8s.cluster.uid, fields:{clusterName, clusterId}
| fields id, name, type, agId = dt.active_gate.id, group = dt.active_gate.group.name, networkZone = dt.network_zone.id, version = dt.active_gate.version, modules,
    containerized = is_containerized, clusterName, clusterId, startup = startup_time, lastSeen, online = lastSeen >= now() - ${AG_OFFLINE_MINUTES}m, tokenId = dt.active_gate.auth_token.id,
    extVersion = dt.remote_extensions.version, syntheticVersion = dt.synthetic_engine.version, zremoteVersion = dt.zremote.version, fips = is_fips,
    osType = os.type, osVersion = os.version, arch = os.architecture, capabilities, nodeSize = node_size
| sort name asc`;

/** Self-monitoring per ActiveGate over the timeframe: communication, resources, module errors and module activity. */
export const activeGateHealthQuery = (tf: Timeframe) => `timeseries {
    dropped = sum(dt.sfm.active_gate.communication.messages.dropped, scalar:true),
    rejected = sum(dt.sfm.active_gate.communication.messages.rejected, scalar:true),
    resent = sum(dt.sfm.active_gate.communication.messages.resent, scalar:true),
    queueMax = max(dt.sfm.active_gate.communication.queue.outgoing.usage, scalar:true),
    heapUsed = avg(dt.sfm.active_gate.jvm.heap_memory_used, scalar:true),
    heapAvail = avg(dt.sfm.active_gate.jvm.heap_memory_available, scalar:true),
    jvmCpu = avg(dt.sfm.active_gate.jvm.cpu_usage, scalar:true),
    sysCpu = max(dt.sfm.active_gate.system.cpu_usage, scalar:true),
    volFree = min(dt.sfm.active_gate.storage.volume.free, scalar:true),
    volTotal = max(dt.sfm.active_gate.storage.volume.total, scalar:true)
  }, by:{dt.active_gate.id}, ${NOT_EMBEDDED}, union:true, ${from(tf)}
| append [timeseries {
    threadQueue = max(dt.sfm.active_gate.thread_pool.queue_size, scalar:true),
    ingestRejected = sum(dt.sfm.active_gate.metrics.ingest.grail.datapoints.rejected, scalar:true),
    otlpRejected = sum(dt.sfm.active_gate.metrics.ingest.otlp.datapoints.rejected, scalar:true),
    awsLost = max(dt.sfm.active_gate.aws.data_lost_monitoring_status, scalar:true),
    awsBad = sum(dt.sfm.active_gate.aws.elements.bad, scalar:true),
    awsEmpty = sum(dt.sfm.active_gate.aws.empty_responses, scalar:true),
    awsDelay = max(dt.sfm.active_gate.aws.data_delay, scalar:true),
    k8sEvictions = sum(dt.sfm.active_gate.kubernetes.cache.eviction_count, scalar:true),
    eecLinesRejected = sum(dt.sfm.extension.engine.metric_ingest.lines_rejected, scalar:true),
    eecLogsRejected = sum(dt.sfm.extension.engine.logs_ingest.records_rejected, scalar:true)
  }, by:{dt.active_gate.id}, ${NOT_EMBEDDED}, union:true, ${from(tf)}]
| append [timeseries {
    awsRequests = sum(dt.sfm.active_gate.aws.requests, scalar:true),
    k8sQueries = sum(dt.sfm.active_gate.kubernetes.api.query_count, scalar:true),
    agents = max(dt.sfm.active_gate.communication.agent_modules.connected, scalar:true),
    beacons = sum(dt.sfm.active_gate.rum.beacon_forwarded_count, scalar:true),
    restRequests = sum(dt.sfm.active_gate.rest.request_count, scalar:true),
    grailAccepted = sum(dt.sfm.active_gate.metrics.ingest.grail.datapoints.accepted, scalar:true),
    otlpReceived = sum(dt.sfm.active_gate.metrics.ingest.otlp.datapoints.received.total, scalar:true),
    eventsIn = sum(dt.sfm.active_gate.event_ingest.event_incoming_count, scalar:true),
    eecCpu = avg(dt.sfm.extension.engine.cpu_usage, scalar:true),
    synthUtil = avg(dt.sfm.synthetic.engine_utilization, scalar:true)
  }, by:{dt.active_gate.id}, ${NOT_EMBEDDED}, union:true, ${from(tf)}]
| summarize {dropped = max(dropped), rejected = max(rejected), resent = max(resent), queueMax = max(queueMax), heapUsed = max(heapUsed), heapAvail = max(heapAvail),
    jvmCpu = max(jvmCpu), sysCpu = max(sysCpu), volFree = max(volFree), volTotal = max(volTotal), threadQueue = max(threadQueue), ingestRejected = max(ingestRejected),
    otlpRejected = max(otlpRejected), awsLost = max(awsLost), awsBad = max(awsBad), awsEmpty = max(awsEmpty), awsDelay = max(awsDelay), k8sEvictions = max(k8sEvictions),
    eecLinesRejected = max(eecLinesRejected), eecLogsRejected = max(eecLogsRejected), awsRequests = max(awsRequests), k8sQueries = max(k8sQueries), agents = max(agents),
    beacons = max(beacons), restRequests = max(restRequests), grailAccepted = max(grailAccepted), otlpReceived = max(otlpReceived), eventsIn = max(eventsIn),
    eecCpu = max(eecCpu), synthUtil = max(synthUtil)}, by:{agId = dt.active_gate.id}
| filter isNotNull(agId)`;

/**
 * Module-level breakdowns in long format (agId, metric, key, n): AWS requests by response status, AWS data loss by service,
 * bad AWS elements, AWS connection status per credential (server side; "unassigned" = no ActiveGate runs it), Kubernetes
 * API calls that did not return 200 by status and path, rejected metric / OTLP data points by reason.
 */
export const activeGateDetailQuery = (tf: Timeframe) => `timeseries n = sum(dt.sfm.active_gate.aws.requests, scalar:true), by:{dt.active_gate.id, response.status}, ${from(tf)}
| filter n > 0
| fields agId = dt.active_gate.id, metric = "aws.requests", key = response.status, n
| append [timeseries n = max(dt.sfm.active_gate.aws.data_lost_monitoring_status, scalar:true), by:{dt.active_gate.id, aws.service, aws.data.type, credentials.name}, ${from(tf)}
    | filter n > 0
    | fields agId = dt.active_gate.id, metric = "aws.data_lost", key = concat(aws.service, " · ", aws.data.type, " · ", credentials.name), n]
| append [timeseries n = sum(dt.sfm.active_gate.aws.elements.bad, scalar:true), by:{dt.active_gate.id, aws.service}, ${from(tf)}
    | filter n > 0
    | fields agId = dt.active_gate.id, metric = "aws.elements.bad", key = aws.service, n]
| append [timeseries n = max(dt.sfm.server.aws.monitoring.status, scalar:true), by:{dt.active_gate.id, credentials.name}, ${from(tf)}
    | fields agId = dt.active_gate.id, metric = "aws.credentials", key = credentials.name, n]
| append [timeseries n = sum(dt.sfm.active_gate.kubernetes.api.query_count, scalar:true), by:{dt.active_gate.id, status_code, path}, filter:{status_code != "200"}, ${from(tf)}
    | filter n > 0
    | fields agId = dt.active_gate.id, metric = "k8s.api_errors", key = concat(status_code, " ", path), n]
| append [timeseries n = sum(dt.sfm.active_gate.metrics.ingest.grail.datapoints.rejected, scalar:true), by:{dt.active_gate.id, reason}, ${NOT_EMBEDDED}, ${from(tf)}
    | filter n > 0
    | fields agId = dt.active_gate.id, metric = "metrics.rejected", key = reason, n]
| append [timeseries n = sum(dt.sfm.active_gate.metrics.ingest.otlp.datapoints.rejected, scalar:true), by:{dt.active_gate.id, reason}, ${NOT_EMBEDDED}, ${from(tf)}
    | filter n > 0
    | fields agId = dt.active_gate.id, metric = "otlp.rejected", key = reason, n]
| sort agId asc, metric asc, n desc`;

/**
 * Latest status of every extension monitoring configuration assigned to an ActiveGate group (host-scoped configurations
 * run in OneAgent and carry no group). UNASSIGNED rows have the group but no ActiveGate: no ActiveGate in the group runs
 * them. `lastAt` is the index of the last bucket with that status, so the most recent status wins.
 */
export const activeGateExtensionsQuery = (tf: Timeframe) => `timeseries c = count(dt.sfm.extension.status), by:{dt.extension.config.id, \`dt.entity.extensions:configuration\`, dt.extension.name, dt.extension.ds, dt.extension.status, dt.active_gate.group.name, dt.active_gate.id}, filter:{isNotNull(dt.active_gate.group.name)}, ${from(tf)}
| fieldsAdd lastAt = arrayMax(iCollectArray(if(isNotNull(c[]), iIndex()))), samples = arraySum(c)
| dedup dt.extension.config.id, sort:{lastAt desc}
| fields configId = dt.extension.config.id, configEntity = \`dt.entity.extensions:configuration\`, extension = dt.extension.name, dataSource = dt.extension.ds, status = dt.extension.status, group = dt.active_gate.group.name, agId = dt.active_gate.id, lastAt, samples
| sort status asc, extension asc`;

/** The latest warning or error the extension framework reported per monitoring configuration (the reason behind a status). */
export const activeGateExtensionEventsQuery = (tf: Timeframe) => `fetch dt.system.events, ${from(tf)}
| filter event.kind == "EXTENSIONS_EVENT" and loglevel != "INFO" and isNotNull(dt.extension.config.id)
| dedup dt.extension.config.id, sort:{timestamp desc}
| fields configId = dt.extension.config.id, extension = dt.extension.name, status = dt.extension.status, loglevel, content, timestamp, group = dt.active_gate.group.name, agId = dt.active_gate.id
| sort timestamp desc
| limit 500`;

/** OneAgents per network zone (the zone each OneAgent reports), to show zones whose OneAgents have no ActiveGate to use. */
export const networkZoneAgentsQuery = (tf: Timeframe) => `smartscapeNodes "ONEAGENT", ${from(tf)}
| summarize oneAgents = count(), by:{zone = dt.network_zone.id}
| sort oneAgents desc`;

/** Communication and resources of one ActiveGate over time (96 buckets), for the diagnosis charts. */
export const activeGateTrendQuery = (tf: Timeframe, agId: string) => `timeseries {
    dropped = sum(dt.sfm.active_gate.communication.messages.dropped, default:0),
    rejected = sum(dt.sfm.active_gate.communication.messages.rejected, default:0),
    resent = sum(dt.sfm.active_gate.communication.messages.resent, default:0),
    queue = max(dt.sfm.active_gate.communication.queue.outgoing.usage),
    heapUsed = avg(dt.sfm.active_gate.jvm.heap_memory_used),
    heapSize = avg(dt.sfm.active_gate.jvm.heap_memory_available),
    cpu = max(dt.sfm.active_gate.system.cpu_usage)
  }, filter:{dt.active_gate.id == ${dqlString(agId)}}, union:true, bins:96, ${from(tf)}
| fieldsAdd heapPct = 100 * heapUsed[] / heapSize[]
| fieldsRemove heapUsed, heapSize`;

// --- Management zones -> segments ---------------------------------------------
/** Every classic entity type in Grail (575 on the demo tenant). */
export const ENTITY_TYPES_QUERY = `fetch dt.system.data_objects
| filter startsWith(name, "dt.entity.")
| fields name
| sort name asc`;

// DQL allows 1000 expressions per query; 180 appended fetches plus the tail stay well below it (200 was validated).
const MEMBERSHIP_CHUNK = 180;
// Fetched first in every chunk: a type that is known to carry managementZones, so the field resolves even when
// no other type in the chunk has it (types without the field fail on their own but are fine inside a union).
const ANCHOR_TYPE = "dt.entity.host";
const APP_ENTITY_PREFIXES = `array("APPLICATION", "MOBILE_APPLICATION", "CUSTOM_APPLICATION")`;

/**
 * Entities of the given management zones across every entity type, split into one query per chunk of types.
 * Each row is one zone + entity-ID prefix with classic IDs, matching Smartscape node IDs (via id_classic; process,
 * container and Kubernetes IDs differ between the two models) and frontend names of the zone's applications.
 */
export function mzMembershipQueries(tf: Timeframe, types: string[], zones: string[]): string[] {
  const rest = types.filter((t) => t !== ANCHOR_TYPE);
  const zoneList = `array(${zones.map(dqlString).join(", ")})`;
  const out: string[] = [];
  for (let i = 0; i < Math.max(rest.length, 1); i += MEMBERSHIP_CHUNK) {
    const fetches = [ANCHOR_TYPE, ...rest.slice(i, i + MEMBERSHIP_CHUNK)];
    out.push(`fetch \`${fetches[0]}\`, ${from(tf)}
${fetches.slice(1).map((t) => `| append [fetch \`${t}\`, ${from(tf)}]`).join("\n")}
| fields id, entity.name, managementZones
| expand managementZones
| filter in(managementZones, ${zoneList})
| fieldsAdd prefix = splitString(id, "-")[0]
| fieldsAdd frontend = if(in(prefix, ${APP_ENTITY_PREFIXES}), entity.name)
| join [smartscapeNodes "*", ${from(tf)} | filter isNotNull(id_classic) | fields sid = id, id_classic], kind:leftOuter, on:{left[id] == right[id_classic]}, fields:{sid}
| summarize entities = countDistinct(id), ids = collectDistinct(id), sids = collectDistinct(sid), frontends = collectDistinct(frontend), by:{zone = managementZones, prefix}`);
  }
  return out;
}

/** Segment variable query: reads the zone's single-row lookup (first column = primary variable). */
export const segmentVariableQuery = (path: string) => `load "${path}"
| fields zone = key, ids, frontends`;

/** Distinct ownership values in use on entities (label / property values), with how many entities carry each. */
export const ownerValuesQuery = (tf: Timeframe) => `smartscapeNodes ${OWNER_TYPES.map((t) => `"${t}"`).join(", ")}, ${from(tf)}
| fieldsAdd ownerValue = toString(${OWNER_EXPR})
| filter isNotNull(ownerValue)
| summarize entities = count(), by:{ownerValue}
| sort entities desc
| limit 200`;

// --- Frontends (web applications) ----------------------------------------------
// Classic entities (web applications, synthetic monitors) carry ownership as a classic tag `<key>:<team>` where <key>
// is one of OWNER_KEYS (builtin:ownership.config). The first matching tag is the owner.
const OWNER_TAG_MATCH = OWNER_KEYS.map((k) => `startsWith(tags[], "${k}:")`).join(" or ");
const classicOwnerFields = `| fieldsAdd ownerTags = if(${OWNER_TAG_MATCH}, tags[])
| fieldsAdd ownerTags = arrayRemoveNulls(ownerTags)
| fieldsAdd owner = if(arraySize(ownerTags) > 0, substring(ownerTags[0], from: indexOf(ownerTags[0], ":") + 1))`;

/** Appended to a query to force a re-run after the app changed the data behind it (DQL ignores comments). */
export const refreshMarker = (n: number) => (n > 0 ? `\n// refresh ${n}` : "");

/**
 * Every web application with the number of synthetic monitors assigned to it (browser, HTTP, third-party), read from
 * the classic `monitors` relationship, and its owning team (classic owner tag). RUM enablement, health alerts and user
 * tags come from settings, not DQL.
 */
export const frontendsQuery = (tf: Timeframe) => `fetch dt.entity.application, ${from(tf)}
| fields id, name = entity.name, tags
${classicOwnerFields}
| fieldsRemove tags, ownerTags
| lookup [
    fetch dt.entity.synthetic_test, ${from(tf)}
    | fieldsAdd app = monitors[dt.entity.application], kind = "browser"
    | append [fetch dt.entity.http_check, ${from(tf)} | fieldsAdd app = monitors[dt.entity.application], kind = "http"]
    | append [fetch dt.entity.external_synthetic_test, ${from(tf)} | fieldsAdd app = monitors[dt.entity.application], kind = "thirdparty"]
    | expand app
    | filter isNotNull(app)
    | summarize monitors = count(), browser = countIf(kind == "browser"), http = countIf(kind == "http"), thirdparty = countIf(kind == "thirdparty"), by:{app}
  ], sourceField:id, lookupField:app, fields:{monitors, browser, http, thirdparty}
| fieldsAdd monitors = coalesce(monitors, 0), browser = coalesce(browser, 0), http = coalesce(http, 0), thirdparty = coalesce(thirdparty, 0)
| sort name asc`;

// Classic entity types scored on the Ownership tab (they have no Smartscape label/property map, only classic tags).
export type ClassicOwnerType = "FRONTEND" | "BROWSER_MONITOR" | "HTTP_MONITOR";
export const CLASSIC_OWNER_TYPES: { type: ClassicOwnerType; table: string; title: string; plural: string }[] = [
  { type: "FRONTEND", table: "dt.entity.application", title: "Frontends", plural: "frontends" },
  { type: "BROWSER_MONITOR", table: "dt.entity.synthetic_test", title: "Browser monitors", plural: "browser monitors" },
  { type: "HTTP_MONITOR", table: "dt.entity.http_check", title: "HTTP monitors", plural: "HTTP monitors" },
];
const classicOwnerFetch = (tf: Timeframe) =>
  CLASSIC_OWNER_TYPES.map((t, i) => (i === 0 ? `fetch ${t.table}, ${from(tf)} | fieldsAdd type = "${t.type}"` : `| append [fetch ${t.table}, ${from(tf)} | fieldsAdd type = "${t.type}"]`)).join("\n");

/** Frontends and synthetic monitors: total and owned per type (Ownership tab). */
export const classicOwnershipQuery = (tf: Timeframe) => `${classicOwnerFetch(tf)}
${classicOwnerFields}
| summarize total = count(), owned = countIf(isNotNull(owner)), by:{type}`;

/** Every frontend and synthetic monitor with its owner (null = none), for the owner-tag action. */
export const classicOwnerEntitiesQuery = (tf: Timeframe) => `${classicOwnerFetch(tf)}
${classicOwnerFields}
| fields id, name = entity.name, type, owner
| sort type asc, name asc
| limit 2000`;

/** Frontends and synthetic monitors without an owner tag (Ownership tab drill-down). */
export const classicUnownedQuery = (tf: Timeframe) => `${classicOwnerFetch(tf)}
${classicOwnerFields}
| filter isNull(owner)
| fields id, name = entity.name, type
| sort type asc, name asc
| limit 500`;

/** Browser and HTTP monitors with the web applications already assigned to them (Frontends tab: assign action). */
export const syntheticMonitorsQuery = (tf: Timeframe) => `fetch dt.entity.synthetic_test, ${from(tf)}
| fieldsAdd kind = "Browser", apps = monitors[dt.entity.application]
| append [fetch dt.entity.http_check, ${from(tf)} | fieldsAdd kind = "HTTP", apps = monitors[dt.entity.application]]
| fields id, name = entity.name, kind, apps
| sort name asc
| limit 1000`;

// --- Problem notifications ---------------------------------------------------------
// Every update of a Davis problem is a record in `events` (dt.davis.problems keeps only the latest one, so it misses
// problems that have closed since); labels.alerting_profile lists the alerting profiles the problem matched.
export const PROBLEM_DAYS = 7;
export const profileProblemsQuery = `fetch events, from:now()-${PROBLEM_DAYS}d
| filter event.kind == "DAVIS_PROBLEM" and event.status == "ACTIVE" and dt.analysis.ready == true
| expand profile = labels.alerting_profile
| filterOut isNull(profile)
| summarize problems = countDistinctExact(event.id), by: { profile }
| sort problems desc`;

// --- Deep monitoring (process code-module injection) ---------------------------
// Smartscape process nodes carry no injection state, so these read the classic process group instance table and
// count a process as deep monitored when it has evidence only a code module produces (validated on the tenant):
//   - `installerVersion`: the OneAgent build that injected a code module (set on every instance emitting OneAgent spans);
//   - services a code module detected on it: `agentTechnologyType` (JAVA, DOTNET, NODEJS, IIS, GO, SDK, Z, …) is set on
//     those; database, OpenTelemetry-only and external services carry "N/A" and are not counted;
//   - code-module runtime metrics (`dt.runtime.*`: JVM, CLR, Node.js, IIS, …), unless the host is in Infrastructure or
//     Discovery mode, where OneAgent injects for runtime metrics only (no traces). This catches instances without
//     `installerVersion`, e.g. Node.js clients with runtime metrics but no incoming requests.
// Technology = classic `processType`, except IIS service hosts (svchost.exe / inetinfo.exe typed IIS), which are
// split out as IIS_SERVICE_HOST: OneAgent instruments IIS in the w3wp.exe worker processes (IIS app pools).
const PGI = "dt.entity.process_group_instance";
const TECH_EXPR = `if(processType == "IIS" and (in("EXE_NAME:svchost.exe", metadata) or in("EXE_NAME:inetinfo.exe", metadata)), "IIS_SERVICE_HOST", else: coalesce(processType, "OTHER"))`;

/** Deep Monitoring search: rows fetched (3 pages of DEEP_PAGE_SIZE in the results table). */
export const DEEP_SEARCH_LIMIT = 150;
export const DEEP_PAGE_SIZE = 50;

export type DeepState = "any" | "deep" | "not-deep" | "partial";
export type DeepSearch = { name: string; group: string; technology: string; state: DeepState };

const pgiBase = (tf: Timeframe) => `fetch ${PGI}, ${from(tf)}
| fieldsAdd pg = instance_of[dt.entity.process_group], host = belongs_to[dt.entity.host], technology = ${TECH_EXPR}`;
const pgNameLookup = (tf: Timeframe) =>
  `| lookup [fetch dt.entity.process_group, ${from(tf)} | fields id, pgName = entity.name], sourceField:pg, lookupField:id, fields:{pgName}`;
const hostLookup = (tf: Timeframe) =>
  `| lookup [fetch dt.entity.host, ${from(tf)} | fields id, hostName = entity.name, hostGroup = hostGroupName, hostGroupId = instance_of[dt.entity.host_group], monitoringMode, hostAgentVersion = installerVersion, osType], sourceField:host, lookupField:id, fields:{hostName, hostGroup, hostGroupId, monitoringMode, hostAgentVersion, osType}`;
const modeLookup = (tf: Timeframe) => `| lookup [fetch dt.entity.host, ${from(tf)} | fields id, monitoringMode], sourceField:host, lookupField:id, fields:{monitoringMode}`;
// Smartscape node ID, for the process overview link.
const sidLookup = (tf: Timeframe) =>
  `| lookup [smartscapeNodes "PROCESS", ${from(tf)} | fields sid = toString(id), id_classic], sourceField:id, lookupField:id_classic, fields:{sid}`;
// Services detected by a code module, per instance (evidence and display).
const serviceLookup = (tf: Timeframe) =>
  `| lookup [fetch dt.entity.service, ${from(tf)} | filter isNotNull(agentTechnologyType) and agentTechnologyType != "N/A" | fields agent = agentTechnologyType, pgi = runs_on[dt.entity.process_group_instance] | expand pgi | summarize codeServices = count(), serviceAgents = collectDistinct(agent), by:{pgi}], sourceField:id, lookupField:pgi, fields:{codeServices, serviceAgents}`;
// Up to 3 code-module runtime metric keys per instance (evidence and display).
// metric.series only accepts the last 10 days, so the 30-day timeframe reads runtime metrics from the last 10 days.
const runtimeLookup = (tf: Timeframe) =>
  `| lookup [fetch metric.series, from:now()-${tf === "30d" ? "10d" : tf} | filter startsWith(metric.key, "dt.runtime.") and isNotNull(dt.entity.process_group_instance) | summarize runtimeMetrics = collectDistinct(metric.key, maxLength:3), by:{dt.entity.process_group_instance}], sourceField:id, lookupField:dt.entity.process_group_instance, fields:{runtimeMetrics}`;
/** Needs installerVersion, codeServices, runtimeMetrics and monitoringMode in scope. */
const DEEP_FLAG = `| fieldsAdd isDeep = isNotNull(installerVersion) or coalesce(codeServices, 0) > 0 or (isNotNull(runtimeMetrics) and not in(coalesce(monitoringMode, ""), array("INFRASTRUCTURE", "DISCOVERY")))`;

/** Process instances and deep-monitored instances per technology. */
export const deepCoverageQuery = (tf: Timeframe) => `${pgiBase(tf)}
${modeLookup(tf)}
${serviceLookup(tf)}
${runtimeLookup(tf)}
${DEEP_FLAG}
| summarize total = count(), deep = countIf(isDeep), by:{technology}
| sort total desc`;

// Every field the diagnosis needs (search rows are diagnosed too, for the Status column).
const INSTANCE_FIELDS =
  "id, sid, name = entity.name, pg, pgName, host, hostName, hostGroup, hostGroupId, monitoringMode, hostAgentVersion, osType, processType, technology, softwareTechnologies, jvmClrVersion, jvmVendor, appVersion, installerVersion, codeServices, serviceAgents, runtimeMetrics, isDeep, isDockerized, metadata";

function instanceFilters(f: DeepSearch): string {
  const c: string[] = [];
  if (f.name) c.push(`contains(entity.name, ${dqlString(f.name)}, caseSensitive:false)`);
  if (f.technology) c.push(`technology == ${dqlString(f.technology)}`);
  return c.length ? `\n| filter ${c.join(" and ")}` : "";
}
const groupFilter = (f: DeepSearch) => (f.group ? `\n| filter contains(pgName, ${dqlString(f.group)}, caseSensitive:false)` : "");

/** Process instances matching name / process group / technology / deep monitoring state. Max DEEP_SEARCH_LIMIT rows. */
export const deepProcessSearchQuery = (tf: Timeframe, f: DeepSearch) => `${pgiBase(tf)}${instanceFilters(f)}
${pgNameLookup(tf)}${groupFilter(f)}
${hostLookup(tf)}
${serviceLookup(tf)}
${runtimeLookup(tf)}
${DEEP_FLAG}${f.state === "deep" ? "\n| filter isDeep" : f.state === "not-deep" ? "\n| filter not isDeep" : ""}
${sidLookup(tf)}
| fields ${INSTANCE_FIELDS}
| sort name asc
| limit ${DEEP_SEARCH_LIMIT}`;

/** Process groups with instance and deep-monitored counts. The state filter applies to the group (all / some / none deep). Max DEEP_SEARCH_LIMIT rows. */
export function deepGroupSearchQuery(tf: Timeframe, f: DeepSearch): string {
  const state =
    f.state === "deep" ? "\n| filter deep == instances" : f.state === "not-deep" ? "\n| filter deep == 0" : f.state === "partial" ? "\n| filter deep > 0 and deep < instances" : "";
  return `${pgiBase(tf)}${instanceFilters(f)}
${pgNameLookup(tf)}${groupFilter(f)}
${modeLookup(tf)}
${serviceLookup(tf)}
${runtimeLookup(tf)}
${DEEP_FLAG}
| summarize instances = count(), deep = countIf(isDeep), technologies = collectDistinct(technology), versions = collectDistinct(coalesce(jvmClrVersion, appVersion)), hosts = countDistinct(host), by:{pg, pgName}${state}
| sort pgName asc
| limit ${DEEP_SEARCH_LIMIT}`;
}

const detailTail = (tf: Timeframe, limit: number) => `${pgNameLookup(tf)}
${hostLookup(tf)}
${serviceLookup(tf)}
${runtimeLookup(tf)}
${DEEP_FLAG}
${sidLookup(tf)}
| fields ${INSTANCE_FIELDS}
| sort name asc
| limit ${limit}`;

/** Every field the diagnosis needs, for one process instance or every instance of one process group (max 200). */
export const deepDetailQuery = (tf: Timeframe, target: { kind: "process" | "group"; id: string }) => `${pgiBase(tf)}
| filter ${target.kind === "process" ? "id" : "pg"} == ${dqlString(target.id)}
${detailTail(tf, 200)}`;

/** IIS worker processes (w3wp.exe app pools) on the given hosts, with their deep-monitoring evidence. */
export const iisWorkersQuery = (tf: Timeframe, hostIds: string[]) => `${pgiBase(tf)}
| filter in(host, array(${hostIds.map(dqlString).join(", ")})) and in(technology, array("IIS_APP_POOL", "IIS"))
${detailTail(tf, 50)}`;

// --- Databases (extension vs OneAgent only) ---------------------------------------
// A database shows up in two places, and nothing in Smartscape links them (validated on the demo tenant, 2026-10-24):
//   - OneAgent: the database server process (classic process group instance). OneAgent sets processType for SQL Server,
//     MySQL (MariaDB too), PostgreSQL, MongoDB and Redis; Oracle, Db2 and SAP HANA are recognised by the server executable
//     (EXE_NAME), MariaDB by its executable path (bitnami images keep the mysqld name: .../mariadb/sbin/mariadbd).
//   - Extensions: the Smartscape DB_INSTANCE_<TECH> nodes the remote SQL extensions create (db.connection_details.*,
//     host.name = the server name the database reports, for example SQL Server's @@SERVERNAME). Their only edges are
//     DB_DATABASE runs_on and SERVICE calls. Local (OneAgent) extensions such as Redis create no DB_INSTANCE node; their
//     dt.sfm.extension.status series carry dt.entity.host (remote ones carry only the ActiveGate group).
// A DB instance matches a process of the same technology when its server name (or its first label) is the process's pod,
// host, workload or container name, or when its endpoint (connection host, its first one or two labels, or IP) is the
// process's pod / workload(.namespace) / host name or host IP and the endpoint port is one the process listens on (any
// port when OneAgent reports none). The server name needs no port: endpoints often go through a load balancer.
export type DbTech = "MSSQL" | "ORACLE" | "POSTGRES" | "MYSQL" | "MARIADB" | "DB2" | "HANA" | "MONGODB" | "REDIS";
type DbMatch = {
  tech: DbTech;
  processTypes: string[];
  /** Lower-case server executable names (EXE_NAME). */
  exes: string[];
  /** Also these process types / executables when the executable path contains `path` (MariaDB runs as mysqld in some images). */
  path?: { contains: string; exes: string[] };
  /** Dynatrace extension for the technology. */
  extension: string;
  /** Lower-case parts of extension names that monitor the technology (local extensions on the process's host). */
  tokens: string[];
};
// MariaDB comes before MySQL: OneAgent types both MYSQL. Valkey (the Redis fork, untyped by OneAgent) is counted as Redis.
export const DB_MATCH: DbMatch[] = [
  { tech: "MSSQL", processTypes: ["MSSQL"], exes: ["sqlservr", "sqlservr.exe"], extension: "com.dynatrace.extension.sql-server", tokens: ["sql-server", "mssql"] },
  { tech: "MARIADB", processTypes: [], exes: ["mariadbd", "mariadbd.exe"], path: { contains: "mariadb", exes: ["mysqld", "mysqld.exe"] }, extension: "com.dynatrace.extension.mariadb", tokens: ["mariadb"] },
  { tech: "MYSQL", processTypes: ["MYSQL"], exes: ["mysqld", "mysqld.exe"], extension: "com.dynatrace.extension.mysql", tokens: ["mysql"] },
  { tech: "POSTGRES", processTypes: ["POSTGRES"], exes: ["postgres", "postgres.exe"], extension: "com.dynatrace.extension.postgres", tokens: ["postgres"] },
  { tech: "ORACLE", processTypes: [], exes: ["oracle", "oracle.exe"], extension: "com.dynatrace.extension.sql-oracle", tokens: ["sql-oracle"] },
  { tech: "DB2", processTypes: [], exes: ["db2sysc", "db2syscs.exe"], extension: "com.dynatrace.extension.sql-db2", tokens: ["db2"] },
  { tech: "HANA", processTypes: [], exes: ["hdbnameserver"], extension: "com.dynatrace.extension.sql-sap-hana", tokens: ["hana"] },
  { tech: "MONGODB", processTypes: ["MONGODB"], exes: ["mongod", "mongod.exe"], extension: "com.dynatrace.extension.mongodb", tokens: ["mongodb"] },
  { tech: "REDIS", processTypes: ["REDIS"], exes: ["redis-server", "valkey-server"], extension: "com.dynatrace.extension.redis", tokens: ["redis", "valkey"] },
];
export const DB_LIMIT = 500;

const dqlList = (values: string[]) => `array(${values.map(dqlString).join(", ")})`;
/**
 * Fields set to the value of a KEY:value entry of a process instance's metadata ({field: KEY}). An iterative expression
 * must be stored in a field before arrayRemoveNulls() accepts it, hence the two steps.
 */
const metaFields = (fields: Record<string, string>) => {
  const e = Object.entries(fields);
  return `| fieldsAdd ${e.map(([f, k]) => `${f}All = if(startsWith(metadata[], "${k}:"), substring(metadata[], from:${k.length + 1}))`).join(",\n    ")}
| fieldsAdd ${e.map(([f]) => `${f} = arrayFirst(arrayRemoveNulls(${f}All))`).join(", ")}
| fieldsRemove ${e.map(([f]) => `${f}All`).join(", ")}`;
};

const DB_PROCESS_TECH = DB_MATCH.reduceRight((rest, m) => {
  const by = [...(m.processTypes.length ? [`in(processType, ${dqlList(m.processTypes)})`] : []), `in(exe, ${dqlList(m.exes)})`].join(" or ");
  // MySQL-typed processes with "mariadb" in the path; coalesce: a missing EXE_PATH must not end the if-chain with null.
  const cond = m.path ? `${by} or ((in(processType, array("MYSQL")) or in(exe, ${dqlList(m.path.exes)})) and coalesce(contains(exePath, ${dqlString(m.path.contains)}), false))` : by;
  return `if(${cond}, "${m.tech}"${rest ? `,\n      else: ${rest}` : ""})`;
}, "");
// DB_INSTANCE_MSSQL -> MSSQL (the type suffixes are the technology keys).
const DB_INSTANCE_TECH = `substring(type, from:12)`;
// Match keys put MariaDB with MySQL: the MySQL extension can monitor a MariaDB server (not officially supported).
const matchFamily = (field: string) => `if(${field} == "MARIADB", "MYSQL", else: ${field})`;
const LOCAL_EXT_MATCH = DB_MATCH.map((m) => `(dbTech == "${m.tech}" and (${m.tokens.map((t) => `contains(localExtensions[], ${dqlString(t)})`).join(" or ")}))`).join("\n      or ");

// Application runtimes (code-module technologies) are never database servers, so their metadata is not read.
const APP_PROCESS_TYPES = ["JAVA", "TOMCAT", "JBOSS", "WEBLOGIC", "WEBSPHERE", "GLASSFISH", "DOTNET", "IIS", "IIS_APP_POOL", "NODE_JS", "GO", "PHP", "PYTHON",
  "APACHE_HTTPD", "NGINX", "RUBY", "ERLANG", "ENVOY", "HAPROXY", "IBM_CICS_REGION", "APMNG"];
const dbTechFields = `${metaFields({ exe: "EXE_NAME", exePath: "EXE_PATH" })}
| fieldsAdd exe = lower(exe), exePath = lower(exePath)
| fieldsAdd dbTech = ${DB_PROCESS_TECH}
| filter isNotNull(dbTech)`;

// The database processes are found in a subquery and the fetch keeps only their IDs: with expand and a lookup in the same
// pipeline, filtering the whole process table there took 6-11 s over 30 days (1.7 s this way). The subquery uses one short
// test (any database type or executable) so the summary query stays below DQL's 1000-expression limit.
const DB_ANY = `in(processType, ${dqlList([...new Set(DB_MATCH.flatMap((m) => m.processTypes))])}) or in(lower(exe), ${dqlList([...new Set(DB_MATCH.flatMap((m) => [...m.exes, ...(m.path?.exes ?? [])]))])})`;
const dbProcessBase = (tf: Timeframe) => `fetch ${PGI}, ${from(tf)}
| filter id in [fetch ${PGI}, ${from(tf)}
    | filter isNull(processType) or not in(processType, ${dqlList(APP_PROCESS_TYPES)})
    ${indent(metaFields({ exe: "EXE_NAME" }))}
    | filter ${DB_ANY}
    | fields id]
${dbTechFields}
${metaFields({ pod: "KUBERNETES_FULL_POD_NAME", basePod: "KUBERNETES_BASE_POD_NAME", namespace: "KUBERNETES_NAMESPACE", k8sClusterId: "KUBERNETES_CLUSTER_ID", container: "CONTAINER_NAME" })}
| fieldsAdd host = belongs_to[dt.entity.host], pg = instance_of[dt.entity.process_group],
    workload = if(endsWith(basePod, "-*"), substring(basePod, to:stringLength(basePod) - 2), else: basePod)
| lookup [fetch dt.entity.host, ${from(tf)} | fields id, hostName = entity.name, ipAddress, monitoringMode, hostGroup = hostGroupName, osType], sourceField:host, lookupField:id, fields:{hostName, ipAddress, monitoringMode, hostGroup, osType}`;

// Every process and DB instance also gets a key that never matches ("#<id>"): expand drops a record whose array is empty,
// and the summary must still count it. First labels are only taken from names, never from IP addresses ("10" of 10.0.1.5).
/** One row per name or address the process can be reached by (pod, host, workload(.namespace), container, host IPs). */
const dbProcessKeys = (tf: Timeframe) => `${dbProcessBase(tf)}
| fieldsAdd addrs = arrayConcat(array(lower(pod), lower(hostName), if(isNull(toIp(hostName)), lower(splitString(hostName, ".")[0])), lower(workload),
    if(isNotNull(workload) and isNotNull(namespace), lower(concat(workload, ".", namespace))), lower(container), concat("#", id)), coalesce(ipAddress, array()))
| expand v = addrs
| filter isNotNull(v)
| dedup id, v
| fields key = concat(${matchFamily("dbTech")}, "|", v), v, pgi = id, pgiName = entity.name, listenPorts, dbTech, host`;

/** One row per name the DB instance reports or is reached by: server name ("server") and connection endpoint ("endpoint"). */
const dbInstanceKeys = (tf: Timeframe) => `smartscapeNodes "DB_INSTANCE_*", ${from(tf)}
| fieldsAdd dbTech = ${DB_INSTANCE_TECH}, server = lower(host.name), endpoint = lower(db.connection_details.hostname), dbPort = toString(db.connection_details.port)
| fieldsAdd serverParts = if(isNull(toIp(server)), splitString(server, ".")), endpointParts = if(isNull(toIp(endpoint)), splitString(endpoint, "."))
| fieldsAdd k = arrayRemoveNulls(array(
    if(isNotNull(server), record(v = server, via = "server")),
    if(arraySize(serverParts) > 1, record(v = serverParts[0], via = "server")),
    if(isNotNull(endpoint), record(v = endpoint, via = "endpoint")),
    if(arraySize(endpointParts) > 1, record(v = endpointParts[0], via = "endpoint")),
    if(arraySize(endpointParts) > 2, record(v = concat(endpointParts[0], ".", endpointParts[1]), via = "endpoint")),
    if(isNotNull(db.connection_details.ip), record(v = toString(db.connection_details.ip), via = "endpoint")),
    record(v = concat("#", toString(id)), via = "none")))
| expand k
| fields key = concat(${matchFamily("dbTech")}, "|", k[v]), via = k[via], dbId = id, dbName = name, dbPort, dbTech`;

const DB_MATCHED = `via == "server" or arraySize(coalesce(listenPorts, array())) == 0 or in(dbPort, listenPorts)`;
const MATCHED_ON = `concat(v, if(via == "server", " (server name)", else: concat(":", coalesce(dbPort, "?"))))`;
const indent = (q: string, pad = "    ") => q.replace(/\n/g, `\n${pad}`);

/** Per process instance: the DB instances that match it. */
const processMatches = (tf: Timeframe) => `${indent(dbProcessKeys(tf))}
    | join [${indent(dbInstanceKeys(tf), "        ")}
      ], kind:inner, on:{left[key] == right[key]}, fields:{dbId, dbName, via, dbPort}
    | filter ${DB_MATCHED}
    | summarize instanceIds = collectDistinct(dbId), instances = collectDistinct(dbName), matchedOn = collectDistinct(${MATCHED_ON}), by:{pgi}`;

/** Per DB instance: the process instances that match it. */
const instanceMatches = (tf: Timeframe) => `${indent(dbInstanceKeys(tf))}
    | join [${indent(dbProcessKeys(tf), "        ")}
      ], kind:inner, on:{left[key] == right[key]}, fields:{pgi, pgiName, v, listenPorts}
    | filter ${DB_MATCHED}
    | summarize processIds = collectDistinct(pgi), processes = collectDistinct(pgiName), matchedOn = collectDistinct(${MATCHED_ON}), by:{dbId}`;

// metric.series only accepts the last 10 days (see runtimeLookup).
const localExtensions = (tf: Timeframe) => `fetch metric.series, from:now()-${tf === "30d" ? "10d" : tf}
    | filter metric.key == "dt.sfm.extension.status" and isNotNull(dt.entity.host)
    | summarize localExtensions = collectDistinct(dt.extension.name), by:{dt.entity.host}`;

const dbProcessesWithMatches = (tf: Timeframe) => `${dbProcessBase(tf)}
| lookup [${processMatches(tf)}
  ], sourceField:id, lookupField:pgi, fields:{instanceIds, instances, matchedOn}
| lookup [${localExtensions(tf)}], sourceField:host, lookupField:dt.entity.host, fields:{localExtensions}
| fieldsAdd localMatches = if(${LOCAL_EXT_MATCH}, localExtensions[])
| fieldsAdd localExtension = arrayFirst(arrayRemoveNulls(localMatches))
| fieldsAdd coverage = if(arraySize(instanceIds) > 0, "EXTENSION", else: if(isNotNull(localExtension), "LOCAL_EXTENSION", else: "ONEAGENT_ONLY"))`;

const dbInstancesWithMatches = (tf: Timeframe) => `smartscapeNodes "DB_INSTANCE_*", ${from(tf)}
| fieldsAdd dbTech = ${DB_INSTANCE_TECH}
| lookup [${instanceMatches(tf)}
  ], sourceField:id, lookupField:dbId, fields:{processIds, processes, matchedOn}`;

/**
 * Databases per technology: extension + OneAgent (a DB instance that matches a process, or a process with a local
 * extension on its host), extension only (no OneAgent process seen: remote / managed databases) and OneAgent only.
 * One outer join of both key sets gives every pair once; each row then counts for its DB instance and its process (the
 * same rules as the two tables, in one pass, so the query stays below DQL's 1000-expression limit).
 */
export const dbSummaryQuery = (tf: Timeframe) => `${dbProcessKeys(tf)}
| join [${indent(dbInstanceKeys(tf))}
  ], kind:outer, on:{left[key] == right[key]}, fields:{dbId, via, dbPort, instanceTech = dbTech}
| fieldsAdd ok = isNotNull(pgi) and isNotNull(dbId) and (${DB_MATCHED})
| fieldsAdd sides = array(record(side = "instance", id = dbId, tech = instanceTech), record(side = "process", id = pgi, tech = dbTech, host = host))
| expand s = sides
| filter isNotNull(s[id])
| summarize matches = countIf(ok), by:{side = s[side], id = s[id], dbTech = s[tech], host = s[host]}
| filter side == "instance" or matches == 0
| lookup [${localExtensions(tf)}], sourceField:host, lookupField:dt.entity.host, fields:{localExtensions}
| fieldsAdd localMatches = if(${LOCAL_EXT_MATCH}, localExtensions[])
| fieldsAdd category = if(side == "instance", if(matches > 0, "BOTH", else: "EXTENSION_ONLY"),
    else: if(arraySize(arrayRemoveNulls(localMatches)) > 0, "BOTH", else: "ONEAGENT_ONLY"))
| summarize databases = count(), by:{dbTech, category}
| sort dbTech asc, category asc`;

/** Every database server process OneAgent sees, with the extension that covers it (DB instance or local extension), if any. */
export const dbProcessesQuery = (tf: Timeframe) => `${dbProcessesWithMatches(tf)}
${sidLookup(tf)}
| fields id, sid, name = entity.name, dbTech, coverage, instanceIds, instances, matchedOn, localExtension, pg, host, hostName, ipAddress, monitoringMode, hostGroup, osType,
    listenPorts, pod, namespace, workload, container, k8sClusterId, exe
| sort coverage desc, dbTech asc, name asc
| limit ${DB_LIMIT}`;

/** Every DB instance an extension monitors, with the OneAgent processes it matches (none: remote / managed database). */
export const dbInstancesQuery = (tf: Timeframe) => `${dbInstancesWithMatches(tf)}
| fields id, classicId = id_classic, name, dbTech, coverage = if(arraySize(processIds) > 0, "BOTH", else: "EXTENSION_ONLY"), version = db.instance.version,
    endpointHost = db.connection_details.hostname, endpointIp = db.connection_details.ip, port = db.connection_details.port, serverName = host.name,
    k8sCluster = k8s.cluster.name, processIds, processes, matchedOn, lastSeen = lifetime[end]
| sort coverage desc, dbTech asc, name asc
| limit ${DB_LIMIT}`;

/** Latest status of every monitoring configuration of a database extension, per extension. */
// A local configuration reports one series per host, so the latest status is kept per configuration and host.
export const dbExtensionStatusQuery = (tf: Timeframe) => `timeseries c = count(dt.sfm.extension.status), by:{dt.extension.config.id, dt.extension.name, dt.extension.status, dt.active_gate.group.name, dt.entity.host},
    filter:{in(dt.extension.name, ${dqlList(DB_MATCH.map((m) => m.extension))})${DB_MATCH.flatMap((m) => m.tokens).map((t) => ` or contains(dt.extension.name, ${dqlString(t)})`).join("")}}, ${from(tf)}
| fieldsAdd lastAt = arrayMax(iCollectArray(if(isNotNull(c[]), iIndex())))
| dedup dt.extension.config.id, dt.entity.host, sort:{lastAt desc}
| summarize configs = countDistinctExact(dt.extension.config.id), ok = countDistinctExact(if(in(dt.extension.status, array("OK", "IDLE")), dt.extension.config.id)),
    statuses = collectDistinct(dt.extension.status), groups = arrayRemoveNulls(collectDistinct(dt.active_gate.group.name)), hosts = countDistinctExact(dt.entity.host), by:{extension = dt.extension.name}
| sort extension asc`;

/** ActiveGate groups with an ActiveGate that runs the Extensions module (where a remote database extension can run). */
export const dbAgGroupsQuery = (tf: Timeframe) => `smartscapeNodes "ACTIVEGATE", ${from(tf)}
| fieldsAdd lastSeen = lifetime[end]
| dedup dt.active_gate.id, sort:{lastSeen desc}
| filter in("EXTENSION_CONTROLLER", modules) and isNotNull(dt.active_gate.group.name)
| summarize activeGates = count(), online = countIf(lastSeen >= now() - ${AG_OFFLINE_MINUTES}m), by:{group = dt.active_gate.group.name}
| sort group asc`;

// --- Extensions (monitoring configurations, fastcheck, recommendations) ------------------------------------------
// Validated on the demo tenant, 2026-10-24. Remote configurations (ActiveGate group) reuse activeGateExtensionsQuery and
// activeGateExtensionEventsQuery from the ActiveGates tab. Local configurations report one dt.sfm.extension.status series
// per host (dt.entity.host, no group); Kubernetes (CONTAINER) configurations report neither; cloud data acquisition
// (integration-*) reports no status at all. A configuration's scope (host, host group, environment) is only in the
// Extensions API. A local series can come twice per host, with and without dt.entity.extensions:configuration.

/** Latest status per monitoring configuration and host, for configurations that do not run on an ActiveGate group. */
export const localExtensionStatusQuery = (tf: Timeframe) => `timeseries c = count(dt.sfm.extension.status), by:{dt.extension.config.id, \`dt.entity.extensions:configuration\`, dt.extension.name, dt.extension.ds, dt.extension.status, dt.entity.host}, filter:{isNull(dt.active_gate.group.name)}, ${from(tf)}
| fieldsAdd lastAt = arrayMax(iCollectArray(if(isNotNull(c[]), iIndex())))
| sort lastAt desc
| summarize {status = takeFirst(dt.extension.status), configEntity = takeAny(\`dt.entity.extensions:configuration\`), extension = takeFirst(dt.extension.name), dataSource = takeFirst(dt.extension.ds), lastAt = max(lastAt)},
    by:{configId = dt.extension.config.id, host = dt.entity.host}
| lookup [fetch dt.entity.host, ${from(tf)} | fields id, hostName = entity.name], sourceField:host, lookupField:id, fields:{hostName}
| sort status asc, extension asc`;

/**
 * Fastcheck and assignment results per monitoring configuration, from the extension framework (dt.system.events):
 * "Failed to assign monitoring configuration to ActiveGate. Reason: Fast check failed …" (or the authentication /
 * connection error the check returned), "Successfully assigned …" and "… has not been picked up for execution", plus any
 * data source message that mentions fastcheck. Repeats (the check runs again every hour) are one row with a count.
 */
export const extensionFastcheckQuery = (tf: Timeframe) => `fetch dt.system.events, ${from(tf)}
| filter event.kind == "EXTENSIONS_EVENT" and isNotNull(dt.extension.config.id)
| filter (event.provider == "EXTENSION_FRAMEWORK_CORE" and not startsWith(content, "Monitoring configuration deleted")) or contains(lower(content), "fastcheck") or contains(lower(content), "fast check")
| summarize occurrences = count(), firstAt = min(timestamp), lastAt = max(timestamp),
    by:{configId = dt.extension.config.id, extension = dt.extension.name, status = dt.extension.status, loglevel, content, group = dt.active_gate.group.name, agId = dt.active_gate.id}
| sort lastAt desc
| limit 500`;

/**
 * Names of the hosts and host groups monitoring configurations are scoped to. Always the last 30 days: a configuration
 * that targets a host not seen for that long is itself a finding (the host is gone, the configuration never runs).
 */
export const EXT_SCOPE_LOOKBACK = "30d";
export const extensionScopeNamesQuery = (ids: string[]) => {
  const hosts = ids.filter((i) => i.startsWith("HOST-"));
  const groups = ids.filter((i) => i.startsWith("HOST_GROUP-"));
  return `fetch dt.entity.host, from:now()-${EXT_SCOPE_LOOKBACK}
| filter in(id, ${dqlList(hosts.length ? hosts : ["-"])})
| fields id, name = entity.name, lastSeen = lifetime[end], monitoringMode, hostGroup = hostGroupName
| append [fetch dt.entity.host_group, from:now()-${EXT_SCOPE_LOOKBACK}
    | filter in(id, ${dqlList(groups.length ? groups : ["-"])})
    | lookup [fetch dt.entity.host, from:now()-${EXT_SCOPE_LOOKBACK} | summarize hosts = count(), by:{hostGroupId = instance_of[dt.entity.host_group]}], sourceField:id, lookupField:hostGroupId, fields:{hosts}
    | fields id, name = entity.name, hosts]`;
};

// Recommendations: processes OneAgent sees whose technology has a Dynatrace Hub extension (ID and Hub name verified
// against /platform/hub/v1/catalog/extensions, 2026-10-24). Databases are left out on purpose: the Databases tab covers
// them, and Hub entries in category "database" (Cassandra, Couchbase, Elasticsearch, Memcached, …) are not listed here.
// A process matches on any of: process type, software technology type (softwareTechnologies "type:<T>,…"), executable
// (EXE_NAME, lower case, exact or prefix), Java main class or jar file. `onlyProcessTypes` keeps client libraries out
// (OneAgent also reports RABBIT_MQ on applications that use a RabbitMQ client); Kafka is the broker's main class for the
// same reason. `tokens` are lower-case parts of extension names that cover the technology when they report from the host.
type ExtRecMatch = {
  tech: string;
  processTypes?: string[];
  techTypes?: string[];
  onlyProcessTypes?: string[];
  notTechTypes?: string[];
  exes?: string[];
  exePrefixes?: string[];
  mainClasses?: string[];
  jars?: string[];
  extension: string;
  tokens: string[];
};
export const EXT_REC_MATCH: ExtRecMatch[] = [
  { tech: "TOMCAT", processTypes: ["TOMCAT"], techTypes: ["APACHE_TOMCAT"], extension: "com.dynatrace.extension.jmx-tomcat-cp", tokens: ["tomcat"] },
  { tech: "JBOSS", processTypes: ["JBOSS"], extension: "com.dynatrace.extension.jmx-jboss-cp", tokens: ["jboss"] },
  { tech: "WEBLOGIC", processTypes: ["WEBLOGIC"], extension: "com.dynatrace.extension.jmx-weblogic-cp", tokens: ["weblogic"] },
  // z/OS Connect reports processType WEBSPHERE.
  { tech: "WEBSPHERE", processTypes: ["WEBSPHERE"], notTechTypes: ["ZOS_CONNECT"], extension: "com.dynatrace.extension.websphere-appserver", tokens: ["websphere"] },
  { tech: "KAFKA", mainClasses: ["kafka.Kafka", "io.confluent.support.metrics.SupportedKafka"], extension: "com.dynatrace.extension.jmx-kafka", tokens: ["kafka"] },
  { tech: "ZOOKEEPER", mainClasses: ["org.apache.zookeeper.server.quorum.QuorumPeerMain"], extension: "com.dynatrace.extension.jmx-zookeeper", tokens: ["zookeeper"] },
  { tech: "ACTIVEMQ", mainClasses: ["org.apache.activemq.console.Main"], jars: ["activemq.jar"], extension: "com.dynatrace.extension.jmx-activemq", tokens: ["activemq"] },
  {
    tech: "HADOOP",
    mainClasses: ["org.apache.hadoop.hdfs.server.namenode.NameNode", "org.apache.hadoop.hdfs.server.datanode.DataNode", "org.apache.hadoop.yarn.server.resourcemanager.ResourceManager", "org.apache.hadoop.yarn.server.nodemanager.NodeManager"],
    extension: "com.dynatrace.extension.jmx.hadoop",
    tokens: ["hadoop"],
  },
  { tech: "SPARK", mainClasses: ["org.apache.spark.deploy.master.Master", "org.apache.spark.deploy.worker.Worker"], extension: "com.dynatrace.extension.jmx.spark", tokens: ["spark"] },
  { tech: "JENKINS", jars: ["jenkins.war"], extension: "com.dynatrace.extension.yaml-jenkins", tokens: ["jenkins"] },
  { tech: "RABBITMQ", techTypes: ["RABBIT_MQ"], onlyProcessTypes: ["ERLANG"], extension: "com.dynatrace.rabbitmq", tokens: ["rabbitmq"] },
  { tech: "IBM_MQ", exes: ["amqzxma0", "amqzxma0.exe"], extension: "com.dynatrace.extension.ibm-mq", tokens: ["ibm-mq"] },
  { tech: "TIBCO_EMS", exes: ["tibemsd", "tibemsd64", "tibemsd.exe", "tibemsd64.exe"], extension: "com.dynatrace.extension.tibcoems", tokens: ["tibco"] },
  { tech: "HAPROXY", processTypes: ["HAPROXY"], extension: "com.dynatrace.extension.haproxy", tokens: ["haproxy"] },
  { tech: "IIS", processTypes: ["IIS", "IIS_APP_POOL"], extension: "com.dynatrace.extension.wmi.iis", tokens: ["iis"] },
  { tech: "MSMQ", exes: ["mqsvc.exe"], extension: "com.dynatrace.extension.wmi.msmq", tokens: ["msmq"] },
  { tech: "EXCHANGE", exes: ["msexchangetransport.exe", "microsoft.exchange.store.service.exe"], extension: "com.dynatrace.extension.ms-exchange", tokens: ["exchange"] },
  { tech: "HYPERV", exes: ["vmms.exe"], extension: "com.dynatrace.extension.hyperv", tokens: ["hyperv"] },
  { tech: "CITRIX_VDA", exes: ["brokeragent.exe"], extension: "com.dynatrace.extension.citrix-vda", tokens: ["citrix-vda"] },
  { tech: "SAP_ABAP", exes: ["disp+work", "disp+work.exe"], extension: "com.dynatrace.ext.sap", tokens: ["ext.sap"] },
  { tech: "PHP_FPM", exePrefixes: ["php-fpm"], extension: "com.dynatrace.extension.php-fpm", tokens: ["php-fpm"] },
  { tech: "SQUID", exes: ["squid"], extension: "com.dynatrace.squid", tokens: ["squid"] },
  { tech: "COREDNS", techTypes: ["CORE_DNS"], exes: ["coredns"], extension: "com.dynatrace.extension.coredns", tokens: ["coredns"] },
  { tech: "ETCD", techTypes: ["ETCD"], extension: "com.dynatrace.extension.etcd-for-k8s-control-plane", tokens: ["etcd"] },
  { tech: "OPENSHIFT_CONTROL_PLANE", exes: ["openshift-apiserver"], extension: "com.dynatrace.extension.kubernetes-control-plane", tokens: ["kubernetes-control-plane"] },
  { tech: "ISTIO", exes: ["pilot-discovery"], extension: "com.dynatrace.extension.istio-prometheus", tokens: ["istio"] },
  { tech: "CONSUL", exes: ["consul", "consul.exe"], extension: "com.dynatrace.extension.consul-statsd", tokens: ["consul"] },
  { tech: "OTEL_COLLECTOR", exePrefixes: ["otelcol"], extension: "com.dynatrace.extension.otel-collector", tokens: ["otel-collector"] },
  { tech: "ALERTMANAGER", exes: ["alertmanager"], extension: "com.dynatrace.alertmanager", tokens: ["alertmanager"] },
  { tech: "CEPH", exes: ["ceph-osd", "ceph-mon", "ceph-mgr"], extension: "com.dynatrace.extension.ceph", tokens: ["ceph"] },
  { tech: "REDPANDA", exes: ["redpanda"], extension: "com.dynatrace.extension.prometheus.red-panda", tokens: ["red-panda", "redpanda"] },
];
export const EXT_REC_LIMIT = 500;

const hasTech = (t: string) => `iAny(startsWith(softwareTechnologies[], ${dqlString(`type:${t},`)}))`;
const EXT_REC_TECH = EXT_REC_MATCH.reduceRight((rest, m) => {
  const any = [
    m.processTypes?.length && `in(processType, ${dqlList(m.processTypes)})`,
    ...(m.techTypes ?? []).map(hasTech),
    m.exes?.length && `in(exe, ${dqlList(m.exes)})`,
    ...(m.exePrefixes ?? []).map((p) => `startsWith(exe, ${dqlString(p)})`),
    m.mainClasses?.length && `in(main, ${dqlList(m.mainClasses)})`,
    m.jars?.length && `in(jar, ${dqlList(m.jars)})`,
  ].filter(Boolean);
  const all = [
    `(${any.join(" or ")})`,
    m.onlyProcessTypes?.length && `in(processType, ${dqlList(m.onlyProcessTypes)})`,
    ...(m.notTechTypes ?? []).map((t) => `not ${hasTech(t)}`),
  ].filter(Boolean);
  // coalesce: a missing field (no EXE_NAME, no processType) must not end the if-chain with null.
  return `if(coalesce(${all.join(" and ")}, false), "${m.tech}"${rest ? `,\n      else: ${rest}` : ""})`;
}, "");
const EXT_REC_LOCAL = EXT_REC_MATCH.map((m) => `(recTech == "${m.tech}" and (${m.tokens.map((t) => `contains(localExtensions[], ${dqlString(t)})`).join(" or ")}))`).join("\n      or ");

// Prefilter (same reason as dbProcessBase): one cheap test on the raw metadata entries finds the candidate IDs; reading
// the metadata fields and the if-chain over every process instance took 10.8 s for 30 days.
const uniq = (a: string[]) => [...new Set(a)];
const recMeta = (key: string, values: string[]) => values.map((v) => `${key}:${v}`.toLowerCase());
const EXT_REC_ANY = [
  `in(processType, ${dqlList(uniq(EXT_REC_MATCH.flatMap((m) => [...(m.processTypes ?? []), ...(m.onlyProcessTypes ?? [])])))})`,
  `iAny(in(substring(softwareTechnologies[], to:indexOf(softwareTechnologies[], ",")), ${dqlList(uniq(EXT_REC_MATCH.flatMap((m) => m.techTypes ?? [])).map((t) => `type:${t}`))}))`,
  `iAny(in(lower(metadata[]), ${dqlList(uniq(EXT_REC_MATCH.flatMap((m) => [...recMeta("EXE_NAME", m.exes ?? []), ...recMeta("JAVA_MAIN_CLASS", m.mainClasses ?? []), ...recMeta("JAVA_JAR_FILE", m.jars ?? [])])))}))`,
  ...uniq(EXT_REC_MATCH.flatMap((m) => recMeta("EXE_NAME", m.exePrefixes ?? []))).map((p) => `iAny(startsWith(lower(metadata[]), ${dqlString(p)}))`),
].join("\n      or ");

/** Every process with a technology from EXT_REC_MATCH, with the local extension reporting from its host (if any). */
const extRecBase = (tf: Timeframe) => `fetch ${PGI}, ${from(tf)}
| filter id in [fetch ${PGI}, ${from(tf)}
    | filter ${EXT_REC_ANY}
    | fields id]
${metaFields({ exe: "EXE_NAME", main: "JAVA_MAIN_CLASS", jar: "JAVA_JAR_FILE" })}
| fieldsAdd exe = lower(exe), jar = lower(jar)
| fieldsAdd recTech = ${EXT_REC_TECH}
| filter isNotNull(recTech)
| fieldsAdd host = belongs_to[dt.entity.host]
| lookup [${localExtensions(tf)}], sourceField:host, lookupField:dt.entity.host, fields:{localExtensions}
| fieldsAdd localMatches = if(${EXT_REC_LOCAL}, localExtensions[])
| fieldsAdd localExtension = arrayFirst(arrayRemoveNulls(localMatches))`;

/** Per technology: processes and hosts, and how many have a matching extension reporting from their host. */
export const extensionRecommendationsQuery = (tf: Timeframe) => `${extRecBase(tf)}
| summarize processes = count(), hosts = countDistinctExact(host), coveredProcesses = countIf(isNotNull(localExtension)),
    coveredHosts = countDistinctExact(if(isNotNull(localExtension), host)), by:{recTech}
| sort processes desc`;

/** The processes of one recommended technology, uncovered first, with host, host group and monitoring mode. */
export const extensionRecProcessesQuery = (tf: Timeframe, tech: string) => `${extRecBase(tf)}
| filter recTech == ${dqlString(tech)}
| lookup [fetch dt.entity.host, ${from(tf)} | fields id, hostName = entity.name, hostGroup = hostGroupName, hostGroupId = instance_of[dt.entity.host_group], monitoringMode], sourceField:host, lookupField:id, fields:{hostName, hostGroup, hostGroupId, monitoringMode}
${metaFields({ namespace: "KUBERNETES_NAMESPACE", pod: "KUBERNETES_FULL_POD_NAME" })}
${sidLookup(tf)}
| fields id, sid, name = entity.name, recTech, host, hostName, hostGroup, hostGroupId, monitoringMode, localExtension, namespace, pod
| sort isNotNull(localExtension) asc, hostName asc, name asc
| limit ${EXT_REC_LIMIT}`;

// --- Service Detection v2 -------------------------------------------------------------------------------------------
// Smartscape SERVICE nodes carry dt.service_detection.version ("1" / "2") and, for SDv1, dt.service.sdv1_type; where a
// service runs comes from its edges: belongs_to K8S_NAMESPACE / K8S_CLUSTER / K8S workload, runs_on PROCESS (host group,
// process group) and runs_on AWS_LAMBDA_FUNCTION. Dependents that pin the service ID: FRONTEND calls and HTTP_MONITOR
// monitors edges. Classic dt.entity.service adds agentTechnologyType, the web application / context root (several on
// one process = a multi-application process, which SDv2 would merge) and software technologies (application servers).
// Edge IDs are Smartscape IDs: lookups against classic tables go through toString(). Validated with dtctl on the demo
// tenant (123 services, 0.4 s for 24 hours).
const SDV2_WORKLOAD_TYPES = WORKLOAD_TYPES.map((t) => `"${t}"`).join(", ");
export const SDV2_SERVICE_LIMIT = 5000;

export const sdv2ServicesQuery = (tf: Timeframe) => `smartscapeNodes "SERVICE", ${from(tf)}
| fields id, sid = toString(id), name, sdVersion = dt.service_detection.version, sdv1Type = dt.service.sdv1_type
| lookup [fetch dt.entity.service, ${from(tf)}
    | fields id, tech = agentTechnologyType, appKey = coalesce(webApplicationId, contextRoot), softwareTechnologies
  ], sourceField:sid, lookupField:id, fields:{tech, appKey, softwareTechnologies}
| lookup [smartscapeEdges "belongs_to", ${from(tf)}
    | filter source_type == "SERVICE" and target_type == "K8S_NAMESPACE"
    | lookup [smartscapeNodes "K8S_NAMESPACE", ${from(tf)} | fields id, nsName = name, nsId = id_classic, nsCluster = k8s.cluster.name], sourceField:target_id, lookupField:id, fields:{nsName, nsId, nsCluster}
    | summarize namespaces = collectDistinct(record(id = nsId, name = nsName, cluster = nsCluster)), by:{source_id}
  ], sourceField:id, lookupField:source_id, fields:{namespaces}
| lookup [smartscapeEdges "belongs_to", ${from(tf)}
    | filter source_type == "SERVICE" and target_type == "K8S_CLUSTER"
    | lookup [smartscapeNodes "K8S_CLUSTER", ${from(tf)} | fields id, clName = name, clId = id_classic], sourceField:target_id, lookupField:id, fields:{clName, clId}
    | summarize clusters = collectDistinct(record(id = clId, name = clName)), by:{source_id}
  ], sourceField:id, lookupField:source_id, fields:{clusters}
| lookup [smartscapeEdges "belongs_to", ${from(tf)}
    | filter source_type == "SERVICE" and in(target_type, {${SDV2_WORKLOAD_TYPES}})
    | summarize workloads = collectDistinct(toString(target_id)), by:{source_id}
  ], sourceField:id, lookupField:source_id, fields:{workloads}
| lookup [smartscapeEdges "runs_on", ${from(tf)}
    | filter source_type == "SERVICE" and target_type == "AWS_LAMBDA_FUNCTION"
    | summarize lambdas = countDistinct(target_id), by:{source_id}
  ], sourceField:id, lookupField:source_id, fields:{lambdas}
| lookup [smartscapeEdges "runs_on", ${from(tf)}
    | filter source_type == "SERVICE" and target_type == "PROCESS"
    | lookup [smartscapeEdges "runs_on", ${from(tf)}
        | filter source_type == "SERVICE" and target_type == "PROCESS"
        | fieldsAdd src = toString(source_id)
        | lookup [fetch dt.entity.service, ${from(tf)} | fields id, appKey = coalesce(webApplicationId, contextRoot)], sourceField:src, lookupField:id, fields:{appKey}
        | summarize servicesOnProcess = countDistinct(source_id), appsOnProcess = countDistinct(appKey), by:{target_id}
      ], sourceField:target_id, lookupField:target_id, fields:{servicesOnProcess, appsOnProcess}
    | lookup [smartscapeNodes "PROCESS", ${from(tf)}
        | fields id, hostGroup = dt.host_group.id, pgId = dt.process_group.id, pgName = dt.process_group.detected_name, containerized = process.containerized
      ], sourceField:target_id, lookupField:id, fields:{hostGroup, pgId, pgName, containerized}
    | lookup [fetch dt.entity.host_group, ${from(tf)} | fields hgId = id, hgName = entity.name], sourceField:hostGroup, lookupField:hgName, fields:{hgId}
    | summarize processes = countDistinct(target_id), servicesOnProcess = max(servicesOnProcess), appsOnProcess = max(appsOnProcess),
        hostGroups = collectDistinct(record(id = hgId, name = hostGroup)), processGroups = collectDistinct(record(id = pgId, name = pgName)), containerized = max(toLong(containerized)),
        by:{source_id}
  ], sourceField:id, lookupField:source_id, fields:{processes, servicesOnProcess, appsOnProcess, hostGroups, processGroups, containerized}
| lookup [smartscapeEdges "calls", "monitors", ${from(tf)}
    | filter target_type == "SERVICE" and (source_type == "FRONTEND" or source_type == "HTTP_MONITOR")
    | summarize frontends = countIf(source_type == "FRONTEND"), monitors = countIf(source_type == "HTTP_MONITOR"), by:{target_id}
  ], sourceField:id, lookupField:target_id, fields:{frontends, monitors}
| fields id, name, sdVersion, sdv1Type, tech, appKey, softwareTechnologies, namespaces, clusters, workloads, lambdas, processes, servicesOnProcess, appsOnProcess, hostGroups, processGroups, containerized, frontends, monitors
| sort name asc
| limit ${SDV2_SERVICE_LIMIT}`;

// --- IAM Policy Creator / IAM Boundary Creator: condition values seen in the tenant ---------------------------------
// Suggestions for condition values; every picker also takes free text. Validated with dtctl on the demo tenant,
// 2026-10-24: a field query takes < 1 s for 24h and ~7 s (1.1 GB scanned) for 30d, so each one runs only when its picker
// is opened. The `metrics` command reads at most the last 10 days (INVALID_METRICS_TIMEFRAME otherwise). Values can be
// arrays (dt.security_context), hence `expand`; `sources` says where a value was seen.
const iamMetricsFrom = (tf: Timeframe) => (tf === "30d" ? "from:now()-10d" : from(tf));
const iamValueTail = `| expand v
| summarize n = sum(n), sources = collectDistinct(src), by:{value = toString(v)}
| sort n desc
| limit 500`;

/** Values of a record-level field (security context, host group, Kubernetes, cloud accounts, …) on Smartscape nodes, logs, spans and metrics. */
export const iamFieldValuesQuery = (tf: Timeframe, field: string) => {
  const f = `\`${field}\``;
  const part = (head: string, src: string) => `${head}
    | filter isNotNull(${f})
    | summarize n = count(), by:{v = ${f}}
    | fieldsAdd src = "${src}"`;
  return `${part(`smartscapeNodes "*", ${from(tf)}`, "Smartscape").replace(/\n {4}/g, "\n")}
| append [${part(`fetch logs, ${from(tf)}, samplingRatio:${LOG_SAMPLING[tf]}, scanLimitGBytes:${SCAN_CAP_GB}`, "logs")}]
| append [${part(`fetch spans, ${from(tf)}, samplingRatio:${LOG_SAMPLING[tf]}, scanLimitGBytes:${SCAN_CAP_GB}`, "spans")}]
| append [${part(`metrics ${iamMetricsFrom(tf)}`, "metrics")}]
${iamValueTail}`;
};

/** event.kind / event.type / event.provider values on events, business events and system events. */
export const iamEventFieldValuesQuery = (tf: Timeframe, field: "event.kind" | "event.type" | "event.provider") => {
  const part = (table: string) => `fetch ${table}, ${from(tf)}, scanLimitGBytes:${SCAN_CAP_GB} | summarize n = count(), by:{v = ${field}} | fieldsAdd src = "${table}"`;
  return `${part("events")}
| append [${part("bizevents")}]
| append [${part("dt.system.events")}]
| filter isNotNull(v)
${iamValueTail}`;
};

export const iamLogSourcesQuery = (tf: Timeframe) => `fetch logs, ${from(tf)}, samplingRatio:${LOG_SAMPLING[tf]}, scanLimitGBytes:${SCAN_CAP_GB}
| filter isNotNull(log.source)
| summarize n = count(), by:{value = toString(log.source)}
| sort n desc
| limit 500`;

/** Metric keys with series in the timeframe (at most 10 days); the result is capped at 1,000 rows. */
export const iamMetricKeysQuery = (tf: Timeframe) => `metrics ${iamMetricsFrom(tf)}
| summarize n = count(), by:{value = metric.key}
| sort value asc`;

/** Grail buckets with their table; `label` is the display name. */
export const IAM_BUCKETS_QUERY = `fetch dt.system.buckets
| fields value = name, table = dt.system.table, label = display_name
| sort table asc, value asc`;

export const IAM_TABLES_QUERY = `fetch dt.system.buckets
| summarize n = count(), by:{value = dt.system.table}
| sort value asc`;

/** Built-in entity types in the upper snake case storage:entity.type expects (PROCESS_GROUP_INSTANCE); generic (custom) types are left out. */
export const IAM_ENTITY_TYPES_QUERY = `fetch dt.system.data_objects
| filter startsWith(name, "dt.entity.") and not(contains(name, ":"))
| fields value = upper(substring(name, from:10))
| sort value asc`;

export const iamProcessGroupNamesQuery = (tf: Timeframe) => `smartscapeNodes "PROCESS", ${from(tf)}
| filter isNotNull(dt.process_group.detected_name)
| summarize n = count(), by:{value = toString(dt.process_group.detected_name)}
| sort n desc
| limit 500`;

/** Classic entity IDs with their names, for conditions that take an ID (process group, host, host group). */
export const iamEntityIdsQuery = (tf: Timeframe, table: "dt.entity.process_group" | "dt.entity.host" | "dt.entity.host_group") => `fetch ${table}, ${from(tf)}
| fields value = id, label = entity.name
| sort label asc`;

export const iamActiveGateGroupsQuery = (tf: Timeframe) => `smartscapeNodes "ACTIVEGATE", ${from(tf)}
| filter isNotNull(dt.active_gate.group.name)
| summarize n = countDistinct(dt.active_gate.id), by:{value = toString(dt.active_gate.group.name)}
| sort value asc`;

// --- Permissions Test: records a user or group can read -----------------------------------------------------------
// The IAM conditions that limit a Grail table permission (and bucket access) written as a DQL filter, so the records a
// subject can read can be opened in a Notebook. It runs with the permissions of whoever opens it. matchesValue is used
// for every positive operator because it also matches any element of list-valued fields (dt.security_context on
// Smartscape nodes); it is case-insensitive, so the preview can be slightly wider than IAM. Validated with dtctl.
export type IamFilterCondition = { key: string; op: string; values: string[] };
const IAM_RECORD_SOURCES: Record<string, (tf: Timeframe) => string> = {
  logs: (tf) => `fetch logs, ${from(tf)}, samplingRatio:${LOG_SAMPLING[tf]}, scanLimitGBytes:${SCAN_CAP_GB}`,
  spans: (tf) => `fetch spans, ${from(tf)}, samplingRatio:${LOG_SAMPLING[tf]}, scanLimitGBytes:${SCAN_CAP_GB}`,
  events: (tf) => `fetch events, ${from(tf)}, scanLimitGBytes:${SCAN_CAP_GB}`,
  bizevents: (tf) => `fetch bizevents, ${from(tf)}, scanLimitGBytes:${SCAN_CAP_GB}`,
  "security.events": (tf) => `fetch security.events, ${from(tf)}, scanLimitGBytes:${SCAN_CAP_GB}`,
  system: (tf) => `fetch dt.system.events, ${from(tf)}, scanLimitGBytes:${SCAN_CAP_GB}`,
  "user.events": (tf) => `fetch user.events, ${from(tf)}, scanLimitGBytes:${SCAN_CAP_GB}`,
  "user.sessions": (tf) => `fetch user.sessions, ${from(tf)}, scanLimitGBytes:${SCAN_CAP_GB}`,
  smartscape: (tf) => `smartscapeNodes "*", ${from(tf)}`,
};
/** Tables (storage:<table>:read) the preview query supports; metrics and classic entities have no record-level fetch. */
export const iamRecordTable = (permission: string) => {
  const t = permission.replace(/^storage:/, "").replace(/:read$/, "");
  return t in IAM_RECORD_SOURCES ? t : null;
};
/** Condition attribute -> record field; null = selects the table, not records. */
const IAM_RECORD_FIELD: Record<string, string | null> = { "bucket-name": "dt.system.bucket", "table-name": null, "query-consumption": null };
const iamField = (key: string) => {
  const attr = key.slice(key.indexOf(":") + 1);
  return attr in IAM_RECORD_FIELD ? IAM_RECORD_FIELD[attr] : attr;
};

function iamConditionDql(c: IamFilterCondition): string | null {
  const field = iamField(c.key);
  if (!field) return null;
  const mv = (p: string) => `matchesValue(\`${field}\`, ${JSON.stringify(p)})`;
  const any = (ps: string[]) => (ps.length === 1 ? mv(ps[0]) : `(${ps.map(mv).join(" or ")})`);
  switch (c.op) {
    case "=":
    case "IN":
    case "MATCH":
      return any(c.values);
    case "startsWith":
      return mv(`${c.values[0] ?? ""}*`);
    case "!=":
    case "NOT IN":
      return `not ${any(c.values)}`;
    case "NOT startsWith":
      return `not ${mv(`${c.values[0] ?? ""}*`)}`;
    default:
      return null;
  }
}

/** One OR group: a record passes when every condition of one path holds. null = some path has no record condition (all pass). */
function iamPathsDql(paths: IamFilterCondition[][]): string | null {
  const parts: string[] = [];
  for (const p of paths) {
    const conds = p.map(iamConditionDql).filter((x): x is string => !!x);
    if (!conds.length) return null;
    parts.push(conds.length === 1 ? conds[0] : `(${conds.join(" and ")})`);
  }
  return parts.length ? (parts.length === 1 ? parts[0] : parts.join("\n    or ")) : null;
}

/**
 * Records of one table a subject can read: `groups` are ANDed (the table permission's grant paths, then bucket access);
 * within a group the paths are ORed. Counts by the dimensions the conditions use.
 */
export function iamVisibleRecordsQuery(tf: Timeframe, table: string, groups: IamFilterCondition[][][]): string {
  const filters = groups.map(iamPathsDql).filter((x): x is string => !!x);
  const by = [...new Set(groups.flat(2).map((c) => iamField(c.key)).filter((f): f is string => !!f))].slice(0, 3).map((f) => `\`${f}\``);
  return `${IAM_RECORD_SOURCES[table](tf)}
${filters.map((f) => `| filter ${f}\n`).join("")}| summarize records = count()${by.length ? `, by:{${by.join(", ")}}` : ""}
| sort records desc
| limit 100`;
}
