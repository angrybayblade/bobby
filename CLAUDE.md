# Bobby

Focus-first PR reviewer. Extraction (`src/`) produces a `bobby.review-graph/v1` document (`SPEC.md`); views (`public/app/views/`) only read that document.

## Commits

Follow `COMMITS.md`: **micro** (one logical change), **incremental** (every commit passes `bun run check`), **semantic** (`<type>(<scope>): <imperative subject>`). Commit as you go, not in one batch at the end. The hooks in `.githooks/` enforce the format and the build.

## Releases

A release tag is exactly `package.json`'s version, with no leading `v` (`git tag 0.2.0`, never `v0.2.0`): installed `bobby update`s find releases by the bare version. The `pre-push` hook and the release workflow refuse anything else. Steps: `docs/contributing.md` › Releasing.
