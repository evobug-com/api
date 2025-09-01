ALTER TABLE "products" DROP CONSTRAINT "produts_price_positive";--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "produts_shipping_positive";--> statement-breakpoint
ALTER TABLE "user_reviews" DROP CONSTRAINT "user_reviews_rating_range";--> statement-breakpoint
ALTER TABLE "user_reviews" DROP CONSTRAINT "user_reviews_text_length";--> statement-breakpoint
DROP INDEX "produts_isActive_idx";--> statement-breakpoint
DROP INDEX "orders_productId_idx";--> statement-breakpoint
DROP INDEX "orders_status_idx";--> statement-breakpoint
DROP INDEX "orders_userId_idx";--> statement-breakpoint
DROP INDEX "suspensions_active_idx";--> statement-breakpoint
DROP INDEX "suspensions_endsAt_idx";--> statement-breakpoint
DROP INDEX "suspensions_issuedBy_idx";--> statement-breakpoint
DROP INDEX "suspensions_userId_idx";--> statement-breakpoint
DROP INDEX "user_reviews_userId_idx";--> statement-breakpoint
DROP INDEX "user_stats_log_userId_idx";--> statement-breakpoint
DROP INDEX "violations_issuedBy_idx";--> statement-breakpoint
DROP INDEX "violations_reviewRequested_idx";--> statement-breakpoint
DROP INDEX "violations_severity_idx";--> statement-breakpoint
DROP INDEX "violations_userId_idx";--> statement-breakpoint
DROP INDEX "events_isActive_idx";--> statement-breakpoint
DROP INDEX "events_startDate_idx";--> statement-breakpoint
DROP INDEX "event_participants_eventId_idx";--> statement-breakpoint
DROP INDEX "event_participants_event_id_user_id_idx";--> statement-breakpoint
DROP INDEX "event_participants_userId_idx";--> statement-breakpoint
DROP INDEX "users_discord_idx";--> statement-breakpoint
DROP INDEX "users_guilded_idx";--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "serverTagStreak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "maxServerTagStreak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "lastServerTagCheck" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "serverTagBadge" varchar(255);--> statement-breakpoint
CREATE INDEX "products_isActive_idx" ON "products" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "orders_productId_idx" ON "orders" USING btree ("productId");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_userId_idx" ON "orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "suspensions_active_idx" ON "suspensions" USING btree ("userId","endsAt");--> statement-breakpoint
CREATE INDEX "suspensions_endsAt_idx" ON "suspensions" USING btree ("endsAt");--> statement-breakpoint
CREATE INDEX "suspensions_issuedBy_idx" ON "suspensions" USING btree ("issuedBy");--> statement-breakpoint
CREATE INDEX "suspensions_userId_idx" ON "suspensions" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "user_reviews_userId_idx" ON "user_reviews" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "user_stats_log_userId_idx" ON "user_stats_log" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "violations_issuedBy_idx" ON "violations" USING btree ("issuedBy");--> statement-breakpoint
CREATE INDEX "violations_reviewRequested_idx" ON "violations" USING btree ("reviewRequested");--> statement-breakpoint
CREATE INDEX "violations_severity_idx" ON "violations" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "violations_userId_idx" ON "violations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "events_isActive_idx" ON "events" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "events_startDate_idx" ON "events" USING btree ("startDate");--> statement-breakpoint
CREATE INDEX "event_participants_eventId_idx" ON "event_participants" USING btree ("eventId");--> statement-breakpoint
CREATE UNIQUE INDEX "event_participants_event_id_user_id_idx" ON "event_participants" USING btree ("eventId","userId");--> statement-breakpoint
CREATE INDEX "event_participants_userId_idx" ON "event_participants" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "users_discord_idx" ON "users" USING btree ("discordId");--> statement-breakpoint
CREATE INDEX "users_guilded_idx" ON "users" USING btree ("guildedId");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_price_positive" CHECK ("products"."price" >= 0);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_shipping_positive" CHECK ("products"."shippingCost" >= 0);--> statement-breakpoint
ALTER TABLE "user_reviews" ADD CONSTRAINT "user_reviews_rating_range" CHECK ("user_reviews"."rating" >= 1 AND "user_reviews"."rating" <= 5);--> statement-breakpoint
ALTER TABLE "user_reviews" ADD CONSTRAINT "user_reviews_text_length" CHECK (LENGTH("user_reviews"."text") >= 50 AND LENGTH("user_reviews"."text") <= 500);