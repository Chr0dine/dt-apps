import type { Overview, OverviewGroup } from "./iamAccessApi";

// ---------------------------------------------------------------------------
// Overview tab model: groups by type (SAML vs local, plus SCIM and the built-in all-users group) and the users under
// each type. Pure functions of the iam-access function's overview result, shared by the tab and its AI Assist analysis.
// ---------------------------------------------------------------------------

export type GroupType = "SAML" | "LOCAL" | "SCIM" | "ALL_USERS";
export const GROUP_TYPES: GroupType[] = ["SAML", "LOCAL", "SCIM", "ALL_USERS"];
export const GROUP_TYPE_LABEL: Record<GroupType, string> = { SAML: "SAML", LOCAL: "Local", SCIM: "SCIM", ALL_USERS: "All users (built-in)" };
// One stable colour per type so the donuts, chips and bars read the same (same palette as Architect Assistant's donuts).
export const GROUP_TYPE_COLOR: Record<GroupType, string> = { SAML: "#4589FF", LOCAL: "#A56EFF", SCIM: "#2DB7A3", ALL_USERS: "#8D8D8D" };

/** How a user gets their group memberships (the built-in all-users group is ignored). */
export type UserMix = "saml" | "local" | "both" | "scim" | "none";
export const USER_MIXES: UserMix[] = ["saml", "local", "both", "scim", "none"];
export const USER_MIX_LABEL: Record<UserMix, string> = {
  saml: "SAML groups only",
  local: "Local groups only",
  both: "SAML and local groups",
  scim: "SCIM groups",
  none: "No group",
};
export const USER_MIX_COLOR: Record<UserMix, string> = { saml: "#4589FF", local: "#A56EFF", both: "#FF832B", scim: "#2DB7A3", none: "#8D8D8D" };

export const groupType = (g: OverviewGroup): GroupType => (GROUP_TYPES.includes(g.owner as GroupType) ? (g.owner as GroupType) : "LOCAL");

export type OverviewModel = {
  groups: Record<GroupType, number>;
  /** Distinct users in at least one group of the type. */
  usersIn: Record<GroupType, number>;
  /** Sum of member counts per type (a user in two SAML groups counts twice). */
  memberships: Record<GroupType, number>;
  mix: Record<UserMix, number>;
  totalUsers: number;
  totalGroups: number;
  /** Groups (not built-in) without members. */
  emptyGroups: { name: string; type: GroupType }[];
  /** Groups whose members could not be read. */
  unreadable: number;
  largest: { name: string; type: GroupType; members: number }[];
};

const zero = <K extends string>(keys: K[]): Record<K, number> => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

export function buildOverview(o: Overview): OverviewModel {
  const groups = zero(GROUP_TYPES);
  const memberships = zero(GROUP_TYPES);
  const typeOf = new Map<string, GroupType>();
  for (const g of o.groups) {
    const t = groupType(g);
    typeOf.set(g.uuid, t);
    groups[t]++;
    memberships[t] += g.members ?? 0;
  }
  const usersIn = zero(GROUP_TYPES);
  usersIn.ALL_USERS = groups.ALL_USERS ? o.users.length : 0;
  const mix = zero(USER_MIXES);
  for (const u of o.users) {
    const types = new Set(u.groups.map((id) => typeOf.get(id)).filter((t): t is GroupType => !!t && t !== "ALL_USERS"));
    types.forEach((t) => usersIn[t]++);
    const m: UserMix = types.has("SAML") && types.has("LOCAL") ? "both" : types.has("SAML") ? "saml" : types.has("LOCAL") ? "local" : types.has("SCIM") ? "scim" : "none";
    mix[m]++;
  }
  const real = o.groups.filter((g) => groupType(g) !== "ALL_USERS");
  return {
    groups,
    usersIn,
    memberships,
    mix,
    totalUsers: o.users.length,
    totalGroups: o.groups.length,
    emptyGroups: real.filter((g) => g.members === 0).map((g) => ({ name: g.name, type: groupType(g) })),
    unreadable: o.groups.filter((g) => g.members === null).length,
    largest: real
      .filter((g) => (g.members ?? 0) > 0)
      .sort((a, b) => (b.members ?? 0) - (a.members ?? 0))
      .slice(0, 3)
      .map((g) => ({ name: g.name, type: groupType(g), members: g.members ?? 0 })),
  };
}
