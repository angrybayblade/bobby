# Getting started

## Requirements

| Tool | Why |
|---|---|
| [`bun`](https://bun.sh) | Runs the CLI and the local server. |
| `git` | Fetches the PR and computes the diff locally. |
| [`gh`](https://cli.github.com), logged in | Reads PR metadata and review comments, clones repos, posts your review. |
| `claude` (Claude Code CLI), optional | Builds the smarter change tree. It uses your Claude Code login, so no API key is needed. Without it, or with `--no-llm`, you get the static tree. |

## Install

```sh
git clone <this repo> && cd <this repo>
bun install          # also turns on the commit hooks (see contributing.md)
```

`package.json` declares a `prfocus` bin, so `bun link` makes `prfocus` available everywhere. The examples below use `prfocus`; `bun run src/cli.ts` works the same.

## Review a PR

```sh
prfocus https://github.com/owner/repo/pull/123
# or, inside a clone of the repo:
prfocus 123
```

What happens:

1. The PR's metadata is read with `gh pr view`.
2. A local clone is found: `--repo` if you passed it, otherwise the current directory if one of its remotes points at the PR's repo, otherwise `~/.prfocus/repos/<owner>/<repo>`, cloned the first time.
3. The PR's head and base are fetched and the diff is built. If the PR's head commit hasn't changed since you last opened it, this step is skipped and the cached graph is reused.
4. The UI opens at `http://127.0.0.1:4173` with the **static tree**, which is usable straight away.
5. If `claude` is available, it organises the PR in the background. When it's done, a **"Smarter tree ready · R"** pill appears. Press `R` to switch; you stay on the same code.

Stop the server with `ctrl+c`. Your progress is saved as you go.

## Commands

```sh
prfocus <pr-url | number>               # extract + open the review UI
prfocus extract <pr> [-o file.json]     # write the review graph and exit (stdout without -o)
prfocus open <graph.json> [--repo dir]  # open the UI on an existing graph file
```

`extract` waits for Claude's tree (unless `--no-llm`) and writes it, falling back to the static tree if Claude fails. `open` views any `prfocus.review-graph/v1` file, whoever produced it. With `--repo`, it can also load more context around hunks.

## Flags

| Flag | Default | |
|---|---|---|
| `--repo <dir>` | cwd, else auto-clone | Local clone to use. |
| `--port <n>` | `4173` | UI port. |
| `--no-llm` | off | Static analysis only; skip Claude. |
| `--refresh` | off | Rebuild everything for this commit, ignoring the cached graphs and Claude tree. |
| `--no-open` | off | Don't open the browser. |
| `-o, --out <file>` | stdout | Output file for `extract`. |

Environment: `PRFOCUS_MODEL` picks the Claude model passed to `claude --model`.

## What it writes to disk

Everything lives under `~/.prfocus/`:

| Path | Contents |
|---|---|
| `repos/<owner>/<repo>/` | Auto-clones, made only when no local clone was found. |
| `cache/<owner>_<repo>_<n>_<sha12>.graphs.json` | Built graphs (static and Claude) for one head commit. |
| `cache/<owner>_<repo>_<n>_<sha12>.json` | Claude's raw change tree for one head commit. |
| `state/<owner>_<repo>_<n>.json` | Your review progress, draft comments, position and parked thought. |
| `settings.json` | UI preferences, shared by every PR. |

Deleting `cache/` is always safe. Deleting a `state/` file forgets your progress on that PR.

The fetch also writes refs under `refs/prfocus/<n>/` in the clone. They're harmless; remove them with `git for-each-ref --format='%(refname)' refs/prfocus | xargs -n1 git update-ref -d`.

Next: [Reviewing a PR](reviewing.md).
