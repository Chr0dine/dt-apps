import React, { useCallback, useMemo, useRef, useState } from "react";
import { useCurrentTheme } from "@dynatrace/strato-components/core";
import Colors from "@dynatrace/strato-design-tokens/colors";

// Custom preview of a translated query's result (no Strato charts, per workspace convention):
//  - time series (timeframe + interval + numeric arrays) -> multi-line chart with crosshair tooltip
//  - one numeric value per row with a label            -> horizontal bar list with hover values
//  - a single numeric value                             -> hero number
//  - anything else                                      -> compact table
// Categorical colors: the dataviz reference palette (validated light / dark steps), assigned in fixed order.

const PALETTE = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};
const MAX_SERIES = 8;

type Rec = Record<string, unknown>;
const isNumArr = (v: unknown): v is (number | null)[] => Array.isArray(v) && v.length > 0 && v.every((x) => x === null || typeof x === "number");
const isNum = (v: unknown) => typeof v === "number" || (typeof v === "string" && v !== "" && isFinite(Number(v)) && /^-?[0-9.e+-]+$/i.test(v));
const fmtNum = (n: number) => {
  if (!isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}G`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  if (Number.isInteger(n)) return String(n);
  if (a >= 100) return n.toFixed(0);
  if (a >= 1) return n.toFixed(2);
  return n.toPrecision(3);
};
const labelOf = (r: Rec, skip: Set<string>) => {
  const parts = Object.entries(r)
    .filter(([k, v]) => !skip.has(k) && (typeof v === "string" || (Array.isArray(v) && v.every((x) => typeof x === "string"))) && k !== "interval")
    .sort(([a], [b]) => (b.endsWith(".name") ? 1 : 0) - (a.endsWith(".name") ? 1 : 0));
  // prefer entity names over IDs
  const named = parts.filter(([k]) => k.endsWith(".name"));
  const use = named.length ? named : parts.filter(([, v]) => !/^[A-Z_]+-[0-9A-F]{16}$/.test(String(v)));
  return (use.length ? use : parts).map(([, v]) => (Array.isArray(v) ? v.join(", ") : String(v))).join(" · ") || "series";
};

export function PreviewChart({ records, visualization }: { records: Rec[]; visualization?: string }) {
  const theme = useCurrentTheme();
  const colors = theme === "dark" ? PALETTE.dark : PALETTE.light;
  const shape = useMemo(() => {
    if (!records.length) return { kind: "empty" as const };
    const r0 = records[0];
    const tf = r0.timeframe as { start?: string; end?: string } | undefined;
    const arrFields = Object.keys(r0).filter((k) => isNumArr(r0[k]));
    if (tf?.start && r0.interval && arrFields.length) return { kind: "ts" as const, arrFields };
    const numFields = Object.keys(r0).filter((k) => isNum(r0[k]) && !isNumArr(r0[k]));
    if (records.length === 1 && numFields.length === 1 && (visualization === "singleValue" || Object.keys(r0).length === 1)) return { kind: "single" as const, field: numFields[0] };
    if (numFields.length >= 1 && visualization !== "table") return { kind: "bars" as const, field: numFields[0] };
    return { kind: "table" as const };
  }, [records, visualization]);

  if (shape.kind === "empty") return <div style={{ padding: 16, fontSize: 12, opacity: 0.65 }}>The query ran but returned no records for the last 2 hours.</div>;
  if (shape.kind === "single") return <HeroNumber value={Number(records[0][shape.field])} label={shape.field} />;
  if (shape.kind === "ts") return <LineChart records={records} fields={shape.arrFields} colors={colors} area={visualization === "areaChart"} />;
  if (shape.kind === "bars") return <BarList records={records} field={shape.field} colors={colors} />;
  return <MiniTable records={records} />;
}

const HeroNumber: React.FC<{ value: number; label: string }> = ({ value, label }) => (
  <div style={{ padding: "12px 4px" }}>
    <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>{fmtNum(value)}</div>
    <div style={{ fontSize: 12, color: Colors.Text.Neutral.Subdued, marginTop: 4 }}>{label}</div>
  </div>
);

// ---------------------------------------------------------------------------------------------------------------------
/** Container width in px, so the SVG draws at 1:1 and axis text keeps its size. */
function useWidth(): [React.RefCallback<HTMLDivElement>, number] {
  const [w, setW] = useState(760);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect();
    if (!el) return;
    setW(el.clientWidth || 760);
    ro.current = new ResizeObserver((entries) => setW(Math.max(320, Math.round(entries[0].contentRect.width))));
    ro.current.observe(el);
  }, []);
  return [ref, w];
}

function LineChart({ records, fields, colors, area }: { records: Rec[]; fields: string[]; colors: string[]; area: boolean }) {
  const [boxRef, W] = useWidth();
  const H = 220;
  const pad = { l: 52, r: 12, t: 10, b: 26 };
  const [hover, setHover] = useState<number | null>(null);

  const series = useMemo(() => {
    const out: { label: string; values: (number | null)[]; start: number; step: number }[] = [];
    for (const r of records) {
      const tf = r.timeframe as { start: string };
      const start = new Date(tf.start).getTime();
      const step = Number(r.interval) / 1e6;
      const skip = new Set([...fields, "timeframe", "interval"]);
      for (const f of fields) {
        const base = labelOf(r, skip);
        out.push({ label: fields.length > 1 ? (records.length > 1 ? `${base} · ${f}` : f) : base === "series" ? f : base, values: r[f] as (number | null)[], start, step });
      }
    }
    return out;
  }, [records, fields]);
  const shown = series.slice(0, MAX_SERIES);
  const hidden = series.length - shown.length;
  const all = shown.flatMap((s) => s.values.filter((v): v is number => v !== null && isFinite(v)));
  const max = all.length ? Math.max(...all) : 1;
  const min = Math.min(0, ...(all.length ? all : [0]));
  const n = Math.max(...shown.map((s) => s.values.length));
  const x = (i: number) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min || 1)) * (H - pad.t - pad.b);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + f * (max - min));
  const t0 = shown[0]?.start ?? 0;
  const step = shown[0]?.step ?? 60000;
  const timeLabel = (i: number) => new Date(t0 + i * step).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const path = (vals: (number | null)[]) => {
    let d = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (v === null || !isFinite(v)) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * (W - pad.l - pad.r);
    setHover(Math.max(0, Math.min(n - 1, Math.round((px / (W - pad.l - pad.r)) * (n - 1)))));
  };

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Preview chart of the translated query" style={{ display: "block" }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={0.1} />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill="currentColor" fillOpacity={0.6}>
              {fmtNum(t)}
            </text>
          </g>
        ))}
        {[0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i && v >= 0).map((i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize={10} fill="currentColor" fillOpacity={0.6}>
            {timeLabel(i)}
          </text>
        ))}
        {shown.map((s, si) => (
          <g key={si}>
            {area && shown.length === 1 && <path d={`${path(s.values)}L${x(s.values.length - 1)},${y(min)}L${x(0)},${y(min)}Z`} fill={colors[si]} fillOpacity={0.15} />}
            <path d={path(s.values)} fill="none" stroke={colors[si]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          </g>
        ))}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="currentColor" strokeOpacity={0.35} />
            {shown.map((s, si) => {
              const v = s.values[hover];
              return v === null || v === undefined ? null : <circle key={si} cx={x(hover)} cy={y(v)} r={4} fill={colors[si]} stroke={Colors.Background.Surface.Default} strokeWidth={2} />;
            })}
          </g>
        )}
        <rect x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={H - pad.t - pad.b} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </svg>
      {hover !== null && (
        <div
          style={{
            position: "absolute",
            top: 8,
            left: `${Math.min(70, (x(hover) / W) * 100 + 2)}%`,
            pointerEvents: "none",
            background: Colors.Background.Surface.Default,
            border: `1px solid ${Colors.Border.Neutral.Default}`,
            borderRadius: 6,
            padding: "6px 8px",
            fontSize: 11,
            boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
            maxWidth: 300,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{new Date(t0 + hover * step).toLocaleString()}</div>
          {shown.map((s, si) => (
            <div key={si} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: colors[si], flexShrink: 0 }} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
              <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{s.values[hover] === null ? "—" : fmtNum(Number(s.values[hover]))}</span>
            </div>
          ))}
        </div>
      )}
      {shown.length > 1 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginTop: 6, fontSize: 11 }}>
          {shown.map((s, si) => (
            <span key={si} style={{ display: "inline-flex", alignItems: "center", gap: 5, maxWidth: 260 }}>
              <span style={{ width: 10, height: 3, borderRadius: 2, background: colors[si], flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
            </span>
          ))}
          {hidden > 0 && <span style={{ opacity: 0.65 }}>+{hidden} more series not drawn</span>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
function BarList({ records, field, colors }: { records: Rec[]; field: string; colors: string[] }) {
  const rows = records.slice(0, 15).map((r) => ({ label: labelOf(r, new Set([field])), v: Number(r[field]) }));
  const max = Math.max(...rows.map((r) => (isFinite(r.v) ? Math.abs(r.v) : 0)), 1e-9);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "4px 0" }}>
      {rows.map((r, i) => (
        <div key={i} title={`${r.label}: ${fmtNum(r.v)}`} style={{ display: "grid", gridTemplateColumns: "minmax(120px, 34%) 1fr 64px", gap: 10, alignItems: "center", fontSize: 12 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
          <div style={{ height: 10, background: "rgba(128,128,128,0.12)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ width: `${Math.max(1, (Math.abs(r.v) / max) * 100)}%`, height: "100%", background: colors[0], borderRadius: 4 }} />
          </div>
          <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmtNum(r.v)}</span>
        </div>
      ))}
      {records.length > rows.length && <div style={{ fontSize: 11, opacity: 0.65 }}>Showing {rows.length} of {records.length} rows.</div>}
      <div style={{ fontSize: 11, opacity: 0.6 }}>Value: {field}</div>
    </div>
  );
}

function MiniTable({ records }: { records: Rec[] }) {
  const cols = [...new Set(records.slice(0, 20).flatMap((r) => Object.keys(r)))].slice(0, 8);
  const cell = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v).slice(0, 80) : String(v).slice(0, 120));
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c} style={{ textAlign: "left", padding: "4px 8px", borderBottom: `1px solid ${Colors.Border.Neutral.Default}`, whiteSpace: "nowrap", fontWeight: 600 }}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.slice(0, 10).map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c} style={{ padding: "4px 8px", borderBottom: "1px solid rgba(128,128,128,0.12)", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {cell(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {records.length > 10 && <div style={{ fontSize: 11, opacity: 0.65, marginTop: 4 }}>Showing 10 of {records.length} records.</div>}
    </div>
  );
}
