// Live IAM permission catalogue for the IAM Policy Creator and IAM Boundary Creator tabs: reads the IAM policy reference
// and the global conditions page from docs.dynatrace.com and parses them (iam-reference-parser.ts), so new or changed
// permissions, conditions and operators show up without an app update. The UI falls back to the bundled snapshot
// (ui/app/iamSnapshot.json, `npm run sync-iam`) when this fails. The browser cannot read the docs site (no CORS), hence
// this function. Setup: docs.dynatrace.com must be in builtin:dt-javascript-runtime.allowed-outbound-connections when
// that allowlist is enforced (same as docs-freshness).
import { GLOBAL_CONDITIONS_URL, POLICY_REFERENCE_URL, parseGlobalConditions, parsePolicyReference, type IamCatalog } from "./iam-reference-parser";

export type IamReferenceResult =
  | { status: "ok"; checkedAt: string; catalog: IamCatalog }
  | { status: "blocked" | "error"; message: string };

async function page(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}.`);
  return res.text();
}

export default async function (): Promise<IamReferenceResult> {
  let reference: string;
  let globals: string;
  try {
    [reference, globals] = await Promise.all([page(POLICY_REFERENCE_URL), page(GLOBAL_CONDITIONS_URL)]);
  } catch (e) {
    const message = (e as Error)?.message ?? String(e);
    // The runtime rejects hosts that are not allowlisted with "NotCapable: Blocked request to '<host>' (host not in allowlist)".
    return { status: /allowlist|NotCapable/i.test(message) ? "blocked" : "error", message };
  }
  const ref = parsePolicyReference(reference);
  const glob = parseGlobalConditions(globals);
  // A page redesign would parse to nothing; report that instead of an empty catalogue so the UI keeps the snapshot.
  if (ref.services.length < 5) return { status: "error", message: `The IAM policy reference parsed to ${ref.services.length} services; the page layout may have changed.` };
  return {
    status: "ok",
    checkedAt: new Date().toISOString(),
    catalog: { updated: ref.updated, globalsUpdated: glob.updated, services: ref.services, globals: glob.globals },
  };
}
