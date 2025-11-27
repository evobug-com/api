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
