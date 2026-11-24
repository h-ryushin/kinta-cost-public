import { useEffect, useState } from "react";

/**
 * 文字を打つ欄にカーソルがあるあいだ、<html> に data-typing を付ける（D-176）。
 * スマホではキーボードが出ると見える範囲が狭くなり、下に固定した原価のバーとタブが、打っている欄にかぶさる。
 * キーボードが出ているかはブラウザから直接は分からないので、文字を打つ欄にカーソルがあるかで見分ける。
 * 隠すのは指で触る端末だけ（globals.css の .hide-while-typing）。
 */
const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "password", "tel", "url", "number"]);

export function isTextField(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.type) && !el.readOnly && !el.disabled;
  return el instanceof HTMLElement && el.isContentEditable;
}

export function useTypingFlag() {
  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      if (isTextField(document.activeElement)) root.dataset.typing = "";
      else delete root.dataset.typing;
    };
    // 欄から欄へ移るときは、focusout のあとにすぐ focusin が来る。そのあいだに一瞬出ないよう、次の描画で見る
    const later = () => requestAnimationFrame(update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", later);
    return () => {
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", later);
      delete root.dataset.typing;
    };
  }, []);
}

/** キーボードに隠れている高さ（px）。画面全体の高さと、実際に見えている高さの差 */
export function keyboardHeight(windowHeight: number, visibleHeight: number, offsetTop: number): number {
  return Math.max(0, Math.round(windowHeight - visibleHeight - offsetTop));
}

/**
 * active のあいだ、キーボードに隠れている高さを返す（D-177）。
 * 下から出る画面の一覧に同じ高さの余白を足して、いちばん下の行までスクロールできるようにする。
 */
export function useKeyboardHeight(active: boolean): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!active || !viewport) return;
    const update = () => setHeight(keyboardHeight(window.innerHeight, viewport.height, viewport.offsetTop));
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      setHeight(0);
    };
  }, [active]);
  return height;
}
