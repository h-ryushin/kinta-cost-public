import type { Metadata, Viewport } from "next";
import { Noto_Sans_JP } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

const notoSansJp = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "きんた 原価計算",
  description: "焼肉店きんたの材料原価とメニュー原価を計算するアプリ",
  // お店の中で使うアプリなので、検索に出さない（D-048）
  robots: { index: false, follow: false },
  // iPhone の「ホーム画面に追加」で、短い名前で並び、Safari の枠なしで開く（D-178）。アイコンは app/apple-icon.png
  appleWebApp: { capable: true, title: "きんた原価", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // スマホのブラウザの上の部分の色を、ヘッダー（画面の背景色）にそろえる
  themeColor: "#f5f3f0",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className={`${notoSansJp.variable} h-full antialiased`}>
      <body className="min-h-full">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
