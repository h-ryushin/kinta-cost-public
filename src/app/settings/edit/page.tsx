"use client";

import { Percent, Save, Target } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { NumberInput } from "@/components/number-input";
import { Button, Card, CardTitle, ErrorMessage, Field, LinkButton, Loading, PageHeader } from "@/components/ui";
import { taxIncluded, toNumber, withoutTax, yen } from "@/lib/format";
import { NUMBER_RULES, validateNumberInput, type NumberRule } from "@/lib/number-input";
import { RATIO_KEYS, RATIO_LABEL, type RatioKey } from "@/lib/ratio-target";
import { useEffectiveRole } from "@/lib/role";
import { StoreError, updateSettings, useStore } from "@/lib/store";
import { showToast } from "@/lib/toast";
import { settingsSchema, type Settings } from "@/lib/types";

type Draft = {
  purchaseTaxRate: string;
  saleTaxRate: string;
  ratio: Record<RatioKey, { good: string; high: string }>;
};

function toDraft(settings: Settings): Draft {
  return {
    purchaseTaxRate: String(settings.purchaseTaxRate),
    saleTaxRate: String(settings.saleTaxRate),
    ratio: {
      drink: { good: String(settings.ratioTargets.drink.good), high: String(settings.ratioTargets.drink.high) },
      meat: { good: String(settings.ratioTargets.meat.good), high: String(settings.ratioTargets.meat.high) },
      side: { good: String(settings.ratioTargets.side.good), high: String(settings.ratioTargets.side.high) },
    },
  };
}

/** お店の設定の編集（オーナーだけ）。消費税率（D-101）と原価率の目安（D-110） */
export default function SettingsEditPage() {
  const store = useStore();
  const isAdmin = useEffectiveRole() === "admin";
  if (!store.loaded) return <Loading />;
  if (!isAdmin) {
    return (
      <>
        <PageHeader back={{ href: "/settings", label: "設定" }} title="設定の編集" />
        <Card className="flex flex-col items-start gap-4">
          <p>設定を変えられるのはオーナーだけです。</p>
          <LinkButton href="/settings" variant="secondary">
            設定へ戻る
          </LinkButton>
        </Card>
      </>
    );
  }
  return <SettingsEditor settings={store.data.settings} />;
}

function SettingsEditor({ settings }: { settings: Settings }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings));
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);

  const setRatio = (key: RatioKey, field: "good" | "high", value: string) =>
    setDraft((d) => ({ ...d, ratio: { ...d.ratio, [key]: { ...d.ratio[key], [field]: value } } }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setShowErrors(true);
    const fields: [string, NumberRule][] = [
      [draft.purchaseTaxRate, NUMBER_RULES.taxRate],
      [draft.saleTaxRate, NUMBER_RULES.taxRate],
      ...RATIO_KEYS.flatMap((k): [string, NumberRule][] => [
        [draft.ratio[k].good, NUMBER_RULES.ratioTarget],
        [draft.ratio[k].high, NUMBER_RULES.ratioTarget],
      ]),
    ];
    if (fields.some(([value, rule]) => validateNumberInput(value, rule) !== null)) return;

    const input = {
      purchaseTaxRate: toNumber(draft.purchaseTaxRate),
      saleTaxRate: toNumber(draft.saleTaxRate),
      ratioTargets: Object.fromEntries(
        RATIO_KEYS.map((k) => [k, { good: toNumber(draft.ratio[k].good), high: toNumber(draft.ratio[k].high) }]),
      ) as Settings["ratioTargets"],
    };
    // 「良好」の線が「高い」の線より小さいか（保存する関数の中でも同じ検証をする）
    const reversed = RATIO_KEYS.find((k) => input.ratioTargets[k].good >= input.ratioTargets[k].high);
    if (reversed) {
      setError(`${RATIO_LABEL[reversed]}：「良好」の数字は「高い」の数字より小さくしてください`);
      return;
    }
    if (!settingsSchema.safeParse(input).success) {
      setError("入力を確かめてください");
      return;
    }

    setBusy(true);
    try {
      await updateSettings(input);
      showToast("設定を保存しました");
      router.push("/settings");
    } catch (err) {
      if (err instanceof StoreError) setError(err.message);
      else throw err;
    } finally {
      setBusy(false);
    }
  }

  const purchaseRate = toNumber(draft.purchaseTaxRate);
  const saleRate = toNumber(draft.saleTaxRate);

  return (
    <form onSubmit={(e) => void save(e)}>
      <PageHeader back={{ href: "/settings", label: "設定" }} title="設定の編集" description="オーナーだけが変えられます" />

      <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
        <Card className="flex flex-col gap-5">
          <CardTitle>
            <span className="flex items-center gap-2">
              <Percent className="size-4.5" aria-hidden />
              消費税
            </span>
          </CardTitle>
          <div className="-mt-2 grid gap-5 sm:grid-cols-2">
            <Field
              label="仕入れにかかる消費税"
              hint={Number.isFinite(purchaseRate) ? `1,000円 → ${taxIncluded(1000, purchaseRate)}` : "食材は軽減税率の8%が多い"}
            >
              {(id) => (
                <NumberInput
                  id={id}
                  value={draft.purchaseTaxRate}
                  onChange={(v) => setDraft((d) => ({ ...d, purchaseTaxRate: v }))}
                  rule={NUMBER_RULES.taxRate}
                  unit="%"
                  showErrors={showErrors}
                />
              )}
            </Field>
            <Field
              label="売価にかかる消費税"
              // 売価は税込で持つので、税率を変えるとメニューの税込はそのままで、税抜と原価率が変わる（D-181）
              hint={
                Number.isFinite(saleRate)
                  ? `税込 1,100円 → 税抜 ${yen(withoutTax(1100, saleRate))}。メニューの売価（税込）はそのままで、税抜と原価率が変わります`
                  : "店内で食べる場合は10%"
              }
            >
              {(id) => (
                <NumberInput
                  id={id}
                  value={draft.saleTaxRate}
                  onChange={(v) => setDraft((d) => ({ ...d, saleTaxRate: v }))}
                  rule={NUMBER_RULES.taxRate}
                  unit="%"
                  showErrors={showErrors}
                />
              )}
            </Field>
          </div>
        </Card>

        <Card className="flex flex-col gap-5">
          <CardTitle>
            <span className="flex items-center gap-2">
              <Target className="size-4.5" aria-hidden />
              原価率の目安
            </span>
          </CardTitle>
          <p className="-mt-4 text-sm text-muted">「良好」の数字以下なら良好、「高い」の数字を超えたら高い、そのあいだは普通です。</p>
          {RATIO_KEYS.map((key) => (
            // fieldset の枠線は legend と重なって線が文字を横切るので、div と見出しで組む
            <div
              key={key}
              role="group"
              aria-labelledby={`ratio-${key}`}
              className="border-t border-border pt-4"
            >
              <p id={`ratio-${key}`} className="mb-2 font-bold">
                {RATIO_LABEL[key]}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="良好（これ以下）">
                  {(id) => (
                    <NumberInput
                      id={id}
                      value={draft.ratio[key].good}
                      onChange={(v) => setRatio(key, "good", v)}
                      rule={NUMBER_RULES.ratioTarget}
                      unit="%"
                      showErrors={showErrors}
                    />
                  )}
                </Field>
                <Field label="高い（これを超えたら）">
                  {(id) => (
                    <NumberInput
                      id={id}
                      value={draft.ratio[key].high}
                      onChange={(v) => setRatio(key, "high", v)}
                      rule={NUMBER_RULES.ratioTarget}
                      unit="%"
                      showErrors={showErrors}
                    />
                  )}
                </Field>
              </div>
            </div>
          ))}
        </Card>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy} className="min-h-12">
          <Save aria-hidden />
          {busy ? "保存しています…" : "保存"}
        </Button>
        <LinkButton href="/settings" variant="secondary" className="min-h-12">
          やめる
        </LinkButton>
      </div>
      <div className="mt-3">
        <ErrorMessage message={error} />
      </div>
    </form>
  );
}
