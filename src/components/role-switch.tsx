"use client";

import { ShieldCheck, User } from "lucide-react";
import { useEffectiveRole } from "@/lib/role";
import { setViewRole, useViewRole, VIEW_ROLE_LABEL, VIEW_ROLES } from "@/lib/view-role";

/**
 * 「表示する立場」の切り替え（D-060）。秘密のメニュー・仕込み品の見え方を確かめるための仮のしくみで、
 * ログイン機能ができたらログイン中の権限に差し替える。
 */
export function RoleSwitchPanel() {
  const role = useViewRole();
  return (
    <div className="m-3 rounded-lg bg-sidebar-hover p-3">
      <p className="text-xs font-bold text-sidebar-muted">表示する立場（デモ用）</p>
      <div className="mt-2 flex gap-1">
        {VIEW_ROLES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setViewRole(r)}
            aria-pressed={role === r}
            className={`min-h-10 flex-1 rounded-lg text-sm font-bold transition-colors ${
              role === r ? "bg-accent text-white" : "text-sidebar-muted hover:text-white"
            }`}
          >
            {VIEW_ROLE_LABEL[r]}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-sidebar-muted">見え方だけを切り替えます（権限はデータベースが守ります）</p>
    </div>
  );
}

/** スマホ・タブレットのヘッダーに置く切り替え。押すと立場が入れ替わる */
export function RoleSwitchButton() {
  const role = useViewRole();
  const Icon = role === "admin" ? ShieldCheck : User;
  return (
    <button
      type="button"
      onClick={() => setViewRole(role === "admin" ? "staff" : "admin")}
      aria-label={`表示する立場を切り替える（今は${VIEW_ROLE_LABEL[role]}）`}
      className="ml-auto flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3 text-sm font-bold text-muted"
    >
      <Icon className="size-4.5 shrink-0" aria-hidden />
      {VIEW_ROLE_LABEL[role]}
    </button>
  );
}

/**
 * いまオーナーとして入っているか、社員として入っているかの表示（D-125）。押せない。
 * 公開サイトでは見え方の切り替えを出さない（D-123）ので、代わりにこれを出す。
 */
export function RoleLabel({ variant }: { variant: "sidebar" | "header" }) {
  const role = useEffectiveRole();
  const Icon = role === "admin" ? ShieldCheck : User;
  const style =
    variant === "sidebar"
      ? "mt-1 bg-sidebar-hover text-white"
      : `ml-auto ${role === "admin" ? "bg-accent-soft text-accent" : "bg-track text-muted"}`;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${style}`}>
      <Icon className="size-3.5" aria-hidden />
      {role === "admin" ? "オーナー用" : "社員用"}
    </span>
  );
}
