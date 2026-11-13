import { ApiError, accountClient, accountStack, accountToken, callerCanManage, isBlocked, readAppCredentials, type AccountClient } from "./app-credentials";

// Creates (or, after an explicit confirmation, updates) the IAM Policy Creator's policy or the IAM Boundary Creator's
// boundary in Account Management, through the Account Management API with the app's account OAuth client.
// - Only the app's admins (app-settings:objects:write for this app) may write, whatever the "every user" setting says.
// - The text is validated first (POST …/validation); nothing is written when that fails.
// - A policy is created on the account (all environments) or on this environment; boundaries always live on the account.
// - When an object with the same name exists at that level, nothing is written: the function returns "exists" with its
//   UUID, and the UI asks before sending the same call again with `replace` set to that UUID (PUT).
// Scopes: iam:policies:write / iam:boundaries:write (plus the matching :read to find existing names), or the legacy
// iam-policies-management. Like the reads, a 403 on the fine-grained token is retried once with the legacy scope set.
// Full-line comments (// …) are removed: the API stores statementQuery / boundaryQuery verbatim and the policy language
// does not document comments.

type Kind = "policy" | "boundary";
type Payload = {
  kind: Kind;
  /** policy only: account = every environment of the account, environment = this environment only. */
  levelType?: "account" | "environment";
  environmentId?: string;
  name: string;
  description?: string;
  text: string;
  /** UUID of the existing object to replace (only after the user confirmed). */
  replace?: string;
};

export type PublishResult =
  | { status: "created" | "updated"; uuid: string; levelType: string; levelId: string; name: string; sent: string }
  | { status: "exists"; uuid: string; levelType: string; levelId: string; name: string }
  | { status: "invalid"; message: string; details?: string[] }
  | { status: "no-credential" | "forbidden" | "unauthorized" | "blocked" | "error"; message: string };

const FINE: Record<Kind, string> = {
  policy: "account-idm-read iam:policies:read iam:policies:write",
  boundary: "account-idm-read iam:boundaries:read iam:boundaries:write",
};
const LEGACY = "account-idm-read iam-policies-management";

/** Removes full-line // comments and blank lines; the statements are kept as written. */
export function stripComments(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith("//"))
    .join("\n")
    .trim();
}

async function call<T>(token: string, method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<{ status: number; json: T | null; text: string }> {
  const res = await fetch(`${accountStack().api}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text().catch(() => "");
  let json: T | null = null;
  try {
    json = text ? (JSON.parse(text) as T) : null;
  } catch {
    // not JSON
  }
  if (res.status === 401 || res.status === 403) throw new ApiError(`${method} ${path} returned HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`, res.status);
  return { status: res.status, json, text };
}

type ErrorDto = { code?: number; message?: string; errorsMap?: Record<string, unknown> };
/** The API's validation messages: `message` plus whatever `errorsMap` holds (strings or lists of strings). */
function errorDetails(e: ErrorDto | null, text: string): { message: string; details: string[] } {
  const details: string[] = [];
  for (const [k, v] of Object.entries(e?.errorsMap ?? {})) {
    const vals = Array.isArray(v) ? v : [v];
    for (const x of vals) details.push(`${k}: ${typeof x === "string" ? x : JSON.stringify(x)}`);
  }
  return { message: e?.message || text.slice(0, 300) || "The request was rejected.", details };
}

async function publish(p: Payload, c: AccountClient, token: string, env: string): Promise<PublishResult> {
  const acc = encodeURIComponent(c.accountUuid);
  const name = p.name.trim();
  const sent = stripComments(p.text);
  if (p.kind === "policy") {
    const levelType = p.levelType === "account" ? "account" : "environment";
    const levelId = levelType === "account" ? c.accountUuid : env;
    const base = `/iam/v1/repo/${levelType}/${encodeURIComponent(levelId)}/policies`;
    const body = { name, description: (p.description ?? "").trim() || "Created with Architect Assistant", tags: [] as string[], statementQuery: sent };
    const v = await call<ErrorDto>(token, "POST", `${base}/validation`, body);
    if (v.status !== 200 && v.status !== 204) return { status: "invalid", ...errorDetails(v.json, v.text) };
    if (!p.replace) {
      // policies/aggregate also lists inherited (global, account) policies: only a name at this exact level conflicts.
      const list = await call<{ policyOverviewList?: { uuid: string; name: string; levelType: string; levelId: string }[] }>(token, "GET", `${base}/aggregate`);
      const same = (list.json?.policyOverviewList ?? []).find((x) => x.levelType === levelType && x.levelId === levelId && x.name.trim().toLowerCase() === name.toLowerCase());
      if (same) return { status: "exists", uuid: same.uuid, levelType, levelId, name: same.name };
      const r = await call<{ uuid?: string } & ErrorDto>(token, "POST", base, body);
      if (r.status !== 201 && r.status !== 200) return { status: "invalid", ...errorDetails(r.json, r.text) };
      return { status: "created", uuid: r.json?.uuid ?? "", levelType, levelId, name, sent };
    }
    const r = await call<{ uuid?: string } & ErrorDto>(token, "PUT", `${base}/${encodeURIComponent(p.replace)}`, body);
    if (r.status !== 204 && r.status !== 201 && r.status !== 200) return { status: "invalid", ...errorDetails(r.json, r.text) };
    return { status: r.status === 201 ? "created" : "updated", uuid: r.json?.uuid ?? p.replace, levelType, levelId, name, sent };
  }

  const base = `/iam/v1/repo/account/${acc}/boundaries`;
  const body = { name, boundaryQuery: sent, metadata: {} };
  const v = await call<ErrorDto>(token, "POST", `${base}/validation`, body);
  if (v.status !== 200 && v.status !== 204) return { status: "invalid", ...errorDetails(v.json, v.text) };
  if (!p.replace) {
    // Boundaries are paged; read pages of 100 until the name is found or the list ends.
    for (let page = 1; page <= 50; page++) {
      const list = await call<{ content?: { uuid: string; name: string }[]; totalCount?: number }>(token, "GET", `${base}?size=100&page=${page}`);
      const items = list.json?.content ?? [];
      const same = items.find((x) => x.name.trim().toLowerCase() === name.toLowerCase());
      if (same) return { status: "exists", uuid: same.uuid, levelType: "account", levelId: c.accountUuid, name: same.name };
      if (items.length < 100 || page * 100 >= (list.json?.totalCount ?? 0)) break;
    }
    const r = await call<{ uuid?: string } & ErrorDto>(token, "POST", base, body);
    if (r.status !== 201 && r.status !== 200) return { status: "invalid", ...errorDetails(r.json, r.text) };
    return { status: "created", uuid: r.json?.uuid ?? "", levelType: "account", levelId: c.accountUuid, name, sent };
  }
  const r = await call<{ uuid?: string } & ErrorDto>(token, "PUT", `${base}/${encodeURIComponent(p.replace)}`, body);
  if (r.status !== 204 && r.status !== 201 && r.status !== 200) return { status: "invalid", ...errorDetails(r.json, r.text) };
  return { status: r.status === 201 ? "created" : "updated", uuid: r.json?.uuid ?? p.replace, levelType: "account", levelId: c.accountUuid, name, sent };
}

export default async function (payload: Payload): Promise<PublishResult> {
  if (!payload || (payload.kind !== "policy" && payload.kind !== "boundary")) return { status: "error", message: "Missing or unknown kind." };
  if (!payload.name?.trim()) return { status: "invalid", message: `Give the ${payload.kind} a name first.` };
  if (!stripComments(payload.text ?? "")) return { status: "invalid", message: `The ${payload.kind} has no statements to send.` };
  const env = (payload.environmentId ?? "").trim();
  if (payload.kind === "policy" && payload.levelType !== "account" && !/^[\w-]+$/.test(env)) return { status: "error", message: "Missing environment ID." };
  if (payload.replace && !/^[\w-]+$/.test(payload.replace)) return { status: "error", message: "Invalid UUID to replace." };

  const { creds, error } = await readAppCredentials();
  const client = accountClient(creds);
  if (!client) return { status: "no-credential", message: `No account OAuth client in the app settings${error ? ` (${error})` : ""}. An admin of this app stores it once under Account Management access.` };
  try {
    // Writing IAM configuration is for the app's admins only, even when reading is allowed for every user.
    if (!(await callerCanManage())) return { status: "forbidden", message: "Only users who can change this app's settings (the app's admins) can create policies and boundaries in Account Management." };
    const first = await accountToken(client, [FINE[payload.kind], LEGACY]);
    try {
      return await publish(payload, client, first.token, env);
    } catch (e) {
      // Same quirk as the reads: some deployments refuse the fine-grained scopes with 403 although they were granted.
      if (!(e instanceof ApiError && e.status === 403) || first.scopes.split(/\s+/).includes("iam-policies-management")) throw e;
      let legacy: string;
      try {
        legacy = (await accountToken(client, [LEGACY])).token;
      } catch {
        throw e;
      }
      return await publish(payload, client, legacy, env);
    }
  } catch (e) {
    const message = (e as Error)?.message ?? String(e);
    if (isBlocked(message)) return { status: "blocked", message };
    if (e instanceof ApiError && (e.status === 401 || e.status === 403))
      return {
        status: "unauthorized",
        message: `${message} The OAuth client needs ${payload.kind === "policy" ? "iam:policies:write and iam:policies:read" : "iam:boundaries:write and iam:boundaries:read"} (or iam-policies-management), and the user it acts for must be allowed to manage the account's IAM.`,
      };
    return { status: "error", message };
  }
}
