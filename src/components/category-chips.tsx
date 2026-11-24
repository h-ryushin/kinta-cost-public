import Link from "next/link";

/**
 * 一覧の上に出す、種類・分類の絞り込みボタン。選択中の値は URL の ?category= で持つ
 * （編集画面から戻ったときに絞り込みを保つため）。件数が0の分類は出さない。
 */
export function CategoryChips<T extends string>({
  categories,
  selected,
  countOf,
  total,
  basePath,
}: {
  categories: readonly T[];
  selected: T | null;
  countOf: (category: T) => number;
  total: number;
  /** 例 "/menus"。絞り込み時は "/menus?category=牛" になる */
  basePath: string;
}) {
  const chips = [null, ...categories.filter((c) => countOf(c) > 0 || c === selected)];
  const href = (c: T | null) => (c ? `${basePath}?category=${encodeURIComponent(c)}` : basePath);
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 lg:pb-0">
      {chips.map((c) => (
        <Link
          key={c ?? "all"}
          href={href(c)}
          replace
          scroll={false}
          aria-current={selected === c}
          className={`flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-full border px-4 text-sm font-bold transition-colors ${
            selected === c
              ? "border-foreground bg-foreground text-white"
              : "border-border-strong bg-surface text-muted hover:border-foreground hover:text-foreground"
          }`}
        >
          {c ?? "すべて"}
          <span className={`num ml-1.5 font-normal ${selected === c ? "text-white/70" : "text-subtle"}`}>
            {c ? countOf(c) : total}
          </span>
        </Link>
      ))}
    </div>
  );
}

/** ?category= の値が一覧にあればそれを、なければ null を返す */
export function parseCategory<T extends string>(categories: readonly T[], value: string | null): T | null {
  return categories.find((c) => c === value) ?? null;
}
