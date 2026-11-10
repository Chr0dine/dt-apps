import React, { useMemo, useState } from "react";
import { sendIntent } from "@dynatrace-sdk/navigation";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { MessageContainer } from "@dynatrace/strato-components/content";
import { Button } from "@dynatrace/strato-components/buttons";
import { InformationIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import Spacings from "@dynatrace/strato-design-tokens/spacings";
import Borders from "@dynatrace/strato-design-tokens/borders";
import { useDql, type DqlState } from "./useDql";

export const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** "FULL_STACK" -> "Full Stack", "INFRASTRUCTURE" -> "Infrastructure", "(unknown)" -> "Unknown". */
export function formatMode(raw: unknown): string {
  const s = String(raw ?? "").replace(/[()]/g, "").trim();
  if (!s) return "Unknown";
  return s
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export const pct = (part: number, total: number): number => (total > 0 ? Math.round((part / total) * 100) : 0);

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x: number) => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

/** Continuous red-to-green gradient: hue runs from 0 (red) at 0% to 125 (green) at 100%, passing through orange and yellow. */
export function statusColor(p: number): string {
  const v = Math.max(0, Math.min(100, p));
  return hslToHex(Math.round(v * 1.25), 78, 46);
}

// Custom SVG gauge geometry: a 240-degree arc, open at the bottom, measured clockwise from 12 o'clock.
const GAUGE_START = -120;
const GAUGE_SWEEP = 240;
const GAUGE_SEGMENTS = 80;

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
function arcPath(cx: number, cy: number, r: number, from: number, to: number) {
  const p0 = polar(cx, cy, r, from);
  const p1 = polar(cx, cy, r, to);
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

/**
 * Custom SVG gauge for any percentage-based metric. The filled arc is a true gradient along its length: the colour at
 * each point depends on its position on the scale (0% red through yellow to 100% green), so a 58% gauge shows red
 * through yellow-green and stops there. `onInfo` adds a small (i) button in the top-right corner.
 */
export function PctGauge({
  pct: value,
  caption,
  detail,
  size = GAUGE_SIZE,
  onInfo,
  infoLabel = "Open remediation steps",
}: {
  pct: number;
  caption: string;
  detail?: string;
  size?: number;
  onInfo?: () => void;
  infoLabel?: string;
}) {
  const v = Math.max(0, Math.min(100, value));
  const stroke = Math.round(size * 0.09);
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = r + stroke / 2;
  const height = Math.round(cy + r * 0.5 + stroke / 2 + 2); // lowest point of the arc ends at +/-120 degrees
  const end = GAUGE_START + (GAUGE_SWEEP * v) / 100;
  const segments = useMemo(() => {
    const out: { d: string; color: string }[] = [];
    for (let i = 0; i < GAUGE_SEGMENTS; i++) {
      const a0 = GAUGE_START + (GAUGE_SWEEP * i) / GAUGE_SEGMENTS;
      if (a0 >= end) break;
      const a1 = Math.min(GAUGE_START + (GAUGE_SWEEP * (i + 1)) / GAUGE_SEGMENTS + 0.5, end); // slight overlap hides seams
      out.push({ d: arcPath(cx, cy, r, a0, a1), color: statusColor(((i + 0.5) / GAUGE_SEGMENTS) * 100) });
    }
    return out;
  }, [cx, cy, r, end]);
  const first = polar(cx, cy, r, GAUGE_START);
  const tip = polar(cx, cy, r, end);
  return (
    <div style={{ width: size, textAlign: "center", position: "relative" }}>
      {onInfo && (
        <span style={{ position: "absolute", top: 0, right: 0, zIndex: 1 }} title={infoLabel}>
          <Button variant="default" size="condensed" onClick={onInfo} aria-label={`${infoLabel}: ${caption}`}>
            <Button.Prefix>
              <InformationIcon />
            </Button.Prefix>
          </Button>
        </span>
      )}
      <svg width={size} height={height} viewBox={`0 0 ${size} ${height}`} role="img" aria-label={`${caption}: ${value}%${detail ? ` (${detail})` : ""}`}>
        <path d={arcPath(cx, cy, r, GAUGE_START, GAUGE_START + GAUGE_SWEEP)} fill="none" stroke="rgba(128,128,128,0.22)" strokeWidth={stroke} strokeLinecap="round" />
        {v > 0 && (
          <>
            {segments.map((sg, i) => (
              <path key={i} d={sg.d} fill="none" stroke={sg.color} strokeWidth={stroke} strokeLinecap="butt" />
            ))}
            <circle cx={first.x} cy={first.y} r={stroke / 2} fill={statusColor(0)} />
            <circle cx={tip.x} cy={tip.y} r={stroke / 2} fill={statusColor(v)} />
          </>
        )}
        <text x={cx} y={cy + size * 0.07} textAnchor="middle" fontSize={Math.round(size * 0.21)} fontWeight="700" fill="currentColor">
          {value}
          <tspan fontSize={Math.round(size * 0.11)} fontWeight="600" opacity="0.7"> %</tspan>
        </text>
      </svg>
      <Text style={{ display: "block", fontWeight: 600 }}>{caption}</Text>
      {detail && <Text style={{ display: "block", opacity: 0.7, fontSize: 12 }}>{detail}</Text>}
    </div>
  );
}

/** Default gauge width: 150px plus 25%. */
export const GAUGE_SIZE = 188;

/** Summary rows at the top of a tab (Entity Overview, Frontends): 25% smaller so every gauge fits on one row. */
export const SUMMARY_SCALE = 0.75;
export const SUMMARY_GAUGE_SIZE = Math.round(GAUGE_SIZE * SUMMARY_SCALE);
export const SUMMARY_OVERALL_SIZE = Math.round(238 * SUMMARY_SCALE);

export function ScoreTile({ title, value, subtitle, minWidth = 180 }: { title: string; value: string; subtitle?: string; minWidth?: number }) {
  return (
    <div
      style={{
        padding: Spacings.Size16,
        borderRadius: Borders.Radius.Container.Default,
        background: Colors.Background.Container.Neutral.Default,
        minWidth,
      }}
    >
      <Text style={{ display: "block" }}>{title}</Text>
      <Heading level={2}>{value}</Heading>
      {subtitle && <Text>{subtitle}</Text>}
    </div>
  );
}

/** Renders the loading/error states shared by every query-backed view. */
export function QueryState({ state, children }: { state: DqlState; children: React.ReactNode }) {
  if (state.error) {
    return (
      <MessageContainer variant="critical">
        <MessageContainer.Title>Query failed</MessageContainer.Title>
        <MessageContainer.Description>{state.error}</MessageContainer.Description>
      </MessageContainer>
    );
  }
  if (state.loading && !state.data) return <Text>Loading…</Text>;
  return <>{children}</>;
}

const actionBtn: React.CSSProperties = {
  background: "rgba(128,128,128,0.08)",
  color: "inherit",
  border: "1px solid rgba(128,128,128,0.3)",
  borderRadius: 6,
  padding: "3px 10px",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};

/** Primary action that opens an on-demand entity list; same Strato button everywhere. */
export function ShowEntitiesButton({ onClick, children = "Show entities" }: { onClick: () => void; children?: React.ReactNode }) {
  return (
    <Button variant="emphasized" onClick={onClick}>
      {children}
    </Button>
  );
}

/**
 * Exposes the DQL behind a section and lets the user copy it or open it in a
 * Notebook or Dashboard. Intent IDs were verified against the tenant with
 * `dtctl get intents --app dynatrace.notebooks|dynatrace.dashboards`.
 */
export function QueryActions({ title, query }: { title: string; query: string }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(query).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const openNotebook = () =>
    sendIntent({ "dt.query": query, title }, { recommendedAppId: "dynatrace.notebooks", recommendedIntentId: "view-query" });
  const openDashboard = () =>
    sendIntent({ "dt.query": query, title }, { recommendedAppId: "dynatrace.dashboards", recommendedIntentId: "add-to-dashboard" });
  return (
    <Flex flexDirection="column" gap={8}>
      <Flex gap={8} alignItems="center" flexWrap="wrap">
        <button type="button" style={actionBtn} onClick={() => setShow((v) => !v)} aria-expanded={show}>
          {show ? "Hide DQL" : "Show DQL"}
        </button>
        <button type="button" style={actionBtn} onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" style={actionBtn} onClick={openNotebook}>
          ↗ Open in Notebook
        </button>
        <button type="button" style={actionBtn} onClick={openDashboard}>
          ↗ Add to Dashboard
        </button>
      </Flex>
      {show && (
        <pre
          style={{
            margin: 0,
            padding: 12,
            borderRadius: 6,
            background: Colors.Background.Container.Neutral.Default,
            fontSize: 12,
            overflowX: "auto",
            whiteSpace: "pre-wrap",
          }}
        >
          {query}
        </pre>
      )}
    </Flex>
  );
}

type Row = Record<string, any>;

/** Table of non-compliant entities. Mounted only when a drill-down is opened, so its query runs on demand. */
export type DrillColumn = { id: string; header: string; /** Custom cell; receives the whole row. */ cell?: (row: Row) => React.ReactNode };

export function DrillDownTable({
  title,
  query,
  columns,
  emptyText = "No entities found.",
}: {
  title: string;
  query: string;
  columns: DrillColumn[];
  emptyText?: string;
}) {
  const state = useDql(query);
  const data = useMemo<Row[]>(() => state.data?.records ?? [], [state.data]);
  const cols = useMemo<DataTableColumnDef<Row>[]>(
    () =>
      columns.map((c) => ({
        id: c.id,
        header: c.header,
        accessor: c.id,
        ...(c.cell ? { cell: ({ rowData }: { rowData: Row }) => <>{c.cell!(rowData)}</> } : {}),
      })) as DataTableColumnDef<Row>[],
    [columns],
  );
  return (
    <QueryState state={state}>
      <QueryActions title={title} query={query} />
      <DataTable data={data} columns={cols} sortable fullWidth variant={{ rowDensity: "condensed" }}>
        <DataTable.EmptyState>{emptyText}</DataTable.EmptyState>
      </DataTable>
      {data.length >= 500 && <Text>Showing the first 500 entities.</Text>}
    </QueryState>
  );
}
