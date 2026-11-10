# Translation reference

Everything the translator does, tile type by tile type and construct by construct. The code is in [ui/app/translate/](../ui/app/translate/); `npm test` ([scripts/test-translate.mjs](../scripts/test-translate.mjs)) checks the cases below and translates the [sample dashboard](../ui/app/translate/sample.ts). Every query the sample produces was run against a tenant with `dtctl query`.

| | |
| --- | --- |
| Used by | [Translate](translate.md) |
| Source files | [metrics.ts](../ui/app/translate/metrics.ts), [metricSelector.ts](../ui/app/translate/metricSelector.ts), [usql.ts](../ui/app/translate/usql.ts), [tiles.ts](../ui/app/translate/tiles.ts) |

## Contents

- [Tile types](#tile-types)
- [Visualizations](#visualizations)
- [Metric keys](#metric-keys)
  - [Known keys](#known-keys)
  - [Keys not in the table](#keys-not-in-the-table)
  - [Dimensions](#dimensions)
- [Metric selector transformations](#metric-selector-transformations)
  - [Filters](#filters)
  - [Arithmetic](#arithmetic)
  - [Folding (tables, top lists, single values)](#folding-tables-top-lists-single-values)
  - [Worked examples](#worked-examples)
- [Data explorer and custom chart tiles without metricExpressions](#data-explorer-and-custom-chart-tiles-without-metricexpressions)
- [USQL](#usql)
  - [Tables](#tables)
  - [Fields](#fields)
  - [Functions and clauses](#functions-and-clauses)
  - [Worked examples](#worked-examples-1)
- [Log viewer queries](#log-viewer-queries)
- [Built-in tiles](#built-in-tiles)
- [Timeframes](#timeframes)
- [Management zones](#management-zones)
- [Layout](#layout)

## Tile types

| Classic `tileType` | Result | Confidence |
| --- | --- | --- |
| `DATA_EXPLORER` | DQL from the tile's `metricExpressions` (else rebuilt from `queries[]`) | exact or approximate |
| `CUSTOM_CHARTING` | DQL from `metricExpressions` (else rebuilt from `filterConfig.chartConfig.series[]`) | exact or approximate |
| `DTAQL` (USQL) | `fetch user.sessions` / `fetch user.events` | approximate (classic RUM → new RUM) |
| `LOG_ANALYTICS`, `LOGS` | `fetch logs \| filter …` | approximate |
| `MARKDOWN` | Markdown tile, same content | exact |
| `HEADER` | Markdown tile `## <name>` | exact |
| `OPEN_PROBLEMS`, `HOSTS`, `HOST`, `SERVICES`, `SERVICE_VERSATILE`, `APPLICATIONS`, `APPLICATION`, `UEM_ACTIVE_SESSIONS`, `SYNTHETIC_TESTS`, `SYNTHETIC_SINGLE_WEBCHECK`, `SYNTHETIC_HTTP_MONITOR`, `DATABASES_OVERVIEW` | A standard query, see [Built-in tiles](#built-in-tiles) | exact (problems) or approximate |
| `SLO` | Markdown placeholder with the classic SLO ID | manual |
| `IMAGE` | Markdown placeholder | manual |
| Data explorer / custom chart reading `calc:` or `func:` metrics | Markdown placeholder with the selector | manual |
| Any other type (`NETWORK`, `PROCESS_GROUPS_ONE`, `PURE_MODEL`, …) | Markdown placeholder | manual |

## Visualizations

| Classic | New visualization | Result shape |
| --- | --- | --- |
| Data explorer `GRAPH_CHART`, `LINE` | `lineChart` | time series |
| `STACKED_AREA`, `AREA` | `areaChart` | time series |
| `STACKED_COLUMN`, `COLUMN` | `barChart` | time series |
| `SINGLE_VALUE` | `singleValue` | one value |
| `TABLE` | `table` | one value per series |
| `TOP_LIST` | `categoricalBarChart` | one value per series |
| `PIE_CHART` | `pieChart` | one value per series |
| `HONEYCOMB` | `honeycomb` | one value per series |
| `HEATMAP` | `lineChart` (noted) | time series |
| Custom chart `TIMESERIES` / `BAR` | `lineChart` / `barChart` | time series |
| Custom chart `TOP_LIST` / `PIE` / `SINGLE_VALUE` | `categoricalBarChart` / `pieChart` / `singleValue` | folded |
| USQL `TABLE` | `table` | |
| USQL `COLUMN_CHART` | `categoricalBarChart`, or `barChart` when grouped by `DATETIME()` | |
| USQL `PIE_CHART` / `SINGLE_VALUE` | `pieChart` / `singleValue` (`table` when grouped) | |
| USQL `LINE_CHART` | `lineChart` (time series with `makeTimeseries`) | |
| USQL `FUNNEL` | `table`, manual | |

## Metric keys

### Known keys

Classic key → Grail key, the default aggregation used for `:auto` / no aggregation, and the entity dimension used for management zone filters. Every Grail key below was checked against a tenant's metric catalog when it was added.

| Classic key | Grail | Default aggregation | Entity dimension |
| --- | --- | --- | --- |
| `builtin:host.cpu.usage` | `dt.host.cpu.usage` | avg | `dt.entity.host` |
| `builtin:host.cpu.user` | `dt.host.cpu.user` | avg | `dt.entity.host` |
| `builtin:host.cpu.system` | `dt.host.cpu.system` | avg | `dt.entity.host` |
| `builtin:host.cpu.idle` | `dt.host.cpu.idle` | avg | `dt.entity.host` |
| `builtin:host.cpu.iowait` | `dt.host.cpu.iowait` | avg | `dt.entity.host` |
| `builtin:host.cpu.steal` | `dt.host.cpu.steal` | avg | `dt.entity.host` |
| `builtin:host.cpu.load` | `dt.host.cpu.load` | avg | `dt.entity.host` |
| `builtin:host.cpu.load5m` | `dt.host.cpu.load5m` | avg | `dt.entity.host` |
| `builtin:host.cpu.load15m` | `dt.host.cpu.load15m` | avg | `dt.entity.host` |
| `builtin:host.mem.usage` | `dt.host.memory.usage` | avg | `dt.entity.host` |
| `builtin:host.mem.avail.bytes` | `dt.host.memory.avail.bytes` | avg | `dt.entity.host` |
| `builtin:host.mem.avail.pct` | `dt.host.memory.avail.percent` | avg | `dt.entity.host` |
| `builtin:host.mem.used` | `dt.host.memory.used` | avg | `dt.entity.host` |
| `builtin:host.disk.usedPct` | `dt.host.disk.used.percent` | avg | `dt.entity.host` |
| `builtin:host.disk.avail` | `dt.host.disk.avail` | avg | `dt.entity.host` |
| `builtin:host.disk.free` | `dt.host.disk.free` | avg | `dt.entity.host` |
| `builtin:host.disk.used` | `dt.host.disk.used` | avg | `dt.entity.host` |
| `builtin:host.disk.readTime` | `dt.host.disk.read_time` | avg | `dt.entity.host` |
| `builtin:host.disk.writeTime` | `dt.host.disk.write_time` | avg | `dt.entity.host` |
| `builtin:host.disk.bytesRead` | `dt.host.disk.bytes_read` | avg | `dt.entity.host` |
| `builtin:host.disk.bytesWritten` | `dt.host.disk.bytes_written` | avg | `dt.entity.host` |
| `builtin:host.disk.queueLength` | `dt.host.disk.queue_length` | avg | `dt.entity.host` |
| `builtin:host.net.nic.bytesRx` | `dt.host.net.nic.bytes_rx` | avg | `dt.entity.host` |
| `builtin:host.net.nic.bytesTx` | `dt.host.net.nic.bytes_tx` | avg | `dt.entity.host` |
| `builtin:host.net.nic.packets.rx` | `dt.host.net.nic.packets.rx` | avg | `dt.entity.host` |
| `builtin:host.availability` | `dt.host.availability` | avg | `dt.entity.host` |
| `builtin:service.response.time` | `dt.service.request.response_time` | avg | `dt.entity.service` |
| `builtin:service.response.server` | `dt.service.request.response_time` | avg | `dt.entity.service` |
| `builtin:service.requestCount.total` | `dt.service.request.count` | sum | `dt.entity.service` |
| `builtin:service.requestCount.server` | `dt.service.request.count` | sum | `dt.entity.service` |
| `builtin:service.errors.total.count` | `dt.service.request.failure_count` | sum | `dt.entity.service` |
| `builtin:service.errors.server.count` | `dt.service.request.failure_count` | sum | `dt.entity.service` |
| `builtin:service.errors.fivexx.count` | `dt.service.request.failure_count` | sum | `dt.entity.service` |
| `builtin:service.errors.total.rate` | sum(`dt.service.request.failure_count`), sum(`dt.service.request.count`) → `failures[] / requests[] * 100` | derived | `dt.entity.service` |
| `builtin:service.errors.server.rate` | sum(`dt.service.request.failure_count`), sum(`dt.service.request.count`) → `failures[] / requests[] * 100` | derived | `dt.entity.service` |
| `builtin:tech.generic.cpu.usage` | `dt.process.cpu.usage` | avg | `dt.entity.process_group_instance` |
| `builtin:tech.generic.mem.workingSetSize` | `dt.process.memory.working_set_size` | avg | `dt.entity.process_group_instance` |
| `builtin:tech.generic.mem.usage` | `dt.process.memory.usage` | avg | `dt.entity.process_group_instance` |
| `builtin:tech.jvm.memory.gc.suspensionTime` | `dt.runtime.jvm.gc.suspension_time` | avg | `dt.entity.process_group_instance` |
| `builtin:kubernetes.workload.pods` | `dt.kubernetes.pods` | sum | — |
| `builtin:kubernetes.pods` | `dt.kubernetes.pods` | sum | — |
| `builtin:kubernetes.container.restarts` | `dt.kubernetes.container.restarts` | sum | — |
| `builtin:kubernetes.node.cpu_allocatable` | `dt.kubernetes.node.cpu_allocatable` | sum | — |
| `builtin:kubernetes.workload.cpu_usage` | `dt.kubernetes.container.cpu_usage` | sum | — |
| `builtin:kubernetes.workload.memory_working_set` | `dt.kubernetes.container.memory_working_set` | sum | — |
| `builtin:synthetic.browser.availability` | `dt.synthetic.browser.availability` | avg | — |
| `builtin:synthetic.browser.availability.location.total` | `dt.synthetic.browser.availability` | avg | — |
| `builtin:synthetic.http.availability` | `dt.synthetic.http.availability` | avg | — |
| `builtin:synthetic.http.availability.location.total` | `dt.synthetic.http.availability` | avg | — |
| `builtin:apps.web.activeSessions` | `dt.frontend.session.active.estimated_count` | sum | — |

### Keys not in the table

| Classic key | Mapping | Confidence |
| --- | --- | --- |
| `builtin:host.<path>` | `dt.host.<path>` (camelCase → snake_case, `mem.` → `memory.`) | approximate, *guessed* |
| `builtin:service.<path>` | `dt.service.<path>` | approximate, *guessed* |
| `builtin:tech.generic.<path>` | `dt.process.<path>` | approximate, *guessed* |
| `builtin:tech.<path>` | `dt.runtime.<path>` | approximate, *guessed* |
| `builtin:kubernetes.<path>`, `builtin:containers.<path>` | `dt.kubernetes.<path>` | approximate, *guessed* |
| other `builtin:<ns>.<path>` | `dt.<ns>.<path>` | approximate, *guessed* |
| `ext:<key>` | `<key>` (prefix dropped) | approximate, *guessed* |
| `calc:<key>` | none: calculated service metrics are not in Grail | manual placeholder |
| `func:<key>` | none (e.g. SLO function metrics) | manual placeholder |
| any other key (custom, ingested, `log.*`) | unchanged | exact |

Guessed keys use `sum` as the default aggregation when the key looks like a counter (`count`, `requests`, `errors`, `bytes`, `restarts`), else `avg`. The [Translate](translate.md#verify) tab's metric check tells you whether the guessed key exists. The Grail names of built-in metrics are listed in [Built-in metrics on Grail](https://docs.dynatrace.com/docs/analyze-explore-automate/metrics/built-in-metrics-on-grail).

### Dimensions

`dt.entity.*` dimensions keep their names. These classic dimensions are renamed (approximate, noted):

| Classic | Grail |
| --- | --- |
| `dt.entity.service_method` | `endpoint.name` |
| `dt.entity.cloud_application` | `k8s.workload.name` |
| `dt.entity.cloud_application_namespace` | `k8s.namespace.name` |
| `dt.entity.kubernetes_cluster` | `k8s.cluster.name` |

Names that are not plain identifiers are quoted with backticks.

## Metric selector transformations

Reference: [Metric selector](https://docs.dynatrace.com/docs/dynatrace-api/environment-api/metric-v2/metric-selector), [DQL metric commands](https://docs.dynatrace.com/docs/platform/grail/dynatrace-query-language/commands/metric-commands).

| Classic | DQL |
| --- | --- |
| `<key>` | `timeseries <alias> = <agg>(<grail key>)` (alias from the key, e.g. `cpu_usage`) |
| `:splitBy("a","b")` | `by: {a, b}` |
| `:splitBy()` | no `by:` |
| no `:splitBy` | no `by:` (noted: classic returns one series per dimension combination) |
| `:avg` `:sum` `:min` `:max` `:count` | that aggregation |
| `:median` | `percentile(<key>, 50)` |
| `:percentile(90)` | `percentile(<key>, 90)` |
| `:auto`, `:value` | the key's default aggregation |
| `:filter(…)` | `filter: …` (see [Filters](#filters)) |
| `:sort(value(avg,descending))` | `\| sort arrayAvg(<field>) desc` (or `\| sort <field> desc` when folded) |
| `:sort(dimension("x",ascending))` | `\| sort x asc` |
| `:limit(n)` | `\| limit n` (the smallest limit wins when nested) |
| `:names` | always: `\| fieldsAdd entityName(dt.entity.x)` for every entity dimension |
| `:rate(1m)` | `<agg>(<key>, rate: 1m)` |
| `:default(0)` | `<agg>(<key>, default: 0)` |
| `:timeshift(-1d)` | `shift: -1d` |
| `:fold`, `:fold(avg)` | fold to one value per series (see [Folding](#folding-tables-top-lists-single-values)) |
| `:last` | fold with `arrayLast` |
| `:toUnit(MicroSecond,MilliSecond)` and other µs/ns/ms/s and byte/KB/MB/GB/KiB/MiB/GiB pairs | multiply by the factor |
| `:toUnit` (other units), `:setUnit` | dropped (noted): set the unit on the tile |
| `:parents`, `:smooth`, `:rollup`, `:partition`, `:delta`, … | dropped (noted, approximate) |
| `resolution=…&` prefix of `metricExpressions` | removed |

### Filters

| Classic filter | DQL condition |
| --- | --- |
| `eq("d","v")` / `ne("d","v")` | `d == "v"` / `d != "v"` |
| `prefix("d","v")` / `suffix` / `contains` | `startsWith(d, "v")` / `endsWith` / `contains` |
| `existsKey("d")` | `isNotNull(d)` |
| `in("d", entitySelector("type(HOST),tag(\"x\")"))` | `in(d, classicEntitySelector("type(HOST),tag(\"x\")"))` |
| `in("d", "a", "b")` | `in(d, array("a", "b"))` |
| `and(…)`, `or(…)`, `not(…)` | `(… and …)`, `(… or …)`, `not(…)` |
| `series(avg, gt(10))` (also `lt`, `ge`, `le`, `eq`, `ne`; `avg`, `max`, `min`, `sum`, `last`) | after the timeseries: `\| filter arrayAvg(<field>) > 10` |

Classic `~` escapes inside strings are resolved. [`classicEntitySelector()`](https://docs.dynatrace.com/docs/platform/grail/dynatrace-query-language/functions/general-functions) takes the classic entity selector unchanged, so tag, name, management zone and relationship selectors keep working.

### Arithmetic

Expressions between selectors and numbers (`+ - * /`, parentheses, unary minus) become one `timeseries` with one aggregation per operand and an element-wise expression:

- Operands with the same filters share `filter:`; operands with different filters get a per-aggregation `filter:` parameter.
- All operands are split by the union of their `:splitBy` dimensions (noted when they differ).
- Transformations after a parenthesised group (`(…):sort(…):limit(5)`) apply to the result.
- The result field is `value`; the operand fields are removed.
- Derived classic metrics (`builtin:service.errors.total.rate`, `…server.rate`) expand the same way: `failures[] / requests[] * 100`.

### Folding (tables, top lists, single values)

| Fold mode | Used for | DQL |
| --- | --- | --- |
| none | line, area and bar charts | the time series as is |
| per row | table, top list, pie, honeycomb, `:fold` | `\| fieldsAdd <field> = arrayX(<field>)`, then `\| fields <entity names>, <dimensions>, <field>` |
| single | single value | as per row, then `\| summarize <field> = X(<field>)` when split, else `\| fields <field>` |

`arrayX` is `arraySum` for a single counter metric (`sum` / `count` aggregation), `arrayMax` / `arrayMin` / `arrayLast` / `arrayMedian` for `:fold(max)` etc., and `arrayAvg` for gauges, ratios, derived metrics and arithmetic expressions.

### Worked examples

**Top hosts by CPU** (data explorer, graph):

```
builtin:host.cpu.usage:splitBy("dt.entity.host"):avg:sort(value(avg,descending)):limit(10)
```

```dql
timeseries cpu_usage = avg(dt.host.cpu.usage), by: {dt.entity.host}
| fieldsAdd entityName(dt.entity.host)
| sort arrayAvg(cpu_usage) desc
| limit 10
```

**Hosts with a tag, as a table:**

```
builtin:host.mem.usage:filter(in("dt.entity.host",entitySelector("type(HOST),tag(~"env:prod~")"))):splitBy("dt.entity.host"):avg:sort(value(avg,descending)):limit(20)
```

```dql
timeseries memory_usage = avg(dt.host.memory.usage), by: {dt.entity.host}, filter: in(dt.entity.host, classicEntitySelector("type(HOST),tag(\"env:prod\")"))
| fieldsAdd entityName(dt.entity.host)
| fieldsAdd memory_usage = arrayAvg(memory_usage)
| sort memory_usage desc
| limit 20
| fields dt.entity.host.name, dt.entity.host, memory_usage
```

**Failure ratio per service (expression, top list):**

```
(builtin:service.errors.total.count:splitBy("dt.entity.service"):sum / builtin:service.requestCount.total:splitBy("dt.entity.service"):sum * 100):sort(value(avg,descending)):limit(5)
```

```dql
timeseries {
    request_failure_count = sum(dt.service.request.failure_count),
    request_count = sum(dt.service.request.count)
  }, by: {dt.entity.service}
| fieldsAdd value = request_failure_count[] / request_count[] * 100
| fieldsRemove request_failure_count, request_count
| fieldsAdd entityName(dt.entity.service)
| fieldsAdd value = arrayAvg(value)
| sort value desc
| limit 5
| fields dt.entity.service.name, dt.entity.service, value
```

**Service failure rate (single value):**

```
builtin:service.errors.total.rate:splitBy():avg
```

```dql
timeseries {
    failures = sum(dt.service.request.failure_count),
    requests = sum(dt.service.request.count)
  }
| fieldsAdd error_rate = (failures[] / requests[] * 100)
| fieldsRemove failures, requests
| fieldsAdd error_rate = arrayAvg(error_rate)
| fields error_rate
```

## Data explorer and custom chart tiles without metricExpressions

When a tile has no `metricExpressions` (older exports), the selector is rebuilt first and then translated as above.

**Data explorer `queries[]`:** `metricSelector` (code mode) is used as is. Otherwise: `metric`, `filterBy` (dimension `EQ` / `NE` criteria → `eq` / `ne`; `TAG` → `entitySelector(type(X),tag(…))`; `NAME` → `entityName.equals(…)`; `ENTITY_ATTRIBUTE` → the attribute; nested filters with `AND` / `OR`), `splitBy`, `spaceAggregation` (`AVG`, `SUM`, `MIN`, `MAX`, `COUNT`, `MEDIAN`, `PERCENTILE_n`, `AUTO`, `VALUE`), `rate`, `sortBy` (`ASC` / `DESC`) and `limit`. Disabled queries (`enabled: false`) are skipped.

**Custom chart `series[]`:** `metric`, `aggregation` (`AVG`, `SUM`, `MIN`, `MAX`, `COUNT`, `MEDIAN`, `PERCENTILE` with `percentile`, `NONE`), dimensions (split, and `eq` filters for dimension values), sort column, and the entity filters of `filtersPerEntityType[entityType]`: `SPECIFIC_ENTITIES` → `entityId(…)`, `AUTO_TAGS` / `TAGS` → `tag(…)`. Other entity filters (host groups, data centers, …) are noted and not translated.

A tile with several queries becomes one DQL query per selector, combined with `| append [ … ]` (approximate).

## USQL

Reference: [USQL](https://docs.dynatrace.com/docs/observe/digital-experience-classic/rum-classic/session-segmentation/custom-queries-segmentation-and-aggregation-of-session-data), [new RUM](https://docs.dynatrace.com/docs/observe/digital-experience/rum). USQL reads classic RUM data; the translation reads new RUM data, so every USQL tile is at least approximate.

### Tables

| USQL | DQL |
| --- | --- |
| `FROM usersession` | `fetch user.sessions` |
| `FROM useraction` | `fetch user.events \| filter in(characteristics.classifier, array("user_action", "navigation", "user_interaction", "page_summary"))` |
| other tables | `fetch user.sessions` (manual, noted) |

### Fields

Session fields (`usersession`), verified against `user.sessions`:

| USQL | DQL |
| --- | --- |
| `userSessionId` | `dt.rum.session.id` |
| `internalUserId` | `dt.rum.instance.id` (browser instance, noted) |
| `startTime` / `endTime` | `start_time` / `end_time` |
| `duration` | `duration` (numbers compared with it get `ms`) |
| `userActionCount` | `user_action_count` |
| `totalErrorCount`, `errorCount` | `error.count` |
| `browserFamily`, `browserType` | `browser.name` |
| `browserMajorVersion` | `browser.version` |
| `osFamily` / `osVersion` | `os.name` / `os.version` |
| `deviceType` | `device.type` |
| `userType` | `dt.rum.user_type` (values lowercased: `'REAL_USER'` → `"real_user"`) |
| `hasSessionReplay` | `characteristics.has_replay` |
| `application`, `useraction.application` | `frontend.name` |
| `country` / `continent` / `region` / `city` | `geo.country.name` / `geo.continent.name` / `geo.region.name` / `geo.city.name` |
| `screenWidth` / `screenHeight` | `browser.window.width` / `browser.window.height` |
| `endReason` | `end_reason` (values lowercased) |

Action fields (`useraction`), against `user.events`:

| USQL | DQL |
| --- | --- |
| `name`, `useraction.name` | `page.name` (noted: `view.name` for single-page apps) |
| `application` | `frontend.name` |
| `duration`, `useraction.duration` | `duration` |
| `startTime`, `useraction.startTime` / `endTime` | `start_time` / `end_time` |
| `type` | `characteristics.classifier` |
| `usersession.browserFamily`, `.country`, `.userType`, `.deviceType`, `.osFamily`, `.city` | `browser.name`, `geo.country.name`, `dt.rum.user_type`, `device.type`, `os.name`, `geo.city.name` |

Unknown fields are kept as written and noted.

### Functions and clauses

| USQL | DQL |
| --- | --- |
| `COUNT(*)` | `count()` |
| `COUNT(DISTINCT x)` | `countDistinct(x)` |
| `COUNT(x)` | `countIf(isNotNull(x))` |
| `AVG`, `SUM`, `MIN`, `MAX` | `avg`, `sum`, `min`, `max` |
| `MEDIAN(x)` | `median(x)` |
| `PERCENTILE(x, n)` | `percentile(x, n)` |
| `TOP(x, n)` | groups by `x`, `\| sort <first aggregate> desc \| limit n` |
| `DATETIME(startTime, 'fmt', '5m')` | `bin(start_time, 5m)`; with count/avg/sum/min/max aggregates the query becomes `makeTimeseries …, time: start_time, interval: 5m` |
| `CONDITION(…)` | `countIf(…)` (noted) |
| `STARTSWITH(x, 'v')` / `ENDSWITH` | `startsWith(x, "v")` / `endsWith` |
| `FUNNEL(…)` | manual |
| `WHERE` `=`, `!=`, `<>`, `<`, `>`, `<=`, `>=` | `==`, `!=`, `!=`, `<`, `>`, `<=`, `>=` |
| `AND`, `OR`, `NOT` | `and`, `or`, `not(…)` |
| `x IN ('a','b')` / `NOT IN` | `in(x, array("a", "b"))` / `not(in(…))` |
| `x IS NULL` / `IS NOT NULL` | `isNull(x)` / `isNotNull(x)` |
| `x LIKE '%v%'` / `'v%'` / `'%v'` / `'v'` | `contains` / `startsWith` / `endsWith` / `==` |
| `GROUP BY` | `summarize {…}, by: {…}` |
| no aggregate | `fields …` |
| `AS alias` | the field name |
| `ORDER BY` (alias, select expression or field) `ASC/DESC` | `sort … asc/desc` |
| `LIMIT n` | `limit n` |

### Worked examples

```sql
SELECT country, COUNT(*) AS sessions, AVG(duration) FROM usersession
WHERE userType = 'REAL_USER' AND duration > 1000
GROUP BY country ORDER BY sessions DESC LIMIT 10
```

```dql
fetch user.sessions
| filter dt.rum.user_type == "real_user" and duration > 1000ms
| summarize {sessions = count(), avg_duration = avg(duration)}, by: {geo.country.name}
| sort sessions desc
| limit 10
```

```sql
SELECT DATETIME(startTime, 'yyyy-MM-dd HH:mm', '30m'), browserFamily, COUNT(*) FROM usersession
GROUP BY DATETIME(startTime, 'yyyy-MM-dd HH:mm', '30m'), browserFamily
```

```dql
fetch user.sessions
| makeTimeseries {count = count()}, by: {browser.name}, time: start_time, interval: 30m
```

## Log viewer queries

Term by term (approximate): `key="value"` → `key == "value"`, `key!="value"` → `!=`, values with `*` → `matchesValue(key, "…")`, `content="…"` and free text → `matchesPhrase(content, "…")`, `AND` / `OR` / `NOT` and parentheses kept, adjacent terms joined with `and`. The query ends with `| sort timestamp desc | limit 100`.

```
status="ERROR" AND "connection refused"
```

```dql
fetch logs
| filter status == "ERROR" and matchesPhrase(content, "connection refused")
| sort timestamp desc
| limit 100
```

## Built-in tiles

| Classic tile | DQL | Visualization |
| --- | --- | --- |
| `OPEN_PROBLEMS` | `fetch dt.davis.problems \| filter event.status == "ACTIVE" and not(dt.davis.is_duplicate) \| summarize problems = count()` | singleValue |
| `HOSTS` | Average `dt.host.cpu.usage` per host, folded | honeycomb |
| `HOST` | `dt.host.cpu.usage` of the assigned host | lineChart |
| `SERVICES` | Requests and failure rate per service (top 50) | table |
| `SERVICE_VERSATILE` | `dt.service.request.response_time` of the assigned service | lineChart |
| `APPLICATIONS`, `APPLICATION` | `fetch user.sessions \| summarize sessions = count(), by: {frontend.name}` (top 20) | categoricalBarChart |
| `UEM_ACTIVE_SESSIONS` | `sum(dt.frontend.session.active.estimated_count)` by `frontend.name` | lineChart |
| `SYNTHETIC_TESTS`, `SYNTHETIC_SINGLE_WEBCHECK` | `avg(dt.synthetic.browser.availability)` | lineChart |
| `SYNTHETIC_HTTP_MONITOR` | `avg(dt.synthetic.http.availability)` | lineChart |
| `DATABASES_OVERVIEW` | Response time of `serviceType(DATABASE_SERVICE)` services | lineChart |

The dashboard's management zone is not applied to built-in tiles (noted).

## Timeframes

| Classic | DQL |
| --- | --- |
| `-30m`, `-2h`, `-7d` (also `min`, `hours`, `days`) | `from: now()-30m` etc. |
| `-2w`, `-1month`, `-1q`, `-1y` | `from: now()-14d`, `now()-30d`, `now()-90d`, `now()-365d` |
| `today` / `yesterday` / `this week` | `from: now()@d` / `from: now()-1d@d, to: now()@d` / `from: now()@w` |
| `-2h to now`, `-2h to -1h` | `from: now()-2h` (`, to: now()-1h`) |

A **tile** timeframe is added to that tile's query (`timeseries …, from: …` or `fetch …, from: …`). The **dashboard** default timeframe is not written into queries; it is noted in the summary tile so you can set it on the new dashboard.

## Management zones

The dashboard's (or a tile's) management zone becomes, for every metric with an entity dimension (split dimension or the metric's own entity from the [table](#known-keys)):

```dql
filter: in(dt.entity.host, classicEntitySelector("type(HOST),mzName(\"Production\")"))
```

(`mzId(…)` when the JSON has only the ID.) Metrics without an entity dimension cannot be filtered this way (noted). Management zones are replaced by [segments](https://docs.dynatrace.com/docs/manage/segments) on the platform; see [Management zones](https://docs.dynatrace.com/docs/manage/identity-access-management-classic/permission-management/management-zones).

## Layout

See [Export: layout scaling](export.md#layout-scaling).
