import { describe, expect, it } from "vitest";
import { paginate } from "./paginate";

describe("paginate（D-111）", () => {
  const items = [1, 2, 3, 4, 5, 6, 7];

  it("指定したページの分だけ返す", () => {
    expect(paginate(items, 2, 3)).toEqual({ items: [4, 5, 6], page: 2, pageCount: 3 });
    expect(paginate(items, 3, 3)).toEqual({ items: [7], page: 3, pageCount: 3 });
  });

  it("範囲の外のページは、端のページに寄せる", () => {
    expect(paginate(items, 9, 3).page).toBe(3);
    expect(paginate(items, 0, 3).page).toBe(1);
    expect(paginate(items, Number.NaN, 3).page).toBe(1);
  });

  it("空でも1ページとして扱う", () => {
    expect(paginate([], 1, 3)).toEqual({ items: [], page: 1, pageCount: 1 });
  });
});
