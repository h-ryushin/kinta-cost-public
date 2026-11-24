import { addCosts, costRatio, lineCost, type CostSource } from "./cost";
import { withoutTax } from "./format";
import type { Ingredient, ItemType, Prep, RecipeItem } from "./types";
import { baseUnitOf, type BaseUnit } from "./units";

type CostData = { ingredients: Ingredient[]; preps: Prep[] };
/** 売価から原価率を出すときは、売価の税率も要る（売価は税込で持つ：D-181） */
type SaleCostData = CostData & { settings: { saleTaxRate: number } };

/** レシピの1行が指す材料・仕込み品を、原価計算に使える形にしたもの */
export type ResolvedItem = {
  name: string;
  baseUnit: BaseUnit;
  source: CostSource;
};

export type CostLine = {
  resolved: ResolvedItem | undefined;
  quantity: number;
  /** 計算できないとき（未選択・使用量が不正）は null */
  cost: number | null;
};

function calcLines(data: CostData, items: RecipeItem[]): CostLine[] {
  return items.map((item) => {
    // 鍵がかかった秘密の中身（D-148）は、オーナーが計算した原価をそのまま1行の原価にする
    if (item.type === "sealed") {
      return {
        resolved: { name: "（秘密の中身）", baseUnit: "個" as BaseUnit, source: tempSource(item.cost) },
        quantity: 1,
        cost: item.cost,
      };
    }
    // 仮の材料（D-096）は、入れた金額をそのまま1行の原価にする
    if (item.type === "temp") {
      const cost = Number.isFinite(item.cost) ? item.cost : null;
      return {
        resolved: { name: item.name, baseUnit: "個" as BaseUnit, source: tempSource(item.cost) },
        quantity: 1,
        cost,
      };
    }
    const resolved = resolveItem(data, item);
    const valid = resolved && Number.isFinite(item.quantity) && item.quantity >= 0;
    return { resolved, quantity: item.quantity, cost: valid ? lineCost(resolved.source, item.quantity) : null };
  });
}

/** 仮の材料は「1個でその金額の材料」として扱う */
function tempSource(cost: number): CostSource {
  return { purchasePrice: Number.isFinite(cost) ? cost : 0, purchaseQuantity: 1, purchaseUnit: "個" };
}

/**
 * 仕込み品1回分の原価（円・0.1円単位：D-171）。材料ごとに切り上げて合計する（D-019）。
 * 仕込み品の中に仕込み品は入れられない（D-020）ので、材料だけを見る。
 */
export function prepBatchCost(ingredients: Ingredient[], prep: Pick<Prep, "items">): number {
  const lines = calcLines({ ingredients, preps: [] }, prep.items);
  return addCosts(lines.map((l) => l.cost ?? 0));
}

/** 仕込み品を「1回分の原価で、出来上がり量を仕入れた材料」とみなす */
export function prepCostSource(ingredients: Ingredient[], prep: Prep): CostSource {
  return {
    purchasePrice: prepBatchCost(ingredients, prep),
    purchaseQuantity: prep.yieldQuantity,
    purchaseUnit: prep.yieldUnit,
  };
}

export function resolveItem(data: CostData, item: { type: ItemType; id?: string }): ResolvedItem | undefined {
  if (item.type === "temp") return undefined;
  if (item.type === "ingredient") {
    const ingredient = data.ingredients.find((i) => i.id === item.id);
    if (!ingredient) return undefined;
    return { name: ingredient.name, baseUnit: baseUnitOf(ingredient.purchaseUnit), source: ingredient };
  }
  const prep = data.preps.find((p) => p.id === item.id);
  if (!prep) return undefined;
  return { name: prep.name, baseUnit: baseUnitOf(prep.yieldUnit), source: prepCostSource(data.ingredients, prep) };
}

/** メニュー・創作レシピごとの原価と原価率（変化を調べるのに使う：D-097） */
export type RecipeCostRow = { id: string; name: string; kind: string; category: string; total: number; ratio: number | null };

export function allRecipeCosts(data: SaleCostData & {
  recipes: { id: string; name: string; kind: string; category: string; items: RecipeItem[]; salePrice: number | null }[];
}): RecipeCostRow[] {
  return data.recipes.map((r) => {
    const { total, ratio } = calcRecipeCost(data, r.items, r.salePrice);
    return { id: r.id, name: r.name, kind: r.kind, category: r.category, total, ratio };
  });
}

/** 材料を変えたことで原価が変わったものを並べる（変わっていないものは出さない） */
export type CostChange = { id: string; name: string; kind: string; category: string; before: number; after: number; ratioAfter: number | null };

export function costChanges(before: RecipeCostRow[], after: RecipeCostRow[]): CostChange[] {
  const old = new Map(before.map((r) => [r.id, r]));
  return after
    .flatMap((row) => {
      const previous = old.get(row.id);
      if (!previous || previous.total === row.total) return [];
      return [{ id: row.id, name: row.name, kind: row.kind, category: row.category, before: previous.total, after: row.total, ratioAfter: row.ratio }];
    })
    .sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before));
}

/**
 * レシピの材料行ごとの原価と合計。入力途中の行があっても計算できる分だけ出す。
 * salePrice は税込（メニュー表の値段。D-181）。原価率と粗利は、税込 ÷（1＋税率）を切り上げた税抜で出す（D-179）。
 */
export function calcRecipeCost(data: SaleCostData, items: RecipeItem[], salePrice: number | null) {
  const lines = calcLines(data, items);
  const total = addCosts(lines.map((l) => l.cost ?? 0));
  const saleWithoutTax = saleExcludingTax(salePrice, data.settings.saleTaxRate);
  return {
    lines,
    total,
    ratio: costRatio(total, saleWithoutTax),
    /** 売価（税抜）。売価がないときは null */
    saleWithoutTax,
    /** 粗利（税抜の売価 − 原価）。売価がないときは null */
    profit: saleWithoutTax === null ? null : addCosts([saleWithoutTax, -total]),
  };
}

/** 税込の売価から税抜（切り上げ）を出す。空欄・入力途中の値はそのまま返す（D-179・D-181） */
export function saleExcludingTax(salePrice: number | null, saleTaxRate: number): number | null {
  if (salePrice === null || !Number.isFinite(salePrice)) return salePrice;
  return withoutTax(salePrice, saleTaxRate);
}
