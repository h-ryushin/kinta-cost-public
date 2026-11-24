export function yen(value: number): string {
  return `${value.toLocaleString("ja-JP")}円`;
}

/** 原価・粗利・原価の差（0.1円単位：D-171）。いつも小数第1位まで出す（288.0円） */
export function costYen(value: number): string {
  return `${value.toLocaleString("ja-JP", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}円`;
}

/** 単価など小数を含む金額。小数第4位までで、末尾の0は付けない。 */
export function yenDecimal(value: number): string {
  return `${value.toLocaleString("ja-JP", { maximumFractionDigits: 4 })}円`;
}

/**
 * 税抜の金額に消費税を足した額（1円未満は切り捨て。レジの出し方に合わせる）。D-101・D-161
 * 小数のまま掛けてから切り捨てると、誤差で1円少なく出ることがある（15%で100円が114円になる）ので、
 * 税率を0.1%単位の整数にして整数で計算する（D-009 と同じ考え）。
 */
export function withTax(amountWithoutTax: number, taxRate: number): number {
  // 入力の途中（空欄・小数）でも止まらないよう、整数で計算できないときは小数のまま出す
  if (!Number.isInteger(amountWithoutTax) || !Number.isFinite(taxRate)) return Math.floor(amountWithoutTax * (1 + taxRate / 100));
  const rate = BigInt(Math.round(1000 + taxRate * 10));
  return Number((BigInt(amountWithoutTax) * rate) / 1000n);
}

/**
 * 税込の金額から税抜を出す（1円未満は切り上げ）。D-179
 * 売価は税込で入れ、税抜（整数）にして持つ。切り上げにすると、もう一度 withTax で税込に戻したときに
 * 入れた値段とそろうことが多い（四捨五入だと 600円 → 545円 → 599円 のように1円少なく出やすい）。
 * withTax と同じく、税率を0.1%単位の整数にして整数で計算する。
 */
export function withoutTax(amountWithTax: number, taxRate: number): number {
  if (!Number.isInteger(amountWithTax) || !Number.isFinite(taxRate)) return Math.ceil(amountWithTax / (1 + taxRate / 100));
  const rate = BigInt(Math.round(1000 + taxRate * 10));
  const scaled = BigInt(amountWithTax) * 1000n;
  return Number((scaled + rate - 1n) / rate);
}

/** 「税込 1,380円」の形（税込の金額を添えるところはすべてこれで出す） */
export function taxIncluded(amountWithoutTax: number, taxRate: number): string {
  return `税込 ${yen(withTax(amountWithoutTax, taxRate))}`;
}

/** 「税抜 1,255円」の形（売価は税込を大きく出し、税抜を小さく添える：D-180） */
export function taxExcluded(amountWithoutTax: number): string {
  return `税抜 ${yen(amountWithoutTax)}`;
}

/** 「1,255円（税込1,380円）」の形 */
export function yenWithTax(amountWithoutTax: number, taxRate: number): string {
  return `${yen(amountWithoutTax)}（税込${yen(withTax(amountWithoutTax, taxRate))}）`;
}

export function percent(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

// 日付は日本時間で見る（お店の「今日」に合わせる。端末のタイムゾーンに左右されないように）
const TIME_ZONE = "Asia/Tokyo";

/** 日ごとにまとめるときの鍵（YYYY-MM-DD、日本時間） */
export function dayKey(iso: string | Date): string {
  return new Date(iso).toLocaleDateString("sv-SE", { timeZone: TIME_ZONE });
}

/** 「今日（10月4日）」「昨日（10月3日）」「10月2日（木）」の形。D-107 */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const monthDay = date.toLocaleDateString("ja-JP", { timeZone: TIME_ZONE, month: "long", day: "numeric" });
  const key = dayKey(date);
  if (key === dayKey(now)) return `今日（${monthDay}）`;
  if (key === dayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000))) return `昨日（${monthDay}）`;
  const weekday = date.toLocaleDateString("ja-JP", { timeZone: TIME_ZONE, weekday: "short" });
  const sameYear = date.toLocaleDateString("ja-JP", { timeZone: TIME_ZONE, year: "numeric" }) ===
    now.toLocaleDateString("ja-JP", { timeZone: TIME_ZONE, year: "numeric" });
  const year = sameYear ? "" : date.toLocaleDateString("ja-JP", { timeZone: TIME_ZONE, year: "numeric" });
  return `${year}${monthDay}（${weekday}）`;
}

/** 「14:05」の形（日本時間） */
export function timeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString("ja-JP", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" });
}

/** 「2026/10/04 14:05」の形（日本時間。端末のタイムゾーンに左右されないように：D-107） */
export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 入力欄の文字列を数値にする。空欄や数値として読めないときは NaN（Zod でエラーにする）。
 * 厨房のスマホでは日本語入力のまま打つことが多いので、次も受け付ける（D-026）。
 * - 全角の数字・記号（「１２．５」）
 * - 桁区切り（「4,500」）
 * - 後ろに付けた単位（「80g」「1L」「500円」）
 * - 分数（「1/2」）
 */
export function toNumber(value: string): number {
  const text = value
    .normalize("NFKC")
    .replace(/[,\s]/g, "")
    .replace(/(円|kg|g|ml|l|個)$/i, "");
  if (text === "") return NaN;
  const fraction = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(text);
  if (fraction) return Number(fraction[2]) === 0 ? NaN : Number(fraction[1]) / Number(fraction[2]);
  return Number(text);
}
