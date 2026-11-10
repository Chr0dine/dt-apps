import { credentialVaultClient } from "@dynatrace-sdk/client-classic-environment-v2";
import { getEnvironmentUrl } from "@dynatrace-sdk/app-environment";
import { readAppCredentials } from "./app-credentials";

// Creates the Problem notifications tab's migration workflows. Only apps provided by Dynatrace may request the
// automation:workflows:write scope (installing a custom app that asks for it fails with HTTP 400), so this function
// creates them with a platform token the user stores in the credential vault: a Token credential named CREDENTIAL_NAME
// ("App Engine" scope) holding a platform token (dt0s16.…) with automation:workflows:read and automation:workflows:write.
// The workflows belong to the token's user, or to the service user the token was generated for.
// A relative /platform/... fetch always carries the app's own credentials (an Authorization header passed with it is
// ignored), so the call goes to the environment's full URL; the environment's own host is reachable without an entry in
// the allowed outbound connections. Both checked with dtctl exec function on 2026-10-25.
// Workflows run with their owner's permissions, so the function only creates bodies shaped like the migration's (SIMPLE,
// MIGRATION_DESCRIPTION, Davis problem trigger, one task of ACTIONS); anyone who can use the credential could otherwise
// run arbitrary workflow code as the token's user.

const CREDENTIAL_NAME = "architect-assistant-workflows";
const WORKFLOW_API = "/platform/automation/v1/workflows";
/** Same text as MIGRATION_DESCRIPTION in ui/app/problemNotifications.ts. */
const MIGRATION_DESCRIPTION =
  "Auto Created Simple Workflow from Classic Problem Notification and corresponding Alerting Profile (via migration workflow)";
/** Task actions buildTask (problemNotifications.ts) emits. */
const ACTIONS = new Set(["dynatrace.email:send-email", "dynatrace.slack:slack-send-message", "dynatrace.servicenow:snow-create-incident", "dynatrace.automations:http-function"]);

type Payload = { action?: "status" } | { action: "create"; body?: Record<string, unknown> };

export type WorkflowsResult =
  | { status: "ok-status"; owner: string; ownerAccessOnly: boolean }
  | { status: "ok-create"; id: string }
  | { status: "no-credential" | "unauthorized" | "forbidden" | "rejected" | "error"; message: string };

type Token = { token: string; owner: string; ownerAccessOnly: boolean };

async function readToken(): Promise<Token | { error: string }> {
  // App settings first: an admin generates or stores the token once and users of the app never see it.
  const { creds } = await readAppCredentials();
  if (creds.workflowsToken) return { token: creds.workflowsToken, owner: creds.workflowsTokenInfo, ownerAccessOnly: false };
  try {
    const list = await credentialVaultClient.listCredentials({ name: `"${CREDENTIAL_NAME}"`, type: "TOKEN" });
    const cred = (list.credentials ?? []).find((c) => c.name === CREDENTIAL_NAME);
    if (!cred?.id) return { error: `No platform token in the app settings, and no Token credential named "${CREDENTIAL_NAME}" in the credential vault.` };
    const details = (await credentialVaultClient.getCredentialsDetails({ id: cred.id })) as { token?: string; owner?: string; ownerAccessOnly?: boolean };
    if (!details.token) return { error: `Credential "${CREDENTIAL_NAME}" has no token value.` };
    return { token: details.token, owner: details.owner ?? "", ownerAccessOnly: !!details.ownerAccessOnly };
  } catch (e) {
    return { error: `Could not read the credential vault: ${(e as Error)?.message ?? String(e)}` };
  }
}

/** Error message of an automation API response, with constraint violations when there are any. */
async function apiError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const b = JSON.parse(text) as { error?: { message?: string; details?: { constraintViolations?: { path?: string; message?: string }[] } } };
    const details = (b.error?.details?.constraintViolations ?? []).map((v) => [v.path, v.message].filter(Boolean).join(": ")).filter(Boolean).join("; ");
    const message = [b.error?.message, details].filter(Boolean).join(": ");
    if (message) return message;
  } catch {
    // not JSON
  }
  return text.slice(0, 300) || res.statusText || `HTTP ${res.status}`;
}

async function failure(res: Response): Promise<WorkflowsResult> {
  const message = await apiError(res);
  if (res.status === 401) return { status: "unauthorized", message: `The platform token was rejected (${message}).` };
  // Platform tokens answer 403 once they expire, too.
  if (res.status === 403) return { status: "forbidden", message: `The platform token is expired, lacks the automation:workflows scopes, or its user lacks the permission (${message}).` };
  return { status: "error", message: `Automation API returned HTTP ${res.status}: ${message}` };
}

/** Why a body is not a migration workflow, or null when it is one. */
function notMigrationShaped(body: Record<string, unknown> | undefined): string | null {
  if (!body || typeof body !== "object") return "No workflow body.";
  if (body.type !== "SIMPLE") return "Only simple workflows are created.";
  if (body.description !== MIGRATION_DESCRIPTION) return "Only workflows with the migration description are created.";
  if (typeof body.title !== "string" || !body.title.trim()) return "The workflow has no title.";
  const trigger = (body.trigger as { eventTrigger?: { triggerConfiguration?: { type?: string } } } | undefined)?.eventTrigger?.triggerConfiguration?.type;
  if (trigger !== "davis-problem") return "Only workflows with a Davis problem trigger are created.";
  const tasks = Object.values((body.tasks ?? {}) as Record<string, { action?: string }>);
  if (tasks.length !== 1 || !ACTIONS.has(String(tasks[0]?.action))) return `Only one task of ${Array.from(ACTIONS).join(", ")} is allowed.`;
  return null;
}

export default async function (payload: Payload = {}): Promise<WorkflowsResult> {
  const t = await readToken();
  if ("error" in t) return { status: "no-credential", message: t.error };
  const url = `${getEnvironmentUrl().replace(/\/+$/, "")}${WORKFLOW_API}`;
  const headers = { Authorization: `Bearer ${t.token}`, Accept: "application/json" };

  try {
    if (payload.action === "create") {
      const reason = notMigrationShaped(payload.body);
      if (reason) return { status: "rejected", message: reason };
      const res = await fetch(url, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(payload.body) });
      if (!res.ok) return failure(res);
      const created = (await res.json().catch(() => ({}))) as { id?: string };
      return { status: "ok-create", id: String(created.id ?? "") };
    }
    // Status: the token works when it can list workflows (needs automation:workflows:read; write is only proven by a create).
    const res = await fetch(`${url}?limit=1`, { headers });
    if (!res.ok) return failure(res);
    return { status: "ok-status", owner: t.owner, ownerAccessOnly: t.ownerAccessOnly };
  } catch (e) {
    return { status: "error", message: `Could not reach ${url}: ${(e as Error)?.message ?? String(e)}` };
  }
}
