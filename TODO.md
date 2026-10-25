# Before 0.1.0

The CLI is the public release: it needs `git`, `gh` (logged in) and SSH access to GitHub. A hosted Bobby comes later.

## Setup and onboarding

- [ ] Clone over SSH (`git@github.com:<owner>/<repo>.git`), not with `gh repo clone`, which follows gh's `git_protocol` and
      leaves an HTTPS remote that `git fetch` then can't authenticate.
- [ ] Check the requirements up front, not halfway through a review: `git`, `gh` installed, `gh auth status`, and
      `ssh -T git@github.com`. Each failure names the one command that fixes it.
- [ ] Home page: a setup card in place of the PR lists while something's missing (signed in as whom, what to run),
      with "Check again".
- [ ] Translate gh and git failures into one sentence naming the account in use: logged out, SSO not authorized for
      the org, a private repo's "Repository not found", SSH key refused.
- [ ] `bobby doctor`: git, gh, the account, per-org SSO, SSH, Claude login, language servers; something to paste into
      a bug report.
- [ ] Ask only when it's needed: a local branch review needs no GitHub; the Claude tree is optional ("works without it").
- [ ] install.sh: offer to install gh and run `gh auth login`.
- [ ] README and getting-started: the requirements above, stated once.

## Review UI

- [x] Conversation view: description, timeline, threads with replies, reviewers, CI, mergeability.
- [ ] Conversation: resolve and unresolve threads; reactions; edit or delete your own comments.
- [ ] Generated files: one detector, so the Generated switch also covers `dist/`, `build/`, `vendor/`, `.min.js` and
      `.map` (now only on the Low-signal page, from `src/diff.ts`).
- [ ] Highlighting a slice that starts inside a multi-line string, template literal or Python docstring (block
      comments are handled).

## Release

- [ ] Remove the release-candidate compatibility guards (`git grep -n 'TODO(0.1.0)'`), then follow
      [Releasing](docs/contributing.md#releasing).

## After 0.1.0

- Hosted Bobby as a GitHub App (per-repo install, scoped permissions, short-lived installation tokens, webhooks to
  extract ahead of time); its device flow could later sign the CLI in without gh.
- Partial clones (`--filter=blob:none`) and clone progress in the UI, for large monorepos.
- Agent-assisted review on more than Claude Code: one interface (run with a prompt and a schema, stream what it does,
  status, install, sign in) behind Claude Code, Codex (`codex exec --output-schema`, `codex login --device-auth`) and Pi
  (`pi -p --mode json`, signed in on its own); and an API backend on the Vercel AI SDK for any provider with a key
  (Anthropic, OpenAI, Gemini, OpenRouter, OpenAI-compatible, Ollama), with Bobby's own tools in process. Chosen in
  Settings. Never borrow a CLI's subscription sign-in for the API.
