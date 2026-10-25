import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { settingsObjectsClient } from "@dynatrace-sdk/client-classic-environment-v2";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { Checkbox, Select, TextInput } from "@dynatrace/strato-components/forms";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import Colors from "@dynatrace/strato-design-tokens/colors";
import Spacings from "@dynatrace/strato-design-tokens/spacings";
import Borders from "@dynatrace/strato-design-tokens/borders";
import { useDql } from "../useDql";
import { useAIInsights } from "../AIInsights";
import { analyzeDeepMonitoring, type DeepSelection, type DeepTechRow } from "../analyses";
import { DEEP_PAGE_SIZE, DEEP_SEARCH_LIMIT, deepCoverageQuery, deepDetailQuery, deepGroupSearchQuery, deepProcessSearchQuery, iisWorkersQuery, type DeepState, type Timeframe } from "../queries";
import { entityOverviewLink, processStatePages } from "../links";
import { PctGauge, QueryActions, QueryState, ShowEntitiesButton, num, pct, statusColor } from "../components";
import { Field, ManualActionView, Request, ResultLine } from "../RemediationPanel";
import { MODE_DOCS, UPDATE_DOCS, buildModeBody, monitoringModeAction, setMonitoringModes, updatesUiAction, type DocLink, type ManualAction, type SubmitResult } from "../remediation";
import {
  AUTO_MONITORING_SCHEMA,
  CONTAINER_LABELS,
  CONTAINER_RULE_SCHEMA,
  CONTAINER_TECH_SCHEMA,
  CUSTOM_RULE_SCHEMA,
  EMPTY_SETTINGS,
  HOST_PG_STATE_SCHEMA,
  PG_STATE_SCHEMA,
  diagnose,
  disableRules,
  monitorRuleBody,
  pgOnBody,
  postObjects,
  processStatus,
  readDeepSettings,
  readPgStates,
  ruleCandidates,
  ruleText,
  setHostPgMonitoringOn,
  enablePgDeepMonitoring,
  settingsClassicLink,
  settingsLink,
  shortVersion,
  toInstance,
  upsert,
  type CheckStatus,
  type DeepSettings,
  type Diagnosis,
  type FixId,
  type Instance,
  type SwitchState,
  STATUS_KEYS,
  type ProcessStatus,
  type StatusKey,
  type StatusTone,
} from "../deepMonitoring";
import { DEEP_DOCS, techInfo } from "../deepTech";
import { GENERIC_ACTIONS, alternativeAction, kubernetesAction, restartAction, upgradeAction } from "../deepActions";
import { DOCS_REVIEWED, OUTBOUND_SCHEMA, changedDocs, retryDocsFreshness, useDocsFreshness, type DocChange } from "../deepDocs";

const card: React.CSSProperties = {
  padding: Spacings.Size16,
  borderRadius: Borders.Radius.Container.Default,
  background: Colors.Background.Container.Neutral.Default,
};
const hint: React.CSSProperties = { fontSize: 12, opacity: 0.7 };
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
export const DEEP_ANCHOR = "remediation-deep-monitoring";
/** Selected timeframe, so links open other apps on the same window (see timeframePayload in links.ts). */
const TfContext = createContext<Timeframe>("24h");

type Selection = { kind: "process" | "group"; id: string; name: string };
type TechRow = DeepTechRow & { key: string };

/** Coverage rows: scored technologies (OneAgent has a code module) and the rest, listed separately. */
function useTechRows(records: Record<string, any>[] | undefined) {
  return useMemo(() => {
    const scored: TechRow[] = [];
    const notScored: { key: string; label: string; total: number }[] = [];
    for (const r of records ?? []) {
      const key = String(r.technology);
      const info = techInfo(key === "OTHER" ? null : key);
      const total = num(r.total);
      const deep = num(r.deep);
      if (total === 0) continue;
      if (info.kind === "deep") scored.push({ key, label: info.label, total, deep, pct: pct(deep, total) });
      else if (info.kind === "none") notScored.push({ key, label: info.label, total });
    }
    return { scored: scored.sort((a, b) => b.total - a.total), notScored: notScored.sort((a, b) => b.total - a.total) };
  }, [records]);
}

/** One gauge per technology (same card and gauge as the Security context tab), plus an overall gauge. */
function TechGaugeGrid({ scored, notScored }: { scored: TechRow[]; notScored: { label: string; total: number }[] }) {
  if (scored.length === 0) return <Text>No processes of a deep-monitorable technology found for this timeframe.</Text>;
  const total = scored.reduce((s, r) => s + r.total, 0);
  const deep = scored.reduce((s, r) => s + r.deep, 0);
  return (
    <div style={card}>
      <Flex gap={16} flexWrap="wrap">
        <PctGauge pct={pct(deep, total)} caption="All technologies" detail={`${deep.toLocaleString()} of ${total.toLocaleString()}`} />
        {scored.map((r) => (
          <PctGauge key={r.key} pct={r.pct} caption={r.label} detail={`${r.deep.toLocaleString()} of ${r.total.toLocaleString()}`} />
        ))}
      </Flex>
      {notScored.length > 0 && (
        <Text style={{ ...hint, display: "block", marginTop: Spacings.Size12 }}>
          Not scored (OneAgent has no code module for these): {notScored.map((r) => `${r.label} (${r.total.toLocaleString()})`).join(", ")}. Dynatrace&apos;s own processes are left out.
        </Text>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
type View = "process" | "group";
const ANY = "__any__";
const STATES: { value: DeepState; label: string; views: View[] }[] = [
  { value: "any", label: "Any state", views: ["process", "group"] },
  { value: "deep", label: "Deep monitored", views: ["process", "group"] },
  { value: "not-deep", label: "Not deep monitored", views: ["process", "group"] },
  { value: "partial", label: "Partially deep monitored", views: ["group"] },
];

function DiagnoseButton({ selected, onClick }: { selected: boolean; onClick: () => void }) {
  return (
    <Button variant={selected ? "accent" : "default"} size="condensed" onClick={onClick} aria-pressed={selected}>
      {selected ? "Selected" : "Diagnose"}
    </Button>
  );
}

function EntityLink({ type, id, label }: { type: string; id?: string; label: string }) {
  const tf = useContext(TfContext);
  const url = id ? entityOverviewLink(type, id, tf) : undefined;
  return url ? (
    <a href={url} target="_blank" rel="noreferrer noopener">
      {label} ↗
    </a>
  ) : null;
}

const PG_STATE_TEXT: Record<string, { label: string; color?: string }> = {
  MONITORING_ON: { label: "Monitor", color: statusColor(100) },
  MONITORING_OFF: { label: "Do not monitor", color: statusColor(0) },
  DEFAULT: { label: "Default" },
};

/** The process group's Process group monitoring setting (builtin:process-group.monitoring.state): current value + links. */
function PgSettingCell({ pg, state }: { pg: string; state?: string }) {
  const url = settingsLink(PG_STATE_SCHEMA, pg);
  const classic = settingsClassicLink(PG_STATE_SCHEMA, pg);
  const st = state ? (PG_STATE_TEXT[state] ?? { label: state }) : undefined;
  return (
    <Flex gap={8} flexWrap="wrap" alignItems="baseline">
      <Text style={{ fontWeight: 600, color: st?.color, opacity: st ? 1 : 0.6 }} title="Process group monitoring state of this process group">
        {st?.label ?? "…"}
      </Text>
      {url && (
        <a href={url} target="_blank" rel="noreferrer noopener" title="Process group monitoring for this process group in Settings">
          Setting ↗
        </a>
      )}
      {classic && (
        <a href={classic} target="_blank" rel="noreferrer noopener" style={{ fontSize: 11 }} title="The same setting in Settings Classic">
          Classic ↗
        </a>
      )}
    </Flex>
  );
}

const pgSettingColumn = <T extends { pg: string; pgState?: string }>(): DataTableColumnDef<T> => ({
  id: "pgSetting",
  header: "Deep monitoring setting",
  accessor: (r: T) => (r.pgState ? (PG_STATE_TEXT[r.pgState]?.label ?? r.pgState) : ""),
  width: "1.4fr",
  cell: ({ rowData }: { rowData: T }) => <PgSettingCell pg={rowData.pg} state={rowData.pgState} />,
});

type ProcRow = { id: string; sid?: string; name: string; pg: string; pgName: string; tech: string; version: string; deep: string; host: string; status?: ProcessStatus; pgState?: string };

const TONE_COLOR: Record<StatusTone, string | undefined> = { good: statusColor(100), warn: statusColor(50), bad: statusColor(0), neutral: undefined };

function ProcessResults({ query, selectedId, onSelect }: { query: string; selectedId?: string; onSelect: (s: Selection) => void }) {
  const state = useDql(query);
  const records = state.data?.records;
  const instances = useMemo<Instance[]>(() => (records ?? []).map(toInstance), [records]);
  // Status column: the same settings checks as Diagnose, for every row. Keyed on a content signature, never per render.
  const signature = useMemo(() => instances.map((i) => i.id).join(","), [instances]);
  const latest = useRef(instances);
  latest.current = instances;
  const [settings, setSettings] = useState<DeepSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  useEffect(() => {
    if (!signature) return;
    let cancelled = false;
    setSettings(null);
    setSettingsError(null);
    readDeepSettings(latest.current, DEEP_SEARCH_LIMIT)
      .then((s) => !cancelled && setSettings(s))
      .catch((e) => !cancelled && setSettingsError((e as any)?.message ?? String(e)));
    return () => {
      cancelled = true;
    };
  }, [signature]);
  const [statusFilter, setStatusFilter] = useState<StatusKey | typeof ANY>(ANY);
  const allRows = useMemo<ProcRow[]>(
    () =>
      instances.map((i) => ({
        id: i.id,
        sid: i.sid,
        name: i.name,
        pg: i.pg,
        pgName: i.pgName,
        tech: techInfo(i.processType).label,
        version: i.version ?? "—",
        deep: i.deep ? `Yes · ${i.installerVersion ? shortVersion(i.installerVersion) : i.codeServices > 0 ? "services" : "runtime metrics"}` : "No",
        host: i.hostName ?? "—",
        status: settings ? processStatus(i, settings) : undefined,
        pgState: settings ? String(settings.pgState.get(i.pg)?.value.MonitoringState ?? "DEFAULT") : undefined,
      })),
    [instances, settings],
  );
  const rows = useMemo(() => (statusFilter === ANY ? allRows : allRows.filter((r) => r.status?.key === statusFilter)), [allRows, statusFilter]);
  const counts = useMemo(() => {
    const m = new Map<StatusKey, number>();
    for (const r of allRows) if (r.status) m.set(r.status.key, (m.get(r.status.key) ?? 0) + 1);
    return m;
  }, [allRows]);
  const columns = useMemo<DataTableColumnDef<ProcRow>[]>(
    () => [
      { id: "name", header: "Process", accessor: "name", width: "2fr" },
      { id: "pgName", header: "Process group", accessor: "pgName", width: "2fr" },
      { id: "tech", header: "Technology", accessor: "tech", width: "1fr" },
      { id: "version", header: "Version", accessor: "version", width: "0.8fr" },
      {
        id: "deep",
        header: "Deep monitored",
        accessor: "deep",
        width: "1fr",
        cell: ({ rowData }) => <Text style={{ fontWeight: 600, color: statusColor(rowData.deep === "No" ? 0 : 100) }}>{rowData.deep}</Text>,
      },
      {
        id: "status",
        header: "Status",
        accessor: (r) => r.status?.label ?? "",
        width: "1.6fr",
        cell: ({ rowData }) =>
          rowData.status ? (
            <span title={rowData.status.detail}>
              <Text style={{ fontWeight: 600, color: TONE_COLOR[rowData.status.tone] }}>{rowData.status.label}</Text>
            </span>
          ) : (
            <Text style={hint}>{settingsError ? "—" : "Checking…"}</Text>
          ),
      },
      { id: "host", header: "Host", accessor: "host", width: "1.4fr" },
      {
        id: "links",
        header: "Links",
        accessor: "id",
        width: "1.4fr",
        disableSorting: true,
        cell: ({ rowData }) => (
          <Flex gap={12} flexWrap="wrap">
            <EntityLink type="PROCESS" id={rowData.sid} label="Process" />
            <EntityLink type="PROCESS_GROUP" id={rowData.pg} label="Process group" />
          </Flex>
        ),
      },
      pgSettingColumn<ProcRow>(),
      {
        id: "diagnose",
        header: "Remediation",
        accessor: "id",
        width: "1fr",
        disableSorting: true,
        cell: ({ rowData }) => <DiagnoseButton selected={rowData.id === selectedId} onClick={() => onSelect({ kind: "process", id: rowData.id, name: rowData.name })} />,
      },
    ],
    [selectedId, onSelect, settingsError],
  );
  return (
    <QueryState state={state}>
      <Flex flexDirection="column" gap={8}>
        {allRows.length > 0 && (
          <Flex gap={16} alignItems="flex-end" flexWrap="wrap">
            <Field label="Status">
              <Select value={statusFilter} onChange={(v: StatusKey | typeof ANY | null) => v && setStatusFilter(v)}>
                <Select.Content>
                  <Select.Option value={ANY}>All statuses ({allRows.length})</Select.Option>
                  {STATUS_KEYS.filter((k) => counts.has(k.key)).map((k) => (
                    <Select.Option key={k.key} value={k.key}>
                      {k.label} ({counts.get(k.key)})
                    </Select.Option>
                  ))}
                </Select.Content>
              </Select>
            </Field>
            <Text style={hint}>
              {settingsError
                ? `Status unavailable: could not read the monitoring settings (${settingsError}).`
                : settings
                  ? "Status combines the code module with the monitoring settings (the same checks as Diagnose). Restart required: nothing blocks injection, so the process started before OneAgent or the change. Hover a status for the reason."
                  : "Reading the monitoring settings for the status column…"}
            </Text>
          </Flex>
        )}
        <DataTable data={rows} columns={columns} sortable fullWidth variant={{ rowDensity: "condensed" }}>
          <DataTable.EmptyState>{statusFilter === ANY ? "No processes match these filters." : "No processes with this status in the results."}</DataTable.EmptyState>
          <DataTable.Pagination defaultPageSize={DEEP_PAGE_SIZE} pageSizeOptions={[DEEP_PAGE_SIZE]} />
        </DataTable>
        {allRows.length >= DEEP_SEARCH_LIMIT && <Text style={hint}>Showing the first {DEEP_SEARCH_LIMIT} processes (sorted by name); narrow the filters to find others.</Text>}
        <QueryActions title="Deep monitoring: process search" query={query} />
      </Flex>
    </QueryState>
  );
}

type GroupRow = { pg: string; pgName: string; techs: string; versions: string; instances: number; deep: number; pct: number; hosts: number; pgState?: string };

function GroupResults({ query, selectedId, onSelect }: { query: string; selectedId?: string; onSelect: (s: Selection) => void }) {
  const state = useDql(query);
  const records = state.data?.records;
  // Deep monitoring setting column: one settings read per result set (keyed on the group IDs, not per render).
  const pgKey = useMemo(() => (records ?? []).map((r) => String(r.pg ?? "")).join(","), [records]);
  const [pgStates, setPgStates] = useState<Map<string, string> | null>(null);
  useEffect(() => {
    if (!pgKey) return;
    let cancelled = false;
    setPgStates(null);
    readPgStates(pgKey.split(","))
      .then((m) => !cancelled && setPgStates(m))
      .catch(() => !cancelled && setPgStates(new Map()));
    return () => {
      cancelled = true;
    };
  }, [pgKey]);
  const rows = useMemo<GroupRow[]>(
    () =>
      (records ?? []).map((r) => {
        const instances = num(r.instances);
        const deep = num(r.deep);
        return {
          pg: String(r.pg ?? ""),
          pgName: String(r.pgName ?? r.pg ?? ""),
          techs: ((r.technologies as string[] | undefined) ?? []).map((t) => techInfo(t === "OTHER" ? null : t).label).join(", "),
          versions: ((r.versions as string[] | undefined) ?? []).filter(Boolean).join(", ") || "—",
          instances,
          deep,
          pct: pct(deep, instances),
          hosts: num(r.hosts),
          pgState: pgStates?.get(String(r.pg ?? "")),
        };
      }),
    [records, pgStates],
  );
  const columns = useMemo<DataTableColumnDef<GroupRow>[]>(
    () => [
      { id: "pgName", header: "Process group", accessor: "pgName", width: "2.5fr" },
      { id: "techs", header: "Technology", accessor: "techs", width: "1fr" },
      { id: "versions", header: "Versions", accessor: "versions", width: "1fr" },
      { id: "instances", header: "Instances", accessor: "instances", width: "0.8fr" },
      {
        id: "pct",
        header: "Deep monitored",
        accessor: "pct",
        width: "1.2fr",
        cell: ({ rowData }) => (
          <Text style={{ fontWeight: 600, color: statusColor(rowData.pct) }}>
            {rowData.deep} of {rowData.instances} ({rowData.pct}%)
          </Text>
        ),
      },
      { id: "hosts", header: "Hosts", accessor: "hosts", width: "0.7fr" },
      {
        id: "links",
        header: "Links",
        accessor: "pg",
        width: "1fr",
        disableSorting: true,
        cell: ({ rowData }) => <EntityLink type="PROCESS_GROUP" id={rowData.pg} label="Process group" />,
      },
      pgSettingColumn<GroupRow>(),
      {
        id: "diagnose",
        header: "Remediation",
        accessor: "pg",
        width: "1fr",
        disableSorting: true,
        cell: ({ rowData }) => <DiagnoseButton selected={rowData.pg === selectedId} onClick={() => onSelect({ kind: "group", id: rowData.pg, name: rowData.pgName })} />,
      },
    ],
    [selectedId, onSelect],
  );
  return (
    <QueryState state={state}>
      <Flex flexDirection="column" gap={8}>
        <DataTable data={rows} columns={columns} sortable fullWidth variant={{ rowDensity: "condensed" }}>
          <DataTable.EmptyState>No process groups match these filters.</DataTable.EmptyState>
          <DataTable.Pagination defaultPageSize={DEEP_PAGE_SIZE} pageSizeOptions={[DEEP_PAGE_SIZE]} />
        </DataTable>
        {rows.length >= DEEP_SEARCH_LIMIT && <Text style={hint}>Showing the first {DEEP_SEARCH_LIMIT} process groups (sorted by name); narrow the filters to find others.</Text>}
        <QueryActions title="Deep monitoring: process group search" query={query} />
      </Flex>
    </QueryState>
  );
}

function DeepSearch({ tf, technologies, selectedId, onSelect }: { tf: Timeframe; technologies: { key: string; label: string }[]; selectedId?: string; onSelect: (s: Selection) => void }) {
  const [view, setView] = useState<View>("process");
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [tech, setTech] = useState(ANY);
  const [dstate, setDstate] = useState<DeepState>("not-deep");
  const [query, setQuery] = useState<{ view: View; q: string } | null>(null);
  const reset = () => setQuery(null);
  const search = () => {
    const f = { name: name.trim(), group: group.trim(), technology: tech === ANY ? "" : tech, state: view === "process" && dstate === "partial" ? "any" : dstate };
    setQuery({ view, q: view === "process" ? deepProcessSearchQuery(tf, f) : deepGroupSearchQuery(tf, f) });
  };
  return (
    <Flex flexDirection="column" gap={16}>
      <div style={card}>
        <Heading level={4}>Find processes</Heading>
        <Flex gap={16} alignItems="flex-end" flexWrap="wrap" style={{ marginTop: Spacings.Size8 }}>
          <Field label="Show">
            <Select value={view} onChange={(v: View | null) => { if (v) { setView(v); if (v === "process" && dstate === "partial") setDstate("not-deep"); reset(); } }}>
              <Select.Content>
                <Select.Option value="process">Processes</Select.Option>
                <Select.Option value="group">Process groups</Select.Option>
              </Select.Content>
            </Select>
          </Field>
          <Field label="Process name contains">
            <TextInput value={name} placeholder="e.g. java" onChange={(v: string) => { setName(v); reset(); }} />
          </Field>
          <Field label="Process group contains">
            <TextInput value={group} placeholder="e.g. checkout" onChange={(v: string) => { setGroup(v); reset(); }} />
          </Field>
          <Field label="Technology">
            <Select value={tech} onChange={(v: string | null) => { if (v) { setTech(v); reset(); } }}>
              <Select.Content>
                <Select.Option value={ANY}>Any technology</Select.Option>
                {technologies.map((t) => (
                  <Select.Option key={t.key} value={t.key}>
                    {t.label}
                  </Select.Option>
                ))}
              </Select.Content>
            </Select>
          </Field>
          <Field label="Deep monitoring">
            <Select value={dstate} onChange={(v: DeepState | null) => { if (v) { setDstate(v); reset(); } }}>
              <Select.Content>
                {STATES.filter((s) => s.views.includes(view)).map((s) => (
                  <Select.Option key={s.value} value={s.value}>
                    {s.label}
                  </Select.Option>
                ))}
              </Select.Content>
            </Select>
          </Field>
          <ShowEntitiesButton onClick={search}>{view === "process" ? "Search processes" : "Search process groups"}</ShowEntitiesButton>
        </Flex>
        <Text style={{ ...hint, display: "block", marginTop: Spacings.Size8 }}>
          Use Diagnose on a result to check why it is (or isn&apos;t) deep monitored; the remediation section below shows the fixes for its technology and version.
        </Text>
      </div>
      {query &&
        (query.view === "process" ? (
          <ProcessResults key={query.q} query={query.q} selectedId={selectedId} onSelect={onSelect} />
        ) : (
          <GroupResults key={query.q} query={query.q} selectedId={selectedId} onSelect={onSelect} />
        ))}
    </Flex>
  );
}

// ---------------------------------------------------------------------------
// Remediation: diagnosis + actions for the selected process / process group
// ---------------------------------------------------------------------------
export const STATUS_COLOR: Record<CheckStatus, string> = { fail: statusColor(0), warn: statusColor(50), pass: statusColor(100), info: "rgba(128,128,128,0.5)" };
export const STATUS_LABEL: Record<CheckStatus, string> = { fail: "Blocking", warn: "Check", pass: "OK", info: "Info" };

const changeText = (c: DocChange) => (c.kind === "missing" ? "no longer in the docs (moved or removed)" : `updated ${c.date}`);

/** "Documentation for this fix" with the pages that changed since the catalogue review marked, plus a notice. */
export function DocsRow({ docs }: { docs: DocLink[] }) {
  const freshness = useDocsFreshness();
  const changed = changedDocs(freshness, docs);
  const changedUrls = new Map(changed.map((c) => [c.doc.url, c.change]));
  return (
    <Flex flexDirection="column" gap={6} style={{ marginTop: Spacings.Size16 }}>
      {changed.length > 0 && (
        <div role="status" style={{ padding: "6px 10px", borderRadius: 6, borderLeft: `4px solid ${statusColor(50)}`, background: "rgba(128,128,128,0.06)" }}>
          <Text style={{ fontSize: 12 }}>
            Dynatrace changed {plural(changed.length, "page")} behind this fix after this guidance was reviewed ({DOCS_REVIEWED}): {changed.map((c) => `${c.doc.title} (${changeText(c.change)})`).join(", ")}. Check {changed.length === 1 ? "it" : "them"} before acting; the steps above may be out of date.
          </Text>
        </div>
      )}
      <Flex gap={12} flexWrap="wrap" alignItems="center">
        <Text style={hint}>Documentation for this fix:</Text>
        {docs.map((d) => {
          const change = changedUrls.get(d.url);
          return (
            <a key={d.url} href={d.url} target="_blank" rel="noreferrer noopener" style={{ fontSize: 12 }}>
              ↗ {d.title}
              {change && <span style={{ color: statusColor(50), fontWeight: 600 }}> · {changeText(change)}</span>}
            </a>
          );
        })}
      </Flex>
    </Flex>
  );
}

/** Review date of the catalogue and the result of the automatic docs check. */
export function DocsStatusLine() {
  const f = useDocsFreshness();
  const outbound = settingsLink(OUTBOUND_SCHEMA);
  return (
    <Text style={{ ...hint, display: "block" }}>
      Guidance reviewed against the Dynatrace docs on {DOCS_REVIEWED}.{" "}
      {f.status === "loading" && "Checking the docs for later changes…"}
      {f.status === "ok" && (f.changes.size === 0 ? "No cited page has changed since." : `${plural(f.changes.size, "cited page")} changed since; the fixes that cite them are marked.`)}
      {f.status === "blocked" && (
        <>
          Automatic docs check off: add docs.dynatrace.com to the allowed outbound connections
          {outbound && (
            <>
              {" "}
              (<a href={outbound} target="_blank" rel="noreferrer noopener">
                setting ↗
              </a>)
            </>
          )}
          .
        </>
      )}
      {f.status === "error" && `Docs check failed: ${f.message}`}
      {(f.status === "error" || f.status === "blocked") && (
        <>
          {" "}
          <button type="button" onClick={retryDocsFreshness} style={{ background: "none", border: "none", padding: 0, color: "inherit", textDecoration: "underline", cursor: "pointer", fontSize: 12 }}>
            Retry
          </button>
        </>
      )}
    </Text>
  );
}

/** For inferred findings (no setting explains them): links to the pages that show OneAgent's own state for the process. */
function ConfirmFirst({ target, compact = false }: { target: Instance; compact?: boolean }) {
  const pages = processStatePages(target, useContext(TfContext));
  if (pages.length === 0) return null;
  return (
    <div style={{ marginTop: 6, padding: "6px 10px", borderRadius: 6, background: "rgba(69,137,255,0.08)", borderLeft: "3px solid rgba(69,137,255,0.6)" }}>
      <Text style={{ ...hint, opacity: 1, display: "block" }}>
        {compact ? "Confirm first" : "Confirm this on the process page first"}: it shows OneAgent&apos;s own monitoring state for <strong>{target.name}</strong> (for example whether it waits for a restart) before you restart anything.
      </Text>
      <Flex gap={16} flexWrap="wrap" style={{ marginTop: 2 }}>
        {pages.map((pg) => (
          <a key={pg.url} href={pg.url} target="_blank" rel="noreferrer noopener" style={{ fontSize: 12 }}>
            ↗ {pg.label}
          </a>
        ))}
      </Flex>
    </div>
  );
}

/** Display order of the diagnosis: blocking first, then checks to review, then what is in place, info last. */
const STATUS_ORDER: CheckStatus[] = ["fail", "warn", "pass", "info"];
const byStatus = <T,>(rank: (x: T) => number) => (a: T, b: T) => rank(a) - rank(b);

function CheckList({ d }: { d: Diagnosis }) {
  // Array.prototype.sort is stable, so checks keep the evaluation order within a status.
  const checks = useMemo(() => d.checks.slice().sort(byStatus((c) => STATUS_ORDER.indexOf(c.status))), [d.checks]);
  return (
    <Flex flexDirection="column" gap={6}>
      {checks.map((c) => (
        <Flex key={c.id} gap={12} alignItems="baseline" style={{ padding: "6px 12px", borderLeft: `4px solid ${STATUS_COLOR[c.status]}`, borderRadius: 4, background: "rgba(128,128,128,0.05)" }}>
          <Text style={{ fontWeight: 700, minWidth: 64, color: c.status === "info" ? undefined : STATUS_COLOR[c.status] }}>{STATUS_LABEL[c.status]}</Text>
          <div style={{ flex: 1 }}>
            <Text style={{ fontWeight: 600, display: "block" }}>{c.title}</Text>
            <Text style={hint}>{c.detail}</Text>
            {c.confirm && <ConfirmFirst target={d.target} compact />}
          </div>
        </Flex>
      ))}
    </Flex>
  );
}

/** Links to make the same change in the Dynatrace Settings UI, plus the documented click paths. */
function SettingsUiLinks({ title, links, steps }: { title: string; links: { label: string; url?: string }[]; steps: string[] }) {
  const shown = links.filter((l): l is { label: string; url: string } => !!l.url);
  return (
    <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(128,128,128,0.06)", borderLeft: "4px solid rgba(69,137,255,0.6)" }}>
      <Text style={{ fontWeight: 600, display: "block" }}>{title}</Text>
      <Flex gap={16} flexWrap="wrap" style={{ marginTop: 4 }}>
        {shown.map((l) => (
          <a key={l.url} href={l.url} target="_blank" rel="noreferrer noopener" style={{ fontSize: 12 }}>
            ↗ {l.label}
          </a>
        ))}
      </Flex>
      <details style={{ marginTop: 4 }}>
        <summary style={{ cursor: "pointer", fontSize: 12, opacity: 0.8 }}>Click path</summary>
        <ol style={{ margin: "4px 0 0", paddingLeft: 18 }}>
          {steps.map((st, n) => (
            <li key={n}>
              <Text style={hint}>{st}</Text>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

/** Shared validate / confirm / apply block used by every API fix (also on the ActiveGates tab). */
export function ApiFix({
  summary,
  request,
  confirmLabel,
  applyLabel,
  run,
  onDone,
  settingsUrl,
  ui,
}: {
  summary: React.ReactNode;
  request: { label: string; text: string };
  confirmLabel: string;
  applyLabel: string;
  run: (validateOnly: boolean) => Promise<SubmitResult>;
  onDone: () => void;
  settingsUrl?: string;
  /** Alternative: the same change in the Dynatrace UI (links + click path). */
  ui?: React.ReactNode;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const go = async (validateOnly: boolean) => {
    setBusy(true);
    const r = await run(validateOnly);
    setResult(r);
    setBusy(false);
    if (r.ok && !validateOnly) {
      setConfirm(false);
      onDone();
    }
  };
  return (
    <Flex flexDirection="column" gap={12}>
      <Text>{summary}</Text>
      {ui}
      <Request label={request.label} text={request.text} />
      {settingsUrl && (
        <a href={settingsUrl} target="_blank" rel="noreferrer noopener" style={{ fontSize: 12 }}>
          ↗ Open the setting
        </a>
      )}
      <Checkbox value={confirm} onChange={(v: boolean) => setConfirm(v)}>
        {confirmLabel}
      </Checkbox>
      <Flex gap={8}>
        <Button variant="default" disabled={busy} onClick={() => void go(true)}>
          Validate
        </Button>
        <Button variant="emphasized" disabled={busy || !confirm} onClick={() => void go(false)}>
          {applyLabel}
        </Button>
      </Flex>
      <ResultLine result={result} />
    </Flex>
  );
}

/** Turns on a Monitored technologies flag for the host or the whole environment (PUT the object at that scope, else POST). */
function SwitchFix({ state, target, onDone }: { state: SwitchState; target: Instance; onDone: () => void }) {
  const hostScope = target.host;
  // Default to where the "off" comes from: the host's own object, else the environment.
  const [scope, setScope] = useState<string>(state.hostObj && hostScope ? hostScope : "environment");
  const isEnv = scope === "environment";
  const existing = isEnv ? state.envObj : state.hostObj;
  // A host object overrides the environment completely, so it starts from the effective value; the environment from its own.
  const value = { ...(isEnv ? state.envValue : state.value), [state.sw.prop]: true };
  const where = scope === "environment" ? "the environment" : `host ${target.hostName ?? scope}`;
  return (
    <Flex flexDirection="column" gap={12}>
      {hostScope && (
        <Field label="Apply to">
          <Select value={scope} onChange={(v: string | null) => v && setScope(v)}>
            <Select.Content>
              <Select.Option value={hostScope}>This host ({target.hostName ?? hostScope})</Select.Option>
              <Select.Option value="environment">Environment (all hosts without their own setting)</Select.Option>
            </Select.Content>
          </Select>
        </Field>
      )}
      <ApiFix
        key={scope}
        summary={
          <>
            Turns on <strong>{state.sw.label}</strong> for {where} (currently off, from the {state.origin}). The process is injected at its next restart.
            {isEnv && state.hostObj && state.hostObj.value[state.sw.prop] === false ? " This host has its own setting that keeps it off, so change the host instead." : ""}
          </>
        }
        request={{ label: `Request (${existing ? "PUT" : "POST"}, 1 API call)`, text: json(existing ? { objectId: existing.objectId, value } : [{ schemaId: state.sw.schema, scope, value }]) }}
        confirmLabel={`Turn on “${state.sw.label}” for ${where}`}
        applyLabel="Turn on"
        run={(v) => upsert(state.sw.schema, scope, existing, value, v, `“${state.sw.label}” turned on. Restart the process.`)}
        onDone={onDone}
        settingsUrl={settingsLink(state.sw.schema, scope)}
      />
    </Flex>
  );
}

/** Creates a custom “Monitor” rule for a condition taken from the process metadata (host group or environment scope). */
function MonitorRuleForm({ target, onDone }: { target: Instance; onDone: () => void }) {
  const candidates = useMemo(() => ruleCandidates(target), [target]);
  const [pick, setPick] = useState("0");
  const [scope, setScope] = useState<string>(target.hostGroupId ?? "environment");
  const c = candidates[Number(pick)] ?? candidates[0];
  if (!c) return <Text>The process reports no metadata a rule can match on; set the process group to Monitor instead.</Text>;
  const broad = c.item === "EXE_NAME" || c.item === "EXE_PATH";
  const where = scope === "environment" ? "the environment" : `host group ${target.hostGroup ?? scope}`;
  return (
    <Flex flexDirection="column" gap={12}>
      <Flex gap={16} flexWrap="wrap" alignItems="flex-end">
        <Field label="Condition">
          <Select value={pick} onChange={(v: string | null) => v && setPick(v)}>
            <Select.Content>
              {candidates.map((x, n) => (
                <Select.Option key={`${x.item}-${n}`} value={String(n)}>
                  {x.label}
                </Select.Option>
              ))}
            </Select.Content>
          </Select>
        </Field>
        <Field label="Scope">
          <Select value={scope} onChange={(v: string | null) => v && setScope(v)}>
            <Select.Content>
              {target.hostGroupId && <Select.Option value={target.hostGroupId}>Host group {target.hostGroup ?? target.hostGroupId}</Select.Option>}
              <Select.Option value="environment">Environment</Select.Option>
            </Select.Content>
          </Select>
        </Field>
      </Flex>
      {broad && <Text style={{ ...hint, color: statusColor(50) }}>This condition matches every process with the same executable{c.item === "EXE_NAME" ? ` (${c.value})` : ""}; prefer a more specific condition when one is listed.</Text>}
      <ApiFix
        key={`${pick}-${scope}`}
        summary={<>Adds the rule <strong>Monitor if {c.label}</strong> for {where}. A Do-not-monitor rule earlier in the list still wins; the process is injected at its next restart.</>}
        request={{ label: "Request (POST, 1 API call)", text: json(monitorRuleBody(scope, c)) }}
        confirmLabel={`Create a Monitor rule for ${where}`}
        applyLabel="Create rule"
        run={(v) => postObjects(monitorRuleBody(scope, c), v, "Monitor rule created. Restart the process.")}
        onDone={onDone}
        settingsUrl={settingsLink(CUSTOM_RULE_SCHEMA, scope)}
      />
    </Flex>
  );
}

/** Severity group of an action in the dropdown: the most severe check it addresses; "other" = general steps. */
export type Severity = "fail" | "warn" | "info" | "other";
export type ActionDef = { id: string; label: string; kind: "api" | "manual"; node: React.ReactNode; docs: DocLink[]; severity?: Severity };
export const SEVERITY_ORDER: Severity[] = ["fail", "warn", "info", "other"];
const SEVERITY_LABEL: Record<Severity, string> = { fail: "Blocking", warn: "Check", info: "Info", other: "More steps" };

/** Checks (by their fix) each action addresses. */
const ACTION_FIXES: Record<string, FixId[]> = {
  "pg-on": ["pg-on", "disable-rules", "monitor-rule", "auto-monitoring"],
  "full-stack": ["full-stack"],
  "monitoring-mode": ["full-stack"],
  "host-pg-on": ["host-pg-on"],
  "disable-rules": ["disable-rules"],
  "auto-monitoring": ["auto-monitoring"],
  "container-tech": ["container-tech"],
  "disable-container-rules": ["disable-container-rules"],
  "monitored-tech": ["monitored-tech"],
  "dotnet-core": ["dotnet-core"],
  "go-static": ["go-static"],
  "monitor-rule": ["monitor-rule", "go-static"],
  "updates-ui": ["update-agent"],
  upgrade: ["upgrade"],
  otel: ["alternative"],
  extension: ["alternative"],
  kubernetes: ["kubernetes"],
  restart: ["restart"],
  cics: ["restart"],
};

function withSeverity(actions: ActionDef[], d: Diagnosis): ActionDef[] {
  const rated = actions.map((a) => {
    const addressed = d.checks.filter((c) => c.status !== "pass" && c.fix && (ACTION_FIXES[a.id] ?? []).includes(c.fix));
    const severity = SEVERITY_ORDER.find((sv) => addressed.some((c) => c.status === sv)) ?? "other";
    return { ...a, severity };
  });
  // Stable sort: within a group, API fixes keep their place ahead of the matching manual steps.
  return rated.sort(byStatus((a) => SEVERITY_ORDER.indexOf(a.severity)));
}

const dedupe = (docs: DocLink[]) => docs.filter((d, i) => docs.findIndex((x) => x.url === d.url) === i);
const json = (v: unknown) => JSON.stringify(v, null, 2);

/** Hosts of the instances without a code module (unique). */
const hostsOf = (d: Diagnosis) => {
  const seen = new Map<string, string>();
  for (const i of d.missing) if (i.host && !seen.has(i.host)) seen.set(i.host, i.hostName ?? i.host);
  return [...seen].map(([id, name]) => ({ id, name }));
};

/** Remediation actions for the failing checks, then the technology-specific manual steps. */
function buildActions(d: Diagnosis, onDone: () => void, tf: Timeframe): ActionDef[] {
  const t = d.target;
  const info = techInfo(t.processType);
  const techDocs = [...info.docs, ...info.external];
  const manual = (a: ManualAction): ActionDef => ({ id: a.id, label: a.title, kind: "manual", node: <ManualActionView action={a} />, docs: dedupe([...a.docs, ...techDocs]) });
  const api = (id: string, label: string, node: React.ReactNode, docs: DocLink[]): ActionDef => ({ id, label, kind: "api", node, docs: dedupe([...docs, ...techDocs]) });
  // Fixes for blocking checks, plus optional ones attached to info checks (for example monitoring a process a built-in rule skips).
  const fixes = new Set(d.checks.filter((c) => c.status !== "pass").map((c) => c.fix).filter((f): f is FixId => !!f));
  const out: ActionDef[] = [];
  // Blocking checks a process-group Monitor setting does not lift; listed in the action so it is not mistaken for a full fix.
  const NOT_LIFTED: Record<string, string> = { mode: "Full-Stack mode", switch: "the Monitored technologies switch", "dotnet-core": "Enable .NET Core", container: "container injection", "container-rules": "container rules", k8s: "Operator namespace selection", "min-agent": "the OneAgent version", "decide-host-pg-off": "the host-level setting" };
  const stillBlocked = d.checks.filter((c) => c.status === "fail" && NOT_LIFTED[c.id]).map((c) => NOT_LIFTED[c.id]);
  const pgStateLabel = d.pgState === "MONITORING_OFF" ? "Do not monitor" : d.pgState === "MONITORING_ON" ? "Monitor" : "Default";
  const pgOn = () =>
    api(
      "pg-on",
      "Enable deep monitoring for the process group",
      <ApiFix
        summary={
          <>
            Sets process group <strong>{t.pgName}</strong> to <strong>Monitor</strong> (now: {pgStateLabel}) with one Settings API POST. Monitor on the process group wins over Do-not-monitor rules, built-in exclusions, a missing Monitor rule and the automatic setting, and applies to every instance of the group
            {d.instances.length > 1 ? ` (${plural(d.instances.length, "instance")})` : ""}. The processes get a code module at their next restart.
            {d.pgObject ? " The group already has a setting; if the POST is rejected for that reason, the same value is written with one PUT." : ""}
            {stillBlocked.length ? ` It does not change ${stillBlocked.join(", ")}: fix ${stillBlocked.length === 1 ? "that" : "those"} too.` : ""}
          </>
        }
        ui={
          <SettingsUiLinks
            title="Or enable it in the Dynatrace UI"
            links={[
              { label: `Process group monitoring for ${t.pgName} (Settings)`, url: settingsLink(PG_STATE_SCHEMA, t.pg) },
              { label: "Same in Settings Classic", url: settingsClassicLink(PG_STATE_SCHEMA, t.pg) },
              ...hostsOf(d)
                .slice(0, 3)
                .map((h) => ({ label: `Process group monitoring on host ${h.name}`, url: settingsLink(HOST_PG_STATE_SCHEMA, h.id) })),
              { label: "Process group page", url: entityOverviewLink("PROCESS_GROUP", t.pg, tf) },
            ]}
            steps={[
              `Process group: open the first link and set Monitoring state to Monitor for ${t.pgName}, then save.`,
              "One host only: Hosts Classic > the host > More (…) > Settings > Process group monitoring > Add process group > pick the process group > Monitoring state: Monitor.",
              "Whole environment (all new processes): Settings > Processes and containers > Process group monitoring > Enable automatic deep monitoring.",
              "Rule-based: Settings > Processes and containers > Custom process monitoring rules > Add item > Mode: Monitor, with a condition that matches the process.",
              "Restart the processes afterwards: the code module is loaded at process start.",
            ]}
          />
        }
        request={{ label: "Request (POST /settings/objects, 1 API call)", text: json(pgOnBody(t.pg)) }}
        confirmLabel={`Enable deep monitoring for process group ${t.pgName}`}
        applyLabel="Enable deep monitoring"
        run={(v) => enablePgDeepMonitoring(t.pg, d.pgObject, v)}
        onDone={onDone}
      />,
      [DEEP_DOCS.pgMonitoring, DEEP_DOCS.deepMonitoring, DEEP_DOCS.restart],
    );
  // The most targeted fix goes first whenever it applies.
  if (d.pgOnRelevant) out.push(pgOn());

  if (fixes.has("full-stack")) {
    const hostIds = [...new Set(d.notFullStack.map((i) => i.host).filter((h): h is string => !!h))];
    out.push(
      api(
        "full-stack",
        "Switch hosts to Full-Stack (Settings API)",
        <ApiFix
          summary={<>Switches {plural(hostIds.length, "host")} ({d.notFullStack.map((i) => i.hostName).filter(Boolean).slice(0, 3).join(", ")}) to <strong>Full-Stack</strong> mode. This raises license consumption; processes are injected after a restart.</>}
          request={{ label: `Request (1 API call for ${plural(hostIds.length, "host")})`, text: json(buildModeBody(hostIds.slice(0, 2), "FULL_STACK")) + (hostIds.length > 2 ? `\n// … ${hostIds.length - 2} more objects in the same request` : "") }}
          confirmLabel={`Change ${plural(hostIds.length, "host")} to Full-Stack`}
          applyLabel="Change mode"
          run={(v) => setMonitoringModes(hostIds, "FULL_STACK", v)}
          onDone={onDone}
        />,
        [DEEP_DOCS.monitoringModes, ...MODE_DOCS],
      ),
      manual(monitoringModeAction),
    );
  }
  if (fixes.has("host-pg-on")) {
    out.push(
      api(
        "host-pg-on",
        "Re-enable the process group on its hosts",
        <ApiFix
          summary={<>Sets the host-level override for <strong>{t.pgName}</strong> back to Monitor on {plural(d.hostPgOff.length, "host")}.</>}
          request={{ label: `Request (PUT, ${plural(d.hostPgOff.length, "API call")}: one per host override)`, text: json(d.hostPgOff.slice(0, 2).map((o) => ({ objectId: o.objectId, value: { ...o.value, MonitoringState: "MONITORING_ON" } }))) }}
          confirmLabel={`Turn monitoring back on for this process group on ${plural(d.hostPgOff.length, "host")}`}
          applyLabel="Set to Monitor"
          run={(v) => setHostPgMonitoringOn(d.hostPgOff, v)}
          onDone={onDone}
          settingsUrl={d.hostPgOff[0] ? settingsLink(HOST_PG_STATE_SCHEMA, d.hostPgOff[0].scope) : undefined}
        />,
        [DEEP_DOCS.hostPgMonitoring, DEEP_DOCS.deepMonitoring, DEEP_DOCS.restart],
      ),
    );
  }
  if (fixes.has("disable-rules")) {
    out.push(
      api(
        "disable-rules",
        "Disable the excluding custom rules",
        <ApiFix
          summary={<>Disables {plural(d.offRules.length, "rule")} (kept, so they can be turned back on): {d.offRules.map(ruleText).join("; ")}. Disabling a rule affects every process it matches; to keep the rule, set just this process group to Monitor instead.</>}
          request={{ label: `Request (PUT, ${plural(d.offRules.length, "API call")}: one per rule)`, text: json(d.offRules.map((r) => ({ objectId: r.objectId, value: { ...r.value, enabled: false } }))) }}
          confirmLabel={`Disable ${plural(d.offRules.length, "custom process monitoring rule")}`}
          applyLabel="Disable rules"
          run={(v) => disableRules(d.offRules, v)}
          onDone={onDone}
          settingsUrl={settingsLink(CUSTOM_RULE_SCHEMA)}
        />,
        [DEEP_DOCS.customRules, DEEP_DOCS.restart],
      ),
    );
  }
  if (fixes.has("auto-monitoring")) {
    const scope = d.auto.obj?.scope ?? "environment";
    out.push(
      api(
        "auto-monitoring",
        `Enable automatic deep monitoring (${d.auto.origin})`,
        <ApiFix
          summary={<>Turns on <strong>Enable automatic deep monitoring</strong> for the {d.auto.origin}. Every new process in that scope is then deep monitored; to change only this process group, set it to Monitor instead.</>}
          request={{ label: `Request (${d.auto.obj ? "PUT" : "POST"}, 1 API call)`, text: json(d.auto.obj ? { objectId: d.auto.obj.objectId, value: { autoMonitoring: true } } : [{ schemaId: AUTO_MONITORING_SCHEMA, scope, value: { autoMonitoring: true } }]) }}
          confirmLabel={`Deep monitor all processes in the ${d.auto.origin} automatically`}
          applyLabel="Enable"
          run={(v) => upsert(AUTO_MONITORING_SCHEMA, scope, d.auto.obj, { autoMonitoring: true }, v, "Automatic deep monitoring enabled. Restart processes to inject them.")}
          onDone={onDone}
          settingsUrl={settingsLink(AUTO_MONITORING_SCHEMA, scope === "environment" ? undefined : scope)}
        />,
        [DEEP_DOCS.processMonitoring, DEEP_DOCS.restart],
      ),
    );
  }
  if (fixes.has("container-tech") && d.container) {
    const c = d.container;
    const value = { ...c.value, [c.key]: true };
    const where = c.origin === "default" ? "environment" : c.origin;
    out.push(
      api(
        "container-tech",
        `Enable injection into ${CONTAINER_LABELS[c.key]} containers`,
        <ApiFix
          summary={<>Turns on code-module injection for <strong>{CONTAINER_LABELS[c.key]}</strong> containers for the {where}; the other container technologies keep their current values.</>}
          request={{ label: `Request (${c.obj ? "PUT" : "POST"}, 1 API call)`, text: json(c.obj ? { objectId: c.obj.objectId, value } : [{ schemaId: CONTAINER_TECH_SCHEMA, scope: c.scope, value }]) }}
          confirmLabel={`Inject code modules into ${CONTAINER_LABELS[c.key]} containers (${where})`}
          applyLabel="Enable"
          run={(v) => upsert(CONTAINER_TECH_SCHEMA, c.scope, c.obj, value, v, `Injection into ${CONTAINER_LABELS[c.key]} containers enabled. Restart the containers.`)}
          onDone={onDone}
          settingsUrl={settingsLink(CONTAINER_TECH_SCHEMA, c.scope === "environment" ? undefined : c.scope)}
        />,
        [DEEP_DOCS.containers, DEEP_DOCS.restart],
      ),
    );
  }
  if (fixes.has("disable-container-rules")) {
    out.push(
      api(
        "disable-container-rules",
        "Disable the excluding container rules",
        <ApiFix
          summary={<>Disables {plural(d.offContainerRules.length, "container monitoring rule")}: {d.offContainerRules.map(ruleText).join("; ")}. This affects every container the rules match.</>}
          request={{ label: `Request (PUT, ${plural(d.offContainerRules.length, "API call")}: one per rule)`, text: json(d.offContainerRules.map((r) => ({ objectId: r.objectId, value: { ...r.value, enabled: false } }))) }}
          confirmLabel={`Disable ${plural(d.offContainerRules.length, "container monitoring rule")}`}
          applyLabel="Disable rules"
          run={(v) => disableRules(d.offContainerRules, v)}
          onDone={onDone}
          settingsUrl={settingsLink(CONTAINER_RULE_SCHEMA)}
        />,
        [DEEP_DOCS.containers, DEEP_DOCS.restart],
      ),
    );
  }
  const switchFix = (id: FixId, s: SwitchState | undefined) => {
    if (!fixes.has(id) || !s) return;
    out.push(api(id, `Turn on “${s.sw.label}”`, <SwitchFix state={s} target={t} onDone={onDone} />, [s.sw.doc, DEEP_DOCS.restart]));
  };
  switchFix("monitored-tech", d.switches.tech);
  switchFix("dotnet-core", d.switches.dotnetCore);
  if (fixes.has("monitor-rule")) {
    out.push(api("monitor-rule", "Create a Monitor rule for this process", <MonitorRuleForm target={t} onDone={onDone} />, [DEEP_DOCS.customRules, DEEP_DOCS.deepMonitoring, DEEP_DOCS.restart]));
  }
  if (fixes.has("go-static") && d.switches.goStatic) {
    switchFix("go-static", d.switches.goStatic);
    if (!out.some((a) => a.id === "monitor-rule")) out.push(api("monitor-rule", "Create a Monitor rule for this binary", <MonitorRuleForm target={t} onDone={onDone} />, [DEEP_DOCS.goEnable, DEEP_DOCS.customRules]));
  }
  if (fixes.has("update-agent")) out.push(manual({ ...updatesUiAction, docs: [...UPDATE_DOCS, ...updatesUiAction.docs] }));
  if (fixes.has("upgrade")) out.push(manual(upgradeAction(info, t, d.support)));
  if (fixes.has("alternative") || (info.kind === "none" && info.alternativeKind !== "system")) out.push(manual(alternativeAction(info)));
  if (fixes.has("kubernetes") || (d.missing.length > 0 && t.kubernetes)) out.push(manual(kubernetesAction(t)));
  if (info.kind === "deep") {
    const restart = manual(restartAction(info, t));
    const inferred = d.checks.some((c) => c.confirm && c.fix === "restart");
    out.push(
      inferred
        ? {
            ...restart,
            node: (
              <Flex flexDirection="column" gap={12}>
                <ConfirmFirst target={t} />
                {restart.node}
              </Flex>
            ),
          }
        : restart,
    );
  }
  return withSeverity(out.filter((a, i) => out.findIndex((x) => x.id === a.id) === i), d);
}

const option = (a: ActionDef) => (
  <Select.Option key={a.id} value={a.id}>
    {a.kind === "api" ? "API · " : "Manual · "}
    {a.label}
  </Select.Option>
);

export function ActionPicker({ actions }: { actions: ActionDef[] }) {
  const [pick, setPick] = useState("");
  const active = actions.find((a) => a.id === pick) ?? actions[0];
  if (!active) return null;
  return (
    <>
      <Flex justifyContent="flex-end" style={{ marginTop: Spacings.Size12 }}>
        <Field label="Action">
          <Select value={active.id} onChange={(v: string | null) => v && setPick(v)}>
            <Select.Content>
              {actions.some((a) => a.severity)
                ? SEVERITY_ORDER.filter((sv) => actions.some((a) => a.severity === sv)).map((sv) => (
                    <Select.Group key={sv}>
                      <Select.GroupLabel>{SEVERITY_LABEL[sv]}</Select.GroupLabel>
                      {actions.filter((a) => a.severity === sv).map(option)}
                    </Select.Group>
                  ))
                : actions.map(option)}
            </Select.Content>
          </Select>
        </Field>
      </Flex>
      <div style={{ marginTop: Spacings.Size12 }} key={active.id}>
        {active.node}
      </div>
      {active.docs.length > 0 && <DocsRow docs={active.docs} />}
    </>
  );
}

/** Generic actions shown before anything is selected. */
function AutoMonitoringEnvForm() {
  const [obj, setObj] = useState<{ objectId: string; updateToken?: string; scope: string; value: Record<string, any> } | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    settingsObjectsClient
      .getSettingsObjects({ schemaIds: AUTO_MONITORING_SCHEMA, scopes: "environment", fields: "objectId,scope,value,updateToken" })
      .then((r) => {
        if (cancelled) return;
        const o = r.items?.[0];
        setObj(o ? { objectId: String(o.objectId), updateToken: o.updateToken, scope: String(o.scope), value: (o.value ?? {}) as Record<string, any> } : null);
      })
      .catch((e) => !cancelled && (setObj(null), setError((e as any)?.message ?? String(e))));
    return () => {
      cancelled = true;
    };
  }, [tick]);
  if (obj === undefined) return <Text>Reading the current setting…</Text>;
  const on = obj ? obj.value.autoMonitoring !== false : true;
  return (
    <Flex flexDirection="column" gap={12}>
      {error && <Text style={{ color: "#C21930" }}>Could not read the setting: {error}</Text>}
      <Text>
        Environment-wide automatic deep monitoring: <strong>{on ? "on" : "off"}</strong>
        {obj ? "" : " (default)"}. Host groups can override it.
      </Text>
      {on ? (
        <Text style={hint}>Already on. Use the search above and Diagnose to find what blocks a specific process.</Text>
      ) : (
        <ApiFix
          summary="Deep monitors every new process in the environment automatically (host groups with their own setting keep it)."
          request={{ label: `Request (${obj ? "PUT" : "POST"}, 1 API call)`, text: json(obj ? { objectId: obj.objectId, value: { autoMonitoring: true } } : [{ schemaId: AUTO_MONITORING_SCHEMA, scope: "environment", value: { autoMonitoring: true } }]) }}
          confirmLabel="Turn on automatic deep monitoring for the environment"
          applyLabel="Enable"
          run={(v) => upsert(AUTO_MONITORING_SCHEMA, "environment", obj ?? undefined, { autoMonitoring: true }, v, "Automatic deep monitoring enabled. Restart processes to inject them.")}
          onDone={() => setTick((n) => n + 1)}
          settingsUrl={settingsLink(AUTO_MONITORING_SCHEMA)}
        />
      )}
    </Flex>
  );
}

function genericActions(): ActionDef[] {
  return [
    { id: "auto-env", label: "Enable automatic deep monitoring (environment)", kind: "api", node: <AutoMonitoringEnvForm />, docs: [DEEP_DOCS.processMonitoring, DEEP_DOCS.restart] },
    ...GENERIC_ACTIONS.map((a): ActionDef => ({ id: a.id, label: a.title, kind: "manual", node: <ManualActionView action={a} />, docs: a.docs })),
  ];
}

/** The supported-version check comes from these pages; flag it when they changed after the review. */
function TechDocsNotice({ docs, label }: { docs: DocLink[]; label: string }) {
  const changed = changedDocs(useDocsFreshness(), docs);
  if (changed.length === 0) return null;
  return (
    <div role="status" style={{ padding: "6px 10px", borderRadius: 6, borderLeft: `4px solid ${statusColor(50)}`, background: "rgba(128,128,128,0.06)" }}>
      <Text style={{ fontSize: 12 }}>
        The {label} support {changed.length === 1 ? "page" : "pages"} changed after this catalogue was reviewed ({DOCS_REVIEWED}), so the supported-version check below may be out of date:{" "}
        {changed.map((c, n) => (
          <React.Fragment key={c.doc.url}>
            {n > 0 && ", "}
            <a href={c.doc.url} target="_blank" rel="noreferrer noopener">
              {c.doc.title} ↗
            </a>{" "}
            ({changeText(c.change)})
          </React.Fragment>
        ))}
        .
      </Text>
    </div>
  );
}

/** For IIS service hosts: the w3wp.exe worker processes on the same hosts, which is where OneAgent instruments IIS. */
function IisWorkers({ tf, hostIds }: { tf: Timeframe; hostIds: string[] }) {
  const query = useMemo(() => (hostIds.length ? iisWorkersQuery(tf, hostIds.slice(0, 50)) : null), [tf, hostIds]);
  const state = useDql(query);
  const records = state.data?.records;
  const workers = useMemo(() => (records ?? []).map(toInstance), [records]);
  if (!query) return null;
  return (
    <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(128,128,128,0.06)", borderLeft: `4px solid ${statusColor(100)}` }}>
      <Text style={{ fontWeight: 600, display: "block" }}>IIS worker processes on {hostIds.length === 1 ? "this host" : "these hosts"}</Text>
      <QueryState state={state}>
        {workers.length === 0 ? (
          <Text style={hint}>No IIS app pool processes found on {hostIds.length === 1 ? "this host" : "these hosts"} in the timeframe.</Text>
        ) : (
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {workers.map((w) => (
              <li key={w.id}>
                <Text style={{ fontSize: 12 }}>
                  <strong>{w.name}</strong> on {w.hostName ?? w.host}:{" "}
                  <span style={{ color: statusColor(w.deep ? 100 : 0), fontWeight: 600 }}>{w.deep ? "deep monitored" : "not deep monitored"}</span>
                  {w.evidence.length ? ` (${w.evidence.join("; ")})` : ""}
                </Text>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
      <QueryActions title="IIS worker processes" query={query} />
    </div>
  );
}

function SelectedRemediation({ tf, selection, onSummary }: { tf: Timeframe; selection: Selection; onSummary: (s: DeepSelection | null) => void }) {
  const query = useMemo(() => deepDetailQuery(tf, selection), [tf, selection]);
  const state = useDql(query);
  const records = state.data?.records;
  const instances = useMemo<Instance[]>(() => (records ?? []).map(toInstance), [records]);
  // Content signature: the settings read re-runs only when the instances really change (or after a fix), never per render.
  const signature = useMemo(() => instances.map((i) => `${i.id}:${i.deep ? 1 : 0}`).join(","), [instances]);
  const [settings, setSettings] = useState<DeepSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const latest = useRef(instances);
  latest.current = instances;

  useEffect(() => {
    if (!signature) return;
    let cancelled = false;
    setSettings(null);
    setSettingsError(null);
    readDeepSettings(latest.current)
      .then((s) => !cancelled && setSettings(s))
      .catch((e) => {
        if (cancelled) return;
        setSettingsError((e as any)?.message ?? String(e));
        setSettings(EMPTY_SETTINGS);
      });
    return () => {
      cancelled = true;
    };
  }, [signature, tick]);

  const diagnosis = useMemo(() => (settings && instances.length ? diagnose(instances, settings) : null), [settings, instances]);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const actions = useMemo(() => (diagnosis ? buildActions(diagnosis, refresh, tf) : []), [diagnosis, refresh, tf]);

  useEffect(() => {
    onSummary(diagnosis ? { name: selection.name, deep: diagnosis.missing.length === 0, failing: diagnosis.checks.filter((c) => c.status === "fail" && c.id !== "injected").map((c) => c.title) } : null);
  }, [diagnosis, selection.name, onSummary]);

  const t = diagnosis?.target;
  const info = techInfo(t?.processType ?? null);
  return (
    <QueryState state={state}>
      {instances.length === 0 ? (
        <Text>The selected {selection.kind === "group" ? "process group" : "process"} was not found in this timeframe.</Text>
      ) : !diagnosis || !t ? (
        <Text>Reading the monitoring settings…</Text>
      ) : (
        <Flex flexDirection="column" gap={12}>
          <Text style={{ opacity: 0.8 }}>
            <strong>{selection.name}</strong> · {info.label}
            {t.version ? ` ${t.version}` : ""}
            {t.vendor ? ` (${t.vendor})` : ""} · {selection.kind === "group" ? `${diagnosis.instances.length - diagnosis.missing.length} of ${plural(diagnosis.instances.length, "instance")} deep monitored` : diagnosis.missing.length ? "not deep monitored" : "deep monitored"}
            {diagnosis.instances.length >= 200 ? " (first 200 instances)" : ""}
          </Text>
          {settingsError && <Text style={{ color: "#C21930" }}>Could not read the monitoring settings ({settingsError}); setting checks are incomplete.</Text>}
          <TechDocsNotice docs={info.docs} label={info.label} />
          {t.processType === "IIS_SERVICE_HOST" && <IisWorkers tf={tf} hostIds={[...new Set(diagnosis.instances.map((i) => i.host).filter((h): h is string => !!h))]} />}
          <CheckList d={diagnosis} />
          <ActionPicker key={`${selection.id}-${tick}`} actions={actions} />
          <QueryActions title={`Deep monitoring detail: ${selection.name}`} query={query} />
        </Flex>
      )}
    </QueryState>
  );
}

function DeepRemediation({ tf, selection, onSummary, onClear }: { tf: Timeframe; selection: Selection | null; onSummary: (s: DeepSelection | null) => void; onClear: () => void }) {
  const generic = useMemo(() => genericActions(), []);
  return (
    <div id={DEEP_ANCHOR} style={{ ...card, marginTop: Spacings.Size16 }}>
      <Flex justifyContent="space-between" alignItems="flex-end" flexWrap="wrap" gap={12}>
        <div>
          <Heading level={3} style={{ margin: 0 }}>
            Remediation actions
          </Heading>
          <Text style={{ opacity: 0.8 }}>
            {selection ? `Why the selected ${selection.kind === "group" ? "process group" : "process"} is or isn't deep monitored, and how to fix it.` : "Select Diagnose on a process or process group above for checks and fixes specific to its technology and version."}
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
        {selection ? <SelectedRemediation key={`${selection.kind}-${selection.id}`} tf={tf} selection={selection} onSummary={onSummary} /> : <ActionPicker actions={generic} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab
// ---------------------------------------------------------------------------
export function DeepMonitoringTab({ tf }: { tf: Timeframe }) {
  const query = deepCoverageQuery(tf);
  const coverage = useDql(query);
  const { scored, notScored } = useTechRows(coverage.data?.records);
  const technologies = useMemo(() => [...scored, ...notScored].map((r) => ({ key: r.key, label: r.label })).sort((a, b) => a.label.localeCompare(b.label)), [scored, notScored]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [summary, setSummary] = useState<DeepSelection | null>(null);
  const select = useCallback((s: Selection) => {
    setSelection(s);
    setTimeout(() => document.getElementById(DEEP_ANCHOR)?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  }, []);
  const clear = useCallback(() => {
    setSelection(null);
    setSummary(null);
  }, []);
  const { panel: aiPanel } = useAIInsights(useCallback(() => analyzeDeepMonitoring(scored, notScored, summary), [scored, notScored, summary]));

  return (
    <TfContext.Provider value={tf}>
    <Flex flexDirection="column" gap={16}>
      {aiPanel}
      <Heading level={3}>Deep monitoring</Heading>
      <Text>
        Share of processes with a OneAgent code module (deep monitoring: traces, services and code-level metrics), per technology. A process counts as deep monitored when it shows evidence only a code module produces: the OneAgent version that injected it, services a code module detected on it, or code-module runtime metrics (dt.runtime.*) on a host that is not in Infrastructure or Discovery mode.
      </Text>
      <QueryState state={coverage}>
        <TechGaugeGrid scored={scored} notScored={notScored} />
      </QueryState>
      <QueryActions title="Deep monitoring by technology" query={query} />
      <DeepSearch tf={tf} technologies={technologies} selectedId={selection?.id} onSelect={select} />
      <DeepRemediation tf={tf} selection={selection} onSummary={setSummary} onClear={clear} />
    </Flex>
    </TfContext.Provider>
  );
}
