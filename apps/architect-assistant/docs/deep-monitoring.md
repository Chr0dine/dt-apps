# Deep Monitoring

The Deep Monitoring tab shows how many processes in the environment have a OneAgent **code module** (deep monitoring:
distributed traces, services and code-level metrics), per technology, and helps you find and fix the processes that do
not. It scores every technology OneAgent can instrument with a gauge, lists the technologies it cannot instrument, lets
you search processes or process groups by name, technology and deep-monitoring state, derives a **Status** for each
process (for example *Restart required* or *Blocked: Process group set to "Do not monitor"*) by reading the settings
that decide code-module injection, and offers a **Diagnose** flow that explains why one process or process group is or
is not deep monitored and applies the fix through the Settings API or gives the manual steps. The guidance behind the
fixes is checked against the live Dynatrace documentation (docs freshness), which this page also documents for the other
tabs that use it.

| | |
| --- | --- |
| Area | Visibility (see [index](README.md)) |
| Tab id | `deep` |
| Counts toward Entity Overview readiness / Top findings | No. The tab has its own gauges; none of its numbers feed the Entity Overview score or the Top findings. |
| Main source files | [ui/app/tabs/DeepMonitoringTab.tsx](../ui/app/tabs/DeepMonitoringTab.tsx), [ui/app/deepMonitoring.ts](../ui/app/deepMonitoring.ts), [ui/app/deepTech.ts](../ui/app/deepTech.ts), [ui/app/deepActions.ts](../ui/app/deepActions.ts), [ui/app/queries.ts](../ui/app/queries.ts#L770), [ui/app/deepDocs.ts](../ui/app/deepDocs.ts), [api/docs-freshness.function.ts](../api/docs-freshness.function.ts), [ui/app/analyses.ts](../ui/app/analyses.ts#L508) |

## Contents

- [What this page answers](#what-this-page-answers)
- [How the app decides that a process is deep monitored](#how-the-app-decides-that-a-process-is-deep-monitored)
- [Before you start](#before-you-start)
  - [App scopes used by this page](#app-scopes-used-by-this-page)
  - [User permissions](#user-permissions)
  - [One-time setup](#one-time-setup)
- [Page walkthrough](#page-walkthrough)
  - [Header: documentation link and AI Assist](#header-documentation-link-and-ai-assist)
  - [Deep monitoring by technology (gauges)](#deep-monitoring-by-technology-gauges)
  - [Find processes](#find-processes)
  - [Results: Processes view](#results-processes-view)
  - [Results: Process groups view](#results-process-groups-view)
  - [Remediation actions section](#remediation-actions-section)
- [Checks and scoring](#checks-and-scoring)
  - [Coverage gauges](#coverage-gauges)
  - [Technology catalogue](#technology-catalogue)
  - [Supported versions](#supported-versions)
  - [Status column values](#status-column-values)
  - [Which setting decides injection (evaluation order)](#which-setting-decides-injection-evaluation-order)
  - [How a rule condition is evaluated](#how-a-rule-condition-is-evaluated)
  - [Diagnosis checks, in evaluation order](#diagnosis-checks-in-evaluation-order)
  - [Built-in process monitoring rules](#built-in-process-monitoring-rules)
- [Queries](#queries)
- [API calls](#api-calls)
- [Remediation actions](#remediation-actions)
- [Docs freshness: keeping the guidance current](#docs-freshness-keeping-the-guidance-current)
- [AI Assist on this page](#ai-assist-on-this-page)
- [Limitations and edge cases](#limitations-and-edge-cases)
- [Troubleshooting](#troubleshooting)
- [Related pages](#related-pages)
- [Source files](#source-files)

## What this page answers

- **How much of my application estate is deep monitored?** One gauge per technology OneAgent has a code module for
  (Java and its application servers, .NET, IIS, Node.js, Go, PHP, Python, Apache HTTP Server, NGINX, IBM CICS, and any
  other process type OneAgent reports), plus an overall gauge across all of them.
- **Which technologies does OneAgent not deep monitor at all?** Databases and proxies (SQL Server, MySQL, PostgreSQL,
  MongoDB, Redis, HAProxy), Ruby, Erlang / Elixir, Envoy, OS system process groups, IIS service hosts and unclassified
  processes are listed separately with their instance counts and are not scored.
- **Which processes or process groups are not deep monitored, and why?** The *Find processes* search lists them; the
  *Status* column says, per process, whether it only needs a restart, is blocked by a setting (and which), is excluded
  on purpose by a built-in rule, needs a Kubernetes pod rollout, or runs a technology without a code module.
- **What exactly blocks one process, and how do I fix it?** *Diagnose* evaluates every setting that decides code-module
  injection in the order OneAgent applies them, checks the runtime version against the OneAgent support matrix, and
  offers the matching fix (Settings API write with a dry run, or manual commands).

Best practice checked: every application process of a supported technology runs with a OneAgent code module, which
requires the host to run OneAgent in Full-Stack mode, the technology to be enabled in *Monitored technologies*, no
process-group setting or rule to exclude it, and the process to have been started (or restarted) after OneAgent was
installed or the setting changed. The rules and steps come from these Dynatrace pages (cited in `DOC` in
[ui/app/deepTech.ts](../ui/app/deepTech.ts#L24)):

- [Process deep monitoring](https://docs.dynatrace.com/docs/observe/infrastructure-observability/process-groups/configuration/pg-monitoring)
- [Troubleshoot deep-monitoring issues](https://docs.dynatrace.com/docs/ingest-from/dynatrace-oneagent/oneagent-troubleshooting/troubleshoot-oneagent-deep-monitoring-issues)
- [OneAgent monitoring modes](https://docs.dynatrace.com/docs/platform/oneagent/monitoring-modes/monitoring-modes)
- [Technology support](https://docs.dynatrace.com/docs/ingest-from/technology-support) and
  [End-of-support news](https://docs.dynatrace.com/docs/whats-new/technology/end-of-support-news)
- The Settings 2.0 schema pages for each setting the diagnosis reads (listed in [API calls](#settings-read-for-the-status-column-and-diagnose)).

## How the app decides that a process is deep monitored

Smartscape process nodes carry no injection state, and Grail has no "code module injected" or "restart required" flag
per process. The app therefore reads the classic process group instance table (`dt.entity.process_group_instance`) and
counts a process instance as **deep monitored** when it shows evidence that only a code module produces. The rule is
the `DEEP_FLAG` expression in [ui/app/queries.ts](../ui/app/queries.ts#L809):

```dql
| fieldsAdd isDeep = isNotNull(installerVersion) or coalesce(codeServices, 0) > 0 or (isNotNull(runtimeMetrics) and not in(coalesce(monitoringMode, ""), array("INFRASTRUCTURE", "DISCOVERY")))
```

A process is deep monitored when **any** of these is true:

| Evidence | Field | Where it comes from | Shown as |
| --- | --- | --- | --- |
| The OneAgent build that injected a code module | `installerVersion` on the process group instance | The instance itself (set on every instance that emits OneAgent spans, per the code comment) | `OneAgent 1.347.64 injected` (first three segments of the build) |
| At least one service a code module detected on it | `codeServices` > 0 | `dt.entity.service` records whose `agentTechnologyType` is set and is not `N/A` (for example `JAVA`, `DOTNET`, `NODEJS`, `IIS`, `GO`, `SDK`, `Z`), counted per instance through `runs_on[dt.entity.process_group_instance]`. Database, OpenTelemetry-only and external services carry `N/A` and are not counted. | `3 services from the JAVA code module` |
| Code-module runtime metrics, on a host that is not in Infrastructure or Discovery mode | `runtimeMetrics` not null and host `monitoringMode` not `INFRASTRUCTURE` / `DISCOVERY` | `metric.series` keys starting with `dt.runtime.` (JVM, CLR, Node.js, IIS, ...) that carry the instance as `dt.entity.process_group_instance`. Up to 3 keys per instance are kept. In Infrastructure or Discovery mode OneAgent injects for runtime metrics only (no traces), so these metrics do not count there. A host without a reported mode (null) does count them. | `runtime metrics (dt.runtime.jvm.gc.time, dt.runtime.jvm.threads, …)` |

The runtime-metric rule catches instances without `installerVersion`, for example Node.js clients that have runtime
metrics but no incoming requests. The evidence strings are built by `evidenceOf` in
[ui/app/deepMonitoring.ts](../ui/app/deepMonitoring.ts#L149) and appear in the Status hover text, the *Deep monitored*
check of the diagnosis and the IIS worker list.

In the browser (`toInstance`, [ui/app/deepMonitoring.ts](../ui/app/deepMonitoring.ts#L159)) the record's `isDeep` is
used as is; if the field is missing (null), the instance counts as deep monitored only when `installerVersion` is set.

The **technology** of a process is the classic `processType`, with one exception: processes typed `IIS` whose metadata
contains `EXE_NAME:svchost.exe` or `EXE_NAME:inetinfo.exe` are split out as `IIS_SERVICE_HOST`, because they only host
the IIS services; OneAgent instruments IIS in the `w3wp.exe` worker processes (IIS app pools). Processes without a
`processType` get the technology `OTHER`.

## Before you start

### App scopes used by this page

Scopes come from [app.config.json](../app.config.json). DQL runs with the intersection of the app's scopes and the
signed-in user's permissions.

| Scope | What this page uses it for |
| --- | --- |
| `storage:entities:read` | Every query: `fetch dt.entity.process_group_instance`, and the lookups into `dt.entity.process_group` (names), `dt.entity.host` (name, host group, monitoring mode, OneAgent version, OS) and `dt.entity.service` (services detected by a code module). |
| `storage:metrics:read` | The runtime-metric evidence: `fetch metric.series` filtered to `dt.runtime.*` keys. |
| `storage:smartscape:read` | The search, detail and IIS worker queries look up the Smartscape node ID of each process (`smartscapeNodes "PROCESS"`) for the *Process* link. |
| `settings:objects:read` | Reading the 16 settings schemas that decide injection (Status column and Diagnose), the process group monitoring state of each result (Process groups view), and the environment-wide automatic deep monitoring setting (generic action). |
| `settings:objects:write` | Every API fix: process group monitoring, host-level process group monitoring, custom process monitoring rules, automatic deep monitoring, Monitored technologies switches, container injection, container monitoring rules, and host monitoring mode (`builtin:host.monitoring.mode`). |

The docs-freshness check runs as an app function and needs no scope; it needs an outbound connection (see
[One-time setup](#one-time-setup)). Links to other apps (intents) and *Open in Notebook* / *Add to Dashboard* need no
scope.

### User permissions

- **Reading:** the user needs read access to the same Grail data (entities, metrics, Smartscape) and
  `settings:objects:read` for the schemas listed under [API calls](#settings-read-for-the-status-column-and-diagnose).
  Without settings read access the Status column shows "—" and Diagnose evaluates every setting as if no object existed
  (see [Troubleshooting](#troubleshooting)).
- **Writing (API fixes):** the user needs the platform permission `settings:objects:write` for the schema being written
  (policies can restrict it per schema). The app scope alone is not enough: the app can never do more than the user.
  *Validate* calls the same endpoint with `validateOnly=true`.
- **Links:** opening Infrastructure & Operations, Settings, Settings Classic, the classic process page, OneAgent
  diagnostics, Notebooks and Dashboards needs access to those apps.
- **Manual steps** need access to the hosts (`oneagentctl`, `systemctl`, IIS), the Kubernetes cluster (`kubectl`), or
  the CICS region, as the step says.

### One-time setup

- **Outbound connection for the docs-freshness check.** The `docs-freshness` app function reads
  `https://docs.dynatrace.com/docs/sitemap.xml`. When the environment enforces the allowlist in
  `builtin:dt-javascript-runtime.allowed-outbound-connections`, add `docs.dynatrace.com` to it. Until then the
  Remediation actions header says "Automatic docs check off: add docs.dynatrace.com to the allowed outbound
  connections (setting ↗)". Everything else on the page works without it.
- No credential vault entry, OAuth client or token is needed.

## Page walkthrough

The tab is rendered by `DeepMonitoringTab` ([ui/app/tabs/DeepMonitoringTab.tsx](../ui/app/tabs/DeepMonitoringTab.tsx#L1271)).
It receives the header timeframe (`24h` default, `7d`, `30d`) and passes it to every query and to every link into another
app (as `dt.timeframe`, so the target app opens on the same window).

### Header: documentation link and AI Assist

- Top right: **Deep Monitoring documentation** opens this page on GitHub (`TabDocsLink`, [ui/app/areas.tsx](../ui/app/areas.tsx)).
- When **AI Assist** is switched on in the app header, the AI Assist panel appears at the top of the tab (see
  [AI Assist on this page](#ai-assist-on-this-page)).

### Deep monitoring by technology (gauges)

Heading **Deep monitoring**, then this text: "Share of processes with a OneAgent code module (deep monitoring: traces,
services and code-level metrics), per technology. A process counts as deep monitored when it shows evidence only a code
module produces: the OneAgent version that injected it, services a code module detected on it, or code-module runtime
metrics (dt.runtime.*) on a host that is not in Infrastructure or Discovery mode."

Data: [Query 1, `deepCoverageQuery`](#1-deep-monitoring-by-technology-deepcoveragequery), one row per technology with
`total` and `deep`. The rows are split in the browser (`useTechRows`, [DeepMonitoringTab.tsx](../ui/app/tabs/DeepMonitoringTab.tsx#L75)):

- Rows with `total` = 0 are dropped.
- **Scored** technologies: catalogue kind `deep` (see [Technology catalogue](#technology-catalogue)). A `processType`
  the catalogue does not know is scored too, labelled in title case (`SOME_NEW_TYPE` becomes "Some New Type").
- **Not scored**: catalogue kind `none` (no OneAgent code module).
- **Dynatrace components** (`APMNG`: OneAgent and ActiveGate helper processes) are in neither list.

What is shown, in one card:

| Element | Value |
| --- | --- |
| Gauge **All technologies** | `round(sum(deep) / sum(total) * 100)` over the scored technologies; detail "`deep` of `total`" (thousands separators). |
| One gauge per scored technology | `round(deep / total * 100)`, caption = technology label (for example "Java", "IIS app pool (.NET)"), detail "`deep` of `total`". Sorted by `total`, largest first. |
| Line under the gauges (only if there are unscored technologies) | "Not scored (OneAgent has no code module for these): SQL Server (12), Linux system (40), …. Dynatrace's own processes are left out." Sorted by count, largest first. |

Gauges are the shared `PctGauge` (custom SVG, red-to-green gradient, rounded integer percent); they have no (i) button
and no click action on this tab.

States: "Loading…" until the query returns; a red "Query failed" box with the error message if it fails; "No processes
of a deep-monitorable technology found for this timeframe." when no scored technology has instances. Under the card:
**Show DQL / Copy / ↗ Open in Notebook / ↗ Add to Dashboard** for the query, titled "Deep monitoring by technology".

### Find processes

A card titled **Find processes** (`DeepSearch`, [DeepMonitoringTab.tsx](../ui/app/tabs/DeepMonitoringTab.tsx#L412)).
Nothing runs until you click the search button. Changing any field clears the results shown, so the results always
match the fields.

| Control | Options | Default | Effect on the query |
| --- | --- | --- | --- |
| **Show** | Processes / Process groups | Processes | Processes run [Query 2](#2-process-search-deepprocesssearchquery); Process groups run [Query 3](#3-process-group-search-deepgroupsearchquery). Switching to Processes while *Partially deep monitored* is selected resets the state to *Not deep monitored*. |
| **Process name contains** (placeholder "e.g. java") | free text, trimmed | empty | Adds `contains(entity.name, "<text>", caseSensitive:false)` to the first filter (instance name). Quotes and backslashes are escaped. |
| **Process group contains** (placeholder "e.g. checkout") | free text, trimmed | empty | Adds `\| filter contains(pgName, "<text>", caseSensitive:false)` after the process group name lookup. |
| **Technology** | *Any technology*, then every technology found by the coverage query for the timeframe (scored and not scored, without Dynatrace components), sorted by label | Any technology | Adds `technology == "<KEY>"` (for example `"JAVA"`, `"IIS_SERVICE_HOST"`, `"OTHER"`) to the first filter. |
| **Deep monitoring** | Any state / Deep monitored / Not deep monitored / Partially deep monitored (Process groups only) | Not deep monitored | Processes: `\| filter isDeep` or `\| filter not isDeep` after the flag (nothing for Any state). Process groups: after `summarize`, `\| filter deep == instances` (all), `\| filter deep == 0` (none), `\| filter deep > 0 and deep < instances` (some), nothing for Any state. |
| **Search processes** / **Search process groups** (primary button) | | | Builds the query for the current timeframe and shows the results below. |

Hint under the form: "Use Diagnose on a result to check why it is (or isn't) deep monitored; the remediation section
below shows the fixes for its technology and version."

### Results: Processes view

`ProcessResults` ([DeepMonitoringTab.tsx](../ui/app/tabs/DeepMonitoringTab.tsx#L186)). Up to 150 process instances
(`DEEP_SEARCH_LIMIT`), sorted by name, in a sortable table with 50 rows per page (`DEEP_PAGE_SIZE`; the page size
cannot be changed).

As soon as the rows arrive, the app reads every setting that decides injection for all rows at once
([`readDeepSettings`](#settings-read-for-the-status-column-and-diagnose), up to 150 host scopes) and computes the
**Status** of each row with the same checks as Diagnose. The read runs once per result set (keyed on the list of
instance IDs), not on every render.

**Status filter and hint** (shown when there is at least one row):

- **Status** select: "All statuses (N)", then one option per status present in the results with its count, in this
  order: Restart required, Restart to update, Roll out pod, Blocked by a setting, Check, Not monitored on purpose, No
  code module for the technology, Deep monitored, Dynatrace component. The filter is client-side: it only filters the
  rows already fetched.
- Hint: while reading, "Reading the monitoring settings for the status column…"; after, "Status combines the code
  module with the monitoring settings (the same checks as Diagnose). Restart required: nothing blocks injection, so the
  process started before OneAgent or the change. Hover a status for the reason."; on failure, "Status unavailable: could
  not read the monitoring settings (<error>)."

**Columns:**

| Column | Content | Source |
| --- | --- | --- |
| Process | Process instance name | `entity.name` |
| Process group | Process group name (falls back to the ID) | `pgName` from the process group lookup |
| Technology | Catalogue label of the technology | `technology` / `processType`, see [Technology catalogue](#technology-catalogue) |
| Version | Runtime version of the main technology, or "—" | Parsed from `softwareTechnologies`, then `jvmClrVersion` / `appVersion` (see [Client-side post-processing](#client-side-post-processing)) |
| Deep monitored | "Yes · 1.347.64" (code module build, first three segments), "Yes · services" (no build, but code-module services), "Yes · runtime metrics" (only runtime-metric evidence), or "No". Green for Yes, red for No. | `isDeep`, `installerVersion`, `codeServices` |
| Status | One of the [Status values](#status-column-values), coloured by tone (green good, amber warn, red bad, default text for neutral). Hover shows the reason. "Checking…" while the settings are read; "—" if the read failed. | `processStatus` in [deepMonitoring.ts](../ui/app/deepMonitoring.ts#L698) |
| Host | Host name, or "—" | `hostName` from the host lookup |
| Links | **Process ↗** (Infrastructure & Operations, `view_smartscape_process` with the Smartscape node ID; only when the node was found) and **Process group ↗** (Infrastructure & Operations, `view_process_group` with the classic ID). Both carry the timeframe. Not sortable. | `sid`, `pg` |
| Deep monitoring setting | The process group's *Process group monitoring* value: **Monitor** (green, `MONITORING_ON`), **Do not monitor** (red, `MONITORING_OFF`), **Default** (no object), "…" while reading; then **Setting ↗** (the setting for this process group in the Settings app) and **Classic ↗** (the same setting in Settings Classic). | `builtin:process-group.monitoring.state` objects from the same settings read |
| Remediation | **Diagnose** button; **Selected** (accent) on the row being diagnosed. Not sortable. | |

Empty table text: "No processes match these filters." (or "No processes with this status in the results." when a
status is selected). When 150 rows came back: "Showing the first 150 processes (sorted by name); narrow the filters to
find others." Below the table: **Show DQL / Copy / Open in Notebook / Add to Dashboard**, titled "Deep monitoring:
process search".

**Diagnose** selects the row (`kind: "process"`, the process group instance ID) and scrolls smoothly to the Remediation
actions section after 100 ms.

### Results: Process groups view

`GroupResults` ([DeepMonitoringTab.tsx](../ui/app/tabs/DeepMonitoringTab.tsx#L324)). Up to 150 process groups, sorted by
name, 50 per page. The name and technology filters apply to **instances before they are grouped**, so *Instances* and
*Deep monitored* only count the instances that match them.

When the rows arrive, the app reads the *Process group monitoring* state of every listed group
([`readPgStates`](#process-group-monitoring-states-process-groups-view), one GET per 80 groups).

| Column | Content | Source |
| --- | --- | --- |
| Process group | Name (falls back to the ID) | `pgName` |
| Technology | Labels of the distinct technologies of its instances, comma-separated | `technologies` |
| Versions | Distinct raw versions, comma-separated, or "—" | `versions` = distinct `coalesce(jvmClrVersion, appVersion)` |
| Instances | Number of matching instances | `instances` |
| Deep monitored | "`deep` of `instances` (`pct`%)", coloured on the red-to-green scale by the percentage | `deep`, `round(deep / instances * 100)` |
| Hosts | Number of distinct hosts | `hosts` |
| Links | **Process group ↗** | `pg` |
| Deep monitoring setting | Monitor / Do not monitor / Default, "…" while reading (and if the read failed), plus **Setting ↗** and **Classic ↗** | `readPgStates` |
| Remediation | **Diagnose** / **Selected** | |

Empty text: "No process groups match these filters." When 150 rows came back: "Showing the first 150 process groups
(sorted by name); narrow the filters to find others." Query actions titled "Deep monitoring: process group search".
There is no Status column in this view.

**Diagnose** selects the group (`kind: "group"`, the process group ID) and scrolls to the Remediation actions section.

### Remediation actions section

`DeepRemediation` ([DeepMonitoringTab.tsx](../ui/app/tabs/DeepMonitoringTab.tsx#L1241)), a card with the anchor
`remediation-deep-monitoring`.

**Header:**

- Heading **Remediation actions**.
- Subtitle: before a selection, "Select Diagnose on a process or process group above for checks and fixes specific to
  its technology and version."; after, "Why the selected process (group) is or isn't deep monitored, and how to fix it."
- The **docs status line** (`DocsStatusLine`, [DeepMonitoringTab.tsx](../ui/app/tabs/DeepMonitoringTab.tsx#L521)):
  "Guidance reviewed against the Dynatrace docs on 2026-10-24." followed by the result of the
  [docs-freshness check](#docs-freshness-keeping-the-guidance-current): "Checking the docs for later changes…", "No
  cited page has changed since.", "N cited pages changed since; the fixes that cite them are marked.", "Automatic docs
  check off: add docs.dynatrace.com to the allowed outbound connections (setting ↗)." or "Docs check failed:
  <message>". The last two have a **Retry** link.
- **Clear selection** button (only with a selection): clears the selection and the AI Assist selection insight.

**Before anything is selected**, the section shows an *Action* dropdown with the generic actions (no grouping; the first
is preselected):

| Action (dropdown text) | Kind | Details |
| --- | --- | --- |
| API · Enable automatic deep monitoring (environment) | API | [Automatic deep monitoring for the environment](#generic-enable-automatic-deep-monitoring-environment) |
| Manual · Restart processes after installing OneAgent | Manual | [Generic restart](#generic-restart-processes-after-installing-oneagent) |
| Manual · Kubernetes: Operator injection | Manual | [Kubernetes injection](#kubernetes-operator-injection) with placeholders |
| Manual · Instrument with OpenTelemetry | Manual | [OpenTelemetry](#instrument-with-opentelemetry--trace-envoy--monitor-with-an-extension) for "the application" |

**After Diagnose** (`SelectedRemediation`, [DeepMonitoringTab.tsx](../ui/app/tabs/DeepMonitoringTab.tsx#L1175)):

1. The app runs [Query 4, `deepDetailQuery`](#4-diagnose-detail-deepdetailquery) for the process instance, or for up to
   200 instances of the process group. "Loading…" meanwhile. If nothing comes back: "The selected process (group) was
   not found in this timeframe."
2. It reads every setting that decides injection for these instances
   ([`readDeepSettings`](#settings-read-for-the-status-column-and-diagnose), up to 50 host scopes; "Reading the
   monitoring settings…" meanwhile), then runs `diagnose` ([deepMonitoring.ts](../ui/app/deepMonitoring.ts#L501)). If
   the read fails: "Could not read the monitoring settings (<error>); setting checks are incomplete." in red, and the
   diagnosis is computed against empty settings (every schema at its default).
3. The **target** of the diagnosis is the first instance (by name) without a code module, or the first instance if all
   have one. Technology, version, switches, container and Go checks are evaluated for the target; the decision, mode,
   rule, Kubernetes and restart checks for every instance without a code module.

What is shown, top to bottom:

| Element | Content |
| --- | --- |
| Summary line | "**name** · Technology version (vendor) · X of N instances deep monitored" (group) or "· deep monitored" / "· not deep monitored" (process), plus " (first 200 instances)" when the group hit the limit. Version and vendor are the target's. |
| Settings error | See step 2. |
| Technology support notice | Only when a Dynatrace page behind the technology's supported-version check changed after the review: "The Java support page changed after this catalogue was reviewed (2026-10-24), so the supported-version check below may be out of date: Java ↗ (updated 2026-11-02)." |
| IIS worker processes | Only when the target is an IIS service host (`svchost.exe` / `inetinfo.exe`): runs [Query 5, `iisWorkersQuery`](#5-iis-worker-processes-iisworkersquery) for the hosts of the group's instances (first 50) and lists each `w3wp.exe` worker: "**name** on host: deep monitored / not deep monitored (evidence)". Empty: "No IIS app pool processes found on this host in the timeframe." With its own query actions, titled "IIS worker processes". |
| Check list | Every [diagnosis check](#diagnosis-checks-in-evaluation-order), sorted Blocking (`fail`), Check (`warn`), OK (`pass`), Info (`info`); within a status, in evaluation order. Each row: status label in its colour (red, amber, green, grey), title, detail. Checks the app inferred (restart, Kubernetes workload, code module older than OneAgent) add a blue **Confirm first** box with links to the process's own monitoring state (see below). |
| Action dropdown and form | The [remediation actions](#remediation-actions) for this diagnosis, grouped *Blocking*, *Check*, *Info*, *More steps*. The first action of the most severe group is preselected. Each option starts with "API · " or "Manual · ". |
| Documentation for this fix | Under the selected action; see [Documentation for this fix](#documentation-for-this-fix). |
| Query actions | For the detail query, titled "Deep monitoring detail: <name>". |

**Confirm first** links (`processStatePages`, [ui/app/links.ts](../ui/app/links.ts#L84)), all with the timeframe:

| Link | App / intent | Payload |
| --- | --- | --- |
| Process (Infrastructure & Operations) | `dynatrace.infraops` / `view_smartscape_process` | `nodeId` = Smartscape process ID (only when found) |
| Process page (classic) | `dynatrace.classic.technologies` / `view-process-group-instance` | `dt.entity.process_group_instance` = `PROCESS_GROUP_INSTANCE-…` |
| OneAgent diagnostics for the host | `dynatrace.classic.mda` / `view-oneagent-diagnostics` | `dt.entity.host` = `HOST-…` (no timeframe) |

The selection stays when the timeframe changes; the detail query then re-runs for the new window. After a successful
API fix the settings are read again and the diagnosis is recomputed (the detail query is not re-run, so the instance's
code-module evidence only changes after the process restarts and you diagnose or search again).

## Checks and scoring

### Coverage gauges

| Gauge | In place when | Numerator | Denominator | Rounding | Notes |
| --- | --- | --- | --- | --- | --- |
| All technologies | instance is deep monitored | sum of `deep` over scored technologies | sum of `total` over scored technologies | `Math.round`, 0 when the denominator is 0 | Unscored technologies and Dynatrace components excluded. |
| One per scored technology | instance is deep monitored | `deep` for the technology | `total` for the technology | same | One instance = one process group instance seen in the timeframe. |

There are no thresholds on the gauges; the colour is the position on the red-to-green gradient.

### Technology catalogue

`CATALOGUE` and `techInfo` in [ui/app/deepTech.ts](../ui/app/deepTech.ts#L383). *Kind* `deep` = scored, OneAgent has a
code module; `none` = not scored, no code module; `dynatrace` = Dynatrace's own processes. *Version from* lists the
`softwareTechnologies` types read first, then the fallback field. *Needs rule* = only deep monitored when a rule (or the
process group set to Monitor) includes it.

| Key (`technology`) | Label | Kind | Version from | Fallback | Monitored technologies switch (schema) | Needs rule | Alternative | Docs (tech + vendor) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `JAVA` | Java | deep | JAVA | `jvmClrVersion` | Monitor Java (`builtin:monitored-technologies.java`) | no | - | [Java](https://docs.dynatrace.com/docs/ingest-from/technology-support/application-software/java), [Support for JVMs](https://docs.dynatrace.com/docs/ingest-from/technology-support/application-software/java/support-for-jvms), [Eclipse Temurin support](https://adoptium.net/support/) |
| `TOMCAT` | Tomcat | deep | JAVA | `jvmClrVersion` | Monitor Java | no | - | as Java |
| `JBOSS` | JBoss / WildFly | deep | JAVA | `jvmClrVersion` | Monitor Java | no | - | as Java |
| `WEBLOGIC` | WebLogic | deep | JAVA | `jvmClrVersion` | Monitor Java | no | - | as Java |
| `WEBSPHERE` | WebSphere | deep | JAVA | `jvmClrVersion` | Monitor Java | no | - | as Java |
| `GLASSFISH` | GlassFish | deep | JAVA | `jvmClrVersion` | Monitor Java | no | - | as Java |
| `DOTNET` | .NET | deep | DOTNET | - | Monitor .NET (`builtin:monitored-technologies.dotnet`) | yes | - | [.NET](https://docs.dynatrace.com/docs/ingest-from/technology-support/application-software/dotnet), [.NET support policy (Microsoft)](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core) |
| `IIS_APP_POOL` | IIS app pool (.NET) | deep | DOTNET | - | Monitor .NET | no | - | as .NET |
| `IIS` | IIS | deep | IIS, IIS_APP_POOL | `appVersion` | Monitor IIS (`builtin:monitored-technologies.iis`) | no | - | [Technology support](https://docs.dynatrace.com/docs/ingest-from/technology-support) |
| `IIS_SERVICE_HOST` | IIS service hosts | none | - | - | - | no | system | [Technology support](https://docs.dynatrace.com/docs/ingest-from/technology-support), [Schema: built-in process monitoring rules](https://docs.dynatrace.com/docs/dynatrace-api/environment-api/settings/schemas/builtin-process-built-in-process-monitoring-rule) |
| `NODE_JS` | Node.js | deep | NODE_JS | `appVersion` | Monitor Node.js (`builtin:monitored-technologies.nodejs`) | no | - | [Node.js](https://docs.dynatrace.com/docs/ingest-from/technology-support/application-software/nodejs), [Node.js releases](https://nodejs.org/en/about/previous-releases) |
| `GO` | Go | deep | GO | - | Monitor Go (`builtin:monitored-technologies.go`) | yes | - | [Go](https://docs.dynatrace.com/docs/ingest-from/technology-support/application-software/go), [Supported Go versions](https://docs.dynatrace.com/docs/ingest-from/technology-support/application-software/go/support/supported-go-versions), [Go known limitations](https://docs.dynatrace.com/docs/ingest-from/technology-support/application-software/go/support/go-known-limitations), [Enable Go monitoring](https://docs.dynatrace.com/docs/ingest-from/technology-support/application-software/go/configuration-and-analysis/enable-go-monitoring), [Go release policy](https://go.dev/doc/devel/release) |
| `PHP` | PHP | deep | PHP | `appVersion` | Monitor PHP (`builtin:monitored-technologies.php`) | no | - | [PHP](https://docs.dynatrace.com/docs/ingest-from/technology-support/application-software/php), [PHP supported versions](https://docs.dynatrace.com/docs/ingest-from/technology-support/application-software/php/php-supported-versions), [Full-stack PHP monitoring](https://docs.dynatrace.com/docs/ingest-from/technology-support/application-software/php/full-stack-monitoring), [PHP supported versions (php.net)](https://www.php.net/supported-versions.php) |
| `PYTHON` | Python | deep | PYTHON | `appVersion` | Monitor Python (`builtin:monitored-technologies.python`) | yes | - | [Python](https://docs.dynatrace.com/docs/ingest-from/technology-support/application-software/python), [Python versions (python.org)](https://devguide.python.org/versions/) |
| `APACHE_HTTPD` | Apache HTTP Server | deep | APACHE_HTTP_SERVER | `appVersion` | Monitor Apache HTTP Server (`builtin:monitored-technologies.apache`) | no | - | [Technology support](https://docs.dynatrace.com/docs/ingest-from/technology-support), [Troubleshoot OneAgent installation](https://docs.dynatrace.com/docs/ingest-from/dynatrace-oneagent/oneagent-troubleshooting/troubleshoot-oneagent-installation) |
| `NGINX` | NGINX | deep | NGINX | `appVersion` | Monitor Nginx (`builtin:monitored-technologies.nginx`) | no | - | [NGINX](https://docs.dynatrace.com/docs/ingest-from/technology-support/application-software/nginx), [NGINX runtime instrumentation](https://docs.dynatrace.com/docs/ingest-from/technology-support/application-software/nginx/manual-runtime-instrumentation) |
| `IBM_CICS_REGION` | IBM CICS | deep | IBM_CICS_REGION | - | - | no | - | [Mainframe technology support](https://docs.dynatrace.com/docs/ingest-from/technology-support/mainframe-technology-support), [Install the CICS module](https://docs.dynatrace.com/docs/ingest-from/dynatrace-oneagent/installation-and-operation/zos/installation/install-cics) |
| `APMNG` | Dynatrace components | dynatrace | - | - | - | no | - | - |
| `LINUX_SYSTEM` | Linux system | none | - | - | - | no | system | [Technology support](https://docs.dynatrace.com/docs/ingest-from/technology-support) |
| `WINDOWS_SYSTEM` | Windows system | none | - | - | - | no | system | [Technology support](https://docs.dynatrace.com/docs/ingest-from/technology-support) |
| `RUBY` | Ruby | none | RUBY | - | - | no | otel | [Ruby](https://docs.dynatrace.com/docs/ingest-from/technology-support/application-software/ruby), [Ruby with OpenTelemetry](https://docs.dynatrace.com/docs/ingest-from/opentelemetry/walkthroughs/ruby), [OTLP API endpoints](https://docs.dynatrace.com/docs/ingest-from/opentelemetry/otlp-api) |
| `ERLANG` | Erlang / Elixir | none | ERLANG | - | - | no | otel | [Erlang/Elixir](https://docs.dynatrace.com/docs/ingest-from/technology-support/application-software/erlang-elixir), [Erlang with OpenTelemetry](https://docs.dynatrace.com/docs/ingest-from/opentelemetry/walkthroughs/erlang), [OTLP API endpoints](https://docs.dynatrace.com/docs/ingest-from/opentelemetry/otlp-api) |
| `ENVOY` | Envoy | none | ENVOY | - | - | no | otel | [Envoy OpenTelemetry tracing](https://docs.dynatrace.com/docs/ingest-from/opentelemetry/integrations/envoy), [OTLP API endpoints](https://docs.dynatrace.com/docs/ingest-from/opentelemetry/otlp-api) |
| `MSSQL` | SQL Server | none | - | - | - | no | extension | [Databases](https://docs.dynatrace.com/docs/observe/infrastructure-observability/databases), [SQL Server extension](https://docs.dynatrace.com/docs/observe/infrastructure-observability/databases/extensions/microsoft-sql-server-2) |
| `MYSQL` | MySQL | none | - | - | - | no | extension | [Databases](https://docs.dynatrace.com/docs/observe/infrastructure-observability/databases), [MySQL extension](https://docs.dynatrace.com/docs/observe/infrastructure-observability/databases/extensions/mysql-remote-monitoring-v2) |
| `POSTGRES` | PostgreSQL | none | - | - | - | no | extension | [Databases](https://docs.dynatrace.com/docs/observe/infrastructure-observability/databases), [PostgreSQL extension](https://docs.dynatrace.com/docs/observe/infrastructure-observability/databases/extensions/postgresdb-remote-monitoring) |
| `MONGODB` | MongoDB | none | - | - | - | no | extension | [Databases](https://docs.dynatrace.com/docs/observe/infrastructure-observability/databases), [MongoDB extension](https://docs.dynatrace.com/docs/observe/infrastructure-observability/databases/extensions/mongodb-local-or-remote-monitoring) |
| `REDIS` | Redis | none | - | - | - | no | extension | [Redis extension](https://docs.dynatrace.com/docs/observe/infrastructure-observability/extensions/redis-20) |
| `HAPROXY` | HAProxy | none | - | - | - | no | extension | [HAProxy extension](https://docs.dynatrace.com/docs/observe/infrastructure-observability/extensions/haproxy-1), [HAProxy (Prometheus) extension](https://docs.dynatrace.com/docs/observe/infrastructure-observability/extensions/haproxy-prometheus) |
| `OTHER` | Other / unclassified | none | - | - | - | no | otel | [Technology support](https://docs.dynatrace.com/docs/ingest-from/technology-support), [OpenTelemetry](https://docs.dynatrace.com/docs/ingest-from/opentelemetry), [OTLP API endpoints](https://docs.dynatrace.com/docs/ingest-from/opentelemetry/otlp-api) |
| any other `processType` | title case of the key | deep | the key itself | `appVersion` | - | no | - | [Technology support](https://docs.dynatrace.com/docs/ingest-from/technology-support) |

**Needs-rule texts** (shown as the detail of the *No rule includes it* check):

- .NET: ".NET processes are only deep monitored automatically in containers, IIS (w3wp.exe) and ASP.NET Core;
  standalone .NET services and console apps need a Monitor rule or the process group set to Monitor."
- Go: "Go processes are only deep monitored automatically in containers (Kubernetes, Docker, Cloud Foundry) and for a
  few known binaries; other Go applications need a Monitor rule or the process group set to Monitor."
- Python: "Python is not deep monitored by default: turn on "Monitor Python" and add a Monitor rule (or set the process
  group to Monitor)."

**Alternatives** (shown for unscored technologies):

- System (`LINUX_SYSTEM`, `WINDOWS_SYSTEM`): "System process group: Dynatrace collects OS processes here without a code
  module. No action is needed."
- `IIS_SERVICE_HOST`: "These are svchost.exe / inetinfo.exe processes that host the IIS services (for example WAS and
  the IIS Admin service); they serve no requests. OneAgent instruments IIS in the w3wp.exe worker processes (built-in
  rule -4), which appear as IIS app pool process groups: check those instead. No action is needed here."
- Ruby, Erlang / Elixir: "<label>: OneAgent has no code module for it; instrument it with OpenTelemetry and send OTLP to
  Dynatrace."
- Envoy: "OneAgent support for Envoy 1.29 and earlier ended on 2026-02-28. Trace Envoy 1.30+ with its OpenTelemetry
  tracer (disable the OneAgent Envoy module first)."
- Databases and HAProxy: "OneAgent does not deep monitor database or proxy servers. Calls to them are traced from the
  deep-monitored applications; monitor the server itself with its Dynatrace extension."
- `OTHER`: "OneAgent did not classify a technology for these processes (for example browsers, CLI tools or unsupported
  runtimes), so there is no code module to inject. Instrument important ones with OpenTelemetry."

**Technology notes** (shown in the *Notes* of the upgrade and restart actions):

- Java family: SAP Introscope and OneAgent on the same JVM are not supported; Tomcat 10 and 11 need the OneAgent feature
  "Java Servlet 5.0" (then restart); supported app servers: Tomcat 6–11, WebSphere 8.5–9.0 and Liberty, JBoss EAP 7–8,
  WildFly 8–41, WebLogic 11g–15.1.1.
- .NET / IIS app pool: trimmed self-contained apps need OneAgent 1.337+ and the Dynatrace.OneAgent.Trimming NuGet
  package; single-file apps need OneAgent 1.343+ and the "Instrument .NET Single-File Self-Contained applications" and
  "Advanced .NET Instrumentation Mode" features.
- Node.js: webpack-bundled modules cannot be instrumented (externalize them); an ESM main script needs OneAgent 1.219+
  with agent preloading; tool processes (npm, yarn, pm2, corepack, node-gyp, gulp) are skipped by built-in rules on
  purpose.
- Go: statically linked binaries (CGO_ENABLED=0) are skipped by built-in rule -47 unless "Enable Go static application
  monitoring" is on and a Monitor rule covers the binary; not supported: gccgo, -linkshared, -race, -buildmode=plugin and
  vendored packages; avoid strip, -ldflags=-s and go run; -buildmode=pie with CGO_ENABLED=0: drop pie or add
  -linkmode=external; musl binaries need -linkmode=external; scratch images need a base image with a C library.
- PHP: PHP CLI scripts are skipped by built-in rule -1 (and php-cgi by -2): monitor a CLI script with a custom Monitor
  rule (PHP script or working directory), then restart; CLI monitoring does not support threading or forking; mod_php
  needs a full Apache stop and start.
- Python: only CPython started as python, python3 or python3.x; embedded interpreters and gevent below 20.9.0 are not
  supported; tool processes (pip, conda, jupyter, ansible, the aws / az / gcloud CLIs, supervisord) are skipped by
  built-in rules.
- Apache HTTP Server: apachectl restart / graceful is not enough (stop completely, then start); with SELinux:
  `setsebool -P httpd_can_network_connect on`, then restart.
- NGINX: patched builds (for example Kong): set `DT_NGINX_FORCE_RUNTIME_INSTRUMENTATION=on` and restart (10 s+ startup
  delay, more memory).

### Supported versions

`supportStatus` and the per-technology functions in [ui/app/deepTech.ts](../ui/app/deepTech.ts#L277). The ranges were
taken from the Dynatrace technology-support and end-of-support pages and vendor policies fetched on 2026-10-23 (code
comment). Versions are compared numerically segment by segment (`"1.8.0_292"` is `[1, 8, 0, 292]`; missing segments
count as 0; `"CTS 56"` is `[5, 6]`). A range like 8–8.5 matches on the leading segments only (8.0.x and 8.5.x match).

| Technology | supported (pass) | support ending (warn) | limited support (warn) | not supported | support not confirmed (info) | Minimum OneAgent |
| --- | --- | --- | --- | --- | --- | --- |
| Java family (`1.x` majors read as the second segment, so 1.8 is 8) | 6, 7, 8, 11, 17, 21, 24, 25, 27; 26 ("reached vendor end of availability in September 2026 (Temurin), so plan the move to Java 25 (LTS) or 27") | - | - | 26 on Alpine (musl libc); JRockit, Hitachi, Fujitsu and Huawei JVMs (by edition; ended 2026-09-30); 9, 10, 12–16, 18–20, 22, 23 and any other major up to 27 not listed (22 was dropped with OneAgent 1.335) | no version; majors above 27 | - |
| .NET Framework (edition contains "framework") | 3.5 (SP1), 4.6.2–4.8 | - | other 4.x (4, 4.5, 4.5.1) | 4.5.2–4.6.1 (ended 2026-07-31, last OneAgent 1.343); any other | no version | - |
| .NET / .NET Core | 8 (Microsoft support ends 2026-11-10), 9 (same), 10 (LTS; single-file apps on Linux need 10.0.9+) | Core 3.1, 5, 6, 7 (OneAgent support ends 2026-12-31, last OneAgent 1.353) | - | 1.x; 2.x and 3.0 (ended 2026-07-31, last OneAgent 1.343) | no version; any other major | 8: 1.277, 9: 1.305, 10: 1.325 |
| Node.js (major) | 22, 24, 26 | 20 (until 2027-04-30), 25 (until 2026-12-31) | 12, 14, 16, 18 | every other major up to 26 (8–11, 13, 15, 17, 19, 21, 23) | no version; above 26 | - |
| Go | 1.24–1.27 | - | - | older | no version; newer than 1.27 | - |
| PHP | 7.1–8.4; 8.5 | - | - | older | no version; newer than 8.5 | 8.5: 1.329 |
| Python | 3.8–3.13; 3.14 | - | - | free-threaded builds (version ending in a digit followed by `t`); older | no version; newer than 3.14 (3.15 is "not listed yet") | 3.14: 1.329 |
| Apache HTTP Server | 2.0, 2.2, 2.4 | - | - | other versions up to 2.4 | no version; newer than 2.4 | - |
| NGINX | 1.11.5–1.31.x (text also names NGINX Plus R11–R36, OpenResty, Tengine, Kong) | - | - | any version on Windows; older than 1.11.5 | no version; newer than 1.31 | - |
| IIS | 7.5, 8.0, 8.5, 10.0 | - | - | other versions up to 10.0 (IIS 7.0 is no longer supported) | no version; newer than 10.0 | - |
| IBM CICS (CICS TS) | 5.1–5.6, 6.1–6.3 | - | - | older | no version; newer than 6.3 | - |
| Any technology without a support function | - | - | - | - | always ("See the technology support page for supported versions.") | - |

The status text of each rule is shown as the detail of the *technology* check and as the first step of the upgrade
action. When a rule names a minimum OneAgent version and the host's OneAgent (`hostAgentVersion`) is older, the *min-agent*
check fires.

### Status column values

`processStatus` in [ui/app/deepMonitoring.ts](../ui/app/deepMonitoring.ts#L698). It runs the full `diagnose` for one
instance against the settings read for the result set and returns the **first** matching row below. Grail has no
per-process restart flag, so the status is derived, not read.

| # | Status label in the cell | Filter label | Tone | Rule (first match wins) | Hover text |
| --- | --- | --- | --- | --- | --- |
| 1 | Restart to update | Restart to update | warn (amber) | The instance is deep monitored **and** the diagnosis has the *Code module older than OneAgent* check (`installerVersion` of the instance is older than the host's OneAgent `installerVersion`). | "Code module 1.345.10 vs OneAgent 1.347.64 on the host. Code modules are updated when the process restarts." |
| 2 | Deep monitored | Deep monitored | good (green) | The instance is deep monitored. | The evidence list, or "Code module present." |
| 3 | Dynatrace component | Dynatrace component | neutral | Not deep monitored and the technology is `APMNG`. | "Not scored." |
| 4 | No code module, or Not instrumented by design | No code module for the technology | neutral | Not deep monitored and the technology has no code module (kind `none`). *Not instrumented by design* for the system kinds (Linux system, Windows system, IIS service hosts). | The technology's alternative text. |
| 5 | Blocked: <title of the first failing check> | Blocked by a setting | bad (red) | Any diagnosis check other than *injected* has status `fail`. This includes non-setting blockers: unsupported runtime version, OneAgent too old, host not in Full-Stack mode, excluded Kubernetes namespace. | Titles of all failing checks, joined with "; ". |
| 6 | Not monitored on purpose | Not monitored on purpose | neutral | The deciding setting is a built-in *Do not monitor* rule (a `decide-builtin:*` check with status `info`). | "Not monitored on purpose (built-in rule -27)". |
| 7 | Roll out pod | Roll out pod | warn | A Kubernetes check exists (only the `warn` variant reaches here: every deciding setting allows injection, the namespace is not excluded). | "Settings allow injection; the Dynatrace Operator injects when the pod is created." |
| 8 | Restart required | Restart required | warn | The *Restart likely required* check exists: nothing in the settings blocks injection. | "Nothing in the settings blocks injection. Code modules are loaded at process start, so processes started before OneAgent was installed (or before a setting changed) need a restart. This is inferred, not reported by OneAgent: confirm it on the process page first." |
| 9 | Check: <title of the first `warn` check, or "see Diagnose"> | Check | warn | Anything else, for example *Go static monitoring off* or *CICS module* with no failing check. | The warn check's detail, or "Use Diagnose for details." |

Example titles in *Blocked*: "Blocked: Process group set to "Do not monitor"", "Blocked: Excluded by a custom monitoring
rule", "Blocked: No rule includes it", "Blocked: Automatic deep monitoring off", "Blocked: Host not in Full-Stack mode",
"Blocked: "Monitor Python" off", "Blocked: Java 9: not supported".

### Which setting decides injection (evaluation order)

`decide` in [ui/app/deepMonitoring.ts](../ui/app/deepMonitoring.ts#L438), per instance without a code module, following
the [Process deep monitoring](https://docs.dynatrace.com/docs/observe/infrastructure-observability/process-groups/configuration/pg-monitoring)
docs. The **first** step that applies decides; the later steps are not considered for that instance.

| Step | Setting | Applies when | Outcome | Check status | Check title | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Host-level process group monitoring (`builtin:host.process-groups.monitoring-state`) | An object exists with scope = the instance's host and `ProcessGroup` = its process group | `MONITORING_OFF` | fail | Disabled for this process group on the host | `host-pg-on` |
| | | | `MONITORING_ON` | pass | Set to Monitor on the host | - |
| 2 | Process group monitoring (`builtin:process-group.monitoring.state`), scope = process group | `MonitoringState` is not `DEFAULT` (no object = `DEFAULT`) | `MONITORING_OFF` | fail | Process group set to "Do not monitor" | `pg-on` |
| | | | `MONITORING_ON` | pass | Process group set to Monitor ("rules and the automatic setting do not apply") | - |
| 3 | Custom process monitoring rules (`builtin:process.custom-process-monitoring-rule`) | Enabled rules of the instance's host group first, then environment rules, each in list order; first rule whose condition **matches** | mode `MONITORING_OFF` | fail | Excluded by a custom monitoring rule (detail = the rule text) | `disable-rules` |
| | | | mode `MONITORING_ON` | pass | Included by a custom monitoring rule | - |
| 4 | Built-in process monitoring rules (the 82 rules below; switches in `builtin:process.built-in-process-monitoring-rule`) | Rules in their documented order, skipping rules switched off (switch object of the host group, else of the environment; a missing key = on); first rule whose condition matches | `OFF` | **info** | Not monitored on purpose (built-in rule N). Detail: "<rule text>. Built-in exclusions cover tooling and helper processes; to monitor it anyway, set the process group to Monitor or add a custom Monitor rule." | `pg-on` (optional) |
| | | | `ON` | pass | Included by built-in rule N | - |
| 5 | Technology needs a rule (Go, standalone .NET, Python) | Nothing above matched | - | fail | No rule includes it (detail = needs-rule text) | `monitor-rule` |
| 6 | Automatic deep monitoring (`builtin:process.process-monitoring`, `autoMonitoring`) | Object of the host group, else of the environment, else default **on** | off | fail | Automatic deep monitoring off ("Off for the <origin>: only process groups set to Monitor or matching a Monitor rule are deep monitored.") | `auto-monitoring` |
| | | | on | pass | Automatic deep monitoring on ("No setting excludes it, and new processes are deep monitored automatically (<origin>).") | - |

`<origin>` is "host group <name>", "environment" or "environment (default)". The Monitored technologies switches, the
host monitoring mode and container injection apply on top of this decision and are separate checks.

**Rule text** (`conditionText` / `ruleText`): "Monitor if" / "Do not monitor if", the item lower-cased with spaces
(`JAVA_JAR_FILE` reads "java jar file"; an environment-variable condition reads "environment variable <NAME>"), the
operator ("begins with", "does not begin with", "ends with", "does not end with", "contains", "does not contain",
"equals", "does not equal", "exists", "does not exist") and the quoted value (no value for the *exists* operators), plus
" (HOST_GROUP-…)" for a rule that is not at environment scope. Example: `Do not monitor if java jar file equals
"batch.jar" (HOST_GROUP-0000000000000001)`.

### How a rule condition is evaluated

`evaluateCondition` in [ui/app/deepMonitoring.ts](../ui/app/deepMonitoring.ts#L368) evaluates custom, built-in and
container rule conditions against the process metadata (`metadata`, an array of `KEY:value` strings):

1. Keys are normalized: underscores removed, upper case, so `NODEJS_APP_NAME` and `NODE_JS_APP_NAME` are the same key.
   Four rule items are named differently from the metadata key: `IMAGE_NAME` reads `CONTAINER_IMAGE_NAME`,
   `NODEJS_APP_BASE_DIR` reads `NODEJS_APP_BASE_DIRECTORY`, `PHP_CLI_SCRIPT_PATH` reads `PHP_SCRIPT_PATH`,
   `PHP_CLI_WORKING_DIR` reads `PHP_WORKING_DIRECTORY`. The instance's host group name is added as `HOST_GROUP`.
2. Items OneAgent evaluates but never reports in the metadata, `UNKNOWN` (environment-variable conditions) and
   `GO_BINARY_LINKAGE`, give **unknown**. Such a rule never decides; Do-not-monitor rules of this kind are listed in the
   *could not be checked* info check. Built-in rule -47 (Go static linkage) therefore never matches.
3. `EXISTS` / `NOT_EXISTS`: whether the key is present.
4. Any other operator on a missing key gives **no match** (for example a JAR-file rule on a Node.js process).
5. `STARTS`, `NOT_STARTS`, `ENDS`, `NOT_ENDS`, `CONTAINS`, `NOT_CONTAINS`, `EQUALS`, `NOT_EQUALS`: case-sensitive string
   comparison. An unrecognized operator gives **unknown**.

### Diagnosis checks, in evaluation order

`diagnose` in [ui/app/deepMonitoring.ts](../ui/app/deepMonitoring.ts#L501). *Relevant instances* = the instances
without a code module, but only when the technology has a code module (kind `deep`); for other technologies there are
none and checks 4–15 are skipped. For a process group, outcome checks append "(n of M instances without a code module)"
to their detail. The list is displayed sorted Blocking / Check / OK / Info, keeping this order within a status.

| # | Check id | When it is added | Status | Title | Fix id |
| --- | --- | --- | --- | --- | --- |
| 1 | `injected` | Always | pass when every instance has a code module ("Deep monitored", detail lists the evidence of the first instance); otherwise "No code module injected", **info** if the technology has no code module or every deciding setting is a built-in *Do not monitor* rule, else **fail**. If it is still fail after all checks and no other check fails, it becomes **info** "No code module yet" with "It is loaded when the process restarts." (or "when the pod is re-created." on Kubernetes). | see left | - |
| 2 | `technology` | Always | kind `none`: info for system kinds, else warn ("<label>: no OneAgent code module"); kind `dynatrace`: info ("Dynatrace component"); kind `deep`: supported = pass, support ending / limited = warn, not supported = fail if any instance lacks a code module else warn, not confirmed = info. Title: "<label> <version> (<edition>): supported / support ending / limited support / not supported / support not confirmed". | see left | `alternative` (kind none, not system); `upgrade` (ending, limited, not supported) |
| 3 | `min-agent` | Kind `deep`, the support rule names a minimum OneAgent, and the target host's OneAgent is older | fail if any instance lacks a code module, else warn | OneAgent 1.270.0 is too old for this version ("<label> <version> needs OneAgent <min> or later on the host.") | `update-agent` |
| 4 | `mode` | At least one relevant instance reports a host monitoring mode | fail if any relevant instance's host is not `FULL_STACK` ("N hosts run OneAgent in Infrastructure / Discovery mode; code modules are only injected in Full-Stack mode (Infrastructure mode injects Java backing services only)."), else pass ("Host in Full-Stack mode") | Host not in Full-Stack mode / Host in Full-Stack mode | `full-stack` |
| 5 | `switch` | Relevant instances exist and the technology has a Monitored technologies switch | pass if the effective value (target host object, else environment object, else schema default) is not `false`, else fail (detail adds "; off by default" when it comes from the default) | "Monitor Java" on / off | `monitored-tech` |
| 6 | `dotnet-core` | Relevant instances, .NET switch technology (.NET, IIS app pool), and the target's edition does not contain "framework"; added only when off | fail | "Enable .NET Core" off (".NET Core / .NET 5+ processes are not instrumented") | `dotnet-core` |
| 7 | `decide-<key>` | One per distinct outcome of the [decision](#which-setting-decides-injection-evaluation-order) across the relevant instances | as in the decision table | as in the decision table | as in the decision table |
| 8 | `rules-shadowed` | An instance is decided by a process-group or host-level *Do not monitor* setting, and enabled custom *Do not monitor* rules (environment, or a relevant instance's host group) also match a relevant instance | warn | Also excluded by N custom rule(s) ("Set the process group to Monitor (which wins over rules) rather than back to Default, or disable the rule.") | `disable-rules` |
| 9 | `rules-unknown` | Enabled custom *Do not monitor* rules in scope, not already counted, that evaluate to unknown for a relevant instance | info | N custom rule(s) could not be checked ("The property is not in the reported process metadata (for example an environment variable); check it on the host.") | - |
| 10 | `go-static` | Relevant instances, target is Go, and "Enable Go static application monitoring" is off for the target | warn | Go static monitoring off ("If the binary is statically linked (CGO_ENABLED=0, …), built-in rule -47 skips it until "Enable Go static application monitoring" is on (<origin>) and a Monitor rule covers it.") | `go-static` |
| 11 | `container` | Relevant instances and the target runs in a detected container runtime | pass if injection for that runtime is on (host object, else host group object, else environment object, else default), else fail | Injection into <runtime> containers on / off | `container-tech` |
| 12 | `container-rules` | As 11, and enabled container *Do not monitor* rules match a relevant instance | fail | Excluded by N container monitoring rule(s) (detail = rule texts) | `disable-container-rules` |
| 13 | `k8s` | Relevant instances on Kubernetes (metadata `KUBERNETES_NAMESPACE` or a `KUBERNETES` software technology) | fail if a namespace matches `kube-*`, `openshift-*` or `dynatrace` ("Namespace not injected by default"); otherwise warn **only if every deciding setting allows injection** ("Kubernetes workload": check the DynaKube mode, namespace selector and inject annotations, then roll out), marked *confirm first* | see left | `kubernetes` |
| 14 | `cics` | Relevant instances and the technology is IBM CICS | warn | CICS module ("CICS regions are instrumented by the Dynatrace CICS module (PLT program ZDTPLT) through the zDC and zRemote, not by OneAgent auto-injection. Check the module installation.") | `restart` |
| 15 | `restart` | Relevant instances and nothing blocks: no check other than `injected` is fail or warn (checks whose fix is `upgrade` are ignored), and the instances are not all excluded by built-in rules | warn, marked *confirm first* | Restart likely required | `restart` |
| 16 | `stale` | Every instance has a code module and the target's `installerVersion` is older than its host's OneAgent version | warn, marked *confirm first* | Code module older than OneAgent | `restart` |

Container runtime detection: a `softwareTechnologies` entry of type `CONTAINERD`, `CRIO`, `DOCKER`, `PODMAN` or `GARDEN`
(Docker on a Windows host counts as *Docker for Windows Server*). The container injection defaults (no object at any
scope) are: BOSH Process Manager on, containerd on, CRI-O on, Docker on, Docker for Windows Server **off**, Garden on,
Podman **off**, Winc **off**.

Monitored technologies defaults (schema defaults used when no object exists): Monitor Java, Go, Node.js, PHP, .NET, IIS,
Apache, Nginx **on**; Monitor Python **off**; Enable Go static application monitoring **off**; Enable .NET Core **on**.

### Built-in process monitoring rules

`BUILTIN_RULES` in [ui/app/deepTech.ts](../ui/app/deepTech.ts#L566), generated from the tenant's
`builtin:process.built-in-process-monitoring-rule` schema: 82 rules, all on by default, in evaluation order (ids -15,
-30, -31 and -42 do not exist). Each can be switched off in the schema (property `"-<id>": false`) per host group or
for the environment; the app honours those switches.

| Rule | Mode | Condition |
| --- | --- | --- |
| -1 | Do not monitor | `PHP_SCRIPT_PATH` EXISTS |
| -2 | Do not monitor | `EXE_NAME` EQUALS `php-cgi` |
| -3 | Monitor | `ASP_NET_CORE_APPLICATION_PATH` EXISTS |
| -4 | Monitor | `EXE_NAME` EQUALS `w3wp.exe` |
| -5 | Monitor | `EXE_NAME` EQUALS `caddy` |
| -6 | Monitor | `EXE_NAME` EQUALS `influxd` |
| -7 | Monitor | `EXE_NAME` EQUALS `adapter` |
| -8 | Monitor | `EXE_NAME` EQUALS `auctioneer` |
| -9 | Monitor | `EXE_NAME` EQUALS `bbs` |
| -10 | Monitor | `EXE_NAME` EQUALS `cc-uploader` |
| -11 | Monitor | `EXE_NAME` EQUALS `doppler` |
| -12 | Monitor | `EXE_NAME` EQUALS `gorouter` |
| -13 | Monitor | `EXE_NAME` EQUALS `locket` |
| -14 | Monitor | `EXE_NAME` EQUALS `metron` |
| -16 | Monitor | `EXE_NAME` EQUALS `rep` |
| -17 | Monitor | `EXE_NAME` EQUALS `route-emitter` |
| -18 | Monitor | `EXE_NAME` EQUALS `route-registrar` |
| -19 | Monitor | `EXE_NAME` EQUALS `routing-api` |
| -20 | Monitor | `EXE_NAME` EQUALS `scheduler` |
| -21 | Monitor | `EXE_NAME` EQUALS `silk-daemon` |
| -22 | Monitor | `EXE_NAME` EQUALS `switchboard` |
| -23 | Monitor | `EXE_NAME` EQUALS `syslog_drain_binder` |
| -24 | Monitor | `EXE_NAME` EQUALS `tps-watcher` |
| -25 | Monitor | `EXE_NAME` EQUALS `trafficcontroller` |
| -26 | Do not monitor | `NODE_JS_APP_BASE_DIRECTORY` ENDS `/node_modules/prebuild-install` |
| -27 | Do not monitor | `NODE_JS_APP_BASE_DIRECTORY` ENDS `/node_modules/npm` |
| -28 | Do not monitor | `NODE_JS_APP_BASE_DIRECTORY` ENDS `/node_modules/grunt` |
| -29 | Do not monitor | `NODE_JS_APP_BASE_DIRECTORY` ENDS `/node_modules/typescript` |
| -32 | Do not monitor | `NODE_JS_APP_BASE_DIRECTORY` ENDS `/node_modules/node-pre-gyp` |
| -33 | Do not monitor | `NODE_JS_APP_BASE_DIRECTORY` ENDS `/node_modules/node-gyp` |
| -34 | Do not monitor | `NODE_JS_APP_BASE_DIRECTORY` ENDS `/node_modules/gulp-cli` |
| -35 | Do not monitor | `NODE_JS_SCRIPT_NAME` EQUALS `bin/pm2` |
| -36 | Do not monitor | `CLOUD_FOUNDRY_APP_NAME` STARTS `apps-manager-js` |
| -37 | Monitor | `CLOUD_FOUNDRY_APP_NAME` EXISTS |
| -38 | Do not monitor | `KUBERNETES_CONTAINER_NAME` EQUALS `POD` |
| -39 | Do not monitor | `CONTAINER_IMAGE_NAME` CONTAINS `pause-amd64` |
| -40 | Monitor | `KUBERNETES_NAMESPACE` EXISTS |
| -41 | Monitor | `CONTAINER_NAME` EXISTS |
| -43 | Do not monitor | `EXE_PATH` STARTS `/tmp/buildpacks/` |
| -44 | Do not monitor | `EXE_NAME` EQUALS `oc` |
| -45 | Do not monitor | `NODE_JS_APP_NAME` EQUALS `yarn` |
| -46 | Do not monitor | `EXE_PATH` EQUALS `/opt/cni/bin/host-local` |
| -47 | Do not monitor | `GO_BINARY_LINKAGE` EQUALS `static` (cannot be evaluated: linkage is not reported) |
| -48 | Do not monitor | `EXE_NAME` STARTS `mqsi` |
| -49 | Do not monitor | `EXE_NAME` EQUALS `filebeat` |
| -50 | Do not monitor | `EXE_NAME` EQUALS `metricbeat` |
| -51 | Do not monitor | `EXE_NAME` EQUALS `packetbeat` |
| -52 | Do not monitor | `EXE_NAME` EQUALS `auditbeat` |
| -53 | Do not monitor | `EXE_NAME` EQUALS `heartbeat` |
| -54 | Do not monitor | `EXE_NAME` EQUALS `functionbeat` |
| -55 | Do not monitor | `EXE_NAME` EQUALS `grootfs` |
| -56 | Do not monitor | `EXE_NAME` EQUALS `tardis` |
| -57 | Do not monitor | `JAVA_JAR_FILE` STARTS `org.eclipse.equinox.launcher` |
| -58 | Do not monitor | `EXE_NAME` EQUALS `calico-node` |
| -59 | Do not monitor | `EXE_NAME` EQUALS `casclient.exe` |
| -60 | Do not monitor | `JAVA_JAR_FILE` EQUALS `dynatrace_ibm_mq_connector.jar` |
| -61 | Do not monitor | `EXE_NAME` CONTAINS `Agent.Worker` |
| -62 | Do not monitor | `DOTNET_COMMAND` CONTAINS `Agent.Worker` |
| -63 | Do not monitor | `EXE_NAME` CONTAINS `Agent.Listener` |
| -64 | Do not monitor | `DOTNET_COMMAND` CONTAINS `Agent.Listener` |
| -65 | Do not monitor | `EXE_NAME` EQUALS `FlexNetJobExecutorService` |
| -66 | Do not monitor | `EXE_NAME` EQUALS `FlexNetMaintenanceRemotingService` |
| -67 | Do not monitor | `EXE_PATH` EQUALS `/usr/bin/piper` |
| -68 | Do not monitor | `NODE_JS_APP_NAME` EQUALS `corepack` |
| -69 | Do not monitor | `KUBERNETES_CONTAINER_NAME` EQUALS `cassandra-operator` |
| -70 | Do not monitor | `EXE_NAME` CONTAINS `UiPath` |
| -71 | Do not monitor | `EXE_NAME` EQUALS `openhandlecollector.exe` |
| -72 | Do not monitor | `EXE_NAME` EQUALS `yq` |
| -73 | Do not monitor | `PYTHON_SCRIPT` EQUALS `pip` |
| -74 | Do not monitor | `PYTHON_SCRIPT` EQUALS `hatch` |
| -75 | Do not monitor | `PYTHON_SCRIPT` EQUALS `wheel` |
| -76 | Do not monitor | `PYTHON_SCRIPT` EQUALS `yum` |
| -77 | Do not monitor | `PYTHON_SCRIPT` EQUALS `jupyter` |
| -78 | Do not monitor | `PYTHON_SCRIPT` EQUALS `conda` |
| -79 | Do not monitor | `PYTHON_SCRIPT` EQUALS `ansible` |
| -80 | Do not monitor | `PYTHON_SCRIPT` EQUALS `openstack` |
| -81 | Do not monitor | `PYTHON_SCRIPT` EQUALS `aws` |
| -82 | Do not monitor | `PYTHON_SCRIPT` EQUALS `az` |
| -83 | Do not monitor | `PYTHON_SCRIPT` EQUALS `gcloud` |
| -84 | Do not monitor | `COMMAND_LINE_ARGS` CONTAINS `forever/bin/monitor` |
| -85 | Do not monitor | `JAVA_MAIN_CLASS` CONTAINS `ActiveGateCommandLineTool` |
| -86 | Do not monitor | `PYTHON_SCRIPT` CONTAINS `supervisord` |

## Queries

All five queries are built in [ui/app/queries.ts](../ui/app/queries.ts#L770) and run in the browser through `useDql`
([ui/app/useDql.ts](../ui/app/useDql.ts)), which re-runs a query whenever its text changes. Every query reads the
classic process group instance table and shares the same building blocks (`pgiBase`, lookups, `DEEP_FLAG`).

| # | Name (function) | Runs when | Feeds |
| --- | --- | --- | --- |
| 1 | `deepCoverageQuery(tf)` | On tab load; re-runs on timeframe change | Gauges, not-scored line, Technology dropdown, AI Assist |
| 2 | `deepProcessSearchQuery(tf, filters)` | On *Search processes* | Processes view (and its Status column) |
| 3 | `deepGroupSearchQuery(tf, filters)` | On *Search process groups* | Process groups view |
| 4 | `deepDetailQuery(tf, target)` | On *Diagnose*; re-runs on timeframe change while selected | Diagnosis, checks and actions |
| 5 | `iisWorkersQuery(tf, hostIds)` | During a diagnosis whose target is an IIS service host | IIS worker processes panel |

### 1. Deep monitoring by technology (`deepCoverageQuery`)

- **Source:** `deepCoverageQuery` in [ui/app/queries.ts](../ui/app/queries.ts#L812).
- **Runs:** when the tab opens, and again when the timeframe changes.
- **Parameters:** the timeframe only. `from:now()-24h` becomes `from:now()-7d` / `from:now()-30d` in every `fetch`; the
  `metric.series` lookup uses `-24h`, `-7d` and **`-10d`** for 30 days (`metric.series` only accepts the last 10 days).
- **Query (24 hours):**

```dql
fetch dt.entity.process_group_instance, from:now()-24h
| fieldsAdd pg = instance_of[dt.entity.process_group], host = belongs_to[dt.entity.host], technology = if(processType == "IIS" and (in("EXE_NAME:svchost.exe", metadata) or in("EXE_NAME:inetinfo.exe", metadata)), "IIS_SERVICE_HOST", else: coalesce(processType, "OTHER"))
| lookup [fetch dt.entity.host, from:now()-24h | fields id, monitoringMode], sourceField:host, lookupField:id, fields:{monitoringMode}
| lookup [fetch dt.entity.service, from:now()-24h | filter isNotNull(agentTechnologyType) and agentTechnologyType != "N/A" | fields agent = agentTechnologyType, pgi = runs_on[dt.entity.process_group_instance] | expand pgi | summarize codeServices = count(), serviceAgents = collectDistinct(agent), by:{pgi}], sourceField:id, lookupField:pgi, fields:{codeServices, serviceAgents}
| lookup [fetch metric.series, from:now()-24h | filter startsWith(metric.key, "dt.runtime.") and isNotNull(dt.entity.process_group_instance) | summarize runtimeMetrics = collectDistinct(metric.key, maxLength:3), by:{dt.entity.process_group_instance}], sourceField:id, lookupField:dt.entity.process_group_instance, fields:{runtimeMetrics}
| fieldsAdd isDeep = isNotNull(installerVersion) or coalesce(codeServices, 0) > 0 or (isNotNull(runtimeMetrics) and not in(coalesce(monitoringMode, ""), array("INFRASTRUCTURE", "DISCOVERY")))
| summarize total = count(), deep = countIf(isDeep), by:{technology}
| sort total desc
```

The 30-day version differs only in the timeframes:

```dql
fetch dt.entity.process_group_instance, from:now()-30d
...
| lookup [fetch dt.entity.host, from:now()-30d | ...
| lookup [fetch dt.entity.service, from:now()-30d | ...
| lookup [fetch metric.series, from:now()-10d | filter startsWith(metric.key, "dt.runtime.") ...
```

- **How it works:**
  1. `fetch dt.entity.process_group_instance, from:now()-24h`: every classic process group instance (one record per
     process instance) seen in the window.
  2. `fieldsAdd pg = instance_of[dt.entity.process_group]`: the process group ID from the instance's `instance_of`
     relationship. `host = belongs_to[dt.entity.host]`: the host ID. `technology = if(...)`: `IIS_SERVICE_HOST` when
     `processType` is `IIS` and the `metadata` array contains the string `EXE_NAME:svchost.exe` or
     `EXE_NAME:inetinfo.exe` (`in(value, array)` tests membership); otherwise `processType`, or `OTHER` when it is null.
  3. First `lookup`: joins each instance to its host (`sourceField:host` to the host's `id`) and adds the host's
     `monitoringMode` (`FULL_STACK`, `INFRASTRUCTURE`, `DISCOVERY`).
  4. Second `lookup`: a subquery over `dt.entity.service` keeps the services a code module detected
     (`agentTechnologyType` set and not `N/A`), takes the process group instances each runs on
     (`runs_on[dt.entity.process_group_instance]`, an array), `expand`s that array to one record per instance, and
     `summarize`s per instance the number of such services (`codeServices`) and the distinct agent types
     (`serviceAgents`). The lookup adds both to the instance with the same `id`.
  5. Third `lookup`: a subquery over `metric.series` (one record per metric series in the window) keeps the series whose
     key starts with `dt.runtime.` and that carry a `dt.entity.process_group_instance` dimension, and collects up to 3
     distinct metric keys per instance (`collectDistinct(..., maxLength:3)`) as `runtimeMetrics`.
  6. `fieldsAdd isDeep = …`: the [deep-monitored rule](#how-the-app-decides-that-a-process-is-deep-monitored).
  7. `summarize total = count(), deep = countIf(isDeep), by:{technology}`: instances and deep-monitored instances per
     technology.
  8. `sort total desc`: largest technology first.
- **Output:** `technology`, `total`, `deep`. `useTechRows` maps `technology` through the catalogue and splits scored /
  not scored (see [Deep monitoring by technology](#deep-monitoring-by-technology-gauges)); the union of both lists,
  sorted by label, fills the *Technology* dropdown of the search; the scored rows and the not-scored list feed AI Assist.
- **Limits and cost:** no row limit (one row per technology). The whole process group instance table of the window is
  scanned, plus all services and all `dt.runtime.*` metric series of the window. The runtime-metric window is capped at
  10 days.
- **Open it yourself:** Show DQL / Copy / Open in Notebook / Add to Dashboard under the gauges ("Deep monitoring by
  technology").

### 2. Process search (`deepProcessSearchQuery`)

- **Source:** `deepProcessSearchQuery` in [ui/app/queries.ts](../ui/app/queries.ts#L833), with `instanceFilters`,
  `groupFilter`, the lookups and `INSTANCE_FIELDS`.
- **Runs:** when you click **Search processes**. The query text is fixed at that moment: a later timeframe change does
  not re-run it (search again).
- **Parameters:**

| Input | Change to the text |
| --- | --- |
| Timeframe | `from:now()-24h` in every `fetch` and in `smartscapeNodes`; `metric.series` uses `-10d` for 30 days. |
| Process name contains `java` | Adds after the first `fieldsAdd`: `\| filter contains(entity.name, "java", caseSensitive:false)` |
| Technology `JAVA` | Same filter line, or joined to it: `\| filter contains(entity.name, "java", caseSensitive:false) and technology == "JAVA"` |
| Process group contains `checkout` | Adds after the process group lookup: `\| filter contains(pgName, "checkout", caseSensitive:false)` |
| Deep monitoring: Not deep monitored (default) | `\| filter not isDeep` after the flag |
| Deep monitoring: Deep monitored | `\| filter isDeep` |
| Deep monitoring: Any state | no filter line |

Text values are escaped with `dqlString`: `"` becomes `\"` and `\` becomes `\\`.

- **Query (24 hours, default filters: Not deep monitored, no text, any technology):**

```dql
fetch dt.entity.process_group_instance, from:now()-24h
| fieldsAdd pg = instance_of[dt.entity.process_group], host = belongs_to[dt.entity.host], technology = if(processType == "IIS" and (in("EXE_NAME:svchost.exe", metadata) or in("EXE_NAME:inetinfo.exe", metadata)), "IIS_SERVICE_HOST", else: coalesce(processType, "OTHER"))
| lookup [fetch dt.entity.process_group, from:now()-24h | fields id, pgName = entity.name], sourceField:pg, lookupField:id, fields:{pgName}
| lookup [fetch dt.entity.host, from:now()-24h | fields id, hostName = entity.name, hostGroup = hostGroupName, hostGroupId = instance_of[dt.entity.host_group], monitoringMode, hostAgentVersion = installerVersion, osType], sourceField:host, lookupField:id, fields:{hostName, hostGroup, hostGroupId, monitoringMode, hostAgentVersion, osType}
| lookup [fetch dt.entity.service, from:now()-24h | filter isNotNull(agentTechnologyType) and agentTechnologyType != "N/A" | fields agent = agentTechnologyType, pgi = runs_on[dt.entity.process_group_instance] | expand pgi | summarize codeServices = count(), serviceAgents = collectDistinct(agent), by:{pgi}], sourceField:id, lookupField:pgi, fields:{codeServices, serviceAgents}
| lookup [fetch metric.series, from:now()-24h | filter startsWith(metric.key, "dt.runtime.") and isNotNull(dt.entity.process_group_instance) | summarize runtimeMetrics = collectDistinct(metric.key, maxLength:3), by:{dt.entity.process_group_instance}], sourceField:id, lookupField:dt.entity.process_group_instance, fields:{runtimeMetrics}
| fieldsAdd isDeep = isNotNull(installerVersion) or coalesce(codeServices, 0) > 0 or (isNotNull(runtimeMetrics) and not in(coalesce(monitoringMode, ""), array("INFRASTRUCTURE", "DISCOVERY")))
| filter not isDeep
| lookup [smartscapeNodes "PROCESS", from:now()-24h | fields sid = toString(id), id_classic], sourceField:id, lookupField:id_classic, fields:{sid}
| fields id, sid, name = entity.name, pg, pgName, host, hostName, hostGroup, hostGroupId, monitoringMode, hostAgentVersion, osType, processType, technology, softwareTechnologies, jvmClrVersion, jvmVendor, appVersion, installerVersion, codeServices, serviceAgents, runtimeMetrics, isDeep, isDockerized, metadata
| sort name asc
| limit 150
```

With every filter set (name `java`, group `checkout`, technology Java, Not deep monitored):

```dql
fetch dt.entity.process_group_instance, from:now()-24h
| fieldsAdd pg = instance_of[dt.entity.process_group], host = belongs_to[dt.entity.host], technology = if(processType == "IIS" and (in("EXE_NAME:svchost.exe", metadata) or in("EXE_NAME:inetinfo.exe", metadata)), "IIS_SERVICE_HOST", else: coalesce(processType, "OTHER"))
| filter contains(entity.name, "java", caseSensitive:false) and technology == "JAVA"
| lookup [fetch dt.entity.process_group, from:now()-24h | fields id, pgName = entity.name], sourceField:pg, lookupField:id, fields:{pgName}
| filter contains(pgName, "checkout", caseSensitive:false)
| lookup [fetch dt.entity.host, from:now()-24h | fields id, hostName = entity.name, hostGroup = hostGroupName, hostGroupId = instance_of[dt.entity.host_group], monitoringMode, hostAgentVersion = installerVersion, osType], sourceField:host, lookupField:id, fields:{hostName, hostGroup, hostGroupId, monitoringMode, hostAgentVersion, osType}
| lookup [fetch dt.entity.service, from:now()-24h | filter isNotNull(agentTechnologyType) and agentTechnologyType != "N/A" | fields agent = agentTechnologyType, pgi = runs_on[dt.entity.process_group_instance] | expand pgi | summarize codeServices = count(), serviceAgents = collectDistinct(agent), by:{pgi}], sourceField:id, lookupField:pgi, fields:{codeServices, serviceAgents}
| lookup [fetch metric.series, from:now()-24h | filter startsWith(metric.key, "dt.runtime.") and isNotNull(dt.entity.process_group_instance) | summarize runtimeMetrics = collectDistinct(metric.key, maxLength:3), by:{dt.entity.process_group_instance}], sourceField:id, lookupField:dt.entity.process_group_instance, fields:{runtimeMetrics}
| fieldsAdd isDeep = isNotNull(installerVersion) or coalesce(codeServices, 0) > 0 or (isNotNull(runtimeMetrics) and not in(coalesce(monitoringMode, ""), array("INFRASTRUCTURE", "DISCOVERY")))
| filter not isDeep
| lookup [smartscapeNodes "PROCESS", from:now()-24h | fields sid = toString(id), id_classic], sourceField:id, lookupField:id_classic, fields:{sid}
| fields id, sid, name = entity.name, pg, pgName, host, hostName, hostGroup, hostGroupId, monitoringMode, hostAgentVersion, osType, processType, technology, softwareTechnologies, jvmClrVersion, jvmVendor, appVersion, installerVersion, codeServices, serviceAgents, runtimeMetrics, isDeep, isDockerized, metadata
| sort name asc
| limit 150
```

- **How it works** (steps shared with Query 1 are not repeated):
  1. The instance-level filters (name, technology) run right after `fieldsAdd`, before any lookup, so the lookups only
     process matching instances.
  2. `lookup [fetch dt.entity.process_group … | fields id, pgName = entity.name]`: adds the process group name. The
     process-group-name filter runs after it.
  3. Host lookup: adds `hostName` (`entity.name`), `hostGroup` (`hostGroupName`), `hostGroupId`
     (`instance_of[dt.entity.host_group]`), `monitoringMode`, `hostAgentVersion` (the host's `installerVersion`, i.e.
     the OneAgent version on the host) and `osType`. These feed the diagnosis (scopes for the settings read, Full-Stack
     check, minimum OneAgent version, restart commands per OS).
  4. Service and runtime-metric lookups and the `isDeep` flag as in Query 1; then the deep-monitoring state filter.
  5. `lookup [smartscapeNodes "PROCESS" … | fields sid = toString(id), id_classic]`: the Smartscape process node whose
     `id_classic` is this instance's classic ID; `sid` is its Smartscape ID as a string, used for the *Process* link.
  6. `fields …` (`INSTANCE_FIELDS`): every field the diagnosis needs, so each row can get a Status without another query.
     `name = entity.name` renames the instance name.
  7. `sort name asc` and `limit 150` (`DEEP_SEARCH_LIMIT`).
- **Output:** one record per instance with `id`, `sid`, `name`, `pg`, `pgName`, `host`, `hostName`, `hostGroup`,
  `hostGroupId`, `monitoringMode`, `hostAgentVersion`, `osType`, `processType`, `technology`, `softwareTechnologies`,
  `jvmClrVersion`, `jvmVendor`, `appVersion`, `installerVersion`, `codeServices`, `serviceAgents`, `runtimeMetrics`,
  `isDeep`, `isDockerized` (fetched, not used), `metadata`. Each record is converted with `toInstance` (see
  [Client-side post-processing](#client-side-post-processing)) and feeds the table columns, the settings read and the
  Status.
- **Limits and cost:** at most 150 rows. The status filter in the table only filters these rows.
- **Open it yourself:** query actions under the table ("Deep monitoring: process search").

### 3. Process group search (`deepGroupSearchQuery`)

- **Source:** `deepGroupSearchQuery` in [ui/app/queries.ts](../ui/app/queries.ts#L845).
- **Runs:** when you click **Search process groups**; not re-run on a timeframe change.
- **Parameters:** as Query 2 for the timeframe, name, process group and technology. The deep-monitoring state is a group
  filter after `summarize`:

| Deep monitoring | Line after `summarize` |
| --- | --- |
| Not deep monitored (default) | `\| filter deep == 0` |
| Deep monitored | `\| filter deep == instances` |
| Partially deep monitored | `\| filter deep > 0 and deep < instances` |
| Any state | none |

- **Query (24 hours, default filters):**

```dql
fetch dt.entity.process_group_instance, from:now()-24h
| fieldsAdd pg = instance_of[dt.entity.process_group], host = belongs_to[dt.entity.host], technology = if(processType == "IIS" and (in("EXE_NAME:svchost.exe", metadata) or in("EXE_NAME:inetinfo.exe", metadata)), "IIS_SERVICE_HOST", else: coalesce(processType, "OTHER"))
| lookup [fetch dt.entity.process_group, from:now()-24h | fields id, pgName = entity.name], sourceField:pg, lookupField:id, fields:{pgName}
| lookup [fetch dt.entity.host, from:now()-24h | fields id, monitoringMode], sourceField:host, lookupField:id, fields:{monitoringMode}
| lookup [fetch dt.entity.service, from:now()-24h | filter isNotNull(agentTechnologyType) and agentTechnologyType != "N/A" | fields agent = agentTechnologyType, pgi = runs_on[dt.entity.process_group_instance] | expand pgi | summarize codeServices = count(), serviceAgents = collectDistinct(agent), by:{pgi}], sourceField:id, lookupField:pgi, fields:{codeServices, serviceAgents}
| lookup [fetch metric.series, from:now()-24h | filter startsWith(metric.key, "dt.runtime.") and isNotNull(dt.entity.process_group_instance) | summarize runtimeMetrics = collectDistinct(metric.key, maxLength:3), by:{dt.entity.process_group_instance}], sourceField:id, lookupField:dt.entity.process_group_instance, fields:{runtimeMetrics}
| fieldsAdd isDeep = isNotNull(installerVersion) or coalesce(codeServices, 0) > 0 or (isNotNull(runtimeMetrics) and not in(coalesce(monitoringMode, ""), array("INFRASTRUCTURE", "DISCOVERY")))
| summarize instances = count(), deep = countIf(isDeep), technologies = collectDistinct(technology), versions = collectDistinct(coalesce(jvmClrVersion, appVersion)), hosts = countDistinct(host), by:{pg, pgName}
| filter deep == 0
| sort pgName asc
| limit 150
```

With every filter set (name `java`, group `checkout`, technology Java, Partially deep monitored):

```dql
fetch dt.entity.process_group_instance, from:now()-24h
| fieldsAdd pg = instance_of[dt.entity.process_group], host = belongs_to[dt.entity.host], technology = if(processType == "IIS" and (in("EXE_NAME:svchost.exe", metadata) or in("EXE_NAME:inetinfo.exe", metadata)), "IIS_SERVICE_HOST", else: coalesce(processType, "OTHER"))
| filter contains(entity.name, "java", caseSensitive:false) and technology == "JAVA"
| lookup [fetch dt.entity.process_group, from:now()-24h | fields id, pgName = entity.name], sourceField:pg, lookupField:id, fields:{pgName}
| filter contains(pgName, "checkout", caseSensitive:false)
| lookup [fetch dt.entity.host, from:now()-24h | fields id, monitoringMode], sourceField:host, lookupField:id, fields:{monitoringMode}
| lookup [fetch dt.entity.service, from:now()-24h | filter isNotNull(agentTechnologyType) and agentTechnologyType != "N/A" | fields agent = agentTechnologyType, pgi = runs_on[dt.entity.process_group_instance] | expand pgi | summarize codeServices = count(), serviceAgents = collectDistinct(agent), by:{pgi}], sourceField:id, lookupField:pgi, fields:{codeServices, serviceAgents}
| lookup [fetch metric.series, from:now()-24h | filter startsWith(metric.key, "dt.runtime.") and isNotNull(dt.entity.process_group_instance) | summarize runtimeMetrics = collectDistinct(metric.key, maxLength:3), by:{dt.entity.process_group_instance}], sourceField:id, lookupField:dt.entity.process_group_instance, fields:{runtimeMetrics}
| fieldsAdd isDeep = isNotNull(installerVersion) or coalesce(codeServices, 0) > 0 or (isNotNull(runtimeMetrics) and not in(coalesce(monitoringMode, ""), array("INFRASTRUCTURE", "DISCOVERY")))
| summarize instances = count(), deep = countIf(isDeep), technologies = collectDistinct(technology), versions = collectDistinct(coalesce(jvmClrVersion, appVersion)), hosts = countDistinct(host), by:{pg, pgName}
| filter deep > 0 and deep < instances
| sort pgName asc
| limit 150
```

- **How it works:** as Query 2 up to the flag, except that the host lookup only adds `monitoringMode` (all the flag
  needs) and there is no Smartscape lookup. Then `summarize … by:{pg, pgName}` produces per process group: `instances`
  (matching instances), `deep` (deep-monitored ones), `technologies` (distinct technology keys), `versions` (distinct
  `jvmClrVersion`, else `appVersion`), `hosts` (distinct hosts). The state filter compares `deep` with `instances`.
  `sort pgName asc`, `limit 150`.
- **Output:** `pg`, `pgName`, `instances`, `deep`, `technologies`, `versions`, `hosts`: the columns of the Process
  groups view. `pg` is the scope of the [process group monitoring read](#process-group-monitoring-states-process-groups-view)
  and of Diagnose.
- **Limits and cost:** at most 150 groups. Counts only include instances that pass the name and technology filters.
- **Open it yourself:** query actions under the table ("Deep monitoring: process group search").

### 4. Diagnose detail (`deepDetailQuery`)

- **Source:** `deepDetailQuery` and `detailTail` in [ui/app/queries.ts](../ui/app/queries.ts#L859).
- **Runs:** when you click **Diagnose**; re-runs if the timeframe changes while the selection is kept.
- **Parameters:** the timeframe, and the target. For a process: `| filter id == "PROCESS_GROUP_INSTANCE-…"`; for a
  process group: `| filter pg == "PROCESS_GROUP-…"`. The ID comes from the selected row.
- **Query (24 hours, process `PROCESS_GROUP_INSTANCE-0000000000000001`):**

```dql
fetch dt.entity.process_group_instance, from:now()-24h
| fieldsAdd pg = instance_of[dt.entity.process_group], host = belongs_to[dt.entity.host], technology = if(processType == "IIS" and (in("EXE_NAME:svchost.exe", metadata) or in("EXE_NAME:inetinfo.exe", metadata)), "IIS_SERVICE_HOST", else: coalesce(processType, "OTHER"))
| filter id == "PROCESS_GROUP_INSTANCE-0000000000000001"
| lookup [fetch dt.entity.process_group, from:now()-24h | fields id, pgName = entity.name], sourceField:pg, lookupField:id, fields:{pgName}
| lookup [fetch dt.entity.host, from:now()-24h | fields id, hostName = entity.name, hostGroup = hostGroupName, hostGroupId = instance_of[dt.entity.host_group], monitoringMode, hostAgentVersion = installerVersion, osType], sourceField:host, lookupField:id, fields:{hostName, hostGroup, hostGroupId, monitoringMode, hostAgentVersion, osType}
| lookup [fetch dt.entity.service, from:now()-24h | filter isNotNull(agentTechnologyType) and agentTechnologyType != "N/A" | fields agent = agentTechnologyType, pgi = runs_on[dt.entity.process_group_instance] | expand pgi | summarize codeServices = count(), serviceAgents = collectDistinct(agent), by:{pgi}], sourceField:id, lookupField:pgi, fields:{codeServices, serviceAgents}
| lookup [fetch metric.series, from:now()-24h | filter startsWith(metric.key, "dt.runtime.") and isNotNull(dt.entity.process_group_instance) | summarize runtimeMetrics = collectDistinct(metric.key, maxLength:3), by:{dt.entity.process_group_instance}], sourceField:id, lookupField:dt.entity.process_group_instance, fields:{runtimeMetrics}
| fieldsAdd isDeep = isNotNull(installerVersion) or coalesce(codeServices, 0) > 0 or (isNotNull(runtimeMetrics) and not in(coalesce(monitoringMode, ""), array("INFRASTRUCTURE", "DISCOVERY")))
| lookup [smartscapeNodes "PROCESS", from:now()-24h | fields sid = toString(id), id_classic], sourceField:id, lookupField:id_classic, fields:{sid}
| fields id, sid, name = entity.name, pg, pgName, host, hostName, hostGroup, hostGroupId, monitoringMode, hostAgentVersion, osType, processType, technology, softwareTechnologies, jvmClrVersion, jvmVendor, appVersion, installerVersion, codeServices, serviceAgents, runtimeMetrics, isDeep, isDockerized, metadata
| sort name asc
| limit 200
```

For a process group, the third line is `| filter pg == "PROCESS_GROUP-0000000000000001"`; nothing else changes.

- **How it works:** the same pipeline as Query 2 without the search filters and the state filter, filtered to the one
  instance or the instances of one group, sorted by name, at most 200.
- **Output:** the same fields as Query 2, converted with `toInstance`; input to `readDeepSettings` and `diagnose`.
- **Limits and cost:** 200 instances per group; the summary line says "(first 200 instances)" at the limit.
- **Open it yourself:** query actions at the bottom of the diagnosis ("Deep monitoring detail: <name>").

### 5. IIS worker processes (`iisWorkersQuery`)

- **Source:** `iisWorkersQuery` in [ui/app/queries.ts](../ui/app/queries.ts#L875); used by `IisWorkers` in
  [DeepMonitoringTab.tsx](../ui/app/tabs/DeepMonitoringTab.tsx#L1144).
- **Runs:** when the diagnosis target's technology is `IIS_SERVICE_HOST`.
- **Parameters:** the timeframe and the distinct host IDs of the diagnosed instances (first 50). Example with two hosts.
- **Query (24 hours):**

```dql
fetch dt.entity.process_group_instance, from:now()-24h
| fieldsAdd pg = instance_of[dt.entity.process_group], host = belongs_to[dt.entity.host], technology = if(processType == "IIS" and (in("EXE_NAME:svchost.exe", metadata) or in("EXE_NAME:inetinfo.exe", metadata)), "IIS_SERVICE_HOST", else: coalesce(processType, "OTHER"))
| filter in(host, array("HOST-0000000000000001", "HOST-0000000000000002")) and in(technology, array("IIS_APP_POOL", "IIS"))
| lookup [fetch dt.entity.process_group, from:now()-24h | fields id, pgName = entity.name], sourceField:pg, lookupField:id, fields:{pgName}
| lookup [fetch dt.entity.host, from:now()-24h | fields id, hostName = entity.name, hostGroup = hostGroupName, hostGroupId = instance_of[dt.entity.host_group], monitoringMode, hostAgentVersion = installerVersion, osType], sourceField:host, lookupField:id, fields:{hostName, hostGroup, hostGroupId, monitoringMode, hostAgentVersion, osType}
| lookup [fetch dt.entity.service, from:now()-24h | filter isNotNull(agentTechnologyType) and agentTechnologyType != "N/A" | fields agent = agentTechnologyType, pgi = runs_on[dt.entity.process_group_instance] | expand pgi | summarize codeServices = count(), serviceAgents = collectDistinct(agent), by:{pgi}], sourceField:id, lookupField:pgi, fields:{codeServices, serviceAgents}
| lookup [fetch metric.series, from:now()-24h | filter startsWith(metric.key, "dt.runtime.") and isNotNull(dt.entity.process_group_instance) | summarize runtimeMetrics = collectDistinct(metric.key, maxLength:3), by:{dt.entity.process_group_instance}], sourceField:id, lookupField:dt.entity.process_group_instance, fields:{runtimeMetrics}
| fieldsAdd isDeep = isNotNull(installerVersion) or coalesce(codeServices, 0) > 0 or (isNotNull(runtimeMetrics) and not in(coalesce(monitoringMode, ""), array("INFRASTRUCTURE", "DISCOVERY")))
| lookup [smartscapeNodes "PROCESS", from:now()-24h | fields sid = toString(id), id_classic], sourceField:id, lookupField:id_classic, fields:{sid}
| fields id, sid, name = entity.name, pg, pgName, host, hostName, hostGroup, hostGroupId, monitoringMode, hostAgentVersion, osType, processType, technology, softwareTechnologies, jvmClrVersion, jvmVendor, appVersion, installerVersion, codeServices, serviceAgents, runtimeMetrics, isDeep, isDockerized, metadata
| sort name asc
| limit 50
```

- **How it works:** the detail pipeline, filtered to instances on the given hosts whose technology is `IIS_APP_POOL` or
  `IIS` (the `w3wp.exe` workers; service hosts are `IIS_SERVICE_HOST` and excluded), at most 50.
- **Output:** `name`, `hostName`, `isDeep` and the evidence, listed as "name on host: deep monitored / not deep
  monitored (evidence)".
- **Open it yourself:** query actions in the IIS panel ("IIS worker processes").

### Client-side post-processing

`toInstance` ([ui/app/deepMonitoring.ts](../ui/app/deepMonitoring.ts#L159)) turns every search, detail and IIS record
into an `Instance`:

1. **Technology key:** `technology` (or `processType`), `OTHER` becomes null (unclassified).
2. **Software technologies:** each `softwareTechnologies` string such as `type:JAVA,edition:OpenJDK,version:11.0.5` is
   split into `{type, edition, version}`; `null` or empty values become null.
3. **Version:** the first entry whose type is one of the technology's version types and has a version (catalogue column
   *Version from*), cleaned by removing a leading `name/` (`nginx/1.26.3` becomes `1.26.3`) and a `go` prefix
   (`go1.22.5` becomes `1.22.5`). Otherwise the fallback: `jvmClrVersion` (Java family) or `appVersion` (IIS, Node.js,
   PHP, Python, Apache, NGINX, unknown types). Edition: from the same entries, else `jvmVendor`. Vendor shown in the
   summary line: `jvmVendor`, else the edition.
4. **musl:** a `LIBC` entry with edition `musl` (used by the Java 26 rule).
5. **Metadata:** each `KEY:value` string is stored under the normalized key (underscores removed, upper case); the host
   group name is added as `HOST_GROUP`.
6. **Container runtime:** the first `CONTAINERD`, `CRIO`, `DOCKER`, `PODMAN` or `GARDEN` entry; Docker on a host with
   `osType` `WINDOWS` becomes *Docker for Windows Server*.
7. **Kubernetes:** metadata `KUBERNETES_NAMESPACE` present, or a `KUBERNETES` software technology.
8. **Deep flag and evidence** as described in [How the app decides](#how-the-app-decides-that-a-process-is-deep-monitored).

## API calls

| Method | Endpoint / SDK method | Scope | When |
| --- | --- | --- | --- |
| GET | `/platform/classic/environment-api/v2/settings/objects` (`settingsObjectsClient.getSettingsObjects`), 16 schemas | `settings:objects:read` | Processes view results arrive (Status column); Diagnose; after every successful API fix in a diagnosis |
| GET | same, schema `builtin:process-group.monitoring.state` only | `settings:objects:read` | Process groups view results arrive |
| GET | same, schema `builtin:process.process-monitoring`, scope `environment` | `settings:objects:read` | The generic action *Enable automatic deep monitoring (environment)* is shown |
| POST | `/platform/classic/environment-api/v2/settings/objects?validateOnly=true\|false` (`postSettingsObjects`) | `settings:objects:write` | Validate / apply of a fix that creates objects |
| PUT | `/platform/classic/environment-api/v2/settings/objects/{objectId}?validateOnly=true\|false` (`putSettingsObjectByObjectId`) | `settings:objects:write` | Validate / apply of a fix that updates existing objects |
| POST | `/api/docs-freshness` (app function, `functions.call("docs-freshness")`) | none | Once per page load, when the first Remediation actions section renders; again on *Retry* |
| GET | `https://docs.dynatrace.com/docs/sitemap.xml` (from inside the app function) | outbound allowlist | Each docs-freshness call |
| - | Intents and links (`getIntentLink`, `sendIntent`) | none | Links and query actions |

### Settings read for the Status column and Diagnose

`readDeepSettings` in [ui/app/deepMonitoring.ts](../ui/app/deepMonitoring.ts#L250).

**Schemas read (16), in the request order:**

| # | Schema | Scopes the app reads | Fields used from `value` | Used for | Default when no object |
| --- | --- | --- | --- | --- | --- |
| 1 | `builtin:process-group.monitoring.state` | `PROCESS_GROUP-…` | `MonitoringState` (`MONITORING_ON` / `MONITORING_OFF`) | Decision step 2, *Deep monitoring setting* column (Processes view), `pg-on` fix | `DEFAULT` |
| 2 | `builtin:host.process-groups.monitoring-state` | `HOST-…` | `ProcessGroup`, `MonitoringState` | Decision step 1, `host-pg-on` fix | none |
| 3 | `builtin:process.process-monitoring` | `HOST_GROUP-…`, `environment` | `autoMonitoring` | Decision step 6, `auto-monitoring` fix | on |
| 4 | `builtin:process.custom-process-monitoring-rule` | `HOST_GROUP-…`, `environment` | `enabled`, `mode`, `condition.item`, `condition.operator`, `condition.value`, `condition.envVar` | Decision step 3, shadowed / unknown rule checks, `disable-rules` and `monitor-rule` fixes | no rules |
| 5 | `builtin:process.built-in-process-monitoring-rule` | `HOST_GROUP-…`, `environment` | `"-<id>"` booleans | Which built-in rules are switched off (step 4) | all on |
| 6 | `builtin:container.technology` | `HOST-…`, `HOST_GROUP-…`, `environment` | `boshProcessManager`, `containerd`, `crio`, `docker`, `dockerWindows`, `garden`, `podman`, `winc` | Container injection check, `container-tech` fix | see defaults above |
| 7 | `builtin:container.monitoring-rule` | `environment` | `enabled`, `mode`, `property`, `operator`, `value` | Container rules check, `disable-container-rules` fix | no rules |
| 8 | `builtin:monitored-technologies.java` | `HOST-…`, `environment` | `enabled` | Switch check | on |
| 9 | `builtin:monitored-technologies.go` | `HOST-…`, `environment` | `enabled`, `enabledGoStaticMonitoring` | Switch check, Go static check | on / off |
| 10 | `builtin:monitored-technologies.python` | `HOST-…`, `environment` | `enabled` | Switch check | **off** |
| 11 | `builtin:monitored-technologies.nodejs` | `HOST-…`, `environment` | `enabled` | Switch check | on |
| 12 | `builtin:monitored-technologies.php` | `HOST-…`, `environment` | `enabled` (defaults also hold `enabledFastCGI: false`, `enablePhpCliServerInstrumentation: false`) | Switch check | on |
| 13 | `builtin:monitored-technologies.dotnet` | `HOST-…`, `environment` | `enabled`, `enabledDotNetCore` | Switch check, .NET Core check | on / on |
| 14 | `builtin:monitored-technologies.iis` | `HOST-…`, `environment` | `enabled` | Switch check | on |
| 15 | `builtin:monitored-technologies.apache` | `HOST-…`, `environment` | `enabled` | Switch check | on |
| 16 | `builtin:monitored-technologies.nginx` | `HOST-…`, `environment` | `enabled` | Switch check | on |

The schema IDs, property names and defaults were read from a tenant with `dtctl get settings-schema` (code comments).
Each schema page in the Dynatrace docs is linked from the fixes: see [Documentation for this fix](#documentation-for-this-fix).

**Scopes sent:** `environment`, then every distinct process group ID, every distinct host group ID, and the distinct
host IDs (hosts of instances without a code module first), capped at **50 hosts** for Diagnose (`MAX_HOST_SCOPES`) and
**150 hosts** for the Processes view (`DEEP_SEARCH_LIMIT`). The list is cut into chunks of **80 scopes**
(`SCOPES_PER_REQUEST`, to keep the URL short; about 35 characters per ID) and one GET per chunk runs in parallel. A
single process or a process group on a few hosts is one GET; 150 search rows are typically several.

**Request (first page), example for one process:**

```http
GET /platform/classic/environment-api/v2/settings/objects?schemaIds=builtin:process-group.monitoring.state,builtin:host.process-groups.monitoring-state,builtin:process.process-monitoring,builtin:process.custom-process-monitoring-rule,builtin:process.built-in-process-monitoring-rule,builtin:container.technology,builtin:container.monitoring-rule,builtin:monitored-technologies.java,builtin:monitored-technologies.go,builtin:monitored-technologies.python,builtin:monitored-technologies.nodejs,builtin:monitored-technologies.php,builtin:monitored-technologies.dotnet,builtin:monitored-technologies.iis,builtin:monitored-technologies.apache,builtin:monitored-technologies.nginx&scopes=environment,PROCESS_GROUP-0000000000000001,HOST_GROUP-0000000000000001,HOST-0000000000000001&fields=objectId,schemaId,scope,value,updateToken&pageSize=500
```

(query values are URL-encoded by the SDK). Following pages: `GET …/settings/objects?nextPageKey=<key>` until no
`nextPageKey` is returned.

**Response fields used:** `items[].objectId`, `items[].schemaId`, `items[].scope`, `items[].value`,
`items[].updateToken` (kept for PUT), and `nextPageKey`. Example item:

```json
{
  "objectId": "<objectId>",
  "schemaId": "builtin:process-group.monitoring.state",
  "scope": "PROCESS_GROUP-0000000000000001",
  "value": { "MonitoringState": "MONITORING_OFF" },
  "updateToken": "<updateToken>"
}
```

The items are sorted into maps by schema and scope (one object per scope; custom and container rules keep their list
order). How each schema is resolved per instance:

| Setting | Resolution |
| --- | --- |
| Process group monitoring | Object of the instance's process group, else `DEFAULT`. |
| Host-level process group monitoring | Object with scope = the instance's host and `value.ProcessGroup` = its process group. |
| Automatic deep monitoring | Host group object (the whole value), else environment object, else on. |
| Built-in rule switches | Host group object, else environment object; a missing key means the rule is on. |
| Monitored technologies | Schema defaults, overlaid with the environment object's value, overlaid with the host object's value. |
| Container injection | The first object found at host, then host group, then environment scope, overlaid on the schema defaults; else the defaults. |
| Custom rules | Enabled rules of the instance's host group, then of the environment. |
| Container rules | Enabled environment rules. |

**When:** Processes view, once per result set; Diagnose, once per selection and again after every successful API fix
(the re-read is keyed on a signature of instance IDs and deep flags, plus a counter the fixes increment). A failed read
in the Processes view shows "—" in the Status column; in Diagnose it shows the error and evaluates against empty
settings.

### Process group monitoring states (Process groups view)

`readPgStates` in [ui/app/deepMonitoring.ts](../ui/app/deepMonitoring.ts#L296). For the IDs starting with
`PROCESS_GROUP-` in the results, in chunks of 80, one paged GET per chunk in parallel:

```http
GET /platform/classic/environment-api/v2/settings/objects?schemaIds=builtin:process-group.monitoring.state&scopes=PROCESS_GROUP-0000000000000001,PROCESS_GROUP-0000000000000002&fields=scope,value&pageSize=500
```

Response fields used: `items[].scope`, `items[].value.MonitoringState`, `nextPageKey`. Groups without an object are
`DEFAULT`. If the read fails, the column keeps showing "…".

### Automatic deep monitoring (environment) read

`AutoMonitoringEnvForm` in [DeepMonitoringTab.tsx](../ui/app/tabs/DeepMonitoringTab.tsx#L1069), when the generic action
is shown and again after it was applied:

```http
GET /platform/classic/environment-api/v2/settings/objects?schemaIds=builtin:process.process-monitoring&scopes=environment&fields=objectId,scope,value,updateToken
```

Uses `items[0].objectId`, `scope`, `value.autoMonitoring`, `updateToken`. No object means the default (on).

### Settings writes

All writes go through three helpers in [ui/app/deepMonitoring.ts](../ui/app/deepMonitoring.ts#L753) (plus
`setMonitoringModes` in [ui/app/remediation.ts](../ui/app/remediation.ts)):

- `postObjects(body, validateOnly)`: one `POST /platform/classic/environment-api/v2/settings/objects?validateOnly=…` with
  an array of `{schemaId, scope, value}`. The response is one entry per object with a `code`; the first entry with
  `code >= 400` is reported ("Rejected (HTTP 4xx)" or its `error.message`). An HTTP error response is reported with its
  message.
- `putObjects(objs, validateOnly)`: one `PUT /platform/classic/environment-api/v2/settings/objects/{objectId}?validateOnly=…`
  **per object**, in parallel, with body `{"value": {...}, "updateToken": "<updateToken>"}` (the Settings API has no
  bulk update). Failures are reported as "N of M rejected: <first error>".
- `upsert(schemaId, scope, existing, value, validateOnly)`: PUT the existing object when it is at the same scope,
  otherwise POST a new one (one call either way).

The request text shown in each form is the body sent; for PUTs it shows `{objectId, value}` per object (the
`updateToken` from the read is added to the actual request).

### docs-freshness app function

See [Docs freshness](#docs-freshness-keeping-the-guidance-current) for the full mechanism.

```http
POST /api/docs-freshness
Content-Type: application/json

{ "urls": ["https://docs.dynatrace.com/docs/ingest-from/technology-support", "…123 URLs…"],
  "prefixes": ["https://docs.dynatrace.com/docs/observe/application-observability/services/service-detection/service-detection-v2"] }
```

Response used: `status` (`ok` / `blocked` / `error`), `checkedAt`, `pages` (URL to sitemap `lastmod`, or null when the
page is not in the sitemap), `sections` (URL to `lastmod` for every page under the prefixes), `message`.

### Links and intents

| Where | App / intent | Payload |
| --- | --- | --- |
| *Process ↗* (results) | `dynatrace.infraops` / `view_smartscape_process` | `nodeId` = Smartscape process ID, `dt.timeframe` |
| *Process group ↗* (results, pg-on click path) | `dynatrace.infraops` / `view_process_group` | `meId` = `PROCESS_GROUP-…`, `dt.timeframe` |
| *Setting ↗*, *↗ Open the setting*, settings links in fixes | `dynatrace.settings` / `open_settings_for_schema` | `settings.schemaId`, and `settings.entityId` for a non-environment scope |
| *Classic ↗*, *Same in Settings Classic* | `dynatrace.classic.settings` / `settings-open-settings` | `dt.settings.schema`, and `dt.settings.scope` for a non-environment scope |
| *Confirm first* links | see [Remediation actions section](#remediation-actions-section) | |
| *setting ↗* in the docs status line | `dynatrace.settings` / `open_settings_for_schema` | `settings.schemaId` = `builtin:dt-javascript-runtime.allowed-outbound-connections` |
| Show DQL / Copy / Open in Notebook / Add to Dashboard | `sendIntent` to `dynatrace.notebooks` / `view-query` and `dynatrace.dashboards` / `add-to-dashboard` | `{"dt.query": <query>, "title": <title>}` |

`dt.timeframe` is `{from, to}` in ISO format: now minus 24 hours / 7 days / 30 days, and now
([ui/app/links.ts](../ui/app/links.ts#L56)). The OpenTelemetry steps read the environment ID with `getEnvironmentId()`
from `@dynatrace-sdk/app-environment` (no network call).

## Remediation actions

Built by `buildActions` ([DeepMonitoringTab.tsx](../ui/app/tabs/DeepMonitoringTab.tsx#L824)) from the diagnosis, and by
`genericActions` before a selection.

### How an API fix works

Every API action uses the shared `ApiFix` form ([DeepMonitoringTab.tsx](../ui/app/tabs/DeepMonitoringTab.tsx#L627)),
also used by the ActiveGates and Databases tabs:

1. A summary of what will change, and for some actions links to make the same change in the Dynatrace UI with the
   documented click path (collapsed under *Click path*).
2. **Request (…)**: collapsed; shows the method, the number of API calls and the exact JSON body, with a Copy button.
3. **↗ Open the setting** (when the action has one): the setting in the Settings app at the scope being written.
4. A confirmation checkbox (text per action). The apply button stays disabled until it is ticked.
5. **Validate**: sends the same request with `validateOnly=true`; shows "Validation passed. Nothing was changed." (or
   the rejection) in a result line with a green or red edge. Nothing is written.
6. **Apply** (label per action): sends the request with `validateOnly=false`. On failure the error is shown and nothing
   else changes. On success the checkbox is cleared and, in a diagnosis, the settings are read again and the diagnosis
   and the action list are rebuilt (the success line is replaced by the refreshed diagnosis; the selected action resets
   to the first). Both buttons are disabled while a request runs.

A process only gets a code module when it starts, so every success message ends with a restart reminder.

### Which actions are offered, and in which order

Actions are collected in the order below, de-duplicated by id, then grouped by severity: each action takes the most
severe status (*Blocking* fail, *Check* warn, *Info* info) of the non-passing checks it addresses (`ACTION_FIXES`);
actions that address none are *More steps*. Within a group the collection order is kept, so API fixes stay ahead of the
matching manual steps. The first action of the first group is preselected.

| # | Action id | Dropdown text | Kind | Offered when | Addresses checks with fix |
| --- | --- | --- | --- | --- | --- |
| 1 | `pg-on` | API · Enable deep monitoring for the process group | API | The technology has a code module, is not CICS, the group is not already set to Monitor, and some instance is decided by the group's own *Do not monitor*, a custom rule, a built-in rule, a missing Monitor rule or automatic deep monitoring off | `pg-on`, `disable-rules`, `monitor-rule`, `auto-monitoring` |
| 2 | `full-stack` | API · Switch hosts to Full-Stack (Settings API) | API | A `full-stack` check is not passing | `full-stack` |
| 3 | `monitoring-mode` | Manual · Monitoring mode with oneagentctl (single host) | Manual | with 2 | `full-stack` |
| 4 | `host-pg-on` | API · Re-enable the process group on its hosts | API | `host-pg-on` check | `host-pg-on` |
| 5 | `disable-rules` | API · Disable the excluding custom rules | API | `disable-rules` check | `disable-rules` |
| 6 | `auto-monitoring` | API · Enable automatic deep monitoring (<origin>) | API | `auto-monitoring` check | `auto-monitoring` |
| 7 | `container-tech` | API · Enable injection into <runtime> containers | API | `container-tech` check | `container-tech` |
| 8 | `disable-container-rules` | API · Disable the excluding container rules | API | `disable-container-rules` check | `disable-container-rules` |
| 9 | `monitored-tech` | API · Turn on "Monitor <technology>" | API | `monitored-tech` check | `monitored-tech` |
| 10 | `dotnet-core` | API · Turn on "Enable .NET Core" | API | `dotnet-core` check | `dotnet-core` |
| 11 | `monitor-rule` | API · Create a Monitor rule for this process | API | `monitor-rule` check | `monitor-rule`, `go-static` |
| 12 | `go-static` | API · Turn on "Enable Go static application monitoring" | API | `go-static` check | `go-static` |
| 13 | `monitor-rule` | API · Create a Monitor rule for this binary | API | with 12, only if 11 is not offered | `monitor-rule`, `go-static` |
| 14 | `updates-ui` | Manual · Update overrides per host group / host | Manual | `update-agent` check | `update-agent` |
| 15 | `upgrade` | Manual · Upgrade <technology> <version> | Manual | `upgrade` check | `upgrade` |
| 16 | `otel` or `extension` | Manual · Instrument with OpenTelemetry / Trace Envoy with OpenTelemetry / Monitor <technology> with its extension | Manual | `alternative` check, or the technology has no code module and is not a system kind | `alternative` |
| 17 | `kubernetes` | Manual · Kubernetes: Operator injection | Manual | `kubernetes` check, or an instance without a code module runs on Kubernetes | `kubernetes` |
| 18 | `restart` or `cics` | Manual · Restart the <technology> process / Check the CICS module installation | Manual | The technology has a code module | `restart` |

### Enable deep monitoring for the process group

- **Fixes:** the process group's own *Do not monitor*, a custom or built-in *Do not monitor* rule, a missing Monitor
  rule (Go, .NET, Python) or automatic deep monitoring being off. *Monitor* on the process group wins over all of these
  and applies to every instance of the group. A host-level process group setting is evaluated before it, so this action
  is not offered when that is the only blocker.
- **Summary:** "Sets process group **<name>** to **Monitor** (now: Do not monitor / Default) with one Settings API POST.
  … applies to every instance of the group (N instances). The processes get a code module at their next restart." When
  the group already has an object: "if the POST is rejected for that reason, the same value is written with one PUT."
  When other failing checks remain that Monitor does not lift: "It does not change Full-Stack mode, the Monitored
  technologies switch, Enable .NET Core, container injection, container rules, Operator namespace selection, the
  OneAgent version, the host-level setting: fix those too." (only the ones present).
- **Or enable it in the Dynatrace UI:** links to *Process group monitoring for <name> (Settings)*, *Same in Settings
  Classic*, *Process group monitoring on host <host>* for up to 3 hosts of the instances without a code module
  (`builtin:host.process-groups.monitoring-state` at the host scope), and the *Process group page*. Click path:
  1. Process group: open the first link and set Monitoring state to Monitor for <name>, then save.
  2. One host only: Hosts Classic > the host > More (…) > Settings > Process group monitoring > Add process group > pick
     the process group > Monitoring state: Monitor.
  3. Whole environment (all new processes): Settings > Processes and containers > Process group monitoring > Enable
     automatic deep monitoring.
  4. Rule-based: Settings > Processes and containers > Custom process monitoring rules > Add item > Mode: Monitor, with
     a condition that matches the process.
  5. Restart the processes afterwards: the code module is loaded at process start.
- **Request:** "Request (POST /settings/objects, 1 API call)":

```json
[
  {
    "schemaId": "builtin:process-group.monitoring.state",
    "scope": "PROCESS_GROUP-0000000000000001",
    "value": { "MonitoringState": "MONITORING_ON" }
  }
]
```

  If the POST is rejected (an object can exist only once per process group) and the group already had an object, the app
  sends `PUT /platform/classic/environment-api/v2/settings/objects/<objectId>` with
  `{"value": {"MonitoringState": "MONITORING_ON"}, "updateToken": "<updateToken>"}` and appends "(The group already had
  a setting, so it was updated with PUT.)". The same fallback applies to Validate.
- **Confirmation:** "Enable deep monitoring for process group <name>". **Apply:** "Enable deep monitoring".
- **Success:** "Deep monitoring enabled for the process group (Monitor). Restart its processes to inject the code
  module." (with the new object ID when the POST succeeded).
- **Documentation:** Schema: process group monitoring, Process deep monitoring, Troubleshoot deep-monitoring issues, plus
  the technology pages.

### Switch hosts to Full-Stack

- **Fixes:** *Host not in Full-Stack mode*. Code modules are only injected in Full-Stack mode.
- **Summary:** "Switches N hosts (host-a, host-b, host-c) to **Full-Stack** mode. This raises license consumption;
  processes are injected after a restart." The hosts are the distinct hosts of the instances without a code module
  whose mode is not `FULL_STACK`.
- **Request:** "Request (1 API call for N hosts)": one POST with one object per host (the form shows the first two and
  "// … N more objects in the same request"):

```json
[
  { "schemaId": "builtin:host.monitoring.mode", "scope": "HOST-0000000000000001", "value": { "monitoringMode": "FULL_STACK" } },
  { "schemaId": "builtin:host.monitoring.mode", "scope": "HOST-0000000000000002", "value": { "monitoringMode": "FULL_STACK" } }
]
```

- **Confirmation:** "Change N hosts to Full-Stack". **Apply:** "Change mode".
- **Result:** "Monitoring mode set to Full Stack on N hosts. Hosts apply it when connected; restart monitored processes
  to pick it up." / "Validation passed for N hosts. Nothing was changed." / "k of N hosts rejected: <error>".
- **Documentation:** OneAgent monitoring modes, [Enable OneAgent monitoring modes](https://docs.dynatrace.com/docs/platform/oneagent/monitoring-modes/enable-monitoring-modes),
  [oneagentctl reference](https://docs.dynatrace.com/docs/ingest-from/dynatrace-oneagent/oneagent-configuration-via-command-line-interface),
  plus the technology pages.
- **Manual companion, *Monitoring mode with oneagentctl (single host)*:** steps "Identify hosts not in full-stack mode.",
  "Run the command on each host.", "Verify with --get-monitoring-mode."; variants Linux / AIX
  `./oneagentctl --set-monitoring-mode=fullstack --restart-service` and Windows
  `.\oneagentctl.exe --set-monitoring-mode=fullstack --restart-service`; note "Changes license consumption. Valid modes:
  fullstack, infra-only, discovery." The [OneAgents page](oneagents.md) covers the mode in detail.

### Re-enable the process group on its hosts

- **Fixes:** *Disabled for this process group on the host*.
- **Request:** "Request (PUT, N API calls: one per host override)", one PUT per host object that sets this process
  group to `MONITORING_OFF` (on the hosts of the instances without a code module); the form shows the first two:

```json
[
  { "objectId": "<objectId>", "value": { "ProcessGroup": "PROCESS_GROUP-0000000000000001", "MonitoringState": "MONITORING_ON" } }
]
```

- **Confirmation:** "Turn monitoring back on for this process group on N hosts". **Apply:** "Set to Monitor".
  **Open the setting:** the first host's *Process group monitoring* page.
- **Success:** "N host settings set to Monitor. Restart the processes."
- **Documentation:** Schema: process group monitoring on a host, Process deep monitoring, Troubleshoot deep-monitoring
  issues.

### Disable the excluding custom rules

- **Fixes:** *Excluded by a custom monitoring rule* and *Also excluded by N custom rules*. The rules are the deciding
  *Do not monitor* rules plus the shadowed ones.
- **Summary:** "Disables N rules (kept, so they can be turned back on): <rule texts>. Disabling a rule affects every
  process it matches; to keep the rule, set just this process group to Monitor instead."
- **Request:** "Request (PUT, N API calls: one per rule)", the rule's current value with `enabled: false`:

```json
[
  {
    "objectId": "<objectId>",
    "value": {
      "enabled": false,
      "mode": "MONITORING_OFF",
      "condition": { "item": "JAVA_JAR_FILE", "operator": "EQUALS", "value": "batch.jar" }
    }
  }
]
```

- **Confirmation:** "Disable N custom process monitoring rules". **Apply:** "Disable rules". **Open the setting:** Custom
  process monitoring rules (environment).
- **Success:** "N rules disabled. Restart the affected processes."
- **Documentation:** Schema: custom process monitoring rules, Troubleshoot deep-monitoring issues.

### Enable automatic deep monitoring (host group or environment)

- **Fixes:** *Automatic deep monitoring off*, at the scope it comes from (the host group's object, else the environment).
- **Summary:** "Turns on **Enable automatic deep monitoring** for the <origin>. Every new process in that scope is then
  deep monitored; to change only this process group, set it to Monitor instead."
- **Request:** "Request (PUT, 1 API call)" when an object exists:

```json
{ "objectId": "<objectId>", "value": { "autoMonitoring": true } }
```

  otherwise "Request (POST, 1 API call)":

```json
[ { "schemaId": "builtin:process.process-monitoring", "scope": "environment", "value": { "autoMonitoring": true } } ]
```

- **Confirmation:** "Deep monitor all processes in the <origin> automatically". **Apply:** "Enable". **Open the
  setting:** at that scope.
- **Success:** "Automatic deep monitoring enabled. Restart processes to inject them."
- **Documentation:** Schema: automatic deep monitoring, Troubleshoot deep-monitoring issues.

### Generic: Enable automatic deep monitoring (environment)

Shown before a selection. Reads the environment object (see [API calls](#automatic-deep-monitoring-environment-read)) and
shows "Environment-wide automatic deep monitoring: **on** / **off** (default). Host groups can override it." When on:
"Already on. Use the search above and Diagnose to find what blocks a specific process." When off: the same form as
above at scope `environment` (summary "Deep monitors every new process in the environment automatically (host groups with
their own setting keep it).", confirmation "Turn on automatic deep monitoring for the environment", apply "Enable").
After success the setting is read again and the text switches to "Already on". If the read fails, "Could not read the
setting: <error>" is shown and the value is treated as the default (on).

### Enable injection into <runtime> containers

- **Fixes:** *Injection into <runtime> containers off*.
- **Summary:** "Turns on code-module injection for **<runtime>** containers for the <scope>; the other container
  technologies keep their current values."
- **Request:** PUT the object at the scope where the effective value was found, or POST at `environment` when it came
  from the defaults. The value is the full set of runtime flags (defaults overlaid with the object) with the runtime
  set to `true`, for example:

```json
[
  {
    "schemaId": "builtin:container.technology",
    "scope": "environment",
    "value": { "boshProcessManager": true, "containerd": true, "crio": true, "docker": true, "dockerWindows": false, "garden": true, "podman": true, "winc": false }
  }
]
```

- **Confirmation:** "Inject code modules into <runtime> containers (<scope>)". **Apply:** "Enable".
- **Success:** "Injection into <runtime> containers enabled. Restart the containers."
- **Documentation:** Schema: container monitoring, Troubleshoot deep-monitoring issues.

### Disable the excluding container rules

- **Fixes:** *Excluded by N container monitoring rules*.
- **Request:** one PUT per rule with its value and `enabled: false`. **Confirmation:** "Disable N container monitoring
  rules". **Apply:** "Disable rules". **Open the setting:** Container monitoring rules.
- **Success:** "N rules disabled. Restart the affected processes."
- **Documentation:** Schema: container monitoring, Troubleshoot deep-monitoring issues.

### Turn on a Monitored technologies switch

Used for *Monitor <technology>* (`monitored-tech`), *Enable .NET Core* (`dotnet-core`) and *Enable Go static application
monitoring* (`go-static`) (`SwitchFix`, [DeepMonitoringTab.tsx](../ui/app/tabs/DeepMonitoringTab.tsx#L687)).

- **Apply to** (only when the target has a host): *This host (<host>)* or *Environment (all hosts without their own
  setting)*. Default: the host when a host object exists, else the environment.
- **Value:** for the host, the effective value (defaults, environment, host) with the property set to `true`, because a
  host object overrides the environment completely; for the environment, the environment's value with the property
  `true`.
- **Summary:** "Turns on **Monitor Python** for host <host> (currently off, from the environment (default)). The process
  is injected at its next restart." When the environment is chosen but the host has its own object that keeps it off:
  "This host has its own setting that keeps it off, so change the host instead."
- **Request:** "Request (PUT, 1 API call)" `{"objectId": "<objectId>", "value": {...}}` when an object exists at the
  chosen scope; otherwise "Request (POST, 1 API call)", for example:

```json
[ { "schemaId": "builtin:monitored-technologies.python", "scope": "HOST-0000000000000001", "value": { "enabled": true } } ]
```

- **Confirmation:** "Turn on "<label>" for <scope>". **Apply:** "Turn on". **Open the setting:** at the scope.
- **Success:** ""<label>" turned on. Restart the process."
- **Documentation:** the schema page of the switch (for example Schema: monitor Python; Go static: Enable Go monitoring),
  Troubleshoot deep-monitoring issues.

### Create a Monitor rule for this process / binary

`MonitorRuleForm` ([DeepMonitoringTab.tsx](../ui/app/tabs/DeepMonitoringTab.tsx#L728)).

- **Fixes:** *No rule includes it* (Go, standalone .NET, Python), and Go static binaries (with the Go static switch).
- **Condition:** one option per metadata property of the target that has a value without `,` `:` `;` and at most 1000
  characters, most specific first: `JAVA_JAR_FILE`, `JAVA_MAIN_CLASS`, `SPRINGBOOT_APP_NAME`, `DOTNET_COMMAND`,
  `IIS_APP_POOL`, `NODEJS_APP_NAME`, `NODEJS_SCRIPT_NAME`, `PYTHON_SCRIPT`, `PHP_CLI_SCRIPT_PATH`, `RUBY_SCRIPT_PATH`,
  `KUBERNETES_CONTAINERNAME`, `KUBERNETES_BASEPODNAME`, `EXE_PATH`, `EXE_NAME`. Shown as `java jar file equals
  "checkout.jar"`. For `EXE_NAME` / `EXE_PATH` a warning says "This condition matches every process with the same
  executable (java); prefer a more specific condition when one is listed." If the process has none: "The process reports
  no metadata a rule can match on; set the process group to Monitor instead."
- **Scope:** *Host group <name>* (default when the host has a host group) or *Environment*.
- **Summary:** "Adds the rule **Monitor if <condition>** for <scope>. A Do-not-monitor rule earlier in the list still
  wins; the process is injected at its next restart."
- **Request:** "Request (POST, 1 API call)":

```json
[
  {
    "schemaId": "builtin:process.custom-process-monitoring-rule",
    "scope": "HOST_GROUP-0000000000000001",
    "value": {
      "enabled": true,
      "mode": "MONITORING_ON",
      "condition": { "item": "JAVA_JAR_FILE", "operator": "EQUALS", "value": "checkout.jar" }
    }
  }
]
```

- **Confirmation:** "Create a Monitor rule for <scope>". **Apply:** "Create rule". **Open the setting:** Custom process
  monitoring rules at the scope.
- **Success:** "Monitor rule created. Restart the process."
- **Documentation:** Schema: custom process monitoring rules, Process deep monitoring, Troubleshoot deep-monitoring
  issues (for the Go binary variant: Enable Go monitoring, Schema: custom process monitoring rules).

### Update overrides per host group / host

Manual, for *OneAgent X is too old for this version*. Steps: "Settings > Fleet management > OneAgent version and updates
> Configure updates.", "For overrides, open Configure updates from the entity in Fleet Management.", "Restart monitored
server processes after an update." Note: "Host settings override host group settings, which override global settings.
Update windows don't apply in Kubernetes." Documentation: [OneAgent update](https://docs.dynatrace.com/docs/setup-and-configuration/dynatrace-oneagent/oneagent-update)
plus the technology pages.

### Upgrade <technology> <version>

Manual (`upgradeAction`, [ui/app/deepActions.ts](../ui/app/deepActions.ts#L120)), for a runtime that is not supported,
has limited support or whose support is ending. Steps: the support text (for example "Node.js 16 has limited support.
Move to Node.js 24 (LTS)."), "Move the application to a supported <technology> version (see the technology support page
and the vendor's support policy below).", "Restart the process on the new runtime, then use Diagnose again." Notes: the
technology notes. Documentation: the technology's Dynatrace pages, End-of-support news, the vendor policy.

### Instrument with OpenTelemetry / Trace Envoy / Monitor with an extension

Manual (`alternativeAction`, [ui/app/deepActions.ts](../ui/app/deepActions.ts#L173)) for technologies without a code
module.

- **Instrument with OpenTelemetry** (Ruby, Erlang / Elixir, Other / unclassified; generic action for "the application"):
  steps "Add the OpenTelemetry SDK (or zero-code instrumentation) for <technology>.", "Create a platform token with
  openpipeline:traces:ingest (plus metrics / logs ingest if you send them).", "Point the OTLP exporter at Dynatrace over
  HTTP/protobuf (gRPC and JSON are not accepted), or send through an OpenTelemetry Collector." Variant *Exporter
  environment variables*:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://<environment-id>.live.dynatrace.com/api/v2/otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <platform token>"
```

  (the app fills in the environment ID). Notes: "Through an ActiveGate: https://<activegate>:9999/e/<environment-id>/api/v2/otlp.",
  "OpenTelemetry and OneAgent can be mixed per service. Ruby and Erlang need the OneAgent feature "Send W3C Trace Context
  HTTP headers" for end-to-end traces." Documentation: the technology pages, OpenTelemetry, OTLP API endpoints.
- **Trace Envoy with OpenTelemetry** (Envoy): steps "Disable the OneAgent Envoy module first (Monitored technologies >
  Monitor Envoy off).", "Configure Envoy's OpenTelemetry tracer to export to the Dynatrace OTLP traces endpoint.", "Use a
  token with openpipeline:traces:ingest and adaptive-traffic-management:sampling-configuration:read."; same exporter
  variant; note "Envoy 1.30+ (Linux x86-64). This integration is outside the Dynatrace support policy." Documentation:
  Envoy OpenTelemetry tracing, OTLP API endpoints.
- **Monitor <technology> with its extension** (SQL Server, MySQL, PostgreSQL, MongoDB, Redis, HAProxy): steps "<label>
  itself is not deep monitored; requests to it already appear as calls from the deep-monitored applications.", "Activate
  the Dynatrace extension for it (Hub) and run it from an ActiveGate (remote) or the OneAgent on its host (local), as the
  extension page describes.", "Use the Databases app to analyze database servers and their top statements.", "For
  databases, the Databases tab of this app checks the extension, the ActiveGate group and existing configurations, and
  can create the monitoring configuration." (see [databases.md](databases.md)). Documentation: the extension pages.

### Kubernetes: Operator injection

Manual (`kubernetesAction`, [ui/app/deepActions.ts](../ui/app/deepActions.ts#L87)); commands are filled with the target
pod's namespace (`KUBERNETES_NAMESPACE`), workload (`KUBERNETES_BASE_POD_NAME` without the trailing `-*`) and pod
(`KUBERNETES_FULL_POD_NAME`), or placeholders. Steps:

1. Check the pod's injection annotations: `oneagent.dynatrace.com/injected` and, when false, `oneagent.dynatrace.com/reason`.
2. Make sure the DynaKube injects into the namespace: cloudNativeFullStack or applicationMonitoring with a
   namespaceSelector that matches it (kube-*, openshift-* and the Operator's namespace are excluded by default).
3. Remove `oneagent.dynatrace.com/inject: "false"` (or `dynatrace.com/inject: "false"`) from the pod template; in opt-in
   mode add `oneagent.dynatrace.com/inject: "true"`.
4. Roll out the workload: the webhook only injects when a pod is created.

Variants:

```bash
# Check injection status
kubectl get pod checkout-5d9c7b-abcde -n my-namespace -o jsonpath='{.metadata.annotations.oneagent\.dynatrace\.com/injected}{" "}{.metadata.annotations.oneagent\.dynatrace\.com/reason}{"\n"}'
# Select the namespace (label)
kubectl label namespace my-namespace dt-monitoring=true --overwrite
# Roll out
kubectl rollout restart deployment/checkout -n my-namespace
# Operator troubleshoot
kubectl exec deploy/dynatrace-operator -n dynatrace -- dynatrace-operator troubleshoot
```

```yaml
# DynaKube namespaceSelector
spec:
  oneAgent:
    cloudNativeFullStack:   # or applicationMonitoring
      namespaceSelector:
        matchLabels:
          dt-monitoring: "true"
# Pod template annotation
spec:
  template:
    metadata:
      annotations:
        oneagent.dynatrace.com/inject: "true"   # remove any "false" value
```

Notes: reasons on `oneagent.dynatrace.com/reason`: NoBootstrapperConfig, NoMutationNeeded, OwnerLookupFailed,
MissingTenantUUID, DynaKubeStatusNotReady; container monitoring rules are not supported with cloud-native full-stack
(use the DynaKube namespace selector instead); the Operator appends its library to `LD_PRELOAD` (set it in the manifest,
not in the image); Go static monitoring is only partially supported in these modes. Documentation: Configure monitoring
for namespaces and pods, Pod mutations, Kubernetes full-stack observability, Kubernetes application observability,
Kubernetes troubleshooting. The [Kubernetes page](kubernetes.md) diagnoses the Operator side in detail.

### Restart the <technology> process

Manual (`restartAction`, [ui/app/deepActions.ts](../ui/app/deepActions.ts#L52)), offered for every technology with a
code module. When the diagnosis inferred the restart (the *Restart likely required* or *Code module older than OneAgent*
check), the form starts with the **Confirm this on the process page first** box (see
[Remediation actions section](#remediation-actions-section)). Steps:

1. Restart the process (stop and start; a reload is not enough): the code module is loaded at process start.
2. Wait about a minute, then use Diagnose again: the instance should now report a code module.
3. If it still has none, check OneAgent health on the host (Process restart needed / incompatible module).

Variants, chosen from the target:

| Situation | Variant | Command |
| --- | --- | --- |
| Kubernetes | Kubernetes (roll out) | `kubectl rollout restart deployment/<workload> -n <namespace>` (comment: `kubectl rollout restart statefulset/<name> -n <namespace>` for StatefulSet / DaemonSet) |
| Docker / Podman container (not Kubernetes) | Docker or Podman | `docker restart <container name>` / `podman restart <container name>` |
| Apache HTTP Server | Apache (Linux) | `sudo apachectl stop` then `sudo apachectl start   # a full stop/start; apachectl restart or graceful is not enough` |
| | Apache (Windows) | `httpd.exe -k stop -n "Apache2.4"` then `httpd.exe -k start -n "Apache2.4"` |
| IIS, IIS app pool | IIS app pool | `Import-Module WebAdministration` then `Restart-WebAppPool -Name "<app pool>"` |
| | IIS (all sites) | `iisreset /restart` |
| NGINX | NGINX (systemd) | `sudo systemctl restart nginx   # nginx -s reload keeps the master process, so it is not enough` |
| Anything else on Windows | Windows service | `Restart-Service -Name "<service name>"` |
| Anything else | Linux (systemd) | `sudo systemctl restart <service name>` |

Notes: "Processes running when OneAgent was installed only report CPU and memory until they are restarted.", "Stopping
or disabling OneAgent does not unload an injected code module; it stays until the process restarts.", plus the
technology notes. Documentation: Troubleshoot deep-monitoring issues, Process deep monitoring, OneAgent health (and
Troubleshoot OneAgent installation for Apache), plus the technology pages.

For IBM CICS the action is **Check the CICS module installation** instead: "Make sure ZDTPLT is in the PLTPI list (or
enable it with the DTAX transaction: DTAX ENABLE).", "Add the SZDTLOAD library to DFHRPL and the Dynatrace CSD group to
the group list.", "Check the zDC is running (message ZDTP004W means it is unavailable): start it, then run DTAX ENABLE.",
"Keep the CICS module version at or below the zRemote version."; variant `DTAX ENABLE`; notes "CICS TS 6.2: DFHBPZDT
must be present at startup.", "Add ZDTSOAPH to SOAP / JSON pipelines that should be traced.", "Xpediter storage
protection can block the module."; documentation Install the CICS module, Mainframe technology support.

### Generic: Restart processes after installing OneAgent

Shown before a selection. Steps: "Processes that were running when OneAgent was installed have no code module until they
restart.", "Find them with the search above (Deep monitoring: Not deep monitored), restart them in a maintenance window,
then check again.", "On Kubernetes, roll out the workloads; on IIS, recycle the app pools; for Apache, stop and start
(restart is not enough)." Variants: `sudo systemctl restart <service name>`, `Restart-Service -Name "<service name>"`,
`kubectl rollout restart deployment/<workload> -n <namespace>`. Documentation: Troubleshoot deep-monitoring issues,
Process deep monitoring.

### Documentation for this fix

Every action ends with **Documentation for this fix:** and one link per page (de-duplicated): the pages for the
mechanism (below), then the technology's Dynatrace pages and vendor policy (catalogue column *Docs*). The mechanism pages
are `DEEP_DOCS` in [ui/app/deepTech.ts](../ui/app/deepTech.ts#L164):

| Key | Page |
| --- | --- |
| `deepMonitoring` | [Process deep monitoring](https://docs.dynatrace.com/docs/observe/infrastructure-observability/process-groups/configuration/pg-monitoring) |
| `troubleshoot`, `restart` | [Troubleshoot deep-monitoring issues](https://docs.dynatrace.com/docs/ingest-from/dynatrace-oneagent/oneagent-troubleshooting/troubleshoot-oneagent-deep-monitoring-issues) |
| `pgMonitoring` | [Schema: process group monitoring](https://docs.dynatrace.com/docs/dynatrace-api/environment-api/settings/schemas/builtin-process-group-monitoring-state) |
| `hostPgMonitoring` | [Schema: process group monitoring on a host](https://docs.dynatrace.com/docs/dynatrace-api/environment-api/settings/schemas/builtin-host-process-groups-monitoring-state) |
| `processMonitoring` | [Schema: automatic deep monitoring](https://docs.dynatrace.com/docs/dynatrace-api/environment-api/settings/schemas/builtin-process-process-monitoring) |
| `customRules` | [Schema: custom process monitoring rules](https://docs.dynatrace.com/docs/dynatrace-api/environment-api/settings/schemas/builtin-process-custom-process-monitoring-rule) |
| `builtinRules` | [Schema: built-in process monitoring rules](https://docs.dynatrace.com/docs/dynatrace-api/environment-api/settings/schemas/builtin-process-built-in-process-monitoring-rule) |
| `containers` | [Schema: container monitoring](https://docs.dynatrace.com/docs/dynatrace-api/environment-api/settings/schemas/builtin-container-technology) |
| `containerRules` | [Schema: container monitoring rules](https://docs.dynatrace.com/docs/dynatrace-api/environment-api/settings/schemas/builtin-container-monitoring-rule) |
| `monitoringModes` | [OneAgent monitoring modes](https://docs.dynatrace.com/docs/platform/oneagent/monitoring-modes/monitoring-modes) |
| `health` | [OneAgent health](https://docs.dynatrace.com/docs/ingest-from/dynatrace-oneagent-classic/oneagent-health) |
| `features` | [OneAgent features](https://docs.dynatrace.com/docs/ingest-from/dynatrace-oneagent/oneagent-features) |
| `techSupport` | [Technology support](https://docs.dynatrace.com/docs/ingest-from/technology-support) |
| `endOfSupport` | [End-of-support news](https://docs.dynatrace.com/docs/whats-new/technology/end-of-support-news) |
| `installTroubleshoot` | [Troubleshoot OneAgent installation](https://docs.dynatrace.com/docs/ingest-from/dynatrace-oneagent/oneagent-troubleshooting/troubleshoot-oneagent-installation) |
| `goEnable` | [Enable Go monitoring](https://docs.dynatrace.com/docs/ingest-from/technology-support/application-software/go/configuration-and-analysis/enable-go-monitoring) |
| `k8sAnnotate` | [Configure monitoring for namespaces and pods](https://docs.dynatrace.com/docs/ingest-from/setup-on-k8s/guides/deployment-and-configuration/monitoring-and-instrumentation/annotate) |
| `k8sMutation` | [Pod mutations](https://docs.dynatrace.com/docs/ingest-from/setup-on-k8s/reference/workload-mutation) |
| `k8sFullStack` | [Kubernetes full-stack observability](https://docs.dynatrace.com/docs/ingest-from/setup-on-k8s/how-it-works/cloud-native-fullstack) |
| `k8sAppMon` | [Kubernetes application observability](https://docs.dynatrace.com/docs/ingest-from/setup-on-k8s/how-it-works/application-monitoring) |
| `k8sTroubleshoot` | [Kubernetes troubleshooting](https://docs.dynatrace.com/docs/ingest-from/setup-on-k8s/deployment/troubleshooting) |
| `otel` | [OpenTelemetry](https://docs.dynatrace.com/docs/ingest-from/opentelemetry) |
| `otlp` | [OTLP API endpoints](https://docs.dynatrace.com/docs/ingest-from/opentelemetry/otlp-api) |

The Monitored technologies switch fixes cite the schema page of their switch (Schema: monitor Java / Go / Python /
Node.js / PHP / .NET / IIS / Apache / NGINX under `…/settings/schemas/builtin-monitored-technologies-<tech>`). When the
docs-freshness check finds that a cited page changed after the review, the row gets a notice above it and a marker on
the link (see below).

## Docs freshness: keeping the guidance current

The supported versions, blockers, steps and commands on this tab (and on the Kubernetes, ActiveGates, Databases,
Extensions and Service Detection v2 tabs) were written from the Dynatrace docs. They are not rewritten automatically,
because parsing docs pages into remediation logic would be unsafe, but the app detects when a cited page changes.

**The pieces:**

| Piece | Role |
| --- | --- |
| `DOC` in [ui/app/deepTech.ts](../ui/app/deepTech.ts#L24) | The catalogue of every page the guidance cites: 129 entries, 123 distinct `https://docs.dynatrace.com/` URLs (the rest are vendor pages). |
| `DOC_SECTIONS` in [ui/app/deepTech.ts](../ui/app/deepTech.ts#L22) | Docs sections watched for pages that are not cited yet: currently *Service Detection v2* (`…/services/service-detection/service-detection-v2`). |
| [ui/app/deepDocsSnapshot.json](../ui/app/deepDocsSnapshot.json) | `reviewed` (the date of the last review, currently `2026-10-24`, shown as "Guidance reviewed against the Dynatrace docs on …") and `pages`: the sitemap `lastmod` of every cited page and every page in the watched sections at that review. |
| [api/docs-freshness.function.ts](../api/docs-freshness.function.ts) | App function that reads the live docs sitemap. The browser cannot read docs.dynatrace.com directly (no CORS). |
| [ui/app/deepDocs.ts](../ui/app/deepDocs.ts) | Calls the function once per page load, compares, and exposes the result to every tab (`useDocsFreshness`, `changedDocs`). |
| [scripts/check-deep-docs.mjs](../scripts/check-deep-docs.mjs) (`npm run check-docs`) | The same comparison for maintainers, and the command that records a new review. |

**The app function** (`docs-freshness`):

1. Input: `urls` (only strings starting with `https://docs.dynatrace.com/`, at most 300) and `prefixes` (same filter, at
   most 10, trailing slashes removed). The app sends all 123 catalogue URLs and the watched-section prefix.
2. `GET https://docs.dynatrace.com/docs/sitemap.xml` (one request; the sitemap has about 5,400 pages, about 1.3 MB, each
   with a `<lastmod>`).
3. If the fetch throws and the message matches `allowlist` or `NotCapable` (the runtime rejects hosts that are not
   allowlisted with "NotCapable: Blocked request to '<host>' (host not in allowlist)"), it returns
   `{status: "blocked", message}`; any other exception returns `{status: "error", message}`; a non-OK response returns
   `{status: "error", message: "The docs sitemap returned HTTP <code>."}`.
4. Otherwise it parses every `<loc>…</loc>` followed by `<lastmod>…</lastmod>` (trailing slashes removed from URLs) and
   returns `{status: "ok", checkedAt: <now ISO>, pages, sections}`: `pages` maps each requested URL to its `lastmod`, or
   `null` when the URL is not in the sitemap (moved or removed); `sections` maps every sitemap page under a prefix to its
   `lastmod` (at most 200 pages).

**The comparison in the browser** (`toState`, [ui/app/deepDocs.ts](../ui/app/deepDocs.ts#L42)), over the section pages
and the requested pages:

| Condition | Result |
| --- | --- |
| `lastmod` is null | *missing*: "no longer in the docs (moved or removed)" |
| `lastmod` later than the snapshot date (string comparison of the ISO timestamps) | *updated* with the new date: "updated YYYY-MM-DD" |
| Cited page with a `lastmod` but no snapshot entry (cited after the last review) | *updated* with its date |
| A snapshot page in a watched section, not cited, and no longer under the prefix in the sitemap | *missing* |
| A page under a watched prefix that is neither cited nor in the snapshot | listed as a **new page** (used by the Service Detection v2 tab) |

**One check per page load:** the first component that needs the result starts the call; every other component (on any
tab) shares the same promise. **Retry** (in the status line) clears it, sets every subscriber back to "Checking…", and
calls the function again. If `functions.call` fails, the HTTP response is inspected: 404 gives "the docs-freshness app
function is not available in this running app (HTTP 404). App functions are loaded when npx dt-app dev starts and when
the app is deployed: restart the dev server (or deploy), then retry."; other codes give "the docs-freshness app function
returned HTTP <code>: <first 300 characters of the body>".

**Where it shows on this tab:**

- **Status line** in the Remediation actions header (see [Remediation actions section](#remediation-actions-section)).
  The number of changed pages counts every change in the catalogue, including pages cited only by other tabs and
  watched-section pages.
- **Documentation for this fix** row (`DocsRow`): when any page of the selected action changed, a notice above the links:
  "Dynatrace changed 2 pages behind this fix after this guidance was reviewed (2026-10-24): Process deep monitoring
  (updated 2026-11-03), Pod mutations (no longer in the docs (moved or removed)). Check them before acting; the steps
  above may be out of date." Each affected link also gets " · updated 2026-11-03" or " · no longer in the docs (moved or
  removed)" in amber.
- **Technology support notice** in the diagnosis (`TechDocsNotice`): when a Dynatrace page of the target technology
  changed, the supported-version check may be out of date (vendor pages are not checked).

**For maintainers:** `npm run check-docs` (run from the app folder) reads the catalogue straight from `deepTech.ts`,
fetches the sitemap and prints `UPDATED` (old date -> new date), `NOT FOUND` (moved or removed), `NEW` (cited but not in
the snapshot) and `NEW PAGE` (in a watched section, not cited) lines; it exits with code 1 when there is anything to
review, so it can run in CI or on a schedule. After reading the pages and updating `deepTech.ts` / `deepActions.ts` /
`sdv2.ts`, `npm run check-docs -- --accept` writes today's date and the current `lastmod` of every cited and
watched-section page into `deepDocsSnapshot.json` (it refuses while a cited URL is missing from the sitemap). Vendor
pages (nodejs.org, go.dev, ...) have no sitemap date and are not tracked.

## AI Assist on this page

`analyzeDeepMonitoring(scored, notScored, selection)` in [ui/app/analyses.ts](../ui/app/analyses.ts#L508). It is
rule-based, runs in the browser on the data already on screen (the coverage rows and the current diagnosis), and is only
computed while the panel is open. Severity helper: `good` at 90 % or more, `warning` from 50 %, otherwise `critical`.

**No scored processes** (sum of `total` = 0): summary "No processes of a technology OneAgent can deep monitor were found
for this timeframe."; insight (info) "No process group instances returned. Widen the timeframe or confirm OneAgent is
installed in Full-Stack mode."; recommendation (medium) "Install OneAgent in Full-Stack mode on application hosts,
restart the applications, then re-check."

**Otherwise:**

- **Summary:** "<deep> of <total> processes of deep-monitorable technologies (<overall>%) have a OneAgent code module
  across N technologies. M technologies are fully covered." (`overall` = `round(deep / total * 100)` over scored rows;
  fully covered = `deep == total`).

| Insight | Condition | Severity |
| --- | --- | --- |
| "Overall deep monitoring coverage is X%." | always | by `overall` |
| "Largest gap: N <technology> processes without a code module (P% covered)." | the technology with the most instances without a code module, if it has any | by that technology's percentage |
| "No code module at all: <technology> (n), …" (first 5) | technologies with `deep` = 0 | critical |
| "Not scored (no OneAgent code module): <technology> (n), …" (first 5, "…" if more) | unscored technologies exist | info |
| "<name> is deep monitored." | a diagnosis is open and every instance has a code module | good |
| "<name>: blocked by <failing check titles, lower case>." | a diagnosis is open, not deep monitored, with failing checks (other than *injected*) | critical |
| "<name>: nothing in the settings blocks injection; restart the process." | a diagnosis is open, not deep monitored, no failing check | warning |

| Recommendation | Condition | Impact |
| --- | --- | --- |
| "Search for <technology> processes that are not deep monitored and run Diagnose on the biggest process group; the remediation section shows the setting that blocks it." | the largest gap exists | high |
| "Most gaps without a blocking setting are processes started before OneAgent was installed: restart them (or roll out the pods) to inject the code module." | always | medium |
| "Cover technologies without a code module with OpenTelemetry or an extension instead." | unscored technologies exist | low |

The selection insight is cleared by **Clear selection**.

## Limitations and edge cases

- **Derived, not reported.** Grail has no per-process injection or restart flag. *Restart required* means "nothing the
  app can read blocks injection"; confirm on the process page (the *Confirm first* links) before restarting.
- **Evidence window.** An injected process that, within the timeframe, has no `installerVersion`, no service detected by
  a code module and no `dt.runtime.*` metric series is counted as not deep monitored. Runtime metrics on a host in
  Infrastructure or Discovery mode do not count. Runtime metrics are read from at most the last 10 days, also on the
  30-day timeframe.
- **Longer timeframes** include instances that no longer run (for example before a restart that injected them, or
  decommissioned hosts); such an old instance can still show as not deep monitored.
- **Unevaluable rule conditions.** Conditions on environment variables and Go binary linkage are not in the reported
  metadata; those rules never decide here (listed as *could not be checked*), and built-in rule -47 never matches, so a
  static Go binary is only flagged by the *Go static monitoring off* hint. Condition matching is a case-sensitive string
  comparison on the reported metadata values.
- **Host scope caps.** Host-level objects (host process-group overrides, Monitored technologies host objects, container
  injection host objects) are read for at most 50 hosts in Diagnose and 150 in the Processes view (hosts of instances
  without a code module first). For hosts beyond the cap the app behaves as if they had no host object. Scopes are sent
  in chunks of 80; a group spread over very many host groups needs more than one GET.
- **Target-only checks.** For a process group, the technology, minimum OneAgent version, Monitored technologies switch,
  .NET Core, Go static and container injection checks use the target instance only (the first instance without a code
  module); instances on other hosts may differ.
- **Row limits.** Search: 150 rows sorted by name (the Status filter only filters these). Diagnose: 200 instances per
  group. IIS workers: 50 rows on at most 50 hosts.
- **Search results do not follow the timeframe.** The search query is built when you click the button; change the
  timeframe and search again. The coverage gauges and an open diagnosis do follow it.
- **After a fix** only the settings are re-read. The code-module evidence of the instances does not change until the
  process restarts and you diagnose or search again.
- **Group view filters** apply to instances before grouping, so a group's counts can be lower than its real instance
  count. The *Versions* column shows the raw `jvmClrVersion` / `appVersion`, not the parsed version of the Processes
  view.
- **Container runtimes** are detected only from `CONTAINERD`, `CRIO`, `DOCKER`, `PODMAN` and `GARDEN` software
  technologies; BOSH Process Manager and Winc are never detected, so their injection switches are never checked.
- **Unknown process types** (not in the catalogue) are scored, with "support not confirmed".
- **IIS service hosts** (`svchost.exe` / `inetinfo.exe`) are never scored; the diagnosis points to the `w3wp.exe`
  workers on the same hosts.
- **OTLP endpoint** in the OpenTelemetry steps is always `https://<environment-id>.live.dynatrace.com/api/v2/otlp`; on
  environments served from another domain, adjust it.
- **Docs freshness coverage.** Only `docs.dynatrace.com` pages in `DOC` are checked. Vendor pages are not, and neither are
  the three pages the Full-Stack and OneAgent-update actions cite from [ui/app/remediation.ts](../ui/app/remediation.ts)
  (Enable OneAgent monitoring modes, oneagentctl reference, OneAgent update).
- **Process group monitoring read failures** in the Process groups view leave the *Deep monitoring setting* column at
  "…" without an error message.

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| Red "Query failed" box under the gauges, search or diagnosis | Missing app scope or user permission for `dt.entity.*`, `metric.series` or Smartscape | Check the scopes in [App scopes](#app-scopes-used-by-this-page) and the user's Grail read permissions. |
| "No processes of a deep-monitorable technology found for this timeframe." | No OneAgent process data in the window | Widen the timeframe; confirm OneAgent is installed and reporting. |
| A technology is missing from the *Technology* dropdown | The dropdown lists only technologies the coverage query found in the timeframe; Dynatrace components are excluded | Widen the timeframe, or search with *Any technology*. |
| Status shows "—" and "Status unavailable: could not read the monitoring settings (…)" | No `settings:objects:read` for the user, or the Settings API rejected the request | Grant settings read; the rest of the row is still valid. |
| Diagnosis says "Could not read the monitoring settings (…); setting checks are incomplete." | Same | The checks were evaluated as if every setting were at its default; fix the permission and diagnose again. |
| "The selected process was not found in this timeframe." | The timeframe changed and the process did not run in the new window | Switch back to a longer timeframe or select another process. |
| No *Process ↗* link | No Smartscape process node matched the classic instance | Use *Process group ↗* or the classic process page from *Confirm first*. |
| *Restart required*, but the process was restarted | The new evidence is not in the window yet, or OneAgent reports a problem the settings do not show | Open the *Confirm first* links (process page, OneAgent diagnostics); search again after the process reported traffic or metrics. |
| *Not monitored on purpose (built-in rule …)* | A built-in rule excludes tooling processes (npm, pip, PHP CLI, …) | Usually intended. To monitor it anyway, set the process group to Monitor or add a custom Monitor rule. |
| "N custom rules could not be checked" | Rules on environment variables (or other unreported properties) | Check the variable on the host; disable the rule in Settings if it is the blocker. |
| Apply fails with "Rejected (HTTP 4xx)", "N of M rejected: …" or a permission message | The user lacks `settings:objects:write` for that schema, the value failed schema validation, or the object changed since it was read (stale `updateToken`) | Use *Validate* to see the message; check the user's settings write policy; *Clear selection* and Diagnose again to re-read the objects. |
| *Enable deep monitoring for the process group* fails on POST | The group already has an object | The app retries with PUT automatically when it read the object; if the PUT fails too, the PUT error is shown. |
| "Automatic docs check off: add docs.dynatrace.com to the allowed outbound connections" | `builtin:dt-javascript-runtime.allowed-outbound-connections` is enforced without docs.dynatrace.com | Add the host (setting link in the status line), then **Retry**. |
| "Docs check failed: the docs-freshness app function is not available in this running app (HTTP 404)…" | The function was added after `npx dt-app dev` started, or the deployed version predates it | Restart the dev server or deploy, then **Retry**. |
| "Docs check failed: The docs sitemap returned HTTP <code>." | docs.dynatrace.com was unavailable | **Retry** later. |
| A fix's documentation row says pages changed after the review | Dynatrace updated a cited page | Read the page before acting; maintainers run `npm run check-docs` and update the catalogue. |

## Related pages

- [Index](README.md): the app shell, gauges, query actions, remediation building blocks.
- [OneAgents](oneagents.md): OneAgent versions, monitoring modes and the update policy (the *Full-Stack* and *update*
  fixes here are the same mechanisms).
- [Kubernetes](kubernetes.md): Dynatrace Operator and injection per workload; its diagnosis points back to this tab for
  process-level settings.
- [Databases](databases.md): extension coverage for the database technologies this tab does not score.
- [Extensions](extensions.md), [ActiveGates](activegates.md): use the same Action picker, API fix form and docs status
  line.
- [Service Detection v2](service-detection-v2.md): uses the same docs-freshness check, including the watched section.

## Source files

| File | Role on this page |
| --- | --- |
| [ui/app/tabs/DeepMonitoringTab.tsx](../ui/app/tabs/DeepMonitoringTab.tsx) | The tab: gauges, search, results tables, Status column, remediation section, API fix forms, action picker, docs status line and notices. |
| [ui/app/deepMonitoring.ts](../ui/app/deepMonitoring.ts) | `toInstance`, the settings read (16 schemas), effective-setting resolution, rule evaluation, `decide`, `diagnose`, `processStatus`, Monitor rule candidates, Settings API writes, settings links. |
| [ui/app/deepTech.ts](../ui/app/deepTech.ts) | `DOC` docs catalogue, `DEEP_DOCS`, technology catalogue, supported-version rules, Monitored technologies switches, the 82 built-in rules. |
| [ui/app/deepActions.ts](../ui/app/deepActions.ts) | Manual actions: restart, CICS, Kubernetes, upgrade, OpenTelemetry, extension, generic actions. |
| [ui/app/queries.ts](../ui/app/queries.ts#L770) | The five DQL queries and their shared building blocks. |
| [ui/app/deepDocs.ts](../ui/app/deepDocs.ts) | Docs-freshness client: one call per page load, comparison with the snapshot, retry. |
| [ui/app/deepDocsSnapshot.json](../ui/app/deepDocsSnapshot.json) | Review date and the `lastmod` of every cited page at that review. |
| [api/docs-freshness.function.ts](../api/docs-freshness.function.ts) | App function that reads the docs sitemap. |
| [scripts/check-deep-docs.mjs](../scripts/check-deep-docs.mjs) | `npm run check-docs` and `-- --accept`. |
| [ui/app/analyses.ts](../ui/app/analyses.ts#L508) | `analyzeDeepMonitoring` for AI Assist. |
| [ui/app/remediation.ts](../ui/app/remediation.ts) | `buildModeBody` / `setMonitoringModes` (Full-Stack fix), the oneagentctl and update manual actions, `errorMessage`. |
| [ui/app/RemediationPanel.tsx](../ui/app/RemediationPanel.tsx) | Shared `Field`, `Request`, `ResultLine` and `ManualActionView` components. |
| [ui/app/links.ts](../ui/app/links.ts) | Entity overview links, *Confirm first* links, `dt.timeframe` payload. |
| [ui/app/components.tsx](../ui/app/components.tsx) | `PctGauge`, `QueryActions`, `QueryState`, `statusColor`. |
| [ui/app/useDql.ts](../ui/app/useDql.ts) | DQL execution hook. |
| [app.config.json](../app.config.json) | App scopes. |
