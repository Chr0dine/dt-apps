# IAM Boundary Creator

The IAM Boundary Creator is a builder, not a check. It writes the text of an IAM **policy boundary**: a list of
conditions, one per line, that narrows the policies it is assigned with when a policy is bound to a group. You
pick the apps, the dimensional data (security context, Kubernetes namespace, host group and more, per service) and
any other condition from the IAM policy reference on the left; the boundary text on the right updates as you
select, can be edited by hand, and is validated as you type. **Check against a policy** applies the boundary to the
IAM Policy Creator's policy (or any pasted policy) with the documented rules and marks every effective statement as
narrowed, own conditions only, unrestricted or DENY unchanged, so permissions the boundary does not narrow are
visible before it is used. **Copy to clipboard** and **Export .txt** take the text out; the app never creates a
boundary itself.

| | |
| --- | --- |
| Area | Users and permissions (see [index](README.md)) |
| Tab id | `iam-boundary` |
| Counts toward Entity Overview readiness / Top findings | No. The tab computes no coverage score and is never a Top findings target. |
| Main source files | [IamBoundaryTab.tsx](../ui/app/tabs/IamBoundaryTab.tsx), [IamShared.tsx](../ui/app/tabs/IamShared.tsx), [iamPolicy.ts](../ui/app/iamPolicy.ts) (`boundaryLines`, `renderBoundary`, `validateBoundary`, `applyBoundary`, `draftFromBoundaryText`), [iamCatalog.ts](../ui/app/iamCatalog.ts), [iamValues.ts](../ui/app/iamValues.ts), [iamApps.ts](../ui/app/iamApps.ts), [iamDrafts.tsx](../ui/app/iamDrafts.tsx), [queries.ts](../ui/app/queries.ts#L1312), [iam-reference.function.ts](../api/iam-reference.function.ts), [analyses.ts](../ui/app/analyses.ts#L788) (`analyzeIamBoundary`) |

## Contents

- [What this page answers](#what-this-page-answers)
- [Before you start](#before-you-start)
- [Page walkthrough](#page-walkthrough)
  - [Layout, documentation link, AI Assist](#layout-documentation-link-ai-assist)
  - [Heading and catalogue banner](#heading-and-catalogue-banner)
  - [Name and examples](#name-and-examples)
  - [Apps](#apps)
  - [Dimensional data](#dimensional-data)
  - [More conditions](#more-conditions)
  - [Value pickers](#value-pickers)
  - [Check against a policy](#check-against-a-policy)
  - [Boundary editor (right pane)](#boundary-editor-right-pane)
  - [Copy to clipboard and Export .txt](#copy-to-clipboard-and-export-txt)
  - [Drafts](#drafts)
- [Boundary text the app writes](#boundary-text-the-app-writes)
- [How a boundary is applied (preview engine)](#how-a-boundary-is-applied-preview-engine)
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

- How do I write one broad policy (for example read logs) once and give each team only its own data, by assigning
  the policy with a different boundary per team?
- Which condition keys exist for a given attribute in each service (`storage:dt.security_context`,
  `settings:dt.security_context`, `synthetic:dt.security_context`), and which permissions each one narrows?
- Which permissions of my policy would a boundary **not** narrow, because none of its conditions applies to them
  (the docs' example: a Kubernetes namespace boundary does not narrow `storage:entities:read`)?
- Does my boundary respect the limits: one condition per line, no AND / OR, at most 10 conditions, only documented
  conditions and operators?

Rules the tab follows, from [Policy boundaries](https://docs.dynatrace.com/docs/manage/identity-access-management/permission-management/manage-user-permissions-policies/iam-policy-boundaries)
and its section [How are policy boundaries applied?](https://docs.dynatrace.com/docs/manage/identity-access-management/permission-management/manage-user-permissions-policies/iam-policy-boundaries#apply-boundary):
statements are split into one per permission; a boundary condition applies only to permissions that support it
(global conditions to all); a repeated condition name multiplies the statement (one copy per line, any of them
grants access); boundary conditions are added (AND) to the statement's own conditions; DENY statements are never
changed. Other docs linked from the editor: [IAM policy reference](https://docs.dynatrace.com/docs/manage/identity-access-management/permission-management/manage-user-permissions-policies/advanced/iam-policystatements),
[Policy global conditions](https://docs.dynatrace.com/docs/manage/identity-access-management/permission-management/manage-user-permissions-policies/advanced/iam-global-conditions),
[Policy templating](https://docs.dynatrace.com/docs/manage/identity-access-management/permission-management/manage-user-permissions-policies/advanced/iam-policy-templating),
[Dynatrace default policies reference](https://docs.dynatrace.com/docs/manage/identity-access-management/permission-management/default-policies),
[IAM limits](https://docs.dynatrace.com/docs/manage/identity-access-management/iam-limits),
[Permissions in Grail](https://docs.dynatrace.com/docs/platform/grail/organize-data/assign-permissions-in-grail)
and [Account Management](https://myaccount.dynatrace.com/).

## Before you start

### App scopes used by this page

| Scope | What this page uses it for |
| --- | --- |
| `app-engine:apps:run` | App Registry: suggestions for `shared:app-id`, and the app permissions behind the Policy Creator's policy used by the preview. |
| `storage:smartscape:read`, `storage:logs:read`, `storage:spans:read`, `storage:metrics:read` | Field value suggestions (Smartscape nodes, sampled logs and spans, metric series). |
| `storage:events:read`, `storage:bizevents:read`, `storage:system:read` | Event field suggestions; entity types from `dt.system.data_objects`. |
| `storage:buckets:read` | Reading records from the buckets behind those tables. |
| `storage:entities:read` | Entity ID suggestions (`dt.entity.host`, `dt.entity.host_group`, `dt.entity.process_group`). |
| `storage:bucket-definitions:read` | Buckets and tables (`dt.system.buckets`). |
| `settings:objects:read` | Management zone names (`builtin:management-zones`). |
| `settings:schemas:read` | Settings schema IDs; one schema's groups. |
| `extensions:definitions:read` | Extension names. |

Nothing on this page writes.

### User permissions

Suggestions run with your own permissions, so they only show data you can read. Creating the boundary and
assigning it with a policy happens in Account Management and needs the rights to manage IAM there.

### One-time setup

Add `docs.dynatrace.com` to `builtin:dt-javascript-runtime.allowed-outbound-connections` when the allowlist is
enforced, so the `iam-reference` app function can read the live IAM policy reference. Without it the tab uses the
bundled snapshot. No credentials are needed.

## Page walkthrough

### Layout, documentation link, AI Assist

A link *IAM Boundary Creator documentation* (this page) sits above the tab. When **AI Assist** is on, its panel
appears at the top ([AI Assist on this page](#ai-assist-on-this-page)). The tab is a two-column grid
(`repeat(auto-fit, minmax(min(100%, 520px), 1fr))`): builder cards on the left, the boundary editor on the right in
a sticky card; on narrow windows the editor goes below.

### Heading and catalogue banner

"IAM Boundary Creator" and an introduction: a boundary is a list of conditions, one per line, that narrows the
policies it is assigned with; each condition applies only to the permissions that support it (global conditions to
all), at most 10 conditions, no AND, and DENY statements are never changed; with a *Policy boundaries* link.

The catalogue banner is the same as on the IAM Policy Creator ([`CatalogBanner`](../ui/app/tabs/IamShared.tsx#L71)),
shared by all IAM tabs (one docs read per page load):

| State | What you see |
| --- | --- |
| Loading | "Reading the IAM policy reference from docs.dynatrace.com… Until then the bundled snapshot of 2026-10-24 is used." |
| Live | "Permissions, conditions and operators are read live from the IAM policy reference (updated `<date>`) at `<time>`." plus "No change since the bundled snapshot of 2026-10-24." or the counts of new, removed and changed permissions and global conditions, with **Show changes**. |
| Blocked | Warning "Using the bundled permission snapshot of 2026-10-24": "…add docs.dynatrace.com to the allowed outbound connections (setting)." (*setting* opens the allowlist schema in Settings), "Permissions added to the docs after the snapshot are missing here; type them in the editor if you need them." **Retry**. |
| Error | Same warning with the error (HTTP 404: function not in the running app; HTTP status with body; or "parsed to N services; the page layout may have changed"). **Retry**. |

### Name and examples

Card "Name and examples" ([`StartCard`](../ui/app/tabs/IamBoundaryTab.tsx#L159)):

- **Name (export file name; the boundary text holds conditions only)**, placeholder "e.g. Team A data". The name
  is not written into the text.
- **Start from a docs example (replaces the selections)**:
  - *Kubernetes development namespaces*: `storage:k8s.namespace.name IN ("DEVELOPMENT", "HARDENING");`
  - *Kubernetes management zones and namespaces*: `environment:management-zone startsWith "[Kubernetes]";` and
    `storage:k8s.namespace.name IN ("DEV", "PREPROD");`

  The example is loaded with [Load this text into the builder](#load-this-text-into-the-builder); a note says
  "<example>: loaded N conditions into the builder."
- **Clear all** empties the boundary, its hand-edited text and the preview's custom policy.

### Apps

Card "Apps" ([`AppsCard`](../ui/app/tabs/IamBoundaryTab.tsx#L204)): "One shared:app-id line: limits running and
installing apps, app settings and app states to these apps."

- **Operator**: the operators of `shared:app-id` across permissions (`=`, `!=`, `IN`, `NOT IN`, `startsWith`,
  `NOT startsWith` in the snapshot), default `IN`.
- **Values**: installed apps from the App Registry ("<name> — <app id>"), plus typed values; no query actions (API
  source).
- "Narrows 20 permissions: app-engine:apps:install, app-engine:apps:run, app-engine:apps:delete,
  app-engine:certificates:create, app-settings:objects:read, app-settings:objects:write, +14 more." (snapshot; the
  others are `app-settings:objects:admin`, `settings:objects:read` / `write` / `admin`, `settings:schemas:read`,
  `state:*` and `state-management:*`).

### Dimensional data

Card "Dimensional data" ([`DimensionsCard`](../ui/app/tabs/IamBoundaryTab.tsx#L224)): "Which records the group
may read. A dimension becomes one line per service you tick (storage covers Grail tables; settings and synthetic have
their own security context condition)."

An accordion with one section per dimension (derived from the catalogue: every `storage:` attribute except table,
fieldset, file path, store and query consumption). The label shows the current setting and "N lines".

| Dimension | Attribute | Service keys you can tick |
| --- | --- | --- |
| Security context | `dt.security_context` | `storage:` (14 permissions), `settings:` (`settings:objects:read`, `settings:objects:write`), `synthetic:` (`synthetic:monitors:read`, `write`, `execute`) |
| Grail bucket | `bucket-name` | `storage:` |
| Host group | `dt.host_group.id` | `storage:` |
| Kubernetes cluster | `k8s.cluster.name` | `storage:`, `dev-obs:` |
| Kubernetes namespace | `k8s.namespace.name` | `storage:`, `dev-obs:` (`dev-obs:breakpoint:set`, `dev-obs:breakpoints:set`) |
| Host name | `host.name` | `storage:`, `dev-obs:` |
| AWS account, Azure subscription, Azure resource group, GCP project, Frontend, Event kind / type / provider, Log source, Metric key, Entity type | `aws.account.id`, `azure.subscription`, `azure.resource.group`, `gcp.project.id`, `frontend.name`, `event.*`, `log.source`, `metric.key`, `entity.type` | `storage:` |

Inside each section ([`DimensionEditor`](../ui/app/tabs/IamBoundaryTab.tsx#L257)):

- **Operator**: the union of the operators of the ticked keys (default `IN` when offered). An operator that some
  ticked key does not support is still offered; the editor reports it.
- **Values**: a value picker for the storage key, with the suggestion query's actions shown inline.
- **Clear** removes the dimension.
- One checkbox per service key (only `storage:` ticked at first), each with "Narrows N permissions: …".

Each ticked key becomes its own line; an unticked or valueless dimension writes nothing.

### More conditions

Card "More conditions" ([`ConditionsCard`](../ui/app/tabs/IamBoundaryTab.tsx#L302)): "Any condition from the IAM
policy reference: management zones (environment:management-zone), settings schemas and scopes, extensions, Grail
tables and fieldsets, global date and time. Add the same condition twice to allow either value set (each statement
is multiplied per line)."

- **Add condition**: every condition key in the catalogue (53 in the snapshot), grouped by service, each with
  "N permissions · operators", plus a *global* group with the 8 global conditions. New conditions start with `IN`
  when offered, else the first operator.
- Each condition row has the key, its description, a docs link, an operator select, a value picker (with *Values
  query* for DQL-backed keys), **Remove**, and the note "Narrows N permissions: …", "Applies to every permission of
  the bound policy." (global), or "No permission in the IAM policy reference has this condition, so it restricts
  nothing."

### Value pickers

Same component as on the IAM Policy Creator ([`ValuePicker`](../ui/app/tabs/IamShared.tsx#L198)):

- List operators (`IN`, `NOT IN`, `MATCH`) take several values, others one; switching keeps the first value.
- Suggestions load when the picker first opens ("Loading values from the tenant…" / "Could not load suggestions:
  …"); selected values first, then up to 200 more ("N more: type to filter"); typing filters on value, label and
  detail.
- Always offered: `${global:userId}`, `${global:userGroup}`. Typing offers **Add "<text>"** and **Add binding
  parameter `${bindParam:<text>}`**.
- The key's hint; for DQL-backed keys **Values query** with **Show DQL**, **Copy**, **↗ Open in Notebook** (intent
  `dynatrace.notebooks` / `view-query`) and **↗ Add to Dashboard** (`dynatrace.dashboards` / `add-to-dashboard`).
- `settings:schemaGroup` has **Look up groups** for a schema ID.
- Global condition suggestions: the environment ID, your user ID, your email domain, day names
  (`getEnvironmentId` / `getCurrentUserDetails`, no API call).

### Check against a policy

Card "Check against a policy" ([`PreviewCard`](../ui/app/tabs/IamBoundaryTab.tsx#L355)): "The effective statements
when a policy is assigned with this boundary, worked out with the rules in How are policy boundaries applied?".

- Toggle **Policy from the IAM Policy Creator** (default: the Policy Creator's editor text, hand edits included, or
  its generated text) / **Other policy**. Switching to *Other policy* copies the current Policy Creator text into
  an editable code editor (140 px, "Paste a policy, e.g. ALLOW storage:logs:read, storage:entities:read;") and
  shows **Load a docs pattern** (the six Policy Creator docs patterns, see
  [iam-policy-creator.md](iam-policy-creator.md#docs-patterns)). Switching back discards the custom text.
- With the creator source and no policy: "The IAM Policy Creator has no policy yet. Build one there, or choose Other
  policy."
- Summary: "N statements → M effective statements." followed by "The boundary has no usable condition yet, so
  nothing is narrowed.", "Not narrowed: <permissions>." or "Every ALLOW statement is narrowed." N counts parsed
  statements without syntax errors.
- One row per effective statement (scrolls after 320 px) with a chip and the statement text:

| Chip | Colour | Meaning |
| --- | --- | --- |
| narrowed | green | At least one boundary condition (including a global one) was added. |
| own conditions only | amber | No boundary condition applies; the statement keeps only its own conditions. |
| unrestricted | red | No boundary condition applies and the statement has no condition. |
| DENY, unchanged | neutral | A DENY statement; boundaries do not apply. |

- **Copy effective statements** copies every row's text, one per line ("Copied" for 1.5 s).

Only boundary conditions without an error diagnostic take part in the preview.

### Boundary editor (right pane)

`EditorPane` ([IamShared.tsx](../ui/app/tabs/IamShared.tsx#L455)), title "Boundary":

- Counter "N of 10 conditions · N errors · N warnings" (N = parsed conditions).
- Code editor (460 px) with underlines, gutter marks and hover messages; placeholder "Select conditions on the left,
  or type one per line, e.g. storage:k8s.namespace.name IN ("DEV", "PREPROD");".
- Typing makes the text hand-edited: "Edited by hand: the selections on the left no longer change this text." with
  **Discard edits and regenerate** and **Load this text into the builder**.
- Load note after an example or *Load this text* ("loaded N conditions into the builder", and "N parts could not be
  read and were left out: …"), with **Dismiss**.
- **Copy to clipboard**, **Export .txt**, the diagnostics list ("ERROR / WARNING / INFO Line N: message"), and the
  documentation links (Policy boundaries, IAM policy reference, Policy global conditions, Policy templating, Dynatrace
  default policies reference, IAM limits, Account Management).

### Copy to clipboard and Export .txt

- **Copy to clipboard**: `navigator.clipboard.writeText` of the editor text, with a hidden-textarea
  `execCommand("copy")` fallback; "Copied" or the error for 2 seconds.
- **Export .txt**: downloads the editor text (`text/plain;charset=utf-8`). File name: the name with every run of
  characters other than `A-Z a-z 0-9 . _ -` replaced by `-`, trimmed of leading / trailing `-`, plus `.txt`;
  `iam-boundary.txt` without a name. "Team A data" becomes `Team-A-data.txt`.

Disabled for empty text. Nothing is sent to the tenant.

### Drafts

The boundary draft, its hand-edited text and the preview's custom policy are kept by
[`IamDraftsProvider`](../ui/app/iamDrafts.tsx) above the tabs and in `localStorage`
(`architect-assistant.iam-drafts.v2`, saved 400 ms after a change), together with the Policy Creator draft. They
survive tab switches and reloads in the same browser. The Permissions Test tab can test the Policy Creator draft with
this boundary draft.

## Boundary text the app writes

[`boundaryLines` / `renderBoundary`](../ui/app/iamPolicy.ts#L278):

```
boundary  = { condition ";" NL }
condition = key " " operator " " ( "(" quoted { ", " quoted } ")"    for IN, NOT IN, MATCH
                                 | quoted )                          for =, !=, startsWith, NOT startsWith, <, >
```

Order: the Apps line (if any app is chosen), then each dimension in the order it was last edited, one line per
ticked service whose key `<service>:<attribute>` exists in the catalogue, then the more conditions in the order
added. Conditions without a value are left out. Single-value operators keep the first value only. No comments and
no name are written; the text ends with a newline, or is empty.

**Example.** Apps `IN` Team Dashboards and Notebooks; Security context `IN ("team-a")` ticked for storage and
settings; Kubernetes namespace `IN ("shop-prod", "shop-stage")` for storage; more conditions
`environment:management-zone startsWith "[Kubernetes]"` and `global:week-day IN` Monday to Friday:

```
shared:app-id IN ("my.team.dashboards", "dynatrace.notebooks");
storage:dt.security_context IN ("team-a");
settings:dt.security_context IN ("team-a");
storage:k8s.namespace.name IN ("shop-prod", "shop-stage");
environment:management-zone startsWith "[Kubernetes]";
global:week-day IN ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday");
```

The editor shows one info: "Global conditions apply to every permission of the policies this boundary is bound
with."

Security context `MATCH ("team-a")` ticked for storage, settings and synthetic:

```
storage:dt.security_context MATCH ("team-a");
settings:dt.security_context MATCH ("team-a");
synthetic:dt.security_context MATCH ("team-a");
```

gives a warning "MATCH is not supported for storage:dt.security_context on storage:entities:read." and an error
"MATCH is not supported for settings:dt.security_context (supported: =, IN, startsWith)."

### What the parser accepts

[`validateBoundary`](../ui/app/iamPolicy.ts#L567) reads the text line by line: one `key op value` per line, ended by
`;`, with the same value rules as policies (double or single quotes, `\` escapes, lists in parentheses,
case-insensitive operators written back in canonical case).

### Load this text into the builder

[`draftFromBoundaryText`](../ui/app/iamPolicy.ts#L708), used by the examples and the editor link:

- Every condition without an error is loaded. The first `shared:app-id` line becomes the Apps card; every other
  line, including dimension keys, becomes a **More conditions** row (the Dimensional data card stays empty).
- Lines that are not `//` comments and do not start with a loaded condition's key are listed as left out.
- The editor returns to generated text. Example: loading

```
// x
shared:app-id IN ("a.b", "c.d");
storage:k8s.namespace.name = "DEV";
ALLOW storage:logs:read;
storage:team = "z";
```

  loads 2 conditions and lists `ALLOW storage:logs:read;` and `storage:team = "z";` as left out.

## How a boundary is applied (preview engine)

[`applyBoundary`](../ui/app/iamPolicy.ts#L642), step by step:

1. Only statements without syntax errors are used.
2. A DENY statement is copied unchanged (all its permissions in one row).
3. Each ALLOW statement is split into one statement per permission.
4. For each permission, the applicable boundary conditions are the global ones and those whose key the permission
   supports in the catalogue (an unknown permission gets only the global ones).
5. Applicable conditions are grouped by key; the statement is multiplied by every combination, one condition per
   key (2 namespace lines × 2 security context lines = 4 copies).
6. Each copy is the statement's own conditions followed by the combination (AND).

Example policy:

```
ALLOW storage:logs:read, storage:entities:read;
ALLOW settings:objects:read WHERE settings:schemaId = "builtin:alerting.profile";
ALLOW document:documents:read;
DENY storage:spans:read;
```

with boundary:

```
storage:k8s.namespace.name = "DEV";
storage:k8s.namespace.name = "PREPROD";
settings:dt.security_context = "team-a";
global:week-day IN ("Monday", "Tuesday");
```

gives 4 statements → 6 effective statements:

```
narrowed        | ALLOW storage:logs:read WHERE storage:k8s.namespace.name = "DEV" AND global:week-day IN ("Monday", "Tuesday");
narrowed        | ALLOW storage:logs:read WHERE storage:k8s.namespace.name = "PREPROD" AND global:week-day IN ("Monday", "Tuesday");
narrowed        | ALLOW storage:entities:read WHERE global:week-day IN ("Monday", "Tuesday");
narrowed        | ALLOW settings:objects:read WHERE settings:schemaId = "builtin:alerting.profile" AND settings:dt.security_context = "team-a" AND global:week-day IN ("Monday", "Tuesday");
narrowed        | ALLOW document:documents:read WHERE global:week-day IN ("Monday", "Tuesday");
DENY, unchanged | DENY storage:spans:read;
```

Without the global line, `storage:entities:read` and `document:documents:read` would show *unrestricted*. The docs
case `ALLOW storage:logs:read, storage:entities:read;` with `storage:k8s.namespace.name IN ("DEVELOPMENT",
"HARDENING");` gives `narrowed | ALLOW storage:logs:read WHERE storage:k8s.namespace.name IN ("DEVELOPMENT",
"HARDENING");` and `unrestricted | ALLOW storage:entities:read;`.

## Checks and scoring

No gauges or scores. The editor diagnostics ([`validateBoundary`](../ui/app/iamPolicy.ts#L567)) and the AI Assist
rules are the checks. `<source>` is `live docs` or `snapshot of 2026-10-24`.

| Severity | Rule | Message |
| --- | --- | --- |
| error | Line starts with ALLOW, DENY or WHERE | A boundary holds conditions only, one per line (no ALLOW, DENY or WHERE), e.g. storage:k8s.namespace.name = "DEV"; (usually followed by the condition-format error) |
| warning | No `;` on the line | End the condition with a semicolon (;). |
| error | Two conditions on one line | Put each condition on its own line. |
| error | `AND` or `OR` | Boundaries do not support AND or OR: put each condition on its own line (lines are applied separately). |
| warning | A `//` comment | Comments are not documented for boundaries; remove them before saving the boundary. |
| error | Quote not closed | This quote is never closed. |
| error | Condition format, quoting, lists | Same messages as policies: "Write the condition as <service:attribute> <operator> "value" (…)", "Put the value in double quotes, e.g. "value".", "Use straight quotes (") around values, not typographic quotes.", "Add a value.", "Close the list of values with ).", "The list is empty.", "<op> takes a list in parentheses, e.g. ("a", "b").", "<op> takes one value; use IN (or MATCH) for a list." |
| error | 11th condition (reported once) | A boundary holds at most 10 conditions; create another boundary and assign both. |
| info | A key repeated (reported on the second occurrence) | `<key>` is repeated: each policy statement it applies to is multiplied, one copy per `<key>` line (any of them grants access). |
| warning | Unknown `global:` key | `<key>` is not a documented global condition. |
| error | Global operator not documented (none documented = only `=`) | `<op>` is not supported for `<key>` (supported: …). |
| info | Valid global condition | Global conditions apply to every permission of the policies this boundary is bound with. |
| error | Key unknown to every permission | `<key>` is not a condition of any permission in the IAM policy reference (`<source>`), so it would restrict nothing. |
| error | Operator supported by none of the key's permissions | `<op>` is not supported for `<key>` (supported: …). |
| warning | Operator supported by some of them | `<op>` is not supported for `<key>` on `<permissions>`. |
| warning | `storage:query-consumption` not INCLUDED / ON_DEMAND | storage:query-consumption must be "INCLUDED" or "ON_DEMAND"; for any other value the statement is ignored. |
| warning | Week day / date / time values | Use a day name: Monday … Sunday (GMT). / `<key>` needs a time zone (Z for UTC, or +hh:mm), e.g. … |
| info | `${bindParam:…}` value | Binding parameter: its value is set when the policy is bound to a group, which only the Account Management API supports (see Policy templating). |
| info | MATCH wildcard away from a separator | MATCH performs best with wildcards next to a word separator (-, _, . or /), e.g. "db-tech-*". |

## Queries

All DQL on this page is value suggestions. Each query runs when its picker is first opened (`useDqlWhen`) and re-runs
when the app timeframe changes. Timeframe: `from:now()-24h` (default), `-7d`, `-30d`; logs and spans
`samplingRatio:10000` (24 h) or `100000` (7 d, 30 d); `scanLimitGBytes:5` on logs, spans and event tables; the
`metrics` command at most 10 days (`from:now()-10d` for 30 d). Mapping from key to query:
[`valueInfo`](../ui/app/iamValues.ts#L58).

| # | Name (function in [queries.ts](../ui/app/queries.ts#L1312)) | Condition keys |
| --- | --- | --- |
| 1 | `iamFieldValuesQuery` | security context (storage, settings, synthetic), host group, Kubernetes cluster / namespace, host name (storage and dev-obs), cloud accounts, frontend; `dev-obs:host.group` uses `dt.host_group.id` |
| 2 | `iamEventFieldValuesQuery` | `storage:event.kind` / `type` / `provider`, `openpipeline:event-type` / `event-provider` |
| 3 | `iamLogSourcesQuery` | `storage:log.source` |
| 4 | `iamMetricKeysQuery` | `storage:metric.key` |
| 5 | `IAM_BUCKETS_QUERY` | `storage:bucket-name` |
| 6 | `IAM_TABLES_QUERY` | `storage:table-name` |
| 7 | `IAM_ENTITY_TYPES_QUERY` | `storage:entity.type` |
| 8 | `iamProcessGroupNamesQuery` | `dev-obs:dt.process_group.detected_name` |
| 9 | `iamEntityIdsQuery` | `dev-obs:dt.entity.process_group`, `extensions:host`, `extensions:host-group`, `settings:entity.hostGroup` |
| 10 | `iamActiveGateGroupsQuery` | `extensions:ag-group` |

Other keys use fixed values (`automation:workflow-type` SIMPLE / STANDARD, `iam-param:entity-type` group / user,
`app-engine:app-installer` and `iam:service-user-owner` `${global:userId}`, `settings:scope` environment,
`storage:fieldset-name` the three built-in fieldsets, `storage:file-path` /lookups/ and /dt/,
`storage:query-consumption` INCLUDED / ON_DEMAND), every permission ID (`oauth2:scopes`), an API (see
[API calls](#api-calls)), or free text.

### 1. Field values

Title `IAM values: <field>`. 24 h, `dt.security_context`:

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

7 d: `from:now()-7d` everywhere and `samplingRatio:100000`; 30 d: `from:now()-30d`, `samplingRatio:100000`, and
`metrics from:now()-10d`. Other fields replace `` `dt.security_context` ``. Four branches count records (series for
`metrics`) per value on Smartscape nodes of every type, sampled logs, sampled spans and metrics; `append` stacks them;
`expand v` splits list values; the final `summarize` adds counts per value and collects the sources; the 500 most
frequent values are kept. Output: `value` (option), `sources` (detail). Measured in the code comment: < 1 s for 24 h,
about 7 s (1.1 GB scanned) for 30 d. Query actions inline in the Dimensional data sections, *Values query* in
condition rows.

### 2. Event field values

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

`event.kind` / `event.provider` replace `event.type`; 7 d / 30 d change `from:`. No sampling (events do not support
it), 5 GB cap per table.

### 3. Log sources

```dql
fetch logs, from:now()-24h, samplingRatio:10000, scanLimitGBytes:5
| filter isNotNull(log.source)
| summarize n = count(), by:{value = toString(log.source)}
| sort n desc
| limit 500
```

### 4. Metric keys

```dql
metrics from:now()-24h
| summarize n = count(), by:{value = metric.key}
| sort value asc
```

7 d: `metrics from:now()-7d`; 30 d: `metrics from:now()-10d`. No `limit`; the note's "first 1,000" is the default
result-record limit.

### 5. Grail buckets

```dql
fetch dt.system.buckets
| fields value = name, table = dt.system.table, label = display_name
| sort table asc, value asc
```

No timeframe. `label` shows as "<label> — <value>", `table` as detail.

### 6. Grail tables

```dql
fetch dt.system.buckets
| summarize n = count(), by:{value = dt.system.table}
| sort value asc
```

### 7. Entity types

```dql
fetch dt.system.data_objects
| filter startsWith(name, "dt.entity.") and not(contains(name, ":"))
| fields value = upper(substring(name, from:10))
| sort value asc
```

Classic entity tables without generic (custom) types, as upper snake case (`PROCESS_GROUP_INSTANCE`).

### 8. Process group detected names

```dql
smartscapeNodes "PROCESS", from:now()-24h
| filter isNotNull(dt.process_group.detected_name)
| summarize n = count(), by:{value = toString(dt.process_group.detected_name)}
| sort n desc
| limit 500
```

### 9. Entity IDs

```dql
fetch dt.entity.host_group, from:now()-24h
| fields value = id, label = entity.name
| sort label asc
```

`dt.entity.host` or `dt.entity.process_group` replace the table. Values like `HOST_GROUP-0000000000000001` with the
name as label; capped at 1,000 rows by the default result limit.

### 10. ActiveGate groups

```dql
smartscapeNodes "ACTIVEGATE", from:now()-24h
| filter isNotNull(dt.active_gate.group.name)
| summarize n = countDistinct(dt.active_gate.id), by:{value = toString(dt.active_gate.group.name)}
| sort value asc
```

Rows with an empty `value` are dropped client side ([`useConditionValues`](../ui/app/iamValues.ts#L222)).

## API calls

| Method | Endpoint / SDK method | Scope | When |
| --- | --- | --- | --- |
| GET | `/api/iam-reference` (`functions.call("iam-reference")`) | none | Once per page load for all IAM tabs; **Retry** |
| GET (server side) | docs.dynatrace.com `…/advanced/iam-policystatements` and `…/advanced/iam-global-conditions` | outbound allowlist | Inside the function |
| GET | `/platform/app-engine/registry/v1/apps?add-fields=manifest.scopes,isBuiltin` | `app-engine:apps:run` | On tab open (for the preview's Policy Creator text) and for the `shared:app-id` picker; cached for the page load |
| GET | `/platform/classic/environment-api/v2/settings/schemas` (`settingsSchemasClient.getAvailableSchemaDefinitions`) | `settings:schemas:read` | `settings:schemaId` picker opened |
| GET | `/platform/classic/environment-api/v2/settings/schemas/<schemaId>` (`getSchemaDefinition`) | `settings:schemas:read` | **Look up groups** |
| GET | `/platform/classic/environment-api/v2/settings/objects?schemaIds=builtin:management-zones&scopes=environment&fields=objectId,value&pageSize=500` (+ `nextPageKey`) | `settings:objects:read` | management zone picker opened |
| GET | `/platform/extensions/v2/extensions?page-size=100` (+ `page-key`) | `extensions:definitions:read` | `extensions:extension-name` picker opened |

- `iam-reference` returns `{ status: "ok", checkedAt, catalog }`, or `{ status: "blocked" | "error", message }`
  (blocked when the error mentions the allowlist / `NotCapable`; error when fewer than 5 services parse). The
  catalogue gives every permission's conditions and operators, the global conditions and the page dates.
- App Registry fields used: `apps[].id`, `name`, `isBuiltin`, `appIcon.href`, `manifest.scopes[].name` / `comment`.
- Schemas: `items[].schemaId`, `displayName`; definition `schemaGroups`. Management zones: `value.name`.
  Extensions: `extensionName`, `version`, `nextPageKey`.

API results are cached per source for the page load and dropped from the cache after a failure.

## Remediation actions

None. The tab makes no write calls. Create the boundary in Account Management > Identity & access management >
Policy management > Boundaries, then select it when assigning a policy to a group.

## AI Assist on this page

[`analyzeIamBoundary`](../ui/app/analyses.ts#L800), rule-based and local, computed while the panel is open. Input
(built in [IamBoundaryTab.tsx](../ui/app/tabs/IamBoundaryTab.tsx#L86)): parsed condition count, error and warning
counts, services (`global` or the key's service prefix), repeated keys, global keys, the preview (only when the
previewed policy has an error-free ALLOW: statement count, effective count, ALLOW permissions not narrowed, DENY
count) and whether the docs are live.

**Empty boundary:** summary "The boundary is empty. Pick apps, dimensional data or other conditions on the left; each
becomes one line of the boundary."; info "A boundary restricts nothing on its own: it is selected when a policy is
assigned to a group, and only narrows the permissions that support its conditions."; recommendation (medium) "Pair a
boundary with a broad policy (for example a default policy such as Read Logs) so one policy serves many teams with
different data scopes."

**Otherwise summary:** "N conditions (of 10 allowed) for <services>; the editor reports E errors and W warnings."

| Insight | Severity | When |
| --- | --- | --- |
| N errors: boundaries take one condition per line, no AND, at most 10 conditions, and only conditions from the IAM policy reference. | critical | errors |
| Repeated: … Each statement those conditions apply to is multiplied, one copy per line, so matching any of the lines grants access. | info | repeated keys |
| Global conditions (…) apply to every permission of the bound policy. | info | global keys |
| Not narrowed by this boundary: … (first 5). None of its conditions applies to that permission / those permissions, so they keep the policy's access (unconditional if the policy sets no condition). | critical | preview with not-narrowed permissions |
| Every ALLOW statement of the previewed policy is narrowed: N statements become M effective statements. | good | preview, all narrowed |
| N DENY statements in the policy stay unchanged: boundaries do not apply to DENY. | info | preview with DENY |
| The live IAM policy reference could not be read; the checks use the bundled snapshot. | warning | not live |

| Recommendation | Impact | When |
| --- | --- | --- |
| Fix the errors under the editor; split conditions joined with AND into separate lines (or separate boundaries). | high | errors |
| Add a condition those permissions support (for entities, storage:dt.security_context or storage:entity.type), or leave them out of the policy bound with this boundary. | high | not-narrowed permissions |
| Close to 10 conditions: assign several boundaries to the same policy instead; each boundary is evaluated separately. | medium | 9 or more conditions |
| Create it in Account Management > Identity & access management > Policy management > Boundaries, then select it when assigning policies to a group. | low | always |

## Limitations and edge cases

- The tab writes text and previews; it does not create or assign boundaries.
- The preview evaluates one boundary against one policy. Several boundaries on one binding (each evaluated
  separately) are handled by the Permissions Test tab, not here.
- *narrowed* means at least one boundary condition was added; a boundary that adds only a global time window counts
  as narrowing even though the data is not restricted.
- Statements with syntax errors are not previewed; boundary lines with errors are ignored by the preview.
- Loading text puts dimension keys into **More conditions**, not into the Dimensional data card; only the first
  `shared:app-id` line goes to Apps.
- When loading, a line that starts with the key of an already loaded condition but contains an error (for example
  `… AND …`) is neither loaded nor listed as left out.
- A dimension operator that some ticked key does not support is still written and reported.
- Unknown keys are rejected as errors (they would restrict nothing), unlike unknown permissions in policies.
- Drafts are per browser and app origin.

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| Snapshot banner, "add docs.dynatrace.com to the allowed outbound connections" | JavaScript runtime allowlist | Add `docs.dynatrace.com` in the linked setting; **Retry**. |
| Snapshot banner with HTTP 404 | Function not in the running build | Restart `npx dt-app dev` or deploy; **Retry**. |
| Preview shows *unrestricted* rows | No boundary condition applies to those permissions | Add a condition they support (e.g. `storage:dt.security_context` for `storage:entities:read`), or drop them from the policy. |
| Preview: "The boundary has no usable condition yet" | Every line has an error, or no value is set | Fix the errors under the editor. |
| "The IAM Policy Creator has no policy yet." | Policy Creator draft empty | Build one there or choose *Other policy*. |
| "Could not load suggestions: …" | Missing scope or your own permission | Type the value; check scopes and Grail permissions. |
| Error "… is not a condition of any permission …" for a new key | Snapshot in use or key misspelled | Check the live reference; with the live docs the key is known once documented. |
| Account Management rejects the boundary | Comments, AND, more than 10 lines, or an unsupported operator | Fix the diagnostics; remove `//` lines. |

## Related pages

- [IAM Policy Creator](iam-policy-creator.md): the policy the preview uses by default, and the docs patterns.
- [Permissions Test](permissions-test.md): tests the Policy Creator draft with this boundary draft, or real bindings.
- [Security context](security-context.md), [Data Overview](data-overview.md): whether records carry the fields a
  boundary relies on.
- [Index](README.md).

## Source files

| File | Role on this page |
| --- | --- |
| [ui/app/tabs/IamBoundaryTab.tsx](../ui/app/tabs/IamBoundaryTab.tsx) | Tab layout, apps, dimensions, more conditions, preview, AI Assist input |
| [ui/app/tabs/IamShared.tsx](../ui/app/tabs/IamShared.tsx) | Catalogue banner, operator select, value picker, condition row, editor pane, Copy / Export |
| [ui/app/tabs/IamPolicyTab.tsx](../ui/app/tabs/IamPolicyTab.tsx) | `LoadNote` |
| [ui/app/iamPolicy.ts](../ui/app/iamPolicy.ts) | Boundary rendering, validation, `applyBoundary`, text-to-draft, examples |
| [ui/app/iamCatalog.ts](../ui/app/iamCatalog.ts) | Live / snapshot catalogue, dimensions, operators, docs URLs |
| [ui/app/iamValues.ts](../ui/app/iamValues.ts) | Value sources and loaders |
| [ui/app/iamApps.ts](../ui/app/iamApps.ts) | App Registry catalogue (for the Policy Creator text in the preview) |
| [ui/app/iamDrafts.tsx](../ui/app/iamDrafts.tsx) | Drafts in localStorage |
| [ui/app/iamSnapshot.json](../ui/app/iamSnapshot.json) | Bundled catalogue |
| [ui/app/queries.ts](../ui/app/queries.ts#L1312) | Value suggestion queries |
| [api/iam-reference.function.ts](../api/iam-reference.function.ts), [api/iam-reference-parser.ts](../api/iam-reference-parser.ts), [scripts/sync-iam-reference.mjs](../scripts/sync-iam-reference.mjs) | Live docs read, parser, snapshot refresh |
| [ui/app/analyses.ts](../ui/app/analyses.ts#L788) | `analyzeIamBoundary` |
