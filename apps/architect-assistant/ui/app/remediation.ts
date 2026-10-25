import {
  isRemoteConfigurationManagementValidationResultError,
  monitoredEntitiesCustomTagsClient,
  oneAgentRemoteConfigurationManagementClient,
  settingsObjectsClient,
} from "@dynatrace-sdk/client-classic-environment-v2";
import { httpClient } from "@dynatrace-sdk/http-client";

// ---------------------------------------------------------------------------
// Settings API remediations (write to the tenant). Both flows support a
// validate-only dry run and are only applied after an explicit user action.
// Schemas: builtin:ingest.enrichment.config and builtin:deployment.oneagent.updates
// (field names/enums read from the tenant with `dtctl get settings-schema`).
// Required scopes: settings:objects:read, settings:objects:write.
// ---------------------------------------------------------------------------

export const ENRICHMENT_SCHEMA = "builtin:ingest.enrichment.config";
export const UPDATES_SCHEMA = "builtin:deployment.oneagent.updates";

/** dt.security_context, dt.cost.costcenter, dt.cost.product, or primary_tags.<name>. */
export type EnrichmentTarget = string;

export const TARGET_OPTIONS: { value: EnrichmentTarget; label: string }[] = [
  { value: "dt.security_context", label: "Security context (dt.security_context)" },
  { value: "dt.cost.costcenter", label: "Cost center (dt.cost.costcenter)" },
  { value: "dt.cost.product", label: "Cost product (dt.cost.product)" },
];

export type EnrichmentType =
  | "CUSTOM"
  | "HOST_PROCESS_PROPERTY"
  | "K8S_NAMESPACE_LABEL"
  | "K8S_NAMESPACE_ANNOTATION"
  | "K8S_WORKLOAD_LABEL"
  | "K8S_WORKLOAD_ANNOTATION"
  | "K8S_POD_LABEL"
  | "K8S_POD_ANNOTATION"
  | "AWS_TAG"
  | "AZURE_TAG"
  | "GCP_LABEL"
  | "GCP_TAG";

export const TYPE_OPTIONS: {
  value: EnrichmentType;
  label: string;
  sourceLabel: string;
  sourcePlaceholder: string;
  /** Per the central enrichment reference, conditions apply to host/process and custom rules only. */
  supportsCondition: boolean;
}[] = [
  { value: "CUSTOM", label: "Fixed value (Custom)", sourceLabel: "Value to apply", sourcePlaceholder: "e.g. finance-prod", supportsCondition: true },
  { value: "HOST_PROCESS_PROPERTY", label: "Host/process property", sourceLabel: "Property key", sourcePlaceholder: "e.g. team", supportsCondition: true },
  { value: "K8S_NAMESPACE_LABEL", label: "Kubernetes namespace label", sourceLabel: "Label key", sourcePlaceholder: "e.g. team", supportsCondition: false },
  { value: "K8S_NAMESPACE_ANNOTATION", label: "Kubernetes namespace annotation", sourceLabel: "Annotation key", sourcePlaceholder: "e.g. owner", supportsCondition: false },
  { value: "K8S_WORKLOAD_LABEL", label: "Kubernetes workload label", sourceLabel: "Label key", sourcePlaceholder: "e.g. app.kubernetes.io/part-of", supportsCondition: false },
  { value: "K8S_WORKLOAD_ANNOTATION", label: "Kubernetes workload annotation", sourceLabel: "Annotation key", sourcePlaceholder: "e.g. owner", supportsCondition: false },
  { value: "K8S_POD_LABEL", label: "Kubernetes pod label", sourceLabel: "Label key", sourcePlaceholder: "e.g. team", supportsCondition: false },
  { value: "K8S_POD_ANNOTATION", label: "Kubernetes pod annotation", sourceLabel: "Annotation key", sourcePlaceholder: "e.g. owner", supportsCondition: false },
  { value: "AWS_TAG", label: "AWS tag", sourceLabel: "Tag key", sourcePlaceholder: "e.g. CostCenter", supportsCondition: false },
  { value: "AZURE_TAG", label: "Azure tag", sourceLabel: "Tag key", sourcePlaceholder: "e.g. CostCenter", supportsCondition: false },
  { value: "GCP_LABEL", label: "GCP label", sourceLabel: "Label key", sourcePlaceholder: "e.g. cost-center", supportsCondition: false },
  { value: "GCP_TAG", label: "GCP tag", sourceLabel: "Tag key", sourcePlaceholder: "e.g. cost-center", supportsCondition: false },
];

export type EnrichmentInput = {
  type: EnrichmentType;
  target: EnrichmentTarget;
  valueSource: string;
  condition: string;
};

export const typeMeta = (t: EnrichmentType) => TYPE_OPTIONS.find((o) => o.value === t) ?? TYPE_OPTIONS[0];

/** Settings object value for builtin:ingest.enrichment.config. */
export function buildEnrichmentValue(i: EnrichmentInput): Record<string, unknown> {
  const value: Record<string, unknown> = { type: i.type, target: i.target, valueSource: i.valueSource.trim() };
  const cond = i.condition.trim();
  if (cond && typeMeta(i.type).supportsCondition) value.condition = cond;
  return value;
}

/** Full POST body (one object, environment scope) so users can review or copy exactly what is sent. */
export function buildEnrichmentBody(i: EnrichmentInput) {
  return [{ schemaId: ENRICHMENT_SCHEMA, scope: "environment", value: buildEnrichmentValue(i) }];
}

export function checkEnrichmentInput(i: EnrichmentInput): string | null {
  const src = i.valueSource.trim();
  if (!src) return `${typeMeta(i.type).sourceLabel} is required.`;
  if (src.length > 2048) return "Value source must be at most 2048 characters.";
  if (/\s/.test(src) && i.type !== "CUSTOM") return "Keys cannot contain whitespace.";
  if (i.condition.trim().length > 500) return "Condition must be at most 500 characters.";
  return null;
}

export type SubmitResult = { ok: boolean; message: string; objectId?: string };

/** Pulls a readable message out of the SDK's error classes. */
export function errorMessage(e: unknown): string {
  const anyE = e as any;
  const data = anyE?.data;
  if (Array.isArray(data)) {
    const parts = data
      .map((d: any) => d?.error?.message ?? d?.error?.details?.map?.((x: any) => x?.message).filter(Boolean).join("; "))
      .filter(Boolean);
    if (parts.length) return parts.join(" | ");
  }
  return data?.error?.message ?? anyE?.message ?? String(e);
}

export async function submitEnrichmentRule(i: EnrichmentInput, validateOnly: boolean): Promise<SubmitResult> {
  try {
    const res = await settingsObjectsClient.postSettingsObjects({ body: buildEnrichmentBody(i), validateOnly });
    const first = res?.[0];
    if (first && first.code >= 400) return { ok: false, message: first.error?.message ?? `Rejected (HTTP ${first.code}).` };
    return validateOnly
      ? { ok: true, message: "Validation passed. The rule is valid and nothing was saved." }
      : { ok: true, message: "Rule created.", objectId: first?.objectId };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}

// --- OneAgent update policy (environment scope, single object) --------------

export type UpdateMode = "AUTOMATIC" | "AUTOMATIC_DURING_MW" | "MANUAL";
export type UpdateSetting = { objectId: string; updateMode: UpdateMode | string; targetVersion: string; updateToken?: string };

export async function readOneAgentUpdateSetting(): Promise<UpdateSetting | null> {
  const res = await settingsObjectsClient.getSettingsObjects({
    schemaIds: UPDATES_SCHEMA,
    scopes: "environment",
    fields: "objectId,value,updateToken",
  });
  const obj = res.items?.[0];
  if (!obj?.objectId) return null;
  const v = (obj.value ?? {}) as Record<string, any>;
  return { objectId: obj.objectId, updateMode: v.updateMode ?? "AUTOMATIC", targetVersion: v.targetVersion ?? "latest", updateToken: obj.updateToken };
}

/** Switch the environment-wide policy to automatic updates on the rolling "latest" target. */
export const AUTO_UPDATE_VALUE = { updateMode: "AUTOMATIC", targetVersion: "latest" } as const;

export async function applyAutoUpdates(existing: UpdateSetting | null, validateOnly: boolean): Promise<SubmitResult> {
  try {
    if (existing) {
      const res = await settingsObjectsClient.putSettingsObjectByObjectId({
        objectId: existing.objectId,
        body: { value: { ...AUTO_UPDATE_VALUE }, updateToken: existing.updateToken },
        validateOnly,
      });
      if (res && res.code >= 400) return { ok: false, message: res.error?.message ?? `Rejected (HTTP ${res.code}).` };
      return { ok: true, message: validateOnly ? "Validation passed. Nothing was saved." : "Auto-update policy updated.", objectId: existing.objectId };
    }
    const res = await settingsObjectsClient.postSettingsObjects({
      body: [{ schemaId: UPDATES_SCHEMA, scope: "environment", value: { ...AUTO_UPDATE_VALUE } }],
      validateOnly,
    });
    const first = res?.[0];
    if (first && first.code >= 400) return { ok: false, message: first.error?.message ?? `Rejected (HTTP ${first.code}).` };
    return { ok: true, message: validateOnly ? "Validation passed. Nothing was saved." : "Auto-update policy created.", objectId: first?.objectId };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}

// --- Ownership teams (builtin:ownership.teams) -------------------------------
// Field names and enums read from the tenant with `dtctl get settings-schema builtin:ownership.teams`.
// Creating teams uses ONE POST with an array body, however many teams are created.

export const TEAMS_SCHEMA = "builtin:ownership.teams";

export type Responsibilities = { development: boolean; infrastructure: boolean; lineOfBusiness: boolean; operations: boolean; security: boolean };
export const RESPONSIBILITY_LABELS: { key: keyof Responsibilities; label: string }[] = [
  { key: "development", label: "Development" },
  { key: "infrastructure", label: "Infrastructure" },
  { key: "operations", label: "Operations" },
  { key: "security", label: "Security" },
  { key: "lineOfBusiness", label: "Line of business" },
];

export type ContactType = "NONE" | "EMAIL" | "SLACK";
export type TeamInput = {
  name: string;
  identifier: string;
  description: string;
  responsibilities: Responsibilities;
  contactType: ContactType;
  contact: string;
};

export const emptyTeam = (identifier = ""): TeamInput => ({
  name: identifier,
  identifier,
  description: "",
  responsibilities: { development: false, infrastructure: false, lineOfBusiness: false, operations: false, security: false },
  contactType: "NONE",
  contact: "",
});

/** The schema forbids special characters and blanks, and requires an alphanumeric start and end (max 100). */
export const TEAM_ID_RE = /^[A-Za-z0-9]([A-Za-z0-9_-]{0,98}[A-Za-z0-9])?$/;

export function checkTeam(t: TeamInput, existing: string[]): string | null {
  if (!t.name.trim()) return "Team name is required.";
  if (t.name.length > 100) return "Team name must be at most 100 characters.";
  if (!TEAM_ID_RE.test(t.identifier)) return "Identifier: letters, digits, '-' or '_' only, starting and ending with a letter or digit (max 100).";
  if (existing.includes(t.identifier)) return "A team with this identifier (or supplementary identifier) already exists.";
  if (t.description.length > 500) return "Description must be at most 500 characters.";
  if (t.contactType === "EMAIL" && !/^\S+@\S+\.\S+$/.test(t.contact.trim())) return "Enter a valid email address.";
  if (t.contactType === "SLACK" && !t.contact.trim()) return "Enter a Slack channel.";
  return null;
}

export function buildTeamValue(t: TeamInput): Record<string, unknown> {
  const contactDetails =
    t.contactType === "EMAIL"
      ? [{ integrationType: "EMAIL", email: t.contact.trim() }]
      : t.contactType === "SLACK"
        ? [{ integrationType: "SLACK", slackChannel: t.contact.trim() }]
        : [];
  const value: Record<string, unknown> = {
    name: t.name.trim(),
    identifier: t.identifier,
    responsibilities: { ...t.responsibilities },
    contactDetails,
    links: [],
    additionalInformation: [],
    supplementaryIdentifiers: [],
  };
  if (t.description.trim()) value.description = t.description.trim();
  return value;
}

export const buildTeamsBody = (teams: TeamInput[]) => teams.map((t) => ({ schemaId: TEAMS_SCHEMA, scope: "environment", value: buildTeamValue(t) }));

export type ExistingTeam = { identifier: string; name: string; supplementary: string[] };

/** Existing teams (first 500). Read once and used to detect missing teams and duplicate identifiers. */
export async function listTeams(): Promise<ExistingTeam[]> {
  const res = await settingsObjectsClient.getSettingsObjects({ schemaIds: TEAMS_SCHEMA, scopes: "environment", fields: "objectId,value", pageSize: 500 });
  return (res.items ?? []).map((o) => {
    const v = (o.value ?? {}) as Record<string, any>;
    return {
      identifier: String(v.identifier ?? ""),
      name: String(v.name ?? ""),
      supplementary: Array.isArray(v.supplementaryIdentifiers) ? v.supplementaryIdentifiers.map((s: any) => String(s?.supplementaryIdentifier ?? "")).filter(Boolean) : [],
    };
  });
}

export const teamIdentifiers = (teams: ExistingTeam[]): string[] => teams.flatMap((t) => [t.identifier, ...t.supplementary]);

/** Creates all teams with a single POST. Reports how many were accepted when only some are. */
export async function createTeams(teams: TeamInput[], validateOnly: boolean): Promise<SubmitResult> {
  try {
    const res = await settingsObjectsClient.postSettingsObjects({ body: buildTeamsBody(teams), validateOnly });
    const failed = (res ?? []).filter((r) => r.code >= 400);
    if (failed.length === 0) {
      return { ok: true, message: validateOnly ? `Validation passed for ${teams.length} ${teams.length === 1 ? "team" : "teams"}. Nothing was saved.` : `Created ${teams.length} ${teams.length === 1 ? "team" : "teams"}.` };
    }
    return { ok: false, message: `${failed.length} of ${teams.length} rejected: ${failed[0]?.error?.message ?? `HTTP ${failed[0]?.code}`}` };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}

// --- OneAgent monitoring mode (builtin:host.monitoring.mode) -----------------
// Scope is the host entity ID, so changing N hosts is N objects in ONE POST (each object reports its own result).
// Enum values read from the tenant: FULL_STACK, INFRA_ONLY, DISCOVERY (Smartscape reports INFRASTRUCTURE for INFRA_ONLY).
// Note from the schema: the mode is stored on the agent, applied to a process after its restart, and the agent
// overwrites it if the mode is changed with oneagentctl or when the agent comes online.

export const MODE_SCHEMA = "builtin:host.monitoring.mode";
export type TargetMode = "FULL_STACK" | "INFRA_ONLY" | "DISCOVERY";
export const TARGET_MODES: { value: TargetMode; label: string; observed: string }[] = [
  { value: "FULL_STACK", label: "Full Stack", observed: "FULL_STACK" },
  { value: "INFRA_ONLY", label: "Infrastructure", observed: "INFRASTRUCTURE" },
  { value: "DISCOVERY", label: "Discovery", observed: "DISCOVERY" },
];

export const buildModeBody = (hostIds: string[], mode: TargetMode) =>
  hostIds.map((id) => ({ schemaId: MODE_SCHEMA, scope: id, value: { monitoringMode: mode } }));

/** Changes the monitoring mode of every listed host with a single request. */
export async function setMonitoringModes(hostIds: string[], mode: TargetMode, validateOnly: boolean): Promise<SubmitResult> {
  try {
    const res = await settingsObjectsClient.postSettingsObjects({ body: buildModeBody(hostIds, mode), validateOnly });
    const failed = (res ?? []).filter((r) => r.code >= 400);
    const label = TARGET_MODES.find((m) => m.value === mode)?.label ?? mode;
    if (failed.length === 0) {
      return {
        ok: true,
        message: validateOnly
          ? `Validation passed for ${hostIds.length} ${hostIds.length === 1 ? "host" : "hosts"}. Nothing was changed.`
          : `Monitoring mode set to ${label} on ${hostIds.length} ${hostIds.length === 1 ? "host" : "hosts"}. Hosts apply it when connected; restart monitored processes to pick it up.`,
      };
    }
    return { ok: false, message: `${failed.length} of ${hostIds.length} hosts rejected: ${failed[0]?.error?.message ?? `HTTP ${failed[0]?.code}`}` };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}

// --- Host group assignment via OneAgent remote configuration management ----
// ONE job for any number of hosts: the payload carries an `entities` array, so
// the whole change is validate (1-2 calls) + preview (1 call) + run (1 call),
// regardless of host count. Only one remote configuration job can run at a time.
// Scopes: fleet-management:oneagents:read / :write.

export const HOST_GROUP_RE = /^[A-Za-z0-9._-]+$/;
export const MAX_HOSTS_PER_JOB = 500;

export function checkHostGroupName(name: string): string | null {
  const n = name.trim();
  if (!n) return "Host group name is required.";
  if (n.length > 100) return "At most 100 characters.";
  if (n.toLowerCase().startsWith("dt.")) return "Must not start with dt.";
  if (!HOST_GROUP_RE.test(n)) return "Use letters, digits, hyphens, underscores and periods only.";
  return null;
}

export type HostGroupPlan = {
  ok: boolean;
  message: string;
  valid: string[];
  invalid: { entity: string; reasons: string[] }[];
  apiCalls: number;
  preview?: { alreadyConfigured: number; target: number };
};

const hostGroupOps = (group: string) => [{ attribute: "hostGroup" as const, operation: "set" as const, value: group.trim() }];

/** Validates (dropping hosts the API rejects, e.g. Operator-deployed) and previews. Does not change anything. */
export async function planHostGroupAssignment(entities: string[], group: string): Promise<HostGroupPlan> {
  let calls = 0;
  let valid = entities.slice(0, MAX_HOSTS_PER_JOB);
  let invalid: HostGroupPlan["invalid"] = [];
  const operations = hostGroupOps(group);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        calls++;
        await oneAgentRemoteConfigurationManagementClient.validateRemoteIdentityOperation_1({ body: { entities: valid, operations } });
        break;
      } catch (e) {
        if (attempt === 0 && isRemoteConfigurationManagementValidationResultError(e)) {
          const data = (e as any).data ?? {};
          const badOps = data.invalidOperations ?? [];
          if (badOps.length) return { ok: false, message: `Rejected: ${badOps[0]?.reason ?? "invalid operation"}`, valid: [], invalid, apiCalls: calls };
          invalid = (data.invalidEntities ?? []).map((b: any) => ({ entity: b.entity ?? "?", reasons: b.reasons ?? [] }));
          const badIds = new Set(invalid.map((b) => b.entity));
          valid = valid.filter((id) => !badIds.has(id));
          if (valid.length === 0) return { ok: false, message: "No selected host supports remote host group assignment.", valid, invalid, apiCalls: calls };
          continue; // re-validate the reduced list once
        }
        throw e;
      }
    }
    calls++;
    const pv = await oneAgentRemoteConfigurationManagementClient.createRemoteIdentityOperationPreview_1({ body: { entities: valid, operations } });
    const p = pv.previews?.[0];
    return {
      ok: true,
      message: `${valid.length} host${valid.length === 1 ? "" : "s"} can be reconfigured${invalid.length ? `, ${invalid.length} skipped` : ""}.`,
      valid,
      invalid,
      apiCalls: calls,
      preview: p ? { alreadyConfigured: p.alreadyConfiguredEntitiesCount ?? 0, target: p.targetEntitiesCount ?? valid.length } : undefined,
    };
  } catch (e) {
    return { ok: false, message: errorMessage(e), valid: [], invalid, apiCalls: calls };
  }
}

/** Runs the single remote configuration job. restart=false skips the automatic OneAgent restart. */
export async function runHostGroupAssignment(valid: string[], group: string, restart: boolean): Promise<SubmitResult> {
  try {
    const res = await httpClient.send({
      url: `/platform/classic/environment-api/v2/oneagents/remoteConfigurationManagement${restart ? "" : "?restart=false"}`,
      method: "POST",
      requestBodyType: "json",
      body: { entities: valid, operations: hostGroupOps(group) },
      headers: { "Content-Type": "application/json; charset=utf-8" },
      statusValidator: (status: number) => status === 201,
    });
    const job = (await res.body("json")) as { id?: string; totalEntitiesCount?: number } | undefined;
    return { ok: true, message: `Job started for ${job?.totalEntitiesCount ?? valid.length} hosts. Changes can take up to 10 minutes.`, objectId: job?.id };
  } catch (e) {
    const status = (e as any)?.response?.status;
    if (status === 409) return { ok: false, message: "Another remote configuration job is already running. Try again when it finishes." };
    return { ok: false, message: errorMessage(e) };
  }
}

// ---------------------------------------------------------------------------
// Documentation-backed manual remediations. Every link below was fetched and
// read while building this app; commands/steps are taken from those pages.
// ---------------------------------------------------------------------------

export type DocLink = { title: string; url: string };
export type ManualVariant = { label: string; language: string; code: string };
export type ManualAction = {
  id: string;
  title: string;
  steps: string[];
  /** Selectable alternatives (OS, object kind); the UI shows one at a time. */
  variants: ManualVariant[];
  notes?: string[];
  docs: DocLink[];
};

const DOC = {
  primaryTags: { title: "Primary Grail fields and tags", url: "https://docs.dynatrace.com/docs/manage/tags/primary-tags" },
  oneagentTags: { title: "OneAgent primary tags", url: "https://docs.dynatrace.com/docs/manage/tags/primary-tags/tags-domain-oneagent" },
  k8sTags: { title: "Kubernetes primary tags", url: "https://docs.dynatrace.com/docs/manage/tags/primary-tags/tags-domain-k8s" },
  central: { title: "Ingest enrichment rules", url: "https://docs.dynatrace.com/docs/manage/tags/tags-central-enrichment" },
  cli: { title: "oneagentctl reference", url: "https://docs.dynatrace.com/docs/ingest-from/dynatrace-oneagent/oneagent-configuration-via-command-line-interface" },
  update: { title: "OneAgent update", url: "https://docs.dynatrace.com/docs/setup-and-configuration/dynatrace-oneagent/oneagent-update" },
  remote: { title: "Remote configuration management", url: "https://docs.dynatrace.com/docs/ingest-from/bulk-configuration" },
  ownershipAssign: { title: "Assign ownership teams to monitored entities", url: "https://docs.dynatrace.com/docs/deliver/ownership/ownership-classic/assign-ownership" },
  ownershipSmartscape: { title: "Assign ownership teams to Smartscape nodes", url: "https://docs.dynatrace.com/docs/deliver/ownership/assign-team-ownership" },
  ownershipPractices: { title: "Best practices for entity ownership", url: "https://docs.dynatrace.com/docs/deliver/ownership/best-practices" },
  monitoringModes: { title: "Enable OneAgent monitoring modes", url: "https://docs.dynatrace.com/docs/platform/oneagent/monitoring-modes/enable-monitoring-modes" },
  remoteApi: { title: "Remote configuration API: POST job", url: "https://docs.dynatrace.com/docs/dynatrace-api/environment-api/remote-configuration/oneagent/post-config-job" },
} satisfies Record<string, DocLink>;

export const REMOTE_DOCS: DocLink[] = [DOC.remote, DOC.remoteApi];
export const ENRICHMENT_DOCS: DocLink[] = [DOC.central, DOC.oneagentTags, DOC.k8sTags, DOC.primaryTags];
export const UPDATE_DOCS: DocLink[] = [DOC.update];
export const MODE_DOCS: DocLink[] = [DOC.monitoringModes, DOC.cli];

const linuxWin = (cmd: string): ManualVariant[] => [
  { label: "Linux / AIX", language: "bash", code: `./oneagentctl ${cmd}` },
  { label: "Windows", language: "powershell", code: `.\\oneagentctl.exe ${cmd}` },
];

export const hostTagsAction = (field: string, example: string): ManualAction => ({
  id: `host-tag-${field}`,
  title: "Host tag with oneagentctl",
  steps: ["Open an elevated shell in the OneAgent tools directory.", "Run the command.", "Check with --get-host-tags."],
  variants: linuxWin(`--set-host-tag="${field}=${example}"`),
  notes: [
    "Values: no whitespace or extra '=', max 256 characters.",
    "Precedence: process DT_TAGS > host tag > central enrichment rule.",
  ],
  docs: [DOC.oneagentTags, DOC.cli],
});

export const k8sAnnotationAction = (field: string, example: string): ManualAction => ({
  id: `k8s-annotation-${field}`,
  title: "Kubernetes annotation",
  steps: ["Enable spec.metadataEnrichment in the DynaKube.", "Annotate the namespace (or workload / pod).", "Restart affected pods; verify with kubectl get pod -o yaml."],
  variants: [
    { label: "kubectl", language: "bash", code: `kubectl annotate namespace <namespace> metadata.dynatrace.com/${field}=${example} --overwrite` },
    { label: "YAML", language: "yaml", code: `metadata:\n  annotations:\n    metadata.dynatrace.com/${field}: ${example}` },
    { label: "DynaKube prerequisite", language: "yaml", code: "spec:\n  metadataEnrichment:\n    enabled: true" },
  ],
  notes: [
    "Pod > workload > namespace. Workload level needs Operator 1.11.0+ and ActiveGate 1.347+.",
    "Annotations > DynaKube resource attributes > central rules. Classic Full Stack is not supported.",
  ],
  docs: [DOC.k8sTags, DOC.central],
});

export const processTagAction = (name: string, example: string): ManualAction => ({
  id: `process-tag-${name}`,
  title: "Process tag with DT_TAGS",
  steps: ["Set DT_TAGS in the process environment before it starts.", "Restart the process.", "Prefer a central rule for values that apply host-wide."],
  variants: [{ label: "Linux / macOS", language: "bash", code: `DT_TAGS="primary_tags.${name}=${example}" java -jar app.jar` }],
  notes: ["Overrides the host-level value for the same key; useful for serverless where the host cannot be configured.", "Up to 20 primary tags per host or process; extras are dropped."],
  docs: [DOC.oneagentTags, DOC.central],
});

export const hostGroupManualAction: ManualAction = {
  id: "host-group-manual",
  title: "Host group with oneagentctl (single host)",
  steps: ["Open an elevated shell in the OneAgent tools directory.", "Run the command (restarts OneAgent).", "Restart monitored services; verify with --get-host-group."],
  variants: linuxWin("--set-host-group=MyHostGroup --restart-service"),
  notes: ["Name: letters, digits, hyphens, underscores, periods; no dt. prefix; max 100.", "Changing a host group recalculates process group IDs."],
  docs: [DOC.cli],
};

export const monitoringModeAction: ManualAction = {
  id: "monitoring-mode",
  title: "Monitoring mode with oneagentctl (single host)",
  steps: ["Identify hosts not in full-stack mode.", "Run the command on each host.", "Verify with --get-monitoring-mode."],
  variants: linuxWin("--set-monitoring-mode=fullstack --restart-service"),
  notes: ["Changes license consumption. Valid modes: fullstack, infra-only, discovery."],
  docs: [DOC.cli],
};

export const updatesUiAction: ManualAction = {
  id: "updates-ui",
  title: "Update overrides per host group / host",
  steps: [
    "Settings > Fleet management > OneAgent version and updates > Configure updates.",
    "For overrides, open Configure updates from the entity in Fleet Management.",
    "Restart monitored server processes after an update.",
  ],
  variants: [],
  notes: ["Host settings override host group settings, which override global settings. Update windows don't apply in Kubernetes."],
  docs: [DOC.update],
};

export const OWNERSHIP_DOCS: DocLink[] = [DOC.ownershipSmartscape, DOC.ownershipAssign, DOC.ownershipPractices];

export const ownerHostAction: ManualAction = {
  id: "owner-host",
  title: "Owner on a host (host property)",
  steps: ["Open an elevated shell in the OneAgent tools directory.", "Set the owner property to a team identifier.", "Check the host in Dynatrace after a few minutes."],
  variants: [
    { label: "Linux / AIX", language: "bash", code: "./oneagentctl --set-host-property owner-1=team-automation" },
    { label: "Windows", language: "powershell", code: ".\\oneagentctl.exe --set-host-property owner-1=team-automation" },
  ],
  notes: ["Needs OneAgent 1.189+. Use unique keys (owner-1, owner-2) for dual ownership.", "The value must be an existing team identifier or supplementary identifier."],
  docs: [DOC.ownershipAssign, DOC.ownershipSmartscape],
};

export const ownerK8sAction: ManualAction = {
  id: "owner-k8s",
  title: "Owner on Kubernetes objects (label)",
  steps: ["Label the Deployment (and ideally its pods) with an ownership key.", "Roll out so pods pick up the label.", "Use unique keys (dt.owner-1, dt.owner-2) for dual ownership."],
  variants: [
    { label: "kubectl", language: "bash", code: "kubectl label deployment <name> -n <namespace> dt.owner=team-automation --overwrite" },
    { label: "YAML", language: "yaml", code: "metadata:\n  labels:\n    dt.owner: team-automation" },
  ],
  notes: ["Deployment labels do not propagate to pods; pods need their own labels."],
  docs: [DOC.ownershipAssign, DOC.ownershipPractices],
};

export const ownerProcessAction: ManualAction = {
  id: "owner-process",
  title: "Owner on a process (environment variable)",
  steps: ["Set DT_CUSTOM_PROP in the process environment before it starts.", "Restart the process.", "Do not use tags for processes."],
  variants: [{ label: "Linux / macOS", language: "bash", code: "DT_CUSTOM_PROP=\"owner=team-automation\" java -jar app.jar" }],
  notes: ["Repeat the key for dual ownership, for example owner=team-automation owner=team-dev."],
  docs: [DOC.ownershipAssign],
};

// --- Owner tags on classic entities (frontends, synthetic monitors) -----------
// Classic web applications and synthetic monitors have no label/property map; ownership is a classic tag
// `<ownership key>:<team identifier>` (keys from builtin:ownership.config). POST /api/v2/tags takes an entity selector,
// so many entities are tagged per call: IDs are grouped by type (one type per selector) and chunked so the selector
// stays below its 2,000-character limit. The tags API has no dry run; Validate checks the input and the team instead.
// Scope: environment-api:entities:write.

const TAG_IDS_PER_CALL = 60;

export const OWNER_TAG_DOCS: DocLink[] = [DOC.ownershipAssign, DOC.ownershipPractices];

/** entityId(...) selectors: one entity type each, at most TAG_IDS_PER_CALL IDs. */
export function ownerTagSelectors(ids: string[]): string[] {
  const byType = new Map<string, string[]>();
  for (const id of ids) {
    const prefix = id.split("-")[0];
    byType.set(prefix, [...(byType.get(prefix) ?? []), id]);
  }
  const out: string[] = [];
  for (const group of byType.values()) {
    for (let i = 0; i < group.length; i += TAG_IDS_PER_CALL) {
      out.push(`entityId(${group.slice(i, i + TAG_IDS_PER_CALL).map((id) => `"${id}"`).join(",")})`);
    }
  }
  return out;
}

export const ownerTagBody = (key: string, value: string) => ({ tags: [{ key, value: value.trim() }] });

export function checkOwnerTag(value: string, teams: ExistingTeam[] | null): { error: string | null; warning: string | null } {
  const v = value.trim();
  if (!v) return { error: "Team identifier is required.", warning: null };
  if (v.length > 100) return { error: "At most 100 characters.", warning: null };
  if (teams && teams.length > 0 && !teamIdentifiers(teams).includes(v)) {
    return { error: null, warning: `"${v}" is not an identifier of an existing team; ownership only resolves once a team with that identifier exists.` };
  }
  return { error: null, warning: null };
}

/** Adds the owner tag to every listed entity (frontends, browser or HTTP monitors). */
export async function applyOwnerTag(ids: string[], key: string, value: string): Promise<SubmitResult> {
  const selectors = ownerTagSelectors(ids);
  let matched = 0;
  try {
    for (const entitySelector of selectors) {
      const res = await monitoredEntitiesCustomTagsClient.postTags({ entitySelector, from: "now-30d", body: ownerTagBody(key, value) });
      matched += res?.matchedEntitiesCount ?? 0;
    }
    return { ok: true, message: `Tag ${key}:${value.trim()} added to ${matched} of ${ids.length} ${ids.length === 1 ? "entity" : "entities"} (${selectors.length} API ${selectors.length === 1 ? "call" : "calls"}). Ownership updates within a few minutes.` };
  } catch (e) {
    return { ok: false, message: `${matched ? `Tagged ${matched} before the error. ` : ""}${errorMessage(e)}` };
  }
}
