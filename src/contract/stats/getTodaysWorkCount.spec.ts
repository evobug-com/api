import { beforeEach, describe, expect, it } from "bun:test";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql/postgres";
import type { relations } from "../../db/relations.ts";
import type * as schema from "../../db/schema.ts";
import { userStatsLogTable, userStatsTable } from "../../db/schema.ts";
import { createTestContext, createTestDatabase } from "../shared/test-utils.ts";
import { createUser } from "../users/index.ts";
import { getTodaysWorkCount } from "./index.ts";

describe("getTodaysWorkCount functionality", () => {
	let db: BunSQLDatabase<typeof schema, typeof relations>;
	let testUserId: number;
	let testUserId2: number;

	beforeEach(async () => {
		db = await createTestDatabase();

		// Create test users for our tests (createUser automatically creates user_stats)
		const user1 = await call(
			createUser,
			{
				username: "workcounttest1",
				discordId: "123456789",
			},
			createTestContext(db),
		);
		testUserId = user1.id;

		const user2 = await call(
			createUser,
			{
				username: "workcounttest2",
				discordId: "987654321",
			},
			createTestContext(db),
		);
		testUserId2 = user2.id;

		// Update user stats for both users (they already exist from createUser)
		await db
			.update(userStatsTable)
			.set({
				coinsCount: 100,
				xpCount: 50,
				workCount: 0,
			})
			.where(eq(userStatsTable.userId, testUserId));

		await db
			.update(userStatsTable)
			.set({
				coinsCount: 100,
				xpCount: 50,
				workCount: 0,
			})
			.where(eq(userStatsTable.userId, testUserId2));
	});

	describe("Basic functionality", () => {
		it("should return 0 when user has no work activities today", async () => {
			const result = await call(
				getTodaysWorkCount,
				{ userId: testUserId },
				createTestContext(db),
			);

			expect(result.count).toBe(0);
			expect(result.todayStart).toBeInstanceOf(Date);

			// Verify todayStart is set to midnight
			const todayStart = new Date();
			todayStart.setHours(0, 0, 0, 0);
			expect(result.todayStart.getTime()).toBe(todayStart.getTime());
		});

		it("should count only today's work activities", async () => {
			const now = new Date();
			const yesterday = new Date(now);
			yesterday.setDate(yesterday.getDate() - 1);
			const tomorrow = new Date(now);
			tomorrow.setDate(tomorrow.getDate() + 1);

			// Create activities for different days
			await db.insert(userStatsLogTable).values([
				// Yesterday's work
				{
					userId: testUserId,
					activityType: "work",
					xpEarned: 10,
					coinsEarned: 100,
					createdAt: yesterday,
					notes: "Yesterday work",
				},
				// Today's works (3)
				{
					userId: testUserId,
					activityType: "work",
					xpEarned: 10,
					coinsEarned: 100,
					createdAt: now,
					notes: "Today work 1",
				},
				{
					userId: testUserId,
					activityType: "work",
					xpEarned: 10,
					coinsEarned: 100,
					createdAt: new Date(now.getTime() - 1000 * 60 * 60), // 1 hour ago
					notes: "Today work 2",
				},
				{
					userId: testUserId,
					activityType: "work",
					xpEarned: 10,
					coinsEarned: 100,
					createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 2), // 2 hours ago
					notes: "Today work 3",
				},
				// Tomorrow's work (shouldn't be counted even if exists in DB)
				{
					userId: testUserId,
					activityType: "work",
					xpEarned: 10,
					coinsEarned: 100,
					createdAt: tomorrow,
					notes: "Tomorrow work",
				},
			]);

			const result = await call(
				getTodaysWorkCount,
				{ userId: testUserId },
				createTestContext(db),
			);

			expect(result.count).toBe(3);
		});

		it("should count only 'work' activity type, not other types", async () => {
			const now = new Date();

			// Create various activity types
			await db.insert(userStatsLogTable).values([
				// Work activities (2)
				{
					userId: testUserId,
					activityType: "work",
					xpEarned: 10,
					coinsEarned: 100,
					createdAt: now,
					notes: "Work activity 1",
				},
				{
					userId: testUserId,
					activityType: "work",
					xpEarned: 10,
					coinsEarned: 100,
					createdAt: now,
					notes: "Work activity 2",
				},
				// Other activity types (should not be counted)
				{
					userId: testUserId,
					activityType: "daily",
					xpEarned: 20,
					coinsEarned: 200,
					createdAt: now,
					notes: "Daily activity",
				},
				{
					userId: testUserId,
					activityType: "work_milestone_23", // Not exactly "work"
					xpEarned: 250,
					coinsEarned: 2500,
					createdAt: now,
					notes: "Achievement",
				},
				{
					userId: testUserId,
					activityType: "quest",
					xpEarned: 30,
					coinsEarned: 300,
					createdAt: now,
					notes: "Quest activity",
				},
				{
					userId: testUserId,
					activityType: "bonus",
					xpEarned: 15,
					coinsEarned: 150,
					createdAt: now,
					notes: "Bonus activity",
				},
			]);

			const result = await call(
				getTodaysWorkCount,
				{ userId: testUserId },
				createTestContext(db),
			);

			expect(result.count).toBe(2);
		});
	});

	describe("Multiple users", () => {
		it("should handle different users separately", async () => {
			const now = new Date();

			// Create work activities for both users
			await db.insert(userStatsLogTable).values([
				// User 1 has 5 works today
				...Array.from({ length: 5 }, (_, i) => ({
					userId: testUserId,
					activityType: "work" as const,
					xpEarned: 10,
					coinsEarned: 100,
					createdAt: now,
					notes: `User1 work ${i + 1}`,
				})),
				// User 2 has 3 works today
				...Array.from({ length: 3 }, (_, i) => ({
					userId: testUserId2,
					activityType: "work" as const,
					xpEarned: 10,
					coinsEarned: 100,
					createdAt: now,
					notes: `User2 work ${i + 1}`,
				})),
			]);

			// Check user 1
			const result1 = await call(
				getTodaysWorkCount,
				{ userId: testUserId },
				createTestContext(db),
			);
			expect(result1.count).toBe(5);

			// Check user 2
			const result2 = await call(
				getTodaysWorkCount,
				{ userId: testUserId2 },
				createTestContext(db),
			);
			expect(result2.count).toBe(3);
		});

		it("should not count other users' work activities", async () => {
			const now = new Date();

			// Create work activities only for user 2
			await db.insert(userStatsLogTable).values([
				{
					userId: testUserId2,
					activityType: "work",
					xpEarned: 10,
					coinsEarned: 100,
					createdAt: now,
					notes: "User2 work",
				},
			]);

			// Check user 1 (should have 0)
			const result = await call(
				getTodaysWorkCount,
				{ userId: testUserId },
				createTestContext(db),
			);

			expect(result.count).toBe(0);
		});
	});

	describe("Achievement milestone scenarios", () => {
		it("should correctly report when user has exactly 23 works today", async () => {
			const now = new Date();

			// Create exactly 23 work activities
			await db.insert(userStatsLogTable).values(
				Array.from({ length: 23 }, (_, i) => ({
					userId: testUserId,
					activityType: "work" as const,
					xpEarned: 10,
					coinsEarned: 100,
					createdAt: new Date(now.getTime() - i * 1000 * 60 * 30), // Spread over last 11.5 hours
					notes: `Work ${i + 1}`,
				})),
			);

			const result = await call(
				getTodaysWorkCount,
				{ userId: testUserId },
				createTestContext(db),
			);

			expect(result.count).toBe(23);
		});

		it("should correctly report counts for progressive work throughout the day", async () => {
			const now = new Date();

			// Simulate user working throughout the day (22 works so far)
			const workTimes = Array.from({ length: 22 }, (_, i) => {
				const time = new Date(now);
				time.setHours(0, 30 * (i + 1), 0, 0); // Every 30 minutes starting from 00:30
				return time;
			});

			await db.insert(userStatsLogTable).values(
				workTimes.map((time, i) => ({
					userId: testUserId,
					activityType: "work" as const,
					xpEarned: 10,
					coinsEarned: 100,
					createdAt: time,
					notes: `Work ${i + 1}`,
				})),
			);

			// Count should be 22 (one away from achievement)
			let result = await call(
				getTodaysWorkCount,
				{ userId: testUserId },
				createTestContext(db),
			);
			expect(result.count).toBe(22);

			// Add the 23rd work
			await db.insert(userStatsLogTable).values({
				userId: testUserId,
				activityType: "work",
				xpEarned: 10,
				coinsEarned: 100,
				createdAt: now,
				notes: "Work 23 - Achievement!",
			});

			// Count should now be 23 (achievement unlocked)
			result = await call(
				getTodaysWorkCount,
				{ userId: testUserId },
				createTestContext(db),
			);
			expect(result.count).toBe(23);

			// Add the 24th work
			await db.insert(userStatsLogTable).values({
				userId: testUserId,
				activityType: "work",
				xpEarned: 10,
				coinsEarned: 100,
				createdAt: now,
				notes: "Work 24",
			});

			// Count should be 24 (past achievement)
			result = await call(
				getTodaysWorkCount,
				{ userId: testUserId },
				createTestContext(db),
			);
			expect(result.count).toBe(24);
		});
	});

	describe("Edge cases and boundary conditions", () => {
		it("should handle exactly midnight timestamp correctly", async () => {
			const midnight = new Date();
			midnight.setHours(0, 0, 0, 0);

			await db.insert(userStatsLogTable).values({
				userId: testUserId,
				activityType: "work",
				xpEarned: 10,
				coinsEarned: 100,
				createdAt: midnight,
				notes: "Exactly at midnight",
			});

			const result = await call(
				getTodaysWorkCount,
				{ userId: testUserId },
				createTestContext(db),
			);

			expect(result.count).toBe(1);
		});

		it("should handle 23:59:59 timestamp correctly", async () => {
			const almostMidnight = new Date();
			almostMidnight.setHours(23, 59, 59, 999);

			await db.insert(userStatsLogTable).values({
				userId: testUserId,
				activityType: "work",
				xpEarned: 10,
				coinsEarned: 100,
				createdAt: almostMidnight,
				notes: "Almost midnight",
			});

			const result = await call(
				getTodaysWorkCount,
				{ userId: testUserId },
				createTestContext(db),
			);

			expect(result.count).toBe(1);
		});

		it("should not count work from previous day at 23:59:59", async () => {
			const yesterday = new Date();
			yesterday.setDate(yesterday.getDate() - 1);
			yesterday.setHours(23, 59, 59, 999);

			await db.insert(userStatsLogTable).values({
				userId: testUserId,
				activityType: "work",
				xpEarned: 10,
				coinsEarned: 100,
				createdAt: yesterday,
				notes: "Yesterday's last work",
			});

			const result = await call(
				getTodaysWorkCount,
				{ userId: testUserId },
				createTestContext(db),
			);

			expect(result.count).toBe(0);
		});

		it("should handle large number of work activities efficiently", async () => {
			const now = new Date();

			// Create 100 work activities today
			await db.insert(userStatsLogTable).values(
				Array.from({ length: 100 }, (_, i) => ({
					userId: testUserId,
					activityType: "work" as const,
					xpEarned: 10,
					coinsEarned: 100,
					createdAt: new Date(now.getTime() - i * 1000 * 60 * 5), // Every 5 minutes
					notes: `Work ${i + 1}`,
				})),
			);

			const result = await call(
				getTodaysWorkCount,
				{ userId: testUserId },
				createTestContext(db),
			);

			expect(result.count).toBe(100);
		});

		it("should handle user with no stats record gracefully", async () => {
			// Create a new user without stats
			const userWithoutStats = await call(
				createUser,
				{
					username: "nostatsuser",
					discordId: "111111111",
				},
				createTestContext(db),
			);

			const result = await call(
				getTodaysWorkCount,
				{ userId: userWithoutStats.id },
				createTestContext(db),
			);

			expect(result.count).toBe(0);
		});

		it("should handle null or empty notes field", async () => {
			const now = new Date();

			await db.insert(userStatsLogTable).values([
				{
					userId: testUserId,
					activityType: "work",
					xpEarned: 10,
					coinsEarned: 100,
					createdAt: now,
					notes: null,
				},
				{
					userId: testUserId,
					activityType: "work",
					xpEarned: 10,
					coinsEarned: 100,
					createdAt: now,
					notes: "",
				},
			]);

			const result = await call(
				getTodaysWorkCount,
				{ userId: testUserId },
				createTestContext(db),
			);

			expect(result.count).toBe(2);
		});
	});

	describe("Date consistency", () => {
		it("should always return consistent todayStart regardless of when called", async () => {
			const result1 = await call(
				getTodaysWorkCount,
				{ userId: testUserId },
				createTestContext(db),
			);

			// Wait a bit and call again
			await new Promise(resolve => setTimeout(resolve, 100));

			const result2 = await call(
				getTodaysWorkCount,
				{ userId: testUserId },
				createTestContext(db),
			);

			// Both should return the same todayStart (midnight)
			expect(result1.todayStart.getTime()).toBe(result2.todayStart.getTime());

			// Verify it's actually midnight
			expect(result1.todayStart.getHours()).toBe(0);
			expect(result1.todayStart.getMinutes()).toBe(0);
			expect(result1.todayStart.getSeconds()).toBe(0);
			expect(result1.todayStart.getMilliseconds()).toBe(0);
		});
	});
});