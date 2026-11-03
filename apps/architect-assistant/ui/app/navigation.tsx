import { createContext, useContext } from "react";
import type { TabId } from "./areas";

/** Tabs that end with a remediation section. */
export type RemediationTab = "primary-tags" | "security" | "cost" | "hostgroups" | "ownership" | "oneagent" | "segments";

/** Lets any component jump to another tab's remediation section (used by the Top findings). */
export type NavApi = {
  goToRemediation: (tab: RemediationTab) => void;
  /** Opens the Frontends tab; `toActions` also scrolls to its Remediation actions section. */
  goToFrontends: (toActions?: boolean) => void;
  /** Opens any tab (switching area when needed). */
  openTab: (tab: TabId) => void;
};

export const FRONTEND_ACTIONS_ANCHOR = "frontends-actions";

export const NavContext = createContext<NavApi>({ goToRemediation: () => undefined, goToFrontends: () => undefined, openTab: () => undefined });
export const useNav = () => useContext(NavContext);

export const remediationAnchorId = (tab: RemediationTab) => `remediation-${tab}`;
