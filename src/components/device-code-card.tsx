"use client";

import { MonitorSmartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Card } from "@/components/ui";
import { AuthError, createDeviceCode } from "@/lib/auth";

/** 数字が使える時間。データベースと同じ（D-138） */
const CODE_LIFETIME_SECONDS = 5 * 60;

/**
 * このアカウントで入っている iPhone（顔・指紋）で、同じアカウントのほかの端末（PC など）に入るための6桁を出す（D-138）。
 * PC ではパスワードのあと、この数字を打ち込む。5分で使えなくなり、1回使ったら終わり。
 */
export function DeviceCodeCard() {
  const [code, setCode] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    const timer = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [code]);

  async function issue() {
    setBusy(true);
    setError(null);
    try {
      setCode(await createDeviceCode());
      setLeft(CODE_LIFETIME_SECONDS);
    } catch (e) {
      setError(e instanceof AuthError ? e.message : "数字を出せませんでした");
    } finally {
      setBusy(false);
    }
  }

  const expired = code !== null && left === 0;
  return (
    <Card>
      <p className="flex items-center gap-2 font-bold">
        <MonitorSmartphone className="size-5 text-accent" aria-hidden />
        ほかの端末で入る数字を出す
      </p>
      <p className="mt-1 text-sm text-muted">
        PC など顔・指紋が使えない端末で、このアカウントに入るときに使います。PC でこのアカウントのメールとパスワードを入れたあと、ここに出た6桁を打ち込みます。
      </p>
      {code && !expired && (
        <div className="mt-3 text-center">
          <p className="num text-4xl font-bold tracking-[0.3em]">{code}</p>
          <p className="num mt-1 text-sm text-muted">
            あと {Math.floor(left / 60)}分{String(left % 60).padStart(2, "0")}秒 使えます
          </p>
        </div>
      )}
      {expired && <p className="mt-3 text-sm font-bold text-muted">5分を過ぎたので、この数字はもう使えません。</p>}
      <Button variant="secondary" onClick={() => void issue()} disabled={busy} className="mt-3 min-h-12 w-full">
        <MonitorSmartphone aria-hidden />
        {busy ? "出しています…" : code ? "新しい数字を出す" : "数字を出す"}
      </Button>
      {error && <p className="mt-2 text-sm font-bold text-danger">{error}</p>}
    </Card>
  );
}
