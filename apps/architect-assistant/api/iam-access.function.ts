import { credentialVaultClient } from "@dynatrace-sdk/client-classic-environment-v2";
import { ApiError, accountClient, accountToken, callerCanManage, readAppCredentials, type AccountClient } from "./app-credentials";

// Policies that apply to a user or a group, for the Permissions Test tab. Group membership, policy bindings, policies and
// boundaries are only exposed by the account-level Account Management API (https://api.dynatrace.com), which takes an
// OAuth client of the account; the environment's /platform/iam/v1 API only finds users and groups by name. The browser
// cannot call it (no CORS, no account token), hence this function.
// Setup: create an OAuth client in Account Management (Identity & access management > OAuth clients) with
// account-idm-read and either iam:bindings:read + iam:policies:read + iam:boundaries:read or iam-policies-management. An
// admin of this app stores it in the app settings (app-credentials.ts: secrets readable only by this app's functions);
// the credential vault entry CREDENTIAL_NAME of earlier versions still works as a fallback. Unless the admin allows it
// for every user, only the app's admins can run the test. sso.dynatrace.com and api.dynatrace.com must be in
// builtin:dt-javascript-runtime.allowed-outbound-connections when that allowlist is enforced.
// Calls per run: 1 token (cached for its lifetime), 1 user (or nothing for a group), 2 binding lists (account and this
// environment), 1 policy overview (policies/aggregate, inherited levels included), 1 GET per bound policy and per
// boundary, 6 at a time.

const CREDENTIAL_NAME = "architect-assistant-account-api";
const API = "https://api.dynatrace.com";
/** Read-only scopes first; clients created before the fine-grained IAM scopes have iam-policies-management instead. */
const SCOPE_SETS = ["account-idm-read iam:bindings:read iam:policies:read iam:boundaries:read", "account-idm-read iam-policies-management"];
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const CONCURRENCY = 6;
const MAX_SEARCH = 50;

type Subject = { kind: "user"; email: string } | { kind: "group"; uuid: string; name?: string };
type Payload =
  | { action?: "resolve"; environmentId: string; accountUuid?: string; subject: Subject }
  | { action: "search"; accountUuid?: string; kind: "user" | "group"; text: string }
  | { action: "status"; accountUuid?: string };

type Group = { uuid: string; name: string; owner?: string };
type Binding = { levelType: "account" | "environment"; levelId: string; policyUuid: string; groups: string[]; boundaries: string[]; parameters: Record<string, string> };
type Policy = { uuid: string; name: string; description?: string; levelType: string; levelId: string; statementQuery: string };
type Boundary = { uuid: string; name: string; boundaryQuery: string };

export type IamAccessResult =
  | {
      status: "ok";
      checkedAt: string;
      accountUuid: string;
      subject: { kind: "user" | "group"; id: string; name: string; email?: string };
      groups: Group[];
      bindings: Binding[];
      policies: Record<string, Policy>;
      boundaries: Record<string, Boundary>;
      warnings: string[];
    }
  | { status: "ok-search"; results: { id: string; name: string; email?: string; detail?: string }[]; total: number }
  | { status: "ok-status"; accountUuid: string; scopes: string; owner: string; ownerAccessOnly: boolean; source: "app-settings" | "credential-vault"; forAllUsers: boolean }
  | { status: "no-credential" | "unauthorized" | "forbidden" | "blocked" | "not-found" | "error"; message: string };

type Creds = AccountClient & { source: "app-settings" | "credential-vault"; owner: string; ownerAccessOnly: boolean; forAllUsers: boolean };

/** The account OAuth client: the app settings object first (admins store it once; users never see it), else the credential vault entry of earlier versions. */
async function readCredential(accountOverride?: string): Promise<Creds | { error: string }> {
  const { creds, error } = await readAppCredentials();
  const fromSettings = accountClient(creds);
  if (fromSettings) return { ...fromSettings, source: "app-settings", owner: "", ownerAccessOnly: false, forAllUsers: creds.permissionsTestForAllUsers };
  try {
    const list = await credentialVaultClient.listCredentials({ name: `"${CREDENTIAL_NAME}"`, type: "USERNAME_PASSWORD" });
    const cred = (list.credentials ?? []).find((c) => c.name === CREDENTIAL_NAME);
    if (!cred?.id) return { error: `No account OAuth client in the app settings${error ? ` (${error})` : ""}. An admin of this app stores it once under Account Management access.` };
    const details = (await credentialVaultClient.getCredentialsDetails({ id: cred.id })) as { username?: string; password?: string; description?: string; owner?: string; ownerAccessOnly?: boolean };
    const accountUuid = (accountOverride && UUID_RE.exec(accountOverride)?.[0]) || UUID_RE.exec(details.description ?? "")?.[0];
    if (!details.username || !details.password) return { error: `Credential "${CREDENTIAL_NAME}" has no client ID or secret.` };
    if (!accountUuid) return { error: `Credential "${CREDENTIAL_NAME}" has no account UUID in its description.` };
    // Vault credentials were owner-only or shared on purpose; keep that choice.
    return { clientId: details.username, clientSecret: details.password, accountUuid: accountUuid.toLowerCase(), source: "credential-vault", owner: details.owner ?? "", ownerAccessOnly: !!details.ownerAccessOnly, forAllUsers: true };
  } catch (e) {
    return { error: `Could not read the credential vault: ${(e as Error)?.message ?? String(e)}` };
  }
}

async function get<T>(t: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${t}`, Accept: "application/json" } });
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 300);
    throw new ApiError(`GET ${path} returned HTTP ${res.status}${text ? `: ${text}` : ""}`, res.status);
  }
  return (await res.json()) as T;
}

async function pool<T, R>(items: T[], fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]);
    }),
  );
  return out;
}

function failure(e: unknown): IamAccessResult {
  const message = (e as Error)?.message ?? String(e);
  // The runtime rejects hosts that are not allowlisted with "NotCapable: Blocked request to '<host>' (host not in allowlist)".
  if (/allowlist|NotCapable/i.test(message)) return { status: "blocked", message };
  const status = e instanceof ApiError ? e.status : 0;
  if (status === 401 || status === 403) return { status: "unauthorized", message };
  if (status === 404) return { status: "not-found", message };
  return { status: "error", message };
}

type LevelBindings = { policyBindings?: { policyUuid: string; groups?: string[]; boundaries?: string[]; parameters?: Record<string, string> }[] };

export default async function (payload: Payload): Promise<IamAccessResult> {
  if (!payload) return { status: "error", message: "Missing payload." };
  const creds = await readCredential(payload.accountUuid);
  if ("error" in creds) return { status: "no-credential", message: creds.error };
  try {
    // The test reads the account's IAM setup: only the app's admins may run it unless an admin allowed it for every user.
    if (!creds.forAllUsers && !(await callerCanManage()))
      return { status: "forbidden", message: "Only users who can change this app's settings can run the Permissions Test here. An admin can allow it for every user under Account Management access." };
    const { token: t, scopes } = await accountToken(creds, SCOPE_SETS);
    const acc = encodeURIComponent(creds.accountUuid);

    if (payload.action === "status") return { status: "ok-status", accountUuid: creds.accountUuid, scopes, owner: creds.owner, ownerAccessOnly: creds.ownerAccessOnly, source: creds.source, forAllUsers: creds.forAllUsers };

    if (payload.action === "search") {
      const needle = (payload.text ?? "").trim().toLowerCase();
      if (needle.length < 3) return { status: "ok-search", results: [], total: 0 };
      if (payload.kind === "user") {
        const r = await get<{ items?: { uid: string; email: string; name?: string; surname?: string; userStatus?: string }[] }>(t, `/iam/v1/accounts/${acc}/users`);
        const hits = (r.items ?? []).filter((u) => u.email.toLowerCase().includes(needle) || `${u.name ?? ""} ${u.surname ?? ""}`.toLowerCase().includes(needle) || `${u.surname ?? ""} ${u.name ?? ""}`.toLowerCase().includes(needle));
        return { status: "ok-search", total: hits.length, results: hits.slice(0, MAX_SEARCH).map((u) => ({ id: u.uid, name: `${u.name ?? ""} ${u.surname ?? ""}`.trim() || u.email, email: u.email, detail: u.userStatus })) };
      }
      const r = await get<{ items?: { uuid: string; name: string; owner?: string; description?: string }[] }>(t, `/iam/v1/accounts/${acc}/groups`);
      const hits = (r.items ?? []).filter((g) => g.name.toLowerCase().includes(needle));
      return { status: "ok-search", total: hits.length, results: hits.slice(0, MAX_SEARCH).map((g) => ({ id: g.uuid, name: g.name, detail: g.owner })) };
    }

    const env = (payload.environmentId ?? "").trim();
    if (!/^[\w-]+$/.test(env)) return { status: "error", message: "Missing environment ID." };
    const warnings: string[] = [];

    // 1. The subject's groups.
    let subject: Extract<IamAccessResult, { status: "ok" }>["subject"];
    let groups: Group[];
    if (payload.subject.kind === "user") {
      const u = await get<{ uid: string; email: string; name?: string; surname?: string; groups?: { uuid: string; groupName: string; owner?: string }[] }>(
        t,
        `/iam/v1/accounts/${acc}/users/${encodeURIComponent(payload.subject.email.trim())}`,
      );
      subject = { kind: "user", id: u.uid, name: `${u.name ?? ""} ${u.surname ?? ""}`.trim() || u.email, email: u.email };
      groups = (u.groups ?? []).map((g) => ({ uuid: g.uuid, name: g.groupName, owner: g.owner }));
    } else {
      const uuid = payload.subject.uuid.trim();
      let name = payload.subject.name ?? uuid;
      if (!payload.subject.name) {
        const all = await get<{ items?: { uuid: string; name: string; owner?: string }[] }>(t, `/iam/v1/accounts/${acc}/groups`);
        name = all.items?.find((g) => g.uuid === uuid)?.name ?? uuid;
      }
      subject = { kind: "group", id: uuid, name };
      groups = [{ uuid, name }];
    }
    const groupIds = new Set(groups.map((g) => g.uuid));

    // 2. Bindings on the account (all environments) and on this environment that name one of those groups.
    const levels: { levelType: "account" | "environment"; levelId: string }[] = [
      { levelType: "account", levelId: creds.accountUuid },
      { levelType: "environment", levelId: env },
    ];
    const bindings: Binding[] = [];
    for (const l of levels) {
      try {
        const r = await get<LevelBindings>(t, `/iam/v1/repo/${l.levelType}/${encodeURIComponent(l.levelId)}/bindings`);
        for (const b of r.policyBindings ?? [])
          for (const g of b.groups ?? [])
            if (groupIds.has(g)) bindings.push({ ...l, policyUuid: b.policyUuid, groups: [g], boundaries: b.boundaries ?? [], parameters: b.parameters ?? {} });
      } catch (e) {
        if (e instanceof ApiError && e.status === 404 && l.levelType === "environment") warnings.push(`Environment ${env} was not found in account ${creds.accountUuid}; only account-level bindings are shown.`);
        else throw e;
      }
    }

    // 3. The bound policies, wherever they are defined (global = Dynatrace default policies, account, environment).
    const overview = await get<{ policyOverviewList?: { uuid: string; name: string; description?: string; levelType: string; levelId: string }[] }>(
      t,
      `/iam/v1/repo/environment/${encodeURIComponent(env)}/policies/aggregate`,
    ).catch(() => get<{ policyOverviewList?: { uuid: string; name: string; description?: string; levelType: string; levelId: string }[] }>(t, `/iam/v1/repo/account/${acc}/policies/aggregate`));
    const where = new Map((overview.policyOverviewList ?? []).map((p) => [p.uuid, p]));
    const policyIds = [...new Set(bindings.map((b) => b.policyUuid))];
    const policies: Record<string, Policy> = {};
    await pool(policyIds, async (id) => {
      const o = where.get(id);
      const candidates = o ? [{ levelType: o.levelType, levelId: o.levelId }] : [{ levelType: "global", levelId: "global" }, ...levels];
      for (const c of candidates) {
        try {
          const p = await get<{ uuid: string; name: string; description?: string; statementQuery?: string }>(t, `/iam/v1/repo/${c.levelType}/${encodeURIComponent(c.levelId)}/policies/${encodeURIComponent(id)}`);
          policies[id] = { uuid: id, name: p.name, description: p.description, levelType: c.levelType, levelId: c.levelId, statementQuery: p.statementQuery ?? "" };
          return;
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 404)) throw e;
        }
      }
      warnings.push(`Policy ${id} is bound but could not be read at any level.`);
    });

    // 4. Boundaries used by those bindings (boundaries live on the account).
    const boundaryIds = [...new Set(bindings.flatMap((b) => b.boundaries))];
    const boundaries: Record<string, Boundary> = {};
    await pool(boundaryIds, async (id) => {
      try {
        const b = await get<{ uuid: string; name: string; boundaryQuery?: string }>(t, `/iam/v1/repo/account/${acc}/boundaries/${encodeURIComponent(id)}`);
        boundaries[id] = { uuid: id, name: b.name, boundaryQuery: b.boundaryQuery ?? "" };
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) warnings.push(`Boundary ${id} is used in a binding but could not be read.`);
        else throw e;
      }
    });

    return { status: "ok", checkedAt: new Date().toISOString(), accountUuid: creds.accountUuid, subject, groups, bindings, policies, boundaries, warnings };
  } catch (e) {
    return failure(e);
  }
}
