# Permissions Test

The **Permissions Test** tab answers "what can this user (or group) actually do in this environment?". You pick a
user (by name or email) or a group (by name). The tab reads what is bound to that subject in Account Management:
group membership, policy bindings on the account and on this environment, the bound policies, their boundaries and
bind parameters. It then evaluates the policy text locally with the same engine as the IAM Policy Creator and IAM
Boundary Creator tabs. The result is shown in three parts: every installed app as **Access** (it opens and can read the
data it needs), **Conditional** or **No access**; the Grail data the subject can read per table (every record, only
records with certain dimension values, or none); and the bindings and effective statements behind both. A third mode,
**Policy Creator draft**, runs the same evaluation on the draft policy (and optional boundary) from the builder tabs
without any Account Management access. The tab never writes IAM configuration. Its only write is saving its own OAuth
client to the credential vault.

| | |
| --- | --- |
| Area | Users and permissions (see [index](README.md)) |
| Tab id | `iam-access` |
| Counts toward Entity Overview readiness / Top findings | No. The tab computes no readiness score and feeds nothing into the Entity Overview. |
| Main source files | [`ui/app/tabs/IamAccessTab.tsx`](../ui/app/tabs/IamAccessTab.tsx), [`ui/app/iamAccess.ts`](../ui/app/iamAccess.ts), [`ui/app/iamAccessApi.ts`](../ui/app/iamAccessApi.ts), [`api/iam-access.function.ts`](../api/iam-access.function.ts), [`ui/app/iamPolicy.ts`](../ui/app/iamPolicy.ts), [`ui/app/iamApps.ts`](../ui/app/iamApps.ts), [`ui/app/iamCatalog.ts`](../ui/app/iamCatalog.ts), [`ui/app/iamDrafts.tsx`](../ui/app/iamDrafts.tsx), [`ui/app/queries.ts`](../ui/app/queries.ts) (records query), [`ui/app/analyses.ts`](../ui/app/analyses.ts) (`analyzeIamAccess`) |

## Contents

- [What this page answers](#what-this-page-answers)
- [Before you start](#before-you-start)
  - [App scopes used by this page](#app-scopes-used-by-this-page)
  - [User permissions](#user-permissions)
  - [One-time setup](#one-time-setup)
- [Page walkthrough](#page-walkthrough)
  - [Shell controls that affect this page](#shell-controls-that-affect-this-page)
  - [Heading, description and catalogue banner](#heading-description-and-catalogue-banner)
  - [Who to test](#who-to-test)
  - [Account Management access](#account-management-access)
  - [Loading and failure messages](#loading-and-failure-messages)
  - [Summary card](#summary-card)
  - [Apps](#apps)
  - [App detail](#app-detail)
  - [Dimensional data](#dimensional-data)
  - [Where the access comes from](#where-the-access-comes-from)
  - [IAM documentation links](#iam-documentation-links)
- [Checks and scoring](#checks-and-scoring)
  - [How the evaluation works, step by step](#how-the-evaluation-works-step-by-step)
  - [Status tables](#status-tables)
  - [Worked example](#worked-example)
- [Queries](#queries)
  - [Q1 Readable records of one table (iamVisibleRecordsQuery)](#q1-readable-records-of-one-table-iamvisiblerecordsquery)
- [API calls](#api-calls)
- [Remediation actions](#remediation-actions)
- [AI Assist on this page](#ai-assist-on-this-page)
- [Limitations and edge cases](#limitations-and-edge-cases)
- [Troubleshooting](#troubleshooting)
- [Related pages](#related-pages)
- [Source files](#source-files)

## What this page answers

- **Which apps can this user or group open in this environment?** Opening an app needs an ALLOW of
  `app-engine:apps:run` whose conditions cover the app (`shared:app-id`). A DENY overrides it.
- **Will the app show data once it opens?** An app that opens but cannot read the Grail tables its manifest requires
  shows empty views. The tab flags this as *Conditional* and does not treat it as *Access*.
- **Which Grail records can the subject read, and limited by what?** For each Grail table permission
  (`storage:<table>:read`), the tab shows whether every record is readable, only records with certain values of a
  dimension (security context, host group, Kubernetes namespace, bucket, and so on), or nothing. Table permissions also
  need `storage:buckets:read` for the buckets that hold the data, and the tab combines both
  ([Permissions in Grail](https://docs.dynatrace.com/docs/platform/grail/organize-data/assign-permissions-in-grail)).
- **Where does each grant come from?** For each binding: the policy, the group, the level (account or environment),
  the boundaries, the bind parameters, and the effective statements after all of them are applied.
- **Does a new policy do what I intend before I bind it?** *Policy Creator draft* mode evaluates the IAM Policy
  Creator's policy, optionally with the IAM Boundary Creator's boundary, as if it were the only policy bound to a group.

The documented rules the evaluation follows:

- Statements are checked against the [IAM policy reference](https://docs.dynatrace.com/docs/manage/identity-access-management/permission-management/manage-user-permissions-policies/advanced/iam-policystatements).
  The reference is read live, and the app falls back to a bundled snapshot when it cannot.
- Boundaries are applied as described in [How are policy boundaries applied?](https://docs.dynatrace.com/docs/manage/identity-access-management/permission-management/manage-user-permissions-policies/iam-policy-boundaries#apply-boundary).
  Statements are split per permission. Only boundary conditions that the permission supports apply (global conditions
  always apply). Repeated condition keys multiply the statement. DENY statements are left as they are.
- Bind parameters (`${bindParam:…}`) are filled in, following [Policy templating](https://docs.dynatrace.com/docs/manage/identity-access-management/permission-management/manage-user-permissions-policies/advanced/iam-policy-templating).
- DENY wins over ALLOW. A conditional DENY on a Grail table permission runs as an unconditional DENY (Permissions in Grail).
- Dynatrace default policies are included when they are bound
  ([Dynatrace default policies reference](https://docs.dynatrace.com/docs/manage/identity-access-management/permission-management/default-policies)).

Best practice the page helps verify: give each group least privilege. That means one `shared:app-id` statement per app
instead of an unconditional `app-engine:apps:run`, and data policies narrowed with boundaries on security context or
another dimension. The [AI Assist](#ai-assist-on-this-page) rules make the same recommendations.

## Before you start

### App scopes used by this page

From [`app.config.json`](../app.config.json) and the code of this tab:

| Scope | What this page uses it for |
| --- | --- |
| `iam:users:read` | Find users by name or email with the environment IAM API (`usersAndGroupsClient.getActiveUsersForOrganizationalLevel`). |
| `iam:groups:read` | Find groups by name with the environment IAM API (`usersAndGroupsClient.getVisibleGroupsForAccount`). |
| `environment-api:credentials:read` | The `iam-access` app function reads the OAuth client credential `architect-assistant-account-api` (list, then details). The browser also lists credentials before saving one. |
| `environment-api:credentials:write` | *Save to the credential vault* creates or updates the credential `architect-assistant-account-api`. |
| `app-engine:apps:run` | List installed apps and the scopes their manifests request (App Registry), and load app icons. |
| `storage:*:read` scopes (`storage:logs:read`, `storage:spans:read`, `storage:events:read`, `storage:bizevents:read`, `storage:smartscape:read`, `storage:system:read`, `storage:buckets:read`, ...) | Not used by the page itself. The [records query](#q1-readable-records-of-one-table-iamvisiblerecordsquery) is only displayed, copied or sent to Notebooks / Dashboards, where it runs with your own permissions. |

The Account Management API is not reached through an app scope. The `iam-access` function calls it with an OAuth
client of the account (see [One-time setup](#one-time-setup)).

### User permissions

Beyond the app scopes, the signed-in user needs:

- **For the environment IAM search:** an assignment to the account the environment belongs to. The SDK documents that
  "authorization is based on an assignment of the calling user to the account". No permission inside the environment
  is needed. When this call fails, the search falls back to the account's user and group lists through the `iam-access`
  function, which uses the OAuth client.
- **For the credential vault:** the classic Credential vault API. The SDK lists `environment:roles:viewer` as the
  required permission for list, details, create and update.
- **To use a stored credential:** if the credential is *owner only* (the default), only its owner can read it. When
  another user opens the tab, the function cannot read it and reports that no credential exists (or that it is owned
  by someone else).
- **For the records query:** when it is opened in a Notebook or on a Dashboard, it runs with *your* Grail permissions,
  not with the tested subject's permissions. It can only show records that both of you can read.
- **Policy Creator draft mode** needs none of the above. It evaluates the local draft only. The installed-app list and
  the IAM reference are still loaded.

### One-time setup

Setup applies to the *User* and *Group* modes only. The *Account Management access* card walks you through it, and the
card's form does step 3 for you.

1. **OAuth client.** In [Account Management](https://myaccount.dynatrace.com/) > Identity & access management > OAuth
   clients, create a client with these scopes:
   - `account-idm-read`, `iam:bindings:read`, `iam:policies:read`, `iam:boundaries:read` (read-only, preferred), or
   - `account-idm-read`, `iam-policies-management` (for older accounts without the fine-grained IAM scopes).

   The function requests the read-only set first. It requests the legacy set only when the token endpoint answers
   `invalid_scope`. That page also shows the **account UUID**, which you need in step 3. Background:
   [OAuth clients](https://docs.dynatrace.com/docs/manage/identity-access-management/access-tokens-and-oauth-clients/oauth-clients),
   [Account Management API authentication](https://docs.dynatrace.com/docs/dynatrace-api/basics/dynatrace-api-authentication/account-api-authentication).
2. **Allowed outbound connections.** If the setting `builtin:dt-javascript-runtime.allowed-outbound-connections` is
   enforced, add `sso.dynatrace.com` (token endpoint) and `api.dynatrace.com` (Account Management API). The
   [catalogue banner](#heading-description-and-catalogue-banner) additionally needs `docs.dynatrace.com` there for the
   `iam-reference` function. Without it, the tab uses the bundled snapshot of the IAM reference. On sprint and dev
   environments the hosts differ; see [Sprint and dev environments](#sprint-and-dev-environments). The card lists the
   hosts for the environment the app runs in.
3. **Credential vault.** Saving the form stores a *User and password* credential with these properties:
   - Name: `architect-assistant-account-api`.
   - User: the client ID. Password: the client secret.
   - Scope: App Engine.
   - Description: `Architect Assistant Permissions Test: OAuth client for the Account Management API (read-only). Account UUID: <uuid>`.

   The function reads the account UUID back out of this description
   ([Credential vault](https://docs.dynatrace.com/docs/manage/credential-vault)). If you create the credential by hand,
   use the same name and type, select the App Engine scope, and put the account UUID anywhere in the description.
4. **Owner only.** *Only I can use it (owner only)* is checked by default, which sets `ownerAccessOnly: true`. Turn it
   off only if every user of the app may read the account's groups, policies and boundaries through it.

## Page walkthrough

### Shell controls that affect this page

- **Timeframe** (Last 24 hours default, Last 7 days, Last 30 days). It changes only the text of the
  [records query](#q1-readable-records-of-one-table-iamvisiblerecordsquery) (`from:now()-24h|7d|30d` and the log/span
  sampling ratio). The evaluation itself does not depend on time.
- **AI Assist** toggle in the header. It opens the [AI Assist panel](#ai-assist-on-this-page) at the top of the tab.
- **Permissions Test documentation** link above the tab. It opens this page.
- The **IAM Policy Creator** and **IAM Boundary Creator** drafts live in `IamDraftsProvider` above all tabs. They are
  persisted in this browser's `localStorage` under `architect-assistant.iam-drafts.v2` (v1 drafts are migrated).
  Draft mode reads them live.

### Heading, description and catalogue banner

The **Permissions Test** heading has a short description with links to Account Management and the IAM policy reference.

Below it is the **catalogue banner** (`CatalogBanner` in [`IamShared.tsx`](../ui/app/tabs/IamShared.tsx)). It reports
where the permission catalogue comes from. The catalogue is loaded once per page load (`useIamCatalog`) by the
`iam-reference` app function, which reads the IAM policy reference and the global conditions page from
docs.dynatrace.com. The IAM builder tabs share the same load. The banner has three states:

- **Loading:** "Reading the IAM policy reference from docs.dynatrace.com… Until then the bundled snapshot of
  2026-10-24 is used."
- **Live:** "Permissions, conditions and operators are read live from the IAM policy reference (updated *date*) at
  *time*." The banner then says either "No change since the bundled snapshot" or counts what is new, removed or changed
  since the snapshot, with *Show changes* / *Hide changes*.
- **Snapshot (live read failed):** a warning, "Using the bundled permission snapshot of 2026-10-24", with the reason.
  If docs.dynatrace.com is blocked, the reason includes a link to the allowed-outbound-connections setting. The banner
  adds this tab's note: "Permissions added to the docs after the snapshot are not tested here (apps' manifest scopes
  count as non-IAM), and boundaries do not narrow them." A **Retry** link re-reads the catalogue.

The catalogue decides the following:

- which permissions are Grail data rows;
- which manifest scopes count as IAM permissions;
- which boundary conditions apply to which permission;
- which dimensions exist;
- which boundary conditions are rejected as unreadable.

At the 2026-10-24 snapshot there are 17 dimensions:

| Dimension | Attribute |
| --- | --- |
| Security context | `dt.security_context` |
| Grail bucket | `bucket-name` |
| Host group | `dt.host_group.id` |
| Kubernetes cluster | `k8s.cluster.name` |
| Kubernetes namespace | `k8s.namespace.name` |
| Host name | `host.name` |
| AWS account | `aws.account.id` |
| Azure subscription | `azure.subscription` |
| Azure resource group | `azure.resource.group` |
| GCP project | `gcp.project.id` |
| Frontend | `frontend.name` |
| Event kind | `event.kind` |
| Event type | `event.type` |
| Event provider | `event.provider` |
| Log source | `log.source` |
| Metric key | `metric.key` |
| Entity type | `entity.type` |

### Who to test

The **Who to test** card has a toggle with three modes: **User**, **Group** and **Policy Creator draft**. Switching
mode clears the current result and the search results.

**User** and **Group** modes:

- **Text input** with a placeholder. User mode: "Name or email, e.g. alex or alex.kim@example.com". Group mode: "Group
  name contains, e.g. developers".
- **Search** button. It is disabled below 3 characters or while a search runs. Enter also submits.
- **Hint text.** User mode: "Matches emails that contain the text and names that start with it (3 characters or
  more)." Group mode: "Matches group names that contain the text (3 characters or more)."
- **How the search runs** (`searchSubjects`, [`iamAccessApi.ts`](../ui/app/iamAccessApi.ts#L92)):
  1. The environment IAM API is called first, for up to 50 results.
  2. If it throws (for example because you are not assigned to the account), the search calls the `iam-access`
     function with `action: "search"`. The function lists all users or groups of the account and filters them itself:
     - users whose email contains the text, or whose "name surname" or "surname name" contains it (case-insensitive);
     - groups whose name contains the text.

     The function returns at most 50 hits plus the total count.
- **Result line:**
  - "*N* users found" / "*N* groups found", or "Nothing found.";
  - ", first *X* shown; refine the search" when there are more hits than shown;
  - " (from the account's lists: the environment IAM API was not available)" when the fallback was used;
  - ". Click one to test it."

  If both the environment API and the fallback fail, a red message reads "Search failed: *environment error* ·
  Account Management API: *function error*".
- **Result list.** It scrolls at 240 px. Each row is a button with:
  - an account or group icon;
  - the name in bold;
  - the email (users, when it differs from the name);
  - a detail on the right: the user description or group type from the environment API, or the user status or group
    owner from the fallback.

  Clicking a row runs the test: users with `{kind: "user", email}`, groups with `{kind: "group", uuid, name}`. Rows
  are disabled while a test runs.
- **Direct test.** In User mode, typing a full email shows **Test *email* directly**. In Group mode, typing a group
  UUID shows **Test group *uuid* directly**. A direct group test sends no name, so the function reads the account's
  group list to find it.

**Policy Creator draft** mode:

- The card shows: "Tests the policy in the IAM Policy Creator tab (hand edits included), as if it were the only policy
  bound to a group. Changes in those tabs show here right away; no Account Management access is needed." If the IAM
  Boundary Creator has a boundary, the card adds ", assigned with the boundary in the IAM Boundary Creator tab".
- **Apply the IAM Boundary Creator's boundary** checkbox. It is shown only when a boundary exists and is on by default.
- The policy text is the Policy Creator's hand-edited text when there is one. Otherwise the tab renders it from the
  draft (`renderPolicy`). The boundary is handled the same way (`renderBoundary`).
- If the policy is empty: "The IAM Policy Creator has no policy yet. Build one there first." No result is shown.
- In this mode the Account Management card, the loading and failure messages and **Test again** are hidden. The result
  updates on every draft change.

### Account Management access

The **Account Management access** card is hidden in draft mode. When the tab mounts, it calls the function with
`action: "status"`. That call reads the credential and requests a token, so the card also checks that both work. The
card can be in one of these states:

| State | What the card shows |
| --- | --- |
| Checking | "Checking the OAuth client…" |
| Connected (`ok`) | A check mark and "Connected to account *uuid* with *scopes*. Credential `architect-assistant-account-api` (owner *owner*, owner only: other users of this app cannot run the test)". When the credential is shared, the end reads "shared: every user of this app can read the account's IAM setup". *scopes* is the `scope` value of the token response. A **Change credential** / **Cancel** button toggles the form. |
| Missing (`no-credential`) | A neutral message: "Users and groups are found with this environment's IAM API, but their group membership, policies and boundaries are only exposed by the account-level Account Management API, which needs an OAuth client of the account. Store one below (read-only scopes)." The form is open. |
| Connected, IAM scopes missing | A warning under the card: "The stored OAuth client can search users and groups, but testing them also needs iam:bindings:read, iam:policies:read and iam:boundaries:read. Add them to the client in Account Management." Shown when the token's scopes include neither those three nor `iam-policies-management` (a client with only `account-idm-read`, which is enough for the search and the status check). |
| Failing, blocked | A warning: "The app function cannot reach *hosts*: add these hosts to the allowed outbound connections." *hosts* are the token and API hosts of this environment's stack (`sso.dynatrace.com, api.dynatrace.com` on production). It includes an **Allowed outbound connections** link (intent `dynatrace.settings` / `open_settings_for_schema` for `builtin:dt-javascript-runtime.allowed-outbound-connections`). The form is open. |
| Failing, other | A warning: "The stored OAuth client does not work: *message*" (for example, the token request was rejected). The form is open. |

**The form** has these parts:

- Three numbered steps: create the client with the scopes listed above, allow the two hosts, then save the client here.
- Fields:
  - **Client ID**, placeholder `dt0s02.ABCD1234`;
  - **Client secret**, a password field, placeholder `dt0s02.ABCD1234.…`;
  - **Account UUID**, placeholder `01234567-89ab-cdef-0123-456789abcdef`.
- Checkbox **Only I can use it (owner only)**, checked by default.
- **Save to the credential vault** button. It is disabled until all three fields are filled and shows "Saving…" while
  it runs.

Before any call, the browser validates the input (`storeAccountCredential`):

| Field | Rule | Message when it fails |
| --- | --- | --- |
| Client ID | must match `^dt0s0\d\.[A-Za-z0-9]+$` | "That does not look like an OAuth client ID (dt0s02.XXXX)." |
| Secret | must match `^dt0s0\d\.[A-Za-z0-9]+\.[A-Za-z0-9]+$` | "That does not look like an OAuth client secret (dt0s02.XXXX.YYYY)." |
| Account UUID | must be a UUID; it is lowercased | asks for the 01234567-89ab-cdef-0123-456789abcdef form |

The browser then lists credentials named `architect-assistant-account-api`. It updates the existing credential, or
creates one if none exists ([API calls](#api-calls) B6–B8). On success:

- the message reads `Credential "architect-assistant-account-api" updated.` (or `created.`);
- the secret field is cleared;
- the form closes;
- the status check runs again.

On failure, the API error message is shown in red.

Below the form, **Setup documentation** links to OAuth clients, Account Management API authentication and Credential
vault.

### Loading and failure messages

While a test runs: "Reading the groups, policies and boundaries of *label*…" with a spinner.

If the test fails, the tab shows a message titled by the failure status:

| Status | Title | Variant | How the function decides |
| --- | --- | --- | --- |
| `no-credential` | No OAuth client stored for the Account Management API | critical | The credential is not found, not readable (owner-only and owned by someone else), has no ID or secret, or has no account UUID in its description. Errors reading the vault also land here ("Could not read the credential vault: …"). |
| `unauthorized` | The Account Management API refused the request | critical | The token request was rejected, or any API GET returned 401 or 403. The message adds: "The OAuth client needs account-idm-read plus iam:bindings:read, iam:policies:read and iam:boundaries:read (or iam-policies-management)." |
| `blocked` | The app function cannot reach the Account Management API | critical | The error message matches `allowlist` or `NotCapable` (the runtime's "Blocked request to '<host>' (host not in allowlist)"). |
| `not-found` | *label* was not found in the account | warning | An API GET returned 404 (typically `GET …/users/<email>` for an unknown email). |
| `error` | Reading the permissions failed | critical | Anything else. Examples: a missing environment ID, HTTP 404 from `/api/iam-access` ("the iam-access app function is not available in this running app (HTTP 404). Restart npx dt-app dev (or deploy), then retry."), or another HTTP error from the function. |

Each message ends with a **Retry** link that repeats the last test.

### Summary card

This card is shown once a test is done, and in draft mode once the draft has a policy. It contains:

- **Subject:**
  - a group icon (group) or account icon (user and draft);
  - the name;
  - a subtitle: the user's email, `Group <uuid>`, or "Draft policy from the IAM Policy Creator", followed by
    ` · environment <id>` (not shown in draft mode).
- **Test again** (user and group modes). Re-reads everything from Account Management.
- **Member of *N* groups:** (users only), with one pill per group. Hovering a pill shows the group UUID.
- **Counts line:** "*P* policies bound (*B* boundaries) → *S* effective statements."
  - *P* is the number of distinct policy UUIDs over all bindings.
  - *B* is the number of distinct boundary UUIDs. The bracket is shown only when *B* > 0.
  - *S* is the number of [effective statements](#how-the-evaluation-works-step-by-step).
- **Two stacked bars.** These are custom bars, not Strato charts. Each segment's width is value / total. Segments with
  value 0 are omitted. Hovering a segment shows "label: value", and a legend with the counts is shown below each bar.
  - **Apps (*N* installed)**, or "(reading installed apps…)" until the App Registry answers. Segments: Access (green),
    Conditional (amber), No access (red), from the [app statuses](#status-tables).
  - **Grail tables (*N*)**, counting the data rows without the `storage:buckets:read` row. Segments: All records (solid
    green), Limited (hatched green), Conditional (amber), No access (red; counts both *missing* and *denied*).
- **Warnings.** An amber list follows: first the function's warnings (environment not found, policy or boundary not
  readable), then the engine notes (statements or boundary conditions that could not be read, unbound bind
  parameters). The texts are listed under [Checks and scoring](#status-tables).

### Apps

This card lists every installed app from the App Registry. Each app's manifest is analysed with the Policy Creator's
`summarizeApp` ([`iamApps.ts`](../ui/app/iamApps.ts#L55)).

- **Legend:**
  - **Access**: "opens and can read the data it needs (possibly limited, see Dimensional data)".
  - **Conditional**: "opens only at certain times or for some users, or some of its data is not readable".
  - **No access**: "cannot be opened".
- **Error.** If the App Registry call fails: "Could not read the installed apps (App Registry): *message*". Until the
  list arrives: "Reading installed apps…".
- **Filters:**
  - **Search apps**: case-insensitive substring match on the app name or ID.
  - Status toggle: **All (*n*)**, **Access (*n*)**, **Conditional (*n*)**, **No access (*n*)**.
  - Owner toggle: **All**, **Dynatrace** (`isBuiltin` true), **Custom** (`isBuiltin` false).

  When nothing matches: "No app matches the filters."
- **Sort order:** Access first, then Conditional, then No access. Within each status, apps are sorted by name.
- **App cards.** The grid uses cards of at least 168 px and scrolls at 560 px. Each card shows:
  - The app icon, loaded when the card scrolls into view, 6 at a time. If the app has no icon, the first letter of its
    name is shown instead.
  - The name (up to 2 lines). Hovering shows the app ID.
  - A status dot in the top-right corner.
  - Level badges **R**, **W**, **E** (Read / Write / Execute). A badge is shown only for levels whose manifest has
    permissions, and only when the app's status is not *No access*. Colours: green when every permission of the level
    is granted, amber when some are, red when none are. Hovering shows the meaning ("every permission granted", ...).
  - A note, which is the first of these that applies:
    1. the first reason for the status;
    2. "Data: *r* of *t* tables[, limited]", where *t* is the number of required (non-optional) data permissions and *r*
       the number of them that are granted or limited;
    3. "Opens; shows no Grail data".

  The card border has the status colour (grey for *No access*). *No access* cards are shown at 80% opacity. A selected
  card gets a glow.
- **Selecting an app.** Clicking a card, or pressing Enter or Space on it, selects it and scrolls to the
  [app detail](#app-detail). Clicking it again deselects it.

### App detail

The detail panel for the selected app contains:

- **Header:** status dot, name, app ID, and the status with all reasons joined by "; ". A **Close** button deselects
  the app.
- **Opening the app (app-engine:apps:run):** the statements behind the run permission, from the `GrantList` component:
  - DENY statements come first, in red.
  - Then up to 6 ALLOW statements, sorted by how many conditions are left open (fewest first). If there are more:
    "+*n* more statements".
  - Under each statement: *policy · group · level*, ` · boundary <name>` when a boundary applies, and ` · depends on
    <...>` when conditions are left open.
  - If nothing applies: "No ALLOW of app-engine:apps:run covers this app."
- **Grail data it shows:** one pill per data permission in the manifest, reading "*Table*: *status*", plus
  " (optional)" for optional permissions. The pill is coloured by the [data status](#status-tables), and hovering shows
  the permission. If some required tables are limited: "Limited tables: see Dimensional data below for the values."
- **Read / Write / Execute permissions its manifest requests (*x* of *y* granted):** one pill per permission:
  - `✓` for granted or limited, `?` for conditional, `✗` for missing or denied;
  - hovering shows the status, the first granting policy (group) and any open conditions.

  A level's pills contain the manifest's app permissions of that level plus the app-owned permissions (`state:*`,
  `state-management:*`, `app-settings:*` with `shared:app-id`) of that level.
- **Not IAM policy permissions (not tested):** manifest scopes that are not in the IAM reference (for example
  `environment-api:*`), plus the app's own `app-engine:apps:run` (that scope lets the app open other apps).

### Dimensional data

The card starts with this text: "Which Grail records the subject can read: per table permission, whether every record
is readable, only records with certain dimension values ... or none. Table permissions also need
`storage:buckets:read` for the buckets that hold the data; both are combined here." It links to Permissions in Grail.

**Coverage strip.** One tile per data row, coloured by [data status](#status-tables):

- solid green with white text for *All records*;
- hatched green for *Limited*;
- outlined amber for *Conditional*;
- outlined red for *No access* and *Denied*.

Clicking a tile switches to **By table**, highlights that row, scrolls to it and, if the row has a records query, opens
it.

The rows come from the catalogue: every `storage:*:read` permission that has a record-level dimension condition other
than `bucket-name`, plus `storage:buckets:read`. They are sorted in a fixed order, and unknown tables are sorted
alphabetically at the end. At the snapshot there are 15 rows:

| Row | Permission | Bucket check (`storage:buckets:read` with `storage:table-name`) | Records query |
| --- | --- | --- | --- |
| Grail buckets | `storage:buckets:read` | (this row) | no |
| Logs | `storage:logs:read` | `logs` | yes |
| Metrics | `storage:metrics:read` | `metrics` | no |
| Spans | `storage:spans:read` | `spans` | yes |
| Events | `storage:events:read` | `events` | yes |
| Business events | `storage:bizevents:read` | `bizevents` | yes |
| Entities (classic) | `storage:entities:read` | none (no buckets) | no |
| Smartscape | `storage:smartscape:read` | none (no buckets) | yes (`smartscapeNodes "*"`) |
| Security events | `storage:security.events:read` | `security.events` | yes |
| System events | `storage:system:read` | `dt.system.events` | yes |
| User events | `storage:user.events:read` | `user.events` | yes |
| User sessions | `storage:user.sessions:read` | `user.sessions` | yes |
| Session replays | `storage:user.replays:read` | `user.replays` | no |
| Application snapshots | `storage:application.snapshots:read` | `application.snapshots` | no |
| Profiles | `storage:profiles:read` | none | no |

**View toggle:** **By table** (default) or **By dimension**.

**By table.** A five-column grid that scrolls horizontally below 820 px:

| Column | Content |
| --- | --- |
| Table | Label, with the permission in monospace below it. |
| Can read | The [data status](#status-tables) label in its colour. *Denied* adds "DENY wins over ALLOW". *Conditional* adds "depends on *what*", taken from the table permission's first grant. "no bucket access" is added when the table permission is granted or limited but bucket access is not. |
| Records limited to | "—" for missing or denied. "every record" when an unconditional ALLOW exists. Otherwise the grant paths, one line per path joined by **or**, with the conditions of a path joined by **and** (for example `dt.security_context IN ("team-a", "team-b")`; the `storage:` prefix is dropped). Hovering a condition shows its dimension label. |
| Buckets | "(this row)" for the buckets row. "no buckets" for tables without buckets. Otherwise "not granted", "denied", "all", or the bucket grant paths (for example `bucket-name MATCH ("default_*")`). |
| Granted by | Up to 3 distinct "*policy*" or "*policy* + *boundary*" sources, then "+*n*". If there is no grant but a DENY: "DENY in *policy*". Otherwise "—". For rows whose status is *All records* or *Limited* and that have a record source, a **Records query** / **Hide records query** link follows. |

When the records query is open, the row shows this explanation: "The records of *table* this subject can read in the
selected timeframe, counted by the dimensions that limit them. The query runs with your permissions, so it can only
show records you can read too; matchesValue is case-insensitive, so it can be slightly wider than IAM." It also shows
**Show DQL / Copy / Open in Notebook / Add to Dashboard** (see [Q1](#q1-readable-records-of-one-table-iamvisiblerecordsquery)).

**By dimension.** This view contains:

- "**Every record** (no dimension limits): *tables*". This lists the rows with status *All records*, excluding the
  buckets row.
- One block per dimension that limits at least one *Limited* row, sorted by label. Each block shows the dimension label
  and attribute, then one line per distinct condition (operator and values without the key, for example
  `IN ("team-a", "team-b")`) followed by "on *tables*".

  The conditions come from the grant paths of the table permission and of its bucket check. Only attributes that are
  dimensions are listed, so `table-name` and global conditions are not.
- "No table is limited by dimensional data." when no dimension block exists.
- "No access: *tables*" in red, for missing and denied rows.
- The footnote: "Values listed for one dimension are alternatives (any of them grants access); conditions of different
  dimensions in one statement must all hold; see By table for how they combine per table."

### Where the access comes from

This card lists the bindings behind the result.

- **Copy effective statements** (disabled when there are none) copies one line per effective statement, in the form
  `<statement>  // <policy> · <group>[ · <boundary>]`. "Copied" is shown for 1.5 s.
- If there are no bindings: "No policy is bound to this user's groups (or: this group) on the account or in this
  environment, so nothing is granted."
- For users: "Groups without a policy here: …". These are the user's groups that no binding names.
- **One block per binding.** Bindings are sorted by group name, then policy name. Each block shows the policy name and
  a detail line built from these parts:
  - the policy's level: `Dynatrace default policy` (global level), `account policy` or `environment policy`;
  - ` · bound to <group> on the account (all environments)` or ` · bound to <group> on the environment <id>`;
  - ` · boundary <names>` or ` · no boundary`;
  - ` · parameters k=v, …` when bind parameters are set.

  In draft mode the detail line reads "IAM Policy Creator".
- **Show / Hide *n* effective statements.** This expands the block to a 280 px scroll area. It shows each boundary's
  text (as `// boundary <name>` followed by the boundary query), then the binding's effective statements in monospace.
  DENY statements are red, and statements from a boundary pass end with `// <boundary>`.
- **Footnote:** "Effective statements: one per permission, after bind parameters and boundaries (each boundary of a
  binding applied separately, as in How are policy boundaries applied?). Classic environment roles
  (environment:roles:*) are listed but do not affect app access here."

### IAM documentation links

The bottom of the tab links to:

- [IAM policy reference](https://docs.dynatrace.com/docs/manage/identity-access-management/permission-management/manage-user-permissions-policies/advanced/iam-policystatements)
- [Policy boundaries](https://docs.dynatrace.com/docs/manage/identity-access-management/permission-management/manage-user-permissions-policies/iam-policy-boundaries)
- [Policy templating](https://docs.dynatrace.com/docs/manage/identity-access-management/permission-management/manage-user-permissions-policies/advanced/iam-policy-templating)
- [Permissions in Grail](https://docs.dynatrace.com/docs/platform/grail/organize-data/assign-permissions-in-grail)
- [Dynatrace default policies reference](https://docs.dynatrace.com/docs/manage/identity-access-management/permission-management/default-policies)
- [Account Management API](https://docs.dynatrace.com/docs/dynatrace-api/account-management-api)
- [Policy bindings API](https://docs.dynatrace.com/docs/dynatrace-api/account-management-api/policy-management-api/bindings/get-level-binding)
- [OAuth clients](https://docs.dynatrace.com/docs/manage/identity-access-management/access-tokens-and-oauth-clients/oauth-clients)

## Checks and scoring

The tab computes no score. Everything below is computed in the browser by the pure functions in
[`iamAccess.ts`](../ui/app/iamAccess.ts) (`evaluateAccess`), on top of the parser and boundary engine in
[`iamPolicy.ts`](../ui/app/iamPolicy.ts).

### How the evaluation works, step by step

**1. Bindings.** The function's result is turned into one `AccessBinding` per pair of (policy binding, subject group)
(`resolveSubject`). Each binding carries the group, the level (`account` with the account UUID, or `environment` with
the environment ID), the policy text, the readable boundaries and the bind parameters. Bindings whose policy could not
be read are dropped. In draft mode there is one binding:

- group "Policy Creator draft", level `draft`;
- the draft policy text;
- the draft boundary when the checkbox is on;
- no parameters.

**2. Effective statements** (`effectiveStatements`). For each binding:

1. **Bind parameters.** Every `${bindParam:name}` in the policy and in the boundary texts is replaced with the bound
   value, with backslashes and double quotes escaped. A parameter without a value stays literal and produces the note
   "*policy*: no value bound for ${bindParam:name}, so the statements using it are treated as conditional."
2. **Parse the policy** (`parsePolicy`). `//` comments are ignored, statements are split at top-level `;`, and
   `WHERE` / `AND` are split outside quotes and parentheses.
   - Statements that cannot be read are dropped, with the note "*policy*: *n* statement(s) could not be read and was/were
     left out." These are statements with a missing permission, `WHERE` without a condition, `OR`, or an unquoted or
     unclosed value or list.
   - Text that does not start with ALLOW or DENY is ignored without a note.
   - Permissions not in the catalogue are kept.
3. **Parse each boundary** (`validateBoundary`). Each line holds one condition. Conditions with an error diagnostic are
   dropped, with the note "Boundary *name*: *n* condition(s) could not be read and were left out." Errors include:
   - a key that is not a condition of any permission in the reference;
   - an operator that no permission supports for that key;
   - an unsupported operator on a global condition;
   - a list / single-value mismatch;
   - the 11th condition (the limit is 10);
   - a line with `AND` or `OR`.
4. **Apply each boundary separately** (`applyBoundary`). With no boundary, there is one pass without conditions. With
   several boundaries, there is one pass per boundary and the results add up (OR).
   - **ALLOW statements** are split into one statement per permission. Boundary conditions apply when they are global
     (`global:*`) or when the permission supports that key according to the catalogue. Conditions with the same key
     multiply the statement (one copy per line). Conditions with different keys are all added (AND) to the statement's
     own conditions.
   - **DENY statements** are kept as they are (one effective statement per permission), without boundary conditions.
5. **Resolve global attributes** for the subject:
   - A value that is exactly `${global:userGroup}` becomes the subject's group UUIDs. For a group, that is the group
     itself. This does not happen in draft mode.
   - `${global:userId}` inside a value becomes the user's UUID, for users only.

Each effective statement keeps its source (binding, group, policy, level, boundary) and its rendered text.

**3. Evaluating one permission for one request** (`evaluatePermission`). The request carries the subject, the
environment ID and the attributes known for the request:

- `shared:app-id` for app checks;
- `storage:table-name` for the bucket check of a table.

Only statements whose permission is exactly the permission being checked are considered (no wildcards). Each
condition is decided as follows (`evalCondition`):

| Condition | Outcome |
| --- | --- |
| Any value still contains `${` (unbound parameter, unresolved global attribute) | unknown: *unresolved*, shown as "an unbound parameter" |
| `global:date`, `global:date-time`, `global:time-of-day`, `global:week-day` | unknown: *time*, "the date or time" |
| `global:environmentId` | decided against the current environment ID (empty in draft mode) |
| `global:userId` | decided for users; unknown *subject* ("who the user is") for groups and drafts |
| `global:usernameDomain` | decided against the part of the email after `@`; unknown *subject* when there is no email (groups, drafts) |
| `global:userGroup` | decided against the subject's group UUIDs. Positive operators need one group to match; `!=`, `NOT IN` and `NOT startsWith` need all of them to match. Unknown *subject* for drafts. |
| A key known for the request (`shared:app-id`, `storage:table-name`) | decided |
| Any other `global:*` key | unknown *subject* |
| Anything else (security context, bucket name, namespace, entity type, `app-engine:app-installer`, ...) | unknown *record*, "the records or resources requested" |

The operators are decided with these semantics:

- `=`, `!=`, `IN`, `NOT IN`, `startsWith` and `NOT startsWith` are exact and case-sensitive.
- `MATCH` treats `*` as a wildcard and is anchored and case-sensitive.
- `<` and `>` are plain string comparisons.

A statement whose decided condition is false does not apply. Otherwise the statement applies, and its unknown
conditions are listed as open.

Rules for the status:

1. A DENY on a Grail table permission (`storage:<table>:read` with a Grail table, other than `storage:buckets:read`)
   counts as a full DENY whatever its conditions say, even conditions that would be false. This covers logs, metrics,
   spans, events, bizevents, security.events, system, user.events, user.sessions, user.replays and
   application.snapshots.
2. Any other DENY that applies with no open conditions is a full DENY. A DENY with open conditions is a *partial DENY*.
3. The status is:
   - **denied** if a full DENY exists;
   - else **missing** if no ALLOW applies;
   - else **granted** if an ALLOW applies with no open conditions and there is no partial DENY;
   - else **scoped** (shown as *Limited*) if an ALLOW applies that is unconditional or has only *record* unknowns, and
     every partial DENY has only *record* unknowns;
   - else **conditional**.
4. ALLOW statements are sorted by their number of open conditions. A permission's **grant paths** are empty
   (unrestricted) when an unconditional ALLOW exists. Otherwise there is one path per ALLOW (its open conditions,
   joined by AND), and the paths are joined by OR.

**4. Data rows** (`dataAccess`). Each data permission is evaluated with no known attributes. For a table with buckets,
`storage:buckets:read` is evaluated as well, with `storage:table-name = <table>` known. The row status is the worse of
the two, in the order granted < scoped < conditional < missing < denied. The buckets row is evaluated with no known
table.

**5. Apps** (`evaluateApp`). For each installed app, with `shared:app-id = <app id>` known:

- **Run:** `app-engine:apps:run` is evaluated.
- **Levels:** for Read, Write and Execute, the level's permissions are the manifest's app permissions of that level
  plus the app-owned permissions of that level. Each is evaluated.
- **Data:** each data permission in the manifest takes the status of its data row. A permission without a row (for
  example `storage:fieldsets:read`) is evaluated directly, without a bucket check.
- **Required data:** the data permissions that are not optional. A permission is optional when its manifest comment
  contains "optional"; `storage:fieldsets:read` is always optional.
- **Status:** see [the app status table](#status-tables). Manifest permissions other than data do not change the status,
  because manifests request every scope an app may use. They are shown only as the R / W / E coverage.

How `summarizeApp` sorts manifest scopes:

| Kind | Rule |
| --- | --- |
| skipped | `app-engine:apps:run` (lets the app open other apps), and scopes not in the IAM reference |
| owned | `state:*`, `state-management:*` and `app-settings:*` permissions that support `shared:app-id` |
| data | `storage:*` permissions with a dimension condition; always level Read |
| app | everything else |

The level of an *app* permission comes from its action:

- **Read:** `read`, `list`, `lookup`, `download`, `load`, `resolve`.
- **Execute:** `execute`, `run`, `use`, `send`, `authenticate`, `invoke`, `validate`, `connect`, `set`.
- **Write:** all other actions.

### Status tables

**Permission / data status** (`PermStatus`):

| Status | Label (data) | Colour | In place when | Counted in |
| --- | --- | --- | --- | --- |
| `granted` | All records | solid green | an ALLOW applies with no open condition and there is no partial DENY | Grail tables bar: *All records*; usable |
| `scoped` | Limited | hatched green | an ALLOW applies with only record / resource conditions open (or an unconditional ALLOW plus a record-only partial DENY) | *Limited*; usable |
| `conditional` | Conditional | amber | ALLOWs apply, but they depend on time, the user, or an unbound parameter (or a partial DENY does) | *Conditional* |
| `missing` | No access | red | no ALLOW applies | *No access* |
| `denied` | Denied | red | a full DENY applies (any DENY on a Grail table permission) | *No access* |

**App status** (`AppStatus`):

| Status | Label | Rule | Reasons shown |
| --- | --- | --- | --- |
| `none` | No access | run is `missing` or `denied` | "no policy lets this subject open the app" / "app-engine:apps:run is denied for this app" |
| `conditional` | Conditional | run is usable or conditional, and at least one reason exists | "opening it depends on *what*" (run is conditional); "opens, but cannot read *tables*" (required data missing or denied); "reading *tables* is conditional" (required data conditional) |
| `access` | Access | run is `granted` or `scoped`, and all required data is `granted` or `scoped` | none; tables with *Limited* data are listed as `limited` but do not cause a warning |

**Level status** (R / W / E badges):

| Status | Rule | Badge |
| --- | --- | --- |
| `n/a` | the level has no permissions | hidden |
| `full` | every permission is granted or scoped | green |
| `none` | no permission is granted or scoped, and none is conditional | red, 70% opacity |
| `partial` | anything else | amber |

**Open-condition kinds** (`describeUnknown`). When several kinds are open, the texts are joined with " and ".

| Kind | Text | Effect |
| --- | --- | --- |
| record | the records or resources requested | the permission is *Limited* |
| time | the date or time | *Conditional* |
| subject | who the user is | *Conditional* |
| unresolved | an unbound parameter | *Conditional* |

**Warnings and notes shown in the summary card:**

| Text | Source |
| --- | --- |
| Environment *id* was not found in account *uuid*; only account-level bindings are shown. | function: environment bindings GET returned 404 |
| Policy *uuid* is bound but could not be read at any level. | function: every candidate level returned 404; the binding is dropped |
| Boundary *uuid* is used in a binding but could not be read. | function: boundary GET returned 404; the binding is evaluated without that boundary |
| *policy*: *n* statement(s) could not be read and was/were left out. | engine |
| Boundary *name*: *n* condition(s) could not be read and were left out. | engine |
| *policy*: no value bound for ${bindParam:…}, so the statements using it are treated as conditional. | engine |

### Worked example

This example was generated with the engine against the bundled catalogue. It uses one environment-level binding of the
policy "Team A data" to group `team-a-developers`, with the boundary "Team A only".

Policy:

```
ALLOW app-engine:apps:run WHERE shared:app-id IN ("dynatrace.notebooks");
ALLOW storage:logs:read, storage:spans:read, storage:smartscape:read, storage:events:read;
ALLOW storage:buckets:read WHERE storage:bucket-name MATCH ("default_*");
ALLOW document:documents:read;
```

Boundary:

```
storage:dt.security_context IN ("team-a", "team-b");
```

Effective statements. Copy effective statements produces exactly these lines:

```
ALLOW app-engine:apps:run WHERE shared:app-id IN ("dynatrace.notebooks");  // Team A data · team-a-developers · Team A only
ALLOW storage:logs:read WHERE storage:dt.security_context IN ("team-a", "team-b");  // Team A data · team-a-developers · Team A only
ALLOW storage:spans:read WHERE storage:dt.security_context IN ("team-a", "team-b");  // Team A data · team-a-developers · Team A only
ALLOW storage:smartscape:read WHERE storage:dt.security_context IN ("team-a", "team-b");  // Team A data · team-a-developers · Team A only
ALLOW storage:events:read WHERE storage:dt.security_context IN ("team-a", "team-b");  // Team A data · team-a-developers · Team A only
ALLOW storage:buckets:read WHERE storage:bucket-name MATCH ("default_*");  // Team A data · team-a-developers · Team A only
ALLOW document:documents:read;  // Team A data · team-a-developers · Team A only
```

The boundary narrows only the permissions that support `storage:dt.security_context`. `app-engine:apps:run`,
`storage:buckets:read` and `document:documents:read` keep their own conditions, but their source still names the
boundary, because they were produced in that boundary's pass.

The result:

- Logs, Spans, Events and Smartscape are *Limited*, by security context and (for the tables with buckets) by bucket.
- Metrics, Business events and the other tables are *No access*.
- Notebooks is *Access*. Its required logs are limited and its optional spans are limited. Its Read level is amber,
  because `document:documents:read` is granted but its app-state permission is not.
- An app with ID `my.custom.app` is *No access*.

Other outcomes, from the same engine:

- A DENY on `storage:events:read` with `WHERE storage:dt.security_context = "secret"` makes Events *Denied*.
- `ALLOW app-engine:apps:run WHERE global:time-of-day > "08:00+01:00" AND global:time-of-day < "18:00+01:00"` makes
  every app *Conditional*, with the reason "opening it depends on the date or time".
- Two boundaries "Namespace DEV" (`k8s.namespace.name = "dev"`) and "Namespace QA" (`= "qa"`) on one binding give
  Logs two OR'ed grant paths.

## Queries

The page runs no DQL by itself. It builds one query per readable table, which you open with the query actions.

| # | Name (function in source) | Runs when | Feeds which section |
| --- | --- | --- | --- |
| Q1 | Readable records of one table (`iamVisibleRecordsQuery`, [`queries.ts`](../ui/app/queries.ts#L1455)) | Never automatically. It is built for every *All records* / *Limited* row whose table has a record source, and runs only when you open it in a Notebook or Dashboard. | Dimensional data > By table > **Records query** |

### Q1 Readable records of one table (iamVisibleRecordsQuery)

- **Source:** `iamVisibleRecordsQuery(tf, table, groups)`, with `iamRecordTable`, `iamPathsDql`, `iamConditionDql`
  and `IAM_RECORD_SOURCES` in [`ui/app/queries.ts`](../ui/app/queries.ts#L1389). It is called from `DataTable` in
  [`IamAccessTab.tsx`](../ui/app/tabs/IamAccessTab.tsx#L929).
- **Runs:** it never runs in the tab. The text is rebuilt whenever the timeframe, the subject or the draft changes.
- **Parameters:**
  - `tf`: the shell timeframe. It sets `from:now()-24h|7d|30d`. For logs and spans it also sets `samplingRatio`
    (10000 for 24h, 100000 for 7d and 30d).
  - `table`: the table part of the permission. Each table has a source line:

    | Table | Source line |
    | --- | --- |
    | `logs` | `fetch logs, …, samplingRatio:…, scanLimitGBytes:5` |
    | `spans` | `fetch spans, …, samplingRatio:…, scanLimitGBytes:5` |
    | `events` | `fetch events, …, scanLimitGBytes:5` |
    | `bizevents` | `fetch bizevents, …, scanLimitGBytes:5` |
    | `security.events` | `fetch security.events, …, scanLimitGBytes:5` |
    | `system` | `fetch dt.system.events, …, scanLimitGBytes:5` |
    | `user.events` | `fetch user.events, …, scanLimitGBytes:5` |
    | `user.sessions` | `fetch user.sessions, …, scanLimitGBytes:5` |
    | `smartscape` | `smartscapeNodes "*", …` |

    Metrics, classic entities, session replays, application snapshots and profiles have no record source, so they
    get no query.
  - `groups`: first the table permission's grant paths, then the bucket check's grant paths (when the table has
    buckets). Each group becomes one `| filter`, so the groups are ANDed. Within a group, the paths are ORed, and the
    conditions within a path are ANDed. A group with an empty path, or a path whose conditions all map to nothing, adds
    no filter, because every record passes.
  - **Condition to DQL mapping.** The condition attribute is the part after the first `:`, and it becomes the record
    field. `bucket-name` becomes `dt.system.bucket`. `table-name` and `query-consumption` select tables, not records,
    so they are skipped. Every other attribute is used as the field name.

    | Operator | DQL |
    | --- | --- |
    | `=`, `IN`, `MATCH` | ``matchesValue(`field`, "v")``; several values are joined with `or` in parentheses |
    | `startsWith` | ``matchesValue(`field`, "v*")`` |
    | `!=`, `NOT IN` | `not` followed by the positive form |
    | `NOT startsWith` | ``not matchesValue(`field`, "v*")`` |
    | `<`, `>` | the condition is dropped |

  - **`by:`** uses the first 3 distinct fields used by any condition.
- **Query.** This is example 1: Logs, limited by security context through the boundary, with buckets limited to
  `default_*`, at 24 h. It is the generated text from the [worked example](#worked-example).

```dql
fetch logs, from:now()-24h, samplingRatio:10000, scanLimitGBytes:5
| filter (matchesValue(`dt.security_context`, "team-a") or matchesValue(`dt.security_context`, "team-b"))
| filter matchesValue(`dt.system.bucket`, "default_*")
| summarize records = count(), by:{`dt.security_context`, `dt.system.bucket`}
| sort records desc
| limit 100
```

For 7 days the first line becomes `fetch logs, from:now()-7d, samplingRatio:100000, scanLimitGBytes:5`. For 30 days it
becomes `fetch logs, from:now()-30d, samplingRatio:100000, scanLimitGBytes:5`. The same policy gives this text for
Events, which has no sampling:

```dql
fetch events, from:now()-24h, scanLimitGBytes:5
| filter (matchesValue(`dt.security_context`, "team-a") or matchesValue(`dt.security_context`, "team-b"))
| filter matchesValue(`dt.system.bucket`, "default_*")
| summarize records = count(), by:{`dt.security_context`, `dt.system.bucket`}
| sort records desc
| limit 100
```

Smartscape, which has no bucket group:

```dql
smartscapeNodes "*", from:now()-24h
| filter (matchesValue(`dt.security_context`, "team-a") or matchesValue(`dt.security_context`, "team-b"))
| summarize records = count(), by:{`dt.security_context`}
| sort records desc
| limit 100
```

Example 2: two ALLOW paths on Spans. The policy has `ALLOW storage:spans:read WHERE storage:k8s.namespace.name =
"shop-prod";` and `ALLOW storage:spans:read WHERE storage:k8s.namespace.name startsWith "shop-" AND
storage:k8s.cluster.name = "prod-cluster-01";`. Bucket access is `storage:table-name IN ("spans", "logs")`, which is
decided for the table, so no bucket filter is added:

```dql
fetch spans, from:now()-24h, samplingRatio:10000, scanLimitGBytes:5
| filter matchesValue(`k8s.namespace.name`, "shop-prod")
    or (matchesValue(`k8s.namespace.name`, "shop-*") and matchesValue(`k8s.cluster.name`, "prod-cluster-01"))
| summarize records = count(), by:{`k8s.namespace.name`, `k8s.cluster.name`}
| sort records desc
| limit 100
```

Example 3: a negative operator. The policy has `ALLOW storage:logs:read WHERE storage:dt.security_context NOT IN
("restricted");`:

```dql
fetch logs, from:now()-24h, samplingRatio:10000, scanLimitGBytes:5
| filter not matchesValue(`dt.security_context`, "restricted")
| summarize records = count(), by:{`dt.security_context`}
| sort records desc
| limit 100
```

Example 4: an unrestricted table. The policy has `ALLOW storage:logs:read;` and `ALLOW storage:buckets:read;`, so
there is no filter and no `by:`:

```dql
fetch logs, from:now()-24h, samplingRatio:10000, scanLimitGBytes:5
| summarize records = count()
| sort records desc
| limit 100
```

The values (`team-a`, `default_*`, namespaces, clusters) come from the subject's effective statements. The source line
depends on the table.

- **How it works:**
  1. The source line reads the table in the timeframe. Logs and spans are sampled, and every fetch is capped at 5 GB
     scanned (`SCAN_CAP_GB`). Smartscape reads every node type (`"*"`).
  2. The first `filter` holds the table permission's grant paths. `matchesValue` is used for every positive operator
     because it also matches any element of list-valued fields (for example `dt.security_context` on Smartscape
     nodes).
  3. The second `filter` holds the bucket grant paths. `dt.system.bucket` is the bucket a record is stored in.
  4. `summarize records = count(), by:{…}` counts the records per combination of the limiting fields.
  5. `sort records desc | limit 100` keeps the 100 largest combinations.
- **Output:** `records` and up to 3 dimension fields. The page does not read the result. You see it in the Notebook or
  on the Dashboard.
- **Limits and cost:**
  - At most 5 GB is scanned.
  - Logs and spans are sampled at 1:10000 (24h) or 1:100000 (7d, 30d), so their counts are sampled counts.
  - The result is limited to 100 rows.
  - The query runs with your own permissions, so it shows only records you can read too.
  - `matchesValue` is case-insensitive while IAM is case-sensitive, so the preview can be slightly wider than IAM.
  - Partial DENY statements are not subtracted.
- **Open it yourself:** yes. **Show DQL**, **Copy**, **Open in Notebook** (intent `dynatrace.notebooks` /
  `view-query`) and **Add to Dashboard** (intent `dynatrace.dashboards` / `add-to-dashboard`). The title is
  "Permissions Test: *Table* readable records".

## API calls

| # | Method | Endpoint or SDK method | Scope / auth | When |
| --- | --- | --- | --- | --- |
| B1 | GET | `/api/iam-reference` (`functions.call("iam-reference")`) | app function | once per page load (shared with the IAM builder tabs); on **Retry** |
| B2 | GET | `/platform/app-engine/registry/v1/apps?add-fields=manifest.scopes,isBuiltin` (`httpClient`) | `app-engine:apps:run` | once per page load (cached, shared with the IAM builders) |
| B3 | GET | app icon URL from the registry (`appIcon.href`) | `app-engine:apps:run` | per app card when it scrolls into view, 6 at a time, cached for the page load |
| B4 | GET | `/platform/iam/v1/organizational-levels/environment/{envId}/users?partialString=…&pageSize=50` (`usersAndGroupsClient.getActiveUsersForOrganizationalLevel`) | `iam:users:read` | **Search** in User mode |
| B5 | GET | `/platform/iam/v1/organizational-levels/environment/{envId}/groups?partialGroupName=…&pageSize=50` (`usersAndGroupsClient.getVisibleGroupsForAccount`) | `iam:groups:read` | **Search** in Group mode |
| B6 | GET | `/platform/classic/environment-api/v2/credentials?type=USERNAME_PASSWORD&name="architect-assistant-account-api"` (`credentialVaultClient.listCredentials`) | `environment-api:credentials:read` | **Save to the credential vault** |
| B7 | PUT | `/platform/classic/environment-api/v2/credentials/{id}` (`updateCredentials`) | `environment-api:credentials:write` | save, when the credential exists |
| B8 | POST | `/platform/classic/environment-api/v2/credentials` (`createCredentials`) | `environment-api:credentials:write` | save, when it does not exist |
| B9 | POST | `/api/iam-access` `{action: "status"}` | app function | tab mount; after a successful save |
| B10 | POST | `/api/iam-access` `{action: "search", kind, text}` | app function | search fallback when B4 / B5 throws |
| B11 | POST | `/api/iam-access` `{action: "resolve", environmentId, subject}` | app function | clicking a result, Test … directly, Test again, Retry |
| B12 | intent | `dynatrace.notebooks` `view-query`, `dynatrace.dashboards` `add-to-dashboard` | none | records query actions |
| B13 | link | intent link `dynatrace.settings` / `open_settings_for_schema` (`settings.schemaId: builtin:dt-javascript-runtime.allowed-outbound-connections`) | none | blocked-host messages |

Calls made inside the `iam-access` function ([`api/iam-access.function.ts`](../api/iam-access.function.ts)):

| # | Method | Endpoint | Auth | When |
| --- | --- | --- | --- | --- |
| F1 | GET | `/platform/classic/environment-api/v2/credentials?name="architect-assistant-account-api"&type=USERNAME_PASSWORD` | app scope `environment-api:credentials:read`, as the calling user | every action |
| F2 | GET | `/platform/classic/environment-api/v2/credentials/{id}/details` | same | every action |
| F3 | POST | `https://sso.dynatrace.com/sso/oauth2/token` | client ID and secret | every action, unless a cached token for the same client and account is still valid |
| F4 | GET | `https://api.dynatrace.com/iam/v1/accounts/{accountUuid}/users` | Bearer (`account-idm-read`) | search, user |
| F5 | GET | `https://api.dynatrace.com/iam/v1/accounts/{accountUuid}/groups` | Bearer (`account-idm-read`) | search, group; resolve, group without a name |
| F6 | GET | `https://api.dynatrace.com/iam/v1/accounts/{accountUuid}/users/{email}` | Bearer (`account-idm-read`) | resolve, user |
| F7 | GET | `https://api.dynatrace.com/iam/v1/repo/account/{accountUuid}/bindings` | Bearer (`iam:bindings:read`) | resolve |
| F8 | GET | `https://api.dynatrace.com/iam/v1/repo/environment/{envId}/bindings` | Bearer (`iam:bindings:read`) | resolve |
| F9 | GET | `https://api.dynatrace.com/iam/v1/repo/environment/{envId}/policies/aggregate`, falling back to `…/repo/account/{accountUuid}/policies/aggregate` | Bearer (`iam:policies:read`) | resolve |
| F10 | GET | `https://api.dynatrace.com/iam/v1/repo/{levelType}/{levelId}/policies/{policyUuid}` | Bearer (`iam:policies:read`) | resolve, once per bound policy |
| F11 | GET | `https://api.dynatrace.com/iam/v1/repo/account/{accountUuid}/boundaries/{boundaryUuid}` | Bearer (`iam:boundaries:read`) | resolve, once per boundary |

The scope in brackets after "Bearer" is the token scope that covers the endpoint. The legacy `iam-policies-management`
scope covers F7–F11. Every Account Management GET sends `Authorization: Bearer <token>` and `Accept: application/json`.
A non-2xx response raises an error, `GET <path> returned HTTP <status>: <first 300 characters>`.

### Sprint and dev environments

Sprint and dev environments (`*.sprint.apps.dynatracelabs.com`, `*.dev.apps.dynatracelabs.com`) belong to accounts on
separate stacks, each with its own SSO and Account Management API. Production SSO answers a sprint account's client
with `400 invalid_request`. The functions (`accountStack` in [`api/app-credentials.ts`](../api/app-credentials.ts))
therefore pick the stack from the environment URL, with the hosts dtctl uses:

| Stack | Token endpoint (tried in order) | Account Management API |
| --- | --- | --- |
| production | `sso.dynatrace.com` | `api.dynatrace.com` |
| sprint | `sso-sprint.dynatracelabs.com`, then `hard.token.dynatracelabs.com` | `api-hardening.internal.dynatracelabs.com` |
| dev | `sso-dev.dynatracelabs.com`, then `dev.token.dynatracelabs.com` | `api-dev.internal.dynatracelabs.com` |

The next token endpoint is tried only when one cannot be reached or answers 404. The URLs in the table above (F3–F11)
are the production ones; on sprint and dev the same paths go to that stack's hosts. The OAuth client must be created in
that stack's Account Management, and these hosts go into the allowed outbound connections when that allowlist is
enforced. Generating a platform token (Problem notifications) uses the same stack.

### Scopes per action and the 403 retry

- **Search and status** only read users and groups, so a client with just `account-idm-read` is enough for them (it
  is requested after the two IAM scope sets fail with `invalid_scope`).
- **Testing a user or group** needs the IAM read scopes (`iam:bindings:read`, `iam:policies:read`,
  `iam:boundaries:read`) or `iam-policies-management`.
- Some deployments (seen on a sprint stack) answer `403 User not authorized.` to a token with the granted
  fine-grained scopes. On a 403 the policy reads (bindings, policies, boundaries) are repeated once with a token for
  `account-idm-read iam-policies-management`. If that is refused too, the error adds that the scopes are not the
  problem: the OAuth client (or the user it acts for) lacks permission to read the account's policies and bindings.
- **Token errors** name the likely cause by OAuth error code: `invalid_scope` lists the scope sets the client lacks;
  `invalid_client` / `unauthorized_client` mean a wrong client ID or secret (or a deleted client);
  `invalid_request` / `invalid_target` / `invalid_resource` point at the account UUID (or a client from another
  stack).

### Details

**B1 `iam-reference`.** The function reads the IAM policy reference and the global conditions page from
docs.dynatrace.com (two GETs) and parses them.

- It returns `{status: "ok", checkedAt, catalog}`, or `blocked` / `error` with a message.
- If the result parses to fewer than 5 services, it reports an error, and the UI keeps the snapshot
  (`ui/app/iamSnapshot.json`).
- Fields used: `catalog.services[].permissions[]` (`id`, `conditions[]` with `key` and `operators`),
  `catalog.globals`, `catalog.updated`, `checkedAt`.

**B2 App Registry.** Fields used: `apps[].id`, `name`, `isBuiltin` (Dynatrace / Custom filter), `appIcon.href` (B3),
and `manifest.scopes[].name` / `.comment`. A comment containing "optional" marks a data permission optional. The list
is sorted by name. A failure is shown in the Apps card and is retried on the next load.

**B4 / B5 environment IAM search.** `levelId` comes from `getEnvironmentId()`. Fields used:

- users: `results[].uid`, `name`, `surname`, `email`, `description`, and `totalCount`;
- groups: `results[].uuid`, `groupName`, `type`, and `totalCount`.

**B6–B8 credential vault.** Example request body (placeholders only):

```json
{
  "name": "architect-assistant-account-api",
  "description": "Architect Assistant Permissions Test: OAuth client for the Account Management API (read-only). Account UUID: 01234567-89ab-cdef-0123-456789abcdef",
  "type": "USERNAME_PASSWORD",
  "user": "dt0s02.XXXX",
  "password": "dt0s02.XXXX.YYYY",
  "scopes": ["APP_ENGINE"],
  "ownerAccessOnly": true
}
```

B6 uses `credentials[].id` and `.name`, and looks for an exact name match. B8 uses the response `id`.

**B9–B11 `iam-access` function.** `functions.call` sends the JSON body with POST. A non-2xx HTTP response is turned
into an `error` failure: HTTP 404 means the function is not part of the running app, and other codes include the first
300 characters of the body. The function returns one of:

- `ok-status`: `{accountUuid, scopes, owner, ownerAccessOnly}`.
- `ok-search`: `{results: [{id, name, email?, detail?}], total}`.
- `ok`: `{checkedAt, accountUuid, subject: {kind, id, name, email?}, groups: [{uuid, name, owner?}], bindings: [{levelType, levelId, policyUuid, groups: [uuid], boundaries: [uuid], parameters}], policies: {uuid: {uuid, name, description, levelType, levelId, statementQuery}}, boundaries: {uuid: {uuid, name, boundaryQuery}}, warnings}`.
- A failure `{status: "no-credential" | "unauthorized" | "blocked" | "not-found" | "error", message}`.

Example resolve body:

```json
{ "action": "resolve", "environmentId": "abc12345", "subject": { "kind": "user", "email": "alex.kim@example.com" } }
```

The group form is `"subject": { "kind": "group", "uuid": "11111111-1111-1111-1111-111111111111", "name": "team-a-developers" }`.
The function also accepts an optional `accountUuid` that overrides the one in the credential, but the UI never sends
it. The environment ID must match `^[\w-]+$`, otherwise the function returns "Missing environment ID.".

**F1 / F2.** F1 finds the credential by exact name. F2 reads `username` (client ID), `password` (secret),
`description` (the first UUID in it is the account UUID, lowercased), `owner` and `ownerAccessOnly`.

**F3 token.** The request is form-encoded:

```
grant_type=client_credentials&client_id=dt0s02.XXXX&client_secret=dt0s02.XXXX.YYYY&scope=account-idm-read iam:bindings:read iam:policies:read iam:boundaries:read&resource=urn:dtaccount:01234567-89ab-cdef-0123-456789abcdef
```

- If the response is `error: invalid_scope`, the function retries with `scope=account-idm-read iam-policies-management`.
  Any other error stops, with the message "The OAuth token request was rejected (*status error description*). Check
  the client ID, secret, account UUID and the client's scopes." (status `unauthorized`).
- Fields used: `access_token`, `expires_in` (default 300 s), `scope`, `error`, `error_description`.
- The token is cached in the warm function instance until `expires_in − 30` seconds (at least 30 s), keyed by client
  ID and account.

**F4 / F5 / F6 subject.**

- F4 uses `items[].uid`, `email`, `name`, `surname` and `userStatus`.
- F5 uses `items[].uuid`, `name` and `owner`. For a direct group test it is used to find the group's name; the UUID is
  used when the group is not found.
- F6 (the email is URL-encoded) uses `uid`, `email`, `name`, `surname` and `groups[].uuid` / `groupName` / `owner`.
  These are the user's groups.

**F7 / F8 bindings.** Fields used: `policyBindings[].policyUuid`, `groups`, `boundaries`, `parameters`. Only groups
of the subject are kept, and one entry is created per group. A 404 on F8 adds the "Environment … was not found"
warning. Any other F7 or F8 error fails the run.

**F9 policy overview.** Fields used: `policyOverviewList[].uuid`, `levelType`, `levelId`. This tells where each bound
policy is defined: global (Dynatrace default policies), account or environment. If the environment aggregate fails
for any reason, the account aggregate is used.

**F10 policies.** For each bound policy, the level from F9 is used. A policy that is not in the overview is tried at
`global/global`, then the account, then the environment. A 404 moves to the next candidate, and any other error fails
the run. Fields used: `name`, `description`, `statementQuery`. At most 6 policies are read at a time.

**F11 boundaries.** Boundaries are always read on the account. Fields used: `name`, `boundaryQuery`. At most 6 are read
at a time. A 404 adds a warning.

## Remediation actions

The tab has no Remediation actions section and writes no IAM configuration (it creates no policies, boundaries or
bindings). Its only write is saving the account OAuth client, described under
[Account Management access](#account-management-access). To change what a subject can do, build the policy or boundary
in [IAM Policy Creator](iam-policy-creator.md) or [IAM Boundary Creator](iam-boundary-creator.md), check it here in
*Policy Creator draft* mode, then create it with **Create in Account Management** below that tab's editor (admins)
and bind it in Account Management.

## AI Assist on this page

`analyzeIamAccess` ([`analyses.ts`](../ui/app/analyses.ts#L852)) receives a summary built by `accessInsight` in the tab.
It is rule-based and runs locally in the browser: nothing is sent anywhere. In the input:

- "data" lists exclude the buckets row;
- "none" means *missing* only, and *denied* is a separate list;
- `allApps` is true when any ALLOW of `app-engine:apps:run` has no `shared:app-id` condition;
- `timeLimited` is the number of apps whose run status is conditional;
- `unboundParams` is the number of engine notes that mention `bindParam`;
- `iamScopesMissing` is true when the stored client works but its token has neither the three IAM read scopes nor
  `iam-policies-management`.

**No subject yet** (nothing tested, a test failed, or the draft is empty):

- Summary in draft mode: "Build a policy in the IAM Policy Creator tab to test it here."
- Summary otherwise: "Search for a user (name or email) or a group (name contains) and click a result to test it."

| Rule | Severity | Text |
| --- | --- | --- |
| not draft and setup is `missing` | info | "No OAuth client is stored yet. Users and groups can be found, but their policies are only readable through the Account Management API." |
| a failure message exists (test failure, else setup failure) | warning | the message |
| not draft and `iamScopesMissing` | warning | "The stored OAuth client only reads users and groups: testing a user or group also needs the IAM read scopes." |

Recommendations:

- **High** (not draft and `iamScopesMissing`): "Add iam:bindings:read, iam:policies:read and iam:boundaries:read (or
  iam-policies-management) to the OAuth client in Account Management; account-idm-read alone only covers the user and
  group search."
- **High** (not draft and setup not `ok`): "Create a read-only OAuth client (account-idm-read, iam:bindings:read,
  iam:policies:read, iam:boundaries:read) and save it in Account Management access; leave “Every user of this app” off
  unless every app user may see the account's IAM setup. On a sprint or dev environment, create it in that stack's
  Account Management."
- **Medium**, always: "Use Policy Creator draft to check a new policy (and boundary) before you bind it to a group."

**With a subject.** The summary reads: "*name* (or "The draft policy"): *a* of *n* apps with access, *c* conditional,
*x* without access; *k* Grail tables fully readable and *l* limited by dimensional data (*p* policies, *s* effective
statements)."

| Rule | Severity | Text |
| --- | --- | --- |
| no policy bound | critical | "No policy is bound [to any of the *n* groups this user is in] on the account or this environment: nothing is granted." |
| `allApps` | info | "An unconditional app-engine:apps:run lets the subject open every app, including apps installed later." |
| conditional apps > 0 | warning | "*n* apps with conditional access, e.g. …". It names the first 3, each with its first reason. |
| `timeLimited` > 0 | info | "*n* apps can only be opened under conditions that depend on the date or time, the user or an unbound parameter." |
| unrestricted tables | info | "Every record of *tables* is readable (no dimension limits)." |
| limited tables | good | "*tables* is/are limited by *dimension labels* (or "conditions")." |
| denied tables | warning | "Denied: *tables*. A DENY on a Grail table permission applies regardless of its conditions." |
| conditional tables | warning | "Reading *tables* depends on time, the user or an unbound parameter." |
| unbound parameters | warning | "*n* bindings use ${bindParam:…} without a bound value; those statements are shown as conditional." |

| Recommendation | Impact | When |
| --- | --- | --- |
| "Apps that show *first 3 missing tables* open without data: add the table permission (and storage:buckets:read) to a policy bound to the group, limited with a boundary if needed." | high | conditional apps and missing tables |
| "All data is readable without limits. If this group should only see its own data, bind the data policies with a boundary on security context or another dimension." | medium | unrestricted tables, no limited table, not draft |
| "If the group should only use some apps, replace the unconditional app-engine:apps:run with one shared:app-id statement per app (IAM Policy Creator, step 1)." | low | `allApps` |
| "Set the missing binding parameters when binding the policy (Account Management API; the UI does not set parameters)." | medium | unbound parameters |
| "Open a limited table's Records query in a Notebook to see the records behind the limits (it runs with your own permissions)." | low | always |

## Limitations and edge cases

**What is read and evaluated**

- Only bindings on the account and on **this** environment are read. Bindings on other environments do not apply here
  and are not shown.
- Classic environment roles (`environment:roles:*`) appear in effective statements but do not affect app access.
  Settings permissions are not resolved per schema object.
- Permissions are matched exactly. A permission that is missing from the catalogue (for example one added to the docs
  after the snapshot, while the live read fails) is still evaluated by name. However, boundaries do not narrow it, and
  an app manifest scope with that name counts as "not an IAM policy permission".
- If a boundary cannot be read (404), the binding is evaluated **without** it, so the result can be wider than reality.
  A warning says so.
- Policy text that does not start with ALLOW or DENY is ignored without a note.
- Only the 11th boundary condition gets the "at most 10 conditions" error and is dropped. The 12th and later
  conditions are kept.

**Conditions the engine cannot decide exactly**

- `MATCH`, `startsWith` and `=` are decided case-sensitively. `<` and `>` compare strings.
- Any condition that is not global and not known for the request counts as *record*. This includes
  `app-engine:app-installer` on `app-engine:apps:run`: an ALLOW limited by the installer counts as *Limited*, which
  makes the app *Access*.
- For a group or a draft, `${global:userId}` is left in the value and reported as "an unbound parameter" rather than
  "who the user is".
- **Draft mode** has an empty environment ID and no groups:
  - `global:environmentId = "<id>"` never matches, so such statements show as not granted (`!=` always matches);
  - `global:userGroup` is reported as "who the user is";
  - `${bindParam:…}` is always unbound.

**Data rows and the records query**

- A row is *Limited* when an unconditional ALLOW is combined with a record-only conditional DENY. In that case
  "Records limited to" reads "every record" and the row has no By dimension entry.
- A row can be *Limited* through one ALLOW while another ALLOW depends on time (for example `global:week-day`). The
  records query then writes that global condition as a field filter on a field that does not exist (for example
  ``matchesValue(`week-day`, "Monday")``) and adds it to `by:`. `<` / `>` conditions are dropped.
- The records query does not subtract DENY statements.
- With two boundaries that produce the same bucket statement, the bucket filter repeats the same `matchesValue` twice
  (the result is the same).
- "Can read: depends on …" describes the table permission's first grant, even when the conditional status comes from
  the bucket check.

**Requests and failure messages**

- Searching the account's lists (fallback) loads every user or group of the account in one GET, without paging.
- A direct group test by UUID reads the whole group list to find the name.
- Any 404 during resolve shows the title "*label* was not found in the account", including a 404 on the account
  bindings.
- An error reading the credential vault shows as "missing credential" in the setup card.

**Display**

- If the credential has no owner value, the Connected line starts its bracket with ", owner only".

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| Setup card: "Users and groups are found with this environment's IAM API, but …" | No credential named `architect-assistant-account-api`, or it is owner-only and owned by someone else | Save the OAuth client in the form, or ask the owner to turn off owner only |
| "The app function cannot reach *hosts*" | The outbound allowlist is enforced | Add the listed hosts (this stack's token and API hosts) in `builtin:dt-javascript-runtime.allowed-outbound-connections` (use the link) |
| "The OAuth token request was rejected by the sprint SSO … (400 invalid_request …)" | The client belongs to another account or stack, or the account UUID is wrong | Create the client in the sprint (or dev) Account Management and check the account UUID |
| "… Both the iam:*:read scopes and iam-policies-management were refused, so the scopes are not the problem …" | The client, or the user it acts for, may not read the account's IAM | Create the client as (or for) an account admin |
| Warning: "The stored OAuth client can search users and groups, but testing them also needs …" | The client has only `account-idm-read` | Add the IAM read scopes to the client |
| "The OAuth token request was rejected (401 invalid_client …)" | Wrong client ID or secret, or wrong account UUID | Check the values in Account Management > OAuth clients and save again |
| "The Account Management API refused the request" on GET …/bindings or …/policies | The client lacks `iam:bindings:read` / `iam:policies:read` / `iam:boundaries:read` (or `iam-policies-management`) | Add the scopes to the client |
| "*email* was not found in the account" | The email is not a user of the account (F6 returned 404) | Search instead of testing the email directly; check the spelling |
| Search works only "from the account's lists" | You are not assigned to the account, so the environment IAM API refuses the call | Nothing is required; the fallback uses the OAuth client |
| "Search failed: … · Account Management API: …" | The environment API failed and no OAuth client works | Set up the OAuth client |
| "the iam-access app function is not available in this running app (HTTP 404)" | The app was not rebuilt after the function was added | Restart `npx dt-app dev`, or deploy |
| "Missing environment ID." | `getEnvironmentId()` returned nothing (local run outside the platform) | Run the app in the environment |
| Warning "Environment … was not found in account …" | The stored account UUID belongs to another account | Store the correct account UUID |
| "Policy … is bound but could not be read at any level." | The policy is in a level the client cannot read, or it was deleted | Check the binding in Account Management |
| Banner "Using the bundled permission snapshot" | docs.dynatrace.com is blocked or the docs could not be parsed | Allow docs.dynatrace.com, then click Retry |
| Every app *No access* although the user works normally | No binding grants `app-engine:apps:run` on the account or this environment (bindings on other environments are not read), or the group's policies come from a mechanism the tab does not read | Check Where the access comes from and the bindings |
| Records query returns fewer records than expected | It runs with your permissions and sampling (logs, spans) | Treat it as a preview |

## Related pages

- [Index](README.md)
- [IAM Policy Creator](iam-policy-creator.md): builds the policy tested in draft mode, and shares the app catalogue and
  engine
- [IAM Boundary Creator](iam-boundary-creator.md): builds the boundary applied in draft mode, and shares `applyBoundary`
- [Security context](security-context.md): sets `dt.security_context`, the dimension most boundaries use

## Source files

| File | Role on this page |
| --- | --- |
| [`ui/app/tabs/IamAccessTab.tsx`](../ui/app/tabs/IamAccessTab.tsx) | The tab: subject card, setup card, summary, apps, dimensional data, sources, AI insight input |
| [`ui/app/iamAccess.ts`](../ui/app/iamAccess.ts) | Evaluation engine: effective statements, condition and permission evaluation, apps, data rows, dimension summary |
| [`ui/app/iamAccessApi.ts`](../ui/app/iamAccessApi.ts) | Search (environment IAM API plus fallback), resolve, setup status, credential save |
| [`api/iam-access.function.ts`](../api/iam-access.function.ts) | App function: credential vault, OAuth token, Account Management API calls |
| [`ui/app/iamPolicy.ts`](../ui/app/iamPolicy.ts) | `parsePolicy`, `validateBoundary`, `applyBoundary`, `renderPolicy`, `renderBoundary`, `renderCondition` |
| [`ui/app/iamApps.ts`](../ui/app/iamApps.ts) | `summarizeApp` (manifest analysis), `useAppCatalog`, app icons |
| [`ui/app/iamValues.ts`](../ui/app/iamValues.ts) | `loadInstalledApps` (App Registry call) |
| [`ui/app/iamCatalog.ts`](../ui/app/iamCatalog.ts) | IAM catalogue (live or snapshot), dimensions, `grailTableOf`, doc links |
| [`api/iam-reference.function.ts`](../api/iam-reference.function.ts) | Live read of the IAM policy reference |
| [`ui/app/iamSnapshot.json`](../ui/app/iamSnapshot.json) | Bundled catalogue snapshot (2026-10-24) |
| [`ui/app/iamDrafts.tsx`](../ui/app/iamDrafts.tsx) | Policy and boundary drafts for draft mode |
| [`ui/app/tabs/IamShared.tsx`](../ui/app/tabs/IamShared.tsx) | Catalogue banner, doc links, shared styles |
| [`ui/app/tabs/IamPolicyTab.tsx`](../ui/app/tabs/IamPolicyTab.tsx) | `AppIcon` |
| [`ui/app/queries.ts`](../ui/app/queries.ts) | `iamVisibleRecordsQuery`, `iamRecordTable` |
| [`ui/app/components.tsx`](../ui/app/components.tsx) | `QueryActions` |
| [`ui/app/analyses.ts`](../ui/app/analyses.ts) | `analyzeIamAccess` |
| [`app.config.json`](../app.config.json) | Scopes |
