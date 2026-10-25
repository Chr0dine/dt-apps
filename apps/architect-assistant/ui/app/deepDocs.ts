import { useEffect, useState } from "react";
import { functions } from "@dynatrace-sdk/app-utils";
import snapshot from "./deepDocsSnapshot.json";
import { DOC, DOC_SECTIONS } from "./deepTech";
import type { DocLink } from "./remediation";

// ---------------------------------------------------------------------------
// Docs freshness for the Deep Monitoring catalogue and the Service Detection v2 tab. deepDocsSnapshot.json holds the
// docs-sitemap lastmod of every Dynatrace page the catalogue cites (DOC in deepTech.ts) and of every page in the watched
// sections (DOC_SECTIONS), as of the last review (`npm run check-docs -- --accept`). At runtime the docs-freshness app
// function reads the live sitemap; pages updated since the review, or no longer in the sitemap, are flagged on the fixes
// that cite them, and pages published in a watched section since the review are listed as new, so stale guidance is
// visible until the catalogue is reviewed again.
// ---------------------------------------------------------------------------

export const DOCS_REVIEWED: string = snapshot.reviewed;
const REVIEWED_PAGES: Record<string, string> = snapshot.pages;
const URLS = [...new Set(Object.values(DOC).map((d) => d.url))].filter((u) => u.startsWith("https://docs.dynatrace.com/"));
const CITED = new Set(URLS);
const PREFIXES = DOC_SECTIONS.map((s) => s.prefix);
const inSection = (url: string, prefix: string) => url === prefix || url.startsWith(`${prefix}/`);
export const OUTBOUND_SCHEMA = "builtin:dt-javascript-runtime.allowed-outbound-connections";

export type DocChange = { kind: "updated"; date: string } | { kind: "missing" };
export type DocsFreshness =
  | { status: "loading" }
  | {
      status: "ok";
      checkedAt: string;
      changes: Map<string, DocChange>;
      /** Live sitemap lastmod (YYYY-MM-DD) of every cited page and every page in a watched section. */
      live: Map<string, string>;
      /** Pages in a watched section that are neither cited nor in the snapshot: published (or moved) after the review. */
      newPages: { url: string; date: string; section: string }[];
    }
  | { status: "blocked" | "error"; message: string };

type FunctionResult =
  | { status: "ok"; checkedAt: string; pages: Record<string, string | null>; sections?: Record<string, string> }
  | { status: "blocked" | "error"; message: string };

function toState(r: FunctionResult): DocsFreshness {
  if (r.status !== "ok") return r;
  const changes = new Map<string, DocChange>();
  const live = new Map<string, string>();
  const sections = r.sections ?? {};
  const all: Record<string, string | null> = { ...sections, ...r.pages };
  for (const [url, date] of Object.entries(all)) {
    if (date) live.set(url, date.slice(0, 10));
    const reviewed = REVIEWED_PAGES[url];
    if (date === null) changes.set(url, { kind: "missing" });
    else if (date && reviewed && date > reviewed) changes.set(url, { kind: "updated", date: date.slice(0, 10) });
    else if (date && !reviewed && CITED.has(url)) changes.set(url, { kind: "updated", date: date.slice(0, 10) });
  }
  // Snapshot pages of a watched section that left the sitemap (moved or removed).
  for (const url of Object.keys(REVIEWED_PAGES)) if (!CITED.has(url) && PREFIXES.some((p) => inSection(url, p)) && !(url in sections)) changes.set(url, { kind: "missing" });
  const newPages = Object.entries(sections)
    .filter(([url]) => !CITED.has(url) && !REVIEWED_PAGES[url])
    .map(([url, date]) => ({ url, date: date.slice(0, 10), section: DOC_SECTIONS.find((s) => inSection(url, s.prefix))?.title ?? "" }))
    .sort((a, b) => b.date.localeCompare(a.date));
  return { status: "ok", checkedAt: r.checkedAt, changes, live, newPages };
}

/**
 * functions.call throws a generic "Function <name> has failed" and keeps the HTTP response as `cause`; turn that into
 * something actionable. 404 = the function is not part of the running app (added after `npx dt-app dev` started, or
 * the deployed version predates it).
 */
async function describeFailure(e: unknown): Promise<string> {
  const res = (e as { cause?: unknown })?.cause;
  if (res instanceof Response) {
    if (res.status === 404) {
      return "the docs-freshness app function is not available in this running app (HTTP 404). App functions are loaded when npx dt-app dev starts and when the app is deployed: restart the dev server (or deploy), then retry.";
    }
    let body = "";
    try {
      body = (await res.text()).slice(0, 300);
    } catch {
      // body already consumed or unreadable
    }
    return `the docs-freshness app function returned HTTP ${res.status}${body ? `: ${body}` : ""}`;
  }
  return (e as Error)?.message ?? String(e);
}

// One sitemap read per page load, shared by every component; a failed read can be retried.
let pending: Promise<DocsFreshness> | null = null;
const listeners = new Set<(s: DocsFreshness) => void>();
function load(): Promise<DocsFreshness> {
  pending ??= functions
    .call("docs-freshness", { data: { urls: URLS, prefixes: PREFIXES } })
    .then((res) => res.json())
    .then((r: FunctionResult) => toState(r))
    .catch(async (e): Promise<DocsFreshness> => ({ status: "error", message: await describeFailure(e) }));
  return pending;
}

/** Re-runs the check (after a failure or once the allowlist / dev server changed) and updates every subscriber. */
export function retryDocsFreshness(): void {
  pending = null;
  listeners.forEach((l) => l({ status: "loading" }));
  void load().then((s) => listeners.forEach((l) => l(s)));
}

export function useDocsFreshness(): DocsFreshness {
  const [state, setState] = useState<DocsFreshness>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    const listener = (s: DocsFreshness) => !cancelled && setState(s);
    listeners.add(listener);
    void load().then(listener);
    return () => {
      cancelled = true;
      listeners.delete(listener);
    };
  }, []);
  return state;
}

/** The cited pages (of `docs`) that changed since the review. */
export function changedDocs(state: DocsFreshness, docs: DocLink[]): { doc: DocLink; change: DocChange }[] {
  if (state.status !== "ok") return [];
  return docs.flatMap((doc) => {
    const change = state.changes.get(doc.url);
    return change ? [{ doc, change }] : [];
  });
}

/** Review date (YYYY-MM-DD) recorded for a page in the snapshot, if any. */
export const reviewedDate = (url: string): string | undefined => REVIEWED_PAGES[url]?.slice(0, 10);

/** Changed pages and new pages of one watched section (by prefix). */
export function sectionChanges(state: DocsFreshness, prefix: string): { changed: string[]; newPages: { url: string; date: string }[] } {
  if (state.status !== "ok") return { changed: [], newPages: [] };
  return {
    changed: [...state.changes.keys()].filter((u) => inSection(u, prefix)),
    newPages: state.newPages.filter((p) => inSection(p.url, prefix)),
  };
}
