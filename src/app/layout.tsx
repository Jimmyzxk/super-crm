import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Super CRM - 企业级数智销售管理平台",
  description: "面向 B2B 企业的一体化销售线索流转、商机推进、产品核算与 AI 打法智能赋能中枢",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
