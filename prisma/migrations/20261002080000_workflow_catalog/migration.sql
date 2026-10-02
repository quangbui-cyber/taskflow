BEGIN;
ALTER TABLE "WorkflowTemplate" ADD COLUMN "familyId" TEXT,
 ADD COLUMN "category" TEXT NOT NULL DEFAULT '',
 ADD COLUMN "purpose" TEXT NOT NULL DEFAULT '',
 ADD COLUMN "changeNote" TEXT NOT NULL DEFAULT '';
DO $$
DECLARE item RECORD; cursor_id TEXT; parent_id TEXT; parent_kind TEXT; visited TEXT[];
BEGIN
 FOR item IN SELECT "id", "kind" FROM "WorkflowTemplate" LOOP
  cursor_id := item."id"; visited := ARRAY[]::TEXT[];
  LOOP
   IF cursor_id = ANY(visited) THEN RAISE EXCEPTION 'Template ancestry cycle'; END IF;
   visited := array_append(visited, cursor_id);
   SELECT "parentId", "kind" INTO parent_id, parent_kind FROM "WorkflowTemplate" WHERE "id" = cursor_id;
   IF NOT FOUND OR parent_kind <> item."kind" THEN RAISE EXCEPTION 'Invalid template ancestry'; END IF;
   EXIT WHEN parent_id IS NULL;
   cursor_id := parent_id;
  END LOOP;
  UPDATE "WorkflowTemplate" SET "familyId" = cursor_id WHERE "id" = item."id";
 END LOOP;
END $$;
ALTER TABLE "WorkflowTemplate" ALTER COLUMN "familyId" SET NOT NULL;
DROP INDEX "WorkflowTemplate_kind_version_key";
CREATE UNIQUE INDEX "WorkflowTemplate_familyId_version_key" ON "WorkflowTemplate"("familyId", "version");
COMMIT;
