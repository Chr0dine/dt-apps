import React, { useCallback, useMemo, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { FormField, Label, TextInput } from "@dynatrace/strato-components/forms";
import Colors from "@dynatrace/strato-design-tokens/colors";
import Spacings from "@dynatrace/strato-design-tokens/spacings";
import Borders from "@dynatrace/strato-design-tokens/borders";
import { useDql } from "../useDql";
import { useAIInsights } from "../AIInsights";
import { analyzeTags, type TagCoverage } from "../analyses";
import {
  ENTITY_LABELS,
  ENTITY_TYPES,
  TAG_NAME_RE,
  tagsQuery,
  type EntityType,
  type Timeframe,
} from "../queries";
import { MAX_ITEMS, usePrimaryTags, type ListState } from "../primaryTags";
import { PctGauge, QueryActions, QueryState, num, pct } from "../components";
import { EntitySearch } from "./EntitySearch";

const card: React.CSSProperties = {
  padding: Spacings.Size16,
  borderRadius: Borders.Radius.Container.Default,
  background: Colors.Background.Container.Neutral.Default,
};

/**
 * One configuration per list-driven tab. `normalize` turns raw input into the
 * stored key (or an error); `label` is what the gauge and insights show.
 */
type ListConfig = {
  title: string;
  blurb: React.ReactNode;
  editorTitle: string;
  inputLabel: string;
  placeholder: string;
  addLabel: string;
  emptyHint: string;
  queryTitle: string;
  suggestions?: string[];
  normalize: (raw: string, existing: string[]) => { key: string } | { error: string };
  label: (key: string) => string;
  query: (tf: Timeframe, keys: string[]) => string;
  analyze: (labels: string[], rows: TagCoverage[]) => ReturnType<typeof analyzeTags>;
};

const TAGS: ListConfig = {
  title: "Primary tags",
  blurb: (
    <>
      Customer-defined primary tags (<code>primary_tags.*</code>), for example team, app or stage. List the tag names you expect and see how many entities of
      each type carry them. Security context, cost center, cost product and host group have their own tabs.
    </>
  ),
  editorTitle: "Primary tags to check",
  inputLabel: "Tag name (primary_tags.<name>)",
  placeholder: "e.g. team",
  addLabel: "Add tag",
  emptyHint: "Add at least one tag name to see coverage.",
  queryTitle: "Primary tag coverage",
  normalize: (raw, existing) => {
    const key = raw.trim().replace(/^primary_tags\./, "");
    if (!TAG_NAME_RE.test(key)) return { error: "Start with a letter; use letters, digits, '.', '_' or '-' (max 63)." };
    if (existing.includes(key)) return { error: "Already listed." };
    return { key };
  },
  label: (k) => `primary_tags.${k}`,
  query: (tf, keys) => tagsQuery(tf, keys),
  analyze: analyzeTags,
};

/** Add / remove the items to check (tag names or fields). */
function ListEditor({ cfg, list }: { cfg: ListConfig; list: ListState }) {
  const { names, setNames } = list;
  const [draft, setDraft] = useState("");
  const parsed = draft.trim() ? cfg.normalize(draft, names) : null;
  const error = parsed && "error" in parsed ? parsed.error : names.length >= MAX_ITEMS && draft.trim() ? `At most ${MAX_ITEMS} items.` : null;
  const canAdd = !!parsed && "key" in parsed && !error;
  const add = (key: string) => {
    if (names.includes(key) || names.length >= MAX_ITEMS) return;
    setNames([...names, key]);
    setDraft("");
  };
  const suggestions = (cfg.suggestions ?? []).filter((s) => !names.includes(s));
  return (
    <div style={card}>
      <Heading level={4}>{cfg.editorTitle}</Heading>
      <Flex gap={16} alignItems="flex-end" flexWrap="wrap" style={{ marginTop: Spacings.Size8 }}>
        <FormField>
          <Label>{cfg.inputLabel}</Label>
          <TextInput value={draft} placeholder={cfg.placeholder} onChange={(v: string) => setDraft(v)} />
        </FormField>
        <Button variant="emphasized" disabled={!canAdd} onClick={() => parsed && "key" in parsed && add(parsed.key)}>
          {cfg.addLabel}
        </Button>
      </Flex>
      {error && <Text style={{ color: "#C21930" }}>{error}</Text>}
      {suggestions.length > 0 && (
        <Flex gap={8} flexWrap="wrap" alignItems="center" style={{ marginTop: Spacings.Size12 }}>
          <Text style={{ opacity: 0.7 }}>Suggestions:</Text>
          {suggestions.map((s) => (
            <Button key={s} variant="default" size="condensed" onClick={() => add(s)}>
              + {s}
            </Button>
          ))}
        </Flex>
      )}
      {names.length > 0 && (
        <Flex gap={8} flexWrap="wrap" style={{ marginTop: Spacings.Size12 }}>
          {names.map((n) => (
            <Button key={n} variant="default" size="condensed" onClick={() => setNames(names.filter((x) => x !== n))} aria-label={`Remove ${cfg.label(n)}`}>
              {cfg.label(n)} ✕
            </Button>
          ))}
        </Flex>
      )}
    </div>
  );
}

/** Mounted only when the list is not empty, so no query runs for an empty list. */
function ListCoverageView({ cfg, tf, keys }: { cfg: ListConfig; tf: Timeframe; keys: string[] }) {
  const query = cfg.query(tf, keys);
  const state = useDql(query);
  const labels = useMemo(() => keys.map((k) => cfg.label(k)), [cfg, keys]);
  const coverage = useMemo<TagCoverage[]>(() => {
    const byType = new Map<EntityType, Record<string, any>>();
    for (const rec of state.data?.records ?? []) byType.set(rec.type as EntityType, rec);
    const out: TagCoverage[] = [];
    for (const type of ENTITY_TYPES) {
      const rec = byType.get(type);
      const total = rec ? num(rec.total) : 0;
      if (!rec || total === 0) continue;
      labels.forEach((name, i) => {
        const part = num(rec[`t${i}`]);
        out.push({ type, name, part, total, pct: pct(part, total) });
      });
    }
    return out;
  }, [state.data, labels]);
  const { panel: aiPanel } = useAIInsights(useCallback(() => cfg.analyze(labels, coverage), [cfg, labels, coverage]));

  return (
    <QueryState state={state}>
      {aiPanel}
      <Flex flexDirection="column" gap={16}>
        {labels.map((label) => {
          const items = coverage.filter((c) => c.name === label);
          if (items.length === 0) return null;
          return (
            <div key={label} style={card}>
              <Heading level={4}>{label}</Heading>
              <Flex gap={16} flexWrap="wrap" style={{ marginTop: Spacings.Size8 }}>
                {ENTITY_TYPES.map((type) => {
                  const c = items.find((x) => x.type === type);
                  return c ? <PctGauge key={type} pct={c.pct} caption={ENTITY_LABELS[type].title} detail={`${c.part.toLocaleString()} of ${c.total.toLocaleString()}`} /> : null;
                })}
              </Flex>
            </div>
          );
        })}
        <QueryActions title={cfg.queryTitle} query={query} />
      </Flex>
    </QueryState>
  );
}

function EmptyInsights({ cfg }: { cfg: ListConfig }) {
  const { panel } = useAIInsights(useCallback(() => cfg.analyze([], []), [cfg]));
  return <>{panel}</>;
}

function ListTab({ cfg, tf, list }: { cfg: ListConfig; tf: Timeframe; list: ListState }) {
  return (
    <Flex flexDirection="column" gap={16}>
      <Heading level={3}>{cfg.title}</Heading>
      <Text>{cfg.blurb}</Text>
      <ListEditor cfg={cfg} list={list} />
      {list.names.length > 0 ? (
        <ListCoverageView cfg={cfg} tf={tf} keys={list.names} />
      ) : (
        <>
          <EmptyInsights cfg={cfg} />
          <Text style={{ opacity: 0.8 }}>{list.loaded ? cfg.emptyHint : "Loading saved items…"}</Text>
        </>
      )}
      <EntitySearch
        tf={tf}
        title="Search entities by primary tag"
        fields={list.names.map((n) => ({ key: n, label: cfg.label(n), expr: `\`primary_tags.${n}\`` }))}
        types={[...ENTITY_TYPES]}
      />
    </Flex>
  );
}

/** Customer-defined primary tags only (primary_tags.*). */
export function TagsTab({ tf }: { tf: Timeframe }) {
  return <ListTab cfg={TAGS} tf={tf} list={usePrimaryTags()} />;
}

