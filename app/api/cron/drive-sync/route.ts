import { nightlyDriveSync } from "@/lib/driveStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Hằng đêm: đẩy file còn sót lên Drive, sửa tên thư mục, đối chiếu quyền xem của mọi dự án. */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const result = await nightlyDriveSync(Date.now() + 270_000);
    return Response.json(result);
  } catch (error) {
    console.error("Drive nightly sync failed", error);
    return Response.json({ error: "Drive sync failed" }, { status: 500 });
  }
}
