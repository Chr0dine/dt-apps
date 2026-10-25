import { dqlString } from "./queries";

// ---------------------------------------------------------------------------
// Classic alerting profile (`builtin:alerting.profile`) -> DQL matcher for a workflow's Davis problem trigger, so the
// trigger filters on problem fields instead of the deprecated labels.alerting_profile.
// Semantics (alerting profiles docs): management zone AND severity rules AND event filters. Severity rules are ORed;
// inside a rule, category AND open duration AND tags. Non-negated event filters are ORed, negated ones ANDed, and
// the two groups ANDed. Event filters test the events inside the problem.
// Grail problem fields used (validated on the demo tenant with dtctl):
//   - severity -> event.category (PERFORMANCE = SLOWDOWN, ERRORS = ERROR); classic severities never match INFO;
//   - delay -> dt.duration_marker (milestone reached since event.start: 5, 10, 15, 30 min, 1, 2, 4, 24 h, 7 d; never
//     ahead of the elapsed time). Classic counted from when it opened the problem (a few minutes later), so short
//     problems near the threshold notify through the workflow but did not through classic;
//   - classic tags -> entity_tags (deprecated, Gen 2), matched exactly as the profile lists them;
//   - predefined event type -> its event names (dt.davis.events, last 30 days) as phrases in event.description, which
//     names every event of the problem; custom title -> event.name (problem title), description -> event.description
//     (problem summary), properties -> problem fields with the same key;
//   - management zone: problems carry none, so such profiles are not translated.
// Trigger matchers have no contains/startsWith/endsWith and no case-sensitive matchesValue (`dtctl verify
// openpipeline-matcher`), so text operators use matchesValue wildcards and only case-sensitive equals stays exact (==).
// ---------------------------------------------------------------------------

type TextFilter = { enabled?: boolean; negate?: boolean; caseSensitive?: boolean; operator?: string; value?: string };
type SeverityRule = { severityLevel?: string; delayInMinutes?: number; tagFilterIncludeMode?: string; tagFilter?: string[] };
type EventFilter = {
  type?: string;
  predefinedFilter?: { eventType?: string; negate?: boolean };
  customFilter?: {
    titleFilter?: TextFilter;
    descriptionFilter?: TextFilter;
    metadataFilter?: { metadataFilterItems?: { metadataKey?: string; metadataValue?: string; negate?: boolean }[] };
  };
};
export type AlertingProfile = { id: string; name: string; managementZone: string | null; severityRules: SeverityRule[]; eventFilters: EventFilter[] };

export const toProfile = (id: string, v: Record<string, any>): AlertingProfile => ({
  id,
  name: String(v.name ?? ""),
  managementZone: v.managementZone ? String(v.managementZone) : null,
  severityRules: Array.isArray(v.severityRules) ? v.severityRules : [],
  eventFilters: Array.isArray(v.eventFilters) ? v.eventFilters : [],
});

const SEVERITY_CATEGORY: Record<string, string> = {
  AVAILABILITY: "AVAILABILITY",
  ERRORS: "ERROR",
  PERFORMANCE: "SLOWDOWN",
  RESOURCE_CONTENTION: "RESOURCE_CONTENTION",
  CUSTOM_ALERT: "CUSTOM_ALERT",
  MONITORING_UNAVAILABLE: "MONITORING_UNAVAILABLE",
};
/** dt.duration_marker milestones, in minutes. */
const MARKERS = [5, 10, 15, 30, 60, 120, 240, 1440, 10080];
const markerLiteral = (m: number) => (m % 1440 === 0 ? `${m / 1440}d` : m % 60 === 0 ? `${m / 60}h` : `${m}m`);
/** Problem field names as DQL identifiers (backticks when needed). */
const field = (key: string) => (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(key) ? key : `\`${key.replace(/`/g, "``")}\``);
const or = (xs: string[]) => (xs.length === 1 ? xs[0] : `(${xs.join(" OR ")})`);
const and = (xs: string[]) => (xs.length === 1 ? xs[0] : xs.map((x) => (x.startsWith("(") || !/ OR /.test(x) ? x : `(${x})`)).join(" AND "));

/** `gen2`: the profile relies on a Gen 2 (classic) concept that has a Grail-native replacement. */
export type Note = { text: string; gen2?: boolean; approximate?: boolean };
export type Translation = { ok: true; filter: string; approximate: boolean; notes: Note[] } | { ok: false; reason: string; notes: Note[] };

export const predefinedTypes = (p: AlertingProfile): string[] =>
  Array.from(new Set(p.eventFilters.flatMap((f) => (f.type === "PREDEFINED" && f.predefinedFilter?.eventType ? [f.predefinedFilter.eventType] : []))));

/** Event names per classic event type, from the Davis events of the last 30 days. */
export const eventNamesQuery = (types: string[]) => `fetch dt.davis.events, from:now()-30d
| filter in(event.type, { ${types.map(dqlString).join(", ")} })
| summarize names = collectDistinct(event.name, maxLength: 20), by: { event.type }`;

function textClause(dqlField: string, label: string, f: TextFilter | undefined, notes: Note[]): string | null | false {
  if (!f || f.enabled === false || !f.value) return null;
  const v = f.value;
  let clause: string;
  switch (f.operator) {
    case "STRING_EQUALS":
      clause = f.caseSensitive ? `${dqlField} == ${dqlString(v)}` : `matchesValue(${dqlField}, ${dqlString(v)})`;
      break;
    case "CONTAINS":
      clause = `matchesValue(${dqlField}, ${dqlString(`*${v}*`)})`;
      break;
    case "BEGINS_WITH":
      clause = `matchesValue(${dqlField}, ${dqlString(`${v}*`)})`;
      break;
    case "ENDS_WITH":
      clause = `matchesValue(${dqlField}, ${dqlString(`*${v}`)})`;
      break;
    default:
      return false;
  }
  if (f.caseSensitive && f.operator !== "STRING_EQUALS") notes.push({ text: `The ${label} filter was case-sensitive; trigger matchers only compare case-insensitively.`, approximate: true });
  if (v.includes("*")) notes.push({ text: `The ${label} filter value contains *, which matchesValue treats as a wildcard.`, approximate: true });
  return f.negate ? `not (${clause})` : clause;
}

/** Clause for one event filter, whether it belongs to the negated (ANDed) group, or a reason it cannot be translated. */
function eventFilterClause(f: EventFilter, names: Map<string, string[]> | null, notes: Note[]): { clause: string; negated: boolean } | { blocker: string } | null {
  if (f.type === "PREDEFINED") {
    const type = f.predefinedFilter?.eventType;
    if (!type) return null;
    const found = names ? names.get(type) ?? [] : [type];
    if (!found.length) return { blocker: `Event filter on ${type}: no ${type} events in the last 30 days, so its event name is unknown.` };
    notes.push({
      text: `Event filter on the classic event type ${type} is matched by its event ${names ? `${found.length === 1 ? "name" : "names"} (${found.join(", ")})` : "name"} in the problem description.`,
      gen2: true,
      approximate: true,
    });
    const clause = or(found.map((n) => `matchesPhrase(event.description, ${dqlString(n)})`));
    return { clause: f.predefinedFilter?.negate ? `not ${clause.startsWith("(") ? clause : `(${clause})`}` : clause, negated: !!f.predefinedFilter?.negate };
  }
  if (f.type === "CUSTOM" && f.customFilter) {
    const c = f.customFilter;
    const parts: { clause: string; negated: boolean }[] = [];
    const title = textClause("event.name", "title", c.titleFilter, notes);
    const description = textClause("event.description", "description", c.descriptionFilter, notes);
    if (title === false || description === false) return { blocker: "Event filter uses a regular expression, which trigger matchers do not support." };
    if (title) {
      parts.push({ clause: title, negated: !!c.titleFilter?.negate });
      notes.push({ text: "Event title filters are matched against the problem title (the event title for single-event problems, \"Multiple … problems\" otherwise).", approximate: true });
    }
    if (description) {
      parts.push({ clause: description, negated: !!c.descriptionFilter?.negate });
      notes.push({ text: "Event description filters are matched against the problem description, which summarises every event of the problem.", approximate: true });
    }
    for (const item of c.metadataFilter?.metadataFilterItems ?? []) {
      if (!item.metadataKey) continue;
      const m = `matchesValue(${field(item.metadataKey)}, ${dqlString(item.metadataValue ?? "")})`;
      parts.push({ clause: item.negate ? `not (${m})` : m, negated: !!item.negate });
      notes.push({ text: `Event property ${item.metadataKey} is matched on the problem field of the same name; check that problems carry it.`, approximate: true });
    }
    if (!parts.length) return null;
    return { clause: and(parts.map((p) => p.clause)), negated: parts.every((p) => p.negated) };
  }
  return null;
}

/**
 * How delays map to duration milestones. "configured": the first milestone at or above the delay (never misses a
 * problem classic notified, but also notifies problems that close just after the delay). "later": one milestone more
 * (15 min -> 30 min), closer to classic, which counted from a few minutes after the problem started; on the demo tenant
 * this cut Default from 226 extra / 0 missed to 8 extra / 17 missed problems in 7 days, but fits 5-minute delays worse.
 */
export type DelayTiming = "configured" | "later";

/**
 * DQL matcher for the profile's rules (empty string = every problem). `names` maps classic event types to event names;
 * null checks translatability only (predefined filters are assumed to resolve).
 */
export function translateProfile(p: AlertingProfile, names: Map<string, string[]> | null, timing: DelayTiming = "configured"): Translation {
  const notes: Note[] = [];
  if (p.managementZone) {
    notes.push({ text: "Management zone filter (Gen 2): problems carry no management zone. Recreate the condition on primary fields (for example dt.security_context or primary_tags.*).", gen2: true });
    return { ok: false, reason: "Filters on a management zone, which problems do not carry.", notes };
  }

  // Severity rules: group by (delay, tags) so rules that differ only in severity share one matchesValue list.
  const groups = new Map<string, { categories: string[]; conditions: string[] }>();
  let delayed = false;
  for (const r of p.severityRules) {
    const category = SEVERITY_CATEGORY[r.severityLevel ?? ""];
    if (!category) {
      notes.push({ text: `Severity level ${r.severityLevel} is unknown and was left out.`, approximate: true });
      continue;
    }
    const conditions: string[] = [];
    const delay = Number(r.delayInMinutes ?? 0);
    if (delay > 0) {
      delayed = true;
      const atLeast = MARKERS.find((m) => m >= delay) ?? MARKERS[MARKERS.length - 1];
      const marker = timing === "later" ? MARKERS.find((m) => m > atLeast) ?? atLeast : atLeast;
      if (atLeast !== delay) notes.push({ text: `Delay of ${delay} min rounded up to ${markerLiteral(atLeast)} (problem durations are marked at 5, 10, 15, 30 min, 1, 2, 4, 24 h and 7 d).`, approximate: true });
      if (timing === "later") {
        notes.push({ text: marker === atLeast ? "A 7-day delay has no later duration step; kept at 7 d." : `Delay of ${delay} min moved one step later, to ${markerLiteral(marker)}.` });
      }
      conditions.push(`dt.duration_marker >= ${markerLiteral(marker)}`);
    }
    const tags = (r.tagFilter ?? []).filter(Boolean);
    if (tags.length && (r.tagFilterIncludeMode === "INCLUDE_ANY" || r.tagFilterIncludeMode === "INCLUDE_ALL")) {
      conditions.push(
        r.tagFilterIncludeMode === "INCLUDE_ANY" && tags.length > 1
          ? `matchesValue(entity_tags, { ${tags.map(dqlString).join(", ")} })`
          : and(tags.map((t) => `matchesValue(entity_tags, ${dqlString(t)})`)),
      );
      notes.push({ text: `Classic tags (${tags.join(", ")}) are matched on entity_tags, which is deprecated. Move the condition to primary tags (primary_tags.<name>) or other primary fields.`, gen2: true });
    }
    const key = conditions.join(" AND ");
    const g = groups.get(key) ?? { categories: [], conditions };
    if (!g.categories.includes(category)) g.categories.push(category);
    groups.set(key, g);
  }
  if (delayed) {
    notes.push({
      text:
        timing === "later"
          ? "Delays use dt.duration_marker (time since the problem started), one step later to make up for classic counting from a few minutes after the start. Problems that close between the two steps are not notified, although classic notified some of them."
          : "Delays use dt.duration_marker (time since the problem started). Classic counted from when it opened the problem, a few minutes later, so problems that close just after the delay notify through the workflow but did not through classic.",
    });
  }
  const severity = Array.from(groups.values()).map((g) => {
    const category = g.categories.length === 1 ? `event.category == ${dqlString(g.categories[0])}` : `matchesValue(event.category, { ${g.categories.map(dqlString).join(", ")} })`;
    return g.conditions.length ? `(${[category, ...g.conditions].join(" AND ")})` : category;
  });

  // Event filters: non-negated ORed, negated ANDed, groups ANDed.
  const positive: string[] = [];
  const negative: string[] = [];
  for (const f of p.eventFilters) {
    const c = eventFilterClause(f, names, notes);
    if (!c) continue;
    if ("blocker" in c) return { ok: false, reason: c.blocker, notes };
    (c.negated ? negative : positive).push(c.clause);
  }

  const parts = [...(severity.length ? [or(severity)] : []), ...(positive.length ? [or(positive)] : []), ...negative];
  if (!parts.length) notes.push({ text: "The profile has no rules, so every problem matches." });
  const unique = notes.filter((n, i) => notes.findIndex((m) => m.text === n.text) === i);
  return { ok: true, filter: and(parts), approximate: unique.some((n) => n.approximate), notes: unique };
}

/** Short status for tables: how the profile translates and whether it uses Gen 2 concepts. */
export function profileStatus(p: AlertingProfile | null): { label: string; gen2: string[]; translatable: boolean } {
  if (!p) return { label: "Alerting profile not found", gen2: [], translatable: false };
  const t = translateProfile(p, null);
  const gen2 = [
    ...(p.managementZone ? ["management zone"] : []),
    ...(p.severityRules.some((r) => (r.tagFilter ?? []).length && r.tagFilterIncludeMode !== "NONE") ? ["classic tags"] : []),
    ...(predefinedTypes(p).length ? ["classic event types"] : []),
  ];
  return { label: !t.ok ? "Label only" : t.approximate ? "DQL (approximate)" : "DQL", gen2, translatable: t.ok };
}
