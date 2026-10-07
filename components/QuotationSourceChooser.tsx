"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Files, LayoutTemplate } from "lucide-react";
import { costFlowAction } from "@/app/actions/costflow";
import type { QuotationReuseCatalogItem } from "@/lib/costflow/quotationReuse";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Alert, Badge, EmptyState, Panel } from "@/components/ui/Presentation";

export default function QuotationSourceChooser({ projectId, version, items }: { projectId: string; version: number; items: QuotationReuseCatalogItem[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"ALL" | "TEMPLATE" | "HISTORICAL_QUOTATION">("ALL");
  const [pending, startTransition] = useTransition();
  const [activeKey, setActiveKey] = useState("");
  const [error, setError] = useState("");
  const normalized = query.trim().toLocaleLowerCase("vi");
  const visible = useMemo(() => items.filter(item => {
    if (filter !== "ALL" && item.kind !== filter) return false;
    if (!normalized) return true;
    return [item.title, item.projectName, item.customer, item.description].some(value => value?.toLocaleLowerCase("vi").includes(normalized));
  }).slice(0, 60), [filter, items, normalized]);

  const create = (item: QuotationReuseCatalogItem, mode: "quote" | "paired") => {
    setError("");
    setActiveKey(`${item.kind}:${item.id}:${mode}`);
    startTransition(async () => {
      const form = new FormData();
      form.set("projectId", projectId);
      form.set("version", String(version));
      form.set("command", "CREATE_REUSE_DRAFT");
      form.set("reuseKind", item.kind);
      form.set("reuseSourceId", item.id);
      form.set("sourceProjectId", item.sourceProjectId ?? "");
      form.set("workspaceMode", mode);
      const result = await costFlowAction({}, form);
      if (result.error || !result.draftId) {
        setError(result.error ?? "Không tạo được nháp từ nguồn đã chọn.");
        return;
      }
      const route = mode === "paired" ? `/projects/${projectId}/costflow/paired` : `/projects/${projectId}/costflow/quotations/new`;
      router.push(`${route}?draftId=${encodeURIComponent(result.draftId)}`);
    });
  };

  return <div className="space-y-5">
    <div className="tf-section-heading"><div><p className="tf-paired-eyebrow">Scope / Báo giá</p><h1 className="tf-module-title">Bạn muốn bắt đầu thế nào?</h1><p className="tf-ui-help">Tạo trống hoặc dùng lại nội dung bán từ một nguồn đã chốt. IC và dữ liệu nội bộ không được sao chép.</p></div></div>
    <div className="tf-quotation-source-start-grid">
      <Panel><FilePlus2 size={22} aria-hidden="true" /><h2>Bắt đầu trống</h2><p className="tf-ui-help">Tạo Báo giá độc lập hoặc nhập giá bán và giá vốn song song ngay từ đầu.</p><div className="tf-quotation-source-actions"><Link className="tf-button-secondary" href={`/projects/${projectId}/costflow/quotations/new?start=blank`}>Tạo Báo giá</Link><Link className="tf-button-primary" href={`/projects/${projectId}/costflow/paired`}>Soạn Báo giá &amp; IC</Link></div></Panel>
      <Panel><LayoutTemplate size={22} aria-hidden="true" /><h2>Dùng template</h2><p className="tf-ui-help">Mẫu độc lập do Admin đã công bố.</p><button className="tf-link" type="button" onClick={() => setFilter("TEMPLATE")}>Xem template</button></Panel>
      <Panel><Files size={22} aria-hidden="true" /><h2>Dùng báo giá cũ</h2><p className="tf-ui-help">Bản đã chốt từ project khác mà bạn có quyền xem.</p><button className="tf-link" type="button" onClick={() => setFilter("HISTORICAL_QUOTATION")}>Xem báo giá cũ</button></Panel>
    </div>
    <Panel>
      <div className="tf-quotation-source-filters"><Input label="Tìm nguồn" placeholder="Tên báo giá, project hoặc khách hàng" value={query} onChange={event => setQuery(event.target.value)} /><Select label="Loại nguồn" value={filter} onChange={event => setFilter(event.target.value as typeof filter)}><option value="ALL">Tất cả</option><option value="TEMPLATE">Template</option><option value="HISTORICAL_QUOTATION">Báo giá cũ</option></Select></div>
      {error && <Alert tone="danger" title={error} className="mt-4" />}
      {visible.length ? <div className="tf-quotation-source-list">{visible.map(item => {
        const key = `${item.kind}:${item.id}`;
        return <article key={key} className="tf-quotation-source-row">
          <div><div className="flex flex-wrap items-center gap-2"><h3>{item.title}</h3><Badge tone={item.kind === "TEMPLATE" ? "info" : "neutral"}>{item.kind === "TEMPLATE" ? "Template" : "Báo giá cũ"}</Badge></div><p className="tf-ui-help">{item.kind === "TEMPLATE" ? item.description || "Mẫu dùng chung của công ty" : `${item.projectName} · ${item.customer || "Chưa có khách hàng"}`} · {new Intl.DateTimeFormat("vi-VN").format(new Date(item.createdAt))}</p></div>
          <div className="tf-quotation-source-actions"><Button size="sm" variant="secondary" disabled={pending} loading={pending && activeKey === `${key}:quote`} onClick={() => create(item, "quote")}>Tạo báo giá</Button><Button size="sm" disabled={pending} loading={pending && activeKey === `${key}:paired`} onClick={() => create(item, "paired")}>Tạo Báo giá &amp; IC</Button></div>
        </article>;
      })}</div> : <EmptyState title="Không có nguồn phù hợp" description="Đổi từ khóa/bộ lọc hoặc tạo báo giá trống." />}
    </Panel>
  </div>;
}
