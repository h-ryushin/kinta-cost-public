"use client";

import { Button, inputClass } from "@/components/ui";
import { Plus, X } from "lucide-react";
import { ItemPicker } from "@/components/item-picker";
import { NumberInput } from "@/components/number-input";
import { NUMBER_RULES, validateNumberInput } from "@/lib/number-input";
import { costYen, toNumber } from "@/lib/format";
import { newId } from "@/lib/id";
import type { CostLine } from "@/lib/recipe-cost";
import type { RecipeItem, StoreData } from "@/lib/types";

/**
 * 入力途中の材料行。
 * - ふつうの行：ref は「種類:ID」（例 "prep:xxxx"）、未選択なら ""
 * - 仮の材料の行（創作レシピだけ：D-096）：tempName と tempCost を使い、ref は "temp"
 */
export type ItemRow = { key: string; ref: string; quantity: string; tempName?: string; tempCost?: string };

export function rowsFromItems(items: RecipeItem[]): ItemRow[] {
  // 鍵がかかった秘密の中身（sealed）は編集画面に来ない（D-148）ので、行にしない
  const rows = items.flatMap((i): ItemRow[] =>
    i.type === "sealed"
      ? []
      : i.type === "temp"
        ? [{ key: newId(), ref: "temp", quantity: "", tempName: i.name, tempCost: String(i.cost) }]
        : [{ key: newId(), ref: `${i.type}:${i.id}`, quantity: String(i.quantity) }],
  );
  return rows.length > 0 ? rows : [emptyRow()];
}

function emptyRow(): ItemRow {
  return { key: newId(), ref: "", quantity: "" };
}

export function emptyTempRow(): ItemRow {
  return { key: newId(), ref: "temp", quantity: "", tempName: "", tempCost: "" };
}

export function isTempRow(row: ItemRow): boolean {
  return row.ref === "temp";
}

function toItem(row: ItemRow): RecipeItem {
  if (isTempRow(row)) {
    return { type: "temp", name: (row.tempName ?? "").trim(), cost: toNumber(row.tempCost ?? "") };
  }
  const [type, id = ""] = row.ref.split(":");
  return { type: (type || "ingredient") as "ingredient" | "prep", id, quantity: toNumber(row.quantity) };
}

/** 原価のプレビュー用。入力途中の行も含めて全行を返す。 */
export function itemsFromRows(rows: ItemRow[]): RecipeItem[] {
  return rows.map(toItem);
}

/** 保存用。何も入っていない行は捨てる。 */
export function filledItemsFromRows(rows: ItemRow[]): RecipeItem[] {
  return rows.filter(isFilled).map(toItem);
}

/** 空でない行に、材料の未選択や使用量の誤りがあるか（保存の前に確かめる） */
export function hasRowErrors(rows: ItemRow[]): boolean {
  return rows.some((r) => {
    if (!isFilled(r)) return false;
    if (isTempRow(r)) {
      return (r.tempName ?? "").trim() === "" || validateNumberInput(r.tempCost ?? "", NUMBER_RULES.tempCost) !== null;
    }
    return r.ref === "" || validateNumberInput(r.quantity, NUMBER_RULES.usage) !== null;
  });
}

function isFilled(row: ItemRow): boolean {
  if (isTempRow(row)) return (row.tempName ?? "").trim() !== "" || (row.tempCost ?? "").trim() !== "";
  return row.ref !== "" || row.quantity.trim() !== "";
}

export function ItemRowsEditor({
  data,
  allowPrep,
  allowTemp = false,
  rows,
  lines,
  onChange,
  showErrors = false,
}: {
  data: StoreData;
  /** 仕込み品も選べるか（仕込み品の中には仕込み品を入れない：D-020） */
  allowPrep: boolean;
  /** 仮の材料を使えるか（創作レシピだけ：D-096） */
  allowTemp?: boolean;
  rows: ItemRow[];
  lines: CostLine[];
  onChange: (rows: ItemRow[]) => void;
  /** 保存を押したあと。触っていない欄のエラーも出す */
  showErrors?: boolean;
}) {
  const update = (key: string, patch: Partial<ItemRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <>
      {data.ingredients.length === 0 && <p className="text-muted">先に「材料」の画面で材料を登録してください。</p>}
      <ul className="flex flex-col gap-3">
        {rows.map((row, index) => {
          const resolved = lines[index]?.resolved;
          const cost = lines[index]?.cost ?? null;
          // 材料も使用量も空の行は保存しないので、エラーも出さない
          const filled = isFilled(row);
          const missingItem = showErrors && filled && row.ref === "" && !isTempRow(row);
          if (isTempRow(row)) {
            // 仮の材料：名前とだいたいの金額だけ（材料としては登録しない：D-096）
            return (
              <li
                key={row.key}
                className="flex flex-col gap-2 rounded-lg border border-dashed border-border-strong bg-surface-muted/50 p-2.5 sm:flex-row sm:items-start"
              >
                <div className="min-w-0 sm:flex-1">
                  <input
                    value={row.tempName ?? ""}
                    onChange={(e) => update(row.key, { tempName: e.target.value })}
                    placeholder="仮の材料の名前（例：ブルーチーズ）"
                    maxLength={50}
                    aria-label="仮の材料の名前"
                    className={`${inputClass} ${showErrors && filled && (row.tempName ?? "").trim() === "" ? "border-danger" : ""}`}
                  />
                  <p className="mt-1 text-xs text-muted">材料には登録しません（この試作の中だけ）</p>
                </div>
                <div className="flex items-start gap-2 sm:w-72 sm:shrink-0">
                  <NumberInput
                    ariaLabel="だいたいの金額"
                    value={row.tempCost ?? ""}
                    onChange={(tempCost) => update(row.key, { tempCost })}
                    rule={NUMBER_RULES.tempCost}
                    unit="円"
                    placeholder="100"
                    showErrors={showErrors && filled}
                    className="min-w-0 flex-1"
                  />
                  <span className="num flex min-h-11 shrink-0 items-center justify-end whitespace-nowrap font-bold sm:w-20">
                    {cost === null ? "—" : costYen(cost)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
                    aria-label="この材料を外す"
                    className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-accent-soft hover:text-danger"
                  >
                    <X className="size-4.5" aria-hidden />
                  </button>
                </div>
              </li>
            );
          }
          return (
            <li
              key={row.key}
              className="flex flex-col gap-2 rounded-lg border border-border bg-surface-muted/50 p-2.5 sm:flex-row sm:items-start"
            >
              {/* スマホは2段（材料／使用量・原価）、広い画面は1行に並べる */}
              <div className="min-w-0 sm:flex-1">
                <ItemPicker data={data} allowPrep={allowPrep} value={row.ref} onChange={(ref) => update(row.key, { ref })} />
                {missingItem && (
                  <p role="alert" className="mt-1 text-sm font-bold text-danger">
                    材料を選んでください
                  </p>
                )}
              </div>
              <div className="flex items-start gap-2 sm:w-72 sm:shrink-0">
                <NumberInput
                  ariaLabel="使用量"
                  value={row.quantity}
                  onChange={(quantity) => update(row.key, { quantity })}
                  rule={NUMBER_RULES.usage}
                  unit={resolved?.baseUnit}
                  placeholder="0"
                  showErrors={showErrors && filled}
                  className="min-w-0 flex-1"
                />
                <span className="num flex min-h-11 shrink-0 items-center justify-end whitespace-nowrap font-bold sm:w-20">
                  {cost === null ? "—" : costYen(cost)}
                </span>
                <button
                  type="button"
                  onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
                  aria-label="この材料を外す"
                  className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-accent-soft hover:text-danger"
                >
                  <X className="size-4.5" aria-hidden />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => onChange([...rows, emptyRow()])}>
          <Plus aria-hidden />
          材料を追加
        </Button>
        {allowTemp && (
          <Button variant="ghost" onClick={() => onChange([...rows, emptyTempRow()])}>
            <Plus aria-hidden />
            仮の材料を追加
          </Button>
        )}
      </div>
    </>
  );
}
