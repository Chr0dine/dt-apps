# AGENTS.md

Guidance for AI coding agents working on Dynatrace AppEngine apps in this repo.

- The reference app is `templates/golden-app/`. New apps are scaffolded from it (see `.claude/skills/dt-app-scaffold`).
- Use dtctl to write and validate any DQL queries written with live data
- Add the AI assist from the golden app template to all pages
- Only use buildin Dynatrace strato components as a last resort
- Utilize Dynatrace mcp dt-app skills
- Run a test on any visual change to screenshot and ensure that there are no UI issues
- Write in depth documentation to be put on github, that is linked on all pages within the applications
- After any deploy, ask if I want it to be pushed to git
- Any new platform API needs a matching scope in `app.scopes` in `app.config.json`.
- Install with `npm install --legacy-peer-deps`; run commands from the app directory, not the repo root.
- Bump `app.version` in `app.config.json` before every deploy.
- Don't edit generated `.dt-app/` contents.

> Replace or extend this file with the official AGENTS.md shipped by the dt-app toolkit if you have it.
