import { expect, test } from "bun:test";
import { onboarded } from "../src/onboarding.ts";

const set = { installed: true, loggedIn: true }, signedOut = { installed: true, loggedIn: false }, missing = { installed: false, loggedIn: false };

test("a first launch without gh or Claude goes to the setup page", () => {
  expect(onboarded({}, missing, missing)).toBe(false);
  expect(onboarded({}, signedOut, set)).toBe(false); // installed isn't enough: signed in
  expect(onboarded({}, set, missing)).toBe(false); // Claude still to set up, or skip
});

test("each step counts once it's set up or skipped; with nothing left, there's no setup page", () => {
  expect(onboarded({}, set, set)).toBe(true); // a machine with both already: never sees it
  expect(onboarded({ claude: "never" }, set, missing)).toBe(true);
  expect(onboarded({ gh: "never", claude: "never" }, missing, missing)).toBe(true);
});

test("finished once, it stays finished, whatever happens to gh and Claude later", () => {
  expect(onboarded({ onboarded: "2026-11-16T00:00:00.000Z" }, missing, missing)).toBe(true);
});
