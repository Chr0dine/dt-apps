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
import { analyzeProblemNotifications } from "../analyses";
import { GAUGE_SIZE, PctGauge, QueryActions, ScoreTile, ShowEntitiesButton, num, pct } from "../components";
import { Field, Links, ManualActionView, Request } from "../RemediationPanel";
import { useDql } from "../useDql";
import { PROBLEM_DAYS, profileProblemsQuery } from "../queries";
import { Donut, type Slice } from "./ModePie";
import { AppCredentialsCard } from "./AppCredentials";
import { profileStatus, type DelayTiming, type Note } from "../alertingProfiles";
import {
  NOTIFICATION_TYPES,
  PN_DOCS,
  convertible,
  createWorkflows,
  eventNames,
  listNotifications,
  listWorkflows,
  manualMigrationAction,
  matchNotifications,
  notificationLink,
  planMigrations,
  previewTrigger,
  readWorkflowTokenStatus,
  typeLabel,
  workflowLink,
  type MigrationResult,
  type NotificationRow,
  type PlanResult,
  type TriggerSource,
  type Preview,
  type WorkflowPlan,
  type WorkflowTokenStatus,
} from "../problemNotifications";

// ---------------------------------------------------------------------------
// Problem notifications tab: classic problem notifications (Settings `builtin:problem.notifications` + alerting
// profiles) vs workflows. A notification counts as migrated when a workflow with the same name exists. Same layout as
// the SLOs tab; the conversion follows the "Classic Problems to WFs" migration workflow (problemNotifications.ts).
// ---------------------------------------------------------------------------

type PnData = { rows: NotificationRow[] | null; workflows: number; error: string | null; reload: () => void };

function usePnData(): PnData {
  const [rows, setRows] = useState<NotificationRow[] | null>(null);
  const [workflows, setWorkflows] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([listNotifications(), listWorkflows()])
      .then(([n, w]) => {
        if (cancelled) return;
        setRows(matchNotifications(n, w));
        setWorkflows(w.length);
      })
      .catch((e) => !cancelled && setError((e as any)?.message ?? String(e)));
    return () => {
      cancelled = true;
    };
  }, [tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { rows, workflows, error, reload };
}

/** Problems per alerting profile name over the last PROBLEM_DAYS days (null while loading or on error). */
function useProfileProblems(): { counts: Map<string, number> | null; error: string | null } {
  const state = useDql(profileProblemsQuery);
  const counts = useMemo(() => (state.data ? new Map(state.data.records.map((r) => [String(r.profile), num(r.problems)])) : null), [state.data]);
  return { counts, error: state.error };
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
const SKIP = "#8D8D8D";
const TYPE_COLORS = ["#4589FF", "#A56EFF", "#2DB7A3", "#FF832B", "#EE5396", "#D2A106", "#33B1FF", "#6FDC8C", "#FA4D56", "#B28600", "#8D8D8D"];
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
const statusLine = (color: string): React.CSSProperties => ({ padding: "8px 12px", borderRadius: 6, borderLeft: `4px solid ${color}`, background: "rgba(128,128,128,0.06)" });
const problemsFor = (counts: Map<string, number> | null, profile: string | null) => (counts === null ? null : profile ? counts.get(profile) ?? 0 : 0);
const mono: React.CSSProperties = { margin: "4px 0", padding: 8, borderRadius: 6, background: "rgba(128,128,128,0.12)", fontSize: 12, overflowX: "auto", whiteSpace: "pre-wrap" };
const badge = (color: string): React.CSSProperties => ({ fontSize: 10, fontWeight: 700, color, border: `1px solid ${color}`, borderRadius: 4, padding: "0 4px", marginRight: 6 });

/** Alerting profile translation notes, Gen 2 concepts first with a badge. */
function ProfileNotes({ notes }: { notes: Note[] }) {
  if (!notes.length) return null;
  const sorted = [...notes].sort((a, b) => Number(!!b.gen2) - Number(!!a.gen2));
  return (
    <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
      {sorted.map((n) => (
        <li key={n.text}>
          <Text style={hint}>
            {n.gen2 && <span style={badge(WARN)}>Gen 2</span>}
            {n.approximate && !n.gen2 && <span style={badge(SKIP)}>≈</span>}
            {n.text}
          </Text>
        </li>
      ))}
    </ul>
  );
}

function ExtLink({ href, children }: { href?: string; children: React.ReactNode }) {
  return href ? (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ) : (
    <>{children}</>
  );
}

/** Types present in the tenant, in NOTIFICATION_TYPES order (unknown ones last). */
function typesIn(rows: NotificationRow[]): string[] {
  const present = new Set(rows.map((r) => r.type));
  return [...NOTIFICATION_TYPES.map((t) => t.value).filter((t) => present.has(t)), ...Array.from(present).filter((t) => !NOTIFICATION_TYPES.some((x) => x.value === t))];
}

function TypeSelect({ rows, value, onChange }: { rows: NotificationRow[]; value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Notification type">
      <Select value={value} onChange={(v: string | null) => v && onChange(v)}>
        <Select.Content>
          <Select.Option value="any">Any</Select.Option>
          {typesIn(rows).map((t) => (
            <Select.Option key={t} value={t}>
              {typeLabel(t)}
            </Select.Option>
          ))}
        </Select.Content>
      </Select>
    </Field>
  );
}

// --- Search table ----------------------------------------------------------------
type Status = "any" | "missing" | "migrated";
type Conv = "any" | "auto" | "manual";
type Term = { name: string; type: string; conv: Conv; status: Status };
type TableRow = { id: string; name: string; type: string; enabled: string; profile: string; rules: string; gen2: string[]; problems: number | null; conversion: string; reason?: string; workflow: string; workflowId?: string };

function NotificationSearch({ rows, counts, pickedType }: { rows: NotificationRow[]; counts: Map<string, number> | null; pickedType: { type: string; n: number } }) {
  const [nameInput, setNameInput] = useState("");
  const [type, setType] = useState("any");
  const [conv, setConv] = useState<Conv>("any");
  const [status, setStatus] = useState<Status>("any");
  const [term, setTerm] = useState<Term | null>(null);
  // A click on the type donut sets the type filter and runs the search.
  useEffect(() => {
    if (pickedType.n === 0) return;
    setType(pickedType.type);
    setTerm((t) => ({ name: t?.name ?? "", conv: t?.conv ?? "any", status: t?.status ?? "any", type: pickedType.type }));
  }, [pickedType]);
  const data = useMemo<TableRow[]>(
    () =>
      term === null
        ? []
        : rows
            .filter((r) => r.name.toLowerCase().includes(term.name.toLowerCase()))
            .filter((r) => term.type === "any" || r.type === term.type)
            .filter((r) => (term.conv === "auto" ? convertible(r) : term.conv === "manual" ? !r.conversion.auto : true))
            .filter((r) => (term.status === "missing" ? !r.workflow : term.status === "migrated" ? !!r.workflow : true))
            .map((r) => ({
              id: r.id,
              name: r.name,
              type: typeLabel(r.type),
              enabled: r.enabled ? "Yes" : "No",
              profile: r.profileName ?? "(not found)",
              rules: profileStatus(r.profile).label,
              gen2: profileStatus(r.profile).gen2,
              problems: problemsFor(counts, r.profileName),
              conversion: r.conversion.auto ? `Auto · ${r.conversion.label}` : "Manual",
              reason: !r.conversion.auto ? r.conversion.reason : !r.enabled ? "Disabled: the migration skips it." : !r.profileName ? "Alerting profile not found." : undefined,
              workflow: r.managed ? "Yes (created by the migration)" : r.workflow ? "Yes" : "No",
              workflowId: r.workflow?.id,
            })),
    [rows, term, counts],
  );
  const columns = useMemo(
    () =>
      [
        { id: "name", header: "Classic notification", accessor: "name", cell: ({ rowData }: { rowData: TableRow }) => <ExtLink href={notificationLink(rowData.id)}>{rowData.name}</ExtLink> },
        { id: "type", header: "Type", accessor: "type" },
        { id: "enabled", header: "Enabled", accessor: "enabled" },
        { id: "profile", header: "Alerting profile", accessor: "profile" },
        {
          id: "rules",
          header: "Profile rules",
          accessor: "rules",
          cell: ({ rowData }: { rowData: TableRow }) => (
            <>
              {rowData.rules}
              {rowData.gen2.length > 0 && (
                <span style={{ ...hint, display: "block", color: WARN }}>
                  <span style={badge(WARN)}>Gen 2</span>
                  {rowData.gen2.join(", ")}
                </span>
              )}
            </>
          ),
        },
        { id: "problems", header: `Problems (${PROBLEM_DAYS} days)`, accessor: "problems", cell: ({ rowData }: { rowData: TableRow }) => <>{rowData.problems === null ? "…" : rowData.problems.toLocaleString()}</> },
        {
          id: "conversion",
          header: "Conversion",
          accessor: "conversion",
          cell: ({ rowData }: { rowData: TableRow }) => (
            <>
              {rowData.conversion}
              {rowData.reason && <span style={{ ...hint, display: "block" }}>{rowData.reason}</span>}
            </>
          ),
        },
        {
          id: "workflow",
          header: "Workflow with the same name",
          accessor: "workflow",
          cell: ({ rowData }: { rowData: TableRow }) => (
            <>
              {rowData.workflow}
              {rowData.workflowId && workflowLink(rowData.workflowId) && (
                <>
                  {" · "}
                  <ExtLink href={workflowLink(rowData.workflowId)}>Open workflow ↗</ExtLink>
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
        <Heading level={4}>Search classic problem notifications</Heading>
        <Flex gap={16} alignItems="flex-end" flexWrap="wrap" style={{ marginTop: Spacings.Size8 }}>
          <Field label="Name contains">
            <TextInput value={nameInput} placeholder="e.g. slack (leave empty for all)" onChange={(v: string) => setNameInput(v)} />
          </Field>
          <TypeSelect rows={rows} value={type} onChange={setType} />
          <Field label="Conversion">
            <Select value={conv} onChange={(v: Conv | null) => v && setConv(v)}>
              <Select.Content>
                <Select.Option value="any">Any</Select.Option>
                <Select.Option value="auto">Auto-convertible</Select.Option>
                <Select.Option value="manual">Manual</Select.Option>
              </Select.Content>
            </Select>
          </Field>
          <Field label="Migration status">
            <Select value={status} onChange={(v: Status | null) => v && setStatus(v)}>
              <Select.Content>
                <Select.Option value="any">Any</Select.Option>
                <Select.Option value="missing">Not migrated</Select.Option>
                <Select.Option value="migrated">Migrated</Select.Option>
              </Select.Content>
            </Select>
          </Field>
          <ShowEntitiesButton onClick={() => setTerm({ name: nameInput.trim(), type, conv, status })}>Search notifications</ShowEntitiesButton>
        </Flex>
      </div>
      {term !== null && (
        <>
          <DataTable data={data} columns={columns} sortable fullWidth variant={{ rowDensity: "condensed" }}>
            <DataTable.EmptyState>{rows.length ? "No classic problem notifications match this search." : "No classic problem notifications are defined in this environment."}</DataTable.EmptyState>
          </DataTable>
          <QueryActions title={`Problems per alerting profile (${PROBLEM_DAYS} days)`} query={profileProblemsQuery} />
        </>
      )}
    </>
  );
}

// --- Migration form ------------------------------------------------------------------
type Scope = "missing" | "all";
type Checked = { plans: { row: NotificationRow; result: PlanResult }[]; previews: Map<string, Preview> };

/** Runs fn over items, `limit` at a time. */
async function inBatches<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) out.push(...(await Promise.all(items.slice(i, i + limit).map(fn))));
  return out;
}

const requestText = (p: WorkflowPlan) => `// POST /platform/automation/v1/workflows\n${JSON.stringify(p.body, null, 2)}`;

function MigrateForm({ rows, reload }: { rows: NotificationRow[]; reload: () => void }) {
  const [scope, setScope] = useState<Scope>("missing");
  const [type, setType] = useState("any");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [checked, setChecked] = useState<Checked | null>(null);
  const [skipQuiet, setSkipQuiet] = useState(false);
  const [source, setSource] = useState<TriggerSource>("rules");
  const [timing, setTiming] = useState<DelayTiming>("configured");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<MigrationResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<WorkflowTokenStatus | null>(null);
  const [tokenTick, setTokenTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setToken(null);
    void readWorkflowTokenStatus().then((s) => !cancelled && setToken(s));
    return () => {
      cancelled = true;
    };
  }, [tokenTick]);

  const candidates = useMemo(
    () =>
      rows
        .filter((r) => scope === "all" || !r.workflow)
        .filter((r) => type === "any" || r.type === type)
        .filter((r) => !search || r.name.toLowerCase().includes(search.toLowerCase())),
    [rows, scope, type, search],
  );
  const chosen = candidates.filter((r) => selected[r.id]);
  const autoIds = candidates.filter(convertible).map((r) => r.id);

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
      // Event names for predefined event filters first: the translation needs them.
      const plans = planMigrations(chosen, source, await eventNames(chosen), timing);
      const runnable = plans.flatMap((p) => (p.result.plan ? [p.result.plan] : []));
      const previews = new Map(await inBatches(runnable, 4, async (p) => [p.row.id, await previewTrigger(p)] as const));
      setChecked({ plans, previews });
    } catch (e) {
      setError((e as any)?.message ?? String(e));
    }
    setBusy(false);
  };

  const toRun = useMemo<WorkflowPlan[]>(
    () =>
      (checked?.plans ?? []).flatMap((p) => {
        const plan = p.result.plan;
        if (!plan) return [];
        const pv = checked?.previews.get(plan.row.id);
        // A filter that fails as DQL would make a trigger that never fires, so it is always skipped.
        if (!pv?.ok || (skipQuiet && pv.problems === 0)) return [];
        return [plan];
      }),
    [checked, skipQuiet],
  );

  const run = async () => {
    setBusy(true);
    setProgress(0);
    setResults(await createWorkflows(toRun, setProgress));
    setConfirm(false);
    setBusy(false);
    reload();
  };

  return (
    <Flex flexDirection="column" gap={12}>
      <Text>
        Creates one simple workflow per selected notification, named after it, with a Davis problem trigger (all categories, after root cause analysis) filtered
        on the notification&apos;s alerting profile, and one task: Email, Slack message, ServiceNow incident, or HTTP request for custom webhooks. The trigger
        filter is the profile&apos;s rules translated to DQL on problem fields (severity, delay, tags, event filters); profiles that cannot be translated
        (management zone, regular expression) use the deprecated alerting profile label. Only enabled notifications are converted. Classic notifications are not
        changed or deleted.
      </Text>
      <Flex gap={16} flexWrap="wrap" alignItems="flex-end">
        <Field label="Classic notifications">
          <Select value={scope} onChange={(v: Scope | null) => { if (v) { setScope(v); setSelected({}); reset(); } }}>
            <Select.Content>
              <Select.Option value="missing">Not migrated</Select.Option>
              <Select.Option value="all">All</Select.Option>
            </Select.Content>
          </Select>
        </Field>
        <TypeSelect rows={rows} value={type} onChange={(v) => { setType(v); setSelected({}); reset(); }} />
        <Field label="Name contains">
          <TextInput value={search} placeholder="e.g. slack" onChange={(v: string) => setSearch(v)} />
        </Field>
        <Field label="Trigger filter">
          <Select value={source} onChange={(v: TriggerSource | null) => { if (v) { setSource(v); reset(); } }}>
            <Select.Content>
              <Select.Option value="rules">Alerting profile rules as DQL</Select.Option>
              <Select.Option value="label">Alerting profile label (deprecated)</Select.Option>
            </Select.Content>
          </Select>
        </Field>
        {source === "rules" && (
          <Field label="Delay timing">
            <Select value={timing} onChange={(v: DelayTiming | null) => { if (v) { setTiming(v); reset(); } }}>
              <Select.Content>
                <Select.Option value="configured">As configured (never misses a classic notification)</Select.Option>
                <Select.Option value="later">One step later (closer to classic timing)</Select.Option>
              </Select.Content>
            </Select>
          </Field>
        )}
      </Flex>
      {source === "rules" && (
        <Text style={hint}>
          Delays become duration steps (5, 10, 15, 30 min, 1, 2, 4, 24 h, 7 d) counted from the problem start; classic counted from a few minutes later. As
          configured, problems that close just after the delay are notified too. One step later (15 min becomes 30 min) is closer to classic but misses some
          problems it notified. Validate shows the difference for each profile.
        </Text>
      )}
      {candidates.length === 0 ? (
        <Text>{scope === "missing" && type === "any" && !search ? "Every classic problem notification already has a workflow with the same name." : "No classic problem notifications match."}</Text>
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
            {candidates.map((r) => (
              <Checkbox key={r.id} value={!!selected[r.id]} onChange={(v: boolean) => { setSelected((s) => ({ ...s, [r.id]: v })); reset(); }}>
                {r.name}
                <span style={{ ...hint, marginLeft: 8 }}>
                  {typeLabel(r.type)} · {r.conversion.auto ? r.conversion.label : "manual upgrade"}
                  {r.enabled ? "" : " · disabled"}
                  {r.managed ? " · migrated" : r.workflow ? " · workflow exists, not created by the migration" : ""}
                </span>
              </Checkbox>
            ))}
          </Flex>
          <div>
            <Button variant="default" disabled={busy || chosen.length === 0} onClick={() => void validate()}>
              {busy && !checked ? "Validating…" : `Validate (${chosen.length})`}
            </Button>
          </div>
          <Text style={hint}>
            Validate translates each alerting profile, then runs the translated rules and the alerting profile label side by side over the last {PROBLEM_DAYS} days of
            problem updates (4 queries at a time), so you see which problems each would have notified. Nothing is written.
          </Text>
        </>
      )}
      {error && <Text style={{ color: BAD }}>{error}</Text>}
      {checked && (
        <>
          <Flex flexDirection="column" gap={8}>
            {checked.plans.map(({ row, result }) => {
              const plan = result.plan;
              const pv = plan ? checked.previews.get(row.id) : undefined;
              const missed = !!pv?.compared && plan?.source === "rules" && pv.onlyLabel > 0;
              const gen2 = !!plan?.profileNotes.some((n) => n.gen2);
              const color = !plan ? ("manual" in result && result.manual ? WARN : SKIP) : !pv?.ok ? BAD : pv.problems === 0 || missed || gen2 ? WARN : OK;
              return (
                <div key={row.id} style={statusLine(color)}>
                  <Text style={{ display: "block", fontWeight: 600 }}>
                    {row.name} — {plan ? "create" : "skipped"}
                  </Text>
                  {!plan && <Text style={{ display: "block", ...hint, color }}>{result.problem}</Text>}
                  {plan && (
                    <>
                      <Text style={{ display: "block", ...hint }}>
                        {plan.action} · alerting profile {row.profileName} · trigger filter: {plan.source === "rules" ? "profile rules as DQL" : "alerting profile label"}
                      </Text>
                      {pv && (
                        <Text style={{ display: "block", ...hint, color: !pv.ok ? BAD : pv.problems === 0 ? WARN : undefined }}>
                          {pv.message}
                          {pv.ok && pv.problems === 0 ? " Consider deleting the classic notification instead of migrating it." : ""}
                        </Text>
                      )}
                      {pv?.compared && pv.onlyLabel > 0 && (
                        <Text style={{ display: "block", ...hint, color: plan.source === "rules" ? WARN : undefined }}>
                          {pv.onlyLabel} {plural(pv.onlyLabel, "problem")} carried the label but {plural(pv.onlyLabel, "does", "do")} not match the rules
                          {pv.onlyLabelExamples.length ? ` (e.g. ${pv.onlyLabelExamples.join("; ")})` : ""}.
                        </Text>
                      )}
                      {pv?.compared && pv.onlyRules > 0 && (
                        <Text style={{ display: "block", ...hint }}>
                          {pv.onlyRules} {plural(pv.onlyRules, "problem")} {plural(pv.onlyRules, "matches", "match")} the rules but never carried the label
                          {pv.onlyRulesExamples.length ? ` (e.g. ${pv.onlyRulesExamples.join("; ")})` : ""}. With a delay these are usually problems that closed shortly after
                          it.
                        </Text>
                      )}
                      <pre style={mono}>{plan.customFilter ? `Custom filter: ${plan.customFilter}` : "Custom filter: none (every problem)"}</pre>
                      <ProfileNotes notes={plan.profileNotes} />
                      {plan.notes.length > 0 && (
                        <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
                          {plan.notes.map((n) => (
                            <li key={n}>
                              <Text style={hint}>{n}</Text>
                            </li>
                          ))}
                        </ul>
                      )}
                      <QueryActions title={`Profile rules vs label: ${row.name}`} query={plan.query} />
                      <div style={{ marginTop: 6 }}>
                        <Request label="Workflow request" text={requestText(plan)} />
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </Flex>
          <Checkbox value={skipQuiet} onChange={(v: boolean) => { setSkipQuiet(v); setConfirm(false); }}>
            Skip notifications whose trigger matched no problem in the last {PROBLEM_DAYS} days
          </Checkbox>
          {toRun.length > 0 ? (
            <>
              <AppCredentialsCard use="workflows" onChanged={() => setTokenTick((t) => t + 1)} />
              <Checkbox value={confirm} onChange={(v: boolean) => setConfirm(v)}>
                Create {toRun.length} {plural(toRun.length, "workflow")} (1 API call each, with the platform token). They are active right away, so matching problems
                notify through the classic notification and the workflow until you disable the classic one.
              </Checkbox>
              <Flex gap={8} alignItems="center">
                <Button variant="emphasized" disabled={busy || !confirm || token?.state !== "ok"} onClick={() => void run()}>
                  Create workflows
                </Button>
                {busy && <Text style={hint}>{progress} of {toRun.length} done…</Text>}
              </Flex>
            </>
          ) : (
            <Text>Nothing to create: every selected notification was skipped.</Text>
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
              {r.id && workflowLink(r.id) && (
                <a href={workflowLink(r.id)} target="_blank" rel="noreferrer noopener" style={{ fontSize: 12, display: "block" }}>
                  Open workflow ↗
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
function NotificationActions({ rows, reload }: { rows: NotificationRow[]; reload: () => void }) {
  const missing = rows.filter((r) => r.enabled && !r.workflow);
  const auto = missing.filter(convertible).length;
  const actions = [
    { id: "migrate", label: "Convert classic problem notifications to simple workflows", kind: "api" as const, node: <MigrateForm rows={rows} reload={reload} />, docs: PN_DOCS },
    { id: manualMigrationAction.id, label: manualMigrationAction.title, kind: "manual" as const, node: <ManualActionView action={manualMigrationAction} />, docs: manualMigrationAction.docs },
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
            {missing.length} enabled {plural(missing.length, "notification")} without a workflow of the same name; {auto} can be converted automatically.
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
export function ProblemNotificationsTab() {
  const data = usePnData();
  const { counts, error: countError } = useProfileProblems();
  const rows = useMemo(() => data.rows ?? [], [data.rows]);
  const enabled = rows.filter((r) => r.enabled);
  const migrated = enabled.filter((r) => r.workflow).length;
  const managed = rows.filter((r) => r.managed).length;
  const autoMissing = rows.filter(convertible).length;
  const named = rows.filter((r) => r.workflow).length;
  const gen2 = enabled.filter((r) => profileStatus(r.profile).gen2.length > 0).length;
  const labelOnly = enabled.filter((r) => r.profile && !profileStatus(r.profile).translatable).length;
  const [pickedType, setPickedType] = useState<{ type: string; n: number }>({ type: "any", n: 0 });
  const slices = useMemo<Slice[]>(
    () =>
      typesIn(rows).map((t, i) => ({ label: typeLabel(t), value: rows.filter((r) => r.type === t).length, color: TYPE_COLORS[i % TYPE_COLORS.length], id: t })),
    [rows],
  );
  const { panel: aiPanel } = useAIInsights(
    useCallback(
      () =>
        analyzeProblemNotifications(
          rows.map((r) => ({
            name: r.name,
            type: typeLabel(r.type),
            enabled: r.enabled,
            migrated: !!r.workflow,
            managed: r.managed,
            convertible: convertible(r),
            problems: problemsFor(counts, r.profileName),
            gen2: profileStatus(r.profile).gen2,
            translatable: profileStatus(r.profile).translatable,
          })),
        ),
      [rows, counts],
    ),
  );
  return (
    <Flex flexDirection="column" gap={16}>
      {aiPanel}
      <Heading level={3}>Problem notifications</Heading>
      <Text>
        Simple workflows with a Davis problem trigger replace classic problem notifications and their alerting profiles: the trigger filters the problems and
        the task sends the notification. A classic notification counts as migrated when a workflow with the same name exists. The conversion follows the
        Classic Problems to WFs migration workflow.
      </Text>
      {data.error ? (
        <MessageContainer variant="critical">
          <MessageContainer.Title>Could not read problem notifications or workflows</MessageContainer.Title>
          <MessageContainer.Description>{data.error}</MessageContainer.Description>
        </MessageContainer>
      ) : !data.rows ? (
        <Text>Loading…</Text>
      ) : (
        <>
          <Flex gap={16} flexWrap="wrap" alignItems="stretch">
            <ScoreTile title="Classic problem notifications" value={String(rows.length)} subtitle={`${enabled.length} enabled, ${rows.length - enabled.length} disabled`} />
            <ScoreTile title="Workflows" value={String(data.workflows)} subtitle={`${named} named after a classic notification`} />
            <div style={card}>
              <PctGauge pct={pct(migrated, enabled.length)} caption="Enabled notifications migrated" detail={`${migrated} of ${enabled.length}`} />
            </div>
            <ScoreTile title="Auto-convertible" value={String(autoMissing)} subtitle={`of ${enabled.length - migrated} enabled, not migrated yet`} />
            <ScoreTile title="Created by the migration" value={String(managed)} subtitle="workflows with the migration description" />
            <ScoreTile title="Gen 2 alerting rules" value={String(gen2)} subtitle={`enabled notifications whose profile uses classic tags, zones or event types; ${labelOnly} label only`} />
            {slices.length > 0 && (
              <div style={card}>
                <div>
                  <Heading level={4}>Notifications by type</Heading>
                  <div style={{ marginTop: Spacings.Size8 }}>
                    <Donut
                      slices={slices}
                      size={GAUGE_SIZE}
                      centerLabel="Notifications"
                      ariaLabel="Classic problem notifications by type"
                      selectedId={pickedType.n ? pickedType.type : null}
                      onSelect={(id) => setPickedType((p) => ({ type: id ?? "any", n: p.n + 1 }))}
                    />
                  </div>
                  <Text style={hint}>Select a type to list its notifications below.</Text>
                </div>
              </div>
            )}
          </Flex>
          {countError && <Text style={{ ...hint, color: WARN }}>Problem counts unavailable: {countError}</Text>}
          <NotificationSearch rows={rows} counts={counts} pickedType={pickedType} />
          <NotificationActions rows={rows} reload={data.reload} />
        </>
      )}
    </Flex>
  );
}
