import "server-only";

import type { SettlementExportProjection } from "./export";

type SourceProjectionIdentity = {
  family: string;
  sourceKind: string;
  sourceId: string;
  sourceVersion: number;
  approvalAttemptId: string | null;
  approvedSnapshotId: string | null;
  signingState: string | null;
  projectionHash: string;
};

function ascii(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "?");
}

function pdfText(value: unknown) {
  return ascii(value).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

export function renderCostFlowPdf(input: {
  projection: SettlementExportProjection;
  sourceProjection: SourceProjectionIdentity;
  publicVerificationToken?: string;
}) {
  const lines = [
    `COSTFLOW ${input.sourceProjection.family}`,
    `Source ${input.sourceProjection.sourceKind}/${input.sourceProjection.sourceId} version ${input.sourceProjection.sourceVersion}`,
    `Projection SHA-256 ${input.sourceProjection.projectionHash}`,
    `Approval attempt ${input.sourceProjection.approvalAttemptId ?? "UNAVAILABLE"}`,
    `Signing ${input.sourceProjection.signingState ?? "UNAVAILABLE"} snapshot ${input.sourceProjection.approvedSnapshotId ?? "UNSIGNED"}`,
    `NET ${input.projection.totals.net} VAT ${input.projection.totals.vat} GROSS ${input.projection.totals.gross}`,
    ...input.projection.items.slice(0, 24).map((item, index) => `${index + 1}. ${item.description} | ${item.net} | ${item.vat} | ${item.gross}`),
    ...(input.publicVerificationToken ? [`VERIFY /workflow/verify/${input.publicVerificationToken}`] : ["VERIFY UNSIGNED"]),
  ];
  const stream = `BT\n/F1 10 Tf\n50 790 Td\n${lines.map((line, index) => `${index ? "0 -16 Td\n" : ""}(${pdfText(line)}) Tj`).join("\n")}\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n%CostFlow\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "ascii"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "ascii");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /ID [<${input.sourceProjection.projectionHash}><${input.sourceProjection.projectionHash}>] >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, "ascii"));
}
