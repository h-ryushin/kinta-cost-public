"use client";

import { ArrowDownRight, ArrowLeftRight, ArrowUpRight, Beef, ChevronRight, CircleAlert, FlaskConical, Percent, Plus, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { Card, CardTitle, Empty, LinkButton, Loading, PageHeader, RatioBadge, RatioMeter, StatTile } from "@/components/ui";
import { SecretBadge } from "@/components/secret";
import { costYen, dayKey, dayLabel, taxExcluded, timeOfDay, yen } from "@/lib/format";
import { isShownPriceChange, unitRate } from "@/lib/price-impact";
import { isOverTarget, RATIO_KEYS, RATIO_LABEL, ratioTargetOf } from "@/lib/ratio-target";
import { calcRecipeCost } from "@/lib/recipe-cost";
import { useStore } from "@/lib/store";

const RANKING_LIMIT = 10;

export default function DashboardPage() {
  const store = useStore();
  if (!store.loaded) return <Loading />;
  const { data } = store;

  const menus = data.recipes
    .filter((r) => r.kind === "menu")
    .map((r) => ({ recipe: r, ...calcRecipeCost(data, r.items, r.salePrice) }));
  const priced = menus.filter((m) => m.ratio !== null);
  const averageRatio = priced.length > 0 ? priced.reduce((sum, m) => sum + (m.ratio ?? 0), 0) / priced.length : null;
  // 目安は分類ごとに違う（D-102）。ドリンク25%・肉とサイド32%を超えたものを「見直し候補」に数える
  const highCount = priced.filter((m) => isOverTarget(m.ratio ?? 0, m.recipe.category, data.settings.ratioTargets)).length;
  // 原価率が高い順に並べ、見直しが必要なメニューを上に出す
  const ranking = [...priced].sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));
  const draftCount = data.recipes.length - menus.length;

  const ingredientName = new Map(data.ingredients.map((i) => [i.id, i.name]));
  const recentChanges = data.priceHistory.filter(isShownPriceChange).slice(0, 8);
  // 日付ごとにまとめる（新しい順のまま）
  const recentDays = new Map<string, typeof recentChanges>();
  for (const h of recentChanges) recentDays.set(dayKey(h.changedAt), [...(recentDays.get(dayKey(h.changedAt)) ?? []), h]);
  const okCount = priced.filter((m) => (m.ratio ?? 0) <= ratioTargetOf(m.recipe.category, data.settings.ratioTargets).good).length;

  return (
    <>
      <PageHeader
        title="ダッシュボード"
        description="メニューの原価と原価率の状況（売価は税込、原価は税抜）"
        action={
          <LinkButton href="/menus/edit">
            <Plus aria-hidden />
            メニューを追加
          </LinkButton>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatTile
          label="平均原価率"
          icon={Percent}
          value={averageRatio === null ? "—" : averageRatio.toFixed(1)}
          unit={averageRatio === null ? undefined : "%"}
          note={averageRatio === null ? "売価のあるメニューがありません" : `目安内 ${okCount}品 / ${priced.length}品`}
        />
        <StatTile label="見直し候補" icon={CircleAlert} value={String(highCount)} unit="品" note="目安を超えたもの" />
        <StatTile label="メニュー" icon={UtensilsCrossed} value={String(menus.length)} unit="品" href="/menus" note="一覧を見る →" />
        <StatTile
          label="材料"
          icon={Beef}
          value={String(data.ingredients.length)}
          unit="種類"
          href="/ingredients"
          note={`仕込み品 ${data.preps.length}`}
        />
      </div>

      {/* 価格の変化がいちばん大事なので先に出し、原価率の高いメニューはその下に置く */}
      <div className="mt-4 grid gap-4 lg:mt-6 lg:gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardTitle
            action={
              <Link href="/changes?from=home" className="text-sm font-bold text-accent hover:underline">
                影響を見る
              </Link>
            }
          >
            最近の価格変更
          </CardTitle>
          {recentChanges.length === 0 ? (
            <p className="text-sm text-muted">まだ価格の変更はありません。</p>
          ) : (
            <div className="flex flex-col gap-4">
              {[...recentDays].map(([day, items]) => (
                <section key={day}>
                  {/* 日付ごとにまとめる。「今日の変更」がひと目で分かるように（D-107） */}
                  <h3 className="mb-1 text-sm font-bold text-muted">{dayLabel(items[0].changedAt)}</h3>
                  <ul className="flex flex-col">
                    {items.map((h) => {
                      // 単価（1g・1ml・1個あたり、使える割合も入れて）で比べる。仕入れ量やサク取りが変わっても比べられるように（D-126）
                      const rate = unitRate(h);
                      const up = (rate ?? 1) > 1;
                      const change = rate === null ? null : (rate - 1) * 100;
                      return (
                        <li key={h.id} className="border-t border-border">
                          {/* 押すとその材料の詳細を開き、そこから値段を直せる。戻るとダッシュボードに帰る（D-127） */}
                          <Link
                            href={`/ingredients/view?id=${h.ingredientId}&from=home`}
                            className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-muted"
                          >
                            {/* 狭い画面では名前が切れないよう、値上げの率は時刻の横に回す */}
                            <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                              <span className="min-w-0">
                                <span className="block truncate font-bold">{ingredientName.get(h.ingredientId) ?? "（削除済み）"}</span>
                                <span className="num block text-xs text-muted">{timeOfDay(h.changedAt)}</span>
                              </span>
                              {/* 分量の意味が変わる単位の変更は、率では比べられないので「単位の変更」と出す（D-172） */}
                              {rate === null && (
                                <span className="inline-flex shrink-0 items-center gap-0.5 text-sm font-bold text-warn">
                                  <ArrowLeftRight className="size-4" aria-hidden />
                                  単位の変更 {h.oldUnit} → {h.newUnit}
                                </span>
                              )}
                              {change !== null && change !== 0 && (
                                <span
                                  className={`num inline-flex shrink-0 items-center gap-0.5 text-sm font-bold ${up ? "text-danger" : "text-ok"}`}
                                >
                                  {up ? <ArrowUpRight className="size-4" aria-hidden /> : <ArrowDownRight className="size-4" aria-hidden />}
                                  {up ? "値上げ" : "値下げ"} {Math.abs(change).toFixed(1)}%
                                </span>
                              )}
                            </span>
                            <ChevronRight className="size-5 shrink-0 text-subtle" aria-hidden />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardTitle>すぐに使う</CardTitle>
          <div className="grid gap-2">
            <LinkButton href="/ingredients/edit" variant="secondary" className="w-full justify-start">
              <Beef aria-hidden />
              材料を追加
            </LinkButton>
            <LinkButton href="/drafts/edit" variant="secondary" className="w-full justify-start">
              <FlaskConical aria-hidden />
              新メニューを試作
              {draftCount > 0 && <span className="ml-auto text-sm font-normal text-muted">試作中 {draftCount}</span>}
            </LinkButton>
          </div>
        </Card>
        <Card className="xl:col-span-3">
          <CardTitle
            action={
              ranking.length > RANKING_LIMIT && (
                <Link href="/menus" className="text-sm font-bold text-accent hover:underline">
                  すべて見る
                </Link>
              )
            }
          >
            原価率の高いメニュー
          </CardTitle>
          {ranking.length === 0 ? (
            <Empty>売価を登録したメニューがありません。</Empty>
          ) : (
            <>
              <ul className="flex flex-col">
                {ranking.slice(0, RANKING_LIMIT).map(({ recipe, total, ratio, saleWithoutTax }) => (
                  <li key={recipe.id} className="border-t border-border first:border-0">
                    <Link
                      href={`/menus/view?id=${recipe.id}`}
                      className="-mx-2 grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 rounded-lg px-2 py-3 hover:bg-surface-muted sm:grid-cols-[minmax(0,13rem)_1fr_auto]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-bold">
                          {recipe.name}
                          {recipe.secret && (
                            <>
                              {" "}
                              <SecretBadge />
                            </>
                          )}
                        </span>
                        <span className="num block text-sm text-muted">
                          原価 {costYen(total)} ／ 売価 {yen(recipe.salePrice ?? 0)}（{taxExcluded(saleWithoutTax ?? 0)}）
                        </span>
                      </span>
                      <RatioMeter
                        ratio={ratio}
                        category={recipe.category}
                        className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto"
                      />
                      <span className="col-start-2 row-start-1 sm:col-start-auto sm:row-start-auto">
                        <RatioBadge ratio={ratio} category={recipe.category} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted">
                メーターは 0〜60%。白い線はその分類の目安（{RATIO_KEYS.map((k) => `${RATIO_LABEL[k]} ${data.settings.ratioTargets[k].good}・${data.settings.ratioTargets[k].high}%`).join("、")}）。
              </p>
            </>
          )}
        </Card>

      </div>
    </>
  );
}
