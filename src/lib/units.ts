/**
 * 仕入れの単位（D-071）。
 * 重さ・かさ（g・kg・ml・L）は基本単位（g・ml）に直して計算する。
 * 数える単位（個・本・袋…）は、それぞれがそのまま基本単位。棚卸し表の摘要に合わせている。
 */
export const PURCHASE_UNITS = ["g", "kg", "ml", "L", "個", "本", "袋", "缶", "パック", "束", "食", "回"] as const;
export type PurchaseUnit = (typeof PURCHASE_UNITS)[number];

export type BaseUnit = "g" | "ml" | "個" | "本" | "袋" | "缶" | "パック" | "束" | "食" | "回";

const UNIT_TABLE: Record<PurchaseUnit, { base: BaseUnit; factor: number }> = {
  g: { base: "g", factor: 1 },
  kg: { base: "g", factor: 1000 },
  ml: { base: "ml", factor: 1 },
  L: { base: "ml", factor: 1000 },
  個: { base: "個", factor: 1 },
  本: { base: "本", factor: 1 },
  袋: { base: "袋", factor: 1 },
  缶: { base: "缶", factor: 1 },
  パック: { base: "パック", factor: 1 },
  束: { base: "束", factor: 1 },
  食: { base: "食", factor: 1 },
  回: { base: "回", factor: 1 },
};

/** 基本単位。ml で仕入れたものは ml のまま量る（比重で g に直すのはやめた：D-163） */
export function baseUnitOf(unit: PurchaseUnit): BaseUnit {
  return UNIT_TABLE[unit].base;
}

/** 仕入れ量を基本単位の量に直す（例：1.5kg → 1500g） */
export function toBaseQuantity(quantity: number, unit: PurchaseUnit): number {
  return quantity * UNIT_TABLE[unit].factor;
}

/** 基本単位が同じ仕入れ単位の一覧（使用中の材料で単位を変えるときに使う） */
export function unitsWithSameBase(unit: PurchaseUnit): PurchaseUnit[] {
  const base = baseUnitOf(unit);
  return PURCHASE_UNITS.filter((u) => baseUnitOf(u) === base);
}
