import { functions } from "@dynatrace-sdk/app-utils";
import { getEnvironmentId } from "@dynatrace-sdk/app-environment";

// Creates the IAM Policy Creator's policy or the IAM Boundary Creator's boundary in Account Management through the
// iam-publish app function (api/iam-publish.function.ts). Results mirror that function.

export type PublishKind = "policy" | "boundary";
export type PublishResult =
  | { status: "created" | "updated"; uuid: string; levelType: string; levelId: string; name: string; sent: string }
  | { status: "exists"; uuid: string; levelType: string; levelId: string; name: string }
  | { status: "invalid"; message: string; details?: string[] }
  | { status: "no-credential" | "forbidden" | "unauthorized" | "blocked" | "error"; message: string };

export async function publishToAccount(req: {
  kind: PublishKind;
  levelType?: "account" | "environment";
  name: string;
  description?: string;
  text: string;
  replace?: string;
}): Promise<PublishResult> {
  let environmentId = "";
  try {
    environmentId = getEnvironmentId();
  } catch {
    // outside the platform
  }
  try {
    const res = await functions.call("iam-publish", { data: { ...req, environmentId } });
    return (await res.json()) as PublishResult;
  } catch (e) {
    const res = (e as { cause?: unknown })?.cause;
    if (res instanceof Response) {
      if (res.status === 404) return { status: "error", message: "The iam-publish app function is not available in this running app (HTTP 404). Restart npx dt-app dev (or deploy), then retry." };
      const body = await res.text().catch(() => "");
      return { status: "error", message: `The iam-publish app function returned HTTP ${res.status}${body ? `: ${body.slice(0, 300)}` : ""}` };
    }
    return { status: "error", message: (e as Error)?.message ?? String(e) };
  }
}

/** Mirrors stripComments in the function: what is actually sent. */
export const hasComments = (text: string) => text.split(/\r?\n/).some((l) => l.trim().startsWith("//"));
