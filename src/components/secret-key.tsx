"use client";

import { Copy, KeyRound, LockKeyhole, LockKeyholeOpen, RotateCw, ScanFace, Smartphone } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Card, ErrorMessage, inputClass, useConfirm } from "@/components/ui";
import {
  addThisDevice,
  countKeyDevices,
  RecipeKeyError,
  refreshRecipeKeyStatus,
  renewRecoveryKey,
  setupRecipeKey,
  unlockWithPasskey,
  unlockWithRecovery,
  useRecipeKeyStatus,
} from "@/lib/recipe-key";
import { SecretCostNote, SecretLockCard } from "@/components/secret";
import { formatRecoveryInput } from "@/lib/crypto";
import { isSecretCostStale, staleSecrets } from "@/lib/secret-cost";
import { lockSecrets, StoreError, useStore } from "@/lib/store";
import { useEffectiveRole } from "@/lib/role";
import { showToast } from "@/lib/toast";

/**
 * 秘密レシピの鍵を開ける・作る画面の部品（D-148）。
 * 鍵は顔・指紋（パスキーの PRF）か、紙に控えた予備の鍵で開く。開いた鍵はこの画面のあいだだけ持つ。
 */

// 鍵を開けたあとの保存（暗号化し直し・原価の書き直し）の失敗は StoreError で来る
const message = (e: unknown, fallback: string) =>
  e instanceof RecipeKeyError || e instanceof StoreError ? e.message : fallback;

/**
 * 鍵を開けられなかった・中身を読めなかったときの知らせ。
 * 通信が途中で切れたときなどは、読み込み直すと直ることが多いので、その場で押せるボタンを添える（D-168）。
 * ログインはそのタブに残っている（D-136）ので、読み込み直してもログインし直しにはならない。
 */
function SecretError({ message: text }: { message: string | null }) {
  if (!text) return null;
  return (
    <div className="flex flex-col gap-2">
      <ErrorMessage message={text} />
      <Button variant="secondary" className="min-h-12 w-full" onClick={() => window.location.reload()}>
        <RotateCw aria-hidden />
        読み込み直す
      </Button>
      <p className="text-xs text-muted">読み込み直したら、もう一度開いてください。ログインはそのままです。</p>
    </div>
  );
}

/** 顔・指紋と予備の鍵で開ける。開けたら store が中身を読み直す */
function UnlockControls({ onError }: { onError: (text: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [code, setCode] = useState("");

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    onError(null);
    try {
      await action();
    } catch (e) {
      onError(message(e, "鍵を開けられませんでした"));
      // この端末がまだ登録されていないときは、予備の鍵の欄を開いておく
      if (e instanceof RecipeKeyError && e.message.includes("予備の鍵")) setShowRecovery(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Button onClick={() => void run(unlockWithPasskey)} disabled={busy} className="min-h-12 w-full">
        <ScanFace aria-hidden />
        {busy ? "開いています…" : "顔・指紋で開く"}
      </Button>
      {showRecovery ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => unlockWithRecovery(code));
          }}
          className="flex flex-col gap-2"
        >
          <label className="text-sm font-bold" htmlFor="recipe-recovery">
            予備の鍵（控えた12文字。「-」は自動で入ります）
          </label>
          <input
            id="recipe-recovery"
            value={code}
            onChange={(e) => setCode(formatRecoveryInput(e.target.value))}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="ABCD-EFGH-JKMN"
            className={`${inputClass} num tracking-wider`}
          />
          <Button type="submit" variant="secondary" disabled={busy || code.trim() === ""} className="min-h-12 w-full">
            <KeyRound aria-hidden />
            予備の鍵で開く
          </Button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowRecovery(true)}
          className="min-h-11 self-start text-sm font-bold text-accent hover:underline"
        >
          予備の鍵で開く
        </button>
      )}
    </div>
  );
}

/**
 * 材料・仕込み品を削除する前に、秘密レシピの鍵を開けてもらう欄（D-174）。
 * 鍵がかかった秘密の中身で使っていないかを確かめられないと削除できない（D-148）ので、
 * オーナーには、その場で顔・指紋（か予備の鍵）で開けられるようにする。開けると中身が読めて、削除できるようになる。
 * 顔・指紋はボタンを押した操作の中でしか聞けないので、削除を押したあとに、この欄のボタンをもう一度押してもらう。
 */
export function UnlockBeforeDelete({ what, onClose }: { what: string; onClose: () => void }) {
  const status = useRecipeKeyStatus();
  const [error, setError] = useState<string | null>(null);
  if (status === "unlocked") {
    return (
      <Card className="flex flex-col gap-2 border-ok bg-ok-soft">
        <p className="flex items-center gap-2 font-bold">
          <LockKeyholeOpen className="size-4.5" aria-hidden />
          秘密レシピの鍵を開けました
        </p>
        <p className="text-sm">もう一度「削除」を押すと、{what}を削除できます。</p>
      </Card>
    );
  }
  return (
    <Card className="flex flex-col gap-3 border-warn bg-warn-soft">
      <div>
        <p className="flex items-center gap-2 font-bold">
          <LockKeyhole className="size-4.5" aria-hidden />
          削除する前に、秘密レシピの鍵を開けてください
        </p>
        <p className="mt-1 text-sm">
          秘密のものの中で{what}を使っていないかを確かめるためです。開けたら、もう一度「削除」を押してください。
        </p>
      </div>
      <UnlockControls onError={setError} />
      <SecretError message={error} />
      <button type="button" onClick={onClose} className="min-h-11 self-start text-sm font-bold text-muted hover:text-foreground">
        やめる
      </button>
    </Card>
  );
}

/** オーナーが秘密のものを開いたとき、中身の代わりに出す（鍵がかかっているとき） */
export function SecretUnlockCard({ what, costAt, stale = false }: { what: string; costAt?: string | null; stale?: boolean }) {
  const status = useRecipeKeyStatus();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (status === "unknown") void refreshRecipeKeyStatus();
  }, [status]);

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <LockKeyhole className="size-5" aria-hidden />
        </span>
        <div>
          <p className="font-bold">{what}には鍵がかかっています</p>
          <p className="mt-1 text-sm text-muted">配合は暗号化してあり、オーナーの顔・指紋か予備の鍵でだけ開けます。</p>
          <SecretCostNote costAt={costAt} stale={stale} />
        </div>
      </div>
      <UnlockControls onError={setError} />
      <SecretError message={error} />
    </Card>
  );
}

/**
 * 編集画面で「オーナーだけ」を選んだときに出す。保存は暗号化して行うので、鍵が開いている必要がある。
 * 鍵がまだないときは「ログインと安全」で作ってもらう。
 */
export function SecretKeyNotice() {
  const status = useRecipeKeyStatus();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (status === "unknown") void refreshRecipeKeyStatus();
  }, [status]);

  if (status === "unlocked") {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <LockKeyholeOpen className="size-4 shrink-0 text-ok" aria-hidden />
        鍵が開いています。中身（材料・使用量・メモ）は暗号化して保存します。
      </p>
    );
  }
  if (status === "none") {
    return (
      <p className="text-sm font-bold">
        秘密にするには、先に「秘密レシピの鍵」を作ってください（
        <Link href="/security" className="text-accent underline">
          その他 → ログインと安全
        </Link>
        ）。
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-bold">保存するには、秘密レシピの鍵を開けてください。</p>
      <UnlockControls onError={setError} />
      <SecretError message={error} />
    </div>
  );
}

/** まだ暗号化していない秘密のもの（D-094 のころのもの）を開いたときに出す。鍵を開けると暗号化する */
export function PlainSecretNotice() {
  const status = useRecipeKeyStatus();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (status === "unknown") void refreshRecipeKeyStatus();
  }, [status]);
  if (status === "unlocked") return null;
  return (
    <Card className="flex flex-col gap-3 border-warn bg-warn-soft">
      <p className="font-bold">この中身は、まだ暗号化されていません</p>
      {status === "none" ? (
        <p className="text-sm">
          「
          <Link href="/security" className="text-accent underline">
            その他 → ログインと安全
          </Link>
          」で秘密レシピの鍵を作ると、暗号化します。
        </p>
      ) : (
        <>
          <p className="text-sm">鍵を開けると、その場で暗号化して保存し直します。</p>
          <UnlockControls onError={setError} />
        </>
      )}
      <SecretError message={error} />
    </Card>
  );
}

/** 予備の鍵を打ち写さずに控えられるよう、コピーできるようにする（D-152） */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  return (
    <div className="mt-2 flex flex-col items-center gap-1">
      <Button
        variant="secondary"
        className="min-h-12"
        onClick={() =>
          navigator.clipboard?.writeText(text).then(
            () => setCopied(true),
            () => setCopied(false),
          ) ?? setCopied(false)
        }
      >
        <Copy aria-hidden />
        {copied ? "コピーしました" : "コピーする"}
      </Button>
      {copied === false && <p className="text-xs text-muted">コピーできませんでした。上の文字を長押しして選んでください。</p>}
    </div>
  );
}

/** 鍵の欄の上に並べる、今の状態の1行 */
function StatusRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-2 last:border-b-0">
      <dt className="shrink-0 text-sm text-muted">{label}</dt>
      <dd className="text-right text-sm font-bold">{children}</dd>
    </div>
  );
}

/** 鍵の欄の下に並べる操作。鍵が閉じていても、何ができるかが見えるように常に出す */
function KeyAction({
  icon,
  label,
  description,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-3">
      <Button variant="secondary" disabled={disabled} className="min-h-12 w-full" onClick={onClick}>
        {icon}
        {label}
      </Button>
      <p className="text-xs text-muted">{description}</p>
    </div>
  );
}

/**
 * 「ログインと安全」に置く、秘密レシピの鍵の欄（オーナーだけ）。
 * 鍵が閉じているあいだは操作が隠れていて分かりにくかったので、状態とできることを常に出す（D-166）。
 */
export function RecipeKeyCard() {
  const status = useRecipeKeyStatus();
  const store = useStore();
  const { confirm, confirmDialog } = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<string | null>(null);
  const [devices, setDevices] = useState<number | null>(null);

  useEffect(() => {
    if (status === "unknown") void refreshRecipeKeyStatus();
    if (status === "locked" || status === "unlocked") countKeyDevices().then(setDevices, () => setDevices(null));
  }, [status]);

  const secrets = store.loaded ? [...store.data.recipes, ...store.data.preps].filter((item) => item.secret) : [];
  const stale = store.loaded ? staleSecrets(secrets, store.data.priceHistory) : [];
  const isOpen = status === "unlocked";

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(message(e, "うまくいきませんでした"));
    } finally {
      setBusy(false);
    }
  }

  function create() {
    confirm({
      title: "秘密レシピの鍵を作りますか？",
      message:
        "このあと顔・指紋を確かめ、控えておく「予備の鍵」（12文字）を1回だけ出します。予備の鍵は、顔・指紋が使えないときや新しい端末で開くときに要ります。なくすと、だれも秘密レシピを開けなくなります。",
      confirmLabel: "作る",
      onConfirm: () =>
        void run(async () => {
          const code = await setupRecipeKey();
          if (code) setRecovery(code);
        }),
    });
  }

  function renew() {
    confirm({
      title: "予備の鍵を作り直しますか？",
      message: `新しい予備の鍵（12文字）を1回だけ出します。前に控えた予備の鍵は使えなくなります。秘密レシピの中身と、顔・指紋で開ける端末はそのままです。${
        isOpen ? "" : "先に顔・指紋で鍵を開けます。"
      }`,
      confirmLabel: "作り直す",
      onConfirm: () =>
        void run(async () => {
          // 閉じていても押せるようにし、その場で顔・指紋で開けてから作り直す
          if (!isOpen) await unlockWithPasskey();
          setRecovery(await renewRecoveryKey());
        }),
    });
  }

  if (recovery) {
    return (
      <Card>
        <p className="flex items-center gap-2 font-bold">
          <KeyRound className="size-5 text-accent" aria-hidden />
          予備の鍵を控えてください
        </p>
        <p className="mt-1 text-sm">この画面にしか出ません。コピーして iPhone のメモかパスワードのアプリに貼るか、紙に書いて保管してください。</p>
        <p className="num mt-3 text-center text-2xl font-bold tracking-wider whitespace-nowrap">{recovery}</p>
        <CopyButton text={recovery} />
        <p className="mt-2 text-xs text-muted">ログインの「復旧コード」とは別のものです。なくすと、顔・指紋が使えないときに秘密レシピを開けません。</p>
        <Button variant="secondary" onClick={() => setRecovery(null)} className="mt-3 min-h-12 w-full">
          控えました
        </Button>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3">
      <div>
        <p className="flex items-center gap-2 font-bold">
          <LockKeyhole className="size-5 text-accent" aria-hidden />
          秘密レシピの鍵
        </p>
        <p className="mt-1 text-sm text-muted">
          塩だれなど秘密の配合は、この鍵で暗号化しています。開けられるのはオーナーの顔・指紋と、控えた予備の鍵だけです。
        </p>
      </div>

      {status === "none" ? (
        <Button onClick={create} disabled={busy} className="min-h-12 w-full">
          <KeyRound aria-hidden />
          {busy ? "作っています…" : "鍵を作る"}
        </Button>
      ) : (
        <>
          <dl className="rounded-lg bg-surface-muted px-3">
            <StatusRow label="鍵">
              {isOpen ? (
                <span className="inline-flex items-center gap-1 text-ok">
                  <LockKeyholeOpen className="size-4" aria-hidden />
                  開いています
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <LockKeyhole className="size-4" aria-hidden />
                  閉じています
                </span>
              )}
            </StatusRow>
            <StatusRow label="秘密のもの">
              <span className="num">{secrets.length}品</span>
            </StatusRow>
            <StatusRow label="原価">
              {stale.length > 0 ? (
                <span className="text-warn">
                  <span className="num">{stale.length}品</span>が古くなっています
                </span>
              ) : (
                "すべて新しい金額です"
              )}
            </StatusRow>
            <StatusRow label="顔・指紋で開ける端末">
              <span className="num">{devices === null ? "—" : `${devices}台`}</span>
            </StatusRow>
          </dl>

          {isOpen ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-sm">配合を見る・直すことができます。この画面を閉じると、鍵も閉じます。</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(lockSecrets)}
                className="min-h-11 self-start text-sm font-bold text-accent hover:underline"
              >
                今すぐ鍵を閉じる
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-sm">
                {stale.length > 0 ? "開くと、配合が見られるようになり、古い原価も新しくなります。" : "開くと、配合を見る・直すことができます。"}
              </p>
              <UnlockControls onError={setError} />
            </div>
          )}
          {/* 押したボタンのすぐ下に出す（欄の下だと、スマホでは見えないことがある） */}
          <SecretError message={error} />

          <KeyAction
            icon={<KeyRound aria-hidden />}
            label="予備の鍵を作り直す"
            description="予備の鍵をなくしたとき・短く（12文字に）したいときに。前の予備の鍵は使えなくなります。"
            disabled={busy}
            onClick={renew}
          />
          <KeyAction
            icon={<Smartphone aria-hidden />}
            label="この端末でも開けるようにする"
            description={
              isOpen
                ? "新しい iPhone・iPad で、次からこの端末の顔・指紋で開けるようにします。"
                : "新しい iPhone・iPad で、次からこの端末の顔・指紋で開けるようにします。先に上の「予備の鍵で開く」で開けると押せます。"
            }
            disabled={busy || !isOpen}
            onClick={() =>
              void run(async () => {
                if (await addThisDevice()) {
                  showToast("この端末の顔・指紋でも、秘密レシピを開けるようにしました");
                  setDevices(await countKeyDevices());
                }
              })
            }
          />
        </>
      )}

      {status === "none" && <SecretError message={error} />}
      {confirmDialog}
    </Card>
  );
}

/**
 * オーナーがアプリに入ったとき、秘密のものの原価が古くなっていたら、上に出す（D-154）。
 * 顔・指紋を1回通せば、その場で計算し直す（D-148 の afterRecipeKeyUnlock）。古くなければ何も出さない。
 * ブラウザは、押す操作なしに顔・指紋を聞けないので、ボタンを押してもらう。
 */
export function SecretCostRefreshBanner() {
  const store = useStore();
  const isAdmin = useEffectiveRole() === "admin";
  const status = useRecipeKeyStatus();
  const [error, setError] = useState<string | null>(null);
  const [later, setLater] = useState(false);
  if (!store.loaded || !isAdmin || status === "unlocked" || later) return null;
  const stale = staleSecrets([...store.data.recipes, ...store.data.preps], store.data.priceHistory);
  if (stale.length === 0) return null;
  return (
    <Card className="mb-5 flex flex-col gap-3 border-warn bg-warn-soft">
      <div>
        <p className="font-bold">秘密のもの {stale.length}品の原価が古くなっています</p>
        <p className="mt-1 text-sm">
          材料の値段が変わりました（{stale.slice(0, 3).map((s) => s.name).join("、")}
          {stale.length > 3 ? " ほか" : ""}）。顔・指紋で開くと、原価を新しくします。社員にも新しい金額が見えるようになります。
        </p>
      </div>
      <UnlockControls onError={setError} />
      <SecretError message={error} />
      <button type="button" onClick={() => setLater(true)} className="min-h-11 self-start text-sm font-bold text-muted hover:text-foreground">
        あとで
      </button>
    </Card>
  );
}

/**
 * 秘密のものの中身の代わりに出す欄（D-060・D-148・D-154）。
 * 社員には「オーナーだけが見られます」、オーナーには鍵を開ける欄を出す。どちらにも原価がいつの金額かを添える。
 */
export function SecretContentsCard({
  what,
  item,
  priceHistory,
  canUnlock,
}: {
  what: string;
  item: { secret: boolean; sealed?: boolean; secretCostAt?: string | null };
  priceHistory: { changedAt: string }[];
  canUnlock: boolean;
}) {
  const stale = isSecretCostStale(item, priceHistory);
  return canUnlock ? (
    <SecretUnlockCard what={what} costAt={item.secretCostAt} stale={stale} />
  ) : (
    <SecretLockCard what={what} costAt={item.secretCostAt} stale={stale} />
  );
}
