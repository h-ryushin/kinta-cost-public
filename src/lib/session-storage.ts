/**
 * ログインの記録（Supabase のセッション）の置き場所（D-136）。
 *
 * ブラウザ全体（localStorage）ではなく、**そのタブだけ（sessionStorage）**に置く。
 * タブやアプリを閉じたり、リンクを新しいタブで開き直したりすると、ログイン画面から始まる。
 * 同じタブの中で画面を移ったり、読み込み直したりするあいだは、ログインしたまま。
 * 保存できない端末（Safari のプライベートモードなど）では、今の画面のあいだだけ覚えておく。
 */
const memory = new Map<string, string>();

export const tabSessionStorage = {
  getItem(key: string): string | null {
    try {
      return window.sessionStorage.getItem(key) ?? memory.get(key) ?? null;
    } catch {
      return memory.get(key) ?? null;
    }
  },
  setItem(key: string, value: string) {
    memory.set(key, value);
    try {
      window.sessionStorage.setItem(key, value);
    } catch {
      // memory で覚えておく
    }
  },
  removeItem(key: string) {
    memory.delete(key);
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // 何もしない
    }
  },
};

/**
 * 前の版はログインを localStorage に置いていた。残っていると、閉じても入れてしまう記録が端末に残り続けるので消す。
 * Supabase のセッションの名前は `sb-<プロジェクト>-auth-token`。
 */
export function removeOldSessions() {
  try {
    const keys = Array.from({ length: window.localStorage.length }, (_, i) => window.localStorage.key(i));
    for (const key of keys) {
      if (key && /^sb-.+-auth-token(-code-verifier)?$/.test(key)) window.localStorage.removeItem(key);
    }
  } catch {
    // 読めない端末では何もしない
  }
}
