import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isTaskCreationUploadPath,
  MAX_INLINE_TASK_FILE_BYTES,
  MAX_TASK_CREATION_FILE_SIZE,
  readTaskCreationFiles,
  taskCreationUploadPath,
  validateTaskCreationFile,
} from "../lib/taskCreationFiles";

test("creation without attachments remains supported", async () => {
  assert.deepEqual(await readTaskCreationFiles(new FormData()), []);
});

test("brief and result files keep their kind, content and sanitized name", async () => {
  const form = new FormData();
  form.append("briefFiles", new File(["Brief content"], "folder/brief.txt", { type: "text/plain" }));
  form.append("resultFiles", new File(["name,value\nresult,1"], "result.csv"));
  const files = await readTaskCreationFiles(form);
  assert.deepEqual(files.map(({ kind, upload }) => [kind, upload.name, upload.mimeType]), [
    ["BRIEF", "folder brief.txt", "text/plain"],
    ["RESULT", "result.csv", "text/csv"],
  ]);
  assert.equal(new TextDecoder().decode(files[0].upload.data), "Brief content");
});

test("multiple files totaling exactly 4 MB are accepted", async () => {
  const form = new FormData();
  form.append("briefFiles", new File([new Uint8Array(MAX_INLINE_TASK_FILE_BYTES / 2)], "brief.txt"));
  form.append("resultFiles", new File([new Uint8Array(MAX_INLINE_TASK_FILE_BYTES / 2)], "result.txt"));
  assert.equal((await readTaskCreationFiles(form)).length, 2);
});

test("combined limit applies across brief and result files", async () => {
  const form = new FormData();
  form.append("briefFiles", new File([new Uint8Array(MAX_INLINE_TASK_FILE_BYTES)], "brief.txt"));
  form.append("resultFiles", new File(["x"], "result.txt"));
  await assert.rejects(readTaskCreationFiles(form), /Tổng dung lượng.*4 MB/);
});

test("one oversized file is rejected", async () => {
  const form = new FormData();
  form.append("briefFiles", new File([new Uint8Array(MAX_INLINE_TASK_FILE_BYTES + 1)], "brief.txt"));
  await assert.rejects(readTaskCreationFiles(form), /4 MB/);
});

test("an invalid later file rejects the entire selection", async () => {
  const form = new FormData();
  form.append("briefFiles", new File(["valid"], "brief.txt"));
  form.append("resultFiles", new File(["invalid"], "program.exe", { type: "application/octet-stream" }));
  await assert.rejects(readTaskCreationFiles(form), /Chỉ hỗ trợ/);
});

test("named empty files are rejected, empty native picker entries are ignored", async () => {
  const form = new FormData();
  form.append("briefFiles", new File([], ""));
  assert.deepEqual(await readTaskCreationFiles(form), []);
  form.append("briefFiles", new File([], "empty.txt"));
  await assert.rejects(readTaskCreationFiles(form), /không có nội dung/);
});

test("string entries cannot masquerade as attachments", async () => {
  const form = new FormData();
  form.append("briefFiles", "not a file");
  await assert.rejects(readTaskCreationFiles(form), /không hợp lệ/);
});

test("the large attachment path accepts an Excel file of exactly 25 MB", () => {
  const file = { name: "order.xlsx", type: "", size: 25 * 1024 * 1024 };
  assert.equal(file.size, MAX_TASK_CREATION_FILE_SIZE);
  assert.equal(validateTaskCreationFile(file).mimeType, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.throws(() => validateTaskCreationFile({ ...file, size: file.size + 1 }), /25 MB/);
});

test("a staged upload path belongs to exactly one user and project", () => {
  const pathname = taskCreationUploadPath("project-a", "user-a", "86b0983c-0a7e-4d37-8a18-0ba33a955163");
  assert.equal(isTaskCreationUploadPath(pathname, "project-a", "user-a"), true);
  assert.equal(isTaskCreationUploadPath(pathname, "project-b", "user-a"), false);
  assert.equal(isTaskCreationUploadPath(pathname, "project-a", "user-b"), false);
  assert.equal(isTaskCreationUploadPath(pathname + "/../other", "project-a", "user-a"), false);
});
