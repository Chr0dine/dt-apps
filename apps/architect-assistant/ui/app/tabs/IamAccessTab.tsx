import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { MessageContainer, ProgressCircle } from "@dynatrace/strato-components/content";
import { Checkbox, TextInput, ToggleButtonGroup } from "@dynatrace/strato-components/forms";
import { AccountIcon, CheckmarkIcon, GroupIcon, WarningIcon, XmarkIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { useAIInsights } from "../AIInsights";
import { analyzeIamAccess, type IamAccessInsightInput } from "../analyses";
import { ACCOUNT_MANAGEMENT_URL, IAM_DOCS, attributeOf, dimensionLabel, useIamCatalog } from "../iamCatalog";
import { renderBoundary, renderCondition, renderPolicy, type CondValue } from "../iamPolicy";
import { useIamDrafts } from "../iamDrafts";
import { APP_LEVELS, BUCKETS, LEVEL_LABEL, useAppCatalog, type AppSummary } from "../iamApps";
import {
  describeUnknown,
  evaluateAccess,
  grantPaths,
  tableLabel,
  type AccessResult,
  type AppAccess,
  type AppStatus,
  type DataRow,
  type LevelStatus,
  type PermEval,
  type PermStatus,
} from "../iamAccess";
import {
  ACCESS_DOCS,
  OUTBOUND_HOSTS,
  isUuid,
  readSetupStatus,
  resolveSubject,
  searchSubjects,
  type Failure,
  type Resolved,
  type SearchResult,
  type SetupStatus,
} from "../iamAccessApi";
import { iamRecordTable, iamVisibleRecordsQuery, type Timeframe } from "../queries";
import { QueryActions } from "../components";
import { settingsLink } from "../deepMonitoring";
import { OUTBOUND_SCHEMA } from "../deepDocs";
import { CatalogBanner, DocLink, DocLinks, card, code, hint, linkStyle, plural } from "./IamShared";
import { AppIcon } from "./IamPolicyTab";
import { AppCredentialsCard } from "./AppCredentials";

// ---------------------------------------------------------------------------
// Permissions Test: pick a user (name or email) or a group (name contains), read what is bound to it in Account
// Management (groups, policies, boundaries, bind parameters; iam-access app function), and show
// - every installed app: ✓ opens and can read the data it needs, ⚠ conditional (time window, unbound parameter, or
//   some required data not readable), ✗ cannot be opened,
// - below, the dimensional data: per Grail table, unrestricted, limited (to which values) or not readable, by table or
//   by dimension, with a DQL preview of the records.
// The policy text is evaluated with the IAM Policy / Boundary Creator engine (parsePolicy, validateBoundary,
// applyBoundary) and the Policy Creator's app catalogue (summarizeApp, icons). "Policy Creator draft" tests the drafts
// of those tabs live, without the Account Management API.
// ---------------------------------------------------------------------------

type Mode = "user" | "group" | "draft";
type Run = { status: "idle" } | { status: "loading"; label: string } | { status: "done"; resolved: Resolved } | { status: "failed"; failure: Failure; label: string };
type AppFilter = "all" | AppStatus;
type OwnerFilter = "all" | "dynatrace" | "custom";

const APP_STATUS: Record<AppStatus, { label: string; text: string; accent: string; border: string; Icon: typeof CheckmarkIcon }> = {
  access: { label: "Access", text: Colors.Text.Success.Default, accent: Colors.Background.Container.Success.Accent, border: Colors.Border.Success.Accent, Icon: CheckmarkIcon },
  conditional: { label: "Conditional", text: Colors.Text.Warning.Default, accent: Colors.Background.Container.Warning.Accent, border: Colors.Border.Warning.Accent, Icon: WarningIcon },
  none: { label: "No access", text: Colors.Text.Critical.Default, accent: Colors.Background.Container.Critical.Accent, border: Colors.Border.Critical.Accent, Icon: XmarkIcon },
};
const DATA_STATUS: Record<PermStatus, { label: string; text: string; fill: string; border: string }> = {
  granted: { label: "All records", text: Colors.Text.Success.Default, fill: Colors.Background.Container.Success.Accent, border: Colors.Border.Success.Accent },
  scoped: { label: "Limited", text: Colors.Text.Success.Default, fill: Colors.Background.Container.Success.Default, border: Colors.Border.Success.Accent },
  conditional: { label: "Conditional", text: Colors.Text.Warning.Default, fill: Colors.Background.Container.Warning.Default, border: Colors.Border.Warning.Accent },
  missing: { label: "No access", text: Colors.Text.Critical.Default, fill: Colors.Background.Container.Critical.Default, border: Colors.Border.Critical.Default },
  denied: { label: "Denied", text: Colors.Text.Critical.Default, fill: Colors.Background.Container.Critical.Default, border: Colors.Border.Critical.Accent },
};
const STATUS_ORDER: Record<AppStatus, number> = { access: 0, conditional: 1, none: 2 };
const PERM_TEXT: Record<PermStatus, string> = { granted: "granted", scoped: "limited", conditional: "conditional", missing: "not granted", denied: "denied" };
const LEVEL_COLOR: Record<LevelStatus, string> = { full: Colors.Text.Success.Default, partial: Colors.Text.Warning.Default, none: Colors.Text.Critical.Default, "n/a": "inherit" };
const condText = (c: CondValue) => renderCondition({ ...c, key: c.key.replace(/^storage:/, "") });

export function IamAccessTab({ tf }: { tf: Timeframe }) {
  const cat = useIamCatalog();
  const ix = cat.index;
  const appCat = useAppCatalog(ix);
  const drafts = useIamDrafts();
  const [mode, setMode] = useState<Mode>("user");
  const [run, setRun] = useState<Run>({ status: "idle" });
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [useBoundary, setUseBoundary] = useState(true);
  const lastTarget = useRef<Parameters<typeof resolveSubject>[0] | null>(null);

  const refreshSetup = useCallback(() => {
    setSetup(null);
    void readSetupStatus().then(setSetup);
  }, []);
  useEffect(refreshSetup, [refreshSetup]);

  const test = useCallback((target: Parameters<typeof resolveSubject>[0], label: string) => {
    lastTarget.current = target;
    setRun({ status: "loading", label });
    void resolveSubject(target).then((r) => setRun("subject" in r ? { status: "done", resolved: r } : { status: "failed", failure: r, label }));
  }, []);

  // Draft mode: the Policy Creator's policy (and the Boundary Creator's boundary) as one binding, re-evaluated live.
  const apps = appCat.apps ? appCat.summaries : null;
  const draftPolicy = drafts.policyText ?? renderPolicy(drafts.policy, ix, ix.catalog.updated, apps);
  const draftBoundary = drafts.boundaryText ?? renderBoundary(drafts.boundary, ix);
  const draft = useMemo<Resolved>(
    () => ({
      subject: { kind: "draft", id: "draft", name: drafts.policy.name.trim() || "IAM Policy Creator draft", groups: [] },
      bindings: [
        {
          groupUuid: null,
          groupName: "Policy Creator draft",
          levelType: "draft",
          levelId: "draft",
          policy: { uuid: "draft", name: drafts.policy.name.trim() || "IAM Policy Creator draft", levelType: "draft", statementQuery: draftPolicy },
          boundaries: useBoundary && draftBoundary.trim() ? [{ uuid: "draft-boundary", name: drafts.boundary.name.trim() || "IAM Boundary Creator draft", boundaryQuery: draftBoundary }] : [],
          parameters: {},
        },
      ],
      warnings: [],
      checkedAt: new Date().toISOString(),
      accountUuid: "",
      environmentId: "",
    }),
    [drafts.policy.name, drafts.boundary.name, draftPolicy, draftBoundary, useBoundary],
  );
  const resolved = mode === "draft" ? (draftPolicy.trim() ? draft : null) : run.status === "done" ? run.resolved : null;
  const summaries = useMemo(() => (apps ? [...apps.values()] : []), [apps]);
  const result = useMemo<AccessResult | null>(
    () => (resolved ? evaluateAccess(resolved.bindings, resolved.subject, resolved.environmentId, summaries, ix) : null),
    [resolved, summaries, ix],
  );

  const insight = useMemo<IamAccessInsightInput>(() => accessInsight(mode, resolved, result, setup, run, !!apps), [mode, resolved, result, setup, run, apps]);
  const { panel } = useAIInsights(useCallback(() => analyzeIamAccess(insight), [insight]));

  return (
    <Flex flexDirection="column" gap={16}>
      {panel}
      <Heading level={3}>Permissions Test</Heading>
      <Text>
        Pick a user or a group to see which apps they can use and which data they can read in this environment. The groups, policies, boundaries and bind parameters
        bound in <DocLink href={ACCOUNT_MANAGEMENT_URL}>Account Management</DocLink> are read through the Account Management API and evaluated with the same engine as
        the IAM Policy and Boundary Creators: every statement against the <DocLink href={IAM_DOCS.reference.url}>IAM policy reference</DocLink>, boundaries with the
        documented rules, DENY over ALLOW.
      </Text>
      <CatalogBanner
        state={cat}
        missingHint="Permissions added to the docs after the snapshot are not tested here (apps' manifest scopes count as non-IAM), and boundaries do not narrow them."
      />
      <SubjectCard mode={mode} onMode={(m) => (setMode(m), setRun({ status: "idle" }))} run={run} onTest={test} useBoundary={useBoundary} onUseBoundary={setUseBoundary} hasDraft={!!draftPolicy.trim()} hasBoundary={!!draftBoundary.trim()} />
      {mode !== "draft" && <SetupCard setup={setup} onSaved={refreshSetup} />}
      {mode !== "draft" && run.status === "loading" && (
        <Flex gap={8} alignItems="center">
          <ProgressCircle size="small" aria-label="Reading permissions" />
          <Text>Reading the groups, policies and boundaries of {run.label}…</Text>
        </Flex>
      )}
      {mode !== "draft" && run.status === "failed" && <FailureMessage failure={run.failure} label={run.label} onRetry={() => lastTarget.current && test(lastTarget.current, run.label)} />}
      {resolved && result && (
        <>
          <SummaryCard resolved={resolved} result={result} appsLoaded={!!apps} onRetest={mode !== "draft" && lastTarget.current ? () => test(lastTarget.current!, resolved.subject.name) : undefined} />
          <AppsCard result={result} apps={apps} appError={appCat.error} />
          <DataCard result={result} tf={tf} />
          <SourcesCard resolved={resolved} result={result} />
        </>
      )}
      <DocLinks docs={[IAM_DOCS.reference, IAM_DOCS.boundaries, IAM_DOCS.templating, IAM_DOCS.grail, IAM_DOCS.defaults, ACCESS_DOCS.accountApi, ACCESS_DOCS.bindings, ACCESS_DOCS.oauth]} />
    </Flex>
  );
}

// --- Subject -----------------------------------------------------------------------------------------------------------
function SubjectCard({
  mode,
  onMode,
  run,
  onTest,
  useBoundary,
  onUseBoundary,
  hasDraft,
  hasBoundary,
}: {
  mode: Mode;
  onMode: (m: Mode) => void;
  run: Run;
  onTest: (target: Parameters<typeof resolveSubject>[0], label: string) => void;
  useBoundary: boolean;
  onUseBoundary: (v: boolean) => void;
  hasDraft: boolean;
  hasBoundary: boolean;
}) {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState<SearchResult | "loading" | null>(null);
  useEffect(() => setSearch(null), [mode]);
  const text = q.trim();
  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (text.length < 3) return;
    setSearch("loading");
    void searchSubjects(mode === "group" ? "group" : "user", text).then(setSearch);
  };
  const direct = mode === "user" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : mode === "group" && isUuid(text) ? text : null;
  const busy = run.status === "loading";
  return (
    <div style={card}>
      <Heading level={4}>Who to test</Heading>
      <Flex gap={8} alignItems="center" flexWrap="wrap" style={{ margin: "8px 0" }}>
        <ToggleButtonGroup value={mode} onChange={(v: string) => v && onMode(v as Mode)} name="iam-access-mode">
          <ToggleButtonGroup.Item value="user">User</ToggleButtonGroup.Item>
          <ToggleButtonGroup.Item value="group">Group</ToggleButtonGroup.Item>
          <ToggleButtonGroup.Item value="draft">Policy Creator draft</ToggleButtonGroup.Item>
        </ToggleButtonGroup>
      </Flex>
      {mode === "draft" ? (
        <>
          <Text style={{ ...hint, display: "block", marginBottom: 6 }}>
            Tests the policy in the IAM Policy Creator tab (hand edits included){hasBoundary ? ", assigned with the boundary in the IAM Boundary Creator tab" : ""}, as if it were the only
            policy bound to a group. Changes in those tabs show here right away; no Account Management access is needed.
          </Text>
          {hasBoundary && (
            <Checkbox value={useBoundary} onChange={(v: boolean) => onUseBoundary(v)}>
              Apply the IAM Boundary Creator&apos;s boundary
            </Checkbox>
          )}
          {!hasDraft && <Text style={{ ...hint, display: "block", marginTop: 6 }}>The IAM Policy Creator has no policy yet. Build one there first.</Text>}
        </>
      ) : (
        <>
          <form onSubmit={submit}>
            <Flex gap={8} alignItems="center" flexWrap="wrap">
              <div style={{ flex: "1 1 280px" }}>
                <TextInput
                  value={q}
                  onChange={(v: string) => setQ(v)}
                  placeholder={mode === "user" ? "Name or email, e.g. alex or alex.kim@example.com" : "Group name contains, e.g. developers"}
                  aria-label={mode === "user" ? "User name or email" : "Group name contains"}
                />
              </div>
              <Button type="submit" variant="emphasized" disabled={text.length < 3 || search === "loading"}>
                Search
              </Button>
            </Flex>
          </form>
          <Text style={{ ...hint, display: "block", marginTop: 4 }}>
            {mode === "user" ? "Matches emails that contain the text and names that start with it (3 characters or more)." : "Matches group names that contain the text (3 characters or more)."}
          </Text>
          {search === "loading" && (
            <Flex gap={8} alignItems="center" style={{ marginTop: 8 }}>
              <ProgressCircle size="small" aria-label="Searching" />
              <Text style={hint}>Searching…</Text>
            </Flex>
          )}
          {search && search !== "loading" && "status" in search && (
            <div style={{ marginTop: 8 }}>
              <MessageContainer variant="critical">
                <MessageContainer.Description>
                  <span>Search failed: {search.message}</span>
                </MessageContainer.Description>
              </MessageContainer>
            </div>
          )}
          {search && search !== "loading" && "hits" in search && (
            <div style={{ marginTop: 8 }}>
              <Text style={{ ...hint, display: "block", marginBottom: 4 }}>
                {search.hits.length ? `${plural(search.total, mode === "user" ? "user" : "group")} found` : "Nothing found."}
                {search.total > search.hits.length ? `, first ${search.hits.length} shown; refine the search` : ""}
                {search.source === "account" ? " (from the account's lists: the environment IAM API was not available)" : ""}. Click one to test it.
              </Text>
              <div role="list" style={{ maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                {search.hits.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    role="listitem"
                    disabled={busy}
                    onClick={() => onTest(mode === "user" ? { kind: "user", email: h.email ?? h.name } : { kind: "group", uuid: h.id, name: h.name }, h.name)}
                    style={hitStyle}
                  >
                    {mode === "user" ? <AccountIcon style={{ width: 16, height: 16, flex: "0 0 auto" }} /> : <GroupIcon style={{ width: 16, height: 16, flex: "0 0 auto" }} />}
                    <span style={{ fontWeight: 600 }}>{h.name}</span>
                    {h.email && h.email !== h.name && <span style={{ opacity: 0.75 }}>{h.email}</span>}
                    {h.detail && <span style={{ ...hint, marginLeft: "auto" }}>{h.detail}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
          {direct && (
            <div style={{ marginTop: 8 }}>
              <Button size="condensed" disabled={busy} onClick={() => onTest(mode === "user" ? { kind: "user", email: direct } : { kind: "group", uuid: direct }, direct)}>
                Test {mode === "user" ? direct : `group ${direct}`} directly
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
const hitStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  textAlign: "left",
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid rgba(128,128,128,0.25)",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  fontSize: 13,
};

// --- Setup -------------------------------------------------------------------------------------------------------------
/** The account OAuth client lives in the app settings (AppCredentialsCard); below it, whether the function can use it. */
function SetupCard({ setup, onSaved }: { setup: SetupStatus | null; onSaved: () => void }) {
  const outbound = settingsLink(OUTBOUND_SCHEMA);
  return (
    <Flex flexDirection="column" gap={8}>
      <AppCredentialsCard use="account" onChanged={onSaved} />
      {setup?.state === "ok" && (
        <Text style={{ ...hint, display: "block" }}>
          The function reaches the Account Management API with <span style={code}>{setup.scopes}</span>
          {setup.source === "credential-vault" ? " (credential vault entry of an earlier version)" : ""}.
        </Text>
      )}
      {setup?.state === "failing" && (
        <MessageContainer variant="warning">
          <MessageContainer.Description>
            <span>
              {setup.failure.status === "blocked"
                ? `The app function cannot reach ${OUTBOUND_HOSTS.join(" and ")}: add both hosts to the allowed outbound connections.`
                : setup.failure.status === "forbidden"
                  ? setup.failure.message
                  : `The stored OAuth client does not work: ${setup.failure.message}`}
              {setup.failure.status === "blocked" && outbound && (
                <>
                  {" "}
                  <DocLink href={outbound}>Allowed outbound connections</DocLink>
                </>
              )}
            </span>
          </MessageContainer.Description>
        </MessageContainer>
      )}
    </Flex>
  );
}

function FailureMessage({ failure, label, onRetry }: { failure: Failure; label: string; onRetry: () => void }) {
  const title: Record<Failure["status"], string> = {
    "no-credential": "No OAuth client stored for the Account Management API",
    forbidden: "Only the app's admins can run the Permissions Test",
    unauthorized: "The Account Management API refused the request",
    blocked: "The app function cannot reach the Account Management API",
    "not-found": `${label} was not found in the account`,
    error: "Reading the permissions failed",
  };
  return (
    <MessageContainer variant={failure.status === "not-found" ? "warning" : "critical"}>
      <MessageContainer.Title>{title[failure.status]}</MessageContainer.Title>
      <MessageContainer.Description>
        <span>
          {failure.message}
          {/[.!?]$/.test(failure.message.trim()) ? "" : "."}
          {failure.status === "unauthorized" && " The OAuth client needs account-idm-read plus iam:bindings:read, iam:policies:read and iam:boundaries:read (or iam-policies-management)."}{" "}
          <button type="button" onClick={onRetry} style={textButton}>
            Retry
          </button>
        </span>
      </MessageContainer.Description>
    </MessageContainer>
  );
}
const textButton: React.CSSProperties = { background: "none", border: "none", padding: 0, color: "inherit", textDecoration: "underline", cursor: "pointer", fontSize: 12 };

// --- Summary -----------------------------------------------------------------------------------------------------------
function SummaryCard({ resolved, result, appsLoaded, onRetest }: { resolved: Resolved; result: AccessResult; appsLoaded: boolean; onRetest?: () => void }) {
  const s = resolved.subject;
  const counts = { access: 0, conditional: 0, none: 0 } as Record<AppStatus, number>;
  result.apps.forEach((a) => counts[a.status]++);
  const data = result.data.filter((r) => r.permission !== BUCKETS);
  const dataCount = (st: PermStatus[]) => data.filter((r) => st.includes(r.status)).length;
  const policies = new Set(resolved.bindings.map((b) => b.policy.uuid)).size;
  const boundaries = new Set(resolved.bindings.flatMap((b) => b.boundaries.map((x) => x.uuid))).size;
  return (
    <div style={card}>
      <Flex justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={8}>
        <Flex gap={8} alignItems="center">
          {s.kind === "group" ? <GroupIcon style={{ width: 28, height: 28 }} /> : <AccountIcon style={{ width: 28, height: 28 }} />}
          <div>
            <Heading level={4}>{s.name}</Heading>
            <Text style={hint}>
              {s.kind === "user" ? s.email : s.kind === "group" ? `Group ${s.id}` : "Draft policy from the IAM Policy Creator"}
              {resolved.environmentId ? ` · environment ${resolved.environmentId}` : ""}
            </Text>
          </div>
        </Flex>
        {onRetest && (
          <Button size="condensed" onClick={onRetest}>
            Test again
          </Button>
        )}
      </Flex>
      {s.kind === "user" && (
        <Flex gap={6} flexWrap="wrap" alignItems="center" style={{ marginTop: 8 }}>
          <Text style={hint}>Member of {plural(s.groups.length, "group")}:</Text>
          {s.groups.map((g) => (
            <span key={g.uuid} style={pill} title={g.uuid}>
              <GroupIcon style={{ width: 12, height: 12, verticalAlign: "-2px", marginRight: 4 }} />
              {g.name}
            </span>
          ))}
        </Flex>
      )}
      <Text style={{ display: "block", fontSize: 13, marginTop: 8 }}>
        {plural(policies, "policy", "policies")} bound{boundaries ? ` (${plural(boundaries, "boundary", "boundaries")})` : ""} → {plural(result.statements.length, "effective statement")}.
      </Text>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginTop: 12 }}>
        <div>
          <Text style={{ ...hint, display: "block", marginBottom: 6 }}>Apps{appsLoaded ? ` (${result.apps.length} installed)` : " (reading installed apps…)"}</Text>
          <StatusBar
            parts={(["access", "conditional", "none"] as AppStatus[]).map((k) => ({ key: k, label: APP_STATUS[k].label, value: counts[k], color: APP_STATUS[k].accent }))}
            total={result.apps.length}
          />
        </div>
        <div>
          <Text style={{ ...hint, display: "block", marginBottom: 6 }}>Grail tables ({data.length})</Text>
          <StatusBar
            parts={[
              { key: "granted", label: "All records", value: dataCount(["granted"]), color: DATA_STATUS.granted.fill },
              { key: "scoped", label: "Limited", value: dataCount(["scoped"]), color: DATA_STATUS.scoped.border, hatched: true },
              { key: "conditional", label: "Conditional", value: dataCount(["conditional"]), color: DATA_STATUS.conditional.border },
              { key: "missing", label: "No access", value: dataCount(["missing", "denied"]), color: APP_STATUS.none.accent },
            ]}
            total={data.length}
          />
        </div>
      </div>
      {[...resolved.warnings, ...result.notes.map((n) => n.text)].length > 0 && (
        <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 12, color: Colors.Text.Warning.Default }}>
          {[...resolved.warnings, ...result.notes.map((n) => n.text)].map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
const pill: React.CSSProperties = { fontSize: 12, padding: "2px 8px", borderRadius: 10, background: "rgba(128,128,128,0.16)", whiteSpace: "nowrap" };

/** Custom stacked bar: one segment per status, value labels below (no Strato chart, per the app's conventions). */
function StatusBar({ parts, total }: { parts: { key: string; label: string; value: number; color: string; hatched?: boolean }[]; total: number }) {
  return (
    <div>
      <div role="img" aria-label={parts.map((p) => `${p.label}: ${p.value}`).join(", ")} style={{ display: "flex", height: 14, borderRadius: 7, overflow: "hidden", background: "rgba(128,128,128,0.15)" }}>
        {total > 0 &&
          parts
            .filter((p) => p.value > 0)
            .map((p) => (
              <div
                key={p.key}
                title={`${p.label}: ${p.value}`}
                style={{
                  width: `${(p.value / total) * 100}%`,
                  background: p.hatched ? `repeating-linear-gradient(135deg, ${p.color} 0 4px, transparent 4px 7px)` : p.color,
                  borderRight: "1px solid rgba(0,0,0,0.15)",
                }}
              />
            ))}
      </div>
      <Flex gap={12} flexWrap="wrap" style={{ marginTop: 6 }}>
        {parts.map((p) => (
          <Text key={p.key} style={{ fontSize: 12 }}>
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                borderRadius: 2,
                marginRight: 4,
                verticalAlign: "-1px",
                background: p.hatched ? `repeating-linear-gradient(135deg, ${p.color} 0 2px, transparent 2px 4px)` : p.color,
                border: p.hatched ? `1px solid ${p.color}` : undefined,
              }}
            />
            <strong>{p.value}</strong> {p.label}
          </Text>
        ))}
      </Flex>
    </div>
  );
}

// --- Apps --------------------------------------------------------------------------------------------------------------
function AppsCard({ result, apps, appError }: { result: AccessResult; apps: Map<string, AppSummary> | null; appError: string | null }) {
  const [status, setStatus] = useState<AppFilter>("all");
  const [owner, setOwner] = useState<OwnerFilter>("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const counts = useMemo(() => {
    const c = { all: result.apps.length, access: 0, conditional: 0, none: 0 } as Record<AppFilter, number>;
    result.apps.forEach((a) => c[a.status]++);
    return c;
  }, [result.apps]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return result.apps
      .filter((a) => status === "all" || a.status === status)
      .filter((a) => owner === "all" || (owner === "dynatrace") === !!apps?.get(a.id)?.app.builtin)
      .filter((a) => !needle || a.name.toLowerCase().includes(needle) || a.id.toLowerCase().includes(needle))
      // Apps the subject can use first, so they are not buried among the ones it cannot open.
      .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name));
  }, [result.apps, status, owner, q, apps]);
  const sel = selected ? result.apps.find((a) => a.id === selected) : undefined;
  const pick = (id: string) => {
    setSelected((cur) => (cur === id ? null : id));
    setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
  };
  return (
    <div style={card}>
      <Heading level={4}>Apps</Heading>
      <Flex gap={16} flexWrap="wrap" style={{ margin: "6px 0 10px" }}>
        {(["access", "conditional", "none"] as AppStatus[]).map((k) => (
          <Text key={k} style={{ fontSize: 12 }}>
            <StatusDot status={k} size={16} /> <strong>{APP_STATUS[k].label}</strong>:{" "}
            {k === "access" ? "opens and can read the data it needs (possibly limited, see Dimensional data)" : k === "conditional" ? "opens only at certain times or for some users, or some of its data is not readable" : "cannot be opened"}
          </Text>
        ))}
      </Flex>
      {appError && (
        <MessageContainer variant="critical">
          <MessageContainer.Description>Could not read the installed apps (App Registry): {appError}</MessageContainer.Description>
        </MessageContainer>
      )}
      <Flex gap={8} alignItems="center" flexWrap="wrap" style={{ marginBottom: 8 }}>
        <div style={{ flex: "1 1 200px" }}>
          <TextInput value={q} onChange={(v: string) => setQ(v)} placeholder="Search apps" aria-label="Search apps" />
        </div>
        <ToggleButtonGroup value={status} onChange={(v: string) => v && setStatus(v as AppFilter)} name="iam-access-status">
          <ToggleButtonGroup.Item value="all">All ({counts.all})</ToggleButtonGroup.Item>
          <ToggleButtonGroup.Item value="access">Access ({counts.access})</ToggleButtonGroup.Item>
          <ToggleButtonGroup.Item value="conditional">Conditional ({counts.conditional})</ToggleButtonGroup.Item>
          <ToggleButtonGroup.Item value="none">No access ({counts.none})</ToggleButtonGroup.Item>
        </ToggleButtonGroup>
        <ToggleButtonGroup value={owner} onChange={(v: string) => v && setOwner(v as OwnerFilter)} name="iam-access-owner">
          <ToggleButtonGroup.Item value="all">All</ToggleButtonGroup.Item>
          <ToggleButtonGroup.Item value="dynatrace">Dynatrace</ToggleButtonGroup.Item>
          <ToggleButtonGroup.Item value="custom">Custom</ToggleButtonGroup.Item>
        </ToggleButtonGroup>
      </Flex>
      {!apps && !appError && <Text style={hint}>Reading installed apps…</Text>}
      <div role="list" aria-label="Installed apps" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(168px, 1fr))", gap: 10, maxHeight: 560, overflowY: "auto", padding: 2 }}>
        {list.map((a) => {
          const s = apps?.get(a.id);
          return s ? <AppAccessCard key={a.id} a={a} s={s} selected={a.id === selected} onClick={() => pick(a.id)} /> : null;
        })}
      </div>
      {apps && !list.length && <Text style={{ ...hint, display: "block", marginTop: 8 }}>No app matches the filters.</Text>}
      <div ref={detailRef}>{sel && apps?.get(sel.id) && <AppDetail a={sel} s={apps.get(sel.id)!} onClose={() => setSelected(null)} />}</div>
    </div>
  );
}

function StatusDot({ status, size = 20 }: { status: AppStatus; size?: number }) {
  const st = APP_STATUS[status];
  const Icon = st.Icon;
  return (
    <span
      role="img"
      aria-label={st.label}
      style={{ width: size, height: size, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", background: st.accent, color: "#fff", verticalAlign: "middle", flex: "0 0 auto" }}
    >
      <Icon style={{ width: size * 0.7, height: size * 0.7 }} />
    </span>
  );
}

function AppAccessCard({ a, s, selected, onClick }: { a: AppAccess; s: AppSummary; selected: boolean; onClick: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const st = APP_STATUS[a.status];
  const required = a.data.filter((d) => !d.optional);
  const readable = required.filter((d) => d.status === "granted" || d.status === "scoped").length;
  const note = a.reasons[0] ?? (required.length ? `Data: ${readable} of ${required.length} table${required.length === 1 ? "" : "s"}${a.limited.length ? ", limited" : ""}` : "Opens; shows no Grail data");
  return (
    <div
      ref={ref}
      role="listitem"
      tabIndex={0}
      aria-label={`${a.name}: ${st.label}`}
      title={a.id}
      onClick={onClick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onClick())}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: 10,
        borderRadius: 10,
        cursor: "pointer",
        border: `2px solid ${a.status === "none" ? "rgba(128,128,128,0.25)" : st.border}`,
        background: Colors.Background.Container.Neutral.Default,
        boxShadow: selected ? `0 0 0 3px ${st.border}` : undefined,
        opacity: a.status === "none" ? 0.8 : 1,
      }}
    >
      <span style={{ position: "absolute", top: 8, right: 8 }}>
        <StatusDot status={a.status} />
      </span>
      <Flex gap={8} alignItems="center" style={{ paddingRight: 24, minHeight: 36 }}>
        <AppIcon s={s} size={32} cardRef={ref} />
        <Text style={{ fontWeight: 600, fontSize: 13, lineHeight: "16px", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", wordBreak: "break-word" }}>{a.name}</Text>
      </Flex>
      <Flex gap={4} alignItems="center" style={{ marginTop: "auto" }}>
        {APP_LEVELS.map((l) => {
          const ls = a.levels[l].status;
          // Levels only matter for apps the subject can open.
          if (ls === "n/a" || a.status === "none") return null;
          return (
            <span
              key={l}
              title={`${LEVEL_LABEL[l]}: ${ls === "full" ? "every permission granted" : ls === "partial" ? "some permissions granted" : "no permission granted"}`}
              style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 8, border: `1px solid ${LEVEL_COLOR[ls]}`, color: LEVEL_COLOR[ls], opacity: ls === "none" ? 0.7 : 1 }}
            >
              {LEVEL_LABEL[l][0]}
            </span>
          );
        })}
      </Flex>
      <div style={{ height: 30, fontSize: 11, lineHeight: "15px", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", color: a.status === "access" ? undefined : st.text, opacity: a.status === "access" ? 0.75 : 1 }}>
        {note.charAt(0).toUpperCase() + note.slice(1)}
      </div>
    </div>
  );
}

function AppDetail({ a, s, onClose }: { a: AppAccess; s: AppSummary; onClose: () => void }) {
  const st = APP_STATUS[a.status];
  return (
    <div style={{ marginTop: 12, padding: 12, borderRadius: 8, border: `1px solid ${st.border}` }}>
      <Flex justifyContent="space-between" alignItems="flex-start" gap={8}>
        <div>
          <Text style={{ fontWeight: 700, fontSize: 14 }}>
            <StatusDot status={a.status} size={16} /> {a.name} <span style={{ ...hint, fontWeight: 400 }}>{a.id}</span>
          </Text>
          <Text style={{ display: "block", fontSize: 13, marginTop: 4, color: st.text }}>
            {st.label}
            {a.reasons.length ? `: ${a.reasons.join("; ")}.` : "."}
          </Text>
        </div>
        <Button size="condensed" onClick={onClose}>
          Close
        </Button>
      </Flex>
      <DetailSection title="Opening the app (app-engine:apps:run)">
        <GrantList e={a.run} empty="No ALLOW of app-engine:apps:run covers this app." />
      </DetailSection>
      {a.data.length > 0 && (
        <DetailSection title="Grail data it shows">
          <Flex gap={6} flexWrap="wrap">
            {a.data.map((d) => (
              <span key={d.permission} style={{ ...pill, color: DATA_STATUS[d.status].text, border: `1px solid ${DATA_STATUS[d.status].border}`, background: "transparent" }} title={`${d.permission}: ${DATA_STATUS[d.status].label}`}>
                {tableLabel(d.permission)}: {DATA_STATUS[d.status].label.toLowerCase()}
                {d.optional ? " (optional)" : ""}
              </span>
            ))}
          </Flex>
          {a.limited.length > 0 && <Text style={{ ...hint, display: "block", marginTop: 4 }}>Limited tables: see Dimensional data below for the values.</Text>}
        </DetailSection>
      )}
      {APP_LEVELS.filter((l) => a.levels[l].perms.length).map((l) => (
        <DetailSection key={l} title={`${LEVEL_LABEL[l]} permissions its manifest requests (${a.levels[l].perms.filter((p) => p.status === "granted" || p.status === "scoped").length} of ${a.levels[l].perms.length} granted)`}>
          <Flex gap={6} flexWrap="wrap">
            {a.levels[l].perms.map((p) => (
              <PermPill key={p.permission} e={p} />
            ))}
          </Flex>
        </DetailSection>
      ))}
      {s.skipped.length > 0 && <Text style={{ ...hint, display: "block", marginTop: 8 }}>Not IAM policy permissions (not tested): {s.skipped.map((p) => p.permission).join(", ")}.</Text>}
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 10 }}>
      <Text style={{ ...hint, display: "block", fontWeight: 600, marginBottom: 4 }}>{title}</Text>
      {children}
    </div>
  );
}

function PermPill({ e }: { e: PermEval }) {
  const ok = e.status === "granted" || e.status === "scoped";
  const color = ok ? Colors.Text.Success.Default : e.status === "conditional" ? Colors.Text.Warning.Default : Colors.Text.Critical.Default;
  const via = e.grants[0]?.st.source;
  return (
    <span style={{ ...code, color, border: `1px solid ${color}`, background: "transparent" }} title={`${PERM_TEXT[e.status]}${via ? ` · ${via.policy} (${via.group})` : ""}${e.grants[0]?.unknown.length ? ` · ${describeUnknown(e.grants[0].unknown)}` : ""}`}>
      {ok ? "✓" : e.status === "conditional" ? "?" : "✗"} {e.permission}
    </span>
  );
}

/** The statements behind a permission's status, with their source (group, policy, boundary) and open conditions. */
function GrantList({ e, empty }: { e: PermEval; empty: string }) {
  if (!e.grants.length && !e.denies.length) return <Text style={hint}>{empty}</Text>;
  return (
    <div>
      {[...e.denies.map((g) => ({ g, deny: true })), ...e.grants.slice(0, 6).map((g) => ({ g, deny: false }))].map(({ g, deny }, i) => (
        <div key={i} style={{ padding: "3px 0", borderTop: i ? "1px solid rgba(128,128,128,0.15)" : undefined }}>
          <Text style={{ fontFamily: "monospace", fontSize: 12, wordBreak: "break-word", color: deny ? Colors.Text.Critical.Default : undefined }}>{g.st.text}</Text>
          <Text style={{ ...hint, display: "block" }}>
            {g.st.source.policy} · {g.st.source.group} · {g.st.source.level}
            {g.st.source.boundary ? ` · boundary ${g.st.source.boundary}` : ""}
            {g.unknown.length ? ` · depends on ${describeUnknown(g.unknown)}` : ""}
          </Text>
        </div>
      ))}
      {e.grants.length > 6 && <Text style={hint}>+{e.grants.length - 6} more statements</Text>}
    </div>
  );
}

// --- Dimensional data --------------------------------------------------------------------------------------------------
function DataCard({ result, tf }: { result: AccessResult; tf: Timeframe }) {
  const [view, setView] = useState<"table" | "dimension">("table");
  const [open, setOpen] = useState<string | null>(null);
  const rows = result.data;
  return (
    <div style={card}>
      <Heading level={4}>Dimensional data</Heading>
      <Text style={{ ...hint, display: "block", margin: "4px 0 10px" }}>
        Which Grail records the subject can read: per table permission, whether every record is readable, only records with certain dimension values (security
        context, host group, Kubernetes namespace, bucket, …), or none. Table permissions also need <span style={code}>storage:buckets:read</span> for the buckets that
        hold the data; both are combined here. <DocLink href={IAM_DOCS.grail.url}>Permissions in Grail</DocLink>
      </Text>
      <CoverageStrip rows={rows} onPick={(p) => (setView("table"), setOpen(p))} />
      <Flex gap={8} alignItems="center" style={{ margin: "12px 0 8px" }}>
        <ToggleButtonGroup value={view} onChange={(v: string) => v && setView(v as "table" | "dimension")} name="iam-access-data-view">
          <ToggleButtonGroup.Item value="table">By table</ToggleButtonGroup.Item>
          <ToggleButtonGroup.Item value="dimension">By dimension</ToggleButtonGroup.Item>
        </ToggleButtonGroup>
      </Flex>
      {view === "table" ? <DataTable rows={rows} open={open} onOpen={setOpen} tf={tf} /> : <DimensionView result={result} />}
    </div>
  );
}

/** One tile per table, coloured by what the subject can read; click scrolls the table to that row. */
function CoverageStrip({ rows, onPick }: { rows: DataRow[]; onPick: (permission: string) => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(118px, 1fr))", gap: 6 }}>
      {rows.map((r) => {
        const st = DATA_STATUS[r.status];
        return (
          <button
            key={r.permission}
            type="button"
            onClick={() => onPick(r.permission)}
            title={`${r.permission}: ${st.label}`}
            style={{
              textAlign: "left",
              padding: "6px 8px",
              borderRadius: 6,
              cursor: "pointer",
              color: "inherit",
              border: `1px solid ${st.border}`,
              background: r.status === "scoped" ? `repeating-linear-gradient(135deg, ${st.fill} 0 6px, transparent 6px 10px)` : r.status === "granted" ? st.fill : "transparent",
            }}
          >
            <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: r.status === "granted" ? "#fff" : undefined }}>{r.label}</span>
            <span style={{ display: "block", fontSize: 11, color: r.status === "granted" ? "#fff" : st.text }}>{st.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function PathList({ paths }: { paths: CondValue[][] }) {
  return (
    <div>
      {paths.map((p, i) => (
        <div key={i} style={{ padding: "1px 0" }}>
          {i > 0 && <span style={{ ...hint, marginRight: 4 }}>or</span>}
          {p.map((c, k) => (
            <React.Fragment key={k}>
              {k > 0 && <span style={{ ...hint, margin: "0 4px" }}>and</span>}
              <span style={{ ...code, whiteSpace: "normal", overflowWrap: "anywhere" }} title={dimensionLabel(attributeOf(c.key))}>
                {condText(c)}
              </span>
            </React.Fragment>
          ))}
        </div>
      ))}
    </div>
  );
}

function scopeOf(e: PermEval | null): React.ReactNode {
  if (!e) return <span style={hint}>no buckets</span>;
  if (e.status === "missing") return <span style={{ color: Colors.Text.Critical.Default }}>not granted</span>;
  if (e.status === "denied") return <span style={{ color: Colors.Text.Critical.Default }}>denied</span>;
  const paths = grantPaths(e);
  return paths.length ? <PathList paths={paths} /> : <span>all</span>;
}

function DataTable({ rows, open, onOpen, tf }: { rows: DataRow[]; open: string | null; onOpen: (p: string | null) => void; tf: Timeframe }) {
  const refs = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    if (open) refs.current.get(open)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [open]);
  const grid = "minmax(150px, 1.1fr) minmax(100px, 0.6fr) minmax(220px, 2.2fr) minmax(150px, 1.2fr) minmax(140px, 1.2fr)";
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth: 820 }}>
        <div style={{ display: "grid", gridTemplateColumns: grid, gap: 10, padding: "4px 6px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", opacity: 0.6 }}>
          <span>Table</span>
          <span>Can read</span>
          <span>Records limited to</span>
          <span>Buckets</span>
          <span>Granted by</span>
        </div>
        {rows.map((r) => {
          const st = DATA_STATUS[r.status];
          const paths = grantPaths(r.eval);
          const usableRow = r.status === "granted" || r.status === "scoped";
          const table = iamRecordTable(r.permission);
          const sources = [...new Set(r.eval.grants.map((g) => `${g.st.source.policy}${g.st.source.boundary ? ` + ${g.st.source.boundary}` : ""}`))];
          const query = usableRow && table ? iamVisibleRecordsQuery(tf, table, [paths, ...(r.buckets ? [grantPaths(r.buckets)] : [])]) : null;
          return (
            <div
              key={r.permission}
              ref={(el) => {
                if (el) refs.current.set(r.permission, el);
              }}
              style={{ borderTop: "1px solid rgba(128,128,128,0.18)", background: open === r.permission ? "rgba(128,128,128,0.08)" : undefined }}
            >
              <div style={{ display: "grid", gridTemplateColumns: grid, gap: 10, padding: "6px", alignItems: "start", fontSize: 13 }}>
                <span>
                  <span style={{ fontWeight: 600 }}>{r.label}</span>
                  <span style={{ ...hint, display: "block", fontFamily: "monospace" }}>{r.permission}</span>
                </span>
                <span style={{ color: st.text, fontWeight: 600 }}>
                  {st.label}
                  {r.status === "denied" && <span style={{ ...hint, display: "block", fontWeight: 400 }}>DENY wins over ALLOW</span>}
                  {r.status === "conditional" && <span style={{ ...hint, display: "block", fontWeight: 400 }}>depends on {describeUnknown(r.eval.grants[0]?.unknown ?? [])}</span>}
                  {r.buckets && !(r.buckets.status === "granted" || r.buckets.status === "scoped") && (r.eval.status === "granted" || r.eval.status === "scoped") && (
                    <span style={{ ...hint, display: "block", fontWeight: 400 }}>no bucket access</span>
                  )}
                </span>
                <span>{r.eval.status === "missing" ? <span style={hint}>—</span> : r.eval.status === "denied" ? <span style={hint}>—</span> : paths.length ? <PathList paths={paths} /> : <span>every record</span>}</span>
                <span style={{ fontSize: 12 }}>{r.permission === BUCKETS ? <span style={hint}>(this row)</span> : scopeOf(r.buckets)}</span>
                <span style={{ fontSize: 12 }}>
                  {sources.length ? sources.slice(0, 3).join("; ") : r.eval.denies.length ? `DENY in ${r.eval.denies[0].st.source.policy}` : <span style={hint}>—</span>}
                  {sources.length > 3 && <span style={hint}> +{sources.length - 3}</span>}
                  {query && (
                    <span style={{ display: "block", marginTop: 2 }}>
                      <button type="button" style={textButton} onClick={() => onOpen(open === r.permission ? null : r.permission)} aria-expanded={open === r.permission}>
                        {open === r.permission ? "Hide records query" : "Records query"}
                      </button>
                    </span>
                  )}
                </span>
              </div>
              {query && open === r.permission && (
                <div style={{ padding: "0 6px 10px" }}>
                  <Text style={{ ...hint, display: "block", marginBottom: 4 }}>
                    The records of {r.label.toLowerCase()} this subject can read in the selected timeframe, counted by the dimensions that limit them. The query runs with your
                    permissions, so it can only show records you can read too; matchesValue is case-insensitive, so it can be slightly wider than IAM.
                  </Text>
                  <QueryActions title={`Permissions Test: ${r.label} readable records`} query={query} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DimensionView({ result }: { result: AccessResult }) {
  const dims = result.dimensions;
  const unrestricted = result.data.filter((r) => r.status === "granted" && r.permission !== BUCKETS).map((r) => r.label);
  const none = result.data.filter((r) => r.status === "missing" || r.status === "denied").map((r) => r.label);
  return (
    <div>
      {unrestricted.length > 0 && (
        <Text style={{ display: "block", fontSize: 13, marginBottom: 8 }}>
          <strong style={{ color: Colors.Text.Success.Default }}>Every record</strong> (no dimension limits): {unrestricted.join(", ")}.
        </Text>
      )}
      {!dims.length && <Text style={hint}>No table is limited by dimensional data.</Text>}
      {dims.map((d) => (
        <div key={d.attr} style={{ padding: "8px 0", borderTop: "1px solid rgba(128,128,128,0.18)" }}>
          <Text style={{ fontWeight: 600, fontSize: 13 }}>
            {d.label} <span style={{ ...code, marginLeft: 4 }}>{d.attr}</span>
          </Text>
          {d.entries.map((e, i) => (
            <Flex key={i} gap={8} alignItems="baseline" flexWrap="wrap" style={{ marginTop: 4 }}>
              <span style={{ ...code, whiteSpace: "normal", overflowWrap: "anywhere" }}>{e.condition}</span>
              <Text style={{ fontSize: 12 }}>on {e.tables.join(", ")}</Text>
            </Flex>
          ))}
        </div>
      ))}
      {none.length > 0 && (
        <Text style={{ display: "block", fontSize: 12, marginTop: 8, color: Colors.Text.Critical.Default }}>No access: {none.join(", ")}.</Text>
      )}
      <Text style={{ ...hint, display: "block", marginTop: 8 }}>
        Values listed for one dimension are alternatives (any of them grants access); conditions of different dimensions in one statement must all hold; see By table for
        how they combine per table.
      </Text>
    </div>
  );
}

// --- Sources -----------------------------------------------------------------------------------------------------------
function SourcesCard({ resolved, result }: { resolved: Resolved; result: AccessResult }) {
  const [open, setOpen] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const copy = () =>
    void navigator.clipboard?.writeText(result.statements.map((s) => `${s.text}  // ${s.source.policy} · ${s.source.group}${s.source.boundary ? ` · ${s.source.boundary}` : ""}`).join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  const groups = [...new Set(resolved.bindings.map((b) => b.groupName))];
  return (
    <div style={card}>
      <Flex justifyContent="space-between" alignItems="baseline" flexWrap="wrap" gap={8}>
        <Heading level={4}>Where the access comes from</Heading>
        <Flex gap={8} alignItems="center">
          {copied && <Text style={hint}>Copied</Text>}
          <Button size="condensed" onClick={copy} disabled={!result.statements.length}>
            Copy effective statements
          </Button>
        </Flex>
      </Flex>
      {!resolved.bindings.length && (
        <Text style={{ display: "block", marginTop: 6 }}>
          No policy is bound to {resolved.subject.kind === "user" ? "this user's groups" : "this group"} on the account or in this environment, so nothing is granted.
        </Text>
      )}
      {resolved.subject.kind === "user" && resolved.subject.groups.some((g) => !groups.includes(g.name)) && (
        <Text style={{ ...hint, display: "block", marginTop: 6 }}>
          Groups without a policy here: {resolved.subject.groups.filter((g) => !groups.includes(g.name)).map((g) => g.name).join(", ")}.
        </Text>
      )}
      {resolved.bindings.map((b, i) => {
        const sts = result.statements.filter((s) => s.source.binding === i);
        return (
          <div key={i} style={{ padding: "8px 0", borderTop: "1px solid rgba(128,128,128,0.18)" }}>
            <Flex justifyContent="space-between" alignItems="flex-start" gap={8} flexWrap="wrap">
              <div style={{ minWidth: 0 }}>
                <Text style={{ fontWeight: 600, fontSize: 13 }}>{b.policy.name}</Text>
                <Text style={{ ...hint, display: "block" }}>
                  {b.levelType === "draft" ? "IAM Policy Creator" : `${b.policy.levelType === "global" ? "Dynatrace default policy" : `${b.policy.levelType} policy`} · bound to ${b.groupName} on the ${b.levelType === "account" ? "account (all environments)" : `environment ${b.levelId}`}`}
                  {b.boundaries.length ? ` · boundary ${b.boundaries.map((x) => x.name).join(", ")}` : " · no boundary"}
                  {Object.keys(b.parameters).length ? ` · parameters ${Object.entries(b.parameters).map(([k, v]) => `${k}=${v}`).join(", ")}` : ""}
                </Text>
              </div>
              <button type="button" style={textButton} onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                {open === i ? "Hide" : "Show"} {plural(sts.length, "effective statement")}
              </button>
            </Flex>
            {open === i && (
              <div style={{ marginTop: 6, maxHeight: 280, overflowY: "auto" }}>
                {b.boundaries.map((x) => (
                  <Text key={x.uuid} style={{ ...hint, display: "block", fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
                    {`// boundary ${x.name}\n${x.boundaryQuery.trim()}`}
                  </Text>
                ))}
                {sts.map((s, k) => (
                  <Text key={k} style={{ display: "block", fontFamily: "monospace", fontSize: 12, wordBreak: "break-word", color: s.effect === "DENY" ? Colors.Text.Critical.Default : undefined }}>
                    {s.text}
                    {s.source.boundary && <span style={hint}>{`  // ${s.source.boundary}`}</span>}
                  </Text>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <Text style={{ ...hint, display: "block", marginTop: 8 }}>
        Effective statements: one per permission, after bind parameters and boundaries (each boundary of a binding applied separately, as in{" "}
        <a href={`${IAM_DOCS.boundaries.url}#apply-boundary`} target="_blank" rel="noreferrer noopener" style={linkStyle}>
          How are policy boundaries applied? ↗
        </a>
        ). Classic environment roles (environment:roles:*) are listed but do not affect app access here.
      </Text>
    </div>
  );
}

// --- AI Assist -----------------------------------------------------------------------------------------------------------
function accessInsight(mode: Mode, resolved: Resolved | null, result: AccessResult | null, setup: SetupStatus | null, run: Run, appsLoaded: boolean): IamAccessInsightInput {
  const data = result?.data.filter((r) => r.permission !== BUCKETS) ?? [];
  const names = (st: PermStatus[]) => data.filter((r) => st.includes(r.status)).map((r) => r.label);
  const apps = result?.apps ?? [];
  const runAll = result?.statements.some((s) => s.effect === "ALLOW" && s.permission === "app-engine:apps:run" && !s.conditions.some((c) => c.key === "shared:app-id")) ?? false;
  return {
    mode,
    subject: resolved ? { kind: resolved.subject.kind, name: resolved.subject.name, groups: resolved.subject.groups.length } : null,
    setup: mode === "draft" ? "n/a" : setup === null ? "unknown" : setup.state,
    failure: run.status === "failed" ? run.failure.message : setup && setup.state !== "ok" ? setup.failure.message : null,
    policies: resolved ? new Set(resolved.bindings.map((b) => b.policy.uuid)).size : 0,
    boundaries: resolved ? new Set(resolved.bindings.flatMap((b) => b.boundaries.map((x) => x.uuid))).size : 0,
    statements: result?.statements.length ?? 0,
    appsLoaded,
    apps: { total: apps.length, access: apps.filter((a) => a.status === "access").length, conditional: apps.filter((a) => a.status === "conditional").length, none: apps.filter((a) => a.status === "none").length },
    conditionalApps: apps.filter((a) => a.status === "conditional").slice(0, 5).map((a) => `${a.name} (${a.reasons[0] ?? "conditional"})`),
    timeLimited: apps.filter((a) => a.run.status === "conditional").length,
    allApps: runAll,
    data: { unrestricted: names(["granted"]), limited: names(["scoped"]), conditional: names(["conditional"]), none: names(["missing"]), denied: names(["denied"]) },
    dimensions: result?.dimensions.map((d) => d.label) ?? [],
    unboundParams: result?.notes.filter((n) => n.text.includes("bindParam")).length ?? 0,
  };
}
