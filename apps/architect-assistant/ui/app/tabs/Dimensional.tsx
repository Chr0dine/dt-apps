import React, { useCallback, useMemo } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import Colors from "@dynatrace/strato-design-tokens/colors";
import Spacings from "@dynatrace/strato-design-tokens/spacings";
import Borders from "@dynatrace/strato-design-tokens/borders";
import { useDql, type DqlState } from "../useDql";
import { useAIInsights } from "../AIInsights";
import { analyzeDimensional } from "../analyses";
import { DIMENSIONAL_INFO, DIMENSIONAL_KINDS, dimensionalQuery, type DimensionalKind, type Timeframe } from "../queries";
import { PctGauge, QueryActions, QueryState, num, pct } from "../components";

const card: React.CSSProperties = {
  padding: Spacings.Size16,
  borderRadius: Borders.Radius.Container.Default,
  background: Colors.Background.Container.Neutral.Default,
};

export type DimensionalRow = {
  kind: DimensionalKind;
  state: DqlState;
  total: number;
  props: { key: "security" | "costcenter" | "product"; label: string; part: number; pct: number }[];
};

const PROPS: { key: "security" | "costcenter" | "product"; label: string }[] = [
  { key: "security", label: "Security context" },
  { key: "costcenter", label: "Cost center" },
  { key: "product", label: "Cost product" },
];

/** One query per data type (four fixed hooks), parsed into gauge-ready rows. */
export function useDimensional(tf: Timeframe): DimensionalRow[] {
  const metrics = useDql(dimensionalQuery(tf, "metrics"));
  const logs = useDql(dimensionalQuery(tf, "logs"));
  const events = useDql(dimensionalQuery(tf, "events"));
  const bizevents = useDql(dimensionalQuery(tf, "bizevents"));
  return useMemo(() => {
    const states: Record<DimensionalKind, DqlState> = { metrics, logs, events, bizevents };
    return DIMENSIONAL_KINDS.map((kind) => {
      const state = states[kind];
      const rec = state.data?.records?.[0] ?? {};
      const total = num(rec.total);
      return { kind, state, total, props: PROPS.map((p) => ({ ...p, part: num(rec[p.key]), pct: pct(num(rec[p.key]), total) })) };
    });
  }, [metrics, logs, events, bizevents]);
}

/** "Dimensional data" subsection of the Overview: one card per data type, like the entity cards. */
export function DimensionalSection({ rows, tf }: { rows: DimensionalRow[]; tf: Timeframe }) {
  return (
    <Flex flexDirection="column" gap={16}>
      <div>
        <Heading level={3}>Dimensional data</Heading>
        <Text style={{ opacity: 0.7 }}>
          Share of metric series, log records and events that carry the primary tags we look for. Fixing these is done in ingest (OpenPipeline or enrichment), not per entity.
        </Text>
      </div>
      {rows.map((r) => {
        const info = DIMENSIONAL_INFO[r.kind];
        return (
          <div key={r.kind} style={card}>
            <Heading level={4}>{info.title}</Heading>
            <Text style={{ opacity: 0.7, fontSize: 12 }}>{info.note}</Text>
            <QueryState state={r.state}>
              {r.total === 0 ? (
                <Text style={{ marginTop: Spacings.Size8 }}>No {info.title.toLowerCase()} found in this timeframe.</Text>
              ) : (
                <Flex gap={16} flexWrap="wrap" style={{ marginTop: Spacings.Size8 }}>
                  {r.props.map((p) => (
                    <PctGauge key={p.key} pct={p.pct} caption={p.label} detail={`${p.part.toLocaleString()} of ${r.total.toLocaleString()} ${info.unit}`} />
                  ))}
                </Flex>
              )}
            </QueryState>
            <div style={{ marginTop: Spacings.Size8 }}>
              <QueryActions title={`${info.title} primary tag coverage`} query={dimensionalQuery(tf, r.kind)} />
            </div>
          </div>
        );
      })}
    </Flex>
  );
}

/** Overall readiness plus one gauge per property (mean across the data types that returned data). */
function DimensionalSummary({ rows }: { rows: DimensionalRow[] }) {
  const withData = rows.filter((r) => r.total > 0);
  const all = withData.flatMap((r) => r.props);
  if (all.length === 0) return null;
  const mean = (xs: { pct: number }[]) => Math.round(xs.reduce((s, x) => s + x.pct, 0) / xs.length);
  return (
    <Flex gap={24} flexWrap="wrap" alignItems="flex-start" style={card}>
      <PctGauge pct={mean(all)} caption="Overall readiness" detail={`${all.length} checks`} size={238} />
      {PROPS.map((p) => {
        const items = withData.map((r) => r.props.find((x) => x.key === p.key)!);
        return <PctGauge key={p.key} pct={mean(items)} caption={p.label} detail={`avg of ${items.length} data ${items.length === 1 ? "type" : "types"}`} />;
      })}
    </Flex>
  );
}

/** Data Overview tab: dimensional data coverage for metrics, logs, events and business events. */
export function DataOverviewTab({ tf }: { tf: Timeframe }) {
  const rows = useDimensional(tf);
  const { panel: aiPanel } = useAIInsights(
    useCallback(() => analyzeDimensional(rows.map((r) => ({ title: DIMENSIONAL_INFO[r.kind].title, total: r.total, props: r.props }))), [rows]),
  );
  return (
    <Flex flexDirection="column" gap={16}>
      {aiPanel}
      <DimensionalSummary rows={rows} />
      <DimensionalSection rows={rows} tf={tf} />
    </Flex>
  );
}
