"use client";

import { Pencil, Store } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Card, CardTitle, LinkButton, Loading, PageHeader, RatioBadge } from "@/components/ui";
import { YieldChangeNote } from "@/components/yield-change";
import { changesBackHref, returnQuery } from "@/lib/changes-link";
import { unitPrice } from "@/lib/cost";
import { costYen, dateTime, taxIncluded, yen, yenDecimal } from "@/lib/format";
import { isShownPriceChange } from "@/lib/price-impact";
import { calcRecipeCost, prepBatchCost } from "@/lib/recipe-cost";
import { useStore } from "@/lib/store";
import type { Ingredient, StoreData } from "@/lib/types";
import { baseUnitOf } from "@/lib/units";

/** 一覧で絞り込んでいた種類に戻れるよう、?category= を引き継ぐ */
function listUrl(category: string | null) {
  return category ? `/ingredients?category=${encodeURIComponent(category)}` : "/ingredients";
}

/**
 * 材料の詳細（表示だけ）の画面（D-074）。
 * 一覧から開いたときは、いきなり入力欄ではなくこの画面を出し、直すときだけ編集に進む。
 */
export function IngredientViewPage() {
  const store = useStore();
  const params = useSearchParams();
  const id = params.get("id");
  const category = params.get("category");
  if (!store.loaded) return <Loading />;

  const ingredient = store.data.ingredients.find((i) => i.id === id);
  if (!ingredient) {
    return (
      <Card className="flex flex-col items-start gap-4">
        <p>材料が見つかりません。削除された可能性があります。</p>
        <LinkButton href="/ingredients" variant="secondary">
          一覧へ戻る
        </LinkButton>
      </Card>
    );
  }
  // 「値段の変化」から開いたときはそこへ、ダッシュボードの「最近の価格変更」から開いたときはダッシュボードへ戻る（D-108・D-127）
  const from = params.get("from");
  const back =
    from === "changes"
      ? { href: changesBackHref(params), label: "値段の変化" }
      : from === "home"
        ? { href: "/", label: "ダッシュボード" }
        : { href: listUrl(category), label: "材料の一覧" };
  return <IngredientView data={store.data} ingredient={ingredient} back={back} categoryParam={category} returnQ={returnQuery(params)} />;
}

function IngredientView({
  data,
  ingredient,
  back,
  categoryParam,
  returnQ,
}: {
  data: StoreData;
  ingredient: Ingredient;
  back: { href: string; label: string };
  categoryParam: string | null;
  /** 開いてきた画面（値段の変化・ダッシュボード）の印。編集へ引き継ぐ（D-130） */
  returnQ: string;
}) {
  // 単位の言い換えだけの記録は出さない（D-098）。単位の変更は出す（D-172・D-175）
  const history = data.priceHistory.filter((h) => h.ingredientId === ingredient.id && isShownPriceChange(h));
  // この材料を使っているメニュー・仕込み品と、その原価（D-097）
  const usedByRecipes = data.recipes
    .filter((r) => r.items.some((i) => i.type === "ingredient" && i.id === ingredient.id))
    .map((r) => ({ name: r.name, category: r.category as string | null, ...calcRecipeCost(data, r.items, r.salePrice) }));
  const usedByPreps = data.preps
    .filter((p) => p.items.some((i) => i.type === "ingredient" && i.id === ingredient.id))
    .map((p) => ({ name: p.name, category: null as string | null, total: prepBatchCost(data.ingredients, p), ratio: null as number | null }));
  const usedBy = [...usedByRecipes, ...usedByPreps].sort((a, b) => b.total - a.total);
  const base = baseUnitOf(ingredient.purchaseUnit);
  const editUrl = `/ingredients/edit?id=${ingredient.id}${categoryParam ? `&category=${encodeURIComponent(categoryParam)}` : ""}${returnQ}`;

  return (
    <>
      <PageHeader
        back={back}
        title={ingredient.name}
        description={ingredient.category}
        action={
          <LinkButton href={editUrl}>
            <Pencil aria-hidden />
            編集
          </LinkButton>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start xl:gap-6">
        <div className="flex flex-col gap-4">
          <Card>
            <p className="text-sm font-bold text-muted">仕入れ価格（税抜）</p>
            <p className="mt-1 text-4xl font-bold tracking-tight">{yen(ingredient.purchasePrice)}</p>
            <p className="num text-sm text-muted">
              {taxIncluded(ingredient.purchasePrice, data.settings.purchaseTaxRate)}
            </p>
            <p className="num mt-2 text-muted">
              {ingredient.purchaseQuantity}
              {ingredient.purchaseUnit} あたり
              {ingredient.yieldRate < 100 && (
                <span className="ml-2 rounded bg-track px-2 py-0.5 text-sm">
                  使えるのは {ingredient.yieldRate}%（
                  {Number(((ingredient.purchaseQuantity * ingredient.yieldRate) / 100).toFixed(3))}
                  {ingredient.purchaseUnit}）
                </span>
              )}
            </p>
            <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4">
              <div>
                <dt className="text-sm text-muted">単価（参考）</dt>
                <dd className="num text-lg font-bold">
                  {yenDecimal(unitPrice(ingredient))}
                  <span className="text-sm font-normal text-muted"> / {base}</span>
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted">更新</dt>
                <dd className="num text-sm">{dateTime(ingredient.updatedAt)}</dd>
              </div>
            </dl>
            <p className="mt-4 flex items-center gap-1.5 border-t border-border pt-4 text-muted">
              <Store className="size-4 shrink-0" aria-hidden />
              {ingredient.supplier || "仕入れ先 未設定"}
            </p>
          </Card>

          <Card>
            <CardTitle>この材料を使っているもの</CardTitle>
            {usedBy.length === 0 ? (
              <p className="text-sm text-muted">まだどこでも使っていません。</p>
            ) : (
              <>
                <p className="-mt-2 mb-2 text-sm text-muted">価格を変えると、ここに出ているものの原価が変わります。</p>
                <ul className="flex flex-col">
                  {usedBy.map((u) => (
                    // 原価が小数第1位まで出て長くなったので（D-171）、狭い画面では金額と原価率を名前の下に回す
                    <li key={u.name} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border py-2.5 first:border-0">
                      <span className="min-w-0 max-w-full truncate font-bold">{u.name}</span>
                      <span className="ml-auto flex shrink-0 items-center gap-3">
                        <span className="num text-sm">{costYen(u.total)}</span>
                        {u.ratio !== null && <RatioBadge ratio={u.ratio} category={u.category} />}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </div>

        <Card>
          <CardTitle>価格の履歴</CardTitle>
          {history.length === 0 ? (
            <p className="text-sm text-muted">まだ価格の変更はありません。</p>
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
      </div>
    </>
  );
}
