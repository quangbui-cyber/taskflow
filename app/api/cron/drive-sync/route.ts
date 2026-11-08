import { nightlyDriveSync } from "@/lib/driveStorage";
import { pushPendingMeetingRecaps } from "@/lib/recapDrive";
import { crmEnabled } from "@/lib/features";
import { retryOpportunityDriveHandovers } from "@/lib/crm/opportunityDrive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Hằng đêm: đẩy file còn sót và biên bản họp không gắn dự án lên Drive, sửa tên thư mục, đối chiếu quyền xem của mọi dự án. */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const deadline = Date.now() + 270_000;
    let opportunityHandovers = { retried: 0 };
    if (crmEnabled()) {
      try { opportunityHandovers = await retryOpportunityDriveHandovers(deadline - 120_000); }
      catch { console.warn("CRM Drive handover retry failed."); }
    }
    const result = await nightlyDriveSync(deadline - 60_000);
    const recaps = result.skipped ? null : await pushPendingMeetingRecaps(deadline);
    return Response.json({ ...result, recaps, opportunityHandovers });
  } catch (error) {
    console.error("Drive nightly sync failed", error);
    return Response.json({ error: "Drive sync failed" }, { status: 500 });
  }
}
