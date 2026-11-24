import type { PriceHistory } from "./types";

/**
 * 秘密のものの原価が古くなっていないか（D-154）。
 * 秘密の中身は暗号化してあり、オーナーが鍵を開けたときにしか原価を計算し直せない（D-148）。
 * どの材料を使っているかは分からないので、「最後に計算し直したあとに、どれかの材料の値段が変わったか」で見る。
 */
type SecretItem = { secret: boolean; sealed?: boolean; secretCostAt?: string | null };

export function isSecretCostStale(item: SecretItem, priceHistory: Pick<PriceHistory, "changedAt">[]): boolean {
  // 鍵を開けて中身が見えているものは、その場で計算しているので古くない
  if (!item.secret || !item.sealed) return false;
  if (!item.secretCostAt) return true;
  const calculatedAt = Date.parse(item.secretCostAt);
  return priceHistory.some((h) => Date.parse(h.changedAt) > calculatedAt);
}

/** 原価が古くなっている秘密のメニュー・仕込み品 */
export function staleSecrets<T extends SecretItem & { id: string; name: string }>(
  items: T[],
  priceHistory: Pick<PriceHistory, "changedAt">[],
): T[] {
  return items.filter((i) => isSecretCostStale(i, priceHistory));
}
