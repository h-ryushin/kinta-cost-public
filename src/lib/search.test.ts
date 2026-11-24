import { describe, expect, it } from "vitest";
import { matchesSearch } from "./search";

describe("matchesSearch", () => {
  it("ひらがなでカタカナの材料が出る", () => {
    expect(matchesSearch("ねぎ", "ネギ")).toBe(true);
    expect(matchesSearch("ネギ", "白ネギ")).toBe(true);
    expect(matchesSearch("さわー", "氷彩サワー")).toBe(true);
  });

  it("伸ばし棒や中黒、かっこ、空白を無視する", () => {
    expect(matchesSearch("ウロン茶", "黒ウーロン茶1.4L")).toBe(true);
    expect(matchesSearch("牛小腸ホルモン", "牛小腸（ホルモン）")).toBe(true);
    expect(matchesSearch("調味料タレ", "調味料・タレ")).toBe(true);
  });

  it("全角と半角、大文字と小文字をそろえる", () => {
    expect(matchesSearch("ＡＵ牛", "AU牛フラップミート")).toBe(true);
    expect(matchesSearch("au", "AU牛フラップミート")).toBe(true);
    expect(matchesSearch("1.8l", "赤兎馬1.8L")).toBe(true);
  });

  it("空白で区切ると、すべてを含むものだけ出す", () => {
    expect(matchesSearch("赤 ワイン", "赤ワインボトル")).toBe(true);
    expect(matchesSearch("赤 ワイン", "白ワイン")).toBe(false);
  });

  it("対象を複数渡せる（材料名と仕入れ先）", () => {
    expect(matchesSearch("精肉", "牛タン", "〇〇精肉店")).toBe(true);
    expect(matchesSearch("精肉", "牛タン", "")).toBe(false);
  });

  it("空の検索は全部出す", () => {
    expect(matchesSearch("", "なんでも")).toBe(true);
    expect(matchesSearch("   ", "なんでも")).toBe(true);
  });

  it("関係ないものは出さない", () => {
    expect(matchesSearch("ビール", "ウーロン茶")).toBe(false);
  });
});
