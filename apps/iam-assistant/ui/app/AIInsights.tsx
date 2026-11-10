import React, { useMemo } from "react";
import { Text, Strong } from "@dynatrace/strato-components/typography";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type InsightSeverity = "good" | "warning" | "critical" | "info";
export type InsightItem = { severity: InsightSeverity; icon: string; text: string };
export type RecommendationItem = { impact: "high" | "medium" | "low"; text: string };
export type AIInsightsData = { summary: string; insights: InsightItem[]; recommendations: RecommendationItem[] };

// ---------------------------------------------------------------------------
// CSS injection (same pattern as TimelapseTable.tsx)
// ---------------------------------------------------------------------------
const STYLE_ID = "ai-insights-styles";
function ensureAIStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
/* AI Insights panel */
.uj-ai-panel {
  border: 1px solid rgba(165, 110, 255, 0.25);
  border-radius: 10px;
  background: rgba(165, 110, 255, 0.04);
  overflow: hidden;
  animation: uj-ai-slide-in 0.25s ease-out;
}
@keyframes uj-ai-slide-in {
  from { opacity: 0; max-height: 0; transform: translateY(-8px); }
  to   { opacity: 1; max-height: 2000px; transform: translateY(0); }
}
.uj-ai-panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(165, 110, 255, 0.15);
}
.uj-ai-panel-header svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
.uj-ai-panel-body {
  padding: 16px;
}
.uj-ai-section-title {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  opacity: 0.5;
  margin-bottom: 8px;
}
.uj-ai-insight-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 6px 10px;
  border-radius: 6px;
  margin-bottom: 4px;
}
.uj-ai-insight-row.good {
  background: rgba(13, 156, 41, 0.06);
  border-left: 3px solid #0D9C29;
}
.uj-ai-insight-row.warning {
  background: rgba(255, 131, 43, 0.06);
  border-left: 3px solid #FF832B;
}
.uj-ai-insight-row.critical {
  background: rgba(194, 25, 48, 0.06);
  border-left: 3px solid #C21930;
}
.uj-ai-insight-row.info {
  background: rgba(69, 137, 255, 0.06);
  border-left: 3px solid #4589FF;
}
.uj-ai-recommendation {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 8px 12px;
  border-radius: 6px;
  background: rgba(128, 128, 128, 0.04);
  margin-bottom: 4px;
}
.uj-ai-rec-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 3px;
  font-weight: 700;
  text-transform: uppercase;
  white-space: nowrap;
  flex-shrink: 0;
}
.uj-ai-rec-badge.high {
  background: rgba(194, 25, 48, 0.12);
  color: #C21930;
}
.uj-ai-rec-badge.medium {
  background: rgba(255, 131, 43, 0.12);
  color: #FF832B;
}
.uj-ai-rec-badge.low {
  background: rgba(128, 128, 128, 0.1);
}

/* Typewriter streaming animation */
@keyframes uj-ai-typewriter {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.uj-ai-stream-word {
  display: inline;
  opacity: 0;
  animation: uj-ai-typewriter 0.3s ease forwards;
}
`;
  document.head.appendChild(s);
}

// ---------------------------------------------------------------------------
// SparkleIcon — copied from UserJourney.tsx
// ---------------------------------------------------------------------------
function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Large sparkle (bottom-right) */}
      <path d="M14 4L15.2 9.6L20 12L15.2 14.4L14 20L12.8 14.4L8 12L12.8 9.6Z" fill="url(#sparkle-grad)" />
      {/* Medium sparkle (top-left) */}
      <path d="M7 2L7.7 4.8L10 6L7.7 7.2L7 10L6.3 7.2L4 6L6.3 4.8Z" fill="url(#sparkle-grad)" />
      {/* Small sparkle (left-middle) */}
      <path d="M5 13L5.5 14.8L7 16L5.5 17.2L5 19L4.5 17.2L3 16L4.5 14.8Z" fill="url(#sparkle-grad)" />
      <defs>
        <linearGradient id="sparkle-grad" x1="3" y1="2" x2="20" y2="20">
          <stop stopColor="#c084fc" />
          <stop offset="1" stopColor="#818cf8" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// StreamText — word-by-word streaming animation, copied from UserJourney.tsx
// ---------------------------------------------------------------------------
export function StreamText({ text, baseDelay, style }: { text: string; baseDelay: number; style?: React.CSSProperties }) {
  const words = text.split(/(\s+)/);
  let wordIndex = 0;
  return (
    <Text style={style}>
      {words.map((w, i) => {
        if (/^\s+$/.test(w)) return w;
        const delay = baseDelay + wordIndex * 60;
        wordIndex++;
        return <span key={i} className="uj-ai-stream-word" style={{ animationDelay: `${delay}ms` }}>{w}</span>;
      })}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// AIInsightsPanel — copied from UserJourney.tsx
// ---------------------------------------------------------------------------
function AIInsightsPanel({ data, onClose }: { data: AIInsightsData; onClose: () => void }) {
  ensureAIStyles();
  // Calculate cumulative word offsets so each section streams after the previous
  const summaryWords = data.summary.split(/\s+/).length;
  const summaryDuration = summaryWords * 60;
  let insightOffset = summaryDuration + 400;
  const insightDurations: number[] = data.insights.map(ins => {
    const d = ins.text.split(/\s+/).length * 60;
    return d;
  });

  return (
    <div className="uj-ai-panel">
      <div className="uj-ai-panel-header">
        <SparkleIcon />
        <Strong style={{ flex: 1 }}>AI Insights</Strong>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: 16, opacity: 0.5, padding: "2px 6px" }}>✕</button>
      </div>
      <div className="uj-ai-panel-body">
        {/* Summary */}
        <div style={{ marginBottom: 16 }}>
          <div className="uj-ai-section-title" style={{ opacity: 0, animation: "uj-ai-typewriter 0.3s ease forwards", animationDelay: "100ms" }}>Summary</div>
          <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(165,110,255,0.06)", border: "1px solid rgba(165,110,255,0.12)" }}>
            <StreamText text={data.summary} baseDelay={200} style={{ fontSize: 13, lineHeight: "1.5" }} />
          </div>
        </div>

        {/* Insights */}
        {data.insights.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div className="uj-ai-section-title" style={{ opacity: 0, animation: "uj-ai-typewriter 0.3s ease forwards", animationDelay: `${insightOffset - 200}ms` }}>Insights</div>
            {data.insights.map((ins, i) => {
              const myOffset = insightOffset;
              insightOffset += insightDurations[i] + 240;
              return (
                <div key={i} className={`uj-ai-insight-row ${ins.severity}`} style={{ opacity: 0, animation: "uj-ai-typewriter 0.3s ease forwards", animationDelay: `${myOffset - 100}ms` }}>
                  <Text style={{ fontSize: 14, flexShrink: 0 }}>{ins.icon}</Text>
                  <StreamText text={ins.text} baseDelay={myOffset} style={{ fontSize: 13 }} />
                </div>
              );
            })}
          </div>
        )}

        {/* Recommendations */}
        {data.recommendations.length > 0 && (
          <div>
            <div className="uj-ai-section-title" style={{ opacity: 0, animation: "uj-ai-typewriter 0.3s ease forwards", animationDelay: `${insightOffset}ms` }}>Recommendations</div>
            {data.recommendations.map((rec, i) => {
              const myOffset = insightOffset + 300 + i * 800;
              return (
                <div key={i} className="uj-ai-recommendation" style={{ opacity: 0, animation: "uj-ai-typewriter 0.3s ease forwards", animationDelay: `${myOffset}ms` }}>
                  <span className={`uj-ai-rec-badge ${rec.impact}`}>{rec.impact}</span>
                  <StreamText text={rec.text} baseDelay={myOffset + 100} style={{ fontSize: 13 }} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Context — simplified from UserJourney.tsx (no activeSubTab)
// ---------------------------------------------------------------------------
export const AIInsightsContext = React.createContext<{ open: boolean; close: () => void }>({
  open: false,
  close: () => {},
});

// ---------------------------------------------------------------------------
// useAIInsightsOpen — helper hook for managing open state outside the context
// ---------------------------------------------------------------------------
export function useAIInsightsOpen(): { open: boolean; toggle: () => void; close: () => void } {
  const [open, setOpen] = React.useState(false);
  const toggle = React.useCallback(() => setOpen((v) => !v), []);
  const close = React.useCallback(() => setOpen(false), []);
  return { open, toggle, close };
}

// ---------------------------------------------------------------------------
// useAIInsights — simplified from UserJourney.tsx (no subTabKey / industry)
// ---------------------------------------------------------------------------
export function useAIInsights(analysisFn: () => AIInsightsData): { panel: React.ReactNode } {
  const { open, close } = React.useContext(AIInsightsContext);
  const data = useMemo(() => (open ? analysisFn() : null), [open, analysisFn]);
  return {
    panel: open && data ? (
      <div style={{ padding: "16px 20px" }}>
        <AIInsightsPanel data={data} onClose={close} />
      </div>
    ) : null,
  };
}
