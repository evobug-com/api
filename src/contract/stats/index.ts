import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
	captchaLogsTable,
	type InsertDbCaptchaLog,
	type InsertDbUserStatsLog,
	userSchema,
	userStatsLogSchema,
	userStatsLogTable,
	userStatsSchema,
	userStatsTable,
	usersTable,
} from "../../db/schema.ts";
import {
	calculateLevel,
	calculateRewards,
	createDefaultClaimStats,
	createServerTagMilestoneStats,
	createVoiceTimeMilestoneStats,
	getLevelProgress,
	processLevelUp,
} from "../../utils/stats-utils.ts";
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
	.handler(async ({ input, context, errors }) => {
		// Find user with any of the provided identifiers
		// Note: v2 API doesn't support OR conditions directly in where object
		// We need to make multiple queries or handle this differently
		let user: { stats: typeof userStatsTable.$inferSelect | null } | null | undefined = null;
		if (input.id !== undefined) {
			user = await context.db.query.usersTable.findFirst({
				where: { id: input.id },
				with: { stats: true },
				columns: {},
			});
		} else if (input.discordId !== undefined && input.discordId !== null) {
			user = await context.db.query.usersTable.findFirst({
				where: { discordId: input.discordId as string },
				with: { stats: true },
				columns: {},
			});
		} else if (input.guildedId !== undefined && input.guildedId !== null) {
			user = await context.db.query.usersTable.findFirst({
				where: { guildedId: input.guildedId as string },
				with: { stats: true },
				columns: {},
			});
		}

		if (!user)
			throw errors.NOT_FOUND({
				message: "User not found for the given identifiers / userStats",
			});
		const stats = user?.stats;

		if (!stats) {
			throw errors.NOT_FOUND({
				message: "User stats not found for the given user / userStats",
			});
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

/**
 * Log captcha attempt with detailed reasoning
 */
export const logCaptchaAttempt = base
	.input(
		z.object({
			userId: z.number(),
			captchaType: z.enum(["math", "emoji", "word"]),
			command: z.enum(["work", "daily"]),
			success: z.boolean(),
			responseTime: z.number(), // in milliseconds
			clientIp: z.string().optional(),
			userAgent: z.string().optional(),
			// New fields for tracking why captcha was shown
			triggerReason: z.string().optional(), // Why captcha was shown (e.g., "suspicious_score", "periodic_check", "recent_failure")
			suspiciousScore: z.number().optional(), // User's suspicious score at time of captcha
			claimCount: z.number().optional(), // Number of claims before this captcha
			difficulty: z.enum(["easy", "medium", "hard"]).optional(),
		}),
	)
	.errors({
		DATABASE_ERROR: {
			message: "Database operation failed",
		},
	})
	.output(
		z.object({
			logged: z.boolean(),
			isSuspicious: z.boolean(),
			suspiciousReasons: z.array(z.string()),
		}),
	)
	.handler(async ({ input, context, errors }) => {
		const suspiciousReasons: string[] = [];

		// Check if response time is suspiciously fast
		const minTimes = {
			math: 2000,
			emoji: 1000,
			word: 3000,
		};
		const isTooFast = input.responseTime < minTimes[input.captchaType];
		if (isTooFast) {
			suspiciousReasons.push(`Response too fast (${input.responseTime}ms < ${minTimes[input.captchaType]}ms minimum)`);
		}

		// Check for other suspicious patterns
		if (input.responseTime < 500) {
			suspiciousReasons.push("Inhuman response time (<500ms)");
		}

		if (!input.success && input.responseTime < 1000) {
			suspiciousReasons.push("Failed captcha with very fast response");
		}

		if (input.suspiciousScore && input.suspiciousScore > 70) {
			suspiciousReasons.push(`High suspicious score (${input.suspiciousScore})`);
		}

		const isSuspicious = suspiciousReasons.length > 0;

		// Build detailed log message
		const logDetails = [
			`Captcha type: ${input.captchaType}`,
			`Command: ${input.command}`,
			`Success: ${input.success}`,
			`Response time: ${input.responseTime}ms`,
		];

		if (input.triggerReason) logDetails.push(`Trigger reason: ${input.triggerReason}`);
		if (input.suspiciousScore !== undefined) logDetails.push(`Suspicious score: ${input.suspiciousScore}`);
		if (input.claimCount !== undefined) logDetails.push(`Claim count: ${input.claimCount}`);
		if (input.difficulty) logDetails.push(`Difficulty: ${input.difficulty}`);
		if (suspiciousReasons.length > 0) {
			logDetails.push(`Suspicious patterns: ${suspiciousReasons.join(", ")}`);
		}

		// Log to console for monitoring
		console.log(`[CAPTCHA] User ${input.userId} - ${logDetails.join(" | ")}`);

		// Log the captcha attempt
		const logData: InsertDbCaptchaLog = {
			userId: input.userId,
			captchaType: input.captchaType,
			command: input.command,
			success: input.success,
			responseTime: input.responseTime,
			clientIp: input.clientIp,
			userAgent: input.userAgent,
		};

		try {
			await context.db.insert(captchaLogsTable).values(logData);

			// Reward successful captcha attempts with score reduction (unless response was inhuman)
			if (input.success && input.responseTime >= 500) {
				const userStats = await context.db.query.userStatsTable.findFirst({
					where: { userId: input.userId },
				});

				if (userStats && userStats.suspiciousBehaviorScore > 0) {
					// Reduce score by 10 for passing captcha correctly
					const newScore = Math.max(0, userStats.suspiciousBehaviorScore - 10);
					await context.db
						.update(userStatsTable)
						.set({
							suspiciousBehaviorScore: newScore,
							updatedAt: new Date(),
						})
						.where(eq(userStatsTable.userId, input.userId));

					console.log(`[CAPTCHA] User ${input.userId} suspicious score reduced from ${userStats.suspiciousBehaviorScore} to ${newScore} for passing captcha`);
				}
			}

			return {
				logged: true,
				isSuspicious,
				suspiciousReasons,
			};
		} catch (error) {
			console.error("Error logging captcha attempt:", error);
			throw errors.DATABASE_ERROR();
		}
	});

/**
 * Update failed captcha count
 */
export const updateFailedCaptchaCount = base
	.input(
		userStatsSchema.pick({
			userId: true,
		}),
	)
	.errors({
		DATABASE_ERROR: {
			message: "Database operation failed",
		},
	})
	.output(
		z.object({
			updated: z.boolean(),
			failedCount: z.number(),
			isLocked: z.boolean(),
		}),
	)
	.handler(async ({ input, context, errors }) => {
		const userStats = await context.db.query.userStatsTable.findFirst({
			where: { userId: input.userId },
		});

		if (!userStats) {
			throw errors.NOT_FOUND({
				message: "User stats not found",
			});
		}

		const newFailedCount = userStats.failedCaptchaCount + 1;
		const now = new Date();

		// Lock economy for 24 hours after 5 failed attempts
		const lockUntil = newFailedCount >= 5 ? new Date(now.getTime() + 24 * 60 * 60 * 1000) : null;

		const [updatedStats] = await context.db
			.update(userStatsTable)
			.set({
				failedCaptchaCount: newFailedCount,
				lastCaptchaFailedAt: now,
				economyBannedUntil: lockUntil || userStats.economyBannedUntil,
				suspiciousBehaviorScore: Math.min(100, userStats.suspiciousBehaviorScore + 10),
				updatedAt: now,
			})
			.where(eq(userStatsTable.userId, input.userId))
			.returning();

		if (!updatedStats) {
			throw errors.DATABASE_ERROR();
		}

		return {
			updated: true,
			failedCount: newFailedCount,
			isLocked: !!lockUntil,
		};
	});

/**
 * Update suspicious behavior score
 */
export const updateSuspiciousScore = base
	.input(
		z.object({
			userId: z.number(),
			increment: z.number(), // Can be negative to reduce score
		}),
	)
	.errors({
		DATABASE_ERROR: {
			message: "Database operation failed",
		},
	})
	.output(
		z.object({
			updated: z.boolean(),
			newScore: z.number(),
			isEconomyBanned: z.boolean(),
		}),
	)
	.handler(async ({ input, context, errors }) => {
		const userStats = await context.db.query.userStatsTable.findFirst({
			where: { userId: input.userId },
		});

		if (!userStats) {
			throw errors.NOT_FOUND({
				message: "User stats not found",
			});
		}

		const newScore = Math.max(0, Math.min(100, userStats.suspiciousBehaviorScore + input.increment));
		const now = new Date();

		// Auto-ban at score 100 for 72 hours
		const banUntil = newScore >= 100 ? new Date(now.getTime() + 72 * 60 * 60 * 1000) : userStats.economyBannedUntil;

		const [updatedStats] = await context.db
			.update(userStatsTable)
			.set({
				suspiciousBehaviorScore: newScore,
				lastSuspiciousActivityAt: input.increment > 0 ? now : userStats.lastSuspiciousActivityAt,
				economyBannedUntil: banUntil,
				updatedAt: now,
			})
			.where(eq(userStatsTable.userId, input.userId))
			.returning();

		if (!updatedStats) {
			throw errors.DATABASE_ERROR();
		}

		return {
			updated: true,
			newScore,
			isEconomyBanned: !!banUntil && banUntil > now,
		};
	});

/**
 * Check for automation patterns in user's activity
 */
export const checkAutomationPatterns = base
	.input(
		userStatsSchema.pick({
			userId: true,
		}),
	)
	.output(
		z.object({
			hasTimingPattern: z.boolean(),
			hasFailedCaptchaPattern: z.boolean(),
			instantResponseCount: z.number(),
			suspiciousScore: z.number(),
			recommendation: z.enum(["allow", "challenge", "ban"]),
		}),
	)
	.handler(async ({ input, context }) => {
		// Get recent captcha logs (last 24 hours)
		const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
		const recentLogs = await context.db.query.captchaLogsTable.findMany({
			where: {
				userId: input.userId,
				createdAt: { gte: oneDayAgo },
			},
			orderBy: { createdAt: "desc" },
		});

		// Check for timing patterns (commands at exact intervals)
		let hasTimingPattern = false;
		if (recentLogs.length >= 3) {
			const intervals: number[] = [];
			for (let i = 1; i < recentLogs.length; i++) {
				const prevLog = recentLogs[i - 1];
				const currLog = recentLogs[i];
				if (prevLog && currLog) {
					const interval = prevLog.createdAt.getTime() - currLog.createdAt.getTime();
					intervals.push(interval);
				}
			}

			// Check if intervals are suspiciously consistent (within 5 seconds)
			if (intervals.length >= 2) {
				const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
				const deviations = intervals.map((i) => Math.abs(i - avgInterval));
				const maxDeviation = Math.max(...deviations);
				hasTimingPattern = maxDeviation < 5000; // Less than 5 second deviation
			}
		}

		// Count instant responses (< 500ms)
		const instantResponseCount = recentLogs.filter((log) => log.responseTime < 500).length;

		// Check failed captcha pattern
		const failedCount = recentLogs.filter((log) => !log.success).length;
		const hasFailedCaptchaPattern = failedCount > 3;

		// Get user's current suspicious score
		const userStats = await context.db.query.userStatsTable.findFirst({
			where: { userId: input.userId },
		});
		const suspiciousScore = userStats?.suspiciousBehaviorScore || 0;

		// Determine recommendation
		let recommendation: "allow" | "challenge" | "ban";
		if (suspiciousScore >= 80 || instantResponseCount > 5) {
			recommendation = "ban";
		} else if (suspiciousScore >= 40 || hasTimingPattern || hasFailedCaptchaPattern) {
			recommendation = "challenge";
		} else {
			recommendation = "allow";
		}

		return {
			hasTimingPattern,
			hasFailedCaptchaPattern,
			instantResponseCount,
			suspiciousScore,
			recommendation,
		};
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
// 	.handler(async ({ input, context, errors }) => {
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

		const dailyLogs = await context.db.query.userStatsLogTable.findMany({
			where: {
				userId: input.userId,
				activityType: "daily",
				createdAt: {
					gte: today,
				},
			},
		});

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
			where: { userId: input.userId },
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
		const cooldownRemaining = isOnCooldown ? Math.floor((cooldownEndTime.getTime() - now.getTime()) / 1000) : 0;

		// Get last work activity from log if needed
		const lastWorkActivity = await context.db.query.userStatsLogTable.findFirst({
			where: {
				userId: input.userId,
				activityType: "work",
			},
			orderBy: { createdAt: "desc" },
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
	.errors({
		ALREADY_CLAIMED: {
			message: "Daily reward already claimed today",
		},
		ECONOMY_BANNED: {
			message: "Economy access suspended",
		},
		DATABASE_ERROR: {
			message: "Database operation failed",
		},
	})
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
	.handler(async ({ input, context, errors }) => {
		// Check if user exists
		const user = await context.db.query.usersTable.findFirst({
			with: {
				stats: true,
			},
			where: { id: input.userId },
		});

		if (!user) {
			throw errors.NOT_FOUND({
				message: "User not found for the given userId / claimDaily",
			});
		}

		if (!user.stats) {
			throw errors.NOT_FOUND({
				message: "User stats not found for the given user / claimDaily",
			});
		}

		// User stats exists, safe to use
		const userStats = user.stats;

		// Check if user is economy banned
		if (userStats.economyBannedUntil && userStats.economyBannedUntil > new Date()) {
			throw errors.ECONOMY_BANNED({
				message: "Your economy access is temporarily suspended due to suspicious activity",
			});
		}

		// Check if already claimed today
		const today = new Date();
		today.setHours(0, 0, 0, 0);

		const dailyLogs = await context.db.query.userStatsLogTable.findFirst({
			where: {
				userId: input.userId,
				activityType: "daily",
				createdAt: {
					gte: today,
				},
			},
		});

		if (dailyLogs) {
			throw errors.ALREADY_CLAIMED();
		}

		// Check if streak should be reset (missed a day)
		const yesterday = new Date();
		yesterday.setDate(yesterday.getDate() - 1);
		yesterday.setHours(0, 0, 0, 0);

		const yesterdayEnd = new Date(yesterday);
		yesterdayEnd.setHours(23, 59, 59, 999);

		const yesterdayActivityLogs = await context.db.query.userStatsLogTable.findMany({
			where: {
				userId: input.userId,
				activityType: "daily",
			},
		});

		// Filter for yesterday's logs
		const yesterdayLogs = yesterdayActivityLogs.find(
			(log) => log.createdAt >= yesterday && log.createdAt <= yesterdayEnd,
		);

		// Update streak
		const newStreak = yesterdayLogs ? userStats.dailyStreak + 1 : 1;
		const maxStreak = Math.max(userStats.maxDailyStreak, newStreak);

		// Calculate rewards with boost multiplier
		const currentLevel = calculateLevel(userStats.xpCount);
		const rewards = calculateRewards("daily", currentLevel, newStreak, input.boostCount);

		// Calculate new totals
		const newCoins = userStats.coinsCount + rewards.earnedTotalCoins;
		const newXp = userStats.xpCount + rewards.earnedTotalXp;

		// Check for level up
		const levelUp = processLevelUp(userStats.xpCount, newXp);

		return await context.db.transaction(async (db) => {
			// Reduce suspicious score by 2 for successful claim (reward good behavior)
			const newSuspiciousScore = Math.max(0, userStats.suspiciousBehaviorScore - 2);

			// Update user stats including boost count
			const [updatedStats] = await db
				.update(userStatsTable)
				.set({
					dailyStreak: newStreak,
					maxDailyStreak: maxStreak,
					coinsCount: newCoins + (levelUp?.bonusCoins ?? 0),
					xpCount: newXp,
					boostCount: input.boostCount,
					suspiciousBehaviorScore: newSuspiciousScore,
					updatedAt: new Date(),
				})
				.where(eq(userStatsTable.userId, input.userId))
				.returning();

			if (!updatedStats) {
				throw errors.DATABASE_ERROR();
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
	.errors({
		ON_COOLDOWN: {
			message: "Work is on cooldown",
			data: z.object({
				reason: z.string(),
			}),
		},
		ECONOMY_BANNED: {
			message: "Economy access suspended",
		},
		DATABASE_ERROR: {
			message: "Database operation failed",
		},
	})
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
	.handler(async ({ input, context, errors }) => {
		// Get user stats to check cooldown
		const userStats = await context.db.query.userStatsTable.findFirst({
			where: { userId: input.userId },
		});

		if (!userStats) {
			throw errors.NOT_FOUND({
				message: "User stats not found for the given user / claimWork",
			});
		}

		// Check if user is economy banned
		if (userStats.economyBannedUntil && userStats.economyBannedUntil > new Date()) {
			throw errors.ECONOMY_BANNED({
				message: "Your economy access is temporarily suspended due to suspicious activity",
			});
		}

		// Check work cooldown (1 hour)
		if (userStats.lastWorkAt) {
			const now = new Date();
			const cooldownEnd = new Date(userStats.lastWorkAt.getTime() + 3600000); // 1 hour cooldown

			if (now < cooldownEnd) {
				const cooldownRemaining = Math.floor((cooldownEnd.getTime() - now.getTime()) / 1000);
				throw errors.ON_COOLDOWN({
					data: {
						reason: `You're still on cooldown. Please wait ${cooldownRemaining} seconds.`,
					},
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

		// Check for level up
		const levelUp = processLevelUp(userStats.xpCount, newXp);

		return await context.db.transaction(async (db) => {
			// Reduce suspicious score by 2 for successful claim (reward good behavior)
			const newSuspiciousScore = Math.max(0, userStats.suspiciousBehaviorScore - 2);

			const [updatedStats] = await db
				.update(userStatsTable)
				.set({
					coinsCount: newCoins + (levelUp?.bonusCoins ?? 0),
					xpCount: newXp,
					workCount: newWorkCount,
					lastWorkAt: new Date(),
					boostCount: input.boostCount,
					suspiciousBehaviorScore: newSuspiciousScore,
					updatedAt: new Date(),
				})
				.where(eq(userStatsTable.userId, input.userId))
				.returning();

			if (!updatedStats) {
				throw errors.DATABASE_ERROR();
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
				throw errors.DATABASE_ERROR();
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

/**
 * Server Tag Streak check and update
 * Checks if user has a server tag and updates their streak accordingly
 */
export const checkServerTagStreak = base
	.input(
		z.object({
			userId: z.number(),
			hasServerTag: z.boolean(),
			serverTagBadge: z.string().optional(),
		}),
	)
	.errors({
		DATABASE_ERROR: {
			message: "Database operation failed",
		},
	})
	.output(
		z.object({
			updatedStats: userStatsSchema,
			streakChanged: z.boolean(),
			rewardEarned: z.boolean(),
			milestoneReached: z.number().optional(),
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
	.handler(async ({ input, context, errors }) => {
		const userStats = await context.db.query.userStatsTable.findFirst({
			where: { userId: input.userId },
		});

		if (!userStats) {
			throw errors.NOT_FOUND({
				message: "User stats not found for the given user / checkServerTagStreak",
			});
		}

		// Check if it's been at least 12 hours since last check for API rate limiting
		const now = new Date();
		const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);
		const currentLevel = calculateLevel(userStats.xpCount);

		// Initialize default claim stats (for no reward scenario)
		let claimStats = createDefaultClaimStats(currentLevel);

		// Initialize level progress with current stats
		let levelProgress = getLevelProgress(userStats.xpCount);

		if (userStats.lastServerTagCheck && userStats.lastServerTagCheck > twelveHoursAgo) {
			// Within 12 hours - just update the check time but don't change streak
			return {
				updatedStats: userStats,
				streakChanged: false,
				rewardEarned: false,
				message: "Server tag already checked recently",
				claimStats,
				levelProgress,
			};
		}

		let newStreak = userStats.serverTagStreak;
		let streakChanged = false;
		let rewardEarned = false;
		let milestoneReached: number | undefined;
		let message = "";

		if (input.hasServerTag) {
			// User has a server tag - check if we should increment streak
			const badgeChanged =
				input.serverTagBadge && userStats.serverTagBadge && userStats.serverTagBadge !== input.serverTagBadge;

			// Calculate days since last check
			let shouldIncrementStreak = false;
			if (!userStats.lastServerTagCheck) {
				// First check ever, start the streak
				shouldIncrementStreak = true;
			} else {
				// Check if it's been at least 20 hours since last check (to account for some variance)
				// This prevents double-counting within the same day
				const hoursSinceLastCheck = (now.getTime() - userStats.lastServerTagCheck.getTime()) / (1000 * 60 * 60);
				if (hoursSinceLastCheck >= 20) {
					shouldIncrementStreak = true;
				}
			}

			if (shouldIncrementStreak) {
				newStreak = userStats.serverTagStreak + 1;
				streakChanged = true;
			} else {
				// Same day check, maintain current streak
				newStreak = userStats.serverTagStreak;
			}

			// Check for badge change
			if (badgeChanged) {
				// Badge changed - they updated their tag, keep the streak
				message = `Server tag updated to new badge, streak continues at ${newStreak} days!`;
			}

			// Check for 5-day milestone
			if (newStreak > 0 && newStreak % 5 === 0 && streakChanged) {
				rewardEarned = true;
				milestoneReached = newStreak;
				message = `Server tag streak milestone reached: ${newStreak} days!`;
			} else if (!badgeChanged && streakChanged) {
				// Only set this message if badge didn't change and streak incremented
				message = `Server tag streak increased to ${newStreak} days`;
			} else if (!streakChanged && !badgeChanged) {
				message = `Server tag streak maintained at ${newStreak} days`;
			}
		} else {
			// User doesn't have a server tag - reset streak
			if (userStats.serverTagStreak > 0) {
				newStreak = 0;
				streakChanged = true;
				message = `Server tag streak reset. Previous streak was ${userStats.serverTagStreak} days`;
			} else {
				message = "No server tag detected";
			}
		}

		// Update user stats
		const maxStreak = Math.max(userStats.maxServerTagStreak, newStreak);

		return await context.db.transaction(async (db) => {
			const [updatedStats] = await db
				.update(userStatsTable)
				.set({
					serverTagStreak: newStreak,
					maxServerTagStreak: maxStreak,
					lastServerTagCheck: now,
					serverTagBadge: input.serverTagBadge || userStats.serverTagBadge,
					updatedAt: now,
				})
				.where(eq(userStatsTable.userId, input.userId))
				.returning();

			if (!updatedStats) {
				throw errors.DATABASE_ERROR();
			}

			let finalStats = updatedStats;
			let levelUp: { oldLevel: number; newLevel: number; bonusCoins: number } | undefined;

			// If milestone reached, grant rewards
			if (rewardEarned && milestoneReached) {
				// Build claim stats for milestone reward
				claimStats = createServerTagMilestoneStats(currentLevel, milestoneReached);
				const coinsReward = claimStats.earnedTotalCoins;
				const xpReward = claimStats.earnedTotalXp;

				// Calculate new XP and check for level up
				const newXp = updatedStats.xpCount + xpReward;
				levelUp = processLevelUp(updatedStats.xpCount, newXp);

				// Update coins and XP
				const [rewardedStats] = await db
					.update(userStatsTable)
					.set({
						coinsCount: updatedStats.coinsCount + coinsReward + (levelUp?.bonusCoins ?? 0),
						xpCount: newXp,
						updatedAt: now,
					})
					.where(eq(userStatsTable.userId, input.userId))
					.returning();

				if (!rewardedStats) {
					throw errors.DATABASE_ERROR();
				}

				finalStats = rewardedStats;

				// Log the reward
				const logData: InsertDbUserStatsLog = {
					userId: input.userId,
					activityType: "server_tag_milestone",
					notes: `Server tag streak milestone: ${milestoneReached} days${levelUp ? ` (LEVEL UP to ${levelUp.newLevel}!)` : ""}`,
					xpEarned: xpReward,
					coinsEarned: coinsReward + (levelUp?.bonusCoins ?? 0),
				};

				await db.insert(userStatsLogTable).values(logData);

				// Update level progress with new XP
				levelProgress = getLevelProgress(newXp);

				message = `${message} Earned ${coinsReward} coins and ${xpReward} XP!${levelUp ? ` You leveled up to level ${levelUp.newLevel} and earned ${levelUp.bonusCoins} bonus coins!` : ""}`;
			}

			return {
				updatedStats: finalStats,
				streakChanged,
				rewardEarned,
				milestoneReached,
				message,
				levelUp,
				claimStats,
				levelProgress,
			};
		});
	});

/**
 * Message milestone check contract
 * - Tracks message count and checks for milestone achievements
 * - Milestones: 100, 1000, 10000, 100000, 1000000 messages
 * - Grants rewards for reaching each milestone
 */
export const checkMessageMilestone = base
	.input(
		userStatsSchema.pick({
			userId: true,
		}),
	)
	.errors({
		NOT_FOUND: {
			message: "User stats not found",
		},
		DATABASE_ERROR: {
			message: "Database operation failed",
		},
	})
	.output(
		z.object({
			updatedStats: userStatsSchema,
			milestoneReached: z.number().optional(),
			rewardEarned: z.boolean(),
			message: z.string(),
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
			levelUp: z
				.object({
					oldLevel: z.number(),
					newLevel: z.number(),
					bonusCoins: z.number(),
				})
				.optional(),
		}),
	)
	.handler(async ({ input, context, errors }) => {
		const userStats = await context.db.query.userStatsTable.findFirst({
			where: { userId: input.userId },
		});

		if (!userStats) {
			throw errors.NOT_FOUND({
				message: "User stats not found for the given user / checkMessageMilestone",
			});
		}

		// Increment message count
		const newMessageCount = userStats.messagesCount + 1;
		const currentLevel = calculateLevel(userStats.xpCount);

		// Define milestones
		const milestones = [100, 1000, 10000, 100000, 1000000];

		// Check if we hit a milestone
		const milestoneReached = milestones.find((m) => userStats.messagesCount < m && newMessageCount >= m);
		const rewardEarned = !!milestoneReached;

		// Initialize default claim stats (for no reward scenario)
		let claimStats = createDefaultClaimStats(currentLevel);
		let levelProgress = getLevelProgress(userStats.xpCount);
		let message = `Message count: ${newMessageCount}`;

		return await context.db.transaction(async (db) => {
			// First update the message count
			const [updatedStats] = await db
				.update(userStatsTable)
				.set({
					messagesCount: newMessageCount,
					lastMessageAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(userStatsTable.userId, input.userId))
				.returning();

			if (!updatedStats) {
				throw errors.DATABASE_ERROR();
			}

			let finalStats = updatedStats;
			let levelUp: { oldLevel: number; newLevel: number; bonusCoins: number } | undefined;

			// If milestone reached, grant rewards
			if (rewardEarned && milestoneReached) {
				// Build claim stats for milestone reward
				const { createMessageMilestoneStats } = await import("../../utils/stats-utils.ts");
				claimStats = createMessageMilestoneStats(currentLevel, milestoneReached);
				const coinsReward = claimStats.earnedTotalCoins;
				const xpReward = claimStats.earnedTotalXp;

				// Calculate new XP and check for level up
				const newXp = updatedStats.xpCount + xpReward;
				levelUp = processLevelUp(updatedStats.xpCount, newXp);

				// Update coins and XP
				const [rewardedStats] = await db
					.update(userStatsTable)
					.set({
						coinsCount: updatedStats.coinsCount + coinsReward + (levelUp?.bonusCoins ?? 0),
						xpCount: newXp,
						updatedAt: new Date(),
					})
					.where(eq(userStatsTable.userId, input.userId))
					.returning();

				if (!rewardedStats) {
					throw errors.DATABASE_ERROR();
				}

				finalStats = rewardedStats;

				// Log the reward
				const logData: InsertDbUserStatsLog = {
					userId: input.userId,
					activityType: "message_milestone",
					notes: `Message milestone reached: ${milestoneReached.toLocaleString()} messages${levelUp ? ` (LEVEL UP to ${levelUp.newLevel}!)` : ""}`,
					xpEarned: xpReward,
					coinsEarned: coinsReward + (levelUp?.bonusCoins ?? 0),
				};

				await db.insert(userStatsLogTable).values(logData);

				// Update level progress with new XP
				levelProgress = getLevelProgress(newXp);

				message = `Message milestone reached: ${milestoneReached.toLocaleString()} messages! Earned ${coinsReward} coins and ${xpReward} XP!${levelUp ? ` You leveled up to level ${levelUp.newLevel} and earned ${levelUp.bonusCoins} bonus coins!` : ""}`;
			}

			return {
				updatedStats: finalStats,
				milestoneReached,
				rewardEarned,
				message,
				claimStats,
				levelProgress,
				levelUp,
			};
		});
	});

/**
 * Get server tag streak info for a user
 */
export const getServerTagStreak = base
	.input(
		userStatsSchema.pick({
			userId: true,
		}),
	)
	.output(
		z.object({
			currentStreak: z.number(),
			maxStreak: z.number(),
			lastCheck: z.date().optional(),
			nextMilestone: z.number(),
			daysUntilMilestone: z.number(),
		}),
	)
	.handler(async ({ input, context, errors }) => {
		const userStats = await context.db.query.userStatsTable.findFirst({
			where: { userId: input.userId },
		});

		if (!userStats) {
			throw errors.NOT_FOUND({
				message: "User stats not found for the given user / getServerTagStreak",
			});
		}

		const currentStreak = userStats.serverTagStreak;
		const nextMilestone = Math.ceil((currentStreak + 1) / 5) * 5;
		const daysUntilMilestone = nextMilestone - currentStreak;

		return {
			currentStreak,
			maxStreak: userStats.maxServerTagStreak,
			lastCheck: userStats.lastServerTagCheck || undefined,
			nextMilestone,
			daysUntilMilestone,
		};
	});

//
/**
 * Voice time milestone check contract
 * - Tracks voice channel time and checks for milestone achievements
 * - Milestones: 1h, 10h, 100h, 1000h, 10000h
 * - Grants rewards for reaching each milestone
 * - Should be called every 10 minutes for active voice users
 */
export const checkVoiceTimeMilestone = base
	.input(
		z.object({
			userId: z.number(),
			minutesInVoice: z.number(), // How many minutes they've been in voice since last check
		}),
	)
	.errors({
		NOT_FOUND: {
			message: "User stats not found",
		},
		DATABASE_ERROR: {
			message: "Database operation failed",
		},
	})
	.output(
		z.object({
			updatedStats: userStatsSchema,
			milestoneReached: z.number().optional(), // Hours milestone reached
			rewardEarned: z.boolean(),
			message: z.string(),
			totalVoiceHours: z.number(),
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
			levelUp: z
				.object({
					oldLevel: z.number(),
					newLevel: z.number(),
					bonusCoins: z.number(),
				})
				.optional(),
		}),
	)
	.handler(async ({ input, context, errors }) => {
		const userStats = await context.db.query.userStatsTable.findFirst({
			where: { userId: input.userId },
		});

		if (!userStats) {
			throw errors.NOT_FOUND({
				message: "User stats not found for the given user / checkVoiceTimeMilestone",
			});
		}

		// Update total voice time
		const newVoiceTimeMinutes = userStats.voiceTimeMinutes + input.minutesInVoice;
		const totalVoiceHours = Math.floor(newVoiceTimeMinutes / 60);
		const oldVoiceHours = Math.floor(userStats.voiceTimeMinutes / 60);
		const currentLevel = calculateLevel(userStats.xpCount);

		// Define milestones in hours
		const milestones = [1, 10, 100, 1000, 10000];

		// Check if we hit a milestone
		const milestoneReached = milestones.find((m) => oldVoiceHours < m && totalVoiceHours >= m);
		const rewardEarned = !!milestoneReached;

		// Initialize default claim stats (for no reward scenario)
		let claimStats = createDefaultClaimStats(currentLevel);
		let levelProgress = getLevelProgress(userStats.xpCount);
		let message = `Voice time: ${totalVoiceHours} hours`;

		return await context.db.transaction(async (db) => {
			// First update the voice time
			const [updatedStats] = await db
				.update(userStatsTable)
				.set({
					voiceTimeMinutes: newVoiceTimeMinutes,
					lastVoiceCheck: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(userStatsTable.userId, input.userId))
				.returning();

			if (!updatedStats) {
				throw errors.DATABASE_ERROR();
			}

			let finalStats = updatedStats;
			let levelUp: { oldLevel: number; newLevel: number; bonusCoins: number } | undefined;

			// If milestone reached, grant rewards
			if (rewardEarned && milestoneReached) {
				// Build claim stats for milestone reward
				claimStats = createVoiceTimeMilestoneStats(currentLevel, milestoneReached);
				const coinsReward = claimStats.earnedTotalCoins;
				const xpReward = claimStats.earnedTotalXp;

				// Calculate new XP and check for level up
				const newXp = updatedStats.xpCount + xpReward;
				levelUp = processLevelUp(updatedStats.xpCount, newXp);

				// Update coins and XP
				const [rewardedStats] = await db
					.update(userStatsTable)
					.set({
						coinsCount: updatedStats.coinsCount + coinsReward + (levelUp?.bonusCoins ?? 0),
						xpCount: newXp,
						updatedAt: new Date(),
					})
					.where(eq(userStatsTable.userId, input.userId))
					.returning();

				if (!rewardedStats) {
					throw errors.DATABASE_ERROR();
				}

				finalStats = rewardedStats;

				// Log the reward
				const logData: InsertDbUserStatsLog = {
					userId: input.userId,
					activityType: "voice_time_milestone",
					notes: `Voice time milestone reached: ${milestoneReached} hours${levelUp ? ` (LEVEL UP to ${levelUp.newLevel}!)` : ""}`,
					xpEarned: xpReward,
					coinsEarned: coinsReward + (levelUp?.bonusCoins ?? 0),
				};

				await db.insert(userStatsLogTable).values(logData);

				// Update level progress with new XP
				levelProgress = getLevelProgress(newXp);

				message = `Voice time milestone reached: ${milestoneReached} hours! Earned ${coinsReward} coins and ${xpReward} XP!${levelUp ? ` You leveled up to level ${levelUp.newLevel} and earned ${levelUp.bonusCoins} bonus coins!` : ""}`;
			}

			return {
				updatedStats: finalStats,
				milestoneReached,
				rewardEarned,
				message,
				totalVoiceHours,
				claimStats,
				levelProgress,
				levelUp,
			};
		});
	});

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
// 	.handler(async ({ input, context, errors }) => {
// 		// TODO: Add admin check
// 		// if (context.user?.role !== 'admin') {
// 		//     throw errors('FORBIDDEN', { message: 'Admin access required' });
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
// 			throw errors("NOT_FOUND", { message: "User stats not found" });
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
// 			throw errors("DATABASE_ERROR", {
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
// 	.handler(async ({ input, context, errors }) => {
// 		// TODO: Add admin check
// 		// if (context.user?.role !== 'admin') {
// 		//     throw errors('FORBIDDEN', { message: 'Admin access required' });
// 		// }
//
// 		throw errors("NOT_IMPLEMENTED", {
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
// 	.handler(async ({ input, context, errors }) => {
// 		// TODO: Add admin check
// 		// if (context.user?.role !== 'admin') {
// 		//     throw errors('FORBIDDEN', { message: 'Admin access required' });
// 		// }
//
// 		throw errors("NOT_IMPLEMENTED", {
// 			message: "Work recovery not yet implemented",
// 		});
// 	});
