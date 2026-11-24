"use client";

import { useCallback, useRef, useState } from "react";

/**
 * 保存・削除などを、終わるまで1回だけ走らせる（D-157）。
 * ボタンを続けて押しても2回目は何もしない（新しく追加するときに、同じものが2つできないように）。
 * 成功したら画面を移ることが多いので、押せないままにしておく。失敗したら、また押せるようにする。
 * 画面の state は描き直すまで変わらないので、すぐに効く useRef で止める。
 */
export function useOnce() {
  const running = useRef(false);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (action: () => Promise<void>, options: { release?: boolean } = {}) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await action();
      // 画面を移らない操作（一覧の中での振り分けなど）は、終わったらまた押せるようにする
      if (options.release) {
        running.current = false;
        setBusy(false);
      }
    } catch (error) {
      running.current = false;
      setBusy(false);
      throw error;
    }
  }, []);

  return { busy, run };
}
