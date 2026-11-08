import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { rekeyOwnerFolders } from "../lib/driveStorage";
import { createCrmTestDb, crmTestDatabaseUrl } from "./helpers/crmTestDb";
test("rekey preserves unique folder ids offline, is idempotent and skips conflicting target", { skip: !crmTestDatabaseUrl() }, async () => {
  const db = createCrmTestDb(); const id = randomUUID();
  const from = { kind: "OPPORTUNITY" as const, id }; const to = { kind: "PROJECT" as const, id };
  const folderIds = [1, 2, 3, 4, 9].map((n) => `${id}-F${n}`);
  try {
    assert.equal(await db.googleDriveConnection.count(), 0, "isolated test database must have no Drive credentials");
    await db.driveFolder.createMany({ data: ["", ":docs", ":tasks"].map((suffix, i) => ({ key: `opportunity:${id}${suffix}`, folderId: folderIds[i], name: suffix || "root" })).concat([{ key: `task:${id}`, folderId: folderIds[3], name: "task" }]) });
    assert.deepEqual(await rekeyOwnerFolders(db, from, to), { renamed: 3, skipped: 0 });
    assert.equal(await db.driveFolder.count({ where: { folderId: { in: folderIds } } }), 4);
    assert.equal((await db.driveFolder.findUniqueOrThrow({ where: { key: `project:${id}:docs` } })).folderId, folderIds[1]);
    assert.equal((await db.driveFolder.findUniqueOrThrow({ where: { key: `task:${id}` } })).folderId, folderIds[3]);
    assert.equal((await rekeyOwnerFolders(db, from, to)).renamed, 0);
    for (const suffix of ["", ":docs", ":tasks"]) await db.driveFolder.update({ where: { key: `project:${id}${suffix}` }, data: { key: `opportunity:${id}${suffix}` } });
    await db.driveFolder.create({ data: { key: `project:${id}:docs`, folderId: folderIds[4], name: "existing" } });
    assert.deepEqual(await rekeyOwnerFolders(db, from, to), { renamed: 2, skipped: 1 });
    assert.equal((await db.driveFolder.findUniqueOrThrow({ where: { key: `opportunity:${id}:docs` } })).folderId, folderIds[1]);
    assert.equal((await db.driveFolder.findUniqueOrThrow({ where: { key: `project:${id}:docs` } })).folderId, folderIds[4]);
  } finally { await db.driveFolder.deleteMany({ where: { folderId: { in: folderIds } } }); await db.$disconnect(); }
});
