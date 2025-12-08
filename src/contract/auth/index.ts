import { eq, or, getTableColumns } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import {
	publicUserSchema,
	userStatsTable,
	usersTable,
} from "../../db/schema.ts";
import { base } from "../shared/os.ts";

// JWT secret - should be in env in production
const JWT_SECRET = new TextEncoder().encode(
	process.env.JWT_SECRET || "allcom-zone-secret-key-change-in-production"
);

// Token expiry (7 days)
const TOKEN_EXPIRY = "7d";

/**
 * Generate JWT token for a user
 */
async function generateToken(userId: number): Promise<string> {
	return await new SignJWT({ userId })
		.setProtectedHeader({ alg: "HS256" })
		.setIssuedAt()
		.setExpirationTime(TOKEN_EXPIRY)
		.sign(JWT_SECRET);
}

/**
 * Verify JWT token and return user ID
 */
async function verifyToken(token: string): Promise<number | null> {
	try {
		const { payload } = await jwtVerify(token, JWT_SECRET);
		return payload.userId as number;
	} catch {
		return null;
	}
}

/**
 * Hash password using Bun's built-in password hashing
 */
async function hashPassword(password: string): Promise<string> {
	return await Bun.password.hash(password, {
		algorithm: "bcrypt",
		cost: 10,
	});
}

/**
 * Verify password against hash
 */
async function verifyPassword(password: string, hash: string): Promise<boolean> {
	return await Bun.password.verify(password, hash);
}

// Output schema for auth responses
const authResponseSchema = z.object({
	token: z.string(),
	user: publicUserSchema,
});

/**
 * Login - authenticate user with username/email and password
 */
export const login = base
	.input(
		z.object({
			usernameOrEmail: z.string().min(1),
			password: z.string().min(1),
		})
	)
	.output(authResponseSchema)
	.errors({
		INVALID_CREDENTIALS: {
			message: "Invalid username/email or password",
		},
	})
	.handler(async ({ input, context, errors }) => {
		const { usernameOrEmail, password } = input;

		// Find user by username or email
		const [user] = await context.db
			.select()
			.from(usersTable)
			.where(
				or(
					eq(usersTable.username, usernameOrEmail),
					eq(usersTable.email, usernameOrEmail)
				)
			)
			.limit(1);

		if (!user) {
			throw errors.INVALID_CREDENTIALS();
		}

		// Check if user has a password (might be Discord-only account)
		if (!user.password) {
			throw errors.INVALID_CREDENTIALS();
		}

		// Verify password
		const isValid = await verifyPassword(password, user.password);
		if (!isValid) {
			throw errors.INVALID_CREDENTIALS();
		}

		// Generate token
		const token = await generateToken(user.id);

		// Return user without sensitive fields
		const { password: _, ...publicUser } = user;
		return {
			token,
			user: publicUser,
		};
	});

/**
 * Register - create new user account
 */
export const register = base
	.input(
		z.object({
			username: z.string().min(3).max(50),
			email: z.string().email(),
			password: z.string().min(6),
		})
	)
	.output(authResponseSchema)
	.errors({
		USER_EXISTS: {
			message: "User with this username or email already exists",
		},
		DATABASE_ERROR: {
			message: "Failed to create user",
		},
	})
	.handler(async ({ input, context, errors }) => {
		const { username, email, password } = input;

		// Check if user already exists
		const [existingUser] = await context.db
			.select()
			.from(usersTable)
			.where(
				or(
					eq(usersTable.username, username),
					eq(usersTable.email, email)
				)
			)
			.limit(1);

		if (existingUser) {
			throw errors.USER_EXISTS();
		}

		// Hash password
		const hashedPassword = await hashPassword(password);

		// Create user in transaction
		const { password: _, ...selectableFields } = getTableColumns(usersTable);

		const newUser = await context.db.transaction(async (db) => {
			const [insertedUser] = await db
				.insert(usersTable)
				.values({
					username,
					email,
					password: hashedPassword,
				})
				.returning(selectableFields);

			if (!insertedUser) {
				throw errors.DATABASE_ERROR();
			}

			// Create user stats
			await db.insert(userStatsTable).values({
				userId: insertedUser.id,
			});

			return insertedUser;
		});

		// Generate token
		const token = await generateToken(newUser.id);

		return {
			token,
			user: newUser,
		};
	});

// Extended user schema for authenticated user's own profile (includes email and computed fields)
const meResponseSchema = z.object({
	id: z.number(),
	username: z.string().nullable(),
	email: z.string().nullable(),
	discordId: z.string().nullable(),
	guildedId: z.string().nullable(),
	role: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	// Computed fields
	hasPassword: z.boolean(),
	// Economy stats
	economyStats: z.object({
		coinsCount: z.number(),
		xpCount: z.number(),
		dailyStreak: z.number(),
		messagesCount: z.number(),
	}).nullable(),
});

/**
 * Me - get current user from token (with extended profile data)
 */
export const me = base
	.input(
		z.object({
			token: z.string(),
		})
	)
	.output(meResponseSchema.nullable())
	.handler(async ({ input, context, errors }) => {
		const { token } = input;

		// Verify token
		const userId = await verifyToken(token);
		if (!userId) {
			throw errors.UNAUTHORIZED();
		}

		// Get user with all fields except password
		const [user] = await context.db
			.select()
			.from(usersTable)
			.where(eq(usersTable.id, userId))
			.limit(1);

		if (!user) {
			throw errors.NOT_FOUND({ message: "User not found" });
		}

		// Get economy stats
		const [stats] = await context.db
			.select()
			.from(userStatsTable)
			.where(eq(userStatsTable.userId, userId))
			.limit(1);

		return {
			id: user.id,
			username: user.username,
			email: user.email,
			discordId: user.discordId,
			guildedId: user.guildedId,
			role: user.role,
			createdAt: user.createdAt,
			updatedAt: user.updatedAt,
			hasPassword: !!user.password,
			economyStats: stats ? {
				coinsCount: stats.coinsCount,
				xpCount: stats.xpCount,
				dailyStreak: stats.dailyStreak,
				messagesCount: stats.messagesCount,
			} : null,
		};
	});

/**
 * Discord OAuth callback - exchange code for user
 */
export const discordCallback = base
	.input(
		z.object({
			code: z.string(),
		})
	)
	.output(authResponseSchema)
	.errors({
		OAUTH_ERROR: {
			message: "Discord authentication failed",
		},
	})
	.handler(async ({ input, context, errors }) => {
		const { code } = input;

		// Exchange code for access token
		const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({
				client_id: process.env.DISCORD_CLIENT_ID || "",
				client_secret: process.env.DISCORD_CLIENT_SECRET || "",
				grant_type: "authorization_code",
				code,
				redirect_uri: process.env.DISCORD_REDIRECT_URI || "",
			}),
		});

		if (!tokenResponse.ok) {
			console.error("Discord token exchange failed:", await tokenResponse.text());
			throw errors.OAUTH_ERROR();
		}

		const tokenData = await tokenResponse.json() as { access_token: string };

		// Get user info from Discord
		const userResponse = await fetch("https://discord.com/api/users/@me", {
			headers: {
				Authorization: `Bearer ${tokenData.access_token}`,
			},
		});

		if (!userResponse.ok) {
			console.error("Discord user fetch failed:", await userResponse.text());
			throw errors.OAUTH_ERROR();
		}

		const discordUser = await userResponse.json() as {
			id: string;
			username: string;
			email?: string;
		};

		// Find or create user
		const { password: _, ...selectableFields } = getTableColumns(usersTable);

		let [user] = await context.db
			.select(selectableFields)
			.from(usersTable)
			.where(eq(usersTable.discordId, discordUser.id))
			.limit(1);

		if (!user) {
			// Create new user
			const newUser = await context.db.transaction(async (db) => {
				const [insertedUser] = await db
					.insert(usersTable)
					.values({
						username: discordUser.username,
						email: discordUser.email || null,
						discordId: discordUser.id,
					})
					.returning(selectableFields);

				if (!insertedUser) {
					throw errors.OAUTH_ERROR();
				}

				// Create user stats
				await db.insert(userStatsTable).values({
					userId: insertedUser.id,
				});

				return insertedUser;
			});
			user = newUser;
		}

		// Generate token
		const token = await generateToken(user.id);

		return {
			token,
			user,
		};
	});
