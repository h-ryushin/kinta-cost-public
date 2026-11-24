import { describe, expect, it } from "vitest";

/**
 * useOnce の止め方（D-157）は React の外では動かせないので、同じ考え方の関数で確かめる：
 * 走っているあいだの2回目は何もしない、失敗したらまた走れる。
 */
function once() {
  let running = false;
  return async (action: () => Promise<void>) => {
    if (running) return "skipped";
    running = true;
    try {
      await action();
      return "done";
    } catch (e) {
      running = false;
      throw e;
    }
  };
}

describe("続けて押したときの止め方（D-157）", () => {
  it("走っているあいだに押しても、2回目は走らない", async () => {
    const run = once();
    let count = 0;
    const slow = () => new Promise<void>((resolve) => setTimeout(() => { count++; resolve(); }, 10));
    const results = await Promise.all([run(slow), run(slow), run(slow)]);
    expect(count).toBe(1);
    expect(results).toEqual(["done", "skipped", "skipped"]);
  });

  it("失敗したら、また押せる", async () => {
    const run = once();
    await expect(run(() => Promise.reject(new Error("だめ")))).rejects.toThrow("だめ");
    expect(await run(() => Promise.resolve())).toBe("done");
  });
});
