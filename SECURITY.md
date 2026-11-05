# Security

Please report a vulnerability privately, through [Report a vulnerability](https://github.com/angrybayblade/bobby/security/advisories/new) on GitHub, rather than in an open issue. Say what you found, how to reproduce it, and which version (`bobby --version`) it's in.

Fixes go into the newest release; older ones aren't patched. `bobby update` installs it.

## What counts

Bobby runs on your machine, reads PRs that other people wrote, and posts to GitHub as you, so these are in scope:

- A PR's contents (code, comments, file names, its description) running code on your machine or in the review page, or getting Bobby to post, or to send data anywhere, without you asking.
- Another website, or something else on your network, reaching Bobby's server on `127.0.0.1` and reading or writing through it.
- Your GitHub or Anthropic sign-in showing up where it shouldn't: logs, reports, other programs.
- A `bobby update` or install that accepts something other than the release it asked for.
- Claude, or a language server, doing more with a PR than [the docs](docs/privacy.md) say it can.

These aren't vulnerabilities in Bobby: someone who can already run commands as you, and exposing Bobby yourself with `--host` or `--allow-host` on a network you don't trust, since it has [no authentication of its own](docs/getting-started.md#on-a-remote-machine). What Bobby sends where is listed in [What leaves your machine](docs/privacy.md).
