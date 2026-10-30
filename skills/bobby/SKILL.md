---
name: bobby
description: Open GitHub pull requests, or a local branch's changes, in Bobby, the user's focus-first PR reviewer, which runs on their machine and shows the review in their browser. Use when the user asks to open, review or look at a PR "in Bobby" or "with Bobby", or asks to start or stop Bobby.
---

# Bobby

Bobby is a PR reviewer that runs on the user's machine: one app, in the background, serving every review the user has open at `http://127.0.0.1:<port>/`. Your job is to get a review open in it for the user. The user does the reviewing in their browser; you don't review through Bobby for them.

## Open a review

**If you have the `open_review` tool** (`mcp__bobby__open_review`, from `bobby mcp`), use it. It finds the running Bobby or starts one, opens the review, and shows it in the browser. Pass:

- `pr`: the PR's URL, `owner/repo#123`, or its number in the repository you work in. Leave it out to review the current branch's changes (its commits and uncommitted changes) instead.
- `repo`: a folder with a git checkout, when it isn't the folder you work in.
- `base`: without `pr`, the branch to compare against, if the user names one.
- `show: false` only if the user doesn't want the browser opened.

**Otherwise, use the CLI**, in two steps:

```sh
bobby start                                  # a Bobby running in the background: starts one if there's none, else says where it is
bobby https://github.com/acme/payments/pull/482   # hands the PR to it, opens the browser, returns at once
```

- Always run `bobby start` first. Without a Bobby running, `bobby <pr>` starts one in the foreground and doesn't return until it's stopped.
- Pass the PR as its URL or number. The CLI doesn't take `owner/repo#123`: turn it into `https://github.com/owner/repo/pull/123`. A number needs you to be in a clone of the PR's repository (or `--repo <dir>`).
- For the current branch's changes, run `bobby` with no PR inside the repository (or `bobby --repo <dir>`); `--base <branch>` picks what to compare with.
- One commit of a PR: `<pr-url>/changes/<sha>`, or a range: `<pr-url>/changes/<from>..<to>`.
- `--no-open` leaves the browser alone.

Either way, you get the review's link, `http://127.0.0.1:<port>/r/<owner>/<repo>/<number>`. Give it to the user. Bobby builds the review after it opens, which takes a few seconds to a minute; the page shows the progress, so you don't need to wait for it.

## When it can't open the review

- **GitHub's CLI isn't set up.** Bobby reads PRs with `gh`. It answers with a page link that walks the user through signing in, then opens the PR. Pass the link on; don't run `gh auth login` yourself, since it needs the user.
- **Cloning over HTTPS failed.** Bobby clones with `gh`'s sign-in. It won't try SSH (the user's keys and `~/.ssh/config`) unless the user agrees. Ask them; if they agree, try again with `ssh: true` (the tool) or `--ssh` (the CLI).
- **`bobby: command not found`.** Bobby isn't installed. Tell the user, and offer to install it once they agree: `curl -fsSL https://raw.githubusercontent.com/angrybayblade/bobby/main/install.sh | bash`. It needs `git`, and sets up `gh` on its first PR.
- **`bobby start` says Bobby didn't come up**, or anything else fails: `bobby logs` prints the end of Bobby's log. Read it, and tell the user what it says.

## Other commands

- `bobby stop` stops the running Bobby. Only run it when the user asks: it closes every review they have open (their progress is saved).
- The link `bobby start` prints is Bobby's home page, which lists the PRs waiting on the user's review.
- `bobby extract <pr> -o graph.json` writes Bobby's analysis of a PR as JSON (the `bobby.review-graph/v1` format) without opening anything, if the user wants the data rather than the review.

Bobby only listens on this machine (`127.0.0.1`), and keeps its files in `~/.bobby` (`BOBBY_HOME` moves them).
