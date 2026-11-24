"use client";

import { KeyRound, ScanFace, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Card, ErrorMessage, inputClass } from "@/components/ui";
import {
  AuthError,
  canUsePasskey,
  currentEmail,
  countPasskeys,
  registerPasskey,
  signInWithPasskey,
  signOut,
  redeemRecoveryCode,
  verifyDeviceCode,
} from "@/lib/auth";

/**
 * 管理者（オーナー）にパスキーを登録してもらう画面（D-086）。
 * 認証アプリ（6桁）は使わない。この端末の Face ID・指紋・画面ロックだけで登録できる。
 */
export function PasskeySetupPage() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // すでに登録済みなら、登録ではなく「顔・指紋でログインし直す」だけでよい（D-088）
  const [registered, setRegistered] = useState<boolean | null>(null);
  const supported = canUsePasskey();

  useEffect(() => {
    countPasskeys().then((n) => setRegistered(n > 0), () => setRegistered(false));
  }, []);

  /** 登録したあと、そのままパスキーでログインし直してセッションを切り替える */
  async function run(register: boolean) {
    setBusy(true);
    setError(null);
    try {
      if (register) await registerPasskey();
      await signInWithPasskey();
      window.location.reload();
    } catch (e) {
      setError(e instanceof AuthError ? e.message : "うまくいきませんでした");
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 py-10">
      <Card className="w-full max-w-sm">
        <div className="mb-4 flex items-center gap-2">
          <ScanFace className="size-6 text-accent" aria-hidden />
          <h1 className="text-lg font-bold">あと1回だけ、認証します</h1>
        </div>

        {supported ? (
          <>
            <p className="mb-4 text-sm text-muted">
              {registered
                ? "顔・指紋は登録済みです。顔か指紋で、ログインし直してください（PC では iPhone の QRコードも使えます）。"
                : "下のボタンを押して、顔か指紋で認証してください。次からは、それだけでログインできます。"}
            </p>
            <Button onClick={() => void run(!registered)} disabled={busy || registered === null} className="min-h-14 w-full text-base">
              <ScanFace aria-hidden />
              {busy ? "確認しています…" : registered ? "顔・指紋でログインする" : "顔・指紋を登録する"}
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted">
            このブラウザはパスキーに対応していません。iPhone の Safari か、Mac・Windows の Chrome で開いてください。
          </p>
        )}

        <ErrorMessage message={error} />
      </Card>
      <DeviceCodeCard />
      <RecoveryCodeCard />
      <button type="button" onClick={() => void signOut()} className="text-sm font-bold text-muted hover:text-foreground">
        ログインし直す
      </button>
    </main>
  );
}

/**
 * 顔・指紋が使えないとき（Windows の PC など）は、同じアカウントで入っている iPhone に出した6桁で本人確認する（D-138）。
 * どのアカウントの iPhone か分かるよう、入力したメールアドレスを出す。
 * パスワードのあとにこの画面が出るので、「パスワード＋iPhone の数字」の2つがそろって入れる。
 */
function DeviceCodeCard() {
  const [email, setEmail] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    currentEmail().then(setEmail, () => setEmail(null));
  }, []);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await verifyDeviceCode(code);
      window.location.reload();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "確かめられませんでした");
      setBusy(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <div className="mb-2 flex items-center gap-2">
        <Smartphone className="size-5 text-muted" aria-hidden />
        <h2 className="font-bold">顔・指紋が使えないとき（PC など）</h2>
      </div>
      <ol className="mb-3 list-decimal pl-5 text-sm text-muted">
        <li>{email ? `このアカウント（${email}）で入っている iPhone で、このアプリを開く` : "このアカウントで入っている iPhone で、このアプリを開く"}</li>
        <li>「その他」→「ログインと安全」→「数字を出す」を押す</li>
        <li>出てきた6桁を、ここに入れる（5分だけ使えます）</li>
      </ol>
      <form onSubmit={(e) => void verify(e)} className="flex flex-col gap-3">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="off"
          aria-label="iPhone に出た6桁の数字"
          placeholder="123456"
          className={`${inputClass} num text-center text-2xl tracking-[0.3em]`}
        />
        <Button type="submit" disabled={busy || code.length !== 6} className="min-h-12 w-full">
          {busy ? "確かめています…" : "確かめる"}
        </Button>
      </form>
      <ErrorMessage message={error} />
    </Card>
  );
}

/**
 * iPhone をなくした・壊れたときは、控えておいた復旧コードで入る（D-139）。
 * 入れたら「その他」→「ログインと安全」で新しい端末の顔・指紋を登録し、復旧コードを作り直してもらう。
 */
function RecoveryCodeCard() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function redeem(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await redeemRecoveryCode(code);
      window.location.reload();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "確かめられませんでした");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="min-h-12 text-sm font-bold text-accent hover:underline">
        iPhone をなくした・壊れたとき（復旧コードで入る）
      </button>
    );
  }
  return (
    <Card className="w-full max-w-sm">
      <div className="mb-2 flex items-center gap-2">
        <KeyRound className="size-5 text-muted" aria-hidden />
        <h2 className="font-bold">復旧コードで入る</h2>
      </div>
      <p className="mb-3 text-sm text-muted">
        控えておいた復旧コード（XXXX-XXXX）を1つ入れてください。使ったコードは、もう使えません。入れたら「その他」→「ログインと安全」で新しい端末の顔・指紋を登録し、復旧コードを作り直してください。
      </p>
      <form onSubmit={(e) => void redeem(e)} className="flex flex-col gap-3">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 12))}
          autoComplete="off"
          autoCapitalize="characters"
          aria-label="復旧コード"
          placeholder="XXXX-XXXX"
          className={`${inputClass} num text-center text-xl tracking-widest`}
        />
        <Button type="submit" disabled={busy || code.replace(/[^0-9A-Z]/g, "").length !== 8} className="min-h-12 w-full">
          {busy ? "確かめています…" : "確かめる"}
        </Button>
      </form>
      <ErrorMessage message={error} />
    </Card>
  );
}
