import Link from "next/link";
import { CircleDollarSign, FolderOpen, LayoutGrid, ReceiptText, Radio } from "lucide-react";

export default function ProjectTabs({ projectId, active, fileCount = 0, showFinance = false }: {
  projectId: string;
  active: "costflow" | "tasks" | "finance" | "files" | "webhook";
  fileCount?: number;
  showFinance?: boolean;
}) {
  const tabs = [
    { id: "costflow", label: "CostFlow", href: `/projects/${projectId}/costflow`, icon: ReceiptText },
    { id: "tasks", label: "Task", href: `/projects/${projectId}`, icon: LayoutGrid },
    ...(showFinance
      ? [{ id: "finance", label: "Tài chính", href: `/projects/${projectId}?tab=finance`, icon: CircleDollarSign }]
      : []),
    { id: "files", label: "Tài liệu", href: `/projects/${projectId}?tab=files`, icon: FolderOpen },
    { id: "webhook", label: "Google Chat", href: `/projects/${projectId}?tab=webhook`, icon: Radio },
  ];
  return <nav className="tf-project-tabs" aria-label="Project tabs">{tabs.map(({ id, label, href, icon: Icon }) =>
    <Link key={id} href={href} aria-current={active === id ? "page" : undefined} className={active === id ? "is-active" : ""}>
      <Icon size={16} aria-hidden="true" />{label}{id === "files" && fileCount > 0 && <span className="tf-tab-count">{fileCount}</span>}
    </Link>
  )}</nav>;
}
