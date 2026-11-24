"use client";

import { Beef, ChefHat, FlaskConical, History, LayoutDashboard, LogOut, MoreHorizontal, Settings, ShieldCheck, TrendingUp, UserCog, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LoginPage } from "@/components/login";
import { InviteAcceptPage, useIsInvite } from "@/components/invite-accept";
import { PasskeySetupPage } from "@/components/passkey-setup";
import { RoleLabel, RoleSwitchButton, RoleSwitchPanel } from "@/components/role-switch";
import { ScrollToTop } from "@/components/scroll-to-top";
import { SecretCostRefreshBanner } from "@/components/secret-key";
import { Toaster } from "@/components/toaster";
import { ErrorMessage, Loading } from "@/components/ui";
import { isDemoAutoLogin, signOut, useAuth } from "@/lib/auth";
import { useOnce } from "@/lib/use-once";
import { useTypingFlag } from "@/lib/typing";
import { loadStore, resetStore, StoreError } from "@/lib/store";
import { canSwitchViewRole, useEffectiveRole } from "@/lib/role";
import { setViewRole } from "@/lib/view-role";

type NavItem = {
  href: string;
  label: string;
  icon: typeof Beef;
  /** このナビを選択中として表示するパス（子の画面を含む） */
  match: string[];
  /** オーナー（管理者）だけに出す */
  adminOnly?: boolean;
};

/** PC のサイドバー（D-035）。スマホでは下のタブと「その他」に分ける */
const SIDEBAR: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      { href: "/", label: "ダッシュボード", icon: LayoutDashboard, match: [] },
      { href: "/ingredients", label: "材料・仕込み品", icon: Beef, match: ["/ingredients", "/preps"] },
      { href: "/menus", label: "メニュー", icon: UtensilsCrossed, match: ["/menus"] },
      { href: "/drafts", label: "創作レシピ", icon: FlaskConical, match: ["/drafts"] },
      // 材料の値段が変わって、どのメニューがどうなったか（D-098）
      { href: "/changes", label: "値段の変化", icon: TrendingUp, match: ["/changes"] },
    ],
  },
  {
    title: "管理",
    items: [
      { href: "/logs", label: "操作ログ", icon: History, match: ["/logs"] },
      // オーナーだけに出す（D-091）
      { href: "/users", label: "利用者", icon: UserCog, match: ["/users"], adminOnly: true },
      { href: "/settings", label: "設定", icon: Settings, match: ["/settings"] },
      // 顔・指紋・ほかの端末で入る数字・復旧コード（D-140）
      { href: "/security", label: "ログインと安全", icon: ShieldCheck, match: ["/security"] },
    ],
  },
];

/** スマホの下のタブ。ホームは左端（D-056）。創作レシピ・ログは「その他」の中（D-047） */
const TABS: NavItem[] = [
  { href: "/", label: "ホーム", icon: LayoutDashboard, match: [] },
  { href: "/ingredients", label: "材料", icon: Beef, match: ["/ingredients", "/preps"] },
  { href: "/menus", label: "メニュー", icon: UtensilsCrossed, match: ["/menus"] },
  { href: "/more", label: "その他", icon: MoreHorizontal, match: ["/more", "/drafts", "/logs", "/users", "/changes", "/settings", "/security"] },
];

/** ログインしている人だけが中を使える（D-069）。権限はデータベースの RLS が守る */
export function AppShell({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  // 招待メールのリンクから来た人は、まずパスワードを決める（D-091）
  const isInvite = useIsInvite();
  const [invited, setInvited] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const userId = auth.status === "in" ? auth.account.userId : null;
  const role = auth.status === "in" ? auth.account.role : null;
  // キーボードが出ているあいだ、下のタブと原価のバーを隠す（D-176）
  useTypingFlag();

  useEffect(() => {
    if (!userId || !role) {
      resetStore();
      return;
    }
    // 社員のアカウントは、デモの切り替えに関わらず必ず社員の見え方にする（D-089）。
    // オーナーのアカウントのときは、切り替えた状態をそのまま残す（デモで社員の見え方を見せるため）
    if (role === "staff") setViewRole("staff");
    let alive = true;
    loadStore().then(
      () => alive && setLoadError(null),
      (e: unknown) => alive && setLoadError(e instanceof StoreError ? e.message : "データを読み込めませんでした"),
    );
    return () => {
      alive = false;
    };
  }, [userId, role]);

  if (auth.status === "loading") return <Loading />;
  if (auth.status === "out") return <LoginPage />;
  if (isInvite && invited) {
    return (
      <InviteAcceptPage
        onDone={() => {
          setInvited(false);
          window.location.replace("/");
        }}
      />
    );
  }
  // 管理者はパスキーでの本人確認が要る（D-086）
  if (auth.status === "passkey-setup") return <PasskeySetupPage />;

  return (
    <SignedIn displayName={auth.account.displayName} canSwitch={auth.account.role === "admin" && canSwitchViewRole} loadError={loadError}>
      {children}
    </SignedIn>
  );
}

function SignedIn({
  displayName,
  canSwitch,
  loadError,
  children,
}: {
  displayName: string;
  /** 立場の切り替え（デモ用）は、手元のデモでオーナーのアカウントのときだけ出す（D-089・D-123） */
  canSwitch: boolean;
  loadError: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // ログアウトを続けて押しても1回だけ（D-157）
  const logout = useOnce();
  // 切り替えで社員にしているあいだは、オーナー向けの画面も隠す（D-092）
  const isAdmin = useEffectiveRole() === "admin";
  const isActive = (item: NavItem) =>
    item.href === "/" ? pathname === "/" : item.match.some((m) => pathname === m || pathname.startsWith(`${m}/`));

  return (
    <div className="min-h-screen">
      <Toaster />
      <ScrollToTop />
      {/* PC：左のサイドバー */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col bg-sidebar text-sidebar-foreground lg:flex">
        <Link href="/" className="flex items-center gap-3 px-5 py-6">
          <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-white">
            <ChefHat className="size-5" aria-hidden />
          </span>
          <span className="leading-tight">
            <span className="block text-lg font-bold text-white">きんた</span>
            <span className="block text-xs text-sidebar-muted">原価計算</span>
          </span>
        </Link>
        <nav className="flex flex-1 flex-col gap-6 px-3" aria-label="メインメニュー">
          {SIDEBAR.map((section, i) => (
            <div key={i}>
              {section.title && (
                <p className="mb-2 px-3 text-xs font-bold tracking-wider text-sidebar-muted">{section.title}</p>
              )}
              <ul className="flex flex-col gap-1">
                {section.items
                  .filter((item) => !item.adminOnly || isAdmin)
                  .map((item) => {
                  const active = isActive(item);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={`flex items-center gap-3 rounded-lg px-3 py-2.5 font-medium transition-colors ${
                          active ? "bg-accent text-white" : "hover:bg-sidebar-hover hover:text-white"
                        }`}
                      >
                        <item.icon className="size-5 shrink-0" aria-hidden />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="px-3 pb-1 text-xs text-sidebar-muted">
          <p className="truncate font-bold text-sidebar-foreground">{displayName}</p>
          {/* オーナー用か社員用か（D-125）。切り替えを出すデモのときは、切り替えのほうで分かる */}
          {!canSwitch && <RoleLabel variant="sidebar" />}
          {/* デモ中（自動ログイン）は、押しても入り直すだけなので出さない（D-070） */}
          {!isDemoAutoLogin && (
            <button type="button" onClick={() => void logout.run(signOut)} disabled={logout.busy} className="mt-1 inline-flex items-center gap-1 hover:text-white">
              <LogOut className="size-3.5" aria-hidden />
              ログアウト
            </button>
          )}
        </div>
        {canSwitch && <RoleSwitchPanel />}
      </aside>

      {/* スマホ・タブレット：上のヘッダー */}
      {/* 白い帯が浮いて見えないよう、画面と同じ背景色にして区切り線は付けない（D-051） */}
      <header className="sticky top-0 z-10 bg-background/90 backdrop-blur lg:hidden">
        <div className="flex h-14 items-center gap-2 px-4">
          <Link href="/" className="flex min-w-0 items-center gap-2 font-bold">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-white">
              <ChefHat className="size-4" aria-hidden />
            </span>
            <span className="truncate">
              きんた <span className="font-normal text-muted">原価計算</span>
            </span>
          </Link>
          {canSwitch ? <RoleSwitchButton /> : <RoleLabel variant="header" />}
        </div>
      </header>

      <main className="px-4 pb-32 pt-5 sm:px-6 lg:ml-60 lg:px-10 lg:pb-12 lg:pt-8">
        <div className="mx-auto w-full max-w-6xl">
          {loadError ? (
            <ErrorMessage message={loadError} />
          ) : (
            <>
              {/* 秘密のものの原価が古いとき、オーナーに知らせる（D-154） */}
              <SecretCostRefreshBanner />
              {children}
            </>
          )}
        </div>
      </main>

      {/* スマホ・タブレット：片手で押せるよう下にタブを置く。厨房で押しやすいよう高さは 76px（D-050） */}
      <nav
        className="hide-while-typing fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_8px_rgb(28_25_23/0.06)] lg:hidden"
        aria-label="メインメニュー"
      >
        <div className="mx-auto grid max-w-xl grid-cols-4 px-2">
          {TABS.map((item) => {
            const active = isActive(item);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-19 flex-col items-center justify-center gap-1 text-[13px] font-bold transition-colors ${
                  active ? "text-accent" : "text-muted active:bg-surface-muted"
                }`}
              >
                <item.icon className="size-7" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
