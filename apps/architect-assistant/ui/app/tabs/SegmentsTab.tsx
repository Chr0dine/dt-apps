import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { MessageContainer } from "@dynatrace/strato-components/content";
import Colors from "@dynatrace/strato-design-tokens/colors";
import Spacings from "@dynatrace/strato-design-tokens/spacings";
import Borders from "@dynatrace/strato-design-tokens/borders";
import { useAIInsights } from "../AIInsights";
import { analyzeSegments } from "../analyses";
import { FormField, Label, TextInput } from "@dynatrace/strato-components/forms";
import { PctGauge, ScoreTile, ShowEntitiesButton, pct } from "../components";
import { managementZoneSettingsLink, segmentsAppLink } from "../links";
import { externalIdFor, listManagementZones, listSegments, type ManagementZone, type SegmentInfo } from "../segments";

// ---------------------------------------------------------------------------
// Shared data for the Segments tab and its remediation section: management zones (Settings 2.0) and
// segments (Filter Segments API). Not DQL-backed, so the gauge has no DQL actions; the membership
// queries are exposed in the remediation preview.
// ---------------------------------------------------------------------------
export type ZoneRow = ManagementZone & { segment?: SegmentInfo; managed: boolean };
type SearchRow = { name: string; rules: string; segment: string; hasSegment: boolean; objectId: string };

type SegmentsData = {
  zones: ZoneRow[] | null;
  segments: SegmentInfo[] | null;
  error: string | null;
  reload: () => void;
};

const SegmentsDataContext = createContext<SegmentsData>({ zones: null, segments: null, error: null, reload: () => undefined });
export const useSegmentsData = () => useContext(SegmentsDataContext);

function useLoadSegmentsData(): SegmentsData {
  const [zones, setZones] = useState<ManagementZone[] | null>(null);
  const [segments, setSegments] = useState<SegmentInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([listManagementZones(), listSegments()])
      .then(([z, s]) => {
        if (cancelled) return;
        setZones(z);
        setSegments(s);
      })
      .catch((e) => !cancelled && setError((e as any)?.message ?? String(e)));
    return () => {
      cancelled = true;
    };
  }, [tick]);
  const rows = useMemo<ZoneRow[] | null>(() => {
    if (!zones || !segments) return null;
    const byName = new Map<string, SegmentInfo>();
    // Prefer the segment this app created when several share a name.
    segments.forEach((s) => {
      const cur = byName.get(s.name);
      if (!cur || s.externalId === externalIdFor(s.name)) byName.set(s.name, s);
    });
    return zones.map((z) => {
      const segment = byName.get(z.name);
      return { ...z, segment, managed: !!segment && segment.externalId === externalIdFor(z.name) };
    });
  }, [zones, segments]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { zones: rows, segments, error, reload };
}

const card: React.CSSProperties = {
  padding: Spacings.Size16,
  borderRadius: Borders.Radius.Container.Default,
  background: Colors.Background.Container.Neutral.Default,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const ruleSummary = (z: ManagementZone) =>
  (["ME", "SELECTOR", "DIMENSION"] as const)
    .filter((t) => z.ruleTypes[t] > 0)
    .map((t) => `${z.ruleTypes[t]} ${t === "ME" ? "entity" : t.toLowerCase()}`)
    .join(", ") || "none";

export function SegmentsTab({ children }: { children?: React.ReactNode }) {
  const data = useLoadSegmentsData();
  const rows = useMemo(() => data.zones ?? [], [data.zones]);
  const withSegment = rows.filter((r) => r.segment).length;
  // Every segment in the environment (including ready-made ones), whether or not it matches a zone name.
  const totalSegments = data.segments?.length ?? 0;
  const segmentsNamedAfterZone = useMemo(() => {
    const names = new Set(rows.map((r) => r.name));
    return (data.segments ?? []).filter((s) => names.has(s.name)).length;
  }, [rows, data.segments]);
  const managed = rows.filter((r) => r.managed).length;
  const dimension = rows.filter((r) => r.ruleTypes.DIMENSION > 0).length;
  const { panel: aiPanel } = useAIInsights(
    useCallback(
      () => analyzeSegments(rows.map((r) => ({ name: r.name, hasSegment: !!r.segment, managed: r.managed, dimensionRules: r.ruleTypes.DIMENSION, rules: r.enabledRules }))),
      [rows],
    ),
  );
  // Management zone search: runs locally on the zones already loaded; an empty term lists every zone.
  const [nameInput, setNameInput] = useState("");
  const [term, setTerm] = useState<string | null>(null);
  const tableRows = useMemo<SearchRow[]>(
    () =>
      term === null
        ? []
        : rows
            .filter((r) => r.name.toLowerCase().includes(term.toLowerCase()))
            .map((r) => ({
              name: r.name,
              rules: ruleSummary(r),
              segment: r.managed ? "Yes (created by this app)" : r.segment ? "Yes" : "No",
              hasSegment: !!r.segment,
              objectId: r.objectId,
            })),
    [rows, term],
  );
  const columns = useMemo(
    () =>
      [
        { id: "name", header: "Management zone", accessor: "name" },
        { id: "rules", header: "Enabled rules", accessor: "rules" },
        {
          id: "segment",
          header: "Segment with the same name",
          accessor: "segment",
          cell: ({ rowData }: { rowData: SearchRow }) => {
            const url = rowData.hasSegment ? segmentsAppLink() : undefined;
            return (
              <>
                {rowData.segment}
                {url && (
                  <>
                    {" · "}
                    <a href={url} target="_blank" rel="noreferrer noopener">
                      Open Segments ↗
                    </a>
                  </>
                )}
              </>
            );
          },
        },
        {
          id: "config",
          header: "Configuration",
          accessor: "objectId",
          cell: ({ rowData }: { rowData: SearchRow }) => {
            const url = managementZoneSettingsLink(rowData.objectId);
            return url ? (
              <a href={url} target="_blank" rel="noreferrer noopener">
                Open in Settings ↗
              </a>
            ) : (
              <>—</>
            );
          },
        },
      ] as DataTableColumnDef<SearchRow>[],
    [],
  );
  return (
    <SegmentsDataContext.Provider value={data}>
      <Flex flexDirection="column" gap={16}>
        {aiPanel}
        <Heading level={3}>Segments</Heading>
        <Text>
          Segments replace management zones for filtering data on the Dynatrace platform. A management zone counts as converted when a segment with the same name exists.
          Unlike management zones, segments don&apos;t control who can see data. If you use management zones to restrict access, recreate those permissions with IAM policies.
        </Text>
        {data.error ? (
          <MessageContainer variant="critical">
            <MessageContainer.Title>Could not read management zones or segments</MessageContainer.Title>
            <MessageContainer.Description>{data.error}</MessageContainer.Description>
          </MessageContainer>
        ) : !data.zones ? (
          <Text>Loading…</Text>
        ) : (
          <>
            <Flex gap={16} flexWrap="wrap" alignItems="stretch">
              <ScoreTile
                title="Segments"
                value={String(totalSegments)}
                subtitle={`${segmentsNamedAfterZone} named after a management zone`}
              />
              <ScoreTile title="Management zones" value={String(rows.length)} subtitle={`${rows.length - withSegment} without a segment`} />
              <div style={card}>
                <PctGauge pct={pct(withSegment, rows.length)} caption="Zones with a segment" detail={`${withSegment} of ${rows.length}`} />
              </div>
              <ScoreTile title="Created by this app" value={String(managed)} subtitle="refreshable from the remediation section" />
              {dimension > 0 && <ScoreTile title="Zones with dimension rules" value={String(dimension)} subtitle="need a manual segment filter" />}
            </Flex>
            <div style={{ ...card, display: "block" }}>
              <Heading level={4}>Search management zones</Heading>
              <Flex gap={16} alignItems="flex-end" flexWrap="wrap" style={{ marginTop: Spacings.Size8 }}>
                <FormField>
                  <Label>Management zone name contains</Label>
                  <TextInput value={nameInput} placeholder="e.g. Cloud (leave empty for all)" onChange={(v: string) => setNameInput(v)} />
                </FormField>
                <ShowEntitiesButton onClick={() => setTerm(nameInput.trim())}>Search management zones</ShowEntitiesButton>
              </Flex>
            </div>
            {term !== null && (
              <DataTable data={tableRows} columns={columns} sortable fullWidth variant={{ rowDensity: "condensed" }}>
                <DataTable.EmptyState>{rows.length ? "No management zones match this search." : "No management zones are defined in this environment."}</DataTable.EmptyState>
              </DataTable>
            )}
          </>
        )}
      </Flex>
      {children}
    </SegmentsDataContext.Provider>
  );
}
