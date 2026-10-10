import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const PINNED_PHASE9_DATABASE_URL =
  "postgresql://postgres@127.0.0.1:55439/taskflow";
const PNG_PREFIX = "data:image/png;base64,";
const PNG_MAGIC = Buffer.from("89504e470d0a1a0a", "hex");
const MAX_SIGNATURE_BYTES = 128 * 1024;
const MAX_SIGNATURE_DIMENSION = 2048;
const MAX_SIGNATURE_PIXELS = 2_000_000;

export type DecodedSignaturePng = {
  bytes: Buffer;
  sha256: string;
  byteLength: number;
  width: number;
  height: number;
};

export function assertPinnedPhase9DatabaseUrl(value = process.env.DATABASE_URL) {
  if (value !== PINNED_PHASE9_DATABASE_URL) {
    throw new Error(
      `Phase 9 chỉ được phép dùng ${PINNED_PHASE9_DATABASE_URL}; đã từ chối URL khác.`
    );
  }
}

function readPngDimensionsAndEnd(bytes: Buffer) {
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new Error("Chữ ký phải là tệp PNG hợp lệ.");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let sawIhdr = false;
  let sawIdat = false;
  let sawIend = false;

  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const chunkEnd = dataStart + length + 4;
    if (chunkEnd > bytes.length) {
      throw new Error("Cấu trúc PNG của chữ ký bị lỗi.");
    }

    const type = bytes.toString("ascii", typeStart, dataStart);
    if (!/^[A-Za-z]{4}$/.test(type)) {
      throw new Error("Cấu trúc PNG của chữ ký bị lỗi.");
    }
    if (!sawIhdr) {
      if (type !== "IHDR" || length !== 13) {
        throw new Error("PNG chữ ký thiếu IHDR hợp lệ.");
      }
      width = bytes.readUInt32BE(dataStart);
      height = bytes.readUInt32BE(dataStart + 4);
      sawIhdr = true;
    } else if (type === "IHDR") {
      throw new Error("PNG chữ ký có nhiều IHDR không hợp lệ.");
    }

    if (type === "IDAT") sawIdat = true;
    if (type === "IEND") {
      if (length !== 0 || chunkEnd !== bytes.length) {
        throw new Error("PNG chữ ký có dữ liệu nối thêm không an toàn.");
      }
      sawIend = true;
      break;
    }
    offset = chunkEnd;
  }

  if (!sawIhdr || !sawIdat || !sawIend) {
    throw new Error("PNG chữ ký chưa đầy đủ hoặc không hợp lệ.");
  }
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_SIGNATURE_DIMENSION ||
    height > MAX_SIGNATURE_DIMENSION ||
    width * height > MAX_SIGNATURE_PIXELS
  ) {
    throw new Error("Kích thước ảnh chữ ký không hợp lệ.");
  }
  return { width, height };
}

export function decodeSignaturePngDataUrl(value: unknown): DecodedSignaturePng {
  const dataUrl = String(value ?? "").trim();
  if (!dataUrl.startsWith(PNG_PREFIX)) {
    throw new Error("Chữ ký phải là ảnh PNG Base64.");
  }
  const encoded = dataUrl.slice(PNG_PREFIX.length);
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error("Dữ liệu PNG Base64 không hợp lệ.");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > MAX_SIGNATURE_BYTES) {
    throw new Error("Ảnh chữ ký vượt giới hạn 128 KiB.");
  }
  const { width, height } = readPngDimensionsAndEnd(bytes);
  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteLength: bytes.length,
    width,
    height,
  };
}

export function assertSixDigitSignaturePin(value: unknown) {
  const pin = String(value ?? "");
  if (!/^\d{6}$/.test(pin)) {
    throw new Error("Mã PIN chữ ký phải gồm đúng 6 chữ số.");
  }
  return pin;
}

export async function verifySignaturePinHash(hash: string, inputPin: unknown) {
  const pin = assertSixDigitSignaturePin(inputPin);
  return bcrypt.compare(pin, hash);
}

export async function readOwnSignatureAsset(ownerId: string) {
  const asset = await prisma.workflowSignatureAsset.findUnique({
    where: { ownerId },
    select: {
      pngData: true,
      sha256: true,
      width: true,
      height: true,
      updatedAt: true,
    },
  });
  if (!asset) return null;
  return {
    dataUrl: `${PNG_PREFIX}${Buffer.from(asset.pngData).toString("base64")}`,
    sha256: asset.sha256,
    width: asset.width,
    height: asset.height,
    updatedAt: asset.updatedAt,
  };
}

export async function replaceOwnSignatureAsset(ownerId: string, dataUrl: unknown) {
  const parsed = decodeSignaturePngDataUrl(dataUrl);
  const pngData = Uint8Array.from(parsed.bytes);
  return prisma.$transaction(async (tx) => {
    const asset = await tx.workflowSignatureAsset.upsert({
      where: { ownerId },
      create: {
        ownerId,
        pngData,
        sha256: parsed.sha256,
        byteLength: parsed.byteLength,
        width: parsed.width,
        height: parsed.height,
      },
      update: {
        pngData,
        sha256: parsed.sha256,
        byteLength: parsed.byteLength,
        width: parsed.width,
        height: parsed.height,
      },
      select: { id: true },
    });
    await tx.workflowSignatureAssetAudit.create({
      data: {
        assetId: asset.id,
        ownerId,
        actorId: ownerId,
        action: "REPLACE",
        sha256: parsed.sha256,
        byteLength: parsed.byteLength,
        width: parsed.width,
        height: parsed.height,
      },
    });
    return { sha256: parsed.sha256, width: parsed.width, height: parsed.height };
  });
}

export async function deleteOwnSignatureAsset(ownerId: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.workflowSignatureAsset.findUnique({
      where: { ownerId },
      select: {
        id: true,
        sha256: true,
        byteLength: true,
        width: true,
        height: true,
      },
    });
    if (!existing) return false;
    await tx.workflowSignatureAssetAudit.create({
      data: {
        assetId: existing.id,
        ownerId,
        actorId: ownerId,
        action: "DELETE",
        sha256: existing.sha256,
        byteLength: existing.byteLength,
        width: existing.width,
        height: existing.height,
      },
    });
    await tx.workflowSignatureAsset.delete({ where: { id: existing.id } });
    return true;
  });
}
