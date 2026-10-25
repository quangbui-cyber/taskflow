import assert from "node:assert/strict";
import test from "node:test";
import { googleDocName, projectYear, sharingChanges } from "../lib/driveStorage";
import { parseUploadRequest } from "../lib/driveUpload";
import { GOOGLE_DOC_MIME_TYPE, driveFolderName, driveViewUrl, needsReaderShare } from "../lib/googleDrive";
import { MAX_DRIVE_FILE_SIZE, MAX_PROJECT_FILE_SIZE, validateUploadMeta } from "../lib/projectFiles";
import { downloadName, storedFileDriveUrl } from "../lib/storedFileResponse";

test("sharing adds missing members and removes people who left, but never touches inherited or owner access", () => {
  const changes = sharingChanges(
    [
      { id: "p-owner", email: "noreply@creativestation.vn", inherited: true },
      { id: "p-lan", email: "lan@creativestation.vn", inherited: false },
      { id: "p-old", email: "old@creativestation.vn", inherited: false },
      { id: "p-drive-member", email: "manager@creativestation.vn", inherited: true },
    ],
    ["Lan@creativestation.vn", "minh@creativestation.vn", "noreply@creativestation.vn"],
    "noreply@creativestation.vn"
  );
  assert.deepEqual(changes.add, ["minh@creativestation.vn"]);
  assert.deepEqual(changes.remove.map((permission) => permission.id), ["p-old"]);
});

test("folder and Google Doc names are cleaned for Drive", () => {
  assert.equal(driveFolderName("  Vietjet / Inflight\nĐợt 2  "), "Vietjet Inflight Đợt 2");
  assert.equal(driveFolderName("   "), "Không tên");
  assert.equal(driveFolderName("x".repeat(200)).length, 120);
  assert.equal(googleDocName("Bien ban hop 24.10.docx"), "Bien ban hop 24.10");
  assert.equal(googleDocName("ghi-chu.pdf"), "ghi-chu.pdf");
});

test("project year follows Vietnam time", () => {
  // 31/12/2025 18:00 UTC là 01:00 ngày 1/1/2026 giờ Việt Nam.
  assert.equal(projectYear(new Date("2025-12-31T18:00:00Z")), 2026);
  assert.equal(projectYear(new Date("2025-12-31T16:00:00Z")), 2025);
});

test("uploads through the app stay at 4 MB while Drive uploads allow 100 MB", () => {
  const big = { name: "thiet-ke.pdf", type: "application/pdf", size: 20 * 1024 * 1024 };
  assert.throws(() => validateUploadMeta(big), /4 MB/);
  assert.equal(validateUploadMeta(big, MAX_DRIVE_FILE_SIZE).size, big.size);
  assert.throws(() => validateUploadMeta({ ...big, size: MAX_DRIVE_FILE_SIZE + 1 }, MAX_DRIVE_FILE_SIZE), /100 MB/);
  assert.throws(() => validateUploadMeta({ name: "virus.exe", type: "application/x-msdownload", size: 10 }), /Chỉ hỗ trợ/);
  assert.equal(validateUploadMeta({ name: "bao gia.xlsx", type: "", size: MAX_PROJECT_FILE_SIZE }).mimeType,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
});

test("a Drive upload request names exactly one project or task", () => {
  const file = { name: "brief.pdf", mimeType: "application/pdf", size: 1000 };
  assert.deepEqual(parseUploadRequest({ ...file, target: "project", projectId: "p1" }).target, { type: "project", projectId: "p1" });
  assert.deepEqual(parseUploadRequest({ ...file, target: "task", taskId: "t1", kind: "RESULT" }).target, {
    type: "task", taskId: "t1", kind: "RESULT",
  });
  assert.throws(() => parseUploadRequest({ ...file, target: "task", taskId: "t1", kind: "OTHER" }), /không hợp lệ/);
  assert.throws(() => parseUploadRequest({ ...file, target: "project" }), /không hợp lệ/);
});

test("Drive links and download names", () => {
  assert.equal(storedFileDriveUrl({ driveFileId: null, mimeType: "application/pdf" }), null);
  assert.equal(storedFileDriveUrl({ driveFileId: "abc", mimeType: "application/pdf" }), "https://drive.google.com/file/d/abc/view");
  assert.equal(driveViewUrl("doc1", GOOGLE_DOC_MIME_TYPE), "https://docs.google.com/document/d/doc1/edit");
  assert.equal(downloadName({ name: "Bien ban hop", mimeType: GOOGLE_DOC_MIME_TYPE }), "Bien ban hop.docx");
  assert.equal(downloadName({ name: "PO.pdf", mimeType: "application/pdf" }), "PO.pdf");
});

test("opening a Drive file shares it only with people who have no access yet", () => {
  const permissions = [
    { email: "noreply@creativestation.vn" },
    { email: "lan@creativestation.vn" }, // thừa hưởng từ thư mục dự án
  ];
  assert.equal(needsReaderShare(permissions, "Lan@CreativeStation.vn"), false);
  assert.equal(needsReaderShare(permissions, "quang.bui@creativestation.vn"), true);
  assert.equal(needsReaderShare([], "quang.bui@creativestation.vn"), true);
});
