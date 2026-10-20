"use client";

import { Alert, Badge, Panel, Table } from "@/components/ui/Presentation";
import { displayMoney } from "@/lib/costflow/money";
import type { ActualCostControlCenter } from "@/lib/costflow/actualCostControlCenter";

export function StaffView({ center }: { center: ActualCostControlCenter }) {
  if (!center.staff.length) return <Alert title="Chưa có khoản tiền liên quan">Không có AC hoặc giao dịch nhân sự trong phạm vi được phép xem.</Alert>;
  return <div className="tf-ac-role-grid">{center.staff.map(person => <Panel key={person.recipientKey} className="space-y-3"><div className="tf-section-heading"><div><h3>{person.recipientLabel}</h3><p>Chỉ số tiền liên quan tới nhân sự này trong Project.</p></div><Badge>{person.occurrenceIds.length} AC</Badge></div><dl className="tf-ac-stat-grid"><div><dt>Tạm ứng đã nhận</dt><dd>{displayMoney(person.advancePaid)}</dd></div><div><dt>Đã dùng từ tạm ứng</dt><dd>{displayMoney(person.advanceFundedActual)}</dd></div><div><dt>Tự chi</dt><dd>{displayMoney(person.outOfPocket)}</dd></div><div><dt>Đã hoàn/chi thêm</dt><dd>{displayMoney(person.reimbursed)}</dd></div><div><dt>Công ty còn phải trả</dt><dd>{displayMoney(person.remainingDue)}</dd></div><div><dt>Nhân sự còn phải hoàn</dt><dd>{displayMoney(person.refundDue)}</dd></div></dl></Panel>)}</div>;
}

export function VendorView({ center }: { center: ActualCostControlCenter }) {
  if (!center.vendors.length) return <Alert title="Chưa có tiến độ NCC">Chưa có AC, hồ sơ hoặc giao dịch NCC trong Project.</Alert>;
  return <div className="space-y-4">{center.vendors.map(vendor => <Panel key={vendor.recipientKey} className="space-y-3"><div className="tf-section-heading"><div><h3>{vendor.recipientLabel}</h3><p>Tiến độ đề nghị và thanh toán NCC; không đồng nghĩa với AC đã duyệt.</p></div><Badge tone={vendor.outstanding === "0" ? "success" : "warning"}>{vendor.progress}</Badge></div><dl className="tf-ac-stat-grid"><div><dt>AC thực tế</dt><dd>{displayMoney(vendor.actual)}</dd></div><div><dt>Đã đề nghị</dt><dd>{displayMoney(vendor.requested)}</dd></div><div><dt>Đã chi</dt><dd>{displayMoney(vendor.paid)}</dd></div><div><dt>Còn chờ chi</dt><dd>{displayMoney(vendor.outstanding)}</dd></div></dl>{vendor.requestStates.length > 0 && <Table caption={`Hồ sơ thanh toán ${vendor.recipientLabel}`} hideCaption><thead><tr><th>Hồ sơ</th><th>Duyệt</th><th>Tiền</th></tr></thead><tbody>{vendor.requestStates.map(request => <tr key={request.requestId}><th scope="row">{request.title}</th><td>{request.approvalState}</td><td>{request.cashProgress}</td></tr>)}</tbody></Table>}{vendor.milestones.length > 0 && <ul className="tf-ac-milestones">{vendor.milestones.map(item => <li key={item.id}><span>{item.title} · hạn {item.dueDate}</span><strong>{displayMoney(item.amount)}</strong></li>)}</ul>}</Panel>)}</div>;
}

export function AuditView({ center }: { center: ActualCostControlCenter }) {
  if (!center.audit.length) return <Alert tone="success" title="Chưa phát hiện bất thường">Các kiểm tra tự động hiện không ghi nhận cờ bất thường.</Alert>;
  return <Table caption="Bất thường và dấu vết kiểm toán" hideCaption><thead><tr><th>Mức độ</th><th>Loại</th><th>Nội dung</th><th>Tham chiếu</th></tr></thead><tbody>{center.audit.map((item, index) => <tr key={`${item.code}:${item.occurrenceId ?? item.requestId ?? item.milestoneId}:${index}`}><td><Badge tone={item.severity}>{item.severity}</Badge></td><td>{item.code}</td><td>{item.label}</td><td>{item.occurrenceId ? <a className="tf-link" href={`#actual-cost-detail-${item.occurrenceId}`}>Mở AC</a> : item.requestId ?? item.milestoneId ?? "—"}</td></tr>)}</tbody></Table>;
}
