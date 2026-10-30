# Contributing

## Setup

```sh
bun install       # installs dev deps and runs `prepare`, which sets core.hooksPath to .githooks
bun run check     # the build gate: tsc --noEmit for src/, node --check for every public/*.js
```

There's no bundler or dev server. Edit `public/` and reload the page; restart the CLI after editing `src/`.

## Releasing

For **0.1.0**, first remove the release-candidate compatibility guards (`git grep -n 'TODO(0.1.0)'`). Then bump `version` in `package.json`, move `CHANGELOG.md`'s **Unreleased** entries under the new version, commit, then tag and push the tag:

```sh
git tag 0.2.0 && git push origin 0.2.0      # 0.2.0-rc0 makes a pre-release
```

**The tag is the version, exactly, with no leading `v`.** The release's files are named after the tag, and every `bobby update` already installed looks for them by the bare version, so a `v0.2.0` tag publishes a release they can't find (0.1.0-rc14 did). The `pre-push` hook refuses a version tag that doesn't match `package.json` at the commit it tags, and so does the release workflow.

`.github/workflows/release.yml` takes it from there: it fails unless the tag is exactly `package.json`'s version, runs `bun run check` (typecheck and tests), builds every target on one Linux runner, smoke-tests the Linux binary, packages each as `bobby-<tag>-<os>-<arch>.tar.gz` (`.zip` for Windows) with a `SHA256SUMS`, and publishes a GitHub release with generated notes. If it fails after creating the release, delete the release and the tag and push the tag again.

- **Package:** bump `version` in `package.json`, then `npm publish` (it runs `bun run check` first). `files` ships `src/`, `public/`, `schema/`, `SPEC.md` and the README; the bin is `src/cli.ts`, so users need bun.
- **Binaries:** `bun run build --all` writes `dist/bobby-<os>-<arch>` for macOS, Linux and Windows. `scripts/build.ts` generates an entry that embeds every file under `public/` (`src/assets.ts › embed`) before loading the CLI, then runs `bun build --compile`. Cross-compiling downloads each target's Bun runtime the first time.

## Commits

Read [COMMITS.md](../COMMITS.md). In short:

- **Micro**: one logical change per commit. Refactors, formatting and behaviour changes go separately.
- **Incremental**: every commit passes `bun run check`. Build bottom-up: types → logic → wiring → UI → docs. Land a new view as its own module first and register it last.
- **Semantic**: `<type>(<scope>): <imperative, lowercase subject>`, at most 72 characters, no trailing period.

The hooks enforce it. `pre-commit` runs the check against exactly what's staged and warns over 400 changed lines; `commit-msg` validates the subject line.

## Fast iteration on the UI

Re-running extraction is slow. Save a graph once and reopen it:

```sh
bobby extract <pr> -o /tmp/pr.json
bobby open /tmp/pr.json --repo <clone> --no-open
```

Then use the deep links: `http://127.0.0.1:4173/#view=diff&level=1&p=5`. `window.bobby` in the console is the runtime.

**Keep tests away from your real settings and state.** The server reads and writes `~/.bobby` from `os.homedir()`, which follows `$HOME`. Point it at a scratch directory with an absolute path:

```sh
HOME=/tmp/bobby-home bobby open /tmp/pr.json --repo <clone> --no-open
```

Headless Chrome with `puppeteer-core` works well for checking layout, measuring frame cost (CDP `Performance.getMetrics`) and taking screenshots.

## Common changes

| Change | Where | Remember |
|---|---|---|
| Extraction output | `src/analyze.ts`, `src/llm.ts`, `src/graph.ts` | Bump `VERSION` in `graph.ts` so cached graphs are rebuilt. |
| The graph format | `src/graph.ts`, `SPEC.md`, `schema/` | Additive and optional fields keep `v1`. Anything breaking needs a new schema version. |
| A new view | `public/app/views/<id>.js`, then `views/index.js` | Read only the graph and `app`. Register last. Add it to `docs/views.md`. |
| A new setting | `DEFAULT_SETTINGS` in `core.js`, `SETTINGS` in `chrome.js` | Views get `update("settings")` on change. Document it in `docs/settings.md`. |
| A new key | the `act` map in `main.js`, or a view's `keys` | Add it to the help modal in `chrome.js` and to `docs/reviewing.md`. |
| An API route | `src/server.ts` | Document it in `docs/server-and-state.md`. |
