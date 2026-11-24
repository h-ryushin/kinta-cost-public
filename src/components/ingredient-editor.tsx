"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, Save, Trash2 } from "lucide-react";
import { NumberInput } from "@/components/number-input";
import { YieldChangeNote } from "@/components/yield-change";
import { NUMBER_RULES, validateNumberInput } from "@/lib/number-input";
import {
  Button,
  Card,
  CardTitle,
  ChoiceButtons,
  ErrorMessage,
  Field,
  inputClass,
  LinkButton,
  Loading,
  PageHeader,
  RatioBadge,
  useConfirm,
} from "@/components/ui";
import { CATEGORIES, type Category } from "@/lib/categories";
import { returnQuery } from "@/lib/changes-link";
import { unitPrice } from "@/lib/cost";
import { costYen, dateTime, taxIncluded, toNumber, yen, yenDecimal } from "@/lib/format";
import { addIngredient, deleteIngredient, StoreError, updateIngredient, useStore, whereUsed } from "@/lib/store";
import { allRecipeCosts, costChanges } from "@/lib/recipe-cost";
import { showToast } from "@/lib/toast";
import { useOnce } from "@/lib/use-once";
import { useEffectiveRole } from "@/lib/role";
import { UnlockBeforeDelete } from "@/components/secret-key";
import type { Ingredient, StoreData } from "@/lib/types";
import { changesBaseUnit, ingredientUsages } from "@/lib/unit-change";
import { baseUnitOf, PURCHASE_UNITS, type PurchaseUnit } from "@/lib/units";

/** 一覧で絞り込んでいた種類に戻れるよう、?category= を引き継ぐ */
function listUrl(category: string | null) {
  return category ? `/ingredients?category=${encodeURIComponent(category)}` : "/ingredients";
}

/** 編集を終えたら、開いてきた詳細の画面に戻る（D-074） */
function viewUrl(id: string, category: string | null, returnQ = "") {
  return `/ingredients/view?id=${id}${category ? `&category=${encodeURIComponent(category)}` : ""}${returnQ}`;
}

function isCategory(value: string | null): value is Category {
  return CATEGORIES.some((c) => c === value);
}

/** ?id= があれば編集、なければ新規作成（D-030）。useSearchParams を使うので Suspense の中で使う。 */
export function IngredientEditorPage() {
  const store = useStore();
  const params = useSearchParams();
  const id = params.get("id");
  const category = params.get("category");
  if (!store.loaded) return <Loading />;

  const ingredient = id ? store.data.ingredients.find((i) => i.id === id) : undefined;
  if (id && !ingredient) {
    return (
      <Card className="flex flex-col items-start gap-4">
        <p>材料が見つかりません。削除された可能性があります。</p>
        <LinkButton href="/ingredients" variant="secondary">
          一覧へ戻る
        </LinkButton>
      </Card>
    );
  }
  return (
    <IngredientEditor
      key={ingredient?.id ?? "new"}
      data={store.data}
      ingredient={ingredient}
      defaultCategory={isCategory(category) ? category : undefined}
      // 既にある材料は詳細から来るので詳細へ、新しく作るときは一覧へ戻る
      // 値段の変化・ダッシュボードから来たときは、詳細に戻ったあともそこへ帰れるようにする（D-130）
      backUrl={ingredient ? viewUrl(ingredient.id, category, returnQuery(params)) : listUrl(category)}
      listUrl={listUrl(category)}
      viewUrlOf={(id) => viewUrl(id, category, returnQuery(params))}
    />
  );
}

function IngredientEditor({
  data,
  ingredient,
  defaultCategory,
  backUrl,
  listUrl,
  viewUrlOf,
}: {
  data: StoreData;
  ingredient?: Ingredient;
  defaultCategory?: Category;
  /** 保存・やめるで戻る先（既にある材料は詳細、新規は一覧） */
  backUrl: string;
  /** 削除したあとの戻り先（詳細は開けなくなるため一覧） */
  listUrl: string;
  /** 入れ替えたあとに開く詳細の URL */
  viewUrlOf: (id: string) => string;
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [name, setName] = useState(ingredient?.name ?? "");
  const [supplier, setSupplier] = useState(ingredient?.supplier ?? "");
  const [category, setCategory] = useState<Category>(ingredient?.category ?? defaultCategory ?? "その他");
  const [price, setPrice] = useState(ingredient ? String(ingredient.purchasePrice) : "");
  const [quantity, setQuantity] = useState(ingredient ? String(ingredient.purchaseQuantity) : "1");
  const [unit, setUnit] = useState<PurchaseUnit>(ingredient?.purchaseUnit ?? "kg");
  // 掃除・サク取りで減る分。使える割合（%）で持つ（D-100）
  const [yieldRate, setYieldRate] = useState(ingredient ? String(ingredient.yieldRate) : "100");
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const usedCount = ingredient ? whereUsed(data, "ingredient", ingredient.id).length : 0;
  // 使っている材料でも単位は変えられる。意味が変わる単位（缶 → g など）にしたときは、
  // 分量の数字はそのままで単位だけ変わるので、どこがどう変わるかを見せて確かめてもらう（D-170。D-014 を置き換え）
  const unitChange =
    ingredient && usedCount > 0 && changesBaseUnit(ingredient.purchaseUnit, unit)
      ? { from: baseUnitOf(ingredient.purchaseUnit), to: baseUnitOf(unit), usages: ingredientUsages(data, ingredient.id) }
      : null;
  // 鍵がかかった秘密の中身は見えないので、その中で使っているかは分からない（D-148）
  const hasSealed = [...data.recipes, ...data.preps].some((r) => r.sealed);
  const isAdmin = useEffectiveRole() === "admin";
  const [unlockForDelete, setUnlockForDelete] = useState(false);
  const history = ingredient ? data.priceHistory.filter((h) => h.ingredientId === ingredient.id) : [];

  const input = {
    name,
    category,
    supplier,
    purchasePrice: toNumber(price),
    purchaseQuantity: toNumber(quantity),
    purchaseUnit: unit,
    yieldRate: toNumber(yieldRate),
  };
  // 使える割合を打ち直している途中（空欄・0）は、単価も影響も出さない（D-128）
  const yieldReady = Number.isFinite(input.yieldRate) && input.yieldRate > 0 && input.yieldRate <= 100;
  const preview =
    Number.isInteger(input.purchasePrice) && input.purchaseQuantity > 0 && yieldReady ? unitPrice(input) : null;
  // 「1kg 仕入れて、使えるのは 800g」と見せる（D-100）
  // 税抜で入れてもらい、税込を添える（D-101）
  const purchaseTaxText = Number.isInteger(input.purchasePrice)
    ? `${taxIncluded(input.purchasePrice, data.settings.purchaseTaxRate)}（消費税 ${data.settings.purchaseTaxRate}%）`
    : "金額は税抜で入れてください";
  const rate = toNumber(yieldRate);
  const usableText =
    Number.isFinite(rate) && rate > 0 && rate < 100 && input.purchaseQuantity > 0
      ? `${input.purchaseQuantity}${unit} 仕入れて、使えるのは ${Number(
          (input.purchaseQuantity * rate) / 100,
        ).toFixed(2).replace(/\.?0+$/, "")}${unit}`
      : null;
  // この値段にすると、どのメニューの原価がいくらになるか（保存する前に見せる：D-099）
  const impact =
    ingredient && preview !== null
      ? costChanges(
          allRecipeCosts(data),
          allRecipeCosts({
            ...data,
            ingredients: data.ingredients.map((i) => (i.id === ingredient.id ? { ...i, ...input } : i)),
          }),
        )
      : [];

  const once = useOnce();
  async function run(action: () => Promise<unknown>, message: string, next: string = backUrl) {
    try {
      // 続けて押しても1回だけ（D-157）。成功したら画面を移るので、押せないままにする
      await once.run(async () => {
        await action();
        // 戻ったあとに「保存しました」と知らせる（D-062）
        showToast(message);
        router.push(next);
      });
    } catch (e) {
      if (e instanceof StoreError) setError(e.message);
      else throw e;
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    // 入力欄ごとの誤りがあれば保存せず、欄の下にエラーを出す
    const fieldErrors = [
      validateNumberInput(price, NUMBER_RULES.purchasePrice),
      validateNumberInput(quantity, NUMBER_RULES.purchaseQuantity),
      validateNumberInput(yieldRate, NUMBER_RULES.yieldRate),
    ].filter(Boolean);
    if (name.trim() === "" || fieldErrors.length > 0) {
      setShowErrors(true);
      setError("入力内容を確認してください");
      return;
    }
    // 新しく追加するとき、同じ名前の材料があれば「入れ替える」を選べるようにする（D-075）
    const same = ingredient ? undefined : data.ingredients.find((i) => i.name === name.trim());
    if (same) {
      confirm({
        title: `「${same.name}」はすでにあります`,
        message: "同じ名前の材料があります。今の入力で入れ替えますか？（価格が変わっていれば、履歴に残ります）",
        confirmLabel: "入れ替える",
        onConfirm: () =>
          void run(() => updateIngredient(same.id, input), `「${same.name}」を入れ替えました`, viewUrlOf(same.id)),
      });
      return;
    }
    const doSave = () =>
      run(
        () => (ingredient ? updateIngredient(ingredient.id, input) : addIngredient(input)),
        ingredient ? `「${name.trim()}」を保存しました` : `「${name.trim()}」を追加しました`,
      );
    if (unitChange) {
      confirm({
        title: `単位を ${unitChange.from} → ${unitChange.to} に変えますか？`,
        message: `この材料を使っている${unitChange.usages.length}か所の分量は、数字はそのままで単位だけ ${unitChange.to} に変わります（例：${unitChange.usages[0]?.quantity ?? 1}${unitChange.from} → ${unitChange.usages[0]?.quantity ?? 1}${unitChange.to}）。保存したら、分量が合っているか確かめてください。`,
        confirmLabel: "変えて保存",
        onConfirm: () => void doSave(),
      });
      return;
    }
    await doSave();
  }

  function remove() {
    if (!ingredient) return;
    // オーナーで、鍵がかかった秘密の中身があるときは、先にその場で鍵を開けてもらう（D-174）
    if (hasSealed && isAdmin) {
      setUnlockForDelete(true);
      return;
    }
    confirm({
      title: `「${ingredient.name}」を削除しますか？`,
      message: "元に戻せません。価格の履歴も一緒に消えます。",
      confirmLabel: "削除",
      variant: "danger",
      onConfirm: () => void run(() => deleteIngredient(ingredient.id), `「${ingredient.name}」を削除しました`, listUrl),
    });
  }

  const historyCard = (
    <Card>
      <CardTitle>価格の履歴</CardTitle>
      {history.length === 0 ? (
        <p className="text-sm text-muted">{ingredient ? "まだ価格の変更はありません。" : "保存後、価格を変えると記録されます。"}</p>
      ) : (
        <ul className="flex flex-col text-sm">
          {history.map((h) => (
            <li key={h.id} className="num border-t border-border py-2.5 first:border-0 first:pt-0">
              <span className="block text-xs text-muted">{dateTime(h.changedAt)}</span>
              <span>
                {yen(h.oldPrice)} / {h.oldQuantity}
                {h.oldUnit}
                <span className="mx-1.5 text-subtle">→</span>
                <span className="font-bold">
                  {yen(h.newPrice)} / {h.newQuantity}
                  {h.newUnit}
                </span>
              </span>
              <YieldChangeNote history={h} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );

  return (
    <form onSubmit={(e) => void save(e)}>
      <PageHeader
        back={{ href: backUrl, label: ingredient ? `${ingredient.name}の詳細` : "材料の一覧" }}
        title={ingredient ? ingredient.name : "材料を追加"}
        description="仕入れ価格は税抜で入力します。原価の計算に使う単価は自動で出します"
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start xl:gap-6">
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-5">
            <CardTitle>基本情報</CardTitle>
            <div className="-mt-2">
              <Field label="材料名">
                {(id) => (
                  <>
                    <input
                      id={id}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className={`${inputClass} ${showErrors && name.trim() === "" ? "border-danger" : ""}`}
                      placeholder="牛タン"
                      autoFocus={!ingredient}
                      maxLength={50}
                    />
                    {showErrors && name.trim() === "" && (
                      <p role="alert" className="text-sm font-bold text-danger">
                        材料名を入力してください
                      </p>
                    )}
                  </>
                )}
              </Field>
            </div>
            <ChoiceButtons label="種類" options={CATEGORIES} value={category} onChange={setCategory} />
          </Card>

          <Card className="flex flex-col gap-5">
            <CardTitle>仕入れ</CardTitle>
            <div className="-mt-2">
              <Field label="仕入れ先（任意）">
                {(id) => (
                  <input
                    id={id}
                    value={supplier}
                    onChange={(e) => setSupplier(e.target.value)}
                    className={inputClass}
                    placeholder="例：〇〇精肉店"
                    maxLength={50}
                    autoComplete="off"
                  />
                )}
              </Field>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="仕入れ価格（円・税抜）" hint={purchaseTaxText}>
                {(id) => (
                  <NumberInput
                    id={id}
                    value={price}
                    onChange={setPrice}
                    rule={NUMBER_RULES.purchasePrice}
                    unit="円"
                    placeholder="4500"
                    showErrors={showErrors}
                  />
                )}
              </Field>
              <Field label="仕入れ量">
                {(id) => (
                  <NumberInput
                    id={id}
                    value={quantity}
                    onChange={setQuantity}
                    rule={NUMBER_RULES.purchaseQuantity}
                    unit={unit}
                    showErrors={showErrors}
                  />
                )}
              </Field>
            </div>
            <ChoiceButtons label="単位" options={PURCHASE_UNITS} value={unit} onChange={setUnit} />
            {unitChange && (
              <div role="alert" className="rounded-lg border border-warn bg-warn-soft p-3 text-sm">
                <p className="flex items-center gap-1.5 font-bold">
                  <AlertTriangle className="size-4 shrink-0 text-warn" aria-hidden />
                  単位を {unitChange.from} → {unitChange.to} に変えると、分量の読み方が変わります
                </p>
                <p className="mt-1">数字はそのままで、単位だけが変わります。保存したら、分量が合っているか確かめてください。</p>
                <ul className="mt-2 flex flex-col gap-1">
                  {unitChange.usages.map((u, i) => (
                    <li key={`${u.name}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="min-w-0">
                        {u.name}
                        <span className="ml-1 text-xs text-muted">{u.kind}</span>
                      </span>
                      <span className="num whitespace-nowrap">
                        {u.quantity}
                        {unitChange.from} → <span className="font-bold">{u.quantity}{unitChange.to}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                {hasSealed && (
                  <p className="mt-2 text-xs text-muted">秘密のものの中で使っているかは分かりません。オーナーが鍵を開けたときに確かめてください。</p>
                )}
              </div>
            )}
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label="使える割合（歩留まり）"
                hint={
                  usableText ??
                  "掃除・筋取り・サク取りで減るぶんを引いた割合。減らないものは100のまま"
                }
              >
                {(id) => (
                  <NumberInput
                    id={id}
                    value={yieldRate}
                    onChange={setYieldRate}
                    rule={NUMBER_RULES.yieldRate}
                    unit="%"
                    placeholder="100"
                    showErrors={showErrors}
                  />
                )}
              </Field>
            </div>

            {/* スマホ・タブレット：単価は小さく添える（広い PC は右のパネル。D-054） */}
            <p className="text-sm text-muted xl:hidden">
              単価（参考）：
              <span className="num font-bold text-foreground">{preview === null ? "—" : yenDecimal(preview)}</span> /{" "}
              {baseUnitOf(unit)}
            </p>
          </Card>

          <ErrorMessage message={error} />

          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={once.busy}>
              <Save aria-hidden />
              {once.busy ? "保存しています…" : "保存"}
            </Button>
            <LinkButton href={backUrl} variant="secondary">
              やめる
            </LinkButton>
            {ingredient && (
              <Button variant="danger" onClick={remove} disabled={once.busy} className="ml-auto">
                <Trash2 aria-hidden />
                削除
              </Button>
            )}
          </div>
          {unlockForDelete && <UnlockBeforeDelete what="この材料" onClose={() => setUnlockForDelete(false)} />}

          {ingredient && (
            <Card>
              <CardTitle>この値段にすると</CardTitle>
              {impact.length === 0 ? (
                <p className="text-sm text-muted">
                  {usedCount === 0
                    ? "この材料を使っているメニューはまだありません。"
                    : "原価が変わるメニューはありません（金額を変えると、ここに出ます）。"}
                </p>
              ) : (
                <>
                  <p className="-mt-2 mb-1 text-sm text-muted">{impact.length}品の原価が変わります</p>
                  <ul className="flex flex-col">
                    {impact.map((change) => {
                      const diff = change.after - change.before;
                      const up = diff > 0;
                      return (
                        <li
                          key={change.name}
                          className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 border-t border-border py-2.5 sm:grid-cols-[1fr_6rem_auto]"
                        >
                          <span className="min-w-0 truncate font-bold">{change.name}</span>
                          <span className={`num text-right text-lg font-bold ${up ? "text-danger" : "text-ok"}`}>
                            {up ? "+" : "−"}
                            {costYen(Math.abs(diff))}
                          </span>
                          <span className="num col-span-2 flex items-center justify-between gap-3 text-sm text-muted sm:col-span-1 sm:justify-end">
                            <span>
                              {costYen(change.before)}
                              <span className="mx-1.5 text-subtle">→</span>
                              <span className="font-bold text-foreground">{costYen(change.after)}</span>
                            </span>
                            <RatioBadge ratio={change.ratioAfter} category={change.category} />
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </Card>
          )}

          <div className="xl:hidden">{historyCard}</div>
        </div>

        <div className="hidden flex-col gap-4 xl:sticky xl:top-8 xl:flex">
          {/* 大きく出すのは仕入れ価格。単価（1g あたり）は参考として小さく添える（D-054） */}
          <Card>
            <p className="text-sm font-bold text-muted">仕入れ価格（税抜）</p>
            <p className="mt-1 text-5xl font-bold tracking-tight">
              {Number.isInteger(input.purchasePrice) ? yen(input.purchasePrice) : "—"}
            </p>
            <p className="mt-2 text-muted">
              {input.purchaseQuantity > 0 ? `${input.purchaseQuantity}${unit} あたり` : "仕入れ量を入れると出ます"}
            </p>
            <p className="mt-4 border-t border-border pt-3 text-sm text-muted">
              単価（参考）
              <span className="num ml-1.5 font-bold text-foreground">{preview === null ? "—" : yenDecimal(preview)}</span> /{" "}
              {baseUnitOf(unit)}
            </p>
          </Card>
          {historyCard}
        </div>
      </div>
      {confirmDialog}
    </form>
  );
}
