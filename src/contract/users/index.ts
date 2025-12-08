import { desc, eq, getTableColumns, sql } from "drizzle-orm";
import { z } from "zod";
import {
	type InsertDbUser,
	type InsertDbUserStats,
	ordersTable,
	productsTable,
	publicUserSchema,
	userSchema,
	userStatsLogTable,
	userStatsTable,
	usersTable,
} from "../../db/schema.ts";
import { buildOrConditions } from "../../utils/db-utils.ts";
import { base } from "../shared/os.ts";

// JWT verification helper
const JWT_SECRET = new TextEncoder().encode(
	process.env.JWT_SECRET || "allcom-zone-secret-key-change-in-production"
);

async function verifyToken(token: string): Promise<number> {
	const { jwtVerify } = await import("jose");
	const { payload } = await jwtVerify(token, JWT_SECRET);
	return payload.userId as number;
}

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

// ============================================================================
// USER ORDERS - Fetch user's purchase history with product details
// ============================================================================
export const getUserOrders = base
	.input(z.object({ userId: z.number() }))
	.output(
		z.array(
			z.object({
				id: z.number(),
				userId: z.number(),
				productId: z.string(),
				size: z.string().nullable(),
				price: z.number(),
				status: z.string(),
				createdAt: z.string(),
				product: z
					.object({
						id: z.string(),
						name: z.string(),
						price: z.number(),
						description: z.string().nullable(),
						imageUrl: z.string().nullable(),
						sizes: z.array(z.string()).nullable(),
					})
					.optional(),
			})
		)
	)
	.handler(async ({ input, context }) => {
		const orders = await context.db
			.select({
				id: ordersTable.id,
				userId: ordersTable.userId,
				productId: ordersTable.productId,
				size: ordersTable.size,
				price: ordersTable.price,
				status: ordersTable.status,
				createdAt: ordersTable.createdAt,
				productName: productsTable.name,
				productPrice: productsTable.price,
				productDescription: productsTable.description,
				productImageUrl: productsTable.imageUrl,
				productSizes: productsTable.sizes,
			})
			.from(ordersTable)
			.leftJoin(productsTable, eq(ordersTable.productId, productsTable.id))
			.where(eq(ordersTable.userId, input.userId))
			.orderBy(desc(ordersTable.createdAt));

		return orders.map((order) => ({
			id: order.id,
			userId: order.userId,
			productId: order.productId,
			size: order.size,
			price: order.price,
			status: order.status,
			createdAt: order.createdAt.toISOString(),
			product: order.productName
				? {
						id: order.productId,
						name: order.productName,
						price: order.productPrice ?? 0,
						description: order.productDescription,
						imageUrl: order.productImageUrl,
						sizes: order.productSizes,
					}
				: undefined,
		}));
	});

// ============================================================================
// ECONOMY ACTIVITIES - Fetch user's XP/coin activity history
// ============================================================================
export const getEconomyActivities = base
	.input(z.object({ userId: z.number() }))
	.output(
		z.array(
			z.object({
				id: z.number(),
				activityType: z.string(),
				xpEarned: z.number(),
				coinsEarned: z.number(),
				timestamp: z.string(),
				notes: z.string().nullable(),
			})
		)
	)
	.handler(async ({ input, context }) => {
		const activities = await context.db
			.select()
			.from(userStatsLogTable)
			.where(eq(userStatsLogTable.userId, input.userId))
			.orderBy(desc(userStatsLogTable.createdAt))
			.limit(50);

		return activities.map((activity) => ({
			id: activity.id,
			activityType: activity.activityType,
			xpEarned: activity.xpEarned,
			coinsEarned: activity.coinsEarned,
			timestamp: activity.createdAt.toISOString(),
			notes: activity.notes,
		}));
	});

// ============================================================================
// CHANGE PASSWORD - Requires old password verification
// ============================================================================
export const changePassword = base
	.input(
		z.object({
			token: z.string(),
			oldPassword: z.string().min(1),
			newPassword: z.string().min(6),
		})
	)
	.output(
		z.object({
			success: z.boolean(),
			message: z.string(),
		})
	)
	.errors({
		INVALID_PASSWORD: { message: "Current password is incorrect" },
		NO_PASSWORD_SET: { message: "No password set for this account" },
	})
	.handler(async ({ input, context, errors }) => {
		let userId: number;
		try {
			userId = await verifyToken(input.token);
		} catch {
			throw errors.UNAUTHORIZED();
		}

		const [user] = await context.db
			.select({ password: usersTable.password })
			.from(usersTable)
			.where(eq(usersTable.id, userId))
			.limit(1);

		if (!user) {
			throw errors.NOT_FOUND({ message: "User not found" });
		}

		if (!user.password) {
			throw errors.NO_PASSWORD_SET();
		}

		const isValid = await Bun.password.verify(input.oldPassword, user.password);
		if (!isValid) {
			throw errors.INVALID_PASSWORD();
		}

		const hashedPassword = await Bun.password.hash(input.newPassword, {
			algorithm: "bcrypt",
			cost: 10,
		});

		await context.db
			.update(usersTable)
			.set({ password: hashedPassword, updatedAt: new Date() })
			.where(eq(usersTable.id, userId));

		return { success: true, message: "Password changed successfully" };
	});

// ============================================================================
// SET PASSWORD - For passwordless accounts (Discord-only users)
// ============================================================================
export const setPassword = base
	.input(
		z.object({
			token: z.string(),
			newPassword: z.string().min(6),
		})
	)
	.output(
		z.object({
			success: z.boolean(),
			message: z.string(),
		})
	)
	.errors({
		PASSWORD_ALREADY_SET: { message: "Password is already set for this account" },
	})
	.handler(async ({ input, context, errors }) => {
		let userId: number;
		try {
			userId = await verifyToken(input.token);
		} catch {
			throw errors.UNAUTHORIZED();
		}

		const [user] = await context.db
			.select({ password: usersTable.password })
			.from(usersTable)
			.where(eq(usersTable.id, userId))
			.limit(1);

		if (!user) {
			throw errors.NOT_FOUND({ message: "User not found" });
		}

		if (user.password) {
			throw errors.PASSWORD_ALREADY_SET();
		}

		const hashedPassword = await Bun.password.hash(input.newPassword, {
			algorithm: "bcrypt",
			cost: 10,
		});

		await context.db
			.update(usersTable)
			.set({ password: hashedPassword, updatedAt: new Date() })
			.where(eq(usersTable.id, userId));

		return { success: true, message: "Password set successfully" };
	});

// ============================================================================
// LINK EMAIL - Add email to user account
// ============================================================================
export const linkEmail = base
	.input(
		z.object({
			token: z.string(),
			email: z.string().email(),
			password: z.string().min(6),
		})
	)
	.output(
		z.object({
			success: z.boolean(),
			message: z.string(),
			data: z
				.object({
					userId: z.number(),
					email: z.string(),
				})
				.optional(),
		})
	)
	.errors({
		EMAIL_IN_USE: { message: "Email is already in use" },
		EMAIL_ALREADY_SET: { message: "Email is already set for this account" },
	})
	.handler(async ({ input, context, errors }) => {
		let userId: number;
		try {
			userId = await verifyToken(input.token);
		} catch {
			throw errors.UNAUTHORIZED();
		}

		const [user] = await context.db
			.select({ email: usersTable.email })
			.from(usersTable)
			.where(eq(usersTable.id, userId))
			.limit(1);

		if (!user) {
			throw errors.NOT_FOUND({ message: "User not found" });
		}

		if (user.email) {
			throw errors.EMAIL_ALREADY_SET();
		}

		// Check if email is already in use
		const [existingEmail] = await context.db
			.select({ id: usersTable.id })
			.from(usersTable)
			.where(eq(usersTable.email, input.email))
			.limit(1);

		if (existingEmail) {
			throw errors.EMAIL_IN_USE();
		}

		const hashedPassword = await Bun.password.hash(input.password, {
			algorithm: "bcrypt",
			cost: 10,
		});

		await context.db
			.update(usersTable)
			.set({
				email: input.email,
				password: hashedPassword,
				updatedAt: new Date(),
			})
			.where(eq(usersTable.id, userId));

		return {
			success: true,
			message: "Email linked successfully",
			data: { userId, email: input.email },
		};
	});

// ============================================================================
// REQUEST DISCORD VERIFICATION - Generate verification code
// ============================================================================
export const requestDiscordVerification = base
	.input(z.object({ token: z.string() }))
	.output(
		z.object({
			code: z.string(),
			expiresAt: z.string(),
		})
	)
	.handler(async ({ input, errors }) => {
		// Verify the user is authenticated (userId used for future storage)
		try {
			await verifyToken(input.token);
		} catch {
			throw errors.UNAUTHORIZED();
		}

		// Generate a random verification code (XXXX-XXXX format)
		const generateCode = () => {
			const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
			let code = "";
			for (let i = 0; i < 4; i++) {
				code += chars.charAt(Math.floor(Math.random() * chars.length));
			}
			code += "-";
			for (let i = 0; i < 4; i++) {
				code += chars.charAt(Math.floor(Math.random() * chars.length));
			}
			return code;
		};

		const code = generateCode();
		const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

		// Note: In a production system, you'd store this in Redis or a verification table
		// For now, we'll return it for the bot to validate
		// The bot should store this mapping: code -> { userId, expiresAt }

		return {
			code,
			expiresAt: expiresAt.toISOString(),
		};
	});

// ============================================================================
// SET USERNAME - For users without a username (e.g., Discord-only accounts)
// ============================================================================
export const setUsername = base
	.input(
		z.object({
			token: z.string(),
			username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/, {
				message: "Username can only contain letters, numbers, and underscores",
			}),
		})
	)
	.output(
		z.object({
			success: z.boolean(),
			message: z.string(),
			username: z.string(),
		})
	)
	.errors({
		USERNAME_TAKEN: { message: "This username is already taken" },
		USERNAME_ALREADY_SET: { message: "Username is already set for this account" },
	})
	.handler(async ({ input, context, errors }) => {
		let userId: number;
		try {
			userId = await verifyToken(input.token);
		} catch {
			throw errors.UNAUTHORIZED();
		}

		const [user] = await context.db
			.select({ username: usersTable.username })
			.from(usersTable)
			.where(eq(usersTable.id, userId))
			.limit(1);

		if (!user) {
			throw errors.NOT_FOUND({ message: "User not found" });
		}

		// Check if username is already set
		if (user.username) {
			throw errors.USERNAME_ALREADY_SET();
		}

		// Check if username is taken
		const [existingUser] = await context.db
			.select({ id: usersTable.id })
			.from(usersTable)
			.where(eq(usersTable.username, input.username))
			.limit(1);

		if (existingUser) {
			throw errors.USERNAME_TAKEN();
		}

		// Set the username
		await context.db
			.update(usersTable)
			.set({ username: input.username, updatedAt: new Date() })
			.where(eq(usersTable.id, userId));

		return {
			success: true,
			message: "Username set successfully",
			username: input.username,
		};
	});
