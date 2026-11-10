# Overview

The **Overview** tab is the first tab of IAM Assistant. It shows how the account's groups are managed and how many
users sit under each kind of group:

- **SAML groups** are federated: the identity provider's attributes assign users to them at each sign-in.
- **Local groups** are managed by hand in Account Management.
- **SCIM groups** (if any) are provisioned by a SCIM client.
- **All users** is the built-in group every account user belongs to implicitly.

## What the tab shows

| Section | Content |
|---|---|
| Summary tiles | Number of SAML, local (and SCIM) groups, each with the distinct users in them; total account users and how many are in no group. |
| Groups: SAML vs local | Donut of groups by type. Click a slice to filter the group list; click it again to clear. |
| Users by group type | Donut of every account user, once, by the types of groups they are in: SAML groups only, local groups only, both SAML and local, SCIM, or no group. The built-in all-users group is ignored. |
| Users under each group type | Bars of memberships per type (a user in two SAML groups counts twice), with the distinct users and the number of groups. |
| Groups | Every group with its type, member count (with a bar) and description. Filter by name or description. The built-in all-users group is listed last, without a bar. |
| AI Assist | Summary, insights (local share, users in both SAML and local groups, users in no group, empty groups, largest groups) and recommendations. |

There is no DQL behind this tab: groups and their members are not stored in Grail, so there is no *Show DQL* /
*Open in Notebook* action.

## Where the data comes from

The browser cannot call the Account Management API, so the `iam-access` app function does it (action `overview`) with
the account OAuth client stored in the app settings:

1. `GET https://api.dynatrace.com/iam/v1/accounts/{accountUuid}/groups`: every group with its `owner` (`LOCAL`, `SAML`,
   `SCIM`, `ALL_USERS`).
2. `GET https://api.dynatrace.com/iam/v1/accounts/{accountUuid}/users`: every account user.
3. `GET https://api.dynatrace.com/iam/v1/accounts/{accountUuid}/groups/{groupUuid}/users` per group (six at a time),
   skipped for the all-users group.

The function returns group names, owners, descriptions and member counts, and for each user only an internal ID, the
user status and their group IDs. No email addresses or names reach the browser.

SAML memberships are written at sign-in, so they reflect each user's last sign-in. A SAML group without members may
only mean that nobody with the matching attribute has signed in yet.

## Setup

Same as the Permissions Test: an admin of this app (permission `app-settings:objects:write` for the app) stores an
account OAuth client with `account-idm-read` (plus `iam:bindings:read`, `iam:policies:read`, `iam:boundaries:read` for
the Permissions Test) under **Account Management access**. The card shows on this tab while nothing is stored, and
under *Account Management access* at the bottom once it is. Unless the admin ticks *Every user of this app may see the
Overview and run the Permissions Test*, only the app's admins see the overview.

If `builtin:dt-javascript-runtime.allowed-outbound-connections` is enforced, allow `sso.dynatrace.com` and
`api.dynatrace.com`.

## Messages

| Message | Cause |
|---|---|
| Account Management access card with "Not set up yet." | No OAuth client stored. |
| Only the app's admins can see the account overview | The OAuth client is stored but limited to admins. |
| Reading the account's groups failed | The token request or an API call failed; the message has the HTTP status. |
| Some data could not be read | Members of one or more groups could not be read; those groups show "not readable" and are left out of the user counts. |

## Sprint and dev environments

On `*.sprint.apps.dynatracelabs.com` and `*.dev.apps.dynatracelabs.com` the account lives on a separate stack, so the
function calls that stack's SSO and Account Management API instead of `sso.dynatrace.com` / `api.dynatrace.com`:

| Stack | Token endpoint (tried in order) | Account Management API |
|---|---|---|
| Sprint | `sso-sprint.dynatracelabs.com`, `hard.token.dynatracelabs.com` | `api-hardening.internal.dynatracelabs.com` |
| Dev | `sso-dev.dynatracelabs.com`, `dev.token.dynatracelabs.com` | `api-dev.internal.dynatracelabs.com` |

Create the OAuth client in that stack's Account Management, and allow those hosts if the outbound allowlist is
enforced. Sending a sprint client to production SSO is answered with `400 invalid_request`.

## AI Assist on this page

`analyzeIamOverview` ([`analyses.ts`](../ui/app/analyses.ts)) runs locally on the model built by `buildOverview`
([`iamOverview.ts`](../ui/app/iamOverview.ts)); nothing is sent anywhere.

**Without data**, the summary says why, and the recommendation follows the failure:

| State | Recommendation |
| --- | --- |
| No OAuth client stored | Create a client with `account-idm-read` (enough for this page; the `iam:*:read` scopes are for the Permissions Test) and save it under Account Management access; on sprint or dev, in that stack's Account Management. |
| Token or API call refused | Read the message under Account Management access (client ID or secret, account UUID, scopes); a client from another stack is refused too. |
| Host blocked | Add the hosts listed under Account Management access to the outbound allowlist, then Refresh. |
| Limited to admins | Ask an admin to allow the Overview for every user, or to grant `app-settings:objects:write`. |
| Other failure | Refresh; the message names the failing call and its HTTP status. |

**With data**, the summary counts configured groups (SAML, local, SCIM; the built-in all-users group is mentioned
separately) and the users in SAML and in local groups. Insights:

| Rule | Severity |
| --- | --- |
| Only SAML groups (no local group) | good |
| SAML and local groups: the local share of configured groups | warning above 50 %, else info |
| No SAML or SCIM group | warning |
| Users in both SAML and local groups | info |
| Users only in local groups | warning when SAML groups exist, else info |
| Users in no group | info |
| Groups without members (with the SAML sign-in caveat when one is a SAML group) | info |
| The three largest groups | info |
| Groups whose members could not be read | warning |

Recommendations: move local groups that mirror identity-provider teams to SAML (medium, when both exist); set up SAML
or SCIM (high, when neither exists); review users in both kinds of group (medium); remove empty local groups (low); use
the Permissions Test (low, always).
