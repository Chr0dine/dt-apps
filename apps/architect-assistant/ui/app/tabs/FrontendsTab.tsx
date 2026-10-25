import React, { useCallback, useMemo, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { FormField, Label, Select } from "@dynatrace/strato-components/forms";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { MessageContainer } from "@dynatrace/strato-components/content";
import Colors from "@dynatrace/strato-design-tokens/colors";
import Spacings from "@dynatrace/strato-design-tokens/spacings";
import Borders from "@dynatrace/strato-design-tokens/borders";
import { useAIInsights } from "../AIInsights";
import { analyzeFrontends } from "../analyses";
import {
  CHECKS,
  RUM_STATUS_LABEL,
  USER_TAG_CREDENTIAL,
  type CheckKey,
  type FrontendsData,
  type FrontendRow,
  type RumStatus,
  type UserTagState,
} from "../frontends";
import type { Timeframe } from "../queries";
import { GAUGE_SIZE, PctGauge, QueryActions, QueryState, SUMMARY_GAUGE_SIZE, SUMMARY_OVERALL_SIZE, ScoreTile, statusColor } from "../components";
import { FRONTEND_ACTIONS_ANCHOR, useNav } from "../navigation";
import { Donut, type Slice } from "./ModePie";
import { FrontendActions } from "./FrontendActions";

const card: React.CSSProperties = {
  padding: Spacings.Size16,
  borderRadius: Borders.Radius.Container.Default,
  background: Colors.Background.Container.Neutral.Default,
};

// One stable color per RUM status so the donut and the table read the same.
const RUM_COLORS: Record<RumStatus, string> = {
  both: "#4589FF",
  classic: "#D2A106",
  disabled: "#EE5396",
};
const RUM_ORDER: RumStatus[] = ["both", "classic", "disabled"];

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, v) => s + v, 0) / xs.length) : 0);

function monitorDetail(a: FrontendRow): string {
  if (a.monitors === 0) return "No monitors assigned";
  const parts = [
    a.browser && plural(a.browser, "browser"),
    a.http && plural(a.http, "HTTP"),
    a.thirdparty && plural(a.thirdparty, "third-party"),
  ].filter(Boolean);
  return `${plural(a.monitors, "monitor")} assigned (${parts.join(", ")})`;
}

const rumDetail = (a: FrontendRow) => (a.rumV2 ? "RUM v2 + classic enabled" : a.rumClassic ? "RUM classic only (50%)" : "RUM disabled");
const replayDetail = (a: FrontendRow) => (a.replayGrail ? "Session Replay on Grail" : a.replayClassic ? "Session Replay classic only (50%)" : "Session Replay off");

/** Gauge-sized placeholder for a check that could not be measured. */
function NotMeasured({ caption, detail, size = GAUGE_SIZE }: { caption: string; detail: string; size?: number }) {
  return (
    <div style={{ width: size, textAlign: "center" }}>
      <div
        style={{
          height: Math.round(size * 0.78),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "2px dashed rgba(128,128,128,0.35)",
          borderRadius: size / 2,
          marginBottom: 4,
        }}
      >
        <Text style={{ opacity: 0.7, fontWeight: 600 }}>Not measured</Text>
      </div>
      <Text style={{ display: "block", fontWeight: 600 }}>{caption}</Text>
      <Text style={{ display: "block", opacity: 0.7, fontSize: 12 }}>{detail}</Text>
    </div>
  );
}

/** Explains why user tagging is not scored and how to enable it. */
function UserTagNotice({ state }: { state: UserTagState }) {
  if (state.status === "ok" || state.status === "loading") return null;
  return (
    <MessageContainer variant="warning">
      <MessageContainer.Title>User tagging is not measured</MessageContainer.Title>
      <MessageContainer.Description>
        {state.message} User tag rules are only available through the classic Config API. Create an API token with the
        Read configuration (ReadConfig) scope, store it in the credential vault as a Token credential named “{USER_TAG_CREDENTIAL}”
        with the App Engine scope (or use Actions › Set up the user tagging token below, which can create it for you). Until then, user tagging is left out of
        every average.
      </MessageContainer.Description>
    </MessageContainer>
  );
}

/** Overall readiness plus one gauge per check, averaged across all frontends. */
export function FrontendsSummary({ frontends, showOverall = true, onInfo }: { frontends: FrontendRow[]; showOverall?: boolean; onInfo?: () => void }) {
  const all = frontends.flatMap((a) => CHECKS.map((c) => a.scores[c.key]).filter((v): v is number => v !== null));
  return (
    <Flex gap={24} flexWrap="wrap" alignItems="flex-start" style={card}>
      {showOverall && <PctGauge pct={mean(frontends.map((a) => a.score))} caption="Overall readiness" detail={`${plural(all.length, "check")} across ${plural(frontends.length, "frontend")}`} size={SUMMARY_OVERALL_SIZE} />}
      {CHECKS.map((c) => {
        const vals = frontends.map((a) => a.scores[c.key]).filter((v): v is number => v !== null);
        if (vals.length === 0) return <NotMeasured key={c.key} caption={c.label} detail="no data for any frontend" size={SUMMARY_GAUGE_SIZE} />;
        const passing = vals.filter((v) => v === 100).length;
        const half = vals.filter((v) => v === 50).length;
        const detail =
          c.key === "rum" ? `${passing} v2, ${half} classic only` : c.key === "replay" ? `${passing} on Grail, ${half} classic only` : `${passing} of ${vals.length} frontends pass`;
        return <PctGauge key={c.key} pct={mean(vals)} caption={c.label} detail={detail} size={SUMMARY_GAUGE_SIZE} onInfo={onInfo} infoLabel="Open remediation actions" />;
      })}
    </Flex>
  );
}

/** Frontend count, RUM classic / v2 and Session Replay counts, and a donut of RUM status. */
function RumOverview({ frontends }: { frontends: FrontendRow[] }) {
  const slices = useMemo<Slice[]>(
    () =>
      RUM_ORDER.map((s) => ({ label: RUM_STATUS_LABEL[s], value: frontends.filter((a) => a.rum === s).length, color: RUM_COLORS[s] })).filter(
        (s) => s.value > 0,
      ),
    [frontends],
  );
  const of = `of ${frontends.length} frontends`;
  return (
    <Flex gap={16} flexWrap="wrap" alignItems="stretch">
      <ScoreTile title="Frontends" value={String(frontends.length)} subtitle="web frontends" />
      <ScoreTile title="RUM classic enabled" value={String(frontends.filter((a) => a.rumClassic).length)} subtitle={of} />
      <ScoreTile title="RUM v2 enabled" value={String(frontends.filter((a) => a.rumV2).length)} subtitle={of} />
      <ScoreTile title="Session Replay enabled" value={String(frontends.filter((a) => a.replayClassic).length)} subtitle={`${frontends.filter((a) => a.replayGrail).length} on Grail, ${of}`} />
      <div style={card}>
        <Heading level={4}>Frontends by RUM status</Heading>
        <div style={{ marginTop: Spacings.Size8 }}>
          {slices.length === 0 ? <Text>No frontends found.</Text> : <Donut slices={slices} size={GAUGE_SIZE} centerLabel="Frontends" ariaLabel="Frontends by RUM status" />}
        </div>
      </div>
    </Flex>
  );
}

function checkGauge(a: FrontendRow, key: CheckKey, userTags: UserTagState) {
  const label = CHECKS.find((c) => c.key === key)!.label;
  switch (key) {
    case "rum":
      return <PctGauge key={key} pct={a.scores.rum ?? 0} caption={label} detail={rumDetail(a)} size={SUMMARY_GAUGE_SIZE} />;
    case "replay":
      return <PctGauge key={key} pct={a.scores.replay ?? 0} caption={label} detail={replayDetail(a)} size={SUMMARY_GAUGE_SIZE} />;
    case "synthetics":
      return <PctGauge key={key} pct={a.scores.synthetics ?? 0} caption={label} detail={monitorDetail(a)} size={SUMMARY_GAUGE_SIZE} />;
    case "owner":
      return <PctGauge key={key} pct={a.scores.owner ?? 0} caption={label} detail={a.owner ? `Owner: ${a.owner}` : "No owner tag (dt.owner, owner or team)"} size={SUMMARY_GAUGE_SIZE} />;
    case "health":
      return <PctGauge key={key} pct={a.scores.health ?? 0} caption={label} detail={a.healthAlerts ? `${plural(a.healthAlerts, "health alert")} configured` : "No health alerts"} size={SUMMARY_GAUGE_SIZE} />;
    case "usertags":
      if (a.userTagRules === null) {
        return <NotMeasured key={key} caption={label} detail={userTags.status === "loading" ? "Loading…" : userTags.status === "ok" ? "Config API call failed" : "ReadConfig token missing"} size={SUMMARY_GAUGE_SIZE} />;
      }
      return <PctGauge key={key} pct={a.scores.usertags ?? 0} caption={label} detail={a.userTagRules ? `${plural(a.userTagRules, "rule")} configured` : "No user tag rule"} size={SUMMARY_GAUGE_SIZE} />;
  }
}

/** Dropdown + one gauge per check for the selected frontend. */
function FrontendDetail({ frontends, userTags, query }: { frontends: FrontendRow[]; userTags: UserTagState; query: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const app = frontends.find((a) => a.id === selected) ?? frontends[0];
  if (!app) return null;
  return (
    <div style={card}>
      <Flex justifyContent="space-between" alignItems="flex-end" flexWrap="wrap" gap={16}>
        <Heading level={4}>Frontend checks</Heading>
        <FormField>
          <Label>Frontend</Label>
          <Select value={app.id} onChange={(v: string | null) => v && setSelected(v)}>
            <Select.Content>
              {frontends.map((a) => (
                <Select.Option key={a.id} value={a.id}>
                  {a.name}
                </Select.Option>
              ))}
            </Select.Content>
          </Select>
        </FormField>
      </Flex>
      <Flex gap={16} flexWrap="wrap" style={{ marginTop: Spacings.Size12 }}>
        <PctGauge pct={app.score} caption="Frontend score" detail={app.id} size={SUMMARY_OVERALL_SIZE} />
        {CHECKS.map((c) => checkGauge(app, c.key, userTags))}
      </Flex>
      <div style={{ marginTop: Spacings.Size8 }}>
        <QueryActions title="Web frontends and assigned synthetic monitors" query={query} />
      </div>
    </div>
  );
}

const pctCell = (v: number | null) =>
  v === null ? <Text style={{ opacity: 0.6 }}>n/a</Text> : <Text style={{ fontWeight: 700, color: statusColor(v) }}>{v}%</Text>;

export function FrontendsTab({ tf, data }: { tf: Timeframe; data: FrontendsData }) {
  const { frontends, userTags } = data;
  const { panel: aiPanel } = useAIInsights(useCallback(() => analyzeFrontends(frontends, userTags.status === "ok"), [frontends, userTags.status]));
  const columns = useMemo<DataTableColumnDef<FrontendRow>[]>(
    () => [
      { id: "name", header: "Frontend", accessor: "name" },
      {
        id: "rum",
        header: "RUM",
        accessor: (r: FrontendRow) => RUM_STATUS_LABEL[r.rum],
        cell: ({ rowData }: { rowData: FrontendRow }) => (
          <Flex alignItems="center" gap={6}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: RUM_COLORS[rowData.rum], display: "inline-block" }} />
            <Text>{RUM_STATUS_LABEL[rowData.rum]}</Text>
          </Flex>
        ),
      },
      { id: "replay", header: "Session Replay", accessor: (r: FrontendRow) => (r.replayGrail ? "On Grail" : r.replayClassic ? "Classic only" : "Off") },
      { id: "monitors", header: "Synthetic monitors", accessor: "monitors" },
      { id: "userTagRules", header: "User tag rules", accessor: (r: FrontendRow) => (r.userTagRules === null ? "n/a" : r.userTagRules) },
      { id: "healthAlerts", header: "Health alerts", accessor: "healthAlerts" },
      { id: "owner", header: "Owning team", accessor: (r: FrontendRow) => r.owner ?? "—" },
      { id: "score", header: "Score", accessor: "score", cell: ({ rowData }: { rowData: FrontendRow }) => pctCell(rowData.score) },
    ] as DataTableColumnDef<FrontendRow>[],
    [],
  );
  return (
    <Flex flexDirection="column" gap={16}>
      {aiPanel}
      <Heading level={3}>Frontends</Heading>
      <Text>
        Best practices per web frontend: RUM v2 enabled and Session Replay on Grail (the classic-only variant of each scores 50%), at least one synthetic monitor
        assigned, a user tag rule configured, at least one enabled health alert, and an owning team (classic owner tag).
      </Text>
      {data.settingsError && (
        <MessageContainer variant="critical">
          <MessageContainer.Title>Reading RUM and health alert settings failed</MessageContainer.Title>
          <MessageContainer.Description>{data.settingsError}</MessageContainer.Description>
        </MessageContainer>
      )}
      <QueryState state={{ ...data.dql, loading: false }}>
        {data.loading ? (
          <Text>Loading…</Text>
        ) : frontends.length === 0 ? (
          <Text>No web frontends found in this timeframe.</Text>
        ) : (
          <Flex flexDirection="column" gap={16}>
            <UserTagNotice state={userTags} />
            <FrontendsSummary frontends={frontends} />
            <RumOverview frontends={frontends} />
            <QueryActions title="Web frontends and assigned synthetic monitors" query={data.query} />
            <FrontendDetail frontends={frontends} userTags={userTags} query={data.query} />
            <Heading level={4}>All frontends</Heading>
            <DataTable data={frontends} columns={columns} sortable fullWidth variant={{ rowDensity: "condensed" }} />
            <div id={FRONTEND_ACTIONS_ANCHOR}>
            <FrontendActions
              frontends={frontends}
              tf={tf}
              measuredUserTags={userTags.status === "ok"}
              onChanged={data.reload}
              initialAction={userTags.status === "no-credential" || userTags.status === "unauthorized" ? "user-tag-token" : undefined}
            />
            </div>
          </Flex>
        )}
      </QueryState>
    </Flex>
  );
}

/** Entity Overview section: the Frontends readiness gauges (same scoring as the Frontends tab). */
export function FrontendsOverviewCard({ data }: { data: FrontendsData }) {
  const { goToFrontends } = useNav();
  return (
    <Flex flexDirection="column" gap={8}>
      <Heading level={3}>Frontends</Heading>
      <Text style={{ opacity: 0.7 }}>Web frontends (RUM applications): RUM, Session Replay, synthetic monitors, user tagging, health alerts and ownership.</Text>
      {data.settingsError ? (
        <Text style={{ color: "#C21930" }}>{data.settingsError}</Text>
      ) : data.loading ? (
        <Text>Loading frontends…</Text>
      ) : data.frontends.length === 0 ? (
        <Text>No frontends found for this timeframe.</Text>
      ) : (
        <FrontendsSummary frontends={data.frontends} showOverall={false} onInfo={() => goToFrontends(true)} />
      )}
      <QueryActions title="Frontends" query={data.query} />
    </Flex>
  );
}
