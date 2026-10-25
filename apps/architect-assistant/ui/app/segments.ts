import { queryExecutionClient } from "@dynatrace-sdk/client-query";
import { settingsObjectsClient } from "@dynatrace-sdk/client-classic-environment-v2";
import { httpClient } from "@dynatrace-sdk/http-client";
import { ENTITY_TYPES_QUERY, mzMembershipQueries, segmentVariableQuery, type Timeframe } from "./queries";
import type { DocLink, ManualAction } from "./remediation";

// ---------------------------------------------------------------------------
// Management zone -> segment conversion. Same flow as the "MZ to Segments" workflow
// (find the MZ's entities, upload a lookup table, create a segment that reads it), with these fixes:
// - Entity types are discovered from dt.system.data_objects instead of a fixed list, so every type that
//   can carry managementZones (including SELECTOR-rule targets such as extension types) is included.
// - Smartscape node IDs are added through `id_classic`, so smartscapeNodes queries are scoped too
//   (process, container and Kubernetes IDs differ between the classic and Smartscape models).
// - No entity names are matched except frontend names of the MZ's own applications (names are not unique).
// - Lookup file paths are sanitised to the Resource Store rules and suffixed with a hash, so names with
//   ':' or other characters work and two names never share a file.
// - Segments are tagged with an externalId; refreshing re-uploads the lookup and PUTs the definition
//   (same UID, so dashboards and notebooks that use it keep working) instead of delete + recreate.
// - The app's own session is used; no bearer token is pasted into a script.
// API specs read from the tenant with `dtctl describe api "Grail - Filter Segments"` / "Grail - Resource Store".
// ---------------------------------------------------------------------------

export const MZ_SCHEMA = "builtin:management-zones";
const SEGMENTS_API = "/platform/storage/filter-segments/v1/filter-segments";
const LOOKUP_UPLOAD_API = "/platform/storage/resource-store/v1/files/tabular/lookup:upload";
const EXTERNAL_PREFIX = "architect-assistant-mz-";
const LOOKUP_DIR = "/lookups/architect_assistant/mz";

/** Segment API limits (docs: segments reference limits): 20 include blocks, 10 expressions per filter. */
const MAX_EXPRESSIONS = 10;
const NAME_MAX = 100;
const DESCRIPTION_MAX = 200;

export const SEGMENT_DOCS: DocLink[] = [
  { title: "Segments", url: "https://docs.dynatrace.com/docs/manage/segments" },
  { title: "Segment limits", url: "https://docs.dynatrace.com/docs/manage/segments/reference/segments-reference-limits" },
  { title: "Segment includes", url: "https://docs.dynatrace.com/docs/manage/segments/concepts/segments-concepts-includes" },
  { title: "Segment visibility and access", url: "https://docs.dynatrace.com/docs/manage/segments/concepts/segments-concepts-visibility" },
  { title: "Lookup data in Grail", url: "https://docs.dynatrace.com/docs/platform/grail/lookup-data" },
];

// --- Small helpers ------------------------------------------------------------

/** FNV-1a 32-bit, hex. Stable short ID per management zone name. */
export function nameHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Resource Store rules: [a-zA-Z0-9-_./] only, starts with /lookups, ends alphanumeric. */
export function lookupPath(mz: string): string {
  const slug = mz.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "mz";
  return `${LOOKUP_DIR}/${slug}_${nameHash(mz)}`;
}
export const externalIdFor = (mz: string) => `${EXTERNAL_PREFIX}${nameHash(mz)}`;

function errorMessage(e: unknown): string {
  const anyE = e as any;
  return anyE?.body?.error?.message ?? anyE?.data?.error?.message ?? anyE?.response?.statusText ?? anyE?.message ?? String(e);
}

async function errorFromResponse(e: unknown): Promise<string> {
  const res = (e as any)?.response;
  if (res?.body) {
    try {
      const b = (await res.body("json")) as any;
      const details = b?.error?.details?.constraintViolations?.map?.((v: any) => v?.message).filter(Boolean).join("; ");
      return [b?.error?.message, details].filter(Boolean).join(": ") || errorMessage(e);
    } catch {
      /* fall through */
    }
  }
  return errorMessage(e);
}

// --- Reads ---------------------------------------------------------------------

export type RuleType = "ME" | "SELECTOR" | "DIMENSION";
export type ManagementZone = { objectId: string; name: string; enabledRules: number; ruleTypes: Record<RuleType, number> };

/** Every management zone (Settings 2.0, paged). Disabled rules are not counted. */
export async function listManagementZones(): Promise<ManagementZone[]> {
  const out: ManagementZone[] = [];
  let nextPageKey: string | undefined;
  do {
    const res = await settingsObjectsClient.getSettingsObjects(
      nextPageKey ? { nextPageKey } : { schemaIds: MZ_SCHEMA, scopes: "environment", fields: "objectId,value", pageSize: 500 },
    );
    for (const o of res.items ?? []) {
      const v = (o.value ?? {}) as { name?: string; rules?: Array<{ type?: RuleType; enabled?: boolean }> };
      const rules = (v.rules ?? []).filter((r) => r.enabled !== false);
      const ruleTypes: Record<RuleType, number> = { ME: 0, SELECTOR: 0, DIMENSION: 0 };
      rules.forEach((r) => r.type && (ruleTypes[r.type] = (ruleTypes[r.type] ?? 0) + 1));
      if (v.name) out.push({ objectId: o.objectId ?? "", name: v.name, enabledRules: rules.length, ruleTypes });
    }
    nextPageKey = res.nextPageKey;
  } while (nextPageKey);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export type SegmentInfo = { uid: string; name: string; externalId?: string; owner: string; version: number; isPublic: boolean };

export async function listSegments(): Promise<SegmentInfo[]> {
  const res = await httpClient.send({ url: `${SEGMENTS_API}?add-fields=EXTERNALID`, method: "GET" });
  const body = (await res.body("json")) as { filterSegments?: any[] };
  return (body.filterSegments ?? []).map((s) => ({
    uid: String(s.uid),
    name: String(s.name ?? ""),
    externalId: s.externalId ?? undefined,
    owner: String(s.owner ?? ""),
    version: Number(s.version ?? 1),
    isPublic: !!s.isPublic,
  }));
}

/** Runs one DQL query to completion (execute + poll) with result limits raised for ID lists. */
async function runQuery(query: string): Promise<Record<string, any>[]> {
  const start = await queryExecutionClient.queryExecute({
    body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: 100000, maxResultBytes: 100_000_000 },
  });
  let { state, result } = start;
  while (state === "RUNNING" || state === "NOT_STARTED") {
    const p = await queryExecutionClient.queryPoll({ requestToken: start.requestToken ?? "", requestTimeoutMilliseconds: 30000 });
    state = p.state;
    result = p.result;
  }
  if (state !== "SUCCEEDED") throw new Error(`Query ${state.toLowerCase()}.`);
  return (result?.records ?? []).filter(Boolean) as Record<string, any>[];
}

// --- Membership discovery ------------------------------------------------------

/** One management zone's entities: classic IDs per type, Smartscape IDs and the MZ's frontend names. */
export type Membership = {
  zone: string;
  byType: Record<string, number>;
  ids: string[];
  smartscapeIds: string[];
  frontends: string[];
};

const compact = (a: unknown): string[] => (Array.isArray(a) ? a.filter((x): x is string => typeof x === "string" && x.length > 0) : []);

/**
 * Entity types are read first, then the membership queries run in parallel (one per chunk of types, kept
 * under DQL's 1000-expression limit). Returns the queries too, so the UI can expose them.
 */
export async function findMembership(tf: Timeframe, zones: string[]): Promise<{ memberships: Membership[]; queries: string[]; types: number }> {
  const types = (await runQuery(ENTITY_TYPES_QUERY)).map((r) => String(r.name));
  const queries = mzMembershipQueries(tf, types, zones);
  const results = await Promise.all(queries.map(runQuery));
  // The anchor type is fetched in every chunk, so counts come from distinct IDs, never from summed rows.
  const map = new Map<string, { byType: Map<string, Set<string>>; ids: Set<string>; sids: Set<string>; frontends: Set<string> }>();
  for (const r of results.flat()) {
    const zone = String(r.zone);
    const m = map.get(zone) ?? { byType: new Map(), ids: new Set(), sids: new Set(), frontends: new Set() };
    const prefix = String(r.prefix ?? "OTHER");
    const typeIds = m.byType.get(prefix) ?? new Set<string>();
    compact(r.ids).forEach((x) => {
      m.ids.add(x);
      typeIds.add(x);
    });
    m.byType.set(prefix, typeIds);
    compact(r.sids).forEach((x) => m.sids.add(x));
    compact(r.frontends).forEach((x) => m.frontends.add(x));
    map.set(zone, m);
  }
  const memberships = zones.map((zone) => {
    const m = map.get(zone);
    return {
      zone,
      byType: m ? Object.fromEntries(Array.from(m.byType, ([k, v]) => [k, v.size])) : {},
      ids: m ? Array.from(m.ids) : [],
      smartscapeIds: m ? Array.from(m.sids).filter((s) => !m.ids.has(s)) : [],
      frontends: m ? Array.from(m.frontends) : [],
    };
  });
  return { memberships, queries, types: types.length };
}

// --- Segment definition ----------------------------------------------------------

/**
 * Data fields matched against $ids, in priority order, with the entity-ID prefix that makes each one relevant.
 * Presence of each field on logs, spans, metrics, events and problems was measured on the demo tenant.
 */
const DATA_FIELDS: { field: string; prefix: string | null }[] = [
  { field: "dt.source_entity", prefix: null },
  { field: "dt.entity.host", prefix: "HOST" },
  { field: "dt.entity.service", prefix: "SERVICE" },
  { field: "dt.entity.process_group_instance", prefix: "PROCESS_GROUP_INSTANCE" },
  { field: "dt.entity.process_group", prefix: "PROCESS_GROUP" },
  { field: "dt.entity.kubernetes_cluster", prefix: "KUBERNETES_CLUSTER" },
  { field: "dt.entity.cloud_application_namespace", prefix: "CLOUD_APPLICATION_NAMESPACE" },
  { field: "dt.entity.cloud_application", prefix: "CLOUD_APPLICATION" },
  { field: "dt.entity.cloud_application_instance", prefix: "CLOUD_APPLICATION_INSTANCE" },
  { field: "dt.entity.kubernetes_node", prefix: "KUBERNETES_NODE" },
  { field: "dt.entity.custom_device", prefix: "CUSTOM_DEVICE" },
  { field: "dt.entity.container_group_instance", prefix: "CONTAINER_GROUP_INSTANCE" },
  { field: "dt.entity.ec2_instance", prefix: "EC2_INSTANCE" },
  { field: "dt.entity.application", prefix: "APPLICATION" },
  { field: "dt.entity.mobile_application", prefix: "MOBILE_APPLICATION" },
  { field: "dt.entity.custom_application", prefix: "CUSTOM_APPLICATION" },
  { field: "dt.entity.synthetic_test", prefix: "SYNTHETIC_TEST" },
  { field: "dt.entity.http_check", prefix: "HTTP_CHECK" },
  { field: "dt.entity.external_synthetic_test", prefix: "EXTERNAL_SYNTHETIC_TEST" },
];
/** RUM and synthetic fields, also offered on the events / metrics / user.events includes. */
const APP_PREFIXES = new Set(["APPLICATION", "MOBILE_APPLICATION", "CUSTOM_APPLICATION", "SYNTHETIC_TEST", "HTTP_CHECK", "EXTERNAL_SYNTHETIC_TEST"]);

type Statement = { key: string; variable: string };

/**
 * Filter AST in the format the Segments app stores (same structure as the workflow's payload):
 * `k1 in ($v) OR k2 in ($v) ...`, with character ranges into that text.
 */
export function buildFilter(statements: Statement[]): string {
  let pos = 0;
  const children = statements.map((s, i) => {
    if (i > 0) pos += 4; // " OR "
    const from = pos;
    const keyTo = from + s.key.length;
    const op = { type: "InclusionOperator", textValue: "in", value: "in", range: { from: keyTo + 1, to: keyTo + 3 } };
    const listFrom = keyTo + 4;
    const listText = `($${s.variable})`;
    const to = listFrom + listText.length;
    pos = to;
    return {
      type: "Statement",
      range: { from, to },
      key: { type: "Key", range: { from, to: keyTo }, textValue: s.key, value: s.key },
      operator: op,
      comparisonOperator: op,
      value: {
        type: "List",
        range: { from: listFrom, to },
        textValue: listText,
        value: [{ type: "Variable", range: { from: listFrom + 1, to: to - 1 }, textValue: `$${s.variable}`, value: `$${s.variable}`, variableType: "Any" }],
      },
    };
  });
  const multi = statements.length > 1;
  return JSON.stringify({
    type: "Group",
    range: { from: 0, to: pos },
    logicalOperator: multi ? "OR" : "AND",
    explicit: false,
    explicitLogicalOperator: multi,
    children,
    version: "004",
  });
}

export type SegmentPlan = {
  zone: string;
  path: string;
  externalId: string;
  body: Record<string, unknown>;
  lookup: { key: string; ids: string[]; frontends: string[] };
  includes: { dataObject: string; fields: string[] }[];
  dropped: string[];
};

export function planSegment(m: Membership, isPublic: boolean): SegmentPlan {
  const prefixes = new Set(Object.keys(m.byType));
  const relevant = DATA_FIELDS.filter((f) => f.prefix === null || prefixes.has(f.prefix));
  const allData = relevant.slice(0, MAX_EXPRESSIONS);
  const overflow = relevant.slice(MAX_EXPRESSIONS);
  const appFields = relevant.filter((f) => f.prefix && APP_PREFIXES.has(f.prefix));
  const includes: { dataObject: string; fields: string[]; statements: Statement[] }[] = [];
  const add = (dataObject: string, statements: Statement[]) => {
    if (statements.length) includes.push({ dataObject, fields: statements.map((s) => s.key), statements: statements.slice(0, MAX_EXPRESSIONS) });
  };
  const ids = (f: { field: string }) => ({ key: f.field, variable: "ids" });
  add("_all_data_object", allData.map(ids));
  // Signal-specific includes extend _all_data_object (include blocks are ORed) for RUM/synthetic fields and any overflow.
  const signalFields = Array.from(new Map([...appFields, ...overflow].map((f) => [f.field, f])).values()).map(ids);
  if (signalFields.some((s) => !allData.some((a) => a.field === s.key))) {
    add("events", signalFields);
    add("metrics", signalFields);
  }
  const userEvents: Statement[] = [];
  if (m.frontends.length) userEvents.push({ key: "frontend.name", variable: "frontends" });
  userEvents.push(...appFields.map(ids));
  add("user.events", userEvents);
  add("_all_entities", [{ key: "id", variable: "ids" }]);
  const covered = new Set(includes.flatMap((i) => i.statements.map((s) => s.key)));
  const dropped = relevant.map((f) => f.field).filter((f) => !covered.has(f));

  const path = lookupPath(m.zone);
  const externalId = externalIdFor(m.zone);
  const description = `Converted from management zone "${m.zone}" by Architect Assistant. Entity snapshot; refresh to pick up changes.`.slice(0, DESCRIPTION_MAX);
  return {
    zone: m.zone,
    path,
    externalId,
    lookup: { key: m.zone, ids: [...m.ids, ...m.smartscapeIds], frontends: m.frontends },
    includes: includes.map(({ dataObject, fields }) => ({ dataObject, fields })),
    dropped,
    body: {
      name: m.zone,
      description,
      externalId,
      isPublic,
      variables: { type: "query", value: segmentVariableQuery(path) },
      includes: includes.map((i) => ({ dataObject: i.dataObject, filter: buildFilter(i.statements) })),
    },
  };
}

/** Why a management zone cannot be converted, or null when it can. */
export function planProblem(m: Membership, existing: SegmentInfo | undefined): string | null {
  if (m.zone.length > NAME_MAX) return `Name longer than ${NAME_MAX} characters (segment name limit).`;
  if (m.ids.length === 0) return "No entities found in this management zone for the selected timeframe.";
  if (existing && existing.externalId !== externalIdFor(m.zone)) return "A segment with this name exists and was not created by this app; left unchanged.";
  return null;
}

// --- Writes -----------------------------------------------------------------------

export type ConvertResult = { zone: string; ok: boolean; message: string; uid?: string };

async function uploadLookup(plan: SegmentPlan): Promise<number> {
  const res = await httpClient.send({
    url: LOOKUP_UPLOAD_API,
    method: "POST",
    requestBodyType: "form-data",
    body: [
      {
        type: "json",
        name: "request",
        filename: "request.json",
        value: {
          filePath: plan.path,
          parsePattern: "JSON:payload",
          lookupField: "key",
          overwrite: true,
          autoFlatten: true,
          displayName: `Management zone ${plan.zone}`.slice(0, 500),
          description: `Entity IDs of management zone "${plan.zone}" (Architect Assistant).`.slice(0, 500),
        },
      },
      { type: "json", name: "content", filename: "content.json", value: plan.lookup },
    ],
  });
  const out = (await res.body("json")) as { records?: number };
  return Number(out?.records ?? 0);
}

/**
 * Converts one management zone: uploads its lookup (overwrite) and creates the segment, or, if this app
 * created it before, PUTs the definition with optimistic locking so the UID stays the same.
 */
export async function convertZone(plan: SegmentPlan, existing: SegmentInfo | undefined): Promise<ConvertResult> {
  try {
    const records = await uploadLookup(plan);
    if (records !== 1) return { zone: plan.zone, ok: false, message: `Lookup upload stored ${records} records (expected 1).` };
  } catch (e) {
    return { zone: plan.zone, ok: false, message: `Lookup upload failed: ${await errorFromResponse(e)}` };
  }
  try {
    if (existing) {
      await httpClient.send({
        url: `${SEGMENTS_API}/${encodeURIComponent(existing.uid)}?optimistic-locking-version=${existing.version}`,
        method: "PUT",
        requestBodyType: "json",
        body: { ...plan.body, uid: existing.uid, owner: existing.owner },
      });
      return { zone: plan.zone, ok: true, message: "Lookup refreshed and segment definition updated.", uid: existing.uid };
    }
    const res = await httpClient.send({ url: SEGMENTS_API, method: "POST", requestBodyType: "json", body: plan.body });
    const created = (await res.body("json")) as { uid?: string };
    return { zone: plan.zone, ok: true, message: "Segment created.", uid: created?.uid };
  } catch (e) {
    return { zone: plan.zone, ok: false, message: `Lookup stored, segment ${existing ? "update" : "creation"} failed: ${await errorFromResponse(e)}` };
  }
}

/** Runs conversions one zone at a time (two calls each), so a failure is reported per zone. */
export async function convertZones(plans: SegmentPlan[], existing: Map<string, SegmentInfo>, onProgress?: (done: number) => void): Promise<ConvertResult[]> {
  const out: ConvertResult[] = [];
  for (const p of plans) {
    out.push(await convertZone(p, existing.get(p.zone)));
    onProgress?.(out.length);
  }
  return out;
}

// --- Manual guidance -----------------------------------------------------------------

export const ruleBasedAction: ManualAction = {
  id: "segments-rule-based",
  title: "Replace the snapshot with rule-based segments",
  steps: [
    "Open the management zone's rules and note what they key on (host group, Kubernetes namespace or cluster, tags, cloud account).",
    "Make sure that attribute exists as a primary Grail field on the data (host group, k8s.*, primary_tags.*, cloud fields; see the other tabs).",
    "Create a segment in the Segments app filtering on those fields (one include for all data types where possible).",
    "Delete the converted snapshot segment once the rule-based one returns the same data.",
  ],
  variants: [
    {
      label: "Example include",
      language: "text",
      code: 'dt.host_group.id = "prod-checkout" OR k8s.namespace.name = "checkout"',
    },
  ],
  notes: [
    "A converted segment is a snapshot of entity IDs; new entities are only added when it is refreshed here.",
    "Segments do not restrict data access. Management zone permissions must be replaced with IAM policies (for example on dt.security_context).",
    "Management zone DIMENSION rules (metric or log dimensions) are not entity based and cannot be converted; recreate them as segment filters.",
  ],
  docs: SEGMENT_DOCS,
};
