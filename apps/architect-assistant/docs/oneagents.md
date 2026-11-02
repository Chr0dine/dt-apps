# OneAgents

The OneAgents tab shows how current the OneAgents in the environment are and which monitoring mode they run in. It
compares every OneAgent's version with the newest version seen in this environment, shows the share in full-stack
mode, breaks agents down by monitoring mode and by version in two clickable donuts, and lists the hosts behind any
slice or filter in **Find hosts**. Its Remediation actions switch the environment to automatic OneAgent updates and
change the monitoring mode of many hosts in one Settings API call, with manual alternatives.

| | |
| --- | --- |
| Area | Visibility (see [index](README.md)) |
| Tab id | `oneagent` |
| Counts toward Entity Overview readiness / Top findings | No. None of its checks is part of the coverage query, the *Overall readiness* score or the Top 5 findings, and no Entity Overview button links to this tab. |
| Main source files | [`ui/app/tabs/InfraTabs.tsx`](../ui/app/tabs/InfraTabs.tsx#L77) (`OneAgentTab`), [`ui/app/tabs/ModePie.tsx`](../ui/app/tabs/ModePie.tsx), [`ui/app/tabs/OneAgentSearch.tsx`](../ui/app/tabs/OneAgentSearch.tsx), [`ui/app/RemediationPanel.tsx`](../ui/app/RemediationPanel.tsx#L476), [`ui/app/remediation.ts`](../ui/app/remediation.ts#L124), [`ui/app/queries.ts`](../ui/app/queries.ts#L147), [`ui/app/analyses.ts`](../ui/app/analyses.ts#L101) |

## Contents

- [What this page answers](#what-this-page-answers)
- [Before you start](#before-you-start)
  - [App scopes used by this page](#app-scopes-used-by-this-page)
  - [User permissions](#user-permissions)
  - [One-time setup](#one-time-setup)
- [Page walkthrough](#page-walkthrough)
  - [Documentation link and shell controls](#documentation-link-and-shell-controls)
  - [Loading and errors](#loading-and-errors)
  - [AI Assist panel](#ai-assist-panel)
  - [Heading and newest version](#heading-and-newest-version)
  - [Current versions gauge](#current-versions-gauge)
  - [Full-stack mode gauge](#full-stack-mode-gauge)
  - [OneAgents by monitoring mode donut](#oneagents-by-monitoring-mode-donut)
  - [OneAgents by version donut](#oneagents-by-version-donut)
  - [Find hosts](#find-hosts)
  - [Remediation actions](#remediation-actions-section)
- [Checks and scoring](#checks-and-scoring)
- [Queries](#queries)
  - [Version spread logic (client side)](#version-spread-logic-client-side)
- [API calls](#api-calls)
- [Remediation actions](#remediation-actions)
- [AI Assist on this page](#ai-assist-on-this-page)
- [Limitations and edge cases](#limitations-and-edge-cases)
- [Troubleshooting](#troubleshooting)
- [Related pages](#related-pages)
- [Source files](#source-files)

## What this page answers

- **Are my OneAgents up to date?** The *Current versions* gauge: share of OneAgents whose version is within 2 of the
  newest minor version seen in this environment. AI Assist adds how many are far behind and how many distinct versions
  are in use.
- **Which versions are deployed, and on which hosts?** The *OneAgents by version* donut (one slice per version, build
  suffix cut off) and *Find hosts*.
- **Which hosts are not in full-stack mode?** The *Full-stack mode* gauge, the *OneAgents by monitoring mode* donut,
  and *Find hosts* filtered by mode.
- **How do I fix it?** Enable automatic updates for the whole environment (`builtin:deployment.oneagent.updates`),
  change the monitoring mode of the hosts you pick (`builtin:host.monitoring.mode`), or the manual steps
  (update overrides per host group / host in the UI, `oneagentctl --set-monitoring-mode`).

The best practice checked: OneAgents converge on a small set of current versions through an automatic update policy,
and hosts where deep monitoring is intended run in full-stack mode. The reference is the newest version in this
environment, not the latest Dynatrace release (AI Assist states this). The fixes cite these Dynatrace pages:

- [OneAgent update](https://docs.dynatrace.com/docs/setup-and-configuration/dynatrace-oneagent/oneagent-update)
- [Enable OneAgent monitoring modes](https://docs.dynatrace.com/docs/platform/oneagent/monitoring-modes/enable-monitoring-modes)
- [oneagentctl reference](https://docs.dynatrace.com/docs/ingest-from/dynatrace-oneagent/oneagent-configuration-via-command-line-interface)

## Before you start

### App scopes used by this page

From [`app.config.json`](../app.config.json):

| Scope | What this page uses it for |
| --- | --- |
| `storage:smartscape:read` | Every DQL query (`smartscapeNodes "ONEAGENT"`, `"HOST"`, `traverse` to hosts) |
| `settings:objects:read` | Read the environment's OneAgent update policy (`builtin:deployment.oneagent.updates`) when the *Enable automatic updates* action is shown |
| `settings:objects:write` | Write the update policy (PUT or POST) and the monitoring mode objects (`builtin:host.monitoring.mode`), including the `validateOnly` dry runs |

Intents and app links (*Open in Notebook*, *Add to Dashboard*, *Host overview*, *Deployment status*, the Settings
links) need no scope.

### User permissions

Calls run as the signed-in user, limited to the app scopes. The user needs:

- Grail permission to read Smartscape nodes (`storage:smartscape:read`).
- To read the update policy: `settings:objects:read` (the SDK lists `environment:roles:manage-settings` as the
  alternative).
- To change the update policy or monitoring modes: `settings:objects:write` (or `environment:roles:manage-settings`)
  for the schemas `builtin:deployment.oneagent.updates` and `builtin:host.monitoring.mode`. Policies can restrict
  settings permissions by schema, so check both schemas are allowed.
- Access to Notebooks, Dashboards, Infrastructure & Operations, Deployment Status and Settings for the links.

### One-time setup

None. No credential vault entry, outbound connection or OAuth client is needed.

## Page walkthrough

Rendered by `OneAgentTab` followed by `<RemediationPanel tab="oneagent" />` ([`App.tsx`](../ui/app/App.tsx#L136)).

### Documentation link and shell controls

- **OneAgents documentation** (top right): opens this page on GitHub
  (`https://github.com/Chr0dine/dt-apps/blob/main/apps/architect-assistant/docs/oneagents.md`).
- **Timeframe** (header): *Last 24 hours* (default), *Last 7 days*, *Last 30 days*. All queries use
  `from:now()-24h` / `-7d` / `-30d` and re-run when it changes. For 7 and 30 days, agents that existed earlier in
  the window (including decommissioned ones) are counted too.
- **AI Assist** (header): toggles the AI Assist panel.

### Loading and errors

Everything above the Remediation actions (AI Assist panel, gauges, donuts, Find hosts) sits inside the loading/error
state of [query 1](#1-oneagent-versions-and-modes-oneagentquery). Until it returns, the tab shows only "Loading…"; if
it fails, a critical box **Query failed** with the error text. The monitoring-mode donut has its own query and its
own loading/error state inside its card. The Remediation actions section is outside both and always shown.

### AI Assist panel

At the top while AI Assist is on; see [AI Assist on this page](#ai-assist-on-this-page).

### Heading and newest version

Heading **OneAgent**, then: "Version spread and monitoring mode. “Current” means within 2 releases of the newest
version seen in this tenant."

**Newest version available in this tenant: `<version>`**: the highest full version string of query 1 (ignoring
`(unknown)`), compared segment by segment numerically (`compareVersions`), shown with its build suffix cut off
(`shortVersion`, for example `1.347.62.20261019-084101` is shown as `1.347.62.20261019`). The line is hidden when no
version is known. This is the same reference the *Current versions* gauge measures against (see
[Version spread logic](#version-spread-logic-client-side)).

The two gauges and two donut cards share one row that does not wrap; the donut cards share the remaining width.

### Current versions gauge

Custom SVG gauge (`PctGauge`, red-to-green gradient, rounded integer percent) on a card.

| Element | Value |
| --- | --- |
| Number | `round(100 × current / total)`, 0 when `total` is 0 |
| `total` | Sum of `agents` over all rows of query 1 |
| `current` | Sum of `agents` over rows with `behind ≤ 2` |
| `behind` | `latestMinor − minor(version)`; `minor` is the second dotted segment of the version (`1.347.62...` gives 347); `latestMinor` is the highest minor in query 1 |
| Caption / detail | "Current versions" / "within 2 releases of newest" |
| In place | An agent whose minor version is at most 2 below the newest minor in the environment |

### Full-stack mode gauge

| Element | Value |
| --- | --- |
| Number | `round(100 × fullStack / total)` |
| `fullStack` | Sum of `agents` over rows with `mode == "FULL_STACK"` |
| Caption / detail | "Full-stack mode" / "vs infrastructure/discovery" |
| In place | `dt.agent.monitoring_mode` is `FULL_STACK` |

### OneAgents by monitoring mode donut

Card **OneAgents by monitoring mode** (`MonitoringModePie`, [`ModePie.tsx`](../ui/app/tabs/ModePie.tsx#L123)), fed by
[query 2](#2-oneagents-by-monitoring-mode-oneagentmodesquery). Custom SVG donut, 170 px, legend to the left of the
donut.

- **Slices:** one per monitoring mode with more than 0 agents, in query order (most agents first); nothing is merged
  into "Other". Label = the mode formatted (`FULL_STACK` → *Full Stack*, `INFRASTRUCTURE` → *Infrastructure*,
  `DISCOVERY` → *Discovery*, no mode → *Unknown*).
- **Colours:** Full Stack `#4589FF`, Infrastructure `#A56EFF`, Discovery `#2DB7A3`, Unknown `#8D8D8D`; any other mode
  takes `#FF832B`, `#EE5396`, `#D2A106`, `#33B1FF` by position.
- **Centre:** total agents and "OneAgents"; while hovering (or while a slice is selected) the slice's count and label.
- **Legend:** colour swatch, label (bold when selected), count (bold), share rounded to an integer percent.
- **Hover:** the slice widens and the others fade; the browser tooltip reads "`<label>`: `<count>` (`<pct>`%)".
- **Click** a slice or legend row: selects that mode (raw value, for example `INFRASTRUCTURE`) as the *Monitoring mode*
  filter of Find hosts and runs the search at once; clicking it again clears it. The *Unknown* slice (no mode) cannot
  be clicked.
- Empty: "No OneAgents found in this timeframe."
- Below: **Show DQL / Copy / ↗ Open in Notebook / ↗ Add to Dashboard** for query 2 (title "OneAgents by monitoring
  mode"). Notebook / Dashboard send the intents `dynatrace.notebooks` `view-query` and `dynatrace.dashboards`
  `add-to-dashboard` with `{ "dt.query": <query>, "title": <title> }`.

### OneAgents by version donut

Card **OneAgents by version**, built in the browser from query 1 (`versionSlices` in `OneAgentTab`). Same donut
component, 170 px, legend to the right.

- **Slices:** one per short version (build suffix after `-` cut off), with the agents of all modes summed. Builds that
  differ only in the suffix share a slice. Sorted newest first by `compareVersions`; `(unknown)` sorts last.
- **Colours:** evenly spread hues so every version is distinct: slice `i` of `n` gets
  `hsl(round(i × 360 / n + 215) mod 360, 65%, 55%)`; `(unknown)` is grey `#8D8D8D`.
- Centre, legend, hover and tooltip as above.
- **Click** a slice: sets the *OneAgent version* filter of Find hosts to that short version and runs the search;
  click again to clear. `(unknown)` cannot be clicked.
- Empty: "No OneAgents found in this timeframe."
- Below: **Show DQL / Copy / Open in Notebook / Add to Dashboard** for query 1 (title "OneAgent versions and modes").

Under the row: "Click a slice in either donut to list matching hosts under “Find hosts”; click it again to clear."

### Find hosts

Card **Find hosts** (`OneAgentSearch`, [`OneAgentSearch.tsx`](../ui/app/tabs/OneAgentSearch.tsx#L161)), runs
[query 4](#4-find-hosts-oneagentsearchquery).

| Control | Options | Query clause |
| --- | --- | --- |
| **Host name contains** | Text, placeholder "e.g. ip-172" | `contains(name, "<text>", caseSensitive:false)` on the OneAgent node |
| **OneAgent version** | *Any version*, then every short version of query 1, newest first | `(dt.agent.module.version == "<v>" or startsWith(dt.agent.module.version, "<v>-"))`, so all builds of that version match |
| **Monitoring mode** | *Any mode*, then every mode of query 1 (raw values shown formatted) | `dt.agent.monitoring_mode == "<mode>"` |
| **Host group** | Searchable selector: *Any host group*, *No host group*, then up to 100 host groups | `toString(dt.host_group.id) == "<group>"` or `isNull(dt.host_group.id)` on the host node |
| **Search hosts** | Button | Runs the search |

- The version and mode filters are shared with the donuts: selecting a slice changes the dropdown and the highlighted
  slice follows the dropdown.
- A change that comes from a **donut** searches immediately (with the current name and host group as well); clearing
  both donut selections hides the results.
- A change made in a **dropdown**, the name box or the host group selector only clears the previous results and waits
  for **Search hosts**.
- **Host group selector** (`HostGroupSelect`): typing in its filter box searches server-side after 300 ms
  ([query 3](#3-host-group-search-hostgroupsearchquery)); the list shows the top 100 matching groups by host count.
  The selected group stays in the list even when the current search no longer matches it.

Results (sortable, full-width table):

| Column | Source | Notes |
| --- | --- | --- |
| Host | `name` (host node) | |
| OneAgent version | `version` (full, with build suffix) | from the OneAgent node |
| Monitoring mode | `mode`, formatted | from the OneAgent node |
| Host group | `hostGroup`, "—" when empty | from the host node |
| Links | | **Host overview ↗** (intent `dynatrace.infraops` `view_host`, `meId` = host ID); **Deployment status ↗** (app link `dynatrace.classic.deployment.status`, page `oneagents`; that app has no URL filter, so it opens the unfiltered OneAgents page); **Copy name** copies the host name for its filter bar |

- Rows are sorted in the browser: newest OneAgent version first (numeric segment comparison of the full version), then
  host name.
- At most 500 rows; when 500 come back: "Showing the first 500 hosts."
- Empty: "No hosts match these filters." Loading: "Loading…". Error: **Query failed**.
- Below the table: the Deployment status note and **Show DQL / Copy / Open in Notebook / Add to Dashboard** for the
  query that ran (title "OneAgent host search").

### Remediation actions section

Card **Remediation actions** (anchor `remediation-oneagent`), impact line "Keep OneAgents current and in full-stack
mode." (static text), and an **Action** dropdown:

1. *API · Enable automatic updates* (selected by default, so its Settings read runs when the tab opens)
2. *API · Change monitoring mode (Settings API)*
3. *Manual · Update overrides per host group / host*
4. *Manual · Monitoring mode with oneagentctl (single host)*

Each action ends with **Documentation for this fix** links. Details in [Remediation actions](#remediation-actions).

## Checks and scoring

| Check | In place when | Numerator | Denominator | Severity / thresholds | Notes |
| --- | --- | --- | --- | --- | --- |
| Current versions | `behind ≤ 2` (minor-number difference to the newest minor in the environment) | agents with `behind ≤ 2` | all agents | Gauge colour; AI Assist: good ≥ 90%, warning ≥ 50%, critical below | `(unknown)` versions count as minor 0, so as not current |
| Full-stack mode | `mode == "FULL_STACK"` | full-stack agents | all agents | Gauge colour | Infrastructure, Discovery and unknown count against it |
| Far behind (AI Assist only) | — | agents with `behind > 10` | — | critical when > 0 | |
| Version count (AI Assist only) | — | distinct full version strings | — | warning when > 5 | Build suffixes count as separate versions here, unlike the donut |

Percentages are rounded with `Math.round`; 0 when there are no agents. None of these checks feed Entity Overview.

## Queries

| # | Name (function in source) | Runs when | Feeds |
| --- | --- | --- | --- |
| 1 | OneAgent versions and modes (`oneAgentQuery`) | Tab opens | Newest version, both gauges, version donut, Find hosts dropdowns, AI Assist |
| 2 | OneAgents by monitoring mode (`oneAgentModesQuery`) | Tab opens | Monitoring mode donut |
| 3 | Host group search (`hostGroupSearchQuery`) | Find hosts mounts (after query 1), on typing in the host group filter; also in the *Change monitoring mode* form | Host group selector |
| 4 | Find hosts (`oneAgentSearchQuery`) | Donut click or *Search hosts* | Find hosts table |
| 5 | Hosts for monitoring mode change (`oneAgentSearchQuery`) | *Find hosts* in the *Change monitoring mode* action | Target host list and request |

All run through `useDql` ([`useDql.ts`](../ui/app/useDql.ts)) and re-run when their text changes. The shell's
`coverageQuery` also runs while this tab is open, but nothing on this tab uses its result.

### 1. OneAgent versions and modes (`oneAgentQuery`)

- **Source:** [`queries.ts`](../ui/app/queries.ts#L147).
- **Runs:** on tab open; re-runs on timeframe change.
- **Parameters:** timeframe (`from:now()-24h` becomes `-7d` / `-30d`).
- **Query:**

```dql
smartscapeNodes "ONEAGENT", from:now()-24h
| summarize agents = count(), by:{mode = dt.agent.monitoring_mode, version = dt.agent.module.version}
| sort agents desc
```

- **How it works:** `smartscapeNodes "ONEAGENT"` returns every OneAgent node in the timeframe. `summarize` counts them
  per combination of monitoring mode (`dt.agent.monitoring_mode`: `FULL_STACK`, `INFRASTRUCTURE`, `DISCOVERY`) and
  version (`dt.agent.module.version`, for example `1.347.62.20261019-084101`). `sort agents desc` puts the largest
  combinations first.
- **Output:** `mode`, `version`, `agents`. Mapped to `{ mode: mode ?? "(unknown)", version: version ?? "(unknown)",
  agents }` plus `behind`; used as described in the next section.
- **Limits and cost:** no limit; one row per mode/version pair; Smartscape only.
- **Open it yourself:** yes, under the version donut ("OneAgent versions and modes").

### Version spread logic (client side)

In `OneAgentTab` ([`InfraTabs.tsx`](../ui/app/tabs/InfraTabs.tsx#L72)) and
[`OneAgentSearch.tsx`](../ui/app/tabs/OneAgentSearch.tsx#L34):

1. **Minor number:** `minorOf(version) = Number(version.split(".")[1])`, 0 when not a number. `1.347.62.20261019-084101`
   gives 347; `(unknown)` gives 0.
2. **Newest minor:** `latest = max(0, minor of every row)`.
3. **Behind:** `behind = latest − minorOf(version)` per row. This is the difference of minor numbers, not divided by
   two. Dynatrace release numbers go up by 2 (1.343, 1.345, 1.347, per the comment in
   [`activeGates.ts`](../ui/app/activeGates.ts#L400)), so `behind ≤ 2` covers the newest release and the one before
   it, and `behind > 10` means more than five releases behind. The ActiveGates tab divides by two; this tab does not.
4. **Current versions gauge:** agents with `behind ≤ 2` / all agents.
5. **Build-suffix cutting:** `shortVersion(v) = v.split("-")[0]`, so `1.347.62.20261019-084101` becomes
   `1.347.62.20261019`. Used for the version donut slices, the Find hosts version dropdown and the newest-version line.
   The search then matches the short version exactly or any `<short>-<suffix>` build.
6. **Ordering:** `compareVersions(a, b)` splits on `.`, parses each segment as an integer (non-numbers count as 0) and
   compares segment by segment. Used for the newest-version line, the donut order, the dropdown order and the Find
   hosts row order.
7. **Newest version line:** the largest full version by `compareVersions` (excluding `(unknown)`), shown short. Its
   minor equals `latest` whenever a known version exists.

### 2. OneAgents by monitoring mode (`oneAgentModesQuery`)

- **Source:** [`queries.ts`](../ui/app/queries.ts#L176), run by `MonitoringModePie`.
- **Runs:** on tab open; re-runs on timeframe change.
- **Query:**

```dql
smartscapeNodes "ONEAGENT", from:now()-24h
| summarize agents = count(), by:{mode = dt.agent.monitoring_mode}
| sort agents desc
```

- **How it works:** counts OneAgent nodes per monitoring mode, most agents first. A `null` mode becomes the *Unknown*
  slice.
- **Output:** `mode`, `agents` → one slice each (slices with 0 agents dropped).
- **Limits and cost:** a handful of rows; Smartscape only.
- **Open it yourself:** yes, in the donut card ("OneAgents by monitoring mode").

### 3. Host group search (`hostGroupSearchQuery`)

- **Source:** [`queries.ts`](../ui/app/queries.ts#L206), run by `HostGroupSelect`.
- **Runs:** when Find hosts appears (empty search), and 300 ms after each change of the selector's filter text. Also
  in the *Change monitoring mode* form when that action is selected.
- **Parameters:** timeframe; the trimmed filter text (empty = no text condition), escaped as a DQL string.
- **Query (empty search):**

```dql
smartscapeNodes "HOST", from:now()-24h
| filter isNotNull(dt.host_group.id)
| summarize hosts = count(), by:{hostGroup = dt.host_group.id}
| sort hosts desc
| limit 100
```

  With the text `prod`, the filter line becomes:

```dql
| filter isNotNull(dt.host_group.id) and contains(toString(dt.host_group.id), "prod", caseSensitive:false)
```

- **How it works:** hosts with a host group (optionally whose name contains the text, case-insensitive), counted per
  group, largest first, top 100. A tenant can have thousands of host groups, so the search runs server-side instead
  of loading every group.
- **Output:** `hostGroup` values become the selector options (`hosts` is only used for ordering).
- **Open it yourself:** no.

### 4. Find hosts (`oneAgentSearchQuery`)

- **Source:** [`queries.ts`](../ui/app/queries.ts#L188), run by `Results` in `OneAgentSearch.tsx`.
- **Runs:** on a donut click (immediately) or on *Search hosts*. Not on tab open.
- **Parameters:** name, short version, raw mode, host group (`""` = any, `__none__` = no host group), timeframe. Each
  set filter adds a clause; an empty filter adds nothing.
- **Query (no filter):**

```dql
smartscapeNodes "ONEAGENT", from:now()-24h
| traverse edgeTypes:{monitors}, targetTypes:{HOST}, fieldsKeep:{dt.agent.module.version, dt.agent.monitoring_mode}
| fieldsAdd agent = dt.traverse.history[0]
| fieldsAdd version = agent[`dt.agent.module.version`], mode = agent[`dt.agent.monitoring_mode`]
| fields id, name, version, mode, hostGroup = dt.host_group.id
| sort name asc
| limit 500
```

- **All filters set** (name `ip-172`, version `1.347.62.20261019`, mode `FULL_STACK`, host group `my-host-group`):

```dql
smartscapeNodes "ONEAGENT", from:now()-24h
| filter contains(name, "ip-172", caseSensitive:false) and (dt.agent.module.version == "1.347.62.20261019" or startsWith(dt.agent.module.version, "1.347.62.20261019-")) and dt.agent.monitoring_mode == "FULL_STACK"
| traverse edgeTypes:{monitors}, targetTypes:{HOST}, fieldsKeep:{dt.agent.module.version, dt.agent.monitoring_mode}
| filter toString(dt.host_group.id) == "my-host-group"
| fieldsAdd agent = dt.traverse.history[0]
| fieldsAdd version = agent[`dt.agent.module.version`], mode = agent[`dt.agent.monitoring_mode`]
| fields id, name, version, mode, hostGroup = dt.host_group.id
| sort name asc
| limit 500
```

- *No host group* replaces the host filter with `| filter isNull(dt.host_group.id)`. A single filter adds only its
  own clause, for example a mode slice click gives `| filter dt.agent.monitoring_mode == "INFRASTRUCTURE"`.
- **How it works:**
  - `smartscapeNodes "ONEAGENT"`: OneAgent nodes in the timeframe.
  - First `filter`: the agent-level conditions (name, version, mode) joined with `and`, applied before the traversal.
  - `traverse edgeTypes:{monitors}, targetTypes:{HOST}, fieldsKeep:{...}`: follows each agent's `monitors` edge to the
    `HOST` node it monitors. The records are now hosts; `fieldsKeep` keeps the agent's version and mode in
    `dt.traverse.history`.
  - Second `filter`: the host-group condition, on the host node (which carries `dt.host_group.id`).
  - `fieldsAdd agent = dt.traverse.history[0]` and the next line: read the agent's version and mode back from the
    first history entry.
  - `fields id, name, version, mode, hostGroup = dt.host_group.id`: host ID and name, agent version and mode, host
    group. `sort name asc | limit 500`.
- **Output:** each record becomes a table row; `id` (a `ONEAGENT-` prefix would be replaced by `HOST-`) drives the
  host overview link.
- **Limits and cost:** `limit 500` applied after sorting by name, then re-sorted by version in the browser.
- **Open it yourself:** yes, below the results ("OneAgent host search").

### 5. Hosts for monitoring mode change (`oneAgentSearchQuery`)

Same builder as query 4, called by `MonitoringModeForm` with `version: ""`, the *Hosts currently in* value as mode
(`FULL_STACK`, `INFRASTRUCTURE` or `DISCOVERY`, or none), the host group and the name. Runs on its *Find hosts*
button, and again when *Change to* changes (the list is remounted). Example (hosts in Infrastructure mode in
`my-host-group`):

```dql
smartscapeNodes "ONEAGENT", from:now()-24h
| filter dt.agent.monitoring_mode == "INFRASTRUCTURE"
| traverse edgeTypes:{monitors}, targetTypes:{HOST}, fieldsKeep:{dt.agent.module.version, dt.agent.monitoring_mode}
| filter toString(dt.host_group.id) == "my-host-group"
| fieldsAdd agent = dt.traverse.history[0]
| fieldsAdd version = agent[`dt.agent.module.version`], mode = agent[`dt.agent.monitoring_mode`]
| fields id, name, version, mode, hostGroup = dt.host_group.id
| sort name asc
| limit 500
```

Output: `id` becomes the settings scope, `name` and `mode` the host list. Exposed with Show DQL / Copy / Notebook /
Dashboard ("Hosts for monitoring mode change").

## API calls

| Method | Endpoint / SDK method | Scope | When |
| --- | --- | --- | --- |
| GET | `/platform/classic/environment-api/v2/settings/objects?schemaIds=builtin:deployment.oneagent.updates&scopes=environment&fields=objectId,value,updateToken` (`settingsObjectsClient.getSettingsObjects`) | `settings:objects:read` | When *Enable automatic updates* is shown (default action, so on tab open) |
| PUT | `/platform/classic/environment-api/v2/settings/objects/{objectId}?validateOnly=true\|false` (`putSettingsObjectByObjectId`) | `settings:objects:write` | *Validate* / *Apply* when an update policy object exists |
| POST | `/platform/classic/environment-api/v2/settings/objects?validateOnly=true\|false` (`postSettingsObjects`), schema `builtin:deployment.oneagent.updates` | `settings:objects:write` | *Validate* / *Apply* when no object exists |
| POST | `/platform/classic/environment-api/v2/settings/objects?validateOnly=true\|false`, schema `builtin:host.monitoring.mode`, one object per host | `settings:objects:write` | *Validate* / *Change mode* |
| Intent | `dynatrace.notebooks` `view-query`, `dynatrace.dashboards` `add-to-dashboard` | none | Query actions |
| Link | `dynatrace.infraops` `view_host`; app `dynatrace.classic.deployment.status` page `oneagents`; `dynatrace.settings` `open_settings_for_schema` | none | Table and form links |

Request and response details are in the next section.

## Remediation actions

### API: Enable automatic updates

Switches the environment-wide OneAgent update policy to automatic updates on the rolling `latest` target. Source:
`AutoUpdateForm` ([`RemediationPanel.tsx`](../ui/app/RemediationPanel.tsx#L607)), `readOneAgentUpdateSetting` and
`applyAutoUpdates` ([`remediation.ts`](../ui/app/remediation.ts#L129)).

1. **Read** (on mount): the GET above. The app uses `items[0].objectId`, `items[0].value.updateMode` (default
   `AUTOMATIC` when missing), `value.targetVersion` (default `latest`) and `updateToken`. It shows **Current policy:
   `<updateMode>`, target `<targetVersion>`**, "reading…" while loading, or "unknown" when no object exists or the
   read failed (then also "Could not read the setting: `<message>`" in red).
2. **Request** block (folded, with Copy), labelled "Request (PUT, 1 API call)" when an object exists, otherwise
   "(POST, 1 API call)". It always shows:

   ```json
   {
     "schemaId": "builtin:deployment.oneagent.updates",
     "scope": "environment",
     "value": {
       "updateMode": "AUTOMATIC",
       "targetVersion": "latest"
     }
   }
   ```

   The request actually sent for an existing object is
   `PUT /platform/classic/environment-api/v2/settings/objects/<objectId>?validateOnly=...` with
   `{ "value": { "updateMode": "AUTOMATIC", "targetVersion": "latest" }, "updateToken": "<updateToken>" }`.
   Without an object it is `POST .../settings/objects?validateOnly=...` with the body above wrapped in an array.
   The value contains only these two properties.
3. If `updateMode` is already `AUTOMATIC`: "Automatic updates are already on." and no buttons. Otherwise (for example
   `MANUAL` or `AUTOMATIC_DURING_MW`):
   - Checkbox **Switch the whole environment to automatic updates**.
   - **Validate** (`validateOnly=true`, no confirmation needed) and **Apply** (`validateOnly=false`, needs the
     checkbox). Both are disabled while the read is still running.
4. **Results:** a response `code` of 400 or more gives "`<error.message>`" or "Rejected (HTTP `<code>`)."; success
   gives "Validation passed. Nothing was saved." or "Auto-update policy updated." / "Auto-update policy created."
   with the object ID. After a successful Apply the form shows the policy as `AUTOMATIC, target latest` and "Automatic
   updates are already on."

**Documentation for this fix:** [OneAgent update](https://docs.dynatrace.com/docs/setup-and-configuration/dynatrace-oneagent/oneagent-update).

### API: Change monitoring mode (Settings API)

Sets `builtin:host.monitoring.mode` on every selected host in one POST (one object per host, scope = host ID). The
schema stores the mode on the agent; processes pick it up after a restart, and the agent overwrites it if the mode is
changed with `oneagentctl`. Source: `MonitoringModeForm`, `ModeTargets`
([`RemediationPanel.tsx`](../ui/app/RemediationPanel.tsx#L476)), `setMonitoringModes`
([`remediation.ts`](../ui/app/remediation.ts#L286)).

| Field | Options |
| --- | --- |
| **Change to** | *Full Stack* (`FULL_STACK`, default), *Infrastructure* (`INFRA_ONLY`), *Discovery* (`DISCOVERY`) |
| **Hosts currently in** | *Any mode*, *Full Stack*, *Infrastructure*, *Discovery* (filters on the observed Smartscape value; Smartscape reports `INFRASTRUCTURE` for `INFRA_ONLY`) |
| **Host group** | Same searchable selector as Find hosts |
| **Host name contains** | Text |
| **Find hosts** | Runs [query 5](#5-hosts-for-monitoring-mode-change-oneagentsearchquery) |

A link "Open the host monitoring mode settings (change one host in the UI: Host settings > Host monitoring)" opens
Settings on the schema (intent `dynatrace.settings` `open_settings_for_schema`, `settings.schemaId`).

After *Find hosts*:

- Hosts already in the target mode are dropped. Text: "`<n>` hosts will move to **`<mode>`** (`<m>` already in
  `<mode>` skipped)." or, when none is left, "No matching hosts need a change (hosts already in `<mode>` are skipped)."
- **Show hosts** (folded): "`<name>` — now `<mode>`" with a **Monitoring mode settings ↗** link per host (same intent
  plus `settings.entityId` = host ID).
- **Request (1 API call for N hosts)** showing the first two objects and "// … N more objects in the same request":

  ```json
  [
    { "schemaId": "builtin:host.monitoring.mode", "scope": "HOST-0000000000000001", "value": { "monitoringMode": "FULL_STACK" } },
    { "schemaId": "builtin:host.monitoring.mode", "scope": "HOST-0000000000000002", "value": { "monitoringMode": "FULL_STACK" } }
  ]
  ```

  sent as `POST /platform/classic/environment-api/v2/settings/objects?validateOnly=true|false`.
- Hint on license consumption, when hosts apply the change and the `oneagentctl` override.
- Checkbox **Change the monitoring mode of N hosts to `<mode>`**; **Validate** (dry run, no checkbox needed) and
  **Change mode** (needs the checkbox).
- **Results:** the response has one entry per object. All below 400: "Validation passed for N hosts. Nothing was
  changed." or "Monitoring mode set to `<mode>` on N hosts. Hosts apply it when connected; restart monitored processes
  to pick it up." Otherwise "`<k>` of N hosts rejected: `<first error message>`". The host list is not re-queried.
- Loading "Finding hosts…"; query errors in red. Query actions for query 5 at the bottom.

**Documentation for this fix:** [Enable OneAgent monitoring modes](https://docs.dynatrace.com/docs/platform/oneagent/monitoring-modes/enable-monitoring-modes),
[oneagentctl reference](https://docs.dynatrace.com/docs/ingest-from/dynatrace-oneagent/oneagent-configuration-via-command-line-interface).

### Manual: Update overrides per host group / host

No command. Steps:

1. Settings > Fleet management > OneAgent version and updates > Configure updates.
2. For overrides, open Configure updates from the entity in Fleet Management.
3. Restart monitored server processes after an update.

Note: "Host settings override host group settings, which override global settings. Update windows don't apply in
Kubernetes." **Documentation for this fix:** [OneAgent update](https://docs.dynatrace.com/docs/setup-and-configuration/dynatrace-oneagent/oneagent-update).

### Manual: Monitoring mode with oneagentctl (single host)

Variant dropdown *Linux / AIX* / *Windows*, with Copy:

```bash
./oneagentctl --set-monitoring-mode=fullstack --restart-service
```

```powershell
.\oneagentctl.exe --set-monitoring-mode=fullstack --restart-service
```

Steps: identify hosts not in full-stack mode; run the command on each host; verify with `--get-monitoring-mode`.
Note: "Changes license consumption. Valid modes: fullstack, infra-only, discovery."
**Documentation for this fix:** [oneagentctl reference](https://docs.dynatrace.com/docs/ingest-from/dynatrace-oneagent/oneagent-configuration-via-command-line-interface).

Manual actions send nothing to the tenant.

## AI Assist on this page

Rule-based and local: `analyzeOneAgent` in [`analyses.ts`](../ui/app/analyses.ts#L101), a pure function of query 1's
rows (`mode`, full `version`, `agents`, `behind`). No AI service is called.

**No agents:** summary "No OneAgent data is available for this timeframe."; insight (info) "No OneAgent entities
returned."; recommendation (medium) "Confirm OneAgents are connected to this tenant."

**Otherwise**, with `current` (`behind ≤ 2`), `old` (`behind > 10`), `notFull` (mode not `FULL_STACK`, including
unknown), `versions` (distinct full version strings) and `currentPct = round(100 × current / total)`:

- Summary: "`<total>` OneAgents report `<versions>` distinct version(s). `<currentPct>`% are within 2 releases of the
  newest seen in this tenant and `<total − notFull>` run in full-stack mode."

| Insight rule | Severity | Text |
| --- | --- | --- |
| Always | good ≥ 90%, warning ≥ 50%, critical below | "`<current>` of `<total>` agents are on a current version." |
| `old` > 0 | critical | "`<old>` agent(s) is/are more than 10 releases behind — likely missing fixes and features." |
| `notFull` > 0 | warning | "`<notFull>` agent(s) is/are not in full-stack mode (infrastructure/discovery) — deep code-level data is not collected." |
| `versions` > 5 | warning | "`<versions>` different versions in use suggests no automated update policy." |

| Recommendation rule | Impact | Text |
| --- | --- | --- |
| `old` > 0 or `versions` > 5 | high | "Enable automatic OneAgent updates (or a defined maintenance window) to converge on a small set of versions." |
| `notFull` > 0 | medium | "Review hosts in discovery/infrastructure mode and switch them to full-stack where deep monitoring is intended." |
| Always | low | "“Releases behind” compares against the newest version in this tenant, not the latest Dynatrace release." |

## Limitations and edge cases

- **Reference is local.** "Current" is relative to the newest version in this environment. If every agent is old, the
  gauge can still be 100%.
- **Minor difference, not releases.** `behind` is the difference in minor numbers; with releases numbered in steps of
  2, "within 2 releases" in the UI text means the newest and the previous release, and AI Assist's "more than 10
  releases behind" means more than five releases.
- **Unknown versions.** Agents without a version get minor 0, so they count as not current and, in AI Assist, as
  more than 10 behind.
- **Major version ignored.** Only the second segment is compared; a change of the first segment would not be handled.
- **Distinct versions differ between views.** The donut merges builds that differ only after `-`; AI Assist counts
  full strings.
- **Timeframe includes past agents.** 7 and 30 days also count agents that were replaced or decommissioned.
- **500 rows.** Find hosts and the mode-change list return the first 500 hosts by name; Find hosts then re-sorts them
  by version, so with more matches the newest versions may be missing. A mode change covers at most 500 hosts per run.
- **Name filter on the agent.** *Host name contains* is applied to the OneAgent node's `name` before the traversal,
  while the table shows the host node's name.
- **Unknown mode cannot be filtered.** Agents without a mode are not in the dropdown and their slice is not clickable.
- **Auto-update edge cases.** A policy that is `AUTOMATIC` with a pinned target version is reported as already on.
  The written value has only `updateMode` and `targetVersion`. If the read failed, Apply tries a POST.
- **Mode change takes effect later.** Hosts apply it when connected and processes after restart; Smartscape and this
  tab show the new mode only after that, and only when the queries run again.
- **Deployment status** cannot be opened on one host; use *Copy name* and paste it into its filter.

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| Whole tab shows **Query failed** | Missing `storage:smartscape:read` scope or user permission | Grant the permission; restart the app session after scope changes |
| "No OneAgents found in this timeframe." | No ONEAGENT nodes in the window | Widen the timeframe; check OneAgents are connected |
| Current policy "unknown" with "Could not read the setting" | Missing `settings:objects:read` permission | Grant settings read for `builtin:deployment.oneagent.updates` |
| Validate / Apply / Change mode rejected with a permission error | User lacks `settings:objects:write` for the schema | Grant settings write for `builtin:deployment.oneagent.updates` / `builtin:host.monitoring.mode` |
| "`<k>` of N hosts rejected: ..." | Some host scopes are not valid for the schema | Read the message; change the rejected hosts in Host settings > Host monitoring or with `oneagentctl` |
| Mode changed but donut unchanged | Agents apply it when connected; page does not poll | Wait, restart processes, re-open the tab or change the timeframe |
| Mode reverts | The mode was changed with `oneagentctl`, which overwrites the setting | Use one method consistently |
| Host group missing in the selector | Only the top 100 matches by host count are listed | Type part of its name |
| Find hosts shows fewer hosts than the donut slice | 500-row limit, or agents whose host could not be traversed | Narrow with more filters |

## Related pages

- [Index](README.md)
- [Host groups](host-groups.md): host group coverage and bulk assignment.
- [Deep Monitoring](deep-monitoring.md): code-module coverage; its diagnosis also switches hosts to Full-Stack.
- [ActiveGates](activegates.md): the same kind of version spread for ActiveGates (releases counted in steps of 2).
- [Kubernetes](kubernetes.md): monitoring modes of Operator-deployed OneAgents.

## Source files

| File | Role on this page |
| --- | --- |
| [`ui/app/App.tsx`](../ui/app/App.tsx) | Shell, timeframe, renders `OneAgentTab` + `RemediationPanel tab="oneagent"` |
| [`ui/app/areas.tsx`](../ui/app/areas.tsx) | Tab title, area (Visibility), documentation link |
| [`ui/app/tabs/InfraTabs.tsx`](../ui/app/tabs/InfraTabs.tsx) | `OneAgentTab`: version logic, gauges, version donut, layout |
| [`ui/app/tabs/ModePie.tsx`](../ui/app/tabs/ModePie.tsx) | `Donut` and `MonitoringModePie` |
| [`ui/app/tabs/OneAgentSearch.tsx`](../ui/app/tabs/OneAgentSearch.tsx) | Find hosts, `HostGroupSelect`, `shortVersion`, `compareVersions` |
| [`ui/app/queries.ts`](../ui/app/queries.ts) | `oneAgentQuery`, `oneAgentModesQuery`, `oneAgentSearchQuery`, `hostGroupSearchQuery`, `NO_HOST_GROUP` |
| [`ui/app/components.tsx`](../ui/app/components.tsx) | `PctGauge`, `QueryActions`, `QueryState`, `formatMode`, `pct` |
| [`ui/app/links.ts`](../ui/app/links.ts) | Host overview link |
| [`ui/app/deepMonitoring.ts`](../ui/app/deepMonitoring.ts) | `settingsLink` for the monitoring mode settings |
| [`ui/app/RemediationPanel.tsx`](../ui/app/RemediationPanel.tsx) | `AutoUpdateForm`, `MonitoringModeForm`, `ModeTargets`, manual action view |
| [`ui/app/remediation.ts`](../ui/app/remediation.ts) | Settings calls, request bodies, manual action text, documentation links |
| [`ui/app/analyses.ts`](../ui/app/analyses.ts) | `analyzeOneAgent` |
| [`ui/app/AIInsights.tsx`](../ui/app/AIInsights.tsx) | AI Assist panel |
| [`app.config.json`](../app.config.json) | Scopes |
