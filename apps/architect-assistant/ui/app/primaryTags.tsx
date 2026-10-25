import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useUserAppState, useSetUserAppState } from "@dynatrace-sdk/react-hooks";
import { TAG_NAME_RE } from "./queries";

// Customer-defined primary tag names the Primary tags tab checks, persisted per
// user with the app-state API so they survive reloads.
const TAGS_KEY = "architect-assistant.primary-tag-names";
export const MAX_ITEMS = 10;

export type ListState = { names: string[]; setNames: (next: string[]) => void; loaded: boolean };

function usePersistedList(key: string, accept: (raw: string) => boolean): ListState {
  const stored = useUserAppState({ key });
  const { execute } = useSetUserAppState();
  const [names, setNamesState] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (stored.isLoading) return;
    try {
      const raw = stored.data?.value;
      if (raw) {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed)) setNamesState(parsed.filter((n): n is string => typeof n === "string" && accept(n)).slice(0, MAX_ITEMS));
      }
    } catch {
      /* ignore malformed state */
    }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored.isLoading, stored.data?.value]);

  const setNames = useCallback(
    (next: string[]) => {
      setNamesState(next);
      void execute({ key, body: { value: JSON.stringify(next) } }).catch(() => undefined);
    },
    [execute, key],
  );
  return { names, setNames, loaded };
}

export function usePrimaryTagsState(): ListState {
  return usePersistedList(TAGS_KEY, (n) => TAG_NAME_RE.test(n));
}

const empty: ListState = { names: [], setNames: () => undefined, loaded: true };
export const PrimaryTagsContext = createContext<ListState>(empty);
export const usePrimaryTags = () => useContext(PrimaryTagsContext);
