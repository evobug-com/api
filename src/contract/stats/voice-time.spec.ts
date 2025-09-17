import { beforeEach, describe, expect, it } from "bun:test";
import { ORPCError } from "@orpc/client";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { relations } from "../../db/relations.ts";
import type * as schema from "../../db/schema.ts";
import { type DbUser, userStatsTable } from "../../db/schema.ts";
import { createTestContext, createTestDatabase } from "../shared/test-utils.ts";
import { createUser } from "../users";
import { checkVoiceTimeMilestone } from "./index.ts";

describe("Voice Time Milestone", () => {
	let db: BunSQLDatabase<typeof schema, typeof relations>;
	let testUser: DbUser;

	beforeEach(async () => {
		db = await createTestDatabase();
		testUser = (await call(
			createUser,
			{
				username: "voiceTestUser",
			},
			createTestContext(db),
		)) as DbUser;
	});

	describe("checkVoiceTimeMilestone", () => {
		it("should track voice time without rewards", async () => {
			const result = await call(
				checkVoiceTimeMilestone,
				{
					userId: testUser.id,
					minutesInVoice: 30, // 30 minutes
				},
				createTestContext(db, testUser),
			);

			expect(result).toBeDefined();
			expect(result.rewardEarned).toBe(false);
			expect(result.milestoneReached).toBeUndefined();
			expect(result.totalVoiceHours).toBe(0); // Less than 1 hour
			expect(result.updatedStats.voiceTimeMinutes).toBe(30);
			expect(result.message).toBe("Voice time: 0 hours");
		});

		it("should grant rewards at 1 hour milestone", async () => {
			const result = await call(
				checkVoiceTimeMilestone,
				{
					userId: testUser.id,
					minutesInVoice: 60, // 1 hour exactly
				},
				createTestContext(db, testUser),
			);

			expect(result).toBeDefined();
			expect(result.rewardEarned).toBe(true);
			expect(result.milestoneReached).toBe(1);
			expect(result.totalVoiceHours).toBe(1);
			expect(result.updatedStats.voiceTimeMinutes).toBe(60);
			expect(result.message).toContain("Voice time milestone reached: 1 hours!");
			expect(result.message).toContain("Earned 1000 coins and 500 XP!");

			// Check rewards (base reward is 1000 coins and 500 XP)
			expect(result.claimStats.earnedTotalCoins).toBe(1000);
			expect(result.claimStats.earnedTotalXp).toBe(500);

			// Level up from 1 to 3 (500 XP) gives 200 bonus coins
			expect(result.levelUp).toBeDefined();
			expect(result.levelUp?.oldLevel).toBe(1);
			expect(result.levelUp?.newLevel).toBe(3);
			expect(result.levelUp?.bonusCoins).toBe(200);

			// Total coins = 1000 (milestone) + 200 (level up bonus)
			expect(result.updatedStats.coinsCount).toBe(1200);
			expect(result.updatedStats.xpCount).toBe(500);
		});

		it("should grant higher rewards at 10 hour milestone", async () => {
			// First, set user to have 9 hours 50 minutes
			await db
				.update(userStatsTable)
				.set({
					voiceTimeMinutes: 590, // 9 hours 50 minutes
				})
				.where(eq(userStatsTable.userId, testUser.id));

			const result = await call(
				checkVoiceTimeMilestone,
				{
					userId: testUser.id,
					minutesInVoice: 10, // Add 10 more minutes to reach 10 hours
				},
				createTestContext(db, testUser),
			);

			expect(result).toBeDefined();
			expect(result.rewardEarned).toBe(true);
			expect(result.milestoneReached).toBe(10);
			expect(result.totalVoiceHours).toBe(10);
			expect(result.updatedStats.voiceTimeMinutes).toBe(600); // 10 hours

			// Check rewards (10h milestone has 10x multiplier)
			expect(result.claimStats.earnedTotalCoins).toBe(10000); // 1000 * 10
			expect(result.claimStats.earnedTotalXp).toBe(5000); // 500 * 10
		});

		it("should grant massive rewards at 100 hour milestone", async () => {
			// Set user to have 99 hours 50 minutes
			await db
				.update(userStatsTable)
				.set({
					voiceTimeMinutes: 5990, // 99 hours 50 minutes
				})
				.where(eq(userStatsTable.userId, testUser.id));

			const result = await call(
				checkVoiceTimeMilestone,
				{
					userId: testUser.id,
					minutesInVoice: 10, // Add 10 more minutes to reach 100 hours
				},
				createTestContext(db, testUser),
			);

			expect(result).toBeDefined();
			expect(result.rewardEarned).toBe(true);
			expect(result.milestoneReached).toBe(100);
			expect(result.totalVoiceHours).toBe(100);

			// Check rewards (100h milestone has 100x multiplier)
			expect(result.claimStats.earnedTotalCoins).toBe(100000); // 1000 * 100
			expect(result.claimStats.earnedTotalXp).toBe(50000); // 500 * 100
		});

		it("should not grant rewards if milestone already passed", async () => {
			// Set user to already have 2 hours
			await db
				.update(userStatsTable)
				.set({
					voiceTimeMinutes: 120, // 2 hours
				})
				.where(eq(userStatsTable.userId, testUser.id));

			const result = await call(
				checkVoiceTimeMilestone,
				{
					userId: testUser.id,
					minutesInVoice: 30, // Add 30 more minutes
				},
				createTestContext(db, testUser),
			);

			expect(result).toBeDefined();
			expect(result.rewardEarned).toBe(false);
			expect(result.milestoneReached).toBeUndefined();
			expect(result.totalVoiceHours).toBe(2);
			expect(result.updatedStats.voiceTimeMinutes).toBe(150);
		});

		it("should handle multiple milestones correctly", async () => {
			// First milestone: 1 hour
			const result1 = await call(
				checkVoiceTimeMilestone,
				{
					userId: testUser.id,
					minutesInVoice: 60,
				},
				createTestContext(db, testUser),
			);
			expect(result1.milestoneReached).toBe(1);
			// 1000 (milestone) + 200 (level up from 1 to 3 with 500 XP)
			expect(result1.updatedStats.coinsCount).toBe(1200);

			// Add more time but not enough for next milestone
			const result2 = await call(
				checkVoiceTimeMilestone,
				{
					userId: testUser.id,
					minutesInVoice: 120, // 2 more hours (total 3)
				},
				createTestContext(db, testUser),
			);
			expect(result2.rewardEarned).toBe(false);
			expect(result2.totalVoiceHours).toBe(3);

			// Reach 10 hour milestone
			const result3 = await call(
				checkVoiceTimeMilestone,
				{
					userId: testUser.id,
					minutesInVoice: 420, // 7 more hours (total 10)
				},
				createTestContext(db, testUser),
			);
			expect(result3.milestoneReached).toBe(10);
			expect(result3.totalVoiceHours).toBe(10);
			// Previous: 1200 (1000 + 200 level bonus from first milestone)
			// New: 10000 (10h milestone) + level up bonus
			// XP goes from 500 to 5500 (500 + 5000), level 3 to level 7
			// Level up bonus: 400 coins (4 levels * 100)
			expect(result3.updatedStats.coinsCount).toBe(11600); // 1200 + 10000 + 400
		});

		it("should update lastVoiceCheck timestamp", async () => {
			const beforeTime = new Date();

			const result = await call(
				checkVoiceTimeMilestone,
				{
					userId: testUser.id,
					minutesInVoice: 10,
				},
				createTestContext(db, testUser),
			);

			expect(result.updatedStats.lastVoiceCheck).toBeDefined();

			const checkTime = result.updatedStats.lastVoiceCheck;
			if (checkTime) {
				expect(checkTime.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
			}
		});

		it("should handle level up from voice time rewards", async () => {
			// Give user enough XP to be close to level up
			// Level 4 is at 901 XP, Level 5 is at 1701 XP
			await db
				.update(userStatsTable)
				.set({
					xpCount: 1300, // Level 4, close to level 5 (1701 XP)
				})
				.where(eq(userStatsTable.userId, testUser.id));

			const result = await call(
				checkVoiceTimeMilestone,
				{
					userId: testUser.id,
					minutesInVoice: 60, // 1 hour milestone gives 500 XP now
				},
				createTestContext(db, testUser),
			);

			expect(result).toBeDefined();
			expect(result.levelUp).toBeDefined();

			// 1300 existing + 500 from milestone = 1800 XP total
			// This should level up from 4 to 5
			expect(result.levelUp?.oldLevel).toBe(4);
			expect(result.levelUp?.newLevel).toBe(5);
			expect(result.levelUp?.bonusCoins).toBe(100); // 1 level = 100 coins

			expect(result.updatedStats.xpCount).toBe(1800);
			expect(result.updatedStats.coinsCount).toBe(1100); // 1000 (milestone) + 100 (level up)
		});

		it("should return error for non-existent user", async () => {
			await expect(
				call(
					checkVoiceTimeMilestone,
					{
						userId: 999999,
						minutesInVoice: 60,
					},
					createTestContext(db),
				),
			).rejects.toThrow(ORPCError);
		});

		it("should handle all milestone tiers correctly", async () => {
			const milestones = [
				{ hours: 1, minutes: 60, coins: 1000, xp: 500 },
				{ hours: 10, minutes: 600, coins: 10000, xp: 5000 },
				{ hours: 100, minutes: 6000, coins: 100000, xp: 50000 },
				{ hours: 1000, minutes: 60000, coins: 1000000, xp: 500000 },
				{ hours: 10000, minutes: 600000, coins: 10000000, xp: 5000000 },
			];

			for (const milestone of milestones) {
				// Create a new user for each test
				const newUser = (await call(
					createUser,
					{
						username: `voiceUser${milestone.hours}`,
					},
					createTestContext(db),
				)) as DbUser;

				// Set time just before milestone
				await db
					.update(userStatsTable)
					.set({
						voiceTimeMinutes: milestone.minutes - 10,
					})
					.where(eq(userStatsTable.userId, newUser.id));

				// Add remaining time to hit milestone
				const result = await call(
					checkVoiceTimeMilestone,
					{
						userId: newUser.id,
						minutesInVoice: 10,
					},
					createTestContext(db, newUser),
				);

				expect(result.milestoneReached).toBe(milestone.hours);
				expect(result.claimStats.earnedTotalCoins).toBe(milestone.coins);
				expect(result.claimStats.earnedTotalXp).toBe(milestone.xp);
			}
		});
	});
});
