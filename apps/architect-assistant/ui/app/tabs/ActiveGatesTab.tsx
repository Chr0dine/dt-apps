import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { Checkbox, Select, TextInput, ToggleButtonGroup } from "@dynatrace/strato-components/forms";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { ProgressCircle } from "@dynatrace/strato-components/content";
import { useCurrentTheme } from "@dynatrace/strato-components/core";
import Colors from "@dynatrace/strato-design-tokens/colors";
import Spacings from "@dynatrace/strato-design-tokens/spacings";
import Borders from "@dynatrace/strato-design-tokens/borders";
import { useDql } from "../useDql";
import { useAIInsights } from "../AIInsights";
import { analyzeActiveGates } from "../analyses";
import {
  AG_OFFLINE_MINUTES,
  activeGateDetailQuery,
  activeGateExtensionEventsQuery,
  activeGateExtensionsQuery,
  activeGateHealthQuery,
  activeGateTrendQuery,
  activeGatesQuery,
  networkZoneAgentsQuery,
  type Timeframe,
} from "../queries";
import { deploymentStatusActiveGatesLink, entityOverviewLink, extensionAppLink, extensionConfigLink, fleetManagementLink } from "../links";
import { PctGauge, QueryActions, QueryState, pct } from "../components";
import { Field, ManualActionView, ResultLine } from "../RemediationPanel";
import { settingsLink, type CheckStatus } from "../deepMonitoring";
import { DOC } from "../deepTech";
import type { ManualAction, SubmitResult } from "../remediation";
import { categoryColor, type Category, type Theme } from "../kubernetes";
import { ActionPicker, ApiFix, DocsStatusLine, SEVERITY_ORDER, STATUS_COLOR, STATUS_LABEL, type ActionDef, type Severity } from "./DeepMonitoringTab";
import { Donut, type Slice } from "./ModePie";
import { NetworkZoneMap } from "./NetworkZoneMap";
import { BarList, LineMini, ModuleMatrix, SERIES_BLUE, STATE_ORDER, STATUS_PALETTE, StackedBar, StateLegend, StateSwatch, type BarRow, type Segment } from "./AgCharts";
import {
  AG_UPDATES_SCHEMA,
  ARCHIVE_STATUS_LABEL,
  BEHIND_WARN,
  DEFAULT_ZONE,
  DEPLOYMENT_LABEL,
  EXT_STATUS_TEXT,
  FALLBACK_LABEL,
  FALLBACK_MODES,
  FALLBACK_TEXT,
  REMOTE_ATTR_LABEL,
  ZONES_ENABLE_SCHEMA,
  ZONES_SCHEMA,
  applyZoneFallback,
  checkRemoteValue,
  enableNetworkZones,
  groupRows,
  groupZoneAction,
  planAgRemoteConfig,
  readNetworkZones,
  remotelyConfigurable,
  runAgRemoteConfig,
  zoneFallbackAction,
  zoneRows,
  zoneValue,
  type FallbackMode,
  type GroupRow,
  type RemoteAttr,
  type RemotePlan,
  type ZoneRow,
  type ZoneSettings,
  MODULES,
  MODULE_STATE_LABEL,
  TYPE_LABEL,
  UPDATE_MODE_LABEL,
  agScope,
  applyUpdatePlan,
  archiveDownloadable,
  archiveFailed,
  archiveRunning,
  awsAction,
  compareVersions,
  connectivityAction,
  deleteSupportArchive,
  deploymentOf,
  diagnoseActiveGate,
  diskFreePct,
  downloadSupportArchive,
  droppedAction,
  effectiveUpdate,
  extIsProblem,
  extensionAction,
  fleetError,
  genericAgActions,
  heapPct,
  ingestAction,
  isK8sBenign,
  isK8sForbidden,
  k8sAction,
  listSupportArchives,
  minorOf,
  moduleAction,
  moduleDef,
  moduleState,
  planCalls,
  readAgTokens,
  readAgUpdateSettings,
  readLastUpdateJobs,
  readTargetVersion,
  rejectedAction,
  releasesBehind,
  resourcesAction,
  runUpdateJob,
  shortVersion,
  startSupportArchive,
  supportArchiveAction,
  toActiveGate,
  toDetail,
  toExtConfigs,
  toHealth,
  tokenAction,
  tokenDaysLeft,
  updatable,
  updateAction,
  updateK8sAction,
  updatePlan,
  worstStatus,
  TOKEN_EXPIRING_DAYS,
  type ActiveGate,
  type AgCheck,
  type AgContext,
  type AgFix,
  type AgHealth,
  type AgToken,
  type AgUpdateSettings,
  type DetailRow,
  type EffectiveUpdate,
  type ExtConfig,
  type ModuleDef,
  type ModuleState,
  type SupportArchive,
  type UpdateJobInfo,
} from "../activeGates";

const card: React.CSSProperties = {
  padding: Spacings.Size16,
  borderRadius: Borders.Radius.Container.Default,
  background: Colors.Background.Container.Neutral.Default,
};
const hint: React.CSSProperties = { fontSize: 12, opacity: 0.7 };
const AG_ANCHOR = "remediation-activegates";
const LOGS_ANCHOR = "activegate-logs";
const ZONES_ANCHOR = "activegate-network-zones";
const DONUT_SIZE = 150;
const plural = (x: number, one: string, many = `${one}s`) => `${x.toLocaleString()} ${x === 1 ? one : many}`;
const json = (v: unknown) => JSON.stringify(v, null, 2);
const scrollTo = (id: string) => setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);

// ---------------------------------------------------------------------------
// Data: five DQL queries (inventory, self-monitoring, module detail, extension statuses and their messages) and three
// API reads (update settings, target version, ActiveGate tokens). API reads that fail leave their checks out.
// ---------------------------------------------------------------------------
type Load<T> = { status: "loading" } | { status: "ok"; value: T } | { status: "error"; message: string };

function useApi<T>(fn: () => Promise<T>, scope: string, key = 0): Load<T> {
  const [state, setState] = useState<Load<T>>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    // Keep the previous value on screen while re-reading after a change.
    setState((prev) => (prev.status === "ok" ? prev : { status: "loading" }));
    fn()
      .then((value) => !cancelled && setState({ status: "ok", value }))
      .catch((e) => !cancelled && setState({ status: "error", message: fleetError(e, scope) }));
    return () => {
      cancelled = true;
    };
  }, [fn, scope, key]);
  return state;
}

const EMPTY_CTX: AgContext = { detail: [], configs: [] };

function useActiveGatesData(tf: Timeframe) {
  const queries = useMemo(
    () => ({
      inventory: activeGatesQuery(tf),
      health: activeGateHealthQuery(tf),
      detail: activeGateDetailQuery(tf),
      extensions: activeGateExtensionsQuery(tf),
      events: activeGateExtensionEventsQuery(tf),
      zoneAgents: networkZoneAgentsQuery(tf),
    }),
    [tf],
  );
  const inventory = useDql(queries.inventory);
  const healthState = useDql(queries.health);
  const detailState = useDql(queries.detail);
  const extState = useDql(queries.extensions);
  const eventState = useDql(queries.events);
  const zoneAgentState = useDql(queries.zoneAgents);
  const [settingsKey, setSettingsKey] = useState(0);
  const settings = useApi(readAgUpdateSettings, "settings:objects:read", settingsKey);
  const [zonesKey, setZonesKey] = useState(0);
  const zoneSettings = useApi(readNetworkZones, "settings:objects:read", zonesKey);
  const targetLoad = useApi(readTargetVersion, "fleet-management:activegates:download");
  const tokens = useApi(readAgTokens, "fleet-management:activegate.tokens:read");

  const ags = useMemo(
    () =>
      (inventory.data?.records ?? [])
        .map(toActiveGate)
        .sort((a, b) => (TYPE_LABEL[a.type] ?? a.type).localeCompare(TYPE_LABEL[b.type] ?? b.type) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
    [inventory.data],
  );
  const health = useMemo(() => new Map<string, AgHealth>((healthState.data?.records ?? []).map((r) => [String(r.agId), toHealth(r)])), [healthState.data]);
  const detail = useMemo<DetailRow[]>(() => (detailState.data?.records ?? []).map(toDetail), [detailState.data]);
  const configs = useMemo<ExtConfig[]>(() => toExtConfigs(extState.data?.records ?? [], eventState.data?.records ?? []), [extState.data, eventState.data]);
  const newestSeen = useMemo(() => ags.map((a) => a.version).filter(Boolean).sort(compareVersions).pop() ?? "", [ags]);
  const fleetTarget = targetLoad.status === "ok" ? targetLoad.value : "";
  const target = fleetTarget || newestSeen;
  const targetSource = fleetTarget ? "Fleet Management target version" : "newest version in this tenant (target version not readable)";

  const ctxs = useMemo(() => {
    const m = new Map<string, AgContext>();
    for (const ag of ags) m.set(ag.agId, { health: health.get(ag.agId), detail: detail.filter((r) => r.agId === ag.agId), configs: configs.filter((c) => c.agId === ag.agId) });
    return m;
  }, [ags, health, detail, configs]);
  const ctxOf = useCallback((ag: ActiveGate) => ctxs.get(ag.agId) ?? EMPTY_CTX, [ctxs]);
  // A configuration no ActiveGate picked up counts against the group members that could run it (Extensions module).
  const unassignedOf = useCallback(
    (ag: ActiveGate) => (ag.modules.includes("EXTENSION_CONTROLLER") ? configs.filter((c) => c.status === "UNASSIGNED" && !c.agId && c.group === ag.group) : []),
    [configs],
  );
  const updateOf = useCallback((ag: ActiveGate): EffectiveUpdate | undefined => (settings.status === "ok" ? effectiveUpdate(ag, settings.value) : undefined), [settings]);
  const tokenOf = useCallback((ag: ActiveGate): AgToken | null | undefined => (tokens.status === "ok" ? tokens.value.get(ag.tokenId) ?? null : undefined), [tokens]);
  const zoneSet = zoneSettings.status === "ok" ? zoneSettings.value : undefined;
  const oneAgentsByZone = useMemo(() => new Map<string, number>((zoneAgentState.data?.records ?? []).map((r) => [String(r.zone ?? DEFAULT_ZONE).toLowerCase(), Number(r.oneAgents ?? 0) || 0])), [zoneAgentState.data]);
  const zones = useMemo<ZoneRow[]>(() => zoneRows(ags, oneAgentsByZone, zoneSet), [ags, oneAgentsByZone, zoneSet]);
  const groups = useMemo<GroupRow[]>(() => groupRows(ags, configs), [ags, configs]);
  const checks = useMemo(
    () =>
      new Map(
        ags.map((ag) => [
          ag.id,
          diagnoseActiveGate(ag, {
            ctx: ctxOf(ag),
            unassigned: unassignedOf(ag),
            target,
            update: updateOf(ag),
            token: tokenOf(ag),
            group: groups.find((g) => g.group === ag.group),
            zone: zones.find((z) => z.zone === (ag.networkZone || DEFAULT_ZONE).toLowerCase()),
            zonesEnabled: zoneSet?.enabled,
          }),
        ]),
      ),
    [ags, ctxOf, unassignedOf, target, updateOf, tokenOf, groups, zones, zoneSet],
  );
  const reloadSettings = useCallback(() => setSettingsKey((k) => k + 1), []);
  const reloadZones = useCallback(() => setZonesKey((k) => k + 1), []);
  return {
    queries,
    states: { inventory, health: healthState, detail: detailState, extensions: extState, events: eventState, zoneAgents: zoneAgentState },
    zoneSettings,
    zones,
    groups,
    reloadZones,
    ags,
    health,
    detail,
    configs,
    settings,
    tokens,
    target,
    targetSource,
    ctxOf,
    unassignedOf,
    updateOf,
    tokenOf,
    checks,
    reloadSettings,
  };
}
type AgData = ReturnType<typeof useActiveGatesData>;

// ---------------------------------------------------------------------------
// Categories for the donuts (fixed palette slots, so a category never changes colour with the data)
// ---------------------------------------------------------------------------
type SliceKind = "version" | "update" | "deployment";
type SliceSel = { kind: SliceKind; id: string };

const UPDATE_CATS: Category[] = [
  { id: "AUTOMATIC", label: UPDATE_MODE_LABEL.AUTOMATIC, slot: 1, detail: "" },
  { id: "AUTOMATIC_DURING_UW", label: UPDATE_MODE_LABEL.AUTOMATIC_DURING_UW, slot: 3, detail: "" },
  { id: "MANUAL", label: UPDATE_MODE_LABEL.MANUAL, slot: 2, detail: "" },
  { id: "OPERATOR", label: UPDATE_MODE_LABEL.OPERATOR, slot: 7, detail: "" },
  { id: "UNKNOWN", label: UPDATE_MODE_LABEL.UNKNOWN, slot: null, detail: "" },
];
const DEPLOYMENT_CATS: Category[] = [
  { id: "HOST", label: DEPLOYMENT_LABEL.HOST, slot: 1, detail: "" },
  { id: "KUBERNETES", label: DEPLOYMENT_LABEL.KUBERNETES, slot: 7, detail: "" },
  { id: "SYNTHETIC", label: DEPLOYMENT_LABEL.SYNTHETIC, slot: 3, detail: "" },
  { id: "ZREMOTE", label: DEPLOYMENT_LABEL.ZREMOTE, slot: 4, detail: "" },
];
const updateKey = (ag: ActiveGate, u?: EffectiveUpdate) => (!updatable(ag) ? "OPERATOR" : u ? u.mode : "UNKNOWN");
const versionKey = (ag: ActiveGate) => (ag.version ? `1.${minorOf(ag.version)}` : "Unknown");
/** At most 7 version slices (newest first); older versions fold into one neutral slice. */
const VERSION_SLICES = 7;

function matchesSlice(s: SliceSel | null, ag: ActiveGate, u: EffectiveUpdate | undefined, versionsShown: string[]) {
  if (!s) return true;
  if (s.kind === "deployment") return deploymentOf(ag) === s.id;
  if (s.kind === "update") return updateKey(ag, u) === s.id;
  return s.id === "OLDER" ? !versionsShown.includes(versionKey(ag)) : versionKey(ag) === s.id;
}

// ---------------------------------------------------------------------------
// Check list (diagnosis)
// ---------------------------------------------------------------------------
const CHECK_ORDER: CheckStatus[] = ["fail", "warn", "info", "pass"];

function CheckList({ checks }: { checks: AgCheck[] }) {
  const sorted = useMemo(() => checks.slice().sort((a, b) => CHECK_ORDER.indexOf(a.status) - CHECK_ORDER.indexOf(b.status)), [checks]);
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

function StatusCell({ status, count }: { status: CheckStatus; count: number }) {
  return (
    <Flex gap={6} alignItems="center">
      <span style={{ width: 9, height: 9, borderRadius: 5, background: STATUS_COLOR[status], flex: "none" }} />
      <Text style={{ fontSize: 12, fontWeight: status === "fail" ? 700 : undefined, color: status === "fail" ? STATUS_PALETTE.critical : undefined }}>
        {STATUS_LABEL[status]}
        {count > 0 && status !== "pass" ? ` (${count})` : ""}
      </Text>
    </Flex>
  );
}

/** Links on this tab: page text colour with an underline (the default link blue is unreadable on the dark theme). */
const linkStyle: React.CSSProperties = { color: "inherit", textDecoration: "underline", textUnderlineOffset: 2 };

function DiagnoseButton({ selected, onClick }: { selected: boolean; onClick: () => void }) {
  return (
    <Button variant={selected ? "accent" : "default"} size="condensed" onClick={onClick} aria-pressed={selected}>
      {selected ? "Selected" : "Diagnose"}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Summary gauges
// ---------------------------------------------------------------------------
function SummaryGauges({ data, onInfo }: { data: AgData; onInfo: () => void }) {
  const { ags, health, configs, settings, target, targetSource, updateOf, ctxOf } = data;
  const total = ags.length;
  const online = ags.filter((a) => a.online).length;
  const versioned = ags.filter((a) => a.version);
  const within = versioned.filter((a) => (releasesBehind(a.version, target) ?? 0) <= BEHIND_WARN).length;
  const hostBased = ags.filter(updatable);
  const autoOn = settings.status === "ok" ? hostBased.filter((a) => updateOf(a)?.mode !== "MANUAL").length : 0;
  const withHealth = ags.filter((a) => health.has(a.agId));
  const noLoss = withHealth.filter((a) => !health.get(a.agId)?.dropped && !health.get(a.agId)?.rejected).length;
  const extOk = configs.filter((c) => !extIsProblem(c)).length;
  let used = 0;
  let measurable = 0;
  for (const ag of ags) {
    for (const id of ag.modules) {
      const s = moduleState(moduleDef(id), ag, ctxOf(ag)).state;
      if (s === "active" || s === "issue" || s === "idle") measurable++;
      if (s === "active" || s === "issue") used++;
    }
  }
  return (
    <Flex gap={16} flexWrap="wrap" justifyContent="space-around">
      <PctGauge pct={pct(online, total)} caption="ActiveGates connected" detail={`${online} of ${total} seen in the last ${AG_OFFLINE_MINUTES} min`} onInfo={onInfo} />
      <PctGauge pct={pct(within, versioned.length)} caption={`Within ${BEHIND_WARN} releases of target`} detail={`${within} of ${versioned.length}; target ${shortVersion(target) || "unknown"}`} onInfo={onInfo} />
      {settings.status === "ok" ? (
        <PctGauge pct={pct(autoOn, hostBased.length)} caption="Automatic updates" detail={`${autoOn} of ${hostBased.length} host-based ActiveGates`} onInfo={onInfo} />
      ) : (
        <div style={{ width: 188, textAlign: "center", alignSelf: "center" }}>
          <Text style={{ display: "block", fontWeight: 600 }}>Automatic updates</Text>
          <Text style={hint}>{settings.status === "loading" ? "Reading the update settings…" : `Not readable: ${settings.message}`}</Text>
        </div>
      )}
      <PctGauge pct={pct(noLoss, withHealth.length)} caption="No message loss" detail={`${noLoss} of ${withHealth.length} without dropped or rejected messages`} onInfo={onInfo} />
      {configs.length > 0 && <PctGauge pct={pct(extOk, configs.length)} caption="Extension configurations OK" detail={`${extOk} of ${configs.length} on ActiveGate groups`} onInfo={onInfo} />}
      <PctGauge pct={pct(used, measurable)} caption="Enabled modules in use" detail={`${used} of ${measurable} with an activity metric`} onInfo={onInfo} />
      <Text style={{ ...hint, flexBasis: "100%", textAlign: "center" }}>Versions compared with the {targetSource}. Releases go up by 2 (1.343, 1.345, 1.347).</Text>
    </Flex>
  );
}

// ---------------------------------------------------------------------------
// Module matrix
// ---------------------------------------------------------------------------
function ModulesCard({ data, ags, selectedId, onSelect }: { data: AgData; ags: ActiveGate[]; selectedId?: string; onSelect: (ag: ActiveGate) => void }) {
  const { ctxOf } = data;
  const columns = useMemo(() => {
    const present = new Set(ags.flatMap((a) => a.modules));
    const known = MODULES.filter((m) => present.has(m.id));
    const unknown = [...present].filter((id) => !MODULES.some((m) => m.id === id)).sort().map(moduleDef);
    return [...known, ...unknown];
  }, [ags]);
  const stateOf = useCallback((ag: ActiveGate, m: ModuleDef) => moduleState(m, ag, ctxOf(ag)), [ctxOf]);
  const counts = useMemo(() => {
    const c = { active: 0, issue: 0, idle: 0, on: 0, off: 0 } as Record<ModuleState, number>;
    for (const ag of ags) for (const m of columns) c[stateOf(ag, m).state]++;
    return c;
  }, [ags, columns, stateOf]);
  const summary = useMemo(
    () =>
      columns.map((m) => {
        const by: Record<ModuleState, string[]> = { active: [], issue: [], idle: [], on: [], off: [] };
        for (const ag of ags) by[stateOf(ag, m).state].push(ag.name);
        return { m, by };
      }),
    [ags, columns, stateOf],
  );
  return (
    <div style={card}>
      <Heading level={4}>Modules by ActiveGate</Heading>
      <Text style={{ ...hint, display: "block", margin: `${Spacings.Size4} 0 ${Spacings.Size8}` }}>
        Modules each ActiveGate reports as enabled (Smartscape), rated with its self-monitoring metrics over the timeframe: <strong>in use</strong> when the module&apos;s activity metric is above zero,{" "}
        <strong>not in use</strong> when it is enabled but its metric stayed at zero (enabled or deployed, but nothing started on it), <strong>problems</strong> from module errors (AWS data loss or failed requests, Kubernetes API
        failures, extension configurations not OK, rejected data points). Modules without an activity metric are shown as enabled only. Click an ActiveGate to diagnose it.
      </Text>
      <StateLegend counts={counts} />
      <div style={{ marginTop: Spacings.Size12 }}>
        {ags.length === 0 ? (
          <Text>No ActiveGates match.</Text>
        ) : (
          <ModuleMatrix ags={ags} modules={columns} stateOf={stateOf} sublabel={(ag) => [TYPE_LABEL[ag.type] ?? ag.type, ag.group && `group ${ag.group}`, ag.containerized && "container"].filter(Boolean).join(" · ")} selectedId={selectedId} onSelect={onSelect} />
        )}
      </div>
      <details style={{ marginTop: Spacings.Size12 }}>
        <summary style={{ cursor: "pointer", fontSize: 12, opacity: 0.8 }}>Modules as a table (custom.properties keys)</summary>
        <div style={{ overflowX: "auto", marginTop: Spacings.Size8 }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
            <thead>
              <tr>
                {["Module", "Group", ...STATE_ORDER.filter((s) => s !== "off").map((s) => MODULE_STATE_LABEL[s]), "custom.properties"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "4px 8px", borderBottom: "1px solid rgba(128,128,128,0.3)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summary.map(({ m, by }) => (
                <tr key={m.id}>
                  <td style={{ padding: "4px 8px" }} title={m.detail}>
                    {m.label}
                  </td>
                  <td style={{ padding: "4px 8px" }}>{m.group}</td>
                  {STATE_ORDER.filter((s) => s !== "off").map((s) => (
                    <td key={s} style={{ padding: "4px 8px" }} title={by[s].join(", ")}>
                      {by[s].length ? (
                        <Flex gap={4} alignItems="center">
                          <StateSwatch state={s} size={12} /> {by[s].length}
                        </Flex>
                      ) : (
                        "—"
                      )}
                    </td>
                  ))}
                  <td style={{ padding: "4px 8px", fontFamily: "monospace" }}>{m.section ? `[${m.section}] ${m.key}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Donuts: version, update mode, deployment
// ---------------------------------------------------------------------------
function DonutsRow({ data, theme, slice, onSlice }: { data: AgData; theme: Theme; slice: SliceSel | null; onSlice: (s: SliceSel | null) => void }) {
  const { ags, updateOf, settings, target } = data;
  const versions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ag of ags) counts.set(versionKey(ag), (counts.get(versionKey(ag)) ?? 0) + 1);
    const sorted = [...counts.entries()].sort((a, b) => minorOf(b[0]) - minorOf(a[0]));
    const shown = sorted.slice(0, VERSION_SLICES);
    const older = sorted.slice(VERSION_SLICES).reduce((s, [, v]) => s + v, 0);
    const slices: Slice[] = shown.map(([label, value], i) => ({ id: label, label: `${label}${label === `1.${minorOf(target)}` ? " (target)" : ""}`, value, color: categoryColor({ id: label, label, slot: label === "Unknown" ? null : i + 1, detail: "" }, theme) }));
    if (older) slices.push({ id: "OLDER", label: "Older", value: older, color: categoryColor({ id: "OLDER", label: "Older", slot: null, detail: "" }, theme) });
    return slices;
  }, [ags, target, theme]);
  const toSlices = (cats: Category[], keyOf: (ag: ActiveGate) => string): Slice[] => {
    const counts = new Map<string, number>();
    for (const ag of ags) counts.set(keyOf(ag), (counts.get(keyOf(ag)) ?? 0) + 1);
    return cats.filter((c) => counts.get(c.id)).map((c) => ({ id: c.id, label: c.label, value: counts.get(c.id)!, color: categoryColor(c, theme) }));
  };
  const update = toSlices(UPDATE_CATS, (ag) => updateKey(ag, updateOf(ag)));
  const deployment = toSlices(DEPLOYMENT_CATS, deploymentOf);
  const donut = (kind: SliceKind, title: string, slices: Slice[], note?: string) => (
    <div style={{ ...card, minWidth: 0 }}>
      <Heading level={4}>{title}</Heading>
      <div style={{ marginTop: Spacings.Size8 }}>
        {slices.length === 0 ? (
          <Text>No ActiveGates.</Text>
        ) : (
          <Donut slices={slices} size={DONUT_SIZE} centerLabel="ActiveGates" ariaLabel={title} selectedId={slice?.kind === kind ? slice.id : null} onSelect={(id) => onSlice(id ? { kind, id } : null)} />
        )}
      </div>
      {note && <Text style={{ ...hint, display: "block", marginTop: Spacings.Size8 }}>{note}</Text>}
    </div>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 16 }}>
      {donut("version", "ActiveGates by version", versions, `Target ${shortVersion(target) || "unknown"}; Fleet Management warns beyond ${BEHIND_WARN} releases behind.`)}
      {donut("update", "ActiveGates by update mode", update, settings.status === "error" ? `Update settings not readable: ${settings.message}` : "Effective mode: the ActiveGate's own setting, else the environment one. Containerized ActiveGates are updated by the Operator.")}
      {donut("deployment", "ActiveGates by deployment", deployment)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Self-monitoring: messages (small multiples) and the ActiveGate table
// ---------------------------------------------------------------------------
type AgRow = {
  ag: ActiveGate;
  h?: AgHealth;
  checks: AgCheck[];
  status: CheckStatus;
  problems: number;
  behind: number | null;
  update?: EffectiveUpdate;
  token?: AgToken | null;
  zone?: ZoneRow;
  modulesUsed: number;
  extOk: number;
  extBad: number;
  unassigned: number;
};

function MessagesCard({ data, ags, theme, onSelect }: { data: AgData; ags: ActiveGate[]; theme: Theme; onSelect: (ag: ActiveGate) => void }) {
  const { health } = data;
  const color = SERIES_BLUE[theme];
  const rows = (key: "dropped" | "rejected" | "resent" | "queueMax"): BarRow[] =>
    ags
      .map((ag) => ({ id: ag.id, label: ag.name, value: Math.round(health.get(ag.agId)?.[key] ?? 0) }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value);
  const select = (id: string) => {
    const ag = ags.find((a) => a.id === id);
    if (ag) onSelect(ag);
  };
  const blocks: { key: "dropped" | "rejected" | "resent" | "queueMax"; title: string; meaning: string; unit: string; empty: string }[] = [
    { key: "rejected", title: "Messages rejected", meaning: "Authorization issues; non-zero is data loss.", unit: "messages", empty: "No message rejected." },
    { key: "dropped", title: "Messages dropped", meaning: "Timeouts; non-zero may be data loss.", unit: "messages", empty: "No message dropped." },
    { key: "resent", title: "Messages resent", meaning: "Early warning: can end in dropped messages.", unit: "messages", empty: "No message resent." },
    { key: "queueMax", title: "Outgoing queue (peak)", meaning: "Growing = arriving faster than sent.", unit: "messages queued", empty: "No queue reported." },
  ];
  return (
    <div style={card}>
      <Heading level={4}>Messages: rejected, dropped, resent</Heading>
      <Text style={{ ...hint, display: "block", marginBottom: Spacings.Size8 }}>
        ActiveGate communication self-monitoring (dsfm:active_gate.communication.*) summed over the timeframe; each chart has its own scale. Click a bar to diagnose that ActiveGate.
      </Text>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 24 }}>
        {blocks.map((b) => (
          <div key={b.key}>
            <Text style={{ fontWeight: 600, display: "block" }}>{b.title}</Text>
            <Text style={{ ...hint, display: "block", marginBottom: 6 }}>{b.meaning}</Text>
            <BarList rows={rows(b.key)} color={color} unit={b.unit} empty={b.empty} onSelect={select} />
          </div>
        ))}
      </div>
    </div>
  );
}

const fmtNum = (v: number | null | undefined) => (v === null || v === undefined ? "—" : Math.round(v).toLocaleString());

/** Table column that holds the evidence of each check, so the column behind a finding can be highlighted. */
const CHECK_FIELD: Record<string, string> = {
  online: "name",
  version: "version",
  "auto-update": "update",
  token: "token",
  rejected: "rejected",
  dropped: "dropped",
  resent: "resent",
  heap: "heap",
  disk: "disk",
  cpu: "cpu",
  unassigned: "extensions",
  "module-EXTENSION_CONTROLLER": "extensions",
  idle: "modules",
  "k8s-forbidden": "modules",
  group: "group",
  zone: "zone",
};
const fieldOf = (c: AgCheck) => CHECK_FIELD[c.id] ?? (c.id.startsWith("module-") ? "modules" : undefined);
const UPDATE_SHORT: Record<string, string> = { AUTOMATIC: "Automatic", AUTOMATIC_DURING_UW: "Automatic (window)", MANUAL: "Off (manual)", OPERATOR: "Operator", UNKNOWN: "—" };

/**
 * Highlights a cell that is the source of a check: red for Blocking, amber for Check (the check titles are its tooltip).
 * Passed and info checks leave the cell as is.
 */
function Hl({ row, field, children }: { row: AgRow; field: string; children: React.ReactNode }) {
  const hits = row.checks.filter((c) => (c.status === "fail" || c.status === "warn") && fieldOf(c) === field);
  if (!hits.length) return <span style={{ fontSize: 12 }}>{children}</span>;
  const fail = hits.some((c) => c.status === "fail");
  return (
    <span
      title={hits.map((c) => `${STATUS_LABEL[c.status]}: ${c.title}`).join("\n")}
      style={{
        fontSize: 12,
        fontWeight: 700,
        color: fail ? STATUS_PALETTE.critical : STATUS_COLOR.warn,
        background: fail ? "rgba(208,59,59,0.14)" : "rgba(250,178,25,0.12)",
        borderRadius: 4,
        padding: "1px 5px",
        boxDecorationBreak: "clone",
      }}
    >
      {children}
    </span>
  );
}

function HealthTable({ rows, tf, selectedId, onSelect }: { rows: AgRow[]; tf: Timeframe; selectedId?: string; onSelect: (ag: ActiveGate) => void }) {
  const [filter, setFilter] = useState("");
  // Blockers first, then checks, then the rest; by name within a status.
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const matched = f ? rows.filter((r) => [r.ag.name, r.ag.group, r.ag.networkZone, r.ag.version].some((v) => v.toLowerCase().includes(f))) : rows;
    return matched.slice().sort((a, b) => CHECK_ORDER.indexOf(a.status) - CHECK_ORDER.indexOf(b.status) || b.problems - a.problems || a.ag.name.localeCompare(b.ag.name, undefined, { sensitivity: "base" }));
  }, [rows, filter]);
  const columns = useMemo<DataTableColumnDef<AgRow>[]>(
    () => [
      { id: "status", header: "Status", accessor: (r) => CHECK_ORDER.indexOf(r.status) * 100 - r.problems, width: 120, cell: ({ rowData: r }) => <StatusCell status={r.status} count={r.problems} /> },
      {
        id: "name",
        header: "ActiveGate",
        accessor: (r) => r.ag.name,
        width: 240,
        cell: ({ rowData: r }) => {
          const url = r.ag.clusterId ? entityOverviewLink("K8S_CLUSTER", r.ag.clusterId, tf) : undefined;
          return (
            <div style={{ minWidth: 0, wordBreak: "break-word" }}>
              <Hl row={r} field="name">
                {!r.ag.online && "● "}
                {r.ag.name}
              </Hl>
              <Text style={{ fontSize: 11, opacity: 0.7, display: "block" }}>
                {TYPE_LABEL[r.ag.type] ?? r.ag.type}
                {r.ag.containerized && (
                  <>
                    {" · "}
                    {url ? (
                      <a href={url} target="_blank" rel="noreferrer noopener" style={linkStyle}>
                        {r.ag.clusterName || "cluster"} ↗
                      </a>
                    ) : (
                      r.ag.clusterName || "container"
                    )}
                  </>
                )}
              </Text>
            </div>
          );
        },
      },
      { id: "group", header: "Group", accessor: (r) => r.ag.group, width: 120, cell: ({ rowData: r }) => <Hl row={r} field="group">{r.ag.group || "—"}</Hl> },
      {
        id: "zone",
        header: "Network zone",
        accessor: (r) => r.ag.networkZone,
        width: 140,
        cell: ({ rowData: r }) => (
          <div>
            <Hl row={r} field="zone">{r.ag.networkZone || DEFAULT_ZONE}</Hl>
            {r.zone?.fallback && (
              <Text style={{ fontSize: 11, opacity: 0.7, display: "block", color: r.zone.fallback === "NONE" ? STATUS_COLOR.warn : undefined }}>
                fallback {FALLBACK_LABEL[r.zone.fallback] ?? r.zone.fallback}
                {r.zone.configured ? "" : " (default)"}
              </Text>
            )}
          </div>
        ),
      },
      {
        id: "version",
        header: "Version",
        accessor: (r) => minorOf(r.ag.version),
        width: 110,
        cell: ({ rowData: r }) => (
          <div>
            <Hl row={r} field="version">{shortVersion(r.ag.version) || "—"}</Hl>
            {r.behind ? <Text style={{ fontSize: 11, opacity: 0.75, display: "block" }}>{plural(r.behind, "release")} behind</Text> : null}
          </div>
        ),
      },
      {
        id: "update",
        header: "Updates",
        accessor: (r) => updateKey(r.ag, r.update),
        width: 110,
        cell: ({ rowData: r }) => (
          <div>
            <Hl row={r} field="update">{UPDATE_SHORT[updateKey(r.ag, r.update)]}</Hl>
            {r.update?.origin === "ActiveGate" && <Text style={{ fontSize: 11, opacity: 0.7, display: "block" }}>own setting</Text>}
          </div>
        ),
      },
      {
        id: "token",
        header: "Token",
        accessor: (r) => (r.token?.expirationDate ? Date.parse(r.token.expirationDate) : Number.MAX_SAFE_INTEGER),
        width: 100,
        cell: ({ rowData: r }) => {
          const days = r.token ? tokenDaysLeft(r.token) : null;
          return <Hl row={r} field="token">{r.token === undefined ? "—" : r.token === null ? "not listed" : days === null ? "no expiry" : days < 0 ? "expired" : `${days} days left`}</Hl>;
        },
      },
      { id: "rejected", header: "Rejected", accessor: (r) => r.h?.rejected ?? -1, width: 90, cell: ({ rowData: r }) => <Hl row={r} field="rejected">{fmtNum(r.h?.rejected)}</Hl> },
      { id: "dropped", header: "Dropped", accessor: (r) => r.h?.dropped ?? -1, width: 85, cell: ({ rowData: r }) => <Hl row={r} field="dropped">{fmtNum(r.h?.dropped)}</Hl> },
      { id: "resent", header: "Resent", accessor: (r) => r.h?.resent ?? -1, width: 80, cell: ({ rowData: r }) => <Hl row={r} field="resent">{fmtNum(r.h?.resent)}</Hl> },
      { id: "queue", header: "Queue peak", accessor: (r) => r.h?.queueMax ?? -1, width: 90, cell: ({ rowData: r }) => <Hl row={r} field="queue">{fmtNum(r.h?.queueMax)}</Hl> },
      { id: "heap", header: "Heap", accessor: (r) => heapPct(r.h) ?? -1, width: 70, cell: ({ rowData: r }) => <Hl row={r} field="heap">{heapPct(r.h) === null ? "—" : `${heapPct(r.h)}%`}</Hl> },
      { id: "disk", header: "Disk free", accessor: (r) => diskFreePct(r.h) ?? 101, width: 80, cell: ({ rowData: r }) => <Hl row={r} field="disk">{diskFreePct(r.h) === null ? "—" : `${diskFreePct(r.h)}%`}</Hl> },
      { id: "cpu", header: "CPU peak", accessor: (r) => r.h?.sysCpu ?? -1, width: 80, cell: ({ rowData: r }) => <Hl row={r} field="cpu">{r.h?.sysCpu === null || r.h?.sysCpu === undefined ? "—" : `${Math.round(r.h.sysCpu)}%`}</Hl> },
      { id: "modules", header: "Modules in use", accessor: (r) => r.modulesUsed, width: 100, cell: ({ rowData: r }) => <Hl row={r} field="modules">{r.modulesUsed} of {r.ag.modules.length}</Hl> },
      {
        id: "extensions",
        header: "Extensions",
        accessor: (r) => r.extBad * 1000 + r.unassigned * 100 + r.extOk,
        width: 120,
        cell: ({ rowData: r }) => (
          <Hl row={r} field="extensions">
            {r.extOk + r.extBad + r.unassigned === 0 ? "—" : [r.extOk && `${r.extOk} OK`, r.extBad && `${r.extBad} not OK`, r.unassigned && `${r.unassigned} not picked up`].filter(Boolean).join(" · ")}
          </Hl>
        ),
      },
      { id: "diagnose", header: "", accessor: (r) => r.ag.id, width: 100, cell: ({ rowData: r }) => <DiagnoseButton selected={r.ag.id === selectedId} onClick={() => onSelect(r.ag)} /> },
    ],
    [tf, selectedId, onSelect],
  );
  return (
    <div style={card}>
      <Flex justifyContent="space-between" alignItems="flex-end" flexWrap="wrap" gap={8}>
        <div>
          <Heading level={4}>ActiveGates</Heading>
          <Text style={hint}>
            Blocking first. The cell behind a finding is highlighted: <span style={{ color: STATUS_PALETTE.critical, fontWeight: 700 }}>red = blocking</span>, <span style={{ color: STATUS_COLOR.warn, fontWeight: 700 }}>amber = check</span> (hover it for the finding). Heap = average
            used share of the heap; disk = lowest free share of the volume; CPU = peak host CPU.
          </Text>
        </div>
        <Field label="Filter">
          <TextInput value={filter} placeholder="name, group, zone, version" onChange={(v: string) => setFilter(v)} />
        </Field>
      </Flex>
      <div style={{ marginTop: Spacings.Size8 }}>
        <DataTable data={shown} columns={columns} sortable resizable defaultLineWrap defaultSortBy={[{ id: "status", desc: false }]} fullWidth variant={{ rowDensity: "condensed" }}>
          <DataTable.EmptyState>No ActiveGates match.</DataTable.EmptyState>
        </DataTable>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Module detail: AWS, Kubernetes API, ingest rejections
// ---------------------------------------------------------------------------
const AWS_STATUS_COLOR: Record<string, string> = { ok: STATUS_PALETTE.good, timeout: STATUS_PALETTE.warning, network_error: STATUS_PALETTE.serious, throttling_error: STATUS_PALETTE.serious, authentication_error: STATUS_PALETTE.critical, "4xx": STATUS_PALETTE.critical, "5xx": STATUS_PALETTE.critical };

function ModuleDetailCard({ data, onSelect }: { data: AgData; onSelect: (ag: ActiveGate) => void }) {
  const { detail, ags, states, queries } = data;
  const byAgId = useMemo(() => new Map(ags.map((a) => [a.agId, a])), [ags]);
  const nameOf = (agId: string) => (agId === "unassigned" ? "No ActiveGate (unassigned)" : byAgId.get(agId)?.name ?? agId);
  const awsAgs = [...new Set(detail.filter((r) => r.metric === "aws.requests").map((r) => r.agId))];
  const lost = detail.filter((r) => r.metric === "aws.data_lost");
  const creds = detail.filter((r) => r.metric === "aws.credentials");
  const k8s = detail.filter((r) => r.metric === "k8s.api_errors");
  const rejectedRows = detail.filter((r) => r.metric === "metrics.rejected" || r.metric === "otlp.rejected");
  const link = (agId: string) => {
    const ag = byAgId.get(agId);
    return ag ? (
      <button type="button" onClick={() => onSelect(ag)} style={{ all: "unset", cursor: "pointer", textDecoration: "underline", fontSize: 12 }}>
        {ag.name}
      </button>
    ) : (
      <span style={{ fontSize: 12 }}>{nameOf(agId)}</span>
    );
  };
  const cell: React.CSSProperties = { padding: "4px 8px", fontSize: 12, verticalAlign: "top" };
  const head = (cols: string[]) => (
    <thead>
      <tr>
        {cols.map((c) => (
          <th key={c} style={{ ...cell, textAlign: "left", borderBottom: "1px solid rgba(128,128,128,0.3)" }}>
            {c}
          </th>
        ))}
      </tr>
    </thead>
  );
  const nothing = awsAgs.length === 0 && creds.length === 0 && k8s.length === 0 && rejectedRows.length === 0;
  return (
    <div style={card}>
      <Heading level={4}>Module self-monitoring</Heading>
      <Text style={{ ...hint, display: "block", marginBottom: Spacings.Size8 }}>Module-specific metrics: AWS requests and data loss, Kubernetes API calls that did not return 200, rejected metric and OTLP data points.</Text>
      <QueryState state={states.detail}>
        <Flex flexDirection="column" gap={16}>
          {nothing && <Text>No AWS, Kubernetes or ingest problems in this timeframe.</Text>}
          {awsAgs.map((agId) => {
            const segs: Segment[] = detail
              .filter((r) => r.metric === "aws.requests" && r.agId === agId)
              .sort((a, b) => (a.key === "ok" ? -1 : b.key === "ok" ? 1 : b.n - a.n))
              .map((r) => ({ label: r.key === "ok" ? "OK" : r.key.replace(/_/g, " "), value: r.n, color: AWS_STATUS_COLOR[r.key] ?? STATUS_PALETTE.neutral }));
            const agLost = lost.filter((r) => r.agId === agId);
            return (
              <div key={agId}>
                <Text style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>AWS requests by response status · {link(agId)}</Text>
                <StackedBar segments={segs} unit="requests" />
                {agLost.length > 0 && (
                  <Text style={{ fontSize: 12, display: "block", marginTop: 6 }}>
                    <span style={{ color: STATUS_PALETTE.critical, fontWeight: 700 }}>! Data lost</span> (data_lost_monitoring_status = 1, &quot;some data lost&quot;): {agLost.map((r) => r.key).join("; ")}
                  </Text>
                )}
              </div>
            );
          })}
          {creds.length > 0 && (
            <div>
              <Text style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>AWS connections and the ActiveGate that runs them</Text>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                {head(["Connection", "ActiveGate"])}
                <tbody>
                  {creds.map((r) => (
                    <tr key={`${r.agId}-${r.key}`}>
                      <td style={cell}>{r.key}</td>
                      <td style={cell}>{r.agId === "unassigned" ? <span style={{ color: STATUS_PALETTE.critical, fontWeight: 700 }}>! No ActiveGate runs it (unassigned)</span> : link(r.agId)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {k8s.length > 0 && (
            <div>
              <Text style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>Kubernetes API calls that did not return 200</Text>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                {head(["ActiveGate", "Status", "Path", "Calls", "Meaning"])}
                <tbody>
                  {k8s.map((r) => {
                    const code = r.key.split(" ")[0];
                    const meaning = isK8sBenign(r.key) ? "Expected: OpenShift API on a cluster that is not OpenShift" : isK8sForbidden(r.key) ? "Access denied: the service account may not call it (RBAC)" : code === "-1" ? "No HTTP response (endpoint not reachable)" : "Failed";
                    const color = isK8sBenign(r.key) ? undefined : isK8sForbidden(r.key) ? undefined : STATUS_PALETTE.critical;
                    return (
                      <tr key={`${r.agId}-${r.key}`}>
                        <td style={cell}>{link(r.agId)}</td>
                        <td style={{ ...cell, fontWeight: 700, color }}>{code}</td>
                        <td style={{ ...cell, fontFamily: "monospace" }}>{r.key.slice(r.key.indexOf(" ") + 1)}</td>
                        <td style={cell}>{r.n.toLocaleString()}</td>
                        <td style={cell}>{meaning}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {rejectedRows.length > 0 && (
            <div>
              <Text style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>Rejected data points by reason</Text>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                {head(["ActiveGate", "Ingest", "Reason", "Data points"])}
                <tbody>
                  {rejectedRows.map((r) => (
                    <tr key={`${r.agId}-${r.metric}-${r.key}`}>
                      <td style={cell}>{link(r.agId)}</td>
                      <td style={cell}>{r.metric === "otlp.rejected" ? "OTLP" : "Metrics"}</td>
                      <td style={{ ...cell, fontFamily: "monospace" }}>{r.key || "—"}</td>
                      <td style={cell}>{r.n.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Flex>
      </QueryState>
      <div style={{ marginTop: Spacings.Size8 }}>
        <QueryActions title="ActiveGates: module self-monitoring detail" query={queries.detail} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Extensions on ActiveGate groups
// ---------------------------------------------------------------------------
export const extColor = (status: string) =>
  status === "OK" ? STATUS_PALETTE.good : status === "IDLE" ? STATUS_PALETTE.neutral : status === "WARNING" ? STATUS_PALETTE.warning : status === "UNASSIGNED" ? STATUS_PALETTE.serious : STATUS_PALETTE.critical;
const EXT_GLYPH = (status: string) => (status === "OK" ? "✓" : status === "IDLE" ? "•" : status === "WARNING" ? "–" : "!");

function ExtGlyph({ status }: { status: string }) {
  return (
    <span aria-hidden style={{ width: 14, height: 14, borderRadius: 4, flex: "none", background: extColor(status), color: status === "WARNING" ? "#1a1a19" : "#fff", fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      {EXT_GLYPH(status)}
    </span>
  );
}

/** Status code on the first line, its meaning below (wraps instead of running into the next column). */
function ExtStatusCell({ status }: { status: string }) {
  return (
    <Flex gap={6} alignItems="flex-start">
      <ExtGlyph status={status} />
      <div style={{ minWidth: 0 }}>
        <Text style={{ fontSize: 12, fontWeight: 700, display: "block", wordBreak: "break-word" }}>{status}</Text>
        {EXT_STATUS_TEXT[status] && <Text style={{ fontSize: 11, opacity: 0.75, display: "block" }}>{EXT_STATUS_TEXT[status]}</Text>}
      </div>
    </Flex>
  );
}

/** Extension name as plain text, with its links (Extensions app, configuration page) underneath. */
export function ExtNameCell({ c }: { c: { extension: string; dataSource?: string; configEntity?: string } }) {
  const app = extensionAppLink(c.extension);
  const cfg = extensionConfigLink(c.configEntity);
  return (
    <div style={{ minWidth: 0 }}>
      <Text style={{ fontSize: 12, display: "block", wordBreak: "break-word" }}>{c.extension}</Text>
      {(c.dataSource || app || cfg) && (
        <Text style={{ fontSize: 11, opacity: 0.8, display: "block" }}>
          {c.dataSource}
          {app && (
            <>
              {c.dataSource ? " · " : ""}
              <a href={app} target="_blank" rel="noreferrer noopener" style={linkStyle}>
                Extensions app ↗
              </a>
            </>
          )}
          {cfg && (
            <>
              {" · "}
              <a href={cfg} target="_blank" rel="noreferrer noopener" style={linkStyle}>
                configuration ↗
              </a>
            </>
          )}
        </Text>
      )}
    </div>
  );
}

function ExtensionsCard({ data }: { data: AgData }) {
  const { configs, ags, states, queries } = data;
  const [show, setShow] = useState<"problems" | "all">("problems");
  const [status, setStatus] = useState<string | null>(null);
  const byAgId = useMemo(() => new Map(ags.map((a) => [a.agId, a])), [ags]);
  const slices = useMemo<Slice[]>(() => {
    const counts = new Map<string, number>();
    for (const c of configs) counts.set(c.status, (counts.get(c.status) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => (a[0] === "OK" ? -1 : b[0] === "OK" ? 1 : b[1] - a[1])).map(([id, value]) => ({ id, label: id, value, color: extColor(id) }));
  }, [configs]);
  const rows = useMemo(() => configs.filter((c) => (status ? c.status === status : show === "all" || extIsProblem(c))), [configs, show, status]);
  const columns = useMemo<DataTableColumnDef<ExtConfig>[]>(
    () => [
      { id: "status", header: "Status", accessor: (c) => (c.status === "OK" ? "~" : c.status), width: 200, cell: ({ rowData: c }) => <ExtStatusCell status={c.status} /> },
      { id: "extension", header: "Extension", accessor: "extension", width: 320, cell: ({ rowData: c }) => <ExtNameCell c={c} /> },
      { id: "group", header: "ActiveGate group", accessor: "group", width: 160, cell: ({ rowData: c }) => <Text style={{ fontSize: 12, wordBreak: "break-word" }}>{c.group}</Text> },
      {
        id: "ag",
        header: "Runs on",
        accessor: (c) => (c.agId ? byAgId.get(c.agId)?.name ?? c.agId : ""),
        width: 260,
        cell: ({ rowData: c }) => {
          if (c.agId) return <Text style={{ fontSize: 12, wordBreak: "break-word" }}>{byAgId.get(c.agId)?.name ?? c.agId}</Text>;
          const eec = ags.filter((a) => a.group === c.group && a.modules.includes("EXTENSION_CONTROLLER"));
          return (
            <span title={eec.length ? `ActiveGates in ${c.group} with the Extensions module: ${eec.map((a) => a.name).join(", ")}` : undefined}>
              <Text style={{ fontSize: 12, fontWeight: 700, color: STATUS_PALETTE.critical, display: "block" }}>No ActiveGate</Text>
              <Text style={{ fontSize: 11, opacity: 0.8, display: "block" }}>{eec.length ? `${plural(eec.length, "eligible ActiveGate")} in the group` : "no ActiveGate in the group has the Extensions module"}</Text>
            </span>
          );
        },
      },
      {
        id: "message",
        header: "Reason",
        accessor: (c) => (c.message ? 1 : 0),
        width: 110,
        cell: ({ rowData: c }) => (c.message ? <Text style={{ fontSize: 12 }}>{c.messageLevel === "ERROR" ? "Error" : "Warning"} below</Text> : <Text style={{ fontSize: 12, opacity: 0.6 }}>—</Text>),
      },
    ],
    [byAgId, ags],
  );
  return (
    <div style={card}>
      <Flex justifyContent="space-between" alignItems="flex-end" flexWrap="wrap" gap={8}>
        <div>
          <Heading level={4}>Extensions on ActiveGate groups</Heading>
          <Text style={hint}>
            Latest status of every monitoring configuration assigned to an ActiveGate group (dt.sfm.extension.status). UNASSIGNED = assigned to the group, but no ActiveGate picked it up. Every state except OK and IDLE is an error. The
            reasons are in Extension warnings and errors below. Click a slice to list that status.
          </Text>
        </div>
        <ToggleButtonGroup value={show} onChange={(v: string) => v && (setShow(v as "problems" | "all"), setStatus(null))} name="ext-show">
          <ToggleButtonGroup.Item value="problems">Not OK</ToggleButtonGroup.Item>
          <ToggleButtonGroup.Item value="all">All</ToggleButtonGroup.Item>
        </ToggleButtonGroup>
      </Flex>
      <QueryState state={states.extensions}>
        <div style={{ marginTop: Spacings.Size12 }}>
          {slices.length ? <Donut slices={slices} size={DONUT_SIZE} centerLabel="configurations" ariaLabel="Extension configurations by status" selectedId={status} onSelect={setStatus} /> : <Text>No extension runs on an ActiveGate group.</Text>}
        </div>
        <div style={{ marginTop: Spacings.Size12 }}>
          <DataTable data={rows} columns={columns} sortable resizable defaultLineWrap fullWidth variant={{ rowDensity: "condensed" }}>
            <DataTable.EmptyState>{show === "problems" ? "Every configuration on an ActiveGate group is OK." : "No configurations."}</DataTable.EmptyState>
          </DataTable>
        </div>
      </QueryState>
      <div style={{ marginTop: Spacings.Size8 }}>
        <QueryActions title="ActiveGates: extension configurations by status" query={queries.extensions} />
      </div>
    </div>
  );
}

type ExtEvent = { configId: string; extension: string; level: string; status: string; current?: string; content: string; timestamp: string; group: string; agId: string; configEntity?: string };
const LEVEL_RANK = ["ERROR", "WARN"];

/** Latest warning or error per monitoring configuration on an ActiveGate group, full text, newest first within a level. */
function ExtensionLogsCard({ data }: { data: AgData }) {
  const { configs, ags, states, queries } = data;
  const [only, setOnly] = useState<"problems" | "all">("problems");
  const byAgId = useMemo(() => new Map(ags.map((a) => [a.agId, a])), [ags]);
  const events = useMemo<ExtEvent[]>(() => {
    const byConfig = new Map(configs.map((c) => [c.configId, c]));
    return (states.events.data?.records ?? [])
      .map((r) => {
        const cfg = byConfig.get(String(r.configId));
        return {
          configId: String(r.configId),
          extension: String(r.extension ?? cfg?.extension ?? ""),
          level: String(r.loglevel ?? ""),
          status: String(r.status ?? ""),
          current: cfg?.status,
          content: String(r.content ?? ""),
          timestamp: String(r.timestamp ?? ""),
          group: String(r.group ?? cfg?.group ?? ""),
          agId: String(r.agId ?? cfg?.agId ?? ""),
          configEntity: cfg?.configEntity,
        };
      })
      .filter((e) => e.current !== undefined || e.group || e.agId)
      .sort((a, b) => (LEVEL_RANK.indexOf(a.level) + 1 || 9) - (LEVEL_RANK.indexOf(b.level) + 1 || 9) || b.timestamp.localeCompare(a.timestamp));
  }, [configs, states.events.data]);
  const rows = useMemo(() => (only === "all" ? events : events.filter((e) => !e.current || !["OK", "IDLE"].includes(e.current))), [events, only]);
  const columns = useMemo<DataTableColumnDef<ExtEvent>[]>(
    () => [
      { id: "when", header: "When (UTC)", accessor: "timestamp", width: 130, cell: ({ rowData: e }) => <Text style={{ fontSize: 12 }}>{e.timestamp.slice(0, 16).replace("T", " ")}</Text> },
      {
        id: "level",
        header: "Level",
        accessor: (e) => LEVEL_RANK.indexOf(e.level),
        width: 90,
        cell: ({ rowData: e }) => <Text style={{ fontSize: 12, fontWeight: 700, color: e.level === "ERROR" ? STATUS_PALETTE.critical : STATUS_COLOR.warn }}>{e.level === "ERROR" ? "Error" : e.level === "WARN" ? "Warning" : e.level}</Text>,
      },
      { id: "extension", header: "Extension", accessor: "extension", width: 280, cell: ({ rowData: e }) => <ExtNameCell c={e} /> },
      { id: "current", header: "Status now", accessor: (e) => e.current ?? e.status, width: 170, cell: ({ rowData: e }) => <ExtStatusCell status={e.current ?? e.status ?? "—"} /> },
      { id: "where", header: "Group / ActiveGate", accessor: (e) => `${e.group} ${e.agId}`, width: 200, cell: ({ rowData: e }) => <Text style={{ fontSize: 12, wordBreak: "break-word" }}>{[e.group, e.agId && (byAgId.get(e.agId)?.name ?? e.agId)].filter(Boolean).join(" · ") || "—"}</Text> },
      { id: "content", header: "Message", accessor: "content", width: 560, cell: ({ rowData: e }) => <Text style={{ fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{e.content}</Text> },
    ],
    [byAgId],
  );
  return (
    <div style={card}>
      <Flex justifyContent="space-between" alignItems="flex-end" flexWrap="wrap" gap={8}>
        <div>
          <Heading level={4}>Extension warnings and errors</Heading>
          <Text style={hint}>The latest warning or error the extension framework reported per monitoring configuration in the timeframe (dt.system.events, EXTENSIONS_EVENT), errors first.</Text>
        </div>
        <ToggleButtonGroup value={only} onChange={(v: string) => v && setOnly(v as "problems" | "all")} name="ext-log-show">
          <ToggleButtonGroup.Item value="problems">Configurations not OK</ToggleButtonGroup.Item>
          <ToggleButtonGroup.Item value="all">All</ToggleButtonGroup.Item>
        </ToggleButtonGroup>
      </Flex>
      <QueryState state={states.events}>
        <div style={{ marginTop: Spacings.Size12 }}>
          <DataTable data={rows} columns={columns} sortable resizable defaultLineWrap fullWidth variant={{ rowDensity: "condensed" }}>
            <DataTable.EmptyState>{only === "problems" ? "No warning or error for configurations that are not OK." : "No extension warning or error in the timeframe."}</DataTable.EmptyState>
          </DataTable>
        </div>
      </QueryState>
      <div style={{ marginTop: Spacings.Size8 }}>
        <QueryActions title="ActiveGates: latest extension framework warnings and errors" query={queries.events} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ActiveGate groups and network zones
// ---------------------------------------------------------------------------
const NEW_VALUE = "__new__";

/** Sets or clears the group or network zone of host-based ActiveGates with ONE remote configuration job (validate + preview first). */
function AssignForm({ ags, initial, attr: initialAttr = "group", values }: { ags: ActiveGate[]; initial?: ActiveGate[]; attr?: RemoteAttr; values: Record<RemoteAttr, string[]> }) {
  const eligible = useMemo(() => ags.filter(remotelyConfigurable), [ags]);
  const containerized = ags.filter((a) => !remotelyConfigurable(a));
  const [attr, setAttr] = useState<RemoteAttr>(initialAttr);
  const [op, setOp] = useState<"set" | "clear">("set");
  const [pick, setPick] = useState<string>(values[initialAttr][0] ?? NEW_VALUE);
  const [custom, setCustom] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(() => new Set((initial ?? []).filter(remotelyConfigurable).map((a) => a.agId)));
  const [plan, setPlan] = useState<RemotePlan | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const value = pick === NEW_VALUE ? custom : pick;
  const error = checkRemoteValue(attr, op, value) ?? (chosen.size === 0 ? "Select at least one ActiveGate." : null);
  const ids = [...chosen];
  const reset = () => {
    setPlan(null);
    setConfirm(false);
    setResult(null);
  };
  const toggle = (id: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(id);
    else next.delete(id);
    setChosen(next);
    reset();
  };
  const validate = async () => {
    setBusy(true);
    setResult(null);
    const p = await planAgRemoteConfig(ids, attr, op, value);
    setPlan(p);
    setBusy(false);
  };
  const apply = async () => {
    if (!plan?.ok) return;
    setBusy(true);
    const r = await runAgRemoteConfig(plan.valid, attr, op, value);
    setResult(r);
    setBusy(false);
    if (r.ok) setConfirm(false);
  };
  const body = { entities: ids, operations: [{ attribute: attr, operation: op, ...(op === "set" ? { value: attr === "networkZone" ? value.trim().toLowerCase() : value.trim() } : {}) }] };
  return (
    <Flex flexDirection="column" gap={12}>
      <Text>
        One remote configuration job for every selected host-based ActiveGate (1.237+): no restart, changes take up to 10 minutes, only one job runs at a time. Containerized ActiveGates are set in the DynaKube (manual step).
      </Text>
      <Flex gap={16} flexWrap="wrap" alignItems="flex-end">
        <Field label="Change">
          <Select
            value={attr}
            onChange={(v: string | null) => {
              if (!v) return;
              setAttr(v as RemoteAttr);
              setPick(values[v as RemoteAttr][0] ?? NEW_VALUE);
              reset();
            }}
          >
            <Select.Content>
              <Select.Option value="group">{REMOTE_ATTR_LABEL.group}</Select.Option>
              <Select.Option value="networkZone">{REMOTE_ATTR_LABEL.networkZone}</Select.Option>
            </Select.Content>
          </Select>
        </Field>
        <Field label="Operation">
          <Select value={op} onChange={(v: string | null) => v && (setOp(v as "set" | "clear"), reset())}>
            <Select.Content>
              <Select.Option value="set">Set</Select.Option>
              <Select.Option value="clear">Clear{attr === "networkZone" ? " (default zone)" : ""}</Select.Option>
            </Select.Content>
          </Select>
        </Field>
        {op === "set" && (
          <Field label={REMOTE_ATTR_LABEL[attr]}>
            <Select value={pick} onChange={(v: string | null) => v && (setPick(v), reset())}>
              <Select.Content>
                {values[attr].map((v) => (
                  <Select.Option key={v} value={v}>
                    {v}
                  </Select.Option>
                ))}
                <Select.Option value={NEW_VALUE}>New…</Select.Option>
              </Select.Content>
            </Select>
          </Field>
        )}
        {op === "set" && pick === NEW_VALUE && (
          <Field label={`New ${REMOTE_ATTR_LABEL[attr].toLowerCase()}`}>
            <TextInput value={custom} placeholder={attr === "networkZone" ? "e.g. aws.us-east-1.prod" : "e.g. extensions-prod"} onChange={(v: string) => (setCustom(v), reset())} />
          </Field>
        )}
      </Flex>
      <div>
        <Text style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>ActiveGates ({chosen.size} selected)</Text>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 4 }}>
          {eligible.map((a) => (
            <Checkbox key={a.agId} value={chosen.has(a.agId)} onChange={(v: boolean) => toggle(a.agId, v)}>
              {a.name} <span style={{ opacity: 0.65 }}>· {attr === "group" ? `group ${a.group || "—"}` : `zone ${a.networkZone || DEFAULT_ZONE}`}</span>
            </Checkbox>
          ))}
        </div>
        {containerized.length > 0 && <Text style={{ ...hint, display: "block", marginTop: 4 }}>Not offered (containerized): {containerized.map((a) => a.name).join(", ")}.</Text>}
      </div>
      <details>
        <summary style={{ cursor: "pointer", fontSize: 12, opacity: 0.8 }}>Request (validate 1-2 + preview 1 + run 1 call)</summary>
        <pre style={{ margin: "4px 0 0", padding: 10, borderRadius: 6, background: "rgba(128,128,128,0.12)", fontSize: 12, whiteSpace: "pre-wrap" }}>{`POST /api/v2/activeGates/remoteConfigurationManagement\n${json(body)}`}</pre>
      </details>
      {error && <Text style={{ color: STATUS_COLOR.warn, fontSize: 12 }}>{error}</Text>}
      <Flex gap={8} alignItems="center" flexWrap="wrap">
        <Button variant="default" disabled={busy || !!error} onClick={() => void validate()}>
          Validate
        </Button>
        <Checkbox value={confirm} onChange={(v: boolean) => setConfirm(v)} disabled={!plan?.ok}>
          {op === "set" ? `Set ${REMOTE_ATTR_LABEL[attr].toLowerCase()} "${attr === "networkZone" ? value.trim().toLowerCase() : value.trim()}"` : `Clear the ${REMOTE_ATTR_LABEL[attr].toLowerCase()}`} on {plural(plan?.valid.length ?? 0, "ActiveGate")}
        </Checkbox>
        <Button variant="emphasized" disabled={busy || !plan?.ok || !confirm} onClick={() => void apply()}>
          Run job
        </Button>
      </Flex>
      {plan && (
        <ResultLine
          result={{
            ok: plan.ok,
            message: `${plan.message}${plan.preview ? ` ${plan.preview.alreadyConfigured} already have this value.` : ""}${plan.invalid.length ? ` Skipped: ${plan.invalid.map((i) => `${ags.find((a) => a.agId === i.entity)?.name ?? i.entity} (${i.reasons.join(", ")})`).join("; ")}.` : ""}`,
          }}
        />
      )}
      <ResultLine result={result} />
    </Flex>
  );
}

/** Fallback mode and alternative zones of one network zone (PUT the zone's object, or POST a new one). */
function FallbackForm({ zones, settings, initialZone, onDone }: { zones: ZoneRow[]; settings: ZoneSettings; initialZone?: string; onDone: () => void }) {
  const editable = zones.filter((z) => z.zone !== DEFAULT_ZONE);
  const [zone, setZone] = useState(editable.find((z) => z.zone === initialZone)?.zone ?? editable[0]?.zone ?? "");
  const row = editable.find((z) => z.zone === zone);
  const [fallback, setFallback] = useState<FallbackMode>((row?.fallback as FallbackMode) || "ANY_ACTIVE_GATE");
  const [alts, setAlts] = useState<string[]>(row?.alternatives ?? []);
  useEffect(() => {
    setFallback((row?.fallback as FallbackMode) || "ANY_ACTIVE_GATE");
    setAlts(row?.alternatives ?? []);
  }, [row?.fallback, row?.alternatives]);
  if (editable.length === 0) return <Text>Only the default network zone exists, and it cannot be modified. Assign ActiveGates and OneAgents to a zone first.</Text>;
  const { existing, value } = zoneValue(zone, settings, fallback, alts);
  return (
    <Flex flexDirection="column" gap={12}>
      <Flex gap={16} flexWrap="wrap" alignItems="flex-end">
        <Field label="Network zone">
          <Select value={zone} onChange={(v: string | null) => v && setZone(v)}>
            <Select.Content>
              {editable.map((z) => (
                <Select.Option key={z.zone} value={z.zone}>
                  {z.zone} ({FALLBACK_LABEL[z.fallback] ?? "?"}
                  {z.configured ? "" : ", not configured"})
                </Select.Option>
              ))}
            </Select.Content>
          </Select>
        </Field>
        <Field label="Fallback mode">
          <Select value={fallback} onChange={(v: string | null) => v && setFallback(v as FallbackMode)}>
            <Select.Content>
              {FALLBACK_MODES.map((m) => (
                <Select.Option key={m} value={m}>
                  {FALLBACK_LABEL[m]}
                </Select.Option>
              ))}
            </Select.Content>
          </Select>
        </Field>
      </Flex>
      <Text style={hint}>{FALLBACK_TEXT[fallback]}</Text>
      <div>
        <Text style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>Alternative zones (their ActiveGates must be reachable from this zone&apos;s OneAgents)</Text>
        <Flex gap={12} flexWrap="wrap">
          {zones
            .filter((z) => z.zone !== zone)
            .map((z) => (
              <Checkbox key={z.zone} value={alts.includes(z.zone)} onChange={(v: boolean) => setAlts(v ? [...alts, z.zone] : alts.filter((x) => x !== z.zone))}>
                {z.zone} <span style={{ opacity: 0.65 }}>({plural(z.online, "connected ActiveGate")})</span>
              </Checkbox>
            ))}
        </Flex>
      </div>
      <ApiFix
        key={zone}
        summary={
          <>
            Sets fallback <strong>{FALLBACK_LABEL[fallback]}</strong>
            {alts.length ? ` and alternative zones ${alts.join(", ")}` : " and no alternative zone"} for network zone <strong>{zone}</strong> ({ZONES_SCHEMA}, {existing ? "PUT the existing object" : "POST a new object"}; 1 API call).
            {settings.enabled ? "" : " Network zones are off for the environment, so this has no effect until they are turned on."}
          </>
        }
        request={{ label: `Request (${existing ? "PUT" : "POST"}, 1 API call)`, text: json(existing ? { objectId: existing.objectId, value } : [{ schemaId: ZONES_SCHEMA, scope: "environment", value }]) }}
        confirmLabel={`Change the fallback of ${zone}`}
        applyLabel="Apply"
        run={(v) => applyZoneFallback(zone, settings, fallback, alts, v)}
        onDone={onDone}
        settingsUrl={settingsLink(ZONES_SCHEMA)}
      />
    </Flex>
  );
}

function EnableZonesForm({ settings, onDone }: { settings: ZoneSettings; onDone: () => void }) {
  if (settings.enabled) return <Text>Network zones are already turned on for this environment.</Text>;
  const value = { ...(settings.enabledObj?.value ?? {}), enabled: true };
  return (
    <ApiFix
      summary={
        <>
          Turns on network zones for the environment ({ZONES_ENABLE_SCHEMA}, enabled = true; Settings › Preferences › Network zones). OneAgents then prefer ActiveGates of their own zone, its alternative zones and the default zone, as set by
          each zone&apos;s fallback. Plan the zones and their names first (pattern provider.region.availability-zone.datacenter.tier).
        </>
      }
      request={{ label: `Request (${settings.enabledObj ? "PUT" : "POST"}, 1 API call)`, text: json(settings.enabledObj ? { objectId: settings.enabledObj.objectId, value } : [{ schemaId: ZONES_ENABLE_SCHEMA, scope: "environment", value }]) }}
      confirmLabel="Turn on network zones for this environment"
      applyLabel="Turn on"
      run={(v) => enableNetworkZones(settings, v)}
      onDone={onDone}
      settingsUrl={settingsLink(ZONES_ENABLE_SCHEMA)}
    />
  );
}

const zoneValues = (d: AgData): Record<RemoteAttr, string[]> => ({
  group: [...new Set(d.groups.map((g) => g.group))].sort(),
  networkZone: [...new Set(d.zones.map((z) => z.zone))].sort(),
});

function GroupsCard({ data }: { data: AgData }) {
  const { groups, ags } = data;
  const groupColumns = useMemo<DataTableColumnDef<GroupRow>[]>(
    () => [
      { id: "status", header: "Status", accessor: (g) => CHECK_ORDER.indexOf(g.status), width: 100, cell: ({ rowData: g }) => <StatusCell status={g.status} count={0} /> },
      { id: "group", header: "Group", accessor: "group", width: 150, cell: ({ rowData: g }) => <Text style={{ fontSize: 12, fontWeight: 600, wordBreak: "break-word" }}>{g.group}</Text> },
      { id: "ags", header: "ActiveGates", accessor: (g) => g.ags.length, width: 300, cell: ({ rowData: g }) => <Text style={{ fontSize: 12, wordBreak: "break-word" }}>{g.ags.length ? `${g.ags.length}: ${g.ags.map((a) => a.name).join(", ")}` : "none"}</Text> },
      { id: "eec", header: "With Extensions module", accessor: "eec", width: 120, cell: ({ rowData: g }) => <Text style={{ fontSize: 12, fontWeight: g.configs && !g.eec ? 700 : undefined, color: g.configs && !g.eec ? STATUS_PALETTE.critical : undefined }}>{g.eec}</Text> },
      {
        id: "configs",
        header: "Extension configurations",
        accessor: "configs",
        width: 170,
        cell: ({ rowData: g }) => (
          <Text style={{ fontSize: 12 }}>
            {g.configs}
            {g.problems ? <span style={{ color: g.unassigned ? STATUS_PALETTE.critical : STATUS_COLOR.warn, fontWeight: 700 }}>{` · ${g.problems} not OK${g.unassigned ? ` (${g.unassigned} not picked up)` : ""}`}</span> : ""}
          </Text>
        ),
      },
      { id: "zones", header: "Network zones", accessor: (g) => g.zones.join(", "), width: 140 },
      { id: "note", header: "Finding", accessor: "note", width: 320, cell: ({ rowData: g }) => <Text style={{ fontSize: 12 }}>{g.note}</Text> },
    ],
    [],
  );
  return (
    <div style={card}>
      <Heading level={4}>ActiveGate groups</Heading>
      <Text style={{ ...hint, display: "block", marginBottom: Spacings.Size8 }}>Extensions run only on ActiveGates in a group, and every monitoring configuration targets one group.</Text>
      <DataTable data={groups} columns={groupColumns} sortable resizable defaultLineWrap fullWidth variant={{ rowDensity: "condensed" }}>
        <DataTable.EmptyState>No ActiveGate group.</DataTable.EmptyState>
      </DataTable>
      <details style={{ marginTop: Spacings.Size12 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Set the group of ActiveGates (API)</summary>
        <div style={{ marginTop: Spacings.Size8 }}>
          <AssignForm ags={ags} attr="group" values={zoneValues(data)} />
        </div>
      </details>
    </div>
  );
}

/** Network zones: the topology map (routing and fallback simulation), the zones table, and the zone forms. */
function NetworkZonesSection({ data, theme, onDiagnose }: { data: AgData; theme: Theme; onDiagnose: (ag: ActiveGate) => void }) {
  const { zones, zoneSettings, states, queries, ags, health } = data;
  const off = zoneSettings.status === "ok" && !zoneSettings.value.enabled;
  const zoneColumns = useMemo<DataTableColumnDef<ZoneRow>[]>(
    () => [
      { id: "status", header: "Status", accessor: (z) => CHECK_ORDER.indexOf(z.status), width: 100, cell: ({ rowData: z }) => <StatusCell status={z.status} count={0} /> },
      { id: "zone", header: "Network zone", accessor: "zone", width: 200, cell: ({ rowData: z }) => <Text style={{ fontSize: 12, fontWeight: 600, wordBreak: "break-word" }}>{z.zone}</Text> },
      {
        id: "fallback",
        header: "Fallback",
        accessor: "fallback",
        width: 190,
        cell: ({ rowData: z }) => (
          <span title={FALLBACK_TEXT[z.fallback]}>
            <Text style={{ fontSize: 12, display: "block", fontWeight: z.fallback === "NONE" ? 700 : undefined, color: z.fallback === "NONE" ? STATUS_COLOR.warn : undefined }}>{FALLBACK_LABEL[z.fallback] ?? (z.fallback || "not read")}</Text>
            <Text style={{ fontSize: 11, opacity: 0.7, display: "block" }}>{z.fallback ? (z.configured ? "configured" : "not configured (default)") : ""}</Text>
          </span>
        ),
      },
      { id: "alternatives", header: "Alternative zones", accessor: (z) => z.alternatives.join(", "), width: 160, cell: ({ rowData: z }) => <Text style={{ fontSize: 12 }}>{z.alternatives.length ? z.alternatives.join(", ") : "none"}</Text> },
      { id: "ags", header: "ActiveGates (connected)", accessor: (z) => z.online, width: 260, cell: ({ rowData: z }) => <Text style={{ fontSize: 12, wordBreak: "break-word" }}>{`${z.online} of ${z.ags.length}`}{z.ags.length ? `: ${z.ags.map((a) => a.name).join(", ")}` : ""}</Text> },
      { id: "oneAgents", header: "OneAgents", accessor: "oneAgents", width: 100 },
      { id: "note", header: "Finding", accessor: "note", width: 340, cell: ({ rowData: z }) => <Text style={{ fontSize: 12 }}>{z.note}</Text> },
    ],
    [],
  );
  return (
    <Flex id={ZONES_ANCHOR} flexDirection="column" gap={16}>
      <div>
        <Heading level={3}>Network zones</Heading>
        <Text style={{ display: "block" }}>
          Which ActiveGates are in each network zone, where each zone&apos;s OneAgents send their traffic, and what happens when ActiveGates go down: OneAgents use ActiveGates of their own zone first, then its alternative zones, then (as the
          zone&apos;s fallback allows) the default zone and any other ActiveGate. Zones come from the network zone settings (builtin:networkzones.zones) and from what ActiveGates and OneAgents report.
        </Text>
      </div>
      {zoneSettings.status === "error" && <Text style={{ color: STATUS_COLOR.fail, display: "block" }}>Network zone settings not readable: {zoneSettings.message}</Text>}
      {off && (
        <div role="status" style={{ padding: "8px 12px", borderRadius: 6, borderLeft: `4px solid ${STATUS_COLOR.warn}`, background: "rgba(128,128,128,0.06)" }}>
          <Text>
            <strong>Network zones are turned off</strong> for this environment (Settings › Preferences › Network zones), so zone assignments and fallback modes do not route traffic yet. Turn them on below or in Remediation actions.
          </Text>
        </div>
      )}
      <QueryState state={states.zoneAgents}>
        <NetworkZoneMap ags={ags} zones={zones} health={health} zonesEnabled={zoneSettings.status === "ok" ? zoneSettings.value.enabled : undefined} theme={theme} onDiagnose={onDiagnose} />
      </QueryState>
      <div style={card}>
        <Heading level={4}>Network zones and their fallback</Heading>
        <Text style={{ ...hint, display: "block", marginBottom: Spacings.Size8 }}>One row per zone that is configured or used by an ActiveGate or OneAgent; findings first.</Text>
        <QueryState state={states.zoneAgents}>
          <DataTable data={zones} columns={zoneColumns} sortable resizable defaultLineWrap fullWidth variant={{ rowDensity: "condensed" }}>
            <DataTable.EmptyState>No network zone.</DataTable.EmptyState>
          </DataTable>
        </QueryState>
        <details style={{ marginTop: Spacings.Size12 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Set the network zone of ActiveGates (API)</summary>
          <div style={{ marginTop: Spacings.Size8 }}>
            <AssignForm ags={ags} attr="networkZone" values={zoneValues(data)} />
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
        <div style={{ marginTop: Spacings.Size8 }}>
          <QueryActions title="ActiveGates: OneAgents per network zone" query={queries.zoneAgents} />
        </div>
      </div>
    </Flex>
  );
}

// ---------------------------------------------------------------------------
// Logs: support archives (Fleet Management API)
// ---------------------------------------------------------------------------
const POLL_MS = 10_000;
const DAYS = ["1", "2", "3", "4", "5", "6", "7"];

function ArchiveRowActions({ a, ag, onChanged }: { a: SupportArchive; ag: ActiveGate; onChanged: (r: SubmitResult) => void }) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const download = async () => {
    setBusy(true);
    onChanged(await downloadSupportArchive(ag.id, a, ag.name));
    setBusy(false);
  };
  const remove = async () => {
    setBusy(true);
    onChanged(await deleteSupportArchive(ag.id, a.id));
    setBusy(false);
    setConfirm(false);
  };
  const running = a.status === "COLLECT_IN_PROGRESS";
  return (
    <Flex gap={6} alignItems="center">
      {archiveDownloadable(a) && (
        <Button size="condensed" variant="emphasized" disabled={busy} onClick={() => void download()}>
          Download
        </Button>
      )}
      {a.status !== "DELETED" && a.status !== "DELETE_IN_PROGRESS" &&
        (confirm ? (
          <>
            <Button size="condensed" variant="default" color="critical" disabled={busy} onClick={() => void remove()}>
              {running ? "Confirm cancel" : "Confirm delete"}
            </Button>
            <Button size="condensed" variant="default" disabled={busy} onClick={() => setConfirm(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button size="condensed" variant="default" disabled={busy} onClick={() => setConfirm(true)}>
            {running ? "Cancel" : "Delete"}
          </Button>
        ))}
    </Flex>
  );
}

function LogsCard({ ags, nodeId, setNodeId }: { ags: ActiveGate[]; nodeId: string | null; setNodeId: (id: string) => void }) {
  const ag = ags.find((a) => a.id === nodeId) ?? ags.find((a) => a.online) ?? ags[0];
  const [refresh, setRefresh] = useState(0);
  const [archives, setArchives] = useState<Load<SupportArchive[]>>({ status: "loading" });
  const [days, setDays] = useState("7");
  const [description, setDescription] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const agNode = ag?.id;

  useEffect(() => {
    if (!agNode) return;
    let cancelled = false;
    listSupportArchives(agNode)
      .then((value) => !cancelled && setArchives({ status: "ok", value }))
      .catch((e) => !cancelled && setArchives({ status: "error", message: fleetError(e, "fleet-management:activegate.support-archives:read") }));
    return () => {
      cancelled = true;
    };
  }, [agNode, refresh]);
  // Poll while a collection (or deletion) is running.
  const running = archives.status === "ok" && archives.value.some(archiveRunning);
  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => setRefresh((n) => n + 1), POLL_MS);
    return () => clearTimeout(t);
  }, [running, refresh]);
  // A different ActiveGate starts with a clean form and list.
  useEffect(() => {
    setArchives({ status: "loading" });
    setResult(null);
    setConfirm(false);
  }, [agNode]);

  if (!ag) return null;
  const start = async () => {
    setBusy(true);
    const r = await startSupportArchive(ag.id, description, Number(days));
    setResult(r);
    setBusy(false);
    if (r.ok) {
      setConfirm(false);
      setDescription("");
      setRefresh((n) => n + 1);
    }
  };
  const changed = (r: SubmitResult) => {
    setResult(r);
    setRefresh((n) => n + 1);
  };
  const columns: DataTableColumnDef<SupportArchive>[] = [
    {
      id: "status",
      header: "Status",
      accessor: "status",
      width: "1.2fr",
      cell: ({ rowData: a }) => (
        <Flex gap={6} alignItems="center">
          {archiveRunning(a) && <ProgressCircle size="small" aria-label="Collecting" />}
          <Text style={{ fontSize: 12, fontWeight: 600, color: archiveFailed(a) ? STATUS_COLOR.fail : archiveDownloadable(a) ? STATUS_COLOR.pass : undefined }}>{ARCHIVE_STATUS_LABEL[a.status] ?? a.status}</Text>
        </Flex>
      ),
    },
    { id: "description", header: "Issue", accessor: "description", width: "2fr" },
    { id: "days", header: "Days", accessor: "lookbackDays", width: "0.5fr" },
    { id: "collected", header: "Collected", accessor: (a) => a.collectionTimestamp ?? "", width: "1.1fr", cell: ({ rowData: a }) => <Text style={{ fontSize: 12 }}>{a.collectionTimestamp ? a.collectionTimestamp.slice(0, 16).replace("T", " ") : "—"}</Text> },
    { id: "size", header: "Size", accessor: (a) => a.sizeKb ?? 0, width: "0.6fr", cell: ({ rowData: a }) => <Text style={{ fontSize: 12 }}>{a.sizeKb ? `${(a.sizeKb / 1024).toFixed(1)} MB` : "—"}</Text> },
    { id: "by", header: "By", accessor: "collectedBy", width: "1fr" },
    { id: "actions", header: "", accessor: "id", width: "1.6fr", cell: ({ rowData: a }) => <ArchiveRowActions a={a} ag={ag} onChanged={changed} /> },
  ];
  return (
    <div id={LOGS_ANCHOR} style={card}>
      <Heading level={4}>ActiveGate logs (support archive)</Heading>
      <Text style={{ ...hint, display: "block", marginBottom: Spacings.Size8 }}>
        A support archive is the ActiveGate&apos;s logs and configuration for the chosen days, collected through Dynatrace (Fleet Management API), with sensitive data masked. Archives are kept 30 days. If the ActiveGate cannot connect,
        collect it on the host with agctl (below).
      </Text>
      <Flex gap={16} alignItems="flex-end" flexWrap="wrap">
        <Field label="ActiveGate">
          <Select value={ag.id} onChange={(v: string | null) => v && setNodeId(v)}>
            <Select.Content>
              {ags.map((a) => (
                <Select.Option key={a.id} value={a.id}>
                  {a.name}
                  {a.online ? "" : " (offline)"}
                </Select.Option>
              ))}
            </Select.Content>
          </Select>
        </Field>
        <Field label="Days of logs">
          <Select value={days} onChange={(v: string | null) => v && setDays(v)}>
            <Select.Content>
              {DAYS.map((d) => (
                <Select.Option key={d} value={d}>
                  {d === "7" ? "7 (default)" : d}
                </Select.Option>
              ))}
            </Select.Content>
          </Select>
        </Field>
        <Field label="Issue (required)">
          <TextInput value={description} placeholder="e.g. AWS data lost since Monday" onChange={(v: string) => setDescription(v)} />
        </Field>
      </Flex>
      <Flex flexDirection="column" gap={8} style={{ marginTop: Spacings.Size12 }}>
        {!ag.online && <Text style={{ color: STATUS_COLOR.warn, fontSize: 12 }}>{ag.name} is not connected, so it cannot collect an archive now: use agctl on the host.</Text>}
        <Checkbox value={confirm} onChange={(v: boolean) => setConfirm(v)}>
          Collect a support archive from {ag.name} ({days} {days === "1" ? "day" : "days"} of logs)
        </Checkbox>
        <Flex gap={8}>
          <Button variant="emphasized" disabled={busy || !confirm || !description.trim() || !ag.online} onClick={() => void start()}>
            Start collection
          </Button>
          <Button variant="default" disabled={busy} onClick={() => setRefresh((n) => n + 1)}>
            Refresh
          </Button>
        </Flex>
        <ResultLine result={result} />
      </Flex>
      <div style={{ marginTop: Spacings.Size12 }}>
        {archives.status === "loading" && <Text>Reading the support archives…</Text>}
        {archives.status === "error" && <Text style={{ color: STATUS_COLOR.fail }}>Could not list the support archives: {archives.message}</Text>}
        {archives.status === "ok" && (
          <DataTable data={archives.value} columns={columns} fullWidth variant={{ rowDensity: "condensed" }}>
            <DataTable.EmptyState>No support archive for {ag.name} yet.</DataTable.EmptyState>
          </DataTable>
        )}
      </div>
      <details style={{ marginTop: Spacings.Size12 }}>
        <summary style={{ cursor: "pointer", fontSize: 12, opacity: 0.8 }}>ActiveGate offline or not starting: collect the logs on the host (agctl), log directories</summary>
        <div style={{ marginTop: Spacings.Size8 }}>
          <ManualActionView action={supportArchiveAction(ag)} />
        </div>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Remediation: API forms
// ---------------------------------------------------------------------------
type UpdateScope = "ag" | "env" | "all";

function UpdateModeForm({ ags, settings, ag, onDone }: { ags: ActiveGate[]; settings: AgUpdateSettings; ag?: ActiveGate; onDone: () => void }) {
  const canAg = !!ag && updatable(ag);
  const [scope, setScope] = useState<UpdateScope>(canAg ? "ag" : "all");
  const [mode, setMode] = useState<"AUTOMATIC" | "MANUAL">("AUTOMATIC");
  const manualOverrides = ags.filter((a) => updatable(a) && settings.byScope.get(agScope(a.agId))?.value.updateMode === "MANUAL");
  const scopes = scope === "ag" && ag ? [agScope(ag.agId)] : scope === "env" ? ["environment"] : ["environment", ...manualOverrides.map((a) => agScope(a.agId))];
  const plan = updatePlan(scopes, settings, mode);
  const calls = planCalls(plan);
  const label = UPDATE_MODE_LABEL[mode];
  const where = scope === "ag" && ag ? ag.name : scope === "env" ? "the environment default" : `the environment default and ${plural(manualOverrides.length, "ActiveGate")} with their own "${UPDATE_MODE_LABEL.MANUAL}" setting`;
  const request = json({
    ...(plan.post.length ? { "POST /api/v2/settings/objects": plan.post } : {}),
    ...(plan.put.length ? { "PUT /api/v2/settings/objects/{objectId} (one per object)": plan.put.map((p) => ({ objectId: p.obj.objectId, scope: p.obj.scope, value: p.value })) } : {}),
  });
  return (
    <Flex flexDirection="column" gap={12}>
      <Flex gap={16} flexWrap="wrap" alignItems="flex-end">
        <Field label="Apply to">
          <Select value={scope} onChange={(v: string | null) => v && setScope(v as UpdateScope)}>
            <Select.Content>
              {canAg && <Select.Option value="ag">This ActiveGate ({ag!.name})</Select.Option>}
              <Select.Option value="env">Environment default</Select.Option>
              <Select.Option value="all">Environment default + ActiveGates with their own &quot;No automatic updates&quot; ({manualOverrides.length})</Select.Option>
            </Select.Content>
          </Select>
        </Field>
        <Field label="Update mode">
          <Select value={mode} onChange={(v: string | null) => v && setMode(v as "AUTOMATIC" | "MANUAL")}>
            <Select.Content>
              <Select.Option value="AUTOMATIC">{UPDATE_MODE_LABEL.AUTOMATIC}</Select.Option>
              <Select.Option value="MANUAL">{UPDATE_MODE_LABEL.MANUAL}</Select.Option>
            </Select.Content>
          </Select>
        </Field>
      </Flex>
      <ApiFix
        key={`${scope}-${mode}-${ag?.id ?? ""}`}
        summary={
          <>
            Sets <strong>{label}</strong> for {where} ({AG_UPDATES_SCHEMA}; {calls === 0 ? "nothing to change" : plural(calls, "API call")}). The target version of each object is kept ({scopes.length === 1 ? "pinned versions stay pinned" : "pins stay"}).{" "}
            {scope === "env" && manualOverrides.length > 0 && `${plural(manualOverrides.length, "ActiveGate")} with their own setting keep it: an ActiveGate setting overrides the environment one. `}
            Containerized ActiveGates are not affected (the Operator updates them). For updates during an update window, open the setting.
          </>
        }
        request={{ label: `Request (${calls} API ${calls === 1 ? "call" : "calls"})`, text: request }}
        confirmLabel={`Set "${label}" for ${where}`}
        applyLabel="Apply"
        run={(v) => applyUpdatePlan(plan, v, `Update mode set to "${label}" for ${where}. ActiveGates check for updates every 30 minutes.`)}
        onDone={onDone}
        settingsUrl={settingsLink(AG_UPDATES_SCHEMA, scope === "ag" && ag ? agScope(ag.agId) : undefined)}
      />
    </Flex>
  );
}

function UpdateNowForm({ ag, target }: { ag: ActiveGate; target: string }) {
  const [jobs, setJobs] = useState<Load<UpdateJobInfo[]>>({ status: "loading" });
  const [key, setKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    readLastUpdateJobs(ag.agId)
      .then((value) => !cancelled && setJobs({ status: "ok", value }))
      .catch((e) => !cancelled && setJobs({ status: "error", message: fleetError(e, "fleet-management:activegates:read") }));
    return () => {
      cancelled = true;
    };
  }, [ag.agId, key]);
  if (!updatable(ag)) return <ManualActionView action={updateK8sAction(ag)} />;
  const behind = releasesBehind(ag.version, target);
  return (
    <Flex flexDirection="column" gap={12}>
      <Text style={hint}>
        Last update jobs:{" "}
        {jobs.status === "loading"
          ? "reading…"
          : jobs.status === "error"
            ? jobs.message
            : jobs.value.length === 0
              ? "none."
              : jobs.value.map((j) => `${j.state.toLowerCase()} ${shortVersion(j.startVersion)} → ${shortVersion(j.targetVersion) || j.targetVersion}${j.timestamp ? ` (${new Date(j.timestamp).toISOString().slice(0, 10)})` : ""}${j.error ? `: ${j.error}` : ""}`).join("; ")}
      </Text>
      <ApiFix
        summary={
          <>
            Starts an update job on <strong>{ag.name}</strong> to the latest version: {shortVersion(ag.version) || "current"} → {shortVersion(target) || "latest"}
            {behind ? ` (${plural(behind, "release")} behind)` : " (already on the target; the job may be skipped)"}. One-click updates are for host-based installations.
          </>
        }
        request={{ label: "Request (1 API call)", text: `POST /api/v2/activeGates/${ag.agId}/updateJobs\n${json({ targetVersion: "latest", updateType: "ACTIVE_GATE" })}` }}
        confirmLabel={`Update ${ag.name} now`}
        applyLabel="Update now"
        run={(v) => runUpdateJob(ag.agId, v)}
        onDone={() => setKey((k) => k + 1)}
      />
    </Flex>
  );
}

function LogsJump({ ag, onLogs }: { ag?: ActiveGate; onLogs: (ag?: ActiveGate) => void }) {
  return (
    <Flex flexDirection="column" gap={8}>
      <Text>Collect a support archive (logs and configuration) {ag ? `from ${ag.name} ` : ""}and download it, in the ActiveGate logs section above.</Text>
      <div>
        <Button variant="emphasized" onClick={() => onLogs(ag)}>
          Open ActiveGate logs{ag ? ` for ${ag.name}` : ""}
        </Button>
      </div>
    </Flex>
  );
}

// ---------------------------------------------------------------------------
// Remediation: diagnosis of the selected ActiveGate
// ---------------------------------------------------------------------------
const manual = (a: ManualAction, severity?: Severity): ActionDef => ({ id: a.id, label: a.title, kind: "manual", node: <ManualActionView action={a} />, docs: a.docs, severity });

function TrendCharts({ tf, ag, theme }: { tf: Timeframe; ag: ActiveGate; theme: Theme }) {
  const query = useMemo(() => activeGateTrendQuery(tf, ag.agId), [tf, ag.agId]);
  const state = useDql(query);
  const r = state.data?.records?.[0];
  const startMs = r?.timeframe?.start ? Date.parse(String(r.timeframe.start)) : Date.now();
  const stepMs = r?.interval ? Number(r.interval) / 1e6 : 900_000;
  const series = (k: string): (number | null)[] => (Array.isArray(r?.[k]) ? (r[k] as unknown[]).map((v) => (v === null || v === undefined ? null : Number(v))) : []);
  const color = SERIES_BLUE[theme];
  return (
    <div>
      <Text style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>Over the timeframe</Text>
      <QueryState state={state}>
        {!r ? (
          <Text>No self-monitoring data for this ActiveGate in the timeframe.</Text>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
            <LineMini title="Messages rejected" values={series("rejected")} startMs={startMs} stepMs={stepMs} color={color} unit="" />
            <LineMini title="Messages dropped" values={series("dropped")} startMs={startMs} stepMs={stepMs} color={color} unit="" />
            <LineMini title="Messages resent" values={series("resent")} startMs={startMs} stepMs={stepMs} color={color} unit="" />
            <LineMini title="Outgoing queue (peak)" values={series("queue")} startMs={startMs} stepMs={stepMs} color={color} unit="" />
            <LineMini title="Java heap used" values={series("heapPct")} startMs={startMs} stepMs={stepMs} color={color} unit="%" maxHint={100} />
            <LineMini title="Host CPU (peak)" values={series("cpu")} startMs={startMs} stepMs={stepMs} color={color} unit="%" maxHint={100} />
          </div>
        )}
      </QueryState>
      <div style={{ marginTop: Spacings.Size8 }}>
        <QueryActions title={`ActiveGates: communication and resources of ${ag.name}`} query={query} />
      </div>
    </div>
  );
}

/** API actions for network zones: fallback of a zone, and turning network zones on when they are off. */
function zoneApiActions(d: AgData, initialZone?: string) {
  return (zone?: string): ActionDef[] => {
    if (d.zoneSettings.status !== "ok") return [];
    const s = d.zoneSettings.value;
    const fallback: ActionDef = { id: "api-zone-fallback", label: "Set a network zone's fallback and alternative zones", kind: "api", node: <FallbackForm zones={d.zones} settings={s} initialZone={zone ?? initialZone} onDone={d.reloadZones} />, docs: [DOC.networkZones, DOC.networkZoneConnectivity] };
    const enable: ActionDef = { id: "api-zones-enable", label: "Turn on network zones", kind: "api", node: <EnableZonesForm settings={s} onDone={d.reloadZones} />, docs: [DOC.networkZones] };
    return s.enabled ? [fallback] : [enable, fallback];
  };
}

function buildActions(ag: ActiveGate, checks: AgCheck[], d: AgData, onLogs: (ag?: ActiveGate) => void): ActionDef[] {
  const settingsNode =
    d.settings.status === "ok" ? (
      <UpdateModeForm ags={d.ags} settings={d.settings.value} ag={ag} onDone={d.reloadSettings} />
    ) : (
      <Text>{d.settings.status === "loading" ? "Reading the update settings…" : `Update settings not readable: ${d.settings.message}`}</Text>
    );
  const apiUpdateMode: ActionDef = { id: "api-update-mode", label: "Set the update mode", kind: "api", node: settingsNode, docs: [DOC.agUpdate, DOC.fleetManagement] };
  const apiUpdateNow: ActionDef = { id: "api-update-now", label: updatable(ag) ? "Update now (update job)" : "Update (Dynatrace Operator)", kind: updatable(ag) ? "api" : "manual", node: <UpdateNowForm ag={ag} target={d.target} />, docs: updatable(ag) ? [DOC.agUpdate] : [DOC.k8sComponentUpdates] };
  const apiLogs: ActionDef = { id: "api-logs", label: "Collect logs (support archive)", kind: "api", node: <LogsJump ag={ag} onLogs={onLogs} />, docs: [DOC.fleetManagement, DOC.agDiagnostics] };
  const firstBad = [...d.ctxOf(ag).configs.filter(extIsProblem), ...d.unassignedOf(ag)][0];
  const idle = ag.modules.filter((id) => moduleState(moduleDef(id), ag, d.ctxOf(ag)).state === "idle");
  const zone = (ag.networkZone || DEFAULT_ZONE).toLowerCase();
  const zoneActions = zoneApiActions(d, zone);
  const apiGroup: ActionDef = remotelyConfigurable(ag)
    ? { id: "api-group", label: "Set the ActiveGate group (remote configuration)", kind: "api", node: <AssignForm ags={d.ags} initial={[ag]} attr="group" values={zoneValues(d)} />, docs: [DOC.bulkConfig] }
    : manual(groupZoneAction(ag));
  const apiZone: ActionDef = remotelyConfigurable(ag)
    ? { id: "api-zone", label: "Set the network zone (remote configuration)", kind: "api", node: <AssignForm ags={d.ags} initial={[ag]} attr="networkZone" values={zoneValues(d)} />, docs: [DOC.bulkConfig, DOC.networkZones] }
    : manual(groupZoneAction(ag));
  const byFix: Record<AgFix, ActionDef[]> = {
    group: [apiGroup, manual(groupZoneAction(ag))],
    zone: [
      {
        id: "zone-map",
        label: "Show the zone's routing on the network zone map",
        kind: "manual",
        node: (
          <Flex flexDirection="column" gap={8}>
            <Text>The map shows where the OneAgents of {zone} send their traffic, and lets you simulate an outage of {ag.name} or its zone and try another fallback mode.</Text>
            <div>
              <Button variant="emphasized" onClick={() => scrollTo(ZONES_ANCHOR)}>
                Open the network zone map
              </Button>
            </div>
          </Flex>
        ),
        docs: [DOC.networkZoneConnectivity],
      },
      ...zoneActions(zone),
      apiZone,
      manual(zoneFallbackAction(zone)),
    ],
    connectivity: [manual(connectivityAction(ag)), apiLogs],
    update: [apiUpdateNow, manual(updateAction(ag))],
    "update-k8s": [manual(updateK8sAction(ag))],
    "auto-update": [apiUpdateMode, manual(updateAction(ag))],
    token: [manual(tokenAction(ag))],
    rejected: [manual(rejectedAction(ag)), manual(tokenAction(ag))],
    dropped: [manual(droppedAction(ag))],
    resources: [manual(resourcesAction(ag))],
    module: idle.map((id) => manual(moduleAction(id, ag))),
    aws: [manual(awsAction())],
    k8s: [manual(k8sAction(ag))],
    extensions: [manual(extensionAction(firstBad))],
    ingest: [manual(ingestAction())],
  };
  const rated = new Map<string, ActionDef>();
  for (const c of checks) {
    if (c.status === "pass" || !c.fix) continue;
    const severity: Severity = c.status === "fail" ? "fail" : c.status === "warn" ? "warn" : "info";
    for (const a of byFix[c.fix]) {
      const prev = rated.get(a.id);
      if (!prev || SEVERITY_ORDER.indexOf(severity) < SEVERITY_ORDER.indexOf(prev.severity ?? "other")) rated.set(a.id, { ...a, severity });
    }
  }
  const always: ActionDef[] = [apiLogs, ...(updatable(ag) ? [apiUpdateMode, apiUpdateNow] : [apiUpdateNow]), apiGroup, apiZone, ...zoneActions(zone)];
  const rest = [...always, ...genericAgActions().map((a) => manual(a))]
    .filter((a, i, all) => !rated.has(a.id) && all.findIndex((x) => x.id === a.id) === i)
    .map((a) => ({ ...a, severity: "other" as Severity }));
  return [...rated.values()].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity ?? "other") - SEVERITY_ORDER.indexOf(b.severity ?? "other")).concat(rest);
}

function AgDiagnosis({ tf, ag, data, theme, onSummary, onLogs }: { tf: Timeframe; ag: ActiveGate; data: AgData; theme: Theme; onSummary: (s: { name: string; failing: string[] } | null) => void; onLogs: (ag?: ActiveGate) => void }) {
  const checks = useMemo(() => data.checks.get(ag.id) ?? [], [data.checks, ag.id]);
  const actions = useMemo(() => buildActions(ag, checks, data, onLogs), [ag, checks, data, onLogs]);
  useEffect(() => {
    onSummary({ name: ag.name, failing: checks.filter((c) => c.status === "fail").map((c) => c.title) });
  }, [ag.name, checks, onSummary]);
  const ctx = data.ctxOf(ag);
  const unassigned = data.unassignedOf(ag);
  const extRows = [...ctx.configs.filter(extIsProblem), ...unassigned];
  const cluster = ag.clusterId ? entityOverviewLink("K8S_CLUSTER", ag.clusterId, tf) : undefined;
  const links = [
    { label: "Fleet Management", url: fleetManagementLink() },
    { label: "Deployment status (ActiveGates)", url: deploymentStatusActiveGatesLink() },
    { label: "Update setting", url: updatable(ag) ? settingsLink(AG_UPDATES_SCHEMA, agScope(ag.agId)) : undefined },
    { label: `Kubernetes cluster ${ag.clusterName}`, url: cluster },
  ].filter((l): l is { label: string; url: string } => !!l.url);
  const facts = [
    TYPE_LABEL[ag.type] ?? ag.type,
    `version ${shortVersion(ag.version) || "unknown"}`,
    ag.group && `group ${ag.group}`,
    ag.networkZone && `network zone ${ag.networkZone}`,
    ag.containerized ? "containerized" : ag.osType && `${ag.osType.toLowerCase()} host`,
    ag.fips && "FIPS mode",
    ag.extVersion && `extensions ${shortVersion(ag.extVersion)}`,
    ag.syntheticVersion && `synthetic engine ${shortVersion(ag.syntheticVersion)}`,
    ag.zremoteVersion && `zRemote ${shortVersion(ag.zremoteVersion)}`,
    ag.tokenId && `token ${ag.tokenId}`,
  ].filter(Boolean);
  return (
    <Flex flexDirection="column" gap={12}>
      <div>
        <Text style={{ opacity: 0.85 }}>
          <strong>{ag.name}</strong> · {facts.join(" · ")}
        </Text>
        <Flex gap={12} flexWrap="wrap" style={{ marginTop: 4 }}>
          {links.map((l) => (
            <a key={l.label} href={l.url} target="_blank" rel="noreferrer noopener" style={{ ...linkStyle, fontSize: 12 }}>
              ↗ {l.label}
            </a>
          ))}
        </Flex>
        <Text style={{ ...hint, display: "block", marginTop: 2 }}>Fleet Management has no link to a single ActiveGate: search it there by name.</Text>
      </div>
      <CheckList checks={checks} />
      <details>
        <summary style={{ cursor: "pointer", fontSize: 12, opacity: 0.8 }}>Enabled modules ({ag.modules.length})</summary>
        <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
          {ag.modules.map(moduleDef).map((m) => {
            const s = moduleState(m, ag, ctx);
            return (
              <li key={m.id} style={{ listStyle: "none", marginLeft: -18 }}>
                <Flex gap={6} alignItems="baseline">
                  <StateSwatch state={s.state} size={12} />
                  <Text style={{ fontSize: 12 }}>
                    <strong>{m.label}</strong>: {MODULE_STATE_LABEL[s.state]}
                    {s.state !== "on" && ` · ${s.text}`}
                  </Text>
                </Flex>
              </li>
            );
          })}
        </ul>
      </details>
      {extRows.length > 0 && (
        <details open>
          <summary style={{ cursor: "pointer", fontSize: 12, opacity: 0.8 }}>Extension configurations not OK ({extRows.length})</summary>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {extRows.map((c) => (
              <li key={c.configId}>
                <Text style={{ fontSize: 12 }}>
                  <strong>{c.extension}</strong> ({c.status}
                  {c.agId ? "" : `, group ${c.group}`}){c.message ? `: ${c.message}` : ""}
                </Text>
              </li>
            ))}
          </ul>
        </details>
      )}
      <TrendCharts tf={tf} ag={ag} theme={theme} />
      <ActionPicker key={ag.id} actions={actions} />
    </Flex>
  );
}

function AgRemediation({
  tf,
  data,
  selection,
  theme,
  onSummary,
  onClear,
  onLogs,
}: {
  tf: Timeframe;
  data: AgData;
  selection: ActiveGate | null;
  theme: Theme;
  onSummary: (s: { name: string; failing: string[] } | null) => void;
  onClear: () => void;
  onLogs: (ag?: ActiveGate) => void;
}) {
  const generic = useMemo<ActionDef[]>(() => {
    const settingsNode =
      data.settings.status === "ok" ? (
        <UpdateModeForm ags={data.ags} settings={data.settings.value} onDone={data.reloadSettings} />
      ) : (
        <Text>{data.settings.status === "loading" ? "Reading the update settings…" : `Update settings not readable: ${data.settings.message}`}</Text>
      );
    return [
      { id: "api-update-mode", label: "Set the update mode", kind: "api", node: settingsNode, docs: [DOC.agUpdate, DOC.fleetManagement] },
      { id: "api-group-zone", label: "Set the group or network zone of ActiveGates (remote configuration)", kind: "api", node: <AssignForm ags={data.ags} values={zoneValues(data)} />, docs: [DOC.bulkConfig, DOC.networkZones] },
      ...zoneApiActions(data)(),
      { id: "api-logs", label: "Collect logs (support archive)", kind: "api", node: <LogsJump onLogs={onLogs} />, docs: [DOC.fleetManagement, DOC.agDiagnostics] },
      ...genericAgActions().map((a) => manual(a)),
    ];
  }, [data, onLogs]);
  return (
    <div id={AG_ANCHOR} style={{ ...card, marginTop: Spacings.Size16 }}>
      <Flex justifyContent="space-between" alignItems="flex-end" flexWrap="wrap" gap={12}>
        <div>
          <Heading level={3} style={{ margin: 0 }}>
            Remediation actions
          </Heading>
          <Text style={{ opacity: 0.8 }}>
            {selection
              ? `What needs attention on ${selection.name} (connection, version and updates, token, messages, resources, modules, extensions), and the steps to fix it.`
              : "Update mode, logs and the documented fixes for versions, tokens, message loss, modules, extensions, AWS and Kubernetes. Use Diagnose on an ActiveGate above for checks specific to it."}
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
        {selection ? <AgDiagnosis key={selection.id} tf={tf} ag={selection} data={data} theme={theme} onSummary={onSummary} onLogs={onLogs} /> : <ActionPicker actions={generic} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab
// ---------------------------------------------------------------------------
export function ActiveGatesTab({ tf }: { tf: Timeframe }) {
  const theme = useCurrentTheme() as Theme;
  const data = useActiveGatesData(tf);
  const { ags, states, queries, checks, health, ctxOf, updateOf, tokenOf, unassignedOf, configs, detail, target, zones, groups, zoneSettings } = data;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ name: string; failing: string[] } | null>(null);
  const [slice, setSlice] = useState<SliceSel | null>(null);
  const [logsNode, setLogsNode] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const selection = ags.find((a) => a.id === selectedId) ?? null;

  const versionsShown = useMemo(() => {
    const keys = [...new Set(ags.map(versionKey))].sort((a, b) => minorOf(b) - minorOf(a));
    return keys.slice(0, VERSION_SLICES);
  }, [ags]);
  const filtered = useMemo(() => ags.filter((ag) => matchesSlice(slice, ag, updateOf(ag), versionsShown)), [ags, slice, updateOf, versionsShown]);
  const rows = useMemo<AgRow[]>(
    () =>
      filtered.map((ag) => {
        const c = checks.get(ag.id) ?? [];
        const status = worstStatus(c);
        return {
          ag,
          h: health.get(ag.agId),
          checks: c,
          status,
          problems: c.filter((x) => x.status === status).length,
          behind: releasesBehind(ag.version, target),
          update: updateOf(ag),
          token: tokenOf(ag),
          zone: zones.find((z) => z.zone === (ag.networkZone || DEFAULT_ZONE).toLowerCase()),
          modulesUsed: ag.modules.filter((id) => ["active", "issue"].includes(moduleState(moduleDef(id), ag, ctxOf(ag)).state)).length,
          extOk: ctxOf(ag).configs.filter((x) => !extIsProblem(x)).length,
          extBad: ctxOf(ag).configs.filter(extIsProblem).length,
          unassigned: unassignedOf(ag).length,
        };
      }),
    [filtered, checks, health, target, updateOf, tokenOf, zones, ctxOf, unassignedOf],
  );

  const select = useCallback((ag: ActiveGate) => {
    setSelectedId(ag.id);
    setLogsNode(ag.id);
    scrollTo(AG_ANCHOR);
  }, []);
  const clear = useCallback(() => {
    setSelectedId(null);
    setSummary(null);
  }, []);
  const openLogs = useCallback((ag?: ActiveGate) => {
    if (ag) setLogsNode(ag.id);
    scrollTo(LOGS_ANCHOR);
  }, []);
  const pickSlice = useCallback((s: SliceSel | null) => {
    setSlice(s);
    if (s) setTimeout(() => tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  }, []);
  // A new timeframe changes the data behind a slice.
  useEffect(() => setSlice(null), [tf]);

  const { panel: aiPanel } = useAIInsights(
    useCallback(() => {
      const idle = new Map<string, number>();
      const moduleIssues: { name: string; module: string }[] = [];
      for (const ag of ags) {
        for (const id of ag.modules) {
          const m = moduleDef(id);
          const s = moduleState(m, ag, ctxOf(ag)).state;
          if (s === "idle") idle.set(m.label, (idle.get(m.label) ?? 0) + 1);
          if (s === "issue") moduleIssues.push({ name: ag.name, module: m.label });
        }
      }
      const tokensDue = ags.flatMap((ag) => {
        const t = tokenOf(ag);
        const days = t ? tokenDaysLeft(t) : null;
        return days !== null && days <= TOKEN_EXPIRING_DAYS ? [{ name: ag.name, days }] : [];
      });
      const hostBased = ags.filter(updatable);
      return analyzeActiveGates({
        total: ags.length,
        offline: ags.filter((a) => !a.online).map((a) => a.name),
        behind: ags.flatMap((a) => {
          const b = releasesBehind(a.version, target);
          return b !== null && b > BEHIND_WARN ? [{ name: a.name, releases: b }] : [];
        }),
        target: shortVersion(target),
        hostBased: hostBased.length,
        manual: data.settings.status === "ok" ? hostBased.filter((a) => updateOf(a)?.mode === "MANUAL").map((a) => a.name) : null,
        rejected: ags.filter((a) => health.get(a.agId)?.rejected).map((a) => ({ name: a.name, n: Math.round(health.get(a.agId)!.rejected!) })),
        dropped: ags.filter((a) => health.get(a.agId)?.dropped).map((a) => ({ name: a.name, n: Math.round(health.get(a.agId)!.dropped!) })),
        tokens: tokensDue,
        idleModules: [...idle.entries()].map(([module, n]) => ({ module, ags: n })),
        moduleIssues,
        extensions: { total: configs.length, problems: configs.filter(extIsProblem).length, unassigned: configs.filter((c) => c.status === "UNASSIGNED").length },
        awsUnassigned: detail.filter((r) => r.metric === "aws.credentials" && r.agId === "unassigned").map((r) => r.key),
        zonesEnabled: zoneSettings.status === "ok" ? zoneSettings.value.enabled : null,
        zoneProblems: zones.filter((z) => z.status === "fail" || z.status === "warn").map((z) => ({ zone: z.zone, note: z.note, blocking: z.status === "fail" })),
        groupProblems: groups.filter((g) => g.status === "fail").map((g) => ({ group: g.group, note: g.note })),
        selection: summary,
      });
    }, [ags, ctxOf, tokenOf, target, data.settings.status, updateOf, health, configs, detail, zoneSettings, zones, groups, summary]),
  );

  return (
    <Flex flexDirection="column" gap={16}>
      {aiPanel}
      <Heading level={3}>ActiveGates</Heading>
      <Text>
        Every environment ActiveGate (routing and monitoring, synthetic, zRemote; host-based and containerized): which modules are enabled and actually in use, self-monitoring (rejected, dropped and resent messages, queue, heap, disk,
        CPU, AWS and Kubernetes module metrics), extensions on ActiveGate groups that do not run, versions against the target version and the update mode, token expiry, and support archives for the logs. Read from Smartscape, the
        ActiveGate self-monitoring metrics, the extension self-monitoring metrics and events, the Settings API and the Fleet Management API.
      </Text>
      <QueryState state={states.inventory}>
        <Flex flexDirection="column" gap={16}>
          <div style={card}>
            <SummaryGauges data={data} onInfo={() => scrollTo(AG_ANCHOR)} />
            <details style={{ marginTop: Spacings.Size8 }}>
              <summary style={{ cursor: "pointer", fontSize: 12, opacity: 0.8 }}>DQL behind these gauges</summary>
              <Flex flexDirection="column" gap={8} style={{ marginTop: Spacings.Size8 }}>
                <Text style={hint}>ActiveGates (inventory, modules, versions)</Text>
                <QueryActions title="ActiveGates: inventory" query={queries.inventory} />
                <Text style={hint}>Self-monitoring per ActiveGate (messages, resources, module activity)</Text>
                <QueryActions title="ActiveGates: self-monitoring per ActiveGate" query={queries.health} />
                <Text style={hint}>Extension configurations on ActiveGate groups</Text>
                <QueryActions title="ActiveGates: extension configurations by status" query={queries.extensions} />
              </Flex>
            </details>
          </div>
          <DonutsRow data={data} theme={theme} slice={slice} onSlice={pickSlice} />
          {slice && (
            <Flex gap={8} alignItems="center">
              <Text style={hint}>
                Showing {plural(filtered.length, "ActiveGate")} in the selected slice in the matrix, charts and table.
              </Text>
              <Button size="condensed" variant="default" onClick={() => setSlice(null)}>
                Show all
              </Button>
            </Flex>
          )}
          <QueryState state={states.health}>
            <ModulesCard data={data} ags={filtered} selectedId={selectedId ?? undefined} onSelect={select} />
          </QueryState>
          <QueryState state={states.health}>
            <MessagesCard data={data} ags={filtered} theme={theme} onSelect={select} />
          </QueryState>
          <div ref={tableRef}>
            <HealthTable rows={rows} tf={tf} selectedId={selectedId ?? undefined} onSelect={select} />
            <div style={{ marginTop: Spacings.Size8 }}>
              <QueryActions title="ActiveGates: self-monitoring per ActiveGate" query={queries.health} />
            </div>
          </div>
          <GroupsCard data={data} />
          <NetworkZonesSection data={data} theme={theme} onDiagnose={select} />
          <ModuleDetailCard data={data} onSelect={select} />
          <ExtensionsCard data={data} />
          <ExtensionLogsCard data={data} />
          {ags.length > 0 && <LogsCard ags={ags} nodeId={logsNode} setNodeId={setLogsNode} />}
        </Flex>
      </QueryState>
      <AgRemediation tf={tf} data={data} selection={selection} theme={theme} onSummary={setSummary} onClear={clear} onLogs={openLogs} />
    </Flex>
  );
}
