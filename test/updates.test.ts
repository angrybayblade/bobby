import { expect, test } from "bun:test";
import { assetName, compareVersions } from "../src/updates.ts";

test("orders versions, pre-releases before their release", () => {
  const sorted = ["0.1.0", "0.1.0-rc10", "0.0.9", "0.1.0-rc5", "v0.2.0-rc1", "0.1.1", "0.1.0-rc9"].sort(compareVersions);
  expect(sorted).toEqual(["0.0.9", "0.1.0-rc5", "0.1.0-rc9", "0.1.0-rc10", "0.1.0", "0.1.1", "v0.2.0-rc1"]);
  expect(compareVersions("0.1.0-rc5", "0.1.0-rc5")).toBe(0);
});

test("names the release archive for each platform", () => {
  expect(assetName("0.1.0-rc12", "darwin", "arm64")).toBe("bobby-0.1.0-rc12-darwin-arm64.tar.gz");
  expect(assetName("0.1.0-rc12", "linux", "x64")).toBe("bobby-0.1.0-rc12-linux-x64.tar.gz");
  expect(assetName("0.1.0-rc12", "win32", "x64")).toBe("bobby-0.1.0-rc12-windows-x64.zip");
  expect(assetName("0.1.0-rc12", "win32", "arm64")).toBeNull();
  expect(assetName("0.1.0-rc12", "freebsd", "x64")).toBeNull();
});
