# Dashboard Migrator documentation

Dashboard Migrator is a Dynatrace AppEngine app that takes a **classic dashboard** and rebuilds it as a **new dashboard** (Dashboards app, Grail). Every classic query on the dashboard (Data explorer metric selectors, custom charts, USQL, log viewer queries) is translated into its **DQL** equivalent, checked against the environment, previewed, and written into a new dashboard document that keeps the classic layout.

The classic dashboard is never changed. The new dashboard is a new document owned by the user who creates it.

## Contents

- [The three steps](#the-three-steps)
- [Pages](#pages)
- [How confident is a translation?](#how-confident-is-a-translation)
- [Before you start](#before-you-start)
  - [App scopes](#app-scopes)
  - [User permissions](#user-permissions)
  - [Credentials for loading classic dashboards from the environment](#credentials-for-loading-classic-dashboards-from-the-environment)
- [Header controls](#header-controls)
- [AI Assist](#ai-assist)
- [Query access (Show DQL, Notebook, Dashboard)](#query-access-show-dql-notebook-dashboard)
- [Data sources](#data-sources)
- [Limitations](#limitations)
- [Dynatrace documentation](#dynatrace-documentation)
- [Source files](#source-files)

## The three steps

| Step | Tab | Result |
| --- | --- | --- |
| 1 | [Import](import.md) | The classic dashboard JSON is loaded (pasted, uploaded, the built-in sample, or read from this environment through the classic Configuration API). |
| 2 | [Translate](translate.md) | Every tile is translated; the DQL is verified against this environment, previewed, and can be edited. |
| 3 | [Export](export.md) | The tiles you keep are written into a new dashboard document (or downloaded as JSON). |

## Pages

| Page | What it covers |
| --- | --- |
| [Import](import.md) | Every way to load a classic dashboard, the ReadConfig token setup, and the messages the tab shows. |
| [Translate](translate.md) | Tile cards, confidence, verification, preview, editing, and what each note means. |
| [Export](export.md) | The new dashboard document, layout scaling, the migration summary tile, and what to do after the export. |
| [Translation reference](translation-reference.md) | The complete mapping: metric keys, selector transformations, USQL fields and functions, tile types, visualizations, timeframes, management zones. |

## How confident is a translation?

Each tile gets one of three confidence levels; the [Translate](translate.md) tab shows why with notes under the tile.

| Confidence | Meaning | Typical causes |
| --- | --- | --- |
| **Exact** | The DQL reads the same data with the same semantics. | Mapped `builtin:` metrics, `:splitBy`, `:filter`, sort / limit, markdown and header tiles, open problems. |
| **Approximate** | The DQL runs, but something differs from classic; the notes say what. | A metric key mapped heuristically, a management zone carried over through `classicEntitySelector`, USQL (classic RUM → new RUM), dropped transformations (`:parents`, `:smooth`), built-in tiles rebuilt from standard queries, several queries in one tile. |
| **Manual** | No automatic form; the tile becomes a markdown placeholder that says what to rebuild. | SLO tiles, image tiles, calculated service metrics (`calc:`), function metrics (`func:`), FUNNEL queries, tile types without a translation. |

## Before you start

### App scopes

| Scope | Used for |
| --- | --- |
| `storage:metrics:read` | Checking that translated metric keys exist (`metrics` command) and previewing `timeseries` queries. |
| `storage:entities:read` | `classicEntitySelector()` filters, `entityName()`, and previews of entity tiles. |
| `storage:smartscape:read` | Previews of queries that read Smartscape nodes. |
| `storage:user.sessions:read`, `storage:user.events:read` | Previews of USQL tiles translated to new RUM data. |
| `storage:logs:read` | Previews of log tiles (`fetch logs`). |
| `storage:events:read`, `storage:buckets:read` | Previews of problem tiles (`dt.davis.problems`) and other event data. |
| `storage:bizevents:read`, `storage:spans:read` | Previews of tiles that read business events or spans (after editing). |
| `document:documents:read`, `document:documents:write` | Creating the new dashboard document. |
| `app-settings:objects:read`, `app-settings:objects:write` | The ReadConfig API token in the app settings (read by the app function; written by admins). |
| `state:user-app-states:read`, `state:user-app-states:write` | The Export options (summary tile, placeholders, name suffix), per user. |

### User permissions

Previews and verification run as the signed-in user, so they only show data the user may read (Grail bucket and table permissions, security context). Creating the dashboard needs `document:documents:write`. Storing the ReadConfig token needs `app-settings:objects:write` for this app.

### Credentials for loading classic dashboards from the environment

Classic dashboards are only available through the classic Configuration API (`GET /api/config/v1/dashboards`). The platform has no proxy for it, so the `classic-dashboards` app function calls the environment's classic URL with an **API token with the ReadConfig scope**. An admin stores the token once on the [Import](import.md#from-this-environment) tab; it is kept as a `secret` property in the app settings and only the app's function can read it in plain text. Pasting or uploading JSON needs no token.

## Header controls

| Control | What it does |
| --- | --- |
| Dashboard name and badges | Once a dashboard is loaded: its name and the number of exact / approximate / manual tiles. |
| **AI Assist** | Opens the AI Assist panel on the current tab (see below). |
| **?** | Opens the in-app help, with links to these pages and the Dynatrace documentation. |
| Version | The deployed app version. |

Every tab has a *<tab> documentation* link (top right) to its page here, and a *Learn more* list of Dynatrace documentation at the bottom.

## AI Assist

AI Assist is computed in the app from the loaded dashboard and the translation results; nothing is sent anywhere. Each tab has its own analysis in [`analyses.ts`](../ui/app/analyses.ts):

| Tab | Function | Looks at |
| --- | --- | --- |
| Import | `analyzeImport` | Tile count by type, how many tiles carry classic queries, USQL tiles (new RUM), management zone filter, whether the ReadConfig token is set. |
| Translate | `analyzeTranslate` | Confidence counts, unverified queries, invalid DQL, metric keys missing in this environment, heuristically mapped keys, excluded tiles. |
| Export | `analyzeExport` | Tiles to be created (query vs. markdown), tiles still failing or unverified, placeholders, dashboards created in this session. |

## Query access (Show DQL, Notebook, Dashboard)

Under every preview on the [Translate](translate.md) tab:

| Action | What it does |
| --- | --- |
| Show DQL / Hide DQL | Shows the query behind the preview. |
| Copy DQL | Copies the query to the clipboard. |
| ↗ Open in Notebook | Sends the query to Notebooks (intent `dynatrace.notebooks` / `view-query`). |
| ↗ Add to Dashboard | Sends the query to Dashboards (intent `dynatrace.dashboards` / `add-to-dashboard`), to add a single tile to an existing dashboard. |

## Data sources

| Data | Source |
| --- | --- |
| Classic dashboard | Pasted / uploaded JSON, or the classic Configuration API through the `classic-dashboards` app function. |
| Verification | `queryAssistanceClient.queryVerify` (DQL verifier) per query, and one `metrics \| filter in(metric.key, array(...))` query for all metric keys. |
| Previews | The translated DQL itself, run as the user (`useDql`), for the last 2 hours unless the query sets `from:`. |
| New dashboard | `documentsClient.createDocument` (Document API), type `dashboard`, content version 21. |

## Limitations

- Classic tiles that have no query (SLO, image, network, process groups, …) become placeholders; see [Translation reference: tile types](translation-reference.md#tile-types).
- USQL reads classic RUM data, the DQL reads new RUM data: the tile only shows data for frontends monitored with new RUM.
- Calculated service metrics (`calc:`) are not stored in Grail; rebuild them from spans or with an OpenPipeline metric extraction.
- Management zones are carried over through `classicEntitySelector("type(X),mzName(...)")`; replace them with segments when you can.
- Dashboard variables and per-tile visualization settings (thresholds, units, colors) are not migrated; set them on the new dashboard.
- Previews show at most the records the query returns; they are a check, not the final tile rendering.

## Dynatrace documentation

| Topic | Page |
| --- | --- |
| Classic dashboards | [Dashboards Classic](https://docs.dynatrace.com/docs/analyze-explore-automate/dashboards-classic), [Dashboard JSON](https://docs.dynatrace.com/docs/analyze-explore-automate/dashboards-classic/dashboards/dashboard-json), [Available tiles](https://docs.dynatrace.com/docs/analyze-explore-automate/dashboards-classic/charts-and-tiles/available-tiles) |
| Classic API | [Dashboards API](https://docs.dynatrace.com/docs/dynatrace-api/configuration-api/dashboards-api), [GET a dashboard](https://docs.dynatrace.com/docs/dynatrace-api/configuration-api/dashboards-api/get-dashboard), [Access tokens](https://docs.dynatrace.com/docs/manage/identity-access-management/access-tokens-and-oauth-clients/access-tokens) |
| Classic queries | [Metric selector](https://docs.dynatrace.com/docs/dynatrace-api/environment-api/metric-v2/metric-selector), [USQL](https://docs.dynatrace.com/docs/observe/digital-experience-classic/rum-classic/session-segmentation/custom-queries-segmentation-and-aggregation-of-session-data), [Management zones](https://docs.dynatrace.com/docs/manage/identity-access-management-classic/permission-management/management-zones) |
| DQL | [Dynatrace Query Language](https://docs.dynatrace.com/docs/platform/grail/dynatrace-query-language), [Metric commands](https://docs.dynatrace.com/docs/platform/grail/dynatrace-query-language/commands/metric-commands), [Data source commands](https://docs.dynatrace.com/docs/platform/grail/dynatrace-query-language/commands/data-source-commands), [General functions](https://docs.dynatrace.com/docs/platform/grail/dynatrace-query-language/functions/general-functions), [Built-in metrics on Grail](https://docs.dynatrace.com/docs/analyze-explore-automate/metrics/built-in-metrics-on-grail) |
| New dashboards | [Dashboards](https://docs.dynatrace.com/docs/analyze-explore-automate/dashboards-and-notebooks/dashboards-new), [Components](https://docs.dynatrace.com/docs/analyze-explore-automate/dashboards-and-notebooks/dashboards-new/components), [Upgrade guide: dashboards](https://docs.dynatrace.com/docs/platform/upgrade/get-apps-and-surfaces-working/upgrade-guide-dashboards), [Segments](https://docs.dynatrace.com/docs/manage/segments), [New RUM](https://docs.dynatrace.com/docs/observe/digital-experience/rum) |
| App platform | [AppEngine](https://docs.dynatrace.com/docs/platform/appengine), [Allow outbound connections for app functions](https://developer.dynatrace.com/develop/guides/app-functions/allow-outbound-connections/) |

## Source files

| Area | Files |
| --- | --- |
| Shell, tabs | [App.tsx](../ui/app/App.tsx), [tabs/ImportTab.tsx](../ui/app/tabs/ImportTab.tsx), [tabs/TranslateTab.tsx](../ui/app/tabs/TranslateTab.tsx), [tabs/ExportTab.tsx](../ui/app/tabs/ExportTab.tsx) |
| Translator (pure TypeScript) | [translate/types.ts](../ui/app/translate/types.ts), [translate/metrics.ts](../ui/app/translate/metrics.ts), [translate/metricSelector.ts](../ui/app/translate/metricSelector.ts), [translate/usql.ts](../ui/app/translate/usql.ts), [translate/tiles.ts](../ui/app/translate/tiles.ts), [translate/sample.ts](../ui/app/translate/sample.ts) |
| State, verification | [MigrationContext.tsx](../ui/app/MigrationContext.tsx), [SettingsContext.tsx](../ui/app/SettingsContext.tsx) |
| Components | [components/PreviewChart.tsx](../ui/app/components/PreviewChart.tsx), [components/QueryActions.tsx](../ui/app/components/QueryActions.tsx), [components/AIInsights.tsx](../ui/app/components/AIInsights.tsx), [components/HelpModal.tsx](../ui/app/components/HelpModal.tsx), [components/DocLinks.tsx](../ui/app/components/DocLinks.tsx), [links.ts](../ui/app/links.ts) |
| App function, settings | [api/classic-dashboards.function.ts](../api/classic-dashboards.function.ts), [settings/schemas/app-credentials.schema.json](../settings/schemas/app-credentials.schema.json) |
| Tests | [scripts/test-translate.mjs](../scripts/test-translate.mjs) |
