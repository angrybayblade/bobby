# Getting started

## Requirements

| Tool | Why |
|---|---|
| `git` | Fetches the PR and computes the diff locally. |
| [`gh`](https://cli.github.com), logged in | Reads PR metadata and review comments, clones repos, posts your review. |
| `claude` (Claude Code CLI), optional | Builds the smarter change tree. It uses your Claude Code login, so no API key is needed. Without it, or with `--no-llm`, you get the static tree. |
| `node` 18+, optional | Runs the TypeScript and Python language servers behind the inspector. Bobby installs them itself, after asking; without Node it runs them on Bun, where a large project takes minutes rather than seconds to load. |
| `gopls`, optional | The Go language server: `go install golang.org/x/tools/gopls@latest`. Bobby finds it on PATH or in `$(go env GOPATH)/bin`. |
| [`bun`](https://bun.sh), only from source | The release binary carries its own runtime. Building it, installing Bobby as a package, or running a clone needs Bun 1.1+. |

## Install

Pick one:

```sh
# 1. The install script (macOS, Linux): the latest release binary into ~/.local/bin
curl -fsSL https://raw.githubusercontent.com/angrybayblade/bobby/main/install.sh | bash
#    a specific version, or somewhere else:
curl -fsSL https://raw.githubusercontent.com/angrybayblade/bobby/main/install.sh | BOBBY_VERSION=0.1.0-rc6 BOBBY_INSTALL_DIR=~/bin bash

# 2. A release binary by hand (Windows: the .zip): https://github.com/angrybayblade/bobby/releases
tar -xzf bobby-0.1.0-rc6-darwin-arm64.tar.gz && mv bobby ~/.local/bin/
#    or build it yourself
git clone https://github.com/angrybayblade/bobby && cd bobby
bun install && bun run build           # → dist/bobby for this machine

# 3. As a package (needs bun on your PATH)
bun add -g github:angrybayblade/bobby  # or, once published: bun add -g focus-bobby

# 4. From a clone, for development
bun install && bun link                # `bobby` now runs this checkout
```

Either way you still need `git` and `gh` on your PATH, and `claude` for the smarter tree. `bobby -v` prints the version. The examples below use `bobby`; `bun run src/cli.ts` works the same from a clone.

The install script picks the build for your OS and CPU, checks it against the release's `SHA256SUMS`, and tells you if the install folder isn't on your `PATH` or if `git` or `gh` is missing. With no `BOBBY_VERSION`, it takes the latest release, or the newest pre-release while there's no stable one.

Binaries are built for macOS, Linux and Windows. Windows gets the least use, so expect rough edges there. Bobby isn't on npm yet: install it from a release or from GitHub.

**Staying up to date.** Bobby checks GitHub for a newer release when it starts and every 6 hours while it runs. When there is one, it says so in the terminal and in the top bar, with the command to update: the install script for a release binary, `git pull` for a clone. On a release candidate it also tells you about newer release candidates. Turn it off in Settings, or with `BOBBY_NO_UPDATE_CHECK=1`.

Release binaries aren't code-signed. On macOS, if Gatekeeper blocks a downloaded one, run `xattr -d com.apple.quarantine "$(which bobby)"`. Each release has a `SHA256SUMS` file to check downloads against.

The binary is 62–86 MB, depending on the platform (27–41 MB to download), because it carries the Bun runtime and the tree-sitter grammars. The UI's files are embedded in it, so it runs with nothing beside it.

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
bobby lsp                             # the language servers behind the inspector, by language
bobby lsp install <language>          # install one (typescript, python), or say how (go)
```

`extract` waits for Claude's tree (unless `--no-llm`) and writes it, falling back to the static tree if Claude fails. With `--lsp`, it also waits for the installed language servers' definitions. `open` views any `bobby.review-graph/v1` file, whoever produced it. With `--repo`, it can also load more context around hunks, and start the language server.

## Flags

| Flag | Default | |
|---|---|---|
| `--base <ref>` | detected | No PR: the branch or commit to compare with. |
| `--repo <dir>` | cwd, else auto-clone | Local clone to use. With no PR, the repo to review. |
| `--port <n>` | `4173` | UI port. |
| `--no-llm` | off | Static analysis only; skip Claude. |
| `--no-lsp` | off | Don't start language servers. The inspector then finds what imports can. |
| `--lsp` | off | `extract` only: ask the installed language servers too, and write their definitions. Nothing is installed. |
| `--refresh` | off | Rebuild everything for this commit, ignoring the cached graphs, Claude tree and language-server answers. |
| `--no-open` | off | Don't open the browser. |
| `-o, --out <file>` | stdout | Output file for `extract`. |

Environment: `BOBBY_MODEL` picks the Claude model passed to `claude --model` (the old `PRFOCUS_MODEL` still works). `BOBBY_NO_UPDATE_CHECK=1` turns off the check for new versions.

## What it writes to disk

Everything lives under `~/.bobby/`. If you used Bobby when it was called prfocus, `~/.prfocus` is moved there on the first run, progress and clones included:

| Path | Contents |
|---|---|
| `repos/<owner>/<repo>/` | Auto-clones, made only when no local clone was found. |
| `cache/<owner>_<repo>_<n>_<sha12>_<base>.graphs.json` | Built graphs (static and Claude) for one head commit and base branch. |
| `cache/<owner>_<repo>_<n>_<sha12>.tree.<version>.json` | Claude's raw change tree for one head commit and extraction version. |
| `state/<owner>_<repo>_<n>.json` | Your review progress, draft comments, position and parked thought. |
| `state/<owner>_<repo>_branch_<branch>.json`, `cache/…_branch_<branch>_<sha12>_<base7>.*` | The same for a local review. `<owner>_<repo>` comes from a GitHub `origin`, else `local_<folder>`. |
| `cache/…_<sha12>.defs.<server>.<version>.json` | A language server's definitions for one head commit. |
| `servers/typescript-<versions>/`, `servers/pyright-<version>/` | The TypeScript and Python language servers, installed when you agree (about 24 MB and 35 MB from npm). |
| `trees/<owner>_<repo>/<sha12>/` | A PR's head commit as plain files (the languages Bobby has servers for), for the language servers. The three most recent per repo are kept. |
| `settings.json` | UI preferences, shared by every PR. |

Deleting `cache/`, `servers/` or `trees/` is always safe. Deleting a `state/` file forgets your progress on that PR.

Bobby tidies up once a day on its own: cached files for commits not opened in a month, avatars a month old, other versions of the language servers it installed, and what a stopped Bobby left half done. `bobby clean` removes `cache/` and `trees/` at once, and `bobby clean --repos` the clones in `repos/` too; neither touches `state/` or `settings.json`.

The fetch also writes refs under `refs/bobby/<n>/` in the clone. They're harmless; remove them with `git for-each-ref --format='%(refname)' refs/bobby | xargs -n1 git update-ref -d`.

Next: [Reviewing a PR](reviewing.md).
