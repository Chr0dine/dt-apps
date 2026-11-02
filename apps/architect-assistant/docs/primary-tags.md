# Primary tags

The Primary tags tab measures how widely customer-defined primary tags (`primary_tags.<name>`, for example `primary_tags.team`, `primary_tags.app` or `primary_tags.stage`) are present on the tenant's entities. You list the tag names you expect; the list is saved per user. The tab then shows one card per tag with a gauge per entity type, and an entity search by tag. Its Remediation actions section creates a central ingest enrichment rule (`builtin:ingest.enrichment.config`) that writes a tag to every matching entity, and shows the manual `DT_TAGS` command for single processes. The built-in primary fields (security context, cost center, cost product, host group) are not covered here because they have their own tabs.

| | |
| --- | --- |
| Area | Metadata (see [index](README.md)) |
| Tab id | `primary-tags` |
| Counts toward Entity Overview readiness / Top findings | No. Primary tags are not part of the shared coverage query, so they do not change Overall readiness, and no Top finding links to this tab. |
| Main source files | [`ui/app/tabs/TagsTab.tsx`](../ui/app/tabs/TagsTab.tsx), [`ui/app/primaryTags.tsx`](../ui/app/primaryTags.tsx), [`ui/app/tabs/EntitySearch.tsx`](../ui/app/tabs/EntitySearch.tsx), [`ui/app/queries.ts`](../ui/app/queries.ts), [`ui/app/RemediationPanel.tsx`](../ui/app/RemediationPanel.tsx), [`ui/app/remediation.ts`](../ui/app/remediation.ts), [`ui/app/analyses.ts`](../ui/app/analyses.ts) |

## Contents

- [What this page answers](#what-this-page-answers)
- [Before you start](#before-you-start)
- [Page walkthrough](#page-walkthrough)
- [Checks and scoring](#checks-and-scoring)
- [Queries](#queries)
- [API calls](#api-calls)
- [Remediation actions](#remediation-actions)
- [AI Assist on this page](#ai-assist-on-this-page)
- [Limitations and edge cases](#limitations-and-edge-cases)
- [Troubleshooting](#troubleshooting)
- [Related pages](#related-pages)
- [Source files](#source-files)

## What this page answers

- **Is each agreed primary tag actually present, and on which entity types?** One card per listed tag, one gauge per entity type (hosts, processes, services, containers, Kubernetes clusters, nodes, namespaces, deployments, pods).
- **Which entities have a tag, a specific value, a value containing a text, or no value?** The entity search lists them with the value found.
- **How do I roll a tag out without touching every host?** The central enrichment rule action writes `primary_tags.<name>` from a fixed value, a host / process property, a Kubernetes label or annotation, or a cloud tag.

### Best practice checked

Primary tags are Grail fields that Dynatrace adds to entities and their data so that data can be filtered, segmented and attributed consistently. A customer should agree a small set of tag names (owner, application, stage) and make sure they are present on the entities they apply to. The recommended way to apply them centrally is an ingest enrichment rule; OneAgent host tags, process `DT_TAGS` and Kubernetes annotations are alternatives. The code limits a process or host to 20 primary tags (from the manual action and AI notes: "Up to 20 primary tags per host or process; extras are dropped").

Dynatrace documentation cited by the code:

- [Primary Grail fields and tags](https://docs.dynatrace.com/docs/manage/tags/primary-tags)
- [OneAgent primary tags](https://docs.dynatrace.com/docs/manage/tags/primary-tags/tags-domain-oneagent)
- [Kubernetes primary tags](https://docs.dynatrace.com/docs/manage/tags/primary-tags/tags-domain-k8s)
- [Ingest enrichment rules](https://docs.dynatrace.com/docs/manage/tags/tags-central-enrichment)

## Before you start

### App scopes used by this page

| Scope | What this page uses it for |
| --- | --- |
| `storage:smartscape:read` | Tag coverage query and entity search (`smartscapeNodes`). |
| `state:user-app-states:read` | Read your saved list of tag names at app start. |
| `state:user-app-states:write` | Save the list each time you add or remove a tag name. |
| `settings:objects:write` | Validate and create the enrichment rule (`builtin:ingest.enrichment.config`). |

The intents used by *Open in Notebook*, *Add to Dashboard* and the overview links need no scope.

### User permissions

AppEngine calls run with the signed-in user's permissions, limited to the app scopes. The user needs `storage:smartscape:read` (and read access to the data concerned) to see coverage, and, to create a rule, `settings:objects:write` on the enrichment schema, for example `ALLOW settings:objects:write WHERE settings:schemaId = "builtin:ingest.enrichment.config";`. The user app state is private to the user and needs no extra policy beyond the app's state scopes.

### One-time setup

None. No credential vault entries, outbound connections or OAuth clients are used.

## Page walkthrough

The tab is assembled in [`App.tsx` L119-L125](../ui/app/App.tsx#L119-L125): `TagsTab`, then `RemediationPanel tab="primary-tags"`. Only the selected tab is mounted, so leaving it discards search results and form input (the tag list itself is kept, because it lives in app-level state).

### Documentation link

Right-aligned above the content: *Primary tags documentation*, opening this page on GitHub.

### Heading and explanation

Heading **Primary tags** and the text: *Customer-defined primary tags (`primary_tags.*`), for example team, app or stage. List the tag names you expect and see how many entities of each type carry them. Security context, cost center, cost product and host group have their own tabs.*

### Primary tags to check (list editor)

A card ([`TagsTab.tsx` L76-L122](../ui/app/tabs/TagsTab.tsx#L76-L122)):

| Control | Behaviour |
| --- | --- |
| **Tag name (primary_tags.&lt;name&gt;)** text input, placeholder `e.g. team` | The input is trimmed and a leading `primary_tags.` is removed, so `primary_tags.team` and `team` both add `team`. |
| **Add tag** button | Enabled only when the name is valid, not already listed, and fewer than 10 names are listed. There is no Enter-key handler; click the button. |
| Error line (red) | *Start with a letter; use letters, digits, '.', '_' or '-' (max 63).* (name does not match `^[A-Za-z][A-Za-z0-9_.-]{0,62}$`), *Already listed.*, or *At most 10 items.* |
| Tag chips *`primary_tags.<name>` ✕* | One button per listed tag; clicking removes it. |

Names are case-sensitive (`Team` and `team` are different tags). Each add or remove updates the list immediately and saves it to your user app state (see [API calls](#api-calls)); a failed save is ignored silently.

Below the editor, while your saved list has not loaded yet: *Loading saved items…*. With an empty list: *Add at least one tag name to see coverage.* and no query runs.

### AI Insights panel

Shown under the editor while **AI Assist** is on. See [AI Assist on this page](#ai-assist-on-this-page). With tags listed it appears once the coverage query has returned.

### Coverage cards, one per tag

Mounted only when at least one name is listed ([`TagsTab.tsx` L125-L169](../ui/app/tabs/TagsTab.tsx#L125-L169)). For each listed tag, in list order, a card headed `primary_tags.<name>` with one gauge per entity type, in the order Hosts, Processes, Services, Containers, Kubernetes clusters, Kubernetes nodes, Kubernetes namespaces, Kubernetes deployments, Kubernetes pods.

- **Data:** [Q1 `tagsQuery`](#q1-tagsquery); column `t<i>` belongs to the tag at position `i` of the list.
- **Numerator:** entities of the type where `primary_tags.<name>` is not null. **Denominator:** all entities of the type in the timeframe. **Percentage:** `Math.round(part / total × 100)`.
- **Detail line:** `<part> of <total>`. Gauge colour: continuous red (0%) to green (100%) gradient (`PctGauge`).
- Types with no entities in the timeframe are hidden; a card with no gauges at all is omitted. A tag present nowhere still shows its card, with all gauges at 0%.
- **Loading:** `Loading…`. **Error:** red *Query failed* message with the error text.
- **Query actions** under the cards (*Primary tag coverage*): Show DQL / Copy / Open in Notebook (intent `dynatrace.notebooks` / `view-query`) / Add to Dashboard (intent `dynatrace.dashboards` / `add-to-dashboard`).

The query text changes whenever a tag is added, removed, or the timeframe changes, and then runs again.

### Search entities by primary tag

The shared entity search ([`EntitySearch.tsx`](../ui/app/tabs/EntitySearch.tsx)) with one field per listed tag (label `primary_tags.<name>`, expression `` `primary_tags.<name>` ``) over all nine entity types. With no tags listed the card shows *Add at least one item above to search for entities.* Nothing runs until **Search entities** is clicked; changing any control clears the result.

| Control | Options | Effect on the query |
| --- | --- | --- |
| Property | One option per listed tag (shown only with two or more tags) | Which `` `primary_tags.<name>` `` field is searched. |
| Entity type | *All applicable types* (default) or one of the nine types | Types listed after `smartscapeNodes`. |
| Match | *Has a value* (default) | `\| filter isNotNull(`` `primary_tags.<name>` ``)` |
| | *Equals* | `\| filter toString(`` `primary_tags.<name>` ``) == "<value>"` (exact, case-sensitive) |
| | *Contains* | `\| filter contains(toString(…), "<value>", caseSensitive:false)` |
| | *Is missing* | `\| filter isNull(`` `primary_tags.<name>` ``)` |
| Value | Text (Equals / Contains only), trimmed; `\` and `"` are escaped | |
| Name contains (optional) | Text, placeholder `e.g. prod-` | Adds `contains(name, "<text>", caseSensitive:false) and ` |

With *Equals* / *Contains* and no value, the button does nothing.

**Result table** (title *`primary_tags.<name>` search*, with its own query actions), sortable, sorted by name, max 500 rows (*Showing the first 500 entities.* at the cap; empty: *No entities match this search.*):

| Column | Source | Meaning |
| --- | --- | --- |
| Name | `name` | Entity name. |
| Type | `type` | Smartscape type. |
| Entity ID | `id` | Smartscape node ID. |
| `primary_tags.<name>` | `value` | The tag value as text; empty when missing. |
| Overview | `type` + `id` | *Open overview ↗*: hosts and processes / containers in Infrastructure & Operations (`view_host` with `meId`, `view_smartscape_process`, `view_smartscape_container`), services in `dynatrace.services`, Kubernetes objects in the Kubernetes app (`view-entity-dt.smartscape.k8s_<type>`). `—` if no link. No timeframe is passed. |

### Remediation actions

At the bottom of the tab. See [Remediation actions](#remediation-actions).

## Checks and scoring

| Check | In place when | Numerator | Denominator | Severity / thresholds | Notes |
| --- | --- | --- | --- | --- | --- |
| `primary_tags.<name>` on each entity type (up to 10 tags × 9 types) | `isNotNull(`` `primary_tags.<name>` ``)` | `t<i> = countIf(...)` per `type` | `total = count()` per `type` | Gauge gradient red→green; AI Assist ≥ 90% good, ≥ 50% warning, < 50% critical | Every type is scored for every tag; judge a tag only against the types it should apply to. |
| Per-tag coverage (AI Assist only) | | sum of `part` over all types | sum of `total` over all types | same | Entity-weighted. |
| Tag not present anywhere (AI Assist) | sum of `part` is 0 | | | critical | |
| Remediation impact line | | | | | *`<n>` primary tags tracked.* or *No primary tags tracked yet.* |

Nothing on this tab feeds the Entity Overview.

## Queries

| # | Name (function in source) | Runs when | Feeds |
| --- | --- | --- | --- |
| Q1 | [`tagsQuery`](#q1-tagsquery) | At least one tag listed and the tab is open; re-runs when the list or timeframe changes | Coverage cards, AI Assist |
| Q2 | [`entitySearchQuery`](#q2-entitysearchquery) | Click **Search entities** | Result table |

All queries use `from:now()-24h` by default; the timeframe select changes it to `from:now()-7d` or `from:now()-30d`. Longer windows also count entities that existed earlier in the window, including decommissioned ones.

### Q1 tagsQuery

- **Source:** `tagsQuery` in [`queries.ts` L129-L132](../ui/app/queries.ts#L129-L132); run by `ListCoverageView` in [`TagsTab.tsx`](../ui/app/tabs/TagsTab.tsx#L125-L143).
- **Runs:** when the coverage view mounts (tab open with a non-empty list) and whenever the generated text changes (tag added, removed, timeframe changed).
- **Parameters:** timeframe; the listed names, each producing one `t<i>` line in list order. Names are validated by `TAG_NAME_RE` before they can be listed, so they are safe to embed in backticks.
- **Query (24 h, list `team`):**

```dql
smartscapeNodes "HOST", "PROCESS", "SERVICE", "CONTAINER", "K8S_CLUSTER", "K8S_NODE", "K8S_NAMESPACE", "K8S_DEPLOYMENT", "K8S_POD", from:now()-24h
| summarize total = count(),
    t0 = countIf(isNotNull(`primary_tags.team`)),
    by:{type}
```

  With the list `team`, `app`, `stage`:

```dql
smartscapeNodes "HOST", "PROCESS", "SERVICE", "CONTAINER", "K8S_CLUSTER", "K8S_NODE", "K8S_NAMESPACE", "K8S_DEPLOYMENT", "K8S_POD", from:now()-24h
| summarize total = count(),
    t0 = countIf(isNotNull(`primary_tags.team`)),
    t1 = countIf(isNotNull(`primary_tags.app`)),
    t2 = countIf(isNotNull(`primary_tags.stage`)),
    by:{type}
```

- **How it works:**
  1. `smartscapeNodes` reads the Smartscape nodes of the nine coverage entity types that existed in the window. Smartscape is used because it is cheap and carries the primary Grail fields on each entity ([`queries.ts` header](../ui/app/queries.ts#L1-L4)).
  2. `summarize … by:{type}`: `total = count()` per type, and one `countIf(isNotNull(`` `primary_tags.<name>` ``))` per tag. The field name is backtick-quoted because it contains dots (and may contain `-`).
  3. Columns are named by position (`t0`, `t1`, …), not by tag name, so any valid tag name works as a column.
- **Output:** one record per `type` with `total` and `t0…t<n-1>`. The client maps `t<i>` back to `primary_tags.<names[i]>`, skips types with `total = 0`, and computes `pct(part, total)`.
- **Limits and cost:** no limit; one row per type; one Smartscape scan regardless of the number of tags (max 10).
- **Open it yourself:** yes, *Primary tag coverage* query actions.

### Q2 entitySearchQuery

- **Source:** `entitySearchQuery` in [`queries.ts` L158-L172](../ui/app/queries.ts#L158-L172), called from [`EntitySearch.tsx` L131-L137](../ui/app/tabs/EntitySearch.tsx#L131-L137) with the field `{ key: "<name>", label: "primary_tags.<name>", expr: "`primary_tags.<name>`" }`.
- **Runs:** only on **Search entities**.
- **Parameters:** property (tag), entity types, match mode, value, name text, timeframe.
- **Query (24 h, tag `team`, all types, *Has a value*):**

```dql
smartscapeNodes "HOST", "PROCESS", "SERVICE", "CONTAINER", "K8S_CLUSTER", "K8S_NODE", "K8S_NAMESPACE", "K8S_DEPLOYMENT", "K8S_POD", from:now()-24h
| filter isNotNull(`primary_tags.team`)
| fieldsAdd value = toString(`primary_tags.team`)
| fields id, name, type, value
| sort name asc
| limit 500
```

  *Is missing*:

```dql
smartscapeNodes "HOST", "PROCESS", "SERVICE", "CONTAINER", "K8S_CLUSTER", "K8S_NODE", "K8S_NAMESPACE", "K8S_DEPLOYMENT", "K8S_POD", from:now()-24h
| filter isNull(`primary_tags.team`)
| fieldsAdd value = toString(`primary_tags.team`)
| fields id, name, type, value
| sort name asc
| limit 500
```

  *Equals* `checkout`, *Entity type* = Hosts:

```dql
smartscapeNodes "HOST", from:now()-24h
| filter toString(`primary_tags.team`) == "checkout"
| fieldsAdd value = toString(`primary_tags.team`)
| fields id, name, type, value
| sort name asc
| limit 500
```

  *Contains* `check` with *Name contains* `prod-`:

```dql
smartscapeNodes "HOST", "PROCESS", "SERVICE", "CONTAINER", "K8S_CLUSTER", "K8S_NODE", "K8S_NAMESPACE", "K8S_DEPLOYMENT", "K8S_POD", from:now()-24h
| filter contains(name, "prod-", caseSensitive:false) and contains(toString(`primary_tags.team`), "check", caseSensitive:false)
| fieldsAdd value = toString(`primary_tags.team`)
| fields id, name, type, value
| sort name asc
| limit 500
```

  A value with quotes or backslashes is escaped, e.g. `a"b\c` becomes `"a\"b\\c"`.
- **How it works:** `smartscapeNodes` for the chosen types; `filter` joins the optional name condition and the match condition with `and`; `fieldsAdd value = toString(...)` adds the tag value; `fields` keeps the table columns; `sort name asc`; `limit 500`.
- **Output:** `id`, `name`, `type`, `value` → table columns; `type` + `id` build the overview link.
- **Limits and cost:** 500 rows; one Smartscape scan.
- **Open it yourself:** yes, the result table's query actions.

## API calls

| Method | Endpoint or SDK method | Scope | When |
| --- | --- | --- | --- |
| POST | `/platform/storage/query/v1/query:execute` + `query:poll` (`useDql`, `@dynatrace-sdk/react-hooks`) | `storage:smartscape:read` | Q1, Q2 |
| GET | `/platform/state/v1/user-app-states/architect-assistant.primary-tag-names` (`useUserAppState` → `stateClient.getUserAppState`) | `state:user-app-states:read` | Once at app start (in `App.tsx`, not when the tab opens) |
| PUT | `/platform/state/v1/user-app-states/architect-assistant.primary-tag-names` (`useSetUserAppState` → `stateClient.setUserAppState`) | `state:user-app-states:write` | Each add or remove of a tag name |
| POST | `/platform/classic/environment-api/v2/settings/objects?validateOnly=true\|false` (`settingsObjectsClient.postSettingsObjects`) | `settings:objects:write` | **Validate** / **Create rule** |
| Intent | `dynatrace.notebooks` / `view-query`, `dynatrace.dashboards` / `add-to-dashboard`; `getIntentLink` for overview links | none | Query actions, Overview column |

### Read and save the tag list

- **Source:** [`primaryTags.tsx`](../ui/app/primaryTags.tsx). Key `architect-assistant.primary-tag-names`, stored per user and per app.
- **Read:** response field `value` (a JSON string). It is parsed; non-string entries and names failing `TAG_NAME_RE` are dropped; at most the first 10 are kept. A missing or malformed state gives an empty list. `loaded` becomes true once the read finished (also on error).
- **Write:** the whole list on every change. Body example:

```json
{ "value": "[\"team\",\"app\",\"stage\"]" }
```

  Errors are swallowed; the on-screen list is updated regardless, so a failed save only shows up after a reload.

### Create an enrichment rule

- **Source:** `submitEnrichmentRule` / `buildEnrichmentBody` in [`remediation.ts` L74-L122](../ui/app/remediation.ts#L74-L122).
- **Request:** `POST /platform/classic/environment-api/v2/settings/objects?validateOnly=<true|false>` with one environment-scope object (examples under [Remediation actions](#remediation-actions)).
- **Response fields used:** `[0].code` (≥ 400 = rejected), `[0].error.message`, `[0].objectId` (shown as *ID: …* after creation).
- **Messages:** *Validation passed. The rule is valid and nothing was saved.*, *Rule created.*, *Rejected (HTTP `<code>`).* or the API / SDK error message.

## Remediation actions

The section ([`RemediationPanel.tsx` L1127-L1133](../ui/app/RemediationPanel.tsx#L1127-L1133)) starts with *`<n>` primary tags tracked.* (or *No primary tags tracked yet.*) and an **Action** dropdown:

| Action | Kind | Requests | Documentation for this fix |
| --- | --- | --- | --- |
| Central enrichment rule (default) | API | Validate: 1 POST (`validateOnly=true`); Create: 1 POST | Ingest enrichment rules; OneAgent primary tags; Kubernetes primary tags; Primary Grail fields and tags |
| Process tag with DT_TAGS | Manual | none | OneAgent primary tags; Ingest enrichment rules |

### API: Central enrichment rule

Fixes missing tags on many entities at once: one rule in `builtin:ingest.enrichment.config` covers every matching entity.

If no tag is listed, the action shows only *Add a primary tag name on this tab first; the rule writes to primary_tags.&lt;name&gt;.*

| Field | Options / input | Notes |
| --- | --- | --- |
| Field | `primary_tags.<name>` for each listed tag | Shown only with two or more tags; the default is the first tag listed when the form first appeared. Sent as `target`. |
| Source | *Fixed value (Custom)* `CUSTOM`, *Host/process property* `HOST_PROCESS_PROPERTY`, *Kubernetes namespace label / annotation*, *Kubernetes workload label / annotation*, *Kubernetes pod label / annotation*, *AWS tag*, *Azure tag*, *GCP label*, *GCP tag* | Sent as `type`. |
| Applies to | *All hosts / processes* (default), *Host name pattern*, *Custom condition* | Only for `CUSTOM` and `HOST_PROCESS_PROPERTY` (the only types the central enrichment reference allows conditions for). |
| Value to apply / Property key / Label key / Annotation key / Tag key | Text; placeholder per source (e.g. `finance-prod`, `team`, `app.kubernetes.io/part-of`, `CostCenter`, `cost-center`) | Sent as `valueSource` (trimmed). For non-custom sources it is the key whose value is copied into the tag. |
| Host name pattern | Text, placeholder `prod-*` | Becomes `condition: matchesValue(host.name, "<pattern>")` (the pattern is inserted as typed, not escaped). |
| Condition | Text, placeholder `matchesValue(host.name, "prod-*")` | Sent as `condition`. |

Input checks (`checkEnrichmentInput`, shown in red once the source field has text): *`<source label>` is required.*, *Value source must be at most 2048 characters.*, *Keys cannot contain whitespace.* (any source except Custom), *Condition must be at most 500 characters.*, and *Enter a host name pattern.* for an empty pattern.

**Request (1 API call, environment scope)** expands to the exact body. Examples:

Fixed value for all hosts / processes:

```json
[
  {
    "schemaId": "builtin:ingest.enrichment.config",
    "scope": "environment",
    "value": {
      "type": "CUSTOM",
      "target": "primary_tags.team",
      "valueSource": "checkout"
    }
  }
]
```

Fixed value with host name pattern `prod-*`:

```json
[
  {
    "schemaId": "builtin:ingest.enrichment.config",
    "scope": "environment",
    "value": {
      "type": "CUSTOM",
      "target": "primary_tags.team",
      "valueSource": "checkout",
      "condition": "matchesValue(host.name, \"prod-*\")"
    }
  }
]
```

Copy the Kubernetes namespace label `team` (conditions are never sent for this source):

```json
[
  {
    "schemaId": "builtin:ingest.enrichment.config",
    "scope": "environment",
    "value": {
      "type": "K8S_NAMESPACE_LABEL",
      "target": "primary_tags.team",
      "valueSource": "team"
    }
  }
]
```

Flow: **Validate** (enabled when there is no input problem) posts with `validateOnly=true`, so the Settings API runs its schema validation and nothing is saved. Tick *Create this rule in the tenant*, then **Create rule** posts with `validateOnly=false`. Any field change clears the result and the confirmation. The result line is green on success (with the object ID after creation), red otherwise. Hint under the buttons: *One rule covers every matching entity. OneAgent applies it in ~5 min; Kubernetes pods need a restart.*

### Manual: Process tag with DT_TAGS

Uses the first listed tag name (or `team` when none is listed) and the example value `checkout`:

```bash
DT_TAGS="primary_tags.team=checkout" java -jar app.jar
```

Steps: set `DT_TAGS` in the process environment before it starts; restart the process; prefer a central rule for values that apply host-wide. Notes: overrides the host-level value for the same key, useful for serverless where the host cannot be configured; up to 20 primary tags per host or process, extras are dropped. The command has a **Copy** button; there is a single variant (Linux / macOS), so no *Variant* dropdown.

## AI Assist on this page

`analyzeTags(labels, rows)` ([`analyses.ts` L274-L326](../ui/app/analyses.ts#L274-L326)), rule-based, computed locally from the data on screen; no model is called.

**No tags listed:** summary *No primary tags are listed yet, so nothing can be scored on this tab.*; insight (info) *Customer-defined primary tags use the primary_tags.&lt;name&gt; prefix (for example team, app or stage). Add the names you expect to see coverage.*; recommendation (medium) *Agree a small set of tag names with the customer (owner, application, stage), add them here, then create central enrichment rules for each.*

**With tags:** per tag, `part` and `total` are summed over all entity types and `pct = round(part / total × 100)`.

- **Summary:** *`<n>` primary tags checked across `<k>` entity types. `<u>` items are not present on any entity.* (`k` = types with entities.)
- **Insights:**

| Rule | Severity | Text |
| --- | --- | --- |
| Tags with `part = 0` everywhere | critical | *Not present anywhere: primary_tags.a, primary_tags.b.* |
| Best tag by `pct`, if `part > 0` | ≥ 90% good, ≥ 50% warning, else critical | *Best covered: primary_tags.team at `<pct>`% of all entities.* |
| (tag, type) row below 50% with the largest absolute gap | warning | *Largest gap: `<n>` HOST entities lack primary_tags.team.* |

- **Recommendations:** if any tag is unused, high: *Create a central enrichment rule for each unused tag (source: Kubernetes label, cloud tag or a fixed value) so it is applied without touching hosts.*; always, low: *Keep the tag set small (up to 20 primary tags per host or process are supported; extras are dropped).*

## Limitations and edge cases

- **Not part of readiness.** Primary tags never affect Entity Overview scores or Top findings.
- **Every type is scored.** A tag that only makes sense on hosts still shows 0% gauges for services or Kubernetes objects; the per-tag AI percentage includes them too.
- **At most 10 tag names**, saved per user: colleagues do not see your list. The whole list is rewritten on each change, so two browser tabs editing it overwrite each other.
- **Case-sensitive names and values.** `Team` and `team` are different fields; *Equals* is case-sensitive, *Contains* is not.
- **Presence only.** The gauges count any non-null value; they do not check that values follow a convention.
- **Search cap.** 500 rows.
- **Enrichment form target.** The *Field* default is set when the form first appears. If you add the first tag while the form is open (the form then appears with an empty field), or remove the tag it points to, `target` stays empty or stale; the request preview shows it. Select another action and back (or reopen the tab) to reset it, or pick the field in the dropdown when it is shown.
- **Unescaped host name pattern.** A `"` in the pattern produces an invalid condition; **Validate** reports it.
- **Rules apply going forward.** OneAgent picks up a rule in about 5 minutes and pods need a restart; the coverage only rises once entities report the tag again. With a 7- or 30-day timeframe, older entity states are still counted.

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| *Loading saved items…* does not go away | The user app state read is still pending | Reload the app; check network access to the platform. |
| Your tag list is gone after reload | Save failed silently (missing `state:user-app-states:write`, network) | Re-add the names; check the app's permissions. |
| *Query failed* on the cards | Missing `storage:smartscape:read`, or a query error | Grant the permission; open the query in a notebook to see the error. |
| All gauges 0% for a tag you know exists | Name differs in case or spelling, or the tag is a classic tag rather than a primary tag | Check the field name on one entity (search *Has a value*), correct the name. |
| *Validate* fails with a schema error | Empty target, invalid condition, or an invalid source key | Check the request preview; fix the field / condition. |
| *Create rule* rejected with 403 | Missing `settings:objects:write` on `builtin:ingest.enrichment.config` | Grant the permission in an IAM policy. |
| Rule created but coverage unchanged | Rule not applied yet, pods not restarted, or the source key is absent on the entities | Wait ~5 minutes, restart pods, check the source label / property exists. |

## Related pages

- [Index](README.md)
- [Entity Overview](entity-overview.md)
- [Security context](security-context.md) and [Cost allocation](cost-allocation.md): the same enrichment rule action for built-in fields.
- [Host groups](host-groups.md)
- [Ownership & Teams](ownership-and-teams.md)

## Source files

| File | Role on this page |
| --- | --- |
| [`ui/app/tabs/TagsTab.tsx`](../ui/app/tabs/TagsTab.tsx) | Tab layout, list editor, coverage cards, entity search wiring. |
| [`ui/app/primaryTags.tsx`](../ui/app/primaryTags.tsx) | Tag list persisted in user app state (`architect-assistant.primary-tag-names`, max 10). |
| [`ui/app/App.tsx`](../ui/app/App.tsx) | Loads the tag list at app start; assembles the tab and its remediation section. |
| [`ui/app/tabs/EntitySearch.tsx`](../ui/app/tabs/EntitySearch.tsx) | Entity search by tag. |
| [`ui/app/queries.ts`](../ui/app/queries.ts) | `TAG_NAME_RE`, `tagsQuery`, `entitySearchQuery`, `dqlString`. |
| [`ui/app/RemediationPanel.tsx`](../ui/app/RemediationPanel.tsx) | Remediation section, `EnrichmentRuleForm`, `ManualActionView`. |
| [`ui/app/remediation.ts`](../ui/app/remediation.ts) | Enrichment body, input checks and submit; `processTagAction`; documentation links. |
| [`ui/app/analyses.ts`](../ui/app/analyses.ts) | `analyzeTags` (AI Assist). |
| [`ui/app/components.tsx`](../ui/app/components.tsx) | `PctGauge`, `QueryActions`, `DrillDownTable`, `QueryState`. |
| [`ui/app/links.ts`](../ui/app/links.ts) | `entityOverviewLink`. |
| [`app.config.json`](../app.config.json) | App scopes. |
