import { ORPCError } from "@orpc/client";
import { and, eq, gte, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { usersTable, violationsTable } from "../../db/schema";
import {
	AccountStanding,
	calculateAccountStanding,
	calculateSeverityScore,
	FeatureRestriction,
	getStandingDisplay,
	isExpired,
} from "../../utils/violation-utils";
import { base } from "../shared/os";

/**
 * Get user's current account standing
 * GET /standing/get
 */
export const getStanding = base
	.input(
		z.object({
			userId: z.number().int().positive(),
			guildId: z.string().min(1),
		}),
	)
	.output(
		z.object({
			standing: z.nativeEnum(AccountStanding),
			activeViolations: z.number(),
			totalViolations: z.number(),
			restrictions: z.array(z.nativeEnum(FeatureRestriction)),
			severityScore: z.number(),
			standingDisplay: z.object({
				label: z.string(),
				emoji: z.string(),
				color: z.number(),
				description: z.string(),
			}),
			nextExpirationDate: z.date().nullable(),
		}),
	)
	.handler(async ({ input, context }) => {
		// Check if user exists
		const user = await context.db.query.usersTable.findFirst({
			where: eq(usersTable.id, input.userId),
		});

		if (!user) {
			throw new ORPCError("NOT_FOUND", { message: "User not found" });
		}

		// Get all violations for the user in this guild
		const allViolations = await context.db.query.violationsTable.findMany({
			where: and(eq(violationsTable.userId, input.userId), eq(violationsTable.guildId, input.guildId)),
			orderBy: (violations, { desc }) => [desc(violations.issuedAt)],
		});

		// Filter active violations
		const activeViolations = allViolations.filter((v) => !isExpired(v));

		// Calculate standing and severity score
		const standing = calculateAccountStanding(allViolations);
		const severityScore = calculateSeverityScore(activeViolations);

		// Collect all active restrictions
		const restrictions: FeatureRestriction[] = [];
		for (const violation of activeViolations) {
			if (violation.restrictions) {
				try {
					const violationRestrictions = JSON.parse(violation.restrictions) as FeatureRestriction[];
					restrictions.push(...violationRestrictions);
				} catch {
					// Skip invalid JSON
				}
			}
		}

		// Remove duplicates
		const uniqueRestrictions = [...new Set(restrictions)];

		// Get standing display information
		const standingDisplay = getStandingDisplay(standing);

		// Find next expiration date
		let nextExpirationDate: Date | null = null;
		for (const violation of activeViolations) {
			if (violation.expiresAt) {
				const expiresAt = new Date(violation.expiresAt);
				if (!nextExpirationDate || expiresAt < nextExpirationDate) {
					nextExpirationDate = expiresAt;
				}
			}
		}

		return {
			standing,
			activeViolations: activeViolations.length,
			totalViolations: allViolations.length,
			restrictions: uniqueRestrictions,
			severityScore,
			standingDisplay,
			nextExpirationDate,
		};
	});

/**
 * Calculate standing for a user (without fetching from DB)
 * POST /standing/calculate
 */
export const calculateStanding = base
	.input(
		z.object({
			userId: z.number().int().positive(),
			guildId: z.string().min(1),
		}),
	)
	.output(
		z.object({
			standing: z.nativeEnum(AccountStanding),
			message: z.string(),
		}),
	)
	.handler(async ({ input, context }) => {
		// Get all violations for the user
		const violations = await context.db.query.violationsTable.findMany({
			where: and(
				eq(violationsTable.userId, input.userId),
				eq(violationsTable.guildId, input.guildId),
				or(isNull(violationsTable.expiresAt), gte(violationsTable.expiresAt, new Date())),
			),
		});

		const standing = calculateAccountStanding(violations);

		return {
			standing,
			message: `Account standing calculated: ${standing}`,
		};
	});

/**
 * Get standings for multiple users (leaderboard style)
 * GET /standing/bulk
 */
export const getBulkStandings = base
	.input(
		z.object({
			userIds: z.array(z.number().int().positive()).min(1).max(100),
			guildId: z.string().min(1),
		}),
	)
	.output(
		z.array(
			z.object({
				userId: z.number(),
				standing: z.nativeEnum(AccountStanding),
				activeViolations: z.number(),
				severityScore: z.number(),
			}),
		),
	)
	.handler(async ({ input, context }) => {
		const standings = [];

		for (const userId of input.userIds) {
			// Get violations for each user
			const violations = await context.db.query.violationsTable.findMany({
				where: and(eq(violationsTable.userId, userId), eq(violationsTable.guildId, input.guildId)),
			});

			const activeViolations = violations.filter((v) => !isExpired(v));
			const standing = calculateAccountStanding(violations);
			const severityScore = calculateSeverityScore(activeViolations);

			standings.push({
				userId,
				standing,
				activeViolations: activeViolations.length,
				severityScore,
			});
		}

		// Sort by severity score (highest first)
		standings.sort((a, b) => b.severityScore - a.severityScore);

		return standings;
	});

/**
 * Check if user has specific restrictions
 * GET /standing/restrictions
 */
export const getUserRestrictions = base
	.input(
		z.object({
			userId: z.number().int().positive(),
			guildId: z.string().min(1),
		}),
	)
	.output(
		z.object({
			restrictions: z.array(z.nativeEnum(FeatureRestriction)),
			hasRestriction: z.record(z.nativeEnum(FeatureRestriction), z.boolean()),
			canPerform: z.object({
				sendMessages: z.boolean(),
				sendEmbeds: z.boolean(),
				sendAttachments: z.boolean(),
				sendLinks: z.boolean(),
				useVoice: z.boolean(),
				useVideo: z.boolean(),
				stream: z.boolean(),
				addReactions: z.boolean(),
				createThreads: z.boolean(),
				changeNickname: z.boolean(),
			}),
		}),
	)
	.handler(async ({ input, context }) => {
		// Get active violations
		const violations = await context.db.query.violationsTable.findMany({
			where: and(
				eq(violationsTable.userId, input.userId),
				eq(violationsTable.guildId, input.guildId),
				or(isNull(violationsTable.expiresAt), gte(violationsTable.expiresAt, new Date())),
			),
		});

		// Collect all restrictions
		const restrictions: FeatureRestriction[] = [];
		for (const violation of violations) {
			if (violation.restrictions) {
				try {
					const violationRestrictions = JSON.parse(violation.restrictions) as FeatureRestriction[];
					restrictions.push(...violationRestrictions);
				} catch {
					// Skip invalid JSON
				}
			}
		}

		// Remove duplicates
		const uniqueRestrictions = [...new Set(restrictions)];

		// Create restriction map
		const hasRestriction = {} as Record<FeatureRestriction, boolean>;
		for (const restriction of Object.values(FeatureRestriction)) {
			hasRestriction[restriction] = uniqueRestrictions.includes(restriction);
		}

		// Determine what user can do
		const canPerform = {
			sendMessages: !hasRestriction[FeatureRestriction.TIMEOUT],
			sendEmbeds: !hasRestriction[FeatureRestriction.MESSAGE_EMBED] && !hasRestriction[FeatureRestriction.TIMEOUT],
			sendAttachments:
				!hasRestriction[FeatureRestriction.MESSAGE_ATTACH] && !hasRestriction[FeatureRestriction.TIMEOUT],
			sendLinks: !hasRestriction[FeatureRestriction.MESSAGE_LINK] && !hasRestriction[FeatureRestriction.TIMEOUT],
			useVoice: !hasRestriction[FeatureRestriction.VOICE_SPEAK] && !hasRestriction[FeatureRestriction.TIMEOUT],
			useVideo: !hasRestriction[FeatureRestriction.VOICE_VIDEO] && !hasRestriction[FeatureRestriction.TIMEOUT],
			stream: !hasRestriction[FeatureRestriction.VOICE_STREAM] && !hasRestriction[FeatureRestriction.TIMEOUT],
			addReactions: !hasRestriction[FeatureRestriction.REACTION_ADD] && !hasRestriction[FeatureRestriction.TIMEOUT],
			createThreads: !hasRestriction[FeatureRestriction.THREAD_CREATE] && !hasRestriction[FeatureRestriction.TIMEOUT],
			changeNickname:
				!hasRestriction[FeatureRestriction.NICKNAME_CHANGE] && !hasRestriction[FeatureRestriction.TIMEOUT],
		};

		return {
			restrictions: uniqueRestrictions,
			hasRestriction,
			canPerform,
		};
	});
