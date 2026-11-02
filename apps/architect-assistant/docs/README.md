# Architect Assistant documentation

Architect Assistant is a Dynatrace AppEngine app that shows which onboarding best practices are **in place vs
missing** in a tenant, explains how each number is computed, and offers a remediation for most findings. This folder
has one page per tab of the app. Each page describes everything the tab shows, every check and how it is scored,
every DQL query in full with a line-by-line explanation, every API call, and every remediation action.

Every tab has a **"<Tab> documentation"** link in its top-right corner that opens its page here. For a shorter
overview of the whole app, see the [app README](../README.md).

## Contents

- [Pages by area](#pages-by-area)
- [The app shell](#the-app-shell)
  - [Area picker and tabs](#area-picker-and-tabs)
  - [Timeframe](#timeframe)
  - [AI Assist](#ai-assist)
- [Building blocks used on every page](#building-blocks-used-on-every-page)
  - [Gauges](#gauges)
  - [Query actions: Show DQL, Copy, Open in Notebook, Add to Dashboard](#query-actions-show-dql-copy-open-in-notebook-add-to-dashboard)
  - [Drill-down tables](#drill-down-tables)
  - [Remediation actions](#remediation-actions)
  - [Documentation freshness](#documentation-freshness)
- [How data is read](#how-data-is-read)
- [App functions](#app-functions)
- [Scopes](#scopes)
- [Conventions used in these pages](#conventions-used-in-these-pages)
- [Maintaining this documentation](#maintaining-this-documentation)

## Pages by area

The app groups its 21 tabs into four areas. Only the tabs of the selected area are shown.

### Metadata

Entity and data coverage: host groups, security context, cost allocation, ownership and primary tags.

| Tab | Page | In one line |
| --- | --- | --- |
| Entity Overview | [entity-overview.md](entity-overview.md) | Overall readiness, a gauge per best practice, Top 5 findings, a gauge card per entity type, and frontend readiness. |
| Data Overview | [data-overview.md](data-overview.md) | Security context, cost center and cost product on metric series, logs, events and business events. |
| Host groups | [host-groups.md](host-groups.md) | Hosts with a host group, entity search by host group, assign host groups. |
| Security context | [security-context.md](security-context.md) | `dt.security_context` per entity type, search, central enrichment rule. |
| Cost allocation | [cost-allocation.md](cost-allocation.md) | `dt.cost.costcenter` and `dt.cost.product` per entity type, search, central enrichment rule. |
| Ownership & Teams | [ownership-and-teams.md](ownership-and-teams.md) | Owner keys on hosts, processes and Kubernetes objects; classic owner tags on frontends and monitors; create teams. |
| Primary tags | [primary-tags.md](primary-tags.md) | Your own `primary_tags.<name>` per entity type, search, enrichment rule. |

### Migration Assistance

Move classic configuration to the platform.

| Tab | Page | In one line |
| --- | --- | --- |
| SLOs | [slos.md](slos.md) | Classic SLOs vs Grail-based SLOs; upgrade classic SLOs automatically. |
| Segments | [segments.md](segments.md) | Management zones vs filter segments; convert zones to segments. |
| Problem notifications | [problem-notifications.md](problem-notifications.md) | Classic problem notifications vs workflows; convert them to simple workflows. |

### Visibility

What is monitored and how well.

| Tab | Page | In one line |
| --- | --- | --- |
| OneAgents | [oneagents.md](oneagents.md) | Version spread, monitoring mode, Find hosts, monitoring mode and update fixes. |
| Deep Monitoring | [deep-monitoring.md](deep-monitoring.md) | Processes with a OneAgent code module per technology, Find processes, Diagnose. |
| Frontends | [frontends.md](frontends.md) | RUM v2, Session Replay on Grail, synthetic monitors, user tags, health alerts and owners per frontend. |
| ActiveGates | [activegates.md](activegates.md) | Connectivity, versions, update mode, modules, messages, groups, network zones, extensions, logs. |
| Kubernetes | [kubernetes.md](kubernetes.md) | Dynatrace Operator / DynaKube per cluster, monitoring mode and injection status per workload. |
| Databases | [databases.md](databases.md) | Databases monitored by an extension vs database servers seen only by OneAgent. |
| Extensions | [extensions.md](extensions.md) | Every monitoring configuration, broken ones, fastcheck log, recommendations. |
| Service Detection v2 | [service-detection-v2.md](service-detection-v2.md) | SDv2 adoption and where to enable it. |

### Users and permissions

Build IAM policies and boundaries, and test what a user or group can access.

| Tab | Page | In one line |
| --- | --- | --- |
| IAM Policy Creator | [iam-policy-creator.md](iam-policy-creator.md) | Build policy statements from apps, Grail data and individual permissions. |
| IAM Boundary Creator | [iam-boundary-creator.md](iam-boundary-creator.md) | Build policy boundaries and preview their effect. |
| Permissions Test | [permissions-test.md](permissions-test.md) | Which apps and Grail data a user or group can access. |

## The app shell

Source: [ui/app/App.tsx](../ui/app/App.tsx), [ui/app/areas.tsx](../ui/app/areas.tsx).

### Area picker and tabs

The dropdown above the tabs selects an area (Metadata, Migration Assistance, Visibility, Users and permissions). Each
area has its own glyph and colour; the colour edges the strip the dropdown sits on, and the area's description is
shown next to it. Each area remembers the tab you last opened in it. Links that jump to another tab (Top findings, the
(i) buttons on gauges, the Frontends gauge on Entity Overview) switch the area too.

### Timeframe

The select in the header sets the timeframe for every query that takes one: **Last 24 hours** (default), **Last 7
days** or **Last 30 days**. Queries use an explicit `from:now()-24h` / `-7d` / `-30d`. Longer timeframes also count
entities that existed earlier in the window, including decommissioned ones; the header says so when 7 or 30 days is
selected. Changing the timeframe changes the query text, which re-runs every visible query.

SLOs and Problem notifications do not use it (they read configuration through APIs and use fixed windows of
their own); on the IAM tabs it only sets the window for condition value suggestions. Each page says how it uses it.

### AI Assist

The **AI Assist** button in the header toggles an insights panel on whichever tab is open: a summary, a list of
insights (good / warning / critical / info) and recommendations ranked by impact. It is computed locally by rules in
[ui/app/analyses.ts](../ui/app/analyses.ts) from the data already on the screen; it does not call a Dynatrace AI
service and sends nothing anywhere. The panel and its streaming text are in
[ui/app/AIInsights.tsx](../ui/app/AIInsights.tsx). Each page documents the rules of its own panel.

## Building blocks used on every page

Source: [ui/app/components.tsx](../ui/app/components.tsx).

### Gauges

Every percentage is a custom SVG gauge (`PctGauge`): a 240-degree arc, open at the bottom, filled from the left. The
fill is a gradient along the arc from red (0 %) through orange and yellow to green (100 %), so a 58 % gauge shows red
through yellow-green and stops there. The number is `round(part / total * 100)`; a gauge with no entities shows 0 %.
Some gauges have an **(i)** button in their top-right corner that opens the matching remediation steps or tab.

### Query actions: Show DQL, Copy, Open in Notebook, Add to Dashboard

Every section backed by DQL has four buttons:

| Button | What it does |
| --- | --- |
| Show DQL / Hide DQL | Shows the exact query the section ran (with the current timeframe and filters). |
| Copy | Copies the query to the clipboard. |
| ↗ Open in Notebook | Sends the query to the Notebooks app (intent `dynatrace.notebooks` / `view-query`). |
| ↗ Add to Dashboard | Sends the query to the Dashboards app (intent `dynatrace.dashboards` / `add-to-dashboard`). |

The intents need no extra app scope; the user needs access to Notebooks and Dashboards.

### Drill-down tables

Lists of non-compliant entities run their query only when you open them (so a page does not pay for lists nobody
looks at), have the same four query actions, are sortable, and show the first 500 rows.

### Remediation actions

Most tabs end with a **Remediation actions** section: an *Action* dropdown and a short form. Actions are either:

- **API**: the app makes the change for you. Every write shows the exact request (method, path, body), offers a
  **Validate** step (a dry run where the API supports one, otherwise checks the app makes itself), and needs an
  explicit confirmation before anything is written.
- **Manual**: commands or click paths to run yourself (for example `oneagentctl`, `kubectl`, DynaKube YAML), with
  dropdowns for the OS or variant where they differ.

Every action ends with a **Documentation for this fix** row linking the Dynatrace docs pages that describe the
mechanism it uses. The tabs that check one selected item (*Diagnose*, *Configure* or *Fix* on Deep Monitoring,
Kubernetes, ActiveGates, Databases and Extensions) list its checks blocking first and group the *Action* dropdown
as Blocking, Check, Info and More steps.

### Documentation freshness

The remediation guidance on several tabs was written from the Dynatrace docs. The `docs-freshness` app function reads
the docs sitemap and the app compares each cited page's last-modified date with the date recorded at the last review
([ui/app/deepDocsSnapshot.json](../ui/app/deepDocsSnapshot.json)). A fix whose cited page changed is marked. See
[deep-monitoring.md](deep-monitoring.md) and [service-detection-v2.md](service-detection-v2.md) for details.

## How data is read

- **DQL in the browser.** Most data comes from DQL run with `useDql` from `@dynatrace-sdk/react-hooks`
  ([ui/app/useDql.ts](../ui/app/useDql.ts)). A query re-runs whenever its text changes (timeframe, filter or
  selection). Smartscape (`smartscapeNodes`) is preferred because it is cheap and carries the primary Grail fields on
  each entity; classic entity tables (`dt.entity.*`), self-monitoring metrics (`timeseries`), events and logs are used
  where Smartscape has no equivalent.
- **One shared coverage query.** `coverageQuery` runs once at page start and feeds Entity Overview, Security context,
  Cost allocation, Ownership & Teams and the Host groups remediation. Frontend data also loads at page start, because
  Entity Overview and Frontends share it.
- **Query builders.** Most DQL is built in [ui/app/queries.ts](../ui/app/queries.ts); some tab modules build their own.
- **Platform and classic APIs** (Settings 2.0, SLOs, Extensions, Fleet Management, Filter Segments, App Registry, IAM)
  are called through the `@dynatrace-sdk/*` clients or `httpClient`, with the app's own credentials.
- **What is kept between sessions:** the primary tag names you save on the Primary tags tab (user app state, per
  user) and the IAM Policy Creator / Boundary Creator drafts (browser `localStorage`, per browser). Credentials the
  app functions need are stored in the credential vault by the setup forms on the pages that need them. Nothing
  else is stored.

## App functions

Some calls cannot be made from the browser (no CORS, or a credential the app must not expose). They run server-side
as app functions in [api/](../api):

| Function | Used by | What it does |
| --- | --- | --- |
| [docs-freshness](../api/docs-freshness.function.ts) | Deep Monitoring, Kubernetes, ActiveGates, Databases, Extensions, Service Detection v2 | Reads the docs.dynatrace.com sitemap for last-modified dates. |
| [iam-reference](../api/iam-reference.function.ts) | IAM Policy Creator, IAM Boundary Creator, Permissions Test | Reads and parses the IAM policy reference from docs.dynatrace.com. |
| [iam-access](../api/iam-access.function.ts) | Permissions Test | Reads groups, bindings, policies and boundaries from the Account Management API with an OAuth client from the credential vault. |
| [user-tags](../api/user-tags.function.ts) | Frontends | Reads user tag rules from Config API v1 with a ReadConfig token from the credential vault. |
| [workflows](../api/workflows.function.ts) | Problem notifications | Creates workflows with a platform token from the credential vault (custom apps cannot request `automation:workflows:write`). |

When `builtin:dt-javascript-runtime.allowed-outbound-connections` is enforced, the hosts these functions call must be
allowed; each page lists what it needs.

## Scopes

The app requests its scopes in [app.config.json](../app.config.json), each with a comment saying what it is for. The
[app README](../README.md#scopes) has the full table. Each page lists the scopes it uses in its *Before you start*
section. Write scopes only take effect together with the signed-in user's own permissions: the app can never do more
than the user could.

## Conventions used in these pages

- Queries are shown as the app generates them, for the default timeframe (24 hours). Where the text depends on the
  timeframe, a filter or a selected entity, the page says which part changes. IDs and names in examples are
  placeholders.
- "In place" means the check passes for that entity; percentages are rounded to whole numbers.
- Links to source files point to the code the page describes, so you can check the exact behaviour.

## Maintaining this documentation

- When a tab changes, update its page in the same commit. Each page ends with the list of source files it describes.
- The mapping from tab to page is `TAB_DOCS` in [ui/app/areas.tsx](../ui/app/areas.tsx); the in-app links are built
  from it. Renaming a page means updating `TAB_DOCS`.
- The links open the `main` branch on GitHub, so a page is only reachable from the app once it is pushed.
