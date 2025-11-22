CREATE TYPE "asset_type" AS ENUM('stock_us', 'stock_intl', 'crypto');--> statement-breakpoint
CREATE TYPE "transaction_type" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TABLE "investment_assets" (
	"id" serial PRIMARY KEY,
	"symbol" varchar(50) NOT NULL UNIQUE,
	"name" varchar(255) NOT NULL,
	"assetType" "asset_type" NOT NULL,
	"exchange" varchar(100),
	"currency" varchar(10) DEFAULT 'USD' NOT NULL,
	"apiSource" varchar(50) NOT NULL,
	"apiSymbol" varchar(100) NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"minInvestment" integer DEFAULT 100 NOT NULL,
	"description" text,
	"logoUrl" varchar(500),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investment_portfolios" (
	"id" serial PRIMARY KEY,
	"userId" integer NOT NULL,
	"assetId" integer NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"averageBuyPrice" integer NOT NULL,
	"totalInvested" integer DEFAULT 0 NOT NULL,
	"realizedGains" integer DEFAULT 0 NOT NULL,
	"firstPurchaseAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lastTransactionAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investment_price_cache" (
	"id" serial PRIMARY KEY,
	"assetId" integer NOT NULL,
	"price" integer NOT NULL,
	"previousClose" integer,
	"change24h" integer,
	"changePercent24h" integer,
	"volume24h" varchar(50),
	"marketCap" varchar(50),
	"priceTimestamp" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investment_sync_log" (
	"id" serial PRIMARY KEY,
	"syncType" varchar(50) NOT NULL,
	"apiSource" varchar(50) NOT NULL,
	"assetsUpdated" integer DEFAULT 0 NOT NULL,
	"apiCallsUsed" integer DEFAULT 0 NOT NULL,
	"success" boolean NOT NULL,
	"errorMessage" text,
	"durationMs" integer,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investment_transactions" (
	"id" serial PRIMARY KEY,
	"userId" integer NOT NULL,
	"assetId" integer NOT NULL,
	"transactionType" "transaction_type" NOT NULL,
	"quantity" integer NOT NULL,
	"pricePerUnit" integer NOT NULL,
	"subtotal" integer NOT NULL,
	"feePercent" integer DEFAULT 150 NOT NULL,
	"feeAmount" integer NOT NULL,
	"totalAmount" integer NOT NULL,
	"costBasis" integer,
	"realizedGain" integer,
	"notes" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "investment_assets_symbol_idx" ON "investment_assets" ("symbol");--> statement-breakpoint
CREATE INDEX "investment_assets_type_active_idx" ON "investment_assets" ("assetType","isActive");--> statement-breakpoint
CREATE INDEX "investment_assets_api_source_idx" ON "investment_assets" ("apiSource");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_user_asset_idx" ON "investment_portfolios" ("userId","assetId");--> statement-breakpoint
CREATE INDEX "portfolio_user_idx" ON "investment_portfolios" ("userId");--> statement-breakpoint
CREATE INDEX "portfolio_asset_idx" ON "investment_portfolios" ("assetId");--> statement-breakpoint
CREATE INDEX "price_cache_asset_timestamp_idx" ON "investment_price_cache" ("assetId","priceTimestamp");--> statement-breakpoint
CREATE INDEX "price_cache_recent_idx" ON "investment_price_cache" ("priceTimestamp");--> statement-breakpoint
CREATE INDEX "sync_log_created_idx" ON "investment_sync_log" ("createdAt");--> statement-breakpoint
CREATE INDEX "sync_log_api_source_idx" ON "investment_sync_log" ("apiSource","createdAt");--> statement-breakpoint
CREATE INDEX "sync_log_success_idx" ON "investment_sync_log" ("success","createdAt");--> statement-breakpoint
CREATE INDEX "transactions_user_idx" ON "investment_transactions" ("userId");--> statement-breakpoint
CREATE INDEX "transactions_asset_idx" ON "investment_transactions" ("assetId");--> statement-breakpoint
CREATE INDEX "transactions_user_created_idx" ON "investment_transactions" ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "transactions_type_idx" ON "investment_transactions" ("transactionType");--> statement-breakpoint
ALTER TABLE "investment_portfolios" ADD CONSTRAINT "investment_portfolios_userId_users_id_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "investment_portfolios" ADD CONSTRAINT "investment_portfolios_assetId_investment_assets_id_fkey" FOREIGN KEY ("assetId") REFERENCES "investment_assets"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "investment_price_cache" ADD CONSTRAINT "investment_price_cache_assetId_investment_assets_id_fkey" FOREIGN KEY ("assetId") REFERENCES "investment_assets"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "investment_transactions" ADD CONSTRAINT "investment_transactions_userId_users_id_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "investment_transactions" ADD CONSTRAINT "investment_transactions_assetId_investment_assets_id_fkey" FOREIGN KEY ("assetId") REFERENCES "investment_assets"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_price_positive", ADD CONSTRAINT "products_price_positive" CHECK ("price" >= 0);--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_shipping_positive", ADD CONSTRAINT "products_shipping_positive" CHECK ("shippingCost" >= 0);--> statement-breakpoint
ALTER TABLE "user_reviews" DROP CONSTRAINT "user_reviews_rating_range", ADD CONSTRAINT "user_reviews_rating_range" CHECK ("rating" >= 1 AND "rating" <= 5);--> statement-breakpoint
ALTER TABLE "user_reviews" DROP CONSTRAINT "user_reviews_text_length", ADD CONSTRAINT "user_reviews_text_length" CHECK (LENGTH("text") >= 50 AND LENGTH("text") <= 500);