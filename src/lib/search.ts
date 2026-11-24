/**
 * 探すときの文字のゆらぎを吸収する（D-076）。
 * 厨房で急いで打つので、「ねぎ」でも「ネギ」でも、「ウロン」でも「ウーロン」でも出るようにする。
 *
 * やること：
 * - 全角と半角をそろえる（NFKC）。アルファベットは小文字にそろえる
 * - カタカナをひらがなにそろえる（ねぎ ⇄ ネギ）
 * - 伸ばし棒・中黒・かっこ・空白・読点は無視する（ウーロン ⇄ ウロン、国産（牛） ⇄ 国産牛）
 * - 空白で区切ると、全部を含むものを探す（「牛 タレ」で両方入っているものだけ）
 *
 * 漢字の読み（「ぎゅうたん」で「牛タン」）までは対応しない。読みの辞書が要るため。
 */
const KATAKANA = /[ァ-ヶ]/g;
const IGNORED = /[ー－‐–—・/／\s　（）()「」『』、。,.・]/g;

export function searchKey(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(KATAKANA, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(IGNORED, "");
}

/**
 * 探す文字が、対象のどれかに含まれるか。
 * 対象は複数渡せる（材料名と仕入れ先など）。空白で区切った言葉は、すべて含むものだけ返す。
 */
export function matchesSearch(query: string, ...targets: (string | null | undefined)[]): boolean {
  const terms = query
    .trim()
    .split(/[\s　]+/)
    .map(searchKey)
    .filter((t) => t !== "");
  if (terms.length === 0) return true;
  const haystack = targets.filter(Boolean).map((t) => searchKey(t as string));
  return terms.every((term) => haystack.some((h) => h.includes(term)));
}
