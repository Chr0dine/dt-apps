# IAM Assistant

A Dynatrace AppEngine app for users and permissions, split out of Architect Assistant's "Users and permissions" area.

| Tab | What it does | Docs |
|---|---|---|
| **Overview** (default) | SAML vs local (and SCIM) groups in the account and the users under each, as donuts, bars and a group list. | [overview.md](docs/overview.md) |
| **IAM Policy Creator** | Build an IAM policy from apps, dimensional data and permissions, with live validation against the IAM policy reference. | [iam-policy-creator.md](docs/iam-policy-creator.md) |
| **IAM Boundary Creator** | Build a policy boundary and preview its effect on a policy. | [iam-boundary-creator.md](docs/iam-boundary-creator.md) |
| **Permissions Test** | Pick a user or group (or the draft policy) and see which apps they can open and which Grail data they can read. | [permissions-test.md](docs/permissions-test.md) |

Every tab has an **AI Assist** panel (header button) that explains what is on screen.

## Setup

The Overview and Permissions Test read the account through the Account Management API, so an admin of the app stores
an account OAuth client once under **Account Management access** (on either tab). Scopes: `account-idm-read`,
`iam:bindings:read`, `iam:policies:read`, `iam:boundaries:read`. The secret lives in the app settings (schema
`app-credentials`) and is only readable by the app's functions. Allow `sso.dynatrace.com` and `api.dynatrace.com` (and
`docs.dynatrace.com` for the live IAM policy reference) in the JavaScript runtime's allowed outbound connections if
that allowlist is enforced.

## Development

```powershell
npm install          # plain install; see CLAUDE.md
npx dt-app dev
npm run lint
npm run build        # under the cross-worktree build lock
npm run deploy       # bump app.version in app.config.json first
npm run sync-iam     # refresh the bundled IAM permission snapshot (ui/app/iamSnapshot.json)
```
