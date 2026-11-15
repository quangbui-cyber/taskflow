-- CreateTable
CREATE TABLE "MailSender" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "replyTo" TEXT,
    "smtpRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailSender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailTemplate" (
    "id" TEXT NOT NULL,
    "senderId" TEXT,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "greeting" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "signOff" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailCampaign" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "templateId" TEXT,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "greeting" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "signOff" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sendAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "callName" TEXT,
    "salutation" TEXT,
    "group" TEXT,
    "note" TEXT,
    "source" TEXT,
    "confidence" DOUBLE PRECISION,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "claimedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailCampaignEvent" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailCampaignEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MailCampaign_status_sendAt_idx" ON "MailCampaign"("status", "sendAt");

-- CreateIndex
CREATE INDEX "MailRecipient_campaignId_status_idx" ON "MailRecipient"("campaignId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MailRecipient_campaignId_email_key" ON "MailRecipient"("campaignId", "email");

-- CreateIndex
CREATE INDEX "MailCampaignEvent_campaignId_createdAt_idx" ON "MailCampaignEvent"("campaignId", "createdAt");

-- AddForeignKey
ALTER TABLE "MailTemplate" ADD CONSTRAINT "MailTemplate_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "MailSender"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailCampaign" ADD CONSTRAINT "MailCampaign_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "MailSender"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailCampaign" ADD CONSTRAINT "MailCampaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MailTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailCampaign" ADD CONSTRAINT "MailCampaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailRecipient" ADD CONSTRAINT "MailRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MailCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailCampaignEvent" ADD CONSTRAINT "MailCampaignEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MailCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailCampaignEvent" ADD CONSTRAINT "MailCampaignEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Thương hiệu gửi và mẫu thư cảm ơn đầu tiên (mẫu của Ga – Creative Station).
INSERT INTO "MailSender" ("id", "name") VALUES ('mailsender_ga', 'Ga – Creative Station');

INSERT INTO "MailTemplate" ("id", "senderId", "name", "subject", "title", "greeting", "body", "signOff", "signature", "updatedAt")
VALUES (
  'mailtemplate_ga_thanks',
  'mailsender_ga',
  'Lời cảm ơn sau chương trình',
  'Cảm ơn {{xung_ho}} {{ten_goi}} đã đồng hành cùng Ga',
  'Lời cảm ơn',
  '{{Xung_ho}} {{ten_goi}} thân mến,',
  E'Tạm biệt Đà Nẵng, chúng ta cùng trở về với một tinh thần mới, những kết nối gần hơn và thật nhiều câu chuyện để kể sau hành trình vừa qua.\n\nCảm ơn {{xung_ho}} và cả team đã cùng chơi hết mình, cùng vượt thử thách và tạo nên những khoảnh khắc đáng nhớ. Có lẽ, để hiểu nhau hơn, chúng ta cần hơn những trải nghiệm vượt ra ngoài công việc thường ngày.\n\nMong rằng tinh thần WE ARE TOGETHER sẽ tiếp tục được mang theo khi mọi người trở lại văn phòng – trong từng cuộc trò chuyện, sự phối hợp và những dự án sắp tới.\n\nCảm ơn vì đã tin tưởng chọn Ga làm bạn đồng hành trong chuyến đi lần này!',
  'Thân mến,',
  'Ga',
  CURRENT_TIMESTAMP
);
