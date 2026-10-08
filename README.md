# prfocus

Review a GitHub PR one focused page at a time.

prfocus turns a PR into a forest of **core changes**. Around each core change it places the code it relies on and the code it affects:

```
untouched code it relies on → changed code it relies on → CORE CHANGE → changed code it affects → untouched code it affects
```

You can zoom out to see the whole tree, or walk it page by page in that order.

## Run

```sh
bun install
bun run src/cli.ts https://github.com/owner/repo/pull/123
# or, inside a clone:  bun run src/cli.ts 123
```

Requirements: `gh` (logged in), `git`, `bun`, and the `claude` CLI for the smart tree. No API key is needed because it uses your Claude Code login.

| Flag | |
|---|---|
| `--repo <dir>` | Local clone to use. Default: the current directory, otherwise an auto-clone into `~/.prfocus/repos`. |
| `--no-llm` | Static-analysis tree only. |
| `--refresh` | Rebuild everything for this commit, ignoring the cached graphs and Claude tree. |
| `--port <n>` | UI port (default 4173). |

## Commands

```sh
prfocus <pr>                       # extract + review
prfocus extract <pr> -o pr.json    # write the review graph and exit
prfocus open pr.json [--repo dir]  # review any graph file (--repo enables "more context")
```

The graph format is a versioned standard: see [SPEC.md](SPEC.md) and [the JSON schema](schema/review-graph.v1.schema.json). Any tool that emits it can use these views, and new views only need to read it.

## Views

Switch with `v` or the header toggle. Focus, progress and comments are shared, so switching never loses your place.

| View | Shape | Good for |
|---|---|---|
| **Flow** | Left→right node-link canvas: relies on ← core → affects. Nodes are sized by relevance to your focus, long bands fold into "+N", edges are labelled, and the camera glides between zoom levels. | Seeing the shape of the change |
| **Outline** | A document-like rail (walk order, indentation shows depth) beside a reading pane: the PR story, the core's story, or the code. | Big PRs, reading-first |
| **Lens** | The focus sits dead centre with its direct neighbours left and right; everything else is hidden. | Maximum focus |
| **Diff** | One scrollable diff viewer per file, in columns by band. Only the sections you're reading get edges, and related files scroll to meet them. Pinch to zoom and two-finger drag to pan (trackpad or touchscreen); over a viewer, two-finger scroll on a trackpad scrolls its code. Drag a viewer by its header; double-click it (or ⤢) to focus on that file, with what it relies on and affects in side rails. | Reading real diffs without losing the thread |

Each view has three zoom levels (`enter` / `esc`): **Overview** → **Core** → **Page**. In Diff they are: all files → the file you're reading → that file in focus mode.

At **Core** level only the focused node shows its code; every other node stays title and why. A node reads top to bottom:

```
title
why it matters
comments        your drafts + existing GitHub review comments on these lines (if any)
code changes    modified → diff · only added / only removed / untouched → collapsed until opened
```

Click a comment to jump to its line. `e` opens collapsed code, then adds context.

## Focus aids

- **One signal colour.** Amber means "you are here" or "needs you"; everything else is warm neutral. Changed code is drawn ● and untouched code ○ (by shape, not hue).
- **Re-entry card.** When you come back, it shows where you were, your progress, and your parked thought.
- **Park a thought (`p`).** Jot down what's in your head before you get pulled away.
- **Key hints fade** after you've used a key a few times.
- **Settings (`,`).** Warm dark or light theme, reading font (Sans, Atkinson Hyperlegible, Serif, Mono), size, word spacing, motion, and an opt-in break reminder.
- **Calm diffs.** Muted line tints, word-level highlights, and no code ligatures.

Keys: `j/k` step · `J/K` core · `a` looks good → next · `f` flag · `n` next unreviewed · `c` comment · `e` open / more context · `p` park · `v` view · `s` submit · `?` help.

## How it works

0. **Cache.** Built graphs are cached per head commit in `~/.prfocus/cache`. Reopening a PR that hasn't been pushed to skips steps 1–5 and only re-reads review comments.
1. **Fetch.** `refs/pull/N/head` and the base branch are fetched. The diff is computed locally against the merge-base, so GitHub's patch truncation doesn't apply.
2. **Units.** Hunks are grouped by file and enclosing symbol. Lockfiles, generated files and whitespace-only hunks are moved to a single "low-signal" page.
3. **Static edges.** `git grep` at the head commit finds:
   - usages of changed symbols, split into changed vs. untouched code (downstream);
   - unchanged definitions that added lines rely on (upstream).
4. **Claude.** Headless `claude -p` with a JSON schema groups the units into cores, picks the relevant refs, writes one-line "why"s and marks risk. It can only use ids from step 3. The static tree is usable straight away; when Claude's tree is ready, a pill appears and `R` switches to it without moving you.
5. **Graph.** Everything is packed into a `prfocus.review-graph/v1` document, which is the only thing views read.
6. **State.** Progress is stored per hunk content hash in `~/.prfocus/state`, so after a force-push only new or changed hunks come back. Existing inline review comments are fetched with the PR and shown next to your drafts. Comments are drafts until you submit. They're posted as one GitHub review, and comments on untouched code go into the review summary.

Set `PRFOCUS_MODEL` to choose the Claude model.
