import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { Checkbox, NumberInputV2, PasswordInput, Select, TextInput } from "@dynatrace/strato-components/forms";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { useCurrentTheme } from "@dynatrace/strato-components/core";
import Colors from "@dynatrace/strato-design-tokens/colors";
import Spacings from "@dynatrace/strato-design-tokens/spacings";
import Borders from "@dynatrace/strato-design-tokens/borders";
import { useDql } from "../useDql";
import { useAIInsights } from "../AIInsights";
import { analyzeDatabases, type DatabaseSelection } from "../analyses";
import { dbAgGroupsQuery, dbExtensionStatusQuery, dbInstancesQuery, dbProcessesQuery, dbSummaryQuery, refreshMarker, type Timeframe } from "../queries";
import { PctGauge, QueryActions, QueryState, pct, statusColor } from "../components";
import { Field, ManualActionView } from "../RemediationPanel";
import type { ManualAction } from "../remediation";
import { categoryColor, type Theme } from "../kubernetes";
import { DOC } from "../deepTech";
import { credentialVaultLink, databasesAppLink, dbInstanceLink, entityOverviewLink, extensionAppLink, hubSearchLink } from "../links";
import { useTip } from "./AgCharts";
import { ActionPicker, ApiFix, DocsStatusLine, STATUS_COLOR, STATUS_LABEL, type ActionDef, type Severity } from "./DeepMonitoringTab";
import {
  CATEGORIES,
  COVERAGE_LABEL,
  agGroupAction,
  buildMonitoringConfig,
  categoryOf,
  configureAction,
  createMonitoringConfig,
  credentialAction,
  dbTechInfo,
  diagnoseDbProcess,
  endpointOptions,
  endpointPort,
  extError,
  genericDbActions,
  kubernetesDbAction,
  readConfigSchema,
  readExtensionCredentials,
  readExtensionEnv,
  readMonitoringConfigs,
  shapeFromSchema,
  toAgGroup,
  toDbInstance,
  toDbProcess,
  toExtStatus,
  toTechCounts,
  userAction,
  type AgGroup,
  type Category,
  type ConfigInput,
  type ConfigShape,
  type DbCheck,
  type DbInstance,
  type DbProcess,
  type DbTechInfo,
  type ExistingConfig,
  type ExtEnv,
  type ExtStatus,
  type Loaded,
  type TechCounts,
  type VaultCredential,
} from "../databases";

// ---------------------------------------------------------------------------
// Databases tab: databases monitored by a database extension vs only by OneAgent (server process, no database insights),
// per technology, and the steps (or the API call) to configure the extension for a selected OneAgent-only database.
// ---------------------------------------------------------------------------

const card: React.CSSProperties = { padding: Spacings.Size16, borderRadius: Borders.Radius.Container.Default, background: Colors.Background.Container.Neutral.Default };
const hint: React.CSSProperties = { fontSize: 12, opacity: 0.7 };
// The default link blue is unreadable in dark mode (same as the ActiveGates tab).
const linkStyle: React.CSSProperties = { color: "inherit", textDecoration: "underline", textUnderlineOffset: 2 };
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const DB_ANCHOR = "remediation-databases";
const PAGE_SIZE = 25;
const ANY = "__any__";
const scrollTo = (id: string) => setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
function useDatabasesData(tf: Timeframe) {
  // Re-check appends a DQL comment so the queries run again after a configuration was added.
  const [tick, setTick] = useState(0);
  const queries = useMemo(
    () => ({ summary: dbSummaryQuery(tf), processes: dbProcessesQuery(tf), instances: dbInstancesQuery(tf), status: dbExtensionStatusQuery(tf), groups: dbAgGroupsQuery(tf) }),
    [tf],
  );
  const m = refreshMarker(tick);
  const summary = useDql(queries.summary + m);
  const processes = useDql(queries.processes + m);
  const instances = useDql(queries.instances + m);
  const status = useDql(queries.status + m);
  const groupsState = useDql(queries.groups);
  const techs = useMemo(() => toTechCounts(summary.data?.records ?? []), [summary.data]);
  const procs = useMemo(() => (processes.data?.records ?? []).map(toDbProcess), [processes.data]);
  const insts = useMemo(() => (instances.data?.records ?? []).map(toDbInstance), [instances.data]);
  const extStatus = useMemo(() => new Map<string, ExtStatus>((status.data?.records ?? []).map(toExtStatus).map((s) => [s.extension, s])), [status.data]);
  const groups = useMemo<AgGroup[]>(() => (groupsState.data?.records ?? []).map(toAgGroup), [groupsState.data]);

  // Is each technology's extension in the environment? One API call per extension, keyed on the extension names.
  const extNames = useMemo(() => [...new Set(techs.map((t) => dbTechInfo(t.tech).extension).filter(Boolean))].sort().join(","), [techs]);
  const [envs, setEnvs] = useState<Map<string, Loaded<ExtEnv>>>(new Map());
  useEffect(() => {
    if (!extNames) return;
    let cancelled = false;
    const names = extNames.split(",");
    setEnvs(new Map(names.map((n) => [n, { status: "loading" }])));
    void Promise.all(
      names.map((n) =>
        readExtensionEnv(n).then(
          (value): [string, Loaded<ExtEnv>] => [n, { status: "ok", value }],
          (e): [string, Loaded<ExtEnv>] => [n, { status: "error", message: extError(e, "extensions:definitions:read") }],
        ),
      ),
    ).then((pairs) => !cancelled && setEnvs(new Map(pairs)));
    return () => {
      cancelled = true;
    };
  }, [extNames, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { queries, states: { summary, processes, instances, status, groups: groupsState }, techs, procs, insts, extStatus, groups, envs, reload };
}
type DbData = ReturnType<typeof useDatabasesData>;

/** Chart / table filter: one technology and category (a clicked bar segment). */
type Slice = { tech: string; category: Category };
const processInSlice = (p: DbProcess, s: Slice | null) => !s || (p.tech === s.tech && (s.category === "ONEAGENT_ONLY" ? p.coverage === "ONEAGENT_ONLY" : s.category === "BOTH" && p.coverage !== "ONEAGENT_ONLY"));
const instanceInSlice = (i: DbInstance, s: Slice | null) => !s || (i.tech === s.tech && i.category === s.category);

// ---------------------------------------------------------------------------
// Summary: gauges + databases per technology (custom stacked bars)
// ---------------------------------------------------------------------------
function TechStackChart({ rows, theme, slice, onSlice }: { rows: TechCounts[]; theme: Theme; slice: Slice | null; onSlice: (s: Slice | null) => void }) {
  const { ref, show, hide, node } = useTip();
  const max = Math.max(1, ...rows.map((r) => r.total));
  const totals = CATEGORIES.map((c) => ({ c, n: rows.reduce((s, r) => s + r.counts[c.id], 0) }));
  if (rows.length === 0) return <Text>No databases found for this timeframe.</Text>;
  return (
    <div ref={ref} style={{ position: "relative" }} onMouseLeave={hide}>
      <Flex gap={16} flexWrap="wrap" style={{ marginBottom: Spacings.Size8 }} role="list" aria-label="Legend">
        {totals.map(({ c, n }) => (
          <Flex key={c.id} gap={6} alignItems="center" role="listitem" title={c.detail}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: categoryColor(c, theme), flex: "none" }} />
            <Text style={{ fontSize: 12 }}>
              {c.label} <strong>{n.toLocaleString()}</strong>
            </Text>
          </Flex>
        ))}
      </Flex>
      <Flex flexDirection="column" gap={8}>
        {rows.map((r) => (
          <Flex key={r.tech} alignItems="center" gap={8}>
            <Text style={{ fontSize: 12, width: 150, flex: "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={r.label}>
              {r.label}
            </Text>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 2, height: 16, width: `${Math.max(4, (100 * r.total) / max)}%`, borderRadius: 4, overflow: "hidden" }}>
                {CATEGORIES.filter((c) => r.counts[c.id] > 0).map((c) => {
                  const n = r.counts[c.id];
                  const selected = slice?.tech === r.tech && slice.category === c.id;
                  const dim = slice && !selected;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={selected}
                      aria-label={`${r.label}, ${c.label}: ${n} of ${r.total}`}
                      onMouseMove={(e) =>
                        show(
                          e,
                          <>
                            <strong>{r.label}</strong>
                            <br />
                            {c.label}: {n.toLocaleString()} of {r.total.toLocaleString()} ({pct(n, r.total)}%)
                            <br />
                            <span style={{ opacity: 0.8 }}>{selected ? "Click to show all" : "Click to filter the tables below"}</span>
                          </>,
                        )
                      }
                      onClick={() => onSlice(selected ? null : { tech: r.tech, category: c.id })}
                      style={{ flex: `${n} 0 0`, minWidth: 6, border: "none", padding: 0, cursor: "pointer", background: categoryColor(c, theme), opacity: dim ? 0.4 : 1 }}
                    />
                  );
                })}
              </div>
            </div>
            <Text style={{ fontSize: 12, fontWeight: 700, width: 40, flex: "none", textAlign: "right" }}>{r.total.toLocaleString()}</Text>
          </Flex>
        ))}
      </Flex>
      {node}
    </div>
  );
}

function SummaryCard({ data, theme, slice, onSlice }: { data: DbData; theme: Theme; slice: Slice | null; onSlice: (s: Slice | null) => void }) {
  const { techs, procs, queries, states } = data;
  const sum = (c: Category) => techs.reduce((s, t) => s + t.counts[c], 0);
  const total = techs.reduce((s, t) => s + t.total, 0);
  const extension = sum("BOTH") + sum("EXTENSION_ONLY");
  const withExt = procs.filter((p) => p.coverage !== "ONEAGENT_ONLY").length;
  return (
    <div style={card}>
      <QueryState state={states.summary}>
        <Flex gap={24} flexWrap="wrap" alignItems="flex-start">
          <Flex gap={16} flexWrap="wrap">
            <PctGauge pct={pct(extension, total)} caption="Databases with an extension" detail={`${extension.toLocaleString()} of ${total.toLocaleString()}`} onInfo={() => scrollTo(DB_ANCHOR)} />
            <PctGauge
              pct={procs.length ? pct(withExt, procs.length) : 100}
              caption="OneAgent databases with an extension"
              detail={states.processes.data ? `${withExt.toLocaleString()} of ${plural(procs.length, "server process", "server processes")}` : "…"}
              onInfo={() => scrollTo(DB_ANCHOR)}
            />
          </Flex>
          <div style={{ flex: "1 1 420px", minWidth: 0 }}>
            <Heading level={4} style={{ marginBottom: Spacings.Size8 }}>
              Databases by technology
            </Heading>
            <TechStackChart rows={techs} theme={theme} slice={slice} onSlice={onSlice} />
          </div>
        </Flex>
      </QueryState>
      <div style={{ marginTop: Spacings.Size12 }}>
        <QueryActions title="Databases: extension vs OneAgent only, by technology" query={queries.summary} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Database extensions in the environment
// ---------------------------------------------------------------------------
type ExtRow = { tech: string; label: string; info: DbTechInfo; env?: Loaded<ExtEnv>; status?: ExtStatus; databases: number; oneAgentOnly: number };

function envText(env?: Loaded<ExtEnv>): { text: string; color?: string } {
  if (!env || env.status === "loading") return { text: "Checking…" };
  if (env.status === "error") return { text: "Not readable", color: undefined };
  const e = env.value;
  if (e.state === "active") return { text: `Active · ${e.version}`, color: statusColor(100) };
  if (e.state === "inactive") return { text: "Installed, not active", color: statusColor(0) };
  return { text: "Not in the environment", color: statusColor(0) };
}

function ExtensionLink({ info, env }: { info: DbTechInfo; env?: Loaded<ExtEnv> }) {
  const installed = env?.status === "ok" && env.value.state !== "missing";
  const url = installed ? extensionAppLink(info.extension) : hubSearchLink(info.hubName);
  return url ? (
    <a href={url} target="_blank" rel="noreferrer noopener" style={linkStyle}>
      {installed ? "Extensions app ↗" : "Dynatrace Hub ↗"}
    </a>
  ) : null;
}

function ExtensionsCard({ data }: { data: DbData }) {
  const rows = useMemo<ExtRow[]>(
    () =>
      data.techs.map((t) => {
        const info = dbTechInfo(t.tech);
        return { tech: t.tech, label: t.label, info, env: data.envs.get(info.extension), status: data.extStatus.get(info.extension), databases: t.total, oneAgentOnly: t.counts.ONEAGENT_ONLY };
      }),
    [data.techs, data.envs, data.extStatus],
  );
  const columns = useMemo<DataTableColumnDef<ExtRow>[]>(
    () => [
      { id: "label", header: "Technology", accessor: "label", width: "1.2fr" },
      { id: "ext", header: "Extension", accessor: (r) => r.info.hubName, width: "1.4fr", cell: ({ rowData }) => <Text title={rowData.info.extension}>{rowData.info.hubName || "—"}</Text> },
      {
        id: "env",
        header: "In this environment",
        accessor: (r) => envText(r.env).text,
        width: "1.2fr",
        cell: ({ rowData }) => {
          const t = envText(rowData.env);
          return (
            <span title={rowData.env?.status === "error" ? rowData.env.message : undefined}>
              <Text style={{ fontWeight: 600, color: t.color }}>{t.text}</Text>
            </span>
          );
        },
      },
      {
        id: "configs",
        header: "Configurations",
        accessor: (r) => r.status?.configs ?? 0,
        width: "1.4fr",
        cell: ({ rowData }) => {
          const s = rowData.status;
          if (!s) return <Text style={hint}>None reporting</Text>;
          const bad = s.configs - s.ok;
          return (
            <Text>
              {s.configs} · {bad ? <span style={{ color: statusColor(0), fontWeight: 600 }}>{bad} not OK ({s.statuses.filter((x) => !["OK", "IDLE"].includes(x)).join(", ")})</span> : <span style={{ color: statusColor(100) }}>all OK</span>}
            </Text>
          );
        },
      },
      { id: "runs", header: "Runs on", accessor: (r) => r.info.runs, width: "1fr", cell: ({ rowData }) => <Text>{rowData.info.runs === "remote" ? "ActiveGate group" : rowData.info.runs === "local" ? "OneAgent (host)" : "OneAgent or ActiveGate"}</Text> },
      { id: "gap", header: "OneAgent only", accessor: "oneAgentOnly", width: "0.8fr", cell: ({ rowData }) => <Text style={{ fontWeight: 600, color: rowData.oneAgentOnly ? statusColor(0) : undefined }}>{rowData.oneAgentOnly}</Text> },
      { id: "link", header: "Links", accessor: "tech", width: "1fr", disableSorting: true, cell: ({ rowData }) => <>{rowData.info.extension && <ExtensionLink info={rowData.info} env={rowData.env} />}</> },
    ],
    [],
  );
  return (
    <div style={card}>
      <Heading level={4}>Database extensions</Heading>
      <Text style={{ ...hint, display: "block", marginBottom: Spacings.Size8 }}>
        The extension for each technology found: whether it is in the environment (Extensions API) and the latest status of its monitoring configurations (extension self-monitoring).
      </Text>
      <QueryState state={data.states.status}>
        <DataTable data={rows} columns={columns} sortable fullWidth variant={{ rowDensity: "condensed" }}>
          <DataTable.EmptyState>No database technologies found.</DataTable.EmptyState>
        </DataTable>
      </QueryState>
      <div style={{ marginTop: Spacings.Size8 }}>
        <QueryActions title="Databases: database extension configurations by status" query={data.queries.status} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OneAgent database processes
// ---------------------------------------------------------------------------
const COVERAGE_COLOR = (p: DbProcess) => (p.coverage === "ONEAGENT_ONLY" ? statusColor(0) : statusColor(100));

function Links({ items }: { items: { label: string; url?: string }[] }) {
  const shown = items.filter((i): i is { label: string; url: string } => !!i.url);
  return (
    <Flex gap={12} flexWrap="wrap">
      {shown.map((i) => (
        <a key={i.label} href={i.url} target="_blank" rel="noreferrer noopener" style={linkStyle}>
          {i.label} ↗
        </a>
      ))}
    </Flex>
  );
}

function ProcessesCard({ data, tf, slice, selectedId, onSelect }: { data: DbData; tf: Timeframe; slice: Slice | null; selectedId?: string; onSelect: (p: DbProcess) => void }) {
  const [tech, setTech] = useState(ANY);
  const [coverage, setCoverage] = useState(ANY);
  const techs = useMemo(() => [...new Set(data.procs.map((p) => p.tech))].sort(), [data.procs]);
  const rows = useMemo(
    () => data.procs.filter((p) => processInSlice(p, slice) && (tech === ANY || p.tech === tech) && (coverage === ANY || (coverage === "ONEAGENT_ONLY" ? p.coverage === "ONEAGENT_ONLY" : p.coverage !== "ONEAGENT_ONLY"))),
    [data.procs, slice, tech, coverage],
  );
  const columns = useMemo<DataTableColumnDef<DbProcess>[]>(
    () => [
      { id: "name", header: "Process", accessor: "name", width: "2fr" },
      { id: "tech", header: "Technology", accessor: (p) => dbTechInfo(p.tech).label, width: "1.1fr" },
      {
        id: "coverage",
        header: "Monitored by",
        accessor: (p) => COVERAGE_LABEL[p.coverage],
        width: "1.4fr",
        cell: ({ rowData }) => (
          <span title={rowData.coverage === "EXTENSION" ? `Matched on ${rowData.matchedOn.join(", ")}` : rowData.localExtension || categoryOf("ONEAGENT_ONLY").detail}>
            <Text style={{ fontWeight: 600, color: COVERAGE_COLOR(rowData) }}>
              {rowData.coverage === "ONEAGENT_ONLY" ? "✕ " : "✓ "}
              {COVERAGE_LABEL[rowData.coverage]}
            </Text>
          </span>
        ),
      },
      { id: "instance", header: "DB instance / extension", accessor: (p) => p.instances.join(", ") || p.localExtension, width: "1.6fr", cell: ({ rowData }) => <Text>{rowData.instances.join(", ") || rowData.localExtension || "—"}</Text> },
      { id: "host", header: "Host", accessor: "hostName", width: "1.4fr" },
      { id: "k8s", header: "Kubernetes", accessor: (p) => (p.namespace ? `${p.namespace} / ${p.pod}` : ""), width: "1.6fr", cell: ({ rowData }) => <Text>{rowData.namespace ? `${rowData.namespace} / ${rowData.pod || rowData.workload}` : "—"}</Text> },
      { id: "ports", header: "Listen ports", accessor: (p) => p.listenPorts.join(", "), width: "0.9fr" },
      {
        id: "links",
        header: "Links",
        accessor: "id",
        width: "1.5fr",
        disableSorting: true,
        cell: ({ rowData }) => (
          <Links
            items={[
              { label: "Process", url: rowData.sid ? entityOverviewLink("PROCESS", rowData.sid, tf) : undefined },
              { label: "Host", url: entityOverviewLink("HOST", rowData.host, tf) },
              ...rowData.instanceIds.map((id, i) => ({ label: rowData.instanceIds.length > 1 ? `DB instance ${i + 1}` : "DB instance", url: dbInstanceLink(id) })),
            ]}
          />
        ),
      },
      {
        id: "action",
        header: "Remediation",
        accessor: "id",
        width: "1fr",
        disableSorting: true,
        cell: ({ rowData }) => (
          <Button size="condensed" variant={rowData.id === selectedId ? "accent" : rowData.coverage === "ONEAGENT_ONLY" ? "emphasized" : "default"} aria-pressed={rowData.id === selectedId} onClick={() => onSelect(rowData)}>
            {rowData.id === selectedId ? "Selected" : rowData.coverage === "ONEAGENT_ONLY" ? "Configure" : "Details"}
          </Button>
        ),
      },
    ],
    [tf, selectedId, onSelect],
  );
  return (
    <div style={card}>
      <Heading level={4}>OneAgent database processes</Heading>
      <Text style={{ ...hint, display: "block", marginBottom: Spacings.Size8 }}>
        Database server processes OneAgent sees, and the extension that covers each one: a DB instance whose server name or endpoint (host or IP and port) is this process, or a local extension on its host. Select Configure on a
        OneAgent-only database for the setup steps.
      </Text>
      <QueryState state={data.states.processes}>
        <Flex gap={16} alignItems="flex-end" flexWrap="wrap" style={{ marginBottom: Spacings.Size8 }}>
          <Field label="Technology">
            <Select value={tech} onChange={(v: string | null) => v && setTech(v)}>
              <Select.Content>
                <Select.Option value={ANY}>All technologies</Select.Option>
                {techs.map((t) => (
                  <Select.Option key={t} value={t}>
                    {dbTechInfo(t).label}
                  </Select.Option>
                ))}
              </Select.Content>
            </Select>
          </Field>
          <Field label="Monitored by">
            <Select value={coverage} onChange={(v: string | null) => v && setCoverage(v)}>
              <Select.Content>
                <Select.Option value={ANY}>Any</Select.Option>
                <Select.Option value="ONEAGENT_ONLY">OneAgent only</Select.Option>
                <Select.Option value="EXTENSION">An extension</Select.Option>
              </Select.Content>
            </Select>
          </Field>
          <Text style={hint}>
            {plural(rows.length, "process", "processes")}
            {slice ? ` in ${dbTechInfo(slice.tech).label} · ${categoryOf(slice.category).label}` : ""}
          </Text>
        </Flex>
        <DataTable data={rows} columns={columns} sortable fullWidth variant={{ rowDensity: "condensed" }}>
          <DataTable.EmptyState>{data.procs.length ? "No processes match these filters." : "OneAgent sees no database server process in this timeframe."}</DataTable.EmptyState>
          <DataTable.Pagination defaultPageSize={PAGE_SIZE} pageSizeOptions={[PAGE_SIZE, 50, 100]} />
        </DataTable>
      </QueryState>
      <div style={{ marginTop: Spacings.Size8 }}>
        <QueryActions title="Databases: OneAgent database processes and their extension" query={data.queries.processes} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Extension-monitored DB instances
// ---------------------------------------------------------------------------
function InstancesCard({ data, slice }: { data: DbData; slice: Slice | null }) {
  const rows = useMemo(() => data.insts.filter((i) => instanceInSlice(i, slice) && (!slice || slice.category !== "ONEAGENT_ONLY")), [data.insts, slice]);
  const columns = useMemo<DataTableColumnDef<DbInstance>[]>(
    () => [
      {
        id: "name",
        header: "DB instance",
        accessor: "name",
        width: "2.2fr",
        cell: ({ rowData }) => {
          const url = dbInstanceLink(rowData.id);
          return url ? (
            <a href={url} target="_blank" rel="noreferrer noopener" style={linkStyle} title="Open in Databases">
              {rowData.name} ↗
            </a>
          ) : (
            <Text>{rowData.name}</Text>
          );
        },
      },
      { id: "tech", header: "Technology", accessor: (i) => dbTechInfo(i.tech).label, width: "1.1fr" },
      { id: "version", header: "Version", accessor: "version", width: "0.9fr" },
      { id: "endpoint", header: "Endpoint", accessor: (i) => `${i.endpointHost}:${i.port}`, width: "2.2fr" },
      { id: "server", header: "Server name", accessor: "serverName", width: "1.1fr" },
      {
        id: "oneagent",
        header: "OneAgent process",
        accessor: (i) => i.processes.join(", "),
        width: "1.8fr",
        cell: ({ rowData }) =>
          rowData.processes.length ? (
            <span title={`Matched on ${rowData.matchedOn.join(", ")}`}>
              <Text>{rowData.processes.join(", ")}</Text>
            </span>
          ) : (
            <Text style={hint}>None seen (remote / managed)</Text>
          ),
      },
      { id: "k8s", header: "Kubernetes cluster", accessor: "k8sCluster", width: "1fr" },
    ],
    [],
  );
  return (
    <div style={card}>
      <Heading level={4}>DB instances monitored by an extension</Heading>
      <Text style={{ ...hint, display: "block", marginBottom: Spacings.Size8 }}>
        Smartscape DB instances created by the database extensions (the Databases app), with the OneAgent process each one matches. Instances without one are remote or managed databases (for example AWS RDS or Azure SQL) or run on hosts
        without OneAgent.
      </Text>
      <QueryState state={data.states.instances}>
        <DataTable data={rows} columns={columns} sortable fullWidth variant={{ rowDensity: "condensed" }}>
          <DataTable.EmptyState>{slice?.category === "ONEAGENT_ONLY" ? "OneAgent-only databases have no DB instance." : "No DB instance from a database extension in this timeframe."}</DataTable.EmptyState>
          <DataTable.Pagination defaultPageSize={PAGE_SIZE} pageSizeOptions={[PAGE_SIZE, 50, 100]} />
        </DataTable>
      </QueryState>
      <div style={{ marginTop: Spacings.Size8 }}>
        <QueryActions title="Databases: DB instances monitored by extensions" query={data.queries.instances} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Remediation
// ---------------------------------------------------------------------------
const STATUS_ORDER = ["fail", "warn", "pass", "info"] as const;

function CheckList({ checks }: { checks: DbCheck[] }) {
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

function useLoaded<T>(load: () => Promise<T>, key: string, scope: string): [Loaded<T>, () => void] {
  const [state, setState] = useState<Loaded<T>>({ status: "loading" });
  const [tick, setTick] = useState(0);
  const latest = useRef(load);
  latest.current = load;
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    latest.current().then(
      (value) => !cancelled && setState({ status: "ok", value }),
      (e) => !cancelled && setState({ status: "error", message: extError(e, scope) }),
    );
    return () => {
      cancelled = true;
    };
  }, [key, tick, scope]);
  return [state, useCallback(() => setTick((t) => t + 1), [])];
}

const defaultDescription = (info: DbTechInfo, p: DbProcess) => `${info.label} ${p.pod || p.hostName || p.name} (created by Architect Assistant)`.slice(0, 500);

/** Creates one monitoring configuration (one endpoint) for the process, from the active extension version's schema. */
function CreateConfigForm({ p, info, groups, credentials, onDone }: { p: DbProcess; info: DbTechInfo; groups: AgGroup[]; credentials: Loaded<VaultCredential[]>; onDone: () => void }) {
  const [shape] = useLoaded<ConfigShape | string>(
    async () => {
      const env = await readExtensionEnv(info.extension);
      if (env.state !== "active") return `${info.hubName} is not active in this environment. Add it from Dynatrace Hub first, then reload this form.`;
      const s = shapeFromSchema(await readConfigSchema(info.extension, env.version));
      return typeof s === "string" ? `This app cannot create a ${info.hubName} ${env.version} configuration: ${s}. Use the Databases or Extensions app.` : s;
    },
    `${p.id}|${info.extension}`,
    "extensions:definitions:read",
  );
  const options = useMemo(() => endpointOptions(p), [p]);
  const usable = useMemo(() => groups.filter((g) => g.online > 0), [groups]);
  const vault = credentials.status === "ok" ? credentials.value : [];
  const [input, setInput] = useState<ConfigInput>(() => ({
    group: usable[0]?.group ?? "",
    host: options[0]?.host ?? "",
    port: endpointPort(p, info),
    databaseName: info.databaseName ?? "",
    instanceName: "",
    oracleBy: "serviceName",
    oracleName: "",
    auth: { kind: "basic", username: "dynatrace", password: "" },
    ssl: false,
    featureSets: [],
    description: defaultDescription(info, p),
    licenseAccepted: false,
  }));
  const patch = (x: Partial<ConfigInput>) => setInput((i) => ({ ...i, ...x }));
  // Defaults that need the schema or the async lists: every feature set on, the schema's SSL default, the first group / credential.
  const s = shape.status === "ok" && typeof shape.value !== "string" ? shape.value : null;
  useEffect(() => {
    if (s) setInput((i) => ({ ...i, featureSets: i.featureSets.length ? i.featureSets : s.featureSets, ssl: s.sslDefault }));
  }, [s]);
  useEffect(() => {
    if (!input.group && usable[0]) patch({ group: usable[0].group });
  }, [usable, input.group]);

  if (shape.status === "loading") return <Text>Reading the extension and its configuration schema…</Text>;
  if (shape.status === "error") return <Text>Could not read the extension: {shape.message}</Text>;
  if (!s) return <Text>{String(shape.value)}</Text>;

  const has = (k: string) => s.endpointProps.has(k);
  const custom = !options.some((o) => o.host === input.host);
  const request = JSON.stringify(buildMonitoringConfig(s, input, true), null, 2);
  const setAuthKind = (kind: string) =>
    patch({ auth: kind === "vault" ? { kind: "vault", id: vault[0]?.id ?? "" } : { kind: "basic", username: input.auth.kind === "basic" ? input.auth.username : "dynatrace", password: "" } });
  const vaultUrl = credentialVaultLink();
  const dbUrl = databasesAppLink();

  return (
    <Flex flexDirection="column" gap={12}>
      <Flex gap={16} flexWrap="wrap" alignItems="flex-end">
        <Field label="ActiveGate group">
          <Select value={input.group} onChange={(v: string | null) => v && patch({ group: v })}>
            <Select.Content>
              {usable.map((g) => (
                <Select.Option key={g.group} value={g.group}>
                  {g.group} ({g.online}/{g.activeGates} online)
                </Select.Option>
              ))}
            </Select.Content>
          </Select>
        </Field>
        <Field label="Endpoint">
          <Select value={custom ? ANY : input.host} onChange={(v: string | null) => v && v !== ANY && patch({ host: v })}>
            <Select.Content>
              {options.map((o) => (
                <Select.Option key={o.host} value={o.host}>
                  {o.host} · {o.label}
                </Select.Option>
              ))}
              <Select.Option value={ANY}>Other host (enter below)</Select.Option>
            </Select.Content>
          </Select>
        </Field>
        <Field label="Host">
          <TextInput value={input.host} placeholder="db.example.com" onChange={(v: string) => patch({ host: v })} />
        </Field>
        <Field label="Port">
          <NumberInputV2 value={input.port} onChange={(v: number | null) => patch({ port: v ?? 0 })} />
        </Field>
      </Flex>
      <Flex gap={16} flexWrap="wrap" alignItems="flex-end">
        {has("databaseIdentifier") && (
          <>
            <Field label="Connect by">
              <Select value={input.oracleBy} onChange={(v: string | null) => v && patch({ oracleBy: v as ConfigInput["oracleBy"] })}>
                <Select.Content>
                  <Select.Option value="serviceName">Service name</Select.Option>
                  <Select.Option value="sid">SID</Select.Option>
                </Select.Content>
              </Select>
            </Field>
            <Field label={input.oracleBy === "sid" ? "SID" : "Service name"}>
              <TextInput value={input.oracleName} placeholder={input.oracleBy === "sid" ? "ORCL" : "orclpdb1"} onChange={(v: string) => patch({ oracleName: v })} />
            </Field>
          </>
        )}
        {has("databaseName") && (
          <Field label={info.tech === "DB2" ? "Database name" : "Database name (optional)"}>
            <TextInput value={input.databaseName} placeholder={info.databaseName ?? (info.tech === "MYSQL" ? "empty = all databases" : "")} onChange={(v: string) => patch({ databaseName: v })} />
          </Field>
        )}
        {has("instanceName") && (
          <Field label="Instance name (named instances)">
            <TextInput value={input.instanceName} placeholder="empty = default instance" onChange={(v: string) => patch({ instanceName: v })} />
          </Field>
        )}
        {has("ssl") && (
          <Checkbox value={input.ssl} onChange={(v: boolean) => patch({ ssl: v })}>
            SSL
          </Checkbox>
        )}
      </Flex>
      <Flex gap={16} flexWrap="wrap" alignItems="flex-end">
        <Field label="Credentials">
          <Select value={input.auth.kind} onChange={(v: string | null) => v && setAuthKind(v)}>
            <Select.Content>
              {s.vault && <Select.Option value="vault">Credential vault</Select.Option>}
              <Select.Option value="basic">User and password</Select.Option>
            </Select.Content>
          </Select>
        </Field>
        {input.auth.kind === "vault" ? (
          <Field label="Credential (Extension authentication)">
            <Select value={input.auth.id} onChange={(v: string | null) => v && patch({ auth: { kind: "vault", id: v } })}>
              <Select.Content>
                {vault.map((c) => (
                  <Select.Option key={c.id} value={c.id}>
                    {c.name}
                    {c.ownerOnly ? " (owner only)" : ""}
                  </Select.Option>
                ))}
              </Select.Content>
            </Select>
          </Field>
        ) : (
          <>
            <Field label="User">
              <TextInput value={input.auth.username} onChange={(v: string) => input.auth.kind === "basic" && patch({ auth: { ...input.auth, username: v } })} />
            </Field>
            <Field label="Password">
              <PasswordInput value={input.auth.password} onChange={(v: string) => input.auth.kind === "basic" && patch({ auth: { ...input.auth, password: v } })} />
            </Field>
          </>
        )}
        {input.auth.kind === "vault" && credentials.status === "ok" && vault.length === 0 && (
          <Text style={hint}>
            No User and password credential with the Extension authentication scope.{" "}
            {vaultUrl && (
              <a href={vaultUrl} target="_blank" rel="noreferrer noopener" style={linkStyle}>
                Credential Vault ↗
              </a>
            )}
          </Text>
        )}
      </Flex>
      <details>
        <summary style={{ cursor: "pointer", fontSize: 12, opacity: 0.8 }}>
          Feature sets ({input.featureSets.length} of {s.featureSets.length})
        </summary>
        <Flex gap={8} style={{ margin: "6px 0" }}>
          <Button size="condensed" variant="default" onClick={() => patch({ featureSets: s.featureSets })}>
            All
          </Button>
          <Button size="condensed" variant="default" onClick={() => patch({ featureSets: [] })}>
            None
          </Button>
        </Flex>
        <Flex gap={12} flexWrap="wrap">
          {s.featureSets.map((f) => (
            <Checkbox key={f} value={input.featureSets.includes(f)} onChange={(v: boolean) => patch({ featureSets: v ? [...input.featureSets, f] : input.featureSets.filter((x) => x !== f) })}>
              {f}
            </Checkbox>
          ))}
        </Flex>
      </details>
      <Field label="Description">
        <TextInput value={input.description} onChange={(v: string) => patch({ description: v })} />
      </Field>
      {s.license && (
        <Checkbox value={input.licenseAccepted} onChange={(v: boolean) => patch({ licenseAccepted: v })}>
          I accept the Oracle JDBC driver license (Dynatrace redistribution license)
        </Checkbox>
      )}
      <ApiFix
        summary={`Creates one ${info.hubName} ${s.version} monitoring configuration on ActiveGate group ${input.group || "…"} for ${input.host || "…"}:${input.port}. Create the monitoring user in the database first (manual action “${userAction(info).title}”).`}
        request={{ label: `Request: POST /platform/extensions/v2/extensions/${info.extension}/monitoring-configurations (password masked)`, text: request }}
        confirmLabel={`Create a ${info.hubName} monitoring configuration for ${input.host || "this database"}`}
        applyLabel="Create configuration"
        run={(validateOnly) => createMonitoringConfig(info, s, input, groups, validateOnly)}
        onDone={onDone}
        ui={
          dbUrl ? (
            <Text style={hint}>
              Same result in the UI:{" "}
              <a href={dbUrl} target="_blank" rel="noreferrer noopener" style={linkStyle}>
                Databases ↗
              </a>{" "}
              › Add DB Instance › {info.hubName} (see the manual action “{configureAction(info, p).title}”).
            </Text>
          ) : undefined
        }
      />
    </Flex>
  );
}

/** Severity of an action in the picker: the most severe check it addresses. */
const ADDRESSES: Record<string, string[]> = { configure: ["extension", "configs"], "ag-group": ["group"], "api-create": ["coverage"], k8s: ["k8s"], user: [], vault: ["vault"] };
function severityOf(id: string, checks: DbCheck[]): Severity {
  const addressed = checks.filter((c) => (ADDRESSES[id] ?? []).includes(c.id));
  return (["fail", "warn", "info"] as const).find((s) => addressed.some((c) => c.status === s)) ?? "other";
}

function DbDiagnosis({ p, data, tf, onSummary }: { p: DbProcess; data: DbData; tf: Timeframe; onSummary: (s: DatabaseSelection | null) => void }) {
  const info = dbTechInfo(p.tech);
  const [env] = useLoaded<ExtEnv>(() => readExtensionEnv(info.extension), `${p.id}|env`, "extensions:definitions:read");
  const [configs, reloadConfigs] = useLoaded<ExistingConfig[]>(() => readMonitoringConfigs(info.extension), `${p.id}|configs`, "extensions:configurations:read");
  const [credentials] = useLoaded<VaultCredential[]>(readExtensionCredentials, `${p.id}|vault`, "environment-api:credentials:read");
  const checks = useMemo(() => (info.extension ? diagnoseDbProcess({ p, info, env, groups: data.groups, configs, credentials }) : []), [p, info, env, data.groups, configs, credentials]);
  const blocking = useMemo(() => checks.filter((c) => c.status === "fail").map((c) => c.title), [checks]);
  useEffect(() => {
    onSummary({ name: p.name, tech: info.label, covered: p.coverage !== "ONEAGENT_ONLY", blocking });
    return () => onSummary(null);
  }, [p.name, p.coverage, info.label, blocking, onSummary]);
  const onDone = useCallback(() => {
    reloadConfigs();
    data.reload();
  }, [reloadConfigs, data]);

  const actions = useMemo<ActionDef[]>(() => {
    const manual = (a: ManualAction): ActionDef => ({ id: a.id, label: a.title, kind: "manual", node: <ManualActionView action={a} />, docs: a.docs, severity: severityOf(a.id, checks) });
    const out: ActionDef[] = [];
    if (info.api && info.runs !== "local" && p.coverage === "ONEAGENT_ONLY") {
      out.push({
        id: "api-create",
        label: `Create the ${info.hubName} monitoring configuration`,
        kind: "api",
        node: <CreateConfigForm key={p.id} p={p} info={info} groups={data.groups} credentials={credentials} onDone={onDone} />,
        docs: [...info.docs, DOC.credentialVault],
        severity: severityOf("api-create", checks),
      });
    }
    out.push(manual(userAction(info)), manual(configureAction(info, p)));
    if (info.runs !== "local") out.push(manual(agGroupAction()), manual(credentialAction()));
    if (p.namespace && info.runs !== "local") out.push(manual(kubernetesDbAction(p)));
    const order: Severity[] = ["fail", "warn", "info", "other"];
    return out.sort((a, b) => order.indexOf(a.severity ?? "other") - order.indexOf(b.severity ?? "other"));
  }, [info, p, data.groups, credentials, onDone, checks]);

  return (
    <Flex flexDirection="column" gap={12}>
      <Flex gap={12} alignItems="baseline" flexWrap="wrap">
        <Text style={{ fontWeight: 700 }}>{p.name}</Text>
        <Text style={hint}>
          {info.label} · {p.hostName || p.host}
          {p.namespace ? ` · ${p.namespace}/${p.pod || p.workload}` : ""}
          {p.listenPorts.length ? ` · ports ${p.listenPorts.join(", ")}` : ""}
        </Text>
        <Links items={[{ label: "Process", url: p.sid ? entityOverviewLink("PROCESS", p.sid, tf) : undefined }, { label: "Host", url: entityOverviewLink("HOST", p.host, tf) }]} />
      </Flex>
      {checks.length > 0 ? <CheckList checks={checks} /> : <Text>No database extension is known for this technology.</Text>}
      <ActionPicker key={p.id} actions={actions} />
    </Flex>
  );
}

function DbRemediation({ data, tf, selection, onClear, onSummary }: { data: DbData; tf: Timeframe; selection: DbProcess | null; onClear: () => void; onSummary: (s: DatabaseSelection | null) => void }) {
  const generic = useMemo<ActionDef[]>(() => genericDbActions().map((a) => ({ id: a.id, label: a.title, kind: "manual", node: <ManualActionView action={a} />, docs: a.docs })), []);
  return (
    <div id={DB_ANCHOR} style={card}>
      <Flex justifyContent="space-between" alignItems="flex-end" flexWrap="wrap" gap={12}>
        <div>
          <Heading level={3} style={{ margin: 0 }}>
            Remediation actions
          </Heading>
          <Text style={{ opacity: 0.8 }}>
            {selection
              ? `What ${selection.name} needs for its ${dbTechInfo(selection.tech).hubName} extension (extension, ActiveGate group, existing configurations, credentials), the monitoring user, and the configuration itself.`
              : "How a database gets its extension. Select Configure on a OneAgent-only database above for checks and steps filled in for it."}
          </Text>
          <DocsStatusLine />
        </div>
        {selection && (
          <Button variant="default" size="condensed" onClick={onClear}>
            Clear selection
          </Button>
        )}
      </Flex>
      <div style={{ marginTop: Spacings.Size12 }}>{selection ? <DbDiagnosis key={selection.id} p={selection} data={data} tf={tf} onSummary={onSummary} /> : <ActionPicker actions={generic} />}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab
// ---------------------------------------------------------------------------
export function DatabasesTab({ tf }: { tf: Timeframe }) {
  const theme = useCurrentTheme() as Theme;
  const data = useDatabasesData(tf);
  const [slice, setSlice] = useState<Slice | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [summary, setSummary] = useState<DatabaseSelection | null>(null);
  const selection = data.procs.find((p) => p.id === selectedId) ?? null;
  // A new timeframe changes the data behind a slice.
  useEffect(() => setSlice(null), [tf]);

  const select = useCallback((p: DbProcess) => {
    setSelectedId(p.id);
    scrollTo(DB_ANCHOR);
  }, []);
  const clear = useCallback(() => setSelectedId(null), []);

  const { panel: aiPanel } = useAIInsights(
    useCallback(
      () =>
        analyzeDatabases(
          data.techs.map((t) => {
            const env = data.envs.get(dbTechInfo(t.tech).extension);
            return { label: t.label, both: t.counts.BOTH, extensionOnly: t.counts.EXTENSION_ONLY, oneAgentOnly: t.counts.ONEAGENT_ONLY, extensionActive: env?.status === "ok" ? env.value.state === "active" : null };
          }),
          [...data.extStatus.values()].filter((s) => s.configs > s.ok).map((s) => ({ label: data.techs.map((t) => dbTechInfo(t.tech)).find((i) => i.extension === s.extension)?.hubName ?? s.extension, problems: s.configs - s.ok })),
          summary,
        ),
      [data.techs, data.envs, data.extStatus, summary],
    ),
  );

  return (
    <Flex flexDirection="column" gap={16}>
      {aiPanel}
      <Heading level={3}>Databases</Heading>
      <Text>
        Databases monitored by a Dynatrace database extension (DB instances in the Databases app: statements, waits, locks, sessions) versus database servers seen only by OneAgent (a process with CPU, memory and network, but no
        database insights), per technology, and the steps to configure the extension for a OneAgent-only database. Read from Smartscape DB instances, OneAgent process instances, extension self-monitoring and the Extensions API.
      </Text>
      <SummaryCard data={data} theme={theme} slice={slice} onSlice={setSlice} />
      {slice && (
        <Flex gap={8} alignItems="center">
          <Text style={hint}>
            Tables filtered to {dbTechInfo(slice.tech).label} · {categoryOf(slice.category).label}.
          </Text>
          <Button size="condensed" variant="default" onClick={() => setSlice(null)}>
            Show all
          </Button>
        </Flex>
      )}
      <ProcessesCard data={data} tf={tf} slice={slice} selectedId={selectedId ?? undefined} onSelect={select} />
      <InstancesCard data={data} slice={slice} />
      <ExtensionsCard data={data} />
      <Flex justifyContent="flex-end">
        <Button size="condensed" variant="default" onClick={data.reload}>
          Re-check
        </Button>
      </Flex>
      <DbRemediation data={data} tf={tf} selection={selection} onClear={clear} onSummary={setSummary} />
    </Flex>
  );
}
