"use client";

import { useSyncExternalStore } from "react";
import type { PostgrestError } from "@supabase/supabase-js";
import { z } from "zod";
import {
  DEFAULT_RATIO_TARGETS,
  ingredientInputSchema,
  prepInputSchema,
  recipeInputSchema,
  recipeItemSchema,
  settingsSchema,
  storeDataSchema,
  STORE_VERSION,
  type IngredientInput,
  type ItemType,
  type PrepInput,
  type RecipeInput,
  type RecipeItem,
  type RatioTargets,
  type RecipeKind,
  type Settings,
  type StoreData,
} from "./types";
import { CATEGORIES, MENU_CATEGORIES, type Category, type MenuCategory } from "./categories";
import { baseUnitOf } from "./units";
import { logAction, logDetail } from "./log-format";
import { readAllPages } from "./read-all";
import { supabase } from "./supabase";
import { guessMenuCategory } from "./menu-classifier";
import { decryptJson, encryptJson } from "./crypto";
import { currentRecipeKey, lockRecipeKey, setOnRecipeKeyUnlock } from "./recipe-key";
import { calcRecipeCost, prepBatchCost } from "./recipe-cost";

/**
 * データの読み書きはすべてこのファイルを通す（D-011）。
 * 保存先は Supabase（D-069）。権限はデータベースの RLS が守るので、ここでは
 * 入力の検証（Zod）と、画面に出す日本語のエラーだけを受け持つ。
 *
 * データは多くない（材料300・メニュー300くらい）ので、まとめて読み込み、
 * 書き込みのあとに読み直す。価格の履歴と操作ログはデータベースのトリガーが書く。
 */

export class StoreError extends Error {}

type Snapshot = { loaded: false } | { loaded: true; data: StoreData };

const SERVER_SNAPSHOT: Snapshot = { loaded: false };
let snapshot: Snapshot = SERVER_SNAPSHOT;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 画面からデータを読むためのフック。読み込み前は loaded: false を返す。 */
export function useStore(): Snapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => SERVER_SNAPSHOT);
}

/** 原価率の目安（D-110）。読み込み前は初期値 */
export function useRatioTargets(): RatioTargets {
  const store = useStore();
  return store.loaded ? store.data.settings.ratioTargets : DEFAULT_RATIO_TARGETS;
}

/** ログインしたときに呼ぶ。すべて読み直す */
export async function loadStore() {
  snapshot = { loaded: true, data: await fetchAll() };
  emit();
}

/** ログアウトしたときに呼ぶ */
export function resetStore() {
  snapshot = SERVER_SNAPSHOT;
  // 開けた秘密の中身と鍵も忘れる（D-148）
  openedRecipes.clear();
  openedPreps.clear();
  lockRecipeKey();
  emit();
}

/** 今読み込んでいるデータ（保存の前後を比べるときなどに使う）。読み込み前は null */
export function getStoreData(): StoreData | null {
  return snapshot.loaded ? snapshot.data : null;
}

function currentData(): StoreData {
  if (!snapshot.loaded) throw new StoreError("データを読み込めていません。画面を開き直してください");
  return snapshot.data;
}

// ---------- 秘密の中身（D-148） ----------

/** 暗号化する中身。材料行とメモ */
const secretPayloadSchema = z.object({ items: z.array(recipeItemSchema), memo: z.string() });
type SecretPayload = z.infer<typeof secretPayloadSchema>;
type SealedRow = { ciphertext: string; iv: string; key_version: number };

/** 鍵を開けて元に戻した中身。この画面のあいだだけメモリに持つ（保存しない） */
const openedRecipes = new Map<string, SecretPayload>();
const openedPreps = new Map<string, SecretPayload>();
/** D-094 のころに平文で入れた秘密の中身。鍵を開けたときに暗号化して入れ直す */
const plainSecretRecipes = new Set<string>();
const plainSecretPreps = new Set<string>();

async function openSealed(rows: (SealedRow & { id: string })[], into: Map<string, SecretPayload>) {
  const key = currentRecipeKey();
  if (!key) return;
  for (const row of rows) {
    if (row.key_version !== key.version) continue;
    try {
      const value = secretPayloadSchema.parse(await decryptJson(key.key, { ciphertext: row.ciphertext, iv: row.iv }));
      into.set(row.id, value);
    } catch {
      // 開けないもの（壊れている・別の鍵）は、鍵がかかったままにしておく
    }
  }
}

function requireRecipeKey() {
  const key = currentRecipeKey();
  if (!key) {
    throw new StoreError("秘密の中身は暗号化して保存します。先に鍵を開けてください（顔・指紋、または予備の鍵）");
  }
  return key;
}

/**
 * 鍵を開けたときに呼ぶ（D-148）：
 * 1. 平文のまま入っている秘密の中身（D-094 のころのもの）を暗号化して入れ直す
 * 2. 秘密のものの原価を計算し直し、社員が見る金額（secret_cost）を新しくする（要件定義書：管理者のログイン時に再計算）
 */
async function afterRecipeKeyUnlock() {
  if (!snapshot.loaded) return;
  await loadStore();
  let data = currentData();
  const plainPreps = data.preps.filter((p) => p.secret && plainSecretPreps.has(p.id));
  const plainRecipes = data.recipes.filter((r) => r.secret && plainSecretRecipes.has(r.id));
  for (const prep of plainPreps) await saveSecretPrep(prep.id, prep, false);
  for (const recipe of plainRecipes) await saveSecretRecipe(recipe.id, recipe.kind, recipe, false);
  // 暗号化し直したものがあるときだけ読み直す（ふだんは平文の秘密はないので、読み込みは2回で済む）
  if (plainPreps.length + plainRecipes.length > 0) {
    await loadStore();
    data = currentData();
  }
  const preps = data.preps.filter((p) => p.secret && !p.sealed).map((p) => ({ id: p.id, cost: prepBatchCost(data.ingredients, p) }));
  const recipes = data.recipes
    .filter((r) => r.secret && !r.sealed)
    .map((r) => ({ id: r.id, cost: calcRecipeCost(data, r.items, r.salePrice).total }));
  if (preps.length + recipes.length > 0) {
    const { error } = await supabase.rpc("update_secret_costs", { p_recipes: recipes, p_preps: preps });
    if (error) throw toStoreError(error);
  }
  await loadStore();
}

setOnRecipeKeyUnlock(afterRecipeKeyUnlock);

/** 鍵を閉じる。開けた中身も忘れ、鍵がかかった状態で読み直す（D-148） */
export async function lockSecrets() {
  openedRecipes.clear();
  openedPreps.clear();
  lockRecipeKey();
  if (snapshot.loaded) await loadStore();
}

// ---------- 読み込み ----------

type CategoryRow = { id: string; name: string };
type IngredientRow = {
  id: string;
  name: string;
  category_id: string;
  supplier: string;
  purchase_price: number;
  purchase_quantity: string | number;
  purchase_unit: string;
  yield_rate: string | number;
  created_at: string;
  updated_at: string;
};
type PriceHistoryRow = {
  id: number;
  ingredient_id: string;
  changed_at: string;
  old_price: number;
  old_quantity: string | number;
  old_unit: string;
  new_price: number;
  new_quantity: string | number;
  new_unit: string;
  old_yield_rate: string | number | null;
  new_yield_rate: string | number | null;
};
type SalePriceHistoryRow = {
  id: number;
  recipe_id: string;
  changed_at: string;
  old_price: number | null;
  new_price: number | null;
};
type PrepRow = {
  id: string;
  name: string;
  yield_quantity: string | number;
  yield_unit: string;
  memo: string;
  is_secret: boolean;
  secret_cost: string | number | null;
  secret_cost_calculated_at: string | null;
  created_at: string;
  updated_at: string;
};
type PrepItemRow = { prep_id: string; ingredient_id: string; quantity: string | number; sort_order: number };
type RecipeRow = {
  id: string;
  kind: string;
  category_id: string;
  name: string;
  sale_price: number | null;
  memo: string;
  is_secret: boolean;
  secret_cost: string | number | null;
  secret_cost_calculated_at: string | null;
  created_at: string;
  updated_at: string;
};
type RecipeItemRow = {
  recipe_id: string;
  ingredient_id: string | null;
  prep_id: string | null;
  quantity: string | number;
  sort_order: number;
  /** 仮の材料（創作レシピだけ：D-096） */
  temp_name: string | null;
  temp_cost: number | null;
};
type SettingsRow = {
  purchase_tax_rate: string | number;
  sale_tax_rate: string | number;
  drink_ratio_good: string | number;
  drink_ratio_high: string | number;
  meat_ratio_good: string | number;
  meat_ratio_high: string | number;
  side_ratio_good: string | number;
  side_ratio_high: string | number;
};
type AuditLogRow = {
  id: number;
  occurred_at: string;
  actor_name: string | null;
  action: string;
  detail: Record<string, unknown> | null;
};

const num = (value: string | number) => Number(value);

/** 分類は画面では日本語の名前、データベースでは ID（meat など）で持つので、両方の対応表を作る */
let categoryIdByName = new Map<string, string>();
let menuCategoryIdByName = new Map<string, string>();

function nameToCategory(name: string): Category {
  return (CATEGORIES.find((c) => c === name) ?? "その他") as Category;
}

function nameToMenuCategory(name: string): MenuCategory {
  return (MENU_CATEGORIES.find((c) => c === name) ?? "その他") as MenuCategory;
}

/**
 * 表を全部読む。1,000行を超えても切れないよう続けて読む（D-159）。ページの境目でずれないよう、主キーで並べる。
 * 価格・売価の履歴と操作ログはデータベースが1,000件までにするので、ふだんは1回で終わる。
 */
async function select<T>(table: string, columns: string, orderBy: string[] = ["id"]): Promise<T[]> {
  try {
    return await readAllPages<T>((from, to) => {
      let query = supabase.from(table).select(columns);
      for (const column of orderBy) query = query.order(column);
      return query.range(from, to).overrideTypes<T[], { merge: false }>();
    });
  } catch (error) {
    throw toStoreError(error as PostgrestError);
  }
}

async function fetchAll(): Promise<StoreData> {
  const [cats, menuCats, ingredients, priceHistory, salePriceHistory, preps, prepItems, recipes, recipeItems, logs, settings, sealedRecipes, sealedPreps] =
    await Promise.all([
    select<CategoryRow>("ingredient_categories", "id, name"),
    select<CategoryRow>("menu_categories", "id, name"),
    select<IngredientRow>(
      "ingredients",
      "id, name, category_id, supplier, purchase_price, purchase_quantity, purchase_unit, yield_rate, created_at, updated_at",
    ),
    select<PriceHistoryRow>(
      "ingredient_price_history",
      "id, ingredient_id, changed_at, old_price, old_quantity, old_unit, new_price, new_quantity, new_unit, old_yield_rate, new_yield_rate",
    ),
    select<SalePriceHistoryRow>("recipe_price_history", "id, recipe_id, changed_at, old_price, new_price"),
    select<PrepRow>("preps", "id, name, yield_quantity, yield_unit, memo, is_secret, secret_cost, secret_cost_calculated_at, created_at, updated_at"),
    select<PrepItemRow>("prep_items", "prep_id, ingredient_id, quantity, sort_order", ["prep_id", "ingredient_id"]),
    select<RecipeRow>("recipes", "id, kind, category_id, name, sale_price, memo, is_secret, secret_cost, secret_cost_calculated_at, created_at, updated_at"),
    select<RecipeItemRow>("recipe_items", "recipe_id, ingredient_id, prep_id, quantity, sort_order, temp_name, temp_cost"),
    select<AuditLogRow>("audit_logs", "id, occurred_at, actor_name, action, detail"),
    select<SettingsRow>(
      "settings",
      "purchase_tax_rate, sale_tax_rate, drink_ratio_good, drink_ratio_high, meat_ratio_good, meat_ratio_high, side_ratio_good, side_ratio_high",
    ),
    // 秘密の中身の暗号文（オーナーだけが読める。社員には0行：D-148）
    select<SealedRow & { recipe_id: string }>("secret_recipe_contents", "recipe_id, ciphertext, iv, key_version", ["recipe_id"]),
    select<SealedRow & { prep_id: string }>("secret_prep_contents", "prep_id, ciphertext, iv, key_version", ["prep_id"]),
  ]);
  await openSealed(sealedRecipes.map((r) => ({ ...r, id: r.recipe_id })), openedRecipes);
  await openSealed(sealedPreps.map((r) => ({ ...r, id: r.prep_id })), openedPreps);

  /**
   * 秘密のものの中身（D-148）：
   * - 平文の材料行がある（D-094 のころ・オーナーだけ読める）→ そのまま使い、鍵を開けたときに暗号化し直す
   * - 鍵を開けて元に戻せた → その中身
   * - それ以外（社員・鍵を開ける前）→ オーナーが計算した原価だけの1行（sealed）
   */
  function contentsOf(
    row: { id: string; is_secret: boolean; memo: string; secret_cost: string | number | null },
    plain: RecipeItem[],
    opened: Map<string, SecretPayload>,
    plainSet: Set<string>,
  ): { items: RecipeItem[]; memo: string; sealed?: boolean; plainSecret?: boolean } {
    if (!row.is_secret) return { items: plain, memo: row.memo };
    if (plain.length > 0) {
      plainSet.add(row.id);
      return { items: plain, memo: row.memo, plainSecret: true };
    }
    plainSet.delete(row.id);
    const value = opened.get(row.id);
    if (value) return { items: value.items, memo: value.memo };
    // 0.1円単位の列（D-171）は、文字で返ってくることがあるので数に直す
    return { items: [{ type: "sealed", cost: row.secret_cost === null ? 0 : num(row.secret_cost) }], memo: "", sealed: true };
  }

  categoryIdByName = new Map(cats.map((c) => [c.name, c.id]));
  menuCategoryIdByName = new Map(menuCats.map((c) => [c.name, c.id]));
  const categoryNameById = new Map(cats.map((c) => [c.id, c.name]));
  const menuCategoryNameById = new Map(menuCats.map((c) => [c.id, c.name]));

  const itemsOfPrep = (prepId: string): RecipeItem[] =>
    prepItems
      .filter((i) => i.prep_id === prepId)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => ({ type: "ingredient" as const, id: i.ingredient_id, quantity: num(i.quantity) }));

  const itemsOfRecipe = (recipeId: string): RecipeItem[] =>
    recipeItems
      .filter((i) => i.recipe_id === recipeId)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) =>
        i.temp_name !== null
          ? { type: "temp" as const, name: i.temp_name, cost: i.temp_cost ?? 0 }
          : {
              type: (i.prep_id ? "prep" : "ingredient") as "ingredient" | "prep",
              id: (i.prep_id ?? i.ingredient_id) as string,
              quantity: num(i.quantity),
            },
      );

  const data = {
    version: STORE_VERSION,
    settings: {
      purchaseTaxRate: settings[0] ? num(settings[0].purchase_tax_rate) : 8,
      saleTaxRate: settings[0] ? num(settings[0].sale_tax_rate) : 10,
      ratioTargets: settings[0]
        ? {
            drink: { good: num(settings[0].drink_ratio_good), high: num(settings[0].drink_ratio_high) },
            meat: { good: num(settings[0].meat_ratio_good), high: num(settings[0].meat_ratio_high) },
            side: { good: num(settings[0].side_ratio_good), high: num(settings[0].side_ratio_high) },
          }
        : DEFAULT_RATIO_TARGETS,
    },
    ingredients: ingredients.map((i) => ({
      id: i.id,
      name: i.name,
      category: nameToCategory(categoryNameById.get(i.category_id) ?? "その他"),
      supplier: i.supplier,
      purchasePrice: i.purchase_price,
      purchaseQuantity: num(i.purchase_quantity),
      purchaseUnit: i.purchase_unit,
      yieldRate: num(i.yield_rate),
      createdAt: i.created_at,
      updatedAt: i.updated_at,
    })),
    priceHistory: priceHistory
      .map((h) => ({
        id: String(h.id),
        ingredientId: h.ingredient_id,
        changedAt: h.changed_at,
        oldPrice: h.old_price,
        oldQuantity: num(h.old_quantity),
        oldUnit: h.old_unit,
        newPrice: h.new_price,
        newQuantity: num(h.new_quantity),
        newUnit: h.new_unit,
        oldYieldRate: h.old_yield_rate === null ? null : num(h.old_yield_rate),
        newYieldRate: h.new_yield_rate === null ? null : num(h.new_yield_rate),
      }))
      .sort((a, b) => b.changedAt.localeCompare(a.changedAt)),
    salePriceHistory: salePriceHistory
      .map((h) => ({
        id: String(h.id),
        recipeId: h.recipe_id,
        changedAt: h.changed_at,
        oldPrice: h.old_price,
        newPrice: h.new_price,
      }))
      .sort((a, b) => b.changedAt.localeCompare(a.changedAt)),
    preps: preps.map((p) => ({
      id: p.id,
      name: p.name,
      secret: p.is_secret,
      secretCostAt: p.secret_cost_calculated_at,
      ...contentsOf(p, itemsOfPrep(p.id), openedPreps, plainSecretPreps),
      yieldQuantity: num(p.yield_quantity),
      yieldUnit: p.yield_unit,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    })),
    recipes: recipes.map((r) => ({
      id: r.id,
      kind: r.kind,
      category: nameToMenuCategory(menuCategoryNameById.get(r.category_id) ?? "その他"),
      name: r.name,
      secret: r.is_secret,
      secretCostAt: r.secret_cost_calculated_at,
      salePrice: r.sale_price,
      ...contentsOf(r, itemsOfRecipe(r.id), openedRecipes, plainSecretRecipes),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    logs: logs
      .map((l) => ({
        id: String(l.id),
        at: l.occurred_at,
        actor: l.actor_name ?? "（不明）",
        action: logAction(l.action),
        detail: logDetail(l.action, l.detail ?? {}),
      }))
      .sort((a, b) => b.at.localeCompare(a.at)),
  };

  const parsed = storeDataSchema.safeParse(data);
  if (!parsed.success) {
    console.error("データベースから読んだ内容が、画面の形式と合いません", parsed.error);
    throw new StoreError("データの形式が合いません。開発者に連絡してください");
  }
  return parsed.data;
}

// ---------- エラー ----------

/** データベースのエラーを、利用者が読む日本語にする */
function toStoreError(error: PostgrestError): StoreError {
  // トリガーや関数が出す日本語のメッセージ（名前の重複など）は、そのまま見せる
  if (/[ぁ-んァ-ヶ一-龠]/.test(error.message)) return new StoreError(error.message);
  if (error.code === "42501" || error.message.includes("row-level security")) {
    return new StoreError("この操作をする権限がありません");
  }
  if (error.code === "23503") return new StoreError("ほかで使っているため、この操作はできません");
  if (error.code === "23505") return new StoreError("同じ名前のものがすでにあります");
  console.error(error);
  return new StoreError("保存できませんでした。通信の状態を確かめてもう一度お試しください");
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new StoreError(result.error.issues[0]?.message ?? "入力内容を確認してください");
  return result.data;
}

function categoryId(name: string): string {
  const id = categoryIdByName.get(name);
  if (!id) throw new StoreError(`種類「${name}」がデータベースにありません`);
  return id;
}

function menuCategoryId(name: string): string {
  const id = menuCategoryIdByName.get(name);
  if (!id) throw new StoreError(`分類「${name}」がデータベースにありません`);
  return id;
}

// ---------- 共通の検証（画面に出すメッセージを分かりやすくするため、送る前にも確かめる） ----------

/** 材料・仕込み品を使っているレシピと仕込み品 */
export function whereUsed(data: StoreData, type: ItemType, id: string): { name: string }[] {
  const uses = (items: RecipeItem[]) => items.some((i) => i.type !== "temp" && i.type === type && i.id === id);
  return [...data.preps.filter((p) => uses(p.items)), ...data.recipes.filter((r) => uses(r.items))];
}

function assertNotUsed(data: StoreData, type: ItemType, id: string, name: string) {
  // 鍵がかかった秘密の中身は見えないので、そこで使っていないかを確かめられない（D-148）
  const sealed = [...data.recipes, ...data.preps].filter((r) => r.sealed);
  if (sealed.length > 0) {
    throw new StoreError(
      `秘密のもの（${sealed.map((r) => r.name).join("、")}）の中で使っていないか確かめられないため、削除できません。オーナーに、秘密レシピの鍵を開けてから削除してもらってください`,
    );
  }
  const users = whereUsed(data, type, id);
  if (users.length > 0) {
    throw new StoreError(`「${name}」は次で使っているため削除できません：${users.map((u) => u.name).join("、")}`);
  }
}

/** レシピ・仕込み品の材料行が、存在するものを重複なく指しているか */
function assertValidItems(data: StoreData, items: RecipeItem[], allowPrep: boolean) {
  if (items.some((i) => i.type === "sealed")) throw new StoreError("秘密の中身に鍵がかかっています。鍵を開けてから保存してください");
  const exists = (i: RecipeItem) => {
    if (i.type === "temp" || i.type === "sealed") return true;
    return i.type === "ingredient"
      ? data.ingredients.some((x) => x.id === i.id)
      : allowPrep && data.preps.some((x) => x.id === i.id);
  };
  if (!allowPrep && items.some((i) => i.type === "prep")) throw new StoreError("仕込み品の中に仕込み品は入れられません");
  if (!items.every(exists)) throw new StoreError("存在しない材料が含まれています");
  const keys = items.filter((i) => i.type !== "temp" && i.type !== "sealed").map((i) => `${i.type}:${"id" in i ? i.id : ""}`);
  if (new Set(keys).size !== keys.length) throw new StoreError("同じ材料が2回選ばれています");
}

// ---------- お店の設定（消費税率。D-101） ----------

export async function updateSettings(input: Settings) {
  const value = parseOrThrow(settingsSchema, input);
  const { error } = await supabase
    .from("settings")
    .update({
      purchase_tax_rate: value.purchaseTaxRate,
      sale_tax_rate: value.saleTaxRate,
      drink_ratio_good: value.ratioTargets.drink.good,
      drink_ratio_high: value.ratioTargets.drink.high,
      meat_ratio_good: value.ratioTargets.meat.good,
      meat_ratio_high: value.ratioTargets.meat.high,
      side_ratio_good: value.ratioTargets.side.good,
      side_ratio_high: value.ratioTargets.side.high,
    })
    .eq("id", true);
  if (error) throw toStoreError(error);
  await loadStore();
}

// ---------- 材料 ----------

export async function addIngredient(input: IngredientInput): Promise<string> {
  const value = parseOrThrow(ingredientInputSchema, input);
  const { data, error } = await supabase
    .from("ingredients")
    .insert({
      name: value.name,
      category_id: categoryId(value.category),
      supplier: value.supplier,
      purchase_price: value.purchasePrice,
      purchase_quantity: value.purchaseQuantity,
      purchase_unit: value.purchaseUnit,
      yield_rate: value.yieldRate,
    })
    .select("id")
    .single();
  if (error) throw toStoreError(error);
  await loadStore();
  return (data as { id: string }).id;
}

export async function updateIngredient(id: string, input: IngredientInput) {
  const data = currentData();
  const value = parseOrThrow(ingredientInputSchema, input);
  const current = data.ingredients.find((i) => i.id === id);
  if (!current) throw new StoreError("材料が見つかりません");
  // 使っている材料でも、意味が変わる単位に変えられる（D-170）。分量の読み方が変わることは、画面で確かめてもらう
  const { error } = await supabase
    .from("ingredients")
    .update({
      name: value.name,
      category_id: categoryId(value.category),
      supplier: value.supplier,
      purchase_price: value.purchasePrice,
      purchase_quantity: value.purchaseQuantity,
      purchase_unit: value.purchaseUnit,
      yield_rate: value.yieldRate,
    })
    .eq("id", id);
  if (error) throw toStoreError(error);
  await loadStore();
}

export async function deleteIngredient(id: string) {
  const data = currentData();
  const current = data.ingredients.find((i) => i.id === id);
  if (!current) throw new StoreError("材料が見つかりません");
  assertNotUsed(data, "ingredient", id, current.name);
  const { error } = await supabase.from("ingredients").delete().eq("id", id);
  if (error) throw toStoreError(error);
  await loadStore();
}

// ---------- 仕込み品 ----------

function validatePrep(data: StoreData, input: PrepInput): PrepInput {
  const value = parseOrThrow(prepInputSchema, input);
  if (value.items.length === 0) throw new StoreError("材料を1つ以上追加してください");
  assertValidItems(data, value.items, false);
  if (value.items.some((i) => i.type === "temp")) throw new StoreError("仕込み品には仮の材料を入れられません");
  return value;
}

/**
 * 秘密の仕込み品は、中身（材料・メモ）をこのブラウザで暗号化して保存する（D-148）。
 * 社員がメニューの原価を出せるよう、1回分の原価（secret_cost）も一緒に送る（D-066）。
 */
async function saveSecretPrep(id: string | null, value: PrepInput, reload = true): Promise<string> {
  const key = requireRecipeKey();
  const payload: SecretPayload = { items: value.items, memo: value.memo };
  const encrypted = await encryptJson(key.key, payload);
  const { data, error } = await supabase.rpc("save_secret_prep", {
    p_id: id,
    p_name: value.name,
    p_yield_quantity: value.yieldQuantity,
    p_yield_unit: value.yieldUnit,
    p_ciphertext: encrypted.ciphertext,
    p_iv: encrypted.iv,
    p_key_version: key.version,
    p_cost: prepBatchCost(currentData().ingredients, value),
  });
  if (error) throw toStoreError(error);
  openedPreps.set(data as string, payload);
  plainSecretPreps.delete(data as string);
  if (reload) await loadStore();
  return data as string;
}

/** save_prep は材料行もまとめて差し替える（docs/database.md 7章） */
async function savePrep(id: string | null, value: PrepInput): Promise<string> {
  if (value.secret) return saveSecretPrep(id, value);
  const { data, error } = await supabase.rpc("save_prep", {
    p_id: id,
    p_name: value.name,
    p_yield_quantity: value.yieldQuantity,
    p_yield_unit: value.yieldUnit,
    p_memo: value.memo,
    // 仕込み品に仮の材料は入らない（上で弾いている）
    p_items: value.items.flatMap((i) => (i.type === "temp" || i.type === "sealed" ? [] : [{ ingredient_id: i.id, quantity: i.quantity }])),
    p_is_secret: false,
  });
  if (error) throw toStoreError(error);
  await loadStore();
  return data as string;
}

export async function addPrep(input: PrepInput): Promise<string> {
  return savePrep(null, validatePrep(currentData(), input));
}

export async function updatePrep(id: string, input: PrepInput) {
  const data = currentData();
  const current = data.preps.find((p) => p.id === id);
  if (!current) throw new StoreError("仕込み品が見つかりません");
  const value = validatePrep(data, input);
  if (baseUnitOf(current.yieldUnit) !== baseUnitOf(value.yieldUnit) && whereUsed(data, "prep", id).length > 0) {
    throw new StoreError(`レシピで使っている仕込み品は、基本単位（${baseUnitOf(current.yieldUnit)}）が変わる単位にできません`);
  }
  await savePrep(id, value);
}

export async function deletePrep(id: string) {
  const data = currentData();
  const current = data.preps.find((p) => p.id === id);
  if (!current) throw new StoreError("仕込み品が見つかりません");
  assertNotUsed(data, "prep", id, current.name);
  const { error } = await supabase.from("preps").delete().eq("id", id);
  if (error) throw toStoreError(error);
  await loadStore();
}

// ---------- メニュー・創作レシピ ----------

function validateRecipe(data: StoreData, input: RecipeInput, kind: RecipeKind): RecipeInput {
  const value = parseOrThrow(recipeInputSchema, input);
  if (kind === "menu" && value.items.length === 0) throw new StoreError("材料を1つ以上追加してください");
  assertValidItems(data, value.items, true);
  // 仮の材料は創作レシピだけ（D-096）。メニューにするときは材料を登録してもらう
  if (kind === "menu" && value.items.some((i) => i.type === "temp")) {
    const names = value.items.filter((i) => i.type === "temp").map((i) => (i.type === "temp" ? i.name : ""));
    throw new StoreError(`メニューにするには、仮の材料（${names.join("、")}）を材料として登録してください`);
  }
  return value;
}

/** 秘密のメニュー・創作レシピは、中身（材料・メモ）をこのブラウザで暗号化して保存する（D-148） */
async function saveSecretRecipe(id: string | null, kind: RecipeKind, value: RecipeInput, reload = true): Promise<string> {
  const key = requireRecipeKey();
  const payload: SecretPayload = { items: value.items, memo: value.memo };
  const encrypted = await encryptJson(key.key, payload);
  const { data, error } = await supabase.rpc("save_secret_recipe", {
    p_id: id,
    p_kind: kind,
    p_category_id: menuCategoryId(value.category),
    p_name: value.name,
    p_sale_price: value.salePrice,
    p_ciphertext: encrypted.ciphertext,
    p_iv: encrypted.iv,
    p_key_version: key.version,
    p_cost: calcRecipeCost(currentData(), value.items, value.salePrice).total,
  });
  if (error) throw toStoreError(error);
  openedRecipes.set(data as string, payload);
  plainSecretRecipes.delete(data as string);
  if (reload) await loadStore();
  return data as string;
}

async function saveRecipe(id: string | null, kind: RecipeKind, value: RecipeInput): Promise<string> {
  if (value.secret) return saveSecretRecipe(id, kind, value);
  const { data, error } = await supabase.rpc("save_recipe", {
    p_id: id,
    p_kind: kind,
    p_category_id: menuCategoryId(value.category),
    p_name: value.name,
    p_sale_price: value.salePrice,
    p_memo: value.memo,
    p_items: value.items.flatMap((i) =>
      i.type === "sealed"
        ? []
        : i.type === "temp"
          ? [{ ingredient_id: null, prep_id: null, quantity: 1, temp_name: i.name, temp_cost: i.cost }]
          : [
              {
                ingredient_id: i.type === "ingredient" ? i.id : null,
                prep_id: i.type === "prep" ? i.id : null,
                quantity: i.quantity,
              },
            ],
    ),
    p_is_secret: false,
  });
  if (error) throw toStoreError(error);
  await loadStore();
  return data as string;
}

export async function addRecipe(kind: RecipeKind, input: RecipeInput): Promise<string> {
  return saveRecipe(null, kind, validateRecipe(currentData(), input, kind));
}

export async function updateRecipe(id: string, input: RecipeInput) {
  const data = currentData();
  const current = data.recipes.find((r) => r.id === id);
  if (!current) throw new StoreError("レシピが見つかりません");
  await saveRecipe(id, current.kind, validateRecipe(data, input, current.kind));
}

export async function deleteRecipe(id: string) {
  const { error } = await supabase.from("recipes").delete().eq("id", id);
  if (error) throw toStoreError(error);
  await loadStore();
}

/** 創作レシピを正式メニューにする（中身はそのまま、種類だけ変える） */
export async function promoteDraft(id: string) {
  const data = currentData();
  const current = data.recipes.find((r) => r.id === id);
  if (!current || current.kind !== "draft") throw new StoreError("創作レシピが見つかりません");
  // 秘密の創作レシピは中身が暗号文なので、データベースでは仮の材料を確かめられない。ここで確かめる（D-096・D-148）
  if (current.sealed) throw new StoreError("秘密の中身に鍵がかかっています。鍵を開けてから登録してください");
  const temps = current.items.filter((i) => i.type === "temp");
  if (temps.length > 0) {
    const names = temps.map((i) => (i.type === "temp" ? i.name : ""));
    throw new StoreError(`メニューにするには、仮の材料（${names.join("、")}）を材料として登録してください`);
  }
  const { error } = await supabase.from("recipes").update({ kind: "menu" }).eq("id", id);
  if (error) throw toStoreError(error);
  await loadStore();
}

/**
 * 分類が「その他」のメニュー・創作レシピを、名前から推測した分類に振り分ける（D-041）。
 * 振り分けた件数を返す。
 */
export async function classifyOtherRecipes(): Promise<number> {
  const data = currentData();
  const targets = data.recipes
    .filter((r) => r.category === "その他")
    .map((r) => ({ id: r.id, guessed: guessMenuCategory(r.name) }))
    .filter((r): r is { id: string; guessed: MenuCategory } => r.guessed !== null);
  // 1件ずつではなく、振り分け先の分類ごとにまとめて更新する
  // （Map.groupBy は古い iPhone の Safari にないので使わない）
  for (const category of new Set(targets.map((t) => t.guessed))) {
    const { error } = await supabase
      .from("recipes")
      .update({ category_id: menuCategoryId(category) })
      .in("id", targets.filter((t) => t.guessed === category).map((t) => t.id));
    if (error) throw toStoreError(error);
  }
  if (targets.length > 0) await loadStore();
  return targets.length;
}
