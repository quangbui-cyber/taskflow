import type { Metadata } from "next";
import { connection } from "next/server";
import PublicVerificationCard from "@/components/workflow/PublicVerificationCard";
import { verifyPublicCapability } from "@/lib/workflow/publicVerification";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Tra cứu hồ sơ nội bộ — Creative Station",
  description: "Kiểm tra bằng chứng phát hành nội bộ trên bản in.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function PublicVerificationPage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const result = await verifyPublicCapability(token);
  return <PublicVerificationCard result={result} />;
}
