import { beforeEach, describe, expect, it } from "bun:test";
import { ORPCError } from "@orpc/client";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql/postgres";
import type { relations } from "../../db/relations.ts";
import type * as schema from "../../db/schema.ts";
import { productsTable, userStatsTable, ordersTable } from "../../db/schema.ts";
import { createTestContext, createTestDatabase } from "../shared/test-utils.ts";
import { listProducts, getProduct, purchase } from "./index.ts";
import { register } from "../auth/index.ts";

describe("Shop", () => {
	let db: BunSQLDatabase<typeof schema, typeof relations>;

	beforeEach(async () => {
		db = await createTestDatabase();
	});

	async function createTestProduct(
		overrides: Partial<{
			id: string;
			name: string;
			price: number;
			isActive: boolean;
			maxPerUser: number | null;
			requiresDelivery: boolean;
			shippingCost: number;
		}> = {},
	) {
		const productId = overrides.id || crypto.randomUUID();
		const [product] = await db
			.insert(productsTable)
			.values({
				id: productId,
				name: overrides.name || "Test Product",
				price: overrides.price ?? 100,
				description: "A test product",
				isActive: overrides.isActive ?? true,
				maxPerUser: overrides.maxPerUser ?? null,
				requiresDelivery: overrides.requiresDelivery ?? false,
				shippingCost: overrides.shippingCost ?? 0,
			})
			.returning();
		if (!product) throw new Error("Failed to create test product");
		return product;
	}

	describe("listProducts", () => {
		it("should return empty array when no products exist", async () => {
			const result = await call(listProducts, undefined, createTestContext(db));
			expect(result).toEqual([]);
		});

		it("should return only active products by default", async () => {
			await createTestProduct({ name: "Active Product", isActive: true });
			await createTestProduct({ name: "Inactive Product", isActive: false });

			const result = await call(listProducts, undefined, createTestContext(db));

			expect(result).toHaveLength(1);
			expect(result[0]?.name).toBe("Active Product");
		});

		it("should return all products when activeOnly is false", async () => {
			await createTestProduct({ name: "Active Product", isActive: true });
			await createTestProduct({ name: "Inactive Product", isActive: false });

			const result = await call(
				listProducts,
				{ activeOnly: false },
				createTestContext(db),
			);

			expect(result).toHaveLength(2);
		});

		it("should return multiple active products", async () => {
			for (let i = 0; i < 5; i++) {
				await createTestProduct({ name: `Product ${i}`, isActive: true });
			}

			const result = await call(listProducts, undefined, createTestContext(db));
			expect(result).toHaveLength(5);
		});
	});

	describe("getProduct", () => {
		it("should return a product by ID", async () => {
			const product = await createTestProduct({ name: "Specific Product", price: 250 });

			const result = await call(
				getProduct,
				{ id: product.id },
				createTestContext(db),
			);

			expect(result).toStrictEqual(
				expect.objectContaining({
					id: product.id,
					name: "Specific Product",
					price: 250,
				}),
			);
		});

		it("should throw NOT_FOUND for non-existent product", async () => {
			expect(
				call(
					getProduct,
					{ id: "00000000-0000-0000-0000-000000000000" },
					createTestContext(db),
				),
			).rejects.toThrow(
				new ORPCError("NOT_FOUND", {
					message: "Product not found",
				}),
			);
		});

		it("should reject invalid UUID format", async () => {
			expect(
				call(getProduct, { id: "invalid-uuid" }, createTestContext(db)),
			).rejects.toThrow();
		});
	});

	describe("purchase", () => {
		it("should successfully purchase a product", async () => {
			const product = await createTestProduct({ price: 100 });
			const authResult = await call(
				register,
				{
					username: "buyer",
					email: "buyer@example.com",
					password: "password123",
				},
				createTestContext(db),
			);

			// Give user enough coins
			await db
				.update(userStatsTable)
				.set({ coinsCount: 500 })
				.where(eq(userStatsTable.userId, authResult.user.id));

			const result = await call(
				purchase,
				{
					token: authResult.token,
					productId: product.id,
				},
				createTestContext(db),
			);

			expect(result.success).toBe(true);
			expect(result.order).toBeDefined();
			expect(result.order?.price).toBe(100);
			expect(result.remainingCoins).toBe(400);
		});

		it("should deduct coins after purchase", async () => {
			const product = await createTestProduct({ price: 150 });
			const authResult = await call(
				register,
				{
					username: "coincheck",
					email: "coincheck@example.com",
					password: "password123",
				},
				createTestContext(db),
			);

			const initialCoins = 500;
			await db
				.update(userStatsTable)
				.set({ coinsCount: initialCoins })
				.where(eq(userStatsTable.userId, authResult.user.id));

			await call(
				purchase,
				{
					token: authResult.token,
					productId: product.id,
				},
				createTestContext(db),
			);

			const [stats] = await db
				.select()
				.from(userStatsTable)
				.where(eq(userStatsTable.userId, authResult.user.id));

			expect(stats?.coinsCount).toBe(initialCoins - 150);
		});

		it("should include shipping cost in total price", async () => {
			const product = await createTestProduct({
				price: 100,
				shippingCost: 50,
				requiresDelivery: true,
			});
			const authResult = await call(
				register,
				{
					username: "shipper",
					email: "shipper@example.com",
					password: "password123",
				},
				createTestContext(db),
			);

			await db
				.update(userStatsTable)
				.set({ coinsCount: 500 })
				.where(eq(userStatsTable.userId, authResult.user.id));

			const result = await call(
				purchase,
				{
					token: authResult.token,
					productId: product.id,
					deliveryInfo: {
						name: "John Doe",
						phone: "123456789",
						address: "123 Test St",
						city: "Test City",
						postalCode: "12345",
					},
				},
				createTestContext(db),
			);

			expect(result.success).toBe(true);
			expect(result.order?.price).toBe(150); // 100 + 50 shipping
			expect(result.remainingCoins).toBe(350); // 500 - 150
		});

		it("should reject purchase with insufficient coins", async () => {
			const product = await createTestProduct({ price: 1000 });
			const authResult = await call(
				register,
				{
					username: "poorbuyer",
					email: "poorbuyer@example.com",
					password: "password123",
				},
				createTestContext(db),
			);

			// User has 0 coins by default
			expect(
				call(
					purchase,
					{
						token: authResult.token,
						productId: product.id,
					},
					createTestContext(db),
				),
			).rejects.toThrow(
				new ORPCError("INSUFFICIENT_COINS", {
					message: "Not enough coins to purchase this product",
				}),
			);
		});

		it("should reject purchase of inactive product", async () => {
			const product = await createTestProduct({ isActive: false });
			const authResult = await call(
				register,
				{
					username: "inactivebuyer",
					email: "inactivebuyer@example.com",
					password: "password123",
				},
				createTestContext(db),
			);

			await db
				.update(userStatsTable)
				.set({ coinsCount: 500 })
				.where(eq(userStatsTable.userId, authResult.user.id));

			expect(
				call(
					purchase,
					{
						token: authResult.token,
						productId: product.id,
					},
					createTestContext(db),
				),
			).rejects.toThrow(
				new ORPCError("PRODUCT_UNAVAILABLE", {
					message: "This product is not available",
				}),
			);
		});

		it("should reject purchase exceeding maxPerUser limit", async () => {
			const product = await createTestProduct({ price: 50, maxPerUser: 1 });
			const authResult = await call(
				register,
				{
					username: "limitbuyer",
					email: "limitbuyer@example.com",
					password: "password123",
				},
				createTestContext(db),
			);

			await db
				.update(userStatsTable)
				.set({ coinsCount: 500 })
				.where(eq(userStatsTable.userId, authResult.user.id));

			// First purchase should succeed
			await call(
				purchase,
				{
					token: authResult.token,
					productId: product.id,
				},
				createTestContext(db),
			);

			// Second purchase should fail
			expect(
				call(
					purchase,
					{
						token: authResult.token,
						productId: product.id,
					},
					createTestContext(db),
				),
			).rejects.toThrow(
				new ORPCError("PURCHASE_LIMIT_EXCEEDED", {
					message: "You have already purchased the maximum allowed quantity of this product",
				}),
			);
		});

		it("should require delivery info for products that require delivery", async () => {
			const product = await createTestProduct({ requiresDelivery: true });
			const authResult = await call(
				register,
				{
					username: "deliverybuyer",
					email: "deliverybuyer@example.com",
					password: "password123",
				},
				createTestContext(db),
			);

			await db
				.update(userStatsTable)
				.set({ coinsCount: 500 })
				.where(eq(userStatsTable.userId, authResult.user.id));

			expect(
				call(
					purchase,
					{
						token: authResult.token,
						productId: product.id,
						// Missing deliveryInfo
					},
					createTestContext(db),
				),
			).rejects.toThrow(
				new ORPCError("DELIVERY_REQUIRED", {
					message: "Delivery information is required for this product",
				}),
			);
		});

		it("should accept purchase with delivery info", async () => {
			const product = await createTestProduct({ requiresDelivery: true });
			const authResult = await call(
				register,
				{
					username: "fulldelivery",
					email: "fulldelivery@example.com",
					password: "password123",
				},
				createTestContext(db),
			);

			await db
				.update(userStatsTable)
				.set({ coinsCount: 500 })
				.where(eq(userStatsTable.userId, authResult.user.id));

			const result = await call(
				purchase,
				{
					token: authResult.token,
					productId: product.id,
					deliveryInfo: {
						name: "John Doe",
						phone: "123456789",
						address: "123 Test Street",
						city: "Test City",
						postalCode: "12345",
						notes: "Leave at door",
					},
				},
				createTestContext(db),
			);

			expect(result.success).toBe(true);
		});

		it("should reject invalid token", async () => {
			const product = await createTestProduct();

			expect(
				call(
					purchase,
					{
						token: "invalid-token",
						productId: product.id,
					},
					createTestContext(db),
				),
			).rejects.toThrow();
		});

		it("should reject non-existent product", async () => {
			const authResult = await call(
				register,
				{
					username: "noexistbuyer",
					email: "noexistbuyer@example.com",
					password: "password123",
				},
				createTestContext(db),
			);

			await db
				.update(userStatsTable)
				.set({ coinsCount: 500 })
				.where(eq(userStatsTable.userId, authResult.user.id));

			expect(
				call(
					purchase,
					{
						token: authResult.token,
						productId: "00000000-0000-0000-0000-000000000000",
					},
					createTestContext(db),
				),
			).rejects.toThrow(
				new ORPCError("NOT_FOUND", {
					message: "Product not found",
				}),
			);
		});

		it("should create an order record", async () => {
			const product = await createTestProduct({ price: 75 });
			const authResult = await call(
				register,
				{
					username: "ordercheck",
					email: "ordercheck@example.com",
					password: "password123",
				},
				createTestContext(db),
			);

			await db
				.update(userStatsTable)
				.set({ coinsCount: 500 })
				.where(eq(userStatsTable.userId, authResult.user.id));

			await call(
				purchase,
				{
					token: authResult.token,
					productId: product.id,
					size: "M",
				},
				createTestContext(db),
			);

			const orders = await db
				.select()
				.from(ordersTable)
				.where(eq(ordersTable.userId, authResult.user.id));

			expect(orders).toHaveLength(1);
			expect(orders[0]).toStrictEqual(
				expect.objectContaining({
					userId: authResult.user.id,
					productId: product.id,
					price: 75,
					size: "M",
					status: "completed",
				}),
			);
		});
	});
});
