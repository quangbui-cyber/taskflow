"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Presentation";
import type { ExcelMappingProposal, MappableField, ReviewedExcelMapping } from "@/lib/ai/excel/mapping";

export type MappingSheetView = { token: string; name: string; range: string; firstRow: number; lastRow: number;
  firstColumn: number; lastColumn: number; hiddenRows: number[]; hiddenColumns: number[]; observations: string[];
  cells: { row: number; column: number; address: string; value: string | null; formula: boolean }[] };
export type MappingStage = { state: "MANUAL_MAPPING"; fingerprint: string; manualSheets: MappingSheetView[];
  inventory: { policyVersion: string; tokenCounts: Record<string, number> }; knownError: string;
  suggestion: { status: "PROPOSED" | "MANUAL_MAPPING"; proposal: ExcelMappingProposal | null; tier: string; runId?: string | null };
  priorMappings: { id: string; label: string; adapterVersion: string; proposal: ExcelMappingProposal; createdAt: string; requiresReview: true }[] };

const fields: { key: MappableField; label: string; critical?: boolean }[] = [
  { key: "name", label: "Hạng mục" }, { key: "description", label: "Mô tả" },
  { key: "sell.unit", label: "ĐVT bán" }, { key: "sell.quantity", label: "Số lượng bán", critical: true },
  { key: "sell.days", label: "Số ngày bán", critical: true }, { key: "sell.unitPrice", label: "Đơn giá bán", critical: true },
  { key: "sell.vatPercent", label: "VAT bán", critical: true }, { key: "sell.basis", label: "Cơ sở giá bán" },
  { key: "sell.note", label: "Ghi chú bán" }, { key: "buy.unit", label: "ĐVT mua" },
  { key: "buy.quantity", label: "Số lượng mua", critical: true }, { key: "buy.days", label: "Số ngày mua", critical: true },
  { key: "buy.unitPrice", label: "Đơn giá mua", critical: true }, { key: "buy.vatPercent", label: "VAT mua", critical: true },
  { key: "buy.basis", label: "Cơ sở giá mua" }, { key: "buy.supplier", label: "Nhà cung cấp" },
  { key: "buy.note", label: "Ghi chú mua" },
];
type RowDraft = { row: number; selected: boolean; rowType: "GROUP" | "ITEM"; level: 1 | 2 | 3; parentRow: number | null };
type TableDraft = { sheet: string; range: string; headerRow: number; kind: ExcelMappingProposal["kind"];
  columns: Partial<Record<MappableField, number>>; rows: RowDraft[]; confidence: number };
const address = (row: number, column: number) => { let n = column; let letters = ""; while (n) { n--; letters = String.fromCharCode(65 + n % 26) + letters; n = Math.floor(n / 26); } return `${letters}${row}`; };
const rowReason = (sheet: MappingSheetView, row: number) => {
  if (sheet.hiddenRows.includes(row)) return "Dòng ẩn";
  const values = sheet.cells.filter(cell => cell.row === row).map(cell => (cell.value ?? "").toLowerCase());
  if (values.some(value => /^(tổng|total|subtotal)/.test(value))) return "Dòng tổng";
  if (values.some(value => /^(name|hạng mục|description|mô tả)$/.test(value))) return "Tiêu đề lặp";
  if (values.some(value => /^(note|ghi chú|chú thích)/.test(value))) return "Ghi chú";
  return "Chưa chọn nhập";
};
function makeTable(sheet: MappingSheetView, proposal?: ExcelMappingProposal): TableDraft {
  const selected = new Map(proposal?.rows.map(row => [row.row, row]));
  const headerRow = proposal?.headerRow ?? sheet.firstRow;
  const rows: RowDraft[] = [];
  for (let row = headerRow + 1; row <= sheet.lastRow; row++) {
    if (!sheet.cells.some(cell => cell.row === row)) continue;
    const prior = selected.get(row);
    rows.push({ row, selected: prior ? true : !proposal && rowReason(sheet, row) === "Chưa chọn nhập",
      rowType: prior?.rowType ?? "ITEM", level: prior?.level ?? 1, parentRow: prior?.parentRow ?? null });
  }
  return { sheet: sheet.name, range: proposal?.range ?? sheet.range, headerRow,
    kind: proposal?.kind ?? "PAIRED", columns: { ...proposal?.columns }, rows, confidence: proposal?.confidence ?? 0.6 };
}
function tierText(value: number, manual: boolean) {
  if (manual) return "Ánh xạ thủ công · cần xác nhận";
  return value >= 0.9 ? "AI đề xuất · từ 0,90 · vẫn cần rà soát" : value >= 0.6 ? "AI đề xuất · 0,60–0,89 · bắt buộc xác nhận" : "Dưới 0,60 · chọn thủ công";
}

export default function AiExcelMappingReview({ stage, files, pending, onAnalyze, onApply }:
  { stage: MappingStage; files: { id: string; name: string }[]; pending: boolean;
    onAnalyze: (sourceId: string) => void; onApply: (mapping: ReviewedExcelMapping, sourceId: string) => void }) {
  const [sourceId, setSourceId] = useState("");
  const [tables, setTables] = useState<TableDraft[]>(() => stage.manualSheets.slice(0, 1).map(sheet => makeTable(sheet)));
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [runId, setRunId] = useState<string | undefined>();
  const [adapterId, setAdapterId] = useState<string | undefined>();
  const [manual, setManual] = useState(true);
  const [error, setError] = useState("");
  const choose = (proposal: ExcelMappingProposal, origin: "AI" | "PRIOR", id?: string) => {
    const proposals = [proposal, proposal.additional].filter((item): item is ExcelMappingProposal => Boolean(item));
    setTables(proposals.map(item => makeTable(stage.manualSheets.find(sheet => sheet.name === item.sheet)!, item)));
    setRunId(origin === "AI" ? stage.suggestion.runId ?? undefined : undefined);
    setAdapterId(origin === "PRIOR" ? id : undefined);
    setConfirmed([]); setManual(false); setError("");
  };
  const update = (index: number, change: Partial<TableDraft>) => setTables(current => current.map((table, at) => at === index ? { ...table, ...change } : table));
  const confirmCell = (key: string, checked: boolean) => setConfirmed(current => checked ? [...new Set([...current, key])] : current.filter(item => item !== key));
  const apply = () => {
    if (!tables.length || !tables[0].columns.name) { setError("Chọn sheet và cột Hạng mục trước khi xem trước."); return; }
    const proposals = tables.map(table => ({ sheet: table.sheet, range: table.range, headerRow: table.headerRow,
      kind: table.kind, columns: table.columns, rows: table.rows.filter(row => row.selected).map(({ row, rowType, level, parentRow }) => ({ row, rowType, level, parentRow })), confidence: table.confidence }));
    if (proposals.some(proposal => !proposal.rows.length || !proposal.columns.name)) { setError("Mỗi bảng cần cột Hạng mục và ít nhất một dòng được chọn."); return; }
    if (tables.some(table => {
      const sheet = stage.manualSheets.find(item => item.name === table.sheet)!;
      return table.rows.filter(row => row.selected).some(row => Object.values(table.columns).some(column =>
        sheet.cells.some(cell => cell.row === row.row && cell.column === column && cell.formula)));
    })) { setError("Ô công thức chỉ để tham khảo. Chọn cột hoặc dòng chứa giá trị gốc."); return; }
    const required = tables.flatMap(table => {
      const sheet = stage.manualSheets.find(item => item.name === table.sheet)!;
      return table.rows.filter(row => row.selected).flatMap(row => fields.filter(field => field.critical && table.columns[field.key] !== undefined)
        .map(field => ({ field, cell: sheet.cells.find(cell => cell.row === row.row && cell.column === table.columns[field.key]) }))
        .filter(({ cell }) => cell?.value !== null && cell?.value !== undefined && cell.value !== "")
        .map(({ cell }) => `${sheet.name}!${cell!.address}`));
    });
    if (required.some(key => !confirmed.includes(key))) { setError("Xác nhận từng ô số lượng, ngày, tiền và VAT từ nguồn gốc."); return; }
    if (!manual && !runId && !adapterId) { setError("Chọn lại đề xuất AI hoặc mapping đã dùng."); return; }
    onApply({ ...proposals[0], additional: proposals[1], reviewed: true, confirmedCriticalCells: confirmed,
      runId, adapterId }, sourceId);
  };
  return <section aria-label="Rà soát cấu trúc Excel" className="space-y-4">
    <p className="tf-ui-help">1 workbook · tối đa 2 sheet dữ liệu · tối đa 1 bảng mỗi loại. AI chỉ đề xuất tọa độ; giá trị được đọc lại từ ô nguồn.</p>
    <Alert tone="warning" title="Cần rà soát cấu trúc">{stage.knownError} {stage.suggestion.status !== "PROPOSED" && "AI chưa thể nhận diện cấu trúc. Bạn có thể tiếp tục chọn sheet, vùng dữ liệu, hàng tiêu đề, cột và cấp hạng mục thủ công."}</Alert>
    <label className="block text-sm">Tệp XLSX đã lưu trong Tài liệu dự án
      <select className="tf-field block w-full" value={sourceId} onChange={event => setSourceId(event.target.value)}>
        <option value="">Chọn tệp khớp với XLSX đang xem</option>
        {files.filter(file => /\.xlsx$/i.test(file.name)).map(file => <option key={file.id} value={file.id}>{file.name}</option>)}
      </select>
    </label>
    <div className="tf-ui-actions"><Button variant="secondary" disabled={!sourceId || pending} onClick={() => onAnalyze(sourceId)}>AI nhận diện cấu trúc</Button>
      <Button variant="secondary" disabled={pending} onClick={() => { setTables(stage.manualSheets.slice(0, 1).map(sheet => makeTable(sheet))); setManual(true); setRunId(undefined); setAdapterId(undefined); setConfirmed([]); }}>Thiết lập thủ công</Button></div>
    {stage.suggestion.proposal && <div><p>{tierText(stage.suggestion.proposal.confidence, false)}</p><Button variant="secondary" onClick={() => choose(stage.suggestion.proposal!, "AI")}>Dùng làm đề xuất AI</Button></div>}
    {stage.priorMappings.map(item => <div key={item.id}><p>{item.label} · adapter {item.adapterVersion} · xác nhận {new Date(item.createdAt).toLocaleString("vi-VN")}</p>
      <Button variant="secondary" onClick={() => choose(item.proposal, "PRIOR", item.id)}>Dùng làm đề xuất</Button></div>)}
    {tables.map((table, index) => {
      const sheet = stage.manualSheets.find(item => item.name === table.sheet)!;
      return <fieldset key={index} className="rounded-lg border border-[var(--border)] p-3 space-y-3"><legend>Bảng {index + 1} · {tierText(table.confidence, manual)}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>Sheet<select className="tf-field block w-full" value={table.sheet} onChange={event => { const next = stage.manualSheets.find(item => item.name === event.target.value)!; update(index, makeTable(next)); }}>
            {stage.manualSheets.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
          <label>Loại bảng<select className="tf-field block w-full" value={table.kind} onChange={event => update(index, { kind: event.target.value as TableDraft["kind"] })}><option value="PAIRED">Báo giá + IC</option><option value="QUOTATION">Báo giá</option><option value="IC">IC</option></select></label>
          <label>Vùng dữ liệu<input className="tf-field block w-full" value={table.range} onChange={event => update(index, { range: event.target.value })} /></label>
          <label>Hàng tiêu đề<input className="tf-field block w-full" type="number" min={sheet.firstRow} max={sheet.lastRow} value={table.headerRow} onChange={event => update(index, { headerRow: Number(event.target.value) })} /></label>
        </div>
        <div className="overflow-x-auto"><table className="ai-excel-mapping-table w-full text-sm"><caption className="text-left">Ô nguồn → trường CostFlow · {tierText(table.confidence, manual)}</caption><thead><tr><th scope="col">Trường CostFlow</th><th scope="col">Cột nguồn</th><th scope="col">Ô nguồn và xác nhận</th></tr></thead><tbody>{fields.map(field => {
          const column = table.columns[field.key];
          const sourceCells = column === undefined ? [] : table.rows.filter(row => row.selected).map(row =>
            sheet.cells.find(cell => cell.row === row.row && cell.column === column)).filter((cell): cell is MappingSheetView["cells"][number] => Boolean(cell));
          return <tr key={field.key}><th scope="row">{field.label}{field.critical && " · Bắt buộc xác nhận"}</th><td data-label="Cột nguồn"><label className="sr-only" htmlFor={`mapping-${index}-${field.key}`}>Cột nguồn cho {field.label}</label>
            <select id={`mapping-${index}-${field.key}`} className="tf-field" value={column ?? ""} onChange={event => update(index, { columns: { ...table.columns, [field.key]: event.target.value ? Number(event.target.value) : undefined } })}>
              <option value="">Chưa ánh xạ</option>{Array.from({ length: sheet.lastColumn - sheet.firstColumn + 1 }, (_, offset) => sheet.firstColumn + offset).filter(value => !sheet.hiddenColumns.includes(value)).map(value => <option key={value} value={value}>{address(table.headerRow, value)}</option>)}
            </select></td><td data-label="Ô nguồn và xác nhận"><div className="space-y-1">{sourceCells.length ? sourceCells.map(cell => {
              const key = `${sheet.name}!${cell.address}`;
              return <div key={key}>{field.critical && cell.value !== null && cell.value !== "" && !cell.formula ?
                <label className="block"><input type="checkbox" checked={confirmed.includes(key)} onChange={event => confirmCell(key, event.target.checked)} /> {key} · {cell.value} · Bắt buộc xác nhận</label> :
                <span>{key} · {cell.formula ? "Công thức (chỉ tham khảo)" : cell.value ?? "Trống"}</span>}</div>;
            }) : "—"}</div></td></tr>;
        })}</tbody></table></div>
        <div className="space-y-2"><h3 className="font-semibold">Dòng và cấp hạng mục</h3>{table.rows.map(row => <div key={row.row} className="grid gap-2 rounded border border-[var(--border)] p-2 sm:grid-cols-5">
          <label><input type="checkbox" checked={row.selected} disabled={sheet.hiddenRows.includes(row.row)} onChange={event => update(index, { rows: table.rows.map(item => item.row === row.row ? { ...item, selected: event.target.checked } : item) })} /> Nhập dòng {row.row}</label>
          <span>{sheet.name}!{row.row} · {sheet.cells.filter(cell => cell.row === row.row).slice(0, 3).map(cell => `${cell.address}: ${cell.formula ? "Công thức" : cell.value ?? ""}`).join(" · ")}</span>
          <label>Loại<select className="tf-field" value={row.rowType} onChange={event => update(index, { rows: table.rows.map(item => item.row === row.row ? { ...item, rowType: event.target.value as RowDraft["rowType"] } : item) })}><option value="ITEM">ITEM</option><option value="GROUP">GROUP</option></select></label>
          <label>Cấp<select className="tf-field" value={row.level} onChange={event => update(index, { rows: table.rows.map(item => item.row === row.row ? { ...item, level: Number(event.target.value) as RowDraft["level"] } : item) })}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></label>
          <label>Dòng cha<input className="tf-field" type="number" value={row.parentRow ?? ""} onChange={event => update(index, { rows: table.rows.map(item => item.row === row.row ? { ...item, parentRow: event.target.value ? Number(event.target.value) : null } : item) })} /></label>
          {!row.selected && <span className="sm:col-span-5">Chưa nhập: {rowReason(sheet, row.row)} · {sheet.name}!{row.row}</span>}
        </div>)}</div>
        <p className="tf-ui-help">Xác nhận ô trọng yếu · Lấy nguyên từ ô nguồn. Ô công thức chỉ để tham khảo và không thể nhập.</p>
      </fieldset>;
    })}
    {stage.manualSheets.length > 1 && tables.length === 1 && <Button variant="secondary" onClick={() => setTables(current => [...current, makeTable(stage.manualSheets.find(sheet => sheet.name !== current[0].sheet)!)])}>Thêm bảng thứ hai</Button>}
    {tables.length > 1 && <Button variant="secondary" onClick={() => setTables(current => current.slice(0, 1))}>Bỏ bảng thứ hai</Button>}
    <section aria-label="Dòng cột chưa nhập" className="rounded border border-[var(--border)] p-3"><h3 className="font-semibold">Dòng/cột chưa nhập</h3><ul className="list-disc pl-5">
      {stage.manualSheets.flatMap(sheet => sheet.observations.map(note => `${sheet.name}: ${note}`)).map((note, index) => <li key={index}>{note} · Công thức/cached value chỉ để tham khảo, không phải giá trị nhập.</li>)}
      {tables.flatMap(table => { const sheet = stage.manualSheets.find(item => item.name === table.sheet)!; return table.rows.filter(row => !row.selected).map(row => `${sheet.name}!${row.row}: ${rowReason(sheet, row.row)}`); }).map((note, index) => <li key={`excluded-${index}`}>{note}</li>)}
    </ul></section>
    {error && <Alert tone="danger" title="Cần hoàn thiện ánh xạ">{error}</Alert>}
    <Button onClick={apply} disabled={pending}>Xem trước từ mapping đã rà soát</Button>
  </section>;
}
