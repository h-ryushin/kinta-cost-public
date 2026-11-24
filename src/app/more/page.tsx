"use client";

import { ChevronRight, FlaskConical, History, LogOut, Settings, ShieldCheck, TrendingUp, UserCog } from "lucide-react";
import Link from "next/link";
import { RoleLabel } from "@/components/role-switch";
import { Button, PageHeader } from "@/components/ui";
import { isDemoAutoLogin, signOut, useAuth } from "@/lib/auth";
import { useOnce } from "@/lib/use-once";
import { useEffectiveRole } from "@/lib/role";

const ITEMS = [
  { href: "/drafts", title: "創作レシピ", text: "新メニューの試作と原価の試算", icon: FlaskConical },
  { href: "/changes", title: "値段の変化", text: "材料の値段が変わって、どのメニューがどうなったか", icon: TrendingUp },
  { href: "/logs", title: "操作ログ", text: "材料・価格・レシピの変更の記録", icon: History },
  // 顔・指紋・ほかの端末で入る数字・復旧コードをまとめた画面（D-140）
  { href: "/security", title: "ログインと安全", text: "顔・指紋でログイン、ほかの端末で入るとき", icon: ShieldCheck },
  // 社員も見られる。秘密のものの原価が反映されているかもここで見る（D-167）。変えられるのはオーナーだけ
  { href: "/settings", title: "設定", text: "消費税・原価率の目安・秘密のものの原価（変えるのはオーナー）", icon: Settings },
];

const ADMIN_ITEMS = [{ href: "/users", title: "利用者", text: "社員の招待・停止（オーナーのみ）", icon: UserCog }];

export default function MorePage() {
  // 利用者の管理はオーナーだけ（D-091・D-092）。操作ログ（D-162）と設定（見るだけ：D-167）は社員も見られる
  const isAdmin = useEffectiveRole() === "admin";
  const auth = useAuth();
  // ログアウトを続けて押しても1回だけ（D-157）
  const logout = useOnce();
  const items = isAdmin ? [...ITEMS, ...ADMIN_ITEMS] : ITEMS;
  return (
    <>
      <PageHeader title="その他" />
      <ul className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
        {items.map((item) => (
          <li key={item.href} className="border-t border-border first:border-0">
            <Link href={item.href} className="flex items-center gap-4 px-4 py-4 hover:bg-surface-muted">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-muted">
                <item.icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-bold">{item.title}</span>
                <span className="block text-sm text-muted">{item.text}</span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-subtle" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>

      {/* スマホにはサイドバーがないので、ログイン中の人とログアウトはここに置く（D-129） */}
      {auth.status === "in" && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-4 shadow-card">
          <span className="min-w-0">
            <span className="block text-xs text-muted">ログイン中</span>
            <span className="flex items-center gap-2">
              <span className="truncate font-bold">{auth.account.displayName}</span>
              <RoleLabel variant="header" />
            </span>
          </span>
          {/* デモ中（自動ログイン）は、押しても入り直すだけなので出さない（D-070） */}
          {!isDemoAutoLogin && (
            <Button variant="secondary" onClick={() => void logout.run(signOut)} disabled={logout.busy} className="min-h-12">
              <LogOut aria-hidden />
              ログアウト
            </Button>
          )}
        </div>
      )}
    </>
  );
}
