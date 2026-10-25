import { prisma } from "@/lib/prisma";
import { loadFinanceSheet, type FinanceViewer } from "@/lib/financeSheet";
import CreateFinanceSheetButton from "@/components/CreateFinanceSheetButton";
import FinanceSheetEditor from "@/components/FinanceSheetEditor";
import ImportFinanceDialog from "@/components/ImportFinanceDialog";
import type { CcCandidate, FinanceApprovalProps } from "@/components/FinanceApprovalBar";
import { canDecideFinanceSheet, canViewFinanceSell, canWithdrawFinanceSheet } from "@/lib/financePolicy";
import { ROLE_LABELS, isUserRole } from "@/lib/roles";

/** Tab "Tài chính" của trang dự án: bảng Báo giá + IC. */
export default async function ProjectFinancePanel({
  projectId,
  viewer,
}: {
  projectId: string;
  viewer: FinanceViewer;
}) {
  const [{ sheet, permissions }, suppliers, project, people] = await Promise.all([
    loadFinanceSheet(projectId, viewer),
    prisma.supplier.findMany({
      select: { id: true, name: true, shortName: true },
      orderBy: { name: "asc" },
    }),
    prisma.project.findUnique({
      where: { id: projectId },
      select: {
        ownerId: true,
        icApproverId: true,
        icApprover: { select: { id: true, name: true, isActive: true, deletedAt: true } },
        account: { select: { userId: true } },
      },
    }),
    prisma.user.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, name: true, email: true, avatarUrl: true, role: true },
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

  const approverUser = project?.icApprover;
  const approver =
    approverUser && approverUser.isActive && !approverUser.deletedAt
      ? { id: approverUser.id, name: approverUser.name }
      : null;
  // Người gửi luôn tự được CC ở máy chủ nên không hiện trong danh sách chọn.
  const ccCandidates: CcCandidate[] = people
    .filter((person) => person.id !== viewer.id || person.id === approver?.id)
    .map((person) => ({
    id: person.id,
    name: person.name,
    email: person.email,
    avatarUrl: person.avatarUrl,
    roleLabel: isUserRole(person.role) ? ROLE_LABELS[person.role] : person.role,
    seesSell: canViewFinanceSell(person.role),
  }));
  const activeIds = new Set(people.map((person) => person.id));
  // CC mặc định: lần gửi trước; chưa gửi lần nào thì Account phụ trách và người tạo dự án.
  const baseCc = sheet.approval.ccUserIds.length
    ? sheet.approval.ccUserIds
    : [project?.account?.userId, project?.ownerId].filter((id): id is string => Boolean(id));
  const defaultCcIds = [...new Set(baseCc)].filter(
    (id) => activeIds.has(id) && id !== approver?.id && id !== viewer.id,
  );
  const approval: FinanceApprovalProps = {
    projectId,
    viewerId: viewer.id,
    approver,
    canEdit: permissions.canEdit,
    canDecide: canDecideFinanceSheet(viewer, project?.icApproverId ?? null),
    canWithdraw: canWithdrawFinanceSheet(viewer, sheet.approval.submittedById),
    ccCandidates,
    defaultCcIds,
  };

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
      approval={approval}
      />
    </>
  );
}
