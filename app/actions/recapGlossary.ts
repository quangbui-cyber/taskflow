"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireUser } from "@/lib/auth";
import { canManageMeetingRecap } from "@/lib/meetingRecap";
import { findRecapMeeting } from "@/lib/meetingRecapData";
import { prisma } from "@/lib/prisma";
import {
  GLOSSARY_RULE_MAX,
  GLOSSARY_TEXT_MAX,
  addHeardAs,
  readGlossarySuggestions,
} from "@/lib/recapGlossary";

export type GlossaryActionState = { error?: string; success?: string };

const oneLine = (value: unknown, max: number) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

async function upsertTerm(text: string, heardAs: string | null, userId: string) {
  const existing = await prisma.recapGlossaryTerm.findUnique({ where: { kind_text: { kind: "TERM", text } } });
  if (existing) {
    await prisma.recapGlossaryTerm.update({
      where: { id: existing.id },
      data: { useCount: { increment: 1 }, ...(heardAs ? { heardAs: addHeardAs(existing.heardAs, heardAs) } : {}) },
    });
    return;
  }
  await prisma.recapGlossaryTerm.create({ data: { kind: "TERM", text, heardAs, createdById: userId } });
}

/** Người ghi biên bản chọn những từ đã sửa để thêm vào từ điển chung; phần còn lại được bỏ qua. */
export async function acceptGlossarySuggestions(
  meetingId: string,
  picked: { wrong: string; right: string }[]
): Promise<GlossaryActionState> {
  const user = await requireUser();
  const meeting = await findRecapMeeting(meetingId);
  if (!meeting?.recap || !canManageMeetingRecap(meeting, user)) {
    return { error: "Chỉ người ghi biên bản, người tổ chức hoặc quản trị viên mới làm được việc này." };
  }
  // Chỉ nhận những cặp thật sự nằm trong gợi ý của biên bản này.
  const pending = readGlossarySuggestions(meeting.recap.glossarySuggestions);
  const allowed = readGlossarySuggestions(picked).filter((item) =>
    pending.some((row) => row.wrong === item.wrong && row.right === item.right)
  );
  for (const item of allowed) await upsertTerm(item.right, item.wrong, user.id);

  await prisma.meetingRecap.update({ where: { id: meeting.recap.id }, data: { glossarySuggestions: [] } });
  revalidatePath(`/meetings/${meetingId}/recap`);
  revalidatePath("/admin");
  return { success: allowed.length ? `Đã thêm ${allowed.length} từ vào từ điển.` : "Đã bỏ qua gợi ý." };
}

export async function dismissGlossarySuggestions(meetingId: string): Promise<GlossaryActionState> {
  return acceptGlossarySuggestions(meetingId, []);
}

export async function addGlossaryEntry(
  _previous: GlossaryActionState,
  formData: FormData
): Promise<GlossaryActionState> {
  const admin = await requireAdmin();
  const kind = formData.get("kind") === "RULE" ? "RULE" : "TERM";
  const text = oneLine(formData.get("text"), kind === "RULE" ? GLOSSARY_RULE_MAX : GLOSSARY_TEXT_MAX);
  const heardAs = kind === "TERM" ? oneLine(formData.get("heardAs"), GLOSSARY_TEXT_MAX) || null : null;
  if (!text) return { error: kind === "RULE" ? "Nhập quy tắc viết." : "Nhập từ cần ghi nhớ." };

  if (kind === "TERM") await upsertTerm(text, heardAs, admin.id);
  else {
    await prisma.recapGlossaryTerm.upsert({
      where: { kind_text: { kind, text } },
      update: {},
      create: { kind, text, createdById: admin.id },
    });
  }
  revalidatePath("/admin");
  return { success: "Đã lưu vào từ điển." };
}

export async function deleteGlossaryEntry(id: string): Promise<GlossaryActionState> {
  await requireAdmin();
  if (typeof id !== "string" || !id) return { error: "Mục không tồn tại." };
  await prisma.recapGlossaryTerm.deleteMany({ where: { id } });
  revalidatePath("/admin");
  return { success: "Đã xoá khỏi từ điển." };
}
