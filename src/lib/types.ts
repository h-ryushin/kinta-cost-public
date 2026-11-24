import { z } from "zod";
import { CATEGORIES, MENU_CATEGORIES } from "./categories";
import { guessDrinkCategory, guessMenuCategory } from "./menu-classifier";
import { PURCHASE_UNITS } from "./units";

// Zod は速くするために eval（new Function）が使えるかを試す。公開サイトの CSP は eval を許さないので（D-155）、
// 試すたびにブラウザが違反として報告する。試さないようにする（入力の検証の結果は変わらない）
z.config({ jitless: true });

export const ingredientInputSchema = z.object({
  name: z.string().trim().min(1, "材料名を入力してください").max(50, "材料名は50文字以内にしてください"),
  category: z.enum(CATEGORIES, { message: "種類を選んでください" }),
  // 仕入れ先は任意（D-053）。前の版のデータにはないので、なければ空にする
  supplier: z.string().trim().max(50, "仕入れ先は50文字以内にしてください").default(""),
  purchasePrice: z
    .number({ message: "仕入れ価格を入力してください" })
    .int("仕入れ価格は1円単位で入力してください")
    .min(0, "仕入れ価格は0以上にしてください")
    .max(10_000_000, "仕入れ価格が大きすぎます"),
  purchaseQuantity: z
    .number({ message: "仕入れ量を入力してください" })
    .positive("仕入れ量は0より大きくしてください")
    .max(1_000_000, "仕入れ量が大きすぎます"),
  purchaseUnit: z.enum(PURCHASE_UNITS),
  // 使える割合（%）。掃除や下処理で減る分を引いたあと（D-100）
  yieldRate: z
    .number({ message: "使える割合を入れてください" })
    .positive("使える割合は0より大きくしてください")
    .max(100, "使える割合は100%までです")
    .default(100),
});
export type IngredientInput = z.infer<typeof ingredientInputSchema>;

export const ingredientSchema = ingredientInputSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Ingredient = z.infer<typeof ingredientSchema>;

export const priceHistorySchema = z.object({
  id: z.string(),
  ingredientId: z.string(),
  changedAt: z.string(),
  oldPrice: z.number(),
  oldQuantity: z.number(),
  oldUnit: z.enum(PURCHASE_UNITS),
  newPrice: z.number(),
  newQuantity: z.number(),
  newUnit: z.enum(PURCHASE_UNITS),
  /** 使える割合（%）の前と後（D-126）。それより前の履歴にはない（変わっていなかったとみなす） */
  oldYieldRate: z.number().nullable().optional(),
  newYieldRate: z.number().nullable().optional(),
});
export type PriceHistory = z.infer<typeof priceHistorySchema>;

/** メニュー・創作レシピの売価（税込：D-181）の履歴（D-111）。データベースのトリガーが書く */
export const salePriceHistorySchema = z.object({
  id: z.string(),
  recipeId: z.string(),
  changedAt: z.string(),
  oldPrice: z.number().nullable(),
  newPrice: z.number().nullable(),
});
export type SalePriceHistory = z.infer<typeof salePriceHistorySchema>;

const quantitySchema = z
  .number({ message: "使用量を入力してください" })
  .positive("使用量は0より大きくしてください")
  .max(1_000_000, "使用量が大きすぎます");

/**
 * レシピ・仕込み品の材料1行。
 * - ingredient：登録した材料 ／ prep：仕込み品
 * - temp：仮の材料（創作レシピだけ。材料として登録せず、名前とだいたいの金額だけ持つ：D-096）
 * - sealed：秘密の中身に鍵がかかっているときの代わりの1行（D-148。ITEM_TYPES には入れない。画面で入力しないため）
 */
export const ITEM_TYPES = ["ingredient", "prep", "temp"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const recipeItemSchema = z.union([
  z.object({
    type: z.enum(["ingredient", "prep"]),
    id: z.string().min(1, "材料を選んでください"),
    quantity: quantitySchema,
  }),
  z.object({
    type: z.literal("temp"),
    name: z.string().trim().min(1, "仮の材料の名前を入れてください").max(50, "名前は50文字以内にしてください"),
    cost: z
      .number({ message: "だいたいの金額を入れてください" })
      .int("金額は1円単位で入れてください")
      .min(0, "金額は0以上にしてください")
      .max(1_000_000, "金額が大きすぎます"),
  }),
  // 秘密の中身に鍵がかかっているとき（社員・鍵を開ける前のオーナー）の代わりの1行（D-148）。
  // 中身は見えないので、オーナーが計算した原価（secret_cost）だけを持つ。保存はしない
  z.object({
    type: z.literal("sealed"),
    // 原価は0.1円単位（D-171）。小数の誤差（0.30000000000000004 など）は許す
    cost: z
      .number()
      .min(0)
      .refine((c) => Math.abs(c * 10 - Math.round(c * 10)) < 1e-6, "原価は0.1円単位です"),
  }),
]);
export type RecipeItem = z.infer<typeof recipeItemSchema>;

/** 仕込み品（味ネギ・タレなど、材料を組み合わせて先に作っておくもの） */
export const prepInputSchema = z.object({
  name: z.string().trim().min(1, "名前を入力してください").max(50, "名前は50文字以内にしてください"),
  // 秘密（塩だれなど）の中身はオーナーだけが見られる（D-060）。前の版のデータにはないので、なければ false
  secret: z.boolean().default(false),
  items: z.array(recipeItemSchema),
  yieldQuantity: z
    .number({ message: "出来上がり量を入力してください" })
    .positive("出来上がり量は0より大きくしてください")
    .max(1_000_000, "出来上がり量が大きすぎます"),
  yieldUnit: z.enum(PURCHASE_UNITS),
  memo: z.string().max(1000, "メモは1000文字以内にしてください"),
});
export type PrepInput = z.infer<typeof prepInputSchema>;

export const prepSchema = prepInputSchema.extend({
  id: z.string(),
  // 秘密の中身に鍵がかかっていて、items が sealed の1行だけのとき（D-148）
  sealed: z.boolean().optional(),
  // 秘密のものの原価を最後に計算し直した日時（D-154）
  secretCostAt: z.string().nullable().optional(),
  // 秘密なのに、まだ暗号化していない（D-094 のころに平文で入れた）とき。鍵を開けると暗号化する（D-148）
  plainSecret: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Prep = z.infer<typeof prepSchema>;

/** menu = 正式メニュー、draft = 創作レシピ（試作） */
export const RECIPE_KINDS = ["menu", "draft"] as const;
export type RecipeKind = (typeof RECIPE_KINDS)[number];

export const recipeInputSchema = z.object({
  name: z.string().trim().min(1, "名前を入力してください").max(50, "名前は50文字以内にしてください"),
  category: z.enum(MENU_CATEGORIES, { message: "分類を選んでください" }),
  // 秘密のメニューの中身はオーナーだけが見られる（要件定義書 3.4、D-060）
  secret: z.boolean().default(false),
  // 売価は税込（メニュー表の値段）で持つ。税抜は税込 ÷（1＋税率）の切り上げで出す（D-179・D-181）
  salePrice: z
    .number()
    .int("売価は1円単位で入力してください")
    .min(0, "売価は0以上にしてください")
    .max(10_000_000, "売価が大きすぎます")
    .nullable(),
  items: z.array(recipeItemSchema),
  memo: z.string().max(1000, "メモは1000文字以内にしてください"),
});
export type RecipeInput = z.infer<typeof recipeInputSchema>;

export const recipeSchema = recipeInputSchema.extend({
  id: z.string(),
  kind: z.enum(RECIPE_KINDS),
  // 秘密の中身に鍵がかかっていて、items が sealed の1行だけのとき（D-148）
  sealed: z.boolean().optional(),
  // 秘密のものの原価を最後に計算し直した日時（D-154）
  secretCostAt: z.string().nullable().optional(),
  // 秘密なのに、まだ暗号化していない（D-094 のころに平文で入れた）とき。鍵を開けると暗号化する（D-148）
  plainSecret: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Recipe = z.infer<typeof recipeSchema>;

export const auditLogSchema = z.object({
  id: z.string(),
  at: z.string(),
  actor: z.string(),
  action: z.string(),
  detail: z.string(),
});
export type AuditLog = z.infer<typeof auditLogSchema>;

const percentSchema = z.number().min(0, "0以上にしてください").max(100, "100以下にしてください");

/** 原価率の目安の2本の線（D-102・D-110）。good 以下が良好、high を超えると高い */
const ratioThresholdSchema = z
  .object({ good: percentSchema, high: percentSchema })
  .refine((t) => t.good < t.high, { message: "「良好」の線は「高い」の線より小さくしてください", path: ["high"] });

export const ratioTargetsSchema = z.object({
  drink: ratioThresholdSchema,
  meat: ratioThresholdSchema,
  side: ratioThresholdSchema,
});
export type RatioTargets = z.infer<typeof ratioTargetsSchema>;

/** オーナーの回答（2026-10-04）で決めた初期値 */
export const DEFAULT_RATIO_TARGETS: RatioTargets = {
  drink: { good: 20, high: 25 },
  meat: { good: 28, high: 32 },
  side: { good: 28, high: 32 },
};

/** お店の設定（D-101）。金額は税抜で持ち、表示のときに税込を出す */
export const settingsSchema = z.object({
  /** 仕入れにかかる消費税（%）。食材は軽減税率8% */
  purchaseTaxRate: percentSchema.default(8),
  /** 売価にかかる消費税（%）。店内飲食は10% */
  saleTaxRate: percentSchema.default(10),
  /** 原価率の目安（D-110）。画面から変えられる */
  ratioTargets: ratioTargetsSchema,
});
export type Settings = z.infer<typeof settingsSchema>;

export const STORE_VERSION = 19;

export const storeDataSchema = z.object({
  version: z.literal(STORE_VERSION),
  settings: settingsSchema,
  ingredients: z.array(ingredientSchema),
  priceHistory: z.array(priceHistorySchema),
  /** version 16 で足した（D-111）。それより前のデータには履歴がないので空で始める */
  salePriceHistory: z.array(salePriceHistorySchema).default([]),
  preps: z.array(prepSchema),
  recipes: z.array(recipeSchema),
  logs: z.array(auditLogSchema),
});
export type StoreData = z.infer<typeof storeDataSchema>;

// ---------- 古い形式からの変換（D-024、D-025、D-031、D-041、D-042、D-044、D-045、D-052、D-053、D-060） ----------
// 古い版の分類は今の一覧にない値（「ドリンク」など）を含むので、文字列として読み、最後に最新の形で検証する。

const legacyRecipeSchema = recipeSchema.extend({ category: z.string() });
const legacyIngredientSchema = ingredientSchema.extend({ category: z.string() });
/** 古い版の土台。材料の種類も、今の一覧にない値（「魚介」など）を含むので文字列として読む。設定は最後に足す */
const legacyStoreDataSchema = storeDataSchema
  .omit({ settings: true })
  .extend({ ingredients: z.array(legacyIngredientSchema) });

/**
 * version 16〜18：17 だけにあった「このまま」の印（priceReviews）は D-122 でやめた。読むときに捨てる。
 * 18 までの価格の履歴には使える割合（D-126）がないが、なくても読めるので形はそのまま
 */
const storeDataV16Schema = storeDataSchema.extend({ version: z.union([z.literal(16), z.literal(17), z.literal(18)]) });

/** version 15：売価の履歴（salePriceHistory）がなかった。空の履歴は storeDataSchema の default で足す */
const storeDataV15Schema = storeDataSchema.extend({ version: z.literal(15) });

/** version 14：設定に原価率の目安（ratioTargets）がなかった */
const storeDataV14Schema = legacyStoreDataSchema.extend({
  version: z.literal(14),
  recipes: z.array(legacyRecipeSchema),
  settings: settingsSchema.omit({ ratioTargets: true }),
});
type StoreDataV14 = z.infer<typeof storeDataV14Schema>;

/** version 13：お店の設定（消費税率）がなかった。金額は税込で持っていた */
const storeDataV13Schema = legacyStoreDataSchema.extend({
  version: z.literal(13),
  recipes: z.array(legacyRecipeSchema),
});
type StoreDataV13 = z.infer<typeof storeDataV13Schema>;

/** version 12：材料に使える割合（yieldRate）がなかった */
const storeDataV12Schema = legacyStoreDataSchema.extend({
  version: z.literal(12),
  recipes: z.array(legacyRecipeSchema),
});
type StoreDataV12 = z.infer<typeof storeDataV12Schema>;

/** version 11：材料に比重（density）がなかった */
const storeDataV11Schema = legacyStoreDataSchema.extend({
  version: z.literal(11),
  recipes: z.array(legacyRecipeSchema),
});
type StoreDataV11 = z.infer<typeof storeDataV11Schema>;

/** version 10：メニュー・仕込み品に「秘密」がなかった */
const storeDataV10Schema = legacyStoreDataSchema.extend({
  version: z.literal(10),
  recipes: z.array(legacyRecipeSchema),
});
type StoreDataV10 = z.infer<typeof storeDataV10Schema>;

/** version 9：材料の種類に「魚介」があった */
const storeDataV9Schema = legacyStoreDataSchema.extend({
  version: z.literal(9),
  recipes: z.array(legacyRecipeSchema),
});
type StoreDataV9 = z.infer<typeof storeDataV9Schema>;

/** version 8：「キッズドリンク」があり、「その他のドリンク」がなかった */
const storeDataV8Schema = legacyStoreDataSchema.extend({
  version: z.literal(8),
  recipes: z.array(legacyRecipeSchema),
});
type StoreDataV8 = z.infer<typeof storeDataV8Schema>;

/** version 7：分類が食べログの見出し（牛・ホルモン・その他…）だった */
const storeDataV7Schema = legacyStoreDataSchema.extend({
  version: z.literal(7),
  recipes: z.array(legacyRecipeSchema),
});
type StoreDataV7 = z.infer<typeof storeDataV7Schema>;

/** version 6：「辛味噌」「薬味」「サワー・ハイボール」の分類があった */
const storeDataV6Schema = legacyStoreDataSchema.extend({
  version: z.literal(6),
  recipes: z.array(legacyRecipeSchema),
});
type StoreDataV6 = z.infer<typeof storeDataV6Schema>;

/** version 5：ドリンクが「ドリンク」の1つだけだった */
const storeDataV5Schema = legacyStoreDataSchema.extend({
  version: z.literal(5),
  recipes: z.array(legacyRecipeSchema),
});
type StoreDataV5 = z.infer<typeof storeDataV5Schema>;

/** version 4：形は同じ。version 3 から変換したメニューが、すべて「その他」になっていた */
const storeDataV4Schema = storeDataV5Schema.extend({ version: z.literal(4) });
type StoreDataV4 = z.infer<typeof storeDataV4Schema>;

const ingredientV2Schema = ingredientSchema.omit({ category: true });
const recipeV3Schema = recipeSchema.omit({ category: true });

/** version 3：メニューに分類（category）がなかった */
const storeDataV3Schema = legacyStoreDataSchema.extend({
  version: z.literal(3),
  recipes: z.array(recipeV3Schema),
});
type StoreDataV3 = z.infer<typeof storeDataV3Schema>;

/** version 2：材料に種類（category）がなかった */
const storeDataV2Schema = storeDataV3Schema.extend({
  version: z.literal(2),
  ingredients: z.array(ingredientV2Schema),
});
type StoreDataV2 = z.infer<typeof storeDataV2Schema>;

/** version 1：仕込み品がなく、レシピの材料行が { ingredientId, quantity } だった */
const storeDataV1Schema = z.object({
  version: z.literal(1),
  ingredients: z.array(ingredientV2Schema),
  priceHistory: z.array(priceHistorySchema),
  recipes: z.array(
    recipeV3Schema.extend({ items: z.array(z.object({ ingredientId: z.string(), quantity: z.number() })) }),
  ),
  logs: z.array(auditLogSchema),
});

function v1ToV2(data: z.infer<typeof storeDataV1Schema>): StoreDataV2 {
  return {
    ...data,
    version: 2,
    preps: [],
    salePriceHistory: [],
    recipes: data.recipes.map((r) => ({
      ...r,
      items: r.items.map((i) => ({ type: "ingredient" as const, id: i.ingredientId, quantity: i.quantity })),
    })),
  };
}

function v2ToV3(data: StoreDataV2): StoreDataV3 {
  return {
    ...data,
    version: 3,
    ingredients: data.ingredients.map((i) => ({ ...i, category: "その他" as const })),
  };
}

function v3ToV4(data: StoreDataV3): StoreDataV4 {
  return { ...data, version: 4, recipes: data.recipes.map((r) => ({ ...r, category: "その他" })) };
}

/** 「その他」のメニューを、名前から推測した分類に振り分ける。推測できないものは「その他」のまま */
function v4ToV5(data: StoreDataV4): StoreDataV5 {
  return {
    ...data,
    version: 5,
    recipes: data.recipes.map((r) =>
      r.category === "その他" ? { ...r, category: guessMenuCategory(r.name) ?? "その他" } : r,
    ),
  };
}

/** 「ドリンク」を、名前から推測したドリンクの分類に分ける。推測できないものは「その他のドリンク」 */
function v5ToV6(data: StoreDataV5): StoreDataV6 {
  return {
    ...data,
    version: 6,
    recipes: data.recipes.map((r) =>
      r.category === "ドリンク" ? { ...r, category: guessDrinkCategory(r.name) ?? "その他のドリンク" } : r,
    ),
  };
}

/** なくした分類を移す：辛味噌→ホルモン、薬味→おつまみ・薬味、サワー・ハイボール→サワーかハイボール */
function v6ToV7(data: StoreDataV6): StoreDataV7 {
  const migrate = (name: string, category: string): string => {
    if (category === "辛味噌") return guessMenuCategory(name) ?? "ホルモン・その他";
    if (category === "薬味") return "おつまみ・薬味";
    if (category === "サワー・ハイボール") return guessDrinkCategory(name) === "ハイボール" ? "ハイボール" : "サワー";
    return category;
  };
  return {
    ...data,
    version: 7,
    recipes: data.recipes.map((r) => ({ ...r, category: migrate(r.name, r.category) })),
  };
}

const MEAT_CATEGORIES: readonly string[] = ["焼肉（塩）", "焼肉（タレ）", "特盛（塩）", "特盛（タレ）"];

/** 分類をお店のハンディのボタンに合わせる。焼肉は名前から塩・タレ・特盛に分ける */
function v7ToV8(data: StoreDataV7): StoreDataV8 {
  const migrate = (name: string, category: string): string => {
    const guessed = guessMenuCategory(name);
    switch (category) {
      case "牛":
      case "ホルモン・その他":
        return guessed && MEAT_CATEGORIES.includes(guessed) ? guessed : "焼肉（タレ）";
      case "おつまみ・薬味":
      case "刺身":
        return "おつまみ・刺身・薬味";
      case "飯物":
        return guessed === "スープ・クッパ" ? guessed : "ご飯物";
      case "スープ":
        return "スープ・クッパ";
      case "ビール":
        return "ビール・チューハイ";
      case "サワー":
        return "ビール・チューハイ";
      case "日本酒・焼酎":
        return "焼酎・日本酒";
      case "ワイン・果実酒":
        return "梅酒・ワイン・マッコリ";
      case "その他のドリンク":
        return guessDrinkCategory(name) ?? "その他のドリンク";
      case "その他":
        return guessed ?? "その他";
      default:
        return category;
    }
  };
  return {
    ...data,
    version: 8,
    recipes: data.recipes.map((r) => ({ ...r, category: migrate(r.name, r.category) })),
  };
}

/** 「キッズドリンク」をなくしたので、ソフトドリンクに移す */
function v8ToV9(data: StoreDataV8): StoreDataV9 {
  return {
    ...data,
    version: 9,
    recipes: data.recipes.map((r) => (r.category === "キッズドリンク" ? { ...r, category: "ソフトドリンク" } : r)),
  };
}

/** 材料の種類「魚介」をなくしたので、その他に移す */
function v9ToV10(data: StoreDataV9): StoreDataV10 {
  return {
    ...data,
    version: 10,
    ingredients: data.ingredients.map((i) => (i.category === "魚介" ? { ...i, category: "その他" } : i)),
  };
}

/**
 * メニュー・仕込み品に「秘密」を足した（D-060）。
 * 古いデータの「秘密」は読み込みのときに false が入る（スキーマの default）ので、版だけ上げる。
 */
function v10ToV11(data: StoreDataV10): StoreDataV11 {
  return { ...data, version: 11 };
}

/**
 * 材料に比重を足した（D-080）。古いデータの比重は読み込みのときに null が入る（スキーマの default）ので、版だけ上げる。
 */
function v11ToV12(data: StoreDataV11): StoreDataV12 {
  return { ...data, version: 12 };
}

/** 材料に使える割合を足した（D-100）。古いデータは 100%（全部使える）として読む */
function v12ToV13(data: StoreDataV12): StoreDataV13 {
  return { ...data, version: 13 };
}

/** お店の設定（消費税率）を足した（D-101）。既定は仕入れ8%・売価10%。原価率の目安（D-110）も初期値で足す */
function v13ToV14(data: StoreDataV13) {
  return v14ToV15({ ...data, version: 14, settings: { purchaseTaxRate: 8, saleTaxRate: 10 } });
}

/** 原価率の目安を設定に足した（D-110）。初期値はオーナーの回答の数字 */
function v14ToV15(data: StoreDataV14) {
  return { ...data, version: STORE_VERSION, settings: { ...data.settings, ratioTargets: DEFAULT_RATIO_TARGETS } };
}

/** 古い形式のデータも読めるよう、最新の形式に変換してから検証する */
export function parseStoreData(value: unknown) {
  const v1 = storeDataV1Schema.safeParse(value);
  if (v1.success) return storeDataSchema.safeParse(toLatest(v8ToV9(v7ToV8(v6ToV7(v5ToV6(v4ToV5(v3ToV4(v2ToV3(v1ToV2(v1.data))))))))));
  const v2 = storeDataV2Schema.safeParse(value);
  if (v2.success) return storeDataSchema.safeParse(toLatest(v8ToV9(v7ToV8(v6ToV7(v5ToV6(v4ToV5(v3ToV4(v2ToV3(v2.data)))))))));
  const v3 = storeDataV3Schema.safeParse(value);
  if (v3.success) return storeDataSchema.safeParse(toLatest(v8ToV9(v7ToV8(v6ToV7(v5ToV6(v4ToV5(v3ToV4(v3.data))))))));
  const v4 = storeDataV4Schema.safeParse(value);
  if (v4.success) return storeDataSchema.safeParse(toLatest(v8ToV9(v7ToV8(v6ToV7(v5ToV6(v4ToV5(v4.data)))))));
  const v5 = storeDataV5Schema.safeParse(value);
  if (v5.success) return storeDataSchema.safeParse(toLatest(v8ToV9(v7ToV8(v6ToV7(v5ToV6(v5.data))))));
  const v6 = storeDataV6Schema.safeParse(value);
  if (v6.success) return storeDataSchema.safeParse(toLatest(v8ToV9(v7ToV8(v6ToV7(v6.data)))));
  const v7 = storeDataV7Schema.safeParse(value);
  if (v7.success) return storeDataSchema.safeParse(toLatest(v8ToV9(v7ToV8(v7.data))));
  const v8 = storeDataV8Schema.safeParse(value);
  if (v8.success) return storeDataSchema.safeParse(toLatest(v8ToV9(v8.data)));
  const v9 = storeDataV9Schema.safeParse(value);
  if (v9.success) return storeDataSchema.safeParse(toLatest(v9.data));
  const v10 = storeDataV10Schema.safeParse(value);
  if (v10.success) return storeDataSchema.safeParse(v13ToV14(v12ToV13(v11ToV12(v10ToV11(v10.data)))));
  const v11 = storeDataV11Schema.safeParse(value);
  if (v11.success) return storeDataSchema.safeParse(v13ToV14(v12ToV13(v11ToV12(v11.data))));
  const v12 = storeDataV12Schema.safeParse(value);
  if (v12.success) return storeDataSchema.safeParse(v13ToV14(v12ToV13(v12.data)));
  const v13 = storeDataV13Schema.safeParse(value);
  if (v13.success) return storeDataSchema.safeParse(v13ToV14(v13.data));
  const v14 = storeDataV14Schema.safeParse(value);
  if (v14.success) return storeDataSchema.safeParse(v14ToV15(v14.data));
  const v15 = storeDataV15Schema.safeParse(value);
  if (v15.success) return storeDataSchema.safeParse({ ...v15.data, version: STORE_VERSION });
  const v16 = storeDataV16Schema.safeParse(value);
  if (v16.success) return storeDataSchema.safeParse({ ...v16.data, version: STORE_VERSION });
  return storeDataSchema.safeParse(value);
}

/** version 9 以前からの変換の、残りの段をまとめたもの */
function toLatest(data: StoreDataV9) {
  return v13ToV14(v12ToV13(v11ToV12(v10ToV11(v9ToV10(data)))));
}
