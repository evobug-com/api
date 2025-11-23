import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import {
	achievementsSchema,
	achievementsTable,
	insertAchievementsSchema,
	updateAchievementsSchema,
	userAchievementsTable,
} from "../../db/schema.ts";
import { base } from "../shared/os.ts";

// Custom schema for user achievements with proper metadata typing
const userAchievementSchema = z.object({
	id: z.number(),
	userId: z.number(),
	achievementId: z.number(),
	unlockedAt: z.date().nullable(),
	metadata: z.record(z.string(), z.unknown()),
	createdAt: z.date(),
	updatedAt: z.date(),
});

// ============================================================================
// ACHIEVEMENT DEFINITIONS - CRUD operations
// ============================================================================

/**
 * Create achievement definition
 * POST /users/achievements/definitions
 */
export const createAchievement = base
	.input(insertAchievementsSchema.omit({ id: true, createdAt: true, updatedAt: true }))
	.output(achievementsSchema)
	.errors({
		DATABASE_ERROR: {
			message: "Failed to create achievement",
		},
	})
	.handler(async ({ input, context, errors }) => {
		const [achievement] = await context.db
			.insert(achievementsTable)
			.values({
				...input,
			})
			.returning();

		if (!achievement) {
			throw errors.DATABASE_ERROR();
		}

		return achievement;
	});

/**
 * List all achievements
 * GET /users/achievements/definitions
 */
export const listAchievements = base.output(z.array(achievementsSchema)).handler(async ({ context }) => {
	return await context.db.select().from(achievementsTable).orderBy(achievementsTable.name);
});

/**
 * Get single achievement
 * GET /users/achievements/definitions/{id}
 */
export const getAchievement = base
	.input(
		z.object({
			id: z.number(),
		}),
	)
	.output(achievementsSchema)
	.handler(async ({ input, context, errors }) => {
		const [achievement] = await context.db
			.select()
			.from(achievementsTable)
			.where(eq(achievementsTable.id, input.id))
			.limit(1);

		if (!achievement) {
			throw errors.NOT_FOUND({
				message: "Achievement not found",
			});
		}

		return achievement;
	});

/**
 * Update achievement
 * PUT /users/achievements/definitions/{id}
 */
export const updateAchievement = base
	.input(updateAchievementsSchema.required({ id: true }))
	.output(achievementsSchema)
	.errors({
		DATABASE_ERROR: {
			message: "Failed to update achievement",
		},
	})
	.handler(async ({ input, context, errors }) => {
		const [existing] = await context.db
			.select()
			.from(achievementsTable)
			.where(eq(achievementsTable.id, input.id))
			.limit(1);

		if (!existing) {
			throw errors.NOT_FOUND({
				message: "Achievement not found",
			});
		}

		const updateData = {
			updatedAt: new Date(),
			...(input.name !== undefined && { name: input.name }),
			...(input.description !== undefined && { description: input.description }),
		};

		const [updated] = await context.db
			.update(achievementsTable)
			.set(updateData)
			.where(eq(achievementsTable.id, input.id))
			.returning();

		if (!updated) {
			throw errors.DATABASE_ERROR();
		}

		return updated;
	});

/**
 * Delete achievement
 * DELETE /users/achievements/definitions/{id}
 */
export const deleteAchievement = base
	.input(
		z.object({
			id: z.number(),
		}),
	)
	.output(achievementsSchema)
	.errors({
		DATABASE_ERROR: {
			message: "Failed to delete achievement",
		},
	})
	.handler(async ({ input, context, errors }) => {
		const [deleted] = await context.db.delete(achievementsTable).where(eq(achievementsTable.id, input.id)).returning();

		if (!deleted) {
			throw errors.NOT_FOUND({
				message: "Achievement not found",
			});
		}

		return deleted;
	});

// ============================================================================
// USER ACHIEVEMENT PROGRESS - Tracking operations
// ============================================================================

/**
 * Upsert user achievement progress
 * POST /users/achievements/progress
 * Creates new entry or updates existing metadata
 */
export const upsertUserAchievement = base
	.input(
		z.object({
			userId: z.number(),
			achievementId: z.number(),
			metadata: z.record(z.string(), z.unknown()).optional(),
		}),
	)
	.output(userAchievementSchema)
	.errors({
		DATABASE_ERROR: {
			message: "Failed to upsert user achievement",
		},
	})
	.handler(async ({ input, context, errors }) => {
		const [userAchievement] = await context.db
			.insert(userAchievementsTable)
			.values({
				userId: input.userId,
				achievementId: input.achievementId,
				metadata: input.metadata ?? {},
			})
			.onConflictDoUpdate({
				target: [userAchievementsTable.userId, userAchievementsTable.achievementId],
				set: {
					metadata: input.metadata ?? {},
					updatedAt: new Date(),
				},
			})
			.returning();

		if (!userAchievement) {
			throw errors.DATABASE_ERROR();
		}

		return {
			...userAchievement,
			metadata: userAchievement.metadata ?? {},
		};
	});

/**
 * Get user's progress for specific achievement
 * GET /users/achievements/progress
 */
export const getUserAchievementProgress = base
	.input(
		z.object({
			userId: z.number(),
			achievementId: z.number(),
		}),
	)
	.output(userAchievementSchema.nullable())
	.handler(async ({ input, context }) => {
		const [userAchievement] = await context.db
			.select()
			.from(userAchievementsTable)
			.where(
				and(eq(userAchievementsTable.userId, input.userId), eq(userAchievementsTable.achievementId, input.achievementId)),
			)
			.limit(1);

		if (!userAchievement) {
			return null;
		}

		return {
			...userAchievement,
			metadata: userAchievement.metadata ?? {},
		};
	});

/**
 * List all achievements for a user
 * GET /users/achievements/progress/list
 * Optionally filter to only unlocked achievements
 */
export const listUserAchievements = base
	.input(
		z.object({
			userId: z.number(),
			unlockedOnly: z.boolean().optional(),
		}),
	)
	.output(z.array(userAchievementSchema))
	.handler(async ({ input, context }) => {
		const conditions = [eq(userAchievementsTable.userId, input.userId)];

		if (input.unlockedOnly) {
			conditions.push(isNotNull(userAchievementsTable.unlockedAt));
		}

		const results = await context.db
			.select()
			.from(userAchievementsTable)
			.where(and(...conditions))
			.orderBy(desc(userAchievementsTable.unlockedAt));

		return results.map((item) => ({
			...item,
			metadata: item.metadata ?? {},
		}));
	});

/**
 * Unlock achievement
 * PUT /users/achievements/progress/unlock
 * Sets unlockedAt timestamp to mark achievement as completed
 */
export const unlockAchievement = base
	.input(
		z.object({
			userId: z.number(),
			achievementId: z.number(),
		}),
	)
	.output(userAchievementSchema)
	.errors({
		DATABASE_ERROR: {
			message: "Failed to unlock achievement",
		},
		ALREADY_UNLOCKED: {
			message: "Achievement already unlocked",
		},
	})
	.handler(async ({ input, context, errors }) => {
		// Check if already unlocked
		const [existing] = await context.db
			.select()
			.from(userAchievementsTable)
			.where(
				and(eq(userAchievementsTable.userId, input.userId), eq(userAchievementsTable.achievementId, input.achievementId)),
			)
			.limit(1);

		if (existing?.unlockedAt) {
			throw errors.ALREADY_UNLOCKED();
		}

		// If entry doesn't exist, create it with unlockedAt set
		if (!existing) {
			const [created] = await context.db
				.insert(userAchievementsTable)
				.values({
					userId: input.userId,
					achievementId: input.achievementId,
					unlockedAt: new Date(),
					metadata: {},
				})
				.returning();

			if (!created) {
				throw errors.DATABASE_ERROR();
			}

			return {
				...created,
				metadata: created.metadata ?? {},
			};
		}

		// Update existing entry
		const [updated] = await context.db
			.update(userAchievementsTable)
			.set({
				unlockedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(
				and(eq(userAchievementsTable.userId, input.userId), eq(userAchievementsTable.achievementId, input.achievementId)),
			)
			.returning();

		if (!updated) {
			throw errors.DATABASE_ERROR();
		}

		return {
			...updated,
			metadata: updated.metadata ?? {},
		};
	});

/**
 * Delete user achievement progress
 * DELETE /users/achievements/progress
 * Removes progress entry for a specific achievement
 */
export const deleteUserAchievementProgress = base
	.input(
		z.object({
			userId: z.number(),
			achievementId: z.number(),
		}),
	)
	.output(userAchievementSchema)
	.errors({
		DATABASE_ERROR: {
			message: "Failed to delete user achievement progress",
		},
	})
	.handler(async ({ input, context, errors }) => {
		const [deleted] = await context.db
			.delete(userAchievementsTable)
			.where(
				and(eq(userAchievementsTable.userId, input.userId), eq(userAchievementsTable.achievementId, input.achievementId)),
			)
			.returning();

		if (!deleted) {
			throw errors.NOT_FOUND({
				message: "User achievement progress not found",
			});
		}

		return {
			...deleted,
			metadata: deleted.metadata ?? {},
		};
	});
