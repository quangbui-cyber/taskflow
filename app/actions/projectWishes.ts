"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { chatAppConfigured, sendChatAppMessage } from "@/lib/googleChatApp";
import { deliverProjectWish, saveProjectWish, type ProjectWishState } from "@/lib/projectWishService";

export type { ProjectWishState } from "@/lib/projectWishService";
const dependencies = { db: prisma, chatReady: chatAppConfigured, send: sendChatAppMessage };

export async function createProjectWish(_previous: ProjectWishState, formData: FormData): Promise<ProjectWishState> {
  const user = await requireUser();
  const result = await saveProjectWish({
    id: String(formData.get("requestId") ?? ""),
    projectId: String(formData.get("projectId") ?? ""),
    body: formData.get("body"),
  }, user.id, dependencies);
  if (result.success) revalidatePath("/");
  return result;
}

export async function retryProjectWishChat(wishId: string): Promise<ProjectWishState> {
  const user = await requireUser();
  try {
    const result = await deliverProjectWish(wishId, user.id, dependencies);
    if (result.success) revalidatePath("/");
    return result;
  } catch (error) {
    console.error("Retrying project wish failed", error);
    return { error: "Chưa gửi lại được. Vui lòng thử lại sau." };
  }
}
