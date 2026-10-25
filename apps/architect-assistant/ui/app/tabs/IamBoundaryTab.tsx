import React, { useCallback, useMemo, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { Accordion, Chip } from "@dynatrace/strato-components/content";
import { CodeEditor } from "@dynatrace/strato-components/editors";
import { Checkbox, Select, TextInput, ToggleButtonGroup } from "@dynatrace/strato-components/forms";
import { useAIInsights } from "../AIInsights";
import { analyzeIamBoundary, type IamBoundaryInsightInput } from "../analyses";
import {
  ACCOUNT_MANAGEMENT_URL,
  IAM_DOCS,
  SNAPSHOT_DATE,
  globalDocUrl,
  globalOperators,
  serviceOf,
  sortOperators,
  useIamCatalog,
  type CatalogIndex,
  type Dimension,
} from "../iamCatalog";
import {
  BOUNDARY_TEMPLATES,
  MAX_BOUNDARY_CONDITIONS,
  POLICY_TEMPLATES,
  applyBoundary,
  draftFromBoundaryText,
  filled,
  parsePolicy,
  renderBoundary,
  renderCondition,
  renderPolicy,
  uid,
  validateBoundary,
  type BoundaryDim,
  type BoundaryDraft,
  type CondValue,
  type EffectiveRow,
} from "../iamPolicy";
import { useIamDrafts } from "../iamDrafts";
import { useAppCatalog } from "../iamApps";
import type { Timeframe } from "../queries";
import { AddSelect, CatalogBanner, ConditionRow, DocLink, EditorPane, OperatorSelect, ValuePicker, card, code, codeWrap, fileNameFor, hint, plural, valuesFor, type AddGroup } from "./IamShared";
import { LoadNote } from "./IamPolicyTab";

// ---------------------------------------------------------------------------
// IAM Boundary Creator: conditions only, one per line (max 10, no AND), that narrow the policies they are assigned with.
// GUI on the left (apps, dimensional data per service, any other condition from the IAM policy reference), live
// boundary text on the right, and a preview that applies the boundary to a policy with the documented rules, so
// permissions the boundary does not narrow are visible before it is used.
// ---------------------------------------------------------------------------

type SetDraft = (fn: (d: BoundaryDraft) => BoundaryDraft) => void;
const defaultOp = (ops: string[]) => (ops.includes("IN") ? "IN" : ops[0] ?? "=");

export function IamBoundaryTab({ tf }: { tf: Timeframe }) {
  const cat = useIamCatalog();
  const ix = cat.index;
  const drafts = useIamDrafts();
  const b = drafts.boundary;
  const set = drafts.setBoundary;
  const generated = useMemo(() => renderBoundary(b, ix), [b, ix]);
  const text = drafts.boundaryText ?? generated;
  const sourceLabel = cat.source === "live" ? "live docs" : `snapshot of ${SNAPSHOT_DATE}`;
  const check = useMemo(() => validateBoundary(text, ix, sourceLabel), [text, ix, sourceLabel]);
  const [loadNote, setLoadNote] = useState<{ text: string; skipped: string[] } | null>(null);
  // Conditions without errors take part in the preview.
  const usable = useMemo<CondValue[]>(() => {
    const errs = check.diagnostics.filter((x) => x.severity === "error");
    return check.conditions.filter((c) => !errs.some((e) => e.from >= c.from && e.from <= c.to)).map((c) => ({ key: c.key, op: c.op, values: c.values }));
  }, [check]);

  const appCat = useAppCatalog(ix);
  const creatorText = drafts.policyText ?? renderPolicy(drafts.policy, ix, ix.catalog.updated, appCat.apps ? appCat.summaries : null);
  const previewPolicy = drafts.previewText ?? creatorText;
  const statements = useMemo(() => parsePolicy(previewPolicy), [previewPolicy]);
  const effective = useMemo(() => applyBoundary(statements, usable, ix), [statements, usable, ix]);

  const loadText = (t: string, label: string) => {
    const r = draftFromBoundaryText(t, ix, b);
    set(() => r.draft);
    drafts.setBoundaryText(null);
    setLoadNote({ text: `${label}: loaded ${plural(r.loaded, "condition")} into the builder.`, skipped: r.skipped });
  };

  const insight = useMemo<IamBoundaryInsightInput>(() => {
    const keys = check.conditions.map((c) => c.key);
    const allows = statements.filter((s) => s.ok && s.effect === "ALLOW");
    return {
      conditions: check.conditions.length,
      errors: check.diagnostics.filter((x) => x.severity === "error").length,
      warnings: check.diagnostics.filter((x) => x.severity === "warning").length,
      services: [...new Set(keys.map((k) => (k.startsWith("global:") ? "global" : serviceOf(k))))],
      repeated: [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))],
      globals: [...new Set(keys.filter((k) => k.startsWith("global:")))],
      preview: allows.length
        ? {
            statements: statements.filter((s) => s.ok).length,
            effective: effective.length,
            notNarrowed: [...new Set(effective.filter((r) => r.effect === "ALLOW" && !r.narrowed).map((r) => r.permission))],
            deny: statements.filter((s) => s.ok && s.effect === "DENY").length,
          }
        : null,
      liveDocs: cat.source === "live",
    };
  }, [check, statements, effective, cat.source]);
  const { panel } = useAIInsights(useCallback(() => analyzeIamBoundary(insight), [insight]));

  return (
    <Flex flexDirection="column" gap={16}>
      {panel}
      <Heading level={3}>IAM Boundary Creator</Heading>
      <Text>
        A policy boundary is a list of conditions, one per line, that narrows the policies it is assigned with: each condition applies only to the permissions that support
        it (global conditions to all), at most {MAX_BOUNDARY_CONDITIONS} conditions, no AND, and DENY statements are never changed. Build it from the apps and the data a group
        may use, then check below which permissions of a policy it narrows. <DocLink href={IAM_DOCS.boundaries.url}>Policy boundaries</DocLink>
      </Text>
      <CatalogBanner state={cat} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 520px), 1fr))", gap: 16, alignItems: "start" }}>
        <Flex flexDirection="column" gap={16} style={{ minWidth: 0 }}>
          <StartCard b={b} set={set} onTemplate={loadText} onReset={() => (drafts.resetBoundary(), setLoadNote(null))} />
          <AppsCard b={b} set={set} tf={tf} ix={ix} />
          <DimensionsCard b={b} set={set} tf={tf} ix={ix} />
          <ConditionsCard b={b} set={set} tf={tf} ix={ix} />
          <PreviewCard
            mode={drafts.previewText === null ? "creator" : "custom"}
            policyText={previewPolicy}
            onMode={(m) => drafts.setPreviewText(m === "creator" ? null : creatorText)}
            onText={drafts.setPreviewText}
            effective={effective}
            statements={statements.filter((s) => s.ok).length}
            boundaryEmpty={!usable.length}
          />
        </Flex>
        <div style={{ position: "sticky", top: 8, minWidth: 0 }}>
          <div style={card}>
            <EditorPane
              title="Boundary"
              generated={generated}
              manual={drafts.boundaryText}
              onEdit={drafts.setBoundaryText}
              onRegenerate={() => (drafts.setBoundaryText(null), setLoadNote(null))}
              onLoadIntoBuilder={() => loadText(text, "Editor text")}
              diagnostics={check.diagnostics}
              fileName={fileNameFor(b.name, "iam-boundary")}
              counter={`${check.conditions.length} of ${MAX_BOUNDARY_CONDITIONS} conditions`}
              placeholder='Select conditions on the left, or type one per line, e.g. storage:k8s.namespace.name IN ("DEV", "PREPROD");'
              loadNote={loadNote && <LoadNote note={loadNote} onClose={() => setLoadNote(null)} />}
              docs={[IAM_DOCS.boundaries, IAM_DOCS.reference, IAM_DOCS.globals, IAM_DOCS.templating, IAM_DOCS.defaults, IAM_DOCS.limits, { title: "Account Management", url: ACCOUNT_MANAGEMENT_URL }]}
            />
          </div>
        </div>
      </div>
    </Flex>
  );
}

// --- Start ---------------------------------------------------------------------------------------------------------
function StartCard({ b, set, onTemplate, onReset }: { b: BoundaryDraft; set: SetDraft; onTemplate: (text: string, label: string) => void; onReset: () => void }) {
  return (
    <div style={card}>
      <Heading level={4}>Name and examples</Heading>
      <Flex gap={16} flexWrap="wrap" alignItems="flex-end" style={{ marginTop: 8 }}>
        <div style={{ flex: "1 1 220px" }}>
          <Text style={{ ...hint, display: "block", marginBottom: 4 }}>Name (export file name; the boundary text holds conditions only)</Text>
          <TextInput value={b.name} onChange={(v: string) => set((x) => ({ ...x, name: v }))} placeholder="e.g. Team A data" aria-label="Boundary name" />
        </div>
        <div style={{ flex: "1 1 220px" }}>
          <Text style={{ ...hint, display: "block", marginBottom: 4 }}>Start from a docs example (replaces the selections)</Text>
          <Select
            value={null}
            onChange={(v: string | null) => {
              const t = BOUNDARY_TEMPLATES.find((x) => x.id === v);
              if (t) onTemplate(t.text, t.label);
            }}
            clearable
            aria-label="Start from a docs example"
          >
            <Select.Trigger placeholder="Select an example" />
            <Select.Content>
              {BOUNDARY_TEMPLATES.map((t) => (
                <Select.Option key={t.id} value={t.id} textValue={t.label}>
                  {t.label}
                </Select.Option>
              ))}
            </Select.Content>
          </Select>
        </div>
        <Button onClick={onReset}>Clear all</Button>
      </Flex>
    </div>
  );
}

/** Permissions a boundary condition applies to (global conditions: all of them). */
function appliesTo(ix: CatalogIndex, key: string): string {
  if (key.startsWith("global:")) return "Applies to every permission of the bound policy.";
  const perms = ix.conditionKeys.get(key)?.permissions ?? [];
  if (!perms.length) return "No permission in the IAM policy reference has this condition, so it restricts nothing.";
  return `Narrows ${plural(perms.length, "permission")}: ${perms.slice(0, 6).join(", ")}${perms.length > 6 ? `, +${perms.length - 6} more` : ""}.`;
}

// --- Apps ------------------------------------------------------------------------------------------------------------
function AppsCard({ b, set, tf, ix }: { b: BoundaryDraft; set: SetDraft; tf: Timeframe; ix: CatalogIndex }) {
  const ops = ix.conditionKeys.get("shared:app-id")?.operators ?? ["IN", "="];
  return (
    <div style={card}>
      <Heading level={4}>Apps</Heading>
      <Text style={{ ...hint, display: "block", margin: "4px 0 8px" }}>
        One <span style={code}>shared:app-id</span> line: limits running and installing apps, app settings and app states to these apps.
      </Text>
      <Flex gap={8} alignItems="flex-start" flexWrap="wrap">
        <OperatorSelect value={b.apps.op} operators={ops} onChange={(op) => set((x) => ({ ...x, apps: { op, ids: valuesFor(op, x.apps.ids) } }))} label="shared:app-id operator" />
        <div style={{ flex: "1 1 300px" }}>
          <ValuePicker condKey="shared:app-id" op={b.apps.op} values={b.apps.ids} onChange={(ids) => set((x) => ({ ...x, apps: { ...x.apps, ids } }))} tf={tf} ix={ix} showQuery="none" />
        </div>
      </Flex>
      <Text style={{ ...hint, display: "block", marginTop: 6 }}>{appliesTo(ix, "shared:app-id")}</Text>
    </div>
  );
}

// --- Dimensional data --------------------------------------------------------------------------------------------------
function DimensionsCard({ b, set, tf, ix }: { b: BoundaryDraft; set: SetDraft; tf: Timeframe; ix: CatalogIndex }) {
  return (
    <div style={card}>
      <Heading level={4}>Dimensional data</Heading>
      <Text style={{ ...hint, display: "block", margin: "4px 0 8px" }}>
        Which records the group may read. A dimension becomes one line per service you tick (storage covers Grail tables; settings and synthetic have their own security
        context condition). Values are suggested from this tenant. <DocLink href={IAM_DOCS.grail.url}>Permissions in Grail</DocLink>
      </Text>
      <Accordion multiple defaultExpanded={[]} size="condensed">
        {ix.dimensions.map((dim) => {
          const cond = b.dims.find((c) => c.key === dim.attr);
          const on = cond && filled([cond]).length > 0 ? cond.services.length : 0;
          return (
            <Accordion.Section key={dim.attr} id={dim.attr}>
              <Accordion.SectionLabel>
                <span style={{ fontWeight: 600 }}>{dim.label}</span> <span style={{ ...code, marginLeft: 4 }}>{dim.attr}</span>
                {cond && on > 0 && (
                  <span style={{ ...hint, marginLeft: 8 }}>
                    {renderCondition({ key: "", op: cond.op, values: cond.values }).trim()} · {plural(on, "line")}
                  </span>
                )}
              </Accordion.SectionLabel>
              <Accordion.SectionContent>
                <DimensionEditor dim={dim} cond={cond} set={set} tf={tf} ix={ix} />
              </Accordion.SectionContent>
            </Accordion.Section>
          );
        })}
      </Accordion>
    </div>
  );
}

function DimensionEditor({ dim, cond, set, tf, ix }: { dim: Dimension; cond: BoundaryDim | undefined; set: SetDraft; tf: Timeframe; ix: CatalogIndex }) {
  const op = cond?.op ?? defaultOp(dim.operators);
  const values = cond?.values ?? [];
  const services = cond?.services ?? [serviceOf(dim.keys[0])];
  const update = (patch: Partial<BoundaryDim>) =>
    set((x) => {
      const cur: BoundaryDim = x.dims.find((c) => c.key === dim.attr) ?? { id: uid(), key: dim.attr, op, values: [], services };
      const next = { ...cur, ...patch };
      return { ...x, dims: [...x.dims.filter((c) => c.key !== dim.attr), { ...next, values: valuesFor(next.op, next.values) }] };
    });
  // An operator unsupported by some of the permissions behind a ticked key is reported in the editor.
  const ops = sortOperators(dim.keys.filter((k) => services.includes(serviceOf(k))).flatMap((k) => ix.conditionKeys.get(k)?.operators ?? []));
  return (
    <div style={{ padding: "4px 0 8px" }}>
      <Flex gap={8} alignItems="flex-start" flexWrap="wrap">
        <OperatorSelect value={op} operators={ops.length ? ops : dim.operators} onChange={(o) => update({ op: o })} label={`${dim.attr} operator`} />
        <div style={{ flex: "1 1 300px" }}>
          <ValuePicker condKey={dim.keys[0]} op={op} values={values} onChange={(v) => update({ values: v })} tf={tf} ix={ix} showQuery="inline" />
        </div>
        {cond && (
          <Button size="condensed" onClick={() => set((x) => ({ ...x, dims: x.dims.filter((c) => c.key !== dim.attr) }))}>
            Clear
          </Button>
        )}
      </Flex>
      <div style={{ marginTop: 8 }}>
        {dim.keys.map((k) => (
          <div key={k} style={{ padding: "2px 0" }}>
            <Checkbox
              value={services.includes(serviceOf(k))}
              onChange={(v: boolean) => update({ services: v ? [...new Set([...services, serviceOf(k)])] : services.filter((s) => s !== serviceOf(k)) })}
            >
              <span>
                <span style={code}>{k}</span>
                <span style={{ ...hint, marginLeft: 6 }}>{appliesTo(ix, k)}</span>
              </span>
            </Checkbox>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Other conditions ------------------------------------------------------------------------------------------------
function ConditionsCard({ b, set, tf, ix }: { b: BoundaryDraft; set: SetDraft; tf: Timeframe; ix: CatalogIndex }) {
  const groups = useMemo<AddGroup[]>(() => {
    const byService = new Map<string, AddGroup["options"]>();
    for (const [key, info] of [...ix.conditionKeys].sort(([a], [b2]) => a.localeCompare(b2))) {
      const s = serviceOf(key);
      byService.set(s, [...(byService.get(s) ?? []), { value: key, label: key, detail: `${plural(info.permissions.length, "permission")} · ${info.operators.join(" ")}` }]);
    }
    return [
      ...[...byService].map(([s, options]) => ({ label: s, options })),
      { label: "global", options: ix.catalog.globals.map((g) => ({ value: g.key, label: g.key, detail: globalOperators(g).join(" ") })) },
    ];
  }, [ix]);
  const add = (key: string) => {
    const ops = key.startsWith("global:") ? globalOperators(ix.globals.get(key)) : ix.conditionKeys.get(key)?.operators ?? [];
    set((x) => ({ ...x, conds: [...x.conds, { id: uid(), key, op: defaultOp(ops), values: [] }] }));
  };
  return (
    <div style={card}>
      <Heading level={4}>More conditions</Heading>
      <Text style={{ ...hint, display: "block", margin: "4px 0 8px" }}>
        Any condition from the IAM policy reference: management zones (<span style={code}>environment:management-zone</span>), settings schemas and scopes, extensions,
        Grail tables and fieldsets, global date and time. Add the same condition twice to allow either value set (each statement is multiplied per line).
      </Text>
      {b.conds.map((c) => {
        const isGlobal = c.key.startsWith("global:");
        const g = ix.globals.get(c.key);
        const info = ix.conditionKeys.get(c.key);
        return (
          <ConditionRow
            key={c.id}
            condKey={c.key}
            label={<span style={codeWrap}>{c.key}</span>}
            description={isGlobal ? g?.description : info?.description}
            docHref={isGlobal ? (g ? globalDocUrl(g) : IAM_DOCS.globals.url) : IAM_DOCS.reference.url}
            operators={isGlobal ? globalOperators(g) : info?.operators ?? []}
            op={c.op}
            values={c.values}
            onChange={(op, values) => set((x) => ({ ...x, conds: x.conds.map((y) => (y.id === c.id ? { ...y, op, values } : y)) }))}
            onRemove={() => set((x) => ({ ...x, conds: x.conds.filter((y) => y.id !== c.id) }))}
            tf={tf}
            ix={ix}
            note={<Text style={hint}>{appliesTo(ix, c.key)}</Text>}
          />
        );
      })}
      <div style={{ marginTop: 8 }}>
        <AddSelect placeholder="Add condition" groups={groups} onAdd={add} width={360} />
      </div>
    </div>
  );
}

// --- Preview -----------------------------------------------------------------------------------------------------------
function PreviewCard({
  mode,
  policyText,
  onMode,
  onText,
  effective,
  statements,
  boundaryEmpty,
}: {
  mode: "creator" | "custom";
  policyText: string;
  onMode: (m: "creator" | "custom") => void;
  onText: (t: string) => void;
  effective: EffectiveRow[];
  statements: number;
  boundaryEmpty: boolean;
}) {
  const notNarrowed = [...new Set(effective.filter((r) => r.effect === "ALLOW" && !r.narrowed).map((r) => r.permission))];
  const [copied, setCopied] = useState(false);
  const copy = () =>
    void navigator.clipboard?.writeText(effective.map((r) => r.text).join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  return (
    <div style={card}>
      <Heading level={4}>Check against a policy</Heading>
      <Text style={{ ...hint, display: "block", margin: "4px 0 8px" }}>
        The effective statements when a policy is assigned with this boundary, worked out with the rules in{" "}
        <DocLink href={`${IAM_DOCS.boundaries.url}#apply-boundary`}>How are policy boundaries applied?</DocLink>: statements are split per permission, only
        conditions a permission supports are added, repeated conditions multiply a statement, and DENY stays as it is.
      </Text>
      <Flex gap={8} alignItems="center" flexWrap="wrap" style={{ marginBottom: 8 }}>
        <ToggleButtonGroup value={mode} onChange={(v: string) => v && onMode(v as "creator" | "custom")} name="iam-preview-source">
          <ToggleButtonGroup.Item value="creator">Policy from the IAM Policy Creator</ToggleButtonGroup.Item>
          <ToggleButtonGroup.Item value="custom">Other policy</ToggleButtonGroup.Item>
        </ToggleButtonGroup>
        {mode === "custom" && (
          <div style={{ width: 260 }}>
            <Select value={null} onChange={(v: string | null) => v && onText(POLICY_TEMPLATES.find((t) => t.id === v)?.text ?? "")} clearable aria-label="Load a docs pattern">
              <Select.Trigger placeholder="Load a docs pattern" />
              <Select.Content>
                {POLICY_TEMPLATES.map((t) => (
                  <Select.Option key={t.id} value={t.id} textValue={t.label}>
                    {t.label}
                  </Select.Option>
                ))}
              </Select.Content>
            </Select>
          </div>
        )}
      </Flex>
      {mode === "custom" ? (
        <div style={{ height: 140, border: "1px solid rgba(128,128,128,0.3)", borderRadius: 6, overflow: "hidden", marginBottom: 8 }}>
          <CodeEditor value={policyText} onChange={(v: string) => onText(v)} lineWrap fullHeight size="condensed" placeholder="Paste a policy, e.g. ALLOW storage:logs:read, storage:entities:read;" aria-label="Policy to check" />
        </div>
      ) : (
        !policyText.trim() && <Text style={{ ...hint, display: "block", marginBottom: 8 }}>The IAM Policy Creator has no policy yet. Build one there, or choose Other policy.</Text>
      )}
      {statements > 0 && (
        <>
          <Text style={{ display: "block", fontSize: 13, marginBottom: 6 }}>
            {plural(statements, "statement")} → {plural(effective.length, "effective statement")}.{" "}
            {boundaryEmpty
              ? "The boundary has no usable condition yet, so nothing is narrowed."
              : notNarrowed.length
                ? `Not narrowed: ${notNarrowed.join(", ")}.`
                : "Every ALLOW statement is narrowed."}
          </Text>
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {effective.map((r, i) => (
              <Flex key={i} gap={8} alignItems="flex-start" style={{ padding: "3px 0", borderTop: i ? "1px solid rgba(128,128,128,0.15)" : undefined }}>
                <div style={{ flex: "0 0 auto", paddingTop: 2 }}>
                  {r.effect === "DENY" ? (
                    <Chip size="condensed">DENY, unchanged</Chip>
                  ) : r.narrowed ? (
                    <Chip size="condensed" color="success">
                      narrowed
                    </Chip>
                  ) : (
                    <Chip size="condensed" color={r.ownConditions ? "warning" : "critical"}>
                      {r.ownConditions ? "own conditions only" : "unrestricted"}
                    </Chip>
                  )}
                </div>
                <Text style={{ fontFamily: "monospace", fontSize: 12, wordBreak: "break-word" }}>{r.text}</Text>
              </Flex>
            ))}
          </div>
          <Flex gap={8} alignItems="center" style={{ marginTop: 8 }}>
            <Button size="condensed" onClick={copy}>
              Copy effective statements
            </Button>
            {copied && <Text style={hint}>Copied</Text>}
          </Flex>
        </>
      )}
    </div>
  );
}
