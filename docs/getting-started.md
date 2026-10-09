# Getting started

## Requirements

| Tool | Why |
|---|---|
| [`bun`](https://bun.sh) | Runs the CLI and the local server. |
| `git` | Fetches the PR and computes the diff locally. |
| [`gh`](https://cli.github.com), logged in | Reads PR metadata and review comments, clones repos, posts your review. |
| `claude` (Claude Code CLI), optional | Builds the smarter change tree. It uses your Claude Code login, so no API key is needed. Without it, or with `--no-llm`, you get the static tree. |

## Install

Pick one:

```sh
# 1. As a package (needs bun on your PATH)
bun add -g focus-bobby                 # once published; or npm i -g focus-bobby
bun add -g github:angrybayblade/focus-bobby

# 2. As a standalone binary (no bun needed to run it): download one from GitHub Releases
#    bobby-<version>-<os>-<arch>.tar.gz (.zip on Windows), unpack, put `bobby` on your PATH
tar -xzf bobby-v0.1.0-darwin-arm64.tar.gz && mv bobby /usr/local/bin/
#    or build it yourself
git clone https://github.com/angrybayblade/focus-bobby && cd focus-bobby
bun install && bun run build           # → dist/bobby for this machine

# 3. From a clone, for development
bun install && bun link                # `bobby` now runs this checkout
```

Either way you still need `git` and `gh` on your PATH, and `claude` for the smarter tree. `bobby -v` prints the version. The examples below use `bobby`; `bun run src/cli.ts` works the same from a clone.

Release binaries aren't code-signed. On macOS, if Gatekeeper blocks a downloaded one, run `xattr -d com.apple.quarantine "$(which bobby)"`. Each release has a `SHA256SUMS` file to check downloads against.

The binary is about 60 MB because it carries the Bun runtime. The UI's files are embedded in it, so it runs with nothing beside it.

## Review a PR

```sh
bobby https://github.com/owner/repo/pull/123
# or, inside a clone of the repo:
bobby 123
```

What happens:

1. The PR's metadata is read with `gh pr view`.
2. A local clone is found: `--repo` if you passed it, otherwise the current directory if one of its remotes points at the PR's repo, otherwise `~/.bobby/repos/<owner>/<repo>`, cloned the first time.
3. The PR's head and base are fetched and the diff is built. If the PR's head commit hasn't changed since you last opened it, this step is skipped and the cached graph is reused.
4. The UI opens at `http://127.0.0.1:4173` with the **static tree**, which is usable straight away.
5. If `claude` is available, it organises the PR in the background. When it's done, a **"Smarter tree ready · R"** pill appears. Press `R` to switch; you stay on the same code.

Stop the server with `ctrl+c`. Your progress is saved as you go.

## Review your own branch, no PR needed

Run `bobby` with no PR inside a repo to review the branch you're on, before you open a PR or while you work:

```sh
cd my-repo
bobby                    # this branch vs its base, uncommitted changes included
bobby --base release/2.1 # compare with a specific branch or commit
```

The diff runs from the merge-base with the base branch to your **working tree**: commits on the branch plus staged and unstaged changes to tracked files. Untracked files are left out (the CLI says how many); `git add -N <file>` includes one without staging its content. Nothing in your working tree, index or stash list is touched.

**Base branch.** The first of these that exists wins:

1. `--base <ref>`;
2. the base of this branch's open PR, if `gh` finds one;
3. origin's default branch (`origin/HEAD`);
4. `main`, `master`, `develop` or `trunk`, as `origin/<name>` and then as a local branch.

If none is found, bobby asks for one on the terminal, or exits asking for `--base` when there's no terminal. The CLI prints which base it used and why.

A local review works like a PR review, with two differences: there are no existing review comments, and there's nowhere to post, so drafts and notes stay on your machine. Progress is kept per branch.

## Commands

```sh
bobby                                 # inside a repo: review this branch (see above)
bobby <pr-url | number>               # extract + open the review UI
bobby extract [pr] [-o file.json]     # write the review graph and exit (stdout without -o); no pr = this branch
bobby open <graph.json> [--repo dir]  # open the UI on an existing graph file
```

`extract` waits for Claude's tree (unless `--no-llm`) and writes it, falling back to the static tree if Claude fails. `open` views any `bobby.review-graph/v1` file, whoever produced it. With `--repo`, it can also load more context around hunks.

## Flags

| Flag | Default | |
|---|---|---|
| `--base <ref>` | detected | No PR: the branch or commit to compare with. |
| `--repo <dir>` | cwd, else auto-clone | Local clone to use. With no PR, the repo to review. |
| `--port <n>` | `4173` | UI port. |
| `--no-llm` | off | Static analysis only; skip Claude. |
| `--refresh` | off | Rebuild everything for this commit, ignoring the cached graphs and Claude tree. |
| `--no-open` | off | Don't open the browser. |
| `-o, --out <file>` | stdout | Output file for `extract`. |

Environment: `BOBBY_MODEL` picks the Claude model passed to `claude --model` (the old `PRFOCUS_MODEL` still works).

## What it writes to disk

Everything lives under `~/.bobby/`. If you used the tool when it was called prfocus, `~/.prfocus` is moved there on the first run, progress and clones included:

| Path | Contents |
|---|---|
| `repos/<owner>/<repo>/` | Auto-clones, made only when no local clone was found. |
| `cache/<owner>_<repo>_<n>_<sha12>.graphs.json` | Built graphs (static and Claude) for one head commit. |
| `cache/<owner>_<repo>_<n>_<sha12>.json` | Claude's raw change tree for one head commit. |
| `state/<owner>_<repo>_<n>.json` | Your review progress, draft comments, position and parked thought. |
| `state/<owner>_<repo>_branch_<branch>.json`, `cache/…_branch_<branch>_<sha12>_<base7>.*` | The same for a local review. `<owner>_<repo>` comes from a GitHub `origin`, else `local_<folder>`. |
| `settings.json` | UI preferences, shared by every PR. |

Deleting `cache/` is always safe. Deleting a `state/` file forgets your progress on that PR.

The fetch also writes refs under `refs/bobby/<n>/` in the clone. They're harmless; remove them with `git for-each-ref --format='%(refname)' refs/bobby | xargs -n1 git update-ref -d`.

Next: [Reviewing a PR](reviewing.md).
