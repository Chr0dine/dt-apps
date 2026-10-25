import { functions } from "@dynatrace-sdk/app-utils";
import { getEnvironmentId } from "@dynatrace-sdk/app-environment";
import { usersAndGroupsClient } from "@dynatrace-sdk/client-iam";
import { credentialVaultClient } from "@dynatrace-sdk/client-classic-environment-v2";
import { errorMessage, type SubmitResult } from "./remediation";
import type { AccessBinding, AccessSubject } from "./iamAccess";

// ---------------------------------------------------------------------------
// Data for the Permissions Test tab:
// - finding a user (name or email) or a group (name contains): the environment's IAM API (@dynatrace-sdk/client-iam,
//   iam:users:read / iam:groups:read), falling back to the account's user and group lists through the iam-access
//   function when the environment API is not allowed for the current user,
// - what applies to the subject: the iam-access app function (Account Management API: groups, bindings, policies,
//   boundaries), turned into AccessBindings for the engine in iamAccess.ts,
// - the OAuth client the function uses, stored in the credential vault (CREDENTIAL_NAME, account UUID in the description).
// ---------------------------------------------------------------------------

export const ACCOUNT_CREDENTIAL = "architect-assistant-account-api";
export const OAUTH_SCOPES = ["account-idm-read", "iam:bindings:read", "iam:policies:read", "iam:boundaries:read"];
export const OAUTH_SCOPES_LEGACY = ["account-idm-read", "iam-policies-management"];
export const OUTBOUND_HOSTS = ["sso.dynatrace.com", "api.dynatrace.com"];
export const ACCESS_DOCS = {
  oauth: { title: "OAuth clients", url: "https://docs.dynatrace.com/docs/manage/identity-access-management/access-tokens-and-oauth-clients/oauth-clients" },
  accountApi: { title: "Account Management API", url: "https://docs.dynatrace.com/docs/dynatrace-api/account-management-api" },
  accountAuth: { title: "Account Management API authentication", url: "https://docs.dynatrace.com/docs/dynatrace-api/basics/dynatrace-api-authentication/account-api-authentication" },
  bindings: { title: "Policy bindings API", url: "https://docs.dynatrace.com/docs/dynatrace-api/account-management-api/policy-management-api/bindings/get-level-binding" },
  credentialVault: { title: "Credential vault", url: "https://docs.dynatrace.com/docs/manage/credential-vault" },
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID_RE.test(v.trim());

// --- Function results (mirror api/iam-access.function.ts) -------------------------------------------------------
type FnGroup = { uuid: string; name: string; owner?: string };
type FnBinding = { levelType: "account" | "environment"; levelId: string; policyUuid: string; groups: string[]; boundaries: string[]; parameters: Record<string, string> };
type FnResult =
  | {
      status: "ok";
      checkedAt: string;
      accountUuid: string;
      subject: { kind: "user" | "group"; id: string; name: string; email?: string };
      groups: FnGroup[];
      bindings: FnBinding[];
      policies: Record<string, { uuid: string; name: string; description?: string; levelType: string; levelId: string; statementQuery: string }>;
      boundaries: Record<string, { uuid: string; name: string; boundaryQuery: string }>;
      warnings: string[];
    }
  | { status: "ok-search"; results: SearchHit[]; total: number }
  | { status: "ok-status"; accountUuid: string; scopes: string; owner: string; ownerAccessOnly: boolean }
  | { status: FailureStatus; message: string };
export type FailureStatus = "no-credential" | "unauthorized" | "blocked" | "not-found" | "error";
export type Failure = { status: FailureStatus; message: string };

/** functions.call keeps the HTTP response as `cause`; 404 = the function is not part of the running app. */
async function describeFailure(e: unknown): Promise<Failure> {
  const res = (e as { cause?: unknown })?.cause;
  if (res instanceof Response) {
    if (res.status === 404) return { status: "error", message: "the iam-access app function is not available in this running app (HTTP 404). Restart npx dt-app dev (or deploy), then retry." };
    let body = "";
    try {
      body = (await res.text()).slice(0, 300);
    } catch {
      // body already consumed or unreadable
    }
    return { status: "error", message: `the iam-access app function returned HTTP ${res.status}${body ? `: ${body}` : ""}` };
  }
  return { status: "error", message: (e as Error)?.message ?? String(e) };
}

async function call(data: Record<string, unknown>): Promise<FnResult> {
  try {
    const res = await functions.call("iam-access", { data });
    return (await res.json()) as FnResult;
  } catch (e) {
    return describeFailure(e);
  }
}

const env = () => {
  try {
    return getEnvironmentId();
  } catch {
    return "";
  }
};

// --- Search --------------------------------------------------------------------------------------------------------
export type SearchHit = { id: string; name: string; email?: string; detail?: string };
export type SearchResult = { hits: SearchHit[]; total: number; source: "environment" | "account"; note?: string } | Failure;

/** Users whose email contains the text or whose name starts with it; groups whose name contains it (3+ characters). */
export async function searchSubjects(kind: "user" | "group", text: string): Promise<SearchResult> {
  const q = text.trim();
  if (q.length < 3) return { hits: [], total: 0, source: "environment" };
  let envError = "";
  try {
    if (kind === "user") {
      const r = await usersAndGroupsClient.getActiveUsersForOrganizationalLevel({ levelType: "environment", levelId: env(), partialString: q, pageSize: 50 });
      return {
        source: "environment",
        total: r.totalCount ?? r.results?.length ?? 0,
        hits: (r.results ?? []).map((u) => ({ id: u.uid, name: `${u.name ?? ""} ${u.surname ?? ""}`.trim() || u.email, email: u.email, detail: u.description })),
      };
    }
    const r = await usersAndGroupsClient.getVisibleGroupsForAccount({ levelType: "environment", levelId: env(), partialGroupName: q, pageSize: 50 });
    return { source: "environment", total: r.totalCount ?? r.results?.length ?? 0, hits: (r.results ?? []).map((g) => ({ id: g.uuid, name: g.groupName, detail: g.type })) };
  } catch (e) {
    envError = errorMessage(e);
  }
  // The environment API needs the user to be assigned to the account; the account API lists everyone.
  const r = await call({ action: "search", kind, text: q });
  if (r.status === "ok-search") return { hits: r.results, total: r.total, source: "account", note: `Environment IAM API: ${envError}` };
  if ("message" in r) return { status: r.status, message: `${envError} · Account Management API: ${r.message}` };
  return { status: "error", message: envError };
}

// --- Resolve -------------------------------------------------------------------------------------------------------
export type Resolved = { subject: AccessSubject; bindings: AccessBinding[]; warnings: string[]; checkedAt: string; accountUuid: string; environmentId: string };

export async function resolveSubject(target: { kind: "user"; email: string } | { kind: "group"; uuid: string; name?: string }): Promise<Resolved | Failure> {
  const environmentId = env();
  const r = await call({ action: "resolve", environmentId, subject: target });
  if (r.status !== "ok") return "message" in r ? r : { status: "error", message: `Unexpected response (${r.status}).` };
  const groupName = new Map(r.groups.map((g) => [g.uuid, g.name]));
  const bindings: AccessBinding[] = [];
  for (const b of r.bindings) {
    const policy = r.policies[b.policyUuid];
    if (!policy) continue;
    for (const g of b.groups)
      bindings.push({
        groupUuid: g,
        groupName: groupName.get(g) ?? g,
        levelType: b.levelType,
        levelId: b.levelId,
        policy,
        boundaries: b.boundaries.map((id) => r.boundaries[id]).filter((x): x is NonNullable<typeof x> => !!x),
        parameters: b.parameters,
      });
  }
  bindings.sort((a, b) => a.groupName.localeCompare(b.groupName) || a.policy.name.localeCompare(b.policy.name));
  return {
    subject: { kind: r.subject.kind, id: r.subject.id, name: r.subject.name, email: r.subject.email, groups: r.groups.map((g) => ({ uuid: g.uuid, name: g.name })) },
    bindings,
    warnings: r.warnings,
    checkedAt: r.checkedAt,
    accountUuid: r.accountUuid,
    environmentId,
  };
}

// --- Setup ---------------------------------------------------------------------------------------------------------
export type SetupStatus = { state: "ok"; accountUuid: string; scopes: string; owner: string; ownerAccessOnly: boolean } | { state: "missing" | "failing"; failure: Failure };

/** Whether the function can read the credential and get an account token. */
export async function readSetupStatus(): Promise<SetupStatus> {
  const r = await call({ action: "status" });
  if (r.status === "ok-status") return { state: "ok", accountUuid: r.accountUuid, scopes: r.scopes, owner: r.owner, ownerAccessOnly: r.ownerAccessOnly };
  const failure: Failure = "message" in r ? r : { status: "error", message: `Unexpected response (${r.status}).` };
  return { state: failure.status === "no-credential" ? "missing" : "failing", failure };
}

/** Stores (or replaces) the OAuth client in the credential vault. */
export async function storeAccountCredential(clientId: string, clientSecret: string, accountUuid: string, ownerAccessOnly: boolean): Promise<SubmitResult> {
  const id = clientId.trim();
  const secret = clientSecret.trim();
  const account = accountUuid.trim().toLowerCase();
  if (!/^dt0s0\d\.[A-Za-z0-9]+$/.test(id)) return { ok: false, message: "That does not look like an OAuth client ID (dt0s02.XXXX)." };
  if (!/^dt0s0\d\.[A-Za-z0-9]+\.[A-Za-z0-9]+$/.test(secret)) return { ok: false, message: "That does not look like an OAuth client secret (dt0s02.XXXX.YYYY)." };
  if (!isUuid(account)) return { ok: false, message: "The account UUID has the form 01234567-89ab-cdef-0123-456789abcdef (Account Management > OAuth clients shows it)." };
  const body = {
    name: ACCOUNT_CREDENTIAL,
    description: `Architect Assistant Permissions Test: OAuth client for the Account Management API (read-only). Account UUID: ${account}`,
    type: "USERNAME_PASSWORD" as const,
    user: id,
    password: secret,
    scopes: ["APP_ENGINE" as const],
    // Owner only: just the person who stores it can run the test. Off: everyone who can run the app can read the account's IAM setup.
    ownerAccessOnly,
  };
  try {
    const list = await credentialVaultClient.listCredentials({ name: `"${ACCOUNT_CREDENTIAL}"`, type: "USERNAME_PASSWORD" });
    const existing = (list.credentials ?? []).find((c) => c.name === ACCOUNT_CREDENTIAL);
    if (existing?.id) {
      await credentialVaultClient.updateCredentials({ id: existing.id, body });
      return { ok: true, message: `Credential "${ACCOUNT_CREDENTIAL}" updated.`, objectId: existing.id };
    }
    const res = await credentialVaultClient.createCredentials({ body });
    return { ok: true, message: `Credential "${ACCOUNT_CREDENTIAL}" created.`, objectId: res?.id };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}
