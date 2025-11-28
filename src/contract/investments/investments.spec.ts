import { describe, expect, it } from "bun:test";
import { ORPCError } from "@orpc/client";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import {
	investmentAssetsTable,
	investmentPortfoliosTable,
	investmentPriceCacheTable,
	userStatsTable,
	type InsertDbInvestmentAsset,
	type InsertDbInvestmentPortfolio,
	type InsertDbInvestmentPriceCache,
} from "../../db/schema.ts";
import { createTestContext, createTestDatabase } from "../shared/test-utils.ts";
import { createUser } from "../users";
import { buyAsset, getInvestmentSummary, investmentLeaderboard, sellAsset } from "./index.ts";
import { userStatsWithInvestments } from "../stats";

const db = await createTestDatabase();

describe("Investments", async () => {
	describe("investmentLeaderboard", () => {
		it("should return empty array when no portfolios exist", async () => {
			const emptyDb = await createTestDatabase();
			const result = await call(
				investmentLeaderboard,
				{ metric: "totalProfit", limit: 10 },
				createTestContext(emptyDb),
			);

			expect(result).toBeInstanceOf(Array);
			expect(result.length).toBe(0);
		});

		it("should return users sorted by totalProfit (default metric)", async () => {
			// Create test users
			const user1 = await call(createUser, { username: "investor1" }, createTestContext(db));
			const user2 = await call(createUser, { username: "investor2" }, createTestContext(db));
			const user3 = await call(createUser, { username: "investor3" }, createTestContext(db));

			// Create test asset
			const assetData: InsertDbInvestmentAsset = {
				symbol: "AAPL",
				name: "Apple Inc.",
				assetType: "stock_us",
				apiSource: "twelvedata",
				apiSymbol: "AAPL",
				isActive: true,
				minInvestment: 100,
			};
			const [asset] = await db.insert(investmentAssetsTable).values(assetData).returning();

			if (!asset) throw new Error("Failed to create asset");

			// Create price cache
			const priceData: InsertDbInvestmentPriceCache = {
				assetId: asset.id,
				price: 15000, // $150.00
				priceTimestamp: new Date(),
			};
			await db.insert(investmentPriceCacheTable).values(priceData);

			// Create portfolios with different profit levels
			// User1: invested 1000, current value 1500, realized 100 -> totalProfit = 600
			const portfolio1: InsertDbInvestmentPortfolio = {
				userId: user1.id,
				assetId: asset.id,
				quantity: 10000, // 10 shares
				averageBuyPrice: 10000, // $100
				totalInvested: 1000,
				realizedGains: 100,
			};

			// User2: invested 2000, current value 3000, realized 200 -> totalProfit = 1200
			const portfolio2: InsertDbInvestmentPortfolio = {
				userId: user2.id,
				assetId: asset.id,
				quantity: 20000, // 20 shares
				averageBuyPrice: 10000, // $100
				totalInvested: 2000,
				realizedGains: 200,
			};

			// User3: invested 1500, current value 1200, realized -100 -> totalProfit = -400
			const portfolio3: InsertDbInvestmentPortfolio = {
				userId: user3.id,
				assetId: asset.id,
				quantity: 8000, // 8 shares
				averageBuyPrice: 18750, // $187.50
				totalInvested: 1500,
				realizedGains: -100,
			};

			await db.insert(investmentPortfoliosTable).values([portfolio1, portfolio2, portfolio3]);

			const result = await call(investmentLeaderboard, {}, createTestContext(db));

			expect(result.length).toBeGreaterThanOrEqual(3);
			// Find our test users in results
			const investor2 = result.find(r => r.user.username === "investor2");
			const investor1 = result.find(r => r.user.username === "investor1");
			const investor3 = result.find(r => r.user.username === "investor3");

			expect(investor2).toBeDefined();
			expect(investor1).toBeDefined();
			expect(investor3).toBeDefined();

			// investor2 should have highest profit
			expect(investor2!.totalProfit).toBeGreaterThan(investor1!.totalProfit);
			expect(investor1!.totalProfit).toBeGreaterThan(investor3!.totalProfit);
		});

		it("should return users sorted by totalValue metric", async () => {
			// Create test users
			const user1 = await call(createUser, { username: "valueInvestor1" }, createTestContext(db));
			const user2 = await call(createUser, { username: "valueInvestor2" }, createTestContext(db));

			// Create asset
			const assetData: InsertDbInvestmentAsset = {
				symbol: "MSFT",
				name: "Microsoft",
				assetType: "stock_us",
				apiSource: "twelvedata",
				apiSymbol: "MSFT",
				isActive: true,
				minInvestment: 100,
			};
			const [asset] = await db.insert(investmentAssetsTable).values(assetData).returning();

			if (!asset) throw new Error("Failed to create asset");

			// Create price cache
			const priceData: InsertDbInvestmentPriceCache = {
				assetId: asset.id,
				price: 30000, // $300.00
				priceTimestamp: new Date(),
			};
			await db.insert(investmentPriceCacheTable).values(priceData);

			// User1: 10 shares @ $300 = 3000 currentValue
			const portfolio1: InsertDbInvestmentPortfolio = {
				userId: user1.id,
				assetId: asset.id,
				quantity: 10000,
				averageBuyPrice: 20000,
				totalInvested: 2000,
				realizedGains: 0,
			};

			// User2: 20 shares @ $300 = 6000 currentValue
			const portfolio2: InsertDbInvestmentPortfolio = {
				userId: user2.id,
				assetId: asset.id,
				quantity: 20000,
				averageBuyPrice: 25000,
				totalInvested: 5000,
				realizedGains: 0,
			};

			await db.insert(investmentPortfoliosTable).values([portfolio1, portfolio2]);

			const result = await call(
				investmentLeaderboard,
				{ metric: "totalValue", limit: 10 },
				createTestContext(db),
			);

			// Find our test users
			const valueInvestor1 = result.find(r => r.user.username === "valueInvestor1");
			const valueInvestor2 = result.find(r => r.user.username === "valueInvestor2");

			expect(valueInvestor1).toBeDefined();
			expect(valueInvestor2).toBeDefined();
			expect(valueInvestor2!.currentValue).toBe(6000);
			expect(valueInvestor1!.currentValue).toBe(3000);
			expect(valueInvestor2!.rank).toBeLessThan(valueInvestor1!.rank);
		});

		it("should return users sorted by profitPercent metric", async () => {
			// Create test users
			const user1 = await call(createUser, { username: "percentInvestor1" }, createTestContext(db));
			const user2 = await call(createUser, { username: "percentInvestor2" }, createTestContext(db));

			// Create asset
			const assetData: InsertDbInvestmentAsset = {
				symbol: "TSLA",
				name: "Tesla",
				assetType: "stock_us",
				apiSource: "twelvedata",
				apiSymbol: "TSLA",
				isActive: true,
				minInvestment: 100,
			};
			const [asset] = await db.insert(investmentAssetsTable).values(assetData).returning();

			if (!asset) throw new Error("Failed to create asset");

			// Create price cache
			const priceData: InsertDbInvestmentPriceCache = {
				assetId: asset.id,
				price: 20000, // $200.00
				priceTimestamp: new Date(),
			};
			await db.insert(investmentPriceCacheTable).values(priceData);

			// User1: invested 1000, current ~1500 + realized 100 = ~60% profit
			const portfolio1: InsertDbInvestmentPortfolio = {
				userId: user1.id,
				assetId: asset.id,
				quantity: 7500,
				averageBuyPrice: 13333,
				totalInvested: 1000,
				realizedGains: 100,
			};

			// User2: invested 2000, current ~3000 + realized 200 = ~60% profit
			const portfolio2: InsertDbInvestmentPortfolio = {
				userId: user2.id,
				assetId: asset.id,
				quantity: 15000,
				averageBuyPrice: 13333,
				totalInvested: 2000,
				realizedGains: 200,
			};

			await db.insert(investmentPortfoliosTable).values([portfolio1, portfolio2]);

			const result = await call(
				investmentLeaderboard,
				{ metric: "profitPercent", limit: 10 },
				createTestContext(db),
			);

			const percentInvestor1 = result.find(r => r.user.username === "percentInvestor1");
			const percentInvestor2 = result.find(r => r.user.username === "percentInvestor2");

			expect(percentInvestor1).toBeDefined();
			expect(percentInvestor2).toBeDefined();
			// Both should have similar profit percent
			expect(Math.abs(percentInvestor1!.profitPercent - percentInvestor2!.profitPercent)).toBeLessThan(5);
		});

		it("should respect limit parameter", async () => {
			const result = await call(
				investmentLeaderboard,
				{ metric: "totalProfit", limit: 3 },
				createTestContext(db),
			);

			expect(result.length).toBeLessThanOrEqual(3);
			// Verify ranks are sequential
			for (let i = 0; i < result.length; i++) {
				expect(result[i]?.rank).toBe(i + 1);
			}
		});

		it("should handle division by zero for profitPercent (0 totalInvested)", async () => {
			const user = await call(createUser, { username: "zeroInvestor" }, createTestContext(db));

			// Create asset
			const assetData: InsertDbInvestmentAsset = {
				symbol: "BTC",
				name: "Bitcoin",
				assetType: "crypto",
				apiSource: "twelvedata",
				apiSymbol: "BTC",
				isActive: true,
				minInvestment: 100,
			};
			const [asset] = await db.insert(investmentAssetsTable).values(assetData).returning();

			if (!asset) throw new Error("Failed to create asset");

			// Create price cache
			const priceData: InsertDbInvestmentPriceCache = {
				assetId: asset.id,
				price: 5000000,
				priceTimestamp: new Date(),
			};
			await db.insert(investmentPriceCacheTable).values(priceData);

			// Portfolio with 0 totalInvested (edge case) but some quantity
			const portfolio: InsertDbInvestmentPortfolio = {
				userId: user.id,
				assetId: asset.id,
				quantity: 1000,
				averageBuyPrice: 5000000,
				totalInvested: 0,
				realizedGains: 0,
			};

			await db.insert(investmentPortfoliosTable).values(portfolio);

			const result = await call(
				investmentLeaderboard,
				{ metric: "profitPercent", limit: 100 },
				createTestContext(db),
			);

			// User should appear with 0% profit (no division by zero error)
			const zeroInvestor = result.find(r => r.user.username === "zeroInvestor");
			expect(zeroInvestor).toBeDefined();
			expect(zeroInvestor!.profitPercent).toBe(0);
		});

		it("should return proper rank numbers", async () => {
			const result = await call(
				investmentLeaderboard,
				{ metric: "totalProfit", limit: 10 },
				createTestContext(db),
			);

			// Verify ranks are sequential starting from 1
			for (let i = 0; i < result.length; i++) {
				expect(result[i]?.rank).toBe(i + 1);
			}
		});
	});

	describe("getInvestmentSummary", () => {
		it("should return zeros for user with no investments", async () => {
			const user = await call(createUser, { username: "noInvestmentUser" }, createTestContext(db));

			const result = await call(getInvestmentSummary, { userId: user.id }, createTestContext(db));

			expect(result).toEqual({
				totalInvested: 0,
				currentValue: 0,
				totalProfit: 0,
				profitPercent: 0,
				realizedGains: 0,
				unrealizedGains: 0,
				holdingsCount: 0,
			});
		});

		it("should return correct totals for user with investments", async () => {
			const user = await call(createUser, { username: "summaryUser" }, createTestContext(db));

			// Create asset
			const assetData: InsertDbInvestmentAsset = {
				symbol: "NFLX",
				name: "Netflix",
				assetType: "stock_us",
				apiSource: "twelvedata",
				apiSymbol: "NFLX",
				isActive: true,
				minInvestment: 100,
			};
			const [asset] = await db.insert(investmentAssetsTable).values(assetData).returning();

			if (!asset) throw new Error("Failed to create asset");

			// Create price cache: current price $400
			const priceData: InsertDbInvestmentPriceCache = {
				assetId: asset.id,
				price: 40000,
				priceTimestamp: new Date(),
			};
			await db.insert(investmentPriceCacheTable).values(priceData);

			// Portfolio: 10 shares @ avg $300, current $400
			// totalInvested: 3000
			// currentValue: 4000
			// unrealizedGains: 1000
			// realizedGains: 250
			// totalProfit: 1250
			// profitPercent: 41.67%
			const portfolio: InsertDbInvestmentPortfolio = {
				userId: user.id,
				assetId: asset.id,
				quantity: 10000,
				averageBuyPrice: 30000,
				totalInvested: 3000,
				realizedGains: 250,
			};

			await db.insert(investmentPortfoliosTable).values(portfolio);

			const result = await call(getInvestmentSummary, { userId: user.id }, createTestContext(db));

			expect(result.totalInvested).toBe(3000);
			expect(result.currentValue).toBe(4000);
			expect(result.unrealizedGains).toBe(1000);
			expect(result.realizedGains).toBe(250);
			expect(result.totalProfit).toBe(1250);
			expect(result.profitPercent).toBeCloseTo(41.67, 1);
			expect(result.holdingsCount).toBe(1);
		});

		it("should handle multiple holdings correctly", async () => {
			const user = await call(createUser, { username: "multiHoldingUser" }, createTestContext(db));

			// Create two assets
			const asset1Data: InsertDbInvestmentAsset = {
				symbol: "FB",
				name: "Meta",
				assetType: "stock_us",
				apiSource: "twelvedata",
				apiSymbol: "FB",
				isActive: true,
				minInvestment: 100,
			};
			const [asset1] = await db.insert(investmentAssetsTable).values(asset1Data).returning();

			const asset2Data: InsertDbInvestmentAsset = {
				symbol: "NVDA",
				name: "Nvidia",
				assetType: "stock_us",
				apiSource: "twelvedata",
				apiSymbol: "NVDA",
				isActive: true,
				minInvestment: 100,
			};
			const [asset2] = await db.insert(investmentAssetsTable).values(asset2Data).returning();

			if (!asset1 || !asset2) throw new Error("Failed to create assets");

			// Create price caches
			await db.insert(investmentPriceCacheTable).values([
				{ assetId: asset1.id, price: 30000, priceTimestamp: new Date() },
				{ assetId: asset2.id, price: 50000, priceTimestamp: new Date() },
			]);

			// Create portfolios
			const portfolios = [
				{
					userId: user.id,
					assetId: asset1.id,
					quantity: 10000, // 10 shares @ $300 = 3000
					averageBuyPrice: 25000,
					totalInvested: 2500,
					realizedGains: 100,
				},
				{
					userId: user.id,
					assetId: asset2.id,
					quantity: 5000, // 5 shares @ $500 = 2500
					averageBuyPrice: 40000,
					totalInvested: 2000,
					realizedGains: 50,
				},
			];

			await db.insert(investmentPortfoliosTable).values(portfolios);

			const result = await call(getInvestmentSummary, { userId: user.id }, createTestContext(db));

			expect(result.totalInvested).toBe(4500);
			expect(result.currentValue).toBe(5500);
			expect(result.realizedGains).toBe(150);
			expect(result.unrealizedGains).toBe(1000);
			expect(result.totalProfit).toBe(1150);
			expect(result.holdingsCount).toBe(2);
		});

		it("should include realizedGains in totalProfit", async () => {
			const user = await call(createUser, { username: "realizedGainsUser" }, createTestContext(db));

			// Create asset
			const assetData: InsertDbInvestmentAsset = {
				symbol: "AMD",
				name: "AMD",
				assetType: "stock_us",
				apiSource: "twelvedata",
				apiSymbol: "AMD",
				isActive: true,
				minInvestment: 100,
			};
			const [asset] = await db.insert(investmentAssetsTable).values(assetData).returning();

			if (!asset) throw new Error("Failed to create asset");

			// Price same as average buy price
			const priceData: InsertDbInvestmentPriceCache = {
				assetId: asset.id,
				price: 10000,
				priceTimestamp: new Date(),
			};
			await db.insert(investmentPriceCacheTable).values(priceData);

			// Portfolio with no unrealized gains but has realized gains
			const portfolio: InsertDbInvestmentPortfolio = {
				userId: user.id,
				assetId: asset.id,
				quantity: 10000,
				averageBuyPrice: 10000, // Same as current price
				totalInvested: 1000,
				realizedGains: 500, // From previous sells
			};

			await db.insert(investmentPortfoliosTable).values(portfolio);

			const result = await call(getInvestmentSummary, { userId: user.id }, createTestContext(db));

			expect(result.unrealizedGains).toBe(0);
			expect(result.realizedGains).toBe(500);
			expect(result.totalProfit).toBe(500);
		});
	});

	describe("userStatsWithInvestments", () => {
		it("should return user stats + investment summary", async () => {
			const user = await call(createUser, { username: "statsInvestUser" }, createTestContext(db));

			// Create asset and portfolio
			const assetData: InsertDbInvestmentAsset = {
				symbol: "UBER",
				name: "Uber",
				assetType: "stock_us",
				apiSource: "twelvedata",
				apiSymbol: "UBER",
				isActive: true,
				minInvestment: 100,
			};
			const [asset] = await db.insert(investmentAssetsTable).values(assetData).returning();

			if (!asset) throw new Error("Failed to create asset");

			// Create price cache
			const priceData: InsertDbInvestmentPriceCache = {
				assetId: asset.id,
				price: 5000,
				priceTimestamp: new Date(),
			};
			await db.insert(investmentPriceCacheTable).values(priceData);

			// Create portfolio
			const portfolio: InsertDbInvestmentPortfolio = {
				userId: user.id,
				assetId: asset.id,
				quantity: 10000,
				averageBuyPrice: 4000,
				totalInvested: 400,
				realizedGains: 50,
			};

			await db.insert(investmentPortfoliosTable).values(portfolio);

			const result = await call(userStatsWithInvestments, { id: user.id }, createTestContext(db));

			expect(result.stats).toBeDefined();
			expect(result.stats.userId).toBe(user.id);
			expect(result.levelProgress).toBeDefined();
			expect(result.investments).toBeDefined();
			expect(result.investments.totalInvested).toBe(400);
			expect(result.investments.currentValue).toBe(500);
			expect(result.totalWealth).toBeDefined();
		});

		it("should return totalWealth = coins + investment currentValue", async () => {
			const user = await call(createUser, { username: "wealthUser" }, createTestContext(db));

			// Get user stats to check initial coins
			const stats = await call(userStatsWithInvestments, { id: user.id }, createTestContext(db));
			const initialCoins = stats.stats.coinsCount;

			// Create asset and portfolio
			const assetData: InsertDbInvestmentAsset = {
				symbol: "LYFT",
				name: "Lyft",
				assetType: "stock_us",
				apiSource: "twelvedata",
				apiSymbol: "LYFT",
				isActive: true,
				minInvestment: 100,
			};
			const [asset] = await db.insert(investmentAssetsTable).values(assetData).returning();

			if (!asset) throw new Error("Failed to create asset");

			// Create price cache
			const priceData: InsertDbInvestmentPriceCache = {
				assetId: asset.id,
				price: 2000,
				priceTimestamp: new Date(),
			};
			await db.insert(investmentPriceCacheTable).values(priceData);

			// Create portfolio worth 1000
			const portfolio: InsertDbInvestmentPortfolio = {
				userId: user.id,
				assetId: asset.id,
				quantity: 50000, // 50 shares @ $20 = 1000
				averageBuyPrice: 2000,
				totalInvested: 1000,
				realizedGains: 0,
			};

			await db.insert(investmentPortfoliosTable).values(portfolio);

			const result = await call(userStatsWithInvestments, { id: user.id }, createTestContext(db));

			expect(result.investments.currentValue).toBe(1000);
			expect(result.totalWealth).toBe(initialCoins + 1000);
		});

		it("should handle user with no investments", async () => {
			const user = await call(createUser, { username: "noInvestStatsUser" }, createTestContext(db));

			const result = await call(userStatsWithInvestments, { id: user.id }, createTestContext(db));

			expect(result.stats).toBeDefined();
			expect(result.investments.totalInvested).toBe(0);
			expect(result.investments.currentValue).toBe(0);
			expect(result.investments.holdingsCount).toBe(0);
			expect(result.totalWealth).toBe(result.stats.coinsCount);
		});

		it("should throw NOT_FOUND for non-existent user", async () => {
			expect(async () => {
				await call(userStatsWithInvestments, { id: 999999 }, createTestContext(db));
			}).toThrow(
				new ORPCError("NOT_FOUND", {
					message: "User not found for the given identifiers / userStatsWithInvestments",
				}),
			);
		});
	});

	describe("Multi-transaction realistic scenarios", () => {
		/**
		 * Helper to update the price cache for an asset
		 */
		async function updatePrice(testDb: typeof db, assetId: number, newPrice: number) {
			await testDb.insert(investmentPriceCacheTable).values({
				assetId,
				price: newPrice,
				priceTimestamp: new Date(),
			});
		}

		/**
		 * Helper to verify all investment calculations at a given state
		 */
		async function verifyInvestmentState(
			testDb: typeof db,
			userId: number,
			currentPrice: number,
			expected: {
				coins: number;
				quantity: number;
				totalInvested: number;
				averageBuyPrice: number;
				realizedGains: number;
				currentValue: number;
				unrealizedGains: number;
				totalProfit: number;
				profitPercent: number;
			},
			label: string,
		) {
			// Get user coins
			const [userStats] = await testDb
				.select()
				.from(userStatsTable)
				.where(eq(userStatsTable.userId, userId));

			// Get portfolio
			const [portfolio] = await testDb
				.select()
				.from(investmentPortfoliosTable)
				.where(eq(investmentPortfoliosTable.userId, userId));

			// Get summary
			const summary = await call(getInvestmentSummary, { userId }, createTestContext(testDb));

			console.log(`\n=== ${label} ===`);
			console.log(`Current Price: $${(currentPrice / 100).toFixed(2)}`);
			console.log(`User Coins: ${userStats?.coinsCount} (expected: ${expected.coins})`);

			if (portfolio) {
				console.log(`Portfolio Quantity: ${portfolio.quantity} (${(portfolio.quantity / 1000).toFixed(3)} shares) (expected: ${expected.quantity})`);
				console.log(`Total Invested: ${portfolio.totalInvested} (expected: ${expected.totalInvested})`);
				console.log(`Avg Buy Price: ${portfolio.averageBuyPrice} ($${(portfolio.averageBuyPrice / 100).toFixed(2)}) (expected: ${expected.averageBuyPrice})`);
				console.log(`Realized Gains: ${portfolio.realizedGains} (expected: ${expected.realizedGains})`);
			} else {
				console.log(`Portfolio: NONE (sold all)`);
			}

			console.log(`Summary - Current Value: ${summary.currentValue} (expected: ${expected.currentValue})`);
			console.log(`Summary - Unrealized Gains: ${summary.unrealizedGains} (expected: ${expected.unrealizedGains})`);
			console.log(`Summary - Realized Gains: ${summary.realizedGains} (expected: ${expected.realizedGains})`);
			console.log(`Summary - Total Profit: ${summary.totalProfit} (expected: ${expected.totalProfit})`);
			console.log(`Summary - Profit %: ${summary.profitPercent}% (expected: ${expected.profitPercent}%)`);

			// Verify user coins
			expect(userStats?.coinsCount).toBe(expected.coins);

			// Verify portfolio (if exists)
			if (expected.quantity > 0) {
				expect(portfolio).toBeDefined();
				expect(portfolio!.quantity).toBe(expected.quantity);
				expect(portfolio!.totalInvested).toBe(expected.totalInvested);
				expect(portfolio!.averageBuyPrice).toBe(expected.averageBuyPrice);
				expect(portfolio!.realizedGains).toBe(expected.realizedGains);
			}

			// Verify summary
			expect(summary.currentValue).toBe(expected.currentValue);
			expect(summary.unrealizedGains).toBe(expected.unrealizedGains);
			expect(summary.realizedGains).toBe(expected.realizedGains);
			expect(summary.totalProfit).toBe(expected.totalProfit);
			expect(summary.profitPercent).toBeCloseTo(expected.profitPercent, 1);
		}

		it("should verify exact calculations at each step of multi-transaction scenario", async () => {
			const testDb = await createTestDatabase();
			const ctx = createTestContext(testDb);

			// Create user with 100,000 coins
			const user = await call(createUser, { username: "preciseTrader" }, ctx);
			await testDb
				.update(userStatsTable)
				.set({ coinsCount: 100000 })
				.where(eq(userStatsTable.userId, user.id));

			// Create asset
			const [asset] = await testDb.insert(investmentAssetsTable).values({
				symbol: "CALC",
				name: "Calculation Test Stock",
				assetType: "stock_us",
				apiSource: "twelvedata",
				apiSymbol: "CALC",
				isActive: true,
				minInvestment: 100,
			}).returning();

			if (!asset) throw new Error("Failed to create asset");

			console.log("\n========================================");
			console.log("DETAILED INVESTMENT CALCULATION TEST");
			console.log("Starting coins: 100,000");
			console.log("Fee rate: 1.5%");
			console.log("========================================");

			// ============================================================
			// TRANSACTION 1: Buy 1000 coins worth @ $100 per share
			// ============================================================
			await updatePrice(testDb, asset.id, 10000); // $100.00

			const buy1 = await call(buyAsset, {
				userId: user.id,
				symbol: "CALC",
				amountInCoins: 1000,
			}, ctx);

			// Manual calculation:
			// amountInCoins = 1000
			// fee = floor(1000 * 150 / 10000) = floor(15) = 15
			// coinsAfterFee = 1000 - 15 = 985
			// quantity = floor(985 * 1000 * 100 / 10000) = floor(9850000 / 10000) = 9850
			// subtotal = floor(9850 * 10000 / 100000) = floor(985) = 985
			// totalCost = 985 + 15 = 1000
			// avgPrice = 10000 (first buy, equals current price)

			expect(buy1.transaction.feeAmount).toBe(15);
			expect(buy1.transaction.quantity).toBe(9850);
			expect(buy1.transaction.subtotal).toBe(985);
			expect(buy1.transaction.totalAmount).toBe(1000);

			await verifyInvestmentState(testDb, user.id, 10000, {
				coins: 100000 - 1000, // 99000
				quantity: 9850,
				totalInvested: 985,
				averageBuyPrice: 10000,
				realizedGains: 0,
				currentValue: 985, // 9850 * 10000 / 100000 = 985
				unrealizedGains: 0, // 985 - 985 = 0
				totalProfit: 0,
				profitPercent: 0,
			}, "After BUY #1: 1000 coins @ $100");

			// ============================================================
			// TRANSACTION 2: Buy 2000 coins worth @ $80 per share
			// ============================================================
			await updatePrice(testDb, asset.id, 8000); // $80.00

			const buy2 = await call(buyAsset, {
				userId: user.id,
				symbol: "CALC",
				amountInCoins: 2000,
			}, ctx);

			// Manual calculation:
			// fee = floor(2000 * 150 / 10000) = 30
			// coinsAfterFee = 2000 - 30 = 1970
			// quantity = floor(1970 * 1000 * 100 / 8000) = floor(24625) = 24625
			// subtotal = floor(24625 * 8000 / 100000) = floor(1970) = 1970
			// totalCost = 1970 + 30 = 2000
			// newQuantity = 9850 + 24625 = 34475
			// newTotalInvested = 985 + 1970 = 2955
			// newAvgPrice = floor(2955 * 100 / (34475 / 1000)) = floor(295500 / 34.475) = floor(8571.56) = 8571

			expect(buy2.transaction.feeAmount).toBe(30);
			expect(buy2.transaction.quantity).toBe(24625);
			expect(buy2.transaction.subtotal).toBe(1970);
			expect(buy2.transaction.totalAmount).toBe(2000);

			// Current value at $80: 34475 * 8000 / 100000 = 2758
			// Unrealized = 2758 - 2955 = -197 (underwater!)
			await verifyInvestmentState(testDb, user.id, 8000, {
				coins: 99000 - 2000, // 97000
				quantity: 34475,
				totalInvested: 2955,
				averageBuyPrice: 8571,
				realizedGains: 0,
				currentValue: 2758,
				unrealizedGains: -197,
				totalProfit: -197,
				profitPercent: -6.67, // -197 / 2955 * 100
			}, "After BUY #2: 2000 coins @ $80");

			// ============================================================
			// TRANSACTION 3: SELL 50% @ $120 per share
			// ============================================================
			await updatePrice(testDb, asset.id, 12000); // $120.00

			const sell1 = await call(sellAsset, {
				userId: user.id,
				symbol: "CALC",
				sellType: "percentage",
				percentage: 50,
			}, ctx);

			// Manual calculation:
			// quantityToSell = floor(34475 * 50 / 100) = 17237
			// subtotal = floor(17237 * 12000 / 100000) = floor(2068.44) = 2068
			// fee = floor(2068 * 150 / 10000) = floor(31.02) = 31
			// netProceeds = 2068 - 31 = 2037
			// costBasis = floor(17237 * 8571 / 100000) = floor(1477.06) = 1477
			// realizedGain = 2037 - 1477 = 560
			// remainingQuantity = 34475 - 17237 = 17238
			// newTotalInvested = floor(17238 * 8571 / 100000) = floor(1477.14) = 1477

			expect(sell1.transaction.quantity).toBe(17237);
			expect(sell1.transaction.subtotal).toBe(2068);
			expect(sell1.transaction.feeAmount).toBe(31);
			expect(sell1.transaction.totalAmount).toBe(2037);
			expect(sell1.profitLoss).toBe(560);

			// Current value at $120: 17238 * 12000 / 100000 = 2068 (rounded down = 2068)
			// Unrealized = 2068 - 1477 = 591
			await verifyInvestmentState(testDb, user.id, 12000, {
				coins: 97000 + 2037, // 99037
				quantity: 17238,
				totalInvested: 1477,
				averageBuyPrice: 8571, // unchanged
				realizedGains: 560,
				currentValue: 2068,
				unrealizedGains: 591,
				totalProfit: 1151, // 560 + 591
				profitPercent: 77.93, // 1151 / 1477 * 100
			}, "After SELL #1: 50% @ $120");

			// ============================================================
			// TRANSACTION 4: Buy 3000 coins @ $60 per share
			// ============================================================
			await updatePrice(testDb, asset.id, 6000); // $60.00

			const buy3 = await call(buyAsset, {
				userId: user.id,
				symbol: "CALC",
				amountInCoins: 3000,
			}, ctx);

			// Manual calculation:
			// fee = floor(3000 * 150 / 10000) = 45
			// coinsAfterFee = 3000 - 45 = 2955
			// quantity = floor(2955 * 1000 * 100 / 6000) = floor(49250) = 49250
			// subtotal = floor(49250 * 6000 / 100000) = floor(2955) = 2955
			// totalCost = 2955 + 45 = 3000
			// newQuantity = 17238 + 49250 = 66488
			// newTotalInvested = 1477 + 2955 = 4432
			// newAvgPrice = floor(4432 * 100 / (66488 / 1000)) = floor(443200 / 66.488) = floor(6665.86) = 6665

			expect(buy3.transaction.feeAmount).toBe(45);
			expect(buy3.transaction.quantity).toBe(49250);
			expect(buy3.transaction.subtotal).toBe(2955);
			expect(buy3.transaction.totalAmount).toBe(3000);

			// Current value at $60: 66488 * 6000 / 100000 = 3989
			// Unrealized = 3989 - 4432 = -443
			await verifyInvestmentState(testDb, user.id, 6000, {
				coins: 99037 - 3000, // 96037
				quantity: 66488,
				totalInvested: 4432,
				averageBuyPrice: 6665,
				realizedGains: 560,
				currentValue: 3989,
				unrealizedGains: -443,
				totalProfit: 117, // 560 - 443
				profitPercent: 2.64, // 117 / 4432 * 100
			}, "After BUY #3: 3000 coins @ $60");

			// ============================================================
			// TRANSACTION 5: SELL ALL @ $100 per share
			// ============================================================
			await updatePrice(testDb, asset.id, 10000); // $100.00

			const sellAll = await call(sellAsset, {
				userId: user.id,
				symbol: "CALC",
				sellType: "all",
			}, ctx);

			// Manual calculation:
			// quantityToSell = 66488 (all)
			// subtotal = floor(66488 * 10000 / 100000) = floor(6648.8) = 6648
			// fee = floor(6648 * 150 / 10000) = floor(99.72) = 99
			// netProceeds = 6648 - 99 = 6549
			// costBasis = floor(66488 * 6665 / 100000) = floor(4431.42) = 4431
			// realizedGain = 6549 - 4431 = 2118
			// totalRealizedGains = 560 + 2118 = 2678

			expect(sellAll.transaction.quantity).toBe(66488);
			expect(sellAll.transaction.subtotal).toBe(6648);
			expect(sellAll.transaction.feeAmount).toBe(99);
			expect(sellAll.transaction.totalAmount).toBe(6549);
			expect(sellAll.profitLoss).toBe(2118);
			expect(sellAll.portfolio).toBeUndefined(); // Portfolio deleted

			// Final state - no holdings
			const [finalStats] = await testDb
				.select()
				.from(userStatsTable)
				.where(eq(userStatsTable.userId, user.id));

			const finalSummary = await call(getInvestmentSummary, { userId: user.id }, ctx);

			const expectedFinalCoins = 96037 + 6549; // 102586
			const totalProfit = expectedFinalCoins - 100000; // 2586

			console.log("\n=== FINAL STATE ===");
			console.log(`Final Coins: ${finalStats?.coinsCount} (expected: ${expectedFinalCoins})`);
			console.log(`Net Profit: ${totalProfit} coins`);
			console.log(`Total Realized Gains: ${560 + 2118} = 2678`);
			console.log(`Summary Holdings: ${finalSummary.holdingsCount}`);

			expect(finalStats?.coinsCount).toBe(expectedFinalCoins);
			expect(finalSummary.holdingsCount).toBe(0);
			expect(finalSummary.currentValue).toBe(0);
			expect(finalSummary.totalInvested).toBe(0);
			expect(finalSummary.realizedGains).toBe(0); // No portfolio = no realized gains tracked
			expect(finalSummary.totalProfit).toBe(0);

			console.log("\n========================================");
			console.log("TEST COMPLETED SUCCESSFULLY");
			console.log(`Started: 100,000 coins`);
			console.log(`Ended: ${expectedFinalCoins} coins`);
			console.log(`Net Profit: ${totalProfit} coins (${(totalProfit / 1000).toFixed(2)}%)`);
			console.log("========================================\n");
		});

		it("should verify exact calculations through 20 volatile transactions", async () => {
			const testDb = await createTestDatabase();
			const ctx = createTestContext(testDb);

			// Create user with 100,000 coins
			const user = await call(createUser, { username: "volatileTrader" }, ctx);
			await testDb
				.update(userStatsTable)
				.set({ coinsCount: 100000 })
				.where(eq(userStatsTable.userId, user.id));

			// Create asset
			const [asset] = await testDb.insert(investmentAssetsTable).values({
				symbol: "VOLATILE",
				name: "Highly Volatile Stock",
				assetType: "stock_us",
				apiSource: "twelvedata",
				apiSymbol: "VOLATILE",
				minInvestment: 100,
				isActive: true,
			}).returning();

			if (!asset) throw new Error("Failed to create asset");
			const assetId = asset.id;

			// Initial price $100
			await updatePrice(testDb, assetId, 10000);

			console.log("\n========================================");
			console.log("20-TRANSACTION VOLATILE TEST");
			console.log("Starting coins: 100,000");
			console.log("Fee rate: 1.5%");
			console.log("Price swings: $100 → $75 → $50 → $40 → $60 → $120 → $95 → $150 → $110 → $80");
			console.log("             → $65 → $55 → $70 → $45 → $90 → $85 → $140 → $125 → $180 → $160");
			console.log("========================================\n");

			// ============================================================
			// TRANSACTION 1: BUY 5000 coins @ $100
			// ============================================================
			const buy1 = await call(buyAsset, {
				userId: user.id,
				symbol: "VOLATILE",
				amountInCoins: 5000,
			}, ctx);

			expect(buy1.transaction.feeAmount).toBe(75);
			expect(buy1.transaction.quantity).toBe(49250);
			expect(buy1.transaction.subtotal).toBe(4925);

			await verifyInvestmentState(testDb, user.id, 10000, {
				coins: 95000,
				quantity: 49250,
				totalInvested: 4925,
				averageBuyPrice: 10000,
				realizedGains: 0,
				currentValue: 4925,
				unrealizedGains: 0,
				totalProfit: 0,
				profitPercent: 0,
			}, "TX 1: BUY 5000 @ $100");

			// ============================================================
			// TRANSACTION 2: BUY 3000 coins @ $75 (crash)
			// ============================================================
			await updatePrice(testDb, assetId, 7500);

			const buy2 = await call(buyAsset, {
				userId: user.id,
				symbol: "VOLATILE",
				amountInCoins: 3000,
			}, ctx);

			expect(buy2.transaction.feeAmount).toBe(45);
			expect(buy2.transaction.quantity).toBe(39400);

			await verifyInvestmentState(testDb, user.id, 7500, {
				coins: 92000,
				quantity: 88650,
				totalInvested: 7880,
				averageBuyPrice: 8888,
				realizedGains: 0,
				currentValue: 6648,
				unrealizedGains: -1232,
				totalProfit: -1232,
				profitPercent: -15.63,
			}, "TX 2: BUY 3000 @ $75 (crash)");

			// ============================================================
			// TRANSACTION 3: SELL 25% @ $50 (flash crash, panic sell)
			// ============================================================
			await updatePrice(testDb, assetId, 5000);

			const sell3 = await call(sellAsset, {
				userId: user.id,
				symbol: "VOLATILE",
				sellType: "percentage",
				percentage: 25,
			}, ctx);

			expect(sell3.transaction.quantity).toBe(22162);
			expect(sell3.transaction.feeAmount).toBe(16);
			expect(sell3.profitLoss).toBe(-877);

			await verifyInvestmentState(testDb, user.id, 5000, {
				coins: 93092,
				quantity: 66488,
				totalInvested: 5909,
				averageBuyPrice: 8888,
				realizedGains: -877,
				currentValue: 3324,
				unrealizedGains: -2585,
				totalProfit: -3462,
				profitPercent: -58.59,
			}, "TX 3: SELL 25% @ $50 (flash crash)");

			// ============================================================
			// TRANSACTION 4: BUY 8000 coins @ $40 (bottom, buy heavily)
			// ============================================================
			await updatePrice(testDb, assetId, 4000);

			const buy4 = await call(buyAsset, {
				userId: user.id,
				symbol: "VOLATILE",
				amountInCoins: 8000,
			}, ctx);

			expect(buy4.transaction.feeAmount).toBe(120);
			expect(buy4.transaction.quantity).toBe(197000);

			await verifyInvestmentState(testDb, user.id, 4000, {
				coins: 85092,
				quantity: 263488,
				totalInvested: 13789,
				averageBuyPrice: 5233,
				realizedGains: -877,
				currentValue: 10539,
				unrealizedGains: -3250,
				totalProfit: -4127,
				profitPercent: -29.93,
			}, "TX 4: BUY 8000 @ $40 (bottom)");

			// ============================================================
			// TRANSACTION 5: BUY 2000 coins @ $60 (recovery)
			// ============================================================
			await updatePrice(testDb, assetId, 6000);

			const buy5 = await call(buyAsset, {
				userId: user.id,
				symbol: "VOLATILE",
				amountInCoins: 2000,
			}, ctx);

			expect(buy5.transaction.feeAmount).toBe(30);
			expect(buy5.transaction.quantity).toBe(32833);

			await verifyInvestmentState(testDb, user.id, 6000, {
				coins: 83093,
				quantity: 296321,
				totalInvested: 15758,
				averageBuyPrice: 5317,
				realizedGains: -877,
				currentValue: 17779,
				unrealizedGains: 2021,
				totalProfit: 1144,
				profitPercent: 7.26,
			}, "TX 5: BUY 2000 @ $60 (recovery)");

			// ============================================================
			// TRANSACTION 6: SELL 30% @ $120 (spike, take profits)
			// ============================================================
			await updatePrice(testDb, assetId, 12000);

			const sell6 = await call(sellAsset, {
				userId: user.id,
				symbol: "VOLATILE",
				sellType: "percentage",
				percentage: 30,
			}, ctx);

			expect(sell6.transaction.quantity).toBe(88896);
			expect(sell6.transaction.feeAmount).toBe(160);
			expect(sell6.profitLoss).toBe(5781);

			await verifyInvestmentState(testDb, user.id, 12000, {
				coins: 93600,
				quantity: 207425,
				totalInvested: 11028,
				averageBuyPrice: 5317,
				realizedGains: 4904,
				currentValue: 24891,
				unrealizedGains: 13863,
				totalProfit: 18767,
				profitPercent: 170.18,
			}, "TX 6: SELL 30% @ $120 (spike)");

			// ============================================================
			// TRANSACTION 7: BUY 4000 coins @ $95 (pullback)
			// ============================================================
			await updatePrice(testDb, assetId, 9500);

			const buy7 = await call(buyAsset, {
				userId: user.id,
				symbol: "VOLATILE",
				amountInCoins: 4000,
			}, ctx);

			expect(buy7.transaction.feeAmount).toBe(60);
			expect(buy7.transaction.quantity).toBe(41473);

			await verifyInvestmentState(testDb, user.id, 9500, {
				coins: 89601,
				quantity: 248898,
				totalInvested: 14967,
				averageBuyPrice: 6013,
				realizedGains: 4904,
				currentValue: 23645,
				unrealizedGains: 8678,
				totalProfit: 13582,
				profitPercent: 90.75,
			}, "TX 7: BUY 4000 @ $95 (pullback)");

			// ============================================================
			// TRANSACTION 8: SELL 10% @ $150 (moon, trim position)
			// ============================================================
			await updatePrice(testDb, assetId, 15000);

			const sell8 = await call(sellAsset, {
				userId: user.id,
				symbol: "VOLATILE",
				sellType: "percentage",
				percentage: 10,
			}, ctx);

			expect(sell8.transaction.quantity).toBe(24889);
			expect(sell8.transaction.feeAmount).toBe(55);
			expect(sell8.profitLoss).toBe(2182);

			await verifyInvestmentState(testDb, user.id, 15000, {
				coins: 93279,
				quantity: 224009,
				totalInvested: 13469,
				averageBuyPrice: 6013,
				realizedGains: 7086,
				currentValue: 33601,
				unrealizedGains: 20132,
				totalProfit: 27218,
				profitPercent: 202.08,
			}, "TX 8: SELL 10% @ $150 (moon)");

			// ============================================================
			// TRANSACTION 9: BUY 6000 coins @ $110 (drop, accumulate)
			// ============================================================
			await updatePrice(testDb, assetId, 11000);

			const buy9 = await call(buyAsset, {
				userId: user.id,
				symbol: "VOLATILE",
				amountInCoins: 6000,
			}, ctx);

			expect(buy9.transaction.feeAmount).toBe(90);
			expect(buy9.transaction.quantity).toBe(53727);

			await verifyInvestmentState(testDb, user.id, 11000, {
				coins: 87280,
				quantity: 277736,
				totalInvested: 19378,
				averageBuyPrice: 6977,
				realizedGains: 7086,
				currentValue: 30550,
				unrealizedGains: 11172,
				totalProfit: 18258,
				profitPercent: 94.22,
			}, "TX 9: BUY 6000 @ $110 (accumulate)");

			// ============================================================
			// TRANSACTION 10: SELL 50% @ $80 (crash, sell half)
			// ============================================================
			await updatePrice(testDb, assetId, 8000);

			const sell10 = await call(sellAsset, {
				userId: user.id,
				symbol: "VOLATILE",
				sellType: "percentage",
				percentage: 50,
			}, ctx);

			expect(sell10.transaction.quantity).toBe(138868);
			expect(sell10.transaction.feeAmount).toBe(166);
			expect(sell10.profitLoss).toBe(1255);

			await verifyInvestmentState(testDb, user.id, 8000, {
				coins: 98223,
				quantity: 138868,
				totalInvested: 9688,
				averageBuyPrice: 6977,
				realizedGains: 8341,
				currentValue: 11109,
				unrealizedGains: 1421,
				totalProfit: 9762,
				profitPercent: 100.76,
			}, "TX 10: SELL 50% @ $80 (crash)");

			// ============================================================
			// TRANSACTION 11: BUY 10000 coins @ $65 (continue down, DCA)
			// ============================================================
			await updatePrice(testDb, assetId, 6500);

			const buy11 = await call(buyAsset, {
				userId: user.id,
				symbol: "VOLATILE",
				amountInCoins: 10000,
			}, ctx);

			expect(buy11.transaction.feeAmount).toBe(150);
			expect(buy11.transaction.quantity).toBe(151538);

			await verifyInvestmentState(testDb, user.id, 6500, {
				coins: 88224,
				quantity: 290406,
				totalInvested: 19537,
				averageBuyPrice: 6727,
				realizedGains: 8341,
				currentValue: 18876,
				unrealizedGains: -661,
				totalProfit: 7680,
				profitPercent: 39.31,
			}, "TX 11: BUY 10000 @ $65 (DCA)");

			// ============================================================
			// TRANSACTION 12: BUY 5000 coins @ $55 (further down, DCA)
			// ============================================================
			await updatePrice(testDb, assetId, 5500);

			const buy12 = await call(buyAsset, {
				userId: user.id,
				symbol: "VOLATILE",
				amountInCoins: 5000,
			}, ctx);

			expect(buy12.transaction.feeAmount).toBe(75);
			expect(buy12.transaction.quantity).toBe(89545);

			await verifyInvestmentState(testDb, user.id, 5500, {
				coins: 83225,
				quantity: 379951,
				totalInvested: 24461,
				averageBuyPrice: 6437,
				realizedGains: 8341,
				currentValue: 20897,
				unrealizedGains: -3564,
				totalProfit: 4777,
				profitPercent: 19.53,
			}, "TX 12: BUY 5000 @ $55 (DCA)");

			// ============================================================
			// TRANSACTION 13: SELL 20% @ $70 (small bounce, trim)
			// ============================================================
			await updatePrice(testDb, assetId, 7000);

			const sell13 = await call(sellAsset, {
				userId: user.id,
				symbol: "VOLATILE",
				sellType: "percentage",
				percentage: 20,
			}, ctx);

			expect(sell13.transaction.quantity).toBe(75990);
			expect(sell13.transaction.feeAmount).toBe(79);
			expect(sell13.profitLoss).toBe(349);

			await verifyInvestmentState(testDb, user.id, 7000, {
				coins: 88465,
				quantity: 303961,
				totalInvested: 19565,
				averageBuyPrice: 6437,
				realizedGains: 8690,
				currentValue: 21277,
				unrealizedGains: 1712,
				totalProfit: 10402,
				profitPercent: 53.17,
			}, "TX 13: SELL 20% @ $70 (bounce)");

			// ============================================================
			// TRANSACTION 14: BUY 3000 coins @ $45 (new low)
			// ============================================================
			await updatePrice(testDb, assetId, 4500);

			const buy14 = await call(buyAsset, {
				userId: user.id,
				symbol: "VOLATILE",
				amountInCoins: 3000,
			}, ctx);

			expect(buy14.transaction.feeAmount).toBe(45);
			expect(buy14.transaction.quantity).toBe(65666);

			await verifyInvestmentState(testDb, user.id, 4500, {
				coins: 85466,
				quantity: 369627,
				totalInvested: 22519,
				averageBuyPrice: 6092,
				realizedGains: 8690,
				currentValue: 16633,
				unrealizedGains: -5886,
				totalProfit: 2804,
				profitPercent: 12.45,
			}, "TX 14: BUY 3000 @ $45 (new low)");

			// ============================================================
			// TRANSACTION 15: SELL 15% @ $90 (recovery, take some)
			// ============================================================
			await updatePrice(testDb, assetId, 9000);

			const sell15 = await call(sellAsset, {
				userId: user.id,
				symbol: "VOLATILE",
				sellType: "percentage",
				percentage: 15,
			}, ctx);

			expect(sell15.transaction.quantity).toBe(55444);
			expect(sell15.transaction.feeAmount).toBe(74);
			expect(sell15.profitLoss).toBe(1538);

			await verifyInvestmentState(testDb, user.id, 9000, {
				coins: 90381,
				quantity: 314183,
				totalInvested: 19140,
				averageBuyPrice: 6092,
				realizedGains: 10228,
				currentValue: 28276,
				unrealizedGains: 9136,
				totalProfit: 19364,
				profitPercent: 101.17,
			}, "TX 15: SELL 15% @ $90 (recovery)");

			// ============================================================
			// TRANSACTION 16: BUY 7000 coins @ $85 (dip, add)
			// ============================================================
			await updatePrice(testDb, assetId, 8500);

			const buy16 = await call(buyAsset, {
				userId: user.id,
				symbol: "VOLATILE",
				amountInCoins: 7000,
			}, ctx);

			expect(buy16.transaction.feeAmount).toBe(105);
			expect(buy16.transaction.quantity).toBe(81117);

			await verifyInvestmentState(testDb, user.id, 8500, {
				coins: 83382,
				quantity: 395300,
				totalInvested: 26034,
				averageBuyPrice: 6585,
				realizedGains: 10228,
				currentValue: 33600,
				unrealizedGains: 7566,
				totalProfit: 17794,
				profitPercent: 68.35,
			}, "TX 16: BUY 7000 @ $85 (dip)");

			// ============================================================
			// TRANSACTION 17: SELL 40% @ $140 (rally, big trim)
			// ============================================================
			await updatePrice(testDb, assetId, 14000);

			const sell17 = await call(sellAsset, {
				userId: user.id,
				symbol: "VOLATILE",
				sellType: "percentage",
				percentage: 40,
			}, ctx);

			expect(sell17.transaction.quantity).toBe(158120);
			expect(sell17.transaction.feeAmount).toBe(332);
			expect(sell17.profitLoss).toBe(11392);

			await verifyInvestmentState(testDb, user.id, 14000, {
				coins: 105186,
				quantity: 237180,
				totalInvested: 15618,
				averageBuyPrice: 6585,
				realizedGains: 21620,
				currentValue: 33205,
				unrealizedGains: 17587,
				totalProfit: 39207,
				profitPercent: 251.04,
			}, "TX 17: SELL 40% @ $140 (rally)");

			// ============================================================
			// TRANSACTION 18: BUY 2000 coins @ $125 (pullback, small add)
			// ============================================================
			await updatePrice(testDb, assetId, 12500);

			const buy18 = await call(buyAsset, {
				userId: user.id,
				symbol: "VOLATILE",
				amountInCoins: 2000,
			}, ctx);

			expect(buy18.transaction.feeAmount).toBe(30);
			expect(buy18.transaction.quantity).toBe(15760);

			await verifyInvestmentState(testDb, user.id, 12500, {
				coins: 103186,
				quantity: 252940,
				totalInvested: 17588,
				averageBuyPrice: 6953,
				realizedGains: 21620,
				currentValue: 31617,
				unrealizedGains: 14029,
				totalProfit: 35649,
				profitPercent: 202.69,
			}, "TX 18: BUY 2000 @ $125 (pullback)");

			// ============================================================
			// TRANSACTION 19: SELL 25% @ $180 (ATH, take profits)
			// ============================================================
			await updatePrice(testDb, assetId, 18000);

			const sell19 = await call(sellAsset, {
				userId: user.id,
				symbol: "VOLATILE",
				sellType: "percentage",
				percentage: 25,
			}, ctx);

			expect(sell19.transaction.quantity).toBe(63235);
			expect(sell19.transaction.feeAmount).toBe(170);
			expect(sell19.profitLoss).toBe(6816);

			await verifyInvestmentState(testDb, user.id, 18000, {
				coins: 114398,
				quantity: 189705,
				totalInvested: 13190,
				averageBuyPrice: 6953,
				realizedGains: 28436,
				currentValue: 34146,
				unrealizedGains: 20956,
				totalProfit: 49392,
				profitPercent: 374.47,
			}, "TX 19: SELL 25% @ $180 (ATH)");

			// ============================================================
			// TRANSACTION 20: SELL 100% @ $160 (exit all)
			// ============================================================
			await updatePrice(testDb, assetId, 16000);

			const sell20 = await call(sellAsset, {
				userId: user.id,
				symbol: "VOLATILE",
				sellType: "all",
			}, ctx);

			expect(sell20.transaction.quantity).toBe(189705);
			expect(sell20.transaction.feeAmount).toBe(455);
			expect(sell20.profitLoss).toBe(16707);
			expect(sell20.portfolio).toBeUndefined();

			// Final verification
			const [finalStats] = await testDb
				.select()
				.from(userStatsTable)
				.where(eq(userStatsTable.userId, user.id));

			const finalSummary = await call(getInvestmentSummary, { userId: user.id }, ctx);

			console.log("\n=== TX 20: SELL 100% @ $160 (exit all) ===");
			console.log(`Final Coins: ${finalStats?.coinsCount} (expected: 144295)`);
			console.log(`Net Profit: ${(finalStats?.coinsCount ?? 0) - 100000} coins`);
			console.log(`Total Realized Gains: 45143`);
			console.log(`Holdings: ${finalSummary.holdingsCount}`);

			expect(finalStats?.coinsCount).toBe(144295);
			expect(finalSummary.holdingsCount).toBe(0);
			expect(finalSummary.currentValue).toBe(0);
			expect(finalSummary.totalInvested).toBe(0);

			console.log("\n========================================");
			console.log("20-TRANSACTION TEST COMPLETED SUCCESSFULLY");
			console.log("Started: 100,000 coins");
			console.log("Ended: 144,295 coins");
			console.log("Net Profit: 44,295 coins (+44.3%)");
			console.log("Total Realized Gains: 45,143 coins");
			console.log("Fees Paid: ~848 coins");
			console.log("========================================\n");
		});

		it("should correctly track profit/loss through 10 buy/sell transactions with price changes", async () => {
			// Create fresh database for isolated test
			const testDb = await createTestDatabase();
			const ctx = createTestContext(testDb);

			// Create user with 100,000 coins
			const user = await call(createUser, { username: "activeTrader" }, ctx);
			await testDb
				.update(userStatsTable)
				.set({ coinsCount: 100000 })
				.where(eq(userStatsTable.userId, user.id));

			// Create asset
			const [asset] = await testDb.insert(investmentAssetsTable).values({
				symbol: "TEST",
				name: "Test Stock",
				assetType: "stock_us",
				apiSource: "twelvedata",
				apiSymbol: "TEST",
				isActive: true,
				minInvestment: 100,
			}).returning();

			if (!asset) throw new Error("Failed to create asset");

			// Initial price: $100 (10000 cents)
			await updatePrice(testDb, asset.id, 10000);

			// Track expected values
			let expectedCoins = 100000;
			let totalRealizedGains = 0;

			// ===== TRANSACTION 1: Buy 1000 coins worth @ $100 =====
			// Fee: 1.5% = 15 coins
			// Coins after fee: 985 coins
			// Shares: 985 * 1000 * 100 / 10000 = 9850 (9.85 shares)
			// Subtotal: 9850 * 10000 / 100000 = 985
			// Total cost: 985 + 15 = 1000
			const buy1 = await call(buyAsset, {
				userId: user.id,
				symbol: "TEST",
				amountInCoins: 1000,
			}, ctx);

			expectedCoins -= buy1.transaction.totalAmount;
			expect(buy1.portfolio.quantity).toBe(9850);
			expect(buy1.portfolio.totalInvested).toBe(985);
			expect(buy1.portfolio.averageBuyPrice).toBe(10000);

			// ===== TRANSACTION 2: Price drops to $80, buy 2000 coins more =====
			await updatePrice(testDb, asset.id, 8000);

			// Fee: 30 coins
			// Coins after fee: 1970
			// Shares: 1970 * 1000 * 100 / 8000 = 24625 (24.625 shares)
			// Subtotal: 24625 * 8000 / 100000 = 1970
			const buy2 = await call(buyAsset, {
				userId: user.id,
				symbol: "TEST",
				amountInCoins: 2000,
			}, ctx);

			expectedCoins -= buy2.transaction.totalAmount;
			// Total shares: 9850 + 24625 = 34475
			expect(buy2.portfolio.quantity).toBe(34475);
			// Total invested: 985 + 1970 = 2955
			expect(buy2.portfolio.totalInvested).toBe(2955);
			// New avg price: 2955 * 100 / (34475/1000) = 8573 (approx)
			expect(buy2.portfolio.averageBuyPrice).toBeGreaterThan(8000);
			expect(buy2.portfolio.averageBuyPrice).toBeLessThan(10000);

			// ===== TRANSACTION 3: Price rises to $120, sell 50% =====
			await updatePrice(testDb, asset.id, 12000);

			const sell1 = await call(sellAsset, {
				userId: user.id,
				symbol: "TEST",
				sellType: "percentage",
				percentage: 50,
			}, ctx);

			// Selling 50% = 17237 shares (floor of 34475/2)
			expect(sell1.transaction.quantity).toBe(17237);
			// Should have profit (selling at $120, avg cost ~$85.73)
			expect(sell1.profitLoss).toBeGreaterThan(0);
			totalRealizedGains += sell1.profitLoss;
			expectedCoins += sell1.transaction.totalAmount;

			// ===== TRANSACTION 4: Price crashes to $60, buy the dip =====
			await updatePrice(testDb, asset.id, 6000);

			const buy3 = await call(buyAsset, {
				userId: user.id,
				symbol: "TEST",
				amountInCoins: 5000,
			}, ctx);

			expectedCoins -= buy3.transaction.totalAmount;

			// ===== TRANSACTION 5: Price stays at $60, buy more =====
			const buy4 = await call(buyAsset, {
				userId: user.id,
				symbol: "TEST",
				amountInCoins: 3000,
			}, ctx);

			expectedCoins -= buy4.transaction.totalAmount;

			// ===== TRANSACTION 6: Price rises to $90, sell 10 shares =====
			await updatePrice(testDb, asset.id, 9000);

			const sell2 = await call(sellAsset, {
				userId: user.id,
				symbol: "TEST",
				sellType: "quantity",
				quantity: 10,
			}, ctx);

			// Selling 10 shares = 10000 quantity
			expect(sell2.transaction.quantity).toBe(10000);
			totalRealizedGains += sell2.profitLoss;
			expectedCoins += sell2.transaction.totalAmount;

			// ===== TRANSACTION 7: Price drops to $70, buy more =====
			await updatePrice(testDb, asset.id, 7000);

			const buy5 = await call(buyAsset, {
				userId: user.id,
				symbol: "TEST",
				amountInCoins: 2000,
			}, ctx);

			expectedCoins -= buy5.transaction.totalAmount;

			// ===== TRANSACTION 8: Price rises to $150, sell 25% =====
			await updatePrice(testDb, asset.id, 15000);

			const portfolioBefore = buy5.portfolio;
			const sell3 = await call(sellAsset, {
				userId: user.id,
				symbol: "TEST",
				sellType: "percentage",
				percentage: 25,
			}, ctx);

			// Should have significant profit at $150
			expect(sell3.profitLoss).toBeGreaterThan(0);
			totalRealizedGains += sell3.profitLoss;
			expectedCoins += sell3.transaction.totalAmount;

			// ===== TRANSACTION 9: Price drops to $50 (crash!), buy aggressively =====
			await updatePrice(testDb, asset.id, 5000);

			const buy6 = await call(buyAsset, {
				userId: user.id,
				symbol: "TEST",
				amountInCoins: 10000,
			}, ctx);

			expectedCoins -= buy6.transaction.totalAmount;

			// ===== TRANSACTION 10: Price recovers to $110, sell all =====
			await updatePrice(testDb, asset.id, 11000);

			const sellAll = await call(sellAsset, {
				userId: user.id,
				symbol: "TEST",
				sellType: "all",
			}, ctx);

			totalRealizedGains += sellAll.profitLoss;
			expectedCoins += sellAll.transaction.totalAmount;

			// Portfolio should be deleted after selling all
			expect(sellAll.portfolio).toBeUndefined();

			// ===== VERIFY FINAL STATE =====

			// Check user's final coin balance
			const [finalStats] = await testDb
				.select()
				.from(userStatsTable)
				.where(eq(userStatsTable.userId, user.id));

			expect(finalStats).toBeDefined();
			expect(finalStats!.coinsCount).toBe(expectedCoins);

			// User should have made money overall (started with 100k)
			// Note: Fees reduce profits, but good trades should still be profitable
			console.log(`Final coins: ${finalStats!.coinsCount}, Started: 100000, Net: ${finalStats!.coinsCount - 100000}`);
			console.log(`Total realized gains: ${totalRealizedGains}`);

			// Investment summary should show 0 since all sold
			const summary = await call(getInvestmentSummary, { userId: user.id }, ctx);
			expect(summary.holdingsCount).toBe(0);
			expect(summary.currentValue).toBe(0);
			expect(summary.totalInvested).toBe(0);
		});

		it("should correctly handle buying at multiple price points and calculate average cost", async () => {
			const testDb = await createTestDatabase();
			const ctx = createTestContext(testDb);

			const user = await call(createUser, { username: "dcaInvestor" }, ctx);
			await testDb
				.update(userStatsTable)
				.set({ coinsCount: 50000 })
				.where(eq(userStatsTable.userId, user.id));

			const [asset] = await testDb.insert(investmentAssetsTable).values({
				symbol: "DCA",
				name: "DCA Test Stock",
				assetType: "stock_us",
				apiSource: "twelvedata",
				apiSymbol: "DCA",
				isActive: true,
				minInvestment: 100,
			}).returning();

			if (!asset) throw new Error("Failed to create asset");

			// Dollar-cost averaging: Buy same amount at different prices
			const prices = [10000, 8000, 12000, 6000, 10000]; // $100, $80, $120, $60, $100
			const buyAmount = 1000;

			let totalShares = 0;
			let totalInvested = 0;

			for (const price of prices) {
				await updatePrice(testDb, asset.id, price);

				const result = await call(buyAsset, {
					userId: user.id,
					symbol: "DCA",
					amountInCoins: buyAmount,
				}, ctx);

				totalShares = result.portfolio.quantity;
				totalInvested = result.portfolio.totalInvested;
			}

			// Get final portfolio
			const [portfolio] = await testDb
				.select()
				.from(investmentPortfoliosTable)
				.where(eq(investmentPortfoliosTable.userId, user.id));

			expect(portfolio).toBeDefined();
			expect(portfolio!.quantity).toBe(totalShares);
			expect(portfolio!.totalInvested).toBe(totalInvested);

			// Average price should be between min and max prices
			// More shares bought at lower prices, so avg should lean lower
			expect(portfolio!.averageBuyPrice).toBeGreaterThan(6000);
			expect(portfolio!.averageBuyPrice).toBeLessThan(12000);

			// Current price at $100, check unrealized gains
			const summary = await call(getInvestmentSummary, { userId: user.id }, ctx);
			const avgCostPerShare = portfolio!.averageBuyPrice;

			// If avg cost < 10000, we have unrealized gains; if > 10000, unrealized loss
			if (avgCostPerShare < 10000) {
				expect(summary.unrealizedGains).toBeGreaterThan(0);
			} else {
				expect(summary.unrealizedGains).toBeLessThanOrEqual(0);
			}
		});

		it("should handle a losing investment scenario correctly", async () => {
			const testDb = await createTestDatabase();
			const ctx = createTestContext(testDb);

			const user = await call(createUser, { username: "unluckyTrader" }, ctx);
			await testDb
				.update(userStatsTable)
				.set({ coinsCount: 20000 })
				.where(eq(userStatsTable.userId, user.id));

			const [asset] = await testDb.insert(investmentAssetsTable).values({
				symbol: "LOSE",
				name: "Losing Stock",
				assetType: "stock_us",
				apiSource: "twelvedata",
				apiSymbol: "LOSE",
				isActive: true,
				minInvestment: 100,
			}).returning();

			if (!asset) throw new Error("Failed to create asset");

			// Buy at $100
			await updatePrice(testDb, asset.id, 10000);
			await call(buyAsset, {
				userId: user.id,
				symbol: "LOSE",
				amountInCoins: 5000,
			}, ctx);

			// Price crashes to $30
			await updatePrice(testDb, asset.id, 3000);

			// Panic sell everything
			const sellResult = await call(sellAsset, {
				userId: user.id,
				symbol: "LOSE",
				sellType: "all",
			}, ctx);

			// Should have significant loss
			expect(sellResult.profitLoss).toBeLessThan(0);

			// Check final state
			const summary = await call(getInvestmentSummary, { userId: user.id }, ctx);
			expect(summary.holdingsCount).toBe(0);

			// Get user stats
			const [finalStats] = await testDb
				.select()
				.from(userStatsTable)
				.where(eq(userStatsTable.userId, user.id));

			// User should have less than they started with (20000)
			// They invested 5000, got back much less due to 70% price drop + fees
			expect(finalStats!.coinsCount).toBeLessThan(20000);
			console.log(`Losing trade: Started 20000, ended ${finalStats!.coinsCount}, lost ${20000 - finalStats!.coinsCount}`);
		});

		it("should correctly track partial sells and remaining position", async () => {
			const testDb = await createTestDatabase();
			const ctx = createTestContext(testDb);

			const user = await call(createUser, { username: "partialSeller" }, ctx);
			await testDb
				.update(userStatsTable)
				.set({ coinsCount: 30000 })
				.where(eq(userStatsTable.userId, user.id));

			const [asset] = await testDb.insert(investmentAssetsTable).values({
				symbol: "PART",
				name: "Partial Sell Stock",
				assetType: "stock_us",
				apiSource: "twelvedata",
				apiSymbol: "PART",
				isActive: true,
				minInvestment: 100,
			}).returning();

			if (!asset) throw new Error("Failed to create asset");

			// Buy at $100
			await updatePrice(testDb, asset.id, 10000);
			const buyResult = await call(buyAsset, {
				userId: user.id,
				symbol: "PART",
				amountInCoins: 10000,
			}, ctx);

			const initialQuantity = buyResult.portfolio.quantity;
			const initialAvgPrice = buyResult.portfolio.averageBuyPrice;

			// Price goes up to $150
			await updatePrice(testDb, asset.id, 15000);

			// Sell 25%
			const sell1 = await call(sellAsset, {
				userId: user.id,
				symbol: "PART",
				sellType: "percentage",
				percentage: 25,
			}, ctx);

			expect(sell1.profitLoss).toBeGreaterThan(0);
			expect(sell1.portfolio).toBeDefined();
			expect(sell1.portfolio!.realizedGains).toBe(sell1.profitLoss);

			// Price goes down to $80
			await updatePrice(testDb, asset.id, 8000);

			// Sell another 25% (at a loss relative to buy price)
			const sell2 = await call(sellAsset, {
				userId: user.id,
				symbol: "PART",
				sellType: "percentage",
				percentage: 25,
			}, ctx);

			expect(sell2.profitLoss).toBeLessThan(0);
			expect(sell2.portfolio).toBeDefined();
			// Realized gains should be cumulative
			expect(sell2.portfolio!.realizedGains).toBe(sell1.profitLoss + sell2.profitLoss);

			// Check the summary includes realized gains
			const summary = await call(getInvestmentSummary, { userId: user.id }, ctx);
			expect(summary.realizedGains).toBe(sell1.profitLoss + sell2.profitLoss);
			expect(summary.holdingsCount).toBe(1);

			// Total profit = realized + unrealized
			// Current price $80, remaining shares bought at ~$100 avg
			expect(summary.unrealizedGains).toBeLessThan(0); // underwater at $80
			expect(summary.totalProfit).toBe(summary.realizedGains + summary.unrealizedGains);
		});

		it("should handle rapid buy/sell at same price (testing fees impact)", async () => {
			const testDb = await createTestDatabase();
			const ctx = createTestContext(testDb);

			const user = await call(createUser, { username: "feeChecker" }, ctx);
			const startingCoins = 10000;
			await testDb
				.update(userStatsTable)
				.set({ coinsCount: startingCoins })
				.where(eq(userStatsTable.userId, user.id));

			const [asset] = await testDb.insert(investmentAssetsTable).values({
				symbol: "FEE",
				name: "Fee Test Stock",
				assetType: "stock_us",
				apiSource: "twelvedata",
				apiSymbol: "FEE",
				isActive: true,
				minInvestment: 100,
			}).returning();

			if (!asset) throw new Error("Failed to create asset");

			// Fixed price throughout
			await updatePrice(testDb, asset.id, 10000);

			// Buy and immediately sell - should lose money due to fees
			const buyResult = await call(buyAsset, {
				userId: user.id,
				symbol: "FEE",
				amountInCoins: 5000,
			}, ctx);

			const sellResult = await call(sellAsset, {
				userId: user.id,
				symbol: "FEE",
				sellType: "all",
			}, ctx);

			// Get final coins
			const [finalStats] = await testDb
				.select()
				.from(userStatsTable)
				.where(eq(userStatsTable.userId, user.id));

			// Should have lost money due to fees (1.5% on buy + 1.5% on sell = ~3% total)
			expect(finalStats!.coinsCount).toBeLessThan(startingCoins);

			const feesLost = startingCoins - finalStats!.coinsCount;
			// Fees should be approximately 3% of 5000 = 150 (but calculated on different amounts)
			console.log(`Fees lost on round-trip trade: ${feesLost} coins (${(feesLost / 5000 * 100).toFixed(2)}% of trade)`);

			// The realized loss should be negative due to fees
			expect(sellResult.profitLoss).toBeLessThan(0);
		});

		it("should handle buying same asset multiple times then selling all at once", async () => {
			const testDb = await createTestDatabase();
			const ctx = createTestContext(testDb);

			const user = await call(createUser, { username: "bulkSeller" }, ctx);
			await testDb
				.update(userStatsTable)
				.set({ coinsCount: 50000 })
				.where(eq(userStatsTable.userId, user.id));

			const [asset] = await testDb.insert(investmentAssetsTable).values({
				symbol: "BULK",
				name: "Bulk Sell Stock",
				assetType: "stock_us",
				apiSource: "twelvedata",
				apiSymbol: "BULK",
				isActive: true,
				minInvestment: 100,
			}).returning();

			if (!asset) throw new Error("Failed to create asset");

			// 5 buys at different prices
			const buyPrices = [10000, 11000, 9000, 12000, 8000];
			let totalCoinsSpent = 0;

			for (const price of buyPrices) {
				await updatePrice(testDb, asset.id, price);
				const result = await call(buyAsset, {
					userId: user.id,
					symbol: "BULK",
					amountInCoins: 2000,
				}, ctx);
				totalCoinsSpent += result.transaction.totalAmount;
			}

			// Get portfolio before selling
			const [portfolioBefore] = await testDb
				.select()
				.from(investmentPortfoliosTable)
				.where(eq(investmentPortfoliosTable.userId, user.id));

			const totalSharesBefore = portfolioBefore!.quantity;
			const avgCostBefore = portfolioBefore!.averageBuyPrice;

			// Sell all at $100
			await updatePrice(testDb, asset.id, 10000);
			const sellResult = await call(sellAsset, {
				userId: user.id,
				symbol: "BULK",
				sellType: "all",
			}, ctx);

			// Verify all shares were sold
			expect(sellResult.transaction.quantity).toBe(totalSharesBefore);

			// Check profit/loss makes sense
			// Avg cost should be around $10000 (mean of 10k,11k,9k,12k,8k = 10k)
			// So selling at $10000 should be roughly break-even minus fees
			console.log(`Avg buy price: ${avgCostBefore}, sell price: 10000, P/L: ${sellResult.profitLoss}`);

			// Portfolio should be gone
			expect(sellResult.portfolio).toBeUndefined();

			// Summary should show nothing
			const summary = await call(getInvestmentSummary, { userId: user.id }, ctx);
			expect(summary.holdingsCount).toBe(0);
		});
	});
});
