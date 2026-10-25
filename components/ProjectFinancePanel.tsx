import { prisma } from "@/lib/prisma";
import { loadFinanceSheet, type FinanceViewer } from "@/lib/financeSheet";
import CreateFinanceSheetButton from "@/components/CreateFinanceSheetButton";
import FinanceSheetEditor from "@/components/FinanceSheetEditor";
import ImportFinanceDialog from "@/components/ImportFinanceDialog";

/** Tab "Tài chính" của trang dự án: bảng Báo giá + IC. */
export default async function ProjectFinancePanel({
  projectId,
  viewer,
}: {
  projectId: string;
  viewer: FinanceViewer;
}) {
  const [{ sheet, permissions }, suppliers] = await Promise.all([
    loadFinanceSheet(projectId, viewer),
    prisma.supplier.findMany({
      select: { id: true, name: true, shortName: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!sheet) {
    return (
      <section className="tf-panel mx-auto max-w-2xl p-6 text-center">
        <h2 className="text-lg font-semibold">Dự án chưa có IC</h2>
        <p className="mt-2 text-sm text-zinc-500">
          {permissions.canEdit
            ? "Tạo IC để nhập báo giá và giá vốn. Thông tin chung được điền sẵn từ dự án."
            : "Account phụ trách sẽ lập IC cho dự án này."}
        </p>
        {permissions.canEdit && (
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <ImportFinanceDialog projectId={projectId} variant="primary" />
            <CreateFinanceSheetButton projectId={projectId} />
          </div>
        )}
        {permissions.canEdit && (
          <p className="mt-4 text-xs text-zinc-500">
            Có sẵn file IC/AC Excel thì nhập từ file; không có thì tạo IC trống và nhập tay.
          </p>
        )}
      </section>
    );
  }

  const sortedSuppliers = [...suppliers].sort((a, b) =>
    (a.shortName ?? a.name).localeCompare(b.shortName ?? b.name, "vi", { sensitivity: "base" }),
  );

  return (
    <>
      {permissions.canEdit && !permissions.locked && (
        <div className="mb-4 flex justify-end">
          <ImportFinanceDialog projectId={projectId} />
        </div>
      )}
      <FinanceSheetEditor
      // Lưu xong thì máy chủ trả bản mới (có id thật) và bảng được dựng lại từ đầu.
      key={sheet.updatedAt}
      projectId={projectId}
      sheet={sheet}
      permissions={permissions}
      suppliers={sortedSuppliers}
      />
    </>
  );
}
