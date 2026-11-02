import React, { useCallback, useMemo, useState } from "react";
import { AppHeader, Flex, PageLayout } from "@dynatrace/strato-components/layouts";
import { Tab, Tabs } from "@dynatrace/strato-components/navigation";
import { Select } from "@dynatrace/strato-components/forms";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { useDql } from "./useDql";
import { AIInsightsContext } from "./AIInsights";
import { useFrontendsData } from "./frontends";
import { DEFAULT_TIMEFRAME, TIMEFRAMES, coverageQuery, type Timeframe } from "./queries";
import {
  COST_FOCUS,
  OWNER_FOCUS,
  FieldCoverageTab,
  OverviewTab,
  SECURITY_FOCUS,
} from "./tabs/CoverageTabs";
import { RemediationPanel } from "./RemediationPanel";
import { FRONTEND_ACTIONS_ANCHOR, NavContext, remediationAnchorId, type NavApi, type RemediationTab } from "./navigation";
import { PrimaryTagsContext, usePrimaryTagsState } from "./primaryTags";
import { TagsTab } from "./tabs/TagsTab";
import { DataOverviewTab } from "./tabs/Dimensional";
import { HostGroupsTab, OneAgentTab } from "./tabs/InfraTabs";
import { SegmentsTab } from "./tabs/SegmentsTab";
import { FrontendsTab } from "./tabs/FrontendsTab";
import { SlosTab } from "./tabs/SlosTab";
import { ProblemNotificationsTab } from "./tabs/ProblemNotificationsTab";
import { ClassicOwnershipSection } from "./tabs/ClassicOwnership";
import { DeepMonitoringTab } from "./tabs/DeepMonitoringTab";
import { KubernetesTab } from "./tabs/KubernetesTab";
import { ActiveGatesTab } from "./tabs/ActiveGatesTab";
import { DatabasesTab } from "./tabs/DatabasesTab";
import { ExtensionsTab } from "./tabs/ExtensionsTab";
import { Sdv2Tab } from "./tabs/Sdv2Tab";
import { IamPolicyTab } from "./tabs/IamPolicyTab";
import { IamBoundaryTab } from "./tabs/IamBoundaryTab";
import { IamAccessTab } from "./tabs/IamAccessTab";
import { IamDraftsProvider } from "./iamDrafts";
import { AREA_BY_ID, AREAS, AreaPicker, locateTab, TAB_TITLES, TabDocsLink, type AreaId, type TabId } from "./areas";

export function App() {
  const [tf, setTf] = useState<Timeframe>(DEFAULT_TIMEFRAME);
  // The area dropdown picks which tabs are shown; each area remembers its own selected tab.
  const [area, setArea] = useState<AreaId>(AREAS[0].id);
  const [tabByArea, setTabByArea] = useState<Record<AreaId, number>>({ metadata: 0, migration: 0, visibility: 0, iam: 0 });
  const openTab = useCallback((tab: TabId) => {
    const at = locateTab(tab);
    setArea(at.area);
    setTabByArea((s) => ({ ...s, [at.area]: at.index }));
  }, []);
  // One shared query feeds the Entity Overview, Security and Cost tabs.
  // Drill-downs and tab-specific queries only run once their tab/section is opened.
  const coverage = useDql(coverageQuery(tf));
  // Frontend data also loads at page start (not when its tab opens); Entity Overview and Frontends share it.
  const frontends = useFrontendsData(tf);
  // AI Assist: one toggle in the header; every tab renders its own explanation panel when open.
  const tagState = usePrimaryTagsState();
  const [aiOpen, setAiOpen] = useState(false);
  const goToRemediation = useCallback((target: RemediationTab) => {
    openTab(target);
    // The target tab mounts after the state update; poll briefly, then scroll its remediation section into view.
    const scroll = (tries: number) => {
      const el = document.getElementById(remediationAnchorId(target));
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      else if (tries > 0) setTimeout(() => scroll(tries - 1), 100);
    };
    setTimeout(() => scroll(15), 100);
  }, [openTab]);
  const goToFrontends = useCallback((toActions = false) => {
    openTab("frontends");
    if (!toActions) return;
    // The Frontends tab mounts after the state update and its actions render once the data loads; poll, then scroll.
    const scroll = (tries: number) => {
      const el = document.getElementById(FRONTEND_ACTIONS_ANCHOR);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      else if (tries > 0) setTimeout(() => scroll(tries - 1), 200);
    };
    setTimeout(() => scroll(50), 100);
  }, [openTab]);
  const nav = useMemo<NavApi>(() => ({ goToRemediation, goToFrontends }), [goToRemediation, goToFrontends]);
  const aiContextValue = useMemo(() => ({ open: aiOpen, close: () => setAiOpen(false) }), [aiOpen]);

  const tabContent = (id: TabId): React.ReactNode => {
    switch (id) {
      case "overview":
        return <OverviewTab coverage={coverage} tf={tf} frontends={frontends} />;
      case "data":
        return <DataOverviewTab tf={tf} />;
      case "hostgroups":
        return (
          <>
            <HostGroupsTab tf={tf} />
            <RemediationPanel tab="hostgroups" coverage={coverage} tf={tf} />
          </>
        );
      case "security":
        return (
          <>
            <FieldCoverageTab coverage={coverage} tf={tf} focus={SECURITY_FOCUS} />
            <RemediationPanel tab="security" coverage={coverage} tf={tf} />
          </>
        );
      case "cost":
        return (
          <>
            <FieldCoverageTab coverage={coverage} tf={tf} focus={COST_FOCUS} />
            <RemediationPanel tab="cost" coverage={coverage} tf={tf} />
          </>
        );
      case "ownership":
        return (
          <>
            <FieldCoverageTab coverage={coverage} tf={tf} focus={OWNER_FOCUS} />
            <div style={{ marginTop: 16 }}>
              <ClassicOwnershipSection tf={tf} />
            </div>
            <RemediationPanel tab="ownership" coverage={coverage} tf={tf} />
          </>
        );
      case "primary-tags":
        return (
          <>
            <TagsTab tf={tf} />
            <RemediationPanel tab="primary-tags" coverage={coverage} tf={tf} />
          </>
        );
      case "slos":
        return <SlosTab />;
      case "segments":
        return (
          <SegmentsTab>
            <RemediationPanel tab="segments" coverage={coverage} tf={tf} />
          </SegmentsTab>
        );
      case "problem-notifications":
        return <ProblemNotificationsTab />;
      case "oneagent":
        return (
          <>
            <OneAgentTab tf={tf} />
            <RemediationPanel tab="oneagent" coverage={coverage} tf={tf} />
          </>
        );
      case "deep":
        return <DeepMonitoringTab tf={tf} />;
      case "frontends":
        return <FrontendsTab tf={tf} data={frontends} />;
      case "activegates":
        return <ActiveGatesTab tf={tf} />;
      case "kubernetes":
        return <KubernetesTab tf={tf} />;
      case "databases":
        return <DatabasesTab tf={tf} />;
      case "extensions":
        return <ExtensionsTab tf={tf} />;
      case "sdv2":
        return <Sdv2Tab tf={tf} />;
      case "iam-policy":
        return <IamPolicyTab tf={tf} />;
      case "iam-boundary":
        return <IamBoundaryTab tf={tf} />;
      case "iam-access":
        return <IamAccessTab tf={tf} />;
    }
  };

  return (
    <NavContext.Provider value={nav}>
    <PrimaryTagsContext.Provider value={tagState}>
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
              <Heading level={1}>Architect Assistant</Heading>
              <Text as="p">Onboarding best practices: what is in place vs missing in this tenant.</Text>
              {tf !== "24h" && (
                <Text as="p">Longer timeframes also count entities that existed earlier in the window, including decommissioned ones.</Text>
              )}
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
            <Select value={tf} onChange={(v: Timeframe | null) => v && setTf(v)}>
              <Select.Content>
                {TIMEFRAMES.map((t) => (
                  <Select.Option key={t.value} value={t.value}>
                    {t.label}
                  </Select.Option>
                ))}
              </Select.Content>
            </Select>
            </Flex>
          </Flex>
          <AreaPicker value={area} onChange={setArea} />
          <Tabs
            key={area}
            selectedIndex={tabByArea[area]}
            onChange={(i: number) => setTabByArea((s) => ({ ...s, [area]: i }))}
          >
            {AREA_BY_ID[area].tabs.map((id) => (
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
    </PrimaryTagsContext.Provider>
    </NavContext.Provider>
  );
}
