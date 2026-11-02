# Security context

The **Security context** tab measures how many monitored entities carry the primary Grail field
`dt.security_context`, per entity type (hosts, processes, services, containers and Kubernetes clusters, nodes,
namespaces, deployments and pods). It shows one gauge per entity type, lets you search entities that have, lack or
carry a specific security context value, and ends with a **Remediation actions** section that can create a central
ingest enrichment rule (`builtin:ingest.enrichment.config`) for `dt.security_context` in the tenant, or gives the
manual `oneagentctl` and Kubernetes annotation steps that set it at the source.

| | |
| --- | --- |
| Area | Metadata (see [index](README.md)) |
| Tab id | `security` |
| Counts toward Entity Overview readiness / Top findings | Yes. Every entity type with at least one entity contributes one *Security context* check (up to 9) to Overall readiness on the Entity Overview, the Entity Overview *Security context* summary gauge is the rounded mean of those checks, and each check below 100% is a Top 5 findings candidate whose **Remediation steps** button opens this tab's Remediation actions. |
| Main source files | [`ui/app/tabs/CoverageTabs.tsx`](../ui/app/tabs/CoverageTabs.tsx), [`ui/app/tabs/EntitySearch.tsx`](../ui/app/tabs/EntitySearch.tsx), [`ui/app/queries.ts`](../ui/app/queries.ts), [`ui/app/RemediationPanel.tsx`](../ui/app/RemediationPanel.tsx), [`ui/app/remediation.ts`](../ui/app/remediation.ts), [`ui/app/analyses.ts`](../ui/app/analyses.ts) |

## Contents

- [What this page answers](#what-this-page-answers)
- [Before you start](#before-you-start)
  - [App scopes used by this page](#app-scopes-used-by-this-page)
  - [User permissions](#user-permissions)
  - [One-time setup](#one-time-setup)
- [Page walkthrough](#page-walkthrough)
  - [Shell controls that affect this page](#shell-controls-that-affect-this-page)
  - [Heading and description](#heading-and-description)
  - [Coverage gauges](#coverage-gauges)
  - [Query actions for the coverage query](#query-actions-for-the-coverage-query)
  - [Search entities by security context](#search-entities-by-security-context)
  - [Search results table](#search-results-table)
  - [Remediation actions section](#remediation-actions-section)
- [Checks and scoring](#checks-and-scoring)
- [Queries](#queries)
  - [Q1. Primary field coverage](#q1-primary-field-coverage-coveragequery)
  - [Q2. Entity search by security context](#q2-entity-search-by-security-context-entitysearchquery)
  - [Client-side processing](#client-side-processing)
- [API calls](#api-calls)
- [Remediation actions](#remediation-actions)
  - [Action picker and impact line](#action-picker-and-impact-line)
  - [API: Central enrichment rule](#api-central-enrichment-rule)
  - [Manual: Host tag with oneagentctl](#manual-host-tag-with-oneagentctl)
  - [Manual: Kubernetes annotation](#manual-kubernetes-annotation)
- [AI Assist on this page](#ai-assist-on-this-page)
- [Limitations and edge cases](#limitations-and-edge-cases)
- [Troubleshooting](#troubleshooting)
- [Related pages](#related-pages)
- [Source files](#source-files)

## What this page answers

The tab answers these questions for an architect:

- **How much of the monitored estate carries a security context?** One gauge per entity type shows the share of
  entities (Smartscape nodes seen in the selected timeframe) whose `dt.security_context` holds at least one value.
- **Which entity types have no security context at all?** A gauge at 0% (and an AI Assist "No coverage" insight)
  marks entity types where not a single entity has the field.
- **Which entities are missing it, and which carry a given value?** The entity search lists entities that have a
  value, lack it, carry an exact value, or whose value contains a text, optionally narrowed to one entity type and a
  name fragment.
- **How do I fix it?** The Remediation actions section creates one central ingest enrichment rule (one rule covers
  every matching entity) or shows the per-host and per-Kubernetes-object commands.

The best practice it checks is stated on the tab itself (`SECURITY_FOCUS.blurb` in
[`CoverageTabs.tsx`](../ui/app/tabs/CoverageTabs.tsx#L334-L340)):

> dt.security_context drives data access (IAM policy boundaries) and security-team ownership. Entities without it
> cannot be scoped by security context.

`dt.security_context` is one of the primary Grail fields. The Dynatrace documentation pages the code cites for this
tab (in [`remediation.ts`](../ui/app/remediation.ts#L413-L429), shown under **Documentation for this fix**):

- [Primary Grail fields and tags](https://docs.dynatrace.com/docs/manage/tags/primary-tags)
- [Ingest enrichment rules](https://docs.dynatrace.com/docs/manage/tags/tags-central-enrichment)
- [OneAgent primary tags](https://docs.dynatrace.com/docs/manage/tags/primary-tags/tags-domain-oneagent)
- [Kubernetes primary tags](https://docs.dynatrace.com/docs/manage/tags/primary-tags/tags-domain-k8s)
- [oneagentctl reference](https://docs.dynatrace.com/docs/ingest-from/dynatrace-oneagent/oneagent-configuration-via-command-line-interface)

## Before you start

### App scopes used by this page

All scopes are declared in [`app.config.json`](../app.config.json). This page uses:

| Scope | What this page uses it for |
| --- | --- |
| `storage:smartscape:read` | Runs the coverage query (Q1) and the entity search (Q2) on Smartscape nodes (`smartscapeNodes`). |
| `settings:objects:write` | Remediation action *Central enrichment rule*: validates (`validateOnly=true`) and creates the `builtin:ingest.enrichment.config` settings object. |

The page reads no settings, so `settings:objects:read` is not used here. Opening a query in Notebooks or Dashboards
and the *Open overview* links use AppEngine intents, which need no app scope.

### User permissions

An AppEngine app acts with the signed-in user's permissions, limited to the app's scopes. Beyond being allowed to
run the app, the user needs:

- **To see the gauges and search:** permission to read Smartscape data (`storage:smartscape:read`). The counts only
  include what the user may read.
- **To use Validate and Create rule:** permission to write settings objects of the schema
  `builtin:ingest.enrichment.config` at environment scope. The SDK documents the requirement for
  `POST /api/v2/settings/objects` as one of `environment:roles:manage-settings` or `settings:objects:write`; a
  policy such as `ALLOW settings:objects:write WHERE settings:schemaId = "builtin:ingest.enrichment.config";`
  covers it. Without it, Validate and Create rule return an error in the result line (see
  [Troubleshooting](#troubleshooting)).
- **For Open in Notebook / Add to Dashboard / Open overview:** access to the Notebooks, Dashboards,
  Infrastructure & Operations, Services and Kubernetes apps that the intents open.
- **For the manual actions:** shell access to the OneAgent host with elevated rights (`oneagentctl`), or
  `kubectl` rights to annotate namespaces, workloads or pods and to edit the DynaKube.

### One-time setup

None. The page uses no credential vault entry, no outbound connection and no OAuth client. The Kubernetes
annotation fix needs metadata enrichment enabled in the DynaKube (`spec.metadataEnrichment.enabled: true`); that is
a step of the manual action, not a setup of the app.

## Page walkthrough

The tab is rendered by `App.tsx` as `<FieldCoverageTab focus={SECURITY_FOCUS}/>` followed by
`<RemediationPanel tab="security"/>` ([`App.tsx`](../ui/app/App.tsx#L95-L101)). From top to bottom:

### Shell controls that affect this page

- **Security context documentation** (top right of the tab): opens this page on GitHub
  (`TabDocsLink` in [`areas.tsx`](../ui/app/areas.tsx#L85-L94)).
- **Timeframe** select in the app header: *Last 24 hours* (default), *Last 7 days*, *Last 30 days*
  (`TIMEFRAMES` in [`queries.ts`](../ui/app/queries.ts#L6-L12)). It changes `from:now()-24h` in every query of this
  tab to `from:now()-7d` or `from:now()-30d`. With 7 or 30 days the header adds: "Longer timeframes also count
  entities that existed earlier in the window, including decommissioned ones."
- **AI Assist** toggle in the app header: when on, an *AI Insights* panel appears at the top of the tab
  (see [AI Assist on this page](#ai-assist-on-this-page)).
- Arriving from the **Entity Overview**: the (i) button on its *Security context* summary gauge and the
  **Remediation steps** button of a security-context Top finding switch to this tab and scroll to the Remediation
  actions section (anchor id `remediation-security`; `goToRemediation` in [`App.tsx`](../ui/app/App.tsx#L58-L67)
  looks for the section every 100 ms, up to 16 tries, and scrolls it into view once it is mounted).

### Heading and description

A level-3 heading **Security context** and the description text quoted in
[What this page answers](#what-this-page-answers). Both are always shown, also while the data loads.

### Coverage gauges

One card with one gauge per entity type (`TypeGaugeGrid` in
[`CoverageTabs.tsx`](../ui/app/tabs/CoverageTabs.tsx#L89-L102)). The card has no title because the tab focuses on a
single field.

- **Order:** Hosts, Processes, Services, Containers, Kubernetes clusters, Kubernetes nodes, Kubernetes namespaces,
  Kubernetes deployments, Kubernetes pods (`ENTITY_TYPES` in [`queries.ts`](../ui/app/queries.ts#L17-L27)). An entity
  type with no entity in the timeframe has no gauge.
- **Caption:** the entity type title (`ENTITY_LABELS[type].title`).
- **Value:** `Math.round(security / total * 100)` for that type, where `security` and `total` are the columns of the
  coverage query (Q1). An entity counts as *in place* when `arraySize(dt.security_context) > 0`, that is, the field
  exists and holds at least one value. 0 when `total` is 0 (never shown, such types are skipped).
- **Detail line:** `<security> of <total>` with thousands separators in the browser's locale, for example
  `1,234 of 1,500`.
- **Look:** a custom SVG gauge (`PctGauge` in [`components.tsx`](../ui/app/components.tsx#L69-L134)), 188 px wide, a
  240-degree arc open at the bottom. The filled part is a gradient whose colour depends on the position on the
  scale: red at 0% through orange and yellow to green at 100% (`statusColor`: HSL hue `0` to `125`, saturation 78%,
  lightness 46%). The number in the middle is the integer percentage. These gauges have no (i) button and no click
  action.
- **Loading:** "Loading…" while the coverage query runs and has no result yet (`QueryState`).
- **Error:** a red *Query failed* message box with the error text from the query.
- **Empty:** "No entities found for this timeframe." when no entity type has entities.

### Query actions for the coverage query

A row of four buttons under the gauges (`QueryActions` in [`components.tsx`](../ui/app/components.tsx#L200-L246)),
titled *Security context coverage*:

| Button | What it does |
| --- | --- |
| **Show DQL** / **Hide DQL** | Shows or hides the exact query text of Q1 below the buttons. |
| **Copy** | Copies the query text to the clipboard; the label changes to *Copied* for 1.5 s. |
| **↗ Open in Notebook** | Sends the intent `view-query` to `dynatrace.notebooks` with the payload `{"dt.query": "<Q1 text>", "title": "Security context coverage"}`. |
| **↗ Add to Dashboard** | Sends the intent `add-to-dashboard` to `dynatrace.dashboards` with the same payload. |

The query behind these buttons is the shared coverage query: it also counts the cost, host group and ownership
fields that other tabs use (see [Q1](#q1-primary-field-coverage-coveragequery)).

### Search entities by security context

A card titled **Search entities by security context** (`EntitySearch` in
[`EntitySearch.tsx`](../ui/app/tabs/EntitySearch.tsx)). Nothing runs until you click **Search entities**. The tab
passes one searchable property (security context, `expr: "dt.security_context"`, `array: true`), so there is no
*Property* select on this tab.

| Control | Options | Effect on the query (Q2) |
| --- | --- | --- |
| **Entity type** | *All applicable types* (default) or one of the 9 entity types | `smartscapeNodes` lists all 9 types or only the chosen one. |
| **Match** | *Has a value* (default), *Equals*, *Contains*, *Is missing* | Adds the filter condition for the mode (see [Q2](#q2-entity-search-by-security-context-entitysearchquery)). |
| **Value** (only for *Equals* and *Contains*) | Free text, placeholder "Value to match"; leading and trailing blanks are trimmed | *Equals*: `in("<value>", dt.security_context)`. *Contains*: `contains(toString(dt.security_context), "<value>", caseSensitive:false)`. |
| **Name contains (optional)** | Free text, placeholder "e.g. prod-"; trimmed | When not empty, adds `contains(name, "<text>", caseSensitive:false)` as the first filter condition. |
| **Search entities** | Button | Builds Q2 with the current timeframe and inputs and shows the results table. With *Equals* or *Contains* and an empty value, the click does nothing. |

Changing any control hides the current results (the query is cleared); click **Search entities** again to run the
new search. Values are embedded as DQL string literals: they are wrapped in double quotes, and backslashes and
double quotes are escaped (`dqlString` in [`queries.ts`](../ui/app/queries.ts#L155)).

### Search results table

Shown under the search card after a search (`DrillDownTable` in
[`components.tsx`](../ui/app/components.tsx#L253-L285)). The table is mounted with the query as its key, so each new
search runs once.

- **Query actions** above the table, titled *Security context search*: Show DQL, Copy, Open in Notebook, Add to
  Dashboard, exactly as described above but with the search query.
- **Columns:**

| Column | Source field | Meaning |
| --- | --- | --- |
| Name | `name` | Entity name. |
| Type | `type` | Smartscape node type, for example `HOST`, `K8S_POD`. |
| Entity ID | `id` | Smartscape node ID. |
| Security context | `value` = `toString(dt.security_context)` | The security context array as text; empty when the entity has none. |
| Overview | built from `type` and `id` | **Open overview ↗** opens the entity's overview page in a new browser tab (see below); "—" when no link can be built. |

- **Overview links** (`entityOverviewLink` in [`links.ts`](../ui/app/links.ts#L28-L76)), built with
  `getIntentLink` from `@dynatrace-sdk/navigation`:

| Type | App | Intent | Property |
| --- | --- | --- | --- |
| `HOST` | `dynatrace.infraops` | `view_host` | `meId` |
| `PROCESS` | `dynatrace.infraops` | `view_smartscape_process` | `nodeId` |
| `CONTAINER` | `dynatrace.infraops` | `view_smartscape_container` | `nodeId` |
| `SERVICE` | `dynatrace.services` | `view-entity-dt.smartscape.service` | `nodeId` |
| `K8S_CLUSTER` | `dynatrace.kubernetes` | `view-entity-dt.smartscape.k8s_cluster` | `nodeId` |
| `K8S_NODE` | `dynatrace.kubernetes` | `view-entity-dt.smartscape.k8s_node` | `nodeId` |
| `K8S_NAMESPACE` | `dynatrace.kubernetes` | `view-entity-dt.smartscape.k8s_namespace` | `nodeId` |
| `K8S_DEPLOYMENT` | `dynatrace.kubernetes` | `view-entity-dt.smartscape.k8s_deployment` | `nodeId` |
| `K8S_POD` | `dynatrace.kubernetes` | `view-entity-dt.smartscape.k8s_pod` | `nodeId` |

  The search does not pass the timeframe to the link, so the target app opens on its own default timeframe.
- **Sorting and size:** rows arrive sorted by name (ascending); every column header can re-sort the loaded rows in the
  browser. The query returns at most 500 rows; all are shown in one table (no paging), condensed row density. When
  exactly 500 rows come back, the text "Showing the first 500 entities." appears under the table.
- **Loading / error / empty:** "Loading…" while the query runs; a *Query failed* box with the error text; "No
  entities match this search." when the query returns no rows.

### Remediation actions section

A card titled **Remediation actions** at the bottom of the tab, with an impact line, an **Action** select and the
form of the selected action. See [Remediation actions](#remediation-actions) for every field and request.

## Checks and scoring

| Check | In place when | Numerator | Denominator | Severity / thresholds | Notes |
| --- | --- | --- | --- | --- | --- |
| Security context on *<entity type>* (one per type: Hosts, Processes, Services, Containers, Kubernetes clusters, nodes, namespaces, deployments, pods) | `arraySize(dt.security_context) > 0` on the Smartscape node | `security` column of Q1 for that type | `total` column of Q1 for that type (all nodes of that type seen in the timeframe) | No status labels on this tab; the gauge colour runs continuously from red (0%) to green (100%). AI Assist rates a percentage *good* at 90% or more, *warning* at 50% to 89%, *critical* below 50%. | `pct = Math.round(part / total * 100)`. A type with `total = 0` (no record) is not a check. |

Derived values outside this tab that use the same checks:

| Derived value | Where | Rule |
| --- | --- | --- |
| *Security context* summary gauge | Entity Overview | `Math.round(mean(pct of every security check))`: an unweighted mean of the per-type percentages ("avg of N checks"). |
| Overall readiness | Entity Overview | Unweighted mean of every check of every primary field (security, cost center, cost product, host group, ownership) plus frontend readiness when frontends exist; each security check counts once. |
| Top 5 findings | Entity Overview | Every security check with `pct < 100` is a candidate. Candidates are ranked by entity importance (hosts first, then Kubernetes nodes, clusters, frontends, containers, Kubernetes namespaces / deployments / pods, then processes and services), then by `(100 - pct) * log10(total + 10)`; at most 2 findings per entity type and 5 in total. Text: "None of the *N* *hosts* have a security context." at 0%, otherwise "Only *P*% of *hosts* have a security context (*part* of *total*)." The button opens this tab's Remediation actions. |
| Impact line | This tab, Remediation actions | Sum of `total - security` over all entity types: "*N* entities without security context." |
| "Security context is not set on any … entity" | Entity Overview AI Assist | Raised for every entity type whose security check is 0 of more than 0. |

## Queries

| # | Name (function in source) | Runs when | Feeds |
| --- | --- | --- | --- |
| Q1 | Primary field coverage (`coverageQuery` in [`queries.ts`](../ui/app/queries.ts#L76-L84)) | At app start (whatever tab is open) and on every timeframe change; one shared result for the whole app | Coverage gauges, impact line of Remediation actions, AI Assist; also Entity Overview, Cost allocation, Ownership & Teams and the other remediation sections |
| Q2 | Entity search (`entitySearchQuery` in [`queries.ts`](../ui/app/queries.ts#L157-L172)) | When you click **Search entities** | Search results table |

`missingEntitiesQuery` in [`queries.ts`](../ui/app/queries.ts#L86-L92) ("entities of one type missing one primary
field") is defined but not used by this tab or any other part of the app.

### Q1. Primary field coverage (`coverageQuery`)

- **Source:** `coverageQuery(tf)` in [`ui/app/queries.ts`](../ui/app/queries.ts#L76-L84), executed once in
  [`App.tsx`](../ui/app/App.tsx#L50-L52) with `useDql(coverageQuery(tf))` and passed to this tab as `coverage`.
- **Runs:** at page start, independent of the tab you open, and again when the timeframe changes (the hook re-runs
  when the query text changes). Opening this tab does not run it again.
- **Parameters:** `tf`, the timeframe: `24h` (default), `7d` or `30d`. Only the `from:` argument changes:
  `from:now()-24h` becomes `from:now()-7d` or `from:now()-30d`.
- **Query** (24 hours):

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
  1. `smartscapeNodes "HOST", …, "K8S_POD", from:now()-24h` reads the Smartscape nodes of the 9 listed entity types
     that existed in the timeframe. Each node carries its primary Grail fields (`dt.security_context`,
     `dt.cost.*`, `dt.host_group.id`, …) as plain fields, so no logs, metrics or events are scanned. With 7 or 30
     days, nodes that existed only earlier in the window (for example decommissioned hosts or replaced pods) are
     counted too.
  2. `summarize … by:{type}` produces one record per entity type:
     - `total = count()`: all nodes of the type.
     - `security = countIf(arraySize(dt.security_context) > 0)`: nodes whose `dt.security_context` array has at
       least one element. When the field is missing, `arraySize` returns null and `countIf` does not count the
       node; an empty array gives `0 > 0`, which is false. This is the only column this tab reads.
     - `costcenter`, `product`: nodes with a non-null `dt.cost.costcenter` / `dt.cost.product` (Cost allocation
       tab).
     - `hostgroup`: nodes with a non-null `dt.host_group.id` (Host groups, Entity Overview).
     - `owner`: nodes where any of the 12 ownership locations holds a value: the keys `dt.owner`, `owner` and `team`
       in host properties (`host.custom.metadata`), process metadata (`custom_metadata`), Kubernetes labels
       (`tags:k8s.labels`) and Kubernetes annotations (`tags:k8s.annotations`); `coalesce` returns the first
       non-null one (Ownership & Teams).
- **Output:** up to 9 records with `type`, `total`, `security`, `costcenter`, `product`, `hostgroup`, `owner`. An
  entity type with no node in the timeframe has no record. This tab uses `type`, `total` and `security`: one gauge
  per record (`security` of `total`), the impact line (sum of `total - security`) and AI Assist.
- **Limits and cost:** no `limit` is needed (at most 9 result records). The code comment in `queries.ts` explains the
  choice of `smartscapeNodes`: it is cheap and carries the primary Grail fields on each entity, instead of scanning
  logs, events or metrics. The query carries an explicit `from:` timeframe, as every query of the app.
- **Open it yourself:** yes, the Query actions under the gauges (*Security context coverage*): Show DQL, Copy, Open
  in Notebook, Add to Dashboard.

### Q2. Entity search by security context (`entitySearchQuery`)

- **Source:** `entitySearchQuery(tf, types, field, mode, value, name)` in
  [`ui/app/queries.ts`](../ui/app/queries.ts#L157-L172), called from
  [`EntitySearch.tsx`](../ui/app/tabs/EntitySearch.tsx#L131-L137) when you click **Search entities**, and run by
  `DrillDownTable`.
- **Runs:** only on the button click. The timeframe is the one selected at the time of the click; the results do not
  re-run when you later change the timeframe (click **Search entities** again).
- **Parameters:**

| Input | Values | Effect on the text |
| --- | --- | --- |
| `tf` | `24h`, `7d`, `30d` | `from:now()-24h` / `-7d` / `-30d`. |
| `types` | All 9 types (*All applicable types*) or one | The list after `smartscapeNodes`, for example `smartscapeNodes "HOST", from:now()-24h`. |
| `field` | `{ key: "security", label: "Security context", expr: "dt.security_context", array: true }` (fixed on this tab) | `dt.security_context` in the filter and in `fieldsAdd value = toString(dt.security_context)`. Because `array` is true, the *Has a value*, *Is missing* and *Equals* modes use array functions. |
| `mode` | `has`, `equals`, `contains`, `missing` | The filter condition, see below. |
| `value` | Trimmed text (only *Equals* and *Contains*) | Embedded as an escaped DQL string. |
| `name` | Trimmed text, optional | When not empty: `contains(name, "<name>", caseSensitive:false) and …` in front of the mode condition. |

- **Query**, *Has a value*, all types, 24 hours (the default search):

```dql
smartscapeNodes "HOST", "PROCESS", "SERVICE", "CONTAINER", "K8S_CLUSTER", "K8S_NODE", "K8S_NAMESPACE", "K8S_DEPLOYMENT", "K8S_POD", from:now()-24h
| filter arraySize(dt.security_context) > 0
| fieldsAdd value = toString(dt.security_context)
| fields id, name, type, value
| sort name asc
| limit 500
```

- *Is missing*, all types, 24 hours:

```dql
smartscapeNodes "HOST", "PROCESS", "SERVICE", "CONTAINER", "K8S_CLUSTER", "K8S_NODE", "K8S_NAMESPACE", "K8S_DEPLOYMENT", "K8S_POD", from:now()-24h
| filter (isNull(dt.security_context) or arraySize(dt.security_context) == 0)
| fieldsAdd value = toString(dt.security_context)
| fields id, name, type, value
| sort name asc
| limit 500
```

- *Equals* `confidential`, all types, 24 hours:

```dql
smartscapeNodes "HOST", "PROCESS", "SERVICE", "CONTAINER", "K8S_CLUSTER", "K8S_NODE", "K8S_NAMESPACE", "K8S_DEPLOYMENT", "K8S_POD", from:now()-24h
| filter in("confidential", dt.security_context)
| fieldsAdd value = toString(dt.security_context)
| fields id, name, type, value
| sort name asc
| limit 500
```

- *Contains* `team-a`, all types, 24 hours:

```dql
smartscapeNodes "HOST", "PROCESS", "SERVICE", "CONTAINER", "K8S_CLUSTER", "K8S_NODE", "K8S_NAMESPACE", "K8S_DEPLOYMENT", "K8S_POD", from:now()-24h
| filter contains(toString(dt.security_context), "team-a", caseSensitive:false)
| fieldsAdd value = toString(dt.security_context)
| fields id, name, type, value
| sort name asc
| limit 500
```

- *Is missing*, entity type *Hosts*, name contains `prod-`, 7 days:

```dql
smartscapeNodes "HOST", from:now()-7d
| filter contains(name, "prod-", caseSensitive:false) and (isNull(dt.security_context) or arraySize(dt.security_context) == 0)
| fieldsAdd value = toString(dt.security_context)
| fields id, name, type, value
| sort name asc
| limit 500
```

- *Equals* a value with double quotes (`my "quoted" value`), entity type *Kubernetes namespaces*, name contains
  `prod-`, 24 hours, showing the escaping:

```dql
smartscapeNodes "K8S_NAMESPACE", from:now()-24h
| filter contains(name, "prod-", caseSensitive:false) and in("my \"quoted\" value", dt.security_context)
| fieldsAdd value = toString(dt.security_context)
| fields id, name, type, value
| sort name asc
| limit 500
```

- **How it works:**
  1. `smartscapeNodes <types>, from:now()-<tf>`: the selected entity types, nodes that existed in the timeframe.
  2. `filter <conditions>`: the conditions are joined with `and`; the optional name condition comes first.
     - *Has a value*: `arraySize(dt.security_context) > 0`, the same predicate as the gauge numerator, so the row
       count (up to 500) matches the gauge's numerator for the same types and timeframe.
     - *Is missing*: `(isNull(dt.security_context) or arraySize(dt.security_context) == 0)`, the complement of the
       gauge numerator: the field is absent or an empty array.
     - *Equals*: `in("<value>", dt.security_context)` is true when one element of the array equals the value
       exactly (case-sensitive). An entity with several security contexts matches if any of them is equal.
     - *Contains*: `contains(toString(dt.security_context), "<value>", caseSensitive:false)` is a case-insensitive
       substring match on the text form of the whole array. It can match across elements or on the array's
       punctuation; entities without the field drop out because `toString` of a missing field is null.
     - Name: `contains(name, "<text>", caseSensitive:false)` is a case-insensitive substring match on the entity name.
  3. `fieldsAdd value = toString(dt.security_context)`: the array as one text value for the table column.
  4. `fields id, name, type, value`: keeps only the columns the table shows.
  5. `sort name asc`: alphabetical by name, applied before the limit.
  6. `limit 500`: at most 500 rows.
- **Output:** `id`, `name`, `type`, `value` → table columns Entity ID, Name, Type, Security context; `type` and `id`
  also build the Overview link.
- **Limits and cost:** 500 rows (the first 500 by name). Smartscape read, no sampling or scan limit needed.
- **Open it yourself:** yes, the Query actions above the results (*Security context search*).

### Client-side processing

1. **Rows from Q1** (`toCoverageRows` in [`CoverageTabs.tsx`](../ui/app/tabs/CoverageTabs.tsx#L41-L58)): the records
   are indexed by `type`. For each of the 9 entity types in `ENTITY_TYPES` order, a type without a record or with
   `total` 0 is skipped. For each primary field that applies to the type (security context applies to all 9 types),
   one row `{ type, field, label, part, total, pct }` is created, with `part = Number(record[field])` (non-numeric
   values become 0) and `pct = Math.round(part / total * 100)` (`pct` in
   [`components.tsx`](../ui/app/components.tsx#L31)).
2. **Focus filter** (`FieldCoverageTab`, [`CoverageTabs.tsx`](../ui/app/tabs/CoverageTabs.tsx#L302-L332)): only rows
   with `field === "security"` are kept. These rows drive the gauges and AI Assist.
3. **Entity types for the search:** `ENTITY_TYPES` filtered by `fieldApplies(type, "security")`, which is true for
   every type ([`queries.ts`](../ui/app/queries.ts#L69-L70)), so the *Entity type* select lists all 9.
4. **Impact line** (`RemediationPanel`, [`RemediationPanel.tsx`](../ui/app/RemediationPanel.tsx#L1119-L1150)): the
   same rows are rebuilt from Q1, and `missing("security")` sums `total - part` over every entity type.

## API calls

| Method | Endpoint or SDK method | Scope | When |
| --- | --- | --- | --- |
| POST, then GET | `/platform/storage/query/v1/query:execute`, `/platform/storage/query/v1/query:poll` through `useDql` of `@dynatrace-sdk/react-hooks` | `storage:smartscape:read` | Q1 at app start and on timeframe change; Q2 on **Search entities** |
| POST | `/platform/classic/environment-api/v2/settings/objects?validateOnly=true` (`settingsObjectsClient.postSettingsObjects` from `@dynatrace-sdk/client-classic-environment-v2`) | `settings:objects:write` | **Validate** in *Central enrichment rule* |
| POST | `/platform/classic/environment-api/v2/settings/objects?validateOnly=false` (same SDK method) | `settings:objects:write` | **Create rule** in *Central enrichment rule* |
| Intent | `sendIntent` to `dynatrace.notebooks` / `view-query` (`@dynatrace-sdk/navigation`) | none | **↗ Open in Notebook** |
| Intent | `sendIntent` to `dynatrace.dashboards` / `add-to-dashboard` | none | **↗ Add to Dashboard** |
| Link | `getIntentLink` per entity type (see the Overview link table above) | none | Building the **Open overview ↗** links of the search results |

Details:

- **DQL execution.** [`useDql.ts`](../ui/app/useDql.ts) wraps the SDK hook `useDql(query, { enabled: true })`. The SDK
  starts the query with `query:execute`, polls `query:poll` until the result is complete, and may cancel a running
  query (`POST /platform/storage/query/v1/query:cancel`) when it is superseded. The app reads `records` from the
  result; the error text comes from the SDK error's `message`.
- **Create the enrichment rule** (`submitEnrichmentRule` in
  [`remediation.ts`](../ui/app/remediation.ts#L111-L122)). The SDK sends `Content-Type: application/json` and accepts
  HTTP 200 and 207. Request body (fixed value for every host and process):

  ```json
  [
    {
      "schemaId": "builtin:ingest.enrichment.config",
      "scope": "environment",
      "value": {
        "type": "CUSTOM",
        "target": "dt.security_context",
        "valueSource": "finance-prod"
      }
    }
  ]
  ```

  Response fields used: the first element's `code`; when it is 400 or higher, `error.message` (or "Rejected (HTTP
  *code*)."); on success, `objectId` (shown as "ID: …" after a create). When the SDK throws (schema validation
  failed, forbidden, server error), the message is taken from the error's data: each object's `error.message` (or
  its `error.details[].message`), joined with " | "; otherwise the error envelope's `error.message`; otherwise the
  exception message (`errorMessage` in [`remediation.ts`](../ui/app/remediation.ts#L98-L109)).
- **Notebook / Dashboard intents** ([`components.tsx`](../ui/app/components.tsx#L209-L212)): payload
  `{ "dt.query": "<query text>", "title": "<section title>" }`, with the titles *Security context coverage* (Q1) and
  *Security context search* (Q2). The intent IDs were read from the tenant with `dtctl get intents` (code comment).
- **Copy** buttons use the browser clipboard (`navigator.clipboard.writeText`); no request is sent.

## Remediation actions

The section is rendered by `RemediationPanel` with `tab="security"`
([`RemediationPanel.tsx`](../ui/app/RemediationPanel.tsx#L1114-L1209)). It has the anchor id `remediation-security`
so the Entity Overview can jump to it.

### Action picker and impact line

- **Impact line** under the heading: "*N* entities without security context.", where *N* is the sum of
  `total - security` over every entity type in Q1 (thousands separators; "1 entity" in the singular). Hosts,
  processes, containers and so on are counted separately, so one host with 10 processes that all lack the field adds
  11.
- **Action** select (top right), options in this order; the first is preselected:

| Option label | Kind | What it fixes |
| --- | --- | --- |
| API · Central enrichment rule | Writes to the tenant | Sets `dt.security_context` on every entity a rule matches, centrally. |
| Manual · Host tag with oneagentctl | Command to run on a host | Sets `dt.security_context` on one host (and what runs on it) at the source. |
| Manual · Kubernetes annotation | kubectl / YAML | Sets `dt.security_context` on a Kubernetes namespace, workload or pod. |

Switching the action replaces the form below it and resets the form's inputs. Under each action, a row
**Documentation for this fix:** lists the Dynatrace pages for its mechanism (links open in a new browser tab).

### API: Central enrichment rule

**What it fixes.** Entities without a security context, for every entity that the rule matches. It creates one
settings object of the schema `builtin:ingest.enrichment.config` at environment scope, with
`target = "dt.security_context"` (`EnrichmentRuleForm` in
[`RemediationPanel.tsx`](../ui/app/RemediationPanel.tsx#L197-L304), request builders in
[`remediation.ts`](../ui/app/remediation.ts#L17-L122)). The target is fixed on this tab, so no *Field* select is
shown.

**When it is offered.** Always, as the first action of the section.

**Form fields:**

| Field | Shown when | Options / input | Goes to |
| --- | --- | --- | --- |
| **Source** | Always | *Fixed value (Custom)* (default), *Host/process property*, *Kubernetes namespace label*, *Kubernetes namespace annotation*, *Kubernetes workload label*, *Kubernetes workload annotation*, *Kubernetes pod label*, *Kubernetes pod annotation*, *AWS tag*, *Azure tag*, *GCP label*, *GCP tag* | `value.type`: `CUSTOM`, `HOST_PROCESS_PROPERTY`, `K8S_NAMESPACE_LABEL`, `K8S_NAMESPACE_ANNOTATION`, `K8S_WORKLOAD_LABEL`, `K8S_WORKLOAD_ANNOTATION`, `K8S_POD_LABEL`, `K8S_POD_ANNOTATION`, `AWS_TAG`, `AZURE_TAG`, `GCP_LABEL`, `GCP_TAG` |
| **Applies to** | Source is *Fixed value (Custom)* or *Host/process property* (the code comment: "Per the central enrichment reference, conditions apply to host/process and custom rules only") | *All hosts / processes* (default), *Host name pattern*, *Custom condition* | Whether and how `value.condition` is set |
| Source value, labelled per source: **Value to apply** (Custom, placeholder "e.g. finance-prod"), **Property key** (host/process property, "e.g. team"), **Label key** (Kubernetes labels, "e.g. team" or "e.g. app.kubernetes.io/part-of" for workloads), **Annotation key** (Kubernetes annotations, "e.g. owner"), **Tag key** (AWS / Azure tags, "e.g. CostCenter"; GCP tag, "e.g. cost-center"), **Label key** (GCP label, "e.g. cost-center") | Always | Free text, trimmed | `value.valueSource`: the fixed value (Custom) or the key whose value is copied into `dt.security_context` |
| **Host name pattern** | *Applies to* = *Host name pattern* | Free text, placeholder "prod-*" | `value.condition = matchesValue(host.name, "<pattern>")` (pattern trimmed, inserted as typed) |
| **Condition** | *Applies to* = *Custom condition* | Free text, placeholder `matchesValue(host.name, "prod-*")` | `value.condition`, trimmed, as typed |

With *All hosts / processes*, or with a Kubernetes or cloud source, no `condition` is sent.

**Client-side checks** (`checkEnrichmentInput` and the pattern check). While a check fails, **Validate** and
**Create rule** are disabled; the message is shown in red once the source value is not empty:

| Rule | Message |
| --- | --- |
| Source value empty | "*<field label>* is required." (for example "Value to apply is required."); buttons disabled, message hidden while the field is empty |
| Source value longer than 2048 characters | "Value source must be at most 2048 characters." |
| Source value contains whitespace and the source is not *Custom* | "Keys cannot contain whitespace." |
| Condition longer than 500 characters | "Condition must be at most 500 characters." |
| *Host name pattern* chosen and the pattern is empty | "Enter a host name pattern." |

**Request preview.** A collapsible **Request (1 API call, environment scope)** shows the exact JSON body that will
be sent, pretty-printed, with a **Copy** button. It updates as you type.

**Validate.** Sends the body with `validateOnly=true`:
`POST /platform/classic/environment-api/v2/settings/objects?validateOnly=true`. The tenant validates the object
against the schema without saving it. Result line (green): "Validation passed. The rule is valid and nothing was
saved."; or (red) the rejection message. Validate is optional; Create rule does not require it.

**Confirmation and Create rule.** Tick **Create this rule in the tenant**, then click **Create rule** (disabled until
the box is ticked). Any change to the form clears the result and unticks the box. Create sends
`POST /platform/classic/environment-api/v2/settings/objects?validateOnly=false` with the same body.

- **Success:** green "Rule created." with "ID: *objectId*" of the new settings object, and the confirmation box is
  unticked. The form keeps its values; ticking the box and clicking again creates a second rule.
- **Failure:** red result line with the message (see [API calls](#api-calls)); the confirmation box is unticked.
- A hint under the buttons: "One rule covers every matching entity. OneAgent applies it in ~5 min; Kubernetes pods
  need a restart." The gauges change after the entities report the new value and Q1 runs again (reload the app or
  change the timeframe).

**Request body examples** (generated with `buildEnrichmentBody`):

Fixed value `finance-prod` for hosts whose name matches `prod-*` (*Applies to* = *Host name pattern*):

```json
[
  {
    "schemaId": "builtin:ingest.enrichment.config",
    "scope": "environment",
    "value": {
      "type": "CUSTOM",
      "target": "dt.security_context",
      "valueSource": "finance-prod",
      "condition": "matchesValue(host.name, \"prod-*\")"
    }
  }
]
```

Copy the value of the Kubernetes namespace label `team` (no condition is possible):

```json
[
  {
    "schemaId": "builtin:ingest.enrichment.config",
    "scope": "environment",
    "value": {
      "type": "K8S_NAMESPACE_LABEL",
      "target": "dt.security_context",
      "valueSource": "team"
    }
  }
]
```

**Documentation for this fix:**
[Ingest enrichment rules](https://docs.dynatrace.com/docs/manage/tags/tags-central-enrichment),
[OneAgent primary tags](https://docs.dynatrace.com/docs/manage/tags/primary-tags/tags-domain-oneagent),
[Kubernetes primary tags](https://docs.dynatrace.com/docs/manage/tags/primary-tags/tags-domain-k8s),
[Primary Grail fields and tags](https://docs.dynatrace.com/docs/manage/tags/primary-tags).

### Manual: Host tag with oneagentctl

**What it fixes.** A host (and the entities on it) without a security context, set at the source with OneAgent's
command-line tool (`hostTagsAction("dt.security_context", "confidential")` in
[`remediation.ts`](../ui/app/remediation.ts#L438-L448)). Nothing is sent from the app.

**Variant** select: *Linux / AIX* (default) or *Windows*. Each variant shows the command with a **Copy** button:

```bash
./oneagentctl --set-host-tag="dt.security_context=confidential"
```

```powershell
.\oneagentctl.exe --set-host-tag="dt.security_context=confidential"
```

Replace `confidential` with your security context value.

**Steps** (as shown):

1. Open an elevated shell in the OneAgent tools directory.
2. Run the command.
3. Check with `--get-host-tags`.

**Notes** (collapsed):

- Values: no whitespace or extra '=', max 256 characters.
- Precedence: process DT_TAGS > host tag > central enrichment rule.

**Documentation for this fix:**
[OneAgent primary tags](https://docs.dynatrace.com/docs/manage/tags/primary-tags/tags-domain-oneagent),
[oneagentctl reference](https://docs.dynatrace.com/docs/ingest-from/dynatrace-oneagent/oneagent-configuration-via-command-line-interface).

### Manual: Kubernetes annotation

**What it fixes.** Kubernetes namespaces, workloads or pods (and the data from them) without a security context,
set with a `metadata.dynatrace.com/` annotation (`k8sAnnotationAction("dt.security_context", "team-a")` in
[`remediation.ts`](../ui/app/remediation.ts#L450-L464)). Nothing is sent from the app.

**Variant** select with three variants, each with a **Copy** button:

*kubectl* (default):

```bash
kubectl annotate namespace <namespace> metadata.dynatrace.com/dt.security_context=team-a --overwrite
```

*YAML* (to add to the object's manifest):

```yaml
metadata:
  annotations:
    metadata.dynatrace.com/dt.security_context: team-a
```

*DynaKube prerequisite*:

```yaml
spec:
  metadataEnrichment:
    enabled: true
```

Replace `<namespace>` and `team-a` with your namespace and value.

**Steps** (as shown):

1. Enable `spec.metadataEnrichment` in the DynaKube.
2. Annotate the namespace (or workload / pod).
3. Restart affected pods; verify with `kubectl get pod -o yaml`.

**Notes** (collapsed):

- Pod > workload > namespace. Workload level needs Operator 1.11.0+ and ActiveGate 1.347+.
- Annotations > DynaKube resource attributes > central rules. Classic Full Stack is not supported.

**Documentation for this fix:**
[Kubernetes primary tags](https://docs.dynatrace.com/docs/manage/tags/primary-tags/tags-domain-k8s),
[Ingest enrichment rules](https://docs.dynatrace.com/docs/manage/tags/tags-central-enrichment).

## AI Assist on this page

When **AI Assist** is on, an *AI Insights* panel opens at the top of the tab. Its content is computed by
`analyzeFieldCoverage("Security context", rows)` in [`analyses.ts`](../ui/app/analyses.ts#L46-L73), where `rows` are
the security rows of Q1 (one per entity type with entities). It is rule-based and runs locally in the browser on the
data already on screen; no model or external service is called. The text appears word by word (an animation only).

**Summary:** "Security context: *P* of *T* entity checks are in place (*O*%). *F* combination(s) fully covered, *E*
with no coverage at all." Here *P* and *T* are the sums of `part` and `total` over all entity types, and
*O* = `Math.round(P / T * 100)`: a coverage weighted by entity count, which differs from the unweighted mean the
Entity Overview shows. *F* counts entity types at 100% (`part == total`), *E* those at 0 (`part == 0`).

**Insights** (severity colours: green good, orange warning, red critical, blue info):

| Insight | Condition | Severity |
| --- | --- | --- |
| "Fully covered: *TYPE* security context, …" (first 5) | At least one entity type with every entity in place | good |
| "No coverage: *TYPE* security context (0/*total*), …" (first 5) | At least one entity type with none in place | critical |
| "Largest gap: *N* *TYPE* entities missing security context." | The entity type with the most entities missing the field (`total - part`) | By that type's percentage: good at 90% or more, warning at 50–89%, critical below 50% |
| "Combined coverage for this view is *O*%." | Always | By *O*: good / warning / critical with the same thresholds |

*TYPE* is the raw Smartscape type, for example `HOST` or `K8S_POD`.

**Recommendations:**

| Impact | Text | Condition |
| --- | --- | --- |
| high | "Start with the zero-coverage combinations — a single rule or host property usually fixes the whole group." | At least one entity type at 0 |
| medium | "Use “Find entities missing a field” for *TYPE* / Security context to see exactly which entities to fix." | There is a largest gap. On this tab, use the entity search with **Match** = *Is missing* and that entity type. |
| low | "Use Open in Notebook on a query to share or extend the check with your customer." | Always |

**No data:** when Q1 has no rows yet (still loading, failed, or no entities), the panel shows "No coverage data is
available for security context in this timeframe.", the info insight "No entities returned. Widen the timeframe or
check the data source." and the medium recommendation "Confirm entities are being monitored, then re-check."

## Limitations and edge cases

- **Rounding to 100% or 0%.** Percentages are rounded to integers. 199 of 200 entities (99.5%) shows 100%, and is
  then not a Top finding on the Entity Overview (only checks below 100 are). The detail line under the gauge always
  shows the exact counts.
- **Timeframe semantics.** A node counts when it existed in the timeframe. With 7 or 30 days, entities that are gone
  (decommissioned hosts, finished or replaced pods) count too and can lower the percentage after a fix. A rule
  created today does not change the history of entities that no longer report.
- **Search results keep their timeframe.** The search uses the timeframe of the moment you clicked **Search
  entities**; changing the timeframe afterwards does not re-run it.
- **500-row cap.** The search returns the first 500 entities by name. For larger sets, narrow by entity type or name,
  or open the query in a Notebook and change the `limit`.
- ***Contains* is a text match on the whole array.** `contains(toString(dt.security_context), …)` can match across
  values or on the array's punctuation. *Equals* is an exact, case-sensitive element match.
- **Overview links open without a timeframe.** The target app uses its own default timeframe, so an entity seen only
  earlier in a 7- or 30-day window can show no data there.
- **Impact line while loading.** The impact line is computed from Q1; while Q1 loads or after it failed it reads
  "0 entities without security context."
- **Counts across entity types overlap.** The impact line and the AI summary add up hosts, processes, containers,
  Kubernetes objects and services; the same workload appears as several entities.
- **No duplicate check for rules.** The enrichment form does not read existing `builtin:ingest.enrichment.config`
  objects; it does not warn when a similar rule exists, and creating twice creates two objects (unless the tenant
  rejects it).
- **Host name pattern is not escaped.** The pattern is inserted between double quotes as typed; a pattern containing
  `"` produces an invalid condition, which Validate reports.
- **Conditions only for Custom and host/process property sources.** Kubernetes and cloud sources cannot be limited by
  a condition in this form.
- **Frontends are not covered.** The coverage query reads the 9 Smartscape entity types listed above. Frontends,
  synthetic monitors and other classic entities are not counted on this tab.

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| *Query failed* box instead of gauges, mentioning a permission or scope | The user lacks permission to read Smartscape data (`storage:smartscape:read`) | Grant the permission in IAM; the app scope is already declared. |
| "No entities found for this timeframe." | No Smartscape nodes of the 9 types in the timeframe | Widen the timeframe; confirm OneAgents, Kubernetes monitoring or cloud integrations report. |
| All gauges at 0% although rules exist | The rule does not match these entities, or the entities have not reported since the rule was created | Search *Has a value* to see which entities carry it; check the rule's source key and condition; wait about 5 minutes for OneAgent, restart Kubernetes pods. |
| A gauge stays below 100% after a fix with 7 or 30 days | Entities that existed earlier in the window still count | Compare with *Last 24 hours*; list the remaining ones with *Is missing*. |
| Validate or Create rule: red message about permissions (for example HTTP 403 / forbidden) | The user may not write `builtin:ingest.enrichment.config` settings | Grant `settings:objects:write` for the schema (or `environment:roles:manage-settings`). |
| Validate: red schema message | The value, key or condition is not accepted by the schema (for example an invalid DQL condition) | Fix the input as the message says; check the condition in a Notebook first. |
| Validate and Create rule are greyed out | A client-side check fails (empty value, whitespace in a key, empty host name pattern) or a request is running | Read the red message under the request preview and correct the field. |
| Create rule stays greyed out after Validate | The confirmation box is not ticked (it is unticked after every change) | Tick **Create this rule in the tenant**. |
| Kubernetes annotation has no effect | Metadata enrichment is not enabled in the DynaKube, pods were not restarted, or the cluster uses classic full-stack | Apply the *DynaKube prerequisite*, restart the pods, check the pod annotations with `kubectl get pod -o yaml`. |
| Search with *Equals* finds nothing although the value is visible | *Equals* is case-sensitive and matches whole elements only | Use *Contains* (case-insensitive substring). |
| Open overview link does nothing or shows "—" | The intent link could not be built for the type, or the target app is not available to the user | Open the entity from the Entity ID in the respective app. |

## Related pages

- [Index](README.md): app shell, timeframe, gauges, query actions and remediation section in general.
- [Entity Overview](entity-overview.md): Overall readiness, the *Security context* summary gauge and Top 5 findings
  built from the same checks.
- [Cost allocation](cost-allocation.md): the same layout and remediation for `dt.cost.costcenter` and
  `dt.cost.product`.
- [Data Overview](data-overview.md): security context on metric series, logs, events and business events.
- [Primary tags](primary-tags.md): the same central enrichment rule form for `primary_tags.<name>`.
- [Host groups](host-groups.md) and [Ownership & Teams](ownership-and-teams.md): other tabs fed by the same coverage
  query.
- [IAM Boundary Creator](iam-boundary-creator.md): build policy boundaries, which can use security context values.

## Source files

| File | Role on this page |
| --- | --- |
| [`ui/app/App.tsx`](../ui/app/App.tsx) | Runs Q1 once for the app, renders this tab (`FieldCoverageTab` + `RemediationPanel tab="security"`), timeframe and AI Assist toggle, jump to the remediation section. |
| [`ui/app/areas.tsx`](../ui/app/areas.tsx) | Tab id `security`, title, area Metadata, documentation link. |
| [`ui/app/tabs/CoverageTabs.tsx`](../ui/app/tabs/CoverageTabs.tsx) | `FieldCoverageTab`, `SECURITY_FOCUS`, `toCoverageRows`, `TypeGaugeGrid`; Top findings logic used by the Entity Overview. |
| [`ui/app/tabs/EntitySearch.tsx`](../ui/app/tabs/EntitySearch.tsx) | Entity search form and results columns. |
| [`ui/app/queries.ts`](../ui/app/queries.ts) | `coverageQuery`, `entitySearchQuery`, `dqlString`, `PRIMARY_FIELDS`, `ENTITY_TYPES`, `ENTITY_LABELS`, `fieldApplies`, `TIMEFRAMES`. |
| [`ui/app/components.tsx`](../ui/app/components.tsx) | `PctGauge`, `statusColor`, `pct`, `QueryState`, `QueryActions`, `DrillDownTable`, `ShowEntitiesButton`. |
| [`ui/app/useDql.ts`](../ui/app/useDql.ts) | Wrapper around the SDK `useDql` hook. |
| [`ui/app/links.ts`](../ui/app/links.ts) | `entityOverviewLink`: intent links for the Overview column. |
| [`ui/app/RemediationPanel.tsx`](../ui/app/RemediationPanel.tsx) | Remediation section, impact line, action picker, `EnrichmentRuleForm`, `ManualActionView`. |
| [`ui/app/remediation.ts`](../ui/app/remediation.ts) | Enrichment schema, source types, body builder, input checks, `submitEnrichmentRule`, error messages, manual actions and documentation links. |
| [`ui/app/navigation.tsx`](../ui/app/navigation.tsx) | Remediation anchor id `remediation-security`. |
| [`ui/app/AIInsights.tsx`](../ui/app/AIInsights.tsx) | AI Insights panel and `useAIInsights`. |
| [`ui/app/analyses.ts`](../ui/app/analyses.ts) | `analyzeFieldCoverage`: AI Assist rules. |
| [`app.config.json`](../app.config.json) | Scopes `storage:smartscape:read` and `settings:objects:write`. |
