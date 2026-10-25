// Last-modified dates of Dynatrace docs pages, read from the docs sitemap (one request, ~1.3 MB, ~5,400 pages with a
// <lastmod> each). The Deep Monitoring and Service Detection v2 tabs compare them with the dates recorded when their
// guidance was reviewed (ui/app/deepDocsSnapshot.json) and flag fixes whose pages changed since. `prefixes` (watched
// docs sections, DOC_SECTIONS in deepTech.ts) also returns every page under those paths, so pages published after the
// review show up as new. The browser cannot read the docs site (no CORS), hence this function. Setup: docs.dynatrace.com
// must be in builtin:dt-javascript-runtime.allowed-outbound-connections when that allowlist is enforced.

const SITEMAP = "https://docs.dynatrace.com/docs/sitemap.xml";
const MAX_URLS = 300;
const MAX_PREFIXES = 10;
const MAX_SECTION_PAGES = 200;

type Payload = { urls?: string[]; prefixes?: string[] };

export type DocsFreshness =
  | { status: "ok"; checkedAt: string; pages: Record<string, string | null>; sections: Record<string, string> }
  | { status: "blocked" | "error"; message: string };

const isDocsUrl = (u: unknown): u is string => typeof u === "string" && u.startsWith("https://docs.dynatrace.com/");
const trim = (u: string) => u.replace(/\/+$/, "");

export default async function (payload: Payload = {}): Promise<DocsFreshness> {
  const urls = (payload.urls ?? []).filter(isDocsUrl).slice(0, MAX_URLS);
  const prefixes = (payload.prefixes ?? []).filter(isDocsUrl).slice(0, MAX_PREFIXES).map(trim);
  let text: string;
  try {
    const res = await fetch(SITEMAP);
    if (!res.ok) return { status: "error", message: `The docs sitemap returned HTTP ${res.status}.` };
    text = await res.text();
  } catch (e) {
    const message = (e as Error)?.message ?? String(e);
    // The runtime rejects hosts that are not allowlisted with "NotCapable: Blocked request to '<host>' (host not in allowlist)".
    return { status: /allowlist|NotCapable/i.test(message) ? "blocked" : "error", message };
  }
  const lastmod = new Map<string, string>();
  for (const m of text.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)) lastmod.set(trim(m[1]), m[2]);
  // null = not in the sitemap: the page was moved or removed.
  const pages = Object.fromEntries(urls.map((u) => [u, lastmod.get(trim(u)) ?? null]));
  const sections: Record<string, string> = {};
  for (const [url, date] of lastmod) {
    if (Object.keys(sections).length >= MAX_SECTION_PAGES) break;
    if (prefixes.some((p) => url === p || url.startsWith(`${p}/`))) sections[url] = date;
  }
  return { status: "ok", checkedAt: new Date().toISOString(), pages, sections };
}
