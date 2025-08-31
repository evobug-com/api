import { ORPCError } from "@orpc/client";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import {
	type InsertDbUserStatsLog,
	userSchema,
	userStatsLogSchema,
	userStatsLogTable,
	userStatsSchema,
	userStatsTable,
	usersTable,
} from "../../db/schema.ts";
import { buildOrConditions } from "../../utils/db-utils.ts";
import { calculateLevel, calculateRewards, getLevelProgress } from "../../utils/stats-utils.ts";
import { base } from "../shared/os.ts";

export const levelProgressSchema = z.object({
	xpProgress: z.number(),
	progressPercentage: z.number(),
	xpForCurrentLevel: z.number(),
	xpForNextLevel: z.number(),
	currentXp: z.number(),
	xpNeeded: z.number(),
	currentLevel: z.number(),
});

/**
 * User stats retrieval contract
 */
export const userStats = base
	.input(
		userSchema
			.pick({
				id: true,
				discordId: true,
				guildedId: true,
				username: true,
				email: true,
			})
			.partial(),
	)
	.output(
		z.object({
			stats: userStatsSchema,
			levelProgress: levelProgressSchema,
		}),
	)
	.handler(async ({ input, context }) => {
		const user = await context.db.query.usersTable.findFirst({
			where: buildOrConditions(usersTable, input),
			with: { stats: true },
			columns: {},
		});

		if (!user) throw new ORPCError("NOT_FOUND", { message: "User not found" });
		const stats = user.stats;

		if (!stats) {
			throw new ORPCError("NOT_FOUND", { message: "User stats not found" });
		}

		const levelProgress = getLevelProgress(stats.xpCount);

		return {
			stats,
			levelProgress,
		};
	});

/**
 * Top users leaderboard contract
 * GET /users/leaderboard - Retrieves top users by specified metric
 * Supports various metrics and configurable limit
 */
export const leaderboard = base
	.input(
		z.object({
			metric: z.enum(["coins", "xp", "level", "dailystreak", "maxdailystreak", "workcount"]).default("coins"),
			limit: z.number().int().min(1).max(100).default(10),
		}),
	)
	.output(
		z.array(
			z.object({
				user: userSchema.pick({ id: true, discordId: true, guildedId: true, username: true }),
				metricValue: z.number(),
				rank: z.number(),
			}),
		),
	)
	.handler(async ({ input, context }) => {
		const { metric, limit } = input;

		// Map metric to the actual column name
		const metricColumn = {
			coins: userStatsTable.coinsCount,
			xp: userStatsTable.xpCount,
			level: userStatsTable.xpCount, // We'll calculate level from XP
			dailystreak: userStatsTable.dailyStreak,
			maxdailystreak: userStatsTable.maxDailyStreak,
			workcount: userStatsTable.workCount,
		}[metric];

		// Query the top users with their stats
		const topUsers = await context.db
			.select({
				userId: userStatsTable.userId,
				metricValue: metricColumn,
				user: {
					id: usersTable.id,
					discordId: usersTable.discordId,
					guildedId: usersTable.guildedId,
					username: usersTable.username,
				},
			})
			.from(userStatsTable)
			.innerJoin(usersTable, eq(userStatsTable.userId, usersTable.id))
			.orderBy(desc(metricColumn))
			.limit(limit);

		// Transform the results and calculate level if needed
		return topUsers.map((row, index) => {
			let metricValue = row.metricValue;

			// Calculate level from XP if metric is "level"
			if (metric === "level") {
				metricValue = calculateLevel(row.metricValue);
			}

			return {
				user: row.user,
				metricValue,
				rank: index + 1,
			};
		});
	});

// /**
//  * User stats activities retrieval contract
//  */
// export const userStatsActivities = base
// 	.input(
// 		z.object({
// 			userId: z.number(),
// 			activityType: z.string().optional(),
// 			limit: z.number().int().min(1).max(100).default(20),
// 		}),
// 	)
// 	.output(z.array(userStatsLogSchema))
// 	.handler(async ({ input, context }) => {
// 		const conditions = [eq(userStatsLogTable.userId, input.userId)];
//
// 		if (input.activityType) {
// 			conditions.push(eq(userStatsLogTable.activityType, input.activityType));
// 		}
//
// 		const activities = await context.db
// 			.select()
// 			.from(userStatsLogTable)
// 			.where(and(...conditions))
// 			.orderBy(desc(userStatsLogTable.createdAt))
// 			.limit(input.limit);
//
// 		return activities;
// 	});

/**
 * Daily reward cooldown retrieval contract
 */
export const userDailyCooldown = base
	.input(
		userStatsSchema.pick({
			userId: true,
		}),
	)
	.output(
		z.object({
			isOnCooldown: z.boolean(),
			cooldownRemaining: z.number(), // in seconds
			cooldownEndTime: z.date(), // timestamp
		}),
	)
	.handler(async ({ input, context }) => {
		// Check if user has claimed daily reward today
		const today = new Date();
		today.setHours(0, 0, 0, 0);

		const dailyLogs = await context.db
			.select()
			.from(userStatsLogTable)
			.where(
				and(
					eq(userStatsLogTable.userId, input.userId),
					eq(userStatsLogTable.activityType, "daily"),
					gte(userStatsLogTable.createdAt, today),
				),
			)
			.limit(1);

		const now = new Date();
		const midnight = new Date(now);
		midnight.setDate(midnight.getDate() + 1);
		midnight.setHours(0, 0, 0, 0);

		const msUntilMidnight = midnight.getTime() - now.getTime();
		const secondsUntilMidnight = Math.floor(msUntilMidnight / 1000);

		return {
			isOnCooldown: dailyLogs.length > 0,
			cooldownRemaining: dailyLogs.length > 0 ? secondsUntilMidnight : 0,
			cooldownEndTime: midnight,
		};
	});

/**
 * Work cooldown retrieval
 * - Work is possible once per hour
 */
export const userWorkCooldown = base
	.input(
		userStatsSchema.pick({
			userId: true,
		}),
	)
	.output(
		z.object({
			isOnCooldown: z.boolean(),
			cooldownRemaining: z.int().min(0),
			cooldownEndTime: z.date().optional(),
			lastActivity: userStatsLogSchema.optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		// Get user's stats to check lastWorkAt
		const userStats = await context.db.query.userStatsTable.findFirst({
			where: eq(userStatsTable.userId, input.userId),
		});

		if (!userStats || !userStats.lastWorkAt) {
			return {
				isOnCooldown: false,
				cooldownRemaining: 0,
			};
		}

		const now = new Date();
		const cooldownEndTime = new Date(userStats.lastWorkAt.getTime() + 3600000); // 1 hour cooldown
		const isOnCooldown = now < cooldownEndTime;
		const cooldownRemaining = isOnCooldown
			? Math.floor((cooldownEndTime.getTime() - now.getTime()) / 1000)
			: 0;

		// Get last work activity from log if needed
		const lastWorkActivity = await context.db.query.userStatsLogTable.findFirst({
			where: and(eq(userStatsLogTable.userId, input.userId), eq(userStatsLogTable.activityType, "work")),
			orderBy: desc(userStatsLogTable.createdAt),
		});

		return {
			isOnCooldown,
			cooldownRemaining,
			cooldownEndTime: isOnCooldown ? cooldownEndTime : undefined,
			lastActivity: lastWorkActivity ?? undefined,
		};
	});

/**
 * Daily reward claim
 * - Check if a user is on cooldown
 * - Every player can claim a daily reward once per day
 * - Each claim increases the user's daily streak by 1
 * - Daily streak is reset when they miss a daily reward
 * - Every 5th streak day is a milestone with increased rewards
 * - Reward is calculated based on calculateRewards function in stats-utils.ts
 * - Each claim is logged in the stats_logs table
 * - It must return the updated stats, the difference in coins and xp, and the level up status
 */
export const claimDaily = base
	.input(
		userStatsSchema.pick({
			userId: true,
			boostCount: true,
		}),
	)
	.output(
		z.object({
			updatedStats: userStatsSchema,
			levelUp: z
				.object({
					newLevel: z.number(),
					oldLevel: z.number(),
					bonusCoins: z.number(),
				})
				.optional(),
			claimStats: z.object({
				baseCoins: z.number(),
				baseXp: z.number(),
				currentLevel: z.number(),
				levelCoinsBonus: z.number(),
				levelXpBonus: z.number(),
				streakCoinsBonus: z.number(),
				streakXpBonus: z.number(),
				milestoneCoinsBonus: z.number(),
				milestoneXpBonus: z.number(),
				boostMultiplier: z.number(),
				boostCoinsBonus: z.number(),
				boostXpBonus: z.number(),
				isMilestone: z.boolean(),
				earnedTotalCoins: z.number(),
				earnedTotalXp: z.number(),
			}),
			levelProgress: levelProgressSchema,
		}),
	)
	.handler(async ({ input, context }) => {
		// Check if user exists
		const user = await context.db.query.usersTable.findFirst({
			with: {
				stats: true,
			},
			where: eq(usersTable.id, input.userId),
		});

		if (!user) {
			throw new ORPCError("NOT_FOUND", { message: "User not found" });
		}

		if (!user.stats) {
			throw new ORPCError("NOT_FOUND", { message: "User stats not found" });
		}

		// Check if already claimed today
		const today = new Date();
		today.setHours(0, 0, 0, 0);

		const dailyLogs = await context.db.query.userStatsLogTable.findFirst({
			where: and(
				eq(userStatsLogTable.userId, input.userId),
				eq(userStatsLogTable.activityType, "daily"),
				gte(userStatsLogTable.createdAt, today),
			),
		});

		if (dailyLogs) {
			throw new ORPCError("NOT_ACCEPTABLE", {
				message: "Daily reward already claimed today",
			});
		}

		// Check if streak should be reset (missed a day)
		const yesterday = new Date();
		yesterday.setDate(yesterday.getDate() - 1);
		yesterday.setHours(0, 0, 0, 0);

		const yesterdayEnd = new Date(yesterday);
		yesterdayEnd.setHours(23, 59, 59, 999);

		const yesterdayLogs = await context.db.query.userStatsLogTable.findFirst({
			where: and(
				eq(userStatsLogTable.userId, input.userId),
				eq(userStatsLogTable.activityType, "daily"),
				gte(userStatsLogTable.createdAt, yesterday),
				lte(userStatsLogTable.createdAt, yesterdayEnd),
			),
		});

		// Update streak
		const newStreak = yesterdayLogs ? user.stats.dailyStreak + 1 : 1;
		const maxStreak = Math.max(user.stats.maxDailyStreak, newStreak);

		// Calculate rewards with boost multiplier
		const currentLevel = calculateLevel(user.stats.xpCount);
		const rewards = calculateRewards("daily", currentLevel, newStreak, input.boostCount);

		// Calculate new totals
		const newCoins = user.stats.coinsCount + rewards.earnedTotalCoins;
		const newXp = user.stats.xpCount + rewards.earnedTotalXp;
		const newLevel = calculateLevel(newXp);

		// Check for level up
		let levelUp: { oldLevel: number; newLevel: number; bonusCoins: number } | undefined;
		if (newLevel > currentLevel) {
			const levelUpBonus = (newLevel - currentLevel) * 100;
			levelUp = {
				oldLevel: currentLevel,
				newLevel: newLevel,
				bonusCoins: levelUpBonus,
			};
		}

		return await context.db.transaction(async (db) => {
			// Update user stats including boost count
			const [updatedStats] = await db
				.update(userStatsTable)
				.set({
					dailyStreak: newStreak,
					maxDailyStreak: maxStreak,
					coinsCount: newCoins + (levelUp?.bonusCoins ?? 0),
					xpCount: newXp,
					boostCount: input.boostCount,
					updatedAt: new Date(),
				})
				.where(eq(userStatsTable.userId, input.userId))
				.returning();

			if (!updatedStats) {
				throw new ORPCError("DATABASE_ERROR", {
					message: "Failed to update user stats",
				});
			}

			// Log the activity
			const tomorrow = new Date();
			tomorrow.setDate(tomorrow.getDate() + 1);
			tomorrow.setHours(0, 0, 0, 0);

			const logData: InsertDbUserStatsLog = {
				userId: input.userId,
				activityType: "daily",
				notes: `Daily reward claimed. Streak: ${newStreak}${rewards.isMilestone ? " (MILESTONE!)" : ""}`,
				xpEarned: rewards.earnedTotalXp,
				coinsEarned: rewards.earnedTotalCoins + (levelUp?.bonusCoins ?? 0),
			};

			await db.insert(userStatsLogTable).values(logData);

			// Get level progress
			const levelProgress = getLevelProgress(newXp);

			return {
				updatedStats,
				levelUp,
				claimStats: rewards,
				levelProgress: levelProgress,
			};
		});
	});

/**
 * Work activity creation contract
 * POST /users/{userId}/stats/work-activities - Creates a new work activity
 */
export const claimWork = base
	.input(
		userStatsSchema.pick({
			userId: true,
			boostCount: true,
		}),
	)
	.output(
		z.object({
			statsLog: userStatsLogSchema,
			updatedStats: userStatsSchema,
			message: z.string(),
			levelUp: z
				.object({
					newLevel: z.number(),
					oldLevel: z.number(),
					bonusCoins: z.number(),
				})
				.optional(),
			claimStats: z.object({
				baseCoins: z.number(),
				baseXp: z.number(),
				currentLevel: z.number(),
				levelCoinsBonus: z.number(),
				levelXpBonus: z.number(),
				streakCoinsBonus: z.number(),
				streakXpBonus: z.number(),
				milestoneCoinsBonus: z.number(),
				milestoneXpBonus: z.number(),
				boostMultiplier: z.number(),
				boostCoinsBonus: z.number(),
				boostXpBonus: z.number(),
				isMilestone: z.boolean(),
				earnedTotalCoins: z.number(),
				earnedTotalXp: z.number(),
			}),
			levelProgress: levelProgressSchema,
		}),
	)
	.handler(async ({ input, context }) => {
		// Get user stats to check cooldown
		const userStats = await context.db.query.userStatsTable.findFirst({
			where: eq(userStatsTable.userId, input.userId),
		});

		if (!userStats) {
			throw new ORPCError("NOT_FOUND", { message: "User stats not found" });
		}

		// Check work cooldown (1 hour)
		if (userStats.lastWorkAt) {
			const now = new Date();
			const cooldownEnd = new Date(userStats.lastWorkAt.getTime() + 3600000); // 1 hour cooldown

			if (now < cooldownEnd) {
				const cooldownRemaining = Math.floor((cooldownEnd.getTime() - now.getTime()) / 1000);
				throw new ORPCError("CONFLICT", {
					message: `You're still on cooldown. Please wait ${cooldownRemaining} seconds.`,
				});
			}
		}

		// Calculate rewards for work with boost multiplier
		const currentLevel = calculateLevel(userStats.xpCount);
		const rewards = calculateRewards("work", currentLevel, 0, input.boostCount);

		// Calculate new totals
		const newCoins = userStats.coinsCount + rewards.earnedTotalCoins;
		const newXp = userStats.xpCount + rewards.earnedTotalXp;
		const newWorkCount = userStats.workCount + 1;
		const newLevel = calculateLevel(newXp);

		// Check for level up
		let levelUp: { oldLevel: number; newLevel: number; bonusCoins: number } | undefined;
		if (newLevel > currentLevel) {
			const levelUpBonus = (newLevel - currentLevel) * 100;
			levelUp = {
				oldLevel: currentLevel,
				newLevel: newLevel,
				bonusCoins: levelUpBonus,
			};
		}

		return await context.db.transaction(async (db) => {
			const [updatedStats] = await db
				.update(userStatsTable)
				.set({
					coinsCount: newCoins + (levelUp?.bonusCoins ?? 0),
					xpCount: newXp,
					workCount: newWorkCount,
					lastWorkAt: new Date(),
					boostCount: input.boostCount,
					updatedAt: new Date(),
				})
				.where(eq(userStatsTable.userId, input.userId))
				.returning();

			if (!updatedStats) {
				throw new ORPCError("DATABASE_ERROR", {
					message: "Failed to update user stats",
				});
			}

			// Log the work activity
			const logData: InsertDbUserStatsLog = {
				userId: input.userId,
				activityType: "work",
				notes: `Work activity completed. Total work count: ${newWorkCount}${levelUp ? ` (LEVEL UP to ${levelUp.newLevel}!)` : ""}`,
				xpEarned: rewards.earnedTotalXp,
				coinsEarned: rewards.earnedTotalCoins + (levelUp?.bonusCoins ?? 0),
			};

			const [statsLog] = await db.insert(userStatsLogTable).values(logData).returning();

			if (!statsLog) {
				throw new ORPCError("DATABASE_ERROR", {
					message: "Failed to log work activity",
				});
			}

			// Get level progress
			const levelProgress = getLevelProgress(newXp);

			return {
				statsLog,
				updatedStats,
				message: `Work completed! You earned ${rewards.earnedTotalCoins} coins and ${rewards.earnedTotalXp} XP.${levelUp ? ` You leveled up to level ${levelUp.newLevel} and earned ${levelUp.bonusCoins} bonus coins!` : ""}`,
				levelUp,
				claimStats: rewards,
				levelProgress: levelProgress,
			};
		});
	});
//
// /**
//  * Update user stats contract
//  * PATCH /users/{userId}/stats - Updates user's statistics (admin only)
//  */
// export const updateUserStats = base
// 	.input(
// 		z.object({
// 			userId: z.number(),
// 			dailyStreak: z.number().int().min(0).optional(),
// 			workCount: z.number().int().min(0).optional(),
// 			messagesCount: z.number().int().min(0).optional(),
// 			maxDailyStreak: z.number().int().min(0).optional(),
// 			coinsCount: z.number().int().min(0).optional(),
// 			xpCount: z.number().int().min(0).optional(),
// 		}),
// 	)
// 	.output(
// 		z.object({
// 			success: z.boolean(),
// 			stats: userStatsSchema,
// 			message: z.string(),
// 		}),
// 	)
// 	.handler(async ({ input, context }) => {
// 		// TODO: Add admin check
// 		// if (context.user?.role !== 'admin') {
// 		//     throw new ORPCError('FORBIDDEN', { message: 'Admin access required' });
// 		// }
//
// 		const { userId, ...updateData } = input;
//
// 		// Check if user stats exist
// 		const [existingStats] = await context.db
// 			.select()
// 			.from(userStatsTable)
// 			.where(eq(userStatsTable.userId, userId))
// 			.limit(1);
//
// 		if (!existingStats) {
// 			throw new ORPCError("NOT_FOUND", { message: "User stats not found" });
// 		}
//
// 		// Update stats
// 		const [updatedStats] = await context.db
// 			.update(userStatsTable)
// 			.set({
// 				...updateData,
// 				updatedAt: new Date()
// 			})
// 			.where(eq(userStatsTable.userId, userId))
// 			.returning();
//
// 		if (!updatedStats) {
// 			throw new ORPCError("DATABASE_ERROR", {
// 				message: "Failed to update user stats",
// 			});
// 		}
//
// 		return {
// 			success: true,
// 			stats: updatedStats,
// 			message: "User stats updated successfully",
// 		};
// 	});

// /**
//  * Daily reward recovery contract
//  * PUT /users/{userId}/stats/daily-recovery - Recovers missed daily reward (admin only)
//  */
// export const updateDailyRecovery = base
// 	.input(
// 		z.object({
// 			userId: z.number(),
// 			timestamp: z.string(),
// 		}),
// 	)
// 	.output(
// 		z.object({
// 			success: z.boolean(),
// 			message: z.string(),
// 			statsLog: userStatsLogSchema.optional(),
// 		}),
// 	)
// 	.handler(async ({ input, context }) => {
// 		// TODO: Add admin check
// 		// if (context.user?.role !== 'admin') {
// 		//     throw new ORPCError('FORBIDDEN', { message: 'Admin access required' });
// 		// }
//
// 		throw new ORPCError("NOT_IMPLEMENTED", {
// 			message: "Daily recovery not yet implemented",
// 		});
// 	});

// /**
//  * Work activity recovery contract
//  * PUT /users/{userId}/stats/work-recovery - Recovers missed work activity (admin only)
//  */
// export const updateWorkRecovery = base
// 	.input(
// 		z.object({
// 			userId: z.number(),
// 			timestamp: z.string(),
// 		}),
// 	)
// 	.output(
// 		z.object({
// 			success: z.boolean(),
// 			message: z.string(),
// 			statsLog: userStatsLogSchema.optional(),
// 		}),
// 	)
// 	.handler(async ({ input, context }) => {
// 		// TODO: Add admin check
// 		// if (context.user?.role !== 'admin') {
// 		//     throw new ORPCError('FORBIDDEN', { message: 'Admin access required' });
// 		// }
//
// 		throw new ORPCError("NOT_IMPLEMENTED", {
// 			message: "Work recovery not yet implemented",
// 		});
// 	});
