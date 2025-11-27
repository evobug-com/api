import { describe, expect, it } from "bun:test";
import { ORPCError } from "@orpc/client";
import { call } from "@orpc/server";
import {
	investmentAssetsTable,
	investmentPortfoliosTable,
	investmentPriceCacheTable,
	type InsertDbInvestmentAsset,
	type InsertDbInvestmentPortfolio,
	type InsertDbInvestmentPriceCache,
} from "../../db/schema.ts";
import { createTestContext, createTestDatabase } from "../shared/test-utils.ts";
import { createUser } from "../users";
import { getInvestmentSummary, investmentLeaderboard } from "./index.ts";
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
});
