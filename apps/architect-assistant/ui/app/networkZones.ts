import { networkZonesClient } from "@dynatrace-sdk/client-classic-environment-v2";
import { DEFAULT_ZONE, routesOneAgents, routingPlan, type ActiveGate, type RoutingPlan, type ZoneRow } from "./activeGates";

// ---------------------------------------------------------------------------
// Network Zones tab model. Dynatrace reports neither in Grail nor through an API which ActiveGate an individual
// OneAgent is connected to, so the tab combines what is known:
//   - the OneAgent's zone (Smartscape ONEAGENT dt.network_zone.id) and the zone's routing (routingPlan in
//     activeGates.ts): the OneAgent is load-balanced over the ActiveGates of its first available priority group;
//   - the measured load: connected OneAgent modules per ActiveGate (dsfm:active_gate.communication.agent_modules.connected);
//   - per zone, the hosts connected to it as alternative or failover (classic network zones API hostStats; only when
//     network zones are on).
// ---------------------------------------------------------------------------

type Row = Record<string, any>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const zoneKey = (z: string) => (z || DEFAULT_ZONE).toLowerCase();

export type ZoneOneAgent = { agentId: string; zone: string; version: string; mode: string; hostId: string; hostName: string; hostGroup: string; cluster: string };

export const toZoneOneAgent = (r: Row): ZoneOneAgent => ({
  agentId: str(r.agentId),
  zone: zoneKey(str(r.zone)),
  version: str(r.version),
  mode: str(r.mode),
  hostId: str(r.hostId),
  hostName: str(r.hostName) || str(r.hostId),
  hostGroup: str(r.hostGroup),
  cluster: str(r.cluster),
});

/** One routing plan per zone, as things are now (no simulated outage). */
export function currentPlans(zones: ZoneRow[], ags: ActiveGate[]): Map<string, RoutingPlan> {
  return new Map(zones.map((z) => [z.zone, routingPlan(z.zone, zones, ags, new Set())]));
}

/** Where a zone's OneAgents go when every ActiveGate of the zone itself is down. */
export function zoneOutagePlan(zone: string, zones: ZoneRow[], ags: ActiveGate[]): RoutingPlan {
  const own = new Set(ags.filter((a) => zoneKey(a.networkZone) === zone).map((a) => a.agId));
  return routingPlan(zone, zones, ags, own);
}

/** Search text of a zone: its name, its ActiveGates and its OneAgents' host names. */
export function zoneMatches(z: ZoneRow, oneAgents: ZoneOneAgent[], q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  if (z.zone.includes(s)) return true;
  if (z.ags.some((a) => a.name.toLowerCase().includes(s) || a.agId.toLowerCase().includes(s))) return true;
  return oneAgents.some((o) => o.zone === z.zone && (o.hostName.toLowerCase().includes(s) || o.hostGroup.toLowerCase().includes(s)));
}

// --- Connection flow (OneAgents -> ActiveGates) -------------------------------------------------
export type FlowSource = { id: string; zone: string; hostGroup: string; label: string; oneAgents: ZoneOneAgent[]; plan?: RoutingPlan };
export type FlowTarget = {
  ag: ActiveGate;
  /** OneAgents routed here, each counted as 1 / (number of ActiveGates it is load-balanced over). */
  expected: number;
  /** Connected OneAgent modules (measured; a OneAgent has one or more modules). */
  measured: number;
};
export type FlowLink = { source: string; agId: string; value: number; prio: number };
export type ConnectionFlow = { sources: FlowSource[]; targets: FlowTarget[]; links: FlowLink[]; dropped: FlowSource[]; totalOneAgents: number; totalMeasured: number };

/** Most host groups shown per zone; the rest are merged so the diagram stays readable. */
const MAX_GROUPS_PER_ZONE = 6;

export function connectionFlow(oneAgents: ZoneOneAgent[], zones: ZoneRow[], ags: ActiveGate[], measured: Map<string, number>, plans: Map<string, RoutingPlan>): ConnectionFlow {
  const sources: FlowSource[] = [];
  for (const z of zones) {
    const inZone = oneAgents.filter((o) => o.zone === z.zone);
    if (!inZone.length) continue;
    const byGroup = new Map<string, ZoneOneAgent[]>();
    for (const o of inZone) byGroup.set(o.hostGroup, [...(byGroup.get(o.hostGroup) ?? []), o]);
    const groups = [...byGroup.entries()].sort((a, b) => b[1].length - a[1].length);
    const shown = groups.slice(0, MAX_GROUPS_PER_ZONE);
    const rest = groups.slice(MAX_GROUPS_PER_ZONE).flatMap(([, v]) => v);
    for (const [g, v] of shown) sources.push({ id: `${z.zone}|${g}`, zone: z.zone, hostGroup: g, label: g || "no host group", oneAgents: v, plan: plans.get(z.zone) });
    if (rest.length) sources.push({ id: `${z.zone}|*`, zone: z.zone, hostGroup: "*", label: `${groups.length - MAX_GROUPS_PER_ZONE} more host groups`, oneAgents: rest, plan: plans.get(z.zone) });
  }
  const links: FlowLink[] = [];
  const expected = new Map<string, number>();
  const dropped: FlowSource[] = [];
  for (const s of sources) {
    const t = s.plan?.target;
    if (!t || t.available.length === 0) {
      dropped.push(s);
      continue;
    }
    const share = s.oneAgents.length / t.available.length;
    for (const a of t.available) {
      links.push({ source: s.id, agId: a.agId, value: share, prio: t.prio });
      expected.set(a.agId, (expected.get(a.agId) ?? 0) + share);
    }
  }
  // Every ActiveGate that routes OneAgents or reports connected modules (zRemote, for example) is a target.
  const targets: FlowTarget[] = ags
    .filter((a) => routesOneAgents(a) || (measured.get(a.agId) ?? 0) > 0 || expected.has(a.agId))
    .map((ag) => ({ ag, expected: expected.get(ag.agId) ?? 0, measured: measured.get(ag.agId) ?? 0 }))
    .sort((a, b) => zoneKey(a.ag.networkZone).localeCompare(zoneKey(b.ag.networkZone)) || b.expected - a.expected || b.measured - a.measured || a.ag.name.localeCompare(b.ag.name));
  return {
    sources,
    targets,
    links,
    dropped,
    totalOneAgents: sources.reduce((n, s) => n + s.oneAgents.length, 0),
    totalMeasured: targets.reduce((n, t) => n + t.measured, 0),
  };
}

/** The ActiveGates a OneAgent is load-balanced over, or null when its traffic is dropped. */
export function candidatesOf(o: ZoneOneAgent, plans: Map<string, RoutingPlan>): { prio: number; ags: ActiveGate[] } | null {
  const t = plans.get(o.zone)?.target;
  return t && t.available.length ? { prio: t.prio, ags: t.available } : null;
}

// --- Hosts connected to a zone (measured, classic API) ------------------------------------------
export type ZoneHostStats = { configuredButNotConnected: string[]; connectedAsAlternative: string[]; connectedAsFailover: string[]; connectedAsFailoverWithoutActiveGates: string[] };

/** Scope fleet-management:network-zones:read. The endpoint answers 404 while network zones are off. */
export async function readZoneHostStats(zone: string): Promise<ZoneHostStats> {
  const r = await networkZonesClient.getHostStats({ id: zone });
  return {
    configuredButNotConnected: r.hostsConfiguredButNotConnected ?? [],
    connectedAsAlternative: r.hostsConnectedAsAlternative ?? [],
    connectedAsFailover: r.hostsConnectedAsFailover ?? [],
    connectedAsFailoverWithoutActiveGates: r.hostsConnectedAsFailoverWithoutActiveGates ?? [],
  };
}
