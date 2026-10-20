# AGENTS.md

Guidance for AI coding agents working on Dynatrace AppEngine apps in this repo.

- The reference app is `templates/golden-app/`. New apps are scaffolded from it (see `.claude/skills/dt-app-scaffold`).
- Use the `dt-app-mcp` MCP tools (`get_sdk`, `list_strato_components`, `get_strato_component`, `get_dql_knowledgebase`, `get_experience_standard`) before writing SDK, Strato or DQL code instead of guessing APIs.
- Prefer Strato components over custom UI; follow the Dynatrace experience standard.
- Any new platform API needs a matching scope in `app.scopes` in `app.config.json`.
- Install with `npm install --legacy-peer-deps`; run commands from the app directory, not the repo root.
- Bump `app.version` in `app.config.json` before every deploy.
- Don't edit generated `.dt-app/` contents.

> Replace or extend this file with the official AGENTS.md shipped by the dt-app toolkit if you have it.
