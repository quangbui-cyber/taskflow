"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/Field";
import { Badge, EmptyState, Panel } from "@/components/ui/Presentation";
import type { CompanySupplier } from "@/lib/costflow/supplierReadModel";
import { SupplierEditor } from "./SupplierEditor";

const verification = {
  UNVERIFIED: { label: "Chưa xác minh", tone: "warning" as const },
  VERIFIED: { label: "Đã xác minh", tone: "success" as const },
  REJECTED: { label: "Bị từ chối", tone: "danger" as const },
};

export function SupplierDirectory({ suppliers, canEdit }: { suppliers: CompanySupplier[]; canEdit: boolean }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("vi");
    if (!needle) return suppliers;
    return suppliers.filter(supplier => [supplier.version.legalName, supplier.version.taxCode ?? "", ...supplier.accounts.flatMap(account => [account.bankName, account.accountLast4])].some(value => value.toLocaleLowerCase("vi").includes(needle)));
  }, [query, suppliers]);
  return <div className="mx-auto w-full max-w-[1220px] space-y-6 px-4 py-6 md:px-6">
    <header className="space-y-1"><p className="tf-module-eyebrow">CostFlow</p><h1 className="text-3xl font-bold tracking-tight">Danh bạ nhà cung cấp</h1><p className="text-[var(--text-secondary)]">Một danh bạ dùng chung toàn công ty; lịch sử Project và khóa NCC cũ vẫn được giữ để truy vết.</p></header>
    <Panel><p className="font-semibold">Tra cứu tài khoản ngân hàng</p><p className="tf-ui-help">API ngân hàng chưa tích hợp. Trạng thái hiện tại chỉ phản ánh quyết định thủ công của Kế toán trên đúng phiên bản NCC và tài khoản.</p></Panel>
    {canEdit && <details className="tf-panel tf-ui-panel"><summary className="cursor-pointer font-semibold">Thêm NCC vào danh bạ công ty</summary><div className="mt-4"><SupplierEditor /></div></details>}
    <Input type="search" label="Tìm nhà cung cấp" placeholder="Tên pháp lý, mã số thuế, ngân hàng hoặc 4 số cuối…" value={query} onChange={event => setQuery(event.target.value)} />
    {filtered.length === 0 ? <EmptyState title="Không tìm thấy NCC" description={suppliers.length ? "Thử từ khóa khác." : "Danh bạ chưa có NCC. Account hoặc Admin có thể tạo NCC đầu tiên."} /> : <div className="grid gap-4">
      {filtered.map(supplier => <Panel className="space-y-4" key={supplier.id}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{supplier.version.legalName}</h2><p className="tf-ui-help">MST: {supplier.version.taxCode || "Chưa có"} · Phiên bản pháp lý {supplier.version.version}</p></div><Badge tone="neutral">{supplier.accounts.length} tài khoản</Badge></div>
        <div className="grid gap-3 md:grid-cols-2">{supplier.accounts.map(account => { const status = verification[account.verificationStatus]; return <div className="rounded-[var(--radius-panel)] border border-[var(--border)] p-4" key={account.id}><div className="flex flex-wrap items-center gap-2"><strong>{account.bankName} · •••• {account.accountLast4}</strong>{account.isPrimary && <Badge tone="info">Mặc định</Badge>}<Badge tone={status.tone}>{status.label}</Badge></div><p className="mt-1 text-sm text-[var(--text-secondary)]">{account.accountHolder} · phiên bản {account.version}</p>{account.verificationReason && <p className="mt-2 text-sm">Lý do: {account.verificationReason}</p>}</div>; })}</div>
        <details><summary className="cursor-pointer text-sm font-semibold">Lịch sử phiên bản</summary><div className="mt-3 grid gap-3 text-sm md:grid-cols-2"><div><h3 className="font-semibold">Pháp lý</h3><ul className="mt-2 space-y-1">{supplier.versionHistory.map(item => <li key={item.id}>v{item.version} · {item.legalName} · {item.changeReason || "Khởi tạo"}</li>)}</ul></div><div><h3 className="font-semibold">Tài khoản</h3><ul className="mt-2 space-y-1">{supplier.accounts.flatMap(account => account.versionHistory.map(item => <li key={item.id}>v{item.version} · {item.bankName} •••• {item.accountLast4} · {item.changeReason || "Khởi tạo"}</li>))}</ul></div></div></details>
        {canEdit && <details><summary className="cursor-pointer text-sm font-semibold">Chỉnh sửa / thêm phiên bản</summary><div className="mt-4"><SupplierEditor supplier={supplier} /></div></details>}
      </Panel>)}
    </div>}
  </div>;
}

