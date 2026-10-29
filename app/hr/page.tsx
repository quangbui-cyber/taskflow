import { redirect } from "next/navigation";
import { FileDown, IdCard } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageHr, toDateInput } from "@/lib/employeeRecords";
import Sidebar from "@/components/Sidebar";
import HubTabs from "@/components/HubTabs";
import {
  EmployeeRecordTable,
  HrImportButton,
  HrManagerPicker,
  type EmployeeRow,
} from "@/components/EmployeeRecords";

// Hồ sơ nhân sự chứa CCCD, địa chỉ, số điện thoại: chỉ Admin và người phụ trách nhân sự.
export default async function HrPage() {
  const user = await requireUser();
  if (!canManageHr(user)) redirect("/");
  const isAdmin = user.role === "ADMIN";

  const people = await prisma.user.findMany({
    where: { isActive: true, deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      avatarUrl: true,
      isHrManager: true,
      employeeRecord: {
        select: {
          fullName: true,
          gender: true,
          dateOfBirth: true,
          idNumber: true,
          address: true,
          phone: true,
          startDate: true,
        },
      },
    },
  });
  people.sort((a, b) => a.name.localeCompare(b.name, "vi", { sensitivity: "base" }));

  const rows: EmployeeRow[] = people.map((person) => ({
    userId: person.id,
    accountName: person.name,
    email: person.email,
    avatarUrl: person.avatarUrl,
    record: person.employeeRecord
      ? {
          fullName: person.employeeRecord.fullName,
          gender: person.employeeRecord.gender,
          dateOfBirth: toDateInput(person.employeeRecord.dateOfBirth),
          idNumber: person.employeeRecord.idNumber,
          address: person.employeeRecord.address,
          phone: person.employeeRecord.phone,
          startDate: toDateInput(person.employeeRecord.startDate),
        }
      : null,
  }));
  const withRecord = rows.filter((row) => row.record).length;

  return (
    <div className="tf-shell">
      <Sidebar user={user} activeSection="hr" />

      <main className="tf-main bg-zinc-50">
        <HubTabs section="hr" role={user.role} isHrManager={user.isHrManager} />
        <div className="tf-page space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-brand-50 text-brand-700">
                  <IdCard size={20} aria-hidden="true" />
                </span>
                <h1 className="tf-page-title">Hồ sơ nhân sự</h1>
              </div>
              <p className="tf-page-subtitle">
                {withRecord}/{rows.length} nhân sự đã có hồ sơ
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <a
                href="/api/hr/export"
                download
                className="tf-button-secondary !min-h-10 text-sm"
                title="Tải danh sách hồ sơ nhân sự hiện tại về máy dạng Excel để xem hoặc điền thông tin"
              >
                <FileDown size={17} aria-hidden="true" />
                Tải file Excel hiện tại
              </a>
              <HrImportButton />
            </div>
          </div>

          {isAdmin && (
            <HrManagerPicker
              users={people.map((person) => ({ id: person.id, name: person.name }))}
              selectedIds={people.filter((person) => person.isHrManager).map((person) => person.id)}
            />
          )}

          <EmployeeRecordTable rows={rows} />
        </div>
      </main>
    </div>
  );
}
