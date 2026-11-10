import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { emptyBoundary, emptyPolicy, type BoundaryDraft, type PolicyDraft } from "./iamPolicy";

// ---------------------------------------------------------------------------
// Drafts of the IAM Policy Creator and IAM Boundary Creator, held above the tabs (a tab unmounts when another one is
// opened) and kept in this browser's localStorage, so work survives tab switches and reloads. `*Text` is the editor
// text when it was edited by hand (null = the editor shows what the GUI generates). Drafts saved by the first version
// (v1, one apps statement) are migrated on load.
// ---------------------------------------------------------------------------

type Stored = { policy: PolicyDraft; policyText: string | null; boundary: BoundaryDraft; boundaryText: string | null; previewText: string | null };
export type IamDrafts = Stored & {
  setPolicy: (fn: (d: PolicyDraft) => PolicyDraft) => void;
  setPolicyText: (t: string | null) => void;
  setBoundary: (fn: (d: BoundaryDraft) => BoundaryDraft) => void;
  setBoundaryText: (t: string | null) => void;
  /** Policy the Boundary Creator previews its boundary against (null = the Policy Creator's current policy). */
  setPreviewText: (t: string | null) => void;
  resetPolicy: () => void;
  resetBoundary: () => void;
};

const STORAGE_KEY = "iam-assistant.iam-drafts.v2";
/** v1 drafts had `apps: { mode, op, ids }` and combined statements by default. */
const LEGACY_KEY = "iam-assistant.iam-drafts.v1";
const initial = (): Stored => ({ policy: emptyPolicy(), policyText: null, boundary: emptyBoundary(), boundaryText: null, previewText: null });

function migrate(p: Record<string, unknown> | undefined): PolicyDraft {
  const { apps, ...rest } = (p ?? {}) as { apps?: { mode?: string; ids?: string[] } } & Partial<PolicyDraft>;
  const out: PolicyDraft = { ...emptyPolicy(), ...rest };
  if (apps) {
    out.allApps = apps.mode === "all";
    if (apps.mode === "selected") (apps.ids ?? []).forEach((id) => (out.appLevels[id] ??= []));
    out.combine = false;
    out.step = 3;
  }
  return out;
}

function read(): Stored {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_KEY);
    if (!raw) return initial();
    const s = JSON.parse(raw) as Partial<Stored>;
    // Merge into fresh drafts so fields added later get their defaults.
    return {
      policy: migrate(s.policy as Record<string, unknown> | undefined),
      policyText: typeof s.policyText === "string" ? s.policyText : null,
      boundary: { ...emptyBoundary(), ...(s.boundary ?? {}) },
      boundaryText: typeof s.boundaryText === "string" ? s.boundaryText : null,
      previewText: typeof s.previewText === "string" ? s.previewText : null,
    };
  } catch {
    return initial();
  }
}

const IamDraftsContext = createContext<IamDrafts | null>(null);

export function IamDraftsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Stored>(read);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // storage full or blocked: drafts still live for this page load
      }
    }, 400);
    return () => clearTimeout(t);
  }, [state]);
  const setPolicy = useCallback((fn: (d: PolicyDraft) => PolicyDraft) => setState((s) => ({ ...s, policy: fn(s.policy) })), []);
  const setPolicyText = useCallback((t: string | null) => setState((s) => ({ ...s, policyText: t })), []);
  const setBoundary = useCallback((fn: (d: BoundaryDraft) => BoundaryDraft) => setState((s) => ({ ...s, boundary: fn(s.boundary) })), []);
  const setBoundaryText = useCallback((t: string | null) => setState((s) => ({ ...s, boundaryText: t })), []);
  const setPreviewText = useCallback((t: string | null) => setState((s) => ({ ...s, previewText: t })), []);
  const resetPolicy = useCallback(() => setState((s) => ({ ...s, policy: emptyPolicy(), policyText: null })), []);
  const resetBoundary = useCallback(() => setState((s) => ({ ...s, boundary: emptyBoundary(), boundaryText: null, previewText: null })), []);
  const value = useMemo<IamDrafts>(
    () => ({ ...state, setPolicy, setPolicyText, setBoundary, setBoundaryText, setPreviewText, resetPolicy, resetBoundary }),
    [state, setPolicy, setPolicyText, setBoundary, setBoundaryText, setPreviewText, resetPolicy, resetBoundary],
  );
  return <IamDraftsContext.Provider value={value}>{children}</IamDraftsContext.Provider>;
}

export function useIamDrafts(): IamDrafts {
  const ctx = useContext(IamDraftsContext);
  if (!ctx) throw new Error("useIamDrafts needs IamDraftsProvider");
  return ctx;
}
