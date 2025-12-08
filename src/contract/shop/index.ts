import { eq, and } from "drizzle-orm";
import { z } from "zod";
import {
	productsTable,
	ordersTable,
	userStatsTable,
	type InsertDbOrder,
} from "../../db/schema.ts";
import { base } from "../shared/os.ts";

// Product output schema
const productOutputSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	price: z.number(),
	imageUrl: z.string().nullable(),
	sizes: z.array(z.string()).nullable(),
	maxPerUser: z.number().nullable(),
	isActive: z.boolean(),
	requiresDelivery: z.boolean(),
	shippingCost: z.number().nullable(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

/**
 * List products - get all products with optional filtering
 */
export const listProducts = base
	.input(
		z.object({
			activeOnly: z.boolean().optional().default(true),
		}).optional()
	)
	.output(z.array(productOutputSchema))
	.handler(async ({ input, context }) => {
		const activeOnly = input?.activeOnly ?? true;

		if (activeOnly) {
			return await context.db
				.select()
				.from(productsTable)
				.where(eq(productsTable.isActive, true));
		}

		return await context.db.select().from(productsTable);
	});

/**
 * Get single product by ID
 */
export const getProduct = base
	.input(
		z.object({
			id: z.string().uuid(),
		})
	)
	.output(productOutputSchema.nullable())
	.handler(async ({ input, context, errors }) => {
		const [product] = await context.db
			.select()
			.from(productsTable)
			.where(eq(productsTable.id, input.id))
			.limit(1);

		if (!product) {
			throw errors.NOT_FOUND({ message: "Product not found" });
		}

		return product;
	});

// Delivery info schema
const deliveryInfoSchema = z.object({
	name: z.string().min(1),
	phone: z.string().min(1),
	address: z.string().min(1),
	city: z.string().min(1),
	postalCode: z.string().min(1),
	notes: z.string().optional(),
});

// Purchase response schema
const purchaseResponseSchema = z.object({
	success: z.boolean(),
	message: z.string(),
	order: z.object({
		id: z.number(),
		productId: z.string(),
		userId: z.number(),
		price: z.number(),
		size: z.string().nullable(),
		status: z.string(),
	}).optional(),
	remainingCoins: z.number().optional(),
});

/**
 * Purchase a product
 * - Validates user has enough coins
 * - Validates product is active
 * - Validates user hasn't exceeded maxPerUser limit
 * - Deducts coins and creates order
 */
export const purchase = base
	.input(
		z.object({
			token: z.string(), // JWT token for auth
			productId: z.string().uuid(),
			size: z.string().optional(),
			deliveryInfo: deliveryInfoSchema.optional(),
		})
	)
	.output(purchaseResponseSchema)
	.errors({
		INSUFFICIENT_COINS: {
			message: "Not enough coins to purchase this product",
		},
		PRODUCT_UNAVAILABLE: {
			message: "This product is not available",
		},
		PURCHASE_LIMIT_EXCEEDED: {
			message: "You have already purchased the maximum allowed quantity of this product",
		},
		DELIVERY_REQUIRED: {
			message: "Delivery information is required for this product",
		},
	})
	.handler(async ({ input, context, errors }) => {
		const { token, productId, size, deliveryInfo } = input;

		// Verify token and get user ID (simplified - in production use the verifyToken function)
		const { jwtVerify } = await import("jose");
		const JWT_SECRET = new TextEncoder().encode(
			process.env.JWT_SECRET || "allcom-zone-secret-key-change-in-production"
		);

		let userId: number;
		try {
			const { payload } = await jwtVerify(token, JWT_SECRET);
			userId = payload.userId as number;
		} catch {
			throw errors.UNAUTHORIZED();
		}

		// Get product
		const [product] = await context.db
			.select()
			.from(productsTable)
			.where(eq(productsTable.id, productId))
			.limit(1);

		if (!product) {
			throw errors.NOT_FOUND({ message: "Product not found" });
		}

		if (!product.isActive) {
			throw errors.PRODUCT_UNAVAILABLE();
		}

		// Check if delivery info is required
		if (product.requiresDelivery && !deliveryInfo) {
			throw errors.DELIVERY_REQUIRED();
		}

		// Get user stats (coins)
		const [userStats] = await context.db
			.select()
			.from(userStatsTable)
			.where(eq(userStatsTable.userId, userId))
			.limit(1);

		if (!userStats) {
			throw errors.NOT_FOUND({ message: "User stats not found" });
		}

		// Calculate total price
		const totalPrice = product.price + (product.shippingCost || 0);

		// Check if user has enough coins
		if (userStats.coinsCount < totalPrice) {
			throw errors.INSUFFICIENT_COINS();
		}

		// Check purchase limit
		if (product.maxPerUser) {
			const existingOrders = await context.db
				.select()
				.from(ordersTable)
				.where(
					and(
						eq(ordersTable.userId, userId),
						eq(ordersTable.productId, productId)
					)
				);

			if (existingOrders.length >= product.maxPerUser) {
				throw errors.PURCHASE_LIMIT_EXCEEDED();
			}
		}

		// Create order and deduct coins in transaction
		const result = await context.db.transaction(async (db) => {
			// Deduct coins
			await db
				.update(userStatsTable)
				.set({
					coinsCount: userStats.coinsCount - totalPrice,
					updatedAt: new Date(),
				})
				.where(eq(userStatsTable.userId, userId));

			// Create order
			const orderData: InsertDbOrder = {
				userId,
				productId,
				price: totalPrice,
				size: size || null,
				status: "completed",
			};

			// Add delivery info if provided
			if (deliveryInfo) {
				orderData.deliveryName = deliveryInfo.name;
				orderData.deliveryPhone = deliveryInfo.phone;
				orderData.deliveryAddress = deliveryInfo.address;
				orderData.deliveryCity = deliveryInfo.city;
				orderData.deliveryPostalCode = deliveryInfo.postalCode;
				orderData.deliveryNotes = deliveryInfo.notes || null;
			}

			const [order] = await db
				.insert(ordersTable)
				.values(orderData)
				.returning();

			if (!order) {
				throw new Error("Failed to create order");
			}

			return {
				order,
				remainingCoins: userStats.coinsCount - totalPrice,
			};
		});

		return {
			success: true,
			message: "Purchase successful",
			order: {
				id: result.order.id,
				productId: result.order.productId,
				userId: result.order.userId,
				price: result.order.price,
				size: result.order.size,
				status: result.order.status,
			},
			remainingCoins: result.remainingCoins,
		};
	});
