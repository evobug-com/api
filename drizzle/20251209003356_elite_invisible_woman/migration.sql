ALTER TABLE "user_stats" ADD COLUMN "activityPointsLifetime" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "activityPointsWeekly" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "activityPointsDailyCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "lastActivityPointsDay" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "lastActivityPointsReset" timestamp with time zone;