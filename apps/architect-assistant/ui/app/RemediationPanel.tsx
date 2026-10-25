import React, { useEffect, useMemo, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { Checkbox, FormField, Label, Select, TextInput } from "@dynatrace/strato-components/forms";
import Colors from "@dynatrace/strato-design-tokens/colors";
import Spacings from "@dynatrace/strato-design-tokens/spacings";
import Borders from "@dynatrace/strato-design-tokens/borders";
import { useDql, type DqlState } from "./useDql";
import { QueryActions, formatMode, num } from "./components";
import { hostGroupsQuery, hostsWithoutGroupQuery, oneAgentSearchQuery, ownerValuesQuery, type Timeframe } from "./queries";
import { ANY, HostGroupSelect } from "./tabs/OneAgentSearch";
import { settingsLink } from "./deepMonitoring";
import { toCoverageRows } from "./tabs/CoverageTabs";
import { usePrimaryTags } from "./primaryTags";
import { remediationAnchorId, type RemediationTab } from "./navigation";
import { useSegmentsData } from "./tabs/SegmentsTab";
import { segmentsAppLink } from "./links";
import { ClassicOwnerTagLoader } from "./tabs/ClassicOwnership";
import { SEGMENT_DOCS, convertZones, findMembership, planProblem, planSegment, ruleBasedAction, type ConvertResult, type Membership } from "./segments";
import {
  AUTO_UPDATE_VALUE,
  ENRICHMENT_DOCS,
  MAX_HOSTS_PER_JOB,
  MODE_DOCS,
  REMOTE_DOCS,
  TARGET_MODES,
  setMonitoringModes,
  buildModeBody,
  UPDATE_DOCS,
  TARGET_OPTIONS,
  TYPE_OPTIONS,
  applyAutoUpdates,
  buildEnrichmentBody,
  checkEnrichmentInput,
  checkHostGroupName,
  hostGroupManualAction,
  OWNERSHIP_DOCS,
  OWNER_TAG_DOCS,
  RESPONSIBILITY_LABELS,
  TEAM_ID_RE,
  buildTeamsBody,
  checkTeam,
  createTeams,
  emptyTeam,
  listTeams,
  ownerHostAction,
  ownerK8sAction,
  ownerProcessAction,
  teamIdentifiers,
  processTagAction,
  hostTagsAction,
  k8sAnnotationAction,
  monitoringModeAction,
  planHostGroupAssignment,
  readOneAgentUpdateSetting,
  runHostGroupAssignment,
  submitEnrichmentRule,
  typeMeta,
  updatesUiAction,
  type ContactType,
  type DocLink,
  type ExistingTeam,
  type EnrichmentInput,
  type EnrichmentTarget,
  type EnrichmentType,
  type HostGroupPlan,
  type ManualAction,
  type SubmitResult,
  type TargetMode,
  type TeamInput,
  type UpdateSetting,
} from "./remediation";

export type { RemediationTab };

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------
const box: React.CSSProperties = {
  padding: Spacings.Size16,
  borderRadius: Borders.Radius.Container.Default,
  background: Colors.Background.Container.Neutral.Default,
};
const mono: React.CSSProperties = { margin: 0, padding: 10, borderRadius: 6, background: "rgba(128,128,128,0.12)", fontSize: 12, overflowX: "auto", whiteSpace: "pre-wrap" };
const smallBtn: React.CSSProperties = { background: "rgba(128,128,128,0.08)", color: "inherit", border: "1px solid rgba(128,128,128,0.3)", borderRadius: 6, padding: "2px 8px", cursor: "pointer", fontSize: 11, fontWeight: 600 };
const hint: React.CSSProperties = { fontSize: 12, opacity: 0.7 };

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      style={smallBtn}
      onClick={() => void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

export function Links({ docs }: { docs: DocLink[] }) {
  return (
    <Flex gap={12} flexWrap="wrap">
      {docs.map((d) => (
        <a key={d.url} href={d.url} target="_blank" rel="noreferrer noopener" style={{ fontSize: 12 }}>
          ↗ {d.title}
        </a>
      ))}
    </Flex>
  );
}

export function Request({ label, text }: { label: string; text: string }) {
  return (
    <details>
      <summary style={{ cursor: "pointer", fontSize: 12, opacity: 0.8 }}>{label}</summary>
      <Flex justifyContent="flex-end" style={{ marginTop: 4 }}>
        <CopyButton text={text} />
      </Flex>
      <pre style={mono}>{text}</pre>
    </details>
  );
}

export function ResultLine({ result }: { result: SubmitResult | null }) {
  if (!result) return null;
  return (
    <div role="status" style={{ padding: "8px 12px", borderRadius: 6, borderLeft: `4px solid ${result.ok ? "#0D9C29" : "#C21930"}`, background: "rgba(128,128,128,0.06)" }}>
      <Text>{result.message}</Text>
      {result.objectId && <Text style={{ display: "block", fontSize: 11, opacity: 0.6 }}>ID: {result.objectId}</Text>}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <FormField>
      <Label>{label}</Label>
      {children}
    </FormField>
  );
}

// ---------------------------------------------------------------------------
// Manual actions: variant dropdown, short steps, notes folded away
// ---------------------------------------------------------------------------
export function ManualActionView({ action }: { action: ManualAction }) {
  const [vi, setVi] = useState("0");
  const variant = action.variants[Number(vi)] ?? action.variants[0];
  return (
    <Flex flexDirection="column" gap={12}>
      {action.variants.length > 1 && (
        <Field label="Variant">
          <Select value={vi} onChange={(v: string | null) => v && setVi(v)}>
            <Select.Content>
              {action.variants.map((v, i) => (
                <Select.Option key={v.label} value={String(i)}>
                  {v.label}
                </Select.Option>
              ))}
            </Select.Content>
          </Select>
        </Field>
      )}
      {variant && (
        <div>
          <Flex justifyContent="flex-end">
            <CopyButton text={variant.code} />
          </Flex>
          <pre style={mono}>{variant.code}</pre>
        </div>
      )}
      <ol style={{ margin: 0, paddingLeft: 18 }}>
        {action.steps.map((s, i) => (
          <li key={i}>
            <Text>{s}</Text>
          </li>
        ))}
      </ol>
      {action.notes && (
        <details>
          <summary style={{ cursor: "pointer", fontSize: 12, opacity: 0.8 }}>Notes</summary>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {action.notes.map((n, i) => (
              <li key={i}>
                <Text style={hint}>{n}</Text>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Flex>
  );
}

// ---------------------------------------------------------------------------
// API: central ingest enrichment rule (one POST, applies to every matching entity)
// ---------------------------------------------------------------------------
type Applies = "all" | "pattern" | "dql";

type TargetOption = { value: EnrichmentTarget; label: string };

function EnrichmentRuleForm({ targets }: { targets: TargetOption[] }) {
  const [input, setInput] = useState<EnrichmentInput>({ type: "CUSTOM", target: targets[0]?.value ?? "", valueSource: "", condition: "" });
  const [applies, setApplies] = useState<Applies>("all");
  const [pattern, setPattern] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const meta = typeMeta(input.type);

  const effective: EnrichmentInput = useMemo(() => {
    const condition = !meta.supportsCondition || applies === "all" ? "" : applies === "pattern" ? (pattern.trim() ? `matchesValue(host.name, "${pattern.trim()}")` : "") : input.condition;
    return { ...input, condition };
  }, [input, applies, pattern, meta.supportsCondition]);
  const problem = checkEnrichmentInput(effective) ?? (meta.supportsCondition && applies === "pattern" && !pattern.trim() ? "Enter a host name pattern." : null);
  const body = useMemo(() => JSON.stringify(buildEnrichmentBody(effective), null, 2), [effective]);
  const targetOptions = targets;
  if (targets.length === 0) return <Text style={hint}>Add a primary tag name on this tab first; the rule writes to primary_tags.&lt;name&gt;.</Text>;

  const touch = () => {
    setResult(null);
    setConfirm(false);
  };
  const run = async (validateOnly: boolean) => {
    setBusy(true);
    setResult(await submitEnrichmentRule(effective, validateOnly));
    setBusy(false);
    if (!validateOnly) setConfirm(false);
  };

  return (
    <Flex flexDirection="column" gap={12}>
      <Flex gap={16} flexWrap="wrap" alignItems="flex-end">
        {targetOptions.length > 1 && (
          <Field label="Field">
            <Select value={input.target} onChange={(v: EnrichmentTarget | null) => { if (v) { setInput((p) => ({ ...p, target: v })); touch(); } }}>
              <Select.Content>
                {targetOptions.map((t) => (
                  <Select.Option key={t.value} value={t.value}>
                    {t.label}
                  </Select.Option>
                ))}
              </Select.Content>
            </Select>
          </Field>
        )}
        <Field label="Source">
          <Select value={input.type} onChange={(v: EnrichmentType | null) => { if (v) { setInput((p) => ({ ...p, type: v })); touch(); } }}>
            <Select.Content>
              {TYPE_OPTIONS.map((t) => (
                <Select.Option key={t.value} value={t.value}>
                  {t.label}
                </Select.Option>
              ))}
            </Select.Content>
          </Select>
        </Field>
        {meta.supportsCondition && (
          <Field label="Applies to">
            <Select value={applies} onChange={(v: Applies | null) => { if (v) { setApplies(v); touch(); } }}>
              <Select.Content>
                <Select.Option value="all">All hosts / processes</Select.Option>
                <Select.Option value="pattern">Host name pattern</Select.Option>
                <Select.Option value="dql">Custom condition</Select.Option>
              </Select.Content>
            </Select>
          </Field>
        )}
      </Flex>
      <Flex gap={16} flexWrap="wrap">
        <Field label={meta.sourceLabel}>
          <TextInput value={input.valueSource} placeholder={meta.sourcePlaceholder} onChange={(v: string) => { setInput((p) => ({ ...p, valueSource: v })); touch(); }} />
        </Field>
        {meta.supportsCondition && applies === "pattern" && (
          <Field label="Host name pattern">
            <TextInput value={pattern} placeholder="prod-*" onChange={(v: string) => { setPattern(v); touch(); }} />
          </Field>
        )}
        {meta.supportsCondition && applies === "dql" && (
          <Field label="Condition">
            <TextInput value={input.condition} placeholder='matchesValue(host.name, "prod-*")' onChange={(v: string) => { setInput((p) => ({ ...p, condition: v })); touch(); }} />
          </Field>
        )}
      </Flex>
      <Request label="Request (1 API call, environment scope)" text={body} />
      {problem && input.valueSource.length > 0 && <Text style={{ color: "#C21930" }}>{problem}</Text>}
      <Checkbox value={confirm} onChange={(v: boolean) => setConfirm(v)}>
        Create this rule in the tenant
      </Checkbox>
      <Flex gap={8}>
        <Button variant="default" disabled={!!problem || busy} onClick={() => void run(true)}>
          Validate
        </Button>
        <Button variant="emphasized" disabled={!!problem || busy || !confirm} onClick={() => void run(false)}>
          Create rule
        </Button>
      </Flex>
      <ResultLine result={result} />
      <Text style={hint}>One rule covers every matching entity. OneAgent applies it in ~5 min; Kubernetes pods need a restart.</Text>
    </Flex>
  );
}

// ---------------------------------------------------------------------------
// API: host group assignment (OneAgent remote configuration; ONE job for all hosts)
// ---------------------------------------------------------------------------
type HostRow = { id: string; name?: string; cloud?: string; os?: string; k8s?: string };

function HostGroupAssign({ hosts, groups, tf }: { hosts: HostRow[]; groups: string[]; tf: Timeframe }) {
  const [group, setGroup] = useState<string>(groups[0] ?? "__new__");
  const [newName, setNewName] = useState("");
  const [targetKey, setTargetKey] = useState("all");
  const [restart, setRestart] = useState("yes");
  const [plan, setPlan] = useState<HostGroupPlan | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  // Target dropdown: all, by cloud provider, by OS, by Kubernetes cluster.
  const targets = useMemo(() => {
    const out: { key: string; label: string; ids: string[] }[] = [{ key: "all", label: `All hosts without a group (${hosts.length})`, ids: hosts.map((h) => h.id) }];
    const add = (prefix: string, title: string, pick: (h: HostRow) => string | undefined) => {
      const m = new Map<string, string[]>();
      hosts.forEach((h) => {
        const k = pick(h);
        if (k) m.set(k, [...(m.get(k) ?? []), h.id]);
      });
      m.forEach((ids, k) => out.push({ key: `${prefix}:${k}`, label: `${title}: ${k} (${ids.length})`, ids }));
    };
    add("cloud", "Cloud", (h) => h.cloud);
    add("os", "OS", (h) => h.os?.replace("OS_TYPE_", ""));
    add("k8s", "Kubernetes cluster", (h) => h.k8s);
    return out;
  }, [hosts]);
  const selected = targets.find((t) => t.key === targetKey) ?? targets[0];
  const groupName = group === "__new__" ? newName : group;
  const nameProblem = checkHostGroupName(groupName);
  const ids = selected.ids.slice(0, MAX_HOSTS_PER_JOB);

  const reset = () => {
    setPlan(null);
    setResult(null);
    setConfirm(false);
  };
  const doPlan = async () => {
    setBusy(true);
    reset();
    setPlan(await planHostGroupAssignment(ids, groupName));
    setBusy(false);
  };
  const doRun = async () => {
    if (!plan) return;
    setBusy(true);
    setResult(await runHostGroupAssignment(plan.valid, groupName, restart === "yes"));
    setConfirm(false);
    setBusy(false);
  };
  const reasons = useMemo(() => {
    const m = new Map<string, number>();
    plan?.invalid.forEach((i) => i.reasons.forEach((r) => m.set(r, (m.get(r) ?? 0) + 1)));
    return Array.from(m.entries()).map(([r, n]) => `${r.replace(/_/g, " ").toLowerCase()} (${n})`).join(", ");
  }, [plan]);
  const body = JSON.stringify({ entities: [`${ids.length} host IDs`], operations: [{ attribute: "hostGroup", operation: "set", value: groupName.trim() || "<name>" }] }, null, 2);

  return (
    <Flex flexDirection="column" gap={12}>
      <Flex gap={16} flexWrap="wrap" alignItems="flex-end">
        <Field label="Host group">
          <Select value={group} onChange={(v: string | null) => { if (v) { setGroup(v); reset(); } }}>
            <Select.Content>
              {groups.map((g) => (
                <Select.Option key={g} value={g}>
                  {g}
                </Select.Option>
              ))}
              <Select.Option value="__new__">New host group…</Select.Option>
            </Select.Content>
          </Select>
        </Field>
        {group === "__new__" && (
          <Field label="New name">
            <TextInput value={newName} placeholder="e.g. prod-web" onChange={(v: string) => { setNewName(v); reset(); }} />
          </Field>
        )}
        <Field label="Hosts">
          <Select value={targetKey} onChange={(v: string | null) => { if (v) { setTargetKey(v); reset(); } }}>
            <Select.Content>
              {targets.map((t) => (
                <Select.Option key={t.key} value={t.key}>
                  {t.label}
                </Select.Option>
              ))}
            </Select.Content>
          </Select>
        </Field>
        <Field label="OneAgent restart">
          <Select value={restart} onChange={(v: string | null) => v && setRestart(v)}>
            <Select.Content>
              <Select.Option value="yes">Restart automatically</Select.Option>
              <Select.Option value="no">Don't restart</Select.Option>
            </Select.Content>
          </Select>
        </Field>
      </Flex>
      <QueryActions title="Hosts without a host group" query={hostsWithoutGroupQuery(tf)} />
      <Request label={`Request (1 job for ${ids.length} hosts)`} text={body} />
      {nameProblem && groupName.length > 0 && <Text style={{ color: "#C21930" }}>{nameProblem}</Text>}
      <Flex gap={8}>
        <Button variant="default" disabled={!!nameProblem || busy || ids.length === 0} onClick={() => void doPlan()}>
          Validate &amp; preview
        </Button>
      </Flex>
      {plan && (
        <div role="status" style={{ padding: "8px 12px", borderRadius: 6, borderLeft: `4px solid ${plan.ok ? "#0D9C29" : "#C21930"}`, background: "rgba(128,128,128,0.06)" }}>
          <Text style={{ display: "block" }}>{plan.message}</Text>
          {plan.preview && (
            <Text style={{ display: "block", ...hint }}>
              Preview: {plan.preview.alreadyConfigured} already in this group, {plan.preview.target} after the job.
            </Text>
          )}
          {reasons && <Text style={{ display: "block", ...hint }}>Skipped: {reasons}</Text>}
          <Text style={{ display: "block", ...hint }}>{plan.apiCalls} API calls used so far; running the job adds 1.</Text>
        </div>
      )}
      {plan?.ok && (
        <>
          <Checkbox value={confirm} onChange={(v: boolean) => setConfirm(v)}>
            Assign "{groupName.trim()}" to {plan.valid.length} hosts (changes process group IDs)
          </Checkbox>
          <Flex gap={8}>
            <Button variant="emphasized" disabled={busy || !confirm} onClick={() => void doRun()}>
              Assign host group
            </Button>
          </Flex>
        </>
      )}
      <ResultLine result={result} />
      <Text style={hint}>Takes up to 10 min; restart monitored processes afterwards. Operator-deployed OneAgents are skipped; only one job can run at a time.</Text>
    </Flex>
  );
}

/** Loads hosts + existing groups only after the user asks, so no query runs until needed. */
function HostGroupAssignLoader({ tf }: { tf: Timeframe }) {
  const [load, setLoad] = useState(false);
  if (!load)
    return (
      <Flex flexDirection="column" gap={8}>
        <Text style={hint}>Lists hosts without a host group (up to {MAX_HOSTS_PER_JOB}) and existing groups.</Text>
        <div>
          <Button variant="default" onClick={() => setLoad(true)}>
            Load hosts
          </Button>
        </div>
      </Flex>
    );
  return <HostGroupData tf={tf} />;
}

function HostGroupData({ tf }: { tf: Timeframe }) {
  const hostsState = useDql(hostsWithoutGroupQuery(tf));
  const groupsState = useDql(hostGroupsQuery(tf));
  if (hostsState.error || groupsState.error) return <Text style={{ color: "#C21930" }}>{hostsState.error ?? groupsState.error}</Text>;
  if (!hostsState.data || !groupsState.data) return <Text>Loading hosts…</Text>;
  const hosts: HostRow[] = hostsState.data.records.map((r) => ({ id: String(r.id), name: r.name, cloud: r["cloud.provider"], os: r["os.type"], k8s: r["k8s.cluster.name"] }));
  const groups = groupsState.data.records.map((r) => r.hostGroup).filter((g): g is string => !!g);
  if (hosts.length === 0) return <Text>Every host already has a host group.</Text>;
  return <HostGroupAssign hosts={hosts} groups={groups} tf={tf} />;
}

// ---------------------------------------------------------------------------
// API: change OneAgent monitoring mode (builtin:host.monitoring.mode). One POST for all selected hosts.
// ---------------------------------------------------------------------------
function MonitoringModeForm({ tf }: { tf: Timeframe }) {
  const [target, setTarget] = useState<TargetMode>("FULL_STACK");
  const [current, setCurrent] = useState(ANY);
  const [hostGroup, setHostGroup] = useState(ANY);
  const [name, setName] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const reset = () => setQuery(null);
  return (
    <Flex flexDirection="column" gap={12}>
      <Flex gap={16} flexWrap="wrap" alignItems="flex-end">
        <Field label="Change to">
          <Select value={target} onChange={(v: TargetMode | null) => v && setTarget(v)}>
            <Select.Content>
              {TARGET_MODES.map((m) => (
                <Select.Option key={m.value} value={m.value}>
                  {m.label}
                </Select.Option>
              ))}
            </Select.Content>
          </Select>
        </Field>
        <Field label="Hosts currently in">
          <Select value={current} onChange={(v: string | null) => { if (v) { setCurrent(v); reset(); } }}>
            <Select.Content>
              <Select.Option value={ANY}>Any mode</Select.Option>
              {TARGET_MODES.map((m) => (
                <Select.Option key={m.observed} value={m.observed}>
                  {m.label}
                </Select.Option>
              ))}
            </Select.Content>
          </Select>
        </Field>
        <Field label="Host group">
          <HostGroupSelect tf={tf} value={hostGroup} onChange={(v) => { setHostGroup(v); reset(); }} />
        </Field>
        <Field label="Host name contains">
          <TextInput value={name} placeholder="e.g. ip-172" onChange={(v: string) => { setName(v); reset(); }} />
        </Field>
        <Button
          variant="default"
          onClick={() => setQuery(oneAgentSearchQuery(tf, { name: name.trim(), version: "", mode: current === ANY ? "" : current, hostGroup: hostGroup === ANY ? "" : hostGroup }))}
        >
          Find hosts
        </Button>
      </Flex>
      {settingsLink("builtin:host.monitoring.mode") && (
        <a href={settingsLink("builtin:host.monitoring.mode")} target="_blank" rel="noreferrer noopener" style={{ fontSize: 12 }}>
          ↗ Open the host monitoring mode settings (change one host in the UI: Host settings &gt; Host monitoring)
        </a>
      )}
      {query && <ModeTargets key={`${query}|${target}`} query={query} target={target} />}
    </Flex>
  );
}

function ModeTargets({ query, target }: { query: string; target: TargetMode }) {
  const state = useDql(query);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const meta = TARGET_MODES.find((m) => m.value === target) ?? TARGET_MODES[0];
  // Hosts already in the target mode are skipped.
  const hosts = useMemo(
    () => (state.data?.records ?? []).filter((r) => String(r.mode ?? "") !== meta.observed).map((r) => ({ id: String(r.id), name: String(r.name ?? ""), mode: formatMode(r.mode) })),
    [state.data, meta.observed],
  );
  const ids = useMemo(() => hosts.map((h) => h.id), [hosts]);
  const sample = useMemo(() => JSON.stringify(buildModeBody(ids.slice(0, 2), target), null, 2) + (ids.length > 2 ? `\n// … ${ids.length - 2} more objects in the same request` : ""), [ids, target]);
  const run = async (validateOnly: boolean) => {
    setBusy(true);
    const r = await setMonitoringModes(ids, target, validateOnly);
    setResult(r);
    setBusy(false);
    if (!validateOnly) setConfirm(false);
  };
  if (state.error) return <Text style={{ color: "#C21930" }}>{state.error}</Text>;
  if (!state.data) return <Text>Finding hosts…</Text>;
  return (
    <Flex flexDirection="column" gap={12}>
      {hosts.length === 0 ? (
        <Text>No matching hosts need a change (hosts already in {meta.label} are skipped).</Text>
      ) : (
        <>
          <Text>
            {hosts.length} {hosts.length === 1 ? "host" : "hosts"} will move to <strong>{meta.label}</strong>
            {state.data.records.length > hosts.length ? ` (${state.data.records.length - hosts.length} already in ${meta.label} skipped)` : ""}.
          </Text>
          <details>
            <summary style={{ cursor: "pointer", fontSize: 12, opacity: 0.8 }}>Show hosts</summary>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18, maxHeight: 180, overflowY: "auto" }}>
              {hosts.map((h) => (
                <li key={h.id}>
                  <Text style={hint}>
                    {h.name} — now {h.mode}
                  </Text>
                  {settingsLink("builtin:host.monitoring.mode", h.id) && (
                    <a href={settingsLink("builtin:host.monitoring.mode", h.id)} target="_blank" rel="noreferrer noopener" style={{ fontSize: 12, marginLeft: 8 }}>
                      Monitoring mode settings ↗
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </details>
          <Request label={`Request (1 API call for ${hosts.length} ${hosts.length === 1 ? "host" : "hosts"})`} text={sample} />
          <Text style={hint}>
            Each higher mode adds capabilities and license consumption. Hosts apply the change when connected, processes pick it up after a restart, and the agent overwrites it if the mode is changed with oneagentctl.
          </Text>
          <Checkbox value={confirm} onChange={(v: boolean) => setConfirm(v)}>
            Change the monitoring mode of {hosts.length} {hosts.length === 1 ? "host" : "hosts"} to {meta.label}
          </Checkbox>
          <Flex gap={8}>
            <Button variant="default" disabled={busy} onClick={() => void run(true)}>
              Validate
            </Button>
            <Button variant="emphasized" disabled={busy || !confirm} onClick={() => void run(false)}>
              Change mode
            </Button>
          </Flex>
        </>
      )}
      <ResultLine result={result} />
      <QueryActions title="Hosts for monitoring mode change" query={query} />
    </Flex>
  );
}

// ---------------------------------------------------------------------------
// API: OneAgent auto-update policy (environment scope)
// ---------------------------------------------------------------------------
function AutoUpdateForm() {
  const [current, setCurrent] = useState<UpdateSetting | null | undefined>(undefined);
  const [readError, setReadError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    readOneAgentUpdateSetting()
      .then((s) => !cancelled && setCurrent(s))
      .catch((e) => {
        if (cancelled) return;
        setCurrent(null);
        setReadError((e as any)?.message ?? String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isAuto = current?.updateMode === "AUTOMATIC";
  const run = async (validateOnly: boolean) => {
    setBusy(true);
    const r = await applyAutoUpdates(current ?? null, validateOnly);
    setResult(r);
    if (r.ok && !validateOnly) {
      setCurrent((c) => ({ objectId: r.objectId ?? c?.objectId ?? "", updateMode: "AUTOMATIC", targetVersion: "latest" }));
      setConfirm(false);
    }
    setBusy(false);
  };
  const body = JSON.stringify({ schemaId: "builtin:deployment.oneagent.updates", scope: "environment", value: AUTO_UPDATE_VALUE }, null, 2);

  return (
    <Flex flexDirection="column" gap={12}>
      <Text>
        Current policy:{" "}
        <strong>{current === undefined ? "reading…" : current ? `${current.updateMode}, target ${current.targetVersion}` : "unknown"}</strong>
      </Text>
      {readError && <Text style={{ color: "#C21930" }}>Could not read the setting: {readError}</Text>}
      <Request label={`Request (${current ? "PUT" : "POST"}, 1 API call)`} text={body} />
      {isAuto ? (
        <Text>Automatic updates are already on.</Text>
      ) : (
        <>
          <Checkbox value={confirm} onChange={(v: boolean) => setConfirm(v)}>
            Switch the whole environment to automatic updates
          </Checkbox>
          <Flex gap={8}>
            <Button variant="default" disabled={busy || current === undefined} onClick={() => void run(true)}>
              Validate
            </Button>
            <Button variant="emphasized" disabled={busy || !confirm || current === undefined} onClick={() => void run(false)}>
              Apply
            </Button>
          </Flex>
        </>
      )}
      <ResultLine result={result} />
    </Flex>
  );
}

// ---------------------------------------------------------------------------
// API: ownership teams (builtin:ownership.teams). Always one POST, however many teams.
// ---------------------------------------------------------------------------
export function useExistingTeams() {
  const [teams, setTeams] = useState<ExistingTeam[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    listTeams()
      .then((t) => !cancelled && setTeams(t))
      .catch((e) => {
        if (cancelled) return;
        setTeams([]);
        setError((e as any)?.message ?? String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return { teams, error, reload: () => listTeams().then(setTeams).catch(() => undefined) };
}

const toIdentifier = (name: string) =>
  name
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 100);

/** Create one new team from scratch. */
function TeamCreateForm() {
  const { teams, error: readError, reload } = useExistingTeams();
  const [team, setTeam] = useState<TeamInput>(emptyTeam());
  const [idEdited, setIdEdited] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const existingIds = useMemo(() => teamIdentifiers(teams ?? []), [teams]);
  const problem = checkTeam(team, existingIds);
  const body = useMemo(() => JSON.stringify(buildTeamsBody([team]), null, 2), [team]);
  const touch = () => {
    setResult(null);
    setConfirm(false);
  };
  const patch = (p: Partial<TeamInput>) => {
    setTeam((t) => ({ ...t, ...p }));
    touch();
  };
  const run = async (validateOnly: boolean) => {
    setBusy(true);
    const r = await createTeams([team], validateOnly);
    setResult(r);
    setBusy(false);
    if (r.ok && !validateOnly) {
      setConfirm(false);
      setTeam(emptyTeam());
      setIdEdited(false);
      void reload();
    }
  };
  return (
    <Flex flexDirection="column" gap={12}>
      {readError && <Text style={{ color: "#C21930" }}>Could not read existing teams: {readError}</Text>}
      <Flex gap={16} flexWrap="wrap">
        <Field label="Team name">
          <TextInput
            value={team.name}
            placeholder="e.g. Team Checkout"
            onChange={(v: string) => {
              patch({ name: v, ...(idEdited ? {} : { identifier: toIdentifier(v) }) });
            }}
          />
        </Field>
        <Field label="Identifier (cannot be changed later)">
          <TextInput
            value={team.identifier}
            placeholder="e.g. team-checkout"
            onChange={(v: string) => {
              setIdEdited(true);
              patch({ identifier: v });
            }}
          />
        </Field>
      </Flex>
      <Field label="Description (optional)">
        <TextInput value={team.description} placeholder="What the team owns" onChange={(v: string) => patch({ description: v })} />
      </Field>
      <Flex gap={16} flexWrap="wrap" alignItems="flex-end">
        <Field label="Contact">
          <Select value={team.contactType} onChange={(v: ContactType | null) => v && patch({ contactType: v, contact: "" })}>
            <Select.Content>
              <Select.Option value="NONE">No contact</Select.Option>
              <Select.Option value="EMAIL">Email</Select.Option>
              <Select.Option value="SLACK">Slack channel</Select.Option>
            </Select.Content>
          </Select>
        </Field>
        {team.contactType !== "NONE" && (
          <Field label={team.contactType === "EMAIL" ? "Email address" : "Slack channel"}>
            <TextInput value={team.contact} placeholder={team.contactType === "EMAIL" ? "team@example.com" : "#team-channel"} onChange={(v: string) => patch({ contact: v })} />
          </Field>
        )}
      </Flex>
      <Flex gap={16} flexWrap="wrap">
        {RESPONSIBILITY_LABELS.map((r) => (
          <Checkbox key={r.key} value={team.responsibilities[r.key]} onChange={(v: boolean) => patch({ responsibilities: { ...team.responsibilities, [r.key]: v } })}>
            {r.label}
          </Checkbox>
        ))}
      </Flex>
      <Request label="Request (1 API call, environment scope)" text={body} />
      {problem && (team.name || team.identifier) && <Text style={{ color: "#C21930" }}>{problem}</Text>}
      <Checkbox value={confirm} onChange={(v: boolean) => setConfirm(v)}>
        Create this team in the tenant
      </Checkbox>
      <Flex gap={8}>
        <Button variant="default" disabled={!!problem || busy || teams === null} onClick={() => void run(true)}>
          Validate
        </Button>
        <Button variant="emphasized" disabled={!!problem || busy || !confirm || teams === null} onClick={() => void run(false)}>
          Create team
        </Button>
      </Flex>
      <ResultLine result={result} />
    </Flex>
  );
}

type OwnerValue = { value: string; entities: number };

/** Find ownership values already in use on entities that have no matching team, and create them in one call. */
function MissingTeams({ tf }: { tf: Timeframe }) {
  const [load, setLoad] = useState(false);
  if (!load)
    return (
      <Flex flexDirection="column" gap={8}>
        <Text style={hint}>Looks at the owner labels and properties in use on entities and lists values that have no team yet.</Text>
        <div>
          <Button variant="default" onClick={() => setLoad(true)}>
            Find missing teams
          </Button>
        </div>
      </Flex>
    );
  return <MissingTeamsData tf={tf} />;
}

function MissingTeamsData({ tf }: { tf: Timeframe }) {
  const state = useDql(ownerValuesQuery(tf));
  const { teams, error: readError, reload } = useExistingTeams();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);

  const missing = useMemo<OwnerValue[]>(() => {
    if (!state.data || teams === null) return [];
    const known = new Set(teamIdentifiers(teams));
    return state.data.records.map((r) => ({ value: String(r.ownerValue), entities: num(r.entities) })).filter((o) => !known.has(o.value));
  }, [state.data, teams]);
  const valid = (v: string) => TEAM_ID_RE.test(v);
  const chosen = missing.filter((m) => selected[m.value] && valid(m.value));
  const inputs = useMemo(() => chosen.map((m) => emptyTeam(m.value)), [chosen]);
  const body = useMemo(() => JSON.stringify(buildTeamsBody(inputs), null, 2), [inputs]);
  const run = async (validateOnly: boolean) => {
    setBusy(true);
    const r = await createTeams(inputs, validateOnly);
    setResult(r);
    setBusy(false);
    if (r.ok && !validateOnly) {
      setConfirm(false);
      setSelected({});
      void reload();
    }
  };

  if (state.error) return <Text style={{ color: "#C21930" }}>{state.error}</Text>;
  if (!state.data || teams === null) return <Text>Looking for owner values…</Text>;
  return (
    <Flex flexDirection="column" gap={12}>
      {readError && <Text style={{ color: "#C21930" }}>Could not read existing teams: {readError}</Text>}
      {missing.length === 0 ? (
        <Text>Every ownership value in use already matches a team.</Text>
      ) : (
        <>
          <Text>
            {missing.length} ownership {missing.length === 1 ? "value has" : "values have"} no matching team. Tick the ones to create; each becomes a team whose name and identifier are the value.
          </Text>
          <Flex gap={8}>
            <Button variant="default" size="condensed" onClick={() => setSelected(Object.fromEntries(missing.filter((m) => valid(m.value)).map((m) => [m.value, true])))}>
              Select all
            </Button>
            <Button variant="default" size="condensed" onClick={() => setSelected({})}>
              Clear
            </Button>
          </Flex>
          <Flex flexDirection="column" gap={4}>
            {missing.map((m) => (
              <Checkbox
                key={m.value}
                value={!!selected[m.value]}
                disabled={!valid(m.value)}
                onChange={(v: boolean) => {
                  setSelected((s) => ({ ...s, [m.value]: v }));
                  setResult(null);
                  setConfirm(false);
                }}
              >
                {m.value} — {m.entities.toLocaleString()} {m.entities === 1 ? "entity" : "entities"}
                {!valid(m.value) ? " (not a valid team identifier)" : ""}
              </Checkbox>
            ))}
          </Flex>
          <Request label={`Request (1 API call for ${inputs.length} ${inputs.length === 1 ? "team" : "teams"})`} text={body} />
          <Checkbox value={confirm} onChange={(v: boolean) => setConfirm(v)} disabled={inputs.length === 0}>
            Create {inputs.length} {inputs.length === 1 ? "team" : "teams"} in the tenant
          </Checkbox>
          <Flex gap={8}>
            <Button variant="default" disabled={busy || inputs.length === 0} onClick={() => void run(true)}>
              Validate
            </Button>
            <Button variant="emphasized" disabled={busy || inputs.length === 0 || !confirm} onClick={() => void run(false)}>
              Create teams
            </Button>
          </Flex>
        </>
      )}
      <ResultLine result={result} />
      <QueryActions title="Ownership values in use" query={ownerValuesQuery(tf)} />
    </Flex>
  );
}

// ---------------------------------------------------------------------------
// API: convert management zones to segments (lookup upload + segment create/update per zone)
// ---------------------------------------------------------------------------
type ZoneScope = "missing" | "managed" | "all";
type MembershipPreview = { memberships: Membership[]; queries: string[]; types: number };

function MzConvertForm({ tf }: { tf: Timeframe }) {
  const { zones, reload } = useSegmentsData();
  const [scope, setScope] = useState<ZoneScope>("missing");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [isPublic, setIsPublic] = useState(true);
  const [preview, setPreview] = useState<MembershipPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<ConvertResult[] | null>(null);

  const candidates = useMemo(
    () =>
      (zones ?? [])
        .filter((z) => (scope === "missing" ? !z.segment : scope === "managed" ? z.managed : true))
        .filter((z) => !search || z.name.toLowerCase().includes(search.toLowerCase())),
    [zones, scope, search],
  );
  const chosen = candidates.filter((z) => selected[z.name]);
  const zoneByName = useMemo(() => new Map((zones ?? []).map((z) => [z.name, z])), [zones]);
  const existing = useMemo(() => new Map((zones ?? []).filter((z) => z.managed && z.segment).map((z) => [z.name, z.segment!])), [zones]);

  const rows = useMemo(
    () =>
      (preview?.memberships ?? []).map((m) => {
        const zone = zoneByName.get(m.zone);
        const problem = planProblem(m, zone?.segment);
        return { m, zone, problem, plan: problem ? null : planSegment(m, isPublic) };
      }),
    [preview, zoneByName, isPublic],
  );
  const plans = rows.flatMap((r) => (r.plan ? [r.plan] : []));
  const sample = useMemo(() => {
    const p = plans[0];
    if (!p) return "";
    const ids = p.lookup.ids;
    const lookup = { ...p.lookup, ids: ids.length > 3 ? [...ids.slice(0, 3), `… ${ids.length - 3} more`] : ids };
    return `// 1) POST lookup:upload  filePath ${p.path}\n${JSON.stringify(lookup, null, 2)}\n\n// 2) ${existing.has(p.zone) ? "PUT" : "POST"} filter-segments\n${JSON.stringify(p.body, null, 2)}`;
  }, [plans, existing]);

  const reset = () => {
    setPreview(null);
    setResults(null);
    setConfirm(false);
    setError(null);
  };
  const find = async () => {
    setBusy(true);
    reset();
    try {
      setPreview(await findMembership(tf, chosen.map((z) => z.name)));
    } catch (e) {
      setError((e as any)?.message ?? String(e));
    }
    setBusy(false);
  };
  const run = async () => {
    setBusy(true);
    setProgress(0);
    setResults(await convertZones(plans, existing, setProgress));
    setConfirm(false);
    setBusy(false);
    reload();
  };

  if (!zones) return <Text>Loading management zones…</Text>;
  const creates = plans.filter((p) => !existing.has(p.zone)).length;
  const updates = plans.length - creates;
  return (
    <Flex flexDirection="column" gap={12}>
      <Flex gap={16} flexWrap="wrap" alignItems="flex-end">
        <Field label="Management zones">
          <Select value={scope} onChange={(v: ZoneScope | null) => { if (v) { setScope(v); setSelected({}); reset(); } }}>
            <Select.Content>
              <Select.Option value="missing">Without a segment</Select.Option>
              <Select.Option value="managed">Converted by this app (refresh)</Select.Option>
              <Select.Option value="all">All</Select.Option>
            </Select.Content>
          </Select>
        </Field>
        <Field label="Name contains">
          <TextInput value={search} placeholder="e.g. Cloud" onChange={(v: string) => setSearch(v)} />
        </Field>
        <Checkbox value={isPublic} onChange={(v: boolean) => { setIsPublic(v); setConfirm(false); }}>
          Visible to everyone (public)
        </Checkbox>
      </Flex>
      {candidates.length === 0 ? (
        <Text>{scope === "missing" ? "Every management zone already has a segment with the same name." : "No management zones match."}</Text>
      ) : (
        <>
          <Flex gap={8}>
            <Button variant="default" size="condensed" onClick={() => { setSelected(Object.fromEntries(candidates.map((z) => [z.name, true]))); reset(); }}>
              Select all ({candidates.length})
            </Button>
            <Button variant="default" size="condensed" onClick={() => { setSelected({}); reset(); }}>
              Clear
            </Button>
          </Flex>
          <Flex flexDirection="column" gap={4} style={{ maxHeight: 220, overflowY: "auto" }}>
            {candidates.map((z) => (
              <Checkbox key={z.objectId || z.name} value={!!selected[z.name]} onChange={(v: boolean) => { setSelected((s) => ({ ...s, [z.name]: v })); reset(); }}>
                {z.name}
                {z.managed ? " (refresh)" : z.segment ? " (segment exists, not created by this app)" : ""}
                {z.ruleTypes.DIMENSION > 0 ? ` — ${z.ruleTypes.DIMENSION} dimension ${plural(z.ruleTypes.DIMENSION, "rule")} not convertible` : ""}
              </Checkbox>
            ))}
          </Flex>
          <div>
            <Button variant="default" disabled={busy || chosen.length === 0} onClick={() => void find()}>
              {busy && !preview ? "Finding entities…" : `Find entities (${chosen.length})`}
            </Button>
          </div>
        </>
      )}
      {error && <Text style={{ color: "#C21930" }}>{error}</Text>}
      {preview && (
        <>
          <Text style={hint}>
            Searched {preview.types} entity types in {preview.queries.length} {plural(preview.queries.length, "query", "queries")} (entities seen in the selected timeframe).
          </Text>
          <Flex flexDirection="column" gap={8}>
            {rows.map(({ m, zone, problem, plan }) => (
              <div key={m.zone} style={{ padding: "8px 12px", borderRadius: 6, borderLeft: `4px solid ${problem ? "#C21930" : "#0D9C29"}`, background: "rgba(128,128,128,0.06)" }}>
                <Text style={{ display: "block", fontWeight: 600 }}>
                  {m.zone} — {problem ? "skipped" : existing.has(m.zone) ? "refresh (same segment UID)" : "create"}
                </Text>
                <Text style={{ display: "block", ...hint }}>
                  {m.ids.length.toLocaleString()} {plural(m.ids.length, "entity", "entities")}
                  {m.smartscapeIds.length ? ` + ${m.smartscapeIds.length.toLocaleString()} Smartscape IDs` : ""}
                  {Object.keys(m.byType).length ? `: ${Object.entries(m.byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(", ")}` : ""}
                </Text>
                {problem && <Text style={{ display: "block", ...hint, color: "#C21930" }}>{problem}</Text>}
                {plan && <Text style={{ display: "block", ...hint }}>Includes: {plan.includes.map((i) => `${i.dataObject} (${i.fields.length})`).join(", ")}</Text>}
                {plan && plan.dropped.length > 0 && <Text style={{ display: "block", ...hint, color: "#C21930" }}>Not filterable (10-expression limit): {plan.dropped.join(", ")}</Text>}
                {zone && zone.ruleTypes.DIMENSION > 0 && (
                  <Text style={{ display: "block", ...hint, color: "#C21930" }}>
                    {zone.ruleTypes.DIMENSION} dimension {plural(zone.ruleTypes.DIMENSION, "rule is", "rules are")} not entity based and not carried over.
                  </Text>
                )}
              </div>
            ))}
          </Flex>
          <details>
            <summary style={{ cursor: "pointer", fontSize: 12, opacity: 0.8 }}>Membership queries ({preview.queries.length})</summary>
            <Flex flexDirection="column" gap={12} style={{ marginTop: 8 }}>
              {preview.queries.map((q, i) => (
                <QueryActions key={i} title={`Management zone membership (${i + 1} of ${preview.queries.length})`} query={q} />
              ))}
            </Flex>
          </details>
          {plans.length > 0 && (
            <>
              <Request label={`Request (2 API calls per zone: ${plans.length} lookups, ${creates} new + ${updates} updated segments)`} text={sample} />
              <Text style={hint}>
                The segment is a snapshot of entity IDs: refresh it here after topology changes. Users of the segment need storage:files:read to load its lookup. Segments filter data but do not restrict access.
              </Text>
              <Checkbox value={confirm} onChange={(v: boolean) => setConfirm(v)}>
                Upload {plans.length} lookup {plural(plans.length, "table")} and {creates ? `create ${creates}` : ""}{creates && updates ? " / " : ""}{updates ? `update ${updates}` : ""} {plural(plans.length, "segment")}
              </Checkbox>
              <Flex gap={8} alignItems="center">
                <Button variant="emphasized" disabled={busy || !confirm} onClick={() => void run()}>
                  Convert to segments
                </Button>
                {busy && preview && <Text style={hint}>{progress} of {plans.length} done…</Text>}
              </Flex>
            </>
          )}
        </>
      )}
      {results && (
        <Flex flexDirection="column" gap={4} role="status">
          {results.map((r) => (
            <div key={r.zone} style={{ padding: "6px 12px", borderRadius: 6, borderLeft: `4px solid ${r.ok ? "#0D9C29" : "#C21930"}`, background: "rgba(128,128,128,0.06)" }}>
              <Text>
                <strong>{r.zone}</strong>: {r.message}
              </Text>
              {r.uid && (
                <Flex gap={8} alignItems="center">
                  <Text style={{ fontSize: 11, opacity: 0.6 }}>Segment UID: {r.uid}</Text>
                  {r.ok && segmentsAppLink() && (
                    <a href={segmentsAppLink()} target="_blank" rel="noreferrer noopener" style={{ fontSize: 12 }}>
                      Open Segments ↗
                    </a>
                  )}
                </Flex>
              )}
            </div>
          ))}
        </Flex>
      )}
    </Flex>
  );
}

// ---------------------------------------------------------------------------
// Panel (rendered at the bottom of each tab except Overview)
// ---------------------------------------------------------------------------
type ActionDef = { id: string; label: string; kind: "api" | "manual"; node: React.ReactNode; docs: DocLink[] };

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

export function RemediationPanel({ tab, coverage, tf }: { tab: RemediationTab; coverage: DqlState; tf: Timeframe }) {
  const rows = useMemo(() => toCoverageRows(coverage), [coverage]);
  const { names: tagNames } = usePrimaryTags();
  const { zones } = useSegmentsData();

  const { impact, actions } = useMemo((): { impact: string; actions: ActionDef[] } => {
    const missing = (field: string, type?: string) => rows.filter((r) => r.field === field && (!type || r.type === type)).reduce((s, r) => s + (r.total - r.part), 0);
    const enrichment = (targets: TargetOption[]): ActionDef => ({ id: "enrich", label: "Central enrichment rule", kind: "api", node: <EnrichmentRuleForm targets={targets} />, docs: ENRICHMENT_DOCS });
    const manual = (a: ManualAction): ActionDef => ({ id: a.id, label: a.title, kind: "manual", node: <ManualActionView action={a} />, docs: a.docs });
    const hostGroupApi: ActionDef = { id: "host-group", label: "Assign host group (remote configuration)", kind: "api", node: <HostGroupAssignLoader tf={tf} />, docs: REMOTE_DOCS };
    const n = (x: number, one: string, many?: string) => `${x.toLocaleString()} ${plural(x, one, many)}`;
    const dt = (...values: string[]) => TARGET_OPTIONS.filter((t) => values.includes(t.value));
    switch (tab) {
      case "primary-tags": {
        const tagTargets = tagNames.map((t) => ({ value: `primary_tags.${t}`, label: `primary_tags.${t}` }));
        return {
          impact: tagNames.length ? `${tagNames.length} primary ${plural(tagNames.length, "tag")} tracked.` : "No primary tags tracked yet.",
          actions: [enrichment(tagTargets), manual(processTagAction(tagNames[0] ?? "team", "checkout"))],
        };
      }
      case "ownership":
        return {
          impact: `${n(missing("owner"), "entity", "entities")} without an owning team.`,
          actions: [
            { id: "teams-missing", label: "Create teams for owner values in use", kind: "api", node: <MissingTeams tf={tf} />, docs: OWNERSHIP_DOCS },
            { id: "owner-tag-classic", label: "Assign owner to frontends and synthetic monitors (tags)", kind: "api", node: <ClassicOwnerTagLoader tf={tf} />, docs: OWNER_TAG_DOCS },
            { id: "team-new", label: "Create a new team", kind: "api", node: <TeamCreateForm />, docs: OWNERSHIP_DOCS },
            manual(ownerHostAction),
            manual(ownerK8sAction),
            manual(ownerProcessAction),
          ],
        };
      case "security":
        return {
          impact: `${n(missing("security"), "entity", "entities")} without security context.`,
          actions: [enrichment(dt("dt.security_context")), manual(hostTagsAction("dt.security_context", "confidential")), manual(k8sAnnotationAction("dt.security_context", "team-a"))],
        };
      case "cost":
        return {
          impact: `${n(missing("costcenter"), "entity", "entities")} without a cost center, ${n(missing("product"), "entity", "entities")} without a cost product.`,
          actions: [enrichment(dt("dt.cost.costcenter", "dt.cost.product")), manual(hostTagsAction("dt.cost.product", "checkout")), manual(k8sAnnotationAction("dt.cost.product", "checkout"))],
        };
      case "hostgroups":
        return { impact: `${n(missing("hostgroup", "HOST"), "host")} without a host group.`, actions: [hostGroupApi, manual(hostGroupManualAction)] };
      case "oneagent":
        return {
          impact: "Keep OneAgents current and in full-stack mode.",
          actions: [{ id: "auto-update", label: "Enable automatic updates", kind: "api", node: <AutoUpdateForm />, docs: UPDATE_DOCS }, { id: "monitoring-mode-api", label: "Change monitoring mode (Settings API)", kind: "api", node: <MonitoringModeForm tf={tf} />, docs: MODE_DOCS }, manual(updatesUiAction), manual(monitoringModeAction)],
        };
      case "segments": {
        const without = (zones ?? []).filter((z) => !z.segment).length;
        return {
          impact: zones ? `${n(without, "management zone")} without a segment of the same name.` : "Reading management zones…",
          actions: [{ id: "mz-convert", label: "Convert management zones to segments", kind: "api", node: <MzConvertForm tf={tf} />, docs: SEGMENT_DOCS }, manual(ruleBasedAction)],
        };
      }
    }
  }, [tab, rows, tf, tagNames, zones]);

  const [pick, setPick] = useState<string>("");
  const active = actions.find((a) => a.id === pick) ?? actions[0];

  return (
    <div id={remediationAnchorId(tab)} style={{ ...box, marginTop: Spacings.Size16 }}>
      <Flex justifyContent="space-between" alignItems="flex-end" flexWrap="wrap" gap={12}>
        <div>
          <Heading level={3} style={{ margin: 0 }}>
            Remediation actions
          </Heading>
          <Text style={{ opacity: 0.8 }}>{impact}</Text>
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
      <div style={{ marginTop: Spacings.Size12 }} key={`${tab}-${active.id}`}>
        {active.node}
      </div>
      {active.docs.length > 0 && (
        <Flex gap={12} flexWrap="wrap" alignItems="center" style={{ marginTop: Spacings.Size16 }}>
          <Text style={{ fontSize: 12, opacity: 0.7 }}>Documentation for this fix:</Text>
          <Links docs={active.docs} />
        </Flex>
      )}
    </div>
  );
}
