// `bun install` runs this (package.json "prepare"): point git at the repo's hooks (.githooks), when this is a git
// checkout. A script rather than a shell line, so it runs the same on Windows.
const inRepo = Bun.spawnSync(["git", "rev-parse", "--git-dir"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
if (inRepo) Bun.spawnSync(["git", "config", "core.hooksPath", ".githooks"]);
