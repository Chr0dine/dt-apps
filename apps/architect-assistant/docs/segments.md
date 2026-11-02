# Segments

The Segments tab compares the environment's classic **management zones** with its **filter segments**. It
counts how many management zones already have a segment with the same name, how many of those segments this app
created, and how many zones use dimension rules that cannot be converted automatically. A search lists every zone
with its enabled rule types, its segment status and links to Settings and the Segments app. The **Remediation
actions** section converts selected management zones into segments: it finds every entity of each zone in Grail,
uploads the entity IDs as a lookup table, and creates (or refreshes in place) a segment whose filters read that
lookup. Segments filter data but do not restrict access, so the page also points out that management zone
permissions must be rebuilt as IAM policies.

| | |
| --- | --- |
| Area | Migration Assistance (see [index](README.md)) |
| Tab id | `segments` |
| Counts toward Entity Overview readiness / Top findings | No. Nothing on this tab feeds the overall readiness score or the Top 5 findings. The Top findings map only primary-field checks to remediation tabs ([`REMEDIATION_TARGET` in CoverageTabs.tsx](../ui/app/tabs/CoverageTabs.tsx#L131)); `segments` is never a target. |
| Main source files | [SegmentsTab.tsx](../ui/app/tabs/SegmentsTab.tsx), [segments.ts](../ui/app/segments.ts), [queries.ts](../ui/app/queries.ts#L639) (management zones to segments block), [RemediationPanel.tsx](../ui/app/RemediationPanel.tsx#L904) (`MzConvertForm`), [links.ts](../ui/app/links.ts), [analyses.ts](../ui/app/analyses.ts#L328) (`analyzeSegments`) |

## Contents

- [What this page answers](#what-this-page-answers)
- [Before you start](#before-you-start)
  - [App scopes used by this page](#app-scopes-used-by-this-page)
  - [User permissions](#user-permissions)
  - [One-time setup](#one-time-setup)
- [Page walkthrough](#page-walkthrough)
  - [Documentation link](#documentation-link)
  - [AI Assist panel](#ai-assist-panel)
  - [Heading and introduction](#heading-and-introduction)
  - [Loading and error states](#loading-and-error-states)
  - [Summary tiles and gauge](#summary-tiles-and-gauge)
  - [Search management zones](#search-management-zones)
  - [Management zone table](#management-zone-table)
  - [Remediation actions](#remediation-actions-section)
- [Checks and scoring](#checks-and-scoring)
- [Queries](#queries)
  - [Q1. Entity types](#q1-entity-types)
  - [Q2. Management zone membership (one query per chunk of types)](#q2-management-zone-membership-one-query-per-chunk-of-types)
  - [Client-side merge of the membership results](#client-side-merge-of-the-membership-results)
  - [Q3. Segment variable query (stored in the segment)](#q3-segment-variable-query-stored-in-the-segment)
- [The generated segment](#the-generated-segment)
  - [Which data fields are filtered](#which-data-fields-are-filtered)
  - [Include blocks](#include-blocks)
  - [Filter format](#filter-format)
  - [Full example segment body](#full-example-segment-body)
  - [Example with many entity types](#example-with-many-entity-types)
  - [Lookup file path: sanitising and hashing](#lookup-file-path-sanitising-and-hashing)
  - [externalId scheme](#externalid-scheme)
  - [How this differs from the MZ to Segments workflow](#how-this-differs-from-the-mz-to-segments-workflow)
- [API calls](#api-calls)
- [Remediation actions](#remediation-actions)
  - [Convert management zones to segments (API)](#convert-management-zones-to-segments-api)
  - [Replace the snapshot with rule-based segments (Manual)](#replace-the-snapshot-with-rule-based-segments-manual)
  - [Documentation for this fix](#documentation-for-this-fix)
- [AI Assist on this page](#ai-assist-on-this-page)
- [Limitations and edge cases](#limitations-and-edge-cases)
- [Troubleshooting](#troubleshooting)
- [Related pages](#related-pages)
- [Source files](#source-files)

## What this page answers

- **How far is the move from management zones to segments?** How many management zones exist, and how many of them
  have a segment with exactly the same name (the page's definition of "converted").
- **Which segments did Architect Assistant create?** Segments tagged with this app's `externalId` can be refreshed
  in place from the remediation section.
- **Which zones cannot be converted automatically?** Zones with enabled `DIMENSION` rules (metric or log dimension
  rules) are not entity based; the app cannot carry them into a segment.
- **Which zones are dead weight?** The AI Assist panel lists zones that have no enabled rules and suggests deleting
  them instead of converting them.
- **Where is each zone configured?** Every zone links to its Settings object; zones with a segment link to the
  Segments app.

The best practice behind the page: on the Dynatrace platform, segments replace management zones for **filtering**
data in apps, dashboards and notebooks. Segments do **not** control who can see data, so any access restriction that
used management zones must be recreated as IAM policies (the manual action's notes suggest policies on
`dt.security_context`). The page cites these Dynatrace docs (`SEGMENT_DOCS` in
[segments.ts](../ui/app/segments.ts#L34)):

- [Segments](https://docs.dynatrace.com/docs/manage/segments)
- [Segment limits](https://docs.dynatrace.com/docs/manage/segments/reference/segments-reference-limits)
- [Segment includes](https://docs.dynatrace.com/docs/manage/segments/concepts/segments-concepts-includes)
- [Segment visibility and access](https://docs.dynatrace.com/docs/manage/segments/concepts/segments-concepts-visibility)
- [Lookup data in Grail](https://docs.dynatrace.com/docs/platform/grail/lookup-data)

## Before you start

### App scopes used by this page

From [app.config.json](../app.config.json) and the code paths of this tab.

| Scope | What this page uses it for |
| --- | --- |
| `settings:objects:read` | List all `builtin:management-zones` Settings objects (names, rules) on tab load. |
| `storage:filter-segments:read` | List all segments (with `externalId`) on tab load. |
| `storage:system:read` | Remediation, *Find entities*: list the classic entity types from `dt.system.data_objects` ([Q1](#q1-entity-types)). |
| `storage:entities:read` | Remediation, *Find entities*: read classic entities (`dt.entity.*`) with their `managementZones` ([Q2](#q2-management-zone-membership-one-query-per-chunk-of-types)). |
| `storage:smartscape:read` | Remediation, *Find entities*: the join to `smartscapeNodes "*"` that adds Smartscape node IDs ([Q2](#q2-management-zone-membership-one-query-per-chunk-of-types)). |
| `storage:files:write` | Remediation, *Convert to segments*: upload one lookup table per zone to the Resource Store. |
| `storage:filter-segments:write` | Remediation, *Convert to segments*: create (POST) and refresh (PUT) segments. |
| `storage:filter-segments:share` | Remediation, *Convert to segments*: needed when *Visible to everyone (public)* is ticked (`isPublic: true`). |

Links to Settings, the Segments app, Notebooks and Dashboards are built with the navigation SDK
(`getIntentLink`, `getAppLink`, `sendIntent`) and need no scope.

### User permissions

An app can only do what the signed-in user is also allowed to do. Beyond running the app, the user needs the IAM
permissions that match the scopes above:

- To see the tiles and the search: read access to the `builtin:management-zones` settings schema
  (`settings:objects:read`) and `storage:filter-segments:read`. If the user cannot read the management zone objects,
  the Settings API returns no items rather than an error (see [Troubleshooting](#troubleshooting)).
- To run *Find entities*: `storage:system:read`, `storage:entities:read` and `storage:smartscape:read`.
- To run *Convert to segments*: `storage:files:write` (lookup upload), `storage:filter-segments:write`, and
  `storage:filter-segments:share` for public segments.
- **Users of a converted segment** need `storage:files:read`, because the segment's variable query loads the lookup
  file each time the segment is applied (the in-app hint says so next to the confirmation checkbox).

### One-time setup

None. This page uses no credential vault entries, no app functions, no outbound connections and no OAuth clients.
All calls run in the browser with the user's session.

## Page walkthrough

The tab is rendered by `SegmentsTab` ([SegmentsTab.tsx](../ui/app/tabs/SegmentsTab.tsx#L85)). It wraps the
Remediation actions section ([App.tsx](../ui/app/App.tsx#L128)) in a React context (`SegmentsDataContext`) so the
tiles, the search and the remediation form share one copy of the management zone and segment lists.

**When data loads.** `useLoadSegmentsData` ([SegmentsTab.tsx](../ui/app/tabs/SegmentsTab.tsx#L34)) runs
`listManagementZones()` and `listSegments()` in parallel (`Promise.all`) when the tab content is rendered, and again
whenever `reload()` is called (after every *Convert to segments* run). The tiles, gauge and search **do not depend on
the timeframe** selected in the app header; only the remediation's *Find entities* uses it.

**How a zone is matched to a segment.** The two lists are joined by name in the browser:

1. A map `name -> segment` is built over all segments. For each segment, the map keeps the first segment seen with
   that name, unless a later segment with the same name has this app's `externalId` for that name
   (`architect-assistant-mz-<hash(name)>`), in which case that one replaces it. So when several segments share a
   name, the one this app created wins.
2. Each zone looks up its exact name (case-sensitive, no trimming) in that map. The result is the zone's `segment`.
3. A zone is **managed** ("created by this app") when it has a segment and that segment's `externalId` equals
   `externalIdFor(zone name)`.

### Documentation link

Top right of the tab: **Segments documentation**, opening this page on GitHub (`TabDocsLink`,
[areas.tsx](../ui/app/areas.tsx#L86)).

### AI Assist panel

Shown at the top of the tab when the **AI Assist** button in the app header is on. Content is described in
[AI Assist on this page](#ai-assist-on-this-page).

### Heading and introduction

Heading **Segments**, followed by the fixed text:

> Segments replace management zones for filtering data on the Dynatrace platform. A management zone counts as
> converted when a segment with the same name exists. Unlike management zones, segments don't control who can see
> data. If you use management zones to restrict access, recreate those permissions with IAM policies.

### Loading and error states

- While either list is loading: the text **Loading…** replaces the tiles and the search.
- If either call fails: a critical message box **Could not read management zones or segments** with the error
  message of the failed call. Nothing else is shown above the remediation section. There is no retry button;
  reopen the tab or reload the app.

### Summary tiles and gauge

One row of tiles (wrapping on narrow screens), left to right. None of them is DQL-backed, so the row has no
Show DQL / Copy / Open in Notebook / Add to Dashboard actions (the membership queries are exposed in the remediation
preview instead).

| Tile | Value | Subtitle | Computation |
| --- | --- | --- | --- |
| **Segments** | Number of segments returned by the Filter Segments API | `<n> named after a management zone` | Value: length of the segment list, including ready-made segments and segments that match no zone. Subtitle: number of **segments** (not zones) whose name equals any zone's name; two segments with the same zone name count twice. |
| **Management zones** | Number of management zones | `<n> without a segment` | Value: zones read from Settings that have a non-empty `name`. Subtitle: zones minus zones with a same-name segment. |
| Gauge **Zones with a segment** | Percentage | `<with> of <total>` | `round(100 * withSegment / zones)`; `0` when there are no zones. Custom SVG gauge (`PctGauge`), 240-degree arc coloured along its length from red (0 %) through yellow to green (100 %). No (i) button. |
| **Created by this app** | Number of managed zones | `refreshable from the remediation section` | Zones whose same-name segment carries `externalId = architect-assistant-mz-<hash(zone name)>`. |
| **Zones with dimension rules** | Number of zones with at least one enabled `DIMENSION` rule | `need a manual segment filter` | Shown only when the count is greater than 0. |

### Search management zones

A card titled **Search management zones** with:

| Control | Behaviour |
| --- | --- |
| Text field **Management zone name contains** (placeholder `e.g. Cloud (leave empty for all)`) | Typing does nothing by itself. |
| Button **Search management zones** | Takes the trimmed text as the search term and shows the table. An empty term lists every zone. Matching is a case-insensitive substring match on the zone name, done in the browser on the already-loaded list; no query or API call runs. |

The table is not shown until the button has been clicked once. After that it stays and is recalculated whenever the
zone list reloads (for example after a conversion), using the last submitted term.

### Management zone table

A sortable, full-width, condensed Strato `DataTable`. Rows start in zone-name order (`localeCompare`, as returned by
`listManagementZones`). All matching zones are shown; there is no row limit and no paging.

| Column | Content | Source |
| --- | --- | --- |
| **Management zone** | Zone name | `value.name` of the Settings object |
| **Enabled rules** | Count per rule type among enabled rules, for example `3 entity, 1 selector, 2 dimension`; `none` when the zone has no enabled rule | `value.rules[]`: rules with `enabled === false` are ignored; type `ME` is shown as "entity", `SELECTOR` as "selector", `DIMENSION` as "dimension"; a type with 0 rules is omitted |
| **Segment with the same name** | `Yes (created by this app)` (managed), `Yes` (segment exists, other origin) or `No`; when a segment exists, followed by ` · Open Segments ↗` | Name match described above. The link opens the Segments app (`getAppLink("dynatrace.segments.management")`, [links.ts](../ui/app/links.ts#L17)). The Segments app publishes no intents or page tokens, so the link cannot open the individual segment. |
| **Configuration** | **Open in Settings ↗**, or `—` when no link can be built | The zone's Settings object, opened with intent `deprecated_open_settings_by_id` of app `dynatrace.settings` and payload `{"dt.settings.object_id": "<objectId>"}` ([links.ts](../ui/app/links.ts#L7)). The code notes this is the only Settings intent that opens a single object by ID. |

Empty states: **No management zones match this search.** when zones exist but none matches, or **No management
zones are defined in this environment.** when there are no zones at all.

### Remediation actions (section)

Below the table: the **Remediation actions** section (`<RemediationPanel tab="segments">`, anchor id
`remediation-segments`). Its header line reads `<n> management zone(s) without a segment of the same name.` (or
`Reading management zones…` while the list loads). The **Action** dropdown offers:

1. `API · Convert management zones to segments` (selected by default)
2. `Manual · Replace the snapshot with rule-based segments`

Both are described in [Remediation actions](#remediation-actions).

## Checks and scoring

| Check / status | In place when | Numerator | Denominator | Severity / thresholds | Notes |
| --- | --- | --- | --- | --- | --- |
| Zone has a segment (gauge **Zones with a segment**) | A segment exists whose `name` is exactly the zone's name | Zones with a same-name segment | All zones with a name | Gauge colour follows the percentage (red to green). In AI Assist: 90 % or more = good, 50-89 % = warning, below 50 % = critical | Case-sensitive. Any segment counts, whoever created it. |
| Created by this app (managed) | The zone's same-name segment has `externalId = architect-assistant-mz-<FNV-1a hash of the zone name>` | Managed zones | (count only) | None | Only managed zones can be refreshed by the remediation. |
| Without a segment | No segment with the zone's name | Zones without a segment | (count only) | AI Assist: warning when greater than 0 | Default scope of the remediation form. |
| Zone with dimension rules | At least one enabled rule of type `DIMENSION` | Zones with such rules | (count only) | AI Assist: warning | Dimension rules are not entity based and are not carried into the segment. |
| Zone with no enabled rules | Every rule disabled, or no rules | Such zones | (count only) | AI Assist: info | Shown as `none` in **Enabled rules**. |
| Segment status label in the table | `Yes (created by this app)` if managed; else `Yes` if a same-name segment exists; else `No` | | | | |
| Remediation preview status per zone | `create` (no managed segment), `refresh (same segment UID)` (managed segment exists), or `skipped` with a reason (see [planProblem](#convert-management-zones-to-segments-api)) | | | Red left border for skipped, green otherwise | Computed after *Find entities*. |

## Queries

This tab's tiles, gauge and search use no DQL. DQL runs only in the remediation form, when you click **Find
entities**, through `queryExecutionClient` directly (not through `useDql`, so nothing is cached and nothing re-runs
on its own). A third query is not run by the app at all: it is stored in each converted segment and runs whenever
someone applies the segment.

| # | Name (function in source) | Runs when | Feeds |
| --- | --- | --- | --- |
| Q1 | Entity types (`ENTITY_TYPES_QUERY`, [queries.ts](../ui/app/queries.ts#L641)) | Click **Find entities**, before Q2 | The list of `dt.entity.*` types Q2 fetches; the count in *Searched N entity types* |
| Q2 | Management zone membership (`mzMembershipQueries`, [queries.ts](../ui/app/queries.ts#L658)) | Right after Q1, one query per chunk of up to 181 types, all chunks in parallel | Preview per zone (entities per type, Smartscape IDs), the lookup content of each segment, the choice of filter fields |
| Q3 | Segment variable query (`segmentVariableQuery`, [queries.ts](../ui/app/queries.ts#L678)) | Never by this app. Stored in the segment's `variables`; Grail runs it when a user applies the segment | The `$ids` and `$frontends` variables the segment's filters use |

Both Q1 and Q2 are executed by `runQuery` ([segments.ts](../ui/app/segments.ts#L121)):
`POST /platform/storage/query/v1/query:execute` with
`{ query, requestTimeoutMilliseconds: 30000, maxResultRecords: 100000, maxResultBytes: 100000000 }`, then
`GET /platform/storage/query/v1/query:poll` (with the request token and `requestTimeoutMilliseconds: 30000`) until
the state is no longer `RUNNING` or `NOT_STARTED`. Any final state other than `SUCCEEDED` throws
`Query <state>.` (for example `Query failed.`). The result limits are raised so the long ID arrays are not
truncated. The 30-second values are how long each call waits for a result before returning; the loop itself has no
overall timeout.

### Q1. Entity types

- **Source:** `ENTITY_TYPES_QUERY` in [queries.ts](../ui/app/queries.ts#L641), called from `findMembership` in
  [segments.ts](../ui/app/segments.ts#L152).
- **Runs:** each time you click **Find entities**. It has no timeframe and does not depend on the selected zones.
- **Parameters:** none.
- **Query:**

```dql
fetch dt.system.data_objects
| filter startsWith(name, "dt.entity.")
| fields name
| sort name asc
```

- **How it works:**
  - `fetch dt.system.data_objects` lists every data object (table) in Grail, one record per object with its `name`.
  - `filter startsWith(name, "dt.entity.")` keeps the classic entity tables (`dt.entity.host`,
    `dt.entity.service`, `dt.entity.process_group_instance`, extension and cloud entity types, and so on). The code
    comment notes several hundred such types on the demo tenant (575).
  - `fields name` keeps only the name; `sort name asc` gives a stable order, so the chunks of Q2 are reproducible.
- **Output:** one column `name`. The app converts each value to a string and passes the list to Q2. The number of
  types is shown in the preview (`Searched <n> entity types …`).
- **Limits and cost:** reads system metadata only; no scan of observability data.
- **Open it yourself:** not exposed in the UI. Copy it from this page.

The point of discovering the types instead of using a fixed list: every type that can carry `managementZones` is
searched, including the targets of `SELECTOR` rules such as extension entity types.

### Q2. Management zone membership (one query per chunk of types)

- **Source:** `mzMembershipQueries(tf, types, zones)` in [queries.ts](../ui/app/queries.ts#L658); executed by
  `findMembership` in [segments.ts](../ui/app/segments.ts#L152).
- **Runs:** right after Q1, when you click **Find entities**. All chunk queries run in parallel
  (`Promise.all`). It does not re-run on its own when the timeframe changes; click **Find entities** again.
- **Parameters:**
  - `tf`: the app's timeframe (`24h` default, `7d`, `30d`). Every `from:now()-24h` becomes `from:now()-7d` or
    `from:now()-30d`, both in each `fetch` and in the `smartscapeNodes` join.
  - `types`: the names from Q1. `dt.entity.host` is the **anchor type** and is removed from the list; the remaining
    types are split into chunks of 180 (`MEMBERSHIP_CHUNK`). Each chunk becomes one query that fetches the anchor
    first and then appends the chunk's 180 types (181 fetches). With the 575 types noted in the code this gives 4
    queries with 181, 181, 181 and 35 fetches. If Q1 returns no type other than the anchor, one query with only the
    anchor fetch is generated (it then has a blank line before `| fields`, which DQL ignores).
  - `zones`: the names of the zones ticked in the form, written as DQL string literals (backslashes and double
    quotes are escaped by `dqlString`, e.g. `Team "A"` becomes `"Team \"A\""`). All selected zones go into every
    chunk query.
- **Query:** generated with six placeholder types (a real run has hundreds, split into chunks as described) and two
  placeholder zones, `Production` and `Checkout: EU`, default timeframe:

```dql
fetch `dt.entity.host`, from:now()-24h
| append [fetch `dt.entity.application`, from:now()-24h]
| append [fetch `dt.entity.cloud_application`, from:now()-24h]
| append [fetch `dt.entity.process_group`, from:now()-24h]
| append [fetch `dt.entity.process_group_instance`, from:now()-24h]
| append [fetch `dt.entity.service`, from:now()-24h]
| fields id, entity.name, managementZones
| expand managementZones
| filter in(managementZones, array("Production", "Checkout: EU"))
| fieldsAdd prefix = splitString(id, "-")[0]
| fieldsAdd frontend = if(in(prefix, array("APPLICATION", "MOBILE_APPLICATION", "CUSTOM_APPLICATION")), entity.name)
| join [smartscapeNodes "*", from:now()-24h | filter isNotNull(id_classic) | fields sid = id, id_classic], kind:leftOuter, on:{left[id] == right[id_classic]}, fields:{sid}
| summarize entities = countDistinct(id), ids = collectDistinct(id), sids = collectDistinct(sid), frontends = collectDistinct(frontend), by:{zone = managementZones, prefix}
```

  With *Last 7 days* the first lines read:

```dql
fetch `dt.entity.host`, from:now()-7d
| append [fetch `dt.entity.application`, from:now()-7d]
```

  The second chunk of a real run starts again with ``fetch `dt.entity.host` `` and continues with types 181 to 360
  of the sorted list; everything from `| fields` on is identical in every chunk.

- **How it works:**
  - ``fetch `dt.entity.host`, from:now()-24h`` reads classic host entities that existed in the timeframe. Host is
    fetched first in every chunk because it is known to carry `managementZones`, so the field resolves even when no
    other type in the chunk has it (per the code comment, a type without the field fails on its own but is fine
    inside the union).
  - ``| append [fetch `dt.entity.<type>`, from:now()-24h]`` adds the records of each other type in the chunk. The
    type names are backtick-quoted because some contain characters such as `:`. 180 appends per query keep the
    query under DQL's limit of 1000 expressions per query (the code notes 200 was also validated).
  - `| fields id, entity.name, managementZones` keeps the classic entity ID (`HOST-…`, `SERVICE-…`), its display
    name and the array of management zone **names** the entity belongs to.
  - `| expand managementZones` turns one entity in three zones into three records, one per zone name.
  - `| filter in(managementZones, array(...))` keeps only the records of the selected zones.
  - `| fieldsAdd prefix = splitString(id, "-")[0]` takes the entity-type prefix of the classic ID (`HOST`,
    `PROCESS_GROUP_INSTANCE`, `APPLICATION`, …). It decides which data fields the segment filters on.
  - `| fieldsAdd frontend = if(in(prefix, array("APPLICATION", "MOBILE_APPLICATION", "CUSTOM_APPLICATION")), entity.name)`
    keeps the name of web, mobile and custom applications only (null for every other type). These names become the
    `$frontends` variable, matched against `frontend.name` on user events. No other entity is matched by name,
    because names are not unique.
  - `| join [smartscapeNodes "*", from:now()-24h | filter isNotNull(id_classic) | fields sid = id, id_classic], kind:leftOuter, on:{left[id] == right[id_classic]}, fields:{sid}`
    reads every Smartscape node of the timeframe that has a classic counterpart (`id_classic`) and adds its
    Smartscape node ID as `sid`. Process, container and Kubernetes IDs differ between the classic and the Smartscape
    model, so without this the segment would not scope `smartscapeNodes` queries. `leftOuter` keeps entities that
    have no Smartscape node (their `sid` is null).
  - `| summarize … by:{zone = managementZones, prefix}` produces one record per zone and entity-type prefix:
    `entities` (distinct classic IDs), `ids` (the distinct classic IDs), `sids` (the distinct Smartscape IDs) and
    `frontends` (the distinct application names).
- **Output:** columns `zone`, `prefix`, `entities`, `ids`, `sids`, `frontends`. The browser uses `zone`, `prefix`,
  `ids`, `sids` and `frontends` (see the next section). `entities` is not used: because the anchor type is fetched
  in every chunk, host rows appear once per chunk, and counts are taken from distinct IDs instead.
- **Limits and cost:** each chunk fetches up to 181 entity tables and joins all Smartscape nodes of the timeframe;
  for a tenant with 575 types, 4 such queries run at the same time. Entities are counted only if they existed in
  the selected timeframe; longer timeframes include entities that no longer exist. The result limits are raised
  (100,000 records, 100 MB) for the ID arrays.
- **Open it yourself:** yes. After *Find entities*, expand **Membership queries (N)** in the preview. Each chunk has
  its own **Show DQL / Copy / ↗ Open in Notebook / ↗ Add to Dashboard** row, titled
  `Management zone membership (i of N)`. Open in Notebook sends intent `view-query` to `dynatrace.notebooks`; Add to
  Dashboard sends `add-to-dashboard` to `dynatrace.dashboards`, both with payload `{ "dt.query": <query>, "title": <title> }`.

### Client-side merge of the membership results

`findMembership` ([segments.ts](../ui/app/segments.ts#L152)) combines the records of all chunks:

1. For each record, take `zone` and `prefix` (missing prefix becomes `OTHER`).
2. Add every non-empty string of `ids` to the zone's set of classic IDs and to the set for that prefix.
3. Add every string of `sids` to the zone's Smartscape ID set and every string of `frontends` to its frontend set.
4. For each selected zone, in the order selected, build a `Membership`:
   - `byType`: number of distinct classic IDs per prefix (shown in the preview, e.g. `HOST 2, SERVICE 1`).
   - `ids`: all distinct classic IDs.
   - `smartscapeIds`: Smartscape IDs that are **not** also in `ids` (for types whose Smartscape ID equals the
     classic ID, the duplicate is dropped).
   - `frontends`: distinct application names.
   - A selected zone with no records gets an empty membership; it is then skipped with
     *No entities found in this management zone for the selected timeframe.*
5. Return the memberships, the generated queries (for the preview) and the number of types from Q1.

### Q3. Segment variable query (stored in the segment)

- **Source:** `segmentVariableQuery(path)` in [queries.ts](../ui/app/queries.ts#L678), used by `planSegment` in
  [segments.ts](../ui/app/segments.ts#L268).
- **Runs:** never by this app. It is written into the segment as `variables: { type: "query", value: <query> }`.
  The platform runs it whenever a user applies the segment, with that user's permissions.
- **Parameters:** `path`, the zone's lookup file path (see
  [Lookup file path](#lookup-file-path-sanitising-and-hashing)). Example for the zone `Checkout: EU`:
- **Query:**

```dql
load "/lookups/architect_assistant/mz/Checkout_EU_f6e2505d"
| fields zone = key, ids, frontends
```

- **How it works:**
  - `load "<path>"` reads the lookup file this app uploaded to the Resource Store. The file has exactly one record
    (the upload is rejected by the app unless the Resource Store reports 1 record).
  - `fields zone = key, ids, frontends` renames `key` (the zone name) to `zone` and keeps the `ids` and
    `frontends` arrays. The code comment notes that the first column is the primary variable.
- **Output:** one row; the segment exposes its columns as variables `$zone`, `$ids` and `$frontends`. The filters use
  `$ids` and `$frontends`.
- **Limits and cost:** a single-row lookup read. Users of the segment need `storage:files:read`.
- **Open it yourself:** visible (as `body.variables.value`) in the **Request** block of the remediation preview,
  which has a Copy button. There are no notebook / dashboard actions for it.

## The generated segment

`planSegment(membership, isPublic)` ([segments.ts](../ui/app/segments.ts#L268)) turns one zone's membership into the
lookup content and the segment body.

### Which data fields are filtered

`DATA_FIELDS` ([segments.ts](../ui/app/segments.ts#L191)) lists the fields matched against `$ids`, in priority order,
each with the entity-ID prefix that makes it relevant. A field is used only when the zone contains at least one
entity with that prefix; `dt.source_entity` is always used. The code comment says the presence of each field on
logs, spans, metrics, events and problems was measured on the demo tenant.

| # | Field | Relevant when the zone has entities with prefix | RUM / synthetic field |
| --- | --- | --- | --- |
| 1 | `dt.source_entity` | always | |
| 2 | `dt.entity.host` | `HOST` | |
| 3 | `dt.entity.service` | `SERVICE` | |
| 4 | `dt.entity.process_group_instance` | `PROCESS_GROUP_INSTANCE` | |
| 5 | `dt.entity.process_group` | `PROCESS_GROUP` | |
| 6 | `dt.entity.kubernetes_cluster` | `KUBERNETES_CLUSTER` | |
| 7 | `dt.entity.cloud_application_namespace` | `CLOUD_APPLICATION_NAMESPACE` | |
| 8 | `dt.entity.cloud_application` | `CLOUD_APPLICATION` | |
| 9 | `dt.entity.cloud_application_instance` | `CLOUD_APPLICATION_INSTANCE` | |
| 10 | `dt.entity.kubernetes_node` | `KUBERNETES_NODE` | |
| 11 | `dt.entity.custom_device` | `CUSTOM_DEVICE` | |
| 12 | `dt.entity.container_group_instance` | `CONTAINER_GROUP_INSTANCE` | |
| 13 | `dt.entity.ec2_instance` | `EC2_INSTANCE` | |
| 14 | `dt.entity.application` | `APPLICATION` | yes |
| 15 | `dt.entity.mobile_application` | `MOBILE_APPLICATION` | yes |
| 16 | `dt.entity.custom_application` | `CUSTOM_APPLICATION` | yes |
| 17 | `dt.entity.synthetic_test` | `SYNTHETIC_TEST` | yes |
| 18 | `dt.entity.http_check` | `HTTP_CHECK` | yes |
| 19 | `dt.entity.external_synthetic_test` | `EXTERNAL_SYNTHETIC_TEST` | yes |

Entities of types not in this table (for example extension or cloud service types) are still in `$ids`; they are
matched through `dt.source_entity` on data and through `id` on entities.

### Include blocks

A segment's include blocks are ORed (data matching any include is in the segment). The segment API allows at most
20 include blocks and 10 expressions per filter (`MAX_EXPRESSIONS = 10`, from the segment limits docs). The app
builds, in this order:

| Include (`dataObject`) | Statements (each `field in ($variable)`) | Added when |
| --- | --- | --- |
| `_all_data_object` | The first 10 relevant fields of the table above, each `in ($ids)` | Always (it always has at least `dt.source_entity`). |
| `events` | The relevant RUM / synthetic fields (rows 14-19) followed by the relevant fields that did not fit in `_all_data_object` (overflow), de-duplicated, each `in ($ids)`; at most 10 | Only when at least one of those fields is not already in `_all_data_object`. |
| `metrics` | Same statements as `events` | Same condition as `events`. |
| `user.events` | `frontend.name in ($frontends)` when the zone has application names, then the relevant RUM / synthetic fields `in ($ids)`; at most 10 | When it has at least one statement. |
| `_all_entities` | `id in ($ids)` | Always. Scopes entity queries, including `smartscapeNodes` (because `$ids` also holds the Smartscape IDs). |

Fields that end up in no include are reported in the preview as *Not filterable (10-expression limit): …*. With the
current 19-field list this cannot happen: `_all_data_object` takes at most 10 fields, the overflow plus RUM /
synthetic fields are at most 9, and `user.events` has at most 7 statements.

A segment therefore has 2 to 5 include blocks, well under the 20-block limit. Examples:

- A zone with only extension entities (no prefix in the table): `_all_data_object` (`dt.source_entity`) and
  `_all_entities`.
- A typical application zone (hosts, processes, services, one web application): `_all_data_object` (6 fields),
  `user.events` (2), `_all_entities` (1). See the [full example](#full-example-segment-body).
- A zone spanning many types: all five includes. See the [example with many entity types](#example-with-many-entity-types).

### Filter format

Each include's `filter` is a JSON **string** holding the filter syntax tree in the format the Segments app stores
(`buildFilter`, [segments.ts](../ui/app/segments.ts#L221); the code notes it is the same structure as the MZ to
Segments workflow's payload). The tree describes the text `k1 in ($v) OR k2 in ($v) OR …`, with character ranges
into that text:

- Root: `type: "Group"`, `range` over the whole text, `logicalOperator: "OR"` and `explicitLogicalOperator: true`
  when there is more than one statement (otherwise `"AND"` / `false`), `explicit: false`, `version: "004"`.
- One `Statement` per field: `key` (`type: "Key"`), `operator` and `comparisonOperator` (both
  `type: "InclusionOperator"`, `in`), and `value` of `type: "List"` (text `($ids)`) holding one
  `type: "Variable"` element (`$ids` or `$frontends`, `variableType: "Any"`).
- Statements are separated by ` OR ` (4 characters), which is how the ranges are calculated.

Decoded `user.events` filter of the full example below:

```json
{
  "type": "Group",
  "range": { "from": 0, "to": 64 },
  "logicalOperator": "OR",
  "explicit": false,
  "explicitLogicalOperator": true,
  "children": [
    {
      "type": "Statement",
      "range": { "from": 0, "to": 29 },
      "key": { "type": "Key", "range": { "from": 0, "to": 13 }, "textValue": "frontend.name", "value": "frontend.name" },
      "operator": { "type": "InclusionOperator", "textValue": "in", "value": "in", "range": { "from": 14, "to": 16 } },
      "comparisonOperator": { "type": "InclusionOperator", "textValue": "in", "value": "in", "range": { "from": 14, "to": 16 } },
      "value": {
        "type": "List",
        "range": { "from": 17, "to": 29 },
        "textValue": "($frontends)",
        "value": [
          { "type": "Variable", "range": { "from": 18, "to": 28 }, "textValue": "$frontends", "value": "$frontends", "variableType": "Any" }
        ]
      }
    },
    {
      "type": "Statement",
      "range": { "from": 33, "to": 64 },
      "key": { "type": "Key", "range": { "from": 33, "to": 54 }, "textValue": "dt.entity.application", "value": "dt.entity.application" },
      "operator": { "type": "InclusionOperator", "textValue": "in", "value": "in", "range": { "from": 55, "to": 57 } },
      "comparisonOperator": { "type": "InclusionOperator", "textValue": "in", "value": "in", "range": { "from": 55, "to": 57 } },
      "value": {
        "type": "List",
        "range": { "from": 58, "to": 64 },
        "textValue": "($ids)",
        "value": [
          { "type": "Variable", "range": { "from": 59, "to": 63 }, "textValue": "$ids", "value": "$ids", "variableType": "Any" }
        ]
      }
    }
  ],
  "version": "004"
}
```

### Full example segment body

Generated by `planSegment` for a placeholder zone **`Checkout: EU`** whose membership is 2 hosts, 2 process group
instances, 1 process group, 1 service and 1 web application named `www.example.com`, plus 2 Smartscape process IDs.
*Visible to everyone (public)* is ticked.

Lookup content (the `content` part of the upload, all IDs):

```json
{
  "key": "Checkout: EU",
  "ids": [
    "HOST-0000000000000001",
    "HOST-0000000000000002",
    "PROCESS_GROUP_INSTANCE-0000000000000001",
    "PROCESS_GROUP_INSTANCE-0000000000000002",
    "PROCESS_GROUP-0000000000000001",
    "SERVICE-0000000000000001",
    "APPLICATION-0000000000000001",
    "PROCESS-0000000000000001",
    "PROCESS-0000000000000002"
  ],
  "frontends": [
    "www.example.com"
  ]
}
```

`ids` is the classic IDs followed by the Smartscape IDs; `key` is the zone name.

Segment body sent with `POST /platform/storage/filter-segments/v1/filter-segments` (exact output, filters are
JSON strings):

```json
{
  "name": "Checkout: EU",
  "description": "Converted from management zone \"Checkout: EU\" by Architect Assistant. Entity snapshot; refresh to pick up changes.",
  "externalId": "architect-assistant-mz-f6e2505d",
  "isPublic": true,
  "variables": {
    "type": "query",
    "value": "load \"/lookups/architect_assistant/mz/Checkout_EU_f6e2505d\"\n| fields zone = key, ids, frontends"
  },
  "includes": [
    {
      "dataObject": "_all_data_object",
      "filter": "{\"type\":\"Group\",\"range\":{\"from\":0,\"to\":203},\"logicalOperator\":\"OR\",\"explicit\":false,\"explicitLogicalOperator\":true,\"children\":[{\"type\":\"Statement\",\"range\":{\"from\":0,\"to\":26},\"key\":{\"type\":\"Key\",\"range\":{\"from\":0,\"to\":16},\"textValue\":\"dt.source_entity\",\"value\":\"dt.source_entity\"},\"operator\":{\"type\":\"InclusionOperator\",\"textValue\":\"in\",\"value\":\"in\",\"range\":{\"from\":17,\"to\":19}},\"comparisonOperator\":{\"type\":\"InclusionOperator\",\"textValue\":\"in\",\"value\":\"in\",\"range\":{\"from\":17,\"to\":19}},\"value\":{\"type\":\"List\",\"range\":{\"from\":20,\"to\":26},\"textValue\":\"($ids)\",\"value\":[{\"type\":\"Variable\",\"range\":{\"from\":21,\"to\":25},\"textValue\":\"$ids\",\"value\":\"$ids\",\"variableType\":\"Any\"}]}},{\"type\":\"Statement\",\"range\":{\"from\":30,\"to\":54},\"key\":{\"type\":\"Key\",\"range\":{\"from\":30,\"to\":44},\"textValue\":\"dt.entity.host\",\"value\":\"dt.entity.host\"},\"operator\":{\"type\":\"InclusionOperator\",\"textValue\":\"in\",\"value\":\"in\",\"range\":{\"from\":45,\"to\":47}},\"comparisonOperator\":{\"type\":\"InclusionOperator\",\"textValue\":\"in\",\"value\":\"in\",\"range\":{\"from\":45,\"to\":47}},\"value\":{\"type\":\"List\",\"range\":{\"from\":48,\"to\":54},\"textValue\":\"($ids)\",\"value\":[{\"type\":\"Variable\",\"range\":{\"from\":49,\"to\":53},\"textValue\":\"$ids\",\"value\":\"$ids\",\"variableType\":\"Any\"}]}},{\"type\":\"Statement\",\"range\":{\"from\":58,\"to\":85},\"key\":{\"type\":\"Key\",\"range\":{\"from\":58,\"to\":75},\"textValue\":\"dt.entity.service\",\"value\":\"dt.entity.service\"},\"operator\":{\"type\":\"InclusionOperator\",\"textValue\":\"in\",\"value\":\"in\",\"range\":{\"from\":76,\"to\":78}},\"comparisonOperator\":{\"type\":\"InclusionOperator\",\"textValue\":\"in\",\"value\":\"in\",\"range\":{\"from\":76,\"to\":78}},\"value\":{\"type\":\"List\",\"range\":{\"from\":79,\"to\":85},\"textValue\":\"($ids)\",\"value\":[{\"type\":\"Variable\",\"range\":{\"from\":80,\"to\":84},\"textValue\":\"$ids\",\"value\":\"$ids\",\"variableType\":\"Any\"}]}},{\"type\":\"Statement\",\"range\":{\"from\":89,\"to\":131},\"key\":{\"type\":\"Key\",\"range\":{\"from\":89,\"to\":121},\"textValue\":\"dt.entity.process_group_instance\",\"value\":\"dt.entity.process_group_instance\"},\"operator\":{\"type\":\"InclusionOperator\",\"textValue\":\"in\",\"value\":\"in\",\"range\":{\"from\":122,\"to\":124}},\"comparisonOperator\":{\"type\":\"InclusionOperator\",\"textValue\":\"in\",\"value\":\"in\",\"range\":{\"from\":122,\"to\":124}},\"value\":{\"type\":\"List\",\"range\":{\"from\":125,\"to\":131},\"textValue\":\"($ids)\",\"value\":[{\"type\":\"Variable\",\"range\":{\"from\":126,\"to\":130},\"textValue\":\"$ids\",\"value\":\"$ids\",\"variableType\":\"Any\"}]}},{\"type\":\"Statement\",\"range\":{\"from\":135,\"to\":168},\"key\":{\"type\":\"Key\",\"range\":{\"from\":135,\"to\":158},\"textValue\":\"dt.entity.process_group\",\"value\":\"dt.entity.process_group\"},\"operator\":{\"type\":\"InclusionOperator\",\"textValue\":\"in\",\"value\":\"in\",\"range\":{\"from\":159,\"to\":161}},\"comparisonOperator\":{\"type\":\"InclusionOperator\",\"textValue\":\"in\",\"value\":\"in\",\"range\":{\"from\":159,\"to\":161}},\"value\":{\"type\":\"List\",\"range\":{\"from\":162,\"to\":168},\"textValue\":\"($ids)\",\"value\":[{\"type\":\"Variable\",\"range\":{\"from\":163,\"to\":167},\"textValue\":\"$ids\",\"value\":\"$ids\",\"variableType\":\"Any\"}]}},{\"type\":\"Statement\",\"range\":{\"from\":172,\"to\":203},\"key\":{\"type\":\"Key\",\"range\":{\"from\":172,\"to\":193},\"textValue\":\"dt.entity.application\",\"value\":\"dt.entity.application\"},\"operator\":{\"type\":\"InclusionOperator\",\"textValue\":\"in\",\"value\":\"in\",\"range\":{\"from\":194,\"to\":196}},\"comparisonOperator\":{\"type\":\"InclusionOperator\",\"textValue\":\"in\",\"value\":\"in\",\"range\":{\"from\":194,\"to\":196}},\"value\":{\"type\":\"List\",\"range\":{\"from\":197,\"to\":203},\"textValue\":\"($ids)\",\"value\":[{\"type\":\"Variable\",\"range\":{\"from\":198,\"to\":202},\"textValue\":\"$ids\",\"value\":\"$ids\",\"variableType\":\"Any\"}]}}],\"version\":\"004\"}"
    },
    {
      "dataObject": "user.events",
      "filter": "{\"type\":\"Group\",\"range\":{\"from\":0,\"to\":64},\"logicalOperator\":\"OR\",\"explicit\":false,\"explicitLogicalOperator\":true,\"children\":[{\"type\":\"Statement\",\"range\":{\"from\":0,\"to\":29},\"key\":{\"type\":\"Key\",\"range\":{\"from\":0,\"to\":13},\"textValue\":\"frontend.name\",\"value\":\"frontend.name\"},\"operator\":{\"type\":\"InclusionOperator\",\"textValue\":\"in\",\"value\":\"in\",\"range\":{\"from\":14,\"to\":16}},\"comparisonOperator\":{\"type\":\"InclusionOperator\",\"textValue\":\"in\",\"value\":\"in\",\"range\":{\"from\":14,\"to\":16}},\"value\":{\"type\":\"List\",\"range\":{\"from\":17,\"to\":29},\"textValue\":\"($frontends)\",\"value\":[{\"type\":\"Variable\",\"range\":{\"from\":18,\"to\":28},\"textValue\":\"$frontends\",\"value\":\"$frontends\",\"variableType\":\"Any\"}]}},{\"type\":\"Statement\",\"range\":{\"from\":33,\"to\":64},\"key\":{\"type\":\"Key\",\"range\":{\"from\":33,\"to\":54},\"textValue\":\"dt.entity.application\",\"value\":\"dt.entity.application\"},\"operator\":{\"type\":\"InclusionOperator\",\"textValue\":\"in\",\"value\":\"in\",\"range\":{\"from\":55,\"to\":57}},\"comparisonOperator\":{\"type\":\"InclusionOperator\",\"textValue\":\"in\",\"value\":\"in\",\"range\":{\"from\":55,\"to\":57}},\"value\":{\"type\":\"List\",\"range\":{\"from\":58,\"to\":64},\"textValue\":\"($ids)\",\"value\":[{\"type\":\"Variable\",\"range\":{\"from\":59,\"to\":63},\"textValue\":\"$ids\",\"value\":\"$ids\",\"variableType\":\"Any\"}]}}],\"version\":\"004\"}"
    },
    {
      "dataObject": "_all_entities",
      "filter": "{\"type\":\"Group\",\"range\":{\"from\":0,\"to\":12},\"logicalOperator\":\"AND\",\"explicit\":false,\"explicitLogicalOperator\":false,\"children\":[{\"type\":\"Statement\",\"range\":{\"from\":0,\"to\":12},\"key\":{\"type\":\"Key\",\"range\":{\"from\":0,\"to\":2},\"textValue\":\"id\",\"value\":\"id\"},\"operator\":{\"type\":\"InclusionOperator\",\"textValue\":\"in\",\"value\":\"in\",\"range\":{\"from\":3,\"to\":5}},\"comparisonOperator\":{\"type\":\"InclusionOperator\",\"textValue\":\"in\",\"value\":\"in\",\"range\":{\"from\":3,\"to\":5}},\"value\":{\"type\":\"List\",\"range\":{\"from\":6,\"to\":12},\"textValue\":\"($ids)\",\"value\":[{\"type\":\"Variable\",\"range\":{\"from\":7,\"to\":11},\"textValue\":\"$ids\",\"value\":\"$ids\",\"variableType\":\"Any\"}]}}],\"version\":\"004\"}"
    }
  ]
}
```

The same filters in readable form (this is the text the ranges point into):

```text
_all_data_object: dt.source_entity in ($ids) OR dt.entity.host in ($ids) OR dt.entity.service in ($ids) OR dt.entity.process_group_instance in ($ids) OR dt.entity.process_group in ($ids) OR dt.entity.application in ($ids)
user.events:      frontend.name in ($frontends) OR dt.entity.application in ($ids)
_all_entities:    id in ($ids)
```

No `events` / `metrics` include is added here: the only RUM / synthetic field (`dt.entity.application`) already
fits in `_all_data_object`.

Body fields:

| Field | Value | Notes |
| --- | --- | --- |
| `name` | The zone name, unchanged | Zones with names longer than 100 characters are skipped (segment name limit). |
| `description` | `Converted from management zone "<zone>" by Architect Assistant. Entity snapshot; refresh to pick up changes.` | Cut to 200 characters. |
| `externalId` | `architect-assistant-mz-<hash>` | See [externalId scheme](#externalid-scheme). |
| `isPublic` | The *Visible to everyone (public)* checkbox (default ticked) | `true` needs `storage:filter-segments:share`. |
| `variables` | `{ "type": "query", "value": <Q3> }` | |
| `includes` | As described above | |

For a **refresh** the same body is sent with `PUT …/filter-segments/<uid>?optimistic-locking-version=<version>`,
plus `"uid": "<existing uid>"` and `"owner": "<existing owner>"` taken from the segment list. A PUT overwrites every
updatable field (name, description, isPublic, variables, includes), so manual edits made to a converted segment in
the Segments app are replaced.

### Example with many entity types

A placeholder zone `Platform` with entities of the prefixes `HOST`, `SERVICE`, `PROCESS_GROUP_INSTANCE`,
`PROCESS_GROUP`, `KUBERNETES_CLUSTER`, `CLOUD_APPLICATION_NAMESPACE`, `CLOUD_APPLICATION`,
`CLOUD_APPLICATION_INSTANCE`, `KUBERNETES_NODE`, `CUSTOM_DEVICE`, `CONTAINER_GROUP_INSTANCE`, `APPLICATION`,
`SYNTHETIC_TEST` and `HTTP_CHECK`, without application names in the lookup, produces 15 relevant fields and five
includes (preview line `Includes: _all_data_object (10), events (5), metrics (5), user.events (3), _all_entities (1)`):

```text
_all_data_object: dt.source_entity in ($ids) OR dt.entity.host in ($ids) OR dt.entity.service in ($ids) OR dt.entity.process_group_instance in ($ids) OR dt.entity.process_group in ($ids) OR dt.entity.kubernetes_cluster in ($ids) OR dt.entity.cloud_application_namespace in ($ids) OR dt.entity.cloud_application in ($ids) OR dt.entity.cloud_application_instance in ($ids) OR dt.entity.kubernetes_node in ($ids)
events:           dt.entity.application in ($ids) OR dt.entity.synthetic_test in ($ids) OR dt.entity.http_check in ($ids) OR dt.entity.custom_device in ($ids) OR dt.entity.container_group_instance in ($ids)
metrics:          dt.entity.application in ($ids) OR dt.entity.synthetic_test in ($ids) OR dt.entity.http_check in ($ids) OR dt.entity.custom_device in ($ids) OR dt.entity.container_group_instance in ($ids)
user.events:      dt.entity.application in ($ids) OR dt.entity.synthetic_test in ($ids) OR dt.entity.http_check in ($ids)
_all_entities:    id in ($ids)
```

`dt.entity.custom_device` and `dt.entity.container_group_instance` did not fit in the 10 expressions of
`_all_data_object`, so they are covered on events and metrics only (other data is still covered through
`dt.source_entity`).

### Lookup file path: sanitising and hashing

`lookupPath(zone)` ([segments.ts](../ui/app/segments.ts#L55)) builds a Resource Store path that follows the rules
noted in the code (characters `[a-zA-Z0-9-_./]` only, starts with `/lookups`, ends with a letter or digit):

1. **Slug:** replace every run of characters other than `A-Z`, `a-z`, `0-9` with one `_`; remove leading and
   trailing `_`; cut to 60 characters; if nothing is left, use `mz`.
2. **Hash:** `nameHash(zone)`, a 32-bit FNV-1a hash of the **full, original** zone name, as 8 lowercase hex
   digits ([segments.ts](../ui/app/segments.ts#L45)): start with `0x811c9dc5`; for each UTF-16 code unit
   (`charCodeAt`) XOR it in, then multiply by `0x01000193` (32-bit); output unsigned, zero-padded. Because it works
   on UTF-16 code units, it differs from byte-based FNV-1a for non-ASCII names.
3. **Path:** `/lookups/architect_assistant/mz/<slug>_<hash>`.

The hash makes two names that sanitise to the same slug (for example `Checkout: EU` and `Checkout EU`) write to
different files, and lets names with `:` or other characters work.

| Zone name (placeholder) | Slug | Hash | Lookup path | externalId |
| --- | --- | --- | --- | --- |
| `Production` | `Production` | `89cb4f3a` | `/lookups/architect_assistant/mz/Production_89cb4f3a` | `architect-assistant-mz-89cb4f3a` |
| `Checkout: EU` | `Checkout_EU` | `f6e2505d` | `/lookups/architect_assistant/mz/Checkout_EU_f6e2505d` | `architect-assistant-mz-f6e2505d` |
| `Team A / Linux hosts (prod)` | `Team_A_Linux_hosts_prod` | `79911f61` | `/lookups/architect_assistant/mz/Team_A_Linux_hosts_prod_79911f61` | `architect-assistant-mz-79911f61` |
| `::` | `mz` (fallback) | `980630f5` | `/lookups/architect_assistant/mz/mz_980630f5` | `architect-assistant-mz-980630f5` |
| `Ünïcode zone` | `n_code_zone` | `e40b60bd` | `/lookups/architect_assistant/mz/n_code_zone_e40b60bd` | `architect-assistant-mz-e40b60bd` |
| 80 times `a` | 60 times `a` | `5143e6d5` | `/lookups/architect_assistant/mz/aaaa…aaaa_5143e6d5` (60 `a`) | `architect-assistant-mz-5143e6d5` |

The upload uses `overwrite: true`, so converting or refreshing the same zone again replaces its file.

### externalId scheme

`externalIdFor(zone) = "architect-assistant-mz-" + nameHash(zone)` ([segments.ts](../ui/app/segments.ts#L59)).
It is set on every segment the app creates and is read back with `?add-fields=EXTERNALID` when segments are
listed. It is how the page decides:

- whether a same-name segment was **created by this app** (tile, table label, AI Assist count);
- whether *Convert* may **refresh** that segment (PUT, same UID) or must leave it alone (any same-name segment
  with another or no `externalId` is skipped, never overwritten).

The externalId depends only on the zone name. Renaming a zone produces a new hash, path and externalId; the old
segment keeps its old name and is no longer matched to the zone.

### How this differs from the MZ to Segments workflow

The header of [segments.ts](../ui/app/segments.ts#L7) describes the conversion as the same flow as the *MZ to
Segments* workflow (find the zone's entities, upload a lookup table, create a segment that reads it), with fixes.
The workflow itself is not part of this repository; the left column below is what those code comments say the
app changes.

| Aspect | MZ to Segments workflow (per the code comments) | This app |
| --- | --- | --- |
| Entity types searched | A fixed list | Every `dt.entity.*` type from `dt.system.data_objects` (Q1), so `SELECTOR`-rule targets such as extension types are included |
| Smartscape | Classic IDs only | Smartscape node IDs added through `id_classic`, so `smartscapeNodes` queries are scoped too |
| Matching by name | Entity names matched | Only frontend names of the zone's own applications (`frontend.name` on `user.events`); names are not unique |
| Lookup file path | Not sanitised; names with `:` and other characters could fail, and two names could share a file | Sanitised to the Resource Store rules and suffixed with a hash of the name |
| Refresh | Delete and recreate the segment (new UID) | Re-upload the lookup and PUT the definition with optimistic locking; the UID stays, so dashboards and notebooks that use the segment keep working; the segment is found again through its `externalId` |
| Authentication | Bearer token pasted into a script | The app's own session; no token |
| Filter payload | Same filter tree structure | Same structure (`buildFilter`) |

The app README adds that segments are entity snapshots, filter but do not restrict access, and that dimension rules
are not carried over; all of this also applies to the workflow's output.

## API calls

| Method | Endpoint or SDK method | Scope | When |
| --- | --- | --- | --- |
| GET | `settingsObjectsClient.getSettingsObjects` → `/platform/classic/environment-api/v2/settings/objects` | `settings:objects:read` | Tab load, after every conversion run (paged) |
| GET | `httpClient.send` → `/platform/storage/filter-segments/v1/filter-segments?add-fields=EXTERNALID` | `storage:filter-segments:read` | Tab load, after every conversion run |
| POST + GET | `queryExecutionClient.queryExecute` / `queryPoll` → `/platform/storage/query/v1/query:execute`, `query:poll` | `storage:system:read`, `storage:entities:read`, `storage:smartscape:read` | *Find entities*: Q1, then Q2 per chunk |
| POST | `httpClient.send` (multipart) → `/platform/storage/resource-store/v1/files/tabular/lookup:upload` | `storage:files:write` | *Convert to segments*: once per zone |
| POST | `httpClient.send` → `/platform/storage/filter-segments/v1/filter-segments` | `storage:filter-segments:write` (+ `:share` if public) | *Convert to segments*: zones without a managed segment |
| PUT | `httpClient.send` → `/platform/storage/filter-segments/v1/filter-segments/{uid}?optimistic-locking-version={version}` | `storage:filter-segments:write` (+ `:share` to make it public) | *Convert to segments*: zones with a managed segment (refresh) |
| (link) | `getIntentLink(…, "dynatrace.settings", "deprecated_open_settings_by_id")` | none | Table, **Open in Settings ↗** |
| (link) | `getAppLink("dynatrace.segments.management")` | none | Table and results, **Open Segments ↗** |
| (intent) | `sendIntent` to `dynatrace.notebooks` / `view-query` and `dynatrace.dashboards` / `add-to-dashboard` | none | Membership query actions in the preview |

**1. List management zones** (`listManagementZones`, [segments.ts](../ui/app/segments.ts#L86)). First page:
`schemaIds=builtin:management-zones&scopes=environment&fields=objectId,value&pageSize=500`; following pages pass only
`nextPageKey` until none is returned. Used fields: `items[].objectId`, `items[].value.name`,
`items[].value.rules[].type` (`ME`, `SELECTOR`, `DIMENSION`), `items[].value.rules[].enabled` (a rule counts unless
`enabled` is `false`), `nextPageKey`. Objects without a name are ignored. The result is sorted by name
(`localeCompare`). The same function also feeds the management zone value suggestions on the IAM tabs.

**2. List segments** (`listSegments`, [segments.ts](../ui/app/segments.ts#L107)). Used fields per element of
`filterSegments[]`: `uid`, `name`, `externalId`, `owner`, `version` (default 1), `isPublic`.

**3. Run DQL** (`runQuery`). Request body example:

```json
{
  "query": "fetch dt.system.data_objects\n| filter startsWith(name, \"dt.entity.\")\n| fields name\n| sort name asc",
  "requestTimeoutMilliseconds": 30000,
  "maxResultRecords": 100000,
  "maxResultBytes": 100000000
}
```

Used: `state`, `requestToken`, `result.records`.

**4. Upload the lookup** (`uploadLookup`, [segments.ts](../ui/app/segments.ts#L327)). `multipart/form-data` with two
JSON parts:

- part `request` (file name `request.json`):

```json
{
  "filePath": "/lookups/architect_assistant/mz/Checkout_EU_f6e2505d",
  "parsePattern": "JSON:payload",
  "lookupField": "key",
  "overwrite": true,
  "autoFlatten": true,
  "displayName": "Management zone Checkout: EU",
  "description": "Entity IDs of management zone \"Checkout: EU\" (Architect Assistant)."
}
```

- part `content` (file name `content.json`): the lookup object shown in the
  [full example](#full-example-segment-body) (`{ "key": <zone>, "ids": [...], "frontends": [...] }`).

`parsePattern` parses the file as one JSON object into `payload`, `autoFlatten` turns its top-level properties into
the columns `key`, `ids` and `frontends` that Q3 reads, and `lookupField` names `key` as the lookup key.
`displayName` and `description` are cut to 500 characters. Used response field: `records`. Anything other than 1
stops the zone with *Lookup upload stored N records (expected 1).*

**5. Create the segment.** Body: see [Full example segment body](#full-example-segment-body). Used response field:
`uid` (shown as *Segment UID* in the results).

**6. Refresh the segment.** Same body plus `uid` and `owner` of the existing segment; `version` from the segment list
is sent as `optimistic-locking-version`. No response body is used.

Errors of calls 4 to 6 are reported per zone. The message is taken from the error response body
(`error.message`, plus `error.details.constraintViolations[].message` joined with `; `), falling back to the
status text or the exception message.

## Remediation actions

The section works like on the other tabs: an **Action** dropdown, the form of the selected action, and a
**Documentation for this fix** row of links.

### Convert management zones to segments (API)

`MzConvertForm` ([RemediationPanel.tsx](../ui/app/RemediationPanel.tsx#L910)).

**What it fixes:** management zones without a segment. It creates one segment per selected zone that filters data
to the zone's entities as of the conversion, or refreshes a segment it created earlier.

**When it is offered:** always on this tab (it is the default action). While the zone list loads, the form shows
*Loading management zones…*.

**Form fields**

| Field | Options / behaviour |
| --- | --- |
| **Management zones** (select) | `Without a segment` (default): zones with no same-name segment. `Converted by this app (refresh)`: managed zones. `All`: every zone. Changing it clears the selection and any preview / results. |
| **Name contains** (text, placeholder `e.g. Cloud`) | Case-insensitive substring filter on the list below, applied while typing. Does not clear the selection, but only zones that are visible **and** ticked are used. |
| **Visible to everyone (public)** (checkbox, default ticked) | Sets `isPublic` on every segment created or refreshed. Changing it unticks the confirmation. |
| **Select all (N)** / **Clear** | Tick every listed zone / untick all; both clear the preview. |
| Zone list (scrollable, up to 220 px high) | One checkbox per zone. Suffixes: ` (refresh)` for managed zones, ` (segment exists, not created by this app)` for zones with a foreign same-name segment, and ` — N dimension rule(s) not convertible` for zones with enabled dimension rules. Ticking or unticking clears the preview. |
| **Find entities (N)** | N = ticked, visible zones. Disabled when N is 0 or while busy; shows *Finding entities…* while running. |

If the list is empty: *Every management zone already has a segment with the same name.* (scope *Without a segment*)
or *No management zones match.*

**Validate / preview.** There is no separate Validate button: **Find entities** is the read-only dry run. It runs
[Q1](#q1-entity-types) and [Q2](#q2-management-zone-membership-one-query-per-chunk-of-types) with the app's current
timeframe and nothing is written. A query error is shown in red under the button. The preview shows:

- `Searched <types> entity types in <n> queries (entities seen in the selected timeframe).`
- One card per selected zone (green left border, or red when skipped):
  - Title `<zone> — create`, `<zone> — refresh (same segment UID)` or `<zone> — skipped`.
  - `<n> entities + <m> Smartscape IDs: <PREFIX> <count>, …` (types sorted by count, descending).
  - For skipped zones, the reason (`planProblem`, [segments.ts](../ui/app/segments.ts#L316)), checked in this order:
    1. `Name longer than 100 characters (segment name limit).`
    2. `No entities found in this management zone for the selected timeframe.`
    3. `A segment with this name exists and was not created by this app; left unchanged.`
  - For converted zones: `Includes: _all_data_object (6), user.events (2), _all_entities (1)` (field count per
    include) and, if any, `Not filterable (10-expression limit): …` (cannot occur with the current field list).
  - For zones with dimension rules: `N dimension rule(s) is/are not entity based and not carried over.`
- **Membership queries (N)** (collapsed): Q2 per chunk with Show DQL / Copy / Open in Notebook / Add to Dashboard.
- **Request (2 API calls per zone: <n> lookups, <c> new + <u> updated segments)** (collapsed, with a Copy button):
  the requests for the **first** convertible zone only. The lookup's `ids` list is shortened to 3 IDs plus
  `… <n> more` for display (the upload sends all IDs). Example for the zone above:

```text
// 1) POST lookup:upload  filePath /lookups/architect_assistant/mz/Checkout_EU_f6e2505d
{
  "key": "Checkout: EU",
  "ids": [
    "HOST-0000000000000001",
    "HOST-0000000000000002",
    "PROCESS_GROUP_INSTANCE-0000000000000001",
    "… 6 more"
  ],
  "frontends": [
    "www.example.com"
  ]
}

// 2) POST filter-segments
{ …the segment body from "Full example segment body"… }
```

  (The second part is printed in full in the app; it reads `// 2) PUT filter-segments` for a refresh.)
- Hint: *The segment is a snapshot of entity IDs: refresh it here after topology changes. Users of the segment need
  storage:files:read to load its lookup. Segments filter data but do not restrict access.*

**Confirmation.** A checkbox *Upload <n> lookup table(s) and create <c> / update <u> segment(s)* must be ticked;
then **Convert to segments** (emphasized) is enabled. The block appears only when at least one zone is convertible.

**What runs** (`convertZones` / `convertZone`, [segments.ts](../ui/app/segments.ts#L358)): zones are processed one at
a time, two calls each, so each zone succeeds or fails on its own. Progress shows `<done> of <n> done…`.

1. Upload the lookup (POST, `overwrite: true`). On an error: *Lookup upload failed: <message>*; if the stored
   record count is not 1: *Lookup upload stored N records (expected 1).* The segment call is not made.
2. If the zone has a managed segment: PUT with the existing `uid`, `owner` and `version` → *Lookup refreshed and
   segment definition updated.* Otherwise POST → *Segment created.* On an error: *Lookup stored, segment update
   failed: <message>* or *Lookup stored, segment creation failed: <message>* (the lookup file stays).

**After the run.** One result line per zone (green or red left border): `<zone>: <message>`, the *Segment UID* when
known and, on success, **Open Segments ↗**. The confirmation is unticked and both lists are reloaded, so the tiles,
the table and the zone list update. The preview stays on screen; zones just created now show as
`refresh (same segment UID)`.

**Manual steps.** None are needed for the conversion itself. For access control and for zones with dimension
rules, see the manual action below. Nothing is deleted: management zones, other segments and earlier lookup files
are never removed by the app.

### Replace the snapshot with rule-based segments (Manual)

`ruleBasedAction` ([segments.ts](../ui/app/segments.ts#L395)), shown by `ManualActionView`. It turns a converted
snapshot into a segment that follows topology changes by itself.

Example include (with a Copy button):

```text
dt.host_group.id = "prod-checkout" OR k8s.namespace.name = "checkout"
```

Steps:

1. Open the management zone's rules and note what they key on (host group, Kubernetes namespace or cluster, tags,
   cloud account).
2. Make sure that attribute exists as a primary Grail field on the data (host group, `k8s.*`, `primary_tags.*`,
   cloud fields; see the other tabs).
3. Create a segment in the Segments app filtering on those fields (one include for all data types where possible).
4. Delete the converted snapshot segment once the rule-based one returns the same data.

Notes (collapsed):

- A converted segment is a snapshot of entity IDs; new entities are only added when it is refreshed here.
- Segments do not restrict data access. Management zone permissions must be replaced with IAM policies (for example
  on `dt.security_context`).
- Management zone DIMENSION rules (metric or log dimensions) are not entity based and cannot be converted; recreate
  them as segment filters.

### Documentation for this fix

Both actions show the same links (`SEGMENT_DOCS`): Segments, Segment limits, Segment includes, Segment visibility
and access, Lookup data in Grail (URLs in [What this page answers](#what-this-page-answers)).

## AI Assist on this page

`analyzeSegments` ([analyses.ts](../ui/app/analyses.ts#L328)) receives one entry per zone (`name`, `hasSegment`,
`managed`, `dimensionRules` = enabled `DIMENSION` rules, `rules` = enabled rules). It is rule-based and runs locally
in the browser; no AI service is called. It is computed when the panel is opened and recomputed when the zone list
changes.

**No zones.** Summary *No management zones are defined in this environment, so there is nothing to convert to
segments.*; one good insight *Data filtering can be built on segments and primary Grail fields from the start.*; one
low-impact recommendation *Define segments on primary fields (host group, Kubernetes namespace, primary tags)
instead of creating management zones.*

**Otherwise.** `p = round(100 * zones with a segment / zones)`.

- **Summary:** `<converted> of <N> management zone(s) (<p>%) has/have a segment with the same name; <managed> of
  those was/were created by this app and can be refreshed here.`
- **Insights:**

| Rule | Severity | Text |
| --- | --- | --- |
| Always | good if `p` ≥ 90, warning if ≥ 50, critical below 50 | `<p>% of management zones have a matching segment.` |
| Zones without a segment > 0 | warning | `Not converted yet: <first 5 names>, …` (`…` when more than 5) |
| Zones with dimension rules > 0 | warning | `<n> zone(s) use(s) dimension rules (metric/log dimensions), which an entity-based conversion cannot carry over: <first 3 names>.` |
| Zones with 0 enabled rules > 0 | info | `<n> zone(s) has/have no enabled rules; consider deleting instead of converting.` |
| Always | info | `Segments filter data but do not restrict access; management zone permissions need equivalent IAM policies.` |

- **Recommendations:**

| Rule | Impact | Text |
| --- | --- | --- |
| Zones without a segment > 0 | high | `Use the remediation section to convert the remaining zones; preview shows every entity type found and the exact segment definition.` |
| Managed zones > 0 | medium | `Converted segments are entity snapshots. Refresh them after topology changes, or rebuild them on primary fields so they stay current.` |
| Zones with dimension rules > 0 | medium | `Recreate dimension rules as segment filters on the metric or log fields they matched.` |
| Always | low | `Replace management zone permissions with IAM policies (for example on dt.security_context) before retiring the zones.` |

## Limitations and edge cases

- **Name match only.** A zone counts as converted when any segment has exactly its name (case-sensitive). A segment
  renamed in the Segments app no longer counts; a hand-made segment that happens to share the name counts even if
  it filters something else.
- **Visible segments only.** The segment list contains the segments the API returns to the signed-in user. Per the
  Filter Segments API, a private segment is visible only to its owner, so another user's private segment does not
  count, and *Convert* would create a second segment with the same name. How the API treats a second segment with
  the same `externalId` is not handled by the app.
- **Duplicate segment names.** The tile *Segments named after a management zone* counts every such segment; the zone
  is matched to one of them, preferring the one with this app's `externalId`.
- **Snapshot.** A converted segment holds the entity IDs found at conversion time, for entities that existed in the
  selected timeframe. New entities are not added until the zone is refreshed (scope *Converted by this app
  (refresh)*). With 7 or 30 days, entities that no longer exist are included.
- **Timeframe changes after the preview** do not re-run the membership queries; click **Find entities** again.
- **Dimension rules** are not converted. Zones whose only rules are dimension rules usually have no entities and are
  skipped with *No entities found…*.
- **Disabled rules** are ignored in the rule counts; a zone with only disabled rules shows `none`.
- **Name limits.** Names over 100 characters are skipped. The description is cut to 200 characters; the lookup
  display name and description to 500.
- **Hash collisions.** The externalId uses only the 32-bit hash. A different zone name with the same hash would only
  matter if a segment also had that other name; the lookup path also contains the slug, so a path collision needs
  the same slug and the same hash.
- **Refresh overwrites.** A PUT replaces name, description, visibility, variables and includes; edits made in the
  Segments app are lost. The `owner` is kept. If the segment changed since the tab loaded, the version no longer
  matches and the PUT fails; reload the tab and refresh again.
- **Partial failure.** If the lookup upload succeeds and the segment call fails, the lookup file remains. Running
  the conversion again overwrites it.
- **Frontend names.** `frontend.name in ($frontends)` matches any user event whose frontend has one of those names,
  including a frontend outside the zone that shares a name.
- **Loading or error and the other sections.** If the lists fail to load, the remediation header keeps saying
  *Reading management zones…* and the form *Loading management zones…*. While loading or after an error, AI Assist
  analyses an empty list and reports *No management zones are defined in this environment…*.
- **Large zones.** The code sets no limit on the number of IDs in a lookup or a segment variable; query results are
  limited to 100,000 records and 100 MB per chunk query.

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| *Could not read management zones or segments* with a 403 / permission message | The user lacks `settings:objects:read` for `builtin:management-zones` or `storage:filter-segments:read` | Grant the permissions in IAM; reopen the tab. |
| **Management zones** shows 0 although zones exist | The Settings API returns no items (not an error) when the user may not read the objects | Check the user's settings read permission for the management zone schema. |
| **Segments** count is lower than in the Segments app for another user | Private segments of other users are not returned | Expected; ask segment owners to make converted segments public if needed. |
| *Find entities* shows `Query failed.` or a permission error | Missing `storage:system:read`, `storage:entities:read` or `storage:smartscape:read`, or a query error | Copy the membership query from *Membership queries* into a notebook to see the full error. |
| Zone skipped: *No entities found in this management zone for the selected timeframe.* | The zone's rules match no entity, only dimension rules, or its entities were not seen in the timeframe | Select *Last 7 days* or *Last 30 days* in the header and click **Find entities** again; check the zone's rules in Settings. |
| Zone skipped: *A segment with this name exists and was not created by this app; left unchanged.* | A same-name segment without this app's externalId exists | Leave it, rename or delete it in the Segments app, or rebuild it with the manual action. |
| *Lookup upload failed: …* | Missing `storage:files:write`, or the Resource Store rejected the request | Check the message (constraint violations are listed); grant the permission. |
| *Lookup upload stored N records (expected 1).* | The uploaded content was not parsed as one record | Report it; the segment is not written for that zone. |
| *Lookup stored, segment creation failed: …* | Missing `storage:filter-segments:write`, or `storage:filter-segments:share` for a public segment, or a segment limit | Grant the permission, or untick *Visible to everyone (public)*; read the constraint violations. |
| *Lookup stored, segment update failed: …* | Version conflict (segment edited since load), the segment was deleted, or the user may not update it | Reopen the tab so the list (and version) reloads, then refresh again. |
| The converted segment shows no data for some users | They lack `storage:files:read`, so the variable query cannot load the lookup | Grant `storage:files:read` to the segment's users. |
| The segment misses recently added hosts or services | The segment is a snapshot | Refresh it: scope *Converted by this app (refresh)*, select it, **Find entities**, **Convert to segments**. Or build a rule-based segment. |
| No **Open Segments ↗** or **Open in Settings ↗** link | The link could not be built (app or intent not available) | Open the Segments app or Settings manually. |

## Related pages

- [Index](README.md): the app shell, timeframe, AI Assist, building blocks and all scopes.
- [SLOs](slos.md): the other classic-to-platform migration with the same "same name = converted" logic.
- [Problem notifications](problem-notifications.md): alerting profiles with management zones fall back to a label
  when converted to workflows.
- [Security context](security-context.md): `dt.security_context`, the field the manual action suggests for IAM
  policies that replace management zone permissions.
- [Host groups](host-groups.md) and [Primary tags](primary-tags.md): primary fields for rule-based segments.
- [IAM Policy Creator](iam-policy-creator.md): building IAM policies; its management zone suggestions use the same
  `listManagementZones` call.

## Source files

| File | Role on this page |
| --- | --- |
| [ui/app/tabs/SegmentsTab.tsx](../ui/app/tabs/SegmentsTab.tsx) | Tab layout, data loading and name matching (`useLoadSegmentsData`), tiles, gauge, search and table; shares the data with the remediation form through `useSegmentsData` |
| [ui/app/segments.ts](../ui/app/segments.ts) | Management zone and segment reads, `runQuery`, `findMembership`, `DATA_FIELDS`, `buildFilter`, `planSegment`, `planProblem`, lookup upload, segment POST / PUT, `nameHash`, `lookupPath`, `externalIdFor`, manual action, doc links |
| [ui/app/queries.ts](../ui/app/queries.ts#L639) | `ENTITY_TYPES_QUERY`, `mzMembershipQueries`, `segmentVariableQuery`, `dqlString` |
| [ui/app/RemediationPanel.tsx](../ui/app/RemediationPanel.tsx#L904) | `MzConvertForm` (the conversion form, preview, request, confirmation, results) and the `segments` case of `RemediationPanel` |
| [ui/app/remediation.ts](../ui/app/remediation.ts) | `DocLink` and `ManualAction` types used by the manual action |
| [ui/app/links.ts](../ui/app/links.ts) | `managementZoneSettingsLink`, `segmentsAppLink` |
| [ui/app/analyses.ts](../ui/app/analyses.ts#L328) | `analyzeSegments` (AI Assist) |
| [ui/app/components.tsx](../ui/app/components.tsx) | `PctGauge`, `ScoreTile`, `ShowEntitiesButton`, `QueryActions`, `pct` |
| [ui/app/App.tsx](../ui/app/App.tsx#L128) | Renders `SegmentsTab` with the `segments` remediation panel inside it; passes the timeframe |
| [ui/app/areas.tsx](../ui/app/areas.tsx) | Tab title, area (Migration Assistance) and the documentation link |
| [app.config.json](../app.config.json) | Scopes |
