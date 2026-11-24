/**
 * 社員を招待する（D-091）。オーナー（管理者）だけが呼べる。
 *
 * 画面からは service_role キーを使えないので、この関数の中だけで使う（要件定義書 4.2、D-033）。
 * やること：
 *   1. 呼んだ人がオーナーか確かめる（呼んだ人の権限で profiles を読む）
 *   2. 招待メールを送る（受け取った人が自分でパスワードを決める）
 *   3. profiles に社員として1行入れる
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
/** 招待メールのリンクから戻ってくる先 */
const siteUrl = Deno.env.get("INVITE_REDIRECT_URL") ?? "";

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  // ブラウザから supabase-js で呼ぶと apikey と x-client-info も送られる。
  // ここに書いていないと、確認（preflight）の段階で止まる
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const fail = (message: string, status = 400) =>
  new Response(JSON.stringify({ error: message }), { status, headers });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return fail("POST で呼んでください", 405);

  const auth = request.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return fail("ログインしていません", 401);

  // 1. 呼んだ人の権限で読む。オーナー以外はここで弾かれる
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: auth } } });
  const { data: me } = await caller.auth.getUser();
  if (!me?.user) return fail("ログインしていません", 401);
  const { data: profile } = await caller.from("profiles").select("role").eq("id", me.user.id).maybeSingle();
  if (profile?.role !== "admin") return fail("オーナーだけが社員を招待できます", 403);

  let body: { email?: string; displayName?: string };
  try {
    body = await request.json();
  } catch {
    return fail("内容を読み取れませんでした");
  }
  const email = (body.email ?? "").trim();
  const displayName = (body.displayName ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("メールアドレスを確かめてください");
  if (displayName.length < 1 || displayName.length > 50) return fail("名前は1〜50文字で入れてください");

  // 2. 招待メールを送る（パスワードは受け取った人が決める）
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { display_name: displayName },
    redirectTo: siteUrl || undefined,
  });
  if (inviteError || !invited?.user) {
    const already = /already|registered|exists/i.test(inviteError?.message ?? "");
    return fail(already ? "このメールアドレスは、すでに登録されています" : "招待メールを送れませんでした", 400);
  }

  // 3. 社員として登録する
  const { error: profileError } = await admin
    .from("profiles")
    .upsert({ id: invited.user.id, display_name: displayName, role: "staff" }, { onConflict: "id" });
  if (profileError) return fail("社員として登録できませんでした", 500);

  return new Response(JSON.stringify({ ok: true, email }), { headers });
});
