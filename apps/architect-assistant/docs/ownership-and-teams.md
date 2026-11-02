# Ownership & Teams

The Ownership & Teams tab measures how many of the tenant's entities name an owning team, and helps you close the gaps. It scores hosts, processes and Kubernetes nodes, namespaces, deployments and pods by whether they carry an ownership key (`dt.owner`, `owner` or `team`) in their host properties, process metadata or Kubernetes labels / annotations. It scores frontends, browser monitors and HTTP monitors separately by whether they carry a classic owner tag such as `dt.owner:team-checkout`. Its Remediation actions section creates ownership teams (`builtin:ownership.teams`) for owner values already in use, creates a new team from scratch, adds owner tags to frontends and synthetic monitors through the classic tags API, and shows the manual commands that put an owner key on a host, a Kubernetes object or a process.

| | |
| --- | --- |
| Area | Metadata (see [index](README.md)) |
| Tab id | `ownership` |
| Counts toward Entity Overview readiness / Top findings | Yes. The *Ownership team* check (one row per scored entity type: hosts, processes, Kubernetes nodes, namespaces, deployments, pods) is part of Entity Overview *Overall readiness*, has its own *Ownership team* summary gauge, and competes in *Top 5 findings*, whose *Remediation steps* button opens this tab's Remediation actions. The frontend / synthetic monitor card on this tab does not count directly; only the frontends' *Owning team assigned* check counts, through *Frontend overall readiness* (see [Frontends](frontends.md)). |
| Main source files | [`ui/app/tabs/CoverageTabs.tsx`](../ui/app/tabs/CoverageTabs.tsx), [`ui/app/tabs/ClassicOwnership.tsx`](../ui/app/tabs/ClassicOwnership.tsx), [`ui/app/tabs/OwnerTagForm.tsx`](../ui/app/tabs/OwnerTagForm.tsx), [`ui/app/tabs/EntitySearch.tsx`](../ui/app/tabs/EntitySearch.tsx), [`ui/app/queries.ts`](../ui/app/queries.ts), [`ui/app/RemediationPanel.tsx`](../ui/app/RemediationPanel.tsx), [`ui/app/remediation.ts`](../ui/app/remediation.ts), [`ui/app/analyses.ts`](../ui/app/analyses.ts) |

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

- **What share of each entity type has an owner?** One gauge per entity type that can carry an ownership key: hosts, processes, Kubernetes nodes, Kubernetes namespaces, Kubernetes deployments and Kubernetes pods.
- **Which entities have no owner, and which owner does a given entity have?** The entity search lists entities that have an owner value, have a specific owner, have an owner containing a text, or have no owner at all, with the value found.
- **Do frontends and synthetic monitors have an owner?** A separate card scores frontends (classic web applications), browser monitors and HTTP monitors by classic owner tag and lists the ones without one.
- **Which owner values are in use but have no team defined?** The *Create teams for owner values in use* action compares the owner values found on entities with the identifiers of the teams in `builtin:ownership.teams` and creates the missing teams in one call.

### Best practice checked

Every monitored entity should name the team that owns it, so problems, notifications and security findings can be routed to that team. In Dynatrace, ownership is a key / value pair on the entity: the key is an *ownership key* and the value is the identifier of a team defined in the *Ownership teams* settings (`builtin:ownership.teams`). The code comments in [`queries.ts`](../ui/app/queries.ts#L43-L54) state that the keys come from the tenant's `builtin:ownership.config` and that the app uses its default keys `dt.owner`, `owner` and `team`. Where the key lives depends on the entity:

| Entity | Where the owner key is set | Field the app reads |
| --- | --- | --- |
| Host | OneAgent host property (`oneagentctl --set-host-property`) | `host.custom.metadata[<key>]` |
| Process | Process environment variable `DT_CUSTOM_PROP` | `custom_metadata[<key>]` |
| Kubernetes node, namespace, deployment, pod | Kubernetes label or annotation | `` `tags:k8s.labels`[<key>] ``, `` `tags:k8s.annotations`[<key>] `` |
| Frontend, browser monitor, HTTP monitor (classic entities) | Classic tag `<key>:<team identifier>` | `tags` on `dt.entity.application`, `dt.entity.synthetic_test`, `dt.entity.http_check` |

Services, containers and Kubernetes clusters are **not scored**. In the code's words ([`queries.ts` L52-L54](../ui/app/queries.ts#L52-L54) and the tab text): "Services, containers and clusters carry no label or property map, so they are not scored." They have none of the four maps above in Smartscape, so no ownership key can be read from them and a gauge would always show 0%. The shared coverage query still computes an `owner` column for them, but [`fieldApplies`](../ui/app/queries.ts#L69-L70) removes those rows before anything is displayed.

Dynatrace documentation cited by the code:

- [Assign ownership teams to Smartscape nodes](https://docs.dynatrace.com/docs/deliver/ownership/assign-team-ownership)
- [Assign ownership teams to monitored entities](https://docs.dynatrace.com/docs/deliver/ownership/ownership-classic/assign-ownership)
- [Best practices for entity ownership](https://docs.dynatrace.com/docs/deliver/ownership/best-practices)

## Before you start

### App scopes used by this page

All scopes are declared in [`app.config.json`](../app.config.json).

| Scope | What this page uses it for |
| --- | --- |
| `storage:smartscape:read` | The shared coverage query, the entity search and the owner values query read Smartscape nodes (`smartscapeNodes`). |
| `storage:entities:read` | The frontend / synthetic monitor queries read the classic entity tables `dt.entity.application`, `dt.entity.synthetic_test` and `dt.entity.http_check`. |
| `settings:objects:read` | Reads the existing teams (`builtin:ownership.teams`) for the team picker, the duplicate-identifier check and the missing-teams comparison. |
| `settings:objects:write` | Creates teams (`builtin:ownership.teams`, environment scope), including the validate-only dry run. |
| `environment-api:entities:write` | Adds owner tags to frontends and synthetic monitors (`POST /api/v2/tags`). |

The intents used by *Open in Notebook*, *Add to Dashboard* and the entity links need no scope.

### User permissions

AppEngine calls run with the signed-in user's own permissions, limited to the app's scopes. The user therefore needs the same permissions through an IAM policy:

- To see the page: `storage:smartscape:read` and `storage:entities:read` (plus read access to the Grail data they cover).
- For the team list: `settings:objects:read` on `builtin:ownership.teams`. Without it the team picker falls back to a free-text identifier and the missing-teams comparison cannot see existing teams.
- To create teams: `settings:objects:write` on `builtin:ownership.teams`, for example `ALLOW settings:objects:write WHERE settings:schemaId = "builtin:ownership.teams";`.
- To add owner tags: `environment-api:entities:write`.

### One-time setup

None. The page uses no credential vault entries, outbound connections or OAuth clients. For ownership to resolve in Dynatrace, every owner value must match the identifier (or a supplementary identifier) of a team in `builtin:ownership.teams`; the Remediation actions section can create those teams.

## Page walkthrough

The tab is assembled in [`App.tsx` L109-L118](../ui/app/App.tsx#L109-L118): `FieldCoverageTab` with `OWNER_FOCUS`, then `ClassicOwnershipSection`, then `RemediationPanel tab="ownership"`. Only the selected tab is mounted, so leaving the tab discards its local state (search results, form input).

### Documentation link

Right-aligned above the content: *Ownership & Teams documentation*, which opens this page on GitHub ([`areas.tsx`](../ui/app/areas.tsx#L86-L94)).

### AI Insights panel

Shown at the top of the tab only while the header's **AI Assist** toggle is on. See [AI Assist on this page](#ai-assist-on-this-page).

### Heading and explanation

Heading **Ownership and teams** and the text from `OWNER_FOCUS.blurb` ([`CoverageTabs.tsx` L350-L356](../ui/app/tabs/CoverageTabs.tsx#L350-L356)):

> Ownership is a key/value (dt.owner, owner or team) on hosts, processes and Kubernetes objects whose value matches a team identifier. Services, containers and clusters carry no label or property map, so they are not scored.

### Ownership gauges per entity type

One card (`TypeGaugeGrid`, no title, because the focus has a single field) with one gauge per entity type, in this order: **Hosts**, **Processes**, **Kubernetes nodes**, **Kubernetes namespaces**, **Kubernetes deployments**, **Kubernetes pods**.

- **Data:** the `owner` and `total` columns of the shared [coverage query](#q1-coveragequery), row `type` = the entity type.
- **Numerator:** entities of that type with a non-null ownership value (`owner` column). See [Checks and scoring](#checks-and-scoring) for exactly which keys and fields count.
- **Denominator:** all entities of that type seen in the selected timeframe (`total` column).
- **Percentage:** `Math.round(part / total * 100)`, an integer.
- **Caption:** the entity type title. **Detail line:** `<part> of <total>` with locale thousands separators.
- **Colour:** the custom SVG gauge (`PctGauge`) fills a 240-degree arc with a continuous red (0%) to yellow to green (100%) gradient up to the value.
- **Which gauges appear:** a type is shown only if it applies to ownership (`OWNER_TYPES`) and the query returned at least one entity of that type. Types with 0 entities in the timeframe are hidden.
- **No (i) buttons** here (the (i) buttons that jump to this tab's remediation are on the Entity Overview gauges).
- **Loading:** `Loading…`. **Error:** a red *Query failed* message with the error text. **Empty:** `No entities found for this timeframe.`

Whether the owner value matches an existing team is **not** checked by the gauges: any non-null value counts.

### Coverage query actions

A row of buttons under the gauges (`QueryActions`, title *Ownership and teams coverage*):

| Button | What it does |
| --- | --- |
| Show DQL / Hide DQL | Toggles the full text of the shared coverage query. |
| Copy | Copies the query to the clipboard (label changes to *Copied* for 1.5 s). |
| Open in Notebook | `sendIntent({ "dt.query": <query>, title }, { recommendedAppId: "dynatrace.notebooks", recommendedIntentId: "view-query" })`. |
| Add to Dashboard | `sendIntent({ "dt.query": <query>, title }, { recommendedAppId: "dynatrace.dashboards", recommendedIntentId: "add-to-dashboard" })`. |

The query exposed is the whole shared coverage query, so it also returns the security context, cost and host group columns; the ownership result is the `owner` column.

### Search entities by owning team

An entity search ([`EntitySearch.tsx`](../ui/app/tabs/EntitySearch.tsx)) over the six ownership types. Nothing runs until you click **Search entities**. Changing any control clears the current result.

| Control | Options | Effect on the query |
| --- | --- | --- |
| Entity type | *All applicable types* (default), Hosts, Processes, Kubernetes nodes, Kubernetes namespaces, Kubernetes deployments, Kubernetes pods | `smartscapeNodes` lists all six types, or only the one picked. |
| Match | *Has a value* (default) | `\| filter isNotNull(<owner expression>)` |
| | *Equals* (shows **Value**) | `\| filter toString(<owner expression>) == "<value>"` (exact, case-sensitive) |
| | *Contains* (shows **Value**) | `\| filter contains(toString(<owner expression>), "<value>", caseSensitive:false)` |
| | *Is missing* | `\| filter isNull(<owner expression>)` |
| Value | Free text (only for Equals / Contains); trimmed | Inserted as a DQL string literal; `\` and `"` are escaped. |
| Name contains (optional) | Free text, placeholder `e.g. prod-`; trimmed | Adds `contains(name, "<text>", caseSensitive:false) and ` before the match condition. |

There is no *Property* selector, because the tab searches a single property (*Ownership team*). If *Equals* or *Contains* is picked with an empty value, the button does nothing.

**Result table** (`DrillDownTable`, title *Ownership team search*): the same Show DQL / Copy / Open in Notebook / Add to Dashboard buttons for the search query, then a sortable, condensed table:

| Column | Source | Meaning |
| --- | --- | --- |
| Name | `name` | Entity name. |
| Type | `type` | Smartscape type (`HOST`, `PROCESS`, `K8S_POD`, ...). |
| Entity ID | `id` | Smartscape node ID. |
| Ownership team | `value` = `toString(<owner expression>)` | The first owner value found (see the order under [Checks and scoring](#checks-and-scoring)); empty for entities without one. |
| Overview | built from `type` and `id` | *Open overview ↗* link to the entity's page: hosts open Infrastructure & Operations (`dynatrace.infraops` / `view_host`, `meId`), processes `view_smartscape_process` (`nodeId`), Kubernetes objects the Kubernetes app (`view-entity-dt.smartscape.k8s_<type>`, `nodeId`). `—` when no link can be built. No timeframe is passed, so the target app opens on its default timeframe. |

Rows are sorted by name and limited to 500; at 500 rows the table shows *Showing the first 500 entities.* Empty result: *No entities match this search.*

### Frontends and synthetic monitors

A card ([`ClassicOwnership.tsx` L33-L97](../ui/app/tabs/ClassicOwnership.tsx#L33-L97)) with the text *Classic entities carry ownership as a tag such as dt.owner:team-checkout. Shown separately because they have no label or property map like the entities above.*

- **Gauges:** one per classic type that has at least one entity in the timeframe: **Frontends** (`dt.entity.application`), **Browser monitors** (`dt.entity.synthetic_test`), **HTTP monitors** (`dt.entity.http_check`). Value = `Math.round(owned / total * 100)`; detail line *`<owned>` of `<total>` have an owner*. Data: [`classicOwnershipQuery`](#q3-classicownershipquery), which runs when the tab opens.
- **Empty:** *No frontends or synthetic monitors found in this timeframe.* **Loading / error:** as for the gauges above.
- **Query actions:** Show DQL / Copy / Open in Notebook / Add to Dashboard for *Ownership of frontends and synthetic monitors*.
- **Show frontends and monitors without an owner:** opens a table ([`classicUnownedQuery`](#q4-classicunownedquery), run on click) titled *Frontends and synthetic monitors without an owner*, with its own query actions:

| Column | Source | Meaning |
| --- | --- | --- |
| Name | `name` (`entity.name`), falls back to `id` | Link to the entity: frontends open Experience Vitals (`dynatrace.experience.vitals` / `view-frontend`), browser monitors and HTTP monitors open the Synthetic app (`dynatrace.synthetic` / `view_browser_monitor`, `view_http_monitor`). Plain text if no link can be built. |
| Type | `type` | *Frontends*, *Browser monitors* or *HTTP monitors*. |
| ID | `id` | Classic entity ID (`APPLICATION-…`, `SYNTHETIC_TEST-…`, `HTTP_CHECK-…`). |

  Sorted by type, then name, limited to 500 rows. Empty: *Every frontend and synthetic monitor has an owner.*

### Remediation actions

The section at the bottom of the tab. See [Remediation actions](#remediation-actions).

## Checks and scoring

### Which owner keys and fields count

For Smartscape entities the owner is the first non-null value of these twelve expressions, in this order ([`OWNER_EXPR`](../ui/app/queries.ts#L46-L51)):

| # | Key | Field | Typical entity |
| --- | --- | --- | --- |
| 1 | `dt.owner` | `host.custom.metadata` (host properties) | Host |
| 2 | `dt.owner` | `custom_metadata` (process metadata, `DT_CUSTOM_PROP`) | Process |
| 3 | `dt.owner` | `` `tags:k8s.labels` `` | Kubernetes objects |
| 4 | `dt.owner` | `` `tags:k8s.annotations` `` | Kubernetes objects |
| 5-8 | `owner` | same four fields, same order | |
| 9-12 | `team` | same four fields, same order | |

So `dt.owner` wins over `owner`, which wins over `team`; for the same key, a host property wins over process metadata, which wins over a Kubernetes label, which wins over an annotation. The match is on the exact key name: keys such as `owner-1`, `dt.owner-2` or `Owner` do not count.

For frontends and synthetic monitors the owner is taken from the classic `tags` array: the first tag (in array order) whose text starts with `dt.owner:`, `owner:` or `team:` (case-sensitive), and the value is everything after the first `:`.

### Check table

| Check | In place when | Numerator | Denominator | Severity / thresholds | Notes |
| --- | --- | --- | --- | --- | --- |
| Ownership team, per type: Hosts, Processes, Kubernetes nodes, Kubernetes namespaces, Kubernetes deployments, Kubernetes pods | `isNotNull(<owner expression>)` | `owner = countIf(...)` per `type` | `total = count()` per `type` | Gauge colour is a continuous red-to-green gradient. AI Assist: ≥ 90% good, ≥ 50% warning, < 50% critical. | Value is not checked against existing teams. Types with 0 entities are hidden. |
| Services, containers, Kubernetes clusters | Not scored | | | | No property / label map in Smartscape. |
| Frontends / Browser monitors / HTTP monitors owned | A tag starting with `dt.owner:`, `owner:` or `team:` exists | `owned = countIf(isNotNull(owner))` per type | `total = count()` per type | Same gauge colours. | Not part of Entity Overview readiness (frontends count through the Frontends tab's *Owning team assigned* check). |
| Remediation impact line | | sum over the six types of `total - owner` | | | Text: *`<n>` entities without an owning team.* Frontends and monitors are not included. |
| Owner value without a team (*Create teams for owner values in use*) | The owner value equals a team `identifier` or one of its `supplementaryIdentifiers` (exact, case-sensitive) | | | | Only the first 200 owner values and the first 500 teams are compared. |
| Owner tag value (*Assign owner…* Validate) | Value non-empty, ≤ 100 characters | | | Error blocks the write; a value that is not an existing team identifier gives a warning only. | |

### Effect on the Entity Overview

The six *Ownership team* rows are rows of the shared coverage matrix ([`CoverageTabs.tsx`](../ui/app/tabs/CoverageTabs.tsx)):

- **Overall readiness** is the rounded mean of the percentages of every (entity type × field) row, plus one row for frontend readiness. Each ownership type with entities is one of those rows.
- **Ownership team** summary gauge: rounded mean of the ownership rows' percentages, *avg of N checks*. Its (i) button opens this tab's Remediation actions.
- **Top 5 findings:** ownership rows below 100% compete with every other check, ranked by entity importance (hosts first, then Kubernetes nodes, clusters, frontends, containers, Kubernetes namespaces / deployments / pods, then processes and services) and then by `(100 - pct) × log10(total + 10)`, at most 2 findings per entity type. Texts: *None of the `<n>` hosts have an ownership team.* or *Only `<pct>`% of hosts have an ownership team (`<part>` of `<total>`).* The button *Remediation steps →* opens this tab and scrolls to Remediation actions.

## Queries

| # | Name (function in source) | Runs when | Feeds |
| --- | --- | --- | --- |
| Q1 | [`coverageQuery`](#q1-coveragequery) | App start and every timeframe change (shared; opening this tab does not re-run it) | Ownership gauges, remediation impact line, Entity Overview |
| Q2 | [`entitySearchQuery`](#q2-entitysearchquery) | Click **Search entities** | Search result table |
| Q3 | [`classicOwnershipQuery`](#q3-classicownershipquery) | Tab opens; timeframe change | Frontends and synthetic monitors gauges |
| Q4 | [`classicUnownedQuery`](#q4-classicunownedquery) | Click **Show frontends and monitors without an owner** | Table of classic entities without an owner |
| Q5 | [`ownerValuesQuery`](#q5-ownervaluesquery) | Click **Find missing teams** in the *Create teams for owner values in use* action | Missing-teams list |
| Q6 | [`classicOwnerEntitiesQuery`](#q6-classicownerentitiesquery) | The *Assign owner to frontends and synthetic monitors (tags)* action is selected; again after each successful assignment | Owner-tag form entity list |

All queries carry an explicit `from:now()-<timeframe>`. With the default 24 hours it is `from:now()-24h`; the timeframe select changes it to `from:now()-7d` or `from:now()-30d`. Longer windows also count entities that existed earlier in the window, including decommissioned ones.

### Q1 coverageQuery

- **Source:** `coverageQuery` in [`queries.ts` L77-L84](../ui/app/queries.ts#L77-L84); run by `useDql` in [`App.tsx` L52](../ui/app/App.tsx#L52); rows built by `toCoverageRows` in [`CoverageTabs.tsx` L42-L58](../ui/app/tabs/CoverageTabs.tsx#L42-L58).
- **Runs:** once at app start for the whole app and again whenever the timeframe changes. Entity Overview, Security context, Cost allocation, Host groups remediation and this tab share the result.
- **Parameters:** the timeframe only.
- **Query (24 h):**

```dql
smartscapeNodes "HOST", "PROCESS", "SERVICE", "CONTAINER", "K8S_CLUSTER", "K8S_NODE", "K8S_NAMESPACE", "K8S_DEPLOYMENT", "K8S_POD", from:now()-24h
| summarize total = count(),
    security = countIf(arraySize(dt.security_context) > 0),
    costcenter = countIf(isNotNull(dt.cost.costcenter)),
    product = countIf(isNotNull(dt.cost.product)),
    hostgroup = countIf(isNotNull(dt.host_group.id)),
    owner = countIf(isNotNull(coalesce(host.custom.metadata[`dt.owner`], custom_metadata[`dt.owner`], `tags:k8s.labels`[`dt.owner`], `tags:k8s.annotations`[`dt.owner`], host.custom.metadata[`owner`], custom_metadata[`owner`], `tags:k8s.labels`[`owner`], `tags:k8s.annotations`[`owner`], host.custom.metadata[`team`], custom_metadata[`team`], `tags:k8s.labels`[`team`], `tags:k8s.annotations`[`team`]))),
    by:{type}
```

- **How it works:**
  1. `smartscapeNodes "HOST", …, from:now()-24h` reads the Smartscape nodes of the nine entity types of the coverage matrix that existed in the window. Smartscape is used instead of scanning logs, events or metrics because it is cheap and carries the primary Grail fields on each entity ([`queries.ts` header](../ui/app/queries.ts#L1-L4)).
  2. `summarize … by:{type}` produces one row per entity type. `total = count()` counts the nodes; each `countIf(...)` counts the nodes where a best practice is in place.
  3. The `owner` column is the ownership check. `host.custom.metadata[`` `dt.owner` ``]` reads the key `dt.owner` from the record of host properties (the backticks are needed because the key contains a dot); `custom_metadata[...]` reads process metadata; `` `tags:k8s.labels`[...] `` and `` `tags:k8s.annotations`[...] `` read Kubernetes labels and annotations (the field names are backtick-quoted because they contain a colon). `coalesce(...)` returns the first non-null of the twelve, and `isNotNull(...)` turns it into the in-place condition.
  4. The other four columns feed the Security context, Cost allocation and Host groups tabs.
- **Output:** one record per `type` with `total`, `security`, `costcenter`, `product`, `hostgroup`, `owner`. This tab uses `type`, `total` and `owner`. `toCoverageRows` drops types with `total = 0`, and for the `owner` field keeps only `HOST`, `PROCESS`, `K8S_NODE`, `K8S_NAMESPACE`, `K8S_DEPLOYMENT`, `K8S_POD` (`fieldApplies`), so the `owner` values computed for services, containers and clusters are discarded.
- **Limits and cost:** no `limit`; one row per type. A single Smartscape scan for all checks of the app.
- **Open it yourself:** yes, via *Ownership and teams coverage* (Show DQL / Copy / Open in Notebook / Add to Dashboard).

### Q2 entitySearchQuery

- **Source:** `entitySearchQuery` in [`queries.ts` L158-L172](../ui/app/queries.ts#L158-L172), called from [`EntitySearch.tsx` L131-L137](../ui/app/tabs/EntitySearch.tsx#L131-L137). The field passed by `FieldCoverageTab` is `{ key: "owner", label: "Ownership team", expr: <owner expression>, array: false }`.
- **Runs:** only on **Search entities**; again on the next click after a control change. Not re-run automatically on timeframe change (the next search uses the new timeframe).
- **Parameters:** entity types (all six or one), match mode, value, name text, timeframe.
- **Query (24 h, all types, *Has a value*, no name filter):**

```dql
smartscapeNodes "HOST", "PROCESS", "K8S_NODE", "K8S_NAMESPACE", "K8S_DEPLOYMENT", "K8S_POD", from:now()-24h
| filter isNotNull(coalesce(host.custom.metadata[`dt.owner`], custom_metadata[`dt.owner`], `tags:k8s.labels`[`dt.owner`], `tags:k8s.annotations`[`dt.owner`], host.custom.metadata[`owner`], custom_metadata[`owner`], `tags:k8s.labels`[`owner`], `tags:k8s.annotations`[`owner`], host.custom.metadata[`team`], custom_metadata[`team`], `tags:k8s.labels`[`team`], `tags:k8s.annotations`[`team`]))
| fieldsAdd value = toString(coalesce(host.custom.metadata[`dt.owner`], custom_metadata[`dt.owner`], `tags:k8s.labels`[`dt.owner`], `tags:k8s.annotations`[`dt.owner`], host.custom.metadata[`owner`], custom_metadata[`owner`], `tags:k8s.labels`[`owner`], `tags:k8s.annotations`[`owner`], host.custom.metadata[`team`], custom_metadata[`team`], `tags:k8s.labels`[`team`], `tags:k8s.annotations`[`team`]))
| fields id, name, type, value
| sort name asc
| limit 500
```

  *Is missing* replaces the filter line with:

```dql
| filter isNull(coalesce(host.custom.metadata[`dt.owner`], custom_metadata[`dt.owner`], `tags:k8s.labels`[`dt.owner`], `tags:k8s.annotations`[`dt.owner`], host.custom.metadata[`owner`], custom_metadata[`owner`], `tags:k8s.labels`[`owner`], `tags:k8s.annotations`[`owner`], host.custom.metadata[`team`], custom_metadata[`team`], `tags:k8s.labels`[`team`], `tags:k8s.annotations`[`team`]))
```

  *Equals* `team-checkout` with *Entity type* = Hosts:

```dql
smartscapeNodes "HOST", from:now()-24h
| filter toString(coalesce(host.custom.metadata[`dt.owner`], custom_metadata[`dt.owner`], `tags:k8s.labels`[`dt.owner`], `tags:k8s.annotations`[`dt.owner`], host.custom.metadata[`owner`], custom_metadata[`owner`], `tags:k8s.labels`[`owner`], `tags:k8s.annotations`[`owner`], host.custom.metadata[`team`], custom_metadata[`team`], `tags:k8s.labels`[`team`], `tags:k8s.annotations`[`team`])) == "team-checkout"
| fieldsAdd value = toString(coalesce(host.custom.metadata[`dt.owner`], custom_metadata[`dt.owner`], `tags:k8s.labels`[`dt.owner`], `tags:k8s.annotations`[`dt.owner`], host.custom.metadata[`owner`], custom_metadata[`owner`], `tags:k8s.labels`[`owner`], `tags:k8s.annotations`[`owner`], host.custom.metadata[`team`], custom_metadata[`team`], `tags:k8s.labels`[`team`], `tags:k8s.annotations`[`team`]))
| fields id, name, type, value
| sort name asc
| limit 500
```

  *Contains* `checkout` with *Name contains* `prod-`:

```dql
smartscapeNodes "HOST", "PROCESS", "K8S_NODE", "K8S_NAMESPACE", "K8S_DEPLOYMENT", "K8S_POD", from:now()-24h
| filter contains(name, "prod-", caseSensitive:false) and contains(toString(coalesce(host.custom.metadata[`dt.owner`], custom_metadata[`dt.owner`], `tags:k8s.labels`[`dt.owner`], `tags:k8s.annotations`[`dt.owner`], host.custom.metadata[`owner`], custom_metadata[`owner`], `tags:k8s.labels`[`owner`], `tags:k8s.annotations`[`owner`], host.custom.metadata[`team`], custom_metadata[`team`], `tags:k8s.labels`[`team`], `tags:k8s.annotations`[`team`])), "checkout", caseSensitive:false)
| fieldsAdd value = toString(coalesce(host.custom.metadata[`dt.owner`], custom_metadata[`dt.owner`], `tags:k8s.labels`[`dt.owner`], `tags:k8s.annotations`[`dt.owner`], host.custom.metadata[`owner`], custom_metadata[`owner`], `tags:k8s.labels`[`owner`], `tags:k8s.annotations`[`owner`], host.custom.metadata[`team`], custom_metadata[`team`], `tags:k8s.labels`[`team`], `tags:k8s.annotations`[`team`]))
| fields id, name, type, value
| sort name asc
| limit 500
```

- **How it works:**
  1. `smartscapeNodes` with the selected types and timeframe.
  2. `filter` combines the optional name condition (`contains(name, …, caseSensitive:false)`) and the match condition with `and`. `toString(...)` makes the comparison work whatever the stored value type is.
  3. `fieldsAdd value = toString(<owner expression>)` adds the owner value found, for the result column.
  4. `fields id, name, type, value` keeps only the table columns; `sort name asc`; `limit 500`.
- **Output:** `id`, `name`, `type`, `value` → columns Entity ID, Name, Type, Ownership team; `type` + `id` build the Overview link.
- **Limits and cost:** 500 rows. One Smartscape scan.
- **Open it yourself:** yes, the result table has its own Show DQL / Copy / Open in Notebook / Add to Dashboard (title *Ownership team search*).

### Q3 classicOwnershipQuery

- **Source:** `classicOwnershipQuery` in [`queries.ts` L732-L734](../ui/app/queries.ts#L732-L734), built from `classicOwnerFetch` and `classicOwnerFields` ([L692-L695](../ui/app/queries.ts#L692-L695), [L728-L729](../ui/app/queries.ts#L728-L729)); run in [`ClassicOwnership.tsx` L34-L35](../ui/app/tabs/ClassicOwnership.tsx#L34-L35).
- **Runs:** when the tab opens; re-runs on timeframe change.
- **Parameters:** the timeframe (appears three times).
- **Query (24 h):**

```dql
fetch dt.entity.application, from:now()-24h | fieldsAdd type = "FRONTEND"
| append [fetch dt.entity.synthetic_test, from:now()-24h | fieldsAdd type = "BROWSER_MONITOR"]
| append [fetch dt.entity.http_check, from:now()-24h | fieldsAdd type = "HTTP_MONITOR"]
| fieldsAdd ownerTags = if(startsWith(tags[], "dt.owner:") or startsWith(tags[], "owner:") or startsWith(tags[], "team:"), tags[])
| fieldsAdd ownerTags = arrayRemoveNulls(ownerTags)
| fieldsAdd owner = if(arraySize(ownerTags) > 0, substring(ownerTags[0], from: indexOf(ownerTags[0], ":") + 1))
| summarize total = count(), owned = countIf(isNotNull(owner)), by:{type}
```

- **How it works:**
  1. `fetch dt.entity.application` reads classic web applications (frontends) that existed in the window and labels them `type = "FRONTEND"`.
  2. Two `append [...]` subqueries add browser monitors (`dt.entity.synthetic_test`, `BROWSER_MONITOR`) and HTTP monitors (`dt.entity.http_check`, `HTTP_MONITOR`).
  3. `if(startsWith(tags[], "dt.owner:") or …, tags[])` is an iterative array expression: `tags[]` walks every element of the `tags` array, and the result is an array of the same length holding each owner tag and `null` for every other tag.
  4. `arrayRemoveNulls(ownerTags)` keeps only the owner tags.
  5. `owner` is the text after the first `:` of the first owner tag (`indexOf` finds the colon, `substring(…, from: …)` cuts after it). Entities without tags, or without an owner tag, get `owner = null`.
  6. `summarize total = count(), owned = countIf(isNotNull(owner)), by:{type}` gives one row per classic type.
- **Output:** `type`, `total`, `owned` → one gauge per type with `total > 0` (`owned / total`).
- **Limits and cost:** no limit; scans the three classic entity tables.
- **Open it yourself:** yes, *Ownership of frontends and synthetic monitors*.

### Q4 classicUnownedQuery

- **Source:** `classicUnownedQuery` in [`queries.ts` L744-L749](../ui/app/queries.ts#L744-L749); rendered by `DrillDownTable` in [`ClassicOwnership.tsx` L70-L92](../ui/app/tabs/ClassicOwnership.tsx#L70-L92).
- **Runs:** when **Show frontends and monitors without an owner** is clicked; re-runs on timeframe change while open.
- **Parameters:** the timeframe.
- **Query (24 h):**

```dql
fetch dt.entity.application, from:now()-24h | fieldsAdd type = "FRONTEND"
| append [fetch dt.entity.synthetic_test, from:now()-24h | fieldsAdd type = "BROWSER_MONITOR"]
| append [fetch dt.entity.http_check, from:now()-24h | fieldsAdd type = "HTTP_MONITOR"]
| fieldsAdd ownerTags = if(startsWith(tags[], "dt.owner:") or startsWith(tags[], "owner:") or startsWith(tags[], "team:"), tags[])
| fieldsAdd ownerTags = arrayRemoveNulls(ownerTags)
| fieldsAdd owner = if(arraySize(ownerTags) > 0, substring(ownerTags[0], from: indexOf(ownerTags[0], ":") + 1))
| filter isNull(owner)
| fields id, name = entity.name, type
| sort type asc, name asc
| limit 500
```

- **How it works:** the same owner extraction as Q3, then `filter isNull(owner)` keeps entities without an owner tag, `fields` renames `entity.name` to `name`, sorts by type and name, and caps at 500 rows.
- **Output:** `id`, `name`, `type` → columns Name (linked), Type, ID.
- **Limits and cost:** 500 rows (the table says so when the limit is reached).
- **Open it yourself:** yes, the table's own query actions (*Frontends and synthetic monitors without an owner*).

### Q5 ownerValuesQuery

- **Source:** `ownerValuesQuery` in [`queries.ts` L682-L687](../ui/app/queries.ts#L682-L687); run by `MissingTeamsData` in [`RemediationPanel.tsx` L818-L830](../ui/app/RemediationPanel.tsx#L818-L830).
- **Runs:** after **Find missing teams** in the *Create teams for owner values in use* action; re-runs on timeframe change while open.
- **Parameters:** the timeframe.
- **Query (24 h):**

```dql
smartscapeNodes "HOST", "PROCESS", "K8S_NAMESPACE", "K8S_NODE", "K8S_DEPLOYMENT", "K8S_POD", from:now()-24h
| fieldsAdd ownerValue = toString(coalesce(host.custom.metadata[`dt.owner`], custom_metadata[`dt.owner`], `tags:k8s.labels`[`dt.owner`], `tags:k8s.annotations`[`dt.owner`], host.custom.metadata[`owner`], custom_metadata[`owner`], `tags:k8s.labels`[`owner`], `tags:k8s.annotations`[`owner`], host.custom.metadata[`team`], custom_metadata[`team`], `tags:k8s.labels`[`team`], `tags:k8s.annotations`[`team`]))
| filter isNotNull(ownerValue)
| summarize entities = count(), by:{ownerValue}
| sort entities desc
| limit 200
```

- **How it works:**
  1. `smartscapeNodes` over the six ownership types (`OWNER_TYPES` order).
  2. `ownerValue` is the first owner value of the entity, as a string.
  3. `filter isNotNull(ownerValue)` drops entities without an owner.
  4. `summarize entities = count(), by:{ownerValue}` counts entities per distinct owner value; `sort entities desc` and `limit 200` keep the 200 most used values.
- **Client-side post-processing:** the app reads the existing teams (see [API calls](#api-calls)), builds the set of every team `identifier` plus every `supplementaryIdentifiers[].supplementaryIdentifier`, and keeps the owner values that are not in that set (exact, case-sensitive string comparison). Values that do not match the team identifier pattern `^[A-Za-z0-9]([A-Za-z0-9_-]{0,98}[A-Za-z0-9])?$` are listed but cannot be selected.
- **Output:** `ownerValue`, `entities` → one checkbox per missing value: *`<value>` — `<n>` entities*.
- **Limits and cost:** 200 values.
- **Open it yourself:** yes, *Ownership values in use* (query actions under the list).

### Q6 classicOwnerEntitiesQuery

- **Source:** `classicOwnerEntitiesQuery` in [`queries.ts` L737-L741](../ui/app/queries.ts#L737-L741); run by `ClassicOwnerTagLoader` in [`ClassicOwnership.tsx` L100-L126](../ui/app/tabs/ClassicOwnership.tsx#L100-L126) with `refreshMarker(version)` appended.
- **Runs:** when the *Assign owner to frontends and synthetic monitors (tags)* action is selected; after each successful *Assign owner* the version counter increases, which appends a DQL comment (`// refresh 1`, `// refresh 2`, …) so the text changes and the query runs again. DQL ignores the comment. The previous rows stay on screen while the refresh runs.
- **Parameters:** the timeframe; the refresh counter.
- **Query (24 h, first load):**

```dql
fetch dt.entity.application, from:now()-24h | fieldsAdd type = "FRONTEND"
| append [fetch dt.entity.synthetic_test, from:now()-24h | fieldsAdd type = "BROWSER_MONITOR"]
| append [fetch dt.entity.http_check, from:now()-24h | fieldsAdd type = "HTTP_MONITOR"]
| fieldsAdd ownerTags = if(startsWith(tags[], "dt.owner:") or startsWith(tags[], "owner:") or startsWith(tags[], "team:"), tags[])
| fieldsAdd ownerTags = arrayRemoveNulls(ownerTags)
| fieldsAdd owner = if(arraySize(ownerTags) > 0, substring(ownerTags[0], from: indexOf(ownerTags[0], ":") + 1))
| fields id, name = entity.name, type, owner
| sort type asc, name asc
| limit 2000
```

  After the first successful assignment, the same text followed by a last line `// refresh 1`.
- **How it works:** the same owner extraction as Q3, then every entity (owned or not) with its owner, sorted by type and name, capped at 2,000.
- **Output:** `id`, `name`, `type`, `owner` → the entity checkbox list of the owner-tag form (name, type label, *owner: `<value>`* or *no owner*). Entities with `owner = null` are preselected.
- **Limits and cost:** 2,000 entities.
- **Open it yourself:** yes, *Frontends and synthetic monitors with owner* under the form. The exposed text is the query without the refresh comment.

## API calls

| Method | Endpoint or SDK method | Scope | When |
| --- | --- | --- | --- |
| POST | `/platform/storage/query/v1/query:execute` + `query:poll` (`useDql` from `@dynatrace-sdk/react-hooks`) | `storage:smartscape:read`, `storage:entities:read` | Every query above |
| GET | `/platform/classic/environment-api/v2/settings/objects` (`settingsObjectsClient.getSettingsObjects`) | `settings:objects:read` | Each time one of the three API action forms is shown; again after teams are created |
| POST | `/platform/classic/environment-api/v2/settings/objects?validateOnly=true\|false` (`settingsObjectsClient.postSettingsObjects`) | `settings:objects:write` | **Validate** / **Create teams** / **Create team** |
| POST | `/platform/classic/environment-api/v2/tags?entitySelector=…&from=now-30d` (`monitoredEntitiesCustomTagsClient.postTags`) | `environment-api:entities:write` | **Assign owner**, one call per selector |
| Intent | `dynatrace.notebooks` / `view-query`, `dynatrace.dashboards` / `add-to-dashboard` (`sendIntent`) | none | Open in Notebook / Add to Dashboard |
| Link | `getIntentLink` to `dynatrace.infraops`, `dynatrace.kubernetes`, `dynatrace.experience.vitals`, `dynatrace.synthetic` | none | Overview and Name links in tables |

### Read existing teams

- **Function:** `listTeams` in [`remediation.ts` L239-L250](../ui/app/remediation.ts#L239-L250), wrapped by `useExistingTeams` in [`RemediationPanel.tsx` L674-L691](../ui/app/RemediationPanel.tsx#L674-L691).
- **Request:** `GET /platform/classic/environment-api/v2/settings/objects?schemaIds=builtin:ownership.teams&scopes=environment&fields=objectId,value&pageSize=500`.
- **When:** on mount of *Create teams for owner values in use* (after **Find missing teams**), *Assign owner to frontends and synthetic monitors (tags)* and *Create a new team*; once more after a successful team creation.
- **Response fields used:** `items[].value.identifier`, `items[].value.name`, `items[].value.supplementaryIdentifiers[].supplementaryIdentifier`. Only the first page (500 teams) is read; `nextPageKey` is not followed.
- **On error:** the team list becomes empty and the error text is shown (*Could not read existing teams: …* or *Could not read teams (…); type the identifier instead.*).

### Create teams

- **Function:** `createTeams` in [`remediation.ts` L254-L266](../ui/app/remediation.ts#L254-L266).
- **Request:** `POST /platform/classic/environment-api/v2/settings/objects?validateOnly=<true|false>`, one array body with one object per team, however many teams. Body example (two teams from owner values in use):

```json
[
  {
    "schemaId": "builtin:ownership.teams",
    "scope": "environment",
    "value": {
      "name": "team-checkout",
      "identifier": "team-checkout",
      "responsibilities": {
        "development": false,
        "infrastructure": false,
        "lineOfBusiness": false,
        "operations": false,
        "security": false
      },
      "contactDetails": [],
      "links": [],
      "additionalInformation": [],
      "supplementaryIdentifiers": []
    }
  },
  {
    "schemaId": "builtin:ownership.teams",
    "scope": "environment",
    "value": {
      "name": "team-payments",
      "identifier": "team-payments",
      "responsibilities": {
        "development": false,
        "infrastructure": false,
        "lineOfBusiness": false,
        "operations": false,
        "security": false
      },
      "contactDetails": [],
      "links": [],
      "additionalInformation": [],
      "supplementaryIdentifiers": []
    }
  }
]
```

- **Response fields used:** `[].code` (any item with `code >= 400` is a failure) and `[].error.message` of the first failure.
- **Messages:** *Validation passed for `<n>` teams. Nothing was saved.*, *Created `<n>` teams.*, or *`<failed>` of `<n>` rejected: `<message>`*; an exception shows the SDK error message.

### Add owner tags

- **Function:** `applyOwnerTag` and `ownerTagSelectors` in [`remediation.ts` L548-L593](../ui/app/remediation.ts#L548-L593).
- **Request:** for every selector, sequentially: `POST /platform/classic/environment-api/v2/tags?entitySelector=<selector>&from=now-30d` with the body:

```json
{
  "tags": [
    {
      "key": "dt.owner",
      "value": "team-checkout"
    }
  ]
}
```

- **Selectors:** the selected IDs are grouped by ID prefix (`APPLICATION`, `SYNTHETIC_TEST`, `HTTP_CHECK`; one entity type per selector) and chunked into groups of at most 60 IDs, so the selector stays below its 2,000-character limit. Example: `entityId("APPLICATION-0000000000000001","APPLICATION-0000000000000002")`. 65 frontends, 1 browser monitor and 1 HTTP monitor make 4 calls (60 + 5 frontends, 1, 1).
- **`from=now-30d`:** the selector matches entities seen in the last 30 days, independent of the page timeframe.
- **Response fields used:** `matchedEntitiesCount`, summed over all calls.
- **Messages:** *Tag `<key>:<value>` added to `<matched>` of `<n>` entities (`<calls>` API calls). Ownership updates within a few minutes.* On an error: *Tagged `<matched>` before the error. `<message>`* (calls already made are not rolled back).
- **No dry run:** the tags API has no validate-only mode, so **Validate** makes no request (see below).

## Remediation actions

The section *Remediation actions* ([`RemediationPanel.tsx` L1134-L1145](../ui/app/RemediationPanel.tsx#L1134-L1145)) starts with the impact line *`<n>` entities without an owning team.* (sum of `total - owner` over the six scored types in the shared coverage result) and an **Action** dropdown. API actions are prefixed *API ·*, manual ones *Manual ·*. The first action is selected by default. Every action ends with a *Documentation for this fix:* row of links. The section has the anchor `remediation-ownership`, which Entity Overview links scroll to.

| Action | Kind | Requests | Documentation for this fix |
| --- | --- | --- | --- |
| Create teams for owner values in use (default) | API | Q5 + 1 GET teams; Validate / Create: 1 POST | Assign ownership teams to Smartscape nodes; Assign ownership teams to monitored entities; Best practices for entity ownership |
| Assign owner to frontends and synthetic monitors (tags) | API | Q6 + 1 GET teams; Assign: 1 POST per type and 60 entities | Assign ownership teams to monitored entities; Best practices for entity ownership |
| Create a new team | API | 1 GET teams; Validate / Create: 1 POST | Same three as the first action |
| Owner on a host (host property) | Manual | none | Assign ownership teams to monitored entities; Assign ownership teams to Smartscape nodes |
| Owner on Kubernetes objects (label) | Manual | none | Assign ownership teams to monitored entities; Best practices for entity ownership |
| Owner on a process (environment variable) | Manual | none | Assign ownership teams to monitored entities |

### API: Create teams for owner values in use

Fixes owner values that are already set on entities but do not resolve to a team, because no team has that identifier.

1. The action shows *Looks at the owner labels and properties in use on entities and lists values that have no team yet.* and a **Find missing teams** button. Nothing runs before the click.
2. After the click, Q5 and the team list load (*Looking for owner values…*). Query errors are shown in red.
3. If every value matches a team: *Every ownership value in use already matches a team.*
4. Otherwise: *`<n>` ownership values have no matching team. Tick the ones to create; each becomes a team whose name and identifier are the value.* followed by **Select all** (selects every valid value), **Clear**, and one checkbox per value (*`<value>` — `<n>` entities*). Values that are not valid team identifiers are disabled and marked *(not a valid team identifier)*.
5. **Request (1 API call for `<n>` teams)** expands to the exact JSON body (with a Copy button). Each team is built by `emptyTeam(value)`: name = identifier = the value, all responsibilities false, no contact, empty links / additional information / supplementary identifiers.
6. **Validate** (needs at least one selected value) sends the POST with `validateOnly=true`; nothing is saved.
7. Tick *Create `<n>` teams in the tenant*, then **Create teams** sends the POST with `validateOnly=false`.
8. On success the selection and confirmation are cleared and the team list is read again, so the created values disappear from the list. On failure the result line is red and shows how many were rejected.

The query actions *Ownership values in use* are under the list.

### API: Assign owner to frontends and synthetic monitors (tags)

Fixes frontends, browser monitors and HTTP monitors without an owner by adding a classic tag `<key>:<team identifier>`. The same form ([`OwnerTagForm.tsx`](../ui/app/tabs/OwnerTagForm.tsx)) is used by the Frontends tab's *Assign owning team* action, for frontends only.

1. Q6 loads every frontend and synthetic monitor with its owner (*Loading frontends and synthetic monitors…*; a query error is shown in red). The team list is read at the same time.
2. Explanation: *Frontends and synthetic monitors are classic entities: ownership is a classic tag whose key is an ownership key (dt.owner, owner or team) and whose value is a team identifier. Entities that already have an owner keep it; adding a second team makes them co-owned.*
3. Form fields:

| Field | Options / input | Notes |
| --- | --- | --- |
| Tag key | `dt.owner` (default), `owner`, `team` | The tag key sent. |
| Owning team | Filterable select: *Other identifier…*, then each existing team as *`<name>` (`<identifier>`)* (or the identifier alone when the name equals it) | Placeholder *Loading teams…* until the list arrives, then *Pick a team*. |
| Team identifier | Free text, placeholder `e.g. team-checkout` | Shown when *Other identifier…* is picked or when no teams exist / could not be read. |
| Show | *All types*, *Frontends*, *Browser monitors*, *HTTP monitors* | Only when more than one type is present; filters the list below, not the selection. |

4. **Entities (`<n>` selected)** with **+ Without owner (`<n>`)** (adds the visible entities without an owner), **+ All shown (`<n>`)** (adds every visible entity), **None** (clears). Below, a scrollable checkbox list: entity name, then (when several types exist) the type and *owner: `<value>`* or *no owner*. All entities without an owner, of every type, are selected initially. The count includes selected entities hidden by the *Show* filter.
5. **Request (`<calls>` API calls for `<n>` entities)** (shown when entities are selected and a value is set) expands to the first request as the form shows it, for example:

```
POST /api/v2/tags?entitySelector=entityId("APPLICATION-0000000000000001","APPLICATION-0000000000000002")
{
  "tags": [
    {
      "key": "dt.owner",
      "value": "team-checkout"
    }
  ]
}
```

   With more than one selector, ` (+<n> more)` follows the first selector. The preview shows the classic path; the SDK sends the request to `/platform/classic/environment-api/v2/tags` and adds `from=now-30d`.
6. **Validate** makes no API call. It reports:
   - *Team identifier is required.* or *At most 100 characters.* (errors);
   - *"`<value>`" is not an identifier of an existing team; ownership only resolves once a team with that identifier exists.* (warning, shown in red, does not block the write; only checked when at least one team exists);
   - otherwise *Valid: `<n>` entities would get `<key>:<value>` in `<calls>` API calls. Nothing was changed.*
7. Tick *Add the tag `<key>:<value>` to `<n>` entities* (disabled while there is an input error or no selection), then **Assign owner** runs the POSTs one after another.
8. On success the entity list reloads (Q6 with a new refresh marker), so the owners shown update. The selection is kept; click **None** before the next run. Ownership in Dynatrace updates within a few minutes. The gauges on the tab (Q3) update the next time the tab is opened or the timeframe changes.

Existing owner tags are never removed: an entity that already has an owner and is selected gets a second owner tag.

### API: Create a new team

Creates one team in `builtin:ownership.teams` from scratch ([`RemediationPanel.tsx` L700-L797](../ui/app/RemediationPanel.tsx#L700-L797)).

| Field | Input | Validation (`checkTeam`) |
| --- | --- | --- |
| Team name | Text, placeholder `e.g. Team Checkout` | Required; at most 100 characters. Typing a name fills the identifier until the identifier is edited by hand. |
| Identifier (cannot be changed later) | Text, placeholder `e.g. team-checkout`; generated from the name by replacing runs of characters other than letters, digits, `_` and `-` with `-`, trimming leading / trailing `-` and `_`, and cutting at 100 characters (case is kept: `Team Checkout` becomes `Team-Checkout`) | Must match `^[A-Za-z0-9]([A-Za-z0-9_-]{0,98}[A-Za-z0-9])?$`; must not equal an existing team identifier or supplementary identifier. |
| Description (optional) | Text, placeholder `What the team owns` | At most 500 characters; omitted from the body when empty. |
| Contact | *No contact*, *Email*, *Slack channel* | Email: must look like `x@y.z`; Slack: must not be empty. |
| Email address / Slack channel | Text, placeholders `team@example.com` / `#team-channel` | |
| Responsibilities | Checkboxes: Development, Infrastructure, Operations, Security, Line of business | |

- The first validation problem is shown in red once a name or identifier has been typed.
- **Request (1 API call, environment scope)** expands to the body, for example:

```json
[
  {
    "schemaId": "builtin:ownership.teams",
    "scope": "environment",
    "value": {
      "name": "Team Checkout",
      "identifier": "team-checkout",
      "responsibilities": {
        "development": true,
        "infrastructure": false,
        "lineOfBusiness": false,
        "operations": true,
        "security": false
      },
      "contactDetails": [
        {
          "integrationType": "EMAIL",
          "email": "team-checkout@example.com"
        }
      ],
      "links": [],
      "additionalInformation": [],
      "supplementaryIdentifiers": [],
      "description": "Owns the checkout services"
    }
  }
]
```

  A Slack contact is sent as `{ "integrationType": "SLACK", "slackChannel": "#team-channel" }`.
- **Validate** (enabled when there is no problem and the team list has loaded) posts with `validateOnly=true`. Tick *Create this team in the tenant*, then **Create team** posts with `validateOnly=false`.
- Any edit clears the result and the confirmation. On success the form is emptied and the team list is read again.

### Manual: Owner on a host (host property)

| Variant | Command |
| --- | --- |
| Linux / AIX | `./oneagentctl --set-host-property owner-1=team-automation` |
| Windows | `.\oneagentctl.exe --set-host-property owner-1=team-automation` |

Steps: open an elevated shell in the OneAgent tools directory; set the owner property to a team identifier; check the host in Dynatrace after a few minutes. Notes: needs OneAgent 1.189+; use unique keys (`owner-1`, `owner-2`) for dual ownership; the value must be an existing team identifier or supplementary identifier.

The example key `owner-1` is not one of the keys this tab counts (`dt.owner`, `owner`, `team`); see [Limitations](#limitations-and-edge-cases). Use `owner=<team>` (or `dt.owner` / `team`) for the host to count as owned here.

### Manual: Owner on Kubernetes objects (label)

| Variant | Command |
| --- | --- |
| kubectl | `kubectl label deployment <name> -n <namespace> dt.owner=team-automation --overwrite` |
| YAML | `metadata:` / `  labels:` / `    dt.owner: team-automation` |

Steps: label the Deployment (and ideally its pods) with an ownership key; roll out so pods pick up the label; use unique keys (`dt.owner-1`, `dt.owner-2`) for dual ownership. Note: Deployment labels do not propagate to pods; pods need their own labels.

### Manual: Owner on a process (environment variable)

| Variant | Command |
| --- | --- |
| Linux / macOS | `DT_CUSTOM_PROP="owner=team-automation" java -jar app.jar` |

Steps: set `DT_CUSTOM_PROP` in the process environment before it starts; restart the process; do not use tags for processes. Note: repeat the key for dual ownership, for example `owner=team-automation owner=team-dev`.

Each manual action shows the selected variant in a code block with a **Copy** button, the steps as a numbered list, and the notes folded under *Notes*. A *Variant* dropdown appears only when there is more than one variant.

## AI Assist on this page

When **AI Assist** is on, the panel at the top of the tab shows the result of `analyzeFieldCoverage("Ownership and teams", rows)` ([`analyses.ts` L46-L73](../ui/app/analyses.ts#L46-L73)). It is rule-based and runs locally in the browser on the ownership rows already on screen (one row per scored entity type); no data leaves the page and no model is called. The frontend / synthetic monitor card is not included.

- **Overall:** `round(sum(part) / sum(total) × 100)` over the rows, so it is weighted by entity count (unlike Entity Overview, which averages percentages).
- **Summary:** *Ownership and teams: `<sum part>` of `<sum total>` entity checks are in place (`<overall>`%). `<f>` combinations fully covered, `<e>` with no coverage at all.*
- **Insights:**

| Rule | Severity | Text |
| --- | --- | --- |
| Some rows at 100% (`part == total`) | good | *Fully covered: HOST ownership team, …* (first 5) |
| Some rows at 0 (`part == 0`) | critical | *No coverage: K8S_POD ownership team (0/`<total>`), …* (first 5) |
| Row with the largest absolute gap (`total - part`) among rows below 100% | ≥ 90% good, ≥ 50% warning, else critical | *Largest gap: `<n>` HOST entities missing ownership team.* |
| Always | same thresholds on `overall` | *Combined coverage for this view is `<overall>`%.* |

- **Recommendations:**

| Rule | Impact | Text |
| --- | --- | --- |
| Some rows at 0 | high | *Start with the zero-coverage combinations — a single rule or host property usually fixes the whole group.* |
| A largest gap exists | medium | *Use “Find entities missing a field” for `<TYPE>` / Ownership team to see exactly which entities to fix.* On this tab that is the entity search with *Match* = *Is missing*. |
| Always | low | *Use Open in Notebook on a query to share or extend the check with your customer.* |

- **No rows** (no entities, or the coverage query is still loading or failed): summary *No coverage data is available for ownership and teams in this timeframe.*, insight *No entities returned. Widen the timeframe or check the data source.*, recommendation (medium) *Confirm entities are being monitored, then re-check.*

## Limitations and edge cases

- **Hard-coded keys.** The app checks `dt.owner`, `owner` and `team` only. If the tenant's `builtin:ownership.config` defines other ownership keys, entities using them are counted as unowned. The app does not read `builtin:ownership.config`.
- **Exact key names.** Dual-ownership keys such as `owner-1` or `dt.owner-2`, which the manual host and Kubernetes actions use as examples, are not counted. An entity owned only through such keys shows as unowned on the gauges, in the search and in the missing-teams list.
- **Values are not validated against teams.** The gauges count any non-null value, including typos and identifiers with no team. Use *Create teams for owner values in use* to find values without a team.
- **Only the first owner counts.** `coalesce` returns one value per entity; a second team on the same entity (another key or field) is not shown in the search and not used by the missing-teams comparison.
- **Classic tags must be contextless and start with the key.** Tags whose text does not start exactly with `dt.owner:`, `owner:` or `team:` (for example a key-only tag `owner`, a different case such as `Owner:`, or a tag with a context prefix) are not counted. A tag `owner:` with an empty value counts as owned. The first matching tag in array order wins.
- **Third-party monitors are not covered.** Only `dt.entity.application` (web frontends), `dt.entity.synthetic_test` and `dt.entity.http_check` are read; mobile and custom applications and third-party synthetic monitors are not.
- **Services, containers and Kubernetes clusters are not scored** (no property or label map).
- **Row caps.** Search: 500 rows. Unowned classic entities: 500. Owner-tag form: 2,000 entities. Owner values: 200 most used. Teams: first 500.
- **Timeframe.** Longer timeframes include entities that no longer exist; the tags API call always targets entities seen in the last 30 days.
- **Owner tags are additive and not rolled back.** A failed call stops the run; tags already added stay.
- **Shared query.** The ownership gauges come from the app-wide coverage query, which only refreshes on a timeframe change or app reload; after fixing owners, change the timeframe or reload the app to see the new score. Ownership changes also take a few minutes to reach Smartscape.
- **Team list not refreshed across forms.** A team created in *Create a new team* appears in the owner-tag team picker only after the action is reselected (each form reads the list when it is shown).

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| *Query failed* with a permission error on the gauges | User lacks `storage:smartscape:read` | Grant the permission in an IAM policy. |
| Frontends card shows *Query failed* | User lacks `storage:entities:read` | Grant the permission. |
| All ownership gauges at 0% although owners are set | Owners use other keys (custom ownership keys, `owner-1`, different case), or are set as classic tags on hosts | Use `dt.owner`, `owner` or `team` as host property, `DT_CUSTOM_PROP`, or Kubernetes label / annotation. Check one entity with the search (*Is missing*) and its overview page. |
| A Kubernetes deployment is owned but its pods are not | Deployment labels do not propagate to pods | Label the pod template as well and roll out. |
| No gauge for services, containers or clusters | By design | These types cannot carry an ownership key. |
| *Could not read teams (…); type the identifier instead.* | Missing `settings:objects:read` on `builtin:ownership.teams` | Grant read access; or type the identifier. |
| Team creation rejected (*`<n>` of `<n>` rejected: …*) | Missing `settings:objects:write` on the schema, duplicate identifier, or a schema validation error | Read the message; run **Validate** first; grant the permission. |
| *Every ownership value in use already matches a team.* but ownership does not resolve | Values match supplementary identifiers, or entity owners use keys not counted here | Check the team settings and the keys used. |
| **Assign owner** fails with 403 | Missing `environment-api:entities:write` | Grant the permission. |
| *Tag … added to 0 of `<n>` entities* | The entities were not seen in the last 30 days (selector `from=now-30d`) | Pick entities that still exist. |
| Owner added but the gauge did not change | Gauges are not re-queried after a write | Wait a few minutes, then reopen the tab or change the timeframe. |
| The *"…" is not an identifier of an existing team* warning | The value has no team | Create the team first (*Create a new team*), or pick an existing team. |

## Related pages

- [Index](README.md)
- [Entity Overview](entity-overview.md): Overall readiness, the *Ownership team* summary gauge and Top 5 findings that link here.
- [Frontends](frontends.md): the frontends' *Owning team assigned* check and the same owner-tag form.
- [Security context](security-context.md), [Cost allocation](cost-allocation.md), [Host groups](host-groups.md): the other fields of the shared coverage query.
- [Primary tags](primary-tags.md): customer-defined `primary_tags.*`.

## Source files

| File | Role on this page |
| --- | --- |
| [`ui/app/App.tsx`](../ui/app/App.tsx) | Runs the shared coverage query; assembles the tab (coverage, classic card, remediation). |
| [`ui/app/tabs/CoverageTabs.tsx`](../ui/app/tabs/CoverageTabs.tsx) | `FieldCoverageTab`, `OWNER_FOCUS`, `TypeGaugeGrid`, `toCoverageRows`; Entity Overview scoring of the owner rows. |
| [`ui/app/tabs/ClassicOwnership.tsx`](../ui/app/tabs/ClassicOwnership.tsx) | Frontends and synthetic monitors card; loader for the owner-tag form. |
| [`ui/app/tabs/OwnerTagForm.tsx`](../ui/app/tabs/OwnerTagForm.tsx) | Owner-tag form (key, team, entity selection, Validate, Assign owner). |
| [`ui/app/tabs/EntitySearch.tsx`](../ui/app/tabs/EntitySearch.tsx) | Entity search by owning team. |
| [`ui/app/queries.ts`](../ui/app/queries.ts) | `OWNER_KEYS`, `OWNER_EXPR`, `OWNER_TYPES`, `PRIMARY_FIELDS`, `fieldApplies`, `coverageQuery`, `entitySearchQuery`, `ownerValuesQuery`, classic owner queries, `refreshMarker`. |
| [`ui/app/RemediationPanel.tsx`](../ui/app/RemediationPanel.tsx) | Remediation section, `useExistingTeams`, `TeamCreateForm`, `MissingTeams`, `ManualActionView`. |
| [`ui/app/remediation.ts`](../ui/app/remediation.ts) | Team schema bodies and validation, `listTeams`, `createTeams`, owner-tag selectors and `applyOwnerTag`, manual actions, documentation links. |
| [`ui/app/analyses.ts`](../ui/app/analyses.ts) | `analyzeFieldCoverage` (AI Assist). |
| [`ui/app/components.tsx`](../ui/app/components.tsx) | `PctGauge`, `QueryActions`, `DrillDownTable`, `QueryState`. |
| [`ui/app/links.ts`](../ui/app/links.ts) | `entityOverviewLink`, `classicEntityLink`. |
| [`ui/app/useDql.ts`](../ui/app/useDql.ts) | DQL hook (re-runs when the query text changes). |
| [`app.config.json`](../app.config.json) | App scopes. |
