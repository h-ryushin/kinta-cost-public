"use client";

import { CircleAlert } from "lucide-react";
import { useId, useState } from "react";
import { inputClass } from "@/components/ui";
import { acceptNumberInput, validateNumberInput, type NumberRule } from "@/lib/number-input";

/**
 * 数字だけを入れる入力欄（D-036、D-038、D-039）。
 * - 全角で打っても、その場で半角にする。数字（と小数点）以外の文字や、上限を超える数字は
 *   エラーを出さずに受け付けない（打っても入らない）
 * - 日本語入力の変換中は、欄の値を書き換えると入力が二重になって壊れる（Chrome で確認）。
 *   そこで変換中は欄を塗りつぶして覆い、受け付ける数字だけを上に見せ、確定したときに値を直す。
 *   文字を透明にするだけだと、変換中の下線（「＿＿」）が残って見えてしまう（D-057）
 * - 単位（g・円など）は欄の右に表示し、打たなくてよいことを見せる
 * - 止めようのない誤り（空欄・0）だけ、保存を押したあと（showErrors）に欄の下で知らせる
 */
export function NumberInput({
  id,
  value,
  onChange,
  rule,
  unit,
  showErrors = false,
  placeholder,
  ariaLabel,
  className = "",
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  rule: NumberRule;
  unit?: string;
  /** 保存を押したあと。空欄・0 などの誤りを欄の下に出す */
  showErrors?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const messageId = useId();
  // 日本語入力で変換中の文字。値は書き換えず、見た目だけ直して見せる
  const [composing, setComposing] = useState<string | null>(null);
  const composingPreview = composing === null ? null : acceptNumberInput(composing, value, rule);

  const error = showErrors ? validateNumberInput(value, rule) : null;

  return (
    <div className={className}>
      <div className="relative">
        <input
          id={id}
          aria-label={ariaLabel}
          inputMode={rule.kind === "integer" ? "numeric" : "decimal"}
          autoComplete="off"
          value={composing ?? value}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? messageId : undefined}
          onCompositionStart={() => setComposing(value)}
          onCompositionEnd={(e) => {
            setComposing(null);
            onChange(acceptNumberInput(e.currentTarget.value, value, rule));
          }}
          onChange={(e) => {
            if (composing !== null) setComposing(e.target.value);
            else onChange(acceptNumberInput(e.target.value, value, rule));
          }}
          className={`${inputClass} num ${unit ? "pr-10" : ""} ${
            error ? "border-danger focus:border-danger focus:ring-accent-soft" : ""
          } ${composingPreview !== null ? "text-transparent caret-transparent" : ""}`}
        />
        {/* 変換中の文字と下線を隠すため、欄の中を塗りつぶして数字だけを見せる（D-057） */}
        {composingPreview !== null && (
          <span
            aria-hidden
            className="num pointer-events-none absolute inset-px flex items-center rounded-lg bg-surface pl-3 text-base"
          >
            {composingPreview}
          </span>
        )}
        {unit && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted" aria-hidden>
            {unit}
          </span>
        )}
      </div>
      {error && (
        <p id={messageId} role="alert" className="mt-1 flex items-start gap-1 text-sm font-bold text-danger">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}
