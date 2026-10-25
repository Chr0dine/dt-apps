import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { Select, TextInput, ToggleButtonGroup } from "@dynatrace/strato-components/forms";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { useCurrentTheme } from "@dynatrace/strato-components/core";
import Colors from "@dynatrace/strato-design-tokens/colors";
import Spacings from "@dynatrace/strato-design-tokens/spacings";
import Borders from "@dynatrace/strato-design-tokens/borders";
import { useDql, type DqlState } from "../useDql";
import { useAIInsights } from "../AIInsights";
import { analyzeKubernetes } from "../analyses";
import {
  K8S_LIVE_MINUTES,
  K8S_SEARCH_LIMIT,
  k8sContainerSummaryQuery,
  k8sCloudClustersQuery,
  k8sClustersQuery,
  k8sNamespaceSummaryQuery,
  k8sPodSummaryQuery,
  k8sSearchQuery,
  k8sTargetPodsQuery,
  k8sTargetProcessesQuery,
  k8sWorkloadSummaryQuery,
  type K8sSearch,
  type K8sView,
  type Timeframe,
} from "../queries";
import { entityOverviewLink } from "../links";
import { PctGauge, QueryActions, QueryState, ShowEntitiesButton, num, pct } from "../components";
import { Field, ManualActionView } from "../RemediationPanel";
import { toInstance } from "../deepMonitoring";
import { alternativeAction } from "../deepActions";
import type { ManualAction } from "../remediation";
import { ActionPicker, DocsStatusLine, SEVERITY_ORDER, STATUS_COLOR, STATUS_LABEL, type ActionDef, type Severity } from "./DeepMonitoringTab";
import { Donut, type Slice } from "./ModePie";
import {
  CLOUD_INTEGRATION,
  CLOUD_LABEL,
  DK_MODE_LABEL,
  EXCLUDED_STATUSES,
  MODES,
  NAMESPACE_EXCLUDED,
  NAMESPACE_STATUSES,
  ONEAGENT_STATUSES,
  STATUS_GROUPS,
  categoryColor,
  cloudText,
  diagnoseCluster,
  isFullStack,
  toClusters,
  containerOptOutAction,
  diagnoseTarget,
  genericOperatorActions,
  installAction,
  modeOf,
  namespaceAction,
  optInAction,
  otelCollectorAction,
  otelDoubleAction,
  podOptOutAction,
  rolloutAction,
  statusGroupOf,
  statusLabel,
  statusesInGroup,
  switchModeAction,
  targetName,
  toDynakube,
  toPod,
  troubleshootAction,
  type Category,
  type ClusterSummary,
  type Dynakube,
  type OpCheck,
  type OpDiagnosis,
  type OpFix,
  type Target,
  type Theme,
} from "../kubernetes";

const card: React.CSSProperties = {
  padding: Spacings.Size16,
  borderRadius: Borders.Radius.Container.Default,
  background: Colors.Background.Container.Neutral.Default,
};
const hint: React.CSSProperties = { fontSize: 12, opacity: 0.7 };
const KUBERNETES_ANCHOR = "remediation-kubernetes";
const CLOUD_NODE_TYPE: Record<string, string> = { EKS: "AWS_EKS_CLUSTER", AKS: "AZURE_MICROSOFT_CONTAINERSERVICE_MANAGEDCLUSTERS", GKE: "GCP_CONTAINER_GOOGLEAPIS_COM_CLUSTER" };
const DONUT_SIZE = 160;
const ANY = "__any__";

type Row = Record<string, any>;
type Level = "namespaces" | "workloads" | "pods" | "containers";
type GroupBy = "mode" | "status";
/** A donut slice the user clicked: which donut, grouped how, which category. */
type SliceSel = { level: Level; groupBy: GroupBy; id: string };

const LEVELS: { level: Level; title: string; unit: string; query: (tf: Timeframe) => string }[] = [
  { level: "namespaces", title: "Namespaces", unit: "namespaces", query: k8sNamespaceSummaryQuery },
  { level: "workloads", title: "Workloads", unit: "workloads", query: k8sWorkloadSummaryQuery },
  { level: "pods", title: "Pods", unit: "pods", query: k8sPodSummaryQuery },
  { level: "containers", title: "Containers", unit: "containers", query: k8sContainerSummaryQuery },
];

const plural = (x: number, one: string, many = `${one}s`) => `${x.toLocaleString()} ${x === 1 ? one : many}`;

/** Categories (in palette-slot order) and the category of one summary row, for one donut and grouping. */
function categoriesFor(level: Level, groupBy: GroupBy): { cats: Category[]; keyOf: (r: Row) => string } {
  if (groupBy === "mode") return { cats: MODES, keyOf: (r) => String(r.mode ?? "UNKNOWN") };
  if (level === "namespaces") return { cats: NAMESPACE_STATUSES, keyOf: (r) => String(r.status ?? "") };
  return { cats: STATUS_GROUPS, keyOf: (r) => statusGroupOf(String(r.status ?? "")).id };
}

function toSlices(records: Row[], level: Level, groupBy: GroupBy, theme: Theme): Slice[] {
  const { cats, keyOf } = categoriesFor(level, groupBy);
  const counts = new Map<string, number>();
  for (const r of records) counts.set(keyOf(r), (counts.get(keyOf(r)) ?? 0) + num(r.n));
  return cats.filter((c) => (counts.get(c.id) ?? 0) > 0).map((c) => ({ id: c.id, label: c.label, value: counts.get(c.id)!, color: categoryColor(c, theme) }));
}

// ---------------------------------------------------------------------------
// Summary: gauges and donuts
// ---------------------------------------------------------------------------
function SummaryDonut({
  level,
  title,
  unit,
  query,
  state,
  groupBy,
  theme,
  selected,
  onSelect,
}: {
  level: Level;
  title: string;
  unit: string;
  query: string;
  state: DqlState;
  groupBy: GroupBy;
  theme: Theme;
  selected: SliceSel | null;
  onSelect: (s: SliceSel | null) => void;
}) {
  const slices = useMemo(() => toSlices(state.data?.records ?? [], level, groupBy, theme), [state.data, level, groupBy, theme]);
  const selId = selected && selected.level === level && selected.groupBy === groupBy ? selected.id : null;
  return (
    <div style={{ ...card, minWidth: 0 }}>
      <Heading level={4}>
        {title} by {groupBy === "mode" ? "monitoring mode" : level === "namespaces" ? "OneAgent coverage" : "injection status"}
      </Heading>
      <QueryState state={state}>
        <div style={{ marginTop: Spacings.Size8 }}>
          {slices.length === 0 ? (
            <Text>No {unit} found in this timeframe.</Text>
          ) : (
            <Donut slices={slices} size={DONUT_SIZE} centerLabel={unit} ariaLabel={`${title} by ${groupBy === "mode" ? "monitoring mode" : "injection status"}`} selectedId={selId} onSelect={(id) => onSelect(id ? { level, groupBy, id } : null)} />
          )}
        </div>
      </QueryState>
      <div style={{ marginTop: Spacings.Size8 }}>
        <QueryActions title={`Kubernetes: ${unit} by monitoring mode and injection status`} query={query} />
      </div>
    </div>
  );
}

/** Legend text for the categories of the current grouping (what each slice means). */
function CategoryNotes({ groupBy }: { groupBy: GroupBy }) {
  const cats = groupBy === "mode" ? MODES.filter((m) => m.slot) : STATUS_GROUPS;
  return (
    <details>
      <summary style={{ cursor: "pointer", fontSize: 12, opacity: 0.8 }}>What the {groupBy === "mode" ? "monitoring modes" : "injection statuses"} mean</summary>
      <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
        {cats.map((c) => (
          <li key={c.id}>
            <Text style={hint}>
              <strong>{c.label}</strong>: {c.detail}
              {groupBy === "status" && ` (${statusesInGroup(c.id).map(statusLabel).join(", ")})`}
            </Text>
          </li>
        ))}
      </ul>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Clusters and Operator deployments: one row per DynaKube, plus every cluster without one (cloud integration only,
// host OneAgents only, Kubernetes monitoring without the Operator)
// ---------------------------------------------------------------------------
const clusterTarget = (d: Dynakube): Target => ({ kind: "cluster", clusterUid: d.clusterUid, cluster: d.cluster, namespace: "", nodeId: d.clusterId, cloud: d.cloud });

function ClustersTable({ state, query, tf, selectedKey, onSelect }: { state: DqlState; query: string; tf: Timeframe; selectedKey?: string; onSelect: (t: Target) => void }) {
  const rows = useMemo(() => (state.data?.records ?? []).map(toDynakube), [state.data]);
  const columns = useMemo<DataTableColumnDef<Dynakube>[]>(
    () => [
      {
        id: "cluster",
        header: "Cluster",
        accessor: "cluster",
        width: "1.6fr",
        cell: ({ rowData: d }) => {
          const url = d.clusterId ? entityOverviewLink("K8S_CLUSTER", d.clusterId, tf) : undefined;
          const cloudUrl = d.cloud ? entityOverviewLink(CLOUD_NODE_TYPE[d.cloud.provider] ?? "", d.cloud.id, tf) : undefined;
          return (
            <Flex flexDirection="column" gap={2}>
              {url ? (
                <a href={url} target="_blank" rel="noreferrer noopener">
                  {d.cluster} ↗
                </a>
              ) : (
                <Text>{d.cluster}</Text>
              )}
              {d.cloud && (
                <Text style={{ fontSize: 11, opacity: 0.75 }} title={cloudText(d.cloud)}>
                  {cloudUrl ? (
                    <a href={cloudUrl} target="_blank" rel="noreferrer noopener">
                      {CLOUD_LABEL[d.cloud.provider] ?? d.cloud.provider} {d.cloud.name} ↗
                    </a>
                  ) : (
                    `${CLOUD_LABEL[d.cloud.provider] ?? d.cloud.provider} ${d.cloud.name}`
                  )}
                  {d.cloud.version && ` · ${d.cloud.version}`}
                </Text>
              )}
            </Flex>
          );
        },
      },
      {
        id: "name",
        header: "DynaKube",
        accessor: "name",
        width: "1.1fr",
        cell: ({ rowData: d }) => {
          if (d.mode === "NONE") {
            const t = clusterTarget(d);
            return (
              <Flex gap={8} alignItems="center" flexWrap="wrap">
                <Text style={{ color: STATUS_COLOR.fail, fontWeight: 600 }}>None</Text>
                <DiagnoseButton selected={targetKey(t) === selectedKey} onClick={() => onSelect(t)} />
              </Flex>
            );
          }
          const url = entityOverviewLink("K8S_DYNAKUBE", d.id, tf);
          return url ? (
            <a href={url} target="_blank" rel="noreferrer noopener">
              {d.namespace}/{d.name} ↗
            </a>
          ) : (
            <>
              {d.namespace}/{d.name}
            </>
          );
        },
      },
      { id: "mode", header: "Mode", accessor: (d) => DK_MODE_LABEL[d.mode] ?? d.mode, width: "1.2fr" },
      {
        id: "phase",
        header: "Status",
        accessor: "phase",
        width: "1.6fr",
        cell: ({ rowData: d }) => {
          if (d.mode === "NONE") {
            const text = !d.clusterUid && d.cloud
              ? `${CLOUD_INTEGRATION[d.cloud.provider] ?? d.cloud.provider} integration only: no Operator, no Kubernetes monitoring`
              : d.k8sMonitoring
                ? "Kubernetes monitoring without the Operator"
                : `Host OneAgent only (${plural(d.containers, "running container")})`;
            return <Text style={hint}>{text}</Text>;
          }
          const ok = d.phase === "Running" && d.failing.length === 0;
          return (
            <Text style={{ fontSize: 12 }}>
              <span style={{ color: ok ? STATUS_COLOR.pass : STATUS_COLOR.warn, fontWeight: 700 }}>{d.phase || "Unknown"}</span>
              {d.failing.length > 0 && ` · failing: ${d.failing.join(", ")}`}
            </Text>
          );
        },
      },
      { id: "operator", header: "Operator", accessor: (d) => d.operatorVersions.join(", ") || "—", width: "0.8fr" },
      { id: "oneAgent", header: "OneAgent / code modules", accessor: (d) => [d.oneAgentVersion, d.codeModulesVersion].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" / ") || "—", width: "1.4fr" },
      { id: "ag", header: "ActiveGate", accessor: (d) => (d.activeGateVersion ? `${d.activeGateVersion} (${d.activeGateCapabilities.join(", ")})` : d.activeGateCapabilities.join(", ") || "—"), width: "1.6fr" },
      {
        id: "namespaces",
        header: "Namespaces selected",
        accessor: "selected",
        width: "1fr",
        cell: ({ rowData: d }) =>
          d.mode === "NONE" ? (
            <>—</>
          ) : (
            <span title={[d.nsMatch, d.namespaceSelector && `namespaceSelector: ${d.namespaceSelector}`].filter(Boolean).join("\n")}>
              {d.selected.toLocaleString()}
              {!d.autoInjection && " (opt-in only)"}
            </span>
          ),
      },
      { id: "features", header: "Features", accessor: (d) => d.features.join(", ") || "—", width: "2fr" },
    ],
    [tf, selectedKey, onSelect],
  );
  return (
    <div style={card}>
      <Heading level={4}>Clusters and Operator deployments</Heading>
      <Text style={{ ...hint, display: "block", marginBottom: Spacings.Size8 }}>
        One row per DynaKube (Dynatrace Operator custom resource), plus every cluster without one: Kubernetes-monitored clusters, clusters seen only by host-installed OneAgents, and managed clusters seen only through a cloud integration (Amazon EKS, Azure AKS, Google GKE). A cloud cluster is matched to the Kubernetes-monitored cluster it is through its nodes (EKS node group, AKS node resource group, GKE node names) or by name, and shown under it. Use Diagnose on a cluster without a DynaKube for the install steps; hover the namespace count for the matched namespaces.
      </Text>
      <QueryState state={state}>
        <DataTable data={rows} columns={columns} sortable fullWidth variant={{ rowDensity: "condensed" }}>
          <DataTable.EmptyState>No Kubernetes clusters, cloud clusters or DynaKubes found in this timeframe.</DataTable.EmptyState>
        </DataTable>
      </QueryState>
      <div style={{ marginTop: Spacings.Size8 }}>
        <QueryActions title="Kubernetes: clusters and DynaKube deployments" query={query} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
function StatusCell({ id }: { id: string }) {
  const theme = useCurrentTheme();
  const g = statusGroupOf(id);
  return (
    <Flex gap={6} alignItems="center">
      <span style={{ width: 9, height: 9, borderRadius: 2, background: categoryColor(g, theme), flex: "none" }} />
      <Text style={{ fontSize: 12 }}>{statusLabel(id)}</Text>
    </Flex>
  );
}

function NamespaceStatusCell({ id }: { id: string }) {
  const theme = useCurrentTheme();
  const c = NAMESPACE_STATUSES.find((x) => x.id === id);
  return (
    <Flex gap={6} alignItems="center">
      {c && <span style={{ width: 9, height: 9, borderRadius: 2, background: categoryColor(c, theme), flex: "none" }} />}
      <Text style={{ fontSize: 12 }}>{c?.label ?? id}</Text>
    </Flex>
  );
}

function DiagnoseButton({ selected, onClick }: { selected: boolean; onClick: () => void }) {
  return (
    <Button variant={selected ? "accent" : "default"} size="condensed" onClick={onClick} aria-pressed={selected}>
      {selected ? "Selected" : "Diagnose"}
    </Button>
  );
}

const targetKey = (t: Target) => [t.kind, t.clusterUid || t.cloud?.id || t.cluster, t.namespace, t.workloadKind ?? "", t.workload ?? ""].join("/");

function SearchResults({ query, view, tf, selectedKey, onSelect }: { query: string; view: K8sView; tf: Timeframe; selectedKey?: string; onSelect: (t: Target) => void }) {
  const state = useDql(query);
  const rows = useMemo<Row[]>(() => state.data?.records ?? [], [state.data]);
  const columns = useMemo<DataTableColumnDef<Row>[]>(() => {
    const toTarget = (r: Row): Target =>
      view === "workload"
        ? { kind: "workload", clusterUid: String(r.clusterUid), cluster: String(r.cluster ?? ""), namespace: String(r.namespace), workloadKind: String(r.kind), workload: String(r.workload), nodeId: r.nodeId ? String(r.nodeId) : undefined }
        : { kind: "namespace", clusterUid: String(r.clusterUid), cluster: String(r.cluster ?? ""), namespace: String(r.namespace), nodeId: r.id ? String(r.id) : undefined };
    const diagnose: DataTableColumnDef<Row> = {
      id: "diagnose",
      header: "",
      accessor: "namespace",
      width: "0.8fr",
      cell: ({ rowData }) => {
        const t = toTarget(rowData);
        return <DiagnoseButton selected={targetKey(t) === selectedKey} onClick={() => onSelect(t)} />;
      },
    };
    const link = (type: string | undefined, id: string | undefined, label: string) => {
      const url = type && id ? entityOverviewLink(type, id, tf) : undefined;
      return url ? (
        <a href={url} target="_blank" rel="noreferrer noopener">
          {label} ↗
        </a>
      ) : (
        <>{label}</>
      );
    };
    const pods: DataTableColumnDef<Row> = { id: "pods", header: "OneAgent pods", accessor: (r) => num(r.oneAgentPods), width: "0.9fr", cell: ({ rowData: r }) => <>{`${num(r.oneAgentPods)} of ${num(r.pods)}`}</> };
    const otel: DataTableColumnDef<Row> = { id: "otelPods", header: "OTel pods", accessor: (r) => num(r.otelPods), width: "0.7fr" };
    const mode: DataTableColumnDef<Row> = { id: "mode", header: "Monitoring mode", accessor: (r) => modeOf(String(r.mode)).label, width: "1.3fr" };
    if (view === "namespace") {
      return [
        { id: "namespace", header: "Namespace", accessor: "namespace", width: "1.5fr", cell: ({ rowData: r }) => link("K8S_NAMESPACE", r.id, String(r.namespace)) },
        { id: "cluster", header: "Cluster", accessor: "cluster", width: "1fr" },
        { id: "dynakube", header: "DynaKube", accessor: (r) => r.dynakube ?? "—", width: "0.9fr" },
        mode,
        { id: "status", header: "OneAgent coverage", accessor: "status", width: "1.4fr", cell: ({ rowData: r }) => <NamespaceStatusCell id={String(r.status)} /> },
        pods,
        otel,
        diagnose,
      ];
    }
    return [
      { id: "workload", header: "Workload", accessor: "workload", width: "1.8fr", cell: ({ rowData: r }) => link(r.nodeType, r.nodeId, String(r.workload)) },
      { id: "kind", header: "Kind", accessor: "kind", width: "0.8fr" },
      { id: "namespace", header: "Namespace", accessor: "namespace", width: "1.2fr" },
      { id: "cluster", header: "Cluster", accessor: "cluster", width: "0.9fr" },
      mode,
      { id: "status", header: "Injection status", accessor: (r) => statusLabel(String(r.status)), width: "1.5fr", cell: ({ rowData: r }) => <StatusCell id={String(r.status)} /> },
      pods,
      otel,
      diagnose,
    ];
  }, [view, tf, selectedKey, onSelect]);
  return (
    <QueryState state={state}>
      <Flex flexDirection="column" gap={8}>
        <DataTable data={rows} columns={columns} sortable fullWidth variant={{ rowDensity: "condensed" }}>
          <DataTable.EmptyState>
            No {view === "workload" ? "workloads" : "namespaces"} match these filters.
            {view === "workload" && " Containers seen only by a host-installed OneAgent have no pod or workload in Smartscape: find their cluster under Operator deployments."}
          </DataTable.EmptyState>
        </DataTable>
        {rows.length >= K8S_SEARCH_LIMIT && <Text>Showing the first {K8S_SEARCH_LIMIT}.</Text>}
        <QueryActions title={`Kubernetes: ${view === "workload" ? "workload" : "namespace"} search`} query={query} />
      </Flex>
    </QueryState>
  );
}

type Filters = { view: K8sView; cluster: string; namespace: string; name: string; mode: string; status: string };
const EMPTY_FILTERS: Filters = { view: "workload", cluster: ANY, namespace: "", name: "", mode: ANY, status: ANY };

/** Status filter value -> statuses: workloads filter by donut group, namespaces by their coverage status. */
function toSearch(f: Filters): K8sSearch {
  const statuses = f.status === ANY ? [] : f.view === "namespace" ? [f.status] : statusesInGroup(f.status);
  return { view: f.view, cluster: f.cluster === ANY ? "" : f.cluster, namespace: f.namespace.trim(), name: f.name.trim(), mode: f.mode === ANY ? "" : f.mode, statuses };
}

function K8sSearchPanel({
  tf,
  clusters,
  filters,
  setFilters,
  query,
  setQuery,
  selectedKey,
  onSelect,
}: {
  tf: Timeframe;
  clusters: { uid: string; name: string }[];
  filters: Filters;
  setFilters: (f: Filters) => void;
  query: string | null;
  setQuery: (q: string | null) => void;
  selectedKey?: string;
  onSelect: (t: Target) => void;
}) {
  const set = (patch: Partial<Filters>) => {
    setFilters({ ...filters, ...patch });
    setQuery(null);
  };
  const statusOptions = filters.view === "namespace" ? NAMESPACE_STATUSES : STATUS_GROUPS;
  return (
    <Flex flexDirection="column" gap={16}>
      <div style={card}>
        <Flex justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={8}>
          <Heading level={4}>Find {filters.view === "workload" ? "workloads" : "namespaces"}</Heading>
          <ToggleButtonGroup value={filters.view} onChange={(v: string) => v && set({ view: v as K8sView, status: ANY, name: "" })} name="operator-view">
            <ToggleButtonGroup.Item value="workload">Workloads</ToggleButtonGroup.Item>
            <ToggleButtonGroup.Item value="namespace">Namespaces</ToggleButtonGroup.Item>
          </ToggleButtonGroup>
        </Flex>
        <Flex gap={16} alignItems="flex-end" flexWrap="wrap" style={{ marginTop: Spacings.Size8 }}>
          <Field label="Cluster">
            <Select value={filters.cluster} onChange={(v: string | null) => v && set({ cluster: v })}>
              <Select.Content>
                <Select.Option value={ANY}>Any cluster</Select.Option>
                {clusters.map((c) => (
                  <Select.Option key={c.uid} value={c.uid}>
                    {c.name}
                  </Select.Option>
                ))}
              </Select.Content>
            </Select>
          </Field>
          <Field label="Namespace contains">
            <TextInput value={filters.namespace} placeholder="e.g. checkout" onChange={(v: string) => set({ namespace: v })} />
          </Field>
          {filters.view === "workload" && (
            <Field label="Workload contains">
              <TextInput value={filters.name} placeholder="e.g. cart" onChange={(v: string) => set({ name: v })} />
            </Field>
          )}
          <Field label="Monitoring mode">
            <Select value={filters.mode} onChange={(v: string | null) => v && set({ mode: v })}>
              <Select.Content>
                <Select.Option value={ANY}>Any mode</Select.Option>
                {MODES.filter((m) => filters.view === "workload" || m.id !== "MIXED").map((m) => (
                  <Select.Option key={m.id} value={m.id}>
                    {m.label}
                  </Select.Option>
                ))}
              </Select.Content>
            </Select>
          </Field>
          <Field label={filters.view === "workload" ? "Injection status (any pod)" : "OneAgent coverage"}>
            <Select value={filters.status} onChange={(v: string | null) => v && set({ status: v })}>
              <Select.Content>
                <Select.Option value={ANY}>Any status</Select.Option>
                {statusOptions.map((s) => (
                  <Select.Option key={s.id} value={s.id}>
                    {s.label}
                  </Select.Option>
                ))}
              </Select.Content>
            </Select>
          </Field>
          <ShowEntitiesButton onClick={() => setQuery(k8sSearchQuery(tf, toSearch(filters)))}>{filters.view === "workload" ? "Search workloads" : "Search namespaces"}</ShowEntitiesButton>
        </Flex>
        <Text style={{ ...hint, display: "block", marginTop: Spacings.Size8 }}>
          Click a donut slice to list what is in it. Use Diagnose on a result for the checks and fixes below: why it is or isn&apos;t full-stack monitored.
        </Text>
      </div>
      {query && <SearchResults key={query} query={query} view={filters.view} tf={tf} selectedKey={selectedKey} onSelect={onSelect} />}
    </Flex>
  );
}

// ---------------------------------------------------------------------------
// Remediation: diagnosis of the selected workload / namespace, documented fixes
// ---------------------------------------------------------------------------
const STATUS_ORDER = ["fail", "warn", "pass", "info"] as const;

function CheckList({ checks }: { checks: OpCheck[] }) {
  const sorted = useMemo(() => checks.slice().sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)), [checks]);
  return (
    <Flex flexDirection="column" gap={6}>
      {sorted.map((c) => (
        <Flex key={c.id} gap={12} alignItems="baseline" style={{ padding: "6px 12px", borderLeft: `4px solid ${STATUS_COLOR[c.status]}`, borderRadius: 4, background: "rgba(128,128,128,0.05)" }}>
          <Text style={{ fontWeight: 700, minWidth: 64, color: c.status === "info" ? undefined : STATUS_COLOR[c.status] }}>{STATUS_LABEL[c.status]}</Text>
          <div style={{ flex: 1 }}>
            <Text style={{ fontWeight: 600, display: "block" }}>{c.title}</Text>
            <Text style={hint}>{c.detail}</Text>
          </div>
        </Flex>
      ))}
    </Flex>
  );
}

const manual = (a: ManualAction, severity?: Severity): ActionDef => ({ id: a.id, label: a.title, kind: "manual", node: <ManualActionView action={a} />, docs: a.docs, severity });

/** Fixes in the order of the failing checks, rated by the most severe check each addresses, then the remaining generic steps. */
function buildActions(d: OpDiagnosis): ActionDef[] {
  const dk = d.dynakubes.find((k) => d.pods.some((p) => p.nsDk === k.name)) ?? d.dynakubes[0];
  const containers = [...new Set(d.pods.flatMap((p) => p.excludedContainers))];
  const byFix: Partial<Record<OpFix, ManualAction[]>> = {
    install: [installAction(d.target)],
    mode: [switchModeAction(dk)],
    health: [troubleshootAction(dk)],
    failed: [troubleshootAction(dk)],
    namespace: [namespaceAction(d.target, dk)],
    "pod-optout": [podOptOutAction(d.target)],
    "container-optout": [containerOptOutAction(containers, d.target, dk)],
    "opt-in": [optInAction(d.target, dk)],
    rollout: [rolloutAction(d.target)],
    "otel-double": [otelDoubleAction(d.target)],
    "otel-collector": [otelCollectorAction(dk)],
    "unsupported-tech": d.unsupported.map((u) => ({ ...alternativeAction(u.info), id: `alt-${u.info.key}` })),
  };
  const rated = new Map<string, ActionDef>();
  for (const c of d.checks) {
    if (c.status === "pass" || !c.fix) continue;
    const severity: Severity = c.status === "fail" ? "fail" : c.status === "warn" ? "warn" : "info";
    for (const a of byFix[c.fix] ?? []) {
      const prev = rated.get(a.id);
      if (!prev || SEVERITY_ORDER.indexOf(severity) < SEVERITY_ORDER.indexOf(prev.severity ?? "other")) rated.set(a.id, manual(a, severity));
    }
  }
  const rest = genericOperatorActions()
    .filter((a) => !rated.has(a.id) && (a.id !== "install" || d.dynakubes.length === 0))
    .map((a) => manual(a, "other"));
  return [...rated.values()].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity ?? "other") - SEVERITY_ORDER.indexOf(b.severity ?? "other")).concat(rest);
}

function PodList({ d }: { d: OpDiagnosis }) {
  if (d.pods.length === 0) return null;
  return (
    <details>
      <summary style={{ cursor: "pointer", fontSize: 12, opacity: 0.8 }}>
        Pods ({d.pods.length}{d.pods.length >= 200 ? ", first 200" : ""}) and processes ({d.processes.length})
      </summary>
      <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
        {d.pods.map((p) => (
          <li key={p.id}>
            <Text style={{ fontSize: 12 }}>
              <strong>{p.name}</strong>
              {p.workload && d.target.kind === "namespace" ? ` (${p.workload})` : ""}: {statusLabel(p.status)}
              {p.reason ? ` · reason ${p.reason}` : ""}
              {p.optOutKeys.length ? ` · ${p.optOutKeys.map((k) => `${k}: "false"`).join(", ")}` : ""}
              {p.excludedContainers.length ? ` · excludes ${p.excludedContainers.join(", ")}` : ""}
              {[p.otelDynatrace && "OTLP auto-config", p.otelOperator && "OTel Operator", p.otelSdk && !p.otelDynatrace && "OTLP exporter"].filter(Boolean).length
                ? ` · OpenTelemetry: ${[p.otelDynatrace && "OTLP auto-config", p.otelOperator && "OTel Operator", p.otelSdk && !p.otelDynatrace && "OTLP exporter"].filter(Boolean).join(", ")}`
                : ""}
            </Text>
          </li>
        ))}
      </ul>
      {d.processes.length > 0 && (
        <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
          {d.processes.map((i) => (
            <li key={i.id}>
              <Text style={{ fontSize: 12 }}>
                {i.name}: {i.processType ?? "unclassified"} · <span style={{ color: i.deep ? STATUS_COLOR.pass : STATUS_COLOR.warn, fontWeight: 600 }}>{i.deep ? "code module" : "no code module"}</span>
                {i.evidence.length ? ` (${i.evidence.join("; ")})` : ""}
              </Text>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

/** Pod UIDs used for the process lookup. */
const MAX_PROCESS_PODS = 100;

function TargetDiagnosis({ tf, target, dynakubes, onSummary }: { tf: Timeframe; target: Target; dynakubes: Dynakube[]; onSummary: (s: { name: string; failing: string[] } | null) => void }) {
  const podsQuery = useMemo(() => k8sTargetPodsQuery(tf, { ...target, kind: target.kind === "workload" ? "workload" : "namespace" }), [tf, target]);
  const podState = useDql(podsQuery);
  const pods = useMemo(() => (podState.data?.records ?? []).map(toPod), [podState.data]);
  const uids = useMemo(() => pods.map((p) => p.uid).filter(Boolean).slice(0, MAX_PROCESS_PODS), [pods]);
  const procQuery = useMemo(() => (uids.length ? k8sTargetProcessesQuery(tf, uids) : null), [tf, uids]);
  const procState = useDql(procQuery);
  const processes = useMemo(() => (procState.data?.records ?? []).map(toInstance), [procState.data]);
  const clusterDks = useMemo(() => dynakubes.filter((d) => d.clusterUid === target.clusterUid), [dynakubes, target.clusterUid]);
  const ready = podState.data && (!procQuery || procState.data || procState.error);
  const diagnosis = useMemo(() => (ready ? diagnoseTarget(target, clusterDks, pods, processes) : null), [ready, target, clusterDks, pods, processes]);
  const actions = useMemo(() => (diagnosis ? buildActions(diagnosis) : []), [diagnosis]);

  useEffect(() => {
    onSummary(diagnosis ? { name: targetName(target), failing: diagnosis.checks.filter((c) => c.status === "fail").map((c) => c.title) } : null);
  }, [diagnosis, target, onSummary]);

  const url = target.nodeId ? entityOverviewLink(target.kind === "namespace" ? "K8S_NAMESPACE" : `K8S_${(target.workloadKind ?? "").toUpperCase()}`, target.nodeId, tf) : undefined;
  return (
    <QueryState state={podState}>
      {!diagnosis ? (
        <Text>Reading the pods and processes…</Text>
      ) : (
        <Flex flexDirection="column" gap={12}>
          <Text style={{ opacity: 0.8 }}>
            <strong>{targetName(target)}</strong> · {modeOf(pods[0]?.mode ?? "UNKNOWN").label} · {diagnosis.pods.filter((p) => ONEAGENT_STATUSES.includes(p.status)).length} of {plural(diagnosis.pods.length, "pod")} with OneAgent
            {url && (
              <>
                {" · "}
                <a href={url} target="_blank" rel="noreferrer noopener">
                  Open in Kubernetes ↗
                </a>
              </>
            )}
          </Text>
          {procState.error && <Text style={{ color: STATUS_COLOR.fail }}>Could not read the processes ({procState.error}); the technology check is incomplete.</Text>}
          <CheckList checks={diagnosis.checks} />
          <PodList d={diagnosis} />
          <ActionPicker key={targetKey(target)} actions={actions} />
          <QueryActions title={`Kubernetes: pods of ${targetName(target)}`} query={podsQuery} />
          {procQuery && <QueryActions title={`Kubernetes: processes of ${targetName(target)}`} query={procQuery} />}
        </Flex>
      )}
    </QueryState>
  );
}

/** Clusters without a DynaKube: checks from the cluster row (there are no pods to read) and the install steps. */
function ClusterDiagnosis({ tf, target, clusters, onSummary }: { tf: Timeframe; target: Target; clusters: ClusterSummary[]; onSummary: (s: { name: string; failing: string[] } | null) => void }) {
  const cluster = clusters.find((c) => c.key === (target.clusterUid || target.cloud?.id || target.cluster));
  const diagnosis = useMemo(() => (cluster ? diagnoseCluster(target, cluster) : null), [target, cluster]);
  const actions = useMemo(() => (diagnosis ? buildActions(diagnosis) : []), [diagnosis]);
  useEffect(() => {
    onSummary(diagnosis ? { name: targetName(target), failing: diagnosis.checks.filter((c) => c.status === "fail").map((c) => c.title) } : null);
  }, [diagnosis, target, onSummary]);
  if (!diagnosis) return <Text>The selected cluster is no longer in the clusters table for this timeframe.</Text>;
  return (
    <Flex flexDirection="column" gap={12}>
      <Text style={{ opacity: 0.8 }}>
        <strong>{targetName(target)}</strong>
        {target.cloud ? ` · ${cloudText(target.cloud)}` : ""}
      </Text>
      <CheckList checks={diagnosis.checks} />
      <ActionPicker key={targetKey(target)} actions={actions} />
      {target.cloud && <QueryActions title="Kubernetes: cloud clusters and their Kubernetes match" query={k8sCloudClustersQuery(tf)} />}
    </Flex>
  );
}

function K8sRemediation({
  tf,
  selection,
  dynakubes,
  clusters,
  onSummary,
  onClear,
}: {
  tf: Timeframe;
  selection: Target | null;
  dynakubes: Dynakube[];
  clusters: ClusterSummary[];
  onSummary: (s: { name: string; failing: string[] } | null) => void;
  onClear: () => void;
}) {
  const generic = useMemo(() => genericOperatorActions().map((a) => manual(a)), []);
  return (
    <div id={KUBERNETES_ANCHOR} style={{ ...card, marginTop: Spacings.Size16 }}>
      <Flex justifyContent="space-between" alignItems="flex-end" flexWrap="wrap" gap={12}>
        <div>
          <Heading level={3} style={{ margin: 0 }}>
            Remediation actions
          </Heading>
          <Text style={{ opacity: 0.8 }}>
            {selection
              ? selection.kind === "cluster"
                ? "Why the selected cluster is not monitored by the Dynatrace Operator, and the steps to install it."
                : `Why the selected ${selection.kind} is or isn't full-stack monitored, and the manual steps to change it.`
              : "Manual steps to change the monitoring mode or lift an injection block. Use Diagnose on a cluster without a DynaKube, or on a workload or namespace above, for checks specific to it: missing Operator (including cloud clusters seen only through a cloud integration), unsupported technology, namespace, pod or container blocks, OpenTelemetry and rollouts."}
          </Text>
          <DocsStatusLine />
        </div>
        {selection && (
          <Button variant="default" size="condensed" onClick={onClear}>
            Clear selection
          </Button>
        )}
      </Flex>
      <div style={{ marginTop: Spacings.Size12 }}>
        {!selection ? (
          <ActionPicker actions={generic} />
        ) : selection.kind === "cluster" ? (
          <ClusterDiagnosis key={targetKey(selection)} tf={tf} target={selection} clusters={clusters} onSummary={onSummary} />
        ) : (
          <TargetDiagnosis key={targetKey(selection)} tf={tf} target={selection} dynakubes={dynakubes} onSummary={onSummary} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab
// ---------------------------------------------------------------------------
export function KubernetesTab({ tf }: { tf: Timeframe }) {
  const theme = useCurrentTheme();
  const deploymentsQuery = k8sClustersQuery(tf);
  const deployments = useDql(deploymentsQuery);
  const queries = useMemo(() => LEVELS.map((l) => l.query(tf)), [tf]);
  const namespaces = useDql(queries[0]);
  const workloads = useDql(queries[1]);
  const pods = useDql(queries[2]);
  const containers = useDql(queries[3]);
  const states = [namespaces, workloads, pods, containers];

  const [groupBy, setGroupBy] = useState<GroupBy>("mode");
  const [slice, setSlice] = useState<SliceSel | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [query, setQuery] = useState<string | null>(null);
  const [selection, setSelection] = useState<Target | null>(null);
  const [summary, setSummary] = useState<{ name: string; failing: string[] } | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  const dynakubes = useMemo(() => (deployments.data?.records ?? []).map(toDynakube), [deployments.data]);
  const clusters = useMemo(() => toClusters(dynakubes), [dynakubes]);
  // The workload search only covers clusters with Kubernetes monitoring (cloud-only and host-OneAgent-only clusters have no pods).
  const searchClusters = useMemo(() => clusters.filter((c) => c.uid && c.k8sMonitoring).map((c) => ({ uid: c.uid, name: c.name })), [clusters]);

  const podCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of pods.data?.records ?? []) out[String(r.status)] = (out[String(r.status)] ?? 0) + num(r.n);
    return out;
  }, [pods.data]);
  const nsCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of namespaces.data?.records ?? []) out[String(r.status)] = (out[String(r.status)] ?? 0) + num(r.n);
    return out;
  }, [namespaces.data]);
  const podTotal = Object.values(podCounts).reduce((a, b) => a + b, 0);
  const podEligible = podTotal - EXCLUDED_STATUSES.reduce((s, k) => s + (podCounts[k] ?? 0), 0);
  const podOneAgent = ONEAGENT_STATUSES.reduce((s, k) => s + (podCounts[k] ?? 0), 0);
  const nsEligible = Object.entries(nsCounts).filter(([k]) => !NAMESPACE_EXCLUDED.includes(k)).reduce((s, [, v]) => s + v, 0);
  const realDks = useMemo(() => dynakubes.filter((d) => d.mode !== "NONE"), [dynakubes]);
  const running = realDks.filter((d) => d.phase === "Running" && d.failing.length === 0).length;
  const clustersWithDk = clusters.filter((c) => c.modes.length > 0).length;
  const fullStackClusters = clusters.filter((c) => isFullStack(c.modes)).length;
  const cloudClusters = clusters.filter((c) => c.cloud);
  const cloudWithDk = cloudClusters.filter((c) => c.modes.length > 0).length;

  const { panel: aiPanel } = useAIInsights(
    useCallback(
      () =>
        analyzeKubernetes({
          clusters: clusters.map((c) => ({ name: c.name, modes: c.modes, k8sMonitoring: c.k8sMonitoring, containers: c.containers, cloud: c.cloud ? `${CLOUD_LABEL[c.cloud.provider] ?? c.cloud.provider} ${c.cloud.name}` : undefined, cloudOnly: c.cloudOnly })),
          dynakubes: realDks.map((d) => ({ name: d.name, cluster: d.cluster, mode: d.mode, phase: d.phase, failing: d.failing, operatorVersions: d.operatorVersions })),
          podStatuses: podCounts,
          namespaces: { eligible: nsEligible, all: nsCounts.ALL ?? 0, partial: nsCounts.PARTIAL ?? 0 },
          selection: summary,
        }),
      [clusters, realDks, podCounts, nsEligible, nsCounts, summary],
    ),
  );

  /** A donut click lists the slice's namespaces / workloads in the search below. */
  const pickSlice = useCallback(
    (s: SliceSel | null) => {
      setSlice(s);
      if (!s) {
        setQuery(null);
        return;
      }
      const view: K8sView = s.level === "namespaces" ? "namespace" : "workload";
      const next: Filters = { ...EMPTY_FILTERS, view, mode: s.groupBy === "mode" ? s.id : ANY, status: s.groupBy === "status" ? s.id : ANY };
      setFilters(next);
      setQuery(k8sSearchQuery(tf, toSearch(next)));
      setTimeout(() => searchRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    },
    [tf],
  );
  const select = useCallback((t: Target) => {
    setSelection(t);
    setTimeout(() => document.getElementById(KUBERNETES_ANCHOR)?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  }, []);
  const clear = useCallback(() => {
    setSelection(null);
    setSummary(null);
  }, []);
  // A new timeframe invalidates listed results (they were queried for the old window).
  useEffect(() => {
    setQuery(null);
    setSlice(null);
  }, [tf]);

  return (
    <Flex flexDirection="column" gap={16}>
      {aiPanel}
      <Heading level={3}>Kubernetes</Heading>
      <Text>
        Dynatrace Operator deployments (DynaKubes) per Kubernetes cluster, managed clusters from cloud integrations (EKS, AKS, GKE) that have no Operator, and how namespaces, workloads, pods and containers are monitored: the monitoring mode of the DynaKube that selects their namespace, and whether OneAgent (or OpenTelemetry) was actually injected. Read from Smartscape: namespace selection labels, the webhook&apos;s pod annotations and the pod spec.
      </Text>
      <QueryState state={deployments}>
        <div style={card}>
          <Flex gap={16} flexWrap="wrap" justifyContent="space-around">
            <PctGauge pct={pct(clustersWithDk, clusters.length)} caption="Clusters with a DynaKube" detail={`${clustersWithDk} of ${clusters.length}`} />
            <PctGauge pct={pct(fullStackClusters, clusters.length)} caption="Clusters in full-stack mode" detail={`${fullStackClusters} of ${clusters.length}`} />
            {cloudClusters.length > 0 && (
              <PctGauge pct={pct(cloudWithDk, cloudClusters.length)} caption="Cloud clusters with the Operator" detail={`${cloudWithDk} of ${cloudClusters.length} EKS / AKS / GKE`} />
            )}
            <PctGauge pct={pct(running, realDks.length)} caption="DynaKubes healthy" detail={`${running} of ${realDks.length} running, no failing condition`} />
            <PctGauge pct={pct(podOneAgent, podEligible)} caption="Pods with OneAgent" detail={`${podOneAgent.toLocaleString()} of ${podEligible.toLocaleString()} application pods`} />
            <PctGauge pct={pct(nsCounts.ALL ?? 0, nsEligible)} caption="Namespaces fully injected" detail={`${(nsCounts.ALL ?? 0).toLocaleString()} of ${nsEligible.toLocaleString()} with pods`} />
          </Flex>
          <details style={{ marginTop: Spacings.Size8 }}>
            <summary style={{ cursor: "pointer", fontSize: 12, opacity: 0.8 }}>DQL behind these gauges</summary>
            <Flex flexDirection="column" gap={8} style={{ marginTop: Spacings.Size8 }}>
              <Text style={hint}>Clusters (Kubernetes and cloud integrations) and DynaKubes</Text>
              <QueryActions title="Kubernetes: clusters and DynaKube deployments" query={deploymentsQuery} />
              <Text style={hint}>Pods</Text>
              <QueryActions title="Kubernetes: pods by monitoring mode and injection status" query={queries[2]} />
              <Text style={hint}>Namespaces</Text>
              <QueryActions title="Kubernetes: namespaces by monitoring mode and injection status" query={queries[0]} />
            </Flex>
          </details>
        </div>
      </QueryState>
      <Flex justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={8}>
        <Text style={hint}>
          Click a slice to list its {slice?.level === "namespaces" ? "namespaces" : "workloads"} under “Find”; click it again to clear. Pods, workloads and containers are counted as running now (seen in the last {K8S_LIVE_MINUTES} minutes); namespaces and DynaKubes over the selected timeframe. System namespaces and Dynatrace&apos;s own pods are left out of the gauges; the cluster gauges count every cluster in the table, including cloud clusters without an Operator.
        </Text>
        <ToggleButtonGroup value={groupBy} onChange={(v: string) => v && setGroupBy(v as GroupBy)} name="operator-group-by" aria-label="Group donuts by">
          <ToggleButtonGroup.Item value="mode">Monitoring mode</ToggleButtonGroup.Item>
          <ToggleButtonGroup.Item value="status">Injection status</ToggleButtonGroup.Item>
        </ToggleButtonGroup>
      </Flex>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 16 }}>
        {LEVELS.map((l, i) => (
          <SummaryDonut key={l.level} level={l.level} title={l.title} unit={l.unit} query={queries[i]} state={states[i]} groupBy={groupBy} theme={theme} selected={slice} onSelect={pickSlice} />
        ))}
      </div>
      <CategoryNotes groupBy={groupBy} />
      <ClustersTable state={deployments} query={deploymentsQuery} tf={tf} selectedKey={selection ? targetKey(selection) : undefined} onSelect={select} />
      <div ref={searchRef}>
        <K8sSearchPanel
          tf={tf}
          clusters={searchClusters}
          filters={filters}
          setFilters={setFilters}
          query={query}
          setQuery={setQuery}
          selectedKey={selection ? targetKey(selection) : undefined}
          onSelect={select}
        />
      </div>
      <K8sRemediation tf={tf} selection={selection} dynakubes={dynakubes} clusters={clusters} onSummary={setSummary} onClear={clear} />
    </Flex>
  );
}
