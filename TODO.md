# Before 0.1.0

The CLI is the public release: it needs `git`, and `gh` signed in for PRs (Bobby offers to set `gh` up). A hosted Bobby comes later.

- [ ] Turn on private vulnerability reporting for the repo, which `SECURITY.md` points to.
- [ ] Release candidate: tag it, then on a machine with no `gh` or Claude, and on Windows, try the install script, first-run setup, a private PR and `bobby update`.
- [ ] Decide what the `bobby.review-graph/v1` format promises in a stable release, and say so in `SPEC.md`.
- [ ] Follow [Releasing](docs/contributing.md#releasing).

## After 0.1.0

- macOS code signing and notarization, and publishing to npm.
- Generated files: one detector, so the Generated switch also covers `dist/`, `build/`, `vendor/`, `.min.js` and `.map` (now only on the Low-signal page, from `src/diff.ts`).
- Highlighting a slice that starts inside a multi-line string, template literal or Python docstring (block comments are handled).
- `install.sh`: offer to install `gh` and run `gh auth login` (Bobby's page does this on first run).
- PR actions from Bobby: merge (once checks pass, with GitHub's merge methods), request reviewers, mark ready for review, labels.
- Whole-stack review: a stack's PRs in one review at `/s/<owner>/<repo>/<stack>`, entered from the stack bar, beside
  the per-PR review rather than in its place. One graph merged from each layer's own (each still diffed against the
  layer below; ids prefixed by layer, files tagged with it, a `stack` section with the cross-layer edges from
  `stackctx.ts`), so views keep reading one document and only learn to group by layer. Diff and Flow: a lane per
  layer, left to right from the trunk, with a labelled boundary between lanes and cross-layer edges styled apart.
  Outline and Lens: grouped by layer. The walk crosses layers through a transition card ("End of #101 · next: #102,
  which uses …"). Map: one run over the whole stack, drawn in vertical bands per layer. Conversation off for now.
  Marks stay in each PR's state; drafts belong to the layer whose diff they're on, and submit sends one review per
  PR. Layers come from the per-PR build cache and stream in as they build; one layer moving rebuilds only its part.
  Risks: the frontend's single-PR assumptions (`app.graph.pr`, posting, routes), and drawing ~4× a PR's files in Diff.
- GitHub Enterprise: the host (`GH_HOST`) threaded through `gh` and the clone URLs, in place of the github.com-only refusal.

- Hosted Bobby as a GitHub App (per-repo install, scoped permissions, short-lived installation tokens, webhooks to
  extract ahead of time); its device flow could later sign the CLI in without gh.
- Partial clones (`--filter=blob:none`) and clone progress in the UI, for large monorepos.
- Agent-assisted review on more than Claude Code: one interface (run with a prompt and a schema, stream what it does,
  status, install, sign in) behind Claude Code, Codex (`codex exec --output-schema`, `codex login --device-auth`) and Pi
  (`pi -p --mode json`, signed in on its own); and an API backend on the Vercel AI SDK for any provider with a key
  (Anthropic, OpenAI, Gemini, OpenRouter, OpenAI-compatible, Ollama), with Bobby's own tools in process. Chosen in
  Settings. Never borrow a CLI's subscription sign-in for the API.
- Agent quality check: a few fixed questions and a review on a test PR, recording tool calls, whether every reference
  resolves to a real line, the answer's length and cost; run it when the prompts or tools change.
- Claude's review, streamed: each finding appears as it's found (a tool Claude calls per finding), not all at the end.
- Claude's review of one part: the core you're on, or a selection of files, as well as the whole PR; and more than one
  review at a time.
- `bobby://` links (`bobby://github.com/<owner>/<repo>/pull/<n>`) that open a PR in Bobby from anywhere, running or
  not, by handing it to `bobby <pr-url>`. Opt in with `bobby link` / `bobby unlink`: registry keys on Windows, a
  `.desktop` file and `xdg-mime` on Linux, and a small generated `.app` (`CFBundleURLTypes`, registered with
  `lsregister`) on macOS. Take only a PR URL (`parsePrArg`), never flags, since any page can fire the link; point at
  the binary's real path so `bobby update` keeps it working. Plus an "Open in Bobby" bookmarklet on the landing page
  for a Bobby that's already running (`/?open=<pr-url>`).
