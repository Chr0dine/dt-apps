import { credentialVaultClient } from "@dynatrace-sdk/client-classic-environment-v2";
import { getEnvironmentUrl } from "@dynatrace-sdk/app-environment";
import { readAppCredentials } from "./app-credentials";

// User tag rules ("Capturing > User tags" on a web application) are only exposed by the classic Config API v1
// (GET /api/config/v1/applications/web/{id} -> userTags). The platform has no proxy or SDK client for it, so this
// function reads a ReadConfig API token from the credential vault and calls the classic URL of this environment.
// Setup: create an API token with the "Read configuration" (ReadConfig) scope and store it in the credential vault as a
// Token credential named CREDENTIAL_NAME with the "App Engine" scope. The classic host must be in
// builtin:dt-javascript-runtime.allowed-outbound-connections.

const CREDENTIAL_NAME = "architect-assistant-readconfig";
const MAX_APPS = 500;
const CONCURRENCY = 8;

type Payload = { appIds?: string[] };

export type UserTagsResult =
  | { status: "ok"; rules: Record<string, number>; failed: string[] }
  | { status: "no-credential" | "unauthorized" | "error"; message: string };

/** https://abc123.apps.dynatrace.com -> https://abc123.live.dynatrace.com; other hosts drop the ".apps" label. */
function classicUrl(): string {
  const url = getEnvironmentUrl().replace(/\/+$/, "");
  return url.includes(".apps.dynatrace.com") ? url.replace(".apps.dynatrace.com", ".live.dynatrace.com") : url.replace(".apps.", ".");
}

export default async function (payload: Payload = {}): Promise<UserTagsResult> {
  const appIds = (payload.appIds ?? []).filter((id) => /^APPLICATION-[0-9A-F]+$/.test(id)).slice(0, MAX_APPS);

  // App settings first (an admin stores or creates the token once; users never see it), then the credential vault.
  let token: string | undefined = (await readAppCredentials()).creds.readConfigToken || undefined;
  if (!token) try {
    const list = await credentialVaultClient.listCredentials({ name: `"${CREDENTIAL_NAME}"`, type: "TOKEN" });
    const cred = (list.credentials ?? []).find((c) => c.name === CREDENTIAL_NAME) ?? list.credentials?.[0];
    if (!cred?.id) {
      return { status: "no-credential", message: `No ReadConfig token in the app settings, and no Token credential named "${CREDENTIAL_NAME}" in the credential vault.` };
    }
    const details = (await credentialVaultClient.getCredentialsDetails({ id: cred.id })) as { token?: string };
    token = details.token;
  } catch (e) {
    return { status: "no-credential", message: `Could not read the credential vault: ${(e as Error)?.message ?? String(e)}` };
  }
  if (!token) return { status: "no-credential", message: `Credential "${CREDENTIAL_NAME}" has no token value.` };

  const base = classicUrl();
  const rules: Record<string, number> = {};
  const failed: string[] = [];
  let authError: string | undefined;
  const queue = [...appIds];
  const worker = async () => {
    for (let id = queue.shift(); id && !authError; id = queue.shift()) {
      try {
        const res = await fetch(`${base}/api/config/v1/applications/web/${id}`, { headers: { Authorization: `Api-Token ${token}` } });
        if (res.status === 401 || res.status === 403) {
          authError = `Config API returned ${res.status}; the token needs the ReadConfig scope.`;
          return;
        }
        if (!res.ok) {
          failed.push(id);
          continue;
        }
        const cfg = (await res.json()) as { userTags?: unknown[] };
        rules[id] = Array.isArray(cfg.userTags) ? cfg.userTags.length : 0;
      } catch {
        failed.push(id);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (authError) return { status: "unauthorized", message: authError };
  if (appIds.length > 0 && failed.length === appIds.length) {
    return { status: "error", message: `Config API calls to ${base} failed for every application (is the host allowlisted?).` };
  }
  return { status: "ok", rules, failed };
}
