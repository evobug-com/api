ALTER TABLE "user_stats" ADD COLUMN "voiceTimeMinutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "lastVoiceCheck" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "lastVoiceJoinedAt" timestamp with time zone;