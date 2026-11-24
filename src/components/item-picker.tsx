"use client";

import { ChevronsUpDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { inputClass } from "@/components/ui";
import { CATEGORIES } from "@/lib/categories";
import { unitPrice } from "@/lib/cost";
import { yenDecimal } from "@/lib/format";
import { resolveItem, type ResolvedItem } from "@/lib/recipe-cost";
import { matchesSearch } from "@/lib/search";
import { useKeyboardHeight } from "@/lib/typing";
import type { StoreData } from "@/lib/types";

type Option = { ref: string; group: string; resolved: ResolvedItem };

/**
 * 材料・仕込み品を選ぶボタンと、押すと開く選択画面（D-029）。
 * ブラウザ標準のプルダウンは、項目が多いと探しにくく、端末ごとに見た目も変わるため使わない。
 * スマホでは下から出るシート、PC では中央のダイアログとして表示する。
 */
export function ItemPicker({
  data,
  allowPrep,
  value,
  onChange,
}: {
  data: StoreData;
  allowPrep: boolean;
  /** 「種類:ID」（例 "prep:xxxx"）、未選択なら "" */
  value: string;
  onChange: (ref: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const keyboard = useKeyboardHeight(open);

  const byName = <T extends { name: string }>(list: T[]) => [...list].sort((a, b) => a.name.localeCompare(b.name, "ja"));
  const options: Option[] = [
    ...(allowPrep ? byName(data.preps) : []).map((p) => ({ ref: `prep:${p.id}`, group: "仕込み品", type: "prep" as const, id: p.id })),
    ...CATEGORIES.flatMap((c) =>
      byName(data.ingredients.filter((i) => i.category === c)).map((i) => ({
        ref: `ingredient:${i.id}`,
        group: c,
        type: "ingredient" as const,
        id: i.id,
      })),
    ),
  ].flatMap(({ ref, group, type, id }) => {
    const resolved = resolveItem(data, { type, id });
    return resolved ? [{ ref, group, resolved }] : [];
  });

  const selected = options.find((o) => o.ref === value);
  // かなとカタカナなどのゆらぎを吸収して探す（D-076）。種類の名前でも探せる
  const filtered = options.filter((o) => matchesSearch(query, o.resolved.name, o.group));
  const groups = [...new Set(filtered.map((o) => o.group))].map((g) => ({
    group: g,
    items: filtered.filter((o) => o.group === g),
  }));

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // showModal は最初の入力欄（検索欄）に自動で入る。スマホでいきなりキーボードが出ると
      // 一覧が隠れるので、スマホでは一覧のほうに移す
      if (window.matchMedia("(min-width: 640px)").matches) searchRef.current?.focus();
      else listRef.current?.focus({ preventScroll: true });
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function choose(ref: string) {
    onChange(ref);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setQuery("");
          setOpen(true);
        }}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-left transition-colors hover:border-accent"
      >
        {selected ? (
          <span className="min-w-0">
            <span className="block truncate font-bold">{selected.resolved.name}</span>
            <span className="num block text-xs text-muted">
              {yenDecimal(unitPrice(selected.resolved.source))}/{selected.resolved.baseUnit}
              {selected.group === "仕込み品" && "・仕込み品"}
            </span>
          </span>
        ) : (
          <span className="text-subtle">材料を選ぶ</span>
        )}
        <ChevronsUpDown className="size-4 shrink-0 text-subtle" aria-hidden />
      </button>

      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          // 画面の外側（背景）を押したら閉じる
          if (e.target === e.currentTarget) setOpen(false);
        }}
        aria-label="材料を選ぶ"
        // 高さを固定する。結果の数で縮むと、検索欄が動く。スマホではキーボードの裏に隠れてしまう（D-177）
        className="m-0 mt-auto h-[85dvh] w-full max-w-none rounded-t-2xl bg-surface p-0 text-foreground shadow-raised backdrop:bg-black/40 backdrop:backdrop-blur-[2px] sm:m-auto sm:h-[80vh] sm:max-w-lg sm:rounded-2xl"
      >
        {open && (
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 border-b border-border p-3">
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="材料名で探す"
                aria-label="材料名で探す"
                className={`${inputClass} flex-1`}
              />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="min-h-11 shrink-0 rounded-lg px-4 font-bold text-muted hover:bg-surface-muted"
              >
                閉じる
              </button>
            </div>
            <div
              ref={listRef}
              tabIndex={-1}
              // キーボードに隠れる分だけ下に余白を足し、いちばん下の行まで見られるようにする（D-177）
              style={keyboard > 0 ? { paddingBottom: keyboard + 16 } : undefined}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[max(1rem,env(safe-area-inset-bottom))] outline-none"
            >
              {groups.length === 0 && <p className="py-10 text-center text-muted">見つかりません</p>}
              {groups.map(({ group, items }) => (
                <section key={group}>
                  <h3 className="sticky top-0 bg-surface pb-1 pt-3 text-sm font-bold text-muted">{group}</h3>
                  <ul className="flex flex-col gap-1">
                    {items.map((o) => (
                      <li key={o.ref}>
                        <button
                          type="button"
                          onClick={() => choose(o.ref)}
                          aria-current={o.ref === value}
                          className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 text-left ${
                            o.ref === value ? "bg-accent-soft text-accent" : "hover:bg-background"
                          }`}
                        >
                          <span className="min-w-0 truncate font-bold">{o.resolved.name}</span>
                          <span className="num shrink-0 text-sm text-muted">
                            {yenDecimal(unitPrice(o.resolved.source))}/{o.resolved.baseUnit}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
