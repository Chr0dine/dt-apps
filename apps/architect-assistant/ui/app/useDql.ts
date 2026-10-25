import { useMemo } from "react";
import { useDql as useSdkDql } from "@dynatrace-sdk/react-hooks";

// Thin wrapper around the SDK's useDql so all callsites keep the
// `useDql(queryString, [deps])` signature. deps are ignored — the SDK
// re-runs whenever the query string changes.
export type DqlState<T = Record<string, any>> = {
  data: { records: T[] } | null;
  loading: boolean;
  error: string | null;
};

export function useDql(query: string | null, _deps: unknown[] = []): DqlState {
  return useDqlWhen(query ?? "fetch user.events | limit 0", true);
}

/** Same as useDql, but runs nothing until `enabled` (value pickers on the IAM tabs query only once opened). */
export function useDqlWhen(query: string, enabled: boolean): DqlState {
  const options = useMemo(() => ({ enabled }), [enabled]);
  const res = useSdkDql(query, options);
  // Keep `data` referentially stable while the SDK result is unchanged, so effects and memos that depend on it
  // do not re-run on every render (a new object per render caused an endless settings re-read on Deep Monitoring).
  const data = useMemo(() => (res.data ? { records: (res.data.records ?? []) as any[] } : null), [res.data]);
  return {
    data,
    loading: !!res.isLoading,
    error: res.error ? (res.error as any)?.message ?? String(res.error) : null,
  };
}
