# What leaves your machine

Bobby runs on your machine: the review UI is served by Bobby itself on `127.0.0.1` (unless you [open it up](getting-started.md#on-a-remote-machine) with `--host`), and your marks, drafts and notes stay in `~/.bobby`. These are the times it talks to something else, and how to turn each off.

| What | Where it goes | When | To turn it off |
|---|---|---|---|
| **The PR, for Claude's review** | Anthropic, through your `claude` CLI and its login | Only when you press **Review with Claude**: the diff, the PR's title and description, and the files Claude chooses to read from a copy of the head commit (Read, Grep and Glob only, inside that copy) | Don't press it |
| **The PR, to organise it** | Anthropic, through your `claude` CLI and its login | When `claude` is installed, in the background on each new head commit | `--no-llm`, or no `claude` |
| **PR metadata, comments, the code** | GitHub, through `gh` and `git` | Reading the PR, fetching and cloning, posting your review when you submit; the Conversation view reads the PR's comments, reviews and CI checks while it's open, and posts a comment or reply when you send one; resolving or unresolving a thread, and editing or deleting your own comment, reach GitHub at once | Review a local branch (`bobby` with no PR) |
| **Avatars** | `avatars.githubusercontent.com` / `github.com`, from Bobby's server | Showing who wrote a comment; cached a week in `~/.bobby/cache/avatars` | |
| **Images in comments** | GitHub's image proxy (`camo.githubusercontent.com`) and GitHub's attachment hosts, from your browser | Showing images and badges in the Conversation view's comments, as github.com does | |
| **Fonts** | Google Fonts, from your browser | Loading the UI | |
| **Language servers** | The npm registry | Only after you say yes to installing one (or run `bobby lsp install`) | Say **Not now** or **Never** |
| **The install script**, **`bobby update`** | GitHub releases | Installing or updating Bobby | |
| **Setting up GitHub CLI** | GitHub (`api.github.com` for `gh`'s latest release, then its download, and GitHub's sign-in) | Only when you press **Install GitHub CLI** or **Get a sign-in code** in Bobby's [setup](getting-started.md#setting-up-github) | **Not now** or **Don't ask again** |
| **Setting up Claude Code** | `claude.ai` (Anthropic's installer, then its sign-in) | Only when you press **Install Claude Code** or **Sign in** in Bobby's [setup](getting-started.md#setting-up-claude) | **Not now** or **Don't ask again** |
| **New versions** | GitHub's releases API (no login, nothing about you or your code) | At start and every 6 hours, at most once in 6 hours across runs | Settings › Tell me about new versions, or `BOBBY_NO_UPDATE_CHECK=1` |

## What Claude is sent

With `claude` available and no `--no-llm`, Bobby asks Claude to group the PR's changes into core changes and order them. The prompt holds:

- the PR's title and the first 3,000 characters of its description;
- each changed unit: its file and symbols, and its hunks' lines (up to 120 per hunk, and about 160,000 characters in all);
- how the units depend on each other;
- unchanged lines that declare or use what the changes touch: each one's file, line and up to 160 characters of its text.

It runs `claude -p` with no tools and no saved session, from a temporary directory, so Claude reads only what's in the prompt. It uses your Claude Code login and its data terms. The answer is cached in `~/.bobby/cache`, so the same head commit isn't sent twice.

## What stays local

- **Language servers** read the PR's head commit exported to `~/.bobby/trees`, and never run the PR's code. Go's runs with module and toolchain downloads off (`GOPROXY=off`, `GOTOOLCHAIN=local`) and without cgo.
- **Bobby's server** only answers its own page: requests must name `127.0.0.1` or `localhost` (or a name you allowed with `--allow-host`), and writes must come from the page at that same name.
- **Private notes** are never posted. Drafts are posted only when you submit.
