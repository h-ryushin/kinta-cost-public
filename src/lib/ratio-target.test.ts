import { describe, expect, it } from "vitest";
import { isOverTarget, ratioTargetOf } from "./ratio-target";

describe("原価率の目安（D-102）", () => {
  it("ドリンクは 20%以下が良好、25%を超えると高い", () => {
    const target = ratioTargetOf("ビール・チューハイ");
    expect(target).toMatchObject({ key: "drink", good: 20, high: 25 });
    expect(isOverTarget(24.9, "ビール・チューハイ")).toBe(false);
    expect(isOverTarget(25.1, "ビール・チューハイ")).toBe(true);
  });

  it("焼肉・特盛は「肉」の目安（28%／32%）", () => {
    for (const category of ["焼肉（塩）", "焼肉（タレ）", "特盛（塩）", "特盛（タレ）"]) {
      expect(ratioTargetOf(category)).toMatchObject({ key: "meat", good: 28, high: 32 });
    }
    expect(isOverTarget(32, "焼肉（塩）")).toBe(false);
    expect(isOverTarget(32.5, "焼肉（塩）")).toBe(true);
  });

  it("ほかの料理は「サイド」の目安（28%／32%）", () => {
    expect(ratioTargetOf("サラダ・焼野菜")).toMatchObject({ key: "side", good: 28, high: 32 });
    expect(ratioTargetOf("ご飯物").key).toBe("side");
    expect(ratioTargetOf("デザート").key).toBe("side");
  });

  it("飲み放題はドリンクとして見る", () => {
    expect(ratioTargetOf("飲み放題").key).toBe("drink");
  });

  it("分類が分からないときはサイドの目安を使う", () => {
    expect(ratioTargetOf(null).key).toBe("side");
    expect(ratioTargetOf(undefined).key).toBe("side");
    expect(ratioTargetOf("知らない分類").key).toBe("side");
  });
});
