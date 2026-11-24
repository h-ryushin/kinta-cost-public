"use client";

import { useSyncExternalStore } from "react";

/**
 * 「表示する立場」（D-060）。秘密レシピの見え方をデモで見せるための仮のしくみ。
 *
 * ログイン機能ができたら、ここをログイン中の利用者の権限に差し替える。
 * 本物の権限は Supabase の RLS で守る（D-033）ので、この切り替えは画面の見え方だけを変える。
 * 原価計算のデータはこの端末にしかないため、社員の立場でも金額は計算できる（本番では暗号文しか持たない）。
 */
export const VIEW_ROLES = ["admin", "staff"] as const;
export type ViewRole = (typeof VIEW_ROLES)[number];

export const VIEW_ROLE_LABEL: Record<ViewRole, string> = { admin: "オーナー", staff: "社員" };

/** 立場は入力したデータではなく画面の設定なので、データ（STORAGE_KEY）とは別に持つ */
const KEY = "kinta-genka:view-role";
const DEFAULT_ROLE: ViewRole = "admin";

let current: ViewRole | null = null;
const listeners = new Set<() => void>();

function read(): ViewRole {
  // Safari のプライベートモードなど、保存できない端末では読むだけで失敗することがある。
  // そのときは今の画面のあいだだけ覚えておく（D-132）
  try {
    const saved = window.localStorage.getItem(KEY);
    return VIEW_ROLES.find((r) => r === saved) ?? current ?? DEFAULT_ROLE;
  } catch {
    return current ?? DEFAULT_ROLE;
  }
}

function getSnapshot(): ViewRole {
  if (current === null) current = read();
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // 別のタブで切り替えたときも画面を合わせる
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    current = read();
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** 画面で今の立場を読む */
export function useViewRole(): ViewRole {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_ROLE);
}

/** 保存する関数の中で立場を見るため（画面の外から読む） */
export function viewRole(): ViewRole {
  if (typeof window === "undefined") return DEFAULT_ROLE;
  return getSnapshot();
}

export function setViewRole(role: ViewRole) {
  // 社員のアカウントはログインのたびにここを通る（app-shell）。保存できない端末でも止まらないようにする（D-132）
  try {
    window.localStorage.setItem(KEY, role);
  } catch {
    // 保存できなくても、今の画面のあいだは current で覚えている
  }
  current = role;
  listeners.forEach((l) => l());
}
