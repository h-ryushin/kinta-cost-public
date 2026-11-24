"use client";

import { Pencil } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { CostPanel } from "@/components/cost-panel";
import { SecretBadge } from "@/components/secret";
import { PlainSecretNotice, SecretContentsCard } from "@/components/secret-key";
import { Card, CardTitle, LinkButton, Loading, PageHeader } from "@/components/ui";
import { changesBackHref, returnQuery } from "@/lib/changes-link";
import { unitPrice } from "@/lib/cost";
import { costYen, yenDecimal } from "@/lib/format";
import { calcRecipeCost, prepCostSource } from "@/lib/recipe-cost";
import { useStore, whereUsed } from "@/lib/store";
import type { Prep, StoreData } from "@/lib/types";
import { baseUnitOf } from "@/lib/units";
import { useEffectiveRole } from "@/lib/role";

const LIST_URL = "/ingredients?tab=prep";

/** 仕込み品の詳細（表示だけ）の画面（D-084） */
export function PrepViewPage() {
  const store = useStore();
  const role = useEffectiveRole();
  const params = useSearchParams();
  const id = params.get("id");
  // 「値段の変化」から開いたときは、そこへ戻る（D-108・D-114）
  const back = params.get("from") === "changes" ? { href: changesBackHref(params), label: "値段の変化" } : { href: LIST_URL, label: "仕込み品の一覧" };
  if (!store.loaded) return <Loading />;

  const prep = store.data.preps.find((p) => p.id === id);
  if (!prep) {
    return (
      <Card className="flex flex-col items-start gap-4">
        <p>仕込み品が見つかりません。削除された可能性があります。</p>
        <LinkButton href={back.href} variant="secondary">
          {back.href === LIST_URL ? "一覧へ戻る" : "値段の変化へ戻る"}
        </LinkButton>
      </Card>
    );
  }
  return <PrepView data={store.data} prep={prep} back={back} returnQ={returnQuery(params)} hideContents={prep.secret && (role === "staff" || Boolean(prep.sealed))} canUnlock={role !== "staff"} />;
}

/** 詳細（表示だけ）の画面。編集画面でも、秘密の中身に鍵がかかっているときはこれを出す */
export function PrepView({
  data,
  prep,
  back,
  returnQ,
  hideContents,
  canUnlock,
}: {
  data: StoreData;
  prep: Prep;
  back: { href: string; label: string };
  /** 開いてきた画面（値段の変化）の印。編集へ引き継ぐ（D-130） */
  returnQ: string;
  hideContents: boolean;
  /** オーナーのとき。中身の代わりに鍵を開ける欄を出す（D-148） */
  canUnlock: boolean;
}) {
  const { lines, total } = calcRecipeCost(data, prep.items, null);
  const perUnit = unitPrice(prepCostSource(data.ingredients, prep));
  const usedBy = whereUsed(data, "prep", prep.id);

  const perUnitText = (
    <>
      出来上がり {prep.yieldQuantity}
      {prep.yieldUnit} ・ 単価 <span className="num font-bold text-foreground">{yenDecimal(perUnit)}</span> /{" "}
      {baseUnitOf(prep.yieldUnit)}
    </>
  );

  return (
    <>
      <PageHeader
        back={back}
        title={prep.name}
        description={prep.secret ? "秘密の仕込み品" : "材料を合わせて先に作っておくもの"}
        action={
          hideContents ? undefined : (
            <LinkButton href={`/preps/edit?id=${prep.id}${returnQ}`}>
              <Pencil aria-hidden />
              編集
            </LinkButton>
          )
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start xl:gap-6">
        <div className="flex flex-col gap-4">
          {canUnlock && prep.plainSecret && <PlainSecretNotice />}
          {hideContents ? (
            <SecretContentsCard what="この仕込み品の中身（材料・使用量・メモ）" item={prep} priceHistory={data.priceHistory} canUnlock={canUnlock} />
          ) : (
            <>
              <Card>
                <CardTitle action={prep.secret ? <SecretBadge /> : undefined}>材料と使用量（1回に作る分）</CardTitle>
                <ul className="flex flex-col">
                  {lines.map((line, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 border-t border-border py-2.5 first:border-0 first:pt-0">
                      <span className="min-w-0 truncate font-bold">{line.resolved?.name ?? "（削除された材料）"}</span>
                      <span className="num shrink-0 whitespace-nowrap text-sm text-muted">
                        {line.quantity}
                        {line.resolved?.baseUnit}
                        <span className="ml-3 font-bold text-foreground">{line.cost === null ? "—" : costYen(line.cost)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>

              {prep.memo.trim() !== "" && (
                <Card>
                  <CardTitle>メモ</CardTitle>
                  <p className="whitespace-pre-wrap text-sm">{prep.memo}</p>
                </Card>
              )}
            </>
          )}

          <Card>
            <CardTitle>使っているメニュー</CardTitle>
            {usedBy.length === 0 ? (
              <p className="text-sm text-muted">まだどこでも使っていません。</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {usedBy.map((u) => (
                  <li key={u.name} className="rounded-lg bg-surface-muted px-3 py-1.5 text-sm font-bold">
                    {u.name}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <CostPanel title="1回分の原価" total={total} lines={hideContents ? [] : lines} perUnit={perUnitText} showTotal />
      </div>
    </>
  );
}
