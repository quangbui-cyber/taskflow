import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { creativeEnabled } from "@/lib/features";
import { isTextLine, type ArticleLine } from "@/lib/creative";
import { sendCreativeDropToGoogleChat } from "@/lib/creativeGoogleChat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!creativeEnabled()) {
    return NextResponse.json({ ok: false, message: "Tính năng Góc Đọc đang tắt." });
  }

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Lấy ngày hôm nay theo múi giờ Việt Nam (Asia/Ho_Chi_Minh)
  const vnDateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date());
  const todayVn = new Date(`${vnDateStr}T00:00:00.000Z`);

  // Tìm các bài viết SCHEDULED đến hạn hoặc quá hạn chưa mở
  const dueArticles = await prisma.creativeArticle.findMany({
    where: {
      status: "SCHEDULED",
      publishedDate: { lte: todayVn },
      titleVi: { not: null },
    },
    orderBy: { publishedDate: "asc" },
  });

  if (dueArticles.length === 0) {
    return NextResponse.json({
      ok: true,
      message: "Không có bài viết nào cần phát hành hôm nay.",
      date: vnDateStr,
    });
  }

  const publishedArticles = [];

  for (const article of dueArticles) {
    await prisma.creativeArticle.update({
      where: { id: article.id },
      data: { status: "PUBLISHED" },
    });

    // Trích dẫn 3 dòng đầu
    const lines = (article.linesVi as unknown as ArticleLine[]) || [];
    const textLines = lines.filter(isTextLine).map((l) => l.t.replace(/[*_]/g, ""));
    const excerpt = textLines.slice(0, 3).join(" ");

    // Gửi thông báo đến Google Chat nếu có webhook
    try {
      await sendCreativeDropToGoogleChat({
        slug: article.slug,
        originalTitle: article.originalTitle,
        titleVi: article.titleVi,
        wordCount: article.wordCount,
        excerpt,
      });
    } catch (chatError) {
      console.warn("Lỗi gửi thông báo Google Chat cho bài đọc:", chatError);
    }

    publishedArticles.push({
      slug: article.slug,
      title: article.originalTitle,
      titleVi: article.titleVi,
    });
  }

  return NextResponse.json({
    ok: true,
    message: `Đã phát hành thành công ${publishedArticles.length} bài viết.`,
    publishedArticles,
  });
}

