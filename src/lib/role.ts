"use client";

import { isDemoAutoLogin, useAuth } from "./auth";
import { useViewRole } from "./view-role";

/**
 * 画面の見え方を決める役割（D-092）。
 *
 * - 社員のアカウント：常に社員。切り替えはできない
 * - オーナーのアカウント：デモの切り替え（D-060）に従う。社員にすると、社員と同じ見え方になる
 * - 切り替えは手元のデモ（自動ログイン：D-070）のときだけ。公開サイトのオーナーは常にオーナー（D-123）
 *
 * 本物の権限は Supabase の RLS が守っている（D-033）。これは「何を画面に出すか」だけを決める。
 */
export function useEffectiveRole(): "admin" | "staff" {
  const auth = useAuth();
  const viewRole = useViewRole();
  if (auth.status !== "in") return "staff";
  if (auth.account.role !== "admin") return "staff";
  // 公開サイトでは、前に端末へ保存した切り替え（社員）が残っていても使わない。戻すボタンがないため
  return canSwitchViewRole ? viewRole : "admin";
}

/** 「オーナー／社員」の見え方の切り替えを出すか（D-123）。手元のデモだけ */
export const canSwitchViewRole = isDemoAutoLogin;
