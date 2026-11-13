# Dashboard Migrator

A Dynatrace AppEngine app that translates **classic dashboards** and their classic queries into **DQL** and creates a **new (Gen3) dashboard** from them.

| Tab | What it does |
| --- | --- |
| **Import** | Paste or upload the classic dashboard JSON, load the built-in sample, or list and load classic dashboards from the environment (needs a ReadConfig API token stored by an admin). |
| **Translate** | One card per tile: the classic query beside its DQL (editable), a confidence (exact / approximate / manual) with notes, **Verify all** (DQL verifier + metric-key check against the tenant), and a preview that runs the query and draws it with a custom chart. Show DQL, Copy, Open in Notebook and Add to Dashboard sit under each preview. |
| **Export** | Name the new dashboard, preview the 24-column layout, then **Create dashboard** (Document API) or download / copy the dashboard JSON. |

**AI Assist** (header) gives a per-tab summary, insights and recommendations: what the classic dashboard contains, which queries fail verification or read unknown metrics, and what to fix before exporting.

## Documentation

| Page | Covers |
| --- | --- |
| [Overview](docs/README.md) | The three steps, confidence levels, scopes, credentials, AI Assist, query access, data sources, limitations, Dynatrace documentation links. |
| [Import](docs/import.md) | Paste / upload / sample / load from the environment, the ReadConfig token, accepted JSON, API calls, messages. |
| [Translate](docs/translate.md) | Tile cards, verification, previews, editing, every note and what to do about it. |
| [Export](docs/export.md) | The dashboard document, layout scaling, what to do after the export. |
| [Translation reference](docs/translation-reference.md) | Every mapping: tile types, visualizations, metric keys, selector transformations, USQL, logs, built-in tiles, timeframes, management zones. |

In the app, every tab links to its page (top right) and lists the relevant Dynatrace documentation at the bottom; the help dialog (**?**) links to all of them.

## What is translated

| Classic tile | DQL |
| --- | --- |
| Data explorer (`metricExpressions`, `queries[]` or code-mode selector) | `timeseries` with mapped metric keys, `by:`, `filter:` (entity selectors via `classicEntitySelector()`), sort/limit, `rate`/`default`/`shift`, arithmetic between selectors, entity names. Tables, top lists, pies, honeycombs and single values fold the series. |
| Custom chart | Rebuilt as a selector from `series[]` (aggregation, dimensions, entity filters by ID or tag), then as above. |
| USQL (`DTAQL`) | `fetch user.sessions` / `fetch user.events` with new-RUM field names, `summarize` or `makeTimeseries` for `DATETIME()` groups, WHERE / ORDER BY / LIMIT / TOP. |
| Log viewer | `fetch logs \| filter …` term by term. |
| Markdown, header | Markdown tiles. |
| Open problems, hosts, services, applications, synthetic, databases, host / service tiles | Standard DQL equivalents (approximate). |
| SLO, image, calculated-service-metric charts, other tile types | Markdown placeholders marked **manual**. |

Management zones are carried over as `classicEntitySelector("type(X),mzName(\"…\")")` and flagged so they can be replaced by segments. A classic tile timeframe becomes `from:` in the query; the classic default timeframe is noted in the summary tile.

Metric key mapping: `ui/app/translate/metrics.ts`. Known keys were checked against a demo tenant's metric catalog; unknown `builtin:` keys are mapped heuristically and flagged, and the Translate tab checks every key against the tenant.

## Credentials (classic dashboards from the environment)

Classic dashboards are only exposed by the classic Config API (`/api/config/v1/dashboards`). The `classic-dashboards` app function calls `https://<env>.live.dynatrace.com` with a **ReadConfig** API token that an admin stores once in the app settings (`settings/schemas/app-credentials.schema.json`, property type `secret`). The token is validated against the Config API before it is saved; only the app's function can read it in plain text. If the call fails with "host not in allowlist", add the classic host to `builtin:dt-javascript-runtime.allowed-outbound-connections`.

Pasting JSON needs no token.

## Develop

```powershell
npm install --legacy-peer-deps
npx dt-app dev        # local dev server
npm test              # translator checks (scripts/test-translate.mjs)
npm run lint
npm run build         # under the shared build lock
npm run deploy        # bump app.version in app.config.json first
```

`npm test -- --out file.json` writes the sample translation and the generated dashboard JSON, which can be checked with `dtctl query '<dql>'` and `dtctl apply dashboard -f <file> --dry-run`.
