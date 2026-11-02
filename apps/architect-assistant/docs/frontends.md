# Frontends

The Frontends tab scores how ready every RUM web frontend (classic web application, `dt.entity.application`) in the
environment is, against six best practices: RUM v2 (New RUM Experience, data in Grail) enabled, Session Replay on Grail
enabled, at least one synthetic monitor assigned, a user tag rule configured, at least one enabled health alert, and an
owning team. It shows the average per check and overall, a RUM status breakdown, a per-frontend gauge view and a table
of every frontend, and its **Actions** section fixes most gaps in bulk (one Settings API request for any number of
frontends) or links to the Dynatrace page where a fix has no API. Data comes from one DQL query, two Settings API
reads, and the `user-tags` app function, which reads user tag rules from the classic Config API v1.

| | |
| --- | --- |
| Area | Visibility (see [index](README.md)) |
| Tab id | `frontends` |
| Counts toward Entity Overview readiness / Top findings | Yes. The mean of all frontend scores is one extra check in Entity Overview *Overall readiness* (the *Frontend overall readiness* gauge), and each of the six checks competes in *Top 5 findings* (ranked after hosts, Kubernetes nodes and clusters, before containers; at most two frontend findings). See [Entity Overview integration](#entity-overview-integration). |
| Main source files | [ui/app/tabs/FrontendsTab.tsx](../ui/app/tabs/FrontendsTab.tsx), [ui/app/frontends.ts](../ui/app/frontends.ts), [ui/app/tabs/FrontendActions.tsx](../ui/app/tabs/FrontendActions.tsx), [ui/app/frontendActions.ts](../ui/app/frontendActions.ts), [api/user-tags.function.ts](../api/user-tags.function.ts), [ui/app/queries.ts](../ui/app/queries.ts#L689-L757) |

## Contents

- [What this page answers](#what-this-page-answers)
- [Before you start](#before-you-start)
  - [App scopes used by this page](#app-scopes-used-by-this-page)
  - [User permissions](#user-permissions)
  - [One-time setup](#one-time-setup)
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

- How many web frontends does this environment have, and how many of them send RUM data to Grail (RUM v2) rather than
  only to RUM classic, or have RUM switched off?
- Which frontends record Session Replay, and is it the Grail-based (latest) Session Replay or the classic one?
- Which frontends have no synthetic monitor (browser, HTTP or third-party) watching them?
- Which frontends identify their users (a user tag rule under *Capturing > User tags*)?
- Which frontends have no enabled health alert (Web Vitals, user action duration, error rate, traffic) in Experience
  Vitals?
- Which frontends have no owning team, so their problems cannot be routed?
- What is the average readiness per best practice and overall, and which single action closes the biggest gap?

The best practices and the Dynatrace documentation the code cites for each:

| Best practice | Why it matters | Documentation cited by the code |
| --- | --- | --- |
| RUM v2 enabled (New RUM Experience) | RUM data lands in Grail, where Experience Vitals, DQL, health alerts and the rest of the platform use it. RUM classic only is scored 50%. | [Enable the New RUM Experience for RUM Classic web applications](https://docs.dynatrace.com/docs/observe/digital-experience/new-rum-experience/web-frontends/initial-setup/enable-new-rum-for-web-apps) |
| Session Replay on Grail | Visual reproduction of user sessions with the latest Session Replay. Classic only is scored 50%. | [Activate Session Replay for web frontends](https://docs.dynatrace.com/docs/observe/digital-experience/session-replay-latest/configure-session-replay-web/latest-enable-session-replay-web) |
| Synthetic monitor assigned | Availability and performance are checked even when no real user is active. | [Create and configure a browser monitor](https://docs.dynatrace.com/docs/observe/digital-experience/synthetic/synthetic-app/create-configure-browser-monitors), [Create and configure an HTTP monitor](https://docs.dynatrace.com/docs/observe/digital-experience/synthetic/synthetic-app/create-and-configure-an-http-monitor), [Settings API: assign synthetic monitor to web applications](https://docs.dynatrace.com/docs/discover-dynatrace/references/dynatrace-api/environment-api/settings/schemas/builtin-synthetic-browser-assigned-applications) |
| User tagging configured | Sessions can be traced back to an individual user. | [Tag specific users for web applications](https://docs.dynatrace.com/docs/observe/digital-experience/web-applications/additional-configuration/identify-individual-users-for-session-analysis), [RUM JavaScript API: dtrum](https://docs.dynatrace.com/javascriptapi/doc/types/dtrum.html) |
| Health alerts configured | Davis alerts when Web Vitals, user action duration, errors or traffic deviate. | [Health alerts for frontends](https://docs.dynatrace.com/docs/observe/digital-experience/new-rum-experience/analyze-and-alert/health-alerts) |
| Owning team assigned | Problems and alerts route to the team that owns the frontend. | [Assign ownership teams to monitored entities](https://docs.dynatrace.com/docs/deliver/ownership/ownership-classic/assign-ownership), [Best practices for entity ownership](https://docs.dynatrace.com/docs/deliver/ownership/best-practices) |

Cost allocation is deliberately **not** a check: there is no setting and no OpenPipeline stage that sets
`dt.cost.costcenter` / `dt.cost.product` on RUM frontends, so a gauge for it could never be fixed. The
[Cost allocation](cost-allocation.md) tab leaves frontends out for the same reason.

## Before you start

### App scopes used by this page

All scopes are declared in [app.config.json](../app.config.json). The page uses:

| Scope | What this page uses it for |
| --- | --- |
| `storage:entities:read` | DQL on classic entity tables: `dt.entity.application`, `dt.entity.synthetic_test`, `dt.entity.http_check`, `dt.entity.external_synthetic_test` ([`frontendsQuery`](#1-frontendsquery), [`syntheticMonitorsQuery`](#2-syntheticmonitorsquery)). |
| `settings:objects:read` | Page load: read `builtin:rum.web.enablement` (RUM and Session Replay switches) and `builtin:health-experience.frontend-alert` (health alerts). Actions: read `builtin:synthetic.browser.assigned-applications` / `builtin:synthetic.http.assigned-applications` before assigning a monitor, and `builtin:ownership.teams` for the team picker. |
| `settings:objects:write` | Actions: *Enable RUM v2*, *Enable Session Replay*, *Create health alerts*, *Assign an existing synthetic monitor* (all `POST /settings/objects`, also with `validateOnly=true`). |
| `environment-api:credentials:read` | The `user-tags` app function lists and reads the Token credential `architect-assistant-readconfig`; the *Set up the user tagging token* form checks whether it exists. |
| `environment-api:credentials:write` | *Set up the user tagging token*: create or update that credential. |
| `environment-api:api-tokens:write` | *Set up the user tagging token* (automatic mode): create the ReadConfig API token. |
| `environment-api:entities:write` | *Assign owning team*: `POST /api/v2/tags` adds the classic owner tag to frontends. |
| (none) | *Show DQL / Copy / Open in Notebook / Add to Dashboard*, *Create a synthetic monitor*, and the per-frontend links use intents (`sendIntent`, `getIntentLink`); no scope is needed, but the user needs access to the target app. |

The Config API v1 call in the `user-tags` function is authenticated with the stored API token, not with an app scope.

### User permissions

An AppEngine app acts on behalf of the signed-in user: every call is limited by both the app scopes above and the
user's own permissions.

- **To view the page:** read access to classic entities in Grail (`storage:entities:read`) and settings read
  permission on the two schemas read at page load. Without the settings permission the page shows *Reading RUM and
  health alert settings failed*. Example IAM policy statements:

  ```text
  ALLOW storage:entities:read;
  ALLOW settings:objects:read WHERE settings:schemaId IN ("builtin:rum.web.enablement", "builtin:health-experience.frontend-alert", "builtin:synthetic.browser.assigned-applications", "builtin:synthetic.http.assigned-applications", "builtin:ownership.teams");
  ```

- **To run the Settings API actions:** settings write permission on the schemas they write:

  ```text
  ALLOW settings:objects:write WHERE settings:schemaId IN ("builtin:rum.web.enablement", "builtin:health-experience.frontend-alert", "builtin:synthetic.browser.assigned-applications", "builtin:synthetic.http.assigned-applications");
  ```

  Enabling Session Replay is additionally checked by the schema's validators against the license and Session Replay
  storage (the form says so; run *Validate* first).
- **To create the user tagging token automatically:** permission to create API tokens in the environment. The form
  says: "Needs permission to create API tokens; if that is not allowed, paste a token instead." Storing the token needs
  write access to the credential vault.
- **To assign an owning team:** permission to change classic entity tags through the Environment API v2.
- **To use the links:** access to Notebooks, Dashboards, Synthetic, Experience Vitals and the classic web application
  page.
- **Health alerts** run as the user or service user entered as *Actor*; that ID must be valid in the environment.

The exact IAM policy statements or environment roles that back the classic `environment-api:*` scopes are not defined
in the app's code.

### One-time setup

Everything except user tagging works without setup. User tag rules are only exposed by the classic Config API v1
(`GET /api/config/v1/applications/web/{id}`, field `userTags`). The platform has no proxy or SDK client for it, so the
`user-tags` app function calls the environment's classic URL with an API token from the credential vault. Until the
token exists, user tagging is shown as *Not measured* and is left out of every average.

**Option A: let the app do it.** *Actions* > *Set up the user tagging token* > *Create a ReadConfig token
automatically*. See [Set up the user tagging token](#7-set-up-the-user-tagging-token-api).

**Option B: manual.**

1. Create an API token with only the **Read configuration** (`ReadConfig`) scope (Access tokens, see
   [Access tokens](https://docs.dynatrace.com/docs/manage/identity-access-management/access-tokens-and-oauth-clients/access-tokens)).
2. In the [credential vault](https://docs.dynatrace.com/docs/manage/credential-vault), add a **Token** credential named
   exactly `architect-assistant-readconfig` with the **App Engine** scope. Do not restrict it to owner access: every
   user of the app runs the function as themselves, so an owner-only credential only works for its owner (the app
   itself stores it with `ownerAccessOnly: false`). Alternatively paste the token in *Set up the user tagging token* >
   *Store a token I paste*.
3. If the environment enforces the allowlist `builtin:dt-javascript-runtime.allowed-outbound-connections`, add the
   classic host. The function derives it from the app URL:
   - `https://abc12345.apps.dynatrace.com` becomes `https://abc12345.live.dynatrace.com`;
   - any other host drops the `.apps.` label, for example `https://abc12345.sprint.apps.dynatracelabs.com` becomes
     `https://abc12345.sprint.dynatracelabs.com`.

No OAuth client and no other credential is needed.

## Page walkthrough

The tab is rendered by [`FrontendsTab`](../ui/app/tabs/FrontendsTab.tsx#L199). Its data comes from
[`useFrontendsData(tf)`](../ui/app/frontends.ts#L166), which [App.tsx](../ui/app/App.tsx#L54) calls when the app
starts (not when the tab opens), so the data is usually ready by the time you open the tab, and Entity Overview uses
the same data.

Sections in on-screen order:

### Documentation link

A right-aligned *Frontends documentation* link above the tab content opens this page on GitHub
([`TabDocsLink`](../ui/app/areas.tsx#L86)).

### AI Assist panel

Shown at the top of the tab only while the **AI Assist** button in the app header is toggled on. See
[AI Assist on this page](#ai-assist-on-this-page).

### Heading and description

Heading *Frontends* and the text: "Best practices per web frontend: RUM v2 enabled and Session Replay on Grail (the
classic-only variant of each scores 50%), at least one synthetic monitor assigned, a user tag rule configured, at least
one enabled health alert, and an owning team (classic owner tag)."

### Loading, empty and error states

| State | What you see | Rule |
| --- | --- | --- |
| Settings read failed | Red message *Reading RUM and health alert settings failed* with the API error text. | Either of the two Settings API reads threw (`settingsError`). Rows need settings, so the list below is then empty and *No web frontends found in this timeframe.* is shown underneath. |
| DQL failed | Red message *Query failed* with the error text (shared `QueryState`). | `frontendsQuery` returned an error. |
| Loading | *Loading…* | Nothing has been shown yet and either the DQL query is still running without data or the settings have neither data nor an error. |
| No frontends | *No web frontends found in this timeframe.* | The computed list is empty. |
| Refresh after an action | The previous rows stay on screen while settings, user tags and DQL are read again. | `useFrontendsData` keeps the last computed rows in a ref so open forms and their result lines stay mounted. |

Everything below is only rendered when at least one frontend exists.

### User tagging notice

A yellow *User tagging is not measured* message when the `user-tags` function did not return `ok` (status
`no-credential`, `unauthorized` or `error`; nothing is shown while loading). It shows the function's message, followed
by: "User tag rules are only available through the classic Config API. Create an API token with the Read configuration
(ReadConfig) scope, store it in the credential vault as a Token credential named "architect-assistant-readconfig" with
the App Engine scope (or use Actions › Set up the user tagging token below, which can create it for you). Until then,
user tagging is left out of every average."

Possible function messages:

| Status | Message |
| --- | --- |
| `no-credential` | `No Token credential named "architect-assistant-readconfig" found in the credential vault.` / `Could not read the credential vault: <error>` / `Credential "architect-assistant-readconfig" has no token value.` |
| `unauthorized` | `Config API returned 401; the token needs the ReadConfig scope.` (or 403) |
| `error` | `Config API calls to https://<env>.live.dynatrace.com failed for every application (is the host allowlisted?).` or, when the function call itself fails, `Function user-tags has failed`. |

### Summary gauges

[`FrontendsSummary`](../ui/app/tabs/FrontendsTab.tsx#L98): a card with one large gauge and six smaller ones. Every
gauge is the app's custom SVG `PctGauge` (240-degree arc, red-to-green gradient along the arc, integer percent in the
middle, caption and detail line below). On this tab the gauges have no (i) button.

| Gauge | Value | Detail line |
| --- | --- | --- |
| Overall readiness | `round(mean(frontend score))` over all frontends. Each frontend score is itself the rounded mean of its measured checks (see [Checks and scoring](#checks-and-scoring)). | `<N> checks across <M> frontends`, where N is the number of measured (non-null) check scores over all frontends (6 per frontend when user tagging is measured, 5 otherwise). |
| RUM v2 enabled | `round(mean(rum score))` over all frontends (100 / 50 / 0 per frontend). | `<a> v2, <b> classic only` (a = frontends at 100, b = frontends at 50). |
| Session Replay enabled | `round(mean(replay score))` (100 / 50 / 0). | `<a> on Grail, <b> classic only`. |
| Synthetic monitors assigned | `round(mean(synthetics score))` (100 / 0), equal to the share of frontends with at least one monitor. | `<a> of <n> frontends pass`. |
| User tagging configured | `round(mean(usertags score))` over the frontends where it was measured. | `<a> of <n> frontends pass` (n = measured frontends). If no frontend was measured, a dashed *Not measured* placeholder with *no data for any frontend* replaces the gauge. |
| Health alerts configured | `round(mean(health score))` (100 / 0). | `<a> of <n> frontends pass`. |
| Owning team assigned | `round(mean(owner score))` (100 / 0). | `<a> of <n> frontends pass`. |

Rounding is JavaScript `Math.round` (halves round up).

### RUM overview tiles and donut

[`RumOverview`](../ui/app/tabs/FrontendsTab.tsx#L117): four tiles and a donut chart.

| Tile | Value | Subtitle |
| --- | --- | --- |
| Frontends | Number of frontends (rows of `frontendsQuery`). | *web frontends* |
| RUM classic enabled | Frontends whose effective `rum.enabled` is true (this includes the RUM v2 ones). | `of <M> frontends` |
| RUM v2 enabled | Frontends with `rum.enabled` and `rum.enabledOnGrail` true. | `of <M> frontends` |
| Session Replay enabled | Frontends with `rum.enabled` and `sessionReplay.enabled` true (classic or Grail). | `<g> on Grail, of <M> frontends` (g = also `sessionReplay.enabledOnGrail`). |

**Frontends by RUM status** (custom SVG donut, `Donut` from [ModePie.tsx](../ui/app/tabs/ModePie.tsx#L28)): one slice
per RUM status with at least one frontend, in this order and colour:

| Slice | Colour | Frontends counted |
| --- | --- | --- |
| RUM v2 + classic | blue `#4589FF` | `rum = "both"` (RUM v2 enabled) |
| RUM classic only | ochre `#D2A106` | `rum = "classic"` |
| RUM disabled | pink `#EE5396` | `rum = "disabled"` |

The centre shows the total and *Frontends*; hovering a slice or its legend row enlarges the slice, dims the others and
puts that slice's count and label in the centre. Each slice has a native tooltip `<label>: <count> (<share>%)`; the
legend lists count and rounded share per slice. Slices are not clickable on this tab (no filter is applied). If there
are no slices the card says *No frontends found.* The same colours mark the RUM column of the table.

### DQL actions for the frontend query

A `QueryActions` row (title *Web frontends and assigned synthetic monitors*) for [`frontendsQuery`](#1-frontendsquery):

- **Show DQL / Hide DQL** toggles the query text below the buttons.
- **Copy** copies the query to the clipboard (button shows *Copied* for 1.5 s).
- **Open in Notebook** sends intent `view-query` to `dynatrace.notebooks` with payload
  `{ "dt.query": <query>, "title": "Web frontends and assigned synthetic monitors" }`.
- **Add to Dashboard** sends intent `add-to-dashboard` to `dynatrace.dashboards` with the same payload.

The exposed text is the query without the internal refresh comment (see [Parameters](#1-frontendsquery)).

### Frontend checks

[`FrontendDetail`](../ui/app/tabs/FrontendsTab.tsx#L164): a card with heading *Frontend checks* and a **Frontend**
dropdown listing every frontend by name (query order, name ascending). The first frontend is selected initially; if
the selected frontend disappears after a refresh, the first one is shown again.

For the selected frontend it shows a large *Frontend score* gauge (its score; the detail line is the frontend's
`APPLICATION-…` ID) and one gauge per check ([`checkGauge`](../ui/app/tabs/FrontendsTab.tsx#L142)):

| Gauge | Value | Detail text |
| --- | --- | --- |
| RUM v2 enabled | 100 / 50 / 0 | *RUM v2 + classic enabled*, *RUM classic only (50%)*, *RUM disabled* |
| Session Replay enabled | 100 / 50 / 0 | *Session Replay on Grail*, *Session Replay classic only (50%)*, *Session Replay off* |
| Synthetic monitors assigned | 100 / 0 | *No monitors assigned*, or `<n> monitors assigned (<b> browsers, <h> HTTP…, <t> third-party…)` listing only the non-zero kinds |
| User tagging configured | 100 / 0, or a *Not measured* placeholder | Measured: `<n> rules configured` or *No user tag rule*. Not measured: *Loading…* (function still running), *Config API call failed* (function returned `ok` but this frontend's call failed or it was not sent), *ReadConfig token missing* (any other function status) |
| Health alerts configured | 100 / 0 | `<n> health alerts configured` or *No health alerts* |
| Owning team assigned | 100 / 0 | `Owner: <team>` or *No owner tag (dt.owner, owner or team)* |

Below the gauges, the same `QueryActions` row as above (same query, same title).

### All frontends table

Heading *All frontends* and a Strato `DataTable` (sortable on every column, full width, condensed rows, no paging,
every frontend is a row). Initial order is the query order (name ascending).

| Column | Content | Source |
| --- | --- | --- |
| Frontend | Frontend name. | `name` from `frontendsQuery` (`entity.name`, falling back to the ID). |
| RUM | Coloured square plus *RUM v2 + classic* / *RUM classic only* / *RUM disabled*. Sorts by the label text. | Effective `builtin:rum.web.enablement` value. |
| Session Replay | *On Grail*, *Classic only* or *Off*. | Effective `builtin:rum.web.enablement` value. |
| Synthetic monitors | Number of browser, HTTP and third-party monitors assigned. | `monitors` from `frontendsQuery`. |
| User tag rules | Number of user tag rules, or *n/a* when not measured. | `user-tags` function (`userTags` array length). |
| Health alerts | Number of enabled health alert objects that list this frontend. | `builtin:health-experience.frontend-alert`. |
| Owning team | Team from the first owner tag, or *—*. | `owner` from `frontendsQuery`. |
| Score | Frontend score in percent, coloured on the same red-to-green scale as the gauges. | `scoreFrontend`. |

### Actions

The section at the bottom (anchor `frontends-actions`). It is described in full under
[Remediation actions](#remediation-actions).

### Entity Overview integration

The same data feeds the [Entity Overview](entity-overview.md) tab:

- **Frontend overall readiness gauge** in the summary row: `round(mean(frontend score))`, detail `avg of <M> frontends`,
  with an (i) button that opens this tab. It counts as one extra check in Entity Overview *Overall readiness*
  (`round(mean(all check percentages + frontend readiness))`). It is left out while frontend data is loading, when the
  settings read failed, or when there are no frontends.
- **Top 5 findings**: one candidate row per frontend check ([`frontendFindingRows`](../ui/app/tabs/CoverageTabs.tsx#L163)):
  part = frontends scoring exactly 100, total = frontends where the check was measured, percentage = rounded mean
  score (so a RUM check where every frontend is classic-only shows 50% with 0 passing). Checks at 100% are skipped.
  Frontend findings rank after hosts, Kubernetes nodes and clusters and before containers, at most two of them are
  shown, and their text reads `None of the <n> frontends have <phrase>.` or `Only <p>% of frontends have <phrase>
  (<part> of <total>).` The *Remediation steps* button opens this tab.
- **Frontends card** at the bottom of Entity Overview: the six check gauges (no overall gauge) with an (i) button on
  each that opens this tab and scrolls to the Actions section, plus a `QueryActions` row titled *Frontends* for the
  same query.

## Checks and scoring

Per-frontend scores are computed in [`scoreFrontend`](../ui/app/frontends.ts#L78). A check is either 100 (in place),
50 (classic-only variant, RUM and Session Replay only), 0 (missing), or `null` (not measured, left out of every
average).

| Check | In place (100) when | 50 when | 0 when | Not measured when | Data source |
| --- | --- | --- | --- | --- | --- |
| RUM v2 enabled (`rum`) | Effective `rum.enabled` and `rum.enabledOnGrail` are both true. | `rum.enabled` true, `rum.enabledOnGrail` not true. | `rum.enabled` not true (even if `enabledOnGrail` is true). | Never. | `builtin:rum.web.enablement` |
| Session Replay enabled (`replay`) | `rum.enabled`, `sessionReplay.enabled` and `sessionReplay.enabledOnGrail` all true. | `rum.enabled` and `sessionReplay.enabled` true, `enabledOnGrail` not true. | `rum.enabled` or `sessionReplay.enabled` not true. | Never. | `builtin:rum.web.enablement` |
| Synthetic monitors assigned (`synthetics`) | `monitors > 0` (browser + HTTP + third-party monitors whose `monitors` relationship contains the frontend). | — | `monitors = 0`. | Never. | `frontendsQuery` |
| User tagging configured (`usertags`) | At least one entry in the Config API `userTags` array. | — | `userTags` is empty or absent. | The function status is not `ok` (no credential, unauthorized, error, still loading), or the frontend's own Config API call failed, or the frontend was not sent (more than 500 frontends, or an ID that does not match `APPLICATION-[0-9A-F]+`). | `user-tags` function |
| Health alerts configured (`health`) | At least one enabled `builtin:health-experience.frontend-alert` object lists the frontend ID in `frontends`. | — | None. Alerts with `enabled: false` do not count. | Never. | Settings API |
| Owning team assigned (`owner`) | The frontend has a classic tag `dt.owner:<team>`, `owner:<team>` or `team:<team>` with a non-empty team. | — | No such tag. | Never. | `frontendsQuery` (`tags`) |

**Effective enablement value.** `builtin:rum.web.enablement` is read for all scopes. A frontend's own object (scope =
its `APPLICATION-…` ID) wins; otherwise the frontend inherits the `environment`-scope object and is flagged
`inherited`. If neither exists, every switch is read as false.

**Derived values:**

| Value | Rule |
| --- | --- |
| RUM status | `both` (label *RUM v2 + classic*) when RUM v2 is enabled; `classic` (*RUM classic only*) when only `rum.enabled`; otherwise `disabled` (*RUM disabled*). |
| Frontend score | `round(sum(measured check scores) / number of measured checks)`; 0 if nothing was measured. Example: RUM classic only (50), Session Replay off (0), 2 monitors (100), user tagging not measured (null), 1 health alert (100), owner `team-a` (100): (50 + 0 + 100 + 100 + 100) / 5 = **70**. With user tagging measured and 0 rules, RUM v2 (100), replay classic only (50), and nothing else: (100 + 50 + 0 + 0 + 0 + 0) / 6 = **25**. |
| Overall readiness (this tab) | `round(mean(frontend score))` over all frontends. |
| Check gauge | `round(mean(check score))` over frontends where the check is measured. |
| Frontend overall readiness (Entity Overview) | Same formula as Overall readiness. |
| Picker status in Actions | Per action: *fails* / *passes* or a custom note, see [Remediation actions](#remediation-actions). |
| Impact line in Actions | `<a> without RUM v2, <b> without Session Replay on Grail, <c> without synthetic monitors, <d> without health alerts[, <e> without user tag rules], <f> without an owning team.` a = not RUM v2; b = not Session Replay on Grail; c = 0 monitors; d = 0 health alerts; e = 0 user tag rules (only when user tagging is measured; frontends that are not measured are not counted); f = no owner. |

There are no Blocking / Check / Info statuses on this tab.

## Queries

| # | Name (function in source) | Runs when | Feeds |
| --- | --- | --- | --- |
| 1 | Web frontends and assigned synthetic monitors ([`frontendsQuery`](../ui/app/queries.ts#L705)) | App start (in [App.tsx](../ui/app/App.tsx#L54)), on every timeframe change, and after every successful action that calls `reload` | Every section of the tab; Entity Overview frontend gauge, Top findings and Frontends card |
| 2 | Synthetic monitors and assigned frontends ([`syntheticMonitorsQuery`](../ui/app/queries.ts#L752)) | When *Actions* > *Assign an existing synthetic monitor* is selected; re-runs on timeframe change while it is open | The *Monitor* dropdown of that action |

Both queries run in the browser through `useDql` ([ui/app/useDql.ts](../ui/app/useDql.ts), a wrapper around
`@dynatrace-sdk/react-hooks` `useDql`), which re-runs a query whenever its text changes. They need
`storage:entities:read`.

### 1. frontendsQuery

- **Source:** `frontendsQuery(tf)` in [ui/app/queries.ts](../ui/app/queries.ts#L705), with the owner fields from
  `classicOwnerFields` ([L692-L695](../ui/app/queries.ts#L692-L695)). Called from
  [`useFrontendsData`](../ui/app/frontends.ts#L166).
- **Runs:** once when the app starts (the result is shared with Entity Overview), again when the timeframe changes, and
  again after every successful *Enable RUM v2*, *Enable Session Replay*, *Create health alerts*, *Assign owning team*
  and *Set up the user tagging token* action.
- **Parameters:**
  - `tf` (app header timeframe): every `from:now()-24h` (four of them: the application fetch and the three synthetic
    fetches) becomes `from:now()-7d` or `from:now()-30d`.
  - Refresh marker: after the *n*-th successful action the hook runs the query with `\n// refresh <n>` appended
    ([`refreshMarker`](../ui/app/queries.ts#L698)), for example a last line `// refresh 1`. DQL ignores the comment;
    it only changes the text so the SDK runs the query again. *Show DQL* / *Copy* / *Open in Notebook* use the text
    without it.
  - The owner tag keys come from `OWNER_KEYS` = `dt.owner`, `owner`, `team`.
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

- **How it works:**
  1. `fetch dt.entity.application, from:now()-24h` reads the classic entity table of RUM web applications that existed
     at any point in the timeframe. Longer timeframes also count frontends that existed earlier in the window,
     including removed ones.
  2. `fields id, name = entity.name, tags` keeps the entity ID (`APPLICATION-…`), its display name and its classic
     tags. `tags` is an array of strings such as `dt.owner:team-checkout` or `environment:prod`.
  3. `fieldsAdd ownerTags = if(startsWith(tags[], "dt.owner:") or …, tags[])` is an iterative array expression: `tags[]`
     evaluates the condition for every element, so `ownerTags` is an array of the same length holding the tag where it
     starts with one of the owner keys followed by a colon, and null elsewhere.
  4. `arrayRemoveNulls(ownerTags)` drops the nulls, leaving only owner tags, in their original order.
  5. `owner = if(arraySize(ownerTags) > 0, substring(ownerTags[0], from: indexOf(ownerTags[0], ":") + 1))` takes the
     first owner tag and keeps the text after its first colon (the team identifier). Without an owner tag, `owner` is
     null.
  6. `fieldsRemove tags, ownerTags` drops the helper fields.
  7. `lookup [ … ]` joins a per-application monitor count built by the subquery:
     - `fetch dt.entity.synthetic_test` (browser monitors), then `append` of `dt.entity.http_check` (HTTP monitors) and
       `dt.entity.external_synthetic_test` (third-party monitors), each over the same timeframe.
     - `app = monitors[dt.entity.application]` reads the classic `monitors` relationship of each monitor, restricted to
       application targets: an array of the `APPLICATION-…` IDs the monitor is assigned to. `kind` labels the source.
     - `expand app` turns each monitor into one record per assigned application; `filter isNotNull(app)` drops
       monitors without an application.
     - `summarize … by:{app}` counts, per application ID, all monitors and the browser / HTTP / third-party ones
       (`countIf`).
     - `sourceField:id, lookupField:app` matches each frontend's `id` to `app`; `fields:{monitors, browser, http,
       thirdparty}` adds those four fields under their own names.
  8. `fieldsAdd … coalesce(…, 0)` turns the counts of frontends without any monitor (no lookup match) from null into 0.
  9. `sort name asc` orders frontends by name; this is the default order of the dropdown and the table.
- **Output:** one record per frontend.

  | Field | Used for |
  | --- | --- |
  | `id` | Row key; matched against settings scopes, health alert `frontends`, user tag results; sent to the `user-tags` function; target of every action. |
  | `name` | Dropdown, table, pickers, AI Assist lists. |
  | `owner` | *Owning team assigned* check, table column, *Assign owning team* (frontends without an owner are preselected). |
  | `monitors` | *Synthetic monitors assigned* check, table column, monitor pickers. |
  | `browser`, `http`, `thirdparty` | Detail line of the per-frontend synthetic gauge. |

- **Client-side join** ([`useFrontendsData`](../ui/app/frontends.ts#L166)), step by step, once both the DQL result and
  the settings are available:
  1. Build a map scope → value from all `builtin:rum.web.enablement` objects; the `environment` entry is the default.
  2. Build a map frontend ID → list of `alertKey` from the enabled `builtin:health-experience.frontend-alert` objects
     (every ID in each object's `frontends` array).
  3. For each DQL record: pick the frontend's own enablement value or the default, compute `rumClassic`, `rumV2`,
     `replayClassic`, `replayGrail` and the RUM status; `healthAlerts` = number of alert keys; `userTagRules` = the
     function's count for this ID when its status is `ok` and the ID is in its result, else `null`.
  4. Compute the per-check scores and the frontend score (`scoreFrontend`).
  5. Numeric fields go through `num()` (non-numeric becomes 0).
  The rows are recomputed whenever the DQL result, the settings or the user tag result changes, so the user tagging
  gauges switch from *Not measured* to a value once the function returns.
- **Limits and cost:** no `limit`; every web application in the timeframe is returned. Four classic entity fetches;
  entity tables are small compared to logs or spans, and the query carries an explicit `from:`.
- **Open it yourself:** yes, three places: below the RUM tiles and in the *Frontend checks* card on this tab (title
  *Web frontends and assigned synthetic monitors*), and on the Entity Overview Frontends card (title *Frontends*).

### 2. syntheticMonitorsQuery

- **Source:** `syntheticMonitorsQuery(tf)` in [ui/app/queries.ts](../ui/app/queries.ts#L752), called from
  [`AssignMonitorForm`](../ui/app/tabs/FrontendActions.tsx#L234).
- **Runs:** when the *Assign an existing synthetic monitor* action is selected (the form mounts and runs it). Re-runs on
  timeframe change. It is not refreshed after an assignment.
- **Parameters:** `tf` only: both `from:now()-24h` become `from:now()-7d` / `from:now()-30d`.
- **Query** (24 h):

```dql
fetch dt.entity.synthetic_test, from:now()-24h
| fieldsAdd kind = "Browser", apps = monitors[dt.entity.application]
| append [fetch dt.entity.http_check, from:now()-24h | fieldsAdd kind = "HTTP", apps = monitors[dt.entity.application]]
| fields id, name = entity.name, kind, apps
| sort name asc
| limit 1000
```

- **How it works:**
  1. `fetch dt.entity.synthetic_test` reads browser monitors; `kind = "Browser"`; `apps` is the array of application
     IDs from the `monitors` relationship.
  2. `append [fetch dt.entity.http_check …]` adds HTTP monitors the same way with `kind = "HTTP"`. Third-party
     monitors are not included because they cannot be assigned through these schemas.
  3. `fields id, name = entity.name, kind, apps` keeps the monitor ID (`SYNTHETIC_TEST-…` or `HTTP_CHECK-…`), name,
     kind and assigned applications.
  4. `sort name asc` and `limit 1000`: the first 1,000 monitors by name.
- **Output:**

  | Field | Used for |
  | --- | --- |
  | `id` | Selected monitor; decides the schema (`HTTP_CHECK-` prefix = HTTP schema, else browser schema) and is the settings scope. |
  | `name` | Dropdown option text `<kind> · <name>`, confirmation text. |
  | `kind` | Option prefix (*Browser* or *HTTP*; anything other than `HTTP` is shown as *Browser*). |
  | `apps` | Frontends already assigned: marked *already assigned to this monitor* in the picker, excluded from the new IDs, and shown in the request preview. |

- **Limits and cost:** at most 1,000 monitors; monitors beyond that (by name) cannot be picked.
- **Open it yourself:** yes, a `QueryActions` row titled *Synthetic monitors and assigned frontends* at the bottom of
  the action form.

## API calls

Settings and Environment API v2 calls go through `@dynatrace-sdk/client-classic-environment-v2`, which sends them to
`/platform/classic/environment-api/v2/…` (shown below as `…/v2/…`). DQL runs through the Grail query API
(`/platform/storage/query/v1/query:execute` and `query:poll`).

| # | Method | Endpoint or SDK method | Scope | When |
| --- | --- | --- | --- | --- |
| 1 | GET | `…/v2/settings/objects` schema `builtin:rum.web.enablement` (`settingsObjectsClient.getSettingsObjects`) | `settings:objects:read` | App start; after each reloading action |
| 2 | GET | `…/v2/settings/objects` schema `builtin:health-experience.frontend-alert`, scope `environment` | `settings:objects:read` | App start; after each reloading action |
| 3 | POST | `/api/user-tags` app function (`functions.call("user-tags")`) | function uses `environment-api:credentials:read` | When the DQL result has frontends; when the frontend ID list changes; after each reloading action |
| 3a | GET | `…/v2/credentials?name="architect-assistant-readconfig"&type=TOKEN` (inside the function) | `environment-api:credentials:read` | Each function run |
| 3b | GET | `…/v2/credentials/{id}/details` (inside the function) | `environment-api:credentials:read` | Each function run, if the credential exists |
| 3c | GET | `https://<env>.live.dynatrace.com/api/config/v1/applications/web/{APPLICATION-id}` (inside the function) | API token `ReadConfig` | Once per frontend, 8 in parallel |
| 4 | POST | `…/v2/settings/objects?validateOnly=…` with `builtin:rum.web.enablement` objects | `settings:objects:write` | *Enable RUM v2* / *Enable Session Replay*: Validate or apply |
| 5 | POST | `…/v2/settings/objects?validateOnly=…` with `builtin:health-experience.frontend-alert` objects | `settings:objects:write` | *Create health alerts*: Validate or apply |
| 6 | GET | `…/v2/settings/objects` schema `builtin:synthetic.browser.assigned-applications` or `builtin:synthetic.http.assigned-applications`, scope = monitor ID | `settings:objects:read` | *Assign an existing synthetic monitor*: Validate or apply |
| 7 | POST | `…/v2/settings/objects?validateOnly=…` with one assigned-applications object | `settings:objects:write` | Same, after call 6 |
| 8 | GET | `…/v2/settings/objects` schema `builtin:ownership.teams`, scope `environment` | `settings:objects:read` | *Assign owning team* form opens |
| 9 | POST | `…/v2/tags?entitySelector=…&from=now-30d` (`monitoredEntitiesCustomTagsClient.postTags`) | `environment-api:entities:write` | *Assign owning team*: apply (one per 60 frontends) |
| 10 | GET | `…/v2/credentials?name="architect-assistant-readconfig"&type=TOKEN` (`credentialVaultClient.listCredentials`) | `environment-api:credentials:read` | *Set up the user tagging token* form opens; before storing; after storing |
| 11 | POST | `…/v2/apiTokens` (`accessTokensApiTokensClient.createApiToken`) | `environment-api:api-tokens:write` | *Create and store token* (automatic mode) |
| 12 | POST / PUT | `…/v2/credentials` / `…/v2/credentials/{id}` (`createCredentials` / `updateCredentials`) | `environment-api:credentials:write` | Storing the token (after 11, or with a pasted token) |
| 13 | Intent | `dynatrace.notebooks` `view-query`, `dynatrace.dashboards` `add-to-dashboard` | none | *Open in Notebook* / *Add to Dashboard* |
| 14 | Intent | `dynatrace.synthetic` `create_synthetic_monitor_with_assigned_frontends` | none | *Create a synthetic monitor* button |
| 15 | Intent link | `dynatrace.classic.web` `view-application`; `dynatrace.experience.vitals` `view-frontend` | none | Links in *Configure user tagging* and *Open frontend settings* |

### 1. Read RUM and Session Replay enablement

- **SDK:** `settingsObjectsClient.getSettingsObjects` in `listAll` ([frontends.ts](../ui/app/frontends.ts#L94)).
- **Request:** `GET …/v2/settings/objects?schemaIds=builtin:rum.web.enablement&fields=scope,value&pageSize=500`. No
  `scopes` filter, so objects of every scope (the `environment` object and per-frontend objects) are returned. Later
  pages send only `nextPageKey=<key>` (the API requires it to be the only parameter) until no `nextPageKey` is
  returned.
- **Response fields used:** `items[].scope` (`environment` or an `APPLICATION-…` ID), `items[].value.rum.enabled`,
  `value.rum.enabledOnGrail`, `value.sessionReplay.enabled`, `value.sessionReplay.enabledOnGrail`. The whole `value`
  is kept as the frontend's effective value, so the enablement actions can write it back with only the switches
  changed. `nextPageKey`.
- **When:** in parallel with call 2 when the app starts and after every reloading action. Not on timeframe change.
- **Failure:** either read failing sets the *Reading RUM and health alert settings failed* message.

### 2. Read frontend health alerts

- **Request:** `GET …/v2/settings/objects?schemaIds=builtin:health-experience.frontend-alert&scopes=environment&fields=scope,value&pageSize=500`,
  paged the same way.
- **Response fields used:** `items[].value.enabled` (objects with `false` are ignored), `value.frontends` (array of
  `APPLICATION-…` IDs), `value.alertKey` (alert type, used to skip existing types in *Create health alerts*).

### 3. user-tags app function

- **Client call:** `functions.call("user-tags", { data: { appIds } })` from `@dynatrace-sdk/app-utils`
  ([frontends.ts](../ui/app/frontends.ts#L136)), which sends `POST /api/user-tags` with the JSON body:

  ```json
  { "appIds": ["APPLICATION-0000000000000001", "APPLICATION-0000000000000002"] }
  ```

  `appIds` are the `id` values of `frontendsQuery`. The call is skipped when there are no frontends. A non-2xx
  response from the function endpoint becomes status `error` with `Function user-tags has failed`.
- **Function logic** ([api/user-tags.function.ts](../api/user-tags.function.ts)):
  1. Keep only IDs matching `^APPLICATION-[0-9A-F]+$`, at most 500.
  2. **Call 3a:** `credentialVaultClient.listCredentials({ name: "\"architect-assistant-readconfig\"", type: "TOKEN" })`.
     It takes the credential whose name matches exactly, else the first one returned. None: status `no-credential`.
     An exception: status `no-credential` with `Could not read the credential vault: <error>`.
  3. **Call 3b:** `credentialVaultClient.getCredentialsDetails({ id })`, field `token`. Empty: `no-credential`.
  4. Derive the classic URL from `getEnvironmentUrl()` (`.apps.dynatrace.com` becomes `.live.dynatrace.com`;
     otherwise `.apps.` becomes `.`).
  5. **Call 3c:** 8 workers take IDs from a queue and send
     `GET <classic>/api/config/v1/applications/web/<id>` with header `Authorization: Api-Token <token>`.
     - 401 or 403: stop all workers, return `unauthorized` with `Config API returned <code>; the token needs the
       ReadConfig scope.`
     - Other non-2xx or a network error: add the ID to `failed`.
     - 2xx: `rules[id]` = length of the response's `userTags` array (0 if absent).
  6. If every ID failed: `error` with `Config API calls to <classic> failed for every application (is the host
     allowlisted?).` Otherwise `ok`.
- **Response:**

  ```json
  { "status": "ok", "rules": { "APPLICATION-0000000000000001": 2, "APPLICATION-0000000000000002": 0 }, "failed": [] }
  ```

  or `{ "status": "no-credential" | "unauthorized" | "error", "message": "…" }`. The UI uses `status`, `rules` and
  `message`; `failed` IDs are simply missing from `rules` and show as not measured.

### 4. to 15.

Calls 4 to 12 are the write and helper calls of the actions; their request bodies, triggers and results are described
per action in [Remediation actions](#remediation-actions). Calls 13 to 15 are intents and need no scope.

## Remediation actions

The **Actions** card at the bottom of the tab ([`FrontendActions`](../ui/app/tabs/FrontendActions.tsx#L439)) has a
heading, the impact line (see [Checks and scoring](#checks-and-scoring)), and an **Action** dropdown. Options are
prefixed *API ·* (writes through an API) or *Link ·* (opens a Dynatrace page). The selected action's form is shown
below; switching actions resets the form. A *Documentation:* row with the action's links is shown under every form.

The dropdown starts on *Enable RUM v2*, or on *Set up the user tagging token* when the `user-tags` function reported
`no-credential` or `unauthorized` (the selection switches once that status is known).

Common behaviour of the Settings API actions (*Enable RUM v2*, *Enable Session Replay*, *Create health alerts*,
*Assign an existing synthetic monitor*), from `ApplyControls` and `summarize` in
[frontendActions.ts](../ui/app/frontendActions.ts#L33):

- **Frontend picker:** a scrollable checkbox list of every frontend with a status note, and buttons
  *Failing (n)* (select the frontends that fail this check), *All (n)* and *None*. The frontends that fail are
  preselected.
- **Request preview:** a collapsible *Request (…)* block with a *Copy* button, showing the first two objects of the
  body and `// … <n> more objects in the same request` for the rest.
- **Confirmation:** a checkbox with the exact change; the apply button is disabled until it is ticked.
- **Validate:** sends the same request with `validateOnly=true`. Result: `Validation passed for <n> <items>. Nothing was
  changed.` or `<k> of <n> <items> rejected: <first error message>`.
- **Apply:** the same request with `validateOnly=false`. The confirmation is cleared afterwards. On success the whole
  tab reloads (settings, user tags and DQL), except for the monitor assignment.
- **Errors** from the SDK are shown as their API message (`errorMessage` in
  [remediation.ts](../ui/app/remediation.ts#L99)). Results are shown in a status line (green or red edge).
- All writes are one request for any number of frontends.

### 1. Enable RUM v2 (API)

- **Fixes:** *RUM v2 enabled* (frontends at 0 or 50).
- **Text:** "Turns on RUM v2 (New RUM Experience, data in Grail) and keeps RUM classic on, which RUM v2 requires. Cost
  and traffic control and every other value stay as they are."
- **Picker:** preselects frontends without RUM v2; note per frontend `<RUM v2 | RUM classic only | RUM off> · <Replay
  on Grail | Replay classic only | Replay off>[ · inherits environment]`.
- **Body** ([`buildEnablementBody`](../ui/app/frontendActions.ts#L57), [`enablementValue`](../ui/app/frontendActions.ts#L43)):
  one object per selected frontend, `schemaId: builtin:rum.web.enablement`, `scope` = the frontend ID, `value` = a
  deep copy of the frontend's effective value (its own object or the inherited environment object) with:
  - `rum.costAndTrafficControl` defaulting to 100 and `sessionReplay.costAndTrafficControl` to 100,
    `sessionReplay.enabled` to false, when absent;
  - `rum.enabled = true` and `rum.enabledOnGrail = true`;
  - every other property (for example `experienceAnalytics`) unchanged.

  Example (`POST …/v2/settings/objects?validateOnly=false`):

  ```json
  [
    {
      "schemaId": "builtin:rum.web.enablement",
      "scope": "APPLICATION-0000000000000001",
      "value": {
        "rum": { "costAndTrafficControl": 100, "enabled": true, "enabledOnGrail": true },
        "sessionReplay": { "costAndTrafficControl": 100, "enabled": false }
      }
    },
    {
      "schemaId": "builtin:rum.web.enablement",
      "scope": "APPLICATION-0000000000000002",
      "value": {
        "rum": { "costAndTrafficControl": 25, "enabled": true, "enabledOnGrail": true },
        "sessionReplay": { "costAndTrafficControl": 10, "enabled": true },
        "experienceAnalytics": { "enabled": true }
      }
    }
  ]
  ```

- **Confirmation:** `Change the RUM enablement setting of <n> frontends`. Button: **Enable RUM v2**.
- **Success:** `RUM v2 enabled on <n> frontends. Auto-injected frontends pick it up within minutes; manually inserted
  snippets must be updated.` The tab reloads.
- **Note:** a frontend that inherited the environment value gets its own object, so later changes to the
  environment-scope object no longer apply to it.
- **Documentation:** [Enable the New RUM Experience for RUM Classic web applications](https://docs.dynatrace.com/docs/observe/digital-experience/new-rum-experience/web-frontends/initial-setup/enable-new-rum-for-web-apps).

### 2. Enable Session Replay (API)

- **Fixes:** *Session Replay enabled* (frontends without Session Replay on Grail).
- **Text:** "Turns on Session Replay (and RUM classic, which it requires). Session Replay on Grail scores 100%, classic
  only 50%. Replay validators check your license and Session Replay storage, so run Validate first."
- **Field:** checkbox *Also enable Session Replay on Grail (latest Session Replay)*, ticked by default.
- **Picker:** preselects frontends without Session Replay on Grail; same note as above.
- **Body:** as for RUM v2, but sets `rum.enabled = true`, `sessionReplay.enabled = true`, and
  `sessionReplay.enabledOnGrail = true` only when the checkbox is ticked. `rum.enabledOnGrail` is not touched; when the
  checkbox is cleared, an existing `sessionReplay.enabledOnGrail` value is kept. Example with the checkbox ticked:

  ```json
  [
    {
      "schemaId": "builtin:rum.web.enablement",
      "scope": "APPLICATION-0000000000000001",
      "value": {
        "rum": { "costAndTrafficControl": 100, "enabled": true },
        "sessionReplay": { "costAndTrafficControl": 100, "enabled": true, "enabledOnGrail": true }
      }
    }
  ]
  ```

- **Confirmation:** `Change the RUM enablement setting of <n> frontends`. Button: **Enable Session Replay**.
- **Success:** `Session Replay (classic + Grail) enabled on <n> frontends. …` (or `Session Replay classic enabled …`).
  The tab reloads.
- **Documentation:** [Activate Session Replay for web frontends](https://docs.dynatrace.com/docs/observe/digital-experience/session-replay-latest/configure-session-replay-web/latest-enable-session-replay-web).

### 3. Create health alerts (API)

- **Fixes:** *Health alerts configured*.
- **Text:** "Creates one health alert per selected type for the selected frontends (up to 100 frontends per alert).
  Frontends that already have an enabled alert of a type are skipped for that type. Analyzer settings are the
  defaults; tune them later in Experience Vitals. An environment allows up to 300 health alerts."
- **Fields:**
  - **Alert types** (checkboxes, [`WEB_ALERTS`](../ui/app/frontendActions.ts#L75)):

    | Type (`alertKey`) | Label | Analyzer | Preselected |
    | --- | --- | --- | --- |
    | `webVitalsLcp` | Web Vitals - LCP | AutoAdaptive | yes |
    | `webVitalsInp` | Web Vitals - INP | AutoAdaptive | yes |
    | `webVitalsCls` | Web Vitals - CLS | AutoAdaptive | yes |
    | `userActionDuration` | User Action Duration | AutoAdaptive | yes |
    | `errorRateRequestErrors` | Error Rate - Request Errors | SeasonalBaseline | yes |
    | `errorRateExceptions` | Error Rate - Exceptions | SeasonalBaseline | yes |
    | `trafficDrop` | Traffic Drop | SeasonalBaseline | no |
    | `trafficSpike` | Traffic Spike | SeasonalBaseline | no |

    Analyzer inputs: AutoAdaptive `autoAdaptiveAnalyzerInput` = `{ dealertingSamples: 5, numberOfSignalFluctuations: 1,
    slidingWindow: 5, violatingSamples: 3 }`; SeasonalBaseline `seasonalBaselineAnalyzerInput` = `{ dealertingSamples:
    5, slidingWindow: 5, tolerance: 4, violatingSamples: 3 }` (the schema defaults according to the code).
  - **Actor** (text): the user or service user ID the alert runs as; defaults to your own user ID
    (`getCurrentUserDetails().id`). Hint: "Defaults to you. Dynatrace recommends a service user so the alert keeps
    running if your account changes."
  - **Picker:** preselects frontends with no enabled alert; note `<n> alerts` or `no alerts`.
- **Body** ([`buildHealthAlertBody`](../ui/app/frontendActions.ts#L91)): for each selected type, the selected
  frontends that do not already have an enabled alert with that `alertKey`, split into chunks of 100; one
  environment-scope object per chunk. Title = the label, or `<label> (<i>/<k>)` when a type needs more than one chunk.
  A type with no remaining frontends produces no object. Example for two frontends where the second already has an
  LCP alert (first two of six objects):

  ```json
  [
    {
      "schemaId": "builtin:health-experience.frontend-alert",
      "scope": "environment",
      "value": {
        "actor": "00000000-0000-0000-0000-000000000000",
        "alertKey": "webVitalsLcp",
        "enabled": true,
        "title": "Web Vitals - LCP",
        "frontends": ["APPLICATION-0000000000000001"],
        "analyzerType": "AutoAdaptive",
        "autoAdaptiveAnalyzerInput": { "dealertingSamples": 5, "numberOfSignalFluctuations": 1, "slidingWindow": 5, "violatingSamples": 3 }
      }
    },
    {
      "schemaId": "builtin:health-experience.frontend-alert",
      "scope": "environment",
      "value": {
        "actor": "00000000-0000-0000-0000-000000000000",
        "alertKey": "webVitalsInp",
        "enabled": true,
        "title": "Web Vitals - INP",
        "frontends": ["APPLICATION-0000000000000001", "APPLICATION-0000000000000002"],
        "analyzerType": "AutoAdaptive",
        "autoAdaptiveAnalyzerInput": { "dealertingSamples": 5, "numberOfSignalFluctuations": 1, "slidingWindow": 5, "violatingSamples": 3 }
      }
    }
  ]
  ```

  The SeasonalBaseline types carry `"analyzerType": "SeasonalBaseline"` and `"seasonalBaselineAnalyzerInput":
  { "dealertingSamples": 5, "slidingWindow": 5, "tolerance": 4, "violatingSamples": 3 }` instead.
- **Request label:** `Request (1 API call, <n> alerts)`. Validate and apply are disabled while the body is empty or
  the actor is blank.
- **Confirmation:** `Create <n> health alerts for <m> frontends`. Button: **Create health alerts**.
- **Success:** `<n> health alerts created.` The tab reloads.
- **Documentation:** [Health alerts for frontends](https://docs.dynatrace.com/docs/observe/digital-experience/new-rum-experience/analyze-and-alert/health-alerts).

### 4. Assign an existing synthetic monitor (API)

- **Fixes:** *Synthetic monitors assigned*.
- **Text:** "Adds the selected frontends to an existing browser or HTTP monitor. The monitor's current assignments are
  read first and kept, so nothing is removed (1 GET + 1 POST)."
- **Fields:**
  - **Monitor**: searchable dropdown fed by [`syntheticMonitorsQuery`](#2-syntheticmonitorsquery); options
    `Browser · <name>` / `HTTP · <name>`; *No monitor matches that name.* when the filter matches nothing. A query
    error is shown in red under it.
  - **Picker:** preselects frontends with no monitor; note *already assigned to this monitor*, `<n> monitors` or
    *no monitors*.
- **Preview:** `Request (1 API call; current assignments are merged in at send time)`, built from the monitor's `apps`
  from DQL plus the new IDs. Only shown when a monitor is picked and at least one selected frontend is new to it.
- **Calls** ([`assignMonitor`](../ui/app/frontendActions.ts#L144)), for both Validate and apply:
  1. `GET …/v2/settings/objects?schemaIds=<schema>&scopes=<monitor ID>&fields=value`, where `<schema>` is
     `builtin:synthetic.http.assigned-applications` for `HTTP_CHECK-…` IDs and
     `builtin:synthetic.browser.assigned-applications` otherwise. Uses `items[0].value.applications[].application`.
  2. Merge current and new IDs (duplicates removed). More than 100: no POST, message `A monitor can be assigned to at
     most 100 applications (<n> after the change).`
  3. `POST …/v2/settings/objects?validateOnly=…`:

     ```json
     [
       {
         "schemaId": "builtin:synthetic.browser.assigned-applications",
         "scope": "SYNTHETIC_TEST-0000000000000001",
         "value": {
           "applications": [
             { "application": "APPLICATION-0000000000000001" },
             { "application": "APPLICATION-0000000000000002" }
           ]
         }
       }
     ]
     ```

- **Confirmation:** `Assign <monitor name> to <n> more frontends` (or *Pick a monitor first*). Button: **Assign
  monitor**, disabled without a monitor or new frontends.
- **Success:** `Monitor assigned; it now covers <n> frontends. Synthetic counts refresh with the next query run (change
  the timeframe or reload).` This action does not reload the tab.
- **Also shown:** `QueryActions` for the monitor query.
- **Documentation:** [Settings API: assign synthetic monitor to web applications](https://docs.dynatrace.com/docs/discover-dynatrace/references/dynatrace-api/environment-api/settings/schemas/builtin-synthetic-browser-assigned-applications),
  [Create and configure a browser monitor](https://docs.dynatrace.com/docs/observe/digital-experience/synthetic/synthetic-app/create-configure-browser-monitors),
  [Create and configure an HTTP monitor](https://docs.dynatrace.com/docs/observe/digital-experience/synthetic/synthetic-app/create-and-configure-an-http-monitor).

### 5. Create a synthetic monitor (Link)

- **Fixes:** *Synthetic monitors assigned*, when no suitable monitor exists.
- **Text:** "Creating a monitor needs a URL and steps, so it cannot be done in bulk here. This opens the Synthetic app
  with a new monitor that already has the selected frontends assigned."
- **Fields:** **Monitor type** (*Browser monitor* / *HTTP monitor*), picker (preselects frontends with no monitor).
- **Button:** *Create browser monitor in Synthetic* / *Create HTTP monitor in Synthetic* (disabled with no frontend
  selected) calls

  ```ts
  sendIntent(
    { "dt.synthetic.monitor_type": "browser", "dt.synthetic.monitored_entity_ids": ["APPLICATION-0000000000000001"] },
    { recommendedAppId: "dynatrace.synthetic", recommendedIntentId: "create_synthetic_monitor_with_assigned_frontends" },
  );
  ```

  Nothing is written by this app; finish the monitor in the Synthetic app. The counts update on the next query run.
- **Documentation:** the browser and HTTP monitor pages above.

### 6. Assign owning team (API)

- **Fixes:** *Owning team assigned*. Same form as on the [Ownership & Teams](ownership-and-teams.md) tab
  ([OwnerTagForm.tsx](../ui/app/tabs/OwnerTagForm.tsx)), with every frontend as a target (type *Frontend*).
- **Text:** "Frontends and synthetic monitors are classic entities: ownership is a classic tag whose key is an
  ownership key (dt.owner, owner or team) and whose value is a team identifier. Entities that already have an owner
  keep it; adding a second team makes them co-owned."
- **Fields:**
  - **Tag key**: `dt.owner` (default), `owner`, `team`.
  - **Owning team**: searchable dropdown of existing teams read from `builtin:ownership.teams` (call 8,
    `GET …/v2/settings/objects?schemaIds=builtin:ownership.teams&scopes=environment&fields=objectId,value&pageSize=500`,
    first 500 teams; option text `<name> (<identifier>)`), plus *Other identifier…*. If the teams cannot be read:
    `Could not read teams (<error>); type the identifier instead.`
  - **Team identifier** (text, placeholder `e.g. team-checkout`): shown for *Other identifier…* or when no team exists.
  - **Entities**: checkbox list with `owner: <team>` or `no owner`; buttons *+ Without owner (n)*, *+ All shown (n)*,
    *None*. Frontends without an owner are preselected.
- **Preview:** `Request (<k> API calls for <n> entities)` with the first call, e.g.

  ```text
  POST /api/v2/tags?entitySelector=entityId("APPLICATION-0000000000000001","APPLICATION-0000000000000003")
  {
    "tags": [
      { "key": "dt.owner", "value": "team-checkout" }
    ]
  }
  ```

- **Validate:** the tags API has no dry run, so Validate checks locally ([`checkOwnerTag`](../ui/app/remediation.ts#L570)):
  empty identifier (*Team identifier is required.*), more than 100 characters (*At most 100 characters.*), or, when teams
  exist, an identifier that is neither a team identifier nor a supplementary identifier (warning: `"<value>" is not an
  identifier of an existing team; ownership only resolves once a team with that identifier exists.`). Otherwise
  `Valid: <n> entities would get <key>:<value> in <k> API calls. Nothing was changed.` Nothing is sent.
- **Confirmation:** `Add the tag <key>:<value> to <n> entities`. Button: **Assign owner** (disabled on an error; a
  warning does not block it).
- **Calls** ([`applyOwnerTag`](../ui/app/remediation.ts#L581)): IDs are grouped by ID prefix and chunked by 60; for each
  chunk `monitoredEntitiesCustomTagsClient.postTags({ entitySelector: 'entityId("…",…)', from: "now-30d", body: { tags:
  [{ key, value }] } })`, i.e. `POST …/v2/tags?entitySelector=…&from=now-30d`. The value is trimmed. Uses
  `matchedEntitiesCount` from each response.
- **Success:** `Tag <key>:<value> added to <matched> of <n> entities (<k> API calls). Ownership updates within a few
  minutes.` The tab reloads. **Failure:** `Tagged <matched> before the error. <message>` (earlier chunks stay applied).
- **Documentation:** [Assign ownership teams to monitored entities](https://docs.dynatrace.com/docs/deliver/ownership/ownership-classic/assign-ownership),
  [Best practices for entity ownership](https://docs.dynatrace.com/docs/deliver/ownership/best-practices).

### 7. Set up the user tagging token (API)

- **Fixes:** *User tagging configured* being *Not measured*. It does not create user tag rules.
- **Text:** "User tag rules are read through the classic Config API, so the app needs an API token with the ReadConfig
  scope stored in the credential vault as "architect-assistant-readconfig". The app can create that token for you, or
  store one you paste. An existing credential of that name is replaced."
- **Status line** (call 10 on open): *Checking the credential vault…*, *No credential yet.*, `Credential found (<id>,
  owner <owner>). Setting it up again replaces the token.`, or `Could not read the credential vault: <error>`.
- **How** (dropdown):
  - *Create a ReadConfig token automatically* (default). Hint: creates an API token named
    `architect-assistant-readconfig` with only the ReadConfig scope, owned by you and valid for 365 days, then stores
    it in the vault (APP_ENGINE scope, usable by every user of this app). The token is never shown.
  - *Store a token I paste*: password field **API token (ReadConfig scope)**, placeholder `dt0c01.XXXXXXXX.YYYYYYYY`.
    It must match `^dt0c01\.[A-Z0-9]+\.[A-Z0-9]+$`, otherwise: `That does not look like a Dynatrace API token
    (dt0c01.XXXX.YYYY).`
- **Confirmation:** *Create a ReadConfig API token and store it in the credential vault* / *Store this token in the
  credential vault*. Button: **Create and store token** / **Store token**. There is no Validate step.
- **Calls** ([`createAndStoreUserTagToken`](../ui/app/frontendActions.ts#L241), [`storeUserTagToken`](../ui/app/frontendActions.ts#L224)):
  1. Automatic mode only, call 11, `POST …/v2/apiTokens`:

     ```json
     { "name": "architect-assistant-readconfig", "scopes": ["ReadConfig"], "expirationDate": "2027-10-25T00:00:00.000Z", "personalAccessToken": false }
     ```

     (`expirationDate` = now + 365 days.) Uses `token` from the response. Failure: `Creating the API token failed:
     <error> Create a token with the ReadConfig scope yourself and paste it instead.`
  2. Call 10 again to find an existing credential.
  3. Call 12: `PUT …/v2/credentials/{id}` if it exists, else `POST …/v2/credentials`, body:

     ```json
     {
       "name": "architect-assistant-readconfig",
       "description": "Architect Assistant: ReadConfig API token used to read web application user tag rules (Config API v1).",
       "type": "TOKEN",
       "token": "dt0c01.XXXXXXXX.YYYYYYYY",
       "scopes": ["APP_ENGINE"],
       "ownerAccessOnly": false
     }
     ```

- **Success:** `API token created (ReadConfig only, expires in 365 days) and stored. Credential
  "architect-assistant-readconfig" created. User tagging is read now.` (or `… updated. User tagging is re-read now.`).
  The pasted token is cleared, the status line refreshes and the tab reloads, which calls the `user-tags` function
  again.
- **Manual alternative:** [One-time setup](#one-time-setup), option B. The outbound allowlist is not set by this
  action.
- **Documentation:** [Credential vault](https://docs.dynatrace.com/docs/manage/credential-vault),
  [Access tokens](https://docs.dynatrace.com/docs/manage/identity-access-management/access-tokens-and-oauth-clients/access-tokens).

### 8. Configure user tagging (Link)

- **Fixes:** *User tagging configured*. User tag rules have no Settings 2.0 schema, so they cannot be created in bulk.
- **Content** (`userTagAction` in [frontendActions.ts](../ui/app/frontendActions.ts#L177)): a copyable snippet

  ```javascript
  // after login, once the user is known
  if (window.dtrum) dtrum.identifyUser(user.email);
  ```

  steps:
  1. Open the frontend below (RUM Classic web application page) and select More (…) > Edit.
  2. Go to Capturing > User tags and add a rule that reads the user name from a CSS selector, JavaScript variable, meta
     tag, cookie, query string or server-side request attribute.
  3. Or call `dtrum.identifyUser()` from the application once the user is known (shown above); the API overrides
     metadata rules.

  and folded notes: up to 20 user tag rules per application, captured values cropped to 100 characters; no user tag
  is sent for users with Do Not Track enabled when the application respects it; no Settings 2.0 schema, so no bulk
  creation from this app.
- **Links:** one per frontend: when user tagging is measured, the frontends with 0 rules; when it is not measured,
  every frontend. Each opens `getIntentLink({ "dt.entity.application": "<id>" }, "dynatrace.classic.web",
  "view-application")` in a new tab, with the note *no user tag rule* or *not measured*. Empty list: *Every frontend
  has a user tag rule.*
- **Documentation:** [Tag specific users for web applications](https://docs.dynatrace.com/docs/observe/digital-experience/web-applications/additional-configuration/identify-individual-users-for-session-analysis),
  [RUM JavaScript API: dtrum](https://docs.dynatrace.com/javascriptapi/doc/types/dtrum.html).

### 9. Open frontend settings (RUM, Session Replay, health alerts) (Link)

- **Fixes:** RUM, Session Replay and health alerts one frontend at a time, in the Experience Vitals UI.
- **Text:** "Opens each frontend's Settings tab in Experience Vitals (Enablement and cost control, Health alerts) to
  configure RUM, Session Replay and health alerts one frontend at a time."
- **Links:** every frontend without RUM v2, without Session Replay on Grail, or without a health alert; each opens
  `getIntentLink({ frontend: "<id>", "details.properties": { selectedTab: "settings" } }, "dynatrace.experience.vitals",
  "view-frontend")`, with the enablement note. Empty list: *Every frontend already passes this check.*
- **Documentation:** the RUM v2, Session Replay and health alert pages above.

## AI Assist on this page

When the **AI Assist** header button is on, the tab shows a panel computed by
[`analyzeFrontends(frontends, userTagsMeasured)`](../ui/app/analyses.ts#L462), where `userTagsMeasured` is true only
when the `user-tags` function returned `ok`. It is rule-based and runs locally on the rows already on screen; no
Dynatrace AI service is called.

**No frontends** (also while the data is still loading): summary "No web frontends were returned for this timeframe,
so no frontend checks could be scored.", an info insight suggesting a wider timeframe or checking RUM injection, and a
medium recommendation to set up RUM for at least one web frontend.

**Summary:** `<n> web frontends average <avg>% across the frontend checks. <v2> have RUM v2 enabled, <g> record Session
Replay on Grail, <s> have synthetic monitors and <h> have health alerts.` (`avg` = rounded mean frontend score.)

**Insights** (severity from a percentage: 90 or more good, 50 or more warning, below 50 critical; lists show the first
four names, then "…"):

| Insight | Condition | Severity |
| --- | --- | --- |
| `<v2> of <n> frontends send RUM data to Grail (RUM v2).` | Always | By the RUM v2 share |
| `RUM classic only (scored 50%): <names>.` | Any frontend with RUM classic only | warning |
| `RUM disabled: <names>.` | Any frontend without RUM classic | critical |
| `Session Replay off: <names>.` | Any frontend without Session Replay (classic or Grail) | warning |
| `No synthetic monitor assigned: <names>.` | Any frontend with 0 monitors | critical if all, else warning |
| `No enabled health alert: <names>.` | Any frontend with 0 enabled alerts | critical if all, else warning |
| `User tagging is not measured yet: the ReadConfig token is missing from the credential vault, so it is left out of the averages.` | User tagging not measured (any non-`ok` status) | info |
| `No user tag rule: <names>.` | Measured, and any frontend with 0 rules | warning |
| `No owning team (dt.owner / owner / team tag): <names>.` | Any frontend without owner | critical if all, else warning |

**Recommendations:**

| Recommendation | Condition | Impact |
| --- | --- | --- |
| Use Actions › Enable RUM v2 to switch every remaining frontend to the New RUM Experience in one request. | Any classic-only or RUM-disabled frontend | high |
| Use Actions › Create health alerts to add the recommended Web Vitals, user action duration and error alerts to every frontend without one. | Any frontend without alerts | high |
| Assign at least one browser or HTTP monitor to each important frontend (Actions › Assign an existing synthetic monitor, or create one in Synthetic). | Any frontend without monitors | medium |
| Enable Session Replay on Grail where you need visual reproduction of user issues; validate first, as it depends on license and storage. | Any frontend without Session Replay on Grail | medium |
| Use Actions › Set up the user tagging token (the app can create the ReadConfig token for you) to score user tagging. | User tagging not measured | medium |
| Configure a user tag rule (or call dtrum.identifyUser) so sessions can be traced back to a user. | Measured, and any frontend with 0 rules | medium |
| Use Actions › Assign owning team to tag frontends with dt.owner:<team> so problems and alerts route to the right team. | Any frontend without owner | medium |

The Entity Overview AI Assist (`analyzeOverview`) also mentions frontend readiness and, below 70%, recommends the
Frontends tab actions.

## Limitations and edge cases

- **Web frontends only.** The page lists `dt.entity.application` entities. Mobile and custom applications are not
  covered.
- **No cost allocation check.** No setting or OpenPipeline stage sets `dt.cost.*` on RUM frontends, so the page does
  not score it and the Cost allocation tab leaves frontends out.
- **Stored settings only.** The Settings API returns stored objects. If neither the frontend nor the environment scope
  has a `builtin:rum.web.enablement` object, every switch is read as false and the frontend shows *RUM disabled*.
- **Timeframe affects only the DQL.** Changing the timeframe re-runs `frontendsQuery` (and the monitor query if open);
  the settings reads are not repeated, and the `user-tags` function only runs again if the list of frontend IDs changes.
- **Monitors:** any monitor entity in the timeframe whose `monitors` relationship includes the frontend counts, whether
  or not the monitor is enabled. Third-party monitors count toward the check but cannot be assigned from this page.
  The monitor dropdown holds at most 1,000 browser and HTTP monitors.
- **Health alerts:** every enabled alert object that lists the frontend counts once, so two alerts of the same type
  count as two. Disabled alerts do not count, and the *Create health alerts* skip logic also ignores them (a frontend
  with only a disabled LCP alert gets a new LCP alert).
- **User tagging:** at most 500 frontends are sent to the function; the rest show *Config API call failed* (not
  measured) for that check. A per-frontend Config API failure has the same effect. While the function runs, user
  tagging is excluded from the averages, so scores can change once it returns.
- **User tagging messages:** the AI Assist insight and the per-frontend detail say the token is missing for any
  non-`ok` status, including an unauthorized token or a blocked outbound host; the warning message above the gauges
  shows the actual function message. The *Set up the user tagging token* action is preselected only for
  `no-credential` and `unauthorized`.
- **Owner detection:** only tags whose text starts with `dt.owner:`, `owner:` or `team:` count; tags with a context
  prefix (for example `[AWS]owner:…`) or other keys do not. With several owner tags, the first in the entity's tag
  order is shown. A tag with an empty value (`owner:`) is not an owner.
- **Enablement writes** copy the full effective value. A frontend that inherited the environment value gets its own
  object and stops following the environment-scope object.
- **Assign monitor** does not reload the tab: the frontend's monitor count and the monitor list update only on the next
  query run (timeframe change or app reload). Validate for this action performs the read (GET) but no write.
- **Owner tags** use `from=now-30d`, so a frontend not seen in the last 30 days is not matched (`matched` lower than
  selected).
- **Request previews** show the first two objects only; the preview for *Assign* uses the DQL assignment list, while the
  request merges the current Settings value at send time.
- The detail line of the per-frontend synthetic gauge pluralises every kind with "s" (for example `2 HTTPs`).

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| *Query failed* mentioning a missing scope or permission | App lacks `storage:entities:read`, or the user lacks read access to classic entities. | Grant the user `storage:entities:read`. After changing app scopes in development, restart `npx dt-app dev` and sign in again. |
| *Reading RUM and health alert settings failed*, and *No web frontends found* | The user (or app) cannot read `builtin:rum.web.enablement` or `builtin:health-experience.frontend-alert`. | Grant `settings:objects:read` for those schemas (see [User permissions](#user-permissions)). |
| *No web frontends found in this timeframe.* with no error | No web application entity existed in the timeframe. | Pick 7 or 30 days; confirm RUM is injected into the frontends. |
| *User tagging is not measured* with *No Token credential named …* | The credential does not exist, has another name, or is owner-only for another user. | *Actions* > *Set up the user tagging token*, or create it manually (name `architect-assistant-readconfig`, Token, App Engine scope, not owner-only). |
| *Config API returned 401/403; the token needs the ReadConfig scope.* | Token expired (the automatic one lasts 365 days), revoked, or lacks ReadConfig. | Run *Set up the user tagging token* again; it replaces the stored token. |
| *Config API calls to https://… failed for every application (is the host allowlisted?)* | The classic host is not in `builtin:dt-javascript-runtime.allowed-outbound-connections`. | Add `<env>.live.dynatrace.com` (or the derived classic host) to the allowlist. |
| *Function user-tags has failed* | The app function failed or is not deployed. | Check the app deployment; the rest of the page still works. |
| A frontend shows *Config API call failed* | Its Config API call returned non-2xx, or it was beyond the first 500 frontends. | Check that the web application still exists in the Config API; the check is excluded from that frontend's score. |
| *Creating the API token failed: …* | You may not create API tokens. | Ask an admin for a ReadConfig token and use *Store a token I paste*. |
| *That does not look like a Dynatrace API token (dt0c01.XXXX.YYYY).* | Pasted text is not a classic API token. | Paste the complete `dt0c01.…` token. |
| Enablement Validate returns `<k> of <n> frontends rejected: …` | Schema validation, for Session Replay typically license or Session Replay storage. | Read the message; enable Session Replay on fewer frontends or without Grail, or fix licensing / storage first. |
| Health alert creation rejected | Environment limit of 300 health alerts, invalid actor, or missing write permission. | Use a valid user or service user ID; select fewer types; remove unused alerts. |
| *A monitor can be assigned to at most 100 applications* | The monitor would exceed 100 assigned frontends. | Select fewer frontends or use another monitor. |
| Synthetic count unchanged after *Assign monitor* | That action does not reload the tab. | Change the timeframe or reload the app. |
| *Tag … added to 3 of 5 entities* | Some frontends were not seen in the last 30 days, or the tag API matched fewer entities. | Check the unmatched frontends in the table after reload. |
| Owner column shows *—* although a tag exists | Tag key is not `dt.owner`, `owner` or `team`, has a context prefix, or has no value. | Add a `dt.owner:<team>` tag (*Assign owning team*). |
| RUM shows *RUM disabled* although RUM is on in the UI | No stored enablement object for the frontend or the environment scope. | Use *Enable RUM v2*, which writes an explicit object for the frontend. |
| *Open in Notebook* / links do nothing | No access to the target app, or a popup blocker. | Check app access; allow pop-ups for the links. |

## Related pages

- [Index of all pages](README.md)
- [Entity Overview](entity-overview.md): uses frontend readiness in Overall readiness, Top 5 findings and its Frontends card.
- [Ownership & Teams](ownership-and-teams.md): owner coverage for frontends and synthetic monitors, same owner tag form, team creation.
- [Cost allocation](cost-allocation.md): why frontends are not part of cost allocation.

## Source files

| File | Role on this page |
| --- | --- |
| [ui/app/tabs/FrontendsTab.tsx](../ui/app/tabs/FrontendsTab.tsx) | Tab layout: summary gauges, RUM tiles and donut, frontend checks, table, user tagging notice; `FrontendsOverviewCard` for Entity Overview. |
| [ui/app/frontends.ts](../ui/app/frontends.ts) | `useFrontendsData`: DQL, Settings API reads, `user-tags` function call, client-side join, `scoreFrontend`, reload. |
| [ui/app/tabs/FrontendActions.tsx](../ui/app/tabs/FrontendActions.tsx) | Actions section: forms, frontend picker, validate / confirm / apply controls, link lists, token form. |
| [ui/app/frontendActions.ts](../ui/app/frontendActions.ts) | Request bodies and calls for enablement, health alerts, monitor assignment, token creation and storage; intents; docs links. |
| [ui/app/tabs/OwnerTagForm.tsx](../ui/app/tabs/OwnerTagForm.tsx) | *Assign owning team* form (shared with Ownership & Teams). |
| [ui/app/remediation.ts](../ui/app/remediation.ts) | `applyOwnerTag`, `ownerTagSelectors`, `checkOwnerTag`, `listTeams`, `errorMessage`. |
| [ui/app/RemediationPanel.tsx](../ui/app/RemediationPanel.tsx) | Shared `Field`, `Request`, `ResultLine`, `Links`, `ManualActionView`, `useExistingTeams`. |
| [api/user-tags.function.ts](../api/user-tags.function.ts) | App function: credential vault token, Config API v1 `userTags` per frontend. |
| [ui/app/queries.ts](../ui/app/queries.ts) | `frontendsQuery`, `syntheticMonitorsQuery`, `classicOwnerFields`, `refreshMarker`, `OWNER_KEYS`, timeframes. |
| [ui/app/analyses.ts](../ui/app/analyses.ts) | `analyzeFrontends` (AI Assist). |
| [ui/app/components.tsx](../ui/app/components.tsx) | `PctGauge`, `ScoreTile`, `QueryActions`, `QueryState`, `statusColor`. |
| [ui/app/tabs/ModePie.tsx](../ui/app/tabs/ModePie.tsx) | `Donut` chart. |
| [ui/app/tabs/CoverageTabs.tsx](../ui/app/tabs/CoverageTabs.tsx) | Entity Overview use of frontend data (`frontendFindingRows`, `topFindings`, `SummaryGauges`). |
| [ui/app/App.tsx](../ui/app/App.tsx) | Calls `useFrontendsData` at app start; `goToFrontends` navigation. |
| [app.config.json](../app.config.json) | App scopes. |
