import { functions } from "@dynatrace-sdk/app-utils";
import { credentialVaultClient, settingsObjectsClient } from "@dynatrace-sdk/client-classic-environment-v2";
import { queryExecutionClient } from "@dynatrace-sdk/client-query";
import { httpClient } from "@dynatrace-sdk/http-client";
import { getIntentLink } from "@dynatrace-sdk/navigation";
import { PROBLEM_DAYS, dqlString } from "./queries";
import { errorMessage, type DocLink, type ManualAction, type SubmitResult } from "./remediation";
import { eventNamesQuery, predefinedTypes, toProfile, translateProfile, type AlertingProfile, type DelayTiming, type Note } from "./alertingProfiles";

// ---------------------------------------------------------------------------
// Classic problem notifications -> simple workflows. Port of the "Classic Problems to WFs v1.1" migration workflow:
// one SIMPLE workflow per enabled notification, titled with the notification's name, with a Davis problem trigger
// filtered on the notification's alerting profile and one task per integration type: email, Slack, ServiceNow
// incident, webhook (HTTP request). Other types (and ServiceNow events only) are manual.
// Trigger filter: by default the profile's rules translated to DQL (alertingProfiles.ts), so it does not depend on the
// deprecated labels.alerting_profile; profiles that cannot be translated (management zone, regex, unknown event type)
// fall back to the label, which is also the migration workflow's behaviour when chosen in the form.
// Workflows carry MIGRATION_DESCRIPTION, so ones created by the migration workflow and by this app look the same.
// Fixes against the workflow, all validated on the demo tenant:
//   - profile filter uses matchesValue (exact): matchesPhrase "Default" also matched "ServiceNow Default Problem
//     Notification Profile" (4,470 problems in 7 days instead of 3,402);
//   - placeholders use event()["field"]: event(status) passes an undefined variable, not an attribute name;
//   - webhook headers are sent as a name -> value map (classic stores a list of { name, value, secret });
//   - webhooks whose URL is a secret are manual (the Settings API does not return secrets);
//   - a same-name workflow without the migration description is left alone instead of duplicated.
// The create body has no filterQuery: the server builds it from triggerConfiguration, so customFilter is what counts.
// Creation goes through the `workflows` app function with a platform token from the credential vault: custom apps may
// not request automation:workflows:write. Listing stays on the app's automation:workflows:read.
// API specs: `@dynatrace-sdk/client-automation` (WorkflowCreate, DavisProblemConfig); schema `builtin:problem.notifications`.
// ---------------------------------------------------------------------------

const NOTIFICATION_SCHEMA = "builtin:problem.notifications";
const PROFILE_SCHEMA = "builtin:alerting.profile";
const WORKFLOW_API = "/platform/automation/v1/workflows";
const WORKFLOW_PAGE = 200;
/** Event trigger filter limit (upgrade guide). */
const FILTER_MAX = 1000;
const TASK_NAME = "problem_notification";
export const MIGRATION_DESCRIPTION =
  "Auto Created Simple Workflow from Classic Problem Notification and corresponding Alerting Profile (via migration workflow)";

const DOC = {
  upgrade: { title: "Upgrade from Classic problem notification to simple workflows", url: "https://docs.dynatrace.com/docs/platform/upgrade/keep-problems-and-alerting-working/upgrade-guide-alert-notification" },
  jinja: { title: "Jinja expressions for Workflows", url: "https://docs.dynatrace.com/docs/analyze-explore-automate/workflows/reference" },
} satisfies Record<string, DocLink>;
export const PN_DOCS: DocLink[] = [DOC.upgrade, DOC.jinja];

export const NOTIFICATION_TYPES: { value: string; label: string; key: string }[] = [
  { value: "EMAIL", label: "Email", key: "emailNotification" },
  { value: "SLACK", label: "Slack", key: "slackNotification" },
  { value: "SERVICE_NOW", label: "ServiceNow", key: "serviceNowNotification" },
  { value: "WEBHOOK", label: "Custom webhook", key: "webHookNotification" },
  { value: "JIRA", label: "Jira", key: "jiraNotification" },
  { value: "PAGER_DUTY", label: "PagerDuty", key: "pagerDutyNotification" },
  { value: "OPS_GENIE", label: "OpsGenie", key: "opsGenieNotification" },
  { value: "VICTOROPS", label: "VictorOps", key: "victorOpsNotification" },
  { value: "XMATTERS", label: "xMatters", key: "xMattersNotification" },
  { value: "TRELLO", label: "Trello", key: "trelloNotification" },
  { value: "ANSIBLETOWER", label: "Ansible Tower", key: "ansibleTowerNotification" },
];
export const typeLabel = (t: string) => NOTIFICATION_TYPES.find((x) => x.value === t)?.label ?? t;

// --- Links ------------------------------------------------------------------------

const intentLink = (props: Record<string, unknown>, app: string, intent: string): string | undefined => {
  try {
    return getIntentLink(props, app, intent);
  } catch {
    return undefined;
  }
};
/** Intents read from the tenant with `dtctl get intents --app dynatrace.automations|dynatrace.settings`. */
export const workflowLink = (id: string) => intentLink({ "workflow.id": id }, "dynatrace.automations", "view-workflow-by-id");
export const notificationLink = (objectId: string) => intentLink({ "dt.settings.object_id": objectId }, "dynatrace.settings", "deprecated_open_settings_by_id");

async function errorFromResponse(e: unknown): Promise<string> {
  const anyE = e as any;
  const res = anyE?.response;
  if (res?.body) {
    try {
      const b = (await res.body("json")) as any;
      const details = b?.error?.details?.constraintViolations?.map?.((v: any) => [v?.path, v?.message].filter(Boolean).join(": ")).filter(Boolean).join("; ");
      return [b?.error?.message, details].filter(Boolean).join(": ") || String(anyE?.message ?? e);
    } catch {
      /* fall through */
    }
  }
  return anyE?.body?.error?.message ?? anyE?.data?.error?.message ?? anyE?.message ?? String(e);
}

// --- Reads ---------------------------------------------------------------------

async function settingsObjects(schemaId: string): Promise<{ objectId: string; value: Record<string, any> }[]> {
  const out: { objectId: string; value: Record<string, any> }[] = [];
  let nextPageKey: string | undefined;
  do {
    const res = await settingsObjectsClient.getSettingsObjects(
      nextPageKey ? { nextPageKey } : { schemaIds: schemaId, scopes: "environment", fields: "objectId,value", pageSize: 500 },
    );
    for (const o of res.items ?? []) out.push({ objectId: o.objectId ?? "", value: (o.value ?? {}) as Record<string, any> });
    nextPageKey = res.nextPageKey;
  } while (nextPageKey);
  return out;
}

export type ClassicNotification = {
  /** Settings object ID. */
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  profileId: string;
  /** Null when the alerting profile the notification points to does not exist. */
  profileName: string | null;
  profile: AlertingProfile | null;
  /** The type's own settings (emailNotification, slackNotification, ...). Secrets come back masked. */
  config: Record<string, any>;
};

/** Every classic problem notification with the name of its alerting profile (one paged GET per schema). */
export async function listNotifications(): Promise<ClassicNotification[]> {
  const [notifications, profiles] = await Promise.all([settingsObjects(NOTIFICATION_SCHEMA), settingsObjects(PROFILE_SCHEMA)]);
  const byId = new Map(profiles.map((p) => [p.objectId, toProfile(p.objectId, p.value)]));
  return notifications
    .map(({ objectId, value: v }) => {
      const type = String(v.type ?? "");
      const key = NOTIFICATION_TYPES.find((t) => t.value === type)?.key ?? "";
      return {
        id: objectId,
        name: String(v.displayName ?? ""),
        type,
        enabled: v.enabled === true,
        profileId: String(v.alertingProfile ?? ""),
        profileName: byId.get(String(v.alertingProfile ?? ""))?.name ?? null,
        profile: byId.get(String(v.alertingProfile ?? "")) ?? null,
        config: (key && v[key]) || {},
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type WorkflowSummary = { id: string; title: string; managed: boolean };

/** Every workflow the user can see (limit/offset pages); managed = created by the migration (its description). */
export async function listWorkflows(): Promise<WorkflowSummary[]> {
  const out: WorkflowSummary[] = [];
  for (let offset = 0; ; offset += WORKFLOW_PAGE) {
    const res = await httpClient.send({ url: `${WORKFLOW_API}?limit=${WORKFLOW_PAGE}&offset=${offset}`, method: "GET" });
    const body = (await res.body("json")) as { count?: number; results?: any[] };
    const page = body.results ?? [];
    for (const w of page) out.push({ id: String(w.id), title: String(w.title ?? ""), managed: w.description === MIGRATION_DESCRIPTION });
    if (page.length < WORKFLOW_PAGE || out.length >= (body.count ?? 0)) break;
  }
  return out;
}

// --- Conversion ---------------------------------------------------------------------

export type Conversion = { auto: true; label: string; action: string } | { auto: false; label: string; reason: string };

/** Which workflow action the migration uses for this notification type, or why it has none. */
export function conversionOf(n: Pick<ClassicNotification, "type" | "config">): Conversion {
  switch (n.type) {
    case "EMAIL":
      return { auto: true, label: "Email", action: "dynatrace.email:send-email" };
    case "SLACK":
      return { auto: true, label: "Slack message", action: "dynatrace.slack:slack-send-message" };
    case "SERVICE_NOW":
      return n.config.sendIncidents
        ? { auto: true, label: "ServiceNow incident", action: "dynatrace.servicenow:snow-create-incident" }
        : { auto: false, label: "Manual", reason: "Sends ServiceNow events only; the migration converts incidents." };
    case "WEBHOOK":
      return n.config.urlContainsSecret
        ? { auto: false, label: "Manual", reason: "The webhook URL is stored as a secret, which the Settings API does not return." }
        : { auto: true, label: "HTTP request", action: "dynatrace.automations:http-function" };
    default:
      return { auto: false, label: "Manual", reason: `${typeLabel(n.type)} has no conversion in the migration logic.` };
  }
}

// --- Matching -------------------------------------------------------------------

export type NotificationRow = ClassicNotification & { workflow?: WorkflowSummary; managed: boolean; conversion: Conversion };

/** Enabled, an automatic conversion, an existing alerting profile and no workflow of the same name yet. */
export const convertible = (r: NotificationRow) => r.enabled && r.conversion.auto && !!r.profileName && !r.workflow;

/** Pairs every notification with the workflow of the same title (one created by the migration wins). */
export function matchNotifications(notifications: ClassicNotification[], workflows: WorkflowSummary[]): NotificationRow[] {
  const byTitle = new Map<string, WorkflowSummary>();
  workflows.forEach((w) => {
    const cur = byTitle.get(w.title);
    if (!cur || (w.managed && !cur.managed)) byTitle.set(w.title, w);
  });
  return notifications.map((n) => {
    const workflow = byTitle.get(n.name);
    return { ...n, workflow, managed: !!workflow?.managed, conversion: conversionOf(n) };
  });
}

// --- Workflow body (same shape as the migration workflow) -----------------------------

/** Classic placeholders look like {ProblemID}; the migration replaces any text that has them with one generic text. */
const hasPlaceholder = (s: string) => s.includes("{") && s.includes("}");
export const GENERIC_MESSAGE = '{{ event()["event.status"] }} Problem {{ event()["display_id"] }}: {{ event()["affected_entity_ids"] }}';
export const GENERIC_BODY = '{{ event()["event.description"] }}';
const POSITION = { x: 0, y: 1 };
const PLACEHOLDER_NOTE = "Classic placeholders were replaced by one generic text (status, problem ID, affected entities); edit the task to restore the original content.";
const CLOSED_NOTE = "Classic also notified when the problem closed; the workflow triggers on open problems only.";

const CATEGORIES = { availability: true, custom: true, error: true, monitoringUnavailable: true, slowdown: true, resource: true, info: true };
/** What the server generates from triggerConfiguration (same form as the tenant's own workflows), before the custom filter. */
const TRIGGER_BASE =
  'event.kind == "DAVIS_PROBLEM" AND event.status == "ACTIVE" AND matchesValue(event.status_transition, {"CREATED", "UPDATED", "REOPENED"}) AND dt.analysis.ready == true AND (matchesValue(event.category, {"AVAILABILITY", "ERROR", "SLOWDOWN", "RESOURCE_CONTENTION", "CUSTOM_ALERT", "MONITORING_UNAVAILABLE", "INFO"}))';
const UNIQUE_EXPRESSION = '{{ event()["event.id"] }}-{{ "open" if event()["event.status"] == "ACTIVE" else "resolved" }}-{{ event()["dt.davis.last_reopen_timestamp"] }}';

/** Custom filter on the deprecated alerting profile label: exact (case-insensitive) match on one profile name. */
export const labelFilter = (profile: string) => `matchesValue(labels.alerting_profile, ${dqlString(profile)})`;

/** The filter the trigger evaluates on every problem update; an empty custom filter means every problem. */
export const triggerFilter = (custom: string) => (custom ? `${TRIGGER_BASE} AND (${custom})` : TRIGGER_BASE);

type TaskBuild = { task: Record<string, unknown>; notes: string[] };

function emailTask(c: Record<string, any>): TaskBuild {
  const subject = String(c.subject ?? "");
  const body = String(c.body ?? "");
  const replaced = hasPlaceholder(subject) || hasPlaceholder(body);
  return {
    task: {
      name: TASK_NAME,
      input: {
        cc: c.ccRecipients ?? [],
        to: c.recipients ?? [],
        bcc: c.bccRecipients ?? [],
        content: hasPlaceholder(body) ? GENERIC_BODY : body,
        subject: hasPlaceholder(subject) ? GENERIC_MESSAGE : subject,
      },
      action: "dynatrace.email:send-email",
      position: POSITION,
      description: "Send email",
      predecessors: [],
    },
    notes: [...(replaced ? [PLACEHOLDER_NOTE] : []), ...(c.notifyClosedProblems ? [CLOSED_NOTE] : [])],
  };
}

function slackTask(c: Record<string, any>): TaskBuild {
  const message = String(c.message ?? "");
  return {
    task: {
      name: TASK_NAME,
      input: {
        message: hasPlaceholder(message) ? GENERIC_MESSAGE : message,
        reaction: [],
        connection: "",
        channelType: "expression",
        executionDate: "{{ execution().started_at }}",
        appendToThread: false,
        replyBroadcast: false,
        selectedRequestType: 0,
        attachmentToggleValue: "none",
        channel: String(c.channel ?? ""),
      },
      action: "dynatrace.slack:slack-send-message",
      position: POSITION,
      description: "Send a message to a Slack workspace",
      predecessors: [],
    },
    notes: [
      "Select a Slack connection in the task: the classic Slack webhook URL is a secret and is not carried over. Until then every run of this workflow fails.",
      ...(hasPlaceholder(message) ? [PLACEHOLDER_NOTE] : []),
    ],
  };
}

function serviceNowTask(c: Record<string, any>): TaskBuild {
  const message = String(c.message ?? "");
  // As in the migration: the classic message is used only when it has no placeholders at all.
  const useMessage = message && !message.includes("{") && !message.includes("}");
  const instance = c.instanceName || c.url || "the classic instance";
  return {
    task: {
      name: TASK_NAME,
      input: {
        caller: "",
        impact: "3",
        urgency: "3",
        category: "inquiry",
        description: useMessage ? message : "Event details: {{ event() }}",
        subCategory: "internal application",
        connectionId: "",
        correlationId: 'DT_{{ event()["event.id"] }}',
        shortDescription: '{{ event()["event.category"] }} {{ event()["event.name"] }}',
      },
      action: "dynatrace.servicenow:snow-create-incident",
      position: POSITION,
      description: "Create an incident in ServiceNow",
      predecessors: [],
    },
    notes: [
      `Select a ServiceNow connection for ${instance} in the task (classic credentials are secrets and are not carried over). Until then every run of this workflow fails.`,
      ...(c.sendEvents ? ["Classic also sent events to ServiceNow; the workflow creates incidents only."] : []),
    ],
  };
}

function webhookTask(c: Record<string, any>): TaskBuild {
  const payload = String(c.payload ?? "");
  const headers: { name?: string; value?: string; secret?: boolean }[] = c.headers ?? [];
  const secret = headers.filter((h) => h.secret && h.name).map((h) => h.name as string);
  const plainCredentials = headers.filter((h) => !h.secret && h.name && /auth|token|key|secret|password/i.test(h.name)).map((h) => h.name as string);
  let host = "";
  try {
    host = new URL(String(c.url ?? "")).host;
  } catch {
    /* invalid URL: the request shows it */
  }
  const payloadIsJson = /^\s*[[{]/.test(payload);
  return {
    task: {
      name: TASK_NAME,
      input: {
        url: String(c.url ?? ""),
        method: "POST",
        headers: Object.fromEntries(headers.filter((h) => !h.secret && h.name).map((h) => [h.name as string, String(h.value ?? "")])),
        payload: hasPlaceholder(payload) ? GENERIC_MESSAGE : payload,
        failOnResponseCodes: "400-599",
      },
      action: "dynatrace.automations:http-function",
      position: POSITION,
      description: "Issue an HTTP request to any API.",
      predecessors: [],
    },
    notes: [
      ...(hasPlaceholder(payload)
        ? [payloadIsJson ? `${PLACEHOLDER_NOTE} The classic payload was JSON; the generic text is not, so the receiver will likely reject it.` : PLACEHOLDER_NOTE]
        : []),
      ...(secret.length ? [`Secret ${secret.length === 1 ? "header" : "headers"} not copied (the Settings API does not return secrets): ${secret.join(", ")}. Add ${secret.length === 1 ? "it" : "them"} in the task.`] : []),
      ...(plainCredentials.length ? [`${plainCredentials.join(", ")} is stored in plain text in classic and is copied as is; anyone who can read the workflow sees it.`] : []),
      ...(c.useOAuth2 ? ["Classic used OAuth 2.0 client credentials; the HTTP request task does not get them."] : []),
      ...(host ? [`${host} must be allowed for outbound requests from Workflows.`] : []),
      ...(c.notifyClosedProblems ? [CLOSED_NOTE] : []),
    ],
  };
}

function buildTask(n: ClassicNotification): TaskBuild | null {
  switch (n.type) {
    case "EMAIL":
      return emailTask(n.config);
    case "SLACK":
      return slackTask(n.config);
    case "SERVICE_NOW":
      return n.config.sendIncidents ? serviceNowTask(n.config) : null;
    case "WEBHOOK":
      return n.config.urlContainsSecret ? null : webhookTask(n.config);
    default:
      return null;
  }
}

// --- Plan ---------------------------------------------------------------------------

/** What the trigger's custom filter is built from. */
export type TriggerSource = "rules" | "label";

export type WorkflowPlan = {
  row: NotificationRow;
  action: string;
  /** Source actually used (the label when the rules could not be translated). */
  source: TriggerSource;
  customFilter: string;
  filter: string;
  /** Translated rules (also when the label is used, so Validate can compare both); null = not translatable. */
  rules: string | null;
  /** DQL comparing the translated rules with the label on real problems (Validate). */
  query: string;
  notes: string[];
  /** Notes on the alerting profile translation (Gen 2 concepts, approximations, fallback). */
  profileNotes: Note[];
  body: Record<string, unknown>;
};
export type PlanResult = { plan: WorkflowPlan; problem: null } | { plan: null; problem: string; manual: boolean };

const LABEL_NOTE = "Filters on labels.alerting_profile, which the upgrade guide marks as deprecated.";

/** Problems over the last PROBLEM_DAYS days that the translated rules and the label each match (one row per problem first). */
export function compareQuery(rules: string | null, profile: string): string {
  const head = `fetch events, from:now()-${PROBLEM_DAYS}d\n| filter ${TRIGGER_BASE}`;
  const label = labelFilter(profile);
  if (rules === null) return `${head}\n| filter ${label}\n| summarize label = countDistinctExact(event.id)`;
  return [
    head,
    `| fieldsAdd rules = ${rules ? `coalesce((${rules}), false)` : "true"}, label = coalesce((${label}), false)`,
    '| summarize rules = max(toLong(rules)), label = max(toLong(label)), problem = takeAny(concat(display_id, " ", event.name)), by: { event.id }',
    "| summarize both = countIf(rules == 1 and label == 1), onlyRules = countIf(rules == 1 and label == 0), onlyLabel = countIf(rules == 0 and label == 1),",
    "    onlyRulesExamples = collectDistinct(if(rules == 1 and label == 0, problem), maxLength: 3), onlyLabelExamples = collectDistinct(if(rules == 0 and label == 1, problem), maxLength: 3)",
  ].join("\n");
}

/**
 * `names`: event names per classic event type (eventNames), needed to translate predefined event filters. With
 * source "rules", profiles that cannot be translated fall back to the label (noted in profileNotes). `timing` maps delays
 * to duration milestones (DelayTiming).
 */
export function planMigration(row: NotificationRow, duplicateName: boolean, source: TriggerSource, names: Map<string, string[]>, timing: DelayTiming): PlanResult {
  if (!row.enabled) return { plan: null, problem: "Disabled in classic; the migration converts enabled notifications only.", manual: false };
  if (!row.conversion.auto) return { plan: null, problem: row.conversion.reason, manual: true };
  if (!row.profileName || !row.profile) return { plan: null, problem: `Alerting profile ${row.profileId || "(none)"} not found; fix the notification in classic first.`, manual: true };
  if (row.managed) return { plan: null, problem: `Already migrated: workflow "${row.name}" exists.`, manual: false };
  if (row.workflow) return { plan: null, problem: "A workflow with this name exists and was not created by the migration; left unchanged.", manual: false };
  if (duplicateName) return { plan: null, problem: "Another selected notification has the same name; only the first one is migrated (workflows are matched by name).", manual: false };
  const built = buildTask(row);
  if (!built) return { plan: null, problem: "No conversion for this notification.", manual: true };

  const translation = translateProfile(row.profile, names, timing);
  // With the label, only the Gen 2 warnings of the translation still apply (the label handles delays and filters).
  const profileNotes: Note[] = translation.notes.filter((n) => source === "rules" || n.gen2);
  let rules = translation.ok ? translation.filter : null;
  if (rules !== null && triggerFilter(rules).length > FILTER_MAX) {
    profileNotes.push({ text: `The translated rules make the trigger filter longer than ${FILTER_MAX} characters.` });
    rules = null;
  }
  let used: TriggerSource = source;
  if (source === "rules" && rules === null) {
    used = "label";
    profileNotes.push({ text: `Rules not translated (${translation.ok ? "too long" : translation.reason}); the trigger uses the alerting profile label instead.` });
  }
  const customFilter = used === "rules" ? (rules ?? "") : labelFilter(row.profileName);
  const filter = triggerFilter(customFilter);
  if (filter.length > FILTER_MAX) return { plan: null, problem: `Trigger filter longer than ${FILTER_MAX} characters (alerting profile name too long).`, manual: true };
  if (used === "label") {
    profileNotes.push({ text: LABEL_NOTE });
    if (row.profileName.includes("*")) profileNotes.push({ text: "The alerting profile name contains *, which matchesValue treats as a wildcard.", approximate: true });
  }
  return {
    problem: null,
    plan: {
      row,
      action: row.conversion.label,
      source: used,
      customFilter,
      filter,
      rules,
      query: compareQuery(rules, row.profileName),
      notes: [...built.notes],
      profileNotes,
      // Same body as the migration workflow's create_workflows task; only customFilter (and filterQuery) differ.
      body: {
        type: "SIMPLE",
        input: {},
        tasks: { [TASK_NAME]: built.task },
        title: row.name,
        result: null,
        trigger: {
          eventTrigger: {
            isActive: true,
            filterQuery: filter,
            uniqueExpression: UNIQUE_EXPRESSION,
            triggerConfiguration: {
              type: "davis-problem",
              value: { categories: CATEGORIES, entityTags: {}, customFilter, analysisReady: true, onProblemClose: false, entityTagsMatch: "all" },
            },
          },
        },
        version: 1,
        throttle: { isLimitHit: false, limitEvents: [] },
        isPrivate: false,
        ownerType: "USER",
        isDeployed: true,
        description: MIGRATION_DESCRIPTION,
        triggerType: "Event",
        lastExecution: null,
        schemaVersion: 3,
        workflowLimit: { isActive: false },
        hourlyExecutionLimit: 1000,
        unacknowledgedSkippedScheduleAt: null,
      },
    },
  };
}

/** Plans for the selected rows; notifications that share a name after the first are skipped. */
export function planMigrations(rows: NotificationRow[], source: TriggerSource, names: Map<string, string[]>, timing: DelayTiming): { row: NotificationRow; result: PlanResult }[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    const dup = seen.has(row.name);
    seen.add(row.name);
    return { row, result: planMigration(row, dup, source, names, timing) };
  });
}

// --- Validate: event names, then rules vs label on real problems ----------------------------

async function runQuery(query: string): Promise<Record<string, unknown>[]> {
  const started = await queryExecutionClient.queryExecute({ body: { query, requestTimeoutMilliseconds: 30000 } });
  let { state, result } = started;
  while (state === "RUNNING" || state === "NOT_STARTED") {
    const p = await queryExecutionClient.queryPoll({ requestToken: started.requestToken ?? "", requestTimeoutMilliseconds: 30000 });
    state = p.state;
    result = p.result;
  }
  if (state !== "SUCCEEDED") throw new Error(`Query ${state.toLowerCase()}.`);
  return (result?.records ?? []).filter(Boolean) as Record<string, unknown>[];
}

/** Event names per classic event type used by the rows' profiles (one query; empty when none use predefined filters). */
export async function eventNames(rows: NotificationRow[]): Promise<Map<string, string[]>> {
  const types = Array.from(new Set(rows.flatMap((r) => (r.profile ? predefinedTypes(r.profile) : []))));
  if (!types.length) return new Map();
  const records = await runQuery(eventNamesQuery(types));
  return new Map(records.map((r) => [String(r["event.type"]), strings(r.names)]));
}

/** `problems`: what the trigger as built would have matched; the other counts compare the rules with the label. */
export type Preview = {
  ok: boolean;
  message: string;
  problems: number | null;
  compared: boolean;
  both: number;
  onlyRules: number;
  onlyLabel: number;
  onlyRulesExamples: string[];
  onlyLabelExamples: string[];
};

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : []);

export async function previewTrigger(plan: WorkflowPlan): Promise<Preview> {
  const empty = { both: 0, onlyRules: 0, onlyLabel: 0, onlyRulesExamples: [], onlyLabelExamples: [] };
  try {
    const r = (await runQuery(plan.query))[0] ?? {};
    if (plan.rules === null) {
      const label = Number(r.label ?? 0);
      return { ok: true, message: `${label} problems in the last ${PROBLEM_DAYS} days carry this alerting profile label.`, problems: label, compared: false, ...empty };
    }
    const both = Number(r.both ?? 0);
    const onlyRules = Number(r.onlyRules ?? 0);
    const onlyLabel = Number(r.onlyLabel ?? 0);
    return {
      ok: true,
      message: `Last ${PROBLEM_DAYS} days: the translated rules match ${both + onlyRules} problems, the alerting profile label ${both + onlyLabel} (${both} both).`,
      problems: plan.source === "rules" ? both + onlyRules : both + onlyLabel,
      compared: true,
      both,
      onlyRules,
      onlyLabel,
      onlyRulesExamples: strings(r.onlyRulesExamples),
      onlyLabelExamples: strings(r.onlyLabelExamples),
    };
  } catch (e) {
    return { ok: false, message: `Query failed: ${await errorFromResponse(e)}`, problems: null, compared: false, ...empty };
  }
}

// --- Writes -----------------------------------------------------------------------

export type MigrationResult = { name: string; ok: boolean; message: string; id?: string };

// --- Platform token for the `workflows` app function (mirrors api/workflows.function.ts) ----------------------------
export const WORKFLOW_CREDENTIAL = "architect-assistant-workflows";
export const WORKFLOW_TOKEN_SCOPES = ["automation:workflows:read", "automation:workflows:write"];
export const PLATFORM_TOKENS_URL = "https://myaccount.dynatrace.com/platformTokens";
export const WORKFLOW_TOKEN_DOCS: DocLink[] = [
  { title: "Platform tokens", url: "https://docs.dynatrace.com/docs/manage/identity-access-management/access-tokens-and-oauth-clients/platform-tokens" },
  { title: "Credential vault", url: "https://docs.dynatrace.com/docs/manage/credential-vault" },
];

type FnResult =
  | { status: "ok-status"; owner: string; ownerAccessOnly: boolean }
  | { status: "ok-create"; id: string }
  | { status: "no-credential" | "unauthorized" | "forbidden" | "rejected" | "error"; message: string };

/** functions.call keeps the HTTP response as `cause`; 404 = the function is not part of the running app. */
async function callWorkflows(data: Record<string, unknown>): Promise<FnResult> {
  try {
    const res = await functions.call("workflows", { data });
    return (await res.json()) as FnResult;
  } catch (e) {
    const res = (e as { cause?: unknown })?.cause;
    if (res instanceof Response) {
      if (res.status === 404) return { status: "error", message: "The workflows app function is not available in this running app (HTTP 404). Restart npx dt-app dev (or deploy), then retry." };
      const body = await res.text().catch(() => "");
      return { status: "error", message: `The workflows app function returned HTTP ${res.status}${body ? `: ${body.slice(0, 300)}` : ""}` };
    }
    return { status: "error", message: (e as Error)?.message ?? String(e) };
  }
}

export type WorkflowTokenStatus = { state: "ok"; owner: string; ownerAccessOnly: boolean } | { state: "missing" | "failing"; message: string };

/** Whether the function can read the token and list workflows with it. */
export async function readWorkflowTokenStatus(): Promise<WorkflowTokenStatus> {
  const r = await callWorkflows({ action: "status" });
  if (r.status === "ok-status") return { state: "ok", owner: r.owner, ownerAccessOnly: r.ownerAccessOnly };
  const message = "message" in r ? r.message : `Unexpected response (${r.status}).`;
  return { state: r.status === "no-credential" ? "missing" : "failing", message };
}

/** Stores (or replaces) the platform token in the credential vault. */
export async function storeWorkflowToken(token: string, ownerAccessOnly: boolean): Promise<SubmitResult> {
  const t = token.trim();
  if (!/^dt0s16\.[A-Za-z0-9]+\.[A-Za-z0-9]+$/.test(t)) return { ok: false, message: "That does not look like a platform token (dt0s16.XXXX.YYYY)." };
  const body = {
    name: WORKFLOW_CREDENTIAL,
    description: `Architect Assistant Problem notifications: platform token (${WORKFLOW_TOKEN_SCOPES.join(", ")}) used to create the migration workflows.`,
    type: "TOKEN" as const,
    token: t,
    scopes: ["APP_ENGINE" as const],
    // Owner only: just the person who stores it can create workflows. Off: every user of this app creates them as the token's user.
    ownerAccessOnly,
  };
  try {
    const list = await credentialVaultClient.listCredentials({ name: `"${WORKFLOW_CREDENTIAL}"`, type: "TOKEN" });
    const existing = (list.credentials ?? []).find((c) => c.name === WORKFLOW_CREDENTIAL);
    if (existing?.id) {
      await credentialVaultClient.updateCredentials({ id: existing.id, body });
      return { ok: true, message: `Credential "${WORKFLOW_CREDENTIAL}" updated.`, objectId: existing.id };
    }
    const res = await credentialVaultClient.createCredentials({ body });
    return { ok: true, message: `Credential "${WORKFLOW_CREDENTIAL}" created.`, objectId: res?.id };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}

/** One function call (one POST) per workflow (no bulk create); runs one at a time so each failure is reported per notification. */
export async function createWorkflows(plans: WorkflowPlan[], onProgress?: (done: number) => void): Promise<MigrationResult[]> {
  const out: MigrationResult[] = [];
  for (const p of plans) {
    const r = await callWorkflows({ action: "create", body: p.body });
    if (r.status === "ok-create") out.push({ name: p.row.name, ok: true, message: "Workflow created.", id: r.id || undefined });
    else out.push({ name: p.row.name, ok: false, message: `Creation failed: ${"message" in r ? r.message : r.status}` });
    onProgress?.(out.length);
  }
  return out;
}

// --- Manual guidance -----------------------------------------------------------------

export const manualMigrationAction: ManualAction = {
  id: "pn-manual",
  title: "Upgrade a problem notification manually (simple workflow)",
  steps: [
    "In Workflows, create a simple workflow with a Davis problem trigger and select the problem categories the alerting profile covered.",
    "Set the problem state: active for open-only notifications, active or closed if the classic notification also sent closed problems.",
    "Under Advanced options, turn on Wait for root cause analysis.",
    "Rebuild the alerting profile in the Additional custom filter on problem fields (tags, affected entities, event.name). It is ANDed with the categories and limited to 1,000 characters.",
    "Add the action for the integration (see the variants) and translate the classic placeholders to Jinja.",
    "Run the workflow next to the classic notification, compare what both send, then disable the classic notification.",
  ],
  variants: [
    {
      label: "Placeholders to Jinja",
      language: "text",
      code: [
        '{State}                       -> {{ event()["event.status"] }}',
        '{ProblemID}                   -> {{ event()["display_id"] }}',
        '{PID}                         -> {{ event()["event.id"] }}',
        '{ProblemTitle}                -> {{ event()["event.name"] }}',
        '{ProblemSeverity}             -> {{ event()["event.category"] }}',
        '{ProblemImpact}               -> {{ event()["dt.davis.impact_level"] }}',
        '{ImpactedEntity/ies}          -> {{ event()["smartscape.affected_entities"] }}',
        '{ProblemDetailsText/Markdown} -> {{ event()["event.description"] }}',
        "{ProblemDetailsJSON(v2)}      -> {{ event() | to_json }}",
        "{ProblemURL}                  -> {{ problem_link() }}",
        "{Tags}                        -> primary_tags.* fields",
        "{ProblemDetailsHTML}          -> not supported",
      ].join("\n"),
    },
    {
      label: "Integration to workflow action",
      language: "text",
      code: [
        "Email            -> Email (or Microsoft 365) connector",
        "Slack            -> Slack connector",
        "ServiceNow       -> ServiceNow connector",
        "Jira             -> Jira connector",
        "PagerDuty        -> PagerDuty connector",
        "Microsoft Teams  -> Microsoft Teams connector",
        "Ansible Tower    -> Red Hat Ansible connector",
        "OpsGenie         -> Jira Service Management connector or HTTP Request",
        "Custom webhook, xMatters, VictorOps, Trello -> HTTP Request",
      ].join("\n"),
    },
  ],
  notes: [
    "labels.alerting_profile is deprecated: workflows that still filter on it (profiles with a management zone, a regex or an unknown event type) should move to problem fields.",
    'To skip problems during maintenance windows, add maintenance.is_under_maintenance == false to the custom filter.',
    "Run the workflow as a service user, so it keeps working when the person who created it leaves.",
    "Delete disabled or stale classic notifications instead of upgrading them; one trigger can cover the filters of several alerting profiles.",
  ],
  docs: PN_DOCS,
};
