import { describe, expect, it } from "vitest";
import { CATEGORIES, DRINK_CATEGORIES, isDrinkCategory, MENU_CATEGORIES, MENU_CATEGORY_GROUPS } from "./categories";

describe("分類の一覧（D-025・D-045・D-052・D-053）", () => {
  it("材料の種類に「魚介」はない", () => {
    expect(CATEGORIES).not.toContain("魚介");
  });

  it("メニューの分類に重なりがない", () => {
    expect(new Set(MENU_CATEGORIES).size).toBe(MENU_CATEGORIES.length);
  });

  it("まとまり（料理・ドリンク・そのほか）を合わせると、すべての分類になる", () => {
    const grouped = MENU_CATEGORY_GROUPS.flatMap((g) => g.categories);
    expect([...grouped].sort()).toEqual([...MENU_CATEGORIES].sort());
  });

  it("キッズドリンクはなく、その他のドリンクがある（D-052）", () => {
    expect(DRINK_CATEGORIES).not.toContain("キッズドリンク");
    expect(DRINK_CATEGORIES).toContain("その他のドリンク");
  });
});

describe("isDrinkCategory", () => {
  it("ドリンクの分類だけ true", () => {
    expect(isDrinkCategory("ハイボール")).toBe(true);
    expect(isDrinkCategory("その他のドリンク")).toBe(true);
    expect(isDrinkCategory("焼肉（塩）")).toBe(false);
    expect(isDrinkCategory("飲み放題")).toBe(false);
    expect(isDrinkCategory("ドリンク")).toBe(false);
  });
});
