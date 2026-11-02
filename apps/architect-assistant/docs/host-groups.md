# Host groups

The Host groups tab measures how many monitored hosts belong to a OneAgent host group, lets you search hosts,
processes and containers by their host group, and offers two ways to fix hosts that have none: a bulk assignment
through OneAgent remote configuration management (one job for up to 500 hosts) and the `oneagentctl` command for a
single host. Host groups bind hosts to a shared deployment unit, so settings, naming and ownership can be applied per
group instead of per host.

| | |
| --- | --- |
| Area | Metadata (see [index](README.md)) |
| Tab id | `hostgroups` |
| Counts toward Entity Overview readiness / Top findings | Yes. The host group check is not computed on this tab but by the shared `coverageQuery` (column `hostgroup`) for hosts, processes and containers. It feeds the *Host group* summary gauge and the per-type *Host group* gauges on [Entity Overview](entity-overview.md), the *Overall readiness* average, and the Top 5 findings. Their (i) buttons and *Remediation steps* buttons open this tab and scroll to its Remediation actions section. |
| Main source files | [`ui/app/tabs/InfraTabs.tsx`](../ui/app/tabs/InfraTabs.tsx#L40) (`HostGroupsTab`), [`ui/app/tabs/EntitySearch.tsx`](../ui/app/tabs/EntitySearch.tsx), [`ui/app/RemediationPanel.tsx`](../ui/app/RemediationPanel.tsx), [`ui/app/remediation.ts`](../ui/app/remediation.ts), [`ui/app/queries.ts`](../ui/app/queries.ts#L135), [`ui/app/analyses.ts`](../ui/app/analyses.ts#L75) |

## Contents

- [What this page answers](#what-this-page-answers)
- [Before you start](#before-you-start)
  - [App scopes used by this page](#app-scopes-used-by-this-page)
  - [User permissions](#user-permissions)
  - [One-time setup](#one-time-setup)
- [Page walkthrough](#page-walkthrough)
  - [Documentation link and shell controls](#documentation-link-and-shell-controls)
  - [AI Assist panel](#ai-assist-panel)
  - [Heading and Hosts with a host group gauge](#heading-and-hosts-with-a-host-group-gauge)
  - [Search entities by host group](#search-entities-by-host-group)
  - [Remediation actions](#remediation-actions-section)
- [Checks and scoring](#checks-and-scoring)
- [Queries](#queries)
- [API calls](#api-calls)
- [Remediation actions](#remediation-actions)
  - [API: Assign host group (remote configuration)](#api-assign-host-group-remote-configuration)
  - [Manual: Host group with oneagentctl (single host)](#manual-host-group-with-oneagentctl-single-host)
- [AI Assist on this page](#ai-assist-on-this-page)
- [Limitations and edge cases](#limitations-and-edge-cases)
- [Troubleshooting](#troubleshooting)
- [Related pages](#related-pages)
- [Source files](#source-files)

## What this page answers

- **What share of my hosts have a host group?** One gauge: hosts whose Smartscape `HOST` node carries a
  `dt.host_group.id`, out of all hosts seen in the selected timeframe.
- **Which hosts, processes or containers are (or are not) in a given host group?** The entity search filters by
  *has a value*, *equals*, *contains* or *is missing*, optionally narrowed by entity name.
- **How do I put the hosts without a group into one?** The Remediation actions section lists the hosts without a host
  group, lets you pick an existing or new group and a subset of hosts (by cloud provider, OS or Kubernetes cluster),
  validates and previews the change, and starts one OneAgent remote configuration job. For a single host it shows the
  `oneagentctl --set-host-group` command.
- **How spread out are my host groups?** AI Assist summarises the number of groups, the largest group, and flags
  single-host groups that suggest naming drift.

The best practice checked: every host belongs to a host group that represents its deployment unit, assigned at install
time (`--set-host-group`), so settings, naming and ownership can be applied per group. Changing a host group
recalculates process group IDs (note in the manual action). The fixes cite these Dynatrace pages (the
*Documentation for this fix* row of each action):

- [Remote configuration management](https://docs.dynatrace.com/docs/ingest-from/bulk-configuration)
- [Remote configuration API: POST job](https://docs.dynatrace.com/docs/dynatrace-api/environment-api/remote-configuration/oneagent/post-config-job)
- [oneagentctl reference](https://docs.dynatrace.com/docs/ingest-from/dynatrace-oneagent/oneagent-configuration-via-command-line-interface)

## Before you start

### App scopes used by this page

Scopes come from [`app.config.json`](../app.config.json). Only the scopes below are used by this tab.

| Scope | What this page uses it for |
| --- | --- |
| `storage:smartscape:read` | Every DQL query on the page (`smartscapeNodes "HOST"`, `"PROCESS"`, `"CONTAINER"`): the gauge, the entity search, the remediation host list, and the shared coverage query that produces the remediation impact line. |
| `fleet-management:oneagents:write` | Remediation *Assign host group*: the validator, preview and job `POST` calls of OneAgent remote configuration management. |

The intents used by *Open in Notebook*, *Add to Dashboard* and *Open overview* need no scope. The comment in
[`remediation.ts`](../ui/app/remediation.ts#L309) names `fleet-management:oneagents:read` as well, but the app does
not request it and this page never calls a read endpoint of remote configuration management.

### User permissions

Queries and API calls run as the signed-in user, limited to the app scopes above. The user needs:

- Grail permission to read Smartscape nodes (`storage:smartscape:read`) for the gauge, the search and the host list.
  Without it the queries fail with a permission error (see [Troubleshooting](#troubleshooting)).
- For *Assign host group*: the Fleet Management permission `fleet-management:oneagents:write`. The SDK documentation of
  the validator and preview endpoints lists `environment:roles:viewer` as the alternative permission.
- Access to the Notebooks and Dashboards apps to use *Open in Notebook* / *Add to Dashboard*, and to Infrastructure &
  Operations for *Open overview*.

### One-time setup

None. No credential vault entry, outbound connection or OAuth client is needed. The bulk assignment only works for
OneAgents that support remote configuration management; the validator reports the others (see
[Validate and preview](#validate-and-preview)), and the UI notes that Operator-deployed OneAgents are skipped.

## Page walkthrough

The tab is rendered by `HostGroupsTab` followed by `<RemediationPanel tab="hostgroups" />`
([`App.tsx`](../ui/app/App.tsx#L88)).

### Documentation link and shell controls

- **Host groups documentation** (top right, small text): opens this page on GitHub
  (`https://github.com/Chr0dine/dt-apps/blob/main/apps/architect-assistant/docs/host-groups.md`), from `TabDocsLink` in
  [`areas.tsx`](../ui/app/areas.tsx#L86).
- **Timeframe** (app header): *Last 24 hours* (default), *Last 7 days*, *Last 30 days*. Every query on this tab uses
  `from:now()-24h`, `from:now()-7d` or `from:now()-30d` and re-runs when you change it, because the query text
  changes. For 7 and 30 days the header adds: "Longer timeframes also count entities that existed earlier in the
  window, including decommissioned ones."
- **AI Assist** (app header): toggles the AI Assist panel at the top of the tab.

### AI Assist panel

Shown at the top of the tab only while AI Assist is on. Its content is described in
[AI Assist on this page](#ai-assist-on-this-page).

### Heading and Hosts with a host group gauge

Heading **Host groups**, followed by the sentence "Host groups bind hosts to a shared deployment unit so settings,
naming and ownership can be applied by group."

**Hosts with a host group** gauge (custom SVG `PctGauge`, 188 px wide, a 240-degree arc whose filled part runs as a
continuous gradient from red at 0% through yellow to green at 100%):

| Element | Value |
| --- | --- |
| Number in the gauge | `round(100 × (total − without) / total)`, an integer percent; `0` when `total` is 0 |
| `total` | Sum of `hosts` over every row of [query 1](#1-hosts-per-host-group-hostgroupsquery) (all `HOST` nodes in the timeframe) |
| `without` | `hosts` of the row whose `hostGroup` is `null` (hosts without `dt.host_group.id`) |
| Caption | "Hosts with a host group" |
| Detail line | "`<total − without>` of `<total>`", numbers formatted with the browser locale (thousands separators) |
| In place | A host whose Smartscape node has a non-null `dt.host_group.id` |

Below the gauge: **Show DQL**, **Copy**, **↗ Open in Notebook**, **↗ Add to Dashboard** for query 1 (title "Hosts per
host group"). *Show DQL* toggles a code block with the query text (button reads *Hide DQL* while open); *Copy* writes
the text to the clipboard and shows *Copied* for 1.5 s; *Open in Notebook* sends the intent `view-query` to
`dynatrace.notebooks` and *Add to Dashboard* the intent `add-to-dashboard` to `dynatrace.dashboards`, both with the
payload `{ "dt.query": <query>, "title": "Hosts per host group" }`.

Loading and errors: while the query runs and no result exists yet, the gauge area shows "Loading…". If it fails, a
critical message box titled **Query failed** shows the error text. The entity search below is shown in both cases.

The tab shows no table of host groups; the per-group counts are used only by the gauge and by AI Assist. Open query 1
in a Notebook to see the counts per group.

### Search entities by host group

A card titled **Search entities by host group** (shared `EntitySearch` component, configured with one property,
*Host group* = `dt.host_group.id`, and the entity types `HOST`, `PROCESS`, `CONTAINER`). Host group is a host-level
attribute that processes and containers inherit, which is why only these three types are offered. Because there is
only one property, the *Property* dropdown other tabs show is hidden.

| Control | Options | Effect on the query ([query 2](#2-search-entities-by-host-group-entitysearchquery)) |
| --- | --- | --- |
| **Entity type** | *All applicable types* (default), *Hosts*, *Processes*, *Containers* | `smartscapeNodes "HOST", "PROCESS", "CONTAINER"` or only the chosen type |
| **Match** | *Has a value* (default) | `\| filter isNotNull(dt.host_group.id)` |
| | *Equals* | `\| filter toString(dt.host_group.id) == "<value>"` (exact, case-sensitive) |
| | *Contains* | `\| filter contains(toString(dt.host_group.id), "<value>", caseSensitive:false)` |
| | *Is missing* | `\| filter isNull(dt.host_group.id)` |
| **Value** | Text, shown only for *Equals* and *Contains* (placeholder "Value to match") | The value, trimmed and quoted as a DQL string (backslashes and double quotes escaped) |
| **Name contains (optional)** | Text (placeholder "e.g. prod-") | Adds `contains(name, "<text>", caseSensitive:false)` as the first condition, joined with `and` |
| **Search entities** | Button | Builds and runs the query. It does nothing while *Equals* / *Contains* has an empty value. |

The search never runs on its own: the query only runs when you click **Search entities**. Changing any control
removes the previous results, so a result table always matches the controls above it.

Results (`DrillDownTable`, title "Host group search"):

- **Show DQL / Copy / ↗ Open in Notebook / ↗ Add to Dashboard** for the exact query that ran.
- A sortable, full-width table with condensed rows:

| Column | Source | Meaning |
| --- | --- | --- |
| Name | `name` | Entity name |
| Type | `type` | `HOST`, `PROCESS` or `CONTAINER` |
| Entity ID | `id` | Smartscape node ID |
| Host group | `value` = `toString(dt.host_group.id)` | The host group name, empty when missing |
| Overview | built from `type` and `id` | **Open overview ↗** in a new tab: hosts open Infrastructure & Operations (`dynatrace.infraops`, intent `view_host`, property `meId`), processes `view_smartscape_process` and containers `view_smartscape_container` (property `nodeId`). "—" when no link can be built. |

- Rows come sorted by name ascending (from the query); clicking a header re-sorts in the browser.
- At most 500 rows (the query's `limit 500`). When 500 rows come back, the text "Showing the first 500 entities." is
  shown.
- Empty result: "No entities match this search." Loading: "Loading…". Error: **Query failed** box.

### Remediation actions section

A card with the heading **Remediation actions**, an impact line and an **Action** dropdown. HTML anchor
`remediation-hostgroups` (used by the Entity Overview jumps).

- **Impact line**: "`<n>` host(s) without a host group." `n` is `total − hostgroup` of the `HOST` row of the shared
  [coverage query](#3-shared-coverage-query-coveragequery) (singular "host" when `n` is 1). It is computed from the
  app-level query, not from the gauge's query, but both count the same `HOST` nodes in the same timeframe.
- **Action** dropdown (first entry selected by default):
  1. *API · Assign host group (remote configuration)*
  2. *Manual · Host group with oneagentctl (single host)*
- **Documentation for this fix:** links under the selected action (see each action below).

The actions are described in detail in [Remediation actions](#remediation-actions).

## Checks and scoring

| Check | In place when | Numerator | Denominator | Severity / thresholds | Notes |
| --- | --- | --- | --- | --- | --- |
| Hosts with a host group (this tab's gauge) | The `HOST` node has a non-null `dt.host_group.id` | Hosts with a host group | All `HOST` nodes in the timeframe | Gauge colour only (red to green gradient); no status label | Rounded with `Math.round`; 0% when there are no hosts |
| Host group, per entity type (Entity Overview) | `isNotNull(dt.host_group.id)` on the node | `hostgroup` column of `coverageQuery` for the type | `total` column for the type | Counted in *Overall readiness* (plain mean of all checks) and ranked in Top 5 findings | Applies to `HOST`, `PROCESS`, `CONTAINER` only (`fieldApplies`); a type with 0 entities is left out |
| Host group summary gauge (Entity Overview) | | Mean of the per-type percentages above | Number of types with entities ("avg of N checks") | | Its (i) button opens this tab's Remediation actions |
| AI Assist host share | as the gauge | `total − without` | `total` | `good` at 90% or more, `warning` at 50% or more, `critical` below 50% | See [AI Assist](#ai-assist-on-this-page) |

On Entity Overview the Top 5 findings phrase a host group gap as "None of the `<total>` hosts have a host group." (0%)
or "Only `<pct>`% of hosts have a host group (`<part>` of `<total>`)." (likewise for processes and containers), and the
*Remediation steps →* button opens this tab ([`CoverageTabs.tsx`](../ui/app/tabs/CoverageTabs.tsx#L172)).

## Queries

| # | Name (function in source) | Runs when | Feeds |
| --- | --- | --- | --- |
| 1 | Hosts per host group (`hostGroupsQuery`) | Tab opens; again when *Load hosts* is clicked in the remediation | Gauge, AI Assist, existing-group list of *Assign host group* |
| 2 | Search entities by host group (`entitySearchQuery`) | *Search entities* clicked | Search results table |
| 3 | Shared coverage query (`coverageQuery`) | App start (shell), not by this tab | Remediation impact line |
| 4 | Hosts without a host group (`hostsWithoutGroupQuery`) | *Load hosts* clicked in *Assign host group* | Host list and *Hosts* dropdown of *Assign host group* |

All queries are DQL run in the browser through `useDql` ([`ui/app/useDql.ts`](../ui/app/useDql.ts)), a wrapper around
`@dynatrace-sdk/react-hooks` `useDql`. A query runs again whenever its text changes (for example the timeframe).

### 1. Hosts per host group (`hostGroupsQuery`)

- **Source:** `hostGroupsQuery` in [`ui/app/queries.ts`](../ui/app/queries.ts#L135).
- **Runs:** when the tab opens (`HostGroupsTab`), and a second time when you click *Load hosts* in the remediation
  (`HostGroupData`). Re-runs on timeframe change.
- **Parameters:** timeframe only. `from:now()-24h` becomes `from:now()-7d` / `from:now()-30d`.
- **Query (24 hours):**

```dql
smartscapeNodes "HOST", from:now()-24h
| summarize hosts = count(), by:{hostGroup = dt.host_group.id}
| sort hosts desc
```

- **How it works:**
  - `smartscapeNodes "HOST", from:now()-24h`: every host node in Smartscape that existed in the timeframe. Smartscape
    is cheap to query and carries the primary Grail fields, including `dt.host_group.id` (the host group name), on each
    node.
  - `summarize hosts = count(), by:{hostGroup = dt.host_group.id}`: one row per distinct host group with its host
    count. Hosts without a host group fall into one row whose `hostGroup` is `null`.
  - `sort hosts desc`: largest group first.
- **Output:** `hostGroup` (string or `null`), `hosts` (count). The tab maps each record to
  `{ hostGroup: hostGroup ?? "(no host group)", hosts, none: hostGroup == null }`. The gauge sums `hosts` for `total`
  and for the `none` row; AI Assist uses every row; the remediation uses the non-null `hostGroup` values, in this order
  (largest first), as the existing groups in the *Host group* dropdown.
- **Limits and cost:** no `limit`; one row per host group. Smartscape node queries are the cheapest data source the
  app uses.
- **Open it yourself:** yes, *Show DQL / Copy / Open in Notebook / Add to Dashboard* under the gauge (title "Hosts per
  host group").

### 2. Search entities by host group (`entitySearchQuery`)

- **Source:** `entitySearchQuery` in [`ui/app/queries.ts`](../ui/app/queries.ts#L158), called from `EntitySearch`
  ([`EntitySearch.tsx`](../ui/app/tabs/EntitySearch.tsx#L133)) with the field
  `{ key: "hostgroup", label: "Host group", expr: "dt.host_group.id" }`.
- **Runs:** only when *Search entities* is clicked with valid input. Changing a control hides the results; changing
  the timeframe changes the text of the next search (the table that is shown keeps the query it ran with until you
  search again or change a control).
- **Parameters:**
  - Entity type: all three types, or one of `"HOST"`, `"PROCESS"`, `"CONTAINER"`.
  - Match mode: decides the filter clause (table in the [walkthrough](#search-entities-by-host-group)).
  - Value: used by *Equals* / *Contains*; trimmed and escaped by `dqlString` (`\` becomes `\\`, `"` becomes `\"`).
  - Name contains: when not empty, adds `contains(name, "<text>", caseSensitive:false)` before the match clause.
  - Timeframe: `from:now()-24h` / `-7d` / `-30d`.
- **Query (24 hours, all types, *Has a value*, no name):**

```dql
smartscapeNodes "HOST", "PROCESS", "CONTAINER", from:now()-24h
| filter isNotNull(dt.host_group.id)
| fieldsAdd value = toString(dt.host_group.id)
| fields id, name, type, value
| sort name asc
| limit 500
```

- **Variants** (only the first two lines change):

*Hosts* only, *Is missing*:

```dql
smartscapeNodes "HOST", from:now()-24h
| filter isNull(dt.host_group.id)
| fieldsAdd value = toString(dt.host_group.id)
| fields id, name, type, value
| sort name asc
| limit 500
```

*Equals* `my-host-group`:

```dql
smartscapeNodes "HOST", "PROCESS", "CONTAINER", from:now()-24h
| filter toString(dt.host_group.id) == "my-host-group"
| fieldsAdd value = toString(dt.host_group.id)
| fields id, name, type, value
| sort name asc
| limit 500
```

*Contains* `prod` with *Name contains* `web-`:

```dql
smartscapeNodes "HOST", "PROCESS", "CONTAINER", from:now()-24h
| filter contains(name, "web-", caseSensitive:false) and contains(toString(dt.host_group.id), "prod", caseSensitive:false)
| fieldsAdd value = toString(dt.host_group.id)
| fields id, name, type, value
| sort name asc
| limit 500
```

A value with special characters is escaped, for example `a"b\c` becomes
`| filter toString(dt.host_group.id) == "a\"b\\c"`.

- **How it works:**
  - `smartscapeNodes ...`: the selected entity types in the timeframe. Processes and containers carry the host group
    of the host they run on.
  - `filter ...`: the name condition (optional) and the match condition joined with `and`. `toString()` makes the
    comparison work on the string form of the field; *Contains* is case-insensitive, *Equals* is not.
  - `fieldsAdd value = toString(dt.host_group.id)`: the host group as text for the *Host group* column.
  - `fields id, name, type, value`: only the columns the table shows.
  - `sort name asc | limit 500`: alphabetical, first 500.
- **Output:** `id`, `name`, `type`, `value`, one row per entity, shown as described in the
  [walkthrough](#search-entities-by-host-group).
- **Limits and cost:** `limit 500`; Smartscape only.
- **Open it yourself:** yes, *Show DQL / Copy / Open in Notebook / Add to Dashboard* above the results (title "Host
  group search").

### 3. Shared coverage query (`coverageQuery`)

- **Source:** `coverageQuery` in [`ui/app/queries.ts`](../ui/app/queries.ts#L77), run once by the app shell
  ([`App.tsx`](../ui/app/App.tsx#L52)) and passed to every Remediation actions section.
- **Runs:** at app start and on timeframe change, whichever tab is open.
- **Parameters:** timeframe.
- **Query (24 hours):**

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

- **How it works:** one row per entity type with the total and, per primary field, how many entities have it. For this
  tab only the `hostgroup` column of the `HOST` row matters: `countIf(isNotNull(dt.host_group.id))`.
- **Output used here:** `toCoverageRows` ([`CoverageTabs.tsx`](../ui/app/tabs/CoverageTabs.tsx#L42)) turns the result
  into rows; the impact line sums `total − part` over the row with `field = "hostgroup"` and `type = "HOST"`.
- **Limits and cost:** one aggregation over Smartscape; shared by Entity Overview, Security context, Cost allocation,
  Ownership & Teams and every Remediation actions section, so it runs once, not once per tab.
- **Open it yourself:** not on this tab. Entity Overview exposes it as "Primary field coverage" (see
  [Entity Overview](entity-overview.md)).

### 4. Hosts without a host group (`hostsWithoutGroupQuery`)

- **Source:** `hostsWithoutGroupQuery` in [`ui/app/queries.ts`](../ui/app/queries.ts#L140), run by `HostGroupData` in
  [`RemediationPanel.tsx`](../ui/app/RemediationPanel.tsx#L462).
- **Runs:** when you click **Load hosts** in *Assign host group*, together with query 1. Not before. Re-runs on
  timeframe change while the form is open.
- **Parameters:** timeframe.
- **Query (24 hours):**

```dql
smartscapeNodes "HOST", from:now()-24h
| filter isNull(dt.host_group.id)
| fields id, name, cloud.provider, os.type, k8s.cluster.name
| sort name asc
| limit 500
```

- **How it works:**
  - `smartscapeNodes "HOST"` in the timeframe, `filter isNull(dt.host_group.id)`: hosts without a host group.
  - `fields id, name, cloud.provider, os.type, k8s.cluster.name`: the host ID (sent to the remote configuration API),
    the name, and three properties used to build target subsets.
  - `sort name asc | limit 500`: alphabetical, first 500, which is also the maximum number of hosts per job
    (`MAX_HOSTS_PER_JOB = 500`).
- **Output:** each record becomes `{ id, name, cloud: cloud.provider, os: os.type, k8s: k8s.cluster.name }`. `id` goes
  into the request's `entities`; `cloud`, `os` (with any `OS_TYPE_` prefix removed) and `k8s` build the *Hosts*
  dropdown entries.
- **Limits and cost:** `limit 500`. With more than 500 hosts without a group, the job covers the alphabetically first
  500; run it again after they have a group to reach the rest.
- **Open it yourself:** yes, *Show DQL / Copy / Open in Notebook / Add to Dashboard* inside the loaded form (title
  "Hosts without a host group").

## API calls

| Method | Endpoint or SDK method | Scope | When |
| --- | --- | --- | --- |
| POST | `/platform/classic/environment-api/v2/oneagents/remoteConfigurationManagement/validator` (`oneAgentRemoteConfigurationManagementClient.validateRemoteIdentityOperation_1`) | `fleet-management:oneagents:write` | *Validate & preview*, once or twice |
| POST | `/platform/classic/environment-api/v2/oneagents/remoteConfigurationManagement/preview` (`oneAgentRemoteConfigurationManagementClient.createRemoteIdentityOperationPreview_1`) | `fleet-management:oneagents:write` | *Validate & preview*, after a successful validation |
| POST | `/platform/classic/environment-api/v2/oneagents/remoteConfigurationManagement` (optionally `?restart=false`) via `httpClient.send` | `fleet-management:oneagents:write` | *Assign host group* (after confirmation) |
| Intent | `dynatrace.notebooks` / `view-query`, `dynatrace.dashboards` / `add-to-dashboard` (`sendIntent`) | none | *Open in Notebook*, *Add to Dashboard* |
| Link | `getIntentLink` to `dynatrace.infraops` (`view_host`, `view_smartscape_process`, `view_smartscape_container`) | none | *Open overview ↗* in search results |

Details of the three remote configuration calls, with request and response examples, are in
[Assign host group](#api-assign-host-group-remote-configuration). The SDK client (`@dynatrace-sdk/client-classic-environment-v2`
9.1.0) has no method for the OneAgent job `POST`, so the app sends it with `@dynatrace-sdk/http-client` directly.

## Remediation actions

Both actions are offered whenever the tab is open, regardless of the gauge value.

### API: Assign host group (remote configuration)

Fixes hosts without a host group by starting **one** OneAgent remote configuration management job that sets the
`hostGroup` attribute on up to 500 hosts. The whole change is 1 or 2 validator calls, 1 preview call and 1 job call,
however many hosts are included. Source: `HostGroupAssignLoader`, `HostGroupData`, `HostGroupAssign` in
[`RemediationPanel.tsx`](../ui/app/RemediationPanel.tsx#L311) and `planHostGroupAssignment`,
`runHostGroupAssignment`, `checkHostGroupName` in [`remediation.ts`](../ui/app/remediation.ts#L305).

#### Step 1: Load hosts

Before anything runs, the action shows "Lists hosts without a host group (up to 500) and existing groups." and a
**Load hosts** button. Clicking it runs [query 4](#4-hosts-without-a-host-group-hostswithoutgroupquery) and
[query 1](#1-hosts-per-host-group-hostgroupsquery). While they run: "Loading hosts…". If either fails, its error is
shown in red. If query 4 returns no host: "Every host already has a host group." and nothing else.

#### Step 2: Form fields

| Field | Options | Notes |
| --- | --- | --- |
| **Host group** | Every existing host group from query 1 (largest first), then *New host group…* | Default: the largest existing group; *New host group…* when there is none. |
| **New name** | Text, shown for *New host group…* (placeholder "e.g. prod-web") | Checked by `checkHostGroupName` (rules below). |
| **Hosts** | *All hosts without a group (N)*; then one entry per cloud provider *Cloud: `<cloud.provider>` (n)*; per OS *OS: `<os.type>` (n)* (prefix `OS_TYPE_` removed); per Kubernetes cluster *Kubernetes cluster: `<k8s.cluster.name>` (n)* | Subsets are built in the browser from query 4. Hosts without the property are not in that subset. At most the first 500 IDs are used. |
| **OneAgent restart** | *Restart automatically* (default), *Don't restart* | *Don't restart* adds `?restart=false` to the job request. |

Host group name rules (`checkHostGroupName`, the message is shown in red once you type a name):

| Rule | Message |
| --- | --- |
| Not empty after trimming | "Host group name is required." |
| At most 100 characters | "At most 100 characters." |
| Does not start with `dt.` (case-insensitive) | "Must not start with dt." |
| Only `A-Z a-z 0-9 . _ -` (regex `^[A-Za-z0-9._-]+$`) | "Use letters, digits, hyphens, underscores and periods only." |

Below the fields:

- **Show DQL / Copy / Open in Notebook / Add to Dashboard** for query 4 ("Hosts without a host group").
- A folded **Request (1 job for N hosts)** block with a *Copy* button. It shows an abbreviated body, with the host IDs
  replaced by a count:

```json
{
  "entities": [
    "42 host IDs"
  ],
  "operations": [
    {
      "attribute": "hostGroup",
      "operation": "set",
      "value": "my-host-group"
    }
  ]
}
```

(`"<name>"` appears as the value while no name is entered.)

Any change to *Host group*, *New name* or *Hosts* clears the preview, the result and the confirmation.
Changing *OneAgent restart* does not.

#### Step 3: Validate and preview

**Validate & preview** is disabled while the name is invalid, a call is running, or the selected subset is empty. It
calls `planHostGroupAssignment(ids, name)`, which changes nothing in the tenant:

1. **Validator** (attempt 1): `POST /platform/classic/environment-api/v2/oneagents/remoteConfigurationManagement/validator`

   ```json
   {
     "entities": ["HOST-0000000000000001", "HOST-0000000000000002", "HOST-0000000000000003"],
     "operations": [{ "attribute": "hostGroup", "operation": "set", "value": "my-host-group" }]
   }
   ```

   - `204 No Content`: all hosts are valid; go to the preview.
   - `400` with a `RemoteConfigurationManagementValidationResult` body, for example:

     ```json
     {
       "invalidEntities": [{ "entity": "HOST-0000000000000003", "reasons": ["RUNNING_IN_CONTAINER"] }],
       "invalidOperations": []
     }
     ```

     - If `invalidOperations` is not empty, the plan stops with "Rejected: `<invalidOperations[0].reason>`" (or
       "Rejected: invalid operation").
     - Otherwise the hosts in `invalidEntities` are removed from the list. If none is left: "No selected host supports
       remote host group assignment." Otherwise the validator is called **once more** with the reduced list (attempt
       2). The SDK lists these reasons: `CLOUD_NATIVE_NOT_SUPPORTED`, `NOT_ALLOWED_WITH_CLUSTER_ACTIVE_GATE`,
       `NOT_CONNECTED`, `RUNNING_IN_CONTAINER`, `STANDALONE_NOT_SUPPORTED`, `VERSION_NOT_SUPPORTED`.
   - Any other error, or a second rejection, ends the plan with the error message.
2. **Preview**: `POST /platform/classic/environment-api/v2/oneagents/remoteConfigurationManagement/preview` with the
   same body (valid hosts only). Response example:

   ```json
   {
     "previews": [
       { "attribute": "hostGroup", "operation": "set", "value": "my-host-group", "alreadyConfiguredEntitiesCount": 0, "targetEntitiesCount": 2 }
     ]
   }
   ```

   The app reads `previews[0].alreadyConfiguredEntitiesCount` and `previews[0].targetEntitiesCount` (falls back to the
   number of valid hosts).

The status box (green border when the plan is usable, red otherwise) shows:

- "`<n>` host(s) can be reconfigured, `<m>` skipped." (the "skipped" part only when hosts were removed), or the error.
- "Preview: `<alreadyConfigured>` already in this group, `<target>` after the job."
- "Skipped: `<reason>` (`<count>`), ..." with each reason lower-cased and underscores replaced by spaces, for example
  "running in container (3), not connected (1)".
- "`<k>` API calls used so far; running the job adds 1." (`k` is 2 or 3 when the plan succeeds).

#### Step 4: Confirm and run

Shown only when the plan succeeded:

- Checkbox: **Assign "`<name>`" to `<n>` hosts (changes process group IDs)**.
- **Assign host group** (emphasized), enabled only when the checkbox is ticked and nothing is running.

It calls `runHostGroupAssignment(valid, name, restart)`:

```http
POST /platform/classic/environment-api/v2/oneagents/remoteConfigurationManagement
POST /platform/classic/environment-api/v2/oneagents/remoteConfigurationManagement?restart=false   (Don't restart)
Content-Type: application/json; charset=utf-8

{
  "entities": ["HOST-0000000000000001", "HOST-0000000000000002"],
  "operations": [{ "attribute": "hostGroup", "operation": "set", "value": "my-host-group" }]
}
```

Only status `201 Created` counts as success. From the response (a `RemoteConfigurationManagementJob`) the app uses
`id` and `totalEntitiesCount`.

| Outcome | What you see |
| --- | --- |
| 201 | Green result: "Job started for `<totalEntitiesCount>` hosts. Changes can take up to 10 minutes." and "ID: `<job id>`" |
| 409 | Red result: "Another remote configuration job is already running. Try again when it finishes." Only one remote configuration job (OneAgent or ActiveGate) can run at a time in an environment. |
| Other error | Red result with the error message |

After the call the checkbox is cleared. The host list, the gauge and the impact line are not refreshed: the job takes
up to 10 minutes, after which re-open the tab or change the timeframe to re-run the queries. The hint under the form
reads: "Takes up to 10 min; restart monitored processes afterwards. Operator-deployed OneAgents are skipped; only one
job can run at a time."

**Documentation for this fix:**
[Remote configuration management](https://docs.dynatrace.com/docs/ingest-from/bulk-configuration),
[Remote configuration API: POST job](https://docs.dynatrace.com/docs/dynatrace-api/environment-api/remote-configuration/oneagent/post-config-job).

### Manual: Host group with oneagentctl (single host)

For one host, or for hosts the remote configuration rejects. Source: `hostGroupManualAction` in
[`remediation.ts`](../ui/app/remediation.ts#L475), shown by `ManualActionView`.

- **Variant** dropdown: *Linux / AIX* (default) or *Windows*. The command has a *Copy* button.

  Linux / AIX:

  ```bash
  ./oneagentctl --set-host-group=MyHostGroup --restart-service
  ```

  Windows:

  ```powershell
  .\oneagentctl.exe --set-host-group=MyHostGroup --restart-service
  ```

- Steps:
  1. Open an elevated shell in the OneAgent tools directory.
  2. Run the command (restarts OneAgent).
  3. Restart monitored services; verify with `--get-host-group`.
- Notes (folded): "Name: letters, digits, hyphens, underscores, periods; no dt. prefix; max 100." and "Changing a host
  group recalculates process group IDs."
- **Documentation for this fix:**
  [oneagentctl reference](https://docs.dynatrace.com/docs/ingest-from/dynatrace-oneagent/oneagent-configuration-via-command-line-interface).

Nothing is sent to the tenant by this action.

## AI Assist on this page

AI Assist is rule-based and runs locally in the browser: `analyzeHostGroups` in
[`ui/app/analyses.ts`](../ui/app/analyses.ts#L75) is a pure function of query 1's rows. No AI service is called. The
panel is computed only while AI Assist is on, and again whenever the rows change.

Input: one item per row of query 1, `{ name: hostGroup or "(no host group)", hosts, none: hostGroup == null }`.
Derived values: `total` = sum of `hosts`; `without` = `hosts` of the `none` row; `named` = rows with a group;
`pct = round(100 × (total − without) / total)`; `biggest` = the named group with most hosts.

**No hosts** (`total` = 0):

- Summary: "No hosts were found for this timeframe."
- Insight (info): "No host entities returned."
- Recommendation (medium): "Confirm OneAgent is installed on hosts."

**Otherwise:**

- Summary: "`<total>` hosts are spread across `<named.length>` host group(s); `<without>` host(s) (`<100 − pct>`%)
  has/have no host group."
- Insights:

| Rule | Severity | Text |
| --- | --- | --- |
| Always | `good` at `pct` ≥ 90, `warning` at ≥ 50, `critical` below 50; check-mark icon when `without` is 0, warning icon otherwise | "`<pct>`% of hosts belong to a host group." |
| A named group exists | info | "Largest host group: `<name>` with `<hosts>` host(s)." |
| More than 2 named groups contain exactly 1 host | info | "`<singles>` host groups contain a single host — check for naming drift or over-segmentation." |

- Recommendations:

| Rule | Impact | Text |
| --- | --- | --- |
| `without` > 0 | high | "Assign a host group at install time (--set-host-group) so settings and ownership can be applied per deployment unit." |
| Always | low | "Keep a naming convention (environment-purpose) for host groups to avoid near-duplicates." |

## Limitations and edge cases

- **Hosts only in the gauge.** The gauge counts `HOST` nodes. The Entity Overview readiness also scores processes and
  containers, so its *Host group* summary gauge (a mean over up to three types) can differ from this tab's gauge.
- **Timeframe includes past hosts.** With 7 or 30 days, hosts that were decommissioned during the window are counted,
  and they also appear in the remediation host list; the validator may reject them (its reasons include `NOT_CONNECTED`).
- **500-host cap.** The search table and the remediation host list return at most 500 rows (first 500 by name). One
  job covers at most 500 hosts.
- **Only hosts without a group.** The API action lists hosts without a host group. Moving hosts from one group to
  another is not offered here; use remote configuration management in Dynatrace or `oneagentctl`.
- **Subsets need the property.** The *Cloud*, *OS* and *Kubernetes cluster* entries only include hosts that report
  `cloud.provider`, `os.type` or `k8s.cluster.name`.
- **Unsupported OneAgents are skipped.** Containerized, Operator-deployed, standalone, disconnected or too old OneAgents
  are removed by the validator; their reasons are listed under *Skipped*. Assign their group with
  `oneagentctl`.
- **No automatic refresh.** After the job, the gauge, impact line and host list only change when the queries run again
  (re-open the tab or change the timeframe), and only after the job finished (up to 10 minutes).
- **Process group IDs change.** Changing a host group recalculates process group IDs; plan for it (the confirmation
  checkbox says so).
- **Impact line before load.** Until the shared coverage query has returned, the impact line reads "0 hosts without a
  host group."
- **Equals is exact.** *Equals* compares the full host group name case-sensitively; use *Contains* for partial or
  case-insensitive matches.

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| **Query failed** box mentioning a missing scope or permission | The app session lacks `storage:smartscape:read`, or the user lacks the Grail permission to read Smartscape | Grant the user the permission; after changing `app.scopes`, restart the app session (`npx dt-app dev`) or redeploy |
| Gauge shows 0% and "0 of 0" | No hosts in the timeframe | Widen the timeframe; confirm OneAgents report to this environment |
| Search returns nothing for *Equals* | Name typed with different case or with extra characters | Use *Contains*, or copy the name from a *Has a value* search |
| "Every host already has a host group." | Query 4 found no host without a group in the timeframe | Nothing to fix |
| "Rejected: ..." after *Validate & preview* | The operation itself is invalid (for example the host group name) | Fix the name as the reason says |
| "No selected host supports remote host group assignment." | Every selected host was rejected (containerized, cloud-native, standalone, not connected, version too old) | Use the manual `oneagentctl` action for those hosts; check *Skipped* for the reasons |
| 403 / permission error on Validate or Assign | User lacks `fleet-management:oneagents:write` | Grant the Fleet Management permission |
| "Another remote configuration job is already running. Try again when it finishes." | A remote configuration job (OneAgent or ActiveGate) is running in the environment | Wait for it to finish (up to about 10 minutes) and click *Assign host group* again |
| Job started but hosts still show no group | The job takes up to 10 minutes; the page does not poll | Wait, then re-open the tab or change the timeframe |
| Processes reported under new IDs after the change | Process group IDs are recalculated when the host group changes | Expected; restart monitored processes as the hint says |

## Related pages

- [Index](README.md)
- [Entity Overview](entity-overview.md): readiness score and Top 5 findings that link here.
- [OneAgents](oneagents.md): OneAgent versions and monitoring modes; its *Find hosts* search filters by host group.
- [Security context](security-context.md), [Cost allocation](cost-allocation.md),
  [Ownership & Teams](ownership-and-teams.md): the other primary-field tabs using the same coverage query and entity
  search.
- [Service Detection v2](service-detection-v2.md): uses host groups as scopes.

## Source files

| File | Role on this page |
| --- | --- |
| [`ui/app/App.tsx`](../ui/app/App.tsx) | Shell: timeframe, AI Assist toggle, shared `coverageQuery`, renders `HostGroupsTab` + `RemediationPanel tab="hostgroups"` |
| [`ui/app/areas.tsx`](../ui/app/areas.tsx) | Tab title, area (Metadata), documentation link |
| [`ui/app/tabs/InfraTabs.tsx`](../ui/app/tabs/InfraTabs.tsx) | `HostGroupsTab`: gauge, query actions, entity search configuration, AI Assist input |
| [`ui/app/tabs/EntitySearch.tsx`](../ui/app/tabs/EntitySearch.tsx) | Search card: controls and results table |
| [`ui/app/queries.ts`](../ui/app/queries.ts) | `hostGroupsQuery`, `entitySearchQuery`, `dqlString`, `coverageQuery`, `hostsWithoutGroupQuery` |
| [`ui/app/components.tsx`](../ui/app/components.tsx) | `PctGauge`, `QueryActions`, `QueryState`, `DrillDownTable`, `ShowEntitiesButton`, `pct`, `num` |
| [`ui/app/useDql.ts`](../ui/app/useDql.ts) | DQL hook wrapper |
| [`ui/app/links.ts`](../ui/app/links.ts) | `entityOverviewLink` for *Open overview* |
| [`ui/app/RemediationPanel.tsx`](../ui/app/RemediationPanel.tsx) | Remediation section: impact line, action list, *Assign host group* form, manual action view |
| [`ui/app/remediation.ts`](../ui/app/remediation.ts) | Remote configuration calls, name validation, manual action text, documentation links |
| [`ui/app/tabs/CoverageTabs.tsx`](../ui/app/tabs/CoverageTabs.tsx) | `toCoverageRows` (impact line); Entity Overview gauges and Top findings that link to this tab |
| [`ui/app/navigation.tsx`](../ui/app/navigation.tsx) | Remediation anchor `remediation-hostgroups` |
| [`ui/app/analyses.ts`](../ui/app/analyses.ts) | `analyzeHostGroups` (AI Assist) |
| [`ui/app/AIInsights.tsx`](../ui/app/AIInsights.tsx) | AI Assist panel and `useAIInsights` hook |
| [`app.config.json`](../app.config.json) | Scopes `storage:smartscape:read`, `fleet-management:oneagents:write` |
