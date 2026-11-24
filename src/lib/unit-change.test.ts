import { describe, expect, it } from "vitest";
import type { Prep, Recipe, StoreData } from "./types";
import { changesBaseUnit, ingredientUsages } from "./unit-change";

const t = "2026-10-01T00:00:00.000Z";
const prep = (name: string, items: Prep["items"]): Prep => ({
  id: name,
  name,
  secret: false,
  yieldQuantity: 400,
  yieldUnit: "g",
  items,
  memo: "",
  createdAt: t,
  updatedAt: t,
});
const recipe = (name: string, kind: Recipe["kind"], items: Recipe["items"]): Recipe => ({
  id: name,
  kind,
  name,
  category: "その他",
  salePrice: null,
  secret: false,
  items,
  memo: "",
  createdAt: t,
  updatedAt: t,
});

const data = {
  preps: [prep("味ネギ", [{ type: "ingredient", id: "pepper", quantity: 2 }])],
  recipes: [
    recipe("タン塩小", "menu", [
      { type: "ingredient", id: "tan", quantity: 60 },
      { type: "ingredient", id: "pepper", quantity: 0.5 },
    ]),
    recipe("試作", "draft", [{ type: "ingredient", id: "pepper", quantity: 1 }]),
    recipe("関係ない", "menu", [{ type: "ingredient", id: "tan", quantity: 100 }]),
  ],
} as unknown as StoreData;

describe("ingredientUsages（D-170）", () => {
  it("その材料を使っているメニュー・創作レシピ・仕込み品と、分量を出す", () => {
    expect(ingredientUsages(data, "pepper")).toEqual([
      { name: "味ネギ", kind: "仕込み品", quantity: 2 },
      { name: "タン塩小", kind: "メニュー", quantity: 0.5 },
      { name: "試作", kind: "創作レシピ", quantity: 1 },
    ]);
  });

  it("使っていなければ空", () => {
    expect(ingredientUsages(data, "nothing")).toEqual([]);
  });
});

describe("changesBaseUnit（D-170）", () => {
  it("缶 → g のように意味が変わる単位は true", () => {
    expect(changesBaseUnit("缶", "g")).toBe(true);
    expect(changesBaseUnit("kg", "L")).toBe(true);
  });

  it("kg → g・L → ml は分量の意味が変わらないので false", () => {
    expect(changesBaseUnit("kg", "g")).toBe(false);
    expect(changesBaseUnit("L", "ml")).toBe(false);
    expect(changesBaseUnit("缶", "缶")).toBe(false);
  });
});
