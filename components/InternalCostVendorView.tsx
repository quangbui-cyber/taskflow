"use client";

import { useMemo, useState } from "react";
import { Input, Select } from "@/components/ui/Field";
import { Badge, EmptyState, Panel, Table } from "@/components/ui/Presentation";
import { displayMoney, totals } from "@/lib/costflow/money";
import {
  filterAndSortIcVendorLines,
  groupIcLinesByVendor,
  icVendorShare,
  type IcVendorLineFilter,
  type IcVendorLineSort,
} from "@/lib/costflow/icVendorView";
import type { IcLine } from "@/lib/costflow/types";

type Props = {
  revisionNumber: number;
  lines: IcLine[];
  vendors: { id: string; name: string }[];
};

type SortMode = "GROSS_DESC" | "NAME_ASC" | "ITEMS_DESC";

const groupKey = (vendorId: string | null) => vendorId ?? "UNASSIGNED";

export default function InternalCostVendorView({ revisionNumber, lines, vendors }: Props) {
  const groups = useMemo(() => groupIcLinesByVendor(lines, vendors), [lines, vendors]);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("GROSS_DESC");
  const [selectedKey, setSelectedKey] = useState("");
  const [itemQuery, setItemQuery] = useState("");
  const [itemFilter, setItemFilter] = useState<IcVendorLineFilter>("ALL");
  const [itemSort, setItemSort] = useState<IcVendorLineSort>("GROSS_DESC");

  const filteredGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("vi");
    const result = normalizedQuery
      ? groups.filter(group => group.name.toLocaleLowerCase("vi").includes(normalizedQuery)
        || group.lines.some(line => line.description.toLocaleLowerCase("vi").includes(normalizedQuery)))
      : [...groups];

    return result.sort((a, b) => {
      if (sortMode === "NAME_ASC") return a.name.localeCompare(b.name, "vi");
      if (sortMode === "ITEMS_DESC") return b.lines.length - a.lines.length || a.name.localeCompare(b.name, "vi");
      return Number(b.amount.gross) - Number(a.amount.gross) || a.name.localeCompare(b.name, "vi");
    });
  }, [groups, query, sortMode]);

  const selectedGroup = filteredGroups.find(group => groupKey(group.vendorId) === selectedKey) ?? filteredGroups[0];
  const summary = useMemo(() => totals(lines.flatMap(line => line.cost ? [line.cost] : [])), [lines]);
  const unassignedCount = groups.find(group => !group.vendorId)?.lines.length ?? 0;
  const visibleLines = useMemo(() => selectedGroup
    ? filterAndSortIcVendorLines(selectedGroup.lines, itemQuery, itemFilter, itemSort)
    : [], [selectedGroup, itemQuery, itemFilter, itemSort]);
  const selectedShare = selectedGroup ? icVendorShare(selectedGroup.amount.gross, summary.gross) : 0;
  const formatShare = (share: number) => share.toLocaleString("vi-VN", { maximumFractionDigits: 1 });

  if (!groups.length) return <EmptyState title="IC chưa có hạng mục" description="Chưa có chi phí để tổng hợp theo NCC." />;

  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-lg font-semibold">Chi phí IC-R{revisionNumber} theo NCC</h3>
        <p className="text-sm text-[var(--text-secondary)]">Chọn một NCC để xem giá mua và các hạng mục. Đây là dự toán IC, không phải tiền đã chi.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone="neutral">{groups.filter(group => group.vendorId).length} NCC</Badge>
        <Badge tone="info">Tổng Gross {displayMoney(summary.gross)}</Badge>
        {unassignedCount > 0 && <Badge tone="warning">{unassignedCount} hạng mục chưa gắn NCC</Badge>}
      </div>
    </div>

    <Panel className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Tìm NCC hoặc hạng mục"
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Tên NCC, hạng mục mua…"
        />
        <Select label="Sắp xếp NCC" value={sortMode} onChange={event => setSortMode(event.target.value as SortMode)}>
          <option value="GROSS_DESC">Chi phí cao nhất</option>
          <option value="NAME_ASC">Tên NCC A–Z</option>
          <option value="ITEMS_DESC">Nhiều hạng mục nhất</option>
        </Select>
      </div>
      <p className="text-xs text-[var(--text-secondary)]">Đang hiện {filteredGroups.length}/{groups.length} nhóm NCC.</p>
    </Panel>

    {filteredGroups.length === 0 ? (
      <EmptyState title="Không tìm thấy NCC" description="Thử tìm bằng tên NCC hoặc tên hạng mục khác." />
    ) : (
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
        <div className="lg:hidden">
          <Select
            label="NCC đang xem"
            value={groupKey(selectedGroup.vendorId)}
            onChange={event => setSelectedKey(event.target.value)}
          >
            {filteredGroups.map(group => (
              <option key={groupKey(group.vendorId)} value={groupKey(group.vendorId)}>
                {group.name} · {displayMoney(group.amount.gross)}
              </option>
            ))}
          </Select>
        </div>

        <nav className="hidden max-h-[560px] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 lg:block" aria-label="Danh sách NCC trong IC">
          {filteredGroups.map(group => {
            const key = groupKey(group.vendorId);
            const selected = key === groupKey(selectedGroup.vendorId);
            return <button
              key={key}
              type="button"
              aria-current={selected ? "true" : undefined}
              onClick={() => setSelectedKey(key)}
              className={`mb-1 w-full rounded-lg border px-3 py-2.5 text-left transition-colors last:mb-0 ${selected
                ? "border-[var(--primary)] bg-[var(--surface-soft)]"
                : "border-transparent hover:border-[var(--border)] hover:bg-[var(--surface-soft)]"}`}
            >
              <span className="block truncate text-sm font-semibold">{group.name}</span>
              <span className="mt-1 flex items-center justify-between gap-3 text-xs text-[var(--text-secondary)]">
                <span>{group.lines.length} hạng mục</span>
                <strong className="tabular-nums text-[var(--foreground)]">{displayMoney(group.amount.gross)}</strong>
              </span>
              <span className="mt-1 block text-xs text-[var(--text-secondary)]">{formatShare(icVendorShare(group.amount.gross, summary.gross))}% tổng IC</span>
              {group.missingCostCount > 0 && <span className="mt-1 block text-xs text-[var(--warning)]">{group.missingCostCount} dòng chưa đủ giá</span>}
            </button>;
          })}
        </nav>

        <Panel className="min-w-0 space-y-4 self-start lg:sticky lg:top-4">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] pb-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-base font-semibold">{selectedGroup.name}</h4>
                <Badge tone={selectedGroup.vendorId ? "neutral" : "warning"}>{selectedGroup.lines.length} hạng mục</Badge>
                {selectedGroup.missingCostCount > 0 && <Badge tone="warning">Tổng đang tạm tính</Badge>}
              </div>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">Chi tiết giá mua trong revision IC đang xem.</p>
            </div>
            <div className="text-right tabular-nums">
              <span className="block text-xs text-[var(--text-secondary)]">{selectedGroup.missingCostCount ? "Tạm tính Gross" : "Tổng dự toán Gross"}</span>
              <strong className="text-lg">{displayMoney(selectedGroup.amount.gross)}</strong>
              <span className="block text-xs text-[var(--text-secondary)]">{formatShare(selectedShare)}% tổng IC</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm tabular-nums">
            <span>Net: <strong>{displayMoney(selectedGroup.amount.net)}</strong></span>
            <span>VAT: <strong>{displayMoney(selectedGroup.amount.vat)}</strong></span>
            <span>Gross: <strong>{displayMoney(selectedGroup.amount.gross)}</strong></span>
          </div>
          {selectedGroup.missingCostCount > 0 && <p className="text-xs text-[var(--text-secondary)]">Tổng chỉ cộng các dòng đã đủ dữ liệu giá.</p>}

          <div className="grid gap-3 border-t border-[var(--border)] pt-4 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_180px_190px]">
            <Input
              label="Tìm hạng mục trong NCC"
              type="search"
              value={itemQuery}
              onChange={event => setItemQuery(event.target.value)}
              placeholder="Tên hạng mục, đơn vị…"
            />
            <Select label="Lọc hạng mục" value={itemFilter} onChange={event => setItemFilter(event.target.value as IcVendorLineFilter)}>
              <option value="ALL">Tất cả hạng mục</option>
              <option value="MISSING_COST">Chưa đủ giá</option>
            </Select>
            <Select label="Sắp xếp hạng mục" value={itemSort} onChange={event => setItemSort(event.target.value as IcVendorLineSort)}>
              <option value="GROSS_DESC">Gross cao nhất</option>
              <option value="IC_ORDER">Thứ tự trong IC</option>
              <option value="NAME_ASC">Tên A–Z</option>
              <option value="QUANTITY_DESC">Số lượng lớn nhất</option>
            </Select>
          </div>

          <p className="text-xs text-[var(--text-secondary)]">Đang xem {visibleLines.length}/{selectedGroup.lines.length} hạng mục của NCC.</p>

          {visibleLines.length === 0 ? <EmptyState
            title="Không có hạng mục phù hợp"
            description="Đổi từ khóa hoặc bộ lọc để xem các hạng mục khác của NCC này."
          /> : <div className="[&_.tf-ui-table-scroll]:max-h-[52vh] [&_.tf-ui-table-scroll]:min-h-[280px] [&_.tf-ui-table-scroll]:overflow-auto [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10">
            <Table caption={`Hạng mục mua từ ${selectedGroup.name} trong IC-R${revisionNumber}`} hideCaption>
              <thead><tr>
                <th scope="col">Hạng mục mua</th>
                <th scope="col">Khối lượng</th>
                <th scope="col" className="text-right">Đơn giá mua</th>
                <th scope="col" className="text-right">Net</th>
                <th scope="col" className="text-right">Gross</th>
              </tr></thead>
              <tbody>{visibleLines.map(line => <tr key={line.id}>
                <th scope="row">{line.description}</th>
                <td>{line.quantity || "—"} {line.unit}</td>
                <td className="text-right tabular-nums">{line.unitPrice ? displayMoney(line.unitPrice) : "—"}</td>
                <td className="text-right tabular-nums">{line.cost ? displayMoney(line.cost.net) : "—"}</td>
                <td className="text-right tabular-nums">{line.cost ? displayMoney(line.cost.gross) : "Chưa đủ giá"}</td>
              </tr>)}</tbody>
            </Table>
          </div>}
        </Panel>
      </div>
    )}
  </div>;
}
