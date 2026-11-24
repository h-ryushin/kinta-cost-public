"use client";

import { Plus, Search, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { CategoryChips, parseCategory } from "@/components/category-chips";
import { SecretBadge } from "@/components/secret";
import { Button, Empty, GroupHeading, inputClass, LinkButton, Loading, PageHeader, RatioBadge, RatioMeter } from "@/components/ui";
import { isDrinkCategory, MENU_CATEGORIES, type MenuCategory } from "@/lib/categories";
import { costYen, taxExcluded, yen } from "@/lib/format";
import { calcRecipeCost } from "@/lib/recipe-cost";
import { matchesSearch } from "@/lib/search";
import { guessMenuCategory } from "@/lib/menu-classifier";
import { classifyOtherRecipes, useStore } from "@/lib/store";
import { useOnce } from "@/lib/use-once";
import type { Recipe, RecipeKind } from "@/lib/types";

const TEXT: Record<RecipeKind, { title: string; description: string; add: string; empty: string; base: string }> = {
  menu: {
    title: "メニュー",
    description: "お店のメニューごとの原価・原価率・粗利（売価は税込、原価と粗利は税抜）",
    add: "メニューを追加",
    empty: "まだメニューがありません。",
    base: "/menus",
  },
  draft: {
    title: "創作レシピ",
    description: "メニューに載せる前の試作。原価と原価率を試算できます",
    add: "新しく試作",
    empty: "まだ創作レシピがありません。新メニューの原価を試算できます。",
    base: "/drafts",
  },
};

type Row = { recipe: Recipe; total: number; ratio: number | null; saleWithoutTax: number | null; profit: number | null };

export function RecipeList({ kind }: { kind: RecipeKind }) {
  // ?category= を読むので Suspense で包む
  return (
    <Suspense fallback={<Loading />}>
      <RecipeListContent kind={kind} />
    </Suspense>
  );
}

function RecipeListContent({ kind }: { kind: RecipeKind }) {
  const store = useStore();
  const filter = parseCategory(MENU_CATEGORIES, useSearchParams().get("category"));
  const [query, setQuery] = useState("");
  // 「名前から振り分ける」を続けて押しても1回だけ（D-157）
  const classify = useOnce();
  const text = TEXT[kind];
  if (!store.loaded) return <Loading />;
  const { data } = store;

  const all = data.recipes.filter((r) => r.kind === kind);
  const matched: Row[] = all
    .filter((r) => filter === null || r.category === filter)
    // 名前と分類で探す。かなとカタカナなどのゆらぎは吸収する（D-076）
    .filter((r) => matchesSearch(query, r.name, r.category))
    .map((r) => ({ recipe: r, ...calcRecipeCost(data, r.items, r.salePrice) }))
    .sort((a, b) => a.recipe.name.localeCompare(b.recipe.name, "ja"));
  // お店のメニュー表と同じ分類の順番（MENU_CATEGORIES）で見出しを付けて並べる
  const groups = MENU_CATEGORIES.map((category) => ({
    category,
    rows: matched.filter((m) => m.recipe.category === category),
  })).filter((g) => g.rows.length > 0);
  const countOf = (c: MenuCategory) => all.filter((r) => r.category === c).length;
  const categoryParam = filter ? `category=${encodeURIComponent(filter)}` : "";
  // 一覧からは詳細（表示だけ）を開く。直すときはそこから編集へ進む（D-084）
  const viewUrl = (id: string) => `${text.base}/view?id=${id}${categoryParam ? `&${categoryParam}` : ""}`;
  // 「その他」のうち、名前から分類を推測できるもの（D-041）
  const classifiable = all.filter((r) => r.category === "その他" && guessMenuCategory(r.name) !== null).length;

  return (
    <>
      <PageHeader
        title={text.title}
        description={text.description}
        action={
          <LinkButton href={`${text.base}/edit${categoryParam ? `?${categoryParam}` : ""}`}>
            <Plus aria-hidden />
            {text.add}
          </LinkButton>
        }
      />

      {classifiable > 0 && (
        <div className="mb-4 flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2">
            <Sparkles className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
            <span>
              分類が「その他」のうち <span className="font-bold">{classifiable}件</span> は、名前から分類を振り分けられます。
            </span>
          </p>
          <Button
            onClick={() => void classify.run(async () => void (await classifyOtherRecipes()), { release: true })}
            disabled={classify.busy}
            className="shrink-0"
          >
            {classify.busy ? "振り分けています…" : "名前から振り分ける"}
          </Button>
        </div>
      )}

      {all.length > 0 && (
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <CategoryChips categories={MENU_CATEGORIES} selected={filter} countOf={countOf} total={all.length} basePath={text.base} />
          </div>
          <label className="relative block lg:w-64">
            <span className="sr-only">名前で探す</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="名前・分類で探す"
              className={`${inputClass} pl-9`}
            />
          </label>
        </div>
      )}

      {all.length === 0 ? (
        <Empty>{text.empty}</Empty>
      ) : groups.length === 0 ? (
        <Empty>当てはまるものがありません。</Empty>
      ) : (
        <>
          {/* PC：分類ごとに見出しと表を分ける（D-046）。列の幅はどの表でも同じにそろえる */}
          <div className="hidden flex-col gap-8 lg:flex">
            {groups.map((group) => (
              <section key={group.category}>
                <GroupHeading label={categoryHeading(group.category)} count={group.rows.length} />
                <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
                  <table className="w-full table-fixed text-left">
                    <colgroup>
                      <col className="w-[32%]" />
                      <col className="w-[12%]" />
                      <col className="w-[12%]" />
                      <col className="w-[12%]" />
                      <col />
                    </colgroup>
                    <thead className="border-b border-border bg-surface-muted text-sm text-muted">
                      <tr>
                        <th className="px-5 py-2.5 font-bold">名前</th>
                        <th className="px-3 py-2.5 text-right font-bold">売価（税込）</th>
                        <th className="px-3 py-2.5 text-right font-bold">原価（税抜）</th>
                        <th className="px-3 py-2.5 text-right font-bold">粗利</th>
                        <th className="px-5 py-2.5 font-bold">原価率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((row) => (
                        <RecipeTableRow key={row.recipe.id} row={row} href={viewUrl(row.recipe.id)} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>

          {/* スマホ・タブレット：カード */}
          <div className="flex flex-col gap-8 lg:hidden">
            {groups.map((group) => (
              <section key={group.category}>
                <GroupHeading label={categoryHeading(group.category)} count={group.rows.length} />
                <ul className="grid gap-3 sm:grid-cols-2">
                  {group.rows.map(({ recipe, total, ratio, saleWithoutTax, profit }) => (
                    <li key={recipe.id}>
                      <Link
                        href={viewUrl(recipe.id)}
                        className="block h-full rounded-xl border border-border bg-surface p-4 shadow-card hover:border-accent"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <span className="min-w-0 wrap-break-word font-bold">
                            {recipe.name}
                            {recipe.secret && (
                              <>
                                {" "}
                                <SecretBadge />
                              </>
                            )}
                          </span>
                          <RatioBadge ratio={ratio} category={recipe.category} />
                        </div>
                        <RatioMeter ratio={ratio} category={recipe.category} className="mt-3" />
                        <p className="num mt-3 flex flex-wrap gap-x-4 text-sm text-muted">
                          <span className="whitespace-nowrap">
                            原価 <span className="font-bold text-foreground">{costYen(total)}</span>
                          </span>
                          {recipe.salePrice !== null && saleWithoutTax !== null && profit !== null && (
                            <>
                              <span className="whitespace-nowrap">
                                {/* 売価は税込（保存した値段：D-181）を主に出し、税抜を添える（D-180） */}
                                売価 <span className="font-bold text-foreground">{yen(recipe.salePrice)}</span>（{taxExcluded(saleWithoutTax)}）
                              </span>
                              <span className="whitespace-nowrap">粗利 {costYen(profit)}</span>
                            </>
                          )}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/** 一覧の見出し。ドリンクは「ドリンク ／ ビール」のように、まとまりの名前も付ける（D-042） */
function categoryHeading(category: MenuCategory): string {
  return isDrinkCategory(category) ? `ドリンク ／ ${category}` : category;
}

function RecipeTableRow({ row, href }: { row: Row; href: string }) {
  const router = useRouter();
  const { recipe, total, ratio, saleWithoutTax, profit } = row;
  return (
    <tr
      onClick={() => router.push(href)}
      className="cursor-pointer border-t border-border transition-colors first:border-0 hover:bg-surface-muted"
    >
      <td className="px-5 py-3">
        <span className="flex items-center gap-2">
          {/* 行のどこを押しても開くが、キーボードでも開けるようリンクも置く */}
          <Link href={href} className="min-w-0 truncate font-bold hover:text-accent" onClick={(e) => e.stopPropagation()}>
            {recipe.name}
          </Link>
          {recipe.secret && <SecretBadge />}
        </span>
      </td>
      <td className="num px-3 py-3 text-right">
        {recipe.salePrice === null ? (
          "—"
        ) : (
          <>
            {/* 税込（保存した値段：D-181）を大きく、税抜を下に小さく出す（D-180） */}
            {yen(recipe.salePrice)}
            {saleWithoutTax !== null && <span className="block text-xs text-muted">{taxExcluded(saleWithoutTax)}</span>}
          </>
        )}
      </td>
      <td className="num px-3 py-3 text-right font-bold">{costYen(total)}</td>
      <td className="num px-3 py-3 text-right">{profit === null ? "—" : costYen(profit)}</td>
      <td className="px-5 py-3">
        <div className="flex items-center gap-4">
          <RatioMeter ratio={ratio} category={recipe.category} className="flex-1" />
          <span className="w-32 shrink-0">
            <RatioBadge ratio={ratio} category={recipe.category} />
          </span>
        </div>
      </td>
    </tr>
  );
}
