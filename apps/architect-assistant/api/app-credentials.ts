import { appSettingsObjectsClient } from "@dynatrace-sdk/client-app-settings-v2";
import { effectivePermissionsClient } from "@dynatrace-sdk/client-platform-management-service";
import { getAppId, getEnvironmentUrl } from "@dynatrace-sdk/app-environment";

// Shared by the app functions: the app's credentials live in one app settings object (schema app-credentials,
// settings/schemas/app-credentials.schema.json). Properties of type `secret` come back in plain text only when the call
// originates from this app's functions; the UI and the app's users only ever see masked values. So an admin stores (or
// generates) a token once and every user of the app can use the features that need it without having access to it.
// Writes need app-settings:objects:write for this app (admins); the object is shared read-only with all users so their
// function calls can read it.

export const SCHEMA_ID = "app-credentials";

export type AppCredentials = {
  accountUuid: string;
  oauthClientId: string;
  oauthClientSecret: string;
  permissionsTestForAllUsers: boolean;
  workflowsToken: string;
  workflowsTokenInfo: string;
  readConfigToken: string;
  readConfigTokenInfo: string;
};
export const EMPTY: AppCredentials = {
  accountUuid: "",
  oauthClientId: "",
  oauthClientSecret: "",
  permissionsTestForAllUsers: false,
  workflowsToken: "",
  workflowsTokenInfo: "",
  readConfigToken: "",
  readConfigTokenInfo: "",
};

type Stored = { objectId: string; version: string; value: AppCredentials } | null;

/** The credentials object (plain secrets: only call this from app functions), or null when none is stored yet. */
export async function readStored(): Promise<Stored> {
  const r = await appSettingsObjectsClient.getAppSettingsObjects({ schemaId: SCHEMA_ID, addFields: "value" });
  const o = r.items?.[0];
  if (!o) return null;
  return { objectId: o.objectId, version: String(o.version ?? ""), value: { ...EMPTY, ...((o.value ?? {}) as Partial<AppCredentials>) } };
}

/** Credentials or the empty set; never throws (a read failure is returned as `error`). */
export async function readAppCredentials(): Promise<{ creds: AppCredentials; error?: string }> {
  try {
    return { creds: (await readStored())?.value ?? EMPTY };
  } catch (e) {
    return { creds: EMPTY, error: `Could not read the app settings: ${(e as Error)?.message ?? String(e)}` };
  }
}

/** Merges `patch` into the stored object (or creates it) and shares it read-only with every user of the app. */
export async function writeAppCredentials(patch: Partial<AppCredentials>): Promise<void> {
  const stored = await readStored();
  const value = { ...(stored?.value ?? EMPTY), ...patch };
  let objectId = stored?.objectId;
  if (stored) await appSettingsObjectsClient.putAppSettingsObjectByObjectId({ objectId: stored.objectId, optimisticLockingVersion: stored.version, body: { value } });
  else objectId = (await appSettingsObjectsClient.postAppSettingsObject({ body: { schemaId: SCHEMA_ID, value } }))?.objectId;
  if (!objectId) return;
  try {
    // Only matters when the object is owner-scoped; other users' function calls need to read it.
    await appSettingsObjectsClient.putAppSettingsAllUsersPermissionByObjectId({ objectId, body: { permissions: ["r"] } });
  } catch {
    // no owner-based access on this schema: every user with app-settings:objects:read can read it already
  }
}

/** Whether the calling user may change this app's settings (the app's admins). */
export async function callerCanManage(): Promise<boolean> {
  try {
    const r = await effectivePermissionsClient.resolveEffectivePermissions({
      body: {
        permissions: [
          {
            permission: "app-settings:objects:write",
            context: [
              { key: "shared:app-id", value: getAppId() },
              { key: "settings:schemaId", value: SCHEMA_ID },
            ],
          },
        ],
      },
    });
    return r.some((p) => p.permission === "app-settings:objects:write" && p.granted === "true");
  } catch {
    return false;
  }
}

/** Masks a value for status output: whether it is set, and its non-secret prefix (dt0s16.ABCD…). */
export function describeSecret(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  const parts = t.split(".");
  return parts.length >= 2 ? `${parts[0]}.${parts[1]}…` : "set";
}

// --- Account Management API token (OAuth client credentials) ---------------------------------------------------------
// Sprint and dev environments (*.sprint|dev.apps.dynatracelabs.com) belong to accounts on separate stacks, each with its
// own SSO and Account Management API. Calling production SSO with a sprint account's client answers 400 invalid_request.
// Hosts as dtctl uses them; the token endpoint is tried in order, moving on only when one is unreachable or 404s.
export type AccountStack = { name: "production" | "sprint" | "dev"; tokenUrls: string[]; api: string };
const STACKS: Record<AccountStack["name"], AccountStack> = {
  production: { name: "production", tokenUrls: ["https://sso.dynatrace.com/sso/oauth2/token"], api: "https://api.dynatrace.com" },
  sprint: {
    name: "sprint",
    tokenUrls: ["https://sso-sprint.dynatracelabs.com/sso/oauth2/token", "https://hard.token.dynatracelabs.com/sso/oauth2/token"],
    api: "https://api-hardening.internal.dynatracelabs.com",
  },
  dev: {
    name: "dev",
    tokenUrls: ["https://sso-dev.dynatracelabs.com/sso/oauth2/token", "https://dev.token.dynatracelabs.com/sso/oauth2/token"],
    api: "https://api-dev.internal.dynatracelabs.com",
  },
};

/** The SSO / Account Management stack of the environment this function runs in. */
export function accountStack(): AccountStack {
  let host = "";
  try {
    host = new URL(getEnvironmentUrl()).hostname.toLowerCase();
  } catch {
    // not in an environment (local tooling): production
  }
  if (host.endsWith(".dynatracelabs.com")) {
    if (/(^|\.)sprint\./.test(host)) return STACKS.sprint;
    if (/(^|\.)dev\./.test(host)) return STACKS.dev;
  }
  return STACKS.production;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type AccountClient = { clientId: string; clientSecret: string; accountUuid: string };

// Account tokens live 300 s; a warm function instance reuses one per client and scope set until shortly before it expires.
const tokenCache = new Map<string, { token: string; scopes: string; until: number }>();

/** POST to the stack's token endpoints in order; the next one is tried only if one cannot be reached or answers 404. */
async function postToken(stack: AccountStack, body: string): Promise<Response> {
  let lastError: unknown = null;
  for (const url of stack.tokenUrls) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
      if (res.status !== 404 || url === stack.tokenUrls[stack.tokenUrls.length - 1]) return res;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError ?? new Error(`No token endpoint of the ${stack.name} stack answered.`);
}

/** Bearer token for the Account Management API: tries each scope set in order, moving on only on invalid_scope. */
export async function accountToken(c: AccountClient, scopeSets: string[]): Promise<{ token: string; scopes: string }> {
  const stack = accountStack();
  let last = "";
  let code = "";
  for (const scope of scopeSets) {
    const key = `${stack.name}|${c.clientId}|${c.accountUuid}|${scope}`;
    const hit = tokenCache.get(key);
    if (hit && hit.until > Date.now()) return hit;
    const body = new URLSearchParams({ grant_type: "client_credentials", client_id: c.clientId, client_secret: c.clientSecret, scope, resource: `urn:dtaccount:${c.accountUuid}` });
    const res = await postToken(stack, body.toString());
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };
    if (res.ok && json.access_token) {
      const entry = { token: json.access_token, scopes: json.scope ?? scope, until: Date.now() + Math.max(30, (json.expires_in ?? 300) - 30) * 1000 };
      tokenCache.set(key, entry);
      return entry;
    }
    last = `${res.status} ${json.error ?? ""} ${json.error_description ?? ""}`.trim();
    code = json.error ?? "";
    if (code !== "invalid_scope") break;
  }
  const where = stack.name === "production" ? "" : ` by the ${stack.name} SSO (${new URL(stack.tokenUrls[0]).host})`;
  throw new ApiError(`The OAuth token request was rejected${where} (${last}). ${tokenHint(code, c.accountUuid, scopeSets)}`, 401);
}

/** What a token error from Dynatrace SSO usually means (it answers most of them with HTTP 400). */
function tokenHint(code: string, accountUuid: string, scopeSets: string[]): string {
  switch (code) {
    case "invalid_scope":
      return `The OAuth client has none of the scope sets this needs: ${scopeSets.map((s) => `"${s}"`).join(" or ")}. Add the missing scopes to the client in Account Management > Identity & access management > OAuth clients.`;
    case "invalid_client":
    case "unauthorized_client":
      return "The client ID or secret is wrong, or the client was deleted. Save the client again (the secret is shown only once, when the client is created).";
    case "invalid_request":
    case "invalid_target":
    case "invalid_resource":
      return `Check the account UUID (${accountUuid}): the token is requested for urn:dtaccount:${accountUuid}, and the OAuth client must belong to that account.`;
    default:
      return "Check the client ID, secret, account UUID and the client's scopes.";
  }
}

/** OAuth client from the app settings, if complete. */
export function accountClient(creds: AppCredentials): AccountClient | null {
  return creds.oauthClientId && creds.oauthClientSecret && creds.accountUuid ? { clientId: creds.oauthClientId, clientSecret: creds.oauthClientSecret, accountUuid: creds.accountUuid.toLowerCase() } : null;
}

/** The runtime rejects hosts that are not allowlisted with "NotCapable: Blocked request to '<host>' (host not in allowlist)". */
export const isBlocked = (message: string) => /allowlist|NotCapable/i.test(message);
