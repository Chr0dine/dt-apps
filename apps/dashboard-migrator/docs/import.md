# Import

The Import tab loads the classic dashboard to migrate. You can paste its JSON, upload an exported file, load the built-in sample, or list and load classic dashboards straight from this environment. As soon as a dashboard is loaded it is translated and the app switches to the [Translate](translate.md) tab.

| | |
| --- | --- |
| Step | 1 of 3 (see [index](README.md)) |
| Next page | [Translate](translate.md) |
| Main source files | [ImportTab.tsx](../ui/app/tabs/ImportTab.tsx), [classicApi.ts](../ui/app/classicApi.ts), [classic-dashboards.function.ts](../api/classic-dashboards.function.ts), [tiles.ts](../ui/app/translate/tiles.ts) (`parseClassicDashboard`), [sample.ts](../ui/app/translate/sample.ts), [analyses.ts](../ui/app/analyses.ts) (`analyzeImport`) |

## Contents

- [What this page answers](#what-this-page-answers)
- [Before you start](#before-you-start)
- [Page walkthrough](#page-walkthrough)
  - [Paste or upload a classic dashboard](#paste-or-upload-a-classic-dashboard)
  - [From this environment](#from-this-environment)
  - [Loaded](#loaded)
- [Accepted JSON](#accepted-json)
- [API calls](#api-calls)
- [Messages](#messages)
- [AI Assist on this page](#ai-assist-on-this-page)
- [Sprint and dev environments](#sprint-and-dev-environments)
- [Related pages](#related-pages)

## What this page answers

- How do I get a classic dashboard into the app?
- Which classic dashboards exist in this environment, and who owns them?
- What does the loaded dashboard contain (tile types, query tiles, management zone)?

## Before you start

| Way to load | Needs |
| --- | --- |
| Paste or upload JSON | Nothing. The JSON stays in the browser until you create the new dashboard. |
| Load sample | Nothing. |
| From this environment | A ReadConfig API token stored in the app settings by an admin of the app, and (if outbound connections are restricted) the classic host on the allowlist. |

Scopes used on this page: `app-settings:objects:read` (the function reads the token) and `app-settings:objects:write` (admins store it; also used to decide who may store it).

## Page walkthrough

### Paste or upload a classic dashboard

1. Open the classic dashboard, select **Edit**, switch to the **Settings** tab, select **Configure more**, then **Dashboard JSON** ([Dashboard JSON](https://docs.dynatrace.com/docs/analyze-explore-automate/dashboards-classic/dashboards/dashboard-json)). Copy the JSON or select **Download**.
   Or call [GET /api/config/v1/dashboards/{id}](https://docs.dynatrace.com/docs/dynatrace-api/configuration-api/dashboards-api/get-dashboard) with a ReadConfig token.
2. Paste it into the text area and select **Translate**, or select **Upload JSON file** and pick the downloaded `.json` file (it is translated right away).
3. **Load sample** loads a classic dashboard that covers every tile type the translator knows, including the ones it can only partly translate. Use it to see the result before migrating your own dashboards.
4. **Clear** empties the text area.

A parse error (not JSON, no `tiles` array, or a new dashboard document) is shown under the buttons.

### From this environment

The card shows whether a **ReadConfig token** is stored (its non-secret prefix, e.g. `dt0c01.ABCD…`, and when it was stored), and the classic URL the function calls.

**Admins** (users with `app-settings:objects:write` for this app) also see a password field:

1. Create an API token with the **Read configuration** (`ReadConfig`) scope ([Access tokens](https://docs.dynatrace.com/docs/manage/identity-access-management/access-tokens-and-oauth-clients/access-tokens)).
2. Paste it and select **Check and store**. The function first calls `GET /api/config/v1/dashboards?pageSize=1` with it; only a token that works is saved, as a `secret` property of the `app-credentials` settings object, shared read-only with every user of the app.
3. **Remove token** deletes it from the app settings.

Everyone else sees whether a token is stored; without one, they paste JSON instead.

With a token stored, **List classic dashboards** lists every classic dashboard (name, owner). Filter by name, owner or ID, then select **Load and translate** on a row.

### Loaded

After loading, a card shows the dashboard name, the number of tiles and the owner, with **Review translation** to go to the [Translate](translate.md) tab.

## Accepted JSON

`parseClassicDashboard` accepts:

| Input | Example |
| --- | --- |
| The Configuration API response for one dashboard | `{ "id": "…", "dashboardMetadata": { "name": "…" }, "tiles": [ … ] }` |
| The classic *Dashboard JSON* editor content | Same shape (without `id`). |
| An export wrapper | `{ "dashboards": [ { … } ] }`: the first dashboard is used. |

A new (Gen3) dashboard document (`{ "type": "dashboard", "content": … }`) is rejected with a message. A dashboard without a name is called *Migrated dashboard*.

## API calls

All classic API calls go through the `classic-dashboards` app function ([classic-dashboards.function.ts](../api/classic-dashboards.function.ts)), because the platform has no proxy for the Configuration API v1:

| Action | Call | Who |
| --- | --- | --- |
| `status` | App settings read (`app-credentials`), effective permission check for `app-settings:objects:write` | Everyone |
| `save-token` | `GET {classic}/api/config/v1/dashboards?pageSize=1` with the new token, then app settings write | Admins |
| `clear-token` | App settings write | Admins |
| `list` | `GET {classic}/api/config/v1/dashboards` | Everyone, with a token stored |
| `get` | `GET {classic}/api/config/v1/dashboards/{id}` | Everyone, with a token stored |

`{classic}` is the environment URL with `.apps.dynatrace.com` replaced by `.live.dynatrace.com` (other hosts drop the `.apps` label, e.g. `abc12345.sprint.dynatracelabs.com`). The token is sent as `Authorization: Api-Token …` and never returned to the browser.

## Messages

| Message | Cause | What to do |
| --- | --- | --- |
| Not valid JSON | The pasted text is not JSON. | Copy the whole JSON from the *Dashboard JSON* page. |
| Not a classic dashboard | No `tiles` array. | Paste a classic dashboard, not a list or a different document. |
| This looks like a new (Gen3) dashboard document | The JSON is already a new dashboard. | Nothing to migrate. |
| No ReadConfig API token is stored yet | `list` / `get` without a token. | Ask an admin to store one, or paste the JSON. |
| The Config API returned 401/403 | The token is invalid, expired, or lacks `ReadConfig`. | Store a new token with the Read configuration scope. |
| … host not in allowlist … (blocked) | Outbound connections of app functions are restricted. | Add the classic host to *Settings > Preferences > Limit outbound connections* ([Allow outbound connections](https://developer.dynatrace.com/develop/guides/app-functions/allow-outbound-connections/)). |
| Only users who can change this app's settings can store the token | A non-admin tried to store or remove it. | Ask an admin of the app. |
| The classic-dashboards app function is not available (HTTP 404) | The running app has no function (dev server started before it existed). | Restart `npx dt-app dev`, or deploy. |

## AI Assist on this page

`analyzeImport` ([analyses.ts](../ui/app/analyses.ts)):

- **Nothing loaded:** explains the ways to load, and recommends asking an admin for a token if none is stored.
- **Loaded:** tile count by type, how many tiles carry classic queries, USQL tiles (they read new RUM data), the management zone filter; recommends *Verify all* on the Translate tab and planning for manual tiles.

## Sprint and dev environments

On `*.sprint.apps.dynatracelabs.com` and `*.dev.apps.dynatracelabs.com` the classic URL is the same host without `.apps` (e.g. `https://abc12345.sprint.dynatracelabs.com`). Create the ReadConfig token in that environment, and allow that host if outbound connections are restricted.

## Related pages

- [Translate](translate.md): what happens to each tile.
- [Translation reference](translation-reference.md): which tile types are translated.
- Dynatrace: [Dashboard JSON](https://docs.dynatrace.com/docs/analyze-explore-automate/dashboards-classic/dashboards/dashboard-json), [Dashboards API](https://docs.dynatrace.com/docs/dynatrace-api/configuration-api/dashboards-api), [Access tokens](https://docs.dynatrace.com/docs/manage/identity-access-management/access-tokens-and-oauth-clients/access-tokens), [Available tiles](https://docs.dynatrace.com/docs/analyze-explore-automate/dashboards-classic/charts-and-tiles/available-tiles).
