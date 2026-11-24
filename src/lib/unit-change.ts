import type { StoreData } from "./types";
import { baseUnitOf, type PurchaseUnit } from "./units";

/**
 * 使っている材料の単位を、意味が変わる単位（缶 → g など）に変えるときに見せる一覧（D-170）。
 * 分量の数字はそのままで単位だけが変わるので、どのメニュー・仕込み品の分量がどう読み変わるかを出す。
 */
export type UnitChangeUsage = { name: string; kind: "メニュー" | "創作レシピ" | "仕込み品"; quantity: number };

export function ingredientUsages(data: StoreData, ingredientId: string): UnitChangeUsage[] {
  const usages: UnitChangeUsage[] = [];
  for (const prep of data.preps) {
    for (const item of prep.items) {
      if (item.type === "ingredient" && item.id === ingredientId) usages.push({ name: prep.name, kind: "仕込み品", quantity: item.quantity });
    }
  }
  for (const recipe of data.recipes) {
    for (const item of recipe.items) {
      if (item.type === "ingredient" && item.id === ingredientId) {
        usages.push({ name: recipe.name, kind: recipe.kind === "menu" ? "メニュー" : "創作レシピ", quantity: item.quantity });
      }
    }
  }
  return usages;
}

/** 単位を変えると、分量の意味（基本単位）が変わるか。kg → g・L → ml は変わらない */
export function changesBaseUnit(from: PurchaseUnit, to: PurchaseUnit): boolean {
  return baseUnitOf(from) !== baseUnitOf(to);
}
