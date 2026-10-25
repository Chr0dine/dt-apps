import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { MessageContainer } from "@dynatrace/strato-components/content";
import { Checkbox, Select, TextInput } from "@dynatrace/strato-components/forms";
import Colors from "@dynatrace/strato-design-tokens/colors";
import Spacings from "@dynatrace/strato-design-tokens/spacings";
import Borders from "@dynatrace/strato-design-tokens/borders";
import { useAIInsights } from "../AIInsights";
import { analyzeSlos } from "../analyses";
import { PctGauge, QueryActions, ScoreTile, ShowEntitiesButton, pct } from "../components";
import { Field, Links, ManualActionView, Request } from "../RemediationPanel";
import {
  SLO_DOCS,
  classicSloLink,
  evaluateClassic,
  evaluateSlo,
  listClassicSlos,
  listNewSlos,
  manualUpgradeAction,
  matchSlos,
  planUpgrades,
  previewSli,
  recipeLabel,
  sloLink,
  upgradeSlos,
  type Evaluation,
  type NewSlo,
  type PlanResult,
  type Preview,
  type SloPlan,
  type SloRow,
  type UpgradeResult,
} from "../slos";

// ---------------------------------------------------------------------------
// SLOs tab: classic SLOs (classic SLO API) vs SLOs (platform SLO API). A classic SLO counts as upgraded when an SLO
// with the same name exists. Not DQL-backed, so the gauge has no DQL actions; every generated SLI query is exposed
// with its own actions in the upgrade preview.
// ---------------------------------------------------------------------------

type SloData = { rows: SloRow[] | null; slos: NewSlo[] | null; error: string | null; reload: () => void };

function useSloData(): SloData {
  const [rows, setRows] = useState<SloRow[] | null>(null);
  const [slos, setSlos] = useState<NewSlo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([listClassicSlos(), listNewSlos()])
      .then(([c, s]) => {
        if (cancelled) return;
        setRows(matchSlos(c, s));
        setSlos(s);
      })
      .catch((e) => !cancelled && setError((e as any)?.message ?? String(e)));
    return () => {
      cancelled = true;
    };
  }, [tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { rows, slos, error, reload };
}

const box: React.CSSProperties = {
  padding: Spacings.Size16,
  borderRadius: Borders.Radius.Container.Default,
  background: Colors.Background.Container.Neutral.Default,
};
const card: React.CSSProperties = { ...box, display: "flex", alignItems: "center", justifyContent: "center" };
const hint: React.CSSProperties = { fontSize: 12, opacity: 0.7 };
const OK = "#0D9C29";
const BAD = "#C21930";
const WARN = "#E87A00";
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toFixed(2)} %`);
const statusLine = (color: string): React.CSSProperties => ({ padding: "8px 12px", borderRadius: 6, borderLeft: `4px solid ${color}`, background: "rgba(128,128,128,0.06)" });

function ExtLink({ href, children }: { href?: string; children: React.ReactNode }) {
  return href ? (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ) : (
    <>{children}</>
  );
}

// --- Search table ----------------------------------------------------------------
type Upgraded = "any" | "missing" | "upgraded";
type TableRow = { id: string; name: string; enabled: string; target: string; timeframe: string; conversion: string; slo: string; sloId?: string };

function SloSearch({ rows }: { rows: SloRow[] }) {
  const [nameInput, setNameInput] = useState("");
  const [filter, setFilter] = useState<Upgraded>("any");
  const [term, setTerm] = useState<{ name: string; filter: Upgraded } | null>(null);
  const data = useMemo<TableRow[]>(
    () =>
      term === null
        ? []
        : rows
            .filter((r) => r.name.toLowerCase().includes(term.name.toLowerCase()))
            .filter((r) => (term.filter === "missing" ? !r.match : term.filter === "upgraded" ? !!r.match : true))
            .map((r) => ({
              id: r.id,
              name: r.name,
              enabled: r.enabled ? "Yes" : "No",
              target: `${r.target}${r.warning > r.target ? ` / ${r.warning}` : ""}`,
              timeframe: r.timeframe,
              conversion: recipeLabel(r.metricExpression) ?? "Manual",
              slo: r.managed ? "Yes (created by this app)" : r.match ? "Yes" : "No",
              sloId: r.match?.id,
            })),
    [rows, term],
  );
  const columns = useMemo(
    () =>
      [
        { id: "name", header: "Classic SLO", accessor: "name", cell: ({ rowData }: { rowData: TableRow }) => <ExtLink href={classicSloLink(rowData.id)}>{rowData.name}</ExtLink> },
        { id: "enabled", header: "Enabled", accessor: "enabled" },
        { id: "target", header: "Target / warning", accessor: "target" },
        { id: "timeframe", header: "Timeframe", accessor: "timeframe" },
        { id: "conversion", header: "Conversion", accessor: "conversion" },
        {
          id: "slo",
          header: "SLO with the same name",
          accessor: "slo",
          cell: ({ rowData }: { rowData: TableRow }) => (
            <>
              {rowData.slo}
              {rowData.sloId && sloLink(rowData.sloId) && (
                <>
                  {" · "}
                  <ExtLink href={sloLink(rowData.sloId)}>Open SLO ↗</ExtLink>
                </>
              )}
            </>
          ),
        },
      ] as DataTableColumnDef<TableRow>[],
    [],
  );
  return (
    <>
      <div style={box}>
        <Heading level={4}>Search classic SLOs</Heading>
        <Flex gap={16} alignItems="flex-end" flexWrap="wrap" style={{ marginTop: Spacings.Size8 }}>
          <Field label="Name contains">
            <TextInput value={nameInput} placeholder="e.g. availability (leave empty for all)" onChange={(v: string) => setNameInput(v)} />
          </Field>
          <Field label="Upgrade status">
            <Select value={filter} onChange={(v: Upgraded | null) => v && setFilter(v)}>
              <Select.Content>
                <Select.Option value="any">Any</Select.Option>
                <Select.Option value="missing">Not upgraded</Select.Option>
                <Select.Option value="upgraded">Upgraded</Select.Option>
              </Select.Content>
            </Select>
          </Field>
          <ShowEntitiesButton onClick={() => setTerm({ name: nameInput.trim(), filter })}>Search classic SLOs</ShowEntitiesButton>
        </Flex>
      </div>
      {term !== null && (
        <DataTable data={data} columns={columns} sortable fullWidth variant={{ rowDensity: "condensed" }}>
          <DataTable.EmptyState>{rows.length ? "No classic SLOs match this search." : "No classic SLOs are defined in this environment."}</DataTable.EmptyState>
        </DataTable>
      )}
    </>
  );
}

// --- Upgrade form ------------------------------------------------------------------
type Scope = "missing" | "managed" | "all";
type Checked = { plans: { row: SloRow; result: PlanResult }[]; previews: Map<string, Preview>; classic: Map<string, { value: number | null; error?: string }>; classicError?: string };

/** Runs fn over items, `limit` at a time. */
async function inBatches<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) out.push(...(await Promise.all(items.slice(i, i + limit).map(fn))));
  return out;
}

function UpgradeForm({ rows, reload }: { rows: SloRow[]; reload: () => void }) {
  const [scope, setScope] = useState<Scope>("missing");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [checked, setChecked] = useState<Checked | null>(null);
  const [skipNoData, setSkipNoData] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<(UpgradeResult & { evaluation?: Evaluation; classicValue?: number | null })[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const candidates = useMemo(
    () =>
      rows
        .filter((r) => (scope === "missing" ? !r.match : scope === "managed" ? r.managed : true))
        .filter((r) => !search || r.name.toLowerCase().includes(search.toLowerCase())),
    [rows, scope, search],
  );
  const chosen = candidates.filter((r) => selected[r.id]);
  const autoIds = candidates.filter((r) => recipeLabel(r.metricExpression)).map((r) => r.id);

  const reset = () => {
    setChecked(null);
    setResults(null);
    setConfirm(false);
    setError(null);
  };
  const validate = async () => {
    setBusy(true);
    reset();
    try {
      const plans = planUpgrades(chosen);
      const runnable = plans.flatMap((p) => (p.result.plan ? [p.result.plan] : []));
      const [previews, classic] = await Promise.all([
        inBatches(runnable, 4, async (p) => [p.classic.id, await previewSli(p)] as const).then((x) => new Map(x)),
        evaluateClassic(runnable.map((p) => p.classic.id)).then(
          (m) => ({ m, err: undefined as string | undefined }),
          (e) => ({ m: new Map<string, { value: number | null; error?: string }>(), err: (e as any)?.message ?? String(e) }),
        ),
      ]);
      setChecked({ plans, previews, classic: classic.m, classicError: classic.err });
    } catch (e) {
      setError((e as any)?.message ?? String(e));
    }
    setBusy(false);
  };

  const toRun = useMemo<SloPlan[]>(
    () =>
      (checked?.plans ?? []).flatMap((p) => {
        const plan = p.result.plan;
        if (!plan) return [];
        const pv = checked?.previews.get(plan.classic.id);
        // A failing query would create a broken SLO, so it is always skipped; "no data" is up to the user.
        if (pv?.kind === "error" || (pv?.kind === "nodata" && skipNoData)) return [];
        return [plan];
      }),
    [checked, skipNoData],
  );
  const creates = toRun.filter((p) => !p.existing).length;
  const updates = toRun.length - creates;

  const run = async () => {
    setBusy(true);
    setProgress(0);
    const done = await upgradeSlos(toRun, setProgress);
    setResults(done);
    setConfirm(false);
    // Evaluate what was created so the classic and new values can be compared right away.
    const evaluated = await inBatches(done, 4, async (r) => {
      const plan = toRun.find((p) => p.classic.name === r.name);
      return { ...r, evaluation: r.ok && r.id ? await evaluateSlo(r.id) : undefined, classicValue: plan ? checked?.classic.get(plan.classic.id)?.value : undefined };
    });
    setResults(evaluated);
    setBusy(false);
    reload();
  };

  const sample = toRun[0] ? `// ${toRun[0].existing ? `PUT /platform/slo/v1/slos/${toRun[0].existing.id}` : "POST /platform/slo/v1/slos"}\n${JSON.stringify(toRun[0].body, null, 2)}` : "";
  return (
    <Flex flexDirection="column" gap={12}>
      <Text>
        Creates an SLO with the same name, target, warning and evaluation window for each selected classic SLO. The SLI is generated from the metric expression
        (service availability and performance, synthetic availability, host and Kubernetes efficiency); the entity selector is kept with classicEntitySelector().
        Other metric expressions need the manual upgrade. Classic SLOs are not changed or deleted.
      </Text>
      <Flex gap={16} flexWrap="wrap" alignItems="flex-end">
        <Field label="Classic SLOs">
          <Select value={scope} onChange={(v: Scope | null) => { if (v) { setScope(v); setSelected({}); reset(); } }}>
            <Select.Content>
              <Select.Option value="missing">Not upgraded</Select.Option>
              <Select.Option value="managed">Upgraded by this app (update)</Select.Option>
              <Select.Option value="all">All</Select.Option>
            </Select.Content>
          </Select>
        </Field>
        <Field label="Name contains">
          <TextInput value={search} placeholder="e.g. availability" onChange={(v: string) => setSearch(v)} />
        </Field>
      </Flex>
      {candidates.length === 0 ? (
        <Text>{scope === "missing" ? "Every classic SLO already has an SLO with the same name." : "No classic SLOs match."}</Text>
      ) : (
        <>
          <Flex gap={8}>
            <Button variant="default" size="condensed" onClick={() => { setSelected(Object.fromEntries(autoIds.map((id) => [id, true]))); reset(); }}>
              Auto-convertible ({autoIds.length})
            </Button>
            <Button variant="default" size="condensed" onClick={() => { setSelected(Object.fromEntries(candidates.map((r) => [r.id, true]))); reset(); }}>
              All ({candidates.length})
            </Button>
            <Button variant="default" size="condensed" onClick={() => { setSelected({}); reset(); }}>
              Clear
            </Button>
          </Flex>
          <Flex flexDirection="column" gap={4} style={{ maxHeight: 240, overflowY: "auto" }}>
            {candidates.map((r) => {
              const label = recipeLabel(r.metricExpression);
              return (
                <Checkbox key={r.id} value={!!selected[r.id]} onChange={(v: boolean) => { setSelected((s) => ({ ...s, [r.id]: v })); reset(); }}>
                  {r.name}
                  <span style={{ ...hint, marginLeft: 8 }}>
                    {label ?? "manual upgrade"}
                    {r.enabled ? "" : " · disabled"}
                    {r.managed ? " · update" : r.match ? " · SLO exists, not created by this app" : ""}
                  </span>
                </Checkbox>
              );
            })}
          </Flex>
          <div>
            <Button variant="default" disabled={busy || chosen.length === 0} onClick={() => void validate()}>
              {busy && !checked ? "Validating…" : `Validate (${chosen.length})`}
            </Button>
          </div>
          <Text style={hint}>Validate runs each generated SLI query over the SLO&apos;s window and evaluates the classic SLO (one call per 25), so both values can be compared. Nothing is written.</Text>
        </>
      )}
      {error && <Text style={{ color: BAD }}>{error}</Text>}
      {checked && (
        <>
          {checked.classicError && <Text style={{ ...hint, color: WARN }}>Classic values unavailable: {checked.classicError}</Text>}
          <Flex flexDirection="column" gap={8}>
            {checked.plans.map(({ row, result }) => {
              const plan = result.plan;
              const pv = plan ? checked.previews.get(row.id) : undefined;
              const color = !plan ? ("manual" in result && result.manual ? WARN : BAD) : pv?.kind === "error" ? BAD : pv?.kind === "nodata" ? WARN : OK;
              return (
                <div key={row.id} style={statusLine(color)}>
                  <Text style={{ display: "block", fontWeight: 600 }}>
                    {row.name} — {!plan ? "skipped" : plan.existing ? "update (same SLO ID)" : "create"}
                  </Text>
                  {!plan && <Text style={{ display: "block", ...hint, color }}>{result.problem}</Text>}
                  {plan && (
                    <>
                      <Text style={{ display: "block", ...hint }}>
                        {plan.recipe.label} · target {String((plan.body.criteria as any[])[0].target)}
                        {(plan.body.criteria as any[])[0].warning !== undefined ? `, warning ${(plan.body.criteria as any[])[0].warning}` : ""} · {String((plan.body.criteria as any[])[0].timeframeFrom)} to now
                      </Text>
                      <Text style={{ display: "block", ...hint }}>
                        Classic: {fmt(checked.classic.get(row.id)?.value)}
                        {checked.classic.get(row.id)?.error ? ` (${checked.classic.get(row.id)?.error})` : ""} · SLI preview (mean of data points): {fmt(pv?.value)}
                      </Text>
                      {pv && !pv.ok && <Text style={{ display: "block", ...hint, color: pv.kind === "error" ? BAD : WARN }}>{pv.message}</Text>}
                      <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
                        {plan.notes.map((n) => (
                          <li key={n}>
                            <Text style={hint}>{n}</Text>
                          </li>
                        ))}
                      </ul>
                      <QueryActions title={`SLI: ${row.name}`} query={plan.query} />
                    </>
                  )}
                </div>
              );
            })}
          </Flex>
          <Checkbox value={skipNoData} onChange={(v: boolean) => { setSkipNoData(v); setConfirm(false); }}>
            Skip SLOs whose query returned no data (their SLO would show an error)
          </Checkbox>
          {toRun.length > 0 ? (
            <>
              <Request label={`Request (1 API call per SLO: ${creates} new + ${updates} updated)`} text={sample} />
              <Checkbox value={confirm} onChange={(v: boolean) => setConfirm(v)}>
                {creates ? `Create ${creates}` : ""}
                {creates && updates ? " / " : ""}
                {updates ? `update ${updates}` : ""} {plural(toRun.length, "SLO")} (classic SLOs stay as they are)
              </Checkbox>
              <Flex gap={8} alignItems="center">
                <Button variant="emphasized" disabled={busy || !confirm} onClick={() => void run()}>
                  Upgrade to SLOs
                </Button>
                {busy && <Text style={hint}>{progress} of {toRun.length} done…</Text>}
              </Flex>
            </>
          ) : (
            <Text>Nothing to create: every selected classic SLO was skipped.</Text>
          )}
        </>
      )}
      {results && (
        <Flex flexDirection="column" gap={4} role="status">
          {results.map((r) => (
            <div key={r.name} style={statusLine(r.ok ? OK : BAD)}>
              <Text>
                <strong>{r.name}</strong>: {r.message}
              </Text>
              {r.ok && (
                <Text style={{ display: "block", ...hint }}>
                  {r.evaluation
                    ? `New SLO: ${r.evaluation.status}${r.evaluation.value !== null ? ` ${fmt(r.evaluation.value)}` : ""}${r.evaluation.message ? ` (${r.evaluation.message})` : ""} · Classic: ${fmt(r.classicValue)}`
                    : busy
                      ? "Evaluating…"
                      : ""}
                </Text>
              )}
              {r.id && sloLink(r.id) && (
                <a href={sloLink(r.id)} target="_blank" rel="noreferrer noopener" style={{ fontSize: 12 }}>
                  Open SLO ↗
                </a>
              )}
            </div>
          ))}
        </Flex>
      )}
    </Flex>
  );
}

// --- Actions ------------------------------------------------------------------------
function SloActions({ rows, reload }: { rows: SloRow[]; reload: () => void }) {
  const missing = rows.filter((r) => !r.match);
  const auto = missing.filter((r) => recipeLabel(r.metricExpression)).length;
  const actions = [
    { id: "upgrade", label: "Upgrade classic SLOs to SLOs", kind: "api" as const, node: <UpgradeForm rows={rows} reload={reload} />, docs: SLO_DOCS },
    { id: manualUpgradeAction.id, label: manualUpgradeAction.title, kind: "manual" as const, node: <ManualActionView action={manualUpgradeAction} />, docs: manualUpgradeAction.docs },
  ];
  const [pick, setPick] = useState(actions[0].id);
  const active = actions.find((a) => a.id === pick) ?? actions[0];
  return (
    <div style={{ ...box, marginTop: Spacings.Size16 }}>
      <Flex justifyContent="space-between" alignItems="flex-end" flexWrap="wrap" gap={12}>
        <div>
          <Heading level={3} style={{ margin: 0 }}>
            Remediation actions
          </Heading>
          <Text style={{ opacity: 0.8 }}>
            {missing.length} classic {plural(missing.length, "SLO")} without an SLO of the same name; {auto} can be converted automatically.
          </Text>
        </div>
        <Field label="Action">
          <Select value={active.id} onChange={(v: string | null) => v && setPick(v)}>
            <Select.Content>
              {actions.map((a) => (
                <Select.Option key={a.id} value={a.id}>
                  {a.kind === "api" ? "API · " : "Manual · "}
                  {a.label}
                </Select.Option>
              ))}
            </Select.Content>
          </Select>
        </Field>
      </Flex>
      <div style={{ marginTop: Spacings.Size12 }} key={active.id}>
        {active.node}
      </div>
      <Flex gap={12} flexWrap="wrap" alignItems="center" style={{ marginTop: Spacings.Size16 }}>
        <Text style={hint}>Documentation for this fix:</Text>
        <Links docs={active.docs} />
      </Flex>
    </div>
  );
}

// --- Tab ----------------------------------------------------------------------------
export function SlosTab() {
  const data = useSloData();
  const rows = useMemo(() => data.rows ?? [], [data.rows]);
  const upgraded = rows.filter((r) => r.match).length;
  const managed = rows.filter((r) => r.managed).length;
  const enabled = rows.filter((r) => r.enabled).length;
  const newTotal = data.slos?.length ?? 0;
  const namedAfterClassic = useMemo(() => {
    const names = new Set(rows.map((r) => r.name));
    return (data.slos ?? []).filter((s) => names.has(s.name)).length;
  }, [rows, data.slos]);
  const autoMissing = rows.filter((r) => !r.match && recipeLabel(r.metricExpression)).length;
  const { panel: aiPanel } = useAIInsights(
    useCallback(
      () =>
        analyzeSlos(
          rows.map((r) => ({ name: r.name, upgraded: !!r.match, managed: r.managed, convertible: !!recipeLabel(r.metricExpression), enabled: r.enabled })),
          newTotal,
        ),
      [rows, newTotal],
    ),
  );
  return (
    <Flex flexDirection="column" gap={16}>
      {aiPanel}
      <Heading level={3}>Service-level objectives</Heading>
      <Text>
        Service-Level Objectives (on Grail) replace Service-Level Objectives Classic: the SLI is one DQL query instead of a metric expression and an entity
        selector, and segments replace management zones. A classic SLO counts as upgraded when an SLO with the same name exists.
      </Text>
      {data.error ? (
        <MessageContainer variant="critical">
          <MessageContainer.Title>Could not read SLOs</MessageContainer.Title>
          <MessageContainer.Description>{data.error}</MessageContainer.Description>
        </MessageContainer>
      ) : !data.rows ? (
        <Text>Loading…</Text>
      ) : (
        <>
          <Flex gap={16} flexWrap="wrap" alignItems="stretch">
            <ScoreTile title="Classic SLOs" value={String(rows.length)} subtitle={`${enabled} enabled, ${rows.length - enabled} disabled`} />
            <ScoreTile title="SLOs" value={String(newTotal)} subtitle={`${namedAfterClassic} named after a classic SLO`} />
            <div style={card}>
              <PctGauge pct={pct(upgraded, rows.length)} caption="Classic SLOs upgraded" detail={`${upgraded} of ${rows.length}`} />
            </div>
            <ScoreTile title="Auto-convertible" value={String(autoMissing)} subtitle={`of ${rows.length - upgraded} not upgraded yet`} />
            <ScoreTile title="Created by this app" value={String(managed)} subtitle="updatable from the remediation section" />
          </Flex>
          <SloSearch rows={rows} />
          <SloActions rows={rows} reload={data.reload} />
        </>
      )}
    </Flex>
  );
}
