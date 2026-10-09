# Server and state

`src/server.ts` is a single `Bun.serve` on `127.0.0.1` (port 4173 by default). It serves `public/` as static files (from the copy embedded in a compiled binary, if there is one) and a small JSON API. If the port is taken, the CLI falls back to a free one. It holds one **session** in memory:

```ts
interface Session {
  cwd: string | null;        // local clone; null for `prfocus open` without --repo
  staticGraph: ReviewGraph;
  claudeGraph?: ReviewGraph; // set when Claude's tree is ready
  state: ReviewState;        // this PR's review progress
  llm: "pending" | "done" | "failed" | "off";
  llmError?: string;
}
```

The CLI fills `claudeGraph` and `llm` from the background Claude job while the server runs.

## API

| Method & path | Body → response | Purpose |
|---|---|---|
| `GET /api/graph` | → `ReviewGraph` | Claude's graph if ready, else the static one. `?tree=static` forces static. |
| `GET /api/session` | → `{ state, settings, llm, llmError, caps: { files } }` | Everything the UI needs at boot. `caps.files` is true when there's a local clone. |
| `GET /api/status` | → `{ llm, llmError, claudeReady }` | Polled every 4s while Claude is pending. |
| `POST /api/settings` | patch → merged settings | Merges into `~/.prfocus/settings.json`. |
| `GET /api/file?path=&side=base\|head` | → `{ lines }` | A whole file at the merge-base or head, for "more context". Returns 404 without a clone. |
| `POST /api/mark` | `{ keys, mark }` | Sets `reviewed` or `flagged` (or clears, with `null`) for content keys. |
| `POST /api/position` | `{ nodeId, level? }` | Remembers where you are and your zoom level (debounced by the UI). |
| `POST /api/note` | `{ note }` | The parked thought. |
| `POST /api/comment` | `{ path, line, side, body, inDiff }` → comment with `id` | Adds a draft. |
| `DELETE /api/comment/:id` | | Removes a draft. |
| `POST /api/notes` | `{ body, path?, line?, side? }` → note with `id`, `createdAt` | Adds a private note: on a line, a file (no `line`) or the PR (no `path`). |
| `DELETE /api/notes/:id` | | Removes a private note. |
| `POST /api/submit` | `{ event, body }` → `{ ok, url }` or `{ ok: false, error }` | Posts the review to GitHub. |

Every state-changing call writes the state file straight away.

### Submitting a review

`/api/submit` builds one GitHub review on the PR's head commit:

- `event` is `COMMENT`, `APPROVE` or `REQUEST_CHANGES`.
- Drafts with `inDiff: true` become inline comments (`path`, `line`, `side`).
- Drafts on untouched code (`inDiff: false`) can't be inline on GitHub, so they're appended to the body under **"Notes on code this PR doesn't touch"**.
- Private notes and review marks are never read here, so they never reach GitHub.
- It's posted with `gh api --method POST repos/<o>/<r>/pulls/<n>/reviews --input -`. Drafts are cleared only on success; on failure the error is returned and shown in the submit dialog.

## On-disk state (`src/state.ts`)

Everything is JSON under `~/.prfocus/` (from `os.homedir()`):

```
~/.prfocus/
  settings.json                                  UI preferences (free-form; views may add keys)
  state/<owner>_<repo>_<n>.json                  ReviewState for one PR
  cache/<owner>_<repo>_<n>_<sha12>.graphs.json   built graphs for one head commit
  cache/<owner>_<repo>_<n>_<sha12>.json          Claude's raw change tree for one head commit
  repos/<owner>/<repo>/                          auto-clones
```

### ReviewState

```ts
interface ReviewState {
  headSha: string;                                // refreshed on load
  marks: Record<string, "reviewed" | "flagged">;  // content key → mark
  comments: Comment[];                            // drafts until submitted
  notes?: PrivateNote[];                          // private notes; never submitted
  lastNodeId?: string;                            // graph node id, for resuming
  lastLevel?: number;                             // zoom level, for resuming
  lastSeenAt?: string;
  note?: string;                                  // parked thought
}
```

**Mark keys are content, not ids**, so progress survives force-pushes and tree regeneration:

| Page | Keys |
|---|---|
| Changed code | the `hash` of each of its hunks; the page counts as reviewed when all are |
| Untouched code | `ref:<path>:<line>` |
| Low-signal page | the hashes of all low-signal hunks |

Position is stored as a **node id** (`chg:…` or `ctx:…`), which is stable across tree regenerations for the same diff. On boot the UI resumes on the first non-repeat placement of that node.

## Security notes

- The server binds to `127.0.0.1` only and has no authentication. Anything running locally can call it, including `/api/submit`, which posts as your `gh` user.
- Static file paths are normalised, and anything escaping `public/` is a 404.
- `/api/file` passes `path` to `git show <sha>:<path>`, so it can read any file in the repo at those two commits. That's fine for a local tool, but it's not meant to be exposed.
