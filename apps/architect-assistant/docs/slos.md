# SLOs

The SLOs tab measures how far a tenant has moved from **Service-Level Objectives Classic** (metric expression plus entity selector, classic SLO API) to **Service-Level Objectives** on Grail (one DQL query that returns a field `sli`, platform SLO API), and upgrades classic SLOs for you. It pairs every classic SLO with the SLO that has the same name, shows the share that is upgraded, lets you search the classic SLOs, and offers a remediation flow that generates the DQL SLI from the classic metric expression (recipe based), keeps the classic entity selector with `classicEntitySelector()`, previews the new SLI next to the classic SLO's own evaluation, and then creates (or updates) the SLOs through `/platform/slo/v1/slos`. Classic SLOs are never changed or deleted.

| | |
| --- | --- |
| Area | Migration Assistance (see [index](README.md)) |
| Tab id | `slos` |
| Counts toward Entity Overview readiness / Top findings | no. Nothing on this tab feeds the Entity Overview readiness score or Top findings; the gauge only appears on this tab |
| Main source files | [ui/app/tabs/SlosTab.tsx](../ui/app/tabs/SlosTab.tsx), [ui/app/slos.ts](../ui/app/slos.ts), [ui/app/analyses.ts](../ui/app/analyses.ts#L356) (`analyzeSlos`) |

## Contents

- [What this page answers](#what-this-page-answers)
- [Before you start](#before-you-start)
  - [App scopes used by this page](#app-scopes-used-by-this-page)
  - [User permissions](#user-permissions)
  - [One-time setup](#one-time-setup)
- [Page walkthrough](#page-walkthrough)
  - [Documentation link and AI Assist panel](#documentation-link-and-ai-assist-panel)
  - [Heading and introduction](#heading-and-introduction)
  - [Loading and error states](#loading-and-error-states)
  - [Summary tiles and the Classic SLOs upgraded gauge](#summary-tiles-and-the-classic-slos-upgraded-gauge)
  - [Search classic SLOs](#search-classic-slos)
  - [Remediation actions (overview)](#remediation-actions-overview)
- [Checks and scoring](#checks-and-scoring)
- [Queries](#queries)
  - [How every SLI query is assembled](#how-every-sli-query-is-assembled)
  - [Q1 Service availability (server-side)](#q1-service-availability-server-side)
  - [Q2 Service availability (all errors)](#q2-service-availability-all-errors)
  - [Q3 Service performance (response time threshold)](#q3-service-performance-response-time-threshold)
  - [Q4 Browser monitor availability](#q4-browser-monitor-availability)
  - [Q5 HTTP monitor availability](#q5-http-monitor-availability)
  - [Q6 Host CPU usage](#q6-host-cpu-usage)
  - [Q7 Host memory usage](#q7-host-memory-usage)
  - [Q8 Host disk used %](#q8-host-disk-used-)
  - [Q9 Kubernetes namespace memory efficiency](#q9-kubernetes-namespace-memory-efficiency)
  - [Q10 Kubernetes namespace CPU efficiency](#q10-kubernetes-namespace-cpu-efficiency)
  - [Q11 Kubernetes cluster memory requests](#q11-kubernetes-cluster-memory-requests)
  - [Q12 Kubernetes cluster CPU requests](#q12-kubernetes-cluster-cpu-requests)
  - [Client-side processing](#client-side-processing)
- [API calls](#api-calls)
- [Remediation actions](#remediation-actions)
  - [API: Upgrade classic SLOs to SLOs](#api-upgrade-classic-slos-to-slos)
  - [Classic SLO to SLO field mapping](#classic-slo-to-slo-field-mapping)
  - [Timeframe conversion](#timeframe-conversion)
  - [externalId and tag scheme](#externalid-and-tag-scheme)
  - [Manual: Upgrade a classic SLO manually (Data Explorer converter)](#manual-upgrade-a-classic-slo-manually-data-explorer-converter)
  - [Documentation for this fix](#documentation-for-this-fix)
- [AI Assist on this page](#ai-assist-on-this-page)
- [Limitations and edge cases](#limitations-and-edge-cases)
- [Troubleshooting](#troubleshooting)
- [Related pages](#related-pages)
- [Source files](#source-files)

## What this page answers

For an architect planning or tracking the move off Service-Level Objectives Classic:

- How many classic SLOs exist, and how many of them are enabled or disabled?
- How many SLOs (Grail-based Service-Level Objectives app) exist, and how many of them carry the name of a classic SLO?
- Which share of the classic SLOs already has an SLO with the same name (the upgrade gauge)?
- Which of the remaining classic SLOs can this app convert automatically, and which need a manual upgrade?
- Which SLOs did this app create (and can therefore update), and which same-name SLOs were made by someone else (and are left alone)?
- For each classic SLO being upgraded: what DQL SLI replaces its metric expression, does that query return data, and how does its value compare with the classic SLO's own evaluation?

The best practice behind the tab: Service-Level Objectives on Grail replace Service-Level Objectives Classic. The SLI is one DQL query instead of a metric expression plus an entity selector, and segments replace management zones. Dynatrace documents the upgrade path and the metric selector conversion; the code cites these pages (they are also the tab's "Documentation for this fix" links):

- [Upgrade from Service-Level Objectives Classic](https://docs.dynatrace.com/docs/platform/upgrade/keep-problems-and-alerting-working/service-level-objective-upgrade-classic)
- [Metric selector conversion](https://docs.dynatrace.com/docs/platform/upgrade/preserve-metrics-and-service-visibility/metrics/metric-selector-conversion)
- [Service-level objective templates](https://docs.dynatrace.com/docs/deliver/service-level-objectives/service-level-objective-templates)

There is no API that converts a metric expression to DQL (the Data Explorer converter is UI only), so the automatic conversion is **recipe based**: the metric expressions of the classic SLO templates and a few other common shapes map to Grail metrics; anything else is a manual upgrade. According to the comment in [slos.ts](../ui/app/slos.ts#L14), every recipe query was run against the demo tenant with `dtctl`.

**What counts as "upgraded":** a classic SLO counts as upgraded when an SLO with exactly the same name exists (case-sensitive string equality). It does not matter who created the SLO or what its query is.

## Before you start

### App scopes used by this page

From [app.config.json](../app.config.json) and the calls in [slos.ts](../ui/app/slos.ts):

| Scope | What this page uses it for |
| --- | --- |
| `environment-api:slo:read` | List every classic SLO (metric expression, entity selector, target, warning, timeframe) through the classic SLO API, and evaluate the selected classic SLOs during Validate for the side-by-side comparison. |
| `slo:slos:read` | List the SLOs (platform SLO API) to match them to classic SLOs by name; start and poll the evaluation of each SLO created or updated by the upgrade. |
| `slo:slos:write` | Remediation: create (`POST`) and update (`PUT`) the upgraded SLOs. |
| `storage:metrics:read` | Validate: the SLI preview queries are `timeseries` queries over Grail metrics (service, synthetic, host and Kubernetes metrics). The scope is requested for other tabs too. |
| `storage:entities:read` | Validate: the SLI preview resolves the classic entity selector with `classicEntitySelector()`, which reads classic entities. The scope is requested for other tabs (Segments, Extensions, IAM); its comment in app.config.json does not mention SLOs. |

The page opens other apps by intent and links (classic SLO, SLO, Notebooks, Dashboards); these need no app scope, only that the user can open those apps.

### User permissions

App calls run with the signed-in user's permissions as well as the app scopes, so the user needs:

- **Classic SLO API:** one of `environment:roles:viewer` or `settings:objects:read` (the SDK documents these for `GET /api/v2/slo`).
- **SLOs:** `slo:slos:read` to see the tab's numbers and to evaluate; `slo:slos:write` to create or update SLOs with the remediation.
- **SLI preview (Validate):** read access to the Grail metrics the SLI uses (`storage:metrics:read` and access to the metric buckets), and to classic entities for `classicEntitySelector()` (`storage:entities:read`).

A user who can only read sees every number and can run Validate; the **Upgrade to SLOs** request then fails per SLO with the permission error returned by the SLO API (see [Troubleshooting](#troubleshooting)).

### One-time setup

None. The page uses no credential vault entry, no app function, no outbound connection and no OAuth client.

## Page walkthrough

The tab is rendered by `SlosTab` ([SlosTab.tsx](../ui/app/tabs/SlosTab.tsx#L464)). It does **not** use the app's timeframe select (24 hours / 7 days / 30 days): `App.tsx` renders `<SlosTab />` without the `tf` prop, so changing the timeframe changes nothing on this tab. Every window on this tab comes from the classic SLO's own timeframe.

On-screen order:

1. "SLOs documentation" link (top right) and, when AI Assist is on, the AI Assist panel.
2. Heading **Service-level objectives** and an introduction.
3. Five summary tiles (one of them the gauge).
4. **Search classic SLOs**.
5. **Remediation actions**.

### Documentation link and AI Assist panel

- **SLOs documentation** (top right, from `TabDocsLink` in [areas.tsx](../ui/app/areas.tsx)): opens this page on GitHub (`https://github.com/Chr0dine/dt-apps/blob/main/apps/architect-assistant/docs/slos.md`).
- **AI Assist panel:** shown above the heading when the **AI Assist** button in the app header is on. Its content is described in [AI Assist on this page](#ai-assist-on-this-page).

### Heading and introduction

Heading **Service-level objectives** followed by: "Service-Level Objectives (on Grail) replace Service-Level Objectives Classic: the SLI is one DQL query instead of a metric expression and an entity selector, and segments replace management zones. A classic SLO counts as upgraded when an SLO with the same name exists."

### Loading and error states

When the tab mounts, `useSloData` ([SlosTab.tsx](../ui/app/tabs/SlosTab.tsx#L46)) starts two reads in parallel (`Promise.all`):

- `listClassicSlos()`: every classic SLO, enabled and disabled, not evaluated ([API call A1](#a1-list-classic-slos)).
- `listNewSlos()`: every SLO ([API call A2](#a2-list-slos)).

Then `matchSlos()` pairs them (see [Client-side processing](#client-side-processing)).

| State | What you see |
| --- | --- |
| Loading (either list not loaded yet) | The text "Loading…" in place of the tiles, search and remediation section. |
| Error (either call throws) | A red message box **Could not read SLOs** with the error message (for example a missing scope or permission error). Nothing else is shown; there is no partial view, because both lists are needed for the match. |
| Loaded | Tiles, search and remediation actions. |

The data loads again after **Upgrade to SLOs** finishes (`reload()`), and whenever the tab is mounted again (for example after switching to another area and back). A reload does not blank the page: the previous rows stay on screen until the new ones arrive.

### Summary tiles and the Classic SLOs upgraded gauge

A wrapping row of five cards ([SlosTab.tsx](../ui/app/tabs/SlosTab.tsx#L503)). "Classic SLOs" below means every classic SLO returned by the classic API, enabled and disabled.

| Card | Value | Subtitle | Computation |
| --- | --- | --- | --- |
| **Classic SLOs** (tile) | number of classic SLOs | `<e> enabled, <d> disabled` | `rows.length`; `e` = rows with `enabled == true`; `d = rows.length - e`. |
| **SLOs** (tile) | number of SLOs | `<n> named after a classic SLO` | value = every SLO returned by the platform API (`slos.length`). `n` = number of SLOs whose name equals the name of any classic SLO. If several SLOs share a classic name, each one is counted, so `n` can exceed the number of upgraded classic SLOs. |
| **Classic SLOs upgraded** (gauge) | percentage | `<upgraded> of <total>` | `PctGauge` with `pct(upgraded, total)`: `upgraded` = classic SLOs that have an SLO with the same name (`row.match` set); `total` = all classic SLOs. `pct()` returns `Math.round(upgraded / total * 100)`, or 0 when there are no classic SLOs. |
| **Auto-convertible** (tile) | number | `of <total - upgraded> not upgraded yet` | classic SLOs **not** upgraded whose metric expression matches one of the conversion recipes (`recipeLabel(metricExpression) != null`). The entity selector type and the timeframe are not checked here; Validate can still mark some of these as manual (see [Checks and scoring](#checks-and-scoring)). |
| **Created by this app** (tile) | number | `updatable from the remediation section` | classic SLOs whose same-name SLO carries this app's `externalId` for that name (`row.managed`, see [externalId and tag scheme](#externalid-and-tag-scheme)). |

The gauge is the shared custom SVG gauge (`PctGauge` in [components.tsx](../ui/app/components.tsx#L69)): a 240-degree arc whose filled part is a red-to-green gradient along its length, the rounded integer percentage in the middle, the caption **Classic SLOs upgraded** and the detail line underneath. It has no (i) button and no hover or click behaviour. Because the tile values come from REST APIs and not from DQL, the tiles and the gauge have **no** Show DQL / Copy / Open in Notebook / Add to Dashboard actions; the DQL on this tab is the generated SLI queries, each exposed with its own actions in the upgrade preview.

### Search classic SLOs

`SloSearch` ([SlosTab.tsx](../ui/app/tabs/SlosTab.tsx#L97)). A box titled **Search classic SLOs** with two inputs and a button. The search is client-side over the classic SLOs already loaded; it makes no API call and runs no query.

| Control | Options | Effect |
| --- | --- | --- |
| **Name contains** (text) | free text; placeholder "e.g. availability (leave empty for all)" | Keeps classic SLOs whose name contains the text, case-insensitive (both lowercased). The text is trimmed when you press the button. Empty lists all. |
| **Upgrade status** (select) | **Any** (default), **Not upgraded**, **Upgraded** | Any: no filter. Not upgraded: rows without a same-name SLO. Upgraded: rows with a same-name SLO (created by this app or not). |
| **Search classic SLOs** (button) | | Applies both inputs. The table appears only after the first press; changing an input afterwards has no effect until you press the button again. |

Result table (Strato `DataTable`, sortable by every column, full width, condensed rows, no paging configured, so every matching row is rendered). Rows keep the order of the loaded list, which is classic SLO name ascending (`localeCompare`), until you sort by a column.

| Column | Meaning | Source |
| --- | --- | --- |
| **Classic SLO** | Classic SLO name, linked to the classic SLO (opens in a new tab). | `name`; link from intent `dynatrace.classic.slo` / `view-slo` with `{ "slo.id": <classic SLO ID> }` (`classicSloLink`). If the link cannot be built, the name is plain text. |
| **Enabled** | `Yes` / `No` | classic `enabled` |
| **Target / warning** | `<target>` or `<target> / <warning>`; the warning is shown only when it is greater than the target | classic `target`, `warning` |
| **Timeframe** | The classic timeframe as stored, for example `-1w` | classic `timeframe` |
| **Conversion** | The label of the conversion recipe that matches the metric expression (for example "Service availability (server-side)"), or `Manual` | `recipeLabel(metricExpression)`; only the metric expression is checked |
| **SLO with the same name** | `Yes (created by this app)`, `Yes`, or `No`; when there is a match, followed by ` · Open SLO ↗` | match and `managed` from `matchSlos()`; link from intent `dynatrace.service.level.objectives` / `view-slo` with `{ "dt.slo.id": <SLO ID> }` (`sloLink`) |

Empty state: "No classic SLOs match this search." when classic SLOs exist, or "No classic SLOs are defined in this environment." when there are none.

### Remediation actions (overview)

`SloActions` ([SlosTab.tsx](../ui/app/tabs/SlosTab.tsx#L419)). A box with the heading **Remediation actions**, the line "`<m>` classic SLO(s) without an SLO of the same name; `<a>` can be converted automatically." (`m` = not upgraded; `a` = not upgraded with a matching recipe, the same number as the Auto-convertible tile), and an **Action** select:

| Option | Kind | Content |
| --- | --- | --- |
| **API · Upgrade classic SLOs to SLOs** (default) | API | The upgrade form: pick, Validate, confirm, create or update. See [API: Upgrade classic SLOs to SLOs](#api-upgrade-classic-slos-to-slos). |
| **Manual · Upgrade a classic SLO manually (Data Explorer converter)** | Manual | Steps, a selector-to-DQL cheat sheet, notes. See [Manual: Upgrade a classic SLO manually](#manual-upgrade-a-classic-slo-manually-data-explorer-converter). |

Switching the action remounts the form (its state is lost). Under the form: **Documentation for this fix:** followed by the three documentation links listed in [What this page answers](#what-this-page-answers) (both actions use the same list).

## Checks and scoring

| Check / status | In place when | Numerator | Denominator | Severity / thresholds | Notes |
| --- | --- | --- | --- | --- | --- |
| **Classic SLO upgraded** (gauge, AI Assist) | An SLO exists whose `name` is exactly the classic SLO's `name` | classic SLOs with a same-name SLO | all classic SLOs (enabled and disabled) | Gauge colour is the continuous red-to-green gradient. AI Assist severity: `good` at 90 % or more, `warning` at 50 % or more, `critical` below 50 % (`sevFor`) | Rounded to an integer with `Math.round`. 0 % (not 100 %) when there are no classic SLOs. Name match only; query, target and timeframe are not compared. |
| **Created by this app** (`managed`) | The matched SLO's `externalId` equals `architect-assistant-slo-<FNV-1a hash of the name>` | count | (tile shows a count, no ratio) | none | Such SLOs can be updated (PUT) by the remediation; other same-name SLOs are never touched. |
| **Auto-convertible** (tile, Conversion column, checkbox hints, AI Assist) | The normalized metric expression matches a recipe | not-upgraded classic SLOs with a recipe | not-upgraded classic SLOs | none | Only the metric expression is checked. |
| **Plan: create** (Validate) | Recipe found, every `type(...)` in the selector is the recipe's entity type, timeframe is a relative window ending now, name at most 200 characters, no same-name SLO from someone else, first classic SLO of that name in the selection, no same-name SLO yet | | | green line if the preview is OK | `POST` |
| **Plan: update (same SLO ID)** (Validate) | As above, but the same-name SLO was created by this app | | | green line if the preview is OK | `PUT` with optimistic locking |
| **Plan: skipped, manual** (Validate) | No recipe; or selector type mismatch; or timeframe not convertible | | | orange line (`#E87A00`) | Use the manual action. |
| **Plan: skipped, blocked** (Validate) | Name longer than 200 characters; or same-name SLO not created by this app; or another classic SLO with the same name came earlier in the selection | | | red line (`#C21930`) | Never written. |
| **Preview ok** | SLI query succeeded and returned at least one numeric `sli` data point | | | green line (`#0D9C29`) | Shows "Returns sli (`n` series)" only internally; the line shows the preview value. |
| **Preview no data** | Query succeeded but returned no records or no numeric `sli` values | | | orange line | Skipped from the upgrade by default ("Skip SLOs whose query returned no data", on by default). |
| **Preview error** | Query failed (exception, or final state other than `SUCCEEDED`) | | | red line | Always skipped from the upgrade (a failing query would create a broken SLO). |
| **Classic value** | Classic evaluation returned `error == "NONE"` and `evaluatedPercentage >= 0` | | | none | Otherwise shown as `—`, followed by the classic `error` code in parentheses. |

The planning rules are applied in this order (first failing rule wins), in `planUpgrade` ([slos.ts](../ui/app/slos.ts#L339)):

| # | Rule | Message shown | Kind |
| --- | --- | --- | --- |
| 1 | Name longer than 200 characters | "Name longer than 200 characters (SLO name limit)." | blocked (red) |
| 2 | A same-name SLO exists and was not created by this app | "An SLO with this name exists and was not created by this app; left unchanged." | blocked (red) |
| 3 | An earlier classic SLO in the same selection has the same name | "Another classic SLO has the same name; SLOs need a unique externalId, so only the first one is upgraded." | blocked (red) |
| 4 | No recipe matches the metric expression | "Metric expression has no automatic conversion. Upgrade it manually (see the manual action)." | manual (orange) |
| 5 | Any `type(...)` clause in the entity selector names another entity type than the recipe's | "Entity selector type `<types>` does not match the metric's entity (`<recipe type>`)." | manual (orange) |
| 6 | The timeframe is not a relative window ending now | "Timeframe "`<tf>`" is not a relative window ending now; set the criteria manually." | manual (orange) |

## Queries

The page runs **no DQL on load**. Its DQL is the **SLI query** generated for each selected classic SLO. There are twelve recipes; each produces one query shape. Every query:

- **Runs:** on **Validate**, once per selected classic SLO that passes planning (4 queries in parallel, batches run one after another), as a preview. The same text becomes the SLO's `customSli.indicator` when you run **Upgrade to SLOs**; from then on the SLO service runs it whenever the SLO is evaluated (the app requests one evaluation right after creation, see [A7](#a7-start-slo-evaluation)). It does not re-run on the app's timeframe change (the tab ignores it).
- **Feeds:** the "SLI preview (mean of data points)" value and the colour of the validation line; the request body of the create / update.
- **Open it yourself:** every validation line of a planned SLO has `QueryActions` titled `SLI: <classic SLO name>`: **Show DQL**, **Copy**, **↗ Open in Notebook** (intent `dynatrace.notebooks` / `view-query` with `{ "dt.query": <query>, "title": "SLI: <name>" }`) and **↗ Add to Dashboard** (`dynatrace.dashboards` / `add-to-dashboard`, same payload). The query is also inside the **Request** preview (JSON-escaped, in `customSli.indicator`).

| # | Name (builder in [slos.ts](../ui/app/slos.ts)) | Recipe id | Runs when | Feeds which section |
| --- | --- | --- | --- | --- |
| Q1 | Service availability (server-side): `availability` | `service-availability` | Validate; then stored in the SLO | Validation line, request body |
| Q2 | Service availability (all errors): `availability` | `service-availability-total` | same | same |
| Q3 | Service performance (response time threshold): inline `build` | `service-performance` | same | same |
| Q4 | Browser monitor availability: `avgOf("dt.synthetic.browser.availability")` | `synthetic-browser` | same | same |
| Q5 | HTTP monitor availability: `avgOf("dt.synthetic.http.availability")` | `synthetic-http` | same | same |
| Q6 | Host CPU usage: `avgOf("dt.host.cpu.usage")` | `host-cpu` | same | same |
| Q7 | Host memory usage: `avgOf("dt.host.memory.usage")` | `host-memory` | same | same |
| Q8 | Host disk used %: `avgOf("dt.host.disk.used.percent")` | `host-disk` | same | same |
| Q9 | Kubernetes namespace memory efficiency: `ratioOf(..., true)` | `k8s-namespace-memory` | same | same |
| Q10 | Kubernetes namespace CPU efficiency: `ratioOf(..., true)` | `k8s-namespace-cpu` | same | same |
| Q11 | Kubernetes cluster memory requests: `ratioOf(..., true)` | `k8s-cluster-memory` | same | same |
| Q12 | Kubernetes cluster CPU requests: `ratioOf(..., true)` | `k8s-cluster-cpu` | same | same |

The queries below were generated by running `planUpgrades()` from [slos.ts](../ui/app/slos.ts) on classic SLOs with placeholder values. The parts that vary are the entity selector inside `classicEntitySelector("...")` (and whether the `filter:` clause is present at all) and, for Q3, the response time threshold.

### How every SLI query is assembled

1. **Normalize the metric expression** (`normalize`, [slos.ts](../ui/app/slos.ts#L162)):
   - `norm`: all whitespace removed, then every `:splitBy(...)` removed (regular expression `:splitBy\([^)]*\)`; an aggregate classic SLO resolves to one value, so the split does not change the result).
   - `bare`: `norm` with every `(` and `)` removed, so `(100)*((a)/(b))` and `(100)*(a)/(b)` compare equal.
2. **Find the recipe** (`findRecipe`): the twelve recipes are tried in the order of the table above; the first whose `match` succeeds wins. Most recipes compare `bare` with fixed strings; the performance recipe matches `norm` with a regular expression. "Ratio forms" means both `100*A/B` and `A/B*100` are accepted (after `bare` normalization).
3. **Check the entity selector type** (`selectorTypes`): every `type(...)` clause anywhere in the classic selector (`type\(\s*"?([A-Za-z_]+)"?\s*\)`, quotes optional, uppercased) must equal the recipe's classic entity type (for example `SERVICE`). A selector without any `type(...)` passes. A `type(...)` inside a relationship clause (for example `fromRelationships.runsOnHost(type("HOST"))` in a service selector) also counts, and fails the check.
4. **Convert the timeframe** (see [Timeframe conversion](#timeframe-conversion)).
5. **Build the filter clause:** if the classic `filter` (entity selector) is not empty after trimming, the recipe gets
   `, filter: { in(<recipe entity dimension>, classicEntitySelector(<selector as a JSON string literal>)) }`.
   The selector is passed through unchanged; `JSON.stringify` wraps it in double quotes and escapes inner quotes as `\"`. If the selector is empty, there is no `filter:` clause and the note "No entity selector: every entity with this metric is included." is added.
6. **Build the query** with the recipe's builder. No query sets `from:` / `to:`: the window comes from the caller (the preview passes the SLO window as the default timeframe; the SLO service uses the SLO's criteria; a notebook uses its own timeframe).
7. **Notes:** each plan lists the recipe's notes, the no-selector note when applicable, and always "Run both SLOs for one evaluation period and compare the values before you retire the classic SLO."

The result of every recipe is a record with `timeframe`, `interval` and the array `sli` (one percentage per time interval). The SLO service requires the field to be called `sli`.

**Limits and cost (all queries):** metric `timeseries` queries only (no log or event scans, no sampling). The resolution (`interval`) is chosen by Grail from the window length, since no `interval:` or `bins:` parameter is set. The preview request uses `requestTimeoutMilliseconds: 30000`. Validate runs one query per planned SLO, four at a time.

### Q1 Service availability (server-side)

- **Source:** recipe `service-availability`, builder `availability` ([slos.ts](../ui/app/slos.ts#L187)).
- **Matches** (after normalization, `bare` equals one of):
  - `100*builtin:service.errors.server.successCount/builtin:service.requestCount.server`
  - `builtin:service.errors.server.successCount/builtin:service.requestCount.server*100`
  - `100-builtin:service.errors.server.rate`

  For example the classic template `(100)*(builtin:service.errors.server.successCount:splitBy())/(builtin:service.requestCount.server:splitBy())` or `100 - builtin:service.errors.server.rate:splitBy()`.
- **Entity:** classic type `SERVICE`, Grail dimension `dt.entity.service`.
- **Parameters:** entity selector (here `type("SERVICE"),entityId("SERVICE-0000000000000001")`).
- **Query:**

```dql
timeseries { total = sum(dt.service.request.count), failures = sum(dt.service.request.failure_count) }, filter: { in(dt.entity.service, classicEntitySelector("type(\"SERVICE\"),entityId(\"SERVICE-0000000000000001\")")) }
| fieldsAdd sli = (total[] - failures[]) / total[] * 100
| fieldsRemove total, failures
```

  Without an entity selector the first line ends after the closing `}` of the metric list: `timeseries { total = sum(dt.service.request.count), failures = sum(dt.service.request.failure_count) }`.
- **How it works:**
  - `timeseries { total = sum(dt.service.request.count), failures = sum(dt.service.request.failure_count) }`: reads two metric series in one command. No `by:` is set, so each is summed across every service that passes the filter: one record with two arrays, request count and failure count per interval.
  - `filter: { in(dt.entity.service, classicEntitySelector("...")) }`: keeps only data points whose `dt.entity.service` is one of the services that the classic entity selector resolves to.
  - `fieldsAdd sli = (total[] - failures[]) / total[] * 100`: element-wise array arithmetic (`[]`): for each interval, successful requests divided by all requests, times 100. An interval without requests yields null.
  - `fieldsRemove total, failures`: drops the helper arrays so the record has `timeframe`, `interval`, `sli`.
- **Output:** `sli`, the availability percentage per interval. The preview averages all its numbers.
- **Recipe notes shown:** "Successful = requests minus dt.service.request.failure_count (failure detection), per Grail interval."

### Q2 Service availability (all errors)

- **Source:** recipe `service-availability-total`, builder `availability` (the same builder as Q1).
- **Matches** (`bare` equals one of):
  - `100*builtin:service.errors.total.successCount/builtin:service.requestCount.total`
  - `builtin:service.errors.total.successCount/builtin:service.requestCount.total*100`
  - `100-builtin:service.errors.total.rate`
- **Entity:** `SERVICE` / `dt.entity.service`.
- **Parameters:** entity selector (here `type("SERVICE"),tag("app:my-app")`).
- **Query:**

```dql
timeseries { total = sum(dt.service.request.count), failures = sum(dt.service.request.failure_count) }, filter: { in(dt.entity.service, classicEntitySelector("type(\"SERVICE\"),tag(\"app:my-app\")")) }
| fieldsAdd sli = (total[] - failures[]) / total[] * 100
| fieldsRemove total, failures
```

- **How it works:** identical to Q1. Grail has one failure count (from failure detection), so the classic distinction between server-side errors and all errors cannot be reproduced.
- **Output:** `sli` per interval.
- **Recipe notes shown:** "The classic metric counted client-side errors too; Grail has one failure count (failure detection), so values can be slightly higher."

### Q3 Service performance (response time threshold)

- **Source:** recipe `service-performance`, inline `build` with the regular expression `PERF_RE` ([slos.ts](../ui/app/slos.ts#L191)).
- **Matches:** `norm` (whitespace and `:splitBy(...)` removed, parentheses kept) must match

  ```text
  ^\(*builtin:service\.response\.time:avg:partition\("[^"]*",value\("good",lt\((\d+(?:\.\d+)?)\)\)\):count:default\(0\)\)\/\(builtin:service\.response\.time:avg:count\)\*\(100\)\)*(?::default\(100(?:\.0)?,always\))?$
  ```

  In words: any number of opening parentheses; `builtin:service.response.time:avg:partition("<any name>",value("good",lt(<number>))):count:default(0)`; a closing parenthesis; `/(builtin:service.response.time:avg:count)*(100)`; any number of closing parentheses; optionally `:default(100,always)` or `:default(100.0,always)`. The number inside `lt(...)` (digits with an optional decimal part) is the threshold, captured and reused. For example:
  `((builtin:service.response.time:avg:partition("latency",value("good",lt(1000000))):splitBy():count:default(0))/(builtin:service.response.time:avg:splitBy():count)*(100)):default(100,always)`.
  Other partition operators (`le`, `gt`, ...), another aggregation than `:avg`, or other transformations make it a manual upgrade.
- **Entity:** `SERVICE` / `dt.entity.service`.
- **Parameters:** entity selector (here `type("SERVICE"),entityId("SERVICE-0000000000000001")`); threshold (here `1000000`, microseconds, that is 1 s). A threshold of `lt(500000)` produces `rt[] < 500000`.
- **Query:**

```dql
timeseries rt = avg(dt.service.request.response_time), by: { dt.entity.service }, filter: { in(dt.entity.service, classicEntitySelector("type(\"SERVICE\"),entityId(\"SERVICE-0000000000000001\")")) }
| fieldsAdd good = iCollectArray(if(rt[] < 1000000, 1, else: 0)), counted = iCollectArray(if(isNull(rt[]), 0, else: 1))
| summarize { good = sum(good[]), counted = sum(counted[]) }, by: { timeframe, interval }
| fieldsAdd sli = 100 * good[] / counted[]
| fields timeframe, interval, sli
```

  Without an entity selector the first line is `timeseries rt = avg(dt.service.request.response_time), by: { dt.entity.service }`.
- **How it works:**
  - `timeseries rt = avg(dt.service.request.response_time), by: { dt.entity.service }, filter: {...}`: one series per service with the average response time (microseconds) per interval.
  - `fieldsAdd good = iCollectArray(if(rt[] < 1000000, 1, else: 0))`: `iCollectArray` builds a new array from an expression evaluated per element; `good` is 1 for every interval whose average response time is below the threshold and 0 otherwise. For an interval without data the comparison is null, and that element adds nothing to the sum below.
  - `counted = iCollectArray(if(isNull(rt[]), 0, else: 1))`: 1 for every interval that has data, 0 for gaps.
  - `summarize { good = sum(good[]), counted = sum(counted[]) }, by: { timeframe, interval }`: adds the per-service arrays element by element across all services. Grouping by `timeframe` and `interval` (identical for every series) keeps them in the result, so the output is still a time series: per interval, the number of services under the threshold and the number of services with data.
  - `fieldsAdd sli = 100 * good[] / counted[]`: percentage of (service, interval) data points under the threshold.
  - `fields timeframe, interval, sli`: keeps only what the SLO needs.
- **Output:** one record, `sli` per interval.
- **Recipe notes shown:** "Threshold kept in microseconds (both metrics use µs)." and "Classic counted 1-minute data points per service under the threshold; DQL counts data points at the query resolution, so the value can differ slightly."

### Q4 Browser monitor availability

- **Source:** recipe `synthetic-browser`, builder `avgOf("dt.synthetic.browser.availability")` ([slos.ts](../ui/app/slos.ts#L180)).
- **Matches:** `bare` equals `builtin:synthetic.browser.availability.location.total` or `builtin:synthetic.browser.availability.location.totalWoMaintenanceWindow`.
- **Entity:** `SYNTHETIC_TEST` / `dt.entity.synthetic_test`.
- **Parameters:** entity selector (here `type("SYNTHETIC_TEST"),entityId("SYNTHETIC_TEST-0000000000000001")`).
- **Query:**

```dql
timeseries sli = avg(dt.synthetic.browser.availability), filter: { in(dt.entity.synthetic_test, classicEntitySelector("type(\"SYNTHETIC_TEST\"),entityId(\"SYNTHETIC_TEST-0000000000000001\")")) }
```

  Without an entity selector: `timeseries sli = avg(dt.synthetic.browser.availability)`.
- **How it works:** one `timeseries` command that averages the browser monitor availability across every matching monitor and location per interval and names the result `sli` directly. No `by:`, so the result is one series. The value is used as the SLI as is, so it is treated as a percentage, like the classic availability metric.
- **Output:** `timeframe`, `interval`, `sli`.
- **Recipe notes shown:** "If the classic metric excluded maintenance windows (totalWoMaintenanceWindow), check the result during a maintenance window." The Grail metric is the same for both classic variants.

### Q5 HTTP monitor availability

- **Source:** recipe `synthetic-http`, builder `avgOf("dt.synthetic.http.availability")`.
- **Matches:** `bare` equals `builtin:synthetic.http.availability.location.total` or `builtin:synthetic.http.availability.location.totalWoMaintenanceWindow`.
- **Entity:** `HTTP_CHECK` / `dt.entity.http_check`.
- **Parameters:** entity selector (here `type("HTTP_CHECK"),entityId("HTTP_CHECK-0000000000000001")`).
- **Query:**

```dql
timeseries sli = avg(dt.synthetic.http.availability), filter: { in(dt.entity.http_check, classicEntitySelector("type(\"HTTP_CHECK\"),entityId(\"HTTP_CHECK-0000000000000001\")")) }
```

- **How it works:** as Q4, for HTTP monitors.
- **Output:** `timeframe`, `interval`, `sli`.
- **Recipe notes shown:** the same maintenance-window note as Q4.

### Q6 Host CPU usage

- **Source:** recipe `host-cpu`, builder `avgOf("dt.host.cpu.usage")`.
- **Matches:** `bare` equals exactly `builtin:host.cpu.usage` (for example `builtin:host.cpu.usage:splitBy()`). An explicit aggregation such as `builtin:host.cpu.usage:avg` does not match.
- **Entity:** `HOST` / `dt.entity.host`.
- **Parameters:** entity selector (here `type("HOST"),hostGroupName("my-host-group")`).
- **Query:**

```dql
timeseries sli = avg(dt.host.cpu.usage), filter: { in(dt.entity.host, classicEntitySelector("type(\"HOST\"),hostGroupName(\"my-host-group\")")) }
```

- **How it works:** average CPU usage (percent) across every matching host per interval, named `sli`.
- **Output:** `timeframe`, `interval`, `sli`.
- **Recipe notes shown:** none beyond the compare note.

### Q7 Host memory usage

- **Source:** recipe `host-memory`, builder `avgOf("dt.host.memory.usage")`.
- **Matches:** `bare` equals exactly `builtin:host.mem.usage`.
- **Entity:** `HOST` / `dt.entity.host`.
- **Parameters:** entity selector. This example has **no** entity selector, so there is no `filter:` clause and the plan carries the note "No entity selector: every entity with this metric is included."
- **Query:**

```dql
timeseries sli = avg(dt.host.memory.usage)
```

  With a selector, `, filter: { in(dt.entity.host, classicEntitySelector("...")) }` is appended, as in Q6.
- **How it works:** average memory usage (percent) across every host with the metric (or every matching host) per interval.
- **Output:** `timeframe`, `interval`, `sli`.

### Q8 Host disk used %

- **Source:** recipe `host-disk`, builder `avgOf("dt.host.disk.used.percent")`.
- **Matches:** `bare` equals exactly `builtin:host.disk.usedPct`.
- **Entity:** `HOST` / `dt.entity.host`.
- **Parameters:** entity selector (here `type("HOST"),entityId("HOST-0000000000000001")`).
- **Query:**

```dql
timeseries sli = avg(dt.host.disk.used.percent), filter: { in(dt.entity.host, classicEntitySelector("type(\"HOST\"),entityId(\"HOST-0000000000000001\")")) }
```

- **How it works:** average used-disk percentage across every disk of every matching host per interval (no `by:`, so disks are averaged together, as the classic `:splitBy()` did).
- **Output:** `timeframe`, `interval`, `sli`.

### Q9 Kubernetes namespace memory efficiency

- **Source:** recipe `k8s-namespace-memory`, builder `ratioOf("dt.kubernetes.container.memory_working_set", "dt.kubernetes.container.requests_memory", true)` ([slos.ts](../ui/app/slos.ts#L182)).
- **Matches:** ratio forms of `builtin:kubernetes.workload.memory_working_set` over `builtin:kubernetes.workload.requests_memory` (`100*A/B` or `A/B*100` after `bare` normalization).
- **Entity:** `CLOUD_APPLICATION_NAMESPACE` / `dt.entity.cloud_application_namespace`.
- **Parameters:** entity selector (here `type("CLOUD_APPLICATION_NAMESPACE"),entityName("my-namespace")`).
- **Query:**

```dql
timeseries { a = sum(dt.kubernetes.container.memory_working_set, rollup: avg), b = sum(dt.kubernetes.container.requests_memory, rollup: avg) }, filter: { in(dt.entity.cloud_application_namespace, classicEntitySelector("type(\"CLOUD_APPLICATION_NAMESPACE\"),entityName(\"my-namespace\")")) }
| fieldsAdd sli = a[] / b[] * 100
| fieldsRemove a, b
```

- **How it works:**
  - `sum(<metric>, rollup: avg)`: `rollup: avg` averages each container series within an interval first; `sum` then adds those averages across every container in the matching namespaces. `a` is the total working set memory, `b` the total memory requests, per interval.
  - `fieldsAdd sli = a[] / b[] * 100`: working set as a percentage of requests, per interval.
  - `fieldsRemove a, b`: leaves `timeframe`, `interval`, `sli`.
- **Output:** `sli` per interval.

### Q10 Kubernetes namespace CPU efficiency

- **Source:** recipe `k8s-namespace-cpu`, builder `ratioOf("dt.kubernetes.container.cpu_usage", "dt.kubernetes.container.requests_cpu", true)`.
- **Matches:** ratio forms of `builtin:kubernetes.workload.cpu_usage` over `builtin:kubernetes.workload.requests_cpu`.
- **Entity:** `CLOUD_APPLICATION_NAMESPACE` / `dt.entity.cloud_application_namespace`.
- **Parameters:** entity selector (here `type("CLOUD_APPLICATION_NAMESPACE"),entityName("my-namespace")`).
- **Query:**

```dql
timeseries { a = sum(dt.kubernetes.container.cpu_usage, rollup: avg), b = sum(dt.kubernetes.container.requests_cpu, rollup: avg) }, filter: { in(dt.entity.cloud_application_namespace, classicEntitySelector("type(\"CLOUD_APPLICATION_NAMESPACE\"),entityName(\"my-namespace\")")) }
| fieldsAdd sli = a[] / b[] * 100
| fieldsRemove a, b
```

- **How it works:** as Q9, with CPU usage over CPU requests.
- **Output:** `sli` per interval.

### Q11 Kubernetes cluster memory requests

- **Source:** recipe `k8s-cluster-memory`, builder `ratioOf("dt.kubernetes.container.requests_memory", "dt.kubernetes.node.memory_allocatable", true)`.
- **Matches:** ratio forms of `builtin:kubernetes.node.requests_memory` over `builtin:kubernetes.node.memory_allocatable`.
- **Entity:** `KUBERNETES_CLUSTER` / `dt.entity.kubernetes_cluster`.
- **Parameters:** entity selector (here `type("KUBERNETES_CLUSTER"),entityName("my-cluster")`).
- **Query:**

```dql
timeseries { a = sum(dt.kubernetes.container.requests_memory, rollup: avg), b = sum(dt.kubernetes.node.memory_allocatable, rollup: avg) }, filter: { in(dt.entity.kubernetes_cluster, classicEntitySelector("type(\"KUBERNETES_CLUSTER\"),entityName(\"my-cluster\")")) }
| fieldsAdd sli = a[] / b[] * 100
| fieldsRemove a, b
```

- **How it works:** `a` is the sum of container memory requests, `b` the sum of node allocatable memory, both restricted to the matching clusters; `sli` is requests as a percentage of allocatable memory per interval. The classic metric was node based (`builtin:kubernetes.node.requests_memory`); the Grail numerator is container based.
- **Output:** `sli` per interval.

### Q12 Kubernetes cluster CPU requests

- **Source:** recipe `k8s-cluster-cpu`, builder `ratioOf("dt.kubernetes.container.requests_cpu", "dt.kubernetes.node.cpu_allocatable", true)`.
- **Matches:** ratio forms of `builtin:kubernetes.node.requests_cpu` over `builtin:kubernetes.node.cpu_allocatable`.
- **Entity:** `KUBERNETES_CLUSTER` / `dt.entity.kubernetes_cluster`.
- **Parameters:** entity selector (here `type("KUBERNETES_CLUSTER"),entityName("my-cluster")`).
- **Query:**

```dql
timeseries { a = sum(dt.kubernetes.container.requests_cpu, rollup: avg), b = sum(dt.kubernetes.node.cpu_allocatable, rollup: avg) }, filter: { in(dt.entity.kubernetes_cluster, classicEntitySelector("type(\"KUBERNETES_CLUSTER\"),entityName(\"my-cluster\")")) }
| fieldsAdd sli = a[] / b[] * 100
| fieldsRemove a, b
```

- **How it works:** as Q11, with CPU requests over node allocatable CPU.
- **Output:** `sli` per interval.

### Client-side processing

**Matching classic SLOs to SLOs** (`matchSlos`, [slos.ts](../ui/app/slos.ts#L144)):

1. Build a map from SLO name to SLO. When several SLOs share a name, the one whose `externalId` equals `externalIdFor(name)` (created by this app) wins; otherwise the last one in the list wins.
2. For each classic SLO, `match` = the map entry with the same name (exact, case-sensitive), and `managed` = `match.externalId === externalIdFor(classic name)`.
3. The classic list is sorted by name (`localeCompare`) before matching, so every list on the tab is in name order.

**Recipe label** (`recipeLabel`): the label of the first matching recipe for a metric expression, or null. Used for the Conversion column, the Auto-convertible tile and button, the checkbox hints and AI Assist. It looks at the metric expression only.

**SLI preview value** (`previewSli`, [slos.ts](../ui/app/slos.ts#L393)):

1. Window: end = now; start = now minus the window length of the SLO's `timeframeFrom` (`windowMs`: `now-<n>m|h|d` converted to milliseconds; anything else falls back to 7 days).
2. Run the SLI query with that window as the default timeframe (the query has no `from:`), then poll while the state is `RUNNING` or `NOT_STARTED`.
3. If the final state is not `SUCCEEDED`: error "Query `<state in lower case>`." (for example "Query failed.").
4. Collect every number in every record's `sli` array (non-numeric and non-finite values, that is nulls, are skipped).
5. No records or no numbers: **no data** ("Query ran but returned no data for this window (entities not found or no data).").
6. Otherwise **ok**, value = arithmetic mean of all those numbers. This is a preview, not the SLO evaluation: the SLO service computes its own value from the same query.
7. An exception becomes **error** "Query failed: `<message>`" (the API's `error.message` plus any `constraintViolations` path and message).

**Classic value** (`evaluateClassic`, [slos.ts](../ui/app/slos.ts#L125)): for each classic SLO returned, value = `evaluatedPercentage` when `error === "NONE"` and `evaluatedPercentage >= 0`; otherwise no value and the `error` string is kept for display.

## API calls

| # | Method | Endpoint or SDK method | Scope | When |
| --- | --- | --- | --- | --- |
| A1 | GET | `serviceLevelObjectivesClient.getSlo` → `/platform/classic/environment-api/v2/slo` (list, not evaluated) | `environment-api:slo:read` | Tab mount; after an upgrade run |
| A2 | GET | `httpClient.send` → `/platform/slo/v1/slos` | `slo:slos:read` | Tab mount; after an upgrade run |
| A3 | GET | `serviceLevelObjectivesClient.getSlo` → `/platform/classic/environment-api/v2/slo` (evaluated, by ID) | `environment-api:slo:read` | Validate, 1 call per 25 planned SLOs |
| A4 | POST / GET | `queryExecutionClient.queryExecute` / `queryPoll` → `/platform/storage/query/v1/query:execute`, `query:poll` | `storage:metrics:read`, `storage:entities:read` | Validate, 1 query per planned SLO, 4 in parallel |
| A5 | POST | `/platform/slo/v1/slos` | `slo:slos:write` | Upgrade to SLOs, 1 per new SLO |
| A6 | PUT | `/platform/slo/v1/slos/{id}?optimistic-locking-version={version}` | `slo:slos:write` | Upgrade to SLOs, 1 per SLO created by this app earlier |
| A7 | POST | `/platform/slo/v1/slos/evaluation:start` | `slo:slos:read` | After the run, 1 per successfully created or updated SLO, 4 in parallel |
| A8 | GET | `/platform/slo/v1/slos/evaluation:poll` | `slo:slos:read` | After A7 when the result is not ready, up to 6 per SLO |
| A9 | (navigation) | `getIntentLink`, `sendIntent`, documentation links | none | Links in the table, results and validation lines |

### A1 List classic SLOs

- **Source:** `listClassicSlos` ([slos.ts](../ui/app/slos.ts#L86)), SDK `@dynatrace-sdk/client-classic-environment-v2`.
- **Request:** first page `GET /platform/classic/environment-api/v2/slo?pageSize=10000&evaluate=false&enabledSlos=all`; following pages `GET /platform/classic/environment-api/v2/slo?nextPageKey=<key>` (the API requires every other parameter to be omitted when `nextPageKey` is set). `evaluate=false` returns definitions without computing values, so one page can hold up to 10,000 SLOs; `enabledSlos=all` includes disabled SLOs.
- **Response fields used:** `slo[].id`, `name`, `enabled`, `metricExpression`, `filter` (entity selector), `target`, `warning`, `timeframe`, `metricName`, `description`; `nextPageKey` (loop until empty). Missing strings default to `""`.

### A2 List SLOs

- **Source:** `listNewSlos` ([slos.ts](../ui/app/slos.ts#L112)), `@dynatrace-sdk/http-client`.
- **Request:** `GET /platform/slo/v1/slos?page-size=500`, then `GET /platform/slo/v1/slos?page-key=<nextPageKey>` (URL-encoded) until `nextPageKey` is empty.
- **Response fields used:** `slos[].id`, `name`, `version` (needed for the optimistic-locking update), `externalId`; `nextPageKey`.

### A3 Evaluate classic SLOs (Validate)

- **Source:** `evaluateClassic` ([slos.ts](../ui/app/slos.ts#L125)).
- **Request:** for every chunk of 25 planned classic SLO IDs (chunks run one after another):
  `GET /platform/classic/environment-api/v2/slo?pageSize=25&sloSelector=id("<id1>","<id2>",...)&evaluate=true&enabledSlos=all` (query string URL-encoded by the SDK). Inside the selector, `~` and `"` in an ID are escaped with `~`. `evaluate=true` allows at most 25 per page, which is why the chunks are 25. No `timeFrame` is passed, so the API uses `CURRENT`: each SLO is evaluated over **its own** classic timeframe.
- **Response fields used:** `slo[].id`, `error`, `evaluatedPercentage`.
- **Failure:** if any chunk throws, Validate still shows the previews and an orange line "Classic values unavailable: `<message>`"; every classic value shows `—`.

### A4 Run the SLI preview query (Validate)

- **Source:** `previewSli` ([slos.ts](../ui/app/slos.ts#L393)), SDK `@dynatrace-sdk/client-query`.
- **Request:** `POST /platform/storage/query/v1/query:execute` with, for example:

```json
{
  "query": "timeseries sli = avg(dt.host.cpu.usage), filter: { in(dt.entity.host, classicEntitySelector(\"type(\\\"HOST\\\"),hostGroupName(\\\"my-host-group\\\")\")) }",
  "defaultTimeframeStart": "2026-10-24T12:00:00.000Z",
  "defaultTimeframeEnd": "2026-10-25T12:00:00.000Z",
  "requestTimeoutMilliseconds": 30000
}
```

  (here for a classic timeframe `-1d`, so the window is 24 hours). While the state is `RUNNING` or `NOT_STARTED`: `GET /platform/storage/query/v1/query:poll?request-token=<token>&request-timeout-milliseconds=30000`. There is no cap on the number of polls.
- **Response fields used:** `state`, `requestToken`, `result.records[].sli`.

### A5 Create an SLO

- **Source:** `upgradeOne` ([slos.ts](../ui/app/slos.ts#L423)), `httpClient.send` with `requestBodyType: "json"`.
- **Request:** `POST /platform/slo/v1/slos`, body as in [Classic SLO to SLO field mapping](#classic-slo-to-slo-field-mapping), for example:

```json
{
  "name": "Checkout availability",
  "description": "Upgraded from classic SLO \"Checkout availability\" by Architect Assistant.",
  "externalId": "architect-assistant-slo-ea1e6a2c",
  "tags": [
    "classic-slo:checkout_availability"
  ],
  "criteria": [
    {
      "timeframeFrom": "now-7d",
      "timeframeTo": "now",
      "target": 99.5,
      "warning": 99.8
    }
  ],
  "customSli": {
    "indicator": "timeseries { total = sum(dt.service.request.count), failures = sum(dt.service.request.failure_count) }, filter: { in(dt.entity.service, classicEntitySelector(\"type(\\\"SERVICE\\\"),entityId(\\\"SERVICE-0000000000000001\\\")\")) }\n| fieldsAdd sli = (total[] - failures[]) / total[] * 100\n| fieldsRemove total, failures"
  }
}
```

- **Response fields used:** `id` (the new SLO ID, used for the evaluation and the Open SLO link).
- **Result line:** "SLO created." or "Creation failed: `<message>`".

### A6 Update an SLO created by this app

- **Source:** `upgradeOne`.
- **Request:** `PUT /platform/slo/v1/slos/{id}?optimistic-locking-version={version}` (both URL-encoded), where `id` and `version` are those of the matching SLO as read by A2 when the tab loaded; the body has the same shape as A5 (all fields regenerated from the classic SLO). Example: `PUT /platform/slo/v1/slos/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee?optimistic-locking-version=<version>`.
- **Response fields used:** none (the ID is already known).
- **Result line:** "SLO updated (same ID)." or "Update failed: `<message>`".

### A7 Start SLO evaluation

- **Source:** `evaluateSlo` ([slos.ts](../ui/app/slos.ts#L456)).
- **Request:** `POST /platform/slo/v1/slos/evaluation:start` with `{ "id": "<SLO ID>", "requestTimeoutMilliseconds": 20000 }`.
- **Response fields used:** `evaluationResults[0].status`, `.value`, `.message` when the evaluation finished within the timeout; otherwise `evaluationToken` for A8.

### A8 Poll SLO evaluation

- **Request:** `GET /platform/slo/v1/slos/evaluation:poll?evaluation-token=<token>&request-timeout-milliseconds=10000`, repeated at most 6 times while there are no `evaluationResults` and there is a token.
- **Response fields used:** as A7. If there is still no result: status `PENDING` with "Evaluation did not finish; open the SLO to see it." Any exception: status `ERROR` with the API's error message.

### A9 Links and intents

| Where | Target | How |
| --- | --- | --- |
| Classic SLO name in the search table | The classic SLO in Service-Level Objectives Classic | `getIntentLink({ "slo.id": <id> }, "dynatrace.classic.slo", "view-slo")`, opened in a new tab |
| "Open SLO ↗" in the search table and in each successful result | The SLO in Service-Level Objectives | `getIntentLink({ "dt.slo.id": <id> }, "dynatrace.service.level.objectives", "view-slo")`, new tab |
| Open in Notebook / Add to Dashboard (validation lines) | Notebooks / Dashboards | `sendIntent({ "dt.query", "title" }, { recommendedAppId, recommendedIntentId })` with `view-query` / `add-to-dashboard` |
| Documentation for this fix | docs.dynatrace.com | Plain links (see [Documentation for this fix](#documentation-for-this-fix)) |

If an intent link cannot be built (`getIntentLink` throws), the name is shown without a link and the Open SLO link is left out. The intent IDs were read from the tenant with `dtctl get intent` (comment in [slos.ts](../ui/app/slos.ts#L66)).

## Remediation actions

### API: Upgrade classic SLOs to SLOs

`UpgradeForm` ([SlosTab.tsx](../ui/app/tabs/SlosTab.tsx#L187)).

**What it fixes:** classic SLOs without a Grail-based SLO. For each selected classic SLO it creates an SLO with the same name, target, warning and evaluation window, with an SLI generated from the metric expression and the entity selector kept through `classicEntitySelector()`. For classic SLOs this app upgraded before, it updates the existing SLO in place (same SLO ID). Classic SLOs are not changed or deleted.

**When it is offered:** always (it is the default action), as long as the data loaded. The intro text reads: "Creates an SLO with the same name, target, warning and evaluation window for each selected classic SLO. The SLI is generated from the metric expression (service availability and performance, synthetic availability, host and Kubernetes efficiency); the entity selector is kept with classicEntitySelector(). Other metric expressions need the manual upgrade. Classic SLOs are not changed or deleted."

#### Form fields

| Field | Options | Effect |
| --- | --- | --- |
| **Classic SLOs** (select) | **Not upgraded** (default): classic SLOs without a same-name SLO. **Upgraded by this app (update)**: classic SLOs whose same-name SLO was created by this app. **All**: every classic SLO | Defines the candidate list. Changing it clears the selection and any validation. |
| **Name contains** (text) | free text, placeholder "e.g. availability" | Filters the candidate list by name, case-insensitive. Applied as you type. It does not clear an existing validation. |

If there are no candidates: "Every classic SLO already has an SLO with the same name." (scope Not upgraded) or "No classic SLOs match." Otherwise:

- **Auto-convertible (`n`)**: selects exactly the candidates whose metric expression has a recipe (replaces the current selection).
- **All (`n`)**: selects every candidate.
- **Clear**: deselects all.
- A scrolling checkbox list (up to 240 px high) of the candidates, in name order. Each entry shows the name and a grey hint: the recipe label or "manual upgrade", then " · disabled" for disabled classic SLOs, then " · update" (same-name SLO created by this app) or " · SLO exists, not created by this app".

Every change of the selection (buttons or checkboxes) clears the validation, the confirmation and any results. Only selected classic SLOs that are in the current candidate list (scope and name filter) are used.

#### Validate

**Validate (`n`)** (disabled while busy or when nothing is selected; shows "Validating…" while it runs). Hint under it: "Validate runs each generated SLI query over the SLO's window and evaluates the classic SLO (one call per 25), so both values can be compared. Nothing is written."

Steps (`validate`, [SlosTab.tsx](../ui/app/tabs/SlosTab.tsx#L215)):

1. `planUpgrades(selected)`: plans every selected classic SLO in name order, applying the [planning rules](#checks-and-scoring). Classic SLOs that share a name after the first one in the selection are skipped.
2. For the planned ones, in parallel:
   - the SLI preview query per SLO ([A4](#a4-run-the-sli-preview-query-validate)), 4 at a time;
   - the classic evaluation ([A3](#a3-evaluate-classic-slos-validate)), 25 per call.
3. Shows one line per selected classic SLO.

Each validation line (left border colour as in [Checks and scoring](#checks-and-scoring)):

- Title: `<name> — create`, `<name> — update (same SLO ID)` or `<name> — skipped`.
- Skipped: the problem message.
- Planned:
  - `<recipe label> · target <t>[, warning <w>] · <timeframeFrom> to now`, for example "Service availability (server-side) · target 99.5, warning 99.8 · now-7d to now".
  - `Classic: <value> [(<error>)] · SLI preview (mean of data points): <value>`, values with two decimals and ` %`, or `—`.
  - The preview message when it is not ok (orange for no data, red for an error).
  - The plan notes as bullets (recipe notes, the no-selector note, the compare note).
  - Show DQL / Copy / Open in Notebook / Add to Dashboard for the SLI query.

Then:

- **Skip SLOs whose query returned no data (their SLO would show an error)** (checkbox, on by default). SLOs whose preview failed are always left out; SLOs with no data are left out while this is ticked. Changing it clears the confirmation.
- If at least one SLO remains:
  - **Request (1 API call per SLO: `c` new + `u` updated)**: a collapsible block with a Copy button showing the first request: a comment line `// POST /platform/slo/v1/slos` or `// PUT /platform/slo/v1/slos/<id>` and the JSON body. The comment line of a PUT does not show the `optimistic-locking-version` query parameter that the real request adds.
  - Confirmation checkbox: "Create `c` / update `u` SLO(s) (classic SLOs stay as they are)" (only the non-zero parts are shown).
  - **Upgrade to SLOs** (emphasized button), enabled only when the confirmation is ticked and nothing is running. While it runs: "`k` of `n` done…".
- Otherwise: "Nothing to create: every selected classic SLO was skipped."

#### Upgrade to SLOs

`run` ([SlosTab.tsx](../ui/app/tabs/SlosTab.tsx#L250)):

1. `upgradeSlos`: one request per SLO, **one at a time** (the API has no bulk create, and sequential calls report each failure separately): `POST` ([A5](#a5-create-an-slo)) for new SLOs, `PUT` ([A6](#a6-update-an-slo-created-by-this-app)) for SLOs this app created before. A failure does not stop the run; there is no rollback.
2. Shows the results; the confirmation checkbox is cleared.
3. For every successful result with an ID (created and updated), starts an SLO evaluation ([A7](#a7-start-slo-evaluation), [A8](#a8-poll-slo-evaluation)), 4 at a time, and shows it next to the classic value from Validate.
4. Reloads both SLO lists, so the tiles, gauge, search and candidate list reflect the new SLOs. The result lines stay on screen.

Each result line (green border when ok, red when failed):

- `<name>: SLO created.` / `SLO updated (same ID).` / `Creation failed: <message>` / `Update failed: <message>`.
- When ok: "Evaluating…" while the evaluation runs, then `New SLO: <status> [<value> %] [(<message>)] · Classic: <value>` (status as returned by the SLO service, or `PENDING` / `ERROR` set by the app).
- **Open SLO ↗** when the SLO ID is known.

After a successful run, the upgraded classic SLOs drop out of the **Not upgraded** scope and appear under **Upgraded by this app (update)**; running the form again on them sends `PUT` requests that regenerate every field of the SLO from the classic SLO.

### Classic SLO to SLO field mapping

`planUpgrade` ([slos.ts](../ui/app/slos.ts#L339)) builds the request body:

| SLO field | Source (classic) | Rule |
| --- | --- | --- |
| `name` | `name` | Copied unchanged. More than 200 characters: the SLO is skipped. |
| `description` | `description` | Trimmed. If empty: `Upgraded from classic SLO "<name>" by Architect Assistant.` Cut to 250 characters. |
| `externalId` | `name` | `architect-assistant-slo-<hash>`, see [externalId and tag scheme](#externalid-and-tag-scheme). |
| `tags` | `metricName` | `["classic-slo:<metricName>"]`; `[]` when the classic SLO has no metric name. |
| `criteria[0].timeframeFrom` | `timeframe` | Converted, see [Timeframe conversion](#timeframe-conversion). |
| `criteria[0].timeframeTo` | | Always `now`. |
| `criteria[0].target` | `target` | Copied. |
| `criteria[0].warning` | `warning` | Copied only when it is a finite number, greater than the target and at most 100; otherwise omitted. |
| `customSli.indicator` | `metricExpression`, `filter` | The generated SLI query (see [Queries](#queries)). |

Not carried over: the classic enabled flag (a disabled classic SLO is upgraded like an enabled one), the classic evaluation type, burn rate settings and any management zone context.

### Timeframe conversion

`toTimeframeFrom` ([slos.ts](../ui/app/slos.ts#L313)) accepts only a relative window that ends now, matching `^(?:now)?-(\d+)\s*(m|h|d|w)(?:\s*to\s*now)?$` (after trimming). Weeks are converted to days. Units are case-sensitive: `m` is minutes; `M` (months) is not accepted. Results (generated with the function):

| Classic timeframe | SLO criteria `timeframeFrom` (`timeframeTo` is `now`) |
| --- | --- |
| `-1w` | `now-7d` |
| `-4w` | `now-28d` |
| `-1w to now` | `now-7d` |
| `-14d to now` | `now-14d` |
| `now-2d` | `now-2d` |
| `-1d` | `now-1d` |
| `-7 d` | `now-7d` |
| `-2h` | `now-2h` |
| `-30m` | `now-30m` |
| `-1M`, `-1y` | not converted (manual) |
| `-1d/d`, `now-1w/w` (aligned) | not converted (manual) |
| `today`, `yesterday` | not converted (manual) |
| `-1h to -5m` (does not end now) | not converted (manual) |

Not converted means the plan is skipped as manual with "Timeframe "`<tf>`" is not a relative window ending now; set the criteria manually."

The same window is used for the SLI preview (`windowMs`): `now-<n>m|h|d` converted to milliseconds, falling back to 7 days for any other string.

### externalId and tag scheme

- **externalId:** `architect-assistant-slo-` followed by the 32-bit FNV-1a hash of the classic SLO name as 8 lower-case hex digits (`nameHash`, [slos.ts](../ui/app/slos.ts#L34)): start with `0x811c9dc5`; for every UTF-16 code unit of the name, XOR it in and multiply by `0x01000193` (32-bit); output unsigned, zero-padded. Examples: `Checkout availability` → `architect-assistant-slo-ea1e6a2c`; `My SLO` → `architect-assistant-slo-ed102d4b`.
- **Why:** the externalId marks an SLO as created by this app for that name. An SLO is treated as "created by this app" only when its `externalId` equals the value computed from its **current** name; such SLOs can be updated with `PUT`. SLOs with another or no externalId are never modified. The externalId must be unique per SLO, which is why only the first of several classic SLOs with the same name is upgraded.
- **Tag:** `classic-slo:<metricName>` records which classic SLO (by its metric name, for example `checkout_availability`) the SLO was generated from.

### Manual: Upgrade a classic SLO manually (Data Explorer converter)

`manualUpgradeAction` ([slos.ts](../ui/app/slos.ts#L477)), rendered by `ManualActionView` ([RemediationPanel.tsx](../ui/app/RemediationPanel.tsx#L148)). For classic SLOs the API action cannot convert (calculated or custom metrics, inline filters, Apdex, other entity types, non-relative timeframes). It makes no API call.

A code block (with Copy), **Entity selector to DQL**:

```text
// Keep the classic selector as is:
| filter in(dt.entity.service, classicEntitySelector("type(SERVICE),tag(\"criticality:Gold\")"))

// type(SERVICE)        -> by: { dt.entity.service }
// entityId("SERVICE-…") -> filter: { in(dt.entity.service, { "SERVICE-…" }) }
// mzName / mzId          -> use a segment (segments do not restrict access)
```

Steps:

1. In Service-Level Objectives Classic, open the SLO and select Actions > View in Data Explorer.
2. In Data Explorer, select Open with… > Add to notebook. The metric expression is converted to DQL.
3. In the notebook, name the last result field `sli` (required) and check the result.
4. In Service-Level Objectives, select Service-level objective > Custom SLO and paste the query into Custom DQL; Refresh shows the preview.
5. Under Criteria, set the same target, warning and evaluation period as the classic SLO.
6. Use the same name as the classic SLO so this tab counts it as upgraded, then save.

Notes (collapsible):

- Not every metric selector converts automatically; parents, smooth, lastReal and toUnit have no DQL equivalent, and rollup(count) / percentiles can differ.
- If a classic SLO came from a template, Dynatrace recommends reviewing the SLI rather than copying it one to one (business hours, key requests, segments).
- Run both SLOs for one evaluation period and compare the values before you retire the classic SLO.

A manually created SLO counts on the gauge as soon as its name equals the classic name. It is not "created by this app" (no matching externalId), so the API action will never update it.

### Documentation for this fix

Both actions show the same links (`SLO_DOCS`):

- [Upgrade from Service-Level Objectives Classic](https://docs.dynatrace.com/docs/platform/upgrade/keep-problems-and-alerting-working/service-level-objective-upgrade-classic)
- [Metric selector conversion](https://docs.dynatrace.com/docs/platform/upgrade/preserve-metrics-and-service-visibility/metrics/metric-selector-conversion)
- [Service-level objective templates](https://docs.dynatrace.com/docs/deliver/service-level-objectives/service-level-objective-templates)

## AI Assist on this page

`analyzeSlos` ([analyses.ts](../ui/app/analyses.ts#L356)). It is rule-based and runs locally in the browser on the data already loaded; it calls no AI service and no API. It is computed only while the panel is open. Input per classic SLO: name, upgraded (same-name SLO exists), managed (created by this app), convertible (a recipe matches the metric expression; selector type and timeframe are not checked) and enabled; plus the number of SLOs.

**No classic SLOs:**

- Summary: "No classic SLOs are defined in this environment" followed, when SLOs exist, by "; `n` SLO(s) already use the Grail-based Service-Level Objectives app", and a full stop.
- Insight (good): "Nothing to upgrade: new SLOs can be defined directly in DQL."
- Recommendation (low): "Start from the SLO templates (service availability, performance, host and Kubernetes efficiency) when you add SLOs."

**Otherwise:** with `p = Math.round(upgraded / total * 100)`, `missing` = not upgraded, `auto` = missing and convertible, `manual` = missing and not convertible, `disabled` = missing and disabled, `managed` = created by this app:

- Summary: "`upgraded` of `total` classic SLO(s) (`p`%) has/have an SLO with the same name; `managed` of those was/were created by this app."

| Insight | Condition | Severity | Text |
| --- | --- | --- | --- |
| Upgrade share | always | `good` if `p` >= 90, `warning` if `p` >= 50, else `critical` | "`p`% of classic SLOs are upgraded to Grail-based SLOs." |
| Auto-convertible | `auto` > 0 | info | "`auto` of the `missing` remaining SLO(s) use a metric expression this app converts automatically (service availability and performance, synthetic availability, host and Kubernetes efficiency)." |
| Manual | `manual` > 0 | warning | "`manual` need(s) a manual upgrade (calculated or custom metrics, inline filters, Apdex): " + the first three names, then ", …" if there are more. |
| Disabled | `disabled` > 0 | info | "`disabled` remaining classic SLO(s) is/are disabled; consider deleting instead of upgrading." |

| Recommendation | Condition | Impact |
| --- | --- | --- |
| "Use Upgrade classic SLOs: Validate runs each generated SLI query and shows the classic value next to it before anything is created." | `auto` > 0 | high |
| "For the rest, use Data Explorer's Open with > Notebook converter, rename the result to sli and keep the classic name so the gauge counts it." | `manual` > 0 | medium |
| "Run classic and new SLOs side by side for one evaluation period and compare before retiring the classic ones." | always | medium |
| "Upgraded SLOs keep the classic entity selector via classicEntitySelector(); replace it with segments or Smartscape filters over time." | `managed` > 0 | low |

## Limitations and edge cases

- **Name match only.** Upgraded means "an SLO with the identical name exists". A renamed SLO, a different capitalisation or trailing spaces count as not upgraded; an unrelated SLO that happens to share the name counts as upgraded.
- **Renaming an SLO created by this app** breaks the link both ways: the classic SLO counts as not upgraded again, and a new upgrade would send a `POST` with the same `externalId` as the renamed SLO, which the API can reject (externalIds are unique).
- **Hash collisions:** two different names with the same 32-bit FNV-1a hash would produce the same `externalId`. Unlikely, not handled.
- **Duplicate classic names:** only the first classic SLO of a name in the selection (name order, then API order) is planned; the rest are skipped. If you select only the second one of two same-name classic SLOs, it is planned and would create (or update) the SLO with its own query.
- **Auto-convertible is an upper bound.** The tile, the Conversion column, the checkbox hints, the **Auto-convertible** selection button and AI Assist only check the metric expression. Validate can still skip such SLOs because of the selector type, the timeframe, the name length or a foreign same-name SLO.
- **Selector type check is strict.** Every `type(...)` clause counts, including those inside relationship clauses (`fromRelationships...`, `toRelationships...`), so a service selector filtered by host is sent to the manual action even though `classicEntitySelector()` could resolve it. A selector without `type(...)` is accepted as is.
- **Recipe matching is literal.** Only the listed shapes match after removing whitespace, `:splitBy(...)` and (for most recipes) parentheses. Any other transformation (`:avg`, `:sum`, `:filter(...)`, `:default(...)` outside the performance shape, `:fold`, `:last`, units, calculated metrics) makes the SLO manual. `:splitBy(...)` is removed with a pattern that stops at the first `)`, which is enough for normal dimension lists.
- **No default value.** The classic performance template ends with `:default(100,always)`, so classic reports 100 % when there is no data; the generated DQL returns null for intervals without data. Expect differences during quiet periods.
- **Metric semantics differ slightly** (see the recipe notes): availability uses Grail's single failure count for both classic variants; performance counts data points at the query resolution instead of 1-minute points; synthetic availability does not distinguish maintenance windows; Kubernetes cluster requests are summed from containers.
- **Warning dropped** when it is not greater than the target or above 100. Classic SLOs on "lower is better" metrics (for example CPU usage) are converted with the same target semantics as in classic; review them.
- **Timeframe:** only relative windows ending now in minutes, hours, days or weeks; months, years, aligned and calendar timeframes need the manual criteria.
- **Preview vs evaluation:** the preview is the plain mean of all `sli` data points over the window, computed in the browser. The SLO service's evaluation (shown after the run) and the classic evaluation can differ from it. The classic value is computed over the classic SLO's own timeframe (`timeFrame` not set, so `CURRENT`).
- **Classic error display:** a classic SLO with `error` `NONE` but `evaluatedPercentage` -1 shows `— (NONE)`.
- **Validation is a snapshot.** Typing in **Name contains** after Validate does not clear the validation; the upgrade runs the validated plans, not the filtered list. Changing the scope or the selection does clear it.
- **Optimistic locking:** `PUT` uses the SLO `version` read when the tab loaded. If the SLO was changed in between, the update fails; the reload after the run fetches the new version.
- **Updates overwrite.** A `PUT` sends the whole regenerated body, so changes made to that SLO in the Service-Level Objectives app (query, criteria, description, tags) are replaced.
- **No rollback.** Writes are sequential; if one fails, the others still run.
- **Opening an SLI in a notebook:** the query has no `from:`, so the notebook's own timeframe applies, not the SLO window.
- **Not affected by the app timeframe:** the 24 hours / 7 days / 30 days select does nothing on this tab.
- **No paging limits on screen:** the search table and the candidate list show every matching classic SLO.

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| **Could not read SLOs** with a 403 / missing scope message | The app token lacks `environment-api:slo:read` or `slo:slos:read` (for example the dev server started before the scopes were added), or the user lacks the matching permission (`environment:roles:viewer` or `settings:objects:read` for classic SLOs; `slo:slos:read` for SLOs) | Restart `npx dt-app dev` and sign in again, or redeploy the app; ask an admin for the permissions. |
| Gauge 0 % and "0 of 0" | No classic SLOs in the environment | Nothing to upgrade; AI Assist says so. |
| A manually upgraded classic SLO is not counted | The SLO name is not identical to the classic name | Rename the SLO to the exact classic name. |
| Auto-convertible shows `n`, but Validate skips some as manual | Selector `type(...)` mismatch (often a relationship clause) or a timeframe such as `-1M`, `-1d/d`, `today` | Use the manual action for those; the message names the reason. |
| "An SLO with this name exists and was not created by this app; left unchanged." | A same-name SLO without this app's externalId | Nothing to do if it is the intended upgrade (it already counts). Otherwise rename or delete one of them. |
| "Classic values unavailable: ..." | The classic evaluation call failed (permission, timeout) | The previews are still valid; compare later in Service-Level Objectives Classic. |
| `Classic: — (NO_DATA)` or another code | The classic SLO itself cannot be evaluated | Check the classic SLO; the value is for comparison only. |
| Preview "Query failed: ..." (red), SLO not offered | Syntax or semantic error, for example an entity selector that `classicEntitySelector()` cannot parse, a metric not available, missing `storage:metrics:read` / `storage:entities:read` | Open the query with Show DQL / Open in Notebook and fix it in the manual flow. |
| Preview "Query ran but returned no data for this window" (orange) | The selector matches entities that no longer exist, or the metric has no data in the window | Check the entities; untick "Skip SLOs whose query returned no data" only if you want the SLO anyway (it will show an error until data arrives). |
| "Creation failed: ..." mentioning externalId | An SLO with the same externalId exists under another name (an SLO this app created and someone renamed) | Rename that SLO back to the classic name (then it is updated instead), or delete it. |
| "Creation failed / Update failed: ..." with a permission message | The user lacks `slo:slos:write` | Ask for the permission; Validate works without it. |
| "Update failed: ..." about the version | The SLO changed after the tab loaded | Run Validate and Upgrade again (the run reloads the lists). |
| `New SLO: PENDING (Evaluation did not finish; open the SLO to see it.)` | The evaluation took longer than 20 s plus 6 polls of up to 10 s | Use **Open SLO ↗**. |
| New SLO value differs from the classic value | Recipe semantics (see the notes on each validation line), different windows, no default 100 | Run both for one evaluation period and compare before retiring the classic SLO. |

## Related pages

- [Index](README.md): the app, its areas and shared controls.
- [Segments](segments.md): management zones to segments (replaces `mzName` / `mzId` in entity selectors).
- [Problem notifications](problem-notifications.md): the other classic-to-platform migration in this area.

## Source files

| File | Role on this page |
| --- | --- |
| [ui/app/tabs/SlosTab.tsx](../ui/app/tabs/SlosTab.tsx) | The tab: data loading (`useSloData`), tiles and gauge, classic SLO search (`SloSearch`), upgrade form (`UpgradeForm`), action picker (`SloActions`), AI Assist input. |
| [ui/app/slos.ts](../ui/app/slos.ts) | Classic and platform SLO API calls, name matching, conversion recipes, timeframe conversion, externalId hash, upgrade plan and request body, SLI preview, create / update, SLO evaluation, manual action, documentation links. |
| [ui/app/analyses.ts](../ui/app/analyses.ts#L356) | `analyzeSlos`: AI Assist summary, insights and recommendations. |
| [ui/app/components.tsx](../ui/app/components.tsx) | `PctGauge`, `ScoreTile`, `pct`, `ShowEntitiesButton`, `QueryActions` (Show DQL / Copy / Open in Notebook / Add to Dashboard). |
| [ui/app/RemediationPanel.tsx](../ui/app/RemediationPanel.tsx) | Shared form helpers used here: `Field`, `Links`, `Request`, `ManualActionView`. |
| [ui/app/AIInsights.tsx](../ui/app/AIInsights.tsx) | `useAIInsights`: AI Assist panel. |
| [ui/app/areas.tsx](../ui/app/areas.tsx) | Tab id `slos`, title "SLOs", area Migration Assistance, documentation link. |
| [ui/app/App.tsx](../ui/app/App.tsx) | Renders `<SlosTab />` (without the timeframe). |
| [app.config.json](../app.config.json) | Scopes `environment-api:slo:read`, `slo:slos:read`, `slo:slos:write`, and the storage scopes used by the preview. |
