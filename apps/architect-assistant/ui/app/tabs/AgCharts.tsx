import React, { useMemo, useRef, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import Colors from "@dynatrace/strato-design-tokens/colors";
import BoxShadows from "@dynatrace/strato-design-tokens/box-shadows";
import { MODULE_STATE_LABEL, type ActiveGate, type ModuleDef, type ModuleState } from "../activeGates";

// ---------------------------------------------------------------------------
// Custom charts for the ActiveGates tab (no Strato charts): module matrix, bar lists, a stacked bar and small-multiple
// line charts. Status colours are the dataviz status palette (good / warning / serious / critical, never reused for
// series) and always come with a glyph and a label; single-series magnitude uses one categorical hue.
// ---------------------------------------------------------------------------

export const STATUS_PALETTE = { good: "#0ca30c", warning: "#fab219", serious: "#ec835a", critical: "#d03b3b", neutral: "#898781" };
/** Categorical slot 1 (blue) of the validated palette, light / dark. */
export const SERIES_BLUE = { light: "#2a78d6", dark: "#3987e5" };

const STATE_STYLE: Record<ModuleState, { color: string; glyph: string; ink: string }> = {
  active: { color: STATUS_PALETTE.good, glyph: "✓", ink: "#ffffff" },
  issue: { color: STATUS_PALETTE.critical, glyph: "!", ink: "#ffffff" },
  idle: { color: STATUS_PALETTE.warning, glyph: "–", ink: "#1a1a19" },
  on: { color: STATUS_PALETTE.neutral, glyph: "•", ink: "#ffffff" },
  off: { color: "transparent", glyph: "", ink: "inherit" },
};
export const STATE_ORDER: ModuleState[] = ["active", "issue", "idle", "on", "off"];

const hint: React.CSSProperties = { fontSize: 12, opacity: 0.7 };

// --- Hover tooltip ------------------------------------------------------------------------------
type Tip = { x: number; y: number; content: React.ReactNode } | null;

/** One floating tooltip per chart, positioned relative to the chart container (also used by the Databases tab). */
export function useTip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip>(null);
  const show = (e: React.MouseEvent, content: React.ReactNode) => {
    const box = ref.current?.getBoundingClientRect();
    if (box) setTip({ x: e.clientX - box.left, y: e.clientY - box.top, content });
  };
  const hide = () => setTip(null);
  const node = tip ? (
    <div
      role="tooltip"
      style={{
        position: "absolute",
        left: Math.min(tip.x + 14, (ref.current?.clientWidth ?? 9999) - 260),
        top: tip.y + 14,
        maxWidth: 320,
        pointerEvents: "none",
        zIndex: 20,
        padding: "6px 10px",
        borderRadius: 6,
        background: Colors.Background.Surface.Default,
        boxShadow: BoxShadows.Surface.Raised.Rest,
        fontSize: 12,
        lineHeight: 1.4,
      }}
    >
      {tip.content}
    </div>
  ) : null;
  return { ref, show, hide, node };
}

// --- Module matrix -------------------------------------------------------------------------------
export function StateSwatch({ state, size = 14 }: { state: ModuleState; size?: number }) {
  const s = STATE_STYLE[state];
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: 4,
        flex: "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.round(size * 0.72),
        fontWeight: 700,
        lineHeight: 1,
        color: s.ink,
        background: s.color,
        border: state === "off" ? "1px dashed rgba(128,128,128,0.45)" : "none",
        boxSizing: "border-box",
      }}
    >
      {s.glyph}
    </span>
  );
}

export function StateLegend({ counts }: { counts: Record<ModuleState, number> }) {
  return (
    <Flex gap={16} flexWrap="wrap" alignItems="center">
      {STATE_ORDER.map((s) => (
        <Flex key={s} gap={6} alignItems="center">
          <StateSwatch state={s} />
          <Text style={{ fontSize: 12 }}>
            {MODULE_STATE_LABEL[s]} <span style={{ opacity: 0.7 }}>({counts[s].toLocaleString()})</span>
          </Text>
        </Flex>
      ))}
    </Flex>
  );
}

const CELL = 24;
const COL_W = CELL + 8;
const GROUP_SHORT: Record<string, string> = { "Routing & ingest": "Ingest", "Cloud & platform": "Cloud", "Extensions & databases": "Ext. & DB", "Synthetic & mainframe": "Synth.", Operations: "Ops" };

/** Text width in px with the page font (canvas), so headers are sized to their labels instead of clipping. */
const widthCache = new Map<string, number>();
let measureCtx: CanvasRenderingContext2D | null | undefined;
function textWidth(text: string, font: string): number {
  const key = `${font}|${text}`;
  const hit = widthCache.get(key);
  if (hit !== undefined) return hit;
  if (measureCtx === undefined) measureCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  let w = text.length * 6.6;
  if (measureCtx) {
    const family = typeof document !== "undefined" ? getComputedStyle(document.body).fontFamily || "sans-serif" : "sans-serif";
    measureCtx.font = `${font} ${family}`;
    w = measureCtx.measureText(text).width;
  }
  widthCache.set(key, w);
  return w;
}
const LABEL_FONT = "400 11px";
const GROUP_FONT = "600 11px";

/** Full group name on one line, else on two lines (split at " & "), else the short form. */
function groupLabel(group: string, span: number): { text: string; wrap: boolean } {
  const room = span * COL_W - 8;
  if (textWidth(group, GROUP_FONT) <= room) return { text: group, wrap: false };
  const parts = group.split(" & ");
  if (parts.length === 2 && Math.max(textWidth(`${parts[0]} &`, GROUP_FONT), textWidth(parts[1], GROUP_FONT)) <= room) return { text: group, wrap: true };
  return { text: GROUP_SHORT[group] ?? group.slice(0, 3), wrap: false };
}

/**
 * Rows = ActiveGates, columns = modules (grouped). Each cell is the module's state on that ActiveGate. Clicking a row
 * name or a cell selects the ActiveGate.
 */
export function ModuleMatrix({
  ags,
  modules,
  stateOf,
  sublabel,
  selectedId,
  onSelect,
}: {
  ags: ActiveGate[];
  modules: ModuleDef[];
  stateOf: (ag: ActiveGate, m: ModuleDef) => { state: ModuleState; text: string };
  sublabel: (ag: ActiveGate) => string;
  selectedId?: string;
  onSelect: (ag: ActiveGate) => void;
}) {
  const { ref, show, hide, node } = useTip();
  const groups = useMemo(() => {
    const out: { group: string; span: number }[] = [];
    for (const m of modules) {
      const last = out[out.length - 1];
      if (last && last.group === m.group) last.span++;
      else out.push({ group: m.group, span: 1 });
    }
    return out;
  }, [modules]);
  const columns = `minmax(200px, 280px) repeat(${modules.length}, ${COL_W}px)`;
  const headerHeight = Math.ceil(Math.max(40, ...modules.map((m) => textWidth(m.label, LABEL_FONT)))) + 10;
  const footer = useMemo(
    () =>
      modules.map((m) => {
        let used = 0;
        let enabled = 0;
        for (const ag of ags) {
          const s = stateOf(ag, m).state;
          if (s !== "off") enabled++;
          if (s === "active" || s === "issue") used++;
        }
        return { used, enabled };
      }),
    [ags, modules, stateOf],
  );
  return (
    <div ref={ref} style={{ position: "relative", overflowX: "auto" }} onMouseLeave={hide}>
      <div style={{ display: "grid", gridTemplateColumns: columns, columnGap: 0, rowGap: 2, alignItems: "center", minWidth: "max-content" }}>
        {/* group header */}
        <div />
        {groups.map((g, i) => {
          const label = groupLabel(g.group, g.span);
          return (
            <div key={`${g.group}-${i}`} title={g.group} style={{ gridColumn: `span ${g.span}`, alignSelf: "end", borderBottom: "2px solid rgba(128,128,128,0.35)", margin: "0 3px", paddingBottom: 3 }}>
              <Text style={{ fontSize: 11, fontWeight: 600, opacity: 0.8, display: "block", lineHeight: 1.2, whiteSpace: label.wrap ? "normal" : "nowrap", textAlign: "center" }}>{label.text}</Text>
            </div>
          );
        })}
        {/* module header: vertical labels, as tall as the longest label */}
        <div />
        {modules.map((m) => (
          <div key={m.id} title={`${m.label}: ${m.detail}`} style={{ height: headerHeight, display: "flex", alignItems: "flex-end", justifyContent: "center", paddingTop: 6, paddingBottom: 4, overflow: "hidden" }}>
            <span style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", fontSize: 11, lineHeight: 1, whiteSpace: "nowrap" }}>{m.label}</span>
          </div>
        ))}
        {/* rows */}
        {ags.map((ag) => {
          const sel = ag.id === selectedId;
          return (
            <React.Fragment key={ag.id}>
              <button
                type="button"
                onClick={() => onSelect(ag)}
                title={`Diagnose ${ag.name}`}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  padding: "2px 8px",
                  borderRadius: 4,
                  background: sel ? "rgba(69,137,255,0.16)" : undefined,
                  minWidth: 0,
                }}
              >
                <Text style={{ display: "block", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {!ag.online && <span style={{ color: STATUS_PALETTE.critical }}>● </span>}
                  {ag.name}
                </Text>
                <Text style={{ display: "block", fontSize: 11, opacity: 0.65, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sublabel(ag)}</Text>
              </button>
              {modules.map((m) => {
                const s = stateOf(ag, m);
                const tip = (
                  <>
                    <strong>{m.label}</strong> on {ag.name}
                    <br />
                    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <StateSwatch state={s.state} size={12} /> {MODULE_STATE_LABEL[s.state]}
                    </span>
                    {s.state !== "off" && (
                      <>
                        <br />
                        <span style={{ opacity: 0.8 }}>{s.text}</span>
                      </>
                    )}
                  </>
                );
                return (
                  <div
                    key={m.id}
                    onMouseMove={(e) => show(e, tip)}
                    onClick={() => onSelect(ag)}
                    style={{ display: "flex", justifyContent: "center", cursor: "pointer", background: sel ? "rgba(69,137,255,0.08)" : undefined, padding: "3px 0" }}
                  >
                    <StateSwatch state={s.state} size={CELL} />
                  </div>
                );
              })}
            </React.Fragment>
          );
        })}
        {/* footer: in use / enabled */}
        <Text style={{ ...hint, padding: "4px 8px" }}>In use / enabled</Text>
        {footer.map((f, i) => (
          <span key={modules[i].id} title={`${modules[i].label}: in use on ${f.used} of ${f.enabled} ActiveGates where it is enabled`} style={{ fontSize: 10, textAlign: "center", opacity: 0.75, paddingTop: 4 }}>
            {f.used}/{f.enabled}
          </span>
        ))}
      </div>
      {node}
    </div>
  );
}

// --- Bar list (one measure per chart; small multiples side by side) ----------------------------------
export type BarRow = { id: string; label: string; value: number; sub?: string };

export function BarList({ rows, color, unit, empty, onSelect }: { rows: BarRow[]; color: string; unit: string; empty: string; onSelect?: (id: string) => void }) {
  const { ref, show, hide, node } = useTip();
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) {
    return (
      <Flex gap={6} alignItems="center" style={{ padding: "8px 0" }}>
        <span style={{ color: STATUS_PALETTE.good, fontWeight: 700 }}>✓</span>
        <Text style={{ fontSize: 12 }}>{empty}</Text>
      </Flex>
    );
  }
  return (
    <div ref={ref} style={{ position: "relative" }} onMouseLeave={hide}>
      <Flex flexDirection="column" gap={6}>
        {rows.map((r) => (
          <div
            key={r.id}
            onMouseMove={(e) => show(e, <><strong>{r.label}</strong><br />{r.value.toLocaleString()} {unit}{r.sub ? <><br /><span style={{ opacity: 0.8 }}>{r.sub}</span></> : null}</>)}
            onClick={() => onSelect?.(r.id)}
            style={{ cursor: onSelect ? "pointer" : "default", padding: "2px 0" }}
          >
            <Flex justifyContent="space-between" gap={8}>
              <Text style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{r.label}</Text>
              <Text style={{ fontSize: 12, fontWeight: 700, flex: "none" }}>{r.value.toLocaleString()}</Text>
            </Flex>
            <div style={{ height: 8, borderRadius: 4, background: "rgba(128,128,128,0.14)", marginTop: 2 }}>
              <div style={{ width: `${Math.max(2, (100 * r.value) / max)}%`, height: 8, borderRadius: 4, background: color }} />
            </div>
          </div>
        ))}
      </Flex>
      {node}
    </div>
  );
}

// --- Stacked bar (parts of one total) ---------------------------------------------------------------
export type Segment = { label: string; value: number; color: string };

export function StackedBar({ segments, unit }: { segments: Segment[]; unit: string }) {
  const { ref, show, hide, node } = useTip();
  const parts = segments.filter((s) => s.value > 0);
  const total = parts.reduce((s, x) => s + x.value, 0);
  if (total === 0) return null;
  const share = (v: number) => (v / total) * 100;
  const fmt = (v: number) => (share(v) < 0.1 ? "<0.1" : share(v).toFixed(share(v) < 10 ? 1 : 0));
  return (
    <div ref={ref} style={{ position: "relative" }} onMouseLeave={hide}>
      <div style={{ display: "flex", gap: 2, height: 14, borderRadius: 4, overflow: "hidden" }} role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(", ")}>
        {parts.map((p) => (
          <div key={p.label} onMouseMove={(e) => show(e, <><strong>{p.label}</strong><br />{p.value.toLocaleString()} {unit} ({fmt(p.value)}%)</>)} style={{ flex: `${Math.max(share(p.value), 0.6)} 0 0`, background: p.color }} />
        ))}
      </div>
      <Flex gap={16} flexWrap="wrap" style={{ marginTop: 6 }}>
        {parts.map((p) => (
          <Flex key={p.label} gap={6} alignItems="center">
            <span style={{ width: 10, height: 10, borderRadius: 2, background: p.color, flex: "none" }} />
            <Text style={{ fontSize: 12 }}>
              {p.label} <strong>{p.value.toLocaleString()}</strong> <span style={{ opacity: 0.7 }}>{fmt(p.value)}%</span>
            </Text>
          </Flex>
        ))}
      </Flex>
      {node}
    </div>
  );
}

// --- Line chart (one series; small multiples) ----------------------------------------------------------
const W = 320;
const H = 96;
const PAD = { l: 4, r: 4, t: 8, b: 4 };

export function LineMini({
  title,
  values,
  startMs,
  stepMs,
  color,
  unit,
  maxHint,
}: {
  title: string;
  values: (number | null)[];
  startMs: number;
  stepMs: number;
  color: string;
  unit: string;
  /** Fixed top of the y scale (100 for percentages); otherwise the series maximum. */
  maxHint?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const max = maxHint ?? Math.max(1, ...finite);
  const x = (i: number) => PAD.l + ((W - PAD.l - PAD.r) * i) / Math.max(1, values.length - 1);
  const y = (v: number) => H - PAD.b - ((H - PAD.t - PAD.b) * Math.min(v, max)) / max;
  // Gaps (null buckets) break the line instead of being drawn as zero.
  let path = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      pen = false;
      return;
    }
    path += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  });
  const time = (i: number) => new Date(startMs + i * stepMs).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const peak = finite.length ? Math.max(...finite) : null;
  const move = (e: React.MouseEvent) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box || values.length === 0) return;
    const i = Math.round(((e.clientX - box.left) / box.width) * (values.length - 1));
    setHover(Math.max(0, Math.min(values.length - 1, i)));
  };
  const hv = hover !== null ? values[hover] : null;
  const fmt = (v: number | null) => (v === null || !Number.isFinite(v) ? "no data" : `${Math.round(v * 10) / 10} ${unit}`.trim());
  return (
    <div>
      <Flex justifyContent="space-between" alignItems="baseline" gap={8}>
        <Text style={{ fontSize: 12, fontWeight: 600 }}>{title}</Text>
        <Text style={hint}>{hover !== null ? `${time(hover)}: ${fmt(hv)}` : `peak ${fmt(peak)}`}</Text>
      </Flex>
      <div ref={boxRef} style={{ position: "relative", marginTop: 4 }} onMouseMove={move} onMouseLeave={() => setHover(null)}>
        <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${title}: peak ${fmt(peak)}`}>
          <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="rgba(128,128,128,0.35)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t} y2={PAD.t} stroke="rgba(128,128,128,0.15)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          {path && <path d={path} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="rgba(128,128,128,0.6)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
        </svg>
        {hover !== null && hv !== null && Number.isFinite(hv) && (
          <span
            aria-hidden
            style={{ position: "absolute", left: `calc(${(100 * x(hover)) / W}% - 5px)`, top: y(hv) - 5, width: 10, height: 10, borderRadius: 5, background: color, border: `2px solid ${Colors.Background.Surface.Default}`, boxSizing: "border-box", pointerEvents: "none" }}
          />
        )}
        <Text style={{ ...hint, position: "absolute", top: -2, left: 6, fontSize: 10 }}>{fmt(max)}</Text>
      </div>
      <Flex justifyContent="space-between">
        <Text style={{ ...hint, fontSize: 10 }}>{values.length ? time(0) : ""}</Text>
        <Text style={{ ...hint, fontSize: 10 }}>{values.length ? time(values.length - 1) : ""}</Text>
      </Flex>
    </div>
  );
}
