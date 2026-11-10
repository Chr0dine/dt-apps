import React, { useEffect, useMemo, useState } from "react";
import { OwnerTagForm } from "./OwnerTagForm";
import { AppCredentialsCard } from "./AppCredentials";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { Checkbox, Select, TextInput } from "@dynatrace/strato-components/forms";
import Colors from "@dynatrace/strato-design-tokens/colors";
import Spacings from "@dynatrace/strato-design-tokens/spacings";
import Borders from "@dynatrace/strato-design-tokens/borders";
import { getCurrentUserDetails } from "@dynatrace-sdk/app-environment";
import { useDql } from "../useDql";
import { QueryActions } from "../components";
import { syntheticMonitorsQuery, type Timeframe } from "../queries";
import type { FrontendRow } from "../frontends";
import { OWNER_TAG_DOCS, type DocLink, type SubmitResult } from "../remediation";
import { Field, Links, ManualActionView, Request, ResultLine } from "../RemediationPanel";
import {
  ASSIGN_DOCS,
  CREATE_MONITOR_DOCS,
  TOKEN_DOCS,
  HEALTH_DOCS,
  REPLAY_DOCS,
  RUM_DOCS,
  USER_TAG_DOCS,
  WEB_ALERTS,
  applyEnablement,
  assignMonitor,
  buildAssignBody,
  buildEnablementBody,
  buildHealthAlertBody,
  classicWebAppLink,
  createHealthAlerts,
  openCreateMonitor,
  userTagAction,
  vitalsSettingsLink,
  type EnablementChange,
  type MonitorOption,
} from "../frontendActions";

const box: React.CSSProperties = {
  padding: Spacings.Size16,
  borderRadius: Borders.Radius.Container.Default,
  background: Colors.Background.Container.Neutral.Default,
};
const hint: React.CSSProperties = { fontSize: 12, opacity: 0.7 };
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Request preview: the first two objects, then a count of the rest (all in one call). */
function preview(body: unknown[]): string {
  return JSON.stringify(body.slice(0, 2), null, 2) + (body.length > 2 ? `\n// … ${body.length - 2} more objects in the same request` : "");
}

/** Checkbox list of frontends; starts with the frontends that fail the check. */
function FrontendPicker({
  frontends,
  failing,
  selected,
  onChange,
  note,
}: {
  frontends: FrontendRow[];
  failing: (f: FrontendRow) => boolean;
  selected: string[];
  onChange: (ids: string[]) => void;
  note?: (f: FrontendRow) => string;
}) {
  const failingIds = frontends.filter(failing).map((f) => f.id);
  const toggle = (id: string, on: boolean) => onChange(on ? [...selected, id] : selected.filter((x) => x !== id));
  return (
    <Flex flexDirection="column" gap={6}>
      <Flex gap={8} alignItems="center" flexWrap="wrap">
        <Text style={{ fontWeight: 600 }}>Frontends ({selected.length} selected)</Text>
        <Button size="condensed" onClick={() => onChange(failingIds)}>
          Failing ({failingIds.length})
        </Button>
        <Button size="condensed" onClick={() => onChange(frontends.map((f) => f.id))}>
          All ({frontends.length})
        </Button>
        <Button size="condensed" onClick={() => onChange([])}>
          None
        </Button>
      </Flex>
      <div style={{ maxHeight: 200, overflowY: "auto", padding: 8, border: "1px solid rgba(128,128,128,0.25)", borderRadius: 6 }}>
        {frontends.map((f) => (
          <Checkbox key={f.id} value={selected.includes(f.id)} onChange={(v: boolean) => toggle(f.id, v)}>
            {f.name}
            <span style={{ ...hint, marginLeft: 8 }}>{note ? note(f) : failing(f) ? "fails" : "passes"}</span>
          </Checkbox>
        ))}
      </div>
    </Flex>
  );
}

/** Validate / confirm / apply block shared by every API action. */
function ApplyControls({
  disabled,
  confirmText,
  applyLabel,
  run,
}: {
  disabled: boolean;
  confirmText: string;
  applyLabel: string;
  run: (validateOnly: boolean) => Promise<SubmitResult>;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const go = async (validateOnly: boolean) => {
    setBusy(true);
    setResult(await run(validateOnly));
    setBusy(false);
    if (!validateOnly) setConfirm(false);
  };
  return (
    <Flex flexDirection="column" gap={8}>
      <Checkbox value={confirm} onChange={(v: boolean) => setConfirm(v)} disabled={disabled}>
        {confirmText}
      </Checkbox>
      <Flex gap={8}>
        <Button variant="default" disabled={busy || disabled} onClick={() => void go(true)}>
          Validate
        </Button>
        <Button variant="emphasized" disabled={busy || disabled || !confirm} onClick={() => void go(false)}>
          {applyLabel}
        </Button>
      </Flex>
      <ResultLine result={result} />
    </Flex>
  );
}

const enabledNote = (f: FrontendRow) =>
  `${f.rumV2 ? "RUM v2" : f.rumClassic ? "RUM classic only" : "RUM off"} · ${f.replayGrail ? "Replay on Grail" : f.replayClassic ? "Replay classic only" : "Replay off"}${f.inherited ? " · inherits environment" : ""}`;

// --- API: RUM v2 / Session Replay ------------------------------------------------------------------------------
function EnablementForm({ frontends, kind, onDone }: { frontends: FrontendRow[]; kind: "rum" | "replay"; onDone: () => void }) {
  const failing = kind === "rum" ? (f: FrontendRow) => !f.rumV2 : (f: FrontendRow) => !f.replayGrail;
  const [selected, setSelected] = useState(() => frontends.filter(failing).map((f) => f.id));
  const [replayGrail, setReplayGrail] = useState(true);
  const change: EnablementChange = kind === "rum" ? { rumV2: true, replay: false, replayGrail: false } : { rumV2: false, replay: true, replayGrail };
  const targets = frontends.filter((f) => selected.includes(f.id));
  const body = buildEnablementBody(targets, change);
  return (
    <Flex flexDirection="column" gap={12}>
      <Text>
        {kind === "rum"
          ? "Turns on RUM v2 (New RUM Experience, data in Grail) and keeps RUM classic on, which RUM v2 requires. Cost and traffic control and every other value stay as they are."
          : "Turns on Session Replay (and RUM classic, which it requires). Session Replay on Grail scores 100%, classic only 50%. Replay validators check your license and Session Replay storage, so run Validate first."}
      </Text>
      {kind === "replay" && (
        <Checkbox value={replayGrail} onChange={(v: boolean) => setReplayGrail(v)}>
          Also enable Session Replay on Grail (latest Session Replay)
        </Checkbox>
      )}
      <FrontendPicker frontends={frontends} failing={failing} selected={selected} onChange={setSelected} note={enabledNote} />
      {targets.length > 0 && <Request label={`Request (1 API call for ${plural(targets.length, "frontend")})`} text={preview(body)} />}
      <ApplyControls
        disabled={targets.length === 0}
        confirmText={`Change the RUM enablement setting of ${plural(targets.length, "frontend")}`}
        applyLabel={kind === "rum" ? "Enable RUM v2" : "Enable Session Replay"}
        run={async (validateOnly) => {
          const r = await applyEnablement(targets, change, validateOnly);
          if (r.ok && !validateOnly) onDone();
          return r;
        }}
      />
    </Flex>
  );
}

// --- API: health alerts ----------------------------------------------------------------------------------------
function HealthAlertForm({ frontends, onDone }: { frontends: FrontendRow[]; onDone: () => void }) {
  const [selected, setSelected] = useState(() => frontends.filter((f) => f.healthAlerts === 0).map((f) => f.id));
  const [keys, setKeys] = useState(() => WEB_ALERTS.filter((a) => a.recommended).map((a) => a.key));
  const [actor, setActor] = useState(() => {
    try {
      return getCurrentUserDetails().id;
    } catch {
      return "";
    }
  });
  const targets = frontends.filter((f) => selected.includes(f.id));
  const body = buildHealthAlertBody(keys, targets, actor.trim());
  return (
    <Flex flexDirection="column" gap={12}>
      <Text>
        Creates one health alert per selected type for the selected frontends (up to 100 frontends per alert). Frontends that already have an enabled alert of a
        type are skipped for that type. Analyzer settings are the defaults; tune them later in Experience Vitals. An environment allows up to 300 health alerts.
      </Text>
      <Flex flexDirection="column" gap={4}>
        <Text style={{ fontWeight: 600 }}>Alert types</Text>
        <Flex gap={16} flexWrap="wrap">
          {WEB_ALERTS.map((a) => (
            <Checkbox key={a.key} value={keys.includes(a.key)} onChange={(v: boolean) => setKeys(v ? [...keys, a.key] : keys.filter((k) => k !== a.key))}>
              {a.label}
            </Checkbox>
          ))}
        </Flex>
      </Flex>
      <Field label="Actor (user or service user ID the alert runs as)">
        <TextInput value={actor} onChange={(v: string) => setActor(v)} placeholder="user or service user UUID" />
      </Field>
      <Text style={hint}>Defaults to you. Dynatrace recommends a service user so the alert keeps running if your account changes.</Text>
      <FrontendPicker
        frontends={frontends}
        failing={(f) => f.healthAlerts === 0}
        selected={selected}
        onChange={setSelected}
        note={(f) => (f.healthAlerts ? plural(f.healthAlerts, "alert") : "no alerts")}
      />
      {body.length > 0 && <Request label={`Request (1 API call, ${plural(body.length, "alert")})`} text={preview(body)} />}
      <ApplyControls
        disabled={body.length === 0 || !actor.trim()}
        confirmText={`Create ${plural(body.length, "health alert")} for ${plural(targets.length, "frontend")}`}
        applyLabel="Create health alerts"
        run={async (validateOnly) => {
          const r = await createHealthAlerts(keys, targets, actor.trim(), validateOnly);
          if (r.ok && !validateOnly) onDone();
          return r;
        }}
      />
    </Flex>
  );
}

// --- API: assign an existing monitor ---------------------------------------------------------------------------
function AssignMonitorForm({ frontends, tf }: { frontends: FrontendRow[]; tf: Timeframe }) {
  const query = syntheticMonitorsQuery(tf);
  const state = useDql(query);
  const monitors = useMemo<MonitorOption[]>(
    () => (state.data?.records ?? []).map((r) => ({ id: String(r.id), name: String(r.name ?? r.id), kind: r.kind === "HTTP" ? "HTTP" : "Browser", apps: (r.apps ?? []) as string[] })),
    [state.data],
  );
  const [monitorId, setMonitorId] = useState<string | null>(null);
  const monitor = monitors.find((m) => m.id === monitorId);
  const [selected, setSelected] = useState(() => frontends.filter((f) => f.monitors === 0).map((f) => f.id));
  const newIds = selected.filter((id) => !monitor?.apps.includes(id));
  return (
    <Flex flexDirection="column" gap={12}>
      <Text>
        Adds the selected frontends to an existing browser or HTTP monitor. The monitor&apos;s current assignments are read first and kept, so nothing is
        removed (1 GET + 1 POST).
      </Text>
      <Field label="Monitor">
        <Select value={monitorId} onChange={(v: string | null) => setMonitorId(v)}>
          <Select.Content>
            <Select.EmptyState>No monitor matches that name.</Select.EmptyState>
            <Select.Filter />
            {monitors.map((m) => (
              <Select.Option key={m.id} value={m.id}>
                {`${m.kind} · ${m.name}`}
              </Select.Option>
            ))}
          </Select.Content>
        </Select>
      </Field>
      {state.error && <Text style={{ color: "#C21930" }}>{state.error}</Text>}
      <FrontendPicker
        frontends={frontends}
        failing={(f) => f.monitors === 0}
        selected={selected}
        onChange={setSelected}
        note={(f) => (monitor?.apps.includes(f.id) ? "already assigned to this monitor" : f.monitors ? plural(f.monitors, "monitor") : "no monitors")}
      />
      {monitor && newIds.length > 0 && (
        <Request label="Request (1 API call; current assignments are merged in at send time)" text={preview(buildAssignBody(monitor.id, [...monitor.apps, ...newIds]))} />
      )}
      <ApplyControls
        disabled={!monitor || newIds.length === 0}
        confirmText={monitor ? `Assign ${monitor.name} to ${plural(newIds.length, "more frontend")}` : "Pick a monitor first"}
        applyLabel="Assign monitor"
        run={(validateOnly) => assignMonitor(monitor!.id, newIds, validateOnly)}
      />
      <QueryActions title="Synthetic monitors and assigned frontends" query={query} />
    </Flex>
  );
}

// --- Links: create monitor, user tags, Experience Vitals settings ---------------------------------------------
function CreateMonitorLink({ frontends }: { frontends: FrontendRow[] }) {
  const [type, setType] = useState<"browser" | "http">("browser");
  const [selected, setSelected] = useState(() => frontends.filter((f) => f.monitors === 0).map((f) => f.id));
  return (
    <Flex flexDirection="column" gap={12}>
      <Text>
        Creating a monitor needs a URL and steps, so it cannot be done in bulk here. This opens the Synthetic app with a new monitor that already has the selected
        frontends assigned.
      </Text>
      <Field label="Monitor type">
        <Select value={type} onChange={(v: "browser" | "http" | null) => v && setType(v)}>
          <Select.Content>
            <Select.Option value="browser">Browser monitor</Select.Option>
            <Select.Option value="http">HTTP monitor</Select.Option>
          </Select.Content>
        </Select>
      </Field>
      <FrontendPicker frontends={frontends} failing={(f) => f.monitors === 0} selected={selected} onChange={setSelected} note={(f) => (f.monitors ? plural(f.monitors, "monitor") : "no monitors")} />
      <Flex>
        <Button variant="emphasized" disabled={selected.length === 0} onClick={() => openCreateMonitor(type, selected)}>
          ↗ Create {type === "browser" ? "browser" : "HTTP"} monitor in Synthetic
        </Button>
      </Flex>
    </Flex>
  );
}

/** One link per frontend that fails a check. */
function FrontendLinks({ items, empty }: { items: { id: string; name: string; href?: string; note?: string }[]; empty: string }) {
  if (items.length === 0) return <Text>{empty}</Text>;
  return (
    <ul style={{ margin: 0, paddingLeft: 18, maxHeight: 220, overflowY: "auto" }}>
      {items.map((i) => (
        <li key={i.id}>
          {i.href ? (
            <a href={i.href} target="_blank" rel="noreferrer noopener">
              ↗ {i.name}
            </a>
          ) : (
            <Text>{i.name}</Text>
          )}
          {i.note && <Text style={{ ...hint, marginLeft: 8 }}>{i.note}</Text>}
        </li>
      ))}
    </ul>
  );
}

function UserTagLinks({ frontends, measured }: { frontends: FrontendRow[]; measured: boolean }) {
  const items = frontends
    .filter((f) => (measured ? f.userTagRules === 0 : true))
    .map((f) => ({ id: f.id, name: f.name, href: classicWebAppLink(f.id), note: f.userTagRules === null ? "not measured" : "no user tag rule" }));
  return (
    <Flex flexDirection="column" gap={12}>
      <ManualActionView action={userTagAction} />
      <FrontendLinks items={items} empty="Every frontend has a user tag rule." />
    </Flex>
  );
}

function VitalsLinks({ frontends, failing, what }: { frontends: FrontendRow[]; failing: (f: FrontendRow) => boolean; what: string }) {
  const items = frontends.filter(failing).map((f) => ({ id: f.id, name: f.name, href: vitalsSettingsLink(f.id), note: enabledNote(f) }));
  return (
    <Flex flexDirection="column" gap={12}>
      <Text>Opens each frontend&apos;s Settings tab in Experience Vitals (Enablement and cost control, Health alerts) to configure {what} one frontend at a time.</Text>
      <FrontendLinks items={items} empty={`Every frontend already passes this check.`} />
    </Flex>
  );
}

// --- Panel -----------------------------------------------------------------------------------------------------
type ActionDef = { id: string; label: string; kind: "api" | "link"; node: React.ReactNode; docs: DocLink[] };

/** "Actions" section at the bottom of the Frontends tab: bulk fixes for every check, or links where no API exists. */
export function FrontendActions({
  frontends,
  tf,
  measuredUserTags,
  onChanged,
  initialAction,
}: {
  frontends: FrontendRow[];
  tf: Timeframe;
  measuredUserTags: boolean;
  onChanged: () => void;
  /** Action to show first (e.g. "user-tag-token" when user tagging is not measured yet). */
  initialAction?: string;
}) {
  const count = (fn: (f: FrontendRow) => boolean) => frontends.filter(fn).length;
  const actions: ActionDef[] = [
    { id: "rum", label: "Enable RUM v2", kind: "api", node: <EnablementForm frontends={frontends} kind="rum" onDone={onChanged} />, docs: RUM_DOCS },
    { id: "replay", label: "Enable Session Replay", kind: "api", node: <EnablementForm frontends={frontends} kind="replay" onDone={onChanged} />, docs: REPLAY_DOCS },
    { id: "health", label: "Create health alerts", kind: "api", node: <HealthAlertForm frontends={frontends} onDone={onChanged} />, docs: HEALTH_DOCS },
    { id: "assign", label: "Assign an existing synthetic monitor", kind: "api", node: <AssignMonitorForm frontends={frontends} tf={tf} />, docs: ASSIGN_DOCS },
    { id: "create-monitor", label: "Create a synthetic monitor", kind: "link", node: <CreateMonitorLink frontends={frontends} />, docs: CREATE_MONITOR_DOCS },
    { id: "owner", label: "Assign owning team", kind: "api", node: <OwnerTagForm targets={frontends.map((f) => ({ id: f.id, name: f.name, typeLabel: "Frontend", owner: f.owner }))} onDone={onChanged} />, docs: OWNER_TAG_DOCS },
    { id: "user-tag-token", label: "Set up the user tagging token", kind: "api", node: <AppCredentialsCard use="readconfig" onChanged={onChanged} />, docs: TOKEN_DOCS },
    { id: "user-tags", label: "Configure user tagging", kind: "link", node: <UserTagLinks frontends={frontends} measured={measuredUserTags} />, docs: USER_TAG_DOCS },
    {
      id: "vitals",
      label: "Open frontend settings (RUM, Session Replay, health alerts)",
      kind: "link",
      node: <VitalsLinks frontends={frontends} failing={(f) => !f.rumV2 || !f.replayGrail || f.healthAlerts === 0} what="RUM, Session Replay and health alerts" />,
      docs: [...RUM_DOCS, ...REPLAY_DOCS, ...HEALTH_DOCS],
    },
  ];
  const [pick, setPick] = useState(initialAction ?? "rum");
  // The user-tag status arrives after mount; switch to the suggested action once it is known.
  useEffect(() => {
    if (initialAction) setPick(initialAction);
  }, [initialAction]);
  const active = actions.find((a) => a.id === pick) ?? actions[0];
  const impact = `${count((f) => !f.rumV2)} without RUM v2, ${count((f) => !f.replayGrail)} without Session Replay on Grail, ${count((f) => f.monitors === 0)} without synthetic monitors, ${count((f) => f.healthAlerts === 0)} without health alerts${measuredUserTags ? `, ${count((f) => f.userTagRules === 0)} without user tag rules` : ""}, ${count((f) => !f.owner)} without an owning team.`;
  return (
    <div style={{ ...box, marginTop: Spacings.Size16 }}>
      <Flex justifyContent="space-between" alignItems="flex-end" flexWrap="wrap" gap={12}>
        <div>
          <Heading level={3} style={{ margin: 0 }}>
            Actions
          </Heading>
          <Text style={{ opacity: 0.8 }}>{impact}</Text>
        </div>
        <Field label="Action">
          <Select value={active.id} onChange={(v: string | null) => v && setPick(v)}>
            <Select.Content>
              {actions.map((a) => (
                <Select.Option key={a.id} value={a.id}>
                  {a.kind === "api" ? "API · " : "Link · "}
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
      {active.docs.length > 0 && (
        <Flex gap={12} flexWrap="wrap" alignItems="center" style={{ marginTop: Spacings.Size16 }}>
          <Text style={hint}>Documentation:</Text>
          <Links docs={active.docs} />
        </Flex>
      )}
    </div>
  );
}
