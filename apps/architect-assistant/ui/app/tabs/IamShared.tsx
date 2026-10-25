import React, { useMemo, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { MessageContainer } from "@dynatrace/strato-components/content";
import { CodeEditor, type InlineDiagnostic } from "@dynatrace/strato-components/editors";
import { Select, TextInput } from "@dynatrace/strato-components/forms";
import Colors from "@dynatrace/strato-design-tokens/colors";
import Spacings from "@dynatrace/strato-design-tokens/spacings";
import Borders from "@dynatrace/strato-design-tokens/borders";
import { QueryActions } from "../components";
import { settingsLink } from "../deepMonitoring";
import { OUTBOUND_SCHEMA } from "../deepDocs";
import {
  OPERATOR_HINT,
  SNAPSHOT_DATE,
  diffSize,
  isListOperator,
  type CatalogIndex,
  type IamCatalogState,
} from "../iamCatalog";
import type { Diagnostic } from "../iamPolicy";
import { GLOBAL_ATTRIBUTES, bindParam, schemaGroupsOf, useConditionValues, type ValueOption } from "../iamValues";
import type { Timeframe } from "../queries";

// ---------------------------------------------------------------------------
// Building blocks shared by the IAM Policy Creator and IAM Boundary Creator tabs: catalogue status banner, condition
// value picker (tenant suggestions + free text), operator select, condition row, and the editor pane on the right with
// live diagnostics, Copy to clipboard and Export .txt.
// ---------------------------------------------------------------------------

export const card: React.CSSProperties = {
  padding: Spacings.Size16,
  borderRadius: Borders.Radius.Container.Default,
  background: Colors.Background.Container.Neutral.Default,
};
export const hint: React.CSSProperties = { fontSize: 12, opacity: 0.75 };
export const linkStyle: React.CSSProperties = { color: "inherit", textDecoration: "underline", textUnderlineOffset: 2 };
export const code: React.CSSProperties = { fontFamily: "monospace", fontSize: 12, padding: "1px 4px", borderRadius: 4, background: "rgba(128,128,128,0.14)", whiteSpace: "nowrap" };
/** Code that may break anywhere (long condition keys in the narrow label column). */
export const codeWrap: React.CSSProperties = { ...code, whiteSpace: "normal", overflowWrap: "anywhere" };
const textButton: React.CSSProperties = { background: "none", border: "none", padding: 0, color: "inherit", textDecoration: "underline", cursor: "pointer", fontSize: 12 };

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function DocLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" style={linkStyle}>
      {children} ↗
    </a>
  );
}

export function DocLinks({ title = "IAM documentation", docs }: { title?: string; docs: { title: string; url: string }[] }) {
  return (
    <div>
      <Text style={{ ...hint, display: "block", fontWeight: 600 }}>{title}</Text>
      <Flex gap={12} flexWrap="wrap" style={{ marginTop: 4 }}>
        {docs.map((d) => (
          <Text key={d.url} style={{ fontSize: 12 }}>
            <DocLink href={d.url}>{d.title}</DocLink>
          </Text>
        ))}
      </Flex>
    </div>
  );
}

// --- Catalogue status ------------------------------------------------------------------------------------------------
/** Where the permission list comes from (live docs or the bundled snapshot) and what the live docs changed since the snapshot. */
export function CatalogBanner({
  state,
  missingHint = "Permissions added to the docs after the snapshot are missing here; type them in the editor if you need them.",
}: {
  state: IamCatalogState;
  /** What happens to permissions the snapshot does not list (the builders: type them; the Permissions Test: not tested). */
  missingHint?: string;
}) {
  const [open, setOpen] = useState(false);
  const updated = state.index.catalog.updated;
  const outbound = settingsLink(OUTBOUND_SCHEMA);
  const d = state.diff;
  const changes = diffSize(d);
  if (state.status === "loading")
    return <Text style={{ ...hint, display: "block" }}>Reading the IAM policy reference from docs.dynatrace.com… Until then the bundled snapshot of {SNAPSHOT_DATE} is used.</Text>;
  if (state.source === "snapshot")
    return (
      <MessageContainer variant="warning">
        <MessageContainer.Title>Using the bundled permission snapshot of {SNAPSHOT_DATE}</MessageContainer.Title>
        <MessageContainer.Description>
          {/* One span: the description lays out separate text nodes as flex items. */}
          <span>
            The live IAM policy reference could not be read
            {state.status === "blocked" ? (
              <>
                : add docs.dynatrace.com to the allowed outbound connections
                {outbound && (
                  <>
                    {" "}
                    (<DocLink href={outbound}>setting</DocLink>)
                  </>
                )}
                .
              </>
            ) : (
              <>: {state.message}.</>
            )}{" "}
            {missingHint}{" "}
            <button type="button" style={textButton} onClick={state.retry}>
              Retry
            </button>
          </span>
        </MessageContainer.Description>
      </MessageContainer>
    );
  return (
    <div style={{ ...card, padding: "10px 16px" }}>
      <Text style={{ fontSize: 13 }}>
        Permissions, conditions and operators are read live from the IAM policy reference{updated ? ` (updated ${updated})` : ""}
        {state.checkedAt ? ` at ${new Date(state.checkedAt).toLocaleTimeString()}` : ""}.{" "}
        {changes === 0 ? (
          `No change since the bundled snapshot of ${SNAPSHOT_DATE}.`
        ) : (
          <>
            Since the bundled snapshot of {SNAPSHOT_DATE}: {d!.added.length} new, {d!.removed.length} removed, {d!.changed.length} with changed conditions
            {d!.globals.length ? `, ${d!.globals.length} global condition changes` : ""}.{" "}
            <button type="button" style={textButton} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              {open ? "Hide changes" : "Show changes"}
            </button>
          </>
        )}
      </Text>
      {open && d && (
        <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12 }}>
          {d.added.map((id) => (
            <li key={`a${id}`}>
              New: <span style={code}>{id}</span>
            </li>
          ))}
          {d.removed.map((id) => (
            <li key={`r${id}`}>
              Removed: <span style={code}>{id}</span> (still in drafts? the editor flags it)
            </li>
          ))}
          {d.changed.map((c) => (
            <li key={`c${c.id}`}>
              <span style={code}>{c.id}</span>: {c.detail.join("; ")}
            </li>
          ))}
          {d.globals.map((g) => (
            <li key={`g${g}`}>Global condition: {g}</li>
          ))}
          <li style={{ listStyle: "none", marginLeft: -18, opacity: 0.75 }}>Maintainers: run npm run sync-iam -- --write to refresh the snapshot.</li>
        </ul>
      )}
    </div>
  );
}

// --- Operators -----------------------------------------------------------------------------------------------------
export function OperatorSelect({ value, operators, onChange, label }: { value: string; operators: string[]; onChange: (op: string) => void; label: string }) {
  const ops = operators.includes(value) ? operators : [value, ...operators];
  return (
    <div style={{ width: 150, flex: "0 0 auto" }} title={OPERATOR_HINT[value] ?? ""}>
      <Select value={value} onChange={(v: string | null) => v && onChange(v)} aria-label={label}>
        <Select.Trigger width="full" />
        <Select.Content width="max(100%, 200px)">
          {ops.map((op) => (
            <Select.Option key={op} value={op} textValue={op} aria-label={operators.includes(op) ? op : `${op}, not supported`}>
              {operators.includes(op) ? op : `⚠ ${op}`}
            </Select.Option>
          ))}
        </Select.Content>
      </Select>
    </div>
  );
}

/** Keeps values consistent with the operator: one value for single-value operators. */
export const valuesFor = (op: string, values: string[]) => (isListOperator(op) ? values : values.slice(0, 1));

// --- Value picker --------------------------------------------------------------------------------------------------
const MAX_SHOWN = 200;

function optionText(o: ValueOption) {
  return (
    <>
      {o.label && o.label !== o.value ? `${o.label} — ${o.value}` : o.value}
      {o.detail && o.detail !== o.value && <span style={{ opacity: 0.6, marginLeft: 8, fontSize: 12 }}>{o.detail}</span>}
    </>
  );
}

/**
 * Values of one condition: suggestions from the tenant (loaded the first time the list opens), documented fixed values
 * and the global attributes, plus whatever is typed (as a value or as a ${bindParam:…} binding parameter).
 */
export function ValuePicker({
  condKey,
  op,
  values,
  onChange,
  tf,
  ix,
  showQuery = "toggle",
}: {
  condKey: string;
  op: string;
  values: string[];
  onChange: (values: string[]) => void;
  tf: Timeframe;
  ix: CatalogIndex;
  /** How the DQL behind the suggestions is exposed: inline actions, a toggle, or not at all. */
  showQuery?: "inline" | "toggle" | "none";
}) {
  const multi = isListOperator(op);
  const [active, setActive] = useState(false);
  const [filter, setFilter] = useState("");
  const [queryOpen, setQueryOpen] = useState(false);
  const vals = useConditionValues(condKey, tf, active, ix);
  const typed = filter.trim();
  const selected = useMemo(() => values.map((v) => vals.options.find((o) => o.value === v) ?? GLOBAL_ATTRIBUTES.find((o) => o.value === v) ?? { value: v }), [values, vals.options]);
  const rest = useMemo(() => {
    const chosen = new Set(values);
    const needle = typed.toLowerCase();
    return [...vals.options, ...GLOBAL_ATTRIBUTES]
      .filter((o, i, all) => !chosen.has(o.value) && all.findIndex((x) => x.value === o.value) === i)
      .filter((o) => !needle || o.value.toLowerCase().includes(needle) || (o.label ?? "").toLowerCase().includes(needle) || (o.detail ?? "").toLowerCase().includes(needle));
  }, [vals.options, values, typed]);
  const known = (v: string) => values.includes(v) || vals.options.some((o) => o.value === v);
  const extra: ValueOption[] = typed
    ? [...(known(typed) ? [] : [{ value: typed, label: `Add “${typed}”` }]), ...(typed.startsWith("${") ? [] : [{ value: bindParam(typed), label: `Add binding parameter ${bindParam(typed)}` }])]
    : [];
  const status = vals.loading ? "Loading values from the tenant…" : vals.error ? `Could not load suggestions: ${vals.error}` : null;
  const pick = (next: string[]) => {
    setFilter("");
    onChange(valuesFor(op, next));
  };
  const options = [
    ...extra.map((o) => (
      <Select.Option key={`x:${o.value}`} value={o.value} textValue={o.value}>
        {o.label}
      </Select.Option>
    )),
    ...(status ? [<Select.Option key="status" value="__status__" textValue={status} disabled>{status}</Select.Option>] : []),
    ...selected.map((o) => (
      <Select.Option key={`s:${o.value}`} value={o.value} textValue={o.value}>
        {optionText(o)}
      </Select.Option>
    )),
    ...rest.slice(0, MAX_SHOWN).map((o) => (
      <Select.Option key={`o:${o.value}`} value={o.value} textValue={o.value}>
        {optionText(o)}
      </Select.Option>
    )),
    ...(rest.length > MAX_SHOWN ? [<Select.Option key="more" value="__more__" textValue="more" disabled>{`${rest.length - MAX_SHOWN} more: type to filter`}</Select.Option>] : []),
  ];
  const trigger = <Select.Trigger width="full" placeholder={vals.info.placeholder ? `e.g. ${vals.info.placeholder}` : multi ? "Select or type values" : "Select or type a value"} />;
  const content = (
    <Select.Content width="max(100%, 360px)">
      <Select.Filter disableFiltering value={filter} onChange={setFilter} />
      {options}
    </Select.Content>
  );
  const onOpen = (o: boolean) => o && setActive(true);
  return (
    <div style={{ minWidth: 220 }}>
      {multi ? (
        <Select multiple value={values} onChange={(v: string[]) => pick(v.filter((x) => !x.startsWith("__")))} onOpenChange={onOpen} clearable aria-label={`${condKey} values`}>
          {trigger}
          {content}
        </Select>
      ) : (
        <Select value={values[0] ?? null} onChange={(v: string | null) => pick(v && !v.startsWith("__") ? [v] : [])} onOpenChange={onOpen} clearable aria-label={`${condKey} value`}>
          {trigger}
          {content}
        </Select>
      )}
      {(vals.info.hint || (vals.query && showQuery === "toggle")) && (
        <Text style={{ ...hint, display: "block", marginTop: 4 }}>
          {vals.info.hint}
          {vals.query && showQuery === "toggle" && (
            <>
              {vals.info.hint ? " " : ""}
              <button type="button" style={textButton} onClick={() => (setQueryOpen((v) => !v), setActive(true))} aria-expanded={queryOpen}>
                {queryOpen ? "Hide values query" : "Values query"}
              </button>
            </>
          )}
        </Text>
      )}
      {vals.query && (showQuery === "inline" || queryOpen) && (
        <div style={{ marginTop: 6 }}>
          {vals.info.source.kind === "dql" && <Text style={{ ...hint, display: "block", marginBottom: 4 }}>{vals.info.source.note}</Text>}
          <QueryActions title={vals.query.title} query={vals.query.text} />
        </div>
      )}
      {condKey === "settings:schemaGroup" && <SchemaGroupLookup onAdd={(g) => pick([...values.filter((v) => v !== g), g])} />}
    </div>
  );
}

/** settings:schemaGroup: schema groups are only listed in each schema's definition, so they are looked up per schema. */
function SchemaGroupLookup({ onAdd }: { onAdd: (group: string) => void }) {
  const [schema, setSchema] = useState("");
  const [result, setResult] = useState<{ groups: string[]; error?: string } | null>(null);
  const run = () => {
    const id = schema.trim();
    if (!id) return;
    setResult(null);
    schemaGroupsOf(id)
      .then((groups) => setResult({ groups }))
      .catch((e) => setResult({ groups: [], error: (e as Error)?.message ?? String(e) }));
  };
  return (
    <Flex gap={8} alignItems="center" flexWrap="wrap" style={{ marginTop: 6 }}>
      <div style={{ width: 260 }}>
        <TextInput value={schema} onChange={(v: string) => setSchema(v)} placeholder="Schema ID, e.g. builtin:monitoring.slo" aria-label="Schema ID to look up" />
      </div>
      <Button size="condensed" onClick={run} disabled={!schema.trim()}>
        Look up groups
      </Button>
      {result?.error && <Text style={hint}>{result.error}</Text>}
      {result && !result.error && !result.groups.length && <Text style={hint}>This schema has no groups.</Text>}
      {result?.groups.map((g) => (
        <Button key={g} size="condensed" variant="accent" onClick={() => onAdd(g)}>
          + {g}
        </Button>
      ))}
    </Flex>
  );
}

// --- Add picker ----------------------------------------------------------------------------------------------------
export type AddGroup = { label: string; options: { value: string; label: string; detail?: string }[] };

/** A select that resets after each pick: "Add condition…", "Add global condition…". Filters on the option text. */
export function AddSelect({ placeholder, groups, onAdd, width = 320 }: { placeholder: string; groups: AddGroup[]; onAdd: (value: string) => void; width?: number }) {
  return (
    <div style={{ width, maxWidth: "100%" }}>
      <Select value={null} onChange={(v: string | null) => v && onAdd(v)} clearable aria-label={placeholder}>
        <Select.Trigger width="full" placeholder={placeholder} />
        <Select.Content width="max(100%, 420px)">
          <Select.Filter />
          {groups
            .filter((g) => g.options.length)
            .map((g) => (
              <Select.Group key={g.label}>
                <Select.GroupLabel>{g.label}</Select.GroupLabel>
                {g.options.map((o) => (
                  <Select.Option key={o.value} value={o.value} textValue={`${o.label} ${o.detail ?? ""}`}>
                    {o.label}
                    {o.detail && <span style={{ opacity: 0.6, marginLeft: 8, fontSize: 12 }}>{o.detail}</span>}
                  </Select.Option>
                ))}
              </Select.Group>
            ))}
        </Select.Content>
      </Select>
    </div>
  );
}

// --- Condition row -------------------------------------------------------------------------------------------------
export function ConditionRow({
  label,
  description,
  docHref,
  operators,
  op,
  values,
  onChange,
  onRemove,
  tf,
  ix,
  condKey,
  note,
}: {
  label: React.ReactNode;
  description?: string;
  docHref?: string;
  operators: string[];
  op: string;
  values: string[];
  onChange: (op: string, values: string[]) => void;
  onRemove?: () => void;
  tf: Timeframe;
  ix: CatalogIndex;
  condKey: string;
  note?: React.ReactNode;
}) {
  return (
    <div style={{ padding: "8px 0", borderTop: "1px solid rgba(128,128,128,0.18)" }}>
      <Flex gap={8} alignItems="flex-start" justifyContent="space-between">
        <Text style={{ display: "block", fontSize: 13, overflowWrap: "anywhere", minWidth: 0 }}>
          {label}
          {docHref && (
            <>
              {" "}
              <Text style={{ fontSize: 12 }}>
                <DocLink href={docHref}>docs</DocLink>
              </Text>
            </>
          )}
        </Text>
        {onRemove && (
          <Button size="condensed" onClick={onRemove} aria-label={`Remove ${condKey}`}>
            Remove
          </Button>
        )}
      </Flex>
      {description && <Text style={{ ...hint, display: "block", marginBottom: 4 }}>{description}</Text>}
      <Flex gap={8} alignItems="flex-start">
        <OperatorSelect value={op} operators={operators} onChange={(o) => onChange(o, valuesFor(o, values))} label={`${condKey} operator`} />
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          <ValuePicker condKey={condKey} op={op} values={values} onChange={(v) => onChange(op, v)} tf={tf} ix={ix} />
        </div>
      </Flex>
      {note && <div style={{ marginTop: 4 }}>{note}</div>}
    </div>
  );
}

// --- Editor pane -----------------------------------------------------------------------------------------------------
export const lineOf = (text: string, offset: number) => text.slice(0, offset).split("\n").length;

function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  // Fallback for frames without the async clipboard API.
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  return ok ? Promise.resolve() : Promise.reject(new Error("The browser blocked clipboard access."));
}

export function downloadText(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export const fileNameFor = (name: string, fallback: string) => `${(name.trim() || fallback).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || fallback}.txt`;

const SEVERITY_COLOR: Record<Diagnostic["severity"], string> = { error: "#C21930", warning: "#FF832B", info: "#4589FF" };

export function EditorPane({
  title,
  generated,
  manual,
  onEdit,
  onRegenerate,
  onLoadIntoBuilder,
  diagnostics,
  fileName,
  counter,
  placeholder,
  docs,
  loadNote,
}: {
  title: string;
  generated: string;
  manual: string | null;
  onEdit: (text: string | null) => void;
  onRegenerate: () => void;
  onLoadIntoBuilder: () => void;
  diagnostics: Diagnostic[];
  fileName: string;
  /** e.g. "3 of 100 statements". */
  counter: string;
  placeholder: string;
  docs: { title: string; url: string }[];
  loadNote?: React.ReactNode;
}) {
  const text = manual ?? generated;
  const [copied, setCopied] = useState<string | null>(null);
  const inline = useMemo<InlineDiagnostic[]>(
    () => diagnostics.map((d) => ({ from: Math.min(d.from, text.length), to: Math.min(Math.max(d.to, d.from + 1), text.length), message: d.message, severity: d.severity })),
    [diagnostics, text.length],
  );
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.filter((d) => d.severity === "warning").length;
  const copy = () =>
    copyText(text)
      .then(() => setCopied("Copied"))
      .catch((e) => setCopied((e as Error)?.message ?? "Copy failed"))
      .finally(() => setTimeout(() => setCopied(null), 2000));
  return (
    <Flex flexDirection="column" gap={8}>
      <Flex justifyContent="space-between" alignItems="baseline" flexWrap="wrap" gap={8}>
        <Heading level={4}>{title}</Heading>
        <Text style={hint}>
          {counter}
          {" · "}
          <span style={{ color: errors ? SEVERITY_COLOR.error : undefined }}>{plural(errors, "error")}</span>
          {" · "}
          <span style={{ color: warnings ? SEVERITY_COLOR.warning : undefined }}>{plural(warnings, "warning")}</span>
        </Text>
      </Flex>
      <div style={{ height: 460, border: "1px solid rgba(128,128,128,0.3)", borderRadius: 6, overflow: "hidden" }}>
        <CodeEditor
          value={text}
          onChange={(v: string) => onEdit(v === generated ? null : v)}
          diagnostics={inline}
          showLintGutter
          lineWrap
          fullHeight
          placeholder={placeholder}
          aria-label={title}
        />
      </div>
      {manual !== null && (
        <MessageContainer variant="neutral">
          <MessageContainer.Description>
            <span>
              Edited by hand: the selections on the left no longer change this text.{" "}
              <button type="button" style={textButton} onClick={onRegenerate}>
                Discard edits and regenerate
              </button>
              {" · "}
              <button type="button" style={textButton} onClick={onLoadIntoBuilder}>
                Load this text into the builder
              </button>
            </span>
          </MessageContainer.Description>
        </MessageContainer>
      )}
      {loadNote}
      <Flex gap={8} alignItems="center" flexWrap="wrap">
        <Button variant="emphasized" onClick={() => void copy()} disabled={!text.trim()}>
          Copy to clipboard
        </Button>
        <Button onClick={() => downloadText(text, fileName)} disabled={!text.trim()}>
          Export .txt
        </Button>
        {copied && <Text style={hint}>{copied}</Text>}
      </Flex>
      {diagnostics.length > 0 && (
        <div style={{ ...card, padding: "8px 12px", maxHeight: 220, overflowY: "auto" }}>
          {diagnostics.map((d, i) => (
            <Text key={i} style={{ display: "block", fontSize: 12, padding: "2px 0" }}>
              <span style={{ color: SEVERITY_COLOR[d.severity], fontWeight: 700, textTransform: "uppercase", fontSize: 10, marginRight: 6 }}>{d.severity}</span>
              Line {lineOf(text, d.from)}: {d.message}
            </Text>
          ))}
        </div>
      )}
      <DocLinks docs={docs} />
    </Flex>
  );
}
