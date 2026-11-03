import React, { useEffect, useMemo, useRef, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { Select, ToggleButtonGroup } from "@dynatrace/strato-components/forms";
import Colors from "@dynatrace/strato-design-tokens/colors";
import Spacings from "@dynatrace/strato-design-tokens/spacings";
import Borders from "@dynatrace/strato-design-tokens/borders";
import { categoryColor, type Theme } from "../kubernetes";
import {
  DEFAULT_ZONE,
  FALLBACK_LABEL,
  FALLBACK_MODES,
  FALLBACK_TEXT,
  TYPE_LABEL,
  routesOneAgents,
  routingPlan,
  shortVersion,
  type ActiveGate,
  type PriorityGroup,
  type RoutingPlan,
  type ZoneRow,
} from "../activeGates";
import { STATUS_PALETTE, useTip } from "./AgCharts";

// ---------------------------------------------------------------------------
// Network zone map: a Smartscape-style topology of network zones (containers), their ActiveGates (nodes) and the
// OneAgents in each zone, with animated traffic to the ActiveGates the OneAgents would use (routingPlan in
// activeGates.ts: priority groups 1-4 limited by the zone's fallback mode). A simulation takes ActiveGates down (click,
// a whole zone, or a step-by-step fallback playback) and a what-if fallback mode, without writing anything. Particles are
// SVG animateMotion; they are left out when the OS asks for reduced motion.
// ---------------------------------------------------------------------------

/** Fixed palette slot per priority group (dataviz categorical order), so a group keeps its colour. */
const PRIO_SLOT: Record<number, number> = { 1: 1, 2: 3, 3: 7, 4: 2 };
const prioColor = (prio: number, theme: Theme) => categoryColor({ id: `p${prio}`, label: "", slot: PRIO_SLOT[prio], detail: "" }, theme);

const VIEW_W = 1120;
const GAP_X = 84;
const GAP_Y = 78;
const AG_R = 16;
const OA_R = 24;
const HEADER = 40;
const PAD = 16;
const OA_COL = 120;
const MAX_COLS = 5;
/** First node row sits below the header with room for its routing corridor. */
const ROW0 = HEADER + 48;

type Box = { zone: string; x: number; y: number; w: number; h: number; cols: number; row?: ZoneRow };
type Pos = { x: number; y: number };
type Layout = { boxes: Box[]; nodes: Map<string, Pos>; oneAgents: Map<string, Pos>; height: number };

const STYLE_ID = "nz-map-styles";
function ensureStyles() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
@keyframes nz-fade { from { opacity: 0; } to { opacity: 1; } }
.nz-flow { animation: nz-fade .5s ease-out; }
@media (prefers-reduced-motion: reduce) { .nz-flow { animation: none; } }
`;
  document.head.appendChild(s);
}

/** Zones in reading order: default first, then zones in use (most ActiveGates first), then configured but unused. */
function layoutZones(zones: ZoneRow[], ags: ActiveGate[]): Layout {
  const order = zones
    .slice()
    .sort((a, b) => (a.zone === DEFAULT_ZONE ? -1 : b.zone === DEFAULT_ZONE ? 1 : 0) || Number(b.ags.length + b.oneAgents > 0) - Number(a.ags.length + a.oneAgents > 0) || b.ags.length - a.ags.length || a.zone.localeCompare(b.zone));
  const boxes: Box[] = [];
  const nodes = new Map<string, Pos>();
  const oneAgents = new Map<string, Pos>();
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const row of order) {
    const members = ags.filter((a) => (a.networkZone || DEFAULT_ZONE).toLowerCase() === row.zone);
    const n = members.length;
    const used = n + row.oneAgents > 0;
    const cols = n ? Math.min(MAX_COLS, Math.max(1, Math.ceil(Math.sqrt(n * 1.6)))) : 0;
    const rows = n ? Math.ceil(n / cols) : 0;
    // Unused zones stay compact; zones with ActiveGates get a node grid to the right of the OneAgents.
    const w = used ? Math.max(260, OA_COL + cols * GAP_X + PAD) : 230;
    const h = used ? Math.max(HEADER + 132, ROW0 + (rows - 1) * GAP_Y + 44) : HEADER + 56;
    if (x > 0 && x + w > VIEW_W) {
      x = 0;
      y += rowH + 28;
      rowH = 0;
    }
    const box: Box = { zone: row.zone, x, y, w, h, cols, row };
    boxes.push(box);
    oneAgents.set(row.zone, { x: x + OA_COL / 2 - 6, y: rows ? y + ROW0 + ((rows - 1) * GAP_Y) / 2 : y + HEADER + (h - HEADER) / 2 + 4 });
    // Routing ActiveGates first, so the nodes that take traffic sit next to the OneAgents.
    members
      .slice()
      .sort((a, b) => Number(routesOneAgents(b)) - Number(routesOneAgents(a)) || a.name.localeCompare(b.name))
      .forEach((a, i) => nodes.set(a.agId, { x: x + OA_COL + (i % cols) * GAP_X + GAP_X / 2 - 10, y: y + ROW0 + Math.floor(i / cols) * GAP_Y }));
    x += w + 28;
    rowH = Math.max(rowH, h);
  }
  return { boxes, nodes, oneAgents, height: y + rowH + 8 };
}

/**
 * Inside a zone, edges are routed like Smartscape: a trunk next to the OneAgents, then the free corridor above the
 * node's row, then down into the node, so they never cross other nodes. Across zones, a bowed curve.
 */
function flowPath(a: Pos, b: Pos, sameZone: boolean): string {
  if (sameZone) {
    const trunk = a.x + OA_R + 14;
    const corridor = b.y - GAP_Y / 2;
    return `M${a.x + OA_R},${a.y} L${trunk},${a.y} L${trunk},${corridor} L${b.x},${corridor} L${b.x},${b.y - AG_R}`;
  }
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.max(1, Math.hypot(dx, dy));
  const bow = Math.min(120, len * 0.25);
  return `M${a.x},${a.y} Q${mx - (dy / len) * bow},${my + (dx / len) * bow} ${b.x},${b.y}`;
}

const glyph = (ag: ActiveGate) => (ag.type === "SYNTHETIC_ENGINE" ? "S" : ag.type === "ZREMOTE" ? "Z" : ag.containerized ? "K" : "E");
const shortName = (s: string, n = 16) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const card: React.CSSProperties = { padding: Spacings.Size16, borderRadius: Borders.Radius.Container.Default, background: Colors.Background.Container.Neutral.Default };
const hint: React.CSSProperties = { fontSize: 12, opacity: 0.7 };

type Play = { zone: string; step: number };
const PLAY_MS = 2600;

export function NetworkZoneMap({
  ags,
  zones,
  agents,
  zonesEnabled,
  theme,
  onInspect,
}: {
  ags: ActiveGate[];
  zones: ZoneRow[];
  /** Connected OneAgent modules per ActiveGate (peak). */
  agents: Map<string, number>;
  /** undefined = the network zone settings were not read. */
  zonesEnabled?: boolean;
  theme: Theme;
  onInspect: (ag: ActiveGate) => void;
}) {
  ensureStyles();
  const reducedMotion = useMemo(() => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches, []);
  const layout = useMemo(() => layoutZones(zones, ags), [zones, ags]);
  const [focus, setFocus] = useState<string | null>(null);
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"inspect" | "simulate">("inspect");
  const [play, setPlay] = useState<Play | null>(null);
  const [hoverAg, setHoverAg] = useState<string | null>(null);
  const [hoverZone, setHoverZone] = useState<string | null>(null);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { ref: tipRef, show, hide, node: tipNode } = useTip();

  // Playback: the stages are the groups the focused zone can use, failed one after the other.
  const stages = useMemo(() => {
    if (!play) return [] as PriorityGroup[];
    const base = routingPlan(play.zone, zones, ags, failed, overrides[play.zone]);
    return base.groups.filter((g) => g.allowed && g.available.length > 0);
  }, [play, zones, ags, failed, overrides]);
  const effectiveFailed = useMemo(() => {
    if (!play) return failed;
    const out = new Set(failed);
    stages.slice(0, play.step).forEach((g) => g.available.forEach((a) => out.add(a.agId)));
    return out;
  }, [failed, play, stages]);
  useEffect(() => {
    if (!play || play.step >= stages.length) return;
    const t = setTimeout(() => setPlay((p) => (p ? { ...p, step: p.step + 1 } : p)), PLAY_MS);
    return () => clearTimeout(t);
  }, [play, stages.length]);

  // One plan per zone with OneAgents, plus the focused zone (what-if for zones without OneAgents).
  const plans = useMemo(() => {
    const m = new Map<string, RoutingPlan>();
    for (const z of zones) if (z.oneAgents > 0 || z.zone === focus) m.set(z.zone, routingPlan(z.zone, zones, ags, effectiveFailed, overrides[z.zone]));
    return m;
  }, [zones, ags, effectiveFailed, overrides, focus]);
  const focusPlan = focus ? plans.get(focus) ?? null : null;
  const byAgId = useMemo(() => new Map(ags.map((a) => [a.agId, a])), [ags]);

  const flows = useMemo(() => {
    const out: { key: string; zone: string; agId: string; prio: number; d: string; load: number }[] = [];
    for (const [zone, plan] of plans) {
      if (!plan.target) continue;
      const from = layout.oneAgents.get(zone);
      if (!from) continue;
      for (const a of plan.target.available) {
        const to = layout.nodes.get(a.agId);
        if (!to) continue;
        out.push({ key: `${zone}->${a.agId}@${plan.target.prio}`, zone, agId: a.agId, prio: plan.target.prio, d: flowPath(from, to, plan.target.prio === 1 || (zone === DEFAULT_ZONE && plan.target.prio === 3)), load: agents.get(a.agId) ?? 0 });
      }
    }
    return out;
  }, [plans, layout, agents]);

  const toggleFailed = (agId: string) => {
    setPlay(null);
    setFailed((prev) => {
      const next = new Set(prev);
      if (next.has(agId)) next.delete(agId);
      else next.add(agId);
      return next;
    });
  };
  const failZone = (zone: string) => {
    setPlay(null);
    setFailed((prev) => {
      const next = new Set(prev);
      ags.filter((a) => (a.networkZone || DEFAULT_ZONE).toLowerCase() === zone).forEach((a) => next.add(a.agId));
      return next;
    });
  };
  const reset = () => {
    setPlay(null);
    setFailed(new Set());
    setOverrides({});
  };
  const zoomBy = (f: number) => setView((v) => ({ ...v, k: Math.min(2.5, Math.max(0.5, v.k * f)) }));
  const toViewUnits = () => VIEW_W / Math.max(1, svgRef.current?.clientWidth ?? VIEW_W);

  const agTip = (a: ActiveGate) => {
    const connected = agents.get(a.agId);
    const state = failed.has(a.agId) || effectiveFailed.has(a.agId) ? "Down (simulation)" : !a.online ? "Not connected" : routesOneAgents(a) ? "Routes OneAgent traffic" : "No OneAgent routing (module off)";
    return (
      <>
        <strong>{a.name}</strong>
        <br />
        {TYPE_LABEL[a.type] ?? a.type}
        {a.containerized ? " · containerized" : ""} · group {a.group || "—"}
        <br />
        Zone {a.networkZone || DEFAULT_ZONE} · version {shortVersion(a.version) || "—"}
        <br />
        {state}
        {connected !== undefined ? ` · ${Math.round(connected)} OneAgent modules connected (peak)` : ""}
        <br />
        <span style={{ opacity: 0.75 }}>{mode === "simulate" ? "Click to take it down / bring it back (simulation)" : "Click to show its connections"}</span>
      </>
    );
  };
  const zoneTip = (b: Box) => {
    const p = plans.get(b.zone);
    return (
      <>
        <strong>Network zone {b.zone}</strong>
        <br />
        Fallback {FALLBACK_LABEL[overrides[b.zone] || b.row?.fallback || ""] ?? "not read"}
        {overrides[b.zone] ? " (what-if)" : b.row?.configured ? "" : " (default)"}
        <br />
        {b.row?.oneAgents ?? 0} OneAgents · {b.row?.online ?? 0} of {b.row?.ags.length ?? 0} ActiveGates connected
        {p && (
          <>
            <br />
            {p.dropped ? "Traffic dropped" : `Traffic → group ${p.target!.prio} (${p.target!.label})`}
          </>
        )}
        <br />
        <span style={{ opacity: 0.75 }}>Click to see its fallback chain</span>
      </>
    );
  };

  const activeZone = hoverZone ?? focus;
  const flowOpacity = (f: { zone: string; agId: string }) => (hoverAg ? (f.agId === hoverAg ? 1 : 0.12) : activeZone ? (f.zone === activeZone ? 1 : 0.15) : 0.85);
  const neutral = categoryColor({ id: "n", label: "", slot: null, detail: "" }, theme);
  const routing = prioColor(1, theme);
  const surface = Colors.Background.Surface.Default;

  return (
    <div style={card}>
      <Flex justifyContent="space-between" alignItems="flex-end" flexWrap="wrap" gap={8}>
        <div style={{ maxWidth: 820 }}>
          <Heading level={4}>Network zone map</Heading>
          <Text style={hint}>
            Zones with their ActiveGates and OneAgents. The moving dots are the traffic the zone&apos;s OneAgents send: to the first priority group with an available ActiveGate (1 same zone, 2 alternative zones, 3 default zone, 4 any other),
            as far as the zone&apos;s fallback allows. Only connected ActiveGates with OneAgent routing take traffic. Simulate outages and fallback modes here; nothing is saved.
          </Text>
        </div>
        <Flex gap={8} alignItems="center" flexWrap="wrap">
          <ToggleButtonGroup value={mode} onChange={(v: string) => v && setMode(v as "inspect" | "simulate")} name="nz-mode" aria-label="Click on an ActiveGate">
            <ToggleButtonGroup.Item value="inspect">Click: show connections</ToggleButtonGroup.Item>
            <ToggleButtonGroup.Item value="simulate">Click: simulate outage</ToggleButtonGroup.Item>
          </ToggleButtonGroup>
          <Button size="condensed" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">
            −
          </Button>
          <Button size="condensed" onClick={() => zoomBy(1.2)} aria-label="Zoom in">
            +
          </Button>
          <Button size="condensed" onClick={() => setView({ k: 1, x: 0, y: 0 })}>
            Fit
          </Button>
          <Button size="condensed" onClick={reset} disabled={failed.size === 0 && !play && Object.keys(overrides).length === 0}>
            Reset simulation
          </Button>
        </Flex>
      </Flex>
      {zonesEnabled === false && (
        <div role="status" style={{ marginTop: Spacings.Size8, padding: "6px 10px", borderRadius: 6, borderLeft: `4px solid ${STATUS_PALETTE.warning}`, background: "rgba(128,128,128,0.06)" }}>
          <Text style={{ fontSize: 12 }}>Network zones are turned off for this environment: the map shows how traffic would be routed by zone once they are turned on.</Text>
        </div>
      )}
      <Legend theme={theme} neutral={neutral} />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: 16, marginTop: Spacings.Size8, alignItems: "start" }}>
        <div ref={tipRef} style={{ position: "relative", border: "1px solid rgba(128,128,128,0.2)", borderRadius: 8, overflow: "hidden" }} onMouseLeave={hide}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VIEW_W} ${Math.max(220, layout.height)}`}
            width="100%"
            role="img"
            aria-label={`Network zone map: ${zones.length} zones, ${ags.length} ActiveGates`}
            style={{ display: "block", cursor: drag.current ? "grabbing" : "grab", touchAction: "none", userSelect: "none" }}
            onPointerDown={(e) => {
              if ((e.target as Element).getAttribute("data-bg") !== "1") return;
              drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
              (e.target as Element).setPointerCapture?.(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              const f = toViewUnits();
              setView((v) => ({ ...v, x: drag.current!.vx + (e.clientX - drag.current!.x) * f, y: drag.current!.vy + (e.clientY - drag.current!.y) * f }));
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerLeave={() => (drag.current = null)}
          >
            <rect data-bg="1" x={0} y={0} width={VIEW_W} height={Math.max(220, layout.height)} fill="transparent" />
            <g transform={`translate(${view.x + 8} ${view.y + 8}) scale(${view.k})`}>
              {/* Zones (alternative zones are named in the header; the traffic shows when they are used) */}
              {layout.boxes.map((b) => {
                const fb = overrides[b.zone] || b.row?.fallback || "";
                const used = (b.row?.ags.length ?? 0) + (b.row?.oneAgents ?? 0) > 0;
                const focused = focus === b.zone;
                return (
                  <g key={b.zone} data-zone={b.zone} style={{ cursor: "pointer" }} onClick={() => setFocus(focused ? null : b.zone)} onMouseEnter={() => setHoverZone(b.zone)} onMouseLeave={() => setHoverZone(null)} onMouseMove={(e) => !hoverAg && show(e, zoneTip(b))}>
                    <rect
                      x={b.x}
                      y={b.y}
                      width={b.w}
                      height={b.h}
                      rx={12}
                      fill={focused ? "rgba(42,120,214,0.08)" : "rgba(128,128,128,0.06)"}
                      stroke={focused ? routing : "rgba(128,128,128,0.4)"}
                      strokeWidth={focused ? 2 : 1}
                      strokeDasharray={used ? undefined : "6 4"}
                    />
                    <text x={b.x + 14} y={b.y + 20} fontSize={13} fontWeight={700} fill="currentColor">
                      {shortName(b.zone, Math.floor((b.w - 28) / 8))}
                    </text>
                    <text x={b.x + 14} y={b.y + 34} fontSize={10.5} fill={fb === "NONE" ? STATUS_PALETTE.warning : "currentColor"} opacity={fb === "NONE" ? 1 : 0.7}>
                      fallback {FALLBACK_LABEL[fb] ?? "not read"}
                      {overrides[b.zone] ? " (what-if)" : b.row?.configured ? "" : " (default)"}
                      {b.row?.alternatives.length ? ` · alt ${b.row.alternatives.join(", ")}` : ""}
                    </text>
                    {!used && !focused && (
                      <text x={b.x + b.w / 2} y={b.y + HEADER + (b.h - HEADER) / 2 + 4} fontSize={11} textAnchor="middle" fill="currentColor" opacity={0.55}>
                        no ActiveGate or OneAgent
                      </text>
                    )}
                  </g>
                );
              })}
              {/* Traffic */}
              {flows.map((f) => {
                const color = prioColor(f.prio, theme);
                const particles = reducedMotion ? 0 : Math.min(4, 1 + Math.floor(f.load / 15));
                const dur = f.prio === 1 ? 1.8 : 2.6;
                return (
                  <g key={f.key} className="nz-flow" opacity={flowOpacity(f)} style={{ transition: "opacity 160ms ease" }} pointerEvents="none">
                    <path d={f.d} fill="none" stroke={color} strokeWidth={2} strokeOpacity={0.55} strokeDasharray={f.prio === 1 ? undefined : "5 4"} />
                    {Array.from({ length: particles }, (_, i) => (
                      <circle key={i} r={3.2} fill={color}>
                        <animateMotion dur={`${dur}s`} repeatCount="indefinite" begin={`${(-i * dur) / particles}s`} path={f.d} />
                      </circle>
                    ))}
                  </g>
                );
              })}
              {/* OneAgents per zone */}
              {layout.boxes.map((b) => {
                const pos = layout.oneAgents.get(b.zone)!;
                const count = b.row?.oneAgents ?? 0;
                const plan = plans.get(b.zone);
                if (count === 0 && focus !== b.zone) return null;
                return (
                  <g key={`oa-${b.zone}`} pointerEvents="none">
                    {plan?.dropped && !reducedMotion && (
                      <circle cx={pos.x} cy={pos.y} r={26} fill="none" stroke={STATUS_PALETTE.critical} strokeWidth={3}>
                        <animate attributeName="r" values="26;42" dur="1.6s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0.9;0" dur="1.6s" repeatCount="indefinite" />
                      </circle>
                    )}
                    <circle cx={pos.x} cy={pos.y} r={OA_R} fill={count ? neutral : "none"} stroke={plan?.dropped ? STATUS_PALETTE.critical : surface} strokeWidth={count ? 2 : 1.5} strokeDasharray={count ? undefined : "4 3"} />
                    <text x={pos.x} y={pos.y + 4} fontSize={count > 999 ? 10 : 12} fontWeight={700} textAnchor="middle" fill={count ? "#fff" : "currentColor"}>
                      {count.toLocaleString()}
                    </text>
                    <text x={pos.x} y={pos.y + OA_R + 14} fontSize={10.5} textAnchor="middle" fill="currentColor" opacity={0.8}>
                      {count ? "OneAgents" : "what-if"}
                    </text>
                    {plan?.dropped && (
                      <text x={pos.x} y={pos.y + OA_R + 27} fontSize={10.5} fontWeight={700} textAnchor="middle" fill={STATUS_PALETTE.critical}>
                        ✕ traffic dropped
                      </text>
                    )}
                  </g>
                );
              })}
              {/* ActiveGates */}
              {ags.map((a) => {
                const pos = layout.nodes.get(a.agId);
                if (!pos) return null;
                const down = effectiveFailed.has(a.agId);
                const routes = routesOneAgents(a);
                const fill = down ? "#5c5c5c" : !a.online ? neutral : routes ? routing : neutral;
                const target = flows.some((f) => f.agId === a.agId);
                const load = agents.get(a.agId);
                return (
                  <g
                    key={a.agId}
                    data-ag={a.agId}
                    style={{ cursor: "pointer" }}
                    onMouseEnter={() => setHoverAg(a.agId)}
                    onMouseLeave={() => setHoverAg(null)}
                    onMouseMove={(e) => {
                      e.stopPropagation();
                      show(e, agTip(a));
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (mode === "simulate") toggleFailed(a.agId);
                      else onInspect(a);
                    }}
                  >
                    {target && !reducedMotion && <circle cx={pos.x} cy={pos.y} r={AG_R + 4} fill="none" stroke={fill} strokeWidth={1.5} opacity={0.5} />}
                    <circle cx={pos.x} cy={pos.y} r={AG_R} fill={fill} opacity={routes || down ? 1 : 0.55} stroke={!a.online && !down ? STATUS_PALETTE.critical : surface} strokeWidth={2} />
                    <text x={pos.x} y={pos.y + 4} fontSize={11} fontWeight={700} textAnchor="middle" fill="#fff" pointerEvents="none">
                      {down ? "✕" : glyph(a)}
                    </text>
                    {load !== null && load !== undefined && load > 0 && (
                      <g pointerEvents="none">
                        <rect x={pos.x + 9} y={pos.y - 24} width={String(Math.round(load)).length * 6.5 + 8} height={14} rx={7} fill={surface} stroke="rgba(128,128,128,0.5)" />
                        <text x={pos.x + 13} y={pos.y - 14} fontSize={9.5} fill="currentColor">
                          {Math.round(load)}
                        </text>
                      </g>
                    )}
                    <text x={pos.x} y={pos.y + AG_R + 13} fontSize={9.5} textAnchor="middle" fill="currentColor" opacity={0.85} pointerEvents="none">
                      {shortName(a.name, 13)}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
          {tipNode}
        </div>
        <SidePanel
          zones={zones}
          focus={focus}
          plan={focusPlan}
          plans={plans}
          overrides={overrides}
          setOverride={(zone, fb) => {
            setPlay(null);
            setOverrides((o) => {
              const next = { ...o };
              if (fb) next[zone] = fb;
              else delete next[zone];
              return next;
            });
          }}
          onFocus={setFocus}
          onFailZone={failZone}
          play={play}
          stages={stages}
          onPlay={(zone) => setPlay({ zone, step: 0 })}
          onStop={() => setPlay(null)}
          failedCount={failed.size}
          theme={theme}
          byAgId={byAgId}
        />
      </div>
      <RoutingTable zones={zones} plans={plans} />
    </div>
  );
}

function Legend({ theme, neutral }: { theme: Theme; neutral: string }) {
  const item = (swatch: React.ReactNode, label: string) => (
    <Flex gap={6} alignItems="center">
      {swatch}
      <Text style={{ fontSize: 12 }}>{label}</Text>
    </Flex>
  );
  const line = (color: string, dashed: boolean) => (
    <svg width={26} height={10} aria-hidden>
      <line x1={1} y1={5} x2={25} y2={5} stroke={color} strokeWidth={2} strokeDasharray={dashed ? "5 4" : undefined} />
      <circle cx={18} cy={5} r={3} fill={color} />
    </svg>
  );
  const dot = (fill: string, opacity = 1, text = "E", ring?: string) => (
    <svg width={18} height={18} aria-hidden>
      <circle cx={9} cy={9} r={7.5} fill={fill} opacity={opacity} stroke={ring ?? "none"} strokeWidth={ring ? 2 : 0} />
      <text x={9} y={12.5} fontSize={9} fontWeight={700} textAnchor="middle" fill="#fff">
        {text}
      </text>
    </svg>
  );
  return (
    <Flex gap={16} flexWrap="wrap" alignItems="center" style={{ marginTop: Spacings.Size8 }}>
      {[1, 2, 3, 4].map((p) => item(line(prioColor(p, theme), p !== 1), `Group ${p}: ${({ 1: "same zone", 2: "alternative zones", 3: "default zone", 4: "any other" } as Record<number, string>)[p]}`))}
      {item(dot(prioColor(1, theme)), "Routes OneAgent traffic")}
      {item(dot(neutral, 0.55), "No OneAgent routing")}
      {item(dot(neutral, 1, "E", STATUS_PALETTE.critical), "Not connected")}
      {item(dot("#5c5c5c", 1, "✕"), "Down (simulation)")}
      {item(
        <svg width={18} height={18} aria-hidden>
          <circle cx={9} cy={9} r={7} fill="none" stroke={STATUS_PALETTE.critical} strokeWidth={2.5} />
        </svg>,
        "Traffic dropped",
      )}
      <Text style={{ fontSize: 12, opacity: 0.7 }}>E host-based · K Kubernetes · S synthetic · Z zRemote · badge = connected OneAgent modules</Text>
    </Flex>
  );
}

function SidePanel({
  zones,
  focus,
  plan,
  plans,
  overrides,
  setOverride,
  onFocus,
  onFailZone,
  play,
  stages,
  onPlay,
  onStop,
  failedCount,
  theme,
  byAgId,
}: {
  zones: ZoneRow[];
  focus: string | null;
  plan: RoutingPlan | null;
  plans: Map<string, RoutingPlan>;
  overrides: Record<string, string>;
  setOverride: (zone: string, fallback: string | null) => void;
  onFocus: (zone: string | null) => void;
  onFailZone: (zone: string) => void;
  play: Play | null;
  stages: PriorityGroup[];
  onPlay: (zone: string) => void;
  onStop: () => void;
  failedCount: number;
  theme: Theme;
  byAgId: Map<string, ActiveGate>;
}) {
  const panel: React.CSSProperties = { padding: 12, borderRadius: 8, border: "1px solid rgba(128,128,128,0.25)", minHeight: 220 };
  if (!focus || !plan) {
    return (
      <div style={panel}>
        <Text style={{ fontWeight: 700, display: "block" }}>Fallback chains</Text>
        <Text style={{ ...hint, display: "block", marginBottom: 8 }}>Click a zone on the map (or below) to see where its OneAgents send traffic, try another fallback mode, or play an outage.</Text>
        <Flex flexDirection="column" gap={6}>
          {zones.map((z) => {
            const p = plans.get(z.zone);
            return (
              <button key={z.zone} type="button" onClick={() => onFocus(z.zone)} style={{ all: "unset", cursor: "pointer", padding: "4px 6px", borderRadius: 4, background: "rgba(128,128,128,0.06)" }}>
                <Text style={{ fontSize: 12, fontWeight: 600, display: "block" }}>{z.zone}</Text>
                <Text style={{ fontSize: 11, display: "block", opacity: 0.8, color: p?.dropped ? STATUS_PALETTE.critical : undefined }}>
                  {z.oneAgents ? `${z.oneAgents} OneAgents → ` : "No OneAgents · "}
                  {p ? (p.dropped ? "traffic dropped" : `group ${p.target!.prio} (${p.target!.available.length} ActiveGates)`) : `fallback ${FALLBACK_LABEL[z.fallback] ?? "not read"}`}
                </Text>
              </button>
            );
          })}
        </Flex>
        {failedCount > 0 && <Text style={{ ...hint, display: "block", marginTop: 8 }}>{failedCount} ActiveGates down in the simulation.</Text>}
      </div>
    );
  }
  const row = zones.find((z) => z.zone === focus);
  const override = overrides[focus];
  const playing = play?.zone === focus;
  const caption = (() => {
    if (!playing || !play) return null;
    if (play.step === 0) return `Normal: traffic goes to group ${plan.target?.prio ?? "—"}.`;
    const lost = stages[play.step - 1];
    return `${lost.label} unavailable → ${plan.dropped ? "no allowed group left: traffic dropped" : `traffic moves to group ${plan.target!.prio} (${plan.target!.label})`}.`;
  })();
  return (
    <div style={panel}>
      <Flex justifyContent="space-between" alignItems="baseline" gap={8}>
        <Text style={{ fontWeight: 700, wordBreak: "break-word", minWidth: 0 }}>Zone {focus}</Text>
        <button type="button" onClick={() => onFocus(null)} style={{ all: "unset", cursor: "pointer", fontSize: 12, textDecoration: "underline", whiteSpace: "nowrap", flex: "none" }}>
          all zones
        </button>
      </Flex>
      <Text style={{ ...hint, display: "block" }}>
        {row?.oneAgents ?? 0} OneAgents{row?.oneAgents ? "" : " (what-if)"} · {row?.online ?? 0} of {row?.ags.length ?? 0} ActiveGates connected
      </Text>
      <div style={{ marginTop: 8 }}>
        <Text style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 2 }}>Fallback mode</Text>
        <Select value={override ?? "__configured__"} onChange={(v: string | null) => v && setOverride(focus, v === "__configured__" ? null : v)}>
          <Select.Content>
            <Select.Option value="__configured__">
              {FALLBACK_LABEL[row?.fallback ?? ""] ?? "Not read"} ({row?.configured ? "configured" : "default"})
            </Select.Option>
            {FALLBACK_MODES.filter((m) => m !== row?.fallback).map((m) => (
              <Select.Option key={m} value={m}>
                What-if: {FALLBACK_LABEL[m]}
              </Select.Option>
            ))}
          </Select.Content>
        </Select>
        <Text style={{ ...hint, display: "block", marginTop: 4 }}>{FALLBACK_TEXT[plan.fallback]}</Text>
      </div>
      <ol style={{ margin: "10px 0 0", paddingLeft: 0, listStyle: "none" }}>
        {plan.groups.map((g) => {
          const isTarget = plan.target?.prio === g.prio;
          const why = !g.allowed ? "not allowed by the fallback" : g.sameAsFirst ? "same as group 1" : g.ags.length === 0 ? "no ActiveGate" : g.available.length === 0 ? "none available" : isTarget ? "traffic goes here" : "standby";
          return (
            <li key={g.prio} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "5px 0", opacity: g.allowed ? 1 : 0.5 }}>
              <span aria-hidden style={{ flex: "none", width: 20, height: 20, borderRadius: 10, background: prioColor(g.prio, theme), color: "#fff", fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                {g.prio}
              </span>
              <div style={{ minWidth: 0 }}>
                <Text style={{ fontSize: 12, fontWeight: isTarget ? 700 : 600, display: "block", textDecoration: g.allowed ? undefined : "line-through" }}>
                  {g.label}
                  {g.zones.length && g.prio !== 4 ? ` (${g.zones.join(", ")})` : ""}
                </Text>
                <Text style={{ fontSize: 11, display: "block", opacity: 0.85, color: isTarget ? prioColor(g.prio, theme) : undefined, fontWeight: isTarget ? 700 : undefined }}>
                  {g.sameAsFirst ? why : `${g.available.length} of ${g.ags.length} available · ${why}`}
                </Text>
                {isTarget && (
                  <Text style={{ fontSize: 11, display: "block", opacity: 0.75, wordBreak: "break-word" }}>
                    {g.available
                      .slice(0, 6)
                      .map((a) => byAgId.get(a.agId)?.name ?? a.name)
                      .join(", ")}
                    {g.available.length > 6 ? `, … (${g.available.length})` : ""}
                  </Text>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <div role="status" style={{ marginTop: 8, padding: "6px 8px", borderRadius: 6, borderLeft: `4px solid ${plan.dropped ? STATUS_PALETTE.critical : prioColor(plan.target!.prio, theme)}`, background: "rgba(128,128,128,0.06)" }}>
        <Text style={{ fontSize: 12, fontWeight: 600 }}>
          {plan.dropped ? "Traffic dropped: no group the fallback allows has an available ActiveGate." : `Traffic: group ${plan.target!.prio}, load-balanced over ${plan.target!.available.length} ActiveGates.`}
        </Text>
      </div>
      {caption && <Text style={{ fontSize: 12, display: "block", marginTop: 6 }}>{caption}</Text>}
      <Flex gap={6} flexWrap="wrap" style={{ marginTop: 10 }}>
        {playing ? (
          <Button size="condensed" variant="emphasized" onClick={onStop}>
            Stop playback
          </Button>
        ) : (
          <Button size="condensed" variant="emphasized" onClick={() => onPlay(focus)} disabled={plan.dropped}>
            ▶ Play fallback
          </Button>
        )}
        <Button size="condensed" onClick={() => onFailZone(focus)} disabled={!row?.ags.length}>
          Take the zone&apos;s ActiveGates down
        </Button>
      </Flex>
    </div>
  );
}

/** The same routing as text, one row per zone (also the accessible alternative to the map). */
function RoutingTable({ zones, plans }: { zones: ZoneRow[]; plans: Map<string, RoutingPlan> }) {
  const cell: React.CSSProperties = { padding: "4px 8px", fontSize: 12, verticalAlign: "top", textAlign: "left" };
  return (
    <details style={{ marginTop: Spacings.Size12 }}>
      <summary style={{ cursor: "pointer", fontSize: 12, opacity: 0.8 }}>Routing per zone as a table</summary>
      <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 6 }}>
        <thead>
          <tr>
            {["Zone", "OneAgents", "Fallback", "Traffic goes to", "ActiveGates used"].map((h) => (
              <th key={h} style={{ ...cell, borderBottom: "1px solid rgba(128,128,128,0.3)" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {zones.map((z) => {
            const p = plans.get(z.zone);
            return (
              <tr key={z.zone}>
                <td style={cell}>{z.zone}</td>
                <td style={cell}>{z.oneAgents}</td>
                <td style={cell}>
                  {FALLBACK_LABEL[p?.fallback ?? z.fallback] ?? "not read"}
                  {z.configured ? "" : " (default)"}
                </td>
                <td style={{ ...cell, color: p?.dropped ? STATUS_PALETTE.critical : undefined, fontWeight: p?.dropped ? 700 : undefined }}>{p ? (p.dropped ? "Dropped" : `Group ${p.target!.prio}: ${p.target!.label}`) : "— (no OneAgents)"}</td>
                <td style={{ ...cell, wordBreak: "break-word" }}>{p?.target ? p.target.available.map((a) => a.name).join(", ") : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}
