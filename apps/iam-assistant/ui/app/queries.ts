// All DQL for the app lives here. Every query carries an explicit `from:` timeframe.
// Copied from Architect Assistant (apps/architect-assistant/ui/app/queries.ts), IAM sections only.

export type Timeframe = "24h" | "7d" | "30d";
export const TIMEFRAMES: { label: string; value: Timeframe }[] = [
  { label: "Last 24 hours", value: "24h" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
];
export const DEFAULT_TIMEFRAME: Timeframe = "24h";

const from = (tf: Timeframe) => `from:now()-${tf}`;

export const SCAN_CAP_GB = 5;
// Only logs and spans support sampling (events/bizevents ignore the ratio).
const LOG_SAMPLING: Record<Timeframe, number> = { "24h": 10000, "7d": 100000, "30d": 100000 };

// --- IAM Policy Creator / IAM Boundary Creator: condition values seen in the tenant ---------------------------------
// Suggestions for condition values; every picker also takes free text. Validated with dtctl on the demo tenant,
// 2026-10-24: a field query takes < 1 s for 24h and ~7 s (1.1 GB scanned) for 30d, so each one runs only when its picker
// is opened. The `metrics` command reads at most the last 10 days (INVALID_METRICS_TIMEFRAME otherwise). Values can be
// arrays (dt.security_context), hence `expand`; `sources` says where a value was seen.
const iamMetricsFrom = (tf: Timeframe) => (tf === "30d" ? "from:now()-10d" : from(tf));
const iamValueTail = `| expand v
| summarize n = sum(n), sources = collectDistinct(src), by:{value = toString(v)}
| sort n desc
| limit 500`;

/** Values of a record-level field (security context, host group, Kubernetes, cloud accounts, …) on Smartscape nodes, logs, spans and metrics. */
export const iamFieldValuesQuery = (tf: Timeframe, field: string) => {
  const f = `\`${field}\``;
  const part = (head: string, src: string) => `${head}
    | filter isNotNull(${f})
    | summarize n = count(), by:{v = ${f}}
    | fieldsAdd src = "${src}"`;
  return `${part(`smartscapeNodes "*", ${from(tf)}`, "Smartscape").replace(/\n {4}/g, "\n")}
| append [${part(`fetch logs, ${from(tf)}, samplingRatio:${LOG_SAMPLING[tf]}, scanLimitGBytes:${SCAN_CAP_GB}`, "logs")}]
| append [${part(`fetch spans, ${from(tf)}, samplingRatio:${LOG_SAMPLING[tf]}, scanLimitGBytes:${SCAN_CAP_GB}`, "spans")}]
| append [${part(`metrics ${iamMetricsFrom(tf)}`, "metrics")}]
${iamValueTail}`;
};

/** event.kind / event.type / event.provider values on events, business events and system events. */
export const iamEventFieldValuesQuery = (tf: Timeframe, field: "event.kind" | "event.type" | "event.provider") => {
  const part = (table: string) => `fetch ${table}, ${from(tf)}, scanLimitGBytes:${SCAN_CAP_GB} | summarize n = count(), by:{v = ${field}} | fieldsAdd src = "${table}"`;
  return `${part("events")}
| append [${part("bizevents")}]
| append [${part("dt.system.events")}]
| filter isNotNull(v)
${iamValueTail}`;
};

export const iamLogSourcesQuery = (tf: Timeframe) => `fetch logs, ${from(tf)}, samplingRatio:${LOG_SAMPLING[tf]}, scanLimitGBytes:${SCAN_CAP_GB}
| filter isNotNull(log.source)
| summarize n = count(), by:{value = toString(log.source)}
| sort n desc
| limit 500`;

/** Metric keys with series in the timeframe (at most 10 days); the result is capped at 1,000 rows. */
export const iamMetricKeysQuery = (tf: Timeframe) => `metrics ${iamMetricsFrom(tf)}
| summarize n = count(), by:{value = metric.key}
| sort value asc`;

/** Grail buckets with their table; `label` is the display name. */
export const IAM_BUCKETS_QUERY = `fetch dt.system.buckets
| fields value = name, table = dt.system.table, label = display_name
| sort table asc, value asc`;

export const IAM_TABLES_QUERY = `fetch dt.system.buckets
| summarize n = count(), by:{value = dt.system.table}
| sort value asc`;

/** Built-in entity types in the upper snake case storage:entity.type expects (PROCESS_GROUP_INSTANCE); generic (custom) types are left out. */
export const IAM_ENTITY_TYPES_QUERY = `fetch dt.system.data_objects
| filter startsWith(name, "dt.entity.") and not(contains(name, ":"))
| fields value = upper(substring(name, from:10))
| sort value asc`;

export const iamProcessGroupNamesQuery = (tf: Timeframe) => `smartscapeNodes "PROCESS", ${from(tf)}
| filter isNotNull(dt.process_group.detected_name)
| summarize n = count(), by:{value = toString(dt.process_group.detected_name)}
| sort n desc
| limit 500`;

/** Classic entity IDs with their names, for conditions that take an ID (process group, host, host group). */
export const iamEntityIdsQuery = (tf: Timeframe, table: "dt.entity.process_group" | "dt.entity.host" | "dt.entity.host_group") => `fetch ${table}, ${from(tf)}
| fields value = id, label = entity.name
| sort label asc`;

export const iamActiveGateGroupsQuery = (tf: Timeframe) => `smartscapeNodes "ACTIVEGATE", ${from(tf)}
| filter isNotNull(dt.active_gate.group.name)
| summarize n = countDistinct(dt.active_gate.id), by:{value = toString(dt.active_gate.group.name)}
| sort value asc`;

// --- Permissions Test: records a user or group can read -----------------------------------------------------------
// The IAM conditions that limit a Grail table permission (and bucket access) written as a DQL filter, so the records a
// subject can read can be opened in a Notebook. It runs with the permissions of whoever opens it. matchesValue is used
// for every positive operator because it also matches any element of list-valued fields (dt.security_context on
// Smartscape nodes); it is case-insensitive, so the preview can be slightly wider than IAM. Validated with dtctl.
export type IamFilterCondition = { key: string; op: string; values: string[] };
const IAM_RECORD_SOURCES: Record<string, (tf: Timeframe) => string> = {
  logs: (tf) => `fetch logs, ${from(tf)}, samplingRatio:${LOG_SAMPLING[tf]}, scanLimitGBytes:${SCAN_CAP_GB}`,
  spans: (tf) => `fetch spans, ${from(tf)}, samplingRatio:${LOG_SAMPLING[tf]}, scanLimitGBytes:${SCAN_CAP_GB}`,
  events: (tf) => `fetch events, ${from(tf)}, scanLimitGBytes:${SCAN_CAP_GB}`,
  bizevents: (tf) => `fetch bizevents, ${from(tf)}, scanLimitGBytes:${SCAN_CAP_GB}`,
  "security.events": (tf) => `fetch security.events, ${from(tf)}, scanLimitGBytes:${SCAN_CAP_GB}`,
  system: (tf) => `fetch dt.system.events, ${from(tf)}, scanLimitGBytes:${SCAN_CAP_GB}`,
  "user.events": (tf) => `fetch user.events, ${from(tf)}, scanLimitGBytes:${SCAN_CAP_GB}`,
  "user.sessions": (tf) => `fetch user.sessions, ${from(tf)}, scanLimitGBytes:${SCAN_CAP_GB}`,
  smartscape: (tf) => `smartscapeNodes "*", ${from(tf)}`,
};
/** Tables (storage:<table>:read) the preview query supports; metrics and classic entities have no record-level fetch. */
export const iamRecordTable = (permission: string) => {
  const t = permission.replace(/^storage:/, "").replace(/:read$/, "");
  return t in IAM_RECORD_SOURCES ? t : null;
};
/** Condition attribute -> record field; null = selects the table, not records. */
const IAM_RECORD_FIELD: Record<string, string | null> = { "bucket-name": "dt.system.bucket", "table-name": null, "query-consumption": null };
const iamField = (key: string) => {
  const attr = key.slice(key.indexOf(":") + 1);
  return attr in IAM_RECORD_FIELD ? IAM_RECORD_FIELD[attr] : attr;
};

function iamConditionDql(c: IamFilterCondition): string | null {
  const field = iamField(c.key);
  if (!field) return null;
  const mv = (p: string) => `matchesValue(\`${field}\`, ${JSON.stringify(p)})`;
  const any = (ps: string[]) => (ps.length === 1 ? mv(ps[0]) : `(${ps.map(mv).join(" or ")})`);
  switch (c.op) {
    case "=":
    case "IN":
    case "MATCH":
      return any(c.values);
    case "startsWith":
      return mv(`${c.values[0] ?? ""}*`);
    case "!=":
    case "NOT IN":
      return `not ${any(c.values)}`;
    case "NOT startsWith":
      return `not ${mv(`${c.values[0] ?? ""}*`)}`;
    default:
      return null;
  }
}

/** One OR group: a record passes when every condition of one path holds. null = some path has no record condition (all pass). */
function iamPathsDql(paths: IamFilterCondition[][]): string | null {
  const parts: string[] = [];
  for (const p of paths) {
    const conds = p.map(iamConditionDql).filter((x): x is string => !!x);
    if (!conds.length) return null;
    parts.push(conds.length === 1 ? conds[0] : `(${conds.join(" and ")})`);
  }
  return parts.length ? (parts.length === 1 ? parts[0] : parts.join("\n    or ")) : null;
}

/**
 * Records of one table a subject can read: `groups` are ANDed (the table permission's grant paths, then bucket access);
 * within a group the paths are ORed. Counts by the dimensions the conditions use.
 */
export function iamVisibleRecordsQuery(tf: Timeframe, table: string, groups: IamFilterCondition[][][]): string {
  const filters = groups.map(iamPathsDql).filter((x): x is string => !!x);
  const by = [...new Set(groups.flat(2).map((c) => iamField(c.key)).filter((f): f is string => !!f))].slice(0, 3).map((f) => `\`${f}\``);
  return `${IAM_RECORD_SOURCES[table](tf)}
${filters.map((f) => `| filter ${f}\n`).join("")}| summarize records = count()${by.length ? `, by:{${by.join(", ")}}` : ""}
| sort records desc
| limit 100`;
}
