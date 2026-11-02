import { RECAP_LOGO_HEIGHT, RECAP_LOGO_WIDTH, recapLogoPng } from "@/lib/recapLogo";
import {
  isOpenQuestionSection,
  isRecapPlaceholder,
  isSummarySection,
  parseExportActionLine,
  parseRecapSections,
  type RecapSection,
  type RecapTopicBlock,
} from "@/lib/meetingRecap";

/**
 * Xuất biên bản họp thành file Word (.docx) tối giản, không cần thư viện ngoài:
 * .docx là file zip (ở đây không nén) chứa vài file XML theo chuẩn Office Open XML.
 */

export const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type RecapDocxInput = {
  title: string;
  when: string;
  room: string | null;
  organizer: string;
  attendees: string[];
  content: string;
  sentAt: Date;
};

// ---------- ZIP (phương thức "store", không nén) ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time: time & 0xffff, day: day & 0xffff };
}

export function buildStoredZip(files: { name: string; data: Uint8Array }[], date = new Date()): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const { time, day } = dosDateTime(date);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // tên file UTF-8
    lv.setUint16(8, 0, true); // store
    lv.setUint16(10, time, true);
    lv.setUint16(12, day, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, file.data.length, true);
    lv.setUint32(22, file.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, day, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, file.data.length, true);
    cv.setUint32(24, file.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local, file.data);
    centrals.push(central);
    offset += local.length + file.data.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const parts = [...locals, ...centrals, end];
  const out = new Uint8Array(new ArrayBuffer(parts.reduce((sum, part) => sum + part.length, 0)));
  let position = 0;
  for (const part of parts) {
    out.set(part, position);
    position += part.length;
  }
  return out;
}

// ---------- Nội dung Word ----------

const xmlEscape = (value: string) =>
  value
    // Bỏ ký tự điều khiển mà XML không cho phép.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

type Run = { text: string; bold?: boolean; size?: number; color?: string };

function paragraph(runs: Run[], options: { after?: number; before?: number; indent?: boolean } = {}) {
  const spacing = `<w:spacing w:before="${options.before ?? 0}" w:after="${options.after ?? 120}" w:line="300" w:lineRule="auto"/>`;
  const indent = options.indent ? '<w:ind w:left="397" w:hanging="170"/>' : "";
  const body = runs
    .map(
      (run) =>
        `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/>${
          run.bold ? "<w:b/>" : ""
        }${run.color ? `<w:color w:val="${run.color}"/>` : ""}<w:sz w:val="${run.size ?? 22}"/></w:rPr><w:t xml:space="preserve">${xmlEscape(
          run.text
        )}</w:t></w:r>`
    )
    .join("");
  return `<w:p><w:pPr>${spacing}${indent}</w:pPr>${body}</w:p>`;
}

// Bố cục giống trong app: mỗi chủ đề một khung, kết luận nền xanh; quyết định và vấn đề đánh số.
const CONTENT_WIDTH = 9638; // A4 trừ lề 2 cm mỗi bên (twip)
const BADGE_WIDTH = 567;
const BORDER = "E4E4E7";
const BRAND = "A8D431";
const BRAND_SOFT = "F7FBE9";
const WARN_SOFT = "FEF3C7";
const HEADER_SOFT = "FAFAFA";

function cell(body: string, width: number, options: { shade?: string; borderTop?: boolean } = {}) {
  const shade = options.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${options.shade}"/>` : "";
  const top = options.borderTop ? `<w:tcBorders><w:top w:val="single" w:sz="4" w:color="${BORDER}"/></w:tcBorders>` : "";
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${top}${shade}<w:tcMar><w:top w:w="100" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:left w:w="160" w:type="dxa"/><w:right w:w="160" w:type="dxa"/></w:tcMar><w:vAlign w:val="top"/></w:tcPr>${
    body || paragraph([{ text: "" }], { after: 0 })
  }</w:tc>`;
}

function table(rows: string[][], widths: number[]) {
  const grid = widths.map((width) => `<w:gridCol w:w="${width}"/>`).join("");
  const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:color="${BORDER}"/>`;
  const borders = `<w:tblBorders>${["top", "left", "bottom", "right", "insideH"].map(border).join("")}<w:insideV w:val="nil"/></w:tblBorders>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${CONTENT_WIDTH}" w:type="dxa"/>${borders}<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows
    .map((row) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${row.join("")}</w:tr>`)
    .join("")}</w:tbl>${paragraph([{ text: "" }], { after: 80 })}`;
}

function badge(n: number, warn: boolean) {
  return paragraph([{ text: String(n), bold: true, color: warn ? "92400E" : "18181B" }], { after: 0 });
}

function bullets(items: string[]) {
  return items.map((item) => paragraph([{ text: `• ${item}` }], { indent: true, after: 60 })).join("");
}

function topicTable(topic: RecapTopicBlock, index: number) {
  const width = CONTENT_WIDTH - BADGE_WIDTH;
  const rows: string[][] = [
    [
      cell(badge(index + 1, false), BADGE_WIDTH, { shade: BRAND }),
      cell(paragraph([{ text: topic.title, bold: true, size: 23 }], { after: 0 }), width, { shade: HEADER_SOFT }),
    ],
  ];
  const body = [...topic.notes.map((text) => paragraph([{ text }], { after: 60 })), bullets(topic.points)].join("");
  if (body) rows.push([cell("", BADGE_WIDTH), cell(body, width)]);
  if (topic.conclusion) {
    rows.push([
      cell("", BADGE_WIDTH, { shade: BRAND_SOFT }),
      cell(paragraph([{ text: "Kết luận: ", bold: true }, { text: topic.conclusion, bold: true }], { after: 0 }), width, {
        shade: BRAND_SOFT,
      }),
    ]);
  }
  return table(rows, [BADGE_WIDTH, width]);
}

function numberedTable(items: string[], warn: boolean) {
  const width = CONTENT_WIDTH - BADGE_WIDTH;
  return table(
    items.map((item, index) => {
      const action = parseExportActionLine(item);
      const body = action
        ? paragraph([{ text: action.title, bold: true }], { after: 20 }) +
          paragraph(
            [{ text: `${action.owner} · Hạn ${action.due}${action.done ? " · Đã xong" : ""}`, size: 20, color: "71717A" }],
            { after: 0 }
          )
        : paragraph([{ text: item, bold: !warn }], { after: 0 });
      return [cell(badge(index + 1, warn), BADGE_WIDTH, { shade: warn ? WARN_SOFT : BRAND }), cell(body, width)];
    }),
    [BADGE_WIDTH, width]
  );
}

function sectionXml(section: RecapSection): string[] {
  const parts: string[] = [];
  if (section.title) {
    parts.push(paragraph([{ text: section.title, bold: true, size: 26 }], { before: 280, after: 120 }));
  }
  for (const text of section.paragraphs) parts.push(paragraph([{ text }]));
  section.topics.forEach((topic, index) => parts.push(topicTable(topic, index)));
  if (section.items.length) {
    if (isSummarySection(section.title)) parts.push(bullets(section.items));
    else if (section.items.length === 1 && isRecapPlaceholder(section.items[0])) {
      parts.push(paragraph([{ text: section.items[0], color: "71717A" }]));
    } else parts.push(numberedTable(section.items, isOpenQuestionSection(section.title)));
  }
  return parts;
}

export function buildRecapDocumentXml(input: RecapDocxInput): string {
  const sent = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(input.sentAt);

  const meta: [string, string][] = [
    ["Thời gian", `${input.when} (giờ Việt Nam)`],
    ["Phòng họp", input.room ?? "Không dùng phòng"],
    ["Người tổ chức", input.organizer],
    ["Người tham dự", input.attendees.join(", ") || "—"],
  ];

  const parts = [
    paragraph([{ text: "BIÊN BẢN HỌP", bold: true, size: 20, color: "71717A" }], { before: 200, after: 60 }),
    paragraph([{ text: input.title, bold: true, size: 34 }], { after: 200 }),
    ...meta.map(([label, value]) =>
      paragraph([{ text: `${label}: `, bold: true }, { text: value }], { after: 60 })
    ),
  ];

  for (const section of parseRecapSections(input.content)) parts.push(...sectionXml(section));

  parts.push(
    paragraph(
      [{ text: `Biên bản do AI viết từ file ghi âm, người tổ chức đã đọc lại và gửi lúc ${sent}.`, size: 18, color: "71717A" }],
      { before: 360 }
    )
  );

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${parts.join(
    ""
  )}<w:sectPr><w:headerReference w:type="first" r:id="rIdHeader"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="708" w:gutter="0"/><w:titlePg/></w:sectPr></w:body></w:document>`;
}

// Logo ở góc trái, chỉ trang đầu (phần đầu trang riêng cho trang đầu).
const LOGO_WIDTH_EMU = 1_620_000; // 4,5 cm
const LOGO_HEIGHT_EMU = Math.round((LOGO_WIDTH_EMU * RECAP_LOGO_HEIGHT) / RECAP_LOGO_WIDTH);

export function buildRecapHeaderXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="left"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${LOGO_WIDTH_EMU}" cy="${LOGO_HEIGHT_EMU}"/><wp:docPr id="1" name="Logo Creative Station" descr="Creative Station"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="creative-station-logo.png" descr="Creative Station"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${LOGO_WIDTH_EMU}" cy="${LOGO_HEIGHT_EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:hdr>`;
}

export function buildRecapDocx(input: RecapDocxInput): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  return buildStoredZip(
    [
      {
        name: "[Content_Types].xml",
        data: encoder.encode(
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'
        ),
      },
      {
        name: "_rels/.rels",
        data: encoder.encode(
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
        ),
      },
      { name: "word/document.xml", data: encoder.encode(buildRecapDocumentXml(input)) },
      {
        name: "word/_rels/document.xml.rels",
        data: encoder.encode(
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>'
        ),
      },
      { name: "word/header1.xml", data: encoder.encode(buildRecapHeaderXml()) },
      {
        name: "word/_rels/header1.xml.rels",
        data: encoder.encode(
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/></Relationships>'
        ),
      },
      { name: "word/media/logo.png", data: recapLogoPng() },
    ],
    input.sentAt
  );
}

/** Tên file trong tài liệu dự án, ví dụ "Biên bản họp - Kickoff Jabil - 22-10-2026.docx". */
export function recapDocxFileName(title: string, startAt: Date): string {
  const vn = new Date(startAt.getTime() + 7 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${pad(vn.getUTCDate())}-${pad(vn.getUTCMonth() + 1)}-${vn.getUTCFullYear()}`;
  const safeTitle = title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Cuộc họp";
  return `Biên bản họp - ${safeTitle} - ${date}.docx`;
}
