import { settingsObjectsClient } from "@dynatrace-sdk/client-classic-environment-v2";
import { getIntentLink, sendIntent } from "@dynatrace-sdk/navigation";
import { ENABLEMENT_SCHEMA, HEALTH_ALERT_SCHEMA, type EnablementValue, type FrontendRow } from "./frontends";
import { errorMessage, type DocLink, type ManualAction, type SubmitResult } from "./remediation";

// ---------------------------------------------------------------------------
// Frontends tab actions. Every write is ONE Settings API POST for any number of frontends (one object per frontend
// or per alert), offers a validate-only dry run and needs an explicit confirmation. Checks without an API
// (creating synthetic monitors, user tag rules) link to the Dynatrace page instead. Intent IDs and properties were
// read from the tenant with `dtctl get intents`. Required scope: settings:objects:read / :write.
// ---------------------------------------------------------------------------

const DOC = {
  rumV2: { title: "Enable the New RUM Experience for RUM Classic web applications", url: "https://docs.dynatrace.com/docs/observe/digital-experience/new-rum-experience/web-frontends/initial-setup/enable-new-rum-for-web-apps" },
  replay: { title: "Activate Session Replay for web frontends", url: "https://docs.dynatrace.com/docs/observe/digital-experience/session-replay-latest/configure-session-replay-web/latest-enable-session-replay-web" },
  health: { title: "Health alerts for frontends", url: "https://docs.dynatrace.com/docs/observe/digital-experience/new-rum-experience/analyze-and-alert/health-alerts" },
  browserMonitor: { title: "Create and configure a browser monitor", url: "https://docs.dynatrace.com/docs/observe/digital-experience/synthetic/synthetic-app/create-configure-browser-monitors" },
  httpMonitor: { title: "Create and configure an HTTP monitor", url: "https://docs.dynatrace.com/docs/observe/digital-experience/synthetic/synthetic-app/create-and-configure-an-http-monitor" },
  assignSchema: { title: "Settings API: assign synthetic monitor to web applications", url: "https://docs.dynatrace.com/docs/discover-dynatrace/references/dynatrace-api/environment-api/settings/schemas/builtin-synthetic-browser-assigned-applications" },
  userTags: { title: "Tag specific users for web applications", url: "https://docs.dynatrace.com/docs/observe/digital-experience/web-applications/additional-configuration/identify-individual-users-for-session-analysis" },
  dtrum: { title: "RUM JavaScript API: dtrum", url: "https://docs.dynatrace.com/javascriptapi/doc/types/dtrum.html" },
} satisfies Record<string, DocLink>;

export const RUM_DOCS: DocLink[] = [DOC.rumV2];
export const REPLAY_DOCS: DocLink[] = [DOC.replay];
export const HEALTH_DOCS: DocLink[] = [DOC.health];
export const ASSIGN_DOCS: DocLink[] = [DOC.assignSchema, DOC.browserMonitor, DOC.httpMonitor];
export const CREATE_MONITOR_DOCS: DocLink[] = [DOC.browserMonitor, DOC.httpMonitor];
export const USER_TAG_DOCS: DocLink[] = [DOC.userTags, DOC.dtrum];

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function summarize(res: { code: number; error?: { message?: string } }[] | undefined, total: number, what: string, validateOnly: boolean, done: string): SubmitResult {
  const failed = (res ?? []).filter((r) => r.code >= 400);
  if (failed.length === 0) return { ok: true, message: validateOnly ? `Validation passed for ${plural(total, what)}. Nothing was changed.` : done };
  return { ok: false, message: `${failed.length} of ${plural(total, what)} rejected: ${failed[0]?.error?.message ?? `HTTP ${failed[0]?.code}`}` };
}

// --- RUM v2 / Session Replay (builtin:rum.web.enablement, scope = frontend, one object each) -------------------
export type EnablementChange = { rumV2: boolean; replay: boolean; replayGrail: boolean };

/** Starts from the frontend's effective value (own object or the inherited environment default) so nothing else changes. */
export function enablementValue(current: EnablementValue, c: EnablementChange): EnablementValue {
  const value: EnablementValue = JSON.parse(JSON.stringify(current ?? {}));
  const rum = { costAndTrafficControl: 100, ...(value.rum ?? {}) };
  const replay = { costAndTrafficControl: 100, enabled: false, ...(value.sessionReplay ?? {}) };
  // RUM v2 and Session Replay both require RUM classic (schema precondition rum.enabled == true).
  if (c.rumV2 || c.replay) rum.enabled = true;
  if (c.rumV2) rum.enabledOnGrail = true;
  if (c.replay) {
    replay.enabled = true;
    if (c.replayGrail) replay.enabledOnGrail = true;
  }
  return { ...value, rum, sessionReplay: replay };
}

export const buildEnablementBody = (targets: FrontendRow[], c: EnablementChange) =>
  targets.map((f) => ({ schemaId: ENABLEMENT_SCHEMA, scope: f.id, value: enablementValue(f.enablement, c) }));

export async function applyEnablement(targets: FrontendRow[], c: EnablementChange, validateOnly: boolean): Promise<SubmitResult> {
  try {
    const res = await settingsObjectsClient.postSettingsObjects({ body: buildEnablementBody(targets, c), validateOnly });
    const what = [c.rumV2 && "RUM v2", c.replay && (c.replayGrail ? "Session Replay (classic + Grail)" : "Session Replay classic")].filter(Boolean).join(" and ");
    return summarize(res, targets.length, "frontend", validateOnly, `${what} enabled on ${plural(targets.length, "frontend")}. Auto-injected frontends pick it up within minutes; manually inserted snippets must be updated.`);
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}

// --- Health alerts (builtin:health-experience.frontend-alert, environment scope, multi-object) ---------------
// One object per alert type with up to 100 frontends; frontends that already have an enabled alert of that type are
// skipped. Analyzer and its inputs are the schema defaults (auto-adaptive for Web Vitals and user action duration,
// seasonal baseline for errors and traffic). Limit: 300 health alerts per environment.
type Analyzer = "AutoAdaptive" | "SeasonalBaseline";
export const WEB_ALERTS: { key: string; label: string; analyzer: Analyzer; recommended: boolean }[] = [
  { key: "webVitalsLcp", label: "Web Vitals - LCP", analyzer: "AutoAdaptive", recommended: true },
  { key: "webVitalsInp", label: "Web Vitals - INP", analyzer: "AutoAdaptive", recommended: true },
  { key: "webVitalsCls", label: "Web Vitals - CLS", analyzer: "AutoAdaptive", recommended: true },
  { key: "userActionDuration", label: "User Action Duration", analyzer: "AutoAdaptive", recommended: true },
  { key: "errorRateRequestErrors", label: "Error Rate - Request Errors", analyzer: "SeasonalBaseline", recommended: true },
  { key: "errorRateExceptions", label: "Error Rate - Exceptions", analyzer: "SeasonalBaseline", recommended: true },
  { key: "trafficDrop", label: "Traffic Drop", analyzer: "SeasonalBaseline", recommended: false },
  { key: "trafficSpike", label: "Traffic Spike", analyzer: "SeasonalBaseline", recommended: false },
];
const ANALYZER_DEFAULTS: Record<Analyzer, { prop: string; input: Record<string, number> }> = {
  AutoAdaptive: { prop: "autoAdaptiveAnalyzerInput", input: { dealertingSamples: 5, numberOfSignalFluctuations: 1, slidingWindow: 5, violatingSamples: 3 } },
  SeasonalBaseline: { prop: "seasonalBaselineAnalyzerInput", input: { dealertingSamples: 5, slidingWindow: 5, tolerance: 4, violatingSamples: 3 } },
};
const MAX_FRONTENDS_PER_ALERT = 100;

export function buildHealthAlertBody(keys: string[], targets: FrontendRow[], actor: string) {
  const body: { schemaId: string; scope: string; value: Record<string, unknown> }[] = [];
  for (const a of WEB_ALERTS.filter((x) => keys.includes(x.key))) {
    const ids = targets.filter((f) => !f.alertKeys.includes(a.key)).map((f) => f.id);
    const chunks = Math.ceil(ids.length / MAX_FRONTENDS_PER_ALERT);
    for (let i = 0; i < chunks; i++) {
      const { prop, input } = ANALYZER_DEFAULTS[a.analyzer];
      body.push({
        schemaId: HEALTH_ALERT_SCHEMA,
        scope: "environment",
        value: {
          actor,
          alertKey: a.key,
          enabled: true,
          title: chunks > 1 ? `${a.label} (${i + 1}/${chunks})` : a.label,
          frontends: ids.slice(i * MAX_FRONTENDS_PER_ALERT, (i + 1) * MAX_FRONTENDS_PER_ALERT),
          analyzerType: a.analyzer,
          [prop]: input,
        },
      });
    }
  }
  return body;
}

export async function createHealthAlerts(keys: string[], targets: FrontendRow[], actor: string, validateOnly: boolean): Promise<SubmitResult> {
  const body = buildHealthAlertBody(keys, targets, actor);
  if (body.length === 0) return { ok: true, message: "Every selected frontend already has the selected alert types. Nothing to create." };
  try {
    const res = await settingsObjectsClient.postSettingsObjects({ body, validateOnly });
    return summarize(res, body.length, "health alert", validateOnly, `${plural(body.length, "health alert")} created.`);
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}

// --- Assign an existing synthetic monitor (builtin:synthetic.{browser|http}.assigned-applications, scope = monitor) --
export type MonitorOption = { id: string; name: string; kind: "Browser" | "HTTP"; apps: string[] };
const MAX_APPS_PER_MONITOR = 100;
const assignSchema = (monitorId: string) =>
  monitorId.startsWith("HTTP_CHECK-") ? "builtin:synthetic.http.assigned-applications" : "builtin:synthetic.browser.assigned-applications";

/** Reads the monitor's current assignment (1 GET) and returns the merged application list. */
export async function plannedAssignment(monitorId: string, appIds: string[]): Promise<string[]> {
  const res = await settingsObjectsClient.getSettingsObjects({ schemaIds: assignSchema(monitorId), scopes: monitorId, fields: "value" });
  const current = ((res.items?.[0]?.value as any)?.applications ?? []).map((a: { application: string }) => a.application) as string[];
  return Array.from(new Set([...current, ...appIds]));
}

export const buildAssignBody = (monitorId: string, apps: string[]) => [
  { schemaId: assignSchema(monitorId), scope: monitorId, value: { applications: apps.map((application) => ({ application })) } },
];

export async function assignMonitor(monitorId: string, appIds: string[], validateOnly: boolean): Promise<SubmitResult> {
  try {
    const apps = await plannedAssignment(monitorId, appIds);
    if (apps.length > MAX_APPS_PER_MONITOR) return { ok: false, message: `A monitor can be assigned to at most ${MAX_APPS_PER_MONITOR} applications (${apps.length} after the change).` };
    const res = await settingsObjectsClient.postSettingsObjects({ body: buildAssignBody(monitorId, apps), validateOnly });
    return summarize(res, 1, "monitor", validateOnly, `Monitor assigned; it now covers ${plural(apps.length, "frontend")}. Synthetic counts refresh with the next query run (change the timeframe or reload).`);
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}

// --- Links (no bulk API) ---------------------------------------------------------------------------------------
/** Synthetic app: new browser or HTTP monitor with the given frontends already assigned. */
export const openCreateMonitor = (type: "browser" | "http", appIds: string[]) =>
  sendIntent(
    { "dt.synthetic.monitor_type": type, "dt.synthetic.monitored_entity_ids": appIds },
    { recommendedAppId: "dynatrace.synthetic", recommendedIntentId: "create_synthetic_monitor_with_assigned_frontends" },
  );

function safeLink(fn: () => string): string | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/** RUM Classic web application page (Edit > Capturing > User tags lives there). */
export const classicWebAppLink = (id: string) => safeLink(() => getIntentLink({ "dt.entity.application": id }, "dynatrace.classic.web", "view-application"));
/** Experience Vitals frontend page, Settings tab (enablement, health alerts). */
export const vitalsSettingsLink = (id: string) =>
  safeLink(() => getIntentLink({ frontend: id, "details.properties": { selectedTab: "settings" } }, "dynatrace.experience.vitals", "view-frontend"));

export const userTagAction: ManualAction = {
  id: "user-tags",
  title: "Configure user tagging",
  steps: [
    "Open the frontend below (RUM Classic web application page) and select More (…) > Edit.",
    "Go to Capturing > User tags and add a rule that reads the user name from a CSS selector, JavaScript variable, meta tag, cookie, query string or server-side request attribute.",
    "Or call dtrum.identifyUser() from the application once the user is known (shown above); the API overrides metadata rules.",
  ],
  variants: [{ label: "RUM JavaScript API", language: "javascript", code: "// after login, once the user is known\nif (window.dtrum) dtrum.identifyUser(user.email);" }],
  notes: [
    "Up to 20 user tag rules per application; captured values are cropped to 100 characters.",
    "No user tag is sent for users with Do Not Track enabled when the application respects it.",
    "User tag rules have no Settings 2.0 schema, so they cannot be created in bulk from this app.",
  ],
  docs: USER_TAG_DOCS,
};

// --- User tag token -------------------------------------------------------------------------------------------
// The ReadConfig API token the `user-tags` app function uses is kept in the app settings (AppCredentialsCard,
// api/app-credentials.ts): an admin creates or pastes it once and the app's users never see it.
export const TOKEN_DOCS: DocLink[] = [
  { title: "Access tokens", url: "https://docs.dynatrace.com/docs/manage/identity-access-management/access-tokens-and-oauth-clients/access-tokens" },
];
