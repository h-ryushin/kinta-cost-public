"use client";

import { ArrowDown, ArrowLeftRight, ArrowUp, CalendarDays, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { SecretBadge } from "@/components/secret";
import { YieldChangeNote } from "@/components/yield-change";
import { Card, Empty, Loading, PageHeader, Pager, RatioBadge } from "@/components/ui";
import { changesHref, fromChangesQuery, type ChangesTab } from "@/lib/changes-link";
import { costYen, percent, taxExcluded, timeOfDay, yen } from "@/lib/format";
import { paginate } from "@/lib/paginate";
import {
  groupByDay,
  priceChangeDays,
  priceImpactsByDay,
  salePriceChangeAfter,
  salePriceChanges,
  type PrepCostChange,
  type PriceImpact,
  type SalePriceChange,
} from "@/lib/price-impact";
import { saleExcludingTax, type CostChange } from "@/lib/recipe-cost";
import { useStore } from "@/lib/store";
import type { StoreData } from "@/lib/types";

/** 材料の値段は、1ページに何日分を出すか（D-111） */
const DAYS_PER_PAGE = 2;
/** メニューの売価は、1ページに何件を出すか */
const SALES_PER_PAGE = 12;
/** 日ごとのまとめで、最初に見せる行の数。残りは「もっと見る」で開く */
const INITIAL_ROWS = 5;

/**
 * 「値段の変化」（D-098・D-107・D-111）。
 * 「材料の値段」と「メニューの売価」の2つのタブに分け、どちらもページ送りで少しずつ見せる。
 * タブとページは URL で持ち、詳細を開いて戻っても同じところに帰れる。
 */
export function PriceChangesPage() {
  const store = useStore();
  const params = useSearchParams();
  const tab: ChangesTab = params.get("tab") === "menu" ? "menu" : "ingredient";
  const requestedPage = Number(params.get("page") ?? "1");
  // ダッシュボードの「最近の価格変更」から来たときは、すぐ帰れるように戻り先を出す（D-124）
  const fromHome = params.get("from") === "home";

  // ページを送ったら、一覧の先頭から読めるようにする
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [tab, requestedPage]);

  if (!store.loaded) return <Loading />;
  const { data } = store;
  const ingredientDays = priceChangeDays(data);
  const sales = salePriceChanges(data);

  const tabClass = (active: boolean) =>
    `flex min-h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 text-sm font-bold transition-colors sm:px-4 ${
      active ? "bg-surface text-foreground shadow-card" : "text-muted hover:text-foreground"
    }`;
  const countClass = "num rounded-full bg-track px-1.5 text-xs text-muted";

  return (
    <>
      <PageHeader
        back={fromHome ? { href: "/", label: "ダッシュボード" } : undefined}
        title="値段の変化"
        description={
          tab === "menu"
            ? "メニューの売価を、いつ・いくらからいくらに変えたかと、原価率がどう変わったかです"
            : "材料の値段が変わって、どのメニューの原価がいくらになったかを日ごとに出します"
        }
      />
      {/* 320px でもはみ出さないよう、狭い画面では横幅いっぱいに2等分する */}
      <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-track p-1 sm:inline-grid" role="tablist">
        <Link href={changesHref("ingredient", 1, fromHome)} replace role="tab" aria-selected={tab === "ingredient"} className={tabClass(tab === "ingredient")}>
          材料の値段
          <span className={countClass}>{ingredientDays.length}日</span>
        </Link>
        <Link href={changesHref("menu", 1, fromHome)} replace role="tab" aria-selected={tab === "menu"} className={tabClass(tab === "menu")}>
          メニューの売価
          <span className={countClass}>{sales.length}件</span>
        </Link>
      </div>

      {tab === "ingredient" ? (
        <IngredientChanges data={data} days={ingredientDays} requestedPage={requestedPage} fromHome={fromHome} />
      ) : (
        <SaleChanges changes={sales} requestedPage={requestedPage} saleTaxRate={data.settings.saleTaxRate} fromHome={fromHome} />
      )}
    </>
  );
}

// ---------- 材料の値段（D-107・D-109） ----------

function IngredientChanges({
  data,
  days,
  requestedPage,
  fromHome,
}: {
  data: StoreData;
  days: string[];
  requestedPage: number;
  fromHome: boolean;
}) {
  if (days.length === 0) return <Empty>まだ材料の値段の変更はありません。</Empty>;
  const { items: pageDays, page, pageCount } = paginate(days, requestedPage, DAYS_PER_PAGE);
  // ページに出す日の分だけ計算する（日が増えても重くならないように）
  const impacts = priceImpactsByDay(data, Infinity, new Date(), new Set(pageDays));

  return (
    <>
      <div className="flex flex-col gap-10">
        {impacts.map((day) => (
          <section key={day.day} aria-labelledby={`day-${day.day}`}>
            <h2 id={`day-${day.day}`} className="flex items-center gap-2 text-xl font-bold">
              <CalendarDays className="size-5 text-muted" aria-hidden />
              {day.label}
            </h2>
            <p className="mt-1 text-sm text-muted">
              材料 {day.impacts.length}件の変更で、
              {day.prepChanges.length > 0 && `仕込み品 ${day.prepChanges.length}品・`}
              メニュー {day.changes.length}品の原価が変わりました
            </p>

            {/* この日の変更をまとめた結果（D-107）。売価を変えたメニューには、そう添える（D-122） */}
            <Card className="mt-3 overflow-hidden p-0! sm:p-0!">
              <div className="border-b border-border bg-surface-muted px-4 py-3 sm:px-5">
                <p className="font-bold">この日の変更で、原価が変わったメニュー</p>
              </div>
              {day.changes.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted sm:px-5">原価が変わったメニューはありません。</p>
              ) : (
                <MoreList
                  items={day.changes}
                  unit="品"
                  render={(change) => (
                    <MenuChangeRow
                      key={change.id}
                      change={change}
                      back={fromChangesQuery("ingredient", page, fromHome)}
                      saleChange={salePriceChangeAfter(data, change.id, day)}
                    />
                  )}
                />
              )}
            </Card>

            {/* 仕込み品の1回分の原価も変わる（D-114）。メニューへの影響は上のまとめに含まれている */}
            {day.prepChanges.length > 0 && (
              <Card className="mt-4 overflow-hidden p-0! sm:p-0!">
                <div className="border-b border-border bg-surface-muted px-4 py-3 sm:px-5">
                  <p className="font-bold">この日の変更で、原価が変わった仕込み品</p>
                </div>
                <MoreList
                  items={day.prepChanges}
                  unit="品"
                  render={(change) => <PrepChangeRow key={change.id} change={change} back={fromChangesQuery("ingredient", page, fromHome)} />}
                />
              </Card>
            )}

            {/* 材料ごとは、何をいくらに変えたかだけ。メニューへの影響は上のまとめで見る（D-109） */}
            <p className="mt-5 mb-2 text-sm font-bold text-muted">変えた材料</p>
            <Card className="p-0! sm:p-0!">
              <MoreList
                items={day.impacts}
                unit="件"
                render={(impact) => <IngredientRow key={impact.history.id} impact={impact} back={fromChangesQuery("ingredient", page, fromHome)} />}
              />
            </Card>
          </section>
        ))}
      </div>

      <Pager page={page} pageCount={pageCount} href={(p) => changesHref("ingredient", p, fromHome)} />
      <p className="mt-6 text-sm text-muted">
        日付は日本時間です。単位の言い換えだけ（同じ値段・同じ量で、個 → 本など）の記録は出していません。原価は今のレシピをもとに、その変更だけを戻して比べています。
      </p>
    </>
  );
}

function IngredientRow({ impact, back }: { impact: PriceImpact; back: string }) {
  const up = (impact.rate ?? 1) > 1;
  const rate = impact.rate === null ? 0 : Math.abs((impact.rate - 1) * 100);
  const h = impact.history;
  return (
    <li className="border-t border-border py-3 first:border-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="flex min-w-0 items-center gap-2">
          {impact.rate === null ? (
            // 分量の意味が変わる単位の変更（缶 → g など）は率で比べられないので、そう出す（D-172）
            <span className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full bg-warn-soft px-2 py-0.5 text-xs font-bold text-warn">
              <ArrowLeftRight className="size-3.5" aria-hidden />
              単位の変更
            </span>
          ) : (
            <ChangePill up={up} label={`${up ? "値上げ" : "値下げ"} ${rate.toFixed(1)}%`} danger={up} />
          )}
          {/* 材料の詳細へ（価格の履歴・使っているメニュー） */}
          <Link href={`/ingredients/view?id=${h.ingredientId}&${back}`} className="truncate font-bold hover:text-accent hover:underline">
            {impact.ingredientName}
          </Link>
        </span>
        <span className="num text-xs text-muted">{timeOfDay(h.changedAt)}</span>
      </div>
      <p className="num mt-1 text-sm text-muted">
        {yen(h.oldPrice)} / {h.oldQuantity}
        {h.oldUnit}
        <span className="mx-2">→</span>
        <span className="font-bold text-foreground">
          {yen(h.newPrice)} / {h.newQuantity}
          {h.newUnit}
        </span>
        <span className="ml-3 whitespace-nowrap text-xs">
          {affectedText(impact)}
        </span>
      </p>
      <YieldChangeNote history={h} />
    </li>
  );
}

/** 「メニュー 2品・仕込み品 1品に影響」。どちらもなければ「使っているメニューなし」 */
function affectedText(impact: PriceImpact): string {
  const parts = [
    impact.changes.length > 0 && `メニュー ${impact.changes.length}品`,
    impact.prepChanges.length > 0 && `仕込み品 ${impact.prepChanges.length}品`,
  ].filter(Boolean);
  return parts.length === 0 ? "使っているメニューなし" : `${parts.join("・")}に影響`;
}

/** 仕込み品1品の「+50円　450円 → 500円（1回分・出来上がり 400g）」の行。押すとその仕込み品の詳細を開く（D-114） */
function PrepChangeRow({ change, back }: { change: PrepCostChange; back: string }) {
  const diff = change.after - change.before;
  const costUp = diff > 0;
  return (
    <li className="border-t border-border first:border-0">
      <Link href={`/preps/view?id=${change.id}&${back}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-muted">
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate font-bold">{change.name}</span>
            <span className={`num shrink-0 whitespace-nowrap text-lg font-bold ${costUp ? "text-danger" : "text-ok"}`}>
              {costUp ? "+" : "−"}
              {costYen(Math.abs(diff))}
            </span>
          </div>
          {/* 秘密の印は名前の横に置くと狭い画面で名前が切れるので、下の行に置く */}
          <p className="num mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <span className="whitespace-nowrap">
              {costYen(change.before)}
              <span className="mx-1.5 text-subtle">→</span>
              <span className="font-bold text-foreground">{costYen(change.after)}</span>
            </span>
            <span className="whitespace-nowrap text-xs">
              1回分・出来上がり {change.yieldQuantity}
              {change.yieldUnit}
            </span>
            {change.secret && <SecretBadge />}
          </p>
        </div>
        <ChevronRight className="size-5 shrink-0 text-subtle" aria-hidden />
      </Link>
    </li>
  );
}

/** メニュー1品の「+37円　361円 → 398円　原価率」の行。押すとそのメニューの詳細を開く */
function MenuChangeRow({
  change,
  back,
  saleChange,
}: {
  change: CostChange;
  back: string;
  /** 原価が変わったあとに売価を変えていれば、その前後（D-122） */
  saleChange: { from: number | null; to: number | null } | null;
}) {
  const diff = change.after - change.before;
  const costUp = diff > 0;
  const href = `${change.kind === "draft" ? "/drafts" : "/menus"}/view?id=${change.id}&${back}`;
  return (
    <li className="border-t border-border first:border-0">
      {/* 狭い画面は「1行目に名前、2行目に金額と原価率」。広い画面は1行に並べる */}
      <Link href={href} className="-mx-2 flex items-center gap-2 rounded-lg px-2 py-2.5 hover:bg-surface-muted">
        <span className="min-w-0 flex-1 sm:grid sm:grid-cols-[1fr_6rem_auto_auto] sm:items-center sm:gap-x-3">
          <span className="block min-w-0">
            <span className="block truncate font-bold">{change.name}</span>
            {saleChange && (
              <span className="num mt-0.5 inline-flex items-center gap-1 rounded-full bg-ok-soft px-2 py-0.5 text-xs font-bold text-ok">
                <CheckCircle2 className="size-3.5" aria-hidden />
                売価を変更済み {saleChange.from === null ? "未設定" : yen(saleChange.from)} → {saleChange.to === null ? "未設定" : yen(saleChange.to)}
              </span>
            )}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 sm:contents">
            <span className={`num whitespace-nowrap text-lg font-bold sm:text-right ${costUp ? "text-danger" : "text-ok"}`}>
              {costUp ? "+" : "−"}
              {costYen(Math.abs(diff))}
            </span>
            <span className="num whitespace-nowrap text-sm text-muted sm:text-right">
              {costYen(change.before)}
              <span className="mx-1.5 text-subtle">→</span>
              <span className="font-bold text-foreground">{costYen(change.after)}</span>
            </span>
            <RatioBadge ratio={change.ratioAfter} category={change.category} />
          </span>
        </span>
        <ChevronRight className="size-5 shrink-0 text-subtle" aria-hidden />
      </Link>
    </li>
  );
}

// ---------- メニューの売価（D-111） ----------

function SaleChanges({
  changes,
  requestedPage,
  saleTaxRate,
  fromHome,
}: {
  changes: SalePriceChange[];
  requestedPage: number;
  saleTaxRate: number;
  fromHome: boolean;
}) {
  if (changes.length === 0) {
    return <Empty>まだメニューの売価の変更はありません。メニューの売価を変えると、ここに残ります。</Empty>;
  }
  const { items, page, pageCount } = paginate(changes, requestedPage, SALES_PER_PAGE);
  const back = fromChangesQuery("menu", page, fromHome);

  return (
    <>
      <div className="flex flex-col gap-8">
        {groupByDay(items, (c) => c.history.changedAt).map((day) => (
          <section key={day.day} aria-labelledby={`sale-${day.day}`}>
            <h2 id={`sale-${day.day}`} className="mb-3 flex items-center gap-2 text-xl font-bold">
              <CalendarDays className="size-5 text-muted" aria-hidden />
              {day.label}
            </h2>
            <Card className="p-0! sm:p-0!">
              <ul className="flex flex-col px-4 py-1 sm:px-5">
                {day.items.map((change) => (
                  <SaleChangeRow key={change.history.id} change={change} back={back} saleTaxRate={saleTaxRate} />
                ))}
              </ul>
            </Card>
          </section>
        ))}
      </div>

      <Pager page={page} pageCount={pageCount} href={(p) => changesHref("menu", p, fromHome)} />
      <p className="mt-6 text-sm text-muted">
        売価は税抜です。原価率は今の原価で計算しているので、売価を変えたことでどう変わったかが分かります。
      </p>
    </>
  );
}

/** 「タン塩　1,298円 → 1,408円（税抜 1,280円）　+110円　原価率 34.0% → 31.3%」の行（金額は税込）。押すとメニューの詳細を開く */
function SaleChangeRow({ change, back, saleTaxRate }: { change: SalePriceChange; back: string; saleTaxRate: number }) {
  // 売価の記録は税込（D-181）。前 → 後と差額は税込で出し、税抜（切り上げ）を添える（D-180）
  const { oldPrice, newPrice } = change.history;
  const newExcl = saleExcludingTax(newPrice, saleTaxRate);
  const diff = oldPrice !== null && newPrice !== null ? newPrice - oldPrice : null;
  const href = `${change.kind === "draft" ? "/drafts" : "/menus"}/view?id=${change.recipeId}&${back}`;
  return (
    <li className="border-t border-border first:border-0">
      <Link href={href} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-3 hover:bg-surface-muted">
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              {/* 狭い画面では名前が切れないよう、印は出さない（右の +100円 で上げ下げは分かる） */}
              {diff !== null && diff !== 0 && (
                <span className="hidden sm:contents">
                  <ChangePill up={diff > 0} label={diff > 0 ? "値上げ" : "値下げ"} />
                </span>
              )}
              <span className="truncate font-bold">{change.name}</span>
              {change.kind === "draft" && <span className="shrink-0 text-xs text-muted">創作</span>}
            </span>
            {diff !== null && (
              <span className="num shrink-0 whitespace-nowrap text-lg font-bold">
                {diff > 0 ? "+" : diff < 0 ? "−" : "±"}
                {yen(Math.abs(diff))}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm text-muted">
            <span className="num whitespace-nowrap">
              {oldPrice === null ? "未設定" : yen(oldPrice)}
              <span className="mx-1.5 text-subtle">→</span>
              <span className="font-bold text-foreground">{newPrice === null ? "未設定" : yen(newPrice)}</span>
              {newExcl !== null && <span className="ml-1.5 text-xs">（{taxExcluded(newExcl)}）</span>}
            </span>
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="num text-xs">{percent(change.ratioBefore)} →</span>
              <RatioBadge ratio={change.ratioAfter} category={change.category} />
            </span>
          </div>
          <p className="num mt-0.5 text-xs text-subtle">
            {timeOfDay(change.history.changedAt)}　原価 {costYen(change.cost)}
          </p>
        </div>
        <ChevronRight className="size-5 shrink-0 text-subtle" aria-hidden />
      </Link>
    </li>
  );
}

// ---------- 共通の部品 ----------

/** 「値上げ 7.1%」の印。色だけに頼らず矢印と文字を一緒に出す */
function ChangePill({ up, label, danger = false }: { up: boolean; label: string; danger?: boolean }) {
  const color = danger ? "bg-accent-soft text-danger" : up ? "bg-surface-muted text-foreground" : "bg-ok-soft text-ok";
  return (
    <span className={`inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${color}`}>
      {up ? <ArrowUp className="size-3.5" aria-hidden /> : <ArrowDown className="size-3.5" aria-hidden />}
      {label}
    </span>
  );
}

/** 最初の数行だけ出し、残りは「残り◯品も見る」で開く。1日に変更が多くても縦に長くなりすぎないように（D-111） */
function MoreList<T>({ items, unit, render }: { items: T[]; unit: string; render: (item: T) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const shown = open ? items : items.slice(0, INITIAL_ROWS);
  const rest = items.length - INITIAL_ROWS;
  return (
    <>
      <ul className="flex flex-col px-4 py-1 sm:px-5">{shown.map(render)}</ul>
      {rest > 0 && (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex min-h-12 w-full items-center justify-center gap-1 border-t border-border text-sm font-bold text-accent hover:bg-surface-muted"
        >
          <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
          {open ? "閉じる" : `残り${rest}${unit}も見る`}
        </button>
      )}
    </>
  );
}
