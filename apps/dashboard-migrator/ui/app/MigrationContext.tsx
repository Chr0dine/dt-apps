import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { queryAssistanceClient, queryExecutionClient } from "@dynatrace-sdk/client-query";
import { translateDashboard } from "./translate/tiles";
import type { ClassicDashboard, MigrationResult, TranslatedTile } from "./translate/types";

// State shared by the Import, Translate and Export tabs: the classic source, its translation, the user's edits per tile,
// and the tenant verification results.

export type SourceInfo = { dashboard: ClassicDashboard; label: string };
export type TileEdit = { dql?: string; visualization?: string; include?: boolean };
export type Verification =
  | { state: "running" }
  | { state: "done"; valid: boolean; messages: { severity: string; message: string }[]; missingKeys: string[]; checkedKeys: string[] }
  | { state: "error"; message: string };
export type Created = { id: string; name: string; at: string; tiles: number };

type Ctx = {
  source: SourceInfo | null;
  result: MigrationResult | null;
  load: (s: SourceInfo) => void;
  clear: () => void;
  edits: Record<string, TileEdit>;
  edit: (key: string, patch: TileEdit) => void;
  resetEdit: (key: string) => void;
  /** Tiles with edits applied. */
  tiles: TranslatedTile[];
  included: (t: TranslatedTile) => boolean;
  verification: Record<string, Verification>;
  verifyAll: () => Promise<void>;
  verifyOne: (t: TranslatedTile) => Promise<void>;
  verifying: boolean;
  created: Created[];
  addCreated: (c: Created) => void;
};
const MigrationContext = createContext<Ctx | null>(null);

/** Which of `keys` exist in the tenant's metric catalog (one metrics query for all of them). */
async function existingMetricKeys(keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const query = `metrics\n| filter in(metric.key, array(${keys.map((k) => JSON.stringify(k)).join(", ")}))\n| summarize n = count(), by: {metric.key}`;
  const start = await queryExecutionClient.queryExecute({ body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: 1000 } });
  let records = start.result?.records ?? [];
  if (start.state !== "SUCCEEDED" && start.requestToken) {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const p = await queryExecutionClient.queryPoll({ requestToken: start.requestToken });
      if (p.state === "SUCCEEDED") {
        records = p.result?.records ?? [];
        break;
      }
      if (p.state === "FAILED" || p.state === "CANCELLED") throw new Error(`Metric check ${p.state.toLowerCase()}`);
    }
  }
  return new Set(records.map((r) => String((r as Record<string, unknown>)?.["metric.key"] ?? "")));
}

export const MigrationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [source, setSource] = useState<SourceInfo | null>(null);
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [edits, setEdits] = useState<Record<string, TileEdit>>({});
  const [verification, setVerification] = useState<Record<string, Verification>>({});
  const [verifying, setVerifying] = useState(false);
  const [created, setCreated] = useState<Created[]>([]);

  const load = useCallback((s: SourceInfo) => {
    setSource(s);
    setResult(translateDashboard(s.dashboard));
    setEdits({});
    setVerification({});
  }, []);
  const clear = useCallback(() => {
    setSource(null);
    setResult(null);
    setEdits({});
    setVerification({});
  }, []);
  const edit = useCallback((key: string, patch: TileEdit) => {
    setEdits((e) => ({ ...e, [key]: { ...e[key], ...patch } }));
    if (patch.dql !== undefined) setVerification((v) => {
      const n = { ...v };
      delete n[key];
      return n;
    });
  }, []);
  const resetEdit = useCallback((key: string) => {
    setEdits((e) => {
      const n = { ...e };
      delete n[key];
      return n;
    });
    setVerification((v) => {
      const n = { ...v };
      delete n[key];
      return n;
    });
  }, []);

  const tiles = useMemo<TranslatedTile[]>(
    () =>
      (result?.tiles ?? []).map((t) => {
        const e = edits[t.key];
        if (!e) return t;
        const edited = { ...t, ...(e.dql !== undefined ? { dql: e.dql } : {}), ...(e.visualization ? { visualization: e.visualization } : {}) };
        // Metric keys of an edited query: whatever dt.* / custom keys appear in an aggregation call.
        if (e.dql !== undefined) edited.metricKeys = [...new Set([...e.dql.matchAll(/\b(?:avg|sum|min|max|count|percentile)\(\s*([A-Za-z][\w.-]*)/g)].map((m) => m[1]))];
        return edited;
      }),
    [result, edits],
  );
  const included = useCallback((t: TranslatedTile) => edits[t.key]?.include ?? true, [edits]);

  const verifyTiles = useCallback(async (list: TranslatedTile[]) => {
    const data = list.filter((t) => t.kind === "data" && t.dql);
    if (!data.length) return;
    setVerification((v) => ({ ...v, ...Object.fromEntries(data.map((t) => [t.key, { state: "running" } as Verification])) }));
    let existing: Set<string> | null = null;
    let keyError: string | null = null;
    try {
      existing = await existingMetricKeys([...new Set(data.flatMap((t) => t.metricKeys))]);
    } catch (e) {
      keyError = (e as Error)?.message ?? String(e);
    }
    await Promise.all(
      data.map(async (t) => {
        try {
          const r = await queryAssistanceClient.queryVerify({ body: { query: t.dql! } });
          const messages = (r.notifications ?? []).map((n) => ({ severity: n.severity ?? "INFO", message: n.message ?? "" }));
          if (keyError) messages.push({ severity: "WARN", message: `Metric keys were not checked: ${keyError}` });
          const missingKeys = existing ? t.metricKeys.filter((k) => !existing!.has(k)) : [];
          setVerification((v) => ({ ...v, [t.key]: { state: "done", valid: r.valid, messages, missingKeys, checkedKeys: t.metricKeys } }));
        } catch (e) {
          const body = (e as { body?: { error?: { message?: string; details?: { errorMessage?: string } } } })?.body?.error;
          setVerification((v) => ({ ...v, [t.key]: { state: "error", message: body?.details?.errorMessage ?? body?.message ?? (e as Error)?.message ?? String(e) } }));
        }
      }),
    );
  }, []);

  const verifyAll = useCallback(async () => {
    setVerifying(true);
    try {
      await verifyTiles(tiles);
    } finally {
      setVerifying(false);
    }
  }, [tiles, verifyTiles]);
  const verifyOne = useCallback((t: TranslatedTile) => verifyTiles([t]), [verifyTiles]);
  const addCreated = useCallback((c: Created) => setCreated((l) => [c, ...l]), []);

  const value: Ctx = { source, result, load, clear, edits, edit, resetEdit, tiles, included, verification, verifyAll, verifyOne, verifying, created, addCreated };
  return <MigrationContext.Provider value={value}>{children}</MigrationContext.Provider>;
};

export function useMigration(): Ctx {
  const c = useContext(MigrationContext);
  if (!c) throw new Error("useMigration outside MigrationProvider");
  return c;
}
