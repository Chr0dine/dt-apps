import { functions } from "@dynatrace-sdk/app-utils";

// UI side of api/classic-dashboards.function.ts. The function holds the ReadConfig token; the UI never sees it.

export type ClassicDashboardStub = { id: string; name: string; owner?: string };
export type FnResult =
  | { status: "ok-status"; tokenSet: boolean; tokenPrefix: string | null; info: string; canManage: boolean; classicUrl: string; settingsError?: string }
  | { status: "ok-list"; dashboards: ClassicDashboardStub[] }
  | { status: "ok-get"; dashboard: unknown }
  | { status: "ok"; message: string }
  | { status: "no-token" | "unauthorized" | "forbidden" | "invalid" | "blocked" | "not-found" | "error"; message: string };

export async function callClassic(data: Record<string, unknown>): Promise<FnResult> {
  try {
    const res = await functions.call("classic-dashboards", { data });
    return (await res.json()) as FnResult;
  } catch (e) {
    const res = (e as { cause?: unknown })?.cause;
    if (res instanceof Response) {
      if (res.status === 404) return { status: "error", message: "The classic-dashboards app function is not available in this running app (HTTP 404). Restart npx dt-app dev (or deploy), then retry." };
      const body = await res.text().catch(() => "");
      return { status: "error", message: `The classic-dashboards app function returned HTTP ${res.status}${body ? `: ${body.slice(0, 300)}` : ""}` };
    }
    return { status: "error", message: (e as Error)?.message ?? String(e) };
  }
}
