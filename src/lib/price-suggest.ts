import { COST_STEP } from "./cost";
import { ratioTargetOf, type RatioTarget } from "./ratio-target";
import type { RatioTargets } from "./types";

/**
 * 原価率を ratioPercent 以下にする、いちばん安い売値（税抜・1円単位で切り上げ。D-164）。
 * 原価が0円以下、または目安が0%以下のときは出せないので null。
 * 浮動小数点の誤差で1段上に切り上がらないよう、原価は0.1円単位（D-171）・%は100倍の整数にして比べる。
 */
export function minSalePriceFor(cost: number, ratioPercent: number): number | null {
  if (!(cost > 0) || !(ratioPercent > 0)) return null;
  // 売値 ≥ 原価 × 100 ÷ 原価率。原価率は小数第2位までを想定して100倍の整数にする
  const ratio100 = Math.round(ratioPercent * 100);
  const costTenths = Math.round(cost * COST_STEP);
  // 原価（0.1円）× 100 × 100 ÷ 原価率（100倍）÷ 10 を、整数のまま切り上げる
  const numerator = costTenths * 100 * 100;
  const denominator = ratio100 * COST_STEP;
  return Math.floor((numerator + denominator - 1) / denominator);
}

export type PriceSuggestion = { level: "good" | "normal"; ratio: number; price: number };

/**
 * 創作レシピの「売値の目安」（D-143）。分類の目安（D-102・D-110）から2つ出す。
 * - good：原価率が「良好」の線に収まる売値
 * - normal：「普通」の上限（これより安いと「高い」）に収まる売値
 */
export function suggestSalePrices(
  cost: number,
  category: string | null | undefined,
  targets?: RatioTargets,
): { target: RatioTarget; suggestions: PriceSuggestion[] } {
  const target = ratioTargetOf(category, targets);
  const suggestions: PriceSuggestion[] = [];
  const good = minSalePriceFor(cost, target.good);
  const normal = minSalePriceFor(cost, target.high);
  if (good !== null) suggestions.push({ level: "good", ratio: target.good, price: good });
  // 線が同じなどで同じ値段になるときは1つだけ出す
  if (normal !== null && normal !== good) suggestions.push({ level: "normal", ratio: target.high, price: normal });
  return { target, suggestions };
}
