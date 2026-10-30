"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { notify } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import {
  canWishBirthday,
  latestBirthdayOccurrence,
  vietnamDayStart,
} from "@/lib/birthdays";
import {
  BIRTHDAY_RECOGNITION_CATEGORY,
  RECOGNITION_CATEGORIES,
  RECOGNITION_COMMENT_MAX_LENGTH,
  RECOGNITION_WEEKLY_STAR_LIMIT,
  RECOGNITION_VISIBILITIES,
  recognitionWeekRange,
} from "@/lib/recognitions";

export type RecognitionActionState = {
  error?: string;
  success?: string;
  recognitionId?: string;
};

const categoryKeys = new Set<string>(
  RECOGNITION_CATEGORIES.map((category) => category.key)
);
const visibilityKeys = new Set<string>(
  RECOGNITION_VISIBILITIES.map((visibility) => visibility.key)
);

export async function createRecognition(
  _previousState: RecognitionActionState,
  formData: FormData
): Promise<RecognitionActionState> {
  const user = await requireUser();
  const recipientId = String(formData.get("recipientId") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  const category = String(formData.get("category") ?? "KINDNESS");
  const visibility = String(formData.get("visibility") ?? "COMPANY");

  if (!recipientId) return { error: "Hãy chọn người bạn muốn cảm ơn." };
  if (recipientId === user.id) {
    return { error: "Bạn hãy dành ngôi sao này cho một người khác nhé." };
  }
  if (message.length < 2) {
    return { error: "Lời cảm ơn cần có ít nhất 2 ký tự." };
  }
  if (message.length > 500) {
    return { error: "Lời cảm ơn không được dài quá 500 ký tự." };
  }
  const isBirthdayWish = category === BIRTHDAY_RECOGNITION_CATEGORY;
  if (!isBirthdayWish && !categoryKeys.has(category)) {
    return { error: "Chủ đề không hợp lệ." };
  }
  if (!visibilityKeys.has(visibility)) {
    return { error: "Phạm vi hiển thị không hợp lệ." };
  }

  if (!isBirthdayWish) {
    const currentWeek = recognitionWeekRange();
    const sentThisWeek = await prisma.recognition.count({
      where: {
        senderId: user.id,
        category: { not: BIRTHDAY_RECOGNITION_CATEGORY },
        createdAt: { gte: currentWeek.start, lt: currentWeek.end },
      },
    });
    if (sentThisWeek >= RECOGNITION_WEEKLY_STAR_LIMIT) {
      return {
        error: `Bạn đã dùng hết ${RECOGNITION_WEEKLY_STAR_LIMIT} ngôi sao của tuần này. Ví sao sẽ đầy lại vào thứ Hai tuần sau.`,
      };
    }
  }

  const recipient = await prisma.user.findFirst({
    where: { id: recipientId, isActive: true, deletedAt: null },
    select: { id: true, name: true, birthday: true },
  });
  if (!recipient) return { error: "Không tìm thấy người nhận đang hoạt động." };

  if (isBirthdayWish) {
    if (!recipient.birthday || !canWishBirthday(recipient.birthday)) {
      return { error: `Hôm nay chưa phải dịp sinh nhật của ${recipient.name}.` };
    }
    const alreadyWished = await prisma.recognition.count({
      where: {
        senderId: user.id,
        recipientId: recipient.id,
        category: BIRTHDAY_RECOGNITION_CATEGORY,
        createdAt: {
          gte: vietnamDayStart(latestBirthdayOccurrence(recipient.birthday)),
        },
      },
    });
    if (alreadyWished > 0) {
      return { error: `Bạn đã gửi lời chúc sinh nhật đến ${recipient.name} rồi.` };
    }
  }

  const recognition = await prisma.recognition.create({
    data: {
      senderId: user.id,
      recipientId: recipient.id,
      message,
      category,
      visibility,
    },
    select: { id: true },
  });

  await notify([recipient.id], {
    type: "RECOGNITION_RECEIVED",
    message: isBirthdayWish
      ? `${user.name} đã gửi lời chúc mừng sinh nhật đến bạn`
      : `${user.name} đã gửi cho bạn một ngôi sao trong Kudos Wall`,
    recognitionId: recognition.id,
  });

  revalidatePath("/");
  revalidatePath("/recognition");
  revalidatePath("/notifications");

  return {
    success: isBirthdayWish
      ? `Đã gửi lời chúc mừng sinh nhật đến ${recipient.name}.`
      : `Đã gửi một ngôi sao đến ${recipient.name}.`,
    recognitionId: recognition.id,
  };
}

export type RecognitionCommentState = {
  error?: string;
  success?: string;
};

/** Người xem được lời cảm ơn công khai, hoặc lời cảm ơn riêng mà mình là người gửi/nhận. */
async function findVisibleRecognition(recognitionId: string, userId: string) {
  return prisma.recognition.findFirst({
    where: {
      id: recognitionId,
      OR: [{ visibility: "COMPANY" }, { senderId: userId }, { recipientId: userId }],
    },
    select: { id: true, senderId: true, recipientId: true },
  });
}

export async function addRecognitionComment(
  _previousState: RecognitionCommentState,
  formData: FormData
): Promise<RecognitionCommentState> {
  const user = await requireUser();
  const recognitionId = String(formData.get("recognitionId") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();

  if (!body) return { error: "Hãy nhập nội dung bình luận." };
  if (body.length > RECOGNITION_COMMENT_MAX_LENGTH) {
    return { error: `Bình luận không được dài quá ${RECOGNITION_COMMENT_MAX_LENGTH} ký tự.` };
  }

  const recognition = await findVisibleRecognition(recognitionId, user.id);
  if (!recognition) return { error: "Không tìm thấy lời cảm ơn này." };

  await prisma.recognitionComment.create({
    data: { recognitionId: recognition.id, authorId: user.id, body },
  });

  // Báo cho người gửi, người nhận và những người đã bình luận trước đó (trừ chính mình).
  const earlier = await prisma.recognitionComment.findMany({
    where: { recognitionId: recognition.id },
    select: { authorId: true },
    distinct: ["authorId"],
  });
  await notify(
    [recognition.senderId, recognition.recipientId, ...earlier.map((comment) => comment.authorId)].filter(
      (id) => id !== user.id
    ),
    {
      type: "RECOGNITION_COMMENT",
      message: `${user.name} đã bình luận trong một lời cảm ơn ở Kudos Wall`,
      recognitionId: recognition.id,
    }
  );

  revalidatePath("/recognition");
  revalidatePath("/notifications");
  return { success: "Đã gửi bình luận." };
}

export async function deleteRecognitionComment(commentId: string) {
  const user = await requireUser();
  const comment = await prisma.recognitionComment.findUnique({
    where: { id: commentId },
    select: { id: true, authorId: true },
  });
  if (!comment) return;
  if (comment.authorId !== user.id && user.role !== "ADMIN") return;

  await prisma.recognitionComment.delete({ where: { id: comment.id } });
  revalidatePath("/recognition");
}
