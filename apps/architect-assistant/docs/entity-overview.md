# Entity Overview

Entity Overview is the landing page of Architect Assistant. It answers one question for the whole tenant: how much of the onboarding metadata that Dynatrace best practices expect is actually in place? It scores five primary fields (security context, cost center, cost product, host group, ownership team) on nine Smartscape entity types and adds a frontend readiness score for web frontends. It then shows an Overall readiness gauge, one gauge per best practice, a ranked list of the five biggest gaps (each linked to the tab that fixes it), one gauge card per entity type, and a Frontends section. This page reads data only. Fixes happen on the tabs it links to.

| | |
| --- | --- |
| Area | Metadata (see [index](README.md)) |
| Tab id | `overview` |
| Counts toward Entity Overview readiness / Top findings | This page computes them. Every entity-type × field check (up to 36) and one frontend readiness check count toward Overall readiness. Every entity check and every frontend check below 100% competes for Top 5 findings. |
| Main source files | [CoverageTabs.tsx](../ui/app/tabs/CoverageTabs.tsx), [queries.ts](../ui/app/queries.ts), [frontends.ts](../ui/app/frontends.ts), [FrontendsTab.tsx](../ui/app/tabs/FrontendsTab.tsx), [App.tsx](../ui/app/App.tsx), [analyses.ts](../ui/app/analyses.ts) |

## Contents

- [What this page answers](#what-this-page-answers)
- [Before you start](#before-you-start)
- [Page walkthrough](#page-walkthrough)
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

- How ready is this tenant overall? See **Overall readiness**: the unweighted mean of every check on the page.
- For each best practice, how widely is it adopted across entity types? See the five per-best-practice gauges.
- Which gaps matter most, and where are they fixed? See **Top 5 findings**: gaps ranked first by entity importance (hosts, Kubernetes nodes, Kubernetes clusters, then frontends, then containers, Kubernetes objects, processes and services) and then by gap size weighted by population. Each finding has a button that opens the tab that fixes it.
- For each entity type, which fields are present and on how many entities? See **Adoption by entity type**.
- How ready are the web frontends (RUM v2, Session Replay on Grail, synthetic monitors, user tagging, health alerts, owning team)? See the **Frontends** section and the **Frontend overall readiness** gauge.

Best practices checked on Smartscape entities. Each field and its "in place" predicate come from `PRIMARY_FIELDS` in [queries.ts](../ui/app/queries.ts#L57):

| Best practice | Grail field | In place when | Why it matters |
| --- | --- | --- | --- |
| Security context | `dt.security_context` | `arraySize(dt.security_context) > 0` | Drives data access (IAM policy boundaries) and security-team ownership. |
| Cost center | `dt.cost.costcenter` | `isNotNull(dt.cost.costcenter)` | Attributes consumption and cost to a cost center. |
| Cost product | `dt.cost.product` | `isNotNull(dt.cost.product)` | Attributes consumption and cost to a product. |
| Host group | `dt.host_group.id` | `isNotNull(dt.host_group.id)` | A host-level attribute that processes and containers inherit. It lets settings and ownership be applied per deployment unit. |
| Ownership team | an owner key `dt.owner`, `owner` or `team` in host properties, process metadata, or Kubernetes labels / annotations | the coalesced value is not null | Routes problems and responsibility to a team. The keys come from the tenant's `builtin:ownership.config` (comment in queries.ts). |

Dynatrace documentation the app cites for these fixes ([remediation.ts](../ui/app/remediation.ts#L413)):
[Primary Grail fields and tags](https://docs.dynatrace.com/docs/manage/tags/primary-tags),
[OneAgent primary tags](https://docs.dynatrace.com/docs/manage/tags/primary-tags/tags-domain-oneagent),
[Kubernetes primary tags](https://docs.dynatrace.com/docs/manage/tags/primary-tags/tags-domain-k8s),
[Ingest enrichment rules](https://docs.dynatrace.com/docs/manage/tags/tags-central-enrichment),
[oneagentctl reference](https://docs.dynatrace.com/docs/ingest-from/dynatrace-oneagent/oneagent-configuration-via-command-line-interface),
[Remote configuration management](https://docs.dynatrace.com/docs/ingest-from/bulk-configuration),
[Assign ownership teams to Smartscape nodes](https://docs.dynatrace.com/docs/deliver/ownership/assign-team-ownership),
[Assign ownership teams to monitored entities](https://docs.dynatrace.com/docs/deliver/ownership/ownership-classic/assign-ownership),
[Best practices for entity ownership](https://docs.dynatrace.com/docs/deliver/ownership/best-practices).
For frontends ([frontendActions.ts](../ui/app/frontendActions.ts#L13)):
[Enable the New RUM Experience for RUM Classic web applications](https://docs.dynatrace.com/docs/observe/digital-experience/new-rum-experience/web-frontends/initial-setup/enable-new-rum-for-web-apps),
[Activate Session Replay for web frontends](https://docs.dynatrace.com/docs/observe/digital-experience/session-replay-latest/configure-session-replay-web/latest-enable-session-replay-web),
[Health alerts for frontends](https://docs.dynatrace.com/docs/observe/digital-experience/new-rum-experience/analyze-and-alert/health-alerts),
[Tag specific users for web applications](https://docs.dynatrace.com/docs/observe/digital-experience/web-applications/additional-configuration/identify-individual-users-for-session-analysis).

## Before you start

### App scopes used by this page

| Scope | What this page uses it for |
| --- | --- |
| `storage:smartscape:read` | The primary field coverage query (`smartscapeNodes` over nine entity types). |
| `storage:entities:read` | The frontends query: classic entity tables `dt.entity.application`, `dt.entity.synthetic_test`, `dt.entity.http_check`, `dt.entity.external_synthetic_test`. |
| `settings:objects:read` | Reads `builtin:rum.web.enablement` (RUM and Session Replay enablement) and `builtin:health-experience.frontend-alert` (frontend health alerts). |
| `environment-api:credentials:read` | Used by the `user-tags` app function to read the ReadConfig API token from the credential vault. The function needs that token to count user tag rules. |

The Show DQL / Copy / Open in Notebook / Add to Dashboard buttons open other apps through intents (`sendIntent`) and need no scope. This page uses no write scope.

### User permissions

App scopes do not grant more than the signed-in user has. The user's own policies must also allow:

- reading Smartscape nodes and classic entities (`storage:smartscape:read`, `storage:entities:read`) for the entities to be counted;
- reading settings objects of the two frontend schemas. The SDK documents "environment:roles:manage-settings or settings:objects:read" for `GET /settings/objects`. When objects exist but the user cannot access them, the Settings API returns no items instead of an error.
- the credential vault calls inside `user-tags`. The SDK documents `environment:roles:viewer` for listing and reading credentials. The credential must not be owner-only for another user.
- access to the Notebooks and Dashboards apps, to use the intent buttons.

No write permission is needed.

### One-time setup

None is needed for the entity checks. One optional setup affects the frontend score:

- **User tagging token.** User tag rules are only available from the classic Config API v1. To measure them:
  1. Create an API token with the **Read configuration** (`ReadConfig`) scope.
  2. In the credential vault, store it as a **Token** credential named `architect-assistant-readconfig` with the **App Engine** scope. Do not make it owner-only if other users should be scored too.
  3. If the allowed outbound connections list (`builtin:dt-javascript-runtime.allowed-outbound-connections`) is enforced, add the classic host to it (`<env>.live.dynatrace.com`, derived as described in [API calls](#api-calls)).

  The app can also do steps 1 and 2: **Frontends › Actions › Set up the user tagging token** (see [frontends.md](frontends.md)). Until the token exists, *User tagging configured* shows *Not measured* and is left out of every frontend average.

## Page walkthrough

### Shell around the page

The shell is provided by [App.tsx](../ui/app/App.tsx). The heading is "Architect Assistant", followed by "Onboarding best practices: what is in place vs missing in this tenant." When the timeframe is not 24 hours, a second line is added: "Longer timeframes also count entities that existed earlier in the window, including decommissioned ones." On the right are the **AI Assist** toggle and the timeframe select: *Last 24 hours* (default), *Last 7 days*, *Last 30 days* (`TIMEFRAMES`, [queries.ts](../ui/app/queries.ts#L7)). Below them is the area picker. *Metadata* is selected at start and Entity Overview is its first tab, so it is the landing page. A right-aligned link "Entity Overview documentation" above the tab content opens this page on GitHub.

Both data sources of this page start loading when the app opens, whichever tab is shown: `useDql(coverageQuery(tf))` ([App.tsx](../ui/app/App.tsx#L52)) and `useFrontendsData(tf)` ([App.tsx](../ui/app/App.tsx#L54)). They are shared with the Security context, Cost allocation, Ownership & Teams, Host groups and Frontends tabs, so changing tabs does not re-run them. Changing the timeframe changes the query text, and both DQL queries re-run.

### Loading and error states

The whole tab body is wrapped in `QueryState` with the coverage query state ([components.tsx](../ui/app/components.tsx#L162)):

- **Coverage query failed:** a critical message "Query failed" with the error text. Nothing else on the tab renders, including the Frontends section.
- **Coverage query running with no result yet:** "Loading…" only.
- **Result in:** the sections below, in this order: AI Assist panel (if open), summary row, Top 5 findings, "Adoption by entity type", entity cards, the coverage query actions, the Frontends section.

### Summary row

One card with gauges on a single wrapping row ([CoverageTabs.tsx](../ui/app/tabs/CoverageTabs.tsx#L229)). These gauges are 25% smaller than the ones further down so the row fits on one line: Overall readiness is 179 px wide, the others 141 px (`SUMMARY_OVERALL_SIZE`, `SUMMARY_GAUGE_SIZE`).

First, the check rows are built from the coverage result (`toCoverageRows`, see [Client-side post-processing](#client-side-post-processing)). Each row is one entity type × one applicable field, with `pct = round(part / total × 100)`.

| Gauge | Value | Detail line | (i) button |
| --- | --- | --- | --- |
| **Overall readiness** | `round(mean(all row pcts + [frontendPct]))`. Every check weighs the same, whatever its entity count. `frontendPct` is only included when it is not null (see below). With no checks the value is 0. | "`N` checks" (always plural) | none |
| **Security context** | `round(mean of the Security context row pcts)` over the entity types that have entities (up to 9) | "avg of `N` checks" ("check" when N = 1) | Opens Security context › Remediation actions |
| **Cost center** | same, over up to 9 types | same | Opens Cost allocation › Remediation actions |
| **Cost product** | same, over up to 9 types | same | Opens Cost allocation › Remediation actions |
| **Host group** | same, over Hosts, Processes, Containers (up to 3) | same | Opens Host groups › Remediation actions |
| **Ownership team** | same, over Hosts, Processes, Kubernetes namespaces, nodes, deployments, pods (up to 6) | same | Opens Ownership & Teams › Remediation actions |
| **Frontend overall readiness** | `frontendPct = round(mean of every frontend's score)`. A frontend's score is the mean of its measured frontend checks. Shown only when `frontendPct` is not null. | "avg of `N` frontends" ("frontend" when N = 1) | Opens the Frontends tab, at the top (label "Open the Frontends tab") |

`frontendPct` is null, and the Frontend overall readiness gauge, its contribution to Overall readiness and the frontend findings are all absent, while frontend data is still loading, when reading the frontend settings failed (`settingsError`), or when no frontends were found ([CoverageTabs.tsx](../ui/app/tabs/CoverageTabs.tsx#L274)). Overall readiness is recomputed as frontend data arrives. It can change once more when the user tag rules return, because *User tagging configured* then moves from not measured to measured.

A best-practice gauge is omitted when none of its entity types has entities (for example, no Host group gauge in a tenant without hosts, processes or containers). The per-best-practice gauges contain entity checks only. The frontend owner check, for example, is not part of the Ownership team gauge. It is part of Frontend readiness.

The (i) buttons on the five best-practice gauges have the tooltip and accessible label "Open remediation steps" (aria-label "Open remediation steps: Security context" and so on). They call `goToRemediation(target)` with the mapping in `REMEDIATION_TARGET` ([CoverageTabs.tsx](../ui/app/tabs/CoverageTabs.tsx#L131)). For what happens on click, see [Remediation actions](#remediation-actions).

**Worked example** (illustrative numbers, computed with the app's own functions). Hosts 120, processes 2,400, services 800, containers 600, no Kubernetes. Hosts have every field except ownership on 90 of 120 (75%). Processes have every field except ownership (0%). Services have no security context (0%). Containers have a cost center on 300 (50%) and a cost product on 450 (75%). Three frontends score 100, 25 and 83, so `frontendPct` = round(208 / 3) = 69.

- Checks: hosts 5 + processes 5 + services 3 + containers 4 = 17 entity checks, + 1 frontend = **18 checks**.
- Overall readiness = round((475 + 400 + 200 + 325 + 69) / 18) = round(81.6) = **82%**.
- Security context = round((100 + 100 + 0 + 100) / 4) = 75%. Cost center = round(350 / 4) = 88%. Cost product = round(375 / 4) = 94%. Host group = 100% (3 checks). Ownership team = round((75 + 0) / 2) = 38% (2 checks).

### Top 5 findings

A card titled "Top 5 findings" with the subtitle "The biggest best-practice gaps, ranked by entity importance (hosts, nodes and clusters first, then frontends, then the entities running on them) and then by size." ([CoverageTabs.tsx](../ui/app/tabs/CoverageTabs.tsx#L196)).

Each finding is one row with:

- the position (1 to 5);
- a sentence (templates below);
- the percentage, coloured with `statusColor(pct)`, plus a 4 px left border in the same colour;
- a **Remediation steps →** button (aria-label "Open remediation steps: <tab title>").

When no check is below 100%, the card shows "No gaps found — every check is fully in place."

#### Candidate rows

The candidates are the entity check rows plus one row per frontend check (`frontendFindingRows`, [CoverageTabs.tsx](../ui/app/tabs/CoverageTabs.tsx#L163)). Frontend rows are only added when `frontendPct` is not null. For each of the six frontend checks:

- `total` = number of frontends where the check was measured (score not null). A check measured on no frontend produces no row, which in practice means user tagging without a token.
- `part` = number of those frontends scoring exactly 100.
- `pct` = round(mean of their scores). RUM and Session Replay can score 50 (classic only), so `pct` can be higher than `part / total`.

#### Ranking algorithm (`topFindings`, [CoverageTabs.tsx](../ui/app/tabs/CoverageTabs.tsx#L172))

1. **Keep gaps only:** rows with `pct < 100`.
2. **Gap score:** `score = (100 − pct) × log10(total + 10)`. The gap in percentage points is weighted by the logarithm of the population, so a larger population raises the score but much less than proportionally. Examples: total 3 gives a factor of 1.11, 24 gives 1.53, 120 gives 2.11, 2,400 gives 3.38.
3. **Sort:** first by entity importance `RANK` ascending, then by `score` descending. JavaScript's sort is stable, so ties keep input order: entity rows in `ENTITY_TYPES` × field order (security, cost center, cost product, host group, owner), then frontend rows in check order (RUM, Session Replay, synthetics, user tagging, health alerts, owner).

   | Rank | Entity type |
   | --- | --- |
   | 0 | Hosts (`HOST`) |
   | 1 | Kubernetes nodes (`K8S_NODE`) |
   | 2 | Kubernetes clusters (`K8S_CLUSTER`) |
   | 2.5 | Frontends (all six frontend checks share this type) |
   | 3 | Containers (`CONTAINER`) |
   | 4 | Kubernetes namespaces, deployments, pods (equal rank, interleaved by score) |
   | 5 | Processes, services (equal rank, interleaved by score) |

   The code comment gives the reason: infrastructure the customer owns comes first, then containers, then the objects and processes running on it. Frontends rank after hosts, nodes and clusters and before the entities running on them.
4. **Cap per type:** walk the sorted list and skip a row when its entity type already has 2 findings. All frontend checks count as one type, so at most 2 frontend findings appear.
5. **Stop at 5 findings.**

Rank comes before size, so a small gap on a high-rank type always beats a large gap on a lower-rank type. For example, 75% host ownership ranks above 0% process ownership on 2,400 processes. Frontend findings only appear when hosts, Kubernetes nodes and Kubernetes clusters together produce fewer than 5 findings. Container, Kubernetes object, process and service findings only appear when the earlier types leave slots free.

#### Sentence templates

- `pct = 0`: "None of the `<total>` `<noun>` have `<what>`."
- otherwise: "Only `<pct>`% of `<noun>` have `<what>` (`<part>` of `<total>`)."

`<noun>` is the plural from `ENTITY_LABELS` (hosts, processes, services, containers, Kubernetes clusters / nodes / namespaces / deployments / pods), or "frontends". Numbers use the browser locale's thousands separator. `<what>`:

| Check | Phrase |
| --- | --- |
| Security context | a security context |
| Cost center | a cost center |
| Cost product | a cost product |
| Host group | a host group |
| Ownership team | an ownership team |
| Frontend RUM | RUM v2 enabled |
| Frontend Session Replay | Session Replay on Grail enabled |
| Frontend synthetics | synthetic monitors assigned |
| Frontend user tagging | user tagging configured |
| Frontend health alerts | health alerts configured |
| Frontend owner | an owning team |

#### Button targets

| Finding on | Remediation steps → opens |
| --- | --- |
| Security context | Security context tab, scrolled to Remediation actions |
| Cost center, Cost product | Cost allocation tab, scrolled to Remediation actions |
| Host group | Host groups tab, scrolled to Remediation actions |
| Ownership team | Ownership & Teams tab, scrolled to Remediation actions |
| Any frontend check | Frontends tab (area switches to Visibility), at the top. Unlike the frontend gauges' (i) buttons, this button does not scroll to Actions. |

#### Worked examples

Example A (Kubernetes present; numbers illustrative). Gap candidates in sorted order:

| Order | Type (rank) | Check | pct | total | score | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Hosts (0) | Ownership team | 0 | 120 | 211.4 | finding 1 |
| 2 | Hosts (0) | Security context | 25 | 120 | 158.5 | finding 2 |
| 3 | Hosts (0) | Cost product | 80 | 120 | 42.3 | skipped (2 per type) |
| 4 | Hosts (0) | Host group | 90 | 120 | 21.1 | skipped |
| 5 | K8s nodes (1) | Ownership team | 50 | 24 | 76.6 | finding 3 |
| 6 | K8s clusters (2) | Cost center | 0 | 3 | 111.4 | finding 4 |
| 7 | K8s clusters (2) | Cost product | 0 | 3 | 111.4 | finding 5 (tie, input order) |
| – | Frontends (2.5), processes (5) with 0% ownership on 2,400, … | | | | | not reached |

Displayed:
1. None of the 120 hosts have an ownership team.
2. Only 25% of hosts have a security context (30 of 120).
3. Only 50% of Kubernetes nodes have an ownership team (12 of 24).
4. None of the 3 Kubernetes clusters have a cost center.
5. None of the 3 Kubernetes clusters have a cost product.

Example B (the worked example from the summary row, no Kubernetes). Frontend rows: RUM 83% (2 of 3), Session Replay 33%, synthetics 67%, user tagging 67%, health alerts 67%. The owner check is at 100%, so it is not a gap. Displayed:
1. Only 75% of hosts have an ownership team (90 of 120).
2. Only 33% of frontends have Session Replay on Grail enabled (1 of 3).
3. Only 67% of frontends have synthetic monitors assigned (2 of 3). This beats user tagging and health alerts, which have the same score, by check order.
4. Only 50% of containers have a cost center (300 of 600).
5. Only 75% of containers have a cost product (450 of 600).

Processes with 0% ownership (2,400) and services with 0% security context (800) are not listed because of their rank.

### Adoption by entity type

A heading "Adoption by entity type" followed by one card per entity type that has at least one entity (`EntityGaugeSections`, [CoverageTabs.tsx](../ui/app/tabs/CoverageTabs.tsx#L67)). Cards appear in `ENTITY_TYPES` order. Within a card, gauges appear in field order and only for the fields that apply (`fieldApplies`, [queries.ts](../ui/app/queries.ts#L69)):

| Card | Gauges |
| --- | --- |
| Hosts | Security context, Cost center, Cost product, Host group, Ownership team |
| Processes | Security context, Cost center, Cost product, Host group, Ownership team |
| Services | Security context, Cost center, Cost product |
| Containers | Security context, Cost center, Cost product, Host group |
| Kubernetes clusters | Security context, Cost center, Cost product |
| Kubernetes nodes | Security context, Cost center, Cost product, Ownership team |
| Kubernetes namespaces | Security context, Cost center, Cost product, Ownership team |
| Kubernetes deployments | Security context, Cost center, Cost product, Ownership team |
| Kubernetes pods | Security context, Cost center, Cost product, Ownership team |

Each gauge (188 px):

- value: `round(part / total × 100)`;
- caption: the field label;
- detail: "`part` of `total`" (locale-formatted);
- (i) button with the same remediation target as the summary gauge of that field.

A type that is missing from the result, or has `total = 0`, gets no card. When no type has entities the section shows "No entities found for this timeframe."

Ownership is not scored on services, containers and Kubernetes clusters because they carry no label or property map (`OWNER_TYPES`). Host group is only scored on hosts and on the processes and containers that inherit it (`HOST_GROUP_TYPES`).

### Primary field coverage query actions

Below the cards, the `QueryActions` bar for [Q1](#q1-primary-field-coverage) titled "Primary field coverage" ([components.tsx](../ui/app/components.tsx#L200)):

- **Show DQL / Hide DQL:** toggles a preformatted block with the exact query for the current timeframe.
- **Copy:** writes the query to the clipboard. The label shows "Copied" for 1.5 s.
- **↗ Open in Notebook:** `sendIntent({"dt.query": <query>, "title": "Primary field coverage"}, {recommendedAppId: "dynatrace.notebooks", recommendedIntentId: "view-query"})`.
- **↗ Add to Dashboard:** same payload, `recommendedAppId: "dynatrace.dashboards"`, `recommendedIntentId: "add-to-dashboard"`.

### Frontends

The last section, rendered by `FrontendsOverviewCard` ([FrontendsTab.tsx](../ui/app/tabs/FrontendsTab.tsx#L270)):

- heading "Frontends";
- grey text "Web frontends (RUM applications): RUM, Session Replay, synthetic monitors, user tagging, health alerts and ownership.";
- one of the following:
  - frontend settings could not be read: the error text in red;
  - frontend data is loading: "Loading frontends…";
  - no frontends: "No frontends found for this timeframe.";
  - otherwise: the six frontend check gauges described below. They use the same scoring as the Frontends tab, without its own Overall readiness gauge, which appears here in the summary row as *Frontend overall readiness*.
- a `QueryActions` bar titled "Frontends" for [Q2](#q2-web-frontends-and-assigned-synthetic-monitors). It is always shown, also when the section has no data.

The frontend check gauges (`FrontendsSummary` with `showOverall={false}`, [FrontendsTab.tsx](../ui/app/tabs/FrontendsTab.tsx#L98)) are 141 px wide and appear in this order:

| Gauge | Value | Detail line |
| --- | --- | --- |
| RUM v2 enabled | round(mean of per-frontend RUM scores: 100 / 50 / 0) | "`a` v2, `b` classic only" (a = frontends at 100, b = at 50) |
| Session Replay enabled | round(mean of Session Replay scores: 100 / 50 / 0) | "`a` on Grail, `b` classic only" |
| Synthetic monitors assigned | round(mean of 100 / 0) | "`a` of `n` frontends pass" |
| User tagging configured | round(mean over the frontends where it was measured) | "`a` of `n` frontends pass" |
| Health alerts configured | round(mean of 100 / 0) | "`a` of `n` frontends pass" |
| Owning team assigned | round(mean of 100 / 0) | "`a` of `n` frontends pass" |

When a check was measured on no frontend, a dashed placeholder reading "Not measured" replaces its gauge, with the caption and "no data for any frontend". This is normal for user tagging without the token, and also while the `user-tags` function is still running. Every real gauge has an (i) button labelled "Open remediation actions". It calls `goToFrontends(true)`, which opens the Frontends tab and scrolls to its **Actions** section. The per-frontend scoring rules are in [Checks and scoring](#checks-and-scoring). The full Frontends tab is documented in [frontends.md](frontends.md).

### How a gauge is drawn

`PctGauge` ([components.tsx](../ui/app/components.tsx#L69)) is a custom SVG. It draws a 240° arc open at the bottom, with a grey track and a filled arc of 80 segments. Each segment is coloured by its position on the scale with `statusColor`, a continuous HSL ramp: hue = round(p × 1.25), saturation 78%, lightness 46%. The ramp runs from #d11a1a at 0% through #c8d11a at 50% to #1ad129 at 100%. The fill length is clamped to 0–100. The centre shows the number followed by " %". The accessible label is "`caption`: `value`% (`detail`)". The (i) button sits in the top-right corner. The page has no discrete colour thresholds: colour is a direct function of the percentage.

## Checks and scoring

`pct(part, total) = total > 0 ? Math.round(part / total × 100) : 0` ([components.tsx](../ui/app/components.tsx#L31)). `Math.round` rounds .5 up.

### Entity checks (from Q1)

| Check | Applies to | In place when | Numerator | Denominator | Notes |
| --- | --- | --- | --- | --- | --- |
| Security context | all 9 types | `arraySize(dt.security_context) > 0` | `security` column | `total` | Null or empty array = missing |
| Cost center | all 9 types | `isNotNull(dt.cost.costcenter)` | `costcenter` | `total` | |
| Cost product | all 9 types | `isNotNull(dt.cost.product)` | `product` | `total` | |
| Host group | HOST, PROCESS, CONTAINER | `isNotNull(dt.host_group.id)` | `hostgroup` | `total` | Counted for every type in the query, scored only for these three |
| Ownership team | HOST, PROCESS, K8S_NAMESPACE, K8S_NODE, K8S_DEPLOYMENT, K8S_POD | `isNotNull(coalesce(…12 map lookups…))` | `owner` | `total` | Any value counts. The value is not checked against existing teams. |

Up to 36 entity checks: 9 × 3 + 3 + 6.

### Frontend checks (per frontend, from Q2 + Settings API + `user-tags`)

`scoreFrontend` in [frontends.ts](../ui/app/frontends.ts#L78). The effective enablement object is the frontend's own `builtin:rum.web.enablement` object (scope = its `APPLICATION-…` ID). If it has none, the environment-scope object is used. If that is missing too, `{}` is used and everything counts as off.

| Check | 100 when | 50 when | 0 otherwise | Not measured (null) |
| --- | --- | --- | --- | --- |
| RUM v2 enabled | `rum.enabled` and `rum.enabledOnGrail` | `rum.enabled` only | | never |
| Session Replay enabled | `rum.enabled` and `sessionReplay.enabled` and `sessionReplay.enabledOnGrail` | `rum.enabled` and `sessionReplay.enabled` | | never |
| Synthetic monitors assigned | `monitors > 0` (browser + HTTP + third-party monitors whose `monitors` relationship lists the app) | | | never |
| User tagging configured | `user-tags` returned ≥ 1 user tag rule for the app | | 0 rules | the function did not return status `ok`, or this app's call failed or it is beyond the first 500 |
| Health alerts configured | at least one *enabled* environment-scope `builtin:health-experience.frontend-alert` object lists the app ID in `frontends` | | | never |
| Owning team assigned | the app has a classic tag `dt.owner:<x>`, `owner:<x>` or `team:<x>` | | | never |

### Derived scores

| Score | Rule |
| --- | --- |
| Frontend score (per frontend) | `round(mean of its non-null check scores)`; 0 if none measured |
| Frontend check gauge / frontend finding row | `pct = round(mean of non-null scores across frontends)`; `part` = count at 100; `total` = count measured |
| Frontend overall readiness (`frontendPct`) | `round(mean of frontend scores)`; null while loading, on settings error, or with no frontends |
| Per-best-practice gauge | `round(mean of that field's row pcts)` across applicable types with entities |
| Overall readiness | `round(mean(all entity row pcts + frontendPct if not null))` |
| Top finding candidate | any entity or frontend row with `pct < 100`; ranked as in [Top 5 findings](#top-5-findings) |
| AI Assist severity (see below) | ≥ 90 good, ≥ 50 warning, < 50 critical; overall status ≥ 90 "well configured", ≥ 60 "partially configured", else "largely unconfigured" |

## Queries

| # | Name (function in source) | Runs when | Feeds |
| --- | --- | --- | --- |
| Q1 | Primary field coverage (`coverageQuery`) | App start (any tab); re-runs on timeframe change | Summary row, Top 5 findings, entity cards, AI Assist |
| Q2 | Web frontends and assigned synthetic monitors (`frontendsQuery`) | App start (any tab); re-runs on timeframe change and after a change made by a Frontends tab action | Frontends section, Frontend overall readiness, frontend findings |

Entity Overview has no drill-down queries. `missingEntitiesQuery` in [queries.ts](../ui/app/queries.ts#L87) ("Drill-down: entities of one type missing one primary field") is not used by any tab. To list entities that are missing a field, use the entity searches on the [Security context](security-context.md), [Cost allocation](cost-allocation.md), [Host groups](host-groups.md) and [Ownership & Teams](ownership-and-teams.md) tabs.

All DQL is run through `useDql` ([useDql.ts](../ui/app/useDql.ts)), which wraps `@dynatrace-sdk/react-hooks` `useDql`. A query re-runs whenever its text changes.

### Q1 Primary field coverage

- **Source:** `coverageQuery(tf)` in [queries.ts](../ui/app/queries.ts#L77). It is executed in [App.tsx](../ui/app/App.tsx#L52) and passed to the tab as `coverage`.
- **Runs:** once at app start. It re-runs when the timeframe changes. The same result is shared with the Security context, Cost allocation, Ownership & Teams and Host groups tabs and their remediation panels.
- **Parameters:** `tf` only. `from:now()-24h` becomes `from:now()-7d` or `from:now()-30d`. The type list and the field predicates are fixed.
- **Query** (24 h):

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
  - `smartscapeNodes "HOST", …, from:now()-24h` returns every Smartscape node of the nine listed types that existed at any time in the window. With 7 or 30 days, this includes entities that have since disappeared. Smartscape nodes carry the primary Grail fields (`dt.security_context`, `dt.cost.*`, `dt.host_group.id`) and the property and label maps used for ownership.
  - `summarize … by:{type}` collapses the nodes to one record per entity type.
  - `total = count()` counts all nodes of the type.
  - `security = countIf(arraySize(dt.security_context) > 0)`: `dt.security_context` is an array. `arraySize` of a missing field is null and is not counted, so only non-empty arrays count.
  - `costcenter`, `product`, `hostgroup` use `countIf(isNotNull(...))`.
  - `owner` coalesces twelve map lookups, in key order `dt.owner`, `owner`, `team`. For each key it tries: host properties (`host.custom.metadata`), process metadata (`custom_metadata`, set with `DT_CUSTOM_PROP`), Kubernetes labels (`` `tags:k8s.labels` ``) and Kubernetes annotations (`` `tags:k8s.annotations` ``). Keys containing dots and fields containing a colon are backtick-quoted. The entity counts as owned when any lookup returns a value.
- **Output:** one record per type that has nodes, with columns `type`, `total`, `security`, `costcenter`, `product`, `hostgroup`, `owner`. `toCoverageRows` turns these into check rows (next section). The `hostgroup` and `owner` columns are ignored for types where the field does not apply.
- **Limits and cost:** at most 9 result records. No sampling, scan limit or `limit` is needed. The code uses Smartscape instead of scanning logs, events or metrics because it is cheap (header comment in queries.ts). It was validated with `dtctl` against the demo tenant.
- **Open it yourself:** yes. Show DQL / Copy / Open in Notebook / Add to Dashboard, titled "Primary field coverage".

### Q2 Web frontends and assigned synthetic monitors

- **Source:** `frontendsQuery(tf)` in [queries.ts](../ui/app/queries.ts#L705). It is executed by `useFrontendsData` in [frontends.ts](../ui/app/frontends.ts#L166), which the shell calls in [App.tsx](../ui/app/App.tsx#L54). The Frontends tab uses the same data.
- **Runs:** at app start and on timeframe change. After a Frontends tab action reports a change (`reload`), the hook appends `refreshMarker(n)`, a trailing DQL comment line `// refresh <n>`, so the SDK runs the query again. The text shown by Show DQL never contains the marker.
- **Parameters:** `tf`. All four `from:now()-24h` occurrences (the main fetch and the three monitor fetches inside the lookup) become `-7d` or `-30d`.
- **Query** (24 h):

```dql
fetch dt.entity.application, from:now()-24h
| fields id, name = entity.name, tags
| fieldsAdd ownerTags = if(startsWith(tags[], "dt.owner:") or startsWith(tags[], "owner:") or startsWith(tags[], "team:"), tags[])
| fieldsAdd ownerTags = arrayRemoveNulls(ownerTags)
| fieldsAdd owner = if(arraySize(ownerTags) > 0, substring(ownerTags[0], from: indexOf(ownerTags[0], ":") + 1))
| fieldsRemove tags, ownerTags
| lookup [
    fetch dt.entity.synthetic_test, from:now()-24h
    | fieldsAdd app = monitors[dt.entity.application], kind = "browser"
    | append [fetch dt.entity.http_check, from:now()-24h | fieldsAdd app = monitors[dt.entity.application], kind = "http"]
    | append [fetch dt.entity.external_synthetic_test, from:now()-24h | fieldsAdd app = monitors[dt.entity.application], kind = "thirdparty"]
    | expand app
    | filter isNotNull(app)
    | summarize monitors = count(), browser = countIf(kind == "browser"), http = countIf(kind == "http"), thirdparty = countIf(kind == "thirdparty"), by:{app}
  ], sourceField:id, lookupField:app, fields:{monitors, browser, http, thirdparty}
| fieldsAdd monitors = coalesce(monitors, 0), browser = coalesce(browser, 0), http = coalesce(http, 0), thirdparty = coalesce(thirdparty, 0)
| sort name asc
```

  After a refresh triggered by a Frontends action, the executed text ends with an extra line, for example `// refresh 2`.

- **How it works:**
  - `fetch dt.entity.application` reads every classic web application (frontend) entity seen in the window.
  - `fields id, name = entity.name, tags` keeps the ID, the display name and the classic tag array.
  - The first `fieldsAdd ownerTags = if(startsWith(tags[], …), tags[])` is an iterative array expression. For each tag it keeps the tag if it starts with `dt.owner:`, `owner:` or `team:`, otherwise null.
  - `arrayRemoveNulls` drops the nulls.
  - `owner = substring(ownerTags[0], from: indexOf(…, ":") + 1)` takes the text after the first colon of the first matching tag. For example `dt.owner:team-a` gives `team-a`. Without a matching tag the result is null, because `if` without `else` returns null.
  - `fieldsRemove tags, ownerTags` drops the helper fields.
  - The `lookup [...]` subquery builds a per-application monitor count:
    - browser monitors (`dt.entity.synthetic_test`), HTTP monitors (`dt.entity.http_check`) and third-party monitors (`dt.entity.external_synthetic_test`) are appended into one stream, each with a `kind`;
    - `app = monitors[dt.entity.application]` takes the IDs of the applications each monitor is assigned to, from the classic `monitors` relationship;
    - `expand app` produces one record per monitor × application;
    - `filter isNotNull(app)` drops monitors with no application;
    - `summarize … by:{app}` counts monitors in total and per kind.
  - `lookup … sourceField:id, lookupField:app` attaches the counts to each application.
  - `coalesce(…, 0)` turns "no monitors" into 0.
  - `sort name asc` orders by name.
- **Output:** `id`, `name`, `owner`, `monitors`, `browser`, `http`, `thirdparty`. `id` is the key for the enablement settings, the health alert map and the user tag rules. `monitors` feeds the synthetics check, and `owner` the owner check. On this page `name` and the per-kind counts are not displayed. The Frontends tab shows them.
- **Limits and cost:** the query has no `limit`, and the app does not pass `maxResultRecords`, so the query API default of 1,000 records applies. In a tenant with more than 1,000 web applications only the first 1,000 by name are scored. The query does not check whether a monitor is enabled.
- **Open it yourself:** yes. Show DQL / Copy / Open in Notebook / Add to Dashboard, titled "Frontends", at the end of the Frontends section.

### Client-side post-processing

**Coverage rows** (`toCoverageRows`, [CoverageTabs.tsx](../ui/app/tabs/CoverageTabs.tsx#L42)):
1. Index the Q1 records by `type`.
2. For each type in `ENTITY_TYPES` order (HOST, PROCESS, SERVICE, CONTAINER, K8S_CLUSTER, K8S_NODE, K8S_NAMESPACE, K8S_DEPLOYMENT, K8S_POD), skip the type if it has no record or `total` is 0.
3. For each field in order security, costcenter, product, hostgroup, owner, skip the field if `fieldApplies` is false. Otherwise emit `{type, field, label, part = num(record[field]), total, pct = pct(part, total)}`. `num` turns null or non-numeric values into 0.

**Frontend rows** (`useFrontendsData`, [frontends.ts](../ui/app/frontends.ts#L166)):
1. Wait until both the Q2 result and the two settings lists are in.
2. Build `enablement`: settings scope → value. Use `"environment"` as the default.
3. Build `alerts`: frontend ID → `alertKey`s. Alerts with `enabled === false` are skipped.
4. For each Q2 record:
   - `en` = own object or environment default;
   - `rumClassic = rum.enabled`;
   - `rumV2 = rumClassic && rum.enabledOnGrail`;
   - `replayClassic = rumClassic && sessionReplay.enabled`;
   - `replayGrail = replayClassic && sessionReplay.enabledOnGrail`;
   - `healthAlerts` = number of alert keys;
   - `userTagRules` = the function's count for the ID if the function returned `ok` and has a count for that ID, otherwise null.
5. `scoreFrontend` produces the per-check scores and the frontend score.
6. While a refresh runs, the previous rows stay on screen. `loading` is only true before the first complete computation.

**Frontend finding rows** (`frontendFindingRows`) and **Top findings** (`topFindings`) are described in [Top 5 findings](#top-5-findings).

## API calls

| # | Method | Endpoint / SDK method | Scope | When |
| --- | --- | --- | --- | --- |
| A1 | POST / GET | DQL execution: `/platform/storage/query/v1/query:execute`, then `query:poll` (`queryExecutionClient` inside `@dynatrace-sdk/react-hooks` `useDql`) | `storage:smartscape:read` (Q1), `storage:entities:read` (Q2) | Q1 and Q2 as above |
| A2 | GET | `settingsObjectsClient.getSettingsObjects` → `/platform/classic/environment-api/v2/settings/objects` for `builtin:rum.web.enablement` | `settings:objects:read` | App start; after a Frontends action reload. Not on timeframe change. |
| A3 | GET | same endpoint for `builtin:health-experience.frontend-alert`, `scopes=environment` | `settings:objects:read` | Same as A2 (runs in parallel) |
| A4 | POST | `functions.call("user-tags", …)` → `/api/user-tags` (the app's own function) | no extra app scope | When Q2 returns a non-empty list of application IDs; again when that list changes or after a reload |
| A4.1 | GET | `credentialVaultClient.listCredentials` → `/platform/classic/environment-api/v2/credentials` | `environment-api:credentials:read` | Inside A4 |
| A4.2 | GET | `credentialVaultClient.getCredentialsDetails` → `/platform/classic/environment-api/v2/credentials/{id}/details` | `environment-api:credentials:read` | Inside A4 |
| A4.3 | GET | `fetch` → `https://<env>.live.dynatrace.com/api/config/v1/applications/web/{id}` | API token with `ReadConfig` (not an app scope); outbound allowlist | Inside A4, once per application |
| A5 | intent | `sendIntent` → `dynatrace.notebooks` / `view-query` | none | Open in Notebook |
| A6 | intent | `sendIntent` → `dynatrace.dashboards` / `add-to-dashboard` | none | Add to Dashboard |

**A1 DQL execution.** The SDK hook posts `{"query": "<Q1 or Q2 text>", "requestTimeoutMilliseconds": 1000}` and polls with the returned request token until the result is complete. On HTTP 429 it retries with a back-off. `result.records` is used.

**A2 Settings: RUM enablement** ([frontends.ts](../ui/app/frontends.ts#L94)). First page: `GET …/settings/objects?schemaIds=builtin:rum.web.enablement&fields=scope,value&pageSize=500`. Later pages: `GET …/settings/objects?nextPageKey=<key>`, because the API requires `nextPageKey` to be the only parameter. Pages are read until `nextPageKey` is absent. Example item:

```json
{ "scope": "APPLICATION-0000000000000001",
  "value": { "rum": { "enabled": true, "enabledOnGrail": true, "costAndTrafficControl": 100 },
             "sessionReplay": { "enabled": true, "enabledOnGrail": false, "costAndTrafficControl": 100 } } }
```

Used fields: `items[].scope` (an application ID, or `environment` for the default), `value.rum.enabled`, `value.rum.enabledOnGrail`, `value.sessionReplay.enabled`, `value.sessionReplay.enabledOnGrail`, and `nextPageKey`.

**A3 Settings: frontend health alerts.** `GET …/settings/objects?schemaIds=builtin:health-experience.frontend-alert&scopes=environment&fields=scope,value&pageSize=500`, paged like A2. Used fields: `value.enabled` (objects with `false` are ignored), `value.frontends` (application IDs) and `value.alertKey`. If A2 or A3 fails, the error message becomes `settingsError`: the Frontends section shows it in red and frontend readiness is left out.

**A4 `user-tags` app function** ([api/user-tags.function.ts](../api/user-tags.function.ts)). Request body:

```json
{ "appIds": ["APPLICATION-0000000000000001", "APPLICATION-0000000000000002"] }
```

The function works as follows:
1. Keep only IDs matching `^APPLICATION-[0-9A-F]+$`, and at most 500 of them.
2. A4.1: `GET …/credentials?type=TOKEN&name="architect-assistant-readconfig"`. Pick the credential with exactly that name, or else the first one returned.
3. A4.2: read its `token`.
4. Derive the classic URL from `getEnvironmentUrl()`. `https://<env>.apps.dynatrace.com` becomes `https://<env>.live.dynatrace.com`. On other hosts the `.apps.` label is dropped.
5. A4.3: for every ID, `GET <classic>/api/config/v1/applications/web/<id>` with header `Authorization: Api-Token dt0c01.XXXX`. Eight requests run in parallel. The length of `userTags` in the response is the rule count.

Responses:

| Response | Meaning |
| --- | --- |
| `{"status":"ok","rules":{"APPLICATION-0000000000000001":2},"failed":[]}` | Counts per application. IDs in `failed` (non-2xx or network error) have no count. |
| `{"status":"no-credential","message":"…"}` | Credential missing, unreadable, or without a token value |
| `{"status":"unauthorized","message":"Config API returned 401; the token needs the ReadConfig scope."}` | A 401 or 403 stops all requests |
| `{"status":"error","message":"Config API calls to <classic> failed for every application (is the host allowlisted?)."}` | Every per-application call failed |

If the function call itself fails (non-2xx from `/api/user-tags`), the state becomes `error` with the message "Function user-tags has failed". On this page any status other than `ok` makes *User tagging configured* "Not measured". The detailed message is shown on the Frontends tab.

**A5 / A6 intents.** Payload `{"dt.query": "<query text>", "title": "Primary field coverage"}` or `"title": "Frontends"`. The Notebooks or Dashboards app handles it. Copy uses `navigator.clipboard.writeText`.

## Remediation actions

This page makes no write calls. It routes to the tabs that fix each gap:

- `goToRemediation(tab)` ([App.tsx](../ui/app/App.tsx#L58)) switches to the target tab's area and tab (`locateTab`). After 100 ms it looks for the element `remediation-<tab>` and retries up to 15 times at 100 ms intervals. When it finds the element, it scrolls it smoothly to the top. If the section does not render within about 1.6 s, the tab opens without scrolling.
- `goToFrontends(toActions)` ([App.tsx](../ui/app/App.tsx#L68)) opens the Frontends tab in the Visibility area. With `toActions` it looks for `frontends-actions` up to 50 times at 200 ms intervals (about 10 s), because that section only renders once frontend data has loaded.

| Clicked on | Opens | Lands on | Offered there (from [RemediationPanel.tsx](../ui/app/RemediationPanel.tsx#L1114)) |
| --- | --- | --- | --- |
| Security context gauge (i), Security context finding | [Security context](security-context.md) | Remediation actions (`remediation-security`) | API · Central enrichment rule (`dt.security_context`); Manual · Host tag with oneagentctl; Manual · Kubernetes annotation |
| Cost center / Cost product gauge (i) or finding | [Cost allocation](cost-allocation.md) | `remediation-cost` | API · Central enrichment rule (`dt.cost.costcenter`, `dt.cost.product`); Manual · Host tag with oneagentctl; Manual · Kubernetes annotation |
| Host group gauge (i) or finding | [Host groups](host-groups.md) | `remediation-hostgroups` | API · Assign host group (remote configuration); Manual · Host group with oneagentctl (single host) |
| Ownership team gauge (i) or finding | [Ownership & Teams](ownership-and-teams.md) | `remediation-ownership` | API · Create teams for owner values in use; API · Assign owner to frontends and synthetic monitors (tags); API · Create a new team; Manual · Owner on a host (host property); Manual · Owner on Kubernetes objects (label); Manual · Owner on a process (environment variable) |
| Frontend overall readiness (i); frontend finding button | [Frontends](frontends.md) | top of the tab | |
| Frontend check gauge (i) | [Frontends](frontends.md) | the **Actions** section (`frontends-actions`) | Enable RUM v2, Enable Session Replay, Create health alerts, assign or create synthetic monitors, Assign owning team, Set up the user tagging token, and others |

Forms, validation, request bodies and documentation links for each action are on those pages.

## AI Assist on this page

With the header **AI Assist** toggle on, an "AI Insights" panel appears at the top of the tab, inside the loaded state. Its ✕ button turns the toggle off. The content comes from `analyzeOverview(rows, frontends)` in [analyses.ts](../ui/app/analyses.ts#L11). `rows` are the coverage rows and `frontends` is `{pct: frontendPct, count}` or null. The analysis is rule-based, runs locally in the browser on the numbers already on screen, and calls no AI service. Texts use raw entity type IDs (for example `HOST`, `K8S_POD`).

**No coverage rows** (frontend data is ignored in this case):
- Summary: "No entities were returned for this timeframe, so no best-practice checks could be scored."
- Insight (info): "No Smartscape entities found. Widen the timeframe or confirm OneAgent / cloud integrations are reporting."
- Recommendation (high): "Confirm OneAgent deployment and cloud connectors, then re-run the checks."

**Otherwise:**
- `checkCount` = number of rows, + 1 when frontend data exists.
- `overall` = round((sum of row pcts + frontend pct) / checkCount), the same as the Overall readiness gauge.
- `failing` = rows with pct < 50.
- `passing` = rows with pct ≥ 90. Both counts exclude the frontend check.

Summary: "Across `<checkCount>` checks (entity type × best practice[, plus frontend readiness]) the tenant averages `<overall>`% coverage — `<status>`. `<passing>` check(s) is/are at or above 90% and `<failing>` check(s) is/are below 50%." Status is "well configured" at ≥ 90, "partially configured" at ≥ 60, otherwise "largely unconfigured".

Insights, in order (severity rule `sevFor`: ≥ 90 good, ≥ 50 warning, else critical):

| Rule | Severity / icon | Text |
| --- | --- | --- |
| Any failing rows | critical, siren | "`n` checks below 50%: `<TYPE> <label lower-case> (<pct>%)`, …" (the first 4 in row order, then ", …") |
| Always | `sevFor(worst)`, warning sign | "Weakest check: `<label>` on `<TYPE>` — `<part>` of `<total>` in place (`<pct>`%)." The worst row is the lowest pct. Ties go to the first in row order. |
| Best row is a different row | good, check mark | "Strongest check: `<label>` on `<TYPE>` at `<pct>`% (`<part>`/`<total>`)." The best row is the highest pct. Ties go to the last in row order. |
| Frontend data exists | `sevFor(frontend pct)`, globe | "Frontend readiness is `<pct>`% across `<n>` frontend(s) (RUM, Session Replay, synthetic monitors, user tagging, health alerts, ownership); it counts as one check in the overall score." |
| A Security context row with 0 in place | critical, lock | "Security context is not set on any `<TYPE, TYPE…>` entity — data cannot be scoped by security context." |

Recommendations, in order:

| Rule | Impact | Text |
| --- | --- | --- |
| Security context at 0 on some type | high | "Define dt.security_context (for example via OneAgent host properties or OpenPipeline rules) so IAM policy boundaries can scope data access." |
| Any failing rows | high | "Open the Primary tags tab, pick the weakest entity type and field, and list the entities that are missing it." The Primary tags tab only covers customer-defined `primary_tags.*`. The entity searches for these five fields are on the Security context, Cost allocation, Host groups and Ownership & Teams tabs. |
| Always | medium | "Set cost center and cost product at the source (host/Kubernetes metadata) so consumption is attributed to an owner." |
| Frontend pct < 70 | medium | "Open the Frontends tab and use Actions to enable RUM v2 / Session Replay, assign synthetic monitors, create health alerts and set owners." |
| Always | low | "Re-run with a 7 or 30 day timeframe to confirm gaps are not just newly onboarded entities." |

Example (worked example B): "Across 18 checks (entity type × best practice, plus frontend readiness) the tenant averages 82% coverage — partially configured. 12 checks are at or above 90% and 2 checks are below 50%." Insights: "2 checks below 50%: PROCESS ownership team (0%), SERVICE security context (0%).", "Weakest check: Ownership team on PROCESS — 0 of 2400 in place (0%).", "Strongest check: Host group on CONTAINER at 100% (600/600).", the frontend readiness line at 69%, and the security context line for SERVICE.

## Limitations and edge cases

- **Unweighted averages.** Overall readiness and the per-best-practice gauges average percentages, not entities. A check on 3 clusters weighs as much as a check on 2,400 processes, and all frontends together count as one check.
- **Rounding.** Values below 0.5% round to 0, so 1 of 300 hosts reads "None of the 300 hosts have …". Values at or above 99.5% round to 100, so 999 of 1,000 is not reported as a finding.
- **Rank beats size** in Top 5 findings, at most 2 findings per type. Large gaps on processes, services and Kubernetes objects often do not appear. Frontend findings appear only when hosts, nodes and clusters leave slots free.
- **Frontend finding fractions.** For RUM and Session Replay the percentage includes the 50% classic-only scores, but the "(part of total)" count includes only frontends at 100. "Only 83% of frontends have RUM v2 enabled (2 of 3)" is therefore correct output.
- **Ownership is presence-only.** Any value of `dt.owner`, `owner` or `team` counts. The value is not matched against existing teams. Services, containers and Kubernetes clusters are not scored.
- **Coverage scope.** Only the nine listed Smartscape types are scored. For example, Kubernetes StatefulSets, DaemonSets and cloud resources are not covered, and only web applications (`dt.entity.application`) count as frontends.
- **Timeframe semantics.** 7 and 30 day windows include entities that existed earlier in the window, including decommissioned ones.
- **Frontend settings are not re-read on timeframe change**, only after a Frontends action. Health alerts are read at environment scope only, and disabled alerts are ignored. Synthetic monitors count whether or not they are enabled.
- **User tagging.** At most 500 applications are queried. Applications beyond that, or whose call failed, are not measured individually.
- **Q2 result cap.** The query API default of 1,000 records applies to the frontends query.
- **Error visibility.** If Q1 fails, the whole tab, including the Frontends section, shows only "Query failed". If Q2 fails, the Frontends section here shows "No frontends found for this timeframe.", while the Frontends tab shows the error.
- **No drill-down on this page.** `missingEntitiesQuery` exists but is unused. Use the entity searches on the linked tabs.
- **No entities.** Overall readiness shows 0% with "0 checks" (or only the frontend check), the cards show "No entities found for this timeframe.", and Top 5 may say "No gaps found — every check is fully in place."

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| "Query failed" with a missing-scope or permission error | App lacks `storage:smartscape:read`, or the user lacks the permission | Check `app.scopes`. After changing scopes, restart `npx dt-app dev` or redeploy and sign in again. Check the user's policies. |
| Only "Loading…" for a long time | Q1 still running | Wait. Check the tenant's query status in a notebook using Open in Notebook from another tab. |
| "No entities found for this timeframe." and Overall 0% | Smartscape returned no nodes of the nine types | Widen the timeframe. Confirm OneAgent, Kubernetes or cloud integrations are reporting. |
| Frontends section shows red text | Reading `builtin:rum.web.enablement` or `builtin:health-experience.frontend-alert` failed | Check `settings:objects:read` (app scope and user permission). |
| Frontends section says "No frontends found" although web apps exist | Q2 failed (for example missing `storage:entities:read`), or no app entity existed in the window | Open the Frontends tab to see the error. Widen the timeframe. |
| Every frontend shows RUM disabled although RUM is on | Settings objects not visible to the user (the API returns no items) | Grant settings read access to the schema. |
| "User tagging configured" is Not measured | No `architect-assistant-readconfig` token, an owner-only credential of another user, a token without ReadConfig, or the classic host is not allowlisted | See the warning on the Frontends tab. Follow [One-time setup](#one-time-setup). |
| An (i) button opens the tab but does not scroll | Target section not rendered within about 1.6 s (remediation) or about 10 s (frontend actions), for example because frontend data is still loading or there are no frontends | Scroll down manually, or click again once the tab has loaded. |
| A finding says "None of the N …" although some entities have the field | Rounding below 0.5% | Check the entity card's "part of total" line. |
| A visible gap is not in Top 5 | Rank ordering and the 2-per-type cap | Read the entity cards. Fix higher-rank gaps first. |
| Numbers change between 24 h and 7 d / 30 d | Longer windows include entities that no longer exist | Use 24 h for the current state. |
| Open in Notebook / Add to Dashboard does nothing | No access to the Notebooks or Dashboards app | Use Copy and paste the query manually. |

## Related pages

- [Index](README.md)
- [Frontends](frontends.md): full frontend scoring, table and actions
- [Security context](security-context.md), [Cost allocation](cost-allocation.md), [Host groups](host-groups.md), [Ownership & Teams](ownership-and-teams.md): per-field gauges, entity searches and remediation
- [Primary tags](primary-tags.md): customer-defined `primary_tags.*` (not part of readiness)
- [Data Overview](data-overview.md): the same fields on metrics, logs and events (not part of readiness)

## Source files

| File | Role on this page |
| --- | --- |
| [ui/app/tabs/CoverageTabs.tsx](../ui/app/tabs/CoverageTabs.tsx) | `OverviewTab`, `SummaryGauges`, `TopFindingsPanel`, `topFindings`, `frontendFindingRows`, `EntityGaugeSections`, `toCoverageRows`, `RANK`, `REMEDIATION_TARGET` |
| [ui/app/queries.ts](../ui/app/queries.ts) | `coverageQuery`, `frontendsQuery`, `refreshMarker`, `PRIMARY_FIELDS`, `OWNER_EXPR`, `ENTITY_TYPES`, `fieldApplies`, `TIMEFRAMES` |
| [ui/app/frontends.ts](../ui/app/frontends.ts) | `useFrontendsData`, settings reads, `user-tags` call, `scoreFrontend`, `CHECKS` |
| [ui/app/tabs/FrontendsTab.tsx](../ui/app/tabs/FrontendsTab.tsx) | `FrontendsOverviewCard`, `FrontendsSummary`, `NotMeasured` |
| [api/user-tags.function.ts](../api/user-tags.function.ts) | Reads the ReadConfig token and counts user tag rules through Config API v1 |
| [ui/app/App.tsx](../ui/app/App.tsx) | Shell, timeframe, shared queries, `goToRemediation`, `goToFrontends` |
| [ui/app/navigation.tsx](../ui/app/navigation.tsx) | `NavContext`, anchor IDs `remediation-<tab>` and `frontends-actions` |
| [ui/app/RemediationPanel.tsx](../ui/app/RemediationPanel.tsx), [ui/app/remediation.ts](../ui/app/remediation.ts) | Target sections of the (i) and Remediation steps buttons |
| [ui/app/components.tsx](../ui/app/components.tsx) | `PctGauge`, `statusColor`, `pct`, `QueryState`, `QueryActions`, gauge sizes |
| [ui/app/useDql.ts](../ui/app/useDql.ts) | DQL hook wrapper |
| [ui/app/AIInsights.tsx](../ui/app/AIInsights.tsx), [ui/app/analyses.ts](../ui/app/analyses.ts) | AI Assist panel and `analyzeOverview` |
| [ui/app/areas.tsx](../ui/app/areas.tsx) | Tab id, title, area, documentation link |
| [app.config.json](../app.config.json) | App scopes |
