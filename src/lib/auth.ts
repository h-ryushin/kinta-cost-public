"use client";

import { useEffect, useState } from "react";
import {
  clearLastActive,
  isIdleExpired,
  markIdleLogout,
  markLeftPage,
  readLastActive,
  takeLeftTooLong,
  touchLastActive,
} from "./idle";
import { nextMfaStep, strongSignIn } from "./mfa";
import { supabase } from "./supabase";

/**
 * ログインの状態（D-069・D-081）。
 * メールとパスワードのあと、認証アプリの6桁（TOTP）まで済ませて初めて中を使える（要件定義書 4.1）。
 * データベースの RLS も二段階認証（aal2）を求めるので、ここを通らないとデータは1行も見えない。
 *
 * デモのときは、ログイン画面を出さずに自動でサインインする（D-070）。
 * `.env.local` に NEXT_PUBLIC_DEMO_EMAIL と NEXT_PUBLIC_DEMO_PASSWORD があるときだけ動く。
 * この2つはブラウザに渡る値なので、**デモ用のプロジェクトでだけ使い、公開しない。**
 */
export type Account = {
  userId: string;
  email: string;
  displayName: string;
  role: "admin" | "staff";
};

export type AuthState =
  | { status: "loading" }
  | { status: "out" }
  /** 管理者がパスキーをまだ使っていない。登録してもらう（D-086） */
  | { status: "passkey-setup" }
  | { status: "in"; account: Account };

export class AuthError extends Error {}

const demoEmail = process.env.NEXT_PUBLIC_DEMO_EMAIL;
const demoPassword = process.env.NEXT_PUBLIC_DEMO_PASSWORD;
export const isDemoAutoLogin = Boolean(demoEmail && demoPassword);

/** ログイン中の人と、その役割（profiles の行）を読む */
// ---------- ログインを操作ログに残す（D-130） ----------
// 画面を開き直しただけで記録しないよう、ログインの操作をしたときだけ印を付け、中に入れたときに1回だけ記録する。
// オーナーはパスワードのあと顔・指紋を通るまで記録できない（record_login が受け付けない）ので、そこまで印を持ち越す。
// 顔・指紋の画面は通ったあと読み込み直すので、印は sessionStorage に置く。
const LOGIN_MARK = "kinta.record-login";

/** ログインの操作をした印を付ける。招待メールからパスワードを決めたときも呼ぶ */
export function markLoginToRecord() {
  try {
    sessionStorage.setItem(LOGIN_MARK, "1");
  } catch {
    // 保存できない端末では記録しない（ログインそのものは続ける）
  }
}

function takeLoginMark(): boolean {
  try {
    const marked = sessionStorage.getItem(LOGIN_MARK) === "1";
    sessionStorage.removeItem(LOGIN_MARK);
    return marked;
  } catch {
    return false;
  }
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let alive = true;

    async function read(userId: string | undefined, email: string | undefined) {
      if (!userId) {
        if (alive) setState({ status: "out" });
        return;
      }
      // 自分の profiles は二段階認証の前（aal1）でも読める。役割で必須かどうかが変わるので先に読む
      const { data, error } = await supabase.from("profiles").select("display_name, role").eq("id", userId).maybeSingle();
      if (!alive) return;
      if (error || !data) {
        // ログインはできたが利用者の登録がない。何も見られないのでログインしていない扱いにする
        console.error("利用者の登録が見つかりません", error);
        void supabase.auth.signOut();
        setState({ status: "out" });
        return;
      }
      // 本人確認は管理者だけ必須（D-082・D-086）。パスキーで入ったか、iPhone の6桁で確かめ済みならよい（D-138）。
      // デモの自動ログイン中は求めない（D-070）
      const role = data.role as "admin" | "staff";
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const strong =
        strongSignIn((aal?.currentAuthenticationMethods ?? []) as (string | { method: string })[]) ||
        (role === "admin" && (await sessionVerified()));
      if (!alive) return;
      if (nextMfaStep(role, strong, isDemoAutoLogin) === "enroll") {
        setState({ status: "passkey-setup" });
        return;
      }

      // 中に入れたら、使った印を残す（しばらく使わないとログアウト：D-133）
      touchLastActive(Date.now());
      if (takeLoginMark()) {
        // 記録に失敗しても、ログインそのものは止めない
        void supabase.rpc("record_login").then(({ error: logError }) => {
          if (logError) console.error("ログインを記録できませんでした", logError);
        });
      }
      setState({
        status: "in",
        account: {
          userId,
          email: email ?? "",
          displayName: data.display_name as string,
          role,
        },
      });
    }

    async function start() {
      const { data } = await supabase.auth.getSession();
      // しばらく使っていなかったら（D-133）、またはページを離れて1分を超えてから戻ってきたら（D-136）、
      // ログインし直してもらう。デモの自動ログインは入り直すだけなので見ない
      const leftTooLong = takeLeftTooLong();
      if (data.session && !isDemoAutoLogin && (leftTooLong || isIdleExpired(readLastActive(), Date.now()))) {
        await idleLogout();
        if (alive) setState({ status: "out" });
        return;
      }
      // デモのときは、ログイン画面を出さずに自動で入る（D-070）
      if (!data.session && demoEmail && demoPassword) {
        const { data: signedIn, error } = await supabase.auth.signInWithPassword({
          email: demoEmail,
          password: demoPassword,
        });
        if (!error && signedIn.session) {
          await read(signedIn.session.user.id, signedIn.session.user.email);
          return;
        }
        console.error("デモ用の自動ログインに失敗しました", error);
      }
      await read(data.session?.user.id, data.session?.user.email);
    }

    void start();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      void read(session?.user.id, session?.user.email);
    });

    // 開いたまま置いておいたとき（PC など）も、時間がたったらログアウトする。触ったら使った印を残す（D-133）
    const onActive = () => touchLastActive();
    const check = () => {
      if (isDemoAutoLogin || !isIdleExpired(readLastActive(), Date.now())) return;
      void supabase.auth.getSession().then(({ data }) => data.session && idleLogout());
    };
    const timer = window.setInterval(check, 60_000);
    const onVisible = () => (document.visibilityState === "visible" ? check() : undefined);
    // ページを離れた時刻を残す（読み込み直しでも呼ばれるが、1分以内に戻るので消えない：D-136）
    const onLeave = () => markLeftPage();
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("pointerdown", onActive);
    window.addEventListener("keydown", onActive);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
      window.clearInterval(timer);
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("pointerdown", onActive);
      window.removeEventListener("keydown", onActive);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return state;
}

export async function signIn(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) {
    // 利用者に出すので日本語にする。理由は細かく言わない（当てずっぽうの手助けにしないため）
    throw new AuthError("メールアドレスかパスワードが違います");
  }
  markLoginToRecord();
}

/**
 * パスワードを決める（決め直す）メールを送る（D-116）。
 * 招待メールのリンクを使う前に使えなくなった人や、パスワードを忘れた人が、自分で受け取れるようにする。
 * メールのリンクは招待と同じく、パスワードを決める画面に来る（type=recovery。invite-link.ts）。
 * 登録されていないアドレスでも同じように「送りました」と出す（誰が登録しているかを知られないため）。
 */
export async function sendPasswordEmail(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
  if (error) {
    throw new AuthError(
      error.status === 429 ? "メールを送りすぎました。1時間ほどあけてから、もう一度試してください" : "メールを送れませんでした",
    );
  }
}

export async function signOut() {
  clearLastActive();
  await supabase.auth.signOut();
}

// ---------- ほかの端末には、オーナーの iPhone に出した6桁で入る（D-138） ----------

/** 今ログインしているアカウントのメールアドレス。通信せずに、端末にあるログインの記録から読む */
export async function currentEmail(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.email ?? null;
}

/** 顔・指紋で入っている端末（このアカウントの iPhone）で、ほかの端末に入るための6桁を出す。5分だけ使える */
export async function createDeviceCode(): Promise<string> {
  const { data, error } = await supabase.rpc("create_device_login_code");
  if (error || typeof data !== "string") throw new AuthError(error?.message || "数字を出せませんでした");
  return data;
}

/** iPhone に出た6桁を、パスワードで入った端末（PC など）で確かめる。通ると、この端末はオーナーとして使える */
export async function verifyDeviceCode(code: string) {
  const { data, error } = await supabase.rpc("verify_device_login_code", { p_code: code.trim() });
  if (error) throw new AuthError(error.message || "確かめられませんでした");
  if (data !== true) throw new AuthError("数字が違うか、5分を過ぎています。iPhone でもう一度数字を出してください");
  markLoginToRecord();
}

// ---------- もしものときの復旧コード（iPhone をなくした・壊れたとき：D-139） ----------

/** 復旧コードを8個作る。前のコードはすべて使えなくなる。作ったコードは、このときにしか見られない */
export async function createRecoveryCodes(): Promise<string[]> {
  const { data, error } = await supabase.rpc("create_recovery_codes");
  if (error || !Array.isArray(data)) throw new AuthError(error?.message || "復旧コードを作れませんでした");
  return data as string[];
}

/** 使っていない復旧コードの数（作っていなければ0） */
export async function recoveryCodesLeft(): Promise<number> {
  const { data, error } = await supabase.rpc("recovery_codes_left");
  return !error && typeof data === "number" ? data : 0;
}

/** パスワードで入った端末で、復旧コードを1つ使う。通ると、この端末はオーナーとして使える */
export async function redeemRecoveryCode(code: string) {
  const { data, error } = await supabase.rpc("use_recovery_code", { p_code: code });
  if (error) throw new AuthError(error.message || "確かめられませんでした");
  if (data !== true) throw new AuthError("復旧コードが違うか、もう使ったコードです");
  markLoginToRecord();
}

/** 今のログインが、iPhone の6桁で確かめ済みか */
async function sessionVerified(): Promise<boolean> {
  const { data, error } = await supabase.rpc("session_verified");
  return !error && data === true;
}

/** しばらく使わなかったのでログアウトする。ログイン画面で理由を知らせる（D-133） */
async function idleLogout() {
  markIdleLogout();
  clearLastActive();
  await supabase.auth.signOut();
}

// ---------- パスキー（Face ID・指紋）でログインする（D-085） ----------

/** この端末・このブラウザでパスキーが使えるか */
export function canUsePasskey(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";
}

/** パスキーでログインする。メールもパスワードも要らない */
export async function signInWithPasskey() {
  const { error } = await supabase.auth.signInWithPasskey();
  if (error) {
    // 本人が途中でやめた場合はエラーを出さない
    if (/NotAllowed|abort|cancel/i.test(error.message)) return false;
    throw new AuthError("パスキーでログインできませんでした。パスワードでログインして、登録し直してください");
  }
  markLoginToRecord();
  return true;
}

/**
 * 今ログインしている人に、この端末のパスキーを登録する。
 * すでに登録済みの端末では、ブラウザが「同じものは作れない」と断る。これは成功扱いにする（D-088）。
 */
export async function registerPasskey() {
  // オーナーの2つ目からの端末は、本人確認を済ませたこのログインで許可を取ってからでないと、
  // データベースが登録を断る（D-144）。社員・最初の1個は許可がなくても登録できるので、結果は見ない
  await supabase.rpc("allow_passkey_registration");
  const { error } = await supabase.auth.registerPasskey();
  if (!error) return true;
  // ブラウザ・サーバーのどちらも「もう登録済み」を別の言い方で返すので、まとめて成功扱いにする
  if (/already|previously registered|InvalidState|exist/i.test(error.message)) return true;
  if (/NotAllowed|abort|cancel/i.test(error.message)) return false;
  // データベースの見張り（D-144）に断られたとき
  if (/iPhone の6桁|42501|permission|Database error/i.test(error.message)) {
    throw new AuthError("この端末は登録できませんでした。オーナーの新しい端末は、顔・指紋で入っている端末か、iPhone の6桁・復旧コードで入ったあとに登録してください");
  }
  throw new AuthError(`パスキーを登録できませんでした（${error.message}）`);
}

/** 登録済みのパスキーの数 */
export async function countPasskeys(): Promise<number> {
  const { data, error } = await supabase.auth.passkey.list();
  if (error || !data) return 0;
  // 版によって、配列そのものか { passkeys: [...] } で返ってくる
  if (Array.isArray(data)) return data.length;
  const list = (data as { passkeys?: unknown[] }).passkeys;
  return Array.isArray(list) ? list.length : 0;
}

