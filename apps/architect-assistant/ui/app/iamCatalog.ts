import { useEffect, useMemo, useState } from "react";
import { functions } from "@dynatrace-sdk/app-utils";
import snapshot from "./iamSnapshot.json";

// ---------------------------------------------------------------------------
// IAM permission catalogue for the IAM Policy Creator and IAM Boundary Creator tabs. Permissions, their conditions and
// the operators each condition supports come from the IAM policy reference on docs.dynatrace.com, read live by the
// iam-reference app function (api/iam-reference-parser.ts) once per page load. iamSnapshot.json is the same parse at
// the last `npm run sync-iam -- --write`; it is used until the live read arrives and whenever it fails, and the tabs list
// what the live docs changed since the snapshot. Permissions change often, so nothing here hardcodes the list.
// ---------------------------------------------------------------------------

export type IamCondition = { key: string; description: string; operators: string[] };
export type IamPermission = { id: string; anchor: string; description: string; conditions: IamCondition[] };
export type IamService = { id: string; anchor: string; title: string; notes: string[]; permissions: IamPermission[] };
export type IamGlobal = { key: string; anchor: string; description: string; operators: string[] };
export type IamCatalog = { updated: string | null; globalsUpdated: string | null; services: IamService[]; globals: IamGlobal[] };

export const SNAPSHOT_CATALOG = snapshot.catalog as IamCatalog;
export const SNAPSHOT_DATE: string = snapshot.captured;

// --- Docs (every page below was fetched when the tabs were built, 2026-10-24) ---------------------------------------
const IAM = "https://docs.dynatrace.com/docs/manage/identity-access-management";
const POLICIES = `${IAM}/permission-management/manage-user-permissions-policies`;
export const IAM_DOCS = {
  reference: { title: "IAM policy reference", url: `${POLICIES}/advanced/iam-policystatements` },
  syntax: { title: "IAM policy statement syntax and examples", url: `${POLICIES}/iam-policystatement-syntax` },
  boundaries: { title: "Policy boundaries", url: `${POLICIES}/iam-policy-boundaries` },
  globals: { title: "Policy global conditions", url: `${POLICIES}/advanced/iam-global-conditions` },
  attributes: { title: "Policy global attributes", url: `${POLICIES}/advanced/iam-global-attributes` },
  templating: { title: "Policy templating", url: `${POLICIES}/advanced/iam-policy-templating` },
  manage: { title: "Working with policies", url: `${POLICIES}/iam-policy-mgt` },
  defaults: { title: "Dynatrace default policies reference", url: `${IAM}/permission-management/default-policies` },
  limits: { title: "IAM limits", url: `${IAM}/iam-limits` },
  grail: { title: "Permissions in Grail", url: "https://docs.dynatrace.com/docs/platform/grail/organize-data/assign-permissions-in-grail" },
  securityContext: { title: "Grant access to entities with security context", url: `${IAM}/use-cases/access-security-context` },
  settings: { title: "Grant access to Settings", url: `${IAM}/use-cases/access-settings` },
} as const;
/** Account Management, where policies and boundaries are created (Identity & access management > Policy management). */
export const ACCOUNT_MANAGEMENT_URL = "https://myaccount.dynatrace.com/";

export const permissionDocUrl = (p: { anchor: string }) => `${IAM_DOCS.reference.url}${p.anchor ? `#${p.anchor}` : ""}`;
export const serviceDocUrl = (s: { anchor: string }) => `${IAM_DOCS.reference.url}#${s.anchor}`;
export const globalDocUrl = (g: { anchor: string }) => `${IAM_DOCS.globals.url}${g.anchor ? `#${g.anchor}` : ""}`;

// --- Operators -----------------------------------------------------------------------------------------------------
/** Operators that take a parenthesised list of values; every other operator takes one value. */
export const LIST_OPERATORS = new Set(["IN", "NOT IN", "MATCH"]);
export const isListOperator = (op: string) => LIST_OPERATORS.has(op.toUpperCase().replace(/\s+/g, " "));
/** Display order (the docs list them in varying order). */
const OPERATOR_ORDER = ["=", "!=", "IN", "NOT IN", "startsWith", "NOT startsWith", "MATCH", "<", ">"];
export const sortOperators = (ops: Iterable<string>) => [...new Set(ops)].sort((a, b) => rank(a) - rank(b));
const rank = (op: string) => {
  const i = OPERATOR_ORDER.indexOf(op);
  return i < 0 ? OPERATOR_ORDER.length : i;
};
export const OPERATOR_HINT: Record<string, string> = {
  "=": "equals one value",
  "!=": "does not equal",
  IN: "equals any value of a list",
  "NOT IN": "equals none of a list",
  startsWith: "has this prefix",
  "NOT startsWith": "does not have this prefix",
  MATCH: "matches any pattern of a list (* wildcard); also matches multi-value (array) fields",
  "<": "before / less than",
  ">": "after / greater than",
};

// --- Global conditions -------------------------------------------------------------------------------------------
/** Value formats from the global conditions page (environment and user conditions document no operator list; its examples use =). */
export const GLOBAL_HINTS: Record<string, { hint: string; placeholder: string; values?: string[] }> = {
  "global:environmentId": { hint: "Environment ID the request targets.", placeholder: "abc12345" },
  "global:userId": { hint: "UUID of the user making the request.", placeholder: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" },
  "global:usernameDomain": { hint: "Domain of the user's name.", placeholder: "example.com" },
  "global:userGroup": { hint: "UUID of a group the user is a member of (not the group name).", placeholder: "f47ac10b-58cc-4372-a567-0e02b2c3d479" },
  "global:date": { hint: "Date with a time zone (Z = UTC). Use > and < for a range.", placeholder: "2026-05-03Z" },
  "global:date-time": { hint: "Date and time with a time zone.", placeholder: "2026-05-03T05:00:00+01:00" },
  "global:time-of-day": { hint: "Time of day with a time zone; combine > and < for a daily window.", placeholder: "09:00+01:00" },
  "global:week-day": { hint: "Day of the week (GMT).", placeholder: "Monday", values: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] },
};
/** Operators a global condition offers: the documented ones, else = (the only operator in the docs examples). */
export const globalOperators = (g: IamGlobal | undefined) => (g?.operators.length ? sortOperators(g.operators) : ["="]);

// --- Dimensional data ----------------------------------------------------------------------------------------------
// Record-level (Grail) attributes. A dimension is an attribute name without the service prefix; it applies to every
// selected permission that has a condition `<service>:<attribute>` (storage, and for security context also settings and
// synthetic; Kubernetes and host names also dev-obs). Storage conditions that select tables, fieldsets, files, external
// stores or query consumption are per-permission options, not dimensions.
const NOT_DIMENSIONS = new Set(["table-name", "fieldset-name", "file-path", "store-name", "query-consumption"]);
const DIMENSION_LABELS: Record<string, string> = {
  "dt.security_context": "Security context",
  "bucket-name": "Grail bucket",
  "dt.host_group.id": "Host group",
  "k8s.cluster.name": "Kubernetes cluster",
  "k8s.namespace.name": "Kubernetes namespace",
  "host.name": "Host name",
  "aws.account.id": "AWS account",
  "azure.subscription": "Azure subscription",
  "azure.resource.group": "Azure resource group",
  "gcp.project.id": "GCP project",
  "frontend.name": "Frontend",
  "event.kind": "Event kind",
  "event.type": "Event type",
  "event.provider": "Event provider",
  "log.source": "Log source",
  "metric.key": "Metric key",
  "entity.type": "Entity type",
};
const DIMENSION_ORDER = Object.keys(DIMENSION_LABELS);
export const attributeOf = (key: string) => key.slice(key.indexOf(":") + 1);
export const serviceOf = (key: string) => key.slice(0, key.indexOf(":"));
export const dimensionLabel = (attr: string) => DIMENSION_LABELS[attr] ?? attr;

export type Dimension = { attr: string; label: string; keys: string[]; operators: string[] };

// --- Indexes -------------------------------------------------------------------------------------------------------
export type PermissionInfo = IamPermission & { service: IamService };
export type ConditionKeyInfo = { key: string; description: string; operators: string[]; permissions: string[] };

export type CatalogIndex = {
  catalog: IamCatalog;
  permissions: Map<string, PermissionInfo>;
  /** Every condition key with the union of its operators and the permissions that support it. */
  conditionKeys: Map<string, ConditionKeyInfo>;
  globals: Map<string, IamGlobal>;
  dimensions: Dimension[];
};

export function indexCatalog(catalog: IamCatalog): CatalogIndex {
  const permissions = new Map<string, PermissionInfo>();
  const conditionKeys = new Map<string, ConditionKeyInfo>();
  for (const service of catalog.services) {
    for (const p of service.permissions) {
      permissions.set(p.id, { ...p, service });
      for (const c of p.conditions) {
        const cur = conditionKeys.get(c.key) ?? { key: c.key, description: c.description, operators: [], permissions: [] };
        cur.operators = sortOperators([...cur.operators, ...c.operators]);
        cur.permissions.push(p.id);
        conditionKeys.set(c.key, cur);
      }
    }
  }
  const attrs = new Set([...conditionKeys.keys()].filter((k) => serviceOf(k) === "storage").map(attributeOf).filter((a) => !NOT_DIMENSIONS.has(a)));
  const dimensions = [...attrs]
    .sort((a, b) => (DIMENSION_ORDER.indexOf(a) + 1 || 999) - (DIMENSION_ORDER.indexOf(b) + 1 || 999) || a.localeCompare(b))
    .map((attr) => {
      const keys = [...conditionKeys.keys()].filter((k) => attributeOf(k) === attr).sort((a, b) => (serviceOf(a) === "storage" ? -1 : serviceOf(b) === "storage" ? 1 : a.localeCompare(b)));
      return { attr, label: dimensionLabel(attr), keys, operators: sortOperators(keys.flatMap((k) => conditionKeys.get(k)!.operators)) };
    });
  return { catalog, permissions, conditionKeys, globals: new Map(catalog.globals.map((g) => [g.key, g])), dimensions };
}

/** The permission's own condition with this key, if it supports it. */
export const conditionOf = (p: IamPermission | undefined, key: string) => p?.conditions.find((c) => c.key === key);

// --- Grail tables ----------------------------------------------------------------------------------------------------
/** Grail table behind a table permission (bucket access needs storage:buckets:read too); entities and smartscape have no buckets. */
export function grailTableOf(permission: string): string | null {
  const m = /^storage:([a-z.]+):read$/.exec(permission);
  if (!m) return null;
  if (m[1] === "system") return "dt.system.events";
  return ["logs", "events", "metrics", "spans", "bizevents", "security.events", "user.events", "user.sessions", "user.replays", "application.snapshots"].includes(m[1]) ? m[1] : null;
}

// --- Live catalogue ----------------------------------------------------------------------------------------------------
export type CatalogDiff = {
  added: string[];
  removed: string[];
  /** Permissions whose conditions or operators changed: "storage:logs:read: + storage:x [=, IN]". */
  changed: { id: string; detail: string[] }[];
  globals: string[];
};

export type IamCatalogState = {
  index: CatalogIndex;
  source: "live" | "snapshot";
  status: "loading" | "ok" | "blocked" | "error";
  message?: string;
  checkedAt?: string;
  diff: CatalogDiff | null;
  retry: () => void;
};

type FunctionResult = { status: "ok"; checkedAt: string; catalog: IamCatalog } | { status: "blocked" | "error"; message: string };

export function diffCatalogs(before: IamCatalog, after: IamCatalog): CatalogDiff {
  const a = indexCatalog(before).permissions;
  const b = indexCatalog(after).permissions;
  const sig = (p: IamPermission) => p.conditions.map((c) => `${c.key} [${sortOperators(c.operators).join(", ")}]`);
  const changed: CatalogDiff["changed"] = [];
  for (const [id, p] of b) {
    const old = a.get(id);
    if (!old) continue;
    const was = new Set(sig(old));
    const now = new Set(sig(p));
    const detail = [...[...now].filter((s) => !was.has(s)).map((s) => `+ ${s}`), ...[...was].filter((s) => !now.has(s)).map((s) => `− ${s}`)];
    if (detail.length) changed.push({ id, detail });
  }
  const og = new Map(before.globals.map((g) => [g.key, g.operators.join(", ")]));
  const globals = [
    ...after.globals.filter((g) => og.get(g.key) !== g.operators.join(", ")).map((g) => `${g.key} [${g.operators.join(", ") || "="}]`),
    ...[...og.keys()].filter((k) => !after.globals.some((g) => g.key === k)).map((k) => `− ${k}`),
  ];
  return { added: [...b.keys()].filter((id) => !a.has(id)), removed: [...a.keys()].filter((id) => !b.has(id)), changed, globals };
}
export const diffSize = (d: CatalogDiff | null) => (d ? d.added.length + d.removed.length + d.changed.length + d.globals.length : 0);

/** functions.call keeps the HTTP response as `cause`; 404 = the function is not part of the running app (same as docs-freshness). */
async function describeFailure(e: unknown): Promise<string> {
  const res = (e as { cause?: unknown })?.cause;
  if (res instanceof Response) {
    if (res.status === 404) return "the iam-reference app function is not available in this running app (HTTP 404). Restart npx dt-app dev (or deploy), then retry.";
    let body = "";
    try {
      body = (await res.text()).slice(0, 300);
    } catch {
      // body already consumed or unreadable
    }
    return `the iam-reference app function returned HTTP ${res.status}${body ? `: ${body}` : ""}`;
  }
  return (e as Error)?.message ?? String(e);
}

// One docs read per page load, shared by both tabs; a failed read can be retried.
type Loaded = Omit<IamCatalogState, "index" | "retry"> & { catalog: IamCatalog };
let pending: Promise<Loaded> | null = null;
const listeners = new Set<(s: Loaded) => void>();
const SNAPSHOT_STATE: Loaded = { catalog: SNAPSHOT_CATALOG, source: "snapshot", status: "loading", diff: null };

function load(): Promise<Loaded> {
  pending ??= functions
    .call("iam-reference")
    .then((res) => res.json())
    .then((r: FunctionResult): Loaded =>
      r.status === "ok"
        ? { catalog: r.catalog, source: "live", status: "ok", checkedAt: r.checkedAt, diff: diffCatalogs(SNAPSHOT_CATALOG, r.catalog) }
        : { ...SNAPSHOT_STATE, status: r.status, message: r.message },
    )
    .catch(async (e): Promise<Loaded> => ({ ...SNAPSHOT_STATE, status: "error", message: await describeFailure(e) }));
  return pending;
}

function retryLoad(): void {
  pending = null;
  listeners.forEach((l) => l(SNAPSHOT_STATE));
  void load().then((s) => listeners.forEach((l) => l(s)));
}

export function useIamCatalog(): IamCatalogState {
  const [state, setState] = useState<Loaded>(SNAPSHOT_STATE);
  useEffect(() => {
    let cancelled = false;
    const listener = (s: Loaded) => !cancelled && setState(s);
    listeners.add(listener);
    void load().then(listener);
    return () => {
      cancelled = true;
      listeners.delete(listener);
    };
  }, []);
  const index = useMemo(() => indexCatalog(state.catalog), [state.catalog]);
  return { index, source: state.source, status: state.status, message: state.message, checkedAt: state.checkedAt, diff: state.diff, retry: retryLoad };
}
