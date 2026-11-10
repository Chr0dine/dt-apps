# Translate

The Translate tab shows every tile of the loaded classic dashboard next to its DQL equivalent. For each tile you see how confident the translation is and why, can verify the DQL against this environment, preview the result, change the query or the visualization, and decide whether the tile goes into the new dashboard.

| | |
| --- | --- |
| Step | 2 of 3 (see [index](README.md)) |
| Previous / next page | [Import](import.md) / [Export](export.md) |
| Main source files | [TranslateTab.tsx](../ui/app/tabs/TranslateTab.tsx), [MigrationContext.tsx](../ui/app/MigrationContext.tsx) (edits, verification), [PreviewChart.tsx](../ui/app/components/PreviewChart.tsx), [QueryActions.tsx](../ui/app/components/QueryActions.tsx), the translator in [translate/](../ui/app/translate/), [analyses.ts](../ui/app/analyses.ts) (`analyzeTranslate`) |

## Contents

- [What this page answers](#what-this-page-answers)
- [Before you start](#before-you-start)
- [Page walkthrough](#page-walkthrough)
  - [Summary](#summary)
  - [Tile cards](#tile-cards)
  - [Verify](#verify)
  - [Preview](#preview)
  - [Editing a tile](#editing-a-tile)
- [Notes you may see](#notes-you-may-see)
- [Queries](#queries)
- [AI Assist on this page](#ai-assist-on-this-page)
- [Limitations and edge cases](#limitations-and-edge-cases)
- [Related pages](#related-pages)

## What this page answers

- What is the DQL equivalent of each classic tile's query?
- Which tiles translate exactly, which approximately, and which need manual work, and why?
- Is every query valid DQL in this environment, and does every metric key it reads exist?
- Does the translated query return the data I expect?

## Before you start

Verification and previews run as the signed-in user, so they need read access to the data the tiles query. Scopes used: `storage:metrics:read` (metric key check, `timeseries` previews), `storage:entities:read` (`classicEntitySelector`, `entityName`), `storage:user.sessions:read` / `storage:user.events:read` (USQL tiles), `storage:logs:read` (log tiles), `storage:events:read` / `storage:buckets:read` (problem tiles), and the others listed in the [index](README.md#app-scopes).

## Page walkthrough

### Summary

The first card shows the dashboard name and:

| Element | Meaning |
| --- | --- |
| Exact / Approximate / Manual | Number of tiles per [confidence](README.md#how-confident-is-a-translation). |
| Verified queries | Query tiles verified so far / all query tiles. |
| Failing | Query tiles whose DQL is invalid or reads a metric that does not exist (only after verifying). |
| Filter | Show all tiles, one confidence, or only failing tiles. |
| Notes | Dashboard-level notes: the classic default timeframe, the dashboard's management zone, unconfigured tiles. |
| **Verify all against this environment** | Verifies every query tile (see [Verify](#verify)). |
| **Continue to Export** | Goes to the [Export](export.md) tab. |

### Tile cards

Tiles are listed in layout order (top to bottom, left to right). Each card has:

| Element | Meaning |
| --- | --- |
| Title | The classic tile's custom name, or its tile name. |
| `CLASSIC_TYPE → visualization` | Classic tile type and the new visualization (or `markdown`). |
| Confidence badge | Exact, Approximate or Manual. |
| Verification chip | *Verified*, *Invalid DQL*, *Metric not found* or *Verifying…*. |
| *edited* | You changed the DQL or the visualization. |
| **Include in new dashboard** | Untick to leave the tile out of the export. |
| Classic · *language* | The classic query: metric selector, custom chart (rebuilt as a selector), USQL, log query, or the built-in tile type. |
| DQL | The translated query in a DQL editor (syntax highlighting, autocomplete). Markdown tiles show the markdown instead. |
| Notes | Why the tile is approximate or manual, and what to check. See [Notes you may see](#notes-you-may-see). |
| Verification messages | Missing metric keys and the DQL verifier's messages (ERROR / WARN / INFO). |
| Visualization | The new tile's visualization: lineChart, areaChart, barChart, categoricalBarChart, pieChart, donutChart, singleValue, meterBar, gauge, table, honeycomb. |
| **Preview result**, **Verify**, **Reset to translation** | See below. |

A card with a failing verification has a red border.

### Verify

**Verify all** (or **Verify** on one tile) does two checks:

1. **DQL verifier**: `queryAssistanceClient.queryVerify` for each query. *Invalid DQL* means the verifier rejected it; its message (e.g. an unknown field) is shown under the tile.
2. **Metric keys**: one query for all metric keys the tiles read:

   ```dql
   metrics
   | filter in(metric.key, array("dt.host.cpu.usage", "dt.service.request.count", ...))
   | summarize n = count(), by: {metric.key}
   ```

   *Metric not found* means the key is not in this environment's metric catalog: it has no data here, or the classic key maps to a different Grail key. Find the right key in a notebook with `metrics | filter contains(metric.key, "...")` and edit the tile.

Editing a query clears its verification; verify it again.

### Preview

**Preview result** runs the tile's DQL (the last 2 hours, or the classic tile's own timeframe kept as `from:`) and draws the result with the app's own chart:

| Result shape | Drawn as |
| --- | --- |
| Time series (`timeframe`, `interval`, numeric arrays) | Line chart with a crosshair tooltip and a legend (up to 8 series; more are counted, not drawn). Area chart for areaChart. |
| One number | Large number with its field name. |
| One numeric value per row with a label | Horizontal bars (top 15), labelled by entity name where available. |
| Anything else | Table (first 10 records, 8 columns). |

Under the preview: **Show DQL**, **Copy DQL**, **↗ Open in Notebook**, **↗ Add to Dashboard**.

### Editing a tile

Type in the DQL editor to change the query; the change is kept for the export and marked *edited*. Change the visualization with the selector. **Reset to translation** restores the generated query and visualization. Metric keys of an edited query are read from its aggregation calls (`avg(…)`, `sum(…)`, …) for the metric check.

## Notes you may see

| Note (shortened) | Meaning | What to do |
| --- | --- | --- |
| *… is not in the known mapping table; it was mapped to …* | A classic key mapped heuristically. | Verify; if *Metric not found*, find the right key. |
| *Without :splitBy a classic selector returns one series per dimension combination …* | Classic splits by all dimensions by default; DQL aggregates. | Add `by: {…}` if you need the split. |
| *Management zone "…" is applied with classicEntitySelector(mzName(…))* | The classic MZ filter is carried over. | Replace it with a [segment](https://docs.dynatrace.com/docs/manage/segments). |
| *The management zone filter could not be applied to …: no entity dimension* | The metric has no entity to filter on. | Use a segment. |
| *Transformation :… has no DQL equivalent here and was dropped* | e.g. `:smooth`, `:partition`, `:rollup`. | Rebuild it with DQL array functions if it matters. |
| *toUnit(…) was dropped* | An unknown unit conversion. | Set the unit in the tile's visualization settings. |
| *The classic tile has N queries; they are combined with append* | Several queries in one tile. | Check the result; split into tiles if needed. |
| *USQL reads classic RUM data; the DQL reads new RUM (Grail) data* | Always on USQL tiles. | Make sure the frontend is monitored with new RUM. |
| *Field … has no known new RUM equivalent* | A USQL field kept as is. | Look up the field in `user.sessions` / `user.events`. |
| *Classic heatmaps are shown as a line chart* | No direct heatmap equivalent. | Choose heatmap and adjust the query (string axes). |
| *The classic tile timeframe (…) is kept as from: … in the query* | The tile had its own timeframe. | Keep it, or remove `from:` to follow the dashboard timeframe. |
| *… is a calculated service metric; these are not stored in Grail* | `calc:` metric. | Rebuild from spans or an OpenPipeline metric extraction. |

The complete list of mappings is in the [Translation reference](translation-reference.md).

## Queries

The tab runs the translated queries themselves (previews), the `metrics` query above (verification), and no other queries.

## AI Assist on this page

`analyzeTranslate` ([analyses.ts](../ui/app/analyses.ts)):

- **Summary:** tiles per confidence, queries verified, invalid queries, queries reading unknown metrics.
- **Insights:** confidence counts; unverified queries; failing tiles by name; missing metric keys; heuristically mapped keys; excluded tiles; or that everything is verified.
- **Recommendations:** run Verify all; fix failing tiles in place; look up missing or guessed keys; read the notes of approximate tiles; untick manual tiles you do not want as placeholders.

## Limitations and edge cases

- A selector that cannot be parsed becomes a manual markdown tile showing the selector and the parse error.
- Classic custom charts are rebuilt from their `series` when the tile has no `metricExpressions`; host-group and data-center filters are not translated (noted).
- `:parents` and `:names` on non-entity dimensions are not translated; entity names are always added for `dt.entity.*` dimensions.
- Previews are limited to what `useDql` returns by default; very large results are truncated in the chart, not in the exported tile.

## Related pages

- [Translation reference](translation-reference.md)
- [Import](import.md), [Export](export.md)
- Dynatrace: [DQL](https://docs.dynatrace.com/docs/platform/grail/dynatrace-query-language), [Metric commands](https://docs.dynatrace.com/docs/platform/grail/dynatrace-query-language/commands/metric-commands), [Built-in metrics on Grail](https://docs.dynatrace.com/docs/analyze-explore-automate/metrics/built-in-metrics-on-grail), [Metric selector](https://docs.dynatrace.com/docs/dynatrace-api/environment-api/metric-v2/metric-selector), [General functions](https://docs.dynatrace.com/docs/platform/grail/dynatrace-query-language/functions/general-functions), [USQL](https://docs.dynatrace.com/docs/observe/digital-experience-classic/rum-classic/session-segmentation/custom-queries-segmentation-and-aggregation-of-session-data), [New RUM](https://docs.dynatrace.com/docs/observe/digital-experience/rum), [Segments](https://docs.dynatrace.com/docs/manage/segments).
