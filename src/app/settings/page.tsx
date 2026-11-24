"use client";

import { Pencil, Percent, Target } from "lucide-react";
import { SecretCostStatusCard } from "@/components/secret-cost-status";
import { Card, CardTitle, LinkButton, Loading, PageHeader } from "@/components/ui";
import { taxIncluded, withoutTax, yen } from "@/lib/format";
import { RATIO_KEYS, RATIO_LABEL } from "@/lib/ratio-target";
import { useEffectiveRole } from "@/lib/role";
import { useStore } from "@/lib/store";

/**
 * お店の設定（表示だけ）。消費税率（D-101）と原価率の目安（D-110）。秘密のものの原価が反映されているかも出す（D-167）。
 * 直すときは「編集」から編集画面に進む（材料・メニューと同じ形：D-074・D-084）。オーナーだけが変えられる。
 */
export default function SettingsPage() {
  const store = useStore();
  const isAdmin = useEffectiveRole() === "admin";
  if (!store.loaded) return <Loading />;
  const { purchaseTaxRate, saleTaxRate, ratioTargets } = store.data.settings;

  return (
    <>
      <PageHeader
        title="設定"
        description={isAdmin ? "お店ぜんぶに関わる設定" : "お店ぜんぶに関わる設定（変えられるのはオーナーだけです）"}
        action={
          isAdmin && (
            <LinkButton href="/settings/edit">
              <Pencil aria-hidden />
              編集
            </LinkButton>
          )
        }
      />

      <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
        <Card>
          <CardTitle>
            <span className="flex items-center gap-2">
              <Percent className="size-4.5" aria-hidden />
              消費税
            </span>
          </CardTitle>
          <dl className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-sm text-muted">仕入れ</dt>
              <dd className="num text-2xl font-bold">{purchaseTaxRate}%</dd>
              <dd className="num text-xs text-muted">1,000円 → {taxIncluded(1000, purchaseTaxRate)}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">売価</dt>
              <dd className="num text-2xl font-bold">{saleTaxRate}%</dd>
              {/* 売価は税込で持ち、税抜は切り上げで出す（D-181） */}
              <dd className="num text-xs text-muted">税込 1,100円 → 税抜 {yen(withoutTax(1100, saleTaxRate))}</dd>
            </div>
          </dl>
          <p className="mt-4 border-t border-border pt-3 text-sm text-muted">
            仕入れ価格は税抜で入れます。メニューの売価は税込（メニュー表の値段）で入れ、税抜は「税込 ÷（1＋税率）」を1円単位で切り上げて出します。原価率は税抜どうしで出します。
          </p>
        </Card>

        <Card>
          <CardTitle>
            <span className="flex items-center gap-2">
              <Target className="size-4.5" aria-hidden />
              原価率の目安
            </span>
          </CardTitle>
          <ul className="flex flex-col">
            {RATIO_KEYS.map((key) => {
              const { good, high } = ratioTargets[key];
              return (
                <li key={key} className="border-t border-border py-3 first:border-0 first:pt-0">
                  <p className="font-bold">{RATIO_LABEL[key]}</p>
                  <p className="num mt-0.5 flex flex-wrap gap-x-3 text-sm">
                    <span className="whitespace-nowrap text-ok">{good}%以下 良好</span>
                    <span className="whitespace-nowrap text-warn">
                      {good}〜{high}% 普通
                    </span>
                    <span className="whitespace-nowrap text-danger">{high}%超 高い</span>
                  </p>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 border-t border-border pt-3 text-sm text-muted">
            「肉」は焼肉・特盛、「サイド」はおつまみ・サラダ・ご飯物・スープ・デザートなど。飲み放題はドリンクとして見ます。
          </p>
        </Card>

        <SecretCostStatusCard data={store.data} />
      </div>
    </>
  );
}
