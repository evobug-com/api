CREATE TABLE "achievements" (
	"id" serial PRIMARY KEY,
	"name" varchar(255) NOT NULL,
	"description" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_achievements" (
	"id" serial PRIMARY KEY,
	"userId" integer NOT NULL,
	"achievementId" integer NOT NULL,
	"unlockedAt" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}',
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "user_achievements_user_achievement_idx" ON "user_achievements" ("userId","achievementId");--> statement-breakpoint
CREATE INDEX "user_achievements_userId_idx" ON "user_achievements" ("userId");--> statement-breakpoint
CREATE INDEX "user_achievements_achievementId_idx" ON "user_achievements" ("achievementId");--> statement-breakpoint
CREATE INDEX "user_achievements_unlockedAt_idx" ON "user_achievements" ("unlockedAt");--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_userId_users_id_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_achievementId_achievements_id_fkey" FOREIGN KEY ("achievementId") REFERENCES "achievements"("id") ON DELETE CASCADE;