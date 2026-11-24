import { describe, expect, it } from "vitest";
import { newId } from "./id";

describe("newId（D-015）", () => {
  it("UUID（第4版）の形で作る", () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("毎回ちがう ID になる", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId()));
    expect(ids.size).toBe(1000);
  });
});
