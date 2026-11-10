# Export

The Export tab writes the tiles you kept on the [Translate](translate.md) tab into a new dashboard. It shows the new layout before anything is created, creates the dashboard document in the Dashboards app, or gives you the same document as JSON.

| | |
| --- | --- |
| Step | 3 of 3 (see [index](README.md)) |
| Previous page | [Translate](translate.md) |
| Main source files | [ExportTab.tsx](../ui/app/tabs/ExportTab.tsx), [tiles.ts](../ui/app/translate/tiles.ts) (`buildGen3Dashboard`, `layoutTiles`), [SettingsContext.tsx](../ui/app/SettingsContext.tsx), [analyses.ts](../ui/app/analyses.ts) (`analyzeExport`) |

## Contents

- [What this page answers](#what-this-page-answers)
- [Before you start](#before-you-start)
- [Page walkthrough](#page-walkthrough)
  - [New dashboard](#new-dashboard)
  - [Layout preview](#layout-preview)
  - [Created in this session](#created-in-this-session)
- [The dashboard document](#the-dashboard-document)
- [Layout scaling](#layout-scaling)
- [API calls](#api-calls)
- [After the export](#after-the-export)
- [AI Assist on this page](#ai-assist-on-this-page)
- [Related pages](#related-pages)

## What this page answers

- What will the new dashboard look like, and which tiles are in it?
- How do I create it, or take its JSON somewhere else?
- What is left to do once it exists?

## Before you start

Creating the dashboard needs `document:documents:write` (app scope and user permission). Download and copy need nothing.

## Page walkthrough

### New dashboard

| Control | What it does |
| --- | --- |
| Name | Defaults to the classic name plus *(migrated)*. |
| **Create dashboard** | Creates the dashboard document; on success a message with **↗ Open dashboard** appears. |
| **Download JSON** | Downloads the dashboard document (`name`, `type`, `content`) as a `.json` file. |
| **Copy JSON** | Copies the same document to the clipboard. |
| Add a migration summary tile at the top | A full-width markdown tile with the classic name, the tile counts per confidence, the date, and the dashboard-level notes (default timeframe, management zone). |
| Include placeholders for tiles that need manual work | Untick to leave out manual tiles (SLO, calc metrics, unsupported tile types). |

The two options are saved per user.

### Layout preview

The new 24-column grid, with each tile coloured by confidence (green exact, amber approximate, red manual, blue the summary tile) and labelled with its title. It shows exactly the layouts that will be written.

### Created in this session

Every dashboard created since the app was opened, with its tile count and time, **↗ Open** and a direct link.

## The dashboard document

`buildGen3Dashboard` writes a dashboard document with content version 21:

| Part | Content |
| --- | --- |
| `tiles` | Data tiles: `type: "data"`, `title`, `query` (the DQL, including your edits), `visualization`, empty `visualizationSettings` and `querySettings`. Markdown tiles: `type: "markdown"`, `content`. |
| `layouts` | One `{ x, y, w, h }` per tile (see below), shifted down by the summary tile's height when it is added. |
| `variables` | Empty: classic dashboards have no variables to carry over. |

The document is created with `type: "dashboard"` and a description naming the classic dashboard ID. It is private to you until you share it.

The sample dashboard's document was checked with `dtctl apply dashboard -f … --dry-run` (passes validation).

## Layout scaling

Classic tiles are positioned in pixels on a 38 px grid; new dashboards use a 24-column grid (`layoutTiles` in [tiles.ts](../ui/app/translate/tiles.ts)):

- The classic dashboard's width (its right-most tile edge, at least 24 grid units) is scaled to 24 columns. Both edges of each tile are rounded, so tiles that touched in classic still touch.
- Rows: `y = top / 38`, `h = height / 38` (at least 1, so a classic header stays one row).
- Tiles that overlap after rounding are pushed down below the tile they hit.
- Tiles without bounds are stacked under the rest, half width.

## API calls

| Call | When |
| --- | --- |
| `documentsClient.createDocument({ body: { name, type: "dashboard", description, content: Blob(application/json) } })` | **Create dashboard**. |

## After the export

1. Open the dashboard and set its **default timeframe** (the classic default is in the summary tile).
2. Replace management zone filters (`classicEntitySelector("…mzName(…)")`) with [segments](https://docs.dynatrace.com/docs/manage/segments).
3. Rebuild the placeholder tiles: an SLO tile for upgraded SLOs, span queries for calculated service metrics.
4. Set units, thresholds and colours per tile ([dashboard components](https://docs.dynatrace.com/docs/analyze-explore-automate/dashboards-and-notebooks/dashboards-new/components)).
5. Share it with the classic dashboard's audience, and retire the classic dashboard once its owners have reviewed the new one ([Upgrade guide: dashboards](https://docs.dynatrace.com/docs/platform/upgrade/get-apps-and-surfaces-working/upgrade-guide-dashboards)).

## AI Assist on this page

`analyzeExport` ([analyses.ts](../ui/app/analyses.ts)): the number of tiles to be created (query and markdown), tiles still failing or not verified, placeholders, dashboards created in this session; recommends verifying first, then setting the default timeframe and segments, and keeping the classic dashboard until the new one is reviewed.

## Related pages

- [Translate](translate.md), [Translation reference](translation-reference.md)
- Dynatrace: [Dashboards](https://docs.dynatrace.com/docs/analyze-explore-automate/dashboards-and-notebooks/dashboards-new), [Components](https://docs.dynatrace.com/docs/analyze-explore-automate/dashboards-and-notebooks/dashboards-new/components), [Upgrade guide: dashboards](https://docs.dynatrace.com/docs/platform/upgrade/get-apps-and-surfaces-working/upgrade-guide-dashboards), [Segments](https://docs.dynatrace.com/docs/manage/segments).
