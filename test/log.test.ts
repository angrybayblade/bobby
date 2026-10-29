import { describe, expect, test } from "bun:test";
import { redact } from "../src/log.ts";

describe("redact", () => {
  test("blanks GitHub and Anthropic tokens", () => {
    expect(redact("token gho_abcdefghijklmnopqrstuvwxyz0123 here")).toBe("token ••• here");
    expect(redact("github_pat_11ABCDEFG0abcdefghijklmnop_xyz")).toBe("•••");
    expect(redact("key sk-ant-api03-abcdefghijk")).toBe("key •••");
  });
  test("keeps what says where a secret was", () => {
    expect(redact("Authorization: Bearer abcdef1234567890xyz")).toBe("Authorization: Bearer •••");
    expect(redact("https://x.dev/cb?code=abc123&state=s")).toBe("https://x.dev/cb?code=•••&state=s");
    expect(redact("https://user:hunter2@github.com/o/r.git")).toBe("https://user:•••@github.com/o/r.git");
  });
  test("leaves ordinary text alone", () => {
    expect(redact("gh repo clone DataDog/den failed (1)")).toBe("gh repo clone DataDog/den failed (1)");
  });
});
