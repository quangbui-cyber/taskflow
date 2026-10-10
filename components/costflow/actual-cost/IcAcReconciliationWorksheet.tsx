"use client";

import { useState } from "react";
import { Badge, Table } from "@/components/ui/Presentation";
import { displayMoney } from "@/lib/costflow/money";
import type { ActualCostControlCenter } from "@/lib/costflow/actualCostControlCenter";

type Center = ActualCostControlCenter;
type Group = Center["worksheet"]["groups"][number];

const signed = (value: string) => value === "0" ? displayMoney(value) : `${value.startsWith("-") ? "" : "+"}${displayMoney(value)}`;
const status = (value: Group["status"]) => value === "OVER_BUDGET" ? "Vượt IC" : value === "SAVING" ? "Tiết kiệm" : "Đúng IC";

function MoneyStack({ net, vat, gross }: { net: string; vat: string; gross: string }) {
  return <span className="tf-ac-money-stack"><span>NET {displayMoney(net)}</span><span>VAT {displayMoney(vat)}</span><strong>GROSS {displayMoney(gross)}</strong></span>;
}

export default function IcAcReconciliationWorksheet({ center }: { center: Center }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(center.worksheet.groups.map(group => group.key)));
  const toggle = (key: string) => setExpanded(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  return <section className="space-y-3" aria-labelledby="ic-ac-worksheet-heading">
    <div className="tf-section-heading"><div><h3 id="ic-ac-worksheet-heading">Worksheet đối chiếu IC ↔ Actual Cost</h3><p>Mỗi dòng IC là một nhóm; các lần phát sinh AC nằm bên dưới và không cộng số lượng khác đơn vị.</p></div><Badge>{center.worksheet.groups.length} nhóm IC</Badge></div>
    <div className="tf-ac-control-desktop"><Table caption="Worksheet IC và Actual Cost theo từng lần phát sinh" className="tf-ac-control-table"><thead><tr><th scope="col">Hạng mục</th><th scope="col">Nguồn</th><th scope="col">SL</th><th scope="col">Ngày</th><th scope="col">ĐVT</th><th scope="col">Đơn giá</th><th scope="col">NET / VAT / GROSS</th><th scope="col">Chênh lệch</th><th scope="col">Duyệt · chứng từ · tiền</th></tr></thead><tbody>{center.worksheet.groups.map(group => <GroupRows key={group.key} group={group} open={expanded.has(group.key)} onToggle={() => toggle(group.key)} />)}</tbody><tfoot><tr><th scope="row" colSpan={6}>Tổng tiền VND</th><td><MoneyStack {...center.worksheet.totals.actual} /></td><td>{signed(center.worksheet.totals.variance.gross)}</td><td>Không suy ra trạng thái duyệt hoặc tiền từ tổng.</td></tr></tfoot></Table></div>
    <div className="tf-ac-control-mobile" aria-label="Worksheet IC và Actual Cost dạng thẻ">{center.worksheet.groups.map(group => <details key={group.key} open><summary><span>{group.description}</span><Badge tone={group.status === "OVER_BUDGET" ? "danger" : group.status === "SAVING" ? "success" : "neutral"}>{status(group.status)}</Badge></summary><div className="space-y-3 p-3"><article className="tf-ac-card"><h4>IC baseline</h4><dl><div><dt>SL × ngày</dt><dd>{group.ic ? `${group.ic.quantity} × ${group.ic.days}` : "—"}</dd></div><div><dt>ĐVT · đơn giá</dt><dd>{group.unit || "—"} · {group.ic ? displayMoney(group.ic.unitPrice) : "—"}</dd></div><div><dt>NET / VAT / GROSS</dt><dd>{group.ic ? `${displayMoney(group.ic.cost.net)} / ${displayMoney(group.ic.cost.vat)} / ${displayMoney(group.ic.cost.gross)}` : "—"}</dd></div></dl></article>{group.occurrences.map(item => <article key={item.id} className="tf-ac-card"><h4>{item.description}</h4><p>{item.sourceKind === "UNBUDGETED" ? "[Phát sinh ngoài IC]" : "Một lần phát sinh AC"}</p><dl><div><dt>SL × ngày</dt><dd>{item.quantity ?? "—"} × {item.days ?? "—"}</dd></div><div><dt>ĐVT · đơn giá</dt><dd>{item.unit || "—"} · {item.unitPrice ? displayMoney(item.unitPrice) : "—"}</dd></div><div><dt>NET / VAT / GROSS</dt><dd>{item.cost ? `${displayMoney(item.cost.net)} / ${displayMoney(item.cost.vat)} / ${displayMoney(item.cost.gross)}` : "—"}</dd></div><div><dt>Trạng thái</dt><dd>{item.reviewState} · {item.missingEvidenceWarnings.length ? `${item.missingEvidenceWarnings.length} cảnh báo chứng từ` : "đủ chứng từ cốt lõi"}</dd></div></dl></article>)}</div></details>)}</div>
    {center.worksheet.unbudgeted.length > 0 && <div className="tf-ac-unbudgeted"><h4>[Phát sinh ngoài IC]</h4><p>{center.worksheet.unbudgeted.length} khoản không có baseline IC, được giữ riêng để kiểm toán và quyết định billable.</p></div>}
  </section>;
}

function GroupRows({ group, open, onToggle }: { group: Group; open: boolean; onToggle: () => void }) {
  return <><tr className="tf-ac-control-group"><th scope="row"><button type="button" aria-expanded={open} onClick={onToggle}>{open ? "▾" : "▸"} {group.description}</button></th><td>IC baseline</td><td>{group.ic?.quantity ?? "—"}</td><td>{group.ic?.days ?? "—"}</td><td>{group.unit || "—"}</td><td className="tf-ui-number">{group.ic ? displayMoney(group.ic.unitPrice) : "—"}</td><td><MoneyStack {...(group.ic?.cost ?? { net: "0", vat: "0", gross: "0" })} /></td><td className="tf-ui-number"><Badge tone={group.status === "OVER_BUDGET" ? "danger" : group.status === "SAVING" ? "success" : "neutral"}>{status(group.status)}</Badge><span className="block">{signed(group.variance.gross)}</span></td><td>{group.occurrences.length} lần phát sinh</td></tr>{open && group.occurrences.map((item, index) => <tr key={item.id}><th scope="row" className="tf-ac-control-occurrence"><span>↳ AC #{index + 1}</span>{item.description}</th><td>{item.sourceKind === "UNBUDGETED" ? "Ngoài IC" : item.fundingSource ?? "AC"}</td><td>{item.quantity ?? "—"}</td><td>{item.days ?? "—"}</td><td>{item.unit || "—"}</td><td className="tf-ui-number">{item.unitPrice ? displayMoney(item.unitPrice) : "—"}</td><td>{item.cost ? <MoneyStack {...item.cost} /> : "—"}</td><td className="tf-ui-number">—</td><td><span>{item.reviewState}</span><span className="block text-xs">{item.missingEvidenceWarnings.length ? `${item.missingEvidenceWarnings.length} cảnh báo chứng từ` : "Đủ chứng từ cốt lõi"} · {item.lockedByApplications ? "Đã vào hồ sơ chi" : "Chưa khóa"}</span></td></tr>)}</>;
}
