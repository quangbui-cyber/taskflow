"use client";

import Link from "next/link";
import type { Finance } from "@/components/CostFlowPanel";
import { Panel } from "@/components/ui/Presentation";
import PurchaseOrderVersions from "@/components/PurchaseOrderVersions";

export default function CostFlowInputs({ finance, canCreate }: { finance: Finance; canCreate: boolean }) {
  return <Panel className="tf-source-panel">
    <div className="tf-source-heading"><h2 className="font-semibold">Tài liệu dự án <span className="tf-list-meta">({finance.files.length})</span></h2><Link className="tf-link text-sm" href={`/projects/${finance.project.id}?tab=files`}>Quản lý tài liệu</Link></div>
    {finance.files.length ? <><div className="flex flex-wrap gap-2">{finance.files.map(file => <Link key={file.id} className="tf-link rounded-lg border border-zinc-200 px-3 py-2 text-sm break-all" href={`/api/projects/${finance.project.id}/files/${file.id}`}>{file.name}</Link>)}</div><p className="tf-ui-help mt-2">Tài liệu nội bộ của dự án · dùng làm nguồn cho IC.</p></> : <p className="tf-ui-help">Chưa có tài liệu. Tải Brief / PO lên tab Tài liệu của dự án để dùng làm nguồn.</p>}
    <PurchaseOrderVersions finance={finance} canCreate={canCreate} />
  </Panel>;
}
