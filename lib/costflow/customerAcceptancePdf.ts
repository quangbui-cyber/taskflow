import "server-only";

import { readFileSync } from "node:fs";
import { customerAcceptanceArtifactRows, customerAcceptanceProjectionHash, type CustomerAcceptanceProjection } from "./customerAcceptanceProjection";

type FontMetrics = { glyph: (code: number) => number; width: (glyph: number) => number; unitsPerEm: number; bbox: [number, number, number, number]; ascent: number; descent: number };

function table(font: Buffer, name: string) {
  const count = font.readUInt16BE(4);
  for (let index = 0; index < count; index++) {
    const offset = 12 + index * 16;
    if (font.toString("ascii", offset, offset + 4) === name) return { offset: font.readUInt32BE(offset + 8), length: font.readUInt32BE(offset + 12) };
  }
  throw new Error(`Font thiếu bảng ${name}.`);
}

function fontMetrics(font: Buffer): FontMetrics {
  const cmap = table(font, "cmap").offset;
  const records = font.readUInt16BE(cmap + 2);
  let format4 = -1;
  for (let index = 0; index < records; index++) {
    const record = cmap + 4 + index * 8;
    const platform = font.readUInt16BE(record);
    const encoding = font.readUInt16BE(record + 2);
    const offset = cmap + font.readUInt32BE(record + 4);
    if (font.readUInt16BE(offset) === 4 && platform === 3 && encoding === 1) format4 = offset;
  }
  if (format4 < 0) throw new Error("Font không có Unicode cmap format 4.");
  const segmentCount = font.readUInt16BE(format4 + 6) / 2;
  const endCodes = format4 + 14;
  const startCodes = endCodes + segmentCount * 2 + 2;
  const deltas = startCodes + segmentCount * 2;
  const ranges = deltas + segmentCount * 2;
  const glyph = (code: number) => {
    for (let index = 0; index < segmentCount; index++) {
      const end = font.readUInt16BE(endCodes + index * 2);
      if (code > end) continue;
      const start = font.readUInt16BE(startCodes + index * 2);
      if (code < start) return 0;
      const delta = font.readInt16BE(deltas + index * 2);
      const range = font.readUInt16BE(ranges + index * 2);
      if (!range) return (code + delta) & 0xffff;
      const glyphOffset = ranges + index * 2 + range + (code - start) * 2;
      if (glyphOffset + 2 > font.length) return 0;
      const mapped = font.readUInt16BE(glyphOffset);
      return mapped ? (mapped + delta) & 0xffff : 0;
    }
    return 0;
  };
  const head = table(font, "head").offset;
  const hhea = table(font, "hhea").offset;
  const hmtx = table(font, "hmtx").offset;
  const metricCount = font.readUInt16BE(hhea + 34);
  return {
    glyph,
    width: (glyphId: number) => font.readUInt16BE(hmtx + Math.min(glyphId, metricCount - 1) * 4),
    unitsPerEm: font.readUInt16BE(head + 18),
    bbox: [font.readInt16BE(head + 36), font.readInt16BE(head + 38), font.readInt16BE(head + 40), font.readInt16BE(head + 42)],
    ascent: font.readInt16BE(hhea + 4),
    descent: font.readInt16BE(hhea + 6),
  };
}

function stream(bytes: Buffer, extra = "") {
  return Buffer.concat([Buffer.from(`<< /Length ${bytes.length}${extra ? ` ${extra}` : ""} >>\nstream\n`), bytes, Buffer.from("\nendstream")]);
}

function utf16Hex(value: string) {
  const codes: string[] = [];
  for (const character of value) {
    const code = character.codePointAt(0) ?? 32;
    codes.push((code <= 0xffff ? code : 0x003f).toString(16).padStart(4, "0"));
  }
  return codes.join("").toUpperCase();
}

function scale(value: number, unitsPerEm: number) {
  return Math.round(value * 1000 / unitsPerEm);
}

function toUnicode(codes: number[]) {
  const mappings = codes.map(code => `<${code.toString(16).padStart(4, "0").toUpperCase()}> <${code.toString(16).padStart(4, "0").toUpperCase()}>`);
  const chunks: string[] = [];
  for (let index = 0; index < mappings.length; index += 100) {
    const chunk = mappings.slice(index, index + 100);
    chunks.push(`${chunk.length} beginbfchar\n${chunk.join("\n")}\nendbfchar`);
  }
  return Buffer.from(`/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /CustomerAcceptanceUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${chunks.join("\n")}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`);
}

function pdf(objects: Buffer[], rootId: number, infoId: number) {
  const header = Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", "binary");
  const chunks = [header];
  const offsets = [0];
  let offset = header.length;
  for (let index = 0; index < objects.length; index++) {
    offsets.push(offset);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), objects[index], Buffer.from("\nendobj\n")]);
    chunks.push(chunk);
    offset += chunk.length;
  }
  const xref = offset;
  const rows = offsets.slice(1).map(value => `${value.toString().padStart(10, "0")} 00000 n \n`).join("");
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${rows}trailer\n<< /Size ${objects.length + 1} /Root ${rootId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return Buffer.concat(chunks);
}

export function customerAcceptancePdfRows(projection: CustomerAcceptanceProjection) {
  return customerAcceptanceArtifactRows(projection);
}

export function customerAcceptancePdf(projection: CustomerAcceptanceProjection) {
  const artifactRows = customerAcceptancePdfRows(projection);
  const items = artifactRows.slice(4, -2);
  const pages: string[][][] = [];
  for (let index = 0; index < items.length || index === 0; index += 5) pages.push(items.slice(index, index + 5));
  const allText = artifactRows.flat().join("\n") + "ĐVT Hợp đồng Thực tế Chênh lệch Đơn giá bán NET VAT GROSS Trang Phiên bản : . × / , 0123456789";
  const codes = [...new Set([...allText].map(character => character.codePointAt(0) ?? 32).filter(code => code <= 0xffff))].sort((a, b) => a - b);
  const font = readFileSync(new URL("../../node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf", import.meta.url));
  const metrics = fontMetrics(font);
  const cidMap = Buffer.alloc((Math.max(...codes, 0) + 1) * 2);
  for (const code of codes) cidMap.writeUInt16BE(metrics.glyph(code), code * 2);
  const widths = codes.map(code => `${code} [${scale(metrics.width(metrics.glyph(code)), metrics.unitsPerEm)}]`).join(" ");

  const objects: Buffer[] = [];
  const reserve = () => { objects.push(Buffer.alloc(0)); return objects.length; };
  const add = (value: Buffer | string) => { objects.push(typeof value === "string" ? Buffer.from(value) : value); return objects.length; };
  const set = (id: number, value: Buffer | string) => { objects[id - 1] = typeof value === "string" ? Buffer.from(value) : value; };
  const catalogId = reserve();
  const pagesId = reserve();
  const fontFileId = add(stream(font, `/Length1 ${font.length}`));
  const descriptorId = add(`<< /Type /FontDescriptor /FontName /Geist /Flags 32 /FontBBox [${metrics.bbox.map(value => scale(value, metrics.unitsPerEm)).join(" ")}] /ItalicAngle 0 /Ascent ${scale(metrics.ascent, metrics.unitsPerEm)} /Descent ${scale(metrics.descent, metrics.unitsPerEm)} /CapHeight ${scale(metrics.ascent, metrics.unitsPerEm)} /StemV 80 /FontFile2 ${fontFileId} 0 R >>`);
  const cidMapId = add(stream(cidMap));
  const unicodeId = add(stream(toUnicode(codes)));
  const cidFontId = add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Geist /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptorId} 0 R /DW 500 /W [${widths}] /CIDToGIDMap ${cidMapId} 0 R >>`);
  const type0Id = add(`<< /Type /Font /Subtype /Type0 /BaseFont /Geist /Encoding /Identity-H /DescendantFonts [${cidFontId} 0 R] /ToUnicode ${unicodeId} 0 R >>`);
  const pageIds: number[] = [];
  for (const [pageIndex, pageItems] of pages.entries()) {
    const commands: string[] = [];
    const draw = (value: string, x: number, y: number, size = 10) => commands.push(`BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm <${utf16Hex(value)}> Tj ET`);
    const rule = (y: number) => commands.push(`0.82 G 36 ${y} m 806 ${y} l S 0 G`);
    draw(artifactRows[0][0], 36, 548, 17);
    draw(`${artifactRows[1][0]}: ${artifactRows[1][1]}     ${artifactRows[1][2]}: ${artifactRows[1][3]}`, 36, 521, 10);
    draw(`${artifactRows[2][0]}: ${artifactRows[2][1]}     Phiên bản: ${artifactRows[2][3]}`, 36, 503, 10);
    rule(490);
    for (const [itemIndex, row] of pageItems.entries()) {
      const y = 468 - itemIndex * 76;
      draw(`${row[0]}. ${row[1]}`, 42, y, 11);
      draw(`ĐVT: ${row[2]}     Hợp đồng: ${row[3]} × ${row[4]} ngày     Thực tế: ${row[5]} × ${row[6]} ngày`, 42, y - 19, 9);
      draw(`Chênh lệch: ${row[7]} SL, ${row[8]} ngày     Đơn giá bán: ${row[9]}     NET: ${row[10]}     VAT: ${row[11]}     GROSS: ${row[12]}`, 42, y - 37, 9);
      rule(y - 50);
    }
    if (pageIndex === pages.length - 1) {
      const total = artifactRows.at(-2) ?? [];
      draw(`TỔNG CỘNG     NET: ${total[10]}     VAT: ${total[11]}     GROSS: ${total[12]}`, 42, 75, 11);
      const signatures = artifactRows.at(-1) ?? [];
      draw(`${signatures[0]}                                      ${signatures[7]}`, 42, 48, 9);
    }
    draw(`Trang ${pageIndex + 1}/${pages.length}`, 756, 25, 8);
    const contentId = add(stream(Buffer.from(commands.join("\n"))));
    const pageId = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 ${type0Id} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }
  set(pagesId, `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] >>`);
  set(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const hash = customerAcceptanceProjectionHash(projection);
  const infoId = add(`<< /Title <${utf16Hex(`Nghiệm thu ${projection.project.name} v${projection.document.snapshotVersion}`)}> /Subject (${hash}) /Producer (TaskFlow CostFlow) >>`);
  return pdf(objects, catalogId, infoId);
}
