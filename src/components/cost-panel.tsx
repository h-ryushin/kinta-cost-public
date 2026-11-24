"use client";

import { Card, RatioBadge, RatioMeter } from "@/components/ui";
import { costYen, taxExcluded, yen } from "@/lib/format";
import { ratioTargetOf } from "@/lib/ratio-target";
import type { CostLine } from "@/lib/recipe-cost";
import { useRatioTargets } from "@/lib/store";

type CostSummaryProps = {
  title: string;
  total: number;
  lines: CostLine[];
  /** 売価（税込：D-181）。渡さないとき（仕込み品）は、原価率と粗利を出さずに perUnit を出す */
  salePrice?: number | null;
  ratio?: number | null;
  /** メニューの分類。原価率の目安（ドリンク／肉／サイド）を選ぶのに使う（D-102） */
  category?: string | null;
  /** 売価（税抜）と粗利。calcRecipeCost が出したものを渡す（D-179・D-181） */
  saleWithoutTax?: number | null;
  profit?: number | null;
  perUnit?: React.ReactNode;
  /** 表示だけの画面など、下のバーがないときに原価の金額も出す（D-084） */
  showTotal?: boolean;
};

/**
 * 原価の内訳。広い PC（1280px 以上）は入力欄の右、それより狭い画面は入力欄の下に出す（D-046）。
 * 狭い画面では原価の金額を下のバー（CostBar）に出すので、ここには出さない（同じ金額が2か所に出ないように：D-055）。
 */
export function CostPanel({ title, total, lines, salePrice, ratio, category, saleWithoutTax, profit, perUnit, showTotal = false }: CostSummaryProps) {
  const priced = lines.filter((l) => l.resolved && l.cost !== null && l.cost > 0) as (CostLine & { cost: number })[];
  const showRatio = salePrice !== undefined;
  const validSale = salePrice !== null && salePrice !== undefined && Number.isFinite(salePrice);
  // 狭い画面では原価の金額を出さないので、売価も内訳もないと中身が空になる。空の枠は出さない
  const emptyOnNarrow = !showTotal && !showRatio && priced.length === 0;
  const target = ratioTargetOf(category, useRatioTargets());

  return (
    <Card className={`flex-col gap-5 ${emptyOnNarrow ? "hidden xl:flex" : "flex"}`}>
      <div className={showTotal ? "block" : "hidden xl:block"}>
        <p className="text-sm font-bold text-muted">{title}</p>
        <p className="mt-1 text-5xl font-bold tracking-tight">{costYen(total)}</p>
        {perUnit && <p className="mt-1 text-muted">{perUnit}</p>}
      </div>

      {showRatio && (
        <div className={`border-border xl:border-t xl:pt-4 ${showTotal ? "border-t pt-4" : ""}`}>
          <dl className="grid grid-cols-2 gap-3">
            <div>
              {/* 売価は税込を大きく出し、計算に使う税抜を添える（D-180・D-181） */}
              <dt className="text-sm text-muted">売価（税込）</dt>
              <dd className="num text-lg font-bold">{validSale ? yen(salePrice) : "—"}</dd>
              {validSale && saleWithoutTax != null && <dd className="num text-xs text-muted">{taxExcluded(saleWithoutTax)}</dd>}
            </div>
            <div>
              <dt className="text-sm text-muted">粗利（税抜）</dt>
              <dd className="num text-lg font-bold">{validSale && profit != null ? costYen(profit) : "—"}</dd>
            </div>
          </dl>
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm text-muted">原価率</span>
              <RatioBadge ratio={ratio ?? null} category={category} />
            </div>
            <RatioMeter ratio={ratio ?? null} category={category} />
            <p className="mt-1.5 text-xs text-muted">
              白い線は{target.label}の目安（{target.good}% と {target.high}%）
            </p>
          </div>
        </div>
      )}

      {priced.length > 0 && (
        <div className={`border-border xl:border-t xl:pt-4 ${showTotal ? "border-t pt-4" : ""}`}>
          <p className="mb-3 text-sm font-bold text-muted">内訳</p>
          <ul className="flex flex-col gap-3">
            {[...priced]
              .sort((a, b) => b.cost - a.cost)
              .map((line, i) => {
                const share = total > 0 ? line.cost / total : 0;
                return (
                  <li key={i}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate">{line.resolved?.name}</span>
                      <span className="num shrink-0">
                        <span className="font-bold">{costYen(line.cost)}</span>
                        <span className="ml-1.5 text-muted">{Math.round(share * 100)}%</span>
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-track" aria-hidden>
                      <div className="h-full rounded-full bg-foreground/70" style={{ width: `${share * 100}%` }} />
                    </div>
                  </li>
                );
              })}
          </ul>
        </div>
      )}
    </Card>
  );
}

/**
 * スマホ・タブレットで画面の下に固定する原価のバー。
 * sticky は親の要素の中でしか効かないので、入力欄と同じ列の最後に置く。
 */
export function CostBar({ title, total, salePrice, ratio, category, perUnit }: Omit<CostSummaryProps, "lines">) {
  const showRatio = salePrice !== undefined;
  return (
    <div className="hide-while-typing sticky bottom-24 z-[5] lg:bottom-4 xl:hidden">
      <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface px-4 py-3 shadow-raised">
        <div className="min-w-0">
          <p className="text-xs font-bold text-muted">{title}</p>
          <p className="whitespace-nowrap text-2xl font-bold tracking-tight">{costYen(total)}</p>
        </div>
        <div className="text-right">
          {showRatio ? (
            <>
              <p className="text-xs font-bold text-muted">原価率</p>
              <RatioBadge ratio={ratio ?? null} category={category} />
            </>
          ) : (
            perUnit && <p className="text-sm text-muted">{perUnit}</p>
          )}
        </div>
      </div>
    </div>
  );
}
