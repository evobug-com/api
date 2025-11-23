/**
 * Investment Price Sync Service
 * Syncs prices from Twelve Data API to database cache
 * Runs every 3 hours (8 times per day)
 */

import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql/postgres";
import {
	investmentAssetsTable,
	investmentPriceCacheTable,
	investmentSyncLogTable,
	type InsertDbInvestmentPriceCache,
	type InsertDbInvestmentSyncLog,
} from "../db/schema.ts";
import * as schema from "../db/schema.ts";
import type { relations } from "../db/relations.ts";
import { getTwelveDataClient } from "../utils/twelvedata-client.ts";

export class InvestmentSyncService {
	constructor(private db: BunSQLDatabase<typeof schema, typeof relations>) {}

	/**
	 * Sync all active assets
	 */
	async syncAllAssets(): Promise<{
		success: boolean;
		assetsUpdated: number;
		apiCallsUsed: number;
		durationMs: number;
		errors: string[];
	}> {
		const startTime = Date.now();
		const errors: string[] = [];
		let assetsUpdated = 0;

		console.log("[InvestmentSync] Starting price sync...");

		try {
			// Get all active assets
			const activeAssets = await this.db
				.select()
				.from(investmentAssetsTable)
				.where(eq(investmentAssetsTable.isActive, true));

			if (activeAssets.length === 0) {
				console.log("[InvestmentSync] No active assets to sync");
				return {
					success: true,
					assetsUpdated: 0,
					apiCallsUsed: 0,
					durationMs: Date.now() - startTime,
					errors: [],
				};
			}

			console.log(`[InvestmentSync] Found ${activeAssets.length} active assets`);

			// Get Twelve Data client
			const client = getTwelveDataClient();

			// Track API usage before sync
			const usageBefore = client.getUsageStats();

			// Fetch prices for all assets
			const symbols = activeAssets.map((asset) => asset.apiSymbol);
			const prices = await client.getPrices(symbols);

			// Track API usage after sync
			const usageAfter = client.getUsageStats();
			const apiCallsUsed = usageAfter.dailyCalls - usageBefore.dailyCalls;

			console.log(`[InvestmentSync] Fetched ${prices.size} prices using ${apiCallsUsed} API calls`);

			// Update price cache for each asset
			for (const asset of activeAssets) {
				const priceData = prices.get(asset.apiSymbol);

				if (!priceData) {
					errors.push(`No price data for ${asset.symbol} (${asset.apiSymbol})`);
					continue;
				}

				try {
					// Insert price cache entry
					const cacheEntry: InsertDbInvestmentPriceCache = {
						assetId: asset.id,
						price: priceData.price,
						previousClose: priceData.previousClose || null,
						change24h: priceData.change24h || null,
						changePercent24h: priceData.changePercent24h || null,
						volume24h: priceData.volume24h || null,
						marketCap: null,
						priceTimestamp: priceData.timestamp,
					};

					await this.db.insert(investmentPriceCacheTable).values(cacheEntry);
					assetsUpdated++;
				} catch (error) {
					const errorMsg = error instanceof Error ? error.message : String(error);
					errors.push(`Failed to cache price for ${asset.symbol}: ${errorMsg}`);
					console.error(`[InvestmentSync] Error caching price for ${asset.symbol}:`, error);
				}
			}

			const durationMs = Date.now() - startTime;

			// Log sync operation
			const syncLog: InsertDbInvestmentSyncLog = {
				syncType: "scheduled",
				apiSource: "twelvedata",
				assetsUpdated,
				apiCallsUsed,
				success: errors.length === 0,
				errorMessage: errors.length > 0 ? errors.join("; ") : null,
				durationMs,
			};

			await this.db.insert(investmentSyncLogTable).values(syncLog);

			console.log(
				`[InvestmentSync] Sync complete: ${assetsUpdated} assets updated in ${durationMs}ms (${apiCallsUsed} API calls)`,
			);

			if (errors.length > 0) {
				console.warn(`[InvestmentSync] Encountered ${errors.length} errors during sync`);
			}

			return {
				success: errors.length === 0,
				assetsUpdated,
				apiCallsUsed,
				durationMs,
				errors,
			};
		} catch (error) {
			const durationMs = Date.now() - startTime;
			const errorMessage = error instanceof Error ? error.message : String(error);

			console.error("[InvestmentSync] Sync failed:", error);

			// Log failed sync
			const syncLog: InsertDbInvestmentSyncLog = {
				syncType: "scheduled",
				apiSource: "twelvedata",
				assetsUpdated,
				apiCallsUsed: 0,
				success: false,
				errorMessage,
				durationMs,
			};

			await this.db.insert(investmentSyncLogTable).values(syncLog);

			return {
				success: false,
				assetsUpdated,
				apiCallsUsed: 0,
				durationMs,
				errors: [errorMessage],
			};
		}
	}

	/**
	 * Sync a single asset (for manual updates)
	 */
	async syncSingleAsset(symbol: string): Promise<{
		success: boolean;
		assetSymbol: string;
		error?: string;
	}> {
		try {
			// Find asset
			const [asset] = await this.db
				.select()
				.from(investmentAssetsTable)
				.where(eq(investmentAssetsTable.symbol, symbol.toUpperCase()))
				.limit(1);

			if (!asset) {
				return {
					success: false,
					assetSymbol: symbol,
					error: "Asset not found",
				};
			}

			if (!asset.isActive) {
				return {
					success: false,
					assetSymbol: symbol,
					error: "Asset is not active",
				};
			}

			// Fetch price
			const client = getTwelveDataClient();
			const priceData = await client.getQuote(asset.apiSymbol);

			if (!priceData) {
				return {
					success: false,
					assetSymbol: symbol,
					error: "Failed to fetch price data",
				};
			}

			// Insert price cache
			const cacheEntry: InsertDbInvestmentPriceCache = {
				assetId: asset.id,
				price: priceData.price,
				previousClose: priceData.previousClose || null,
				change24h: priceData.change24h || null,
				changePercent24h: priceData.changePercent24h || null,
				volume24h: priceData.volume24h || null,
				marketCap: null,
				priceTimestamp: priceData.timestamp,
			};

			await this.db.insert(investmentPriceCacheTable).values(cacheEntry);

			console.log(`[InvestmentSync] Manually synced ${asset.symbol}`);

			return {
				success: true,
				assetSymbol: symbol,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error(`[InvestmentSync] Failed to sync ${symbol}:`, error);

			return {
				success: false,
				assetSymbol: symbol,
				error: errorMessage,
			};
		}
	}

	/**
	 * Get sync statistics
	 */
	async getSyncStats(): Promise<{
		totalSyncs: number;
		successfulSyncs: number;
		failedSyncs: number;
		lastSync: Date | null;
		avgDurationMs: number;
		totalApiCalls: number;
	}> {
		const logs = await this.db.select().from(investmentSyncLogTable).orderBy(investmentSyncLogTable.createdAt);

		if (logs.length === 0) {
			return {
				totalSyncs: 0,
				successfulSyncs: 0,
				failedSyncs: 0,
				lastSync: null,
				avgDurationMs: 0,
				totalApiCalls: 0,
			};
		}

		const totalSyncs = logs.length;
		const successfulSyncs = logs.filter((log) => log.success).length;
		const failedSyncs = logs.filter((log) => !log.success).length;
		const lastSync = logs[logs.length - 1]?.createdAt || null;
		const avgDurationMs = Math.floor(logs.reduce((sum, log) => sum + (log.durationMs || 0), 0) / totalSyncs);
		const totalApiCalls = logs.reduce((sum, log) => sum + log.apiCallsUsed, 0);

		return {
			totalSyncs,
			successfulSyncs,
			failedSyncs,
			lastSync,
			avgDurationMs,
			totalApiCalls,
		};
	}
}
