import React, { useMemo, useState } from "react";
import { AppHeader, Flex, PageLayout } from "@dynatrace/strato-components/layouts";
import { Tab, Tabs } from "@dynatrace/strato-components/navigation";
import { Select } from "@dynatrace/strato-components/forms";
import { ExternalLink, Heading, Text } from "@dynatrace/strato-components/typography";
import { AIInsightsContext } from "./AIInsights";
import { DEFAULT_TIMEFRAME, TIMEFRAMES, type Timeframe } from "./queries";
import { IamDraftsProvider } from "./iamDrafts";
import { OverviewTab } from "./tabs/OverviewTab";
import { IamPolicyTab } from "./tabs/IamPolicyTab";
import { IamBoundaryTab } from "./tabs/IamBoundaryTab";
import { IamAccessTab } from "./tabs/IamAccessTab";

// Shell copied from Architect Assistant (apps/architect-assistant/ui/app/App.tsx), reduced to its "Users and permissions"
// area plus an Overview tab, which is selected first.

type TabId = "overview" | "iam-policy" | "iam-boundary" | "iam-access";
const TABS: TabId[] = ["overview", "iam-policy", "iam-boundary", "iam-access"];
const TAB_TITLES: Record<TabId, string> = {
  overview: "Overview",
  "iam-policy": "IAM Policy Creator",
  "iam-boundary": "IAM Boundary Creator",
  "iam-access": "Permissions Test",
};

/** Each tab's documentation page in the repository (`docs/<file>`); every tab links to it on GitHub. */
const DOCS_BASE_URL = "https://github.com/Chr0dine/dt-apps/blob/main/apps/iam-assistant/docs/";
const TAB_DOCS: Record<TabId, string> = {
  overview: "overview.md",
  "iam-policy": "iam-policy-creator.md",
  "iam-boundary": "iam-boundary-creator.md",
  "iam-access": "permissions-test.md",
};

/** Link to the tab's documentation on GitHub, right-aligned above the tab content. */
function TabDocsLink({ tab }: { tab: TabId }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
      <Text textStyle="small">
        <ExternalLink href={DOCS_BASE_URL + TAB_DOCS[tab]}>{TAB_TITLES[tab]} documentation</ExternalLink>
      </Text>
    </div>
  );
}

export function App() {
  const [tf, setTf] = useState<Timeframe>(DEFAULT_TIMEFRAME);
  const [tab, setTab] = useState(0);
  // AI Assist: one toggle in the header; every tab renders its own explanation panel when open.
  const [aiOpen, setAiOpen] = useState(false);
  const aiContextValue = useMemo(() => ({ open: aiOpen, close: () => setAiOpen(false) }), [aiOpen]);

  const tabContent = (id: TabId): React.ReactNode => {
    switch (id) {
      case "overview":
        return <OverviewTab />;
      case "iam-policy":
        return <IamPolicyTab tf={tf} />;
      case "iam-boundary":
        return <IamBoundaryTab tf={tf} />;
      case "iam-access":
        return <IamAccessTab tf={tf} />;
    }
  };

  return (
    <AIInsightsContext.Provider value={aiContextValue}>
      <IamDraftsProvider>
        <PageLayout>
          <PageLayout.Header>
            <AppHeader />
          </PageLayout.Header>
          <PageLayout.Content>
            <Flex flexDirection="column" gap={16} padding={16}>
              <Flex justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={8}>
                <div>
                  <Heading level={1}>IAM Assistant</Heading>
                  <Text as="p">SAML vs local groups and their users; build IAM policies and boundaries and test what a user or group can access.</Text>
                </div>
                <Flex gap={8} alignItems="center">
                  <button
                    type="button"
                    onClick={() => setAiOpen((v) => !v)}
                    title="AI Assist: explain what is on this page"
                    aria-pressed={aiOpen}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      background: aiOpen ? "rgba(165,110,255,0.18)" : "rgba(128,128,128,0.08)",
                      color: "inherit",
                      border: `1px solid ${aiOpen ? "rgba(165,110,255,0.5)" : "rgba(128,128,128,0.3)"}`,
                      borderRadius: 6,
                      padding: "5px 10px",
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                      <path d="M10 2 L12 8 L18 10 L12 12 L10 18 L8 12 L2 10 L8 8 Z" fill="#A56EFF" opacity="0.9" />
                    </svg>
                    AI Assist
                  </button>
                  {/* The timeframe only affects the condition value suggestions and record previews of the IAM tabs. */}
                  {tab !== 0 && (
                    <Select value={tf} onChange={(v: Timeframe | null) => v && setTf(v)} aria-label="Timeframe for value suggestions">
                      <Select.Content>
                        {TIMEFRAMES.map((t) => (
                          <Select.Option key={t.value} value={t.value}>
                            {t.label}
                          </Select.Option>
                        ))}
                      </Select.Content>
                    </Select>
                  )}
                </Flex>
              </Flex>
              <Tabs selectedIndex={tab} onChange={(i: number) => setTab(i)}>
                {TABS.map((id) => (
                  <Tab key={id} title={TAB_TITLES[id]}>
                    <TabDocsLink tab={id} />
                    {tabContent(id)}
                  </Tab>
                ))}
              </Tabs>
            </Flex>
          </PageLayout.Content>
        </PageLayout>
      </IamDraftsProvider>
    </AIInsightsContext.Provider>
  );
}
