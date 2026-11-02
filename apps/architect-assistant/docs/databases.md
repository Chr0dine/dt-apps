# Databases

The Databases tab compares two views of the same databases: databases that a Dynatrace database extension monitors (Smartscape DB instances in the Databases app, with statements, waits, locks and sessions) and database servers that OneAgent sees only as a process (CPU, memory, network, but no database insights). It counts both per technology (Microsoft SQL Server, Oracle Database, PostgreSQL, MySQL, MariaDB, IBM Db2, SAP HANA, MongoDB, Redis), matches DB instances to OneAgent processes by name and address, lists the extension state of each technology, and for a selected OneAgent-only database checks what is missing and can create the extension's monitoring configuration with the Extensions API.

| | |
| --- | --- |
| Area | Visibility (see [index](README.md)) |
| Tab id | `databases` |
| Counts toward Entity Overview readiness / Top findings | No. The tab has its own gauges; Entity Overview readiness and Top findings use only the shared coverage query and the frontends. |
| Main source files | [ui/app/tabs/DatabasesTab.tsx](../ui/app/tabs/DatabasesTab.tsx), [ui/app/databases.ts](../ui/app/databases.ts), [ui/app/queries.ts](../ui/app/queries.ts#L879) (database section), [ui/app/analyses.ts](../ui/app/analyses.ts#L547) (`analyzeDatabases`) |

## Contents

- [What this page answers](#what-this-page-answers)
- [Before you start](#before-you-start)
- [Page walkthrough](#page-walkthrough)
- [Checks and scoring](#checks-and-scoring)
- [Queries](#queries)
- [How DB instances and processes are matched](#how-db-instances-and-processes-are-matched)
- [API calls](#api-calls)
- [Remediation actions](#remediation-actions)
- [AI Assist on this page](#ai-assist-on-this-page)
- [Limitations and edge cases](#limitations-and-edge-cases)
- [Troubleshooting](#troubleshooting)
- [Related pages](#related-pages)
- [Source files](#source-files)

## What this page answers

- Which database technologies run in the environment, and how many databases of each?
- How many databases does a database extension monitor, and how many are seen only as a OneAgent process?
- Which database server processes have no extension (the gap list), and which DB instances have no OneAgent process behind them (remote or managed databases such as AWS RDS or Azure SQL, or hosts without OneAgent)?
- Is the extension for each technology active in the environment, and are its monitoring configurations running (status OK or IDLE)?
- For one OneAgent-only database: is the extension active, is there an ActiveGate group with the Extensions module, does a configuration already target this database, is the database in Kubernetes, are credentials in the vault? And what are the steps (or the API call) to monitor it?

Best practice checked: OneAgent does not deep monitor database servers. A database server gets database insights (statements, waits, locks, sessions, the Databases app) only from its database extension. Most database extensions run remotely on an ActiveGate group; Redis runs on the host's OneAgent; MongoDB runs either way. Dynatrace documentation cited by the tab (catalogue `DOC` in [ui/app/deepTech.ts](../ui/app/deepTech.ts)):

| Page | Used for |
| --- | --- |
| [Databases](https://docs.dynatrace.com/docs/observe/infrastructure-observability/databases) | overview, every technology |
| [Get started with Databases](https://docs.dynatrace.com/docs/observe/infrastructure-observability/databases/get-started) | Add DB Instance path |
| [SQL Server extension](https://docs.dynatrace.com/docs/observe/infrastructure-observability/databases/extensions/microsoft-sql-server-2) | SQL Server |
| [Microsoft SQL Server data source (endpoints, authentication, SSL)](https://docs.dynatrace.com/docs/ingest-from/extensions/develop-your-extensions/data-sources/sql/microsoft-sql-monitoring) | SQL Server, credential vault |
| [Microsoft SQL Server (local) extension](https://docs.dynatrace.com/docs/observe/infrastructure-observability/databases/extensions/microsoft-sql-server-local) | SQL Server |
| [PostgreSQL extension](https://docs.dynatrace.com/docs/observe/infrastructure-observability/databases/extensions/postgresdb-remote-monitoring) | PostgreSQL |
| [MySQL extension](https://docs.dynatrace.com/docs/observe/infrastructure-observability/databases/extensions/mysql-remote-monitoring-v2) | MySQL |
| [MariaDB extension](https://docs.dynatrace.com/docs/observe/infrastructure-observability/databases/extensions/mariadb-1) | MariaDB |
| [Oracle Database extension](https://docs.dynatrace.com/docs/observe/infrastructure-observability/databases/extensions/oracle-database) | Oracle |
| [IBM DB2 for LUW (remote monitoring) extension](https://docs.dynatrace.com/docs/observe/infrastructure-observability/databases/extensions/ibm-db2-for-luw-remote-monitoring) | Db2 |
| [SAP HANA Database (remote monitoring) extension](https://docs.dynatrace.com/docs/observe/infrastructure-observability/databases/extensions/sap-hana-database-remote-monitoring) | SAP HANA |
| [MongoDB extension](https://docs.dynatrace.com/docs/observe/infrastructure-observability/databases/extensions/mongodb-local-or-remote-monitoring) | MongoDB |
| [Redis extension](https://docs.dynatrace.com/docs/observe/infrastructure-observability/extensions/redis-20) | Redis |
| [ActiveGate group](https://docs.dynatrace.com/docs/ingest-from/dynatrace-activegate/activegate-group) | ActiveGate group, Kubernetes |
| [ActiveGate purposes and functionality](https://docs.dynatrace.com/docs/ingest-from/dynatrace-activegate/capabilities) | ActiveGate group, Kubernetes |
| [Credential vault](https://docs.dynatrace.com/docs/manage/credential-vault) | credentials |

### Technology catalogue

Every technology the tab knows, from `DB_MATCH` ([queries.ts](../ui/app/queries.ts#L906)) and `DB_TECHS` ([databases.ts](../ui/app/databases.ts#L50)):

| Key | Label | OneAgent `processType` | Server executable (`EXE_NAME`, lower case) | Extension | Hub name | Runs | Default port | API create | Local-extension name tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `MSSQL` | Microsoft SQL Server | `MSSQL` | `sqlservr`, `sqlservr.exe` | `com.dynatrace.extension.sql-server` | Microsoft SQL Server | ActiveGate group | 1433 | yes | `sql-server`, `mssql` |
| `MARIADB` | MariaDB | (none) | `mariadbd`, `mariadbd.exe`; or `mysqld` / `mysqld.exe` / type `MYSQL` with `mariadb` in `EXE_PATH` | `com.dynatrace.extension.mariadb` | MariaDB | ActiveGate group | 3306 | no | `mariadb` |
| `MYSQL` | MySQL | `MYSQL` | `mysqld`, `mysqld.exe` | `com.dynatrace.extension.mysql` | MySQL | ActiveGate group | 3306 | yes | `mysql` |
| `POSTGRES` | PostgreSQL | `POSTGRES` | `postgres`, `postgres.exe` | `com.dynatrace.extension.postgres` | PostgreSQL | ActiveGate group | 5432 | yes (database `postgres` prefilled) | `postgres` |
| `ORACLE` | Oracle Database | (none) | `oracle`, `oracle.exe` | `com.dynatrace.extension.sql-oracle` | Oracle Database | ActiveGate group | 1521 | yes | `sql-oracle` |
| `DB2` | IBM Db2 | (none) | `db2sysc`, `db2syscs.exe` | `com.dynatrace.extension.sql-db2` | IBM DB2 | ActiveGate group | 50000 | yes | `db2` |
| `HANA` | SAP HANA | (none) | `hdbnameserver` | `com.dynatrace.extension.sql-sap-hana` | SAP HANA | ActiveGate group | 30015 (prefers a listen port matching `3<nn>15` / `3<nn>13`) | yes | `hana` |
| `MONGODB` | MongoDB | `MONGODB` | `mongod`, `mongod.exe` | `com.dynatrace.extension.mongodb` | MongoDB | OneAgent or ActiveGate | 27017 | no | `mongodb` |
| `REDIS` | Redis (Valkey counted as Redis) | `REDIS` | `redis-server`, `valkey-server` | `com.dynatrace.extension.redis` | Redis | OneAgent (host) | 6379 | no | `redis`, `valkey` |

MariaDB is tested before MySQL because OneAgent types both as `MYSQL`. A DB instance type that is not in this list (`DB_INSTANCE_<OTHER>`) gets a generic entry: the label is the suffix in title case, no extension, "ActiveGate group", no API action ([`dbTechInfo`](../ui/app/databases.ts#L377)).

## Before you start

### App scopes used by this page

From [app.config.json](../app.config.json) and the code:

| Scope | What this page uses it for |
| --- | --- |
| `storage:entities:read` | `fetch dt.entity.process_group_instance` and `fetch dt.entity.host` in the process queries. |
| `storage:smartscape:read` | `smartscapeNodes "DB_INSTANCE_*"`, `smartscapeNodes "PROCESS"` (Smartscape ID of a process for its link) and `smartscapeNodes "ACTIVEGATE"`. |
| `storage:metrics:read` | `timeseries ... dt.sfm.extension.status` and `fetch metric.series` (local extensions per host). |
| `extensions:definitions:read` | Whether each database extension is active (`environment-configuration`), its uploaded versions, and the active version's monitoring configuration schema. |
| `extensions:configurations:read` | List a database extension's monitoring configurations and their statuses (diagnosis check, Validate, Create). |
| `extensions:configurations:write` | Create the monitoring configuration (remediation). |
| `environment-api:credentials:read` | List User and password credentials with the Extension authentication scope (names and IDs only) for the form's credential picker. |

Opening a query in Notebooks or Dashboards and the links to other apps use intents and app links; they need no scope (the user needs access to those apps). The docs-freshness line calls the app's `docs-freshness` function.

### User permissions

The app's scopes are intersected with the signed-in user's permissions, so the user also needs:

- Grail read access to entities, Smartscape and metrics (for example `storage:entities:read`, `storage:smartscape:read`, `storage:metrics:read`, plus bucket access for the metrics).
- Extensions permissions: read extension definitions and configurations to see the "In this environment" column and the diagnosis; write configurations to create one. A 403 on any Extensions API call is shown as "Access denied (HTTP 403): the app needs the scope <scope> and you need the matching permission."
- Credential vault read access for the credential picker. Credentials marked *owner only* are listed with "(owner only)"; only their owner can use them in a configuration.
- Adding an extension from Dynatrace Hub needs the Change monitoring settings permission (stated in the check text and the manual step); the app itself never installs or activates extensions.

### One-time setup

- **ActiveGate group (remote extensions)**: an environment ActiveGate with the Extensions module (`EXTENSION_CONTROLLER`) in a named group whose members can all reach the database host and port. See [Prepare an ActiveGate group](#manual-prepare-an-activegate-group-for-remote-extensions).
- **Extension in the environment**: the technology's extension added from Dynatrace Hub and a version active.
- **Monitoring user** in the database (SQL or `mongosh` scripts under [Create the monitoring user](#manual-create-the-technology-monitoring-user)).
- **Credential vault** (optional): a User and password credential with the scope Extension authentication.
- **Outbound connections** (optional): docs.dynatrace.com in the allowed outbound connections, for the automatic docs check of the remediation links.

No OAuth client or API token is needed.

## Page walkthrough

The tab renders, top to bottom: the AI Assist panel (when on), the heading and intro, the summary card, the slice notice, OneAgent database processes, DB instances monitored by an extension, Database extensions, a Re-check button, and Remediation actions. All four card queries plus the ActiveGate group query run when the tab is rendered and again when the timeframe changes (24 hours, 7 days, 30 days, from the header).

### Heading and intro

"Databases" plus a paragraph: databases monitored by a Dynatrace database extension versus database servers seen only by OneAgent, per technology, read from Smartscape DB instances, OneAgent process instances, extension self-monitoring and the Extensions API.

### Summary card: gauges and "Databases by technology"

Source: [summary query](#1-databases-extension-vs-oneagent-only-by-technology-dbsummaryquery) (bar chart and gauge 1) and [processes query](#2-oneagent-database-processes-and-their-extension-dbprocessesquery) (gauge 2). While the summary query loads the card shows "Loading…"; on error "Query failed" with the message.

A "database" in the summary is one DB instance (whether or not it matches processes) or one OneAgent database process that matches no DB instance. A process that matches a DB instance is counted once, through the DB instance. Categories (`CATEGORIES` in [databases.ts](../ui/app/databases.ts#L386)):

| Category | Label | Colour (light / dark) | Meaning |
| --- | --- | --- | --- |
| `BOTH` | Extension + OneAgent | blue `#2a78d6` / `#3987e5` | A DB instance that matches at least one OneAgent process, or a process with no matching DB instance whose host reports a local extension of the same technology. |
| `EXTENSION_ONLY` | Extension only | aqua `#1baf7a` / `#199e70` | A DB instance that matches no OneAgent process (remote or managed database, or a host without OneAgent). |
| `ONEAGENT_ONLY` | OneAgent only | orange `#eb6834` / `#d95926` | A OneAgent process with no matching DB instance and no local extension on its host. |

**Gauge "Databases with an extension"** (custom SVG `PctGauge`, red-to-green, rounded integer percent): numerator `BOTH + EXTENSION_ONLY`, denominator all databases, summed over every technology of the summary query. `Math.round(100 × part / total)`; 0 when there are no databases. Detail line: "<part> of <total>". The (i) button scrolls to Remediation actions.

**Gauge "OneAgent databases with an extension"**: numerator the rows of the processes table whose coverage is not `ONEAGENT_ONLY` (a matching DB instance or a local extension), denominator all rows of the processes table (the query returns at most 500). 100 when there are no process rows. Detail line: "<part> of <n> server process(es)", or "…" while the processes query has not returned. The (i) button scrolls to Remediation actions.

**Chart "Databases by technology"** (custom stacked bars, `TechStackChart`):

- Legend: the three categories with their total over all technologies; hovering a legend item shows the category meaning.
- One row per technology, sorted by total descending, then by label. Left: the label (150 px, truncated with ellipsis, full label on hover). Right: the total.
- The bar's length is `max(4 %, 100 × total / largest total)` of the row width; inside it the segments for `BOTH`, `EXTENSION_ONLY`, `ONEAGENT_ONLY` in that order, only those with a count, each as wide as its share (minimum 6 px, 2 px gaps).
- Hover a segment: technology, "<category>: <n> of <total> (<pct>%)", and "Click to filter the tables below" (or "Click to show all" on the selected segment).
- Click a segment: filters the processes and DB instances tables to that technology and category; the other segments fade to 40 % opacity. Click it again to clear. A line "Tables filtered to <technology> · <category>." with a **Show all** button appears under the card. Changing the timeframe clears the filter.
- No rows: "No databases found for this timeframe."

What a slice does to each table:

| Slice category | OneAgent database processes | DB instances monitored by an extension |
| --- | --- | --- |
| Extension + OneAgent | processes of that technology whose coverage is a DB instance or a local extension | DB instances of that technology that match a process |
| Extension only | none ("No processes match these filters.") | DB instances of that technology with no process |
| OneAgent only | processes of that technology with coverage OneAgent only | none ("OneAgent-only databases have no DB instance.") |

The technology of a process is its own (for example MariaDB) and the technology of a DB instance is its type suffix, so a MariaDB process matched by a `DB_INSTANCE_MYSQL` instance is counted under MySQL in the chart but listed as MariaDB in the processes table.

Under the card: **Show DQL / Copy / Open in Notebook / Add to Dashboard** for the summary query (title "Databases: extension vs OneAgent only, by technology").

### OneAgent database processes

Source: [processes query](#2-oneagent-database-processes-and-their-extension-dbprocessesquery). Every database server process OneAgent sees (up to 500), with what covers it. Loading / error as above.

Filters (client-side, combined with the slice):

| Control | Options | Effect |
| --- | --- | --- |
| Technology | All technologies; each technology present in the rows (sorted by key, shown by label) | `p.tech == <key>` |
| Monitored by | Any; OneAgent only; An extension | OneAgent only: coverage `ONEAGENT_ONLY`. An extension: coverage `EXTENSION` or `LOCAL_EXTENSION`. |

Next to the filters: "<n> processes" and, with a slice, "in <technology> · <category>".

Columns (all sortable except Links and Remediation; default order is the query's: coverage descending, so OneAgent only first, then Local extension, then Extension; then technology, then name):

| Column | Content | Source field |
| --- | --- | --- |
| Process | process instance name | `entity.name` |
| Technology | technology label | `dbTech` |
| Monitored by | "✓ Extension (DB instance)" / "✓ Local extension on the host" in green, "✕ OneAgent only" in red. Hover: "Matched on <keys>" for a DB instance, the local extension's name, or the OneAgent-only explanation. | `coverage`, `matchedOn`, `localExtension` |
| DB instance / extension | names of the matching DB instances, else the local extension name, else "—" | `instances`, `localExtension` |
| Host | host name | `hostName` (lookup of `dt.entity.host`) |
| Kubernetes | "<namespace> / <pod or workload>", or "—" | `namespace`, `pod`, `workload` (process metadata) |
| Listen ports | comma-separated | `listenPorts` |
| Links | **Process ↗** (Infrastructure & Operations, intent `view_smartscape_process` with the Smartscape process ID, only when it was found), **Host ↗** (intent `view_host` with the classic host ID), **DB instance ↗** (one per matching instance, numbered when several; Databases app intent `view-instance-details` with `dt.smartscape.db_instance_id`). Process and Host links carry the selected timeframe as `dt.timeframe`. | `sid`, `host`, `instanceIds` |
| Remediation | **Configure** (emphasized) on OneAgent-only rows, **Details** on covered rows, **Selected** on the selected row. Selecting scrolls to Remediation actions and diagnoses the process. | `id` |

Paging: 25 rows per page by default, 50 or 100 selectable. Empty: "No processes match these filters." when rows exist but none pass the filters, else "OneAgent sees no database server process in this timeframe."

Query actions: title "Databases: OneAgent database processes and their extension".

### DB instances monitored by an extension

Source: [instances query](#3-db-instances-monitored-by-extensions-dbinstancesquery). Every Smartscape DB instance (up to 500), with the OneAgent processes it matches. No own filters; the slice applies.

| Column | Content | Source field |
| --- | --- | --- |
| DB instance | name, linked "↗" to the DB instance in the Databases app (intent `dynatrace.database.overview` / `view-instance-details`) | `name`, `id` |
| Technology | label of the type suffix | `dbTech` (`substring(type, from:12)`) |
| Version | database version reported | `db.instance.version` |
| Endpoint | "<connection host>:<port>" | `db.connection_details.hostname`, `db.connection_details.port` |
| Server name | the name the database reports (for example SQL Server's `@@SERVERNAME`) | `host.name` |
| OneAgent process | names of the matching processes (hover: "Matched on <keys>"), or "None seen (remote / managed)" | `processes`, `matchedOn` |
| Kubernetes cluster | cluster name on the DB instance | `k8s.cluster.name` |

Default order: coverage descending (`EXTENSION_ONLY` before `BOTH`), technology, name. Paging 25 / 50 / 100. Empty: "OneAgent-only databases have no DB instance." with a OneAgent-only slice, else "No DB instance from a database extension in this timeframe." The query also returns `classicId`, `endpointIp`, `processIds` and `lastSeen`, which the table does not show.

Query actions: title "Databases: DB instances monitored by extensions".

### Database extensions

One row per technology of the summary chart (same order). Wrapped in the state of the [extension status query](#4-database-extension-configurations-by-status-dbextensionstatusquery) (Loading / Query failed).

| Column | Content | Source |
| --- | --- | --- |
| Technology | label | summary query |
| Extension | Hub name (hover: extension ID); "—" when there is none | catalogue |
| In this environment | "Checking…" while loading; "Active · <version>" (green); "Installed, not active" (red); "Not in the environment" (red); "Not readable" when the API call failed (hover: the error) | [`readExtensionEnv`](#get-environment-configuration) |
| Configurations | "None reporting" when no status series exists; else "<configs> · all OK" (green) or "<configs> · <n> not OK (<statuses>)" (red), where not OK means the latest status is neither OK nor IDLE | status query, row whose `extension` equals the catalogue's extension ID |
| Runs on | "ActiveGate group" (remote), "OneAgent (host)" (local), "OneAgent or ActiveGate" (both) | catalogue |
| OneAgent only | `ONEAGENT_ONLY` count of the technology, red and bold when above 0 | summary query |
| Links | **Extensions app ↗** (intent `dynatrace.extensions.manager` / `go-to-extensions-manager-from-hub` with `extensionName`, `isInstalled: true`) when the extension is installed (active or not); otherwise **Dynatrace Hub ↗** (intent `dynatrace.hub` / `search_in_catalog` with `searchTerm` = Hub name) | |

Sortable, no paging. Empty: "No database technologies found." Query actions: title "Databases: database extension configurations by status".

### Re-check

The **Re-check** button re-runs the summary, processes, instances and extension status queries (it appends a DQL comment line `// refresh <n>` so the query text changes and the SDK hook runs it again) and re-reads the "In this environment" state of every extension. The ActiveGate group query is not re-run. Re-check runs automatically after a monitoring configuration was created.

### Remediation actions section

Anchor `remediation-databases`. Heading "Remediation actions" and a docs status line: "Guidance reviewed against the Dynatrace docs on <date>." followed by the result of the docs-freshness check ("No cited page has changed since.", "<n> cited pages changed since; the fixes that cite them are marked.", a notice to allow docs.dynatrace.com in the outbound connections with a link to that setting, or the error with **Retry**).

- **Nothing selected**: "How a database gets its extension. Select Configure on a OneAgent-only database above for checks and steps filled in for it." and an **Action** dropdown with three manual actions: *Monitor a database with its extension*, *Prepare an ActiveGate group for remote extensions*, *Store the monitoring user in the credential vault*.
- **A process selected** (Configure or Details): "What <process> needs for its <extension> extension (extension, ActiveGate group, existing configurations, credentials), the monitoring user, and the configuration itself.", a **Clear selection** button, a header line (process name; technology · host · namespace/pod · ports; Process and Host links), the [check list](#diagnosis-checks) and the **Action** dropdown grouped by severity. Details in [Remediation actions](#remediation-actions).

If the selected process disappears from the data (timeframe change, Re-check), the section falls back to the nothing-selected view.

## Checks and scoring

| Name | In place when | Numerator | Denominator | Severity / thresholds | Notes |
| --- | --- | --- | --- | --- | --- |
| Databases with an extension (gauge) | category `BOTH` or `EXTENSION_ONLY` | `BOTH + EXTENSION_ONLY` | all databases of the summary | gauge colour red-to-green by percent | 0 % when no databases |
| OneAgent databases with an extension (gauge) | process coverage `EXTENSION` or `LOCAL_EXTENSION` | covered rows of the processes query | all rows of the processes query (max 500) | gauge colour | 100 % when no processes |
| Category `BOTH` | DB instance with ≥ 1 matching process; or unmatched process with a local extension of its technology on its host | | | | see [matching](#how-db-instances-and-processes-are-matched) |
| Category `EXTENSION_ONLY` | DB instance with no matching process | | | | |
| Category `ONEAGENT_ONLY` | process with no matching DB instance and no local extension | | | | |
| Process coverage `EXTENSION` | ≥ 1 matching DB instance | | | green | takes precedence over a local extension |
| Process coverage `LOCAL_EXTENSION` | no DB instance, local extension on the host | | | green | |
| Process coverage `ONEAGENT_ONLY` | neither | | | red | |
| Extension in the environment | `environment-configuration` returns a version | | | Active (green) / Installed, not active (red) / Not in the environment (red) / Not readable | |
| Configurations OK | latest status per configuration (and host) is `OK` or `IDLE` | configurations with such a status | distinct configuration IDs reporting | any other status → "not OK" (red) | a local configuration counts as OK when any of its hosts is OK |
| ActiveGate group online | an ActiveGate of the group with the Extensions module was seen in the last 20 minutes (`AG_OFFLINE_MINUTES`) | `online` | `activeGates` | groups with `online = 0` are not offered | |

### Diagnosis checks

Computed by [`diagnoseDbProcess`](../ui/app/databases.ts#L844) when a process is selected. Status labels: `fail` = **Blocking** (red), `warn` = **Check** (amber), `pass` = **OK** (green), `info` = **Info** (grey). Shown sorted Blocking, Check, OK, Info. A check is left out while its API read is still loading.

| Check id | Title | Status rule | Detail shown | Applies to |
| --- | --- | --- | --- | --- |
| `coverage` | "Monitored by <Hub name>" | pass when coverage `EXTENSION` | "DB instance <names> (matched on <keys>)." | all |
| `coverage` | "A local extension runs on the host" | pass when coverage `LOCAL_EXTENSION` | "<extension> reports from <host>." | all |
| `coverage` | "OneAgent only" | warn when coverage `ONEAGENT_ONLY` | the OneAgent-only category explanation | all |
| `extension` | "<Hub name> <version> is active" | pass: active version | "<extension ID> is in the environment; add a monitoring configuration for this database." | all |
| `extension` | "<Hub name> is installed but not active" | fail: versions uploaded, none active | "Versions <list> are uploaded; activate one in the Extensions app." | all |
| `extension` | "<Hub name> is not in the environment" | fail: 404 on both reads | "Add the <Hub name> extension from Dynatrace Hub (needs the Change monitoring settings permission)." | all |
| `extension` | "Extension not checked" | info: the read failed | the error | all |
| `group` | "<n> ActiveGate group(s) can run it" | pass: at least one group with `online > 0` | "<group> (<online>/<total>), …: online ActiveGates with the Extensions module. Every ActiveGate in the chosen group must reach the database." | runs remote or both |
| `group` | "No ActiveGate group with the Extensions module" | fail (remote), warn (MongoDB, both) | "Remote extensions run on an ActiveGate group; none has an online ActiveGate with the Extensions module." | runs remote or both |
| `oneagent` | "OneAgent on the database host" | pass when the host has a monitoring mode, else info | "<host> runs OneAgent in <Full-Stack / Infrastructure / Discovery> mode, so a local configuration (host scope) can run there." | runs local or both (Redis, MongoDB) |
| `configs` | "A configuration already targets this database" | warn: a configuration of the extension has an endpoint whose host is one of the process's names (pod, workload, workload.namespace, host name, its first label, host IPs, the endpoint options such as the service DNS name) and whose port is the [expected port](#form-fields) (or either side has no port) | "“<description or object ID>” (<scope>, status <status>, disabled): it produces no DB instance for this process, so fix it (endpoint, credentials, ActiveGate reach) instead of adding another." | all |
| `configs` | "No configuration targets this database yet" | pass | "None of the <n> configurations of <Hub name> has an endpoint on this pod, workload, host or IP." | all |
| `configs` | "Existing configurations not checked" | info: the read failed | the error | all |
| `k8s` | "Runs in Kubernetes" | info when the process has a namespace | "Pod <pod> in namespace <ns>. Cluster DNS names resolve only for an ActiveGate in the cluster; from outside, expose the database (LoadBalancer or NodePort) and use that address." | not local |
| `vault` | "<n> credential(s) for extensions in the credential vault" / "No extension credential in the credential vault" | info | pick the credential in the form or enter user and password / store the user as a User and password credential with the Extension authentication scope | not local |

The titles of all Blocking checks are passed to AI Assist as the selection's blockers.

### Action severity

Each action in the dropdown is grouped under the most severe of the checks it addresses (`ADDRESSES` in [DatabasesTab.tsx](../ui/app/tabs/DatabasesTab.tsx#L770)); a passed check does not count. Groups in order: **Blocking**, **Check**, **Info**, **More steps** (no failing check). Options are prefixed "API · " or "Manual · ". The first action after sorting is preselected.

| Action id | Addresses checks |
| --- | --- |
| `api-create` | `coverage` (so it is under Check for a OneAgent-only process) |
| `configure` | `extension`, `configs` |
| `ag-group` | `group` |
| `vault` | `vault` |
| `k8s` | `k8s` |
| `user` | none (always More steps) |

## Queries

| # | Name (function) | Runs when | Feeds |
| --- | --- | --- | --- |
| 1 | `dbSummaryQuery` | tab render, timeframe change, Re-check | gauge 1, chart, Database extensions rows, AI Assist |
| 2 | `dbProcessesQuery` | tab render, timeframe change, Re-check | gauge 2, OneAgent database processes, remediation selection |
| 3 | `dbInstancesQuery` | tab render, timeframe change, Re-check | DB instances monitored by an extension |
| 4 | `dbExtensionStatusQuery` | tab render, timeframe change, Re-check | Database extensions (Configurations column), AI Assist |
| 5 | `dbAgGroupsQuery` | tab render, timeframe change (not Re-check) | diagnosis `group` check, form's ActiveGate group list, Validate |

All five run in the browser through the `useDql` wrapper ([ui/app/useDql.ts](../ui/app/useDql.ts)) around `@dynatrace-sdk/react-hooks`; a query re-runs when its text changes. Queries 1–4 are exposed with Show DQL / Copy / Open in Notebook (intent `dynatrace.notebooks` / `view-query`) / Add to Dashboard (intent `dynatrace.dashboards` / `add-to-dashboard`); the copied text never contains the Re-check comment. Query 5 has no query actions.

Timeframe: the texts below are for the default 24 hours. For 7 days every `from:now()-24h` becomes `from:now()-7d`. For 30 days every `from:now()-24h` becomes `from:now()-30d`, except the `fetch metric.series` subqueries (local extensions), which become `from:now()-10d` because `metric.series` accepts only the last 10 days. After Re-check number *n*, the executed text ends with an extra line `// refresh <n>`.

Building blocks shared by queries 1–3 (text generated from `queries.ts`):

- **Process prefilter** (`dbProcessBase`): an `id in [subquery]` that keeps process instances whose `processType` is not an application runtime (`JAVA`, `TOMCAT`, …, `APMNG`) and that have a database `processType` or a database executable. The comment in the code: filtering the whole process table in the same pipeline as `expand` and a lookup took 6–11 s over 30 days, 1.7 s this way; the one short test keeps the summary query under DQL's 1000-expression limit.
- **Metadata extraction** (`metaFields`): `metadata` is an array of `KEY:value` strings. `if(startsWith(metadata[], "EXE_NAME:"), substring(metadata[], from:9))` is an iterative expression over the array (one element or null per entry); it must be stored in a field before `arrayRemoveNulls()` accepts it, then `arrayFirst()` keeps the value. Used for `EXE_NAME`, `EXE_PATH`, `KUBERNETES_FULL_POD_NAME`, `KUBERNETES_BASE_POD_NAME`, `KUBERNETES_NAMESPACE`, `KUBERNETES_CLUSTER_ID`, `CONTAINER_NAME`.
- **Technology** (`dbTech`): a nested `if` chain in `DB_MATCH` order (SQL Server, MariaDB, MySQL, PostgreSQL, Oracle, Db2, SAP HANA, MongoDB, Redis). MariaDB: `mariadbd`, or a MySQL type / `mysqld` executable whose lower-case `EXE_PATH` contains `mariadb` (`coalesce(…, false)` so a missing path does not end the chain with null). Processes without a technology are dropped.
- **Workload**: the base pod name without a trailing `-*`.
- **Host lookup**: `entity.name`, `ipAddress`, `monitoringMode`, `hostGroupName`, `osType` from `dt.entity.host`.
- **Process keys** (`dbProcessKeys`) and **instance keys** (`dbInstanceKeys`): see [How DB instances and processes are matched](#how-db-instances-and-processes-are-matched).
- **Local extensions** (`localExtensions`): `fetch metric.series` for `dt.sfm.extension.status` series that carry `dt.entity.host`, collected per host.

### 1. Databases: extension vs OneAgent only, by technology (`dbSummaryQuery`)

- **Source:** [`dbSummaryQuery`](../ui/app/queries.ts#L1035)
- **Runs:** on tab render; re-runs on timeframe change and Re-check.
- **Parameters:** timeframe only.
- **Query:**

```dql
fetch dt.entity.process_group_instance, from:now()-24h
| filter id in [fetch dt.entity.process_group_instance, from:now()-24h
    | filter isNull(processType) or not in(processType, array("JAVA", "TOMCAT", "JBOSS", "WEBLOGIC", "WEBSPHERE", "GLASSFISH", "DOTNET", "IIS", "IIS_APP_POOL", "NODE_JS", "GO", "PHP", "PYTHON", "APACHE_HTTPD", "NGINX", "RUBY", "ERLANG", "ENVOY", "HAPROXY", "IBM_CICS_REGION", "APMNG"))
    | fieldsAdd exeAll = if(startsWith(metadata[], "EXE_NAME:"), substring(metadata[], from:9))
    | fieldsAdd exe = arrayFirst(arrayRemoveNulls(exeAll))
    | fieldsRemove exeAll
    | filter in(processType, array("MSSQL", "MYSQL", "POSTGRES", "MONGODB", "REDIS")) or in(lower(exe), array("sqlservr", "sqlservr.exe", "mariadbd", "mariadbd.exe", "mysqld", "mysqld.exe", "postgres", "postgres.exe", "oracle", "oracle.exe", "db2sysc", "db2syscs.exe", "hdbnameserver", "mongod", "mongod.exe", "redis-server", "valkey-server"))
    | fields id]
| fieldsAdd exeAll = if(startsWith(metadata[], "EXE_NAME:"), substring(metadata[], from:9)),
    exePathAll = if(startsWith(metadata[], "EXE_PATH:"), substring(metadata[], from:9))
| fieldsAdd exe = arrayFirst(arrayRemoveNulls(exeAll)), exePath = arrayFirst(arrayRemoveNulls(exePathAll))
| fieldsRemove exeAll, exePathAll
| fieldsAdd exe = lower(exe), exePath = lower(exePath)
| fieldsAdd dbTech = if(in(processType, array("MSSQL")) or in(exe, array("sqlservr", "sqlservr.exe")), "MSSQL",
      else: if(in(exe, array("mariadbd", "mariadbd.exe")) or ((in(processType, array("MYSQL")) or in(exe, array("mysqld", "mysqld.exe"))) and coalesce(contains(exePath, "mariadb"), false)), "MARIADB",
      else: if(in(processType, array("MYSQL")) or in(exe, array("mysqld", "mysqld.exe")), "MYSQL",
      else: if(in(processType, array("POSTGRES")) or in(exe, array("postgres", "postgres.exe")), "POSTGRES",
      else: if(in(exe, array("oracle", "oracle.exe")), "ORACLE",
      else: if(in(exe, array("db2sysc", "db2syscs.exe")), "DB2",
      else: if(in(exe, array("hdbnameserver")), "HANA",
      else: if(in(processType, array("MONGODB")) or in(exe, array("mongod", "mongod.exe")), "MONGODB",
      else: if(in(processType, array("REDIS")) or in(exe, array("redis-server", "valkey-server")), "REDIS")))))))))
| filter isNotNull(dbTech)
| fieldsAdd podAll = if(startsWith(metadata[], "KUBERNETES_FULL_POD_NAME:"), substring(metadata[], from:25)),
    basePodAll = if(startsWith(metadata[], "KUBERNETES_BASE_POD_NAME:"), substring(metadata[], from:25)),
    namespaceAll = if(startsWith(metadata[], "KUBERNETES_NAMESPACE:"), substring(metadata[], from:21)),
    k8sClusterIdAll = if(startsWith(metadata[], "KUBERNETES_CLUSTER_ID:"), substring(metadata[], from:22)),
    containerAll = if(startsWith(metadata[], "CONTAINER_NAME:"), substring(metadata[], from:15))
| fieldsAdd pod = arrayFirst(arrayRemoveNulls(podAll)), basePod = arrayFirst(arrayRemoveNulls(basePodAll)), namespace = arrayFirst(arrayRemoveNulls(namespaceAll)), k8sClusterId = arrayFirst(arrayRemoveNulls(k8sClusterIdAll)), container = arrayFirst(arrayRemoveNulls(containerAll))
| fieldsRemove podAll, basePodAll, namespaceAll, k8sClusterIdAll, containerAll
| fieldsAdd host = belongs_to[dt.entity.host], pg = instance_of[dt.entity.process_group],
    workload = if(endsWith(basePod, "-*"), substring(basePod, to:stringLength(basePod) - 2), else: basePod)
| lookup [fetch dt.entity.host, from:now()-24h | fields id, hostName = entity.name, ipAddress, monitoringMode, hostGroup = hostGroupName, osType], sourceField:host, lookupField:id, fields:{hostName, ipAddress, monitoringMode, hostGroup, osType}
| fieldsAdd addrs = arrayConcat(array(lower(pod), lower(hostName), if(isNull(toIp(hostName)), lower(splitString(hostName, ".")[0])), lower(workload),
    if(isNotNull(workload) and isNotNull(namespace), lower(concat(workload, ".", namespace))), lower(container), concat("#", id)), coalesce(ipAddress, array()))
| expand v = addrs
| filter isNotNull(v)
| dedup id, v
| fields key = concat(if(dbTech == "MARIADB", "MYSQL", else: dbTech), "|", v), v, pgi = id, pgiName = entity.name, listenPorts, dbTech, host
| join [smartscapeNodes "DB_INSTANCE_*", from:now()-24h
    | fieldsAdd dbTech = substring(type, from:12), server = lower(host.name), endpoint = lower(db.connection_details.hostname), dbPort = toString(db.connection_details.port)
    | fieldsAdd serverParts = if(isNull(toIp(server)), splitString(server, ".")), endpointParts = if(isNull(toIp(endpoint)), splitString(endpoint, "."))
    | fieldsAdd k = arrayRemoveNulls(array(
        if(isNotNull(server), record(v = server, via = "server")),
        if(arraySize(serverParts) > 1, record(v = serverParts[0], via = "server")),
        if(isNotNull(endpoint), record(v = endpoint, via = "endpoint")),
        if(arraySize(endpointParts) > 1, record(v = endpointParts[0], via = "endpoint")),
        if(arraySize(endpointParts) > 2, record(v = concat(endpointParts[0], ".", endpointParts[1]), via = "endpoint")),
        if(isNotNull(db.connection_details.ip), record(v = toString(db.connection_details.ip), via = "endpoint")),
        record(v = concat("#", toString(id)), via = "none")))
    | expand k
    | fields key = concat(if(dbTech == "MARIADB", "MYSQL", else: dbTech), "|", k[v]), via = k[via], dbId = id, dbName = name, dbPort, dbTech
  ], kind:outer, on:{left[key] == right[key]}, fields:{dbId, via, dbPort, instanceTech = dbTech}
| fieldsAdd ok = isNotNull(pgi) and isNotNull(dbId) and (via == "server" or arraySize(coalesce(listenPorts, array())) == 0 or in(dbPort, listenPorts))
| fieldsAdd sides = array(record(side = "instance", id = dbId, tech = instanceTech), record(side = "process", id = pgi, tech = dbTech, host = host))
| expand s = sides
| filter isNotNull(s[id])
| summarize matches = countIf(ok), by:{side = s[side], id = s[id], dbTech = s[tech], host = s[host]}
| filter side == "instance" or matches == 0
| lookup [fetch metric.series, from:now()-24h
    | filter metric.key == "dt.sfm.extension.status" and isNotNull(dt.entity.host)
    | summarize localExtensions = collectDistinct(dt.extension.name), by:{dt.entity.host}], sourceField:host, lookupField:dt.entity.host, fields:{localExtensions}
| fieldsAdd localMatches = if((dbTech == "MSSQL" and (contains(localExtensions[], "sql-server") or contains(localExtensions[], "mssql")))
      or (dbTech == "MARIADB" and (contains(localExtensions[], "mariadb")))
      or (dbTech == "MYSQL" and (contains(localExtensions[], "mysql")))
      or (dbTech == "POSTGRES" and (contains(localExtensions[], "postgres")))
      or (dbTech == "ORACLE" and (contains(localExtensions[], "sql-oracle")))
      or (dbTech == "DB2" and (contains(localExtensions[], "db2")))
      or (dbTech == "HANA" and (contains(localExtensions[], "hana")))
      or (dbTech == "MONGODB" and (contains(localExtensions[], "mongodb")))
      or (dbTech == "REDIS" and (contains(localExtensions[], "redis") or contains(localExtensions[], "valkey"))), localExtensions[])
| fieldsAdd category = if(side == "instance", if(matches > 0, "BOTH", else: "EXTENSION_ONLY"),
    else: if(arraySize(arrayRemoveNulls(localMatches)) > 0, "BOTH", else: "ONEAGENT_ONLY"))
| summarize databases = count(), by:{dbTech, category}
| sort dbTech asc, category asc
```

- **How it works:**
  1. `fetch dt.entity.process_group_instance` with the prefilter subquery, then the metadata fields, technology, Kubernetes fields, host and process group IDs (`belongs_to[dt.entity.host]`, `instance_of[dt.entity.process_group]`), workload and host lookup.
  2. `addrs` collects every name the process can be reached by; `expand v = addrs` makes one row per name; `filter isNotNull(v)`; `dedup id, v` removes repeats (for example pod and container with the same name).
  3. `fields key = concat(<family>, "|", v)`: the family is the technology with MariaDB mapped to MySQL, so the two can match each other.
  4. `join [smartscapeNodes "DB_INSTANCE_*" …], kind:outer`: the instance keys (one row per name or address of each DB instance, tagged `via` = `server`, `endpoint` or `none`). An outer join keeps every process row and every instance row, matched or not, so every pair is produced exactly once.
  5. `ok` is true when both sides are present and the pair passes the port rule (`via == "server"`, or the process reports no listen ports, or the instance port is one of them).
  6. `sides` / `expand s` turns each row into an instance record and a process record; `filter isNotNull(s[id])` drops the missing side of unmatched rows.
  7. `summarize matches = countIf(ok), by:{side, id, dbTech, host}`: one row per DB instance and one per process with its number of valid matches.
  8. `filter side == "instance" or matches == 0`: every DB instance stays; a process stays only when it matched nothing (a matched process is already counted through its instance).
  9. `lookup [fetch metric.series …]` adds the local extensions reporting from the process's host (instances have no host). `localMatches` is an iterative `if` over `localExtensions[]` that keeps the names containing one of the technology's tokens.
  10. `category`: instance → `BOTH` if `matches > 0` else `EXTENSION_ONLY`; process → `BOTH` if a local extension of its technology is on the host else `ONEAGENT_ONLY`.
  11. `summarize databases = count(), by:{dbTech, category}`, sorted by technology and category.
- **Output:** `dbTech`, `category`, `databases`. `toTechCounts` ([databases.ts](../ui/app/databases.ts#L488)) groups the rows per technology into the three counts and a total, sorted by total descending, then label. Used by gauge 1, the chart, the Database extensions rows (technology list and OneAgent only column) and AI Assist.
- **Limits and cost:** no row limit (one row per technology and category). The README reports 0.3–0.5 s for 24 hours and 2–4 s for 30 days on the demo tenant. The process and instance rules are evaluated once in this pass so the query stays below DQL's 1000-expression limit.
- **Open it yourself:** Show DQL / Copy / Open in Notebook / Add to Dashboard under the summary card.

### 2. OneAgent database processes and their extension (`dbProcessesQuery`)

- **Source:** [`dbProcessesQuery`](../ui/app/queries.ts#L1052)
- **Runs:** on tab render; re-runs on timeframe change and Re-check.
- **Parameters:** timeframe only.
- **Query:**

```dql
fetch dt.entity.process_group_instance, from:now()-24h
| filter id in [fetch dt.entity.process_group_instance, from:now()-24h
    | filter isNull(processType) or not in(processType, array("JAVA", "TOMCAT", "JBOSS", "WEBLOGIC", "WEBSPHERE", "GLASSFISH", "DOTNET", "IIS", "IIS_APP_POOL", "NODE_JS", "GO", "PHP", "PYTHON", "APACHE_HTTPD", "NGINX", "RUBY", "ERLANG", "ENVOY", "HAPROXY", "IBM_CICS_REGION", "APMNG"))
    | fieldsAdd exeAll = if(startsWith(metadata[], "EXE_NAME:"), substring(metadata[], from:9))
    | fieldsAdd exe = arrayFirst(arrayRemoveNulls(exeAll))
    | fieldsRemove exeAll
    | filter in(processType, array("MSSQL", "MYSQL", "POSTGRES", "MONGODB", "REDIS")) or in(lower(exe), array("sqlservr", "sqlservr.exe", "mariadbd", "mariadbd.exe", "mysqld", "mysqld.exe", "postgres", "postgres.exe", "oracle", "oracle.exe", "db2sysc", "db2syscs.exe", "hdbnameserver", "mongod", "mongod.exe", "redis-server", "valkey-server"))
    | fields id]
| fieldsAdd exeAll = if(startsWith(metadata[], "EXE_NAME:"), substring(metadata[], from:9)),
    exePathAll = if(startsWith(metadata[], "EXE_PATH:"), substring(metadata[], from:9))
| fieldsAdd exe = arrayFirst(arrayRemoveNulls(exeAll)), exePath = arrayFirst(arrayRemoveNulls(exePathAll))
| fieldsRemove exeAll, exePathAll
| fieldsAdd exe = lower(exe), exePath = lower(exePath)
| fieldsAdd dbTech = if(in(processType, array("MSSQL")) or in(exe, array("sqlservr", "sqlservr.exe")), "MSSQL",
      else: if(in(exe, array("mariadbd", "mariadbd.exe")) or ((in(processType, array("MYSQL")) or in(exe, array("mysqld", "mysqld.exe"))) and coalesce(contains(exePath, "mariadb"), false)), "MARIADB",
      else: if(in(processType, array("MYSQL")) or in(exe, array("mysqld", "mysqld.exe")), "MYSQL",
      else: if(in(processType, array("POSTGRES")) or in(exe, array("postgres", "postgres.exe")), "POSTGRES",
      else: if(in(exe, array("oracle", "oracle.exe")), "ORACLE",
      else: if(in(exe, array("db2sysc", "db2syscs.exe")), "DB2",
      else: if(in(exe, array("hdbnameserver")), "HANA",
      else: if(in(processType, array("MONGODB")) or in(exe, array("mongod", "mongod.exe")), "MONGODB",
      else: if(in(processType, array("REDIS")) or in(exe, array("redis-server", "valkey-server")), "REDIS")))))))))
| filter isNotNull(dbTech)
| fieldsAdd podAll = if(startsWith(metadata[], "KUBERNETES_FULL_POD_NAME:"), substring(metadata[], from:25)),
    basePodAll = if(startsWith(metadata[], "KUBERNETES_BASE_POD_NAME:"), substring(metadata[], from:25)),
    namespaceAll = if(startsWith(metadata[], "KUBERNETES_NAMESPACE:"), substring(metadata[], from:21)),
    k8sClusterIdAll = if(startsWith(metadata[], "KUBERNETES_CLUSTER_ID:"), substring(metadata[], from:22)),
    containerAll = if(startsWith(metadata[], "CONTAINER_NAME:"), substring(metadata[], from:15))
| fieldsAdd pod = arrayFirst(arrayRemoveNulls(podAll)), basePod = arrayFirst(arrayRemoveNulls(basePodAll)), namespace = arrayFirst(arrayRemoveNulls(namespaceAll)), k8sClusterId = arrayFirst(arrayRemoveNulls(k8sClusterIdAll)), container = arrayFirst(arrayRemoveNulls(containerAll))
| fieldsRemove podAll, basePodAll, namespaceAll, k8sClusterIdAll, containerAll
| fieldsAdd host = belongs_to[dt.entity.host], pg = instance_of[dt.entity.process_group],
    workload = if(endsWith(basePod, "-*"), substring(basePod, to:stringLength(basePod) - 2), else: basePod)
| lookup [fetch dt.entity.host, from:now()-24h | fields id, hostName = entity.name, ipAddress, monitoringMode, hostGroup = hostGroupName, osType], sourceField:host, lookupField:id, fields:{hostName, ipAddress, monitoringMode, hostGroup, osType}
| lookup [fetch dt.entity.process_group_instance, from:now()-24h
    | filter id in [fetch dt.entity.process_group_instance, from:now()-24h
        | filter isNull(processType) or not in(processType, array("JAVA", "TOMCAT", "JBOSS", "WEBLOGIC", "WEBSPHERE", "GLASSFISH", "DOTNET", "IIS", "IIS_APP_POOL", "NODE_JS", "GO", "PHP", "PYTHON", "APACHE_HTTPD", "NGINX", "RUBY", "ERLANG", "ENVOY", "HAPROXY", "IBM_CICS_REGION", "APMNG"))
        | fieldsAdd exeAll = if(startsWith(metadata[], "EXE_NAME:"), substring(metadata[], from:9))
        | fieldsAdd exe = arrayFirst(arrayRemoveNulls(exeAll))
        | fieldsRemove exeAll
        | filter in(processType, array("MSSQL", "MYSQL", "POSTGRES", "MONGODB", "REDIS")) or in(lower(exe), array("sqlservr", "sqlservr.exe", "mariadbd", "mariadbd.exe", "mysqld", "mysqld.exe", "postgres", "postgres.exe", "oracle", "oracle.exe", "db2sysc", "db2syscs.exe", "hdbnameserver", "mongod", "mongod.exe", "redis-server", "valkey-server"))
        | fields id]
    | fieldsAdd exeAll = if(startsWith(metadata[], "EXE_NAME:"), substring(metadata[], from:9)),
        exePathAll = if(startsWith(metadata[], "EXE_PATH:"), substring(metadata[], from:9))
    | fieldsAdd exe = arrayFirst(arrayRemoveNulls(exeAll)), exePath = arrayFirst(arrayRemoveNulls(exePathAll))
    | fieldsRemove exeAll, exePathAll
    | fieldsAdd exe = lower(exe), exePath = lower(exePath)
    | fieldsAdd dbTech = if(in(processType, array("MSSQL")) or in(exe, array("sqlservr", "sqlservr.exe")), "MSSQL",
          else: if(in(exe, array("mariadbd", "mariadbd.exe")) or ((in(processType, array("MYSQL")) or in(exe, array("mysqld", "mysqld.exe"))) and coalesce(contains(exePath, "mariadb"), false)), "MARIADB",
          else: if(in(processType, array("MYSQL")) or in(exe, array("mysqld", "mysqld.exe")), "MYSQL",
          else: if(in(processType, array("POSTGRES")) or in(exe, array("postgres", "postgres.exe")), "POSTGRES",
          else: if(in(exe, array("oracle", "oracle.exe")), "ORACLE",
          else: if(in(exe, array("db2sysc", "db2syscs.exe")), "DB2",
          else: if(in(exe, array("hdbnameserver")), "HANA",
          else: if(in(processType, array("MONGODB")) or in(exe, array("mongod", "mongod.exe")), "MONGODB",
          else: if(in(processType, array("REDIS")) or in(exe, array("redis-server", "valkey-server")), "REDIS")))))))))
    | filter isNotNull(dbTech)
    | fieldsAdd podAll = if(startsWith(metadata[], "KUBERNETES_FULL_POD_NAME:"), substring(metadata[], from:25)),
        basePodAll = if(startsWith(metadata[], "KUBERNETES_BASE_POD_NAME:"), substring(metadata[], from:25)),
        namespaceAll = if(startsWith(metadata[], "KUBERNETES_NAMESPACE:"), substring(metadata[], from:21)),
        k8sClusterIdAll = if(startsWith(metadata[], "KUBERNETES_CLUSTER_ID:"), substring(metadata[], from:22)),
        containerAll = if(startsWith(metadata[], "CONTAINER_NAME:"), substring(metadata[], from:15))
    | fieldsAdd pod = arrayFirst(arrayRemoveNulls(podAll)), basePod = arrayFirst(arrayRemoveNulls(basePodAll)), namespace = arrayFirst(arrayRemoveNulls(namespaceAll)), k8sClusterId = arrayFirst(arrayRemoveNulls(k8sClusterIdAll)), container = arrayFirst(arrayRemoveNulls(containerAll))
    | fieldsRemove podAll, basePodAll, namespaceAll, k8sClusterIdAll, containerAll
    | fieldsAdd host = belongs_to[dt.entity.host], pg = instance_of[dt.entity.process_group],
        workload = if(endsWith(basePod, "-*"), substring(basePod, to:stringLength(basePod) - 2), else: basePod)
    | lookup [fetch dt.entity.host, from:now()-24h | fields id, hostName = entity.name, ipAddress, monitoringMode, hostGroup = hostGroupName, osType], sourceField:host, lookupField:id, fields:{hostName, ipAddress, monitoringMode, hostGroup, osType}
    | fieldsAdd addrs = arrayConcat(array(lower(pod), lower(hostName), if(isNull(toIp(hostName)), lower(splitString(hostName, ".")[0])), lower(workload),
        if(isNotNull(workload) and isNotNull(namespace), lower(concat(workload, ".", namespace))), lower(container), concat("#", id)), coalesce(ipAddress, array()))
    | expand v = addrs
    | filter isNotNull(v)
    | dedup id, v
    | fields key = concat(if(dbTech == "MARIADB", "MYSQL", else: dbTech), "|", v), v, pgi = id, pgiName = entity.name, listenPorts, dbTech, host
    | join [smartscapeNodes "DB_INSTANCE_*", from:now()-24h
        | fieldsAdd dbTech = substring(type, from:12), server = lower(host.name), endpoint = lower(db.connection_details.hostname), dbPort = toString(db.connection_details.port)
        | fieldsAdd serverParts = if(isNull(toIp(server)), splitString(server, ".")), endpointParts = if(isNull(toIp(endpoint)), splitString(endpoint, "."))
        | fieldsAdd k = arrayRemoveNulls(array(
            if(isNotNull(server), record(v = server, via = "server")),
            if(arraySize(serverParts) > 1, record(v = serverParts[0], via = "server")),
            if(isNotNull(endpoint), record(v = endpoint, via = "endpoint")),
            if(arraySize(endpointParts) > 1, record(v = endpointParts[0], via = "endpoint")),
            if(arraySize(endpointParts) > 2, record(v = concat(endpointParts[0], ".", endpointParts[1]), via = "endpoint")),
            if(isNotNull(db.connection_details.ip), record(v = toString(db.connection_details.ip), via = "endpoint")),
            record(v = concat("#", toString(id)), via = "none")))
        | expand k
        | fields key = concat(if(dbTech == "MARIADB", "MYSQL", else: dbTech), "|", k[v]), via = k[via], dbId = id, dbName = name, dbPort, dbTech
      ], kind:inner, on:{left[key] == right[key]}, fields:{dbId, dbName, via, dbPort}
    | filter via == "server" or arraySize(coalesce(listenPorts, array())) == 0 or in(dbPort, listenPorts)
    | summarize instanceIds = collectDistinct(dbId), instances = collectDistinct(dbName), matchedOn = collectDistinct(concat(v, if(via == "server", " (server name)", else: concat(":", coalesce(dbPort, "?"))))), by:{pgi}
  ], sourceField:id, lookupField:pgi, fields:{instanceIds, instances, matchedOn}
| lookup [fetch metric.series, from:now()-24h
    | filter metric.key == "dt.sfm.extension.status" and isNotNull(dt.entity.host)
    | summarize localExtensions = collectDistinct(dt.extension.name), by:{dt.entity.host}], sourceField:host, lookupField:dt.entity.host, fields:{localExtensions}
| fieldsAdd localMatches = if((dbTech == "MSSQL" and (contains(localExtensions[], "sql-server") or contains(localExtensions[], "mssql")))
      or (dbTech == "MARIADB" and (contains(localExtensions[], "mariadb")))
      or (dbTech == "MYSQL" and (contains(localExtensions[], "mysql")))
      or (dbTech == "POSTGRES" and (contains(localExtensions[], "postgres")))
      or (dbTech == "ORACLE" and (contains(localExtensions[], "sql-oracle")))
      or (dbTech == "DB2" and (contains(localExtensions[], "db2")))
      or (dbTech == "HANA" and (contains(localExtensions[], "hana")))
      or (dbTech == "MONGODB" and (contains(localExtensions[], "mongodb")))
      or (dbTech == "REDIS" and (contains(localExtensions[], "redis") or contains(localExtensions[], "valkey"))), localExtensions[])
| fieldsAdd localExtension = arrayFirst(arrayRemoveNulls(localMatches))
| fieldsAdd coverage = if(arraySize(instanceIds) > 0, "EXTENSION", else: if(isNotNull(localExtension), "LOCAL_EXTENSION", else: "ONEAGENT_ONLY"))
| lookup [smartscapeNodes "PROCESS", from:now()-24h | fields sid = toString(id), id_classic], sourceField:id, lookupField:id_classic, fields:{sid}
| fields id, sid, name = entity.name, dbTech, coverage, instanceIds, instances, matchedOn, localExtension, pg, host, hostName, ipAddress, monitoringMode, hostGroup, osType,
    listenPorts, pod, namespace, workload, container, k8sClusterId, exe
| sort coverage desc, dbTech asc, name asc
| limit 500
```

- **How it works:**
  1. The same process base as query 1 (one row per process instance).
  2. `lookup [ … ]` with `processMatches`: process keys `join … kind:inner` instance keys, the port rule as a `filter`, then per process (`by:{pgi}`) `instanceIds`, `instances` (names) and `matchedOn` (`<value> (server name)` or `<value>:<port>`, `?` when the instance has no port).
  3. `lookup` of local extensions per host; `localExtension` = the first local extension name containing a token of the process's technology.
  4. `coverage`: `EXTENSION` when `instanceIds` is not empty, else `LOCAL_EXTENSION` when a local extension was found, else `ONEAGENT_ONLY`.
  5. `lookup [smartscapeNodes "PROCESS" …]` maps the classic process instance ID (`id_classic`) to the Smartscape node ID (`sid`) for the Process link.
  6. `fields …`, `sort coverage desc, dbTech asc, name asc`, `limit 500`.
- **Output:** `id`, `sid`, `name`, `dbTech`, `coverage`, `instanceIds`, `instances`, `matchedOn`, `localExtension`, `pg`, `host`, `hostName`, `ipAddress`, `monitoringMode`, `hostGroup`, `osType`, `listenPorts`, `pod`, `namespace`, `workload`, `container`, `k8sClusterId`, `exe`. Mapped by `toDbProcess`; used by gauge 2, the processes table, the diagnosis (`monitoringMode`, names and IPs for the existing-configuration check), and the form (endpoint options and port).
- **Limits and cost:** 500 rows (`DB_LIMIT`). Because the sort puts OneAgent-only first, with more than 500 database processes the covered ones are the ones cut off (gauge 2 then understates coverage).
- **Open it yourself:** query actions under the processes table.

### 3. DB instances monitored by extensions (`dbInstancesQuery`)

- **Source:** [`dbInstancesQuery`](../ui/app/queries.ts#L1060)
- **Runs:** on tab render; re-runs on timeframe change and Re-check.
- **Parameters:** timeframe only.
- **Query:**

```dql
smartscapeNodes "DB_INSTANCE_*", from:now()-24h
| fieldsAdd dbTech = substring(type, from:12)
| lookup [smartscapeNodes "DB_INSTANCE_*", from:now()-24h
    | fieldsAdd dbTech = substring(type, from:12), server = lower(host.name), endpoint = lower(db.connection_details.hostname), dbPort = toString(db.connection_details.port)
    | fieldsAdd serverParts = if(isNull(toIp(server)), splitString(server, ".")), endpointParts = if(isNull(toIp(endpoint)), splitString(endpoint, "."))
    | fieldsAdd k = arrayRemoveNulls(array(
        if(isNotNull(server), record(v = server, via = "server")),
        if(arraySize(serverParts) > 1, record(v = serverParts[0], via = "server")),
        if(isNotNull(endpoint), record(v = endpoint, via = "endpoint")),
        if(arraySize(endpointParts) > 1, record(v = endpointParts[0], via = "endpoint")),
        if(arraySize(endpointParts) > 2, record(v = concat(endpointParts[0], ".", endpointParts[1]), via = "endpoint")),
        if(isNotNull(db.connection_details.ip), record(v = toString(db.connection_details.ip), via = "endpoint")),
        record(v = concat("#", toString(id)), via = "none")))
    | expand k
    | fields key = concat(if(dbTech == "MARIADB", "MYSQL", else: dbTech), "|", k[v]), via = k[via], dbId = id, dbName = name, dbPort, dbTech
    | join [fetch dt.entity.process_group_instance, from:now()-24h
        | filter id in [fetch dt.entity.process_group_instance, from:now()-24h
            | filter isNull(processType) or not in(processType, array("JAVA", "TOMCAT", "JBOSS", "WEBLOGIC", "WEBSPHERE", "GLASSFISH", "DOTNET", "IIS", "IIS_APP_POOL", "NODE_JS", "GO", "PHP", "PYTHON", "APACHE_HTTPD", "NGINX", "RUBY", "ERLANG", "ENVOY", "HAPROXY", "IBM_CICS_REGION", "APMNG"))
            | fieldsAdd exeAll = if(startsWith(metadata[], "EXE_NAME:"), substring(metadata[], from:9))
            | fieldsAdd exe = arrayFirst(arrayRemoveNulls(exeAll))
            | fieldsRemove exeAll
            | filter in(processType, array("MSSQL", "MYSQL", "POSTGRES", "MONGODB", "REDIS")) or in(lower(exe), array("sqlservr", "sqlservr.exe", "mariadbd", "mariadbd.exe", "mysqld", "mysqld.exe", "postgres", "postgres.exe", "oracle", "oracle.exe", "db2sysc", "db2syscs.exe", "hdbnameserver", "mongod", "mongod.exe", "redis-server", "valkey-server"))
            | fields id]
        | fieldsAdd exeAll = if(startsWith(metadata[], "EXE_NAME:"), substring(metadata[], from:9)),
            exePathAll = if(startsWith(metadata[], "EXE_PATH:"), substring(metadata[], from:9))
        | fieldsAdd exe = arrayFirst(arrayRemoveNulls(exeAll)), exePath = arrayFirst(arrayRemoveNulls(exePathAll))
        | fieldsRemove exeAll, exePathAll
        | fieldsAdd exe = lower(exe), exePath = lower(exePath)
        | fieldsAdd dbTech = if(in(processType, array("MSSQL")) or in(exe, array("sqlservr", "sqlservr.exe")), "MSSQL",
              else: if(in(exe, array("mariadbd", "mariadbd.exe")) or ((in(processType, array("MYSQL")) or in(exe, array("mysqld", "mysqld.exe"))) and coalesce(contains(exePath, "mariadb"), false)), "MARIADB",
              else: if(in(processType, array("MYSQL")) or in(exe, array("mysqld", "mysqld.exe")), "MYSQL",
              else: if(in(processType, array("POSTGRES")) or in(exe, array("postgres", "postgres.exe")), "POSTGRES",
              else: if(in(exe, array("oracle", "oracle.exe")), "ORACLE",
              else: if(in(exe, array("db2sysc", "db2syscs.exe")), "DB2",
              else: if(in(exe, array("hdbnameserver")), "HANA",
              else: if(in(processType, array("MONGODB")) or in(exe, array("mongod", "mongod.exe")), "MONGODB",
              else: if(in(processType, array("REDIS")) or in(exe, array("redis-server", "valkey-server")), "REDIS")))))))))
        | filter isNotNull(dbTech)
        | fieldsAdd podAll = if(startsWith(metadata[], "KUBERNETES_FULL_POD_NAME:"), substring(metadata[], from:25)),
            basePodAll = if(startsWith(metadata[], "KUBERNETES_BASE_POD_NAME:"), substring(metadata[], from:25)),
            namespaceAll = if(startsWith(metadata[], "KUBERNETES_NAMESPACE:"), substring(metadata[], from:21)),
            k8sClusterIdAll = if(startsWith(metadata[], "KUBERNETES_CLUSTER_ID:"), substring(metadata[], from:22)),
            containerAll = if(startsWith(metadata[], "CONTAINER_NAME:"), substring(metadata[], from:15))
        | fieldsAdd pod = arrayFirst(arrayRemoveNulls(podAll)), basePod = arrayFirst(arrayRemoveNulls(basePodAll)), namespace = arrayFirst(arrayRemoveNulls(namespaceAll)), k8sClusterId = arrayFirst(arrayRemoveNulls(k8sClusterIdAll)), container = arrayFirst(arrayRemoveNulls(containerAll))
        | fieldsRemove podAll, basePodAll, namespaceAll, k8sClusterIdAll, containerAll
        | fieldsAdd host = belongs_to[dt.entity.host], pg = instance_of[dt.entity.process_group],
            workload = if(endsWith(basePod, "-*"), substring(basePod, to:stringLength(basePod) - 2), else: basePod)
        | lookup [fetch dt.entity.host, from:now()-24h | fields id, hostName = entity.name, ipAddress, monitoringMode, hostGroup = hostGroupName, osType], sourceField:host, lookupField:id, fields:{hostName, ipAddress, monitoringMode, hostGroup, osType}
        | fieldsAdd addrs = arrayConcat(array(lower(pod), lower(hostName), if(isNull(toIp(hostName)), lower(splitString(hostName, ".")[0])), lower(workload),
            if(isNotNull(workload) and isNotNull(namespace), lower(concat(workload, ".", namespace))), lower(container), concat("#", id)), coalesce(ipAddress, array()))
        | expand v = addrs
        | filter isNotNull(v)
        | dedup id, v
        | fields key = concat(if(dbTech == "MARIADB", "MYSQL", else: dbTech), "|", v), v, pgi = id, pgiName = entity.name, listenPorts, dbTech, host
      ], kind:inner, on:{left[key] == right[key]}, fields:{pgi, pgiName, v, listenPorts}
    | filter via == "server" or arraySize(coalesce(listenPorts, array())) == 0 or in(dbPort, listenPorts)
    | summarize processIds = collectDistinct(pgi), processes = collectDistinct(pgiName), matchedOn = collectDistinct(concat(v, if(via == "server", " (server name)", else: concat(":", coalesce(dbPort, "?"))))), by:{dbId}
  ], sourceField:id, lookupField:dbId, fields:{processIds, processes, matchedOn}
| fields id, classicId = id_classic, name, dbTech, coverage = if(arraySize(processIds) > 0, "BOTH", else: "EXTENSION_ONLY"), version = db.instance.version,
    endpointHost = db.connection_details.hostname, endpointIp = db.connection_details.ip, port = db.connection_details.port, serverName = host.name,
    k8sCluster = k8s.cluster.name, processIds, processes, matchedOn, lastSeen = lifetime[end]
| sort coverage desc, dbTech asc, name asc
| limit 500
```

- **How it works:**
  1. `smartscapeNodes "DB_INSTANCE_*"`: every DB instance node (types `DB_INSTANCE_<TECH>`); `substring(type, from:12)` strips the 12-character prefix `DB_INSTANCE_`.
  2. `lookup [ … ]` with `instanceMatches`: instance keys `join … kind:inner` process keys, the port rule, then per instance (`by:{dbId}`) `processIds`, `processes` (names) and `matchedOn`.
  3. `coverage` = `BOTH` when `processIds` is not empty, else `EXTENSION_ONLY`.
  4. Fields: `id_classic`, version (`db.instance.version`), endpoint host / IP / port (`db.connection_details.*`), server name (`host.name`), `k8s.cluster.name`, `lifetime[end]`; sorted, `limit 500`.
- **Output:** `id`, `classicId`, `name`, `dbTech`, `coverage`, `version`, `endpointHost`, `endpointIp`, `port`, `serverName`, `k8sCluster`, `processIds`, `processes`, `matchedOn`, `lastSeen`. Mapped by `toDbInstance`; used by the instances table.
- **Limits and cost:** 500 rows.
- **Open it yourself:** query actions under the instances table.

### 4. Database extension configurations by status (`dbExtensionStatusQuery`)

- **Source:** [`dbExtensionStatusQuery`](../ui/app/queries.ts#L1069)
- **Runs:** on tab render; re-runs on timeframe change and Re-check.
- **Parameters:** timeframe; the extension list and tokens come from `DB_MATCH`.
- **Query:**

```dql
timeseries c = count(dt.sfm.extension.status), by:{dt.extension.config.id, dt.extension.name, dt.extension.status, dt.active_gate.group.name, dt.entity.host},
    filter:{in(dt.extension.name, array("com.dynatrace.extension.sql-server", "com.dynatrace.extension.mariadb", "com.dynatrace.extension.mysql", "com.dynatrace.extension.postgres", "com.dynatrace.extension.sql-oracle", "com.dynatrace.extension.sql-db2", "com.dynatrace.extension.sql-sap-hana", "com.dynatrace.extension.mongodb", "com.dynatrace.extension.redis")) or contains(dt.extension.name, "sql-server") or contains(dt.extension.name, "mssql") or contains(dt.extension.name, "mariadb") or contains(dt.extension.name, "mysql") or contains(dt.extension.name, "postgres") or contains(dt.extension.name, "sql-oracle") or contains(dt.extension.name, "db2") or contains(dt.extension.name, "hana") or contains(dt.extension.name, "mongodb") or contains(dt.extension.name, "redis") or contains(dt.extension.name, "valkey")}, from:now()-24h
| fieldsAdd lastAt = arrayMax(iCollectArray(if(isNotNull(c[]), iIndex())))
| dedup dt.extension.config.id, dt.entity.host, sort:{lastAt desc}
| summarize configs = countDistinctExact(dt.extension.config.id), ok = countDistinctExact(if(in(dt.extension.status, array("OK", "IDLE")), dt.extension.config.id)),
    statuses = collectDistinct(dt.extension.status), groups = arrayRemoveNulls(collectDistinct(dt.active_gate.group.name)), hosts = countDistinctExact(dt.entity.host), by:{extension = dt.extension.name}
| sort extension asc
```

- **How it works:**
  1. `timeseries c = count(dt.sfm.extension.status)` split by configuration ID, extension name, status, ActiveGate group and host; the filter keeps the nine database extensions by exact name plus any extension whose name contains a technology token (custom or local variants).
  2. `lastAt` = index of the last time bucket with data (`iCollectArray(if(isNotNull(c[]), iIndex()))`, then `arrayMax`).
  3. `dedup dt.extension.config.id, dt.entity.host, sort:{lastAt desc}`: the latest status per configuration and host (a local configuration reports one series per host; a remote one carries the ActiveGate group and no host).
  4. Per extension: `configs` (distinct configurations), `ok` (distinct configurations whose latest status is `OK` or `IDLE`), `statuses`, `groups`, `hosts`.
- **Output:** `extension`, `configs`, `ok`, `statuses`, `groups`, `hosts`. Mapped by `toExtStatus`; the Configurations column reads the row whose `extension` equals the catalogue extension ID; AI Assist reads every row with `configs > ok`.
- **Limits and cost:** one row per extension name.
- **Open it yourself:** query actions under the Database extensions table.

### 5. ActiveGate groups that can run a remote extension (`dbAgGroupsQuery`)

- **Source:** [`dbAgGroupsQuery`](../ui/app/queries.ts#L1078)
- **Runs:** on tab render; re-runs on timeframe change only.
- **Parameters:** timeframe; the 20-minute online window is `AG_OFFLINE_MINUTES`.
- **Query:**

```dql
smartscapeNodes "ACTIVEGATE", from:now()-24h
| fieldsAdd lastSeen = lifetime[end]
| dedup dt.active_gate.id, sort:{lastSeen desc}
| filter in("EXTENSION_CONTROLLER", modules) and isNotNull(dt.active_gate.group.name)
| summarize activeGates = count(), online = countIf(lastSeen >= now() - 20m), by:{group = dt.active_gate.group.name}
| sort group asc
```

- **How it works:** `smartscapeNodes "ACTIVEGATE"`; `lastSeen = lifetime[end]`; `dedup dt.active_gate.id` keeps the newest node per ActiveGate; keeps ActiveGates whose `modules` contain `EXTENSION_CONTROLLER` and that are in a group; per group counts ActiveGates and those seen in the last 20 minutes.
- **Output:** `group`, `activeGates`, `online`. Used by the `group` check, the form's ActiveGate group list (groups with `online > 0`, shown as "<group> (<online>/<total> online)") and Validate.
- **Open it yourself:** not exposed (no Show DQL).

## How DB instances and processes are matched

Nothing in Smartscape links a DB instance to a host or process (the code comment, validated on the demo tenant on 2026-10-24: a DB instance's only edges are `DB_DATABASE runs_on` and `SERVICE calls`). The queries therefore match by name and address, inside one technology family (MariaDB and MySQL form one family, because the MySQL extension can monitor a MariaDB server).

**Keys of a process** (`dbProcessKeys`), all lower case, each prefixed with `<family>|`:

| Key | From |
| --- | --- |
| pod name | `KUBERNETES_FULL_POD_NAME` |
| host name | host `entity.name` |
| first label of the host name | only when the host name is not an IP address |
| workload | `KUBERNETES_BASE_POD_NAME` without `-*` |
| `<workload>.<namespace>` | when both exist |
| container name | `CONTAINER_NAME` |
| every host IP | host `ipAddress` |
| `#<process ID>` | never matches; keeps the process in the expansion |

**Keys of a DB instance** (`dbInstanceKeys`), each tagged with how it was obtained:

| Key | `via` |
| --- | --- |
| server name (`host.name`) | `server` |
| first label of the server name (when it has more than one label and is not an IP) | `server` |
| connection host (`db.connection_details.hostname`) | `endpoint` |
| first label of the connection host (more than one label, not an IP) | `endpoint` |
| first two labels of the connection host (more than two labels, not an IP) | `endpoint` |
| connection IP (`db.connection_details.ip`) | `endpoint` |
| `#<instance ID>` | `none` (never matches) |

**A pair matches** when the keys are equal and:

- the key came from the server name (`via == "server"`): no port check, because endpoints often go through a load balancer (the README's example: a SQL Server instance reached through an ELB that reports the pod name as its server name); or
- the key came from the endpoint and the process reports no listen ports; or
- the key came from the endpoint and the instance port (`db.connection_details.port`, as a string) is in the process's `listenPorts`.

`matchedOn` shows each matching key as `<value> (server name)` or `<value>:<port>`.

**Local extensions** (Redis, MongoDB or SQL Server local, and other extensions that run on OneAgent) create no DB instance. A process without a matching DB instance counts as covered (`LOCAL_EXTENSION`, category `BOTH`) when a `dt.sfm.extension.status` series with its host's `dt.entity.host` exists in the timeframe (at most the last 10 days) for an extension whose name contains one of its technology's tokens (table above). Remote configurations carry only the ActiveGate group, so they never count here.

**Example.** A PostgreSQL pod `orders-db-0` (workload `orders-db`, namespace `my-namespace`, listening on 5432) and a `DB_INSTANCE_POSTGRES` whose endpoint is `orders-db.my-namespace.svc.cluster.local:5432`: the endpoint's first two labels `orders-db.my-namespace` equal the process key `orders-db.my-namespace`, the port 5432 is a listen port, so they match (`orders-db.my-namespace:5432`). If the instance reported port 6432 (a pooler), the endpoint key would fail the port rule and the pair would match only through the server name.

## API calls

| Method | Endpoint or SDK method | Scope | When |
| --- | --- | --- | --- |
| GET | `/platform/extensions/v2/extensions/{name}/environment-configuration` | `extensions:definitions:read` | page load (per technology found), Re-check, selection, form load, Validate, Create |
| GET | `/platform/extensions/v2/extensions/{name}?page-size=100` | `extensions:definitions:read` | only after a 404 on the call above |
| GET | `/platform/extensions/v2/extensions/{name}/{version}/schema` | `extensions:definitions:read` (or `extensions:configurations:read`) | form load |
| GET | `/platform/extensions/v2/extensions/{name}/monitoring-configurations?page-size=500`, then `?page-key=<key>` | `extensions:configurations:read` | selection, Validate, Create |
| GET | `/platform/extensions/v2/extensions/{name}/monitoring-configurations/statuses` | `extensions:configurations:read` | after the list above |
| GET | `credentialVaultClient.listCredentials` → `/platform/classic/environment-api/v2/credentials?type=USERNAME_PASSWORD`, then `?nextPageKey=<key>` | `environment-api:credentials:read` | selection |
| POST | `/platform/extensions/v2/extensions/{name}/monitoring-configurations` | `extensions:configurations:write` | Create configuration |
| app function | `functions.call("docs-freshness", …)` | (app function) | once per page load, shared by all tabs |

Extensions API calls go through `httpClient.send` from `@dynatrace-sdk/http-client` (`extJson` in [databases.ts](../ui/app/databases.ts#L550)); POST bodies are sent as JSON with `Content-Type: application/json; charset=utf-8`. Errors: HTTP 403 becomes "Access denied (HTTP 403): the app needs the scope <scope> and you need the matching permission."; other errors show the API's error message.

### GET environment-configuration

`readExtensionEnv(name)` ([databases.ts](../ui/app/databases.ts#L562)). Response field used: `version` → state `active`. On 404 it lists the uploaded versions with `GET /platform/extensions/v2/extensions/{name}?page-size=100` (field `items[].version`): versions → `inactive`, none or 404 → `missing`. Any other error is thrown (shown as "Not readable" / "Extension not checked"). On page load it runs once per distinct extension of the technologies in the summary, in parallel.

### GET schema

`readConfigSchema(name, version)` for the active version, when the create form opens. `shapeFromSchema` ([databases.ts](../ui/app/databases.ts#L695)) reads:

- `properties`: the key ending in `Remote` (remote data source, for example `sqlServerRemote`); `version.default`; the enum of `activationContext` (contains `REMOTE`?), the enum of `featureSets`; `vars` (string defaults of non-nullable variables); top-level `list` properties without a precondition (sent as empty lists).
- `types`: the remote type's `endpoints` type: must have `host`, `port`, `authentication`, else "its endpoints have an unexpected format"; its other properties (`databaseName`, `instanceName`, `databaseIdentifier`, `ssl`, `useConnectionString`, …); `host` pattern constraint; `ssl.default`; endpoint-level lists; `licenseAccepted` on the remote type.
- authentication type: the `scheme` enum must contain `basic` ("it does not support user and password authentication" otherwise); `useCredentialVault` present → the form offers the credential vault.

No `…Remote` property → "this extension has no remote (ActiveGate) configuration".

### GET monitoring-configurations and statuses

`readMonitoringConfigs(name)` ([databases.ts](../ui/app/databases.ts#L610)): pages of 500 until `nextPageKey` is empty. Fields used per item: `objectId`, `scope`, `value.description`, `value.enabled`, `value.activationContext`, `value.version`, and the endpoints under every value key ending in `Remote`, `Container` or `Local` (`endpoints[]` and Redis's `redis_instances[]`, fields `host` lower-cased and `port`). Then `…/statuses`: `items[].configurationId` and `items[].status`; a failure there is ignored. Secrets come back masked.

### Credential vault list

`readExtensionCredentials()` ([databases.ts](../ui/app/databases.ts#L658)): `listCredentials({ type: "USERNAME_PASSWORD" })`, then `{ nextPageKey }` per page. Fields used: `credentials[].id`, `name`, `scopes` / `scope` (kept when `EXTENSION_AUTHENTICATION` or `EXTENSION`), `ownerAccessOnly`; sorted by name. Credential values are never read.

### POST monitoring-configurations

See [Create the monitoring configuration](#api-create-the-extension-monitoring-configuration). Response field used: `objectId` (shown as "ID: <objectId>").

## Remediation actions

### Actions offered

| Action | Kind | Offered when |
| --- | --- | --- |
| Create the <Hub name> monitoring configuration (`api-create`) | API | a process is selected, its technology has `api: true` (SQL Server, PostgreSQL, MySQL, Oracle, Db2, SAP HANA), the extension does not run locally, and the process is OneAgent only |
| Create the <technology> monitoring user (`user`) | Manual | a process is selected |
| Add the database in Databases (<Hub name> extension) / Add a <Hub name> monitoring configuration for the host (`configure`) | Manual | a process is selected (the host variant for Redis) |
| Prepare an ActiveGate group for remote extensions (`ag-group`) | Manual | nothing selected, or the extension does not run locally |
| Store the monitoring user in the credential vault (`vault`) | Manual | nothing selected, or the extension does not run locally |
| Reach a database that runs in Kubernetes (`k8s`) | Manual | the process has a Kubernetes namespace and the extension does not run locally |
| Monitor a database with its extension (`overview`) | Manual | nothing selected |

Each action ends with "Documentation for this fix:" and its links; a link whose page changed in the docs after the review date (or left the docs) is marked, with a notice above the links.

### API: Create the extension monitoring configuration

What it fixes: a database server that OneAgent sees but no database extension monitors. It creates one monitoring configuration with one endpoint for the selected process on an ActiveGate group, from the active extension version's own schema (`CreateConfigForm` in [DatabasesTab.tsx](../ui/app/tabs/DatabasesTab.tsx#L560), `buildMonitoringConfig` / `checkConfigInput` / `createMonitoringConfig` in [databases.ts](../ui/app/databases.ts#L746)).

**Loading the form.** "Reading the extension and its configuration schema…" while it runs `GET environment-configuration` and `GET …/{version}/schema`. If the extension is not active: "<Hub name> is not active in this environment. Add it from Dynatrace Hub first, then reload this form." If the schema is not usable: "This app cannot create a <Hub name> <version> configuration: <reason>. Use the Databases or Extensions app." If the read fails: "Could not read the extension: <error>".

#### Form fields

| Field | Shown when | Default | Notes |
| --- | --- | --- | --- |
| ActiveGate group | always | first group with an online ActiveGate | lists only groups with `online > 0`, as "<group> (<online>/<total> online)" |
| Endpoint | always | first option | options from `endpointOptions`: Kubernetes processes: `<workload>.<namespace>.svc.cluster.local` ("Kubernetes service DNS (a service named like the workload; reachable from an ActiveGate in the cluster)") and node IPs ("Node IP (only with a NodePort or hostNetwork)"); other processes: host name ("Host name (FQDN)" or "Host name") and host IPs ("Host IP"). Loopback (`127.*`, `::1`) and link-local (`169.254.*`, `fe80:`) addresses are skipped, duplicates and names with other characters than letters, digits, `.`, `-`, `:`, `_` are dropped. "Other host (enter below)" is shown when the Host field holds something else. |
| Host | always | the endpoint option | free text, placeholder `db.example.com` |
| Port | always | the technology's default port when the process listens on it; else a listen port matching the hint (SAP HANA `3<nn>15` / `3<nn>13`); else the first listen port; else the default port | |
| Connect by / Service name or SID | schema endpoint has `databaseIdentifier` (Oracle) | Service name | placeholders `orclpdb1` / `ORCL` |
| Database name | schema endpoint has `databaseName` | `postgres` for PostgreSQL, else empty | label "Database name" for Db2 (required), "Database name (optional)" otherwise; MySQL placeholder "empty = all databases" |
| Instance name (named instances) | schema endpoint has `instanceName` (SQL Server) | empty | placeholder "empty = default instance" |
| SSL | schema endpoint has `ssl` | the schema's default (on for SQL Server 4.1.6, off for the others read) | |
| Credentials | always | User and password | "Credential vault" offered when the schema supports it |
| Credential (Extension authentication) | Credential vault | first credential | the vault list; "(owner only)" suffix. With none: "No User and password credential with the Extension authentication scope." and a Credential Vault link |
| User / Password | User and password | `dynatrace` / empty | |
| Feature sets | always (collapsed, "Feature sets (<n> of <m>)") | all feature sets of the schema | checkboxes, **All** / **None** |
| Description | always | "<technology label> <pod, host name or process name> (created by Architect Assistant)", max 500 characters | |
| I accept the Oracle JDBC driver license (Dynatrace redistribution license) | schema has `licenseAccepted` (Oracle) | off | |

Above the request: "Creates one <Hub name> <version> monitoring configuration on ActiveGate group <group> for <host>:<port>. Create the monitoring user in the database first (manual action “Create the <technology> monitoring user”)." and "Same result in the UI: Databases ↗ › Add DB Instance › <Hub name> (see the manual action “Add the database in Databases (<Hub name> extension)”)." The collapsible "Request: POST /platform/extensions/v2/extensions/<extension>/monitoring-configurations (password masked)" shows the exact body with the password as `********` and a Copy button; the request sent contains the real password.

#### How the body is built

`buildMonitoringConfig` returns `{ scope: "ag_group-<group>", value }`:

- Endpoint: `host` (trimmed), `port`; `databaseName` / `instanceName` only when the schema has them and they are not empty; `databaseIdentifier` plus `serviceName` or `SID` (Oracle); `useConnectionString: false` and `ssl` when the schema has them; `authentication` = `{ scheme: "basic", username, password, useCredentialVault: false }` (the last only when the schema supports the vault) or `{ scheme: "basic", useCredentialVault: true, credentialVaultId: "CREDENTIALS_VAULT-…" }`; every unconditional endpoint list as `[]`.
- Value: `enabled: true`, `description`, `version` (the schema's default = the active version), `activationContext: "REMOTE"` when the schema has that enum value, `featureSets`, every unconditional top-level list as `[]`, `vars` with the schema's string defaults, and `<remoteKey>: { endpoints: [<endpoint>], licenseAccepted }` (`licenseAccepted` only for Oracle).

Properties the schema does not have are left out, so the body follows the installed version. The examples below were produced by running the app's `shapeFromSchema` and `buildMonitoringConfig` on the published schemas of the listed versions (the versions the code comment says were checked on the demo tenant), with placeholder host, group and description. Another version can differ in feature sets, variables and properties.

**Microsoft SQL Server 4.1.6** (`com.dynatrace.extension.sql-server`):

```json
{
  "scope": "ag_group-my-ag-group",
  "value": {
    "enabled": true,
    "description": "Microsoft SQL Server mssql-01 (created by Architect Assistant)",
    "version": "4.1.6",
    "activationContext": "REMOTE",
    "featureSets": [
      "Backups",
      "Jobs",
      "Database files Azure",
      "Transaction Logs",
      "Latches",
      "Backups Azure",
      "Locks",
      "Queries",
      "Database files",
      "Sessions",
      "Memory",
      "Locks and waits",
      "Always On",
      "Agent",
      "Replication"
    ],
    "primaryFields": [],
    "primaryTags": [],
    "vars": {
      "heavy-query-interval": "5",
      "longest-queries-timeout": "120",
      "query-interval": "1"
    },
    "sqlServerRemote": {
      "endpoints": [
        {
          "host": "mssql-01.example.com",
          "port": 1433,
          "useConnectionString": false,
          "ssl": true,
          "authentication": {
            "scheme": "basic",
            "username": "dynatrace",
            "password": "********",
            "useCredentialVault": false
          },
          "primaryFields": [],
          "primaryTags": []
        }
      ]
    }
  }
}
```

**PostgreSQL 3.2.8** (`com.dynatrace.extension.postgres`):

```json
{
  "scope": "ag_group-my-ag-group",
  "value": {
    "enabled": true,
    "description": "PostgreSQL postgres-01 (created by Architect Assistant)",
    "version": "3.2.8",
    "activationContext": "REMOTE",
    "featureSets": [
      "Locks",
      "I/O",
      "User Functions",
      "Recovery",
      "Replication",
      "Background Writer",
      "Queries",
      "Tablespaces",
      "SLRU",
      "Tables",
      "WAL",
      "Activity",
      "Subscription",
      "Databases"
    ],
    "primaryFields": [],
    "primaryTags": [],
    "vars": {
      "heavy-query-interval": "5",
      "host-configurations-query-interval": "360",
      "table-query-interval": "15"
    },
    "sqlPostgresRemote": {
      "endpoints": [
        {
          "host": "postgres-01.example.com",
          "port": 5432,
          "databaseName": "postgres",
          "useConnectionString": false,
          "ssl": false,
          "authentication": {
            "scheme": "basic",
            "username": "dynatrace",
            "password": "********",
            "useCredentialVault": false
          },
          "primaryFields": [],
          "primaryTags": []
        }
      ]
    }
  }
}
```

**MySQL 3.1.2** (`com.dynatrace.extension.mysql`):

```json
{
  "scope": "ag_group-my-ag-group",
  "value": {
    "enabled": true,
    "description": "MySQL mysql-01 (created by Architect Assistant)",
    "version": "3.1.2",
    "activationContext": "REMOTE",
    "featureSets": [
      "waits",
      "locks",
      "infrastructure",
      "tables",
      "global_status",
      "databases",
      "slow_queries",
      "top_queries",
      "statements"
    ],
    "primaryFields": [],
    "primaryTags": [],
    "vars": {
      "query-interval": "1",
      "schema_collection_interval": "360",
      "slow-queries-interval": "5",
      "table-query-interval": "15"
    },
    "sqlMySqlRemote": {
      "endpoints": [
        {
          "host": "mysql-01.example.com",
          "port": 3306,
          "useConnectionString": false,
          "ssl": false,
          "authentication": {
            "scheme": "basic",
            "username": "dynatrace",
            "password": "********",
            "useCredentialVault": false
          },
          "primaryFields": [],
          "primaryTags": []
        }
      ]
    }
  }
}
```

**Oracle Database 4.3.0** (`com.dynatrace.extension.sql-oracle`), service name `orclpdb1` (with *SID*, the endpoint has `"databaseIdentifier": "sid", "SID": "ORCL"` instead):

```json
{
  "scope": "ag_group-my-ag-group",
  "value": {
    "enabled": true,
    "description": "Oracle Database oracle-01 (created by Architect Assistant)",
    "version": "4.3.0",
    "activationContext": "REMOTE",
    "featureSets": [
      "tablespaces",
      "asm",
      "asm (detailed)",
      "queryPerformance",
      "rac",
      "tablespaces (detailed)",
      "TopN",
      "sessions",
      "multitenancy",
      "Data guard",
      "limits",
      "waitEvents (detailed)",
      "backupJob",
      "FRA",
      "waitEvents",
      "Blocked sessions",
      "Datafiles",
      "io",
      "cpu",
      "memory"
    ],
    "primaryFields": [],
    "primaryTags": [],
    "vars": {
      "heavy-query-interval": "5"
    },
    "sqlOracleRemote": {
      "endpoints": [
        {
          "host": "oracle-01.example.com",
          "port": 1521,
          "databaseIdentifier": "serviceName",
          "serviceName": "orclpdb1",
          "useConnectionString": false,
          "ssl": false,
          "authentication": {
            "scheme": "basic",
            "username": "dynatrace",
            "password": "********",
            "useCredentialVault": false
          },
          "primaryFields": [],
          "primaryTags": []
        }
      ],
      "licenseAccepted": true
    }
  }
}
```

**SAP HANA 3.1.2** (`com.dynatrace.extension.sql-sap-hana`):

```json
{
  "scope": "ag_group-my-ag-group",
  "value": {
    "enabled": true,
    "description": "SAP HANA hana-01 (created by Architect Assistant)",
    "version": "3.1.2",
    "activationContext": "REMOTE",
    "featureSets": [
      "Host Infrastructure Network Rates",
      "Current Alerts",
      "Host Infrastructure Metrics",
      "Host Temp Heap Usage",
      "Audit Logs",
      "Table Information",
      "Active Prepared Statements",
      "Host Agent Network Rates",
      "Expensive Statement Metrics",
      "HANA License",
      "SQL Plan Cache Size",
      "Backup Metrics",
      "Extended Expensive Statement Metrics",
      "Base Metrics",
      "Savepoint Metrics",
      "Expensive Statements",
      "Schema Disk Metrics",
      "Replication Metrics",
      "Out Of Memory Events",
      "Table Size vs Allocation Limit Usage",
      "Trace File Information",
      "Service Response Time",
      "Disk Size Usage",
      "Unloads Due to Low Memory"
    ],
    "primaryFields": [],
    "primaryTags": [],
    "vars": {
      "heavy-query-interval": "5"
    },
    "sqlHanaRemote": {
      "endpoints": [
        {
          "host": "hana-01.example.com",
          "port": 30015,
          "useConnectionString": false,
          "ssl": false,
          "authentication": {
            "scheme": "basic",
            "username": "dynatrace",
            "password": "********",
            "useCredentialVault": false
          },
          "primaryFields": [],
          "primaryTags": []
        }
      ]
    }
  }
}
```

**IBM Db2** (`com.dynatrace.extension.sql-db2`): no schema of this extension was available when this page was written, so this shows the shape the same code produces; the remote key, feature sets, `vars` and lists come from the installed version's schema at runtime. The database name is required.

```json
{
  "scope": "ag_group-my-ag-group",
  "value": {
    "enabled": true,
    "description": "IBM Db2 db2-01 (created by Architect Assistant)",
    "version": "<active version>",
    "activationContext": "REMOTE",
    "featureSets": ["<every feature set of the schema>"],
    "<remote key from the schema>": {
      "endpoints": [
        {
          "host": "db2-01.example.com",
          "port": 50000,
          "databaseName": "SAMPLE",
          "authentication": { "scheme": "basic", "username": "dynatrace", "password": "********" }
        }
      ]
    }
  }
}
```

With a credential from the vault, the `authentication` object of any of these is:

```json
{ "scheme": "basic", "useCredentialVault": true, "credentialVaultId": "CREDENTIALS_VAULT-0000000000000001" }
```

MariaDB, MongoDB and Redis are not offered (`api: false`): MariaDB needs a JDBC driver and an ActiveGate setting first, MongoDB and Redis are configured in the Extensions app.

#### Validate and Create

The block has **Validate**, a confirmation checkbox "Create a <Hub name> monitoring configuration for <host>" and **Create configuration** (enabled only when the box is ticked). Both buttons run `createMonitoringConfig`; the result appears in a status line (green or red).

Validation, in order (each failure stops with the message shown):

| Step | Failure message |
| --- | --- |
| ActiveGate group selected | "Select an ActiveGate group." |
| Host entered | "Enter the database host." |
| Host matches the schema pattern (`^[a-zA-Z0-9\.\-:_]+$` in the schemas read) | "The host may contain only letters, digits, dots, hyphens, colons and underscores." |
| Port 1–65535 | "Enter a port between 1 and 65535." |
| Oracle service name / SID | "Enter the service name." / "Enter the SID." |
| Db2 database name | "Enter the database name (each Db2 endpoint needs one)." |
| Vault credential selected (`CREDENTIALS_VAULT-…`) | "Select a credential from the credential vault." |
| User and password entered | "Enter the user name and password of the monitoring user." |
| At least one feature set | "Select at least one feature set." |
| Oracle license accepted | "Accept the Oracle JDBC driver license to monitor Oracle." |
| Description 1–500 characters | "Enter a description (up to 500 characters)." |
| Group has an online ActiveGate with the Extensions module | "ActiveGate group <group> has no online ActiveGate with the Extensions module." |
| Extension still active (GET environment-configuration) | "<Hub name> is not active in this environment: add it from Dynatrace Hub first." |
| Active version unchanged | "The active <Hub name> version changed to <version>; reload this form." |
| No configuration has an endpoint on exactly this host and port (GET monitoring-configurations + statuses) | "<host>:<port> is already in a monitoring configuration (“<description>”, <scope>, status <status>). Fix that configuration in the Extensions app instead." |
| API reads failed | "Access denied (HTTP 403): the app needs the scope extensions:configurations:read and extensions:definitions:read …" or the error |

Validate then reports: "Valid: <Hub name> <version> is active, <group> has <n> online ActiveGate(s) with the Extensions module, and no configuration targets <host>:<port> yet. The Extensions API has no dry run, so the server checks the values when you create it."

Create runs the same checks (the same GETs again), then `POST /platform/extensions/v2/extensions/<extension>/monitoring-configurations` with the body. Success: "Monitoring configuration created on <group>. The DB instance appears in Databases within a few minutes; use Re-check to update this tab." plus the object ID; the checkbox is cleared, the diagnosis re-reads the configurations and the tab re-runs its queries (Re-check). Failure: the Extensions API error (for example a schema validation message), or the 403 message naming `extensions:configurations:write`. Nothing is retried.

### Manual: Create the <technology> monitoring user

Steps: create a dedicated, read-only monitoring user with the grants below (pick the hosting type); store it in the credential vault (User and password, scope Extension authentication) or keep it for the configuration; PostgreSQL also: create `dynatrace.dynatrace_execution_plan` from the extension page and run its validation script. A **Variant** dropdown picks the script (Copy button); the technology's notes are folded under **Notes**. Scripts (`user` in `DB_TECHS`):

| Technology | Variants |
| --- | --- |
| SQL Server | Self-hosted 2022 and later (`VIEW SERVER PERFORMANCE STATE`, `VIEW SERVER SECURITY STATE`, `VIEW ANY DEFINITION`, `VIEW ANY DATABASE`, Query Store `VIEW DATABASE STATE` per database); self-hosted 2019 and earlier / Azure SQL Managed Instance (`VIEW SERVER STATE` instead of the two 2022 permissions); Azure SQL Database (`##MS_ServerStateReader##` in master, `VIEW DATABASE STATE` in the database) |
| PostgreSQL | Self-hosted (`pg_monitor`, `pg_stat_statements` preloaded and created, schema `dynatrace`, `search_path`); AWS RDS / Aurora IAM (`rds_iam` instead of a password) |
| MySQL | 8.4 and later (`caching_sha2_password`, needs SSL); 8.0 to 8.3 (`mysql_native_password`); AWS RDS IAM (`AWSAuthenticationPlugin`). Grants: `SELECT` on `performance_schema.*`, `PROCESS`, `SHOW DATABASES`, `SHOW VIEW`, `REFERENCES`, `SELECT` on `mysql.slow_log` and `sys.x$memory_global_by_current_bytes` |
| MariaDB | `SELECT` on `performance_schema.*`, `PROCESS`, `SHOW DATABASES`, `sys.x$memory_global_by_current_bytes`, `SLAVE MONITOR` |
| Oracle | Non-CDB or PDB (`CREATE SESSION`, `SELECT_CATALOG_ROLE`); Multitenant common user `C##DYNATRACE` with `CONTAINER=ALL` and `container_data=all` |
| Db2 | SQLADM authority (OS user first); individual `EXECUTE` on the `SYSPROC.MON_GET_*` / `ENV_GET_SYSTEM_RESOURCES` functions and `SELECT` on `SYSIBMADM` views |
| SAP HANA | `CREATE USER DYNATRACE …`, `GRANT MONITORING`, `AUDIT READ` for the Audit Logs feature set |
| MongoDB | `mongosh`: `db.createUser` in `admin` with role `clusterMonitor` |
| Redis | no script (the password goes into the configuration) |

Example (SQL Server 2022 and later, as shown in the app):

```sql
-- Permissions the extension's views need (extension page). Add DB instance in the Databases app
-- generates the full script for your hosting type.
USE master;
CREATE LOGIN dynatrace WITH PASSWORD = '<password>';
GRANT VIEW SERVER PERFORMANCE STATE TO dynatrace;
GRANT VIEW SERVER SECURITY STATE TO dynatrace;  -- sys.dm_server_services
GRANT VIEW ANY DEFINITION TO dynatrace;         -- sys.master_files, availability groups
GRANT VIEW ANY DATABASE TO dynatrace;           -- sys.availability_databases_cluster
-- Query Store (per monitored database):
-- USE <database>; CREATE USER dynatrace FOR LOGIN dynatrace; GRANT VIEW DATABASE STATE TO dynatrace;
```

Notes per technology include: every ActiveGate in the group must reach the database; PostgreSQL must be reached directly (no load balancer, proxy or pooler), cloud-managed PostgreSQL needs `track_activity_query_size = 4096` and `pg_stat_statements`; MySQL 8.0+; MariaDB needs ActiveGate 1.295+, the MariaDB JDBC connector in the ActiveGate `userdata/libs` directory and `custom_code_jdbc_allowed=true` in `extensionsuser.conf` (then restart the EEC); Oracle 12.2+ and the JDBC driver license; Db2 SSL needs ActiveGate 1.269+; SAP HANA needs `ngdbc.jar` in `userdata/libs` on every ActiveGate; MongoDB authentication database and certificate files; Redis must listen on localhost, Docker access to `/var/run/docker.sock`, and Valkey is not listed on the Redis extension page.

### Manual: Add the database in Databases (<Hub name> extension)

For remote extensions (filled in with the selected process's first endpoint option and expected port):

1. Add the <Hub name> extension from Dynatrace Hub if it is not in the environment yet (needs Change monitoring settings).
2. In Databases, select Add DB Instance, then <Hub name>, and pick the hosting type (it decides the setup script).
3. Select the ActiveGate group that will run the extension.
4. Name the connection and enter host <host>, port <port> (Oracle: and the service name (or SID); PostgreSQL: and database postgres).
5. Enter the monitoring user's credentials, or select them from the credential vault; optionally enable SSL.
6. (Oracle: accept the Oracle JDBC driver license,) add any manual configuration, then select Create DB instance monitoring. Use Re-check on this tab afterwards.

Note: the Extensions app (Add configuration on the extension) is the alternative path and adds monitoring intervals and feature sets. For Redis (local) the action is "Add a Redis monitoring configuration for the host": add the extension from Hub, add a monitoring configuration for host <host> (or its host group) in Extensions, enter the password (and the config file location if commands are renamed; override per instance by port), save, wait, Re-check.

### Manual: Prepare an ActiveGate group for remote extensions

1. Use an environment ActiveGate with the Extensions module (the ActiveGates tab shows the modules).
2. Put it in an ActiveGate group whose members can all reach the database host and port. Every new ActiveGate starts in the group default; a dedicated group keeps a configuration on one ActiveGate.
3. Restart the ActiveGate after changing the group with agctl or custom.properties.

```bash
agctl group set <group>
# then restart the ActiveGate
```

```ini
[collector]
group = <group>
# then restart the ActiveGate
```

Installer: `--set-group=<group>` (at installation only, not during an update). Notes: group names allow letters, digits, hyphens, underscores and dots, not starting with a dot, up to 256 characters; an ActiveGate belongs to one group only.

### Manual: Store the monitoring user in the credential vault

1. Open Credential Vault and select Add new credential.
2. Credential type: User and password. Credential scope: Extension authentication.
3. Name it, enter the monitoring user's name and password, and save. Owner only (the default) lets only you use it in configurations.
4. Use the credential (`CREDENTIALS_VAULT-…`) in the monitoring configuration instead of a password.

Note: a saved credential can be overwritten but not viewed.

### Manual: Reach a database that runs in Kubernetes

1. The ActiveGate group's ActiveGates connect to the endpoint themselves, so it must resolve and reach it from where they run.
2. From an ActiveGate in the cluster, use the database's service DNS name (`<service>.<namespace>.svc.cluster.local`) and its service port.
3. From an ActiveGate outside the cluster, expose the database (LoadBalancer or NodePort) and use that address and port.

```bash
kubectl get svc,endpoints -n my-namespace -o wide
kubectl get pod orders-db-0 -n my-namespace -o wide   # pod IP behind the endpoints
```

(namespace and pod are the selected process's.) Note: PostgreSQL must be reached directly, not through a load balancer, proxy or connection pooler.

### Manual: Monitor a database with its extension

Shown before a process is selected: OneAgent sees a database server as a process but does not deep monitor it, the extension adds statements, waits, locks, sessions and the Databases app; pick a database above and select Configure; most database extensions run remotely on an ActiveGate group, Redis on the host's OneAgent, MongoDB either way.

## AI Assist on this page

The header's **AI Assist** button opens a panel computed by [`analyzeDatabases`](../ui/app/analyses.ts#L547). It is rule-based and runs locally in the browser; no AI service is called. Inputs: per technology the summary counts and whether its extension is active (`null` when not read), the extensions whose status shows `configs > ok` (with the number not OK), and the selected process (name, technology, covered, titles of Blocking checks).

- **No data** (no DB instance and no process): summary "No database instances or database server processes were found for this timeframe.", one info insight (widen the timeframe or add an extension) and one recommendation (add the extension from Hub and the database in the Databases app).
- **Summary:** "<BOTH + EXTENSION_ONLY> of <total> databases (<pct>%) are monitored by a database extension across <n> technologies. <ONEAGENT_ONLY> database servers are seen only by OneAgent, as processes without database insights."

Insights (severity from the percentage: ≥ 90 good, ≥ 50 warning, below critical):

| Insight | Rule | Severity |
| --- | --- | --- |
| "Extension coverage is <pct>% of all databases." | always | by pct |
| "<BOTH> of <BOTH + ONEAGENT_ONLY> database servers OneAgent sees (<pct>%) also have an extension." | always (100 % when the denominator is 0) | by pct |
| "OneAgent only: <tech (n)>, …" | any technology with OneAgent-only databases; up to 5, largest first | warning |
| "No active extension in the environment for <techs>." | technologies with OneAgent-only databases whose extension is not active (read succeeded) | critical |
| "<n> databases are monitored only by an extension (remote or managed databases, or hosts without OneAgent)." | `EXTENSION_ONLY > 0` | info |
| "Configurations not running: <extension (n)>, …" | extensions with configurations not OK or IDLE | critical |
| "<process> is already monitored by its extension." / "<process> (<tech>): blocked by <checks>" / "…: ready for a monitoring configuration" | a process is selected | good / critical / warning |

Recommendations: Configure on a OneAgent-only database of the technology with the largest gap (high, when there is a gap); add the extension from Hub for the first technology without an active extension (high); open the failing configurations in the Extensions app (medium); store monitoring users in the credential vault (low, always).

The second insight uses the summary's `BOTH` count, which counts matched DB instances (and processes with a local extension), so it can differ from gauge 2, which counts process rows.

## Limitations and edge cases

- Matching is by name and address only. A DB instance whose server name and endpoint are neither a pod, workload, host, container nor host IP of a OneAgent process (for example a DNS alias or a load balancer address with a port the process does not listen on) is "Extension only", and the process is "OneAgent only", although they are the same database.
- Two processes can match one DB instance (counted once, as the instance), and one process can match several instances (each instance counted). Totals are DB instances plus unmatched processes, not the sum of both tables' rows.
- A process with a matching DB instance is counted under the instance's technology in the chart; MariaDB processes matched by MySQL DB instances appear under MySQL in the chart and under MariaDB in the processes table, so a MySQL slice does not show them.
- The processes and instances tables, and gauge 2, see at most 500 rows each; with more database processes, gauge 2 is computed over the first 500 (OneAgent-only first).
- Local extensions are recognised only by name tokens and only from the last 10 days on the 30-day timeframe. Any extension reporting from the host whose name contains the token (for example a custom one with `mysql` in its name) counts as coverage.
- A local configuration with several hosts counts as OK in the Configurations column when any one of its hosts reports OK or IDLE.
- A DB instance type not in the catalogue shows "Checking…" in "In this environment" permanently (there is no extension to read) and has no action.
- The `configs` check also runs on **Details** for a covered process; there it usually finds the configuration that does produce the DB instance and still words it as a warning ("it produces no DB instance for this process").
- Validate's duplicate check compares the exact host and port entered; the diagnosis check compares all of the process's names. A configuration on a different alias of the same server is not detected.
- The Extensions API has no dry run: Validate cannot check credentials, reachability or server-side schema rules. Fastcheck results appear later on the [Extensions](extensions.md) tab.
- The ActiveGate group list is not refreshed by Re-check; change the timeframe or reload the app after moving an ActiveGate.
- The form never sends `validateCertificates`, `certificatesValidation`, `databaseDiscovery` or connection strings; the server applies the schema defaults.

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| "Query failed" in a card | missing Grail permission or scope (`storage:entities:read`, `storage:smartscape:read`, `storage:metrics:read`), or a query error | check the user's Grail permissions; open the query in a Notebook to see the error |
| "No databases found for this timeframe." | no DB instances and no database processes in the timeframe | widen the timeframe; check that OneAgent runs on the database hosts |
| A known database is "OneAgent only" although its DB instance exists | names / ports do not match (see limitations) | compare the instance's Endpoint and Server name with the process's host, pod and listen ports |
| "In this environment" says "Not readable" | `extensions:definitions:read` missing for the user | grant Extensions read permissions |
| Diagnosis: "Existing configurations not checked" | `extensions:configurations:read` missing | grant it, or check the extension in the Extensions app |
| No credential in the Credential picker | no User and password credential with scope Extension authentication, or no `environment-api:credentials:read` permission | create one (manual action) or enter user and password |
| "ActiveGate group … has no online ActiveGate with the Extensions module." or no groups in the list | no ActiveGate with `EXTENSION_CONTROLLER` in a named group seen in the last 20 minutes | prepare a group (manual action); check the [ActiveGates](activegates.md) tab |
| "<Hub name> is not active in this environment" | extension not added or no version active | add it from Dynatrace Hub or activate a version in the Extensions app |
| "The active … version changed to …; reload this form." | the extension was updated while the form was open | select Clear selection and Configure again |
| "… is already in a monitoring configuration …" | an existing configuration targets this host and port | fix that configuration in the Extensions app instead |
| Create returns an API error | the server-side schema rejected a value | read the message, adjust the field; compare with a configuration created in the Databases app |
| Created, but the process stays "OneAgent only" | the configuration is not running (wrong credentials, ActiveGate cannot reach the endpoint, fastcheck failed) or the DB instance reports names that do not match | wait a few minutes, Re-check; check the configuration's status on the [Extensions](extensions.md) tab |
| Docs status line says the automatic docs check is off | docs.dynatrace.com not in the allowed outbound connections | add it with the linked setting, then Retry |

## Related pages

- [Index](README.md)
- [Extensions](extensions.md): every monitoring configuration, broken ones and fastcheck results
- [ActiveGates](activegates.md): ActiveGate groups, Extensions module, extension status per group
- [Deep Monitoring](deep-monitoring.md): code modules; database servers are not deep monitored
- [OneAgents](oneagents.md), [Kubernetes](kubernetes.md)

## Source files

| File | Role on this page |
| --- | --- |
| [ui/app/tabs/DatabasesTab.tsx](../ui/app/tabs/DatabasesTab.tsx) | tab layout, data hook, chart, tables, diagnosis, create form, action list |
| [ui/app/databases.ts](../ui/app/databases.ts) | technology catalogue, row mappers, Extensions API and credential vault reads, schema shape, request body, validation, diagnosis checks, manual actions |
| [ui/app/queries.ts](../ui/app/queries.ts#L879) | `DB_MATCH`, the five queries and their building blocks, `refreshMarker` |
| [ui/app/analyses.ts](../ui/app/analyses.ts#L547) | `analyzeDatabases` (AI Assist) |
| [ui/app/tabs/DeepMonitoringTab.tsx](../ui/app/tabs/DeepMonitoringTab.tsx) | `ActionPicker`, `ApiFix`, `DocsStatusLine`, status labels and colours (shared) |
| [ui/app/RemediationPanel.tsx](../ui/app/RemediationPanel.tsx) | `Field`, `ManualActionView`, `Request`, `ResultLine` (shared) |
| [ui/app/components.tsx](../ui/app/components.tsx) | `PctGauge`, `QueryActions`, `QueryState`, `pct`, `statusColor` |
| [ui/app/links.ts](../ui/app/links.ts) | Process, Host, DB instance, Databases app, Extensions app, Hub and Credential Vault links |
| [ui/app/kubernetes.ts](../ui/app/kubernetes.ts) | category colours (`categoryColor`) |
| [ui/app/tabs/AgCharts.tsx](../ui/app/tabs/AgCharts.tsx) | chart tooltip (`useTip`) |
| [ui/app/deepTech.ts](../ui/app/deepTech.ts), [ui/app/deepDocs.ts](../ui/app/deepDocs.ts), [api/docs-freshness.function.ts](../api/docs-freshness.function.ts) | docs catalogue and freshness check |
| [ui/app/useDql.ts](../ui/app/useDql.ts) | DQL hook |
| [app.config.json](../app.config.json) | scopes |
