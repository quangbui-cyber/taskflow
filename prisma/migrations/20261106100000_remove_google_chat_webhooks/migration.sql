-- Gỡ hẳn webhook Google Chat: thông báo chỉ đi qua Chat app vào nhóm Chat của dự án.

-- DropColumn
ALTER TABLE "Project" DROP COLUMN "googleChatWebhookUrl";

-- DropTable (chỉ dùng để lưu webhook của Góc cảm ơn)
DROP TABLE "IntegrationSetting";
