"use client";

import { AlertTriangle, CheckCircle2, ChevronRight, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { Card, CardTitle } from "@/components/ui";
import { costYen, dateTime } from "@/lib/format";
import { calcRecipeCost, prepBatchCost } from "@/lib/recipe-cost";
import { isSecretCostStale } from "@/lib/secret-cost";
import type { StoreData } from "@/lib/types";

type Row = { id: string; name: string; kind: string; href: string; cost: number; costAt?: string | null; sealed: boolean; stale: boolean };

/** 秘密のメニュー・創作レシピ・仕込み品を、原価が古いものを先にして並べる */
function secretRows(data: StoreData): Row[] {
  const recipes: Row[] = data.recipes
    .filter((r) => r.secret)
    .map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind === "menu" ? "メニュー" : "創作レシピ",
      href: `/${r.kind === "menu" ? "menus" : "drafts"}/view?id=${r.id}`,
      cost: calcRecipeCost(data, r.items, r.salePrice).total,
      costAt: r.secretCostAt,
      sealed: Boolean(r.sealed),
      stale: isSecretCostStale(r, data.priceHistory),
    }));
  const preps: Row[] = data.preps
    .filter((p) => p.secret)
    .map((p) => ({
      id: p.id,
      name: p.name,
      kind: "仕込み品（1回分）",
      href: `/preps/view?id=${p.id}`,
      cost: prepBatchCost(data.ingredients, p),
      costAt: p.secretCostAt,
      sealed: Boolean(p.sealed),
      stale: isSecretCostStale(p, data.priceHistory),
    }));
  return [...recipes, ...preps].sort((a, b) => Number(b.stale) - Number(a.stale));
}

/**
 * 秘密のものの原価が、今の材料の値段で計算し直されているかの一覧（D-167）。
 * 秘密の原価はオーナーが鍵を開けたときにしか計算し直せない（D-154）ので、社員にも「反映されていないもの」が見えるようにする。
 * 秘密のものがなければ出さない。
 */
export function SecretCostStatusCard({ data }: { data: StoreData }) {
  const rows = secretRows(data);
  if (rows.length === 0) return null;
  const staleCount = rows.filter((r) => r.stale).length;

  return (
    <Card>
      <CardTitle>
        <span className="flex items-center gap-2">
          <LockKeyhole className="size-4.5" aria-hidden />
          秘密のものの原価
        </span>
      </CardTitle>
      <p className={`mb-3 text-sm ${staleCount > 0 ? "font-bold text-warn" : "text-muted"}`}>
        {staleCount > 0
          ? `${rows.length}品のうち ${staleCount}品は、材料の値段が変わったあと、まだ原価に反映されていません。オーナーがアプリを開いて顔・指紋を通すと新しくなります。`
          : `${rows.length}品とも、今の材料の値段で計算した原価です。`}
      </p>
      <ul className="flex flex-col">
        {rows.map((row) => (
          <li key={row.id} className="border-t border-border first:border-0">
            <Link href={row.href} className="flex items-center gap-3 py-3 hover:bg-surface-muted/60">
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{row.name}</p>
                <p className="text-xs text-muted">{row.kind}</p>
                <p className={`mt-1 flex items-center gap-1 text-sm font-bold ${row.stale ? "text-warn" : "text-ok"}`}>
                  {row.stale ? <AlertTriangle className="size-4 shrink-0" aria-hidden /> : <CheckCircle2 className="size-4 shrink-0" aria-hidden />}
                  {row.stale ? "反映されていません" : "反映済み"}
                </p>
                <p className="num text-xs text-muted">
                  {row.sealed && row.costAt ? `${dateTime(row.costAt)} 時点の原価` : row.sealed ? "まだ計算していません" : "今の値段で計算した原価"}
                </p>
              </div>
              <span className="num shrink-0 font-bold whitespace-nowrap">{costYen(row.cost)}</span>
              <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
