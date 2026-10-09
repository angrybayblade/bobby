# focus-bobby

A tool to help me not lose focus while reviewing PRs.

![](img/bobby.png)

**prfocus** turns a GitHub pull request into a short walk of focused pages. It finds the core changes and, around each one, the code they rely on and the code they affect. Then it shows you one thing at a time, in an order where nothing appears before what it depends on:

```
untouched code it relies on → changed code it relies on → CORE CHANGE → changed code it affects → untouched code it affects
```

You can zoom out to see the whole tree, or walk it page by page. Mark pages as you go, draft comments, and submit them to GitHub as one review. Your place and progress survive interruptions and force-pushes.

## Quick start

```sh
bun add -g github:angrybayblade/focus-bobby   # or: bun run build → dist/prfocus, a standalone binary

prfocus https://github.com/owner/repo/pull/123
prfocus 123        # inside a clone of the repo
prfocus            # no PR: review the branch you're on, uncommitted changes included
```

You'll need `bun`, `git`, and `gh` (logged in). With the `claude` CLI installed, Claude organises the PR into a smarter tree in the background, using your Claude Code login.

In the UI: `j`/`k` to step, `enter`/`esc` to zoom, `a` for looks good, `c` to comment, `v` to switch view, `s` to submit, and `?` for every key.

## Docs

- **User manual**: [getting started](docs/getting-started.md) · [reviewing a PR](docs/reviewing.md) · [views](docs/views.md) · [settings](docs/settings.md)
- **Implementation**: [architecture](docs/architecture.md) · [extraction pipeline](docs/extraction.md) · [server and state](docs/server-and-state.md) · [browser runtime](docs/frontend.md) · [contributing](docs/contributing.md)
- **Format**: [review graph v1](SPEC.md), the open format between extraction and views
