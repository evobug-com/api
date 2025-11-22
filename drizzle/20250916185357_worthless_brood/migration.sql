ALTER TABLE "messages_logs" ADD COLUMN "messageId" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "messages_logs" ADD COLUMN "editedContents" jsonb DEFAULT '[]';--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "sizes" DROP DEFAULT;--> statement-breakpoint
CREATE INDEX "messages_logs_messageId_platform_idx" ON "messages_logs" ("messageId","platform");