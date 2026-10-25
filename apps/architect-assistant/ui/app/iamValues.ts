import { useEffect, useMemo, useState } from "react";
import { getCurrentUserDetails, getEnvironmentId } from "@dynatrace-sdk/app-environment";
import { httpClient } from "@dynatrace-sdk/http-client";
import { settingsSchemasClient } from "@dynatrace-sdk/client-classic-environment-v2";
import { useDqlWhen } from "./useDql";
import { listManagementZones } from "./segments";
import { listExtensions } from "./databases";
import { GLOBAL_HINTS, attributeOf, serviceOf, type CatalogIndex } from "./iamCatalog";
import {
  IAM_BUCKETS_QUERY,
  IAM_ENTITY_TYPES_QUERY,
  IAM_TABLES_QUERY,
  iamActiveGateGroupsQuery,
  iamEntityIdsQuery,
  iamEventFieldValuesQuery,
  iamFieldValuesQuery,
  iamLogSourcesQuery,
  iamMetricKeysQuery,
  iamProcessGroupNamesQuery,
  type Timeframe,
} from "./queries";

// ---------------------------------------------------------------------------
// Where the IAM tabs get suggestions for a condition's values: DQL over the tenant's data (record-level fields), platform
// APIs (installed apps, settings schemas, management zones, extensions), documented fixed values, or nothing (free
// text with a hint). Every picker also accepts typed values, binding parameters and the documented global attributes.
// Formats marked "not documented" are suggestions only: the IAM reference does not say which identifier the condition
// expects.
// ---------------------------------------------------------------------------

export type ValueOption = { value: string; label?: string; detail?: string };
type ApiSource = "apps" | "schemas" | "zones" | "extensions";
export type ValueSource =
  | { kind: "dql"; query: string; title: string; note: string }
  | { kind: "api"; api: ApiSource; note: string }
  | { kind: "static"; options: ValueOption[] }
  | { kind: "permissions" }
  | { kind: "none" };
export type ValueInfo = { source: ValueSource; hint?: string; placeholder?: string };

/** `${global:userId}` and `${global:userGroup}` (Policy global attributes) can stand in for any value. */
export const GLOBAL_ATTRIBUTES: ValueOption[] = [
  { value: "${global:userId}", label: "${global:userId}", detail: "UUID of the user making the request" },
  { value: "${global:userGroup}", label: "${global:userGroup}", detail: "UUIDs of the user's groups (use with IN)" },
];
export const bindParam = (name: string) => `\${bindParam:${name.trim().replace(/[^\w.-]/g, "-")}}`;

const fixed = (...values: string[]): ValueSource => ({ kind: "static", options: values.map((value) => ({ value })) });
const NOT_DOCUMENTED = "The IAM reference does not document the value format; ";

const ENTITY_TABLE: Record<string, "dt.entity.process_group" | "dt.entity.host" | "dt.entity.host_group"> = {
  "dev-obs:dt.entity.process_group": "dt.entity.process_group",
  "extensions:host": "dt.entity.host",
  "extensions:host-group": "dt.entity.host_group",
  "settings:entity.hostGroup": "dt.entity.host_group",
};

export function valueInfo(key: string, tf: Timeframe): ValueInfo {
  const attr = attributeOf(key);
  const field = (f: string, hint?: string): ValueInfo => ({
    source: { kind: "dql", query: iamFieldValuesQuery(tf, f), title: `IAM values: ${f}`, note: "Seen on Smartscape nodes, logs and spans (sampled) and metrics (max 10 days) in the selected timeframe." },
    hint,
  });
  if (key.startsWith("global:")) {
    const g = GLOBAL_HINTS[key];
    const env = safe(getEnvironmentId);
    const user = safe(getCurrentUserDetails);
    const options: ValueOption[] =
      key === "global:environmentId" && env
        ? [{ value: env, detail: "this environment" }]
        : key === "global:userId" && user
          ? [{ value: user.id, detail: `you (${user.name || user.email})` }]
          : key === "global:usernameDomain" && user?.email.includes("@")
            ? [{ value: user.email.split("@")[1], detail: "your domain" }]
            : (g?.values ?? []).map((value) => ({ value }));
    return { source: options.length ? { kind: "static", options } : { kind: "none" }, hint: g?.hint, placeholder: g?.placeholder };
  }
  if (ENTITY_TABLE[key]) {
    const t = ENTITY_TABLE[key];
    return {
      source: { kind: "dql", query: iamEntityIdsQuery(tf, t), title: `IAM values: ${t} IDs`, note: "Entity IDs with their names, first 1,000." },
      hint: key === "dev-obs:dt.entity.process_group" ? "Process group entity ID (PROCESS_GROUP-…)." : `${NOT_DOCUMENTED}suggestions are entity IDs (${t === "dt.entity.host" ? "HOST-…" : "HOST_GROUP-…"}), as used in Settings and monitoring configuration scopes.`,
    };
  }
  switch (key) {
    case "shared:app-id":
      return { source: { kind: "api", api: "apps", note: "Apps installed in this environment (App Registry)." }, hint: "App ID, e.g. dynatrace.notebooks." };
    case "app-engine:app-installer":
      return { source: fixed("${global:userId}"), hint: "UUID of the user that installed the app." };
    case "automation:workflow-type":
      return { source: fixed("SIMPLE", "STANDARD") };
    case "dev-obs:dt.process_group.detected_name":
      return { source: { kind: "dql", query: iamProcessGroupNamesQuery(tf), title: "IAM values: process group detected names", note: "Detected names of processes in the selected timeframe." } };
    case "dev-obs:host.group":
      return field("dt.host_group.id", "Host group name of the agents.");
    case "environment:management-zone":
    case "extensions:management-zone":
      return { source: { kind: "api", api: "zones", note: "Management zones of this environment (Settings)." }, hint: "Management zone name; startsWith and MATCH work on name patterns such as \"[Kubernetes]\"." };
    case "extensions:ag-group":
      return { source: { kind: "dql", query: iamActiveGateGroupsQuery(tf), title: "IAM values: ActiveGate groups", note: "ActiveGate groups seen in the selected timeframe." } };
    case "extensions:extension-name":
      return { source: { kind: "api", api: "extensions", note: "Extensions in this environment (Extensions API)." }, hint: "Extension name, e.g. com.dynatrace.extension.postgres." };
    case "iam-param:entity-type":
      return { source: fixed("group", "user") };
    case "iam:service-user-owner":
      return { source: fixed("${global:userId}"), hint: "UUID of the service user's owner; ${global:userId} allows service users owned by the caller." };
    case "oauth2:scopes":
      return { source: { kind: "permissions" }, hint: "Scopes requested for the generated OAuth clients." };
    case "openpipeline:event-type":
    case "openpipeline:event-provider": {
      const f = key === "openpipeline:event-type" ? "event.type" : "event.provider";
      return { source: { kind: "dql", query: iamEventFieldValuesQuery(tf, f), title: `IAM values: ${f}`, note: "Seen on events, business events and system events in the selected timeframe (5 GB scan cap)." } };
    }
    case "settings:schemaId":
      return { source: { kind: "api", api: "schemas", note: "Settings schemas of this environment." }, hint: "Schema ID, e.g. builtin:container.monitoring-rule; startsWith \"app:\" covers app schemas." };
    case "settings:schemaGroup":
      return { source: { kind: "none" }, hint: "Schema group, e.g. group:log-monitoring. Look up a schema's groups below.", placeholder: "group:…" };
    case "settings:scope":
      return { source: fixed("environment"), hint: "Exact scope: environment, or an entity ID such as HOST-48B8F52F33098830." };
  }
  if (serviceOf(key) !== "storage") {
    // Same attribute names as the storage fields (security context, Kubernetes, host) take the same values.
    return ["dt.security_context", "k8s.namespace.name", "k8s.cluster.name", "host.name"].includes(attr) ? field(attr) : { source: { kind: "none" } };
  }
  switch (attr) {
    case "bucket-name":
      return { source: { kind: "dql", query: IAM_BUCKETS_QUERY, title: "IAM values: Grail buckets", note: "Grail buckets of this environment with their table." }, hint: "MATCH (\"default_*\") covers every default bucket." };
    case "table-name":
      return { source: { kind: "dql", query: IAM_TABLES_QUERY, title: "IAM values: Grail tables", note: "Tables that have buckets." } };
    case "fieldset-name":
      return { source: fixed("builtin-sensitive-spans", "builtin-request-attributes-spans", "builtin-sensitive-user-events-and-sessions"), hint: "Predefined fieldsets; custom fieldsets are managed with the Grail Fieldsets API." };
    case "file-path":
      return { source: fixed("/lookups/", "/dt/"), hint: "Lookup data path; startsWith \"/lookups/\" covers every lookup file." };
    case "query-consumption":
      return { source: fixed("INCLUDED", "ON_DEMAND"), hint: "INCLUDED = only the included query timeframe of a bucket; ON_DEMAND = all retained data. Any other value is ignored." };
    case "store-name":
      return { source: { kind: "none" }, hint: "Name of an External Data Store." };
    case "entity.type":
      return { source: { kind: "dql", query: IAM_ENTITY_TYPES_QUERY, title: "IAM values: entity types", note: "Built-in entity types in upper snake case." }, hint: "Entity type in upper snake case, e.g. PROCESS_GROUP_INSTANCE." };
    case "event.kind":
    case "event.type":
    case "event.provider":
      return { source: { kind: "dql", query: iamEventFieldValuesQuery(tf, attr), title: `IAM values: ${attr}`, note: "Seen on events, business events and system events in the selected timeframe (5 GB scan cap)." } };
    case "log.source":
      return { source: { kind: "dql", query: iamLogSourcesQuery(tf), title: "IAM values: log sources", note: "Sampled logs in the selected timeframe." } };
    case "metric.key":
      return { source: { kind: "dql", query: iamMetricKeysQuery(tf), title: "IAM values: metric keys", note: "Metric keys with series in the timeframe (max 10 days), first 1,000; startsWith or MATCH cover families such as dt.host.*." } };
  }
  return field(attr, attr === "dt.security_context" ? "Values can be lists on a record; only MATCH matches any element of a list." : undefined);
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

// --- Platform API sources ------------------------------------------------------------------------------------------
export type InstalledApp = { id: string; name: string; builtin: boolean; /** Registry icon URL (PNG), relative to the platform. */ icon?: string; scopes: { name: string; comment: string }[] };

/** Installed apps with the scopes their manifest requests (one call, cached for the page load). */
let appsPromise: Promise<InstalledApp[]> | null = null;
export function loadInstalledApps(): Promise<InstalledApp[]> {
  appsPromise ??= httpClient
    .send({ url: "/platform/app-engine/registry/v1/apps?add-fields=manifest.scopes,isBuiltin", method: "GET" })
    .then((res) => res.body("json"))
    .then((body: any) =>
      ((body?.apps ?? []) as any[])
        .map((a) => ({
          id: String(a.id),
          name: String(a.name ?? a.id),
          builtin: !!a.isBuiltin,
          icon: typeof a.appIcon?.href === "string" ? String(a.appIcon.href) : undefined,
          scopes: ((a.manifest?.scopes ?? []) as any[]).map((s) => ({ name: String(s.name), comment: String(s.comment ?? "") })),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    )
    .catch((e) => {
      appsPromise = null;
      throw e;
    });
  return appsPromise;
}

const apiCache = new Map<ApiSource, Promise<ValueOption[]>>();
function loadApi(api: ApiSource): Promise<ValueOption[]> {
  let p = apiCache.get(api);
  if (!p) {
    p = (async (): Promise<ValueOption[]> => {
      switch (api) {
        case "apps":
          return (await loadInstalledApps()).map((a) => ({ value: a.id, label: a.name, detail: a.id }));
        case "schemas": {
          const res = await settingsSchemasClient.getAvailableSchemaDefinitions();
          return (res.items ?? []).map((s) => ({ value: String(s.schemaId), label: s.displayName ? String(s.displayName) : undefined, detail: String(s.schemaId) })).sort((a, b) => a.value.localeCompare(b.value));
        }
        case "zones":
          return (await listManagementZones()).map((z) => ({ value: z.name })).sort((a, b) => a.value.localeCompare(b.value));
        case "extensions":
          return (await listExtensions()).map((e) => ({ value: e.name, detail: e.version ? `active ${e.version}` : undefined })).sort((a, b) => a.value.localeCompare(b.value));
      }
    })();
    p.catch(() => apiCache.delete(api));
    apiCache.set(api, p);
  }
  return p;
}

/** Schema groups of one schema (group:…), from its definition; used by the settings:schemaGroup lookup. */
export async function schemaGroupsOf(schemaId: string): Promise<string[]> {
  const def = await settingsSchemasClient.getSchemaDefinition({ schemaId });
  return def.schemaGroups ?? [];
}

export type ConditionValues = { info: ValueInfo; options: ValueOption[]; loading: boolean; error: string | null; query: { title: string; text: string } | null };

const IDLE_QUERY = "data record(value = 1)";

/** Suggestions for one condition key; nothing is queried until `active` (the picker was opened). */
export function useConditionValues(key: string, tf: Timeframe, active: boolean, ix: CatalogIndex): ConditionValues {
  const info = useMemo(() => valueInfo(key, tf), [key, tf]);
  const src = info.source;
  const dql = useDqlWhen(src.kind === "dql" ? src.query : IDLE_QUERY, active && src.kind === "dql");
  const [api, setApi] = useState<{ options: ValueOption[]; error: string | null } | null>(null);
  const apiName = src.kind === "api" ? src.api : null;
  useEffect(() => {
    if (!apiName || !active) return;
    let cancelled = false;
    loadApi(apiName)
      .then((options) => !cancelled && setApi({ options, error: null }))
      .catch((e) => !cancelled && setApi({ options: [], error: (e as Error)?.message ?? String(e) }));
    return () => {
      cancelled = true;
    };
  }, [apiName, active]);
  const options = useMemo<ValueOption[]>(() => {
    switch (src.kind) {
      case "static":
        return src.options;
      case "permissions":
        return [...ix.permissions.keys()].sort().map((value) => ({ value }));
      case "api":
        return api?.options ?? [];
      case "dql":
        return (dql.data?.records ?? [])
          .filter((r) => r.value !== null && r.value !== undefined && String(r.value) !== "")
          .map((r) => ({
            value: String(r.value),
            label: r.label ? String(r.label) : undefined,
            detail: r.table ? String(r.table) : Array.isArray(r.sources) ? (r.sources as string[]).join(", ") : undefined,
          }));
      default:
        return [];
    }
  }, [src, api, dql.data, ix]);
  return {
    info,
    options,
    loading: active && ((src.kind === "dql" && dql.loading) || (src.kind === "api" && !api)),
    error: src.kind === "dql" ? dql.error : src.kind === "api" ? api?.error ?? null : null,
    query: src.kind === "dql" ? { title: src.title, text: src.query } : null,
  };
}
