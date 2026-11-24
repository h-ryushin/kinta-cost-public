import { costYen, yen } from "./format";
import { calcRecipeCost } from "./recipe-cost";
import type { Ingredient, Prep, Recipe } from "./types";

type ShareData = { ingredients: Ingredient[]; preps: Prep[]; settings: { saleTaxRate: number } };
type ShareRecipe = Pick<Recipe, "kind" | "name" | "salePrice" | "memo" | "items">;

const KIND_LABEL = { menu: "メニュー", draft: "創作レシピ" } as const;

/**
 * 創作レシピを LINE などに貼れる文にする（D-059）。
 * スマホで読むので、1行を短くし、記号は日本語入力でそのまま打てるものだけを使う。
 */
export function recipeShareText(data: ShareData, recipe: ShareRecipe): string {
  const { lines, total, ratio, saleWithoutTax, profit } = calcRecipeCost(data, recipe.items, recipe.salePrice);
  const block: string[] = [`【${KIND_LABEL[recipe.kind]}】${recipe.name}`, "", `原価 ${costYen(total)}（税抜）`];

  // 売価は税込で持つ（D-181）。原価率と粗利は税抜（切り上げ）で出す
  if (recipe.salePrice !== null && saleWithoutTax !== null && ratio !== null && profit !== null) {
    block.push(`想定売価 ${yen(recipe.salePrice)}（税込）`);
    block.push(`（税抜 ${yen(saleWithoutTax)}・原価率 ${ratio.toFixed(1)}％／粗利 ${costYen(profit)}）`);
  }

  // 計算できた行だけ出す（材料を選んでいない行は貼っても意味がない）
  const priced = lines.map((line, i) => ({ line, item: recipe.items[i] })).filter(({ line }) => line.resolved && line.cost !== null);
  if (priced.length > 0) {
    block.push("", "材料（1人前）");
    for (const { line, item } of priced) {
      // 仮の材料（D-096）は量を持たないので、名前と金額だけ
      const amount = item?.type === "temp" ? "（仮）" : ` ${line.quantity}${line.resolved?.baseUnit}`;
      block.push(`・${line.resolved?.name}${amount} → ${costYen(line.cost ?? 0)}`);
    }
  }

  if (recipe.memo.trim() !== "") block.push("", "メモ", recipe.memo.trim());

  return block.join("\n");
}
