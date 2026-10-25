import { chatEventReply, verifyChatEventRequest } from "@/lib/googleChatEvents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Địa chỉ nhận sự kiện của Chat app myCreative (khai báo trong Google Cloud → Google Chat API → Configuration). */
export async function POST(request: Request) {
  const endpoint = new URL(request.url);
  const endpointUrl = `${endpoint.origin}${endpoint.pathname}`;
  if (!(await verifyChatEventRequest(request.headers.get("authorization"), endpointUrl))) {
    return new Response("Unauthorized", { status: 401 });
  }
  const body = await request.json().catch(() => null);
  return Response.json(chatEventReply(body));
}
