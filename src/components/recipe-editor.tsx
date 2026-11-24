"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { parseCategory } from "@/components/category-chips";
import { BadgeCheck, Copy, Save, Send, Trash2 } from "lucide-react";
import { CostBar, CostPanel } from "@/components/cost-panel";
import {
  Button,
  Card,
  CardTitle,
  ErrorMessage,
  Field,
  GroupedChoiceButtons,
  inputClass,
  LinkButton,
  Loading,
  PageHeader,
  useConfirm,
} from "@/components/ui";
import { SecretCard } from "@/components/secret";
import { SecretKeyNotice } from "@/components/secret-key";
import { RecipeView } from "@/components/recipe-view";
import { ShareTextDialog } from "@/components/share-dialog";
import { returnQuery } from "@/lib/changes-link";
import { MENU_CATEGORIES, MENU_CATEGORY_GROUPS, type MenuCategory } from "@/lib/categories";
import { guessMenuCategory } from "@/lib/menu-classifier";
import {
  filledItemsFromRows,
  hasRowErrors,
  ItemRowsEditor,
  itemsFromRows,
  rowsFromItems,
  type ItemRow,
} from "@/components/item-rows-editor";
import { NumberInput } from "@/components/number-input";
import { NUMBER_RULES, validateNumberInput } from "@/lib/number-input";
import { costYen, taxExcluded, toNumber, withTax, yen } from "@/lib/format";
import { calcRecipeCost } from "@/lib/recipe-cost";
import { recipeShareText } from "@/lib/share-text";
import { suggestSalePrices } from "@/lib/price-suggest";
import { addRecipe, deleteRecipe, promoteDraft, StoreError, updateRecipe, useRatioTargets, useStore } from "@/lib/store";
import { showToast } from "@/lib/toast";
import { useOnce } from "@/lib/use-once";
import { useEffectiveRole } from "@/lib/role";
import type { Recipe, RecipeKind, StoreData } from "@/lib/types";

const BASE: Record<RecipeKind, string> = { menu: "/menus", draft: "/drafts" };
const LABEL: Record<RecipeKind, string> = { menu: "メニュー", draft: "創作レシピ" };

/**
 * ?id= があれば編集、なければ新規作成。?copy= があれば、そのレシピの中身をコピーして新規作成する（D-032）。
 * useSearchParams を使うので Suspense の中で使う。
 */
export function RecipeEditorPage({ kind }: { kind: RecipeKind }) {
  const store = useStore();
  const role = useEffectiveRole();
  const params = useSearchParams();
  const id = params.get("id");
  // 一覧で絞り込んでいた分類。新規作成の初期値にし、保存後はその分類の一覧へ戻る
  const filter = parseCategory(MENU_CATEGORIES, params.get("category"));
  const listUrl = filter ? `${BASE[kind]}?category=${encodeURIComponent(filter)}` : BASE[kind];
  // 既にあるものは詳細から来るので詳細へ、新しく作るときは一覧へ戻る（D-084）
  // 値段の変化・ダッシュボードから来たときは、詳細に戻ったあともそこへ帰れるようにする（D-130）
  const viewUrl = (recipeId: string) =>
    `${BASE[kind]}/view?id=${recipeId}${filter ? `&category=${encodeURIComponent(filter)}` : ""}${returnQuery(params)}`;
  const backUrl = id ? viewUrl(id) : listUrl;
  if (!store.loaded) return <Loading />;

  const recipe = id ? store.data.recipes.find((r) => r.id === id && r.kind === kind) : undefined;
  const copyId = params.get("copy");
  const copySource = copyId ? store.data.recipes.find((r) => r.id === copyId && r.kind === kind) : undefined;
  if ((id && !recipe) || (copyId && !copySource)) {
    return (
      <Card className="flex flex-col items-start gap-4">
        <p>{LABEL[kind]}が見つかりません。削除されたか、メニューに登録された可能性があります。</p>
        <LinkButton href={backUrl} variant="secondary">
          一覧へ戻る
        </LinkButton>
      </Card>
    );
  }
  // 秘密のメニュー・創作レシピの中身は、オーナーだけが見られる（D-060）
  // オーナーでも、鍵を開けるまでは中身を編集できない（暗号化してある：D-148）
  if (recipe?.secret && (role === "staff" || recipe.sealed)) {
    return (
      <RecipeView
        kind={kind}
        data={store.data}
        recipe={recipe}
        back={{ href: backUrl, label: `${recipe.name}の詳細` }}
        editUrl={backUrl}
        hideContents
        canUnlock={role !== "staff"}
      />
    );
  }
  // key で、別のレシピに移ったときに入力内容をリセットする
  return (
    <RecipeEditor
      key={recipe?.id ?? (copySource ? `copy-${copySource.id}` : "new")}
      kind={kind}
      data={store.data}
      recipe={recipe}
      copySource={copySource}
      defaultCategory={filter ?? undefined}
      backUrl={backUrl}
      listUrl={listUrl}
    />
  );
}

function RecipeEditor({
  kind,
  data,
  recipe,
  copySource,
  defaultCategory,
  backUrl,
  listUrl,
}: {
  kind: RecipeKind;
  data: StoreData;
  recipe?: Recipe;
  /** コピー元。名前に「（コピー）」を付け、ほかはそのまま初期値にする */
  copySource?: Recipe;
  defaultCategory?: MenuCategory;
  /** 保存・やめるで戻る先（既にあるものは詳細、新規は一覧） */
  backUrl: string;
  /** 削除したあとの戻り先 */
  listUrl: string;
}) {
  const router = useRouter();
  // 秘密にするかどうかを決められるのはオーナーだけ（要件定義書 3.4、D-060）
  const isAdmin = useEffectiveRole() === "admin";
  const { confirm, confirmDialog } = useConfirm();
  const [sharing, setSharing] = useState(false);
  const initial = recipe ?? copySource;
  const [name, setName] = useState(recipe?.name ?? (copySource ? `${copySource.name}（コピー）` : ""));
  const [category, setCategory] = useState<MenuCategory>(initial?.category ?? defaultCategory ?? "その他");
  // 新しく作るときは、分類を押すまで名前から自動で選ぶ（D-041）。一覧で分類を絞り込んでいたら、それを使う
  const [categoryTouched, setCategoryTouched] = useState(Boolean(initial || defaultCategory));
  const guessedCategory = categoryTouched ? null : guessMenuCategory(name);
  const effectiveCategory = categoryTouched ? category : (guessedCategory ?? "その他");
  const taxRate = data.settings.saleTaxRate;
  // 売価は税込（メニュー表の値段）で入れて、そのまま保存する（D-181）
  const [salePrice, setSalePrice] = useState(initial?.salePrice != null ? String(initial.salePrice) : "");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [secret, setSecret] = useState(initial?.secret ?? false);
  const [rows, setRows] = useState<ItemRow[]>(() => rowsFromItems(initial?.items ?? []));
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  // 税込。税抜（切り上げ）と原価率は calcRecipeCost が出す（D-179・D-181）
  const salePriceValue = salePrice.trim() === "" ? null : toNumber(salePrice);
  const { lines, total, ratio, saleWithoutTax, profit } = calcRecipeCost(data, itemsFromRows(rows), salePriceValue);
  // 創作レシピは原価から売値を決めるので、分類の目安から売値の目安を出す（D-143）
  const ratioTargets = useRatioTargets();
  const priceSuggest = suggestSalePrices(total, effectiveCategory, ratioTargets);

  const once = useOnce();
  async function run(action: () => Promise<unknown>, next: string, message: string) {
    try {
      // 続けて押しても1回だけ（D-157）。成功したら画面を移るので、押せないままにする
      await once.run(async () => {
        await action();
        // 画面が切り替わったあとに「保存しました」と知らせる（D-062）
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
    if (name.trim() === "" || validateNumberInput(salePrice, NUMBER_RULES.salePrice) !== null || hasRowErrors(rows)) {
      setShowErrors(true);
      setError("入力内容を確認してください");
      return;
    }
    const input = { name, category: effectiveCategory, secret, salePrice: salePriceValue, memo, items: filledItemsFromRows(rows) };
    // 同じ名前のものがあれば「入れ替える」を選べるようにする（D-075）
    const same = recipe ? undefined : data.recipes.find((r) => r.kind === kind && r.name === name.trim());
    if (same) {
      confirm({
        title: `「${same.name}」はすでにあります`,
        message: `同じ名前の${LABEL[kind]}があります。今の入力で入れ替えますか？`,
        confirmLabel: "入れ替える",
        onConfirm: () => void run(() => updateRecipe(same.id, input), backUrl, `「${same.name}」を入れ替えました`),
      });
      return;
    }
    await run(
      () => (recipe ? updateRecipe(recipe.id, input) : addRecipe(kind, input)),
      backUrl,
      recipe ? `「${name.trim()}」を保存しました` : `「${name.trim()}」を追加しました`,
    );
  }

  function remove() {
    if (!recipe) return;
    confirm({
      title: `「${recipe.name}」を削除しますか？`,
      message: "元に戻せません。",
      confirmLabel: "削除",
      variant: "danger",
      onConfirm: () => void run(() => deleteRecipe(recipe.id), listUrl, `「${recipe.name}」を削除しました`),
    });
  }

  function promote() {
    if (!recipe) return;
    confirm({
      title: `「${recipe.name}」を正式メニューに登録しますか？`,
      message: "保存済みの内容で登録されます。保存していない変更は登録されません。",
      confirmLabel: "登録",
      onConfirm: () =>
        void run(() => promoteDraft(recipe.id), `/menus/view?id=${recipe.id}`, `「${recipe.name}」をメニューに登録しました`),
    });
  }

  // LINE に貼る文は、画面の今の内容から作る（保存していない変更もそのまま送れる：D-059）
  const shareText = recipeShareText(data, {
    kind,
    name: name.trim() === "" ? `（名前なしの${LABEL[kind]}）` : name,
    salePrice: salePriceValue !== null && Number.isFinite(salePriceValue) ? salePriceValue : null,
    memo,
    items: filledItemsFromRows(rows),
  });

  const salePriceField = (
    <Field
      label={kind === "menu" ? "売価（円・税込）" : "想定売価（円・税込）"}
      hint={
        saleWithoutTax !== null && Number.isFinite(saleWithoutTax) && saleWithoutTax > 0 && saleWithoutTax < total
          ? `売価が原価（${costYen(total)}）より安くなっています`
          : "空欄なら原価率を出しません"
      }
    >
      {(id) => (
        <div className="flex flex-col gap-2">
          <NumberInput
            id={id}
            value={salePrice}
            onChange={setSalePrice}
            rule={NUMBER_RULES.salePrice}
            unit="円"
            placeholder="1380"
            showErrors={showErrors}
          />
          {/* 原価率の計算に使う税抜（税込 ÷（1＋税率）を切り上げ）を添える（D-179・D-181） */}
          {saleWithoutTax !== null && Number.isFinite(saleWithoutTax) && saleWithoutTax > 0 && (
            <p className="num text-sm">
              <span className="text-muted">税抜</span> <span className="font-bold">{yen(saleWithoutTax)}</span>
              <span className="ml-2 text-muted">（税込 ÷ {(100 + taxRate) / 100} を切り上げ）</span>
            </p>
          )}
        </div>
      )}
    </Field>
  );

  return (
    <form onSubmit={(e) => void save(e)}>
      <PageHeader
        back={{ href: backUrl, label: recipe ? `${recipe.name}の詳細` : `${LABEL[kind]}の一覧` }}
        title={recipe ? recipe.name : `${LABEL[kind]}を作成`}
        description={recipe ? `${LABEL[kind]}を編集` : undefined}
        action={
          recipe && (
            <>
              {kind === "draft" && (
                <Button variant="secondary" onClick={promote} disabled={once.busy}>
                  <BadgeCheck aria-hidden />
                  メニューに登録
                </Button>
              )}
              <LinkButton
                href={`${BASE[kind]}/edit?copy=${recipe.id}&category=${encodeURIComponent(recipe.category)}`}
                variant="secondary"
              >
                <Copy aria-hidden />
                <span className="hidden sm:inline">コピーして別の商品を作る</span>
                <span className="sm:hidden">コピー</span>
              </LinkButton>
            </>
          )
        }
      />
      {copySource && (
        <p className="mb-4 rounded-lg border border-accent/20 bg-accent-soft px-4 py-3">
          「{copySource.name}」をコピーしました。名前と量を変えて保存すると、別の商品として登録されます。
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start xl:gap-6">
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-5">
            <CardTitle>基本情報</CardTitle>
            <div className={`-mt-2 grid gap-5 ${kind === "menu" ? "sm:grid-cols-[minmax(0,1fr)_15rem]" : ""}`}>
              <Field label={kind === "menu" ? "メニュー名" : "レシピ名"}>
                {(id) => (
                  <>
                    <input
                      id={id}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className={`${inputClass} ${showErrors && name.trim() === "" ? "border-danger" : ""}`}
                      placeholder="タン塩"
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
              {kind === "menu" && salePriceField}
            </div>
            <GroupedChoiceButtons
              label="分類"
              groups={MENU_CATEGORY_GROUPS}
              value={effectiveCategory}
              onChange={(c) => {
                setCategory(c);
                setCategoryTouched(true);
              }}
              hint={guessedCategory ? "名前から自動で選びました。違うときは押して変えてください" : undefined}
            />
          </Card>

          {isAdmin && (
            <SecretCard label={`この${LABEL[kind]}の中身`} value={secret} onChange={setSecret}>
              <SecretKeyNotice />
            </SecretCard>
          )}

          <Card className="flex flex-col gap-3">
            <CardTitle>材料と使用量（1人前）</CardTitle>
            <ItemRowsEditor
              data={data}
              allowPrep
              // 試作のうちは、仕入れるか分からない材料を「仮の材料」で書ける（D-096）
              allowTemp={kind === "draft"}
              rows={rows}
              lines={lines}
              onChange={setRows}
              showErrors={showErrors}
            />
          </Card>

          {/* 創作レシピは、材料を入れて原価が出てから売値を決める。だから売値は材料の下に置く（D-143） */}
          {kind === "draft" && (
            <Card className="flex flex-col gap-4">
              <CardTitle>売値の目安</CardTitle>
              {priceSuggest.suggestions.length > 0 ? (
                <>
                  <p className="-mt-2 text-sm text-muted">
                    原価 <span className="num font-bold text-foreground">{costYen(total)}</span>（税抜）と、{priceSuggest.target.label}
                    の原価率の目安から出しています。押すと想定売価に入ります。
                  </p>
                  <ul className="grid gap-3 sm:grid-cols-2">
                    {priceSuggest.suggestions.map((s) => {
                      const chosen = saleWithoutTax === s.price;
                      return (
                        <li key={s.level}>
                          <button
                            type="button"
                            onClick={() => setSalePrice(String(withTax(s.price, taxRate)))}
                            aria-pressed={chosen}
                            className={`flex min-h-12 w-full flex-col items-start gap-1 rounded-lg border px-4 py-3 text-left transition-colors ${
                              chosen ? "border-accent bg-accent-soft" : "border-border-strong bg-surface hover:bg-surface-muted"
                            }`}
                          >
                            <span className="text-sm font-bold">
                              {s.level === "good" ? "しっかり利益を出すなら" : "これより安くしない"}
                            </span>
                            {/* 想定売価は税込で入れるので、税込を大きく出す（D-180・D-181）。税込を税抜に戻すと s.price になる */}
                            <span className="num text-2xl font-bold whitespace-nowrap">{yen(withTax(s.price, taxRate))}</span>
                            <span className="num text-sm text-muted">
                              {taxExcluded(s.price)}・原価率 {s.ratio}%以下（{s.level === "good" ? "良好" : "普通"}）
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : (
                <p className="-mt-2 text-sm text-muted">材料を入れると、原価から売値の目安が出ます。</p>
              )}
              {salePriceField}
            </Card>
          )}

          <Card>
            <Field label="メモ">
              {(id) => (
                <textarea
                  id={id}
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  rows={3}
                  className={`${inputClass} py-2`}
                  placeholder="作り方や仕入れ先など"
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
            <LinkButton href={backUrl} variant="secondary">
              やめる
            </LinkButton>
            {kind === "draft" && (
              <Button variant="secondary" onClick={() => setSharing(true)}>
                <Send aria-hidden />
                LINEに送る
              </Button>
            )}
            {recipe && (
              <Button variant="danger" onClick={remove} disabled={once.busy} className="ml-auto">
                <Trash2 aria-hidden />
                削除
              </Button>
            )}
          </div>

          <CostBar title="原価" total={total} salePrice={salePriceValue} ratio={ratio} category={effectiveCategory} />
        </div>

        <div className="xl:sticky xl:top-8">
          <CostPanel
            title="原価（1人前・税抜）"
            total={total}
            lines={lines}
            salePrice={salePriceValue}
            saleWithoutTax={saleWithoutTax}
            profit={profit}
            ratio={ratio}
            category={effectiveCategory}
          />
        </div>
      </div>
      {confirmDialog}
      <ShareTextDialog open={sharing} title="LINEに送る" text={shareText} onClose={() => setSharing(false)} />
    </form>
  );
}
