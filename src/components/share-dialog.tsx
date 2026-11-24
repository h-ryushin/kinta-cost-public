"use client";

import { Check, ClipboardCopy } from "lucide-react";
import { useState } from "react";
import { Button, Dialog } from "@/components/ui";

/**
 * LINE などに貼る文を見せて、コピーできるようにする（D-059）。
 * クリップボードは HTTPS か localhost でしか使えない（LAN の IP で開くと使えない：D-015 と同じ理由）ので、
 * コピーできないときは文をそのまま見せて、長押しで選べるようにする。
 */
export function ShareTextDialog({
  open,
  title,
  text,
  onClose,
}: {
  open: boolean;
  title: string;
  text: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  function close() {
    setCopied(false);
    setFailed(false);
    onClose();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  return (
    <Dialog open={open} title={title} onClose={close}>
      <p className="mt-2 text-sm text-muted">コピーして、LINE に貼って送れます。</p>
      <textarea
        readOnly
        value={text}
        rows={12}
        aria-label="送る文"
        onFocus={(e) => e.currentTarget.select()}
        className="num mt-3 w-full rounded-lg border border-border-strong bg-surface-muted p-3 text-sm outline-none focus:border-accent"
      />
      {failed && (
        <p role="alert" className="mt-2 text-sm font-bold text-danger">
          コピーできませんでした。上の文を長押しして選んでコピーしてください。
        </p>
      )}
      <div className="mt-4 flex gap-3">
        <Button variant="secondary" onClick={close} className="min-h-12 flex-1 sm:flex-none">
          閉じる
        </Button>
        <Button onClick={copy} className="min-h-12 flex-1 sm:ml-auto sm:flex-none">
          {copied ? <Check aria-hidden /> : <ClipboardCopy aria-hidden />}
          {copied ? "コピーしました" : "コピーする"}
        </Button>
      </div>
    </Dialog>
  );
}
