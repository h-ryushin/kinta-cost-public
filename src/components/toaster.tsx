"use client";

import { CheckCircle2 } from "lucide-react";
import { dismissToast, useToasts } from "@/lib/toast";

/**
 * 保存・削除のあとの知らせを、画面の上に重ねて出す（D-062）。
 * 画面が切り替わっても消えないよう、画面ごとではなく AppShell に置く。
 */
export function Toaster() {
  const toasts = useToasts();
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-30 flex flex-col items-center gap-2 px-4 lg:pl-60">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          onClick={() => dismissToast(toast.id)}
          role="status"
          className="pointer-events-auto flex max-w-sm items-center gap-2 rounded-xl border border-ok/30 bg-ok-soft px-4 py-3 font-bold text-ok shadow-raised"
        >
          <CheckCircle2 className="size-5 shrink-0" aria-hidden />
          {toast.message}
        </button>
      ))}
    </div>
  );
}
