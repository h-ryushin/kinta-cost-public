"use client";

import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, Inbox, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ratioTargetOf } from "@/lib/ratio-target";
import { useRatioTargets } from "@/lib/store";
import type { RatioTargets } from "@/lib/types";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white shadow-card hover:bg-accent-hover",
  secondary: "border border-border-strong bg-surface text-foreground shadow-card hover:bg-surface-muted",
  danger: "border border-danger/40 bg-surface text-danger hover:bg-accent-soft",
  ghost: "text-muted hover:bg-surface-muted hover:text-foreground",
};

const BUTTON_BASE =
  "inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 font-bold transition-colors disabled:opacity-50 [&_svg]:size-4.5 [&_svg]:shrink-0";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type="button" className={`${BUTTON_BASE} ${BUTTON_STYLES[variant]} ${className}`} {...props} />;
}

export function LinkButton({
  variant = "primary",
  className = "",
  ...props
}: React.ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return <Link className={`${BUTTON_BASE} ${BUTTON_STYLES[variant]} ${className}`} {...props} />;
}

export function PageHeader({
  title,
  description,
  action,
  back,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** 戻り先。編集画面などで、タイトルの上に「← 一覧へ」を出す */
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-6">
      {back && (
        <Link href={back.href} className="mb-2 inline-flex items-center gap-1 text-sm font-bold text-muted hover:text-foreground">
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">{title}</h1>
          {description && <p className="mt-1 text-muted">{description}</p>}
        </div>
        {action && <div className="flex shrink-0 gap-2">{action}</div>}
      </div>
    </div>
  );
}

export function Card({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5 ${className}`} {...props} />;
}

export function CardTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-base font-bold">{children}</h2>
      {action}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-bold">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-sm text-muted">{hint}</p>}
    </div>
  );
}

export const inputClass =
  "min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 text-base outline-none transition-shadow placeholder:text-subtle focus:border-accent focus:ring-3 focus:ring-accent-soft";

export function ErrorMessage({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-accent-soft px-4 py-3 font-bold text-danger">
      <CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
      {message}
    </p>
  );
}

export function Loading() {
  return <p className="py-16 text-center text-muted">読み込み中…</p>;
}

export function Empty({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-strong bg-surface px-4 py-12 text-center text-muted">
      <Inbox className="size-8 text-subtle" aria-hidden />
      <p>{children}</p>
      {action}
    </div>
  );
}

// ---------- ダイアログ（D-058） ----------

/**
 * 画面の中央に出すダイアログ。ブラウザ標準の confirm・alert は端末ごとに見た目が変わり、
 * 日本語の文も入れにくいので使わない（D-058）。
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      // Esc で閉じたときも、開いているかどうかの状態を合わせる
      onClose={onClose}
      onClick={(e) => {
        // 背景を押したら閉じる
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-auto max-h-[85dvh] w-[min(30rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-border bg-surface p-5 text-foreground shadow-raised backdrop:bg-black/40 backdrop:backdrop-blur-[2px]"
    >
      {open && (
        <>
          <h2 className="text-lg font-bold">{title}</h2>
          {children}
        </>
      )}
    </dialog>
  );
}

export type ConfirmRequest = {
  title: string;
  message?: string;
  /** 実行するボタンの文字（「削除」「登録」など） */
  confirmLabel: string;
  variant?: ButtonVariant;
  onConfirm: () => void;
};

/**
 * 削除や上書きなど、元に戻せない操作の確認。
 * 画面では `const { confirm, confirmDialog } = useConfirm();` を使い、confirmDialog を描く。
 */
export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  // 閉じる前に続けて押されても、1回の確認で1回だけ実行する（D-157）
  const fired = useRef(false);
  const close = () => setRequest(null);

  const confirmDialog = (
    <Dialog open={request !== null} title={request?.title ?? ""} onClose={close}>
      {request?.message && <p className="mt-2 text-muted">{request.message}</p>}
      <div className="mt-5 flex gap-3">
        <Button variant="secondary" onClick={close} className="min-h-12 flex-1 sm:flex-none">
          やめる
        </Button>
        <Button
          variant={request?.variant ?? "primary"}
          onClick={() => {
            if (fired.current) return;
            fired.current = true;
            request?.onConfirm();
            close();
          }}
          className="min-h-12 flex-1 sm:ml-auto sm:flex-none"
        >
          {request?.confirmLabel}
        </Button>
      </div>
    </Dialog>
  );

  const confirm = (next: ConfirmRequest) => {
    fired.current = false;
    setRequest(next);
  };
  return { confirm, confirmDialog };
}

// ---------- 原価率（D-013、D-035、D-102） ----------

type RatioStatus = { label: string; icon: LucideIcon; text: string; fill: string; soft: string };

/**
 * 原価率の状態。目安は分類のまとまりごとに違う（D-102）。
 * 分類を渡さないときは料理（サイド）の目安で見る。色だけに頼らず、必ずアイコンと文字を一緒に出す。
 */
export function ratioStatus(ratio: number, category?: string | null, targets?: RatioTargets): RatioStatus {
  const target = ratioTargetOf(category, targets);
  if (ratio > target.high)
    return { label: "高い", icon: CircleAlert, text: "text-danger", fill: "bg-status-critical", soft: "bg-accent-soft" };
  if (ratio > target.good)
    return { label: "普通", icon: AlertTriangle, text: "text-warn", fill: "bg-status-warning", soft: "bg-warn-soft" };
  return { label: "良好", icon: CheckCircle2, text: "text-ok", fill: "bg-status-good", soft: "bg-ok-soft" };
}

/** 原価率の値と状態（アイコン＋文字） */
export function RatioBadge({
  ratio,
  category,
  size = "md",
}: {
  ratio: number | null;
  /** メニューの分類。目安（ドリンク／肉／サイド）を選ぶのに使う */
  category?: string | null;
  size?: "md" | "lg";
}) {
  // 目安はオーナーが設定で変えられる（D-110）
  const targets = useRatioTargets();
  if (ratio === null) return <span className="text-sm text-muted">売価未設定</span>;
  const s = ratioStatus(ratio, category, targets);
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap font-bold ${s.text} ${size === "lg" ? "text-2xl" : ""}`}>
      <s.icon className={size === "lg" ? "size-6" : "size-4"} aria-hidden />
      <span className="num">{ratio.toFixed(1)}%</span>
      <span className={`rounded px-1.5 py-0.5 text-xs ${s.soft}`}>{s.label}</span>
    </span>
  );
}

/**
 * 原価率のメーター。0〜60% を横幅いっぱいに取り、その分類の目安に線を引く（D-102）。
 * 60% を超えたら端で止める。
 */
export function RatioMeter({
  ratio,
  category,
  className = "",
}: {
  ratio: number | null;
  category?: string | null;
  className?: string;
}) {
  const MAX = 60;
  const width = ratio === null ? 0 : Math.min(ratio, MAX) / MAX;
  const targets = useRatioTargets();
  const s = ratio === null ? null : ratioStatus(ratio, category, targets);
  const target = ratioTargetOf(category, targets);
  return (
    <div
      className={`relative h-2 rounded-full bg-track ${className}`}
      role="img"
      aria-label={ratio === null ? "原価率：売価未設定" : `原価率 ${ratio.toFixed(1)}%（${s?.label}）`}
    >
      {s && <div className={`h-full rounded-full ${s.fill}`} style={{ width: `${width * 100}%` }} />}
      {[target.good, target.high].map((line) => (
        <span
          key={line}
          aria-hidden
          className="absolute -top-0.5 h-3 w-0.5 rounded-full bg-surface"
          style={{ left: `${(line / MAX) * 100}%` }}
        />
      ))}
    </div>
  );
}

/** ダッシュボードの数字のタイル */
export function StatTile({
  label,
  value,
  unit,
  note,
  icon: Icon,
  href,
}: {
  label: string;
  value: string;
  unit?: string;
  note?: React.ReactNode;
  icon: LucideIcon;
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-muted">{label}</p>
        <span className="flex size-8 items-center justify-center rounded-lg bg-surface-muted text-muted">
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <p className="mt-2 text-3xl font-bold tracking-tight">
        {value}
        {unit && <span className="ml-1 text-base font-bold text-muted">{unit}</span>}
      </p>
      {note && <div className="mt-1 text-sm text-muted">{note}</div>}
    </>
  );
  const className = "block rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5";
  return href ? (
    <Link href={href} className={`${className} transition-shadow hover:shadow-raised`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/**
 * 少ない選択肢（単位・種類など）をボタンで選ぶ。プルダウンより押しやすく、今の値が一目で分かる（D-029）。
 */
export function ChoiceButtons<T extends string>({
  label,
  options,
  value,
  onChange,
  hint,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  hint?: string;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-bold">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            aria-pressed={value === option}
            className={`min-h-10 min-w-12 rounded-lg border px-3 text-sm font-bold transition-colors ${
              value === option
                ? "border-accent bg-accent text-white"
                : "border-border-strong bg-surface text-foreground hover:border-accent hover:text-accent"
            }`}
          >
            {option}
          </button>
        ))}
      </div>
      {hint && <p className="text-sm text-muted">{hint}</p>}
    </fieldset>
  );
}

/** ChoiceButtons を、見出しつきのまとまり（料理・ドリンクなど）に分けて並べる */
export function GroupedChoiceButtons<T extends string>({
  label,
  groups,
  value,
  onChange,
  hint,
}: {
  label: string;
  groups: { label: string; categories: readonly T[] }[];
  value: T;
  onChange: (value: T) => void;
  hint?: string;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-bold">{label}</legend>
      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <div key={group.label} className="flex flex-col gap-1.5 sm:flex-row sm:gap-3">
            <p className="shrink-0 pt-2 text-xs font-bold text-muted sm:w-16">{group.label}</p>
            <div className="flex flex-wrap gap-2">
              {group.categories.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onChange(option)}
                  aria-pressed={value === option}
                  className={`min-h-10 min-w-12 rounded-lg border px-3 text-sm font-bold transition-colors ${
                    value === option
                      ? "border-accent bg-accent text-white"
                      : "border-border-strong bg-surface text-foreground hover:border-accent hover:text-accent"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {hint && <p className="text-sm text-muted">{hint}</p>}
    </fieldset>
  );
}

/** 一覧の分類ごとの見出し（D-046）。分類の区切りが一目で分かるよう、件数の印をつける */
export function GroupHeading({ label, count }: { label: string; count: number }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-base font-bold">
      <span className="h-4 w-1 rounded-full bg-accent" aria-hidden />
      {label}
      <span className="num rounded-full bg-track px-2 py-0.5 text-xs font-bold text-muted">{count}</span>
    </h2>
  );
}

/**
 * 長い一覧のページ送り（D-111）。「前へ　2 / 5　次へ」。
 * ページは URL（?page=2）で持つので、詳細を開いて戻っても同じページに戻れる。
 */
export function Pager({ page, pageCount, href }: { page: number; pageCount: number; href: (page: number) => string }) {
  if (pageCount <= 1) return null;
  const linkClass = "inline-flex min-h-12 items-center gap-1 rounded-lg border border-border-strong bg-surface px-4 font-bold shadow-card hover:bg-surface-muted";
  const disabledClass = "inline-flex min-h-12 items-center gap-1 rounded-lg border border-border px-4 font-bold text-subtle";
  return (
    <nav aria-label="ページ" className="mt-6 flex items-center justify-between gap-3">
      {page > 1 ? (
        <Link href={href(page - 1)} className={linkClass}>
          <ChevronLeft className="size-5" aria-hidden />
          前へ
        </Link>
      ) : (
        <span className={disabledClass} aria-hidden>
          <ChevronLeft className="size-5" />
          前へ
        </span>
      )}
      <span className="num whitespace-nowrap text-sm font-bold text-muted">
        {page} / {pageCount} ページ
      </span>
      {page < pageCount ? (
        <Link href={href(page + 1)} className={linkClass}>
          次へ
          <ChevronRight className="size-5" aria-hidden />
        </Link>
      ) : (
        <span className={disabledClass} aria-hidden>
          次へ
          <ChevronRight className="size-5" />
        </span>
      )}
    </nav>
  );
}
