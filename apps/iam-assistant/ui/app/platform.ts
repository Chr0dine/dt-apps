import { getIntentLink } from "@dynatrace-sdk/navigation";
import { getEnvironmentUrl } from "@dynatrace-sdk/app-environment";
import { httpClient } from "@dynatrace-sdk/http-client";
import { settingsObjectsClient } from "@dynatrace-sdk/client-classic-environment-v2";

// Small platform helpers the IAM tabs share. Copied from Architect Assistant, where they lived in unrelated modules
// (deepMonitoring.ts, deepDocs.ts, segments.ts, databases.ts, remediation.ts).

/** Settings schema of the JavaScript runtime outbound allowlist (app functions reach api.dynatrace.com / docs through it). */
export const OUTBOUND_SCHEMA = "builtin:dt-javascript-runtime.allowed-outbound-connections";

/** Deep link into the Settings app for one schema (optionally one entity scope). */
export function settingsLink(schemaId: string, entityId?: string): string | undefined {
  try {
    return getIntentLink({ "settings.schemaId": schemaId, ...(entityId && entityId !== "environment" ? { "settings.entityId": entityId } : {}) }, "dynatrace.settings", "open_settings_for_schema");
  } catch {
    return undefined;
  }
}

/** Best readable message from an SDK error (settings API errors carry per-item messages in `data`). */
export function errorMessage(e: unknown): string {
  const anyE = e as any;
  const data = anyE?.data;
  if (Array.isArray(data)) {
    const parts = data
      .map((d: any) => d?.error?.message ?? d?.error?.details?.map?.((x: any) => x?.message).filter(Boolean).join("; "))
      .filter(Boolean);
    if (parts.length) return parts.join(" | ");
  }
  return data?.error?.message ?? anyE?.message ?? String(e);
}

const MZ_SCHEMA = "builtin:management-zones";
export type ManagementZone = { objectId: string; name: string };

/** Management zone names (environment:management-zone condition values). */
export async function listManagementZones(): Promise<ManagementZone[]> {
  const out: ManagementZone[] = [];
  let nextPageKey: string | undefined;
  do {
    const res = await settingsObjectsClient.getSettingsObjects(nextPageKey ? { nextPageKey } : { schemaIds: MZ_SCHEMA, scopes: "environment", fields: "objectId,value", pageSize: 500 });
    for (const o of res.items ?? []) {
      const v = (o.value ?? {}) as { name?: string };
      if (v.name) out.push({ objectId: o.objectId ?? "", name: v.name });
    }
    nextPageKey = res.nextPageKey;
  } while (nextPageKey);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const EXTENSIONS_API = "/platform/extensions/v2/extensions";
const str = (v: unknown) => (v == null ? "" : String(v));

/** Every extension in the environment (extensions:extension-name condition values). */
export async function listExtensions(): Promise<{ name: string; version: string }[]> {
  const out: { name: string; version: string }[] = [];
  let key: string | undefined;
  do {
    const res = await httpClient.send({ url: `${EXTENSIONS_API}${key ? `?page-key=${encodeURIComponent(key)}` : "?page-size=100"}`, method: "GET" });
    const r = (await res.body("json")) as { items?: { extensionName?: string; version?: string }[]; nextPageKey?: string | null };
    for (const it of r?.items ?? []) out.push({ name: str(it.extensionName), version: str(it.version) });
    key = r?.nextPageKey ?? undefined;
  } while (key);
  return out;
}

/**
 * Hosts the app functions call for the Account Management API, by the stack this environment is on (mirrors
 * accountStack in api/app-credentials.ts): sprint and dev environments use their own SSO and API hosts.
 */
export function accountHosts(): string[] {
  let host = "";
  try {
    host = new URL(getEnvironmentUrl()).hostname.toLowerCase();
  } catch {
    host = typeof location !== "undefined" ? location.hostname.toLowerCase() : "";
  }
  if (host.endsWith(".dynatracelabs.com")) {
    if (/(^|\.)sprint\./.test(host)) return ["sso-sprint.dynatracelabs.com", "hard.token.dynatracelabs.com", "api-hardening.internal.dynatracelabs.com"];
    if (/(^|\.)dev\./.test(host)) return ["sso-dev.dynatracelabs.com", "dev.token.dynatracelabs.com", "api-dev.internal.dynatracelabs.com"];
  }
  return ["sso.dynatrace.com", "api.dynatrace.com"];
}
