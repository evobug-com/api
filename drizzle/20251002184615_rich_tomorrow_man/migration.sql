CREATE TABLE "command_history" (
	"id" serial PRIMARY KEY,
	"userId" integer NOT NULL,
	"guildId" varchar(255) NOT NULL,
	"commandName" varchar(100) NOT NULL,
	"executedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"responseTime" integer,
	"success" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}',
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_violations" (
	"id" serial PRIMARY KEY,
	"userId" integer NOT NULL,
	"guildId" varchar(255) NOT NULL,
	"commandName" varchar(100),
	"violationType" varchar(50),
	"occurredAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suspicion_scores" (
	"id" serial PRIMARY KEY,
	"userId" integer NOT NULL,
	"guildId" varchar(255) NOT NULL,
	"totalScore" integer DEFAULT 0 NOT NULL,
	"timingScore" integer DEFAULT 0 NOT NULL,
	"behavioralScore" integer DEFAULT 0 NOT NULL,
	"socialScore" integer DEFAULT 0 NOT NULL,
	"accountScore" integer DEFAULT 0 NOT NULL,
	"reason" text,
	"detectedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolvedAt" timestamp with time zone,
	"resolutionNotes" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trust_scores" (
	"userId" integer PRIMARY KEY,
	"guildId" varchar(255) NOT NULL,
	"score" integer DEFAULT 500 NOT NULL,
	"accountFactorScore" integer DEFAULT 0 NOT NULL,
	"behavioralHistoryScore" integer DEFAULT 0 NOT NULL,
	"transactionPatternScore" integer DEFAULT 0 NOT NULL,
	"socialSignalScore" integer DEFAULT 0 NOT NULL,
	"lastViolationAt" timestamp with time zone,
	"cleanDays" integer DEFAULT 0 NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_behavior_metrics" (
	"userId" integer PRIMARY KEY,
	"guildId" varchar(255) NOT NULL,
	"totalCommands" integer DEFAULT 0 NOT NULL,
	"avgCommandInterval" integer,
	"stddevCommandInterval" integer,
	"coefficientVariation" integer,
	"lastCommandAt" timestamp with time zone,
	"lastAnalysisAt" timestamp with time zone,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "command_history" ADD CONSTRAINT "command_history_userId_users_id_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "rate_limit_violations" ADD CONSTRAINT "rate_limit_violations_userId_users_id_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "suspicion_scores" ADD CONSTRAINT "suspicion_scores_userId_users_id_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trust_scores" ADD CONSTRAINT "trust_scores_userId_users_id_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_behavior_metrics" ADD CONSTRAINT "user_behavior_metrics_userId_users_id_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX "command_history_userId_executedAt_idx" ON "command_history" ("userId","executedAt");--> statement-breakpoint
CREATE INDEX "command_history_commandName_executedAt_idx" ON "command_history" ("commandName","executedAt");--> statement-breakpoint
CREATE INDEX "command_history_recent_idx" ON "command_history" ("executedAt");--> statement-breakpoint
CREATE INDEX "rate_limit_violations_userId_occurredAt_idx" ON "rate_limit_violations" ("userId","occurredAt");--> statement-breakpoint
CREATE INDEX "rate_limit_violations_recent_idx" ON "rate_limit_violations" ("occurredAt");--> statement-breakpoint
CREATE INDEX "suspicion_scores_userId_detectedAt_idx" ON "suspicion_scores" ("userId","detectedAt");--> statement-breakpoint
CREATE INDEX "suspicion_scores_active_idx" ON "suspicion_scores" ("userId","resolved","detectedAt");--> statement-breakpoint
CREATE INDEX "suspicion_scores_high_idx" ON "suspicion_scores" ("totalScore","detectedAt");--> statement-breakpoint
CREATE INDEX "user_behavior_metrics_cv_idx" ON "user_behavior_metrics" ("coefficientVariation");--> statement-breakpoint
CREATE INDEX "user_behavior_metrics_guildId_idx" ON "user_behavior_metrics" ("guildId");