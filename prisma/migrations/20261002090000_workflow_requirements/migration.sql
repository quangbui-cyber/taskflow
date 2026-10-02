ALTER TABLE "WorkflowTemplate" ADD COLUMN "requirements" JSONB;
ALTER TABLE "WorkflowFile" ADD COLUMN "supportingSlot" TEXT;
