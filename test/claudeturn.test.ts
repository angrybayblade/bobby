import { expect, test } from "bun:test";
import { claudeBusy, claudeTurn } from "../src/claude.ts";

test("at most three Claude runs at once; the next waits for a turn to be given back, once", async () => {
  const turns = await Promise.all([claudeTurn(), claudeTurn(), claudeTurn()]);
  expect(claudeBusy()).toBe(true);
  let fourth = false;
  const next = claudeTurn().then((done) => { fourth = true; return done; });
  await Bun.sleep(5);
  expect(fourth).toBe(false);
  turns[0](); turns[0](); // given back twice: counts once
  const done = await next;
  expect(fourth).toBe(true);
  expect(claudeBusy()).toBe(true);
  for (const d of [done, turns[1], turns[2]]) d();
  expect(claudeBusy()).toBe(false);
});
