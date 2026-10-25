import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { MessageContainer } from "@dynatrace/strato-components/content";
import { Checkbox, Select, TextInput } from "@dynatrace/strato-components/forms";
import { useCurrentTheme } from "@dynatrace/strato-components/core";
import Colors from "@dynatrace/strato-design-tokens/colors";
import Spacings from "@dynatrace/strato-design-tokens/spacings";
import Borders from "@dynatrace/strato-design-tokens/borders";
import { useDql } from "../useDql";
import { useAIInsights } from "../AIInsights";
import { analyzeSdv2 } from "../analyses";
import { PctGauge, QueryActions, QueryState, ScoreTile, formatMode, pct } from "../components";
import { Field, Links, ManualActionView, Request, ResultLine } from "../RemediationPanel";
import { DOCS_REVIEWED, OUTBOUND_SCHEMA, changedDocs, retryDocsFreshness, reviewedDate, sectionChanges, useDocsFreshness, type DocChange } from "../deepDocs";
import { DOC_SECTIONS } from "../deepTech";
import { settingsLink } from "../deepMonitoring";
import { entityOverviewLink, hostGroupLink } from "../links";
import { categoryColor, type Category, type Theme } from "../kubernetes";
import { sdv2ServicesQuery, SDV2_SERVICE_LIMIT, type Timeframe } from "../queries";
import type { DocLink, ManualAction, SubmitResult } from "../remediation";
import { Donut, type Slice } from "./ModePie";
import {
  ALL_SDV2_DOCS,
  CONTEXTS,
  CONTEXT_LABEL,
  DEFAULT_FAAS_CONDITION,
  DETECTION_SCHEMA,
  ENDPOINT_SCHEMA,
  FAILURE_SCHEMA,
  SCOPE_VERDICT_LABEL,
  SDV2_DOCS,
  SDV2_SCHEMA,
  SPLITTING_SCHEMA,
  URL_PATTERN_SCHEMA,
  VERDICTS,
  applyChanges,
  applyRuleFixes,
  checkChanges,
  checkFixValue,
  customRuleCount,
  describeObject,
  detectionRuleAction,
  effectiveSwitch,
  faasChanges,
  genericChanges,
  hostGroupCondition,
  k8sChanges,
  processGroupCondition,
  readSdv2Settings,
  requestText,
  ruleChecks,
  scopeLabel,
  scopeRows,
  serviceNameAction,
  toService,
  updateReferencesAction,
  urlPatternAction,
  verdictOf,
  type Ref,
  type RuleCheck,
  type ScopeRow,
  type Sdv2Change,
  type Sdv2Settings,
  type ServiceRow,
} from "../sdv2";

// ---------------------------------------------------------------------------
// Service Detection v2 tab: SDv1 vs SDv2 per service (Smartscape, one query), the SDv2 for OneAgent switches and the
// built-in rules (Settings API, one paged GET), which scopes to switch next, and the fixes: switch SDv2 on for
// Kubernetes / Lambda / generic workloads, apply the recommended built-in rules, and doc-backed manual steps. SDv2
// changes often, so the cited pages and the whole SDv2 docs section run through the docs-freshness check.
// ---------------------------------------------------------------------------

const box: React.CSSProperties = { padding: Spacings.Size16, borderRadius: Borders.Radius.Container.Default, background: Colors.Background.Container.Neutral.Default };
const card: React.CSSProperties = { ...box, display: "flex", alignItems: "center", justifyContent: "center" };
const hint: React.CSSProperties = { fontSize: 12, opacity: 0.7 };
const scrollBox = (maxHeight: number): React.CSSProperties => ({ maxHeight, overflowY: "auto", padding: 8, borderRadius: 6, border: "1px solid rgba(128,128,128,0.3)" });
const linkStyle: React.CSSProperties = { color: "inherit", textDecoration: "underline", textUnderlineOffset: 2 };
const OK = "#0D9C29";
const WARN = "#E87A00";
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const statusLine = (color: string): React.CSSProperties => ({ padding: "8px 12px", borderRadius: 6, borderLeft: `4px solid ${color}`, background: "rgba(128,128,128,0.06)" });
/** "a, b, c +4 more": long process-group lists stay readable in table cells. */
const shortList = (xs: string[], max = 3) => (xs.length > max ? `${xs.slice(0, max).join(", ")} +${xs.length - max} more` : xs.join(", "));
const SDV2_PREFIX = DOC_SECTIONS.find((s) => s.title === "Service Detection v2")?.prefix ?? "";

function ExtLink({ href, children }: { href?: string; children: React.ReactNode }) {
  return href ? (
    <a href={href} target="_blank" rel="noreferrer noopener" style={linkStyle}>
      {children}
    </a>
  ) : (
    <>{children}</>
  );
}

function Dot({ c, theme }: { c: Category; theme: Theme }) {
  return <span style={{ width: 10, height: 10, borderRadius: 2, background: categoryColor(c, theme), display: "inline-block", marginRight: 6, flex: "none" }} />;
}

// --- Data ----------------------------------------------------------------------------

type SettingsState = { settings: Sdv2Settings | null; error: string | null; reload: () => void };

function useSdv2Settings(): SettingsState {
  const [settings, setSettings] = useState<Sdv2Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    readSdv2Settings()
      .then((s) => !cancelled && setSettings(s))
      .catch((e) => !cancelled && setError((e as any)?.message ?? String(e)));
    return () => {
      cancelled = true;
    };
  }, [tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { settings, error, reload };
}

/** Display names of the scopes a setting can target (from the services' edges). */
function scopeNames(services: ServiceRow[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of services) {
    for (const n of s.namespaces) m.set(n.id, `${n.cluster} / ${n.name}`);
    for (const c of s.clusters) m.set(c.id, c.name);
    for (const h of s.hostGroups) if (h.id) m.set(h.id, h.name);
  }
  return m;
}

// --- Docs freshness ------------------------------------------------------------------

const changeText = (c: DocChange) => (c.kind === "missing" ? "moved or removed" : `updated ${c.date}`);

/** Above the actions: the cited pages behind this fix that changed since the review. */
function DocsChangedNote({ docs }: { docs: DocLink[] }) {
  const changed = changedDocs(useDocsFreshness(), docs);
  if (!changed.length) return null;
  return (
    <div style={statusLine(WARN)}>
      <Text style={{ ...hint, opacity: 1 }}>
        Dynatrace changed {changed.length === 1 ? "a page" : `${changed.length} pages`} behind this fix after this guidance was reviewed ({DOCS_REVIEWED}):{" "}
        {changed.map((c, i) => (
          <React.Fragment key={c.doc.url}>
            {i > 0 && ", "}
            <ExtLink href={c.doc.url}>{c.doc.title}</ExtLink> ({changeText(c.change)})
          </React.Fragment>
        ))}
        . Read {changed.length === 1 ? "it" : "them"} before acting; SDv2 is changing quickly.
      </Text>
    </div>
  );
}

/** Top of the tab: one line on the docs check, plus a banner when SDv2 pages changed or new ones were published. */
function DocsBanner() {
  const f = useDocsFreshness();
  const outbound = settingsLink(OUTBOUND_SCHEMA);
  const changed = changedDocs(f, ALL_SDV2_DOCS);
  const section = sectionChanges(f, SDV2_PREFIX);
  const extra = section.changed.filter((u) => !changed.some((c) => c.doc.url === u));
  const alert = changed.length + extra.length + section.newPages.length > 0;
  return (
    <Flex flexDirection="column" gap={8}>
      <Text style={{ ...hint, display: "block" }}>
        Guidance reviewed against the Dynatrace docs on {DOCS_REVIEWED}; the Service Detection v2 section is checked for changed and new pages on every load.{" "}
        {f.status === "loading" && "Checking the docs…"}
        {f.status === "ok" && !alert && "No SDv2 page has changed since."}
        {f.status === "blocked" && (
          <>
            Automatic docs check off: add docs.dynatrace.com to the allowed outbound connections
            {outbound && (
              <>
                {" "}
                (<ExtLink href={outbound}>setting ↗</ExtLink>)
              </>
            )}
            .
          </>
        )}
        {f.status === "error" && `Docs check failed: ${f.message}`}
        {(f.status === "error" || f.status === "blocked") && (
          <>
            {" "}
            <button type="button" onClick={retryDocsFreshness} style={{ background: "none", border: "none", padding: 0, color: "inherit", textDecoration: "underline", cursor: "pointer", fontSize: 12 }}>
              Retry
            </button>
          </>
        )}
      </Text>
      {alert && (
        <MessageContainer variant="warning">
          <MessageContainer.Title>The Service Detection v2 docs changed since this tab was reviewed</MessageContainer.Title>
          <MessageContainer.Description>
            <Flex flexDirection="column" gap={4}>
              {changed.map((c) => (
                <Text key={c.doc.url}>
                  <ExtLink href={c.doc.url}>{c.doc.title}</ExtLink> — {changeText(c.change)}
                </Text>
              ))}
              {extra.map((u) => (
                <Text key={u}>
                  <ExtLink href={u}>{u.replace(SDV2_PREFIX, "SDv2 docs")}</ExtLink> — updated
                </Text>
              ))}
              {section.newPages.map((p) => (
                <Text key={p.url}>
                  New page: <ExtLink href={p.url}>{p.url.replace(SDV2_PREFIX, "SDv2 docs")}</ExtLink> ({p.date})
                </Text>
              ))}
              <Text style={hint}>Checks, defaults and steps on this tab may be out of date until the guidance is reviewed (npm run check-docs).</Text>
            </Flex>
          </MessageContainer.Description>
        </MessageContainer>
      )}
    </Flex>
  );
}

type DocRow = { title: string; url: string; reviewed: string; live: string; status: string };

/** Every SDv2 page this tab relies on: reviewed vs live sitemap date, and pages published since the review. */
function DocsCard() {
  const f = useDocsFreshness();
  const rows = useMemo<DocRow[]>(() => {
    const live = f.status === "ok" ? f.live : new Map<string, string>();
    const cited: DocRow[] = ALL_SDV2_DOCS.map((d) => {
      const change = f.status === "ok" ? f.changes.get(d.url) : undefined;
      return {
        title: d.title,
        url: d.url,
        reviewed: reviewedDate(d.url) ?? "—",
        live: live.get(d.url) ?? (f.status === "ok" ? "not in sitemap" : "—"),
        status: f.status !== "ok" ? "not checked" : change ? (change.kind === "missing" ? "Moved or removed" : "Updated since review") : "Unchanged",
      };
    });
    const fresh: DocRow[] = sectionChanges(f, SDV2_PREFIX).newPages.map((p) => ({ title: p.url.replace(`${SDV2_PREFIX}/`, ""), url: p.url, reviewed: "—", live: p.date, status: "New page" }));
    return [...fresh, ...cited];
  }, [f]);
  const columns = useMemo(
    () =>
      [
        { id: "title", header: "Page", accessor: "title", cell: ({ rowData }: { rowData: DocRow }) => <ExtLink href={rowData.url}>{rowData.title}</ExtLink> },
        { id: "reviewed", header: "Reviewed version", accessor: "reviewed" },
        { id: "live", header: "Live (sitemap)", accessor: "live" },
        {
          id: "status",
          header: "Status",
          accessor: "status",
          cell: ({ rowData }: { rowData: DocRow }) => <span style={{ color: rowData.status === "Unchanged" ? undefined : rowData.status === "not checked" ? undefined : WARN, fontWeight: rowData.status === "Unchanged" ? undefined : 600 }}>{rowData.status}</span>,
        },
      ] as DataTableColumnDef<DocRow>[],
    [],
  );
  return (
    <div style={box}>
      <Heading level={4}>Service Detection v2 documentation</Heading>
      <Text style={{ ...hint, display: "block", marginBottom: 8 }}>
        Dates are the docs sitemap&apos;s last-modified dates. A page newer than the reviewed version, or a new page in the SDv2 section, means the feature changed:
        read it, update this tab (sdv2.ts) and record the review with npm run check-docs -- --accept.
      </Text>
      <DataTable data={rows} columns={columns} sortable resizable defaultLineWrap fullWidth variant={{ rowDensity: "condensed" }}>
        <DataTable.EmptyState>No pages.</DataTable.EmptyState>
      </DataTable>
    </div>
  );
}

// --- Scope recommendations -------------------------------------------------------------

const SCOPE_VERDICT_CAT: Record<string, Category> = {
  ENABLE: verdictOf("ENABLE"),
  PILOT: verdictOf("PILOT"),
  PILOT_SELECTED: verdictOf("REVIEW"),
  KEEP: verdictOf("KEEP"),
  DONE: verdictOf("SDV2"),
};
const KIND_LABEL: Record<string, string> = { NAMESPACE: "Kubernetes namespace", HOST_GROUP: "Host group", NO_HOST_GROUP: "Environment (no host group)", FAAS: "Environment (FaaS)" };

function settingText(r: ScopeRow, names: Map<string, string>): string {
  if (!r.setting.scope) return "Off (no SDv2 object)";
  const where = scopeLabel(r.setting.scope, names);
  if (!r.setting.enabled) return `Off (${where})`;
  return `On at ${where}${r.setting.condition ? ` where ${r.setting.condition}` : ""}`;
}

function ScopesCard({ rows, names, theme }: { rows: ScopeRow[]; names: Map<string, string>; theme: Theme }) {
  type T = ScopeRow & { settingText: string; verdictLabel: string; counts: string };
  const data = useMemo<T[]>(() => rows.map((r) => ({ ...r, settingText: settingText(r, names), verdictLabel: SCOPE_VERDICT_LABEL[r.verdict], counts: `${r.sdv1} SDv1 · ${r.sdv2} SDv2` })), [rows, names]);
  const columns = useMemo(
    () =>
      [
        {
          id: "label",
          header: "Scope",
          accessor: "label",
          cell: ({ rowData }: { rowData: T }) => (
            <Flex flexDirection="column" gap={0}>
              <span>
                {rowData.kind === "HOST_GROUP" ? <ExtLink href={hostGroupLink(rowData.scope)}>{rowData.label}</ExtLink> : rowData.label}
              </span>
              <span style={hint}>
                {KIND_LABEL[rowData.kind]} ·{" "}
                <ExtLink href={settingsLink(SDV2_SCHEMA, rowData.scope)}>SDv2 setting ↗</ExtLink>
              </span>
            </Flex>
          ),
        },
        { id: "counts", header: "Services now", accessor: "counts" },
        { id: "after", header: "SDv2 services after (est.)", accessor: "after", cell: ({ rowData }: { rowData: T }) => <>{rowData.sdv1 ? `~${rowData.after}` : "—"}</> },
        {
          id: "verdictLabel",
          header: "Recommendation",
          accessor: "verdictLabel",
          cell: ({ rowData }: { rowData: T }) => (
            <Flex flexDirection="column" gap={0}>
              <span style={{ display: "inline-flex", alignItems: "center" }}>
                <Dot c={SCOPE_VERDICT_CAT[rowData.verdict]} theme={theme} />
                {rowData.verdictLabel}
              </span>
              {rowData.kept.length > 0 && <span style={hint} title={rowData.kept.map((p) => p.name).join(", ")}>Keep on SDv1: {shortList(rowData.kept.map((p) => p.name))}</span>}
              {rowData.verdict === "PILOT_SELECTED" && rowData.candidates.length > 0 && <span style={hint} title={rowData.candidates.map((p) => p.name).join(", ")}>Pilot: {shortList(rowData.candidates.map((p) => p.name))}</span>}
            </Flex>
          ),
        },
        { id: "settingText", header: "SDv2 switch now", accessor: "settingText" },
        { id: "dependents", header: "Frontend / monitor references", accessor: "dependents" },
      ] as DataTableColumnDef<T>[],
    [theme],
  );
  return (
    <div style={box}>
      <Heading level={4}>Where to enable SDv2</Heading>
      <Text style={{ ...hint, display: "block", marginBottom: 8 }}>
        Kubernetes namespaces and AWS Lambda can switch now (generally available); host groups outside Kubernetes use the Early Access for generic workloads, scoped to
        the process groups that fit one service per process. The estimate counts workloads (Kubernetes) or process groups (generic): SDv2 makes one service per
        process instead of one per SDv1 service type. References from frontends and HTTP monitors point at today&apos;s SDv1 service IDs.
      </Text>
      <DataTable data={data} columns={columns} sortable resizable defaultLineWrap fullWidth variant={{ rowDensity: "condensed" }}>
        <DataTable.EmptyState>No services in Kubernetes, AWS Lambda or on hosts in this timeframe.</DataTable.EmptyState>
        <DataTable.Pagination defaultPageSize={15} pageSizeOptions={[15, 30, 60]} />
      </DataTable>
    </div>
  );
}

// --- Current settings -------------------------------------------------------------------

function CheckLine({ c }: { c: RuleCheck }) {
  return (
    <div style={statusLine(c.ok ? OK : WARN)}>
      <Text style={{ display: "block", fontWeight: 600 }}>
        {c.ok ? "✓ " : "! "}
        {c.title}
      </Text>
      <Text style={{ ...hint, display: "block" }}>
        {c.rule} is {c.want === c.ok ? "enabled" : "disabled"}
        {c.ok ? "" : ` — recommended: ${c.want ? "enabled" : "disabled"}`}. {c.why}{" "}
        <ExtLink href={settingsLink(c.schemaId)}>Open setting ↗</ExtLink>
      </Text>
    </div>
  );
}

function SettingsCard({ state, checks, names }: { state: SettingsState; checks: RuleCheck[]; names: Map<string, string> }) {
  const s = state.settings;
  if (state.error) {
    return (
      <MessageContainer variant="critical">
        <MessageContainer.Title>Could not read the SDv2 settings</MessageContainer.Title>
        <MessageContainer.Description>{state.error}</MessageContainer.Description>
      </MessageContainer>
    );
  }
  if (!s) return <Text>Loading SDv2 settings…</Text>;
  const objects = [...s.objects.values()].sort((a, b) => (a.scope === "environment" ? -1 : b.scope === "environment" ? 1 : a.scope.localeCompare(b.scope)));
  const pages = [
    { label: "Service Detection v2 for OneAgent", schema: SDV2_SCHEMA, count: `${objects.length} ${objects.length === 1 ? "scope" : "scopes"}` },
    { label: "Service detection", schema: DETECTION_SCHEMA, count: `${customRuleCount(s.detection)} custom rules` },
    { label: "Service splitting", schema: SPLITTING_SCHEMA, count: `${customRuleCount(s.splitting)} custom rules` },
    { label: "Endpoint detection", schema: ENDPOINT_SCHEMA, count: `${customRuleCount(s.endpoints)} custom rules` },
    { label: "URL path pattern matching", schema: URL_PATTERN_SCHEMA, count: `${s.urlPatterns.length} rules` },
    { label: "Failure detection", schema: FAILURE_SCHEMA, count: "" },
  ];
  return (
    <div style={box}>
      <Heading level={4}>Current SDv2 configuration</Heading>
      <Flex gap={24} flexWrap="wrap" alignItems="flex-start" style={{ marginTop: 8 }}>
        <Flex flexDirection="column" gap={6} style={{ flex: "1 1 380px", minWidth: 0 }}>
          <Text style={{ fontWeight: 600 }}>SDv2 for OneAgent switches</Text>
          {objects.length === 0 ? (
            <Text style={hint}>Not configured at any scope: OneAgent services use SDv1 (OpenTelemetry services always use SDv2).</Text>
          ) : (
            objects.map((o) => (
              <div key={o.objectId} style={statusLine(describeObject(o.value).some((l) => l.includes(": on")) ? OK : WARN)}>
                <Text style={{ display: "block", fontWeight: 600 }}>
                  <ExtLink href={settingsLink(SDV2_SCHEMA, o.scope)}>{scopeLabel(o.scope, names)}</ExtLink>
                </Text>
                {describeObject(o.value).map((l) => (
                  <Text key={l} style={{ ...hint, display: "block" }}>
                    {l}
                  </Text>
                ))}
              </div>
            ))
          )}
          <Text style={{ fontWeight: 600, marginTop: 8 }}>Settings pages</Text>
          {pages.map((p) => (
            <Text key={p.schema} style={hint}>
              <ExtLink href={settingsLink(p.schema)}>{p.label} ↗</ExtLink>
              {p.count && ` · ${p.count}`}
            </Text>
          ))}
        </Flex>
        <Flex flexDirection="column" gap={6} style={{ flex: "2 1 480px", minWidth: 0 }}>
          <Text style={{ fontWeight: 600 }}>Built-in rules the docs recommend</Text>
          {checks.length === 0 ? <Text style={hint}>None of the documented built-in rules were found.</Text> : checks.map((c) => <CheckLine key={c.id} c={c} />)}
        </Flex>
      </Flex>
    </div>
  );
}

// --- Services table ---------------------------------------------------------------------

type SvcRow = ServiceRow & { detection: string; where: string; verdictLabel: string; why: string; refs: number };

function contextDetail(s: ServiceRow): string {
  if (s.context === "K8S") return s.namespaces.map((n) => `${n.cluster} / ${n.name}`).join(", ");
  if (s.context === "FAAS") return `${s.lambdas} Lambda ${s.lambdas === 1 ? "function" : "functions"}`;
  const hg = s.hostGroups.filter((h) => h.id).map((h) => h.name);
  const pg = s.processGroups.map((p) => p.name);
  return [hg.length ? `host group ${hg.join(", ")}` : s.context === "GENERIC" ? "no host group" : "", pg.join(", ")].filter(Boolean).join(" · ") || (s.version === 2 ? "OpenTelemetry or ingested spans" : "no process context");
}

function ServicesCard({ services, tf, theme, verdict, setVerdict, context, setContext }: {
  services: ServiceRow[];
  tf: Timeframe;
  theme: Theme;
  verdict: string | null;
  setVerdict: (v: string | null) => void;
  context: string | null;
  setContext: (v: string | null) => void;
}) {
  const [name, setName] = useState("");
  const data = useMemo<SvcRow[]>(
    () =>
      services
        .filter((s) => (!verdict || s.verdict === verdict) && (!context || s.context === context) && (!name || s.name.toLowerCase().includes(name.toLowerCase())))
        .map((s) => ({
          ...s,
          detection: s.version === 2 ? "SDv2" : `SDv1 · ${formatMode(s.sdv1Type || "unknown")}`,
          where: `${CONTEXT_LABEL[s.context]}: ${contextDetail(s)}`,
          verdictLabel: verdictOf(s.verdict).label,
          why: s.reasons.join(" "),
          refs: s.frontends + s.monitors,
        })),
    [services, verdict, context, name],
  );
  const columns = useMemo(
    () =>
      [
        { id: "name", header: "Service", accessor: "name", width: 230, cell: ({ rowData }: { rowData: SvcRow }) => <ExtLink href={entityOverviewLink("SERVICE", rowData.id, tf)}>{rowData.name}</ExtLink> },
        { id: "detection", header: "Detection", accessor: "detection", width: 170 },
        { id: "where", header: "Runs on", accessor: "where", width: 280 },
        {
          id: "verdictLabel",
          header: "Recommendation",
          accessor: "verdictLabel",
          width: 160,
          cell: ({ rowData }: { rowData: SvcRow }) => (
            <span style={{ display: "inline-flex", alignItems: "center" }}>
              <Dot c={verdictOf(rowData.verdict)} theme={theme} />
              {rowData.verdictLabel}
            </span>
          ),
        },
        { id: "why", header: "Why", accessor: "why" },
        { id: "refs", header: "Frontend / monitor refs", accessor: "refs", width: 110 },
      ] as DataTableColumnDef<SvcRow>[],
    [tf, theme],
  );
  return (
    <div style={box}>
      <Heading level={4}>Services</Heading>
      <Flex gap={16} alignItems="flex-end" flexWrap="wrap" style={{ margin: `${Spacings.Size8} 0` }}>
        <Field label="Name contains">
          <TextInput value={name} placeholder="e.g. checkout" onChange={(v: string) => setName(v)} />
        </Field>
        <Field label="Recommendation">
          <Select value={verdict ?? "any"} onChange={(v: string | null) => setVerdict(!v || v === "any" ? null : v)}>
            <Select.Content>
              <Select.Option value="any">Any</Select.Option>
              {VERDICTS.map((v) => (
                <Select.Option key={v.id} value={v.id}>
                  {v.label}
                </Select.Option>
              ))}
            </Select.Content>
          </Select>
        </Field>
        <Field label="Runs on">
          <Select value={context ?? "any"} onChange={(v: string | null) => setContext(!v || v === "any" ? null : v)}>
            <Select.Content>
              <Select.Option value="any">Any</Select.Option>
              {CONTEXTS.map((c) => (
                <Select.Option key={c.id} value={c.id}>
                  {c.label}
                </Select.Option>
              ))}
            </Select.Content>
          </Select>
        </Field>
        <Text style={hint}>{plural(data.length, "service")}</Text>
      </Flex>
      <DataTable data={data} columns={columns} sortable resizable defaultLineWrap fullWidth variant={{ rowDensity: "condensed" }}>
        <DataTable.EmptyState>No services match.</DataTable.EmptyState>
        <DataTable.Pagination defaultPageSize={25} pageSizeOptions={[10, 25, 50, 100]} />
      </DataTable>
      {services.length >= SDV2_SERVICE_LIMIT && <Text style={hint}>Showing the first {SDV2_SERVICE_LIMIT.toLocaleString()} services.</Text>}
    </div>
  );
}

// --- Writes -----------------------------------------------------------------------------

/** Validate (dry run), then confirm and apply. Resets whenever the request changes. */
function WriteFlow({ error, request, requestLabel, confirmLabel, applyLabel, run, onApplied, note }: {
  error: string | null;
  request: string;
  requestLabel: string;
  confirmLabel: string;
  applyLabel: string;
  run: (validateOnly: boolean) => Promise<SubmitResult>;
  onApplied: () => void;
  note?: React.ReactNode;
}) {
  const [validated, setValidated] = useState<SubmitResult | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setValidated(null);
    setConfirm(false);
  }, [request]);
  const go = async (validateOnly: boolean) => {
    setBusy(true);
    const r = await run(validateOnly);
    setBusy(false);
    if (validateOnly) {
      setValidated(r);
      setResult(null);
    } else {
      setResult(r);
      setConfirm(false);
      setValidated(null);
      if (r.ok) onApplied();
    }
  };
  return (
    <Flex flexDirection="column" gap={12}>
      {error ? <Text style={{ color: WARN }}>{error}</Text> : <Request label={requestLabel} text={request} />}
      {note}
      <div>
        <Button variant="default" disabled={busy || !!error} onClick={() => void go(true)}>
          {busy && !validated ? "Validating…" : "Validate"}
        </Button>
      </div>
      <Text style={hint}>Validate sends the same request with validateOnly=true: the Settings API checks values and matching conditions, nothing is saved.</Text>
      <ResultLine result={validated} />
      {validated?.ok && (
        <>
          <Checkbox value={confirm} onChange={(v: boolean) => setConfirm(v)}>
            {confirmLabel}
          </Checkbox>
          <div>
            <Button variant="emphasized" disabled={busy || !confirm} onClick={() => void go(false)}>
              {applyLabel}
            </Button>
          </div>
        </>
      )}
      <ResultLine result={result} />
    </Flex>
  );
}

const ID_WARNING = "SDv2 assigns new service IDs and metric keys to matching services: dashboards, alerts, SLOs and API queries that reference the SDv1 services stop matching. Historical data stays under the old IDs.";

function ChangeList({ changes }: { changes: Sdv2Change[] }) {
  if (!changes.length) return null;
  return (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      {changes.map((c) => (
        <li key={c.scope}>
          <Text style={hint}>
            {c.label}: {c.existing ? "update the existing object" : "new object"}
            {c.note ? ` · ${c.note}` : ""}
          </Text>
        </li>
      ))}
    </ul>
  );
}

function K8sForm({ rows, settings, reload }: { rows: ScopeRow[]; settings: Sdv2Settings; reload: () => void }) {
  type Level = "namespace" | "cluster" | "environment";
  const [level, setLevel] = useState<Level>("namespace");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [condition, setCondition] = useState("");
  const nsRows = rows.filter((r) => r.kind === "NAMESPACE");
  const clusters = useMemo(() => {
    const m = new Map<string, Ref & { sdv1: number; namespaces: number }>();
    for (const r of nsRows) {
      if (!r.cluster?.id) continue;
      const c = m.get(r.cluster.id) ?? { ...r.cluster, sdv1: 0, namespaces: 0 };
      c.sdv1 += r.sdv1;
      c.namespaces += 1;
      m.set(r.cluster.id, c);
    }
    return [...m.values()].sort((a, b) => b.sdv1 - a.sdv1);
  }, [nsRows]);
  const options =
    level === "namespace"
      ? nsRows.map((r) => ({ scope: r.scope, label: `Namespace ${r.label}`, detail: `${r.sdv1} SDv1 → ~${r.after} SDv2${r.setting.enabled ? " · already on" : ""}`, recommended: r.verdict === "ENABLE" }))
      : level === "cluster"
        ? clusters.map((c) => ({ scope: c.id, label: `Cluster ${c.name}`, detail: `${c.sdv1} SDv1 services in ${c.namespaces} namespaces`, recommended: c.sdv1 > 0 }))
        : [{ scope: "environment", label: "Environment", detail: "every Kubernetes workload monitored by OneAgent", recommended: true }];
  const targets = level === "environment" ? options : options.filter((o) => selected[o.scope]);
  const changes = k8sChanges(targets, condition, settings);
  const err = checkChanges(changes);
  return (
    <Flex flexDirection="column" gap={12}>
      <Text>
        Turns on <strong>Enable Service detection v2 for Kubernetes workloads</strong> (generally available, Dynatrace SaaS 1.323+). Start with namespaces in lower
        environments; a more specific scope overrides the cluster and the environment.
      </Text>
      <Flex gap={16} flexWrap="wrap" alignItems="flex-end">
        <Field label="Scope">
          <Select value={level} onChange={(v: Level | null) => { if (v) { setLevel(v); setSelected({}); } }}>
            <Select.Content>
              <Select.Option value="namespace">Namespaces (staged rollout)</Select.Option>
              <Select.Option value="cluster">Clusters</Select.Option>
              <Select.Option value="environment">Environment</Select.Option>
            </Select.Content>
          </Select>
        </Field>
        <div style={{ flex: "1 1 420px", maxWidth: 640 }}>
          <Field label="Matching condition (optional)">
            <TextInput value={condition} placeholder='e.g. dt.agent.module.type == "java"' onChange={(v: string) => setCondition(v)} />
          </Field>
        </div>
      </Flex>
      <Text style={hint}>Empty condition = every workload in the scope. Allowed: primary Grail fields, OneAgent primary tags, resource and custom attributes (tags set by OpenPipeline are not available).</Text>
      {level !== "environment" && (
        <>
          <Flex gap={8}>
            <Button variant="default" size="condensed" onClick={() => setSelected(Object.fromEntries(options.filter((o) => o.recommended).map((o) => [o.scope, true])))}>
              Recommended ({options.filter((o) => o.recommended).length})
            </Button>
            <Button variant="default" size="condensed" onClick={() => setSelected({})}>
              Clear
            </Button>
          </Flex>
          {options.length === 0 ? (
            <Text>No Kubernetes services in this timeframe.</Text>
          ) : (
            <Flex flexDirection="column" gap={4} style={scrollBox(240)}>
              {options.map((o) => (
                <Checkbox key={o.scope} value={!!selected[o.scope]} onChange={(v: boolean) => setSelected((s) => ({ ...s, [o.scope]: v }))}>
                  {o.label}
                  <span style={{ ...hint, marginLeft: 8 }}>{o.detail}</span>
                </Checkbox>
              ))}
            </Flex>
          )}
        </>
      )}
      <ChangeList changes={changes} />
      <WriteFlow
        error={err}
        request={requestText(changes)}
        requestLabel={`Request (${changes.filter((c) => !c.existing).length ? "1 POST" : "no POST"} + ${changes.filter((c) => c.existing).length} PUT)`}
        confirmLabel={`Switch SDv2 on for Kubernetes workloads in ${plural(changes.length, "scope")}. I understand that matching services get new IDs.`}
        applyLabel="Enable SDv2 for Kubernetes"
        run={(v) => applyChanges(changes, v, `SDv2 is on for Kubernetes workloads in ${plural(changes.length, "scope")}. New services appear as new data arrives.`)}
        onApplied={reload}
        note={<Text style={{ ...hint, color: WARN, opacity: 1 }}>{ID_WARNING}</Text>}
      />
    </Flex>
  );
}

function FaasForm({ rows, settings, checks, reload }: { rows: ScopeRow[]; settings: Sdv2Settings; checks: RuleCheck[]; reload: () => void }) {
  const [condition, setCondition] = useState(DEFAULT_FAAS_CONDITION);
  const faas = rows.find((r) => r.kind === "FAAS");
  const state = effectiveSwitch(settings, "faas", []);
  const faasRule = checks.find((c) => c.id === "faas-name");
  const changes = useMemo(() => faasChanges("environment", "Environment", condition, settings), [condition, settings]);
  return (
    <Flex flexDirection="column" gap={12}>
      <Text>
        Turns on <strong>Enable Service detection v2 for FaaS</strong> at the environment (generally available, Dynatrace SaaS 1.337+).{" "}
        {faas ? `${faas.sdv1} AWS Lambda ${faas.sdv1 === 1 ? "service is" : "services are"} on SDv1.` : "No AWS Lambda services were found in this timeframe."}{" "}
        {state.enabled ? `Already on${state.condition ? ` where ${state.condition}` : ""}.` : ""}
      </Text>
      {faasRule && !faasRule.ok && (
        <Text style={{ ...hint, color: WARN, opacity: 1 }}>
          The [Built-in] FaaS name rule is disabled: SDv2 for Lambda only works when it is enabled. Turn it on with Apply recommended built-in rules.
        </Text>
      )}
      <div style={{ maxWidth: 640 }}>
        <Field label="Matching condition for FaaS">
          <TextInput value={condition} onChange={(v: string) => setCondition(v)} />
        </Field>
      </div>
      <Text style={hint}>The schema default is {DEFAULT_FAAS_CONDITION}.</Text>
      <WriteFlow
        error={checkChanges(changes)}
        request={requestText(changes)}
        requestLabel={changes[0]?.existing ? "Request (1 PUT)" : "Request (1 POST)"}
        confirmLabel="Switch SDv2 on for AWS Lambda functions. I understand that matching services get new IDs."
        applyLabel="Enable SDv2 for FaaS"
        run={(v) => applyChanges(changes, v, "SDv2 is on for FaaS. New services appear as new data arrives.")}
        onApplied={reload}
        note={<Text style={{ ...hint, color: WARN, opacity: 1 }}>{ID_WARNING}</Text>}
      />
    </Flex>
  );
}

function GenericForm({ rows, settings, reload }: { rows: ScopeRow[]; settings: Sdv2Settings; reload: () => void }) {
  const scopes = rows.filter((r) => (r.kind === "HOST_GROUP" || r.kind === "NO_HOST_GROUP") && r.candidates.length > 0);
  // Pre-select process groups whose services are all clean pilots; "review" ones stay unticked.
  const initial = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const r of scopes) for (const pg of r.candidates) out[`${r.key}|${pg.id}`] = r.services.filter((s) => s.processGroups.some((p) => p.id === pg.id) && s.version === 1).every((s) => s.verdict === "PILOT");
    return out;
  }, [scopes.map((s) => s.key).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [ack, setAck] = useState(false);
  useEffect(() => setSelected(initial), [initial]);
  const targets = useMemo(
    () =>
      scopes.flatMap((r) => {
        const picked = r.candidates.filter((pg) => selected[`${r.key}|${pg.id}`]);
        if (!picked.length) return [];
        const whole = r.kind === "HOST_GROUP" && picked.length === r.candidates.length && r.kept.length === 0;
        return [{ scope: r.scope, label: r.kind === "HOST_GROUP" ? `Host group ${r.label}` : "Environment (hosts without a host group)", condition: whole ? hostGroupCondition(r.label) : processGroupCondition(picked.map((p) => p.name)) }];
      }),
    [scopes, selected],
  );
  // Hosts without a host group and other environment-scope picks share the one environment object.
  const merged = useMemo(() => {
    const m = new Map<string, { scope: string; label: string; condition: string }>();
    for (const t of targets) {
      const prev = m.get(t.scope);
      m.set(t.scope, prev ? { ...prev, condition: `${prev.condition} or ${t.condition}` } : t);
    }
    return [...m.values()];
  }, [targets]);
  const changes = useMemo(() => genericChanges(merged, settings), [merged, settings]);
  const err = !ack ? "Confirm the Early Access notes above first." : checkChanges(changes);
  return (
    <Flex flexDirection="column" gap={12}>
      <Text>
        Turns on <strong>Enable Service detection v2 for generic workloads</strong> (Early Access, Dynatrace SaaS 1.343+) for the process groups you pick: web
        servers and single-service processes outside Kubernetes and Lambda. A whole host group gets <code>dt.host_group.id == …</code>, otherwise the condition
        lists the process groups (<code>dt.process_group.detected_name == …</code>), as in the docs examples.
      </Text>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        <li>
          <Text style={hint}>Application servers and multi-application processes (WebSphere, WebLogic, multi-context JVMs) and background workloads are left out: keep them on SDv1.</Text>
        </li>
        <li>
          <Text style={hint}>SDv1 custom services are ignored under SDv2; request attributes keep working. Add your cloud connection first for workloads on ECS, Cloud Run or Container Apps.</Text>
        </li>
        <li>
          <Text style={hint}>Update the service detection and splitting rules for these workloads first (Apply recommended built-in rules).</Text>
        </li>
      </ul>
      <Checkbox value={ack} onChange={(v: boolean) => setAck(v)}>
        I understand this is an Early Access feature
      </Checkbox>
      {scopes.length === 0 ? (
        <Text>No generic workloads to pilot in this timeframe.</Text>
      ) : (
        <Flex flexDirection="column" gap={8} style={scrollBox(320)}>
          {scopes.map((r) => (
            <div key={r.key}>
              <Text style={{ fontWeight: 600, display: "block" }}>
                {r.kind === "HOST_GROUP" ? `Host group ${r.label}` : r.label}
                <span style={{ ...hint, marginLeft: 8, fontWeight: 400 }}>
                  {r.kept.length ? `keep on SDv1: ${r.kept.map((p) => p.name).join(", ")}` : "no workloads to keep on SDv1"}
                </span>
              </Text>
              {r.candidates.map((pg) => {
                const svcs = r.services.filter((s) => s.version === 1 && s.processGroups.some((p) => p.id === pg.id));
                return (
                  <Checkbox key={pg.id} value={!!selected[`${r.key}|${pg.id}`]} onChange={(v: boolean) => setSelected((s) => ({ ...s, [`${r.key}|${pg.id}`]: v }))}>
                    {pg.name}
                    <span style={{ ...hint, marginLeft: 8 }}>
                      {plural(svcs.length, "SDv1 service")}
                      {svcs.some((s) => s.verdict === "REVIEW") ? " · review: custom service" : ""}
                    </span>
                  </Checkbox>
                );
              })}
            </div>
          ))}
        </Flex>
      )}
      <ChangeList changes={changes} />
      <WriteFlow
        error={err}
        request={requestText(changes)}
        requestLabel={`Request (${changes.filter((c) => !c.existing).length ? "1 POST" : "no POST"} + ${changes.filter((c) => c.existing).length} PUT)`}
        confirmLabel={`Pilot SDv2 for generic workloads in ${plural(changes.length, "scope")}. I understand that matching services get new IDs.`}
        applyLabel="Pilot SDv2 for generic workloads"
        run={(v) => applyChanges(changes, v, "SDv2 for generic workloads is on for the selected workloads. Check them in Services as new data arrives.")}
        onApplied={reload}
        note={<Text style={{ ...hint, color: WARN, opacity: 1 }}>{ID_WARNING}</Text>}
      />
    </Flex>
  );
}

function RulesForm({ checks, reload }: { checks: RuleCheck[]; reload: () => void }) {
  const gaps = checks.filter((c) => !c.ok);
  const [selected, setSelected] = useState<Record<string, boolean>>(() => Object.fromEntries(gaps.map((c) => [c.id, c.recommended])));
  const picked = gaps.filter((c) => selected[c.id]);
  const request = picked.map((c) => `// PUT /api/v2/settings/objects/${c.obj!.objectId}  (${c.rule})\n${JSON.stringify({ value: checkFixValue(c) }, null, 2)}`).join("\n\n");
  if (!gaps.length) return <Text>Every built-in rule the docs recommend is already set as recommended.</Text>;
  return (
    <Flex flexDirection="column" gap={12}>
      <Text>Sets the built-in detection, splitting and endpoint rules to the values the SDv2 docs recommend. One PUT per rule; only the enabled flag changes.</Text>
      <Flex flexDirection="column" gap={6}>
        {gaps.map((c) => (
          <div key={c.id} style={statusLine(WARN)}>
            <Checkbox value={!!selected[c.id]} onChange={(v: boolean) => setSelected((s) => ({ ...s, [c.id]: v }))}>
              {c.want ? "Enable" : "Disable"} {c.rule}
            </Checkbox>
            <Text style={{ ...hint, display: "block" }}>{c.why}</Text>
            <Text style={{ ...hint, display: "block", color: WARN, opacity: 1 }}>{c.impact}</Text>
          </div>
        ))}
      </Flex>
      <WriteFlow
        error={picked.length ? null : "Select at least one rule."}
        request={request}
        requestLabel={`Request (${picked.length} PUT)`}
        confirmLabel={`Update ${plural(picked.length, "built-in rule")}. I understand that matching services or endpoints get new IDs.`}
        applyLabel="Apply recommended built-in rules"
        run={(v) => applyRuleFixes(picked, v)}
        onApplied={reload}
      />
    </Flex>
  );
}

function Sdv2Actions({ rows, state, checks }: { rows: ScopeRow[]; state: SettingsState; checks: RuleCheck[] }) {
  const s = state.settings;
  type ActionDef = { id: string; label: string; kind: "api" | "manual"; node: React.ReactNode; docs: DocLink[] };
  const manual = (a: ManualAction): ActionDef => ({ id: a.id, label: a.title, kind: "manual", node: <ManualActionView action={a} />, docs: a.docs });
  const actions: ActionDef[] = [
    ...(s
      ? [
          { id: "rules", label: "Apply recommended built-in rules", kind: "api" as const, node: <RulesForm checks={checks} reload={state.reload} />, docs: [SDV2_DOCS.rules, SDV2_DOCS.splitting, SDV2_DOCS.endpoints] },
          { id: "k8s", label: "Enable SDv2 for Kubernetes workloads", kind: "api" as const, node: <K8sForm rows={rows} settings={s} reload={state.reload} />, docs: [SDV2_DOCS.oneAgent, SDV2_DOCS.schema] },
          { id: "faas", label: "Enable SDv2 for AWS Lambda (FaaS)", kind: "api" as const, node: <FaasForm rows={rows} settings={s} checks={checks} reload={state.reload} />, docs: [SDV2_DOCS.oneAgent, SDV2_DOCS.rules] },
          { id: "generic", label: "Pilot SDv2 for generic workloads (Early Access)", kind: "api" as const, node: <GenericForm rows={rows} settings={s} reload={state.reload} />, docs: [SDV2_DOCS.oneAgent, SDV2_DOCS.urlPatterns, SDV2_DOCS.splitting] },
        ]
      : []),
    manual(updateReferencesAction),
    manual(urlPatternAction),
    manual(serviceNameAction),
    manual(detectionRuleAction),
  ];
  const sdv1 = rows.reduce((n, r) => n + r.sdv1, 0);
  const ready = rows.filter((r) => r.verdict === "ENABLE").length;
  const [pick, setPick] = useState<string | null>(null);
  const active = actions.find((a) => a.id === pick) ?? actions[0];
  return (
    <div style={box}>
      <Flex justifyContent="space-between" alignItems="flex-end" flexWrap="wrap" gap={12}>
        <div>
          <Heading level={3} style={{ margin: 0 }}>
            Remediation actions
          </Heading>
          <Text style={{ opacity: 0.8 }}>
            {plural(sdv1, "SDv1 service")} in scopes SDv2 for OneAgent can cover; {plural(ready, "scope")} ready to enable now
            {checks.some((c) => !c.ok) ? `; ${plural(checks.filter((c) => !c.ok).length, "built-in rule")} to fix first` : ""}.
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
      {!s && <Text style={{ ...hint, display: "block", marginTop: 8 }}>{state.error ? "The API actions need the SDv2 settings, which could not be read." : "Loading settings for the API actions…"}</Text>}
      <div style={{ marginTop: Spacings.Size12 }}>
        <DocsChangedNote docs={active.docs} />
      </div>
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

// --- Tab ----------------------------------------------------------------------------------

export function Sdv2Tab({ tf }: { tf: Timeframe }) {
  const theme = useCurrentTheme() as Theme;
  const query = sdv2ServicesQuery(tf);
  const dql = useDql(query);
  const services = useMemo(() => (dql.data?.records ?? []).map(toService), [dql.data]);
  const settings = useSdv2Settings();
  const names = useMemo(() => scopeNames(services), [services]);
  const rows = useMemo(() => scopeRows(services, settings.settings), [services, settings.settings]);
  const checks = useMemo(() => (settings.settings ? ruleChecks(settings.settings, services) : []), [settings.settings, services]);
  const [verdict, setVerdict] = useState<string | null>(null);
  const [context, setContext] = useState<string | null>(null);
  const freshness = useDocsFreshness();

  const count = (pred: (s: ServiceRow) => boolean) => services.filter(pred).length;
  const sdv2 = count((s) => s.version === 2);
  const gaScope = services.filter((s) => s.context === "K8S" || s.context === "FAAS");
  const gaOnV2 = gaScope.filter((s) => s.version === 2).length;
  const rulesOk = checks.filter((c) => c.ok).length;
  const enabledScopes = settings.settings ? [...settings.settings.objects.values()].filter((o) => describeObject(o.value).some((l) => l.includes(": on"))).length : 0;
  const verdictCounts = useMemo(() => Object.fromEntries(VERDICTS.map((v) => [v.id, services.filter((s) => s.verdict === v.id).length])) as Record<"SDV2" | "ENABLE" | "PILOT" | "REVIEW" | "KEEP", number>, [services]);
  const verdictSlices = useMemo<Slice[]>(() => VERDICTS.filter((v) => verdictCounts[v.id as keyof typeof verdictCounts] > 0).map((v) => ({ id: v.id, label: v.label, value: verdictCounts[v.id as keyof typeof verdictCounts], color: categoryColor(v, theme) })), [verdictCounts, theme]);
  const contextSlices = useMemo<Slice[]>(
    () => CONTEXTS.map((c) => ({ id: c.id, label: c.label, value: services.filter((s) => s.context === c.id).length, color: categoryColor(c, theme) })).filter((s) => s.value > 0),
    [services, theme],
  );
  const section = sectionChanges(freshness, SDV2_PREFIX);
  const docsChanged = new Set([...changedDocs(freshness, ALL_SDV2_DOCS).map((c) => c.doc.url), ...section.changed]).size;

  const { panel: aiPanel } = useAIInsights(
    useCallback(
      () =>
        analyzeSdv2({
          total: services.length,
          sdv2,
          verdicts: verdictCounts,
          scopes: rows.filter((r) => r.sdv1 > 0 || r.verdict === "DONE").map((r) => ({ label: r.label, verdict: r.verdict, sdv1: r.sdv1, after: r.after, dependents: r.dependents })),
          ruleGaps: checks.filter((c) => !c.ok).map((c) => `${c.rule} should be ${c.want ? "enabled" : "disabled"}`),
          enabledScopes,
          settingsRead: !!settings.settings,
          docsChanged,
          docsNew: section.newPages.length,
        }),
      [services.length, sdv2, verdictCounts, rows, checks, enabledScopes, settings.settings, docsChanged, section.newPages.length],
    ),
  );

  return (
    <Flex flexDirection="column" gap={16}>
      {aiPanel}
      <Heading level={3}>Service Detection v2 adoption</Heading>
      <Text>
        Service Detection v2 detects and names services from resource attributes (k8s.workload.name, service.name, …) with one rule set for OneAgent and
        OpenTelemetry, and makes one service per process. It is generally available for Kubernetes and AWS Lambda services monitored by OneAgent, and Early Access
        for other workloads; switching assigns new service IDs.
      </Text>
      <DocsBanner />
      <QueryState state={dql}>
        <Flex gap={16} flexWrap="wrap" alignItems="stretch">
          <div style={card}>
            <PctGauge pct={pct(sdv2, services.length)} caption="Services on SDv2" detail={`${sdv2} of ${services.length}`} />
          </div>
          <div style={card}>
            <PctGauge pct={pct(gaOnV2, gaScope.length)} caption="Kubernetes / Lambda on SDv2" detail={gaScope.length ? `${gaOnV2} of ${gaScope.length} (GA scope)` : "no services in GA scope"} />
          </div>
          <div style={card}>
            <PctGauge pct={pct(rulesOk, checks.length)} caption="Recommended rules in place" detail={settings.settings ? `${rulesOk} of ${checks.length}` : settings.error ? "settings not readable" : "loading…"} />
          </div>
          <Flex flexDirection="column" gap={8}>
            <ScoreTile title="Ready to enable (GA)" value={String(verdictCounts.ENABLE)} subtitle={`SDv1 services in ${rows.filter((r) => r.verdict === "ENABLE").length} scopes`} />
            <ScoreTile title="Early Access candidates" value={String(verdictCounts.PILOT + verdictCounts.REVIEW)} subtitle={`${verdictCounts.REVIEW} to review first`} />
          </Flex>
          <Flex flexDirection="column" gap={8}>
            <ScoreTile title="Keep on SDv1" value={String(verdictCounts.KEEP)} subtitle="app servers, background, mainframe" />
            <ScoreTile title="SDv2 switches on" value={settings.settings ? String(enabledScopes) : "—"} subtitle="scopes in SDv2 for OneAgent" />
          </Flex>
        </Flex>
        <div style={box}>
          <Flex gap={32} flexWrap="wrap" alignItems="flex-start">
            <div style={{ flex: "1 1 360px" }}>
              <Heading level={4}>By recommendation</Heading>
              <Text style={{ ...hint, display: "block", marginBottom: 8 }}>Click a slice to filter the services table.</Text>
              {verdictSlices.length ? <Donut slices={verdictSlices} centerLabel="services" ariaLabel="Services by SDv2 recommendation" selectedId={verdict} onSelect={setVerdict} /> : <Text>No services.</Text>}
            </div>
            <div style={{ flex: "1 1 360px" }}>
              <Heading level={4}>By where they run</Heading>
              <Text style={{ ...hint, display: "block", marginBottom: 8 }}>Decides which SDv2 switch applies (Kubernetes, FaaS, generic workloads).</Text>
              {contextSlices.length ? <Donut slices={contextSlices} centerLabel="services" ariaLabel="Services by deployment context" selectedId={context} onSelect={setContext} /> : <Text>No services.</Text>}
            </div>
          </Flex>
          <div style={{ marginTop: Spacings.Size12 }}>
            <QueryActions title="Services by detection version and context" query={query} />
          </div>
        </div>
        <ScopesCard rows={rows} names={names} theme={theme} />
        <SettingsCard state={settings} checks={checks} names={names} />
        <ServicesCard services={services} tf={tf} theme={theme} verdict={verdict} setVerdict={setVerdict} context={context} setContext={setContext} />
        <Sdv2Actions rows={rows} state={settings} checks={checks} />
        <DocsCard />
      </QueryState>
    </Flex>
  );
}
