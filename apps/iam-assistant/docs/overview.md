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
