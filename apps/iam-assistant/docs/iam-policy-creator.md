# IAM Policy Creator

The IAM Policy Creator is a builder, not a check. It writes the text of an IAM policy that you then paste into
Account Management (Identity & access management > Policy management > Create policy). You work in three steps
on the left: (1) pick the installed apps a group may use and at which access level (Read / Write / Execute),
(2) add the Grail data those apps read, limited to certain records by **dimensional data** (security context,
bucket, host group, Kubernetes namespace and more), and (3) fine-tune any other permission from the IAM policy
reference with ALLOW / DENY, every documented condition and operator, and global conditions. The policy text on
the right updates as you select, can be edited by hand, and is validated as you type against the live IAM policy
reference on docs.dynatrace.com. **Copy to clipboard** and **Export .txt** take the text out. The app never
creates or changes a policy itself.

| | |
| --- | --- |
| App | IAM Assistant (see [README](../README.md)) |
| Tab id | `iam-policy` |
| Main source files | [IamPolicyTab.tsx](../ui/app/tabs/IamPolicyTab.tsx), [IamShared.tsx](../ui/app/tabs/IamShared.tsx), [iamPolicy.ts](../ui/app/iamPolicy.ts), [iamCatalog.ts](../ui/app/iamCatalog.ts), [iamApps.ts](../ui/app/iamApps.ts), [iamValues.ts](../ui/app/iamValues.ts), [iamDrafts.tsx](../ui/app/iamDrafts.tsx), [queries.ts](../ui/app/queries.ts#L1312) (IAM value queries), [iam-reference.function.ts](../api/iam-reference.function.ts), [iam-reference-parser.ts](../api/iam-reference-parser.ts), [analyses.ts](../ui/app/analyses.ts#L702) (`analyzeIamPolicy`) |

## Contents

- [What this page answers](#what-this-page-answers)
- [Before you start](#before-you-start)
  - [App scopes used by this page](#app-scopes-used-by-this-page)
  - [User permissions](#user-permissions)
  - [One-time setup](#one-time-setup)
- [Page walkthrough](#page-walkthrough)
  - [Layout and documentation link](#layout-and-documentation-link)
  - [AI Assist panel](#ai-assist-panel)
  - [Heading and introduction](#heading-and-introduction)
  - [Permission catalogue banner](#permission-catalogue-banner)
  - [Name and options](#name-and-options)
  - [Step buttons](#step-buttons)
  - [Step 1: Apps](#step-1-apps)
  - [Step 2: Data access](#step-2-data-access)
  - [Limit the records (dimensional data)](#limit-the-records-dimensional-data)
  - [Step 3: Fine-tune permissions](#step-3-fine-tune-permissions)
  - [Global conditions](#global-conditions)
  - [Condition rows and value pickers](#condition-rows-and-value-pickers)
  - [Policy editor (right pane)](#policy-editor-right-pane)
  - [Copy to clipboard and Export .txt](#copy-to-clipboard-and-export-txt)
  - [Drafts](#drafts)
- [Policy text the app writes](#policy-text-the-app-writes)
  - [Grammar](#grammar)
  - [Block order and line order](#block-order-and-line-order)
  - [How app scopes become permissions](#how-app-scopes-become-permissions)
  - [How dimensions become conditions](#how-dimensions-become-conditions)
  - [Full examples](#full-examples)
  - [What the parser accepts when you type or paste](#what-the-parser-accepts-when-you-type-or-paste)
  - [Load this text into the builder](#load-this-text-into-the-builder)
  - [Docs patterns](#docs-patterns)
- [Checks and scoring](#checks-and-scoring)
  - [Editor validation rules](#editor-validation-rules)
- [Queries](#queries)
- [API calls](#api-calls)
- [Remediation actions](#remediation-actions)
- [AI Assist on this page](#ai-assist-on-this-page)
- [Limitations and edge cases](#limitations-and-edge-cases)
- [Troubleshooting](#troubleshooting)
- [Related pages](#related-pages)
- [Source files](#source-files)

## What this page answers

- Which permissions does a group need so its members can open a given set of apps and use them at a chosen level
  (view only, change, run actions)? The answer comes from the scopes each app's manifest requests, read from the
  App Registry, not from a hardcoded list.
- Which Grail data do those apps read, and how do I grant it only for the records the group should see?
- How do I write a statement correctly: which conditions a permission supports, which operators each condition
  takes, how values are quoted, and which limits apply (100 statements per policy)?
- Does the policy I already have (pasted text) use conditions or operators the reference does not document?

Best practices the builder follows and the editor checks, from the pages the code cites
([`IAM_DOCS` in iamCatalog.ts](../ui/app/iamCatalog.ts#L25)):

- Grant app access per app with `app-engine:apps:run WHERE shared:app-id = "<app>"` instead of an unconditional
  `app-engine:apps:run` (which includes apps installed later).
- Grail table permissions (`storage:logs:read`, `storage:spans:read`, ...) also need `storage:buckets:read` for
  the buckets that hold the data ([Permissions in Grail](https://docs.dynatrace.com/docs/platform/grail/organize-data/assign-permissions-in-grail)).
- Limit table permissions by record-level conditions (dimensional data) rather than granting every record.
- Conditional DENY is not supported on Grail table permissions (it runs as an unconditional DENY); prefer
  conditional ALLOW statements or boundaries.
- `dt.security_context` can be a list on a record; only `MATCH` matches any element of a list.

Docs pages linked from the tab: [IAM policy reference](https://docs.dynatrace.com/docs/manage/identity-access-management/permission-management/manage-user-permissions-policies/advanced/iam-policystatements),
[IAM policy statement syntax and examples](https://docs.dynatrace.com/docs/manage/identity-access-management/permission-management/manage-user-permissions-policies/iam-policystatement-syntax),
[Permissions in Grail](https://docs.dynatrace.com/docs/platform/grail/organize-data/assign-permissions-in-grail),
[Policy global conditions](https://docs.dynatrace.com/docs/manage/identity-access-management/permission-management/manage-user-permissions-policies/advanced/iam-global-conditions),
[Policy global attributes](https://docs.dynatrace.com/docs/manage/identity-access-management/permission-management/manage-user-permissions-policies/advanced/iam-global-attributes),
[Policy templating](https://docs.dynatrace.com/docs/manage/identity-access-management/permission-management/manage-user-permissions-policies/advanced/iam-policy-templating),
[Dynatrace default policies reference](https://docs.dynatrace.com/docs/manage/identity-access-management/permission-management/default-policies),
[IAM limits](https://docs.dynatrace.com/docs/manage/identity-access-management/iam-limits),
[Working with policies](https://docs.dynatrace.com/docs/manage/identity-access-management/permission-management/manage-user-permissions-policies/iam-policy-mgt),
[Grant access to Settings](https://docs.dynatrace.com/docs/manage/identity-access-management/use-cases/access-settings)
(docs patterns), and [Account Management](https://myaccount.dynatrace.com/).

## Before you start

### App scopes used by this page

All scopes below are declared in [app.config.json](../app.config.json). None of them is used to write anything;
they feed the app picker and the value suggestions.

| Scope | What this page uses it for |
| --- | --- |
| `app-engine:apps:run` | List installed apps with the scopes their manifests request (App Registry) and load their icons; suggestions for `shared:app-id`. |
| `storage:smartscape:read` | Value suggestions from Smartscape nodes (`smartscapeNodes "*"`, `"PROCESS"`, `"ACTIVEGATE"`). |
| `storage:logs:read` | Value suggestions from sampled logs (field values, `log.source`). |
| `storage:spans:read` | Value suggestions from sampled spans. |
| `storage:metrics:read` | Value suggestions from metric series (`metrics` command, field values and metric keys). |
| `storage:events:read`, `storage:bizevents:read`, `storage:system:read` | `event.kind` / `event.type` / `event.provider` suggestions from `events`, `bizevents` and `dt.system.events`; entity types from `dt.system.data_objects`. |
| `storage:buckets:read` | Reading records from the buckets behind the tables above. |
| `storage:entities:read` | Entity ID suggestions from `dt.entity.process_group`, `dt.entity.host`, `dt.entity.host_group`. |
| `storage:bucket-definitions:read` | Buckets and tables from `dt.system.buckets` (`storage:bucket-name`, `storage:table-name`). |
| `settings:objects:read` | Management zone names (`builtin:management-zones`) for `environment:management-zone` / `extensions:management-zone`. |
| `settings:schemas:read` | Settings schema list for `settings:schemaId`; one schema definition (its groups) for `settings:schemaGroup`. |
| `extensions:definitions:read` | Extension names for `extensions:extension-name`. |

The `iam-reference` app function is the app's own function and needs no scope.

### User permissions

AppEngine apps act with the signed-in user's permissions, so suggestions only show what you can read yourself:
if you cannot read spans, the spans part of a value query fails or returns nothing, and so on. Building and copying
the text needs no permission. Creating the policy in Account Management needs account rights to manage IAM
policies there; that happens outside the app.

### One-time setup

- **Outbound connection to docs.dynatrace.com.** The permission catalogue is read live by the `iam-reference`
  app function. When the environment enforces the allowlist in
  `builtin:dt-javascript-runtime.allowed-outbound-connections`, add `docs.dynatrace.com`. Without it the tab works
  with the bundled snapshot and shows a warning banner with a link to that setting.
- No OAuth client or token is needed.

## Page walkthrough

### Layout and documentation link

Right-aligned above the tab: *IAM Policy Creator documentation*, a link to this page on GitHub
([`TabDocsLink`](../ui/app/areas.tsx#L86)). The tab is a two-column grid
(`repeat(auto-fit, minmax(min(100%, 560px), 1fr))`): the builder on the left, the policy editor on the right in a
card that stays in view while you scroll (`position: sticky`). On a narrow window the editor moves below the builder.

The whole tab sits inside `IamDraftsProvider` ([App.tsx](../ui/app/App.tsx#L170)), so switching tabs does not lose
work (see [Drafts](#drafts)).

### AI Assist panel

When the **AI Assist** button in the app header is on, the panel is shown at the top of the tab. See
[AI Assist on this page](#ai-assist-on-this-page).

### Heading and introduction

"IAM Policy Creator" and a paragraph that summarises the three steps, links the IAM policy reference and
Account Management, and says where to create the policy (Identity & access management > Policy management).

### Permission catalogue banner

`CatalogBanner` ([IamShared.tsx](../ui/app/tabs/IamShared.tsx#L71)) says where the list of permissions,
conditions and operators comes from. It is shared with the IAM Boundary Creator and the Permissions Test; the
docs are read once per page load for all three ([`load` in iamCatalog.ts](../ui/app/iamCatalog.ts#L230)).

| State | What you see |
| --- | --- |
| Loading | "Reading the IAM policy reference from docs.dynatrace.com… Until then the bundled snapshot of 2026-10-24 is used." The builder already works on the snapshot. |
| Live read succeeded | "Permissions, conditions and operators are read live from the IAM policy reference (updated `<page date>`) at `<local time>`." followed by either "No change since the bundled snapshot of 2026-10-24." or "Since the bundled snapshot of 2026-10-24: N new, N removed, N with changed conditions, N global condition changes." with **Show changes** / **Hide changes**. The list shows `New: <permission>`, `Removed: <permission> (still in drafts? the editor flags it)`, `<permission>: + <key> [ops]; − <key> [ops]`, `Global condition: <key> [ops]`, and the maintainer hint "run npm run sync-iam -- --write to refresh the snapshot". |
| Blocked by the allowlist | Warning "Using the bundled permission snapshot of 2026-10-24": "The live IAM policy reference could not be read: add docs.dynatrace.com to the allowed outbound connections (setting)." The *setting* link opens `builtin:dt-javascript-runtime.allowed-outbound-connections` in the Settings app (intent `dynatrace.settings` / `open_settings_for_schema`). Then "Permissions added to the docs after the snapshot are missing here; type them in the editor if you need them." and **Retry**. |
| Other failure | Same warning with the error text, for example "the iam-reference app function is not available in this running app (HTTP 404). Restart npx dt-app dev (or deploy), then retry." or "the iam-reference app function returned HTTP <status>: <first 300 characters of the body>" or "The IAM policy reference parsed to N services; the page layout may have changed." **Retry** re-reads the docs for every IAM tab. |

The snapshot ([iamSnapshot.json](../ui/app/iamSnapshot.json)) was captured on 2026-10-24 from the reference
updated 2026-10-08 (global conditions page updated 2026-10-20): 43 services, 228 permissions, 53 condition keys,
8 global conditions. The "changed" diff compares, per permission present in both, the set of
`<key> [sorted operators]` strings ([`diffCatalogs`](../ui/app/iamCatalog.ts#L186)).

Wherever the tab shows the source in messages, it says `live docs` or `snapshot of 2026-10-24`.

### Name and options

Card "Name and options" ([`NameCard`](../ui/app/tabs/IamPolicyTab.tsx#L242)):

| Control | Behaviour |
| --- | --- |
| **Name** (placeholder "e.g. Team A - logs and dashboards") | Written as the first comment line `// <name>` (when comments are on) and used for the export file name. |
| **Start from a docs pattern (replaces the selections)** | One of six policies copied from the docs (see [Docs patterns](#docs-patterns)), each shown with the docs page title. Choosing one loads its text into the builder with [Load this text into the builder](#load-this-text-into-the-builder): apps, data, dimensions, individual permissions and global conditions are replaced, the editor goes back to generated text, the step switches to 3, and a note says "<pattern>: loaded N statements into the builder (step 3)." |
| **Clear all** | Resets the policy draft to empty (and the hand-edited text) and closes the load note. |
| **Comments (section titles, and the apps behind each line)** | On by default. Off removes the header, block titles and trailing notes; `// ⚠ …` warning lines are always written. |
| **Fewer statements: combine permissions with the same conditions (off = one ALLOW per line)** | Off by default. On merges, inside each block, statements with the same effect and identical conditions into one statement listing every permission (see [Grammar](#grammar)). Use it when a policy nears 100 statements. |

### Step buttons

A toggle group switches the visible step; the current step is stored in the draft. Labels
([`StepNav`](../ui/app/tabs/IamPolicyTab.tsx#L288)):

- `1 · Apps`, with `(all)` when *Let the group open every app* is on, else `(N)` selected apps.
- `2 · Data access`, with `(included of needed)` data permissions once selected apps request Grail data, and ` ⚠`
  when a selected app with Read still misses required data.
- `3 · Fine-tune`, with `(N)` = individual permission rows + global conditions.

### Step 1: Apps

Card "Step 1 · Apps" ([`AppsStep`](../ui/app/tabs/IamPolicyTab.tsx#L312)). The hint text explains that each app is
granted on its own `app-engine:apps:run` line (with a *docs* link to that permission) followed by the permissions
it requests for the chosen levels, and that the warning icon marks apps that show Grail data.

- **Error:** if the App Registry cannot be read, a critical message "Could not read the installed apps (App
  Registry): <error>" is shown and no card appears.
- **Search apps**: case-insensitive substring of the app name or app ID.
- **Filter**: *All*, *Dynatrace* (`isBuiltin` true), *Custom* (`isBuiltin` false), *Selected* (apps in the draft).
- Counter: "N of M apps", or "Reading installed apps…" while loading.
- **App grid**: one card per app, sorted by name, `minmax(156px, 1fr)` columns, scrolls after 640 px.

**App card** ([`AppCard`](../ui/app/tabs/IamPolicyTab.tsx#L415)):

- The registry icon (32 px), loaded only when the card scrolls into view (200 px margin), at most 6 icons at a
  time; without an icon (or if it fails) the first letter of the name on a grey square. Hover shows the app ID.
- Click the card (or Space / Enter when focused) to select it: green border, green background, check mark, access
  level Read. Click again to remove it.
- **Access dropdown** (multi-select): offers *Read* always, and *Write* / *Execute* only when the manifest has such
  permissions. Each option shows "N permissions" (or "opens the app") and the level hint: Read "view: read, list,
  download", Write "change: write, delete, admin, restore, share", Execute "act: run, execute, use, send,
  invoke". Read adds "⚠ Needs Grail data: logs, entities (+N optional). Add it in step 2." when the app requests
  required table data; Write adds "⚠ Includes writing data into Grail: logs" when it includes `storage:<table>:write`
  or `…:ingest` permissions. Picking a level on an unselected card selects it; clearing every level keeps the app
  selected as *Open only* (only its `app-engine:apps:run` line and app state lines).
- **Data line** at the bottom (two lines high so dropdowns align): for apps whose Read needs data,
  "✓ Data access granted in step 2" (green) once all required tables are included, else "⚠ Needs data: logs,
  entities +N" (amber when selected, faded when not).

Below the grid:

- **Let the group open every app (one unconditional app-engine:apps:run, including apps installed later)**:
  replaces the per-app `app-engine:apps:run` lines with one `ALLOW app-engine:apps:run;`. The permissions of
  selected apps are still written.
- **Limit app state and app settings permissions to the selected apps (shared:app-id)**: on by default; adds
  `WHERE shared:app-id IN (…)` (or `=` for one app) to `state:*`, `state-management:*` and `app-settings:*` lines.

**Selected apps (N)** ([`SelectedApps`](../ui/app/tabs/IamPolicyTab.tsx#L544)), sorted by name. Each row: app name,
levels (or "Open only"), "N permissions" (level permissions plus app state permissions, minus the ones you
unticked), "N data permissions (step 2)" when Read is chosen and the app reads Grail data, "N left out" for skipped
scopes. **Customize** opens the permission list; **Remove** deselects the app. An app ID that is not installed
(for example loaded from text) shows "<id>: not installed in this environment (opened with its app ID only)."

The **Customize** list ([`AppPermissionList`](../ui/app/tabs/IamPolicyTab.tsx#L597)) groups the manifest scopes,
each with the manifest's comment, as checkboxes (untick to leave a permission out; stored per app in
`appExclude`):

- one group per chosen level, e.g. "Read (view: read, list, download)";
- "App state and app settings (always granted, limited to the app when that option is on)";
- "Grail data: granted in step 2" (only with Read);
- "Left out: not IAM policy permissions" (not editable, with the reason);
- "Open only: choose Read, Write or Execute in the app's dropdown to add its permissions." when no level is set.

When selected apps with Read miss required data, a warning says "<apps> show(s) Grail data the policy does not
grant yet (logs, metrics). Add it in step 2." **Next: Data access →** goes to step 2.

### Step 2: Data access

Card "Step 2 · Data access" ([`DataStep`](../ui/app/tabs/IamPolicyTab.tsx#L633)).

- While apps load: "Reading the installed apps…".
- No selected app with Read requests Grail data: "None of the selected apps with Read requests Grail data.
  Dimensional data below still applies to data permissions you add in step 3."
- Otherwise a toggle **Not now** / **Add data access** (default *Not now*). Nothing is written until *Add data
  access* is chosen; until then the policy text carries a `// ⚠ … shows Grail data this policy does not grant yet`
  line per app and the editor marks the app's line.
- A warning lists each app with its missing tables: "<App> (logs, entities); …: required data not granted, so
  these apps show no data."
- One checkbox per data permission the selected apps (with Read) request, sorted required first, then by name:
  `storage:logs:read  needed by Ops Notebook, Team Dashboards · optional for …`, with a *docs* link. Required
  permissions start ticked, optional ones (manifest comment contains "optional", or `storage:fieldsets:read`)
  start unticked. The list keeps its ticks while the toggle is *Not now* (it is faded to 55 % opacity).
- "storage:buckets:read is added for the tables you include, limited to logs, metrics." or, with a Grail bucket
  dimension, "limited by storage:bucket-name IN (…)". `storage:entities:read` and `storage:smartscape:read` have
  no buckets, so they add no table.
- Then the [dimensional data card](#limit-the-records-dimensional-data), and **← Back: Apps** /
  **Next: Fine-tune →**.

### Limit the records (dimensional data)

Card "Limit the records (dimensional data)" ([`DimensionsCard`](../ui/app/tabs/IamPolicyTab.tsx#L711)), shown in
step 2. Each dimension applies to every included data permission (and `storage:buckets:read` when added) and to
step 3 permissions with *Apply dimensional data* on, as long as the permission has a condition with that attribute.

- **A record must match**: *every dimension (AND)* (default; all dimensions in one statement) or *any dimension
  (OR)* (one statement per dimension). Status: "N dimensions set" or "none set: no record-level restriction".
- An accordion, one section per dimension. The list is derived from the catalogue: every `storage:` condition
  attribute except `table-name`, `fieldset-name`, `file-path`, `store-name` and `query-consumption`. With the
  snapshot:

| Label | Attribute | Condition keys | Operators offered (union) |
| --- | --- | --- | --- |
| Security context | `dt.security_context` | `storage:`, `settings:`, `synthetic:dt.security_context` | `=`, `IN`, `startsWith`, `MATCH` |
| Grail bucket | `bucket-name` | `storage:bucket-name` | `=`, `!=`, `IN`, `NOT IN`, `startsWith`, `NOT startsWith`, `MATCH` |
| Host group | `dt.host_group.id` | `storage:dt.host_group.id` | `=`, `IN`, `startsWith`, `MATCH` |
| Kubernetes cluster | `k8s.cluster.name` | `storage:`, `dev-obs:k8s.cluster.name` | all nine but `<`, `>` |
| Kubernetes namespace | `k8s.namespace.name` | `storage:`, `dev-obs:k8s.namespace.name` | all nine but `<`, `>` |
| Host name | `host.name` | `storage:`, `dev-obs:host.name` | all nine but `<`, `>` |
| AWS account | `aws.account.id` | `storage:aws.account.id` | `=`, `IN`, `startsWith`, `MATCH` |
| Azure subscription | `azure.subscription` | `storage:azure.subscription` | same |
| Azure resource group | `azure.resource.group` | `storage:azure.resource.group` | same |
| GCP project | `gcp.project.id` | `storage:gcp.project.id` | same |
| Frontend | `frontend.name` | `storage:frontend.name` | same |
| Event kind / type / provider | `event.kind`, `event.type`, `event.provider` | `storage:event.*` | same |
| Log source | `log.source` | `storage:log.source` | same |
| Metric key | `metric.key` | `storage:metric.key` | same |
| Entity type | `entity.type` | `storage:entity.type` | `=`, `IN`, `startsWith` |

A section label shows the current setting, e.g. `MATCH ("team-a")`. Inside ([`DimensionEditor`](../ui/app/tabs/IamPolicyTab.tsx#L749)):

- **Operator**: the operators at least one affected permission accepts (all of the dimension's operators when no
  permission is affected yet). The default is `IN` when offered, else the first.
- **Values**: a [value picker](#condition-rows-and-value-pickers) for the storage key, with the DQL actions of its
  suggestion query shown inline. **Clear** removes the dimension.
- "Condition keys: …. Applies to storage:logs:read, storage:metrics:read." or "No data permission in this policy
  supports it yet."
- When a permission does not support the chosen operator but an equivalent exists: "Written as = on
  storage:entities:read (MATCH is not supported there; same result)."
- When there is no equivalent (red): "<op> is not supported for <key> on <permission> and has no equivalent for
  these values; pick another operator or other values." The unsupported operator is still written, and the editor
  reports it as an error.

### Step 3: Fine-tune permissions

Card "Step 3 · Fine-tune permissions" ([`PermissionsCard`](../ui/app/tabs/IamPolicyTab.tsx#L796)): optional
individual permissions on top of what the apps need. "No individual permission added." when empty.

**Permission row** ([`PermissionRowEditor`](../ui/app/tabs/IamPolicyTab.tsx#L860)):

- The permission ID with a *docs* link, or "not in the IAM policy reference" (orange) for unknown IDs; below it the
  service title and description.
- **ALLOW / DENY** toggle; **+ Statement** adds another row for the same permission with the same effect and no
  conditions ("Another statement for this permission, combined with OR"); **Remove**.
- "One of several statements for this permission (OR)." when the permission has more than one row.
- **Apply dimensional data** (only for permissions with a dimension attribute; on for rows added from the
  browser, off for rows loaded from text): shows the conditions the row receives, joined with ` AND ` (AND mode) or
  ` | ` (OR mode), or "(no dimension set for this permission)".
- DENY note (orange): "Conditional DENY is not supported on Grail table permissions: this statement runs as an
  unconditional DENY." for a Grail table permission with conditions, else "DENY overrules every ALLOW, and
  boundaries never apply to it."
- One [condition row](#condition-rows-and-value-pickers) per condition. A condition the permission does not
  support gets "<permission> does not support this condition." (red).
- **Add condition**: a filterable select with two groups: "Conditions of this permission" (key with its operators)
  and "Global conditions". A new condition starts with `IN` when supported, else the first operator, and no value.
  "This permission has no conditions of its own; global conditions still apply." for permissions without
  conditions.

**Bucket hint**: when ALLOW rows include Grail table permissions, step 2 does not already add
`storage:buckets:read`, and no ALLOW row grants it, a message says "Grail table permissions also need
storage:buckets:read for the buckets that hold the data (logs, spans)." with **Add storage:buckets:read**. The added
row has `storage:table-name = "<table>"` (or `IN (…)` for several), or no condition when a Grail bucket dimension
is set (it then receives the bucket names through *Apply dimensional data*).

**Add permissions** ([`PermissionBrowser`](../ui/app/tabs/IamPolicyTab.tsx#L971)): a search box ("Search 228
permissions, e.g. logs, settings, workflows") matching permission ID, description or service title, and "N
selected". An accordion per service ("`storage` Grail · 39 · 2 selected"); while searching, every matching service
opens and shows "k of n". Inside: the service notes from the docs, a link "<service> in the IAM policy reference",
and one checkbox per permission with its description, "· N conditions" and a *docs* link. Ticking adds an ALLOW
row (no conditions, *Apply dimensional data* on); unticking removes every row of that permission. No match: "No
permission matches “…”. If it is new, type it in the editor; it is flagged until the docs list it."

**← Back: Data access** returns to step 2.

### Global conditions

Card "Global conditions" ([`GlobalsCard`](../ui/app/tabs/IamPolicyTab.tsx#L1049)), shown in step 3: "Added to every
statement (AND): environment, user, group, date and time. Use > and < together for a time window.", with links to
Policy global conditions and Policy templating. **Add global condition** lists the 8 documented global conditions
with the start of their description. Operators: the documented ones, or `=` when the docs list none.

| Key | Operators (snapshot) | Hint / placeholder | Suggestions |
| --- | --- | --- | --- |
| `global:environmentId` | none documented, `=` offered | Environment ID the request targets / `abc12345` | This environment's ID ("this environment") |
| `global:userId` | `=` | UUID of the user making the request | Your user ID ("you (<name or email>)") |
| `global:usernameDomain` | `=` | Domain of the user's name / `example.com` | Your email domain |
| `global:userGroup` | `=` | UUID of a group the user is a member of (not the group name) | none |
| `global:date` | `<`, `>`, `=` | Date with a time zone (Z = UTC) / `2026-05-03Z` | none |
| `global:date-time` | `<`, `>` | Date and time with a time zone / `2026-05-03T05:00:00+01:00` | none |
| `global:time-of-day` | `<`, `>` | Time of day with a time zone / `09:00+01:00` | none |
| `global:week-day` | `=`, `!=`, `IN` | Day of the week (GMT) / `Monday` | Monday … Sunday |

The environment and user suggestions come from `getEnvironmentId()` and `getCurrentUserDetails()` of
`@dynatrace-sdk/app-environment` (no API call).

### Condition rows and value pickers

`ConditionRow` and `ValuePicker` ([IamShared.tsx](../ui/app/tabs/IamShared.tsx#L198)) are used by step 3 rows,
global conditions and the dimension editors.

- **Operator select**: the supported operators in the order `=`, `!=`, `IN`, `NOT IN`, `startsWith`,
  `NOT startsWith`, `MATCH`, `<`, `>`. A current operator that is not supported is listed as `⚠ <op>`. Hover shows
  what it means (e.g. MATCH "matches any pattern of a list (* wildcard); also matches multi-value (array) fields").
  Switching to a single-value operator keeps only the first value.
- **Values**: `IN`, `NOT IN` and `MATCH` take a list (multi-select), the others one value.
- Suggestions load the first time the picker opens ("Loading values from the tenant…", or "Could not load
  suggestions: <error>"). The list shows selected values first, then up to 200 other suggestions ("N more: type to
  filter"); typing filters on value, label and detail. Options read "<label> — <value>" plus a grey detail (the
  bucket's table, the sources a field value was seen on, the app ID, the schema ID, "active <version>" for
  extensions).
- Always offered: `${global:userId}` ("UUID of the user making the request") and `${global:userGroup}` ("UUIDs of
  the user's groups (use with IN)") from Policy global attributes.
- Typing offers **Add "<text>"** (when it is not already a suggestion) and **Add binding parameter
  `${bindParam:<text>}`** (characters other than letters, digits, `_`, `.`, `-` become `-`; not offered when the text
  starts with `${`).
- Under the picker: the key's hint, and, for DQL-backed keys, **Values query** / **Hide values query**, which shows the
  source note and the query actions **Show DQL**, **Copy**, **↗ Open in Notebook** (intent `dynatrace.notebooks` /
  `view-query`) and **↗ Add to Dashboard** (`dynatrace.dashboards` / `add-to-dashboard`). In the dimension
  editors these actions are always shown.
- `settings:schemaGroup` adds a lookup: a schema ID box ("e.g. builtin:monitoring.slo") and **Look up groups**,
  which reads that schema's definition and offers one **+ group:…** button per group ("This schema has no groups."
  or the error otherwise).

Where each key's suggestions come from is listed under [Queries](#queries) and [API calls](#api-calls).

### Policy editor (right pane)

`EditorPane` ([IamShared.tsx](../ui/app/tabs/IamShared.tsx#L455)), title "Policy":

- Header counter: "N of 100 statements · N errors · N warnings" (errors red and warnings amber when non-zero). N
  counts every text segment that starts with ALLOW or DENY, including ones with errors.
- A code editor (460 px, line wrap, lint gutter). Placeholder: "Select apps on the left, or type / paste a policy,
  e.g. ALLOW storage:logs:read WHERE storage:dt.security_context = "TeamA";". Problems are underlined and marked in
  the gutter; hover for the message.
- Typing makes the text **hand-edited**: "Edited by hand: the selections on the left no longer change this text."
  with **Discard edits and regenerate** (back to the generated text) and **Load this text into the builder** (see
  [below](#load-this-text-into-the-builder)). If your edits make the text identical to the generated one, it goes
  back to generated mode.
- A load note after a template or *Load this text*: green "…: loaded N statements into the builder (step 3)." or,
  when parts could not be read, amber "… N parts could not be read and were left out: <first 80 characters of
  each> | …", with **Dismiss**.
- **Copy to clipboard** and **Export .txt** (both disabled for empty text).
- The diagnostics list (scrolls after 220 px): one line per problem, "ERROR / WARNING / INFO Line N: <message>",
  sorted by position.
- "IAM documentation" links (the ten pages listed under [What this page answers](#what-this-page-answers)).

### Copy to clipboard and Export .txt

- **Copy to clipboard** writes the editor text (hand edits included) with `navigator.clipboard.writeText`. If the
  frame has no async clipboard API it falls back to a hidden textarea and `document.execCommand("copy")`. The button
  row shows "Copied", or the error ("The browser blocked clipboard access.") for 2 seconds.
- **Export .txt** downloads the editor text as `text/plain;charset=utf-8`. File name: the policy name with every run
  of characters other than `A-Z a-z 0-9 . _ -` replaced by `-`, leading / trailing `-` removed, plus `.txt`;
  `iam-policy.txt` when the name is empty. Example: "Team A - logs and dashboards" becomes
  `Team-A---logs-and-dashboards.txt`.

Both are local browser actions; nothing is sent to the tenant.

### Drafts

[`IamDraftsProvider`](../ui/app/iamDrafts.tsx) keeps the policy draft, the hand-edited text (or null), the boundary
draft, its text and the boundary preview text above the tabs and in the browser's `localStorage` under
`iam-assistant.iam-drafts.v2`, written 400 ms after the last change. Work survives tab switches and reloads in
the same browser and app origin. Drafts from the first version (`…v1`, with `apps: {mode, ids}`) are migrated:
`mode: "all"` becomes *Let the group open every app*, selected IDs become *Open only* apps, combining is turned off
and the step set to 3. Fields added later get their defaults. If storage is full or blocked, the draft lives for the
page load only. The Permissions Test tab's *Policy Creator draft* mode tests this draft.

## Policy text the app writes

Generated by [`policyBlocks` and `renderPolicy`](../ui/app/iamPolicy.ts#L176).

### Grammar

```
policy     = [ "// " name NL ] "// Built with IAM Assistant against the IAM policy reference" [ " (updated " date ")" ] NL
             { NL "// " block-title NL { line NL } }          (comments on)
           | { line NL }                                       (comments off: no header, titles or notes)
line       = statement [ "  // " note ]                        (note only with comments on)
           | "// " warning                                     (always written)
statement  = effect " " permission { ", " permission } [ " WHERE " condition { " AND " condition } ] ";"
effect     = "ALLOW" | "DENY"
permission = service ":" resource ":" action
condition  = key " " operator " " ( "(" quoted { ", " quoted } ")"     for IN, NOT IN, MATCH
                                  | quoted )                          for =, !=, startsWith, NOT startsWith, <, >
quoted     = '"' value-with-\-and-"-escaped-by-backslash '"'
```

- The header date is the reference's page date (`updated` of the live docs, or 2026-10-08 in the snapshot).
- Without *Fewer statements*, each statement has one permission. With it, statements of one block with the same
  effect and identical condition text are merged (permissions in order of first appearance, notes merged).
- `=` is written for one value and `IN (…)` for several wherever the app builds a `shared:app-id` or
  `storage:table-name` condition.
- Blank conditions (no value) are left out. A condition order inside a statement: app / table conditions or the
  row's own conditions, then dimension conditions (in the order the dimensions were last edited), then global
  conditions.
- Text with no statement renders as empty (the editor shows its placeholder).

### Block order and line order

| # | Block title | Lines |
| --- | --- | --- |
| 1 | `Apps` | One `ALLOW app-engine:apps:run WHERE shared:app-id = "<id>";  // <app name>` per selected app, sorted by app name; or `ALLOW app-engine:apps:run;  // every installed app`. |
| 2 | `App state and app settings` + ` (limited to the selected apps)` when that option is on | `state:*`, `state-management:*`, `app-settings:*` permissions of the selected apps (any level), sorted by permission, with `shared:app-id` of the apps that request each one. |
| 3 | `Read`, `Write`, `Execute` | The other manifest permissions of the chosen levels, sorted by permission; note = names of the apps that need it. |
| 4 | `Data access` | Included data permissions (required first, then by name), each with its dimension conditions (one statement per dimension in OR mode); then `storage:buckets:read` with `storage:table-name` of the included tables (or the bucket dimension) `// bucket access for the tables above`; then one `// ⚠ <App> shows Grail data this policy does not grant yet (logs, entities): add it in step 2, Data access` per gap. |
| 5+ | One block per service title of step 3 rows (`Grail`, `Settings service`, …), in order of first row | Each row, with its own conditions, dimensions (when *Apply dimensional data* is on) and globals. |

While the App Registry is still loading (or failed), selected apps are written with their IDs as notes, followed
by a block `App permissions` with `// Reading the permissions the selected apps request…`.

### How app scopes become permissions

[`summarizeApp`](../ui/app/iamApps.ts#L55) sorts every scope in an app's manifest (deduplicated):

| Scope | Kind | Where it goes |
| --- | --- | --- |
| `app-engine:apps:run` in the manifest | skip | Left out: "lets the app open other apps; opening this app is granted on its own line". |
| Not a permission in the IAM reference (e.g. `environment-api:entities:read`) | skip | Left out: "not an IAM policy permission (an app scope only)". |
| `state:`, `state-management:`, `app-settings:` with a `shared:app-id` condition | owned | App state block, at every level (including *Open only*). |
| `storage:` with a condition on a dimension attribute | data | Step 2 (only with Read). `storage:buckets:read` itself is not listed; it is added for the included tables. Optional when the manifest comment contains "optional" (any case) or the scope is `storage:fieldsets:read`. |
| Anything else | app | Read / Write / Execute block by the action (last segment). |

Action to level ([`levelOf`](../ui/app/iamApps.ts#L29)):

- **Read:** `read`, `list`, `lookup`, `download`, `load`, `resolve`.
- **Execute:** `execute`, `run`, `use`, `send`, `authenticate`, `invoke`, `validate`, `connect`, `set`.
- **Write:** everything else (`write`, `delete`, `admin`, `share`, `install`, `restore`, `ingest`, …).

An app offers Write / Execute only when it has app-kind permissions at that level; Read is always offered.

### How dimensions become conditions

[`dimensionConditions`](../ui/app/iamPolicy.ts#L126): for each dimension with a value, every condition of the
permission whose attribute (key without the `service:` prefix) equals the dimension attribute gets the dimension's
operator and values. A permission without that attribute gets nothing for that dimension (it stays unrestricted
for it). When the permission does not support the operator, [`adaptOperator`](../ui/app/iamPolicy.ts#L115) picks
an equivalent:

| Chosen | Values | Written as |
| --- | --- | --- |
| `MATCH` | no `*` in any value | `=` for one value (when supported), else `IN` |
| `MATCH` | exactly one value of the form `prefix*` | `startsWith "prefix"` (the `*` removed) |
| `IN` | one value | `=` |
| anything else unsupported | | written unchanged; the editor reports an error |

Example: `storage:entities:read` supports `=`, `IN`, `startsWith` for `storage:dt.security_context`, so a Security
context dimension `MATCH ("team-a")` is written as `= "team-a"` there and as `MATCH ("team-a")` on
`storage:logs:read`.

### Full examples

These examples use two placeholder custom apps whose manifests request:

- **Team Dashboards** (`my.team.dashboards`): `storage:logs:read`, `storage:spans:read` "(Optional) show traces next
  to the logs", `storage:buckets:read`, `storage:entities:read`, `state:app-states:read`, `state:app-states:write`,
  `document:documents:read`, `document:documents:write`, `automation:workflows:run`, `environment-api:entities:read`,
  `app-engine:apps:run`.
- **Ops Notebook** (`my.ops.notebook`): `storage:logs:read`, `storage:metrics:read`, `storage:logs:write`,
  `davis:analyzers:execute`, `settings:objects:read`, `app-settings:objects:read`.

The text below was produced by running `renderPolicy` on the snapshot catalogue.

**1. Step 1 only.** Team Dashboards with Read; Ops Notebook with Read, Write and Execute; name "Team A - logs and
dashboards"; data access not added yet:

```
// Team A - logs and dashboards
// Built with IAM Assistant against the IAM policy reference (updated 2026-10-08)

// Apps
ALLOW app-engine:apps:run WHERE shared:app-id = "my.ops.notebook";  // Ops Notebook
ALLOW app-engine:apps:run WHERE shared:app-id = "my.team.dashboards";  // Team Dashboards

// App state and app settings (limited to the selected apps)
ALLOW app-settings:objects:read WHERE shared:app-id = "my.ops.notebook";  // Ops Notebook
ALLOW state:app-states:read WHERE shared:app-id = "my.team.dashboards";  // Team Dashboards
ALLOW state:app-states:write WHERE shared:app-id = "my.team.dashboards";  // Team Dashboards

// Read
ALLOW document:documents:read;  // Team Dashboards
ALLOW settings:objects:read;  // Ops Notebook

// Write
ALLOW storage:logs:write;  // Ops Notebook

// Execute
ALLOW davis:analyzers:execute;  // Ops Notebook

// Data access
// ⚠ Team Dashboards shows Grail data this policy does not grant yet (logs, entities): add it in step 2, Data access
// ⚠ Ops Notebook shows Grail data this policy does not grant yet (logs, metrics): add it in step 2, Data access
```

Team Dashboards' Write level was not chosen, so `document:documents:write` is not written; its
`state:app-states:write` is written anyway because app state permissions come with every level. The editor adds a
warning on each app's `app-engine:apps:run` line.

**2. Data access added, AND mode.** Dimensions: Security context `MATCH ("team-a")`, Kubernetes namespace
`IN ("shop-prod", "shop-stage")`. The Data access block becomes:

```
// Data access
ALLOW storage:entities:read WHERE storage:dt.security_context = "team-a";  // Team Dashboards
ALLOW storage:logs:read WHERE storage:dt.security_context MATCH ("team-a") AND storage:k8s.namespace.name IN ("shop-prod", "shop-stage");  // Ops Notebook, Team Dashboards
ALLOW storage:metrics:read WHERE storage:dt.security_context MATCH ("team-a") AND storage:k8s.namespace.name IN ("shop-prod", "shop-stage");  // Ops Notebook
ALLOW storage:buckets:read WHERE storage:table-name IN ("logs", "metrics");  // bucket access for the tables above
```

`storage:entities:read` has no namespace condition and does not support MATCH, so it gets `=` and only the security
context. The optional `storage:spans:read` is not included until ticked.

**3. Same, OR mode** (*any dimension*):

```
// Data access
ALLOW storage:entities:read WHERE storage:dt.security_context = "team-a";  // Team Dashboards
ALLOW storage:logs:read WHERE storage:dt.security_context MATCH ("team-a");  // Ops Notebook, Team Dashboards
ALLOW storage:logs:read WHERE storage:k8s.namespace.name IN ("shop-prod", "shop-stage");  // Ops Notebook, Team Dashboards
ALLOW storage:metrics:read WHERE storage:dt.security_context MATCH ("team-a");  // Ops Notebook
ALLOW storage:metrics:read WHERE storage:k8s.namespace.name IN ("shop-prod", "shop-stage");  // Ops Notebook
ALLOW storage:buckets:read WHERE storage:table-name IN ("logs", "metrics");  // bucket access for the tables above
```

**4. Grail bucket dimension** `IN ("default_logs", "team_a_logs")` only: the bucket line takes the dimension
instead of the table list, and `storage:entities:read` (no bucket condition) stays unconditional:

```
// Data access
ALLOW storage:entities:read;  // Team Dashboards
ALLOW storage:logs:read WHERE storage:bucket-name IN ("default_logs", "team_a_logs");  // Ops Notebook, Team Dashboards
ALLOW storage:metrics:read WHERE storage:bucket-name IN ("default_logs", "team_a_logs");  // Ops Notebook
ALLOW storage:buckets:read WHERE storage:bucket-name IN ("default_logs", "team_a_logs");  // bucket access for the tables above
```

**5. Step 3 and global conditions.** Example 2 plus *Limit app state…* off; rows `settings:objects:read` with
`settings:schemaId startsWith "builtin:logmonitoring"` (dimensional data on), `storage:events:read` with
`storage:event.kind IN ("DAVIS_PROBLEM", "DAVIS_EVENT")` (dimensional data on), `DENY storage:spans:read`; global
conditions `global:time-of-day > "08:00+01:00"` and `global:time-of-day < "18:00+01:00"`:

```
// Team A - logs and dashboards
// Built with IAM Assistant against the IAM policy reference (updated 2026-10-08)

// Apps
ALLOW app-engine:apps:run WHERE shared:app-id = "my.ops.notebook" AND global:time-of-day > "08:00+01:00" AND global:time-of-day < "18:00+01:00";  // Ops Notebook
ALLOW app-engine:apps:run WHERE shared:app-id = "my.team.dashboards" AND global:time-of-day > "08:00+01:00" AND global:time-of-day < "18:00+01:00";  // Team Dashboards

// App state and app settings
ALLOW app-settings:objects:read WHERE global:time-of-day > "08:00+01:00" AND global:time-of-day < "18:00+01:00";  // Ops Notebook
ALLOW state:app-states:read WHERE global:time-of-day > "08:00+01:00" AND global:time-of-day < "18:00+01:00";  // Team Dashboards
ALLOW state:app-states:write WHERE global:time-of-day > "08:00+01:00" AND global:time-of-day < "18:00+01:00";  // Team Dashboards

// Read
ALLOW document:documents:read WHERE global:time-of-day > "08:00+01:00" AND global:time-of-day < "18:00+01:00";  // Team Dashboards
ALLOW settings:objects:read WHERE global:time-of-day > "08:00+01:00" AND global:time-of-day < "18:00+01:00";  // Ops Notebook

// Write
ALLOW storage:logs:write WHERE global:time-of-day > "08:00+01:00" AND global:time-of-day < "18:00+01:00";  // Ops Notebook

// Execute
ALLOW davis:analyzers:execute WHERE global:time-of-day > "08:00+01:00" AND global:time-of-day < "18:00+01:00";  // Ops Notebook

// Data access
ALLOW storage:entities:read WHERE storage:dt.security_context = "team-a" AND global:time-of-day > "08:00+01:00" AND global:time-of-day < "18:00+01:00";  // Team Dashboards
ALLOW storage:logs:read WHERE storage:dt.security_context MATCH ("team-a") AND storage:k8s.namespace.name IN ("shop-prod", "shop-stage") AND global:time-of-day > "08:00+01:00" AND global:time-of-day < "18:00+01:00";  // Ops Notebook, Team Dashboards
ALLOW storage:metrics:read WHERE storage:dt.security_context MATCH ("team-a") AND storage:k8s.namespace.name IN ("shop-prod", "shop-stage") AND global:time-of-day > "08:00+01:00" AND global:time-of-day < "18:00+01:00";  // Ops Notebook
ALLOW storage:buckets:read WHERE storage:table-name IN ("logs", "metrics") AND global:time-of-day > "08:00+01:00" AND global:time-of-day < "18:00+01:00";  // bucket access for the tables above

// Settings service
ALLOW settings:objects:read WHERE settings:schemaId startsWith "builtin:logmonitoring" AND settings:dt.security_context = "team-a" AND global:time-of-day > "08:00+01:00" AND global:time-of-day < "18:00+01:00";

// Grail
ALLOW storage:events:read WHERE storage:event.kind IN ("DAVIS_PROBLEM", "DAVIS_EVENT") AND storage:dt.security_context MATCH ("team-a") AND storage:k8s.namespace.name IN ("shop-prod", "shop-stage") AND global:time-of-day > "08:00+01:00" AND global:time-of-day < "18:00+01:00";
DENY storage:spans:read WHERE global:time-of-day > "08:00+01:00" AND global:time-of-day < "18:00+01:00";
```

The editor reports: WARNING "Conditional DENY is not supported on Grail table permissions (storage:spans:read): it
runs as an unconditional DENY." and INFO "Boundaries never apply to DENY statements." Note that the global
conditions also make the DENY conditional.

**6. Same with *Fewer statements*.** Blocks merge statements with identical conditions, for example:

```
// App state and app settings
ALLOW app-settings:objects:read, state:app-states:read, state:app-states:write WHERE global:time-of-day > "08:00+01:00" AND global:time-of-day < "18:00+01:00";  // Ops Notebook, Team Dashboards

// Read
ALLOW document:documents:read, settings:objects:read WHERE global:time-of-day > "08:00+01:00" AND global:time-of-day < "18:00+01:00";  // Team Dashboards, Ops Notebook
...
// Data access
ALLOW storage:entities:read WHERE storage:dt.security_context = "team-a" AND global:time-of-day > "08:00+01:00" AND global:time-of-day < "18:00+01:00";  // Team Dashboards
ALLOW storage:logs:read, storage:metrics:read WHERE storage:dt.security_context MATCH ("team-a") AND storage:k8s.namespace.name IN ("shop-prod", "shop-stage") AND global:time-of-day > "08:00+01:00" AND global:time-of-day < "18:00+01:00";  // Ops Notebook, Team Dashboards
```

Statements in different blocks are never merged (the Settings service row stays separate from the Read line).

**7. Comments off** (example 2):

```
ALLOW app-engine:apps:run WHERE shared:app-id = "my.ops.notebook";
ALLOW app-engine:apps:run WHERE shared:app-id = "my.team.dashboards";
ALLOW app-settings:objects:read WHERE shared:app-id = "my.ops.notebook";
ALLOW state:app-states:read WHERE shared:app-id = "my.team.dashboards";
ALLOW state:app-states:write WHERE shared:app-id = "my.team.dashboards";
ALLOW document:documents:read;
ALLOW settings:objects:read;
ALLOW storage:logs:write;
ALLOW davis:analyzers:execute;
ALLOW storage:entities:read WHERE storage:dt.security_context = "team-a";
ALLOW storage:logs:read WHERE storage:dt.security_context MATCH ("team-a") AND storage:k8s.namespace.name IN ("shop-prod", "shop-stage");
ALLOW storage:metrics:read WHERE storage:dt.security_context MATCH ("team-a") AND storage:k8s.namespace.name IN ("shop-prod", "shop-stage");
ALLOW storage:buckets:read WHERE storage:table-name IN ("logs", "metrics");
```

**8. Every app:** `// Apps` / `ALLOW app-engine:apps:run;  // every installed app`.

### What the parser accepts when you type or paste

[`parsePolicy`](../ui/app/iamPolicy.ts#L438) reads any text, not only what the builder writes:

- `//` comments to the end of the line are ignored (outside quotes).
- Statements are separated by `;` outside quotes and parentheses; line breaks are free.
- `ALLOW`, `DENY`, `WHERE`, `AND`, `IN`, `NOT IN`, `startsWith`, `NOT startsWith`, `MATCH` are case-insensitive
  and written back in canonical case (`not startswith` reads as `NOT startsWith`).
- Values in double or single quotes; `\` escapes the next character. The builder always writes double quotes and
  escapes `\` and `"`.
- A condition key starts with a letter and contains letters, digits, `_`, `.`, `:`, `-`.
- Several permissions are separated by commas. `OR` is rejected (write a second statement).

### Load this text into the builder

[`draftFromPolicyText`](../ui/app/iamPolicy.ts#L668), used by **Load this text into the builder** and by the docs
patterns:

1. The text is parsed. Statements with a syntax error (a parse error inside them) are left out and listed in the
   load note. Format checks that only the validator makes (for example a permission without two colons) do not
   stop loading.
2. A global condition present, with the same text, in every loadable statement goes to **Global conditions** and
   is removed from the statements.
3. `ALLOW app-engine:apps:run;` (after step 2, no other condition) turns on *Let the group open every app*.
4. `ALLOW app-engine:apps:run WHERE shared:app-id = "…"` or `IN (…)` (only that condition) selects each app as
   *Open only*.
5. Every other statement becomes one step 3 row per permission, with the statement's effect and remaining
   conditions, *Apply dimensional data* off.
6. App levels, data access, dimensions and earlier rows are cleared; name and options are kept; the step is set to 3;
   the editor returns to generated text.

The note counts loaded statements. Example: loading

```
ALLOW app-engine:apps:run WHERE shared:app-id IN ("my.team.dashboards", "my.ops.notebook") AND global:week-day IN ("Monday");
ALLOW storage:logs:read WHERE storage:dt.security_context = "a" AND global:week-day IN ("Monday");
ALLOW app-engine:apps:run WHERE global:week-day IN ("Monday");
ALLOW storage:logs:read WHERE storage:x = a AND global:week-day IN ("Monday");
```

gives two *Open only* apps, *Let the group open every app* on, one row `storage:logs:read` with
`storage:dt.security_context = "a"`, global condition `global:week-day IN ("Monday")`, "loaded 3 statements", and
the fourth statement (unquoted value) listed as left out.

### Docs patterns

[`POLICY_TEMPLATES`](../ui/app/iamPolicy.ts#L726), statements copied from the docs pages they cite; all six
validate without diagnostics:

| Pattern | Docs page | Text |
| --- | --- | --- |
| Read all default monitoring data | Permissions in Grail | `ALLOW storage:buckets:read WHERE storage:bucket-name MATCH ("default_*");` `ALLOW storage:events:read, storage:logs:read, storage:metrics:read, storage:entities:read, storage:bizevents:read, storage:spans:read, storage:smartscape:read;` |
| Read all data | Permissions in Grail | `ALLOW storage:buckets:read;` `ALLOW storage:system:read, storage:events:read, storage:security.events:read, storage:logs:read, storage:metrics:read, storage:entities:read, storage:bizevents:read, storage:spans:read, storage:smartscape:read;` |
| Read all system data | Permissions in Grail | `ALLOW storage:buckets:read WHERE storage:bucket-name MATCH ("dt_*");` `ALLOW storage:system:read;` |
| Access to all logs | Permissions in Grail | `ALLOW storage:buckets:read WHERE storage:table-name = "logs";` `ALLOW storage:logs:read;` |
| Settings Reader | Grant access to Settings | `ALLOW settings:objects:read, settings:schemas:read;` |
| Settings Writer | Grant access to Settings | `ALLOW settings:objects:read, settings:objects:write, settings:schemas:read;` |

Loaded into the builder, a pattern is written one permission per line. "Read all default monitoring data" becomes:

```
// Built with IAM Assistant against the IAM policy reference (updated 2026-10-08)

// Grail
ALLOW storage:buckets:read WHERE storage:bucket-name MATCH ("default_*");
ALLOW storage:events:read;
ALLOW storage:logs:read;
ALLOW storage:metrics:read;
ALLOW storage:entities:read;
ALLOW storage:bizevents:read;
ALLOW storage:spans:read;
ALLOW storage:smartscape:read;
```

## Checks and scoring

The tab has no gauges or coverage scores. Its checks are the editor diagnostics below, which run on the editor text
on every change ([`validatePolicy`](../ui/app/iamPolicy.ts#L511) plus `appDiagnostics` in
[IamPolicyTab.tsx](../ui/app/tabs/IamPolicyTab.tsx#L79)), and the AI Assist rules.

### Editor validation rules

`<source>` is `live docs` or `snapshot of 2026-10-24`.

| Severity | Rule | Message |
| --- | --- | --- |
| error | Segment does not start with ALLOW / DENY | A statement starts with ALLOW or DENY, e.g. ALLOW storage:logs:read; |
| warning | Last statement without `;` | End the statement with a semicolon (;). |
| error | Quote not closed before the line end | This quote is never closed. |
| error | Empty permission in a list (`a, ;`) | Missing permission. |
| error | Permission not `service:resource:action` (letters, digits, `-`, `.`) | A permission has the form service:resource:action, e.g. storage:logs:read. |
| warning | Permission not in the catalogue | `<p>` is not in the IAM policy reference (`<source>`). Check the spelling, or the docs if it is new. |
| error | Statement number 101 (reported once) | A policy can hold at most 100 statements; split it into several policies or combine permissions that share conditions. |
| error | `WHERE` / `AND` with nothing after it | WHERE (or AND) is not followed by a condition. |
| error | `OR` in conditions | OR is not supported. Write a second statement instead; statements are combined with OR. |
| error | Condition not `key op value` | Write the condition as <service:attribute> <operator> "value" (operators: =, !=, IN, NOT IN, startsWith, NOT startsWith, MATCH, <, >). |
| error | Value not quoted / typographic quotes / empty | Put the value in double quotes, e.g. "value". / Use straight quotes (") around values, not typographic quotes. / Add a value. |
| error | List not closed / empty list | Close the list of values with ). / The list is empty. |
| error | List operator with one value | `<op>` takes a list in parentheses, e.g. ("a", "b"). |
| error | Single-value operator with a list | `<op>` takes one value; use IN (or MATCH) for a list. |
| error | Condition key unknown to every permission | `<key>` is not a condition of any permission in the IAM policy reference (`<source>`). |
| error | A known permission of the statement lacks the key | `<p>` does not support `<key>` (supported: …) or (it has no conditions). |
| error | Operator not supported for the key on that permission | `<op>` is not supported for `<key>` on `<p>` (supported: …). |
| warning | Unknown `global:` key | `<key>` is not a documented global condition. |
| error | Global operator not documented | `<op>` is not supported for `<key>` (supported: …). |
| info | Global with no documented operators used with a non-`=` operator | The docs list no operators for `<key>`; their examples use =. |
| warning | `storage:query-consumption` other than `INCLUDED` / `ON_DEMAND` | storage:query-consumption must be "INCLUDED" or "ON_DEMAND"; for any other value the statement is ignored. |
| warning | `global:week-day` value not a day name | Use a day name: Monday … Sunday (GMT). |
| warning | `global:date`, `global:date-time`, `global:time-of-day` without `Z` or `±hh:mm` | `<key>` needs a time zone (Z for UTC, or +hh:mm), e.g. "2026-05-03Z" / "09:00+01:00" / "2026-05-03T05:00:00+01:00". |
| info | `${bindParam:…}` in a value | Binding parameter: its value is set when the policy is bound to a group, which only the Account Management API supports (see Policy templating). |
| info | `MATCH` value with `*` not at the start, end, or next to `-`, `_`, `.`, `/` | MATCH performs best with wildcards next to a word separator (-, _, . or /), e.g. "db-tech-*". |
| warning | DENY with conditions on a Grail table permission (not `storage:buckets:read`) | Conditional DENY is not supported on Grail table permissions (…): it runs as an unconditional DENY. |
| warning | DENY without conditions | An unconditional DENY blocks the permission for everyone this policy is bound to, whatever else they are granted. Prefer ALLOW statements with conditions, or boundaries. |
| info | First DENY in the policy | Boundaries never apply to DENY statements. |
| info | Grail table permission and no `storage:buckets:read` anywhere | Grail table permissions also need storage:buckets:read for the buckets that hold the data. |
| warning | A selected app with Read misses required data (on its `app-engine:apps:run` line, else line 1) | `<App>` shows Grail data this policy does not grant (logs, entities); add it in step 2, Data access. |

Grail tables recognised ([`grailTableOf`](../ui/app/iamCatalog.ts#L158)): `logs`, `events`, `metrics`, `spans`,
`bizevents`, `security.events`, `user.events`, `user.sessions`, `user.replays`, `application.snapshots`, and
`storage:system:read` → `dt.system.events`. `storage:entities:read` and `storage:smartscape:read` have no buckets.

The app-data warning counts a permission as granted when any error-free ALLOW statement names it, whatever its
conditions; hand-added grants count.

## Queries

All queries are value suggestions; none feeds a score. Each runs only when its picker is opened (or its *Values
query* toggle is used), through `useDqlWhen` ([useDql.ts](../ui/app/useDql.ts#L18)); after that it re-runs when
the timeframe changes, because the text changes. The app timeframe (24 hours default, 7 days, 30 days) sets
`from:`; logs and spans use `samplingRatio:10000` for 24 h and `100000` for 7 and 30 days; every `fetch` on logs,
spans and events is capped at 5 GB (`scanLimitGBytes:5`); the `metrics` command reads at most 10 days, so 30 d
uses `from:now()-10d`.

| # | Name (function) | Condition keys | Runs when |
| --- | --- | --- | --- |
| 1 | Field values (`iamFieldValuesQuery`) | every dimension not listed below (`storage:dt.security_context`, `storage:dt.host_group.id`, `storage:k8s.*`, `storage:host.name`, cloud accounts, `storage:frontend.name`), `settings:dt.security_context`, `synthetic:dt.security_context`, `dev-obs:k8s.cluster.name`, `dev-obs:k8s.namespace.name`, `dev-obs:host.name`, `dev-obs:host.group` (field `dt.host_group.id`) | picker opened |
| 2 | Event field values (`iamEventFieldValuesQuery`) | `storage:event.kind`, `storage:event.type`, `storage:event.provider`, `openpipeline:event-type`, `openpipeline:event-provider` | picker opened |
| 3 | Log sources (`iamLogSourcesQuery`) | `storage:log.source` | picker opened |
| 4 | Metric keys (`iamMetricKeysQuery`) | `storage:metric.key` | picker opened |
| 5 | Grail buckets (`IAM_BUCKETS_QUERY`) | `storage:bucket-name` | picker opened |
| 6 | Grail tables (`IAM_TABLES_QUERY`) | `storage:table-name` | picker opened |
| 7 | Entity types (`IAM_ENTITY_TYPES_QUERY`) | `storage:entity.type` | picker opened |
| 8 | Process group names (`iamProcessGroupNamesQuery`) | `dev-obs:dt.process_group.detected_name` | picker opened |
| 9 | Entity IDs (`iamEntityIdsQuery`) | `dev-obs:dt.entity.process_group` (process groups), `extensions:host` (hosts), `extensions:host-group`, `settings:entity.hostGroup` (host groups) | picker opened |
| 10 | ActiveGate groups (`iamActiveGateGroupsQuery`) | `extensions:ag-group` | picker opened |

Keys without a query: fixed values (`automation:workflow-type`: SIMPLE, STANDARD; `iam-param:entity-type`: group,
user; `app-engine:app-installer` and `iam:service-user-owner`: `${global:userId}`; `settings:scope`: environment;
`storage:fieldset-name`: builtin-sensitive-spans, builtin-request-attributes-spans,
builtin-sensitive-user-events-and-sessions; `storage:file-path`: /lookups/, /dt/; `storage:query-consumption`:
INCLUDED, ON_DEMAND), `oauth2:scopes` (every permission ID in the catalogue), API sources (see
[API calls](#api-calls)), and free text only (`iam-param:entity-id`, `iam:boundGroup`, `iam:levelType`,
`iam:policyUuid`, `iam:service-user-email`, `storage:store-name`, `settings:schemaGroup` with its lookup, and the
global conditions apart from the suggestions in [Global conditions](#global-conditions)). Hints for
`extensions:host`, `extensions:host-group` and `settings:entity.hostGroup` say the reference does not document the
value format and that the suggestions are entity IDs.

### 1. Field values

- **Source:** `iamFieldValuesQuery(tf, field)` in [queries.ts](../ui/app/queries.ts#L1324); mapping in
  [`valueInfo`](../ui/app/iamValues.ts#L58).
- **Runs:** when the picker for one of the keys above opens; re-runs on timeframe change.
- **Parameters:** `field` (the attribute, in backticks), timeframe. Query title `IAM values: <field>`.
- **Query** (24 h, `dt.security_context`):

```dql
smartscapeNodes "*", from:now()-24h
| filter isNotNull(`dt.security_context`)
| summarize n = count(), by:{v = `dt.security_context`}
| fieldsAdd src = "Smartscape"
| append [fetch logs, from:now()-24h, samplingRatio:10000, scanLimitGBytes:5
    | filter isNotNull(`dt.security_context`)
    | summarize n = count(), by:{v = `dt.security_context`}
    | fieldsAdd src = "logs"]
| append [fetch spans, from:now()-24h, samplingRatio:10000, scanLimitGBytes:5
    | filter isNotNull(`dt.security_context`)
    | summarize n = count(), by:{v = `dt.security_context`}
    | fieldsAdd src = "spans"]
| append [metrics from:now()-24h
    | filter isNotNull(`dt.security_context`)
    | summarize n = count(), by:{v = `dt.security_context`}
    | fieldsAdd src = "metrics"]
| expand v
| summarize n = sum(n), sources = collectDistinct(src), by:{value = toString(v)}
| sort n desc
| limit 500
```

  For 7 d every `from:now()-24h` becomes `from:now()-7d` and `samplingRatio:10000` becomes `samplingRatio:100000`.
  For 30 d: `from:now()-30d`, `samplingRatio:100000`, and the metrics part `metrics from:now()-10d`. Other fields
  replace `` `dt.security_context` `` everywhere, e.g. `` `k8s.namespace.name` `` or `` `dt.host_group.id` ``.
- **How it works:** four branches count records per value of the field: Smartscape nodes of every type
  (`smartscapeNodes "*"`), sampled logs, sampled spans, and metric series (`metrics` lists series with their
  dimensions; `count()` counts series). Each branch drops records without the field and labels its source in
  `src`. `append` stacks the branches. `expand v` splits list values (a record can carry several security
  contexts) into one row per element. The final `summarize` adds the counts per value (as string) and collects the
  sources; the 500 most frequent values are kept.
- **Output:** `value` → option value; `sources` → grey detail ("Smartscape, logs"); `n` → sort order only.
- **Limits and cost:** sampling on logs and spans, 5 GB scan cap per fetch, metrics at most 10 days, 500 values.
  The code comment records < 1 s for 24 h and about 7 s (1.1 GB scanned) for 30 d on the demo tenant, which is why it
  runs only on demand. Note text: "Seen on Smartscape nodes, logs and spans (sampled) and metrics (max 10 days) in
  the selected timeframe."
- **Open it yourself:** yes: inline query actions in the dimension editors; *Values query* in condition rows.

### 2. Event field values

- **Source:** `iamEventFieldValuesQuery(tf, field)` in [queries.ts](../ui/app/queries.ts#L1338). Title
  `IAM values: <field>`; `openpipeline:event-type` uses `event.type`, `openpipeline:event-provider` uses
  `event.provider`.
- **Query** (24 h, `event.type`):

```dql
fetch events, from:now()-24h, scanLimitGBytes:5 | summarize n = count(), by:{v = event.type} | fieldsAdd src = "events"
| append [fetch bizevents, from:now()-24h, scanLimitGBytes:5 | summarize n = count(), by:{v = event.type} | fieldsAdd src = "bizevents"]
| append [fetch dt.system.events, from:now()-24h, scanLimitGBytes:5 | summarize n = count(), by:{v = event.type} | fieldsAdd src = "dt.system.events"]
| filter isNotNull(v)
| expand v
| summarize n = sum(n), sources = collectDistinct(src), by:{value = toString(v)}
| sort n desc
| limit 500
```

  7 d / 30 d change `from:now()-24h` to `from:now()-7d` / `from:now()-30d`; `event.kind` or `event.provider` replace
  `event.type`.
- **How it works:** counts events per value in `events`, `bizevents` and `dt.system.events` (no sampling: events do
  not support it), drops nulls, merges per value with the tables it was seen in, keeps the 500 most frequent.
- **Output:** `value`, `sources` (detail). **Limits:** 5 GB scan cap per table, 500 values.
- **Open it yourself:** yes (inline in the Event kind / type / provider dimensions, *Values query* elsewhere).

### 3. Log sources

- **Source:** `iamLogSourcesQuery(tf)`. Title "IAM values: log sources", note "Sampled logs in the selected timeframe."

```dql
fetch logs, from:now()-24h, samplingRatio:10000, scanLimitGBytes:5
| filter isNotNull(log.source)
| summarize n = count(), by:{value = toString(log.source)}
| sort n desc
| limit 500
```

  7 d: `from:now()-7d, samplingRatio:100000`; 30 d: `from:now()-30d, samplingRatio:100000`.
- **Output:** `value`. **Open it yourself:** yes.

### 4. Metric keys

- **Source:** `iamMetricKeysQuery(tf)`. Title "IAM values: metric keys", note "Metric keys with series in the
  timeframe (max 10 days), first 1,000; startsWith or MATCH cover families such as dt.host.*."

```dql
metrics from:now()-24h
| summarize n = count(), by:{value = metric.key}
| sort value asc
```

  7 d: `metrics from:now()-7d`; 30 d: `metrics from:now()-10d`.
- **How it works:** counts series per metric key, sorted by name. There is no `limit`; the "first 1,000" in the
  note is the default result-record limit of a query run without `maxResultRecords`.
- **Output:** `value`. **Open it yourself:** yes.

### 5. Grail buckets

- **Source:** `IAM_BUCKETS_QUERY`; no timeframe. Title "IAM values: Grail buckets"; hint `MATCH ("default_*")
  covers every default bucket.`

```dql
fetch dt.system.buckets
| fields value = name, table = dt.system.table, label = display_name
| sort table asc, value asc
```

- **Output:** `value` (bucket name), `label` (display name, shown as "<label> — <value>"), `table` (detail).
  **Open it yourself:** yes.

### 6. Grail tables

- **Source:** `IAM_TABLES_QUERY`; no timeframe. Title "IAM values: Grail tables", note "Tables that have buckets."

```dql
fetch dt.system.buckets
| summarize n = count(), by:{value = dt.system.table}
| sort value asc
```

- **Output:** `value`. **Open it yourself:** *Values query* on `storage:table-name` conditions (step 3).

### 7. Entity types

- **Source:** `IAM_ENTITY_TYPES_QUERY`; no timeframe. Title "IAM values: entity types".

```dql
fetch dt.system.data_objects
| filter startsWith(name, "dt.entity.") and not(contains(name, ":"))
| fields value = upper(substring(name, from:10))
| sort value asc
```

- **How it works:** lists the classic entity tables (`dt.entity.process_group_instance` …), drops generic (custom)
  types, whose names contain `:`, and turns the rest into the upper snake case `storage:entity.type` expects
  (`PROCESS_GROUP_INSTANCE`). **Open it yourself:** yes.

### 8. Process group detected names

- **Source:** `iamProcessGroupNamesQuery(tf)`. Title "IAM values: process group detected names".

```dql
smartscapeNodes "PROCESS", from:now()-24h
| filter isNotNull(dt.process_group.detected_name)
| summarize n = count(), by:{value = toString(dt.process_group.detected_name)}
| sort n desc
| limit 500
```

  7 d / 30 d: `from:now()-7d` / `from:now()-30d`. **Open it yourself:** *Values query*.

### 9. Entity IDs

- **Source:** `iamEntityIdsQuery(tf, table)`. Title "IAM values: <table> IDs", note "Entity IDs with their names,
  first 1,000."

```dql
fetch dt.entity.host_group, from:now()-24h
| fields value = id, label = entity.name
| sort label asc
```

  `dt.entity.host` (for `extensions:host`) and `dt.entity.process_group` (for `dev-obs:dt.entity.process_group`)
  replace the table; 7 d / 30 d change `from:`. No `limit`; the result-record default caps it at 1,000.
- **Output:** `value` (e.g. `HOST_GROUP-0000000000000001`), `label` (name). **Open it yourself:** *Values query*.

### 10. ActiveGate groups

- **Source:** `iamActiveGateGroupsQuery(tf)`. Title "IAM values: ActiveGate groups".

```dql
smartscapeNodes "ACTIVEGATE", from:now()-24h
| filter isNotNull(dt.active_gate.group.name)
| summarize n = countDistinct(dt.active_gate.id), by:{value = toString(dt.active_gate.group.name)}
| sort value asc
```

  7 d / 30 d change `from:`. **Output:** `value`. **Open it yourself:** *Values query*.

**Client-side processing of every DQL suggestion** ([`useConditionValues`](../ui/app/iamValues.ts#L222)): rows
with an empty `value` are dropped; `label` and `table` / `sources` become label and detail.

## API calls

| Method | Endpoint / SDK method | Scope | When |
| --- | --- | --- | --- |
| GET | `/api/iam-reference` (`functions.call("iam-reference")`, app function) | none | Once per page load for all IAM tabs; again on **Retry** |
| GET (server side) | `https://docs.dynatrace.com/docs/manage/identity-access-management/permission-management/manage-user-permissions-policies/advanced/iam-policystatements` and `…/advanced/iam-global-conditions` | outbound allowlist | Inside the function, in parallel |
| GET | `/platform/app-engine/registry/v1/apps?add-fields=manifest.scopes,isBuiltin` (`httpClient.send`) | `app-engine:apps:run` | Once per page load (tab open), shared with the `shared:app-id` picker; retried on next mount after a failure |
| GET | app icon URL from `appIcon.href` (`/platform/app-engine/registry/v1/app-icons/<id>`) | `app-engine:apps:run` | When an app card scrolls into view; 6 at a time; cached as object URLs for the page load |
| GET | `/platform/classic/environment-api/v2/settings/schemas` (`settingsSchemasClient.getAvailableSchemaDefinitions`) | `settings:schemas:read` | First time a `settings:schemaId` picker opens |
| GET | `/platform/classic/environment-api/v2/settings/schemas/<schemaId>` (`getSchemaDefinition`) | `settings:schemas:read` | **Look up groups** on `settings:schemaGroup` |
| GET | `/platform/classic/environment-api/v2/settings/objects?schemaIds=builtin:management-zones&scopes=environment&fields=objectId,value&pageSize=500`, then `?nextPageKey=…` (`settingsObjectsClient.getSettingsObjects`) | `settings:objects:read` | First time an `environment:management-zone` / `extensions:management-zone` picker opens |
| GET | `/platform/extensions/v2/extensions?page-size=100`, then `?page-key=…` (`httpClient.send`) | `extensions:definitions:read` | First time an `extensions:extension-name` picker opens |
| DQL | queries 1–10 (`useDql` of `@dynatrace-sdk/react-hooks`) | see scopes | When a picker opens |

Details:

- **`iam-reference`** ([iam-reference.function.ts](../api/iam-reference.function.ts)): no request body. It fetches
  both docs pages, parses them with [iam-reference-parser.ts](../api/iam-reference-parser.ts) and returns
  `{ status: "ok", checkedAt, catalog: { updated, globalsUpdated, services, globals } }`. A fetch error whose message
  mentions `allowlist` or `NotCapable` returns `{ status: "blocked", message }`; any other error
  `{ status: "error", message }`; fewer than 5 parsed services returns `status: "error"` "…parsed to N services;
  the page layout may have changed." The UI uses `catalog` to build its index (permission → conditions → operators)
  and `checkedAt` for the banner. Parsing: each `<h2>` is a service (first `<p>` its title, further `<p>` its
  notes), each `<h3>` matching `service:resource:action` a permission (following `<p>` its description), the `<li>`
  items after a `<h4>conditions:</h4>` its conditions (first `<code>` the key, the `<code>` items after
  "operators:" the operators); the article ends at `<h2 id="related-topics">`. The page date comes from "Updated on
  <Mon DD, YYYY>" / "Published …". Global conditions: `<h2>`/`<h3>` headings `global:<name>`, the first descriptive
  `<p>` and the "Operators:" paragraph.
- **App Registry:** response fields used: `apps[].id`, `name` (fallback ID), `isBuiltin`, `appIcon.href`,
  `manifest.scopes[].name`, `manifest.scopes[].comment`. Sorted by name.
- **Schemas:** `items[].schemaId`, `displayName` (label); definition: `schemaGroups`.
- **Management zones:** `items[].value.name` (other fields are read by the shared helper but not used here).
- **Extensions:** `items[].extensionName`, `version` (detail "active <version>"), `nextPageKey`.

API results are cached per source for the page load; a failed load is dropped from the cache so the next picker
that opens tries again. Copy and Export make no request.

## Remediation actions

**Create in Account Management** (below the editor) sends the text in the editor to the Account Management API
through the `iam-publish` app function ([`api/iam-publish.function.ts`](../api/iam-publish.function.ts)), so you
do not have to copy it into Account Management by hand.

- **Who:** only the app's admins (permission `app-settings:objects:write` for this app), even when the Overview and
  Permissions Test are allowed for every user. Everyone else sees a note and can still copy or export the text.
- **Needs:** the account OAuth client stored under *Account Management access* (Overview or Permissions Test tab) with
  `iam:policies:write` (plus the matching `:read` scope to find existing names), or `iam-policies-management`. Like the
  reads, a 403 on the fine-grained scopes is retried once with `iam-policies-management`.
- **Level:** *This environment* (default; the policy exists only in this environment) or *Account (all
  environments)*. An optional description is sent with it (default "Created with IAM Assistant").
- **Disabled until** the policy has a name and the editor shows no errors.
- **Flow:** the function first validates the text (`POST …/validation`); nothing is written if the API rejects it,
  and its messages are listed. It then looks for a policy with the same name at the chosen level. If there is none, it creates
  one (`POST`) and shows its UUID. If there is one, it writes nothing and asks first: **Replace the existing policy**
  (`PUT`, which changes the access of every group it is bound to) or **Cancel** (rename to create a new one).
- **Comments** (`// …` lines) are not sent; the API stores the text verbatim and comments are not part of the
  policy language.
- **What it does not do:** it does not bind anything. A new policy grants nothing until you bind it to a group in
  Account Management > Identity & access management > Group management.
- **Sprint and dev environments** use their own Account Management API host, as described in
  [Overview](overview.md#sprint-and-dev-environments).

You can still copy or export the text and create the policy in Account Management by hand.

## AI Assist on this page

[`analyzeIamPolicy`](../ui/app/analyses.ts#L730) is rule-based and runs locally in the browser, only while the panel
is open. Its input ([`policyInsight`](../ui/app/tabs/IamPolicyTab.tsx#L201)) reads the editor text as parsed, so
hand edits count, plus the draft's apps and dimensions:

| Input | Computed as |
| --- | --- |
| statements, errors, warnings | Parsed statements; error / warning diagnostics including the app-data warnings |
| permissions, services | Distinct permission IDs; distinct service prefixes |
| unconditionalGrail | Permissions of ALLOW statements without conditions that are Grail tables, `storage:entities:read` or `storage:smartscape:read` |
| bucketsMissing | An ALLOW grants a Grail table permission and no ALLOW grants `storage:buckets:read` |
| denyConditionalGrail / denyUnconditional | DENY with conditions on Grail table permissions / number of DENY without conditions |
| appsMode, apps | `all` (every app on), `selected` (apps selected, or `app-engine:apps:run` granted in the text), else `off`; number of selected apps |
| appsNeedingData | Selected apps with Read missing required data |
| dataUnscoped | Step 2 includes data permissions and none receives a dimension condition |
| dims, dimMode | Labels of set dimensions (empty when the text is hand-edited); AND / OR |
| securityContextWithoutMatch | A `…dt.security_context` condition with `=`, `IN` or `startsWith` |
| bindParams | Distinct values containing `${bindParam:` |
| unknownPermissions | Permissions not in the catalogue |
| manual, liveDocs, docChanges | Hand-edited text; live catalogue; number of differences from the snapshot |

**Empty policy:** summary "The policy is empty. Pick apps, dimensional data and permissions on the left, or paste
an existing policy into the editor and load it into the builder." One info insight (live list vs snapshot),
recommendations (medium) "Start from the data: choose the security context, buckets or Kubernetes namespaces a team
may read, then add the table permissions (storage:logs:read, storage:spans:read, …) and storage:buckets:read." and
(low) "Use Start from to load a policy pattern from the docs and narrow it."

**Otherwise summary:** "N statements (of 100 allowed) granting P permissions across S services; the editor reports E
errors and W warnings." plus " The text was edited by hand, so this reads the editor, not the selections." when
hand-edited.

| Insight | Severity | When |
| --- | --- | --- |
| N errors in the policy text … Hover the underlined text for details. | critical | errors > 0 |
| `<perms>` is/are granted without conditions: every record in that table, and record-level conditions in the user's other policies stop mattering. | warning | unconditionalGrail (first 4 listed) |
| Grail table permissions are granted but storage:buckets:read is not, so queries return nothing from the buckets that hold the data. | warning | bucketsMissing |
| Conditional DENY on … runs as an unconditional DENY (only storage:buckets:read supports conditional DENY). | warning | denyConditionalGrail |
| N unconditional DENY statement(s) block(s) those permissions for everyone … Boundaries never soften a DENY. | warning | denyUnconditional > 0 |
| app-engine:apps:run is granted without a condition: every installed app, including apps installed later. | info | appsMode all |
| App access is limited to N apps, each on its own app-engine:apps:run line with shared:app-id. | good | appsMode selected |
| `<apps>` show(s) Grail data the policy does not grant yet, so it/they open empty. | warning | appsNeedingData |
| Data access from step 2 is not limited by any dimensional data: the group reads every record of those tables. | warning | dataUnscoped |
| Record access is limited by `<dims>` (AND / OR explanation). | good | dims set |
| dt.security_context is matched with =, IN or startsWith. Records that carry a list of security contexts only match with MATCH. | info | securityContextWithoutMatch |
| Not in the IAM policy reference: … Check the spelling, or whether the permission was renamed. | warning | unknownPermissions |
| N statements is close to the limit of 100 per policy. … | warning | statements > 80 |
| N binding parameter(s) (${bindParam:…}): their values are set when the policy is bound to a group, through the Account Management API only. | info | bindParams > 0 |
| The live IAM policy reference could not be read; checks use the bundled snapshot … | warning | not live |
| The live IAM policy reference has N changes since the bundled snapshot; the pickers and checks already use the live version. | info | live and docChanges > 0 |

| Recommendation | Impact | When |
| --- | --- | --- |
| Fix the errors listed under the editor first … | high | errors |
| Open step 2 (Data access), choose Add data access and limit the records with dimensional data … | high | appsNeedingData |
| In step 2, set at least one dimension (security context, bucket, host group or Kubernetes namespace) … | medium | dataUnscoped |
| Add a data scope (Dimensional data) to the table permissions, or keep them unconditional here and bind the policy with one boundary per team (IAM Boundary Creator). | high | unconditionalGrail |
| Add storage:buckets:read, limited with storage:bucket-name or storage:table-name … | high | bucketsMissing |
| Use MATCH for dt.security_context (e.g. MATCH ("TeamA")) if any data source sets several security contexts on a record. | medium | securityContextWithoutMatch |
| Replace DENY statements with narrower ALLOW statements where possible … | medium | any DENY rule |
| If several teams need the same permissions for different data, write the permissions once and move the data scope into one boundary per team, or use ${bindParam:…} templating. | low | dims set and no binding parameters |
| Copy the text into Account Management > Identity & access management > Policy management > Create policy; it is validated again on save. | low | always |

## Limitations and edge cases

- The builder writes text only; it does not create, bind or test policies (the Permissions Test tab tests drafts).
- Permissions come from the docs. With the snapshot, permissions added later are missing from pickers and typed
  ones are flagged as warnings, not rejected.
- App permissions are derived from manifest scopes. A scope that is not an IAM policy permission is left out, and the
  app's own `app-engine:apps:run` scope is not granted (it would let the app open other apps).
- App state permissions are written at every level, including *Open only*.
- Optional data is detected by the word "optional" anywhere in the manifest comment.
- A dimension is not applied to a permission that lacks the attribute; that permission stays unrestricted for that
  dimension (`storage:entities:read` with a namespace or bucket dimension).
- A dimension's operator with no equivalent on some permission is still written there and reported as an error.
- In OR mode, a permission with N applicable dimensions becomes N statements, which counts toward the 100 limit.
- Global conditions are added to every statement, including DENY rows, which makes an unconditional DENY
  conditional (and, on Grail table permissions, triggers the conditional-DENY warning).
- *Fewer statements* only merges inside a block. Merged notes are not re-sorted.
- Hand edits disconnect the text from the selections; editing the selections afterwards has no effect until you
  discard the edits.
- **Load this text into the builder**: a segment that does not start with ALLOW / DENY is dropped without being listed
  as left out when the text has at least one statement. Statements with format errors that the parser accepts (e.g.
  `ALLOW foo;`) are loaded as rows and then flagged. Loaded rows have *Apply dimensional data* off. A shared global
  condition is only extracted when every loadable statement carries it.
- Suggestions reflect what you can read in the timeframe; values that do not occur (or occur only beyond 10 days for
  metrics) are not suggested, but can be typed.
- Drafts are per browser and app origin; they are not shared with other users.

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| Banner "Using the bundled permission snapshot … add docs.dynatrace.com to the allowed outbound connections" | The JavaScript runtime allowlist blocks docs.dynatrace.com | Add `docs.dynatrace.com` in the *setting* link (`builtin:dt-javascript-runtime.allowed-outbound-connections`), then **Retry**. |
| Banner "…iam-reference app function is not available in this running app (HTTP 404)" | The function is not part of the running build | Restart `npx dt-app dev` or deploy, then **Retry**. |
| Banner "…parsed to N services; the page layout may have changed." | docs.dynatrace.com changed its HTML | Maintainers: fix `api/iam-reference-parser.ts`; check with `npm run sync-iam`. The tab keeps working on the snapshot. |
| "Could not read the installed apps (App Registry): …" and selected apps stay "Reading the permissions…" | Missing `app-engine:apps:run` on the app or for the user, or a network error | Check the scope and your permissions; reopen the tab to retry. |
| "Could not load suggestions: …" in a picker | Missing scope or user permission for the table (e.g. spans, buckets, settings) | Type the value; check the scopes listed above and your own Grail permissions. |
| A picker shows no suggestions | No record carries the field in the timeframe, or values are older than 10 days (metrics) | Choose a longer timeframe or type the value. |
| An app opens empty for the group | Its required Grail data is not granted (step 2 not added, unticked, or no `storage:buckets:read`) | Follow the ⚠ comment: step 2, *Add data access*; check bucket access. |
| Red operator note on a dimension | A permission does not support the operator and there is no equivalent | Pick another operator, or values without wildcards / one `prefix*`. |
| Counter above 100 statements | Many apps or OR mode | Turn on *Fewer statements*, use AND mode, or split the policy. |
| "Copy failed" / "The browser blocked clipboard access." | The frame or browser denies clipboard access | Use **Export .txt**, or select the editor text and copy manually. |
| Account Management rejects the policy | A permission or condition changed in the docs after the catalogue was read, or a warning was ignored | Fix the diagnostics; compare with the live reference; remove `// ⚠` lines if not wanted. |

## Related pages

- [IAM Boundary Creator](iam-boundary-creator.md): boundaries that narrow a policy, with a preview against this tab's
  policy.
- [Permissions Test](permissions-test.md): *Policy Creator draft* tests this draft (with the boundary draft).
- Architect Assistant's [Data Overview](https://github.com/Chr0dine/dt-apps/blob/main/apps/architect-assistant/docs/data-overview.md) and [Security context](https://github.com/Chr0dine/dt-apps/blob/main/apps/architect-assistant/docs/security-context.md): whether records carry the
  `dt.security_context` and other fields that dimensions rely on.
- Architect Assistant's [Segments](https://github.com/Chr0dine/dt-apps/blob/main/apps/architect-assistant/docs/segments.md): management zones whose permissions need IAM policies.
- [README](../README.md).

## Source files

| File | Role on this page |
| --- | --- |
| [ui/app/tabs/IamPolicyTab.tsx](../ui/app/tabs/IamPolicyTab.tsx) | Tab layout, steps, app cards, data step, dimensions, permission rows, browser, globals, AI Assist input |
| [ui/app/tabs/IamShared.tsx](../ui/app/tabs/IamShared.tsx) | Catalogue banner, operator select, value picker, schema group lookup, condition row, editor pane, Copy / Export |
| [ui/app/iamPolicy.ts](../ui/app/iamPolicy.ts) | Draft types, statement generation, parser, validation, text-to-draft, docs patterns |
| [ui/app/iamCatalog.ts](../ui/app/iamCatalog.ts) | Catalogue loading (live / snapshot), index, dimensions, operators, global hints, docs URLs |
| [ui/app/iamApps.ts](../ui/app/iamApps.ts) | App Registry apps → Read / Write / Execute, data, app state; icons |
| [ui/app/iamValues.ts](../ui/app/iamValues.ts) | Value sources per condition key, API loaders, `useConditionValues` |
| [ui/app/iamDrafts.tsx](../ui/app/iamDrafts.tsx) | Drafts above the tabs and in localStorage |
| [ui/app/iamSnapshot.json](../ui/app/iamSnapshot.json) | Bundled catalogue (2026-10-24) |
| [ui/app/queries.ts](../ui/app/queries.ts#L1312) | Value suggestion queries |
| [api/iam-reference.function.ts](../api/iam-reference.function.ts), [api/iam-reference-parser.ts](../api/iam-reference-parser.ts) | Live docs read and parser |
| [scripts/sync-iam-reference.mjs](../scripts/sync-iam-reference.mjs) | `npm run sync-iam` (list differences, exit 1 if any) / `-- --write` (refresh the snapshot) |
| [ui/app/analyses.ts](../ui/app/analyses.ts#L702) | `analyzeIamPolicy` |
| [ui/app/segments.ts](../ui/app/segments.ts), [ui/app/databases.ts](../ui/app/databases.ts) | `listManagementZones`, `listExtensions` used by the pickers |
