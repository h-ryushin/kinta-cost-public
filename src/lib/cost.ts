import { toBaseQuantity, type PurchaseUnit } from "./units";

/**
 * 原価計算。浮動小数点の誤差で切り上げ結果がずれないよう、
 * 量を 1/1000 単位の整数に直し、BigInt の分数のまま計算してから切り上げる。
 * 詳細は docs/decisions.md の D-009 を参照。
 *
 * 原価は0.1円単位で出す（D-171。D-006 の「1円単位」を置き換え）。中では0.1円を1にした整数で計算し、
 * 円に直すのは最後だけにする（小数のまま足すと 0.1 + 0.2 = 0.30000000000000004 のような誤差が出るため）。
 */

/** 原価の最小の単位。1円 = 10（0.1円単位：D-171） */
export const COST_STEP = 10;

/** 円の原価（0.1円単位の小数）を、0.1円を1にした整数にする */
function toTenths(yen: number): number {
  return Math.round(yen * COST_STEP);
}

/** 0.1円単位の原価をいくつか足す。小数のまま足さず、整数にしてから足す */
export function addCosts(costs: number[]): number {
  return costs.reduce((sum, c) => sum + toTenths(c), 0) / COST_STEP;
}

/** 小数の量を 1/1000 単位の整数にする（例：2.5g → 2500）。小数第4位以下は四捨五入。 */
export function toMilli(quantity: number): bigint {
  return BigInt(Math.round(quantity * 1000));
}

export type CostSource = {
  purchasePrice: number; // 円（整数）
  purchaseQuantity: number;
  purchaseUnit: PurchaseUnit;
  /** 使える割合（%）。掃除などで減る分を引いたあとの割合（D-100）。入っていなければ100 */
  yieldRate?: number | null;
};

/** 実際に使える量（歩留まりを引いたあと）。1kg 仕入れて使えるのが80%なら 800g */
function usableQuantity(source: CostSource): number {
  const base = toBaseQuantity(source.purchaseQuantity, source.purchaseUnit);
  // 入力の途中（欄が空・0）でも計算が止まらないよう、使えない値は100%として扱う（D-128）。
  // 保存するときは Zod が 0より大きく100以下かを確かめる
  const rate = source.yieldRate != null && source.yieldRate > 0 ? source.yieldRate : 100;
  return base * (rate / 100);
}

/**
 * 材料1行の原価（円・0.1円単位）= 0.1円単位で切り上げ（仕入れ価格 × 使用量 ÷ 仕入れ量）（D-171）。
 * 仕入れ価格は、仕込み品の1回分の原価（0.1円単位）のこともあるので、0.1円を1にした整数で掛ける。
 */
export function lineCost(source: CostSource, usage: number): number {
  const denominator = toMilli(usableQuantity(source));
  if (denominator <= 0n) throw new Error("仕入れ量は0より大きくしてください");
  const numerator = BigInt(toTenths(source.purchasePrice)) * toMilli(usage);
  if (numerator <= 0n) return 0;
  return Number((numerator + denominator - 1n) / denominator) / COST_STEP;
}

/** メニュー原価 = 材料ごとに切り上げた原価の合計（合計では切り上げない） */
export function totalCost(lines: { source: CostSource; usage: number }[]): number {
  return addCosts(lines.map((l) => lineCost(l.source, l.usage)));
}

/** 単価（円／基本単位）。表示用なので小数のまま返す。 */
export function unitPrice(source: CostSource): number {
  return source.purchasePrice / usableQuantity(source);
}

/** 原価率（%）。売価がないときは null。 */
export function costRatio(cost: number, salePrice: number | null): number | null {
  if (!salePrice || salePrice <= 0) return null;
  return (cost / salePrice) * 100;
}
