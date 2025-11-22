import { and, asc, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
	investmentAssetsSchema,
	investmentAssetsTable,
	investmentPortfoliosSchema,
	investmentPortfoliosTable,
	investmentPriceCacheTable,
	investmentTransactionsSchema,
	investmentTransactionsTable,
	type InsertDbInvestmentPortfolio,
	type InsertDbInvestmentTransaction,
	userStatsTable,
} from "../../db/schema.ts";
import { base } from "../shared/os.ts";

// Transaction fee: 1.5%
const TRANSACTION_FEE_BASIS_POINTS = 150; // 1.5% = 150 basis points

/**
 * Calculate transaction fee
 */
function calculateFee(amount: number): number {
	return Math.floor((amount * TRANSACTION_FEE_BASIS_POINTS) / 10000);
}

/**
 * Get latest cached price for an asset
 */
async function getLatestPrice(context: { db: any }, assetId: number) {
	const latestPrice = await context.db.query.investmentPriceCacheTable.findFirst({
		where: eq(investmentPriceCacheTable.assetId, assetId),
		orderBy: [desc(investmentPriceCacheTable.priceTimestamp)],
	});

	return latestPrice;
}

/**
 * Buy asset endpoint
 * POST /users/{userId}/investments/buy
 */
export const buyAsset = base
	.input(
		z.object({
			userId: z.number(),
			symbol: z.string().min(1).max(50),
			amountInCoins: z.number().int().min(100), // Minimum 100 coins
		}),
	)
	.errors({
		INSUFFICIENT_FUNDS: {
			message: "Insufficient coins",
			data: z.object({
				required: z.number(),
				available: z.number(),
			}),
		},
		ASSET_NOT_FOUND: {
			message: "Asset not available for trading",
		},
		ASSET_INACTIVE: {
			message: "Asset is currently not available for trading",
		},
		BELOW_MINIMUM: {
			message: "Investment below minimum",
			data: z.object({
				minimum: z.number(),
			}),
		},
		ECONOMY_BANNED: {
			message: "Economy access suspended",
		},
		PRICE_NOT_AVAILABLE: {
			message: "Price data not available for this asset",
		},
		DATABASE_ERROR: {
			message: "Database operation failed",
		},
	})
	.output(
		z.object({
			transaction: investmentTransactionsSchema,
			portfolio: investmentPortfoliosSchema,
			message: z.string(),
		}),
	)
	.handler(async ({ input, context, errors }) => {
		// 1. Check economy ban
		const [userStats] = await context.db
			.select()
			.from(userStatsTable)
			.where(eq(userStatsTable.userId, input.userId))
			.limit(1);

		if (!userStats) {
			throw errors.NOT_FOUND({
				message: "User stats not found",
			});
		}

		if (userStats.economyBannedUntil && userStats.economyBannedUntil > new Date()) {
			throw errors.ECONOMY_BANNED({
				message: "Your economy access is temporarily suspended due to suspicious activity",
			});
		}

		// 2. Find asset
		const [asset] = await context.db
			.select()
			.from(investmentAssetsTable)
			.where(eq(investmentAssetsTable.symbol, input.symbol.toUpperCase()))
			.limit(1);

		if (!asset) {
			throw errors.ASSET_NOT_FOUND();
		}

		if (!asset.isActive) {
			throw errors.ASSET_INACTIVE();
		}

		// Check minimum investment
		if (input.amountInCoins < asset.minInvestment) {
			throw errors.BELOW_MINIMUM({
				data: {
					minimum: asset.minInvestment,
				},
			});
		}

		// 3. Get current price from cache
		const priceData = await getLatestPrice(context, asset.id);

		if (!priceData) {
			throw errors.PRICE_NOT_AVAILABLE();
		}

		// 4. Calculate quantity, fees
		const pricePerUnit = priceData.price; // Price in cents
		const fee = calculateFee(input.amountInCoins);
		const coinsAfterFee = input.amountInCoins - fee;

		// Calculate how many shares/tokens we can buy
		// Quantity stored with 3 decimal precision
		const quantity = Math.floor((coinsAfterFee * 1000 * 100) / pricePerUnit);

		const subtotal = Math.floor((quantity * pricePerUnit) / 1000);
		const totalCost = subtotal + fee;

		// 5. Check user has enough coins
		if (userStats.coinsCount < totalCost) {
			throw errors.INSUFFICIENT_FUNDS({
				data: {
					required: totalCost,
					available: userStats.coinsCount,
				},
			});
		}

		// 6. Execute transaction
		return await context.db.transaction(async (db) => {
			// Deduct coins from user
			await db
				.update(userStatsTable)
				.set({
					coinsCount: userStats.coinsCount - totalCost,
					updatedAt: new Date(),
				})
				.where(eq(userStatsTable.userId, input.userId));

			// Get or create portfolio entry
			const [existingPortfolio] = await db
				.select()
				.from(investmentPortfoliosTable)
				.where(
					and(eq(investmentPortfoliosTable.userId, input.userId), eq(investmentPortfoliosTable.assetId, asset.id)),
				)
				.limit(1);

			let portfolio;
			if (existingPortfolio) {
				// Update existing portfolio
				const newQuantity = existingPortfolio.quantity + quantity;
				const newTotalInvested = existingPortfolio.totalInvested + subtotal;
				const newAvgPrice = Math.floor((newTotalInvested * 100) / (newQuantity / 1000));

				const [updatedPortfolio] = await db
					.update(investmentPortfoliosTable)
					.set({
						quantity: newQuantity,
						totalInvested: newTotalInvested,
						averageBuyPrice: newAvgPrice,
						lastTransactionAt: new Date(),
						updatedAt: new Date(),
					})
					.where(eq(investmentPortfoliosTable.id, existingPortfolio.id))
					.returning();

				portfolio = updatedPortfolio;
			} else {
				// Create new portfolio entry
				const portfolioData: InsertDbInvestmentPortfolio = {
					userId: input.userId,
					assetId: asset.id,
					quantity,
					averageBuyPrice: pricePerUnit,
					totalInvested: subtotal,
					realizedGains: 0,
				};

				const [newPortfolio] = await db.insert(investmentPortfoliosTable).values(portfolioData).returning();
				portfolio = newPortfolio;
			}

			// Create transaction record
			const transactionData: InsertDbInvestmentTransaction = {
				userId: input.userId,
				assetId: asset.id,
				transactionType: "buy",
				quantity,
				pricePerUnit,
				subtotal,
				feePercent: TRANSACTION_FEE_BASIS_POINTS,
				feeAmount: fee,
				totalAmount: totalCost,
				notes: `Bought ${(quantity / 1000).toFixed(3)} shares at $${(pricePerUnit / 100).toFixed(2)} (price as of ${priceData.priceTimestamp.toLocaleString()})`,
			};

			const [transaction] = await db.insert(investmentTransactionsTable).values(transactionData).returning();

			if (!transaction || !portfolio) {
				throw errors.DATABASE_ERROR();
			}

			return {
				transaction,
				portfolio,
				message: `Bought ${(quantity / 1000).toFixed(3)} ${asset.symbol} for ${totalCost} coins (including ${fee} coins fee)`,
			};
		});
	});

/**
 * Sell asset endpoint
 * POST /users/{userId}/investments/sell
 */
export const sellAsset = base
	.input(
		z.object({
			userId: z.number(),
			symbol: z.string().min(1).max(50),
			sellType: z.enum(["quantity", "percentage", "all"]),
			quantity: z.number().int().min(1).optional(), // If sellType is "quantity" (multiply by 1000 for precision)
			percentage: z.number().min(1).max(100).optional(), // If sellType is "percentage"
		}),
	)
	.errors({
		INSUFFICIENT_HOLDINGS: {
			message: "Insufficient holdings",
			data: z.object({
				available: z.number(),
				requested: z.number(),
			}),
		},
		ASSET_NOT_FOUND: {
			message: "Asset not available",
		},
		NO_HOLDINGS: {
			message: "You don't own any of this asset",
		},
		PRICE_NOT_AVAILABLE: {
			message: "Price data not available for this asset",
		},
		INVALID_INPUT: {
			message: "Invalid input parameters",
		},
		DATABASE_ERROR: {
			message: "Database operation failed",
		},
	})
	.output(
		z.object({
			transaction: investmentTransactionsSchema,
			portfolio: investmentPortfoliosSchema.optional(),
			message: z.string(),
			profitLoss: z.number(),
		}),
	)
	.handler(async ({ input, context, errors }) => {
		// 1. Find asset
		const [asset] = await context.db
			.select()
			.from(investmentAssetsTable)
			.where(eq(investmentAssetsTable.symbol, input.symbol.toUpperCase()))
			.limit(1);

		if (!asset) {
			throw errors.ASSET_NOT_FOUND();
		}

		// 2. Get user's portfolio entry
		const [portfolio] = await context.db
			.select()
			.from(investmentPortfoliosTable)
			.where(and(eq(investmentPortfoliosTable.userId, input.userId), eq(investmentPortfoliosTable.assetId, asset.id)))
			.limit(1);

		if (!portfolio || portfolio.quantity <= 0) {
			throw errors.NO_HOLDINGS();
		}

		// 3. Calculate quantity to sell
		let quantityToSell: number;

		if (input.sellType === "all") {
			quantityToSell = portfolio.quantity;
		} else if (input.sellType === "quantity") {
			if (!input.quantity) {
				throw errors.INVALID_INPUT();
			}
			quantityToSell = input.quantity * 1000; // Convert to internal format
		} else if (input.sellType === "percentage") {
			if (!input.percentage) {
				throw errors.INVALID_INPUT();
			}
			quantityToSell = Math.floor((portfolio.quantity * input.percentage) / 100);
		} else {
			throw errors.INVALID_INPUT();
		}

		// Check if user has enough holdings
		if (quantityToSell > portfolio.quantity) {
			throw errors.INSUFFICIENT_HOLDINGS({
				data: {
					available: portfolio.quantity / 1000,
					requested: quantityToSell / 1000,
				},
			});
		}

		// 4. Get current price
		const priceData = await getLatestPrice(context, asset.id);

		if (!priceData) {
			throw errors.PRICE_NOT_AVAILABLE();
		}

		const pricePerUnit = priceData.price;

		// 5. Calculate proceeds, fees, and profit/loss
		const subtotal = Math.floor((quantityToSell * pricePerUnit) / 1000);
		const fee = calculateFee(subtotal);
		const netProceeds = subtotal - fee;

		// Calculate cost basis for these shares
		const costBasis = Math.floor((quantityToSell * portfolio.averageBuyPrice) / 1000);
		const realizedGain = netProceeds - costBasis;

		// 6. Execute transaction
		return await context.db.transaction(async (db) => {
			// Add coins to user
			const [userStats] = await db
				.select()
				.from(userStatsTable)
				.where(eq(userStatsTable.userId, input.userId))
				.limit(1);

			if (!userStats) {
				throw errors.NOT_FOUND({
					message: "User stats not found",
				});
			}

			await db
				.update(userStatsTable)
				.set({
					coinsCount: userStats.coinsCount + netProceeds,
					updatedAt: new Date(),
				})
				.where(eq(userStatsTable.userId, input.userId));

			// Update or delete portfolio entry
			const newQuantity = portfolio.quantity - quantityToSell;
			let updatedPortfolio;

			if (newQuantity > 0) {
				// Update portfolio
				const newTotalInvested = Math.floor((newQuantity * portfolio.averageBuyPrice) / 1000);

				const [updated] = await db
					.update(investmentPortfoliosTable)
					.set({
						quantity: newQuantity,
						totalInvested: newTotalInvested,
						realizedGains: portfolio.realizedGains + realizedGain,
						lastTransactionAt: new Date(),
						updatedAt: new Date(),
					})
					.where(eq(investmentPortfoliosTable.id, portfolio.id))
					.returning();

				updatedPortfolio = updated;
			} else {
				// Fully sold - delete portfolio entry
				await db.delete(investmentPortfoliosTable).where(eq(investmentPortfoliosTable.id, portfolio.id));
				updatedPortfolio = undefined;
			}

			// Create transaction record
			const transactionData: InsertDbInvestmentTransaction = {
				userId: input.userId,
				assetId: asset.id,
				transactionType: "sell",
				quantity: quantityToSell,
				pricePerUnit,
				subtotal,
				feePercent: TRANSACTION_FEE_BASIS_POINTS,
				feeAmount: fee,
				totalAmount: netProceeds,
				costBasis,
				realizedGain,
				notes: `Sold ${(quantityToSell / 1000).toFixed(3)} shares at $${(pricePerUnit / 100).toFixed(2)} (price as of ${priceData.priceTimestamp.toLocaleString()})`,
			};

			const [transaction] = await db.insert(investmentTransactionsTable).values(transactionData).returning();

			if (!transaction) {
				throw errors.DATABASE_ERROR();
			}

			const profitLossText = realizedGain >= 0 ? `profit of ${realizedGain}` : `loss of ${Math.abs(realizedGain)}`;

			return {
				transaction,
				portfolio: updatedPortfolio,
				profitLoss: realizedGain,
				message: `Sold ${(quantityToSell / 1000).toFixed(3)} ${asset.symbol} for ${netProceeds} coins (${profitLossText}, ${fee} coins fee)`,
			};
		});
	});

/**
 * Get portfolio endpoint
 * GET /users/{userId}/investments/portfolio
 */
export const getPortfolio = base
	.input(
		z.object({
			userId: z.number(),
		}),
	)
	.output(
		z.object({
			holdings: z.array(
				z.object({
					asset: investmentAssetsSchema,
					portfolio: investmentPortfoliosSchema,
					currentPrice: z.number(),
					currentValue: z.number(),
					unrealizedGain: z.number(),
					unrealizedGainPercent: z.number(),
					priceTimestamp: z.date(),
				}),
			),
			summary: z.object({
				totalInvested: z.number(),
				currentValue: z.number(),
				totalGain: z.number(),
				totalGainPercent: z.number(),
				realizedGains: z.number(),
				unrealizedGains: z.number(),
			}),
		}),
	)
	.handler(async ({ input, context }) => {
		// Get all portfolio entries for user with asset details
		const portfolios = await context.db
			.select()
			.from(investmentPortfoliosTable)
			.leftJoin(investmentAssetsTable, eq(investmentPortfoliosTable.assetId, investmentAssetsTable.id))
			.where(eq(investmentPortfoliosTable.userId, input.userId));

		const holdings = await Promise.all(
			portfolios.map(async (row) => {
				const portfolio = row.investment_portfolios;
				const asset = row.investment_assets;

				if (!asset) {
					return null;
				}

				// Get current price
				const priceData = await getLatestPrice(context, portfolio.assetId);

				const currentPrice = priceData?.price || portfolio.averageBuyPrice;
				const currentValue = Math.floor((portfolio.quantity * currentPrice) / 1000);
				const unrealizedGain = currentValue - portfolio.totalInvested;
				const unrealizedGainPercent =
					portfolio.totalInvested > 0 ? (unrealizedGain / portfolio.totalInvested) * 100 : 0;

				return {
					asset,
					portfolio,
					currentPrice,
					currentValue,
					unrealizedGain,
					unrealizedGainPercent,
					priceTimestamp: priceData?.priceTimestamp || new Date(),
				};
			}),
		).then((results) => results.filter((r) => r !== null));

		// Calculate summary
		const totalInvested = holdings.reduce((sum, h) => sum + h.portfolio.totalInvested, 0);
		const currentValue = holdings.reduce((sum, h) => sum + h.currentValue, 0);
		const realizedGains = holdings.reduce((sum, h) => sum + h.portfolio.realizedGains, 0);
		const unrealizedGains = holdings.reduce((sum, h) => sum + h.unrealizedGain, 0);
		const totalGain = realizedGains + unrealizedGains;
		const totalGainPercent = totalInvested > 0 ? (totalGain / totalInvested) * 100 : 0;

		return {
			holdings,
			summary: {
				totalInvested,
				currentValue,
				totalGain,
				totalGainPercent,
				realizedGains,
				unrealizedGains,
			},
		};
	});

/**
 * List available assets endpoint
 * GET /users/investments/assets
 */
export const listAvailableAssets = base
	.input(
		z.object({
			assetType: z.enum(["stock_us", "stock_intl", "crypto", "all"]).default("all"),
			limit: z.number().int().min(1).max(100).default(50),
			offset: z.number().int().min(0).default(0),
		}),
	)
	.output(
		z.object({
			assets: z.array(
				z.object({
					asset: investmentAssetsSchema,
					currentPrice: z.number().nullable(),
					change24h: z.number().nullable(),
					changePercent24h: z.number().nullable(),
					priceTimestamp: z.date().nullable(),
				}),
			),
			total: z.number(),
		}),
	)
	.handler(async ({ input, context }) => {
		// Build where clause
		const whereClause =
			input.assetType === "all"
				? eq(investmentAssetsTable.isActive, true)
				: and(eq(investmentAssetsTable.assetType, input.assetType), eq(investmentAssetsTable.isActive, true));

		// Get total count
		const [countResult] = await context.db
			.select({ count: count() })
			.from(investmentAssetsTable)
			.where(whereClause);

		const totalCount = countResult ? Number(countResult.count) : 0;

		// Get assets
		const assets = await context.db
			.select()
			.from(investmentAssetsTable)
			.where(whereClause)
			.limit(input.limit)
			.offset(input.offset)
			.orderBy(asc(investmentAssetsTable.symbol));

		// Get latest prices for all assets
		const assetsWithPrices = await Promise.all(
			assets.map(async (asset) => {
				const priceData = await getLatestPrice(context, asset.id);

				return {
					asset,
					currentPrice: priceData?.price || null,
					change24h: priceData?.change24h || null,
					changePercent24h: priceData?.changePercent24h || null,
					priceTimestamp: priceData?.priceTimestamp || null,
				};
			}),
		);

		return {
			assets: assetsWithPrices,
			total: totalCount,
		};
	});

/**
 * Get transaction history endpoint
 * GET /users/{userId}/investments/transactions
 */
export const getTransactionHistory = base
	.input(
		z.object({
			userId: z.number(),
			limit: z.number().int().min(1).max(100).default(50),
			offset: z.number().int().min(0).default(0),
			transactionType: z.enum(["buy", "sell", "all"]).default("all"),
		}),
	)
	.output(
		z.object({
			transactions: z.array(
				z.object({
					transaction: investmentTransactionsSchema,
					asset: investmentAssetsSchema,
				}),
			),
			total: z.number(),
		}),
	)
	.handler(async ({ input, context }) => {
		// Build where clause
		const whereClause =
			input.transactionType === "all"
				? eq(investmentTransactionsTable.userId, input.userId)
				: and(
						eq(investmentTransactionsTable.userId, input.userId),
						eq(investmentTransactionsTable.transactionType, input.transactionType),
					);

		// Get total count
		const [countResult] = await context.db
			.select({ count: count() })
			.from(investmentTransactionsTable)
			.where(whereClause);

		const totalCount = countResult ? Number(countResult.count) : 0;

		// Get transactions with asset details
		const transactions = await context.db
			.select()
			.from(investmentTransactionsTable)
			.leftJoin(investmentAssetsTable, eq(investmentTransactionsTable.assetId, investmentAssetsTable.id))
			.where(whereClause)
			.limit(input.limit)
			.offset(input.offset)
			.orderBy(desc(investmentTransactionsTable.createdAt));

		const results = transactions
			.map((row) => {
				const transaction = row.investment_transactions;
				const asset = row.investment_assets;

				if (!asset) {
					return null;
				}

				return {
					transaction,
					asset,
				};
			})
			.filter((r) => r !== null);

		return {
			transactions: results,
			total: totalCount,
		};
	});
