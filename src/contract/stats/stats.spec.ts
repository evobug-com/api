import { describe, expect, it } from "bun:test";
import { ORPCError } from "@orpc/client";
import { call } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { type DbUser, userStatsLogTable, userStatsTable, usersTable } from "../../db/schema.ts";
import { calculateLevel } from "../../utils/stats-utils.ts";
import { orThrow } from "../../utils/ts-utils.ts";
import { createTestContext, createTestDatabase } from "../shared/test-utils.ts";
import { createUser } from "../users";
import { claimDaily, claimWork, leaderboard, userDailyCooldown, userStats, userWorkCooldown } from "./index.ts";

const db = await createTestDatabase();

describe("Stats", async () => {
	const testUser: DbUser = (await call(
		createUser,
		{
			username: "testUser",
		},
		createTestContext(db),
	)) as DbUser;

	describe("userDailyCooldown", () => {
		it("should return cooldown information for a user", async () => {
			const result = await call(
				userDailyCooldown,
				{
					userId: testUser.id,
				},
				createTestContext(db, testUser),
			);

			expect(result).toStrictEqual({
				isOnCooldown: false,
				cooldownRemaining: 0,
				cooldownEndTime: expect.any(Date),
			});
		});

		it("should calculate cooldown correctly for midnight", async () => {
			const result = await call(
				userDailyCooldown,
				{
					userId: testUser.id,
				},
				createTestContext(db, testUser),
			);

			const now = new Date();
			const midnight = new Date(now);
			midnight.setDate(midnight.getDate() + 1);
			midnight.setHours(0, 0, 0, 0);

			const expectedCooldownEndTime = midnight.getTime();
			const actualCooldownEndTime = result.cooldownEndTime.getTime();

			expect(Math.abs(expectedCooldownEndTime - actualCooldownEndTime)).toBeLessThan(1000);
		});

		it("should handle non-existent user gracefully", async () => {
			const result = await call(
				userDailyCooldown,
				{
					userId: 999999,
				},
				createTestContext(db, testUser),
			);

			expect(result).toBeDefined();
			expect(result.isOnCooldown).toBe(false);
			expect(result.cooldownRemaining).toBe(0);
		});
	});

	describe("claimDaily", () => {
		it("should successfully claim daily reward for first time", async () => {
			const result = await call(
				claimDaily,
				{
					userId: testUser.id,
					boostCount: 0,
				},
				createTestContext(db, testUser),
			);

			expect(result.updatedStats).toMatchObject({
				coinsCount: expect.any(Number),
				dailyStreak: 1,
				maxDailyStreak: 1,
				messagesCount: 0,
				updatedAt: expect.any(Date),
				userId: testUser.id,
				workCount: 0,
				xpCount: expect.any(Number),
			});

			// First daily doesn't give enough XP for level up (only ~57 XP, needs 100)
			expect(result.levelUp).toBeUndefined();
			if (result.levelUp) {
				expect(result.levelUp.oldLevel).toBe(1);
				expect(result.levelUp.newLevel).toBeGreaterThan(1);
				expect(result.levelUp.bonusCoins).toBeGreaterThan(0);
			}

			expect(result.claimStats).toMatchObject({
				baseCoins: expect.any(Number),
				baseXp: expect.any(Number),
				currentLevel: 1, // level before the claim
				earnedTotalCoins: expect.any(Number),
				earnedTotalXp: expect.any(Number),
				isMilestone: false,
				levelCoinsBonus: expect.any(Number),
				levelXpBonus: expect.any(Number),
				milestoneCoinsBonus: 0,
				milestoneXpBonus: 0,
				streakCoinsBonus: expect.any(Number),
				streakXpBonus: expect.any(Number),
			});

			expect(result.levelProgress).toMatchObject({
				currentXp: expect.any(Number),
				progressPercentage: expect.any(Number),
				xpForCurrentLevel: expect.any(Number),
				xpForNextLevel: expect.any(Number),
				xpNeeded: expect.any(Number),
				xpProgress: expect.any(Number),
				currentLevel: expect.any(Number),
			});
		});

		it("should not allow claiming daily reward twice in same day", async () => {
			expect(async () => {
				await call(
					claimDaily,
					{
						userId: testUser.id,
						boostCount: 0,
					},
					createTestContext(db, testUser),
				);
			}).toThrow(new ORPCError("NOT_ACCEPTABLE", { message: "Daily reward already claimed today" }));
		});

		it("should increase streak on consecutive days", async () => {
			// Set the cooldown expired
			const yesterday = new Date();
			yesterday.setDate(yesterday.getDate() - 1);
			yesterday.setHours(0, 0, 0, 0);
			await db
				.update(userStatsLogTable)
				.set({ createdAt: yesterday, updatedAt: yesterday })
				.where(eq(userStatsLogTable.userId, testUser.id));

			const initialStats = await call(
				userStats,
				{
					id: testUser.id,
				},
				createTestContext(db),
			);

			const result = await call(
				claimDaily,
				{
					userId: testUser.id,
					boostCount: 0,
				},
				createTestContext(db),
			);

			expect(result.updatedStats.dailyStreak).toBe(initialStats.stats.dailyStreak + 1);
			expect(result.updatedStats.maxDailyStreak).toBeGreaterThanOrEqual(result.updatedStats.dailyStreak);
		});

		it("should handle level up correctly", async () => {
			await db.update(userStatsTable).set({ xpCount: 99 }).where(eq(userStatsTable.userId, testUser.id));
			const yesterday = new Date();
			yesterday.setDate(yesterday.getDate() - 1);
			yesterday.setHours(0, 0, 0, 0);
			await db
				.update(userStatsLogTable)
				.set({ createdAt: yesterday, updatedAt: yesterday })
				.where(eq(userStatsLogTable.userId, testUser.id));

			const result = await call(
				claimDaily,
				{
					userId: testUser.id,
					boostCount: 0,
				},
				createTestContext(db),
			);

			if (result.levelUp) {
				expect(result.levelUp.newLevel).toBeGreaterThan(result.levelUp.oldLevel);
				expect(result.levelUp.bonusCoins).toBeGreaterThan(0);
			}
		});

		it("should give milestone bonus on 5th streak day", async () => {
			// Create a fresh user for this test
			const milestoneUser = await call(
				createUser,
				{
					username: "userForMilestone",
				},
				createTestContext(db),
			);

			// Set streak to 4 (will become 5 on claim)
			await db.update(userStatsTable).set({ dailyStreak: 4 }).where(eq(userStatsTable.userId, milestoneUser.id));

			// Create a daily log from yesterday to maintain streak
			const yesterday = new Date();
			yesterday.setDate(yesterday.getDate() - 1);
			yesterday.setHours(12, 0, 0, 0); // Set to noon yesterday
			await db.insert(userStatsLogTable).values({
				userId: milestoneUser.id,
				activityType: "daily",
				notes: "Yesterday's daily",
				xpEarned: 0,
				coinsEarned: 0,
				createdAt: yesterday,
				updatedAt: yesterday,
			});

			const result = await call(
				claimDaily,
				{
					userId: milestoneUser.id,
					boostCount: 0,
				},
				createTestContext(db, milestoneUser),
			);

			expect(result.updatedStats).toMatchObject({
				coinsCount: expect.any(Number),
				dailyStreak: 5,
				maxDailyStreak: 5,
				messagesCount: 0,
				updatedAt: expect.any(Date),
				userId: milestoneUser.id,
				workCount: 0,
				xpCount: expect.any(Number),
			});

			// 5th daily (milestone) gives more XP but still not enough for instant level up from 0
			// Base: 50, Level bonus: 2, Streak bonus: 25, Milestone bonus: 100 = 177 XP
			// This would level up to level 2 since it's > 100 XP
			expect(result.levelUp).toBeDefined();
			if (result.levelUp) {
				expect(result.levelUp.newLevel).toBeGreaterThan(result.levelUp.oldLevel);
				expect(result.levelUp.bonusCoins).toBeGreaterThan(0);
			}

			expect(result.claimStats).toMatchObject({
				baseCoins: expect.any(Number),
				baseXp: expect.any(Number),
				currentLevel: expect.any(Number),
				earnedTotalCoins: expect.any(Number),
				earnedTotalXp: expect.any(Number),
				isMilestone: true,
				levelCoinsBonus: expect.any(Number),
				levelXpBonus: expect.any(Number),
				milestoneCoinsBonus: 250,
				milestoneXpBonus: 100,
				streakCoinsBonus: expect.any(Number),
				streakXpBonus: expect.any(Number),
			});

			expect(result.levelProgress).toMatchObject({
				currentXp: expect.any(Number),
				progressPercentage: expect.any(Number),
				xpForCurrentLevel: expect.any(Number),
				xpForNextLevel: expect.any(Number),
				xpNeeded: expect.any(Number),
				xpProgress: expect.any(Number),
				currentLevel: expect.any(Number),
			});
		});

		it("should handle non-existent user", async () => {
			expect(async () => {
				await call(
					claimDaily,
					{
						userId: 999999,
						boostCount: 0,
					},
					createTestContext(db, testUser),
				);
			}).toThrow(new ORPCError("NOT_FOUND", { message: "User not found for the given userId / claimDaily" }));
		});

		it("should reset streak when missing a day", async () => {
			const userForStreakReset = await call(
				createUser,
				{
					username: "userForStreakReset",
				},
				createTestContext(db),
			);

			// Set up a streak of 3 days
			await db
				.update(userStatsTable)
				.set({ dailyStreak: 3, maxDailyStreak: 3 })
				.where(eq(userStatsTable.userId, userForStreakReset.id));

			// Create a log from 2 days ago (missed yesterday)
			const twoDaysAgo = new Date();
			twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
			twoDaysAgo.setHours(12, 0, 0, 0);

			await db.insert(userStatsLogTable).values([
				{
					userId: userForStreakReset.id,
					activityType: "daily",
					notes: "Daily reward claimed. Streak: 3",
					xpEarned: 50,
					coinsEarned: 25,
					createdAt: twoDaysAgo,
					updatedAt: twoDaysAgo,
				},
			]);

			// Claim daily today (should reset streak to 1)
			const result = await call(
				claimDaily,
				{
					userId: userForStreakReset.id,
					boostCount: 0,
				},
				createTestContext(db, userForStreakReset),
			);

			expect(result.updatedStats.dailyStreak).toBe(1);
			expect(result.updatedStats.maxDailyStreak).toBe(3); // Max streak should remain
		});

		it("should handle user with no stats gracefully", async () => {
			const userWithoutStats = await call(
				createUser,
				{
					username: "userWithoutStatsDaily",
				},
				createTestContext(db),
			);

			// Delete the auto-created stats
			await db.delete(userStatsTable).where(eq(userStatsTable.userId, userWithoutStats.id));

			expect(async () => {
				await call(
					claimDaily,
					{
						userId: userWithoutStats.id,
						boostCount: 0,
					},
					createTestContext(db, userWithoutStats),
				);
			}).toThrow(new ORPCError("NOT_FOUND", { message: "User stats not found for the given user / claimDaily" }));
		});

		it("should properly handle transaction rollback on failure", async () => {
			const userForTransactionDaily = await call(
				createUser,
				{
					username: "userForTransactionDaily",
				},
				createTestContext(db),
			);

			// Get initial stats
			await call(userStats, { id: userForTransactionDaily.id }, createTestContext(db));

			// Delete the user to cause transaction failure
			await db.delete(usersTable).where(eq(usersTable.id, userForTransactionDaily.id));

			// Attempt to claim daily (should fail)
			try {
				await call(
					claimDaily,
					{
						userId: userForTransactionDaily.id,
						boostCount: 0,
					},
					createTestContext(db, userForTransactionDaily),
				);
			} catch {
				// Expected to fail
			}

			// Check that no daily log was created (transaction rolled back)
			const dailyLogs = await db
				.select()
				.from(userStatsLogTable)
				.where(
					and(eq(userStatsLogTable.userId, userForTransactionDaily.id), eq(userStatsLogTable.activityType, "daily")),
				);

			expect(dailyLogs.length).toBe(0);
		});

		it("should give milestone bonus on 10th, 15th, 20th streak days", async () => {
			const userFor10thStreak = await call(
				createUser,
				{
					username: "userFor10thStreak",
				},
				createTestContext(db),
			);

			// Set streak to 9 (next will be 10th)
			await db
				.update(userStatsTable)
				.set({ dailyStreak: 9, maxDailyStreak: 9 })
				.where(eq(userStatsTable.userId, userFor10thStreak.id));

			// Add yesterday's log
			const yesterday = new Date();
			yesterday.setDate(yesterday.getDate() - 1);
			yesterday.setHours(12, 0, 0, 0);

			await db.insert(userStatsLogTable).values([
				{
					userId: userFor10thStreak.id,
					activityType: "daily",
					notes: "Daily reward claimed. Streak: 9",
					xpEarned: 50,
					coinsEarned: 25,
					createdAt: yesterday,
					updatedAt: yesterday,
				},
			]);

			// Claim for 10th day
			const result = await call(
				claimDaily,
				{
					userId: userFor10thStreak.id,
					boostCount: 0,
				},
				createTestContext(db, userFor10thStreak),
			);

			expect(result.updatedStats.dailyStreak).toBe(10);
			expect(result.claimStats.isMilestone).toBe(true);
			expect(result.claimStats.milestoneCoinsBonus).toBeGreaterThan(0);
			expect(result.claimStats.milestoneXpBonus).toBeGreaterThan(0);
		});

		it("should include level up bonus coins in the log", async () => {
			const userForLevelUpLog = await call(
				createUser,
				{
					username: "userForLevelUpLog",
				},
				createTestContext(db),
			);

			// Set XP close to level up
			await db
				.update(userStatsTable)
				.set({ xpCount: 95 }) // Close to level 2 (100 XP)
				.where(eq(userStatsTable.userId, userForLevelUpLog.id));

			const result = await call(
				claimDaily,
				{
					userId: userForLevelUpLog.id,
					boostCount: 0,
				},
				createTestContext(db, userForLevelUpLog),
			);

			// Should level up
			if (result.levelUp) {
				expect(result.levelUp.oldLevel).toBe(1);
				expect(result.levelUp.newLevel).toBeGreaterThanOrEqual(2);
				expect(result.levelUp.bonusCoins).toBe((result.levelUp.newLevel - result.levelUp.oldLevel) * 100);

				// Check that the log includes level up bonus
				const log = await db
					.select()
					.from(userStatsLogTable)
					.where(and(eq(userStatsLogTable.userId, userForLevelUpLog.id), eq(userStatsLogTable.activityType, "daily")))
					.limit(1);

				expect(log[0]?.coinsEarned).toBe(result.claimStats.earnedTotalCoins + result.levelUp.bonusCoins);
			}
		});

		it("should set cooldown to next midnight", async () => {
			const userForCooldownTime = await call(
				createUser,
				{
					username: "userForDailyCooldownTime",
				},
				createTestContext(db),
			);

			const beforeClaim = new Date();
			await call(
				claimDaily,
				{
					userId: userForCooldownTime.id,
					boostCount: 0,
				},
				createTestContext(db, userForCooldownTime),
			);

			// Check the cooldown via userDailyCooldown
			const cooldownResult = await call(
				userDailyCooldown,
				{
					userId: userForCooldownTime.id,
				},
				createTestContext(db, userForCooldownTime),
			);

			expect(cooldownResult.isOnCooldown).toBe(true);
			expect(cooldownResult.cooldownEndTime).toBeDefined();

			if (cooldownResult.cooldownEndTime) {
				// Should be tomorrow at midnight
				const expectedMidnight = new Date(beforeClaim);
				expectedMidnight.setDate(expectedMidnight.getDate() + 1);
				expectedMidnight.setHours(0, 0, 0, 0);

				// Compare the full timestamp
				expect(cooldownResult.cooldownEndTime.getTime()).toBe(expectedMidnight.getTime());
			}
		});
	});

	describe("claimWork", () => {
		it("should successfully claim work for first time", async () => {
			const freshUser = await call(
				createUser,
				{
					username: "freshUserForFirstWork",
				},
				createTestContext(db),
			);

			const result = await call(
				claimWork,
				{
					userId: freshUser.id,
					boostCount: 0,
				},
				createTestContext(db, freshUser),
			);

			expect(result.statsLog).toBeDefined();
			expect(result.statsLog.activityType).toBe("work");
			expect(result.statsLog.userId).toBe(freshUser.id);
			expect(result.statsLog.xpEarned).toBeGreaterThan(0);
			expect(result.statsLog.coinsEarned).toBeGreaterThan(0);
			expect(result.statsLog.createdAt).toBeInstanceOf(Date);

			expect(result.updatedStats).toBeDefined();
			expect(result.updatedStats.workCount).toBe(1);
			expect(result.updatedStats.coinsCount).toBeGreaterThan(0);
			expect(result.updatedStats.xpCount).toBeGreaterThan(0);

			expect(result.message).toContain("Work completed!");
			expect(result.message).toContain("coins");
			expect(result.message).toContain("XP");

			expect(result.claimStats).toMatchObject({
				baseCoins: expect.any(Number),
				baseXp: expect.any(Number),
				currentLevel: expect.any(Number),
				earnedTotalCoins: expect.any(Number),
				earnedTotalXp: expect.any(Number),
				isMilestone: false,
				levelCoinsBonus: expect.any(Number),
				levelXpBonus: expect.any(Number),
				milestoneCoinsBonus: 0,
				milestoneXpBonus: 0,
				streakCoinsBonus: 0,
				streakXpBonus: 0,
			});

			expect(result.levelProgress).toMatchObject({
				currentXp: expect.any(Number),
				progressPercentage: expect.any(Number),
				xpForCurrentLevel: expect.any(Number),
				xpForNextLevel: expect.any(Number),
				xpNeeded: expect.any(Number),
				xpProgress: expect.any(Number),
				currentLevel: expect.any(Number),
			});
		});

		it("should not allow claiming work while on cooldown", async () => {
			const userForCooldown = await call(
				createUser,
				{
					username: "userForWorkCooldown",
				},
				createTestContext(db),
			);

			// First work claim
			await call(
				claimWork,
				{
					userId: userForCooldown.id,
					boostCount: 0,
				},
				createTestContext(db, userForCooldown),
			);

			// Try to claim again immediately
			expect(async () => {
				await call(
					claimWork,
					{
						userId: userForCooldown.id,
						boostCount: 0,
					},
					createTestContext(db, userForCooldown),
				);
			}).toThrow(ORPCError);
		});

		it("should allow claiming work after cooldown expires", async () => {
			const userForExpiredCooldown = await call(
				createUser,
				{
					username: "userForExpiredWorkCooldown",
				},
				createTestContext(db),
			);

			// First claim work
			const firstClaim = await call(
				claimWork,
				{
					userId: userForExpiredCooldown.id,
					boostCount: 0,
				},
				createTestContext(db, userForExpiredCooldown),
			);

			expect(firstClaim.updatedStats.workCount).toBe(1);

			// Update lastWorkAt to be more than 1 hour ago (cooldown expired)
			await db
				.update(userStatsTable)
				.set({
					lastWorkAt: new Date(Date.now() - 61 * 60 * 1000), // 61 minutes ago
				})
				.where(eq(userStatsTable.userId, userForExpiredCooldown.id));

			// Second claim should work
			const result = await call(
				claimWork,
				{
					userId: userForExpiredCooldown.id,
					boostCount: 0,
				},
				createTestContext(db, userForExpiredCooldown),
			);

			expect(result.statsLog).toBeDefined();
			expect(result.updatedStats.workCount).toBe(2);
			expect(result.message).toContain("Work completed!");
		});

		it("should increment work count correctly", async () => {
			const userForWorkCount = await call(
				createUser,
				{
					username: "userForWorkCount",
				},
				createTestContext(db),
			);

			// First work
			const firstWork = await call(
				claimWork,
				{
					userId: userForWorkCount.id,
					boostCount: 0,
				},
				createTestContext(db, userForWorkCount),
			);
			expect(firstWork.updatedStats.workCount).toBe(1);

			// Wait for cooldown to expire by updating lastWorkAt
			await db
				.update(userStatsTable)
				.set({
					lastWorkAt: new Date(Date.now() - 61 * 60 * 1000), // 61 minutes ago
				})
				.where(eq(userStatsTable.userId, userForWorkCount.id));

			// Second work
			const secondWork = await call(
				claimWork,
				{
					userId: userForWorkCount.id,
					boostCount: 0,
				},
				createTestContext(db, userForWorkCount),
			);
			expect(secondWork.updatedStats.workCount).toBe(2);
		});

		it("should calculate rewards based on user level", async () => {
			const userForLevelRewards = await call(
				createUser,
				{
					username: "userForLevelRewards",
				},
				createTestContext(db),
			);

			// Update existing stats to higher level (more XP)
			await db
				.update(userStatsTable)
				.set({
					xpCount: 500, // Should be level 3+
					coinsCount: 0,
					workCount: 0,
				})
				.where(eq(userStatsTable.userId, userForLevelRewards.id));

			const result = await call(
				claimWork,
				{
					userId: userForLevelRewards.id,
					boostCount: 0,
				},
				createTestContext(db, userForLevelRewards),
			);

			expect(result.statsLog.xpEarned).toBeGreaterThan(0);
			expect(result.statsLog.coinsEarned).toBeGreaterThan(0);
			expect(result.updatedStats.xpCount).toBe(500 + result.statsLog.xpEarned);
		});

		it("should handle non-existent user stats", async () => {
			const userWithoutStats = await call(
				createUser,
				{
					username: "userWithoutStatsForWork",
				},
				createTestContext(db),
			);

			// Delete the auto-created stats
			await db.delete(userStatsTable).where(eq(userStatsTable.userId, userWithoutStats.id));

			expect(async () => {
				await call(
					claimWork,
					{
						userId: userWithoutStats.id,
						boostCount: 0,
					},
					createTestContext(db, userWithoutStats),
				);
			}).toThrow(new ORPCError("NOT_FOUND", { message: "User stats not found for the given user / claimWork" }));
		});

		it("should set cooldown to exactly 1 hour from claim time", async () => {
			const userForCooldownTiming = await call(
				createUser,
				{
					username: "userForCooldownTiming",
				},
				createTestContext(db),
			);

			const beforeClaim = new Date();
			const result = await call(
				claimWork,
				{
					userId: userForCooldownTiming.id,
					boostCount: 0,
				},
				createTestContext(db, userForCooldownTiming),
			);
			const afterClaim = new Date();

			// statsLog.createdAt should be the current time, not the cooldown end time
			const logCreatedAt = result.statsLog.createdAt;

			// The log should have been created between beforeClaim and afterClaim
			expect(logCreatedAt.getTime()).toBeGreaterThanOrEqual(beforeClaim.getTime());
			expect(logCreatedAt.getTime()).toBeLessThanOrEqual(afterClaim.getTime());

			// The actual cooldown is stored in updatedStats.lastWorkAt
			const lastWorkAt = result.updatedStats.lastWorkAt;
			expect(lastWorkAt).toBeDefined();
			if (lastWorkAt) {
				// lastWorkAt should also be around the current time
				expect(lastWorkAt.getTime()).toBeGreaterThanOrEqual(beforeClaim.getTime());
				expect(lastWorkAt.getTime()).toBeLessThanOrEqual(afterClaim.getTime());
			}
		});

		it("should include work count in activity notes", async () => {
			const userForNotes = await call(
				createUser,
				{
					username: "userForWorkNotes",
				},
				createTestContext(db),
			);

			const result = await call(
				claimWork,
				{
					userId: userForNotes.id,
					boostCount: 0,
				},
				createTestContext(db, userForNotes),
			);

			expect(result.statsLog.notes).toContain("Work activity completed");
			expect(result.statsLog.notes).toContain("Total work count: 1");
		});

		it("should properly handle transaction rollback on failure", async () => {
			// This test ensures atomicity - if any part fails, everything should roll back
			const userForTransaction = await call(
				createUser,
				{
					username: "userForTransactionTest",
				},
				createTestContext(db),
			);

			// Get initial stats
			await call(userStats, { id: userForTransaction.id }, createTestContext(db));

			// Delete stats to cause transaction failure
			await db.delete(userStatsTable).where(eq(userStatsTable.userId, userForTransaction.id));

			// Attempt to claim work (should fail)
			try {
				await call(
					claimWork,
					{
						userId: userForTransaction.id,
						boostCount: 0,
					},
					createTestContext(db, userForTransaction),
				);
			} catch {
				// Expected to fail
			}

			// Check that no work log was created (transaction rolled back)
			const workLogs = await db
				.select()
				.from(userStatsLogTable)
				.where(and(eq(userStatsLogTable.userId, userForTransaction.id), eq(userStatsLogTable.activityType, "work")));

			expect(workLogs.length).toBe(0);
		});
	});

	describe("userWorkCooldown", async () => {
		it("should return no cooldown when user has no previous work activity", async () => {
			// Create a fresh user for this test
			const freshUser = await call(
				createUser,
				{
					username: "freshUserForWork",
				},
				createTestContext(db),
			);

			const result = await call(
				userWorkCooldown,
				{
					userId: freshUser.id,
				},
				createTestContext(db, freshUser),
			);

			expect(result).toStrictEqual({
				isOnCooldown: false,
				cooldownRemaining: 0,
			});
		});

		it("should return no cooldown when last work was claimed more than 1 hour ago", async () => {
			// Create a user for this test
			const userForOldWork = await call(
				createUser,
				{
					username: "userForOldWorkCooldown",
				},
				createTestContext(db),
			);

			// Claim work first
			await call(
				claimWork,
				{
					userId: userForOldWork.id,
					boostCount: 0,
				},
				createTestContext(db, userForOldWork),
			);

			// Update lastWorkAt to be expired (more than 1 hour ago)
			const moreThanOneHourAgo = new Date(Date.now() - 61 * 60 * 1000); // 61 minutes ago
			await db
				.update(userStatsTable)
				.set({
					lastWorkAt: moreThanOneHourAgo,
				})
				.where(eq(userStatsTable.userId, userForOldWork.id));

			const result = await call(
				userWorkCooldown,
				{
					userId: userForOldWork.id,
				},
				createTestContext(db, userForOldWork),
			);

			expect(result.isOnCooldown).toBe(false);
			expect(result.cooldownRemaining).toBe(0);
			expect(result.cooldownEndTime).toBeUndefined();
			expect(result.lastActivity).toBeDefined(); // Should still have the work activity in logs
		});

		it("should return cooldown after recent work claim", async () => {
			// Create a user for this test
			const userForRecentWork = await call(
				createUser,
				{
					username: "userForRecentWorkCheck",
				},
				createTestContext(db),
			);

			// Claim work
			const workResult = await call(
				claimWork,
				{
					userId: userForRecentWork.id,
					boostCount: 0,
				},
				createTestContext(db, userForRecentWork),
			);

			// Check cooldown immediately after claiming
			const result = await call(
				userWorkCooldown,
				{
					userId: userForRecentWork.id,
				},
				createTestContext(db, userForRecentWork),
			);

			expect(result.isOnCooldown).toBe(true);
			expect(result.cooldownRemaining).toBeGreaterThan(59 * 60); // Should be close to 60 minutes
			expect(result.cooldownRemaining).toBeLessThanOrEqual(60 * 60); // Should not exceed 60 minutes
			expect(result.cooldownEndTime).toBeInstanceOf(Date);
			// cooldownEndTime should be 1 hour after the work was done (stored in lastWorkAt)
			if (workResult.updatedStats.lastWorkAt && result.cooldownEndTime) {
				const expectedCooldownEnd = workResult.updatedStats.lastWorkAt.getTime() + 60 * 60 * 1000;
				expect(result.cooldownEndTime.getTime()).toBe(expectedCooldownEnd);
			}
			expect(result.lastActivity).toBeDefined();
			expect(result.lastActivity?.activityType).toBe("work");
			expect(result.lastActivity?.userId).toBe(userForRecentWork.id);
		});

		it("should return no cooldown when work activity was exactly 1 hour ago", async () => {
			// Create a user for this test
			const userForExactHour = await call(
				createUser,
				{
					username: "userForExactHour",
				},
				createTestContext(db),
			);

			// First claim work to create the stats record
			await call(
				claimWork,
				{
					userId: userForExactHour.id,
					boostCount: 0,
				},
				createTestContext(db, userForExactHour),
			);

			// Update lastWorkAt to be exactly 1 hour ago
			const exactlyOneHourAgo = new Date(Date.now() - 60 * 60 * 1000); // Exactly 1 hour ago
			await db
				.update(userStatsTable)
				.set({
					lastWorkAt: exactlyOneHourAgo,
				})
				.where(eq(userStatsTable.userId, userForExactHour.id));

			const result = await call(
				userWorkCooldown,
				{
					userId: userForExactHour.id,
				},
				createTestContext(db, userForExactHour),
			);

			expect(result.isOnCooldown).toBe(false);
			expect(result.cooldownRemaining).toBe(0);
			expect(result.cooldownEndTime).toBeUndefined();
			expect(result.lastActivity).toBeDefined(); // The work activity should still be in logs
		});

		it("should use most recent work when multiple work claims exist", async () => {
			// Create a user for this test
			const userForMultipleWork = await call(
				createUser,
				{
					username: "userForMultipleWorkClaims",
				},
				createTestContext(db),
			);

			// First work claim
			await call(
				claimWork,
				{
					userId: userForMultipleWork.id,
					boostCount: 0,
				},
				createTestContext(db, userForMultipleWork),
			);

			// Expire the first cooldown by updating lastWorkAt
			await db
				.update(userStatsTable)
				.set({
					lastWorkAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
				})
				.where(eq(userStatsTable.userId, userForMultipleWork.id));

			// Second work claim
			const secondWork = await call(
				claimWork,
				{
					userId: userForMultipleWork.id,
					boostCount: 0,
				},
				createTestContext(db, userForMultipleWork),
			);

			const result = await call(
				userWorkCooldown,
				{
					userId: userForMultipleWork.id,
				},
				createTestContext(db, userForMultipleWork),
			);

			expect(result.isOnCooldown).toBe(true);
			expect(result.cooldownRemaining).toBeGreaterThan(0);
			// cooldownEndTime should be 1 hour after the second work was done
			if (secondWork.updatedStats.lastWorkAt && result.cooldownEndTime) {
				const expectedCooldownEnd = secondWork.updatedStats.lastWorkAt.getTime() + 60 * 60 * 1000;
				expect(result.cooldownEndTime.getTime()).toBe(expectedCooldownEnd);
			}
			expect(result.lastActivity?.notes).toContain("Total work count: 2");
		});

		it("should ignore non-work activities when calculating cooldown", async () => {
			// Create a user for this test
			const userForNonWork = await call(
				createUser,
				{
					username: "userForNonWork",
				},
				createTestContext(db),
			);

			// Insert recent non-work activity (daily claim) - this shouldn't affect work cooldown
			const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

			await db.insert(userStatsLogTable).values([
				{
					userId: userForNonWork.id,
					activityType: "daily",
					notes: "Daily claim activity",
					xpEarned: 100,
					coinsEarned: 50,
					createdAt: tenMinutesAgo,
					updatedAt: tenMinutesAgo,
				},
			]);

			// userWorkCooldown checks userStatsTable.lastWorkAt, not the log table
			// Since no work has been done, lastWorkAt is null and there's no cooldown
			const result = await call(
				userWorkCooldown,
				{
					userId: userForNonWork.id,
				},
				createTestContext(db, userForNonWork),
			);

			expect(result.isOnCooldown).toBe(false);
			expect(result.cooldownRemaining).toBe(0);
			expect(result.cooldownEndTime).toBeUndefined();
			expect(result.lastActivity).toBeUndefined();
		});

		it("should handle non-existent user gracefully", async () => {
			const result = await call(
				userWorkCooldown,
				{
					userId: 999999,
				},
				createTestContext(db, testUser),
			);

			expect(result).toStrictEqual({
				isOnCooldown: false,
				cooldownRemaining: 0,
			});
		});

		it("should calculate cooldown remaining time accurately", async () => {
			// Create a user for this test
			const userForAccurateTiming = await call(
				createUser,
				{
					username: "userForAccurateTimingWork",
				},
				createTestContext(db),
			);

			// Claim work
			await call(
				claimWork,
				{
					userId: userForAccurateTiming.id,
					boostCount: 0,
				},
				createTestContext(db, userForAccurateTiming),
			);

			// Update lastWorkAt to be 45 minutes old
			const fortyFiveMinutesAgo = new Date(Date.now() - 45 * 60 * 1000);

			await db
				.update(userStatsTable)
				.set({
					lastWorkAt: fortyFiveMinutesAgo,
				})
				.where(eq(userStatsTable.userId, userForAccurateTiming.id));

			const result = await call(
				userWorkCooldown,
				{
					userId: userForAccurateTiming.id,
				},
				createTestContext(db, userForAccurateTiming),
			);

			expect(result.isOnCooldown).toBe(true);
			expect(result.cooldownRemaining).toBeGreaterThan(14 * 60); // Should be around 15 minutes (900 seconds) or more
			expect(result.cooldownRemaining).toBeLessThanOrEqual(15 * 60 + 5); // Allow for small timing variations
			expect(result.cooldownEndTime).toBeInstanceOf(Date);
			expect(result.lastActivity).toBeDefined();
		});

		it("should return no cooldown when createdAt is in the past", async () => {
			// Create a user for this test
			const userForExpiredCooldown = await call(
				createUser,
				{
					username: "userForExpiredCooldown",
				},
				createTestContext(db),
			);

			// First claim work to create the stats record
			await call(
				claimWork,
				{
					userId: userForExpiredCooldown.id,
					boostCount: 0,
				},
				createTestContext(db, userForExpiredCooldown),
			);

			// Update lastWorkAt to be more than 1 hour ago (cooldown expired)
			const moreThanOneHourAgo = new Date(Date.now() - 65 * 60 * 1000); // 65 minutes ago
			await db
				.update(userStatsTable)
				.set({
					lastWorkAt: moreThanOneHourAgo,
				})
				.where(eq(userStatsTable.userId, userForExpiredCooldown.id));

			const result = await call(
				userWorkCooldown,
				{
					userId: userForExpiredCooldown.id,
				},
				createTestContext(db, userForExpiredCooldown),
			);

			expect(result.isOnCooldown).toBe(false);
			expect(result.cooldownRemaining).toBe(0);
			expect(result.cooldownEndTime).toBeUndefined();
			expect(result.lastActivity).toBeDefined();
			// The last activity will be from the initial claim, not the expired one
			expect(result.lastActivity?.activityType).toBe("work");
		});
	});

	describe("leaderboard", async () => {
		// Create test users with various stats for comprehensive testing
		const leaderboardUser1 = await call(createUser, { username: "leaderboardUser1" }, createTestContext(db));
		const leaderboardUser2 = await call(createUser, { username: "leaderboardUser2" }, createTestContext(db));
		const leaderboardUser3 = await call(createUser, { username: "leaderboardUser3" }, createTestContext(db));
		const leaderboardUser4 = await call(createUser, { username: "leaderboardUser4" }, createTestContext(db));
		const leaderboardUser5 = await call(createUser, { username: "leaderboardUser5" }, createTestContext(db));

		// Set up diverse stats for testing different metrics
		await db
			.update(userStatsTable)
			.set({
				coinsCount: 1000,
				xpCount: 500,
				dailyStreak: 5,
				maxDailyStreak: 10,
				workCount: 20,
			})
			.where(eq(userStatsTable.userId, leaderboardUser1.id));

		await db
			.update(userStatsTable)
			.set({
				coinsCount: 1500,
				xpCount: 300,
				dailyStreak: 3,
				maxDailyStreak: 8,
				workCount: 15,
			})
			.where(eq(userStatsTable.userId, leaderboardUser2.id));

		await db
			.update(userStatsTable)
			.set({
				coinsCount: 800,
				xpCount: 800,
				dailyStreak: 7,
				maxDailyStreak: 12,
				workCount: 25,
			})
			.where(eq(userStatsTable.userId, leaderboardUser3.id));

		await db
			.update(userStatsTable)
			.set({
				coinsCount: 1200,
				xpCount: 100,
				dailyStreak: 2,
				maxDailyStreak: 15,
				workCount: 10,
			})
			.where(eq(userStatsTable.userId, leaderboardUser4.id));

		await db
			.update(userStatsTable)
			.set({
				coinsCount: 900,
				xpCount: 600,
				dailyStreak: 4,
				maxDailyStreak: 6,
				workCount: 30,
			})
			.where(eq(userStatsTable.userId, leaderboardUser5.id));

		describe("Basic functionality", () => {
			it("should return leaderboard with default parameters (coins metric, limit 10)", async () => {
				const result = await call(leaderboard, {}, createTestContext(db));

				expect(result).toBeInstanceOf(Array);
				expect(result.length).toBeLessThanOrEqual(10);

				// Basic structure test - leaderboard should return correct format
				expect(
					result.every(
						(entry) =>
							Object.hasOwn(entry, "user") && Object.hasOwn(entry, "metricValue") && Object.hasOwn(entry, "rank"),
					),
				).toBe(true);

				// If there are results, check basic properties
				if (result.length > 0) {
					// Should have sequential ranks starting from 1
					for (let i = 0; i < result.length; i++) {
						expect(result[i]?.rank).toBe(i + 1);
					}

					// Each entry should have a user object with required fields
					for (const entry of result) {
						expect(entry.user).toHaveProperty("id");
						expect(entry.user).toHaveProperty("username");
						expect(entry.user).toHaveProperty("discordId");
						expect(entry.user).toHaveProperty("guildedId");
					}
				}
			});

			it("should handle explicit coins metric parameter", async () => {
				const result = await call(leaderboard, { metric: "coins" }, createTestContext(db));

				expect(result).toBeInstanceOf(Array);

				// If users exist, verify ordering and structure
				if (result.length > 0) {
					// Check if our test user exists
					const targetUser = result.find((entry) => entry.user.username === "leaderboardUser2");
					if (targetUser) {
						expect(targetUser.metricValue).toBe(1500);
					}

					// Verify ordering
					if (result.length > 1) {
						for (let i = 0; i < result.length - 1; i++) {
							expect(result[i]?.metricValue).toBeGreaterThanOrEqual(
								orThrow(result[i + 1]?.metricValue, "No next metric value"),
							);
						}
					}
				}
			});

			it("should handle explicit limit parameter", async () => {
				const result = await call(leaderboard, { limit: 3 }, createTestContext(db));

				expect(result).toBeInstanceOf(Array);
				expect(result.length).toBe(3);

				// Should still be ordered by coins (default metric)
				expect(typeof result[0]?.metricValue).toBe("number");
				expect(typeof result[1]?.metricValue).toBe("number");
				expect(typeof result[2]?.metricValue).toBe("number");
				expect(result[0]?.metricValue).toBeGreaterThanOrEqual(
					orThrow(result[1]?.metricValue, "No metric value for result[1]"),
				);
				expect(result[1]?.metricValue).toBeGreaterThanOrEqual(
					orThrow(result[2]?.metricValue, "No metric value for result[2]"),
				);
			});
		});

		describe("Metric types", () => {
			it("should return leaderboard sorted by XP", async () => {
				const result = await call(leaderboard, { metric: "xp" }, createTestContext(db));

				expect(result).toBeInstanceOf(Array);
				expect(result.length).toBeGreaterThan(0);

				// Verify leaderboardUser3 has 800 XP and is in the results
				const targetUser = result.find((entry) => entry.user.username === "leaderboardUser3");
				expect(targetUser).toBeDefined();
				expect(targetUser?.metricValue).toBe(800);

				// Ensure descending order
				for (let i = 0; i < result.length - 1; i++) {
					const currentValue = result[i]?.metricValue;
					const nextValue = result[i + 1]?.metricValue;
					expect(typeof currentValue).toBe("number");
					expect(typeof nextValue).toBe("number");
					expect(currentValue).toBeGreaterThanOrEqual(
						orThrow(nextValue, `No next metric value for result[${i + 1}] in XP leaderboard`),
					);
				}
			});

			it("should return leaderboard sorted by level (calculated from XP)", async () => {
				const result = await call(leaderboard, { metric: "level" }, createTestContext(db));

				expect(result).toBeInstanceOf(Array);
				expect(result.length).toBeGreaterThan(0);

				// Verify that levels are calculated from XP
				for (const entry of result) {
					// const expectedLevel = calculateLevel(entry.metricValue);
					// Find the user's XP to calculate expected level
					const userStats = await db
						.select()
						.from(userStatsTable)
						.where(eq(userStatsTable.userId, entry.user.id))
						.limit(1);

					if (userStats[0]) {
						const expectedLevelFromDb = calculateLevel(userStats[0].xpCount);
						expect(entry.metricValue).toBe(expectedLevelFromDb);
					}
				}

				// Ensure descending order by level
				for (let i = 0; i < result.length - 1; i++) {
					expect(result[i]?.metricValue).toBeGreaterThanOrEqual(
						orThrow(result[i + 1]?.metricValue, `No metric value for result[${i + 1}] in coins leaderboard`),
					);
				}
			});

			it("should return leaderboard sorted by daily streak", async () => {
				const result = await call(leaderboard, { metric: "dailystreak" }, createTestContext(db));

				expect(result).toBeInstanceOf(Array);
				expect(result.length).toBeGreaterThan(0);

				// Verify leaderboardUser3 has daily streak of 7 and is in the results
				const targetUser = result.find((entry) => entry.user.username === "leaderboardUser3");
				expect(targetUser).toBeDefined();
				expect(targetUser?.metricValue).toBe(7);

				// Ensure descending order
				for (let i = 0; i < result.length - 1; i++) {
					const currentValue = result[i]?.metricValue;
					const nextValue = result[i + 1]?.metricValue;
					expect(typeof currentValue).toBe("number");
					expect(typeof nextValue).toBe("number");
					expect(currentValue).toBeGreaterThanOrEqual(
						orThrow(nextValue, `No next metric value for result[${i + 1}] in XP leaderboard`),
					);
				}
			});

			it("should return leaderboard sorted by max daily streak", async () => {
				const result = await call(leaderboard, { metric: "maxdailystreak" }, createTestContext(db));

				expect(result).toBeInstanceOf(Array);
				expect(result.length).toBeGreaterThan(0);

				// Verify leaderboardUser4 has max daily streak of 15 and is in the results
				const targetUser = result.find((entry) => entry.user.username === "leaderboardUser4");
				expect(targetUser).toBeDefined();
				expect(targetUser?.metricValue).toBe(15);

				// Ensure descending order
				for (let i = 0; i < result.length - 1; i++) {
					const currentValue = result[i]?.metricValue;
					const nextValue = result[i + 1]?.metricValue;
					expect(typeof currentValue).toBe("number");
					expect(typeof nextValue).toBe("number");
					expect(currentValue).toBeGreaterThanOrEqual(
						orThrow(nextValue, `No next metric value for result[${i + 1}] in XP leaderboard`),
					);
				}
			});

			it("should return leaderboard sorted by work count", async () => {
				const result = await call(leaderboard, { metric: "workcount" }, createTestContext(db));

				expect(result).toBeInstanceOf(Array);
				expect(result.length).toBeGreaterThan(0);

				// Verify leaderboardUser5 has work count of 30 and is in the results
				const targetUser = result.find((entry) => entry.user.username === "leaderboardUser5");
				expect(targetUser).toBeDefined();
				expect(targetUser?.metricValue).toBe(30);

				// Ensure descending order
				for (let i = 0; i < result.length - 1; i++) {
					const currentValue = result[i]?.metricValue;
					const nextValue = result[i + 1]?.metricValue;
					expect(typeof currentValue).toBe("number");
					expect(typeof nextValue).toBe("number");
					expect(currentValue).toBeGreaterThanOrEqual(
						orThrow(nextValue, `No next metric value for result[${i + 1}] in XP leaderboard`),
					);
				}
			});
		});

		describe("Limit variations", () => {
			it("should respect limit of 1", async () => {
				const result = await call(leaderboard, { limit: 1 }, createTestContext(db));

				expect(result).toBeInstanceOf(Array);
				expect(result.length).toBe(1);
				expect(result[0]?.rank).toBe(1);

				// Should be the top user by coins (highest value in database)
				expect(result[0]?.metricValue).toBeGreaterThan(0);
			});

			it("should respect limit of 100", async () => {
				const result = await call(leaderboard, { limit: 100 }, createTestContext(db));

				expect(result).toBeInstanceOf(Array);
				expect(result.length).toBeGreaterThan(0);
				expect(result.length).toBeLessThanOrEqual(100);

				// Since we have limited test users, should return all available users
				// But verify it doesn't error with large limit
				for (let i = 0; i < result.length; i++) {
					expect(result[i]?.rank).toBe(i + 1);
				}
			});

			it("should use default limit of 10 when not specified", async () => {
				const result = await call(leaderboard, { metric: "coins" }, createTestContext(db));

				expect(result).toBeInstanceOf(Array);
				expect(result.length).toBeLessThanOrEqual(10);
			});

			it("should handle limit larger than available users", async () => {
				const result = await call(leaderboard, { limit: 50 }, createTestContext(db));

				expect(result).toBeInstanceOf(Array);
				expect(result.length).toBeGreaterThan(0);

				// Should return all available users without error
				for (let i = 0; i < result.length; i++) {
					expect(result[i]?.rank).toBe(i + 1);
				}
			});
		});

		describe("Ranking and ordering", () => {
			it("should assign correct sequential ranks starting from 1", async () => {
				const result = await call(leaderboard, { metric: "coins", limit: 5 }, createTestContext(db));

				expect(result).toBeInstanceOf(Array);
				expect(result.length).toBeGreaterThan(0);

				for (let i = 0; i < result.length; i++) {
					expect(result[i]?.rank).toBe(i + 1);
				}
			});

			it("should handle ties in metric values correctly", async () => {
				// Create users with same coin values to test tie handling
				const tieUser1 = await call(createUser, { username: "tieUser1" }, createTestContext(db));
				const tieUser2 = await call(createUser, { username: "tieUser2" }, createTestContext(db));

				// Set same coin values
				await db.update(userStatsTable).set({ coinsCount: 2000 }).where(eq(userStatsTable.userId, tieUser1.id));

				await db.update(userStatsTable).set({ coinsCount: 2000 }).where(eq(userStatsTable.userId, tieUser2.id));

				const result = await call(leaderboard, { metric: "coins" }, createTestContext(db));

				// Find the tied users
				const tiedUsers = result.filter((entry) => entry.metricValue === 2000);
				expect(tiedUsers.length).toBe(2);

				// Both should have consecutive ranks (database ordering determines which comes first)
				const ranks = tiedUsers.map((user) => user.rank).sort() as [number, number];
				expect(ranks[1] - ranks[0]).toBe(1);
			});

			it("should maintain stable ordering with database sort", async () => {
				// Run the same query multiple times to ensure consistent ordering
				const result1 = await call(leaderboard, { metric: "coins", limit: 5 }, createTestContext(db));

				const result2 = await call(leaderboard, { metric: "coins", limit: 5 }, createTestContext(db));

				expect(result1.length).toBe(result2.length);

				for (let i = 0; i < result1.length; i++) {
					expect(result1[i]?.user.id).toBe(orThrow(result2[i]?.user.id, `No user id for result2[${i}]`));
					expect(result1[i]?.metricValue).toBe(orThrow(result2[i]?.metricValue, `No metric value for result2[${i}]`));
					expect(result1[i]?.rank).toBe(orThrow(result2[i]?.rank, `No rank for result2[${i}]`));
				}
			});
		});

		describe("Level calculation integration", () => {
			it("should correctly calculate level from XP using calculateLevel function", async () => {
				const result = await call(leaderboard, { metric: "level" }, createTestContext(db));

				expect(result).toBeInstanceOf(Array);
				expect(result.length).toBeGreaterThan(0);

				for (const entry of result) {
					// Get the user's actual XP from database
					const userStats = await db
						.select()
						.from(userStatsTable)
						.where(eq(userStatsTable.userId, entry.user.id))
						.limit(1);

					if (userStats[0]) {
						const expectedLevel = calculateLevel(userStats[0].xpCount);
						expect(entry.metricValue).toBe(expectedLevel);
					}
				}
			});

			it("should show different levels for different XP amounts", async () => {
				// Just verify that the level calculation works by checking that levels are calculated from XP
				const result = await call(leaderboard, { metric: "level", limit: 10 }, createTestContext(db));

				expect(result).toBeInstanceOf(Array);
				expect(result.length).toBeGreaterThan(0);

				// Verify that each result has a valid level and it matches the calculateLevel function
				for (const entry of result) {
					// Get the user's actual XP from database
					const userStats = await db
						.select()
						.from(userStatsTable)
						.where(eq(userStatsTable.userId, entry.user.id))
						.limit(1);

					if (userStats[0]) {
						const expectedLevel = calculateLevel(userStats[0].xpCount);
						expect(entry.metricValue).toBe(expectedLevel);
						expect(entry.metricValue).toBeGreaterThan(0); // Levels should be at least 1
					}
				}
			});
		});

		describe("Edge cases", () => {
			it("should handle empty database gracefully", async () => {
				// Create a separate database for this test to ensure clean state
				const emptyDb = await createTestDatabase();

				const result = await call(leaderboard, {}, createTestContext(emptyDb));

				expect(result).toBeInstanceOf(Array);
				expect(result.length).toBe(0);
			});

			it("should handle users with zero stats", async () => {
				const result = await call(leaderboard, { metric: "coins" }, createTestContext(db));

				// Just verify that the leaderboard works even with users that might have zero stats
				expect(result).toBeInstanceOf(Array);

				// Check if there are any users with zero coins
				const zeroUsers = result.filter((entry) => entry.metricValue === 0);
				if (zeroUsers.length > 0) {
					// If there are users with zero coins, verify they have valid ranks
					for (const zeroUser of zeroUsers) {
						expect(zeroUser.rank).toBeGreaterThan(0);
						expect(zeroUser.metricValue).toBe(0);
					}
				}
			});

			it("should only include users with stats (inner join behavior)", async () => {
				const result = await call(leaderboard, {}, createTestContext(db));

				// All returned users should have associated stats
				for (const entry of result) {
					expect(entry.user.id).toBeGreaterThan(0);
					expect(entry.metricValue).toBeGreaterThanOrEqual(0);
					expect(entry.rank).toBeGreaterThan(0);
				}
			});

			it("should handle negative metric values gracefully", async () => {
				const result = await call(leaderboard, { metric: "coins" }, createTestContext(db));

				// Just verify that leaderboard handles all values correctly
				expect(result).toBeInstanceOf(Array);

				// Check if there are any users with negative coins
				const negativeUsers = result.filter((entry) => entry.metricValue < 0);
				if (negativeUsers.length > 0) {
					// If there are users with negative coins, verify they're ranked appropriately
					for (const negativeUser of negativeUsers) {
						expect(negativeUser.rank).toBeGreaterThan(0);
						expect(negativeUser.metricValue).toBeLessThan(0);
					}
				}
			});
		});

		describe("Input validation", () => {
			it("should use default metric when invalid metric provided", async () => {
				// This test verifies that zod validation catches invalid metrics
				// The function should not accept invalid metrics due to zod enum validation
				expect(async () => {
					await call(leaderboard, { metric: "invalid_metric" as unknown as "coins" }, createTestContext(db));
				}).toThrow();
			});

			it("should use default limit when invalid limit provided", async () => {
				// Test limits outside valid range (1-100)
				expect(async () => {
					await call(leaderboard, { limit: 0 }, createTestContext(db));
				}).toThrow();

				expect(async () => {
					await call(leaderboard, { limit: 101 }, createTestContext(db));
				}).toThrow();

				expect(async () => {
					await call(leaderboard, { limit: -5 }, createTestContext(db));
				}).toThrow();
			});

			it("should handle non-integer limit values", async () => {
				expect(async () => {
					await call(leaderboard, { limit: 5.5 }, createTestContext(db));
				}).toThrow();
			});
		});

		describe("Performance and consistency", () => {
			it("should return consistent results for the same query", async () => {
				const result1 = await call(leaderboard, { metric: "xp", limit: 5 }, createTestContext(db));

				const result2 = await call(leaderboard, { metric: "xp", limit: 5 }, createTestContext(db));

				expect(result1).toEqual(result2);
			});

			it("should handle large limit efficiently", async () => {
				const startTime = Date.now();

				const result = await call(leaderboard, { limit: 100 }, createTestContext(db));

				const endTime = Date.now();
				const executionTime = endTime - startTime;

				expect(result).toBeInstanceOf(Array);
				expect(executionTime).toBeLessThan(1000); // Should complete within 1 second
			});
		});

		describe("User data integrity", () => {
			it("should return correct user information", async () => {
				const result = await call(leaderboard, { limit: 5 }, createTestContext(db));

				expect(result).toBeInstanceOf(Array);

				// Only check if there are results
				if (result.length > 0) {
					for (const entry of result) {
						// Verify required user fields exist
						expect(entry.user).toHaveProperty("id");
						expect(entry.user).toHaveProperty("username");
						expect(entry.user).toHaveProperty("discordId");
						expect(entry.user).toHaveProperty("guildedId");

						// Verify username is not empty
						expect(entry.user.username).toBeTruthy();
					}
				}
			});

			it("should not expose sensitive user information", async () => {
				const result = await call(leaderboard, {}, createTestContext(db));

				for (const entry of result) {
					// Should not include password, email, or other sensitive fields
					expect(entry.user).not.toHaveProperty("password");
					expect(entry.user).not.toHaveProperty("email");
					expect(entry.user).not.toHaveProperty("role");
					expect(entry.user).not.toHaveProperty("createdAt");
					expect(entry.user).not.toHaveProperty("updatedAt");
				}
			});
		});
	});
});
