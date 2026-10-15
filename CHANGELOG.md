# Changelog

What changed in each release, newest first. Each release's full notes, with install commands, are on [GitHub releases](https://github.com/angrybayblade/bobby/releases).

## Unreleased

## 0.1.0-rc5 (2026-10-15)

Bobby is now MIT-licensed. Comments show in place, as GitHub threads; an open review keeps up with the PR; and a long list of fixes from an audit before the stable release.

**Keeping current**
- New comments on the PR appear on their lines while you review.
- New commits on the PR, or new work on a local branch, are offered with a **Refresh** prompt, never swapped in; refreshing keeps your place and your marks on what didn't change.

**Comments in place**
- Threads sit under their line, like GitHub's, with avatars, Markdown and **Show more**; in a split diff, on the side they were made on. Private notes float beside their line.
- Collapse a thread, a file's comments or the whole PR's; markers say how many are above or below.
- The comment box opens where the comment will sit, with a Comment / Private note switch. **Cancel** discards; `esc` keeps it as an unfinished draft.
- A first review opens in the Diff view.

**Flow**
- The arrow keys move at every level; ← always retracts, to the parent and then out a level.

**Keyboard**
- `]` / `[` select the next or previous line and `}` / `{` grow the selection, so `c` and `m` can comment on a line you chose.
- Enter and space work on a button you've tabbed to; Tab stays inside an open dialog, and closing it gives focus back.
- A file's viewed box in the file tree can be reached by keyboard, and focus stays put when the chrome redraws.
- Diff's ← / → history survives a reload.
- Every hint and tooltip shows your own keys.

**Review**
- Undo after deleting a draft or a note.
- Binary files, pure renames, mode changes and empty files appear on the Low-signal page; a renamed file's header shows where it came from.
- GitHub comments on the old side of an unchanged line show, and count in "comments below".
- "More below" only where the file has more; the Low-signal page says when it cuts a long hunk short.
- `bobby clean [--repos]`, and a daily tidy of caches older than a month and old language-server versions.

**Reliability**
- Bobby's server only answers its own page: another website can no longer read your review or post as you.
- Your progress is written atomically, and a state file that can't be read is kept aside instead of being overwritten.
- A second `bobby` on the same review opens the one already running instead of saving over it.
- A draft whose line has left the diff goes into the review's summary instead of making GitHub refuse the whole review.
- Comment text survives re-renders and moving away; a failed save keeps the box open with its text, and says so.
- A failed load, save or status check says what happened instead of failing silently.
- Enter and space work on a button you've tabbed to; enter on **Approve** posts the review instead of closing the dialog, and it can't be posted twice.
- A local review keeps uncommitted changes when `git stash create` refuses (intent-to-add files, a merge in progress).
- A fresh machine with Go installed no longer crashes on start.
- highlight.js ships with Bobby instead of loading from a CDN.
- A retargeted PR is rebuilt (the cache key includes the base branch); a cached PR fetches its commits if the clone lacks them.
- `--no-llm` shows no Claude tree, even a cached one; `--refresh` asks the language servers afresh.
- A language server that keeps timing out is dropped for imports instead of leaving names loading for hours; Check again answers at once.
- Claude gives up after 15 minutes; a review GitHub took is counted as posted even if its reply was lost.
- File names git quotes (or ends with a tab) are read right; GitHub Enterprise URLs and a missing `gh` say so instead of crashing; CLI failures are one line.
- Windows: line endings no longer read as changes in a local review, and monorepo workspaces link without Developer Mode.
- The inspector's window no longer gets stuck after a focus change, and the focus nudges keep working after switching trees.

**Faster**
- Toggling Tests or Untouched builds the views once (about twice as fast); switching views renders once; resizes are handled once a frame.
- Word marks can't freeze the page on big reformatted hunks; Flow no longer leaks a canvas per visit.
- The status poll redraws only when something changed. Finding uses without a language server is remembered and doesn't stall the server.
- Reading a language server's large answers, resolving Go, Java and Python imports, and caches of files read are all bounded or indexed.

**For tools reading the graph**
- `generator.version` is Bobby's version; the extraction's own is `generator.extraction`.
- The schema describes `definitions` and comment ranges (`startLine`, `startSide`); names with no text are no longer emitted.

**Project**
- MIT license, with notices for what the binaries carry (Bun, tree-sitter, highlight.js).
- Tests (diff parsing, key bindings, an extracted graph validated against the schema) and CI on every push, with a binary smoke test on macOS, Linux and Windows.
- [What leaves your machine](docs/privacy.md): what Bobby sends to Claude, GitHub and others.

## 0.1.0-rc4 (2026-10-14)

Inspect a name (⌘-click) and list where it's used (⌘⇧-click), with language servers for TypeScript, JavaScript, Python and Go; rebindable keys; back and forth through files in the Diff view.

## 0.1.0-rc3 (2026-10-13)

Dependencies are traced through the syntax tree and imports instead of text search: fewer, right links, and minutes faster on a large repo. Comments on a range of lines, a command palette, a first-run tour, and a Diff canvas that zooms like a map.

## 0.1.0-rc2 (2026-10-12)

Every view shares the Diff view's look, keys and file viewer. Flow is rebuilt as one tree that starts from the changes. Tests, generated files and untouched code are hidden by default.

## 0.1.0-rc1 (2026-10-11)

A GitHub-style Diff view with split diffs and a focus mode, and a one-command install.

## 0.1.0-rc0 (2026-10-10)

The first release candidate.
