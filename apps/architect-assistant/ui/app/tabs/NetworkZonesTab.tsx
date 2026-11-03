import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { TextInput } from "@dynatrace/strato-components/forms";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { useCurrentTheme } from "@dynatrace/strato-components/core";
import Colors from "@dynatrace/strato-design-tokens/colors";
import Spacings from "@dynatrace/strato-design-tokens/spacings";
import Borders from "@dynatrace/strato-design-tokens/borders";
import { useDql } from "../useDql";
import { useAIInsights } from "../AIInsights";
import { analyzeNetworkZones } from "../analyses";
import { activeGateAgentsQuery, activeGatesQuery, networkZoneOneAgentsQuery, NETWORK_ZONE_ONEAGENT_LIMIT, type Timeframe } from "../queries";
import { PctGauge, QueryActions, QueryState, ScoreTile, pct } from "../components";
import { useNav } from "../navigation";
import type { Theme } from "../kubernetes";
import {
  DEFAULT_ZONE,
  FALLBACK_LABEL,
  FALLBACK_TEXT,
  PRIORITY_LABEL,
  TYPE_LABEL,
  readNetworkZones,
  routesOneAgents,
  shortVersion,
  toActiveGate,
  zoneRows,
  type ActiveGate,
  type RoutingPlan,
  type ZoneRow,
} from "../activeGates";
import { candidatesOf, connectionFlow, currentPlans, readZoneHostStats, toZoneOneAgent, zoneMatches, zoneOutagePlan, type ZoneHostStats, type ZoneOneAgent } from "../networkZones";
import { NetworkZoneMap } from "./NetworkZoneMap";
import { ConnectionFlow, type FlowSelection } from "./ConnectionFlow";
import { AssignForm, EnableZonesForm, FallbackForm, StatusCell, linkStyle, useApi, type Load } from "./ActiveGatesTab";
import { STATUS_COLOR } from "./DeepMonitoringTab";
import { STATUS_PALETTE } from "./AgCharts";

// ---------------------------------------------------------------------------
// Network Zones tab: the zone map with outage simulation (NetworkZoneMap), a searchable list of zones with their
// ActiveGates and OneAgents, and the OneAgent -> ActiveGate connection flow (ConnectionFlow). Data: Smartscape
// ActiveGates and OneAgents (with their hosts), connected OneAgent modules per ActiveGate, the network zone settings,
// and per expanded zone the classic hostStats (hosts using the zone as alternative or failover).
// ---------------------------------------------------------------------------

const card: React.CSSProperties = { padding: Spacings.Size16, borderRadius: Borders.Radius.Container.Default, background: Colors.Background.Container.Neutral.Default };
const hint: React.CSSProperties = { fontSize: 12, opacity: 0.7 };
const CONNECTIONS_ANCHOR = "network-zone-connections";
const CHECK_ORDER = ["fail", "warn", "info", "pass"];
const plural = (x: number, one: string, many = `${one}s`) => `${x.toLocaleString()} ${x === 1 ? one : many}`;
const scrollTo = (id: string) => setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);

function useNetworkZoneData(tf: Timeframe) {
  const queries = useMemo(() => ({ inventory: activeGatesQuery(tf), agents: activeGateAgentsQuery(tf), oneAgents: networkZoneOneAgentsQuery(tf) }), [tf]);
  const inventory = useDql(queries.inventory);
  const agentState = useDql(queries.agents);
  const oneAgentState = useDql(queries.oneAgents);
  const [zonesKey, setZonesKey] = useState(0);
  const zoneSettings = useApi(readNetworkZones, "settings:objects:read", zonesKey);
  const ags = useMemo(() => (inventory.data?.records ?? []).map(toActiveGate).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })), [inventory.data]);
  const agents = useMemo(() => new Map<string, number>((agentState.data?.records ?? []).map((r) => [String(r.agId), Number(r.agents ?? 0) || 0])), [agentState.data]);
  const oneAgents = useMemo<ZoneOneAgent[]>(() => (oneAgentState.data?.records ?? []).map(toZoneOneAgent), [oneAgentState.data]);
  const zoneSet = zoneSettings.status === "ok" ? zoneSettings.value : undefined;
  const zones = useMemo<ZoneRow[]>(() => {
    const counts = new Map<string, number>();
    for (const o of oneAgents) counts.set(o.zone, (counts.get(o.zone) ?? 0) + 1);
    return zoneRows(ags, counts, zoneSet);
  }, [ags, oneAgents, zoneSet]);
  const plans = useMemo(() => currentPlans(zones, ags), [zones, ags]);
  const reloadZones = useCallback(() => setZonesKey((k) => k + 1), []);
  return { queries, states: { inventory, agents: agentState, oneAgents: oneAgentState }, ags, agents, oneAgents, zones, plans, zoneSettings, reloadZones };
}
type ZoneData = ReturnType<typeof useNetworkZoneData>;

const planText = (p?: RoutingPlan) => (!p ? "—" : p.dropped ? "Dropped" : `Group ${p.target!.prio}: ${PRIORITY_LABEL[p.target!.prio]} (${plural(p.target!.available.length, "ActiveGate")})`);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
function Summary({ data }: { data: ZoneData }) {
  const { zones, ags, oneAgents, plans } = data;
  const used = zones.filter((z) => z.oneAgents > 0);
  const survive = used.filter((z) => !zoneOutagePlan(z.zone, zones, ags).dropped).length;
  const withOwn = oneAgents.filter((o) => plans.get(o.zone)?.target?.prio === 1 || (o.zone === DEFAULT_ZONE && plans.get(o.zone)?.target?.prio === 3)).length;
  const routed = oneAgents.filter((o) => plans.get(o.zone)?.target).length;
  const routing = ags.filter((a) => routesOneAgents(a) && a.online).length;
  return (
    <div style={card}>
      <Flex gap={16} flexWrap="wrap" justifyContent="space-around" alignItems="center">
        <PctGauge pct={pct(routed, oneAgents.length)} caption="OneAgents with an ActiveGate" detail={`${routed} of ${oneAgents.length} have an ActiveGate their zone's fallback allows`} />
        <PctGauge pct={pct(withOwn, oneAgents.length)} caption="OneAgents served in their own zone" detail={`${withOwn} of ${oneAgents.length} use priority group 1`} />
        <PctGauge pct={pct(survive, used.length)} caption="Zones that survive losing their ActiveGates" detail={`${survive} of ${used.length} zones with OneAgents still reach an ActiveGate`} />
        <ScoreTile title="Network zones" value={zones.length.toLocaleString()} subtitle={`${used.length} with OneAgents, ${zones.filter((z) => z.ags.length).length} with ActiveGates`} />
        <ScoreTile title="Routing ActiveGates" value={routing.toLocaleString()} subtitle={`connected, OneAgent routing on, of ${ags.length}`} />
      </Flex>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Searchable zone list with expandable rows (ActiveGates, OneAgents, measured hosts)
// ---------------------------------------------------------------------------
const cell: React.CSSProperties = { padding: "4px 8px", fontSize: 12, verticalAlign: "top", textAlign: "left" };

function HostStats({ zone, enabled, hostName }: { zone: string; enabled?: boolean; hostName: (id: string) => string }) {
  const [state, setState] = useState<Load<ZoneHostStats>>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    readZoneHostStats(zone)
      .then((value) => !cancelled && setState({ status: "ok", value }))
      .catch((e) => {
        const status = (e as any)?.response?.status ?? (e as any)?.status;
        const message = status === 404 ? "not available (the API answers 404, as it does while network zones are off)" : status === 403 ? "access denied: the app needs fleet-management:network-zones:read" : String((e as Error)?.message ?? e);
        if (!cancelled) setState({ status: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, [zone]);
  if (state.status === "loading") return <Text style={hint}>Reading the hosts connected to the zone…</Text>;
  if (state.status === "error") return <Text style={hint}>Measured connections: {state.message}{enabled === false ? "." : ""}</Text>;
  const v = state.value;
  const rows: [string, string[]][] = [
    ["Use this zone as an alternative", v.connectedAsAlternative],
    ["Use this zone as failover (higher-priority ActiveGates available)", v.connectedAsFailover],
    ["Use this zone as failover (no higher-priority ActiveGate)", v.connectedAsFailoverWithoutActiveGates],
    ["Configured for this zone but connected elsewhere", v.configuredButNotConnected],
  ];
  return (
    <table style={{ borderCollapse: "collapse", width: "100%" }}>
      <tbody>
        {rows.map(([label, ids]) => (
          <tr key={label}>
            <td style={{ ...cell, width: 340, fontWeight: 600 }}>{label}</td>
            <td style={{ ...cell, wordBreak: "break-word", color: ids.length && label.startsWith("Use this zone as failover (no") ? STATUS_PALETTE.critical : undefined }}>{ids.length ? `${ids.length}: ${ids.slice(0, 20).map(hostName).join(", ")}${ids.length > 20 ? ", …" : ""}` : "none"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ZoneDetails({ z, data, onConnections }: { z: ZoneRow; data: ZoneData; onConnections: (zone: string) => void }) {
  const { agents, oneAgents, plans, zones, ags, zoneSettings } = data;
  const plan = plans.get(z.zone);
  const outage = zoneOutagePlan(z.zone, zones, ags);
  const inZone = oneAgents.filter((o) => o.zone === z.zone);
  const hostName = (id: string) => oneAgents.find((o) => o.hostId === id)?.hostName ?? id;
  const groups = [...new Set(inZone.map((o) => o.hostGroup || "no host group"))];
  return (
    <Flex flexDirection="column" gap={12} style={{ padding: "8px 4px 12px" }}>
      <div>
        <Text style={{ fontWeight: 700, display: "block", marginBottom: 4 }}>ActiveGates in {z.zone}</Text>
        {z.ags.length === 0 ? (
          <Text style={hint}>No ActiveGate is in this zone.</Text>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                {["ActiveGate", "Purpose", "State", "OneAgent routing", "Connected OneAgent modules", "Routed OneAgents", "Version", "Group"].map((h) => (
                  <th key={h} style={{ ...cell, borderBottom: "1px solid rgba(128,128,128,0.3)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {z.ags.map((a) => {
                const routedHere = oneAgents.filter((o) => candidatesOf(o, plans)?.ags.some((x) => x.agId === a.agId)).length;
                return (
                  <tr key={a.agId}>
                    <td style={{ ...cell, fontWeight: 600, wordBreak: "break-word" }}>{a.name}</td>
                    <td style={cell}>
                      {TYPE_LABEL[a.type] ?? a.type}
                      {a.containerized ? " (containerized)" : ""}
                    </td>
                    <td style={{ ...cell, color: a.online ? undefined : STATUS_PALETTE.critical, fontWeight: a.online ? undefined : 700 }}>{a.online ? "Connected" : "Not connected"}</td>
                    <td style={cell}>{routesOneAgents(a) ? "Yes" : "No (module off)"}</td>
                    <td style={cell}>{agents.has(a.agId) ? Math.round(agents.get(a.agId)!).toLocaleString() : "—"}</td>
                    <td style={cell}>{routedHere ? `${routedHere} (shared with ${Math.max(0, (plan?.target?.available.length ?? 1) - 1)} others)` : "—"}</td>
                    <td style={cell}>{shortVersion(a.version) || "—"}</td>
                    <td style={cell}>{a.group || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div>
        <Text style={{ fontWeight: 700, display: "block", marginBottom: 4 }}>OneAgents in {z.zone}</Text>
        <Text style={{ fontSize: 12, display: "block" }}>
          {inZone.length ? `${plural(inZone.length, "OneAgent")} in ${plural(groups.length, "host group")} (${groups.slice(0, 6).join(", ")}${groups.length > 6 ? ", …" : ""}).` : "No OneAgent is in this zone."} Now:{" "}
          <strong style={{ color: plan?.dropped && inZone.length ? STATUS_PALETTE.critical : undefined }}>{planText(plan)}</strong>. If the zone&apos;s own ActiveGates fail:{" "}
          <strong style={{ color: outage.dropped && inZone.length ? STATUS_PALETTE.critical : undefined }}>{planText(outage)}</strong>.
        </Text>
        <Text style={{ ...hint, display: "block", marginTop: 2 }}>{FALLBACK_TEXT[z.fallback] ?? ""}</Text>
        {inZone.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <Button size="condensed" variant="emphasized" onClick={() => onConnections(z.zone)}>
              Show the connections of these OneAgents
            </Button>
          </div>
        )}
      </div>
      <div>
        <Text style={{ fontWeight: 700, display: "block", marginBottom: 4 }}>Hosts connected to the zone (measured)</Text>
        <HostStats zone={z.zone} enabled={zoneSettings.status === "ok" ? zoneSettings.value.enabled : undefined} hostName={hostName} />
      </div>
    </Flex>
  );
}

function ZoneList({ data, onConnections }: { data: ZoneData; onConnections: (zone: string) => void }) {
  const { zones, oneAgents, plans, ags, states, queries } = data;
  const [q, setQ] = useState("");
  const rows = useMemo(() => zones.filter((z) => zoneMatches(z, oneAgents, q)), [zones, oneAgents, q]);
  const columns = useMemo<DataTableColumnDef<ZoneRow>[]>(
    () => [
      { id: "status", header: "Status", accessor: (z) => CHECK_ORDER.indexOf(z.status), width: 100, cell: ({ rowData: z }) => <StatusCell status={z.status} count={0} /> },
      { id: "zone", header: "Network zone", accessor: "zone", width: 170, cell: ({ rowData: z }) => <Text style={{ fontSize: 12, fontWeight: 600, wordBreak: "break-word" }}>{z.zone}</Text> },
      {
        id: "fallback",
        header: "Fallback",
        accessor: "fallback",
        width: 140,
        cell: ({ rowData: z }) => (
          <span title={FALLBACK_TEXT[z.fallback]}>
            <Text style={{ fontSize: 12, display: "block", fontWeight: z.fallback === "NONE" ? 700 : undefined, color: z.fallback === "NONE" ? STATUS_COLOR.warn : undefined }}>{FALLBACK_LABEL[z.fallback] ?? (z.fallback || "not read")}</Text>
            <Text style={{ fontSize: 11, opacity: 0.7, display: "block" }}>{z.fallback ? (z.configured ? "configured" : "not configured (default)") : ""}</Text>
          </span>
        ),
      },
      { id: "alternatives", header: "Alternative zones", accessor: (z) => z.alternatives.join(", "), width: 120, cell: ({ rowData: z }) => <Text style={{ fontSize: 12, wordBreak: "break-word" }}>{z.alternatives.length ? z.alternatives.join(", ") : "none"}</Text> },
      {
        id: "ags",
        header: "ActiveGates",
        accessor: (z) => z.ags.length,
        width: 140,
        cell: ({ rowData: z }) => (
          <Text style={{ fontSize: 12 }}>
            {z.online} of {z.ags.length} connected
            <br />
            <span style={{ opacity: 0.75 }}>{z.ags.filter((a) => a.online && routesOneAgents(a)).length} route OneAgents</span>
          </Text>
        ),
      },
      { id: "oneAgents", header: "OneAgents", accessor: "oneAgents", width: 100 },
      {
        id: "now",
        header: "Traffic now",
        accessor: (z) => (plans.get(z.zone)?.dropped ? -1 : plans.get(z.zone)?.target?.prio ?? 9),
        width: 190,
        cell: ({ rowData: z }) => {
          const p = plans.get(z.zone);
          return <Text style={{ fontSize: 12, display: "block", whiteSpace: "normal", wordBreak: "break-word", paddingRight: 10, fontWeight: p?.dropped && z.oneAgents ? 700 : undefined, color: p?.dropped && z.oneAgents ? STATUS_PALETTE.critical : undefined }}>{planText(p)}</Text>;
        },
      },
      {
        id: "outage",
        header: "If its ActiveGates fail",
        accessor: (z) => (zoneOutagePlan(z.zone, zones, ags).dropped ? -1 : 1),
        width: 190,
        cell: ({ rowData: z }) => {
          const p = zoneOutagePlan(z.zone, zones, ags);
          const bad = p.dropped && z.oneAgents > 0;
          return <Text style={{ fontSize: 12, display: "block", whiteSpace: "normal", wordBreak: "break-word", paddingRight: 10, fontWeight: bad ? 700 : undefined, color: bad ? STATUS_PALETTE.critical : undefined }}>{z.oneAgents ? planText(p) : `${planText(p)} (no OneAgents)`}</Text>;
        },
      },
      { id: "note", header: "Finding", accessor: "note", width: 260, cell: ({ rowData: z }) => <Text style={{ fontSize: 12, display: "block", whiteSpace: "normal" }}>{z.note}</Text> },
    ],
    [plans, zones, ags],
  );
  return (
    <div id="network-zone-list" style={card}>
      <Flex justifyContent="space-between" alignItems="flex-end" flexWrap="wrap" gap={8}>
        <div style={{ maxWidth: 820 }}>
          <Heading level={4}>Network zones</Heading>
          <Text style={hint}>
            Every zone that is configured or used by an ActiveGate or OneAgent, findings first. Search by zone, ActiveGate, OneAgent host or host group. Expand a zone for its ActiveGates, its OneAgents and the hosts measured using it.
          </Text>
        </div>
        <div style={{ width: 300 }}>
          <TextInput value={q} placeholder="Search zone, ActiveGate, host, host group" onChange={(v: string) => setQ(v)} aria-label="Search network zones" />
        </div>
      </Flex>
      <div style={{ marginTop: Spacings.Size8 }}>
        <QueryState state={states.oneAgents}>
          <DataTable data={rows} columns={columns} sortable resizable defaultLineWrap fullWidth variant={{ rowDensity: "condensed" }}>
            <DataTable.EmptyState>No network zone matches.</DataTable.EmptyState>
            <DataTable.ExpandableRow>{({ row }) => <ZoneDetails z={row as ZoneRow} data={data} onConnections={onConnections} />}</DataTable.ExpandableRow>
          </DataTable>
        </QueryState>
      </div>
      <Flex flexDirection="column" gap={8} style={{ marginTop: Spacings.Size8 }}>
        <QueryActions title="Network zones: ActiveGates (inventory)" query={queries.inventory} />
        <QueryActions title="Network zones: OneAgents with their zone and host" query={queries.oneAgents} />
      </Flex>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OneAgent -> ActiveGate connections
// ---------------------------------------------------------------------------
type OaRow = ZoneOneAgent & { candidates: ActiveGate[]; prio: number | null };

function Connections({ data, theme, selection, setSelection }: { data: ZoneData; theme: Theme; selection: FlowSelection; setSelection: (s: FlowSelection) => void }) {
  const { oneAgents, zones, ags, agents, plans, states, queries } = data;
  const [q, setQ] = useState("");
  const flow = useMemo(() => connectionFlow(oneAgents, zones, ags, agents, plans), [oneAgents, zones, ags, agents, plans]);
  const search = q.trim().toLowerCase();
  const matches = useMemo(() => new Set(search ? flow.sources.filter((s) => s.oneAgents.some((o) => o.hostName.toLowerCase().includes(search))).map((s) => s.id) : []), [flow, search]);
  const rows = useMemo<OaRow[]>(() => {
    let list = oneAgents;
    if (selection?.kind === "source") list = flow.sources.find((s) => s.id === selection.id)?.oneAgents ?? [];
    if (selection?.kind === "target") list = oneAgents.filter((o) => candidatesOf(o, plans)?.ags.some((a) => a.agId === selection.id));
    if (search) list = list.filter((o) => [o.hostName, o.hostGroup, o.zone, o.cluster].some((v) => v.toLowerCase().includes(search)));
    return list.map((o) => {
      const c = candidatesOf(o, plans);
      return { ...o, candidates: c?.ags ?? [], prio: c?.prio ?? null };
    });
  }, [oneAgents, selection, flow, plans, search]);
  const columns = useMemo<DataTableColumnDef<OaRow>[]>(
    () => [
      { id: "host", header: "OneAgent (host)", accessor: "hostName", width: 260, cell: ({ rowData: o }) => <Text style={{ fontSize: 12, fontWeight: 600, wordBreak: "break-word" }}>{o.hostName}</Text> },
      { id: "zone", header: "Zone", accessor: "zone", width: 130 },
      { id: "hostGroup", header: "Host group", accessor: (o) => o.hostGroup || "—", width: 140 },
      { id: "mode", header: "Mode", accessor: (o) => o.mode.replace(/_/g, " ").toLowerCase(), width: 110 },
      { id: "version", header: "Version", accessor: (o) => shortVersion(o.version), width: 100 },
      {
        id: "candidates",
        header: "Routed to (load-balanced over)",
        accessor: (o) => o.candidates.length,
        width: 420,
        cell: ({ rowData: o }) =>
          o.prio === null ? (
            <Text style={{ fontSize: 12, fontWeight: 700, color: STATUS_PALETTE.critical }}>Dropped: no ActiveGate its zone&apos;s fallback allows</Text>
          ) : (
            <Text style={{ fontSize: 12, wordBreak: "break-word" }}>
              <span style={{ opacity: 0.75 }}>group {o.prio} · </span>
              {selection?.kind === "target"
                ? `${o.candidates.find((a) => a.agId === selection.id)?.name} and ${plural(o.candidates.length - 1, "other")}`
                : o.candidates.map((a) => a.name).join(", ")}
            </Text>
          ),
      },
    ],
    [selection],
  );
  const selLabel =
    selection?.kind === "target"
      ? `OneAgents routed to ${ags.find((a) => a.agId === selection.id)?.name ?? selection.id}`
      : selection?.kind === "source"
        ? `OneAgents of ${flow.sources.find((s) => s.id === selection.id)?.label} in zone ${flow.sources.find((s) => s.id === selection.id)?.zone}`
        : "All OneAgents";
  return (
    <div id={CONNECTIONS_ANCHOR} style={card}>
      <Flex justifyContent="space-between" alignItems="flex-end" flexWrap="wrap" gap={8}>
        <div style={{ maxWidth: 820 }}>
          <Heading level={4}>OneAgent connections</Heading>
          <Text style={hint}>
            Which OneAgents go to which ActiveGate. Dynatrace does not report the ActiveGate a single OneAgent is connected to, so each OneAgent is shown with the ActiveGates its zone routes it to (it is load-balanced over them), and each
            ActiveGate with its measured connected OneAgent modules next to its routed share. A large gap between the two bars means the actual connections differ from the zone routing (for example OneAgents that cannot reach their zone&apos;s
            ActiveGates, or network zones being off). Click a host group or an ActiveGate to list its OneAgents.
          </Text>
        </div>
        <Flex gap={8} alignItems="flex-end">
          <div style={{ width: 260 }}>
            <TextInput value={q} placeholder="Find a OneAgent host" onChange={(v: string) => setQ(v)} aria-label="Find a OneAgent host" />
          </div>
          <Button size="condensed" onClick={() => setSelection(null)} disabled={!selection}>
            Clear selection
          </Button>
        </Flex>
      </Flex>
      <QueryState state={states.oneAgents}>
        <div style={{ marginTop: Spacings.Size12 }}>
          <ConnectionFlow flow={flow} theme={theme} selection={selection} onSelect={setSelection} matches={matches} />
        </div>
        <Text style={{ fontWeight: 700, display: "block", margin: `${Spacings.Size16} 0 4px` }}>
          {selLabel}
          {search ? ` matching "${q.trim()}"` : ""} ({rows.length.toLocaleString()})
        </Text>
        <DataTable data={rows} columns={columns} sortable resizable defaultLineWrap fullWidth variant={{ rowDensity: "condensed" }}>
          <DataTable.EmptyState>No OneAgent matches.</DataTable.EmptyState>
          <DataTable.Pagination defaultPageSize={25} pageSizeOptions={[25, 50, 100]} />
        </DataTable>
        {oneAgents.length >= NETWORK_ZONE_ONEAGENT_LIMIT && <Text style={hint}>Showing the first {NETWORK_ZONE_ONEAGENT_LIMIT.toLocaleString()} OneAgents.</Text>}
      </QueryState>
      <Flex flexDirection="column" gap={8} style={{ marginTop: Spacings.Size8 }}>
        <QueryActions title="Network zones: connected OneAgent modules per ActiveGate" query={queries.agents} />
      </Flex>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab
// ---------------------------------------------------------------------------
export function NetworkZonesTab({ tf }: { tf: Timeframe }) {
  const theme = useCurrentTheme() as Theme;
  const nav = useNav();
  const data = useNetworkZoneData(tf);
  const { ags, zones, agents, zoneSettings, states, oneAgents, plans } = data;
  const [selection, setSelection] = useState<FlowSelection>(null);
  const off = zoneSettings.status === "ok" && !zoneSettings.value.enabled;
  const values = useMemo(() => ({ group: [...new Set(ags.map((a) => a.group).filter(Boolean))].sort(), networkZone: zones.map((z) => z.zone).sort() }), [ags, zones]);

  const showAg = useCallback((ag: ActiveGate) => {
    setSelection({ kind: "target", id: ag.agId });
    scrollTo(CONNECTIONS_ANCHOR);
  }, []);
  const showZone = useCallback(
    (zone: string) => {
      const flow = connectionFlow(oneAgents, zones, ags, agents, plans);
      const first = flow.sources.find((s) => s.zone === zone);
      setSelection(first ? { kind: "source", id: first.id } : null);
      scrollTo(CONNECTIONS_ANCHOR);
    },
    [oneAgents, zones, ags, agents, plans],
  );

  const { panel: aiPanel } = useAIInsights(
    useCallback(() => {
      const flow = connectionFlow(oneAgents, zones, ags, agents, plans);
      const imbalance = flow.targets
        .map((t) => ({ name: t.ag.name, expectedPct: pct(t.expected, flow.totalOneAgents), measuredPct: pct(t.measured, flow.totalMeasured) }))
        .filter((t) => Math.abs(t.expectedPct - t.measuredPct) >= 15)
        .sort((a, b) => Math.abs(b.expectedPct - b.measuredPct) - Math.abs(a.expectedPct - a.measuredPct))
        .slice(0, 3);
      const selName = selection?.kind === "target" ? `Selected: ${ags.find((a) => a.agId === selection.id)?.name}` : selection?.kind === "source" ? `Selected host group ${flow.sources.find((s) => s.id === selection.id)?.label}` : null;
      return analyzeNetworkZones({
        zonesEnabled: zoneSettings.status === "ok" ? zoneSettings.value.enabled : null,
        zones: zones.map((z) => {
          const p = plans.get(z.zone);
          const o = zoneOutagePlan(z.zone, zones, ags);
          return {
            zone: z.zone,
            oneAgents: z.oneAgents,
            ags: z.ags.length,
            routing: z.ags.filter((a) => a.online && routesOneAgents(a)).length,
            fallback: FALLBACK_LABEL[z.fallback] ?? (z.fallback || "not read"),
            dropped: !!p?.dropped,
            outage: z.oneAgents ? (o.dropped ? "dropped" : "survives") : "n/a",
            outageGroup: o.target?.prio ?? null,
          };
        }),
        imbalance,
        selection: selName,
      });
    }, [oneAgents, zones, ags, agents, plans, zoneSettings, selection]),
  );

  return (
    <Flex flexDirection="column" gap={16}>
      {aiPanel}
      <div>
        <Heading level={3}>Network Zones</Heading>
        <Text style={{ display: "block", maxWidth: 1100 }}>
          Network zones decide which ActiveGates OneAgents use: their own zone first, then its alternative zones, then (as the zone&apos;s fallback allows) the default zone and any other ActiveGate. This tab maps the zones and their
          ActiveGates, simulates outages, lists every zone with its ActiveGates and OneAgents, and shows which OneAgents are routed to which ActiveGate.{" "}
          <button type="button" onClick={() => nav.openTab("activegates")} style={{ ...linkStyle, all: "unset", cursor: "pointer", textDecoration: "underline" }}>
            ActiveGate details are on the ActiveGates tab.
          </button>
        </Text>
      </div>
      {zoneSettings.status === "error" && <Text style={{ color: STATUS_COLOR.fail }}>Network zone settings not readable: {zoneSettings.message}</Text>}
      {off && (
        <div role="status" style={{ padding: "8px 12px", borderRadius: 6, borderLeft: `4px solid ${STATUS_COLOR.warn}`, background: "rgba(128,128,128,0.06)" }}>
          <Text>
            <strong>Network zones are turned off</strong> for this environment (Settings › Preferences › Network zones), so zone assignments and fallback modes do not route traffic yet. The map and the connections show how traffic would be
            routed once they are on; turn them on at the bottom of this tab.
          </Text>
        </div>
      )}
      <QueryState state={states.inventory}>
        <Flex flexDirection="column" gap={16}>
          <QueryState state={states.oneAgents}>
            <Summary data={data} />
          </QueryState>
          <QueryState state={states.oneAgents}>
            <NetworkZoneMap ags={ags} zones={zones} agents={agents} zonesEnabled={zoneSettings.status === "ok" ? zoneSettings.value.enabled : undefined} theme={theme} onInspect={showAg} />
          </QueryState>
          <ZoneList data={data} onConnections={showZone} />
          <Connections data={data} theme={theme} selection={selection} setSelection={setSelection} />
          <div style={card}>
            <Heading level={4}>Change network zones</Heading>
            <Text style={{ ...hint, display: "block", marginBottom: Spacings.Size8 }}>Writes to the tenant, each with a Validate step and a confirmation. The simulation above never writes anything.</Text>
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>Set the network zone of ActiveGates (API)</summary>
              <div style={{ marginTop: Spacings.Size8 }}>
                <AssignForm ags={ags} attr="networkZone" values={values} />
              </div>
            </details>
            {zoneSettings.status === "ok" && (
              <details style={{ marginTop: Spacings.Size8 }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>Set the fallback and alternative zones of a network zone (API)</summary>
                <div style={{ marginTop: Spacings.Size8 }}>
                  <FallbackForm zones={zones} settings={zoneSettings.value} onDone={data.reloadZones} />
                </div>
              </details>
            )}
            {off && zoneSettings.status === "ok" && (
              <details style={{ marginTop: Spacings.Size8 }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>Turn on network zones (API)</summary>
                <div style={{ marginTop: Spacings.Size8 }}>
                  <EnableZonesForm settings={zoneSettings.value} onDone={data.reloadZones} />
                </div>
              </details>
            )}
          </div>
        </Flex>
      </QueryState>
    </Flex>
  );
}
