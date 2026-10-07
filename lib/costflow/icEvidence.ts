import type { IcLine, IcEvidenceSupplement, RequestPayload } from "./types";

export class IcEvidenceError extends Error {
  constructor(public lineErrors: { lineId: string; message: string }[]) {
    super("Mỗi dòng IC cần minh chứng hoặc lý do chưa có minh chứng.");
  }
}
export function validateIcEvidence(lines: IcLine[]) {
  const errors = lines.filter(line => !line.evidenceIds?.length && !line.evidenceReason?.trim()).map(line => ({ lineId: line.id, message: `${line.description || "Dòng chưa đặt tên"}: thêm minh chứng hoặc nhập lý do.` }));
  if (errors.length) throw new IcEvidenceError(errors);
}
export function requestEvidenceIds(requests: { id: string; payload: unknown }[], supplements: IcEvidenceSupplement[]) {
  const requestIds = new Set(requests.map(r => r.id));
  return [...new Set([...requests.flatMap(r => { const p = r.payload as RequestPayload; return [...(p.evidenceIds ?? []), ...(p.lines ?? []).flatMap(l => l.evidenceIds ?? [])]; }), ...supplements.filter(s => requestIds.has(s.requestId)).flatMap(s => s.evidenceIds)])];
}
export function previewMime(mime: string, bytes: Uint8Array) {
  if (mime === "application/pdf" && Buffer.from(bytes.slice(0, 5)).toString() === "%PDF-") return mime;
  if (mime === "image/png" && Buffer.from(bytes.slice(0, 8)).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return mime;
  if (mime === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return mime;
  return null;
}
