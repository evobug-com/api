import { eq, getTableColumns, sql } from "drizzle-orm";
import { z } from "zod";
import {
	type InsertDbUser,
	type InsertDbUserStats,
	publicUserSchema,
	userSchema,
	userStatsTable,
	usersTable,
} from "../../db/schema.ts";
import { buildOrConditions } from "../../utils/db-utils.ts";
import { base } from "../shared/os.ts";

/**
 * User creation
 * - At least one of identifier must be available: username, email, discordId or guildedId
 * - If all are provided, it will register a new user with the provided details
 */
export const createUser = base
	.input(
		userSchema
			.pick({
				username: true,
				email: true,
				password: true,
				discordId: true,
				guildedId: true,
			})
			.partial(),
	)
	.output(publicUserSchema)
	.errors({
		USER_EXISTS: {
			message: "User with provided details already exists",
		},
		DATABASE_ERROR: {
			message: "Database operation failed",
		},
	})
	.handler(async ({ input, context, errors }) => {
		const whereCondition = buildOrConditions(usersTable, {
			username: input.username,
			email: input.email,
			discordId: input.discordId,
			guildedId: input.guildedId,
		});

		// If all are undefined, throw BAD_REQUEST
		if (!whereCondition) {
			throw errors.BAD_REQUEST({
				data: {
					reason: "At least one of username, email, discordId or guildedId must be provided",
				},
			});
		}

		const users = await context.db.select().from(usersTable).where(whereCondition).limit(1);
		if (users.length > 0) {
			throw errors.USER_EXISTS();
		}

		const userInput: InsertDbUser = {};
		if (input.username) userInput.username = input.username;
		if (input.email) userInput.email = input.email;
		if (input.password) userInput.password = input.password;
		if (input.guildedId) userInput.guildedId = input.guildedId;
		if (input.discordId) userInput.discordId = input.discordId;

		const { password: _, email: __, ...selectableFields } = getTableColumns(usersTable);

		return await context.db.transaction(async (db) => {
			const insertedUser = (await db.insert(usersTable).values(userInput).returning(selectableFields))?.[0] ?? null;

			if (!insertedUser) {
				throw errors.DATABASE_ERROR();
			}

			const userStatsInput: InsertDbUserStats = {
				userId: insertedUser.id,
			};

			await db.insert(userStatsTable).values(userStatsInput);

			return insertedUser;
		});
	});

/**
 * User retrieval
 * - At least one of id or discordId must be provided
 */
export const getUser = base
	.input(
		userSchema
			.pick({
				id: true,
				discordId: true,
			})
			.partial(),
	)
	.output(publicUserSchema)
	.handler(async ({ input, context, errors }) => {
		const whereCondition = buildOrConditions(usersTable, {
			id: input.id,
			discordId: input.discordId,
		});

		// If all are undefined, throw BAD_REQUEST
		if (!whereCondition) {
			throw errors.BAD_REQUEST({
				data: {
					reason: "At least one of id or discordId must be provided",
				},
			});
		}

		const { password: _, email: __, ...userFields } = getTableColumns(usersTable);

		const users = await context.db.select(userFields).from(usersTable).where(whereCondition).limit(1);
		if (users.length <= 0) {
			throw errors.NOT_FOUND({
				message: "User not found with the provided details / getUser",
			});
		}
		return users[0] as Required<(typeof users)[number]>;
	});

// /**
//  * Current user retrieval contract
//  */
// export const currentUser = base
//   .input(z.void())
//   .output(userSchema.nullable())
//
// /**
//  * Top users leaderboard contract
//  * GET /users/leaderboard - Retrieves top users by specified metric
//  * Supports various metrics and configurable limit
//  */
// export const leaderboard = base
//   .input(z.object({
//     metric: z.string().optional(),
//     limit: z.int().min(1).max(100).optional(),
//   }))
//   .output(z.array(topUserSchema))

/**
 * User profile update contract
 * Allows updating user details like username, email, etc.
 */
export const updateUser = base
	.input(
		userSchema
			.pick({
				id: true,
				discordId: true,
				guildedId: true,
				username: true,
				email: true,
				password: true,
				role: true,
			})
			.partial()
			.required({ id: true }),
	)
	.output(userSchema.partial())
	.errors({
		DATABASE_ERROR: {
			message: "Unable to update user",
		},
	})
	.handler(async ({ input, context, errors }) => {
		const [user] = await context.db.select().from(usersTable).where(eq(usersTable.id, input.id)).limit(1);
		if (!user) {
			throw errors.NOT_FOUND({
				message: "User not found / updateUser",
			});
		}

		const updateData: InsertDbUser = {
			updatedAt: new Date(),
		};
		if (input.username !== undefined) updateData.username = input.username;
		if (input.password !== undefined) updateData.password = input.password;
		if (input.email !== undefined) updateData.email = input.email;
		if (input.role !== undefined) updateData.role = input.role;
		if (input.discordId !== undefined) updateData.discordId = input.discordId;
		if (input.guildedId !== undefined) updateData.guildedId = input.guildedId;

		const { password: _, ...selectableFields } = getTableColumns(usersTable);
		const [updatedUser] = await context.db
			.update(usersTable)
			.set(updateData)
			.where(eq(usersTable.id, input.id))
			.returning(selectableFields);
		if (!updatedUser) {
			throw errors.DATABASE_ERROR();
		}
		return updatedUser;
	});

/**
 * Get all Discord IDs of registered users
 * Used for batch operations like server tag streak checks
 * Returns only users that have a Discord ID set
 */
export const getAllDiscordIds = base
	.output(z.array(z.object({ id: z.number(), discordId: z.string() })))
	.handler(async ({ context }) => {
		const users = await context.db
			.select({ id: usersTable.id, discordId: usersTable.discordId })
			.from(usersTable)
			.where(sql`${usersTable.discordId} IS NOT NULL`);

		return users.filter((u): u is { id: number; discordId: string } => u.discordId !== null);
	});

//
// /**
//  * Email link creation contract
//  * POST /users/me/email-link - Links an email account to the current user
//  * Requires password verification
//  */
// export const createEmailLink = base
//   .input(z.object({
//     email: emailSchema,
//     password: passwordSchema,
//   }))
//   .output(linkAccountResultSchema)
//
// /**
//  * Event participation creation contract
//  * POST /users/{userId}/event-participations - Records user participation in an event
//  * Tracks user engagement in various events
//  */
// export const createEventParticipation = base
//   .input(z.object({
//     userId: idSchema,
//     eventName: z.string(),
//   }))
//   .output(eventParticipationResultSchema)
//
// /**
//  * Message count update contract
//  * PUT /users/{userId}/message-count - Increments user's message count
//  * Used for tracking user activity
//  */
// export const updateMessageCount = base
//   .input(z.object({
//     userId: idSchema,
//   }))
//   .output(messageCountResultSchema)
