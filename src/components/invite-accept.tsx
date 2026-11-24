"use client";

import { KeyRound } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Button, Card, ErrorMessage, Field, inputClass } from "@/components/ui";
import { markLoginToRecord } from "@/lib/auth";
import { finishInvite, isInvitePending, isPasswordReset } from "@/lib/invite-link";
import { supabase } from "@/lib/supabase";

const MIN_PASSWORD_LENGTH = 8;

/**
 * 招待メールのリンクから来た人に、パスワードを決めてもらう画面（D-091）。
 * リンクには一時的なログイン情報が付いているので、この画面ではパスワードを決めるだけでよい。
 */
export function InviteAcceptPage({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // パスワードを忘れたときのメールから来たときは「はじめだけ」ではないので、文を変える（D-153）
  const [reset] = useState(isPasswordReset);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // 8文字以上（D-117。要件定義書の12文字から、オーナーの判断でゆるめた）
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください`);
      return;
    }
    if (password !== again) {
      setError("2つのパスワードが違います");
      return;
    }
    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      // Supabase 側の決まり（短すぎる・簡単すぎる）で断られたときは、そう伝える
      setError(
        updateError.code === "weak_password"
          ? "このパスワードは使えません。もう少し長いか、推測されにくいものにしてください"
          : // 原因が分かるよう、Supabase が返した理由を添える（D-088 と同じ）
            `設定できませんでした（${updateError.code ?? updateError.message}）。ログイン画面の「パスワードを忘れたとき」から、もう一度メールを受け取ってください`,
      );
      return;
    }
    finishInvite();
    // 招待メールから入ってパスワードを決めたのも、ログインとして操作ログに残す（D-130）
    markLoginToRecord();
    onDone();
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <Card className="w-full max-w-sm">
        <div className="mb-4 flex items-center gap-2">
          <KeyRound className="size-6 text-accent" aria-hidden />
          <h1 className="text-lg font-bold">{reset ? "新しいパスワードを決めてください" : "パスワードを決めてください"}</h1>
        </div>
        <p className="mb-4 text-sm text-muted">
          {reset
            ? `新しいパスワードを入れてください（${MIN_PASSWORD_LENGTH}文字以上）。決めたら、そのまま中に入れます。`
            : `はじめだけ設定します。${MIN_PASSWORD_LENGTH}文字以上にしてください。`}
        </p>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <Field label="パスワード">
            {(id) => (
              <input
                id={id}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
                autoComplete="new-password"
                required
              />
            )}
          </Field>
          <Field label="もう一度">
            {(id) => (
              <input
                id={id}
                type="password"
                value={again}
                onChange={(e) => setAgain(e.target.value)}
                className={inputClass}
                autoComplete="new-password"
                required
              />
            )}
          </Field>
          <Button type="submit" disabled={busy} className="min-h-12 w-full">
            {busy ? "設定しています…" : "決める"}
          </Button>
        </form>
        <ErrorMessage message={error} />
      </Card>
    </main>
  );
}

/**
 * 招待メールのリンクから来て、まだパスワードを決めていないか（D-115）。
 * URL の印は supabase-js が消してしまうので、接続を作る前に覚えておいたもの（invite-link.ts）を見る。
 */
export function useIsInvite(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => isInvitePending(),
    () => false,
  );
}
