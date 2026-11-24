"use client";

import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Card, useConfirm } from "@/components/ui";
import { AuthError, createRecoveryCodes, recoveryCodesLeft } from "@/lib/auth";

/**
 * もしものときの復旧コード（D-139）。オーナーの iPhone をなくした・壊れたときに、ほかの端末で入るための控え。
 * 作ったコードはこの画面にしか出ないので、紙かパスワード管理アプリに控えてもらう。
 */
export function RecoveryCodesCard() {
  const { confirm, confirmDialog } = useConfirm();
  const [left, setLeft] = useState<number | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    recoveryCodesLeft().then(setLeft, () => setLeft(0));
  }, []);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const made = await createRecoveryCodes();
      setCodes(made);
      setLeft(made.length);
    } catch (e) {
      setError(e instanceof AuthError ? e.message : "復旧コードを作れませんでした");
    } finally {
      setBusy(false);
    }
  }

  function ask() {
    // 作り直すと、前に控えたコードは使えなくなる。うっかり押さないよう確かめる
    if (!left) {
      void create();
      return;
    }
    confirm({
      title: "復旧コードを作り直しますか？",
      message: "前に控えた復旧コードは、すべて使えなくなります。新しいコードを控え直してください。",
      confirmLabel: "作り直す",
      variant: "danger",
      onConfirm: () => void create(),
    });
  }

  return (
    <Card>
      <p className="flex items-center gap-2 font-bold">
        <KeyRound className="size-5 text-accent" aria-hidden />
        もしものときの復旧コード
      </p>
      <p className="mt-1 text-sm text-muted">
        iPhone をなくした・壊れたときに、パスワードと一緒に使って入るためのコードです。
        {left !== null && (left > 0 ? `今は ${left}個 使えます。` : "まだ作っていません。")}
      </p>
      {codes && (
        <div className="mt-3 rounded-lg border border-border-strong bg-surface-muted p-3">
          <p className="mb-2 text-sm font-bold">この画面にしか出ません。紙かパスワード管理アプリに控えてください。</p>
          <ul className="num grid grid-cols-2 gap-x-4 gap-y-1 text-lg font-bold tracking-widest">
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      <Button variant="secondary" onClick={ask} disabled={busy || left === null} className="mt-3 min-h-12 w-full">
        <KeyRound aria-hidden />
        {busy ? "作っています…" : left ? "作り直す" : "復旧コードを作る"}
      </Button>
      {error && <p className="mt-2 text-sm font-bold text-danger">{error}</p>}
      {confirmDialog}
    </Card>
  );
}
