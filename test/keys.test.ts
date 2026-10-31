import { describe, expect, test } from "bun:test";
// @ts-expect-error: a browser module without types
import { actionFor, bind, keyOfEvent, keysOf, reset, unbind } from "../public/app/keys.js";

describe("key bindings", () => {
  test("defaults until you bind", () => {
    expect(keysOf({}, "next")).toEqual(["j", " "]);
    expect(actionFor({}, "k")).toBe("prev");
  });
  test("binding a key takes it from the action that had it", () => {
    const { from, keys } = bind({}, "flag", "j");
    expect(from).toBe("next");
    expect(keys).toEqual({ next: [" "], flag: ["x", "j"] });
    expect(actionFor({ keys }, "j")).toBe("flag");
  });
  test("only what differs from the defaults is kept", () => {
    const { keys } = bind({}, "flag", "x");
    expect(keys).toEqual({});
    expect(unbind({}, "flag", "x")).toEqual({ flag: [] });
  });
  test("reset takes a default back from the action that took it", () => {
    const { keys } = bind({}, "flag", "j");
    const back = reset({ keys }, "next");
    expect(back).toEqual({}); // flag is down to its own default again
    expect(actionFor({ keys: back }, "j")).toBe("next");
    expect(reset({ keys })).toEqual({});
  });
  test("reads shift with named keys, and shift+1 whatever the layout prints", () => {
    expect(keyOfEvent({ key: "ArrowLeft", shiftKey: true, code: "ArrowLeft" })).toBe("Shift+ArrowLeft");
    expect(keyOfEvent({ key: "J", shiftKey: true, code: "KeyJ" })).toBe("J");
    expect(keyOfEvent({ key: "§", shiftKey: true, code: "Digit1" })).toBe("!");
  });
  test("reads ctrl with a key, for the views", () => {
    expect(keyOfEvent({ key: "6", ctrlKey: true, code: "Digit6" })).toBe("Ctrl+6");
    expect(keyOfEvent({ key: ",", ctrlKey: true, code: "Comma" })).toBe("Ctrl+,");
    expect(actionFor({}, "Ctrl+6")).toBe("view:diff");
    expect(actionFor({}, "Ctrl+.")).toBe("nextView");
  });
});
