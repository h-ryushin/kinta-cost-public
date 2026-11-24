"use client";

import { Plus, Search, Store } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { CategoryChips, parseCategory } from "@/components/category-chips";
import { SecretBadge } from "@/components/secret";
import { Empty, GroupHeading, inputClass, LinkButton, Loading, PageHeader } from "@/components/ui";
import { CATEGORIES, type Category } from "@/lib/categories";
import { unitPrice } from "@/lib/cost";
import { costYen, dateTime, yen, yenDecimal } from "@/lib/format";
import { prepBatchCost, prepCostSource } from "@/lib/recipe-cost";
import { matchesSearch } from "@/lib/search";
import { useStore } from "@/lib/store";
import type { StoreData } from "@/lib/types";
import { baseUnitOf } from "@/lib/units";

export default function IngredientsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <IngredientsTabs />
    </Suspense>
  );
}

function IngredientsTabs() {
  const store = useStore();
  // 編集画面から戻ったときにタブと絞り込みを保てるよう、URL（?tab=prep、?category=肉）で持つ
  const params = useSearchParams();
  const tab = params.get("tab") === "prep" ? "prep" : "ingredient";
  const filter = parseCategory(CATEGORIES, params.get("category"));
  if (!store.loaded) return <Loading />;
  const { data } = store;

  const tabClass = (active: boolean) =>
    `flex min-h-10 items-center justify-center rounded-md px-4 text-sm font-bold transition-colors ${
      active ? "bg-surface text-foreground shadow-card" : "text-muted hover:text-foreground"
    }`;
  const addHref =
    tab === "prep" ? "/preps/edit" : `/ingredients/edit${filter ? `?category=${encodeURIComponent(filter)}` : ""}`;

  return (
    <>
      <PageHeader
        title="材料・仕込み品"
        description={
          tab === "prep"
            ? "味ネギやタレなど、材料を合わせて先に作っておくもの。メニューで材料と同じように選べます"
            : "仕入れ価格と量から、1g・1ml・1個あたりの単価を出します"
        }
        action={
          <LinkButton href={addHref}>
            <Plus aria-hidden />
            {tab === "prep" ? "仕込み品を追加" : "材料を追加"}
          </LinkButton>
        }
      />
      <div className="mb-4 inline-flex gap-1 rounded-lg bg-track p-1" role="tablist">
        <Link href="/ingredients" replace role="tab" aria-selected={tab === "ingredient"} className={tabClass(tab === "ingredient")}>
          材料 <span className="num ml-1.5 font-normal text-muted">{data.ingredients.length}</span>
        </Link>
        <Link href="/ingredients?tab=prep" replace role="tab" aria-selected={tab === "prep"} className={tabClass(tab === "prep")}>
          仕込み品 <span className="num ml-1.5 font-normal text-muted">{data.preps.length}</span>
        </Link>
      </div>
      {tab === "ingredient" ? <IngredientList data={data} filter={filter} /> : <PrepList data={data} />}
    </>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="relative block lg:w-64">
      <span className="sr-only">材料名・仕入れ先で探す</span>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="材料名・仕入れ先で探す"
        className={`${inputClass} pl-9`}
      />
    </label>
  );
}

const TABLE = "hidden overflow-hidden rounded-xl border border-border bg-surface shadow-card lg:block";
const TH = "px-3 py-3 font-bold first:pl-5 last:pr-5";
const TD = "px-3 py-3 first:pl-5 last:pr-5";

function IngredientList({ data, filter }: { data: StoreData; filter: Category | null }) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const matched = data.ingredients
    // 材料名・仕入れ先・種類で探す。かなとカタカナなどのゆらぎは吸収する（D-076）
    .filter((i) => matchesSearch(query, i.name, i.supplier, i.category))
    .filter((i) => filter === null || i.category === filter)
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
  // 種類の順番（CATEGORIES）で見出しを付けて並べる
  const groups = CATEGORIES.map((category) => ({
    category,
    items: matched.filter((i) => i.category === category),
  })).filter((g) => g.items.length > 0);
  const countOf = (c: Category) => data.ingredients.filter((i) => i.category === c).length;
  const categoryParam = filter ? `&category=${encodeURIComponent(filter)}` : "";
  // 一覧からは詳細（表示だけ）を開く。直すときはそこから編集へ進む（D-074）
  const viewUrl = (id: string) => `/ingredients/view?id=${id}${categoryParam}`;

  if (data.ingredients.length === 0) {
    return <Empty>まだ材料がありません。「材料を追加」から登録してください。</Empty>;
  }

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <CategoryChips categories={CATEGORIES} selected={filter} countOf={countOf} total={data.ingredients.length} basePath="/ingredients" />
        </div>
        <SearchBox value={query} onChange={setQuery} />
      </div>

      {groups.length === 0 ? (
        <Empty>当てはまる材料がありません。</Empty>
      ) : (
        <>
          {/* PC：種類ごとに見出しと表を分ける（D-046）。列の幅はどの表でも同じにそろえる */}
          <div className="hidden flex-col gap-8 lg:flex">
            {groups.map((group) => (
              <section key={group.category}>
                <GroupHeading label={group.category} count={group.items.length} />
                <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
                  <table className="w-full table-fixed text-left">
                    <colgroup>
                      <col className="w-[28%]" />
                      <col className="w-[26%]" />
                      <col className="w-[16%]" />
                      <col className="w-[13%]" />
                      <col />
                    </colgroup>
                    <thead className="border-b border-border bg-surface-muted text-sm text-muted">
                      <tr>
                        <th className={TH}>材料名</th>
                        <th className={TH}>仕入れ先</th>
                        <th className={`${TH} text-right`}>仕入れ価格</th>
                        <th className={`${TH} text-right`}>仕入れ量</th>
                        <th className={`${TH} text-right`}>更新</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((ingredient) => (
                        <tr
                          key={ingredient.id}
                          onClick={() => router.push(viewUrl(ingredient.id))}
                          className="cursor-pointer border-t border-border transition-colors first:border-0 hover:bg-surface-muted"
                        >
                          <td className={TD}>
                            <Link href={viewUrl(ingredient.id)} className="font-bold hover:text-accent" onClick={(e) => e.stopPropagation()}>
                              {ingredient.name}
                            </Link>
                          </td>
                          <td className={`${TD} truncate text-sm text-muted`}>{ingredient.supplier || "—"}</td>
                          <td className={`${TD} num text-right font-bold`}>{yen(ingredient.purchasePrice)}</td>
                          <td className={`${TD} num text-right`}>
                            {ingredient.purchaseQuantity}
                            {ingredient.purchaseUnit}
                          </td>
                          <td className={`${TD} num text-right text-sm text-muted`}>{dateTime(ingredient.updatedAt)}</td>
                        </tr>
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
                <GroupHeading label={group.category} count={group.items.length} />
                <ul className="grid gap-3 sm:grid-cols-2">
                  {group.items.map((ingredient) => (
                    <li key={ingredient.id}>
                      <Link
                        href={viewUrl(ingredient.id)}
                        className="block h-full rounded-xl border border-border bg-surface p-4 shadow-card hover:border-accent"
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 wrap-break-word font-bold">{ingredient.name}</span>
                          <span className="num shrink-0 whitespace-nowrap text-lg font-bold">
                            {yen(ingredient.purchasePrice)}
                          </span>
                        </div>
                        <p className="num mt-1 text-sm text-muted">
                          {ingredient.purchaseQuantity}
                          {ingredient.purchaseUnit} あたり
                        </p>
                        {/* 単価より仕入れ先のほうが要るので、ここは仕入れ先にする（D-063） */}
                        <p className="mt-1 flex items-center gap-1 text-sm text-muted">
                          <Store className="size-3.5 shrink-0" aria-hidden />
                          <span className="min-w-0 truncate">{ingredient.supplier || "仕入れ先 未設定"}</span>
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

function PrepList({ data }: { data: StoreData }) {
  const router = useRouter();
  const list = [...data.preps].sort((a, b) => a.name.localeCompare(b.name, "ja"));
  if (list.length === 0) return <Empty>まだ仕込み品がありません。</Empty>;
  // 一覧からは詳細（表示だけ）を開く（D-084）
  const viewUrl = (id: string) => `/preps/view?id=${id}`;

  return (
    <>
      {/* PC：表 */}
      <div className={TABLE}>
        <table className="w-full text-left">
          <thead className="border-b border-border bg-surface-muted text-sm text-muted">
            <tr>
              <th className={TH}>仕込み品</th>
              <th className={`${TH} text-right`}>1回分の原価</th>
              <th className={`${TH} text-right`}>出来上がり量</th>
              <th className={`${TH} text-right`}>単価</th>
              <th className={`${TH} text-right`}>更新</th>
            </tr>
          </thead>
          <tbody>
            {list.map((prep) => (
              <tr
                key={prep.id}
                onClick={() => router.push(viewUrl(prep.id))}
                className="cursor-pointer border-t border-border transition-colors first:border-0 hover:bg-surface-muted"
              >
                <td className={TD}>
                  <span className="flex items-center gap-2">
                    <Link href={viewUrl(prep.id)} className="font-bold hover:text-accent" onClick={(e) => e.stopPropagation()}>
                      {prep.name}
                    </Link>
                    {prep.secret && <SecretBadge />}
                  </span>
                </td>
                <td className={`${TD} num text-right`}>{costYen(prepBatchCost(data.ingredients, prep))}</td>
                <td className={`${TD} num text-right`}>
                  {prep.yieldQuantity}
                  {prep.yieldUnit}
                </td>
                <td className={`${TD} num text-right font-bold`}>
                  {yenDecimal(unitPrice(prepCostSource(data.ingredients, prep)))}
                  <span className="font-normal text-muted"> / {baseUnitOf(prep.yieldUnit)}</span>
                </td>
                <td className={`${TD} num text-right text-sm text-muted`}>{dateTime(prep.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* スマホ・タブレット：カード */}
      <ul className="grid gap-3 sm:grid-cols-2 lg:hidden">
        {list.map((prep) => (
          <li key={prep.id}>
            <Link
              href={viewUrl(prep.id)}
              className="block h-full rounded-xl border border-border bg-surface p-4 shadow-card hover:border-accent"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 wrap-break-word font-bold">
                  {prep.name}
                  {prep.secret && (
                    <>
                      {" "}
                      <SecretBadge />
                    </>
                  )}
                </span>
                <span className="num shrink-0 whitespace-nowrap font-bold">
                  {yenDecimal(unitPrice(prepCostSource(data.ingredients, prep)))}
                  <span className="text-sm font-normal text-muted"> / {baseUnitOf(prep.yieldUnit)}</span>
                </span>
              </div>
              <p className="num mt-1 text-sm text-muted">
                1回分 {costYen(prepBatchCost(data.ingredients, prep))} / {prep.yieldQuantity}
                {prep.yieldUnit}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
