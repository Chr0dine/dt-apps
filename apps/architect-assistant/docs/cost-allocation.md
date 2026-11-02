# Cost allocation

The **Cost allocation** tab measures how many monitored entities carry the primary Grail fields
`dt.cost.costcenter` (cost center) and `dt.cost.product` (cost product), per entity type (hosts, processes,
services, containers and Kubernetes clusters, nodes, namespaces, deployments and pods). It shows one tile per field
with a gauge per entity type, lets you search entities that have, lack or carry a specific cost center or cost
product, and ends with a **Remediation actions** section that can create a central ingest enrichment rule
(`builtin:ingest.enrichment.config`) for either field in the tenant, or gives the manual `oneagentctl` and Kubernetes
annotation steps that set it at the source.

| | |
| --- | --- |
| Area | Metadata (see [index](README.md)) |
| Tab id | `cost` |
| Counts toward Entity Overview readiness / Top findings | Yes. Every entity type with at least one entity contributes one *Cost center* and one *Cost product* check (up to 18) to Overall readiness on the Entity Overview; the Entity Overview *Cost center* and *Cost product* summary gauges are the rounded means of those checks; each check below 100% is a Top 5 findings candidate whose **Remediation steps** button opens this tab's Remediation actions. |
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
  - [Cost center and Cost product tiles](#cost-center-and-cost-product-tiles)
  - [Query actions for the coverage query](#query-actions-for-the-coverage-query)
  - [Search entities by cost allocation](#search-entities-by-cost-allocation)
  - [Search results table](#search-results-table)
  - [Remediation actions section](#remediation-actions-section)
- [Checks and scoring](#checks-and-scoring)
- [Queries](#queries)
  - [Q1. Primary field coverage](#q1-primary-field-coverage-coveragequery)
  - [Q2. Entity search by cost center or cost product](#q2-entity-search-by-cost-center-or-cost-product-entitysearchquery)
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

- **How much of the monitored estate is attributed to a cost center and a cost product?** One gauge per entity type
  and field shows the share of entities (Smartscape nodes seen in the selected timeframe) with a non-null
  `dt.cost.costcenter` or `dt.cost.product`.
- **Which entity types have no cost attribution at all?** A gauge at 0% (and an AI Assist "No coverage" insight).
- **Which entities are missing it, and which carry a given value?** The entity search lists entities that have a
  value, lack it, equal a value, or whose value contains a text, for either field, optionally narrowed to one entity
  type and a name fragment.
- **How do I fix it?** The Remediation actions section creates one central ingest enrichment rule per field (one rule
  covers every matching entity) or shows the per-host and per-Kubernetes-object commands.

The best practice it checks is stated on the tab itself (`COST_FOCUS.blurb` in
[`CoverageTabs.tsx`](../ui/app/tabs/CoverageTabs.tsx#L342-L347)):

> dt.cost.costcenter and dt.cost.product attribute consumption and cost to the right owner.

The Dynatrace documentation pages the code cites for this tab (in
[`remediation.ts`](../ui/app/remediation.ts#L413-L429), shown under **Documentation for this fix**):

- [Primary Grail fields and tags](https://docs.dynatrace.com/docs/manage/tags/primary-tags)
- [Ingest enrichment rules](https://docs.dynatrace.com/docs/manage/tags/tags-central-enrichment)
- [OneAgent primary tags](https://docs.dynatrace.com/docs/manage/tags/primary-tags/tags-domain-oneagent)
- [Kubernetes primary tags](https://docs.dynatrace.com/docs/manage/tags/primary-tags/tags-domain-k8s)
- [oneagentctl reference](https://docs.dynatrace.com/docs/ingest-from/dynatrace-oneagent/oneagent-configuration-via-command-line-interface)

**Frontends are deliberately not part of this tab.** The coverage query reads only the 9 Smartscape entity types
listed above, and the frontend checks of the app (RUM v2, Session Replay, synthetic monitors, user tagging, health
alerts, owning team; `CHECKS` in [`frontends.ts`](../ui/app/frontends.ts)) contain no cost check. Frontends (RUM
applications) cannot be cost-allocated: there is no setting and no OpenPipeline stage that sets `dt.cost.*` on RUM
frontends, so a frontend cost gauge could never be fixed and would only lower readiness.

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
  covers it.
- **For Open in Notebook / Add to Dashboard / Open overview:** access to the Notebooks, Dashboards,
  Infrastructure & Operations, Services and Kubernetes apps that the intents open.
- **For the manual actions:** shell access to the OneAgent host with elevated rights (`oneagentctl`), or `kubectl`
  rights to annotate namespaces, workloads or pods and to edit the DynaKube.

### One-time setup

None. The page uses no credential vault entry, no outbound connection and no OAuth client. The Kubernetes
annotation fix needs metadata enrichment enabled in the DynaKube (`spec.metadataEnrichment.enabled: true`); that is
a step of the manual action, not a setup of the app.

## Page walkthrough

The tab is rendered by `App.tsx` as `<FieldCoverageTab focus={COST_FOCUS}/>` followed by
`<RemediationPanel tab="cost"/>` ([`App.tsx`](../ui/app/App.tsx#L102-L108)). From top to bottom:

### Shell controls that affect this page

- **Cost allocation documentation** (top right of the tab): opens this page on GitHub
  (`TabDocsLink` in [`areas.tsx`](../ui/app/areas.tsx#L85-L94)).
- **Timeframe** select in the app header: *Last 24 hours* (default), *Last 7 days*, *Last 30 days*
  (`TIMEFRAMES` in [`queries.ts`](../ui/app/queries.ts#L6-L12)). It changes `from:now()-24h` in every query of this
  tab to `from:now()-7d` or `from:now()-30d`. With 7 or 30 days the header adds: "Longer timeframes also count
  entities that existed earlier in the window, including decommissioned ones."
- **AI Assist** toggle in the app header: when on, an *AI Insights* panel appears at the top of the tab
  (see [AI Assist on this page](#ai-assist-on-this-page)).
- Arriving from the **Entity Overview**: the (i) buttons on its *Cost center* and *Cost product* summary gauges and
  the **Remediation steps** button of a cost center or cost product Top finding switch to this tab and scroll to the
  Remediation actions section (anchor id `remediation-cost`; `goToRemediation` in
  [`App.tsx`](../ui/app/App.tsx#L58-L67) looks for the section every 100 ms, up to 16 tries).

### Heading and description

A level-3 heading **Cost allocation** and the description text quoted in
[What this page answers](#what-this-page-answers). Both are always shown, also while the data loads.

### Cost center and Cost product tiles

Two cards, one per field, in this order: **Cost center**, then **Cost product** (level-4 heading inside each card;
`TypeGaugeGrid` in [`CoverageTabs.tsx`](../ui/app/tabs/CoverageTabs.tsx#L89-L102), rendered once per key of
`COST_FOCUS.keys = ["costcenter", "product"]`). Each card has one gauge per entity type.

- **Order:** Hosts, Processes, Services, Containers, Kubernetes clusters, Kubernetes nodes, Kubernetes namespaces,
  Kubernetes deployments, Kubernetes pods (`ENTITY_TYPES` in [`queries.ts`](../ui/app/queries.ts#L17-L27)). An entity
  type with no entity in the timeframe has no gauge.
- **Caption:** the entity type title (`ENTITY_LABELS[type].title`).
- **Value:** `Math.round(costcenter / total * 100)` in the Cost center card and `Math.round(product / total * 100)`
  in the Cost product card, from the columns of the coverage query (Q1). An entity counts as *in place* when the
  field is not null (`isNotNull(dt.cost.costcenter)` / `isNotNull(dt.cost.product)`).
- **Detail line:** `<part> of <total>` with thousands separators in the browser's locale, for example `1,234 of 1,500`.
- **Look:** a custom SVG gauge (`PctGauge` in [`components.tsx`](../ui/app/components.tsx#L69-L134)), 188 px wide, a
  240-degree arc open at the bottom, filled with a gradient whose colour depends on the position on the scale: red
  at 0% through orange and yellow to green at 100% (`statusColor`: HSL hue `0` to `125`, saturation 78%, lightness
  46%). The number in the middle is the integer percentage. No (i) button and no click action.
- **Loading:** "Loading…" while the coverage query runs and has no result yet (`QueryState`, wraps both cards).
- **Error:** a red *Query failed* message box with the error text.
- **Empty:** "No entities found for this timeframe." in a card with no entity types.

### Query actions for the coverage query

A row of four buttons under the tiles (`QueryActions` in [`components.tsx`](../ui/app/components.tsx#L200-L246)),
titled *Cost allocation coverage*:

| Button | What it does |
| --- | --- |
| **Show DQL** / **Hide DQL** | Shows or hides the exact text of Q1 below the buttons. |
| **Copy** | Copies the query text to the clipboard; the label changes to *Copied* for 1.5 s. |
| **↗ Open in Notebook** | Sends the intent `view-query` to `dynatrace.notebooks` with the payload `{"dt.query": "<Q1 text>", "title": "Cost allocation coverage"}`. |
| **↗ Add to Dashboard** | Sends the intent `add-to-dashboard` to `dynatrace.dashboards` with the same payload. |

The query behind these buttons is the shared coverage query: it also counts the security context, host group and
ownership fields that other tabs use (see [Q1](#q1-primary-field-coverage-coveragequery)).

### Search entities by cost allocation

A card titled **Search entities by cost allocation** (`EntitySearch` in
[`EntitySearch.tsx`](../ui/app/tabs/EntitySearch.tsx)). Nothing runs until you click **Search entities**. The tab
passes two searchable properties, both scalar (`array: false`): Cost center (`dt.cost.costcenter`) and Cost product
(`dt.cost.product`).

| Control | Options | Effect on the query (Q2) |
| --- | --- | --- |
| **Property** | *Cost center* (default), *Cost product* | The field in the filter and in `fieldsAdd value = toString(<field>)`; also the header of the value column. |
| **Entity type** | *All applicable types* (default) or one of the 9 entity types | `smartscapeNodes` lists all 9 types or only the chosen one. |
| **Match** | *Has a value* (default), *Equals*, *Contains*, *Is missing* | The filter condition for the mode (see [Q2](#q2-entity-search-by-cost-center-or-cost-product-entitysearchquery)). |
| **Value** (only for *Equals* and *Contains*) | Free text, placeholder "Value to match"; trimmed | *Equals*: `toString(<field>) == "<value>"`. *Contains*: `contains(toString(<field>), "<value>", caseSensitive:false)`. |
| **Name contains (optional)** | Free text, placeholder "e.g. prod-"; trimmed | When not empty, adds `contains(name, "<text>", caseSensitive:false)` as the first filter condition. |
| **Search entities** | Button | Builds Q2 with the current timeframe and inputs and shows the results. With *Equals* or *Contains* and an empty value, the click does nothing. |

Changing any control hides the current results; click **Search entities** again. Values are embedded as DQL string
literals: wrapped in double quotes, with backslashes and double quotes escaped (`dqlString` in
[`queries.ts`](../ui/app/queries.ts#L155)).

### Search results table

Shown under the search card after a search (`DrillDownTable` in
[`components.tsx`](../ui/app/components.tsx#L253-L285)).

- **Query actions** above the table, titled *Cost center search* or *Cost product search*.
- **Columns:**

| Column | Source field | Meaning |
| --- | --- | --- |
| Name | `name` | Entity name. |
| Type | `type` | Smartscape node type, for example `HOST`, `K8S_POD`. |
| Entity ID | `id` | Smartscape node ID. |
| Cost center / Cost product | `value` = `toString(dt.cost.costcenter)` or `toString(dt.cost.product)` | The value; empty when the entity has none. |
| Overview | built from `type` and `id` | **Open overview ↗** opens the entity's overview page in a new browser tab; "—" when no link can be built. |

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

  The timeframe is not passed to the link, so the target app opens on its own default timeframe.
- **Sorting and size:** rows arrive sorted by name; every column header re-sorts the loaded rows in the browser. At
  most 500 rows, all in one table (no paging), condensed density. When exactly 500 rows come back, "Showing the
  first 500 entities." appears under the table.
- **Loading / error / empty:** "Loading…"; a *Query failed* box; "No entities match this search."

### Remediation actions section

A card titled **Remediation actions** at the bottom of the tab, with an impact line, an **Action** select and the
form of the selected action. See [Remediation actions](#remediation-actions).

## Checks and scoring

| Check | In place when | Numerator | Denominator | Severity / thresholds | Notes |
| --- | --- | --- | --- | --- | --- |
| Cost center on *<entity type>* (one per type with entities) | `isNotNull(dt.cost.costcenter)` on the Smartscape node | `costcenter` column of Q1 | `total` column of Q1 for that type | No status labels on this tab; colour from red (0%) to green (100%). AI Assist: *good* at 90% or more, *warning* at 50–89%, *critical* below 50%. | `pct = Math.round(part / total * 100)` |
| Cost product on *<entity type>* (one per type with entities) | `isNotNull(dt.cost.product)` | `product` column of Q1 | `total` column of Q1 | Same | Same |

Derived values outside the gauges:

| Derived value | Where | Rule |
| --- | --- | --- |
| *Cost center* and *Cost product* summary gauges | Entity Overview | `Math.round(mean(pct))` over the checks of that field: an unweighted mean of the per-type percentages. |
| Overall readiness | Entity Overview | Unweighted mean of every check of every primary field plus frontend readiness when frontends exist; each cost check counts once. |
| Top 5 findings | Entity Overview | Every cost check with `pct < 100` is a candidate, ranked by entity importance (hosts, Kubernetes nodes, clusters, frontends, containers, Kubernetes namespaces / deployments / pods, then processes and services), then by `(100 - pct) * log10(total + 10)`; at most 2 per entity type and 5 in total. Text: "None of the *N* *hosts* have a cost center." / "Only *P*% of *hosts* have a cost product (*part* of *total*)." The button opens this tab's Remediation actions. |
| Impact line | This tab, Remediation actions | "*N* entities without a cost center, *M* entities without a cost product.": sums of `total - part` over all entity types per field. |

## Queries

| # | Name (function in source) | Runs when | Feeds |
| --- | --- | --- | --- |
| Q1 | Primary field coverage (`coverageQuery` in [`queries.ts`](../ui/app/queries.ts#L76-L84)) | At app start (whatever tab is open) and on every timeframe change; one shared result for the whole app | Both tiles, impact line, AI Assist; also Entity Overview, Security context, Ownership & Teams and other remediation sections |
| Q2 | Entity search (`entitySearchQuery` in [`queries.ts`](../ui/app/queries.ts#L157-L172)) | When you click **Search entities** | Search results table |

`missingEntitiesQuery` in [`queries.ts`](../ui/app/queries.ts#L86-L92) is defined but not used anywhere in the app.

### Q1. Primary field coverage (`coverageQuery`)

- **Source:** `coverageQuery(tf)` in [`ui/app/queries.ts`](../ui/app/queries.ts#L76-L84), executed once in
  [`App.tsx`](../ui/app/App.tsx#L50-L52) with `useDql(coverageQuery(tf))` and passed to this tab as `coverage`.
- **Runs:** at page start, independent of the tab you open, and again when the timeframe changes. Opening this tab
  does not run it again.
- **Parameters:** `tf`: `from:now()-24h` becomes `from:now()-7d` or `from:now()-30d`; nothing else changes.
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
  1. `smartscapeNodes "HOST", …, "K8S_POD", from:now()-24h` reads the Smartscape nodes of the 9 entity types that
     existed in the timeframe. Each node carries its primary Grail fields as plain fields, so no logs, metrics or
     events are scanned. With 7 or 30 days, nodes that existed only earlier in the window count too.
  2. `summarize … by:{type}` produces one record per entity type:
     - `total = count()`: all nodes of the type.
     - `costcenter = countIf(isNotNull(dt.cost.costcenter))` and `product = countIf(isNotNull(dt.cost.product))`:
       nodes where the field has any value. These are the two columns this tab reads.
     - `security`: nodes whose `dt.security_context` array has at least one element (Security context tab).
     - `hostgroup`: nodes with a `dt.host_group.id` (Host groups).
     - `owner`: nodes where any of the keys `dt.owner`, `owner`, `team` is set in host properties, process metadata,
       Kubernetes labels or annotations; `coalesce` returns the first non-null one (Ownership & Teams).
- **Output:** up to 9 records with `type`, `total`, `security`, `costcenter`, `product`, `hostgroup`, `owner`. This
  tab uses `type`, `total`, `costcenter` and `product`: the gauges of both tiles, the impact line and AI Assist.
- **Limits and cost:** at most 9 result records, no `limit` needed. Per the code comment in `queries.ts`,
  `smartscapeNodes` is used because it is cheap and carries the primary Grail fields on each entity.
- **Open it yourself:** yes, the Query actions under the tiles (*Cost allocation coverage*).

### Q2. Entity search by cost center or cost product (`entitySearchQuery`)

- **Source:** `entitySearchQuery(tf, types, field, mode, value, name)` in
  [`ui/app/queries.ts`](../ui/app/queries.ts#L157-L172), called from
  [`EntitySearch.tsx`](../ui/app/tabs/EntitySearch.tsx#L131-L137) on **Search entities**, run by `DrillDownTable`.
- **Runs:** only on the button click, with the timeframe selected at that moment; it does not re-run when the
  timeframe changes later.
- **Parameters:**

| Input | Values | Effect on the text |
| --- | --- | --- |
| `tf` | `24h`, `7d`, `30d` | `from:now()-24h` / `-7d` / `-30d`. |
| `types` | All 9 types or one | The list after `smartscapeNodes`. |
| `field` | `{ key: "costcenter", expr: "dt.cost.costcenter", array: false }` or `{ key: "product", expr: "dt.cost.product", array: false }` (the **Property** select) | The field in the filter and in `fieldsAdd value = toString(<field>)`. |
| `mode` | `has`, `equals`, `contains`, `missing` | The filter condition. |
| `value` | Trimmed text (*Equals*, *Contains*) | Escaped DQL string. |
| `name` | Trimmed text, optional | `contains(name, "<name>", caseSensitive:false) and …` in front of the mode condition. |

**Cost center**, all types, 24 hours:

*Has a value* (the default search):

```dql
smartscapeNodes "HOST", "PROCESS", "SERVICE", "CONTAINER", "K8S_CLUSTER", "K8S_NODE", "K8S_NAMESPACE", "K8S_DEPLOYMENT", "K8S_POD", from:now()-24h
| filter isNotNull(dt.cost.costcenter)
| fieldsAdd value = toString(dt.cost.costcenter)
| fields id, name, type, value
| sort name asc
| limit 500
```

*Is missing*:

```dql
smartscapeNodes "HOST", "PROCESS", "SERVICE", "CONTAINER", "K8S_CLUSTER", "K8S_NODE", "K8S_NAMESPACE", "K8S_DEPLOYMENT", "K8S_POD", from:now()-24h
| filter isNull(dt.cost.costcenter)
| fieldsAdd value = toString(dt.cost.costcenter)
| fields id, name, type, value
| sort name asc
| limit 500
```

*Equals* `cc-1234`:

```dql
smartscapeNodes "HOST", "PROCESS", "SERVICE", "CONTAINER", "K8S_CLUSTER", "K8S_NODE", "K8S_NAMESPACE", "K8S_DEPLOYMENT", "K8S_POD", from:now()-24h
| filter toString(dt.cost.costcenter) == "cc-1234"
| fieldsAdd value = toString(dt.cost.costcenter)
| fields id, name, type, value
| sort name asc
| limit 500
```

*Contains* `1234`:

```dql
smartscapeNodes "HOST", "PROCESS", "SERVICE", "CONTAINER", "K8S_CLUSTER", "K8S_NODE", "K8S_NAMESPACE", "K8S_DEPLOYMENT", "K8S_POD", from:now()-24h
| filter contains(toString(dt.cost.costcenter), "1234", caseSensitive:false)
| fieldsAdd value = toString(dt.cost.costcenter)
| fields id, name, type, value
| sort name asc
| limit 500
```

**Cost product**, all types, 24 hours:

*Has a value*:

```dql
smartscapeNodes "HOST", "PROCESS", "SERVICE", "CONTAINER", "K8S_CLUSTER", "K8S_NODE", "K8S_NAMESPACE", "K8S_DEPLOYMENT", "K8S_POD", from:now()-24h
| filter isNotNull(dt.cost.product)
| fieldsAdd value = toString(dt.cost.product)
| fields id, name, type, value
| sort name asc
| limit 500
```

*Is missing*:

```dql
smartscapeNodes "HOST", "PROCESS", "SERVICE", "CONTAINER", "K8S_CLUSTER", "K8S_NODE", "K8S_NAMESPACE", "K8S_DEPLOYMENT", "K8S_POD", from:now()-24h
| filter isNull(dt.cost.product)
| fieldsAdd value = toString(dt.cost.product)
| fields id, name, type, value
| sort name asc
| limit 500
```

*Equals* `checkout`:

```dql
smartscapeNodes "HOST", "PROCESS", "SERVICE", "CONTAINER", "K8S_CLUSTER", "K8S_NODE", "K8S_NAMESPACE", "K8S_DEPLOYMENT", "K8S_POD", from:now()-24h
| filter toString(dt.cost.product) == "checkout"
| fieldsAdd value = toString(dt.cost.product)
| fields id, name, type, value
| sort name asc
| limit 500
```

*Contains* `check`:

```dql
smartscapeNodes "HOST", "PROCESS", "SERVICE", "CONTAINER", "K8S_CLUSTER", "K8S_NODE", "K8S_NAMESPACE", "K8S_DEPLOYMENT", "K8S_POD", from:now()-24h
| filter contains(toString(dt.cost.product), "check", caseSensitive:false)
| fieldsAdd value = toString(dt.cost.product)
| fields id, name, type, value
| sort name asc
| limit 500
```

**Narrowed searches** (one entity type, name filter, other timeframe):

Cost center *Is missing*, entity type *Hosts*, name contains `prod-`, 7 days:

```dql
smartscapeNodes "HOST", from:now()-7d
| filter contains(name, "prod-", caseSensitive:false) and isNull(dt.cost.costcenter)
| fieldsAdd value = toString(dt.cost.costcenter)
| fields id, name, type, value
| sort name asc
| limit 500
```

Cost product *Equals* `my "quoted" value`, entity type *Kubernetes namespaces*, name contains `prod-`, 24 hours
(shows the escaping):

```dql
smartscapeNodes "K8S_NAMESPACE", from:now()-24h
| filter contains(name, "prod-", caseSensitive:false) and toString(dt.cost.product) == "my \"quoted\" value"
| fieldsAdd value = toString(dt.cost.product)
| fields id, name, type, value
| sort name asc
| limit 500
```

- **How it works:**
  1. `smartscapeNodes <types>, from:now()-<tf>`: the selected entity types, nodes that existed in the timeframe.
  2. `filter <conditions>`: joined with `and`, the optional name condition first.
     - *Has a value*: `isNotNull(<field>)`, the same predicate as the gauge numerator.
     - *Is missing*: `isNull(<field>)`, its complement.
     - *Equals*: `toString(<field>) == "<value>"`, exact and case-sensitive.
     - *Contains*: `contains(toString(<field>), "<value>", caseSensitive:false)`, case-insensitive substring.
     - Name: `contains(name, "<text>", caseSensitive:false)`.
  3. `fieldsAdd value = toString(<field>)`: the value as text for the table.
  4. `fields id, name, type, value`; 5. `sort name asc` (before the limit); 6. `limit 500`.
- **Output:** `id`, `name`, `type`, `value` → Entity ID, Name, Type, Cost center / Cost product; `type` and `id`
  also build the Overview link.
- **Limits and cost:** 500 rows (the first 500 by name); Smartscape read, no sampling or scan cap needed.
- **Open it yourself:** yes, the Query actions above the results (*Cost center search* / *Cost product search*).

### Client-side processing

1. **Rows from Q1** (`toCoverageRows` in [`CoverageTabs.tsx`](../ui/app/tabs/CoverageTabs.tsx#L41-L58)): records are
   indexed by `type`; for each entity type in `ENTITY_TYPES` order (types without a record or with `total` 0 are
   skipped) and each primary field that applies (cost center and cost product apply to all 9 types,
   `fieldApplies` in [`queries.ts`](../ui/app/queries.ts#L69-L70)), one row `{ type, field, label, part, total, pct }`,
   `part = Number(record[field])` (non-numeric becomes 0), `pct = Math.round(part / total * 100)`.
2. **Focus filter** (`FieldCoverageTab`, [`CoverageTabs.tsx`](../ui/app/tabs/CoverageTabs.tsx#L302-L332)): only rows
   with `field` `costcenter` or `product` are kept; they drive both tiles and AI Assist.
3. **Search properties and types:** two fields (Cost center first) and all 9 entity types.
4. **Impact line** ([`RemediationPanel.tsx`](../ui/app/RemediationPanel.tsx#L1119-L1155)): `missing("costcenter")` and
   `missing("product")` sum `total - part` over every entity type.

## API calls

| Method | Endpoint or SDK method | Scope | When |
| --- | --- | --- | --- |
| POST, then GET | `/platform/storage/query/v1/query:execute`, `/platform/storage/query/v1/query:poll` through `useDql` of `@dynatrace-sdk/react-hooks` | `storage:smartscape:read` | Q1 at app start and on timeframe change; Q2 on **Search entities** |
| POST | `/platform/classic/environment-api/v2/settings/objects?validateOnly=true` (`settingsObjectsClient.postSettingsObjects`, `@dynatrace-sdk/client-classic-environment-v2`) | `settings:objects:write` | **Validate** in *Central enrichment rule* |
| POST | `/platform/classic/environment-api/v2/settings/objects?validateOnly=false` (same SDK method) | `settings:objects:write` | **Create rule** |
| Intent | `sendIntent` to `dynatrace.notebooks` / `view-query` | none | **↗ Open in Notebook** |
| Intent | `sendIntent` to `dynatrace.dashboards` / `add-to-dashboard` | none | **↗ Add to Dashboard** |
| Link | `getIntentLink` per entity type | none | **Open overview ↗** links |

Details:

- **DQL execution.** [`useDql.ts`](../ui/app/useDql.ts) wraps the SDK hook `useDql(query, { enabled: true })`; the SDK
  starts the query with `query:execute`, polls `query:poll`, and may cancel a superseded query
  (`POST /platform/storage/query/v1/query:cancel`). The app reads `records`; errors show the SDK error `message`.
- **Create the enrichment rule** (`submitEnrichmentRule` in [`remediation.ts`](../ui/app/remediation.ts#L111-L122)).
  The SDK accepts HTTP 200 and 207. Example body (copy the AWS tag `CostCenter` into the cost center):

  ```json
  [
    {
      "schemaId": "builtin:ingest.enrichment.config",
      "scope": "environment",
      "value": {
        "type": "AWS_TAG",
        "target": "dt.cost.costcenter",
        "valueSource": "CostCenter"
      }
    }
  ]
  ```

  Response fields used: the first element's `code` (400 or higher: `error.message`, or "Rejected (HTTP *code*).")
  and `objectId` after a create. When the SDK throws, the message comes from the error data: each object's
  `error.message` (or `error.details[].message`), joined with " | "; otherwise the error envelope's `error.message`;
  otherwise the exception message (`errorMessage` in [`remediation.ts`](../ui/app/remediation.ts#L98-L109)).
- **Notebook / Dashboard intents** ([`components.tsx`](../ui/app/components.tsx#L209-L212)): payload
  `{ "dt.query": "<query text>", "title": "<section title>" }` with *Cost allocation coverage*, *Cost center search*
  or *Cost product search*.
- **Copy** buttons use `navigator.clipboard.writeText`; no request is sent.

## Remediation actions

Rendered by `RemediationPanel` with `tab="cost"`
([`RemediationPanel.tsx`](../ui/app/RemediationPanel.tsx#L1114-L1209)), anchor id `remediation-cost`.

### Action picker and impact line

- **Impact line:** "*N* entities without a cost center, *M* entities without a cost product." (thousands separators;
  "1 entity" in the singular). Entity types are added up, so a host and its processes count separately.
- **Action** select, in this order; the first is preselected:

| Option label | Kind | What it fixes |
| --- | --- | --- |
| API · Central enrichment rule | Writes to the tenant | Sets `dt.cost.costcenter` or `dt.cost.product` on every entity a rule matches. |
| Manual · Host tag with oneagentctl | Command on a host | Sets `dt.cost.product` on one host at the source. |
| Manual · Kubernetes annotation | kubectl / YAML | Sets `dt.cost.product` on a Kubernetes namespace, workload or pod. |

Switching the action replaces the form and resets its inputs. Each action ends with **Documentation for this fix:**
links.

### API: Central enrichment rule

**What it fixes.** Entities without a cost center or cost product, for every entity the rule matches: one settings
object of the schema `builtin:ingest.enrichment.config` at environment scope (`EnrichmentRuleForm` in
[`RemediationPanel.tsx`](../ui/app/RemediationPanel.tsx#L197-L304), builders in
[`remediation.ts`](../ui/app/remediation.ts#L17-L122)). One rule sets one field; for both fields create two rules.

**When it is offered.** Always, as the first action.

**Form fields:**

| Field | Shown when | Options / input | Goes to |
| --- | --- | --- | --- |
| **Field** | Always on this tab (two targets) | *Cost center (dt.cost.costcenter)* (default), *Cost product (dt.cost.product)* | `value.target` |
| **Source** | Always | *Fixed value (Custom)* (default), *Host/process property*, *Kubernetes namespace label*, *Kubernetes namespace annotation*, *Kubernetes workload label*, *Kubernetes workload annotation*, *Kubernetes pod label*, *Kubernetes pod annotation*, *AWS tag*, *Azure tag*, *GCP label*, *GCP tag* | `value.type`: `CUSTOM`, `HOST_PROCESS_PROPERTY`, `K8S_NAMESPACE_LABEL`, `K8S_NAMESPACE_ANNOTATION`, `K8S_WORKLOAD_LABEL`, `K8S_WORKLOAD_ANNOTATION`, `K8S_POD_LABEL`, `K8S_POD_ANNOTATION`, `AWS_TAG`, `AZURE_TAG`, `GCP_LABEL`, `GCP_TAG` |
| **Applies to** | Source *Fixed value (Custom)* or *Host/process property* (code comment: "Per the central enrichment reference, conditions apply to host/process and custom rules only") | *All hosts / processes* (default), *Host name pattern*, *Custom condition* | Whether and how `value.condition` is set |
| Source value, labelled per source: **Value to apply** (Custom, "e.g. finance-prod"), **Property key** ("e.g. team"), **Label key** (Kubernetes, "e.g. team" / "e.g. app.kubernetes.io/part-of"; GCP label "e.g. cost-center"), **Annotation key** ("e.g. owner"), **Tag key** (AWS / Azure "e.g. CostCenter", GCP tag "e.g. cost-center") | Always | Free text, trimmed | `value.valueSource`: the fixed value, or the key whose value is copied into the field |
| **Host name pattern** | *Applies to* = *Host name pattern* | Free text, placeholder "prod-*" | `value.condition = matchesValue(host.name, "<pattern>")` (inserted as typed) |
| **Condition** | *Applies to* = *Custom condition* | Free text, placeholder `matchesValue(host.name, "prod-*")` | `value.condition`, trimmed |

Kubernetes and cloud sources, and *All hosts / processes*, send no `condition`.

**Client-side checks** (Validate and Create rule disabled while one fails; message in red once the source value is
not empty):

| Rule | Message |
| --- | --- |
| Source value empty | "*<field label>* is required." (hidden while the field is empty) |
| Source value longer than 2048 characters | "Value source must be at most 2048 characters." |
| Whitespace in the source value, source not *Custom* | "Keys cannot contain whitespace." |
| Condition longer than 500 characters | "Condition must be at most 500 characters." |
| *Host name pattern* chosen, pattern empty | "Enter a host name pattern." |

**Request preview.** Collapsible **Request (1 API call, environment scope)** with the exact JSON body and a **Copy**
button.

**Validate.** `POST /platform/classic/environment-api/v2/settings/objects?validateOnly=true` with the body; nothing is
saved. Green "Validation passed. The rule is valid and nothing was saved." or the red rejection message. Optional.

**Confirmation and Create rule.** Tick **Create this rule in the tenant**, then **Create rule**:
`POST /platform/classic/environment-api/v2/settings/objects?validateOnly=false`. Any form change clears the result
and unticks the box.

- **Success:** "Rule created." with "ID: *objectId*"; the box is unticked, the form keeps its values (a second
  create makes a second rule).
- **Failure:** red message; the box is unticked.
- Hint: "One rule covers every matching entity. OneAgent applies it in ~5 min; Kubernetes pods need a restart." The
  gauges change after entities report the value and Q1 runs again (reload the app or change the timeframe).

**More body examples** (generated with `buildEnrichmentBody`):

Host property `costcenter` copied into the cost center, only for hosts matching `prod-*`:

```json
[
  {
    "schemaId": "builtin:ingest.enrichment.config",
    "scope": "environment",
    "value": {
      "type": "HOST_PROCESS_PROPERTY",
      "target": "dt.cost.costcenter",
      "valueSource": "costcenter",
      "condition": "matchesValue(host.name, \"prod-*\")"
    }
  }
]
```

Kubernetes namespace label `app.kubernetes.io/part-of` copied into the cost product:

```json
[
  {
    "schemaId": "builtin:ingest.enrichment.config",
    "scope": "environment",
    "value": {
      "type": "K8S_NAMESPACE_LABEL",
      "target": "dt.cost.product",
      "valueSource": "app.kubernetes.io/part-of"
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

**What it fixes.** A host without a cost product, set at the source (`hostTagsAction("dt.cost.product", "checkout")`
in [`remediation.ts`](../ui/app/remediation.ts#L438-L448)). The command is generated for `dt.cost.product` only; for
the cost center, replace the key with `dt.cost.costcenter`. Nothing is sent from the app.

**Variant** select: *Linux / AIX* (default) or *Windows*, each with a **Copy** button:

```bash
./oneagentctl --set-host-tag="dt.cost.product=checkout"
```

```powershell
.\oneagentctl.exe --set-host-tag="dt.cost.product=checkout"
```

**Steps:** 1. Open an elevated shell in the OneAgent tools directory. 2. Run the command. 3. Check with
`--get-host-tags`.

**Notes** (collapsed): "Values: no whitespace or extra '=', max 256 characters." and "Precedence: process DT_TAGS >
host tag > central enrichment rule."

**Documentation for this fix:**
[OneAgent primary tags](https://docs.dynatrace.com/docs/manage/tags/primary-tags/tags-domain-oneagent),
[oneagentctl reference](https://docs.dynatrace.com/docs/ingest-from/dynatrace-oneagent/oneagent-configuration-via-command-line-interface).

### Manual: Kubernetes annotation

**What it fixes.** Kubernetes namespaces, workloads or pods without a cost product
(`k8sAnnotationAction("dt.cost.product", "checkout")` in [`remediation.ts`](../ui/app/remediation.ts#L450-L464)).
Generated for `dt.cost.product` only; use `metadata.dynatrace.com/dt.cost.costcenter` for the cost center.

**Variant** select with **Copy** buttons:

*kubectl* (default):

```bash
kubectl annotate namespace <namespace> metadata.dynatrace.com/dt.cost.product=checkout --overwrite
```

*YAML*:

```yaml
metadata:
  annotations:
    metadata.dynatrace.com/dt.cost.product: checkout
```

*DynaKube prerequisite*:

```yaml
spec:
  metadataEnrichment:
    enabled: true
```

**Steps:** 1. Enable `spec.metadataEnrichment` in the DynaKube. 2. Annotate the namespace (or workload / pod).
3. Restart affected pods; verify with `kubectl get pod -o yaml`.

**Notes** (collapsed): "Pod > workload > namespace. Workload level needs Operator 1.11.0+ and ActiveGate 1.347+." and
"Annotations > DynaKube resource attributes > central rules. Classic Full Stack is not supported."

**Documentation for this fix:**
[Kubernetes primary tags](https://docs.dynatrace.com/docs/manage/tags/primary-tags/tags-domain-k8s),
[Ingest enrichment rules](https://docs.dynatrace.com/docs/manage/tags/tags-central-enrichment).

## AI Assist on this page

When **AI Assist** is on, an *AI Insights* panel opens at the top of the tab, computed by
`analyzeFieldCoverage("Cost allocation", rows)` in [`analyses.ts`](../ui/app/analyses.ts#L46-L73). `rows` are the
cost center and cost product rows of Q1 (up to 18: one per field and entity type with entities). It is rule-based,
runs locally in the browser on the data on screen, and calls no model or service.

**Summary:** "Cost allocation: *P* of *T* entity checks are in place (*O*%). *F* combination(s) fully covered, *E*
with no coverage at all." *P* and *T* are sums over all rows of both fields (so every entity is counted twice in
*T*), *O* = `Math.round(P / T * 100)`, an entity-weighted figure unlike the unweighted means of the Entity Overview.
*F* counts rows at 100%, *E* rows at 0.

**Insights** (green good, orange warning, red critical, blue info):

| Insight | Condition | Severity |
| --- | --- | --- |
| "Fully covered: *TYPE* cost center, *TYPE* cost product, …" (first 5) | At least one row at 100% | good |
| "No coverage: *TYPE* cost center (0/*total*), …" (first 5) | At least one row at 0 | critical |
| "Largest gap: *N* *TYPE* entities missing cost center." (or cost product) | Row with the most missing entities | good at 90% or more, warning 50–89%, critical below 50% |
| "Combined coverage for this view is *O*%." | Always | By *O*, same thresholds |

*TYPE* is the raw Smartscape type, for example `HOST`.

**Recommendations:**

| Impact | Text | Condition |
| --- | --- | --- |
| high | "Start with the zero-coverage combinations — a single rule or host property usually fixes the whole group." | At least one row at 0 |
| medium | "Use “Find entities missing a field” for *TYPE* / *Cost center or Cost product* to see exactly which entities to fix." | There is a largest gap. On this tab, use the entity search with that **Property**, entity type and **Match** = *Is missing*. |
| low | "Use Open in Notebook on a query to share or extend the check with your customer." | Always |

**No data:** while Q1 has no rows (loading, failed, no entities): "No coverage data is available for cost allocation
in this timeframe.", the info insight "No entities returned. Widen the timeframe or check the data source." and the
recommendation "Confirm entities are being monitored, then re-check."

## Limitations and edge cases

- **Frontends are not covered.** No frontend cost gauge exists because frontends cannot carry `dt.cost.*` (see
  [What this page answers](#what-this-page-answers)). Synthetic monitors and other classic entities are not counted
  either.
- **Any value counts.** *In place* is `isNotNull`; an empty or placeholder value (for example `unknown`) counts as
  in place. Use the search with *Equals* or *Contains* to find such values.
- **Rounding.** Percentages are integers: 199 of 200 shows 100% and is not a Top finding. The detail line shows the
  exact counts.
- **Timeframe semantics.** With 7 or 30 days, entities that existed earlier in the window (decommissioned hosts,
  replaced pods) count and can keep a gauge below 100% after a fix.
- **Search results keep their timeframe** until you click **Search entities** again.
- **500-row cap** on the search (first 500 by name).
- **Overview links open without a timeframe** (the target app's default).
- **Impact line while loading** reads "0 entities without a cost center, 0 entities without a cost product."
- **Counts across entity types overlap** in the impact line and AI summary.
- **Manual actions cover the cost product only.** The `oneagentctl` and annotation commands are generated for
  `dt.cost.product`; for the cost center edit the key, or use the central enrichment rule, which offers both.
- **No duplicate check for rules**, and the **host name pattern is not escaped** (a `"` in it gives an invalid
  condition that Validate reports).
- **Conditions only for Custom and host/process property sources.**

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| *Query failed* box mentioning a permission | The user may not read Smartscape data | Grant `storage:smartscape:read` in IAM. |
| "No entities found for this timeframe." | No Smartscape nodes of the 9 types | Widen the timeframe; confirm OneAgents, Kubernetes monitoring or cloud integrations report. |
| Gauges stay at 0% after a rule was created | Source key or condition does not match, or entities have not reported since | Search *Has a value*; check the key (case, cloud tag name) and condition; wait about 5 minutes; restart Kubernetes pods. |
| Gauge below 100% after a fix with 7 or 30 days | Older entities in the window still count | Compare with *Last 24 hours*; list the rest with *Is missing*. |
| Validate / Create rule: permission error (HTTP 403) | The user may not write `builtin:ingest.enrichment.config` | Grant `settings:objects:write` for the schema (or `environment:roles:manage-settings`). |
| Validate: schema error | Value, key or condition rejected | Fix the input as the message says; test the condition in a Notebook. |
| Buttons greyed out | A client-side check fails, a request is running, or (Create rule) the box is not ticked | Read the red message; tick **Create this rule in the tenant**. |
| Kubernetes annotation has no effect | Metadata enrichment off, pods not restarted, or classic full-stack | Apply the *DynaKube prerequisite*, restart the pods. |
| *Equals* finds nothing | Case-sensitive exact match | Use *Contains*. |
| You expected frontends in the gauges | Frontends cannot be cost-allocated | None; attribute frontend cost by other means outside Dynatrace cost allocation. |

## Related pages

- [Index](README.md): app shell, timeframe, gauges, query actions, remediation sections.
- [Entity Overview](entity-overview.md): Overall readiness, *Cost center* / *Cost product* summary gauges and Top 5
  findings built from the same checks.
- [Security context](security-context.md): the same layout and remediation for `dt.security_context`.
- [Data Overview](data-overview.md): cost center and cost product on metric series, logs, events and business events.
- [Primary tags](primary-tags.md): the same enrichment rule form for `primary_tags.<name>`.
- [Frontends](frontends.md): the checks that apply to frontends.
- [Host groups](host-groups.md), [Ownership & Teams](ownership-and-teams.md): other tabs fed by the same coverage query.

## Source files

| File | Role on this page |
| --- | --- |
| [`ui/app/App.tsx`](../ui/app/App.tsx) | Runs Q1 once, renders this tab (`FieldCoverageTab` + `RemediationPanel tab="cost"`), timeframe, AI Assist toggle, jump to remediation. |
| [`ui/app/areas.tsx`](../ui/app/areas.tsx) | Tab id `cost`, title, area Metadata, documentation link. |
| [`ui/app/tabs/CoverageTabs.tsx`](../ui/app/tabs/CoverageTabs.tsx) | `FieldCoverageTab`, `COST_FOCUS`, `toCoverageRows`, `TypeGaugeGrid`; Top findings for the Entity Overview. |
| [`ui/app/tabs/EntitySearch.tsx`](../ui/app/tabs/EntitySearch.tsx) | Entity search form and result columns. |
| [`ui/app/queries.ts`](../ui/app/queries.ts) | `coverageQuery`, `entitySearchQuery`, `dqlString`, `PRIMARY_FIELDS`, `ENTITY_TYPES`, `ENTITY_LABELS`, `fieldApplies`, `TIMEFRAMES`. |
| [`ui/app/components.tsx`](../ui/app/components.tsx) | `PctGauge`, `statusColor`, `pct`, `QueryState`, `QueryActions`, `DrillDownTable`. |
| [`ui/app/useDql.ts`](../ui/app/useDql.ts) | Wrapper around the SDK `useDql`. |
| [`ui/app/links.ts`](../ui/app/links.ts) | `entityOverviewLink` for the Overview column. |
| [`ui/app/RemediationPanel.tsx`](../ui/app/RemediationPanel.tsx) | Remediation section, impact line, `EnrichmentRuleForm`, `ManualActionView`. |
| [`ui/app/remediation.ts`](../ui/app/remediation.ts) | Enrichment schema, targets, source types, body builder, checks, `submitEnrichmentRule`, manual actions, doc links. |
| [`ui/app/frontends.ts`](../ui/app/frontends.ts) | Frontend checks (no cost check). |
| [`ui/app/analyses.ts`](../ui/app/analyses.ts) | `analyzeFieldCoverage`: AI Assist rules. |
| [`app.config.json`](../app.config.json) | Scopes `storage:smartscape:read` and `settings:objects:write`. |
