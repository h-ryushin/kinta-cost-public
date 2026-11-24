import { describe, expect, it } from "vitest";
import { PAGE_ROWS, readAllPages } from "./read-all";

/** rows 行ある表を、1回に1,000行まで返すように読む */
function table(rows: number) {
  const calls: [number, number][] = [];
  const fetchPage = async (from: number, to: number) => {
    calls.push([from, to]);
    const data = Array.from(
      { length: Math.max(0, Math.min(to, rows - 1) - from + 1) },
      (_, i) => from + i,
    );
    return { data, error: null };
  };
  return { calls, fetchPage };
}

describe("readAllPages", () => {
  it("1,000行より少なければ1回で終わる", async () => {
    const t = table(542);
    expect(await readAllPages(t.fetchPage)).toHaveLength(542);
    expect(t.calls).toEqual([[0, PAGE_ROWS - 1]]);
  });

  it("1,000行を超えても切れずに全部読む", async () => {
    const t = table(2500);
    const rows = await readAllPages(t.fetchPage);
    expect(rows).toHaveLength(2500);
    expect(rows[2499]).toBe(2499);
    expect(t.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("ちょうど1,000行のときは、もう1回確かめて終わる", async () => {
    const t = table(1000);
    expect(await readAllPages(t.fetchPage)).toHaveLength(1000);
    expect(t.calls).toHaveLength(2);
  });

  it("失敗したら、そのエラーを投げる", async () => {
    const error = new Error("network");
    await expect(
      readAllPages(async () => ({ data: null, error })),
    ).rejects.toBe(error);
  });
});
