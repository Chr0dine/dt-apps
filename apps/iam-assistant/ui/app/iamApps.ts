import { useEffect, useMemo, useState, type RefObject } from "react";
import { httpClient } from "@dynatrace-sdk/http-client";
import { attributeOf, type CatalogIndex } from "./iamCatalog";
import { loadInstalledApps, type InstalledApp } from "./iamValues";

// ---------------------------------------------------------------------------
// What each installed app needs, derived from the scopes its manifest requests (App Registry), for the app picker of
// the IAM Policy Creator:
// - app permissions, split into Read / Write / Execute by the permission's action,
// - data permissions: Grail table reads with record-level (dimensional) conditions; they are granted in the Data access
//   step, scoped by dimensional data, never silently. "(Optional)" in the manifest comment marks optional ones,
// - app state (state:*, state-management:*, app-settings:*), limited to the selected apps with shared:app-id,
// - scopes that are not IAM policy permissions (environment-api:*, iam:users:read, …) and the app's own
//   app-engine:apps:run (it lets the app open other apps; opening this app is granted per app instead): left out.
// ---------------------------------------------------------------------------

export type AppLevel = "read" | "write" | "execute";
export const APP_LEVELS: AppLevel[] = ["read", "write", "execute"];
export const LEVEL_LABEL: Record<AppLevel, string> = { read: "Read", write: "Write", execute: "Execute" };
export const LEVEL_HINT: Record<AppLevel, string> = {
  read: "view: read, list, download",
  write: "change: write, delete, admin, restore, share",
  execute: "act: run, execute, use, send, invoke",
};

const READ_ACTIONS = new Set(["read", "list", "lookup", "download", "load", "resolve"]);
const EXECUTE_ACTIONS = new Set(["execute", "run", "use", "send", "authenticate", "invoke", "validate", "connect", "set"]);
/** Read for viewing actions, Execute for running actions, Write for everything that changes something. */
export function levelOf(permission: string): AppLevel {
  const action = permission.slice(permission.lastIndexOf(":") + 1);
  return READ_ACTIONS.has(action) ? "read" : EXECUTE_ACTIONS.has(action) ? "execute" : "write";
}

/** Services whose objects belong to an app; their permissions are limited to the selected apps with shared:app-id. */
const APP_OWNED = /^(state|state-management|app-settings):/;
const SENSITIVE_FIELDS = "storage:fieldsets:read";
export const BUCKETS = "storage:buckets:read";

export type AppPermKind = "app" | "data" | "owned" | "skip";
export type AppPerm = { permission: string; level: AppLevel; kind: AppPermKind; comment: string; optional: boolean; reason?: string };

export type AppSummary = {
  app: InstalledApp;
  perms: AppPerm[];
  /** Levels the picker offers: Read always (it opens the app), Write / Execute when the manifest has such permissions. */
  levels: AppLevel[];
  byLevel: Record<AppLevel, AppPerm[]>;
  /** Grail data permissions (without storage:buckets:read, which comes with any table). */
  data: AppPerm[];
  requiredData: string[];
  owned: AppPerm[];
  skipped: AppPerm[];
};

export function summarizeApp(app: InstalledApp, ix: CatalogIndex): AppSummary {
  const dims = new Set(ix.dimensions.map((d) => d.attr));
  const seen = new Set<string>();
  const perms: AppPerm[] = [];
  for (const s of app.scopes) {
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    const info = ix.permissions.get(s.name);
    const base = { permission: s.name, level: levelOf(s.name), comment: s.comment, optional: /optional/i.test(s.comment) };
    if (s.name === "app-engine:apps:run") perms.push({ ...base, kind: "skip", reason: "lets the app open other apps; opening this app is granted on its own line" });
    else if (!info) perms.push({ ...base, kind: "skip", reason: "not an IAM policy permission (an app scope only)" });
    else if (APP_OWNED.test(s.name) && info.conditions.some((c) => c.key === "shared:app-id")) perms.push({ ...base, kind: "owned" });
    else if (s.name.startsWith("storage:") && info.conditions.some((c) => dims.has(attributeOf(c.key))))
      perms.push({ ...base, kind: "data", level: "read", optional: base.optional || s.name === SENSITIVE_FIELDS });
    else perms.push({ ...base, kind: "app" });
  }
  const app_ = perms.filter((p) => p.kind === "app");
  const byLevel = { read: app_.filter((p) => p.level === "read"), write: app_.filter((p) => p.level === "write"), execute: app_.filter((p) => p.level === "execute") };
  const data = perms.filter((p) => p.kind === "data" && p.permission !== BUCKETS);
  return {
    app,
    perms,
    levels: APP_LEVELS.filter((l) => l === "read" || byLevel[l].length > 0),
    byLevel,
    data,
    requiredData: data.filter((p) => !p.optional).map((p) => p.permission),
    owned: perms.filter((p) => p.kind === "owned"),
    skipped: perms.filter((p) => p.kind === "skip"),
  };
}

export type AppCatalog = { apps: InstalledApp[] | null; summaries: Map<string, AppSummary>; error: string | null };

/** Installed apps and what each needs (one registry call per page load, shared with the value pickers). */
export function useAppCatalog(ix: CatalogIndex): AppCatalog {
  const [apps, setApps] = useState<InstalledApp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadInstalledApps()
      .then((a) => !cancelled && setApps(a))
      .catch((e) => !cancelled && setError((e as Error)?.message ?? String(e)));
    return () => {
      cancelled = true;
    };
  }, []);
  const summaries = useMemo(() => new Map((apps ?? []).map((a) => [a.id, summarizeApp(a, ix)])), [apps, ix]);
  return { apps, summaries, error };
}

// --- Icons -------------------------------------------------------------------------------------------------------------
// The registry serves each icon (PNG) under /platform/app-engine/registry/v1/app-icons/<id>. They are read through the
// SDK HTTP client (the app's session), a few at a time, and kept as object URLs for the page load.
const icons = new Map<string, Promise<string | null>>();
const queue: (() => void)[] = [];
let running = 0;
const ICON_CONCURRENCY = 6;
function next() {
  while (running < ICON_CONCURRENCY && queue.length) {
    running++;
    queue.shift()!();
  }
}
export function loadAppIcon(app: InstalledApp): Promise<string | null> {
  if (!app.icon) return Promise.resolve(null);
  let p = icons.get(app.id);
  if (!p) {
    p = new Promise<string | null>((resolve) => {
      queue.push(() => {
        httpClient
          .send({ url: app.icon!, method: "GET" })
          .then((res) => res.body("blob"))
          .then((blob) => resolve(URL.createObjectURL(blob as Blob)))
          .catch(() => resolve(null))
          .finally(() => {
            running--;
            next();
          });
      });
      next();
    });
    icons.set(app.id, p);
  }
  return p;
}

/** The app's icon once its card scrolls into view (null until loaded, or when the app has none). */
export function useAppIcon(app: InstalledApp, ref: RefObject<HTMLElement | null>): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !app.icon) return;
    let cancelled = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        void loadAppIcon(app).then((u) => !cancelled && setUrl(u));
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [app, ref]);
  return url;
}
