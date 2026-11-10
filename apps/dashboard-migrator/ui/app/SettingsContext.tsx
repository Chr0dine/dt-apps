import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useUserAppState, useSetUserAppState } from "@dynatrace-sdk/react-hooks";

// Every tab in the app in a single place (App.tsx renders them in this order).
export const ALL_TABS = ["Import", "Translate", "Export"] as const;
export type TabName = (typeof ALL_TABS)[number];

export type Settings = {
  /** Export: add a markdown tile on top summarising the migration. */
  addMigrationNotes: boolean;
  /** Export: include placeholder (manual) tiles in the new dashboard. */
  includeManualTiles: boolean;
  /** Export: suffix appended to the classic name for the new dashboard. */
  nameSuffix: string;
};
const DEFAULTS: Settings = { addMigrationNotes: true, includeManualTiles: true, nameSuffix: " (migrated)" };
const STATE_KEY = "dm-settings";

type Ctx = { settings: Settings; update: (patch: Partial<Settings>) => void };
const SettingsContext = createContext<Ctx>({ settings: DEFAULTS, update: () => {} });

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const saved = useUserAppState({ key: STATE_KEY });
  const { execute: save } = useSetUserAppState();
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loaded || saved.isLoading) return;
    try {
      const v = saved.data?.value ? (JSON.parse(saved.data.value) as Partial<Settings>) : {};
      setSettings({ ...DEFAULTS, ...v });
    } catch {
      // ignore a corrupt saved value
    }
    setLoaded(true);
  }, [saved.isLoading, saved.data?.value, loaded]);

  const value = useMemo<Ctx>(
    () => ({
      settings,
      update: (patch) =>
        setSettings((s) => {
          const next = { ...s, ...patch };
          save({ key: STATE_KEY, body: { value: JSON.stringify(next) } });
          return next;
        }),
    }),
    [settings, save],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};

export const useSettings = () => useContext(SettingsContext);
