import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { ToggleButtonGroup } from "@dynatrace/strato-components/forms";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { MessageContainer } from "@dynatrace/strato-components/content";
import { useCurrentTheme } from "@dynatrace/strato-components/core";
import Colors from "@dynatrace/strato-design-tokens/colors";
import Spacings from "@dynatrace/strato-design-tokens/spacings";
import Borders from "@dynatrace/strato-design-tokens/borders";
import { useDql } from "../useDql";
import { useAIInsights } from "../AIInsights";
import { analyzeExtensions } from "../analyses";
import {
  EXT_REC_LIMIT,
  EXT_SCOPE_LOOKBACK,
  activeGateExtensionEventsQuery,
  activeGateExtensionsQuery,
  activeGatesQuery,
  dbAgGroupsQuery,
  extensionFastcheckQuery,
  extensionRecProcessesQuery,
  extensionRecommendationsQuery,
  extensionScopeNamesQuery,
  localExtensionStatusQuery,
  refreshMarker,
  type Timeframe,
} from "../queries";
import { PctGauge, QueryActions, QueryState, formatMode, pct } from "../components";
import { ManualActionView } from "../RemediationPanel";
import type { ManualAction } from "../remediation";
import { categoryColor, type Theme } from "../kubernetes";
import { entityOverviewLink, extensionAppLink, hostGroupLink, hubSearchLink } from "../links";
import { extError, toAgGroup, type AgGroup, type Loaded } from "../databases";
import { ActionPicker, DocsStatusLine, STATUS_COLOR, STATUS_LABEL, type ActionDef, type Severity } from "./DeepMonitoringTab";
import { Donut, type Slice } from "./ModePie";
import { ExtNameCell, extColor } from "./ActiveGatesTab";
import { STATUS_PALETTE } from "./AgCharts";
import {
  FASTCHECK_LABEL,
  KINDS,
  configActions,
  day,
  diagnoseConfig,
  fastcheckReason,
  genericExtActions,
  isBroken,
  isJudged,
  kindInfo,
  mergeConfigs,
  readAllConfigs,
  recAdvice,
  scopeIds,
  snmpRows,
  statusText,
  toFastcheck,
  toRecRows,
  toScopeInfo,
  type ApiConfigs,
  type ExtCheck,
  type FastcheckResult,
  type FastcheckRow,
  type MonConfig,
  type RecRow,
  type ScopeInfo,
  type SnmpRow,
  type SnmpState,
} from "../extensions";

// ---------------------------------------------------------------------------
// Extensions tab: broken monitoring configurations with their fastcheck results, local vs remote configurations (and
// where each local one is scoped), and extension recommendations for technologies OneAgent sees on processes.
// ---------------------------------------------------------------------------

const card: React.CSSProperties = { padding: Spacings.Size16, borderRadius: Borders.Radius.Container.Default, background: Colors.Background.Container.Neutral.Default };
const hint: React.CSSProperties = { fontSize: 12, opacity: 0.7 };
// The default link blue is unreadable in dark mode (same as the ActiveGates tab).
const linkStyle: React.CSSProperties = { color: "inherit", textDecoration: "underline", textUnderlineOffset: 2 };
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const EXT_ANCHOR = "remediation-extensions";
const FASTCHECK_ANCHOR = "extensions-fastcheck";
const RECS_ANCHOR = "extensions-recommendations";
const DONUT_SIZE = 150;
const PAGE_SIZE = 25;
const scrollTo = (id: string) => setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
const shortExt = (name: string) => name.replace(/^com\.dynatrace\.(extensions?\.)?/, "");
const configName = (c: MonConfig) => (c.description ? `${shortExt(c.extension)} · ${c.description}` : shortExt(c.extension));

// Small stable hash so the scope-name query can mark which ID list its result belongs to.
const hashOf = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

// ---------------------------------------------------------------------------
// Data: the ActiveGates tab's extension queries (remote configurations, latest framework message, ActiveGate names),
// local statuses, fastcheck results, Extensions-module groups and recommendations, plus every configuration from the
// Extensions API (scope, activation context, enabled).
// ---------------------------------------------------------------------------
function useExtensionsData(tf: Timeframe) {
  // Re-check appends a DQL comment so the queries run again after a configuration was fixed.
  const [tick, setTick] = useState(0);
  const queries = useMemo(
    () => ({
      remote: activeGateExtensionsQuery(tf),
      local: localExtensionStatusQuery(tf),
      events: activeGateExtensionEventsQuery(tf),
      fastcheck: extensionFastcheckQuery(tf),
      groups: dbAgGroupsQuery(tf),
      ags: activeGatesQuery(tf),
      recs: extensionRecommendationsQuery(tf),
    }),
    [tf],
  );
  const m = refreshMarker(tick);
  const remote = useDql(queries.remote + m);
  const local = useDql(queries.local + m);
  const events = useDql(queries.events + m);
  const fastcheckState = useDql(queries.fastcheck + m);
  const groupsState = useDql(queries.groups);
  const agsState = useDql(queries.ags);
  const recsState = useDql(queries.recs + m);

  const [api, setApi] = useState<Loaded<ApiConfigs>>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    // Keep the previous list on screen while re-reading.
    setApi((prev) => (prev.status === "ok" ? prev : { status: "loading" }));
    readAllConfigs().then(
      (value) => !cancelled && setApi({ status: "ok", value }),
      (e) => !cancelled && setApi({ status: "error", message: extError(e, "extensions:definitions:read") }),
    );
    return () => {
      cancelled = true;
    };
  }, [tick]);
  const apiValue = api.status === "ok" ? api.value : null;

  const fastcheck = useMemo<FastcheckRow[]>(() => (fastcheckState.data?.records ?? []).map(toFastcheck), [fastcheckState.data]);
  const configs = useMemo(
    () => mergeConfigs({ api: apiValue, remote: remote.data?.records ?? [], local: local.data?.records ?? [], events: events.data?.records ?? [], fastcheck }),
    [apiValue, remote.data, local.data, events.data, fastcheck],
  );
  // Names of the scoped hosts and host groups: one query keyed on the IDs. A marker row tells which ID list the result
  // belongs to, so a stale or placeholder result never reads as "host not seen".
  const ids = useMemo(() => scopeIds(configs), [configs]);
  const marker = hashOf(ids.join(","));
  const namesQuery = ids.length ? `${extensionScopeNamesQuery(ids)}\n| append [data record(id = "#ids", name = "${marker}")]` : null;
  const names = useDql(namesQuery);
  const scopesLoaded = !namesQuery || (!names.loading && !!names.data?.records.some((r) => r.id === "#ids" && r.name === marker));
  const scopes = useMemo(() => new Map<string, ScopeInfo>((names.data?.records ?? []).filter((r) => r.id !== "#ids").map(toScopeInfo).map((s) => [s.id, s])), [names.data]);
  const groups = useMemo<AgGroup[] | null>(() => (groupsState.data ? groupsState.data.records.map(toAgGroup) : null), [groupsState.data]);
  const agNames = useMemo(() => new Map<string, string>((agsState.data?.records ?? []).map((r) => [String(r.agId), String(r.name ?? r.agId)])), [agsState.data]);
  const recs = useMemo<RecRow[]>(() => toRecRows(recsState.data?.records ?? [], apiValue, configs), [recsState.data, apiValue, configs]);
  // SNMP is judged from extensions and configurations only; wait for the API so "not in use" is never a guess.
  const snmp = useMemo<SnmpRow[]>(() => (api.status === "loading" ? [] : snmpRows(apiValue, configs)), [api.status, apiValue, configs]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return {
    tf,
    queries: { ...queries, names: namesQuery },
    states: { remote, local, events, fastcheck: fastcheckState, groups: groupsState, recs: recsState, names },
    api,
    configs,
    fastcheck,
    scopes,
    scopesLoaded,
    groups,
    agNames,
    recs,
    snmp,
    reload,
  };
}
type ExtData = ReturnType<typeof useExtensionsData>;

/** A host scope that was not seen in the last 30 days (only once the names query answered). */
const staleScope = (c: MonConfig, d: ExtData) => c.enabled && !c.gone && d.scopesLoaded && (c.scopeType === "host" || c.scopeType === "host_group") && !d.scopes.get(c.scopeId)?.name;

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------
const statusTone = (s: string) => (s === "DISABLED" || s === "NOT_REPORTED" ? STATUS_PALETTE.neutral : s === "NO_DATA" ? STATUS_PALETTE.serious : extColor(s));
const statusGlyph = (s: string) => (s === "OK" ? "✓" : s === "IDLE" || s === "DISABLED" || s === "NOT_REPORTED" ? "•" : s === "WARNING" ? "–" : "!");

function Glyph({ color, glyph, dark = false }: { color: string; glyph: string; dark?: boolean }) {
  return (
    <span aria-hidden style={{ width: 14, height: 14, borderRadius: 4, flex: "none", background: color, color: dark ? "#1a1a19" : "#fff", fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      {glyph}
    </span>
  );
}

function StatusCell({ c }: { c: MonConfig }) {
  return (
    <Flex gap={6} alignItems="flex-start">
      <Glyph color={statusTone(c.status)} glyph={statusGlyph(c.status)} dark={c.status === "WARNING"} />
      <div style={{ minWidth: 0 }}>
        <Text style={{ fontSize: 12, fontWeight: 700, display: "block", wordBreak: "break-word" }}>{c.status}</Text>
        <Text style={{ fontSize: 11, opacity: 0.75, display: "block" }}>
          {statusText(c)}
          {c.statusSource === "event" ? " (latest framework event)" : ""}
        </Text>
      </div>
    </Flex>
  );
}

function ExtensionCell({ c }: { c: MonConfig }) {
  return (
    <div style={{ minWidth: 0 }}>
      <ExtNameCell c={c} />
      {c.description && <Text style={{ fontSize: 11, opacity: 0.8, display: "block", wordBreak: "break-word" }}>{c.description}</Text>}
    </div>
  );
}

function A({ url, children }: { url?: string; children: React.ReactNode }) {
  return url ? (
    <a href={url} target="_blank" rel="noreferrer noopener" style={linkStyle}>
      {children}
    </a>
  ) : (
    <>{children}</>
  );
}

/** Where the configuration is assigned: host or host group with a link, environment without one, ActiveGate group, cluster, cloud. */
function ScopeCell({ c, d, showKind = true }: { c: MonConfig; d: ExtData; showKind?: boolean }) {
  const s = d.scopes.get(c.scopeId);
  const stale = staleScope(c, d);
  const line = (() => {
    switch (c.scopeType) {
      case "host":
        return (
          <>
            Host <A url={entityOverviewLink("HOST", c.scopeId, d.tf)}>{s?.name ?? c.scopeId} ↗</A>
          </>
        );
      case "host_group":
        return (
          <>
            Host group <A url={hostGroupLink(c.scopeId, d.tf)}>{s?.name ?? c.scopeId} ↗</A>
            {s?.hosts !== undefined ? <span style={{ opacity: 0.7 }}> · {plural(s.hosts, "host")}</span> : null}
          </>
        );
      case "environment":
        return <>Environment (every host)</>;
      case "management_zone":
        return <>Management zone {c.scopeId}</>;
      case "ag_group":
        return <>ActiveGate group {c.scopeId || c.group}</>;
      case "kubernetes":
        return <>Kubernetes</>;
      case "integration":
        return <>Cloud: {c.scopeId}</>;
      default:
        return c.hosts.length ? <>{plural(c.hosts.length, "reporting host")} (scope not readable)</> : <>Scope not readable</>;
    }
  })();
  return (
    <div style={{ minWidth: 0 }}>
      {showKind && <Text style={{ fontSize: 11, fontWeight: 600, opacity: 0.8, display: "block" }}>{kindInfo(c.kind).label}</Text>}
      <Text style={{ fontSize: 12, display: "block", wordBreak: "break-word" }}>{line}</Text>
      {stale && <Text style={{ fontSize: 11, fontWeight: 700, color: STATUS_PALETTE.critical, display: "block" }}>Not seen in the last {EXT_SCOPE_LOOKBACK}</Text>}
    </div>
  );
}

/** Where it fails: the hosts that are not OK (local), or the ActiveGate that runs it (remote). */
function WhereCell({ c, d }: { c: MonConfig; d: ExtData }) {
  if (c.kind === "REMOTE") {
    if (c.agId) return <Text style={{ fontSize: 12, wordBreak: "break-word" }}>{d.agNames.get(c.agId) ?? c.agId}</Text>;
    const g = d.groups?.find((x) => x.group === c.group);
    return (
      <div>
        <Text style={{ fontSize: 12, fontWeight: 700, color: STATUS_PALETTE.critical, display: "block" }}>No ActiveGate</Text>
        <Text style={{ fontSize: 11, opacity: 0.8, display: "block" }}>{g ? `${g.online} of ${plural(g.activeGates, "eligible ActiveGate")} connected` : "no ActiveGate in the group has the Extensions module"}</Text>
      </div>
    );
  }
  if (!c.hosts.length) return <Text style={{ fontSize: 12, opacity: 0.6 }}>No host reports it</Text>;
  const bad = c.hosts.filter((h) => !["OK", "IDLE"].includes(h.status));
  const shown = (bad.length ? bad : c.hosts).slice(0, 3);
  return (
    <div style={{ minWidth: 0 }}>
      <Text style={{ fontSize: 11, opacity: 0.8, display: "block" }}>{bad.length ? `${bad.length} of ${plural(c.hosts.length, "host")} not OK` : `${plural(c.hosts.length, "host")}, all OK`}</Text>
      {shown.map((h) => (
        <Text key={h.host} style={{ fontSize: 12, display: "block", wordBreak: "break-word" }}>
          <A url={entityOverviewLink("HOST", h.host, d.tf)}>{h.hostName}</A>
          {bad.length ? <span style={{ opacity: 0.75 }}> ({h.status})</span> : null}
        </Text>
      ))}
      {(bad.length || c.hosts.length) > 3 && <Text style={{ fontSize: 11, opacity: 0.7 }}>+{(bad.length || c.hosts.length) - 3} more</Text>}
    </div>
  );
}

const FASTCHECK_TONE: Record<FastcheckResult, string> = { failed: STATUS_PALETTE.critical, unassigned: STATUS_PALETTE.serious, passed: STATUS_PALETTE.good, created: STATUS_PALETTE.neutral, other: STATUS_PALETTE.neutral };
const FASTCHECK_GLYPH: Record<FastcheckResult, string> = { failed: "!", unassigned: "!", passed: "✓", created: "+", other: "•" };

function FastcheckResultCell({ f }: { f: FastcheckRow }) {
  return (
    <Flex gap={6} alignItems="center">
      <Glyph color={FASTCHECK_TONE[f.result]} glyph={FASTCHECK_GLYPH[f.result]} />
      <Text style={{ fontSize: 12, fontWeight: 700 }}>{FASTCHECK_LABEL[f.result]}</Text>
    </Flex>
  );
}

// ---------------------------------------------------------------------------
// Summary: gauges + local vs remote donut
// ---------------------------------------------------------------------------
function SummaryCard({ d, theme, kind, onKind }: { d: ExtData; theme: Theme; kind: string | null; onKind: (k: string | null) => void }) {
  const live = d.configs.filter((c) => !c.gone);
  const judged = d.configs.filter(isJudged);
  const broken = judged.filter(isBroken);
  const slices = useMemo<Slice[]>(
    () =>
      KINDS.map((k) => ({ id: k.id, label: k.label, value: live.filter((c) => c.kind === k.id).length, color: categoryColor(k, theme) })).filter((s) => s.value > 0),
    [live, theme],
  );
  const recHosts = d.recs.reduce((s, r) => s + r.hosts, 0);
  const recCovered = d.recs.reduce((s, r) => s + Math.min(r.coveredHosts, r.hosts), 0);
  const loading = d.states.remote.loading || d.states.local.loading || d.api.status === "loading";
  return (
    <div style={card}>
      <Flex gap={24} flexWrap="wrap" alignItems="flex-start">
        <Flex gap={16} flexWrap="wrap">
          <PctGauge
            pct={judged.length ? pct(judged.length - broken.length, judged.length) : 100}
            caption="Configurations OK"
            detail={loading && !judged.length ? "…" : `${(judged.length - broken.length).toLocaleString()} of ${plural(judged.length, "enabled configuration")}`}
            onInfo={() => scrollTo(EXT_ANCHOR)}
            infoLabel="Open the fix steps"
          />
          {KINDS.filter((k) => k.id === "LOCAL" || k.id === "REMOTE").map((k) => {
            const all = judged.filter((c) => c.kind === k.id);
            const ok = all.filter((c) => !isBroken(c)).length;
            return all.length ? <PctGauge key={k.id} pct={pct(ok, all.length)} caption={`${k.label.split(" ")[0]} configurations OK`} detail={`${ok} of ${all.length}`} onInfo={() => scrollTo(EXT_ANCHOR)} infoLabel="Open the fix steps" /> : null;
          })}
          {recHosts > 0 && (
            <PctGauge pct={pct(recCovered, recHosts)} caption="Recommended extensions in place" detail={`${recCovered} of ${plural(recHosts, "technology host")}`} onInfo={() => scrollTo(RECS_ANCHOR)} infoLabel="Open the recommendations" />
          )}
        </Flex>
        <div style={{ flex: "1 1 360px", minWidth: 0 }}>
          <Heading level={4} style={{ marginBottom: Spacings.Size8 }}>
            Local vs remote configurations
          </Heading>
          {slices.length ? (
            <Donut slices={slices} size={DONUT_SIZE} centerLabel="configurations" ariaLabel="Extension monitoring configurations by where they run" selectedId={kind} onSelect={onKind} />
          ) : (
            <Text>{loading ? "Loading…" : "No extension monitoring configuration in this environment."}</Text>
          )}
          <Text style={{ ...hint, display: "block", marginTop: Spacings.Size8 }}>
            Local: OneAgent on the hosts in the scope. Remote: an ActiveGate of the targeted group. Click a slice to filter the tables below.
          </Text>
        </div>
      </Flex>
      {snmpUnused(d.snmp) && (
        <Flex gap={8} alignItems="center" flexWrap="wrap" style={{ marginTop: Spacings.Size12, padding: "8px 12px", borderLeft: `4px solid ${STATUS_PALETTE.warning}`, borderRadius: 4, background: "rgba(128,128,128,0.05)" }}>
          <Text style={{ fontSize: 12 }}>
            <strong>Network devices:</strong>{" "}
            {d.snmp
              .filter((r) => r.state === "none" || r.state === "installed")
              .map((r) => `${r.label} ${r.state === "none" ? "not in use" : "not configured"}`)
              .join(", ")}
            . SNMP extensions add routers, switches and firewalls to Dynatrace.
          </Text>
          <Button size="condensed" variant="default" onClick={() => scrollTo(RECS_ANCHOR)}>
            See recommendations
          </Button>
        </Flex>
      )}
      <details style={{ marginTop: Spacings.Size12 }}>
        <summary style={{ cursor: "pointer", fontSize: 12, opacity: 0.8 }}>DQL behind these numbers</summary>
        <Flex flexDirection="column" gap={8} style={{ marginTop: Spacings.Size8 }}>
          <Text style={hint}>Remote configurations: latest status per configuration on an ActiveGate group (same query as the ActiveGates tab)</Text>
          <QueryActions title="Extensions: remote configurations by status" query={d.queries.remote} />
          <Text style={hint}>Local and Kubernetes configurations: latest status per configuration and host</Text>
          <QueryActions title="Extensions: local configurations by status per host" query={d.queries.local} />
          <Text style={hint}>Recommended technologies and the hosts where their extension reports</Text>
          <QueryActions title="Extensions: recommended extensions per technology" query={d.queries.recs} />
          <Text style={hint}>Scope, activation context and enabled come from the Extensions API (GET /platform/extensions/v2/extensions/…/monitoring-configurations).</Text>
        </Flex>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Broken monitoring configurations
// ---------------------------------------------------------------------------
function BrokenCard({ d, kind, selectedId, onLogs, onFix }: { d: ExtData; kind: string | null; selectedId?: string; onLogs: (c: MonConfig) => void; onFix: (c: MonConfig) => void }) {
  const [show, setShow] = useState<"broken" | "all">("broken");
  const rows = useMemo(() => d.configs.filter((c) => (!kind || c.kind === kind) && (show === "all" ? !c.gone : isBroken(c))), [d.configs, kind, show]);
  const columns = useMemo<DataTableColumnDef<MonConfig>[]>(
    () => [
      { id: "status", header: "Status", accessor: (c) => (isBroken(c) ? `0${c.status}` : `1${c.status}`), width: 180, cell: ({ rowData: c }) => <StatusCell c={c} /> },
      { id: "extension", header: "Extension", accessor: "extension", width: 280, cell: ({ rowData: c }) => <ExtensionCell c={c} /> },
      { id: "scope", header: "Runs / scope", accessor: (c) => `${c.kind} ${c.scope}`, width: 220, cell: ({ rowData: c }) => <ScopeCell c={c} d={d} /> },
      { id: "where", header: "Hosts / ActiveGate", accessor: (c) => c.hosts.length || c.agId || "", width: 200, cell: ({ rowData: c }) => <WhereCell c={c} d={d} /> },
      {
        id: "reason",
        header: "Latest reason",
        accessor: (c) => c.message ?? "",
        width: 330,
        cell: ({ rowData: c }) => {
          const fc = c.fastcheck.find((f) => f.result === "failed" || f.result === "unassigned");
          const text = c.message || (fc ? fastcheckReason(fc.content) : "");
          if (!text) return <Text style={{ fontSize: 12, opacity: 0.6 }}>—</Text>;
          return (
            <span title={text}>
              <Text style={{ fontSize: 12, wordBreak: "break-word" }}>{text.length > 220 ? `${text.slice(0, 220)}…` : text}</Text>
            </span>
          );
        },
      },
      {
        id: "fastcheck",
        header: "Fastcheck",
        accessor: (c) => c.fastcheck.length,
        width: 170,
        cell: ({ rowData: c }) => {
          const last = c.fastcheck.find((f) => f.result !== "created" && f.result !== "other") ?? c.fastcheck[0];
          if (!last) return <Text style={{ fontSize: 12, opacity: 0.6 }}>No result in the timeframe</Text>;
          return (
            <Flex flexDirection="column" gap={4}>
              <FastcheckResultCell f={last} />
              <Text style={{ fontSize: 11, opacity: 0.75 }}>
                {last.occurrences > 1 ? `${last.occurrences}× · ` : ""}last {day(last.lastAt)}
              </Text>
              <Button size="condensed" variant="default" onClick={() => onLogs(c)}>
                Log ({c.fastcheck.length})
              </Button>
            </Flex>
          );
        },
      },
      {
        id: "fix",
        header: "Remediation",
        accessor: "configId",
        width: 100,
        disableSorting: true,
        cell: ({ rowData: c }) => (
          <Button size="condensed" variant={c.configId === selectedId ? "accent" : isBroken(c) ? "emphasized" : "default"} aria-pressed={c.configId === selectedId} onClick={() => onFix(c)}>
            {c.configId === selectedId ? "Selected" : isBroken(c) ? "Fix" : "Details"}
          </Button>
        ),
      },
    ],
    [d, selectedId, onLogs, onFix],
  );
  const total = d.configs.filter(isBroken).length;
  return (
    <div style={card}>
      <Flex justifyContent="space-between" alignItems="flex-end" flexWrap="wrap" gap={8}>
        <div>
          <Heading level={4}>Broken monitoring configurations</Heading>
          <Text style={hint}>
            Enabled configurations that do not run as configured: any state except OK and IDLE (dt.sfm.extension.status), a framework error (not picked up, fastcheck failed), or no status at all in the timeframe. Local ones show the
            hosts that are not OK. {total ? `${plural(total, "configuration")} in total.` : ""}
          </Text>
        </div>
        <ToggleButtonGroup value={show} onChange={(v: string) => v && setShow(v as "broken" | "all")} name="ext-broken-show">
          <ToggleButtonGroup.Item value="broken">Broken</ToggleButtonGroup.Item>
          <ToggleButtonGroup.Item value="all">All</ToggleButtonGroup.Item>
        </ToggleButtonGroup>
      </Flex>
      {d.api.status === "error" && (
        <div style={{ marginTop: Spacings.Size8 }}>
          <MessageContainer variant="warning">
            <MessageContainer.Title>Extensions API not readable</MessageContainer.Title>
            <MessageContainer.Description>
              {d.api.message} Configurations come from DQL only: scopes, disabled configurations and configurations that never reported are missing.
            </MessageContainer.Description>
          </MessageContainer>
        </div>
      )}
      {d.api.status === "ok" && d.api.value.failed.length > 0 && (
        <Text style={{ ...hint, display: "block", marginTop: Spacings.Size8 }}>
          Monitoring configurations of {plural(d.api.value.failed.length, "extension")} were not readable (extensions:configurations:read): {d.api.value.failed.slice(0, 5).map(shortExt).join(", ")}
          {d.api.value.failed.length > 5 ? ", …" : ""}.
        </Text>
      )}
      <QueryState state={d.states.remote}>
        <div style={{ marginTop: Spacings.Size12 }}>
          <DataTable data={rows} columns={columns} sortable resizable defaultLineWrap fullWidth variant={{ rowDensity: "condensed" }}>
            <DataTable.EmptyState>{show === "broken" ? (d.api.status === "loading" ? "Reading the monitoring configurations…" : "Every enabled configuration is OK or idle.") : "No configurations."}</DataTable.EmptyState>
            <DataTable.Pagination defaultPageSize={PAGE_SIZE} pageSizeOptions={[PAGE_SIZE, 50, 100]} />
          </DataTable>
        </div>
      </QueryState>
      <div style={{ marginTop: Spacings.Size8 }}>
        <QueryActions title="Extensions: latest framework warning or error per configuration" query={d.queries.events} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fastcheck log
// ---------------------------------------------------------------------------
function FastcheckCard({ d, configId, onClear }: { d: ExtData; configId: string | null; onClear: () => void }) {
  const [show, setShow] = useState<"broken" | "failures" | "all">("broken");
  const byId = useMemo(() => new Map(d.configs.map((c) => [c.configId, c])), [d.configs]);
  const selected = configId ? byId.get(configId) : undefined;
  const rows = useMemo(
    () =>
      d.fastcheck.filter((f) => {
        if (configId) return f.configId === configId;
        if (show === "failures") return f.result === "failed" || f.result === "unassigned";
        if (show === "broken") {
          const c = byId.get(f.configId);
          return !!c && isBroken(c);
        }
        return true;
      }),
    [d.fastcheck, configId, show, byId],
  );
  const columns = useMemo<DataTableColumnDef<FastcheckRow>[]>(
    () => [
      { id: "lastAt", header: "Last (UTC)", accessor: "lastAt", width: 130, cell: ({ rowData: f }) => <Text style={{ fontSize: 12 }}>{day(f.lastAt)}</Text> },
      { id: "result", header: "Result", accessor: "result", width: 160, cell: ({ rowData: f }) => <FastcheckResultCell f={f} /> },
      {
        id: "extension",
        header: "Configuration",
        accessor: "extension",
        width: 280,
        cell: ({ rowData: f }) => {
          const c = byId.get(f.configId);
          return c ? <ExtensionCell c={c} /> : <ExtNameCell c={{ extension: f.extension }} />;
        },
      },
      {
        id: "where",
        header: "Group / ActiveGate",
        accessor: (f) => `${f.group} ${f.agId}`,
        width: 180,
        cell: ({ rowData: f }) => <Text style={{ fontSize: 12, wordBreak: "break-word" }}>{[f.group, f.agId && (d.agNames.get(f.agId) ?? f.agId)].filter(Boolean).join(" · ") || "—"}</Text>,
      },
      {
        id: "occurrences",
        header: "Count",
        accessor: "occurrences",
        width: 120,
        cell: ({ rowData: f }) => (
          <div>
            <Text style={{ fontSize: 12, fontWeight: 700, display: "block" }}>{f.occurrences.toLocaleString()}×</Text>
            {f.occurrences > 1 && <Text style={{ fontSize: 11, opacity: 0.75 }}>since {day(f.firstAt)}</Text>}
          </div>
        ),
      },
      {
        id: "content",
        header: "Message",
        accessor: "content",
        width: 560,
        cell: ({ rowData: f }) => (
          <Text style={{ fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {f.status && <strong>{f.status}: </strong>}
            {f.content}
          </Text>
        ),
      },
    ],
    [byId, d.agNames],
  );
  return (
    <div id={FASTCHECK_ANCHOR} style={card}>
      <Flex justifyContent="space-between" alignItems="flex-end" flexWrap="wrap" gap={8}>
        <div>
          <Heading level={4}>Fastcheck log</Heading>
          <Text style={hint}>
            The extension framework&apos;s fastcheck and assignment results per configuration (dt.system.events, EXTENSION_FRAMEWORK_CORE): fastcheck failed (with the reason), passed and assigned to an ActiveGate, not picked up for
            execution, created. Repeats are folded into one row with a count, newest first.
          </Text>
        </div>
        {selected ? (
          <Flex gap={8} alignItems="center">
            <Text style={hint}>Showing {configName(selected)}</Text>
            <Button size="condensed" variant="default" onClick={onClear}>
              Show all
            </Button>
          </Flex>
        ) : (
          <ToggleButtonGroup value={show} onChange={(v: string) => v && setShow(v as "broken" | "failures" | "all")} name="ext-fastcheck-show">
            <ToggleButtonGroup.Item value="broken">Broken configurations</ToggleButtonGroup.Item>
            <ToggleButtonGroup.Item value="failures">Failures</ToggleButtonGroup.Item>
            <ToggleButtonGroup.Item value="all">All</ToggleButtonGroup.Item>
          </ToggleButtonGroup>
        )}
      </Flex>
      <QueryState state={d.states.fastcheck}>
        <div style={{ marginTop: Spacings.Size12 }}>
          <DataTable data={rows} columns={columns} sortable resizable defaultLineWrap fullWidth variant={{ rowDensity: "condensed" }}>
            <DataTable.EmptyState>{configId ? "No fastcheck or assignment result for this configuration in the timeframe." : show === "all" ? "No fastcheck result in the timeframe." : "No fastcheck failure for these configurations in the timeframe."}</DataTable.EmptyState>
            <DataTable.Pagination defaultPageSize={PAGE_SIZE} pageSizeOptions={[PAGE_SIZE, 50, 100]} />
          </DataTable>
        </div>
      </QueryState>
      <div style={{ marginTop: Spacings.Size8 }}>
        <QueryActions title="Extensions: fastcheck and assignment results" query={d.queries.fastcheck} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Configurations by where they run (the donut's table)
// ---------------------------------------------------------------------------
function ScopesCard({ d, kind }: { d: ExtData; kind: string | null }) {
  const rows = useMemo(() => d.configs.filter((c) => !c.gone && (!kind || c.kind === kind)), [d.configs, kind]);
  const columns = useMemo<DataTableColumnDef<MonConfig>[]>(
    () => [
      { id: "kind", header: "Runs", accessor: (c) => kindInfo(c.kind).label, width: 150, cell: ({ rowData: c }) => <Text style={{ fontSize: 12, fontWeight: 600 }}>{kindInfo(c.kind).label}</Text> },
      { id: "extension", header: "Extension", accessor: "extension", width: 300, cell: ({ rowData: c }) => <ExtensionCell c={c} /> },
      {
        id: "scope",
        header: "Assigned to",
        accessor: (c) => d.scopes.get(c.scopeId)?.name ?? c.scope,
        width: 280,
        cell: ({ rowData: c }) => <ScopeCell c={c} d={d} showKind={false} />,
      },
      {
        id: "hosts",
        header: "Reporting",
        accessor: (c) => c.hosts.length,
        width: 150,
        cell: ({ rowData: c }) => {
          if (c.kind === "REMOTE") return <Text style={{ fontSize: 12 }}>{c.agId ? d.agNames.get(c.agId) ?? c.agId : "—"}</Text>;
          if (!c.hosts.length) return <Text style={{ fontSize: 12, opacity: 0.6 }}>—</Text>;
          const ok = c.hosts.filter((h) => ["OK", "IDLE"].includes(h.status)).length;
          return <Text style={{ fontSize: 12 }}>{`${ok} of ${plural(c.hosts.length, "host")} OK`}</Text>;
        },
      },
      { id: "version", header: "Version", accessor: "version", width: 90 },
      { id: "status", header: "Status", accessor: "status", width: 170, cell: ({ rowData: c }) => <StatusCell c={c} /> },
    ],
    [d],
  );
  return (
    <div id="extensions-scopes" style={card}>
      <Heading level={4}>Configurations by where they run</Heading>
      <Text style={{ ...hint, display: "block", marginBottom: Spacings.Size8 }}>
        Every monitoring configuration and what it is assigned to. Local configurations link to their host or host group; an environment-wide one applies to every host and has no link. {kind ? `Filtered to ${kindInfo(kind).label}.` : ""}
      </Text>
      <QueryState state={d.states.local}>
        <DataTable data={rows} columns={columns} sortable resizable defaultLineWrap fullWidth variant={{ rowDensity: "condensed" }}>
          <DataTable.EmptyState>{d.api.status === "loading" ? "Reading the monitoring configurations…" : "No configurations."}</DataTable.EmptyState>
          <DataTable.Pagination defaultPageSize={PAGE_SIZE} pageSizeOptions={[PAGE_SIZE, 50, 100]} />
        </DataTable>
      </QueryState>
      {d.queries.names && (
        <div style={{ marginTop: Spacings.Size8 }}>
          <Text style={{ ...hint, display: "block", marginBottom: 4 }}>Names of the scoped hosts and host groups (last {EXT_SCOPE_LOOKBACK})</Text>
          <QueryActions title="Extensions: scoped hosts and host groups" query={d.queries.names} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Remediation
// ---------------------------------------------------------------------------
const STATUS_ORDER = ["fail", "warn", "pass", "info"] as const;

function CheckList({ checks }: { checks: ExtCheck[] }) {
  const sorted = useMemo(() => checks.slice().sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)), [checks]);
  return (
    <Flex flexDirection="column" gap={6}>
      {sorted.map((c) => (
        <Flex key={c.id} gap={12} alignItems="baseline" style={{ padding: "6px 12px", borderLeft: `4px solid ${STATUS_COLOR[c.status]}`, borderRadius: 4, background: "rgba(128,128,128,0.05)" }}>
          <Text style={{ fontWeight: 700, minWidth: 64, color: c.status === "info" ? undefined : STATUS_COLOR[c.status] }}>{STATUS_LABEL[c.status]}</Text>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontWeight: 600, display: "block" }}>{c.title}</Text>
            <Text style={{ ...hint, wordBreak: "break-word" }}>{c.detail}</Text>
          </div>
        </Flex>
      ))}
    </Flex>
  );
}

const ADDRESSES: Record<string, string[]> = { fastcheck: ["fastcheck"], extensions: ["group", "status", "reason"], local: ["scope", "hosts", "status", "reason"] };
function severityOf(id: string, checks: ExtCheck[]): Severity {
  const addressed = checks.filter((c) => (ADDRESSES[id] ?? []).includes(c.id));
  return (["fail", "warn", "info"] as const).find((s) => addressed.some((c) => c.status === s)) ?? "other";
}
const toActionDef = (a: ManualAction, checks: ExtCheck[] = []): ActionDef => ({ id: a.id, label: a.title, kind: "manual", node: <ManualActionView action={a} />, docs: a.docs, severity: severityOf(a.id, checks) });

function ExtRemediation({ d, selection, checks, onClear, onLogs }: { d: ExtData; selection: MonConfig | null; checks: ExtCheck[]; onClear: () => void; onLogs: (c: MonConfig) => void }) {
  const generic = useMemo<ActionDef[]>(() => genericExtActions().map((a) => toActionDef(a)), []);
  const actions = useMemo<ActionDef[]>(() => (selection ? configActions(selection).map((a) => toActionDef(a, checks)) : []), [selection, checks]);
  return (
    <div id={EXT_ANCHOR} style={card}>
      <Flex justifyContent="space-between" alignItems="flex-end" flexWrap="wrap" gap={12}>
        <div>
          <Heading level={3} style={{ margin: 0 }}>
            Remediation actions
          </Heading>
          <Text style={{ opacity: 0.8 }}>
            {selection
              ? `What ${configName(selection)} needs: its scope, the ActiveGate group, the latest fastcheck result and error, and the documented steps.`
              : "Fastcheck failures, remote configurations no ActiveGate runs, and local configurations that do not run. Select Fix on a configuration above for checks filled in for it."}
          </Text>
          <DocsStatusLine />
        </div>
        {selection && (
          <Flex gap={8}>
            <Button variant="default" size="condensed" onClick={() => onLogs(selection)}>
              Fastcheck log
            </Button>
            <Button variant="default" size="condensed" onClick={onClear}>
              Clear selection
            </Button>
          </Flex>
        )}
      </Flex>
      <div style={{ marginTop: Spacings.Size12 }}>
        {selection ? (
          <Flex flexDirection="column" gap={12}>
            <Flex gap={12} alignItems="baseline" flexWrap="wrap">
              <Text style={{ fontWeight: 700 }}>{shortExt(selection.extension)}</Text>
              <Text style={hint}>
                {selection.description ? `${selection.description} · ` : ""}
                {kindInfo(selection.kind).label} · {selection.configId}
              </Text>
              <A url={extensionAppLink(selection.extension)}>Extensions app ↗</A>
            </Flex>
            <CheckList checks={checks} />
            <ActionPicker key={selection.configId} actions={actions} />
          </Flex>
        ) : (
          <ActionPicker actions={generic} />
        )}
      </div>
      {!d.scopesLoaded && selection && (selection.scopeType === "host" || selection.scopeType === "host_group") && <Text style={hint}>Checking the scope…</Text>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------
const REC_TONE = { none: STATUS_PALETTE.critical, partial: STATUS_PALETTE.warning, covered: STATUS_PALETTE.good } as const;
const REC_LABEL = { none: "No extension", partial: "Partly covered", covered: "Covered" } as const;

function SetupLink({ r }: { r: RecRow }) {
  if (r.installed) return <A url={extensionAppLink(r.extension)}>{r.configs ? "Add or widen a configuration ↗" : "Add a monitoring configuration ↗"}</A>;
  return <A url={hubSearchLink(r.hubName)}>Add from Dynatrace Hub ↗</A>;
}

type RecProcess = Record<string, any>;
const cellText: React.CSSProperties = { fontSize: 12, wordBreak: "break-word" };

/** The processes of one recommended technology (query runs when the row is opened); long pod names wrap. */
function RecProcesses({ tf, r }: { tf: Timeframe; r: RecRow }) {
  const query = useMemo(() => extensionRecProcessesQuery(tf, r.tech), [tf, r.tech]);
  const state = useDql(query);
  const rows = useMemo<RecProcess[]>(() => state.data?.records ?? [], [state.data]);
  const columns = useMemo<DataTableColumnDef<RecProcess>[]>(
    () => [
      { id: "name", header: "Process", accessor: "name", width: 360, cell: ({ rowData: p }) => <Text style={cellText}><A url={p.sid ? entityOverviewLink("PROCESS", String(p.sid), tf) : undefined}>{String(p.name ?? p.id)}</A></Text> },
      { id: "hostName", header: "Host", accessor: "hostName", width: 280, cell: ({ rowData: p }) => <Text style={cellText}><A url={p.host ? entityOverviewLink("HOST", String(p.host), tf) : undefined}>{String(p.hostName ?? p.host ?? "—")}</A></Text> },
      {
        id: "hostGroup",
        header: "Host group",
        accessor: "hostGroup",
        width: 150,
        cell: ({ rowData: p }) => (p.hostGroupId ? <Text style={cellText}><A url={hostGroupLink(String(p.hostGroupId), tf)}>{String(p.hostGroup ?? p.hostGroupId)}</A></Text> : <Text style={{ ...cellText, opacity: 0.6 }}>—</Text>),
      },
      { id: "monitoringMode", header: "Host mode", accessor: "monitoringMode", width: 110, cell: ({ rowData: p }) => <Text style={cellText}>{formatMode(p.monitoringMode)}</Text> },
      { id: "pod", header: "Kubernetes", accessor: "pod", width: 260, cell: ({ rowData: p }) => <Text style={cellText}>{p.namespace ? `${p.namespace} / ${p.pod ?? ""}` : "—"}</Text> },
      {
        id: "localExtension",
        header: "Extension on the host",
        accessor: (p) => (p.localExtension ? 1 : 0),
        width: 170,
        cell: ({ rowData: p }) =>
          p.localExtension ? (
            <Text style={{ ...cellText, color: STATUS_PALETTE.good, fontWeight: 600 }}>✓ {shortExt(String(p.localExtension))}</Text>
          ) : (
            <Text style={{ ...cellText, color: STATUS_PALETTE.critical, fontWeight: 600 }}>✕ none</Text>
          ),
      },
    ],
    [tf],
  );
  return (
    <div style={{ marginTop: Spacings.Size16 }}>
      <Text style={{ fontWeight: 600, display: "block", marginBottom: Spacings.Size8 }}>
        {r.label} processes ({r.processes.toLocaleString()}){r.processes > EXT_REC_LIMIT ? `, first ${EXT_REC_LIMIT}` : ""}, without an extension first
      </Text>
      <QueryState state={state}>
        <DataTable data={rows} columns={columns} sortable resizable defaultLineWrap fullWidth variant={{ rowDensity: "condensed" }}>
          <DataTable.EmptyState>No processes in this timeframe.</DataTable.EmptyState>
          <DataTable.Pagination defaultPageSize={PAGE_SIZE} pageSizeOptions={[PAGE_SIZE, 50, 100]} />
        </DataTable>
        <div style={{ marginTop: Spacings.Size8 }}>
          <QueryActions title={`Extensions: ${r.label} processes and their extension`} query={query} />
        </div>
      </QueryState>
    </div>
  );
}

const SNMP_TONE: Record<SnmpState, string> = { none: STATUS_PALETTE.warning, installed: STATUS_PALETTE.warning, broken: STATUS_PALETTE.critical, "in-use": STATUS_PALETTE.good, unknown: STATUS_PALETTE.neutral };
const SNMP_LABEL: Record<SnmpState, string> = { none: "Not in use", installed: "Installed, not configured", broken: "Configured, not running", "in-use": "In use", unknown: "Unknown" };
const SNMP_GLYPH: Record<SnmpState, string> = { none: "!", installed: "–", broken: "!", "in-use": "✓", unknown: "•" };
const snmpUnused = (rows: SnmpRow[]) => rows.some((r) => r.state === "none" || r.state === "installed");

/** Network devices have no OneAgent: SNMP Autodiscovery and the SNMP device extensions, encouraged when they are not in use. */
function SnmpPanel({ rows }: { rows: SnmpRow[] }) {
  if (!rows.length) return <Text style={hint}>Checking SNMP extensions…</Text>;
  const unused = snmpUnused(rows);
  return (
    <div data-snmp>
      <Heading level={5}>Network devices (SNMP)</Heading>
      <Text style={{ ...hint, display: "block", marginBottom: Spacings.Size8 }}>
        Routers, switches, firewalls and load balancers run no OneAgent: SNMP extensions on an ActiveGate are how Dynatrace monitors them.
        {unused ? " Recommended: discover the devices with SNMP Autodiscovery, then monitor them with the generic or vendor SNMP extension." : ""}
      </Text>
      <Flex gap={12} flexWrap="wrap">
        {rows.map((r) => (
          <div key={r.id} style={{ flex: "1 1 380px", minWidth: 0, padding: "10px 12px", borderLeft: `4px solid ${SNMP_TONE[r.state]}`, borderRadius: 4, background: "rgba(128,128,128,0.05)" }}>
            <Flex justifyContent="space-between" alignItems="center" gap={8} flexWrap="wrap">
              <Text style={{ fontWeight: 700 }}>{r.label}</Text>
              <Flex gap={6} alignItems="center">
                <Glyph color={SNMP_TONE[r.state]} glyph={SNMP_GLYPH[r.state]} dark={r.state === "none" || r.state === "installed"} />
                <Text style={{ fontSize: 12, fontWeight: 700 }}>{SNMP_LABEL[r.state]}</Text>
              </Flex>
            </Flex>
            <Text style={{ fontSize: 12, display: "block", marginTop: 4, wordBreak: "break-word" }}>{r.advice}</Text>
            <Flex gap={12} flexWrap="wrap" style={{ marginTop: 6, fontSize: 12 }}>
              {r.state === "none" && <A url={hubSearchLink(r.hubName)}>Add {r.hubName} from Dynatrace Hub ↗</A>}
              {r.state === "installed" && <A url={extensionAppLink(r.extension)}>Add a monitoring configuration ↗</A>}
              {(r.state === "in-use" || r.state === "broken") && <A url={extensionAppLink(r.extension)}>{r.hubName} in the Extensions app ↗</A>}
              {r.docs.map((doc) => (
                <A key={doc.url} url={doc.url}>
                  {doc.title} ↗
                </A>
              ))}
            </Flex>
          </div>
        ))}
      </Flex>
    </div>
  );
}

function RecommendationsCard({ d }: { d: ExtData }) {
  const [show, setShow] = useState<"gaps" | "all">("gaps");
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(() => d.recs.filter((r) => show === "all" || r.state !== "covered"), [d.recs, show]);
  const opened = d.recs.find((r) => r.tech === open) ?? null;
  const columns = useMemo<DataTableColumnDef<RecRow>[]>(
    () => [
      {
        id: "label",
        header: "Technology",
        accessor: "label",
        width: 200,
        cell: ({ rowData: r }) => (
          <div>
            <Text style={{ fontSize: 12, fontWeight: 700, display: "block" }}>{r.label}</Text>
            {r.note && <Text style={{ fontSize: 11, opacity: 0.75, display: "block" }}>{r.note}</Text>}
          </div>
        ),
      },
      {
        id: "extension",
        header: "Extension (Hub)",
        accessor: "hubName",
        width: 230,
        cell: ({ rowData: r }) => (
          <div>
            <Text style={{ fontSize: 12, display: "block" }}>{r.hubName}</Text>
            <Text style={{ fontSize: 11, opacity: 0.7, display: "block", wordBreak: "break-word" }}>{r.extension}</Text>
          </div>
        ),
      },
      {
        id: "state",
        header: "Coverage",
        accessor: (r) => ["none", "partial", "covered"].indexOf(r.state),
        width: 200,
        cell: ({ rowData: r }) => (
          <div>
            <Flex gap={6} alignItems="center">
              <Glyph color={REC_TONE[r.state]} glyph={r.state === "covered" ? "✓" : r.state === "partial" ? "–" : "!"} dark={r.state === "partial"} />
              <Text style={{ fontSize: 12, fontWeight: 700 }}>{REC_LABEL[r.state]}</Text>
            </Flex>
            <Text style={{ fontSize: 11, opacity: 0.8, display: "block" }}>
              {r.coveredHosts} of {plural(r.hosts, "host")} · {plural(r.processes, "process", "processes")}
            </Text>
          </div>
        ),
      },
      {
        id: "env",
        header: "In this environment",
        accessor: (r) => (r.installed ? 1 : 0),
        width: 190,
        cell: ({ rowData: r }) => (
          <div>
            <Text style={{ fontSize: 12, fontWeight: 600, display: "block", color: r.installed === false ? STATUS_PALETTE.critical : undefined }}>
              {r.installed === null ? "Not readable" : r.installed ? `Installed${r.version ? ` · ${r.version}` : ""}` : "Not in the environment"}
            </Text>
            {r.installed && (
              <Text style={{ fontSize: 11, opacity: 0.8, display: "block" }}>
                {plural(r.configs, "configuration")}
                {r.brokenConfigs ? <span style={{ color: STATUS_PALETTE.critical, fontWeight: 700 }}> · {r.brokenConfigs} broken</span> : null}
              </Text>
            )}
          </div>
        ),
      },
      { id: "advice", header: "Recommendation", accessor: (r) => r.uncoveredHosts, width: 330, cell: ({ rowData: r }) => <Text style={{ fontSize: 12, wordBreak: "break-word" }}>{recAdvice(r)}</Text> },
      {
        id: "setup",
        header: "Set up",
        accessor: "tech",
        width: 200,
        disableSorting: true,
        cell: ({ rowData: r }) => (
          <Flex flexDirection="column" gap={4}>
            {r.state !== "covered" && (
              <Text style={{ fontSize: 12 }}>
                <SetupLink r={r} />
              </Text>
            )}
            <Button size="condensed" variant={open === r.tech ? "accent" : "default"} aria-pressed={open === r.tech} onClick={() => setOpen(open === r.tech ? null : r.tech)}>
              {open === r.tech ? "Hide processes" : "Processes"}
            </Button>
          </Flex>
        ),
      },
    ],
    [open],
  );
  return (
    <div id={RECS_ANCHOR} style={card}>
      <Flex justifyContent="space-between" alignItems="flex-end" flexWrap="wrap" gap={8}>
        <div>
          <Heading level={4}>Extension recommendations</Heading>
          <Text style={hint}>
            Extensions worth adding: SNMP for network devices, and extensions for technologies OneAgent sees on processes but no extension monitors. Databases are left out: the Databases tab covers them. Links open the extension
            in the Extensions app when it is in the environment, Dynatrace Hub otherwise.
          </Text>
        </div>
      </Flex>
      <div style={{ marginTop: Spacings.Size12 }}>
        <SnmpPanel rows={d.snmp} />
      </div>
      <Flex justifyContent="space-between" alignItems="flex-end" flexWrap="wrap" gap={8} style={{ marginTop: Spacings.Size16 }}>
        <div>
          <Heading level={5}>Technologies on monitored processes</Heading>
          <Text style={hint}>Processes OneAgent sees whose technology has a Hub extension, and the hosts where no matching extension reports.</Text>
        </div>
        <ToggleButtonGroup value={show} onChange={(v: string) => v && setShow(v as "gaps" | "all")} name="ext-recs-show">
          <ToggleButtonGroup.Item value="gaps">Needs an extension</ToggleButtonGroup.Item>
          <ToggleButtonGroup.Item value="all">All</ToggleButtonGroup.Item>
        </ToggleButtonGroup>
      </Flex>
      <QueryState state={d.states.recs}>
        <div style={{ marginTop: Spacings.Size12 }}>
          <DataTable data={rows} columns={columns} sortable resizable defaultLineWrap fullWidth variant={{ rowDensity: "condensed" }}>
            <DataTable.EmptyState>{d.recs.length ? "Every recommended technology is covered by its extension." : "OneAgent sees no process with a recommended extension in this timeframe."}</DataTable.EmptyState>
          </DataTable>
        </div>
        <div style={{ marginTop: Spacings.Size8 }}>
          <QueryActions title="Extensions: recommended extensions per technology" query={d.queries.recs} />
        </div>
        {opened && <RecProcesses key={opened.tech} tf={d.tf} r={opened} />}
      </QueryState>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab
// ---------------------------------------------------------------------------
export function ExtensionsTab({ tf }: { tf: Timeframe }) {
  const theme = useCurrentTheme() as Theme;
  const d = useExtensionsData(tf);
  const [kind, setKind] = useState<string | null>(null);
  const [logConfig, setLogConfig] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // A new timeframe changes the data behind a slice and the log filter.
  useEffect(() => {
    setKind(null);
    setLogConfig(null);
  }, [tf]);
  const selection = d.configs.find((c) => c.configId === selectedId) ?? null;
  const checks = useMemo(() => (selection ? diagnoseConfig(selection, { scopes: d.scopes, scopesLoaded: d.scopesLoaded, groups: d.groups }) : []), [selection, d.scopes, d.scopesLoaded, d.groups]);

  const onLogs = useCallback((c: MonConfig) => {
    setLogConfig(c.configId);
    scrollTo(FASTCHECK_ANCHOR);
  }, []);
  const onFix = useCallback((c: MonConfig) => {
    setSelectedId(c.configId);
    scrollTo(EXT_ANCHOR);
  }, []);

  const { panel: aiPanel } = useAIInsights(
    useCallback(() => {
      const live = d.configs.filter((c) => !c.gone);
      const broken = d.configs.filter(isBroken);
      const statuses = new Map<string, number>();
      for (const c of broken) statuses.set(c.status, (statuses.get(c.status) ?? 0) + 1);
      return analyzeExtensions({
        judged: d.configs.filter(isJudged).length,
        broken: broken.length,
        kinds: KINDS.map((k) => ({ label: k.label.replace(/ \(.*\)$/, ""), total: live.filter((c) => c.kind === k.id).length, broken: broken.filter((c) => c.kind === k.id).length })),
        statuses: [...statuses.entries()].sort((a, b) => b[1] - a[1]).map(([status, n]) => ({ status, n })),
        fastcheckFailed: broken.filter((c) => c.fastcheck.find((f) => f.result === "failed" || f.result === "passed")?.result === "failed").map(configName),
        staleScopes: d.configs.filter((c) => staleScope(c, d)).map(configName),
        noData: broken.filter((c) => c.status === "NO_DATA").map(configName),
        disabled: live.filter((c) => !c.enabled).length,
        apiError: d.api.status === "error" ? d.api.message : null,
        recs: d.recs.map((r) => ({ label: r.label, hubName: r.hubName, hosts: r.hosts, uncoveredHosts: r.uncoveredHosts, installed: r.installed, configs: r.configs })),
        snmp: d.snmp.map((r) => ({ label: r.label, hubName: r.hubName, state: r.state })),
        selection: selection ? { name: configName(selection), failing: checks.filter((c) => c.status === "fail").map((c) => c.title) } : null,
      });
    }, [d, selection, checks]),
  );

  return (
    <Flex flexDirection="column" gap={16}>
      {aiPanel}
      <Heading level={3}>Extensions</Heading>
      <Text>
        Every extension monitoring configuration in the environment: which ones are broken and why (status, latest error, fastcheck results), where each one runs (local in OneAgent on a host, host group or the whole environment,
        or remote on an ActiveGate group), and extensions for technologies OneAgent sees on processes that no extension monitors yet. Read from the Extensions API, extension self-monitoring (dt.sfm.extension.status), extension
        framework events and OneAgent process instances.
      </Text>
      <SummaryCard d={d} theme={theme} kind={kind} onKind={setKind} />
      {kind && (
        <Flex gap={8} alignItems="center">
          <Text style={hint}>Tables filtered to {kindInfo(kind).label} configurations.</Text>
          <Button size="condensed" variant="default" onClick={() => setKind(null)}>
            Show all
          </Button>
        </Flex>
      )}
      <BrokenCard d={d} kind={kind} selectedId={selectedId ?? undefined} onLogs={onLogs} onFix={onFix} />
      <FastcheckCard d={d} configId={logConfig} onClear={() => setLogConfig(null)} />
      <ScopesCard d={d} kind={kind} />
      <Flex justifyContent="flex-end">
        <Button size="condensed" variant="default" onClick={d.reload}>
          Re-check
        </Button>
      </Flex>
      <ExtRemediation d={d} selection={selection} checks={checks} onClear={() => setSelectedId(null)} onLogs={onLogs} />
      <RecommendationsCard d={d} />
    </Flex>
  );
}
