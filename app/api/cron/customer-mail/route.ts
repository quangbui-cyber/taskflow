import { NextResponse } from "next/server";
import { processCustomerMail } from "@/lib/customerMailSend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Chạy mỗi phút: mở chiến dịch đã đến giờ hẹn và gửi tiếp tối đa 20 thư mỗi lượt.
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const result = await processCustomerMail();
  return NextResponse.json({ ok: true, ...result });
}
