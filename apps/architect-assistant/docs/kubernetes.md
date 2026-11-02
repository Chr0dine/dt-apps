# Kubernetes

The Kubernetes tab shows how the Dynatrace Operator is deployed on every Kubernetes cluster the tenant knows about.
It lists one row per DynaKube (the Operator's custom resource), every cluster without a DynaKube, and managed EKS,
AKS and GKE clusters that are seen only through a cloud integration. It also shows how namespaces, workloads, pods and
containers are monitored: the monitoring mode of the DynaKube that selects their namespace, and whether OneAgent (or
OpenTelemetry) was actually injected into the pods. Everything is read from Smartscape: the DynaKube resource
(spec and status), the namespace selection label the Operator sets, the annotations the Operator's webhook writes on
each pod, and the pod spec. A *Diagnose* flow explains, for one cluster, workload or namespace, why it is or is not
full-stack monitored and offers the documented manual fix with commands filled in.

| | |
| --- | --- |
| Area | Visibility (see [index](README.md)) |
| Tab id | `kubernetes` |
| Counts toward Entity Overview readiness / Top findings | No. None of this tab's gauges feed Entity Overview's overall readiness or Top findings. (Entity Overview scores primary fields on Kubernetes entity types through the shared `coverageQuery`; that is a separate query, see [entity-overview.md](entity-overview.md).) |
| Main source files | [ui/app/tabs/KubernetesTab.tsx](../ui/app/tabs/KubernetesTab.tsx), [ui/app/kubernetes.ts](../ui/app/kubernetes.ts), [ui/app/queries.ts](../ui/app/queries.ts#L212) (Kubernetes section), [ui/app/analyses.ts](../ui/app/analyses.ts#L145) (`analyzeKubernetes`) |

## Contents

- [What this page answers](#what-this-page-answers)
- [Before you start](#before-you-start)
- [Page walkthrough](#page-walkthrough)
  - [Header and description](#header-and-description)
  - [Summary gauges](#summary-gauges)
  - [Grouping toggle and hint](#grouping-toggle-and-hint)
  - [Donuts: namespaces, workloads, pods, containers](#donuts-namespaces-workloads-pods-containers)
  - [Category legend](#category-legend)
  - [Clusters and Operator deployments](#clusters-and-operator-deployments)
  - [Find workloads and namespaces](#find-workloads-and-namespaces)
  - [Search results](#search-results)
  - [Remediation actions section](#remediation-actions-section)
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

- **Does every Kubernetes cluster run the Dynatrace Operator?** Clusters seen only by host-installed OneAgents, clusters
  monitored through the Kubernetes API without a DynaKube, and EKS / AKS / GKE clusters seen only through the cloud
  integration are all listed and counted as "without a DynaKube".
- **Is each cluster in full-stack mode?** The recommended mode is cloud-native full-stack (code modules injected by the
  webhook plus a host OneAgent per node). Classic full-stack still gives full-stack data but is legacy;
  application monitoring alone has no host OneAgent; host monitoring and "no OneAgent" DynaKubes inject nothing.
- **Are the DynaKubes healthy?** `status.phase` must be `Running` and no status condition may be other than `True`.
- **Which pods actually have OneAgent, and if not, why?** For every running pod the tab derives an injection status
  (OneAgent injected, OpenTelemetry instead, roll out required, opt-out annotation, namespace not selected, opt-in
  required, mode does not inject, webhook failure, no Operator) from the pod's annotations and spec.
- **Is OpenTelemetry used next to or instead of OneAgent?** Double instrumentation (OneAgent plus an OpenTelemetry
  tracer on the same pod) is flagged.
- **What exactly must change?** *Diagnose* turns the findings for one target into checks and the matching manual fix
  (Helm, `kubectl`, DynaKube YAML).

The best practices and fixes were written from the Dynatrace Operator documentation (reviewed 2026-10-24, see the
header comment of [ui/app/kubernetes.ts](../ui/app/kubernetes.ts)). The pages the code cites (`DOC` in
[ui/app/deepTech.ts](../ui/app/deepTech.ts)):

| Topic | Page |
| --- | --- |
| Install the Operator in full-stack mode | [Install the Operator: full-stack observability](https://docs.dynatrace.com/docs/ingest-from/setup-on-k8s/deployment/full-stack-observability), [Kubernetes deployment options](https://docs.dynatrace.com/docs/ingest-from/setup-on-k8s/deployment) |
| Monitoring modes | [Kubernetes full-stack observability](https://docs.dynatrace.com/docs/ingest-from/setup-on-k8s/how-it-works/cloud-native-fullstack), [Kubernetes application observability](https://docs.dynatrace.com/docs/ingest-from/setup-on-k8s/how-it-works/application-monitoring) |
| Migration | [Kubernetes migration guides](https://docs.dynatrace.com/docs/ingest-from/setup-on-k8s/guides/migration), [Migrate classic full-stack to cloud-native full-stack](https://docs.dynatrace.com/docs/ingest-from/setup-on-k8s/guides/migration/classic-to-cloud-native) |
| DynaKube fields and flags | [DynaKube parameters](https://docs.dynatrace.com/docs/ingest-from/setup-on-k8s/reference/dynakube-parameters), [DynaKube feature flags](https://docs.dynatrace.com/docs/ingest-from/setup-on-k8s/reference/dynakube-feature-flags) |
| Namespace and pod selection, annotations | [Configure monitoring for namespaces and pods](https://docs.dynatrace.com/docs/ingest-from/setup-on-k8s/guides/deployment-and-configuration/monitoring-and-instrumentation/annotate), [Pod mutations](https://docs.dynatrace.com/docs/ingest-from/setup-on-k8s/reference/workload-mutation) |
| Troubleshooting | [Kubernetes troubleshooting](https://docs.dynatrace.com/docs/ingest-from/setup-on-k8s/deployment/troubleshooting), [Kubernetes monitoring issues](https://docs.dynatrace.com/docs/ingest-from/setup-on-k8s/deployment/troubleshooting/monitoring-troubleshooting) |
| OpenTelemetry | [Telemetry ingest endpoints (Dynatrace Collector)](https://docs.dynatrace.com/docs/ingest-from/setup-on-k8s/extend-observability-k8s/telemetry-ingest), [Automatic OTLP exporter configuration](https://docs.dynatrace.com/docs/ingest-from/setup-on-k8s/extend-observability-k8s/otlp-auto-config), [Use OneAgent with OpenTelemetry data](https://docs.dynatrace.com/docs/ingest-from/dynatrace-oneagent/oneagent-and-opentelemetry/oneagent-otel), [OpenTelemetry](https://docs.dynatrace.com/docs/ingest-from/opentelemetry), [OTLP API endpoints](https://docs.dynatrace.com/docs/ingest-from/opentelemetry/otlp-api) |

## Before you start

### App scopes used by this page

| Scope | What this page uses it for |
| --- | --- |
| `storage:smartscape:read` | Every `smartscapeNodes` query: `K8S_DYNAKUBE`, `K8S_CLUSTER`, `K8S_NAMESPACE`, `K8S_NODE`, `K8S_POD`, `CONTAINER`, the workload node types (`K8S_DEPLOYMENT`, `K8S_STATEFULSET`, …), the cloud cluster types (`AWS_EKS_CLUSTER`, `AZURE_MICROSOFT_CONTAINERSERVICE_MANAGEDCLUSTERS`, `GCP_CONTAINER_GOOGLEAPIS_COM_CLUSTER`), `AWS_EKS_NODEGROUP`, and `PROCESS` (node ID lookup in the diagnosis). |
| `storage:entities:read` | Diagnosis only: the processes query reads `dt.entity.process_group_instance`, `dt.entity.process_group`, `dt.entity.host` and `dt.entity.service`. |
| `storage:metrics:read` | Diagnosis only: the processes query looks up `dt.runtime.*` code-module runtime metric keys in `metric.series`. |

No write scope is used. The `docs-freshness` app function needs no scope (it reads a public site).

### User permissions

DQL runs on behalf of the signed-in user, so the user needs the same read permissions in their own IAM policies:
Smartscape read for the page, plus entity and metric read for *Diagnose* on a workload or namespace. Nothing on this
page writes to the tenant, so no write permission is needed. *Open in Notebook* / *Add to Dashboard* need access to
the Notebooks and Dashboards apps; the entity links open the Kubernetes app (`dynatrace.kubernetes`) and, for EKS and
AKS clusters, the Clouds app (`dynatrace.clouds`).

### One-time setup

None for the data. Optional: the *Documentation for this fix* freshness check runs the `docs-freshness` app function,
which reads `https://docs.dynatrace.com/docs/sitemap.xml`. When the outbound allowlist
`builtin:dt-javascript-runtime.allowed-outbound-connections` is enforced, add `docs.dynatrace.com` to it; otherwise
the section says "Automatic docs check off" (the fixes are still shown). No credential vault entries or OAuth clients
are used.

## Page walkthrough

Sections in on-screen order. The [timeframe](README.md#timeframe) select in the header (24 hours default, 7 days,
30 days) is passed to the tab as `tf`.

### Header and description

When AI Assist is open, its panel is rendered first (see [AI Assist on this page](#ai-assist-on-this-page)). Then a
level-3 heading **Kubernetes** and a paragraph: "Dynatrace Operator deployments (DynaKubes) per Kubernetes cluster,
managed clusters from cloud integrations (EKS, AKS, GKE) that have no Operator, and how namespaces, workloads, pods and
containers are monitored ... Read from Smartscape: namespace selection labels, the webhook's pod annotations and the pod
spec."

### Summary gauges

A card with up to six [gauges](README.md#gauges) (`PctGauge`). The card is wrapped in the loading / error state of the
clusters query ([Q1](#q1-clusters-and-dynakube-deployments)): it shows *Loading…* until Q1 returns, or a *Query failed*
message with the error. The pod and namespace gauges use [Q4](#q4-pods-by-mode-and-status) and
[Q2](#q2-namespaces-by-mode-and-coverage); while those are still loading they show 0 of 0 (0 %).

Every percentage is `Math.round(part / total * 100)`, and 0 when the total is 0
([`pct`](../ui/app/components.tsx#L31)). The counting code is in
[KubernetesTab.tsx](../ui/app/tabs/KubernetesTab.tsx#L769) (lines 769-793).

| Gauge (caption) | Numerator | Denominator | Detail line | Time window |
| --- | --- | --- | --- | --- |
| Clusters with a DynaKube | clusters with at least one DynaKube (`modes.length > 0`) | every cluster in the clusters table (one per cluster, see [cluster list](#cluster-list-toclusters)) | `x of y` | selected timeframe |
| Clusters in full-stack mode | clusters whose DynaKubes include cloud-native full-stack or classic full-stack, or both an application-monitoring and a host-monitoring DynaKube (`isFullStack`) | every cluster in the table | `x of y` | selected timeframe |
| Cloud clusters with the Operator (only shown when at least one cluster has a matched or unmatched EKS / AKS / GKE cluster) | cloud clusters with at least one DynaKube | clusters that carry cloud-integration data | `x of y EKS / AKS / GKE` | selected timeframe |
| DynaKubes healthy | DynaKubes with `status.phase` exactly `Running` and no failing condition | every DynaKube (rows with mode other than `NONE`) | `x of y running, no failing condition` | selected timeframe |
| Pods with OneAgent | pods with status `ONEAGENT`, `CLASSIC` or `ONEAGENT_OTEL` | all pods minus pods with status `SYSTEM` or `DYNATRACE` | `x of y application pods` | running now (last 15 minutes) |
| Namespaces fully injected | namespaces with coverage `ALL` | namespaces with any coverage except `NO_PODS`, `SYSTEM`, `DYNATRACE` | `x of y with pods` | namespaces over the timeframe, their pods running now |

A failing condition is a DynaKube status condition whose `status` is not `"True"`. The cloud-cluster gauge is not
rendered at all when there are no cloud clusters. Note that cloud-only clusters count in the denominators of the first
two gauges, so they lower them.

Below the gauges a collapsed **DQL behind these gauges** element holds three [query actions](README.md#query-actions-show-dql-copy-open-in-notebook-add-to-dashboard)
blocks: *Clusters (Kubernetes and cloud integrations) and DynaKubes* (Q1, title "Kubernetes: clusters and DynaKube
deployments"), *Pods* (Q4, "Kubernetes: pods by monitoring mode and injection status") and *Namespaces* (Q2,
"Kubernetes: namespaces by monitoring mode and injection status").

### Grouping toggle and hint

A hint and a toggle button group **Monitoring mode / Injection status** (`aria-label` "Group donuts by"; default
*Monitoring mode*). The toggle changes only how the four donuts group their data (no query re-runs). The hint reads:
"Click a slice to list its workloads (or namespaces) under "Find"; click it again to clear. Pods, workloads and
containers are counted as running now (seen in the last 15 minutes); namespaces and DynaKubes over the selected
timeframe. System namespaces and Dynatrace's own pods are left out of the gauges; the cluster gauges count every
cluster in the table, including cloud clusters without an Operator."

"Seen in the last 15 minutes" means: the Smartscape node's lifetime overlaps `from:now()-15m`
(`K8S_LIVE_MINUTES = 15` in [queries.ts](../ui/app/queries.ts#L229)). Over a whole timeframe, finished Job pods and
replaced replicas would outnumber the running pods and make every rolled-out workload look partially injected, which is
why pods, workloads and containers use the live window while namespaces, DynaKubes and clusters use the timeframe.

### Donuts: namespaces, workloads, pods, containers

Four cards in a responsive grid (columns of at least 420 px). Each card is a custom SVG donut (`Donut` in
[ModePie.tsx](../ui/app/tabs/ModePie.tsx), 160 px, 30 px ring, 3 px gap between segments), with a legend listing every
slice's label, count and share (`Math.round(value / total * 100)` %). The centre shows the total and the unit
(`namespaces`, `workloads`, `pods`, `containers`); hovering or selecting a slice shows that slice's count and label
instead. Hovering widens the segment and dims the others; each segment has a tooltip `<label>: <count> (<share>%)`.
Slices with a count of 0 are not drawn; slices are always in the fixed category order below, and each category keeps
its colour.

| Card | Query | Heading in *Monitoring mode* | Heading in *Injection status* | Categories in *Injection status* |
| --- | --- | --- | --- | --- |
| Namespaces | [Q2](#q2-namespaces-by-mode-and-coverage) | Namespaces by monitoring mode | Namespaces by OneAgent coverage | [OneAgent coverage of a namespace](#oneagent-coverage-of-a-namespace) |
| Workloads | [Q3](#q3-workloads-by-mode-and-status) | Workloads by monitoring mode | Workloads by injection status | [status groups](#injection-status-groups-donut-slices) |
| Pods | [Q4](#q4-pods-by-mode-and-status) | Pods by monitoring mode | Pods by injection status | status groups |
| Containers | [Q5](#q5-containers-by-mode-and-status) | Containers by monitoring mode | Containers by injection status | status groups |

In *Monitoring mode* every card groups by the [monitoring mode](#monitoring-mode-of-namespaces-workloads-pods-and-containers).
Each query returns `n` per `{mode, status}`; the card adds up `n` per category (`toSlices`). For the workload, pod and
container cards the status of each row is mapped to its group with `statusGroupOf` (an unknown status falls into
*Excluded by design*).

**Colours** (light / dark theme, from the validated palette in [kubernetes.ts](../ui/app/kubernetes.ts#L19)):

| Slot | Light / dark | Monitoring mode | Status group | Namespace coverage |
| --- | --- | --- | --- | --- |
| 1 blue | `#2a78d6` / `#3987e5` | Cloud-native full-stack | OneAgent | All pods with OneAgent |
| 2 orange | `#eb6834` / `#d95926` | Classic full-stack | OneAgent + OpenTelemetry | |
| 3 aqua | `#1baf7a` / `#199e70` | Application monitoring | OpenTelemetry only | OpenTelemetry only |
| 4 yellow | `#eda100` / `#c98500` | OpenTelemetry | Roll out required | Some pods with OneAgent |
| 5 magenta | `#e87ba4` / `#d55181` | Host monitoring only | Pod or container opt-out | |
| 6 green | `#008300` / `#008300` | No OneAgent (ActiveGate only) | Namespace not selected | |
| 7 violet | `#6250d6` / `#9085e9` | Not selected by a DynaKube | Not injected (mode, opt-in, failure) | |
| 8 red | `#e34948` / `#e66767` | No DynaKube | No Operator | No pod injected |
| neutral grey | `#898781` | Dynatrace components, Mixed, Unknown | Excluded by design | No pods, System namespace, Dynatrace components |

**Click behaviour.** Clicking a slice (segment or legend row) selects it and fills the search below
(`pickSlice` in [KubernetesTab.tsx](../ui/app/tabs/KubernetesTab.tsx#L810)): the filters are reset, then

- a namespace slice sets the view to *Namespaces*; a workload, pod or container slice sets it to *Workloads* (pods and
  containers are listed by their workload);
- in *Monitoring mode* the slice's mode becomes the *Monitoring mode* filter, in *Injection status* the slice's
  coverage / status group becomes the status filter;
- the search runs immediately ([Q6](#q6-workload-search) or [Q7](#q7-namespace-search)) and the page scrolls to the
  search after 100 ms.

Clicking the selected slice again clears the selection and hides the results (the filters keep their values). Changing
the timeframe clears both the selected slice and the results.

**States.** Each card shows *Loading…* until its query returns, *Query failed* with the error, or "No `<unit>` found
in this timeframe." when no slice has a count. Each card has its own query actions (title "Kubernetes: `<unit>` by
monitoring mode and injection status").

### Category legend

A collapsed element below the donuts: "What the monitoring modes mean" (lists the eight modes that have a colour slot,
not *Dynatrace components*, *Mixed* or *Unknown*) or "What the injection statuses mean" (lists the nine status groups,
each followed by its member statuses in parentheses). The legend for the namespace coverage categories is not shown;
see [OneAgent coverage of a namespace](#oneagent-coverage-of-a-namespace).

### Clusters and Operator deployments

A card with a sortable, condensed, full-width table fed by [Q1](#q1-clusters-and-dynakube-deployments), converted row by
row with `toDynakube` ([kubernetes.ts](../ui/app/kubernetes.ts#L154)). It has no row limit and no paging. Rows come in
the query's order (`sort cluster asc, name asc`) until a column header is clicked.

There are four kinds of rows:

| Row kind | Where it comes from | `mode` |
| --- | --- | --- |
| DynaKube | one per `K8S_DYNAKUBE` node seen in the timeframe | the DynaKube's mode |
| Kubernetes cluster without a DynaKube | a `K8S_CLUSTER` node (Kubernetes API monitoring) whose cluster UID has no DynaKube | `NONE`, Kubernetes monitoring yes |
| Cluster seen only on containers | a cluster UID that appears only on `CONTAINER` nodes (host-installed OneAgents, no Kubernetes monitoring) and has no DynaKube | `NONE`, Kubernetes monitoring no |
| Cloud-only cluster | an EKS / AKS / GKE cluster from a cloud integration that matches no Kubernetes cluster | `NONE`, no cluster UID |

A cloud cluster that matches a Kubernetes cluster (see [cloud cluster matching](#cloud-cluster-matching)) does not get its
own row: its provider, name and version are shown under that cluster on every row of the cluster.

| Column | Content | Source fields | Sort key |
| --- | --- | --- | --- |
| Cluster | Cluster name, linked (↗, new tab) to the cluster's overview in the Kubernetes app when the cluster has a `K8S_CLUSTER` node. When cloud data is attached, a second small line: `<Amazon EKS / Azure AKS / Google GKE> <cloud name>` linked to the Clouds app (EKS: intent `view_aws_service`, AKS: `view_azure_service`; GKE has no intent and is plain text), then ` · <Kubernetes version>`. Hovering the second line shows provider and name, account, resource group (AKS), location, `Kubernetes <version>` and state. | `cluster`, `clusterId`, `cloud*` | `cluster` |
| DynaKube | `<namespace>/<name>` linked to the DynaKube overview (intent `view-entity-dt.smartscape.k8s_dynakube`). For `NONE` rows: **None** in red plus a **Diagnose** button (shows **Selected** when this cluster is the current selection). | `id`, `namespace`, `name` | `name` |
| Mode | Cloud-native full-stack, Application monitoring, Classic full-stack, Host monitoring, No OneAgent (ActiveGate only), or *No DynaKube* for `NONE` rows | `mode` | label |
| Status | DynaKube rows: the phase (or *Unknown* when empty) in green when it is `Running` and no condition fails, otherwise in orange, followed by ` · failing: <condition types>`. `NONE` rows: "`<AWS / Azure / Google Cloud>` integration only: no Operator, no Kubernetes monitoring" (cloud-only), "Kubernetes monitoring without the Operator" (has a `K8S_CLUSTER` node), or "Host OneAgent only (`<n>` running containers)" (containers seen in the last 15 minutes). | `phase`, `failing`, `k8sMonitoring`, `containers`, `cloud*` | `phase` |
| Operator | Distinct Operator versions in the cluster, comma-separated, or — | `operatorVersions` | text |
| OneAgent / code modules | OneAgent version and code-modules version, `/`-separated, deduplicated, or — | `oneAgentVersion`, `codeModulesVersion` | text |
| ActiveGate | `<version> (<capabilities>)`, or the capabilities alone, or — | `activeGateVersion`, `activeGateCapabilities` | text |
| Namespaces selected | Number of namespaces carrying the DynaKube's selection label, plus " (opt-in only)" when automatic injection is off. Hover: the `OneAgentNamespacesMonitored` condition message and `namespaceSelector: <JSON>`. — for `NONE` rows. | `selected`, `autoInjection`, `nsMatch`, `namespaceSelector` | `selected` |
| Features | Comma-separated: Metadata enrichment, Log monitoring, KSPM, Extensions, Telemetry ingest (Collector), OTLP exporter auto-config, or — | see [Q1 output](#q1-clusters-and-dynakube-deployments) | text |

Above the table a hint explains the row kinds and the cloud matching. Empty state: "No Kubernetes clusters, cloud
clusters or DynaKubes found in this timeframe." Query actions below the table: "Kubernetes: clusters and DynaKube
deployments" (Q1).

Entity links are built with `entityOverviewLink` ([links.ts](../ui/app/links.ts#L72)) and carry the selected
timeframe as `dt.timeframe`.

### Find workloads and namespaces

A card titled **Find workloads** or **Find namespaces**, with a toggle **Workloads / Namespaces** (default Workloads).
Switching the view resets the status filter and the workload name and hides the results. Changing any field also
hides the results until the search button is pressed again.

| Field | Options | Clause it adds (see [Q6](#q6-workload-search) / [Q7](#q7-namespace-search)) |
| --- | --- | --- |
| Cluster | *Any cluster*, then every cluster from the clusters table that has a cluster UID and Kubernetes monitoring (cloud-only and host-OneAgent-only clusters have no pods in Smartscape), by name | `k8s.cluster.uid == "<uid>"` |
| Namespace contains | free text (trimmed), placeholder "e.g. checkout" | `contains(k8s.namespace.name, "<text>", caseSensitive:false)` |
| Workload contains (Workloads view only) | free text (trimmed), placeholder "e.g. cart" | `contains(k8s.workload.name, "<text>", caseSensitive:false)` |
| Monitoring mode | *Any mode* plus every mode; the Namespaces view leaves out *Mixed* | Workloads: `in("<MODE>", modes)` (any pod of the workload is in that mode), or `mode == "MIXED"`; Namespaces: `mode == "<MODE>"` |
| Injection status (any pod) — Workloads view | *Any status* plus the nine status groups | the group's statuses, joined with `or`: `in("<STATUS>", statuses)` (any pod has it), `status == "PARTIAL"`, and for `CONTAINER_BLOCK` `(containerBlockPods > 0 and mode != "DYNATRACE")` |
| OneAgent coverage — Namespaces view | *Any status* plus the seven coverage values | `in(status, array("<COVERAGE>"))` |

Text values are quoted with `dqlString` (backslashes and double quotes escaped). Status groups and their statuses:

| Group (filter option) | Statuses matched | Clause |
| --- | --- | --- |
| OneAgent | `ONEAGENT`, `CLASSIC` | `(in("ONEAGENT", statuses) or in("CLASSIC", statuses))` |
| OneAgent + OpenTelemetry | `ONEAGENT_OTEL` | `in("ONEAGENT_OTEL", statuses)` |
| OpenTelemetry only | `OTEL` | `in("OTEL", statuses)` |
| Roll out required | `RESTART_REQUIRED`, `PARTIAL` | `(in("RESTART_REQUIRED", statuses) or status == "PARTIAL")` |
| Pod or container opt-out | `POD_BLOCK`, `CONTAINER_BLOCK` | `(in("POD_BLOCK", statuses) or (containerBlockPods > 0 and mode != "DYNATRACE"))` |
| Namespace not selected | `NAMESPACE_BLOCK`, `METADATA_ONLY` | `(in("NAMESPACE_BLOCK", statuses) or in("METADATA_ONLY", statuses))` |
| Not injected (mode, opt-in, failure) | `OPT_IN_REQUIRED`, `NO_INJECTION`, `FAILED` | three `in(...)` joined with `or` |
| No Operator | `NO_DYNAKUBE`, `HOST_ONEAGENT`, `NO_POD` | three `in(...)` joined with `or` |
| Excluded by design | `SYSTEM`, `DYNATRACE` | `(in("SYSTEM", statuses) or in("DYNATRACE", statuses))` |

The **Search workloads** / **Search namespaces** button builds the query (`k8sSearchQuery`) and shows the results.
A hint under the fields: "Click a donut slice to list what is in it. Use Diagnose on a result for the checks and fixes
below: why it is or isn't full-stack monitored."

### Search results

Shown below the search card once a search ran; the table is remounted for each new query. Loading and error states as
above. Sortable, condensed, full-width; at most 500 rows (`K8S_SEARCH_LIMIT`); when 500 rows come back, "Showing the
first 500." is shown. Query actions: "Kubernetes: workload search" / "Kubernetes: namespace search".

Workloads view:

| Column | Content | Source |
| --- | --- | --- |
| Workload | workload name, linked to its overview in the Kubernetes app when a Smartscape workload node matched (Deployment, StatefulSet, DaemonSet, Job, CronJob, ReplicaSet; ReplicationController and DeploymentConfig have no intent and are plain text) | `workload`, `nodeType`, `nodeId` |
| Kind | `k8s.workload.kind` (for example `deployment`) | `kind` |
| Namespace, Cluster | | `namespace`, `cluster` |
| Monitoring mode | mode label (*Mixed* when pods differ) | `mode` |
| Injection status | coloured square of the status group, then the status label (*Partially injected* when pods differ) | `status` |
| OneAgent pods | `<oneAgentPods> of <pods>`; sorts by `oneAgentPods` | `oneAgentPods`, `pods` |
| OTel pods | pods with OpenTelemetry evidence | `otelPods` |
| (no header) | **Diagnose** / **Selected** button | |

Namespaces view: Namespace (linked to the namespace overview), Cluster, DynaKube (the value of the namespace's selection
label, or —), Monitoring mode, OneAgent coverage (coloured square and coverage label), OneAgent pods (`x of y`),
OTel pods, Diagnose.

Empty state: "No workloads match these filters. Containers seen only by a host-installed OneAgent have no pod or
workload in Smartscape: find their cluster under Operator deployments." (workloads) or "No namespaces match these
filters."

### Remediation actions section

A card with the anchor `remediation-kubernetes`, heading **Remediation actions**, a subtitle that depends on the
selection, the [docs freshness line](#api-calls), and a **Clear selection** button once something is selected.

- **Nothing selected**: "Manual steps to change the monitoring mode or lift an injection block. Use Diagnose on a
  cluster without a DynaKube, or on a workload or namespace above, for checks specific to it ...". The *Action* dropdown
  lists the nine generic actions (not grouped, placeholders in the commands).
- **Diagnose on a cluster** (only `NONE` rows have the button): "Why the selected cluster is not monitored by the
  Dynatrace Operator, and the steps to install it." Shows the cluster name (and the cloud description), the check
  list, the *Action* dropdown and, for cloud clusters, query actions for [Q10](#q10-cloud-clusters-and-their-kubernetes-match)
  ("Kubernetes: cloud clusters and their Kubernetes match"). No query runs; the checks come from the table row. If the
  cluster is not in the table any more (for example after a timeframe change): "The selected cluster is no longer in the
  clusters table for this timeframe."
- **Diagnose on a workload or namespace**: "Why the selected workload / namespace is or isn't full-stack monitored, and
  the manual steps to change it." Runs [Q8](#q8-pods-of-the-diagnosed-target) and then [Q9](#q9-processes-in-those-pods);
  shows "Reading the pods and processes…" until both are done. Then:
  - a line `<target> · <monitoring mode of the first pod> · <x> of <n> pods with OneAgent · Open in Kubernetes ↗`
    (x counts statuses `ONEAGENT`, `CLASSIC`, `ONEAGENT_OTEL`; the link opens the namespace or workload overview);
  - if Q9 failed: "Could not read the processes (`<error>`); the technology check is incomplete." (the diagnosis still runs);
  - the check list ([Diagnosis checks](#diagnosis-checks)), sorted Blocking, Check, OK, Info, each with a coloured left
    border (red, orange-yellow, green, grey);
  - a collapsed **Pods (n[, first 200]) and processes (m)** list: per pod its name, its workload (namespace targets),
    status label, `reason`, the opt-out keys set to `"false"`, the excluded containers, and the OpenTelemetry kinds
    (OTLP auto-config, OTel Operator, OTLP exporter); per process its name, technology (or *unclassified*), *code module*
    (green) or *no code module* (orange) and the evidence;
  - the *Action* dropdown ([Remediation actions](#remediation-actions));
  - query actions for Q8 ("Kubernetes: pods of `<target>`") and, when it ran, Q9 ("Kubernetes: processes of `<target>`").

Selecting a target scrolls to this section after 100 ms. The target names are `<kind>/<workload> in <namespace>
(<cluster>)`, `namespace <namespace> (<cluster>)` or `cluster <cluster>`. A selection survives a timeframe change and
re-runs its queries for the new timeframe.

## Checks and scoring

### Gauges

See [Summary gauges](#summary-gauges). All thresholds are only the gauge colour gradient (red at 0 %, green at 100 %);
the gauges have no pass / fail threshold. AI Assist rates percentages with 90 % and above good, 50-89 % warning, below
50 % critical.

### DynaKube monitoring mode

From the DynaKube custom resource (`k8s.object`, parsed as JSON), first match wins:

| `spec.oneAgent` contains | Mode | Label |
| --- | --- | --- |
| `cloudNativeFullStack` | `CLOUD_NATIVE_FULL_STACK` | Cloud-native full-stack |
| `applicationMonitoring` | `APPLICATION_MONITORING` | Application monitoring |
| `classicFullStack` | `CLASSIC_FULL_STACK` | Classic full-stack |
| `hostMonitoring` | `HOST_MONITORING` | Host monitoring |
| none of these | `KUBERNETES_ONLY` | No OneAgent (ActiveGate only) |

Automatic injection is on unless the DynaKube annotation `feature.dynatrace.com/automatic-injection` is `"false"`.

### Monitoring mode of namespaces, workloads, pods and containers

A namespace gets the mode of the DynaKube that selects it; its pods, workloads and containers inherit it. Inputs per
cluster (by `k8s.cluster.uid`): the set of DynaKube modes (`dkModes`) and the namespaces the DynaKube resources live in
(`dkNamespaces`); per namespace: the label `dynakube.internal.dynatrace.com/instance` (set by the Operator on every
namespace a DynaKube selects) and the mode and automatic-injection flag of the DynaKube of that name in the same cluster.
First match wins ([`modeExpr`](../ui/app/queries.ts#L259)):

| # | Mode | Label | Rule |
| --- | --- | --- | --- |
| 1 | `DYNATRACE` | Dynatrace components | the namespace is one a DynaKube resource lives in (the Operator's namespace) |
| 2 | the DynaKube's mode | (as above) | the namespace carries `dynakube.internal.dynatrace.com/instance=<name>` and a DynaKube `<name>` exists in the cluster |
| 3 | `CLASSIC_FULL_STACK` | Classic full-stack | any DynaKube in the cluster is classic full-stack (it injects from the host, without the label) |
| 4 | `OTEL` | OpenTelemetry | pod: the pod has OpenTelemetry evidence; namespace: at least one of its running pods has |
| 5 | `NO_DYNAKUBE` | No DynaKube | the cluster has no DynaKube |
| 6 | `NOT_SELECTED` | Not selected by a DynaKube | the cluster has a cloud-native full-stack or application-monitoring DynaKube, but none selects this namespace |
| 7 | `HOST_MONITORING` | Host monitoring only | the cluster has a DynaKube that runs a host OneAgent (in practice: host monitoring) |
| 8 | `KUBERNETES_ONLY` | No OneAgent (ActiveGate only) | otherwise |

Workloads: `MIXED` (*Mixed*) when their pods have different modes. Containers: the pod's mode; `NO_DYNAKUBE` when the
container's pod is not in Smartscape and the cluster has no DynaKube; `UNKNOWN` when the pod is not found but the
cluster has one.

### Injection evidence read from each pod

From the pod's annotations (`tags:k8s.annotations`) and its spec (`k8s.object`):

| Flag | True when |
| --- | --- |
| `oneAgent` | `oneagent.dynatrace.com/injected` is `"true"` |
| `injectFailed` | `oneagent.dynatrace.com/injected` is `"false"` |
| `reason` | value of `oneagent.dynatrace.com/reason`, else `dynakube.dynatrace.com/reason` |
| `metadataOnly` | `oneagent.dynatrace.com/injected` is missing or not `"true"`, and `dynakube.dynatrace.com/injected` or `metadata-enrichment.dynatrace.com/injected` is `"true"` |
| `podBlock` | `dynatrace.com/inject` or `oneagent.dynatrace.com/inject` is `"false"` |
| `optIn` | `oneagent.dynatrace.com/inject` is `"true"` |
| `containerBlock` | the annotations contain any key starting with `container.inject.dynatrace.com/` (any value) |
| `otelDynatrace` | `otlp-exporter-configuration.dynatrace.com/injected` is `"true"` (Operator OTLP auto-configuration) |
| `otelOperator` | the pod spec contains `opentelemetry-auto-instrumentation` (OpenTelemetry Operator init container) |
| `otelSdk` | the pod spec contains `OTEL_EXPORTER_OTLP_ENDPOINT` |
| `otel` | any of the three OpenTelemetry flags |
| `system` | the namespace matches `kube-*` or `openshift-*` |

### Injection status of a pod

First match wins ([queries.ts](../ui/app/queries.ts#L287)); the label and group are from `STATUSES` in
[kubernetes.ts](../ui/app/kubernetes.ts#L51).

| # | Status | Label | Rule | Group |
| --- | --- | --- | --- | --- |
| 1 | `DYNATRACE` | Dynatrace components | mode `DYNATRACE` | Excluded by design |
| 2 | `ONEAGENT_OTEL` | OneAgent + OpenTelemetry | `oneAgent` and `otel` | OneAgent + OpenTelemetry |
| 3 | `ONEAGENT` | OneAgent injected | `oneAgent` | OneAgent |
| 4 | `CLASSIC` | Host OneAgent (classic full-stack) | mode `CLASSIC_FULL_STACK` | OneAgent |
| 5 | `OTEL` | OpenTelemetry only | `otel` | OpenTelemetry only |
| 6 | `FAILED` | Injection failed | `injectFailed` | Not injected (mode, opt-in, failure) |
| 7 | `POD_BLOCK` | Pod opt-out annotation | `podBlock` | Pod or container opt-out |
| 8 | `NO_DYNAKUBE` | No DynaKube | mode `NO_DYNAKUBE` | No Operator |
| 9 | `NO_INJECTION` | Mode does not inject | mode `HOST_MONITORING` or `KUBERNETES_ONLY` | Not injected |
| 10 | `SYSTEM` / `NAMESPACE_BLOCK` | System namespace / Namespace not selected | mode `NOT_SELECTED`: `SYSTEM` when `system`, else `NAMESPACE_BLOCK` | Excluded by design / Namespace not selected |
| 11 | `METADATA_ONLY` | Metadata enrichment only | `metadataOnly` | Namespace not selected |
| 12 | `OPT_IN_REQUIRED` | Opt-in required | the namespace's DynaKube has automatic injection off and the pod does not opt in | Not injected |
| 13 | `RESTART_REQUIRED` | Roll out required | otherwise: selected, nothing blocks, no injection annotation (created before the namespace was selected or the Operator installed) | Roll out required |

### Injection status of a workload

Pods with a `k8s.workload.name` are grouped by cluster, namespace, workload kind and name. Status = the one status all
pods share, else `PARTIAL` (*Partially injected*, group *Roll out required*). Mode = the shared mode, else `MIXED`.

### Injection status of a container

The container's status is its pod's status, except `CONTAINER_BLOCK` (*Container excluded*, group *Pod or container
opt-out*) when the pod annotations contain `"container.inject.dynatrace.com/<this container>":"false"` and the pod
status is `ONEAGENT`, `ONEAGENT_OTEL`, `RESTART_REQUIRED`, `OPT_IN_REQUIRED` or `METADATA_ONLY`. Containers whose pod is
not in Smartscape: `HOST_ONEAGENT` (*Host OneAgent, no Operator*) when the cluster has no DynaKube, else `NO_POD`
(*Pod not found*); both are in group *No Operator*.

### Injection status groups (donut slices)

| Group | Label | Member statuses | Legend text |
| --- | --- | --- | --- |
| `ONEAGENT` | OneAgent | ONEAGENT, CLASSIC | Injected by the webhook, or by the host OneAgent in classic full-stack. |
| `ONEAGENT_OTEL` | OneAgent + OpenTelemetry | ONEAGENT_OTEL | risk of duplicate spans and extra overhead |
| `OTEL` | OpenTelemetry only | OTEL | Operator OTLP auto-configuration, OpenTelemetry Operator or an OTLP exporter, not OneAgent |
| `ROLLOUT` | Roll out required | RESTART_REQUIRED, PARTIAL | Nothing blocks injection, but pods were created before it was enabled (or only some pods are injected). |
| `OPT_OUT` | Pod or container opt-out | POD_BLOCK, CONTAINER_BLOCK | An annotation excludes the pod or one of its containers. |
| `NAMESPACE` | Namespace not selected | NAMESPACE_BLOCK, METADATA_ONLY | No DynaKube's OneAgent namespaceSelector matches the namespace. |
| `CONFIG` | Not injected (mode, opt-in, failure) | OPT_IN_REQUIRED, NO_INJECTION, FAILED | The DynaKube mode does not inject, opt-in is required, or the webhook skipped the pod. |
| `NO_OPERATOR` | No Operator | NO_DYNAKUBE, HOST_ONEAGENT, NO_POD | The cluster has no DynaKube. |
| `EXCLUDED` | Excluded by design | SYSTEM, DYNATRACE (and any unknown status) | System namespaces and the Operator's own components. |

### OneAgent coverage of a namespace

Namespaces seen in the timeframe, with their running pods; `oneAgentPods` counts pods with `oneAgent` or status
`CLASSIC`. First match wins:

| Coverage | Label | Rule |
| --- | --- | --- |
| `DYNATRACE` | Dynatrace components | mode `DYNATRACE` |
| `NO_PODS` | No pods | no running pod |
| `SYSTEM` | System namespace | no pod with OneAgent and the name matches `kube-*` / `openshift-*` |
| `ALL` | All pods with OneAgent | every pod has OneAgent |
| `PARTIAL` | Some pods with OneAgent | at least one pod has OneAgent |
| `OTEL` | OpenTelemetry only | no OneAgent pod, at least one OpenTelemetry pod |
| `NONE` | No pod injected | otherwise |

### Cluster-level classification

| Value | Rule |
| --- | --- |
| Cluster has a DynaKube | at least one DynaKube row with the cluster's UID |
| Full-stack cluster | a cloud-native or classic full-stack DynaKube, or both an application-monitoring and a host-monitoring DynaKube |
| Cloud cluster | an EKS / AKS / GKE cluster is attached (matched or cloud-only) |
| Cloud-only | no cluster UID and a cloud cluster: seen only through the cloud integration |
| DynaKube healthy (gauge) | `phase == "Running"` and no failing condition |

### Diagnosis checks

Workload and namespace targets (`diagnoseTarget`, [kubernetes.ts](../ui/app/kubernetes.ts#L383)). Inputs: the target's
pods (Q8), the cluster's DynaKubes from Q1 (mode other than `NONE`, same cluster UID), and the processes (Q9). The
namespace's DynaKube (`nsDk`) is the DynaKube whose name equals the first non-empty selection label among the pods.
Status labels: fail = **Blocking**, warn = **Check**, pass = **OK**, info = **Info**.

| # | Check (title) | Status | In place / triggered when | Fix offered |
| --- | --- | --- | --- | --- |
| 1 | Dynatrace Operator installed / No Dynatrace Operator in the cluster | OK / Blocking | at least one DynaKube in the cluster; otherwise Blocking and **no further checks** | Install the Dynatrace Operator |
| 2 | DynaKube not healthy | Check | a DynaKube has a non-empty phase other than `Running`, or failing conditions | Troubleshoot the Operator and injection |
| 3 | Dynatrace Operator namespace | Info | a DynaKube lives in the target namespace; **no further checks** | — |
| 4a | Classic full-stack mode | Check | a classic full-stack DynaKube exists (legacy; not supported with platform tokens or Latest Dynatrace) | Switch the DynaKube to cloud-native full-stack |
| 4b | No DynaKube injects code modules | Blocking | no cloud-native full-stack or application-monitoring DynaKube | Switch the DynaKube |
| 4c | Application monitoring only (not full-stack) | Check | the namespace's DynaKube is application monitoring and no DynaKube runs a host OneAgent | Switch the DynaKube |
| 4d | Application monitoring with host monitoring | OK | the namespace's DynaKube is application monitoring and another DynaKube runs a host OneAgent | — |
| 4e | Cloud-native full-stack | OK | the namespace has a DynaKube (any other mode) | — |
| 5a | System namespace | Info | `kube-*` / `openshift-*` and (classic, or nothing injects) | — |
| 5b | System namespace (excluded by default) | Info | system namespace, injecting DynaKube, not classic (also mentions AKS `kubernetes.azure.com/managedby: aks`) | — |
| 5c | Namespace not selected by a DynaKube | Blocking | injecting DynaKube, not classic, no `nsDk`. Detail per injecting DynaKube: its `namespaceSelector` and selected count, or "no namespaceSelector ... yet selects n namespaces" (managed platforms can protect their namespaces from webhooks) | Select the namespace for injection |
| 5d | Selected for metadata enrichment only | Blocking | `nsDk` exists and some pods are `METADATA_ONLY` | Select the namespace |
| 5e | Namespace selected | OK | `nsDk` exists, no `METADATA_ONLY` pod | — |
| 6 | Pods opt in / Automatic injection off: opt-in required | OK / Blocking | only when `nsDk` has automatic injection off: OK when every pod (at least one) has `oneagent.dynatrace.com/inject: "true"` | Opt pods in |
| 7a | Pod opt-out annotation / No pod opt-out | Blocking / OK | pods with `podBlock`; the detail notes when those pods use OpenTelemetry ("the opt-out is probably deliberate"). OK when there are pods and none is blocked | Remove the pod opt-out annotation |
| 7b | Containers excluded from injection | Check | a pod excludes a container, or the DynaKube has `container.inject.dynatrace.com/<container>: "false"` annotations | Re-enable injection for an excluded container |
| 8a | OneAgent and OpenTelemetry on the same pods | Check | pods with OneAgent and OpenTelemetry evidence | Avoid double instrumentation |
| 8b | Instrumented with OpenTelemetry instead of OneAgent | Info | pods with OpenTelemetry evidence and no OneAgent | OpenTelemetry: send through the Dynatrace Collector or OTLP auto-configuration |
| 9a | Webhook skipped OneAgent injection | Blocking | pods with status `FAILED`; the detail lists the distinct reasons | Troubleshoot |
| 9b | Roll out required | Blocking | pods with status `RESTART_REQUIRED` (up to 3 names listed) | Roll out the workload |
| 9c | No running pods | Info | no pod seen in the last 15 minutes | — |
| 9d | `<x> of <n> pods with OneAgent` | OK / Check / Info | OK when every pod has OneAgent (or `CLASSIC`), Check when some, Info when none | — |
| 10a | Technology without a OneAgent code module | Check | a process's technology has no code module in the catalogue ([deepTech.ts](../ui/app/deepTech.ts), kind `none`, not a system process group): Ruby, Erlang / Elixir, Envoy, unclassified processes, and database / proxy servers (SQL Server, MySQL, PostgreSQL, MongoDB, Redis, HAProxy) | one action per technology: *Instrument with OpenTelemetry*, *Trace Envoy with OpenTelemetry* or *Monitor `<X>` with its extension* |
| 10b | Injected, but processes without a code module / Supported processes deep monitored | Info / OK | Info when some injected pods exist and processes of a supported technology show no code module (use Diagnose on the [Deep Monitoring](deep-monitoring.md) tab); OK when at least one process is deep monitored and every supported one is | — |

Clusters without a DynaKube (`diagnoseCluster`, [kubernetes.ts](../ui/app/kubernetes.ts#L354)):

| Check | Status | When | Fix |
| --- | --- | --- | --- |
| Seen only through the `<AWS / Azure / Google Cloud>` integration: no Dynatrace Operator | Blocking | cloud-only cluster; the detail gives the cloud description and says no Kubernetes cluster matched it | Install the Dynatrace Operator (with the kubectl context command) |
| No Dynatrace Operator in the cluster | Blocking | any other cluster without a DynaKube | Install |
| Kubernetes API monitoring without a DynaKube | Info | the cluster has a `K8S_CLUSTER` node | — |
| Host-installed OneAgents only | Check | no Kubernetes monitoring and running containers reported by host OneAgents | Install |

## Queries

| # | Name (function in [queries.ts](../ui/app/queries.ts)) | Runs when | Feeds |
| --- | --- | --- | --- |
| Q1 | Clusters and DynaKube deployments (`k8sClustersQuery`) | tab load; timeframe change | cluster gauges, DynaKube gauge, clusters table, search cluster list, diagnosis DynaKubes, AI Assist |
| Q2 | Namespaces by mode and coverage (`k8sNamespaceSummaryQuery`) | tab load; timeframe change | Namespaces donut, namespace gauge, AI Assist |
| Q3 | Workloads by mode and status (`k8sWorkloadSummaryQuery`) | tab load; timeframe change | Workloads donut |
| Q4 | Pods by mode and status (`k8sPodSummaryQuery`) | tab load; timeframe change | Pods donut, pod gauge, AI Assist |
| Q5 | Containers by mode and status (`k8sContainerSummaryQuery`) | tab load; timeframe change | Containers donut |
| Q6 | Workload search (`k8sSearchQuery`, view `workload`) | *Search workloads* or a workload / pod / container slice click | search results |
| Q7 | Namespace search (`k8sSearchQuery`, view `namespace`) | *Search namespaces* or a namespace slice click | search results |
| Q8 | Pods of the diagnosed target (`k8sTargetPodsQuery`) | *Diagnose* on a workload or namespace | diagnosis |
| Q9 | Processes in those pods (`k8sTargetProcessesQuery`) | after Q8, when the pods have UIDs | diagnosis (technology and code-module checks) |
| Q10 | Cloud clusters and their Kubernetes match (`k8sCloudClustersQuery`) | never on its own: exposed in the cluster diagnosis of a cloud cluster (its logic runs inside Q1) | Show DQL only |

All queries are `smartscapeNodes` / `fetch` with explicit time windows. Q1-Q5 re-run when the timeframe changes,
because the timeframe is part of their text. When Q8 returns no pod UID, the processes hook receives no query and the
`useDql` wrapper runs the placeholder `fetch user.events | limit 0` instead ([useDql.ts](../ui/app/useDql.ts)).

**Timeframe.** Every `from:now()-24h` below becomes `from:now()-7d` or `from:now()-30d`. The live window
`from:now()-15m` and `now() - 15m` never change. In Q9 the `metric.series` lookup uses `from:now()-10d` for the 30-day
timeframe (that source only accepts the last 10 days).

### Shared building blocks

The queries are assembled from the same pieces, so they are explained once here.

#### DynaKube mode and automatic injection

```dql
smartscapeNodes "K8S_DYNAKUBE", from:now()-24h
| parse k8s.object, "JSON:o"
| fieldsAdd dkMode = if(isNotNull(o[spec][oneAgent][cloudNativeFullStack]), "CLOUD_NATIVE_FULL_STACK", ... else: "KUBERNETES_ONLY"),
    autoInjection = coalesce(`tags:k8s.annotations`[`feature.dynatrace.com/automatic-injection`], "true") != "false"
```

(abridged here; full in every query below). `k8s.object` holds the whole custom resource (spec and status) as JSON
text; `parse ... "JSON:o"` turns it into the record `o`. `dkMode` is the [DynaKube mode](#dynakube-monitoring-mode).
`autoInjection` reads the feature-flag annotation and defaults to `"true"`.

#### Per-cluster DynaKube lookup

A `lookup` on the DynaKube nodes summarized by `k8s.cluster.uid` adds `dkModes` (distinct modes in the cluster) and
`dkNamespaces` (namespaces the DynaKube resources live in). A record without a match gets null, which the mode rules
read as "no DynaKube".

#### Namespace-to-DynaKube lookup

`K8S_NAMESPACE` nodes get `nsKey = <cluster uid>/<namespace>` and `nsDk` = the value of the label
`dynakube.internal.dynatrace.com/instance`; a nested lookup on `<cluster uid>/<DynaKube name>` adds that DynaKube's
mode (`nsDkMode`) and automatic-injection flag (`nsAutoInjection`).

#### Pod pipeline

Used by Q3-Q9 (`k8sPods`, [queries.ts](../ui/app/queries.ts#L268)): `smartscapeNodes "K8S_POD", from:now()-15m`, the
pod annotations as `a`, the two lookups above, the [evidence flags](#injection-evidence-read-from-each-pod), the
`MODE_FLAGS` (`injecting` = cluster has a cloud-native or application-monitoring DynaKube; `hostAgent` = cloud-native,
classic or host-monitoring; `classic`; `dynatraceNs` = namespace is in `dkNamespaces`; each `coalesce(..., false)`
because `in()` on a null array is null), then `mode` and `status` as in [Checks and scoring](#checks-and-scoring).

#### Cloud cluster matching

No Smartscape edge links a cloud-integration cluster to the Kubernetes cluster it is, and the cluster name in the
DynaKube is free text, so the match goes through the cluster's nodes (`k8sNodeCloudKeys` and `cloudClusters`,
[queries.ts](../ui/app/queries.ts#L353)):

| Provider | Key on the cloud cluster | Key from the Kubernetes nodes (`K8S_NODE`) |
| --- | --- | --- |
| EKS (`AWS_EKS_CLUSTER`) | `EKS/<aws.account.id>/<aws.region>/<name>` | node label `eks.amazonaws.com/nodegroup` = name of an `AWS_EKS_NODEGROUP` node, whose `configuration.clusterName`, account and region form the key |
| AKS (`AZURE_MICROSOFT_CONTAINERSERVICE_MANAGEDCLUSTERS`) | `AKS/` + lower-case `configuration.properties.nodeResourceGroup` | `AKS/` + lower-case node label `kubernetes.azure.com/cluster` (the node resource group) |
| GKE (`GCP_CONTAINER_GOOGLEAPIS_COM_CLUSTER`) | `GKE/<gcp.project.id>/<name>` | `spec.providerID` `gce://<project>/<zone>/<node>` gives the project; the node name `gke-<cluster>-<pool>-<hash>` gives the cluster name (text between `gke-` and `-<pool>-`, pool from label `cloud.google.com/gke-nodepool`) |

Each node key is summarized to one cluster UID (`takeAny(k8s.cluster.uid)`). Fallback: a `K8S_CLUSTER` whose
`<k8s.cluster.distribution>/<k8s.cluster.name>` equals `<provider>/<cloud cluster name>`. `k8sUid` = node match, else
name match. Cloud fields: account (`aws.account.id` / `azure.subscription` / `gcp.project.id`), location (`aws.region` /
`azure.location` / `gcp.location`), resource group (`azure.resource.group`), Kubernetes version
(`configuration.version` / `configuration.properties.kubernetesVersion` / `configuration.resource.currentMasterVersion`)
and state (`aws.state` / `azure.provisioning_state` / `configuration.resource.status`).

### Q1 Clusters and DynaKube deployments

- **Source:** `k8sClustersQuery` ([queries.ts](../ui/app/queries.ts#L401)).
- **Runs:** on tab load and on every timeframe change.
- **Parameters:** timeframe only.

```dql
smartscapeNodes "K8S_DYNAKUBE", from:now()-24h
| parse k8s.object, "JSON:o"
| fieldsAdd dkMode = if(isNotNull(o[spec][oneAgent][cloudNativeFullStack]), "CLOUD_NATIVE_FULL_STACK",
  else: if(isNotNull(o[spec][oneAgent][applicationMonitoring]), "APPLICATION_MONITORING",
  else: if(isNotNull(o[spec][oneAgent][classicFullStack]), "CLASSIC_FULL_STACK",
  else: if(isNotNull(o[spec][oneAgent][hostMonitoring]), "HOST_MONITORING", else: "KUBERNETES_ONLY")))),
    autoInjection = coalesce(`tags:k8s.annotations`[`feature.dynatrace.com/automatic-injection`], "true") != "false"
| fieldsAdd conds = o[status][conditions]
| fieldsAdd failing = if(conds[][status] != "True", conds[][type]), nsMatch = if(conds[][type] == "OneAgentNamespacesMonitored", conds[][message])
| fieldsAdd failing = arrayRemoveNulls(failing), nsMatch = arrayFirst(arrayRemoveNulls(nsMatch)), dkKey = concat(k8s.cluster.uid, "/", name)
| lookup [smartscapeNodes "K8S_NAMESPACE", from:now()-24h
    | fieldsAdd dk = `tags:k8s.labels`[`dynakube.internal.dynatrace.com/instance`]
    | filter isNotNull(dk)
    | summarize selected = count(), by:{dkKey = concat(k8s.cluster.uid, "/", dk)}
  ], sourceField:dkKey, lookupField:dkKey, fields:{selected}
| lookup [smartscapeNodes "CONTAINER", from:now()-24h
    | filter k8s.container.name == "operator" and endsWith(container.image.name, "/dynatrace-operator")
    | summarize operatorVersions = collectDistinct(container.image.version), by:{k8s.cluster.uid}
  ], sourceField:k8s.cluster.uid, lookupField:k8s.cluster.uid, fields:{operatorVersions}
| lookup [smartscapeNodes "K8S_CLUSTER", from:now()-24h | fields k8s.cluster.uid, clusterId = id], sourceField:k8s.cluster.uid, lookupField:k8s.cluster.uid, fields:{clusterId}
| fields id, name, clusterId, cluster = k8s.cluster.name, clusterUid = k8s.cluster.uid, namespace = k8s.namespace.name, mode = dkMode, autoInjection, k8sMonitoring = isNotNull(clusterId),
    apiVersion = o[apiVersion], phase = o[status][phase], operatorVersions,
    oneAgentVersion = o[status][oneAgent][version], codeModulesVersion = o[status][codeModules][version],
    activeGateVersion = o[status][activeGate][version], activeGateCapabilities = o[spec][activeGate][capabilities],
    hostGroup = o[spec][oneAgent][hostGroup],
    metadataEnrichment = coalesce(o[spec][metadataEnrichment][enabled], false), logMonitoring = isNotNull(o[spec][logMonitoring]),
    kspm = isNotNull(o[spec][kspm]), extensions = isNotNull(o[spec][extensions]), telemetryIngest = isNotNull(o[spec][telemetryIngest]),
    namespaceSelector = toString(coalesce(o[spec][oneAgent][cloudNativeFullStack][namespaceSelector], o[spec][oneAgent][applicationMonitoring][namespaceSelector])),
    otlpExporter = isNotNull(o[spec][otlpExporterConfiguration]), selected, nsMatch, failing, updated = o[status][updatedTimestamp],
    annotations = toString(`tags:k8s.annotations`)
| append [smartscapeNodes "K8S_CLUSTER", "CONTAINER", from:now()-24h
    | filter isNotNull(k8s.cluster.uid)
    | summarize clusterIds = collectDistinct(if(type == "K8S_CLUSTER", id)), names = collectDistinct(coalesce(k8s.cluster.name, if(type == "K8S_CLUSTER", name))),
        containers = countIf(type == "CONTAINER" and lifetime[end] >= now() - 15m), by:{k8s.cluster.uid}
    | lookup [smartscapeNodes "K8S_DYNAKUBE", from:now()-24h | summarize dks = count(), by:{k8s.cluster.uid}], sourceField:k8s.cluster.uid, lookupField:k8s.cluster.uid, fields:{dks}
    | filter isNull(dks)
    | fieldsAdd clusterIds = arrayRemoveNulls(clusterIds), names = arrayRemoveNulls(names)
    | fields clusterId = arrayFirst(clusterIds), cluster = coalesce(arrayFirst(names), k8s.cluster.uid), clusterUid = k8s.cluster.uid, mode = "NONE",
        k8sMonitoring = arraySize(clusterIds) > 0, containers]
| lookup [smartscapeNodes "AWS_EKS_CLUSTER", "AZURE_MICROSOFT_CONTAINERSERVICE_MANAGEDCLUSTERS", "GCP_CONTAINER_GOOGLEAPIS_COM_CLUSTER", from:now()-24h
    | parse coalesce(aws.object, azure.object, gcp.object), "JSON:o"
    | fieldsAdd provider = if(type == "AWS_EKS_CLUSTER", "EKS", else: if(type == "AZURE_MICROSOFT_CONTAINERSERVICE_MANAGEDCLUSTERS", "AKS", else: "GKE"))
    | fieldsAdd cloudKey = if(provider == "EKS", concat("EKS/", aws.account.id, "/", aws.region, "/", name),
          else: if(provider == "AKS", concat("AKS/", lower(o[configuration][properties][nodeResourceGroup])), else: concat("GKE/", gcp.project.id, "/", name))),
        nameKey = concat(provider, "/", name)
    | lookup [smartscapeNodes "K8S_NODE", from:now()-24h
        | parse k8s.object, "JSON:o"
        | fieldsAdd lbl = `tags:k8s.labels`, providerID = toString(o[spec][providerID])
        | fieldsAdd ng = lbl[`eks.amazonaws.com/nodegroup`], aksRg = lbl[`kubernetes.azure.com/cluster`], gkePool = lbl[`cloud.google.com/gke-nodepool`]
        | lookup [smartscapeNodes "AWS_EKS_NODEGROUP", from:now()-24h | parse aws.object, "JSON:g" | fields ng = name, eksKey = concat("EKS/", aws.account.id, "/", aws.region, "/", g[configuration][clusterName])], sourceField:ng, lookupField:ng, fields:{eksKey}
        | fieldsAdd poolAt = if(isNotNull(gkePool) and startsWith(name, "gke-"), indexOf(name, concat("-", gkePool, "-")))
        | fieldsAdd gkeKey = if(startsWith(providerID, "gce://") and poolAt > 4, concat("GKE/", splitString(substring(providerID, from:6), "/")[0], "/", substring(name, from:4, to:poolAt)))
        | fieldsAdd cloudKey = coalesce(eksKey, if(isNotNull(aksRg), concat("AKS/", lower(aksRg))), gkeKey)
        | filter isNotNull(cloudKey)
        | summarize k8sUid = takeAny(k8s.cluster.uid), by:{cloudKey}
      ], sourceField:cloudKey, lookupField:cloudKey, fields:{k8sUid}
    | lookup [smartscapeNodes "K8S_CLUSTER", from:now()-24h | fields nameKey = concat(k8s.cluster.distribution, "/", k8s.cluster.name), byName = k8s.cluster.uid], sourceField:nameKey, lookupField:nameKey, fields:{byName}
    | fields cloudId = id, cloudName = name, cloudProvider = provider, k8sUid = coalesce(k8sUid, byName),
        cloudAccount = coalesce(aws.account.id, azure.subscription, gcp.project.id), cloudLocation = coalesce(aws.region, azure.location, gcp.location),
        cloudResourceGroup = azure.resource.group,
        cloudVersion = coalesce(o[configuration][version], o[configuration][properties][kubernetesVersion], o[configuration][resource][currentMasterVersion]),
        cloudState = coalesce(aws.state, azure.provisioning_state, o[configuration][resource][status])
    | filter isNotNull(k8sUid)
  ], sourceField:clusterUid, lookupField:k8sUid, fields:{cloudId, cloudName, cloudProvider, cloudAccount, cloudLocation, cloudResourceGroup, cloudVersion, cloudState}
| append [smartscapeNodes "AWS_EKS_CLUSTER", "AZURE_MICROSOFT_CONTAINERSERVICE_MANAGEDCLUSTERS", "GCP_CONTAINER_GOOGLEAPIS_COM_CLUSTER", from:now()-24h
    | parse coalesce(aws.object, azure.object, gcp.object), "JSON:o"
    | fieldsAdd provider = if(type == "AWS_EKS_CLUSTER", "EKS", else: if(type == "AZURE_MICROSOFT_CONTAINERSERVICE_MANAGEDCLUSTERS", "AKS", else: "GKE"))
    | fieldsAdd cloudKey = if(provider == "EKS", concat("EKS/", aws.account.id, "/", aws.region, "/", name),
          else: if(provider == "AKS", concat("AKS/", lower(o[configuration][properties][nodeResourceGroup])), else: concat("GKE/", gcp.project.id, "/", name))),
        nameKey = concat(provider, "/", name)
    | lookup [smartscapeNodes "K8S_NODE", from:now()-24h
        | parse k8s.object, "JSON:o"
        | fieldsAdd lbl = `tags:k8s.labels`, providerID = toString(o[spec][providerID])
        | fieldsAdd ng = lbl[`eks.amazonaws.com/nodegroup`], aksRg = lbl[`kubernetes.azure.com/cluster`], gkePool = lbl[`cloud.google.com/gke-nodepool`]
        | lookup [smartscapeNodes "AWS_EKS_NODEGROUP", from:now()-24h | parse aws.object, "JSON:g" | fields ng = name, eksKey = concat("EKS/", aws.account.id, "/", aws.region, "/", g[configuration][clusterName])], sourceField:ng, lookupField:ng, fields:{eksKey}
        | fieldsAdd poolAt = if(isNotNull(gkePool) and startsWith(name, "gke-"), indexOf(name, concat("-", gkePool, "-")))
        | fieldsAdd gkeKey = if(startsWith(providerID, "gce://") and poolAt > 4, concat("GKE/", splitString(substring(providerID, from:6), "/")[0], "/", substring(name, from:4, to:poolAt)))
        | fieldsAdd cloudKey = coalesce(eksKey, if(isNotNull(aksRg), concat("AKS/", lower(aksRg))), gkeKey)
        | filter isNotNull(cloudKey)
        | summarize k8sUid = takeAny(k8s.cluster.uid), by:{cloudKey}
      ], sourceField:cloudKey, lookupField:cloudKey, fields:{k8sUid}
    | lookup [smartscapeNodes "K8S_CLUSTER", from:now()-24h | fields nameKey = concat(k8s.cluster.distribution, "/", k8s.cluster.name), byName = k8s.cluster.uid], sourceField:nameKey, lookupField:nameKey, fields:{byName}
    | fields cloudId = id, cloudName = name, cloudProvider = provider, k8sUid = coalesce(k8sUid, byName),
        cloudAccount = coalesce(aws.account.id, azure.subscription, gcp.project.id), cloudLocation = coalesce(aws.region, azure.location, gcp.location),
        cloudResourceGroup = azure.resource.group,
        cloudVersion = coalesce(o[configuration][version], o[configuration][properties][kubernetesVersion], o[configuration][resource][currentMasterVersion]),
        cloudState = coalesce(aws.state, azure.provisioning_state, o[configuration][resource][status])
    | filter isNull(k8sUid)
    | fields cluster = cloudName, mode = "NONE", k8sMonitoring = false, containers = 0, cloudId, cloudName, cloudProvider, cloudAccount, cloudLocation, cloudResourceGroup, cloudVersion, cloudState]
| sort cluster asc, name asc
```

**How it works:**

1. `smartscapeNodes "K8S_DYNAKUBE"` with `parse` and `dkMode` / `autoInjection` (see [building blocks](#dynakube-mode-and-automatic-injection)).
2. `conds = o[status][conditions]`; `failing` = the `type` of every condition whose `status` is not `"True"`
   (iterative expression over the array), `nsMatch` = the `message` of the `OneAgentNamespacesMonitored` condition;
   `arrayRemoveNulls` / `arrayFirst` clean them up. `dkKey = <cluster uid>/<DynaKube name>`.
3. Lookup on `K8S_NAMESPACE` nodes with the selection label, counted per `<cluster uid>/<label value>`: `selected`.
4. Lookup on `CONTAINER` nodes named `operator` whose image ends with `/dynatrace-operator`: distinct image versions
   per cluster, `operatorVersions`.
5. Lookup on `K8S_CLUSTER` by UID: `clusterId` (its node ID; present = Kubernetes monitoring).
6. `fields` picks the row: identity, mode, phase, versions (`status.oneAgent.version`, `status.codeModules.version`,
   `status.activeGate.version`), ActiveGate capabilities (`spec.activeGate.capabilities`), host group, the feature flags
   (`spec.metadataEnrichment.enabled`, presence of `spec.logMonitoring`, `spec.kspm`, `spec.extensions`,
   `spec.telemetryIngest`, `spec.otlpExporterConfiguration`), the OneAgent `namespaceSelector` (cloud-native or
   application monitoring) as text, `updated` and the DynaKube's annotations as JSON text.
7. `append`: `K8S_CLUSTER` and `CONTAINER` nodes with a cluster UID, summarized per UID: the cluster node IDs, the names,
   and `containers` = containers whose lifetime ends in the last 15 minutes. A lookup counts DynaKubes per UID and
   `filter isNull(dks)` keeps only clusters without one. These rows get `mode = "NONE"` and
   `k8sMonitoring = arraySize(clusterIds) > 0`.
8. `lookup` of the [cloud clusters](#cloud-cluster-matching) that matched a Kubernetes cluster, on `clusterUid ==
   k8sUid`: adds the `cloud*` fields to DynaKube and `NONE` rows.
9. `append` of the cloud clusters that matched none, as rows with `cluster = cloudName`, `mode = "NONE"`,
   `k8sMonitoring = false`, `containers = 0`.
10. `sort cluster asc, name asc`.

**Output:** `id`, `name`, `clusterId`, `cluster`, `clusterUid`, `namespace`, `mode`, `autoInjection`, `k8sMonitoring`,
`apiVersion`, `phase`, `operatorVersions`, `oneAgentVersion`, `codeModulesVersion`, `activeGateVersion`,
`activeGateCapabilities`, `hostGroup`, the six feature booleans, `namespaceSelector`, `selected`, `nsMatch`, `failing`,
`updated`, `annotations`, `containers`, `cloudId`, `cloudName`, `cloudProvider`, `cloudAccount`, `cloudLocation`,
`cloudResourceGroup`, `cloudVersion`, `cloudState`. Used by the clusters table columns, the gauges (through
[`toClusters`](#cluster-list-toclusters)), the diagnosis (`annotations` for DynaKube-wide container exclusions,
`namespaceSelector`, `selected`, `autoInjection`, `phase`, `failing`) and AI Assist. `apiVersion`, `hostGroup` and
`updated` are read but not shown.

**Limits and cost:** no `limit`; Smartscape only. The cloud-cluster sub-pipeline appears twice (lookup and append), and
every `K8S_NODE`'s `k8s.object` is parsed. **Open it yourself:** query actions under the gauges (*DQL behind these
gauges*) and under the clusters table.

### Q2 Namespaces by mode and coverage

- **Source:** `k8sNamespaceSummaryQuery` (built on `k8sNamespacesBase`, [queries.ts](../ui/app/queries.ts#L336)).
- **Runs:** on tab load and on every timeframe change.

```dql
smartscapeNodes "K8S_NAMESPACE", from:now()-24h
    | fieldsAdd nsKey = concat(k8s.cluster.uid, "/", k8s.namespace.name), nsDk = `tags:k8s.labels`[`dynakube.internal.dynatrace.com/instance`]
    | fieldsAdd dkKey = concat(k8s.cluster.uid, "/", nsDk)
    | lookup [smartscapeNodes "K8S_DYNAKUBE", from:now()-24h
    | parse k8s.object, "JSON:o"
    | fieldsAdd dkMode = if(isNotNull(o[spec][oneAgent][cloudNativeFullStack]), "CLOUD_NATIVE_FULL_STACK",
      else: if(isNotNull(o[spec][oneAgent][applicationMonitoring]), "APPLICATION_MONITORING",
      else: if(isNotNull(o[spec][oneAgent][classicFullStack]), "CLASSIC_FULL_STACK",
      else: if(isNotNull(o[spec][oneAgent][hostMonitoring]), "HOST_MONITORING", else: "KUBERNETES_ONLY")))),
        autoInjection = coalesce(`tags:k8s.annotations`[`feature.dynatrace.com/automatic-injection`], "true") != "false" | fields dkKey = concat(k8s.cluster.uid, "/", name), nsDkMode = dkMode, nsAutoInjection = autoInjection], sourceField:dkKey, lookupField:dkKey, fields:{nsDkMode, nsAutoInjection}
| lookup [smartscapeNodes "K8S_DYNAKUBE", from:now()-24h
    | parse k8s.object, "JSON:o"
    | fieldsAdd dkMode = if(isNotNull(o[spec][oneAgent][cloudNativeFullStack]), "CLOUD_NATIVE_FULL_STACK",
      else: if(isNotNull(o[spec][oneAgent][applicationMonitoring]), "APPLICATION_MONITORING",
      else: if(isNotNull(o[spec][oneAgent][classicFullStack]), "CLASSIC_FULL_STACK",
      else: if(isNotNull(o[spec][oneAgent][hostMonitoring]), "HOST_MONITORING", else: "KUBERNETES_ONLY")))),
        autoInjection = coalesce(`tags:k8s.annotations`[`feature.dynatrace.com/automatic-injection`], "true") != "false"
    | summarize dkModes = collectDistinct(dkMode), dkNamespaces = collectDistinct(k8s.namespace.name), by:{k8s.cluster.uid}
  ], sourceField:k8s.cluster.uid, lookupField:k8s.cluster.uid, fields:{dkModes, dkNamespaces}
| lookup [smartscapeNodes "K8S_POD", from:now()-15m
  | fieldsAdd a = `tags:k8s.annotations`, nsKey = concat(k8s.cluster.uid, "/", k8s.namespace.name)
  | lookup [smartscapeNodes "K8S_DYNAKUBE", from:now()-24h
      | parse k8s.object, "JSON:o"
      | fieldsAdd dkMode = if(isNotNull(o[spec][oneAgent][cloudNativeFullStack]), "CLOUD_NATIVE_FULL_STACK",
        else: if(isNotNull(o[spec][oneAgent][applicationMonitoring]), "APPLICATION_MONITORING",
        else: if(isNotNull(o[spec][oneAgent][classicFullStack]), "CLASSIC_FULL_STACK",
        else: if(isNotNull(o[spec][oneAgent][hostMonitoring]), "HOST_MONITORING", else: "KUBERNETES_ONLY")))),
          autoInjection = coalesce(`tags:k8s.annotations`[`feature.dynatrace.com/automatic-injection`], "true") != "false"
      | summarize dkModes = collectDistinct(dkMode), dkNamespaces = collectDistinct(k8s.namespace.name), by:{k8s.cluster.uid}
    ], sourceField:k8s.cluster.uid, lookupField:k8s.cluster.uid, fields:{dkModes, dkNamespaces}
  | lookup [smartscapeNodes "K8S_NAMESPACE", from:now()-24h
      | fieldsAdd nsKey = concat(k8s.cluster.uid, "/", k8s.namespace.name), nsDk = `tags:k8s.labels`[`dynakube.internal.dynatrace.com/instance`]
      | fieldsAdd dkKey = concat(k8s.cluster.uid, "/", nsDk)
      | lookup [smartscapeNodes "K8S_DYNAKUBE", from:now()-24h
      | parse k8s.object, "JSON:o"
      | fieldsAdd dkMode = if(isNotNull(o[spec][oneAgent][cloudNativeFullStack]), "CLOUD_NATIVE_FULL_STACK",
        else: if(isNotNull(o[spec][oneAgent][applicationMonitoring]), "APPLICATION_MONITORING",
        else: if(isNotNull(o[spec][oneAgent][classicFullStack]), "CLASSIC_FULL_STACK",
        else: if(isNotNull(o[spec][oneAgent][hostMonitoring]), "HOST_MONITORING", else: "KUBERNETES_ONLY")))),
          autoInjection = coalesce(`tags:k8s.annotations`[`feature.dynatrace.com/automatic-injection`], "true") != "false" | fields dkKey = concat(k8s.cluster.uid, "/", name), nsDkMode = dkMode, nsAutoInjection = autoInjection], sourceField:dkKey, lookupField:dkKey, fields:{nsDkMode, nsAutoInjection} | fields nsKey, nsDk, nsDkMode, nsAutoInjection], sourceField:nsKey, lookupField:nsKey, fields:{nsDk, nsDkMode, nsAutoInjection}
  | fieldsAdd oneAgent = coalesce(a[`oneagent.dynatrace.com/injected`] == "true", false),
      injectFailed = coalesce(a[`oneagent.dynatrace.com/injected`] == "false", false),
      reason = coalesce(a[`oneagent.dynatrace.com/reason`], a[`dynakube.dynatrace.com/reason`]),
      metadataOnly = coalesce(a[`oneagent.dynatrace.com/injected`] != "true", true)
        and coalesce(a[`dynakube.dynatrace.com/injected`] == "true" or a[`metadata-enrichment.dynatrace.com/injected`] == "true", false),
      podBlock = coalesce(a[`dynatrace.com/inject`] == "false" or a[`oneagent.dynatrace.com/inject`] == "false", false),
      optIn = coalesce(a[`oneagent.dynatrace.com/inject`] == "true", false),
      containerBlock = contains(toString(a), "\"container.inject.dynatrace.com/"),
      otelDynatrace = coalesce(a[`otlp-exporter-configuration.dynatrace.com/injected`] == "true", false),
      otelOperator = contains(k8s.object, "opentelemetry-auto-instrumentation"),
      otelSdk = contains(k8s.object, "OTEL_EXPORTER_OTLP_ENDPOINT"),
      system = matchesValue(k8s.namespace.name, "kube-*") or matchesValue(k8s.namespace.name, "openshift-*")
  | fieldsAdd otel = otelDynatrace or otelOperator or otelSdk
  | fieldsAdd injecting = coalesce(in("CLOUD_NATIVE_FULL_STACK", dkModes) or in("APPLICATION_MONITORING", dkModes), false),
      hostAgent = coalesce(in("CLOUD_NATIVE_FULL_STACK", dkModes) or in("CLASSIC_FULL_STACK", dkModes) or in("HOST_MONITORING", dkModes), false),
      classic = coalesce(in("CLASSIC_FULL_STACK", dkModes), false),
      dynatraceNs = coalesce(in(k8s.namespace.name, dkNamespaces), false)
  | fieldsAdd mode = if(dynatraceNs, "DYNATRACE",
        else: if(isNotNull(nsDkMode), nsDkMode,
        else: if(classic, "CLASSIC_FULL_STACK",
        else: if(otel, "OTEL",
        else: if(isNull(dkModes), "NO_DYNAKUBE",
        else: if(injecting, "NOT_SELECTED",
        else: if(hostAgent, "HOST_MONITORING", else: "KUBERNETES_ONLY")))))))
  | fieldsAdd status = if(mode == "DYNATRACE", "DYNATRACE",
        else: if(oneAgent and otel, "ONEAGENT_OTEL",
        else: if(oneAgent, "ONEAGENT",
        else: if(mode == "CLASSIC_FULL_STACK", "CLASSIC",
        else: if(otel, "OTEL",
        else: if(injectFailed, "FAILED",
        else: if(podBlock, "POD_BLOCK",
        else: if(mode == "NO_DYNAKUBE", "NO_DYNAKUBE",
        else: if(mode == "HOST_MONITORING" or mode == "KUBERNETES_ONLY", "NO_INJECTION",
        else: if(mode == "NOT_SELECTED", if(system, "SYSTEM", else: "NAMESPACE_BLOCK"),
        else: if(metadataOnly, "METADATA_ONLY",
        else: if(nsAutoInjection == false and not optIn, "OPT_IN_REQUIRED", else: "RESTART_REQUIRED"))))))))))))
  | summarize pods = count(), oneAgentPods = countIf(oneAgent or status == "CLASSIC"), otelPods = countIf(otel), by:{nsKey}], sourceField:nsKey, lookupField:nsKey, fields:{pods, oneAgentPods, otelPods}
| fieldsAdd pods = coalesce(pods, 0), oneAgentPods = coalesce(oneAgentPods, 0), otelPods = coalesce(otelPods, 0)
| fieldsAdd injecting = coalesce(in("CLOUD_NATIVE_FULL_STACK", dkModes) or in("APPLICATION_MONITORING", dkModes), false),
    hostAgent = coalesce(in("CLOUD_NATIVE_FULL_STACK", dkModes) or in("CLASSIC_FULL_STACK", dkModes) or in("HOST_MONITORING", dkModes), false),
    classic = coalesce(in("CLASSIC_FULL_STACK", dkModes), false),
    dynatraceNs = coalesce(in(k8s.namespace.name, dkNamespaces), false)
| fieldsAdd mode = if(dynatraceNs, "DYNATRACE",
      else: if(isNotNull(nsDkMode), nsDkMode,
      else: if(classic, "CLASSIC_FULL_STACK",
      else: if(otelPods > 0, "OTEL",
      else: if(isNull(dkModes), "NO_DYNAKUBE",
      else: if(injecting, "NOT_SELECTED",
      else: if(hostAgent, "HOST_MONITORING", else: "KUBERNETES_ONLY")))))))
| fieldsAdd status = if(mode == "DYNATRACE", "DYNATRACE",
      else: if(pods == 0, "NO_PODS",
      else: if(oneAgentPods == 0 and (matchesValue(k8s.namespace.name, "kube-*") or matchesValue(k8s.namespace.name, "openshift-*")), "SYSTEM",
      else: if(oneAgentPods == pods, "ALL",
      else: if(oneAgentPods > 0, "PARTIAL",
      else: if(otelPods > 0, "OTEL", else: "NONE"))))))
| summarize n = count(), by:{mode, status}
```

**How it works:** namespaces over the timeframe with the [namespace-to-DynaKube lookup](#namespace-to-dynakube-lookup)
and the [per-cluster lookup](#per-cluster-dynakube-lookup); a lookup on the [pod pipeline](#pod-pipeline) summarized
per `nsKey` gives `pods`, `oneAgentPods` (OneAgent or `CLASSIC`) and `otelPods` (0 when the namespace has no running
pod); the mode flags; `mode` with "any pod uses OpenTelemetry" (`otelPods > 0`) as the OpenTelemetry rule; the
[coverage](#oneagent-coverage-of-a-namespace) as `status`; `summarize n = count(), by:{mode, status}`.

**Output:** `mode`, `status`, `n`. Namespaces donut (both groupings), *Namespaces fully injected* gauge, AI Assist
namespace counts. **Limits and cost:** Smartscape only; the DynaKube subquery is embedded four times. **Open it
yourself:** on the Namespaces card and under the gauges.

### Q3 Workloads by mode and status

- **Source:** `k8sWorkloadSummaryQuery` ([queries.ts](../ui/app/queries.ts#L314)). **Runs:** tab load, timeframe change.

```dql
smartscapeNodes "K8S_POD", from:now()-15m
| fieldsAdd a = `tags:k8s.annotations`, nsKey = concat(k8s.cluster.uid, "/", k8s.namespace.name)
| lookup [smartscapeNodes "K8S_DYNAKUBE", from:now()-24h
    | parse k8s.object, "JSON:o"
    | fieldsAdd dkMode = if(isNotNull(o[spec][oneAgent][cloudNativeFullStack]), "CLOUD_NATIVE_FULL_STACK",
      else: if(isNotNull(o[spec][oneAgent][applicationMonitoring]), "APPLICATION_MONITORING",
      else: if(isNotNull(o[spec][oneAgent][classicFullStack]), "CLASSIC_FULL_STACK",
      else: if(isNotNull(o[spec][oneAgent][hostMonitoring]), "HOST_MONITORING", else: "KUBERNETES_ONLY")))),
        autoInjection = coalesce(`tags:k8s.annotations`[`feature.dynatrace.com/automatic-injection`], "true") != "false"
    | summarize dkModes = collectDistinct(dkMode), dkNamespaces = collectDistinct(k8s.namespace.name), by:{k8s.cluster.uid}
  ], sourceField:k8s.cluster.uid, lookupField:k8s.cluster.uid, fields:{dkModes, dkNamespaces}
| lookup [smartscapeNodes "K8S_NAMESPACE", from:now()-24h
    | fieldsAdd nsKey = concat(k8s.cluster.uid, "/", k8s.namespace.name), nsDk = `tags:k8s.labels`[`dynakube.internal.dynatrace.com/instance`]
    | fieldsAdd dkKey = concat(k8s.cluster.uid, "/", nsDk)
    | lookup [smartscapeNodes "K8S_DYNAKUBE", from:now()-24h
    | parse k8s.object, "JSON:o"
    | fieldsAdd dkMode = if(isNotNull(o[spec][oneAgent][cloudNativeFullStack]), "CLOUD_NATIVE_FULL_STACK",
      else: if(isNotNull(o[spec][oneAgent][applicationMonitoring]), "APPLICATION_MONITORING",
      else: if(isNotNull(o[spec][oneAgent][classicFullStack]), "CLASSIC_FULL_STACK",
      else: if(isNotNull(o[spec][oneAgent][hostMonitoring]), "HOST_MONITORING", else: "KUBERNETES_ONLY")))),
        autoInjection = coalesce(`tags:k8s.annotations`[`feature.dynatrace.com/automatic-injection`], "true") != "false" | fields dkKey = concat(k8s.cluster.uid, "/", name), nsDkMode = dkMode, nsAutoInjection = autoInjection], sourceField:dkKey, lookupField:dkKey, fields:{nsDkMode, nsAutoInjection} | fields nsKey, nsDk, nsDkMode, nsAutoInjection], sourceField:nsKey, lookupField:nsKey, fields:{nsDk, nsDkMode, nsAutoInjection}
| fieldsAdd oneAgent = coalesce(a[`oneagent.dynatrace.com/injected`] == "true", false),
    injectFailed = coalesce(a[`oneagent.dynatrace.com/injected`] == "false", false),
    reason = coalesce(a[`oneagent.dynatrace.com/reason`], a[`dynakube.dynatrace.com/reason`]),
    metadataOnly = coalesce(a[`oneagent.dynatrace.com/injected`] != "true", true)
      and coalesce(a[`dynakube.dynatrace.com/injected`] == "true" or a[`metadata-enrichment.dynatrace.com/injected`] == "true", false),
    podBlock = coalesce(a[`dynatrace.com/inject`] == "false" or a[`oneagent.dynatrace.com/inject`] == "false", false),
    optIn = coalesce(a[`oneagent.dynatrace.com/inject`] == "true", false),
    containerBlock = contains(toString(a), "\"container.inject.dynatrace.com/"),
    otelDynatrace = coalesce(a[`otlp-exporter-configuration.dynatrace.com/injected`] == "true", false),
    otelOperator = contains(k8s.object, "opentelemetry-auto-instrumentation"),
    otelSdk = contains(k8s.object, "OTEL_EXPORTER_OTLP_ENDPOINT"),
    system = matchesValue(k8s.namespace.name, "kube-*") or matchesValue(k8s.namespace.name, "openshift-*")
| fieldsAdd otel = otelDynatrace or otelOperator or otelSdk
| fieldsAdd injecting = coalesce(in("CLOUD_NATIVE_FULL_STACK", dkModes) or in("APPLICATION_MONITORING", dkModes), false),
    hostAgent = coalesce(in("CLOUD_NATIVE_FULL_STACK", dkModes) or in("CLASSIC_FULL_STACK", dkModes) or in("HOST_MONITORING", dkModes), false),
    classic = coalesce(in("CLASSIC_FULL_STACK", dkModes), false),
    dynatraceNs = coalesce(in(k8s.namespace.name, dkNamespaces), false)
| fieldsAdd mode = if(dynatraceNs, "DYNATRACE",
      else: if(isNotNull(nsDkMode), nsDkMode,
      else: if(classic, "CLASSIC_FULL_STACK",
      else: if(otel, "OTEL",
      else: if(isNull(dkModes), "NO_DYNAKUBE",
      else: if(injecting, "NOT_SELECTED",
      else: if(hostAgent, "HOST_MONITORING", else: "KUBERNETES_ONLY")))))))
| fieldsAdd status = if(mode == "DYNATRACE", "DYNATRACE",
      else: if(oneAgent and otel, "ONEAGENT_OTEL",
      else: if(oneAgent, "ONEAGENT",
      else: if(mode == "CLASSIC_FULL_STACK", "CLASSIC",
      else: if(otel, "OTEL",
      else: if(injectFailed, "FAILED",
      else: if(podBlock, "POD_BLOCK",
      else: if(mode == "NO_DYNAKUBE", "NO_DYNAKUBE",
      else: if(mode == "HOST_MONITORING" or mode == "KUBERNETES_ONLY", "NO_INJECTION",
      else: if(mode == "NOT_SELECTED", if(system, "SYSTEM", else: "NAMESPACE_BLOCK"),
      else: if(metadataOnly, "METADATA_ONLY",
      else: if(nsAutoInjection == false and not optIn, "OPT_IN_REQUIRED", else: "RESTART_REQUIRED"))))))))))))
| filter isNotNull(k8s.workload.name)
| summarize pods = count(), oneAgentPods = countIf(oneAgent), otelPods = countIf(otel), blockedPods = countIf(podBlock), containerBlockPods = countIf(containerBlock),
    statuses = collectDistinct(status), modes = collectDistinct(mode),
    by:{k8s.cluster.name, k8s.cluster.uid, k8s.namespace.name, k8s.workload.kind, k8s.workload.name}
| fieldsAdd status = if(arraySize(statuses) == 1, statuses[0], else: "PARTIAL"), mode = if(arraySize(modes) == 1, modes[0], else: "MIXED")
| summarize n = count(), by:{mode, status}
```

**How it works:** the [pod pipeline](#pod-pipeline); `filter isNotNull(k8s.workload.name)` drops pods without a
controller; `summarize` per cluster, namespace, workload kind and name with pod counts, `statuses` and `modes`
(distinct); `status` = the single status or `PARTIAL`, `mode` = the single mode or `MIXED`; `summarize n` per
`{mode, status}`. **Output:** `mode`, `status`, `n` (Workloads donut). **Limits:** live pods only (15 minutes).
**Open it yourself:** on the Workloads card.

### Q4 Pods by mode and status

- **Source:** `k8sPodSummaryQuery` ([queries.ts](../ui/app/queries.ts#L310)). **Runs:** tab load, timeframe change.

```dql
smartscapeNodes "K8S_POD", from:now()-15m
| fieldsAdd a = `tags:k8s.annotations`, nsKey = concat(k8s.cluster.uid, "/", k8s.namespace.name)
| lookup [smartscapeNodes "K8S_DYNAKUBE", from:now()-24h
    | parse k8s.object, "JSON:o"
    | fieldsAdd dkMode = if(isNotNull(o[spec][oneAgent][cloudNativeFullStack]), "CLOUD_NATIVE_FULL_STACK",
      else: if(isNotNull(o[spec][oneAgent][applicationMonitoring]), "APPLICATION_MONITORING",
      else: if(isNotNull(o[spec][oneAgent][classicFullStack]), "CLASSIC_FULL_STACK",
      else: if(isNotNull(o[spec][oneAgent][hostMonitoring]), "HOST_MONITORING", else: "KUBERNETES_ONLY")))),
        autoInjection = coalesce(`tags:k8s.annotations`[`feature.dynatrace.com/automatic-injection`], "true") != "false"
    | summarize dkModes = collectDistinct(dkMode), dkNamespaces = collectDistinct(k8s.namespace.name), by:{k8s.cluster.uid}
  ], sourceField:k8s.cluster.uid, lookupField:k8s.cluster.uid, fields:{dkModes, dkNamespaces}
| lookup [smartscapeNodes "K8S_NAMESPACE", from:now()-24h
    | fieldsAdd nsKey = concat(k8s.cluster.uid, "/", k8s.namespace.name), nsDk = `tags:k8s.labels`[`dynakube.internal.dynatrace.com/instance`]
    | fieldsAdd dkKey = concat(k8s.cluster.uid, "/", nsDk)
    | lookup [smartscapeNodes "K8S_DYNAKUBE", from:now()-24h
    | parse k8s.object, "JSON:o"
    | fieldsAdd dkMode = if(isNotNull(o[spec][oneAgent][cloudNativeFullStack]), "CLOUD_NATIVE_FULL_STACK",
      else: if(isNotNull(o[spec][oneAgent][applicationMonitoring]), "APPLICATION_MONITORING",
      else: if(isNotNull(o[spec][oneAgent][classicFullStack]), "CLASSIC_FULL_STACK",
      else: if(isNotNull(o[spec][oneAgent][hostMonitoring]), "HOST_MONITORING", else: "KUBERNETES_ONLY")))),
        autoInjection = coalesce(`tags:k8s.annotations`[`feature.dynatrace.com/automatic-injection`], "true") != "false" | fields dkKey = concat(k8s.cluster.uid, "/", name), nsDkMode = dkMode, nsAutoInjection = autoInjection], sourceField:dkKey, lookupField:dkKey, fields:{nsDkMode, nsAutoInjection} | fields nsKey, nsDk, nsDkMode, nsAutoInjection], sourceField:nsKey, lookupField:nsKey, fields:{nsDk, nsDkMode, nsAutoInjection}
| fieldsAdd oneAgent = coalesce(a[`oneagent.dynatrace.com/injected`] == "true", false),
    injectFailed = coalesce(a[`oneagent.dynatrace.com/injected`] == "false", false),
    reason = coalesce(a[`oneagent.dynatrace.com/reason`], a[`dynakube.dynatrace.com/reason`]),
    metadataOnly = coalesce(a[`oneagent.dynatrace.com/injected`] != "true", true)
      and coalesce(a[`dynakube.dynatrace.com/injected`] == "true" or a[`metadata-enrichment.dynatrace.com/injected`] == "true", false),
    podBlock = coalesce(a[`dynatrace.com/inject`] == "false" or a[`oneagent.dynatrace.com/inject`] == "false", false),
    optIn = coalesce(a[`oneagent.dynatrace.com/inject`] == "true", false),
    containerBlock = contains(toString(a), "\"container.inject.dynatrace.com/"),
    otelDynatrace = coalesce(a[`otlp-exporter-configuration.dynatrace.com/injected`] == "true", false),
    otelOperator = contains(k8s.object, "opentelemetry-auto-instrumentation"),
    otelSdk = contains(k8s.object, "OTEL_EXPORTER_OTLP_ENDPOINT"),
    system = matchesValue(k8s.namespace.name, "kube-*") or matchesValue(k8s.namespace.name, "openshift-*")
| fieldsAdd otel = otelDynatrace or otelOperator or otelSdk
| fieldsAdd injecting = coalesce(in("CLOUD_NATIVE_FULL_STACK", dkModes) or in("APPLICATION_MONITORING", dkModes), false),
    hostAgent = coalesce(in("CLOUD_NATIVE_FULL_STACK", dkModes) or in("CLASSIC_FULL_STACK", dkModes) or in("HOST_MONITORING", dkModes), false),
    classic = coalesce(in("CLASSIC_FULL_STACK", dkModes), false),
    dynatraceNs = coalesce(in(k8s.namespace.name, dkNamespaces), false)
| fieldsAdd mode = if(dynatraceNs, "DYNATRACE",
      else: if(isNotNull(nsDkMode), nsDkMode,
      else: if(classic, "CLASSIC_FULL_STACK",
      else: if(otel, "OTEL",
      else: if(isNull(dkModes), "NO_DYNAKUBE",
      else: if(injecting, "NOT_SELECTED",
      else: if(hostAgent, "HOST_MONITORING", else: "KUBERNETES_ONLY")))))))
| fieldsAdd status = if(mode == "DYNATRACE", "DYNATRACE",
      else: if(oneAgent and otel, "ONEAGENT_OTEL",
      else: if(oneAgent, "ONEAGENT",
      else: if(mode == "CLASSIC_FULL_STACK", "CLASSIC",
      else: if(otel, "OTEL",
      else: if(injectFailed, "FAILED",
      else: if(podBlock, "POD_BLOCK",
      else: if(mode == "NO_DYNAKUBE", "NO_DYNAKUBE",
      else: if(mode == "HOST_MONITORING" or mode == "KUBERNETES_ONLY", "NO_INJECTION",
      else: if(mode == "NOT_SELECTED", if(system, "SYSTEM", else: "NAMESPACE_BLOCK"),
      else: if(metadataOnly, "METADATA_ONLY",
      else: if(nsAutoInjection == false and not optIn, "OPT_IN_REQUIRED", else: "RESTART_REQUIRED"))))))))))))
| summarize n = count(), by:{mode, status}
```

**How it works:** the [pod pipeline](#pod-pipeline), then `summarize n = count(), by:{mode, status}`. **Output:**
`mode`, `status`, `n`: Pods donut, *Pods with OneAgent* gauge (counts per status), AI Assist pod statuses. **Open it
yourself:** on the Pods card and under the gauges.

### Q5 Containers by mode and status

- **Source:** `k8sContainerSummaryQuery` ([queries.ts](../ui/app/queries.ts#L324)). **Runs:** tab load, timeframe change.

```dql
smartscapeNodes "CONTAINER", from:now()-15m
| filter isNotNull(k8s.namespace.name)
| lookup [smartscapeNodes "K8S_POD", from:now()-15m
  | fieldsAdd a = `tags:k8s.annotations`, nsKey = concat(k8s.cluster.uid, "/", k8s.namespace.name)
  | lookup [smartscapeNodes "K8S_DYNAKUBE", from:now()-24h
      | parse k8s.object, "JSON:o"
      | fieldsAdd dkMode = if(isNotNull(o[spec][oneAgent][cloudNativeFullStack]), "CLOUD_NATIVE_FULL_STACK",
        else: if(isNotNull(o[spec][oneAgent][applicationMonitoring]), "APPLICATION_MONITORING",
        else: if(isNotNull(o[spec][oneAgent][classicFullStack]), "CLASSIC_FULL_STACK",
        else: if(isNotNull(o[spec][oneAgent][hostMonitoring]), "HOST_MONITORING", else: "KUBERNETES_ONLY")))),
          autoInjection = coalesce(`tags:k8s.annotations`[`feature.dynatrace.com/automatic-injection`], "true") != "false"
      | summarize dkModes = collectDistinct(dkMode), dkNamespaces = collectDistinct(k8s.namespace.name), by:{k8s.cluster.uid}
    ], sourceField:k8s.cluster.uid, lookupField:k8s.cluster.uid, fields:{dkModes, dkNamespaces}
  | lookup [smartscapeNodes "K8S_NAMESPACE", from:now()-24h
      | fieldsAdd nsKey = concat(k8s.cluster.uid, "/", k8s.namespace.name), nsDk = `tags:k8s.labels`[`dynakube.internal.dynatrace.com/instance`]
      | fieldsAdd dkKey = concat(k8s.cluster.uid, "/", nsDk)
      | lookup [smartscapeNodes "K8S_DYNAKUBE", from:now()-24h
      | parse k8s.object, "JSON:o"
      | fieldsAdd dkMode = if(isNotNull(o[spec][oneAgent][cloudNativeFullStack]), "CLOUD_NATIVE_FULL_STACK",
        else: if(isNotNull(o[spec][oneAgent][applicationMonitoring]), "APPLICATION_MONITORING",
        else: if(isNotNull(o[spec][oneAgent][classicFullStack]), "CLASSIC_FULL_STACK",
        else: if(isNotNull(o[spec][oneAgent][hostMonitoring]), "HOST_MONITORING", else: "KUBERNETES_ONLY")))),
          autoInjection = coalesce(`tags:k8s.annotations`[`feature.dynatrace.com/automatic-injection`], "true") != "false" | fields dkKey = concat(k8s.cluster.uid, "/", name), nsDkMode = dkMode, nsAutoInjection = autoInjection], sourceField:dkKey, lookupField:dkKey, fields:{nsDkMode, nsAutoInjection} | fields nsKey, nsDk, nsDkMode, nsAutoInjection], sourceField:nsKey, lookupField:nsKey, fields:{nsDk, nsDkMode, nsAutoInjection}
  | fieldsAdd oneAgent = coalesce(a[`oneagent.dynatrace.com/injected`] == "true", false),
      injectFailed = coalesce(a[`oneagent.dynatrace.com/injected`] == "false", false),
      reason = coalesce(a[`oneagent.dynatrace.com/reason`], a[`dynakube.dynatrace.com/reason`]),
      metadataOnly = coalesce(a[`oneagent.dynatrace.com/injected`] != "true", true)
        and coalesce(a[`dynakube.dynatrace.com/injected`] == "true" or a[`metadata-enrichment.dynatrace.com/injected`] == "true", false),
      podBlock = coalesce(a[`dynatrace.com/inject`] == "false" or a[`oneagent.dynatrace.com/inject`] == "false", false),
      optIn = coalesce(a[`oneagent.dynatrace.com/inject`] == "true", false),
      containerBlock = contains(toString(a), "\"container.inject.dynatrace.com/"),
      otelDynatrace = coalesce(a[`otlp-exporter-configuration.dynatrace.com/injected`] == "true", false),
      otelOperator = contains(k8s.object, "opentelemetry-auto-instrumentation"),
      otelSdk = contains(k8s.object, "OTEL_EXPORTER_OTLP_ENDPOINT"),
      system = matchesValue(k8s.namespace.name, "kube-*") or matchesValue(k8s.namespace.name, "openshift-*")
  | fieldsAdd otel = otelDynatrace or otelOperator or otelSdk
  | fieldsAdd injecting = coalesce(in("CLOUD_NATIVE_FULL_STACK", dkModes) or in("APPLICATION_MONITORING", dkModes), false),
      hostAgent = coalesce(in("CLOUD_NATIVE_FULL_STACK", dkModes) or in("CLASSIC_FULL_STACK", dkModes) or in("HOST_MONITORING", dkModes), false),
      classic = coalesce(in("CLASSIC_FULL_STACK", dkModes), false),
      dynatraceNs = coalesce(in(k8s.namespace.name, dkNamespaces), false)
  | fieldsAdd mode = if(dynatraceNs, "DYNATRACE",
        else: if(isNotNull(nsDkMode), nsDkMode,
        else: if(classic, "CLASSIC_FULL_STACK",
        else: if(otel, "OTEL",
        else: if(isNull(dkModes), "NO_DYNAKUBE",
        else: if(injecting, "NOT_SELECTED",
        else: if(hostAgent, "HOST_MONITORING", else: "KUBERNETES_ONLY")))))))
  | fieldsAdd status = if(mode == "DYNATRACE", "DYNATRACE",
        else: if(oneAgent and otel, "ONEAGENT_OTEL",
        else: if(oneAgent, "ONEAGENT",
        else: if(mode == "CLASSIC_FULL_STACK", "CLASSIC",
        else: if(otel, "OTEL",
        else: if(injectFailed, "FAILED",
        else: if(podBlock, "POD_BLOCK",
        else: if(mode == "NO_DYNAKUBE", "NO_DYNAKUBE",
        else: if(mode == "HOST_MONITORING" or mode == "KUBERNETES_ONLY", "NO_INJECTION",
        else: if(mode == "NOT_SELECTED", if(system, "SYSTEM", else: "NAMESPACE_BLOCK"),
        else: if(metadataOnly, "METADATA_ONLY",
        else: if(nsAutoInjection == false and not optIn, "OPT_IN_REQUIRED", else: "RESTART_REQUIRED"))))))))))))
  | fields k8s.pod.uid, podStatus = status, podMode = mode, ann = toString(a)], sourceField:k8s.pod.uid, lookupField:k8s.pod.uid, fields:{podStatus, podMode, ann}
| lookup [smartscapeNodes "K8S_DYNAKUBE", from:now()-24h
    | parse k8s.object, "JSON:o"
    | fieldsAdd dkMode = if(isNotNull(o[spec][oneAgent][cloudNativeFullStack]), "CLOUD_NATIVE_FULL_STACK",
      else: if(isNotNull(o[spec][oneAgent][applicationMonitoring]), "APPLICATION_MONITORING",
      else: if(isNotNull(o[spec][oneAgent][classicFullStack]), "CLASSIC_FULL_STACK",
      else: if(isNotNull(o[spec][oneAgent][hostMonitoring]), "HOST_MONITORING", else: "KUBERNETES_ONLY")))),
        autoInjection = coalesce(`tags:k8s.annotations`[`feature.dynatrace.com/automatic-injection`], "true") != "false"
    | summarize dkModes = collectDistinct(dkMode), dkNamespaces = collectDistinct(k8s.namespace.name), by:{k8s.cluster.uid}
  ], sourceField:k8s.cluster.uid, lookupField:k8s.cluster.uid, fields:{dkModes, dkNamespaces}
| fieldsAdd containerBlock = contains(ann, concat("\"container.inject.dynatrace.com/", k8s.container.name, "\":\"false\""))
| fieldsAdd status = if(containerBlock and in(podStatus, array("ONEAGENT", "ONEAGENT_OTEL", "RESTART_REQUIRED", "OPT_IN_REQUIRED", "METADATA_ONLY")), "CONTAINER_BLOCK",
      else: coalesce(podStatus, if(isNull(dkModes), "HOST_ONEAGENT", else: "NO_POD"))),
    mode = coalesce(podMode, if(isNull(dkModes), "NO_DYNAKUBE", else: "UNKNOWN"))
| summarize n = count(), by:{mode, status}
```

**How it works:** `CONTAINER` nodes seen in the last 15 minutes that have a namespace; a lookup on the pod pipeline by
`k8s.pod.uid` adds the pod's status, mode and annotations as text (`ann`); the per-cluster DynaKube lookup;
`containerBlock` searches `ann` for `"container.inject.dynatrace.com/<container name>":"false"`; `status` and `mode` as in
[Injection status of a container](#injection-status-of-a-container); `summarize n` per `{mode, status}`. **Output:**
`mode`, `status`, `n` (Containers donut). **Open it yourself:** on the Containers card.

### Q6 Workload search

- **Source:** `k8sSearchQuery(tf, { view: "workload", ... })` ([queries.ts](../ui/app/queries.ts#L451)).
- **Runs:** on *Search workloads*, or a slice click on the Workloads, Pods or Containers donut.
- **Parameters:** cluster UID, namespace text, workload text, mode, statuses (see [the search fields](#find-workloads-and-namespaces)).

With no filter:

```dql
smartscapeNodes "K8S_POD", from:now()-15m
| fieldsAdd a = `tags:k8s.annotations`, nsKey = concat(k8s.cluster.uid, "/", k8s.namespace.name)
| lookup [smartscapeNodes "K8S_DYNAKUBE", from:now()-24h
    | parse k8s.object, "JSON:o"
    | fieldsAdd dkMode = if(isNotNull(o[spec][oneAgent][cloudNativeFullStack]), "CLOUD_NATIVE_FULL_STACK",
      else: if(isNotNull(o[spec][oneAgent][applicationMonitoring]), "APPLICATION_MONITORING",
      else: if(isNotNull(o[spec][oneAgent][classicFullStack]), "CLASSIC_FULL_STACK",
      else: if(isNotNull(o[spec][oneAgent][hostMonitoring]), "HOST_MONITORING", else: "KUBERNETES_ONLY")))),
        autoInjection = coalesce(`tags:k8s.annotations`[`feature.dynatrace.com/automatic-injection`], "true") != "false"
    | summarize dkModes = collectDistinct(dkMode), dkNamespaces = collectDistinct(k8s.namespace.name), by:{k8s.cluster.uid}
  ], sourceField:k8s.cluster.uid, lookupField:k8s.cluster.uid, fields:{dkModes, dkNamespaces}
| lookup [smartscapeNodes "K8S_NAMESPACE", from:now()-24h
    | fieldsAdd nsKey = concat(k8s.cluster.uid, "/", k8s.namespace.name), nsDk = `tags:k8s.labels`[`dynakube.internal.dynatrace.com/instance`]
    | fieldsAdd dkKey = concat(k8s.cluster.uid, "/", nsDk)
    | lookup [smartscapeNodes "K8S_DYNAKUBE", from:now()-24h
    | parse k8s.object, "JSON:o"
    | fieldsAdd dkMode = if(isNotNull(o[spec][oneAgent][cloudNativeFullStack]), "CLOUD_NATIVE_FULL_STACK",
      else: if(isNotNull(o[spec][oneAgent][applicationMonitoring]), "APPLICATION_MONITORING",
      else: if(isNotNull(o[spec][oneAgent][classicFullStack]), "CLASSIC_FULL_STACK",
      else: if(isNotNull(o[spec][oneAgent][hostMonitoring]), "HOST_MONITORING", else: "KUBERNETES_ONLY")))),
        autoInjection = coalesce(`tags:k8s.annotations`[`feature.dynatrace.com/automatic-injection`], "true") != "false" | fields dkKey = concat(k8s.cluster.uid, "/", name), nsDkMode = dkMode, nsAutoInjection = autoInjection], sourceField:dkKey, lookupField:dkKey, fields:{nsDkMode, nsAutoInjection} | fields nsKey, nsDk, nsDkMode, nsAutoInjection], sourceField:nsKey, lookupField:nsKey, fields:{nsDk, nsDkMode, nsAutoInjection}
| fieldsAdd oneAgent = coalesce(a[`oneagent.dynatrace.com/injected`] == "true", false),
    injectFailed = coalesce(a[`oneagent.dynatrace.com/injected`] == "false", false),
    reason = coalesce(a[`oneagent.dynatrace.com/reason`], a[`dynakube.dynatrace.com/reason`]),
    metadataOnly = coalesce(a[`oneagent.dynatrace.com/injected`] != "true", true)
      and coalesce(a[`dynakube.dynatrace.com/injected`] == "true" or a[`metadata-enrichment.dynatrace.com/injected`] == "true", false),
    podBlock = coalesce(a[`dynatrace.com/inject`] == "false" or a[`oneagent.dynatrace.com/inject`] == "false", false),
    optIn = coalesce(a[`oneagent.dynatrace.com/inject`] == "true", false),
    containerBlock = contains(toString(a), "\"container.inject.dynatrace.com/"),
    otelDynatrace = coalesce(a[`otlp-exporter-configuration.dynatrace.com/injected`] == "true", false),
    otelOperator = contains(k8s.object, "opentelemetry-auto-instrumentation"),
    otelSdk = contains(k8s.object, "OTEL_EXPORTER_OTLP_ENDPOINT"),
    system = matchesValue(k8s.namespace.name, "kube-*") or matchesValue(k8s.namespace.name, "openshift-*")
| fieldsAdd otel = otelDynatrace or otelOperator or otelSdk
| fieldsAdd injecting = coalesce(in("CLOUD_NATIVE_FULL_STACK", dkModes) or in("APPLICATION_MONITORING", dkModes), false),
    hostAgent = coalesce(in("CLOUD_NATIVE_FULL_STACK", dkModes) or in("CLASSIC_FULL_STACK", dkModes) or in("HOST_MONITORING", dkModes), false),
    classic = coalesce(in("CLASSIC_FULL_STACK", dkModes), false),
    dynatraceNs = coalesce(in(k8s.namespace.name, dkNamespaces), false)
| fieldsAdd mode = if(dynatraceNs, "DYNATRACE",
      else: if(isNotNull(nsDkMode), nsDkMode,
      else: if(classic, "CLASSIC_FULL_STACK",
      else: if(otel, "OTEL",
      else: if(isNull(dkModes), "NO_DYNAKUBE",
      else: if(injecting, "NOT_SELECTED",
      else: if(hostAgent, "HOST_MONITORING", else: "KUBERNETES_ONLY")))))))
| fieldsAdd status = if(mode == "DYNATRACE", "DYNATRACE",
      else: if(oneAgent and otel, "ONEAGENT_OTEL",
      else: if(oneAgent, "ONEAGENT",
      else: if(mode == "CLASSIC_FULL_STACK", "CLASSIC",
      else: if(otel, "OTEL",
      else: if(injectFailed, "FAILED",
      else: if(podBlock, "POD_BLOCK",
      else: if(mode == "NO_DYNAKUBE", "NO_DYNAKUBE",
      else: if(mode == "HOST_MONITORING" or mode == "KUBERNETES_ONLY", "NO_INJECTION",
      else: if(mode == "NOT_SELECTED", if(system, "SYSTEM", else: "NAMESPACE_BLOCK"),
      else: if(metadataOnly, "METADATA_ONLY",
      else: if(nsAutoInjection == false and not optIn, "OPT_IN_REQUIRED", else: "RESTART_REQUIRED"))))))))))))
| filter isNotNull(k8s.workload.name)
| summarize pods = count(), oneAgentPods = countIf(oneAgent), otelPods = countIf(otel), blockedPods = countIf(podBlock), containerBlockPods = countIf(containerBlock),
    statuses = collectDistinct(status), modes = collectDistinct(mode),
    by:{k8s.cluster.name, k8s.cluster.uid, k8s.namespace.name, k8s.workload.kind, k8s.workload.name}
| fieldsAdd status = if(arraySize(statuses) == 1, statuses[0], else: "PARTIAL"), mode = if(arraySize(modes) == 1, modes[0], else: "MIXED")
| fieldsAdd wKey = concat(k8s.cluster.uid, "/", k8s.namespace.name, "/", k8s.workload.kind, "/", k8s.workload.name)
| lookup [smartscapeNodes "K8S_DEPLOYMENT", "K8S_STATEFULSET", "K8S_DAEMONSET", "K8S_JOB", "K8S_CRONJOB", "K8S_REPLICASET", "K8S_REPLICATIONCONTROLLER", "K8S_DEPLOYMENTCONFIG", from:now()-24h
    | fields wKey = concat(k8s.cluster.uid, "/", k8s.namespace.name, "/", lower(substring(type, from:4)), "/", name), nodeId = id, nodeType = type
  ], sourceField:wKey, lookupField:wKey, fields:{nodeId, nodeType}
| fields nodeId, nodeType, cluster = k8s.cluster.name, clusterUid = k8s.cluster.uid, namespace = k8s.namespace.name, kind = k8s.workload.kind, workload = k8s.workload.name,
    mode, status, statuses, pods, oneAgentPods, otelPods, blockedPods, containerBlockPods
| sort cluster asc, namespace asc, workload asc
| limit 500
```

With filters, the `| filter isNotNull(k8s.workload.name)` line (before the rollup) gets the scope clauses, and a second
filter follows the rollup. Example: cluster `00000000-0000-0000-0000-000000000001`, namespace contains `checkout`,
workload contains `cart`, mode Cloud-native full-stack, status *Roll out required*:

```dql
| filter k8s.cluster.uid == "00000000-0000-0000-0000-000000000001" and contains(k8s.namespace.name, "checkout", caseSensitive:false) and isNotNull(k8s.workload.name) and contains(k8s.workload.name, "cart", caseSensitive:false)
...
| fieldsAdd status = if(arraySize(statuses) == 1, statuses[0], else: "PARTIAL"), mode = if(arraySize(modes) == 1, modes[0], else: "MIXED")
| filter in("CLOUD_NATIVE_FULL_STACK", modes) and (in("RESTART_REQUIRED", statuses) or status == "PARTIAL")
```

Mode *Mixed* with status *Pod or container opt-out* adds
`| filter mode == "MIXED" and (in("POD_BLOCK", statuses) or (containerBlockPods > 0 and mode != "DYNATRACE"))`; status
*OneAgent* alone adds `| filter (in("ONEAGENT", statuses) or in("CLASSIC", statuses))`.

**How it works:** the [pod pipeline](#pod-pipeline) and pre-filter; the same rollup as Q3 plus `blockedPods` and
`containerBlockPods`; the post-filter; `wKey` joins the workload to its Smartscape node: workload nodes of the eight
types are keyed `<uid>/<namespace>/<lower-case type without "K8S_">/<name>`, which equals the pod's
`k8s.workload.kind` (for example `deployment`); `fields`, `sort cluster, namespace, workload`, `limit 500`.

**Output:** `nodeId`, `nodeType`, `cluster`, `clusterUid`, `namespace`, `kind`, `workload`, `mode`, `status`,
`statuses`, `pods`, `oneAgentPods` (pods with the webhook's `injected: "true"`), `otelPods`, `blockedPods`,
`containerBlockPods`. Used by the workload result columns and the Diagnose target. **Limits:** 500 rows. **Open it
yourself:** below the results.

### Q7 Namespace search

- **Source:** `k8sSearchQuery(tf, { view: "namespace", ... })`. **Runs:** *Search namespaces* or a Namespaces-donut click.

```dql
smartscapeNodes "K8S_NAMESPACE", from:now()-24h
    | fieldsAdd nsKey = concat(k8s.cluster.uid, "/", k8s.namespace.name), nsDk = `tags:k8s.labels`[`dynakube.internal.dynatrace.com/instance`]
    | fieldsAdd dkKey = concat(k8s.cluster.uid, "/", nsDk)
    | lookup [smartscapeNodes "K8S_DYNAKUBE", from:now()-24h
    | parse k8s.object, "JSON:o"
    | fieldsAdd dkMode = if(isNotNull(o[spec][oneAgent][cloudNativeFullStack]), "CLOUD_NATIVE_FULL_STACK",
      else: if(isNotNull(o[spec][oneAgent][applicationMonitoring]), "APPLICATION_MONITORING",
      else: if(isNotNull(o[spec][oneAgent][classicFullStack]), "CLASSIC_FULL_STACK",
      else: if(isNotNull(o[spec][oneAgent][hostMonitoring]), "HOST_MONITORING", else: "KUBERNETES_ONLY")))),
        autoInjection = coalesce(`tags:k8s.annotations`[`feature.dynatrace.com/automatic-injection`], "true") != "false" | fields dkKey = concat(k8s.cluster.uid, "/", name), nsDkMode = dkMode, nsAutoInjection = autoInjection], sourceField:dkKey, lookupField:dkKey, fields:{nsDkMode, nsAutoInjection}
| lookup [smartscapeNodes "K8S_DYNAKUBE", from:now()-24h
    | parse k8s.object, "JSON:o"
    | fieldsAdd dkMode = if(isNotNull(o[spec][oneAgent][cloudNativeFullStack]), "CLOUD_NATIVE_FULL_STACK",
      else: if(isNotNull(o[spec][oneAgent][applicationMonitoring]), "APPLICATION_MONITORING",
      else: if(isNotNull(o[spec][oneAgent][classicFullStack]), "CLASSIC_FULL_STACK",
      else: if(isNotNull(o[spec][oneAgent][hostMonitoring]), "HOST_MONITORING", else: "KUBERNETES_ONLY")))),
        autoInjection = coalesce(`tags:k8s.annotations`[`feature.dynatrace.com/automatic-injection`], "true") != "false"
    | summarize dkModes = collectDistinct(dkMode), dkNamespaces = collectDistinct(k8s.namespace.name), by:{k8s.cluster.uid}
  ], sourceField:k8s.cluster.uid, lookupField:k8s.cluster.uid, fields:{dkModes, dkNamespaces}
| lookup [smartscapeNodes "K8S_POD", from:now()-15m
  | fieldsAdd a = `tags:k8s.annotations`, nsKey = concat(k8s.cluster.uid, "/", k8s.namespace.name)
  | lookup [smartscapeNodes "K8S_DYNAKUBE", from:now()-24h
      | parse k8s.object, "JSON:o"
      | fieldsAdd dkMode = if(isNotNull(o[spec][oneAgent][cloudNativeFullStack]), "CLOUD_NATIVE_FULL_STACK",
        else: if(isNotNull(o[spec][oneAgent][applicationMonitoring]), "APPLICATION_MONITORING",
        else: if(isNotNull(o[spec][oneAgent][classicFullStack]), "CLASSIC_FULL_STACK",
        else: if(isNotNull(o[spec][oneAgent][hostMonitoring]), "HOST_MONITORING", else: "KUBERNETES_ONLY")))),
          autoInjection = coalesce(`tags:k8s.annotations`[`feature.dynatrace.com/automatic-injection`], "true") != "false"
      | summarize dkModes = collectDistinct(dkMode), dkNamespaces = collectDistinct(k8s.namespace.name), by:{k8s.cluster.uid}
    ], sourceField:k8s.cluster.uid, lookupField:k8s.cluster.uid, fields:{dkModes, dkNamespaces}
  | lookup [smartscapeNodes "K8S_NAMESPACE", from:now()-24h
      | fieldsAdd nsKey = concat(k8s.cluster.uid, "/", k8s.namespace.name), nsDk = `tags:k8s.labels`[`dynakube.internal.dynatrace.com/instance`]
      | fieldsAdd dkKey = concat(k8s.cluster.uid, "/", nsDk)
      | lookup [smartscapeNodes "K8S_DYNAKUBE", from:now()-24h
      | parse k8s.object, "JSON:o"
      | fieldsAdd dkMode = if(isNotNull(o[spec][oneAgent][cloudNativeFullStack]), "CLOUD_NATIVE_FULL_STACK",
        else: if(isNotNull(o[spec][oneAgent][applicationMonitoring]), "APPLICATION_MONITORING",
        else: if(isNotNull(o[spec][oneAgent][classicFullStack]), "CLASSIC_FULL_STACK",
        else: if(isNotNull(o[spec][oneAgent][hostMonitoring]), "HOST_MONITORING", else: "KUBERNETES_ONLY")))),
          autoInjection = coalesce(`tags:k8s.annotations`[`feature.dynatrace.com/automatic-injection`], "true") != "false" | fields dkKey = concat(k8s.cluster.uid, "/", name), nsDkMode = dkMode, nsAutoInjection = autoInjection], sourceField:dkKey, lookupField:dkKey, fields:{nsDkMode, nsAutoInjection} | fields nsKey, nsDk, nsDkMode, nsAutoInjection], sourceField:nsKey, lookupField:nsKey, fields:{nsDk, nsDkMode, nsAutoInjection}
  | fieldsAdd oneAgent = coalesce(a[`oneagent.dynatrace.com/injected`] == "true", false),
      injectFailed = coalesce(a[`oneagent.dynatrace.com/injected`] == "false", false),
      reason = coalesce(a[`oneagent.dynatrace.com/reason`], a[`dynakube.dynatrace.com/reason`]),
      metadataOnly = coalesce(a[`oneagent.dynatrace.com/injected`] != "true", true)
        and coalesce(a[`dynakube.dynatrace.com/injected`] == "true" or a[`metadata-enrichment.dynatrace.com/injected`] == "true", false),
      podBlock = coalesce(a[`dynatrace.com/inject`] == "false" or a[`oneagent.dynatrace.com/inject`] == "false", false),
      optIn = coalesce(a[`oneagent.dynatrace.com/inject`] == "true", false),
      containerBlock = contains(toString(a), "\"container.inject.dynatrace.com/"),
      otelDynatrace = coalesce(a[`otlp-exporter-configuration.dynatrace.com/injected`] == "true", false),
      otelOperator = contains(k8s.object, "opentelemetry-auto-instrumentation"),
      otelSdk = contains(k8s.object, "OTEL_EXPORTER_OTLP_ENDPOINT"),
      system = matchesValue(k8s.namespace.name, "kube-*") or matchesValue(k8s.namespace.name, "openshift-*")
  | fieldsAdd otel = otelDynatrace or otelOperator or otelSdk
  | fieldsAdd injecting = coalesce(in("CLOUD_NATIVE_FULL_STACK", dkModes) or in("APPLICATION_MONITORING", dkModes), false),
      hostAgent = coalesce(in("CLOUD_NATIVE_FULL_STACK", dkModes) or in("CLASSIC_FULL_STACK", dkModes) or in("HOST_MONITORING", dkModes), false),
      classic = coalesce(in("CLASSIC_FULL_STACK", dkModes), false),
      dynatraceNs = coalesce(in(k8s.namespace.name, dkNamespaces), false)
  | fieldsAdd mode = if(dynatraceNs, "DYNATRACE",
        else: if(isNotNull(nsDkMode), nsDkMode,
        else: if(classic, "CLASSIC_FULL_STACK",
        else: if(otel, "OTEL",
        else: if(isNull(dkModes), "NO_DYNAKUBE",
        else: if(injecting, "NOT_SELECTED",
        else: if(hostAgent, "HOST_MONITORING", else: "KUBERNETES_ONLY")))))))
  | fieldsAdd status = if(mode == "DYNATRACE", "DYNATRACE",
        else: if(oneAgent and otel, "ONEAGENT_OTEL",
        else: if(oneAgent, "ONEAGENT",
        else: if(mode == "CLASSIC_FULL_STACK", "CLASSIC",
        else: if(otel, "OTEL",
        else: if(injectFailed, "FAILED",
        else: if(podBlock, "POD_BLOCK",
        else: if(mode == "NO_DYNAKUBE", "NO_DYNAKUBE",
        else: if(mode == "HOST_MONITORING" or mode == "KUBERNETES_ONLY", "NO_INJECTION",
        else: if(mode == "NOT_SELECTED", if(system, "SYSTEM", else: "NAMESPACE_BLOCK"),
        else: if(metadataOnly, "METADATA_ONLY",
        else: if(nsAutoInjection == false and not optIn, "OPT_IN_REQUIRED", else: "RESTART_REQUIRED"))))))))))))
  | summarize pods = count(), oneAgentPods = countIf(oneAgent or status == "CLASSIC"), otelPods = countIf(otel), by:{nsKey}], sourceField:nsKey, lookupField:nsKey, fields:{pods, oneAgentPods, otelPods}
| fieldsAdd pods = coalesce(pods, 0), oneAgentPods = coalesce(oneAgentPods, 0), otelPods = coalesce(otelPods, 0)
| fieldsAdd injecting = coalesce(in("CLOUD_NATIVE_FULL_STACK", dkModes) or in("APPLICATION_MONITORING", dkModes), false),
    hostAgent = coalesce(in("CLOUD_NATIVE_FULL_STACK", dkModes) or in("CLASSIC_FULL_STACK", dkModes) or in("HOST_MONITORING", dkModes), false),
    classic = coalesce(in("CLASSIC_FULL_STACK", dkModes), false),
    dynatraceNs = coalesce(in(k8s.namespace.name, dkNamespaces), false)
| fieldsAdd mode = if(dynatraceNs, "DYNATRACE",
      else: if(isNotNull(nsDkMode), nsDkMode,
      else: if(classic, "CLASSIC_FULL_STACK",
      else: if(otelPods > 0, "OTEL",
      else: if(isNull(dkModes), "NO_DYNAKUBE",
      else: if(injecting, "NOT_SELECTED",
      else: if(hostAgent, "HOST_MONITORING", else: "KUBERNETES_ONLY")))))))
| fieldsAdd status = if(mode == "DYNATRACE", "DYNATRACE",
      else: if(pods == 0, "NO_PODS",
      else: if(oneAgentPods == 0 and (matchesValue(k8s.namespace.name, "kube-*") or matchesValue(k8s.namespace.name, "openshift-*")), "SYSTEM",
      else: if(oneAgentPods == pods, "ALL",
      else: if(oneAgentPods > 0, "PARTIAL",
      else: if(otelPods > 0, "OTEL", else: "NONE"))))))
| fields id, cluster = k8s.cluster.name, clusterUid = k8s.cluster.uid, namespace = k8s.namespace.name, dynakube = nsDk, mode, status, pods, oneAgentPods, otelPods
| sort cluster asc, namespace asc
| limit 500
```

With filters, one line is added after the coverage `fieldsAdd` (before `| fields`). Example (cluster, namespace
contains `checkout`, mode *Not selected by a DynaKube*, coverage *Some pods with OneAgent*):

```dql
| filter k8s.cluster.uid == "00000000-0000-0000-0000-000000000001" and contains(k8s.namespace.name, "checkout", caseSensitive:false) and mode == "NOT_SELECTED" and in(status, array("PARTIAL"))
```

**How it works:** the same base as [Q2](#q2-namespaces-by-mode-and-coverage), filtered instead of summarized; `fields`
with the namespace node `id` (for the overview link), `dynakube = nsDk`; `sort cluster, namespace`; `limit 500`.
**Output:** `id`, `cluster`, `clusterUid`, `namespace`, `dynakube`, `mode`, `status`, `pods`, `oneAgentPods`, `otelPods`.
**Open it yourself:** below the results.

### Q8 Pods of the diagnosed target

- **Source:** `k8sTargetPodsQuery` ([queries.ts](../ui/app/queries.ts#L490)). **Runs:** when *Diagnose* is clicked on a
  workload or namespace, and again on a timeframe change while selected.
- **Parameters:** cluster UID, namespace, and for workloads the kind and name. Example: `deployment/cart` in `checkout`:

```dql
smartscapeNodes "K8S_POD", from:now()-15m
| fieldsAdd a = `tags:k8s.annotations`, nsKey = concat(k8s.cluster.uid, "/", k8s.namespace.name)
| lookup [smartscapeNodes "K8S_DYNAKUBE", from:now()-24h
    | parse k8s.object, "JSON:o"
    | fieldsAdd dkMode = if(isNotNull(o[spec][oneAgent][cloudNativeFullStack]), "CLOUD_NATIVE_FULL_STACK",
      else: if(isNotNull(o[spec][oneAgent][applicationMonitoring]), "APPLICATION_MONITORING",
      else: if(isNotNull(o[spec][oneAgent][classicFullStack]), "CLASSIC_FULL_STACK",
      else: if(isNotNull(o[spec][oneAgent][hostMonitoring]), "HOST_MONITORING", else: "KUBERNETES_ONLY")))),
        autoInjection = coalesce(`tags:k8s.annotations`[`feature.dynatrace.com/automatic-injection`], "true") != "false"
    | summarize dkModes = collectDistinct(dkMode), dkNamespaces = collectDistinct(k8s.namespace.name), by:{k8s.cluster.uid}
  ], sourceField:k8s.cluster.uid, lookupField:k8s.cluster.uid, fields:{dkModes, dkNamespaces}
| lookup [smartscapeNodes "K8S_NAMESPACE", from:now()-24h
    | fieldsAdd nsKey = concat(k8s.cluster.uid, "/", k8s.namespace.name), nsDk = `tags:k8s.labels`[`dynakube.internal.dynatrace.com/instance`]
    | fieldsAdd dkKey = concat(k8s.cluster.uid, "/", nsDk)
    | lookup [smartscapeNodes "K8S_DYNAKUBE", from:now()-24h
    | parse k8s.object, "JSON:o"
    | fieldsAdd dkMode = if(isNotNull(o[spec][oneAgent][cloudNativeFullStack]), "CLOUD_NATIVE_FULL_STACK",
      else: if(isNotNull(o[spec][oneAgent][applicationMonitoring]), "APPLICATION_MONITORING",
      else: if(isNotNull(o[spec][oneAgent][classicFullStack]), "CLASSIC_FULL_STACK",
      else: if(isNotNull(o[spec][oneAgent][hostMonitoring]), "HOST_MONITORING", else: "KUBERNETES_ONLY")))),
        autoInjection = coalesce(`tags:k8s.annotations`[`feature.dynatrace.com/automatic-injection`], "true") != "false" | fields dkKey = concat(k8s.cluster.uid, "/", name), nsDkMode = dkMode, nsAutoInjection = autoInjection], sourceField:dkKey, lookupField:dkKey, fields:{nsDkMode, nsAutoInjection} | fields nsKey, nsDk, nsDkMode, nsAutoInjection], sourceField:nsKey, lookupField:nsKey, fields:{nsDk, nsDkMode, nsAutoInjection}
| fieldsAdd oneAgent = coalesce(a[`oneagent.dynatrace.com/injected`] == "true", false),
    injectFailed = coalesce(a[`oneagent.dynatrace.com/injected`] == "false", false),
    reason = coalesce(a[`oneagent.dynatrace.com/reason`], a[`dynakube.dynatrace.com/reason`]),
    metadataOnly = coalesce(a[`oneagent.dynatrace.com/injected`] != "true", true)
      and coalesce(a[`dynakube.dynatrace.com/injected`] == "true" or a[`metadata-enrichment.dynatrace.com/injected`] == "true", false),
    podBlock = coalesce(a[`dynatrace.com/inject`] == "false" or a[`oneagent.dynatrace.com/inject`] == "false", false),
    optIn = coalesce(a[`oneagent.dynatrace.com/inject`] == "true", false),
    containerBlock = contains(toString(a), "\"container.inject.dynatrace.com/"),
    otelDynatrace = coalesce(a[`otlp-exporter-configuration.dynatrace.com/injected`] == "true", false),
    otelOperator = contains(k8s.object, "opentelemetry-auto-instrumentation"),
    otelSdk = contains(k8s.object, "OTEL_EXPORTER_OTLP_ENDPOINT"),
    system = matchesValue(k8s.namespace.name, "kube-*") or matchesValue(k8s.namespace.name, "openshift-*")
| fieldsAdd otel = otelDynatrace or otelOperator or otelSdk
| fieldsAdd injecting = coalesce(in("CLOUD_NATIVE_FULL_STACK", dkModes) or in("APPLICATION_MONITORING", dkModes), false),
    hostAgent = coalesce(in("CLOUD_NATIVE_FULL_STACK", dkModes) or in("CLASSIC_FULL_STACK", dkModes) or in("HOST_MONITORING", dkModes), false),
    classic = coalesce(in("CLASSIC_FULL_STACK", dkModes), false),
    dynatraceNs = coalesce(in(k8s.namespace.name, dkNamespaces), false)
| fieldsAdd mode = if(dynatraceNs, "DYNATRACE",
      else: if(isNotNull(nsDkMode), nsDkMode,
      else: if(classic, "CLASSIC_FULL_STACK",
      else: if(otel, "OTEL",
      else: if(isNull(dkModes), "NO_DYNAKUBE",
      else: if(injecting, "NOT_SELECTED",
      else: if(hostAgent, "HOST_MONITORING", else: "KUBERNETES_ONLY")))))))
| fieldsAdd status = if(mode == "DYNATRACE", "DYNATRACE",
      else: if(oneAgent and otel, "ONEAGENT_OTEL",
      else: if(oneAgent, "ONEAGENT",
      else: if(mode == "CLASSIC_FULL_STACK", "CLASSIC",
      else: if(otel, "OTEL",
      else: if(injectFailed, "FAILED",
      else: if(podBlock, "POD_BLOCK",
      else: if(mode == "NO_DYNAKUBE", "NO_DYNAKUBE",
      else: if(mode == "HOST_MONITORING" or mode == "KUBERNETES_ONLY", "NO_INJECTION",
      else: if(mode == "NOT_SELECTED", if(system, "SYSTEM", else: "NAMESPACE_BLOCK"),
      else: if(metadataOnly, "METADATA_ONLY",
      else: if(nsAutoInjection == false and not optIn, "OPT_IN_REQUIRED", else: "RESTART_REQUIRED"))))))))))))
| filter k8s.cluster.uid == "00000000-0000-0000-0000-000000000001" and k8s.namespace.name == "checkout" and k8s.workload.kind == "deployment" and k8s.workload.name == "cart"
| fields id, name, podUid = k8s.pod.uid, workloadKind = k8s.workload.kind, workload = k8s.workload.name, nsDk, nsDkMode, nsAutoInjection, dkModes,
    mode, status, reason, oneAgent, otelDynatrace, otelOperator, otelSdk, podBlock, optIn, containerBlock, metadataOnly, system, annotations = toString(a),
    phase = k8s.pod.phase, start = lifetime[start], end = lifetime[end]
| sort end desc
| limit 200
```

For a namespace target the filter is `| filter k8s.cluster.uid == "<uid>" and k8s.namespace.name == "checkout"`.

**How it works:** the [pod pipeline](#pod-pipeline), filtered to the target, every evidence field plus the annotations
as JSON text, phase and lifetime; `sort end desc`, `limit 200`. **Output:** converted with `toPod`
([kubernetes.ts](../ui/app/kubernetes.ts#L291)); excluded containers and opt-out keys are parsed from `annotations`
on the client. **Open it yourself:** in the diagnosis ("Kubernetes: pods of `<target>`").

### Q9 Processes in those pods

- **Source:** `k8sTargetProcessesQuery` ([queries.ts](../ui/app/queries.ts#L504)), with the Deep Monitoring building
  blocks `pgiBase` and `detailTail`.
- **Runs:** after Q8, with the UIDs of the first 100 pods (`MAX_PROCESS_PODS`). Example with two pod UIDs:

```dql
fetch dt.entity.process_group_instance, from:now()-24h
| fieldsAdd pg = instance_of[dt.entity.process_group], host = belongs_to[dt.entity.host], technology = if(processType == "IIS" and (in("EXE_NAME:svchost.exe", metadata) or in("EXE_NAME:inetinfo.exe", metadata)), "IIS_SERVICE_HOST", else: coalesce(processType, "OTHER"))
| filter iAny(in(metadata[], array("KUBERNETES_POD_UID:11111111-1111-1111-1111-111111111111", "KUBERNETES_POD_UID:22222222-2222-2222-2222-222222222222")))
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

**How it works:** classic process group instances carry `KUBERNETES_POD_UID:<uid>` in their `metadata` array; one
`iAny(in(metadata[], array(...)))` matches any of the UIDs (an `or` chain of `in()` calls exceeds the expression limit
beyond about 80 pods). `technology` splits IIS service hosts out of `IIS`, else `processType` or `OTHER`. Lookups add the
process group name, the host (name, host group, monitoring mode, OneAgent version, OS), services detected by a code
module (`agentTechnologyType` other than `N/A`), up to three `dt.runtime.*` metric keys, and the Smartscape process ID.
`isDeep` = injecting OneAgent version, or a code-module service, or runtime metrics on a host that is not in
Infrastructure / Discovery mode. `sort name asc`, `limit 200`. See [deep-monitoring.md](deep-monitoring.md) for the
evidence model. **Output:** converted with `toInstance`; used for checks 10a and 10b and the process list.
**Open it yourself:** in the diagnosis ("Kubernetes: processes of `<target>`").

### Q10 Cloud clusters and their Kubernetes match

- **Source:** `k8sCloudClustersQuery` ([queries.ts](../ui/app/queries.ts#L393)). **Runs:** never by itself; it is the
  matching logic Q1 embeds, exposed for inspection in the diagnosis of a cloud cluster.

```dql
smartscapeNodes "AWS_EKS_CLUSTER", "AZURE_MICROSOFT_CONTAINERSERVICE_MANAGEDCLUSTERS", "GCP_CONTAINER_GOOGLEAPIS_COM_CLUSTER", from:now()-24h
| parse coalesce(aws.object, azure.object, gcp.object), "JSON:o"
| fieldsAdd provider = if(type == "AWS_EKS_CLUSTER", "EKS", else: if(type == "AZURE_MICROSOFT_CONTAINERSERVICE_MANAGEDCLUSTERS", "AKS", else: "GKE"))
| fieldsAdd cloudKey = if(provider == "EKS", concat("EKS/", aws.account.id, "/", aws.region, "/", name),
      else: if(provider == "AKS", concat("AKS/", lower(o[configuration][properties][nodeResourceGroup])), else: concat("GKE/", gcp.project.id, "/", name))),
    nameKey = concat(provider, "/", name)
| lookup [smartscapeNodes "K8S_NODE", from:now()-24h
    | parse k8s.object, "JSON:o"
    | fieldsAdd lbl = `tags:k8s.labels`, providerID = toString(o[spec][providerID])
    | fieldsAdd ng = lbl[`eks.amazonaws.com/nodegroup`], aksRg = lbl[`kubernetes.azure.com/cluster`], gkePool = lbl[`cloud.google.com/gke-nodepool`]
    | lookup [smartscapeNodes "AWS_EKS_NODEGROUP", from:now()-24h | parse aws.object, "JSON:g" | fields ng = name, eksKey = concat("EKS/", aws.account.id, "/", aws.region, "/", g[configuration][clusterName])], sourceField:ng, lookupField:ng, fields:{eksKey}
    | fieldsAdd poolAt = if(isNotNull(gkePool) and startsWith(name, "gke-"), indexOf(name, concat("-", gkePool, "-")))
    | fieldsAdd gkeKey = if(startsWith(providerID, "gce://") and poolAt > 4, concat("GKE/", splitString(substring(providerID, from:6), "/")[0], "/", substring(name, from:4, to:poolAt)))
    | fieldsAdd cloudKey = coalesce(eksKey, if(isNotNull(aksRg), concat("AKS/", lower(aksRg))), gkeKey)
    | filter isNotNull(cloudKey)
    | summarize k8sUid = takeAny(k8s.cluster.uid), by:{cloudKey}
  ], sourceField:cloudKey, lookupField:cloudKey, fields:{k8sUid}
| lookup [smartscapeNodes "K8S_CLUSTER", from:now()-24h | fields nameKey = concat(k8s.cluster.distribution, "/", k8s.cluster.name), byName = k8s.cluster.uid], sourceField:nameKey, lookupField:nameKey, fields:{byName}
| fields cloudId = id, cloudName = name, cloudProvider = provider, k8sUid = coalesce(k8sUid, byName),
    cloudAccount = coalesce(aws.account.id, azure.subscription, gcp.project.id), cloudLocation = coalesce(aws.region, azure.location, gcp.location),
    cloudResourceGroup = azure.resource.group,
    cloudVersion = coalesce(o[configuration][version], o[configuration][properties][kubernetesVersion], o[configuration][resource][currentMasterVersion]),
    cloudState = coalesce(aws.state, azure.provisioning_state, o[configuration][resource][status])
```

**How it works:** see [Cloud cluster matching](#cloud-cluster-matching). **Output:** one row per cloud cluster with
`k8sUid` (null = cloud-only). **Open it yourself:** cluster diagnosis of a cloud cluster.

### Client-side post-processing

#### Cluster list (`toClusters`)

[kubernetes.ts](../ui/app/kubernetes.ts#L217): Q1 rows are grouped by key = cluster UID, else cloud cluster ID, else
cluster name. Each cluster gets its name, the modes of its DynaKube rows (`NONE` rows add none), Kubernetes monitoring
and container count of its first row, the first cloud data found, and `cloudOnly` (no UID, has cloud data). Sorted by
name. This list is the denominator of the cluster gauges, the search's cluster options (only clusters with a UID and
Kubernetes monitoring) and the AI Assist input.

#### Donut slices

`toSlices` sums `n` per category in the fixed category order and drops empty ones; categories a record does not belong
to (for example a mode not in the list) are not drawn.

#### Diagnosis and actions

`diagnoseTarget` / `diagnoseCluster` build the checks ([Diagnosis checks](#diagnosis-checks)); `buildActions`
([KubernetesTab.tsx](../ui/app/tabs/KubernetesTab.tsx#L553)) maps each non-passing check with a fix to its action,
see [Remediation actions](#remediation-actions).

## API calls

This page makes no write calls.

| Method | Endpoint or SDK method | Scope | When |
| --- | --- | --- | --- |
| POST / GET | `/platform/storage/query/v1/query:execute`, `query:poll` (through `useDql` of `@dynatrace-sdk/react-hooks`) | per query, see [scopes](#app-scopes-used-by-this-page) | every DQL query above |
| POST | `/api/docs-freshness` (`functions.call("docs-freshness")`, `@dynatrace-sdk/app-utils`) | none | once per app page load, the first time a docs status line or fix renders (shared across tabs); again on *Retry* |
| (inside the function) GET | `https://docs.dynatrace.com/docs/sitemap.xml` | outbound allowlist | per docs-freshness call |
| intent | `sendIntent` to `dynatrace.notebooks` / `view-query` | none | *Open in Notebook* |
| intent | `sendIntent` to `dynatrace.dashboards` / `add-to-dashboard` | none | *Add to Dashboard* |
| link | `getIntentLink` to `dynatrace.kubernetes` (`view-entity-dt.smartscape.k8s_cluster`, `k8s_dynakube`, `k8s_namespace`, `k8s_deployment`, `k8s_statefulset`, `k8s_daemonset`, `k8s_job`, `k8s_cronjob`, `k8s_replicaset`) and `dynatrace.clouds` (`view_aws_service`, `view_azure_service`) | none | rendering the tables and diagnosis |
| link | `getIntentLink` to `dynatrace.settings` / `open_settings_for_schema` for `builtin:dt-javascript-runtime.allowed-outbound-connections` | none | docs check blocked |
| local | `getEnvironmentId()` (`@dynatrace-sdk/app-environment`) | none | builds the OTLP endpoint in *Instrument with OpenTelemetry* |

**docs-freshness request body (example):**

```json
{
  "urls": ["https://docs.dynatrace.com/docs/ingest-from/setup-on-k8s/reference/dynakube-parameters", "..."],
  "prefixes": ["https://docs.dynatrace.com/docs/observe/application-observability/services/service-detection/service-detection-v2"]
}
```

`urls` is every docs.dynatrace.com URL in `DOC` ([deepTech.ts](../ui/app/deepTech.ts)); the function handles at most
300 URLs and 10 prefixes. Response: `{ "status": "ok", "checkedAt", "pages": { "<url>": "<lastmod>" | null }, "sections": {...} }`
or `{ "status": "blocked" | "error", "message" }`. A page whose `lastmod` is later than the date in
[deepDocsSnapshot.json](../ui/app/deepDocsSnapshot.json), or that is missing (`null`), is marked on every fix citing it.
The status line under the section heading reads "Guidance reviewed against the Dynatrace docs on 2026-10-24." followed
by "Checking the docs for later changes…", "No cited page has changed since.", "`<n>` cited page(s) changed since; the
fixes that cite them are marked.", "Automatic docs check off: add docs.dynatrace.com to the allowed outbound
connections (setting ↗)." or "Docs check failed: `<message>`", the last two with a *Retry* link.

**Intent payloads:** query actions send `{ "dt.query": "<query>", "title": "<title>" }`. Entity links send
`{ "nodeId": "<Smartscape node ID>", "dt.timeframe": { "from": "<ISO>", "to": "<ISO>" } }` with the selected timeframe.

## Remediation actions

All actions are **manual**: commands to run yourself; nothing is validated or written by the app. Each action shows a
*Variant* dropdown (when it has more than one command block), the selected command with a *Copy* button, numbered steps,
collapsed *Notes*, and the **Documentation for this fix** links (with a "changed since" mark when the docs check found
a newer page).

**Which actions are offered.** Before a selection: the nine generic actions in this order: Switch the DynaKube to
cloud-native full-stack, Select the namespace for injection, Remove the pod opt-out annotation, Re-enable injection for
an excluded container, Roll out the workload, OpenTelemetry Collector / OTLP auto-configuration, Avoid double
instrumentation, Install the Dynatrace Operator, Troubleshoot the Operator and injection. After *Diagnose*
(`buildActions`): every check that is not OK and has a fix adds its action, rated by the most severe check it addresses
(Blocking, Check, Info); the dropdown groups them under **Blocking**, **Check**, **Info**, then **More steps** (the
remaining generic actions, with placeholders; *Install* only when the cluster has no DynaKube). The first, most severe
action is preselected. Commands are filled with the target's namespace and workload and with the DynaKube that selects
the namespace (else the cluster's first DynaKube); without a target they show `<namespace>`, `deployment/<workload>`,
`<dynakube>` and namespace `dynatrace`.

| Check fix | Action |
| --- | --- |
| install | Install the Dynatrace Operator |
| mode | Switch the DynaKube to cloud-native full-stack |
| health, failed | Troubleshoot the Operator and injection |
| namespace | Select the namespace for injection (namespace block) |
| pod-optout | Remove the pod opt-out annotation (pod block) |
| container-optout | Re-enable injection for an excluded container (container block) |
| opt-in | Opt pods in (automatic injection off) |
| rollout | Roll out the workload to inject OneAgent |
| otel-double | Avoid double instrumentation (OneAgent + OpenTelemetry) |
| otel-collector | OpenTelemetry: send through the Dynatrace Collector or OTLP auto-configuration |
| unsupported-tech | per technology: Instrument with OpenTelemetry / Trace Envoy with OpenTelemetry / Monitor `<X>` with its extension (from [deepActions.ts](../ui/app/deepActions.ts)) |

The examples below are filled for `deployment/cart` in namespace `checkout` of cluster `my-cluster`, DynaKube `dynakube`
in namespace `dynatrace`.

### Install the Dynatrace Operator

Offered for clusters without a DynaKube. Steps: (for cloud clusters) point kubectl at the cluster; install the Operator
with Helm into the `dynatrace` namespace; create the `dynakube` secret with an Operator token (`apiToken`) and a data
ingest token; apply a DynaKube with `spec.oneAgent.cloudNativeFullStack`, then roll out the workloads. Variants:

```bash
# Connect kubectl (EKS / AKS / GKE, only for cloud clusters, filled from the cloud cluster)
aws eks update-kubeconfig --name my-eks --region us-east-1
az aks get-credentials --resource-group my-rg --name my-aks --subscription 00000000-0000-0000-0000-00000000000a
gcloud container clusters get-credentials my-gke --location europe-west1 --project my-project

# Helm
helm install dynatrace-operator oci://public.ecr.aws/dynatrace/dynatrace-operator \
  --create-namespace --namespace dynatrace --atomic
# Helm 4: --rollback-on-failure instead of --atomic

# Tokens secret
kubectl -n dynatrace create secret generic dynakube \
  --from-literal="apiToken=<operator token>" \
  --from-literal="dataIngestToken=<data ingest token>"
```

```yaml
# DynaKube (cloud-native full-stack)
apiVersion: dynatrace.com/v1beta6
kind: DynaKube
metadata:
  name: dynakube
  namespace: dynatrace
spec:
  apiUrl: https://<environment-id>.live.dynatrace.com/api
  metadataEnrichment:
    enabled: true
  oneAgent:
    cloudNativeFullStack: {}
  activeGate:
    capabilities:
      - routing
      - kubernetes-monitoring
```

Notes: host-OneAgent-only clusters report containers but no Kubernetes objects; cloud integrations keep reporting the
cluster after the install and the tab matches the two; latest Operator in the docs 1.11.0 (`dynatrace.com/v1beta6`).
Docs: Install the Operator: full-stack observability, Kubernetes deployment options, DynaKube parameters.

### Switch the DynaKube to cloud-native full-stack

Offered for checks 4a-4c. Steps: edit the DynaKube and replace `spec.oneAgent.<applicationMonitoring | classicFullStack |
hostMonitoring>` with `cloudNativeFullStack` (keep a `namespaceSelector` if only some namespaces should be injected);
make sure the CSI driver is deployed (for classic: install it first, Helm `csidriver.enabled=true` or the
`kubernetes-csi.yaml` / `openshift-csi.yaml` manifest); apply and wait for the OneAgent pods; roll out all workloads.

```yaml
spec:
  oneAgent:
    cloudNativeFullStack:
      # optional: only namespaces with this label
      namespaceSelector:
        matchLabels:
          dt-monitoring: "true"
```

```bash
kubectl apply -f dynakube.yaml
kubectl get dynakube dynakube -n dynatrace   # wait for phase Running

kubectl rollout restart deployment -n <namespace>
kubectl rollout restart statefulset -n <namespace>
kubectl rollout restart daemonset -n <namespace>
```

Notes: classic to cloud-native changes host IDs, ignores container monitoring rules, CRI-O needs OneAgent 1.281+; no
documented migration guide from application monitoring; moving to classic or host monitoring needs a restart of every
instrumented pod. Docs: Kubernetes full-stack observability, Kubernetes migration guides, (classic only) Migrate classic
full-stack to cloud-native full-stack, Kubernetes application observability, DynaKube parameters.

### Select the namespace for injection (namespace block)

Offered for checks 5c and 5d. Steps: without a `namespaceSelector` every namespace except `kube-*`, `openshift-*` and
the Operator's own is injected; with one, label the namespace or widen the selector; exclude on purpose with
`matchExpressions` / `NotIn`; roll out the namespace's workloads.

```bash
kubectl label namespace checkout dt-monitoring=true --overwrite

# Check the selection
kubectl get namespaces -L dynakube.internal.dynatrace.com/instance
kubectl get dynakube dynakube -n dynatrace -o jsonpath='{.status.conditions[?(@.type=="OneAgentNamespacesMonitored")].message}'
```

```yaml
# namespaceSelector (matchLabels)
spec:
  oneAgent:
    cloudNativeFullStack:   # or applicationMonitoring
      namespaceSelector:
        matchLabels:
          dt-monitoring: "true"
# namespaceSelector (exclude)
spec:
  oneAgent:
    cloudNativeFullStack:
      namespaceSelector:
        matchExpressions:
          - key: kubernetes.io/metadata.name
            operator: NotIn
            values:
              - <excluded namespace>
```

Notes: selectors only affect webhook injection; `metadataEnrichment` and `otlpExporterConfiguration` have their own
selectors; on AKS namespaces labelled `kubernetes.azure.com/managedby: aks` are skipped. Docs: Configure monitoring for
namespaces and pods, DynaKube parameters, Kubernetes full-stack observability.

### Remove the pod opt-out annotation (pod block)

Offered for check 7a. Steps: find where the pod template sets the annotation (Helm values, kustomize, GitOps); check why
first (OpenTelemetry pods are often excluded on purpose); remove it from the template, then roll out.

```bash
kubectl get deployment/cart -n checkout -o jsonpath='{.spec.template.metadata.annotations}'
kubectl patch deployment/cart -n checkout --type=json -p='[{"op":"remove","path":"/spec/template/metadata/annotations/dynatrace.com~1inject"}]'
# or: .../annotations/oneagent.dynatrace.com~1inject
```

Notes: `dynatrace.com/inject: "false"` disables all injection (`"true"` has no effect); `oneagent.dynatrace.com/inject:
"false"` disables only OneAgent. Docs: Configure monitoring for namespaces and pods, DynaKube parameters.

### Re-enable injection for an excluded container (container block)

Offered for check 7b, filled with the first excluded container (example `istio-proxy`). Steps: remove
`container.inject.dynatrace.com/<container>: "false"` from the pod template or the DynaKube; keep it for sidecars; roll
out (pod level) or wait for new pods (DynaKube level).

```bash
kubectl annotate dynakube dynakube -n dynatrace container.inject.dynatrace.com/istio-proxy-
kubectl rollout restart deployment/cart -n checkout
```

Notes: needs Operator 1.0.0+; excludes the container from all injection. Docs: Configure monitoring for namespaces and
pods, DynaKube parameters.

### Opt pods in (automatic injection off)

Offered for check 6. Steps: the DynaKube sets `feature.dynatrace.com/automatic-injection: "false"`; add
`oneagent.dynatrace.com/inject: "true"` (and `metadata-enrichment.dynatrace.com/inject: "true"`) to the pod template, or
remove the flag; roll out.

```bash
kubectl annotate dynakube dynakube -n dynatrace feature.dynatrace.com/automatic-injection-
kubectl rollout restart deployment/cart -n checkout
```

Docs: DynaKube feature flags, Configure monitoring for namespaces and pods.

### Roll out the workload to inject OneAgent

Offered for check 9b. Steps: the webhook only mutates pods at creation; restart in a maintenance window; check the new
pods for `oneagent.dynatrace.com/injected: "true"`.

```bash
kubectl rollout restart deployment/cart -n checkout
kubectl rollout status deployment/cart -n checkout
kubectl rollout restart deployment,statefulset,daemonset -n checkout
kubectl get pods -n checkout -o custom-columns='POD:.metadata.name,INJECTED:.metadata.annotations.oneagent\.dynatrace\.com/injected'
```

Note: with `feature.dynatrace.com/injection-failure-policy: "fail"` a pod whose injection fails does not start. Docs:
Pod mutations, Configure monitoring for namespaces and pods, DynaKube feature flags.

### Troubleshoot the Operator and injection

Offered for checks 2 and 9a. Steps: run the Operator's troubleshoot command; check the DynaKube conditions and pod
annotations; skipped pods carry a reason (`NoBootstrapperConfig`, `NoMutationNeeded`, `OwnerLookupFailed`,
`MissingTenantUUID`, `DynaKubeStatusNotReady`).

```bash
kubectl exec deploy/dynatrace-operator -n dynatrace -- dynatrace-operator troubleshoot --dynakube dynakube
kubectl get dynakube -n dynatrace
kubectl describe dynakube dynakube -n dynatrace
kubectl get pod <pod> -n <namespace> -o jsonpath='{.metadata.annotations.oneagent\.dynatrace\.com/injected}{" "}{.metadata.annotations.oneagent\.dynatrace\.com/reason}{" "}{.metadata.annotations.dynakube\.dynatrace\.com/reason}{"\n"}'
kubectl exec deploy/dynatrace-operator -n dynatrace -- dynatrace-operator support-archive
```

Docs: Kubernetes troubleshooting, Kubernetes monitoring issues, Pod mutations.

### OpenTelemetry: send through the Dynatrace Collector or OTLP auto-configuration

Offered for check 8b. Steps: keep OpenTelemetry where it is the chosen instrumentation; `spec.telemetryIngest` deploys
the Dynatrace Collector (OTLP gRPC 4317 / HTTP 4318, Zipkin, Jaeger, StatsD); or `spec.otlpExporterConfiguration`
(Operator 1.8+) configures exporters in pods.

```yaml
spec:
  telemetryIngest:
    protocols:
      - otlp
  templates:
    otelCollector:
      imageRef:
        repository: public.ecr.aws/dynatrace/dynatrace-otel-collector
        tag: <version>
---
spec:
  otlpExporterConfiguration:
    signals:
      metrics: {}
      traces: {}
      logs: {}
    namespaceSelector:
      matchLabels:
        otel-export: "true"
```

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://dynakube-telemetry-ingest.dynatrace:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

Docs: Telemetry ingest endpoints, Automatic OTLP exporter configuration, OTLP API endpoints, OpenTelemetry.

### Avoid double instrumentation (OneAgent + OpenTelemetry)

Offered for check 8a. Steps: pick one tracer per workload; to keep OneAgent remove or set
`instrumentation.opentelemetry.io/inject-<language>` to `"false"` and turn off the SDK's trace exporter; to keep
OpenTelemetry add `oneagent.dynatrace.com/inject: "false"`; roll out (`kubectl rollout restart deployment/cart -n
checkout`). Docs: Use OneAgent with OpenTelemetry data, OpenTelemetry.

### Technology without a code module

Offered for check 10a, one action per technology (from `alternativeAction`, see [deep-monitoring.md](deep-monitoring.md)):
*Instrument with OpenTelemetry* (SDK or zero-code instrumentation, platform token with `openpipeline:traces:ingest`,
exporter `OTEL_EXPORTER_OTLP_ENDPOINT=https://<environment-id>.live.dynatrace.com/api/v2/otlp`,
`OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`, `OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <platform token>"`),
*Trace Envoy with OpenTelemetry*, or *Monitor `<database / HAProxy>` with its extension*.

## AI Assist on this page

`analyzeKubernetes` ([analyses.ts](../ui/app/analyses.ts#L145)) is rule-based, runs locally when the panel is open, and
uses the clusters list, the DynaKubes, the pod counts per status (Q4), the namespace counts (Q2) and the current
diagnosis (name and Blocking check titles). Severity: 90 % and above good, 50 % and above warning, else critical.

**No clusters:** "No Kubernetes clusters were found for this timeframe ..." with one info insight and the
recommendation to install the Operator with a cloud-native full-stack DynaKube.

**Summary:** "`<n>` Kubernetes clusters (`<c>` managed by a cloud provider), `<d>` DynaKubes; `<k>` clusters have none.
`<x>` of `<y>` application pods (`<p>`%) have OneAgent; system namespaces and Dynatrace's own pods are left out."
(pods with OneAgent / eligible pods as in the gauge).

**Insights:**

| Rule | Severity |
| --- | --- |
| `<p>`% of application pods are injected with OneAgent (always) | by `<p>` |
| Seen only through a cloud integration, no Operator: `<clusters>` | critical |
| No DynaKube: `<clusters>` (with "`<n>` running containers seen only by a host OneAgent" when applicable) | critical |
| `<x>` of `<y>` managed cloud clusters have the Operator | by the share |
| Not full-stack: `<DynaKube> (<mode>)` for every DynaKube that is not cloud-native or classic full-stack | warning |
| Classic full-stack is legacy: `<DynaKubes>` | warning |
| DynaKubes not healthy: phase set and not `Running`, or failing conditions | critical |
| Operator versions in use: (when more than one) | info |
| `<n>` pods have both OneAgent and OpenTelemetry | warning |
| `<n>` pods use OpenTelemetry instead of OneAgent | info |
| `<n>` pods could be injected but are not (`RESTART_REQUIRED` + `OPT_IN_REQUIRED`) | warning |
| `<n>` pods opt out with an annotation | warning |
| `<n>` pods in namespaces no OneAgent namespaceSelector matches (`NAMESPACE_BLOCK` + `METADATA_ONLY`) | warning |
| `<all>` of `<eligible>` application namespaces have OneAgent on every pod; `<partial>` only on some | by the share |
| Diagnosed target: its Blocking checks, or "nothing blocks full-stack monitoring" | critical / good |

**Recommendations:** install the Operator on clusters without one (high); switch application-monitoring,
host-monitoring and classic DynaKubes to cloud-native full-stack (high); run `dynatrace-operator troubleshoot` on
unhealthy DynaKubes (high); list *Roll out required* workloads from a donut and restart them (medium, when such pods
exist); Diagnose a blocked workload (medium, namespace or pod blocks); one tracer per workload (medium, double
instrumentation); pods and containers are counted as running now, re-check a few minutes after a rollout (low, always).

## Limitations and edge cases

- **Running now.** Pods, workloads and containers are only those seen in the last 15 minutes, whatever the timeframe.
  Namespaces that existed earlier in the timeframe but have no running pod count as *No pods*.
- **System namespaces in the pod gauge.** A pod gets status `SYSTEM` only when its cluster has an injecting DynaKube that
  does not select the namespace. In clusters without a DynaKube, with classic full-stack or with host monitoring only,
  `kube-*` / `openshift-*` pods count as `NO_DYNAKUBE`, `CLASSIC` or `NO_INJECTION` and are part of the *Pods with
  OneAgent* denominator. Namespaces are excluded by name regardless of mode.
- **Classic full-stack** pods are counted as OneAgent (`CLASSIC`) without evidence on the pod, including pods that carry
  an opt-out annotation (the classic rule is evaluated first).
- **Workload search vs donut.** The donut counts each workload once under its rolled-up status, but the search status
  filter matches workloads where *any* pod has one of the group's statuses, and the mode filter matches any pod's mode.
  A slice click can therefore list more workloads than the slice shows. Pod and container slices list workloads, not
  pods. Container-only categories (*Unknown* mode, *Host OneAgent, no Operator*, *Pod not found*) find no workloads.
- **Pod-level `containerBlock`** (search, `containerBlockPods`) is true for any `container.inject.dynatrace.com/` key,
  whatever its value; the Containers donut checks for `"false"` on the specific container. DynaKube-wide container
  exclusions are visible in the diagnosis only, not in the Containers donut.
- **Workload *OneAgent pods* column** counts webhook-injected pods only; classic full-stack workloads show 0 there, while
  the namespace view and the gauge count `CLASSIC` pods.
- **Partially injected** workloads (pods with different statuses, for example OneAgent plus a pod opt-out) are grouped
  under *Roll out required*.
- **Health.** The gauge needs `phase == "Running"`, so a DynaKube without a phase lowers it, while Diagnose and AI Assist
  only flag a non-empty phase other than `Running`.
- **Diagnosis inputs.** The namespace's DynaKube is taken from the pods' label, so a target without running pods is
  reported as "Namespace not selected". When the namespace's DynaKube has a mode other than application monitoring, the
  mode check reports "Cloud-native full-stack". The *health* fix targets the namespace's (or first) DynaKube, not
  necessarily the unhealthy one. Only 200 pods and the processes of 100 of them are read; Q9 returns at most 200 processes.
- **Cloud matching.** EKS node groups are looked up by name only; a lookup keeps the first match, so duplicate node group
  names or several cloud clusters with the same match can attach the wrong cloud data. Clusters whose nodes carry none of
  the labels and whose name differs from the cloud name stay cloud-only rows.
- **Timeframe.** 7 and 30 days also count DynaKubes, clusters and namespaces that have since been removed.
- **Search** returns at most 500 rows.

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| *Query failed* with a permission error | the user (or app) lacks Smartscape read | grant `storage:smartscape:read` in the user's policies |
| "Could not read the processes" in Diagnose | missing `storage:entities:read` or `storage:metrics:read` | grant them; the other checks are still valid |
| All donuts empty, clusters listed | no pod seen in the last 15 minutes (cluster disconnected, ActiveGate down) | check the cluster in the Kubernetes app; see [activegates.md](activegates.md) |
| No clusters at all | no Kubernetes monitoring, host OneAgent containers or cloud integration in the timeframe | widen the timeframe; install the Operator |
| A cluster with the Operator also appears as a cloud-only row | node labels / providerID do not match and names differ | check the node labels in the table above; the integration must also ingest EKS node groups |
| Slice click lists nothing | container-only category, or the workload has no `k8s.workload.name` | use the cluster row; bare pods only appear in the Pods donut |
| *DynaKubes healthy* below 100 % but no unhealthy DynaKube in Diagnose | DynaKube without `status.phase` | check `kubectl get dynakube` |
| "Automatic docs check off" | outbound allowlist enforced | add `docs.dynatrace.com` to `builtin:dt-javascript-runtime.allowed-outbound-connections`, then *Retry* |
| "Docs check failed ... HTTP 404" | the app function is not in the running app | restart `npx dt-app dev` or redeploy |
| *Open in Notebook* / *Add to Dashboard* does nothing | no access to the target app | grant access to Notebooks / Dashboards |
| Workload name not linked | ReplicationController / DeploymentConfig, or no Smartscape workload node | open the namespace instead |

## Related pages

- [Index](README.md)
- [Deep Monitoring](deep-monitoring.md): process-level code-module evidence and technology catalogue used by checks 10a / 10b
- [ActiveGates](activegates.md): the containerized ActiveGates a DynaKube deploys
- [OneAgents](oneagents.md), [Service Detection v2](service-detection-v2.md), [Ownership & Teams](ownership-and-teams.md) (Kubernetes labels as owners), [Entity Overview](entity-overview.md)

## Source files

| File | Role on this page |
| --- | --- |
| [ui/app/tabs/KubernetesTab.tsx](../ui/app/tabs/KubernetesTab.tsx) | tab layout, gauges, donuts, clusters table, search, diagnosis, action building |
| [ui/app/kubernetes.ts](../ui/app/kubernetes.ts) | categories and colours, row conversion, cluster list, diagnosis checks, manual actions |
| [ui/app/queries.ts](../ui/app/queries.ts) | Q1-Q10 (Kubernetes section) and the Deep Monitoring blocks used by Q9 |
| [ui/app/analyses.ts](../ui/app/analyses.ts) | `analyzeKubernetes` (AI Assist) |
| [ui/app/tabs/ModePie.tsx](../ui/app/tabs/ModePie.tsx) | `Donut` |
| [ui/app/components.tsx](../ui/app/components.tsx) | `PctGauge`, `pct`, `QueryActions`, `QueryState` |
| [ui/app/tabs/DeepMonitoringTab.tsx](../ui/app/tabs/DeepMonitoringTab.tsx) | `ActionPicker`, `DocsStatusLine`, `DocsRow`, status colours and labels |
| [ui/app/RemediationPanel.tsx](../ui/app/RemediationPanel.tsx) | `ManualActionView`, `Field` |
| [ui/app/deepMonitoring.ts](../ui/app/deepMonitoring.ts), [ui/app/deepTech.ts](../ui/app/deepTech.ts), [ui/app/deepActions.ts](../ui/app/deepActions.ts) | process conversion, technology catalogue and `DOC`, alternative actions |
| [ui/app/deepDocs.ts](../ui/app/deepDocs.ts), [api/docs-freshness.function.ts](../api/docs-freshness.function.ts) | docs freshness check |
| [ui/app/links.ts](../ui/app/links.ts) | entity overview intents |
| [ui/app/useDql.ts](../ui/app/useDql.ts) | DQL hook |
