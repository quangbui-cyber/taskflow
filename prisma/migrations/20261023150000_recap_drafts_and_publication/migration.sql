ALTER TABLE "MeetingRecap"
ADD COLUMN "publishedSnapshot" JSONB,
ADD COLUMN "actionSuggestions" JSONB NOT NULL DEFAULT '[]';

-- Preserve the version people could already read before this deployment.
UPDATE "MeetingRecap" r
SET "publishedSnapshot" = jsonb_build_object(
  'content', r."content",
  'actionItems', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', a."id", 'title', a."title",
      'owner', CASE WHEN u."id" IS NULL THEN NULL ELSE jsonb_build_object(
        'id', u."id", 'name', u."name", 'avatarUrl', u."avatarUrl") END,
      'ownerName', a."ownerName",
      'dueDate', to_char(a."dueDate" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD'),
      'dueText', a."dueText",
      'done', CASE WHEN t."id" IS NULL THEN a."doneAt" IS NOT NULL ELSE t."status" = 'DONE' END,
      'task', CASE WHEN t."id" IS NULL THEN NULL ELSE jsonb_build_object(
        'id', t."id", 'status', t."status", 'projectId', t."projectId", 'projectName', p."name") END
    ) ORDER BY a."order", a."createdAt")
    FROM "MeetingRecapActionItem" a
    LEFT JOIN "User" u ON u."id" = a."ownerId"
    LEFT JOIN "Task" t ON t."id" = a."taskId"
    LEFT JOIN "Project" p ON p."id" = t."projectId"
    WHERE a."recapId" = r."id"
  ), '[]'::jsonb)
)
WHERE r."sentAt" IS NOT NULL AND r."content" IS NOT NULL;
