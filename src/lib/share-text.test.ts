import { describe, expect, it } from "vitest";
import { recipeShareText } from "./share-text";
import type { Ingredient, Prep } from "./types";

const t = "2026-10-01T00:00:00.000Z";
const ing = (id: string, purchasePrice: number, purchaseQuantity: number, purchaseUnit: Ingredient["purchaseUnit"]): Ingredient => ({
  id,
  name: id,
  category: "その他",
  supplier: "",
  yieldRate: 100,
  purchasePrice,
  purchaseQuantity,
  purchaseUnit,
  createdAt: t,
  updatedAt: t,
});

const gyutan = ing("牛タン", 4500, 1, "kg");
const shio = ing("塩", 150, 1, "kg");
const negi = ing("ネギ", 720, 1, "kg");

const ajinegi: Prep = {
  id: "ajinegi",
  name: "味ネギ",
  secret: false,
  items: [{ type: "ingredient", id: "ネギ", quantity: 400 }],
  yieldQuantity: 400,
  yieldUnit: "g",
  memo: "",
  createdAt: t,
  updatedAt: t,
};

const data = { ingredients: [gyutan, shio, negi], preps: [ajinegi], settings: { saleTaxRate: 10 } };

describe("recipeShareText", () => {
  it("材料・原価・売価・原価率・メモを並べる", () => {
    const text = recipeShareText(data, {
      kind: "draft",
      name: "厚切りタン（試作）",
      salePrice: 1848,
      memo: "レモンは1/4個",
      items: [
        { type: "ingredient", id: "牛タン", quantity: 120 },
        { type: "ingredient", id: "塩", quantity: 2 },
      ],
    });
    // 牛タン120g = 540円、塩2g = 0.3円、合計 540.3円。売価は税込1,848円 → 税抜1,680円（D-181）。
    // 原価率 540.3/1680 = 32.2%（原価は0.1円単位：D-171）
    expect(text).toBe(
      [
        "【創作レシピ】厚切りタン（試作）",
        "",
        "原価 540.3円（税抜）",
        "想定売価 1,848円（税込）",
        "（税抜 1,680円・原価率 32.2％／粗利 1,139.7円）",
        "",
        "材料（1人前）",
        "・牛タン 120g → 540.0円",
        "・塩 2g → 0.3円",
        "",
        "メモ",
        "レモンは1/4個",
      ].join("\n"),
    );
  });

  it("仮の材料は、量なしで名前と金額を出す（D-096）", () => {
    const text = recipeShareText(data, {
      kind: "draft",
      name: "新作（試作）",
      salePrice: 800,
      memo: "",
      items: [
        { type: "ingredient", id: "牛タン", quantity: 50 },
        { type: "temp", name: "ブルーチーズ", cost: 120 },
      ],
    });
    expect(text).toContain("・ブルーチーズ（仮） → 120.0円");
    expect(text).toContain("・牛タン 50g → 225.0円");
  });

  it("売価がないときは原価だけにする", () => {
    const text = recipeShareText(data, {
      kind: "draft",
      name: "試作",
      salePrice: null,
      memo: "",
      items: [{ type: "ingredient", id: "牛タン", quantity: 100 }],
    });
    expect(text).toBe(["【創作レシピ】試作", "", "原価 450.0円（税抜）", "", "材料（1人前）", "・牛タン 100g → 450.0円"].join("\n"));
  });

  it("仕込み品の行も出し、材料を選んでいない行は出さない", () => {
    const text = recipeShareText(data, {
      kind: "menu",
      name: "ネギタン塩",
      salePrice: null,
      memo: "",
      items: [
        { type: "prep", id: "ajinegi", quantity: 30 },
        { type: "ingredient", id: "", quantity: NaN },
      ],
    });
    // 味ネギ 400g 分が 288円 → 30g で 21.6円
    expect(text).toBe(["【メニュー】ネギタン塩", "", "原価 21.6円（税抜）", "", "材料（1人前）", "・味ネギ 30g → 21.6円"].join("\n"));
  });
});
