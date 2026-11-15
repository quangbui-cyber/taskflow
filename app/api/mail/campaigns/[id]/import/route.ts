import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MAX_RECIPIENTS, mergeDuplicates } from "@/lib/customerMail";
import {
  MAX_IMPORT_BYTES,
  MAX_PASTE_CHARS,
  MailImportError,
  importKind,
  importRecipients,
} from "@/lib/customerMailImport";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Tải danh sách người nhận lên một chiến dịch: một file (CSV, XLSX, PDF, ảnh) hoặc chữ dán.
 * File chỉ được đọc trong bộ nhớ để trích danh sách rồi bỏ, không lưu lại ở đâu.
 * Dòng trùng email với dòng đã có thì chỉ điền thêm phần còn trống.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Phiên đăng nhập đã hết hạn." }, { status: 401 });
  if (user.role !== "ADMIN") return Response.json({ error: "Chỉ quản trị viên mới gửi thư cho khách." }, { status: 403 });
  const { id } = await params;
  const campaign = await prisma.mailCampaign.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!campaign) return Response.json({ error: "Không tìm thấy chiến dịch." }, { status: 404 });
  if (campaign.status !== "draft") {
    return Response.json({ error: "Huỷ hẹn giờ trước khi thêm người nhận." }, { status: 409 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "File quá lớn. Mỗi file tối đa 4 MB." }, { status: 413 });
  }
  const file = form.get("file");
  const pasted = form.get("text");

  let input: Parameters<typeof importRecipients>[0];
  if (file instanceof File) {
    const kind = importKind(file.name, file.type);
    if (!kind) return Response.json({ error: `${file.name}: chỉ nhận CSV, Excel, PDF hoặc ảnh.` }, { status: 400 });
    if (file.size > MAX_IMPORT_BYTES) {
      return Response.json({ error: `${file.name} quá lớn. Mỗi file tối đa 4 MB.` }, { status: 413 });
    }
    input = { ...kind, data: Buffer.from(await file.arrayBuffer()), source: file.name.slice(0, 160) };
  } else if (typeof pasted === "string" && pasted.trim()) {
    if (pasted.length > MAX_PASTE_CHARS) return Response.json({ error: "Đoạn chữ dán quá dài." }, { status: 413 });
    input = { kind: "text", mimeType: "text/plain", data: Buffer.from(pasted, "utf8"), source: "Chữ dán" };
  } else {
    return Response.json({ error: "Chọn file hoặc dán danh sách." }, { status: 400 });
  }

  let extracted: Awaited<ReturnType<typeof importRecipients>>;
  try {
    extracted = await importRecipients(input);
  } catch (error) {
    if (error instanceof MailImportError) return Response.json({ error: error.message }, { status: 422 });
    console.warn("Customer mail import failed.");
    return Response.json({ error: "Không đọc được danh sách này." }, { status: 500 });
  }

  const { rows, merged: mergedInFile } = mergeDuplicates(extracted.people);
  const existing = await prisma.mailRecipient.findMany({
    where: { campaignId: id },
    select: { id: true, email: true, callName: true, salutation: true, group: true, note: true },
  });
  if (existing.length + rows.length > MAX_RECIPIENTS) {
    return Response.json({ error: `Mỗi chiến dịch tối đa ${MAX_RECIPIENTS} người nhận.` }, { status: 400 });
  }
  const byEmail = new Map(existing.filter((row) => row.email).map((row) => [row.email!, row]));
  const fresh = rows.filter((row) => !row.email || !byEmail.has(row.email));
  const repeats = rows.filter((row) => row.email && byEmail.has(row.email));

  await prisma.$transaction([
    prisma.mailRecipient.createMany({
      data: fresh.map((row) => ({ campaignId: id, ...row })),
      skipDuplicates: true,
    }),
    ...repeats.map((row) => {
      const current = byEmail.get(row.email!)!;
      return prisma.mailRecipient.update({
        where: { id: current.id },
        data: {
          callName: current.callName ?? row.callName,
          salutation: current.salutation ?? row.salutation,
          group: current.group ?? row.group,
          note: current.note ?? row.note,
        },
      });
    }),
  ]);
  await prisma.mailCampaignEvent.create({
    data: {
      campaignId: id,
      userId: user.id,
      action: "import",
      detail: `${input.source}: thêm ${fresh.length}, gộp ${mergedInFile + repeats.length} dòng trùng${extracted.usedAi ? " (Gemini đọc)" : ""}`,
    },
  });
  revalidatePath(`/mail/${id}`);
  return Response.json({
    added: fresh.length,
    merged: mergedInFile + repeats.length,
    summary: extracted.summary,
    usedAi: extracted.usedAi,
  });
}
