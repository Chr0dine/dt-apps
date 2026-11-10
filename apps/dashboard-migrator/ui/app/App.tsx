import React, { useMemo, useState } from "react";
import { Page } from "@dynatrace/strato-components-preview/layouts";
import { Tabs, Tab } from "@dynatrace/strato-components-preview/navigation";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text, Strong } from "@dynatrace/strato-components/typography";
import { SettingsProvider, ALL_TABS } from "./SettingsContext";
import { MigrationProvider, useMigration } from "./MigrationContext";
import { AIInsightsContext } from "./components/AIInsights";
import { HelpModal } from "./components/HelpModal";
import { ConfidenceBadge } from "./components/layout";
import { TabDocsLink, TabRefLinks } from "./components/DocLinks";
import { ImportTab } from "./tabs/ImportTab";
import { TranslateTab } from "./tabs/TranslateTab";
import { ExportTab } from "./tabs/ExportTab";
import appConfig from "../../app.config.json";

const APP_VERSION_LABEL = appConfig.app.version;

const AppHeader: React.FC<{ aiOpen: boolean; onToggleAI: () => void; onOpenHelp: () => void }> = ({ aiOpen, onToggleAI, onOpenHelp }) => {
  const { result, tiles } = useMigration();
  const counts = useMemo(() => {
    const c = { exact: 0, approximate: 0, manual: 0 };
    tiles.forEach((t) => c[t.confidence]++);
    return c;
  }, [tiles]);
  return (
    <div style={{ padding: "14px 20px 8px", borderBottom: "1px solid rgba(128,128,128,0.15)" }}>
      <Flex alignItems="center" gap={12} flexWrap="wrap">
        <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden>
          <rect x="1" y="3" width="10" height="8" rx="2" stroke="#8A8A8A" strokeWidth="1.6" />
          <rect x="1" y="14" width="10" height="9" rx="2" stroke="#8A8A8A" strokeWidth="1.6" />
          <rect x="15" y="3" width="10" height="12" rx="2" fill="#4589FF33" stroke="#4589FF" strokeWidth="1.6" />
          <rect x="15" y="18" width="10" height="5" rx="2" fill="#4589FF33" stroke="#4589FF" strokeWidth="1.6" />
          <path d="M11.5 13h3M13 11.5l1.5 1.5-1.5 1.5" stroke="#4589FF" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div>
          <Strong style={{ fontSize: 16 }}>Dashboard Migrator</Strong>
          <Text style={{ display: "block", fontSize: 11, opacity: 0.6 }}>Classic dashboards and their queries → DQL and new dashboards</Text>
        </div>

        {result && (
          <Flex alignItems="center" gap={6} style={{ marginLeft: 12 }}>
            <Text style={{ fontSize: 12, opacity: 0.75, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{result.name}</Text>
            {counts.exact > 0 && <ConfidenceBadge confidence="exact" />}
            {counts.exact > 0 && <Text style={{ fontSize: 12 }}>{counts.exact}</Text>}
            {counts.approximate > 0 && <ConfidenceBadge confidence="approximate" />}
            {counts.approximate > 0 && <Text style={{ fontSize: 12 }}>{counts.approximate}</Text>}
            {counts.manual > 0 && <ConfidenceBadge confidence="manual" />}
            {counts.manual > 0 && <Text style={{ fontSize: 12 }}>{counts.manual}</Text>}
          </Flex>
        )}

        <div style={{ flex: 1 }} />

        <button
          onClick={onToggleAI}
          title="AI Insights"
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            background: aiOpen ? "rgba(165,110,255,0.18)" : "rgba(128,128,128,0.08)",
            color: "inherit",
            border: `1px solid ${aiOpen ? "rgba(165,110,255,0.5)" : "rgba(128,128,128,0.3)"}`,
            borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 12, fontWeight: 600,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
            <path d="M10 2 L12 8 L18 10 L12 12 L10 18 L8 12 L2 10 L8 8 Z" fill="#A56EFF" opacity="0.9" />
          </svg>
          AI Assist
        </button>

        <button onClick={onOpenHelp} title="Help" style={{ background: "transparent", border: "none", cursor: "pointer", padding: 2 }}>
          <svg width="22" height="22" viewBox="0 0 22 22">
            <circle cx="11" cy="11" r="10" fill="none" stroke="rgba(128,128,128,0.5)" strokeWidth="1.5" />
            <text x="11" y="15.5" textAnchor="middle" fill="rgba(128,128,128,0.7)" fontSize="14" fontWeight="700">?</text>
          </svg>
        </button>

        <Text style={{ fontSize: 11, opacity: 0.4, fontFamily: "monospace" }}>v{APP_VERSION_LABEL}</Text>
      </Flex>
    </div>
  );
};

const AppInner: React.FC = () => {
  const [tab, setTab] = useState(0);
  const [aiOpen, setAiOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const aiContextValue = useMemo(() => ({ open: aiOpen, close: () => setAiOpen(false) }), [aiOpen]);
  const go = (name: (typeof ALL_TABS)[number]) => setTab(ALL_TABS.indexOf(name));

  return (
    <AIInsightsContext.Provider value={aiContextValue}>
      <AppHeader aiOpen={aiOpen} onToggleAI={() => setAiOpen((v) => !v)} onOpenHelp={() => setShowHelp(true)} />
      <div style={{ padding: "0 8px" }}>
        <Tabs selectedIndex={tab} onChange={(i: unknown) => setTab(Number(i) || 0)}>
          <Tab title="Import">
            <TabDocsLink tab="Import" />
            <ImportTab onLoaded={() => go("Translate")} />
            <TabRefLinks tab="Import" />
          </Tab>
          <Tab title="Translate">
            <TabDocsLink tab="Translate" />
            <TranslateTab onGoImport={() => go("Import")} onGoExport={() => go("Export")} />
            <TabRefLinks tab="Translate" />
          </Tab>
          <Tab title="Export">
            <TabDocsLink tab="Export" />
            <ExportTab onGoImport={() => go("Import")} />
            <TabRefLinks tab="Export" />
          </Tab>
        </Tabs>
      </div>
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </AIInsightsContext.Provider>
  );
};

export const App: React.FC = () => (
  <SettingsProvider>
    <MigrationProvider>
      <Page>
        <Page.Main>
          <AppInner />
        </Page.Main>
      </Page>
    </MigrationProvider>
  </SettingsProvider>
);
