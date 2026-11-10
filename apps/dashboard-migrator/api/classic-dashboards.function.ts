import { appSettingsObjectsClient } from "@dynatrace-sdk/client-app-settings-v2";
import { effectivePermissionsClient } from "@dynatrace-sdk/client-platform-management-service";
import { getAppId, getEnvironmentUrl } from "@dynatrace-sdk/app-environment";

// Classic dashboards are only exposed by the classic Config API v1 (GET /api/config/v1/dashboards[/{id}]); the platform
// has no proxy or SDK client for it. This function calls the classic URL of this environment with a ReadConfig API token
// that an admin stores once in the app settings (schema app-credentials, settings/schemas/app-credentials.schema.json).
// The token is a `secret` property: it comes back in plain text only here, inside the app's own function; the UI only
// ever learns whether it is set. The classic host may have to be added to
// builtin:dt-javascript-runtime.allowed-outbound-connections.

const SCHEMA_ID = "app-credentials";
type Creds = { readConfigToken: string; readConfigTokenInfo: string };
const EMPTY: Creds = { readConfigToken: "", readConfigTokenInfo: "" };

type Payload =
  | { action: "status" }
  | { action: "save-token"; token: string }
  | { action: "clear-token" }
  | { action: "list" }
  | { action: "get"; id: string };

export type ClassicDashboardStub = { id: string; name: string; owner?: string };
export type FnResult =
  | { status: "ok-status"; tokenSet: boolean; tokenPrefix: string | null; info: string; canManage: boolean; classicUrl: string; settingsError?: string }
  | { status: "ok-list"; dashboards: ClassicDashboardStub[] }
  | { status: "ok-get"; dashboard: unknown }
  | { status: "ok"; message: string }
  | { status: "no-token" | "unauthorized" | "forbidden" | "invalid" | "blocked" | "not-found" | "error"; message: string };

/** https://abc123.apps.dynatrace.com -> https://abc123.live.dynatrace.com; other hosts (sprint, managed) drop ".apps". */
function classicUrl(): string {
  const url = getEnvironmentUrl().replace(/\/+$/, "");
  return url.includes(".apps.dynatrace.com") ? url.replace(".apps.dynatrace.com", ".live.dynatrace.com") : url.replace(".apps.", ".");
}

async function readStored(): Promise<{ objectId: string; version: string; value: Creds } | null> {
  const r = await appSettingsObjectsClient.getAppSettingsObjects({ schemaId: SCHEMA_ID, addFields: "value" });
  const o = r.items?.[0];
  if (!o) return null;
  return { objectId: o.objectId, version: String(o.version ?? ""), value: { ...EMPTY, ...((o.value ?? {}) as Partial<Creds>) } };
}

async function write(patch: Partial<Creds>): Promise<void> {
  const stored = await readStored();
  const value = { ...(stored?.value ?? EMPTY), ...patch };
  let objectId = stored?.objectId;
  if (stored) await appSettingsObjectsClient.putAppSettingsObjectByObjectId({ objectId: stored.objectId, optimisticLockingVersion: stored.version, body: { value } });
  else objectId = (await appSettingsObjectsClient.postAppSettingsObject({ body: { schemaId: SCHEMA_ID, value } }))?.objectId;
  if (!objectId) return;
  try {
    // Only matters when the object is owner-scoped: every user's function calls must be able to read it.
    await appSettingsObjectsClient.putAppSettingsAllUsersPermissionByObjectId({ objectId, body: { permissions: ["r"] } });
  } catch {
    // no owner-based access on this schema
  }
}

async function callerCanManage(): Promise<boolean> {
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

const isBlocked = (m: string) => /allowlist|NotCapable/i.test(m);
const msg = (e: unknown) => (e as Error)?.message ?? String(e);

async function classicGet(token: string, path: string): Promise<{ ok: true; json: unknown } | { ok: false; result: FnResult }> {
  const base = classicUrl();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { headers: { Authorization: `Api-Token ${token}`, Accept: "application/json" } });
  } catch (e) {
    const m = msg(e);
    return { ok: false, result: isBlocked(m) ? { status: "blocked", message: `${m}. Add ${new URL(base).host} to Settings > Preferences > Limit outbound connections.` } : { status: "error", message: m } };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, result: { status: "unauthorized", message: `The Config API returned ${res.status}: the token needs the ReadConfig scope ("Read configuration").` } };
  if (res.status === 404) return { ok: false, result: { status: "not-found", message: "Dashboard not found." } };
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return { ok: false, result: { status: "error", message: `Config API HTTP ${res.status}${t ? `: ${t.slice(0, 300)}` : ""}` } };
  }
  return { ok: true, json: await res.json() };
}

export default async function (payload: Payload): Promise<FnResult> {
  if (!payload?.action) return { status: "error", message: "Missing action." };
  try {
    if (payload.action === "status") {
      let creds = EMPTY;
      let settingsError: string | undefined;
      try {
        creds = (await readStored())?.value ?? EMPTY;
      } catch (e) {
        settingsError = `Could not read the app settings: ${msg(e)}`;
      }
      const t = creds.readConfigToken.trim();
      const parts = t.split(".");
      return {
        status: "ok-status",
        tokenSet: !!t,
        tokenPrefix: t ? (parts.length >= 2 ? `${parts[0]}.${parts[1]}…` : "set") : null,
        info: creds.readConfigTokenInfo,
        canManage: await callerCanManage(),
        classicUrl: classicUrl(),
        settingsError,
      };
    }

    if (payload.action === "save-token" || payload.action === "clear-token") {
      if (!(await callerCanManage())) return { status: "forbidden", message: "Only users who can change this app's settings (app-settings:objects:write) can store the token." };
      if (payload.action === "clear-token") {
        await write({ readConfigToken: "", readConfigTokenInfo: "" });
        return { status: "ok", message: "Token removed from the app settings." };
      }
      const t = (payload.token ?? "").trim();
      if (!/^dt0c01\.[A-Za-z0-9]+\.[A-Za-z0-9]+$/.test(t)) return { status: "invalid", message: "That does not look like a Dynatrace API token (dt0c01.XXXX.YYYY)." };
      const probe = await classicGet(t, "/api/config/v1/dashboards?pageSize=1");
      if (!probe.ok) return probe.result;
      await write({ readConfigToken: t, readConfigTokenInfo: `Stored on ${new Date().toISOString().slice(0, 10)}.` });
      return { status: "ok", message: "Token checked against the Config API and stored in the app settings." };
    }

    const token = ((await readStored())?.value ?? EMPTY).readConfigToken.trim();
    if (!token) return { status: "no-token", message: "No ReadConfig API token is stored yet. An admin can add one in the Import tab, or paste the dashboard JSON instead." };

    if (payload.action === "list") {
      const r = await classicGet(token, "/api/config/v1/dashboards");
      if (!r.ok) return r.result;
      const list = ((r.json as { dashboards?: ClassicDashboardStub[] }).dashboards ?? []).map((d) => ({ id: d.id, name: d.name, owner: d.owner }));
      list.sort((a, b) => a.name.localeCompare(b.name));
      return { status: "ok-list", dashboards: list };
    }
    if (payload.action === "get") {
      if (!/^[A-Za-z0-9-]{1,100}$/.test(payload.id ?? "")) return { status: "invalid", message: "Invalid dashboard ID." };
      const r = await classicGet(token, `/api/config/v1/dashboards/${encodeURIComponent(payload.id)}`);
      if (!r.ok) return r.result;
      return { status: "ok-get", dashboard: r.json };
    }
    return { status: "error", message: "Unknown action." };
  } catch (e) {
    const m = msg(e);
    return isBlocked(m) ? { status: "blocked", message: m } : { status: "error", message: m };
  }
}
