import { isDrinkCategory } from "./categories";
import { DEFAULT_RATIO_TARGETS, type RatioTargets } from "./types";

/**
 * 原価率の目安（D-102）。分類のまとまり（ドリンク／肉／サイド）ごとに違う数字にする。
 * 数字はオーナーが「設定」で変えられる（D-110）。渡さないときは初期値を使う。
 */
export type RatioKey = keyof RatioTargets;
export type RatioTarget = { key: RatioKey; label: string; good: number; high: number };

export const RATIO_KEYS: readonly RatioKey[] = ["drink", "meat", "side"];
export const RATIO_LABEL: Record<RatioKey, string> = { drink: "ドリンク", meat: "肉", side: "サイド" };

/** 焼肉（塩・タレ・特盛）は「肉」の目安。ハンディに合わせた分類（D-045）のうちの4つ */
const MEAT_CATEGORIES: readonly string[] = ["焼肉（塩）", "焼肉（タレ）", "特盛（塩）", "特盛（タレ）"];

/**
 * メニューの分類が、どのまとまりの目安を使うか。
 * 飲み放題はドリンクとして見る。分類が分からないときは、料理と同じ「サイド」にする。
 */
export function ratioKeyOf(category?: string | null): RatioKey {
  if (!category) return "side";
  if (isDrinkCategory(category) || category === "飲み放題") return "drink";
  if (MEAT_CATEGORIES.includes(category)) return "meat";
  return "side";
}

export function ratioTargetOf(category?: string | null, targets: RatioTargets = DEFAULT_RATIO_TARGETS): RatioTarget {
  const key = ratioKeyOf(category);
  return { key, label: RATIO_LABEL[key], ...targets[key] };
}

/** 目安を超えているか（ダッシュボードの「見直し候補」に使う） */
export function isOverTarget(ratio: number, category?: string | null, targets: RatioTargets = DEFAULT_RATIO_TARGETS): boolean {
  return ratio > ratioTargetOf(category, targets).high;
}
