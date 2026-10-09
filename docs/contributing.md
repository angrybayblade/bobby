# Contributing

## Setup

```sh
bun install       # installs dev deps and runs `prepare`, which sets core.hooksPath to .githooks
bun run check     # the build gate: tsc --noEmit for src/, node --check for every public/*.js
```

There's no bundler or dev server. Edit `public/` and reload the page; restart the CLI after editing `src/`.

## Commits

Read [COMMITS.md](../COMMITS.md). In short:

- **Micro**: one logical change per commit. Refactors, formatting and behaviour changes go separately.
- **Incremental**: every commit passes `bun run check`. Build bottom-up: types → logic → wiring → UI → docs. Land a new view as its own module first and register it last.
- **Semantic**: `<type>(<scope>): <imperative, lowercase subject>`, at most 72 characters, no trailing period.

The hooks enforce it. `pre-commit` runs the check against exactly what's staged and warns over 400 changed lines; `commit-msg` validates the subject line.

## Fast iteration on the UI

Re-running extraction is slow. Save a graph once and reopen it:

```sh
prfocus extract <pr> -o /tmp/pr.json
prfocus open /tmp/pr.json --repo <clone> --no-open
```

Then use the deep links: `http://127.0.0.1:4173/#view=diff&level=1&p=5`. `window.prfocus` in the console is the runtime.

**Keep tests away from your real settings and state.** The server reads and writes `~/.prfocus` from `os.homedir()`, which follows `$HOME`. Point it at a scratch directory with an absolute path:

```sh
HOME=/tmp/prfocus-home prfocus open /tmp/pr.json --repo <clone> --no-open
```

Headless Chrome with `puppeteer-core` works well for checking layout, measuring frame cost (CDP `Performance.getMetrics`) and taking screenshots.

## Common changes

| Change | Where | Remember |
|---|---|---|
| Extraction output | `src/analyze.ts`, `src/llm.ts`, `src/graph.ts` | Bump `VERSION` in `graph.ts` so cached graphs are rebuilt. |
| The graph format | `src/graph.ts`, `SPEC.md`, `schema/` | Additive and optional fields keep `v1`. Anything breaking needs a new schema version. |
| A new view | `public/app/views/<id>.js`, then `views/index.js` | Read only the graph and `app`. Register last. Add it to the README table and `docs/views.md`. |
| A new setting | `DEFAULT_SETTINGS` in `core.js`, `SETTINGS` in `chrome.js` | Views get `update("settings")` on change. Document it in `docs/settings.md`. |
| A new key | the `act` map in `main.js`, or a view's `keys` | Add it to the help modal in `chrome.js` and to `docs/reviewing.md`. |
| An API route | `src/server.ts` | Document it in `docs/server-and-state.md`. |
