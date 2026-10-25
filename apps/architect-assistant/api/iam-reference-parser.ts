// Parses the Dynatrace IAM docs into a permission catalogue. Shared by the iam-reference app function (live, at
// runtime) and scripts/sync-iam-reference.mjs (bundled snapshot ui/app/iamSnapshot.json). Pure string handling: the
// JS runtime has no DOMParser.
//
// IAM policy reference page structure (checked 2026-10-24): <h2 id="<service>">service</h2><p>title</p><p>notes…</p>,
// then per permission <h3 id="<anchor>">service:resource:action</h3><p>description</p>, optionally
// <h4>conditions:</h4><ul><li><code>key</code> - description<br/><span>operators: <code>=</code>, …</span></li></ul>.
// The page ends with <h2 id="related-topics">. Global conditions page: <h3 id="…">global:…</h3>, description <p>s and an
// "Operators: <code>…</code>" paragraph (environment and user conditions document no operator list).

export type IamCondition = { key: string; description: string; operators: string[] };
export type IamPermission = { id: string; anchor: string; description: string; conditions: IamCondition[] };
export type IamService = { id: string; anchor: string; title: string; notes: string[]; permissions: IamPermission[] };
export type IamGlobal = { key: string; anchor: string; description: string; operators: string[] };
export type IamCatalog = { updated: string | null; globalsUpdated: string | null; services: IamService[]; globals: IamGlobal[] };

export const POLICY_REFERENCE_URL =
  "https://docs.dynatrace.com/docs/manage/identity-access-management/permission-management/manage-user-permissions-policies/advanced/iam-policystatements";
export const GLOBAL_CONDITIONS_URL =
  "https://docs.dynatrace.com/docs/manage/identity-access-management/permission-management/manage-user-permissions-policies/advanced/iam-global-conditions";

const PERMISSION_RE = /^[a-z0-9-]+:[a-z0-9.-]+:[a-z0-9.-]+$/i;
const MONTHS: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

/** Visible text of an HTML fragment: icons, comments and tags dropped, whitespace collapsed. */
export const textOf = (html: string) =>
  decode(
    html
      .replace(/<svg[\s\S]*?<\/svg>/g, "")
      .replace(/<!-- -->/g, "")
      .replace(/<br\s*\/?>/g, " ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const codesOf = (html: string) => [...html.matchAll(/<code\b[^>]*>([\s\S]*?)<\/code>/g)].map((m) => textOf(m[1]));
const idOf = (attrs: string) => /\bid="([^"]+)"/.exec(attrs)?.[1] ?? "";

/** "Updated on Oct 08, 2026" / "Published Sep 01, 2024" -> "2026-10-08". */
export function pageDate(html: string): string | null {
  const m = /(?:Updated on|Published)\s+([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{4})/.exec(textOf(html.slice(0, 400000)));
  return m && MONTHS[m[1]] ? `${m[3]}-${MONTHS[m[1]]}-${m[2].padStart(2, "0")}` : null;
}

/** Main article only: from the first <h1> to the "Related topics" section (navigation and footer left out). */
function article(html: string): string {
  const start = html.indexOf("<h1");
  const body = start >= 0 ? html.slice(start) : html;
  const end = body.search(/<h2\b[^>]*id="related-topics"/);
  return end >= 0 ? body.slice(0, end) : body;
}

const BLOCK_RE = /<(h2|h3|h4|p|li)\b([^>]*)>([\s\S]*?)<\/\1>/g;

export function parsePolicyReference(html: string): { updated: string | null; services: IamService[] } {
  const services: IamService[] = [];
  let service: IamService | null = null;
  let perm: IamPermission | null = null;
  let inConditions = false;
  for (const m of article(html).matchAll(BLOCK_RE)) {
    const [, tag, attrs, inner] = m;
    if (tag === "h2") {
      const id = textOf(inner);
      service = { id, anchor: idOf(attrs) || id, title: "", notes: [], permissions: [] };
      services.push(service);
      perm = null;
      inConditions = false;
    } else if (tag === "h3" && service) {
      const id = textOf(inner).replace(/\s*:\s*/g, ":");
      inConditions = false;
      if (!PERMISSION_RE.test(id)) {
        perm = null;
        continue;
      }
      perm = { id, anchor: idOf(attrs), description: "", conditions: [] };
      service.permissions.push(perm);
    } else if (tag === "h4") {
      inConditions = !!perm && /^conditions:?$/i.test(textOf(inner));
    } else if (tag === "li" && perm && inConditions) {
      const opsAt = inner.search(/operators:/i);
      const head = opsAt >= 0 ? inner.slice(0, opsAt) : inner;
      const key = codesOf(head)[0];
      if (!key) continue;
      const description = textOf(head.replace(/<code\b[^>]*>[\s\S]*?<\/code>/, "")).replace(/^-\s*/, "");
      const operators = opsAt >= 0 ? codesOf(inner.slice(opsAt)) : [];
      perm.conditions.push({ key, description, operators });
    } else if (tag === "p" && service) {
      const text = textOf(inner);
      if (!text) continue;
      if (perm) perm.description = perm.description ? `${perm.description} ${text}` : text;
      else if (!service.title) service.title = text;
      else service.notes.push(text);
    }
  }
  return { updated: pageDate(html), services: services.filter((s) => s.permissions.length > 0) };
}

export function parseGlobalConditions(html: string): { updated: string | null; globals: IamGlobal[] } {
  const globals: IamGlobal[] = [];
  let cur: IamGlobal | null = null;
  for (const m of article(html).matchAll(BLOCK_RE)) {
    const [, tag, attrs, inner] = m;
    if (tag === "h2" || tag === "h3") {
      const key = textOf(inner);
      cur = /^global:[a-z-]+$/i.test(key) ? { key, anchor: idOf(attrs), description: "", operators: [] } : null;
      if (cur) globals.push(cur);
    } else if (tag === "p" && cur) {
      const text = textOf(inner);
      if (/^Operators:/i.test(text)) cur.operators = codesOf(inner);
      else if (!cur.description && text && !/^(Example|See |In this example)/i.test(text) && !/is used as in the following example/i.test(text)) cur.description = text;
    }
  }
  return { updated: pageDate(html), globals };
}
