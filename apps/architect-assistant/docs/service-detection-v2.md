# Service Detection v2

The Service Detection v2 tab measures how far the tenant has moved its services from Service Detection v1 (SDv1) to
Service Detection v2 (SDv2) and shows where to switch SDv2 on next. It reads every service in Smartscape with its
detection version and the place it runs (Kubernetes namespace, AWS Lambda, a host / process group, mainframe, or no
OneAgent process at all). It classifies every SDv1 service as *Enable (GA)*, *Pilot (Early Access)*, *Review first* or
*Keep on SDv1*, following the "which workloads to activate" guidance in the Dynatrace SDv2 documentation. It groups the
services into the Settings scopes where the *Service Detection v2 for OneAgent* switch would be written, estimates how
many SDv2 services each scope would have after the switch, and counts the frontends and HTTP monitors that still point
at the SDv1 service IDs. It also reads the tenant's SDv2 switches and the built-in detection, splitting and endpoint
rules the docs recommend. The fixes are API actions (switch SDv2 on for Kubernetes, AWS Lambda or generic workloads;
set the built-in rules), each with a Validate-then-Apply flow, plus four manual procedures. Because SDv2 changes
often, the tab checks the Dynatrace docs sitemap on every load and flags pages that changed after the guidance was
written.

| | |
| --- | --- |
| Area | Visibility (see [index](README.md)) |
| Tab id | `sdv2` |
| Counts toward Entity Overview readiness / Top findings | No. Nothing on the Entity Overview reads this tab's data. |
| Main source files | [ui/app/tabs/Sdv2Tab.tsx](../ui/app/tabs/Sdv2Tab.tsx), [ui/app/sdv2.ts](../ui/app/sdv2.ts), [ui/app/queries.ts](../ui/app/queries.ts#L1254) (`sdv2ServicesQuery`), [ui/app/analyses.ts](../ui/app/analyses.ts#L646) (`analyzeSdv2`), [ui/app/deepDocs.ts](../ui/app/deepDocs.ts), [ui/app/deepTech.ts](../ui/app/deepTech.ts) (`DOC`, `DOC_SECTIONS`), [api/docs-freshness.function.ts](../api/docs-freshness.function.ts) |

## Contents

- [What this page answers](#what-this-page-answers)
- [Before you start](#before-you-start)
- [Page walkthrough](#page-walkthrough)
  - [Header, documentation link and AI Assist](#header-documentation-link-and-ai-assist)
  - [Introduction and docs status line](#introduction-and-docs-status-line)
  - [Gauges and tiles](#gauges-and-tiles)
  - [By recommendation and By where they run](#by-recommendation-and-by-where-they-run)
  - [Where to enable SDv2](#where-to-enable-sdv2)
  - [Current SDv2 configuration](#current-sdv2-configuration)
  - [Services](#services)
  - [Remediation actions (overview)](#remediation-actions-overview)
  - [Service Detection v2 documentation](#service-detection-v2-documentation)
  - [Loading, empty and error states](#loading-empty-and-error-states)
- [Checks and scoring](#checks-and-scoring)
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

For an architect planning or tracking the move to SDv2:

- How many services are already detected by SDv2, and how many are still on SDv1?
- How many of the services in the generally available (GA) scope, Kubernetes and AWS Lambda monitored by OneAgent, are
  on SDv2?
- Which Kubernetes namespaces, host groups and Lambda functions still have SDv1 services, and in which of them can SDv2
  be switched on now (GA), piloted (Early Access) or should wait?
- Which workloads should stay on SDv1 for now (application servers, multi-application processes, background
  activity, mainframe), and why?
- How many SDv2 services will a scope have after the switch? SDv2 creates one service per process (or per workload),
  so several SDv1 services usually become fewer SDv2 services.
- Which frontends and HTTP monitors reference SDv1 service IDs that change when a scope switches?
- Where is the *Service Detection v2 for OneAgent* switch on today, and with which matching condition?
- Are the built-in service detection, service splitting and endpoint detection rules set the way the SDv2 docs
  recommend?
- Has the SDv2 documentation changed since this guidance was reviewed?

The best practices it checks come from the SDv2 pages the code cites (`SDV2_DOCS` in
[ui/app/sdv2.ts](../ui/app/sdv2.ts#L31), every page fetched on 2026-10-24):

- SDv2 is generally available for Kubernetes workloads (Dynatrace SaaS 1.323+) and AWS Lambda (1.337+) monitored by
  OneAgent, and is the recommended default there. Generic workloads outside Kubernetes and Lambda are Early Access
  (1.343+). OpenTelemetry services always use SDv2.
- Keep SDv1 for now for WebSphere, WebLogic, J2EE multi-context JVMs and multi-context ColdFusion (several web
  applications or context roots in one process), and for background workloads without an inbound request.
- Switching assigns new service IDs and metric keys. Dashboards, alerts, SLOs and API queries that reference the SDv1
  services stop matching; historical data stays under the old IDs.
- Built-in rules: use `[Built-in] OpenTelemetry service name` and disable its `(deprecated)` twin; split Kubernetes
  services by cluster and namespace and disable the namespace-only split; split by host group and primary cloud fields;
  keep `[Built-in] FaaS name` enabled (SDv2 for Lambda needs it); disable the legacy `GET /*` endpoint fallback; opt in
  to the configurable endpoint detection.

Dynatrace documentation cited by the tab:

- [Service Detection v2](https://docs.dynatrace.com/docs/observe/application-observability/services/service-detection/service-detection-v2)
- [Configure service detection for OneAgent in SDv2](https://docs.dynatrace.com/docs/observe/application-observability/services/service-detection/service-detection-v2/configure-sdv2-for-oneagent)
- [Customize service detection in SDv2](https://docs.dynatrace.com/docs/observe/application-observability/services/service-detection/service-detection-v2/service-detection-v2)
- [Customize endpoint detection in SDv2](https://docs.dynatrace.com/docs/observe/application-observability/services/service-detection/service-detection-v2/endpoint-detection-v2)
- [Customize failure detection in SDv2](https://docs.dynatrace.com/docs/observe/application-observability/services/service-detection/service-detection-v2/failure-detection-v2)
- [Customize service splitting in SDv2](https://docs.dynatrace.com/docs/observe/application-observability/services/service-detection/service-detection-v2/service-splitting-v2)
- [Configure URL path pattern matching in SDv2](https://docs.dynatrace.com/docs/observe/application-observability/services/service-detection/service-detection-v2/url-pattern-matching-v2)
- [Service detection](https://docs.dynatrace.com/docs/observe/application-observability/services/service-detection)
- [Service naming](https://docs.dynatrace.com/docs/observe/application-observability/services/service-naming)
- [Upgrade from service naming rules to service naming](https://docs.dynatrace.com/docs/platform/upgrade/preserve-metrics-and-service-visibility/upgrade-guide-service-naming)
- [Schema: Service Detection v2 for OneAgent](https://docs.dynatrace.com/docs/dynatrace-api/environment-api/settings/schemas/builtin-service-detection-v2-for-oneagent)
- [Schema: Service detection](https://docs.dynatrace.com/docs/dynatrace-api/environment-api/settings/schemas/builtin-service-detection-rules)
- [Schema: Service splitting](https://docs.dynatrace.com/docs/dynatrace-api/environment-api/settings/schemas/builtin-service-splitting-rules)

## Before you start

### App scopes used by this page

From [app.config.json](../app.config.json) and the code of this tab. The tab adds no scope of its own; it reuses scopes
other tabs also request.

| Scope | What this page uses it for |
| --- | --- |
| `storage:smartscape:read` | `smartscapeNodes` / `smartscapeEdges` in `sdv2ServicesQuery`: `SERVICE`, `K8S_NAMESPACE`, `K8S_CLUSTER` and `PROCESS` nodes; `belongs_to`, `runs_on`, `calls` and `monitors` edges. |
| `storage:entities:read` | `fetch dt.entity.service` (technology, web application / context root, software technologies) and `fetch dt.entity.host_group` (classic host group ID by name) in the same query. |
| `settings:objects:read` | The paged read of the six SDv2-related schemas (`readSdv2Settings`). |
| `settings:objects:write` | Remediation: create or update `builtin:service-detection-v2-for-oneagent` objects, and update built-in rule objects of `builtin:service-detection-rules`, `builtin:service-splitting-rules`, `builtin:endpoint-detection-rules` and `builtin:endpoint-detection-rules-opt-in`. Also used for the Validate (dry-run) requests. |

The `docs-freshness` app function needs no app scope; its outbound request to `docs.dynatrace.com` is governed by
the outbound connections allowlist (see [One-time setup](#one-time-setup)).

### User permissions

App scopes only take effect together with the signed-in user's own permissions. To use this tab fully the user needs:

- Grail read access to Smartscape and classic entities (`storage:smartscape:read`, `storage:entities:read`). Without
  them the services query fails and nothing below the introduction is shown.
- Settings read access (`settings:objects:read`) to `builtin:service-detection-v2-for-oneagent`,
  `builtin:service-detection-rules`, `builtin:service-splitting-rules`, `builtin:endpoint-detection-rules`,
  `builtin:endpoint-detection-rules-opt-in` and `builtin:url-path-pattern-matching-rules`. The six schemas are read in
  one request, so a missing permission on any of them fails the whole read.
- Settings write access (`settings:objects:write`) to the schema and scope being changed, only for the API actions.
  Validate uses the same permission check as Apply, so a missing write permission shows up at Validate.
- Access to the Notebooks and Dashboards apps for *Open in Notebook* / *Add to Dashboard*, and to the Settings,
  Infrastructure & Operations and Services apps for the links.

### One-time setup

- **Outbound connections (docs check only).** When `builtin:dt-javascript-runtime.allowed-outbound-connections` is
  enforced, add `docs.dynatrace.com`. Until then the docs status line reads *Automatic docs check off* with a link to
  that setting, the documentation card shows every page as *not checked*, and everything else on the tab works.
- No credential vault entry, OAuth client or token is needed.

## Page walkthrough

### Header, documentation link and AI Assist

Above the tab content the shell shows a right-aligned link *Service Detection v2 documentation* that opens this page
on GitHub (`TabDocsLink` in [ui/app/areas.tsx](../ui/app/areas.tsx)). The timeframe select in the app header (Last
24 hours default, Last 7 days, Last 30 days) changes the services query; the settings read and the docs check do not
depend on it.

When the **AI Assist** header button is on, the tab shows the AI Assist panel first (summary, insights,
recommendations; see [AI Assist on this page](#ai-assist-on-this-page)).

### Introduction and docs status line

A heading *Service Detection v2 adoption* and a fixed paragraph: SDv2 detects and names services from resource
attributes (`k8s.workload.name`, `service.name`, ...) with one rule set for OneAgent and OpenTelemetry, makes one
service per process, is generally available for Kubernetes and AWS Lambda services monitored by OneAgent and Early
Access for other workloads, and switching assigns new service IDs.

Below it, the docs status line (`DocsBanner` in [Sdv2Tab.tsx](../ui/app/tabs/Sdv2Tab.tsx#L162)) reads *Guidance
reviewed against the Dynatrace docs on 2026-10-24; the Service Detection v2 section is checked for changed and new
pages on every load.* followed by the state of the check:

| State | Text |
| --- | --- |
| loading | *Checking the docs…* |
| ok, nothing changed | *No SDv2 page has changed since.* |
| blocked (outbound allowlist) | *Automatic docs check off: add docs.dynatrace.com to the allowed outbound connections (setting ↗).* The link opens `builtin:dt-javascript-runtime.allowed-outbound-connections` in the Settings app. A **Retry** link re-runs the check. |
| error | *Docs check failed: \<message\>* and **Retry**. |

When at least one SDv2 page changed or a new page appeared in the SDv2 docs section, a warning box *The Service
Detection v2 docs changed since this tab was reviewed* lists:

- each cited SDv2 page that changed: *\<title\> — updated YYYY-MM-DD* or *— moved or removed*;
- each other page in the watched SDv2 section that changed, shown as its path with the section prefix replaced by
  *SDv2 docs*, followed by *— updated*;
- each new page in the section: *New page: SDv2 docs/\<path\> (YYYY-MM-DD)*;
- and the note *Checks, defaults and steps on this tab may be out of date until the guidance is reviewed (npm run
  check-docs).*

The 2026-10-24 date is `DOCS_REVIEWED`, the `reviewed` field of
[ui/app/deepDocsSnapshot.json](../ui/app/deepDocsSnapshot.json). How changes are detected is described in
[Docs freshness](#docs-freshness-keeping-the-guidance-current).

### Gauges and tiles

One row of three gauges and four tiles. Gauges are `PctGauge` (custom SVG, 240-degree arc with a red-to-green
gradient, the value is `pct(part, total) = Math.round(part / total * 100)` and 0 when `total` is 0). Tiles are
`ScoreTile` (title, large value, subtitle). All numbers count the services returned by the services query (at most
5,000), after the client-side classification described in [Checks and scoring](#checks-and-scoring).

| Element | Value | Detail / subtitle |
| --- | --- | --- |
| Gauge **Services on SDv2** | services with `dt.service_detection.version == "2"` ÷ all services | *\<sdv2\> of \<total\>* |
| Gauge **Kubernetes / Lambda on SDv2** | services whose context is Kubernetes or AWS Lambda and that are on SDv2 ÷ all services whose context is Kubernetes or AWS Lambda (SDv1 and SDv2) | *\<n\> of \<m\> (GA scope)*, or *no services in GA scope* (gauge 0%) |
| Gauge **Recommended rules in place** | built-in rule checks that pass ÷ built-in rule checks found (up to 8) | *\<ok\> of \<checks\>* once the settings are read; *settings not readable* when the read failed; *loading…* while it runs (gauge 0% in both cases) |
| Tile **Ready to enable (GA)** | number of SDv1 services with recommendation *Enable (GA)* | *SDv1 services in \<n\> scopes*: scope rows of *Where to enable SDv2* with recommendation *Enable SDv2 (GA)* |
| Tile **Early Access candidates** | services with recommendation *Pilot (Early Access)* + *Review first* | *\<n\> to review first* (the *Review first* count) |
| Tile **Keep on SDv1** | services with recommendation *Keep on SDv1* | *app servers, background, mainframe* |
| Tile **SDv2 switches on** | `builtin:service-detection-v2-for-oneagent` objects (any scope) with at least one switch on; *—* until the settings are read | *scopes in SDv2 for OneAgent* |

"At least one switch on" means one of the lines `describeObject` builds for the object contains `: on` (Kubernetes,
FaaS or generic workloads). A generic-workload switch that is on but whose condition matches nothing (empty or starting
with `false`) still counts here; the configuration card marks it *— matches nothing*.

### By recommendation and By where they run

A card with two custom SVG donuts (`Donut` in [ui/app/tabs/ModePie.tsx](../ui/app/tabs/ModePie.tsx#L28)), centre
label *services*, followed by the query actions for the services query.

**By recommendation** (*Click a slice to filter the services table.*): one slice per recommendation that has at least
one service. Colours are fixed palette slots ([ui/app/kubernetes.ts](../ui/app/kubernetes.ts) `categoryColor`, light /
dark theme steps):

| Slice | Colour slot | Meaning |
| --- | --- | --- |
| On SDv2 | 6 (green) | Detected by SDv2 already (OpenTelemetry services always are). |
| Enable (GA) | 1 (blue) | Kubernetes or AWS Lambda service on OneAgent: SDv2 is generally available and the recommended default. |
| Pilot (Early Access) | 3 (aqua) | One service per process outside Kubernetes and Lambda (web servers, single-service apps): SDv2 for generic workloads, Early Access. |
| Review first | 4 (yellow) | Fits SDv2 for generic workloads, but something changes beyond the new service ID (custom services are ignored under SDv2). |
| Keep on SDv1 | neutral grey | The docs say to keep these on SDv1 for now, or no SDv2 for OneAgent scope covers them. |

**By where they run** (*Decides which SDv2 switch applies (Kubernetes, FaaS, generic workloads).*): one slice per
context with at least one service, SDv1 and SDv2 together:

| Slice | Colour slot |
| --- | --- |
| Kubernetes | 1 (blue) |
| AWS Lambda | 2 (orange) |
| Host / VM (generic workload) | 3 (aqua) |
| Mainframe (CICS / IMS) | 5 (magenta) |
| No OneAgent process (OpenTelemetry, ingest) | 7 (violet) |

Behaviour of both donuts: hovering a slice or legend row widens the slice, dims the others and shows its value and
label in the centre; the native tooltip is *\<label\>: \<n\> (\<percent\>%)*. The legend lists every slice with count
and rounded percent. Clicking a slice (or legend row) sets the matching filter of the [Services](#services) table
(*Recommendation* or *Runs on*); clicking the selected slice again clears it. The donuts and the table selects share
the same state, so a value picked in the table's select also highlights the slice. With no services the card shows
*No services.*

Below the donuts: **Show DQL / Copy / Open in Notebook / Add to Dashboard** for the services query (title *Services by
detection version and context*); see [Query 1](#1-services-by-detection-version-and-context-sdv2servicesquery).

### Where to enable SDv2

Card `ScopesCard` ([Sdv2Tab.tsx](../ui/app/tabs/Sdv2Tab.tsx#L293)), data from `scopeRows`
([sdv2.ts](../ui/app/sdv2.ts#L335)). The hint reads: *Kubernetes namespaces and AWS Lambda can switch now (generally
available); host groups outside Kubernetes use the Early Access for generic workloads, scoped to the process groups
that fit one service per process. The estimate counts workloads (Kubernetes) or process groups (generic): SDv2 makes
one service per process instead of one per SDv1 service type. References from frontends and HTTP monitors point at
today's SDv1 service IDs.*

One row per scope where an SDv2 for OneAgent switch could be written:

| Row kind (second line of the Scope cell) | One row per | Settings scope the switch is written to | Label |
| --- | --- | --- | --- |
| Kubernetes namespace | first namespace of each Kubernetes service (classic `CLOUD_APPLICATION_NAMESPACE-…` ID) | the namespace | *\<cluster\> / \<namespace\>* |
| Host group | host group of each generic-workload service (classic `HOST_GROUP-…` ID) | the host group | host group name |
| Environment (no host group) | all generic-workload services without a resolvable host group, together | `environment` | *Hosts without a host group* |
| Environment (FaaS) | all AWS Lambda services, together | `environment` | *AWS Lambda functions* |

Mainframe services and services with no OneAgent process belong to no row (no SDv2 for OneAgent switch covers them).

Columns:

| Column | Content | Source |
| --- | --- | --- |
| Scope | The label; for host groups it links to the host group in Infrastructure & Operations. Second line: the row kind and an *SDv2 setting ↗* link that opens `builtin:service-detection-v2-for-oneagent` in the Settings app at that scope (without a scope for `environment`). | `ScopeRow.label`, `kind`, `scope` |
| Services now | *\<n\> SDv1 · \<m\> SDv2* | SDv1 and SDv2 services in the row |
| SDv2 services after (est.) | *~\<after\>*, or *—* when the row has no SDv1 service | `ScopeRow.after`, see below |
| Recommendation | Coloured dot and label (table below). Extra hint lines: *Keep on SDv1: a, b, c +N more* when the row has process groups that must stay on SDv1, and *Pilot: …* for *Pilot selected process groups*. Hover a hint for the full list. | `ScopeRow.verdict`, `kept`, `candidates` |
| SDv2 switch now | *Off (no SDv2 object)* when no object applies; *Off (\<where\>)* when the deciding object has the switch off; *On at \<where\>* plus *where \<condition\>* when a condition is set. *\<where\>* is the scope of the object that decides (for example *Environment* or *Cluster prod-cluster* for a namespace that inherits). | `ScopeRow.setting` from `effectiveSwitch` |
| Frontend / monitor references | Sum of frontend `calls` edges and HTTP monitor `monitors` edges pointing at the row's SDv1 services | `frontends + monitors` per SDv1 service |

Row recommendation (`ScopeVerdict`):

| Label | Dot colour | Rule |
| --- | --- | --- |
| Enable SDv2 (GA) | blue | Namespace or Lambda row with at least one SDv1 service. |
| Pilot the host group (Early Access) | aqua | Host group row with SDv1 services, at least one process group to pilot and none to keep on SDv1. |
| Pilot selected process groups (Early Access) | yellow | Host group row with process groups to pilot and some to keep on SDv1, or the *Hosts without a host group* row with process groups to pilot. |
| Keep on SDv1 | grey | Host group / no-host-group row whose SDv1 services all have *Keep on SDv1*. |
| Done: all on SDv2 | green | Row with no SDv1 service left. |

Estimate *SDv2 services after*: for a namespace, the number of distinct Kubernetes workloads of its SDv1 services (a
service with no workload edge counts as one on its own); for Lambda, one per SDv1 service; for host-group and
no-host-group rows, the number of process groups that can be piloted. Example: a namespace whose two SDv1 services
(`checkout`, `orders`) run in one deployment shows *2 SDv1 · 0 SDv2* and *~1*.

Rows are sorted by recommendation (Enable, Pilot the host group, Pilot selected, Keep, Done), then by SDv1 count
descending, then by label. Columns are sortable and resizable (the *Services now* column sorts as text). Pagination:
15 rows per page (15 / 30 / 60). Empty state: *No services in Kubernetes, AWS Lambda or on hosts in this timeframe.*

### Current SDv2 configuration

Card `SettingsCard` ([Sdv2Tab.tsx](../ui/app/tabs/Sdv2Tab.tsx#L371)), from the settings read
([API call 1](#1-read-the-sdv2-settings)). While the read runs it shows *Loading SDv2 settings…*; when it fails, a red
box *Could not read the SDv2 settings* with the API error replaces the card.

Left column:

- **SDv2 for OneAgent switches**: one block per `builtin:service-detection-v2-for-oneagent` object, environment first,
  then by scope ID. The title links to the setting at that scope; the scope is named *Environment*, *Host group
  \<name\>*, *Cluster \<name\>* or *Namespace \<cluster\> / \<namespace\>* when the name is known from the services
  query, otherwise the raw scope ID. The lines come from `describeObject` ([sdv2.ts](../ui/app/sdv2.ts#L293)):
  - *Kubernetes: on where \<condition\>*, *Kubernetes: on (all workloads)* (empty condition) or *Kubernetes: off*;
  - *FaaS: on where \<conditionForFaaS\>* (*(always)* when empty) or *FaaS: off* (only when the property is `false`);
  - *Generic workloads: on where \<conditionForAnyWorkload\>* with *— matches nothing* when the condition is empty or
    starts with `false` (the schema default), or *Generic workloads: off* (only when the property is `false`).

  The block border is green when any line contains `: on`, orange otherwise. With no object at all: *Not configured
  at any scope: OneAgent services use SDv1 (OpenTelemetry services always use SDv2).*
- **Settings pages**: links that open each schema in the Settings app, with a count:

  | Link | Schema | Count |
  | --- | --- | --- |
  | Service Detection v2 for OneAgent | `builtin:service-detection-v2-for-oneagent` | number of objects (*scopes*) |
  | Service detection | `builtin:service-detection-rules` | rules whose name does not start with `[Built-in]` (*custom rules*) |
  | Service splitting | `builtin:service-splitting-rules` | custom rules, same rule |
  | Endpoint detection | `builtin:endpoint-detection-rules` | custom rules, same rule |
  | URL path pattern matching | `builtin:url-path-pattern-matching-rules` | all rules |
  | Failure detection | `builtin:failure-detection-rulesets` | none (this schema is not read) |

Right column, **Built-in rules the docs recommend**: one line per rule check (see
[Built-in rule checks](#built-in-rule-checks)), green with *✓* when it passes and orange with *!* when it does not.
Text: *\<rule\> is enabled|disabled* (the current state), *— recommended: enabled|disabled* when it does not pass, the
reason, and *Open setting ↗* (the rule's schema in the Settings app). When none of the documented rules exists on the
tenant: *None of the documented built-in rules were found.*

### Services

Card `ServicesCard` ([Sdv2Tab.tsx](../ui/app/tabs/Sdv2Tab.tsx#L442)): every service from the query, filtered on the
client.

Filters (all client-side, no query re-runs):

| Control | Options | Effect |
| --- | --- | --- |
| Name contains | free text, placeholder *e.g. checkout* | case-insensitive substring match on the service name |
| Recommendation | Any, On SDv2, Enable (GA), Pilot (Early Access), Review first, Keep on SDv1 | keeps services with that recommendation; shared with the *By recommendation* donut |
| Runs on | Any, Kubernetes, AWS Lambda, Host / VM (generic workload), Mainframe (CICS / IMS), No OneAgent process (OpenTelemetry, ingest) | keeps services with that context; shared with the *By where they run* donut |

Next to the filters: *\<n\> services* (rows after filtering).

| Column | Content |
| --- | --- |
| Service | Service name, linked to the service in the Services app (intent `dynatrace.services` / `view-entity-dt.smartscape.service` with the Smartscape node ID and the selected timeframe). |
| Detection | *SDv2*, or *SDv1 · \<type\>* with `dt.service.sdv1_type` in title case (for example *SDv1 · Web Request Service*, *SDv1 · Custom Service*; *Unknown* when empty). |
| Runs on | *\<context label\>: \<detail\>*. Kubernetes: *\<cluster\> / \<namespace\>* for each namespace. AWS Lambda: *\<n\> Lambda function(s)*. Otherwise: *host group \<names\>* (or *no host group* for a generic workload without one) and the process group names, joined with *·*; when there is nothing: *OpenTelemetry or ingested spans* (SDv2) or *no process context* (SDv1). The context label here is *No OneAgent process* (without the parenthesis used in the select). |
| Recommendation | Coloured dot and recommendation label. |
| Why | The reasons collected during classification, joined (see [Recommendation per service](#recommendation-per-service)). |
| Frontend / monitor refs | Frontends calling the service + HTTP monitors monitoring it (edge counts). |

Sorting: by service name (query order) until you click a column header; all columns sortable and resizable.
Pagination: 25 rows per page (10 / 25 / 50 / 100). Empty state: *No services match.* When the query returned 5,000
services: *Showing the first 5,000 services.*

### Remediation actions (overview)

Card `Sdv2Actions` ([Sdv2Tab.tsx](../ui/app/tabs/Sdv2Tab.tsx#L867)), detailed in [Remediation actions](#remediation-actions).
The header line reads *\<n\> SDv1 services in scopes SDv2 for OneAgent can cover; \<m\> scopes ready to enable now; \<k\>
built-in rules to fix first.* (the last part only when a rule check fails). *n* is the SDv1 count summed over all rows
of *Where to enable SDv2* (including services with *Keep on SDv1* inside host-group rows); *m* is the number of rows
with *Enable SDv2 (GA)*.

The **Action** select lists, in this order (API actions only once the settings are read):

1. API · Apply recommended built-in rules
2. API · Enable SDv2 for Kubernetes workloads
3. API · Enable SDv2 for AWS Lambda (FaaS)
4. API · Pilot SDv2 for generic workloads (Early Access)
5. Manual · Update dashboards, alerts and SLOs after the switch
6. Manual · Replace GET /* endpoint names with URL path patterns
7. Manual · Name services at the source (OTEL_SERVICE_NAME)
8. Manual · Adjust SDv2 service names with a detection rule

The first entry is selected by default. While the settings load: *Loading settings for the API actions…*; if the read
failed: *The API actions need the SDv2 settings, which could not be read.* (only the manual actions are listed).
Above the selected action, an orange note appears when a docs page cited by that action changed after the review
(*Dynatrace changed a page behind this fix after this guidance was reviewed (2026-10-24): \<title\> (updated
YYYY-MM-DD). Read it before acting; SDv2 is changing quickly.*). Below it: *Documentation for this fix:* and the
action's docs links.

### Service Detection v2 documentation

Card `DocsCard` ([Sdv2Tab.tsx](../ui/app/tabs/Sdv2Tab.tsx#L229)), the last element of the tab. Hint: *Dates are the
docs sitemap's last-modified dates. A page newer than the reviewed version, or a new page in the SDv2 section, means
the feature changed: read it, update this tab (sdv2.ts) and record the review with npm run check-docs -- --accept.*

Rows: first every new page found in the SDv2 docs section (title = its path below the section), then the 13 cited
pages of `SDV2_DOCS` in this order. The reviewed dates are the ones in the bundled snapshot (reviewed 2026-10-24):

| Page | Reviewed version |
| --- | --- |
| Service Detection v2 | 2026-07-14 |
| Configure service detection for OneAgent in SDv2 | 2026-07-14 |
| Customize service detection in SDv2 | 2026-09-28 |
| Customize endpoint detection in SDv2 | 2026-06-30 |
| Customize failure detection in SDv2 | 2025-11-24 |
| Customize service splitting in SDv2 | 2026-04-20 |
| Configure URL path pattern matching in SDv2 | 2026-07-14 |
| Service detection | 2025-10-25 |
| Service naming | 2026-09-28 |
| Upgrade from service naming rules to service naming | 2026-08-28 |
| Schema: Service Detection v2 for OneAgent | 2025-09-25 |
| Schema: Service detection | 2025-06-30 |
| Schema: Service splitting | 2025-06-30 |

Columns:

| Column | Content |
| --- | --- |
| Page | Title, linked to the docs page. |
| Reviewed version | Sitemap date recorded in the snapshot at the last review; *—* for new pages or pages not in the snapshot. |
| Live (sitemap) | Current sitemap date; *not in sitemap* when the page is gone; *—* while the check has not succeeded. |
| Status | *Unchanged*; *Updated since review* or *Moved or removed* (bold orange); *New page* (bold orange); *not checked* while loading, blocked or failed. |

Sortable, resizable, no pagination.

### Loading, empty and error states

- The heading, introduction and docs status line always render. Everything else (gauges, donuts, both tables, the
  configuration card, Remediation actions and the documentation card) is wrapped in the services query state: *Loading…*
  until the first result, and a red *Query failed* box with the error instead of all of it when the query fails.
- The settings read is independent: the services part renders while it is still loading; the third gauge, the
  *SDv2 switches on* tile, the configuration card and the API actions show their own loading or error text.
- The docs check is independent of both; a blocked or failed check only affects the status line, the change notes
  and the documentation card.
- With no services in the timeframe: gauges 0%, tiles 0, donuts *No services.*, *Where to enable SDv2* and *Services*
  show their empty texts, and AI Assist reports that adoption cannot be assessed.

## Checks and scoring

### Where a service runs (context)

`toService` ([sdv2.ts](../ui/app/sdv2.ts#L121)) assigns exactly one context, first match wins:

| Order | Context | Rule |
| --- | --- | --- |
| 1 | AWS Lambda (`FAAS`) | the service has at least one `runs_on` edge to an `AWS_LAMBDA_FUNCTION` (`lambdas > 0`) |
| 2 | Kubernetes (`K8S`) | the service has at least one `belongs_to` edge to a `K8S_NAMESPACE` |
| 3 | Mainframe (`MAINFRAME`) | `dt.service.sdv1_type` starts with `CICS` or `IMS`, or the classic `agentTechnologyType` is `Z` |
| 4 | Host / VM, generic workload (`GENERIC`) | at least one `runs_on` edge to a `PROCESS` (`processes > 0`) |
| 5 | No OneAgent process (`OTHER`) | anything else (OpenTelemetry or other ingested spans) |

The context is computed for SDv2 services too; it drives the second donut and the *Kubernetes / Lambda on SDv2* gauge.

### Recommendation per service

`classify` ([sdv2.ts](../ui/app/sdv2.ts#L153)). Every rule also appends the reason text shown in the *Why* column.

| Order | Condition | Recommendation | Reason text |
| --- | --- | --- | --- |
| 1 | `dt.service_detection.version` is `"2"` | On SDv2 | *OpenTelemetry or ingested service: always detected by SDv2.* (context `OTHER`) or *Already detected by SDv2.* |
| 2 | SDv1, context Kubernetes | Enable (GA) | *Kubernetes on OneAgent: SDv2 is GA and the recommended default.* |
| 3 | SDv1, context AWS Lambda | Enable (GA) | *AWS Lambda on OneAgent: SDv2 is GA (needs the [Built-in] FaaS name rule).* |
| 4 | SDv1, context Mainframe | Keep on SDv1 | *CICS / IMS service: not one of the SDv2 for OneAgent scenarios (Kubernetes, AWS Lambda, generic workloads).* |
| 5 | SDv1, context No OneAgent process | Keep on SDv1 | *No process, Kubernetes or Lambda context, so no SDv2 for OneAgent scope applies.* |
| 6 | SDv1 generic, `dt.service.sdv1_type == "BACKGROUND_ACTIVITY"` | Keep on SDv1 | *Background activity without an inbound request: SDv2 detection is built around inbound request spans; keep SDv1 for now.* |
| 7 | SDv1 generic, a software technology of the service has `type:` matching `WEBSPHERE` or `WEBLOGIC` (case-insensitive) | Keep on SDv1 | *\<WEBSPHERE \| WEBLOGIC...\> application server: keep SDv1 for now while Dynatrace tests these setups.* |
| 8 | SDv1 generic, more than one distinct web application ID / context root on one of its processes (`appsOnProcess > 1`) | Keep on SDv1 | *\<n\> web applications / context roots run in one process: SDv2 would group them into one service; keep SDv1 for the per-application split.* |
| 9 | SDv1 generic, `dt.service.sdv1_type == "CUSTOM_SERVICE"` | Review first | *Custom service: SDv2 ignores SDv1 custom services; these spans join the process's SDv2 service.* |
| 10 | SDv1 generic, anything else | Pilot (Early Access) | *Web server outside Kubernetes: a good fit for generic workloads (Early Access).* when the technology is `NGINX`, `APACHE` or `IIS`, else *One application per process outside Kubernetes: fits generic workloads (Early Access).* |

Extra reasons appended:

- *\<n\> SDv1 services in this process become one SDv2 service (their requests stay apart as endpoints).* when more
  than one SDv1 service runs on one of the service's processes (`servicesOnProcess > 1`): for Enable (GA) services,
  and for generic services that are not Keep.
- The custom-service sentence for Kubernetes and Lambda custom services (which stay *Enable (GA)*).
- *Containerized, but not linked to a Kubernetes namespace: on ECS, Cloud Run or Container Apps add the cloud
  connection first so SDv2 can use cloud attributes.* for generic services that are not Keep and run in a container
  (`process.containerized` true on one of their processes).

### Recommendation per scope

`scopeRows` ([sdv2.ts](../ui/app/sdv2.ts#L335)):

1. Each service with context Kubernetes goes to the row of its first namespace (`ns:<namespace ID>`); Lambda services
   go to one `faas` row; generic services go to the row of their first host group that has a classic ID
   (`hg:<HOST_GROUP-…>`) or to the `hg:none` row. Mainframe and No-OneAgent services are skipped.
2. Per row: SDv2 services increment `sdv2`; SDv1 services increment `sdv1` and add `frontends + monitors` to
   `dependents`.
3. Namespace and Lambda rows: `after` as described in [Where to enable SDv2](#where-to-enable-sdv2); verdict *Enable*
   when there is an SDv1 service, else *Done*.
4. Host group and no-host-group rows: every process group of an SDv1 service is a *candidate* if the service is not
   Keep, or *kept* if it is. A process group with any Keep service is removed from the candidates (it stays on SDv1
   as a whole). `after` = number of candidates. Verdict: *Done* with no SDv1 service; *Keep* with no candidate;
   *Pilot selected process groups* when some process group is kept or the row is the no-host-group row; otherwise
   *Pilot the host group*.
5. The current switch per row comes from `effectiveSwitch` ([sdv2.ts](../ui/app/sdv2.ts#L270)): the most specific
   scope that has an SDv2 for OneAgent object decides, as in the Settings hierarchy (namespace, then cluster, then
   environment for Kubernetes; host group, then environment for generic workloads; environment for FaaS). Kubernetes:
   on when `enableSDV2ForKubernetesWorkloads` is true. FaaS: on when `enableSDV2ForFaaS` is true (condition defaults to
   `isNotNull(aws.region) and isNotNull(aws.account.id)`). Generic: on when `enableSDV2ForAnyWorkload` is true and the
   condition is non-empty and does not start with `false`.

### Built-in rule checks

`ruleChecks` ([sdv2.ts](../ui/app/sdv2.ts#L486)). Rules are found by display name (`value.rule.ruleName`,
case-insensitive, first match across all scopes). A check whose rule object does not exist on the tenant is left out
(it does not count in the gauge). A rule object counts as enabled unless `value.enabled` is `false`.

| Check (title) | Rule | Schema | In place when | Pre-selected in the fix | Effect of fixing (shown in orange) |
| --- | --- | --- | --- | --- | --- |
| Use the current OpenTelemetry service name rule | `[Built-in] OpenTelemetry service name` | `builtin:service-detection-rules` | enabled | yes | Changes the service IDs of SDv2 services the rule matches (new IDs, historical data stays under the old ones). |
| Disable the deprecated OpenTelemetry service name rule | `[Built-in] OpenTelemetry service name (deprecated)` | `builtin:service-detection-rules` | disabled | yes | same |
| Split Kubernetes services by cluster and namespace | `[Built-in] Split services by k8s cluster and namespace` | `builtin:service-splitting-rules` | enabled | yes | same |
| Disable the deprecated namespace-only split | `[Built-in] Split services by k8s namespace (deprecated)` | `builtin:service-splitting-rules` | disabled | yes | same |
| Split services by host group and primary cloud fields | `[Built-in] Split services by host group and primary cloud fields` | `builtin:service-splitting-rules` | enabled | only when the tenant has generic-workload services | same |
| Keep the FaaS name rule enabled | `[Built-in] FaaS name` | `builtin:service-detection-rules` | enabled | yes | Lambda services detected by SDv2 are named after faas.name. |
| Use automatic endpoint names for services without http.route | `[Built-in] HTTP fallback for derived route (legacy naming)` | `builtin:endpoint-detection-rules` | disabled | yes | Endpoint names of matching services change (new endpoints, the old ones stop receiving data). |
| Opt in to the configurable endpoint detection | *Enable endpoint detection* | `builtin:endpoint-detection-rules-opt-in` (environment object only) | `value.enabled === true` | yes | Breaks existing SDv2 endpoints: compare them first (the docs link a comparison dashboard). |

The reasons shown under each check:

- OpenTelemetry service name: *The docs recommend enabling it (it skips service.name = unknown_service); it is on by
  default for environments created in 1.337+.* Deprecated twin: *The docs recommend disabling it in favour of the rule
  above.*
- Cluster-and-namespace split: *Default for environments created in 1.317+: the same workload name in two clusters is
  two services instead of one.* Namespace-only split: *Replaced by the cluster-and-namespace split; disabled by default
  for environments created in 1.317+.*
- Host group and cloud split: *Default for environments created in 1.337+: keeps the same service in different host
  groups, AWS accounts / regions, Azure subscriptions or GCP projects apart (useful before piloting generic
  workloads).*
- FaaS name: *SDv2 for AWS Lambda only works when this rule is enabled.* (with *(no Lambda services found)* appended
  when the tenant has none).
- Derived route: *Environments created before 1.342 keep GET /\* endpoint names; disabling this rule activates the
  derived routes (GET /shop/products/ instead of GET /\*).*
- Endpoint opt-in (only when the environment object exists; no object means the tenant already uses the configurable
  endpoint rules): *Endpoints created before August 2025 use hard-coded rules; the opt-in enables the default rule set
  (server and consumer spans only) and custom endpoint rules.*

### Gauge and tile formulas

| Name | In place when | Numerator | Denominator | Thresholds / notes |
| --- | --- | --- | --- | --- |
| Services on SDv2 | `sdVersion == "2"` | SDv2 services | all services returned (max 5,000) | Gauge colour is a continuous gradient. AI Assist rates the same percentage: ≥ 90 good, ≥ 50 warning, below critical. |
| Kubernetes / Lambda on SDv2 | context K8S or FAAS and SDv2 | those services | services with context K8S or FAAS | 0% when there are none. |
| Recommended rules in place | rule check passes | passing checks | checks found (0 to 8) | 0% until the settings are read or when none is found. |
| Ready to enable (GA) | service recommendation Enable (GA) | count | none | |
| Early Access candidates | Pilot or Review first | count | none | |
| Keep on SDv1 | Keep on SDv1 | count | none | |
| SDv2 switches on | SDv2 for OneAgent object with any switch on | count of objects | none | Includes generic switches whose condition matches nothing. |

### Documentation status

| Status | Rule (`toState` in [deepDocs.ts](../ui/app/deepDocs.ts#L42)) |
| --- | --- |
| Updated since review | Live sitemap date is later than the snapshot date (string comparison of ISO dates), or the page is cited but not in the snapshot. |
| Moved or removed | The page is not in the sitemap (`null` from the function), or a snapshot page of the watched section is no longer listed under the section. |
| New page | A page under the SDv2 section prefix that is neither cited nor in the snapshot. |
| Unchanged | Otherwise. |
| not checked | The check is loading, blocked or failed. |

## Queries

| # | Name (function in source) | Runs when | Feeds |
| --- | --- | --- | --- |
| 1 | Services by detection version and context (`sdv2ServicesQuery` in [queries.ts](../ui/app/queries.ts#L1265)) | When the tab is shown; again when the timeframe changes | Every gauge and tile except *Recommended rules in place* and *SDv2 switches on*, both donuts, *Where to enable SDv2*, the scope names in *Current SDv2 configuration*, *Services*, the remediation forms, AI Assist |
| 2 | New SDv2 services (`SDV2_SERVICES_DQL` in [sdv2.ts](../ui/app/sdv2.ts#L608)) | Never run by the app; shown as copyable text in the manual action *Update dashboards, alerts and SLOs after the switch* | Your own check after a switch |

### 1. Services by detection version and context (sdv2ServicesQuery)

- **Source:** `sdv2ServicesQuery(tf)` in [ui/app/queries.ts](../ui/app/queries.ts#L1265); executed with `useDql` in
  `Sdv2Tab` ([Sdv2Tab.tsx](../ui/app/tabs/Sdv2Tab.tsx#L933)).
- **Runs:** on tab load. The SDK hook re-runs it whenever the query text changes, which only happens when the timeframe
  changes. Filters, donut clicks, settings reloads and remediation writes do not re-run it.
- **Parameters:** `tf` (timeframe). All 14 `from:now()-24h` occurrences become `from:now()-7d` (Last 7 days) or
  `from:now()-30d` (Last 30 days). The workload types list comes from `WORKLOAD_TYPES` in queries.ts; the row limit is
  `SDV2_SERVICE_LIMIT` = 5000.
- **Query** (24 hours):

```dql
smartscapeNodes "SERVICE", from:now()-24h
| fields id, sid = toString(id), name, sdVersion = dt.service_detection.version, sdv1Type = dt.service.sdv1_type
| lookup [fetch dt.entity.service, from:now()-24h
    | fields id, tech = agentTechnologyType, appKey = coalesce(webApplicationId, contextRoot), softwareTechnologies
  ], sourceField:sid, lookupField:id, fields:{tech, appKey, softwareTechnologies}
| lookup [smartscapeEdges "belongs_to", from:now()-24h
    | filter source_type == "SERVICE" and target_type == "K8S_NAMESPACE"
    | lookup [smartscapeNodes "K8S_NAMESPACE", from:now()-24h | fields id, nsName = name, nsId = id_classic, nsCluster = k8s.cluster.name], sourceField:target_id, lookupField:id, fields:{nsName, nsId, nsCluster}
    | summarize namespaces = collectDistinct(record(id = nsId, name = nsName, cluster = nsCluster)), by:{source_id}
  ], sourceField:id, lookupField:source_id, fields:{namespaces}
| lookup [smartscapeEdges "belongs_to", from:now()-24h
    | filter source_type == "SERVICE" and target_type == "K8S_CLUSTER"
    | lookup [smartscapeNodes "K8S_CLUSTER", from:now()-24h | fields id, clName = name, clId = id_classic], sourceField:target_id, lookupField:id, fields:{clName, clId}
    | summarize clusters = collectDistinct(record(id = clId, name = clName)), by:{source_id}
  ], sourceField:id, lookupField:source_id, fields:{clusters}
| lookup [smartscapeEdges "belongs_to", from:now()-24h
    | filter source_type == "SERVICE" and in(target_type, {"K8S_DEPLOYMENT", "K8S_STATEFULSET", "K8S_DAEMONSET", "K8S_JOB", "K8S_CRONJOB", "K8S_REPLICASET", "K8S_REPLICATIONCONTROLLER", "K8S_DEPLOYMENTCONFIG"})
    | summarize workloads = collectDistinct(toString(target_id)), by:{source_id}
  ], sourceField:id, lookupField:source_id, fields:{workloads}
| lookup [smartscapeEdges "runs_on", from:now()-24h
    | filter source_type == "SERVICE" and target_type == "AWS_LAMBDA_FUNCTION"
    | summarize lambdas = countDistinct(target_id), by:{source_id}
  ], sourceField:id, lookupField:source_id, fields:{lambdas}
| lookup [smartscapeEdges "runs_on", from:now()-24h
    | filter source_type == "SERVICE" and target_type == "PROCESS"
    | lookup [smartscapeEdges "runs_on", from:now()-24h
        | filter source_type == "SERVICE" and target_type == "PROCESS"
        | fieldsAdd src = toString(source_id)
        | lookup [fetch dt.entity.service, from:now()-24h | fields id, appKey = coalesce(webApplicationId, contextRoot)], sourceField:src, lookupField:id, fields:{appKey}
        | summarize servicesOnProcess = countDistinct(source_id), appsOnProcess = countDistinct(appKey), by:{target_id}
      ], sourceField:target_id, lookupField:target_id, fields:{servicesOnProcess, appsOnProcess}
    | lookup [smartscapeNodes "PROCESS", from:now()-24h
        | fields id, hostGroup = dt.host_group.id, pgId = dt.process_group.id, pgName = dt.process_group.detected_name, containerized = process.containerized
      ], sourceField:target_id, lookupField:id, fields:{hostGroup, pgId, pgName, containerized}
    | lookup [fetch dt.entity.host_group, from:now()-24h | fields hgId = id, hgName = entity.name], sourceField:hostGroup, lookupField:hgName, fields:{hgId}
    | summarize processes = countDistinct(target_id), servicesOnProcess = max(servicesOnProcess), appsOnProcess = max(appsOnProcess),
        hostGroups = collectDistinct(record(id = hgId, name = hostGroup)), processGroups = collectDistinct(record(id = pgId, name = pgName)), containerized = max(toLong(containerized)),
        by:{source_id}
  ], sourceField:id, lookupField:source_id, fields:{processes, servicesOnProcess, appsOnProcess, hostGroups, processGroups, containerized}
| lookup [smartscapeEdges "calls", "monitors", from:now()-24h
    | filter target_type == "SERVICE" and (source_type == "FRONTEND" or source_type == "HTTP_MONITOR")
    | summarize frontends = countIf(source_type == "FRONTEND"), monitors = countIf(source_type == "HTTP_MONITOR"), by:{target_id}
  ], sourceField:id, lookupField:target_id, fields:{frontends, monitors}
| fields id, name, sdVersion, sdv1Type, tech, appKey, softwareTechnologies, namespaces, clusters, workloads, lambdas, processes, servicesOnProcess, appsOnProcess, hostGroups, processGroups, containerized, frontends, monitors
| sort name asc
| limit 5000
```

- **How it works:**
  1. `smartscapeNodes "SERVICE", from:now()-24h`: every Smartscape service node that existed in the timeframe,
     OneAgent and OpenTelemetry alike.
  2. `fields id, sid = toString(id), name, sdVersion = dt.service_detection.version, sdv1Type = dt.service.sdv1_type`:
     keeps the node ID, a string copy of it (`sid`, needed to join classic tables, whose `id` is a string), the name,
     the detection version (`"1"` or `"2"`) and, for SDv1 services, the SDv1 service type (for example
     `WEB_REQUEST_SERVICE`, `CUSTOM_SERVICE`, `BACKGROUND_ACTIVITY`, `CICS…`).
  3. First `lookup` into classic `dt.entity.service` by `sid`: `tech` = `agentTechnologyType` (the code module
     technology, `N/A` when none), `appKey` = the web application ID or, if missing, the context root, and
     `softwareTechnologies` (used to detect WebSphere / WebLogic).
  4. Namespace lookup: `smartscapeEdges "belongs_to"` filtered to `SERVICE → K8S_NAMESPACE`; a nested lookup into
     `K8S_NAMESPACE` nodes adds the namespace name, its classic ID (`id_classic`, a `CLOUD_APPLICATION_NAMESPACE-…` ID,
     the Settings scope of a namespace) and `k8s.cluster.name`; `summarize collectDistinct(record(...)), by:{source_id}`
     gives each service an array `namespaces` of `{id, name, cluster}`.
  5. Cluster lookup: same pattern for `SERVICE → K8S_CLUSTER` edges, with the cluster's classic ID
     (`KUBERNETES_CLUSTER-…`, the Settings scope of a cluster) and name, as `clusters`.
  6. Workload lookup: `belongs_to` edges to any Kubernetes workload type; `collectDistinct(toString(target_id))` gives
     `workloads`, the workload node IDs (used for the *after* estimate).
  7. Lambda lookup: `runs_on` edges `SERVICE → AWS_LAMBDA_FUNCTION`; `countDistinct(target_id)` as `lambdas`.
  8. Process lookup (`runs_on` edges `SERVICE → PROCESS`), with three nested lookups per edge:
     - a second scan of the same edges, joined to classic `dt.entity.service` for `appKey`, summarized per process:
       `servicesOnProcess` = distinct services on the process, `appsOnProcess` = distinct web application IDs / context
       roots on the process;
     - the `PROCESS` node: `dt.host_group.id` (the host group *name*), `dt.process_group.id`,
       `dt.process_group.detected_name` and `process.containerized`;
     - classic `dt.entity.host_group` matched on `entity.name` = the host group name, giving the classic
       `HOST_GROUP-…` ID (`hgId`), the Settings scope of a host group.

     Then `summarize ... by:{source_id}` per service: `processes` (distinct processes), the maximum
     `servicesOnProcess` and `appsOnProcess` over its processes, `hostGroups` as `{id: HOST_GROUP-…, name}` records,
     `processGroups` as `{id, name}` records, and `containerized` = 1 when any process is containerized.
  9. Dependents lookup: `smartscapeEdges "calls", "monitors"` into the service from `FRONTEND` or `HTTP_MONITOR`
     nodes; `countIf` per source type gives `frontends` and `monitors` (edge counts).
  10. `fields ...` keeps the output columns, `sort name asc`, `limit 5000`.
- **Output** (one row per service) and use:

  | Column | Used for |
  | --- | --- |
  | `id` | Service link (Services app), row identity |
  | `name` | Service column, name filter, sort |
  | `sdVersion` | SDv1 / SDv2 (`"2"` = SDv2; anything else, including null, = SDv1) |
  | `sdv1Type` | Detection column; Mainframe context; Background / custom service rules |
  | `tech` | Mainframe (`Z`); web server wording (`NGINX`, `APACHE`, `IIS`) |
  | `appKey` | Returned but not read by the UI (the per-process count `appsOnProcess` is what the rules use) |
  | `softwareTechnologies` | WebSphere / WebLogic detection (`type:<TECH>` in each entry) |
  | `namespaces`, `clusters` | Kubernetes context, namespace rows, cluster options, scope names |
  | `workloads` | *after* estimate for namespace rows |
  | `lambdas` | AWS Lambda context, *Runs on* detail |
  | `processes` | Generic context |
  | `servicesOnProcess` | "become one SDv2 service" reason |
  | `appsOnProcess` | multi-application Keep rule |
  | `hostGroups` | host group rows, scope names, host-group links and conditions |
  | `processGroups` | candidates / kept process groups, process group conditions, *Runs on* detail |
  | `containerized` | containerized reason |
  | `frontends`, `monitors` | *Frontend / monitor references* and *refs* columns, AI Assist |
- **Limits and cost:** at most 5,000 services (sorted by name, so the alphabetically last services are dropped beyond
  that and the tables say *Showing the first 5,000 services*). Each lookup only keeps the first matching record per
  key; the summarize steps make the keys unique. The code comment records a validation on the demo tenant: 123
  services in 0.4 s for 24 hours. Longer timeframes also include services and edges that existed earlier in the window
  (including services that were replaced, for example SDv1 services that already moved to SDv2).
- **Open it yourself:** yes, *Show DQL / Copy / Open in Notebook / Add to Dashboard* below the donuts (title *Services
  by detection version and context*).

### 2. New SDv2 services (SDV2_SERVICES_DQL)

- **Source:** `SDV2_SERVICES_DQL` in [ui/app/sdv2.ts](../ui/app/sdv2.ts#L608), shown in the manual action *Update
  dashboards, alerts and SLOs after the switch* (variant *New SDv2 services (DQL)*).
- **Runs:** never by the app. It is displayed with a *Copy* button for you to run after a switch.
- **Parameters:** none; the window is fixed to the last 2 hours (services that reported recently).
- **Query:**

```dql
smartscapeNodes "SERVICE", from:now()-2h
| filter dt.service_detection.version == "2"
| fields id, name
| sort name asc
```

- **How it works:** service nodes of the last 2 hours, only those detected by SDv2, with their ID and name, by name.
  Use the IDs to repoint dashboards, alerts and SLOs.
- **Output:** `id`, `name`.
- **Limits and cost:** no limit; small (one node type, no joins).
- **Open it yourself:** *Copy* only (no Notebook / Dashboard actions).

### Client-side processing

The meaning of the numbers on the tab depends on these steps after Query 1 returns:

1. `toService` turns each record into a `ServiceRow`: de-duplicates the `namespaces`, `clusters`, `hostGroups` and
   `processGroups` records (by ID, or name when there is no ID; records without both are dropped), extracts the first
   software technology type matching `WEBSPHERE|WEBLOGIC`, treats `tech == "N/A"` as empty, and sets the context
   ([Where a service runs](#where-a-service-runs-context)).
2. `classify` sets the recommendation and reasons ([Recommendation per service](#recommendation-per-service)).
3. `scopeRows` groups the services into rows ([Recommendation per scope](#recommendation-per-scope)) and reads the
   current switch per row from the settings (when they are not read yet, every row shows *Off (no SDv2 object)* until
   they are).
4. `ruleChecks` builds the rule checks from the settings and the services (whether any Lambda or generic service
   exists changes one reason text and one pre-selection).
5. `scopeNames` maps namespace, cluster and host group IDs to display names for the configuration card.

## API calls

| # | Method | Endpoint or SDK method | Scope | When |
| --- | --- | --- | --- | --- |
| 1 | GET (paged) | `settingsObjectsClient.getSettingsObjects` → `/platform/classic/environment-api/v2/settings/objects` | `settings:objects:read` | Tab load; after every successful Apply |
| 2 | POST | `settingsObjectsClient.postSettingsObjects` → `/platform/classic/environment-api/v2/settings/objects?validateOnly=…` | `settings:objects:write` | Validate / Apply of the Kubernetes, FaaS and generic actions, for scopes without an SDv2 object |
| 3 | PUT | `settingsObjectsClient.putSettingsObjectByObjectId` → `/platform/classic/environment-api/v2/settings/objects/{objectId}?validateOnly=…` | `settings:objects:write` | Validate / Apply: existing SDv2 objects, built-in rule objects |
| 4 | POST | `functions.call("docs-freshness", …)` → app function `/api/docs-freshness` | none (app function) | Once per page load (shared with other tabs); *Retry* |
| 5 | GET | `fetch("https://docs.dynatrace.com/docs/sitemap.xml")` inside the function | outbound allowlist | Each docs-freshness call |
| 6 | DQL | `useDql` (`@dynatrace-sdk/react-hooks`) | `storage:smartscape:read`, `storage:entities:read` | Query 1 |
| 7 | Intents | `sendIntent`, `getIntentLink` (`@dynatrace-sdk/navigation`) | none | Query actions and links |

The request previews in the UI write the Settings paths as `/api/v2/settings/objects…` (the classic Environment API
v2 path); the SDK sends the same requests through the platform gateway path shown above.

### 1. Read the SDv2 settings

- **Source:** `readSdv2Settings` ([sdv2.ts](../ui/app/sdv2.ts#L223)), called by `useSdv2Settings`
  ([Sdv2Tab.tsx](../ui/app/tabs/Sdv2Tab.tsx#L108)).
- **Request:** `GET /platform/classic/environment-api/v2/settings/objects?schemaIds=builtin:service-detection-v2-for-oneagent,builtin:service-detection-rules,builtin:service-splitting-rules,builtin:endpoint-detection-rules,builtin:endpoint-detection-rules-opt-in,builtin:url-path-pattern-matching-rules&fields=objectId,schemaId,scope,value,updateToken&pageSize=500`,
  then `GET …?nextPageKey=<key>` until the response has no `nextPageKey`. No `scopes` parameter: objects of every scope
  are returned.
- **Response fields used:** `items[].objectId`, `schemaId`, `scope`, `value`, `updateToken`.
  - `builtin:service-detection-v2-for-oneagent`: one object per scope (`environment`, `HOST_GROUP-…`,
    `KUBERNETES_CLUSTER-…`, `CLOUD_APPLICATION_NAMESPACE-…`), keyed by scope. Value properties read:
    `enableSDV2ForKubernetesWorkloads`, `condition`, `enableSDV2ForFaaS`, `conditionForFaaS`,
    `enableSDV2ForAnyWorkload`, `conditionForAnyWorkload`.
  - Rule schemas: `value.enabled` (enabled unless `false`) and `value.rule.ruleName`.
  - `builtin:endpoint-detection-rules-opt-in`: only the `environment` object, `value.enabled`.
- **Errors:** any rejection shows *Could not read the SDv2 settings* with the message; the tab then has no
  configuration card, no rule checks and only manual remediation actions.
- **Reload:** after each successful Apply the hook re-runs this read; the services query does not re-run.

### 2. Create SDv2 for OneAgent objects

- **Source:** `applyChanges` ([sdv2.ts](../ui/app/sdv2.ts#L445)) → `postObjects`
  ([deepMonitoring.ts](../ui/app/deepMonitoring.ts#L759)).
- **Request:** one `POST /platform/classic/environment-api/v2/settings/objects?validateOnly=true` (Validate) or
  `validateOnly=false` (Apply) with every new object in one array:

```json
[
  {
    "schemaId": "builtin:service-detection-v2-for-oneagent",
    "scope": "CLOUD_APPLICATION_NAMESPACE-0000000000000001",
    "value": {
      "enableSDV2ForKubernetesWorkloads": true,
      "condition": ""
    }
  }
]
```

- **Response used:** the per-item `code`; the first item with code ≥ 400 fails the action with its `error.message` (or
  *Rejected (HTTP \<code\>).*). Exceptions are reduced to the API error message(s).

### 3. Update settings objects

- **Source:** `putObjects` ([deepMonitoring.ts](../ui/app/deepMonitoring.ts#L770)), called by `applyChanges` and
  `applyRuleFixes` ([sdv2.ts](../ui/app/sdv2.ts#L600)).
- **Request:** one `PUT /platform/classic/environment-api/v2/settings/objects/{objectId}?validateOnly=true|false` per
  object, all in parallel. The body carries the full new value and the `updateToken` from the read (optimistic
  locking; the previews in the UI omit the token):

```json
{
  "value": { "...": "full value, see the remediation actions" },
  "updateToken": "<updateToken from the GET>"
}
```

- **Response used:** `code` per call; any code ≥ 400 gives *\<n\> of \<m\> rejected: \<first error message\>*.

### 4. docs-freshness app function

- **Source:** `load` in [ui/app/deepDocs.ts](../ui/app/deepDocs.ts#L89); function
  [api/docs-freshness.function.ts](../api/docs-freshness.function.ts).
- **When:** the first component that needs the result (the docs status line, the change notes, the documentation card,
  or another tab using the same check) triggers one call per page load; all share the result. *Retry* clears it and
  calls again.
- **Request:** `POST /api/docs-freshness` with body `{ "urls": [...], "prefixes": [...] }`. `urls` are the 123 distinct
  `docs.dynatrace.com` URLs of the whole `DOC` catalogue in [deepTech.ts](../ui/app/deepTech.ts) (the SDv2 tab uses 13
  of them); `prefixes` is the SDv2 section:

```json
{
  "urls": [
    "https://docs.dynatrace.com/docs/ingest-from/technology-support",
    "https://docs.dynatrace.com/docs/whats-new/technology/end-of-support-news",
    "… 121 more"
  ],
  "prefixes": [
    "https://docs.dynatrace.com/docs/observe/application-observability/services/service-detection/service-detection-v2"
  ]
}
```

- **What the function does:** keeps URLs that start with `https://docs.dynatrace.com/` (at most 300) and prefixes (at
  most 10, trailing slashes removed); fetches the sitemap; builds a map of `<loc>` → `<lastmod>`; returns `pages`
  (lastmod per requested URL, `null` when not in the sitemap) and `sections` (every sitemap page equal to or below a
  prefix, at most 200 pages in total).
- **Response:**

```json
{
  "status": "ok",
  "checkedAt": "2026-10-25T08:00:00.000Z",
  "pages": {
    "https://docs.dynatrace.com/docs/observe/application-observability/services/service-detection/service-detection-v2": "2026-07-14T00:00:00.000Z"
  },
  "sections": {
    "https://docs.dynatrace.com/docs/observe/application-observability/services/service-detection/service-detection-v2/configure-sdv2-for-oneagent": "2026-07-14T00:00:00.000Z"
  }
}
```

  or `{ "status": "blocked", "message": "NotCapable: Blocked request to 'docs.dynatrace.com' (host not in allowlist)" }`
  when the runtime blocks the host (message matching `allowlist` or `NotCapable`), or `{ "status": "error", "message":
  "The docs sitemap returned HTTP <code>." }` / the fetch error.
- **Failures of the call itself:** HTTP 404 becomes *the docs-freshness app function is not available in this running
  app (HTTP 404). App functions are loaded when npx dt-app dev starts and when the app is deployed: restart the dev
  server (or deploy), then retry.*; other HTTP errors become *the docs-freshness app function returned HTTP \<code\>:
  \<first 300 characters of the body\>*.

### 5. Docs sitemap

`GET https://docs.dynatrace.com/docs/sitemap.xml` from the app function (about 1.3 MB, about 5,400 pages, per the
function's header comment). Only `<loc>` / `<lastmod>` pairs are read. The browser cannot read the docs site directly
(no CORS), hence the function.

### 6 and 7. DQL execution and navigation

- Query 1 runs through `useDql` ([ui/app/useDql.ts](../ui/app/useDql.ts)), a wrapper around the
  `@dynatrace-sdk/react-hooks` hook that executes it in Grail.
- *Open in Notebook*: `sendIntent({ "dt.query": <query>, title }, { recommendedAppId: "dynatrace.notebooks",
  recommendedIntentId: "view-query" })`. *Add to Dashboard*: same payload with `dynatrace.dashboards` /
  `add-to-dashboard`.
- Settings links: `getIntentLink({ "settings.schemaId": <schema>, "settings.entityId": <scope> }, "dynatrace.settings",
  "open_settings_for_schema")`; `settings.entityId` is omitted for the environment.
- Host group links: `getIntentLink({ "dt.entity.host_group": "HOST_GROUP-…" }, "dynatrace.infraops",
  "view_host_group")`.
- Service links: `getIntentLink({ nodeId: <service id>, "dt.timeframe": { from, to } }, "dynatrace.services",
  "view-entity-dt.smartscape.service")`, with `from` / `to` covering the selected timeframe.

## Remediation actions

### Common flow of the API actions

Every API action uses the same `WriteFlow` ([Sdv2Tab.tsx](../ui/app/tabs/Sdv2Tab.tsx#L534)):

1. The form builds the request. A collapsed *Request (…)* section shows it, with a *Copy* button. When the form is not
   valid, an orange message replaces the request and *Validate* is disabled.
2. An orange note repeats the ID warning (Kubernetes, FaaS and generic actions): *SDv2 assigns new service IDs and
   metric keys to matching services: dashboards, alerts, SLOs and API queries that reference the SDv1 services stop
   matching. Historical data stays under the old IDs.*
3. **Validate** sends the same request(s) with `validateOnly=true` (*the Settings API checks values and matching
   conditions, nothing is saved*). The result line is green (*Validation passed. Nothing was changed.*) or red with the
   API message.
4. After a successful Validate, a confirmation checkbox and the Apply button appear. Apply is enabled only when the box
   is ticked.
5. Apply sends the request(s) with `validateOnly=false`. On success the result line shows the action's message and the
   settings are read again ([API call 1](#1-read-the-sdv2-settings)), so the configuration card, rule checks, current
   switches and the third gauge update. The services, donuts and recommendations only change when the query re-runs
   (timeframe change or reload) and new SDv2 data has arrived.
6. Any change to the form (and therefore to the request text) resets Validate and the confirmation.

`applyChanges` sends one POST for all scopes without an SDv2 object first, then one PUT per existing object. If the
POST fails, the PUTs are not sent. If the POST succeeds and a PUT fails during Apply, the created objects stay.

### Apply recommended built-in rules

- **Fixes:** built-in rule checks that do not pass.
- **Offered when:** the settings are read. With no failing check it shows *Every built-in rule the docs recommend is
  already set as recommended.*
- **Form:** one orange block per failing check: a checkbox *Enable|Disable \<rule\>* (pre-ticked when the check is
  recommended; *Split services by host group and primary cloud fields* only when there are generic-workload services),
  the reason, and the impact in orange. Intro: *Sets the built-in detection, splitting and endpoint rules to the values
  the SDv2 docs recommend. One PUT per rule; only the enabled flag changes.*
- **Validation:** none ticked → *Select at least one rule.*
- **Request** (*Request (\<n\> PUT)*): one PUT per ticked rule; the body is the rule's current value with `enabled` set
  to the recommended value. Example for a tenant where four rules and the opt-in differ (values shortened to the rule
  name; the real request repeats the whole stored value):

```json
// PUT /api/v2/settings/objects/vu9U3hXa3q0AAAABAB9idWlsdGluOnNlcnZpY2UtZGV0ZWN0aW9uLXJ1bGVzAAAAAAAAAAAAAAAAAAAAAAAAAAAAMDE  ([Built-in] OpenTelemetry service name)
{
  "value": {
    "enabled": true,
    "rule": {
      "ruleName": "[Built-in] OpenTelemetry service name",
      "serviceNameTemplate": "{service.name}"
    }
  }
}

// PUT /api/v2/settings/objects/vu9U3hXa3q0AAAABAB9idWlsdGluOnNlcnZpY2UtZGV0ZWN0aW9uLXJ1bGVzAAAAAAAAAAAAAAAAAAAAAAAAAAAAMDI  ([Built-in] OpenTelemetry service name (deprecated))
{
  "value": {
    "enabled": false,
    "rule": {
      "ruleName": "[Built-in] OpenTelemetry service name (deprecated)"
    }
  }
}

// PUT /api/v2/settings/objects/vu9U3hXa3q0AAAABAB9idWlsdGluOnNlcnZpY2Utc3BsaXR0aW5nLXJ1bGVzAAAAAAAAAAAAAAAAAAAAAAAAAAAAMDM  ([Built-in] Split services by host group and primary cloud fields)
{
  "value": {
    "enabled": true,
    "rule": {
      "ruleName": "[Built-in] Split services by host group and primary cloud fields"
    }
  }
}

// PUT /api/v2/settings/objects/vu9U3hXa3q0AAAABAB9idWlsdGluOmVuZHBvaW50LWRldGVjdGlvbi1ydWxlcwAAAAAAAAAAAAAAAAAAAAAAAAAAMDQ  ([Built-in] HTTP fallback for derived route (legacy naming))
{
  "value": {
    "enabled": false,
    "rule": {
      "ruleName": "[Built-in] HTTP fallback for derived route (legacy naming)"
    }
  }
}

// PUT /api/v2/settings/objects/vu9U3hXa3q0AAAABAB9idWlsdGluOmVuZHBvaW50LWRldGVjdGlvbi1ydWxlcy1vcHQtaW4AAAAAAAAAAAAAAAAAMDU  (Enable endpoint detection)
{
  "value": {
    "enabled": true
  }
}
```

  Each PUT also carries the object's `updateToken`.
- **Confirmation:** *Update \<n\> built-in rule(s). I understand that matching services or endpoints get new IDs.*;
  button **Apply recommended built-in rules**.
- **Success:** *\<n\> rule(s) updated. New detection applies to data received from now on.*
- **Documentation for this fix:** Customize service detection in SDv2, Customize service splitting in SDv2, Customize
  endpoint detection in SDv2.

### Enable SDv2 for Kubernetes workloads

- **Fixes:** Kubernetes services on SDv1 (rows *Enable SDv2 (GA)* of kind namespace).
- **Offered when:** the settings are read.
- **Intro:** *Turns on Enable Service detection v2 for Kubernetes workloads (generally available, Dynatrace SaaS
  1.323+). Start with namespaces in lower environments; a more specific scope overrides the cluster and the
  environment.*
- **Form fields:**

  | Field | Options / behaviour |
  | --- | --- |
  | Scope | *Namespaces (staged rollout)* (default), *Clusters*, *Environment*. Changing it clears the selection. |
  | Matching condition (optional) | Free text, placeholder `e.g. dt.agent.module.type == "java"`. Hint: *Empty condition = every workload in the scope. Allowed: primary Grail fields, OneAgent primary tags, resource and custom attributes (tags set by OpenPipeline are not available).* Trimmed before sending. |
  | Recommended (\<n\>) / Clear | Namespaces / Clusters only. *Recommended* ticks the namespaces with recommendation *Enable SDv2 (GA)* (those with SDv1 services) or the clusters with SDv1 services. |
  | Checkbox list | Namespaces: *Namespace \<cluster\> / \<namespace\>* with *\<n\> SDv1 → ~\<after\> SDv2* and *· already on* when the effective switch is on. Clusters (from the namespaces' clusters, most SDv1 services first): *Cluster \<name\>* with *\<n\> SDv1 services in \<m\> namespaces*. Environment: no list, the environment is the target. With no Kubernetes services: *No Kubernetes services in this timeframe.* |

- **Change list:** one line per target, *\<label\>: update the existing object* or *new object*.
- **Validation:** no target → *Select at least one scope.*; a condition longer than 1000 characters → *\<label\>: the
  condition has \<n\> characters; the schema allows 1000. …*
- **Request** (*Request (1 POST|no POST + \<n\> PUT)*): new objects get `enableSDV2ForKubernetesWorkloads: true` and
  the condition; existing objects keep every other property. Two namespaces without an object:

```json
// POST /api/v2/settings/objects (1 call)
[
  {
    "schemaId": "builtin:service-detection-v2-for-oneagent",
    "scope": "CLOUD_APPLICATION_NAMESPACE-0000000000000001",
    "value": {
      "enableSDV2ForKubernetesWorkloads": true,
      "condition": ""
    }
  },
  {
    "schemaId": "builtin:service-detection-v2-for-oneagent",
    "scope": "CLOUD_APPLICATION_NAMESPACE-0000000000000002",
    "value": {
      "enableSDV2ForKubernetesWorkloads": true,
      "condition": ""
    }
  }
]
```

  Environment scope with an existing object and a condition:

```json
// PUT /api/v2/settings/objects/vu9U3hXa3q0AAAABAC1idWlsdGluOnNlcnZpY2UtZGV0ZWN0aW9uLXYyLWZvci1vbmVhZ2VudAAGdGVuYW50AAZ0ZW5hbnQAJDAwMDAwMDAw
{
  "value": {
    "enableSDV2ForKubernetesWorkloads": true,
    "condition": "dt.agent.module.type == \"java\"",
    "enableSDV2ForFaaS": false,
    "conditionForFaaS": "isNotNull(aws.region) and isNotNull(aws.account.id)",
    "enableSDV2ForAnyWorkload": false,
    "conditionForAnyWorkload": "false"
  }
}
```

  Cluster targets use `KUBERNETES_CLUSTER-…` scopes; the environment target uses `environment`.
- **Confirmation:** *Switch SDv2 on for Kubernetes workloads in \<n\> scope(s). I understand that matching services
  get new IDs.*; button **Enable SDv2 for Kubernetes**.
- **Success:** *SDv2 is on for Kubernetes workloads in \<n\> scope(s). New services appear as new data arrives.*
- **Documentation for this fix:** Configure service detection for OneAgent in SDv2; Schema: Service Detection v2 for
  OneAgent.

### Enable SDv2 for AWS Lambda (FaaS)

- **Fixes:** AWS Lambda services on SDv1 (row *AWS Lambda functions*).
- **Offered when:** the settings are read (also when no Lambda service was found).
- **Intro:** *Turns on Enable Service detection v2 for FaaS at the environment (generally available, Dynatrace SaaS
  1.337+).* followed by *\<n\> AWS Lambda service(s) is/are on SDv1.* or *No AWS Lambda services were found in this
  timeframe.*, and *Already on [where \<condition\>].* when the environment switch is on. When the `[Built-in] FaaS
  name` check exists and fails, an orange line says: *The [Built-in] FaaS name rule is disabled: SDv2 for Lambda only
  works when it is enabled. Turn it on with Apply recommended built-in rules.*
- **Form fields:** *Matching condition for FaaS*, pre-filled with the schema default
  `isNotNull(aws.region) and isNotNull(aws.account.id)` (hint: *The schema default is …*). An empty value is sent as the
  default. The scope is always `environment`.
- **Validation:** the 1000-character limit.
- **Request** (*Request (1 PUT)* or *Request (1 POST)*). With an existing environment object:

```json
// PUT /api/v2/settings/objects/vu9U3hXa3q0AAAABAC1idWlsdGluOnNlcnZpY2UtZGV0ZWN0aW9uLXYyLWZvci1vbmVhZ2VudAAGdGVuYW50AAZ0ZW5hbnQAJDAwMDAwMDAw
{
  "value": {
    "enableSDV2ForKubernetesWorkloads": false,
    "condition": "",
    "enableSDV2ForFaaS": true,
    "conditionForFaaS": "isNotNull(aws.region) and isNotNull(aws.account.id)",
    "enableSDV2ForAnyWorkload": false,
    "conditionForAnyWorkload": "false"
  }
}
```

  Without one:

```json
// POST /api/v2/settings/objects (1 call)
[
  {
    "schemaId": "builtin:service-detection-v2-for-oneagent",
    "scope": "environment",
    "value": {
      "enableSDV2ForKubernetesWorkloads": false,
      "enableSDV2ForFaaS": true,
      "conditionForFaaS": "isNotNull(aws.region) and isNotNull(aws.account.id)"
    }
  }
]
```

- **Confirmation:** *Switch SDv2 on for AWS Lambda functions. I understand that matching services get new IDs.*;
  button **Enable SDv2 for FaaS**.
- **Success:** *SDv2 is on for FaaS. New services appear as new data arrives.*
- **Documentation for this fix:** Configure service detection for OneAgent in SDv2; Customize service detection in
  SDv2.

### Pilot SDv2 for generic workloads (Early Access)

- **Fixes:** generic-workload services with *Pilot (Early Access)* or *Review first*.
- **Offered when:** the settings are read.
- **Intro:** *Turns on Enable Service detection v2 for generic workloads (Early Access, Dynatrace SaaS 1.343+) for the
  process groups you pick: web servers and single-service processes outside Kubernetes and Lambda. A whole host group
  gets `dt.host_group.id == …`, otherwise the condition lists the process groups (`dt.process_group.detected_name ==
  …`), as in the docs examples.* Notes:
  - *Application servers and multi-application processes (WebSphere, WebLogic, multi-context JVMs) and background
    workloads are left out: keep them on SDv1.*
  - *SDv1 custom services are ignored under SDv2; request attributes keep working. Add your cloud connection first for
    workloads on ECS, Cloud Run or Container Apps.*
  - *Update the service detection and splitting rules for these workloads first (Apply recommended built-in rules).*
- **Form fields:**

  | Field | Behaviour |
  | --- | --- |
  | I understand this is an Early Access feature | Required. Without it: *Confirm the Early Access notes above first.* |
  | Process group list | One block per host-group row and the *Hosts without a host group* row that has process groups to pilot. Header: *Host group \<name\>* (or *Hosts without a host group*) and *keep on SDv1: \<process groups\>* or *no workloads to keep on SDv1*. One checkbox per candidate process group with *\<n\> SDv1 service(s)* and *· review: custom service* when one of its services is *Review first*. Pre-ticked when all of its SDv1 services in that row are *Pilot*. With nothing to pilot: *No generic workloads to pilot in this timeframe.* |

- **Condition per scope:**
  - Host group row, every candidate ticked and nothing kept: `dt.host_group.id == "<host group name>"` at the
    `HOST_GROUP-…` scope.
  - Otherwise: `dt.process_group.detected_name == "<name>"` per ticked process group, joined with ` or `, at the
    host group scope (or `environment` for hosts without a host group). Names are quoted and escaped with `dqlString`.
  - When the object already has a generic switch that is on and matches something, the existing condition is kept
    and OR-ed: `(<old>) or (<new>)`, with the change-list note *Keeps the current condition and adds the new one with
    OR.* If the old condition already contains the new one, it is sent unchanged. A default `false…` condition is
    replaced.
- **Validation:** Early Access box, at least one scope, and every condition at most 1000 characters (*Select fewer
  process groups or pilot the host group.*).
- **Request** (*Request (1 POST|no POST + \<n\> PUT)*). Whole host group without an object:

```json
// POST /api/v2/settings/objects (1 call)
[
  {
    "schemaId": "builtin:service-detection-v2-for-oneagent",
    "scope": "HOST_GROUP-0000000000000001",
    "value": {
      "enableSDV2ForKubernetesWorkloads": false,
      "enableSDV2ForAnyWorkload": true,
      "conditionForAnyWorkload": "dt.host_group.id == \"web-prod\""
    }
  }
]
```

  Two more process groups for a host group whose object already pilots `nginx`:

```json
// PUT /api/v2/settings/objects/vu9U3hXa3q0AAAABAC1idWlsdGluOnNlcnZpY2UtZGV0ZWN0aW9uLXYyLWZvci1vbmVhZ2VudAAGdGVuYW50AAZ0ZW5hbnQAJDAwMDAwMDAy
{
  "value": {
    "enableSDV2ForKubernetesWorkloads": false,
    "enableSDV2ForAnyWorkload": true,
    "conditionForAnyWorkload": "(dt.process_group.detected_name == \"nginx\") or (dt.process_group.detected_name == \"httpd\" or dt.process_group.detected_name == \"orders.jar\")"
  }
}
```

  Hosts without a host group, written to the existing environment object:

```json
// PUT /api/v2/settings/objects/vu9U3hXa3q0AAAABAC1idWlsdGluOnNlcnZpY2UtZGV0ZWN0aW9uLXYyLWZvci1vbmVhZ2VudAAGdGVuYW50AAZ0ZW5hbnQAJDAwMDAwMDAw
{
  "value": {
    "enableSDV2ForKubernetesWorkloads": false,
    "condition": "",
    "enableSDV2ForFaaS": false,
    "conditionForFaaS": "isNotNull(aws.region) and isNotNull(aws.account.id)",
    "enableSDV2ForAnyWorkload": true,
    "conditionForAnyWorkload": "dt.process_group.detected_name == \"billing.jar\""
  }
}
```

- **Confirmation:** *Pilot SDv2 for generic workloads in \<n\> scope(s). I understand that matching services get new
  IDs.*; button **Pilot SDv2 for generic workloads**.
- **Success:** *SDv2 for generic workloads is on for the selected workloads. Check them in Services as new data
  arrives.*
- **Documentation for this fix:** Configure service detection for OneAgent in SDv2; Configure URL path pattern
  matching in SDv2; Customize service splitting in SDv2.

### Manual: Update dashboards, alerts and SLOs after the switch

Shows the [New SDv2 services query](#2-new-sdv2-services-sdv2_services_dql) with *Copy*, then the steps:

1. SDv2 assigns new service IDs (and new metric keys) to the services that match: list what references the SDv1
   services before you switch a scope.
2. Review string-based references: DQL queries, dashboards, SLO filters and alert conditions that match services by ID
   or name.
3. Switch the scope (start in lower environments; the matching condition can limit it to one language or namespace).
4. Find the new services in Services > Explorer: the `dt.service_detection.version` property is 2 (or run the query
   above).
5. Point the references at the new service IDs and confirm that queries return data, SLOs compute and alerts behave as
   expected.

Note: *Historical data stays under the SDv1 service IDs; the new services only have data from the switch on.*
Documentation: Configure service detection for OneAgent in SDv2; Upgrade from service naming rules to service naming.

### Manual: Replace GET /* endpoint names with URL path patterns

Example (Settings API value, *Copy*):

```json
{
  "schemaId": "builtin:url-path-pattern-matching-rules",
  "scope": "environment",
  "value": {
    "enabled": true,
    "rule": {
      "ruleName": "orders-demo endpoints",
      "condition": "dt.host_group.id == \"orders-demo-vm\"",
      "urlPathPatterns": [
        "/api/_/orders/{id}",
        "/internal/*"
      ]
    }
  }
}
```

Steps:

1. Only for services without `http.route` (web servers, reverse proxies): frameworks such as Spring, Express and .NET
   Core set it already.
2. Go to Settings > Process and contextualize > Services > URL path pattern matching and select New rule.
3. Scope the matching condition to the workload; outside Kubernetes use `dt.host_group.id` rather than
   `k8s.workload.name`.
4. Add URL path patterns: literal segments, `{placeholder}` for IDs, `_` to keep a segment (such as the API version),
   `*` for any trailing segments.
5. Order the patterns (the first match wins) and the rules (more specific rules first), then save.

Notes: *The raw URL path stays available (View URLs next to an endpoint).* *Patterns are plain strings of up to 256
characters each (tenant schema).* Documentation: Configure URL path pattern matching in SDv2; Customize endpoint
detection in SDv2.

### Manual: Name services at the source (OTEL_SERVICE_NAME)

Variants (select *Variant*): *Environment variable* `OTEL_SERVICE_NAME=my-checkout-service`, or *With other resource
attributes* `OTEL_RESOURCE_ATTRIBUTES=service.name=my-checkout-service`.

Steps:

1. Set `OTEL_SERVICE_NAME` (or `service.name` in `OTEL_RESOURCE_ATTRIBUTES`) as an environment variable on the
   application process. This works with OneAgent; the OpenTelemetry SDK is not needed.
2. Restart the process. SDv2 services use `service.name` as the name; SDv1 services show *service.name (detected
   name)*.
3. Keep context such as environment, region or team out of the name: use primary Grail fields and tags as dimensions
   instead.

Notes: *service.name is a process-level attribute: every service in the process shares it.* *New names apply to
telemetry sent after the change; existing data keeps the name it was recorded with.* Documentation: Service naming;
Upgrade from service naming rules to service naming.

### Manual: Adjust SDv2 service names with a detection rule

Example (Settings API value, *Copy*):

```json
{
  "schemaId": "builtin:service-detection-rules",
  "scope": "environment",
  "value": {
    "enabled": true,
    "rule": {
      "ruleName": "Payments workloads",
      "condition": "k8s.namespace.name == \"payments\"",
      "serviceNameTemplate": "{k8s.workload.name}",
      "additionalRequiredAttributes": []
    }
  }
}
```

Steps:

1. Go to Settings > Process and contextualize > Services > Service detection and select Add rule. Custom rules are
   evaluated before the built-in ones; the first match wins.
2. Enter a matching condition (DQL matcher) and a service name template with resource attributes in braces, for
   example `{k8s.workload.name}`.
3. Every attribute in the template and in Additional service detection attributes must exist on the span, or the rule
   does not apply.
4. To drop an attribute from the name without changing the service ID, remove it from the template and add it to
   Additional service detection attributes.

Notes: *Placeholders are case-sensitive.* *Changing static text or the order of attributes keeps the service ID;
adding or removing an attribute creates a new one.* *Primary Grail fields and tags are not recommended in name
templates: use them as dimensions.* Documentation: Customize service detection in SDv2; Service naming.

## Docs freshness: keeping the guidance current

The recommendations, defaults, rule names and steps on this tab live in [ui/app/sdv2.ts](../ui/app/sdv2.ts), written
from the Dynatrace docs (every cited page is in `DOC` in [ui/app/deepTech.ts](../ui/app/deepTech.ts#L139)). They are not
rewritten automatically: parsing docs pages into remediation logic would be unsafe. Changes are detected instead.

**At runtime.** [ui/app/deepDocsSnapshot.json](../ui/app/deepDocsSnapshot.json) holds the sitemap `lastmod` of every
cited page and of every page in the watched sections as of the last review, plus the review date. The
[docs-freshness function](#4-docs-freshness-app-function) reads the live sitemap; `toState`
([deepDocs.ts](../ui/app/deepDocs.ts#L42)) compares the two:

- a cited page with a newer live date, or cited but not yet in the snapshot, is *updated*;
- a page missing from the sitemap is *missing* (moved or removed), as is a snapshot page of a watched section that is
  no longer listed under it;
- a page under a watched prefix that is neither cited nor in the snapshot is *new*.

**Watched section.** `DOC_SECTIONS` ([deepTech.ts](../ui/app/deepTech.ts#L22)) contains one entry, *Service Detection
v2*, with prefix
`https://docs.dynatrace.com/docs/observe/application-observability/services/service-detection/service-detection-v2`.
SDv2 changes often, so every page below it is tracked, not only the cited ones. On this tab the result drives the docs
status line and warning box, the note above an action whose cited page changed, the documentation card and one
AI Assist insight.

**For maintainers** ([scripts/check-deep-docs.mjs](../scripts/check-deep-docs.mjs)):

```bash
npm run check-docs
```

lists cited pages updated since the review (`UPDATED`), pages no longer in the sitemap (`NOT FOUND`), cited pages not
reviewed yet (`NEW`) and uncited pages in watched sections (`NEW PAGE`), and exits with code 1 when there is any (so it
can run in CI or on a schedule). After reading those pages and updating `sdv2.ts` (and citing new pages in `DOC` when
they matter):

```bash
npm run check-docs -- --accept
```

records the current `lastmod` of every cited page and every page of the watched sections and today's date in
`ui/app/deepDocsSnapshot.json`. It refuses when a cited URL is missing from the sitemap (fix `deepTech.ts` first).
The script reads the URLs from `deepTech.ts` itself, so there is no second list to keep in sync.

## AI Assist on this page

`analyzeSdv2` ([ui/app/analyses.ts](../ui/app/analyses.ts#L661)) is rule-based and runs locally in the browser on the
data already on the tab; it calls no AI service. It is computed when the panel is opened and recomputed when its inputs
change. Inputs: total services, SDv2 services, the count per recommendation, the scope rows that have SDv1 services or
are *Done* (label, verdict, SDv1 count, estimate, references), the failing rule checks as *\<rule\> should be
enabled|disabled*, the number of SDv2 objects with a switch on, whether the settings were read, and the number of
changed and new SDv2 docs pages (changed = cited SDv2 pages plus section pages that changed, counted once).

**No services:** summary *No services were returned for this timeframe, so Service Detection v2 adoption cannot be
assessed.*, one info insight (*Smartscape has no SERVICE nodes in the window. Widen the timeframe or check that traces
are ingested.*) and one low recommendation (*Re-check once OneAgent or OpenTelemetry services report requests.*).

**Summary:** *\<sdv2\> of \<total\> services (\<p\>%) are detected by Service Detection v2. Of the \<sdv1\> SDv1
services, \<Enable\> can move now (Kubernetes / AWS Lambda, generally available), \<Pilot + Review\> fit the Early
Access for generic workloads and \<Keep\> should stay on SDv1 for now.* (`p` rounded.)

**Insights**, in order:

| Rule | Severity | Text |
| --- | --- | --- |
| Always | good when p ≥ 90, warning when p ≥ 50, critical below | *\<p\>% of services use SDv2. SDv2 names services from resource attributes (k8s.workload.name, service.name) and makes one service per process.* |
| Scope rows with *Enable SDv2 (GA)* | warning | *\<n\> Kubernetes / Lambda scope(s) still on SDv1, largest: \<label\> (\<sdv1\> SDv1 → ~\<after\> SDv2), …* (top 3 by SDv1 count) |
| Rows with `sdv1 > 2 × after` and `after > 0` | info | *\<n\> scope(s) split one workload into several SDv1 services; SDv2 would consolidate them (for example \<label\>: \<sdv1\> → ~\<after\>).* |
| Keep count > 0 | info | *\<n\> SDv1 service(s) should stay on SDv1 for now: application servers or multi-application processes, background work without inbound requests, mainframe, or no OneAgent context.* |
| Review count > 0 | warning | *\<n\> custom service(s) would be absorbed into their process's SDv2 service: check that nothing relies on them as separate services.* |
| References in rows that are not Keep or Done > 0 | warning | *\<n\> frontend / HTTP-monitor reference(s) point at SDv1 services in scopes that can switch; SDv2 assigns new service IDs.* |
| Settings not read | warning | *The SDv2 settings could not be read, so the current switches and rule recommendations are unknown.* |
| Settings read and failing rule checks | warning | *\<n\> built-in rule(s) differ from the docs' recommendation: \<first 3\>; ….* |
| Settings read and no switch on | info | *SDv2 for OneAgent is not switched on at any scope yet (environment, host group, cluster or namespace).* |
| Docs changed or new pages | warning | *The SDv2 docs changed since this guidance was reviewed: \<n\> updated, \<m\> new page(s). Read them before acting.* |

**Recommendations**, in order:

| Rule | Impact | Text |
| --- | --- | --- |
| Settings read and failing rule checks | high | *Fix the built-in rules first (Remediation actions > Apply recommended built-in rules), so services get their final IDs once.* |
| Any *Enable SDv2 (GA)* row | high | *Enable SDv2 for Kubernetes namespace by namespace, starting in lower environments; use the matching condition to limit it further (for example by dt.agent.module.type).* |
| Enable count > 0 and the *AWS Lambda functions* row is *Enable* | medium | *Enable SDv2 for FaaS at the environment with the default condition (AWS region and account present).* |
| Pilot count > 0 | medium | *Pilot SDv2 for generic workloads (Early Access) on one host group of web servers or single-service apps; add URL path pattern rules where endpoints show GET /\*.* |
| References > 0 or any *Enable* row | medium | *Before each switch, list dashboards, alerts and SLOs that reference the SDv1 services and update them to the new SDv2 IDs afterwards.* |
| Always | low | *Keep names clean: add context with primary Grail fields and tags, and set OTEL_SERVICE_NAME where a service needs a specific name.* |

## Limitations and edge cases

- **5,000 services.** The query stops at 5,000 services by name; everything on the tab (gauges, tiles, rows,
  estimates) is computed from those.
- **Timeframe.** Longer windows include services that no longer exist, so a scope that already switched can still show
  its old SDv1 services next to the new SDv2 ones until they age out of the window.
- **Missing version.** A service without `dt.service_detection.version` is counted as SDv1.
- **One namespace / host group per service.** A Kubernetes service with edges to several namespaces is grouped under the
  first one only; a generic service under its first host group that has a classic ID.
- **Host group not resolved.** The host group ID comes from matching the process's `dt.host_group.id` (a name) to
  `dt.entity.host_group` `entity.name` in the same timeframe. When that fails, the service lands in *Hosts without a
  host group* and an environment-scope condition is proposed for it.
- **Estimates are estimates.** *SDv2 services after* counts workloads or process groups. The real result depends on the
  splitting rules (for example cluster and namespace, host group and cloud fields) and on detection rules.
- **Application-server detection** relies on `softwareTechnologies` of the classic service containing `type:WEBSPHERE…`
  or `type:WEBLOGIC…`; multi-context detection relies on several distinct web application IDs / context roots on one
  process. Other multi-application setups are not detected.
- **Generic condition semantics.** The code treats an empty generic-workload condition, or one starting with `false`,
  as matching nothing (the schema default is `false…`). A condition such as `false or <x>` is therefore shown as
  matching nothing and is replaced, not OR-ed, by the pilot action.
- **Effective switch.** Only the most specific object that exists decides, as in the Settings hierarchy; the app does
  not evaluate matching conditions against workloads, so *On at …* means the switch is on for the scope, not that every
  service in it matches.
- **Rule checks by name.** A built-in rule renamed by Dynatrace (or a custom rule with the same name) changes the
  result. Missing rules are left out of the gauge rather than counted as failing.
- **Partial apply.** When both a POST and PUTs are needed, a failed PUT after a successful POST leaves the created
  objects in place. The settings are read again after a successful Apply only.
- **Optimistic locking.** PUTs carry the `updateToken` from the last read. If the object was changed elsewhere since,
  the API rejects the PUT; the tab re-reads only after a successful Apply, so reload the page to pick up the new token.
- **SDv2 data needs time.** After a switch, new SDv2 services appear only as new data arrives; the services query
  is not re-run automatically.
- **Docs banner wording.** An uncited page of the watched section that disappeared from the sitemap is listed in the
  warning box with *— updated*; the documentation card does not list changed uncited pages, only new ones and the 13
  cited pages.
- **Docs check limits.** The function checks at most 300 cited URLs and returns at most 200 section pages.

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| Red *Query failed* box, nothing below the docs line | The user or app lacks `storage:smartscape:read` or `storage:entities:read`, or the query timed out | Check the error text; grant the Grail permissions; restart `npx dt-app dev` after scope changes; try the 24-hour timeframe. |
| All gauges 0%, *No services.* | No service nodes in the timeframe | Widen the timeframe; confirm OneAgent / OpenTelemetry traces are ingested. |
| *Could not read the SDv2 settings* | Missing `settings:objects:read` on one of the six schemas, or one of the schemas is not available on the tenant (older Dynatrace version) | Check the API message; grant read access; the services part of the tab still works. |
| *Recommended rules in place* 0% with *0 of 0* | None of the documented built-in rules exists on the tenant (by name) | Check the rule names in Settings > Service detection / splitting / endpoint detection. |
| Validate fails with a permission error | The user has no settings write permission for that schema or scope | Grant `settings:objects:write` for the schema (and scope); Apply would fail the same way. |
| Validate fails on the condition | Invalid DQL matcher, an attribute that is not allowed (for example a tag set by OpenPipeline), or more than 1000 characters | Fix the condition; for generic pilots pick fewer process groups or pilot the whole host group. |
| Apply fails after Validate passed | The object changed since it was read (`updateToken`), or a concurrent change | Reload the tab and validate again. |
| Switch is on but services stay SDv1 | No new data yet, the matching condition does not match, or the timeframe still contains the old services | Wait for new traffic, check the condition, use the 24-hour timeframe, run the *New SDv2 services* query. |
| *Automatic docs check off* | `docs.dynatrace.com` is not in the allowed outbound connections | Add it in `builtin:dt-javascript-runtime.allowed-outbound-connections` (link in the status line), then *Retry*. |
| *Docs check failed: the docs-freshness app function is not available in this running app (HTTP 404)* | The function was added after `npx dt-app dev` started, or the deployed version predates it | Restart the dev server or deploy, then *Retry*. |
| Warning box about changed SDv2 docs | Dynatrace updated or added SDv2 pages after 2026-10-24 | Read the pages before acting; maintainers update `sdv2.ts` and run `npm run check-docs -- --accept`. |
| A host group shows under *Hosts without a host group* | The classic host group entity was not found by name in the timeframe | Check the host group in Infrastructure & Operations; the pilot action then writes to the environment object. |

## Related pages

- [Index](README.md): the app shell, timeframe, AI Assist, query actions and documentation freshness in general.
- [Kubernetes](kubernetes.md): how Kubernetes workloads are monitored (OneAgent injection is the prerequisite for the
  Kubernetes switch).
- [Deep Monitoring](deep-monitoring.md): the other tab that uses the docs-freshness check; code modules that create
  OneAgent services.
- [Host groups](host-groups.md): host groups are the scope of the generic-workload pilot.
- [Frontends](frontends.md): frontends whose service references change with SDv2.

## Source files

| File | Role on this page |
| --- | --- |
| [ui/app/tabs/Sdv2Tab.tsx](../ui/app/tabs/Sdv2Tab.tsx) | Tab layout: gauges, tiles, donuts, *Where to enable SDv2*, *Current SDv2 configuration*, *Services*, remediation forms and `WriteFlow`, docs banner and documentation card. |
| [ui/app/sdv2.ts](../ui/app/sdv2.ts) | Service context and recommendation (`toService`, `classify`), scope rows and estimates (`scopeRows`, `effectiveSwitch`), settings read (`readSdv2Settings`), write payloads (`k8sChanges`, `faasChanges`, `genericChanges`, `applyChanges`, `requestText`), rule checks (`ruleChecks`, `applyRuleFixes`), manual actions, `SDV2_DOCS`. |
| [ui/app/queries.ts](../ui/app/queries.ts#L1254) | `sdv2ServicesQuery`, `SDV2_SERVICE_LIMIT`, `WORKLOAD_TYPES`, `dqlString`. |
| [ui/app/analyses.ts](../ui/app/analyses.ts#L646) | `analyzeSdv2` (AI Assist). |
| [ui/app/deepDocs.ts](../ui/app/deepDocs.ts) | Docs-freshness client: call, comparison with the snapshot, `changedDocs`, `sectionChanges`, Retry. |
| [ui/app/deepDocsSnapshot.json](../ui/app/deepDocsSnapshot.json) | Review date and reviewed `lastmod` per page. |
| [ui/app/deepTech.ts](../ui/app/deepTech.ts) | `DOC` (cited pages, SDv2 entries) and `DOC_SECTIONS` (watched SDv2 section). |
| [api/docs-freshness.function.ts](../api/docs-freshness.function.ts) | App function that reads the docs sitemap. |
| [scripts/check-deep-docs.mjs](../scripts/check-deep-docs.mjs) | `npm run check-docs` for maintainers. |
| [ui/app/deepMonitoring.ts](../ui/app/deepMonitoring.ts) | `postObjects`, `putObjects` (Settings writes), `settingsLink` (Settings app links). |
| [ui/app/components.tsx](../ui/app/components.tsx) | `PctGauge`, `ScoreTile`, `QueryActions`, `QueryState`, `pct`, `formatMode`. |
| [ui/app/tabs/ModePie.tsx](../ui/app/tabs/ModePie.tsx) | `Donut` chart. |
| [ui/app/kubernetes.ts](../ui/app/kubernetes.ts) | Palette slots (`categoryColor`). |
| [ui/app/RemediationPanel.tsx](../ui/app/RemediationPanel.tsx) | `Field`, `Request`, `ResultLine`, `Links`, `ManualActionView`. |
| [ui/app/links.ts](../ui/app/links.ts) | `entityOverviewLink` (Services app), `hostGroupLink` (Infrastructure & Operations). |
| [ui/app/useDql.ts](../ui/app/useDql.ts) | DQL hook wrapper. |
| [ui/app/AIInsights.tsx](../ui/app/AIInsights.tsx) | AI Assist panel. |
| [ui/app/areas.tsx](../ui/app/areas.tsx) | Tab id `sdv2`, title, area, link to this page. |
