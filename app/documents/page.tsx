import { FolderOpen } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import DocumentSets from "@/components/DocumentSets";
import { canManageDocuments } from "@/lib/documents";

const DOC_BLUE_DARK = "#1d4ed8";
const DOC_BLUE_SOFT = "#eff6ff";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export default async function DocumentsPage() {
  const user = await requireUser();
  const canManage = canManageDocuments(user.role);

  const [sets, sidebarProjects] = await Promise.all([
    prisma.documentSet.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        // Không select `data`: nội dung file chỉ đọc khi tải về.
        files: {
          select: {
            id: true,
            title: true,
            mimeType: true,
            size: true,
            createdAt: true,
            uploader: { select: { name: true } },
          },
          orderBy: { createdAt: "asc" },
        },
        links: {
          select: {
            id: true,
            title: true,
            url: true,
            createdAt: true,
            creator: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.project.findMany({
      where: { members: { some: { userId: user.id } } },
      select: {
        id: true,
        name: true,
        color: true,
        status: true,
        category: true,
        responsibleTeam: { select: { id: true, name: true } },
        responsibleGroup: { select: { id: true, name: true } },
        account: { select: { team: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div className="tf-shell">
      <Sidebar user={user} projects={sidebarProjects} activeSection="documents" />

      <main className="tf-main">
        <div className="tf-page space-y-6">
          <div>
            <div className="flex items-center gap-3">
              <span
                className="flex h-10 w-10 items-center justify-center rounded-[8px]"
                style={{ backgroundColor: DOC_BLUE_SOFT, color: DOC_BLUE_DARK }}
              >
                <FolderOpen size={20} aria-hidden="true" />
              </span>
              <h1 className="tf-page-title" style={{ color: DOC_BLUE_DARK }}>
                Tài liệu
              </h1>
            </div>
            <p className="tf-page-subtitle">
              {canManage
                ? "Các bộ hồ sơ dùng chung. Mọi người đều tải về được; chỉ Admin thêm, đổi tên và xoá."
                : "Các bộ hồ sơ dùng chung của công ty. Bấm biểu tượng bên phải để tải file hoặc mở link."}
            </p>
          </div>

          <DocumentSets
            canManage={canManage}
            sets={sets.map((set) => ({
              id: set.id,
              name: set.name,
              description: set.description,
              // File và link xếp chung theo thứ tự thêm vào.
              files: [
                ...set.files.map((file) => ({
                  kind: "file" as const,
                  id: file.id,
                  title: file.title,
                  mimeType: file.mimeType,
                  size: file.size,
                  url: null,
                  addedAt: file.createdAt,
                  uploaderName: file.uploader?.name ?? null,
                })),
                ...set.links.map((link) => ({
                  kind: "link" as const,
                  id: link.id,
                  title: link.title,
                  mimeType: "",
                  size: 0,
                  url: link.url,
                  addedAt: link.createdAt,
                  uploaderName: link.creator?.name ?? null,
                })),
              ]
                .sort((a, b) => a.addedAt.getTime() - b.addedAt.getTime())
                .map(({ addedAt, ...item }) => ({
                  ...item,
                  createdAt: formatDate(addedAt),
                })),
            }))}
          />
        </div>
      </main>
    </div>
  );
}
