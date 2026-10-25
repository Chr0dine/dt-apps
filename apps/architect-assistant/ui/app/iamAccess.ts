import { attributeOf, dimensionLabel, grailTableOf, type CatalogIndex } from "./iamCatalog";
import { applyBoundary, parsePolicy, renderCondition, renderStatement, validateBoundary, type CondValue, type Effect } from "./iamPolicy";
import { APP_LEVELS, BUCKETS, type AppLevel, type AppPerm, type AppSummary } from "./iamApps";

// ---------------------------------------------------------------------------
// Permissions Test engine. Pure functions over what the Account Management API returns for a user or group (group
// bindings with their policies, boundaries and bind parameters), or over the IAM Policy Creator / Boundary Creator
// drafts:
// - bindings -> effective statements, one per permission: bind parameters are filled in, each boundary is applied with
//   the Boundary Creator's `applyBoundary` (several boundaries on one binding are applied separately, so their results
//   add up, per "How are policy boundaries applied?"), global attributes are resolved for the subject,
// - a permission + what is known about the request (e.g. shared:app-id) -> granted / scoped / conditional / missing /
//   denied, with the statements behind it,
// - per installed app (the Policy Creator's `summarizeApp`): can the subject open it, and are the permissions it needs
//   granted,
// - per Grail table permission: unrestricted, limited by dimensional data (and which values), or not granted.
// DENY wins over ALLOW. A conditional DENY on a Grail table permission runs as an unconditional DENY (Permissions in
// Grail); only storage:buckets:read evaluates its conditions.
// ---------------------------------------------------------------------------

// --- Inputs --------------------------------------------------------------------------------------------------------
export type AccessPolicy = { uuid: string; name: string; description?: string; levelType: string; levelId?: string; statementQuery: string };
export type AccessBoundary = { uuid: string; name: string; boundaryQuery: string };
export type AccessBinding = {
  /** null for the drafts. */
  groupUuid: string | null;
  groupName: string;
  /** Where the binding lives: account (every environment of the account), environment, or the builder drafts. */
  levelType: "account" | "environment" | "draft";
  levelId: string;
  policy: AccessPolicy;
  boundaries: AccessBoundary[];
  parameters: Record<string, string>;
};
export type SubjectKind = "user" | "group" | "draft";
export type AccessSubject = { kind: SubjectKind; id: string; name: string; email?: string; groups: { uuid: string; name: string }[] };

// --- Effective statements ------------------------------------------------------------------------------------------
export type GrantSource = { binding: number; group: string; policy: string; level: string; boundary: string | null };
export type AccessStatement = { effect: Effect; permission: string; conditions: CondValue[]; source: GrantSource; text: string };
export type AccessNote = { binding: number; severity: "warning" | "info"; text: string };

const BIND_RE = /\$\{bindParam:([^}]+)\}/g;
const escapeValue = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const levelLabel = (b: AccessBinding) => (b.levelType === "draft" ? "draft" : b.levelType === "account" ? "account (all environments)" : `environment ${b.levelId}`);

/** `${global:userId}` -> the user's UUID; a value that is exactly `${global:userGroup}` -> the UUIDs of the subject's groups. */
function resolveGlobals(c: CondValue, subject: AccessSubject): CondValue {
  const groups = subject.groups.map((g) => g.uuid);
  const values = c.values.flatMap((v) => (v === "${global:userGroup}" && subject.kind !== "draft" ? groups : [subject.kind === "user" ? v.split("${global:userId}").join(subject.id) : v]));
  return { ...c, values };
}

export function effectiveStatements(bindings: AccessBinding[], subject: AccessSubject, ix: CatalogIndex): { statements: AccessStatement[]; notes: AccessNote[] } {
  const statements: AccessStatement[] = [];
  const notes: AccessNote[] = [];
  bindings.forEach((b, i) => {
    // Bind parameters fill in policy and boundary values alike (Policy templating).
    const missing = new Set<string>();
    const bind = (t: string) =>
      t.replace(BIND_RE, (whole, name: string) => {
        const v = b.parameters[name];
        if (v === undefined) {
          missing.add(name);
          return whole;
        }
        return escapeValue(v);
      });
    const parsed = parsePolicy(bind(b.policy.statementQuery));
    const bad = parsed.filter((s) => !s.ok).length;
    if (bad) notes.push({ binding: i, severity: "warning", text: `${b.policy.name}: ${bad} statement${bad === 1 ? "" : "s"} could not be read and ${bad === 1 ? "was" : "were"} left out.` });
    const bounds: { name: string | null; conds: CondValue[] }[] = b.boundaries.length
      ? b.boundaries.map((bd) => {
          const check = validateBoundary(bind(bd.boundaryQuery), ix, "");
          const errs = check.diagnostics.filter((d) => d.severity === "error");
          const usable = check.conditions.filter((c) => !errs.some((e) => e.from >= c.from && e.from <= c.to));
          if (usable.length < check.conditions.length) notes.push({ binding: i, severity: "warning", text: `Boundary ${bd.name}: ${check.conditions.length - usable.length} condition(s) could not be read and were left out.` });
          return { name: bd.name, conds: usable.map((c) => ({ key: c.key, op: c.op, values: c.values })) };
        })
      : [{ name: null, conds: [] }];
    if (missing.size)
      notes.push({ binding: i, severity: "warning", text: `${b.policy.name}: no value bound for ${[...missing].map((n) => `\${bindParam:${n}}`).join(", ")}, so the statements using it are treated as conditional.` });
    for (const bd of bounds)
      for (const row of applyBoundary(parsed, bd.conds, ix))
        for (const permission of row.permissions) {
          const conditions = row.conditions.map((c) => resolveGlobals(c, subject));
          statements.push({
            effect: row.effect,
            permission,
            conditions,
            source: { binding: i, group: b.groupName, policy: b.policy.name, level: levelLabel(b), boundary: bd.name },
            text: renderStatement({ effect: row.effect, permissions: [permission], conditions }),
          });
        }
  });
  return { statements, notes };
}

// --- Conditions ----------------------------------------------------------------------------------------------------
/**
 * Why a condition could not be decided for a request:
 * record = it selects records or resources (security context, bucket, schema, …): the permission is limited, not absent;
 * time = a global date / time / week-day window; subject = it depends on the user and the subject is a group or a draft;
 * unresolved = an unbound ${bindParam:…} or another placeholder.
 */
export type UnknownKind = "record" | "time" | "subject" | "unresolved";
export type Unknown = { cond: CondValue; kind: UnknownKind };
type Outcome = { match: true } | { match: false } | { unknown: UnknownKind };
/** Attributes of the request that are known, e.g. { "shared:app-id": "dynatrace.notebooks" }. */
export type Known = Record<string, string>;

const TIME_KEYS = new Set(["global:date", "global:date-time", "global:time-of-day", "global:week-day"]);
const NEGATIVE = new Set(["!=", "NOT IN", "NOT startsWith"]);
const wildcard = (p: string) => new RegExp(`^${p.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);

function test(op: string, actual: string, values: string[]): boolean {
  switch (op) {
    case "=":
      return actual === values[0];
    case "!=":
      return actual !== values[0];
    case "IN":
      return values.includes(actual);
    case "NOT IN":
      return !values.includes(actual);
    case "startsWith":
      return actual.startsWith(values[0] ?? "");
    case "NOT startsWith":
      return !actual.startsWith(values[0] ?? "");
    case "MATCH":
      return values.some((v) => wildcard(v).test(actual));
    case "<":
      return actual < (values[0] ?? "");
    case ">":
      return actual > (values[0] ?? "");
    default:
      return false;
  }
}
/** Several actual values (a user's groups): a positive operator needs one of them, a negative one all of them. */
const testAny = (op: string, actuals: string[], values: string[]) => (NEGATIVE.has(op) ? actuals.every((a) => test(op, a, values)) : actuals.some((a) => test(op, a, values)));
const result = (ok: boolean): Outcome => (ok ? { match: true } : { match: false });

function evalCondition(c: CondValue, known: Known, subject: AccessSubject, environmentId: string): Outcome {
  if (c.values.some((v) => v.includes("${"))) return { unknown: "unresolved" };
  if (TIME_KEYS.has(c.key)) return { unknown: "time" };
  switch (c.key) {
    case "global:environmentId":
      return result(test(c.op, environmentId, c.values));
    case "global:userId":
      return subject.kind === "user" ? result(test(c.op, subject.id, c.values)) : { unknown: "subject" };
    case "global:usernameDomain":
      return subject.email?.includes("@") ? result(test(c.op, subject.email.split("@")[1], c.values)) : { unknown: "subject" };
    case "global:userGroup":
      return subject.kind === "draft" ? { unknown: "subject" } : result(testAny(c.op, subject.groups.map((g) => g.uuid), c.values));
  }
  if (c.key in known) return result(test(c.op, known[c.key], c.values));
  return { unknown: c.key.startsWith("global:") ? "subject" : "record" };
}

type StatementEval = { match: boolean; unknown: Unknown[] } | null;
/** null = the statement does not apply to this request (a condition is false). */
function evalStatement(st: AccessStatement, known: Known, subject: AccessSubject, environmentId: string): StatementEval {
  const unknown: Unknown[] = [];
  for (const c of st.conditions) {
    const o = evalCondition(c, known, subject, environmentId);
    if ("unknown" in o) unknown.push({ cond: c, kind: o.unknown });
    else if (!o.match) return null;
  }
  return { match: unknown.length === 0, unknown };
}

// --- Permissions ---------------------------------------------------------------------------------------------------
/**
 * granted = an ALLOW applies without conditions left open; scoped = only for some records or resources (dimensional
 * data, buckets, schemas, …); conditional = depends on time, the user, or an unbound parameter; missing = no ALLOW
 * applies; denied = a DENY applies.
 */
export type PermStatus = "granted" | "scoped" | "conditional" | "missing" | "denied";
export type Grant = { st: AccessStatement; unknown: Unknown[] };
export type PermEval = { permission: string; status: PermStatus; grants: Grant[]; denies: Grant[] };

/** Conditional DENY on Grail table permissions runs as an unconditional DENY; only storage:buckets:read evaluates it. */
const denyIgnoresConditions = (p: string) => p.startsWith("storage:") && p !== BUCKETS && !!grailTableOf(p);
const onlyRecords = (g: Grant) => g.unknown.every((u) => u.kind === "record");

export function evaluatePermission(permission: string, statements: AccessStatement[], known: Known, subject: AccessSubject, environmentId: string): PermEval {
  const grants: Grant[] = [];
  const denies: Grant[] = [];
  let deniedFully = false;
  for (const st of statements) {
    if (st.permission !== permission) continue;
    if (st.effect === "DENY" && denyIgnoresConditions(permission)) {
      denies.push({ st, unknown: [] });
      deniedFully = true;
      continue;
    }
    const e = evalStatement(st, known, subject, environmentId);
    if (!e) continue;
    if (st.effect === "DENY") {
      denies.push({ st, unknown: e.unknown });
      if (e.match) deniedFully = true;
    } else grants.push({ st, unknown: e.unknown });
  }
  const full = grants.some((g) => g.unknown.length === 0);
  const partialDeny = denies.filter((d) => d.unknown.length > 0);
  let status: PermStatus;
  if (deniedFully) status = "denied";
  else if (!grants.length) status = "missing";
  else if (full && !partialDeny.length) status = "granted";
  else if ((full || grants.some(onlyRecords)) && partialDeny.every(onlyRecords)) status = "scoped";
  else status = "conditional";
  // Unconditional grants first, then the narrowest (fewest open conditions).
  grants.sort((a, b) => a.unknown.length - b.unknown.length);
  return { permission, status, grants, denies };
}

export const STATUS_RANK: Record<PermStatus, number> = { granted: 0, scoped: 1, conditional: 2, missing: 3, denied: 4 };
export const usable = (s: PermStatus) => s === "granted" || s === "scoped";

// --- Apps ----------------------------------------------------------------------------------------------------------
export type AppStatus = "access" | "conditional" | "none";
export type LevelStatus = "full" | "partial" | "none" | "n/a";
export type AppData = { permission: string; optional: boolean; status: PermStatus };
export type AppAccess = {
  id: string;
  name: string;
  status: AppStatus;
  run: PermEval;
  /** The app's own permissions (manifest, app state) per access level, as in the Policy Creator's Read / Write / Execute. */
  levels: Record<AppLevel, { status: LevelStatus; perms: PermEval[] }>;
  /** Grail data the app shows, with what the subject can read of it (table permission and bucket access together). */
  data: AppData[];
  /** Short reasons for the status (empty when access is complete). */
  reasons: string[];
  /** Required data limited to some records (shown under Dimensional data); not a reason for a warning. */
  limited: string[];
};

const short = (p: string) => p.replace(/^storage:/, "").replace(/:read$/, "");
function levelStatus(perms: PermEval[]): LevelStatus {
  if (!perms.length) return "n/a";
  const ok = perms.filter((p) => usable(p.status)).length;
  return ok === perms.length ? "full" : ok === 0 && !perms.some((p) => p.status === "conditional") ? "none" : "partial";
}

/**
 * access = the subject can open the app and read the Grail data it requires (records may be limited by dimensional
 * data); conditional = opening depends on time, the user or an unbound parameter, or some required data cannot be read;
 * none = no ALLOW of app-engine:apps:run covers the app (or a DENY does). Manifest permissions beyond data do not change
 * the status (manifests request every scope an app may use); they show as Read / Write / Execute coverage.
 */
export function evaluateApp(s: AppSummary, statements: AccessStatement[], subject: AccessSubject, environmentId: string, dataStatus: Map<string, PermStatus>): AppAccess {
  const known: Known = { "shared:app-id": s.app.id };
  const ev = (p: string) => evaluatePermission(p, statements, known, subject, environmentId);
  const run = ev("app-engine:apps:run");
  const levels = Object.fromEntries(
    APP_LEVELS.map((l) => {
      const perms = [...s.byLevel[l], ...s.owned.filter((p: AppPerm) => p.level === l)].map((p) => ev(p.permission));
      return [l, { status: levelStatus(perms), perms }];
    }),
  ) as AppAccess["levels"];
  const data: AppData[] = s.data.map((p) => ({ permission: p.permission, optional: p.optional, status: dataStatus.get(p.permission) ?? ev(p.permission).status }));
  const required = data.filter((d) => !d.optional);
  const reasons: string[] = [];
  let status: AppStatus;
  if (!usable(run.status) && run.status !== "conditional") {
    status = "none";
    reasons.push(run.status === "denied" ? "app-engine:apps:run is denied for this app" : "no policy lets this subject open the app");
  } else {
    if (run.status === "conditional") reasons.push(`opening it depends on ${describeUnknown(run.grants[0]?.unknown ?? [])}`);
    const missing = required.filter((d) => d.status === "missing" || d.status === "denied");
    const cond = required.filter((d) => d.status === "conditional");
    if (missing.length) reasons.push(`opens, but cannot read ${missing.map((d) => tableLabel(d.permission).toLowerCase()).join(", ")}`);
    if (cond.length) reasons.push(`reading ${cond.map((d) => tableLabel(d.permission).toLowerCase()).join(", ")} is conditional`);
    status = reasons.length ? "conditional" : "access";
  }
  return { id: s.app.id, name: s.app.name, status, run, levels, data, reasons, limited: required.filter((d) => d.status === "scoped").map((d) => short(d.permission)) };
}

const KIND_TEXT: Record<UnknownKind, string> = { record: "the records or resources requested", time: "the date or time", subject: "who the user is", unresolved: "an unbound parameter" };
export function describeUnknown(us: Unknown[]): string {
  const kinds = [...new Set(us.map((u) => u.kind))];
  return kinds.length ? kinds.map((k) => KIND_TEXT[k]).join(" and ") : "conditions";
}

// --- Dimensional data ----------------------------------------------------------------------------------------------
export type DataRow = {
  permission: string;
  label: string;
  eval: PermEval;
  /** storage:buckets:read for this row's table (null for tables without buckets: entities, smartscape, the buckets row). */
  buckets: PermEval | null;
  /** What the subject can read, combining the table permission with bucket access. */
  status: PermStatus;
  /** Dimensions the open conditions use. */
  dims: string[];
};

const TABLE_ORDER = ["buckets", "logs", "metrics", "spans", "events", "bizevents", "entities", "smartscape", "security.events", "system", "user.events", "user.sessions", "user.replays", "application.snapshots", "profiles"];
const TABLE_LABEL: Record<string, string> = {
  buckets: "Grail buckets",
  logs: "Logs",
  metrics: "Metrics",
  spans: "Spans",
  events: "Events",
  bizevents: "Business events",
  entities: "Entities (classic)",
  smartscape: "Smartscape",
  "security.events": "Security events",
  system: "System events",
  "user.events": "User events",
  "user.sessions": "User sessions",
  "user.replays": "Session replays",
  "application.snapshots": "Application snapshots",
  profiles: "Profiles",
  fieldsets: "Sensitive fieldsets",
};
export const tableOf = (p: string) => p.replace(/^storage:/, "").replace(/:read$/, "");
export const tableLabel = (p: string) => TABLE_LABEL[tableOf(p)] ?? tableOf(p);

/** Grail read permissions with record-level (dimension) conditions, plus storage:buckets:read, in a fixed order. */
export function dataPermissions(ix: CatalogIndex): string[] {
  const dims = new Set(ix.dimensions.map((d) => d.attr));
  const perms = [...ix.permissions.values()]
    .filter((p) => p.id.startsWith("storage:") && p.id.endsWith(":read") && (p.id === BUCKETS || p.conditions.some((c) => dims.has(attributeOf(c.key)) && attributeOf(c.key) !== "bucket-name")))
    .map((p) => p.id);
  const rank = (p: string) => (TABLE_ORDER.indexOf(tableOf(p)) + 1 || 999);
  return perms.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export function dataAccess(statements: AccessStatement[], subject: AccessSubject, environmentId: string, ix: CatalogIndex): DataRow[] {
  return dataPermissions(ix).map((permission) => {
    const e = evaluatePermission(permission, statements, {}, subject, environmentId);
    const table = permission === BUCKETS ? null : grailTableOf(permission);
    // Records in a table are only readable from buckets the subject may read; the table name is known here.
    const buckets = table ? evaluatePermission(BUCKETS, statements, { "storage:table-name": table }, subject, environmentId) : null;
    const status: PermStatus = buckets && STATUS_RANK[buckets.status] > STATUS_RANK[e.status] ? buckets.status : e.status;
    const dims = [...new Set([e, buckets].flatMap((x) => x?.grants.flatMap((g) => g.unknown.filter((u) => u.kind === "record").map((u) => attributeOf(u.cond.key))) ?? []))];
    return { permission, label: tableLabel(permission), eval: e, buckets, status, dims };
  });
}

/** Grant paths of a permission: each is the set of open conditions of one ALLOW (AND); paths combine with OR. [] = unrestricted. */
export const grantPaths = (e: PermEval) => (e.grants.some((g) => g.unknown.length === 0) ? [] : e.grants.map((g) => g.unknown.map((u) => u.cond)));

export type DimensionSummary = { attr: string; label: string; entries: { condition: string; tables: string[] }[]; unrestricted: string[] };

/** Per dimension: which values the subject may read, on which tables; tables readable without limits are listed once. */
export function dimensionSummary(rows: DataRow[], ix: CatalogIndex): DimensionSummary[] {
  const dims = new Set(ix.dimensions.map((d) => d.attr));
  const byAttr = new Map<string, Map<string, Set<string>>>();
  const unrestricted = rows.filter((r) => r.status === "granted" && r.permission !== BUCKETS).map((r) => r.label);
  for (const r of rows) {
    if (r.status !== "scoped") continue;
    for (const path of [...grantPaths(r.eval), ...(r.buckets ? grantPaths(r.buckets) : [])])
      for (const c of path) {
        const attr = attributeOf(c.key);
        if (!dims.has(attr)) continue;
        const m = byAttr.get(attr) ?? new Map<string, Set<string>>();
        const text = renderCondition({ key: "", op: c.op, values: c.values }).trim();
        m.set(text, (m.get(text) ?? new Set()).add(r.label));
        byAttr.set(attr, m);
      }
  }
  return [...byAttr]
    .map(([attr, m]) => ({ attr, label: dimensionLabel(attr), entries: [...m].map(([condition, tables]) => ({ condition, tables: [...tables] })), unrestricted }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// --- Summary -------------------------------------------------------------------------------------------------------
export type AccessResult = {
  statements: AccessStatement[];
  notes: AccessNote[];
  apps: AppAccess[];
  data: DataRow[];
  dimensions: DimensionSummary[];
};

export function evaluateAccess(bindings: AccessBinding[], subject: AccessSubject, environmentId: string, apps: AppSummary[], ix: CatalogIndex): AccessResult {
  const { statements, notes } = effectiveStatements(bindings, subject, ix);
  const data = dataAccess(statements, subject, environmentId, ix);
  const dataStatus = new Map(data.map((r) => [r.permission, r.status]));
  return {
    statements,
    notes,
    apps: apps.map((s) => evaluateApp(s, statements, subject, environmentId, dataStatus)),
    data,
    dimensions: dimensionSummary(data, ix),
  };
}
