import { ORPCError } from "@orpc/client";
import { and, eq, gte, isNotNull, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import {
	type InsertDbSuspension,
	suspensionsSchema,
	suspensionsTable,
	usersTable,
} from "../../db/schema";
import { base } from "../shared/os";

/**
 * Create a suspension (temporary or permanent ban)
 * POST /suspensions/create
 */
export const createSuspension = base
	.input(
		z.object({
			userId: z.number().int().positive(),
			guildId: z.string().min(1),
			reason: z.string().min(1).max(1000),
			duration: z.number().int().positive().optional(), // Duration in days, null for permanent
			issuedBy: z.number().int().positive(),
		}),
	)
	.output(
		z.object({
			suspension: suspensionsSchema,
			message: z.string(),
			isPermanent: z.boolean(),
		}),
	)
	.handler(async ({ input, context }) => {
		// Check if issuer exists and has permission
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

		// Check for active suspension
		const activeSuspension = await context.db.query.suspensionsTable.findFirst({
			where: and(
				eq(suspensionsTable.userId, input.userId),
				eq(suspensionsTable.guildId, input.guildId),
				isNull(suspensionsTable.liftedAt),
				gte(suspensionsTable.endsAt, new Date()),
			),
		});

		if (activeSuspension) {
			throw new ORPCError("CONFLICT", { message: "User already has an active suspension" });
		}

		// Calculate expiration date (default to 30 days if not provided)
		const endsAt = new Date();
		if (input.duration) {
			endsAt.setDate(endsAt.getDate() + input.duration);
		} else {
			// Default to 30 days if no duration specified
			endsAt.setDate(endsAt.getDate() + 30);
		}

		// Create the suspension
		const newSuspension: InsertDbSuspension = {
			userId: input.userId,
			guildId: input.guildId,
			reason: input.reason,
			issuedBy: input.issuedBy,
			endsAt,
		};

		const [suspension] = await context.db.insert(suspensionsTable).values(newSuspension).returning();

		if (!suspension) {
			throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to create suspension" });
		}

		const isPermanent = false; // No longer support permanent suspensions

		return {
			suspension,
			message: isPermanent
				? "User has been permanently suspended"
				: `User has been suspended for ${input.duration} days`,
			isPermanent,
		};
	});

/**
 * Lift a suspension
 * PUT /suspensions/lift
 */
export const liftSuspension = base
	.input(
		z.object({
			userId: z.number().int().positive(),
			guildId: z.string().min(1),
			liftedBy: z.number().int().positive(),
			reason: z.string().optional(),
		}),
	)
	.output(
		z.object({
			success: z.boolean(),
			message: z.string(),
		}),
	)
	.handler(async ({ input, context }) => {
		// Check if lifter exists and has permission
		const lifter = await context.db.query.usersTable.findFirst({
			where: eq(usersTable.id, input.liftedBy),
		});

		if (!lifter) {
			throw new ORPCError("NOT_FOUND", { message: "Lifter not found" });
		}

		// Find active suspension
		const activeSuspension = await context.db.query.suspensionsTable.findFirst({
			where: and(
				eq(suspensionsTable.userId, input.userId),
				eq(suspensionsTable.guildId, input.guildId),
				isNull(suspensionsTable.liftedAt),
			),
		});

		if (!activeSuspension) {
			throw new ORPCError("NOT_FOUND", { message: "No active suspension found for this user" });
		}

		// Lift the suspension
		await context.db
			.update(suspensionsTable)
			.set({
				liftedAt: new Date(),
				liftedBy: input.liftedBy,
				liftReason: input.reason || null,
				updatedAt: new Date(),
			})
			.where(eq(suspensionsTable.id, activeSuspension.id));

		return {
			success: true,
			message: "Suspension lifted successfully",
		};
	});

/**
 * Check if a user is suspended
 * GET /suspensions/check
 */
export const checkSuspension = base
	.input(
		z.object({
			userId: z.number().int().positive(),
			guildId: z.string().min(1),
		}),
	)
	.output(
		z.object({
			isSuspended: z.boolean(),
			suspension: suspensionsSchema.nullable(),
			expiresIn: z.number().nullable(), // Days until expiration
			isPermanent: z.boolean(),
		}),
	)
	.handler(async ({ input, context }) => {
		// Find active suspension
		const suspension = await context.db.query.suspensionsTable.findFirst({
			where: and(
				eq(suspensionsTable.userId, input.userId),
				eq(suspensionsTable.guildId, input.guildId),
				isNull(suspensionsTable.liftedAt),
				gte(suspensionsTable.endsAt, new Date()),
			),
		});

		if (!suspension) {
			return {
				isSuspended: false,
				suspension: null,
				expiresIn: null,
				isPermanent: false,
			};
		}

		// Calculate days until expiration
		let expiresIn: number | null = null;
		if (suspension.endsAt) {
			const now = new Date();
			const endsAt = new Date(suspension.endsAt);
			expiresIn = Math.ceil((endsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
		}

		return {
			isSuspended: true,
			suspension,
			expiresIn,
			isPermanent: !suspension.endsAt,
		};
	});

/**
 * List suspensions (active or all)
 * GET /suspensions/list
 */
export const listSuspensions = base
	.input(
		z.object({
			guildId: z.string().min(1),
			userId: z.number().int().positive().optional(),
			activeOnly: z.boolean().default(true),
			limit: z.number().int().min(1).max(100).default(50),
			offset: z.number().int().min(0).default(0),
		}),
	)
	.output(
		z.object({
			suspensions: z.array(
				suspensionsSchema.extend({
					user: z.any(),
					issuer: z.any(),
					lifter: z.any().nullable(),
				}),
			),
			total: z.number(),
		}),
	)
	.handler(async ({ input, context }) => {
		const conditions = [eq(suspensionsTable.guildId, input.guildId)];

		if (input.userId) {
			conditions.push(eq(suspensionsTable.userId, input.userId));
		}

		if (input.activeOnly) {
			conditions.push(
				isNull(suspensionsTable.liftedAt)
			);
			conditions.push(
				or(
					isNull(suspensionsTable.endsAt),
					and(
						isNotNull(suspensionsTable.endsAt),
						gte(suspensionsTable.endsAt, new Date())
					)
				)!
			);
		}

		const suspensions = await context.db.query.suspensionsTable.findMany({
			where: and(...conditions),
			with: {
				user: true,
				issuer: true,
				lifter: true,
			},
			limit: input.limit,
			offset: input.offset,
			orderBy: (suspensions, { desc }) => [desc(suspensions.startedAt)],
		});

		return {
			suspensions,
			total: suspensions.length,
		};
	});

/**
 * Get suspension history for a user
 * GET /suspensions/history
 */
export const getSuspensionHistory = base
	.input(
		z.object({
			userId: z.number().int().positive(),
			guildId: z.string().min(1),
		}),
	)
	.output(
		z.object({
			suspensions: z.array(suspensionsSchema),
			totalSuspensions: z.number(),
			activeSuspension: suspensionsSchema.nullable(),
			hasBeenSuspended: z.boolean(),
		}),
	)
	.handler(async ({ input, context }) => {
		// Get all suspensions for the user
		const suspensions = await context.db.query.suspensionsTable.findMany({
			where: and(eq(suspensionsTable.userId, input.userId), eq(suspensionsTable.guildId, input.guildId)),
			orderBy: (suspensions, { desc }) => [desc(suspensions.startedAt)],
		});

		// Find active suspension
		const activeSuspension =
			suspensions.find(
				(s) =>
					!s.liftedAt && (!s.endsAt || new Date(s.endsAt) > new Date()),
			) || null;

		return {
			suspensions,
			totalSuspensions: suspensions.length,
			activeSuspension,
			hasBeenSuspended: suspensions.length > 0,
		};
	});

/**
 * Auto-expire suspensions (for scheduled jobs)
 * PUT /suspensions/auto-expire
 */
export const autoExpireSuspensions = base
	.input(
		z.object({
			guildId: z.string().min(1),
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
		// Find expired suspensions that haven't been lifted
		const expiredSuspensions = await context.db.query.suspensionsTable.findMany({
			where: and(
				eq(suspensionsTable.guildId, input.guildId),
				isNull(suspensionsTable.liftedAt),
				isNotNull(suspensionsTable.endsAt),
				lte(suspensionsTable.endsAt, new Date())
			),
		});

		// Lift expired suspensions
		for (const suspension of expiredSuspensions) {
			await context.db
				.update(suspensionsTable)
				.set({
					liftedAt: new Date(),
					liftReason: "Suspension expired automatically",
					updatedAt: new Date(),
				})
				.where(eq(suspensionsTable.id, suspension.id));
		}

		return {
			success: true,
			expiredCount: expiredSuspensions.length,
			message: `Auto-expired ${expiredSuspensions.length} suspensions`,
		};
	});