import { describe, expect, it } from "vitest";
import { acceptNumberInput, NUMBER_RULES, sanitizeNumberInput, validateNumberInput } from "./number-input";

const int = (raw: string) => sanitizeNumberInput(raw, "integer");
const dec = (raw: string) => sanitizeNumberInput(raw, "decimal");

describe("sanitizeNumberInput", () => {
  it("全角の数字・小数点を半角にする", () => {
    expect(int("４５００")).toBe("4500");
    expect(dec("０．５")).toBe("0.5");
    expect(dec("１２。５")).toBe("12.5");
  });

  it("桁区切りと空白は取り除く", () => {
    expect(int("4,500")).toBe("4500");
    expect(int("４，５００")).toBe("4500");
    expect(int(" 120 ")).toBe("120");
  });

  it("単位などの文字は入らない", () => {
    expect(dec("80g")).toBe("80");
    expect(dec("１ｍｌ")).toBe("1");
    expect(int("500円")).toBe("500");
    expect(int("abc")).toBe("");
  });

  it("整数の欄には小数点が入らない", () => {
    expect(int("12.5")).toBe("125");
  });

  it("小数点は1つだけ、小数は第3位まで", () => {
    expect(dec("1.2.3")).toBe("1.23");
    expect(dec("0.12345")).toBe("0.123");
    expect(dec(".5")).toBe("0.5");
    expect(dec("2.")).toBe("2.");
  });

  it("先頭の余分な0を取る", () => {
    expect(int("007")).toBe("7");
    expect(int("0")).toBe("0");
    expect(dec("00.5")).toBe("0.5");
  });

  it("桁が多すぎるものは切る", () => {
    expect(int("1234567890")).toBe("12345678");
  });
});

describe("validateNumberInput", () => {
  it("必須の欄が空ならエラー", () => {
    expect(validateNumberInput("", NUMBER_RULES.purchasePrice)).toBe("仕入れ価格を入力してください");
    expect(validateNumberInput("", NUMBER_RULES.salePrice)).toBeNull();
  });

  it("量は0より大きくする", () => {
    expect(validateNumberInput("0", NUMBER_RULES.usage)).toBe("使用量は0より大きくしてください");
    expect(validateNumberInput("0.001", NUMBER_RULES.usage)).toBeNull();
  });

  it("価格は0円でもよい", () => {
    expect(validateNumberInput("0", NUMBER_RULES.purchasePrice)).toBeNull();
  });

  it("上限を超えたらエラー", () => {
    expect(validateNumberInput("10000001", NUMBER_RULES.salePrice)).toBe("売価は10,000,000以下にしてください");
  });

  it("小数点で終わっていても数として読める", () => {
    expect(validateNumberInput("2.", NUMBER_RULES.usage)).toBeNull();
  });
});

describe("acceptNumberInput", () => {
  it("数字以外は黙って取り除く", () => {
    expect(acceptNumberInput("12ab", "12", NUMBER_RULES.purchasePrice)).toBe("12");
    expect(acceptNumberInput("８０ｇ", "", NUMBER_RULES.usage)).toBe("80");
  });

  it("上限を超える打ち方は受け付けず、前の値のまま", () => {
    expect(acceptNumberInput("100000000", "10000000", NUMBER_RULES.purchasePrice)).toBe("10000000");
    expect(acceptNumberInput("10000000", "1000000", NUMBER_RULES.purchasePrice)).toBe("10000000");
  });

  it("消すのは受け付ける", () => {
    expect(acceptNumberInput("", "120", NUMBER_RULES.salePrice)).toBe("");
  });
});
