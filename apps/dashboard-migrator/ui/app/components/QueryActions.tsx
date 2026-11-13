import React, { useState } from "react";
import { sendIntent } from "@dynatrace-sdk/navigation";
import { Flex } from "@dynatrace/strato-components/layouts";
import Colors from "@dynatrace/strato-design-tokens/colors";

// Shown under every query-backed chart: exposes the DQL behind it and hands it to Notebooks or Dashboards.
// Intent IDs verified on a demo tenant: dynatrace.notebooks/view-query and dynatrace.dashboards/add-to-dashboard.

export const actionBtn: React.CSSProperties = {
  background: "rgba(128,128,128,0.08)",
  color: "inherit",
  border: "1px solid rgba(128,128,128,0.3)",
  borderRadius: 6,
  padding: "3px 10px",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
};

export function QueryActions({ title, query, showToggle = true }: { title: string; query: string; showToggle?: boolean }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(query).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const openNotebook = () => sendIntent({ "dt.query": query, title }, { recommendedAppId: "dynatrace.notebooks", recommendedIntentId: "view-query" });
  const openDashboard = () => sendIntent({ "dt.query": query, title }, { recommendedAppId: "dynatrace.dashboards", recommendedIntentId: "add-to-dashboard" });
  return (
    <Flex flexDirection="column" gap={8}>
      <Flex gap={8} alignItems="center" flexWrap="wrap">
        {showToggle && (
          <button type="button" style={actionBtn} onClick={() => setShow((v) => !v)} aria-expanded={show}>
            {show ? "Hide DQL" : "Show DQL"}
          </button>
        )}
        <button type="button" style={actionBtn} onClick={copy}>
          {copied ? "Copied" : "Copy DQL"}
        </button>
        <button type="button" style={actionBtn} onClick={openNotebook}>
          ↗ Open in Notebook
        </button>
        <button type="button" style={actionBtn} onClick={openDashboard}>
          ↗ Add to Dashboard
        </button>
      </Flex>
      {show && (
        <pre style={{ margin: 0, padding: 12, borderRadius: 6, background: Colors.Background.Container.Neutral.Default, fontSize: 12, overflowX: "auto", whiteSpace: "pre-wrap" }}>{query}</pre>
      )}
    </Flex>
  );
}
