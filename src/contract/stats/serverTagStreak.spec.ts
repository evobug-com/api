import { beforeEach, describe, expect, it } from "bun:test";
import { ORPCError } from "@orpc/client";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { relations } from "../../db/relations.ts";
import type * as schema from "../../db/schema.ts";
import { userStatsLogTable, userStatsTable } from "../../db/schema.ts";
import { createTestContext, createTestDatabase } from "../shared/test-utils.ts";
import { createUser } from "../users/index.ts";
import { checkServerTagStreak, getServerTagStreak } from "./index.ts";

describe("Server Tag Streak functionality", () => {
	let db: BunSQLDatabase<typeof schema, typeof relations>;
	let testUserId: number;

	beforeEach(async () => {
		db = await createTestDatabase();
		// Create a test user for our tests
		const user = await call(
			createUser,
			{
				username: "tagstreaktest",
				discordId: "123456789",
			},
			createTestContext(db),
		);
		testUserId = user.id;
	});

	describe("checkServerTagStreak", () => {
		it("should increment streak when user has server tag", async () => {
			const result = await call(
				checkServerTagStreak,
				{
					userId: testUserId,
					hasServerTag: true,
					serverTagBadge: "badge123",
				},
				createTestContext(db),
			);

			expect(result.streakChanged).toBe(true);
			expect(result.updatedStats.serverTagStreak).toBe(1);
			expect(result.updatedStats.maxServerTagStreak).toBe(1);
			expect(result.updatedStats.serverTagBadge).toBe("badge123");
			expect(result.rewardEarned).toBe(false);
			expect(result.message).toContain("Server tag streak increased to 1 days");
		});

		it("should reset streak when user doesn't have server tag", async () => {
			// First, build up a streak
			await call(
				checkServerTagStreak,
				{
					userId: testUserId,
					hasServerTag: true,
					serverTagBadge: "badge123",
				},
				createTestContext(db),
			);

			// Update lastServerTagCheck to simulate 13 hours ago
			await db
				.update(userStatsTable)
				.set({
					lastServerTagCheck: new Date(Date.now() - 21 * 60 * 60 * 1000),
				})
				.where(eq(userStatsTable.userId, testUserId));

			// Now check without server tag
			const result = await call(
				checkServerTagStreak,
				{
					userId: testUserId,
					hasServerTag: false,
				},
				createTestContext(db),
			);

			expect(result.streakChanged).toBe(true);
			expect(result.updatedStats.serverTagStreak).toBe(0);
			expect(result.updatedStats.maxServerTagStreak).toBe(1); // Should preserve max
			expect(result.message).toContain("Server tag streak reset");
		});

		it("should handle 5-day milestone rewards", async () => {
			// Manually set streak to 4 days
			await db
				.update(userStatsTable)
				.set({
					serverTagStreak: 4,
					maxServerTagStreak: 4,
					lastServerTagCheck: new Date(Date.now() - 21 * 60 * 60 * 1000),
				})
				.where(eq(userStatsTable.userId, testUserId));

			const result = await call(
				checkServerTagStreak,
				{
					userId: testUserId,
					hasServerTag: true,
					serverTagBadge: "badge123",
				},
				createTestContext(db),
			);

			expect(result.streakChanged).toBe(true);
			expect(result.updatedStats.serverTagStreak).toBe(5);
			expect(result.rewardEarned).toBe(true);
			expect(result.milestoneReached).toBe(5);
			expect(result.message).toContain("milestone reached: 5 days");
			expect(result.message).toContain("Earned 250 coins and 100 XP");
		});

		it("should calculate correct rewards for higher milestones", async () => {
			// Test 10-day milestone
			await db
				.update(userStatsTable)
				.set({
					serverTagStreak: 9,
					maxServerTagStreak: 9,
					coinsCount: 1000,
					xpCount: 500,
					lastServerTagCheck: new Date(Date.now() - 21 * 60 * 60 * 1000),
				})
				.where(eq(userStatsTable.userId, testUserId));

			const result = await call(
				checkServerTagStreak,
				{
					userId: testUserId,
					hasServerTag: true,
				},
				createTestContext(db),
			);

			expect(result.milestoneReached).toBe(10);
			expect(result.updatedStats.coinsCount).toBe(1500); // 1000 + (250 * 2)
			expect(result.updatedStats.xpCount).toBe(700); // 500 + (100 * 2)
			expect(result.message).toContain("Earned 500 coins and 200 XP"); // 250 * 2 and 100 * 2
		});

		it("should enforce 12-hour cooldown between checks", async () => {
			// First check
			await call(
				checkServerTagStreak,
				{
					userId: testUserId,
					hasServerTag: true,
					serverTagBadge: "badge123",
				},
				createTestContext(db),
			);

			// Try to check again immediately
			const result = await call(
				checkServerTagStreak,
				{
					userId: testUserId,
					hasServerTag: true,
					serverTagBadge: "badge123",
				},
				createTestContext(db),
			);

			expect(result.streakChanged).toBe(false);
			expect(result.rewardEarned).toBe(false);
			expect(result.message).toBe("Server tag already checked recently");
			expect(result.updatedStats.serverTagStreak).toBe(1); // Should remain unchanged
		});

		it("should maintain streak when badge changes", async () => {
			// First check with badge1
			await call(
				checkServerTagStreak,
				{
					userId: testUserId,
					hasServerTag: true,
					serverTagBadge: "badge1",
				},
				createTestContext(db),
			);

			// Update time to bypass cooldown
			await db
				.update(userStatsTable)
				.set({
					lastServerTagCheck: new Date(Date.now() - 21 * 60 * 60 * 1000),
				})
				.where(eq(userStatsTable.userId, testUserId));

			// Check with different badge
			const result = await call(
				checkServerTagStreak,
				{
					userId: testUserId,
					hasServerTag: true,
					serverTagBadge: "badge2",
				},
				createTestContext(db),
			);

			expect(result.streakChanged).toBe(true);
			expect(result.updatedStats.serverTagStreak).toBe(2);
			expect(result.updatedStats.serverTagBadge).toBe("badge2");
			// Badge change message is now properly implemented
			expect(result.message).toContain("Server tag updated to new badge, streak continues at 2 days!");
		});

		it("should log milestone rewards in user_stats_log", async () => {
			// Set up for milestone
			await db
				.update(userStatsTable)
				.set({
					serverTagStreak: 4,
					lastServerTagCheck: new Date(Date.now() - 21 * 60 * 60 * 1000),
				})
				.where(eq(userStatsTable.userId, testUserId));

			await call(
				checkServerTagStreak,
				{
					userId: testUserId,
					hasServerTag: true,
				},
				createTestContext(db),
			);

			// Check the log
			const logs = await db.select().from(userStatsLogTable).where(eq(userStatsLogTable.userId, testUserId));

			expect(logs).toHaveLength(1);
			expect(logs[0]?.activityType).toBe("server_tag_milestone");
			expect(logs[0]?.notes).toContain("Server tag streak milestone: 5 days");
			// Account for potential level up bonus
			expect(logs[0]?.coinsEarned).toBeGreaterThanOrEqual(250);
			expect(logs[0]?.xpEarned).toBe(100);
		});

		it("should throw error when user stats not found", async () => {
			await expect(
				call(
					checkServerTagStreak,
					{
						userId: 99999,
						hasServerTag: true,
					},
					createTestContext(db),
				),
			).rejects.toThrow(ORPCError);
		});

		it("should handle edge case of streak at 0 without server tag", async () => {
			// User with no streak and no server tag
			const result = await call(
				checkServerTagStreak,
				{
					userId: testUserId,
					hasServerTag: false,
				},
				createTestContext(db),
			);

			expect(result.streakChanged).toBe(false);
			expect(result.updatedStats.serverTagStreak).toBe(0);
			expect(result.message).toBe("No server tag detected");
		});
	});

	describe("getServerTagStreak", () => {
		it("should return streak information for user with no streak", async () => {
			const result = await call(
				getServerTagStreak,
				{
					userId: testUserId,
				},
				createTestContext(db),
			);

			expect(result.currentStreak).toBe(0);
			expect(result.maxStreak).toBe(0);
			expect(result.lastCheck).toBeUndefined();
			expect(result.nextMilestone).toBe(5);
			expect(result.daysUntilMilestone).toBe(5);
		});

		it("should return correct streak information for active streak", async () => {
			// Build up a streak
			await db
				.update(userStatsTable)
				.set({
					serverTagStreak: 3,
					maxServerTagStreak: 7,
					lastServerTagCheck: new Date(),
				})
				.where(eq(userStatsTable.userId, testUserId));

			const result = await call(
				getServerTagStreak,
				{
					userId: testUserId,
				},
				createTestContext(db),
			);

			expect(result.currentStreak).toBe(3);
			expect(result.maxStreak).toBe(7);
			expect(result.lastCheck).toBeDefined();
			expect(result.nextMilestone).toBe(5);
			expect(result.daysUntilMilestone).toBe(2);
		});

		it("should calculate correct next milestone for higher streaks", async () => {
			await db
				.update(userStatsTable)
				.set({
					serverTagStreak: 12,
					maxServerTagStreak: 12,
				})
				.where(eq(userStatsTable.userId, testUserId));

			const result = await call(
				getServerTagStreak,
				{
					userId: testUserId,
				},
				createTestContext(db),
			);

			expect(result.currentStreak).toBe(12);
			expect(result.nextMilestone).toBe(15);
			expect(result.daysUntilMilestone).toBe(3);
		});

		it("should handle exact milestone values", async () => {
			await db
				.update(userStatsTable)
				.set({
					serverTagStreak: 10,
					maxServerTagStreak: 10,
				})
				.where(eq(userStatsTable.userId, testUserId));

			const result = await call(
				getServerTagStreak,
				{
					userId: testUserId,
				},
				createTestContext(db),
			);

			expect(result.currentStreak).toBe(10);
			expect(result.nextMilestone).toBe(15);
			expect(result.daysUntilMilestone).toBe(5);
		});

		it("should throw error when user stats not found", async () => {
			await expect(
				call(
					getServerTagStreak,
					{
						userId: 99999,
					},
					createTestContext(db),
				),
			).rejects.toThrow(ORPCError);
		});
	});

	describe("Integration tests", () => {
		it("should handle complete lifecycle of streak management", async () => {
			// Day 1: Start streak
			let result = await call(
				checkServerTagStreak,
				{
					userId: testUserId,
					hasServerTag: true,
					serverTagBadge: "badge1",
				},
				createTestContext(db),
			);
			expect(result.updatedStats.serverTagStreak).toBe(1);

			// Day 2-4: Continue streak
			for (let day = 2; day <= 4; day++) {
				await db
					.update(userStatsTable)
					.set({
						lastServerTagCheck: new Date(Date.now() - 21 * 60 * 60 * 1000),
					})
					.where(eq(userStatsTable.userId, testUserId));

				result = await call(
					checkServerTagStreak,
					{
						userId: testUserId,
						hasServerTag: true,
						serverTagBadge: "badge1",
					},
					createTestContext(db),
				);
				expect(result.updatedStats.serverTagStreak).toBe(day);
			}

			// Day 5: Hit milestone
			await db
				.update(userStatsTable)
				.set({
					lastServerTagCheck: new Date(Date.now() - 21 * 60 * 60 * 1000),
				})
				.where(eq(userStatsTable.userId, testUserId));

			result = await call(
				checkServerTagStreak,
				{
					userId: testUserId,
					hasServerTag: true,
					serverTagBadge: "badge1",
				},
				createTestContext(db),
			);

			expect(result.updatedStats.serverTagStreak).toBe(5);
			expect(result.rewardEarned).toBe(true);
			expect(result.milestoneReached).toBe(5);

			// Check streak info
			const streakInfo = await call(
				getServerTagStreak,
				{
					userId: testUserId,
				},
				createTestContext(db),
			);

			expect(streakInfo.currentStreak).toBe(5);
			expect(streakInfo.maxStreak).toBe(5);
			expect(streakInfo.nextMilestone).toBe(10);
			expect(streakInfo.daysUntilMilestone).toBe(5);

			// Day 6: Lose streak
			await db
				.update(userStatsTable)
				.set({
					lastServerTagCheck: new Date(Date.now() - 21 * 60 * 60 * 1000),
				})
				.where(eq(userStatsTable.userId, testUserId));

			result = await call(
				checkServerTagStreak,
				{
					userId: testUserId,
					hasServerTag: false,
				},
				createTestContext(db),
			);

			expect(result.updatedStats.serverTagStreak).toBe(0);
			expect(result.updatedStats.maxServerTagStreak).toBe(5); // Max preserved

			// Check final streak info
			const finalInfo = await call(
				getServerTagStreak,
				{
					userId: testUserId,
				},
				createTestContext(db),
			);

			expect(finalInfo.currentStreak).toBe(0);
			expect(finalInfo.maxStreak).toBe(5);
			expect(finalInfo.nextMilestone).toBe(5);
			expect(finalInfo.daysUntilMilestone).toBe(5);
		});

		it("should properly track rewards across multiple milestones", async () => {
			// Start with some initial coins and XP
			await db
				.update(userStatsTable)
				.set({
					coinsCount: 1000,
					xpCount: 500,
				})
				.where(eq(userStatsTable.userId, testUserId));

			// Track total rewards
			let totalCoinsEarned = 0;
			let totalXpEarned = 0;

			// Test milestones at 5, 10, 15 days
			const milestones = [5, 10, 15];
			let currentStreak = 0;

			for (const milestone of milestones) {
				// Build up to milestone
				while (currentStreak < milestone - 1) {
					await db
						.update(userStatsTable)
						.set({
							serverTagStreak: currentStreak,
							lastServerTagCheck: new Date(Date.now() - 21 * 60 * 60 * 1000),
						})
						.where(eq(userStatsTable.userId, testUserId));

					await call(
						checkServerTagStreak,
						{
							userId: testUserId,
							hasServerTag: true,
						},
						createTestContext(db),
					);
					currentStreak++;
				}

				// Hit milestone
				await db
					.update(userStatsTable)
					.set({
						lastServerTagCheck: new Date(Date.now() - 21 * 60 * 60 * 1000),
					})
					.where(eq(userStatsTable.userId, testUserId));

				const result = await call(
					checkServerTagStreak,
					{
						userId: testUserId,
						hasServerTag: true,
					},
					createTestContext(db),
				);

				expect(result.milestoneReached).toBe(milestone);

				// Calculate expected rewards with cap at 10x
				const multiplier = Math.min(milestone / 5, 10);
				const expectedCoins = 250 * multiplier;
				const expectedXp = 100 * multiplier;

				totalCoinsEarned += expectedCoins;
				totalXpEarned += expectedXp;

				currentStreak++;
			}

			// Verify final stats
			const finalStats = await db.select().from(userStatsTable).where(eq(userStatsTable.userId, testUserId));

			// Account for potential level up bonuses (100 coins per level)
			expect(finalStats[0]?.coinsCount).toBeGreaterThanOrEqual(1000 + totalCoinsEarned);
			expect(finalStats[0]?.xpCount).toBe(500 + totalXpEarned);

			// Verify all logs
			const logs = await db.select().from(userStatsLogTable).where(eq(userStatsLogTable.userId, testUserId));

			const milestoneLogs = logs.filter((log) => log.activityType === "server_tag_milestone");
			expect(milestoneLogs).toHaveLength(3);
		});
	});
});
