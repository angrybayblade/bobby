import { expect, test } from "bun:test";
import { report, ssoOrgs } from "../src/doctor.ts";

test("finds the organizations waiting on single sign-on", () => {
  expect(ssoOrgs("HTTP/2.0 200 OK\nX-GitHub-SSO: partial-results; organizations=21955855,20582480\nServer: GitHub.com")).toEqual(["21955855", "20582480"]);
  expect(ssoOrgs("HTTP/2.0 200 OK\nServer: GitHub.com\n\n[]")).toEqual([]);
});

test("only what's needed makes it fail, and each problem says what to do", () => {
  const fine = report("bobby", [{ name: "git", ok: true, detail: "2.4" }, { name: "claude", ok: false, optional: true, detail: "not installed", fix: "set it up" }]);
  expect(fine.ok).toBe(true);
  expect(fine.text).toContain("Ready to review PRs.");
  expect(fine.text).toContain("→ set it up");
  const bad = report("bobby", [{ name: "gh", ok: false, detail: "not installed", fix: "install it" }]);
  expect(bad.ok).toBe(false);
  expect(bad.text).toContain("✗ gh");
  expect(bad.text).toContain("1 problem to fix.");
});

test("what gets pasted has no home folder or token in it", () => {
  const { text } = report("home /Users/me/.bobby", [{ name: "x", ok: true, detail: "ghp_abcdefghijklmnopqrstuvwxyz0123456789" }], "/Users/me");
  expect(text).toContain("home ~/.bobby");
  expect(text).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
});
