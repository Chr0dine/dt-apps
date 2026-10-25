import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { settingsObjectsClient } from "@dynatrace-sdk/client-classic-environment-v2";
import { functions } from "@dynatrace-sdk/app-utils";
import { useDql, type DqlState } from "./useDql";
import { frontendsQuery, refreshMarker, type Timeframe } from "./queries";
import { num } from "./components";

// Frontends tab data: the web application list + assigned synthetic monitors come from DQL (frontendsQuery);
// RUM and Session Replay enablement (builtin:rum.web.enablement: rum.enabled = RUM classic, rum.enabledOnGrail = RUM v2,
// sessionReplay.enabled = Session Replay classic, sessionReplay.enabledOnGrail = Session Replay on Grail; a frontend
// without its own object inherits the environment-scope object) and frontend health alerts
// (builtin:health-experience.frontend-alert, `frontends` lists APPLICATION IDs) come from the Settings API; user tag
// rules come from Config API v1 through the `user-tags` app function (credential vault token).

export const ENABLEMENT_SCHEMA = "builtin:rum.web.enablement";
export const HEALTH_ALERT_SCHEMA = "builtin:health-experience.frontend-alert";
export const USER_TAG_CREDENTIAL = "architect-assistant-readconfig";

export type RumStatus = "both" | "classic" | "disabled";
export const RUM_STATUS_LABEL: Record<RumStatus, string> = {
  both: "RUM v2 + classic",
  classic: "RUM classic only",
  disabled: "RUM disabled",
};

export type CheckKey = "rum" | "replay" | "synthetics" | "usertags" | "health" | "owner";
export const CHECKS: { key: CheckKey; label: string }[] = [
  { key: "rum", label: "RUM v2 enabled" },
  { key: "replay", label: "Session Replay enabled" },
  { key: "synthetics", label: "Synthetic monitors assigned" },
  { key: "usertags", label: "User tagging configured" },
  { key: "health", label: "Health alerts configured" },
  { key: "owner", label: "Owning team assigned" },
];

/** builtin:rum.web.enablement value; unknown properties (experienceAnalytics, …) are kept as-is on writes. */
export type EnablementValue = {
  rum?: { enabled?: boolean; enabledOnGrail?: boolean; costAndTrafficControl?: number };
  sessionReplay?: { enabled?: boolean; enabledOnGrail?: boolean; costAndTrafficControl?: number };
  [k: string]: unknown;
};

export type FrontendRow = {
  id: string;
  name: string;
  rumClassic: boolean;
  rumV2: boolean;
  rum: RumStatus;
  replayClassic: boolean;
  replayGrail: boolean;
  /** Effective enablement value (own object, else the environment default). */
  enablement: EnablementValue;
  /** True when the frontend has no object of its own and inherits the environment setting. */
  inherited: boolean;
  monitors: number;
  browser: number;
  http: number;
  thirdparty: number;
  healthAlerts: number;
  /** alertKey of every enabled health alert that includes this frontend. */
  alertKeys: string[];
  /** Owning team from the classic owner tag (dt.owner / owner / team), null = none. */
  owner: string | null;
  /** null = user tag rules could not be read (no credential, or the Config API call failed for this frontend). */
  userTagRules: number | null;
  /** Per-check score 0..100; null = not measured (excluded from averages). */
  scores: Record<CheckKey, number | null>;
  /** Mean of the measured checks. */
  score: number;
};

export type UserTagState =
  | { status: "loading" }
  | { status: "ok"; rules: Record<string, number>; failed: string[] }
  | { status: "no-credential" | "unauthorized" | "error"; message: string };

/** Pass = 100, fail = 0; the Grail (v2) variant of RUM and Session Replay passes, the classic-only variant scores 50. */
export function scoreFrontend(a: Omit<FrontendRow, "scores" | "score">): Pick<FrontendRow, "scores" | "score"> {
  const scores: Record<CheckKey, number | null> = {
    rum: a.rumV2 ? 100 : a.rumClassic ? 50 : 0,
    replay: a.replayGrail ? 100 : a.replayClassic ? 50 : 0,
    synthetics: a.monitors > 0 ? 100 : 0,
    usertags: a.userTagRules === null ? null : a.userTagRules > 0 ? 100 : 0,
    health: a.healthAlerts > 0 ? 100 : 0,
    owner: a.owner ? 100 : 0,
  };
  const measured = Object.values(scores).filter((v): v is number => v !== null);
  return { scores, score: measured.length ? Math.round(measured.reduce((s, v) => s + v, 0) / measured.length) : 0 };
}

type SettingsItem = { scope?: string; value?: any };

/** All objects of one schema (pagination: nextPageKey must be the only parameter on later pages). */
async function listAll(schemaId: string, scopes?: string): Promise<SettingsItem[]> {
  const items: SettingsItem[] = [];
  let nextPageKey: string | undefined;
  do {
    const page = await settingsObjectsClient.getSettingsObjects(
      nextPageKey ? { nextPageKey } : { schemaIds: schemaId, ...(scopes ? { scopes } : {}), fields: "scope,value", pageSize: 500 },
    );
    items.push(...((page.items ?? []) as SettingsItem[]));
    nextPageKey = page.nextPageKey;
  } while (nextPageKey);
  return items;
}

type SettingsData = { enablement: Map<string, EnablementValue>; alerts: Map<string, string[]> };

function useSettingsData(version: number): { data: SettingsData | null; error: string | null } {
  const [data, setData] = useState<SettingsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([listAll(ENABLEMENT_SCHEMA), listAll(HEALTH_ALERT_SCHEMA, "environment")])
      .then(([en, al]) => {
        if (cancelled) return;
        const enablement = new Map<string, EnablementValue>();
        for (const o of en) if (o.scope) enablement.set(o.scope, (o.value ?? {}) as EnablementValue);
        // Only enabled alerts count: a disabled alert never fires.
        const alerts = new Map<string, string[]>();
        for (const o of al) {
          if (o.value?.enabled === false) continue;
          for (const f of (o.value?.frontends ?? []) as string[]) alerts.set(f, [...(alerts.get(f) ?? []), String(o.value?.alertKey ?? "")]);
        }
        setData({ enablement, alerts });
      })
      .catch((e) => !cancelled && setError((e as Error)?.message ?? String(e)));
    return () => {
      cancelled = true;
    };
  }, [version]);
  return { data, error };
}

function useUserTags(appIds: string[], version: number): UserTagState {
  const [state, setState] = useState<UserTagState>({ status: "loading" });
  const key = appIds.join(",");
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    setState({ status: "loading" });
    functions
      .call("user-tags", { data: { appIds: key.split(",") } })
      .then((res) => res.json())
      .then((r: UserTagState) => !cancelled && setState(r))
      .catch((e) => !cancelled && setState({ status: "error", message: (e as Error)?.message ?? String(e) }));
    return () => {
      cancelled = true;
    };
  }, [key, version]);
  return state;
}

export type FrontendsData = {
  query: string;
  dql: DqlState;
  settingsError: string | null;
  loading: boolean;
  userTags: UserTagState;
  frontends: FrontendRow[];
  /** Re-reads everything (settings, user tags, DQL) after an action changed it. */
  reload: () => void;
};

export function useFrontendsData(tf: Timeframe): FrontendsData {
  const [version, setVersion] = useState(0);
  // The DQL query string is the only re-run trigger, so a refresh comment is appended after a change.
  const query = frontendsQuery(tf);
  const dql = useDql(query + refreshMarker(version));
  const settings = useSettingsData(version);
  const appIds = useMemo(() => (dql.data?.records ?? []).map((r) => String(r.id)), [dql.data]);
  const userTags = useUserTags(appIds, version);
  const computed = useMemo<FrontendRow[] | null>(() => {
    if (!dql.data || !settings.data) return null;
    const { enablement, alerts } = settings.data;
    const envDefault = enablement.get("environment") ?? {};
    return dql.data.records.map((r) => {
      const id = String(r.id);
      const own = enablement.get(id);
      const en = own ?? envDefault;
      const rumClassic = !!en.rum?.enabled;
      const rumV2 = rumClassic && !!en.rum?.enabledOnGrail;
      const replayClassic = rumClassic && !!en.sessionReplay?.enabled;
      const replayGrail = replayClassic && !!en.sessionReplay?.enabledOnGrail;
      const rum: RumStatus = rumV2 ? "both" : rumClassic ? "classic" : "disabled";
      const alertKeys = alerts.get(id) ?? [];
      const base = {
        id,
        name: String(r.name ?? id),
        rumClassic,
        rumV2,
        rum,
        replayClassic,
        replayGrail,
        enablement: en,
        inherited: !own,
        monitors: num(r.monitors),
        browser: num(r.browser),
        http: num(r.http),
        thirdparty: num(r.thirdparty),
        healthAlerts: alertKeys.length,
        owner: r.owner ? String(r.owner) : null,
        alertKeys,
        userTagRules: userTags.status === "ok" && id in userTags.rules ? userTags.rules[id] : null,
      };
      return { ...base, ...scoreFrontend(base) };
    });
  }, [dql.data, settings.data, userTags]);
  // While a refresh runs, keep showing the previous rows so open forms (and their results) stay mounted.
  const last = useRef<FrontendRow[] | null>(null);
  if (computed) last.current = computed;
  const frontends = computed ?? last.current ?? [];
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return {
    query,
    dql,
    settingsError: settings.error,
    loading: !last.current && ((dql.loading && !dql.data) || (!settings.data && !settings.error)),
    userTags,
    frontends,
    reload,
  };
}
