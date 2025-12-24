/**
 * Anti-Cheat Contract Endpoints
 * Comprehensive anti-cheat system for economy commands
 * Based on production anti-cheat specifications from ANTICHEAT.md
 */

import { and, desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import {
	commandHistoryTable,
	type InsertDbCommandHistory,
	type InsertDbRateLimitViolation,
	type InsertDbTrustScore,
	type InsertDbUserBehaviorMetrics,
	rateLimitViolationsTable,
	trustScoresTable,
	userBehaviorMetricsTable,
	usersTable,
	userStatsSchema,
	userStatsTable,
} from "../../db/schema.ts";
import {
	analyzeCommandSequences,
	analyzeSessionPatterns,
	calculateAccountFactorScore,
	calculateCoefficientVariation,
	calculateComprehensiveSuspicionScore,
	calculateSocialSignalScore,
	checkCooldownSnipping,
	determineEnforcementAction,
} from "../../utils/anticheat-utils.ts";
import { base } from "../shared/os.ts";

// ============================================================================
// Command Execution Recording
// ============================================================================

/**
 * Record command execution in history
 * Called every time a user executes /work or /daily
 */
export const recordCommandExecution = base
	.input(
		z.object({
			userId: z.number(),
			guildId: z.string(),
			commandName: z.enum(["work", "daily"]),
			success: z.boolean().default(true),
			responseTime: z.number().optional(), // Milliseconds
			metadata: z.record(z.string(), z.unknown()).optional(),
		}),
	)
	.output(
		z.object({
			recorded: z.boolean(),
			commandId: z.number(),
		}),
	)
	.handler(async ({ input, context, errors }) => {
		const commandData: InsertDbCommandHistory = {
			userId: input.userId,
			guildId: input.guildId,
			commandName: input.commandName,
			executedAt: new Date(),
			success: input.success,
			responseTime: input.responseTime,
			metadata: input.metadata || {},
		};

		try {
			const [command] = await context.db.insert(commandHistoryTable).values(commandData).returning();

			if (!command) {
				throw errors.INTERNAL_ERROR({ message: "Failed to record command execution" });
			}

			// Trigger async timing analysis if user has enough commands (30+)
			// This is non-blocking - we don't await it
			analyzeUserTimingAsync(input.userId, input.guildId, context.db).catch((error) => {
				console.error(`[ANTICHEAT] Error in async timing analysis for user ${input.userId}:`, error);
			});

			return {
				recorded: true,
				commandId: command.id,
			};
		} catch (error) {
			console.error("[ANTICHEAT] Error recording command execution:", error);
			throw errors.INTERNAL_ERROR({ message: "Failed to record command" });
		}
	});

/**
 * Async function to analyze user timing patterns
 * Called automatically after command execution if user has enough data
 */
async function analyzeUserTimingAsync(userId: number, guildId: string, db: any): Promise<void> {
	// Get last 50 command timestamps
	const recentCommands = await db.query.commandHistoryTable.findMany({
		where: (commandHistoryTable: any, { eq }: any) => eq(commandHistoryTable.userId, userId),
		orderBy: (commandHistoryTable: any, { desc }: any) => desc(commandHistoryTable.executedAt),
		limit: 50,
	});

	if (recentCommands.length < 30) {
		return; // Need minimum 30 commands for statistical significance
	}

	// Calculate intervals in seconds
	const timestamps = recentCommands.map((cmd: any) => cmd.executedAt).reverse();
	const intervals: number[] = [];
	for (let i = 1; i < timestamps.length; i++) {
		const interval = (timestamps[i]!.getTime() - timestamps[i - 1]!.getTime()) / 1000;
		intervals.push(interval);
	}

	// Calculate CV and other timing metrics
	const timingAnalysis = calculateCoefficientVariation(intervals);

	// Update or create behavior metrics
	const metricsData: InsertDbUserBehaviorMetrics = {
		userId,
		guildId,
		totalCommands: recentCommands.length,
		avgCommandInterval: Math.round(timingAnalysis.mean),
		stddevCommandInterval: Math.round(timingAnalysis.stddev),
		coefficientVariation: Math.round(timingAnalysis.cv * 100), // Store as integer (percentage * 100)
		lastCommandAt: new Date(),
		lastAnalysisAt: new Date(),
	};

	await db
		.insert(userBehaviorMetricsTable)
		.values(metricsData)
		.onConflictDoUpdate({
			target: userBehaviorMetricsTable.userId,
			set: {
				totalCommands: metricsData.totalCommands,
				avgCommandInterval: metricsData.avgCommandInterval,
				stddevCommandInterval: metricsData.stddevCommandInterval,
				coefficientVariation: metricsData.coefficientVariation,
				lastCommandAt: metricsData.lastCommandAt,
				lastAnalysisAt: metricsData.lastAnalysisAt,
				updatedAt: new Date(),
			},
		});

	// If suspicious, record it
	if (timingAnalysis.isSuspicious) {
		console.log(`[ANTICHEAT] Suspicious timing detected for user ${userId}: ${timingAnalysis.reason}`);
	}
}

// ============================================================================
// Timing Pattern Analysis
// ============================================================================

/**
 * Analyze timing patterns for a user
 * Returns detailed timing analysis including CV, Z-scores, cooldown snipping
 */
export const analyzeTimingPatterns = base
	.input(userStatsSchema.pick({ userId: true }))
	.output(
		z.object({
			hasTimingPattern: z.boolean(),
			cv: z.number(),
			suspicionLevel: z.enum(["none", "low", "medium", "high", "extreme"]),
			cooldownSnipeRate: z.number(),
			hasCooldownSnipping: z.boolean(),
			hasUnnaturalConsistency: z.boolean(),
			reason: z.string().optional(),
			commandCount: z.number(),
		}),
	)
	.handler(async ({ input, context }) => {
		// Get command history
		const commands = await context.db
			.select()
			.from(commandHistoryTable)
			.where(eq(commandHistoryTable.userId, input.userId))
			.orderBy(desc(commandHistoryTable.executedAt))
			.limit(50);

		if (commands.length < 30) {
			return {
				hasTimingPattern: false,
				cv: 0,
				suspicionLevel: "none" as const,
				cooldownSnipeRate: 0,
				hasCooldownSnipping: false,
				hasUnnaturalConsistency: false,
				reason: "Insufficient data for analysis (need 30+ commands)",
				commandCount: commands.length,
			};
		}

		// Calculate intervals
		const timestamps = commands.map((cmd) => cmd.executedAt).reverse();
		const intervals: number[] = [];
		for (let i = 1; i < timestamps.length; i++) {
			const interval = (timestamps[i]!.getTime() - timestamps[i - 1]!.getTime()) / 1000;
			intervals.push(interval);
		}

		// Run all timing analyses
		const cvAnalysis = calculateCoefficientVariation(intervals);
		const snipeAnalysis = checkCooldownSnipping(intervals, 3600); // 1 hour for work

		return {
			hasTimingPattern: cvAnalysis.isSuspicious,
			cv: cvAnalysis.cv,
			suspicionLevel: cvAnalysis.suspicionLevel,
			cooldownSnipeRate: snipeAnalysis.snipeRate,
			hasCooldownSnipping: snipeAnalysis.isSuspicious,
			hasUnnaturalConsistency: cvAnalysis.isSuspicious && cvAnalysis.suspicionLevel === "extreme",
			reason: cvAnalysis.reason || snipeAnalysis.reason,
			commandCount: commands.length,
		};
	});

// ============================================================================
// Behavioral Scoring
// ============================================================================

/**
 * Calculate behavioral score for a user
 * Analyzes session patterns, command sequences, and social activity
 */
export const calculateBehavioralScore = base
	.input(
		z.object({
			userId: z.number(),
			guildId: z.string(),
		}),
	)
	.output(
		z.object({
			score: z.number(), // 0-100
			hasNaturalBreaks: z.boolean(),
			hasRepetitiveSequences: z.boolean(),
			socialRatio: z.number(),
			reasons: z.array(z.string()),
		}),
	)
	.handler(async ({ input, context }) => {
		// Get command history for last 7 days
		const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
		const commands = await context.db
			.select()
			.from(commandHistoryTable)
			.where(and(eq(commandHistoryTable.userId, input.userId), gte(commandHistoryTable.executedAt, sevenDaysAgo)))
			.orderBy(desc(commandHistoryTable.executedAt));

		if (commands.length < 5) {
			return {
				score: 0,
				hasNaturalBreaks: true,
				hasRepetitiveSequences: false,
				socialRatio: 1,
				reasons: ["Insufficient command history for behavioral analysis"],
			};
		}

		const timestamps = commands.map((cmd) => cmd.executedAt);
		const commandNames = commands.map((cmd) => cmd.commandName);

		// Analyze session patterns
		const sessionAnalysis = analyzeSessionPatterns(timestamps);

		// Analyze command sequences
		const sequenceAnalysis = analyzeCommandSequences(commandNames);

		// Get social activity stats from user_stats
		const [userStats] = await context.db
			.select()
			.from(userStatsTable)
			.where(eq(userStatsTable.userId, input.userId))
			.limit(1);

		const messageCount = userStats?.messagesCount || 0;
		const commandCount = commands.length;
		const totalActivity = messageCount + commandCount;
		const socialRatio = totalActivity > 0 ? messageCount / totalActivity : 0;

		// Calculate overall behavioral score
		let behavioralScore = sessionAnalysis.suspicionScore;

		if (sequenceAnalysis.isSuspicious) {
			behavioralScore += 30;
		}

		if (socialRatio < 0.1) {
			behavioralScore += 25; // Less than 10% non-command activity
		}

		const reasons: string[] = [
			...sessionAnalysis.reasons,
			...(sequenceAnalysis.reason ? [sequenceAnalysis.reason] : []),
			...(socialRatio < 0.1 ? [`Low social interaction (${(socialRatio * 100).toFixed(0)}%)`] : []),
		];

		return {
			score: Math.min(100, behavioralScore),
			hasNaturalBreaks: sessionAnalysis.hasSleepPattern,
			hasRepetitiveSequences: sequenceAnalysis.isSuspicious,
			socialRatio,
			reasons,
		};
	});

// ============================================================================
// Comprehensive Suspicion Score
// ============================================================================

/**
 * Calculate comprehensive suspicion score from all signals
 * Combines timing, behavioral, social, and account factors
 */
export const calculateSuspicionScore = base
	.input(
		z.object({
			userId: z.number(),
			guildId: z.string(),
		}),
	)
	.output(
		z.object({
			totalScore: z.number(),
			breakdown: z.object({
				timingScore: z.number(),
				behavioralScore: z.number(),
				socialScore: z.number(),
				accountScore: z.number(),
				rateLimitScore: z.number(),
			}),
			recommendation: z.enum(["allow", "monitor", "challenge", "ban"]),
			reasons: z.array(z.string()),
		}),
	)
	.handler(async ({ input, context }) => {
		// Get timing analysis
		const timingAnalysis = await context.db
			.select()
			.from(commandHistoryTable)
			.where(eq(commandHistoryTable.userId, input.userId))
			.orderBy(desc(commandHistoryTable.executedAt))
			.limit(50);

		let timingScore = 0;
		let timingReason: string | undefined;

		if (timingAnalysis.length >= 30) {
			const timestamps = timingAnalysis.map((cmd) => cmd.executedAt).reverse();
			const intervals: number[] = [];
			for (let i = 1; i < timestamps.length; i++) {
				const interval = (timestamps[i]!.getTime() - timestamps[i - 1]!.getTime()) / 1000;
				intervals.push(interval);
			}

			const cvResult = calculateCoefficientVariation(intervals);
			timingScore = cvResult.cv < 0.5 ? 100 : cvResult.cv < 2 ? 50 : 0;
			timingReason = cvResult.reason;
		}

		// Get behavioral analysis - simplified to avoid nested handler calls
		const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
		const recentCommands = await context.db
			.select()
			.from(commandHistoryTable)
			.where(and(eq(commandHistoryTable.userId, input.userId), gte(commandHistoryTable.executedAt, sevenDaysAgo)))
			.orderBy(desc(commandHistoryTable.executedAt));

		let behavioralScore = 0;
		const behavioralReasons: string[] = [];

		if (recentCommands.length >= 5) {
			const timestamps = recentCommands.map((cmd) => cmd.executedAt);
			const sessionAnalysis = analyzeSessionPatterns(timestamps);
			behavioralScore = sessionAnalysis.suspicionScore;
			behavioralReasons.push(...sessionAnalysis.reasons);
		}

		// Get user stats and member info for account/social scoring
		const [userStats] = await context.db
			.select()
			.from(userStatsTable)
			.where(eq(userStatsTable.userId, input.userId))
			.limit(1);

		const [user] = await context.db.select().from(usersTable).where(eq(usersTable.id, input.userId)).limit(1);

		// Calculate account age
		const accountAge = user ? Math.floor((Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24)) : 0;

		// Calculate scores
		const accountScore = calculateAccountFactorScore(accountAge, true, userStats?.messagesCount || 0);

		const socialScore = calculateSocialSignalScore(userStats?.messagesCount || 0, timingAnalysis.length);

		// Get rate limit violations from last 24 hours
		const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
		const violations = await context.db
			.select()
			.from(rateLimitViolationsTable)
			.where(
				and(eq(rateLimitViolationsTable.userId, input.userId), gte(rateLimitViolationsTable.occurredAt, oneDayAgo)),
			);

		const rateLimitScore = Math.min(100, violations.length * 15);

		// Calculate comprehensive score
		const scoreBreakdown = calculateComprehensiveSuspicionScore({
			timingScore,
			behavioralScore,
			socialScore,
			accountScore,
			rateLimitScore,
		});

		// Determine recommendation
		let recommendation: "allow" | "monitor" | "challenge" | "ban" = "allow";
		if (scoreBreakdown.totalScore >= 85) {
			recommendation = "ban";
		} else if (scoreBreakdown.totalScore >= 70) {
			recommendation = "challenge";
		} else if (scoreBreakdown.totalScore >= 50) {
			recommendation = "monitor";
		}

		// Collect all reasons
		const reasons: string[] = [
			...(timingReason ? [timingReason] : []),
			...behavioralReasons,
		];

		if (accountAge < 7) {
			reasons.push("New account (< 7 days)");
		}

		if (violations.length > 0) {
			reasons.push(`${violations.length} rate limit violations in last 24h`);
		}

		return {
			totalScore: scoreBreakdown.totalScore,
			breakdown: {
				timingScore: scoreBreakdown.timingScore,
				behavioralScore: scoreBreakdown.behavioralScore,
				socialScore: scoreBreakdown.socialScore,
				accountScore: scoreBreakdown.accountScore,
				rateLimitScore: scoreBreakdown.rateLimitScore,
			},
			recommendation,
			reasons,
		};
	});

// ============================================================================
// Enforcement Action
// ============================================================================

/**
 * Get enforcement action for a user based on their suspicion and trust scores
 */
export const getEnforcementAction = base
	.input(
		z.object({
			userId: z.number(),
			guildId: z.string(),
		}),
	)
	.output(
		z.object({
			action: z.enum(["none", "monitor", "rate_limit", "captcha", "restrict"]),
			message: z.string().optional(),
			rateLimitMultiplier: z.number().optional(),
			captchaType: z.enum(["button", "image"]).optional(),
			restrictDuration: z.number().optional(),
			suspicionScore: z.number(),
			trustScore: z.number(),
		}),
	)
	.handler(async ({ input, context }) => {
		// Get suspicion score - simplified inline version
		const timingAnalysis = await context.db
			.select()
			.from(commandHistoryTable)
			.where(eq(commandHistoryTable.userId, input.userId))
			.orderBy(desc(commandHistoryTable.executedAt))
			.limit(50);

		let timingScore = 0;

		if (timingAnalysis.length >= 30) {
			const timestamps = timingAnalysis.map((cmd) => cmd.executedAt).reverse();
			const intervals: number[] = [];
			for (let i = 1; i < timestamps.length; i++) {
				const interval = (timestamps[i]!.getTime() - timestamps[i - 1]!.getTime()) / 1000;
				intervals.push(interval);
			}

			const cvResult = calculateCoefficientVariation(intervals);
			timingScore = cvResult.cv < 0.5 ? 100 : cvResult.cv < 2 ? 50 : 0;
		}

		// Simplified total score (just timing for now)
		const suspicionScore = timingScore;

		// Get or create trust score
		const [trustScoreData] = await context.db
			.select()
			.from(trustScoresTable)
			.where(eq(trustScoresTable.userId, input.userId))
			.limit(1);

		let finalTrustScoreData = trustScoreData;

		if (!finalTrustScoreData) {
			// Create default trust score
			const [newTrustScore] = await context.db
				.insert(trustScoresTable)
				.values({
					userId: input.userId,
					guildId: input.guildId,
					score: 500, // Neutral starting point
				})
				.returning();

			finalTrustScoreData = newTrustScore!;
		}

		// Determine enforcement action
		const enforcement = determineEnforcementAction(suspicionScore, finalTrustScoreData.score);

		return {
			...enforcement,
			message: enforcement.message ?? undefined,
			suspicionScore,
			trustScore: finalTrustScoreData.score,
		};
	});

// ============================================================================
// Trust Score Management
// ============================================================================

/**
 * Update trust score based on user behavior
 */
export const updateTrustScore = base
	.input(
		z.object({
			userId: z.number(),
			guildId: z.string(),
			delta: z.number(), // Can be positive or negative
			reason: z.string(),
		}),
	)
	.output(
		z.object({
			updated: z.boolean(),
			newScore: z.number(),
			oldScore: z.number(),
		}),
	)
	.handler(async ({ input, context }) => {
		// Get current trust score
		const [trustScore] = await context.db
			.select()
			.from(trustScoresTable)
			.where(eq(trustScoresTable.userId, input.userId))
			.limit(1);

		const oldScore = trustScore?.score || 500;
		const newScore = Math.max(0, Math.min(1000, oldScore + input.delta));

		if (!trustScore) {
			// Create new trust score
			const trustData: InsertDbTrustScore = {
				userId: input.userId,
				guildId: input.guildId,
				score: newScore,
			};

			await context.db.insert(trustScoresTable).values(trustData);
		} else {
			// Update existing
			await context.db
				.update(trustScoresTable)
				.set({
					score: newScore,
					updatedAt: new Date(),
				})
				.where(eq(trustScoresTable.userId, input.userId));
		}

		return {
			updated: true,
			newScore,
			oldScore,
		};
	});

// ============================================================================
// Rate Limit Violation Tracking
// ============================================================================

/**
 * Record a rate limit violation
 */
export const recordRateLimitViolation = base
	.input(
		z.object({
			userId: z.number(),
			guildId: z.string(),
			commandName: z.string(),
			violationType: z.string(),
		}),
	)
	.output(
		z.object({
			recorded: z.boolean(),
		}),
	)
	.handler(async ({ input, context, errors }) => {
		const violationData: InsertDbRateLimitViolation = {
			userId: input.userId,
			guildId: input.guildId,
			commandName: input.commandName,
			violationType: input.violationType,
		};

		try {
			await context.db.insert(rateLimitViolationsTable).values(violationData);

			console.log(
				`[ANTICHEAT] Rate limit violation recorded for user ${input.userId}: ${input.violationType} on ${input.commandName}`,
			);

			return { recorded: true };
		} catch (error) {
			console.error("[ANTICHEAT] Error recording rate limit violation:", error);
			throw errors.INTERNAL_ERROR({ message: "Failed to record violation" });
		}
	});
