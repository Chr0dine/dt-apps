import React, { useCallback, useMemo, useRef, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { Accordion, MessageContainer } from "@dynatrace/strato-components/content";
import { Checkbox, Select, TextInput, ToggleButtonGroup } from "@dynatrace/strato-components/forms";
import { CheckmarkIcon, WarningIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { useAIInsights } from "../AIInsights";
import { analyzeIamPolicy, type IamPolicyInsightInput } from "../analyses";
import {
  ACCOUNT_MANAGEMENT_URL,
  IAM_DOCS,
  SNAPSHOT_DATE,
  attributeOf,
  conditionOf,
  diffSize,
  globalDocUrl,
  globalOperators,
  grailTableOf,
  permissionDocUrl,
  serviceDocUrl,
  serviceOf,
  sortOperators,
  useIamCatalog,
  type CatalogIndex,
  type Dimension,
  type PermissionInfo,
} from "../iamCatalog";
import {
  MAX_STATEMENTS,
  adaptOperator,
  POLICY_TEMPLATES,
  appDataGaps,
  dataNeeds,
  dimensionConditions,
  draftFromPolicyText,
  filled,
  renderCondition,
  renderPolicy,
  selectedApps,
  uid,
  validatePolicy,
  type AppIndex,
  type Cond,
  type Diagnostic,
  type Effect,
  type ParsedStatement,
  type PermRow,
  type PolicyDraft,
  type PolicyStep,
} from "../iamPolicy";
import { BUCKETS, LEVEL_HINT, LEVEL_LABEL, useAppCatalog, useAppIcon, type AppCatalog, type AppLevel, type AppPerm, type AppSummary } from "../iamApps";
import { useIamDrafts } from "../iamDrafts";
import type { Timeframe } from "../queries";
import { AddSelect, CatalogBanner, ConditionRow, DocLink, EditorPane, OperatorSelect, ValuePicker, card, code, codeWrap, fileNameFor, hint, plural, valuesFor, type AddGroup } from "./IamShared";

// ---------------------------------------------------------------------------
// IAM Policy Creator, in three steps on the left with the live policy text on the right (editable, validated against
// the IAM policy reference, Copy / Export .txt):
// 1. Apps: every installed app as a card (icon, check mark and green border when selected) with a Read / Write /
//    Execute dropdown offering only the levels its manifest uses; apps that read Grail data are flagged.
// 2. Data access: opt-in Grail data permissions for the selected apps, limited with dimensional data. Until they are
//    added, the policy text carries a warning comment and the editor marks the app's line.
// 3. Fine-tune: individual permissions with every documented condition and operator, and global conditions.
// Every permission is written on its own ALLOW line. The draft lives in IamDraftsProvider so it survives tab switches.
// ---------------------------------------------------------------------------

type SetDraft = (fn: (d: PolicyDraft) => PolicyDraft) => void;

/** First operator to offer for a new condition: IN when supported (lists are the common case), else the first one. */
const defaultOp = (ops: string[]) => (ops.includes("IN") ? "IN" : ops[0] ?? "=");
const TABLE_LEVEL = (p: string) => !!grailTableOf(p) || p === "storage:entities:read" || p === "storage:smartscape:read";
const short = (p: string) => p.replace(/^storage:/, "").replace(/:read$/, "");
const warnText: React.CSSProperties = { color: Colors.Text.Warning.Default };
const okText: React.CSSProperties = { color: Colors.Text.Success.Default };

/** Editor warnings for selected apps whose required data is not granted by the policy text (hand edits included). */
function appDiagnostics(statements: ParsedStatement[], d: PolicyDraft, apps: AppIndex | null): Diagnostic[] {
  if (!apps) return [];
  const granted = new Set(statements.filter((s) => s.ok && s.effect === "ALLOW").flatMap((s) => s.permissions.map((p) => p.id)));
  const out: Diagnostic[] = [];
  for (const id of selectedApps(d)) {
    const s = apps.get(id);
    if (!s || !d.appLevels[id].includes("read")) continue;
    const missing = s.requiredData.filter((p) => !(d.appExclude[id] ?? []).includes(p) && !granted.has(p));
    if (!missing.length) continue;
    const st = statements.find((x) => x.permissions.some((p) => p.id === "app-engine:apps:run") && x.conditions.some((c) => c.key === "shared:app-id" && c.values.includes(id)));
    out.push({ from: st?.from ?? 0, to: st?.to ?? 0, severity: "warning", message: `${s.app.name} shows Grail data this policy does not grant (${missing.map(short).join(", ")}); add it in step 2, Data access.` });
  }
  return out;
}

export function IamPolicyTab({ tf }: { tf: Timeframe }) {
  const cat = useIamCatalog();
  const ix = cat.index;
  const appCat = useAppCatalog(ix);
  const apps = appCat.apps ? appCat.summaries : null;
  const drafts = useIamDrafts();
  const d = drafts.policy;
  const set = drafts.setPolicy;
  const generated = useMemo(() => renderPolicy(d, ix, ix.catalog.updated, apps), [d, ix, apps]);
  const text = drafts.policyText ?? generated;
  const sourceLabel = cat.source === "live" ? "live docs" : `snapshot of ${SNAPSHOT_DATE}`;
  const check = useMemo(() => validatePolicy(text, ix, sourceLabel), [text, ix, sourceLabel]);
  const diagnostics = useMemo(() => [...check.diagnostics, ...appDiagnostics(check.statements, d, apps)].sort((a, b) => a.from - b.from), [check, d, apps]);
  const [loadNote, setLoadNote] = useState<{ text: string; skipped: string[] } | null>(null);
  const setStep = (step: PolicyStep) => set((x) => ({ ...x, step }));

  const loadText = (t: string, label: string) => {
    const r = draftFromPolicyText(t, d);
    set(() => r.draft);
    drafts.setPolicyText(null);
    setLoadNote({ text: `${label}: loaded ${plural(r.loaded, "statement")} into the builder (step 3).`, skipped: r.skipped });
  };

  const insight = useMemo(
    () => policyInsight(check.statements, diagnostics, d, ix, apps, drafts.policyText !== null, cat.source === "live", diffSize(cat.diff)),
    [check, diagnostics, d, ix, apps, drafts.policyText, cat.source, cat.diff],
  );
  const { panel } = useAIInsights(useCallback(() => analyzeIamPolicy(insight), [insight]));

  return (
    <Flex flexDirection="column" gap={16}>
      {panel}
      <Heading level={3}>IAM Policy Creator</Heading>
      <Text>
        Build an IAM policy in three steps: pick the apps a group may use and how (read, write, execute), add the data those apps need limited by dimensional data,
        then fine-tune individual permissions. Every permission comes from the <DocLink href={IAM_DOCS.reference.url}>IAM policy reference</DocLink> and is written on its
        own ALLOW line on the right, which you can also edit directly. Create the policy in <DocLink href={ACCOUNT_MANAGEMENT_URL}>Account Management</DocLink> under
        Identity &amp; access management &gt; Policy management.
      </Text>
      <CatalogBanner state={cat} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 560px), 1fr))", gap: 16, alignItems: "start" }}>
        <Flex flexDirection="column" gap={16} style={{ minWidth: 0 }}>
          <NameCard d={d} set={set} onTemplate={loadText} onReset={() => (drafts.resetPolicy(), setLoadNote(null))} />
          <StepNav d={d} apps={apps} onStep={setStep} />
          {d.step === 1 && <AppsStep d={d} set={set} ix={ix} appCat={appCat} onNext={() => setStep(2)} />}
          {d.step === 2 && <DataStep d={d} set={set} tf={tf} ix={ix} apps={apps} onBack={() => setStep(1)} onNext={() => setStep(3)} />}
          {d.step === 3 && (
            <>
              <PermissionsCard d={d} set={set} tf={tf} ix={ix} dataBuckets={!!apps && dataNeeds(d, apps).some((n) => n.included && grailTableOf(n.permission))} />
              <GlobalsCard d={d} set={set} tf={tf} ix={ix} />
              <Flex>
                <Button onClick={() => setStep(2)}>← Back: Data access</Button>
              </Flex>
            </>
          )}
        </Flex>
        <div style={{ position: "sticky", top: 8, minWidth: 0 }}>
          <div style={card}>
            <EditorPane
              title="Policy"
              generated={generated}
              manual={drafts.policyText}
              onEdit={drafts.setPolicyText}
              onRegenerate={() => (drafts.setPolicyText(null), setLoadNote(null))}
              onLoadIntoBuilder={() => loadText(text, "Editor text")}
              diagnostics={diagnostics}
              fileName={fileNameFor(d.name, "iam-policy")}
              counter={`${check.statements.length} of ${MAX_STATEMENTS} statements`}
              placeholder="Select apps on the left, or type / paste a policy, e.g. ALLOW storage:logs:read WHERE storage:dt.security_context = &quot;TeamA&quot;;"
              loadNote={loadNote && <LoadNote note={loadNote} onClose={() => setLoadNote(null)} />}
              docs={[
                IAM_DOCS.reference,
                IAM_DOCS.syntax,
                IAM_DOCS.grail,
                IAM_DOCS.globals,
                IAM_DOCS.attributes,
                IAM_DOCS.templating,
                IAM_DOCS.defaults,
                IAM_DOCS.limits,
                IAM_DOCS.manage,
                { title: "Account Management", url: ACCOUNT_MANAGEMENT_URL },
              ]}
            />
          </div>
        </div>
      </div>
    </Flex>
  );
}

export function LoadNote({ note, onClose }: { note: { text: string; skipped: string[] }; onClose: () => void }) {
  return (
    <MessageContainer variant={note.skipped.length ? "warning" : "success"}>
      <MessageContainer.Description>
        <span>
          {note.text}
          {note.skipped.length > 0 && ` ${plural(note.skipped.length, "part")} could not be read and ${note.skipped.length === 1 ? "was" : "were"} left out: ${note.skipped.map((s) => s.slice(0, 80)).join(" | ")}`}{" "}
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", padding: 0, color: "inherit", textDecoration: "underline", cursor: "pointer", fontSize: 12 }}>
            Dismiss
          </button>
        </span>
      </MessageContainer.Description>
    </MessageContainer>
  );
}

/** What AI Assist reads: the editor text as parsed (so hand edits count), plus the draft's apps and dimensions. */
function policyInsight(
  statements: ParsedStatement[],
  diags: { severity: string }[],
  d: PolicyDraft,
  ix: CatalogIndex,
  apps: AppIndex | null,
  manual: boolean,
  liveDocs: boolean,
  docChanges: number,
): IamPolicyInsightInput {
  const allows = statements.filter((s) => s.effect === "ALLOW");
  const perms = [...new Set(statements.flatMap((s) => s.permissions.map((p) => p.id)))];
  const granted = new Set(allows.flatMap((s) => s.permissions.map((p) => p.id)));
  const conds = statements.flatMap((s) => s.conditions);
  const included = apps ? dataNeeds(d, apps).filter((n) => n.included) : [];
  return {
    statements: statements.length,
    errors: diags.filter((x) => x.severity === "error").length,
    warnings: diags.filter((x) => x.severity === "warning").length,
    permissions: perms.length,
    services: new Set(perms.map(serviceOf)).size,
    unconditionalGrail: [...new Set(allows.filter((s) => !s.conditions.length).flatMap((s) => s.permissions.map((p) => p.id)).filter(TABLE_LEVEL))],
    bucketsMissing: [...granted].some((p) => grailTableOf(p)) && !granted.has(BUCKETS),
    denyConditionalGrail: [...new Set(statements.filter((s) => s.effect === "DENY" && s.conditions.length).flatMap((s) => s.permissions.map((p) => p.id)).filter((p) => grailTableOf(p)))],
    denyUnconditional: statements.filter((s) => s.effect === "DENY" && !s.conditions.length).length,
    appsMode: d.allApps ? "all" : selectedApps(d).length ? "selected" : granted.has("app-engine:apps:run") ? "selected" : "off",
    apps: selectedApps(d).length,
    appsNeedingData: apps ? appDataGaps(d, apps).map((g) => g.name) : [],
    dataUnscoped: included.length > 0 && included.every((n) => !dimensionConditions(n.permission, d.dims, ix).length),
    dims: manual ? [] : filled(d.dims).map((c) => ix.dimensions.find((x) => x.attr === c.key)?.label ?? c.key),
    dimMode: d.dimMode,
    securityContextWithoutMatch: conds.some((c) => attributeOf(c.key) === "dt.security_context" && c.op !== "MATCH" && !c.op.startsWith("NOT")),
    bindParams: new Set(conds.flatMap((c) => c.values.filter((v) => v.includes("${bindParam:")))).size,
    unknownPermissions: perms.filter((p) => !ix.permissions.has(p)),
    manual,
    liveDocs,
    docChanges,
  };
}

// --- Name and options ----------------------------------------------------------------------------------------------
function NameCard({ d, set, onTemplate, onReset }: { d: PolicyDraft; set: SetDraft; onTemplate: (text: string, label: string) => void; onReset: () => void }) {
  return (
    <div style={card}>
      <Heading level={4}>Name and options</Heading>
      <Flex gap={16} flexWrap="wrap" alignItems="flex-end" style={{ marginTop: 8 }}>
        <div style={{ flex: "1 1 220px" }}>
          <Text style={{ ...hint, display: "block", marginBottom: 4 }}>Name (first comment line and the export file name)</Text>
          <TextInput value={d.name} onChange={(v: string) => set((x) => ({ ...x, name: v }))} placeholder="e.g. Team A - logs and dashboards" aria-label="Policy name" />
        </div>
        <div style={{ flex: "1 1 220px" }}>
          <Text style={{ ...hint, display: "block", marginBottom: 4 }}>Start from a docs pattern (replaces the selections)</Text>
          <Select
            value={null}
            onChange={(v: string | null) => {
              const t = POLICY_TEMPLATES.find((x) => x.id === v);
              if (t) onTemplate(t.text, t.label);
            }}
            clearable
            aria-label="Start from a docs pattern"
          >
            <Select.Trigger placeholder="Select a pattern" />
            <Select.Content>
              {POLICY_TEMPLATES.map((t) => (
                <Select.Option key={t.id} value={t.id} textValue={t.label}>
                  {t.label}
                  <span style={{ opacity: 0.6, marginLeft: 8, fontSize: 12 }}>{t.doc.title}</span>
                </Select.Option>
              ))}
            </Select.Content>
          </Select>
        </div>
        <Button onClick={onReset}>Clear all</Button>
      </Flex>
      <Flex gap={16} flexWrap="wrap" style={{ marginTop: 12 }}>
        <Checkbox value={d.comments} onChange={(v: boolean) => set((x) => ({ ...x, comments: v }))}>
          Comments (section titles, and the apps behind each line)
        </Checkbox>
        <Checkbox value={d.combine} onChange={(v: boolean) => set((x) => ({ ...x, combine: v }))}>
          Fewer statements: combine permissions with the same conditions (off = one ALLOW per line)
        </Checkbox>
      </Flex>
    </div>
  );
}

// --- Steps -------------------------------------------------------------------------------------------------------------
function StepNav({ d, apps, onStep }: { d: PolicyDraft; apps: AppIndex | null; onStep: (s: PolicyStep) => void }) {
  const n = selectedApps(d).length;
  const needs = apps ? dataNeeds(d, apps) : [];
  const gaps = apps ? appDataGaps(d, apps) : [];
  const included = needs.filter((x) => x.included).length;
  const labels: Record<PolicyStep, string> = {
    1: `1 · Apps${d.allApps ? " (all)" : n ? ` (${n})` : ""}`,
    2: `2 · Data access${needs.length ? ` (${included} of ${needs.length})` : ""}${gaps.length ? " ⚠" : ""}`,
    3: `3 · Fine-tune${d.rows.length || d.globals.length ? ` (${d.rows.length + d.globals.length})` : ""}`,
  };
  return (
    <ToggleButtonGroup value={String(d.step)} onChange={(v: string) => v && onStep(Number(v) as PolicyStep)} name="iam-policy-step">
      {([1, 2, 3] as PolicyStep[]).map((s) => (
        <ToggleButtonGroup.Item key={s} value={String(s)}>
          {labels[s]}
        </ToggleButtonGroup.Item>
      ))}
    </ToggleButtonGroup>
  );
}

// --- Step 1: apps ------------------------------------------------------------------------------------------------------
type AppFilter = "all" | "dynatrace" | "custom" | "selected";

function AppsStep({ d, set, ix, appCat, onNext }: { d: PolicyDraft; set: SetDraft; ix: CatalogIndex; appCat: AppCatalog; onNext: () => void }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<AppFilter>("all");
  const apps = appCat.apps ? appCat.summaries : null;
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...(apps?.values() ?? [])]
      .filter((s) => filter === "all" || (filter === "dynatrace" ? s.app.builtin : filter === "custom" ? !s.app.builtin : !!d.appLevels[s.app.id]))
      .filter((s) => !needle || s.app.name.toLowerCase().includes(needle) || s.app.id.toLowerCase().includes(needle))
      .sort((a, b) => a.app.name.localeCompare(b.app.name));
  }, [apps, q, filter, d.appLevels]);
  const gaps = apps ? appDataGaps(d, apps) : [];
  const granted = new Set(apps ? dataNeeds(d, apps).filter((n) => n.included).map((n) => n.permission) : []);
  const setLevels = (id: string, levels: AppLevel[] | null) =>
    set((x) => {
      const appLevels = { ...x.appLevels };
      if (levels === null) delete appLevels[id];
      else appLevels[id] = levels;
      return { ...x, appLevels };
    });
  const run = ix.permissions.get("app-engine:apps:run");
  return (
    <div style={card}>
      <Heading level={4}>Step 1 · Apps</Heading>
      <Text style={{ ...hint, display: "block", margin: "4px 0 8px" }}>
        Click the apps the group may use, then choose Read, Write and / or Execute under each one; only the levels the app&apos;s manifest uses are offered. Each app is
        granted on its own <span style={code}>app-engine:apps:run</span> line {run && <DocLink href={permissionDocUrl(run)}>docs</DocLink>}, followed by the permissions it
        requests for the chosen levels. <WarningIcon style={{ ...warnText, width: 12, height: 12, verticalAlign: "-1px" }} /> marks apps that show Grail data: add that data in
        step 2.
      </Text>
      {appCat.error && (
        <MessageContainer variant="critical">
          <MessageContainer.Description>Could not read the installed apps (App Registry): {appCat.error}</MessageContainer.Description>
        </MessageContainer>
      )}
      <Flex gap={8} alignItems="center" flexWrap="wrap" style={{ marginBottom: 8 }}>
        <div style={{ flex: "1 1 200px" }}>
          <TextInput value={q} onChange={(v: string) => setQ(v)} placeholder="Search apps" aria-label="Search apps" />
        </div>
        <ToggleButtonGroup value={filter} onChange={(v: string) => v && setFilter(v as AppFilter)} name="iam-app-filter">
          <ToggleButtonGroup.Item value="all">All</ToggleButtonGroup.Item>
          <ToggleButtonGroup.Item value="dynatrace">Dynatrace</ToggleButtonGroup.Item>
          <ToggleButtonGroup.Item value="custom">Custom</ToggleButtonGroup.Item>
          <ToggleButtonGroup.Item value="selected">Selected</ToggleButtonGroup.Item>
        </ToggleButtonGroup>
        <Text style={hint}>{apps ? `${list.length} of ${apps.size} apps` : "Reading installed apps…"}</Text>
      </Flex>
      <div
        role="group"
        aria-label="Installed apps"
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(156px, 1fr))", gap: 10, maxHeight: 640, overflowY: "auto", padding: 2, alignItems: "stretch" }}
      >
        {list.map((s) => (
          <AppCard key={s.app.id} s={s} levels={d.appLevels[s.app.id]} granted={granted} onLevels={(l) => setLevels(s.app.id, l)} />
        ))}
      </div>
      <Flex gap={16} flexWrap="wrap" style={{ marginTop: 12 }}>
        <Checkbox value={d.allApps} onChange={(v: boolean) => set((x) => ({ ...x, allApps: v }))}>
          Let the group open every app (one unconditional app-engine:apps:run, including apps installed later)
        </Checkbox>
        <Checkbox value={d.limitOwned} onChange={(v: boolean) => set((x) => ({ ...x, limitOwned: v }))}>
          Limit app state and app settings permissions to the selected apps (shared:app-id)
        </Checkbox>
      </Flex>
      {apps && selectedApps(d).length > 0 && <SelectedApps d={d} set={set} apps={apps} />}
      {gaps.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <MessageContainer variant="warning">
            <MessageContainer.Description>
              <span>
                {gaps.map((g) => g.name).join(", ")} {gaps.length === 1 ? "shows" : "show"} Grail data the policy does not grant yet ({[...new Set(gaps.flatMap((g) => g.missing))].map(short).join(", ")}).
                Add it in step 2.
              </span>
            </MessageContainer.Description>
          </MessageContainer>
        </div>
      )}
      <Flex justifyContent="flex-end" style={{ marginTop: 12 }}>
        <Button variant="emphasized" onClick={onNext}>
          Next: Data access →
        </Button>
      </Flex>
    </div>
  );
}

/** App Registry icon, loaded once the card scrolls into view (also used by the Permissions Test tab). */
export function AppIcon({ s, size, cardRef }: { s: AppSummary; size: number; cardRef: React.RefObject<HTMLDivElement | null> }) {
  const url = useAppIcon(s.app, cardRef);
  const [broken, setBroken] = useState(false);
  return url && !broken ? (
    <img src={url} alt="" width={size} height={size} onError={() => setBroken(true)} style={{ borderRadius: 8, flex: "0 0 auto", objectFit: "contain" }} />
  ) : (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, borderRadius: 8, flex: "0 0 auto", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: size * 0.4, background: "rgba(128,128,128,0.18)" }}
    >
      {s.app.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** One app: click toggles it (check mark + green border); the dropdown below picks Read / Write / Execute. */
function AppCard({ s, levels, granted, onLevels }: { s: AppSummary; levels: AppLevel[] | undefined; granted: Set<string>; onLevels: (levels: AppLevel[] | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const selected = levels !== undefined;
  const toggle = () => onLevels(selected ? null : ["read"]);
  const needsData = s.requiredData.length > 0 && (!selected || levels.includes("read"));
  const missing = s.requiredData.filter((p) => !granted.has(p));
  const count = (l: AppLevel) => s.byLevel[l].length;
  return (
    <div
      ref={ref}
      role="checkbox"
      aria-checked={selected}
      aria-label={s.app.name}
      tabIndex={0}
      title={s.app.id}
      onClick={(e) => {
        // Clicks inside the dropdown (rendered in a portal) bubble through React; only clicks on the card itself toggle.
        if (!e.currentTarget.contains(e.target as Node) || (e.target as HTMLElement).closest("[data-no-toggle]")) return;
        toggle();
      }}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === " " || e.key === "Enter")) {
          e.preventDefault();
          toggle();
        }
      }}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: 10,
        borderRadius: 10,
        cursor: "pointer",
        border: `2px solid ${selected ? Colors.Border.Success.Accent : "rgba(128,128,128,0.25)"}`,
        background: selected ? Colors.Background.Container.Success.Default : Colors.Background.Container.Neutral.Default,
        outlineOffset: 2,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          width: 20,
          height: 20,
          borderRadius: "50%",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: selected ? Colors.Background.Container.Success.Accent : "transparent",
          border: selected ? "none" : "1.5px solid rgba(128,128,128,0.55)",
          color: "#fff",
        }}
      >
        {selected && <CheckmarkIcon style={{ width: 14, height: 14 }} />}
      </span>
      <Flex gap={8} alignItems="center" style={{ paddingRight: 22, minHeight: 36 }}>
        <AppIcon s={s} size={32} cardRef={ref} />
        <Text style={{ fontWeight: 600, fontSize: 13, lineHeight: "16px", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", wordBreak: "break-word" }}>
          {s.app.name}
        </Text>
      </Flex>
      <div data-no-toggle="" onClick={(e) => e.stopPropagation()} style={{ marginTop: "auto" }}>
        <Select multiple value={levels ?? []} onChange={(v: string[]) => onLevels(v as AppLevel[])} aria-label={`${s.app.name} access`}>
          <Select.Trigger width="full" placeholder={selected ? "Open only" : "Choose access"}>
            <Select.DisplayValue>
              <Text as="p" style={{ fontSize: 12 }}>
                {levels?.length ? levels.map((l) => LEVEL_LABEL[l]).join(", ") : selected ? "Open only" : "Choose access"}
              </Text>
            </Select.DisplayValue>
          </Select.Trigger>
          <Select.Content width="max(100%, 320px)">
            {s.levels.map((l) => (
              <Select.Option key={l} value={l} textValue={LEVEL_LABEL[l]}>
                <span style={{ display: "block" }}>
                  <span style={{ fontWeight: 600 }}>{LEVEL_LABEL[l]}</span>
                  <span style={{ opacity: 0.65, marginLeft: 8, fontSize: 12 }}>
                    {count(l) ? plural(count(l), "permission") : "opens the app"} · {LEVEL_HINT[l]}
                  </span>
                  {l === "read" && s.requiredData.length > 0 && (
                    <span style={{ ...warnText, display: "block", fontSize: 12, marginTop: 2 }}>
                      ⚠ Needs Grail data: {s.requiredData.map(short).join(", ")}
                      {s.data.length > s.requiredData.length ? ` (+${s.data.length - s.requiredData.length} optional)` : ""}. Add it in step 2.
                    </span>
                  )}
                  {ingest(s, l).length > 0 && (
                    <span style={{ ...warnText, display: "block", fontSize: 12, marginTop: 2 }}>⚠ Includes writing data into Grail: {ingest(s, l).join(", ")}</span>
                  )}
                </span>
              </Select.Option>
            ))}
          </Select.Content>
        </Select>
      </div>
      {/* Fixed two-line box keeps the dropdowns of one row aligned whether or not a card has a data note. */}
      <div
        style={{
          height: 30,
          fontSize: 11,
          lineHeight: "15px",
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          ...(selected ? (missing.length ? warnText : okText) : { opacity: 0.75 }),
        }}
      >
        {needsData &&
          (selected && !missing.length ? (
            "✓ Data access granted in step 2"
          ) : (
            <>
              <WarningIcon style={{ width: 11, height: 11, verticalAlign: "-1px", marginRight: 3 }} />
              Needs data: {s.requiredData.slice(0, 3).map(short).join(", ")}
              {s.requiredData.length > 3 ? ` +${s.requiredData.length - 3}` : ""}
            </>
          ))}
      </div>
    </div>
  );
}

/** Grail write / ingest permissions an access level includes (Notebooks' Write also lets it write logs, events, metrics). */
const ingest = (s: AppSummary, l: AppLevel) =>
  l === "write" ? s.byLevel.write.filter((p) => /^storage:[a-z.]+:write$|:ingest$/.test(p.permission)).map((p) => short(p.permission.replace(/:write$/, ":read"))) : [];

/** Selected apps with what they get, and per-app control over the manifest permissions. */
function SelectedApps({ d, set, apps }: { d: PolicyDraft; set: SetDraft; apps: AppIndex }) {
  const [open, setOpen] = useState<string | null>(null);
  const ids = selectedApps(d).sort((a, b) => (apps.get(a)?.app.name ?? a).localeCompare(apps.get(b)?.app.name ?? b));
  const toggleExclude = (id: string, p: string, on: boolean) =>
    set((x) => {
      const cur = new Set(x.appExclude[id] ?? []);
      if (on) cur.delete(p);
      else cur.add(p);
      return { ...x, appExclude: { ...x.appExclude, [id]: [...cur] } };
    });
  return (
    <div style={{ marginTop: 16 }}>
      <Text style={{ display: "block", fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Selected apps ({ids.length})</Text>
      {ids.map((id) => {
        const s = apps.get(id);
        const levels = d.appLevels[id];
        if (!s)
          return (
            <Text key={id} style={{ ...hint, display: "block" }}>
              {id}: not installed in this environment (opened with its app ID only).
            </Text>
          );
        const excl = new Set(d.appExclude[id] ?? []);
        const perms = levels.flatMap((l) => s.byLevel[l]);
        const granted = perms.filter((p) => !excl.has(p.permission)).length + s.owned.filter((p) => !excl.has(p.permission)).length;
        return (
          <div key={id} style={{ borderTop: "1px solid rgba(128,128,128,0.18)", padding: "6px 0" }}>
            <Flex gap={8} alignItems="center" justifyContent="space-between" flexWrap="wrap">
              <Text style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>{s.app.name}</span>
                <span style={{ ...hint, marginLeft: 8 }}>
                  {levels.length ? levels.map((l) => LEVEL_LABEL[l]).join(", ") : "Open only"} · {plural(granted, "permission")}
                  {levels.includes("read") && s.data.length ? ` · ${plural(s.data.length, "data permission")} (step 2)` : ""}
                  {s.skipped.length ? ` · ${s.skipped.length} left out` : ""}
                </span>
              </Text>
              <Flex gap={8}>
                <Button size="condensed" onClick={() => setOpen(open === id ? null : id)} aria-expanded={open === id}>
                  {open === id ? "Hide permissions" : "Customize"}
                </Button>
                <Button size="condensed" onClick={() => set((x) => ({ ...x, appLevels: Object.fromEntries(Object.entries(x.appLevels).filter(([k]) => k !== id)) }))}>
                  Remove
                </Button>
              </Flex>
            </Flex>
            {open === id && <AppPermissionList s={s} levels={levels} excluded={excl} onToggle={(p, on) => toggleExclude(id, p, on)} />}
          </div>
        );
      })}
    </div>
  );
}

function AppPermissionList({ s, levels, excluded, onToggle }: { s: AppSummary; levels: AppLevel[]; excluded: Set<string>; onToggle: (p: string, on: boolean) => void }) {
  const line = (p: AppPerm, editable = true) => (
    <div key={p.permission} style={{ padding: "2px 0" }}>
      {editable ? (
        <Checkbox value={!excluded.has(p.permission)} onChange={(v: boolean) => onToggle(p.permission, v)}>
          <span>
            <span style={code}>{p.permission}</span>
            {p.comment && <span style={{ ...hint, marginLeft: 6 }}>{p.comment}</span>}
          </span>
        </Checkbox>
      ) : (
        <Text style={{ fontSize: 12 }}>
          <span style={{ ...code, opacity: 0.7 }}>{p.permission}</span> <span style={hint}>{p.reason}</span>
        </Text>
      )}
    </div>
  );
  const group = (title: string, ps: AppPerm[], editable = true) =>
    ps.length > 0 && (
      <div style={{ marginTop: 6 }}>
        <Text style={{ ...hint, display: "block", fontWeight: 600 }}>{title}</Text>
        {ps.map((p) => line(p, editable))}
      </div>
    );
  return (
    <div style={{ padding: "4px 0 4px 12px", maxHeight: 320, overflowY: "auto" }}>
      {levels.map((l) => group(`${LEVEL_LABEL[l]} (${LEVEL_HINT[l]})`, s.byLevel[l]))}
      {group("App state and app settings (always granted, limited to the app when that option is on)", s.owned)}
      {levels.includes("read") && group("Grail data: granted in step 2", s.data)}
      {group("Left out: not IAM policy permissions", s.skipped, false)}
      {!levels.length && <Text style={{ ...hint, display: "block" }}>Open only: choose Read, Write or Execute in the app&apos;s dropdown to add its permissions.</Text>}
    </div>
  );
}

// --- Step 2: data access -----------------------------------------------------------------------------------------------
function DataStep({ d, set, tf, ix, apps, onBack, onNext }: { d: PolicyDraft; set: SetDraft; tf: Timeframe; ix: CatalogIndex; apps: AppIndex | null; onBack: () => void; onNext: () => void }) {
  // Listed with their own include state even while the step is off, so the choice is ready when it is turned on.
  const needs = apps ? dataNeeds({ ...d, dataEnabled: true }, apps) : [];
  const gaps = apps ? appDataGaps(d, apps) : [];
  const included = needs.filter((n) => n.included).map((n) => n.permission);
  const tables = [...new Set(included.map(grailTableOf).filter((t): t is string => !!t))];
  const targets = d.dataEnabled ? [...included, ...(tables.length ? [BUCKETS] : [])] : [];
  const scopedRows = d.rows.filter((r) => r.scoped).map((r) => r.permission);
  const bucketDims = dimensionConditions(BUCKETS, d.dims, ix);
  return (
    <>
      <div style={card}>
        <Heading level={4}>Step 2 · Data access</Heading>
        <Text style={{ ...hint, display: "block", margin: "4px 0 8px" }}>
          The selected apps (with Read) show data from Grail. Add the table permissions they need, and limit the records below with dimensional data; nothing is added
          until you choose <em>Add data access</em>. <DocLink href={IAM_DOCS.grail.url}>Permissions in Grail</DocLink>
        </Text>
        {!apps ? (
          <Text style={hint}>Reading the installed apps…</Text>
        ) : !needs.length ? (
          <Text style={{ ...hint, display: "block" }}>None of the selected apps with Read requests Grail data. Dimensional data below still applies to data permissions you add in step 3.</Text>
        ) : (
          <>
            <ToggleButtonGroup value={d.dataEnabled ? "on" : "off"} onChange={(v: string) => v && set((x) => ({ ...x, dataEnabled: v === "on" }))} name="iam-data-enabled">
              <ToggleButtonGroup.Item value="off">Not now</ToggleButtonGroup.Item>
              <ToggleButtonGroup.Item value="on">Add data access</ToggleButtonGroup.Item>
            </ToggleButtonGroup>
            {gaps.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <MessageContainer variant="warning">
                  <MessageContainer.Description>
                    <span>
                      {gaps.map((g) => `${g.name} (${g.missing.map(short).join(", ")})`).join("; ")}: required data not granted, so {gaps.length === 1 ? "this app shows" : "these apps show"} no data.
                    </span>
                  </MessageContainer.Description>
                </MessageContainer>
              </div>
            )}
            <div style={{ marginTop: 8, opacity: d.dataEnabled ? 1 : 0.55 }}>
              {needs.map((n) => (
                <Flex key={n.permission} gap={8} alignItems="flex-start" justifyContent="space-between" style={{ padding: "3px 0" }}>
                  <Checkbox value={n.included} onChange={(v: boolean) => set((x) => ({ ...x, dataInclude: { ...x.dataInclude, [n.permission]: v } }))}>
                    <span>
                      <span style={code}>{n.permission}</span>
                      <span style={{ ...hint, marginLeft: 6 }}>
                        {n.required.length ? `needed by ${n.required.join(", ")}` : ""}
                        {n.required.length && n.optional.length ? " · " : ""}
                        {n.optional.length ? `optional for ${n.optional.join(", ")}` : ""}
                      </span>
                    </span>
                  </Checkbox>
                  {ix.permissions.get(n.permission) && (
                    <Text style={{ fontSize: 12, flex: "0 0 auto", paddingTop: 2 }}>
                      <DocLink href={permissionDocUrl(ix.permissions.get(n.permission)!)}>docs</DocLink>
                    </Text>
                  )}
                </Flex>
              ))}
              <Text style={{ ...hint, display: "block", marginTop: 4 }}>
                <span style={code}>{BUCKETS}</span> is added for the tables you include
                {bucketDims.length ? `, limited by ${bucketDims.map(renderCondition).join(" AND ")}` : tables.length ? `, limited to ${tables.join(", ")}` : ""}.
              </Text>
            </div>
          </>
        )}
      </div>
      <DimensionsCard d={d} set={set} tf={tf} ix={ix} targets={[...targets, ...scopedRows]} />
      <Flex justifyContent="space-between">
        <Button onClick={onBack}>← Back: Apps</Button>
        <Button variant="emphasized" onClick={onNext}>
          Next: Fine-tune →
        </Button>
      </Flex>
    </>
  );
}

// --- Dimensional data --------------------------------------------------------------------------------------------------
function DimensionsCard({ d, set, tf, ix, targets }: { d: PolicyDraft; set: SetDraft; tf: Timeframe; ix: CatalogIndex; targets: string[] }) {
  const active = filled(d.dims).length;
  return (
    <div style={card}>
      <Heading level={4}>Limit the records (dimensional data)</Heading>
      <Text style={{ ...hint, display: "block", margin: "4px 0 8px" }}>
        Which records the group may read. Each dimension is added to every data permission above, and to step 3 permissions with &quot;Apply dimensional data&quot; on,
        that has a condition for it (storage tables; security context also on settings and synthetic, Kubernetes and host also on Live Debugger). Values are suggested
        from this tenant.
      </Text>
      <Flex gap={8} alignItems="center" flexWrap="wrap" style={{ marginBottom: 8 }}>
        <Text style={{ fontSize: 13 }}>A record must match</Text>
        <ToggleButtonGroup value={d.dimMode} onChange={(v: string) => v && set((x) => ({ ...x, dimMode: v as PolicyDraft["dimMode"] }))} name="iam-dim-mode">
          <ToggleButtonGroup.Item value="all">every dimension (AND)</ToggleButtonGroup.Item>
          <ToggleButtonGroup.Item value="any">any dimension (OR)</ToggleButtonGroup.Item>
        </ToggleButtonGroup>
        <Text style={hint}>{active ? `${plural(active, "dimension")} set` : "none set: no record-level restriction"}</Text>
      </Flex>
      <Accordion multiple defaultExpanded={[]} size="condensed">
        {ix.dimensions.map((dim) => {
          const cond = d.dims.find((c) => c.key === dim.attr);
          return (
            <Accordion.Section key={dim.attr} id={dim.attr}>
              <Accordion.SectionLabel>
                <span style={{ fontWeight: 600 }}>{dim.label}</span> <span style={{ ...code, marginLeft: 4 }}>{dim.attr}</span>
                {cond && filled([cond]).length > 0 && <span style={{ ...hint, marginLeft: 8 }}>{renderCondition({ key: "", op: cond.op, values: cond.values }).trim()}</span>}
              </Accordion.SectionLabel>
              <Accordion.SectionContent>
                <DimensionEditor dim={dim} cond={cond} set={set} tf={tf} ix={ix} targets={targets} />
              </Accordion.SectionContent>
            </Accordion.Section>
          );
        })}
      </Accordion>
    </div>
  );
}

function DimensionEditor({ dim, cond, set, tf, ix, targets }: { dim: Dimension; cond: Cond | undefined; set: SetDraft; tf: Timeframe; ix: CatalogIndex; targets: string[] }) {
  const op = cond?.op ?? defaultOp(dim.operators);
  const values = cond?.values ?? [];
  // Permissions this dimension lands on, and the operators all of them accept.
  const affected = [...new Set(targets)]
    .map((p) => ({ p, c: ix.permissions.get(p)?.conditions.find((c) => attributeOf(c.key) === dim.attr) }))
    .filter((x): x is { p: string; c: NonNullable<typeof x.c> } => !!x.c);
  // Offer every operator at least one affected permission takes; the others get the equivalent operator where one exists.
  const common = affected.length ? sortOperators(affected.flatMap((x) => x.c.operators)) : dim.operators;
  const unsupported = affected.filter((x) => adaptOperator(op, values, x.c.operators) === null);
  const adapted = affected.map((x) => ({ ...x, as: adaptOperator(op, values, x.c.operators) })).filter((x) => x.as && x.as !== op);
  const update = (nextOp: string, nextValues: string[]) =>
    set((x) => {
      const others = x.dims.filter((c) => c.key !== dim.attr);
      return { ...x, dims: [...others, { id: cond?.id ?? uid(), key: dim.attr, op: nextOp, values: valuesFor(nextOp, nextValues) }] };
    });
  return (
    <div style={{ padding: "4px 0 8px" }}>
      <Flex gap={8} alignItems="flex-start" flexWrap="wrap">
        <OperatorSelect value={op} operators={common.length ? common : dim.operators} onChange={(o) => update(o, values)} label={`${dim.attr} operator`} />
        <div style={{ flex: "1 1 300px" }}>
          <ValuePicker condKey={dim.keys[0]} op={op} values={values} onChange={(v) => update(op, v)} tf={tf} ix={ix} showQuery="inline" />
        </div>
        {cond && (
          <Button size="condensed" onClick={() => set((x) => ({ ...x, dims: x.dims.filter((c) => c.key !== dim.attr) }))}>
            Clear
          </Button>
        )}
      </Flex>
      <Text style={{ ...hint, display: "block", marginTop: 6 }}>
        Condition keys: {dim.keys.join(", ")}. {affected.length ? `Applies to ${affected.map((x) => x.p).join(", ")}.` : "No data permission in this policy supports it yet."}
      </Text>
      {adapted.length > 0 && values.length > 0 && (
        <Text style={{ ...hint, display: "block" }}>
          Written as {adapted.map((x) => `${x.as} on ${x.p}`).join(", ")} ({op} is not supported there; same result).
        </Text>
      )}
      {unsupported.length > 0 && values.length > 0 && (
        <Text style={{ ...hint, display: "block", color: "#C21930", opacity: 1 }}>
          {op} is not supported for {unsupported.map((x) => `${x.c.key} on ${x.p}`).join(", ")} and has no equivalent for these values; pick another operator or other values.
        </Text>
      )}
    </div>
  );
}

// --- Permissions -----------------------------------------------------------------------------------------------------
function PermissionsCard({ d, set, tf, ix, dataBuckets }: { d: PolicyDraft; set: SetDraft; tf: Timeframe; ix: CatalogIndex; /** Step 2 already grants storage:buckets:read. */ dataBuckets: boolean }) {
  const selected = new Set(d.rows.map((r) => r.permission));
  const tables = [...new Set(d.rows.filter((r) => r.effect === "ALLOW").map((r) => grailTableOf(r.permission)).filter((t): t is string => !!t))];
  const needsBuckets = tables.length > 0 && !dataBuckets && !d.rows.some((r) => r.permission === "storage:buckets:read" && r.effect === "ALLOW");
  const bucketDim = filled(d.dims).some((c) => c.key === "bucket-name");
  const updateRow = (id: string, fn: (r: PermRow) => PermRow) => set((x) => ({ ...x, rows: x.rows.map((r) => (r.id === id ? fn(r) : r)) }));
  const toggle = (permission: string, on: boolean) =>
    set((x) => ({ ...x, rows: on ? [...x.rows, { id: uid(), permission, effect: "ALLOW", conditions: [], scoped: true }] : x.rows.filter((r) => r.permission !== permission) }));
  const addBuckets = () =>
    set((x) => ({
      ...x,
      rows: [
        ...x.rows,
        {
          id: uid(),
          permission: "storage:buckets:read",
          effect: "ALLOW",
          // With a bucket dimension the bucket names come from it; otherwise limit to the tables of the selected permissions.
          conditions: bucketDim ? [] : [{ id: uid(), key: "storage:table-name", op: tables.length > 1 ? "IN" : "=", values: tables }],
          scoped: true,
        },
      ],
    }));
  return (
    <div style={card}>
      <Heading level={4}>Step 3 · Fine-tune permissions</Heading>
      <Text style={{ ...hint, display: "block", margin: "4px 0 8px" }}>
        Optional: add any permission from the IAM policy reference on top of what the apps need, with ALLOW or DENY and any of the conditions it supports. Several
        statements for one permission are combined with OR.
      </Text>
      {d.rows.length === 0 && <Text style={{ ...hint, display: "block" }}>No individual permission added.</Text>}
      {d.rows.map((row) => (
        <PermissionRowEditor
          key={row.id}
          row={row}
          d={d}
          ix={ix}
          tf={tf}
          onChange={(fn) => updateRow(row.id, fn)}
          onRemove={() => set((x) => ({ ...x, rows: x.rows.filter((r) => r.id !== row.id) }))}
          onDuplicate={() => set((x) => ({ ...x, rows: [...x.rows, { ...row, id: uid(), conditions: [] }] }))}
        />
      ))}
      {needsBuckets && (
        <div style={{ marginTop: 8 }}>
          <MessageContainer variant="primary">
            <MessageContainer.Description>
              <Flex gap={8} alignItems="center" flexWrap="wrap">
                <span>
                  Grail table permissions also need <span style={code}>storage:buckets:read</span> for the buckets that hold the data ({tables.join(", ")}).
                </span>
                <Button size="condensed" onClick={addBuckets}>
                  Add storage:buckets:read
                </Button>
              </Flex>
            </MessageContainer.Description>
          </MessageContainer>
        </div>
      )}
      <PermissionBrowser ix={ix} selected={selected} onToggle={toggle} />
    </div>
  );
}

function PermissionRowEditor({
  row,
  d,
  ix,
  tf,
  onChange,
  onRemove,
  onDuplicate,
}: {
  row: PermRow;
  d: PolicyDraft;
  ix: CatalogIndex;
  tf: Timeframe;
  onChange: (fn: (r: PermRow) => PermRow) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const perm = ix.permissions.get(row.permission);
  const scopeConds = dimensionConditions(row.permission, d.dims, ix);
  const supportsDims = !!perm?.conditions.some((c) => ix.dimensions.some((dim) => dim.attr === attributeOf(c.key)));
  const twin = d.rows.filter((r) => r.permission === row.permission).length > 1;
  const groups: AddGroup[] = [
    { label: "Conditions of this permission", options: (perm?.conditions ?? []).map((c) => ({ value: c.key, label: c.key, detail: c.operators.join("  ") })) },
    { label: "Global conditions", options: ix.catalog.globals.map((g) => ({ value: g.key, label: g.key, detail: globalOperators(g).join("  ") })) },
  ];
  const addCond = (key: string) => {
    const ops = key.startsWith("global:") ? globalOperators(ix.globals.get(key)) : conditionOf(perm, key)?.operators ?? [];
    onChange((r) => ({ ...r, conditions: [...r.conditions, { id: uid(), key, op: defaultOp(sortOperators(ops)), values: [] }] }));
  };
  const grailDeny = row.effect === "DENY" && !!grailTableOf(row.permission) && row.permission !== "storage:buckets:read";
  return (
    <div style={{ border: "1px solid rgba(128,128,128,0.25)", borderRadius: 8, padding: 12, marginBottom: 8 }}>
      <Flex justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={8}>
        <div style={{ minWidth: 0, flex: "1 1 260px" }}>
          <Text style={{ display: "block" }}>
            <span style={{ ...code, fontSize: 13, fontWeight: 600 }}>{row.permission}</span>{" "}
            {perm ? (
              <Text style={{ fontSize: 12 }}>
                <DocLink href={permissionDocUrl(perm)}>docs</DocLink>
              </Text>
            ) : (
              <Text style={{ ...hint, color: "#FF832B", opacity: 1 }}>not in the IAM policy reference</Text>
            )}
          </Text>
          {perm && (
            <Text style={{ ...hint, display: "block" }}>
              {perm.service.title} · {perm.description}
            </Text>
          )}
        </div>
        <Flex gap={8} alignItems="center" flexWrap="wrap">
          <ToggleButtonGroup value={row.effect} onChange={(v: string) => v && onChange((r) => ({ ...r, effect: v as Effect }))} name={`effect-${row.id}`}>
            <ToggleButtonGroup.Item value="ALLOW">ALLOW</ToggleButtonGroup.Item>
            <ToggleButtonGroup.Item value="DENY">DENY</ToggleButtonGroup.Item>
          </ToggleButtonGroup>
          <Button size="condensed" onClick={onDuplicate} title="Another statement for this permission, combined with OR">
            + Statement
          </Button>
          <Button size="condensed" onClick={onRemove}>
            Remove
          </Button>
        </Flex>
      </Flex>
      {twin && <Text style={{ ...hint, display: "block", marginTop: 4 }}>One of several statements for this permission (OR).</Text>}
      {supportsDims && (
        <div style={{ marginTop: 8 }}>
          <Checkbox value={row.scoped} onChange={(v: boolean) => onChange((r) => ({ ...r, scoped: v }))}>
            <span>
              <span style={{ whiteSpace: "nowrap" }}>Apply dimensional data</span>
              {row.scoped && <span style={{ ...hint, marginLeft: 6 }}>{scopeConds.length ? scopeConds.map(renderCondition).join(d.dimMode === "all" ? " AND " : " | ") : "(no dimension set for this permission)"}</span>}
            </span>
          </Checkbox>
        </div>
      )}
      {row.effect === "DENY" && (
        <Text style={{ ...hint, display: "block", color: "#FF832B", opacity: 1, marginTop: 4 }}>
          {grailDeny && (row.conditions.length || (row.scoped && scopeConds.length))
            ? "Conditional DENY is not supported on Grail table permissions: this statement runs as an unconditional DENY."
            : "DENY overrules every ALLOW, and boundaries never apply to it."}
        </Text>
      )}
      {row.conditions.map((c) => {
        const isGlobal = c.key.startsWith("global:");
        const g = ix.globals.get(c.key);
        const pc = conditionOf(perm, c.key);
        return (
          <ConditionRow
            key={c.id}
            condKey={c.key}
            label={<span style={codeWrap}>{c.key}</span>}
            description={isGlobal ? g?.description : pc?.description}
            docHref={isGlobal ? (g ? globalDocUrl(g) : IAM_DOCS.globals.url) : perm ? permissionDocUrl(perm) : undefined}
            operators={isGlobal ? globalOperators(g) : sortOperators(pc?.operators ?? [])}
            op={c.op}
            values={c.values}
            onChange={(op, values) => onChange((r) => ({ ...r, conditions: r.conditions.map((x) => (x.id === c.id ? { ...x, op, values } : x)) }))}
            onRemove={() => onChange((r) => ({ ...r, conditions: r.conditions.filter((x) => x.id !== c.id) }))}
            tf={tf}
            ix={ix}
            note={!isGlobal && !pc ? <Text style={{ ...hint, color: "#C21930", opacity: 1 }}>{row.permission} does not support this condition.</Text> : undefined}
          />
        );
      })}
      <Flex gap={8} alignItems="center" flexWrap="wrap" style={{ marginTop: 8 }}>
        <AddSelect placeholder="Add condition" groups={groups} onAdd={addCond} />
        {perm && !perm.conditions.length && <Text style={hint}>This permission has no conditions of its own; global conditions still apply.</Text>}
      </Flex>
    </div>
  );
}

function PermissionBrowser({ ix, selected, onToggle }: { ix: CatalogIndex; selected: Set<string>; onToggle: (permission: string, on: boolean) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<(string | number)[]>([]);
  const needle = q.trim().toLowerCase();
  const services = useMemo(
    () =>
      ix.catalog.services
        .map((s) => ({
          s,
          perms: needle ? s.permissions.filter((p) => p.id.toLowerCase().includes(needle) || p.description.toLowerCase().includes(needle) || s.title.toLowerCase().includes(needle)) : s.permissions,
        }))
        .filter((x) => x.perms.length),
    [ix, needle],
  );
  const total = ix.permissions.size;
  return (
    <div style={{ marginTop: 16 }}>
      <Flex gap={8} alignItems="center" flexWrap="wrap" style={{ marginBottom: 8 }}>
        <Text style={{ fontWeight: 600, fontSize: 13 }}>Add permissions</Text>
        <div style={{ flex: "1 1 240px" }}>
          <TextInput value={q} onChange={(v: string) => setQ(v)} placeholder={`Search ${total} permissions, e.g. logs, settings, workflows`} aria-label="Search permissions" />
        </div>
        <Text style={hint}>{selected.size} selected</Text>
      </Flex>
      <Accordion multiple expanded={needle ? services.map((x) => x.s.id) : open} onExpandChange={(v) => !needle && setOpen(v)} size="condensed">
        {services.map(({ s, perms }) => {
          const n = s.permissions.filter((p) => selected.has(p.id)).length;
          return (
            <Accordion.Section key={s.id} id={s.id}>
              <Accordion.SectionLabel>
                <span style={{ fontWeight: 600 }}>{s.id}</span>
                <span style={{ ...hint, marginLeft: 8 }}>
                  {s.title} · {needle ? `${perms.length} of ${s.permissions.length}` : s.permissions.length}
                  {n ? ` · ${n} selected` : ""}
                </span>
              </Accordion.SectionLabel>
              <Accordion.SectionContent>
                {s.notes.map((note) => (
                  <Text key={note} style={{ ...hint, display: "block", marginBottom: 4 }}>
                    {note}
                  </Text>
                ))}
                <Text style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                  <DocLink href={serviceDocUrl(s)}>{s.id} in the IAM policy reference</DocLink>
                </Text>
                {perms.map((p) => (
                  <PermissionLine key={p.id} p={{ ...p, service: s }} checked={selected.has(p.id)} onToggle={onToggle} />
                ))}
              </Accordion.SectionContent>
            </Accordion.Section>
          );
        })}
      </Accordion>
      {!services.length && <Text style={hint}>No permission matches “{q}”. If it is new, type it in the editor; it is flagged until the docs list it.</Text>}
    </div>
  );
}

function PermissionLine({ p, checked, onToggle }: { p: PermissionInfo; checked: boolean; onToggle: (permission: string, on: boolean) => void }) {
  return (
    <Flex gap={8} alignItems="flex-start" justifyContent="space-between" style={{ padding: "3px 0" }}>
      <Checkbox value={checked} onChange={(v: boolean) => onToggle(p.id, v)}>
        <span>
          <span style={code}>{p.id}</span>
          <span style={{ ...hint, marginLeft: 6 }}>
            {p.description}
            {p.conditions.length ? ` · ${plural(p.conditions.length, "condition")}` : ""}
          </span>
        </span>
      </Checkbox>
      <Text style={{ fontSize: 12, flex: "0 0 auto", paddingTop: 2 }}>
        <DocLink href={permissionDocUrl(p)}>docs</DocLink>
      </Text>
    </Flex>
  );
}

// --- Global conditions -----------------------------------------------------------------------------------------------
function GlobalsCard({ d, set, tf, ix }: { d: PolicyDraft; set: SetDraft; tf: Timeframe; ix: CatalogIndex }) {
  const groups: AddGroup[] = [{ label: "Global conditions", options: ix.catalog.globals.map((g) => ({ value: g.key, label: g.key, detail: g.description.slice(0, 80) })) }];
  return (
    <div style={card}>
      <Heading level={4}>Global conditions</Heading>
      <Text style={{ ...hint, display: "block", margin: "4px 0 8px" }}>
        Added to every statement (AND): environment, user, group, date and time. Use &gt; and &lt; together for a time window.{" "}
        <DocLink href={IAM_DOCS.globals.url}>Policy global conditions</DocLink> · <DocLink href={IAM_DOCS.templating.url}>Templating with binding parameters</DocLink>
      </Text>
      {d.globals.map((c) => {
        const g = ix.globals.get(c.key);
        return (
          <ConditionRow
            key={c.id}
            condKey={c.key}
            label={<span style={codeWrap}>{c.key}</span>}
            description={g?.description}
            docHref={g ? globalDocUrl(g) : IAM_DOCS.globals.url}
            operators={globalOperators(g)}
            op={c.op}
            values={c.values}
            onChange={(op, values) => set((x) => ({ ...x, globals: x.globals.map((y) => (y.id === c.id ? { ...y, op, values } : y)) }))}
            onRemove={() => set((x) => ({ ...x, globals: x.globals.filter((y) => y.id !== c.id) }))}
            tf={tf}
            ix={ix}
          />
        );
      })}
      <div style={{ marginTop: 8 }}>
        <AddSelect
          placeholder="Add global condition"
          groups={groups}
          onAdd={(key) => set((x) => ({ ...x, globals: [...x.globals, { id: uid(), key, op: defaultOp(globalOperators(ix.globals.get(key))), values: [] }] }))}
        />
      </div>
    </div>
  );
}
