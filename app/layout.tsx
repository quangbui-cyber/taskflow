import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "myCreative — Quản lý công việc",
  description: "Không gian quản lý dự án và công việc của Creative Station",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" className="h-full antialiased">
      <body>{children}</body>
    </html>
  );
}
