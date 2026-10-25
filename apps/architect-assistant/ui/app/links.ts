import { getAppLink, getIntentLink } from "@dynatrace-sdk/navigation";

/**
 * A management zone's configuration in the Settings app. `deprecated_open_settings_by_id` is the only Settings
 * intent that opens a single object by ID (read from the tenant with `dtctl get apps dynatrace.settings`).
 */
export function managementZoneSettingsLink(objectId: string): string | undefined {
  if (!objectId) return undefined;
  try {
    return getIntentLink({ "dt.settings.object_id": objectId }, "dynatrace.settings", "deprecated_open_settings_by_id");
  } catch {
    return undefined;
  }
}

/** The Segments app. It publishes no intents or page tokens, so a single segment cannot be deep-linked. */
export function segmentsAppLink(): string | undefined {
  try {
    return getAppLink("dynatrace.segments.management");
  } catch {
    return undefined;
  }
}

// Overview page of each Smartscape entity type. Intent IDs and required properties were read from the
// tenant with `dtctl get intents --app <app>`. Hosts and process groups take the classic entity ID
// (HOST-<id>, PROCESS_GROUP-<id>) as `meId`; the others take the Smartscape node ID as `nodeId`.
const TARGETS: Record<string, { app: string; intent: string; prop: "meId" | "nodeId" }> = {
  HOST: { app: "dynatrace.infraops", intent: "view_host", prop: "meId" },
  PROCESS: { app: "dynatrace.infraops", intent: "view_smartscape_process", prop: "nodeId" },
  PROCESS_GROUP: { app: "dynatrace.infraops", intent: "view_process_group", prop: "meId" },
  CONTAINER: { app: "dynatrace.infraops", intent: "view_smartscape_container", prop: "nodeId" },
  SERVICE: { app: "dynatrace.services", intent: "view-entity-dt.smartscape.service", prop: "nodeId" },
  K8S_CLUSTER: { app: "dynatrace.kubernetes", intent: "view-entity-dt.smartscape.k8s_cluster", prop: "nodeId" },
  K8S_NODE: { app: "dynatrace.kubernetes", intent: "view-entity-dt.smartscape.k8s_node", prop: "nodeId" },
  K8S_NAMESPACE: { app: "dynatrace.kubernetes", intent: "view-entity-dt.smartscape.k8s_namespace", prop: "nodeId" },
  K8S_DEPLOYMENT: { app: "dynatrace.kubernetes", intent: "view-entity-dt.smartscape.k8s_deployment", prop: "nodeId" },
  K8S_POD: { app: "dynatrace.kubernetes", intent: "view-entity-dt.smartscape.k8s_pod", prop: "nodeId" },
  K8S_STATEFULSET: { app: "dynatrace.kubernetes", intent: "view-entity-dt.smartscape.k8s_statefulset", prop: "nodeId" },
  K8S_DAEMONSET: { app: "dynatrace.kubernetes", intent: "view-entity-dt.smartscape.k8s_daemonset", prop: "nodeId" },
  K8S_JOB: { app: "dynatrace.kubernetes", intent: "view-entity-dt.smartscape.k8s_job", prop: "nodeId" },
  K8S_CRONJOB: { app: "dynatrace.kubernetes", intent: "view-entity-dt.smartscape.k8s_cronjob", prop: "nodeId" },
  K8S_REPLICASET: { app: "dynatrace.kubernetes", intent: "view-entity-dt.smartscape.k8s_replicaset", prop: "nodeId" },
  K8S_DYNAKUBE: { app: "dynatrace.kubernetes", intent: "view-entity-dt.smartscape.k8s_dynakube", prop: "nodeId" },
  // Managed clusters from the cloud integrations open in the Clouds app (dtctl get intents --app dynatrace.clouds); GKE has no intent.
  AWS_EKS_CLUSTER: { app: "dynatrace.clouds", intent: "view_aws_service", prop: "nodeId" },
  AZURE_MICROSOFT_CONTAINERSERVICE_MANAGEDCLUSTERS: { app: "dynatrace.clouds", intent: "view_azure_service", prop: "nodeId" },
};

const HOURS: Record<string, number> = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30 };

/**
 * `dt.timeframe` for intent payloads (ISO from/to). Without it the target app opens on its own default (often the last
 * 2 hours), where a process that only ran earlier in the selected window shows nothing.
 */
export function timeframePayload(tf?: string): { "dt.timeframe": { from: string; to: string } } | Record<string, never> {
  const h = tf ? HOURS[tf] : undefined;
  if (!h) return {};
  const to = new Date();
  return { "dt.timeframe": { from: new Date(to.getTime() - h * 3_600_000).toISOString(), to: to.toISOString() } };
}

const intentLink = (props: Record<string, unknown>, app: string, intent: string): string | undefined => {
  try {
    return getIntentLink(props, app, intent);
  } catch {
    return undefined;
  }
};

/** URL of the entity's overview page in the owning app (for the given timeframe), or undefined when the type has no known overview. */
export function entityOverviewLink(type: string, id: string, tf?: string): string | undefined {
  const t = TARGETS[type];
  if (!t || !id) return undefined;
  return intentLink({ [t.prop]: id, ...timeframePayload(tf) }, t.app, t.intent);
}

/**
 * Pages that show a process's own monitoring state (deep monitoring, restart notices), for confirming a derived
 * "restart required" before acting. Intents read from the tenant with `dtctl get intents`. Infrastructure & Operations
 * resolves processes by Smartscape node ID (`view_process` with the classic ID opened an empty page); the classic
 * process page and OneAgent diagnostics take classic IDs.
 */
export function processStatePages(p: { id: string; sid?: string; host?: string }, tf?: string): { label: string; url: string }[] {
  const time = timeframePayload(tf);
  const pages = [
    { label: "Process (Infrastructure & Operations)", url: p.sid ? intentLink({ nodeId: p.sid, ...time }, "dynatrace.infraops", "view_smartscape_process") : undefined },
    { label: "Process page (classic)", url: intentLink({ "dt.entity.process_group_instance": p.id, ...time }, "dynatrace.classic.technologies", "view-process-group-instance") },
    { label: "OneAgent diagnostics for the host", url: p.host ? intentLink({ "dt.entity.host": p.host }, "dynatrace.classic.mda", "view-oneagent-diagnostics") : undefined },
  ];
  return pages.filter((x): x is { label: string; url: string } => !!x.url);
}

// ActiveGates have no per-ActiveGate intent: Fleet Management publishes only install / list intents and the classic
// Deployment Status app a page token `activegates` (read with `dtctl get intents` / `dtctl describe app`).
const appLink = (app: string, page?: string): string | undefined => {
  try {
    return getAppLink(app, page);
  } catch {
    return undefined;
  }
};
export const fleetManagementLink = () => appLink("dynatrace.fleet.management");
export const deploymentStatusActiveGatesLink = () => appLink("dynatrace.classic.deployment.status", "activegates");

/** Page of an extension monitoring configuration (classic entity CUSTOM_DEVICE-… from dt.entity.extensions:configuration). */
export const extensionConfigLink = (entityId?: string) =>
  entityId ? intentLink({ "dt.entity.extensions:configuration": entityId }, "dynatrace.classic.technologies", "view-extensions--configuration") : undefined;
/** A host group (HOST_GROUP-…) in Infrastructure & Operations (`dtctl get intents`: view_host_group, dt.entity.host_group). */
export const hostGroupLink = (hostGroupId?: string, tf?: string) =>
  hostGroupId ? intentLink({ "dt.entity.host_group": hostGroupId, ...timeframePayload(tf) }, "dynatrace.infraops", "view_host_group") : undefined;
/** The extension in the Extensions app (monitoring configurations, health). */
export const extensionAppLink = (extensionName: string) =>
  extensionName.includes(".") ? intentLink({ extensionName, isInstalled: true }, "dynatrace.extensions.manager", "go-to-extensions-manager-from-hub") : undefined;

// Databases tab (intents and app IDs read with `dtctl get intents` / `dtctl get apps`).
/** A DB instance (Smartscape DB_INSTANCE_<TECH>-…) in the Databases app, detail view open. */
export const dbInstanceLink = (instanceId?: string) =>
  instanceId ? intentLink({ "dt.smartscape.db_instance_id": instanceId }, "dynatrace.database.overview", "view-instance-details") : undefined;
/** The Databases app (Add DB instance is the documented onboarding path for a database extension). */
export const databasesAppLink = () => appLink("dynatrace.database.overview");
export const credentialVaultLink = () => appLink("dynatrace.classic.credential.vault");
/** Dynatrace Hub searched for an extension that is not in the environment yet. */
export const hubSearchLink = (searchTerm: string) => intentLink({ searchTerm }, "dynatrace.hub", "search_in_catalog");

// Classic entities without a Smartscape overview page here: frontends open in Experience Vitals, synthetic monitors in
// the Synthetic app (intents read with `dtctl get intents`).
const CLASSIC_TARGETS: Record<string, { app: string; intent: string; prop: string }> = {
  APPLICATION: { app: "dynatrace.experience.vitals", intent: "view-frontend", prop: "frontend" },
  SYNTHETIC_TEST: { app: "dynatrace.synthetic", intent: "view_browser_monitor", prop: "dt.entity.synthetic_test" },
  HTTP_CHECK: { app: "dynatrace.synthetic", intent: "view_http_monitor", prop: "dt.entity.http_check" },
};

/** Overview page of a classic frontend (APPLICATION-…) or synthetic monitor (SYNTHETIC_TEST-…, HTTP_CHECK-…). */
export function classicEntityLink(id: string): string | undefined {
  const t = CLASSIC_TARGETS[id.split("-")[0]];
  if (!t) return undefined;
  try {
    return getIntentLink({ [t.prop]: id }, t.app, t.intent);
  } catch {
    return undefined;
  }
}
