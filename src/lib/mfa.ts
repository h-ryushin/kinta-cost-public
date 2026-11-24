/**
 * 管理者（オーナー）の本人確認の判定（D-085・D-086、要件定義書 4.1）。
 *
 * 認証アプリ（6桁）は使わず、**パスキー（Face ID・指紋）**で本人確認する。
 * 顔・指紋が使えない PC などでは、**オーナーの iPhone に出した6桁**で確かめる（D-138）。
 *
 * 画面に依存しない判定なので、ここに分けてテストする。
 */
export type MfaStep = "enroll" | "done";

/**
 * 次にしてもらうこと。
 * @param role ログインしている人の役割
 * @param strongSignIn パスキーで入ったか、iPhone の6桁で確かめ済みか（D-138）
 * @param tolerate デモのあいだだけ、登録なしを許すか（D-070）
 */
export function nextMfaStep(
  role: "admin" | "staff",
  strongSignIn: boolean,
  tolerate = false,
): MfaStep {
  // 社員は任意。管理者だけ、パスキーか iPhone の6桁での本人確認を求める
  if (role !== "admin") return "done";
  if (strongSignIn) return "done";
  return tolerate ? "done" : "enroll";
}

/**
 * ログインに使った方法（Supabase の amr）から、強い本人確認が済んでいるかを決める（D-135）。
 * データベースの `private.current_app_role()` と同じ決まりにする（パスキーなら通す。メールの6桁は D-138 でやめた）。
 * iPhone の6桁で確かめ済みのログイン（D-138）は amr では分からないので、`sessionVerified()` で別に確かめる。
 */
export function strongSignIn(methods: (string | { method: string })[]): boolean {
  return methods.some((m) => ["webauthn", "passkey"].includes(typeof m === "string" ? m : m.method));
}
