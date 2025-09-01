-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TYPE "public"."order_status" AS ENUM('pending', 'completed', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."review_outcome" AS ENUM('APPROVED', 'REJECTED', 'PENDING');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin', 'moderator');--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"productId" uuid NOT NULL,
	"amount" integer DEFAULT 1 NOT NULL,
	"price" integer NOT NULL,
	"status" "order_status" DEFAULT 'completed' NOT NULL,
	"size" varchar(10),
	"deliveryName" varchar(255),
	"deliveryPhone" varchar(50),
	"deliveryAddress" text,
	"deliveryCity" varchar(100),
	"deliveryPostalCode" varchar(20),
	"deliveryNotes" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"price" integer NOT NULL,
	"imageUrl" varchar(500),
	"sizes" jsonb DEFAULT '["S","M","L","XL","XXL"]'::jsonb,
	"maxPerUser" integer DEFAULT 1,
	"isActive" boolean DEFAULT true NOT NULL,
	"requiresDelivery" boolean DEFAULT false NOT NULL,
	"shippingCost" integer DEFAULT 0,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "produts_price_positive" CHECK (price >= 0),
	CONSTRAINT "produts_shipping_positive" CHECK ("shippingCost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "messages_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer,
	"platform" varchar(255) NOT NULL,
	"channelId" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"editCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"deletedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "suspensions" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"guildId" varchar(255) NOT NULL,
	"liftedAt" timestamp with time zone,
	"liftedBy" integer,
	"liftReason" text,
	"issuedBy" integer,
	"startedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"endsAt" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"rating" integer NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "user_reviews_rating_range" CHECK ((rating >= 1) AND (rating <= 5)),
	CONSTRAINT "user_reviews_text_length" CHECK ((length(text) >= 50) AND (length(text) <= 500))
);
--> statement-breakpoint
CREATE TABLE "user_stats_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"activityType" varchar(255) NOT NULL,
	"notes" text,
	"xpEarned" integer DEFAULT 0 NOT NULL,
	"coinsEarned" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"dailyStreak" integer DEFAULT 0 NOT NULL,
	"maxDailyStreak" integer DEFAULT 0 NOT NULL,
	"lastDailyAt" timestamp with time zone,
	"workCount" integer DEFAULT 0 NOT NULL,
	"lastWorkAt" timestamp with time zone,
	"messagesCount" integer DEFAULT 0 NOT NULL,
	"lastMessageAt" timestamp with time zone,
	"coinsCount" integer DEFAULT 0 NOT NULL,
	"xpCount" integer DEFAULT 0 NOT NULL,
	"boostCount" integer DEFAULT 0 NOT NULL,
	"boostExpires" timestamp with time zone,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_stats_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "violations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"guildId" varchar(255) NOT NULL,
	"type" varchar(50) NOT NULL,
	"severity" "severity" NOT NULL,
	"policyViolated" varchar(255),
	"reason" text NOT NULL,
	"contentSnapshot" text,
	"context" text,
	"actionsApplied" text,
	"restrictions" text,
	"issuedBy" integer,
	"issuedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"expiresAt" timestamp with time zone,
	"reviewRequested" boolean DEFAULT false NOT NULL,
	"reviewedBy" integer,
	"reviewRequestedAt" timestamp with time zone,
	"reviewedAt" timestamp with time zone,
	"reviewOutcome" "review_outcome",
	"reviewNotes" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"imageUrl" text,
	"startDate" timestamp with time zone,
	"endDate" timestamp with time zone,
	"location" varchar(500),
	"maxParticipants" integer,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "event_participants" (
	"id" serial PRIMARY KEY NOT NULL,
	"eventId" integer NOT NULL,
	"userId" integer NOT NULL,
	"registeredAt" timestamp with time zone DEFAULT now() NOT NULL,
	"participatedAt" timestamp with time zone,
	"notes" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(50),
	"email" varchar(255),
	"password" varchar(255),
	"guildedId" varchar(255),
	"discordId" varchar(255),
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_productId_products_id_fk" FOREIGN KEY ("productId") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspensions" ADD CONSTRAINT "suspensions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspensions" ADD CONSTRAINT "suspensions_liftedBy_users_id_fk" FOREIGN KEY ("liftedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspensions" ADD CONSTRAINT "suspensions_issuedBy_users_id_fk" FOREIGN KEY ("issuedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_reviews" ADD CONSTRAINT "user_reviews_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_stats_log" ADD CONSTRAINT "user_stats_log_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violations" ADD CONSTRAINT "violations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violations" ADD CONSTRAINT "violations_issuedBy_users_id_fk" FOREIGN KEY ("issuedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violations" ADD CONSTRAINT "violations_reviewedBy_users_id_fk" FOREIGN KEY ("reviewedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_eventId_events_id_fk" FOREIGN KEY ("eventId") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_productId_idx" ON "orders" USING btree ("productId" uuid_ops);--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status" enum_ops);--> statement-breakpoint
CREATE INDEX "orders_userId_idx" ON "orders" USING btree ("user_id" int4_ops);--> statement-breakpoint
CREATE INDEX "produts_isActive_idx" ON "products" USING btree ("isActive" bool_ops);--> statement-breakpoint
CREATE INDEX "suspensions_active_idx" ON "suspensions" USING btree ("userId" int4_ops,"endsAt" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "suspensions_endsAt_idx" ON "suspensions" USING btree ("endsAt" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "suspensions_issuedBy_idx" ON "suspensions" USING btree ("issuedBy" int4_ops);--> statement-breakpoint
CREATE INDEX "suspensions_userId_idx" ON "suspensions" USING btree ("userId" int4_ops);--> statement-breakpoint
CREATE INDEX "user_reviews_userId_idx" ON "user_reviews" USING btree ("userId" int4_ops);--> statement-breakpoint
CREATE INDEX "user_stats_log_userId_idx" ON "user_stats_log" USING btree ("userId" int4_ops);--> statement-breakpoint
CREATE INDEX "violations_issuedBy_idx" ON "violations" USING btree ("issuedBy" int4_ops);--> statement-breakpoint
CREATE INDEX "violations_reviewRequested_idx" ON "violations" USING btree ("reviewRequested" bool_ops);--> statement-breakpoint
CREATE INDEX "violations_severity_idx" ON "violations" USING btree ("severity" enum_ops);--> statement-breakpoint
CREATE INDEX "violations_userId_idx" ON "violations" USING btree ("user_id" int4_ops);--> statement-breakpoint
CREATE INDEX "events_isActive_idx" ON "events" USING btree ("isActive" bool_ops);--> statement-breakpoint
CREATE INDEX "events_startDate_idx" ON "events" USING btree ("startDate" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "event_participants_eventId_idx" ON "event_participants" USING btree ("eventId" int4_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "event_participants_event_id_user_id_idx" ON "event_participants" USING btree ("eventId" int4_ops,"userId" int4_ops);--> statement-breakpoint
CREATE INDEX "event_participants_userId_idx" ON "event_participants" USING btree ("userId" int4_ops);--> statement-breakpoint
CREATE INDEX "users_discord_idx" ON "users" USING btree ("discordId" text_ops);--> statement-breakpoint
CREATE INDEX "users_guilded_idx" ON "users" USING btree ("guildedId" text_ops);
*/