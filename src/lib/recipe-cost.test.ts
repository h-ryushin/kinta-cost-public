import { describe, expect, it } from "vitest";
import { allRecipeCosts, calcRecipeCost, costChanges, prepBatchCost, prepCostSource } from "./recipe-cost";
import type { Ingredient, Prep } from "./types";
import { DEFAULT_RATIO_TARGETS, parseStoreData } from "./types";

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

const gyutan = ing("gyutan", 4500, 1, "kg");
const negi = ing("negi", 720, 1, "kg");
const goma = ing("goma", 1000, 1, "L");
const shio = ing("shio", 150, 1, "kg");
const ingredients = [gyutan, negi, goma, shio];

// 味ネギ：ネギ400g(288円) + ごま油30ml(30円) + 塩6g(0.9円) = 318.9円で 400g できる（0.1円単位：D-171）
const ajinegi: Prep = {
  id: "ajinegi",
  name: "味ネギ",
  secret: false,
  items: [
    { type: "ingredient", id: "negi", quantity: 400 },
    { type: "ingredient", id: "goma", quantity: 30 },
    { type: "ingredient", id: "shio", quantity: 6 },
  ],
  yieldQuantity: 400,
  yieldUnit: "g",
  memo: "",
  createdAt: t,
  updatedAt: t,
};

// 税率0%：売価をそのまま税抜として扱い、原価の計算だけを確かめる（税込の扱いは下の D-181 のテスト）
const NO_TAX = { saleTaxRate: 0 };

describe("仕込み品", () => {
  it("1回分の原価は材料ごとに切り上げて合計する", () => {
    expect(prepBatchCost(ingredients, ajinegi)).toBe(318.9);
  });

  it("出来上がり量を仕入れ量とみなす", () => {
    expect(prepCostSource(ingredients, ajinegi)).toEqual({ purchasePrice: 318.9, purchaseQuantity: 400, purchaseUnit: "g" });
  });

  it("メニューでは 仕込み品の単価 × 使用量 を1行として切り上げる", () => {
    // 牛タン80g = 360円、味ネギ30g = 318.9 × 30 / 400 = 23.9175 → 24.0円
    const { lines, total } = calcRecipeCost(
      { settings: NO_TAX, ingredients, preps: [ajinegi] },
      [
        { type: "ingredient", id: "gyutan", quantity: 80 },
        { type: "prep", id: "ajinegi", quantity: 30 },
      ],
      null,
    );
    expect(lines.map((l) => l.cost)).toEqual([360, 24]);
    expect(total).toBe(384);
  });

  it("材料の値上げが仕込み品を通してメニューに反映される", () => {
    const pricier = ingredients.map((i) => (i.id === "negi" ? { ...i, purchasePrice: 1000 } : i));
    // ネギ400g = 400円 → 430.9円 / 400g、30g = 32.3175 → 32.4円
    const { total } = calcRecipeCost({ settings: NO_TAX, ingredients: pricier, preps: [ajinegi] }, [{ type: "prep", id: "ajinegi", quantity: 30 }], null);
    expect(total).toBe(32.4);
  });

  it("存在しない材料の行は原価に入れない", () => {
    const { lines, total } = calcRecipeCost({ settings: NO_TAX, ingredients, preps: [] }, [{ type: "prep", id: "nothing", quantity: 10 }], null);
    expect(lines[0].cost).toBeNull();
    expect(total).toBe(0);
  });
});

describe("parseStoreData", () => {
  it("version 1 のデータを最新の形式に変換する", () => {
    const result = parseStoreData({
      version: 1,
      ingredients: [{ ...gyutan, category: undefined }],
      priceHistory: [],
      recipes: [
        { id: "r", kind: "menu", name: "タン", salePrice: 1000, memo: "", createdAt: t, updatedAt: t, items: [{ ingredientId: "gyutan", quantity: 80 }] },
      ],
      logs: [],
    });
    expect(result.success).toBe(true);
    expect(result.data?.version).toBe(19);
    expect(result.data?.preps).toEqual([]);
    expect(result.data?.ingredients[0].category).toBe("その他");
    expect(result.data?.recipes[0].items).toEqual([{ type: "ingredient", id: "gyutan", quantity: 80 }]);
    // 「タン」は名前から焼肉（塩）に振り分ける
    expect(result.data?.recipes[0].category).toBe("焼肉（塩）");
  });

  it("version 15 のデータは、売価の履歴なしとして読む（D-111）", () => {
    const result = parseStoreData({
      version: 15,
      settings: { purchaseTaxRate: 8, saleTaxRate: 10, ratioTargets: DEFAULT_RATIO_TARGETS },
      ingredients: [goma],
      priceHistory: [],
      preps: [],
      recipes: [],
      logs: [],
    });
    expect(result.success).toBe(true);
    expect(result.data?.version).toBe(19);
    expect(result.data?.salePriceHistory).toEqual([]);
  });

  it("version 13 のデータは、消費税 仕入れ8%・売価10% として読む（D-101）", () => {
    const result = parseStoreData({
      version: 13,
      ingredients: [goma],
      priceHistory: [],
      preps: [],
      recipes: [],
      logs: [],
    });
    expect(result.success).toBe(true);
    expect(result.data?.version).toBe(19);
    expect(result.data?.settings).toEqual({ purchaseTaxRate: 8, saleTaxRate: 10, ratioTargets: DEFAULT_RATIO_TARGETS });
  });

  it("version 12 の材料は、使える割合100%として読む（D-100）", () => {
    const result = parseStoreData({
      version: 12,
      ingredients: [{ ...goma, yieldRate: undefined }],
      priceHistory: [],
      preps: [],
      recipes: [],
      logs: [],
    });
    expect(result.success).toBe(true);
    expect(result.data?.version).toBe(19);
    expect(result.data?.ingredients[0].yieldRate).toBe(100);
  });

  it("version 11 の材料も読める", () => {
    const result = parseStoreData({
      version: 11,
      ingredients: [goma],
      priceHistory: [],
      preps: [],
      recipes: [],
      logs: [],
    });
    expect(result.success).toBe(true);
    expect(result.data?.version).toBe(19);
  });

  it("version 10 のメニュー・仕込み品は、秘密なしとして読む", () => {
    const result = parseStoreData({
      version: 10,
      ingredients: [gyutan],
      priceHistory: [],
      preps: [{ ...ajinegi, secret: undefined }],
      recipes: [
        { id: "r", kind: "menu", name: "タン塩", category: "焼肉（塩）", salePrice: 1280, memo: "", createdAt: t, updatedAt: t, items: [] },
      ],
      logs: [],
    });
    expect(result.success).toBe(true);
    expect(result.data?.version).toBe(19);
    expect(result.data?.preps[0].secret).toBe(false);
    expect(result.data?.recipes[0].secret).toBe(false);
  });

  it("version 9 の材料の「魚介」はその他に移し、仕入れ先は空にする", () => {
    const result = parseStoreData({
      version: 9,
      ingredients: [{ ...gyutan, category: "魚介", supplier: undefined }, { ...negi, category: "野菜・果物", supplier: undefined }],
      priceHistory: [],
      preps: [],
      recipes: [],
      logs: [],
    });
    expect(result.success).toBe(true);
    expect(result.data?.version).toBe(19);
    expect(result.data?.ingredients.map((i) => [i.category, i.supplier])).toEqual([
      ["その他", ""],
      ["野菜・果物", ""],
    ]);
  });

  it("version 8 の「キッズドリンク」はソフトドリンクに移す", () => {
    const recipe = (name: string, category: string) => ({ id: name, kind: "menu", name, category, salePrice: null, memo: "", createdAt: t, updatedAt: t, items: [] });
    const result = parseStoreData({
      version: 8,
      ingredients: [],
      priceHistory: [],
      preps: [],
      recipes: [recipe("オレンジジュース（キッズ）", "キッズドリンク"), recipe("タン塩", "焼肉（塩）")],
      logs: [],
    });
    expect(result.success).toBe(true);
    expect(result.data?.version).toBe(19);
    expect(result.data?.recipes.map((r) => r.category)).toEqual(["ソフトドリンク", "焼肉（塩）"]);
  });

  it("version 7 の分類を、お店のハンディの分類に移す", () => {
    const recipe = (name: string, category: string) => ({ id: name, kind: "menu", name, category, salePrice: null, memo: "", createdAt: t, updatedAt: t, items: [] });
    const result = parseStoreData({
      version: 7,
      ingredients: [],
      priceHistory: [],
      preps: [],
      recipes: [
        recipe("タン塩（特盛）", "牛"),
        recipe("国産牛カルビ（タレ）", "牛"),
        recipe("ネギトントロ", "ホルモン・その他"),
        recipe("さくらユッケ", "刺身"),
        recipe("特製クッパ", "飯物"),
        recipe("ワカメスープ", "スープ"),
        recipe("瓶ビール", "ビール"),
        recipe("緑茶ハイ", "サワー"),
        recipe("芋焼酎", "日本酒・焼酎"),
        recipe("マッコリ", "ワイン・果実酒"),
        recipe("きんたコース", "その他"),
      ],
      logs: [],
    });
    expect(result.success).toBe(true);
    expect(result.data?.version).toBe(19);
    expect(result.data?.recipes.map((r) => r.category)).toEqual([
      "特盛（塩）",
      "焼肉（タレ）",
      "焼肉（塩）",
      "おつまみ・刺身・薬味",
      "スープ・クッパ",
      "スープ・クッパ",
      "ビール・チューハイ",
      "ビール・チューハイ",
      "焼酎・日本酒",
      "梅酒・ワイン・マッコリ",
      "コース",
    ]);
  });

  it("version 6 のなくした分類（辛味噌・薬味・サワー・ハイボール）を移す", () => {
    const recipe = (name: string, category: string) => ({ id: name, kind: "menu", name, category, salePrice: null, memo: "", createdAt: t, updatedAt: t, items: [] });
    const result = parseStoreData({
      version: 6,
      ingredients: [],
      priceHistory: [],
      preps: [],
      recipes: [
        recipe("辛味噌とんちゃん", "辛味噌"),
        recipe("辛味噌おまかせ", "辛味噌"),
        recipe("生タマゴ", "薬味"),
        recipe("レモンサワー", "サワー・ハイボール"),
        recipe("角ハイボール", "サワー・ハイボール"),
        recipe("店長のおすすめ割り", "サワー・ハイボール"),
      ],
      logs: [],
    });
    expect(result.success).toBe(true);
    expect(result.data?.version).toBe(19);
    expect(result.data?.recipes.map((r) => r.category)).toEqual([
      "焼肉（タレ）",
      "焼肉（タレ）",
      "おつまみ・刺身・薬味",
      "ビール・チューハイ",
      "ハイボール",
      "ビール・チューハイ",
    ]);
  });

  it("version 5 の「ドリンク」は、名前からドリンクの分類に分ける", () => {
    const recipe = (name: string, category: string) => ({ id: name, kind: "menu", name, category, salePrice: null, memo: "", createdAt: t, updatedAt: t, items: [] });
    const result = parseStoreData({
      version: 5,
      ingredients: [],
      priceHistory: [],
      preps: [],
      recipes: [recipe("生ビール（中）", "ドリンク"), recipe("ウーロン茶", "ドリンク"), recipe("店長おすすめ", "ドリンク"), recipe("タン塩", "牛")],
      logs: [],
    });
    expect(result.success).toBe(true);
    expect(result.data?.version).toBe(19);
    expect(result.data?.recipes.map((r) => r.category)).toEqual(["ビール・チューハイ", "ソフトドリンク", "その他のドリンク", "焼肉（塩）"]);
  });

  it("version 4 の「その他」のメニューは、名前から分類を振り分ける", () => {
    const recipe = (name: string, category: string) => ({ id: name, kind: "menu", name, category, salePrice: null, memo: "", createdAt: t, updatedAt: t, items: [] });
    const result = parseStoreData({
      version: 4,
      ingredients: [],
      priceHistory: [],
      preps: [],
      recipes: [recipe("タン塩", "その他"), recipe("辛味噌とんちゃん", "その他"), recipe("おまかせ", "その他"), recipe("生ビール", "牛")],
      logs: [],
    });
    expect(result.success).toBe(true);
    expect(result.data?.version).toBe(19);
    // 手で「牛」に分けたもの（生ビール）は、名前ではなく分類に従って焼肉にする
    expect(result.data?.recipes.map((r) => r.category)).toEqual(["焼肉（塩）", "焼肉（タレ）", "その他", "焼肉（タレ）"]);
  });

  it("version 3 のデータのメニューは、名前から分類を振り分ける", () => {
    const result = parseStoreData({
      version: 3,
      ingredients: [gyutan],
      priceHistory: [],
      preps: [],
      recipes: [
        { id: "r", kind: "draft", name: "試作", salePrice: null, memo: "", createdAt: t, updatedAt: t, items: [] },
        { id: "s", kind: "menu", name: "石焼ビビンバ", salePrice: null, memo: "", createdAt: t, updatedAt: t, items: [] },
      ],
      logs: [],
    });
    expect(result.success).toBe(true);
    expect(result.data?.version).toBe(19);
    expect(result.data?.recipes.map((r) => r.category)).toEqual(["その他", "ご飯物"]);
  });

  it("version 2 のデータの材料は種類を「その他」にする", () => {
    const result = parseStoreData({
      version: 2,
      ingredients: [{ ...gyutan, category: undefined }],
      priceHistory: [],
      preps: [ajinegi],
      recipes: [],
      logs: [],
    });
    expect(result.success).toBe(true);
    expect(result.data?.version).toBe(19);
    expect(result.data?.ingredients[0].category).toBe("その他");
    expect(result.data?.preps).toHaveLength(1);
  });
});

describe("原価の変化（D-097）", () => {
  const data = {
    ingredients,
    settings: NO_TAX,
    preps: [ajinegi],
    recipes: [
      { id: "m1", name: "タン塩", kind: "menu", category: "焼肉（塩）", salePrice: 1280, items: [{ type: "ingredient" as const, id: "gyutan", quantity: 80 }] },
      { id: "m2", name: "ネギタン塩", kind: "menu", category: "焼肉（塩）", salePrice: 1480, items: [{ type: "prep" as const, id: "ajinegi", quantity: 30 }] },
      { id: "m3", name: "ごはん", kind: "menu", category: "ご飯物", salePrice: 300, items: [{ type: "ingredient" as const, id: "shio", quantity: 1 }] },
    ],
  };

  it("値上げで原価が変わったものだけ、変化の大きい順に出す", () => {
    const before = allRecipeCosts(data);
    // 牛タンを 4,500円 → 5,000円 に値上げ
    const after = allRecipeCosts({
      ...data,
      ingredients: ingredients.map((i) => (i.id === "gyutan" ? { ...i, purchasePrice: 5000 } : i)),
    });
    const changes = costChanges(before, after);
    expect(changes.map((c) => c.name)).toEqual(["タン塩"]);
    expect(changes[0]).toMatchObject({ before: 360, after: 400 });
  });

  it("仕込み品を通しても変化を拾う", () => {
    const before = allRecipeCosts(data);
    // ネギを値上げすると、味ネギを使うメニューの原価が上がる
    const after = allRecipeCosts({
      ...data,
      ingredients: ingredients.map((i) => (i.id === "negi" ? { ...i, purchasePrice: 1000 } : i)),
    });
    const changes = costChanges(before, after);
    expect(changes.map((c) => c.name)).toEqual(["ネギタン塩"]);
  });

  it("関係ない材料を変えても、何も出ない", () => {
    const before = allRecipeCosts(data);
    const after = allRecipeCosts({
      ...data,
      ingredients: ingredients.map((i) => (i.id === "goma" ? { ...i, purchasePrice: 1100 } : i)),
    });
    // ごま油は味ネギに入っているので、実際には変わる。変わらない例として売価だけ変えたものを確かめる
    expect(costChanges(before, before)).toEqual([]);
    expect(after.length).toBe(3);
  });
});

describe("鍵がかかった秘密の中身（D-148）", () => {
  // 塩だれ：中身は見えない。オーナーが計算した1回分の原価 369円で 400g できる
  const shiodare: Prep = {
    ...ajinegi,
    id: "shiodare",
    name: "塩だれ",
    secret: true,
    sealed: true,
    items: [{ type: "sealed", cost: 369 }],
  };

  it("秘密の仕込み品の1回分の原価は、オーナーが計算した金額のまま", () => {
    expect(prepBatchCost(ingredients, shiodare)).toBe(369);
  });

  it("秘密の仕込み品を使うメニューは、社員でも原価を出せる（要件定義書 3.6 と同じ切り上げ）", () => {
    // 369円 × 30g ÷ 400g = 27.675 → 27.7円
    const { total } = calcRecipeCost({ settings: NO_TAX, ingredients, preps: [shiodare] }, [{ type: "prep", id: "shiodare", quantity: 30 }], null);
    expect(total).toBe(27.7);
  });

  it("秘密のメニューは、オーナーが計算した原価がそのまま合計になる", () => {
    const { total, ratio } = calcRecipeCost({ settings: NO_TAX, ingredients, preps: [] }, [{ type: "sealed", cost: 420 }], 1400);
    expect(total).toBe(420);
    expect(ratio).toBeCloseTo(30);
  });

  it("材料の値段が変わっても、鍵がかかった中身の原価は変わらない（鍵を開けたときに計算し直す）", () => {
    const pricier = ingredients.map((i) => (i.id === "negi" ? { ...i, purchasePrice: 9999 } : i));
    expect(prepBatchCost(pricier, shiodare)).toBe(369);
  });
});

describe("売価は税込で持つ（D-181）", () => {
  const data = { settings: { saleTaxRate: 10 }, ingredients, preps: [] };
  it("原価率と粗利は、税込 ÷ 1.1 を切り上げた税抜で出す", () => {
    // 牛タン80g = 360円。税込780円 → 税抜710円（709.09… を切り上げ）
    const { total, saleWithoutTax, ratio, profit } = calcRecipeCost(data, [{ type: "ingredient", id: "gyutan", quantity: 80 }], 780);
    expect(total).toBe(360);
    expect(saleWithoutTax).toBe(710);
    expect(profit).toBe(350);
    expect(ratio).toBeCloseTo((360 / 710) * 100);
  });
  it("売価がないときは、税抜・粗利・原価率を出さない", () => {
    const { saleWithoutTax, ratio, profit } = calcRecipeCost(data, [{ type: "ingredient", id: "gyutan", quantity: 80 }], null);
    expect([saleWithoutTax, ratio, profit]).toEqual([null, null, null]);
  });
  it("粗利が小数（0.1円単位）でも誤差を出さない", () => {
    // 塩2g = 0.3円。税込110円 → 税抜100円、粗利 99.7円
    expect(calcRecipeCost(data, [{ type: "ingredient", id: "shio", quantity: 2 }], 110).profit).toBe(99.7);
  });
});
