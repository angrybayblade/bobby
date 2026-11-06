import { describe, expect, test } from "bun:test";
// @ts-expect-error: plain JS module
import { prArg, prItems, typedItem } from "../public/app/prs.js";

const here = "acme/api/7";
const home = {
  recents: [
    { id: "acme/api/7", kind: "pr", owner: "acme", repo: "api", number: 7, title: "This one", author: "ann", arg: "https://github.com/acme/api/pull/7", repoDir: "/r/api", open: true },
    { id: "acme/api/9", kind: "pr", owner: "acme", repo: "api", number: 9, title: "Open elsewhere", author: "bo", arg: "https://github.com/acme/api/pull/9", repoDir: "/r/api", open: true, progress: { done: 3, total: 10 } },
    { id: "acme/web/2", kind: "pr", owner: "acme", repo: "web", number: 2, title: "Seen before", author: "cy", arg: "https://github.com/acme/web/pull/2", repoDir: "/r/web", open: false },
    { id: "local/api/feat", kind: "local", repo: "api", branch: "feat", baseRef: "main", repoDir: "/r/api", open: false },
  ],
};
const pr = (owner: string, repo: string, number: number, extra = {}) => ({ owner, repo, number, title: `PR ${number}`, author: "di", url: `https://github.com/${owner}/${repo}/pull/${number}`, ...extra });

describe("prArg", () => {
  test("reads links, owner/repo#n, and #n in this repo", () => {
    expect(prArg("https://github.com/a/b/pull/12/changes/abc?x=1", "c/d")).toEqual({ owner: "a", repo: "b", number: 12, arg: "https://github.com/a/b/pull/12/changes/abc" });
    expect(prArg(" a.b/c-d#3 ", null)).toEqual({ owner: "a.b", repo: "c-d", number: 3, arg: "https://github.com/a.b/c-d/pull/3" });
    expect(prArg("#45", "acme/api")).toEqual({ owner: "acme", repo: "api", number: 45, arg: "https://github.com/acme/api/pull/45" });
  });
  test("is null for anything else, and for #n with no repo (a local branch)", () => {
    for (const t of ["redis", "45", "#", "acme/api", "https://gitlab.com/a/b/pull/1"]) expect(prArg(t, "acme/api")).toBeNull();
    expect(prArg("#45", null)).toBeNull();
  });
});

describe("prItems", () => {
  const items = prItems(home, { review: [pr("acme", "api", 9), pr("acme", "api", 11, { draft: true })], mine: [pr("acme", "api", 7)], all: [pr("acme", "api", 11), pr("x", "y", 1)] }, here);
  test("leaves out this review, and lists each PR once, recents first", () => {
    expect(items.map((i: { id: string }) => i.id)).toEqual(["pr:acme/api/9", "pr:acme/web/2", "pr:local/api/feat", "pr:acme/api/11", "pr:x/y/1"]);
  });
  test("pins the reviews open in this Bobby, which go straight there", () => {
    const open = items.find((i: { id: string }) => i.id === "pr:acme/api/9");
    expect(open).toMatchObject({ pin: true, tag: "open", open: { here: "/r/acme/api/9" }, title: "#9 Open elsewhere", sub: "acme/api · bo · 3/10 reviewed" });
  });
  test("opens the others through the server, as the home page does", () => {
    const by = (id: string) => items.find((i: { id: string }) => i.id === id);
    expect(by("pr:acme/web/2")).toMatchObject({ pin: false, href: "/r/acme/web/2", open: { what: "#2", body: { arg: "https://github.com/acme/web/pull/2", repo: "/r/web" } } });
    expect(by("pr:local/api/feat")).toMatchObject({ title: "⎇ feat", sub: "local · api vs main", open: { body: { repo: "/r/api", base: "main" } } });
    expect(by("pr:acme/api/11")).toMatchObject({ sub: "acme/api · di · review requested", tag: "draft", open: { body: { arg: "https://github.com/acme/api/pull/11" } } });
  });
  test("works with neither list yet", () => {
    expect(prItems(null, null, here)).toEqual([]);
    expect(prItems(home, null, here)).toHaveLength(3);
  });
});

describe("typedItem", () => {
  test("offers to open a typed PR, but not this one", () => {
    expect(typedItem("#12", "acme/api", here)).toMatchObject([{ id: "open:acme/api/12", same: "pr:acme/api/12", title: "Open acme/api#12", open: { body: { arg: "https://github.com/acme/api/pull/12" } } }]);
    expect(typedItem("#7", "acme/api", here)).toEqual([]);
    expect(typedItem("redis", "acme/api", here)).toEqual([]);
  });
});
