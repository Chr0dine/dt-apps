# Data Overview

The Data Overview tab measures how much of the tenant's **data** (not its entities) carries the three primary Grail
fields used for access control and cost allocation: `dt.security_context`, `dt.cost.costcenter` and
`dt.cost.product`. It runs one DQL query per data type (metric series, log records, events and business events),
shows a gauge per field per data type, and averages them into an overall readiness score. Log queries are sampled and
the log, event and business event scans are capped at 5 GB each, so those numbers are estimates. The tab only reads
data; it has no remediation section.

| | |
| --- | --- |
| Area | Metadata (see [index](README.md)) |
| Tab id | `data` |
| Counts toward Entity Overview readiness / Top findings | No. The scores on this tab are not used by the Entity Overview tab, its Overall readiness or its Top 5 findings. |
| Main source files | [ui/app/tabs/Dimensional.tsx](../ui/app/tabs/Dimensional.tsx), [ui/app/queries.ts](../ui/app/queries.ts#L94) (`dimensionalQuery`), [ui/app/analyses.ts](../ui/app/analyses.ts#L426) (`analyzeDimensional`), [ui/app/components.tsx](../ui/app/components.tsx) |

## Contents

- [What this page answers](#what-this-page-answers)
- [Before you start](#before-you-start)
  - [App scopes used by this page](#app-scopes-used-by-this-page)
  - [User permissions](#user-permissions)
  - [One-time setup](#one-time-setup)
- [Page walkthrough](#page-walkthrough)
  - [Header controls and documentation link](#header-controls-and-documentation-link)
  - [AI Insights panel](#ai-insights-panel)
  - [Summary card: Overall readiness and one gauge per field](#summary-card-overall-readiness-and-one-gauge-per-field)
  - [Dimensional data section](#dimensional-data-section)
  - [Metrics card](#metrics-card)
  - [Logs card](#logs-card)
  - [Events card](#events-card)
  - [Business events card](#business-events-card)
  - [Loading, empty and error states](#loading-empty-and-error-states)
- [Checks and scoring](#checks-and-scoring)
  - [How each percentage is computed](#how-each-percentage-is-computed)
  - [Worked example](#worked-example)
- [Queries](#queries)
  - [Sampling and the 5 GB scan cap](#sampling-and-the-5-gb-scan-cap)
  - [Q1 Metric series coverage](#q1-metric-series-coverage)
  - [Q2 Log record coverage (sampled)](#q2-log-record-coverage-sampled)
  - [Q3 Event coverage](#q3-event-coverage)
  - [Q4 Business event coverage](#q4-business-event-coverage)
  - [Client-side processing of the results](#client-side-processing-of-the-results)
- [API calls](#api-calls)
- [Remediation actions](#remediation-actions)
- [AI Assist on this page](#ai-assist-on-this-page)
- [Limitations and edge cases](#limitations-and-edge-cases)
- [Troubleshooting](#troubleshooting)
- [Related pages](#related-pages)
- [Source files](#source-files)

## What this page answers

The entity tabs (Entity Overview, Security context, Cost allocation) count Smartscape **entities** that carry a
primary field. That says nothing about whether the **records** stored in Grail carry it: a host can have a security
context while the logs written by its processes do not, and a metric ingested through an API has no entity at all.
Grail permissions and cost allocation work on the record, so this tab checks the records.

It answers:

- **Can IAM policies scope this data by security context?** A Grail permission with a record-level condition such as
  `storage:dt.security_context` only matches records that carry the field. The share of metric series, logs, events
  and business events with `dt.security_context` tells you how much of each data type such a policy can reach. See
  [Permissions in Grail](https://docs.dynatrace.com/docs/platform/grail/organize-data/assign-permissions-in-grail) and
  [Grant access to entities with security context](https://docs.dynatrace.com/docs/manage/identity-access-management/use-cases/access-security-context).
- **Can usage be attributed to a cost center and product?** `dt.cost.costcenter` and `dt.cost.product` on the record
  are what cost allocation uses. The share of records that carry them tells you how much of each data type can be
  attributed.
- **Which data type and which field is the weakest?** The cards and the AI Assist panel point at the gap (for example
  cost product on logs).

Best practice checked: every record carries the primary Grail fields, set at the source (OneAgent host properties,
Kubernetes labels and annotations) or centrally at ingest (ingest enrichment rules, OpenPipeline processing). The tab
text says: "Fixing these is done in ingest (OpenPipeline or enrichment), not per entity." Background:
[Primary Grail fields and tags](https://docs.dynatrace.com/docs/manage/tags/primary-tags),
[OneAgent primary tags](https://docs.dynatrace.com/docs/manage/tags/primary-tags/tags-domain-oneagent),
[Kubernetes primary tags](https://docs.dynatrace.com/docs/manage/tags/primary-tags/tags-domain-k8s),
[Ingest enrichment rules](https://docs.dynatrace.com/docs/manage/tags/tags-central-enrichment).

## Before you start

### App scopes used by this page

From [app.config.json](../app.config.json) and the queries this tab runs. No other scope is used.

| Scope | What this page uses it for |
| --- | --- |
| `storage:metrics:read` | Q1: list metric series and their dimensions with the `metrics` command. |
| `storage:logs:read` | Q2: read log records (sampled). |
| `storage:events:read` | Q3: read the `events` table. |
| `storage:bizevents:read` | Q4: read the `bizevents` table. |
| `storage:buckets:read` | Read the Grail buckets that hold the logs, events and business events (app.config.json comment: "read Grail buckets backing logs, events and business events (Dimensional data)"). Grail checks bucket access in addition to table access. |

*Open in Notebook* and *Add to Dashboard* use intents and need no app scope.

### User permissions

The queries run as the signed-in user, so the result is limited by both the app scopes and the user's own IAM
permissions:

- The user needs `storage:metrics:read`, `storage:logs:read`, `storage:events:read`, `storage:bizevents:read` and
  `storage:buckets:read` for the buckets that hold this data. A missing permission fails that card's query (see
  [Troubleshooting](#troubleshooting)); the other cards still load.
- If the user's permissions are limited to some buckets or by a record-level condition (for example
  `storage:dt.security_context = "team-a"`), every count on this page covers only the records the user may read. A
  user whose access is limited by security context only sees records that carry one, so the *Security context*
  gauges read 100 % for that user. Run the tab with a user that has unrestricted read access to get tenant-wide
  numbers.
- *Open in Notebook* and *Add to Dashboard* need access to the Notebooks and Dashboards apps.

### One-time setup

None. This page uses no credential vault entry, outbound connection or OAuth client.

## Page walkthrough

The tab renders, top to bottom: the documentation link, the AI Insights panel (only when AI Assist is on), the
summary card, and the *Dimensional data* section with one card per data type
([`DataOverviewTab`](../ui/app/tabs/Dimensional.tsx#L104)).

### Header controls and documentation link

These belong to the app shell ([App.tsx](../ui/app/App.tsx)) and are described in the [index](README.md#the-app-shell);
what matters here:

- **Timeframe select** (*Last 24 hours* default, *Last 7 days*, *Last 30 days*): changes `from:now()-<tf>` in all
  four queries and, for logs, the sampling ratio (see [Q2](#q2-log-record-coverage-sampled)). The header note about
  longer timeframes counting decommissioned entities is about entity tabs; on this tab a longer timeframe means more
  series and records in the window.
- **AI Assist** button: shows or hides the [AI Insights panel](#ai-insights-panel).
- **Data Overview documentation** link (top right of the tab, [`TabDocsLink`](../ui/app/areas.tsx#L86)): opens this page
  on GitHub (`TAB_DOCS.data = "data-overview.md"`).

### AI Insights panel

Shown at the top of the tab while the header's **AI Assist** button is on. Header *AI Insights* with a close (✕)
button that turns AI Assist off. Three sections: **Summary**, **Insights** (coloured rows: green good, orange warning,
red critical, blue info) and **Recommendations** (with an impact badge). Text appears word by word. Content and rules:
[AI Assist on this page](#ai-assist-on-this-page).

### Summary card: Overall readiness and one gauge per field

Source: [`DimensionalSummary`](../ui/app/tabs/Dimensional.tsx#L87).

A card with four gauges in a row (wrapping on narrow screens):

| Gauge | Size | Value | Detail line |
| --- | --- | --- | --- |
| **Overall readiness** | 238 px | Mean of every per-field percentage of every data type that returned data (3 per data type), rounded to an integer. | `<n> checks`, where n = 3 × number of data types with data (3, 6, 9 or 12). |
| **Security context** | 188 px | Mean of the *Security context* percentage across the data types with data, rounded. | `avg of <n> data types` (`type` when n = 1). |
| **Cost center** | 188 px | Same for *Cost center*. | Same. |
| **Cost product** | 188 px | Same for *Cost product*. | Same. |

"A data type with data" means its query returned `total > 0`. Data types that are still loading, failed, or returned
nothing are left out of every mean. When no data type has data, the card is not rendered at all, so it is missing
while the first query is still running and appears (and changes) as each query completes.

The means are unweighted: a data type with 40 sampled log records counts as much as one with 80,000 metric series.
Each input is already a rounded integer percentage.

Gauges ([`PctGauge`](../ui/app/components.tsx#L69)): a 240-degree arc open at the bottom, filled clockwise from the
lower left; the fill is a gradient along the arc from red (0 %) through orange and yellow to green (100 %); the number
in the middle is the integer percentage. There is no threshold line and no pass / fail colour: the colour at the tip
follows the value continuously. The gauges on this tab have no (i) button and no click or hover action (the SVG has an
`aria-label` such as `Security context: 83% (avg of 3 data types)` for screen readers).

### Dimensional data section

Source: [`DimensionalSection`](../ui/app/tabs/Dimensional.tsx#L50).

Heading **Dimensional data**, then the line "Share of metric series, log records and events that carry the primary
tags we look for. Fixing these is done in ingest (OpenPipeline or enrichment), not per entity." Then four cards in a
fixed order: Metrics, Logs, Events, Business events (`DIMENSIONAL_KINDS` in
[queries.ts](../ui/app/queries.ts#L96)).

Every card has the same layout:

1. Title (`DIMENSIONAL_INFO[kind].title`) and a small note (`DIMENSIONAL_INFO[kind].note`).
2. The result, through [`QueryState`](../ui/app/components.tsx#L162): an error box, *Loading…*, a "No ... found"
   line, or three gauges (188 px): **Security context**, **Cost center**, **Cost product**. Each gauge's detail line
   is `<part> of <total> <unit>`, with numbers formatted for the browser locale (for example
   `52,000 of 84,210 series`).
3. The query actions ([`QueryActions`](../ui/app/components.tsx#L200)): **Show DQL** / **Hide DQL**, **Copy**,
   **↗ Open in Notebook**, **↗ Add to Dashboard**, for exactly the query that card ran (current timeframe). They are
   shown in every state, including loading and error, so a failing query can be opened and investigated in a
   notebook. The intent title is `<title> primary tag coverage`.

### Metrics card

| | |
| --- | --- |
| Title | Metrics |
| Note | "Metric series (key + dimensions); the first 100,000 series are evaluated." |
| Unit in detail lines | series |
| Query | [Q1](#q1-metric-series-coverage) |
| Intent title | `Metrics primary tag coverage` |
| Empty text | "No metrics found in this timeframe." |

A *series* is one metric key with one combination of dimension values. A gauge shows the share of series whose
dimensions include the field. High-cardinality metrics (many dimension combinations) weigh more than metrics with few
series.

### Logs card

| | |
| --- | --- |
| Title | Logs |
| Note | "Sampled estimate; the sampling ratio grows with the selected timeframe." |
| Unit in detail lines | records |
| Query | [Q2](#q2-log-record-coverage-sampled) |
| Intent title | `Logs primary tag coverage` |
| Empty text | "No logs found in this timeframe." |

The detail line counts **sampled** records (about 1 in 10,000 for 24 hours, 1 in 100,000 for 7 and 30 days), not the
log volume. The percentage is a ratio within the sample, so it estimates the share in the full data.

### Events card

| | |
| --- | --- |
| Title | Events |
| Note | "Events do not support sampling, so the scan is capped at 5 GB." |
| Unit in detail lines | events |
| Query | [Q3](#q3-event-coverage) |
| Intent title | `Events primary tag coverage` |
| Empty text | "No events found in this timeframe." |

### Business events card

| | |
| --- | --- |
| Title | Business events |
| Note | "Business events do not support sampling, so the scan is capped at 5 GB." |
| Unit in detail lines | events |
| Query | [Q4](#q4-business-event-coverage) |
| Intent title | `Business events primary tag coverage` |
| Empty text | "No business events found in this timeframe." |

### Loading, empty and error states

Per card ([`QueryState`](../ui/app/components.tsx#L162)):

| State | What the card shows | Effect on the summary card and AI Assist |
| --- | --- | --- |
| Query running, no result yet | *Loading…* | Data type left out (its total is 0). |
| Query failed | A critical message box *Query failed* with the error text from Grail (for example a missing permission). | Data type left out. |
| Query succeeded, `total` = 0 | "No `<title in lower case>` found in this timeframe." | Data type left out. |
| Query succeeded, `total` > 0 | Three gauges. | Included. |

The four queries run in parallel and the cards fill in independently. If all four are empty, failed or still
loading, the summary card is hidden and the AI panel reports that there is nothing to score.

## Checks and scoring

There are 12 base checks (4 data types × 3 fields) and 4 derived scores. Nothing on this tab has a Blocking / Check /
Info status; the gauge colour is continuous. Severities exist only in the [AI Assist](#ai-assist-on-this-page) rules.

| Check | In place when | Numerator | Denominator | Severity / thresholds | Notes |
| --- | --- | --- | --- | --- | --- |
| Metrics: Security context | The series has a `dt.security_context` dimension | `security = countIf(isNotNull(dt.security_context))` from Q1 | `total = count()` from Q1 (series in the timeframe) | None on the gauge | First 100,000 series (card note). |
| Metrics: Cost center | The series has a `dt.cost.costcenter` dimension | `costcenter` from Q1 | `total` from Q1 | None | |
| Metrics: Cost product | The series has a `dt.cost.product` dimension | `product` from Q1 | `total` from Q1 | None | |
| Logs: Security context | The log record has `dt.security_context` | `security` from Q2 | `total` from Q2 | None | Sampled; both counts are sample counts. |
| Logs: Cost center | The record has `dt.cost.costcenter` | `costcenter` from Q2 | `total` from Q2 | None | Sampled. |
| Logs: Cost product | The record has `dt.cost.product` | `product` from Q2 | `total` from Q2 | None | Sampled. |
| Events: Security context | The event has `dt.security_context` | `security` from Q3 | `total` from Q3 | None | At most 5 GB scanned. |
| Events: Cost center | The event has `dt.cost.costcenter` | `costcenter` from Q3 | `total` from Q3 | None | At most 5 GB scanned. |
| Events: Cost product | The event has `dt.cost.product` | `product` from Q3 | `total` from Q3 | None | At most 5 GB scanned. |
| Business events: Security context | The business event has `dt.security_context` | `security` from Q4 | `total` from Q4 | None | At most 5 GB scanned. |
| Business events: Cost center | The business event has `dt.cost.costcenter` | `costcenter` from Q4 | `total` from Q4 | None | At most 5 GB scanned. |
| Business events: Cost product | The business event has `dt.cost.product` | `product` from Q4 | `total` from Q4 | None | At most 5 GB scanned. |
| **Security context** (summary) | — | Sum of the *Security context* percentages of the data types with `total > 0` | Number of those data types | None | `Math.round` of the mean. |
| **Cost center** (summary) | — | Sum of the *Cost center* percentages, same data types | Same | None | |
| **Cost product** (summary) | — | Sum of the *Cost product* percentages, same data types | Same | None | |
| **Overall readiness** (summary) | — | Sum of all 3 × n percentages of the data types with `total > 0` | 3 × n | None | Equals the average in the AI summary. |

"In place" is `isNotNull(<field>)`: a field that exists with an empty value counts as present (see
[Limitations](#limitations-and-edge-cases)).

### How each percentage is computed

For each card, from the single result record of its query
([`useDimensional`](../ui/app/tabs/Dimensional.tsx#L33), [`num` and `pct`](../ui/app/components.tsx#L14)):

```text
total = num(record.total)                         // Number(value), 0 if missing or not a number
part  = num(record.security | costcenter | product)
pct   = total > 0 ? Math.round(part / total * 100) : 0
```

`Math.round` rounds halves up (12.5 becomes 13). For the summary card
([`DimensionalSummary`](../ui/app/tabs/Dimensional.tsx#L87)):

```text
withData            = data types with total > 0
field gauge (each)  = Math.round( sum of that field's pct over withData / count(withData) )
Overall readiness   = Math.round( sum of all pct over withData / (3 * count(withData)) )
```

### Worked example

Results for one run (24 hours), with the events query returning no records:

| Data type | total | security | costcenter | product | Security context | Cost center | Cost product |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Metrics | 84,210 | 52,210 | 33,684 | 33,684 | 62 % | 40 % | 40 % |
| Logs (sampled) | 1,200 | 1,056 | 0 | 0 | 88 % | 0 % | 0 % |
| Events | 0 | 0 | 0 | 0 | not shown | not shown | not shown |
| Business events | 300 | 300 | 36 | 36 | 100 % | 12 % | 12 % |

Summary card: Security context `round((62 + 88 + 100) / 3) = round(83.3) = 83 %` (avg of 3 data types); Cost center
`round((40 + 0 + 12) / 3) = 17 %`; Cost product `17 %`; Overall readiness
`round((62 + 40 + 40 + 88 + 0 + 0 + 100 + 12 + 12) / 9) = round(39.3) = 39 %` (9 checks). The Events card shows "No
events found in this timeframe."

## Queries

All four queries come from one builder, [`dimensionalQuery(tf, kind)`](../ui/app/queries.ts#L108), and are run with
`useDql` ([ui/app/useDql.ts](../ui/app/useDql.ts)) in four fixed hooks in
[`useDimensional`](../ui/app/tabs/Dimensional.tsx#L33).

| # | Name (function in source) | Runs when | Feeds |
| --- | --- | --- | --- |
| Q1 | Metric series coverage (`dimensionalQuery(tf, "metrics")`) | Tab opened; timeframe changed | Metrics card, summary card, AI Assist |
| Q2 | Log record coverage, sampled (`dimensionalQuery(tf, "logs")`) | Tab opened; timeframe changed | Logs card, summary card, AI Assist |
| Q3 | Event coverage (`dimensionalQuery(tf, "events")`) | Tab opened; timeframe changed | Events card, summary card, AI Assist |
| Q4 | Business event coverage (`dimensionalQuery(tf, "bizevents")`) | Tab opened; timeframe changed | Business events card, summary card, AI Assist |

When they run, in detail:

- The tab's content is only mounted while the tab is selected (Strato `Tabs` render the selected tab only), so the
  four queries start when you open **Metadata › Data Overview**, in parallel. They are not part of the queries that
  run at app start.
- Changing the timeframe changes the query text, which starts new queries.
- `@dynatrace-sdk/react-hooks` keeps results in an in-memory cache keyed by the query text (`refetchOnMount: false`,
  `staleTime` 60 s, no automatic retry). Reopening the tab, or switching back to a timeframe you already loaded,
  shortly afterwards can show the earlier result without running the query again. Reload the browser page to force
  new runs.

All four share the same `summarize` block:

```dql
| summarize total = count(),
    security = countIf(isNotNull(dt.security_context)),
    costcenter = countIf(isNotNull(dt.cost.costcenter)),
    product = countIf(isNotNull(dt.cost.product))
```

- `summarize` with no `by:` collapses all input records into one result record.
- `total = count()` counts every input record (series, log record, event).
- `countIf(condition)` counts the records for which the condition is true. `isNotNull(field)` is true when the field
  exists on the record with a non-null value. A record that never had the field (the usual case for a missing
  primary field) has it as null.
- The output is one record with four long values: `total`, `security`, `costcenter`, `product`.

The entity tabs check the security context with `arraySize(dt.security_context) > 0` because on Smartscape nodes it
is an array; these queries use `isNotNull` for all three fields.

### Sampling and the 5 GB scan cap

Constants in [queries.ts](../ui/app/queries.ts#L103):

```ts
export const SCAN_CAP_GB = 5;
// Only logs support sampling (events/bizevents ignored the ratio when validated against the tenant).
const LOG_SAMPLING: Record<Timeframe, number> = { "24h": 10000, "7d": 100000, "30d": 100000 };
```

**Why sample at all.** Counting every log record, event and business event of a tenant for 30 days can scan a very
large amount of data, which is slow and is paid for as query consumption. A percentage does not need every record: a
representative subset gives the same ratio within a small error.

**Logs: sampling ratio per timeframe.** `fetch logs` takes `samplingRatio:<N>`; Grail then reads roughly one record
in N. The app uses:

| Timeframe | `samplingRatio` | Records read (approx.) |
| --- | ---: | --- |
| Last 24 hours | 10000 | 1 in 10,000 |
| Last 7 days | 100000 | 1 in 100,000 |
| Last 30 days | 100000 | 1 in 100,000 |

The ratio grows with the window so that a longer window does not read proportionally more data. 100000 is the
highest ratio DQL offers (only for logs and spans), so 30 days uses the same ratio as 7 days and reads roughly four
times as much as the 7-day query. The counts in the Logs card are counts **in the sample**; the app does not
extrapolate them (it does not use `dt.system.sampling_ratio`). The percentages need no extrapolation because
numerator and denominator come from the same sample. The fewer records the sample holds, the coarser the
percentage: with 20 sampled records each record moves the gauge by 5 points.

**Events and business events: no sampling, a scan cap instead.** The code comment records that `events` and
`bizevents` ignored `samplingRatio` when the queries were validated against the tenant, so the app does not pass one.
To keep the cost bounded it adds `scanLimitGBytes:5` instead: Grail stops reading after 5 GB and computes the result
from what it read. The log query has the same cap on top of its sampling.

What the cap means for the numbers:

- If a table holds less than 5 GB in the window, the cap has no effect and the result covers all records.
- If the cap is reached, the result covers only the data read before the scan stopped. That is not a random sample:
  it can over-represent part of the timeframe or some buckets. Long timeframes on busy tenants are the most likely to
  hit the cap.
- The app does not show whether the cap was reached: `useDql` in this app keeps only the result records, not Grail's
  notifications. Use **↗ Open in Notebook** to run the query where the notebook shows the query's notifications and
  scanned data.
- Each run of Q2, Q3 and Q4 scans at most 5 GB, so one load of the tab scans at most about 15 GB across the three
  tables (Q1 reads series metadata, see below).

**Metrics.** The `metrics` command has neither a sampling nor a scan-limit parameter, so Q1 has neither. Its card note
says the first 100,000 series are evaluated; that limit is not in the query text.

### Q1 Metric series coverage

- **Source:** `dimensionalQuery(tf, "metrics")` in [ui/app/queries.ts](../ui/app/queries.ts#L108), called in
  [`useDimensional`](../ui/app/tabs/Dimensional.tsx#L34).
- **Runs:** when the tab opens; again when the timeframe changes (subject to the cache described above).
- **Parameters:** `tf` only. `from:now()-24h` becomes `from:now()-7d` or `from:now()-30d`. Nothing else changes.
- **Query** (24 hours):

```dql
metrics from:now()-24h
| summarize total = count(),
    security = countIf(isNotNull(dt.security_context)),
    costcenter = countIf(isNotNull(dt.cost.costcenter)),
    product = countIf(isNotNull(dt.cost.product))
```

- **How it works:**
  - `metrics from:now()-24h`: the `metrics` command loads metric series (records describing each metric key with
    one combination of dimension values) for the window from 24 hours ago until now, without data points. Each
    dimension of a series is a field on its record, so `dt.security_context`, `dt.cost.costcenter` and
    `dt.cost.product` are set only on series that have that dimension.
  - `summarize ...`: one record with the number of series and how many have each dimension (see the shared block
    above).
- **Output:** `total` → denominator of the three Metrics gauges and the `of <total> series` detail; `security`,
  `costcenter`, `product` → numerators and the `<part> of` detail.
- **Limits and cost:** no `samplingRatio` or `scanLimitGBytes` (the command does not take them). First 100,000
  series per the card note. Reads series metadata, not data points.
- **Open it yourself:** yes, the Metrics card's Show DQL / Copy / Open in Notebook / Add to Dashboard, title
  `Metrics primary tag coverage`.

### Q2 Log record coverage (sampled)

- **Source:** `dimensionalQuery(tf, "logs")` in [ui/app/queries.ts](../ui/app/queries.ts#L108), called in
  [`useDimensional`](../ui/app/tabs/Dimensional.tsx#L35).
- **Runs:** when the tab opens; again when the timeframe changes.
- **Parameters:** `tf` changes two parts: `from:now()-24h` becomes `from:now()-7d` / `from:now()-30d`, and
  `samplingRatio:10000` becomes `samplingRatio:100000` for both 7 and 30 days. `scanLimitGBytes:5` is fixed.
- **Query** (24 hours):

```dql
fetch logs, from:now()-24h, samplingRatio:10000, scanLimitGBytes:5
| summarize total = count(),
    security = countIf(isNotNull(dt.security_context)),
    costcenter = countIf(isNotNull(dt.cost.costcenter)),
    product = countIf(isNotNull(dt.cost.product))
```

  For 7 days (30 days is the same with `-30d`):

```dql
fetch logs, from:now()-7d, samplingRatio:100000, scanLimitGBytes:5
| summarize total = count(),
    security = countIf(isNotNull(dt.security_context)),
    costcenter = countIf(isNotNull(dt.cost.costcenter)),
    product = countIf(isNotNull(dt.cost.product))
```

- **How it works:**
  - `fetch logs`: reads the `logs` table from every log bucket the user may read.
  - `from:now()-24h`: the last 24 hours; no `to:`, so up to now.
  - `samplingRatio:10000`: reads about one record in 10,000 (see
    [Sampling and the 5 GB scan cap](#sampling-and-the-5-gb-scan-cap)).
  - `scanLimitGBytes:5`: stops reading after 5 GB.
  - `summarize ...`: one record with the sampled record count and how many carry each field.
- **Output:** `total`, `security`, `costcenter`, `product` → the Logs card gauges and detail lines (sample counts).
- **Limits and cost:** sampled, so small tenants can get `total = 0` (fewer than about 10,000 log records a day, or
  100,000 a week, can leave the sample empty) and the card then says "No logs found in this timeframe." At most 5 GB
  scanned.
- **Open it yourself:** yes, the Logs card's query actions, title `Logs primary tag coverage`. In a notebook you can
  lower or remove `samplingRatio` for an exact count (at a higher scan cost).

### Q3 Event coverage

- **Source:** `dimensionalQuery(tf, "events")` in [ui/app/queries.ts](../ui/app/queries.ts#L108), called in
  [`useDimensional`](../ui/app/tabs/Dimensional.tsx#L36).
- **Runs:** when the tab opens; again when the timeframe changes.
- **Parameters:** `tf` only: `from:now()-24h` becomes `from:now()-7d` / `from:now()-30d`.
- **Query** (24 hours):

```dql
fetch events, from:now()-24h, scanLimitGBytes:5
| summarize total = count(),
    security = countIf(isNotNull(dt.security_context)),
    costcenter = countIf(isNotNull(dt.cost.costcenter)),
    product = countIf(isNotNull(dt.cost.product))
```

- **How it works:**
  - `fetch events`: reads the `events` table from every events bucket the user may read. No filter, so every event
    kind in the table is counted.
  - `from:now()-24h`: the last 24 hours, up to now.
  - `scanLimitGBytes:5`: stops reading after 5 GB. No `samplingRatio` (see above).
  - `summarize ...`: one record with the event count and how many carry each field.
- **Output:** `total`, `security`, `costcenter`, `product` → the Events card gauges and detail lines.
- **Limits and cost:** not sampled; at most 5 GB scanned; if the cap is reached the result covers only what was read.
- **Open it yourself:** yes, the Events card's query actions, title `Events primary tag coverage`.

### Q4 Business event coverage

- **Source:** `dimensionalQuery(tf, "bizevents")` in [ui/app/queries.ts](../ui/app/queries.ts#L108), called in
  [`useDimensional`](../ui/app/tabs/Dimensional.tsx#L37).
- **Runs:** when the tab opens; again when the timeframe changes.
- **Parameters:** `tf` only: `from:now()-24h` becomes `from:now()-7d` / `from:now()-30d`.
- **Query** (24 hours):

```dql
fetch bizevents, from:now()-24h, scanLimitGBytes:5
| summarize total = count(),
    security = countIf(isNotNull(dt.security_context)),
    costcenter = countIf(isNotNull(dt.cost.costcenter)),
    product = countIf(isNotNull(dt.cost.product))
```

- **How it works:**
  - `fetch bizevents`: reads the `bizevents` table from every business event bucket the user may read.
  - `from:now()-24h`: the last 24 hours, up to now.
  - `scanLimitGBytes:5`: stops reading after 5 GB. No `samplingRatio`.
  - `summarize ...`: one record with the business event count and how many carry each field.
- **Output:** `total`, `security`, `costcenter`, `product` → the Business events card gauges and detail lines.
- **Limits and cost:** not sampled; at most 5 GB scanned; if the cap is reached the result covers only what was read.
- **Open it yourself:** yes, the Business events card's query actions, title `Business events primary tag coverage`.

### Client-side processing of the results

[`useDimensional`](../ui/app/tabs/Dimensional.tsx#L33) turns the four results into rows, one per data type in the
order Metrics, Logs, Events, Business events:

1. Take the first result record (`state.data?.records?.[0]`), or an empty object when there is none (loading, error,
   or no records).
2. `total = num(rec.total)`. `num` converts with `Number()` and returns 0 for anything that is not a finite number,
   so a missing field gives 0.
3. For each field in the fixed order *Security context* (`security`), *Cost center* (`costcenter`), *Cost product*
   (`product`): `part = num(rec[key])`, `pct = pct(part, total)` (rounded integer, 0 when total is 0).
4. The rows are recomputed whenever any of the four query states changes.

`DimensionalSummary` and `analyzeDimensional` then use only rows with `total > 0`
([Checks and scoring](#checks-and-scoring)). No other matching, joining or classification happens.

## API calls

All calls are made in the browser by `useDql` (`@dynatrace-sdk/react-hooks`, which uses `queryExecutionClient` from
`@dynatrace-sdk/client-query`), plus two intents and the clipboard.

| Method | Endpoint or SDK method | Scope | When |
| --- | --- | --- | --- |
| POST | `/platform/storage/query/v1/query:execute` (`queryExecutionClient.queryExecute`) | `storage:metrics:read` (Q1); `storage:logs:read` (Q2); `storage:events:read` (Q3); `storage:bizevents:read` (Q4); `storage:buckets:read` | Once per query when the tab opens or the timeframe changes (4 in parallel). |
| GET | `/platform/storage/query/v1/query:poll?request-token=<token>` (`queryExecutionClient.queryPoll`) | same as the query | Every second while a query is `NOT_STARTED` or `RUNNING`. |
| POST | `/platform/storage/query/v1/query:cancel?request-token=<token>` (`queryExecutionClient.queryCancel`) | same as the query | When a running query is no longer needed (for example the timeframe changed or the tab closed). |
| Intent | `sendIntent` → app `dynatrace.notebooks`, intent `view-query` | none | **↗ Open in Notebook** on a card. |
| Intent | `sendIntent` → app `dynatrace.dashboards`, intent `add-to-dashboard` | none | **↗ Add to Dashboard** on a card. |
| Browser | `navigator.clipboard.writeText` | none | **Copy** on a card. |

**Query execute.** Request body (Q2, 24 hours; the SDK adds `requestTimeoutMilliseconds: 1000`, nothing else):

```json
{
  "requestTimeoutMilliseconds": 1000,
  "query": "fetch logs, from:now()-24h, samplingRatio:10000, scanLimitGBytes:5\n| summarize total = count(),\n    security = countIf(isNotNull(dt.security_context)),\n    costcenter = countIf(isNotNull(dt.cost.costcenter)),\n    product = countIf(isNotNull(dt.cost.product))"
}
```

The response either contains the result (`result.records`) or a `requestToken` with `state` `RUNNING`, in which case
the SDK polls. On HTTP 429 the SDK waits (the server's retry delay, or `min(n², 30)` seconds) and retries the execute
call. A failed query is not retried; its error message is shown in the card.

**Query poll.** Repeated until `state` is no longer `NOT_STARTED` / `RUNNING`. Fields used from the final response:
`result.records[0].total`, `.security`, `.costcenter`, `.product`. Grail's `result.metadata` (including notifications
such as a reached scan limit) is not used.

**Intents.** Payload for both intents (Logs card, 24 hours):

```json
{
  "dt.query": "fetch logs, from:now()-24h, samplingRatio:10000, scanLimitGBytes:5\n| summarize total = count(),\n    security = countIf(isNotNull(dt.security_context)),\n    costcenter = countIf(isNotNull(dt.cost.costcenter)),\n    product = countIf(isNotNull(dt.cost.product))",
  "title": "Logs primary tag coverage"
}
```

with `recommendedAppId` `dynatrace.notebooks` / `recommendedIntentId` `view-query`, or `dynatrace.dashboards` /
`add-to-dashboard`. The user picks or confirms the target in the Dynatrace intent dialog.

This page makes no Settings, classic API or app function calls and no write calls.

## Remediation actions

This page has no Remediation actions section and makes no write calls. To raise its numbers, set the fields where the
data is produced or ingested:

- **At the source:** OneAgent host properties and Kubernetes labels / annotations become primary fields on the data
  the host or workload sends ([OneAgent primary tags](https://docs.dynatrace.com/docs/manage/tags/primary-tags/tags-domain-oneagent),
  [Kubernetes primary tags](https://docs.dynatrace.com/docs/manage/tags/primary-tags/tags-domain-k8s)).
- **Centrally at ingest:** ingest enrichment rules
  ([Ingest enrichment rules](https://docs.dynatrace.com/docs/manage/tags/tags-central-enrichment)) or OpenPipeline
  processing, which also cover data that has no entity (API-ingested logs, events and business events). The
  [Security context](security-context.md) and [Cost allocation](cost-allocation.md) tabs have Remediation actions that
  create ingest enrichment rules (`builtin:ingest.enrichment.config`).

After a fix, only newly ingested data carries the field; the percentages rise as the timeframe fills with new data.

## AI Assist on this page

[`analyzeDimensional`](../ui/app/analyses.ts#L426) in `ui/app/analyses.ts`, wired in
[`DataOverviewTab`](../ui/app/tabs/Dimensional.tsx#L104). It is rule-based, runs locally in the browser on the numbers
already on screen, and calls no AI service. It is computed only while the panel is open and recomputed whenever a
query result changes. Input per data type: title, `total`, and the three `{label, pct}` values.

**When no data type has `total > 0`** (all empty, failed or still loading):

- Summary: "No metrics, logs or events were returned for this timeframe, so dimensional data could not be scored."
- Insight (info): "Dimensional data results are empty or still loading."
- No recommendations.

**Otherwise** (only data types with `total > 0` are considered):

- **Summary:** "Dimensional data (`<titles in lower case, comma-separated>`) averages `<avg>`% coverage of security
  context and cost tags; results for logs, events and business events are scan-limited estimates." `avg` is
  `Math.round` of the mean of all their percentages, the same number as the Overall readiness gauge. The closing
  remark about estimates is always added.
- **Insight "Not present" (critical, siren icon):** when one or more (data type, field) pairs have `pct === 0`:
  "Not present on any sampled record: `<Field> on <data type>`, ...". Listed in the order Metrics, Logs, Events,
  Business events and Security context, Cost center, Cost product. Because `pct` is rounded, a field on less than
  0.5 % of records also counts as 0 here.
- **Insight "Weakest" (falling-chart icon):** the (data type, field) pair with the lowest percentage (first in the
  order above on ties), only when that lowest value is above 0: "Weakest: `<Field>` on `<data type>` at `<pct>`%."
  Severity: good at 90 % or more, warning at 50 % to 89 %, critical below 50 % (`sevFor`,
  [analyses.ts](../ui/app/analyses.ts#L6)). When any pair is at 0 %, this insight is not shown (the "Not present"
  insight covers it).
- **Recommendation (high impact, always):** "Set security context and cost tags at ingest with OpenPipeline
  processing so logs, events and metrics carry them regardless of entity enrichment."

Example output for the [worked example](#worked-example): summary "Dimensional data (metrics, logs, business events)
averages 39% coverage of security context and cost tags; ...", one critical insight "Not present on any sampled
record: Cost center on logs, Cost product on logs.", no Weakest insight, and the high-impact recommendation.

## Limitations and edge cases

- **Only three fields and four tables.** `dt.security_context`, `dt.cost.costcenter` and `dt.cost.product` on
  metric series, `logs`, `events` and `bizevents`. Host group, ownership and customer primary tags
  (`primary_tags.<name>`) are not checked on records, and spans, user events, user sessions and system tables are not
  read.
- **Not part of readiness.** These scores do not feed Entity Overview's Overall readiness or Top 5 findings.
- **Unweighted means.** The summary gauges average percentages, not records: a data type with a handful of records
  weighs as much as one with millions.
- **Rounding.** Every percentage is a rounded integer before it is averaged. A field on 0.4 % of records shows 0 %
  and is reported by AI Assist as "not present on any sampled record".
- **Present but empty counts as present.** `isNotNull` is true for an empty string (or an empty array), so a field
  set to an empty value counts as in place.
- **Log numbers are sample counts.** The Logs detail lines show sampled counts, not volume. Low-volume tenants can
  get an empty sample ("No logs found in this timeframe.") even though logs exist, and small samples give coarse
  percentages that change between runs. Moving from 24 hours to 7 days raises the ratio tenfold.
- **Scan cap results are partial and not flagged.** When Q2, Q3 or Q4 reaches 5 GB, the result covers only the data
  read; the tab does not tell you. Compare with a notebook run.
- **Metric series limit.** Per the card note, only the first 100,000 metric series are evaluated; on tenants with more
  series the Metrics percentages cover a subset. The query text has no limit of its own.
- **Record-level permissions.** Counts include only records the signed-in user may read (bucket and record
  conditions apply), see [User permissions](#user-permissions).
- **Loading and failed queries are silently left out** of the summary card and AI Assist, so the Overall readiness
  can change as queries complete, and a failed query lowers the number of checks rather than the score.
- **Timeframe.** The window always ends now (no `to:`). 30 days uses the same sampling ratio as 7 days and is the most
  likely to hit the scan cap.
- **Cached results.** Results can come from the SDK's in-memory cache when you reopen the tab or return to a
  timeframe shortly after; reload the page for fresh numbers.
- **Entity coverage is a different measure.** The Security context and Cost allocation tabs count Smartscape
  entities; this tab counts series and records. The numbers are not expected to match.

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| A card shows **Query failed** with a permission or "not authorized" message | The app lacks the scope (`storage:metrics:read`, `storage:logs:read`, `storage:events:read`, `storage:bizevents:read`, `storage:buckets:read`) or the signed-in user lacks the matching IAM permission or bucket access. | Check the user's policies first (the app cannot read more than the user). If the scope is missing from `app.config.json`, add it, then restart `npx dt-app dev` or redeploy; a running session keeps its old token. |
| "No logs found in this timeframe." although the tenant has logs | The sample is empty: with `samplingRatio:10000` (24 h) or `100000` (7 / 30 days), a low log volume yields no sampled records. Longer timeframes make this more likely, not less. | Open the Logs query in a notebook and lower or remove `samplingRatio`. |
| Log percentages change noticeably between runs | Small sample. | Check the detail line: a total in the tens means each record moves the gauge by several points. Run the query in a notebook with a lower ratio. |
| Events or business events numbers differ a lot between 24 hours and 30 days | The 5 GB cap was reached on the longer window, so only part of the data was read. | Open the query in a notebook and check its notifications and scanned bytes; narrow the timeframe there or add a filter. |
| Security context shows 100 % everywhere, but you know data without it exists | Your IAM permissions limit the records you can read by security context (or by bucket). | Run the tab as a user with unrestricted read access, or use the [Permissions Test](permissions-test.md) tab to see how your access is limited. |
| Security context is high on the Security context tab but low here | Entities carry the field, but the data does not (enrichment not applied at ingest, or the data is ingested without an entity). | Set the field at ingest (see [Remediation actions](#remediation-actions)). |
| The summary card is missing | No data type has returned `total > 0` yet (still loading, failed or empty). | Wait for the cards to load; check the cards for errors. |
| AI Insights says "Dimensional data results are empty or still loading." | Same as above. | Wait, or fix the failing queries. |
| Numbers do not change after an ingest fix | Only new data carries the field; old data in the window still lacks it. Or a cached result is shown. | Wait for new data, use the 24-hour timeframe, and reload the page. |

## Related pages

- [Index](README.md): app shell, timeframe, AI Assist, gauges and query actions.
- [Entity Overview](entity-overview.md): the same fields on Smartscape entities; the readiness score this tab does
  not feed.
- [Security context](security-context.md): `dt.security_context` per entity type, entity search, ingest enrichment
  rule.
- [Cost allocation](cost-allocation.md): `dt.cost.costcenter` and `dt.cost.product` per entity type, entity search,
  ingest enrichment rule.
- [Primary tags](primary-tags.md): customer-defined `primary_tags.<name>` per entity type.
- [IAM Policy Creator](iam-policy-creator.md): limit Grail data access with dimensional data such as security
  context.
- [Permissions Test](permissions-test.md): which Grail tables a user or group can read, and with which record limits.

## Source files

| File | Role on this page |
| --- | --- |
| [ui/app/tabs/Dimensional.tsx](../ui/app/tabs/Dimensional.tsx) | The tab: `DataOverviewTab`, `useDimensional` (four queries, parsing), `DimensionalSummary` (summary card), `DimensionalSection` (cards). |
| [ui/app/queries.ts](../ui/app/queries.ts#L94) | `DIMENSIONAL_KINDS`, `DIMENSIONAL_INFO` (titles, units, notes), `SCAN_CAP_GB`, `LOG_SAMPLING`, `dimensionalQuery`, `TIMEFRAMES`. |
| [ui/app/analyses.ts](../ui/app/analyses.ts#L426) | `analyzeDimensional` (AI Assist rules) and `sevFor`. |
| [ui/app/AIInsights.tsx](../ui/app/AIInsights.tsx) | AI Insights panel and `useAIInsights`. |
| [ui/app/components.tsx](../ui/app/components.tsx) | `PctGauge`, `QueryState`, `QueryActions`, `num`, `pct`, `statusColor`. |
| [ui/app/useDql.ts](../ui/app/useDql.ts) | Wrapper around `useDql` from `@dynatrace-sdk/react-hooks`. |
| [ui/app/App.tsx](../ui/app/App.tsx#L86) | Mounts `DataOverviewTab` for tab `data`; timeframe select and AI Assist button. |
| [ui/app/areas.tsx](../ui/app/areas.tsx#L34) | Tab title *Data Overview*, Metadata area, `TAB_DOCS` link to this page. |
| [app.config.json](../app.config.json) | The `storage:*:read` scopes listed above. |
