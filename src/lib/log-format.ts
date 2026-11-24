/**
 * 操作ログの表示（データベースの action を日本語にし、詳しい中身を1行の文にする）。docs/database.md 9章。
 * store.ts から分けて、テストできるようにした（D-132）。
 */

const LOG_ACTIONS: Record<string, string> = {
  "auth.login": "ログイン",
  "auth.device_verified": "ほかの端末で入った（iPhone の数字）",
  "auth.recovery_created": "復旧コードを作った",
  "auth.recovery_used": "復旧コードで入った",
  "ingredient.created": "材料を追加",
  "ingredient.updated": "材料を変更",
  "ingredient.archived": "材料を使わない状態に",
  "ingredient.deleted": "材料を削除",
  "ingredient.price_changed": "価格を変更",
  "prep.created": "仕込み品を作成",
  "prep.updated": "仕込み品を変更",
  "prep.deleted": "仕込み品を削除",
  "recipe.created": "レシピを作成",
  "recipe.updated": "レシピを変更",
  "recipe.deleted": "レシピを削除",
  "recipe.promoted": "創作レシピをメニューに登録",
  "user.created": "利用者を追加",
  "user.updated": "利用者を変更",
  "user.deleted": "利用者を削除",
};

export function logAction(action: string): string {
  return LOG_ACTIONS[action] ?? action;
}

export function logDetail(action: string, detail: Record<string, unknown>): string {
  const name = typeof detail.name === "string" ? detail.name : "";
  if (action !== "ingredient.price_changed") return name;
  const side = (value: unknown) => {
    if (typeof value !== "object" || value === null) return "";
    const v = value as { price?: number; quantity?: number | string; unit?: string };
    return `${Number(v.price ?? 0).toLocaleString()}円 / ${Number(v.quantity ?? 0)}${v.unit ?? ""}`;
  };
  return `${name}：${side(detail.old)} → ${side(detail.new)}`;
}
