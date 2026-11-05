# The hub: sharing review graphs

Status: **draft**, not built. Proposed after 0.1.0.

The hub is a hosted service where an author's agent uploads a review graph ([review-graph-v2.md](review-graph-v2.md)) and a reviewer's Bobby pulls it. The reviewer then reviews the PR the way its author laid it out, with nothing to set up beyond Bobby.

The hub stores graphs and checks who may read and write them. **It never stores, fetches or sees code**: a v2 graph has none, and the reviewer's Bobby gets the code from GitHub with the reviewer's own sign-in, as it does now.

## What it holds

One record per uploaded graph:

| Field | |
|---|---|
| `id` | The hub's id for this upload |
| `repo`, `pr`, `base`, `head` | From the graph |
| `graph` | The v2 document, as uploaded, validated against the schema |
| `uploadedBy` | The GitHub login of whoever uploaded it, from their sign-in |
| `uploadedAt` | When |
| `source` | `agent` (from Bobby's CLI or MCP tools) or `ci` (from a CI job) |

A graph is a few hundred kilobytes at most; the hub refuses one over 1 MB. For each PR it keeps the newest graph for each `head`, and older uploads for 30 days.

Graphs still say a lot about private code: titles, decisions, file paths, the repository's name. The hub treats them as private to the repository's readers.

## Who can do what

Access follows GitHub. The hub never decides it on its own.

| | Who |
|---|---|
| Read a repository's graphs | Anyone who can read the repository on GitHub |
| Upload a graph for a PR | The PR's author, or anyone who can push to the repository |
| Delete one | Whoever uploaded it, or a repository admin |

The hub checks this against GitHub on every request, cached for a minute, so losing access to a repository loses access to its graphs.

## Signing in

The hub is a **GitHub App**. An organization installs it on the repositories it wants to share graphs for, with read access to metadata and pull requests only. The hub uses the installation to check that a PR, its commits and a user's permission are what a request says.

People sign in with GitHub through the App, so the hub learns who they are and nothing more. Bobby signs in with GitHub's device flow, as it does for `gh`, and keeps the hub's token in `~/.bobby`. **Bobby never sends the hub your `gh` token.**

```sh
bobby hub login          # device flow: shows a code, opens github.com/login/device
bobby hub logout
```

A CI job uploads with its own identity instead: GitHub Actions' OIDC token, which names the repository and workflow. The hub accepts it for that repository's PRs, and records the upload as `ci`.

## The API

JSON over HTTPS. Every request carries `Authorization: Bearer <hub token or OIDC token>`. Versioned under `/v1`.

### Upload

```http
POST /v1/graphs
Content-Type: application/json

{ …a bobby.review-graph/v2 document… }
```

The hub checks the request, in this order:

1. The document matches the v2 schema.
2. The App is installed on `repo`, and the uploader may upload to it.
3. `pr` exists, and `head` is a commit on it, now or earlier.

It doesn't check the graph against the code, since it never reads code. The uploader's Bobby already did (`bobby graph push` won't upload a graph with errors), and the reviewer's Bobby checks it again on opening it.

Returns `201` with `{ id, url }`, where `url` is the PR's page on the hub. Errors are `400` (schema, with the failures), `403` (no access, or the App isn't installed: the message says which), `404` (no such PR or commit) and `413` (too large).

### Read

```http
GET /v1/repos/{owner}/{repo}/pulls/{number}/graphs        → the graphs for a PR: id, head, uploadedBy, uploadedAt, newest first
GET /v1/repos/{owner}/{repo}/pulls/{number}/graph         → the newest graph for the PR, whichever head it's for
GET /v1/graphs/{id}                                       → one graph
```

Each answer is the v2 document plus the hub's fields. `403` means you can't read the repository, and `404` that there's no graph. The hub answers `404` rather than `403` for a repository the App isn't installed on, so it doesn't say which private repositories use it.

### Delete

```http
DELETE /v1/graphs/{id}
```

## Links

A PR's page on the hub is `https://<hub>/{owner}/{repo}/pull/{number}`. It shows only what's needed to open the review: the PR, who uploaded its graph and when, and how to open it. It's not a review UI, and has no code to show.

- `bobby <hub link>` opens the review in the reviewer's Bobby, with the author's graph.
- Opening a PR in Bobby any other way also asks the hub for a graph, when you're signed in to it. If there is one, Bobby opens it and offers the switch to Bobby's own (see [How a reviewer sees it](review-graph-v2.md#how-a-reviewer-sees-it)).
- Later, the App could post a check on the PR, "Review graph ready", linking to the page, so reviewers on GitHub see there's one.

## Self-hosting

The protocol is open, and the hub's address is a setting (`hubUrl`, default the hosted one). An organization that won't share even code-free graphs can run its own, as its own GitHub App.

## What it adds to Bobby

- `bobby hub login` / `logout`, and the hub's sign-in on the home page.
- `bobby graph check`, `graph push` and `graph schema`, and the same as MCP tools (`check_graph`, `push_graph`, `graph_schema`).
- Asking the hub for a graph when opening a PR, and `bobby <hub link>`.
- The Author's / Bobby's switch, and the follow-up for new commits ([review-graph-v2.md](review-graph-v2.md)).
- [What leaves your machine](../docs/privacy.md) gains a row: graphs you upload go to the hub, and opening a PR asks it whether there's one.

## Open questions

1. **Hosting.** Who runs the hosted hub, and on what terms (free, paid, per organization)? This decides retention, limits and support.
2. **Without the App.** Some organizations won't install a third-party App. Should the hub also accept a user's own GitHub sign-in with `repo` scope to check access? That works without an install, but asks for much more.
3. **Comments.** Should a reviewer's comments about the graph itself ("this core is misleading") go back to its author through the hub, or only as normal PR comments?
