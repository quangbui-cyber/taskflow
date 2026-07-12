ALTER TABLE "Project" ADD COLUMN "googleChatWebhookUrl" TEXT;

DROP INDEX "Project_webhookToken_key";

ALTER TABLE "Project" DROP COLUMN "webhookToken";
