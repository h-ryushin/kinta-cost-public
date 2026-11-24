/** 材料の種類。この順番で一覧に並べる（D-025）。魚介は使わないのでなくした（D-053） */
export const CATEGORIES = ["肉", "野菜・果物", "米・麺", "調味料・タレ", "ドリンク", "その他"] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * メニュー（創作レシピを含む）の分類。お店のハンディ（注文端末）のボタンに合わせる（D-045）。
 * 焼肉は部位ではなく味付け（塩・タレ）と量（特盛）で分ける。
 */
export const FOOD_CATEGORIES = [
  "焼肉（塩）",
  "焼肉（タレ）",
  "特盛（塩）",
  "特盛（タレ）",
  "おつまみ・刺身・薬味",
  "サラダ・焼野菜",
  "ご飯物",
  "スープ・クッパ",
  "デザート",
] as const;

export const DRINK_CATEGORIES = [
  "ビール・チューハイ",
  "ソフトドリンク",
  "ハイボール",
  "焼酎・日本酒",
  "梅酒・ワイン・マッコリ",
  "ボトル",
  // どれにも当てはまらないドリンク（D-052）
  "その他のドリンク",
] as const;

export const OTHER_MENU_CATEGORIES = ["コース", "テイクアウト", "飲み放題", "その他"] as const;

export const MENU_CATEGORIES = [...FOOD_CATEGORIES, ...DRINK_CATEGORIES, ...OTHER_MENU_CATEGORIES] as const;
export type MenuCategory = (typeof MENU_CATEGORIES)[number];
export type DrinkCategory = (typeof DRINK_CATEGORIES)[number];

/** 画面で分類をまとめて見せるときの区切り（選ぶボタンや一覧の見出し） */
export const MENU_CATEGORY_GROUPS: { label: string; categories: readonly MenuCategory[] }[] = [
  { label: "料理", categories: FOOD_CATEGORIES },
  { label: "ドリンク", categories: DRINK_CATEGORIES },
  { label: "そのほか", categories: OTHER_MENU_CATEGORIES },
];

export function isDrinkCategory(category: string): category is DrinkCategory {
  return DRINK_CATEGORIES.some((c) => c === category);
}
