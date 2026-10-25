import React, { useMemo, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { Checkbox, Select, TextInput } from "@dynatrace/strato-components/forms";
import { OWNER_KEYS } from "../queries";
import { applyOwnerTag, checkOwnerTag, ownerTagBody, ownerTagSelectors, type SubmitResult } from "../remediation";
import { Field, Request, ResultLine, useExistingTeams } from "../RemediationPanel";

/** A classic entity that can carry an owner tag (frontend, browser or HTTP monitor). */
export type OwnerTarget = { id: string; name: string; typeLabel: string; owner: string | null };

const hint: React.CSSProperties = { fontSize: 12, opacity: 0.7 };
const CUSTOM = "__custom__";
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * Adds a classic owner tag (`dt.owner:<team>`) to the selected frontends / synthetic monitors. Starts with every
 * entity that has no owner selected. One POST /api/v2/tags per entity type and 60 entities.
 */
export function OwnerTagForm({ targets, onDone }: { targets: OwnerTarget[]; onDone?: () => void }) {
  const { teams, error: teamsError } = useExistingTeams();
  const types = useMemo(() => Array.from(new Set(targets.map((t) => t.typeLabel))), [targets]);
  const [typeFilter, setTypeFilter] = useState("all");
  const [selected, setSelected] = useState(() => targets.filter((t) => !t.owner).map((t) => t.id));
  const [key, setKey] = useState(OWNER_KEYS[0]);
  const [teamPick, setTeamPick] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);

  const visible = targets.filter((t) => typeFilter === "all" || t.typeLabel === typeFilter);
  const value = teamPick === CUSTOM || !teamPick ? custom : teamPick;
  const ids = selected.filter((id) => targets.some((t) => t.id === id));
  const check = checkOwnerTag(value, teams);
  const selectors = ownerTagSelectors(ids);
  const toggle = (id: string, on: boolean) => setSelected(on ? [...selected, id] : selected.filter((x) => x !== id));
  const unowned = visible.filter((t) => !t.owner).map((t) => t.id);

  const run = async (validateOnly: boolean) => {
    if (validateOnly) {
      // The tags API has no dry run: validate the input and the team, and show what would be sent.
      setResult(
        check.error
          ? { ok: false, message: check.error }
          : { ok: !check.warning, message: check.warning ?? `Valid: ${plural(ids.length, "entity", "entities")} would get ${key}:${value.trim()} in ${plural(selectors.length, "API call")}. Nothing was changed.` },
      );
      return;
    }
    setBusy(true);
    const r = await applyOwnerTag(ids, key, value);
    setResult(r);
    setBusy(false);
    setConfirm(false);
    if (r.ok) onDone?.();
  };

  return (
    <Flex flexDirection="column" gap={12}>
      <Text>
        Frontends and synthetic monitors are classic entities: ownership is a classic tag whose key is an ownership key (dt.owner, owner or team) and whose
        value is a team identifier. Entities that already have an owner keep it; adding a second team makes them co-owned.
      </Text>
      <Flex gap={16} flexWrap="wrap" alignItems="flex-end">
        <Field label="Tag key">
          <Select value={key} onChange={(v: string | null) => v && setKey(v)}>
            <Select.Content>
              {OWNER_KEYS.map((k) => (
                <Select.Option key={k} value={k}>
                  {k}
                </Select.Option>
              ))}
            </Select.Content>
          </Select>
        </Field>
        <Field label="Owning team">
          <Select value={teamPick} onChange={(v: string | null) => setTeamPick(v)}>
            <Select.Trigger placeholder={teams ? "Pick a team" : "Loading teams…"} />
            <Select.Content>
              <Select.EmptyState>No team matches that name.</Select.EmptyState>
              <Select.Filter />
              <Select.Option value={CUSTOM}>Other identifier…</Select.Option>
              {(teams ?? []).map((t) => (
                <Select.Option key={t.identifier} value={t.identifier}>
                  {t.name && t.name !== t.identifier ? `${t.name} (${t.identifier})` : t.identifier}
                </Select.Option>
              ))}
            </Select.Content>
          </Select>
        </Field>
        {(teamPick === CUSTOM || (teams && teams.length === 0)) && (
          <Field label="Team identifier">
            <TextInput value={custom} onChange={(v: string) => setCustom(v)} placeholder="e.g. team-checkout" />
          </Field>
        )}
        {types.length > 1 && (
          <Field label="Show">
            <Select value={typeFilter} onChange={(v: string | null) => v && setTypeFilter(v)}>
              <Select.Content>
                <Select.Option value="all">All types</Select.Option>
                {types.map((t) => (
                  <Select.Option key={t} value={t}>
                    {t}
                  </Select.Option>
                ))}
              </Select.Content>
            </Select>
          </Field>
        )}
      </Flex>
      {teamsError && <Text style={hint}>Could not read teams ({teamsError}); type the identifier instead.</Text>}
      <Flex flexDirection="column" gap={6}>
        <Flex gap={8} alignItems="center" flexWrap="wrap">
          <Text style={{ fontWeight: 600 }}>Entities ({ids.length} selected)</Text>
          <Button size="condensed" onClick={() => setSelected(Array.from(new Set([...selected, ...unowned])))}>
            + Without owner ({unowned.length})
          </Button>
          <Button size="condensed" onClick={() => setSelected(Array.from(new Set([...selected, ...visible.map((t) => t.id)])))}>
            + All shown ({visible.length})
          </Button>
          <Button size="condensed" onClick={() => setSelected([])}>
            None
          </Button>
        </Flex>
        <div style={{ maxHeight: 220, overflowY: "auto", padding: 8, border: "1px solid rgba(128,128,128,0.25)", borderRadius: 6 }}>
          {visible.map((t) => (
            <Checkbox key={t.id} value={selected.includes(t.id)} onChange={(v: boolean) => toggle(t.id, v)}>
              {t.name}
              <span style={{ ...hint, marginLeft: 8 }}>
                {types.length > 1 ? `${t.typeLabel} · ` : ""}
                {t.owner ? `owner: ${t.owner}` : "no owner"}
              </span>
            </Checkbox>
          ))}
        </div>
      </Flex>
      {ids.length > 0 && value.trim() && (
        <Request
          label={`Request (${plural(selectors.length, "API call")} for ${plural(ids.length, "entity", "entities")})`}
          text={`POST /api/v2/tags?entitySelector=${selectors[0]}${selectors.length > 1 ? ` (+${selectors.length - 1} more)` : ""}\n${JSON.stringify(ownerTagBody(key, value), null, 2)}`}
        />
      )}
      <Checkbox value={confirm} onChange={(v: boolean) => setConfirm(v)} disabled={!!check.error || ids.length === 0}>
        Add the tag {key}:{value.trim() || "…"} to {plural(ids.length, "entity", "entities")}
      </Checkbox>
      <Flex gap={8}>
        <Button variant="default" disabled={busy || ids.length === 0} onClick={() => void run(true)}>
          Validate
        </Button>
        <Button variant="emphasized" disabled={busy || ids.length === 0 || !!check.error || !confirm} onClick={() => void run(false)}>
          Assign owner
        </Button>
      </Flex>
      <ResultLine result={result} />
    </Flex>
  );
}
