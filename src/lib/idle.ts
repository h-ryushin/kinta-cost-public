/**
 * しばらく使わなかったら、次に開いたときにログインし直してもらう（D-133・要件定義書 4.1「一定時間でログアウト」）。
 * アプリを閉じてもログインしたままだと、置きっぱなしのスマホや PC から誰でも入れてしまうため。
 * 厨房で何度も打たなくて済むよう、時間は長めにする。顔・指紋で入れば、ログインし直しは一瞬で済む。
 */
export const IDLE_LIMIT_MS = 2 * 60 * 60 * 1000;

const KEY = "kinta.last-active";
const NOTICE_KEY = "kinta.idle-logout";

/** 最後に使ってから limit を超えたか。記録がない（はじめて・保存できない端末）ときは超えていない扱い */
export function isIdleExpired(lastActive: number | null, now: number, limit: number = IDLE_LIMIT_MS): boolean {
  return lastActive !== null && Number.isFinite(lastActive) && now - lastActive > limit;
}

export function readLastActive(): number | null {
  try {
    const saved = window.localStorage.getItem(KEY);
    return saved === null ? null : Number(saved);
  } catch {
    return null;
  }
}

/** 使った印を残す。何度も書かないよう、前の印から1分たっていなければ書かない */
export function touchLastActive(now: number = Date.now()) {
  try {
    const last = readLastActive();
    if (last !== null && now - last < 60_000) return;
    window.localStorage.setItem(KEY, String(now));
  } catch {
    // 保存できない端末では測らない（ログインは続ける）
  }
}

/** ログアウトしたら、次のログインのために印を消す */
export function clearLastActive() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // 何もしない
  }
}

/** 「しばらく使わなかったので、ログアウトしました」をログイン画面で1回だけ出すための印 */
export function markIdleLogout() {
  try {
    sessionStorage.setItem(NOTICE_KEY, "1");
  } catch {
    // 出せなくてもログアウトはする
  }
}

export function takeIdleLogoutNotice(): boolean {
  try {
    const marked = sessionStorage.getItem(NOTICE_KEY) === "1";
    sessionStorage.removeItem(NOTICE_KEY);
    return marked;
  } catch {
    return false;
  }
}

// ---------- ページを離れたら（D-136） ----------
// 同じタブでほかのサイトへ移って戻ってきたときも、ログインし直してもらう。
// 読み込み直し（数秒で戻る）ではログアウトしないよう、離れてから1分を超えたときだけにする。
export const LEFT_LIMIT_MS = 60 * 1000;
const LEFT_KEY = "kinta.left-at";

/** ページを離れた印（pagehide のときに呼ぶ） */
export function markLeftPage(now: number = Date.now()) {
  try {
    sessionStorage.setItem(LEFT_KEY, String(now));
  } catch {
    // 保存できない端末では測らない
  }
}

/** 離れてから戻ってくるまでの時間が、limit を超えたか。読んだら印は消す */
export function takeLeftTooLong(now: number = Date.now(), limit: number = LEFT_LIMIT_MS): boolean {
  try {
    const saved = sessionStorage.getItem(LEFT_KEY);
    sessionStorage.removeItem(LEFT_KEY);
    return isIdleExpired(saved === null ? null : Number(saved), now, limit);
  } catch {
    return false;
  }
}
