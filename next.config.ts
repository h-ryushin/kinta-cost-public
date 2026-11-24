import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 静的なHTML/JSとして書き出す（docs/decisions.md の D-012）
  output: "export",
  // 開発中だけ出る Next.js のアイコンは、スマホの下のナビや PC の上のナビに重なるため出さない
  devIndicators: false,
};

export default nextConfig;
