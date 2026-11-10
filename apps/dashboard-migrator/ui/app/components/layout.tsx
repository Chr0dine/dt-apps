import React from "react";

// ---------------------------------------------------------------------------
// SectionCard — consistent panel used inside every tab.
// ---------------------------------------------------------------------------
export const SectionCard: React.FC<{ title: string; subtitle?: string; children: React.ReactNode; actions?: React.ReactNode }> = ({ title, subtitle, children, actions }) => (
  <div style={{ margin: "12px 20px", padding: 16, background: "rgba(128,128,128,0.06)", border: "1px solid rgba(128,128,128,0.25)", borderRadius: 10 }}>
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 11, opacity: 0.65, marginTop: 2 }}>{subtitle}</div>}
      </div>
      {actions}
    </div>
    {children}
  </div>
);

// Fallback banner while data loads or is empty.
export const EmptyState: React.FC<{ loading?: boolean; error?: string | null; label?: string }> = ({ loading, error, label = "No data yet." }) => (
  <div style={{ padding: 20, textAlign: "center", opacity: 0.65, fontSize: 13 }}>
    {loading ? "Loading…" : error ? <span style={{ color: "#C21930" }}>Error: {error}</span> : label}
  </div>
);

// Fast formatters used throughout tabs.
export const fmt = {
  num: (n: number | undefined | null, digits = 0) => {
    if (n == null || !isFinite(n)) return "—";
    if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return n.toFixed(digits);
  },
  pct: (n: number | undefined | null, digits = 1) => (n == null || !isFinite(n) ? "—" : `${n.toFixed(digits)}%`),
  ms: (n: number | undefined | null) => (n == null || !isFinite(n) ? "—" : n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${n.toFixed(0)}ms`),
  bytes: (n: number | undefined | null) => {
    if (n == null || !isFinite(n)) return "—";
    if (n >= 1e9) return `${(n / 1e9).toFixed(2)}GB`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(2)}MB`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}KB`;
    return `${n.toFixed(0)}B`;
  },
};

// Translation confidence badge (exact / approximate / manual).
export const CONFIDENCE_COLOR: Record<string, string> = { exact: "#2AB06F", approximate: "#F5A623", manual: "#C21930" };
export const CONFIDENCE_LABEL: Record<string, string> = { exact: "Exact", approximate: "Approximate", manual: "Manual" };
export const ConfidenceBadge: React.FC<{ confidence: string }> = ({ confidence }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      padding: "1px 8px",
      borderRadius: 10,
      fontSize: 11,
      fontWeight: 700,
      whiteSpace: "nowrap",
      color: CONFIDENCE_COLOR[confidence],
      background: `${CONFIDENCE_COLOR[confidence]}1f`,
      border: `1px solid ${CONFIDENCE_COLOR[confidence]}66`,
    }}
  >
    <span style={{ width: 6, height: 6, borderRadius: 3, background: CONFIDENCE_COLOR[confidence] }} />
    {CONFIDENCE_LABEL[confidence] ?? confidence}
  </span>
);

// Small neutral chip (tile types, visualizations, metric keys).
export const Chip: React.FC<{ children: React.ReactNode; color?: string; mono?: boolean; title?: string }> = ({ children, color, mono, title }) => (
  <span
    title={title}
    style={{
      display: "inline-block",
      padding: "1px 7px",
      borderRadius: 4,
      fontSize: 11,
      whiteSpace: "nowrap",
      fontFamily: mono ? "monospace" : undefined,
      background: color ? `${color}1f` : "rgba(128,128,128,0.12)",
      border: `1px solid ${color ? `${color}55` : "rgba(128,128,128,0.25)"}`,
      color: color ?? "inherit",
    }}
  >
    {children}
  </span>
);

// Header-style toggle / action button (same look as the golden app's AI Assist button family).
export const pillBtn = (active = false, accent = "#4589FF"): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  background: active ? `${accent}2e` : "rgba(128,128,128,0.08)",
  color: "inherit",
  border: `1px solid ${active ? `${accent}80` : "rgba(128,128,128,0.3)"}`,
  borderRadius: 6,
  padding: "5px 10px",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
});

// Simple horizontal bar for tables where you want quick visual weight.
export const InlineBar: React.FC<{ value: number; max: number; color?: string; suffix?: string }> = ({ value, max, color = "#4589FF", suffix }) => {
  const pct = max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: "rgba(128,128,128,0.2)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3 }} />
      </div>
      <div style={{ minWidth: 60, textAlign: "right", fontSize: 11, opacity: 0.85 }}>
        {value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}k` : value.toFixed(0)}{suffix ?? ""}
      </div>
    </div>
  );
};
