# Extensions

The Extensions tab lists every Extensions 2.0 monitoring configuration in the environment and tells you which ones
do not run as configured and why. For each configuration it shows the status (from extension self-monitoring), the
latest framework error, the fastcheck and assignment results, and where the configuration runs: local in OneAgent on
a host, a host group or the whole environment, or remote on an ActiveGate group. It also recommends extensions that
are not in use: SNMP extensions for network devices, and Dynatrace Hub extensions for technologies that OneAgent sees
on processes but no extension monitors. Data comes from the Extensions API (`/platform/extensions/v2`), the
`dt.sfm.extension.status` metric, extension framework events in `dt.system.events`, and OneAgent process instances.
The page is read-only: every remediation is a set of manual, documented steps.

| | |
| --- | --- |
| Area | Visibility (see [index](README.md)) |
| Tab id | `extensions` |
| Counts toward Entity Overview readiness / Top findings | no. Nothing on this tab feeds the Entity Overview score or the Top findings list. |
| Main source files | [ui/app/tabs/ExtensionsTab.tsx](../ui/app/tabs/ExtensionsTab.tsx), [ui/app/extensions.ts](../ui/app/extensions.ts), [ui/app/queries.ts](../ui/app/queries.ts#L1085) (Extensions section), [ui/app/databases.ts](../ui/app/databases.ts#L538) (Extensions API), [ui/app/activeGates.ts](../ui/app/activeGates.ts#L149) (statuses, remote action), [ui/app/analyses.ts](../ui/app/analyses.ts#L591) (`analyzeExtensions`) |

## Contents

- [What this page answers](#what-this-page-answers)
- [Before you start](#before-you-start)
  - [App scopes used by this page](#app-scopes-used-by-this-page)
  - [User permissions](#user-permissions)
  - [One-time setup](#one-time-setup)
- [Page walkthrough](#page-walkthrough)
  - [Documentation link and AI Assist](#documentation-link-and-ai-assist)
  - [Heading and introduction](#heading-and-introduction)
  - [Summary card: gauges and the Local vs remote donut](#summary-card-gauges-and-the-local-vs-remote-donut)
  - [Kind filter line](#kind-filter-line)
  - [Broken monitoring configurations](#broken-monitoring-configurations)
  - [Fastcheck log](#fastcheck-log)
  - [Configurations by where they run](#configurations-by-where-they-run)
  - [Re-check](#re-check)
  - [Remediation actions (section)](#remediation-actions-section)
  - [Extension recommendations](#extension-recommendations)
- [Checks and scoring](#checks-and-scoring)
  - [How one configuration is built from the sources](#how-one-configuration-is-built-from-the-sources)
  - [Kind (where it runs) and scope](#kind-where-it-runs-and-scope)
  - [Status and what counts as broken](#status-and-what-counts-as-broken)
  - [Fastcheck result classification](#fastcheck-result-classification)
  - [Gauges](#gauges)
  - [Recommendation coverage](#recommendation-coverage)
  - [Technology to Hub extension catalogue](#technology-to-hub-extension-catalogue)
  - [SNMP states](#snmp-states)
- [Queries](#queries)
- [API calls](#api-calls)
- [Remediation actions](#remediation-actions)
- [AI Assist on this page](#ai-assist-on-this-page)
- [Limitations and edge cases](#limitations-and-edge-cases)
- [Troubleshooting](#troubleshooting)
- [Related pages](#related-pages)
- [Source files](#source-files)

## What this page answers

- **Which extension monitoring configurations are broken, and why?** A configuration is broken when it is enabled,
  still in the environment, and its status is anything other than OK or IDLE (including WARNING, UNASSIGNED, every
  error state, and no status at all in the timeframe). The page shows the status, the latest framework warning or
  error, the hosts that are not OK (local) or the ActiveGate that runs it (remote), and the latest fastcheck result.
- **Did the fastcheck pass?** Before a remote configuration is assigned to an ActiveGate, the extension framework runs
  a fastcheck against its endpoints. Failed, passed, "not picked up" and "created" results are folded into a log with
  a count per distinct message.
- **Where does each configuration run?** Local (OneAgent on the hosts of its scope: one host, a host group or the whole
  environment), remote (an ActiveGate of the ActiveGate group it targets), Kubernetes, or cloud data acquisition. For
  local configurations, the page names and links the host or host group it is scoped to and flags a scope that has
  not reported in 30 days.
- **Which extensions should we add?** Network devices run no OneAgent, so SNMP Autodiscovery and the SNMP device
  extensions are the way to monitor them. For 31 technologies that OneAgent recognises on processes (application
  servers, message brokers, web and proxy servers, Windows services, Kubernetes and OpenShift control plane
  components, the OpenTelemetry Collector and others), the page shows how many hosts have a matching extension
  reporting and links to the extension.

Best practice checked (from the Dynatrace docs the code cites):

- Every state except OK and IDLE is an error ([Extensions health](https://docs.dynatrace.com/docs/observe/infrastructure-observability/extensions/extensions-health)); the status values come from `dt.extension.status` ([Semantic dictionary](https://docs.dynatrace.com/docs/semantic-dictionary/fields)).
- Remote extensions run only on ActiveGates that are in the targeted ActiveGate group and have the Extensions module enabled ([About Extensions](https://docs.dynatrace.com/docs/ingest-from/extensions/concepts), [Configuration properties and parameters of ActiveGate](https://docs.dynatrace.com/docs/ingest-from/dynatrace-activegate/configuration/configure-activegate)).
- A fastcheck failure keeps a configuration from being assigned ([SNMP extensions troubleshooting (fastcheck)](https://docs.dynatrace.com/docs/ingest-from/extensions/develop-your-extensions/data-sources/snmp-extensions/troubleshooting)).
- Local extension settings are inherited environment, then host group, then host; a host-scoped configuration stops running when the host is gone ([Manage extensions](https://docs.dynatrace.com/docs/ingest-from/extensions/manage-extensions)).
- Network devices: [SNMP Autodiscovery extension](https://docs.dynatrace.com/docs/observe/infrastructure-observability/extensions/snmp-autodiscovery) and [Generic network device extension](https://docs.dynatrace.com/docs/observe/infrastructure-observability/extensions/snmp-generic).

## Before you start

### App scopes used by this page

All scopes are declared in [app.config.json](../app.config.json). The page uses only read scopes.

| Scope | What this page uses it for |
| --- | --- |
| `extensions:definitions:read` | List every extension in the environment (`GET /platform/extensions/v2/extensions`): which extensions are installed, with their version, for the recommendations and the SNMP panel. A failure of this call puts the whole API part of the page in the error state. |
| `extensions:configurations:read` | Read every monitoring configuration of every extension (`GET /platform/extensions/v2/extensions/{name}/monitoring-configurations`): scope, activation context, enabled flag, description and version. |
| `storage:metrics:read` | `timeseries ... dt.sfm.extension.status` (remote and local status queries) and `fetch metric.series` (the "which extensions report from this host" lookup in the recommendation queries). |
| `storage:system:read` | `fetch dt.system.events` (latest framework warning or error, and the fastcheck log). |
| `storage:entities:read` | `fetch dt.entity.host` (host names in the local status query, scope names, process hosts), `fetch dt.entity.host_group` (scope names), `fetch dt.entity.process_group_instance` (recommendations). |
| `storage:smartscape:read` | `smartscapeNodes "ACTIVEGATE"` (ActiveGate names; ActiveGate groups with the Extensions module), `smartscapeNodes "K8S_CLUSTER"` (lookup inside the ActiveGate inventory query), `smartscapeNodes "PROCESS"` (Smartscape process ID for the process link in the processes panel). |

The page requests no write scope. The documentation freshness line in the Remediation actions section calls the
`docs-freshness` app function (see [index: Documentation freshness](README.md#documentation-freshness)).

### User permissions

App scopes are intersected with the signed-in user's own permissions. The user needs:

- Read access to the Extensions API: the IAM permissions `extensions:definitions:read` and
  `extensions:configurations:read`. If a policy limits `extensions:configurations:read` to some extensions (condition
  `extensions:extension-name`), the other extensions are listed as "not readable" under the Broken table.
- Grail read permissions for the tables queried: metrics, system events, classic entities and Smartscape (the
  `storage:*:read` permissions above, plus bucket access where the tenant's policies require it).
- Nothing else. Fixing a configuration happens outside the app (Extensions app, ActiveGate host, Dynatrace Hub) with
  the permissions those require.

### One-time setup

None for the data on this page: it needs no credential vault entry, OAuth client or token.

Optional: the "Guidance reviewed against the Dynatrace docs" line under *Remediation actions* reads the docs sitemap
through the `docs-freshness` app function. When `builtin:dt-javascript-runtime.allowed-outbound-connections` is
enforced, add `docs.dynatrace.com` to it, otherwise the line reads "Automatic docs check off".

## Page walkthrough

The sections below are in on-screen order. All queries start when you open the tab and run again when you change the
timeframe (24 hours, 7 days, 30 days in the app header), because the timeframe is part of each query's text (the
scope-names query is the exception: it always covers 30 days). The Extensions API is read once when the tab opens and
again only on *Re-check*.

### Documentation link and AI Assist

- **Extensions documentation** (top right, from [areas.tsx](../ui/app/areas.tsx)) opens this page on GitHub.
- **AI Assist panel**: when the *AI Assist* button in the app header is on, a panel at the top of the tab summarises the
  page. It is computed locally from the data on screen; see [AI Assist on this page](#ai-assist-on-this-page).

### Heading and introduction

Heading **Extensions** and a fixed paragraph: "Every extension monitoring configuration in the environment: which
ones are broken and why (status, latest error, fastcheck results), where each one runs (local in OneAgent on a host,
host group or the whole environment, or remote on an ActiveGate group), and extensions for technologies OneAgent sees
on processes that no extension monitors yet. Read from the Extensions API, extension self-monitoring
(dt.sfm.extension.status), extension framework events and OneAgent process instances."

### Summary card: gauges and the Local vs remote donut

Source: `SummaryCard` in [ExtensionsTab.tsx](../ui/app/tabs/ExtensionsTab.tsx#L315).

**Gauges.** Custom SVG gauges (`PctGauge`, red-to-green gradient, percentage rounded to an integer with
`Math.round`). Every gauge has an (i) button.

| Gauge | Shown when | Value | Detail line | (i) button |
| --- | --- | --- | --- | --- |
| **Configurations OK** | always | `round(100 × (judged − broken) / judged)`; 100 when no configuration is judged | `<judged − broken> of <judged> enabled configuration(s)`; `…` while the remote query, the local query or the Extensions API is still loading and nothing is judged yet | "Open the fix steps": scrolls to *Remediation actions* |
| **Local configurations OK** | at least one judged configuration of kind Local | `round(100 × ok / all)` over judged Local configurations | `<ok> of <all>` | scrolls to *Remediation actions* |
| **Remote configurations OK** | at least one judged configuration of kind Remote | same, over judged Remote configurations | `<ok> of <all>` | scrolls to *Remediation actions* |
| **Recommended extensions in place** | the recommendation query returned at least one host | `round(100 × Σ min(coveredHosts, hosts) / Σ hosts)` over all recommended technologies | `<covered> of <n> technology host(s)` | "Open the recommendations": scrolls to *Extension recommendations* |

*Judged* and *broken* are defined in [Status and what counts as broken](#status-and-what-counts-as-broken). Kubernetes
and cloud configurations have no gauge of their own but count in *Configurations OK* (cloud configurations are never
judged, see below). In *Recommended extensions in place*, a host is counted once per technology: a host that runs
Tomcat and Kafka counts twice.

**Local vs remote configurations** (custom SVG donut, `Donut` from [ModePie.tsx](../ui/app/tabs/ModePie.tsx)).

- One slice per kind with at least one configuration. Counted: every configuration that is still in the environment
  (not *gone*), including disabled ones.
- Slices and colours (fixed categorical palette slots, light / dark theme): **Local (OneAgent)** blue `#2a78d6` /
  `#3987e5`; **Remote (ActiveGate)** orange `#eb6834` / `#d95926`; **Kubernetes** aqua `#1baf7a` / `#199e70`;
  **Cloud integration** violet `#6250d6` / `#9085e9`.
- The centre shows the total and the word "configurations"; hovering a slice or its legend row shows that slice's
  count and label instead and dims the others. Each slice has a tooltip `<label>: <count> (<share>%)`. The legend lists
  label, count and share (rounded).
- **Click** a slice or legend row to filter the *Broken monitoring configurations* and *Configurations by where they
  run* tables to that kind; click the same slice again to clear. The filter does not apply to the fastcheck log or the
  recommendations. Changing the timeframe clears it.
- Empty: "Loading…" while loading, otherwise "No extension monitoring configuration in this environment."
- Hint under the donut: "Local: OneAgent on the hosts in the scope. Remote: an ActiveGate of the targeted group. Click a
  slice to filter the tables below."

**Network devices strip.** When SNMP Autodiscovery or the SNMP device extensions are in state *none* (not in use) or
*installed* (installed without a configuration), a strip with a yellow edge reads, for example: "Network devices: SNMP
Autodiscovery not in use, SNMP device extensions not configured. SNMP extensions add routers, switches and firewalls to
Dynatrace." The **See recommendations** button scrolls to *Extension recommendations*. See [SNMP states](#snmp-states).

**DQL behind these numbers** (collapsed `<details>`). Three query action bars (Show DQL, Copy, Open in Notebook, Add to
Dashboard; see [index](README.md#query-actions-show-dql-copy-open-in-notebook-add-to-dashboard)):

| Caption | Notebook / dashboard title | Query |
| --- | --- | --- |
| Remote configurations: latest status per configuration on an ActiveGate group (same query as the ActiveGates tab) | Extensions: remote configurations by status | [Q1](#q1-remote-configuration-status-activegateextensionsquery) |
| Local and Kubernetes configurations: latest status per configuration and host | Extensions: local configurations by status per host | [Q2](#q2-local-configuration-status-per-host-localextensionstatusquery) |
| Recommended technologies and the hosts where their extension reports | Extensions: recommended extensions per technology | [Q7](#q7-recommended-technologies-extensionrecommendationsquery) |

A last line states that scope, activation context and enabled come from the Extensions API (`GET
/platform/extensions/v2/extensions/…/monitoring-configurations`).

### Kind filter line

Only while a donut slice is selected: "Tables filtered to <kind> configurations." and a **Show all** button that clears
the filter.

### Broken monitoring configurations

Source: `BrokenCard` in [ExtensionsTab.tsx](../ui/app/tabs/ExtensionsTab.tsx#L395).

Header hint: "Enabled configurations that do not run as configured: any state except OK and IDLE
(dt.sfm.extension.status), a framework error (not picked up, fastcheck failed), or no status at all in the timeframe.
Local ones show the hosts that are not OK." followed by "<n> configurations in total." (all broken configurations,
regardless of the kind filter and the toggle).

**Toggle** (top right): **Broken** (default) shows configurations where `isBroken` is true; **All** shows every
configuration still in the environment (including disabled and OK ones). Both respect the kind filter.

**Messages above the table**

- Extensions API call failed: a warning box "Extensions API not readable" with the error text (for HTTP 403: "Access
  denied (HTTP 403): the app needs the scope extensions:definitions:read and you need the matching permission.") and
  "Configurations come from DQL only: scopes, disabled configurations and configurations that never reported are
  missing."
- API readable but some extensions' configurations failed: "Monitoring configurations of <n> extension(s) were not
  readable (extensions:configurations:read): <first five short names>, …."

**Table** (Strato `DataTable`, sortable, resizable columns, line wrap, condensed rows; 25 rows per page, page sizes 25 /
50 / 100). Row order before any sort: broken first, then the worse status first (rank: other errors > UNASSIGNED >
WARNING > IDLE > OK), then extension name.

| Column | Content | Source | Sort key |
| --- | --- | --- | --- |
| **Status** | Coloured glyph, the status code, its meaning (see [status texts](#status-and-what-counts-as-broken)), and " (latest framework event)" when the status was taken from a framework error because there was no status series | merged status (`dt.extension.status` or derived) | broken rows first, then status code |
| **Extension** | Extension ID (for example `com.dynatrace.extension.snmp-generic-device`), the data source (`dt.extension.ds`), an **Extensions app ↗** link and a **configuration ↗** link, then the configuration's description | Q1 / Q2 (`extension`, `dataSource`, `configEntity`), API (`description`) | extension ID |
| **Runs / scope** | Kind label (Local (OneAgent), Remote (ActiveGate), Kubernetes, Cloud integration) and the scope line (see below); "Not seen in the last 30d" in red for a stale host or host group scope | API `scope`, `activationContext`; scope-names query | kind + raw scope |
| **Hosts / ActiveGate** | Remote: the ActiveGate's name. Remote without an ActiveGate: "No ActiveGate" in red, and "<online> of <n> eligible ActiveGate(s) connected" or "no ActiveGate in the group has the Extensions module". Local / Kubernetes: "<bad> of <n> host(s) not OK" (or "<n> host(s), all OK"), then up to three host names linked to the host page, each with its status when not OK, and "+<k> more". "No host reports it" when no host reports a status. | Q1 `agId`, Q6 names, Q5 groups; Q2 per-host rows | number of hosts, or ActiveGate ID |
| **Latest reason** | The newest non-INFO framework event content for the configuration; if there is none, the reason of the newest failed or not-picked-up fastcheck row (with the prefix "Failed to assign monitoring configuration to ActiveGate. Reason: " removed). Cut at 220 characters with "…"; the full text is the tooltip. "—" when empty. | Q3 `content`, Q4 `content` | message text |
| **Fastcheck** | Result of the newest fastcheck row that is not *Created* or *Message* (or the newest row when all are), with glyph and label, "<n>× · last YYYY-MM-DD HH:MM" (UTC), and a **Log (<rows>)** button. "No result in the timeframe" when the configuration has no row. | Q4 | number of fastcheck rows |
| **Remediation** | **Fix** (emphasised) on broken rows, **Details** on others, **Selected** (accent) on the selected row. Not sortable. | | |

Status glyph colours: OK green `#0ca30c` with a check mark; IDLE, DISABLED and NOT_REPORTED grey `#898781` with a dot;
WARNING yellow `#fab219` with a dash; UNASSIGNED and NO_DATA orange `#ec835a` with "!"; every other status red `#d03b3b`
with "!".

Scope line per scope type:

| Scope type | Text | Link |
| --- | --- | --- |
| `host` | "Host <name ↗>" (the ID when the name is not known) | host page in Infrastructure & Operations (`dynatrace.infraops` / `view_host`, `meId`, current timeframe) |
| `host_group` | "Host group <name ↗> · <n> hosts" | host group in Infrastructure & Operations (`view_host_group`, `dt.entity.host_group`, current timeframe) |
| `environment` | "Environment (every host)" | none |
| `management_zone` | "Management zone <id>" | none |
| `ag_group` | "ActiveGate group <name>" | none |
| `kubernetes` | "Kubernetes" | none |
| `integration` | "Cloud: <aws / azure / gcp>" | none |
| unknown (DQL only) | "<n> reporting host(s) (scope not readable)" or "Scope not readable" | none |

**Buttons**

- **Log (n)** sets the fastcheck log to this configuration and scrolls to it.
- **Fix / Details** selects the configuration for the *Remediation actions* section and scrolls there.

**Loading and errors.** The table is wrapped in the remote query's state: "Loading…" until Q1 first answers, a
"Query failed" box when Q1 fails. Empty state: "Reading the monitoring configurations…" while the API loads (Broken),
"Every enabled configuration is OK or idle." (Broken), "No configurations." (All).

Under the table: query actions for Q3, titled "Extensions: latest framework warning or error per configuration".

### Fastcheck log

Source: `FastcheckCard` in [ExtensionsTab.tsx](../ui/app/tabs/ExtensionsTab.tsx#L506). Data: [Q4](#q4-fastcheck-and-assignment-results-extensionfastcheckquery).

Header hint: "The extension framework's fastcheck and assignment results per configuration (dt.system.events,
EXTENSION_FRAMEWORK_CORE): fastcheck failed (with the reason), passed and assigned to an ActiveGate, not picked up for
execution, created. Repeats are folded into one row with a count, newest first."

**Folding.** Q4 groups the events by configuration ID, extension, status, log level, message text, ActiveGate group and
ActiveGate ID, and returns one row per distinct combination with `occurrences = count()`, `firstAt = min(timestamp)` and
`lastAt = max(timestamp)`. A failing fastcheck repeats about every hour (code comment, observed on the demo tenant), so
one row with "12×" stands for twelve identical failures. Two messages that differ in any character (for example a
different endpoint) stay separate rows.

**Filter toggle** (when no single configuration is selected):

| Option | Rows shown |
| --- | --- |
| **Broken configurations** (default) | rows whose configuration is in the merged list and broken |
| **Failures** | rows classified *Fastcheck failed* or *Not picked up*, for any configuration |
| **All** | every row Q4 returned, including rows of configurations that are not in the merged list |

When you click **Log** on a configuration (Broken table or Remediation section), the toggle is replaced by "Showing
<extension short name · description>" and a **Show all** button; the table then shows every row of that configuration.
Changing the timeframe clears the selection.

**Table** (sortable, resizable, 25 rows per page, 25 / 50 / 100). Default order: newest `lastAt` first (Q4 order).

| Column | Content |
| --- | --- |
| **Last (UTC)** | `lastAt` as `YYYY-MM-DD HH:MM` (the first 16 characters of the ISO timestamp, no time-zone conversion) |
| **Result** | Glyph and label: *Fastcheck failed* (red "!"), *Not picked up* (orange "!"), *Passed, assigned* (green check), *Created* (grey "+"), *Message* (grey dot). See [classification](#fastcheck-result-classification). |
| **Configuration** | Extension ID, data source, links and description of the configuration (or only the extension ID when the configuration is not in the merged list) |
| **Group / ActiveGate** | ActiveGate group and the ActiveGate's name (from Q6; the ID when unknown), joined with "·"; "—" when both are empty |
| **Count** | `<occurrences>×`, and "since YYYY-MM-DD HH:MM" when more than one |
| **Message** | `<status>:` in bold (when the event carries `dt.extension.status`) and the full message text, line breaks kept |

Empty states: "No fastcheck or assignment result for this configuration in the timeframe." (one configuration), "No
fastcheck result in the timeframe." (All), "No fastcheck failure for these configurations in the timeframe." (Broken
configurations, Failures). Loading / error: Q4's state ("Loading…", "Query failed").

Under the table: query actions for Q4, titled "Extensions: fastcheck and assignment results".

### Configurations by where they run

Source: `ScopesCard` in [ExtensionsTab.tsx](../ui/app/tabs/ExtensionsTab.tsx#L614).

Every configuration still in the environment (not *gone*), filtered by the donut's kind when one is selected. Hint:
"Every monitoring configuration and what it is assigned to. Local configurations link to their host or host group; an
environment-wide one applies to every host and has no link." plus "Filtered to <kind>." when filtered.

Table (sortable, resizable, 25 rows per page, 25 / 50 / 100; same initial order as the Broken table):

| Column | Content | Sort key |
| --- | --- | --- |
| **Runs** | Kind label | kind label |
| **Extension** | Same cell as in the Broken table | extension ID |
| **Assigned to** | Scope line (as in the Broken table, without the kind label), stale flag "Not seen in the last 30d" | scope name, else raw scope |
| **Reporting** | Remote: the ActiveGate's name, "—" when none. Local / Kubernetes: "<ok> of <n> host(s) OK" (OK or IDLE), "—" when no host reports | number of reporting hosts |
| **Version** | Extension version the configuration uses (API `value.version`; empty for DQL-only configurations) | version |
| **Status** | Same cell as in the Broken table | status |

Wrapped in Q2's state. Empty: "Reading the monitoring configurations…" while the API loads, otherwise "No
configurations.".

Under the table, when any configuration is scoped to a host or host group: "Names of the scoped hosts and host groups
(last 30d)" and query actions for [Q8](#q8-names-of-scoped-hosts-and-host-groups-extensionscopenamesquery--marker),
titled "Extensions: scoped hosts and host groups".

### Re-check

A **Re-check** button (right-aligned under the scopes table). It increments a counter that:

- appends a DQL comment `// refresh <n>` to Q1, Q2, Q3, Q4 and Q7 (`refreshMarker` in
  [queries.ts](../ui/app/queries.ts#L698)), so the SDK runs them again; Q5 and Q6 do not re-run;
- reads the Extensions API again (the previous list stays on screen until the new one arrives).

The Show DQL text never contains the refresh comment. Q8 re-runs only if the set of scoped host / host group IDs
changed.

### Remediation actions (section)

Source: `ExtRemediation` in [ExtensionsTab.tsx](../ui/app/tabs/ExtensionsTab.tsx#L695) (anchor
`remediation-extensions`). Full details: [Remediation actions](#remediation-actions).

- **Nothing selected:** "Fastcheck failures, remote configurations no ActiveGate runs, and local configurations that do
  not run. Select Fix on a configuration above for checks filled in for it." An *Action* dropdown lists the three
  generic manual actions.
- **A configuration selected** (Fix / Details): "What <name> needs: its scope, the ActiveGate group, the latest fastcheck
  result and error, and the documented steps." A line with the extension's short name, description, kind label and
  configuration ID, and an **Extensions app ↗** link; buttons **Fastcheck log** (filters the log to this configuration
  and scrolls to it) and **Clear selection**; the diagnosis check list; and an *Action* dropdown with the actions for
  this configuration, grouped by severity. "Checking the scope…" shows while Q8 has not answered for a host or host
  group scoped configuration.
- The documentation freshness line ("Guidance reviewed against the Dynatrace docs on 2026-10-24. …") sits under the
  intro text.

### Extension recommendations

Source: `RecommendationsCard`, `SnmpPanel`, `RecProcesses` in
[ExtensionsTab.tsx](../ui/app/tabs/ExtensionsTab.tsx#L746). Anchor `extensions-recommendations`.

Header hint: "Extensions worth adding: SNMP for network devices, and extensions for technologies OneAgent sees on
processes but no extension monitors. Databases are left out: the Databases tab covers them. Links open the extension in
the Extensions app when it is in the environment, Dynatrace Hub otherwise."

#### Network devices (SNMP)

Two cards, *SNMP Autodiscovery* and *SNMP device extensions*, built by `snmpRows` in
[extensions.ts](../ui/app/extensions.ts#L561) from the extension list and the merged configurations (no query of its
own). While the Extensions API is loading the panel shows "Checking SNMP extensions…".

Intro: "Routers, switches, firewalls and load balancers run no OneAgent: SNMP extensions on an ActiveGate are how
Dynatrace monitors them." plus, when either card is *none* or *installed*: "Recommended: discover the devices with SNMP
Autodiscovery, then monitor them with the generic or vendor SNMP extension."

Each card: label, state glyph and label, advice text, links. States, colours, advice and links are in
[SNMP states](#snmp-states).

#### Technologies on monitored processes

"Processes OneAgent sees whose technology has a Hub extension, and the hosts where no matching extension reports."

**Toggle:** **Needs an extension** (default; rows not *Covered*) / **All**.

**Table** (sortable, resizable; no paging: at most one row per technology, 31 in the catalogue). Initial order: *No
extension* first, then *Partly covered*, then *Covered*; within a state, the most uncovered hosts first; then by label.

| Column | Content | Sort key |
| --- | --- | --- |
| **Technology** | Display label (for example "Apache Tomcat") and, for Tomcat, a note about embedded Tomcat | label |
| **Extension (Hub)** | Dynatrace Hub title and the extension ID | Hub title |
| **Coverage** | *No extension* (red "!"), *Partly covered* (yellow dash) or *Covered* (green check); "<covered> of <n> host(s) · <p> process(es)" | none < partial < covered |
| **In this environment** | "Installed · <version>", "Not in the environment" (red) or "Not readable" (Extensions API failed); for installed ones "<n> configuration(s)" and " · <k> broken" in red | installed flag |
| **Recommendation** | One-line advice, see [recommendation text](#recommendation-coverage) | uncovered hosts |
| **Set up** | When not covered: **Add or widen a configuration ↗** (installed, has configurations) or **Add a monitoring configuration ↗** (installed, no configuration), both to the Extensions app; **Add from Dynatrace Hub ↗** (not installed, or installation unknown) to a Hub search for the Hub title. Always: a **Processes** / **Hide processes** toggle button. Not sortable. | |

Empty state: "Every recommended technology is covered by its extension." when the toggle hides every row, "OneAgent sees
no process with a recommended extension in this timeframe." when Q7 returned nothing. Wrapped in Q7's state. Under the
table: query actions for Q7, titled "Extensions: recommended extensions per technology".

**Processes panel.** **Processes** on a row opens a table below for that technology (one technology at a time; clicking
another replaces it, clicking again closes it). It runs [Q9](#q9-processes-of-one-technology-extensionrecprocessesquery).
Title: "<label> processes (<n>), first 500, without an extension first" (", first 500" only when the technology has more
than 500 processes).

| Column | Content |
| --- | --- |
| **Process** | Process name linked to its Infrastructure & Operations page (`view_smartscape_process`, Smartscape `nodeId`, current timeframe); plain text when no Smartscape ID was found |
| **Host** | Host name linked to the host page (`view_host`) |
| **Host group** | Host group name linked to the host group page (`view_host_group`); "—" when none |
| **Host mode** | Monitoring mode, formatted ("Full Stack", "Infrastructure", "Discovery") |
| **Kubernetes** | "<namespace> / <pod>" when the process runs in Kubernetes, "—" otherwise |
| **Extension on the host** | "✓ <short extension name>" in green when a matching extension reports from the host, "✕ none" in red otherwise |

Sortable, resizable, 25 rows per page (25 / 50 / 100). Empty: "No processes in this timeframe." Query actions under
the table, titled "Extensions: <label> processes and their extension".

## Checks and scoring

### How one configuration is built from the sources

`mergeConfigs` in [extensions.ts](../ui/app/extensions.ts#L186) builds one record per monitoring configuration ID:

1. **Extensions API** (when readable): one record per configuration with `inApi = true`, description, enabled
   (`value.enabled !== false`), raw scope, scope type and ID, kind, version; for `ag_group-<name>` scopes the group name.
2. **Q1 rows** (remote status): status, ActiveGate group, ActiveGate ID. A configuration not in the API gets kind
   Remote and scope type ActiveGate group.
3. **Q2 rows** (local status per host): one host entry per row with a host; the configuration's status becomes the
   *worst* host status (rank: OK 0, IDLE 1, WARNING 2, UNASSIGNED 3, anything else 4; ties keep the first). A
   configuration not in the API gets kind Local when the row has a host, Kubernetes when it has none.
4. **Q3 rows** (latest non-INFO framework event): message, log level and time, only for configurations already known.
5. **Q4 rows** (fastcheck): attached to their configuration, newest `lastAt` first.
6. A configuration found only in DQL is marked **gone** when the API was read and every extension's configurations
   were readable: it was deleted in the timeframe or is not an Extensions 2.0 configuration. When the API failed or
   some extensions were not readable, DQL-only configurations are kept (not gone) with an unknown scope.
7. Final status (see next sections), then the sort: broken first, worse status first, extension ID.

`configEntity` (classic entity `dt.entity.extensions:configuration`, used for the "configuration ↗" link) and
`dataSource` come from the first DQL row that carries them.

### Kind (where it runs) and scope

`parseScope` and `kindFrom` in [extensions.ts](../ui/app/extensions.ts#L35).

| API `scope` | Scope type | Scope ID |
| --- | --- | --- |
| `environment` | environment | (none) |
| `HOST_GROUP-…` | host_group | the host group ID |
| `HOST-…` | host | the host ID |
| `management_zone-<id>` (any case) | management_zone | `<id>` |
| `ag_group-<name>` | ag_group | `<name>` |
| `kubernetes` | kubernetes | (none) |
| `integration-<cloud>` | integration | `<cloud>` |
| anything else | unknown | the raw scope |

| Kind | Label | From `activationContext` | Fallback when there is no activation context (older extension versions, for example Hyper-V 2.2.21) |
| --- | --- | --- | --- |
| LOCAL | Local (OneAgent) | `LOCAL` | any scope not listed below |
| REMOTE | Remote (ActiveGate) | `REMOTE` | scope type ag_group |
| KUBERNETES | Kubernetes | `CONTAINER` | scope type kubernetes |
| CLOUD | Cloud integration | `DATA_ACQUISITION` | scope type integration |

**Stale scope** (`staleScope` in ExtensionsTab.tsx): enabled, not gone, scope type host or host_group, Q8 has answered
for the current ID list, and Q8 returned no row for the scope ID (the host or host group has no entity in the last 30
days). Shown as "Not seen in the last 30d" and listed by AI Assist.

### Status and what counts as broken

Status meanings (`EXT_STATUS_TEXT` in [activeGates.ts](../ui/app/activeGates.ts#L187) plus `CONFIG_STATUS_TEXT` in
[extensions.ts](../ui/app/extensions.ts#L169)):

| Status | Text shown | Origin |
| --- | --- | --- |
| OK | Running | `dt.extension.status` |
| IDLE | Idle (nothing to do) | `dt.extension.status` |
| WARNING | Running with warnings | `dt.extension.status` |
| UNASSIGNED | Not picked up by any ActiveGate (remote); "Not picked up for execution" for local, Kubernetes and cloud | `dt.extension.status` or framework event |
| GENERIC_ERROR | Job failed | `dt.extension.status` |
| CUSTOM_ERROR | Failed (extension-specific) | |
| AUTH_ERROR, AUTHENTICATION_ERROR | Authentication failed | |
| DEVICE_CONNECTION_ERROR | Cannot connect to the device | |
| EEC_CONNECTION_ERROR | Cannot connect to the extension controller | |
| INVALID_ARGS_ERROR | Invalid arguments | |
| INVALID_CONFIG_ERROR | Invalid configuration | |
| NO_RESPONSE | No response from the endpoint | |
| UNKNOWN_ERROR | Unknown error | |
| DISABLED | Disabled in the configuration | derived: `enabled` is false in the API |
| NO_DATA | No status in the timeframe | derived: enabled, no status series, no framework error |
| NOT_REPORTED | Cloud data acquisition reports no status | derived: kind Cloud without a status series |

Any other status code is shown without a text.

Derivation order for the final status (end of `mergeConfigs`):

1. Disabled in the API: **DISABLED** (overrides any reported status).
2. A status from Q1 or Q2: that status.
3. Kind Cloud: **NOT_REPORTED**.
4. The newest fastcheck row with log level `ERROR` and a non-empty `dt.extension.status`: that status, marked
   "(latest framework event)".
5. Otherwise: **NO_DATA**.

| Predicate | Rule (code) | Used by |
| --- | --- | --- |
| **broken** (`isBroken`) | enabled, not gone, and status not in OK, IDLE, DISABLED, NOT_REPORTED. WARNING, UNASSIGNED, NO_DATA and every error state are broken. | Broken table, gauges, fastcheck log filter, Fix / Details, AI Assist, recommendations ("broken" counts) |
| **judged** (`isJudged`) | enabled, not gone, status is not NOT_REPORTED | Gauge denominators, AI Assist |
| **live** | not gone | Donut, All toggle, scopes table, AI Assist kind totals and disabled count |

### Fastcheck result classification

`fastcheckResult` in [extensions.ts](../ui/app/extensions.ts#L100), applied to the message text in this order:

| Order | Message | Result | Label |
| --- | --- | --- | --- |
| 1 | starts with "Failed to assign" | failed | Fastcheck failed |
| 2 | starts with "Successfully assigned" | passed | Passed, assigned |
| 3 | contains "has not been picked up" | unassigned | Not picked up |
| 4 | starts with "Monitoring configuration created" | created | Created |
| 5 | contains "fastcheck" or "fast check" (any case) and "fail" or "error" | failed | Fastcheck failed |
| 6 | contains "fastcheck" or "fast check" otherwise | other | Message |
| 7 | anything else | other | Message |

The reason shown for a failed row drops the prefix "Failed to assign monitoring configuration to ActiveGate. Reason: ",
leaving for example "Fast check failed for 1 endpoint(s). Cannot connect to …".

### Gauges

| Gauge | Numerator | Denominator | Rounding | Notes |
| --- | --- | --- | --- | --- |
| Configurations OK | judged and not broken | judged | `Math.round`, 100 when the denominator is 0 | Includes Local, Remote and Kubernetes |
| Local configurations OK | judged Local, not broken | judged Local | `Math.round` | Hidden when 0 |
| Remote configurations OK | judged Remote, not broken | judged Remote | `Math.round` | Hidden when 0 |
| Recommended extensions in place | Σ per technology of min(coveredHosts, hosts) | Σ per technology of hosts | `Math.round` | Hidden when the denominator is 0 |

There is no Blocking / Check / Info status on the tab level; the diagnosis checks for a selected configuration are
listed in [Remediation actions](#diagnosis-checks-for-a-selected-configuration).

### Recommendation coverage

`toRecRows` and `recAdvice` in [extensions.ts](../ui/app/extensions.ts#L494).

- **Covered host:** a host where Q7 found a process of the technology and where at least one extension whose name
  contains one of the technology's tokens reports `dt.sfm.extension.status` with `dt.entity.host` (that is, a local
  extension running in OneAgent on that host).
- **State:** *Covered* when `coveredHosts ≥ hosts`; *Partly covered* when `coveredHosts > 0`; *No extension* otherwise.
- **Installed:** the extension ID is in the Extensions API list (`null`, shown "Not readable", when the API failed).
- **Configurations:** enabled, not-gone configurations of exactly that extension ID; **broken** among them; **envWide**:
  one of them is Local with scope `environment`.

Recommendation text (first rule that applies; `<where>` is "<uncovered> of <hosts> hosts"):

| Condition | Text |
| --- | --- |
| Covered | "Covered: the extension reports from all <hosts> hosts." |
| Not installed | "Add <Hub title> from Dynatrace Hub, then a monitoring configuration for <where>." |
| Installed, no configuration (also when installation is unknown and there is no configuration) | "<Hub title> is in the environment without a monitoring configuration: add one for <where>." |
| Every configuration broken | "<n> configuration(s), all broken (see Broken monitoring configurations): fix or re-scope it / them to cover <where>." |
| An environment-wide local configuration exists | "An environment-wide configuration exists, but <where> report no status for it: open Processes for those hosts and the configuration's Health in the Extensions app." |
| Otherwise | "<n> configuration(s) exist(s), but none reports from <where>: scope one to their host groups (or the environment), or check that a remote one targets these endpoints." |

### Technology to Hub extension catalogue

`EXT_REC_MATCH` in [queries.ts](../ui/app/queries.ts#L1152) and `EXT_REC_INFO` in
[extensions.ts](../ui/app/extensions.ts#L436). Extension IDs and Hub titles were checked against the Dynatrace Hub
catalog on 2026-10-24 (code comment). Databases (SQL Server, Oracle, PostgreSQL, MySQL, MariaDB, Db2, SAP HANA, MongoDB,
Redis) are left out on purpose: the [Databases](databases.md) tab covers them; Hub entries in category "database"
(Cassandra, Couchbase, Elasticsearch, Memcached and others) are not listed either.

A process matches a technology when any of the "matched on" conditions holds and every "and" condition holds; the first
technology in this order wins. Executable names, jar names and the prefilter compare in lower case; Java main classes
compare exactly. "Tokens" are the lower-case parts of extension names that count as coverage on the host.

| Key | Label | Matched on | Hub title | Extension ID | Tokens | Note shown |
| --- | --- | --- | --- | --- | --- | --- |
| `TOMCAT` | Apache Tomcat | processType TOMCAT or software technology APACHE_TOMCAT | Tomcat (JMX) | `com.dynatrace.extension.jmx-tomcat-cp` | `tomcat` | Embedded Tomcat (Spring Boot 2.2 and later) registers no Tomcat MBeans unless server.tomcat.mbeanregistry.enabled=true. |
| `JBOSS` | JBoss / WildFly | processType JBOSS | Connection Pools: JBoss | `com.dynatrace.extension.jmx-jboss-cp` | `jboss` | |
| `WEBLOGIC` | Oracle WebLogic | processType WEBLOGIC | Connection Pools: WebLogic | `com.dynatrace.extension.jmx-weblogic-cp` | `weblogic` | |
| `WEBSPHERE` | IBM WebSphere Application Server | processType WEBSPHERE and not software technology ZOS_CONNECT (z/OS Connect reports processType WEBSPHERE) | IBM WebSphere Application Server | `com.dynatrace.extension.websphere-appserver` | `websphere` | |
| `KAFKA` | Apache Kafka broker | Java main class `kafka.Kafka`, `io.confluent.support.metrics.SupportedKafka` (the broker only; clients also report Kafka) | Apache Kafka | `com.dynatrace.extension.jmx-kafka` | `kafka` | |
| `ZOOKEEPER` | Apache ZooKeeper | Java main class `org.apache.zookeeper.server.quorum.QuorumPeerMain` | Apache ZooKeeper | `com.dynatrace.extension.jmx-zookeeper` | `zookeeper` | |
| `ACTIVEMQ` | Apache ActiveMQ Classic | Java main class `org.apache.activemq.console.Main` or Java jar `activemq.jar` | Apache ActiveMQ Classic | `com.dynatrace.extension.jmx-activemq` | `activemq` | |
| `HADOOP` | Apache Hadoop | Java main class `org.apache.hadoop.hdfs.server.namenode.NameNode`, `org.apache.hadoop.hdfs.server.datanode.DataNode`, `org.apache.hadoop.yarn.server.resourcemanager.ResourceManager`, `org.apache.hadoop.yarn.server.nodemanager.NodeManager` | Hadoop | `com.dynatrace.extension.jmx.hadoop` | `hadoop` | |
| `SPARK` | Apache Spark | Java main class `org.apache.spark.deploy.master.Master`, `org.apache.spark.deploy.worker.Worker` | Apache Spark | `com.dynatrace.extension.jmx.spark` | `spark` | |
| `JENKINS` | Jenkins | Java jar `jenkins.war` | Jenkins infrastructure performance | `com.dynatrace.extension.yaml-jenkins` | `jenkins` | |
| `RABBITMQ` | RabbitMQ broker | software technology RABBIT_MQ and processType ERLANG (OneAgent also reports RABBIT_MQ on client applications) | RabbitMQ (Management API) | `com.dynatrace.rabbitmq` | `rabbitmq` | |
| `IBM_MQ` | IBM MQ queue manager | executable `amqzxma0`, `amqzxma0.exe` | IBM MQ | `com.dynatrace.extension.ibm-mq` | `ibm-mq` | |
| `TIBCO_EMS` | TIBCO EMS | executable `tibemsd`, `tibemsd64`, `tibemsd.exe`, `tibemsd64.exe` | TIBCO EMS | `com.dynatrace.extension.tibcoems` | `tibco` | |
| `HAPROXY` | HAProxy | processType HAPROXY | HAProxy | `com.dynatrace.extension.haproxy` | `haproxy` | |
| `IIS` | Microsoft IIS | processType IIS, IIS_APP_POOL | Microsoft IIS | `com.dynatrace.extension.wmi.iis` | `iis` | |
| `MSMQ` | Microsoft Message Queuing | executable `mqsvc.exe` | Microsoft Message Queuing (MSMQ) | `com.dynatrace.extension.wmi.msmq` | `msmq` | |
| `EXCHANGE` | Microsoft Exchange Server | executable `msexchangetransport.exe`, `microsoft.exchange.store.service.exe` | Microsoft Exchange Server | `com.dynatrace.extension.ms-exchange` | `exchange` | |
| `HYPERV` | Microsoft Hyper-V | executable `vmms.exe` | Microsoft Hyper-V Infrastructure | `com.dynatrace.extension.hyperv` | `hyperv` | |
| `CITRIX_VDA` | Citrix VDA | executable `brokeragent.exe` | Citrix DaaS & Virtual Apps and Desktops | `com.dynatrace.extension.citrix-vda` | `citrix-vda` | |
| `SAP_ABAP` | SAP ABAP application server | executable `disp+work`, `disp+work.exe` | SAP GUI and ABAP Platform | `com.dynatrace.ext.sap` | `ext.sap` | |
| `PHP_FPM` | PHP-FPM | executable starting with `php-fpm` | PHP-FPM | `com.dynatrace.extension.php-fpm` | `php-fpm` | |
| `SQUID` | Squid | executable `squid` | Squid | `com.dynatrace.squid` | `squid` | |
| `COREDNS` | CoreDNS | software technology CORE_DNS or executable `coredns` | CoreDNS (2.0) | `com.dynatrace.extension.coredns` | `coredns` | |
| `ETCD` | etcd | software technology ETCD | etcd for OpenShift | `com.dynatrace.extension.etcd-for-k8s-control-plane` | `etcd` | |
| `OPENSHIFT_CONTROL_PLANE` | OpenShift API server | executable `openshift-apiserver` | OpenShift Control Plane | `com.dynatrace.extension.kubernetes-control-plane` | `kubernetes-control-plane` | |
| `ISTIO` | Istio control plane (istiod) | executable `pilot-discovery` | Istio Service Mesh | `com.dynatrace.extension.istio-prometheus` | `istio` | |
| `CONSUL` | HashiCorp Consul | executable `consul`, `consul.exe` | Consul Service Mesh (StatsD) | `com.dynatrace.extension.consul-statsd` | `consul` | |
| `OTEL_COLLECTOR` | OpenTelemetry Collector | executable starting with `otelcol` | OpenTelemetry Collector Extension | `com.dynatrace.extension.otel-collector` | `otel-collector` | |
| `ALERTMANAGER` | Prometheus Alertmanager | executable `alertmanager` | Prometheus Alertmanager (v2) | `com.dynatrace.alertmanager` | `alertmanager` | |
| `CEPH` | Ceph | executable `ceph-osd`, `ceph-mon`, `ceph-mgr` | Ceph storage | `com.dynatrace.extension.ceph` | `ceph` | |
| `REDPANDA` | Redpanda | executable `redpanda` | Redpanda | `com.dynatrace.extension.prometheus.red-panda` | `red-panda`, `redpanda` | |

### SNMP states

`snmpRows` in [extensions.ts](../ui/app/extensions.ts#L561). Judged from installed extensions and enabled, not-gone
configurations only (network devices have no processes to look at).

- **SNMP Autodiscovery** matches the extension ID `com.dynatrace.extension.snmp-auto-discovery` (Hub: "SNMP
  Autodiscovery").
- **SNMP device extensions** match `com.dynatrace.extension.snmp-generic-device` (Generic network device),
  `com.dynatrace.extension.snmp-generic-cisco-device` (Generic Cisco Device),
  `com.dynatrace.extension.snmp-generic-juniper` (Juniper Networks (SNMP)), `com.dynatrace.extension.f5.bigip` (F5
  BIG-IP), `com.dynatrace.extension.palo-alto-generic` (Palo Alto firewalls), and any other extension whose ID contains
  "snmp" (any case) except SNMP Autodiscovery and IDs containing "snmp-traps" (traps are events, not devices). The card
  links to the first of the five named extensions that is installed, else the first installed match (by ID), else
  Generic network device.

| State | Rule (first that applies) | Label, colour | Advice (Autodiscovery / devices) | Links |
| --- | --- | --- | --- | --- |
| in-use | at least one matching configuration is not broken | "In use", green | "In use: <n> configuration(s)[, <k> broken]." / "In use: <n> configuration(s) of <extension names>[, <k> broken]." | "<Hub title> in the Extensions app ↗", docs |
| broken | matching configurations exist, all broken | "Configured, not running", red | "<n> configuration(s), none running: fix it / them in Broken monitoring configurations above." | "<Hub title> in the Extensions app ↗", docs |
| unknown | Extensions API failed and no matching configuration | "Unknown", grey | "Not known: the Extensions API was not readable and no SNMP Autodiscovery / SNMP device configuration reports a status." | docs |
| installed | installed, no matching configuration | "Installed, not configured", yellow | "In the environment without a monitoring configuration: add one with the subnets or IP ranges to scan and the SNMP credentials, on an ActiveGate group that reaches those networks." / "<names> is/are in the environment without a monitoring configuration: add one per device or device group, on an ActiveGate group that reaches the devices." | "Add a monitoring configuration ↗" (Extensions app), docs |
| none | not installed | "Not in use", yellow | Autodiscovery: "Not in use. Add SNMP Autodiscovery from Dynatrace Hub: it scans your subnets and IP ranges for SNMP-enabled network devices (SNMP v2c / v3), lists them as entities and points each one to the extension that monitors it best. Needs an ActiveGate 1.280+ with the API routing module (restInterface) and a platform token with storage:buckets:read and storage:smartscape:read." Devices: "No network device is monitored over SNMP. Add the Generic network device extension (interfaces, traffic, SNMP health) or the vendor extension for your devices (Cisco, Juniper, F5 BIG-IP, Palo Alto); devices monitored by these appear in the SNMP Autodiscovery topology." | "Add <Hub title> from Dynatrace Hub ↗" (Hub search), docs |

Docs links: Autodiscovery card: SNMP Autodiscovery extension. Devices card: Generic network device extension, SNMP
Autodiscovery extension.

## Queries

| # | Name (function in source) | Runs when | Feeds |
| --- | --- | --- | --- |
| Q1 | Remote configuration status (`activeGateExtensionsQuery`) | tab open; timeframe change; Re-check | status of remote configurations, Hosts / ActiveGate, gauges, donut |
| Q2 | Local configuration status per host (`localExtensionStatusQuery`) | tab open; timeframe change; Re-check | status and hosts of local / Kubernetes configurations, gauges, donut |
| Q3 | Latest framework warning or error (`activeGateExtensionEventsQuery`) | tab open; timeframe change; Re-check | Latest reason, diagnosis "Latest error / warning" |
| Q4 | Fastcheck and assignment results (`extensionFastcheckQuery`) | tab open; timeframe change; Re-check | Fastcheck column, Fastcheck log, derived status, diagnosis |
| Q5 | ActiveGate groups with the Extensions module (`dbAgGroupsQuery`) | tab open; timeframe change | "No ActiveGate" detail, diagnosis group check |
| Q6 | ActiveGate inventory (`activeGatesQuery`) | tab open; timeframe change | ActiveGate names |
| Q7 | Recommended technologies (`extensionRecommendationsQuery`) | tab open; timeframe change; Re-check | Technologies table, recommendations gauge, AI Assist |
| Q8 | Names of scoped hosts and host groups (`extensionScopeNamesQuery` + marker, assembled in ExtensionsTab.tsx) | after the configurations are known; when the set of scope IDs changes | scope names and links, stale flag, diagnosis scope checks |
| Q9 | Processes of one technology (`extensionRecProcessesQuery`) | **Processes** on a technology row; timeframe change while open | Processes panel |

All builders are in [queries.ts](../ui/app/queries.ts); `from:now()-24h` is the default and becomes `from:now()-7d` or
`from:now()-30d` with the other timeframes (exceptions noted per query). Queries run in the browser through
`useDql` ([useDql.ts](../ui/app/useDql.ts), `@dynatrace-sdk/react-hooks`), which runs a query again whenever its text
changes.

### Q1: Remote configuration status (`activeGateExtensionsQuery`)

- **Source:** `activeGateExtensionsQuery` in [queries.ts](../ui/app/queries.ts#L607) (shared with the
  [ActiveGates](activegates.md) tab).
- **Runs:** on tab open, on timeframe change, on Re-check (with `// refresh <n>` appended).
- **Parameters:** timeframe only.
- **Query (24 h):**

```dql
timeseries c = count(dt.sfm.extension.status), by:{dt.extension.config.id, `dt.entity.extensions:configuration`, dt.extension.name, dt.extension.ds, dt.extension.status, dt.active_gate.group.name, dt.active_gate.id}, filter:{isNotNull(dt.active_gate.group.name)}, from:now()-24h
| fieldsAdd lastAt = arrayMax(iCollectArray(if(isNotNull(c[]), iIndex()))), samples = arraySum(c)
| dedup dt.extension.config.id, sort:{lastAt desc}
| fields configId = dt.extension.config.id, configEntity = `dt.entity.extensions:configuration`, extension = dt.extension.name, dataSource = dt.extension.ds, status = dt.extension.status, group = dt.active_gate.group.name, agId = dt.active_gate.id, lastAt, samples
| sort status asc, extension asc
```

- **How it works:**
  - `timeseries c = count(dt.sfm.extension.status)` reads the extension self-monitoring status metric. Each status
    a configuration reports is its own series, split by configuration ID, the classic configuration entity, extension
    name, data source, status, ActiveGate group and ActiveGate ID. `filter:{isNotNull(dt.active_gate.group.name)}`
    keeps only series that carry an ActiveGate group: configurations assigned to an ActiveGate group. Local
    configurations (OneAgent) carry no group. UNASSIGNED series have the group but no ActiveGate ID.
  - `lastAt = arrayMax(iCollectArray(if(isNotNull(c[]), iIndex())))`: for every bucket of the series, the bucket index
    when the bucket has a value; the maximum is the most recent bucket in which this status was reported.
    `samples = arraySum(c)` is the total count (not used on this tab).
  - `dedup dt.extension.config.id, sort:{lastAt desc}` keeps one series per configuration: the status reported most
    recently.
  - `fields` renames to the columns the UI reads; `sort` orders by status, then extension.
- **Output:** `configId`, `configEntity`, `extension`, `dataSource`, `status`, `group`, `agId` are merged into the
  configuration ([merge](#how-one-configuration-is-built-from-the-sources)); `lastAt` and `samples` are not used here.
- **Limits and cost:** one metric query; under 0.1 s on the demo tenant (README). No row limit.
- **Open it yourself:** *DQL behind these numbers* in the summary card (title "Extensions: remote configurations by
  status").

### Q2: Local configuration status per host (`localExtensionStatusQuery`)

- **Source:** `localExtensionStatusQuery` in [queries.ts](../ui/app/queries.ts#L1093).
- **Runs:** on tab open, on timeframe change, on Re-check.
- **Parameters:** timeframe (both `from:` clauses).
- **Query (24 h):**

```dql
timeseries c = count(dt.sfm.extension.status), by:{dt.extension.config.id, `dt.entity.extensions:configuration`, dt.extension.name, dt.extension.ds, dt.extension.status, dt.entity.host}, filter:{isNull(dt.active_gate.group.name)}, from:now()-24h
| fieldsAdd lastAt = arrayMax(iCollectArray(if(isNotNull(c[]), iIndex())))
| sort lastAt desc
| summarize {status = takeFirst(dt.extension.status), configEntity = takeAny(`dt.entity.extensions:configuration`), extension = takeFirst(dt.extension.name), dataSource = takeFirst(dt.extension.ds), lastAt = max(lastAt)},
    by:{configId = dt.extension.config.id, host = dt.entity.host}
| lookup [fetch dt.entity.host, from:now()-24h | fields id, hostName = entity.name], sourceField:host, lookupField:id, fields:{hostName}
| sort status asc, extension asc
```

- **How it works:**
  - The same metric, split by host instead of ActiveGate group; `filter:{isNull(dt.active_gate.group.name)}` keeps the
    series without an ActiveGate group: local configurations (one series per host, `dt.entity.host` set) and
    Kubernetes (CONTAINER) configurations (neither host nor group).
  - `lastAt` is the index of the newest bucket with data (as in Q1); `sort lastAt desc` puts the newest series first.
  - `summarize ... by:{configId, host}`: one row per configuration and host. `takeFirst(dt.extension.status)` is the
    status of the newest series. `takeAny` keeps one configuration entity ID; a code comment notes that a local
    series can arrive twice per host, with and without `dt.entity.extensions:configuration`.
  - `lookup [fetch dt.entity.host ...]` adds the host name.
- **Output:** `configId`, `host`, `hostName`, `status` become one host entry of the configuration; the configuration's
  status is the worst host status. `configEntity`, `extension`, `dataSource` fill the configuration when missing.
  `lastAt` is not used.
- **Limits and cost:** under 0.1 s on the demo tenant (README). No row limit.
- **Open it yourself:** *DQL behind these numbers* (title "Extensions: local configurations by status per host").

### Q3: Latest framework warning or error (`activeGateExtensionEventsQuery`)

- **Source:** `activeGateExtensionEventsQuery` in [queries.ts](../ui/app/queries.ts#L614) (shared with the ActiveGates
  tab).
- **Runs:** on tab open, on timeframe change, on Re-check.
- **Parameters:** timeframe.
- **Query (24 h):**

```dql
fetch dt.system.events, from:now()-24h
| filter event.kind == "EXTENSIONS_EVENT" and loglevel != "INFO" and isNotNull(dt.extension.config.id)
| dedup dt.extension.config.id, sort:{timestamp desc}
| fields configId = dt.extension.config.id, extension = dt.extension.name, status = dt.extension.status, loglevel, content, timestamp, group = dt.active_gate.group.name, agId = dt.active_gate.id
| sort timestamp desc
| limit 500
```

- **How it works:** reads extension events (`event.kind == "EXTENSIONS_EVENT"`) that are warnings or errors and belong to
  a monitoring configuration, keeps the newest per configuration (`dedup ... sort:{timestamp desc}`), and returns at
  most 500 configurations, newest first.
- **Output:** `content`, `loglevel`, `timestamp` become the configuration's latest message (Latest reason column,
  diagnosis "Latest error / warning"). Rows for configurations not otherwise known are ignored. `extension`, `status`,
  `group`, `agId` are not used here.
- **Limits and cost:** `limit 500`; under 0.1 s on the demo tenant.
- **Open it yourself:** under the Broken table (title "Extensions: latest framework warning or error per
  configuration").

### Q4: Fastcheck and assignment results (`extensionFastcheckQuery`)

- **Source:** `extensionFastcheckQuery` in [queries.ts](../ui/app/queries.ts#L1107).
- **Runs:** on tab open, on timeframe change, on Re-check.
- **Parameters:** timeframe.
- **Query (24 h):**

```dql
fetch dt.system.events, from:now()-24h
| filter event.kind == "EXTENSIONS_EVENT" and isNotNull(dt.extension.config.id)
| filter (event.provider == "EXTENSION_FRAMEWORK_CORE" and not startsWith(content, "Monitoring configuration deleted")) or contains(lower(content), "fastcheck") or contains(lower(content), "fast check")
| summarize occurrences = count(), firstAt = min(timestamp), lastAt = max(timestamp),
    by:{configId = dt.extension.config.id, extension = dt.extension.name, status = dt.extension.status, loglevel, content, group = dt.active_gate.group.name, agId = dt.active_gate.id}
| sort lastAt desc
| limit 500
```

- **How it works:**
  - Extension events of a monitoring configuration.
  - Second filter: every event of the extension framework core (`EXTENSION_FRAMEWORK_CORE`: "Failed to assign
    monitoring configuration to ActiveGate. Reason: Fast check failed …", "Successfully assigned …", "… has not been
    picked up for execution", "Monitoring configuration created …") except "Monitoring configuration deleted …", plus
    any event from any provider whose text mentions "fastcheck" or "fast check".
  - `summarize` folds identical events: one row per configuration, extension, status, level, message, group and
    ActiveGate, with the number of occurrences and the first and last time.
  - Newest first, at most 500 folded rows.
- **Output:** every column is used: `configId` (attach to configuration), `extension`, `status` (bold prefix; derived
  status), `loglevel` (ERROR rows can set the status; diagnosis Blocking vs Check), `content` (message, result
  classification), `group`, `agId` (Group / ActiveGate), `occurrences`, `firstAt`, `lastAt`.
- **Limits and cost:** `limit 500`; under 0.1 s on the demo tenant.
- **Open it yourself:** under the Fastcheck log (title "Extensions: fastcheck and assignment results").

### Q5: ActiveGate groups with the Extensions module (`dbAgGroupsQuery`)

- **Source:** `dbAgGroupsQuery` in [queries.ts](../ui/app/queries.ts#L1078) (shared with the [Databases](databases.md)
  tab).
- **Runs:** on tab open and timeframe change; not on Re-check.
- **Parameters:** timeframe.
- **Query (24 h):**

```dql
smartscapeNodes "ACTIVEGATE", from:now()-24h
| fieldsAdd lastSeen = lifetime[end]
| dedup dt.active_gate.id, sort:{lastSeen desc}
| filter in("EXTENSION_CONTROLLER", modules) and isNotNull(dt.active_gate.group.name)
| summarize activeGates = count(), online = countIf(lastSeen >= now() - 20m), by:{group = dt.active_gate.group.name}
| sort group asc
```

- **How it works:** Smartscape ActiveGate nodes; `lifetime[end]` is when the node was last seen; one row per ActiveGate
  ID (newest); keeps ActiveGates that report the Extensions module (`EXTENSION_CONTROLLER` in `modules`) and are in a
  group; per group, the number of such ActiveGates and how many were seen in the last 20 minutes (`AG_OFFLINE_MINUTES`).
- **Output:** `group`, `activeGates`, `online`: the "No ActiveGate" detail in the Hosts / ActiveGate column and the
  diagnosis group check.
- **Open it yourself:** not exposed on this tab.

### Q6: ActiveGate inventory (`activeGatesQuery`)

- **Source:** `activeGatesQuery` in [queries.ts](../ui/app/queries.ts#L520) (the ActiveGates tab's inventory query).
- **Runs:** on tab open and timeframe change; not on Re-check.
- **Parameters:** timeframe (both `from:` clauses).
- **Query (24 h):**

```dql
smartscapeNodes "ACTIVEGATE", "SYNTHETIC_ENGINE", "ZREMOTE", from:now()-24h
| fieldsAdd lastSeen = lifetime[end]
| dedup dt.active_gate.id, sort:{lastSeen desc}
| lookup [smartscapeNodes "K8S_CLUSTER", from:now()-24h | fields k8s.cluster.uid, clusterName = name, clusterId = id], sourceField:k8s.cluster.uid, lookupField:k8s.cluster.uid, fields:{clusterName, clusterId}
| fields id, name, type, agId = dt.active_gate.id, group = dt.active_gate.group.name, networkZone = dt.network_zone.id, version = dt.active_gate.version, modules,
    containerized = is_containerized, clusterName, clusterId, startup = startup_time, lastSeen, online = lastSeen >= now() - 20m, tokenId = dt.active_gate.auth_token.id,
    extVersion = dt.remote_extensions.version, syntheticVersion = dt.synthetic_engine.version, zremoteVersion = dt.zremote.version, fips = is_fips,
    osType = os.type, osVersion = os.version, arch = os.architecture, capabilities, nodeSize = node_size
| sort name asc
```

- **How it works:** every environment ActiveGate node (routing / monitoring, synthetic, zRemote), one row per
  ActiveGate ID, with its Kubernetes cluster and the inventory fields. See the [ActiveGates](activegates.md) page for
  every field.
- **Output:** this tab uses only `agId` and `name` (a map from ActiveGate ID to name for the Hosts / ActiveGate,
  Reporting and Group / ActiveGate columns).
- **Open it yourself:** not exposed on this tab.

### Q7: Recommended technologies (`extensionRecommendationsQuery`)

- **Source:** `extensionRecommendationsQuery` (with `extRecBase`, `EXT_REC_ANY`, `EXT_REC_TECH`, `EXT_REC_LOCAL`,
  `metaFields` and `localExtensions`) in [queries.ts](../ui/app/queries.ts#L1224).
- **Runs:** on tab open, on timeframe change, on Re-check.
- **Parameters:** timeframe. With 7 days every `from:now()-24h` becomes `from:now()-7d`. With 30 days the process
  fetches become `from:now()-30d`, but the `metric.series` lookup becomes `from:now()-10d` (`metric.series` accepts at
  most the last 10 days). The technology conditions are generated from the [catalogue](#technology-to-hub-extension-catalogue)
  and do not depend on user input.
- **Query (24 h):**

```dql
fetch dt.entity.process_group_instance, from:now()-24h
| filter id in [fetch dt.entity.process_group_instance, from:now()-24h
    | filter in(processType, array("TOMCAT", "JBOSS", "WEBLOGIC", "WEBSPHERE", "ERLANG", "HAPROXY", "IIS", "IIS_APP_POOL"))
      or iAny(in(substring(softwareTechnologies[], to:indexOf(softwareTechnologies[], ",")), array("type:APACHE_TOMCAT", "type:RABBIT_MQ", "type:CORE_DNS", "type:ETCD")))
      or iAny(in(lower(metadata[]), array("java_main_class:kafka.kafka", "java_main_class:io.confluent.support.metrics.supportedkafka", "java_main_class:org.apache.zookeeper.server.quorum.quorumpeermain", "java_main_class:org.apache.activemq.console.main", "java_jar_file:activemq.jar", "java_main_class:org.apache.hadoop.hdfs.server.namenode.namenode", "java_main_class:org.apache.hadoop.hdfs.server.datanode.datanode", "java_main_class:org.apache.hadoop.yarn.server.resourcemanager.resourcemanager", "java_main_class:org.apache.hadoop.yarn.server.nodemanager.nodemanager", "java_main_class:org.apache.spark.deploy.master.master", "java_main_class:org.apache.spark.deploy.worker.worker", "java_jar_file:jenkins.war", "exe_name:amqzxma0", "exe_name:amqzxma0.exe", "exe_name:tibemsd", "exe_name:tibemsd64", "exe_name:tibemsd.exe", "exe_name:tibemsd64.exe", "exe_name:mqsvc.exe", "exe_name:msexchangetransport.exe", "exe_name:microsoft.exchange.store.service.exe", "exe_name:vmms.exe", "exe_name:brokeragent.exe", "exe_name:disp+work", "exe_name:disp+work.exe", "exe_name:squid", "exe_name:coredns", "exe_name:openshift-apiserver", "exe_name:pilot-discovery", "exe_name:consul", "exe_name:consul.exe", "exe_name:alertmanager", "exe_name:ceph-osd", "exe_name:ceph-mon", "exe_name:ceph-mgr", "exe_name:redpanda")))
      or iAny(startsWith(lower(metadata[]), "exe_name:php-fpm"))
      or iAny(startsWith(lower(metadata[]), "exe_name:otelcol"))
    | fields id]
| fieldsAdd exeAll = if(startsWith(metadata[], "EXE_NAME:"), substring(metadata[], from:9)),
    mainAll = if(startsWith(metadata[], "JAVA_MAIN_CLASS:"), substring(metadata[], from:16)),
    jarAll = if(startsWith(metadata[], "JAVA_JAR_FILE:"), substring(metadata[], from:14))
| fieldsAdd exe = arrayFirst(arrayRemoveNulls(exeAll)), main = arrayFirst(arrayRemoveNulls(mainAll)), jar = arrayFirst(arrayRemoveNulls(jarAll))
| fieldsRemove exeAll, mainAll, jarAll
| fieldsAdd exe = lower(exe), jar = lower(jar)
| fieldsAdd recTech = if(coalesce((in(processType, array("TOMCAT")) or iAny(startsWith(softwareTechnologies[], "type:APACHE_TOMCAT,"))), false), "TOMCAT",
      else: if(coalesce((in(processType, array("JBOSS"))), false), "JBOSS",
      else: if(coalesce((in(processType, array("WEBLOGIC"))), false), "WEBLOGIC",
      else: if(coalesce((in(processType, array("WEBSPHERE"))) and not iAny(startsWith(softwareTechnologies[], "type:ZOS_CONNECT,")), false), "WEBSPHERE",
      else: if(coalesce((in(main, array("kafka.Kafka", "io.confluent.support.metrics.SupportedKafka"))), false), "KAFKA",
      else: if(coalesce((in(main, array("org.apache.zookeeper.server.quorum.QuorumPeerMain"))), false), "ZOOKEEPER",
      else: if(coalesce((in(main, array("org.apache.activemq.console.Main")) or in(jar, array("activemq.jar"))), false), "ACTIVEMQ",
      else: if(coalesce((in(main, array("org.apache.hadoop.hdfs.server.namenode.NameNode", "org.apache.hadoop.hdfs.server.datanode.DataNode", "org.apache.hadoop.yarn.server.resourcemanager.ResourceManager", "org.apache.hadoop.yarn.server.nodemanager.NodeManager"))), false), "HADOOP",
      else: if(coalesce((in(main, array("org.apache.spark.deploy.master.Master", "org.apache.spark.deploy.worker.Worker"))), false), "SPARK",
      else: if(coalesce((in(jar, array("jenkins.war"))), false), "JENKINS",
      else: if(coalesce((iAny(startsWith(softwareTechnologies[], "type:RABBIT_MQ,"))) and in(processType, array("ERLANG")), false), "RABBITMQ",
      else: if(coalesce((in(exe, array("amqzxma0", "amqzxma0.exe"))), false), "IBM_MQ",
      else: if(coalesce((in(exe, array("tibemsd", "tibemsd64", "tibemsd.exe", "tibemsd64.exe"))), false), "TIBCO_EMS",
      else: if(coalesce((in(processType, array("HAPROXY"))), false), "HAPROXY",
      else: if(coalesce((in(processType, array("IIS", "IIS_APP_POOL"))), false), "IIS",
      else: if(coalesce((in(exe, array("mqsvc.exe"))), false), "MSMQ",
      else: if(coalesce((in(exe, array("msexchangetransport.exe", "microsoft.exchange.store.service.exe"))), false), "EXCHANGE",
      else: if(coalesce((in(exe, array("vmms.exe"))), false), "HYPERV",
      else: if(coalesce((in(exe, array("brokeragent.exe"))), false), "CITRIX_VDA",
      else: if(coalesce((in(exe, array("disp+work", "disp+work.exe"))), false), "SAP_ABAP",
      else: if(coalesce((startsWith(exe, "php-fpm")), false), "PHP_FPM",
      else: if(coalesce((in(exe, array("squid"))), false), "SQUID",
      else: if(coalesce((iAny(startsWith(softwareTechnologies[], "type:CORE_DNS,")) or in(exe, array("coredns"))), false), "COREDNS",
      else: if(coalesce((iAny(startsWith(softwareTechnologies[], "type:ETCD,"))), false), "ETCD",
      else: if(coalesce((in(exe, array("openshift-apiserver"))), false), "OPENSHIFT_CONTROL_PLANE",
      else: if(coalesce((in(exe, array("pilot-discovery"))), false), "ISTIO",
      else: if(coalesce((in(exe, array("consul", "consul.exe"))), false), "CONSUL",
      else: if(coalesce((startsWith(exe, "otelcol")), false), "OTEL_COLLECTOR",
      else: if(coalesce((in(exe, array("alertmanager"))), false), "ALERTMANAGER",
      else: if(coalesce((in(exe, array("ceph-osd", "ceph-mon", "ceph-mgr"))), false), "CEPH",
      else: if(coalesce((in(exe, array("redpanda"))), false), "REDPANDA")))))))))))))))))))))))))))))))
| filter isNotNull(recTech)
| fieldsAdd host = belongs_to[dt.entity.host]
| lookup [fetch metric.series, from:now()-24h
    | filter metric.key == "dt.sfm.extension.status" and isNotNull(dt.entity.host)
    | summarize localExtensions = collectDistinct(dt.extension.name), by:{dt.entity.host}], sourceField:host, lookupField:dt.entity.host, fields:{localExtensions}
| fieldsAdd localMatches = if((recTech == "TOMCAT" and (contains(localExtensions[], "tomcat")))
      or (recTech == "JBOSS" and (contains(localExtensions[], "jboss")))
      or (recTech == "WEBLOGIC" and (contains(localExtensions[], "weblogic")))
      or (recTech == "WEBSPHERE" and (contains(localExtensions[], "websphere")))
      or (recTech == "KAFKA" and (contains(localExtensions[], "kafka")))
      or (recTech == "ZOOKEEPER" and (contains(localExtensions[], "zookeeper")))
      or (recTech == "ACTIVEMQ" and (contains(localExtensions[], "activemq")))
      or (recTech == "HADOOP" and (contains(localExtensions[], "hadoop")))
      or (recTech == "SPARK" and (contains(localExtensions[], "spark")))
      or (recTech == "JENKINS" and (contains(localExtensions[], "jenkins")))
      or (recTech == "RABBITMQ" and (contains(localExtensions[], "rabbitmq")))
      or (recTech == "IBM_MQ" and (contains(localExtensions[], "ibm-mq")))
      or (recTech == "TIBCO_EMS" and (contains(localExtensions[], "tibco")))
      or (recTech == "HAPROXY" and (contains(localExtensions[], "haproxy")))
      or (recTech == "IIS" and (contains(localExtensions[], "iis")))
      or (recTech == "MSMQ" and (contains(localExtensions[], "msmq")))
      or (recTech == "EXCHANGE" and (contains(localExtensions[], "exchange")))
      or (recTech == "HYPERV" and (contains(localExtensions[], "hyperv")))
      or (recTech == "CITRIX_VDA" and (contains(localExtensions[], "citrix-vda")))
      or (recTech == "SAP_ABAP" and (contains(localExtensions[], "ext.sap")))
      or (recTech == "PHP_FPM" and (contains(localExtensions[], "php-fpm")))
      or (recTech == "SQUID" and (contains(localExtensions[], "squid")))
      or (recTech == "COREDNS" and (contains(localExtensions[], "coredns")))
      or (recTech == "ETCD" and (contains(localExtensions[], "etcd")))
      or (recTech == "OPENSHIFT_CONTROL_PLANE" and (contains(localExtensions[], "kubernetes-control-plane")))
      or (recTech == "ISTIO" and (contains(localExtensions[], "istio")))
      or (recTech == "CONSUL" and (contains(localExtensions[], "consul")))
      or (recTech == "OTEL_COLLECTOR" and (contains(localExtensions[], "otel-collector")))
      or (recTech == "ALERTMANAGER" and (contains(localExtensions[], "alertmanager")))
      or (recTech == "CEPH" and (contains(localExtensions[], "ceph")))
      or (recTech == "REDPANDA" and (contains(localExtensions[], "red-panda") or contains(localExtensions[], "redpanda"))), localExtensions[])
| fieldsAdd localExtension = arrayFirst(arrayRemoveNulls(localMatches))
| summarize processes = count(), hosts = countDistinctExact(host), coveredProcesses = countIf(isNotNull(localExtension)),
    coveredHosts = countDistinctExact(if(isNotNull(localExtension), host)), by:{recTech}
| sort processes desc
```

- **How it works:**
  1. **Prefilter subquery** (`filter id in [...]`): one cheap test per process instance finds candidate IDs: any process
     type in the catalogue (ERLANG for RabbitMQ), any software technology type (the part of each
     `softwareTechnologies` entry before the first comma, for example `type:APACHE_TOMCAT`), any exact lower-case
     `metadata` entry (`exe_name:…`, `java_main_class:…`, `java_jar_file:…`), or a `metadata` entry starting with
     `exe_name:php-fpm` / `exe_name:otelcol`. `iAny()` is true when the condition holds for any element of the array.
     The code comment explains the prefilter: reading the metadata fields and the if-chain over every process instance
     took 10.8 s for 30 days; with the prefilter the README reports 2.6 s.
  2. **Metadata fields** (`metaFields`): `exeAll`, `mainAll`, `jarAll` take the value after `EXE_NAME:`,
     `JAVA_MAIN_CLASS:`, `JAVA_JAR_FILE:` for each metadata entry (null for others); `arrayFirst(arrayRemoveNulls(...))`
     keeps the first value. The iterative expression must be stored in a field before `arrayRemoveNulls()` accepts it,
     hence two steps. The executable and jar are lower-cased; the main class is compared exactly.
  3. **`recTech`**: a nested `if(..., else: ...)` chain in catalogue order; the first technology whose conditions hold
     wins. `coalesce(..., false)` keeps a missing field (no `EXE_NAME`, no `processType`) from turning the whole chain
     into null. `startsWith(softwareTechnologies[], "type:<T>,")` with `iAny` tests the software technology type.
  4. `filter isNotNull(recTech)` drops prefilter candidates that do not match any technology fully (for example a
     RabbitMQ client that is not an Erlang process).
  5. `host = belongs_to[dt.entity.host]`: the host the process runs on.
  6. **Lookup `localExtensions`**: per host, the distinct extension names that report `dt.sfm.extension.status` with
     `dt.entity.host` set (local extensions running in OneAgent), read from `metric.series` (series metadata, no data
     points).
  7. **`localMatches` / `localExtension`**: when the process's technology has a token contained in an extension name on
     its host, `localMatches` keeps the host's extension names element by element (null for others); the first non-null
     element is the covering extension. Note: the condition is evaluated per element, so the extension kept is the
     first one on the host that contains the token.
  8. **Summary per technology:** `processes`, `hosts` (distinct hosts), `coveredProcesses` (processes with a covering
     extension) and `coveredHosts` (distinct hosts with one).
- **Output:** `recTech`, `processes`, `hosts`, `coveredHosts` feed the technologies table, the gauge and AI Assist
  (`coveredProcesses` is not used).
- **Limits and cost:** 0.9 s (24 h), 0.7 s (7 d), 2.6 s (30 d) on the demo tenant (README). No row limit (at most 31
  rows). Stays below DQL's 1000-expression limit because the prefilter is one short test.
- **Open it yourself:** *DQL behind these numbers* and under the technologies table (title "Extensions: recommended
  extensions per technology").

### Q8: Names of scoped hosts and host groups (`extensionScopeNamesQuery` + marker)

- **Source:** `extensionScopeNamesQuery` in [queries.ts](../ui/app/queries.ts#L1115); the marker line is appended in
  `useExtensionsData` in [ExtensionsTab.tsx](../ui/app/tabs/ExtensionsTab.tsx#L146).
- **Runs:** once the configurations are merged, whenever the sorted list of host and host group scope IDs changes. It
  does not depend on the page timeframe: it always looks back 30 days (`EXT_SCOPE_LOOKBACK = "30d"`), because a
  configuration that targets a host not seen for that long is itself a finding.
- **Parameters:** the distinct, sorted scope IDs of configurations scoped to `HOST-…` or `HOST_GROUP-…`
  (`scopeIds`), split into hosts and host groups (an empty list becomes `array("-")`), and a marker: a djb2-style hash
  of the comma-joined ID list in base 36. The example uses `HOST-0000000000000001` and
  `HOST_GROUP-0000000000000002`; the IDs and the marker value vary.
- **Query:**

```dql
fetch dt.entity.host, from:now()-30d
| filter in(id, array("HOST-0000000000000001"))
| fields id, name = entity.name, lastSeen = lifetime[end], monitoringMode, hostGroup = hostGroupName
| append [fetch dt.entity.host_group, from:now()-30d
    | filter in(id, array("HOST_GROUP-0000000000000002"))
    | lookup [fetch dt.entity.host, from:now()-30d | summarize hosts = count(), by:{hostGroupId = instance_of[dt.entity.host_group]}], sourceField:id, lookupField:hostGroupId, fields:{hosts}
    | fields id, name = entity.name, hosts]
| append [data record(id = "#ids", name = "1ba3aom")]
```

With only host scopes the host group branch reads `filter in(id, array("-"))` (and vice versa).

- **How it works:**
  - Hosts: name, last seen (`lifetime[end]`), monitoring mode and host group name of the scoped hosts seen in the last
    30 days.
  - Host groups: name of each scoped host group and the number of hosts in it (`instance_of[dt.entity.host_group]`
    counted over the last 30 days).
  - `append [data record(...)]` adds a marker row. The page only treats the result as loaded when the marker matches the
    current ID list, so a stale or placeholder result never reads as "host not seen".
- **Output:** `id`, `name`, `lastSeen`, `monitoringMode` (hosts), `hosts` (host groups) build the scope map: names and
  links in the scope cells, the host count of host groups, the stale flag, and the diagnosis scope checks (host last
  seen and mode). `hostGroup` is read but not shown.
- **When there is no host or host group scope:** no names query is built; the shared hook runs its placeholder
  `fetch user.events | limit 0` ([useDql.ts](../ui/app/useDql.ts)), whose result is ignored, and scopes count as loaded.
- **Open it yourself:** under *Configurations by where they run* (title "Extensions: scoped hosts and host groups"),
  including the marker line.

### Q9: Processes of one technology (`extensionRecProcessesQuery`)

- **Source:** `extensionRecProcessesQuery` in [queries.ts](../ui/app/queries.ts#L1245) (plus `sidLookup`).
- **Runs:** when you click **Processes** on a technology row; again on timeframe change while the panel is open.
- **Parameters:** timeframe (same rules as Q7, including `from:now()-10d` for the `metric.series` lookup at 30 days) and
  the technology key, which sets `| filter recTech == "<KEY>"` (example: `TOMCAT`).
- **Query (24 h, Tomcat):**

```dql
fetch dt.entity.process_group_instance, from:now()-24h
| filter id in [fetch dt.entity.process_group_instance, from:now()-24h
    | filter in(processType, array("TOMCAT", "JBOSS", "WEBLOGIC", "WEBSPHERE", "ERLANG", "HAPROXY", "IIS", "IIS_APP_POOL"))
      or iAny(in(substring(softwareTechnologies[], to:indexOf(softwareTechnologies[], ",")), array("type:APACHE_TOMCAT", "type:RABBIT_MQ", "type:CORE_DNS", "type:ETCD")))
      or iAny(in(lower(metadata[]), array("java_main_class:kafka.kafka", "java_main_class:io.confluent.support.metrics.supportedkafka", "java_main_class:org.apache.zookeeper.server.quorum.quorumpeermain", "java_main_class:org.apache.activemq.console.main", "java_jar_file:activemq.jar", "java_main_class:org.apache.hadoop.hdfs.server.namenode.namenode", "java_main_class:org.apache.hadoop.hdfs.server.datanode.datanode", "java_main_class:org.apache.hadoop.yarn.server.resourcemanager.resourcemanager", "java_main_class:org.apache.hadoop.yarn.server.nodemanager.nodemanager", "java_main_class:org.apache.spark.deploy.master.master", "java_main_class:org.apache.spark.deploy.worker.worker", "java_jar_file:jenkins.war", "exe_name:amqzxma0", "exe_name:amqzxma0.exe", "exe_name:tibemsd", "exe_name:tibemsd64", "exe_name:tibemsd.exe", "exe_name:tibemsd64.exe", "exe_name:mqsvc.exe", "exe_name:msexchangetransport.exe", "exe_name:microsoft.exchange.store.service.exe", "exe_name:vmms.exe", "exe_name:brokeragent.exe", "exe_name:disp+work", "exe_name:disp+work.exe", "exe_name:squid", "exe_name:coredns", "exe_name:openshift-apiserver", "exe_name:pilot-discovery", "exe_name:consul", "exe_name:consul.exe", "exe_name:alertmanager", "exe_name:ceph-osd", "exe_name:ceph-mon", "exe_name:ceph-mgr", "exe_name:redpanda")))
      or iAny(startsWith(lower(metadata[]), "exe_name:php-fpm"))
      or iAny(startsWith(lower(metadata[]), "exe_name:otelcol"))
    | fields id]
| fieldsAdd exeAll = if(startsWith(metadata[], "EXE_NAME:"), substring(metadata[], from:9)),
    mainAll = if(startsWith(metadata[], "JAVA_MAIN_CLASS:"), substring(metadata[], from:16)),
    jarAll = if(startsWith(metadata[], "JAVA_JAR_FILE:"), substring(metadata[], from:14))
| fieldsAdd exe = arrayFirst(arrayRemoveNulls(exeAll)), main = arrayFirst(arrayRemoveNulls(mainAll)), jar = arrayFirst(arrayRemoveNulls(jarAll))
| fieldsRemove exeAll, mainAll, jarAll
| fieldsAdd exe = lower(exe), jar = lower(jar)
| fieldsAdd recTech = if(coalesce((in(processType, array("TOMCAT")) or iAny(startsWith(softwareTechnologies[], "type:APACHE_TOMCAT,"))), false), "TOMCAT",
      else: if(coalesce((in(processType, array("JBOSS"))), false), "JBOSS",
      else: if(coalesce((in(processType, array("WEBLOGIC"))), false), "WEBLOGIC",
      else: if(coalesce((in(processType, array("WEBSPHERE"))) and not iAny(startsWith(softwareTechnologies[], "type:ZOS_CONNECT,")), false), "WEBSPHERE",
      else: if(coalesce((in(main, array("kafka.Kafka", "io.confluent.support.metrics.SupportedKafka"))), false), "KAFKA",
      else: if(coalesce((in(main, array("org.apache.zookeeper.server.quorum.QuorumPeerMain"))), false), "ZOOKEEPER",
      else: if(coalesce((in(main, array("org.apache.activemq.console.Main")) or in(jar, array("activemq.jar"))), false), "ACTIVEMQ",
      else: if(coalesce((in(main, array("org.apache.hadoop.hdfs.server.namenode.NameNode", "org.apache.hadoop.hdfs.server.datanode.DataNode", "org.apache.hadoop.yarn.server.resourcemanager.ResourceManager", "org.apache.hadoop.yarn.server.nodemanager.NodeManager"))), false), "HADOOP",
      else: if(coalesce((in(main, array("org.apache.spark.deploy.master.Master", "org.apache.spark.deploy.worker.Worker"))), false), "SPARK",
      else: if(coalesce((in(jar, array("jenkins.war"))), false), "JENKINS",
      else: if(coalesce((iAny(startsWith(softwareTechnologies[], "type:RABBIT_MQ,"))) and in(processType, array("ERLANG")), false), "RABBITMQ",
      else: if(coalesce((in(exe, array("amqzxma0", "amqzxma0.exe"))), false), "IBM_MQ",
      else: if(coalesce((in(exe, array("tibemsd", "tibemsd64", "tibemsd.exe", "tibemsd64.exe"))), false), "TIBCO_EMS",
      else: if(coalesce((in(processType, array("HAPROXY"))), false), "HAPROXY",
      else: if(coalesce((in(processType, array("IIS", "IIS_APP_POOL"))), false), "IIS",
      else: if(coalesce((in(exe, array("mqsvc.exe"))), false), "MSMQ",
      else: if(coalesce((in(exe, array("msexchangetransport.exe", "microsoft.exchange.store.service.exe"))), false), "EXCHANGE",
      else: if(coalesce((in(exe, array("vmms.exe"))), false), "HYPERV",
      else: if(coalesce((in(exe, array("brokeragent.exe"))), false), "CITRIX_VDA",
      else: if(coalesce((in(exe, array("disp+work", "disp+work.exe"))), false), "SAP_ABAP",
      else: if(coalesce((startsWith(exe, "php-fpm")), false), "PHP_FPM",
      else: if(coalesce((in(exe, array("squid"))), false), "SQUID",
      else: if(coalesce((iAny(startsWith(softwareTechnologies[], "type:CORE_DNS,")) or in(exe, array("coredns"))), false), "COREDNS",
      else: if(coalesce((iAny(startsWith(softwareTechnologies[], "type:ETCD,"))), false), "ETCD",
      else: if(coalesce((in(exe, array("openshift-apiserver"))), false), "OPENSHIFT_CONTROL_PLANE",
      else: if(coalesce((in(exe, array("pilot-discovery"))), false), "ISTIO",
      else: if(coalesce((in(exe, array("consul", "consul.exe"))), false), "CONSUL",
      else: if(coalesce((startsWith(exe, "otelcol")), false), "OTEL_COLLECTOR",
      else: if(coalesce((in(exe, array("alertmanager"))), false), "ALERTMANAGER",
      else: if(coalesce((in(exe, array("ceph-osd", "ceph-mon", "ceph-mgr"))), false), "CEPH",
      else: if(coalesce((in(exe, array("redpanda"))), false), "REDPANDA")))))))))))))))))))))))))))))))
| filter isNotNull(recTech)
| fieldsAdd host = belongs_to[dt.entity.host]
| lookup [fetch metric.series, from:now()-24h
    | filter metric.key == "dt.sfm.extension.status" and isNotNull(dt.entity.host)
    | summarize localExtensions = collectDistinct(dt.extension.name), by:{dt.entity.host}], sourceField:host, lookupField:dt.entity.host, fields:{localExtensions}
| fieldsAdd localMatches = if((recTech == "TOMCAT" and (contains(localExtensions[], "tomcat")))
      or (recTech == "JBOSS" and (contains(localExtensions[], "jboss")))
      or (recTech == "WEBLOGIC" and (contains(localExtensions[], "weblogic")))
      or (recTech == "WEBSPHERE" and (contains(localExtensions[], "websphere")))
      or (recTech == "KAFKA" and (contains(localExtensions[], "kafka")))
      or (recTech == "ZOOKEEPER" and (contains(localExtensions[], "zookeeper")))
      or (recTech == "ACTIVEMQ" and (contains(localExtensions[], "activemq")))
      or (recTech == "HADOOP" and (contains(localExtensions[], "hadoop")))
      or (recTech == "SPARK" and (contains(localExtensions[], "spark")))
      or (recTech == "JENKINS" and (contains(localExtensions[], "jenkins")))
      or (recTech == "RABBITMQ" and (contains(localExtensions[], "rabbitmq")))
      or (recTech == "IBM_MQ" and (contains(localExtensions[], "ibm-mq")))
      or (recTech == "TIBCO_EMS" and (contains(localExtensions[], "tibco")))
      or (recTech == "HAPROXY" and (contains(localExtensions[], "haproxy")))
      or (recTech == "IIS" and (contains(localExtensions[], "iis")))
      or (recTech == "MSMQ" and (contains(localExtensions[], "msmq")))
      or (recTech == "EXCHANGE" and (contains(localExtensions[], "exchange")))
      or (recTech == "HYPERV" and (contains(localExtensions[], "hyperv")))
      or (recTech == "CITRIX_VDA" and (contains(localExtensions[], "citrix-vda")))
      or (recTech == "SAP_ABAP" and (contains(localExtensions[], "ext.sap")))
      or (recTech == "PHP_FPM" and (contains(localExtensions[], "php-fpm")))
      or (recTech == "SQUID" and (contains(localExtensions[], "squid")))
      or (recTech == "COREDNS" and (contains(localExtensions[], "coredns")))
      or (recTech == "ETCD" and (contains(localExtensions[], "etcd")))
      or (recTech == "OPENSHIFT_CONTROL_PLANE" and (contains(localExtensions[], "kubernetes-control-plane")))
      or (recTech == "ISTIO" and (contains(localExtensions[], "istio")))
      or (recTech == "CONSUL" and (contains(localExtensions[], "consul")))
      or (recTech == "OTEL_COLLECTOR" and (contains(localExtensions[], "otel-collector")))
      or (recTech == "ALERTMANAGER" and (contains(localExtensions[], "alertmanager")))
      or (recTech == "CEPH" and (contains(localExtensions[], "ceph")))
      or (recTech == "REDPANDA" and (contains(localExtensions[], "red-panda") or contains(localExtensions[], "redpanda"))), localExtensions[])
| fieldsAdd localExtension = arrayFirst(arrayRemoveNulls(localMatches))
| filter recTech == "TOMCAT"
| lookup [fetch dt.entity.host, from:now()-24h | fields id, hostName = entity.name, hostGroup = hostGroupName, hostGroupId = instance_of[dt.entity.host_group], monitoringMode], sourceField:host, lookupField:id, fields:{hostName, hostGroup, hostGroupId, monitoringMode}
| fieldsAdd namespaceAll = if(startsWith(metadata[], "KUBERNETES_NAMESPACE:"), substring(metadata[], from:21)),
    podAll = if(startsWith(metadata[], "KUBERNETES_FULL_POD_NAME:"), substring(metadata[], from:25))
| fieldsAdd namespace = arrayFirst(arrayRemoveNulls(namespaceAll)), pod = arrayFirst(arrayRemoveNulls(podAll))
| fieldsRemove namespaceAll, podAll
| lookup [smartscapeNodes "PROCESS", from:now()-24h | fields sid = toString(id), id_classic], sourceField:id, lookupField:id_classic, fields:{sid}
| fields id, sid, name = entity.name, recTech, host, hostName, hostGroup, hostGroupId, monitoringMode, localExtension, namespace, pod
| sort isNotNull(localExtension) asc, hostName asc, name asc
| limit 500
```

- **How it works:** the same base pipeline as Q7 up to `localExtension`, then:
  - `filter recTech == "TOMCAT"` keeps the selected technology.
  - Lookup of the host's name, host group name and ID (`instance_of[dt.entity.host_group]`) and monitoring mode.
  - Kubernetes namespace and full pod name from the process metadata (`KUBERNETES_NAMESPACE:`,
    `KUBERNETES_FULL_POD_NAME:`).
  - `sidLookup`: the Smartscape `PROCESS` node whose `id_classic` is the classic process instance ID, for the process
    link.
  - Processes without a covering extension first (`isNotNull(localExtension) asc` sorts false first), then by host
    and process name; at most 500 rows (`EXT_REC_LIMIT`).
- **Output:** `sid`, `name`, `host`, `hostName`, `hostGroup`, `hostGroupId`, `monitoringMode`, `namespace`, `pod`,
  `localExtension` fill the processes table. `id` is used as a fallback name; `recTech` is not shown.
- **Open it yourself:** under the processes table (title "Extensions: <label> processes and their extension").

## API calls

| Method | Endpoint or SDK method | Scope | When |
| --- | --- | --- | --- |
| GET | `/platform/extensions/v2/extensions?page-size=100`, then `?page-key=<key>` per further page | `extensions:definitions:read` | tab open; Re-check |
| GET | `/platform/extensions/v2/extensions/{extensionName}/monitoring-configurations?page-size=500`, then `?page-key=<key>` | `extensions:configurations:read` | tab open; Re-check; once per extension (six in parallel) |
| (intent) | `sendIntent` to `dynatrace.notebooks` / `view-query` and `dynatrace.dashboards` / `add-to-dashboard` | none (target app permissions) | Open in Notebook / Add to Dashboard |
| (links) | `getIntentLink` / `getAppLink` (`@dynatrace-sdk/navigation`) | none | rendering links |
| POST (app function) | `functions.call("docs-freshness", ...)` (`@dynatrace-sdk/app-utils`) | none; outbound allowlist | once per page load, shared by all tabs (docs freshness line) |

### List extensions

- **Code:** `listExtensions` in [databases.ts](../ui/app/databases.ts#L583), called by `readAllConfigs` in
  [extensions.ts](../ui/app/extensions.ts#L64), sent with `httpClient.send` from `@dynatrace-sdk/http-client`.
- **Request:** `GET /platform/extensions/v2/extensions?page-size=100`; while the response has `nextPageKey`, `GET
  /platform/extensions/v2/extensions?page-key=<nextPageKey>`. No body.
- **Response fields used:** `items[].extensionName`, `items[].version`, `nextPageKey`. The names drive the per-extension
  calls; the name and version map gives "Installed · <version>" in the recommendations and the SNMP *installed* checks.
- **Failure:** the whole Extensions API read fails. The page shows "Extensions API not readable" with the message from
  `extError` (HTTP 403 becomes "Access denied (HTTP 403): the app needs the scope extensions:definitions:read and you need
  the matching permission."; other errors show the API's error message). The tab continues with DQL only.

### Read monitoring configurations

- **Code:** `readMonitoringConfigs(name, false)` in [databases.ts](../ui/app/databases.ts#L610). `withStatus = false`, so
  the `/monitoring-configurations/statuses` call is not made on this tab (the status comes from DQL).
- **Request:** `GET /platform/extensions/v2/extensions/{extensionName}/monitoring-configurations?page-size=500`, then
  `?page-key=<nextPageKey>` while there are more pages. The extension name is URL-encoded, for example
  `/platform/extensions/v2/extensions/com.dynatrace.extension.snmp-generic-device/monitoring-configurations?page-size=500`.
  Six workers process the extension list in parallel (`CONCURRENCY = 6`).
- **Response fields used:** `items[].objectId` (configuration ID, matches `dt.extension.config.id`), `items[].scope`,
  `items[].value.description`, `items[].value.enabled` (anything other than `false` counts as enabled),
  `items[].value.activationContext`, `items[].value.version`, `nextPageKey`. The function also parses endpoints from
  the data source keys (`…Remote`, `…Container`, `…Local`), which this tab does not use. Secrets come back masked.
- **Failure:** the extension is added to the `failed` list ("Monitoring configurations of <n> extension(s) were not
  readable (extensions:configurations:read): …"); the others are still read. When the list is not empty, DQL-only
  configurations are not marked gone.

### Links and intents

| Link | App / intent | Payload |
| --- | --- | --- |
| Extensions app ↗, Add a monitoring configuration ↗, Add or widen a configuration ↗, "<Hub title> in the Extensions app ↗" | `dynatrace.extensions.manager` / `go-to-extensions-manager-from-hub` | `{ extensionName: "<id>", isInstalled: true }` (only for IDs that contain a dot) |
| configuration ↗ | `dynatrace.classic.technologies` / `view-extensions--configuration` | `{ "dt.entity.extensions:configuration": "<entity id>" }` |
| Host name | `dynatrace.infraops` / `view_host` | `{ meId: "HOST-…", "dt.timeframe": { from, to } }` |
| Host group name | `dynatrace.infraops` / `view_host_group` | `{ "dt.entity.host_group": "HOST_GROUP-…", "dt.timeframe": … }` |
| Process name (processes panel) | `dynatrace.infraops` / `view_smartscape_process` | `{ nodeId: "<Smartscape process ID>", "dt.timeframe": … }` |
| Add from Dynatrace Hub ↗, Add <Hub title> from Dynatrace Hub ↗ | `dynatrace.hub` / `search_in_catalog` | `{ searchTerm: "<Hub title>" }` |
| Documentation links | docs.dynatrace.com | |

`dt.timeframe` is the selected timeframe ending now (`timeframePayload` in [links.ts](../ui/app/links.ts)).

This page makes no write calls.

## Remediation actions

The page offers manual actions only (no API fix). They appear in the *Remediation actions* section in an **Action**
dropdown; each option is labelled "Manual · <title>". An action shows a *Variant* selector when it has more than one
code variant, the selected code block with a **Copy** button, numbered steps, optional collapsible *Notes*, and
"Documentation for this fix" with the cited pages (a page that changed after the guidance review on 2026-10-24 is marked
with its update date and a notice; see [index: Documentation freshness](README.md#documentation-freshness)).

### When each action is offered

| Situation | Actions in the dropdown | Default |
| --- | --- | --- |
| No configuration selected | Fastcheck failed; Extension not running on the ActiveGate; Local configuration not running (generic versions, no severity grouping) | Fastcheck failed |
| Configuration selected, any fastcheck row of it classified *failed* | Fastcheck failed: <extension>, then the kind action | Fastcheck failed |
| Configuration selected, kind Remote | Extension not running: <extension> | |
| Configuration selected, kind Local, Kubernetes or Cloud | Local configuration not running: <extension> ("Kubernetes configuration not running: <extension>" for Kubernetes) | |

With a selection, the dropdown groups actions by the most severe diagnosis check each action addresses: **Blocking**
(fail), **Check** (warn), **Info**, **More steps** (only passed checks or none). Fastcheck failed addresses the
`fastcheck` check; Extension not running addresses `group`, `status`, `reason`; Local configuration not running
addresses `scope`, `hosts`, `status`, `reason`. The default selection is the first action of the list above, not the
first group shown.

### Diagnosis checks for a selected configuration

`diagnoseConfig` in [extensions.ts](../ui/app/extensions.ts#L315). Checks are listed Blocking first, then Check, OK,
Info. Labels and colours: Blocking (red), Check (amber), OK (green), Info (grey).

| Check (id) | Applies when | Result | Title / detail |
| --- | --- | --- | --- |
| Disabled (`status`) | configuration disabled | Info; no other check runs | "Disabled": "The configuration is disabled: it does not run until it is enabled again." |
| Not in the Extensions API (`status`) | configuration gone | Info; no other check runs | "Not in the Extensions API": "The configuration reported in the timeframe but is no longer listed: deleted, or not an Extensions 2.0 configuration." |
| Status (`status`) | always otherwise | OK when not broken; Check for WARNING; Blocking otherwise | "Status: <code>". Detail: the status text; for a status taken from a framework event "<text>. No status series in the timeframe; this is the status of the latest framework error."; for NO_DATA "The configuration is enabled but reported no dt.sfm.extension.status series and no framework error in the timeframe: nothing runs it." |
| Scope host (`scope`) | scope type host | Blocking when Q8 has answered and the host is not in it; OK when the host reports this configuration; Check when it is seen but does not report; no check while Q8 is loading | "Scope host not seen in the last 30d": "<host id> reported nothing in the last 30d: the host is gone, so the configuration cannot run. Delete it, or scope it to a host group so new hosts get it." / "Scope: host <name>": "The host reports a status for this configuration." or "The host was last seen <date> (<mode>) but reports no status for this configuration in the timeframe." |
| Scope host group (`scope`) | scope type host_group | Blocking when Q8 has answered and the group is missing or has 0 hosts; otherwise Info | "Scope host group has no hosts": "No host of <name> reported in the last 30d, so the configuration runs nowhere." / "Scope: host group <name>": "<n> hosts in the group in the last 30d; <m> report this configuration in the timeframe." |
| Scope environment (`scope`) | scope `environment` | Info | "Scope: environment": "Every host in the environment gets it; <m> report this configuration in the timeframe." |
| Hosts not OK (`hosts`) | kind Local or Kubernetes and at least one host status other than OK / IDLE | Blocking when any of those hosts is not WARNING; Check when all are WARNING | "<bad> of <n> hosts not OK": the first eight as "<host name> (<status>)", then ", …" |
| ActiveGate group (`group`) | kind Remote, a group is known, and Q5 has answered | Blocking when no ActiveGate with the Extensions module is in the group, or none of them was seen in the last 20 minutes; OK otherwise | "No ActiveGate in <group> runs extensions": "Remote configurations run only on ActiveGates in the group they target with the Extensions module enabled (extension_controller_enabled)." / "No ActiveGate online in <group>": "<n> ActiveGates in the group have the Extensions module, none is connected." / "ActiveGate group <group>": "<online> of <n> ActiveGates with the Extensions module are connected." |
| Fastcheck (`fastcheck`) | the newest fastcheck row classified failed, passed or not picked up | failed: Blocking when its log level is ERROR, Check otherwise; not picked up: Blocking; passed: OK | "Fastcheck failed": "<reason> (<n>× between <first> and <last> UTC)" / "Not picked up for execution": "<message> (last <date> UTC)" / "Fastcheck passed": "Assigned to ActiveGate <agId> in <group> on <date> UTC." |
| Latest error / warning (`reason`) | the configuration is broken, has a Q3 message, and the message differs from the newest fastcheck row used above | Blocking when the level is ERROR, Check otherwise | "Latest error (<date> UTC)" or "Latest warning (<date> UTC)": the first 600 characters of the message |

### Fastcheck failed

- **Fixes:** a remote configuration that the framework does not assign because its fastcheck against the endpoint fails.
- **Offered:** always in the generic list; for a selected configuration when any of its fastcheck rows is classified
  *failed*.
- **Steps:**
  1. Fastcheck is the first check for a monitoring configuration, before any data is collected (for SNMP: one Get of the
     device's system name, with 18 seconds to respond). When it fails, the framework does not assign the configuration
     to the ActiveGate (Failed to assign … Reason: …).
  2. The reason names the endpoint and the error. Wrong credentials, a firewall between the ActiveGates of the group and
     the endpoint, or an endpoint that refuses the query are the usual causes.
  3. Fix the endpoint, the credentials or the network path, then watch the next fastcheck result in the log below (on
     this tenant the framework repeats a failed check about every hour).
- **Variant "DQL: fastcheck and assignment results"** (fixed 7-day window, independent of the page timeframe). Generic:

```dql
fetch dt.system.events, from:now()-7d
| filter event.kind == "EXTENSIONS_EVENT" and event.provider == "EXTENSION_FRAMEWORK_CORE"
| fields timestamp, loglevel, dt.extension.status, content, dt.active_gate.group.name, dt.active_gate.id
| sort timestamp desc
```

  For a selected configuration the filter adds its ID (placeholder ID shown):

```dql
fetch dt.system.events, from:now()-7d
| filter event.kind == "EXTENSIONS_EVENT" and event.provider == "EXTENSION_FRAMEWORK_CORE" and dt.extension.config.id == "vu9U3hXa3q0AAAABAB9jb20uZHluYXRyYWNlLmV4dGVuc2lvbi5zbm1wLWdlbmVyaWMtZGV2aWNl"
| fields timestamp, loglevel, dt.extension.status, content, dt.active_gate.group.name, dt.active_gate.id
| sort timestamp desc
```

- **Documentation for this fix:** [SNMP extensions troubleshooting (fastcheck)](https://docs.dynatrace.com/docs/ingest-from/extensions/develop-your-extensions/data-sources/snmp-extensions/troubleshooting), [Extensions health](https://docs.dynatrace.com/docs/observe/infrastructure-observability/extensions/extensions-health), [Manage extensions](https://docs.dynatrace.com/docs/ingest-from/extensions/manage-extensions).

### Extension not running (remote, from the ActiveGates tab)

- **Fixes:** a remote configuration that no ActiveGate runs or that runs with errors.
- **Offered:** generic list ("Extension not running on the ActiveGate"); selected Remote configurations ("Extension not
  running: <extension>"). Same action as on the [ActiveGates](activegates.md) tab (`extensionAction` in
  [activeGates.ts](../ui/app/activeGates.ts#L1249)).
- **Steps:**
  1. Every ActiveGate that runs an extension must be in an ActiveGate group; the monitoring configuration targets the
     group (for a selection: " (<group>)").
  2. Not picked up (UNASSIGNED): no ActiveGate in the group runs it. Check that an ActiveGate in the group is connected,
     has the Extensions module (extension_controller_enabled) and passes the configuration's check; the message shows
     the failing endpoint.
  3. Every state except OK and IDLE is an error. Right after a change, allow at least 5 minutes while the configuration
     is scheduled and validated.
  4. Resource limits: each data source runs under a performance profile (Default: 5% CPU and 500 MB per data source on
     an ActiveGate). Above the soft limit new tasks are rejected; above the hard limit the newest task is stopped. Use
     High limits or Dedicated limits on ActiveGates that run many extensions.
  5. Open the configuration in Extensions › Manage › the extension › Monitoring configurations (Health tab, Log
     viewer).
- **Variants:**
  - *Group and modules (agctl)*, bash:

    ```bash
    agctl group get
    agctl modules get
    ```

  - *custom.properties*, ini:

    ```ini
    [extension_controller]
    extension_controller_enabled = true
    ```

  - *DQL: framework messages* (fixed 24-hour window). Generic:

    ```dql
    fetch dt.system.events, from:now()-24h
    | filter event.kind == "EXTENSIONS_EVENT"
    | fields timestamp, loglevel, dt.extension.name, dt.extension.status, content, dt.active_gate.id
    | sort timestamp desc
    ```

    For a selected configuration (placeholder ID):

    ```dql
    fetch dt.system.events, from:now()-24h
    | filter event.kind == "EXTENSIONS_EVENT" and dt.extension.config.id == "vu9U3hXa3q0AAAABAB9jb20uZHluYXRyYWNlLmV4dGVuc2lvbi5zbm1wLWdlbmVyaWMtZGV2aWNl"
    | fields timestamp, loglevel, dt.extension.name, dt.extension.status, content, dt.active_gate.id
    | sort timestamp desc
    ```

- **Notes:** "Extensions run on x86-64 only; cluster and multi-environment ActiveGates cannot run them."
- **Documentation for this fix:** [About Extensions](https://docs.dynatrace.com/docs/ingest-from/extensions/concepts), [Extensions health](https://docs.dynatrace.com/docs/observe/infrastructure-observability/extensions/extensions-health), [Manage extensions](https://docs.dynatrace.com/docs/ingest-from/extensions/manage-extensions), [Semantic dictionary: dt.extension.status](https://docs.dynatrace.com/docs/semantic-dictionary/fields), [Configuration properties and parameters of ActiveGate](https://docs.dynatrace.com/docs/ingest-from/dynatrace-activegate/configuration/configure-activegate).

### Local configuration not running

- **Fixes:** a local (OneAgent) or Kubernetes configuration that does not run on the hosts of its scope (including a
  host scope whose host is gone).
- **Offered:** generic list; selected configurations of kind Local, Kubernetes or Cloud.
- **Steps:**
  1. Local extensions run in OneAgent on the hosts in the configuration's scope. Settings are defined at the environment
     level; a host group inherits them and a host inherits from its host group.
  2. A configuration scoped to one host runs only while that host reports with OneAgent. If the host is gone, delete the
     configuration, or scope it to a host group so new hosts get it.
  3. Every state except OK and IDLE is an error. Right after a change, allow at least 5 minutes while the configuration
     is scheduled and validated.
  4. Open the configuration in the Extensions app (Monitoring configurations: Health, Log viewer) for the full message
     per host.
- **Variants:**
  - *DQL: status per host* (fixed 24-hour window). Generic:

    ```dql
    timeseries c = count(dt.sfm.extension.status), by:{dt.entity.host, dt.extension.status}, from:now()-24h
    ```

    For a selected configuration (placeholder ID):

    ```dql
    timeseries c = count(dt.sfm.extension.status), by:{dt.entity.host, dt.extension.status}, filter:{dt.extension.config.id == "vu9U3hXa3q0AAAABAB9jb20uZHluYXRyYWNlLmV4dGVuc2lvbi5zbm1wLWdlbmVyaWMtZGV2aWNl"}, from:now()-24h
    ```

  - *DQL: framework messages*: the same 7-day query as in [Fastcheck failed](#fastcheck-failed), with the configuration
    ID filter for a selection.
- **Documentation for this fix:** [About Extensions](https://docs.dynatrace.com/docs/ingest-from/extensions/concepts), [Extensions health](https://docs.dynatrace.com/docs/observe/infrastructure-observability/extensions/extensions-health), [Manage extensions](https://docs.dynatrace.com/docs/ingest-from/extensions/manage-extensions), [Semantic dictionary: dt.extension.status](https://docs.dynatrace.com/docs/semantic-dictionary/fields).

### Recommendation and SNMP set-up links

The recommendations are not actions in the dropdown; each row and SNMP card links to where the fix happens: the
Extensions app (add or widen a monitoring configuration) or a Dynatrace Hub search (add the extension), plus the SNMP
docs pages. See [Extension recommendations](#extension-recommendations) and [SNMP states](#snmp-states).

After you fix something outside the app, click **Re-check**: the status, event, fastcheck and recommendation queries
run again and the Extensions API is read again. A changed configuration can take at least 5 minutes to be scheduled
and validated (action steps above).

## AI Assist on this page

`analyzeExtensions` in [analyses.ts](../ui/app/analyses.ts#L608). Rule-based, computed in the browser from the data on
screen when the AI Assist panel is open; nothing is sent to a language model. Inputs (built in `ExtensionsTab`):
judged and broken counts, per-kind totals (live configurations) and broken counts, broken counts per status, broken
configurations whose newest failed-or-passed fastcheck row is *failed*, configurations with a stale scope, broken
configurations with NO_DATA, the number of disabled live configurations, the API error, the recommendation rows, the
SNMP states and the selected configuration with the titles of its Blocking checks.

**Summary.** With judged configurations: "<ok> of <judged> enabled extension monitoring configuration(s) (<pct>%) run
without errors (<n> local, <m> remote, …)." followed by either "<k> technology / technologies OneAgent sees on processes
has / have a Hub extension that does not report from all their hosts." or "Every technology with a recommended extension
is covered." Without judged configurations: "No extension monitoring configuration reports a status in this timeframe."
`pct = round(100 × ok / judged)`.

**Insights** (in this order, each only when its condition holds):

| Condition | Severity | Text |
| --- | --- | --- |
| Extensions API error | warning | "The Extensions API was not readable (<message>): scopes and configurations that never ran are missing, statuses come from DQL only." |
| judged > 0 | good when pct ≥ 90, warning when ≥ 50, critical below | "<pct>% of configurations are OK or idle." |
| per kind with broken > 0 | critical | "<Kind>: <broken> of <total> not running as configured." |
| any broken | warning | "Broken by status: <STATUS> (<n>), …" (most frequent first) |
| fastcheck failures | critical | "Fastcheck failed for <first five names>, …: the framework does not assign them to an ActiveGate." |
| stale scopes | critical | "<n> configuration(s) target(s) host(s) not seen in 30 days: <first four>, …." |
| NO_DATA | warning | "Enabled but silent (no status, no framework error): <first five>, …." |
| disabled > 0 | info | "<n> configuration(s) is / are disabled." |
| technologies with uncovered hosts | warning | "Not covered by an extension: <label> (<n> hosts), … (first five)." |
| SNMP card *none* or *installed* | warning | "Network devices: <label> not in use / installed but not configured, …. Routers, switches and firewalls run no OneAgent; SNMP is how Dynatrace sees them." |
| otherwise, both SNMP cards in use | good | "SNMP Autodiscovery and SNMP device extensions are in use for network devices." |
| a configuration is selected | critical when it has Blocking checks, good otherwise | "<name>: <blocking check titles, lower case>." or "<name>: no blocking check." |

Names are "<short extension name> · <description>" (short name: the ID without `com.dynatrace.`,
`com.dynatrace.extension.` or `com.dynatrace.extensions.`).

**Recommendations** (in this order):

| Condition | Impact | Text |
| --- | --- | --- |
| fastcheck failures | high | "Fix the endpoint, credentials or network path named in the fastcheck log; until the check passes the configuration collects nothing." |
| stale scopes | high | "Delete configurations scoped to hosts that are gone, or scope them to a host group so replacement hosts get them." |
| any broken | medium | "Select Fix on a broken configuration for its checks (scope, ActiveGate group, fastcheck, latest error) and the documented steps." |
| SNMP Autodiscovery *none* / *installed* | medium | "Add SNMP Autodiscovery from Dynatrace Hub and configure it with your subnets: …" / "Configure it with your subnets: it inventories SNMP-enabled devices and points each one to the extension that monitors it." |
| SNMP devices *none* / *installed* | medium | "Monitor network devices with <Hub title> (or the vendor SNMP extension: Cisco, Juniper, F5 BIG-IP, Palo Alto) for interface, traffic and SNMP health metrics." |
| a technology with uncovered hosts (the first not installed, else the first) | medium | "Add <Hub title> from Dynatrace Hub for <label> (<n> hosts)." or "Add or widen a <Hub title> monitoring configuration for <label> (<n> hosts)." |
| always | low | "Prefer host group or environment scopes for local extensions: host-scoped configurations break silently when hosts are replaced." |

## Limitations and edge cases

- **Remote coverage is not seen by the recommendations.** A host counts as covered only when a *local* extension
  (series with `dt.entity.host`) reports from it. A technology monitored by a remote extension on an ActiveGate (for
  example RabbitMQ through the Management API, or JMX over the network) shows as not covered. The advice text says "or
  check that a remote one targets these endpoints".
- **Token matching is a substring test** on extension names reporting from the host. A custom extension whose name
  contains the token (for example `iis`, `spark`, `etcd`, `exchange`) counts as coverage.
- **30-day timeframe:** the `metric.series` lookup in Q7 and Q9 covers only the last 10 days, so an extension that
  stopped reporting 10 to 30 days ago does not count as coverage.
- **Recommendation hosts are counted per technology** in the gauge; a host with two technologies counts twice.
  A technology with zero hosts (processes without a host) counts as *Covered*.
- **Scope names always cover 30 days** regardless of the page timeframe; the stale flag means "no entity in the last 30
  days", not "not in the selected timeframe".
- **DQL-only configurations:** when the Extensions API is readable and complete, a configuration seen only in DQL is
  *gone* and is left out of gauges, the Broken table, the scopes table and the donut (its fastcheck rows still appear
  under *All* in the log). When the API failed or some extensions were not readable, such configurations are kept with
  "Scope not readable", disabled configurations cannot be seen, and configurations that never reported are missing.
- **Cloud data acquisition** (`integration-*`, `DATA_ACQUISITION`) reports no status: shown as NOT_REPORTED, never
  broken, not judged. Its Fix / Details shows the *Local configuration not running* action, which does not apply to it.
- **Kubernetes (CONTAINER) configurations** report neither host nor group; their status comes from Q2 without a host,
  so the Hosts column reads "No host reports it".
- **WARNING counts as broken**, in line with the docs rule that every state except OK and IDLE is an error.
- **Limits:** Q3 and Q4 return at most 500 rows (newest first). On a busy tenant older folded fastcheck rows and the
  latest message of less recently failing configurations can be cut off. Q9 shows at most 500 processes.
- **Fastcheck folding** is by exact message text: messages that differ in any detail are separate rows.
- **Classification by message text:** fastcheck results are classified from the English message prefixes the framework
  wrote on the demo tenant (2026-10-24). A different wording falls back to *Message*, or to *Fastcheck failed* when it
  mentions fastcheck and "fail" / "error".
- **Timestamps** in the log are the first 16 characters of the ISO value (UTC), not converted to your time zone.
- **Status of a local configuration** is the worst host status; one failing host makes the whole configuration broken.
- **Q5 and Q6 are not re-run by Re-check**: an ActiveGate that came online after the tab opened is reflected only after a
  timeframe change or reopening the app.
- **Selection persistence:** the selected configuration survives a timeframe change (the kind filter and log filter do
  not); if it disappears from the merged list, the Remediation section returns to the generic actions.
- **Placeholder query:** when no configuration is scoped to a host or host group, the hook still runs `fetch user.events
  | limit 0` (shared `useDql` behaviour); its result and any error are ignored.
- **Extensions app links** are built only for extension IDs that contain a dot.

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| "Extensions API not readable" with "Access denied (HTTP 403)" | The app scope or your user permission `extensions:definitions:read` is missing | Make sure the deployed app has the scope (it is in `app.config.json`) and that your IAM policy grants `extensions:definitions:read`. Click Re-check. |
| "Monitoring configurations of <n> extensions were not readable (extensions:configurations:read)" | Your policy denies `extensions:configurations:read` for those extensions (or all) | Grant `extensions:configurations:read` (check `extensions:extension-name` conditions). |
| "Query failed" in a card | Missing Grail read permission (metrics, system events, entities, Smartscape) or a DQL error | Check the error text; grant the matching `storage:*:read` permission. |
| Every configuration shows NO_DATA | No `dt.sfm.extension.status` series and no framework error in the timeframe | Widen the timeframe; open the configuration's Health tab in the Extensions app. |
| Remote configuration shows "No ActiveGate" | No ActiveGate in the targeted group has the Extensions module, or none is connected | Use the *Extension not running* action (`agctl group get`, `agctl modules get`, `extension_controller_enabled = true`). |
| UNASSIGNED with a fastcheck failure | The fastcheck against the endpoint fails | Read the reason in the Fastcheck log; fix the endpoint, credentials or firewall; wait for the next check (about hourly). |
| "Not seen in the last 30d" on a scope | The host (or every host of the host group) is gone | Delete the configuration or scope it to a host group / the environment. |
| A technology shows "No extension" though it is monitored | The extension runs remotely on an ActiveGate, or its name does not contain the token | See [Limitations](#limitations-and-edge-cases); compare with the extension on the host in the processes panel. |
| SNMP cards stay "Checking SNMP extensions…" | The Extensions API read has not finished | Wait, or click Re-check; check the API warning above the Broken table. |
| "Automatic docs check off" under Remediation actions | `docs.dynatrace.com` is not in the allowed outbound connections | Add it to `builtin:dt-javascript-runtime.allowed-outbound-connections`, then click Retry. |
| Open in Notebook / Add to Dashboard does nothing | The target app or intent is not available to you | Use Copy and paste the query into a notebook. |
| Fastcheck log empty | No extension framework events in the timeframe | Widen the timeframe; the framework writes events only on assignment changes and checks. |

## Related pages

- [Index and app shell](README.md)
- [ActiveGates](activegates.md): the same remote status and event queries, ActiveGate groups and the Extensions module,
  the *Extension not running* action.
- [Databases](databases.md): database extensions (left out of the recommendations here), creating a database monitoring
  configuration.
- [Deep Monitoring](deep-monitoring.md): the documentation freshness check shared by the remediation sections.
- [Kubernetes](kubernetes.md): DynaKube and ActiveGate context for Kubernetes extensions.

## Source files

| File | Role on this page |
| --- | --- |
| [ui/app/tabs/ExtensionsTab.tsx](../ui/app/tabs/ExtensionsTab.tsx) | The tab: data hook (`useExtensionsData`), summary card, Broken table, Fastcheck log, scopes table, Re-check, remediation section, recommendations, AI Assist inputs |
| [ui/app/extensions.ts](../ui/app/extensions.ts) | Kinds and scopes, `readAllConfigs`, fastcheck classification, `mergeConfigs`, status texts, `isBroken` / `isJudged`, `diagnoseConfig`, manual actions, recommendation catalogue names, `toRecRows`, `snmpRows`, `recAdvice` |
| [ui/app/queries.ts](../ui/app/queries.ts) | Q1 to Q9, `EXT_REC_MATCH`, `EXT_SCOPE_LOOKBACK`, `EXT_REC_LIMIT`, `refreshMarker` |
| [ui/app/databases.ts](../ui/app/databases.ts) | Extensions API client (`listExtensions`, `readMonitoringConfigs`, `extError`), `AgGroup`, `Loaded` |
| [ui/app/activeGates.ts](../ui/app/activeGates.ts) | `EXT_OK`, `EXT_STATUS_TEXT`, `extensionAction` |
| [ui/app/analyses.ts](../ui/app/analyses.ts) | `analyzeExtensions` (AI Assist) |
| [ui/app/tabs/ActiveGatesTab.tsx](../ui/app/tabs/ActiveGatesTab.tsx) | `ExtNameCell` (extension cell with links), `extColor` |
| [ui/app/tabs/DeepMonitoringTab.tsx](../ui/app/tabs/DeepMonitoringTab.tsx) | `ActionPicker`, `DocsStatusLine`, `DocsRow`, check labels and colours |
| [ui/app/RemediationPanel.tsx](../ui/app/RemediationPanel.tsx) | `ManualActionView` (variants, copy, steps, notes) |
| [ui/app/tabs/ModePie.tsx](../ui/app/tabs/ModePie.tsx) | `Donut` |
| [ui/app/tabs/AgCharts.tsx](../ui/app/tabs/AgCharts.tsx) | `STATUS_PALETTE` |
| [ui/app/kubernetes.ts](../ui/app/kubernetes.ts) | `categoryColor` (donut palette) |
| [ui/app/components.tsx](../ui/app/components.tsx) | `PctGauge`, `pct`, `QueryActions`, `QueryState`, `formatMode` |
| [ui/app/links.ts](../ui/app/links.ts) | Intent links (Extensions app, configuration page, host, host group, process, Hub search) |
| [ui/app/deepTech.ts](../ui/app/deepTech.ts) | `DOC` catalogue of the cited docs pages |
| [ui/app/deepDocs.ts](../ui/app/deepDocs.ts), [api/docs-freshness.function.ts](../api/docs-freshness.function.ts) | Documentation freshness check |
| [ui/app/useDql.ts](../ui/app/useDql.ts) | DQL hook (`@dynatrace-sdk/react-hooks`) |
| [app.config.json](../app.config.json) | Scopes |
