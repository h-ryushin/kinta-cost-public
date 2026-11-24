/**
 * 招待メールのリンクから来たことを覚えておく（D-115）。
 *
 * リンクの URL には「#…&type=invite」が付いているが、supabase-js はログインの処理の途中で
 * この部分を消してしまう。消えたあとに見ても分からないので、接続を作る前（supabase.ts）に読んで、
 * パスワードを決め終わるまで sessionStorage に残す（途中で画面を開き直しても、パスワードの画面に戻れる）。
 */
const KEY = "kinta.invite";

/** recovery：パスワードを忘れたときのメールのリンク（D-153） */
export type InviteLinkState = "invite" | "recovery" | "expired" | null;

/** URL の # 以降から、招待か、パスワードの決め直しか、期限切れのリンクかを読む */
export function parseInviteHash(hash: string): InviteLinkState {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const type = params.get("type");
  if (type === "invite") return "invite";
  if (type === "recovery") return "recovery";
  if (params.get("error_code") === "otp_expired") return "expired";
  return null;
}

let memory: InviteLinkState = null;

function write(state: InviteLinkState) {
  memory = state;
  try {
    if (state) sessionStorage.setItem(KEY, state);
    else sessionStorage.removeItem(KEY);
  } catch {
    // 保存できない端末でも、この画面を開いているあいだは memory で覚えておく
  }
}

function read(): InviteLinkState {
  try {
    const saved = sessionStorage.getItem(KEY);
    if (saved === "invite" || saved === "recovery" || saved === "expired") return saved;
  } catch {
    // 読めなければ memory を使う
  }
  return memory;
}

/** supabase-js が URL を消す前に呼ぶ（supabase.ts で接続を作る前） */
export function rememberInviteLink() {
  if (typeof window === "undefined") return;
  const state = parseInviteHash(window.location.hash);
  if (state) write(state);
}

/** パスワードを決める画面を出すか（招待・パスワードを忘れたときの両方） */
export function isInvitePending(): boolean {
  if (typeof window === "undefined") return false;
  const state = read();
  return state === "invite" || state === "recovery";
}

/** パスワードを忘れたときのメールから来たか（画面の文を変える：D-153） */
export function isPasswordReset(): boolean {
  return typeof window !== "undefined" && read() === "recovery";
}

/** 期限切れのリンクから来たか。一度知らせたら消す */
export function takeExpiredInvite(): boolean {
  if (typeof window === "undefined" || read() !== "expired") return false;
  write(null);
  return true;
}

/** パスワードを決め終わったら消す */
export function finishInvite() {
  write(null);
}
