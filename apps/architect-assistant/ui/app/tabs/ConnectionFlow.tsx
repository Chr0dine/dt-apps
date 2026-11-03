import React, { useMemo, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { categoryColor, type Theme } from "../kubernetes";
import { DEFAULT_ZONE, PRIORITY_LABEL, routesOneAgents } from "../activeGates";
import type { ConnectionFlow as Flow, FlowSource, FlowTarget } from "../networkZones";
import { STATUS_PALETTE, useTip } from "./AgCharts";

// ---------------------------------------------------------------------------
// Connection flow: a Sankey-style diagram of OneAgents (left, grouped by zone and host group) and the ActiveGates they
// are routed to (right). A ribbon's width is the number of OneAgents of the group divided by the number of ActiveGates
// they are load-balanced over; its colour is the priority group (same slots as the zone map). Each ActiveGate also shows
// its routed share of OneAgents next to its measured share of connected OneAgent modules. Custom SVG, no Strato chart.
// ---------------------------------------------------------------------------

const PRIO_SLOT: Record<number, number> = { 1: 1, 2: 3, 3: 7, 4: 2 };
const prioColor = (prio: number, theme: Theme) => categoryColor({ id: `p${prio}`, label: "", slot: PRIO_SLOT[prio], detail: "" }, theme);

const W = 1000;
const LEFT_X = 230;
const RIGHT_X = 700;
const NODE_W = 14;
const GAP = 10;
const SRC_MIN = 28;
const TGT_MIN = 50;
const TOP = 26;

export type FlowSelection = { kind: "source" | "target"; id: string } | null;

const STYLE_ID = "cf-styles";
function ensureStyles() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `@keyframes cf-dash { to { stroke-dashoffset: -24; } }
.cf-flow { animation: cf-dash 1.4s linear infinite; }
@media (prefers-reduced-motion: reduce) { .cf-flow { animation: none; display: none; } }`;
  document.head.appendChild(s);
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const pct = (part: number, total: number) => (total > 0 ? Math.round((100 * part) / total) : 0);

type Placed<T> = T & { y: number; h: number };

export function ConnectionFlow({
  flow,
  theme,
  selection,
  onSelect,
  matches,
}: {
  flow: Flow;
  theme: Theme;
  selection: FlowSelection;
  onSelect: (s: FlowSelection) => void;
  /** Source ids that contain a OneAgent matching the search (highlighted). */
  matches: Set<string>;
}) {
  ensureStyles();
  const { ref, show, hide, node: tip } = useTip();
  const [hover, setHover] = useState<FlowSelection>(null);
  const routing = prioColor(1, theme);
  const neutral = categoryColor({ id: "n", label: "", slot: null, detail: "" }, theme);

  const layout = useMemo(() => {
    const total = Math.max(1, flow.totalOneAgents);
    // One scale for both sides so a ribbon is equally thick at both ends.
    const k = Math.min(14, Math.max(2, 420 / total));
    let y = TOP;
    const sources: Placed<FlowSource>[] = flow.sources.map((s) => {
      const h = Math.max(SRC_MIN, s.oneAgents.length * k);
      const p = { ...s, y, h };
      y += h + GAP;
      return p;
    });
    const leftH = y;
    y = TOP;
    const targets: Placed<FlowTarget>[] = flow.targets.map((t) => {
      const h = Math.max(TGT_MIN, t.expected * k);
      const p = { ...t, y, h };
      y += h + GAP;
      return p;
    });
    const height = Math.max(leftH, y) + 8;
    // Stack ribbons inside their nodes, in target order at the source and source order at the target.
    const srcOffset = new Map(sources.map((s) => [s.id, s.y]));
    const tgtOffset = new Map(targets.map((t) => [t.ag.agId, t.y]));
    const tgtIndex = new Map(targets.map((t, i) => [t.ag.agId, i]));
    const ordered = flow.links.slice().sort((a, b) => (tgtIndex.get(a.agId) ?? 0) - (tgtIndex.get(b.agId) ?? 0));
    const ribbons = ordered.map((l) => {
      const w = l.value * k;
      const y0 = srcOffset.get(l.source) ?? 0;
      srcOffset.set(l.source, y0 + w);
      return { ...l, w, y0 };
    });
    for (const s of sources) srcOffset.set(s.id, s.y);
    const bySource = flow.sources.map((s) => s.id);
    const ribbonsAtTarget = ribbons
      .slice()
      .sort((a, b) => bySource.indexOf(a.source) - bySource.indexOf(b.source))
      .map((r) => {
        const y1 = tgtOffset.get(r.agId) ?? 0;
        tgtOffset.set(r.agId, y1 + r.w);
        return { ...r, y1 };
      });
    const maxPct = Math.max(1, ...targets.map((t) => Math.max(pct(t.expected, flow.totalOneAgents), pct(t.measured, flow.totalMeasured))));
    return { sources, targets, ribbons: ribbonsAtTarget, height, maxPct };
  }, [flow]);

  const active = hover ?? selection;
  const ribbonActive = (r: { source: string; agId: string }) => !active || (active.kind === "source" ? r.source === active.id : r.agId === active.id);
  const x0 = LEFT_X + NODE_W;
  const x1 = RIGHT_X;
  const xm = (x0 + x1) / 2;
  const band = (y0: number, y1: number, w: number) => `M${x0},${y0} C${xm},${y0} ${xm},${y1} ${x1},${y1} L${x1},${y1 + w} C${xm},${y1 + w} ${xm},${y0 + w} ${x0},${y0 + w} Z`;
  const mid = (y0: number, y1: number, w: number) => `M${x0},${y0 + w / 2} C${xm},${y0 + w / 2} ${xm},${y1 + w / 2} ${x1},${y1 + w / 2}`;
  // Room for the longest bar plus its label ("measured 100% (9999)") inside the view box.
  const barMax = W - (RIGHT_X + NODE_W + 12) - 130;

  if (flow.sources.length === 0) return <Text>No OneAgent in this timeframe.</Text>;
  return (
    <div ref={ref} style={{ position: "relative" }} onMouseLeave={hide}>
      <svg viewBox={`0 0 ${W} ${layout.height}`} width="100%" role="img" aria-label={`${flow.totalOneAgents} OneAgents routed to ${flow.targets.length} ActiveGates`} style={{ display: "block" }}>
        <text x={LEFT_X + NODE_W} y={14} fontSize={11} fontWeight={700} fill="currentColor" textAnchor="end" opacity={0.8}>
          OneAgents (zone · host group)
        </text>
        <text x={RIGHT_X} y={14} fontSize={11} fontWeight={700} fill="currentColor" opacity={0.8}>
          ActiveGates · routed share vs measured share
        </text>
        {/* Ribbons */}
        {layout.ribbons.map((r) => {
          const color = prioColor(r.prio, theme);
          const on = ribbonActive(r);
          return (
            <g key={`${r.source}->${r.agId}`} opacity={on ? 1 : 0.12} style={{ transition: "opacity 160ms ease" }}>
              <path
                d={band(r.y0, r.y1, r.w)}
                fill={color}
                fillOpacity={active && on ? 0.55 : 0.32}
                stroke={color}
                strokeOpacity={0.5}
                strokeWidth={0.5}
                onMouseMove={(e) => {
                  const src = flow.sources.find((s) => s.id === r.source);
                  const tgt = flow.targets.find((t) => t.ag.agId === r.agId);
                  show(
                    e,
                    <>
                      <strong>{src?.label}</strong> ({src?.zone}) → <strong>{tgt?.ag.name}</strong>
                      <br />
                      {r.value.toLocaleString(undefined, { maximumFractionDigits: 1 })} of {src?.oneAgents.length} OneAgents (load-balanced over {src?.plan?.target?.available.length} ActiveGates)
                      <br />
                      Group {r.prio}: {PRIORITY_LABEL[r.prio]}
                    </>,
                  );
                }}
                onClick={() => onSelect({ kind: "target", id: r.agId })}
                style={{ cursor: "pointer" }}
              />
              {on && r.w >= 2 && <path className="cf-flow" d={mid(r.y0, r.y1, r.w)} fill="none" stroke={color} strokeWidth={Math.min(2, r.w / 2)} strokeDasharray="3 9" pointerEvents="none" />}
            </g>
          );
        })}
        {/* Sources */}
        {layout.sources.map((s) => {
          const dropped = !s.plan?.target;
          const sel = selection?.kind === "source" && selection.id === s.id;
          const hit = matches.has(s.id);
          return (
            <g
              key={s.id}
              style={{ cursor: "pointer" }}
              onClick={() => onSelect(sel ? null : { kind: "source", id: s.id })}
              onMouseEnter={() => setHover({ kind: "source", id: s.id })}
              onMouseLeave={() => setHover(null)}
              onMouseMove={(e) =>
                show(
                  e,
                  <>
                    <strong>{s.label}</strong> in zone {s.zone}
                    <br />
                    {s.oneAgents.length} OneAgents ·{" "}
                    {dropped ? <span style={{ color: STATUS_PALETTE.critical }}>traffic dropped (no ActiveGate the fallback allows)</span> : `group ${s.plan!.target!.prio} (${PRIORITY_LABEL[s.plan!.target!.prio]}), ${s.plan!.target!.available.length} ActiveGates`}
                    <br />
                    <span style={{ opacity: 0.75 }}>Click to list these OneAgents</span>
                  </>,
                )
              }
            >
              <rect x={LEFT_X} y={s.y} width={NODE_W} height={s.h} rx={3} fill={dropped ? "none" : neutral} stroke={dropped ? STATUS_PALETTE.critical : hit || sel ? routing : "none"} strokeWidth={dropped || hit || sel ? 2 : 0} />
              <text x={LEFT_X - 8} y={s.y + Math.min(s.h / 2, 14) + 4} fontSize={11.5} fontWeight={sel || hit ? 700 : 600} textAnchor="end" fill="currentColor">
                {clip(s.label, 28)} <tspan opacity={0.7}>{s.oneAgents.length}</tspan>
              </text>
              <text x={LEFT_X - 8} y={s.y + Math.min(s.h / 2, 14) + 17} fontSize={10} textAnchor="end" fill={dropped ? STATUS_PALETTE.critical : "currentColor"} opacity={dropped ? 1 : 0.65}>
                {dropped ? `✕ dropped · zone ${clip(s.zone, 16)}` : `zone ${clip(s.zone, 22)}`}
              </text>
            </g>
          );
        })}
        {/* Targets */}
        {layout.targets.map((t) => {
          const sel = selection?.kind === "target" && selection.id === t.ag.agId;
          const routed = pct(t.expected, flow.totalOneAgents);
          const measured = pct(t.measured, flow.totalMeasured);
          const routes = routesOneAgents(t.ag);
          const bx = RIGHT_X + NODE_W + 12;
          const scale = barMax / layout.maxPct;
          return (
            <g
              key={t.ag.agId}
              data-ag={t.ag.agId}
              style={{ cursor: "pointer" }}
              onClick={() => onSelect(sel ? null : { kind: "target", id: t.ag.agId })}
              onMouseEnter={() => setHover({ kind: "target", id: t.ag.agId })}
              onMouseLeave={() => setHover(null)}
              onMouseMove={(e) =>
                show(
                  e,
                  <>
                    <strong>{t.ag.name}</strong> · zone {t.ag.networkZone || DEFAULT_ZONE}
                    <br />
                    Routed: {t.expected.toLocaleString(undefined, { maximumFractionDigits: 1 })} OneAgents ({routed}%)
                    <br />
                    Measured: {Math.round(t.measured)} connected OneAgent modules ({measured}%)
                    {!routes && (
                      <>
                        <br />
                        No OneAgent routing: the modules are other agents (for example z/OS on a zRemote)
                      </>
                    )}
                    <br />
                    <span style={{ opacity: 0.75 }}>Click to list the OneAgents routed here</span>
                  </>,
                )
              }
            >
              <rect x={RIGHT_X} y={t.y} width={NODE_W} height={t.h} rx={3} fill={routes ? routing : neutral} opacity={t.ag.online ? 1 : 0.45} stroke={sel ? Colors.Text.Neutral.Default : !t.ag.online ? STATUS_PALETTE.critical : "none"} strokeWidth={sel || !t.ag.online ? 2 : 0} />
              <text x={bx} y={t.y + 13} fontSize={11.5} fontWeight={sel ? 700 : 600} fill="currentColor">
                {clip(t.ag.name, 34)}
                {!t.ag.online ? " (not connected)" : ""}
              </text>
              <rect x={bx} y={t.y + 20} width={Math.max(1, routed * scale)} height={7} rx={3.5} fill={routing} />
              <text x={bx + Math.max(1, routed * scale) + 6} y={t.y + 27} fontSize={9.5} fill="currentColor" opacity={0.8}>
                routed {routed}%
              </text>
              <rect x={bx} y={t.y + 32} width={Math.max(1, measured * scale)} height={7} rx={3.5} fill={neutral} />
              <text x={bx + Math.max(1, measured * scale) + 6} y={t.y + 39} fontSize={9.5} fill="currentColor" opacity={0.8}>
                measured {measured}% ({Math.round(t.measured)})
              </text>
            </g>
          );
        })}
      </svg>
      {tip}
      <Flex gap={16} flexWrap="wrap" alignItems="center" style={{ marginTop: 6 }}>
        {[1, 2, 3, 4].map((p) => (
          <Flex key={p} gap={6} alignItems="center">
            <span style={{ width: 14, height: 8, borderRadius: 2, background: prioColor(p, theme), opacity: 0.7 }} />
            <Text style={{ fontSize: 12 }}>
              Group {p}: {PRIORITY_LABEL[p]}
            </Text>
          </Flex>
        ))}
        <Flex gap={6} alignItems="center">
          <span style={{ width: 14, height: 7, borderRadius: 3.5, background: routing }} />
          <Text style={{ fontSize: 12 }}>Routed share of OneAgents</Text>
        </Flex>
        <Flex gap={6} alignItems="center">
          <span style={{ width: 14, height: 7, borderRadius: 3.5, background: neutral }} />
          <Text style={{ fontSize: 12 }}>Measured share of connected OneAgent modules</Text>
        </Flex>
      </Flex>
    </div>
  );
}
