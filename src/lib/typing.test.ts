import { describe, expect, it } from "vitest";
import { keyboardHeight } from "./typing";

describe("キーボードに隠れている高さ（D-177）", () => {
  it("画面全体と、見えている高さの差を返す", () => {
    expect(keyboardHeight(852, 516, 0)).toBe(336);
  });
  it("キーボードが出ていなければ0", () => {
    expect(keyboardHeight(852, 852, 0)).toBe(0);
  });
  it("画面がずらされている分は、隠れている高さに入れない", () => {
    expect(keyboardHeight(852, 516, 100)).toBe(236);
  });
  it("マイナスにはしない", () => {
    expect(keyboardHeight(700, 852, 0)).toBe(0);
  });
});
