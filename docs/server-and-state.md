# Server and state

`src/server.ts` is a single `Bun.serve` on `127.0.0.1` (port 4173 by default; `--host` changes the address). It serves `public/` as static files (from the copy embedded in a compiled binary, if there is one) and a small JSON API. If the port is taken, the CLI falls back to a free one.

It's one **app** holding every review you open, each a **session** in memory at `/r/<id>`, with its API under `/r/<id>/api/`. The id is `owner/repo/<n>` for a PR, `owner/repo/<n>@<sha>` (or `@<from>..<to>`) for commits of one, and `local/<repo>/<branch>` for a branch. `src/review.ts` builds them: `resolve()` names the review cheaply (it asks GitHub or git what it is), so its page can open at once, and `build()` does the slow part in the background; meanwhile its API answers `202 { loading, title }`. The running app leaves a lock in `~/.bobby/state/app.lock`, and a second `bobby` hands its review to it (`POST /api/open`) instead of starting another. A review no page has asked about for 15 minutes is unloaded: its language servers and watchers stop, and it's built again, from the cache, when opened.

App-wide routes: `GET /` is the home page (`public/home.html`); `GET /api/home` gives recents (from `~/.bobby/recents.json`, with which are open), settings, who you are and any newer release; `GET /api/home/prs?repo=&author=&q=` the open PRs waiting on your review, yours and all that involve you (`gh` search, cached a minute); `POST /api/open { arg?, repo?, cwd?, base? }` opens a review and answers its id; `GET /api/avatar` serves GitHub avatars. When `gh` isn't set up, a failed `/api/open` answers `setup: "gh"` and keeps the PR waiting (`waiting` in `/api/home`), opened once it is. Setting up `gh` (`src/github.ts`) and Claude Code (`src/claude.ts`): `GET /api/gh` and `/api/claude` say where each stands (`installed`, `loggedIn`, `step`, and `ask`: whether to offer it); `POST …/install`, `…/login` (gh: a one-time code to enter on github.com; Claude: a link, then `POST /api/claude/code { code }`), `…/cancel` and `…/dismiss { never? }`.

A session:

```ts
interface Session {
  cwd: string | null;        // local clone; null for `bobby open` without --repo
  staticGraph: ReviewGraph;
  claudeGraph?: ReviewGraph; // set when Claude's tree is ready
  state: ReviewState;        // this PR's review progress
  llm: "pending" | "done" | "failed" | "off";
  llmError?: string;
}
```

The CLI fills `claudeGraph` and `llm` from the background Claude job while the server runs.

## A review's API

Paths are under `/r/<id>`.

| Method & path | Body → response | Purpose |
|---|---|---|
| `GET /api/graph` | → `ReviewGraph` | Claude's graph if ready, else the static one. `?tree=static` forces static. |
| `GET /api/session` | → `{ state, settings, llm, llmError, servers, caps: { files, inspect } }` | Everything the UI needs at boot. `servers`: a language server per language in the review, `{ id, title, state, error?, hint?, command?, offer? }`, `state` one of `consent`, `missing`, `installing`, `pending`, `done`, `failed`, `off`. `caps.files` and `caps.inspect` are true when there's a local clone. |
| `GET /api/conversation` | → `Conversation` (`src/conversation.ts`) | The PR's description, timeline, review threads, verdicts, requested reviewers and CI checks, from one GitHub GraphQL query; read at most every 15 s, `?fresh` to read now. 404 for a local review. |
| `POST /api/conversation/comment` | `{ body }` → `{ ok, url }` | Posts a comment on the PR. |
| `POST /api/conversation/reply` | `{ body, to }` → `{ ok, url }` | Replies in the review thread whose first comment is `to`, and re-reads the inline discussion. |
| `POST /api/posted/edit`, `/api/posted/delete` | `{ kind, id, body? }` → `{ ok, comments, outdated }` | Edits (or deletes) a comment already on GitHub: `kind` `review` for one on a line, `issue` for one on the PR. A review comment's change re-reads the inline discussion. |
| `POST /api/thread` | `{ thread, resolved }` → `{ ok, comments, outdated }` | Resolves (or unresolves) the review thread with that GraphQL node id, then re-reads the inline discussion and returns it. |
| `GET /api/status` | → `{ llm, llmError, claudeReady, servers }` | Polled every 3 s while Claude works or a server installs or loads. |
| `POST /api/servers/install`, `/check`, `/decline` | `{ id, never? }` → `{ servers }` | A language server: yes, install it (in the background); look again for what you installed yourself (gopls); not now, or never (saved). |
| `GET /api/definitions` | → `{ [path]: Definition[] }` | The graph's, with each finished language server's answers for its files. |
| `GET /api/references?path=&line=&col=` | → `{ name, refs: [{ path, line, col, text }], total, via, pending?, changed?, server? }` | Every use of the name at a head-side position, the declaration left out, up to 500, each with its line. The file's language server once it's loaded; without one, files git grep finds the name in, keeping the uses that resolve through imports to the same declaration. |
| `GET /api/inspect?path=&line=&col=` | → `{ name?, to?, ext?, hover?, via, pending?, changed?, server? }` | The inspector: where the name at a head-side position is declared. The file's language server once it's loaded (with `hover`, its type); until then, or without one, the graph's `definitions` and the syntax tree at head. |
| `POST /api/settings` | patch → merged settings | Merges into `~/.bobby/settings.json`. |
| `GET /api/file?path=&side=base\|head` | → `{ lines }` | A whole file at the merge-base or head, for "more context". Returns 404 without a clone. |
| `POST /api/mark` | `{ keys, mark }` | Sets `reviewed` or `flagged` (or clears, with `null`) for content keys. |
| `POST /api/position` | `{ nodeId, level? }` | Remembers where you are and your zoom level (debounced by the UI). |
| `POST /api/note` | `{ note }` | The parked thought. |
| `POST /api/comment` | `{ path, line, side, body, inDiff }` → comment with `id` | Adds a draft. |
| `DELETE /api/comment/:id` | | Removes a draft. |
| `POST /api/notes` | `{ body, path?, line?, side? }` → note with `id`, `createdAt` | Adds a private note: on a line, a file (no `line`) or the PR (no `path`). |
| `DELETE /api/notes/:id` | | Removes a private note. |
| `POST /api/submit` | `{ event, body }` → `{ ok, url }` or `{ ok: false, error }` | Posts the review to GitHub. |
| `POST /api/progress` | `{ done, total }` | How far you've got, for recents on the home page. |

Every state-changing call writes the state file straight away.

### Submitting a review

`/api/submit` builds one GitHub review on the PR's head commit:

- `event` is `COMMENT`, `APPROVE` or `REQUEST_CHANGES`.
- Drafts with `inDiff: true` become inline comments (`path`, `line`, `side`).
- Drafts on untouched code (`inDiff: false`) can't be inline on GitHub, so they're appended to the body under **"Notes on code this PR doesn't touch"**.
- Private notes and review marks are never read here, so they never reach GitHub.
- It's posted with `gh api --method POST repos/<o>/<r>/pulls/<n>/reviews --input -`. Drafts are cleared only on success; on failure the error is returned and shown in the submit dialog.

## On-disk state (`src/state.ts`)

Everything is JSON under `~/.bobby/` (from `os.homedir()`):

```
~/.bobby/
  settings.json                                  UI preferences (free-form; views may add keys)
  state/<owner>_<repo>_<n>.json                  ReviewState for one PR
  cache/<owner>_<repo>_<n>_<sha12>.graphs.json   built graphs for one head commit
  cache/<owner>_<repo>_<n>_<sha12>.tree.<v>.json Claude's raw change tree for one head commit and extraction version
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

- The server binds to `127.0.0.1` unless `--host` says otherwise, and has no authentication. Anything that can reach it can call it, including `/api/submit`, which posts as your `gh` user. `guard()` refuses a Host that isn't loopback or allowed (`hostAllowed`, against DNS rebinding) and a write whose Origin isn't the page at that Host.
- Static file paths are normalised, and anything escaping `public/` is a 404.
- `/api/file` passes `path` to `git show <sha>:<path>`, so it can read any file in the repo at those two commits. That's fine for a local tool, but it's not meant to be exposed.
