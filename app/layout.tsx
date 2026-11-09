import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "PMATE · AI 产品经理助理工作台",
  description: "围绕真实项目，整理可评审的需求分析。",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
