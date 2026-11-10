import { useCallback, useEffect, useState } from "react";
import { functions } from "@dynatrace-sdk/app-utils";
import { getEnvironmentId } from "@dynatrace-sdk/app-environment";
import { usersAndGroupsClient } from "@dynatrace-sdk/client-iam";

// ---------------------------------------------------------------------------
// The app's credentials (account OAuth client, platform token for workflows, ReadConfig API token) live in one app
// settings object whose secret fields only the app's functions can read (api/app-credentials.ts). The UI never sees a
// secret: it asks the app-credentials function what is configured, and admins (app-settings:objects:write for this
// app) save or generate tokens through it. Results mirror api/app-credentials.function.ts.
// ---------------------------------------------------------------------------

export type CredentialUse = "account" | "workflows" | "readconfig";
export type Source = "app-settings" | "credential-vault" | null;
export type CredentialStatus = {
  status: "ok-status";
  canManage: boolean;
  settingsError?: string;
  account: { source: Source; accountUuid: string; clientId: string; secret: boolean; permissionsTestForAllUsers: boolean };
  workflows: { source: Source; token: string | null; info: string };
  readconfig: { source: Source; token: string | null; info: string };
};
export type ActionResult = { ok: boolean; message: string };

type FnResult = CredentialStatus | { status: "ok"; message: string } | { status: "forbidden" | "invalid" | "blocked" | "error"; message: string };

async function call(data: Record<string, unknown>): Promise<FnResult> {
  try {
    const res = await functions.call("app-credentials", { data });
    return (await res.json()) as FnResult;
  } catch (e) {
    const res = (e as { cause?: unknown })?.cause;
    if (res instanceof Response) {
      if (res.status === 404) return { status: "error", message: "The app-credentials app function is not available in this running app (HTTP 404). Restart npx dt-app dev (or deploy), then retry." };
      const body = await res.text().catch(() => "");
      return { status: "error", message: `The app-credentials app function returned HTTP ${res.status}${body ? `: ${body.slice(0, 300)}` : ""}` };
    }
    return { status: "error", message: (e as Error)?.message ?? String(e) };
  }
}

// One status read shared by every card on the page; refreshed after each change.
let pending: Promise<CredentialStatus | ActionResult> | null = null;
const listeners = new Set<(s: CredentialStatus | ActionResult) => void>();
function load(): Promise<CredentialStatus | ActionResult> {
  pending ??= call({ action: "status" }).then((r) => (r.status === "ok-status" ? r : { ok: false, message: r.message }));
  return pending;
}
export function refreshCredentials(): void {
  pending = null;
  void load().then((s) => listeners.forEach((l) => l(s)));
}

/** Status of the app's credentials (null while loading; `{ ok: false }` when it could not be read). */
export function useCredentials(): { state: CredentialStatus | ActionResult | null; refresh: () => void } {
  const [state, setState] = useState<CredentialStatus | ActionResult | null>(null);
  useEffect(() => {
    let cancelled = false;
    const l = (s: CredentialStatus | ActionResult) => !cancelled && setState(s);
    listeners.add(l);
    void load().then(l);
    return () => {
      cancelled = true;
      listeners.delete(l);
    };
  }, []);
  return { state, refresh: useCallback(refreshCredentials, []) };
}

async function act(data: Record<string, unknown>): Promise<ActionResult> {
  const r = await call(data);
  const result = r.status === "ok" ? { ok: true, message: r.message } : { ok: false, message: "message" in r ? r.message : `Unexpected response (${r.status}).` };
  if (result.ok) refreshCredentials();
  return result;
}

export const saveAccount = (v: { accountUuid: string; clientId: string; clientSecret: string; permissionsTestForAllUsers: boolean }) => act({ action: "save-account", ...v });
export const saveToken = (kind: "workflows" | "readconfig", token: string) => act({ action: "save-token", kind, token });
export const generateWorkflowsToken = (v: { userUuid?: string; userLabel?: string; days: number }) => act({ action: "generate-workflows", ...v });
export const generateReadConfigToken = (days: number) => act({ action: "generate-readconfig", days });
export const clearCredential = (kind: CredentialUse) => act({ action: "clear", kind });

export type ServiceUser = { uid: string; name: string; email?: string };
/** Service users the current user may generate tokens for (environment IAM API, iam:service-users:use). */
export async function listServiceUsers(): Promise<ServiceUser[]> {
  const r = await usersAndGroupsClient.getAvailableServiceUsers({ levelType: "environment", levelId: getEnvironmentId(), pageSize: 200 });
  return (r.results ?? []).filter((u) => !!u.uid).map((u) => ({ uid: u.uid!, name: [u.name, u.surname].filter(Boolean).join(" ") || u.email || u.uid!, email: u.email }));
}

export const PLATFORM_TOKEN_SCOPES = ["automation:workflows:read", "automation:workflows:write"];
export const ACCOUNT_SCOPES = ["account-idm-read", "iam:bindings:read", "iam:policies:read", "iam:boundaries:read"];
export const TOKEN_MANAGE_SCOPE = "platform-token:tokens:manage";
const DOC = {
  platformTokens: { title: "Platform tokens", url: "https://docs.dynatrace.com/docs/manage/identity-access-management/access-tokens-and-oauth-clients/platform-tokens" },
  platformTokensApi: { title: "Platform tokens API", url: "https://docs.dynatrace.com/docs/dynatrace-api/account-management-api/platform-tokens-api" },
  oauth: { title: "OAuth clients", url: "https://docs.dynatrace.com/docs/manage/identity-access-management/access-tokens-and-oauth-clients/oauth-clients" },
  accountApi: { title: "Account Management API", url: "https://docs.dynatrace.com/docs/dynatrace-api/account-management-api" },
  accessTokens: { title: "Access tokens", url: "https://docs.dynatrace.com/docs/manage/identity-access-management/access-tokens-and-oauth-clients/access-tokens" },
};
export const CREDENTIAL_DOCS: Record<CredentialUse, { title: string; url: string }[]> = {
  account: [DOC.oauth, DOC.accountApi, DOC.platformTokensApi],
  workflows: [DOC.platformTokens, DOC.platformTokensApi],
  readconfig: [DOC.accessTokens],
};
