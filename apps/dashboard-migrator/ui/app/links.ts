// Documentation links. Every docs.dynatrace.com / developer.dynatrace.com URL here returned HTTP 200 on 2026-11-10
// (checked with curl against a 404 control); re-check when adding one.

export type DocLink = { title: string; url: string };

/** This app's documentation pages in the repository; every tab links to its page on GitHub. */
export const DOCS_BASE_URL = "https://github.com/Chr0dine/dt-apps/blob/main/apps/dashboard-migrator/docs/";
export const TAB_DOCS = { Import: "import.md", Translate: "translate.md", Export: "export.md" } as const;
export const DOCS_INDEX_URL = `${DOCS_BASE_URL}README.md`;
export const TRANSLATION_REFERENCE_URL = `${DOCS_BASE_URL}translation-reference.md`;

const D = "https://docs.dynatrace.com/docs";
export const REF = {
  dashboardJson: { title: "Dashboard JSON (classic dashboards)", url: `${D}/analyze-explore-automate/dashboards-classic/dashboards/dashboard-json` },
  classicDashboards: { title: "Dashboards Classic", url: `${D}/analyze-explore-automate/dashboards-classic` },
  classicTiles: { title: "Available tiles (classic dashboards)", url: `${D}/analyze-explore-automate/dashboards-classic/charts-and-tiles/available-tiles` },
  dashboardsApi: { title: "Dashboards API (Configuration API v1)", url: `${D}/dynatrace-api/configuration-api/dashboards-api` },
  getDashboardApi: { title: "GET a dashboard (Configuration API v1)", url: `${D}/dynatrace-api/configuration-api/dashboards-api/get-dashboard` },
  accessTokens: { title: "Access tokens", url: `${D}/manage/identity-access-management/access-tokens-and-oauth-clients/access-tokens` },
  outbound: { title: "Allow outbound connections for app functions", url: "https://developer.dynatrace.com/develop/guides/app-functions/allow-outbound-connections/" },
  appEngine: { title: "AppEngine", url: `${D}/platform/appengine` },
  dql: { title: "Dynatrace Query Language", url: `${D}/platform/grail/dynatrace-query-language` },
  metricCommands: { title: "DQL metric commands (timeseries)", url: `${D}/platform/grail/dynatrace-query-language/commands/metric-commands` },
  dataSourceCommands: { title: "DQL data source commands (fetch)", url: `${D}/platform/grail/dynatrace-query-language/commands/data-source-commands` },
  generalFunctions: { title: "DQL general functions (classicEntitySelector, entityName)", url: `${D}/platform/grail/dynatrace-query-language/functions/general-functions` },
  grailMetrics: { title: "Built-in metrics on Grail", url: `${D}/analyze-explore-automate/metrics/built-in-metrics-on-grail` },
  metricSelector: { title: "Metric selector (classic)", url: `${D}/dynatrace-api/environment-api/metric-v2/metric-selector` },
  usql: { title: "USQL: custom queries on session data (RUM Classic)", url: `${D}/observe/digital-experience-classic/rum-classic/session-segmentation/custom-queries-segmentation-and-aggregation-of-session-data` },
  rum: { title: "Real User Monitoring (new RUM)", url: `${D}/observe/digital-experience/rum` },
  managementZones: { title: "Management zones (classic)", url: `${D}/manage/identity-access-management-classic/permission-management/management-zones` },
  segments: { title: "Segments", url: `${D}/manage/segments` },
  dashboards: { title: "Dashboards", url: `${D}/analyze-explore-automate/dashboards-and-notebooks/dashboards-new` },
  dashboardComponents: { title: "Dashboard components and tiles", url: `${D}/analyze-explore-automate/dashboards-and-notebooks/dashboards-new/components` },
  upgradeDashboards: { title: "Upgrade guide: dashboards", url: `${D}/platform/upgrade/get-apps-and-surfaces-working/upgrade-guide-dashboards` },
} satisfies Record<string, DocLink>;

/** Reference links shown at the bottom of each tab. */
export const TAB_REFS: Record<keyof typeof TAB_DOCS, DocLink[]> = {
  Import: [REF.dashboardJson, REF.getDashboardApi, REF.accessTokens, REF.outbound, REF.classicTiles],
  Translate: [REF.dql, REF.metricCommands, REF.grailMetrics, REF.metricSelector, REF.generalFunctions, REF.usql, REF.rum, REF.segments],
  Export: [REF.dashboards, REF.dashboardComponents, REF.upgradeDashboards, REF.segments],
};
