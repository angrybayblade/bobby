# Bobby

Focus-first PR reviewer. Extraction (`src/`) produces a `bobby.review-graph/v1` document (`SPEC.md`); views (`public/app/views/`) only read that document.

## Commits

Follow `COMMITS.md`: **micro** (one logical change), **incremental** (every commit passes `bun run check`), **semantic** (`<type>(<scope>): <imperative subject>`). Commit as you go, not in one batch at the end. The hooks in `.githooks/` enforce the format and the build.
