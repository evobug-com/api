CREATE TABLE "captcha_logs" (
	"id" serial PRIMARY KEY,
	"userId" integer NOT NULL,
	"captchaType" varchar(50) NOT NULL,
	"command" varchar(50) NOT NULL,
	"success" boolean NOT NULL,
	"responseTime" integer NOT NULL,
	"clientIp" varchar(45),
	"userAgent" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "failedCaptchaCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "lastCaptchaFailedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "suspiciousBehaviorScore" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "lastSuspiciousActivityAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "economyBannedUntil" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "captcha_logs" ADD CONSTRAINT "captcha_logs_userId_users_id_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX "captcha_logs_userId_idx" ON "captcha_logs" ("userId");--> statement-breakpoint
CREATE INDEX "captcha_logs_createdAt_idx" ON "captcha_logs" ("createdAt");--> statement-breakpoint
CREATE INDEX "captcha_logs_userId_command_idx" ON "captcha_logs" ("userId","command");