# ActiveGates

The ActiveGates tab lists every environment ActiveGate in the tenant: routing and monitoring, synthetic and zRemote, host-based and containerized. For each one it shows which modules are enabled and whether they are used, its self-monitoring data (rejected, dropped and resent messages, outgoing queue, heap, disk, CPU, AWS and Kubernetes module metrics), the extension configurations that run on ActiveGate groups, its version compared with the target version, its update mode, when its token expires, and its ActiveGate group and network zone. A network zone map shows where each zone's OneAgents send traffic, and you can simulate outages on it. You can collect support archives (logs), and a Diagnose flow checks one ActiveGate and offers fixes, some through the API and some as manual steps.

| | |
| --- | --- |
| Area | Visibility (see [index](README.md)) |
| Tab id | `activegates` |
| Counts toward Entity Overview readiness / Top findings | no. Nothing on this tab feeds Entity Overview readiness or Top findings. |
| Main source files | [ActiveGatesTab.tsx](../ui/app/tabs/ActiveGatesTab.tsx), [activeGates.ts](../ui/app/activeGates.ts), [AgCharts.tsx](../ui/app/tabs/AgCharts.tsx), [NetworkZoneMap.tsx](../ui/app/tabs/NetworkZoneMap.tsx), [queries.ts](../ui/app/queries.ts) (ActiveGates block), [analyses.ts](../ui/app/analyses.ts) (`analyzeActiveGates`) |

## Contents

- [What this page answers](#what-this-page-answers)
- [Before you start](#before-you-start)
- [Page walkthrough](#page-walkthrough)
  - [Summary gauges](#summary-gauges)
  - [Donuts: version, update mode, deployment](#donuts-version-update-mode-deployment)
  - [Modules by ActiveGate (module matrix)](#modules-by-activegate-module-matrix)
  - [Messages: rejected, dropped, resent](#messages-rejected-dropped-resent)
  - [ActiveGates table](#activegates-table)
  - [ActiveGate groups](#activegate-groups)
  - [Network zones](#network-zones)
  - [Module self-monitoring](#module-self-monitoring)
  - [Extensions on ActiveGate groups](#extensions-on-activegate-groups)
  - [Extension warnings and errors](#extension-warnings-and-errors)
  - [ActiveGate logs (support archive)](#activegate-logs-support-archive)
  - [Remediation actions and Diagnose](#remediation-actions-and-diagnose)
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

- Which environment ActiveGates exist, and which of them are connected (seen by Smartscape in the last 20 minutes)?
- Are the ActiveGates on a supported version? The tab compares each version with the Fleet Management target version. Fleet Management warns when an ActiveGate is more than five versions behind, and releases go up by 2 (1.343, 1.345, 1.347).
- Are automatic updates on for host-based ActiveGates? The Update ActiveGate docs do not recommend turning them off.
- Are any ActiveGate tokens expired, or expiring within 30 days? The ActiveGate security docs call a token with 30 or fewer days left "Expiring".
- Is data being lost? Rejected messages mean authorization problems and data loss. Dropped messages mean timeouts and possible data loss. Resent messages are an early warning.
- Is the ActiveGate short of resources (heap, disk, CPU)?
- Which modules are enabled, and does each one show activity, or is it enabled with nothing running on it?
- Do the extension monitoring configurations assigned to ActiveGate groups run? Are there groups that no ActiveGate with the Extensions module picks up?
- How are network zones set up (fallback mode, alternative zones), and where does each zone's OneAgent traffic go when ActiveGates fail?
- How do I collect an ActiveGate's logs (support archive)?

The documentation the code cites is catalogued in `DOC` in [deepTech.ts](../ui/app/deepTech.ts):
[ActiveGate self-monitoring metrics](https://docs.dynatrace.com/docs/ingest-from/dynatrace-activegate/activegate-sfm-metrics),
[ActiveGate diagnostics](https://docs.dynatrace.com/docs/ingest-from/dynatrace-activegate/activegate-diagnostics),
[agctl](https://docs.dynatrace.com/docs/ingest-from/dynatrace-activegate/agctl-command-line-interface),
[ActiveGate directories](https://docs.dynatrace.com/docs/ingest-from/dynatrace-activegate/configuration/where-can-i-find-activegate-files),
[Configuration properties and parameters of ActiveGate](https://docs.dynatrace.com/docs/ingest-from/dynatrace-activegate/configuration/configure-activegate),
[Containerized ActiveGate configuration](https://docs.dynatrace.com/docs/ingest-from/dynatrace-activegate/activegate-in-container/configuration),
[ActiveGate purposes and functionality](https://docs.dynatrace.com/docs/ingest-from/dynatrace-activegate/capabilities),
[Stop or restart ActiveGate](https://docs.dynatrace.com/docs/ingest-from/dynatrace-activegate/operation/stop-restart-activegate),
[Update ActiveGate](https://docs.dynatrace.com/docs/ingest-from/dynatrace-activegate/operation/update-activegate),
[ActiveGate security (tokens)](https://docs.dynatrace.com/docs/ingest-from/dynatrace-activegate/activegate-security),
[Fleet Management](https://docs.dynatrace.com/docs/ingest-from/fleet-management),
[ActiveGate health overview](https://docs.dynatrace.com/docs/ingest-from/fleet-management/activegate-health-overview),
[Auto-update for Dynatrace Operator managed components](https://docs.dynatrace.com/docs/ingest-from/setup-on-k8s/guides/deployment-and-configuration/updates-and-maintenance/auto-update-components),
[Size Dynatrace ActiveGates in Kubernetes](https://docs.dynatrace.com/docs/ingest-from/setup-on-k8s/guides/deployment-and-configuration/resource-management/ag-resource-limits),
[Kubernetes monitoring issues](https://docs.dynatrace.com/docs/ingest-from/setup-on-k8s/deployment/troubleshooting/monitoring-troubleshooting),
[DynaKube parameters](https://docs.dynatrace.com/docs/ingest-from/setup-on-k8s/reference/dynakube-parameters),
[About Extensions](https://docs.dynatrace.com/docs/ingest-from/extensions/concepts),
[Manage extensions](https://docs.dynatrace.com/docs/ingest-from/extensions/manage-extensions),
[Extensions health](https://docs.dynatrace.com/docs/observe/infrastructure-observability/extensions/extensions-health),
[Semantic dictionary: dt.extension.status](https://docs.dynatrace.com/docs/semantic-dictionary/fields),
[Monitor AWS with CloudWatch metrics](https://docs.dynatrace.com/docs/ingest-from/amazon-web-services-classic/integrate-with-aws/cloudwatch-metrics),
[Limit API calls to AWS using tags](https://docs.dynatrace.com/docs/ingest-from/amazon-web-services-classic/integrate-with-aws/cloudwatch-metrics/limit-api-calls-to-aws-using-tags),
[Remote configuration management](https://docs.dynatrace.com/docs/ingest-from/bulk-configuration),
[Get started with network zones](https://docs.dynatrace.com/docs/manage/network-zones/network-zones-basic-info),
[OneAgent connectivity in network zones](https://docs.dynatrace.com/docs/manage/network-zones/oneagent-connectivity).

## Before you start

### App scopes used by this page

| Scope | What this page uses it for |
| --- | --- |
| `storage:smartscape:read` | Smartscape `ACTIVEGATE`, `SYNTHETIC_ENGINE`, `ZREMOTE`, `K8S_CLUSTER` and `ONEAGENT` nodes (inventory, cluster names, OneAgents per network zone). |
| `storage:metrics:read` | ActiveGate self-monitoring metrics (`dt.sfm.active_gate.*`, `dt.sfm.server.aws.monitoring.status`), extension self-monitoring (`dt.sfm.extension.*`, including `dt.sfm.extension.status`), `dt.sfm.synthetic.engine_utilization`. |
| `storage:system:read` | Extension framework warnings and errors from `dt.system.events` (`EXTENSIONS_EVENT`). |
| `settings:objects:read` | Read `builtin:deployment.activegate.updates` (update mode), `builtin:networkzones.zones` (fallback, alternative zones) and `builtin:networkzones` (network zones on or off). |
| `settings:objects:write` | Set the update mode, a zone's fallback and alternative zones, and turn network zones on. |
| `fleet-management:activegates:read` | List the last update jobs of the ActiveGate you selected. |
| `fleet-management:activegates:write` | *Update now* (update job: validate and create), and the remote configuration job (validate, preview, run) that sets the ActiveGate group or network zone. |
| `fleet-management:activegates:download` | Read the target version (`/activegate/installer/version/target`). Nothing is downloaded. |
| `fleet-management:activegate.tokens:read` | Read ActiveGate token metadata (expiration date). |
| `fleet-management:activegate.support-archives:read` | List support archives and their status. |
| `fleet-management:activegate.support-archives:write` | Start collecting a support archive. |
| `fleet-management:activegate.support-archives:download` | Download a collected archive ZIP. |
| `fleet-management:activegate.support-archives:delete` | Cancel a running collection, or delete an archive. |

All of these are declared in [app.config.json](../app.config.json).

### User permissions

App scopes are not enough on their own. The signed-in user also needs the matching platform permissions:

- Reads: storage read permissions for Smartscape, metrics and system events, and `settings:objects:read` on the three schemas.
- Settings writes: `settings:objects:write` on `builtin:deployment.activegate.updates`, `builtin:networkzones.zones` and `builtin:networkzones`.
- Update jobs: `fleet-management:activegates:read` / `:write` (the SDK also accepts `environment:roles:manage-settings`).
- Remote configuration: `fleet-management:activegates:write` (or `environment:roles:viewer`, per the SDK docs).
- Tokens, target version and support archives: the matching `fleet-management:*` permissions. They are part of the default Admin User policy.

When a call returns 403, the tab names the scope the app needs: "Access denied (HTTP 403): the app needs the scope … and you need the matching permission." (`fleetError` in [activeGates.ts](../ui/app/activeGates.ts)).

### One-time setup

- No credential vault entries and no OAuth clients are needed.
- The *Documentation for this fix* freshness check (the `docs-freshness` app function) needs `docs.dynatrace.com` in the allowed outbound connections (`builtin:dt-javascript-runtime.allowed-outbound-connections`) when that allowlist is enforced. Without it, the remediation section says that the automatic docs check is off. Everything else on the tab still works.

## Page walkthrough

The tab receives the shell timeframe `tf` (24 hours by default, or 7 or 30 days). Every DQL query includes `from:now()-<tf>`, so changing the timeframe re-runs every query and clears any donut slice you selected. The data hook `useActiveGatesData` starts the following when the page opens:

- six DQL queries: inventory, self-monitoring (health), module detail, extension statuses, extension events, and OneAgents per zone;
- four API reads: update settings, network zone settings, target version, and ActiveGate tokens.

A failed API read does not block the page. It removes the checks that depend on it and says why.

The heading paragraph names the sources: Smartscape, the ActiveGate self-monitoring metrics, extension self-monitoring metrics and events, the Settings API, and the Fleet Management API.

At the top, the **AI Assist** panel appears when AI Assist is switched on in the header (see [AI Assist on this page](#ai-assist-on-this-page)).

The whole body, from the gauges down to the logs card, sits inside the inventory query's loading and error state. While it loads you see "Loading…". If it fails, a red "Query failed" box shows the error. The Remediation actions section is always rendered.

### Summary gauges

Six custom SVG gauges (`PctGauge`: red-to-green gradient, rounded integer percent). Percentages come from `pct(part, total)` = `Math.round(part / total * 100)`, and 0 when the total is 0. The gauges always use **all** ActiveGates; a donut slice does not filter them. Each gauge has an (i) button that scrolls to *Remediation actions*.

| Gauge | Numerator | Denominator | Detail line |
| --- | --- | --- | --- |
| ActiveGates connected | ActiveGates with `online` = true (`lastSeen >= now() - 20m`) | all ActiveGates | "X of Y seen in the last 20 min" |
| Within 5 releases of target | ActiveGates whose `releasesBehind(version, target) ?? 0 <= 5` | ActiveGates that report a version | "X of Y; target 1.347.60" (or "unknown") |
| Automatic updates | host-based ActiveGates (`!containerized`) whose effective update mode is not `MANUAL`. *Automatic during update window* counts as on. | host-based ActiveGates | "X of Y host-based ActiveGates". While the update settings load, or if they cannot be read, the gauge is replaced by the text "Reading the update settings…" or "Not readable: \<error\>". |
| No message loss | ActiveGates with a self-monitoring row whose summed `dropped` and `rejected` are both 0 or null. Resent messages do not count as loss. | ActiveGates that have a self-monitoring row | "X of Y without dropped or rejected messages" |
| Extension configurations OK | configurations with status `OK` or `IDLE` | every monitoring configuration on an ActiveGate group (extension status query) | "X of Y on ActiveGate groups". This gauge is hidden when there are no configurations. |
| Enabled modules in use | enabled modules (per ActiveGate) in state *in use* or *problems* | enabled modules in state *in use*, *problems* or *not in use*, that is, modules with an activity metric | "X of Y with an activity metric" |

Below the gauges: "Versions compared with the Fleet Management target version" (or "the newest version in this tenant (target version not readable)"), and "Releases go up by 2 (1.343, 1.345, 1.347)."

**DQL behind these gauges** (collapsed) has Show DQL / Copy / Open in Notebook / Add to Dashboard for three queries: inventory ([Q1](#q1-inventory-activegatesquery)), self-monitoring ([Q2](#q2-self-monitoring-per-activegate-activegatehealthquery)) and extension configurations ([Q4](#q4-extension-configurations-on-activegate-groups-activegateextensionsquery)).

**Target version.** The target is the Fleet Management target version ([API](#target-version)) when it can be read. Otherwise it is the newest version reported by any ActiveGate in the tenant, found with `compareVersions`, which compares the numeric parts split on `.` and `-`.

### Donuts: version, update mode, deployment

Three custom donuts (`Donut` in `ModePie.tsx`), 150 px wide, side by side on wide screens. Each slice has a fixed palette slot, so a category keeps its colour. Hovering a slice or a legend row highlights it, and the centre shows its count and label. A native tooltip shows "label: n (p%)".

**Clicking a slice filters the module matrix, the Messages charts and the ActiveGates table to that slice.** Clicking the same slice again clears the filter, as does **Show all** in the line "Showing N ActiveGates in the selected slice in the matrix, charts and table." Selecting a slice scrolls to the table. Gauges, groups, zones and every card below are not filtered.

| Donut | Slice key | Slices and colours |
| --- | --- | --- |
| ActiveGates by version | `1.<minor>` of `dt.active_gate.version` (`minorOf` = the second dotted part), or "Unknown" when there is no version | Sorted newest first. The 7 newest keys get palette slots 1 to 7; "Unknown" is neutral. Every older key is folded into a neutral **Older** slice. The target's key gets the suffix " (target)". Note: "Target 1.347.60; Fleet Management warns beyond 5 releases behind." |
| ActiveGates by update mode | containerized → `OPERATOR`. Host-based → the effective `updateMode` when the settings were read, else `UNKNOWN`. | Automatic (earliest convenience) slot 1; Automatic (during update window) slot 3; No automatic updates slot 2; Kubernetes: Dynatrace Operator slot 7; Not read neutral. Only non-empty slices are drawn. The note explains the effective mode ("the ActiveGate's own setting, else the environment one"), or shows the settings read error. |
| ActiveGates by deployment | `SYNTHETIC_ENGINE` type → Synthetic; `ZREMOTE` → zRemote; containerized → Kubernetes (Operator); otherwise Host-based (routing / monitoring) | Host-based slot 1, Kubernetes slot 7, Synthetic slot 3, zRemote slot 4 |

The effective update mode (`effectiveUpdate`) is taken from the first of these that exists:

1. the ActiveGate's own `builtin:deployment.activegate.updates` object, at scope `ENVIRONMENT_ACTIVE_GATE-<dt.active_gate.id without 0x, uppercase, left-padded to 16 hex digits>` (for example `0x1a2b3c4d` → `ENVIRONMENT_ACTIVE_GATE-000000001A2B3C4D`);
2. the `environment` object;
3. the schema default: `AUTOMATIC`, target `latest`.

An empty `updateMode` counts as `AUTOMATIC`.

### Modules by ActiveGate (module matrix)

A custom matrix (`ModuleMatrix` in [AgCharts.tsx](../ui/app/tabs/AgCharts.tsx)), inside the self-monitoring query's loading and error state.

- **Rows** are the filtered ActiveGates, sorted by type label (Environment ActiveGate, Synthetic, zRemote) and then by name (case-insensitive).
  - The row label is the name, with a red ● when the ActiveGate is not connected.
  - The sub-label is "type · group \<group\> · container".
  - The selected ActiveGate's row is tinted.
- **Columns** are the modules that at least one of the filtered ActiveGates reports in Smartscape `modules`.
  - Known modules come first, in the order of the table below, grouped under the headers Routing & ingest / Cloud & platform / Extensions & databases / Synthetic & mainframe / Operations. A header is shortened to Ingest / Cloud / Ext. & DB / Synth. / Ops when it does not fit.
  - Unknown module IDs follow, sorted alphabetically, in group Operations. Their label is the ID in sentence case.
  - The module labels are vertical, and hovering one shows "label: detail".
- **Cells** show a swatch with a glyph. The swatch is 24 px. Colours come from the status palette:

  | State | Label | Glyph and colour |
  | --- | --- | --- |
  | `active` | Enabled, in use | ✓ green `#0ca30c` |
  | `issue` | Enabled, with problems | ! red `#d03b3b` |
  | `idle` | Enabled, not in use | – amber `#fab219` |
  | `on` | Enabled (no activity metric) | • grey `#898781` |
  | `off` | Not enabled | empty, dashed outline |

- **Hover** a cell to see "\<module\> on \<ActiveGate\>", the state, and its text: the activity value with its unit, the problem text, or the module description.
- **Click** a row label or a cell to diagnose that ActiveGate. It is selected and the page scrolls to *Remediation actions*.
- **Footer** "In use / enabled", per module: used (`active` + `issue`) / enabled (any state except `off`).
- **Legend** above the matrix: every state with its count over all cells shown, `off` included.
- **Modules as a table (custom.properties keys)** (collapsed): one row per column module with Module (hover for its description), Group, a count for *in use*, *problems*, *not in use* and *enabled* (hover to see the ActiveGate names), and `custom.properties` as `[section] key`.

How a module's state is derived (`moduleState` in [activeGates.ts](../ui/app/activeGates.ts)):

1. Not in the ActiveGate's `modules` → `off`.
2. The module's problem rule returns something → `issue`.
3. The module has no activity metric → `on`.
4. The activity value is greater than 0 → `active`. The text is the rounded value plus its unit.
5. Otherwise → `idle`, with the text "Enabled, but no \<unit\> in the timeframe: not configured for this ActiveGate yet, or not needed here."

Every module, its activity metric and its problem rule:

| Module ID (Smartscape) | Label | Group | custom.properties | agctl name | Activity metric (from [Q2](#q2-self-monitoring-per-activegate-activegatehealthquery) unless noted) | Problem rule (→ *with problems*) |
| --- | --- | --- | --- | --- | --- | --- |
| `AGENT_ROUTING` | OneAgent routing | Routing & ingest | `[collector] MSGrouter` | `MSGrouter` | `agents` = max `dt.sfm.active_gate.communication.agent_modules.connected` (connected OneAgent modules, peak) | none |
| `ODIN_COLLECTOR` | ODIN collector | Routing & ingest | none | none | none (not rated) | none |
| `METRICS_INGEST` | Metrics ingest | Routing & ingest | `[metrics_ingest] metrics_ingest_enabled` | `metrics_ingest` | `grailAccepted` = sum `dt.sfm.active_gate.metrics.ingest.grail.datapoints.accepted` | `ingestRejected` > 0: "N data points rejected (up to 3 reasons from the `metrics.rejected` rows of Q3)" |
| `OTLP_INGEST` | OTLP ingest | Routing & ingest | `[otlp_ingest] otlp_ingest_enabled` | `otlp_ingest` | `otlpReceived` = sum `dt.sfm.active_gate.metrics.ingest.otlp.datapoints.received.total` | `otlpRejected` > 0: "N OTLP data points rejected (reasons from `otlp.rejected`)" |
| `LOG_ANALYTICS_COLLECTOR` | Log ingest | Routing & ingest | `[log_analytics_collector] log_analytics_collector_enabled` | none | none | none |
| `BEACON_FORWARDER` | RUM beacon forwarder | Routing & ingest | `[beacon_forwarder] beacon_forwarder_enabled` | none | `beacons` = sum `dt.sfm.active_gate.rum.beacon_forwarded_count` | none |
| `AWS_MONITORING` | AWS monitoring | Cloud & platform | `[aws_monitoring] aws_monitoring_enabled` | `aws_monitoring` | `awsRequests` = sum `dt.sfm.active_gate.aws.requests` | Any of: `awsLost` > 0 or any `aws.data_lost` row: "Some data lost (data_lost_monitoring_status = 1): service · data type · connection"; any `aws.requests` row with a status other than `ok`: "N failed requests of T (status n, …)"; `awsBad` > 0: "N elements retrieved but failed later (for example parsing)" |
| `AZURE_MONITORING` | Azure monitoring | Cloud & platform | `[azure_monitoring] azure_monitoring_enabled` | `azure_monitoring` | none | none |
| `VMWARE_MONITORING` | VMware monitoring | Cloud & platform | `[vmware_monitoring] vmware_monitoring_enabled` | none | none | none |
| `CLOUD_FOUNDRY` | Cloud Foundry monitoring | Cloud & platform | `[cloudfoundry_monitoring] cloudfoundry_monitoring_enabled` | none | none | none |
| `KUBERNETES` | Kubernetes monitoring | Cloud & platform | `[kubernetes_monitoring] kubernetes_monitoring_enabled` | none | `k8sQueries` = sum `dt.sfm.active_gate.kubernetes.api.query_count` | any `k8s.api_errors` row that is a real failure, that is, not 403 and not a 404 on a path containing `openshift.io`: "Kubernetes API calls failed: \<code path\> (n), …" |
| `EXTENSION_CONTROLLER` | Extensions (EEC) | Extensions & databases | `[extension_controller] extension_controller_enabled` | none | number of monitoring configurations whose latest status row carries this `dt.active_gate.id` ([Q4](#q4-extension-configurations-on-activegate-groups-activegateextensionsquery)) | configurations on this ActiveGate that are not `OK`/`IDLE`: "N monitoring configurations not OK: ext (status), …"; or `eecLinesRejected + eecLogsRejected` > 0: "N metric lines or log records rejected at ingest" |
| `DBINSIGHTS_ORACLE` | DB insights (Oracle) | Extensions & databases | `[dbAgent] dbAgent_enabled` | none | none | none |
| `MEMORY_DUMPS` | Memory dumps | Extensions & databases | `[memory_dumps] memory_dumps_enabled` | `memory_dumps` | none | none |
| `DEBUGGING` | Debugging | Extensions & databases | `[debugging] debugging_enabled` | none | none | none |
| `SYNTHETIC` | Synthetic monitoring | Synthetic & mainframe | `[synthetic] synthetic_enabled` (install only) | `synthetic` | `synthUtil` = avg `dt.sfm.synthetic.engine_utilization` (% engine utilization) | none |
| `ZREMOTE` | zRemote (mainframe) | Synthetic & mainframe | `[zremote] zremote_enabled` (install only) | none | `agents` (connected agent modules, peak) | none |
| `AUTOUPDATE` | Auto-update service | Operations | none | none | none | none |

Below the matrix is the empty state "No ActiveGates match."

### Messages: rejected, dropped, resent

Four small multiples (`BarList`), each with its own scale. Each one charts one measure from [Q2](#q2-self-monitoring-per-activegate-activegatehealthquery) for the filtered ActiveGates. Values are rounded, and only values above 0 are shown, largest first. Bar length is relative to the largest value in that chart, with a minimum of 2 %. All four charts use one colour, blue `#2a78d6` (light theme) or `#3987e5` (dark theme).

| Chart | Field | Explanation shown | Empty text |
| --- | --- | --- | --- |
| Messages rejected | `rejected` (sum) | Authorization issues; non-zero is data loss. | No message rejected. |
| Messages dropped | `dropped` (sum) | Timeouts; non-zero may be data loss. | No message dropped. |
| Messages resent | `resent` (sum) | Early warning: can end in dropped messages. | No message resent. |
| Outgoing queue (peak) | `queueMax` (max) | Growing = arriving faster than sent. | No queue reported. |

Hover a bar to see the name and the value with its unit. Click a bar to diagnose that ActiveGate. When a chart has nothing to show, it displays a green ✓ and its empty text.

### ActiveGates table

A Strato `DataTable` (sortable, resizable, line wrap, condensed) of the filtered ActiveGates. The **Filter** text box keeps rows whose name, group, network zone or version contains the text (case-insensitive). By default rows are sorted by status (Blocking, Check, Info, OK), then by the number of findings at that status (descending), then by name. All rows are shown; there is no paging. Below the table, QueryActions offers [Q2](#q2-self-monitoring-per-activegate-activegatehealthquery) ("ActiveGates: self-monitoring per ActiveGate").

| Column | Content | Source |
| --- | --- | --- |
| Status | coloured dot and Blocking / Check / Info / OK, plus "(n)" = number of checks at the worst status (not shown for OK). Blocking is bold red. | worst status of the [Diagnose checks](#checks-and-scoring) |
| ActiveGate | name (with "● " when not connected); below it the type label, and for containerized ActiveGates "· \<cluster name\> ↗", which links to the Kubernetes cluster page (intent `dynatrace.kubernetes` / `view-entity-dt.smartscape.k8s_cluster`, `nodeId` = cluster ID, with the timeframe). Without a cluster ID it shows the cluster name or "container". | Q1 `name`, `type`, `containerized`, `clusterName`, `clusterId` |
| Group | group or "—" | `dt.active_gate.group.name` |
| Network zone | zone or `default`; below it "fallback \<mode\>" (amber for None), with " (default)" when the zone has no settings object. The second line appears only when the zone settings were read. | `dt.network_zone.id`, zone settings |
| Version | `major.minor.revision`; below it "N releases behind" | `dt.active_gate.version`; `releasesBehind` |
| Updates | Automatic / Automatic (window) / Off (manual) / Operator / —; "own setting" when the mode comes from the ActiveGate's own object | effective update mode |
| Token | "—" (tokens not read) / "not listed" / "no expiry" / "expired" / "N days left" | token list joined on `dt.active_gate.auth_token.id` |
| Rejected, Dropped, Resent, Queue peak | rounded number or "—" (no data) | Q2 `rejected`, `dropped`, `resent`, `queueMax` |
| Heap | `round(100 × heapUsed / heapAvail)` % | Q2 averages |
| Disk free | `round(100 × volFree / volTotal)` % (lowest free / largest total) | Q2 |
| CPU peak | `round(sysCpu)` % | Q2 max `dt.sfm.active_gate.system.cpu_usage` |
| Modules in use | "used of enabled": used = modules in state *in use* or *problems*; enabled = every module the ActiveGate reports | module states |
| Extensions | "n OK · n not OK · n not picked up" or "—". *Not picked up* = configurations with status UNASSIGNED in the ActiveGate's group, counted only on members that have the Extensions module. | Q4 |
| (button) | **Diagnose** (shows **Selected** for the current ActiveGate): selects it and scrolls to Remediation actions | |

**Blocking / Check highlighting rule (`Hl`).** A cell is highlighted when at least one of the row's checks has status `fail` or `warn` and maps to that cell's column:

- red text on a red tint when any matching check is `fail` (Blocking);
- amber on an amber tint when the matching checks are only `warn` (Check).

Hover the cell to see "Blocking: \<title\>" / "Check: \<title\>". Info and OK checks never highlight a cell. How checks map to columns:

| Check id | Column | Can highlight? |
| --- | --- | --- |
| `online` | ActiveGate | red (not connected) |
| `version` | Version | amber (more than 5 releases behind) |
| `auto-update` | Updates | amber (No automatic updates) |
| `token` | Token | red (expired) / amber (30 days or less) |
| `rejected` | Rejected | red |
| `dropped` | Dropped | amber |
| `resent` | Resent | no (always Info) |
| `heap`, `disk`, `cpu` | Heap, Disk free, CPU peak | amber |
| `unassigned` | Extensions | red |
| `module-EXTENSION_CONTROLLER` | Extensions | amber |
| other `module-*` (AWS, Kubernetes, Metrics, OTLP) | Modules in use | amber |
| `idle`, `k8s-forbidden` | Modules in use | no (Info) |
| `group` | Group | no (always Info) |
| `zone` | Network zone | no (Info or OK) |

No check maps to the Queue peak column.

### ActiveGate groups

"Extensions run only on ActiveGates in a group, and every monitoring configuration targets one group." The table (`groupRows`) has one row per group name found on an ActiveGate or on an extension configuration ([Q4](#q4-extension-configurations-on-activegate-groups-activegateextensionsquery)). Rows are ordered by status, then by number of members (descending), then by name. It always covers all ActiveGates.

| Column | Meaning |
| --- | --- |
| Status | Blocking / Check / OK (rules below) |
| Group | group name |
| ActiveGates | "N: name, name" or "none" |
| With Extensions module | members with `EXTENSION_CONTROLLER`. Bold red when configurations target the group and the count is 0. |
| Extension configurations | count, plus "· n not OK (m not picked up)": red when some are not picked up, amber otherwise |
| Network zones | the members' zones (lowercase) |
| Finding | the rule's note |

Rules, evaluated in this order:

1. Configurations target the group and it has no members → **Blocking**: "N extension configurations target this group, but no ActiveGate is in it."
2. Configurations target the group and no member has the Extensions module → **Blocking**: "… but no ActiveGate in it has the Extensions module."
3. Any UNASSIGNED configuration → **Blocking**: "N configurations not picked up by any of the M ActiveGates with the Extensions module."
4. Any configuration not `OK`/`IDLE` → **Check**: "N configurations not OK."
5. Otherwise **OK**: "N extension configurations target this group." or "No extension configuration targets this group."

Empty state: "No ActiveGate group." The collapsed **Set the group of ActiveGates (API)** opens the [remote configuration form](#set-the-activegate-group-or-network-zone-remote-configuration) with *ActiveGate group* preselected.

### Network zones

The section heading **Network zones** explains: "OneAgents use ActiveGates of their own zone first, then its alternative zones, then (as the zone's fallback allows) the default zone and any other ActiveGate." Zones come from three places: the zone settings objects, what ActiveGates report, and what OneAgents report.

- If the zone settings cannot be read, you see "Network zone settings not readable: \<error\>" in red.
- If `builtin:networkzones` `enabled` is false, a notice says that **network zones are turned off** (Settings › Preferences › Network zones), so zone assignments and fallback modes do not route traffic yet.

#### Zone list (client side, `zoneRows`)

The zone names are the union of:

- every ActiveGate's `dt.network_zone.id` (lowercase; empty = `default`);
- every zone in [Q6](#q6-oneagents-per-network-zone-networkzoneagentsquery) (null = `default`);
- every configured `builtin:networkzones.zones` object (`value.id`, lowercase).

For each zone the code computes:

- `fallback` = the object's `fallbackMode`, `ANY_ACTIVE_GATE` when there is no object, or empty when the settings were not read;
- the alternative zones;
- the zone's ActiveGates and how many are connected (`online`);
- the OneAgent count;
- `altOnline` = connected ActiveGates in the alternative zones.

Each zone gets one status and note. The first matching rule wins:

| # | Condition | Status | Note |
| --- | --- | --- | --- |
| 1 | OneAgents > 0, no connected ActiveGate in the zone, fallback `NONE`, no connected ActiveGate in the alternative zones | Blocking | "N OneAgents in this zone, no connected ActiveGate in it or its alternative zones, and fallback None: their traffic is dropped." |
| 2 | OneAgents > 0, none connected, fallback `ONLY_DEFAULT_ZONE`, none in the alternatives, none connected in `default` | Blocking | "… no connected ActiveGate in it, its alternative zones or the default zone (fallback Only default zone)." |
| 3 | OneAgents > 0, none connected (other cases) | Info | "N OneAgents, no connected ActiveGate in the zone: they use the alternative zones / the default zone / ActiveGates of other zones (fallback …)." |
| 4 | The zone has ActiveGates, none connected | Check | "No ActiveGate of the zone is connected. Fallback …" |
| 5 | fallback `NONE` | Info | "Fallback None: Traffic stays within the zone and its alternative zones; …" |
| 6 | settings read, zone has no object, zone is not `default` | Info | "Fallback Any ActiveGate (not configured: schema default)." |
| 7 | no ActiveGate and no OneAgent use the zone | Info | "Configured, but no ActiveGate or OneAgent uses it. …" |
| 8 | otherwise | OK | "Fallback \<mode\>." (or "Fallback not read.") |

Zones are sorted by status, then by number of ActiveGates (descending), then by name.

Fallback modes (`FALLBACK_TEXT`):

- **Any ActiveGate**: priority groups 1 to 4. "When no ActiveGate of the zone or its alternative zones is available, traffic goes to any available ActiveGate, including the default zone."
- **Only default zone**: groups 1 to 3.
- **None (drop traffic)**: groups 1 and 2. "OneAgents send no data to another zone."

#### Network zone map

A custom SVG topology (`NetworkZoneMap` in [NetworkZoneMap.tsx](../ui/app/tabs/NetworkZoneMap.tsx)), inside the Q6 loading and error state. **Nothing on the map is saved.**

**Zones** are rounded containers laid out in reading order on a 1120-unit-wide canvas: `default` first, then zones in use (with ActiveGates or OneAgents), with the most ActiveGates first, then by name.

- The header shows the zone name, then "fallback \<mode\>". The suffix is " (what-if)" when you picked another mode in the simulation, or " (default)" when the zone has no settings object. Then "· alt \<alternative zones\>". The fallback text is amber for None.
- Unused zones are compact, dashed, and say "no ActiveGate or OneAgent".
- Click a zone to focus it; click again to unfocus.

**OneAgents** appear as one grey circle per zone, with the count from Q6 and the label "OneAgents". A focused zone without OneAgents shows a dashed "what-if" circle. When the zone's traffic is dropped, the circle pulses red and shows "✕ traffic dropped".

**ActiveGates** are nodes laid out in a grid of up to 5 columns. Nodes with OneAgent routing come first.

- The glyph is E (host-based), K (containerized), S (synthetic) or Z (zRemote).
- Fill colour:
  - routes OneAgent traffic (has `AGENT_ROUTING`): priority-group-1 blue;
  - no OneAgent routing: grey at 55 % opacity;
  - not connected: grey with a red ring;
  - down in the simulation: dark grey with ✕.
- A badge shows the connected OneAgent modules (Q2 `agents`, peak) when it is above 0.
- Nodes that receive traffic have a faint outer ring.
- Hover a node for name, type, group, zone, version, state, and connected OneAgent modules.
- Clicking a node depends on the mode toggle:
  - **Click: diagnose** (default): selects the ActiveGate, as Diagnose does.
  - **Click: simulate outage**: takes it down, or brings it back.

**Routing** (`routingPlan` in [activeGates.ts](../ui/app/activeGates.ts)) follows the OneAgent connectivity docs. Every zone that has OneAgents (and the focused zone) gets four priority groups:

1. same zone;
2. its alternative zones;
3. the `default` zone ("same as group 1" for the default zone itself);
4. every other ActiveGate.

An ActiveGate belongs only to the first group that matches. An ActiveGate is *available* when it is connected, has `AGENT_ROUTING`, and is not down in the simulation. The fallback mode (or the what-if override) allows groups 1-4, 1-3 or 1-2. Traffic goes to the first allowed group with at least one available ActiveGate and is load-balanced inside it. When no allowed group has one, the traffic is **dropped**.

**Traffic** is drawn as lines from the zone's OneAgents to each ActiveGate in the target group.

- Colour per group: palette slots 1, 3, 7 and 2.
- Group 1 is solid; groups 2 to 4 are dashed.
- Inside a zone, lines are routed orthogonally; across zones they are curved.
- Moving dots (SVG `animateMotion`): 1 + floor(load / 15) per line, at most 4, where load = the target's connected OneAgent modules. One cycle takes 1.8 s for group 1 and 2.6 s otherwise. There are no dots when the OS asks for reduced motion.
- Hovering an ActiveGate or a zone dims the other traffic.

**Controls**: Zoom out (−) and Zoom in (+) by a factor of 1.2, from 0.5× to 2.5×; **Fit**; drag the background to pan; **Reset simulation** clears the outages, what-if modes and playback (disabled when nothing is simulated). When zones are off, a notice says the map shows how traffic would be routed once they are on.

**Legend**: Groups 1 to 4, Routes OneAgent traffic, No OneAgent routing, Not connected, Down (simulation), Traffic dropped, and "E host-based · K Kubernetes · S synthetic · Z zRemote · badge = connected OneAgent modules".

**Side panel.**

- With no zone focused, **Fallback chains** lists every zone: "N OneAgents → group G (n ActiveGates)", "traffic dropped" (red), or "No OneAgents · fallback …". It also shows "N ActiveGates down in the simulation". Click a zone to focus it.
- With a zone focused:
  - the zone name, its OneAgents and connected ActiveGates, and "all zones" to unfocus;
  - a **Fallback mode** select: the configured mode ("… (configured)" or "(default)"), or "What-if: \<mode\>" for the other two modes;
  - the mode's explanation;
  - the four groups, each with its zones and "available of total · reason". The reasons are: not allowed by the fallback (crossed out), same as group 1, no ActiveGate, none available, traffic goes here, standby. The target group lists up to 6 ActiveGate names;
  - a status line: "Traffic: group G, load-balanced over N ActiveGates." or "Traffic dropped: no group the fallback allows has an available ActiveGate.";
  - **▶ Play fallback** (disabled when the traffic is already dropped). Every 2.6 s it takes the current target group's ActiveGates down, so you can watch traffic move to the next group. Captions read "Normal: traffic goes to group 1." and then "\<group\> unavailable → traffic moves to group G (…)" or "… no allowed group left: traffic dropped". **Stop playback** ends it;
  - **Take the zone's ActiveGates down** marks every ActiveGate of the zone as down. It is disabled when the zone has none.

**Routing per zone as a table** (collapsed) is the accessible alternative to the map. Columns: Zone, OneAgents, Fallback, Traffic goes to ("Group G: label", "Dropped" in red, or "— (no OneAgents)"), ActiveGates used.

#### Network zones and their fallback (table)

One row per zone from the zone list ("findings first"), inside the Q6 loading and error state.

| Column | Meaning |
| --- | --- |
| Status | Blocking / Check / Info / OK (rules above) |
| Network zone | name |
| Fallback | Any ActiveGate / Only default zone / None (drop traffic) (bold amber), or "not read"; second line "configured" or "not configured (default)"; hover for the explanation |
| Alternative zones | comma list or "none" |
| ActiveGates (connected) | "connected of total: names" |
| OneAgents | count from Q6 |
| Finding | note |

Forms below the table (collapsed):

- **Set the network zone of ActiveGates (API)**: the [remote configuration form](#set-the-activegate-group-or-network-zone-remote-configuration) with *Network zone* preselected.
- **Set the fallback and alternative zones of a network zone (API)**: shown only when the zone settings were read. See [Zone fallback](#set-a-network-zones-fallback-and-alternative-zones).
- **Turn on network zones (API)**: shown only when zones are off and the settings were read. See [Turn on network zones](#turn-on-network-zones).

QueryActions: [Q6](#q6-oneagents-per-network-zone-networkzoneagentsquery) ("ActiveGates: OneAgents per network zone").

### Module self-monitoring

"Module-specific metrics: AWS requests and data loss, Kubernetes API calls that did not return 200, rejected metric and OTLP data points." The card is built from [Q3](#q3-module-self-monitoring-detail-activegatedetailquery) and sits inside its loading and error state. ActiveGate names are links: clicking one diagnoses that ActiveGate.

- **AWS requests by response status · \<ActiveGate\>**: one stacked bar per ActiveGate that has `aws.requests` rows.
  - Segments: OK first, then the other statuses by count. Underscores in a status are shown as spaces.
  - Colours: `ok` green; `timeout` amber; `network_error` and `throttling_error` orange; `authentication_error`, `4xx` and `5xx` red; anything else grey.
  - The legend shows each count and share: "<0.1" below 0.1 %, one decimal below 10 %, integers otherwise.
  - When the ActiveGate has `aws.data_lost` rows: "! Data lost (data_lost_monitoring_status = 1, "some data lost"): \<service · data type · connection\>; …".
- **AWS connections and the ActiveGate that runs them**: Connection | ActiveGate. Built from the `aws.credentials` rows. `agId` = `unassigned` is shown as red "! No ActiveGate runs it (unassigned)".
- **Kubernetes API calls that did not return 200**: ActiveGate | Status | Path | Calls | Meaning. The meaning depends on the status:
  - 404 on a path containing `openshift.io`: "Expected: OpenShift API on a cluster that is not OpenShift";
  - 403: "Access denied: the service account may not call it (RBAC)";
  - `-1`: "No HTTP response (endpoint not reachable)", and the code is shown in red;
  - anything else: "Failed", and the code is shown in red.
- **Rejected data points by reason**: ActiveGate | Ingest (Metrics / OTLP) | Reason | Data points.
- When none of the four applies: "No AWS, Kubernetes or ingest problems in this timeframe."

QueryActions: Q3 ("ActiveGates: module self-monitoring detail").

### Extensions on ActiveGate groups

"Latest status of every monitoring configuration assigned to an ActiveGate group (dt.sfm.extension.status). UNASSIGNED = assigned to the group, but no ActiveGate picked it up. Every state except OK and IDLE is an error." The card is built from [Q4](#q4-extension-configurations-on-activegate-groups-activegateextensionsquery) joined with [Q5](#q5-latest-extension-framework-warnings-and-errors-activegateextensioneventsquery) by `configId`.

- **Donut** of configurations by status, with OK first and then by count. Colours: OK green, IDLE grey, WARNING amber, UNASSIGNED orange, every other status red. Clicking a slice lists only that status.
- **Toggle** "Not OK" (default) / "All". Changing the toggle clears the slice filter.
- **Table** columns:
  - Status: a glyph (✓ OK, • IDLE, – WARNING, ! otherwise), the status code, and its meaning from `EXT_STATUS_TEXT`, for example `UNASSIGNED` "Not picked up by any ActiveGate", `GENERIC_ERROR` "Job failed", `AUTHENTICATION_ERROR` "Authentication failed", `DEVICE_CONNECTION_ERROR` "Cannot connect to the device".
  - Extension: the name; below it the data source, an "Extensions app ↗" link when the name contains a dot (intent `dynatrace.extensions.manager` / `go-to-extensions-manager-from-hub` with `{extensionName, isInstalled: true}`), and a "configuration ↗" link when the configuration entity is known (intent `dynatrace.classic.technologies` / `view-extensions--configuration` with `dt.entity.extensions:configuration`).
  - ActiveGate group.
  - Runs on: the ActiveGate name, or a red **No ActiveGate** with either "N eligible ActiveGates in the group" (hover to see their names) or "no ActiveGate in the group has the Extensions module".
  - Reason: "Error below" / "Warning below" when Q5 has a message for the configuration, else "—".
- Empty states: "Every configuration on an ActiveGate group is OK." / "No configurations." / "No extension runs on an ActiveGate group." (donut).

QueryActions: Q4 ("ActiveGates: extension configurations by status").

### Extension warnings and errors

"The latest warning or error the extension framework reported per monitoring configuration in the timeframe (dt.system.events, EXTENSIONS_EVENT), errors first." Built from [Q5](#q5-latest-extension-framework-warnings-and-errors-activegateextensioneventsquery).

Each event is joined to its configuration from Q4 by `configId`. Events that match no ActiveGate-group configuration and carry neither a group nor an ActiveGate ID are dropped. That drops host-scoped (local) configurations. Rows are sorted ERROR, then WARN, then anything else, and newest first within a level.

The toggle "Configurations not OK" (default) keeps events whose configuration's current status is not OK/IDLE, or is unknown. "All" shows every event.

| Column | Content |
| --- | --- |
| When (UTC) | `timestamp`, first 16 characters |
| Level | Error (red) / Warning (amber) |
| Extension | as above |
| Status now | the configuration's current status from Q4, else the status in the event |
| Group / ActiveGate | "group · ActiveGate name" |
| Message | full `content` (wrapped) |

QueryActions: Q5 ("ActiveGates: latest extension framework warnings and errors").

### ActiveGate logs (support archive)

Shown when there is at least one ActiveGate. "A support archive is the ActiveGate's logs and configuration for the chosen days, collected through Dynatrace (Fleet Management API), with sensitive data masked. Archives are kept 30 days."

**Form fields:**

- **ActiveGate**: a select of all ActiveGates, with " (offline)" after those not connected. The default is the ActiveGate last chosen by Diagnose or *Open ActiveGate logs*, else the first connected one, else the first one. Picking another ActiveGate clears the list, the result and the confirmation.
- **Days of logs**: 1 to 7, default "7 (default)".
- **Issue (required)**: free text, sent as `description`.

**Starting a collection.** Tick the confirmation "Collect a support archive from \<name\> (N days of logs)", then press **Start collection**. The button is enabled only with the confirmation ticked, a non-empty issue, and a connected ActiveGate. For an offline ActiveGate the card says: "\<name\> is not connected, so it cannot collect an archive now: use agctl on the host." **Refresh** re-reads the list.

**Archive table**, sorted newest collection first; archives without a collection time come first.

| Column | Content |
| --- | --- |
| Status | the label, with a spinner while collecting or deleting. Labels: Collecting, Collected, Collection failed, Canceled, Sending to Dynatrace, Sent to Dynatrace, Sending failed, Analyzing, Analyzed, Analysis failed, Re-analysis needed, Manual cleanup, Deleting, Deleted, Delete failed. Failed states are red; downloadable ones green. |
| Issue | `description` |
| Days | `lookbackDays` |
| Collected | `collectionTimestamp` (UTC, minutes) |
| Size | `sizeKb / 1024`, one decimal, in MB |
| By | `collectedBy` |
| (actions) | **Download** when the archive has a collection time and its status is not one of `COLLECT_IN_PROGRESS`, `COLLECT_ERROR`, `CANCELED`, `DELETE_IN_PROGRESS`, `DELETED`, `DELETE_ERROR`. **Delete** (or **Cancel** while collecting) asks again with **Confirm delete** / **Confirm cancel** and **Keep**; it is hidden for Deleted / Deleting archives. |

While any archive is collecting or deleting, the list is re-read every 10 s. Empty state: "No support archive for \<name\> yet." A failed read shows "Could not list the support archives: \<error\>". The requests are under [Support archives](#support-archives).

**ActiveGate offline or not starting: collect the logs on the host (agctl), log directories** (collapsed) shows the [agctl support archive manual action](#collect-activegate-logs-on-the-host-agctl-support-archive).

### Remediation actions and Diagnose

The last section, **Remediation actions**, shows the review date line ("Guidance reviewed against the Dynatrace docs on … ", from the docs-freshness check) and an **Action** dropdown. Each option is prefixed "API · " or "Manual · ".

- **Nothing selected**: a flat list:
  - API · Set the update mode;
  - API · Set the group or network zone of ActiveGates (remote configuration);
  - when the zone settings were read: API · Turn on network zones (only if they are off), then API · Set a network zone's fallback and alternative zones;
  - API · Collect logs (support archive);
  - the 14 generic manual actions (with placeholders), in this order: group or zone on the ActiveGate, zone fallback, update (host-based), update (Operator), token, rejected, dropped, module, extensions, AWS, Kubernetes, resources, connectivity, agctl support archive.
- **ActiveGate selected** (Diagnose button, matrix row or cell, Messages bar, Module self-monitoring link, or map node in diagnose mode): the description becomes "What needs attention on \<name\> …", **Clear selection** appears, and the diagnosis shows:
  - a facts line: type, version, group, network zone, "containerized" or "\<os\> host", FIPS mode, extensions / synthetic engine / zRemote versions, token ID;
  - links: Fleet Management (app `dynatrace.fleet.management`), Deployment status (ActiveGates) (app `dynatrace.classic.deployment.status`, page `activegates`), Update setting (host-based only: the Settings app for `builtin:deployment.activegate.updates` at the ActiveGate scope), and Kubernetes cluster \<name\> (containerized only). The note "Fleet Management has no link to a single ActiveGate: search it there by name." is shown;
  - the **check list** (Blocking, Check, Info, OK), each with title and detail. See [Checks and scoring](#checks-and-scoring);
  - **Enabled modules (n)** (collapsed): each module with its state and text;
  - **Extension configurations not OK (n)** (expanded): the configurations on this ActiveGate that are not OK, plus the unassigned ones in its group, with their message;
  - **Over the timeframe**: six line charts from [Q7](#q7-communication-and-resources-of-one-activegate-activegatetrendquery): Messages rejected, Messages dropped, Messages resent, Outgoing queue (peak), Java heap used (% , y axis fixed at 100), Host CPU (peak) (%, fixed at 100). Null buckets break the line. Hover for the time and value; the header shows the peak. QueryActions: "ActiveGates: communication and resources of \<name\>". When there is no data: "No self-monitoring data for this ActiveGate in the timeframe.";
  - the **Action** dropdown, grouped Blocking / Check / Info / More steps (see [Remediation actions](#remediation-actions)).

Every action ends with **Documentation for this fix** links. A page that changed after the review date is marked, using the docs-freshness check.

## Checks and scoring

`diagnoseActiveGate` in [activeGates.ts](../ui/app/activeGates.ts) runs for every ActiveGate. The worst status gives the table's Status column. Status labels: `fail` = Blocking, `warn` = Check, `info` = Info, `pass` = OK.

| Check (id) | Status | Rule | Fix group |
| --- | --- | --- | --- |
| Connected (`online`) | OK / Blocking | Smartscape `lifetime[end]` within the last 20 min. Blocking title: "Not connected for N minutes/hours/days" (minutes below 120 min, hours below 48 h, else days); detail "Last seen … UTC". | connectivity |
| Version (`version`) | Info / Check / Info / OK | `releasesBehind = max(0, ceil((minor(target) − minor(version)) / 2))`. Null (no version or no target) → Info "The target version could not be read…". More than 5 → Check "N releases behind the target version". 1–5 → Info "Update available (N releases behind)". 0 → OK "On the target version". | update (host-based) / update-k8s (containerized) |
| Update mode (`auto-update`) | Info / Check / OK | Containerized → Info "Updated by the Dynatrace Operator" (no fix). Host-based with settings read: effective mode `MANUAL` → Check "Automatic updates off"; otherwise OK (mode label, target, origin). Settings not read → no check. | auto-update |
| Token (`token`) | Info / OK / Blocking / Check | Tokens not read → no check. Token ID not in the list → Info "Token not in the token list". No expiration → OK. `floor((expiration − now) / 1 day)` < 0 → Blocking "Token expired". ≤ 30 → Check "Token expires in N days". Otherwise OK "Token valid". | token |
| Messages rejected (`rejected`) | Blocking | summed `rejected` > 0 | rejected |
| Messages dropped (`dropped`) | Check | summed `dropped` > 0 | dropped |
| Messages resent (`resent`) | Info | summed `resent` > 0 | dropped |
| Messages (`messages`) | OK / Info | OK when none of the three: "Outgoing queue peaked at N messages". Info "No self-monitoring data" when Q2 has no row for the ActiveGate (then no resource checks either). | none |
| Heap (`heap`) | Check | `round(100 × avg heap used / avg heap size)` ≥ 80 | resources |
| Disk (`disk`) | Check | `round(100 × min free / max total)` < 10 | resources |
| CPU (`cpu`) | Check | peak `dt.sfm.active_gate.system.cpu_usage` ≥ 95 | resources |
| Module problems (`module-<ID>`) | Check | module state *with problems* (see the module table) | aws / k8s / extensions / ingest (any other module) |
| Kubernetes access denied (`k8s-forbidden`) | Info | any `k8s.api_errors` row with status 403 | k8s |
| Modules not in use (`idle`) | Info | one or more enabled modules in state *not in use*: "Enabled, not in use: …" | module |
| Group (`group`) | Info | the ActiveGate has a group. The detail has members, Extensions modules and the group's finding, plus a DynaKube note for containerized ActiveGates. It is Info even when the group row itself is Blocking. | group |
| Network zone (`zone`) | Info / OK | Info when network zones are off or the fallback is None; otherwise OK. The title is "Network zone X: fallback Y[ (default)]" ("not read" when the settings were not read). | zone |
| Extensions not picked up (`unassigned`) | Blocking | the ActiveGate has the Extensions module and its group has UNASSIGNED configurations with no ActiveGate | extensions |

Derived statuses:

- ActiveGate table row status: the worst check status. The "(n)" is the number of checks at that status.
- [Group rows](#activegate-groups) and [zone rows](#zone-list-client-side-zonerows): their own rules, described above.
- Gauge thresholds: none. Gauges are plain percentages.

## Queries

| # | Name (function) | Runs when | Feeds |
| --- | --- | --- | --- |
| Q1 | Inventory (`activeGatesQuery`) | page load, timeframe change | everything; gauges, donuts, matrix, table, groups, zones, logs card |
| Q2 | Self-monitoring per ActiveGate (`activeGateHealthQuery`) | page load, timeframe change | gauges, module states, Messages, table, map badges, checks |
| Q3 | Module self-monitoring detail (`activeGateDetailQuery`) | page load, timeframe change | module problem rules, Module self-monitoring card, AI Assist |
| Q4 | Extension configurations on ActiveGate groups (`activeGateExtensionsQuery`) | page load, timeframe change | gauge, EEC module activity, table Extensions column, groups, Extensions card |
| Q5 | Latest extension framework warnings and errors (`activeGateExtensionEventsQuery`) | page load, timeframe change | Extensions card Reason, Extension warnings and errors |
| Q6 | OneAgents per network zone (`networkZoneAgentsQuery`) | page load, timeframe change | zone list, map, zones table |
| Q7 | Communication and resources of one ActiveGate (`activeGateTrendQuery`) | when an ActiveGate is selected; re-runs for another ActiveGate or timeframe | diagnosis line charts |
| M1 | Messages over time (manual action variant) | not run; shown as text in the *rejected* / *dropped* manual actions | copy into a notebook |
| M2 | Framework messages (manual action variant) | not run; shown in the *extensions* manual action | copy |
| M3 | Rejections by reason (manual action variant) | not run; shown in the *ingest* manual action | copy |

Q1 to Q6 run through `useDql` (SDK `@dynatrace-sdk/react-hooks`) and re-run when their text changes, that is, on a timeframe change. All of them are built in [queries.ts](../ui/app/queries.ts). The text below was generated with the builders for the default 24 h. For 7 or 30 days, every `from:now()-24h` (including the one inside the `lookup` subquery) becomes `from:now()-7d` / `from:now()-30d`. The `now() - 20m` online rule does not change.

### Q1 Inventory (`activeGatesQuery`)

- **Source:** `activeGatesQuery(tf)` in [queries.ts](../ui/app/queries.ts)
- **Runs:** page load and on every timeframe change.
- **Parameters:** `tf` only.

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

**How it works:**

- `smartscapeNodes` reads the three node types that represent environment ActiveGates by purpose (routing/monitoring, synthetic, zRemote) seen in the timeframe.
- `lifetime[end]` is the last time Smartscape saw the node.
- `dedup dt.active_gate.id, sort:{lastSeen desc}` keeps the newest node per ActiveGate ID. An ActiveGate reinstalled with another purpose can appear under two node types.
- The `lookup` joins Smartscape `K8S_CLUSTER` nodes by `k8s.cluster.uid`, to get the cluster's name and Smartscape ID for containerized ActiveGates.
- `fields` renames the columns. It computes `online` as seen within the last 20 minutes (`AG_OFFLINE_MINUTES`).

**Output:** `toActiveGate` maps:

- `id` (Smartscape node ID, used for support archives);
- `agId` (`dt.active_gate.id`, used for metrics, update settings scope, update jobs, remote configuration);
- `name` (falls back to `agId`), `type`, `group`, `networkZone`, `version`, `modules` (array), `containerized`, `clusterName`, `clusterId`, `startup`, `lastSeen`, `online`, `tokenId`;
- the three component versions, `fips`, and `osType` (with the prefix `OS_TYPE_` stripped).

`osVersion`, `arch`, `capabilities` and `nodeSize` are returned but not used by the UI. Client-side, rows are re-sorted by type label and then name.

**Limits and cost:** a Smartscape read, cheap; no row limit.

**Open it yourself:** yes, under *DQL behind these gauges* ("ActiveGates: inventory").

### Q2 Self-monitoring per ActiveGate (`activeGateHealthQuery`)

- **Source:** `activeGateHealthQuery(tf)`
- **Runs:** page load, timeframe change.
- **Parameters:** `tf`.

```dql
timeseries {
    dropped = sum(dt.sfm.active_gate.communication.messages.dropped, scalar:true),
    rejected = sum(dt.sfm.active_gate.communication.messages.rejected, scalar:true),
    resent = sum(dt.sfm.active_gate.communication.messages.resent, scalar:true),
    queueMax = max(dt.sfm.active_gate.communication.queue.outgoing.usage, scalar:true),
    heapUsed = avg(dt.sfm.active_gate.jvm.heap_memory_used, scalar:true),
    heapAvail = avg(dt.sfm.active_gate.jvm.heap_memory_available, scalar:true),
    jvmCpu = avg(dt.sfm.active_gate.jvm.cpu_usage, scalar:true),
    sysCpu = max(dt.sfm.active_gate.system.cpu_usage, scalar:true),
    volFree = min(dt.sfm.active_gate.storage.volume.free, scalar:true),
    volTotal = max(dt.sfm.active_gate.storage.volume.total, scalar:true)
  }, by:{dt.active_gate.id}, filter:{isFalseOrNull(dt.active_gate.working_mode == "embedded")}, union:true, from:now()-24h
| append [timeseries {
    threadQueue = max(dt.sfm.active_gate.thread_pool.queue_size, scalar:true),
    ingestRejected = sum(dt.sfm.active_gate.metrics.ingest.grail.datapoints.rejected, scalar:true),
    otlpRejected = sum(dt.sfm.active_gate.metrics.ingest.otlp.datapoints.rejected, scalar:true),
    awsLost = max(dt.sfm.active_gate.aws.data_lost_monitoring_status, scalar:true),
    awsBad = sum(dt.sfm.active_gate.aws.elements.bad, scalar:true),
    awsEmpty = sum(dt.sfm.active_gate.aws.empty_responses, scalar:true),
    awsDelay = max(dt.sfm.active_gate.aws.data_delay, scalar:true),
    k8sEvictions = sum(dt.sfm.active_gate.kubernetes.cache.eviction_count, scalar:true),
    eecLinesRejected = sum(dt.sfm.extension.engine.metric_ingest.lines_rejected, scalar:true),
    eecLogsRejected = sum(dt.sfm.extension.engine.logs_ingest.records_rejected, scalar:true)
  }, by:{dt.active_gate.id}, filter:{isFalseOrNull(dt.active_gate.working_mode == "embedded")}, union:true, from:now()-24h]
| append [timeseries {
    awsRequests = sum(dt.sfm.active_gate.aws.requests, scalar:true),
    k8sQueries = sum(dt.sfm.active_gate.kubernetes.api.query_count, scalar:true),
    agents = max(dt.sfm.active_gate.communication.agent_modules.connected, scalar:true),
    beacons = sum(dt.sfm.active_gate.rum.beacon_forwarded_count, scalar:true),
    restRequests = sum(dt.sfm.active_gate.rest.request_count, scalar:true),
    grailAccepted = sum(dt.sfm.active_gate.metrics.ingest.grail.datapoints.accepted, scalar:true),
    otlpReceived = sum(dt.sfm.active_gate.metrics.ingest.otlp.datapoints.received.total, scalar:true),
    eventsIn = sum(dt.sfm.active_gate.event_ingest.event_incoming_count, scalar:true),
    eecCpu = avg(dt.sfm.extension.engine.cpu_usage, scalar:true),
    synthUtil = avg(dt.sfm.synthetic.engine_utilization, scalar:true)
  }, by:{dt.active_gate.id}, filter:{isFalseOrNull(dt.active_gate.working_mode == "embedded")}, union:true, from:now()-24h]
| summarize {dropped = max(dropped), rejected = max(rejected), resent = max(resent), queueMax = max(queueMax), heapUsed = max(heapUsed), heapAvail = max(heapAvail),
    jvmCpu = max(jvmCpu), sysCpu = max(sysCpu), volFree = max(volFree), volTotal = max(volTotal), threadQueue = max(threadQueue), ingestRejected = max(ingestRejected),
    otlpRejected = max(otlpRejected), awsLost = max(awsLost), awsBad = max(awsBad), awsEmpty = max(awsEmpty), awsDelay = max(awsDelay), k8sEvictions = max(k8sEvictions),
    eecLinesRejected = max(eecLinesRejected), eecLogsRejected = max(eecLogsRejected), awsRequests = max(awsRequests), k8sQueries = max(k8sQueries), agents = max(agents),
    beacons = max(beacons), restRequests = max(restRequests), grailAccepted = max(grailAccepted), otlpReceived = max(otlpReceived), eventsIn = max(eventsIn),
    eecCpu = max(eecCpu), synthUtil = max(synthUtil)}, by:{agId = dt.active_gate.id}
| filter isNotNull(agId)
```

**How it works:**

- One `timeseries` command takes at most 10 metrics, so the 30 values are read in three blocks, each split `by:{dt.active_gate.id}`. Blocks 2 and 3 are added with `append`.
- `scalar:true` returns one value for the whole timeframe instead of an array: the sum, max, min or average named in each line.
- `union:true` keeps an ActiveGate when only some of a block's metrics have data. The missing ones are null.
- `filter:{isFalseOrNull(dt.active_gate.working_mode == "embedded")}` leaves out OneAgent-embedded ActiveGates. Extension and synthetic metrics carry no `working_mode`, and a plain `!=` would drop them.
- The final `summarize … max(…) by:{agId}` merges the three rows per ActiveGate into one. Each field is non-null in only one block, so `max` picks that value.
- `filter isNotNull(agId)` drops series without an ActiveGate ID.

**Output:** `toHealth` turns every field into a number, or null for no data point. The UI uses:

- `dropped`, `rejected`, `resent`, `queueMax`: Messages charts, table, message checks, gauge;
- `heapUsed` / `heapAvail`: Heap column, heap check;
- `volFree` / `volTotal`: Disk free column, disk check;
- `sysCpu`: CPU peak column, CPU check;
- `ingestRejected`, `otlpRejected`, `awsLost`, `awsBad`, `eecLinesRejected`, `eecLogsRejected`: module problem rules;
- `awsRequests`, `k8sQueries`, `agents`, `beacons`, `grailAccepted`, `otlpReceived`, `synthUtil`: module activity. `agents` is also the map badge and particle load.

`jvmCpu`, `threadQueue`, `awsEmpty`, `awsDelay`, `k8sEvictions`, `restRequests`, `eventsIn` and `eecCpu` are read but not shown.

**Limits and cost:** three metric scans over the timeframe; one row per ActiveGate. A 30-day timeframe scans more data.

**Open it yourself:** yes, under the gauges and below the ActiveGates table.

### Q3 Module self-monitoring detail (`activeGateDetailQuery`)

- **Source:** `activeGateDetailQuery(tf)`
- **Runs:** page load, timeframe change.
- **Parameters:** `tf`.

```dql
timeseries n = sum(dt.sfm.active_gate.aws.requests, scalar:true), by:{dt.active_gate.id, response.status}, from:now()-24h
| filter n > 0
| fields agId = dt.active_gate.id, metric = "aws.requests", key = response.status, n
| append [timeseries n = max(dt.sfm.active_gate.aws.data_lost_monitoring_status, scalar:true), by:{dt.active_gate.id, aws.service, aws.data.type, credentials.name}, from:now()-24h
    | filter n > 0
    | fields agId = dt.active_gate.id, metric = "aws.data_lost", key = concat(aws.service, " · ", aws.data.type, " · ", credentials.name), n]
| append [timeseries n = sum(dt.sfm.active_gate.aws.elements.bad, scalar:true), by:{dt.active_gate.id, aws.service}, from:now()-24h
    | filter n > 0
    | fields agId = dt.active_gate.id, metric = "aws.elements.bad", key = aws.service, n]
| append [timeseries n = max(dt.sfm.server.aws.monitoring.status, scalar:true), by:{dt.active_gate.id, credentials.name}, from:now()-24h
    | fields agId = dt.active_gate.id, metric = "aws.credentials", key = credentials.name, n]
| append [timeseries n = sum(dt.sfm.active_gate.kubernetes.api.query_count, scalar:true), by:{dt.active_gate.id, status_code, path}, filter:{status_code != "200"}, from:now()-24h
    | filter n > 0
    | fields agId = dt.active_gate.id, metric = "k8s.api_errors", key = concat(status_code, " ", path), n]
| append [timeseries n = sum(dt.sfm.active_gate.metrics.ingest.grail.datapoints.rejected, scalar:true), by:{dt.active_gate.id, reason}, filter:{isFalseOrNull(dt.active_gate.working_mode == "embedded")}, from:now()-24h
    | filter n > 0
    | fields agId = dt.active_gate.id, metric = "metrics.rejected", key = reason, n]
| append [timeseries n = sum(dt.sfm.active_gate.metrics.ingest.otlp.datapoints.rejected, scalar:true), by:{dt.active_gate.id, reason}, filter:{isFalseOrNull(dt.active_gate.working_mode == "embedded")}, from:now()-24h
    | filter n > 0
    | fields agId = dt.active_gate.id, metric = "otlp.rejected", key = reason, n]
| sort agId asc, metric asc, n desc
```

**How it works:** seven scalar timeseries, each normalised to the long format `agId, metric, key, n` and appended together:

- AWS requests by `response.status`.
- AWS data-lost status by service, data type and connection; `max` = 1 means some data was lost.
- Bad AWS elements by service.
- `dt.sfm.server.aws.monitoring.status` per connection. This is server side, and `agId` is `unassigned` when no ActiveGate runs the connection. It is not filtered on `n`.
- Kubernetes API queries whose `status_code` is not `"200"`, keyed "code path".
- Rejected metric and OTLP data points by `reason`, without embedded ActiveGates.

`filter n > 0` drops zero rows. `toDetail` maps each row.

**Output:** `aws.requests`, `aws.data_lost` and `k8s.api_errors` feed the AWS and Kubernetes problem rules and the Module self-monitoring card. `aws.credentials` feeds the connections table and AI Assist (`awsUnassigned`). `metrics.rejected` and `otlp.rejected` feed the reasons in the ingest problem text and the rejected-data-points table. `aws.elements.bad` rows are fetched but not displayed; the AWS rule uses Q2 `awsBad` instead.

**Limits and cost:** seven metric scans; no row limit.

**Open it yourself:** yes, in the Module self-monitoring card.

### Q4 Extension configurations on ActiveGate groups (`activeGateExtensionsQuery`)

- **Source:** `activeGateExtensionsQuery(tf)`. The Extensions tab reuses it.
- **Runs:** page load, timeframe change.
- **Parameters:** `tf`.

```dql
timeseries c = count(dt.sfm.extension.status), by:{dt.extension.config.id, `dt.entity.extensions:configuration`, dt.extension.name, dt.extension.ds, dt.extension.status, dt.active_gate.group.name, dt.active_gate.id}, filter:{isNotNull(dt.active_gate.group.name)}, from:now()-24h
| fieldsAdd lastAt = arrayMax(iCollectArray(if(isNotNull(c[]), iIndex()))), samples = arraySum(c)
| dedup dt.extension.config.id, sort:{lastAt desc}
| fields configId = dt.extension.config.id, configEntity = `dt.entity.extensions:configuration`, extension = dt.extension.name, dataSource = dt.extension.ds, status = dt.extension.status, group = dt.active_gate.group.name, agId = dt.active_gate.id, lastAt, samples
| sort status asc, extension asc
```

**How it works:**

- `dt.sfm.extension.status` is reported per configuration and status. Series without `dt.active_gate.group.name` (host-scoped configurations that run in OneAgent) are excluded.
- `lastAt` is the index of the last time bucket with a sample: `iCollectArray(if(isNotNull(c[]), iIndex()))` collects the indexes of non-null buckets, and `arrayMax` takes the last one.
- `samples` is the total sample count.
- `dedup … sort:{lastAt desc}` keeps the most recent status row per configuration, so the latest status wins.
- UNASSIGNED rows have a group but no `dt.active_gate.id`.

**Output:** `ExtConfig` objects with `configId`, `configEntity`, `extension`, `dataSource`, `status`, `group`, `agId`, merged with Q5's message.

**Open it yourself:** yes (gauges and Extensions card).

### Q5 Latest extension framework warnings and errors (`activeGateExtensionEventsQuery`)

- **Source:** `activeGateExtensionEventsQuery(tf)`
- **Runs:** page load, timeframe change.
- **Parameters:** `tf`.

```dql
fetch dt.system.events, from:now()-24h
| filter event.kind == "EXTENSIONS_EVENT" and loglevel != "INFO" and isNotNull(dt.extension.config.id)
| dedup dt.extension.config.id, sort:{timestamp desc}
| fields configId = dt.extension.config.id, extension = dt.extension.name, status = dt.extension.status, loglevel, content, timestamp, group = dt.active_gate.group.name, agId = dt.active_gate.id
| sort timestamp desc
| limit 500
```

**How it works:** reads the extension framework's events; keeps warnings and errors that belong to a configuration; keeps the newest per configuration; returns at most 500 rows.

**Output:** joined into `ExtConfig.message` / `messageAt` / `messageLevel` (Reason column, diagnosis list) and listed in Extension warnings and errors.

**Limits and cost:** a `fetch` over system events for the timeframe; at most 500 rows.

**Open it yourself:** yes.

### Q6 OneAgents per network zone (`networkZoneAgentsQuery`)

- **Source:** `networkZoneAgentsQuery(tf)`
- **Runs:** page load, timeframe change.
- **Parameters:** `tf`.

```dql
smartscapeNodes "ONEAGENT", from:now()-24h
| summarize oneAgents = count(), by:{zone = dt.network_zone.id}
| sort oneAgents desc
```

**How it works:** counts the Smartscape OneAgent nodes seen in the timeframe, per reported network zone.

**Output:** a map from zone (lowercase; null → `default`) to count. It feeds the zone list, the zones table OneAgents column, the map's OneAgent circles, and zone checks.

**Open it yourself:** yes (zones table).

### Q7 Communication and resources of one ActiveGate (`activeGateTrendQuery`)

- **Source:** `activeGateTrendQuery(tf, agId)`
- **Runs:** when an ActiveGate is selected (diagnosis), for that ActiveGate; re-runs on another selection or a timeframe change.
- **Parameters:** `tf`, and `agId`, the selected ActiveGate's `dt.active_gate.id` (escaped as a DQL string). The example uses the placeholder `0x1a2b3c4d`.

```dql
timeseries {
    dropped = sum(dt.sfm.active_gate.communication.messages.dropped, default:0),
    rejected = sum(dt.sfm.active_gate.communication.messages.rejected, default:0),
    resent = sum(dt.sfm.active_gate.communication.messages.resent, default:0),
    queue = max(dt.sfm.active_gate.communication.queue.outgoing.usage),
    heapUsed = avg(dt.sfm.active_gate.jvm.heap_memory_used),
    heapSize = avg(dt.sfm.active_gate.jvm.heap_memory_available),
    cpu = max(dt.sfm.active_gate.system.cpu_usage)
  }, filter:{dt.active_gate.id == "0x1a2b3c4d"}, union:true, bins:96, from:now()-24h
| fieldsAdd heapPct = 100 * heapUsed[] / heapSize[]
| fieldsRemove heapUsed, heapSize
```

**How it works:** one series per metric for this ActiveGate, in about 96 buckets (15 min for 24 h).

- The message sums use `default:0`, so empty buckets read 0.
- Queue, heap and CPU stay null where there is no data, which breaks the line.
- `heapPct` is computed per bucket with array arithmetic (`[]`).

**Output:** the chart reads `timeframe.start` and `interval` (nanoseconds; 15 min if missing), and plots the arrays `rejected`, `dropped`, `resent`, `queue`, `heapPct`, `cpu`.

**Open it yourself:** yes, under the charts.

### M1–M3 DQL in manual actions (not run)

These are text variants in manual actions. Unlike the page queries, they always use `from:now()-24h`, whatever timeframe is selected.

M1, *Messages rejected* / *Dropped or resent messages*. The `filter` appears only when an ActiveGate is selected:

```dql
timeseries {
  dropped = sum(dt.sfm.active_gate.communication.messages.dropped),
  rejected = sum(dt.sfm.active_gate.communication.messages.rejected),
  resent = sum(dt.sfm.active_gate.communication.messages.resent),
  queue = max(dt.sfm.active_gate.communication.queue.outgoing.usage)
}, by:{dt.active_gate.id}, filter:{dt.active_gate.id == "0x1a2b3c4d"}, from:now()-24h
```

M2, *Extension not running*. The `and dt.extension.config.id == …` part is added for the first configuration that is not OK on the selected ActiveGate; the generic action omits it:

```dql
fetch dt.system.events, from:now()-24h
| filter event.kind == "EXTENSIONS_EVENT" and dt.extension.config.id == "<monitoring-configuration-id>"
| fields timestamp, loglevel, dt.extension.name, dt.extension.status, content, dt.active_gate.id
| sort timestamp desc
```

M3, *Rejected metric or OTLP data points*:

```dql
timeseries rejected = sum(dt.sfm.active_gate.metrics.ingest.grail.datapoints.rejected), by:{dt.active_gate.id, reason}, from:now()-24h
```

## API calls

| Method | Endpoint / SDK method | Scope | When |
| --- | --- | --- | --- |
| GET | `settingsObjectsClient.getSettingsObjects` → `/platform/classic/environment-api/v2/settings/objects` (`builtin:deployment.activegate.updates`) | `settings:objects:read` | page load; after an update-mode change |
| GET | same, `builtin:networkzones.zones,builtin:networkzones` | `settings:objects:read` | page load; after a zone change |
| GET | `/platform/fleet-management/v1/activegate/installer/version/target` | `fleet-management:activegates:download` | page load |
| GET | `/platform/fleet-management/v1/activegate/tokens` | `fleet-management:activegate.tokens:read` | page load |
| GET | `/platform/fleet-management/v1/activegate/support-archives/{nodeId}?page-size=100` | `…support-archives:read` | logs card shown, ActiveGate changed, Refresh, every 10 s while collecting / deleting, after an action |
| POST | `/platform/fleet-management/v1/activegate/support-archives/{nodeId}` | `…support-archives:write` | Start collection |
| GET | `/platform/fleet-management/v1/activegate/support-archives/{nodeId}/{id}:download` | `…support-archives:download` | Download |
| DELETE | `/platform/fleet-management/v1/activegate/support-archives/{nodeId}/{id}` | `…support-archives:delete` | Confirm delete / cancel |
| POST / PUT | `postSettingsObjects` / `putSettingsObjectByObjectId` (`validateOnly` for Validate) | `settings:objects:write` | update mode, zone fallback, turn on zones |
| GET | `activeGatesAutoUpdateJobsClient.getUpdateJobListByAgId` → `/api/v2/activeGates/{agId}/updateJobs?lastUpdates=true` | `fleet-management:activegates:read` | *Update now* form shown |
| POST | `validateUpdateJobForAg` → `/api/v2/activeGates/{agId}/updateJobs/validator` | `fleet-management:activegates:write` | Validate (Update now) |
| POST | `createUpdateJobForAg` → `/api/v2/activeGates/{agId}/updateJobs` | `fleet-management:activegates:write` | Update now |
| POST | `activeGatesRemoteConfigurationManagementClient.validateRemoteIdentityOperation` → `/api/v2/activeGates/remoteConfigurationManagement/validator` | `fleet-management:activegates:write` | Validate (group / zone), 1–2 calls |
| POST | `createRemoteIdentityOperationPreview` → `/api/v2/activeGates/remoteConfigurationManagement/preview` | `fleet-management:activegates:write` | Validate (after validation passes) |
| POST | `createRemoteIdentityOperationJob` → `/api/v2/activeGates/remoteConfigurationManagement` | `fleet-management:activegates:write` | Run job |
| app function | `functions.call("docs-freshness", { data: { urls, prefixes } })` | none (app function; outbound to docs.dynatrace.com) | once per page load, shared by all tabs; Retry |
| intent | `dynatrace.notebooks` / `view-query`, `dynatrace.dashboards` / `add-to-dashboard` with `{ "dt.query", title }` | none | Open in Notebook / Add to Dashboard |

Classic API paths go through the SDK, which prefixes `/platform/classic/environment-api/v2`. Fleet Management calls use `httpClient.send` from `@dynatrace-sdk/http-client` with the app session.

### Update settings

Read by `readAgUpdateSettings`: `getSettingsObjects({ schemaIds: "builtin:deployment.activegate.updates", fields: "objectId,scope,value,updateToken", pageSize: 500 })`, then `nextPageKey` until done. It uses `objectId`, `updateToken`, `scope` and `value.updateMode` / `value.targetVersion`. The `environment` object and the per-ActiveGate objects (`ENVIRONMENT_ACTIVE_GATE-…`) are kept separately. On failure, the update-mode gauge, donut slices and checks fall back as described above.

### Network zone settings

Read by `readNetworkZones`: `getSettingsObjects({ schemaIds: "builtin:networkzones.zones,builtin:networkzones", scopes: "environment", fields: "objectId,schemaId,scope,value,updateToken", pageSize: 500 })`, paged. The `builtin:networkzones` object gives `enabled` (false when there is no object). Every `builtin:networkzones.zones` object is keyed by lowercase `value.id`, and `value.fallbackMode` and `value.alternativeZones` are used.

### Target version

`GET /platform/fleet-management/v1/activegate/installer/version/target` returns `{ "version": "1.347.60.20261022-192608" }`. The target configured for the tenant, else the latest available version. Only `version` is used.

### ActiveGate tokens

`GET /platform/fleet-management/v1/activegate/tokens?page-size=3000`, then `?page-key=<nextPageKey>` until no `nextPageKey`. From `activeGateTokens[]` it uses `id`, `name`, `owner`, `creationDate`, `expirationDate`, `lastUsedDate` and `seedToken`. Tokens are matched to ActiveGates by `dt.active_gate.auth_token.id`. Token secrets are never read.

### Support archives

`{nodeId}` is the Smartscape node ID (`ACTIVEGATE-…`, `SYNTHETIC_ENGINE-…` or `ZREMOTE-…`), URL-encoded.

- List: `GET …/support-archives/ACTIVEGATE-0000000000000001?page-size=100`. From `items[]` it uses `id`, `description`, `lookbackDays`, `resourceStatus.status`, `collectedBy`, `collectionTimestamp` and `sizeKb`.
- Start: `POST …/support-archives/ACTIVEGATE-0000000000000001` with `Content-Type: application/json; charset=utf-8`. It uses the returned `id`. Success message: "Collection started. … this list refreshes until it finishes."

  ```json
  { "description": "AWS data lost since Monday", "lookbackDays": 7 }
  ```

- Download: `GET …/support-archives/{nodeId}/{id}:download`. The response body (a blob) is saved in the browser as `activegate-<name with unsafe characters replaced by _>-<id>.zip`.
- Delete or cancel: `DELETE …/support-archives/{nodeId}/{id}`. Message: "Archive canceled or deleted."

Errors are shown with `fleetError`: 403 names the scope, 404 says "Not found (HTTP 404)."

## Remediation actions

### How actions are chosen (diagnosis)

`buildActions` goes through the selected ActiveGate's checks. For each check that is not OK and has a fix group, it adds that group's actions with the check's severity: Blocking, Check or Info, the most severe winning when an action is in several groups. Then it adds the "always" actions, which are put under **More steps** unless they were already rated:

- Collect logs;
- Set the update mode and Update now (host-based) or Update (Dynatrace Operator) (containerized);
- Set the group, and Set the network zone;
- the zone API actions;
- every generic manual action not already listed (generic = with placeholders, not ActiveGate-specific).

| Fix group | Actions |
| --- | --- |
| connectivity | Manual: Restore the ActiveGate connection; API: Collect logs |
| update | API: Update now (update job); Manual: Update the ActiveGate (host-based) |
| update-k8s | Manual: Update a containerized ActiveGate (Dynatrace Operator) |
| auto-update | API: Set the update mode; Manual: Update the ActiveGate (host-based) |
| token | Manual: Rotate the ActiveGate token |
| rejected | Manual: Messages rejected (authorization); Manual: Rotate the ActiveGate token |
| dropped | Manual: Dropped or resent messages (network) |
| resources | Manual: ActiveGate heap, CPU or disk |
| module | Manual: Disable \<module\>, one per module that is not in use |
| aws | Manual: AWS monitoring: data lost or failed requests |
| k8s | Manual: Kubernetes monitoring: API errors and sizing |
| extensions | Manual: Extension not running: \<first configuration not OK or unassigned\> |
| ingest | Manual: Rejected metric or OTLP data points (only offered here, not in the generic list) |
| group | API: Set the ActiveGate group (remote configuration), host-based only; Manual: Set the ActiveGate group or network zone on the ActiveGate |
| zone | Manual: Show the zone's routing on the network zone map (button **Open the network zone map** scrolls to the map); API: Turn on network zones (only when off); API: Set a network zone's fallback and alternative zones; API: Set the network zone (remote configuration), host-based only; Manual: Network zone \<zone\>: alternative zones and fallback |

For containerized ActiveGates, the group and zone API actions are replaced by the manual group / zone action. API actions need their data: the update settings, and the zone settings for the zone actions. When the update settings are not readable, the action shows that message instead of a form.

Every API form uses the shared validate / confirm / apply block (`ApiFix`):

- a summary;
- a collapsed **Request** block with a copy button;
- an **Open the setting** link (Settings app intent `dynatrace.settings` / `open_settings_for_schema`), where it applies;
- a confirmation checkbox;
- **Validate**, which runs the same requests with `validateOnly: true` and changes nothing;
- the apply button, enabled only after you tick the confirmation;
- a result line: green on success, red with the API message on failure.

After a successful apply, the confirmation is cleared and the affected data is re-read. The previous values stay on screen while it reloads.

### Set the update mode

- **Fixes:** automatic updates off (*auto-update* check, Check), and keeps ActiveGates in the supported range. Offered always, and in the diagnosis when the check fires.
- **Fields:**
  - **Apply to**:
    - "This ActiveGate (\<name\>)" (only for a selected host-based ActiveGate; the default then);
    - "Environment default";
    - "Environment default + ActiveGates with their own "No automatic updates" (N)" (the default without a selection). N = host-based ActiveGates whose own object has `updateMode` `MANUAL`.
  - **Update mode**: Automatic (earliest convenience) (`AUTOMATIC`, the default) or No automatic updates (`MANUAL`). *During update window* is left to the setting itself, because it needs update windows.
- **Plan (`updatePlan`):**
  - For each scope with an existing object whose mode differs: one PUT, with value `{updateMode, targetVersion: <the object's targetVersion or "latest">}`. This keeps pinned versions.
  - For scopes without an object: all of them in one POST.
  - Objects already at the chosen mode are skipped. "Nothing to change" when there are no calls.
- **Requests** (shown in the form). Placeholders: `vu9U3hXa3q0AAAAB…` is an object ID; `0x1a2b3c4d` → scope `ENVIRONMENT_ACTIVE_GATE-000000001A2B3C4D`.

```json
{
  "POST /api/v2/settings/objects": [
    { "schemaId": "builtin:deployment.activegate.updates", "scope": "ENVIRONMENT_ACTIVE_GATE-000000001A2B3C4D", "value": { "updateMode": "AUTOMATIC", "targetVersion": "latest" } }
  ],
  "PUT /api/v2/settings/objects/{objectId} (one per object)": [
    { "objectId": "vu9U3hXa3q0AAAABAC...", "scope": "environment", "value": { "updateMode": "AUTOMATIC", "targetVersion": "latest" } }
  ]
}
```

  Each PUT is sent as `PUT /api/v2/settings/objects/{objectId}` with body `{ "value": {…}, "updateToken": "<from the read>" }`. All PUTs run in parallel.
- **Confirm:** `Set "<mode label>" for <where>`; **Apply**.
- **Success:** `Update mode set to "<label>" for <where>. ActiveGates check for updates every 30 minutes.` Failure: the first rejection ("n of m rejected: …").
- With *Environment default*, ActiveGates with their own setting keep it, and the summary says so. Containerized ActiveGates are not affected.
- **Docs:** Update ActiveGate, Fleet Management.

### Update now (update job)

- **Fixes:** version behind the target (host-based). Offered for the selected ActiveGate.
- For containerized ActiveGates it shows the manual Operator update instead.
- The form first lists the last update jobs (`GET /api/v2/activeGates/{agId}/updateJobs?lastUpdates=true`): "state start → target (date): error".
- **Request:**

```text
POST /api/v2/activeGates/0x1a2b3c4d/updateJobs
{
  "targetVersion": "latest",
  "updateType": "ACTIVE_GATE"
}
```

- **Validate** calls `…/updateJobs/validator`: "Validation passed: the ActiveGate accepts an update job to the latest version. Nothing was started."
- **Confirm** "Update \<name\> now"; **Update now** creates the job: "Update job \<state\>: \<start\> → \<target\>. The version on this tab changes once the ActiveGate reports the new one." The job ID is shown. After success the job list is re-read.
- **Docs:** Update ActiveGate.

### Set the ActiveGate group or network zone (remote configuration)

- **Fixes:** extension groups without members, or ActiveGates in the wrong zone.
- **Offered:** in the ActiveGate groups and zones cards; as "Set the group or network zone of ActiveGates" without a selection; as "Set the ActiveGate group" / "Set the network zone" for a selected host-based ActiveGate, which is preselected.
- **Fields:**
  - **Change**: ActiveGate group / Network zone.
  - **Operation**: Set / Clear (for zones, "Clear (default zone)").
  - **Value**: the existing groups or zones, or **New…** with a text box.
  - Checkboxes for every host-based ActiveGate ("· group X" / "· zone Y"). Containerized ActiveGates are listed as "Not offered (containerized)".
- **Client checks:**
  - value required ("Enter the …");
  - zone names must match `^[a-z0-9-_][a-z0-9-_.]{0,255}$` after lowercasing;
  - at most 256 characters;
  - at least one ActiveGate selected.
- **Request** (shown as "validate 1-2 + preview 1 + run 1 call"). The value is trimmed; zone names are lowercased. `clear` has no `value`.

```text
POST /api/v2/activeGates/remoteConfigurationManagement
{
  "entities": ["0x1a2b3c4d", "0x5e6f7a8b"],
  "operations": [{ "attribute": "networkZone", "operation": "set", "value": "aws.us-east-1.prod" }]
}
```

- **Validate** (`planAgRemoteConfig`):
  1. POST the body to `…/validator`.
  2. If the API rejects an operation, stop with "Rejected: \<reason\>".
  3. If it rejects entities, drop them and validate once more. If none are left: "No selected ActiveGate accepts this change."
  4. POST `…/preview`.
  5. Result: "Validation passed: N ActiveGates can be changed[, M skipped]. Nothing was changed. K already have this value. Skipped: \<name\> (\<reasons\>)."
- **Confirm** `Set network zone "aws.us-east-1.prod" on N ActiveGates` (or `Clear the ActiveGate group on N ActiveGates`). It is enabled after a passed validation. **Run job** POSTs the body, with only the valid entities, to `/api/v2/activeGates/remoteConfigurationManagement`.
- **Success:** "Job started for N ActiveGates. No restart is needed; changes take up to 10 minutes." The job ID is shown.
- **409:** "Another remote configuration job is already running. Try again when it finishes." Only one remote configuration job runs at a time, for ActiveGates and OneAgents together.
- Works for host-based ActiveGates 1.237+.
- **Docs:** Remote configuration management, Get started with network zones.

### Set a network zone's fallback and alternative zones

- **Fixes:** zones whose traffic is dropped (fallback None with no ActiveGate), or missing alternatives.
- **Offered:** when the zone settings were read.
- **Fields:**
  - **Network zone**: every zone except `default`, which cannot be modified. Each is labelled "zone (fallback[, not configured])". The default is the selected ActiveGate's zone.
  - **Fallback mode**: Any ActiveGate / Only default zone / None (drop traffic). The current value is preselected.
  - **Alternative zones**: checkboxes for every other zone, with "(N connected ActiveGates)". Their ActiveGates must be reachable from this zone's OneAgents.
  - When only `default` exists: "Only the default network zone exists, and it cannot be modified."
- **Value:** the existing object's value (or `{ "id": "<zone>" }`) with `fallbackMode` and `alternativeZones` (lowercase) replaced.
- **Request** (1 call). For an existing zone:

```json
{ "objectId": "vu9U3hXa3q0AAAABAB...", "value": { "id": "aws.us-east-1.prod", "description": "…", "alternativeZones": ["aws.us-east-2.prod"], "fallbackMode": "ONLY_DEFAULT_ZONE" } }
```

  That is sent as `PUT /api/v2/settings/objects/{objectId}` with `updateToken`. For a zone without an object:

```json
[{ "schemaId": "builtin:networkzones.zones", "scope": "environment", "value": { "id": "aws.us-east-1.prod", "fallbackMode": "ANY_ACTIVE_GATE", "alternativeZones": [] } }]
```

  That is sent as `POST /api/v2/settings/objects`.
- **Confirm** "Change the fallback of \<zone\>"; **Apply**.
- **Success:** "Network zone \<zone\>: fallback \<mode\>[, alternative zones …]." The zone settings are then re-read.
- When zones are off, the summary warns that the change has no effect until they are turned on.
- **Docs:** Get started with network zones, OneAgent connectivity in network zones.

### Turn on network zones

- **Offered:** when `builtin:networkzones` `enabled` is not true (otherwise: "Network zones are already turned on for this environment.").
- **Request:** `PUT /api/v2/settings/objects/{objectId}` with `{ "objectId": "…", "value": { …existing, "enabled": true } }`, or when there is no object `POST` `[{ "schemaId": "builtin:networkzones", "scope": "environment", "value": { "enabled": true } }]`.
- **Confirm** "Turn on network zones for this environment"; **Turn on**.
- **Success:** "Network zones turned on for the environment."
- Plan the zones first; the recommended name pattern is provider.region.availability-zone.datacenter.tier.
- **Docs:** Get started with network zones.

### Collect logs (support archive)

**Open ActiveGate logs [for \<name\>]** scrolls to the logs card with the ActiveGate preselected. The requests are in [Support archives](#support-archives). **Docs:** Fleet Management, ActiveGate diagnostics.

### Manual actions

Each manual action has a **Variant** select (one code block at a time, with a copy button), numbered steps, and optional Notes. Commands below are for a host-based ActiveGate. Placeholders are in `<…>`.

#### Restore the ActiveGate connection

Steps:

1. Fleet Management reports connectivity loss as critical.
2. Check that the main service runs, and restart it.
3. Check the endpoint, the network zone and the proxy (`[http.client]` `proxy-server` / `proxy-port`).
4. Check the token.
5. If the ActiveGate is still offline, collect a local support archive and open a ticket.

agctl needs 1.333+. Docs: ActiveGate health overview, Stop or restart, agctl, Configuration, Security.

```bash
sudo systemctl status dynatracegateway
sudo systemctl restart dynatracegateway
agctl outgoing-endpoint get
agctl network-zone get
agctl property get --section=http.client --key=proxy-server
```

Windows: `net stop "Dynatrace Gateway"` / `net start "Dynatrace Gateway"`, and `"C:\Program Files\dynatrace\gateway\agctl.bat" outgoing-endpoint get`. Kubernetes:

```bash
kubectl get pods -n dynatrace -o wide
kubectl describe pod <activegate-pod> -n dynatrace
kubectl exec -n dynatrace <activegate-pod> -- agctl outgoing-endpoint get
```

#### Update the ActiveGate (host-based)

1. Settings › Fleet management › ActiveGate version and updates › Configure updates.
2. Turning auto-update off is not recommended (more than five versions behind is flagged).
3. Update now: either the API action or the one-click Update in Deployment status.
4. Manual: run the new installer over the old one; custom.properties and launcheruserconfig.conf are kept.

Command: `agctl version get`. Note: the availability check runs every 30 minutes. Docs: Update ActiveGate, Fleet Management, ActiveGate health overview.

#### Update a containerized ActiveGate (Dynatrace Operator)

The target version decides the image. The Operator checks every 15 minutes, and a pinned `spec.activeGate.image` disables auto-update. Docs: Auto-update for Operator managed components, Update ActiveGate, DynaKube parameters.

```yaml
spec:
  activeGate:
    # remove to follow the target version configured in Dynatrace
    image: public.ecr.aws/dynatrace/dynatrace-activegate:<tag>
```

```bash
kubectl get dynakube <dynakube-name> -n dynatrace -o jsonpath='{.status.activeGate.source}'
kubectl get pods -n dynatrace -o wide
```

#### Rotate the ActiveGate token

1. Expiring is 30 days or less, and an expired token disconnects the ActiveGate when token enforcement is on.
2. Create an ActiveGate token: `POST /api/v2/activeGateTokens` with `seedToken: false`, `activeGateType: ENVIRONMENT`, and an expiry at most 2 years ahead.
3. Set `authToken` in `authorization.properties` and restart. On Kubernetes, the Operator rotates the token itself when its token has `activeGateTokenManagement.create`.
4. Fleet Management can filter by Alert type › Token.

Notes: tokens unused for 2 years are deleted (1.272+); the "Default for ActiveGate Token Expiry" alerting profile warns before expiry. Docs: Security, Directories, Restart.

```bash
curl -X POST "https://<environment-id>.live.dynatrace.com/api/v2/activeGateTokens" \
  -H "Authorization: Api-Token <token with Create ActiveGate tokens>" \
  -H "Content-Type: application/json" \
  -d '{"name": "<activegate>", "seedToken": false, "activeGateType": "ENVIRONMENT", "expirationDate": "<at most 2 years ahead>"}'
# /var/lib/dynatrace/gateway/config/authorization.properties (root)
authToken = <new ActiveGate token>
sudo systemctl restart dynatracegateway
```

#### Messages rejected (authorization)

Rejected messages are data loss. Check this ActiveGate's token, and the tokens of the OneAgents, extensions and API clients that send through it. If they are fine, collect a support archive. Variant: [M1](#m1m3-dql-in-manual-actions-not-run). Docs: self-monitoring metrics, Security, Health overview.

#### Dropped or resent messages (network)

Dropped means timeouts; resent is an early warning; a growing queue means data arrives faster than it is sent. Check the network path, proxy, firewall, CPU and heap. Variants: M1, and the commands below. Docs: self-monitoring metrics, agctl, Configuration.

```bash
agctl outgoing-endpoint get
agctl network-zone get
agctl property get --section=http.client --key=proxy-server
agctl property get --section=http.client --key=proxy-port
```

#### ActiveGate heap, CPU or disk

- Heap: compare used with the heap size; rising GC time means the ActiveGate is under-provisioned.
- Kubernetes: working set above 80 % → raise memory requests; throttling above 10 % → raise CPU; OOM kills → raise the limits.
- Disk: disk queue 300 MB, file cache 2 GB / 14 days.

Commands: `df -h /var/lib/dynatrace /var/tmp/dynatrace /var/log/dynatrace`, `top -b -n 1 | head -20` (Kubernetes: `kubectl top pod -n dynatrace`). Docs: self-monitoring metrics, Size ActiveGates in Kubernetes, Configuration, Directories.

#### Enable or disable an ActiveGate module / Disable \<module\>

Host-based: switch the module in custom.properties (never config.properties), or with `agctl modules` (1.333+, only for modules with an agctl name), and restart. Synthetic and zRemote need an installation with that purpose. Containerized: capabilities (`DT_CAPABILITIES` / `spec.activeGate.capabilities`); AWS, Extensions and Memory dumps are not supported in containers. Example for an idle AWS module:

```ini
# Linux: /var/lib/dynatrace/gateway/config/custom.properties
# Windows: %PROGRAMDATA%\dynatrace\gateway\config\custom.properties
[aws_monitoring]
aws_monitoring_enabled = false
```

```bash
agctl modules get
agctl modules disable aws_monitoring
sudo systemctl restart dynatracegateway
```

```yaml
spec:
  activeGate:
    capabilities:
      - routing
      - kubernetes-monitoring
```

Docs: Configuration, agctl, Restart, Containerized configuration, Purposes and functionality.

#### AWS monitoring: data lost or failed requests

- `data_lost_monitoring_status` = 1 means some data was lost.
- Since 1.329 the global STS endpoint is not supported: allow the regional STS endpoint and `tagging/monitoring/ec2.<REGION>.amazonaws.com`.
- Behind a proxy, add the proxy CA to the trust store.
- Authentication errors: check the role or keys and the IAM policy. Role-based access needs the ActiveGate on EC2.
- To reduce API calls, monitor resources by tag (up to 10 tags).
- "Unassigned" means no ActiveGate runs the connection.

Notes: data is collected at 5-minute intervals; an Environment ActiveGate is needed above 2,000 resources. Variants: an IAM base policy (`cloudwatch:GetMetricData`, `GetMetricStatistics`, `ListMetrics`, `sts:GetCallerIdentity`, `tag:GetResources`, `tag:GetTagKeys`, `ec2:DescribeAvailabilityZones`), and `agctl trust-store get`. Docs: CloudWatch metrics, Limit API calls with tags, self-monitoring metrics, agctl.

#### Kubernetes monitoring: API errors and sizing

- 403: RBAC (compare the cluster role with the features you enabled).
- 404 on `apps.openshift.io` deploymentconfigs: expected on clusters that are not OpenShift.
- -1 on `/metrics` or `/metrics/cadvisor`: the node endpoint is unreachable.
- Sizing: throttling above 10 %, working set above 80 %, OOM kills, and pipeline duration above 50–60 s are the thresholds.

Commands: `kubectl get clusterrole | grep dynatrace`, `kubectl top pod -n dynatrace`, and DynaKube `spec.activeGate.resources`. Docs: Size ActiveGates in Kubernetes, Kubernetes monitoring issues, DynaKube parameters.

#### Extension not running

- An ActiveGate needs a group, the Extensions module and a passed endpoint check.
- Every state except OK and IDLE is an error. Allow 5 minutes after a change.
- Performance profiles: Default is 5 % CPU and 500 MB per data source.
- Look at the Health tab and the Log viewer.

Note: x86-64 only; cluster and multi-environment ActiveGates cannot run extensions. Variants: `agctl group get` / `agctl modules get`, `[extension_controller] extension_controller_enabled = true`, and [M2](#m1m3-dql-in-manual-actions-not-run). Docs: About Extensions, Extensions health, Manage extensions, dt.extension.status, Configuration.

#### Rejected metric or OTLP data points

Rejections are split by reason; fix the sender. Variant: M3. Docs: self-monitoring metrics.

#### Set the ActiveGate group or network zone on the ActiveGate

- Host-based 1.237+: prefer the remote configuration action.
- On the host: `agctl group set` / `network-zone set` (1.333+), or custom.properties, then restart.
- Containerized: `spec.activeGate.group` and `spec.networkZone`.

Zone names: lowercase alphanumerics, `-`, `_` and `.` (a dot only as a separator), up to 256 characters. Docs: Remote configuration, agctl, Configuration, DynaKube parameters, network zones.

```bash
agctl group set <group>
agctl network-zone set <zone>
agctl group get
agctl network-zone get
sudo systemctl restart dynatracegateway
```

```ini
[collector]
group = <group>

[connectivity]
networkZone = <zone>
```

```yaml
spec:
  networkZone: <zone>        # OneAgent and ActiveGate pods
  activeGate:
    group: <group>
```

#### Network zone \<zone\>: alternative zones and fallback

1. Turn zones on: Settings › Preferences › Network zones.
2. Edit the zone in Deployment Status › Network zones, or with the Settings API.
3. The three modes are explained above.
4. The default zone cannot be modified.

```json
{
  "schemaId": "builtin:networkzones.zones",
  "scope": "environment",
  "value": {
    "id": "<zone>",
    "alternativeZones": ["<alternative zone>"],
    "fallbackMode": "ANY_ACTIVE_GATE"
  }
}
```

#### Collect ActiveGate logs on the host (agctl support archive)

Use this when the ActiveGate cannot connect or does not start. On 1.333+, run `agctl support-archive create`; on Linux as a user in the service group (`dtuserag`), on Windows in cmd.exe as administrator (not PowerShell). `--days` defaults to 30. Archives collected through Dynatrace mask sensitive data; for multi-environment ActiveGates, collect from the main environment. Containerized 1.325+ supports `--stdout`. Docs: ActiveGate diagnostics, agctl, Directories, Fleet Management.

```bash
agctl support-archive create --days=7 --directory=/tmp
# Windows: "C:\Program Files\dynatrace\gateway\agctl.bat" support-archive create --days=7
kubectl exec -n dynatrace <activegate-pod> -- agctl support-archive create --stdout > ag-support-archive.zip 2> output-logs.txt
# 1.331 and earlier
sudo -u dtuserag /opt/dynatrace/gateway/agctl create-support-archive
```

Log directories (Linux): `/var/log/dynatrace/gateway`, `/var/log/dynatrace/autoupdater`, `/var/log/dynatrace/synthetic`, `/var/log/dynatrace/zremote`, `/var/lib/dynatrace/remotepluginmodule`. On Windows they are under `%PROGRAMDATA%\dynatrace\…`.

## AI Assist on this page

`analyzeActiveGates` in [analyses.ts](../ui/app/analyses.ts) is rule-based. It runs locally in the browser on the data already loaded, only while AI Assist is open, and no data leaves the app.

- **No ActiveGate:** "No environment ActiveGate was found for this timeframe." It recommends deploying an Environment ActiveGate.
- **Summary:** "N ActiveGates, M connected. K are more than five releases behind \<target\> (or: None is …); X extension configurations run on ActiveGate groups, Y not OK."

Insights:

| Rule | Severity |
| --- | --- |
| connected share (always) | good ≥ 90 %, warning ≥ 50 %, else critical; lists the offline names |
| any rejected messages | critical, with counts |
| any dropped messages | warning |
| more than five releases behind | warning, with releases |
| host-based ActiveGates with `MANUAL` (only when settings were read) | warning |
| tokens with ≤ 30 days left or expired | warning |
| modules with problems | warning ("module on ActiveGate") |
| UNASSIGNED extension configurations | critical |
| AWS connections with `agId` `unassigned` | warning |
| Blocking groups | critical, with notes |
| network zones off | info |
| each Blocking / Check zone | critical / warning, with its note |
| modules not in use | info, with counts |
| selected ActiveGate | critical listing its Blocking check titles, or good "no blocking problem" |

Recommendations:

- high: restore the offline ActiveGates;
- high: check tokens when messages are rejected;
- high: fix unassigned extension configurations;
- medium: turn on automatic updates;
- medium: update ActiveGates far behind;
- medium: rotate tokens;
- high: give fallback-None zones an ActiveGate, or change the fallback (when a zone is Blocking);
- low: plan zones and turn them on (when off);
- low (always): idle modules are a review item, not an error.

## Limitations and edge cases

- The gauges, donuts and groups/zones cards ignore the donut slice. Only the matrix, Messages and the ActiveGates table are filtered.
- An ActiveGate with no self-monitoring row shows every metric-rated module as *not in use*. It gets an Info "No self-monitoring data" check and no message or resource checks, and it is left out of the *No message loss* denominator.
- *Within 5 releases* counts an ActiveGate as within when the target is unknown (`?? 0`).
- The Version check's Info text says "target version could not be read" even when only the ActiveGate's own version is missing.
- Releases behind are computed from the minor number (`/2`, rounded up). Patch versions are ignored.
- The group and zone checks on an ActiveGate are always Info or OK, so they never highlight a table cell or raise the row status. Look at the groups and zones tables for Blocking groups and zones.
- The zones table counts every connected ActiveGate of a zone. The map counts only connected ActiveGates with `AGENT_ROUTING`, so a zone whose only connected ActiveGate is, for example, synthetic can be OK in the table and still show dropped or rerouted traffic on the map.
- When the zone settings cannot be read, the map treats every zone as *Any ActiveGate*.
- The update-mode PUT writes only `updateMode` and `targetVersion`. Any other property of the existing object is not carried over.
- The AWS stacked bars are drawn only for ActiveGates with `aws.requests` rows. Data loss for an ActiveGate without requests appears only in the module state.
- Manual-action DQL (M1–M3) is fixed at 24 h.
- Q5 returns at most 500 configurations; events for configurations beyond that are missing.
- Support archives cannot be collected from an offline ActiveGate (the button is disabled); use agctl.
- Fleet Management has no deep link to one ActiveGate.
- Remote configuration does not support containerized ActiveGates. Update jobs and the update mode do not apply to them.

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| "Query failed" on the whole tab | inventory query error, or a missing `storage:smartscape:read` permission | Check the user's storage permissions; open the query in a notebook. |
| Automatic updates gauge "Not readable: Access denied (HTTP 403)…" | user lacks `settings:objects:read` on `builtin:deployment.activegate.updates` | Grant the permission; the other gauges still work. |
| Versions compared with "the newest version in this tenant" | target version read failed (`fleet-management:activegates:download`) | Grant the Fleet Management permission. |
| Token column "—" everywhere | token list not readable | Grant `fleet-management:activegate.tokens:read`. |
| Token "not listed" | the ActiveGate uses a token that is not an ActiveGate token of this environment (for example a tenant token) | Rotate to an ActiveGate token if you want its expiry checked. |
| Every module "not in use", no messages | no `dt.sfm.active_gate.*` data in the timeframe, or the ActiveGate is OneAgent-embedded | Widen the timeframe; check the ActiveGate is connected. |
| "Network zone settings not readable" | `settings:objects:read` on the zone schemas is missing | Grant it; the zone forms are hidden until then. |
| Validate (group / zone) "Rejected: …" or entities skipped | ActiveGate older than 1.237, offline, or an invalid value | Update the ActiveGate, or use agctl / custom.properties. |
| Run job "Another remote configuration job is already running" | one job at a time (OneAgents included) | Wait for it to finish (up to 10 minutes). |
| Update now fails validation | containerized, already on the target, or a missing `fleet-management:activegates:write` permission | Use the Operator steps, or check the permission. |
| Start collection disabled | ActiveGate offline, empty issue, or confirmation not ticked | Fill the form, or use agctl on the host. |
| Support archive list "Access denied (HTTP 403)" | missing support-archive permissions | Grant `fleet-management:activegate.support-archives:*`. |
| "Automatic docs check off" | docs.dynatrace.com is not in the allowed outbound connections | Add it to `builtin:dt-javascript-runtime.allowed-outbound-connections`, then Retry. |
| Map shows traffic dropped but zones are off | the map shows routing as it would be once zones are on | Turn on network zones only after planning them. |

## Related pages

- [Index](README.md): areas, timeframe, shared components.
- [Extensions](extensions.md): uses the same extension queries (Q4, Q5), from the extension side.
- [Databases](databases.md): remote database extensions need an ActiveGate group with the Extensions module.
- [Kubernetes](kubernetes.md): containerized ActiveGates and the Dynatrace Operator.
- [OneAgents](oneagents.md): OneAgent update mode and versions.

## Source files

| File | Role on this page |
| --- | --- |
| [ui/app/tabs/ActiveGatesTab.tsx](../ui/app/tabs/ActiveGatesTab.tsx) | Tab layout, data hook, gauges, donuts, tables, forms, diagnosis, action list |
| [ui/app/activeGates.ts](../ui/app/activeGates.ts) | Model: mapping, modules, versions, update settings, zones, routing, Fleet Management and classic API calls, checks, manual actions |
| [ui/app/tabs/AgCharts.tsx](../ui/app/tabs/AgCharts.tsx) | Custom charts: module matrix, bar lists, stacked bar, line charts, status palette |
| [ui/app/tabs/NetworkZoneMap.tsx](../ui/app/tabs/NetworkZoneMap.tsx) | Network zone map, simulation, side panel, routing table |
| [ui/app/tabs/ModePie.tsx](../ui/app/tabs/ModePie.tsx) | `Donut` |
| [ui/app/queries.ts](../ui/app/queries.ts) | Q1–Q7 |
| [ui/app/analyses.ts](../ui/app/analyses.ts) | `analyzeActiveGates` (AI Assist) |
| [ui/app/tabs/DeepMonitoringTab.tsx](../ui/app/tabs/DeepMonitoringTab.tsx) | `ApiFix`, `ActionPicker`, `DocsStatusLine`, status labels and colours |
| [ui/app/deepMonitoring.ts](../ui/app/deepMonitoring.ts) | `postObjects`, `putObjects`, `settingsLink` |
| [ui/app/RemediationPanel.tsx](../ui/app/RemediationPanel.tsx) | `Field`, `ManualActionView`, `ResultLine`, `Request` |
| [ui/app/components.tsx](../ui/app/components.tsx) | `PctGauge`, `QueryActions`, `QueryState`, `pct` |
| [ui/app/links.ts](../ui/app/links.ts) | Fleet Management, Deployment status, Kubernetes cluster, Extensions app and configuration links |
| [ui/app/deepTech.ts](../ui/app/deepTech.ts), [ui/app/deepDocs.ts](../ui/app/deepDocs.ts) | Docs catalogue and freshness check |
| [app.config.json](../app.config.json) | Scopes |
