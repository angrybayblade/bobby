import { expect, test } from "bun:test";
// @ts-expect-error: a browser module without types
import { argFor, crumbText, pick, spanOf } from "../public/app/commitrange.js";

const sha = (c: string) => c.repeat(40);
const list = ["a", "b", "c", "d"].map((c, i, all) => ({ sha: sha(c), parent: i ? sha(all[i - 1]) : sha("0") }));
const URL = "https://github.com/o/r/pull/1";

test("the crumb names the first and last commit reviewed", () => {
  expect(crumbText(list, {})).toBe("aaaa...dddd");
  expect(crumbText(list, { commit: { sha: sha("c") } })).toBe("cccc");
  expect(crumbText(list, { commit: { sha: sha("c"), from: sha("a") } })).toBe("bbbb...cccc"); // from isn't itself reviewed
  expect(crumbText(list, { commit: { sha: sha("c"), from: sha("0") } })).toBe("aaaa...cccc");
  expect(crumbText(list.slice(0, 1), {})).toBe("aaaa");
});

test("without the PR's list, the crumb says what the review knows", () => {
  expect(crumbText([], {})).toBe("");
  expect(crumbText([], { commit: { sha: sha("c") } })).toBe("cccc");
  expect(crumbText(list, { commit: { sha: sha("e"), from: sha("f") } })).toBe("ffff...eeee"); // force-pushed away
  expect(spanOf(list, { commit: { sha: sha("c"), from: sha("f") } })).toBeNull(); // off the line
});

test("a stretch of commits becomes the review that shows it", () => {
  expect(argFor(list, 0, 3, URL)).toBe(URL);
  expect(argFor(list, 1, 1, URL)).toBe(`${URL}/changes/${sha("b")}`);
  expect(argFor(list, 1, 2, URL)).toBe(`${URL}/changes/${sha("a")}..${sha("c")}`); // from the parent of the first
  expect(argFor(list, 0, 2, URL)).toBe(`${URL}/changes/${sha("0")}..${sha("c")}`);
  expect(argFor(list.slice(0, 1), 0, 0, URL)).toBe(URL);
});

test("a click takes one commit, a second the commits between, a third starts over", () => {
  let s = pick({ lo: 0, hi: 3, anchor: null }, 2);
  expect(s).toEqual({ lo: 2, hi: 2, anchor: 2 });
  s = pick(s, 0);
  expect(s).toEqual({ lo: 0, hi: 2, anchor: null });
  s = pick(s, 3);
  expect(s).toEqual({ lo: 3, hi: 3, anchor: 3 });
  s = pick(s, 3); // the same one twice: still it alone
  expect(s).toEqual({ lo: 3, hi: 3, anchor: null });
  // shift extends from the selection's start, and a plain click after it starts over
  s = pick({ lo: 1, hi: 1, anchor: null }, 3, true);
  expect(s).toEqual({ lo: 1, hi: 3, anchor: null });
  expect(pick(s, 0, true)).toEqual({ lo: 0, hi: 1, anchor: null });
  expect(pick(s, 2)).toEqual({ lo: 2, hi: 2, anchor: 2 });
});
