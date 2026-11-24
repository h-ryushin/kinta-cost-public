"use client";

import { ArrowLeft, ChefHat, ChevronRight, LogIn, Mail, ScanFace } from "lucide-react";
import { useState } from "react";
import { Button, Card, ErrorMessage, Field, inputClass } from "@/components/ui";
import { AuthError, canUsePasskey, sendPasswordEmail, signIn, signInWithPasskey } from "@/lib/auth";
import { takeIdleLogoutNotice } from "@/lib/idle";
import { takeExpiredInvite } from "@/lib/invite-link";
import { isSupabaseConfigured } from "@/lib/supabase";

/**
 * ログイン画面（D-069・D-087・D-141）。
 * 「顔・指紋を登録した方」と「パスワードを決めた方」を、見出しを付けて縦に並べる。
 * はじめての人は招待メールのリンクでパスワードを決める（D-091）ので、ログインの欄とは別の案内に分ける（D-142）。
 * パスキーが1つもない端末でパスキーのボタンを押すと分かりにくいので、
 * そのときは自動でメールとパスワードの欄を開く。
 */
export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // 使い終わった（または期限が切れた）招待メールのリンクから来たときは、理由を知らせる（D-115・D-116）。
  // リンクは1回しか使えないので、パスワードを決めたあとにもう一度開いた人もここに来る。
  // その人はもうログインできるので、メールとパスワードの欄を開いて案内する
  const [expiredInvite] = useState(takeExpiredInvite);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(expiredInvite);
  // ログインの欄・「はじめての方」の案内（D-142）・「パスワードを忘れたとき」（D-153）のどれを出すか
  const [view, setView] = useState<"login" | "first" | "forgot">("login");
  // しばらく使わなかったのでログアウトしたときは、そう知らせる（D-133）
  const [idleLoggedOut] = useState(takeIdleLogoutNotice);
  const [notice, setNotice] = useState<string | null>(
    idleLoggedOut
      ? "安全のため、ログアウトしました（しばらく使っていなかったか、ページを離れたため）。もう一度ログインしてください"
      : expiredInvite
      ? "このリンクはもう使えません（1回だけ使えます）。パスワードを決めた方は、上のメールとパスワードでログインしてください。まだ決めていない方は、下の「はじめての方はこちら」からパスワードを決めるメールを受け取ってください"
      : null,
  );

  async function passwordEmail() {
    setError(null);
    setNotice(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError("メールアドレスを入れてから押してください");
      return;
    }
    setBusy(true);
    try {
      await sendPasswordEmail(email);
      // 登録されていないアドレスでも同じ表示にする（誰が登録しているかを知られないため：D-116）。
      // 届かないときにどうすればよいかを添える（D-151）
      setNotice(
        `登録されているアドレスなら、${email.trim()} あてにパスワードを決めるメールが届きます。数分たっても届かないときは、アドレスの打ち間違いか、まだ招待されていません。オーナーに確かめてください`,
      );
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "メールを送れませんでした");
    } finally {
      setBusy(false);
    }
  }
  const passkeyReady = canUsePasskey();

  function openView(next: "login" | "first" | "forgot") {
    setView(next);
    setError(null);
    setNotice(null);
  }

  async function passkey() {
    setError(null);
    setBusy(true);
    try {
      await signInWithPasskey();
    } catch (err) {
      // この端末にパスキーがない。メールとパスワードの欄を開いて案内する
      setShowPassword(true);
      setError(err instanceof AuthError ? "この端末では顔・指紋が使えませんでした。下のメールとパスワードでログインしてください" : "ログインできませんでした");
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "ログインできませんでした");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex size-12 items-center justify-center rounded-xl bg-accent text-white">
          <ChefHat className="size-6" aria-hidden />
        </span>
        <span className="leading-tight">
          <span className="block text-xl font-bold">きんた</span>
          <span className="block text-sm text-muted">原価計算</span>
        </span>
      </div>

      <Card className="w-full max-w-sm">
        {!isSupabaseConfigured ? (
          <p className="text-sm text-muted">
            接続先が設定されていません。`.env.local` に `NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_ANON_KEY`
            を書いてから、開発サーバーを立ち上げ直してください。
          </p>
        ) : view === "first" ? (
          <FirstTimeGuide
            email={email}
            onEmailChange={setEmail}
            onSend={() => void passwordEmail()}
            onBack={() => openView("login")}
            busy={busy}
            error={error}
            notice={notice}
          />
        ) : view === "forgot" ? (
          <ForgotPassword
            email={email}
            onEmailChange={setEmail}
            onSend={() => void passwordEmail()}
            onBack={() => openView("login")}
            busy={busy}
            error={error}
            notice={notice}
          />
        ) : (
          <div className="flex flex-col gap-6">
            {passkeyReady && (
              <div>
                <p className="mb-2 text-sm font-bold text-muted">顔・指紋を登録した方</p>
                <Button onClick={() => void passkey()} disabled={busy} className="min-h-14 w-full text-base">
                  <ScanFace aria-hidden />
                  {busy ? "確認しています…" : "顔・指紋でログイン"}
                </Button>
              </div>
            )}

            <div className={passkeyReady ? "border-t border-border pt-5" : ""}>
              {passkeyReady && <p className="mb-2 text-sm font-bold text-muted">パスワードを決めた方</p>}
              {showPassword || !passkeyReady ? (
                <form onSubmit={submit} className="flex flex-col gap-4">
                  <Field label="メールアドレス">
                    {(id) => (
                      <input
                        id={id}
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={inputClass}
                        autoComplete="username"
                        autoCapitalize="off"
                        required
                      />
                    )}
                  </Field>
                  <Field label="パスワード">
                    {(id) => (
                      <input
                        id={id}
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className={inputClass}
                        autoComplete="current-password"
                        required
                      />
                    )}
                  </Field>
                  <Button type="submit" variant="secondary" disabled={busy} className="min-h-12 w-full">
                    <LogIn aria-hidden />
                    {busy ? "確認しています…" : "メールとパスワードでログイン"}
                  </Button>
                  {/* パスワードを忘れた人は、メールアドレスだけを入れる別の画面で受け取る（D-116・D-153） */}
                  <button
                    type="button"
                    onClick={() => openView("forgot")}
                    disabled={busy}
                    className="min-h-12 text-sm font-bold text-accent hover:underline disabled:opacity-50"
                  >
                    パスワードを忘れたとき
                  </button>
                </form>
              ) : (
                <Button variant="secondary" onClick={() => setShowPassword(true)} className="min-h-12 w-full">
                  <LogIn aria-hidden />
                  メールとパスワードでログイン
                </Button>
              )}
            </div>

            {/* はじめての人は、パスワードをまだ持っていない。ログインの欄とは分けて案内する（D-091・D-142） */}
            <div className="border-t border-border pt-3">
              <button
                type="button"
                onClick={() => openView("first")}
                className="flex min-h-12 w-full items-center justify-between gap-2 text-left font-bold text-accent hover:underline"
              >
                はじめての方はこちら
                <ChevronRight className="size-5 shrink-0" aria-hidden />
              </button>
            </div>

            <LoginMessages error={error} notice={notice} />
          </div>
        )}
      </Card>
    </main>
  );
}

/** メールを送る画面（はじめての方へ・パスワードを忘れたとき）に共通の値 */
type EmailSendProps = {
  email: string;
  onEmailChange: (value: string) => void;
  onSend: () => void;
  onBack: () => void;
  busy: boolean;
  error: string | null;
  notice: string | null;
};

/** エラーと知らせ。ログイン画面と、メールを送る画面で同じ見た目にする */
function LoginMessages({ error, notice }: { error: string | null; notice: string | null }) {
  return (
    <>
      <ErrorMessage message={error} />
      {notice && (
        <p role="status" className="rounded-lg border border-border bg-surface-muted px-4 py-3 text-sm font-bold">
          {notice}
        </p>
      )}
    </>
  );
}

/** ログインの欄とは別の画面（D-142・D-153）の枠。上に「ログインに戻る」、下にエラーと知らせ */
function LoginSubView({
  title,
  description,
  onBack,
  error,
  notice,
  children,
}: {
  title: string;
  description: string;
  onBack: () => void;
  error: string | null;
  notice: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      <button
        type="button"
        onClick={onBack}
        className="flex min-h-11 items-center gap-1 self-start text-sm font-bold text-muted hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        ログインに戻る
      </button>
      <div>
        <h1 className="text-lg font-bold">{title}</h1>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
      {children}
      <LoginMessages error={error} notice={notice} />
    </div>
  );
}

/** メールアドレスだけを入れて、パスワードを決めるメールを受け取る欄（D-116） */
function EmailSendForm({
  email,
  onEmailChange,
  onSend,
  busy,
  label,
  primary = false,
}: Pick<EmailSendProps, "email" | "onEmailChange" | "onSend" | "busy"> & { label: string; primary?: boolean }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
      }}
      className="flex flex-col gap-3"
    >
      <Field label="メールアドレス">
        {(id) => (
          <input
            id={id}
            type="email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            className={inputClass}
            autoComplete="username"
            autoCapitalize="off"
            required
          />
        )}
      </Field>
      <Button type="submit" variant={primary ? "primary" : "secondary"} disabled={busy} className="min-h-12 w-full">
        <Mail aria-hidden />
        {busy ? "送っています…" : label}
      </Button>
    </form>
  );
}

/**
 * はじめての方への案内（D-142・D-147）。はじめての人はまだパスワードを持っていないので、
 * ログインの欄とは分け、招待メールでパスワードを決める流れだけを見せる。
 * 招待メールが見つからない・リンクが使えないときは、ここからパスワードを決めるメールを受け取れる（D-116）。
 */
function FirstTimeGuide({ onBack, error, notice, ...form }: EmailSendProps) {
  return (
    <LoginSubView
      title="はじめての方へ"
      description="このアプリのアカウントは、オーナーが作ります。オーナーが招待すると、あなたのメールアドレスに招待メールが届きます。そこからパスワードを決めて始めます。"
      onBack={onBack}
      error={error}
      notice={notice}
    >
      <ol className="flex flex-col gap-3 text-sm">
        {[
          "オーナーに、使うメールアドレスを伝える（オーナーが招待します）",
          "届いた招待メールを開く",
          "メールのリンクを押す",
          "パスワードを決める（8文字以上）",
          "そのまま中に入れます。次からは「パスワードを決めた方」から入ります",
        ].map((step, i) => (
          <li key={step} className="flex gap-3">
            <span className="num flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent">
              {i + 1}
            </span>
            <span className="pt-0.5">{step}</span>
          </li>
        ))}
      </ol>
      <p className="text-sm text-muted">
        顔・指紋を登録すると、次からパスワードを打たずに入れます（入ったあと「その他」→「ログインと安全」）。
      </p>

      <div className="border-t border-border pt-5">
        <p className="mb-1 text-sm font-bold">招待メールが見つからない・リンクが使えないとき</p>
        <p className="mb-3 text-sm text-muted">
          オーナーに招待してもらったメールアドレスを入れて送ると、パスワードを決めるメールが届きます。まだ招待されていない方は、先にオーナーに頼んでください（招待されていないアドレスには届きません）。
        </p>
        <EmailSendForm {...form} label="メールを送る" />
      </div>
    </LoginSubView>
  );
}

/**
 * パスワードを忘れたときの画面（D-153）。メールアドレスだけを入れて、パスワードを決め直すメールを受け取る。
 * メールのリンクを開くと、新しいパスワードだけを入れる画面が出る（invite-accept.tsx）。
 */
function ForgotPassword({ onBack, error, notice, ...form }: EmailSendProps) {
  return (
    <LoginSubView
      title="パスワードを忘れたとき"
      description="メールアドレスを入れて送ると、新しいパスワードを決めるメールが届きます。メールのリンクを開いて、新しいパスワードを入れてください。"
      onBack={onBack}
      error={error}
      notice={notice}
    >
      <EmailSendForm {...form} label="メールを送る" primary />
    </LoginSubView>
  );
}
