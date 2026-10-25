import React, { useMemo, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { FormField, Label, Select, TextInput } from "@dynatrace/strato-components/forms";
import Colors from "@dynatrace/strato-design-tokens/colors";
import Spacings from "@dynatrace/strato-design-tokens/spacings";
import Borders from "@dynatrace/strato-design-tokens/borders";
import { ENTITY_LABELS, entitySearchQuery, type EntityType, type SearchField, type SearchMode, type Timeframe } from "../queries";
import { DrillDownTable, ShowEntitiesButton, type DrillColumn } from "../components";
import { entityOverviewLink } from "../links";

const card: React.CSSProperties = {
  padding: Spacings.Size16,
  borderRadius: Borders.Radius.Container.Default,
  background: Colors.Background.Container.Neutral.Default,
};

const MODES: { value: SearchMode; label: string; needsValue: boolean }[] = [
  { value: "has", label: "Has a value", needsValue: false },
  { value: "equals", label: "Equals", needsValue: true },
  { value: "contains", label: "Contains", needsValue: true },
  { value: "missing", label: "Is missing", needsValue: false },
];

/**
 * Searches Smartscape entities by one property (security context, cost, host group or a primary tag).
 * The query only runs when the user clicks Search; results come back as a table (max 500).
 * `types` lists the entity types the property applies to.
 */
export function EntitySearch({ tf, title, fields, types }: { tf: Timeframe; title: string; fields: SearchField[]; types: EntityType[] }) {
  const [typeKey, setTypeKey] = useState<string>("all");
  const [fieldKey, setFieldKey] = useState<string>(fields[0]?.key ?? "");
  const [mode, setMode] = useState<SearchMode>("has");
  const [value, setValue] = useState("");
  const [name, setName] = useState("");
  const [query, setQuery] = useState<string | null>(null);

  // Keep the selected field valid when the list of fields changes (e.g. primary tags added/removed).
  const field = fields.find((f) => f.key === fieldKey) ?? fields[0];
  const modeMeta = MODES.find((m) => m.value === mode) ?? MODES[0];
  const searchTypes = typeKey === "all" ? types : types.filter((t) => t === typeKey);
  const ready = !!field && searchTypes.length > 0 && (!modeMeta.needsValue || value.trim().length > 0);
  const reset = () => setQuery(null);
  const columns = useMemo<DrillColumn[]>(
    () => [
      { id: "name", header: "Name" },
      { id: "type", header: "Type" },
      { id: "id", header: "Entity ID" },
      { id: "value", header: field?.label ?? "Value" },
      {
        id: "overview",
        header: "Overview",
        cell: (row) => {
          const url = entityOverviewLink(String(row.type), String(row.id));
          return url ? (
            <a href={url} target="_blank" rel="noreferrer noopener">
              Open overview ↗
            </a>
          ) : (
            <>—</>
          );
        },
      },
    ],
    [field],
  );

  if (!field) {
    return (
      <div style={card}>
        <Heading level={4}>{title}</Heading>
        <Text style={{ opacity: 0.8 }}>Add at least one item above to search for entities.</Text>
      </div>
    );
  }

  return (
    <Flex flexDirection="column" gap={16}>
      <div style={card}>
        <Heading level={4}>{title}</Heading>
        <Flex gap={16} alignItems="flex-end" flexWrap="wrap" style={{ marginTop: Spacings.Size8 }}>
          {fields.length > 1 && (
            <FormField>
              <Label>Property</Label>
              <Select value={field.key} onChange={(v: string | null) => { if (v) { setFieldKey(v); reset(); } }}>
                <Select.Content>
                  {fields.map((f) => (
                    <Select.Option key={f.key} value={f.key}>
                      {f.label}
                    </Select.Option>
                  ))}
                </Select.Content>
              </Select>
            </FormField>
          )}
          <FormField>
            <Label>Entity type</Label>
            <Select value={typeKey} onChange={(v: string | null) => { if (v) { setTypeKey(v); reset(); } }}>
              <Select.Content>
                <Select.Option value="all">All applicable types</Select.Option>
                {types.map((t) => (
                  <Select.Option key={t} value={t}>
                    {ENTITY_LABELS[t].title}
                  </Select.Option>
                ))}
              </Select.Content>
            </Select>
          </FormField>
          <FormField>
            <Label>Match</Label>
            <Select value={mode} onChange={(v: SearchMode | null) => { if (v) { setMode(v); reset(); } }}>
              <Select.Content>
                {MODES.map((m) => (
                  <Select.Option key={m.value} value={m.value}>
                    {m.label}
                  </Select.Option>
                ))}
              </Select.Content>
            </Select>
          </FormField>
          {modeMeta.needsValue && (
            <FormField>
              <Label>Value</Label>
              <TextInput value={value} placeholder="Value to match" onChange={(v: string) => { setValue(v); reset(); }} />
            </FormField>
          )}
          <FormField>
            <Label>Name contains (optional)</Label>
            <TextInput value={name} placeholder="e.g. prod-" onChange={(v: string) => { setName(v); reset(); }} />
          </FormField>
          <ShowEntitiesButton
            onClick={() => {
              if (ready) setQuery(entitySearchQuery(tf, searchTypes, field, mode, value.trim(), name.trim()));
            }}
          >
            Search entities
          </ShowEntitiesButton>
        </Flex>
      </div>
      {query && <DrillDownTable key={query} title={`${field.label} search`} query={query} columns={columns} emptyText="No entities match this search." />}
    </Flex>
  );
}
