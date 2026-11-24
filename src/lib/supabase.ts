"use client";

import { createClient } from "@supabase/supabase-js";
import { rememberInviteLink } from "./invite-link";
import { removeOldSessions, tabSessionStorage } from "./session-storage";

/**
 * Supabase への接続（D-069）。ブラウザから直接つなぐ構成なので、ここで使うのは
 * 公開してよい anon キーだけ。権限はデータベースの RLS で守る（D-012・D-033）。
 * 接続先は .env.local に書く（Git には上げない）。
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

// 接続を作ると、招待メールのリンクの印（#…type=invite）が URL から消される。その前に覚えておく（D-115）
rememberInviteLink();

// ログインはそのタブの中だけに置く。閉じたり、リンクを開き直したりしたらログイン画面から（D-136）
if (typeof window !== "undefined") removeOldSessions();

export const supabase = createClient(url ?? "http://localhost", anonKey ?? "missing-key", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: typeof window === "undefined" ? undefined : tabSessionStorage,
  },
});
