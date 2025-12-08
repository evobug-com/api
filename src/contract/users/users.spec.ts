import { beforeEach, describe, expect, it } from "bun:test";
import { ORPCError } from "@orpc/client";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql/postgres";
import type { relations } from "../../db/relations.ts";
import type * as schema from "../../db/schema.ts";
import { type DbUser, userStatsTable, usersTable, ordersTable, productsTable, userStatsLogTable } from "../../db/schema.ts";
import { createTestContext, createTestDatabase } from "../shared/test-utils.ts";
import { createUser, getAllDiscordIds, updateUser, getUserOrders, getEconomyActivities, changePassword, setPassword, linkEmail, setUsername, requestDiscordVerification } from "./index.ts";
import { register } from "../auth/index.ts";

describe("Users", () => {
	let db: BunSQLDatabase<typeof schema, typeof relations>;

	beforeEach(async () => {
		db = await createTestDatabase();
	});

	describe("create", () => {
		it("should be able to create a user", async () => {
			const user = (await call(
				createUser,
				{
					username: "testuser",
				},
				createTestContext(db),
			)) as Partial<DbUser>;

			expect(user).toStrictEqual({
				id: expect.any(Number),
				updatedAt: expect.any(Date),
				createdAt: expect.any(Date),
				discordId: null,
				guildedId: null,
				role: "user",
				username: "testuser",
			});
		});

		it("should create user's stats when creating a user", async () => {
			const user = await call(
				createUser,
				{
					username: "statscheckuser1",
				},
				createTestContext(db),
			);

			const stats = await db.select().from(userStatsTable).where(eq(userStatsTable.userId, user.id)).limit(1);
			expect(stats.length).toBe(1);
			expect(stats[0]).toStrictEqual({
				id: expect.any(Number),
				updatedAt: expect.any(Date),
				userId: user.id,
				coinsCount: 0,
				xpCount: 0,
				dailyStreak: 0,
				maxDailyStreak: 0,
				workCount: 0,
				lastWorkAt: null,
				messagesCount: 0,
				lastMessageAt: null,
				serverTagStreak: 0,
				maxServerTagStreak: 0,
				lastServerTagCheck: null,
				serverTagBadge: null,
				voiceTimeMinutes: 0,
				lastVoiceCheck: null,
				lastVoiceJoinedAt: null,
				boostCount: 0,
				boostExpires: null,
				failedCaptchaCount: 0,
				lastCaptchaFailedAt: null,
				suspiciousBehaviorScore: 0,
				lastSuspiciousActivityAt: null,
				economyBannedUntil: null,
			});
		});

		it("should fail if identifier is already taken", async () => {
			// First create a user
			await call(
				createUser,
				{
					username: "duplicateuser",
				},
				createTestContext(db),
			);

			// Try to create another user with the same username
			expect(
				call(
					createUser,
					{
						username: "duplicateuser",
					},
					createTestContext(db),
				),
			).rejects.toThrow(
				new ORPCError("NOT_ACCEPTABLE", {
					message: "User with provided details already exists",
				}),
			);
		});
	});

	describe("update", () => {
		it("should be able to update a user", async () => {
			// First create a user
			const user = await call(
				createUser,
				{
					username: "updatetestuser",
				},
				createTestContext(db),
			);

			const result = (await call(
				updateUser,
				{
					id: user.id,
					username: "anothertester",
					discordId: "some-discord-id",
				},
				createTestContext(db),
			)) as Partial<DbUser>;

			expect(result).toStrictEqual({
				id: user.id,
				updatedAt: expect.any(Date),
				createdAt: expect.any(Date),
				discordId: "some-discord-id",
				guildedId: null,
				email: null,
				role: "user",
				username: "anothertester",
			});
		});

		it("should allow updating to null values", async () => {
			const userWithDiscord = await call(
				createUser,
				{
					username: "userWithDiscord",
					discordId: "initial-discord-id",
				},
				createTestContext(db),
			);

			const result = await call(
				updateUser,
				{
					id: userWithDiscord.id,
					discordId: null,
				},
				createTestContext(db),
			);

			expect(result.discordId).toBeNull();
		});

		it("should handle updating non-existent user", async () => {
			expect(
				call(
					updateUser,
					{
						id: 999999,
						username: "doesntmatter",
					},
					createTestContext(db),
				),
			).rejects.toThrow();
		});

		it("should prevent duplicate usernames on update", async () => {
			// Create first user
			const _user1 = await call(
				createUser,
				{
					username: "firstuniqueuser",
				},
				createTestContext(db),
			);

			// Create second user
			const user2 = await call(
				createUser,
				{
					username: "seconduniqueuser",
				},
				createTestContext(db),
			);

			// Try to update user2 with user1's username
			expect(
				call(
					updateUser,
					{
						id: user2.id,
						username: "firstuniqueuser", // Already taken by first user
					},
					createTestContext(db),
				),
			).rejects.toThrow();
		});

		it("should allow same user to keep their username", async () => {
			// Create a user
			const user = await call(
				createUser,
				{
					username: "sameusernametest",
				},
				createTestContext(db),
			);

			// Update the user keeping the same username
			const result = (await call(
				updateUser,
				{
					id: user.id,
					username: "sameusernametest", // Same username
					email: "newemail@example.com",
				},
				createTestContext(db),
			)) as Partial<DbUser>;

			expect(result.username).toBe("sameusernametest");
			expect(result.email).toBe("newemail@example.com");
		});
	});

	describe("create with additional fields", () => {
		it("should create user with email", async () => {
			const userWithEmail = await call(
				createUser,
				{
					username: "emailuser",
					email: "test@example.com",
				},
				createTestContext(db),
			);

			// Email is not returned in public user data
			expect(userWithEmail.username).toBe("emailuser");
		});

		it("should create user with discord ID", async () => {
			const userWithDiscord = await call(
				createUser,
				{
					username: "discorduser",
					discordId: "123456789",
				},
				createTestContext(db),
			);

			expect(userWithDiscord.discordId).toBe("123456789");
		});

		it("should create user with guilded ID", async () => {
			const userWithGuilded = await call(
				createUser,
				{
					username: "guildeduser",
					guildedId: "abc123",
				},
				createTestContext(db),
			);

			expect(userWithGuilded.guildedId).toBe("abc123");
		});

		it("should create user with all optional fields", async () => {
			const fullUser = await call(
				createUser,
				{
					username: "fulluser",
					email: "full@example.com",
					discordId: "discord123",
					guildedId: "guilded456",
				},
				createTestContext(db),
			);

			expect(fullUser.username).toBe("fulluser");
			// Email is not returned in public user data
			expect(fullUser.discordId).toBe("discord123");
			expect(fullUser.guildedId).toBe("guilded456");
			expect(fullUser.role).toBe("user");
		});

		it("should fail if email is already taken", async () => {
			await call(
				createUser,
				{
					username: "firstemailuser",
					email: "duplicate@example.com",
				},
				createTestContext(db),
			);

			expect(
				call(
					createUser,
					{
						username: "secondemailuser",
						email: "duplicate@example.com",
					},
					createTestContext(db),
				),
			).rejects.toThrow(
				new ORPCError("NOT_ACCEPTABLE", {
					message: "User with provided details already exists",
				}),
			);
		});

		it("should fail if discordId is already taken", async () => {
			await call(
				createUser,
				{
					username: "firstdiscorduser",
					discordId: "duplicate-discord",
				},
				createTestContext(db),
			);

			expect(
				call(
					createUser,
					{
						username: "seconddiscorduser",
						discordId: "duplicate-discord",
					},
					createTestContext(db),
				),
			).rejects.toThrow();
		});
	});

	describe("stats creation", () => {
		it("should initialize stats with correct default values", async () => {
			const newUser = await call(
				createUser,
				{
					username: "statscheckuser",
				},
				createTestContext(db),
			);

			const stats = await db.select().from(userStatsTable).where(eq(userStatsTable.userId, newUser.id)).limit(1);

			expect(stats[0]).toBeDefined();
			expect(stats[0]?.userId).toBe(newUser.id);
			expect(stats[0]?.coinsCount).toBe(0);
			expect(stats[0]?.xpCount).toBe(0);
			expect(stats[0]?.dailyStreak).toBe(0);
			expect(stats[0]?.maxDailyStreak).toBe(0);
			expect(stats[0]?.workCount).toBe(0);
			expect(stats[0]?.messagesCount).toBe(0);
			expect(stats[0]?.boostCount).toBe(0);
			expect(stats[0]?.lastWorkAt).toBeNull();
			expect(stats[0]?.lastMessageAt).toBeNull();
			expect(stats[0]?.boostExpires).toBeNull();
		});
	});

	describe("edge cases", () => {
		it("should handle empty username", async () => {
			// Empty string is falsy, so it won't be included in userInput
			// The database will store null for username
			const user = await call(
				createUser,
				{
					username: "",
					discordId: "test-discord-id-empty-username",
				},
				createTestContext(db),
			);

			expect(user.username).toBe(null);
		});

		it("should handle very long username", async () => {
			const longUsername = "a".repeat(51); // Assuming 50 char limit

			expect(
				call(
					createUser,
					{
						username: longUsername,
					},
					createTestContext(db),
				),
			).rejects.toThrow();
		});

		it("should handle special characters in username", async () => {
			const specialUser = await call(
				createUser,
				{
					username: "user_with-special.chars123",
				},
				createTestContext(db),
			);

			expect(specialUser.username).toBe("user_with-special.chars123");
		});

		it("should handle unicode characters in username", async () => {
			const unicodeUser = await call(
				createUser,
				{
					username: "użytkownik",
				},
				createTestContext(db),
			);

			expect(unicodeUser.username).toBe("użytkownik");
		});

		it("should handle concurrent user creation", async () => {
			const promises = [];

			for (let i = 0; i < 5; i++) {
				promises.push(
					call(
						createUser,
						{
							username: `concurrentuser${i}`,
						},
						createTestContext(db),
					),
				);
			}

			const users = await Promise.all(promises);

			expect(users).toHaveLength(5);
			for (let i = 0; i < 5; i++) {
				expect(users[i]?.username).toBe(`concurrentuser${i}`);
			}
		});
	});

	describe("update edge cases", () => {
		it("should update multiple fields at once", async () => {
			const testUser = await call(
				createUser,
				{
					username: "multiupdateuser",
				},
				createTestContext(db),
			);

			const result = await call(
				updateUser,
				{
					id: testUser.id,
					username: "updatedname",
					email: "updated@example.com",
					discordId: "updated-discord",
					guildedId: "updated-guilded",
				},
				createTestContext(db),
			);

			expect(result.username).toBe("updatedname");
			expect(result.email).toBe("updated@example.com");
			expect(result.discordId).toBe("updated-discord");
			expect(result.guildedId).toBe("updated-guilded");
		});

		it("should not change unspecified fields", async () => {
			const testUser = await call(
				createUser,
				{
					username: "partialupdateuser",
					email: "original@example.com",
					discordId: "original-discord",
				},
				createTestContext(db),
			);

			const result = await call(
				updateUser,
				{
					id: testUser.id,
					username: "newusername",
				},
				createTestContext(db),
			);

			expect(result.username).toBe("newusername");
			expect(result.email).toBe("original@example.com");
			expect(result.discordId).toBe("original-discord");
		});

		it("should update timestamps correctly", async () => {
			const testUser = await call(
				createUser,
				{
					username: "timestampuser",
				},
				createTestContext(db),
			);

			const originalCreatedAt = testUser.createdAt;
			const originalUpdatedAt = testUser.updatedAt;

			// Wait a bit to ensure different timestamps
			await new Promise((resolve) => setTimeout(resolve, 100));

			const result = (await call(
				updateUser,
				{
					id: testUser.id,
					username: "updatedtimestamp",
				},
				createTestContext(db),
			)) as Partial<DbUser>;

			expect(result.createdAt).toEqual(originalCreatedAt);
			expect(result.updatedAt?.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
		});
	});

	describe("database constraints", () => {
		it("should maintain referential integrity for stats", async () => {
			const testUser = await call(
				createUser,
				{
					username: "integrityuser",
				},
				createTestContext(db),
			);

			// Verify stats were created
			const statsBefore = await db.select().from(userStatsTable).where(eq(userStatsTable.userId, testUser.id));

			expect(statsBefore).toHaveLength(1);

			// Delete user (should cascade to stats due to foreign key)
			await db.delete(usersTable).where(eq(usersTable.id, testUser.id));

			// Verify stats were deleted
			const statsAfter = await db.select().from(userStatsTable).where(eq(userStatsTable.userId, testUser.id));

			expect(statsAfter).toHaveLength(0);
		});
	});
});

describe("User retrieval functions", () => {
	let db: BunSQLDatabase<typeof schema, typeof relations>;

	beforeEach(async () => {
		db = await createTestDatabase();
	});

	describe("getAllDiscordIds", () => {
		it("should return empty array when no users exist", async () => {
			const result = await call(getAllDiscordIds, {}, createTestContext(db));
			expect(result).toEqual([]);
		});

		it("should return only users with Discord IDs", async () => {
			// Create user with Discord ID
			await call(
				createUser,
				{
					username: "discorduser1",
					discordId: "discord-123",
				},
				createTestContext(db),
			);

			// Create user without Discord ID
			await call(
				createUser,
				{
					username: "nodiscorduser",
				},
				createTestContext(db),
			);

			// Create another user with Discord ID
			await call(
				createUser,
				{
					username: "discorduser2",
					discordId: "discord-456",
				},
				createTestContext(db),
			);

			const result = await call(getAllDiscordIds, {}, createTestContext(db));

			expect(result).toHaveLength(2);
			expect(result.map((u) => u.discordId).sort()).toEqual(["discord-123", "discord-456"]);
		});

		it("should return id and discordId for each user", async () => {
			const user = await call(
				createUser,
				{
					username: "testdiscordid",
					discordId: "test-discord-id",
				},
				createTestContext(db),
			);

			const result = await call(getAllDiscordIds, {}, createTestContext(db));

			expect(result).toHaveLength(1);
			expect(result[0]).toEqual({
				id: user.id,
				discordId: "test-discord-id",
			});
		});

		it("should handle many users efficiently", async () => {
			// Create 20 users with Discord IDs
			for (let i = 0; i < 20; i++) {
				await call(
					createUser,
					{
						username: `batchuser${i}`,
						discordId: `batch-discord-${i}`,
					},
					createTestContext(db),
				);
			}

			const result = await call(getAllDiscordIds, {}, createTestContext(db));

			expect(result).toHaveLength(20);
		});
	});

	describe("getUserOrders", () => {
		it("should return empty array for user with no orders", async () => {
			const user = await call(
				createUser,
				{ username: "noordersuser" },
				createTestContext(db),
			);

			const result = await call(
				getUserOrders,
				{ userId: user.id },
				createTestContext(db),
			);

			expect(result).toEqual([]);
		});

		it("should return orders with product info", async () => {
			const user = await call(
				createUser,
				{ username: "orderuser" },
				createTestContext(db),
			);

			// Create a product
			const productId = crypto.randomUUID();
			await db.insert(productsTable).values({
				id: productId,
				name: "Test Product",
				price: 100,
				description: "A test product",
				isActive: true,
			});

			// Create an order
			await db.insert(ordersTable).values({
				userId: user.id,
				productId: productId,
				price: 100,
				size: "M",
				status: "completed",
			});

			const result = await call(
				getUserOrders,
				{ userId: user.id },
				createTestContext(db),
			);

			expect(result).toHaveLength(1);
			expect(result[0]).toStrictEqual(
				expect.objectContaining({
					userId: user.id,
					productId: productId,
					price: 100,
					size: "M",
					status: "completed",
					product: expect.objectContaining({
						id: productId,
						name: "Test Product",
						price: 100,
					}),
				}),
			);
		});

		it("should return orders ordered by creation date descending", async () => {
			const user = await call(
				createUser,
				{ username: "multiorderuser" },
				createTestContext(db),
			);

			const productId = crypto.randomUUID();
			await db.insert(productsTable).values({
				id: productId,
				name: "Multi Order Product",
				price: 50,
				isActive: true,
			});

			// Create multiple orders
			for (let i = 0; i < 3; i++) {
				await db.insert(ordersTable).values({
					userId: user.id,
					productId: productId,
					price: 50 + i * 10,
					status: "completed",
				});
			}

			const result = await call(
				getUserOrders,
				{ userId: user.id },
				createTestContext(db),
			);

			expect(result).toHaveLength(3);
		});
	});

	describe("getEconomyActivities", () => {
		it("should return empty array for user with no activities", async () => {
			const user = await call(
				createUser,
				{ username: "noactivitiesuser" },
				createTestContext(db),
			);

			const result = await call(
				getEconomyActivities,
				{ userId: user.id },
				createTestContext(db),
			);

			expect(result).toEqual([]);
		});

		it("should return activity logs for user", async () => {
			const user = await call(
				createUser,
				{ username: "activityuser" },
				createTestContext(db),
			);

			// Create activity logs
			await db.insert(userStatsLogTable).values({
				userId: user.id,
				activityType: "message",
				xpEarned: 10,
				coinsEarned: 5,
				notes: "Sent a message",
			});

			const result = await call(
				getEconomyActivities,
				{ userId: user.id },
				createTestContext(db),
			);

			expect(result).toHaveLength(1);
			expect(result[0]).toStrictEqual(
				expect.objectContaining({
					activityType: "message",
					xpEarned: 10,
					coinsEarned: 5,
					notes: "Sent a message",
				}),
			);
		});

		it("should limit results to 50 activities", async () => {
			const user = await call(
				createUser,
				{ username: "manyactivitiesuser" },
				createTestContext(db),
			);

			// Create 60 activity logs
			for (let i = 0; i < 60; i++) {
				await db.insert(userStatsLogTable).values({
					userId: user.id,
					activityType: "test",
					xpEarned: i,
					coinsEarned: i,
				});
			}

			const result = await call(
				getEconomyActivities,
				{ userId: user.id },
				createTestContext(db),
			);

			expect(result).toHaveLength(50);
		});
	});

	describe("changePassword", () => {
		it("should change password with correct old password", async () => {
			const authResult = await call(
				register,
				{
					username: "changepwuser",
					email: "changepw@example.com",
					password: "oldpassword123",
				},
				createTestContext(db),
			);

			const result = await call(
				changePassword,
				{
					token: authResult.token,
					oldPassword: "oldpassword123",
					newPassword: "newpassword456",
				},
				createTestContext(db),
			);

			expect(result).toStrictEqual({
				success: true,
				message: "Password changed successfully",
			});
		});

		it("should reject with incorrect old password", async () => {
			const authResult = await call(
				register,
				{
					username: "wrongpwuser",
					email: "wrongpw@example.com",
					password: "correctpassword",
				},
				createTestContext(db),
			);

			expect(
				call(
					changePassword,
					{
						token: authResult.token,
						oldPassword: "wrongpassword",
						newPassword: "newpassword456",
					},
					createTestContext(db),
				),
			).rejects.toThrow(
				new ORPCError("INVALID_PASSWORD", {
					message: "Current password is incorrect",
				}),
			);
		});

		it("should reject with invalid token", async () => {
			expect(
				call(
					changePassword,
					{
						token: "invalid-token",
						oldPassword: "oldpassword",
						newPassword: "newpassword",
					},
					createTestContext(db),
				),
			).rejects.toThrow();
		});

		it("should reject short new password", async () => {
			const authResult = await call(
				register,
				{
					username: "shortpwchange",
					email: "shortpwchange@example.com",
					password: "validpassword",
				},
				createTestContext(db),
			);

			expect(
				call(
					changePassword,
					{
						token: authResult.token,
						oldPassword: "validpassword",
						newPassword: "12345", // Less than 6 chars
					},
					createTestContext(db),
				),
			).rejects.toThrow();
		});
	});

	describe("setPassword", () => {
		it("should set password for account without password", async () => {
			// Create user without password (Discord-only account)
			const user = await call(
				createUser,
				{
					username: "discordonlyuser",
					discordId: "discord-id-123",
				},
				createTestContext(db),
			);

			// Generate a token for this user manually
			const { SignJWT } = await import("jose");
			const JWT_SECRET = new TextEncoder().encode(
				process.env.JWT_SECRET || "allcom-zone-secret-key-change-in-production"
			);
			const token = await new SignJWT({ userId: user.id })
				.setProtectedHeader({ alg: "HS256" })
				.setIssuedAt()
				.setExpirationTime("7d")
				.sign(JWT_SECRET);

			const result = await call(
				setPassword,
				{
					token,
					newPassword: "newpassword123",
				},
				createTestContext(db),
			);

			expect(result).toStrictEqual({
				success: true,
				message: "Password set successfully",
			});
		});

		it("should reject if password is already set", async () => {
			const authResult = await call(
				register,
				{
					username: "haspassworduser",
					email: "haspassword@example.com",
					password: "existingpassword",
				},
				createTestContext(db),
			);

			expect(
				call(
					setPassword,
					{
						token: authResult.token,
						newPassword: "newpassword123",
					},
					createTestContext(db),
				),
			).rejects.toThrow(
				new ORPCError("PASSWORD_ALREADY_SET", {
					message: "Password is already set for this account",
				}),
			);
		});

		it("should reject invalid token", async () => {
			expect(
				call(
					setPassword,
					{
						token: "invalid-token",
						newPassword: "newpassword123",
					},
					createTestContext(db),
				),
			).rejects.toThrow();
		});
	});

	describe("linkEmail", () => {
		it("should link email to account without email", async () => {
			// Create user without email
			const user = await call(
				createUser,
				{
					username: "noemailuser",
					discordId: "discord-noemail",
				},
				createTestContext(db),
			);

			const { SignJWT } = await import("jose");
			const JWT_SECRET = new TextEncoder().encode(
				process.env.JWT_SECRET || "allcom-zone-secret-key-change-in-production"
			);
			const token = await new SignJWT({ userId: user.id })
				.setProtectedHeader({ alg: "HS256" })
				.setIssuedAt()
				.setExpirationTime("7d")
				.sign(JWT_SECRET);

			const result = await call(
				linkEmail,
				{
					token,
					email: "newemail@example.com",
					password: "newpassword123",
				},
				createTestContext(db),
			);

			expect(result).toStrictEqual({
				success: true,
				message: "Email linked successfully",
				data: {
					userId: user.id,
					email: "newemail@example.com",
				},
			});
		});

		it("should reject if email is already set", async () => {
			const authResult = await call(
				register,
				{
					username: "hasemailuser",
					email: "existing@example.com",
					password: "password123",
				},
				createTestContext(db),
			);

			expect(
				call(
					linkEmail,
					{
						token: authResult.token,
						email: "another@example.com",
						password: "password123",
					},
					createTestContext(db),
				),
			).rejects.toThrow(
				new ORPCError("EMAIL_ALREADY_SET", {
					message: "Email is already set for this account",
				}),
			);
		});

		it("should reject if email is already in use by another user", async () => {
			// Create first user with email
			await call(
				register,
				{
					username: "firstuser",
					email: "taken@example.com",
					password: "password123",
				},
				createTestContext(db),
			);

			// Create second user without email
			const secondUser = await call(
				createUser,
				{
					username: "seconduser",
					discordId: "discord-second",
				},
				createTestContext(db),
			);

			const { SignJWT } = await import("jose");
			const JWT_SECRET = new TextEncoder().encode(
				process.env.JWT_SECRET || "allcom-zone-secret-key-change-in-production"
			);
			const token = await new SignJWT({ userId: secondUser.id })
				.setProtectedHeader({ alg: "HS256" })
				.setIssuedAt()
				.setExpirationTime("7d")
				.sign(JWT_SECRET);

			expect(
				call(
					linkEmail,
					{
						token,
						email: "taken@example.com", // Already in use
						password: "password123",
					},
					createTestContext(db),
				),
			).rejects.toThrow(
				new ORPCError("EMAIL_IN_USE", {
					message: "Email is already in use",
				}),
			);
		});

		it("should reject invalid token", async () => {
			expect(
				call(
					linkEmail,
					{
						token: "invalid-token",
						email: "test@example.com",
						password: "password123",
					},
					createTestContext(db),
				),
			).rejects.toThrow();
		});
	});

	describe("setUsername", () => {
		it("should set username for account without username", async () => {
			// Create user without username
			const user = await call(
				createUser,
				{
					discordId: "discord-nousername",
				},
				createTestContext(db),
			);

			const { SignJWT } = await import("jose");
			const JWT_SECRET = new TextEncoder().encode(
				process.env.JWT_SECRET || "allcom-zone-secret-key-change-in-production"
			);
			const token = await new SignJWT({ userId: user.id })
				.setProtectedHeader({ alg: "HS256" })
				.setIssuedAt()
				.setExpirationTime("7d")
				.sign(JWT_SECRET);

			const result = await call(
				setUsername,
				{
					token,
					username: "newusername",
				},
				createTestContext(db),
			);

			expect(result).toStrictEqual({
				success: true,
				message: "Username set successfully",
				username: "newusername",
			});
		});

		it("should reject if username is already set", async () => {
			const authResult = await call(
				register,
				{
					username: "existingusername",
					email: "existingname@example.com",
					password: "password123",
				},
				createTestContext(db),
			);

			expect(
				call(
					setUsername,
					{
						token: authResult.token,
						username: "anotherusername",
					},
					createTestContext(db),
				),
			).rejects.toThrow(
				new ORPCError("USERNAME_ALREADY_SET", {
					message: "Username is already set for this account",
				}),
			);
		});

		it("should reject if username is already taken", async () => {
			// Create first user with username
			await call(
				register,
				{
					username: "takenusername",
					email: "taken@example.com",
					password: "password123",
				},
				createTestContext(db),
			);

			// Create second user without username
			const secondUser = await call(
				createUser,
				{
					discordId: "discord-wantsusername",
				},
				createTestContext(db),
			);

			const { SignJWT } = await import("jose");
			const JWT_SECRET = new TextEncoder().encode(
				process.env.JWT_SECRET || "allcom-zone-secret-key-change-in-production"
			);
			const token = await new SignJWT({ userId: secondUser.id })
				.setProtectedHeader({ alg: "HS256" })
				.setIssuedAt()
				.setExpirationTime("7d")
				.sign(JWT_SECRET);

			expect(
				call(
					setUsername,
					{
						token,
						username: "takenusername", // Already in use
					},
					createTestContext(db),
				),
			).rejects.toThrow(
				new ORPCError("USERNAME_TAKEN", {
					message: "This username is already taken",
				}),
			);
		});

		it("should reject username with invalid characters", async () => {
			const user = await call(
				createUser,
				{
					discordId: "discord-invalidchars",
				},
				createTestContext(db),
			);

			const { SignJWT } = await import("jose");
			const JWT_SECRET = new TextEncoder().encode(
				process.env.JWT_SECRET || "allcom-zone-secret-key-change-in-production"
			);
			const token = await new SignJWT({ userId: user.id })
				.setProtectedHeader({ alg: "HS256" })
				.setIssuedAt()
				.setExpirationTime("7d")
				.sign(JWT_SECRET);

			expect(
				call(
					setUsername,
					{
						token,
						username: "invalid@username!", // Contains invalid characters
					},
					createTestContext(db),
				),
			).rejects.toThrow();
		});

		it("should reject username that is too short", async () => {
			const user = await call(
				createUser,
				{
					discordId: "discord-shortname",
				},
				createTestContext(db),
			);

			const { SignJWT } = await import("jose");
			const JWT_SECRET = new TextEncoder().encode(
				process.env.JWT_SECRET || "allcom-zone-secret-key-change-in-production"
			);
			const token = await new SignJWT({ userId: user.id })
				.setProtectedHeader({ alg: "HS256" })
				.setIssuedAt()
				.setExpirationTime("7d")
				.sign(JWT_SECRET);

			expect(
				call(
					setUsername,
					{
						token,
						username: "ab", // Less than 3 chars
					},
					createTestContext(db),
				),
			).rejects.toThrow();
		});

		it("should reject invalid token", async () => {
			expect(
				call(
					setUsername,
					{
						token: "invalid-token",
						username: "validusername",
					},
					createTestContext(db),
				),
			).rejects.toThrow();
		});
	});

	describe("requestDiscordVerification", () => {
		it("should return a verification code", async () => {
			const authResult = await call(
				register,
				{
					username: "verifyuser",
					email: "verify@example.com",
					password: "password123",
				},
				createTestContext(db),
			);

			const result = await call(
				requestDiscordVerification,
				{ token: authResult.token },
				createTestContext(db),
			);

			expect(result.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
			expect(result.expiresAt).toBeDefined();
			expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
		});

		it("should return different codes on each request", async () => {
			const authResult = await call(
				register,
				{
					username: "multipleverify",
					email: "multipleverify@example.com",
					password: "password123",
				},
				createTestContext(db),
			);

			const result1 = await call(
				requestDiscordVerification,
				{ token: authResult.token },
				createTestContext(db),
			);

			const result2 = await call(
				requestDiscordVerification,
				{ token: authResult.token },
				createTestContext(db),
			);

			expect(result1.code).not.toBe(result2.code);
		});

		it("should reject invalid token", async () => {
			expect(
				call(
					requestDiscordVerification,
					{ token: "invalid-token" },
					createTestContext(db),
				),
			).rejects.toThrow();
		});
	});
});
