import { describe, expect, it } from "vitest";
import { ingredientInputSchema, prepInputSchema, ratioTargetsSchema, recipeInputSchema, recipeItemSchema } from "./types";

const ingredient = {
  name: "タンスライス",
  category: "肉",
  purchasePrice: 4800,
  purchaseQuantity: 1,
  purchaseUnit: "kg",
};
const firstError = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.success ? null : result.error?.issues[0]?.message;

describe("材料の入力（保存する関数の中でも確かめる）", () => {
  it("書かなかった欄は、仕入れ先は空・使える割合は100%・比重なしになる", () => {
    const value = ingredientInputSchema.parse(ingredient);
    expect(value).toMatchObject({ supplier: "", yieldRate: 100 });
  });

  it("名前の前後の空白は取る", () => {
    expect(ingredientInputSchema.parse({ ...ingredient, name: "  米  " }).name).toBe("米");
  });

  it("空の名前・51文字以上の名前は通さない", () => {
    expect(firstError(ingredientInputSchema.safeParse({ ...ingredient, name: "   " }))).toBe("材料名を入力してください");
    expect(firstError(ingredientInputSchema.safeParse({ ...ingredient, name: "あ".repeat(51) }))).toBe("材料名は50文字以内にしてください");
  });

  it("仕入れ価格は1円単位・0以上", () => {
    expect(firstError(ingredientInputSchema.safeParse({ ...ingredient, purchasePrice: 10.5 }))).toBe("仕入れ価格は1円単位で入力してください");
    expect(firstError(ingredientInputSchema.safeParse({ ...ingredient, purchasePrice: -1 }))).toBe("仕入れ価格は0以上にしてください");
    expect(ingredientInputSchema.safeParse({ ...ingredient, purchasePrice: 0 }).success).toBe(true);
  });

  it("空欄（NaN）の仕入れ価格は通さない", () => {
    expect(ingredientInputSchema.safeParse({ ...ingredient, purchasePrice: Number.NaN }).success).toBe(false);
  });

  it("仕入れ量は0より大きい", () => {
    expect(firstError(ingredientInputSchema.safeParse({ ...ingredient, purchaseQuantity: 0 }))).toBe("仕入れ量は0より大きくしてください");
  });

  it("使える割合は0より大きく100まで（D-100・D-128）", () => {
    expect(firstError(ingredientInputSchema.safeParse({ ...ingredient, yieldRate: 0 }))).toBe("使える割合は0より大きくしてください");
    expect(firstError(ingredientInputSchema.safeParse({ ...ingredient, yieldRate: 101 }))).toBe("使える割合は100%までです");
    expect(ingredientInputSchema.safeParse({ ...ingredient, yieldRate: 80 }).success).toBe(true);
    expect(ingredientInputSchema.safeParse({ ...ingredient, yieldRate: Number.NaN }).success).toBe(false);
  });

  it("ない単位・ない種類は通さない", () => {
    expect(ingredientInputSchema.safeParse({ ...ingredient, purchaseUnit: "ダース" }).success).toBe(false);
    expect(firstError(ingredientInputSchema.safeParse({ ...ingredient, category: "魚介" }))).toBe("種類を選んでください");
  });
});

describe("レシピの材料1行", () => {
  it("登録した材料は、量が0より大きい", () => {
    expect(recipeItemSchema.safeParse({ type: "ingredient", id: "a", quantity: 80 }).success).toBe(true);
    expect(recipeItemSchema.safeParse({ type: "ingredient", id: "a", quantity: 0 }).success).toBe(false);
    expect(recipeItemSchema.safeParse({ type: "ingredient", id: "", quantity: 80 }).success).toBe(false);
  });

  it("仮の材料は、名前と1円単位の金額（D-096）", () => {
    expect(recipeItemSchema.safeParse({ type: "temp", name: "ブルーチーズ", cost: 120 }).success).toBe(true);
    expect(recipeItemSchema.safeParse({ type: "temp", name: "", cost: 120 }).success).toBe(false);
    expect(recipeItemSchema.safeParse({ type: "temp", name: "ブルーチーズ", cost: 1.5 }).success).toBe(false);
  });
});

describe("鍵がかかった秘密の中身の1行（D-148・D-171）", () => {
  it("オーナーが計算した0.1円単位の原価を読める", () => {
    expect(recipeItemSchema.safeParse({ type: "sealed", cost: 367.5 }).success).toBe(true);
    expect(recipeItemSchema.safeParse({ type: "sealed", cost: 0.1 + 0.2 }).success).toBe(true);
    expect(recipeItemSchema.safeParse({ type: "sealed", cost: 369 }).success).toBe(true);
  });
  it("0.1円より細かい原価・マイナスは読まない", () => {
    expect(recipeItemSchema.safeParse({ type: "sealed", cost: 1.25 }).success).toBe(false);
    expect(recipeItemSchema.safeParse({ type: "sealed", cost: -1 }).success).toBe(false);
  });
});

describe("メニューと仕込み品の入力", () => {
  const recipe = { name: "タン塩小", category: "焼肉（塩）", salePrice: 986, items: [], memo: "" };

  it("売価は空欄（null）でもよい。秘密は書かなければ false", () => {
    const value = recipeInputSchema.parse({ ...recipe, salePrice: null });
    expect(value).toMatchObject({ salePrice: null, secret: false });
  });

  it("売価は1円単位・1,000万円まで", () => {
    expect(recipeInputSchema.safeParse({ ...recipe, salePrice: 986.5 }).success).toBe(false);
    expect(recipeInputSchema.safeParse({ ...recipe, salePrice: 10_000_001 }).success).toBe(false);
  });

  it("ない分類は通さない（なくした「辛味噌」など）", () => {
    expect(recipeInputSchema.safeParse({ ...recipe, category: "辛味噌" }).success).toBe(false);
  });

  it("メモは1000文字まで", () => {
    expect(recipeInputSchema.safeParse({ ...recipe, memo: "あ".repeat(1001) }).success).toBe(false);
  });

  it("仕込み品の出来上がり量は0より大きい", () => {
    const prep = { name: "味ネギ", items: [], yieldQuantity: 400, yieldUnit: "g", memo: "" };
    expect(prepInputSchema.safeParse(prep).success).toBe(true);
    expect(prepInputSchema.safeParse({ ...prep, yieldQuantity: 0 }).success).toBe(false);
  });
});

describe("原価率の目安（D-110）", () => {
  const targets = { drink: { good: 20, high: 25 }, meat: { good: 28, high: 32 }, side: { good: 28, high: 32 } };

  it("「良好」の線は「高い」の線より小さい", () => {
    expect(ratioTargetsSchema.safeParse(targets).success).toBe(true);
    expect(ratioTargetsSchema.safeParse({ ...targets, meat: { good: 32, high: 32 } }).success).toBe(false);
  });

  it("0〜100% の範囲だけ", () => {
    expect(ratioTargetsSchema.safeParse({ ...targets, side: { good: -1, high: 32 } }).success).toBe(false);
    expect(ratioTargetsSchema.safeParse({ ...targets, side: { good: 28, high: 101 } }).success).toBe(false);
  });
});
