"use client";

import { BadgeCheck, Copy, Pencil } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { parseCategory } from "@/components/category-chips";
import { CostPanel } from "@/components/cost-panel";
import { SecretBadge } from "@/components/secret";
import { PlainSecretNotice, SecretContentsCard } from "@/components/secret-key";
import { Card, CardTitle, LinkButton, Loading, PageHeader } from "@/components/ui";
import { MENU_CATEGORIES } from "@/lib/categories";
import { changesBackHref, returnQuery } from "@/lib/changes-link";
import { costYen, yen } from "@/lib/format";
import { calcRecipeCost } from "@/lib/recipe-cost";
import { useStore } from "@/lib/store";
import type { Recipe, RecipeKind, StoreData } from "@/lib/types";
import { useEffectiveRole } from "@/lib/role";

const BASE: Record<RecipeKind, string> = { menu: "/menus", draft: "/drafts" };
const LABEL: Record<RecipeKind, string> = { menu: "メニュー", draft: "創作レシピ" };

/**
 * メニュー・創作レシピの詳細（表示だけ）の画面（D-084）。
 * 一覧から開いたときは、いきなり入力欄ではなくこの画面を出し、直すときだけ編集に進む。
 */
export function RecipeViewPage({ kind }: { kind: RecipeKind }) {
  const store = useStore();
  const role = useEffectiveRole();
  const params = useSearchParams();
  const id = params.get("id");
  const filter = parseCategory(MENU_CATEGORIES, params.get("category"));
  // 「値段の変化」から開いたときは、そこへ戻る（D-108）
  const fromChanges = params.get("from") === "changes";
  const listUrl = filter ? `${BASE[kind]}?category=${encodeURIComponent(filter)}` : BASE[kind];
  const back = fromChanges ? { href: changesBackHref(params), label: "値段の変化" } : { href: listUrl, label: `${LABEL[kind]}の一覧` };
  if (!store.loaded) return <Loading />;

  const recipe = store.data.recipes.find((r) => r.id === id && r.kind === kind);
  if (!recipe) {
    return (
      <Card className="flex flex-col items-start gap-4">
        <p>{LABEL[kind]}が見つかりません。削除された可能性があります。</p>
        <LinkButton href={back.href} variant="secondary">
          {fromChanges ? "値段の変化へ戻る" : "一覧へ戻る"}
        </LinkButton>
      </Card>
    );
  }
  const categoryParam = filter ? `&category=${encodeURIComponent(filter)}` : "";
  return (
    <RecipeView
      kind={kind}
      data={store.data}
      recipe={recipe}
      back={back}
      editUrl={`${BASE[kind]}/edit?id=${recipe.id}${categoryParam}${returnQuery(params)}`}
      // 秘密のものは、社員には中身を見せない（D-060）。オーナーも鍵を開けるまでは見えない（D-148）
      hideContents={recipe.secret && (role === "staff" || Boolean(recipe.sealed))}
      canUnlock={role !== "staff"}
    />
  );
}

/** 詳細（表示だけ）の画面。編集画面でも、秘密の中身に鍵がかかっているときはこれを出す */
export function RecipeView({
  kind,
  data,
  recipe,
  back,
  editUrl,
  hideContents,
  canUnlock,
}: {
  kind: RecipeKind;
  data: StoreData;
  recipe: Recipe;
  back: { href: string; label: string };
  editUrl: string;
  hideContents: boolean;
  /** オーナーのとき。中身の代わりに鍵を開ける欄を出す（D-148） */
  canUnlock: boolean;
}) {
  const { lines, total, ratio, saleWithoutTax, profit } = calcRecipeCost(data, recipe.items, recipe.salePrice);

  return (
    <>
      <PageHeader
        back={back}
        title={recipe.name}
        description={recipe.secret ? `${recipe.category}・秘密の${LABEL[kind]}` : recipe.category}
        action={
          hideContents ? undefined : (
            <>
              {kind === "draft" && (
                <LinkButton href={`${BASE[kind]}/edit?id=${recipe.id}`} variant="secondary">
                  <BadgeCheck aria-hidden />
                  <span className="hidden sm:inline">メニューに登録</span>
                  <span className="sm:hidden">登録</span>
                </LinkButton>
              )}
              <LinkButton href={editUrl}>
                <Pencil aria-hidden />
                編集
              </LinkButton>
            </>
          )
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start xl:gap-6">
        <div className="flex flex-col gap-4">
          {canUnlock && recipe.plainSecret && <PlainSecretNotice />}
          {hideContents ? (
            <SecretContentsCard what={`この${LABEL[kind]}の中身（材料・使用量・メモ）`} item={recipe} priceHistory={data.priceHistory} canUnlock={canUnlock} />
          ) : (
            <>
              <Card>
                <CardTitle action={recipe.secret ? <SecretBadge /> : undefined}>材料と使用量（1人前）</CardTitle>
                {lines.length === 0 ? (
                  <p className="text-sm text-muted">材料がまだ入っていません。</p>
                ) : (
                  <ul className="flex flex-col">
                    {lines.map((line, i) => (
                      <li key={i} className="flex items-center justify-between gap-3 border-t border-border py-2.5 first:border-0 first:pt-0">
                        <span className="min-w-0 truncate font-bold">
                          {line.resolved?.name ?? "（削除された材料）"}
                          {recipe.items[i]?.type === "temp" && (
                            <span className="ml-2 rounded bg-track px-1.5 py-0.5 text-xs font-normal text-muted">仮</span>
                          )}
                        </span>
                        <span className="num shrink-0 whitespace-nowrap text-sm text-muted">
                          {recipe.items[i]?.type === "temp" ? "" : `${line.quantity}${line.resolved?.baseUnit ?? ""}`}
                          <span className="ml-3 font-bold text-foreground">{line.cost === null ? "—" : costYen(line.cost)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              {recipe.salePrice !== null && (
                <Card>
                  <CardTitle>売価</CardTitle>
                  {/* 税込（保存した値段：D-181）を大きく、税抜を小さく並べる（D-180） */}
                  <dl className="grid grid-cols-2 items-end gap-3">
                    <div>
                      <dt className="text-sm text-muted">税込{data.settings.saleTaxRate}%</dt>
                      <dd className="num text-2xl font-bold">{yen(recipe.salePrice)}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted">税抜</dt>
                      <dd className="num text-lg text-muted">{saleWithoutTax === null ? "—" : yen(saleWithoutTax)}</dd>
                    </div>
                  </dl>
                </Card>
              )}

              {recipe.memo.trim() !== "" && (
                <Card>
                  <CardTitle>メモ</CardTitle>
                  <p className="whitespace-pre-wrap text-sm">{recipe.memo}</p>
                </Card>
              )}

              <div className="flex flex-wrap gap-3">
                <LinkButton
                  href={`${BASE[kind]}/edit?copy=${recipe.id}&category=${encodeURIComponent(recipe.category)}`}
                  variant="secondary"
                >
                  <Copy aria-hidden />
                  コピーして別の商品を作る
                </LinkButton>
              </div>
            </>
          )}
        </div>

        <CostPanel
          title="原価（1人前・税抜）"
          total={total}
          lines={hideContents ? [] : lines}
          salePrice={recipe.salePrice}
          saleWithoutTax={saleWithoutTax}
          profit={profit}
          ratio={ratio}
          category={recipe.category}
          showTotal
        />
      </div>
    </>
  );
}
