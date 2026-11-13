import { accessTokensApiTokensClient, credentialVaultClient } from "@dynatrace-sdk/client-classic-environment-v2";
import { getCurrentUserDetails, getEnvironmentId } from "@dynatrace-sdk/app-environment";
import {
  accountStack,
  ApiError,
  accountClient,
  accountToken,
  callerCanManage,
  describeSecret,
  isBlocked,
  readAppCredentials,
  writeAppCredentials,
  type AppCredentials,
} from "./app-credentials";

// Manages the app's credentials (app settings object, see app-credentials.ts) without ever returning a secret:
// - status: what is configured, where from (app settings, or a credential vault entry of the earlier versions), and
//   whether the caller may change it,
// - save-account / save-token: store what an admin typed,
// - generate-workflows: create a platform token in this environment with the account's OAuth client (scope
//   platform-token:tokens:manage, POST <account API>/iam/v1/accounts/{uuid}/platform-tokens) for the caller or a
//   service user, and store it,
// - generate-readconfig: create a ReadConfig API token with the caller's permissions and store it,
// - clear: remove one token.
// Every write requires app-settings:objects:write for this app (checked with the effective permissions API, and enforced
// again by the app settings API itself).

const WORKFLOW_SCOPES = ["automation:workflows:read", "automation:workflows:write"];
const TOKEN_MANAGE_SCOPE = "platform-token:tokens:manage";
/** Credential vault names used before the app settings object (still read as a fallback by the functions). */
const VAULT = { account: "architect-assistant-account-api", workflows: "architect-assistant-workflows", readconfig: "architect-assistant-readconfig" } as const;
const MAX_DAYS = 365;

type Kind = "workflows" | "readconfig";
type Payload =
  | { action: "status" }
  | { action: "save-account"; accountUuid: string; clientId: string; clientSecret?: string; permissionsTestForAllUsers: boolean }
  | { action: "save-token"; kind: Kind; token: string }
  | { action: "generate-workflows"; userUuid?: string; userLabel?: string; days?: number }
  | { action: "generate-readconfig"; days?: number }
  | { action: "clear"; kind: Kind | "account" };

type Source = "app-settings" | "credential-vault" | null;
export type CredentialStatus = {
  status: "ok-status";
  canManage: boolean;
  settingsError?: string;
  account: { source: Source; accountUuid: string; clientId: string; secret: boolean; permissionsTestForAllUsers: boolean };
  workflows: { source: Source; token: string | null; info: string };
  readconfig: { source: Source; token: string | null; info: string };
};
export type CredentialsResult = CredentialStatus | { status: "ok"; message: string } | { status: "forbidden" | "invalid" | "blocked" | "error"; message: string };

const days = (d: number | undefined) => Math.min(MAX_DAYS, Math.max(1, Math.round(d ?? MAX_DAYS)));
const expiry = (d: number) => new Date(Date.now() + d * 86_400_000);
const me = () => {
  try {
    const u = getCurrentUserDetails();
    return { id: u.id, label: u.email || u.name || u.id };
  } catch {
    return { id: "", label: "unknown user" };
  }
};

async function vaultHas(name: string): Promise<boolean> {
  try {
    const list = await credentialVaultClient.listCredentials({ name: `"${name}"` });
    return (list.credentials ?? []).some((c) => c.name === name);
  } catch {
    return false;
  }
}

async function status(): Promise<CredentialStatus> {
  const [{ creds, error }, canManage] = await Promise.all([readAppCredentials(), callerCanManage()]);
  const fallback = async (set: boolean, name: string): Promise<Source> => (set ? "app-settings" : (await vaultHas(name)) ? "credential-vault" : null);
  const [account, workflows, readconfig] = await Promise.all([
    fallback(!!accountClient(creds), VAULT.account),
    fallback(!!creds.workflowsToken, VAULT.workflows),
    fallback(!!creds.readConfigToken, VAULT.readconfig),
  ]);
  return {
    status: "ok-status",
    canManage,
    settingsError: error,
    account: { source: account, accountUuid: creds.accountUuid, clientId: creds.oauthClientId, secret: !!creds.oauthClientSecret, permissionsTestForAllUsers: creds.permissionsTestForAllUsers },
    workflows: { source: workflows, token: describeSecret(creds.workflowsToken), info: creds.workflowsTokenInfo },
    readconfig: { source: readconfig, token: describeSecret(creds.readConfigToken), info: creds.readConfigTokenInfo },
  };
}

function failure(e: unknown): CredentialsResult {
  const message = (e as Error)?.message ?? String(e);
  if (isBlocked(message)) return { status: "blocked", message };
  if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return { status: "forbidden", message };
  return { status: "error", message };
}

/** Creates a platform token in this environment for `userUuid` (default: the caller). The account API returns the secret once. */
async function generateWorkflowsToken(creds: AppCredentials, p: Extract<Payload, { action: "generate-workflows" }>): Promise<CredentialsResult> {
  const client = accountClient(creds);
  if (!client) return { status: "invalid", message: "Store the account UUID and an OAuth client with platform-token:tokens:manage first." };
  const env = getEnvironmentId();
  const caller = me();
  const userUuid = (p.userUuid || caller.id).trim();
  if (!userUuid) return { status: "invalid", message: "No user to generate the token for." };
  const d = days(p.days);
  const { token } = await accountToken(client, [TOKEN_MANAGE_SCOPE]);
  const res = await fetch(`${accountStack().api}/iam/v1/accounts/${encodeURIComponent(client.accountUuid)}/platform-tokens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      name: `Architect Assistant workflows (${env})`,
      scope: WORKFLOW_SCOPES,
      // Limited to this environment.
      resource: [`urn:dtenvironment:${env}`],
      tags: ["architect-assistant"],
      expirationDate: expiry(d).toISOString(),
      userUuid,
    }),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new ApiError(`Creating the platform token failed: HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`, res.status);
  let secret = "";
  try {
    secret = String((JSON.parse(text) as { token?: string }).token ?? "");
  } catch {
    // not JSON
  }
  if (!secret) return { status: "error", message: "The platform token was created but the response held no token value. Paste a token instead, and delete the unused one in Account Management." };
  const who = p.userLabel?.trim() || (userUuid === caller.id ? caller.label : userUuid);
  await writeAppCredentials({ workflowsToken: secret, workflowsTokenInfo: `Generated for ${who} by ${caller.label} on ${new Date().toISOString().slice(0, 10)}, expires ${expiry(d).toISOString().slice(0, 10)}.` });
  return { status: "ok", message: `Platform token generated for ${who} (expires in ${d} days) and stored in the app settings.` };
}

async function generateReadConfigToken(p: Extract<Payload, { action: "generate-readconfig" }>): Promise<CredentialsResult> {
  const d = days(p.days);
  const created = await accessTokensApiTokensClient.createApiToken({
    body: { name: "architect-assistant-readconfig", scopes: ["ReadConfig"], expirationDate: expiry(d).toISOString(), personalAccessToken: false },
  });
  if (!created?.token) return { status: "error", message: "The API token was created but no token value was returned." };
  const caller = me();
  await writeAppCredentials({ readConfigToken: created.token, readConfigTokenInfo: `Created by ${caller.label} on ${new Date().toISOString().slice(0, 10)}, expires ${expiry(d).toISOString().slice(0, 10)}.` });
  return { status: "ok", message: `ReadConfig API token created (expires in ${d} days) and stored in the app settings.` };
}

const TOKEN_FORMAT: Record<Kind, { re: RegExp; hint: string }> = {
  workflows: { re: /^dt0s16\.[A-Za-z0-9]+\.[A-Za-z0-9]+$/, hint: "a platform token (dt0s16.XXXX.YYYY)" },
  readconfig: { re: /^dt0c01\.[A-Za-z0-9]+\.[A-Za-z0-9]+$/, hint: "a Dynatrace API token (dt0c01.XXXX.YYYY)" },
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function (payload: Payload): Promise<CredentialsResult> {
  if (!payload?.action) return { status: "error", message: "Missing action." };
  try {
    if (payload.action === "status") return await status();
    if (!(await callerCanManage())) return { status: "forbidden", message: "Only users who can change this app's settings (app-settings:objects:write) can change its credentials." };
    const { creds, error } = await readAppCredentials();
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
      case "save-token": {
        const t = payload.token.trim();
        const f = TOKEN_FORMAT[payload.kind];
        if (!f || !f.re.test(t)) return { status: "invalid", message: `That does not look like ${f?.hint ?? "a token"}.` };
        const info = `Pasted by ${me().label} on ${new Date().toISOString().slice(0, 10)}.`;
        await writeAppCredentials(payload.kind === "workflows" ? { workflowsToken: t, workflowsTokenInfo: info } : { readConfigToken: t, readConfigTokenInfo: info });
        return { status: "ok", message: "Token saved in the app settings." };
      }
      case "generate-workflows":
        return await generateWorkflowsToken(creds, payload);
      case "generate-readconfig":
        return await generateReadConfigToken(payload);
      case "clear":
        await writeAppCredentials(
          payload.kind === "workflows"
            ? { workflowsToken: "", workflowsTokenInfo: "" }
            : payload.kind === "readconfig"
              ? { readConfigToken: "", readConfigTokenInfo: "" }
              : { oauthClientId: "", oauthClientSecret: "", accountUuid: "" },
        );
        return { status: "ok", message: "Removed from the app settings." };
      default:
        return { status: "error", message: "Unknown action." };
    }
  } catch (e) {
    return failure(e);
  }
}
