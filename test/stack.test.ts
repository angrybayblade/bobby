import { expect, test } from "bun:test";
import { savedChain, withChain } from "../src/stack.ts";

const r = { owner: "Acme", repo: "Shop" };

test("a stack you define holds each PR once, and one PR alone isn't a stack", () => {
  let s = withChain({}, r, 2, [1, 2, 3]);
  expect(s).toEqual({ "acme/shop": [[1, 2, 3]] });
  expect(savedChain(s, { owner: "acme", repo: "shop" }, 3)).toEqual([1, 2, 3]); // owner and repo in any case
  s = withChain(s, r, 5, [5, 6]);
  expect(s["acme/shop"]).toEqual([[1, 2, 3], [5, 6]]);
  s = withChain(s, r, 6, [3, 6, 7]); // 3 and 6 leave their stacks: [5] alone is dropped
  expect(s["acme/shop"]).toEqual([[1, 2], [3, 6, 7]]);
  s = withChain(s, r, 2, [4, 2]); // reordered, with 1 taken out: the rest of 2's old stack goes with it
  expect(s["acme/shop"]).toEqual([[3, 6, 7], [4, 2]]);
  expect(savedChain(s, r, 1)).toBeNull();
  s = withChain(withChain(s, r, 6, []), r, 2, []);
  expect(s).toEqual({});
});
