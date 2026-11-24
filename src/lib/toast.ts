"use client";

import { useSyncExternalStore } from "react";
import { newId } from "./id";

/**
 * 保存・削除のあとに画面の上へ短く出す知らせ（D-062）。
 * 保存すると一覧の画面に移ってしまい、何が起きたか分からないため。
 */
export type Toast = { id: string; message: string };

/** 読んで消えるまでの時間。厨房で手が離せなくても読める長さにする */
const DURATION = 3500;

const EMPTY: Toast[] = [];
let toasts: Toast[] = EMPTY;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function showToast(message: string) {
  const toast = { id: newId(), message };
  toasts = [...toasts, toast];
  emit();
  setTimeout(() => dismissToast(toast.id), DURATION);
}

export function dismissToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => toasts,
    () => EMPTY,
  );
}
