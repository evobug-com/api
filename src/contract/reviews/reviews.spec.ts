import { beforeEach, describe, expect, it } from "bun:test";
import { ORPCError } from "@orpc/client";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql/postgres";
import type { relations } from "../../db/relations.ts";
import type * as schema from "../../db/schema.ts";
import { userStatsTable } from "../../db/schema.ts";
import { createTestContext, createTestDatabase } from "../shared/test-utils.ts";
import { list, eligibility, myReview, submit } from "./index.ts";
import { register } from "../auth/index.ts";

describe("Reviews", () => {
	let db: BunSQLDatabase<typeof schema, typeof relations>;

	beforeEach(async () => {
		db = await createTestDatabase();
	});

	describe("list", () => {
		it("should return empty array when no reviews exist", async () => {
			const result = await call(list, undefined, createTestContext(db));
			expect(result).toEqual([]);
		});

		it("should return reviews with user info", async () => {
			// Create a user and their review directly
			const authResult = await call(
				register,
				{
					username: "reviewer",
					email: "reviewer@example.com",
					password: "password123",
				},
				createTestContext(db),
			);

			// Give user enough coins and messages for review
			await db
				.update(userStatsTable)
				.set({ coinsCount: 200, messagesCount: 100 })
				.where(eq(userStatsTable.userId, authResult.user.id));

			// Submit a review
			await call(
				submit,
				{
					token: authResult.token,
					rating: 5,
					text: "This is an amazing service! I love it so much. Great community and features. Highly recommend to everyone!",
				},
				createTestContext(db),
			);

			const result = await call(list, undefined, createTestContext(db));

			expect(result).toHaveLength(1);
			expect(result[0]).toStrictEqual({
				id: expect.any(Number),
				userId: authResult.user.id,
				rating: 5,
				text: expect.any(String),
				user: expect.objectContaining({
					id: authResult.user.id,
					username: "reviewer",
				}),
			});
		});

		it("should return multiple reviews", async () => {
			// Create multiple users and reviews
			for (let i = 0; i < 3; i++) {
				const authResult = await call(
					register,
					{
						username: `reviewer${i}`,
						email: `reviewer${i}@example.com`,
						password: "password123",
					},
					createTestContext(db),
				);

				await db
					.update(userStatsTable)
					.set({ coinsCount: 200, messagesCount: 100 })
					.where(eq(userStatsTable.userId, authResult.user.id));

				await call(
					submit,
					{
						token: authResult.token,
						rating: 4 + (i % 2),
						text: `This is review number ${i}. It needs to be at least 50 characters long to pass validation.`,
					},
					createTestContext(db),
				);
			}

			const result = await call(list, undefined, createTestContext(db));
			expect(result).toHaveLength(3);
		});
	});

	describe("eligibility", () => {
		it("should return eligible for user with enough coins and messages", async () => {
			const authResult = await call(
				register,
				{
					username: "eligibleuser",
					email: "eligible@example.com",
					password: "password123",
				},
				createTestContext(db),
			);

			// Update user stats to meet eligibility
			await db
				.update(userStatsTable)
				.set({ coinsCount: 200, messagesCount: 100 })
				.where(eq(userStatsTable.userId, authResult.user.id));

			const result = await call(
				eligibility,
				{ token: authResult.token },
				createTestContext(db),
			);

			expect(result.eligible).toBe(true);
			expect(result.hasEnoughCoins).toBe(true);
			expect(result.depositRequired).toBe(100);
		});

		it("should return ineligible for user without enough coins", async () => {
			const authResult = await call(
				register,
				{
					username: "pooruser",
					email: "poor@example.com",
					password: "password123",
				},
				createTestContext(db),
			);

			// Update messages but keep coins at 0
			await db
				.update(userStatsTable)
				.set({ messagesCount: 100 })
				.where(eq(userStatsTable.userId, authResult.user.id));

			const result = await call(
				eligibility,
				{ token: authResult.token },
				createTestContext(db),
			);

			expect(result.eligible).toBe(false);
			expect(result.hasEnoughCoins).toBe(false);
		});

		it("should return ineligible for user without enough messages", async () => {
			const authResult = await call(
				register,
				{
					username: "lowmsgsuser",
					email: "lowmsgs@example.com",
					password: "password123",
				},
				createTestContext(db),
			);

			// Give coins but keep messages low
			await db
				.update(userStatsTable)
				.set({ coinsCount: 200, messagesCount: 10 })
				.where(eq(userStatsTable.userId, authResult.user.id));

			const result = await call(
				eligibility,
				{ token: authResult.token },
				createTestContext(db),
			);

			expect(result.eligible).toBe(false);
			expect(result.reason).toContain("messages");
		});

		it("should return ineligible if user already has a review", async () => {
			const authResult = await call(
				register,
				{
					username: "alreadyreviewed",
					email: "already@example.com",
					password: "password123",
				},
				createTestContext(db),
			);

			await db
				.update(userStatsTable)
				.set({ coinsCount: 200, messagesCount: 100 })
				.where(eq(userStatsTable.userId, authResult.user.id));

			// Submit a review
			await call(
				submit,
				{
					token: authResult.token,
					rating: 5,
					text: "Already submitted review that is long enough to pass the minimum character validation.",
				},
				createTestContext(db),
			);

			// Check eligibility again
			const result = await call(
				eligibility,
				{ token: authResult.token },
				createTestContext(db),
			);

			expect(result.eligible).toBe(false);
			expect(result.reason).toContain("already submitted");
		});

		it("should reject invalid token", async () => {
			expect(
				call(eligibility, { token: "invalid-token" }, createTestContext(db)),
			).rejects.toThrow();
		});
	});

	describe("myReview", () => {
		it("should return null if user has no review", async () => {
			const authResult = await call(
				register,
				{
					username: "noreviewer",
					email: "noreviewer@example.com",
					password: "password123",
				},
				createTestContext(db),
			);

			const result = await call(
				myReview,
				{ token: authResult.token },
				createTestContext(db),
			);

			expect(result).toBeNull();
		});

		it("should return user's review if exists", async () => {
			const authResult = await call(
				register,
				{
					username: "hasreview",
					email: "hasreview@example.com",
					password: "password123",
				},
				createTestContext(db),
			);

			await db
				.update(userStatsTable)
				.set({ coinsCount: 200, messagesCount: 100 })
				.where(eq(userStatsTable.userId, authResult.user.id));

			const reviewText = "This is my personal review of the service. It has been great!";
			await call(
				submit,
				{
					token: authResult.token,
					rating: 4,
					text: reviewText,
				},
				createTestContext(db),
			);

			const result = await call(
				myReview,
				{ token: authResult.token },
				createTestContext(db),
			);

			expect(result).toStrictEqual({
				id: expect.any(Number),
				userId: authResult.user.id,
				rating: 4,
				text: reviewText,
				user: expect.objectContaining({
					id: authResult.user.id,
					username: "hasreview",
				}),
			});
		});

		it("should reject invalid token", async () => {
			expect(
				call(myReview, { token: "invalid-token" }, createTestContext(db)),
			).rejects.toThrow();
		});
	});

	describe("submit", () => {
		it("should submit a review and deduct coins", async () => {
			const authResult = await call(
				register,
				{
					username: "submituser",
					email: "submit@example.com",
					password: "password123",
				},
				createTestContext(db),
			);

			const initialCoins = 200;
			await db
				.update(userStatsTable)
				.set({ coinsCount: initialCoins, messagesCount: 100 })
				.where(eq(userStatsTable.userId, authResult.user.id));

			const result = await call(
				submit,
				{
					token: authResult.token,
					rating: 5,
					text: "Amazing service! I've been using it for months and it just keeps getting better and better.",
				},
				createTestContext(db),
			);

			expect(result.success).toBe(true);
			expect(result.depositTaken).toBe(100);
			expect(result.review).toBeDefined();

			// Verify coins were deducted
			const [stats] = await db
				.select()
				.from(userStatsTable)
				.where(eq(userStatsTable.userId, authResult.user.id));

			expect(stats?.coinsCount).toBe(initialCoins - 100);
		});

		it("should reject review with rating out of range", async () => {
			const authResult = await call(
				register,
				{
					username: "badrating",
					email: "badrating@example.com",
					password: "password123",
				},
				createTestContext(db),
			);

			await db
				.update(userStatsTable)
				.set({ coinsCount: 200, messagesCount: 100 })
				.where(eq(userStatsTable.userId, authResult.user.id));

			expect(
				call(
					submit,
					{
						token: authResult.token,
						rating: 6, // Invalid rating
						text: "This should fail due to invalid rating being too high for the validation.",
					},
					createTestContext(db),
				),
			).rejects.toThrow();

			expect(
				call(
					submit,
					{
						token: authResult.token,
						rating: 0, // Invalid rating
						text: "This should fail due to invalid rating being too low for the validation.",
					},
					createTestContext(db),
				),
			).rejects.toThrow();
		});

		it("should reject review with text too short", async () => {
			const authResult = await call(
				register,
				{
					username: "shorttext",
					email: "shorttext@example.com",
					password: "password123",
				},
				createTestContext(db),
			);

			await db
				.update(userStatsTable)
				.set({ coinsCount: 200, messagesCount: 100 })
				.where(eq(userStatsTable.userId, authResult.user.id));

			expect(
				call(
					submit,
					{
						token: authResult.token,
						rating: 5,
						text: "Too short", // Less than 50 chars
					},
					createTestContext(db),
				),
			).rejects.toThrow();
		});

		it("should reject duplicate reviews from same user", async () => {
			const authResult = await call(
				register,
				{
					username: "duplicater",
					email: "duplicater@example.com",
					password: "password123",
				},
				createTestContext(db),
			);

			await db
				.update(userStatsTable)
				.set({ coinsCount: 300, messagesCount: 100 })
				.where(eq(userStatsTable.userId, authResult.user.id));

			// First review
			await call(
				submit,
				{
					token: authResult.token,
					rating: 5,
					text: "First review submission that meets the minimum character requirement of 50 characters.",
				},
				createTestContext(db),
			);

			// Second review should fail
			expect(
				call(
					submit,
					{
						token: authResult.token,
						rating: 4,
						text: "Second review attempt that should fail because user already submitted a review.",
					},
					createTestContext(db),
				),
			).rejects.toThrow(
				new ORPCError("ALREADY_REVIEWED", {
					message: "You have already submitted a review",
				}),
			);
		});

		it("should reject if user doesn't have enough coins", async () => {
			const authResult = await call(
				register,
				{
					username: "nocoins",
					email: "nocoins@example.com",
					password: "password123",
				},
				createTestContext(db),
			);

			// Only give messages, not coins
			await db
				.update(userStatsTable)
				.set({ coinsCount: 50, messagesCount: 100 })
				.where(eq(userStatsTable.userId, authResult.user.id));

			expect(
				call(
					submit,
					{
						token: authResult.token,
						rating: 5,
						text: "This review should fail because I don't have enough coins to pay the deposit.",
					},
					createTestContext(db),
				),
			).rejects.toThrow();
		});

		it("should reject invalid token", async () => {
			expect(
				call(
					submit,
					{
						token: "invalid-token",
						rating: 5,
						text: "This should fail because the token is invalid and cannot be verified.",
					},
					createTestContext(db),
				),
			).rejects.toThrow();
		});
	});
});
