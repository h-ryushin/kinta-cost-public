"use client";

import { Lock } from "lucide-react";
import { Card, CardTitle, ChoiceButtons } from "@/components/ui";
import { dateTime } from "@/lib/format";

/**
 * 秘密のメニュー・仕込み品の印と、見られる人を選ぶボタン（D-060）。
 * 中身（材料・使用量・メモ）はオーナーだけが見られ、社員には原価の金額だけを見せる（要件定義書 2章）。
 */
export function SecretBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-accent-soft px-2 py-0.5 text-xs font-bold text-accent">
      <Lock className="size-3.5" aria-hidden />
      秘密
    </span>
  );
}

const OPEN_LABEL = "社員も見られる";
const SECRET_LABEL = "オーナーだけ";

/** オーナーが「秘密」にするかどうかを選ぶ */
export function SecretChoice({
  label,
  value,
  onChange,
}: {
  /** 「このメニューの中身」など、何の中身かを示す言葉 */
  label: string;
  value: boolean;
  onChange: (secret: boolean) => void;
}) {
  return (
    <ChoiceButtons
      label={`${label}を見られる人`}
      options={[OPEN_LABEL, SECRET_LABEL]}
      value={value ? SECRET_LABEL : OPEN_LABEL}
      onChange={(choice) => onChange(choice === SECRET_LABEL)}
      hint={
        value
          ? "材料・使用量・メモは暗号化して、オーナーだけが見られます。原価と売価の金額は社員も見られます"
          : "塩だれなど、配合を知られたくないものは「オーナーだけ」にします"
      }
    />
  );
}

/** 「秘密にするかどうか」は見つけにくかったので、専用のカードにする（D-060 の追記） */
export function SecretCard({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: boolean;
  onChange: (secret: boolean) => void;
  /** 「オーナーだけ」のときに下に出すもの（鍵の案内：D-148） */
  children?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-4">
      <CardTitle>
        <span className="flex items-center gap-2">
          <Lock className="size-4.5 text-accent" aria-hidden />
          秘密にする
        </span>
      </CardTitle>
      <div className="-mt-2">
        <SecretChoice label={label} value={value} onChange={onChange} />
      </div>
      {value && children}
    </Card>
  );
}

/**
 * 秘密のものの原価が、いつ計算した金額か（D-154）。
 * 中身は暗号化してあり、オーナーが鍵を開けたときにしか計算し直せないので、古いかもしれないことを知らせる。
 */
export function SecretCostNote({ costAt, stale }: { costAt?: string | null; stale: boolean }) {
  if (!costAt && !stale) return null;
  return (
    <p className={`mt-2 text-sm ${stale ? "font-bold text-warn" : "text-muted"}`}>
      {stale
        ? `原価は${costAt ? ` ${dateTime(costAt)} ` : ""}時点の金額です。そのあと材料の値段が変わったので、オーナーがアプリを開くと新しくなります。`
        : `原価は ${dateTime(costAt ?? "")} にオーナーが計算した金額です。`}
    </p>
  );
}

/** 社員の立場で秘密のものを開いたときに、中身の代わりに出す案内 */
export function SecretLockCard({ what, costAt, stale = false }: { what: string; costAt?: string | null; stale?: boolean }) {
  return (
    <Card className="flex items-start gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
        <Lock className="size-5" aria-hidden />
      </span>
      <div>
        <p className="font-bold">{what}はオーナーだけが見られます</p>
        <p className="mt-1 text-sm text-muted">
          原価・売価・原価率の金額は見られます。材料の配合を見たり変えたりできるのはオーナーだけです。
        </p>
        <SecretCostNote costAt={costAt} stale={stale} />
      </div>
    </Card>
  );
}
