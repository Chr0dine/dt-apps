import React, { useCallback, useMemo } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import Colors from "@dynatrace/strato-design-tokens/colors";
import Spacings from "@dynatrace/strato-design-tokens/spacings";
import Borders from "@dynatrace/strato-design-tokens/borders";
import type { DqlState } from "../useDql";
import { useAIInsights } from "../AIInsights";
import { analyzeFieldCoverage, analyzeOverview } from "../analyses";
import {
  ENTITY_LABELS,
  ENTITY_TYPES,
  PRIMARY_FIELDS,
  coverageQuery,
  fieldApplies,
  fieldLabel,
  type EntityType,
  type FieldKey,
  type PrimaryFieldKey,
  type Timeframe,
} from "../queries";
import { useNav, type RemediationTab } from "../navigation";
import { EntitySearch } from "./EntitySearch";
import { FrontendsOverviewCard } from "./FrontendsTab";
import { CHECKS, type CheckKey, type FrontendRow, type FrontendsData } from "../frontends";
import { Button } from "@dynatrace/strato-components/buttons";
import { PctGauge, SUMMARY_GAUGE_SIZE, SUMMARY_OVERALL_SIZE, QueryActions, QueryState, num, pct, statusColor } from "../components";

export type CoverageRow = {
  type: EntityType;
  field: string;
  label: string;
  part: number;
  total: number;
  pct: number;
  detail?: string;
};

const PRIMARY_KEYS = Object.keys(PRIMARY_FIELDS) as PrimaryFieldKey[];

/** Flattens the single coverage query result into one row per (entity type, field). */
export function toCoverageRows(state: DqlState): CoverageRow[] {
  const byType = new Map<EntityType, Record<string, any>>();
  for (const rec of state.data?.records ?? []) byType.set(rec.type as EntityType, rec);
  const rows: CoverageRow[] = [];
  for (const type of ENTITY_TYPES) {
    const rec = byType.get(type);
    if (!rec) continue;
    const total = num(rec.total);
    if (total === 0) continue;
    for (const field of PRIMARY_KEYS) {
      if (!fieldApplies(type, field)) continue;
      const part = num(rec[field]);
      rows.push({ type, field, label: PRIMARY_FIELDS[field].label, part, total, pct: pct(part, total) });
    }
  }
  return rows;
}

const card: React.CSSProperties = {
  padding: Spacings.Size16,
  borderRadius: Borders.Radius.Container.Default,
  background: Colors.Background.Container.Neutral.Default,
};

/** One card per entity type with a gauge per best practice. */
export function EntityGaugeSections({ rows, keys, infoFor }: { rows: CoverageRow[]; keys: string[]; infoFor?: (field: string) => (() => void) | undefined }) {
  const sections = ENTITY_TYPES.map((type) => ({ type, items: rows.filter((r) => r.type === type && keys.includes(r.field)) })).filter(
    (s) => s.items.length > 0,
  );
  if (sections.length === 0) return <Text>No entities found for this timeframe.</Text>;
  return (
    <Flex flexDirection="column" gap={16}>
      {sections.map(({ type, items }) => (
        <div key={type} style={card}>
          <Heading level={4}>{ENTITY_LABELS[type].title}</Heading>
          <Flex gap={16} flexWrap="wrap" style={{ marginTop: Spacings.Size8 }}>
            {items.map((r) => (
              <PctGauge key={r.field} pct={r.pct} caption={r.label} detail={r.detail ?? `${r.part.toLocaleString()} of ${r.total.toLocaleString()}`} onInfo={infoFor?.(r.field)} />
            ))}
          </Flex>
        </div>
      ))}
    </Flex>
  );
}

/** One gauge per entity type for a single best practice (used when a tab focuses on one field). */
export function TypeGaugeGrid({ rows, field, title }: { rows: CoverageRow[]; field: string; title?: string }) {
  const items = ENTITY_TYPES.map((t) => rows.find((r) => r.type === t && r.field === field)).filter((r): r is CoverageRow => !!r);
  if (items.length === 0) return <Text>No entities found for this timeframe.</Text>;
  return (
    <div style={card}>
      {title && <Heading level={4}>{title}</Heading>}
      <Flex gap={16} flexWrap="wrap" style={title ? { marginTop: Spacings.Size8 } : undefined}>
        {items.map((r) => (
          <PctGauge key={r.type} pct={r.pct} caption={ENTITY_LABELS[r.type].title} detail={`${r.part.toLocaleString()} of ${r.total.toLocaleString()}`} />
        ))}
      </Flex>
    </div>
  );
}

const PHRASE: Record<PrimaryFieldKey, string> = {
  security: "a security context",
  costcenter: "a cost center",
  product: "a cost product",
  hostgroup: "a host group",
  owner: "an ownership team",
};
const phrase = (field: string) => PHRASE[field as PrimaryFieldKey];

/** Importance of an entity type (lower = more important): infrastructure the customer owns first (hosts, nodes, clusters), then containers, then the objects and processes running on it. */
/** Frontends rank after hosts, nodes and clusters and before the entities running on them. */
const FRONTEND_TYPE = "FRONTEND";
type FindingType = EntityType | typeof FRONTEND_TYPE;
const RANK: Record<FindingType, number> = {
  FRONTEND: 2.5,
  HOST: 0,
  K8S_NODE: 1,
  K8S_CLUSTER: 2,
  CONTAINER: 3,
  K8S_NAMESPACE: 4,
  K8S_DEPLOYMENT: 4,
  K8S_POD: 4,
  PROCESS: 5,
  SERVICE: 5,
};

/** Tab whose remediation section fixes a given check. */
const REMEDIATION_TARGET: Record<PrimaryFieldKey, RemediationTab> = {
  security: "security",
  costcenter: "cost",
  product: "cost",
  hostgroup: "hostgroups",
  owner: "ownership",
};
const TARGET_LABEL: Record<RemediationTab, string> = {
  "primary-tags": "Primary tags",
  security: "Security context",
  cost: "Cost allocation",
  hostgroups: "Host groups",
  ownership: "Ownership & Teams",
  oneagent: "OneAgent",
  segments: "Segments",
};
const targetFor = (field: string): RemediationTab => REMEDIATION_TARGET[field as PrimaryFieldKey];

/** One scored check: a CoverageRow, or a frontend check (part = frontends passing, total = frontends measured). */
export type FindingRow = Omit<CoverageRow, "type"> & { type: FindingType };
export type Finding = { row: FindingRow; text: string; target: RemediationTab | "frontends" };

const FRONTEND_PHRASE: Record<CheckKey, string> = {
  rum: "RUM v2 enabled",
  replay: "Session Replay on Grail enabled",
  synthetics: "synthetic monitors assigned",
  usertags: "user tagging configured",
  health: "health alerts configured",
  owner: "an owning team",
};

/** One row per frontend check (mean score of the frontends where it was measured), for Top findings. */
export function frontendFindingRows(frontends: FrontendRow[]): FindingRow[] {
  return CHECKS.flatMap((c) => {
    const vals = frontends.map((f) => f.scores[c.key]).filter((v): v is number => v !== null);
    if (vals.length === 0) return [];
    return [{ type: FRONTEND_TYPE, field: c.key, label: c.label, part: vals.filter((v) => v === 100).length, total: vals.length, pct: Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) }];
  });
}

/** Biggest holes, ranked by entity importance (hosts, nodes, clusters, containers, then Kubernetes objects, then processes/services), then by gap size weighted (log) by population; max 2 per entity type. */
export function topFindings(rows: FindingRow[], limit = 5): Finding[] {
  const scored = rows
    .filter((r) => r.pct < 100)
    .map((r) => ({ r, score: (100 - r.pct) * Math.log10(r.total + 10) }))
    .sort((a, b) => RANK[a.r.type] - RANK[b.r.type] || b.score - a.score);
  const perType = new Map<FindingType, number>();
  const out: Finding[] = [];
  for (const { r } of scored) {
    const n = perType.get(r.type) ?? 0;
    if (n >= 2) continue;
    perType.set(r.type, n + 1);
    const isFrontend = r.type === FRONTEND_TYPE;
    const noun = r.type === FRONTEND_TYPE ? "frontends" : ENTITY_LABELS[r.type].plural;
    const what = isFrontend ? FRONTEND_PHRASE[r.field as CheckKey] : phrase(r.field);
    const text =
      r.pct === 0
        ? `None of the ${r.total.toLocaleString()} ${noun} have ${what}.`
        : `Only ${r.pct}% of ${noun} have ${what} (${r.part.toLocaleString()} of ${r.total.toLocaleString()}).`;
    out.push({ row: r, text, target: isFrontend ? "frontends" : targetFor(r.field) });
    if (out.length === limit) break;
  }
  return out;
}

export function TopFindingsPanel({ rows, frontendRows }: { rows: CoverageRow[]; frontendRows: FindingRow[] }) {
  const findings = useMemo(() => topFindings([...rows, ...frontendRows]), [rows, frontendRows]);
  const { goToRemediation, goToFrontends } = useNav();
  return (
    <div style={card}>
      <Heading level={3}>Top 5 findings</Heading>
      <Text style={{ opacity: 0.7 }}>The biggest best-practice gaps, ranked by entity importance (hosts, nodes and clusters first, then frontends, then the entities running on them) and then by size.</Text>
      <Flex flexDirection="column" gap={8} style={{ marginTop: Spacings.Size12 }}>
        {findings.length === 0 && <Text>No gaps found — every check is fully in place.</Text>}
        {findings.map(({ row, text, target }, i) => (
          <Flex
            key={`${row.type}-${row.field}`}
            alignItems="center"
            gap={12}
            style={{ padding: "8px 12px", borderLeft: `4px solid ${statusColor(row.pct)}`, borderRadius: 4, background: "rgba(128,128,128,0.05)" }}
          >
            <Text style={{ fontWeight: 700, minWidth: 18 }}>{i + 1}</Text>
            <Text style={{ flex: 1 }}>{text}</Text>
            <Text style={{ fontWeight: 700, color: statusColor(row.pct) }}>{row.pct}%</Text>
            <Button variant="default" size="condensed" onClick={() => (target === "frontends" ? goToFrontends() : goToRemediation(target))}
              aria-label={`Open remediation steps: ${target === "frontends" ? "Frontends" : TARGET_LABEL[target]}`}>
              Remediation steps →
            </Button>
          </Flex>
        ))}
      </Flex>
    </div>
  );
}

// The top summary row is 25% smaller than the gauges in the sections below so every gauge fits on one line.

/** Overall readiness plus one gauge per best practice (mean across the entity types it applies to). */
function SummaryGauges({
  rows,
  infoFor,
  frontendPct,
  frontendCount,
  onFrontendInfo,
}: {
  rows: CoverageRow[];
  infoFor: (field: string) => (() => void) | undefined;
  /** Mean readiness of all frontends; counts as one extra check in the overall score. null = no frontends. */
  frontendPct: number | null;
  frontendCount: number;
  onFrontendInfo: () => void;
}) {
  const pcts = [...rows.map((r) => r.pct), ...(frontendPct === null ? [] : [frontendPct])];
  const overall = pcts.length ? Math.round(pcts.reduce((s, p) => s + p, 0) / pcts.length) : 0;
  const groups = PRIMARY_KEYS.map((k) => ({ key: k, label: PRIMARY_FIELDS[k].label, items: rows.filter((r) => r.field === k) })).filter((g) => g.items.length > 0);
  return (
    <Flex gap={24} flexWrap="wrap" alignItems="flex-start" style={card}>
      <PctGauge pct={overall} caption="Overall readiness" detail={`${pcts.length} checks`} size={SUMMARY_OVERALL_SIZE} />
      {groups.map((g) => (
        <PctGauge
          key={g.key}
          pct={Math.round(g.items.reduce((s, r) => s + r.pct, 0) / g.items.length)}
          caption={g.label}
          detail={`avg of ${g.items.length} ${g.items.length === 1 ? "check" : "checks"}`}
          size={SUMMARY_GAUGE_SIZE}
          onInfo={infoFor(g.key)}
        />
      ))}
      {frontendPct !== null && (
        <PctGauge pct={frontendPct} caption="Frontend overall readiness" detail={`avg of ${frontendCount} ${frontendCount === 1 ? "frontend" : "frontends"}`} size={SUMMARY_GAUGE_SIZE} onInfo={onFrontendInfo} infoLabel="Open the Frontends tab" />
      )}
    </Flex>
  );
}

const OVERVIEW_KEYS: string[] = [...PRIMARY_KEYS];

/** Entity Overview: summary gauges, top findings, then a gauge card per entity type. */
export function OverviewTab({ coverage, tf, frontends }: { coverage: DqlState; tf: Timeframe; frontends: FrontendsData }) {
  const rows = useMemo(() => toCoverageRows(coverage), [coverage]);
  const { goToRemediation, goToFrontends } = useNav();
  const infoFor = (field: string) => (field in REMEDIATION_TARGET ? () => goToRemediation(REMEDIATION_TARGET[field as PrimaryFieldKey]) : undefined);
  // Frontends are classic entities outside the Smartscape coverage query; their mean readiness is one extra check.
  const frontendPct = useMemo(() => {
    if (frontends.loading || frontends.settingsError || frontends.frontends.length === 0) return null;
    return Math.round(frontends.frontends.reduce((s, f) => s + f.score, 0) / frontends.frontends.length);
  }, [frontends.loading, frontends.settingsError, frontends.frontends]);
  const frontendCount = frontends.frontends.length;
  const frontendRows = useMemo(
    () => (frontendPct === null ? [] : frontendFindingRows(frontends.frontends)),
    [frontendPct, frontends.frontends],
  );
  const { panel: aiPanel } = useAIInsights(useCallback(() => analyzeOverview(rows, frontendPct === null ? null : { pct: frontendPct, count: frontendCount }), [rows, frontendPct, frontendCount]));
  return (
    <QueryState state={coverage}>
      {aiPanel}
      <Flex flexDirection="column" gap={16}>
        <SummaryGauges rows={rows} infoFor={infoFor} frontendPct={frontendPct} frontendCount={frontendCount} onFrontendInfo={() => goToFrontends()} />
        <TopFindingsPanel rows={rows} frontendRows={frontendRows} />
        <Heading level={3}>Adoption by entity type</Heading>
        <EntityGaugeSections rows={rows} keys={OVERVIEW_KEYS} infoFor={infoFor} />
        <QueryActions title="Primary field coverage" query={coverageQuery(tf)} />
        <FrontendsOverviewCard data={frontends} />
      </Flex>
    </QueryState>
  );
}

type Focus = { keys: FieldKey[]; title: string; blurb: string; searchTitle: string };

/** Coverage tiles (gauge per entity type, one tile per field) plus an entity search for the focused properties. */
export function FieldCoverageTab({ coverage, tf, focus, ai = true }: { coverage: DqlState; tf: Timeframe; focus: Focus; ai?: boolean }) {
  const rows = useMemo(() => toCoverageRows(coverage).filter((r) => (focus.keys as string[]).includes(r.field)), [coverage, focus]);
  const types = useMemo(() => ENTITY_TYPES.filter((t) => focus.keys.some((k) => fieldApplies(t, k))), [focus]);
  const fields = useMemo(
    () => focus.keys.map((k) => ({ key: k, label: fieldLabel(k), expr: PRIMARY_FIELDS[k].field, array: k === "security" })),
    [focus],
  );
  // `ai={false}`: a parent tab can render one combined panel instead.
  const { panel: aiPanel } = useAIInsights(useCallback(() => analyzeFieldCoverage(focus.title, rows), [focus.title, rows]));

  return (
    <Flex flexDirection="column" gap={16}>
      {ai && aiPanel}
      <Heading level={3}>{focus.title}</Heading>
      <Text>{focus.blurb}</Text>
      <QueryState state={coverage}>
        {focus.keys.length === 1 ? (
          <TypeGaugeGrid rows={rows} field={focus.keys[0]} />
        ) : (
          <Flex flexDirection="column" gap={16}>
            {focus.keys.map((k) => (
              <TypeGaugeGrid key={k} rows={rows} field={k} title={fieldLabel(k)} />
            ))}
          </Flex>
        )}
      </QueryState>
      <QueryActions title={`${focus.title} coverage`} query={coverageQuery(tf)} />
      <EntitySearch tf={tf} title={focus.searchTitle} fields={fields} types={types} />
    </Flex>
  );
}

export const SECURITY_FOCUS: Focus = {
  keys: ["security"],
  title: "Security context",
  searchTitle: "Search entities by security context",
  blurb:
    "dt.security_context drives data access (IAM policy boundaries) and security-team ownership. Entities without it cannot be scoped by security context.",
};

export const COST_FOCUS: Focus = {
  keys: ["costcenter", "product"],
  title: "Cost allocation",
  searchTitle: "Search entities by cost allocation",
  blurb: "dt.cost.costcenter and dt.cost.product attribute consumption and cost to the right owner.",
};


export const OWNER_FOCUS: Focus = {
  keys: ["owner"],
  title: "Ownership and teams",
  searchTitle: "Search entities by owning team",
  blurb:
    "Ownership is a key/value (dt.owner, owner or team) on hosts, processes and Kubernetes objects whose value matches a team identifier. Services, containers and clusters carry no label or property map, so they are not scored.",
};
