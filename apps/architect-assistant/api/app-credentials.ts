import { appSettingsObjectsClient } from "@dynatrace-sdk/client-app-settings-v2";
import { effectivePermissionsClient } from "@dynatrace-sdk/client-platform-management-service";
import { getAppId } from "@dynatrace-sdk/app-environment";

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
export const SSO = "https://sso.dynatrace.com/sso/oauth2/token";
export const ACCOUNT_API = "https://api.dynatrace.com";

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

/** Bearer token for api.dynatrace.com: tries each scope set in order, moving on only on invalid_scope. */
export async function accountToken(c: AccountClient, scopeSets: string[]): Promise<{ token: string; scopes: string }> {
  let last = "";
  for (const scope of scopeSets) {
    const key = `${c.clientId}|${c.accountUuid}|${scope}`;
    const hit = tokenCache.get(key);
    if (hit && hit.until > Date.now()) return hit;
    const body = new URLSearchParams({ grant_type: "client_credentials", client_id: c.clientId, client_secret: c.clientSecret, scope, resource: `urn:dtaccount:${c.accountUuid}` });
    const res = await fetch(SSO, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };
    if (res.ok && json.access_token) {
      const entry = { token: json.access_token, scopes: json.scope ?? scope, until: Date.now() + Math.max(30, (json.expires_in ?? 300) - 30) * 1000 };
      tokenCache.set(key, entry);
      return entry;
    }
    last = `${res.status} ${json.error ?? ""} ${json.error_description ?? ""}`.trim();
    if (json.error !== "invalid_scope") break;
  }
  throw new ApiError(`The OAuth token request was rejected (${last}). Check the client ID, secret, account UUID and the client's scopes.`, 401);
}

/** OAuth client from the app settings, if complete. */
export function accountClient(creds: AppCredentials): AccountClient | null {
  return creds.oauthClientId && creds.oauthClientSecret && creds.accountUuid ? { clientId: creds.oauthClientId, clientSecret: creds.oauthClientSecret, accountUuid: creds.accountUuid.toLowerCase() } : null;
}

/** The runtime rejects hosts that are not allowlisted with "NotCapable: Blocked request to '<host>' (host not in allowlist)". */
export const isBlocked = (message: string) => /allowlist|NotCapable/i.test(message);
