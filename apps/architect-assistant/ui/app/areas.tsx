import React from "react";
import { useCurrentTheme } from "@dynatrace/strato-components/core";
import { Select } from "@dynatrace/strato-components/forms";
import { Text } from "@dynatrace/strato-components/typography";
import { KeyIcon, LabelIcon, UpgradeIcon, ViewIcon } from "@dynatrace/strato-icons";
import { categoryColor, type Category, type Theme } from "./kubernetes";
import type { RemediationTab } from "./navigation";

// ---------------------------------------------------------------------------
// Areas: the dropdown above the tabs picks one area and only its tabs are shown. A tab's position is derived from
// AREAS, so jumps to a tab (Top findings, Frontends links) never depend on hand-kept indices.
// ---------------------------------------------------------------------------

/** Every tab of the app; tabs with a remediation section use their `RemediationTab` id. */
export type TabId =
  | RemediationTab
  | "overview"
  | "data"
  | "deep"
  | "frontends"
  | "activegates"
  | "kubernetes"
  | "databases"
  | "extensions"
  | "sdv2"
  | "slos"
  | "problem-notifications"
  | "iam-policy"
  | "iam-boundary"
  | "iam-access";

export const TAB_TITLES: Record<TabId, string> = {
  overview: "Entity Overview",
  data: "Data Overview",
  hostgroups: "Host groups",
  security: "Security context",
  cost: "Cost allocation",
  ownership: "Ownership & Teams",
  "primary-tags": "Primary tags",
  slos: "SLOs",
  segments: "Segments",
  "problem-notifications": "Problem notifications",
  oneagent: "OneAgents",
  deep: "Deep Monitoring",
  frontends: "Frontends",
  activegates: "ActiveGates",
  kubernetes: "Kubernetes",
  databases: "Databases",
  extensions: "Extensions",
  sdv2: "Service Detection v2",
  "iam-policy": "IAM Policy Creator",
  "iam-boundary": "IAM Boundary Creator",
  "iam-access": "Permissions Test",
};

export type AreaId = "metadata" | "migration" | "visibility" | "iam";

/** Colour = a categorical palette slot (kubernetes.ts), so it has a light and a dark step like the charts. */
export type Area = Category & { id: AreaId; icon: typeof LabelIcon; tabs: TabId[] };

export const AREAS: Area[] = [
  {
    id: "metadata",
    label: "Metadata",
    slot: 1,
    icon: LabelIcon,
    detail: "Entity and data coverage: host groups, security context, cost allocation, ownership and primary tags.",
    tabs: ["overview", "data", "hostgroups", "security", "cost", "ownership", "primary-tags"],
  },
  {
    id: "migration",
    label: "Migration Assistance",
    slot: 2,
    icon: UpgradeIcon,
    detail: "Move classic configuration to the platform: SLOs, management zones to segments, problem notifications to workflows.",
    tabs: ["slos", "segments", "problem-notifications"],
  },
  {
    id: "visibility",
    label: "Visibility",
    slot: 3,
    icon: ViewIcon,
    detail: "What is monitored and how well: OneAgents, code modules, frontends, ActiveGates, Kubernetes, databases, extensions and service detection.",
    tabs: ["oneagent", "deep", "frontends", "activegates", "kubernetes", "databases", "extensions", "sdv2"],
  },
  {
    id: "iam",
    label: "Users and permissions",
    slot: 7,
    icon: KeyIcon,
    detail: "Build IAM policies and boundaries, and test what a user or group can access.",
    tabs: ["iam-policy", "iam-boundary", "iam-access"],
  },
];

export const AREA_BY_ID = Object.fromEntries(AREAS.map((a) => [a.id, a])) as Record<AreaId, Area>;

/** Area and index of a tab inside it. */
export function locateTab(tab: TabId): { area: AreaId; index: number } {
  const area = AREAS.find((a) => a.tabs.includes(tab)) ?? AREAS[0];
  return { area: area.id, index: Math.max(0, area.tabs.indexOf(tab)) };
}

/** The area's glyph on a tinted square in its colour. */
export function AreaGlyph({ area, theme, size = 16, box = size + 8 }: { area: Area; theme: Theme; size?: number; box?: number }) {
  const color = categoryColor(area, theme);
  const Icon = area.icon;
  return (
    <span
      aria-hidden
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        width: box,
        height: box,
        borderRadius: 5,
        background: `${color}33`,
        border: `1px solid ${color}99`,
        color,
        flex: "0 0 auto",
      }}
    >
      <Icon style={{ width: size, height: size }} />
    </span>
  );
}

/** Area dropdown with the selected area's description, on a neutral strip edged in the area's colour (a tinted strip
 * in orange or pink read like a warning banner). */
export function AreaPicker({ value, onChange }: { value: AreaId; onChange: (area: AreaId) => void }) {
  const theme = useCurrentTheme() as Theme;
  const area = AREA_BY_ID[value];
  const color = categoryColor(area, theme);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 12,
        padding: "8px 12px",
        borderLeft: `4px solid ${color}`,
        borderRadius: 6,
        background: "rgba(128,128,128,0.08)",
      }}
    >
      <Select aria-label="Area" value={value} onChange={(v: AreaId | null) => v && onChange(v)}>
        <Select.Trigger width="240px">
          <Select.DisplayValue>
            <Select.Prefix>
              <AreaGlyph area={area} theme={theme} />
            </Select.Prefix>
            <Text style={{ fontWeight: 600 }}>{area.label}</Text>
          </Select.DisplayValue>
        </Select.Trigger>
        <Select.Content>
          {AREAS.map((a) => (
            <Select.Option key={a.id} value={a.id}>
              {/* An option's prefix slot is a fixed 20 px box; a larger glyph overflows into the label. */}
              <Select.Prefix>
                <AreaGlyph area={a} theme={theme} size={14} box={20} />
              </Select.Prefix>
              {a.label}
            </Select.Option>
          ))}
        </Select.Content>
      </Select>
      <Text style={{ flex: "1 1 320px" }}>{area.detail}</Text>
    </div>
  );
}
