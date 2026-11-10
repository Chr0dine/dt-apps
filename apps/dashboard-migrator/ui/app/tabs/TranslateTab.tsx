import React, { useCallback, useMemo, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text, Strong } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { Checkbox, Select } from "@dynatrace/strato-components/forms";
import { DQLEditor } from "@dynatrace/strato-components/editors";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { SectionCard, ConfidenceBadge, Chip, CONFIDENCE_COLOR, EmptyState } from "../components/layout";
import { QueryActions, actionBtn } from "../components/QueryActions";
import { PreviewChart } from "../components/PreviewChart";
import { useAIInsights } from "../components/AIInsights";
import { useMigration, type Verification } from "../MigrationContext";
import { analyzeTranslate } from "../analyses";
import { useDql } from "../useDql";
import type { TranslatedTile } from "../translate/types";

export const VISUALIZATIONS = ["lineChart", "areaChart", "barChart", "categoricalBarChart", "pieChart", "donutChart", "singleValue", "meterBar", "gauge", "table", "honeycomb"];
type Filter = "all" | "exact" | "approximate" | "manual" | "failing";

const failing = (v: Verification | undefined) => (v?.state === "done" && (!v.valid || v.missingKeys.length > 0)) || v?.state === "error";

export const TranslateTab: React.FC<{ onGoImport: () => void; onGoExport: () => void }> = ({ onGoImport, onGoExport }) => {
  const { result, tiles, verification, verifyAll, verifying, included } = useMigration();
  const [filter, setFilter] = useState<Filter>("all");

  const analysis = useCallback(() => analyzeTranslate(tiles, verification, included), [tiles, verification, included]);
  const { panel } = useAIInsights(analysis);

  const counts = useMemo(() => {
    const c = { exact: 0, approximate: 0, manual: 0, failing: 0, verified: 0, data: 0 };
    tiles.forEach((t) => {
      c[t.confidence]++;
      if (t.kind === "data") c.data++;
      if (verification[t.key]?.state === "done") c.verified++;
      if (failing(verification[t.key])) c.failing++;
    });
    return c;
  }, [tiles, verification]);

  const shown = useMemo(
    () =>
      tiles
        .filter((t) => (filter === "all" ? true : filter === "failing" ? failing(verification[t.key]) : t.confidence === filter))
        .sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x),
    [tiles, filter, verification],
  );

  if (!result) {
    return (
      <div>
        {panel}
        <SectionCard title="Nothing to translate yet">
          <Flex flexDirection="column" gap={8} alignItems="flex-start">
            <Text>Load a classic dashboard first.</Text>
            <Button variant="emphasized" onClick={onGoImport}>
              Go to Import
            </Button>
          </Flex>
        </SectionCard>
      </div>
    );
  }

  return (
    <div>
      {panel}
      <SectionCard
        title={result.name}
        subtitle="Each classic tile with its DQL equivalent. Edit any query in place; edits are verified again and kept for the export."
        actions={
          <Flex gap={8}>
            <Button onClick={() => void verifyAll()} loading={verifying} disabled={!counts.data}>
              Verify all against this environment
            </Button>
            <Button variant="emphasized" color="primary" onClick={onGoExport}>
              Continue to Export
            </Button>
          </Flex>
        }
      >
        <Flex gap={16} alignItems="center" flexWrap="wrap">
          <SummaryStat label="Exact" value={counts.exact} color={CONFIDENCE_COLOR.exact} />
          <SummaryStat label="Approximate" value={counts.approximate} color={CONFIDENCE_COLOR.approximate} />
          <SummaryStat label="Manual" value={counts.manual} color={CONFIDENCE_COLOR.manual} />
          <SummaryStat label="Verified queries" value={`${counts.verified}/${counts.data}`} />
          {counts.failing > 0 && <SummaryStat label="Failing" value={counts.failing} color={CONFIDENCE_COLOR.manual} />}
          <div style={{ marginLeft: "auto", width: 200 }}>
            <Select value={filter} onChange={(v: unknown) => setFilter(((Array.isArray(v) ? v[0] : v) as Filter) ?? "all")} aria-label="Filter tiles">
              <Select.Trigger width="full" />
              <Select.Content>
                <Select.Option value="all">All tiles</Select.Option>
                <Select.Option value="exact">Exact</Select.Option>
                <Select.Option value="approximate">Approximate</Select.Option>
                <Select.Option value="manual">Manual</Select.Option>
                <Select.Option value="failing">Failing verification</Select.Option>
              </Select.Content>
            </Select>
          </div>
        </Flex>
        {result.dashboardNotes.length > 0 && (
          <ul style={{ margin: "12px 0 0", paddingLeft: 18, fontSize: 12, opacity: 0.8 }}>
            {result.dashboardNotes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
      </SectionCard>

      {shown.map((t) => (
        <TileCard key={t.key} tile={t} />
      ))}
      {!shown.length && <EmptyState label="No tiles match the filter." />}
    </div>
  );
};

const SummaryStat: React.FC<{ label: string; value: React.ReactNode; color?: string }> = ({ label, value, color }) => (
  <div style={{ display: "flex", flexDirection: "column", minWidth: 80 }}>
    <span style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>
      {color && <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: color, marginRight: 6, verticalAlign: "middle" }} />}
      {value}
    </span>
    <span style={{ fontSize: 11, color: Colors.Text.Neutral.Subdued }}>{label}</span>
  </div>
);

const pre: React.CSSProperties = { margin: 0, padding: 10, borderRadius: 6, background: "rgba(128,128,128,0.08)", fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", overflowX: "auto", maxHeight: 260, overflowY: "auto" };
const colLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, opacity: 0.6, marginBottom: 6 };

function VerificationLine({ v }: { v: Verification | undefined }) {
  if (!v) return null;
  if (v.state === "running") return <Chip>Verifying…</Chip>;
  if (v.state === "error") return <Chip color={CONFIDENCE_COLOR.manual} title={v.message}>Invalid DQL</Chip>;
  if (!v.valid) return <Chip color={CONFIDENCE_COLOR.manual}>Invalid DQL</Chip>;
  if (v.missingKeys.length) return <Chip color={CONFIDENCE_COLOR.approximate}>Metric not found</Chip>;
  return <Chip color={CONFIDENCE_COLOR.exact}>Verified</Chip>;
}

const TileCard: React.FC<{ tile: TranslatedTile }> = ({ tile }) => {
  const { edit, resetEdit, edits, included, verification, verifyOne } = useMigration();
  const [preview, setPreview] = useState(false);
  const v = verification[tile.key];
  const e = edits[tile.key];
  const isEdited = e?.dql !== undefined || !!e?.visualization;
  const inc = included(tile);

  return (
    <div style={{ margin: "12px 20px", padding: 16, borderRadius: 10, border: `1px solid ${failing(v) ? `${CONFIDENCE_COLOR.manual}80` : "rgba(128,128,128,0.25)"}`, background: "rgba(128,128,128,0.04)", opacity: inc ? 1 : 0.6 }}>
      <Flex alignItems="center" gap={8} flexWrap="wrap">
        <Strong style={{ fontSize: 14 }}>{tile.title}</Strong>
        <Chip mono>{tile.classicType}</Chip>
        <span style={{ opacity: 0.5 }}>→</span>
        <Chip mono>{tile.kind === "markdown" ? "markdown" : tile.visualization}</Chip>
        <ConfidenceBadge confidence={tile.confidence} />
        <VerificationLine v={v} />
        {isEdited && <Chip color="#4589FF">edited</Chip>}
        <div style={{ marginLeft: "auto" }}>
          <Checkbox name={`include-${tile.key}`} value={inc} onChange={(val: boolean) => edit(tile.key, { include: val })}>
            <span>Include in new dashboard</span>
          </Checkbox>
        </div>
      </Flex>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 16, marginTop: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={colLabel}>Classic · {tile.sourceLanguage}</div>
          {tile.source ? <pre style={pre}>{tile.source}</pre> : <Text style={{ fontSize: 12, opacity: 0.6 }}>No query (built-in tile).</Text>}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={colLabel}>{tile.kind === "data" ? "DQL" : "Markdown tile"}</div>
          {tile.kind === "data" ? (
            <DQLEditor value={tile.dql ?? ""} onChange={(val: string) => edit(tile.key, { dql: val })} lineWrap aria-label={`DQL for ${tile.title}`} />
          ) : (
            <pre style={pre}>{tile.markdown}</pre>
          )}
        </div>
      </div>

      {tile.notes.length > 0 && (
        <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 12, lineHeight: 1.55, opacity: 0.85 }}>
          {tile.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}

      {v?.state === "done" && (v.messages.length > 0 || v.missingKeys.length > 0) && (
        <div style={{ marginTop: 10, fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
          {v.missingKeys.map((k) => (
            <span key={k} style={{ color: CONFIDENCE_COLOR.approximate }}>
              Metric <code>{k}</code> does not exist in this environment (or has no data). Find the right key with <code>metrics | filter contains(metric.key, "…")</code>.
            </span>
          ))}
          {v.messages.map((m, i) => (
            <span key={i} style={{ color: m.severity === "ERROR" ? CONFIDENCE_COLOR.manual : undefined, opacity: m.severity === "ERROR" ? 1 : 0.75 }}>
              {m.severity}: {m.message}
            </span>
          ))}
        </div>
      )}
      {v?.state === "error" && <div style={{ marginTop: 10, fontSize: 12, color: CONFIDENCE_COLOR.manual }}>{v.message}</div>}

      {tile.kind === "data" && (
        <Flex gap={8} alignItems="center" flexWrap="wrap" style={{ marginTop: 12 }}>
          <div style={{ width: 200 }}>
            <Select value={tile.visualization} onChange={(val: unknown) => edit(tile.key, { visualization: String(Array.isArray(val) ? val[0] : val) })} aria-label={`Visualization for ${tile.title}`}>
              <Select.Trigger width="full" />
              <Select.Content>
                {VISUALIZATIONS.map((x) => (
                  <Select.Option key={x} value={x}>
                    {x}
                  </Select.Option>
                ))}
              </Select.Content>
            </Select>
          </div>
          <button type="button" style={actionBtn} onClick={() => setPreview((p) => !p)} aria-expanded={preview}>
            {preview ? "Hide preview" : "Preview result"}
          </button>
          <button type="button" style={actionBtn} onClick={() => void verifyOne(tile)}>
            Verify
          </button>
          {isEdited && (
            <button type="button" style={actionBtn} onClick={() => resetEdit(tile.key)}>
              Reset to translation
            </button>
          )}
        </Flex>
      )}
      {tile.kind === "data" && preview && tile.dql && <TilePreview title={tile.title} dql={tile.dql} visualization={tile.visualization} />}
    </div>
  );
};

/** Runs the query (last 2 hours unless the DQL sets from:) and renders the custom preview, with the DQL actions under it. */
const TilePreview: React.FC<{ title: string; dql: string; visualization?: string }> = ({ title, dql, visualization }) => {
  const state = useDql(dql);
  const records = useMemo(() => (state.data?.records ?? []) as Record<string, unknown>[], [state.data]);
  return (
    <div style={{ marginTop: 12, padding: 12, borderRadius: 8, border: "1px solid rgba(128,128,128,0.2)" }}>
      {state.loading || state.error ? <EmptyState loading={state.loading} error={state.error} /> : <PreviewChart records={records} visualization={visualization} />}
      <div style={{ marginTop: 10 }}>
        <QueryActions title={title} query={dql} />
      </div>
    </div>
  );
};
