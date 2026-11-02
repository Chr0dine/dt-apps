# Problem notifications

The Problem notifications tab measures how far a tenant has moved from classic problem notifications (Settings 2.0 schema `builtin:problem.notifications`, each tied to an alerting profile in `builtin:alerting.profile`) to simple workflows with a Davis problem trigger, which is what the Dynatrace upgrade guide recommends. It lists every classic notification, pairs it with the workflow that has the same name, counts the problems each alerting profile matched in the last 7 days, shows how each alerting profile would translate into a DQL trigger filter, and flags profiles that rely on Gen 2 concepts (classic tags, management zones, classic event types). Its **Remediation actions** section converts Email, Slack, ServiceNow incident and custom webhook notifications into simple workflows: a **Validate** step translates each alerting profile, runs the translated rules and the alerting profile label side by side against 7 days of problems, and shows the exact workflow request; **Create workflows** then creates one workflow per notification through the app's `workflows` function with a platform token stored in the credential vault. Classic notifications are never changed or deleted.

| | |
| --- | --- |
| Area | Migration Assistance (see [index](README.md)) |
| Tab id | `problem-notifications` |
| Counts toward Entity Overview readiness / Top findings | no (the tab's gauge and tiles are not used by Entity Overview, Top findings or any other tab) |
| Main source files | [ui/app/tabs/ProblemNotificationsTab.tsx](../ui/app/tabs/ProblemNotificationsTab.tsx), [ui/app/problemNotifications.ts](../ui/app/problemNotifications.ts), [ui/app/alertingProfiles.ts](../ui/app/alertingProfiles.ts), [api/workflows.function.ts](../api/workflows.function.ts), [ui/app/queries.ts](../ui/app/queries.ts#L759) (`profileProblemsQuery`), [ui/app/analyses.ts](../ui/app/analyses.ts#L386) (`analyzeProblemNotifications`) |

## Contents

- [What this page answers](#what-this-page-answers)
- [Before you start](#before-you-start)
  - [App scopes used by this page](#app-scopes-used-by-this-page)
  - [User permissions](#user-permissions)
  - [One-time setup](#one-time-setup)
- [Page walkthrough](#page-walkthrough)
  - [When the page loads](#when-the-page-loads)
  - [AI Assist panel](#ai-assist-panel)
  - [Heading and introduction](#heading-and-introduction)
  - [Loading and error states](#loading-and-error-states)
  - [Summary tiles and gauge](#summary-tiles-and-gauge)
  - [Notifications by type (donut)](#notifications-by-type-donut)
  - [Search classic problem notifications](#search-classic-problem-notifications)
  - [Remediation actions section](#remediation-actions-section)
- [Checks and scoring](#checks-and-scoring)
- [Queries](#queries)
  - [Q1. Problems per alerting profile](#q1-problems-per-alerting-profile)
  - [Q2. Event names per classic event type](#q2-event-names-per-classic-event-type)
  - [Q3. Profile rules vs label (Validate)](#q3-profile-rules-vs-label-validate)
  - [Q4. Workflow trigger filter](#q4-workflow-trigger-filter)
  - [Client-side processing](#client-side-processing)
- [API calls](#api-calls)
- [Remediation actions](#remediation-actions)
  - [Convert classic problem notifications to simple workflows](#convert-classic-problem-notifications-to-simple-workflows)
  - [Upgrade a problem notification manually (simple workflow)](#upgrade-a-problem-notification-manually-simple-workflow)
- [AI Assist on this page](#ai-assist-on-this-page)
- [Limitations and edge cases](#limitations-and-edge-cases)
- [Troubleshooting](#troubleshooting)
- [Related pages](#related-pages)
- [Source files](#source-files)

## What this page answers

For an architect planning the move off classic alerting, the page answers:

- How many classic problem notifications exist, how many are enabled, and of which integration types (Email, Slack, ServiceNow, custom webhook, Jira, PagerDuty, OpsGenie, VictorOps, xMatters, Trello, Ansible Tower)?
- Which enabled notifications already have a workflow with the same name (counted as migrated), and which of those workflows were created by the migration (this app or the *Classic Problems to WFs* migration workflow, recognised by the same description)?
- Which of the remaining notifications can be converted automatically, and why the others need a manual upgrade (unsupported type, ServiceNow events only, webhook URL stored as a secret, missing alerting profile)?
- Which alerting profiles can be expressed as a DQL filter on problem fields, which only approximately, and which can only be matched through the deprecated `labels.alerting_profile` label (management zone, regular expression, event type without recent events)?
- Which alerting profiles still use Gen 2 concepts (classic tags, management zones, classic event types) that have Grail-native replacements (primary tags, primary fields)?
- How many problems each alerting profile matched in the last 7 days, so that stale notifications can be deleted instead of migrated?
- Before anything is created: which problems the new workflow trigger would have fired for, compared with the problems the classic alerting profile label carried?

The best practice it checks is the one in the Dynatrace upgrade guide the code cites (`PN_DOCS` in [problemNotifications.ts](../ui/app/problemNotifications.ts#L42)):

- [Upgrade from Classic problem notification to simple workflows](https://docs.dynatrace.com/docs/platform/upgrade/keep-problems-and-alerting-working/upgrade-guide-alert-notification): replace each classic notification and its alerting profile with a simple workflow whose Davis problem trigger filters the problems and whose task sends the notification. The guide marks `labels.alerting_profile` as deprecated and limits the trigger filter to 1,000 characters.
- [Jinja expressions for Workflows](https://docs.dynatrace.com/docs/analyze-explore-automate/workflows/reference): the expression language the workflow tasks use instead of classic placeholders such as `{ProblemID}`.

The conversion is a port of the *Classic Problems to WFs v1.1* migration workflow, with fixes listed in the header comment of [problemNotifications.ts](../ui/app/problemNotifications.ts#L10) (see [Fixes against the migration workflow](#fixes-against-the-migration-workflow)).

## Before you start

### App scopes used by this page

From [app.config.json](../app.config.json) and the calls this tab makes:

| Scope | What this page uses it for |
| --- | --- |
| `settings:objects:read` | Read every object of `builtin:problem.notifications` and `builtin:alerting.profile` (environment scope) on page load. |
| `automation:workflows:read` | List workflows (`GET /platform/automation/v1/workflows`) to match them to classic notifications by title. |
| `storage:events:read` (with `storage:buckets:read`, which the app also requests) | DQL on `events` (problem counts per alerting profile, Validate comparison) and on `dt.davis.events` (event names per classic event type during Validate). The `storage:events:read` comment in `app.config.json` only mentions the Data Overview and IAM tabs, but this tab's queries need it too. |
| `environment-api:credentials:read` | The tab lists credentials to find `architect-assistant-workflows` before storing the platform token; the `workflows` app function lists the credential and reads its token value. |
| `environment-api:credentials:write` | Store (create or update) the platform token as the Token credential `architect-assistant-workflows`. |

Not requested, on purpose: `automation:workflows:write`. Only apps provided by Dynatrace may request it; installing a custom app that asks for it fails with HTTP 400 (*Only apps that are provided by Dynatrace can use the 'automation:workflows:write' scope*). Workflows are therefore created by the `workflows` app function with a platform token that carries `automation:workflows:read` and `automation:workflows:write` (see [One-time setup](#one-time-setup)). Links to Settings, Workflows, Notebooks and Dashboards are intents and need no scope.

### User permissions

App scopes only cap what the app may do; every read and write also runs with the signed-in user's own permissions.

| Action | The signed-in user needs |
| --- | --- |
| Load the page | Read access to the settings objects of `builtin:problem.notifications` and `builtin:alerting.profile`; permission to read workflows; Grail read access to the `events` table (problem events) and `dt.davis.events`. |
| Match workflows | The workflow list contains only the workflows the user is allowed to see. A same-name workflow the user cannot see is not matched, so its notification shows as *not migrated*. |
| Store the platform token | Permission to create or edit credential vault entries. If a credential named `architect-assistant-workflows` exists but is owner-only and owned by someone else, the list call does not return it. |
| Create workflows | Permission to read the credential `architect-assistant-workflows` (owner only: only its owner; shared: any user of the app). The workflows are created by the **token's** user, which needs permission to create workflows (`automation:workflows:read` and `automation:workflows:write` on the token, within that user's permissions). |
| Run the created workflows | Workflows run as their owner (the token's user). Slack and ServiceNow tasks need a connection selected after creation; webhook hosts must be allowed for outbound requests from Workflows. |

### One-time setup

Creating workflows needs one platform token; everything else on the page works without setup. From the README section *Problem notifications tab: workflow creation setup* and [api/workflows.function.ts](../api/workflows.function.ts#L4):

1. In [My platform tokens](https://myaccount.dynatrace.com/platformTokens) (Account Management), create a platform token for the environment with the scopes `automation:workflows:read` and `automation:workflows:write`. The token only works within its user's permissions, and the workflows it creates are owned by that user: generate it for a service user so the workflows keep running when people leave.
2. In **Problem notifications > Remediation actions > Convert classic problem notifications to simple workflows**, run **Validate**. When at least one workflow can be created, the *Platform token for creating workflows* card appears. Paste the token there and select **Save to the credential vault**. It is stored as the **Token** credential `architect-assistant-workflows` with the App Engine scope (`APP_ENGINE`). *Only I can use it (owner only)* is ticked by default; untick it to let every user of the app create workflows as the token's user.
3. The card checks the token by listing workflows with it; **Create workflows** stays disabled until that check passes.

No allowed-outbound-connection entry is needed for the function: it calls the environment's own URL (from `getEnvironmentUrl()`), which is reachable without one. A relative `/platform/...` call from an app function always carries the app's own credentials and ignores an `Authorization` header passed with it, which is why the function calls the full URL. Both behaviours are recorded in the function's header comment (checked with `dtctl exec function` on 2026-10-25).

Documentation the card links (`WORKFLOW_TOKEN_DOCS`): [Platform tokens](https://docs.dynatrace.com/docs/manage/identity-access-management/access-tokens-and-oauth-clients/platform-tokens), [Credential vault](https://docs.dynatrace.com/docs/manage/credential-vault).

## Page walkthrough

### When the page loads

The tab takes no timeframe: the shell's 24 hours / 7 days / 30 days select has no effect here. Its windows are fixed: 7 days (`PROBLEM_DAYS` in [queries.ts](../ui/app/queries.ts#L762)) for problem counts and Validate, 30 days for event names. The tab is rendered only while it is selected (the shell's Strato `Tabs` do not keep tabs mounted), so leaving and reopening the tab reloads everything.

When the tab opens, three things start in parallel:

1. `usePnData` ([ProblemNotificationsTab.tsx](../ui/app/tabs/ProblemNotificationsTab.tsx#L60)) runs `listNotifications()` (two paged Settings API reads) and `listWorkflows()` (paged workflow list), then pairs them with `matchNotifications()`.
2. `useProfileProblems` ([ProblemNotificationsTab.tsx](../ui/app/tabs/ProblemNotificationsTab.tsx#L84)) runs [Q1](#q1-problems-per-alerting-profile) through `useDql`.
3. As soon as the notifications are loaded, the Remediation actions section mounts with its default action (*Convert ... to simple workflows*), whose form calls the `workflows` app function once with `{"action":"status"}` to check the platform token.

### AI Assist panel

When AI Assist is switched on in the app header, a panel appears at the top of the tab with a summary, insights and recommendations computed locally from the rows on screen. See [AI Assist on this page](#ai-assist-on-this-page).

### Heading and introduction

Heading **Problem notifications**, followed by: *Simple workflows with a Davis problem trigger replace classic problem notifications and their alerting profiles: the trigger filters the problems and the task sends the notification. A classic notification counts as migrated when a workflow with the same name exists. The conversion follows the Classic Problems to WFs migration workflow.*

A *Problem notifications documentation* link above the tab content (rendered by the shell) opens this page.

### Loading and error states

| State | What is shown |
| --- | --- |
| Notifications or workflows still loading | `Loading…` in place of everything below the introduction. |
| Either list fails (any Settings API page, any workflow page) | A critical message *Could not read problem notifications or workflows* with the error text; nothing else is rendered. Typical causes: missing `settings:objects:read` or `automation:workflows:read`, or no user permission. |
| Problem-count query (Q1) fails | The rest of the page renders. An orange line *Problem counts unavailable: <error>* appears under the tiles, the *Problems (7 days)* column shows `…`, and AI Assist does not report stale notifications. |
| Problem-count query (Q1) still running | The *Problems (7 days)* column shows `…`. |

### Summary tiles and gauge

One row of cards (wrapping on narrow screens), in this order. "Rows" are all classic notifications; "enabled" means `value.enabled === true`; "has a workflow" means a workflow with exactly the same title exists (see [Matching notifications to workflows](#matching-notifications-to-workflows)).

| Card | Value | Subtitle | Exact computation |
| --- | --- | --- | --- |
| **Classic problem notifications** (tile) | number of rows | `<e> enabled, <d> disabled` | `rows.length`; `e` = rows with `enabled`; `d` = `rows.length - e`. |
| **Workflows** (tile) | number of workflows listed | `<n> named after a classic notification` | Value: every workflow the user can see (`listWorkflows().length`). `n` = number of classic notifications (enabled or disabled) that have a same-name workflow. It counts notifications, not workflows: two notifications with the same name and one workflow count 2. |
| **Enabled notifications migrated** (gauge) | percent | `<m> of <e>` | `PctGauge` with `pct(m, e)` = `Math.round(m / e * 100)`, 0 when `e` is 0. `m` = enabled rows that have a same-name workflow (created by the migration or not). Custom SVG gauge, 240-degree arc, red (0 %) through yellow to green (100 %). No (i) button. |
| **Auto-convertible** (tile) | number | `of <e - m> enabled, not migrated yet` | Rows where `convertible(r)` is true: enabled, an automatic conversion exists for the type, the alerting profile exists, and no same-name workflow exists. |
| **Created by the migration** (tile) | number | `workflows with the migration description` | Rows whose matched workflow has the description *Auto Created Simple Workflow from Classic Problem Notification and corresponding Alerting Profile (via migration workflow)* (`MIGRATION_DESCRIPTION`). It counts notifications with such a workflow; a migration workflow whose title matches no notification is not counted. |
| **Gen 2 alerting rules** (tile) | number | `enabled notifications whose profile uses classic tags, zones or event types; <l> label only` | Value: enabled rows whose alerting profile uses a management zone, classic tags (a severity rule with a non-empty tag filter and include mode other than `NONE`) or a predefined (classic) event type filter. `l` = enabled rows with an existing alerting profile that cannot be translated to DQL (management zone or regular expression / unsupported text operator). Enabled rows without an alerting profile are not in `l`. |
| **Notifications by type** (donut) | see below | | Only when at least one notification exists. |

Tiles are plain text and not clickable.

### Notifications by type (donut)

A custom SVG donut (`Donut` from [ModePie.tsx](../ui/app/tabs/ModePie.tsx#L28), size 188 px) with one slice per notification type present in the tenant, enabled and disabled notifications together.

- **Slice order:** the order of `NOTIFICATION_TYPES` (Email, Slack, ServiceNow, Custom webhook, Jira, PagerDuty, OpsGenie, VictorOps, xMatters, Trello, Ansible Tower), then any unknown type value in the order first seen. Labels come from `typeLabel()`; an unknown type shows its raw `type` value.
- **Colours:** assigned by position from `#4589FF, #A56EFF, #2DB7A3, #FF832B, #EE5396, #D2A106, #33B1FF, #6FDC8C, #FA4D56, #B28600, #8D8D8D` (repeating), so a type's colour depends on which other types exist.
- **Centre:** total number of notifications with the label *Notifications*; while hovering a slice or legend entry, that slice's count and label.
- **Hover:** the slice widens, the others fade; the native tooltip reads `<type>: <count> (<percent>%)`.
- **Legend:** to the right; one line per slice with colour, type, count and share (rounded percent). The selected type is bold.
- **Click (slice or legend line):** selects the type, sets the search form's *Notification type* to it and runs the search immediately (the table appears if it was not shown yet). The search keeps the name, conversion and status values of the last search you ran (not unsent edits in the form; defaults *Any* if no search was run yet). Clicking the selected type again clears the selection and re-runs the search with type *Any*.
- Hint under the donut: *Select a type to list its notifications below.*

### Search classic problem notifications

A form (box titled **Search classic problem notifications**) and, after the first search, a table. Filtering is done in the browser on the rows already loaded; no query runs.

| Control | Options | Filter applied |
| --- | --- | --- |
| **Name contains** | free text, placeholder *e.g. slack (leave empty for all)* | Case-insensitive substring match on the notification's display name; the input is trimmed; empty matches all. |
| **Notification type** | *Any*, then each type present in the tenant (same order as the donut) | Exact match on `value.type` (`EMAIL`, `SLACK`, `SERVICE_NOW`, `WEBHOOK`, `JIRA`, ...). |
| **Conversion** | *Any*, *Auto-convertible*, *Manual* | *Auto-convertible*: `convertible(r)` (enabled, automatic conversion, alerting profile exists, no same-name workflow). *Manual*: the type has no automatic conversion (`conversion.auto === false`). A row with an automatic conversion that is disabled, already migrated or has no profile is in neither. |
| **Migration status** | *Any*, *Not migrated*, *Migrated* | *Not migrated*: no same-name workflow. *Migrated*: a same-name workflow exists (created by the migration or not). Disabled rows are included either way. |
| **Search notifications** (button) | | Applies the four values. The table only appears after the first click. |

**Results table** (Strato `DataTable`, sortable by every column, condensed rows, full width, no paging: every matching row is shown). Initial order: by notification name (`localeCompare`), as returned by `listNotifications()`.

| Column | Content | Source |
| --- | --- | --- |
| **Classic notification** | Display name, linked to the notification in Settings | `value.displayName`; link = intent `dynatrace.settings` / `deprecated_open_settings_by_id` with `{"dt.settings.object_id": "<objectId>"}` (opens in a new tab). Plain text if the intent link cannot be built. |
| **Type** | Type label | `typeLabel(value.type)` |
| **Enabled** | `Yes` / `No` | `value.enabled === true` |
| **Alerting profile** | Profile name, or `(not found)` when the referenced profile does not exist | `value.alertingProfile` (object ID) looked up in the `builtin:alerting.profile` objects; shows `value.name` of the profile. |
| **Profile rules** | `DQL`, `DQL (approximate)`, `Label only` or `Alerting profile not found`, plus an orange **Gen 2** badge listing `management zone`, `classic tags`, `classic event types` when they apply | `profileStatus(profile)` ([alertingProfiles.ts](../ui/app/alertingProfiles.ts#L222)); see [Checks and scoring](#checks-and-scoring). |
| **Problems (7 days)** | Number of distinct problems that carried this alerting profile's label in the last 7 days; `…` while Q1 runs or if it failed; `0` when the profile is missing | Q1 `problems` for `profile == <alerting profile name>`; `0` when the name is not in the result. |
| **Conversion** | `Auto · Email`, `Auto · Slack message`, `Auto · ServiceNow incident`, `Auto · HTTP request`, or `Manual`; a second line explains: the manual reason, or `Disabled: the migration skips it.`, or `Alerting profile not found.` | `conversionOf(notification)` ([problemNotifications.ts](../ui/app/problemNotifications.ts#L162)) |
| **Workflow with the same name** | `Yes (created by the migration)`, `Yes` or `No`; with `Open workflow ↗` when a workflow exists | Matched workflow; link = intent `dynatrace.automations` / `view-workflow-by-id` with `{"workflow.id": "<id>"}`. |

Empty states: *No classic problem notifications match this search.* (rows exist), or *No classic problem notifications are defined in this environment.*

Under the table: **QueryActions** for Q1 titled *Problems per alerting profile (7 days)*: **Show DQL** / **Hide DQL**, **Copy**, **↗ Open in Notebook** (intent `dynatrace.notebooks` / `view-query` with `dt.query` and `title`), **↗ Add to Dashboard** (intent `dynatrace.dashboards` / `add-to-dashboard`). They only appear once a search has run.

### Remediation actions section

A box titled **Remediation actions** with the line *<n> enabled notification(s) without a workflow of the same name; <a> can be converted automatically.* (`n` = enabled rows without a same-name workflow; `a` = those of them that are `convertible`), and an **Action** select:

| Option | Kind | Content |
| --- | --- | --- |
| *API · Convert classic problem notifications to simple workflows* (default) | API | The conversion form; see [Convert classic problem notifications to simple workflows](#convert-classic-problem-notifications-to-simple-workflows). |
| *Manual · Upgrade a problem notification manually (simple workflow)* | Manual | Steps, placeholder and connector tables; see [Upgrade a problem notification manually](#upgrade-a-problem-notification-manually-simple-workflow). |

Switching the action remounts the form (all form state, Validate results and the token status are reset and the token status is read again). Both actions end with a **Documentation for this fix:** row linking *Upgrade from Classic problem notification to simple workflows* and *Jinja expressions for Workflows*.

## Checks and scoring

| Check / status | In place when | Numerator | Denominator | Severity / thresholds | Notes |
| --- | --- | --- | --- | --- | --- |
| Enabled notifications migrated (gauge) | An enabled classic notification has a workflow whose title equals the notification's display name exactly | enabled notifications with a same-name workflow | enabled notifications | Gauge colour is continuous (0 % red, 100 % green); no fixed thresholds | `Math.round`; 0 % when there are no enabled notifications (AI Assist reports 100 % in that case). Disabled notifications are not counted. |
| Auto-convertible | `enabled && conversion.auto && profileName && !workflow` | count | shown against enabled, not migrated | none | Email, Slack, ServiceNow with incidents on, webhooks whose URL is not a secret. |
| Created by the migration | matched workflow has `description == MIGRATION_DESCRIPTION` | count | none | none | Workflows created by this app and by the migration workflow look the same. |
| Gen 2 alerting rules | profile has a management zone, classic tags or a predefined event type filter | enabled notifications | none | none | Listed as an orange **Gen 2** badge in the table. |
| Label only | profile exists and `translateProfile(profile, null)` fails | enabled notifications with a profile | none | none | Management zone, or a title/description filter with an operator other than equals / contains / begins with / ends with (in practice a regular expression). |

**Derived statuses**

| Status | Rule |
| --- | --- |
| Conversion `Auto · Email` | `type == "EMAIL"` (action `dynatrace.email:send-email`) |
| Conversion `Auto · Slack message` | `type == "SLACK"` (action `dynatrace.slack:slack-send-message`) |
| Conversion `Auto · ServiceNow incident` | `type == "SERVICE_NOW"` and `serviceNowNotification.sendIncidents` is true (action `dynatrace.servicenow:snow-create-incident`) |
| Conversion `Manual` (ServiceNow) | `type == "SERVICE_NOW"` and `sendIncidents` false: *Sends ServiceNow events only; the migration converts incidents.* |
| Conversion `Auto · HTTP request` | `type == "WEBHOOK"` and `webHookNotification.urlContainsSecret` false (action `dynatrace.automations:http-function`) |
| Conversion `Manual` (webhook) | `urlContainsSecret` true: *The webhook URL is stored as a secret, which the Settings API does not return.* |
| Conversion `Manual` (other types) | Jira, PagerDuty, OpsGenie, VictorOps, xMatters, Trello, Ansible Tower or unknown: *<type> has no conversion in the migration logic.* |
| Profile rules `DQL` | the profile translates and no translation note is marked approximate |
| Profile rules `DQL (approximate)` | the profile translates, with at least one approximate note: a delay that is not exactly a duration step, an unknown severity level, a predefined event type filter, a title / description / property filter, a case-sensitive text filter, or a `*` in a filter value |
| Profile rules `Label only` | the profile has a management zone, or a text filter with an unsupported operator |
| Profile rules `Alerting profile not found` | the notification's `alertingProfile` does not match any `builtin:alerting.profile` object |
| Gen 2 `management zone` | `managementZone` set on the profile |
| Gen 2 `classic tags` | any severity rule with a non-empty `tagFilter` and `tagFilterIncludeMode` other than `NONE` |
| Gen 2 `classic event types` | any event filter of type `PREDEFINED` with an event type |

The table's *Profile rules* status is computed without event names (`translateProfile(profile, null)`): a predefined event type filter is assumed to resolve. During Validate the real event names are looked up (Q2); an event type with no events in the last 30 days then makes the translation fail and the workflow falls back to the label, although the table said `DQL (approximate)`.

Validate adds a per-notification status; see [Validate results](#validate-results).

## Queries

| # | Name (function in source) | Runs when | Feeds |
| --- | --- | --- | --- |
| Q1 | Problems per alerting profile (`profileProblemsQuery`, [queries.ts](../ui/app/queries.ts#L763)) | Tab load, once | *Problems (7 days)* column; AI Assist stale-notification insight |
| Q2 | Event names per classic event type (`eventNamesQuery`, [alertingProfiles.ts](../ui/app/alertingProfiles.ts#L68), run by `eventNames`, [problemNotifications.ts](../ui/app/problemNotifications.ts#L509)) | **Validate**, once, only if a selected notification's profile has a predefined event type filter | Translation of predefined event filters (Q3, Q4) |
| Q3 | Profile rules vs label (`compareQuery`, [problemNotifications.ts](../ui/app/problemNotifications.ts#L389), run by `previewTrigger`) | **Validate**, once per notification that gets a plan, 4 at a time | Validate result lines (counts, examples), *Skip notifications whose trigger matched no problem* |
| Q4 | Workflow trigger filter (`triggerFilter`, `translateProfile`, `labelFilter`) | Never run by the app: written into each created workflow and evaluated by Workflows on every problem update | Workflow body (`filterQuery`, `customFilter`) |

All queries on this page use fixed windows; none depends on the shell timeframe. Q1 runs through the `useDql` hook (`@dynatrace-sdk/react-hooks`), Q2 and Q3 through `queryExecutionClient.queryExecute` / `queryPoll` with `requestTimeoutMilliseconds: 30000` (`runQuery`, [problemNotifications.ts](../ui/app/problemNotifications.ts#L496)); a query that does not end in `SUCCEEDED` throws `Query <state>.`.

### Q1. Problems per alerting profile

- **Source:** `profileProblemsQuery` in [ui/app/queries.ts](../ui/app/queries.ts#L763); used by `useProfileProblems` in [ProblemNotificationsTab.tsx](../ui/app/tabs/ProblemNotificationsTab.tsx#L84).
- **Runs:** once when the tab opens. It is a constant string, so it never re-runs while the tab stays open (not even after **Create workflows**).
- **Parameters:** none. `PROBLEM_DAYS = 7` is a constant; the shell timeframe does not change it.

**Query:**

```dql
fetch events, from:now()-7d
| filter event.kind == "DAVIS_PROBLEM" and event.status == "ACTIVE" and dt.analysis.ready == true
| expand profile = labels.alerting_profile
| filterOut isNull(profile)
| summarize problems = countDistinctExact(event.id), by: { profile }
| sort problems desc
```

**How it works:**

1. `fetch events, from:now()-7d`: every update of a Davis problem is one record in `events`. The code comment explains why `events` and not `dt.davis.problems`: `dt.davis.problems` keeps only the latest record of each problem, so it misses problems that have closed since.
2. `filter event.kind == "DAVIS_PROBLEM" and event.status == "ACTIVE" and dt.analysis.ready == true`: problem records only, open, and after root cause analysis finished (what a workflow trigger with *Wait for root cause analysis* sees).
3. `expand profile = labels.alerting_profile`: `labels.alerting_profile` is an array of the names of the alerting profiles the problem matched; `expand` makes one record per profile name.
4. `filterOut isNull(profile)`: drops records of problems that matched no profile.
5. `summarize problems = countDistinctExact(event.id), by: { profile }`: number of distinct problems per profile name (a problem with many updates counts once).
6. `sort problems desc`: largest first (the UI uses a map, so order does not matter there).

**Output:** `profile` (alerting profile name), `problems` (long). The tab builds a `Map<profile, problems>`; each row looks up its alerting profile **name** (not ID). A profile missing from the result shows `0`.

**Limits and cost:** 7 days of problem update records, no `limit`. Profiles are matched by name: two alerting profiles with the same name share one count.

**Open it yourself:** yes, under the search results table (*Problems per alerting profile (7 days)*): Show DQL, Copy, Open in Notebook, Add to Dashboard.

### Q2. Event names per classic event type

- **Source:** `eventNamesQuery(types)` in [alertingProfiles.ts](../ui/app/alertingProfiles.ts#L68), run by `eventNames(rows)` in [problemNotifications.ts](../ui/app/problemNotifications.ts#L509).
- **Runs:** at the start of **Validate**, before any plan is built, once for all selected notifications. It is skipped (no query) when none of the selected notifications' profiles has a predefined event filter. The types are collected from **all** selected notifications, including ones that will be skipped (disabled, manual).
- **Parameters:** `types`: the distinct `predefinedFilter.eventType` values of the selected profiles' `PREDEFINED` event filters, each quoted with `dqlString` (backslashes and double quotes escaped). The rest is fixed.

**Query** (one profile with an `OSI_HIGH_CPU` filter selected):

```dql
fetch dt.davis.events, from:now()-30d
| filter in(event.type, { "OSI_HIGH_CPU" })
| summarize names = collectDistinct(event.name, maxLength: 20), by: { event.type }
```

With two event types (for example a second profile filtering on `SERVICE_ERROR_RATE_INCREASED`) only the `in(...)` list grows:

```dql
fetch dt.davis.events, from:now()-30d
| filter in(event.type, { "OSI_HIGH_CPU", "SERVICE_ERROR_RATE_INCREASED" })
| summarize names = collectDistinct(event.name, maxLength: 20), by: { event.type }
```

**How it works:**

1. `fetch dt.davis.events, from:now()-30d`: Davis events (the single events that problems are made of) of the last 30 days.
2. `filter in(event.type, { ... })`: only the classic event types used by the selected profiles. The classic `eventType` values are used as `event.type` values as they are.
3. `summarize names = collectDistinct(event.name, maxLength: 20), by: { event.type }`: the distinct event names (titles) seen per type, at most 20 per type.

**Output:** one record per event type that had events: `event.type`, `names` (array of strings). Client side, `eventNames` builds `Map<event.type, names[]>` (non-string and empty values dropped). The translation then matches a predefined filter by these names (see [Event filters](#event-filters)). A type that is not in the result has no known name, and the profile falls back to the label.

**Limits and cost:** 30 days of `dt.davis.events`; one query per Validate; 20 names per type. If the query fails, Validate stops and shows the error in red under the selection list; nothing else runs.

**Open it yourself:** no. The names it found appear in the Gen 2 note of each profile (*Event filter on the classic event type OSI_HIGH_CPU is matched by its event name (CPU saturation) in the problem description.*).

### Q3. Profile rules vs label (Validate)

- **Source:** `compareQuery(rules, profile)` in [problemNotifications.ts](../ui/app/problemNotifications.ts#L389); built by `planMigration` (stored as `plan.query`) and run by `previewTrigger` ([problemNotifications.ts](../ui/app/problemNotifications.ts#L531)).
- **Runs:** during **Validate**, once per selected notification that gets a plan (skipped notifications run nothing), in batches of 4 (`inBatches(runnable, 4, ...)`: each batch of 4 runs in parallel and the next batch starts when all 4 finished). Re-runs only when you select **Validate** again.
- **Parameters:**
  - `rules`: the translated alerting profile (see [Alerting profile to DQL translation](#alerting-profile-to-dql-translation)); `null` when the profile cannot be translated or the trigger filter would exceed 1,000 characters; `""` when the profile has no rules. Depends on the **Delay timing** option and on Q2's event names. It is computed also when **Trigger filter** is set to the label, so both are always compared when possible.
  - `profile`: the alerting profile name, quoted with `dqlString`, inside `matchesValue(labels.alerting_profile, "<name>")`.
  - The window is fixed at 7 days.

**Query, translated rules** (the Email example below: profile *Payments production* with severity rules, delays, classic tags, a predefined event type, title / description / property filters; Delay timing *As configured*):

```dql
fetch events, from:now()-7d
| filter event.kind == "DAVIS_PROBLEM" AND event.status == "ACTIVE" AND matchesValue(event.status_transition, {"CREATED", "UPDATED", "REOPENED"}) AND dt.analysis.ready == true AND (matchesValue(event.category, {"AVAILABILITY", "ERROR", "SLOWDOWN", "RESOURCE_CONTENTION", "CUSTOM_ALERT", "MONITORING_UNAVAILABLE", "INFO"}))
| fieldsAdd rules = coalesce(((matchesValue(event.category, { "AVAILABILITY", "ERROR" }) OR (event.category == "SLOWDOWN" AND dt.duration_marker >= 15m AND matchesValue(entity_tags, "env:production") AND matchesValue(entity_tags, "team-payments")) OR (event.category == "RESOURCE_CONTENTION" AND dt.duration_marker >= 30m AND matchesValue(entity_tags, { "env:production", "env:staging" }))) AND (matchesPhrase(event.description, "CPU saturation") OR matchesValue(event.name, "*payment*") OR matchesValue(k8s.cluster.name, "prod-eu-1")) AND not (matchesValue(event.description, "Maintenance*"))), false), label = coalesce((matchesValue(labels.alerting_profile, "Payments production")), false)
| summarize rules = max(toLong(rules)), label = max(toLong(label)), problem = takeAny(concat(display_id, " ", event.name)), by: { event.id }
| summarize both = countIf(rules == 1 and label == 1), onlyRules = countIf(rules == 1 and label == 0), onlyLabel = countIf(rules == 0 and label == 1),
    onlyRulesExamples = collectDistinct(if(rules == 1 and label == 0, problem), maxLength: 3), onlyLabelExamples = collectDistinct(if(rules == 0 and label == 1, problem), maxLength: 3)
```

With **Delay timing** *One step later*, only the duration conditions change: `dt.duration_marker >= 15m` becomes `>= 30m` and `>= 30m` becomes `>= 1h`.

**Query, profile that cannot be translated** (rules `null`; the ServiceNow example below, profile *Team Checkout* with a management zone): only the label is counted.

```dql
fetch events, from:now()-7d
| filter event.kind == "DAVIS_PROBLEM" AND event.status == "ACTIVE" AND matchesValue(event.status_transition, {"CREATED", "UPDATED", "REOPENED"}) AND dt.analysis.ready == true AND (matchesValue(event.category, {"AVAILABILITY", "ERROR", "SLOWDOWN", "RESOURCE_CONTENTION", "CUSTOM_ALERT", "MONITORING_UNAVAILABLE", "INFO"}))
| filter matchesValue(labels.alerting_profile, "Team Checkout")
| summarize label = countDistinctExact(event.id)
```

**Query, profile without rules** (rules `""`, profile *Everything*): every problem matches the rules.

```dql
fetch events, from:now()-7d
| filter event.kind == "DAVIS_PROBLEM" AND event.status == "ACTIVE" AND matchesValue(event.status_transition, {"CREATED", "UPDATED", "REOPENED"}) AND dt.analysis.ready == true AND (matchesValue(event.category, {"AVAILABILITY", "ERROR", "SLOWDOWN", "RESOURCE_CONTENTION", "CUSTOM_ALERT", "MONITORING_UNAVAILABLE", "INFO"}))
| fieldsAdd rules = true, label = coalesce((matchesValue(labels.alerting_profile, "Everything")), false)
| summarize rules = max(toLong(rules)), label = max(toLong(label)), problem = takeAny(concat(display_id, " ", event.name)), by: { event.id }
| summarize both = countIf(rules == 1 and label == 1), onlyRules = countIf(rules == 1 and label == 0), onlyLabel = countIf(rules == 0 and label == 1),
    onlyRulesExamples = collectDistinct(if(rules == 1 and label == 0, problem), maxLength: 3), onlyLabelExamples = collectDistinct(if(rules == 0 and label == 1, problem), maxLength: 3)
```

**How it works (translated rules):**

1. `fetch events, from:now()-7d`: every problem update record of the last 7 days.
2. `filter <trigger base>`: the same condition the Workflows server generates for a Davis problem trigger with all categories and *Wait for root cause analysis* (`TRIGGER_BASE`): problem records, status `ACTIVE`, status transition `CREATED`, `UPDATED` or `REOPENED`, `dt.analysis.ready == true`, any of the seven categories. So the query sees the same problem updates the workflow trigger would be evaluated on.
3. `fieldsAdd rules = coalesce((<rules>), false), label = coalesce((<label filter>), false)`: evaluates both conditions on every update. `coalesce(..., false)` turns a `null` result (a field missing on the record, for example `k8s.cluster.name`) into `false`. With empty rules, `rules = true`.
4. `summarize rules = max(toLong(rules)), label = max(toLong(label)), problem = takeAny(concat(display_id, " ", event.name)), by: { event.id }`: one row per problem. `max(toLong(...))` is 1 when **any** update of the problem matched, which mirrors the trigger: it fires on the first matching update (for example once `dt.duration_marker` reaches the delay step). `problem` is a display string such as `P-00000001 CPU saturation`.
5. `summarize both = countIf(...), onlyRules = countIf(...), onlyLabel = countIf(...), onlyRulesExamples = collectDistinct(if(...), maxLength: 3), onlyLabelExamples = collectDistinct(if(...), maxLength: 3)`: number of problems matched by both, only by the translated rules, only by the label, and up to 3 example problems for each of the two "only" groups.

For the label-only variant, step 3 is replaced by `filter <label filter>` and step 4-5 by `summarize label = countDistinctExact(event.id)`.

**Output and how the UI uses it** (`previewTrigger`):

| Field | Use |
| --- | --- |
| `both`, `onlyRules`, `onlyLabel` | Message *Last 7 days: the translated rules match <both + onlyRules> problems, the alerting profile label <both + onlyLabel> (<both> both).* |
| `onlyLabelExamples` | Line *<n> problem(s) carried the label but do(es) not match the rules (e.g. ...).* Orange when the trigger uses the rules (these problems would no longer notify). |
| `onlyRulesExamples` | Line *<n> problem(s) match(es) the rules but never carried the label (e.g. ...). With a delay these are usually problems that closed shortly after it.* |
| `label` (label-only variant) | Message *<n> problems in the last 7 days carry this alerting profile label.* |
| derived `problems` | Trigger source *rules*: `both + onlyRules`; source *label* with translated rules: `both + onlyLabel`; label-only variant: `label`. Used for the zero-problem warning and the *Skip notifications whose trigger matched no problem* option. |

If the query fails, the line shows *Query failed: <message>* in red and that notification is never created (a filter that fails as DQL would make a trigger that never fires).

**Limits and cost:** 7 days of problem update records per notification; examples are capped at 3 per group. The trigger itself evaluates single records as they arrive, so the comparison approximates what the workflow would have done.

**Open it yourself:** yes, on every Validate line: QueryActions titled *Profile rules vs label: <notification name>* (Show DQL, Copy, Open in Notebook, Add to Dashboard).

### Q4. Workflow trigger filter

- **Source:** `TRIGGER_BASE` and `triggerFilter(custom)` ([problemNotifications.ts](../ui/app/problemNotifications.ts#L211)), `labelFilter(profile)` ([problemNotifications.ts](../ui/app/problemNotifications.ts#L218)), `translateProfile` ([alertingProfiles.ts](../ui/app/alertingProfiles.ts#L150)).
- **Runs:** not run by the app. The custom filter goes into `triggerConfiguration.value.customFilter` of each created workflow, and the full filter into `trigger.eventTrigger.filterQuery`. The comment in `problemNotifications.ts` notes that the Workflows server builds the effective filter from `triggerConfiguration`, so the custom filter is what counts. Workflows evaluates it on every problem update.
- **Parameters:** trigger source (**Alerting profile rules as DQL** or **Alerting profile label (deprecated)**), **Delay timing**, the alerting profile, and Q2's event names.

**Base filter** (what every created trigger starts from, 313 characters; also the whole filter when the custom filter is empty):

```dql
event.kind == "DAVIS_PROBLEM" AND event.status == "ACTIVE" AND matchesValue(event.status_transition, {"CREATED", "UPDATED", "REOPENED"}) AND dt.analysis.ready == true AND (matchesValue(event.category, {"AVAILABILITY", "ERROR", "SLOWDOWN", "RESOURCE_CONTENTION", "CUSTOM_ALERT", "MONITORING_UNAVAILABLE", "INFO"}))
```

**Full trigger filter for the Email example** (`TRIGGER_BASE AND (<custom filter>)`, 883 characters):

```dql
event.kind == "DAVIS_PROBLEM" AND event.status == "ACTIVE" AND matchesValue(event.status_transition, {"CREATED", "UPDATED", "REOPENED"}) AND dt.analysis.ready == true AND (matchesValue(event.category, {"AVAILABILITY", "ERROR", "SLOWDOWN", "RESOURCE_CONTENTION", "CUSTOM_ALERT", "MONITORING_UNAVAILABLE", "INFO"})) AND ((matchesValue(event.category, { "AVAILABILITY", "ERROR" }) OR (event.category == "SLOWDOWN" AND dt.duration_marker >= 15m AND matchesValue(entity_tags, "env:production") AND matchesValue(entity_tags, "team-payments")) OR (event.category == "RESOURCE_CONTENTION" AND dt.duration_marker >= 30m AND matchesValue(entity_tags, { "env:production", "env:staging" }))) AND (matchesPhrase(event.description, "CPU saturation") OR matchesValue(event.name, "*payment*") OR matchesValue(k8s.cluster.name, "prod-eu-1")) AND not (matchesValue(event.description, "Maintenance*")))
```

**Label filter** (trigger source *label*, or fallback):

```dql
matchesValue(labels.alerting_profile, "Team Checkout")
```

The full translation example, with the alerting profile it comes from, is in [Full translation example](#full-translation-example).

**Length limit:** the whole trigger filter must stay within 1,000 characters (`FILTER_MAX`, from the upgrade guide). With the 313-character base and the ` AND (` ... `)` wrapper, the custom filter has 680 characters. When the translated rules make it longer, the plan falls back to the label (notes *The translated rules make the trigger filter longer than 1000 characters.* and *Rules not translated (too long); the trigger uses the alerting profile label instead.*). When even the label filter is too long (a very long profile name), the notification is skipped: *Trigger filter longer than 1000 characters (alerting profile name too long).*

### Client-side processing

#### Matching notifications to workflows

`matchNotifications(notifications, workflows)` ([problemNotifications.ts](../ui/app/problemNotifications.ts#L189)):

1. Builds a map from workflow **title** to workflow. When several workflows share a title, the first one listed is kept, unless a later one carries the migration description and the kept one does not (a workflow created by the migration wins).
2. For each notification, looks up its display name in that map (exact, case-sensitive string equality; no trimming).
3. Adds `workflow` (the match or none), `managed` (the match carries `MIGRATION_DESCRIPTION`) and `conversion` (`conversionOf`).

`listNotifications()` ([problemNotifications.ts](../ui/app/problemNotifications.ts#L121)) joins each notification to its alerting profile by object ID (`value.alertingProfile` = profile `objectId`), copies the type's own settings block (`emailNotification`, `slackNotification`, `serviceNowNotification`, `webHookNotification`, `jiraNotification`, `pagerDutyNotification`, `opsGenieNotification`, `victorOpsNotification`, `xMattersNotification`, `trelloNotification`, `ansibleTowerNotification`) as `config`, and sorts by name. Secrets come back masked from the Settings API and are never copied.

#### Conversion per notification type

`conversionOf` decides whether a notification has an automatic conversion; see the derived statuses in [Checks and scoring](#checks-and-scoring). The task each conversion builds is described in [The workflow body](#the-workflow-body).

#### Alerting profile to DQL translation

`translateProfile(profile, names, timing)` ([alertingProfiles.ts](../ui/app/alertingProfiles.ts#L150)) turns a classic alerting profile into a DQL matcher on problem fields, so the trigger does not depend on the deprecated `labels.alerting_profile`. It follows the classic semantics stated in the file header: *management zone AND severity rules AND event filters*; severity rules are ORed, and inside a rule the category, the open duration and the tags are ANDed; non-negated event filters are ORed, negated ones ANDed, and the two groups ANDed. Grail problem fields used were validated on the demo tenant with `dtctl` (code comment).

Workflow trigger matchers have no `contains`, `startsWith`, `endsWith` and no case-sensitive `matchesValue` (checked with `dtctl verify openpipeline-matcher`), so text operators use `matchesValue` wildcards and only case-sensitive *equals* stays exact (`==`).

##### Management zone

A profile with `managementZone` set is not translated: problems carry no management zone. Note (Gen 2): *Management zone filter (Gen 2): problems carry no management zone. Recreate the condition on primary fields (for example dt.security_context or primary_tags.\*).* The trigger then uses the label.

##### Severity rules

| Classic `severityLevel` | `event.category` |
| --- | --- |
| `AVAILABILITY` | `AVAILABILITY` |
| `ERRORS` | `ERROR` |
| `PERFORMANCE` | `SLOWDOWN` |
| `RESOURCE_CONTENTION` | `RESOURCE_CONTENTION` |
| `CUSTOM_ALERT` | `CUSTOM_ALERT` |
| `MONITORING_UNAVAILABLE` | `MONITORING_UNAVAILABLE` |
| anything else | left out, note *Severity level <x> is unknown and was left out.* (approximate) |

Classic severities never match `INFO` problems.

For each rule, its conditions are built from:

- **Delay** (`delayInMinutes > 0`): `dt.duration_marker >= <step>`. `dt.duration_marker` is the duration milestone a problem has reached since `event.start` (5, 10, 15, 30 min, 1, 2, 4, 24 h, 7 d; never ahead of the elapsed time). The step is chosen by **Delay timing**:

  | Classic delay (minutes) | As configured (default) | One step later |
  | --- | --- | --- |
  | 0 | no duration condition | no duration condition |
  | 1-5 | `>= 5m` | `>= 10m` |
  | 6-10 | `>= 10m` | `>= 15m` |
  | 11-15 | `>= 15m` | `>= 30m` |
  | 16-30 | `>= 30m` | `>= 1h` |
  | 31-60 | `>= 1h` | `>= 2h` |
  | 61-120 | `>= 2h` | `>= 4h` |
  | 121-240 | `>= 4h` | `>= 1d` |
  | 241-1440 | `>= 1d` | `>= 7d` |
  | above 1440 | `>= 7d` | `>= 7d` (note *A 7-day delay has no later duration step; kept at 7 d.*) |

  A delay that is not exactly a step adds *Delay of <n> min rounded up to <step> ...* (approximate). *One step later* adds *Delay of <n> min moved one step later, to <step>.* Any delay adds one explanation note: classic counted the delay from when it opened the problem, a few minutes after the problem start, so with *As configured* problems that close just after the delay notify through the workflow but did not through classic; with *One step later* problems that close between the two steps are not notified although classic notified some of them. The code comment records the effect on the demo tenant's *Default* profile over 7 days: *As configured* 226 extra / 0 missed problems, *One step later* 8 extra / 17 missed, with 5-minute delays fitting worse.
- **Tags** (only when `tagFilterIncludeMode` is `INCLUDE_ANY` or `INCLUDE_ALL` and `tagFilter` is not empty): matched on `entity_tags` exactly as the profile lists them. `INCLUDE_ANY` with several tags: `matchesValue(entity_tags, { "a", "b" })`. `INCLUDE_ALL`, or a single tag: `matchesValue(entity_tags, "a") AND matchesValue(entity_tags, "b")`. Note (Gen 2): *Classic tags (...) are matched on entity_tags, which is deprecated. Move the condition to primary tags (primary_tags.<name>) or other primary fields.*

Rules with identical conditions (same delay step and same tags) are grouped, so they share one category list: one category gives `event.category == "X"`, several give `matchesValue(event.category, { "X", "Y" })`. A group with conditions becomes `(<category> AND <conditions>)`. Groups are ORed.

##### Event filters

| Classic filter | DQL | Note |
| --- | --- | --- |
| `PREDEFINED`, `eventType` T | `matchesPhrase(event.description, "<name>")` for each event name of T found by Q2, ORed. `event.description` of a problem names every event of the problem. Negated: `not (...)`. | Gen 2, approximate: *Event filter on the classic event type T is matched by its event name(s) (...) in the problem description.* If Q2 found no events of T: the profile is not translated (*Event filter on T: no T events in the last 30 days, so its event name is unknown.*) and the trigger uses the label. |
| `CUSTOM`, title filter | on `event.name` (the problem title: the event title for single-event problems, *Multiple ... problems* otherwise) | approximate |
| `CUSTOM`, description filter | on `event.description` (the problem summary of every event) | approximate |
| `CUSTOM`, property (`metadataFilterItems`) | `matchesValue(<key>, "<value>")` on the problem field with the same key (backticks around keys that are not plain identifiers); negated: `not (...)` | approximate: *Event property <key> is matched on the problem field of the same name; check that problems carry it.* |

Text filter operators (`textClause`, [alertingProfiles.ts](../ui/app/alertingProfiles.ts#L72)); a filter with `enabled: false` or an empty value is ignored:

| Operator | DQL |
| --- | --- |
| `STRING_EQUALS`, case-sensitive | `<field> == "<v>"` |
| `STRING_EQUALS`, case-insensitive | `matchesValue(<field>, "<v>")` |
| `CONTAINS` | `matchesValue(<field>, "*<v>*")` |
| `BEGINS_WITH` | `matchesValue(<field>, "<v>*")` |
| `ENDS_WITH` | `matchesValue(<field>, "*<v>")` |
| anything else (regular expression) | not translatable: *Event filter uses a regular expression, which trigger matchers do not support.*; the trigger uses the label |

Negated text filters become `not (<clause>)`. A case-sensitive filter other than equals adds *The <title/description> filter was case-sensitive; trigger matchers only compare case-insensitively.*; a value containing `*` adds *... contains \*, which matchesValue treats as a wildcard.* (both approximate).

Inside one custom filter, its parts (title, description, properties) are ANDed; the filter belongs to the negated group only if all of its parts are negated.

##### Assembly

`<severity groups ORed> AND <non-negated event filters ORed> AND <each negated event filter>`, leaving out empty parts. A profile with no rules gives an empty filter (every problem; note *The profile has no rules, so every problem matches.*). Notes are de-duplicated. The result is `approximate` when any note is.

##### Full translation example

Alerting profile *Payments production* (`builtin:alerting.profile` value; placeholder data):

```json
{
  "name": "Payments production",
  "severityRules": [
    {
      "severityLevel": "AVAILABILITY",
      "delayInMinutes": 0,
      "tagFilterIncludeMode": "NONE",
      "tagFilter": []
    },
    {
      "severityLevel": "ERRORS",
      "delayInMinutes": 0,
      "tagFilterIncludeMode": "NONE",
      "tagFilter": []
    },
    {
      "severityLevel": "PERFORMANCE",
      "delayInMinutes": 12,
      "tagFilterIncludeMode": "INCLUDE_ALL",
      "tagFilter": [
        "env:production",
        "team-payments"
      ]
    },
    {
      "severityLevel": "RESOURCE_CONTENTION",
      "delayInMinutes": 30,
      "tagFilterIncludeMode": "INCLUDE_ANY",
      "tagFilter": [
        "env:production",
        "env:staging"
      ]
    }
  ],
  "eventFilters": [
    {
      "type": "PREDEFINED",
      "predefinedFilter": {
        "eventType": "OSI_HIGH_CPU",
        "negate": false
      }
    },
    {
      "type": "CUSTOM",
      "customFilter": {
        "titleFilter": {
          "enabled": true,
          "operator": "CONTAINS",
          "value": "payment",
          "negate": false,
          "caseSensitive": false
        }
      }
    },
    {
      "type": "CUSTOM",
      "customFilter": {
        "descriptionFilter": {
          "enabled": true,
          "operator": "BEGINS_WITH",
          "value": "Maintenance",
          "negate": true,
          "caseSensitive": true
        }
      }
    },
    {
      "type": "CUSTOM",
      "customFilter": {
        "metadataFilter": {
          "metadataFilterItems": [
            {
              "metadataKey": "k8s.cluster.name",
              "metadataValue": "prod-eu-1",
              "negate": false
            }
          ]
        }
      }
    }
  ]
}
```

Q2 returned the event name `CPU saturation` for `OSI_HIGH_CPU`. Generated custom filter, **Delay timing** *As configured* (this exact single line goes into the workflow):

```dql
(matchesValue(event.category, { "AVAILABILITY", "ERROR" }) OR (event.category == "SLOWDOWN" AND dt.duration_marker >= 15m AND matchesValue(entity_tags, "env:production") AND matchesValue(entity_tags, "team-payments")) OR (event.category == "RESOURCE_CONTENTION" AND dt.duration_marker >= 30m AND matchesValue(entity_tags, { "env:production", "env:staging" }))) AND (matchesPhrase(event.description, "CPU saturation") OR matchesValue(event.name, "*payment*") OR matchesValue(k8s.cluster.name, "prod-eu-1")) AND not (matchesValue(event.description, "Maintenance*"))
```

The same filter, re-indented for reading only:

```dql
(
  matchesValue(event.category, { "AVAILABILITY", "ERROR" })
  OR (event.category == "SLOWDOWN" AND dt.duration_marker >= 15m
      AND matchesValue(entity_tags, "env:production") AND matchesValue(entity_tags, "team-payments"))
  OR (event.category == "RESOURCE_CONTENTION" AND dt.duration_marker >= 30m
      AND matchesValue(entity_tags, { "env:production", "env:staging" }))
)
AND (
  matchesPhrase(event.description, "CPU saturation")
  OR matchesValue(event.name, "*payment*")
  OR matchesValue(k8s.cluster.name, "prod-eu-1")
)
AND not (matchesValue(event.description, "Maintenance*"))
```

How each rule maps:

| Classic rule | DQL part |
| --- | --- |
| AVAILABILITY, no delay, no tags; ERRORS, no delay, no tags | grouped: `matchesValue(event.category, { "AVAILABILITY", "ERROR" })` |
| PERFORMANCE, 12 min, include all of `env:production`, `team-payments` | `(event.category == "SLOWDOWN" AND dt.duration_marker >= 15m AND matchesValue(entity_tags, "env:production") AND matchesValue(entity_tags, "team-payments"))` |
| RESOURCE_CONTENTION, 30 min, include any of `env:production`, `env:staging` | `(event.category == "RESOURCE_CONTENTION" AND dt.duration_marker >= 30m AND matchesValue(entity_tags, { "env:production", "env:staging" }))` |
| Predefined `OSI_HIGH_CPU` | `matchesPhrase(event.description, "CPU saturation")` |
| Title contains `payment` | `matchesValue(event.name, "*payment*")` |
| Property `k8s.cluster.name` = `prod-eu-1` | `matchesValue(k8s.cluster.name, "prod-eu-1")` |
| Description begins with `Maintenance` (case-sensitive), negated | `not (matchesValue(event.description, "Maintenance*"))` (case-insensitive) |

Profile notes shown by Validate (badge in brackets; Gen 2 notes are listed first in the UI):

```text
- [≈] Delay of 12 min rounded up to 15m (problem durations are marked at 5, 10, 15, 30 min, 1, 2, 4, 24 h and 7 d).
- [Gen 2] Classic tags (env:production, team-payments) are matched on entity_tags, which is deprecated. Move the condition to primary tags (primary_tags.<name>) or other primary fields.
- [Gen 2] Classic tags (env:production, env:staging) are matched on entity_tags, which is deprecated. Move the condition to primary tags (primary_tags.<name>) or other primary fields.
- Delays use dt.duration_marker (time since the problem started). Classic counted from when it opened the problem, a few minutes later, so problems that close just after the delay notify through the workflow but did not through classic.
- [Gen 2] Event filter on the classic event type OSI_HIGH_CPU is matched by its event name (CPU saturation) in the problem description.
- [≈] Event title filters are matched against the problem title (the event title for single-event problems, "Multiple … problems" otherwise).
- [≈] The description filter was case-sensitive; trigger matchers only compare case-insensitively.
- [≈] Event description filters are matched against the problem description, which summarises every event of the problem.
- [≈] Event property k8s.cluster.name is matched on the problem field of the same name; check that problems carry it.
```

*Profile rules* column for this profile: `DQL (approximate)` with Gen 2 `classic tags, classic event types`.

With **Delay timing** *One step later*:

```dql
(matchesValue(event.category, { "AVAILABILITY", "ERROR" }) OR (event.category == "SLOWDOWN" AND dt.duration_marker >= 30m AND matchesValue(entity_tags, "env:production") AND matchesValue(entity_tags, "team-payments")) OR (event.category == "RESOURCE_CONTENTION" AND dt.duration_marker >= 1h AND matchesValue(entity_tags, { "env:production", "env:staging" }))) AND (matchesPhrase(event.description, "CPU saturation") OR matchesValue(event.name, "*payment*") OR matchesValue(k8s.cluster.name, "prod-eu-1")) AND not (matchesValue(event.description, "Maintenance*"))
```

and these notes are added:

```text
- Delay of 12 min moved one step later, to 30m.
- Delay of 30 min moved one step later, to 1h.
- Delays use dt.duration_marker (time since the problem started), one step later to make up for classic counting from a few minutes after the start. Problems that close between the two steps are not notified, although classic notified some of them.
```

If Q2 had returned two names (`CPU saturation`, `High CPU usage`), the predefined filter would become `(matchesPhrase(event.description, "CPU saturation") OR matchesPhrase(event.description, "High CPU usage"))`. If Q2 had returned none, the profile would fall back to the label.

A profile with only event filters, one of them a negated predefined filter (Q2 returned two names):

```json
{
  "name": "Disk alerts",
  "severityRules": [],
  "eventFilters": [
    {
      "type": "PREDEFINED",
      "predefinedFilter": {
        "eventType": "OSI_HIGH_CPU",
        "negate": true
      }
    },
    {
      "type": "CUSTOM",
      "customFilter": {
        "titleFilter": {
          "enabled": true,
          "operator": "STRING_EQUALS",
          "value": "Low disk space",
          "negate": false,
          "caseSensitive": true
        }
      }
    },
    {
      "type": "CUSTOM",
      "customFilter": {
        "titleFilter": {
          "enabled": true,
          "operator": "ENDS_WITH",
          "value": "disk full",
          "negate": false,
          "caseSensitive": false
        }
      }
    }
  ]
}
```

```dql
(event.name == "Low disk space" OR matchesValue(event.name, "*disk full")) AND (not (matchesPhrase(event.description, "CPU saturation") OR matchesPhrase(event.description, "High CPU usage")))
```

A *Default*-like profile (all six severities, 30-minute delay on PERFORMANCE and RESOURCE_CONTENTION, no tags, no event filters):

```dql
(matchesValue(event.category, { "AVAILABILITY", "ERROR", "CUSTOM_ALERT", "MONITORING_UNAVAILABLE" }) OR (matchesValue(event.category, { "SLOWDOWN", "RESOURCE_CONTENTION" }) AND dt.duration_marker >= 30m))
```

*One step later*:

```dql
(matchesValue(event.category, { "AVAILABILITY", "ERROR", "CUSTOM_ALERT", "MONITORING_UNAVAILABLE" }) OR (matchesValue(event.category, { "SLOWDOWN", "RESOURCE_CONTENTION" }) AND dt.duration_marker >= 1h))
```

#### Planning a workflow

`planMigration(row, duplicateName, source, names, timing)` ([problemNotifications.ts](../ui/app/problemNotifications.ts#L407)) decides, in this order, whether a selected notification gets a workflow:

| # | Condition | Result line | Colour |
| --- | --- | --- | --- |
| 1 | Notification disabled | skipped: *Disabled in classic; the migration converts enabled notifications only.* | grey |
| 2 | No automatic conversion | skipped: the conversion reason | orange (manual) |
| 3 | Alerting profile not found | skipped: *Alerting profile <id or (none)> not found; fix the notification in classic first.* | orange (manual) |
| 4 | Same-name workflow created by the migration | skipped: *Already migrated: workflow "<name>" exists.* | grey |
| 5 | Same-name workflow not created by the migration | skipped: *A workflow with this name exists and was not created by the migration; left unchanged.* | grey |
| 6 | An earlier selected notification has the same name | skipped: *Another selected notification has the same name; only the first one is migrated (workflows are matched by name).* | grey |
| 7 | No task could be built | skipped: *No conversion for this notification.* (not reachable after check 2) | orange (manual) |
| 8 | Label filter longer than 1,000 characters | skipped: *Trigger filter longer than 1000 characters (alerting profile name too long).* | orange (manual) |
| | otherwise | **create** | see [Validate results](#validate-results) |

For a notification that gets a plan:

1. `translateProfile` runs with Q2's names and the chosen timing.
2. With trigger source *label*, only the Gen 2 notes of the translation are kept (the label covers delays and filters).
3. If the translated rules make the trigger filter longer than 1,000 characters, they are dropped (`rules = null`) with a note.
4. With source *rules* and no usable rules, the source becomes *label*, with *Rules not translated (<reason>); the trigger uses the alerting profile label instead.*
5. Custom filter: the rules (possibly `""`), or `matchesValue(labels.alerting_profile, "<profile name>")`.
6. With the label: note *Filters on labels.alerting_profile, which the upgrade guide marks as deprecated.*, plus *The alerting profile name contains \*, which matchesValue treats as a wildcard.* when it does.
7. `query` = Q3 for these rules and profile name; `body` = the workflow body.

`planMigrations` runs this for every selected notification in list order, tracking names already seen for check 6.

## API calls

| # | Method | Endpoint or SDK method | Scope | When |
| --- | --- | --- | --- | --- |
| A1 | GET (paged) | `/platform/classic/environment-api/v2/settings/objects`, schema `builtin:problem.notifications` (`settingsObjectsClient.getSettingsObjects`) | `settings:objects:read` | Tab load; after **Create workflows** |
| A2 | GET (paged) | Same endpoint, schema `builtin:alerting.profile` | `settings:objects:read` | Same time as A1, in parallel |
| A3 | GET (paged) | `/platform/automation/v1/workflows?limit=200&offset=<n>` (`httpClient.send`) | `automation:workflows:read` | Tab load (in parallel with A1/A2); after **Create workflows** |
| A4 | POST + GET | `/platform/storage/query/v1/query:execute`, `/query:poll` (`useDql`; `queryExecutionClient`) | `storage:events:read`, `storage:buckets:read` | Q1 on tab load; Q2 and Q3 on **Validate** |
| A5 | POST | `/api/workflows` (app function, `functions.call("workflows", { data: { action: "status" } })`) | (function: `environment-api:credentials:read`) | Convert form mount; after the token is saved |
| A6 | GET | `/platform/classic/environment-api/v2/credentials?name="architect-assistant-workflows"&type=TOKEN` (`credentialVaultClient.listCredentials`) | `environment-api:credentials:read` | **Save to the credential vault** |
| A7 | PUT or POST | `/platform/classic/environment-api/v2/credentials/{id}` (`updateCredentials`) or `/platform/classic/environment-api/v2/credentials` (`createCredentials`) | `environment-api:credentials:write` | **Save to the credential vault**, after A6 |
| A8 | POST | `/api/workflows` (app function, `functions.call("workflows", { data: { action: "create", body } })`) | (function: `environment-api:credentials:read`; the platform token: `automation:workflows:write`) | **Create workflows**, once per workflow, one at a time |
| Links | intents | `dynatrace.settings` / `deprecated_open_settings_by_id`; `dynatrace.automations` / `view-workflow-by-id`; `dynatrace.notebooks` / `view-query`; `dynatrace.dashboards` / `add-to-dashboard` | none | On click |

### A1, A2. Classic notifications and alerting profiles

- **SDK:** `settingsObjectsClient.getSettingsObjects` from `@dynatrace-sdk/client-classic-environment-v2` (`settingsObjects(schemaId)`, [problemNotifications.ts](../ui/app/problemNotifications.ts#L93)).
- **Request:** first page `GET /platform/classic/environment-api/v2/settings/objects?schemaIds=builtin:problem.notifications&scopes=environment&fields=objectId,value&pageSize=500`; following pages `?nextPageKey=<key>` only, until no `nextPageKey` is returned. The same for `schemaIds=builtin:alerting.profile`. Both schemas are read in parallel.
- **Response fields used:** `items[].objectId`, `items[].value`, `nextPageKey`. From a notification value: `displayName`, `type`, `enabled`, `alertingProfile`, and the type block. From a profile value: `name`, `managementZone`, `severityRules[]` (`severityLevel`, `delayInMinutes`, `tagFilterIncludeMode`, `tagFilter`), `eventFilters[]` (`type`, `predefinedFilter.eventType` / `.negate`, `customFilter.titleFilter`, `.descriptionFilter`, `.metadataFilter.metadataFilterItems[]`).

Example response item for a notification (placeholders; only the fields the app reads):

```json
{
  "objectId": "<notification-object-id-1>",
  "value": {
    "enabled": true,
    "displayName": "Payments production - Email",
    "type": "EMAIL",
    "alertingProfile": "<alerting-profile-object-id-1>",
    "emailNotification": {
      "recipients": [
        "oncall-payments@example.com"
      ],
      "ccRecipients": [
        "payments-leads@example.com"
      ],
      "bccRecipients": [],
      "subject": "{State} Problem {ProblemID}: {ImpactedEntity}",
      "body": "{ProblemDetailsHTML}",
      "notifyClosedProblems": true
    }
  }
}
```

Fields read per type block (secrets are masked by the API and never copied):

| Type | Fields read |
| --- | --- |
| Email (`emailNotification`) | `recipients`, `ccRecipients`, `bccRecipients`, `subject`, `body`, `notifyClosedProblems` |
| Slack (`slackNotification`) | `channel`, `message` (the webhook URL is a secret and is not read) |
| ServiceNow (`serviceNowNotification`) | `sendIncidents`, `sendEvents`, `message`, `instanceName`, `url` |
| Custom webhook (`webHookNotification`) | `url`, `urlContainsSecret`, `headers[]` (`name`, `value`, `secret`), `payload`, `useOAuth2`, `notifyClosedProblems` |

### A3. Workflows

- **SDK:** `httpClient.send` from `@dynatrace-sdk/http-client` (`listWorkflows`, [problemNotifications.ts](../ui/app/problemNotifications.ts#L145)).
- **Request:** `GET /platform/automation/v1/workflows?limit=200&offset=0`, then `offset=200`, `400`, ... Paging stops when a page has fewer than 200 results or the collected count reaches the response's `count`.
- **Response fields used:** `count`, `results[].id`, `results[].title`, `results[].description` (compared with `MIGRATION_DESCRIPTION`).

```json
{
  "count": 2,
  "results": [
    { "id": "<workflow-uuid-1>", "title": "Default - Slack", "description": "Auto Created Simple Workflow from Classic Problem Notification and corresponding Alerting Profile (via migration workflow)" },
    { "id": "<workflow-uuid-2>", "title": "Nightly report", "description": "" }
  ]
}
```

### A4. DQL

Q1 runs through `useDql` (`@dynatrace-sdk/react-hooks`), which posts the query and polls for the result. Q2 and Q3 run through `runQuery` ([problemNotifications.ts](../ui/app/problemNotifications.ts#L496)): `POST /platform/storage/query/v1/query:execute` with body `{"query": "<dql>", "requestTimeoutMilliseconds": 30000}`, then `GET /platform/storage/query/v1/query:poll?request-token=<token>&request-timeout-milliseconds=30000` while the state is `RUNNING` or `NOT_STARTED`. `result.records` is used.

### A5. Token status (`workflows` app function)

- **Call:** `functions.call("workflows", { data: { action: "status" } })` = `POST /api/workflows` with body `{"action":"status"}` (`readWorkflowTokenStatus`, [problemNotifications.ts](../ui/app/problemNotifications.ts#L595)).
- **When:** each time the Convert form mounts (tab open, switching back to the action) and after a token is saved.
- **Server side** ([api/workflows.function.ts](../api/workflows.function.ts#L81)):
  1. `credentialVaultClient.listCredentials({ name: "\"architect-assistant-workflows\"", type: "TOKEN" })` = `GET /platform/classic/environment-api/v2/credentials?name=%22architect-assistant-workflows%22&type=TOKEN`; picks the credential whose `name` matches exactly.
  2. `credentialVaultClient.getCredentialsDetails({ id })` = `GET /platform/classic/environment-api/v2/credentials/{id}/details`; uses `token`, `owner`, `ownerAccessOnly`.
  3. `GET <environment URL>/platform/automation/v1/workflows?limit=1` with `Authorization: Bearer <platform token>` and `Accept: application/json`. Success only proves `automation:workflows:read`; write is proven by the first create.
- **Responses** (HTTP 200 from the function with a JSON `status`):

| `status` | Meaning | UI state |
| --- | --- | --- |
| `ok-status` (with `owner`, `ownerAccessOnly`) | Token found and can list workflows | green check: *Workflows are created with the platform token in credential architect-assistant-workflows and are owned by the token's user (credential owner <owner>, owner only: ... / shared: ...)* |
| `no-credential` | No such credential visible to the user, no token value, or the vault could not be read | neutral message: *Apps not provided by Dynatrace cannot hold the automation:workflows:write scope, so this app creates the workflows through its workflows function with a platform token. Store one below.* and the token form |
| `unauthorized` (401), `forbidden` (403, also expired tokens), `error` (other HTTP status, network error) | Token stored but not working | warning: *The stored platform token does not work: <message>* and the token form |

If the function itself answers with a non-2xx status, the UI shows `The workflows app function returned HTTP <status>: <first 300 characters of the body>`; HTTP 404 gives *The workflows app function is not available in this running app (HTTP 404). Restart npx dt-app dev (or deploy), then retry.*

### A6, A7. Store the platform token

`storeWorkflowToken(token, ownerAccessOnly)` ([problemNotifications.ts](../ui/app/problemNotifications.ts#L603)):

1. Trims the token and checks it against `^dt0s16\.[A-Za-z0-9]+\.[A-Za-z0-9]+$`; otherwise *That does not look like a platform token (dt0s16.XXXX.YYYY).* and no call is made.
2. A6: `GET /platform/classic/environment-api/v2/credentials?name=%22architect-assistant-workflows%22&type=TOKEN`; uses `credentials[].name` and `credentials[].id`.
3. A7: if found, `PUT /platform/classic/environment-api/v2/credentials/{id}`; otherwise `POST /platform/classic/environment-api/v2/credentials` (uses the returned `id`). Body:

```json
{
  "name": "architect-assistant-workflows",
  "description": "Architect Assistant Problem notifications: platform token (automation:workflows:read, automation:workflows:write) used to create the migration workflows.",
  "type": "TOKEN",
  "token": "dt0s16.XXXX.YYYY",
  "scopes": ["APP_ENGINE"],
  "ownerAccessOnly": true
}
```

4. Result: *Credential "architect-assistant-workflows" updated.* / *... created.* (green), or the API error message (red). On success the input is cleared, the form closes and A5 runs again.

### A8. Create a workflow (`workflows` app function)

- **Call:** `functions.call("workflows", { data: { action: "create", body: <workflow body> } })` = `POST /api/workflows` with body `{"action":"create","body":{ ... }}` (`createWorkflows`, [problemNotifications.ts](../ui/app/problemNotifications.ts#L630)). One call per workflow, sequentially, so each failure is reported for its notification. There is no bulk create.
- **Server side** ([api/workflows.function.ts](../api/workflows.function.ts#L81)):
  1. Reads the token as in A5 steps 1-2.
  2. Rejects any body that is not shaped like a migration workflow (`notMigrationShaped`, [api/workflows.function.ts](../api/workflows.function.ts#L69)), because workflows run with their owner's permissions and anyone who can use the credential could otherwise run arbitrary workflow code as the token's user:

     | Check | Rejection message |
     | --- | --- |
     | body present | *No workflow body.* |
     | `type == "SIMPLE"` | *Only simple workflows are created.* |
     | `description == MIGRATION_DESCRIPTION` | *Only workflows with the migration description are created.* |
     | non-empty `title` | *The workflow has no title.* |
     | `trigger.eventTrigger.triggerConfiguration.type == "davis-problem"` | *Only workflows with a Davis problem trigger are created.* |
     | exactly one task, action one of `dynatrace.email:send-email`, `dynatrace.slack:slack-send-message`, `dynatrace.servicenow:snow-create-incident`, `dynatrace.automations:http-function` | *Only one task of ... is allowed.* |

  3. `POST <environment URL>/platform/automation/v1/workflows` with `Authorization: Bearer <platform token>`, `Accept: application/json`, `Content-Type: application/json` and the workflow body ([examples](#workflow-body-examples)). Uses the response `id`.
- **Function responses:** `ok-create` with `id`; `rejected`; `no-credential`; `unauthorized` (*The platform token was rejected (...)*); `forbidden` (*The platform token is expired, lacks the automation:workflows scopes, or its user lacks the permission (...)*); `error` (*Automation API returned HTTP <code>: <message>* with constraint violations `path: message` when present, or *Could not reach <url>: ...*).
- **UI result line:** green *<name>: Workflow created.* with *Open workflow ↗* (intent `dynatrace.automations` / `view-workflow-by-id`), or red *<name>: Creation failed: <message>*.

## Remediation actions

### Convert classic problem notifications to simple workflows

**What it fixes:** classic problem notifications without a workflow. It creates one simple workflow per selected notification, titled with the notification's name, with a Davis problem trigger (all categories, after root cause analysis, open problems only) filtered on the notification's alerting profile, and one task: Email, Slack message, ServiceNow incident, or HTTP request for custom webhooks. Classic notifications are not changed or deleted. Workflows are created active, so matching problems notify through both the classic notification and the workflow until the classic one is disabled.

**When it is offered:** always (default action), as long as the notifications loaded. The candidate list can be empty (see below).

The form's introduction text: *Creates one simple workflow per selected notification, named after it, with a Davis problem trigger (all categories, after root cause analysis) filtered on the notification's alerting profile, and one task: ... The trigger filter is the profile's rules translated to DQL on problem fields (severity, delay, tags, event filters); profiles that cannot be translated (management zone, regular expression) use the deprecated alerting profile label. Only enabled notifications are converted. Classic notifications are not changed or deleted.*

#### Form fields

| Field | Options | Effect |
| --- | --- | --- |
| **Classic notifications** | *Not migrated* (default), *All* | Candidates: notifications without a same-name workflow, or all. Changing it clears the selection and the Validate results. Candidates include disabled and manual notifications (they are skipped by Validate with a reason). |
| **Notification type** | *Any*, then each type present | Exact type filter; clears the selection and the Validate results. |
| **Name contains** | text, placeholder *e.g. slack* | Case-insensitive substring filter on the name. Does not clear the selection, but only selected notifications that are still in the filtered list are validated. |
| **Trigger filter** | *Alerting profile rules as DQL* (default), *Alerting profile label (deprecated)* | Source of the trigger's custom filter. *Rules*: the translated profile, falling back to the label per notification when it cannot be translated. *Label*: `matchesValue(labels.alerting_profile, "<name>")`, the migration workflow's behaviour. Clears the Validate results. |
| **Delay timing** (only with *rules*) | *As configured (never misses a classic notification)* (default), *One step later (closer to classic timing)* | Delay to duration step mapping (see [Severity rules](#severity-rules)). Clears the Validate results. Hint: *Delays become duration steps (5, 10, 15, 30 min, 1, 2, 4, 24 h, 7 d) counted from the problem start; classic counted from a few minutes later. As configured, problems that close just after the delay are notified too. One step later (15 min becomes 30 min) is closer to classic but misses some problems it notified. Validate shows the difference for each profile.* |

**Selection:** buttons *Auto-convertible (<n>)* (selects the candidates that are `convertible`), *All (<n>)*, *Clear*, then one checkbox per candidate (scrollable list, 240 px high) showing the name and `<type> · <conversion or "manual upgrade">`, plus ` · disabled`, ` · migrated` (workflow created by the migration) or ` · workflow exists, not created by the migration`. Any selection change clears the Validate results. When there are no candidates: *Every classic problem notification already has a workflow with the same name.* (default filters) or *No classic problem notifications match.*

#### Validate

**Validate (<n>)** (disabled while busy or with nothing selected; shows *Validating…* while running). Hint: *Validate translates each alerting profile, then runs the translated rules and the alerting profile label side by side over the last 7 days of problem updates (4 queries at a time), so you see which problems each would have notified. Nothing is written.*

Steps (`validate`, [ProblemNotificationsTab.tsx](../ui/app/tabs/ProblemNotificationsTab.tsx#L450)):

1. Clears earlier results.
2. Runs [Q2](#q2-event-names-per-classic-event-type) for the predefined event types of the selected profiles (skipped if there are none).
3. Builds a plan per selected notification ([Planning a workflow](#planning-a-workflow)).
4. Runs [Q3](#q3-profile-rules-vs-label-validate) for every plan, 4 at a time.
5. Shows one result line per selected notification.

If step 2 or an unexpected error fails, the error is shown in red and no results appear. A failing Q3 only affects its own line.

#### Validate results

Each line has a coloured left border and the title `<name> — create` or `<name> — skipped`.

- **Skipped:** the reason from [Planning a workflow](#planning-a-workflow).
- **Create:** `<action> · alerting profile <name> · trigger filter: profile rules as DQL | alerting profile label`, then the Q3 message, the *only label* / *only rules* lines with examples, *Consider deleting the classic notification instead of migrating it.* when the trigger matched 0 problems, a box `Custom filter: <filter>` (or `Custom filter: none (every problem)`), the profile notes (Gen 2 notes first with an orange **Gen 2** badge; other approximate notes with a grey **≈** badge), the task notes, QueryActions for Q3 (*Profile rules vs label: <name>*), and a collapsible **Workflow request** with a Copy button showing `// POST /platform/automation/v1/workflows` followed by the JSON body. The request is sent through the `workflows` function (A8), not directly from the browser.

| Colour | Rule |
| --- | --- |
| grey `#8D8D8D` | skipped, not manual (disabled, already migrated, same-name workflow, duplicate name) |
| orange `#E87A00` | skipped and manual; or create with: 0 matched problems, or (trigger uses the rules and some problems carried the label but do not match the rules), or any Gen 2 profile note |
| red `#C21930` | create, but Q3 failed (never created) |
| green `#0D9C29` | create, Q3 succeeded, otherwise |

Below the lines: checkbox **Skip notifications whose trigger matched no problem in the last 7 days** (off by default). The workflows to create (`toRun`) are the plans whose Q3 succeeded, minus those with 0 matched problems when this box is ticked. If none remain: *Nothing to create: every selected notification was skipped.*

#### The workflow body

Common to every workflow (`planMigration`, [problemNotifications.ts](../ui/app/problemNotifications.ts#L450); the same body as the migration workflow's `create_workflows` task, except for the custom filter):

| Field | Value |
| --- | --- |
| `type` | `"SIMPLE"` |
| `title` | the notification's display name |
| `description` | `MIGRATION_DESCRIPTION` (*Auto Created Simple Workflow from Classic Problem Notification and corresponding Alerting Profile (via migration workflow)*) |
| `tasks` | one task named `problem_notification`, `position {x: 0, y: 1}`, no predecessors |
| `trigger.eventTrigger.isActive` | `true` (active on creation) |
| `trigger.eventTrigger.filterQuery` | the full trigger filter (Q4) |
| `trigger.eventTrigger.uniqueExpression` | `{{ event()["event.id"] }}-{{ "open" if event()["event.status"] == "ACTIVE" else "resolved" }}-{{ event()["dt.davis.last_reopen_timestamp"] }}`: one run per problem and open / reopen, not one per problem update |
| `triggerConfiguration.type` | `"davis-problem"` |
| `triggerConfiguration.value` | `categories` all seven `true` (availability, custom, error, monitoringUnavailable, slowdown, resource, info), `entityTags {}`, `customFilter` (Q4), `analysisReady true` (wait for root cause analysis), `onProblemClose false` (open problems only), `entityTagsMatch "all"` |
| other | `input {}`, `result null`, `version 1`, `throttle {isLimitHit: false, limitEvents: []}`, `isPrivate false`, `ownerType "USER"`, `isDeployed true`, `triggerType "Event"`, `lastExecution null`, `schemaVersion 3`, `workflowLimit {isActive: false}`, `hourlyExecutionLimit 1000`, `unacknowledgedSkippedScheduleAt null` |

**Placeholders.** Classic texts with placeholders (any text containing both `{` and `}`) are replaced, as in the migration workflow, by one generic text:

- message / subject / payload: `{{ event()["event.status"] }} Problem {{ event()["display_id"] }}: {{ event()["affected_entity_ids"] }}`
- email body: `{{ event()["event.description"] }}`

Task note: *Classic placeholders were replaced by one generic text (status, problem ID, affected entities); edit the task to restore the original content.* The manual action lists the placeholder-to-Jinja mapping to restore them.

**Task per type:**

| Type | Action | Input built from the classic settings | Notes added |
| --- | --- | --- | --- |
| Email | `dynatrace.email:send-email`, description *Send email* | `to` = `recipients`, `cc` = `ccRecipients`, `bcc` = `bccRecipients`, `subject` = subject or generic message, `content` = body or generic body | placeholder note; *Classic also notified when the problem closed; the workflow triggers on open problems only.* if `notifyClosedProblems` |
| Slack | `dynatrace.slack:slack-send-message`, description *Send a message to a Slack workspace* | `channel` = `channel`, `message` = message or generic message, `connection ""`, `channelType "expression"`, `executionDate "{{ execution().started_at }}"`, `appendToThread false`, `replyBroadcast false`, `selectedRequestType 0`, `attachmentToggleValue "none"`, `reaction []` | always: *Select a Slack connection in the task: the classic Slack webhook URL is a secret and is not carried over. Until then every run of this workflow fails.*; placeholder note |
| ServiceNow incident | `dynatrace.servicenow:snow-create-incident`, description *Create an incident in ServiceNow* | `description` = classic `message` only if it has no `{` and no `}` at all, otherwise `Event details: {{ event() }}`; fixed `impact "3"`, `urgency "3"`, `category "inquiry"`, `subCategory "internal application"`, `caller ""`, `connectionId ""`, `correlationId 'DT_{{ event()["event.id"] }}'`, `shortDescription '{{ event()["event.category"] }} {{ event()["event.name"] }}'` | always: *Select a ServiceNow connection for <instanceName or url> in the task (classic credentials are secrets and are not carried over). Until then every run of this workflow fails.*; *Classic also sent events to ServiceNow; the workflow creates incidents only.* if `sendEvents` |
| Custom webhook | `dynatrace.automations:http-function`, description *Issue an HTTP request to any API.* | `url` = `url`, `method "POST"`, `headers` = name to value map of the non-secret headers, `payload` = payload or generic message, `failOnResponseCodes "400-599"` | placeholder note (plus *The classic payload was JSON; the generic text is not, so the receiver will likely reject it.* when the payload starts with `{` or `[`); *Secret header(s) not copied ...: <names>. Add it/them in the task.*; *<names> is stored in plain text in classic and is copied as is; anyone who can read the workflow sees it.* for non-secret headers whose name contains auth, token, key, secret or password; *Classic used OAuth 2.0 client credentials; the HTTP request task does not get them.* if `useOAuth2`; *<host> must be allowed for outbound requests from Workflows.*; closed-problem note |

#### Workflow body examples

Generated with `planMigrations(..., "rules", names, "configured")` from placeholder notifications. Only the classic settings, the alerting profile and Q2's names change these bodies.

##### Email

Classic `emailNotification`:

```json
{
  "recipients": [
    "oncall-payments@example.com"
  ],
  "ccRecipients": [
    "payments-leads@example.com"
  ],
  "bccRecipients": [],
  "subject": "{State} Problem {ProblemID}: {ImpactedEntity}",
  "body": "{ProblemDetailsHTML}",
  "notifyClosedProblems": true
}
```

Alerting profile: *Payments production* ([Full translation example](#full-translation-example)). Trigger source used: `rules`. Task notes:

```text
- Classic placeholders were replaced by one generic text (status, problem ID, affected entities); edit the task to restore the original content.
- Classic also notified when the problem closed; the workflow triggers on open problems only.
```

Workflow body (the **Workflow request** shown by Validate, without the `// POST /platform/automation/v1/workflows` line):

```json
{
  "type": "SIMPLE",
  "input": {},
  "tasks": {
    "problem_notification": {
      "name": "problem_notification",
      "input": {
        "cc": [
          "payments-leads@example.com"
        ],
        "to": [
          "oncall-payments@example.com"
        ],
        "bcc": [],
        "content": "{{ event()[\"event.description\"] }}",
        "subject": "{{ event()[\"event.status\"] }} Problem {{ event()[\"display_id\"] }}: {{ event()[\"affected_entity_ids\"] }}"
      },
      "action": "dynatrace.email:send-email",
      "position": {
        "x": 0,
        "y": 1
      },
      "description": "Send email",
      "predecessors": []
    }
  },
  "title": "Payments production - Email",
  "result": null,
  "trigger": {
    "eventTrigger": {
      "isActive": true,
      "filterQuery": "event.kind == \"DAVIS_PROBLEM\" AND event.status == \"ACTIVE\" AND matchesValue(event.status_transition, {\"CREATED\", \"UPDATED\", \"REOPENED\"}) AND dt.analysis.ready == true AND (matchesValue(event.category, {\"AVAILABILITY\", \"ERROR\", \"SLOWDOWN\", \"RESOURCE_CONTENTION\", \"CUSTOM_ALERT\", \"MONITORING_UNAVAILABLE\", \"INFO\"})) AND ((matchesValue(event.category, { \"AVAILABILITY\", \"ERROR\" }) OR (event.category == \"SLOWDOWN\" AND dt.duration_marker >= 15m AND matchesValue(entity_tags, \"env:production\") AND matchesValue(entity_tags, \"team-payments\")) OR (event.category == \"RESOURCE_CONTENTION\" AND dt.duration_marker >= 30m AND matchesValue(entity_tags, { \"env:production\", \"env:staging\" }))) AND (matchesPhrase(event.description, \"CPU saturation\") OR matchesValue(event.name, \"*payment*\") OR matchesValue(k8s.cluster.name, \"prod-eu-1\")) AND not (matchesValue(event.description, \"Maintenance*\")))",
      "uniqueExpression": "{{ event()[\"event.id\"] }}-{{ \"open\" if event()[\"event.status\"] == \"ACTIVE\" else \"resolved\" }}-{{ event()[\"dt.davis.last_reopen_timestamp\"] }}",
      "triggerConfiguration": {
        "type": "davis-problem",
        "value": {
          "categories": {
            "availability": true,
            "custom": true,
            "error": true,
            "monitoringUnavailable": true,
            "slowdown": true,
            "resource": true,
            "info": true
          },
          "entityTags": {},
          "customFilter": "(matchesValue(event.category, { \"AVAILABILITY\", \"ERROR\" }) OR (event.category == \"SLOWDOWN\" AND dt.duration_marker >= 15m AND matchesValue(entity_tags, \"env:production\") AND matchesValue(entity_tags, \"team-payments\")) OR (event.category == \"RESOURCE_CONTENTION\" AND dt.duration_marker >= 30m AND matchesValue(entity_tags, { \"env:production\", \"env:staging\" }))) AND (matchesPhrase(event.description, \"CPU saturation\") OR matchesValue(event.name, \"*payment*\") OR matchesValue(k8s.cluster.name, \"prod-eu-1\")) AND not (matchesValue(event.description, \"Maintenance*\"))",
          "analysisReady": true,
          "onProblemClose": false,
          "entityTagsMatch": "all"
        }
      }
    }
  },
  "version": 1,
  "throttle": {
    "isLimitHit": false,
    "limitEvents": []
  },
  "isPrivate": false,
  "ownerType": "USER",
  "isDeployed": true,
  "description": "Auto Created Simple Workflow from Classic Problem Notification and corresponding Alerting Profile (via migration workflow)",
  "triggerType": "Event",
  "lastExecution": null,
  "schemaVersion": 3,
  "workflowLimit": {
    "isActive": false
  },
  "hourlyExecutionLimit": 1000,
  "unacknowledgedSkippedScheduleAt": null
}
```

With **Trigger filter** *Alerting profile label (deprecated)*, the same notification gets `"customFilter": "matchesValue(labels.alerting_profile, \"Payments production\")"` (and the matching `filterQuery`), and its profile notes shrink to the Gen 2 notes plus the label note:

```text
- [Gen 2] Classic tags (env:production, team-payments) are matched on entity_tags, which is deprecated. Move the condition to primary tags (primary_tags.<name>) or other primary fields.
- [Gen 2] Classic tags (env:production, env:staging) are matched on entity_tags, which is deprecated. Move the condition to primary tags (primary_tags.<name>) or other primary fields.
- [Gen 2] Event filter on the classic event type OSI_HIGH_CPU is matched by its event name (CPU saturation) in the problem description.
- Filters on labels.alerting_profile, which the upgrade guide marks as deprecated.
```

##### Slack

Classic `slackNotification` (the webhook URL is a secret and not read):

```json
{
  "channel": "#alerts-production",
  "message": "{State} Problem {ProblemID}: {ProblemTitle} {ProblemURL}"
}
```

Alerting profile: *Default* (all six severities; 30-minute delay on PERFORMANCE and RESOURCE_CONTENTION). Trigger source used: `rules`. Profile notes:

```text
- Delays use dt.duration_marker (time since the problem started). Classic counted from when it opened the problem, a few minutes later, so problems that close just after the delay notify through the workflow but did not through classic.
```

Task notes:

```text
- Select a Slack connection in the task: the classic Slack webhook URL is a secret and is not carried over. Until then every run of this workflow fails.
- Classic placeholders were replaced by one generic text (status, problem ID, affected entities); edit the task to restore the original content.
```

```json
{
  "type": "SIMPLE",
  "input": {},
  "tasks": {
    "problem_notification": {
      "name": "problem_notification",
      "input": {
        "message": "{{ event()[\"event.status\"] }} Problem {{ event()[\"display_id\"] }}: {{ event()[\"affected_entity_ids\"] }}",
        "reaction": [],
        "connection": "",
        "channelType": "expression",
        "executionDate": "{{ execution().started_at }}",
        "appendToThread": false,
        "replyBroadcast": false,
        "selectedRequestType": 0,
        "attachmentToggleValue": "none",
        "channel": "#alerts-production"
      },
      "action": "dynatrace.slack:slack-send-message",
      "position": {
        "x": 0,
        "y": 1
      },
      "description": "Send a message to a Slack workspace",
      "predecessors": []
    }
  },
  "title": "Default - Slack",
  "result": null,
  "trigger": {
    "eventTrigger": {
      "isActive": true,
      "filterQuery": "event.kind == \"DAVIS_PROBLEM\" AND event.status == \"ACTIVE\" AND matchesValue(event.status_transition, {\"CREATED\", \"UPDATED\", \"REOPENED\"}) AND dt.analysis.ready == true AND (matchesValue(event.category, {\"AVAILABILITY\", \"ERROR\", \"SLOWDOWN\", \"RESOURCE_CONTENTION\", \"CUSTOM_ALERT\", \"MONITORING_UNAVAILABLE\", \"INFO\"})) AND ((matchesValue(event.category, { \"AVAILABILITY\", \"ERROR\", \"CUSTOM_ALERT\", \"MONITORING_UNAVAILABLE\" }) OR (matchesValue(event.category, { \"SLOWDOWN\", \"RESOURCE_CONTENTION\" }) AND dt.duration_marker >= 30m)))",
      "uniqueExpression": "{{ event()[\"event.id\"] }}-{{ \"open\" if event()[\"event.status\"] == \"ACTIVE\" else \"resolved\" }}-{{ event()[\"dt.davis.last_reopen_timestamp\"] }}",
      "triggerConfiguration": {
        "type": "davis-problem",
        "value": {
          "categories": {
            "availability": true,
            "custom": true,
            "error": true,
            "monitoringUnavailable": true,
            "slowdown": true,
            "resource": true,
            "info": true
          },
          "entityTags": {},
          "customFilter": "(matchesValue(event.category, { \"AVAILABILITY\", \"ERROR\", \"CUSTOM_ALERT\", \"MONITORING_UNAVAILABLE\" }) OR (matchesValue(event.category, { \"SLOWDOWN\", \"RESOURCE_CONTENTION\" }) AND dt.duration_marker >= 30m))",
          "analysisReady": true,
          "onProblemClose": false,
          "entityTagsMatch": "all"
        }
      }
    }
  },
  "version": 1,
  "throttle": {
    "isLimitHit": false,
    "limitEvents": []
  },
  "isPrivate": false,
  "ownerType": "USER",
  "isDeployed": true,
  "description": "Auto Created Simple Workflow from Classic Problem Notification and corresponding Alerting Profile (via migration workflow)",
  "triggerType": "Event",
  "lastExecution": null,
  "schemaVersion": 3,
  "workflowLimit": {
    "isActive": false
  },
  "hourlyExecutionLimit": 1000,
  "unacknowledgedSkippedScheduleAt": null
}
```

##### ServiceNow

Classic `serviceNowNotification` (credentials are secrets and not read):

```json
{
  "instanceName": "example-instance",
  "message": "{ProblemDetailsText}",
  "sendIncidents": true,
  "sendEvents": true
}
```

Alerting profile: *Team Checkout* with a management zone, so the rules cannot be translated and the trigger falls back to the label (source used: `label`). Profile notes:

```text
- [Gen 2] Management zone filter (Gen 2): problems carry no management zone. Recreate the condition on primary fields (for example dt.security_context or primary_tags.*).
- Rules not translated (Filters on a management zone, which problems do not carry.); the trigger uses the alerting profile label instead.
- Filters on labels.alerting_profile, which the upgrade guide marks as deprecated.
```

Task notes:

```text
- Select a ServiceNow connection for example-instance in the task (classic credentials are secrets and are not carried over). Until then every run of this workflow fails.
- Classic also sent events to ServiceNow; the workflow creates incidents only.
```

```json
{
  "type": "SIMPLE",
  "input": {},
  "tasks": {
    "problem_notification": {
      "name": "problem_notification",
      "input": {
        "caller": "",
        "impact": "3",
        "urgency": "3",
        "category": "inquiry",
        "description": "Event details: {{ event() }}",
        "subCategory": "internal application",
        "connectionId": "",
        "correlationId": "DT_{{ event()[\"event.id\"] }}",
        "shortDescription": "{{ event()[\"event.category\"] }} {{ event()[\"event.name\"] }}"
      },
      "action": "dynatrace.servicenow:snow-create-incident",
      "position": {
        "x": 0,
        "y": 1
      },
      "description": "Create an incident in ServiceNow",
      "predecessors": []
    }
  },
  "title": "Team Checkout - ServiceNow",
  "result": null,
  "trigger": {
    "eventTrigger": {
      "isActive": true,
      "filterQuery": "event.kind == \"DAVIS_PROBLEM\" AND event.status == \"ACTIVE\" AND matchesValue(event.status_transition, {\"CREATED\", \"UPDATED\", \"REOPENED\"}) AND dt.analysis.ready == true AND (matchesValue(event.category, {\"AVAILABILITY\", \"ERROR\", \"SLOWDOWN\", \"RESOURCE_CONTENTION\", \"CUSTOM_ALERT\", \"MONITORING_UNAVAILABLE\", \"INFO\"})) AND (matchesValue(labels.alerting_profile, \"Team Checkout\"))",
      "uniqueExpression": "{{ event()[\"event.id\"] }}-{{ \"open\" if event()[\"event.status\"] == \"ACTIVE\" else \"resolved\" }}-{{ event()[\"dt.davis.last_reopen_timestamp\"] }}",
      "triggerConfiguration": {
        "type": "davis-problem",
        "value": {
          "categories": {
            "availability": true,
            "custom": true,
            "error": true,
            "monitoringUnavailable": true,
            "slowdown": true,
            "resource": true,
            "info": true
          },
          "entityTags": {},
          "customFilter": "matchesValue(labels.alerting_profile, \"Team Checkout\")",
          "analysisReady": true,
          "onProblemClose": false,
          "entityTagsMatch": "all"
        }
      }
    }
  },
  "version": 1,
  "throttle": {
    "isLimitHit": false,
    "limitEvents": []
  },
  "isPrivate": false,
  "ownerType": "USER",
  "isDeployed": true,
  "description": "Auto Created Simple Workflow from Classic Problem Notification and corresponding Alerting Profile (via migration workflow)",
  "triggerType": "Event",
  "lastExecution": null,
  "schemaVersion": 3,
  "workflowLimit": {
    "isActive": false
  },
  "hourlyExecutionLimit": 1000,
  "unacknowledgedSkippedScheduleAt": null
}
```

##### Custom webhook

Classic `webHookNotification` (`Authorization` is a secret header; its value is not returned):

```json
{
  "url": "https://hooks.example.com/dynatrace/problems",
  "urlContainsSecret": false,
  "headers": [
    {
      "name": "Content-Type",
      "value": "application/json",
      "secret": false
    },
    {
      "name": "Authorization",
      "secret": true
    },
    {
      "name": "X-Api-Key",
      "value": "<plain-text-key>",
      "secret": false
    }
  ],
  "payload": "{ \"state\": \"{State}\", \"problemId\": \"{ProblemID}\", \"title\": \"{ProblemTitle}\" }",
  "useOAuth2": false,
  "notifyClosedProblems": true
}
```

Alerting profile: *Web shop* (AVAILABILITY and ERRORS, 5-minute delay, any of the tag `app:webshop`). Trigger source used: `rules`. Profile notes:

```text
- [Gen 2] Classic tags (app:webshop) are matched on entity_tags, which is deprecated. Move the condition to primary tags (primary_tags.<name>) or other primary fields.
- Delays use dt.duration_marker (time since the problem started). Classic counted from when it opened the problem, a few minutes later, so problems that close just after the delay notify through the workflow but did not through classic.
```

Task notes:

```text
- Classic placeholders were replaced by one generic text (status, problem ID, affected entities); edit the task to restore the original content. The classic payload was JSON; the generic text is not, so the receiver will likely reject it.
- Secret header not copied (the Settings API does not return secrets): Authorization. Add it in the task.
- X-Api-Key is stored in plain text in classic and is copied as is; anyone who can read the workflow sees it.
- hooks.example.com must be allowed for outbound requests from Workflows.
- Classic also notified when the problem closed; the workflow triggers on open problems only.
```

```json
{
  "type": "SIMPLE",
  "input": {},
  "tasks": {
    "problem_notification": {
      "name": "problem_notification",
      "input": {
        "url": "https://hooks.example.com/dynatrace/problems",
        "method": "POST",
        "headers": {
          "Content-Type": "application/json",
          "X-Api-Key": "<plain-text-key>"
        },
        "payload": "{{ event()[\"event.status\"] }} Problem {{ event()[\"display_id\"] }}: {{ event()[\"affected_entity_ids\"] }}",
        "failOnResponseCodes": "400-599"
      },
      "action": "dynatrace.automations:http-function",
      "position": {
        "x": 0,
        "y": 1
      },
      "description": "Issue an HTTP request to any API.",
      "predecessors": []
    }
  },
  "title": "Web shop - Webhook",
  "result": null,
  "trigger": {
    "eventTrigger": {
      "isActive": true,
      "filterQuery": "event.kind == \"DAVIS_PROBLEM\" AND event.status == \"ACTIVE\" AND matchesValue(event.status_transition, {\"CREATED\", \"UPDATED\", \"REOPENED\"}) AND dt.analysis.ready == true AND (matchesValue(event.category, {\"AVAILABILITY\", \"ERROR\", \"SLOWDOWN\", \"RESOURCE_CONTENTION\", \"CUSTOM_ALERT\", \"MONITORING_UNAVAILABLE\", \"INFO\"})) AND ((matchesValue(event.category, { \"AVAILABILITY\", \"ERROR\" }) AND dt.duration_marker >= 5m AND matchesValue(entity_tags, \"app:webshop\")))",
      "uniqueExpression": "{{ event()[\"event.id\"] }}-{{ \"open\" if event()[\"event.status\"] == \"ACTIVE\" else \"resolved\" }}-{{ event()[\"dt.davis.last_reopen_timestamp\"] }}",
      "triggerConfiguration": {
        "type": "davis-problem",
        "value": {
          "categories": {
            "availability": true,
            "custom": true,
            "error": true,
            "monitoringUnavailable": true,
            "slowdown": true,
            "resource": true,
            "info": true
          },
          "entityTags": {},
          "customFilter": "(matchesValue(event.category, { \"AVAILABILITY\", \"ERROR\" }) AND dt.duration_marker >= 5m AND matchesValue(entity_tags, \"app:webshop\"))",
          "analysisReady": true,
          "onProblemClose": false,
          "entityTagsMatch": "all"
        }
      }
    }
  },
  "version": 1,
  "throttle": {
    "isLimitHit": false,
    "limitEvents": []
  },
  "isPrivate": false,
  "ownerType": "USER",
  "isDeployed": true,
  "description": "Auto Created Simple Workflow from Classic Problem Notification and corresponding Alerting Profile (via migration workflow)",
  "triggerType": "Event",
  "lastExecution": null,
  "schemaVersion": 3,
  "workflowLimit": {
    "isActive": false
  },
  "hourlyExecutionLimit": 1000,
  "unacknowledgedSkippedScheduleAt": null
}
```

#### Platform token card and confirmation

When at least one workflow can be created, the form shows:

1. **Platform token for creating workflows** card (`WorkflowTokenCard`, [ProblemNotificationsTab.tsx](../ui/app/tabs/ProblemNotificationsTab.tsx#L317)) with the A5 status: *Checking the platform token…*, the green status line with a **Change token** / **Cancel** button, or a message plus the form. The form (always open when the token is missing or failing) has two steps (create the token in *My platform tokens* with `automation:workflows:read` and `automation:workflows:write`, for a service user; save it here), a **Platform token** password field (placeholder `dt0s16.ABCD1234.…`), the checkbox *Only I can use it (owner only). Off: every user of this app can create these workflows, owned by the token's user.* (ticked by default), **Save to the credential vault** (disabled while saving or empty), and *Setup documentation* links. See A6, A7.
2. Confirmation checkbox: *Create <n> workflow(s) (1 API call each, with the platform token). They are active right away, so matching problems notify through the classic notification and the workflow until you disable the classic one.* Toggling the skip checkbox clears it.
3. **Create workflows**: enabled only when the confirmation is ticked, nothing is running and the token status is `ok`. Shows *<k> of <n> done…* while running.

#### After success or failure

- One result line per workflow (green *Workflow created.* with *Open workflow ↗*, or red *Creation failed: <message>*). Failures do not stop the remaining creations.
- The confirmation is cleared and the tab reloads the notifications and workflows (A1-A3): tiles, gauge, donut and the search table update; Q1 does not re-run. The Validate lines stay on screen.
- Then, in each created workflow: select the Slack or ServiceNow connection (until then every run fails), add secret webhook headers, allow webhook hosts for outbound requests from Workflows, and restore texts that were replaced by the generic message. Run the workflow next to the classic notification, compare, then disable the classic notification.

#### Fixes against the migration workflow

From the header of [problemNotifications.ts](../ui/app/problemNotifications.ts#L19) (all validated on the demo tenant according to the comment):

- The profile label filter uses `matchesValue` (exact, case-insensitive). The migration workflow's `matchesPhrase` on *Default* also matched *ServiceNow Default Problem Notification Profile* (4,470 problems in 7 days instead of 3,402).
- Jinja placeholders use `event()["field"]`; `event(status)` passes an undefined variable, not an attribute name.
- Webhook headers are sent as a name to value map (classic stores a list of `{ name, value, secret }`).
- Webhooks whose URL is a secret are manual (the Settings API does not return secrets).
- A same-name workflow without the migration description is left alone instead of duplicated.
- By default the trigger filters on the translated profile rules instead of the deprecated label.

#### Documentation for this fix

- [Upgrade from Classic problem notification to simple workflows](https://docs.dynatrace.com/docs/platform/upgrade/keep-problems-and-alerting-working/upgrade-guide-alert-notification)
- [Jinja expressions for Workflows](https://docs.dynatrace.com/docs/analyze-explore-automate/workflows/reference)

### Upgrade a problem notification manually (simple workflow)

`manualMigrationAction` ([problemNotifications.ts](../ui/app/problemNotifications.ts#L643)). Offered always; it covers the types without automatic conversion (Jira, PagerDuty, OpsGenie, VictorOps, xMatters, Trello, Ansible Tower, ServiceNow events only, webhooks with a secret URL, notifications without a profile) and anyone who prefers to build the workflow by hand. Nothing is written by the app.

A **Variant** select switches the code box (with a Copy button) between two tables:

*Placeholders to Jinja*

```text
{State}                       -> {{ event()["event.status"] }}
{ProblemID}                   -> {{ event()["display_id"] }}
{PID}                         -> {{ event()["event.id"] }}
{ProblemTitle}                -> {{ event()["event.name"] }}
{ProblemSeverity}             -> {{ event()["event.category"] }}
{ProblemImpact}               -> {{ event()["dt.davis.impact_level"] }}
{ImpactedEntity/ies}          -> {{ event()["smartscape.affected_entities"] }}
{ProblemDetailsText/Markdown} -> {{ event()["event.description"] }}
{ProblemDetailsJSON(v2)}      -> {{ event() | to_json }}
{ProblemURL}                  -> {{ problem_link() }}
{Tags}                        -> primary_tags.* fields
{ProblemDetailsHTML}          -> not supported
```

*Integration to workflow action*

```text
Email            -> Email (or Microsoft 365) connector
Slack            -> Slack connector
ServiceNow       -> ServiceNow connector
Jira             -> Jira connector
PagerDuty        -> PagerDuty connector
Microsoft Teams  -> Microsoft Teams connector
Ansible Tower    -> Red Hat Ansible connector
OpsGenie         -> Jira Service Management connector or HTTP Request
Custom webhook, xMatters, VictorOps, Trello -> HTTP Request
```

Steps:

1. In Workflows, create a simple workflow with a Davis problem trigger and select the problem categories the alerting profile covered.
2. Set the problem state: active for open-only notifications, active or closed if the classic notification also sent closed problems.
3. Under Advanced options, turn on Wait for root cause analysis.
4. Rebuild the alerting profile in the Additional custom filter on problem fields (tags, affected entities, event.name). It is ANDed with the categories and limited to 1,000 characters.
5. Add the action for the integration (see the variants) and translate the classic placeholders to Jinja.
6. Run the workflow next to the classic notification, compare what both send, then disable the classic notification.

Notes (collapsed):

- `labels.alerting_profile` is deprecated: workflows that still filter on it (profiles with a management zone, a regex or an unknown event type) should move to problem fields.
- To skip problems during maintenance windows, add `maintenance.is_under_maintenance == false` to the custom filter.
- Run the workflow as a service user, so it keeps working when the person who created it leaves.
- Delete disabled or stale classic notifications instead of upgrading them; one trigger can cover the filters of several alerting profiles.

Documentation for this fix: the same two links as the API action.

## AI Assist on this page

`analyzeProblemNotifications(rows)` ([analyses.ts](../ui/app/analyses.ts#L386)) is a rule-based function that runs locally in the browser on the rows already on screen; nothing is sent anywhere. It is computed when the AI Assist panel is opened and again whenever the rows or problem counts change. Each row passes: name, type label, enabled, migrated (same-name workflow exists), managed, convertible, problems (Q1 count, `null` while loading or on error), Gen 2 list, translatable.

**No notifications:** summary *No classic problem notifications are defined in this environment, so there is nothing to migrate to workflows.*; insight (good) *Problem alerting can be built on simple workflows with a Davis problem trigger from the start.*; recommendation (low) *Filter the workflow trigger on problem fields (tags, affected entities) rather than on alerting profiles.*

**Otherwise** (`enabled`, `migrated` = enabled with a workflow, `missing` = enabled without, `auto` = missing and convertible, `manual` = missing and not convertible, `quiet` = missing with exactly 0 problems, `p = round(migrated / enabled * 100)`, 100 when nothing is enabled):

- **Summary:** *<migrated> of <enabled> enabled classic problem notifications (<p>%) have a workflow with the same name; <managed> workflows were created by the migration. <disabled> notifications are disabled.*

| Insight | Shown when | Severity |
| --- | --- | --- |
| *<p>% of enabled problem notifications are migrated to simple workflows.* | always | good if p >= 90, warning if p >= 50, critical below |
| *<auto> of the <missing> remaining can be converted automatically (email, Slack, ServiceNow incident, webhook): <first 3 names, …>.* | auto > 0 | info |
| *<manual> need a manual upgrade (<type labels>): <first 3 names>.* | manual > 0 | warning |
| *<quiet> remaining notifications' alerting profiles matched no problem in the last 7 days: <first 3 names>.* | quiet > 0 (needs Q1) | info |
| *<n> enabled notifications use alerting profiles with Gen 2 concepts (<distinct concepts>): <first 3 names>.* | an enabled row has a Gen 2 concept | warning |
| *<n> profiles cannot be translated to DQL (management zone, regular expression or missing profile), so their workflows filter on the deprecated labels.alerting_profile: <first 3 names>.* | an enabled row is not translatable (this count includes enabled notifications without a profile, unlike the *label only* count on the tile) | info |

| Recommendation | Shown when | Impact |
| --- | --- | --- |
| *Use Convert to simple workflows: Validate counts the problems each trigger would have fired for before anything is created.* | auto > 0 | high |
| *Open each Slack and ServiceNow workflow and select a connection; until then their runs fail.* | managed > 0 or auto > 0 | high |
| *Replace classic tags, management zones and classic event types in the alerting profiles with primary tags and primary fields, then translate again: entity_tags is deprecated.* | Gen 2 rows exist | medium |
| *Upgrade the rest manually with the matching connector (Jira, PagerDuty, Microsoft Teams, Red Hat Ansible) or an HTTP Request.* | manual > 0 | medium |
| *Delete disabled and stale notifications instead of migrating them.* | disabled > 0 or quiet > 0 | medium |
| *Run workflows and classic notifications side by side, compare what both send, then disable the classic ones.* | always | low |

## Limitations and edge cases

- **Matching is by exact title.** A workflow counts as the notification's migration only if its title equals the notification's display name character for character. Renaming either breaks the match; an unrelated workflow that happens to have the same name counts as migrated (and is never overwritten).
- **Visibility.** Workflows the signed-in user cannot see are not listed, so the gauge can be lower for that user than for an admin.
- **Problem counts are per profile name**, from `labels.alerting_profile`, which the upgrade guide marks as deprecated. They show what the classic profile matched, not what a notification sent (classic notification-level settings are not considered).
- **Open problems only.** The trigger uses `onProblemClose: false`; classic notifications with *notify closed problems* also sent closed problems, which the workflow does not (task note).
- **Delays.** Duration steps are fixed (5, 10, 15, 30 min, 1, 2, 4, 24 h, 7 d) and count from the problem start, while classic counted from a few minutes later; Validate shows the difference. A delay above 1440 minutes becomes `>= 7d`, and a delay above 7 days is capped at 7 days (the note still says "rounded up").
- **Approximate filters.** Predefined event types are matched by event name phrases in the problem description; title and description filters apply to the problem title and summary, not to each event; property filters only work if problems carry a field with that key; case-sensitive matching is lost (except *equals*); `*` in a value acts as a wildcard.
- **Fallback to the label** for management zones, regular expressions, event types without events in the last 30 days, and translations longer than the 1,000-character trigger limit (680 characters for the custom filter).
- **Unknown severity levels** are dropped with a note. A profile whose only rules are unknown severities translates to an empty filter, which matches every problem.
- **Generic text.** Any classic subject, body, message or payload that contains both `{` and `}` is replaced by the generic text, including a static JSON webhook payload without placeholders. ServiceNow descriptions with any brace use `Event details: {{ event() }}`.
- **Secrets** (Slack webhook URL, ServiceNow credentials, secret headers, secret webhook URLs, OAuth 2.0 credentials) are never read. Slack and ServiceNow workflows fail until a connection is selected.
- **Plain-text credentials.** Non-secret webhook headers are copied as is, so an API key stored in plain text in classic becomes readable to anyone who can read the workflow (task note).
- **Duplicate names.** When several selected notifications share a name, only the first is migrated in that run.
- **Validate results are not re-checked before creating again.** After **Create workflows**, the Validate lines stay on screen. Ticking the confirmation again and selecting **Create workflows** a second time would send the same bodies again and create a second workflow with the same title, because the plans are not compared with the refreshed workflow list. Run **Validate** again before creating more.
- **Name contains does not reset Validate.** Changing the name filter after Validate keeps the old result lines (and the workflows to create) even if those notifications are no longer in the filtered list.
- **Problem counts are loaded once.** Q1 does not re-run after creation or token changes; reopen the tab to refresh it.
- **Gauge with nothing enabled** shows 0 %, while AI Assist reports 100 % in that case.
- The *Profile rules* column assumes predefined event types resolve; only Validate looks up their names.

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| *Could not read problem notifications or workflows* | Missing `settings:objects:read` or `automation:workflows:read` in the running app, or the user lacks permission to read these settings or workflows | Check `app.scopes`; after changing scopes restart `npx dt-app dev` or redeploy and sign in again; check the user's policies. |
| *Problem counts unavailable: ...* and `…` in the Problems column | Q1 failed: no `storage:events:read` / bucket access for the user, or a query error | Grant Grail read on events; open Q1 in a notebook (Show DQL) to see the error. |
| Notification shows *Not migrated* although a workflow exists | Title differs (case, spaces) or the user cannot see the workflow | Rename the workflow to the exact notification name, or check the workflow's sharing. |
| *Alerting profile not found* | The notification points to an alerting profile object that no longer exists | Fix the notification in classic Settings (link in the table), then reload. |
| Profile shows `DQL (approximate)` in the table but Validate uses the label | A predefined event type had no events in the last 30 days (Q2 found no name) | Replace the event type with a title or property filter, or accept the label filter. |
| *Rules not translated (too long) ...* | The translated custom filter exceeds 680 characters | Simplify the alerting profile or split it; or use the label. |
| Validate line red: *Query failed: ...* | Q3 failed (field not known in the trigger syntax, permission, timeout) | Open the query (Show DQL / Open in Notebook) to see the error; the notification is not created until Validate passes. |
| Validate stops with a red error under the list | Q2 (event names) failed | Check Grail access to `dt.davis.events`; retry. |
| *The workflows app function is not available in this running app (HTTP 404)* | The running app was started before `api/workflows.function.ts` existed or was not deployed with it | Restart `npx dt-app dev` or deploy, then retry. |
| Token card: *Apps not provided by Dynatrace cannot hold ... Store one below.* | No credential `architect-assistant-workflows` visible to you (missing, or owner-only and owned by someone else) | Store a token, or ask the owner to untick *Only I can use it*. |
| *The stored platform token does not work: The platform token was rejected (...)* | 401: token invalid or revoked | Create a new platform token and select **Change token**. |
| *... The platform token is expired, lacks the automation:workflows scopes, or its user lacks the permission (...)* | 403: expired token, missing scopes, or the token's user may not read or create workflows | Create a token with `automation:workflows:read` and `automation:workflows:write` for a user with workflow permissions. |
| *That does not look like a platform token (dt0s16.XXXX.YYYY).* | Pasted an API token (`dt0c01...`) or a truncated value | Paste the full platform token. |
| Saving the token fails with a permission error | Missing `environment-api:credentials:write` in the running app, or no credential vault permission | Check scopes and the user's credential vault permission. |
| *Create workflows* stays disabled | Confirmation not ticked, token status not `ok`, or a run is in progress | Tick the confirmation; fix the token. |
| *Creation failed: Only workflows with the migration description are created.* (or another rejection) | The body was changed or does not match the function's checks | Use the bodies Validate builds; other workflows must be created in Workflows directly. |
| *Creation failed: Automation API returned HTTP 400: ...* | The Automation API rejected the body (constraint violations are listed) | Adjust the classic notification (for example the name) or create the workflow manually from the copied request. |
| Created Slack or ServiceNow workflow fails on every run | No connection selected in the task | Open the workflow and select the connection. |
| Created webhook workflow fails | Host not allowed for outbound requests from Workflows, missing secret header, or the receiver rejects the generic text | Allow the host, add the header, restore the payload with Jinja. |
| Both classic and workflow notify | Expected: workflows are active right away | Compare, then disable the classic notification. |

## Related pages

- [Index of all pages](README.md)
- [SLOs](slos.md) and [Segments](segments.md): the other Migration Assistance tabs, with the same matching-by-name and Validate-then-create pattern.

## Source files

| File | Role on this page |
| --- | --- |
| [ui/app/tabs/ProblemNotificationsTab.tsx](../ui/app/tabs/ProblemNotificationsTab.tsx) | Tab layout: data hooks, tiles, gauge, donut, search table, Remediation actions, Convert form, token card, AI Assist wiring. |
| [ui/app/problemNotifications.ts](../ui/app/problemNotifications.ts) | Settings and workflow reads, matching, conversion, task builders, workflow body, plan, Validate (Q2, Q3), token storage, create calls, manual action. |
| [ui/app/alertingProfiles.ts](../ui/app/alertingProfiles.ts) | Alerting profile model, translation to DQL, event-name query (Q2), profile status for the table. |
| [api/workflows.function.ts](../api/workflows.function.ts) | App function: reads the platform token from the credential vault, checks it, validates the body shape and creates workflows. |
| [ui/app/queries.ts](../ui/app/queries.ts#L759) | `PROBLEM_DAYS`, `profileProblemsQuery` (Q1), `dqlString`. |
| [ui/app/analyses.ts](../ui/app/analyses.ts#L384) | `analyzeProblemNotifications` (AI Assist rules). |
| [ui/app/components.tsx](../ui/app/components.tsx) | `PctGauge`, `ScoreTile`, `QueryActions`, `ShowEntitiesButton`, `pct`, `num`. |
| [ui/app/tabs/ModePie.tsx](../ui/app/tabs/ModePie.tsx) | `Donut` (custom SVG donut). |
| [ui/app/RemediationPanel.tsx](../ui/app/RemediationPanel.tsx) | `Field`, `Links`, `Request`, `ManualActionView` used by the remediation section. |
| [ui/app/tabs/IamShared.tsx](../ui/app/tabs/IamShared.tsx) | `DocLink`, `DocLinks` (token card links). |
| [ui/app/useDql.ts](../ui/app/useDql.ts) | `useDql` wrapper for Q1. |
| [ui/app/AIInsights.tsx](../ui/app/AIInsights.tsx) | AI Assist panel. |
| [app.config.json](../app.config.json) | App scopes. |
