import { accountClient, callerCanManage, isBlocked, readAppCredentials, writeAppCredentials } from "./app-credentials";

// Manages the app's only credential, the account OAuth client (app settings object, see app-credentials.ts), without
// ever returning the secret:
// - status: what is configured and whether the caller may change it,
// - save-account: store what an admin typed,
// - clear: remove it.
// Every write requires app-settings:objects:write for this app (checked with the effective permissions API, and enforced
// again by the app settings API itself).

type Payload =
  | { action: "status" }
  | { action: "save-account"; accountUuid: string; clientId: string; clientSecret?: string; permissionsTestForAllUsers: boolean }
  | { action: "clear"; kind: "account" };

type Source = "app-settings" | null;
export type CredentialStatus = {
  status: "ok-status";
  canManage: boolean;
  settingsError?: string;
  account: { source: Source; accountUuid: string; clientId: string; secret: boolean; permissionsTestForAllUsers: boolean };
};
export type CredentialsResult = CredentialStatus | { status: "ok"; message: string } | { status: "forbidden" | "invalid" | "blocked" | "error"; message: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function status(): Promise<CredentialStatus> {
  const [{ creds, error }, canManage] = await Promise.all([readAppCredentials(), callerCanManage()]);
  return {
    status: "ok-status",
    canManage,
    settingsError: error,
    account: {
      source: accountClient(creds) ? "app-settings" : null,
      accountUuid: creds.accountUuid,
      clientId: creds.oauthClientId,
      secret: !!creds.oauthClientSecret,
      permissionsTestForAllUsers: creds.permissionsTestForAllUsers,
    },
  };
}

export default async function (payload: Payload): Promise<CredentialsResult> {
  if (!payload?.action) return { status: "error", message: "Missing action." };
  try {
    if (payload.action === "status") return await status();
    if (!(await callerCanManage())) return { status: "forbidden", message: "Only users who can change this app's settings (app-settings:objects:write) can change its credentials." };
    const { error } = await readAppCredentials();
    if (error) return { status: "error", message: error };
    switch (payload.action) {
      case "save-account": {
        const accountUuid = payload.accountUuid.trim().toLowerCase();
        const clientId = payload.clientId.trim();
        const clientSecret = (payload.clientSecret ?? "").trim();
        if (accountUuid && !UUID_RE.test(accountUuid)) return { status: "invalid", message: "The account UUID has the form 01234567-89ab-cdef-0123-456789abcdef." };
        if (clientId && !/^dt0s0\d\.[A-Za-z0-9]+$/.test(clientId)) return { status: "invalid", message: "That does not look like an OAuth client ID (dt0s02.XXXX)." };
        if (clientSecret && !/^dt0s0\d\.[A-Za-z0-9]+\.[A-Za-z0-9]+$/.test(clientSecret)) return { status: "invalid", message: "That does not look like an OAuth client secret (dt0s02.XXXX.YYYY)." };
        await writeAppCredentials({ accountUuid, oauthClientId: clientId, ...(clientSecret ? { oauthClientSecret: clientSecret } : {}), permissionsTestForAllUsers: !!payload.permissionsTestForAllUsers });
        return { status: "ok", message: "Account access saved in the app settings." };
      }
      case "clear":
        await writeAppCredentials({ oauthClientId: "", oauthClientSecret: "", accountUuid: "" });
        return { status: "ok", message: "Removed from the app settings." };
      default:
        return { status: "error", message: "Unknown action." };
    }
  } catch (e) {
    const message = (e as Error)?.message ?? String(e);
    return { status: isBlocked(message) ? "blocked" : "error", message };
  }
}
