import { describe, expect, it } from "vitest";
import { costRatio, lineCost, totalCost, unitPrice, type CostSource } from "./cost";

const gyutan: CostSource = { purchasePrice: 4500, purchaseQuantity: 1, purchaseUnit: "kg" };
const negi: CostSource = { purchasePrice: 720, purchaseQuantity: 1, purchaseUnit: "kg" };
const shio: CostSource = { purchasePrice: 150, purchaseQuantity: 1, purchaseUnit: "kg" };

describe("lineCost", () => {
  it("要件定義書 3.6 の計算例を、0.1円単位で切り上げる（D-171）", () => {
    expect(lineCost(gyutan, 80)).toBe(360);
    // 720円/kg × 10g = 7.2円（1円単位のころは 8円）
    expect(lineCost(negi, 10)).toBe(7.2);
    // 150円/kg × 2g = 0.3円（1円単位のころは 1円）
    expect(lineCost(shio, 2)).toBe(0.3);
  });

  it("0.1円に満たない端数は、0.1円単位で切り上げる（D-171）", () => {
    // 1,234円/420g × 0.5g = 1.469…円 → 1.5円
    expect(lineCost({ purchasePrice: 1234, purchaseQuantity: 420, purchaseUnit: "g" }, 0.5)).toBe(1.5);
  });

  it("仕入れ価格が0.1円単位（仕込み品の1回分の原価）でも計算できる", () => {
    // 1回分 367.5円・400g の仕込み品を 30g → 27.5625円 → 27.6円
    expect(lineCost({ purchasePrice: 367.5, purchaseQuantity: 400, purchaseUnit: "g" }, 30)).toBe(27.6);
  });

  it("割り切れるときは切り上げない", () => {
    expect(lineCost({ purchasePrice: 1000, purchaseQuantity: 100, purchaseUnit: "g" }, 30)).toBe(300);
  });

  it("浮動小数点だと誤差が出る値でも正しく切り上げる", () => {
    // 0.1 * 3 = 0.30000000000000004 になるケース：単価0.1円/g × 3g は 0.3円ちょうど
    expect(lineCost({ purchasePrice: 100, purchaseQuantity: 1, purchaseUnit: "kg" }, 3)).toBe(0.3);
    // 単価1.1円/ml × 100ml = 110円ちょうど（float では 110.00000000000001）
    expect(lineCost({ purchasePrice: 1100, purchaseQuantity: 1, purchaseUnit: "L" }, 100)).toBe(110);
  });

  it("小数の使用量と仕入れ量を扱える", () => {
    // 1.5kg で 3000円 → 2円/g、2.5g → 5円
    expect(lineCost({ purchasePrice: 3000, purchaseQuantity: 1.5, purchaseUnit: "kg" }, 2.5)).toBe(5);
  });

  it("個単位を扱える", () => {
    expect(lineCost({ purchasePrice: 300, purchaseQuantity: 10, purchaseUnit: "個" }, 1)).toBe(30);
    // 100円 ÷ 3個 = 33.33…円 → 33.4円
    expect(lineCost({ purchasePrice: 100, purchaseQuantity: 3, purchaseUnit: "個" }, 1)).toBe(33.4);
  });

  it("使用量0は0円", () => {
    expect(lineCost(gyutan, 0)).toBe(0);
  });

  it("仕入れ量0はエラー", () => {
    expect(() => lineCost({ purchasePrice: 100, purchaseQuantity: 0, purchaseUnit: "g" }, 1)).toThrow();
  });
});

describe("totalCost", () => {
  it("材料ごとに0.1円単位で切り上げてから合計する（要件定義書 3.6 の例は 369円 → 367.5円：D-171）", () => {
    const total = totalCost([
      { source: gyutan, usage: 80 },
      { source: negi, usage: 10 },
      { source: shio, usage: 2 },
    ]);
    expect(total).toBe(367.5);
  });

  it("0.1円単位の原価を足しても、小数の誤差が出ない", () => {
    // 0.1 + 0.2 は小数のまま足すと 0.30000000000000004 になる
    const tenth: CostSource = { purchasePrice: 100, purchaseQuantity: 1, purchaseUnit: "kg" };
    expect(totalCost([{ source: tenth, usage: 1 }, { source: tenth, usage: 2 }])).toBe(0.3);
  });
});

describe("unitPrice / costRatio", () => {
  it("数える単位（本・回）はそのまま1つあたりで計算する（D-071）", () => {
    // 1本 2,460円のウイスキーを 0.5本 使う → 1,230円
    expect(lineCost({ purchasePrice: 2460, purchaseQuantity: 1, purchaseUnit: "本" }, 0.5)).toBe(1230);
    // 1回分 687円の塩ダレを 1回 使う
    expect(lineCost({ purchasePrice: 687, purchaseQuantity: 1, purchaseUnit: "回" }, 1)).toBe(687);
    // 5食入り 275円のうどんを 1食 使う → 55円
    expect(lineCost({ purchasePrice: 275, purchaseQuantity: 5, purchaseUnit: "食" }, 1)).toBe(55);
  });

  it("ml で仕入れたものは ml のまま計算する（比重は使わない：D-163）", () => {
    // 調合ゴマ油 14,300円 / 16.5L → 16,500ml 分。30ml 使うと 26.0円 → 26円
    const goma = { purchasePrice: 14300, purchaseQuantity: 16.5, purchaseUnit: "L" as const };
    expect(lineCost(goma, 30)).toBe(26);
  });

  it("使える割合（歩留まり）を引いて計算する（D-100）", () => {
    // タン 4,800円/kg。掃除で2割減って使えるのは80% → 実際は 6円/g
    const tan = { purchasePrice: 4800, purchaseQuantity: 1, purchaseUnit: "kg" as const, yieldRate: 80 };
    expect(unitPrice(tan)).toBeCloseTo(6, 6);
    expect(lineCost(tan, 60)).toBe(360);
    // 100%（減らない）なら、これまでどおり
    expect(lineCost({ ...tan, yieldRate: 100 }, 60)).toBe(288);
  });

  it("単価を基本単位で返す", () => {
    expect(unitPrice(gyutan)).toBe(4.5);
  });

  it("原価率を返し、売価がなければ null", () => {
    expect(costRatio(369, 1000)).toBeCloseTo(36.9);
    expect(costRatio(369, null)).toBeNull();
    expect(costRatio(369, 0)).toBeNull();
  });
});

describe("使える割合の入力の途中（D-128）", () => {
  const tan = { purchasePrice: 4800, purchaseQuantity: 1, purchaseUnit: "kg" as const };

  it("空欄（NaN）や0のときは100%として計算し、止まらない", () => {
    expect(lineCost({ ...tan, yieldRate: Number.NaN }, 60)).toBe(288);
    expect(lineCost({ ...tan, yieldRate: 0 }, 60)).toBe(288);
  });

  it("ふつうに入っていれば、その割合で計算する", () => {
    expect(lineCost({ ...tan, yieldRate: 80 }, 60)).toBe(360);
  });
});
