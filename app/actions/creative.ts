"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function toggleLikeArticle(articleId: string) {
  const user = await getCurrentUser();
  if (!user) {
    return { liked: false, likeCount: 0, requireLogin: true };
  }

  const existing = await prisma.articleReader.findUnique({
    where: {
      userId_articleId: {
        userId: user.id,
        articleId,
      },
    },
  });

  const isLiked = Boolean(existing?.likedAt);
  const newLikedAt = isLiked ? null : new Date();

  await prisma.articleReader.upsert({
    where: {
      userId_articleId: {
        userId: user.id,
        articleId,
      },
    },
    update: {
      likedAt: newLikedAt,
    },
    create: {
      userId: user.id,
      articleId,
      likedAt: newLikedAt,
    },
  });

  const likeCount = await prisma.articleReader.count({
    where: {
      articleId,
      likedAt: { not: null },
    },
  });

  revalidatePath("/creative");
  return { liked: !isLiked, likeCount };
}

export async function toggleSaveArticle(articleId: string) {
  const user = await getCurrentUser();
  if (!user) {
    return { saved: false, requireLogin: true };
  }

  const existing = await prisma.articleReader.findUnique({
    where: {
      userId_articleId: {
        userId: user.id,
        articleId,
      },
    },
  });

  const isSaved = Boolean(existing?.savedAt);
  const newSavedAt = isSaved ? null : new Date();

  await prisma.articleReader.upsert({
    where: {
      userId_articleId: {
        userId: user.id,
        articleId,
      },
    },
    update: {
      savedAt: newSavedAt,
    },
    create: {
      userId: user.id,
      articleId,
      savedAt: newSavedAt,
    },
  });

  revalidatePath("/creative");
  return { saved: !isSaved };
}

export async function markArticleAsRead(articleId: string) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, requireLogin: true };
  }

  await prisma.articleReader.upsert({
    where: {
      userId_articleId: {
        userId: user.id,
        articleId,
      },
    },
    update: {
      readAt: new Date(),
    },
    create: {
      userId: user.id,
      articleId,
      readAt: new Date(),
    },
  });

  return { success: true };
}

