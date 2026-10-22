import { parseRecapContent } from "@/lib/meetingRecap";

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
  const spacing = `<w:spacing w:before="${options.before ?? 0}" w:after="${options.after ?? 120}"/>`;
  const indent = options.indent ? '<w:ind w:left="567" w:hanging="283"/>' : "";
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
    paragraph([{ text: "BIÊN BẢN HỌP", bold: true, size: 20, color: "71717A" }], { after: 60 }),
    paragraph([{ text: input.title, bold: true, size: 34 }], { after: 200 }),
    ...meta.map(([label, value]) =>
      paragraph([{ text: `${label}: `, bold: true }, { text: value }], { after: 60 })
    ),
  ];

  for (const block of parseRecapContent(input.content)) {
    if (block.type === "heading") {
      parts.push(paragraph([{ text: block.text, bold: true, size: 26 }], { before: 280, after: 100 }));
    } else if (block.type === "subheading") {
      parts.push(paragraph([{ text: block.text, bold: true, size: 23, color: "3F3F46" }], { before: 160, after: 60 }));
    } else if (block.type === "list") {
      for (const item of block.items) parts.push(paragraph([{ text: `• ${item}` }], { indent: true, after: 60 }));
    } else {
      parts.push(paragraph([{ text: block.text }]));
    }
  }

  parts.push(
    paragraph(
      [{ text: `Biên bản do AI viết từ file ghi âm, người tổ chức đã đọc lại và gửi lúc ${sent}.`, size: 18, color: "71717A" }],
      { before: 360 }
    )
  );

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${parts.join(
    ""
  )}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

export function buildRecapDocx(input: RecapDocxInput): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  return buildStoredZip(
    [
      {
        name: "[Content_Types].xml",
        data: encoder.encode(
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
        ),
      },
      {
        name: "_rels/.rels",
        data: encoder.encode(
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
        ),
      },
      { name: "word/document.xml", data: encoder.encode(buildRecapDocumentXml(input)) },
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
