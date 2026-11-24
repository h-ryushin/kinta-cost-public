import type { MenuCategory } from "./categories";
import { costRatio } from "./cost";
import { allRecipeCosts, costChanges, prepBatchCost, saleExcludingTax, type CostChange } from "./recipe-cost";
import { dayKey, dayLabel } from "./format";
import { baseUnitOf, toBaseQuantity } from "./units";
import type { Ingredient, PriceHistory, RecipeKind, SalePriceHistory, StoreData } from "./types";

/**
 * 「材料の値段が変わったことで、どのメニューがいくらになったか」を並べる（D-098）。
 * このアプリで一番知りたいことなので、画面（/changes）に残る一覧として出す。
 *
 * 出し方：価格の履歴1件ごとに、その材料だけを**変更前の値段に戻した場合**と、今の状態を比べる。
 * あとから見ても「この値上げの影響はいくらだったか」が分かる（今のレシピを基準にした影響）。
 */
export type PriceImpact = {
  history: PriceHistory;
  ingredientName: string;
  /** 1g・1ml・1個あたりの値段が、何倍になったか（1.1 なら 10% 値上げ） */
  rate: number | null;
  changes: CostChange[];
  /** 1回分の原価が変わった仕込み品（D-114） */
  prepChanges: PrepCostChange[];
};

/** 仕込み品の1回分の原価が、材料の値段の変更でいくらからいくらになったか（D-114） */
export type PrepCostChange = {
  id: string;
  name: string;
  secret: boolean;
  before: number;
  after: number;
  yieldQuantity: number;
  yieldUnit: string;
};

/** 材料の値段が変わる前（before）と後（after）で、1回分の原価が変わった仕込み品を、差の大きい順に */
export function prepCostChanges(data: StoreData, beforeIngredients: Ingredient[], afterIngredients: Ingredient[]): PrepCostChange[] {
  return data.preps
    .flatMap((prep) => {
      const before = prepBatchCost(beforeIngredients, prep);
      const after = prepBatchCost(afterIngredients, prep);
      if (before === after) return [];
      return [{ id: prep.id, name: prep.name, secret: prep.secret, before, after, yieldQuantity: prep.yieldQuantity, yieldUnit: prep.yieldUnit }];
    })
    .sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before));
}

/**
 * 値段が実際に変わった記録か。
 * 単位の言い換え（個 → 本）や、量り方の変更だけのときは、1g あたりの値段が変わらないので出さない。
 */
export function isRealPriceChange(history: PriceHistory): boolean {
  const rate = unitRate(history);
  return rate !== null && Math.abs(rate - 1) > 0.0005;
}

/** 分量の意味（基本単位）が変わる単位の変更か（缶 → g・個 → 本など。kg → g は変わらない。D-170・D-172） */
export function isUnitChange(history: PriceHistory): boolean {
  return baseUnitOf(history.oldUnit) !== baseUnitOf(history.newUnit);
}

/**
 * その材料だけを、履歴1件の変更の前と後の値段にした2つの世界（ほかの材料は今の値段）。
 * 「後」を今の値段にすると、そのあとの変更の分まで混ざるので、この変更の「後」の値段を使う（D-120）
 */
function beforeAndAfter(data: StoreData, history: PriceHistory): { before: Ingredient[]; after: Ingredient[] } {
  const withValues = (price: number, quantity: number, unit: PriceHistory["oldUnit"], yieldRate: number | null | undefined) =>
    data.ingredients.map((i) =>
      i.id === history.ingredientId
        ? { ...i, purchasePrice: price, purchaseQuantity: quantity, purchaseUnit: unit, yieldRate: yieldRate ?? i.yieldRate }
        : i,
    );
  return {
    before: withValues(history.oldPrice, history.oldQuantity, history.oldUnit, history.oldYieldRate),
    after: withValues(history.newPrice, history.newQuantity, history.newUnit, history.newYieldRate),
  };
}

/** 重さ・かさの単位（g・kg・ml・L）か。それ以外（個・本・袋など）は数える単位 */
function isMeasureUnit(unit: PriceHistory["oldUnit"]): boolean {
  const base = baseUnitOf(unit);
  return base === "g" || base === "ml";
}

/**
 * 単位の言い換えだけの記録か（D-071 のときの「個 → 本」のような付け替え。D-175）。
 * 値段も量も使える割合も同じで、数える単位どうしを付け替えただけのもの。
 */
export function isUnitRelabel(history: PriceHistory): boolean {
  return (
    isUnitChange(history) &&
    !isMeasureUnit(history.oldUnit) &&
    !isMeasureUnit(history.newUnit) &&
    history.oldPrice === history.newPrice &&
    history.oldQuantity === history.newQuantity &&
    (history.oldYieldRate ?? 100) === (history.newYieldRate ?? 100)
  );
}

/**
 * 「値段の変化」・ダッシュボード・材料の履歴に出す記録だけを選ぶ関数を作る。
 * - 1g・1ml・1個あたりの値段が変わったもの（D-098）
 * - 分量の意味が変わる単位の変更（缶 → g・1回 → 1,540g など）。使っていない材料でも出す（D-172・D-175）
 * 単位の言い換えだけ（個 → 本：D-071 のときの付け替え）は出さない（D-098 の追記）。
 */
export function isShownPriceChange(history: PriceHistory): boolean {
  return isRealPriceChange(history) || (isUnitChange(history) && !isUnitRelabel(history));
}

/** onlyDays を渡すと、その日（日本時間の YYYY-MM-DD）の変更だけを計算する。ページに出す分だけ計算するため */
export function priceImpacts(data: StoreData, limit = 30, onlyDays?: ReadonlySet<string>): PriceImpact[] {
  const histories = data.priceHistory
    .filter(isShownPriceChange)
    .slice(0, limit)
    .filter((h) => !onlyDays || onlyDays.has(dayKey(h.changedAt)));
  return histories.flatMap((history) => {
    const ingredient = data.ingredients.find((i) => i.id === history.ingredientId);
    if (!ingredient) return [];
    const { before, after } = beforeAndAfter(data, history);
    return [
      {
        history,
        ingredientName: ingredient.name,
        rate: unitRate(history),
        changes: costChanges(allRecipeCosts({ ...data, ingredients: before }), allRecipeCosts({ ...data, ingredients: after })),
        prepChanges: prepCostChanges(data, before, after),
      },
    ];
  });
}

/** 1日分の価格変更と、その日の変更ぜんぶでメニューがどう変わったか（D-107） */
export type DayImpact = {
  /** YYYY-MM-DD（日本時間） */
  day: string;
  /** 「今日（10月4日）」など */
  label: string;
  impacts: PriceImpact[];
  /** その日に変えた材料をまとめて前の値段に戻したときと、今との差 */
  changes: CostChange[];
  /** 同じく、1回分の原価が変わった仕込み品（D-114） */
  prepChanges: PrepCostChange[];
};

/**
 * 価格の変更を日ごとにまとめる（D-107）。「今日の変更で、どのメニューがいくらになったか」を見るため。
 * 同じ日に同じ材料を何度か変えたときは、その日の最初の変更の「前」の値段に戻して比べる。
 */
export function priceImpactsByDay(
  data: StoreData,
  limit = 30,
  now: Date = new Date(),
  onlyDays?: ReadonlySet<string>,
): DayImpact[] {
  const days = new Map<string, PriceImpact[]>();
  for (const impact of priceImpacts(data, limit, onlyDays)) {
    const key = dayKey(impact.history.changedAt);
    days.set(key, [...(days.get(key) ?? []), impact]);
  }
  return [...days.entries()].map(([day, impacts]) => {
    // 新しい順に並んでいるので、いちばん後ろがその日の最初の変更、いちばん前が最後の変更。
    // その日の最初の変更の直前と、最後の変更の直後の値段を比べる（そのあとの日の変更は混ぜない：D-120）
    const first = impacts.at(-1)!.history.changedAt;
    const last = impacts[0].history.changedAt;
    const before = ingredientsAt(data, first, true);
    const after = ingredientsAt(data, last, false);
    return {
      day,
      label: dayLabel(impacts[0].history.changedAt, now),
      impacts,
      changes: costChanges(allRecipeCosts({ ...data, ingredients: before }), allRecipeCosts({ ...data, ingredients: after })),
      prepChanges: prepCostChanges(data, before, after),
    };
  });
}

/**
 * ある時点の材料の値段（D-120）。価格の履歴から、その時点より後の最初の変更の「前」の値段に戻す。
 * inclusive が true なら、ちょうどその時点の変更も「まだ起きていない」とみなす（変更の直前の値段）。
 * 単位の言い換えだけの記録も含めて戻す（値段・量・単位をそのときの形にするため）。
 */
function ingredientsAt(data: StoreData, at: string, inclusive: boolean): Ingredient[] {
  return data.ingredients.map((i) => {
    // 履歴は新しい順なので、条件に合う最後のものが、その時点のあとの最初の変更
    const next = data.priceHistory.findLast(
      (h) => h.ingredientId === i.id && (inclusive ? h.changedAt >= at : h.changedAt > at),
    );
    return next
      ? {
          ...i,
          purchasePrice: next.oldPrice,
          purchaseQuantity: next.oldQuantity,
          purchaseUnit: next.oldUnit,
          // 使える割合が分からない古い履歴（D-126 より前）は、今の割合のままとみなす
          yieldRate: next.oldYieldRate ?? i.yieldRate,
        }
      : i;
  });
}

/**
 * 原価が変わったあとに、そのメニューの売価を変えたか（D-119・D-122）。
 * その日の最初の値段の変更より後の売価の履歴から、最初の「前」と最後の「後」を返す。
 * 変えていない（上げてから元に戻したときも含む）ときは null。
 */
export function salePriceChangeAfter(
  data: StoreData,
  recipeId: string,
  day: Pick<DayImpact, "day" | "impacts">,
): { from: number | null; to: number | null } | null {
  // impacts は新しい順なので、いちばん後ろがその日の最初の変更
  const since = day.impacts.at(-1)?.history.changedAt ?? `${day.day}T00:00:00+09:00`;
  // 売価の履歴も新しい順
  const sales = data.salePriceHistory.filter((h) => h.recipeId === recipeId && h.changedAt >= since);
  if (sales.length === 0) return null;
  const from = sales.at(-1)!.oldPrice;
  const to = sales[0].newPrice;
  return from === to ? null : { from, to };
}

/** 材料の値段が変わった日（日本時間の YYYY-MM-DD）を、新しい順に。ページ分けに使う（D-111） */
export function priceChangeDays(data: StoreData): string[] {
  return [...new Set(data.priceHistory.filter(isShownPriceChange).map((h) => dayKey(h.changedAt)))];
}

/** メニューの売価を変えた記録1件と、今の原価で見た原価率の前後（D-111） */
export type SalePriceChange = {
  history: SalePriceHistory;
  recipeId: string;
  name: string;
  kind: RecipeKind;
  category: MenuCategory;
  /** 今のレシピの原価（税抜）。売価を変えたときの原価ではない */
  cost: number;
  ratioBefore: number | null;
  ratioAfter: number | null;
};

/**
 * 売価の変更を新しい順に並べる（D-111）。
 * 原価率は今の原価で出す（売価を変えたことだけの効果が分かるように）。消えたメニューの記録は出さない。
 */
export function salePriceChanges(data: StoreData): SalePriceChange[] {
  const costs = new Map(allRecipeCosts(data).map((r) => [r.id, r.total]));
  return data.salePriceHistory.flatMap((history) => {
    const recipe = data.recipes.find((r) => r.id === history.recipeId);
    const cost = costs.get(history.recipeId);
    if (!recipe || cost === undefined) return [];
    return [
      {
        history,
        recipeId: recipe.id,
        name: recipe.name,
        kind: recipe.kind,
        category: recipe.category,
        cost,
        // 売価の履歴は税込（D-181）。原価率は税抜（切り上げ）で出す
        ratioBefore: costRatio(cost, saleExcludingTax(history.oldPrice, data.settings.saleTaxRate)),
        ratioAfter: costRatio(cost, saleExcludingTax(history.newPrice, data.settings.saleTaxRate)),
      },
    ];
  });
}

/** 日本時間の日ごとに分ける（並び順はそのまま）。見出しは「今日（10月4日）」など（D-107） */
export function groupByDay<T>(items: T[], at: (item: T) => string, now: Date = new Date()) {
  const groups: { day: string; label: string; items: T[] }[] = [];
  for (const item of items) {
    const day = dayKey(at(item));
    const last = groups.at(-1);
    if (last?.day === day) last.items.push(item);
    else groups.push({ day, label: dayLabel(at(item), now), items: [item] });
  }
  return groups;
}

/** 使える割合（サク取り・掃除）を変えた記録なら、その前と後（D-126）。変えていなければ null */
export function yieldRateChange(history: PriceHistory): { from: number; to: number } | null {
  const { oldYieldRate: from, newYieldRate: to } = history;
  return from != null && to != null && from !== to ? { from, to } : null;
}

/**
 * 単価（1g あたりなど）が何倍になったか。量や単位が変わっても比べられるようにする。
 * 1本 → 1kg のように基本単位が違う変更は比べられないので null（値上げ・値下げとして出さない）。
 */
export function unitRate(history: PriceHistory): number | null {
  if (baseUnitOf(history.oldUnit) !== baseUnitOf(history.newUnit)) return null;
  // 使える量で割る（使える割合が 80% なら、1kg 仕入れて使えるのは 0.8kg。D-100・D-126）。
  // 割合が分からない古い履歴は、前も後も同じとみなす
  const usable = (rate: number | null | undefined) => (rate ?? 100) / 100;
  const before = history.oldPrice / (toBaseQuantity(history.oldQuantity, history.oldUnit) * usable(history.oldYieldRate));
  const after = history.newPrice / (toBaseQuantity(history.newQuantity, history.newUnit) * usable(history.newYieldRate));
  if (!Number.isFinite(before) || before <= 0 || !Number.isFinite(after)) return null;
  return after / before;
}
