import React, { useMemo, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import Colors from "@dynatrace/strato-design-tokens/colors";
import Spacings from "@dynatrace/strato-design-tokens/spacings";
import Borders from "@dynatrace/strato-design-tokens/borders";
import { useDql } from "../useDql";
import { oneAgentModesQuery, type Timeframe } from "../queries";
import { GAUGE_SIZE, QueryActions, QueryState, formatMode, num } from "../components";

// One stable color per monitoring mode so the same mode looks the same everywhere.
const MODE_COLORS: Record<string, string> = {
  "Full Stack": "#4589FF",
  Infrastructure: "#A56EFF",
  Discovery: "#2DB7A3",
  Unknown: "#8D8D8D",
};
const FALLBACK = ["#FF832B", "#EE5396", "#D2A106", "#33B1FF"];
const colorFor = (label: string, i: number) => MODE_COLORS[label] ?? FALLBACK[i % FALLBACK.length];

/** `id` is the raw value a click selects; slices without one are not clickable. */
export type Slice = { label: string; value: number; color: string; id?: string };

/**
 * Custom SVG donut: every slice is its own segment (nothing is merged into "Other"), the centre shows the total
 * or the hovered slice, and the legend lists count and share per slice.
 */
export function Donut({
  slices,
  size = 180,
  centerLabel = "OneAgents",
  ariaLabel = "OneAgents by monitoring mode",
  selectedId,
  onSelect,
  compact = false,
  legendRight = false,
}: {
  slices: Slice[];
  size?: number;
  centerLabel?: string;
  ariaLabel?: string;
  /** Legend below the donut with smaller text, for narrow cards. */
  compact?: boolean;
  /** Compact only: legend to the right of the donut (default is left). */
  legendRight?: boolean;
  /** Slice id that is currently selected (click again to clear). */
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
}) {
  const [hover, setActive] = useState<number | null>(null);
  const selIdx = selectedId != null ? slices.findIndex((s) => s.id === selectedId) : -1;
  const active = hover ?? (selIdx >= 0 ? selIdx : null);
  const click = (s: Slice) => {
    if (onSelect && s.id !== undefined) onSelect(s.id === selectedId ? null : s.id);
  };
  const total = slices.reduce((s, x) => s + x.value, 0);
  const stroke = 30;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const gap = slices.length > 1 ? 3 : 0; // px gap between segments
  let offset = 0;
  const arcs = slices.map((s) => {
    const len = (s.value / total) * c;
    const arc = { dash: Math.max(len - gap, 0.5), offset };
    offset += len;
    return arc;
  });
  const shown = active !== null ? slices[active] : null;
  return (
    <Flex gap={compact ? 12 : 24} alignItems="center" flexWrap={compact ? "nowrap" : "wrap"} flexDirection={compact && !legendRight ? "row-reverse" : "row"} justifyContent={compact && !legendRight ? "flex-end" : undefined}>
      <svg style={{ flex: "none" }} width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${ariaLabel}: ${slices.map((s) => `${s.label} ${s.value}`).join(", ")}`}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {slices.map((s, i) => (
            <circle
              key={s.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={active === i ? stroke + 6 : stroke}
              strokeDasharray={`${arcs[i].dash} ${c - arcs[i].dash}`}
              strokeDashoffset={-arcs[i].offset}
              style={{ transition: "stroke-width 120ms ease", opacity: active === null || active === i ? 1 : 0.45, cursor: onSelect && s.id !== undefined ? "pointer" : "default" }}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onClick={() => click(s)}
            >
              <title>{`${s.label}: ${s.value.toLocaleString()} (${Math.round((s.value / total) * 100)}%)`}</title>
            </circle>
          ))}
        </g>
        <text x="50%" y="46%" textAnchor="middle" fontSize="26" fontWeight="700" fill="currentColor">
          {(shown ? shown.value : total).toLocaleString()}
        </text>
        <text x="50%" y="60%" textAnchor="middle" fontSize="11" fill="currentColor" opacity="0.7">
          {shown ? shown.label : centerLabel}
        </text>
      </svg>
      <Flex flexDirection="column" gap={compact ? 4 : 6} style={compact ? { fontSize: 11, minWidth: 0, flex: "1 1 auto" } : undefined}>
        {slices.map((s, i) => (
          <Flex
            key={s.label}
            alignItems="center"
            gap={8}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            onClick={() => click(s)}
            style={{ opacity: active === null || active === i ? 1 : 0.5, cursor: onSelect && s.id !== undefined ? "pointer" : "default" }}
          >
            <span style={{ width: compact ? 9 : 12, height: compact ? 9 : 12, borderRadius: 2, background: s.color, display: "inline-block", flex: "none" }} />
            <Text style={{ minWidth: compact ? 0 : 120, fontSize: compact ? 11 : undefined, fontWeight: selIdx === i ? 700 : undefined }}>{s.label}</Text>
            <Text style={{ fontSize: compact ? 11 : undefined, fontWeight: 700 }}>{s.value.toLocaleString()}</Text>
            <Text style={{ fontSize: compact ? 11 : undefined, opacity: 0.7 }}>{Math.round((s.value / total) * 100)}%</Text>
          </Flex>
        ))}
      </Flex>
    </Flex>
  );
}

/** OneAgents by monitoring mode (Full Stack, Infrastructure, Discovery, Unknown) as a custom donut chart. */
export function MonitoringModePie({
  tf,
  size = GAUGE_SIZE,
  selectedId,
  onSelect,
  compact = false,
}: {
  tf: Timeframe;
  compact?: boolean;
  size?: number;
  selectedId?: string | null;
  onSelect?: (mode: string | null) => void;
}) {
  const query = oneAgentModesQuery(tf);
  const state = useDql(query);
  const slices = useMemo<Slice[]>(
    () =>
      (state.data?.records ?? [])
        .map((r) => ({ label: formatMode(r.mode), value: num(r.agents), id: r.mode ? String(r.mode) : undefined }))
        .filter((s) => s.value > 0)
        .map((s, i) => ({ ...s, color: colorFor(s.label, i) })),
    [state.data],
  );
  return (
    <div
      style={{
        flex: compact ? "1 1 0" : undefined,
        minWidth: 0,
        padding: Spacings.Size16,
        borderRadius: Borders.Radius.Container.Default,
        background: Colors.Background.Container.Neutral.Default,
      }}
    >
      <Heading level={4}>OneAgents by monitoring mode</Heading>
      <QueryState state={state}>
        <div style={{ marginTop: Spacings.Size8 }}>
          {slices.length === 0 ? <Text>No OneAgents found in this timeframe.</Text> : <Donut slices={slices} size={size} selectedId={selectedId} onSelect={onSelect} compact={compact} />}
        </div>
      </QueryState>
      <div style={{ marginTop: Spacings.Size8 }}>
        <QueryActions title="OneAgents by monitoring mode" query={query} />
      </div>
    </div>
  );
}
