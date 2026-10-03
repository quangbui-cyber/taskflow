import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import "./globals.css";
import InteractionProvider from "@/components/InteractionProvider";

export const metadata: Metadata = {
  title: "myCreative — Quản lý công việc",
  description: "Không gian quản lý dự án và công việc của Creative Station",
  appleWebApp: { capable: true, title: "myCreative", statusBarStyle: "default" },
  icons: { apple: "/api/pwa-icon?size=180" },
};

export const viewport: Viewport = { themeColor: "#a5d522" };

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // CSP dùng nonce theo từng request; vì vậy mọi trang phải render động để
  // Next.js gắn nonce vào các script framework và RSC payload.
  await connection();

  return (
    <html lang="vi" className="h-full antialiased">
      <body>
        <InteractionProvider>{children}</InteractionProvider>
      </body>
    </html>
  );
}
