"use client";

import { ScanFace } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Card } from "@/components/ui";
import { AuthError, canUsePasskey, countPasskeys, registerPasskey } from "@/lib/auth";
import { showToast } from "@/lib/toast";

/**
 * この端末で顔・指紋（パスキー）を使えるようにする（D-134）。
 * 社員も登録できる。登録すると、ログインし直すとき（しばらく使わなかったあと：D-133）にパスワードを打たずに済む。
 * オーナーは顔・指紋で入っているときだけここに来るので、登録済みの端末から新しい端末を足す形になる。
 */
export function PasskeyCard() {
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = canUsePasskey();

  useEffect(() => {
    if (supported) countPasskeys().then(setCount, () => setCount(0));
  }, [supported]);

  if (!supported) return null;

  async function register() {
    setBusy(true);
    setError(null);
    try {
      if (await registerPasskey()) {
        showToast("顔・指紋を登録しました。次からは「顔・指紋でログイン」で入れます");
        setCount(await countPasskeys());
      }
    } catch (e) {
      setError(e instanceof AuthError ? e.message : "登録できませんでした");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <p className="flex items-center gap-2 font-bold">
        <ScanFace className="size-5 text-accent" aria-hidden />
        顔・指紋でログイン
      </p>
      <p className="mt-1 text-sm text-muted">
        {count !== null && count > 0
          ? "登録済みです。ほかの端末でも使うときは、その端末で開いてここを押してください。"
          : "登録すると、次からパスワードを打たずに顔か指紋だけで入れます。"}
      </p>
      <Button variant="secondary" onClick={() => void register()} disabled={busy || count === null} className="mt-3 min-h-12">
        <ScanFace aria-hidden />
        {busy ? "登録しています…" : "この端末で使えるようにする"}
      </Button>
      {error && <p className="mt-2 text-sm font-bold text-danger">{error}</p>}
    </Card>
  );
}
