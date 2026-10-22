import { sendMeetingStartPrompts } from "@/lib/meetingStartPrompts";

export const runtime = "nodejs";

/** Vercel Cron gọi mỗi phút (cần gói Pro). Báo người tổ chức khi cuộc họp bắt đầu. */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    return Response.json({ ok: true, ...(await sendMeetingStartPrompts()) });
  } catch (error) {
    console.error("Meeting start prompts failed", error);
    return Response.json({ ok: false }, { status: 503 });
  }
}
