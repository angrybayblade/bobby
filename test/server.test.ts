import { expect, test } from "bun:test";
import { hostAllowed } from "../src/server.ts";

test("answers at loopback names on any port: Bobby's own, or an SSH tunnel's", () => {
  for (const h of ["127.0.0.1:4173", "localhost:4173", "localhost:9000", "LOCALHOST:9000", "[::1]:4173", "localhost"]) expect(hostAllowed(h)).toBe(true);
});

test("refuses any other name unless it's allowed: a rebinding site sends its own", () => {
  expect(hostAllowed("evil.example:4173")).toBe(false);
  expect(hostAllowed("10.0.0.5:4173")).toBe(false);
  expect(hostAllowed("localhost.evil.example:4173")).toBe(false);
  expect(hostAllowed("")).toBe(false);
});

test("an allowed name takes any port; with a port, only that one; * takes anything", () => {
  expect(hostAllowed("bobby.vm.internal:4173", ["bobby.vm.internal"])).toBe(true);
  expect(hostAllowed("bobby.vm.internal", ["bobby.vm.internal"])).toBe(true); // behind a proxy on 80/443
  expect(hostAllowed("Bobby.VM.internal:8080", ["bobby.vm.internal:8080"])).toBe(true);
  expect(hostAllowed("bobby.vm.internal:4173", ["bobby.vm.internal:8080"])).toBe(false);
  expect(hostAllowed("other.vm.internal:4173", ["bobby.vm.internal"])).toBe(false);
  expect(hostAllowed("34.120.1.9:4173", ["*"])).toBe(true);
});
