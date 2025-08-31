import { ORPCError } from "@orpc/client";
import { and, eq, gte, isNotNull, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import {
	type DbViolation,
	type InsertDbViolation,
	violationsSchema,
	violationsTable,
	usersTable,
} from "../../db/schema";
import {
	AccountStanding,
	FeatureRestriction,
	ReviewOutcome,
	ViolationSeverity,
	ViolationType,
	calculateAccountStanding,
	getDefaultExpirationDays,
	getDefaultRestrictions,
} from "../../utils/violation-utils";
import { base } from "../shared/os";

// Zod schemas for validation
const violationTypeSchema = z.nativeEnum(ViolationType);
const violationSeveritySchema = z.nativeEnum(ViolationSeverity);
const featureRestrictionSchema = z.nativeEnum(FeatureRestriction);
const reviewOutcomeSchema = z.nativeEnum(ReviewOutcome);

/**
 * Issue a new violation to a user
 * POST /violations/issue
 */
export const issueViolation = base
	.input(
		z.object({
			userId: z.number().int().positive(),
			guildId: z.string().min(1),
			type: violationTypeSchema,
			severity: violationSeveritySchema,
			reason: z.string().min(1).max(1000),
			policyViolated: z.string().optional(),
			contentSnapshot: z.string().optional(),
			context: z.string().optional(),
			issuedBy: z.number().int().positive(),
			expiresInDays: z.number().int().positive().optional(),
			restrictions: z.array(featureRestrictionSchema).optional(),
			actionsApplied: z.array(z.string()).optional(),
		}),
	)
	.output(
		z.object({
			violation: violationsSchema,
			accountStanding: z.nativeEnum(AccountStanding),
			message: z.string(),
		}),
	)
	.handler(async ({ input, context }) => {
		// Check if issuer exists and has permission (you might want to add role checking here)
		const issuer = await context.db.query.usersTable.findFirst({
			where: eq(usersTable.id, input.issuedBy),
		});

		if (!issuer) {
			throw new ORPCError("NOT_FOUND", { message: "Issuer not found" });
		}

		// Check if user exists
		const user = await context.db.query.usersTable.findFirst({
			where: eq(usersTable.id, input.userId),
		});

		if (!user) {
			throw new ORPCError("NOT_FOUND", { message: "User not found" });
		}

		// Calculate expiration date
		const expiresInDays = input.expiresInDays || getDefaultExpirationDays(input.severity);
		const expiresAt = new Date();
		expiresAt.setDate(expiresAt.getDate() + expiresInDays);

		// Get default restrictions if not provided
		const restrictions = input.restrictions || getDefaultRestrictions(input.type, input.severity);

		// Create the violation
		const newViolation: InsertDbViolation = {
			userId: input.userId,
			guildId: input.guildId,
			type: input.type,
			severity: input.severity,
			reason: input.reason,
			policyViolated: input.policyViolated || null,
			contentSnapshot: input.contentSnapshot || null,
			context: input.context || null,
			actionsApplied: input.actionsApplied ? JSON.stringify(input.actionsApplied) : null,
			restrictions: JSON.stringify(restrictions),
			issuedBy: input.issuedBy,
			expiresAt,
		};

		const [violation] = await context.db.insert(violationsTable).values(newViolation).returning();

		if (!violation) {
			throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to create violation" });
		}

		// Get all user violations to calculate new standing
		const allViolations = await context.db.query.violationsTable.findMany({
			where: and(eq(violationsTable.userId, input.userId), eq(violationsTable.guildId, input.guildId)),
		});

		const accountStanding = calculateAccountStanding(allViolations);

		return {
			violation,
			accountStanding,
			message: `Violation issued successfully. User's account standing is now: ${accountStanding}`,
		};
	});

/**
 * List violations for a user
 * GET /violations/list
 */
export const listViolations = base
	.input(
		z.object({
			userId: z.number().int().positive().optional(),
			guildId: z.string().min(1),
			includeExpired: z.boolean().default(false),
			limit: z.number().int().min(1).max(100).default(50),
			offset: z.number().int().min(0).default(0),
		}),
	)
	.output(
		z.object({
			violations: z.array(violationsSchema),
			total: z.number(),
			accountStanding: z.nativeEnum(AccountStanding).optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		const conditions = [eq(violationsTable.guildId, input.guildId)];

		if (input.userId) {
			conditions.push(eq(violationsTable.userId, input.userId));
		}

		if (!input.includeExpired) {
			// Only include non-expired violations
			conditions.push(
				or(
					isNull(violationsTable.expiresAt),
					gte(violationsTable.expiresAt, new Date())
				)!
			);
		}

		const violations = await context.db.query.violationsTable.findMany({
			where: and(...conditions),
			limit: input.limit,
			offset: input.offset,
			orderBy: (violations, { desc }) => [desc(violations.issuedAt)],
		});

		// Get total count
		const totalResult = await context.db
			.select({ count: violationsTable.id })
			.from(violationsTable)
			.where(and(...conditions));

		const total = totalResult.length;

		let accountStanding: AccountStanding | undefined;
		if (input.userId) {
			accountStanding = calculateAccountStanding(violations);
		}

		return {
			violations,
			total,
			accountStanding,
		};
	});

/**
 * Get a specific violation by ID
 * GET /violations/get
 */
export const getViolation = base
	.input(
		z.object({
			violationId: z.number().int().positive(),
		}),
	)
	.output(violationsSchema)
	.handler(async ({ input, context }) => {
		const violation = await context.db.query.violationsTable.findFirst({
			where: eq(violationsTable.id, input.violationId),
			with: {
				user: true,
				issuer: true,
				reviewer: true,
			},
		});

		if (!violation) {
			throw new ORPCError("NOT_FOUND", { message: "Violation not found" });
		}

		return violation;
	});

/**
 * Mark a violation as expired
 * PUT /violations/expire
 */
export const expireViolation = base
	.input(
		z.object({
			violationId: z.number().int().positive(),
			expiredBy: z.number().int().positive(),
		}),
	)
	.output(
		z.object({
			success: z.boolean(),
			message: z.string(),
		}),
	)
	.handler(async ({ input, context }) => {
		const violation = await context.db.query.violationsTable.findFirst({
			where: eq(violationsTable.id, input.violationId),
		});

		if (!violation) {
			throw new ORPCError("NOT_FOUND", { message: "Violation not found" });
		}

		if (violation.expiresAt && new Date(violation.expiresAt) < new Date()) {
			throw new ORPCError("CONFLICT", { message: "Violation is already expired" });
		}

		await context.db
			.update(violationsTable)
			.set({
				expiresAt: new Date(), // Set to now to expire immediately
				updatedAt: new Date(),
			})
			.where(eq(violationsTable.id, input.violationId));

		return {
			success: true,
			message: "Violation expired successfully",
		};
	});

/**
 * Update violation review status
 * PUT /violations/review
 */
export const updateViolationReview = base
	.input(
		z.object({
			violationId: z.number().int().positive(),
			reviewedBy: z.number().int().positive(),
			outcome: reviewOutcomeSchema,
			notes: z.string().optional(),
		}),
	)
	.output(
		z.object({
			success: z.boolean(),
			message: z.string(),
			violation: violationsSchema,
		}),
	)
	.handler(async ({ input, context }) => {
		const violation = await context.db.query.violationsTable.findFirst({
			where: eq(violationsTable.id, input.violationId),
		});

		if (!violation) {
			throw new ORPCError("NOT_FOUND", { message: "Violation not found" });
		}

		const updateData: Partial<DbViolation> = {
			reviewedBy: input.reviewedBy,
			reviewedAt: new Date(),
			reviewOutcome: input.outcome,
			reviewNotes: input.notes || null,
			updatedAt: new Date(),
		};

		// If rejected, expire the violation
		if (input.outcome === ReviewOutcome.REJECTED) {
			updateData.expiresAt = new Date(); // Set to now to expire immediately
		}

		const result = await context.db
			.update(violationsTable)
			.set(updateData)
			.where(eq(violationsTable.id, input.violationId))
			.returning();

		if (!result[0]) {
			throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to update violation" });
		}

		return {
			success: true,
			message: `Violation review completed with outcome: ${input.outcome}`,
			violation: result[0],
		};
	});

/**
 * Bulk expire violations (for cleanup jobs)
 * PUT /violations/bulk-expire
 */
export const bulkExpireViolations = base
	.input(
		z.object({
			guildId: z.string().min(1),
			beforeDate: z.date().optional(),
		}),
	)
	.output(
		z.object({
			success: z.boolean(),
			expiredCount: z.number(),
			message: z.string(),
		}),
	)
	.handler(async ({ input, context }) => {
		const conditions = [
			eq(violationsTable.guildId, input.guildId),
			lte(violationsTable.expiresAt, input.beforeDate || new Date()),
		];

		const result = await context.db
			.update(violationsTable)
			.set({
				expiresAt: new Date(), // Set to now to expire immediately
				updatedAt: new Date(),
			})
			.where(and(...conditions))
			.returning({ id: violationsTable.id });

		return {
			success: true,
			expiredCount: result.length,
			message: `Expired ${result.length} violations`,
		};
	});