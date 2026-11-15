-- Xưng hô mặc định là "bạn": người nhận chưa chọn xưng hô được gọi là "bạn".
UPDATE "MailRecipient" SET "salutation" = 'ban' WHERE "salutation" IS NULL OR "salutation" NOT IN ('anh', 'chi', 'ban');
ALTER TABLE "MailRecipient" ALTER COLUMN "salutation" SET DEFAULT 'ban';
ALTER TABLE "MailRecipient" ALTER COLUMN "salutation" SET NOT NULL;
