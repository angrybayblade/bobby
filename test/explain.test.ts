import { describe, expect, test } from "bun:test";
import { classify, explain } from "../src/explain.ts";

const says = (text: string, env = {}) => { const k = classify(text); return k && explain(k, text, env); };

// These are what gh and git really print: the first five captured from them, the SAML ones as GitHub words them.
describe("gh and git failures, in a sentence", () => {
  test("a repository that isn't there, or that this account can't see", () => {
    const m = says("GraphQL: Could not resolve to a Repository with the name 'acme/secret'. (repository)", { login: "octocat" })!;
    expect(m).toContain("acme/secret");
    expect(m).toContain("octocat");
    expect(m).toContain("gh auth switch");
    expect(says("remote: Repository not found.\nfatal: repository 'https://github.com/acme/secret.git/' not found")).toContain("acme/secret");
  });
  test("a pull request that isn't there", () => {
    expect(says("GraphQL: Could not resolve to a PullRequest with the number of 999999. (repository.pullRequest)")).toContain("#999999");
  });
  test("signed out, or a token GitHub refuses", () => {
    expect(says("To get started with GitHub CLI, please run:  gh auth login")).toContain("gh auth login");
    expect(says("HTTP 401: Bad credentials (https://api.github.com/graphql)\nTry authenticating with:  gh auth login -h github.com")).toContain("gh auth login");
    expect(says("HTTP 401: Bad credentials", { envToken: "GH_TOKEN" })).toContain("GH_TOKEN");
  });
  test("single sign-on not authorized, before anything else it looks like", () => {
    const text = "HTTP 403: Resource protected by organization SAML enforcement. You must grant your OAuth token access to this organization.";
    expect(classify(text)).toBe("sso");
    expect(says(text, { login: "octocat" })).toContain("gh auth refresh");
    expect(says(text, { envToken: "GH_TOKEN" })).toContain("GH_TOKEN");
    expect(says("GraphQL: authenticate at https://github.com/orgs/acme/sso?authorization_request=abc to continue, SAML")).toContain("https://github.com/orgs/acme/sso?authorization_request=abc");
  });
  test("a missing permission names it", () => {
    expect(says("Your token has not been granted the required scopes to execute this query. The 'x' field requires one of the following scopes: ['read:org'], but your token has only been granted the: ['repo'] scopes.")).toContain("gh auth refresh -s read:org");
  });
  test("the rest", () => {
    expect(classify("API rate limit exceeded for user ID 1")).toBe("rateLimit");
    expect(classify("HTTP 403: Resource not accessible by integration")).toBe("forbidden");
    expect(classify("git@github.com: Permission denied (publickey).")).toBe("sshKey");
    expect(classify("error connecting to api.github.com")).toBe("offline");
    expect(classify("fatal: unable to access 'https://github.com/a/b/': Could not resolve host: github.com")).toBe("offline");
  });
  test("anything else keeps its own words", () => {
    expect(classify("fatal: not a git repository (or any of the parent directories): .git")).toBeNull();
    expect(classify("fatal: ambiguous argument 'abc': unknown revision or path not in the working tree.")).toBeNull();
    expect(classify("error: pathspec 'x' did not match any file(s) known to git")).toBeNull();
  });
});
