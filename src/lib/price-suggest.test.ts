import { describe, expect, it } from "vitest";
import { minSalePriceFor, suggestSalePrices } from "./price-suggest";
import { DEFAULT_RATIO_TARGETS } from "./types";

describe("minSalePriceFor", () => {
  it("原価率を目安以下にする、1円単位のいちばん安い売値（D-164）", () => {
    // 369円 ÷ 0.28 = 1317.8… → 1318円
    expect(minSalePriceFor(369, 28)).toBe(1318);
    // 369円 ÷ 0.32 = 1153.1… → 1154円
    expect(minSalePriceFor(369, 32)).toBe(1154);
  });

  it("0.1円単位の原価でも、整数で切り上げる（D-171）", () => {
    // 367.5円 ÷ 28% = 1,312.5 → 1,313円
    expect(minSalePriceFor(367.5, 28)).toBe(1313);
    // 0.3円 ÷ 30% = 1円ちょうど（小数のまま割ると 1.0000000000000002 → 2円になりうる）
    expect(minSalePriceFor(0.3, 30)).toBe(1);
    // 28.7円 ÷ 28.7% = 100円ちょうど
    expect(minSalePriceFor(28.7, 28.7)).toBe(100);
  });

  it("ちょうど割り切れるときは切り上げない", () => {
    // 280円 ÷ 0.28 = 1000円ちょうど（浮動小数点だと 1000.0000001 になって 1001円にずれやすい）
    expect(minSalePriceFor(280, 28)).toBe(1000);
    expect(minSalePriceFor(200, 20)).toBe(1000);
  });

  it("出した売値なら、原価率は必ず目安以下になる", () => {
    for (const cost of [1, 7, 99, 369, 1234, 4999]) {
      for (const ratio of [20, 25, 28, 32, 33.3]) {
        const price = minSalePriceFor(cost, ratio)!;
        expect((cost / price) * 100).toBeLessThanOrEqual(ratio + 1e-9);
        // 1円安いと目安を超える（いちばん安い値段である）
        if (price > 1) expect((cost / (price - 1)) * 100).toBeGreaterThan(ratio);
      }
    }
  });

  it("原価0円・目安0%では出さない", () => {
    expect(minSalePriceFor(0, 28)).toBeNull();
    expect(minSalePriceFor(100, 0)).toBeNull();
  });
});

describe("suggestSalePrices", () => {
  it("分類の目安（肉は28%・32%）から、良好と普通の2つを出す", () => {
    const { target, suggestions } = suggestSalePrices(369, "焼肉（塩）", DEFAULT_RATIO_TARGETS);
    expect(target.key).toBe("meat");
    expect(suggestions).toEqual([
      { level: "good", ratio: 28, price: 1318 },
      { level: "normal", ratio: 32, price: 1154 },
    ]);
  });

  it("ドリンクはドリンクの目安（20%・25%）を使う", () => {
    const { suggestions } = suggestSalePrices(100, "ハイボール", DEFAULT_RATIO_TARGETS);
    expect(suggestions.map((s) => s.price)).toEqual([500, 400]);
  });

  it("原価が0円なら何も出さない", () => {
    expect(suggestSalePrices(0, "焼肉（塩）").suggestions).toEqual([]);
  });
});
