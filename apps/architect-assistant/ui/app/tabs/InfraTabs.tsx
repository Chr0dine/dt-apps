import React, { useCallback, useMemo, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import Colors from "@dynatrace/strato-design-tokens/colors";
import Spacings from "@dynatrace/strato-design-tokens/spacings";
import Borders from "@dynatrace/strato-design-tokens/borders";
import { useDql } from "../useDql";
import { useAIInsights } from "../AIInsights";
import { analyzeHostGroups, analyzeOneAgent } from "../analyses";
import {
  hostGroupsQuery,
  oneAgentQuery,
  type Timeframe,
} from "../queries";
import { PctGauge, QueryActions, QueryState, formatMode, num, pct } from "../components";
import { EntitySearch } from "./EntitySearch";
import { OneAgentSearch, compareVersions, shortVersion } from "./OneAgentSearch";
import { Donut, MonitoringModePie, type Slice } from "./ModePie";

type Row = Record<string, any>;

/** Card behind a chart so charts on one row share a background and height. */
function ChartCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: Spacings.Size16,
        borderRadius: Borders.Radius.Container.Default,
        background: Colors.Background.Container.Neutral.Default,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </div>
  );
}

export function HostGroupsTab({ tf }: { tf: Timeframe }) {
  const state = useDql(hostGroupsQuery(tf));
  const rows = useMemo<Row[]>(
    () => (state.data?.records ?? []).map((r) => ({ hostGroup: r.hostGroup ?? "(no host group)", hosts: num(r.hosts), none: r.hostGroup == null })),
    [state.data],
  );
  const total = rows.reduce((s, r) => s + r.hosts, 0);
  const without = rows.filter((r) => r.none).reduce((s, r) => s + r.hosts, 0);
  const { panel: aiPanel } = useAIInsights(
    useCallback(() => analyzeHostGroups(rows.map((r) => ({ name: r.hostGroup, hosts: r.hosts, none: r.none }))), [rows]),
  );
  return (
    <Flex flexDirection="column" gap={16}>
      {aiPanel}
      <Heading level={3}>Host groups</Heading>
      <Text>Host groups bind hosts to a shared deployment unit so settings, naming and ownership can be applied by group.</Text>
      <QueryState state={state}>
        <Flex flexDirection="column" gap={8}>
          <PctGauge pct={pct(total - without, total)} caption="Hosts with a host group" detail={`${(total - without).toLocaleString()} of ${total.toLocaleString()}`} />
          <QueryActions title="Hosts per host group" query={hostGroupsQuery(tf)} />
        </Flex>
      </QueryState>
      <EntitySearch
        tf={tf}
        title="Search entities by host group"
        fields={[{ key: "hostgroup", label: "Host group", expr: "dt.host_group.id" }]}
        types={["HOST", "PROCESS", "CONTAINER"]}
      />
    </Flex>
  );
}

// "1.347.62.20261019-084101" -> 347
const minorOf = (version: string): number => num(String(version).split(".")[1]);

const DONUT_SIZE = 170;

export function OneAgentTab({ tf }: { tf: Timeframe }) {
  const state = useDql(oneAgentQuery(tf));
  const [selVersion, setSelVersion] = useState<string | null>(null);
  const [selMode, setSelMode] = useState<string | null>(null);
  const rows = useMemo<Row[]>(() => {
    const recs = (state.data?.records ?? []).map((r) => ({
      mode: r.mode ?? "(unknown)",
      modeLabel: formatMode(r.mode),
      version: String(r.version ?? "(unknown)"),
      agents: num(r.agents),
    }));
    const latest = Math.max(0, ...recs.map((r) => minorOf(r.version)));
    return recs.map((r) => ({ ...r, behind: latest - minorOf(r.version) }));
  }, [state.data]);
  const searchVersions = useMemo(
    () => Array.from(new Set(rows.map((r) => shortVersion(r.version)).filter((v) => v !== "(unknown)"))).sort((a, b) => compareVersions(b, a)),
    [rows],
  );
  const searchModes = useMemo(() => Array.from(new Set(rows.map((r) => r.mode).filter((m) => m !== "(unknown)"))), [rows]);
  // Newest version seen in the tenant: the same reference the "Current versions" gauge measures against.
  const newest = useMemo(() => rows.map((r) => r.version).filter((v) => v !== "(unknown)").sort((a, b) => compareVersions(b, a))[0], [rows]);
  const total = rows.reduce((s, r) => s + r.agents, 0);
  const current = rows.filter((r) => r.behind <= 2).reduce((s, r) => s + r.agents, 0);
  const fullStack = rows.filter((r) => r.mode === "FULL_STACK").reduce((s, r) => s + r.agents, 0);
  const { panel: aiPanel } = useAIInsights(useCallback(() => analyzeOneAgent(rows as any), [rows]));
  // One slice per version (summed over modes), newest first; hues spread evenly so every version is distinct.
  const versionSlices = useMemo<Slice[]>(() => {
    const byVersion = new Map<string, number>();
    rows.forEach((r) => {
      const v = shortVersion(r.version);
      byVersion.set(v, (byVersion.get(v) ?? 0) + r.agents);
    });
    const sorted = Array.from(byVersion.entries())
      .filter(([, v]) => v > 0)
      .sort((a, b) => compareVersions(b[0], a[0]));
    return sorted.map(([label, value], i) => ({
      label,
      value,
      id: label === "(unknown)" ? undefined : label,
      color: label === "(unknown)" ? "#8D8D8D" : `hsl(${Math.round((i * 360) / Math.max(sorted.length, 1) + 215) % 360}, 65%, 55%)`,
    }));
  }, [rows]);
  return (
    <QueryState state={state}>
      <Flex flexDirection="column" gap={16}>
        {aiPanel}
        <Heading level={3}>OneAgent</Heading>
        <Text>
          Version spread and monitoring mode. “Current” means within 2 releases of the newest version seen in this tenant.
        </Text>
        {newest && (
          <Text>
            Newest version available in this tenant: <strong>{shortVersion(newest)}</strong>
          </Text>
        )}
        {/* Gauges and donuts share one row (no wrapping); the donut cards share the remaining width and stay in sync with the Find hosts filters. */}
        <Flex gap={16} flexWrap="nowrap" alignItems="stretch">
          <ChartCard>
            <PctGauge pct={pct(current, total)} caption="Current versions" detail="within 2 releases of newest" />
          </ChartCard>
          <ChartCard>
            <PctGauge pct={pct(fullStack, total)} caption="Full-stack mode" detail="vs infrastructure/discovery" />
          </ChartCard>
          <MonitoringModePie tf={tf} size={DONUT_SIZE} compact selectedId={selMode} onSelect={setSelMode} />
          <div style={{ flex: "1 1 0", minWidth: 0, padding: Spacings.Size16, borderRadius: Borders.Radius.Container.Default, background: Colors.Background.Container.Neutral.Default }}>
            <Heading level={4}>OneAgents by version</Heading>
            <div style={{ marginTop: Spacings.Size8 }}>
              {versionSlices.length === 0 ? (
                <Text>No OneAgents found in this timeframe.</Text>
              ) : (
                <Donut slices={versionSlices} size={DONUT_SIZE} compact legendRight ariaLabel="OneAgents by version" selectedId={selVersion} onSelect={setSelVersion} />
              )}
            </div>
            <div style={{ marginTop: Spacings.Size8 }}>
              <QueryActions title="OneAgent versions and modes" query={oneAgentQuery(tf)} />
            </div>
          </div>
        </Flex>
        <Text style={{ fontSize: 12, opacity: 0.7 }}>Click a slice in either donut to list matching hosts under “Find hosts”; click it again to clear.</Text>
        <OneAgentSearch tf={tf} versions={searchVersions} modes={searchModes} selVersion={selVersion} selMode={selMode} onVersionChange={setSelVersion} onModeChange={setSelMode} />
      </Flex>
    </QueryState>
  );
}
