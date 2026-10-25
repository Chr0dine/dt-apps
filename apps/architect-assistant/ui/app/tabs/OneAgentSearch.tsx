import React, { useEffect, useMemo, useRef, useState } from "react";
import { getAppLink } from "@dynatrace-sdk/navigation";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { FormField, Label, Select, TextInput } from "@dynatrace/strato-components/forms";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import Colors from "@dynatrace/strato-design-tokens/colors";
import Spacings from "@dynatrace/strato-design-tokens/spacings";
import Borders from "@dynatrace/strato-design-tokens/borders";
import { useDql } from "../useDql";
import { NO_HOST_GROUP, hostGroupSearchQuery, oneAgentSearchQuery, type Timeframe } from "../queries";
import { entityOverviewLink } from "../links";
import { QueryActions, QueryState, ShowEntitiesButton, formatMode } from "../components";

const card: React.CSSProperties = {
  padding: Spacings.Size16,
  borderRadius: Borders.Radius.Container.Default,
  background: Colors.Background.Container.Neutral.Default,
};
const smallBtn: React.CSSProperties = { background: "rgba(128,128,128,0.08)", color: "inherit", border: "1px solid rgba(128,128,128,0.3)", borderRadius: 6, padding: "2px 8px", cursor: "pointer", fontSize: 11, fontWeight: 600 };

export const ANY = "__any__";
type HostRow = { hostId: string; name: string; version: string; mode: string; modeLabel: string; hostGroup: string };

/** Deployment Status OneAgents page. The app only exposes page tokens, so the link cannot be pre-filtered to one host. */
function deploymentStatusLink(): string | undefined {
  try {
    return getAppLink("dynatrace.classic.deployment.status", "oneagents");
  } catch {
    return undefined;
  }
}

/** Drops the build suffix: "1.347.62.20261019-084101" -> "1.347.62.20261019". */
export const shortVersion = (v: string): string => v.split("-")[0];

/** Numeric, segment-by-segment comparison of dotted versions (1.309.12.2024 vs 1.311.4.2025). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((s) => parseInt(s, 10) || 0);
  const pb = b.split(".").map((s) => parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

function Results({ query }: { query: string }) {
  const state = useDql(query);
  const deployUrl = useMemo(() => deploymentStatusLink(), []);
  const rows = useMemo<HostRow[]>(
    () =>
      [...(state.data?.records ?? [])]
        // Newest OneAgent version first (compare dotted segments numerically), then by host name.
        .sort((a, b) => compareVersions(String(b.version ?? ""), String(a.version ?? "")) || String(a.name ?? "").localeCompare(String(b.name ?? "")))
        .map((r) => {
        const mode = String(r.mode ?? "");
        return {
          hostId: String(r.id).replace(/^ONEAGENT-/, "HOST-"),
          hostGroup: r.hostGroup ? String(r.hostGroup) : "",
          name: String(r.name ?? ""),
          version: String(r.version ?? ""),
          mode,
          modeLabel: formatMode(mode),
        };
      }),
    [state.data],
  );
  const columns = useMemo<DataTableColumnDef<HostRow>[]>(
    () => [
      { id: "name", header: "Host", accessor: "name", width: "2fr" },
      { id: "version", header: "OneAgent version", accessor: "version", width: "1.5fr" },
      { id: "modeLabel", header: "Monitoring mode", accessor: "modeLabel", width: "1fr" },
      { id: "hostGroup", header: "Host group", accessor: (r) => r.hostGroup || "—", width: "1fr" },
      {
        id: "links",
        header: "Links",
        accessor: "hostId",
        width: "2fr",
        cell: ({ rowData }) => {
          const hostUrl = entityOverviewLink("HOST", rowData.hostId);
          return (
            <Flex gap={12} alignItems="center" flexWrap="wrap">
              {hostUrl && (
                <a href={hostUrl} target="_blank" rel="noreferrer noopener">
                  Host overview ↗
                </a>
              )}
              {deployUrl && (
                <a href={deployUrl} target="_blank" rel="noreferrer noopener">
                  Deployment status ↗
                </a>
              )}
              <button
                type="button"
                style={smallBtn}
                title="Copy the host name, then paste it into the Deployment status filter"
                onClick={() => void navigator.clipboard?.writeText(rowData.name)}
              >
                Copy name
              </button>
            </Flex>
          );
        },
      },
    ],
    [deployUrl],
  );
  return (
    <QueryState state={state}>
      <Flex flexDirection="column" gap={8}>
        <DataTable data={rows} columns={columns} sortable fullWidth>
          <DataTable.EmptyState>No hosts match these filters.</DataTable.EmptyState>
        </DataTable>
        {rows.length >= 500 && <Text>Showing the first 500 hosts.</Text>}
        <Text style={{ fontSize: 12, opacity: 0.7 }}>
          The Deployment status link opens the OneAgents page; that app has no URL filter, so use Copy name and paste it into its filter bar.
        </Text>
        <QueryActions title="OneAgent host search" query={query} />
      </Flex>
    </QueryState>
  );
}

/**
 * Host group selector with a search box. A tenant can hold thousands of host groups, so the search runs server-side
 * (top 100 matches by host count, debounced) instead of loading every group into the list.
 */
export function HostGroupSelect({ tf, value, onChange }: { tf: Timeframe; value: string; onChange: (v: string) => void }) {
  const [filter, setFilter] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(filter.trim()), 300);
    return () => clearTimeout(t);
  }, [filter]);
  const state = useDql(hostGroupSearchQuery(tf, debounced));
  const found = useMemo(
    () => (state.data?.records ?? []).map((r) => r.hostGroup).filter((g): g is string => typeof g === "string" && g.length > 0),
    [state.data],
  );
  // Keep the chosen group in the list even when the current search no longer matches it.
  const options = useMemo(() => (value !== ANY && value !== NO_HOST_GROUP && !found.includes(value) ? [value, ...found] : found), [found, value]);
  return (
    <Select value={value} onChange={(v: string | null) => v && onChange(v)}>
      <Select.Content>
        <Select.EmptyState>{state.loading ? "Searching…" : "No host groups match."}</Select.EmptyState>
        <Select.Filter disableFiltering onChange={(v: string) => setFilter(v)} />
        <Select.Option value={ANY}>Any host group</Select.Option>
        <Select.Option value={NO_HOST_GROUP}>No host group</Select.Option>
        {options.map((g) => (
          <Select.Option key={g} value={g}>
            {g}
          </Select.Option>
        ))}
      </Select.Content>
    </Select>
  );
}

/** Search hosts by OneAgent version, monitoring mode and host name; results link to the host overview and Deployment status. */
export function OneAgentSearch({
  tf,
  versions,
  modes,
  selVersion,
  selMode,
  onVersionChange,
  onModeChange,
}: {
  tf: Timeframe;
  versions: string[];
  modes: string[];
  /** Version / mode filters are owned by the parent so the donuts and these dropdowns stay in sync (null = any). */
  selVersion: string | null;
  selMode: string | null;
  onVersionChange: (v: string | null) => void;
  onModeChange: (m: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [hostGroup, setHostGroup] = useState(ANY);
  const version = selVersion ?? ANY;
  const mode = selMode ?? ANY;
  const run = (v: string | null, m: string | null) =>
    oneAgentSearchQuery(tf, { name: name.trim(), version: v ?? "", mode: m ?? "", hostGroup: hostGroup === ANY ? "" : hostGroup });
  const [query, setQuery] = useState<string | null>(() => (selVersion || selMode ? run(selVersion, selMode) : null));

  // A change that came from a donut searches immediately (clearing it hides the results); a change made with
  // the dropdowns here only clears stale results and waits for "Search hosts".
  const fromDropdown = useRef(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (fromDropdown.current) {
      fromDropdown.current = false;
      return;
    }
    setQuery(selVersion || selMode ? run(selVersion, selMode) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selVersion, selMode]);

  const reset = () => setQuery(null);
  return (
    <Flex flexDirection="column" gap={16}>
      <div style={card}>
        <Heading level={4}>Find hosts</Heading>
        <Flex gap={16} alignItems="flex-end" flexWrap="wrap" style={{ marginTop: Spacings.Size8 }}>
          <FormField>
            <Label>Host name contains</Label>
            <TextInput value={name} placeholder="e.g. ip-172" onChange={(v: string) => { setName(v); reset(); }} />
          </FormField>
          <FormField>
            <Label>OneAgent version</Label>
            <Select value={version} onChange={(v: string | null) => { if (v) { fromDropdown.current = (v === ANY ? null : v) !== selVersion; onVersionChange(v === ANY ? null : v); reset(); } }}>
              <Select.Content>
                <Select.Option value={ANY}>Any version</Select.Option>
                {versions.map((v) => (
                  <Select.Option key={v} value={v}>
                    {v}
                  </Select.Option>
                ))}
              </Select.Content>
            </Select>
          </FormField>
          <FormField>
            <Label>Monitoring mode</Label>
            <Select value={mode} onChange={(v: string | null) => { if (v) { fromDropdown.current = (v === ANY ? null : v) !== selMode; onModeChange(v === ANY ? null : v); reset(); } }}>
              <Select.Content>
                <Select.Option value={ANY}>Any mode</Select.Option>
                {modes.map((m) => (
                  <Select.Option key={m} value={m}>
                    {formatMode(m)}
                  </Select.Option>
                ))}
              </Select.Content>
            </Select>
          </FormField>
          <FormField>
            <Label>Host group</Label>
            <HostGroupSelect tf={tf} value={hostGroup} onChange={(v) => { setHostGroup(v); reset(); }} />
          </FormField>
          <ShowEntitiesButton
            onClick={() =>
              setQuery(
                oneAgentSearchQuery(tf, {
                  name: name.trim(),
                  version: version === ANY ? "" : version,
                  mode: mode === ANY ? "" : mode,
                  hostGroup: hostGroup === ANY ? "" : hostGroup,
                }),
              )
            }
          >
            Search hosts
          </ShowEntitiesButton>
        </Flex>
      </div>
      {query && <Results key={query} query={query} />}
    </Flex>
  );
}
