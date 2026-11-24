/**
 * 数字の入力欄で使う処理（D-036）。
 * - sanitizeNumberInput：打った文字を、半角の数字だけにする
 * - acceptNumberInput：打った内容を受け付けるか決める（入力欄はこれを使う）
 * - validateNumberInput：入力欄の下に出すエラーメッセージを作る
 */

export type NumberKind = "integer" | "decimal";

/** 小数は第3位まで（D-009：量は 1/1000 単位で計算する） */
export const MAX_DECIMALS = 3;
const MAX_INTEGER_DIGITS = 8;

/**
 * 全角を半角にし、数字（と小数点）以外を取り除く。
 * 例：「１２０」→「120」、「80g」→「80」、「4,500」→「4500」、「０．５」→「0.5」
 */
export function sanitizeNumberInput(raw: string, kind: NumberKind): string {
  // NFKC で全角の数字・小数点（．）を半角にする。「。」は小数点の打ち間違いとみなす
  const normalized = raw.normalize("NFKC").replace(/。/g, ".");
  const withoutSeparators = normalized.replace(/[,、\s]/g, "");

  let value: string;
  if (kind === "integer") {
    value = withoutSeparators.replace(/\D/g, "");
  } else {
    const digitsAndDots = withoutSeparators.replace(/[^\d.]/g, "");
    const [intPart, ...rest] = digitsAndDots.split(".");
    if (rest.length === 0) {
      value = intPart;
    } else {
      // 2つ目以降の小数点は取り除き、小数は第3位までにする
      value = `${intPart === "" ? "0" : intPart}.${rest.join("").slice(0, MAX_DECIMALS)}`;
    }
  }

  // 先頭の余分な0を取る（「007」→「7」、「0.5」はそのまま）
  value = value.replace(/^0+(?=\d)/, "");
  // 桁が多すぎるものは切る
  const [intDigits, decimals] = value.split(".");
  if (intDigits.length > MAX_INTEGER_DIGITS) {
    value = intDigits.slice(0, MAX_INTEGER_DIGITS) + (decimals !== undefined ? `.${decimals}` : "");
  }

  return value;
}

export type NumberRule = {
  /** エラーメッセージで使う名前（例「仕入れ価格」） */
  label: string;
  kind: NumberKind;
  required?: boolean;
  /** true なら 0 を許さない（量など） */
  positive?: boolean;
  max: number;
};

/** 入力欄の下に出すエラーメッセージ。問題がなければ null。 */
export function validateNumberInput(value: string, rule: NumberRule): string | null {
  if (value.trim() === "") return rule.required ? `${rule.label}を入力してください` : null;
  const n = Number(value);
  if (!Number.isFinite(n)) return `${rule.label}は数字で入力してください`;
  if (rule.kind === "integer" && !Number.isInteger(n)) return `${rule.label}は1円単位で入力してください`;
  if (rule.positive && n <= 0) return `${rule.label}は0より大きくしてください`;
  if (n < 0) return `${rule.label}は0以上にしてください`;
  if (n > rule.max) return `${rule.label}は${rule.max.toLocaleString("ja-JP")}以下にしてください`;
  return null;
}

/** よく使う入力欄のルール。保存時の検証（types.ts の Zod）と同じ上限にする */
export const NUMBER_RULES = {
  purchasePrice: { label: "仕入れ価格", kind: "integer", required: true, max: 10_000_000 },
  purchaseQuantity: { label: "仕入れ量", kind: "decimal", required: true, positive: true, max: 1_000_000 },
  salePrice: { label: "売価", kind: "integer", required: false, max: 10_000_000 },
  usage: { label: "使用量", kind: "decimal", required: true, positive: true, max: 1_000_000 },
  yieldQuantity: { label: "出来上がり量", kind: "decimal", required: true, positive: true, max: 1_000_000 },
  tempCost: { label: "だいたいの金額", kind: "integer", required: true, max: 1_000_000 },
  yieldRate: { label: "使える割合", kind: "decimal", required: true, positive: true, max: 100 },
  taxRate: { label: "消費税", kind: "decimal", required: true, max: 100 },
  ratioTarget: { label: "原価率の目安", kind: "decimal", required: true, max: 100 },
} as const satisfies Record<string, NumberRule>;

/**
 * 打った内容を受け付けるかどうか（D-039）。数字以外は黙って取り除き、
 * 上限を超える数字になる打ち方は受け付けずに前の値のままにする。エラーは出さない。
 */
export function acceptNumberInput(raw: string, previous: string, rule: NumberRule): string {
  const value = sanitizeNumberInput(raw, rule.kind);
  if (value !== "" && Number(value) > rule.max) return previous;
  return value;
}
