"use client";

import { ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * 下までスクロールしたときに出る「上に戻る」ボタン（D-073）。
 * 材料が178品あると一覧が長くなり、上の検索欄や分類の絞り込みまで戻るのが大変なため。
 * スマホでは下のタブに重ならない高さに置く。
 */
const SHOW_AFTER = 600;

export function ScrollToTop() {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      // スクロールのたびに状態を更新すると重いので、描画のタイミングにまとめる
      requestAnimationFrame(() => {
        setShown(window.scrollY > SHOW_AFTER);
        ticking = false;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!shown) return null;

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="いちばん上に戻る"
      className="hide-while-typing fixed bottom-24 right-4 z-[9] flex size-13 items-center justify-center rounded-full border border-border bg-surface text-muted shadow-raised transition-colors hover:text-foreground active:bg-surface-muted lg:bottom-6 lg:right-6"
    >
      <ArrowUp className="size-6" aria-hidden />
    </button>
  );
}
