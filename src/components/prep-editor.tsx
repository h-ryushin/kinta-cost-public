"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  filledItemsFromRows,
  hasRowErrors,
  ItemRowsEditor,
  itemsFromRows,
  rowsFromItems,
  type ItemRow,
} from "@/components/item-rows-editor";
import { NumberInput } from "@/components/number-input";
import { returnQuery } from "@/lib/changes-link";
import { NUMBER_RULES, validateNumberInput } from "@/lib/number-input";
import { Save, Trash2 } from "lucide-react";
import { CostBar, CostPanel } from "@/components/cost-panel";
import {
  Button,
  Card,
  CardTitle,
  ChoiceButtons,
  ErrorMessage,
  Field,
  inputClass,
  LinkButton,
  Loading,
  PageHeader,
  useConfirm,
} from "@/components/ui";
import { SecretCard } from "@/components/secret";
import { SecretKeyNotice, UnlockBeforeDelete } from "@/components/secret-key";
import { PrepView } from "@/components/prep-view";
import { unitPrice } from "@/lib/cost";
import { toNumber, yenDecimal } from "@/lib/format";
import { calcRecipeCost } from "@/lib/recipe-cost";
import { addPrep, deletePrep, StoreError, updatePrep, useStore, whereUsed } from "@/lib/store";
import { showToast } from "@/lib/toast";
import { useOnce } from "@/lib/use-once";
import { useEffectiveRole } from "@/lib/role";
import type { Prep, StoreData } from "@/lib/types";
import { baseUnitOf, PURCHASE_UNITS, unitsWithSameBase, type PurchaseUnit } from "@/lib/units";

const LIST_URL = "/ingredients?tab=prep";

/** ?id= があれば編集、なければ新規作成。useSearchParams を使うので Suspense の中で使う。 */
export function PrepEditorPage() {
  const store = useStore();
  const role = useEffectiveRole();
  const params = useSearchParams();
  const id = params.get("id");
  // 値段の変化から来たときは、詳細に戻ったあともそこへ帰れるようにする（D-130）
  const returnQ = returnQuery(params);
  if (!store.loaded) return <Loading />;

  const prep = id ? store.data.preps.find((p) => p.id === id) : undefined;
  if (id && !prep) {
    return (
      <Card className="flex flex-col items-start gap-4">
        <p>仕込み品が見つかりません。削除された可能性があります。</p>
        <LinkButton href={LIST_URL} variant="secondary">
          一覧へ戻る
        </LinkButton>
      </Card>
    );
  }
  // 秘密の仕込み品の中身は、オーナーだけが見られる（D-060）
  // オーナーでも、鍵を開けるまでは中身を編集できない（暗号化してある：D-148）
  if (prep?.secret && (role === "staff" || prep.sealed)) {
    return (
      <PrepView
        data={store.data}
        prep={prep}
        back={{ href: LIST_URL, label: "仕込み品の一覧" }}
        returnQ={returnQ}
        hideContents
        canUnlock={role !== "staff"}
      />
    );
  }
  return <PrepEditor key={prep?.id ?? "new"} data={store.data} prep={prep} returnQ={returnQ} />;
}

function PrepEditor({ data, prep, returnQ }: { data: StoreData; prep?: Prep; returnQ: string }) {
  const router = useRouter();
  // 秘密にするかどうかを決められるのはオーナーだけ（D-060）
  const isAdmin = useEffectiveRole() === "admin";
  const { confirm, confirmDialog } = useConfirm();
  // 鍵がかかった秘密の中身があると削除できないので、オーナーにはその場で鍵を開けてもらう（D-174）
  const hasSealed = [...data.recipes, ...data.preps].some((r) => r.sealed);
  const [unlockForDelete, setUnlockForDelete] = useState(false);
  const [name, setName] = useState(prep?.name ?? "");
  const [secret, setSecret] = useState(prep?.secret ?? false);
  const [rows, setRows] = useState<ItemRow[]>(() => rowsFromItems(prep?.items ?? []));
  const [yieldQuantity, setYieldQuantity] = useState(prep ? String(prep.yieldQuantity) : "");
  const [yieldUnit, setYieldUnit] = useState<PurchaseUnit>(prep?.yieldUnit ?? "g");
  const [memo, setMemo] = useState(prep?.memo ?? "");
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const { lines, total } = calcRecipeCost(data, itemsFromRows(rows), null);
  const yieldValue = toNumber(yieldQuantity);
  const perUnit =
    yieldValue > 0 ? unitPrice({ purchasePrice: total, purchaseQuantity: yieldValue, purchaseUnit: yieldUnit }) : null;
  // メニューで使っている仕込み品は、基本単位が変わる単位を選べないようにする（D-014）
  const inUse = prep ? whereUsed(data, "prep", prep.id).length > 0 : false;
  const unitOptions = prep && inUse ? unitsWithSameBase(prep.yieldUnit) : PURCHASE_UNITS;

  const once = useOnce();
  async function run(action: () => Promise<unknown>, message: string, next: string = prep ? `/preps/view?id=${prep.id}${returnQ}` : LIST_URL) {
    try {
      // 続けて押しても1回だけ（D-157）。成功したら画面を移るので、押せないままにする
      await once.run(async () => {
        await action();
        // 戻ったあとに「保存しました」と知らせる（D-062）
        showToast(message);
        router.push(next);
      });
    } catch (e) {
      if (e instanceof StoreError) setError(e.message);
      else throw e;
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    // 入力欄ごとの誤りがあれば保存せず、欄の下にエラーを出す
    if (name.trim() === "" || validateNumberInput(yieldQuantity, NUMBER_RULES.yieldQuantity) !== null || hasRowErrors(rows)) {
      setShowErrors(true);
      setError("入力内容を確認してください");
      return;
    }
    const input = { name, secret, items: filledItemsFromRows(rows), yieldQuantity: yieldValue, yieldUnit, memo };
    // 同じ名前の仕込み品があれば「入れ替える」を選べるようにする（D-075）
    const same = prep ? undefined : data.preps.find((p) => p.name === name.trim());
    if (same) {
      confirm({
        title: `「${same.name}」はすでにあります`,
        message: "同じ名前の仕込み品があります。今の入力で入れ替えますか？",
        confirmLabel: "入れ替える",
        onConfirm: () => void run(() => updatePrep(same.id, input), `「${same.name}」を入れ替えました`),
      });
      return;
    }
    await run(
      () => (prep ? updatePrep(prep.id, input) : addPrep(input)),
      prep ? `「${name.trim()}」を保存しました` : `「${name.trim()}」を追加しました`,
    );
  }

  function remove() {
    if (!prep) return;
    if (hasSealed && isAdmin) {
      setUnlockForDelete(true);
      return;
    }
    confirm({
      title: `「${prep.name}」を削除しますか？`,
      message: "元に戻せません。",
      confirmLabel: "削除",
      variant: "danger",
      onConfirm: () => void run(() => deletePrep(prep.id), `「${prep.name}」を削除しました`, LIST_URL),
    });
  }

  const perUnitText =
    perUnit === null ? undefined : (
      <>
        単価 <span className="num font-bold text-foreground">{yenDecimal(perUnit)}</span> / {baseUnitOf(yieldUnit)}
      </>
    );

  return (
    <form onSubmit={(e) => void save(e)}>
      <PageHeader
        back={{ href: prep ? `/preps/view?id=${prep.id}${returnQ}` : LIST_URL, label: prep ? `${prep.name}の詳細` : "仕込み品の一覧" }}
        title={prep ? prep.name : "仕込み品を作成"}
        description="材料を合わせて先に作っておくもの。メニューで材料と同じように選べます"
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start xl:gap-6">
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-5">
            <CardTitle>基本情報</CardTitle>
            <div className="-mt-2">
              <Field label="名前">
                {(id) => (
                  <>
                    <input
                      id={id}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className={`${inputClass} ${showErrors && name.trim() === "" ? "border-danger" : ""}`}
                      placeholder="味ネギ"
                      maxLength={50}
                    />
                    {showErrors && name.trim() === "" && (
                      <p role="alert" className="text-sm font-bold text-danger">
                        名前を入力してください
                      </p>
                    )}
                  </>
                )}
              </Field>
            </div>
          </Card>

          {isAdmin && (
            <SecretCard label="この仕込み品の中身" value={secret} onChange={setSecret}>
              <SecretKeyNotice />
            </SecretCard>
          )}

          <Card className="flex flex-col gap-3">
            <CardTitle>材料と使用量（1回に作る分）</CardTitle>
            <ItemRowsEditor data={data} allowPrep={false} rows={rows} lines={lines} onChange={setRows} showErrors={showErrors} />
          </Card>

          <Card className="flex flex-col gap-4">
            <div>
              <CardTitle>出来上がり量</CardTitle>
              <p className="-mt-2 text-sm text-muted">1回作ると、どれだけできるか。メニューではこの量を基準に原価を出します。</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-end">
              <Field label="量">
                {(id) => (
                  <NumberInput
                    id={id}
                    ariaLabel="出来上がり量"
                    value={yieldQuantity}
                    onChange={setYieldQuantity}
                    rule={NUMBER_RULES.yieldQuantity}
                    unit={yieldUnit}
                    placeholder="400"
                    showErrors={showErrors}
                  />
                )}
              </Field>
              <ChoiceButtons
                label="単位"
                options={unitOptions}
                value={yieldUnit}
                onChange={setYieldUnit}
                hint={
                  unitOptions.length < PURCHASE_UNITS.length
                    ? `メニューで使っているため、${unitOptions.join("・")} から選べます`
                    : undefined
                }
              />
            </div>
          </Card>

          <Card>
            <Field label="メモ">
              {(id) => (
                <textarea
                  id={id}
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  rows={3}
                  className={`${inputClass} py-2`}
                  placeholder="作り方など"
                />
              )}
            </Field>
          </Card>

          <ErrorMessage message={error} />

          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={once.busy}>
              <Save aria-hidden />
              {once.busy ? "保存しています…" : "保存"}
            </Button>
            <LinkButton href={prep ? `/preps/view?id=${prep.id}${returnQ}` : LIST_URL} variant="secondary">
              やめる
            </LinkButton>
            {prep && (
              <Button variant="danger" onClick={remove} disabled={once.busy} className="ml-auto">
                <Trash2 aria-hidden />
                削除
              </Button>
            )}
          </div>
          {unlockForDelete && <UnlockBeforeDelete what="この仕込み品" onClose={() => setUnlockForDelete(false)} />}

          <CostBar title="1回分の原価" total={total} perUnit={perUnitText} />
        </div>

        <div className="xl:sticky xl:top-8">
          <CostPanel title="1回分の原価" total={total} lines={lines} perUnit={perUnitText} />
        </div>
      </div>
      {confirmDialog}
    </form>
  );
}
