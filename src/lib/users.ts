"use client";

import { StoreError } from "./store";
import { supabase } from "./supabase";

/**
 * 利用者（オーナーと社員）の管理（D-091）。
 * アカウントを作るには service_role キーが要るので、Supabase の Edge Function（`invite-staff`）を通す。
 * 画面には service_role キーを置かない（要件定義書 4.2）。
 */
export type AppUser = {
  id: string;
  displayName: string;
  role: "admin" | "staff";
  isActive: boolean;
  createdAt: string;
};

type ProfileRow = {
  id: string;
  display_name: string;
  role: string;
  is_active: boolean;
  created_at: string;
};

/** 利用者の一覧。オーナーだけが全員を読める（社員は自分だけ） */
export async function listUsers(): Promise<AppUser[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, role, is_active, created_at")
    .order("role")
    .order("created_at");
  if (error) throw new StoreError("利用者を読み込めませんでした");
  return (data as ProfileRow[]).map((r) => ({
    id: r.id,
    displayName: r.display_name,
    role: r.role as "admin" | "staff",
    isActive: r.is_active,
    createdAt: r.created_at,
  }));
}

/** 社員を招待する。メールが届き、本人がパスワードを決める */
export async function inviteStaff(displayName: string, email: string) {
  const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>("invite-staff", {
    body: { displayName, email },
  });
  // 関数が 4xx を返すと error になる。中身のメッセージを拾って、そのまま画面に出す
  if (error) {
    const detail = await readFunctionError(error);
    // すでにアカウントがある人は招待し直せない。本人がログイン画面からパスワードのメールを受け取れる（D-116）
    if (detail?.includes("すでに登録")) {
      throw new StoreError(
        `${detail}。パスワードをまだ決めていない場合は、本人にログイン画面の「はじめての方はこちら」から、パスワードを決めるメールを受け取ってもらってください`,
      );
    }
    throw new StoreError(detail ?? `招待できませんでした（${(error as Error).message}）`);
  }
  if (data?.error) throw new StoreError(data.error);
}

async function readFunctionError(error: unknown): Promise<string | null> {
  const context = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
  if (!context?.json) return null;
  try {
    const body = await context.json();
    return body?.error ?? null;
  } catch {
    return null;
  }
}

/**
 * 社員を削除する（D-118）。オーナーだけが呼べる（データベースの関数が確かめる）。
 * 操作ログには名前が残り、材料・メニューのデータも消えない。
 */
export async function deleteStaff(id: string) {
  const { error } = await supabase.rpc("delete_staff", { p_user_id: id });
  if (error) throw new StoreError(error.message || "削除できませんでした");
}

/** 社員を停止する・戻す。停止するとデータベースが何も返さなくなる */
export async function setUserActive(id: string, isActive: boolean) {
  const { error } = await supabase.from("profiles").update({ is_active: isActive }).eq("id", id);
  if (error) throw new StoreError("変更できませんでした。オーナーだけが操作できます");
}
