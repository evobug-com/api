import { beforeEach, describe, expect, it } from "bun:test";
import { ORPCError } from "@orpc/client";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../../db/schema.ts";
import { userStatsTable, usersTable } from "../../db/schema.ts";
import { createTestContext, createTestDatabase } from "../shared/test-utils.ts";
import { createUser, updateUser } from "./index.ts";

describe("Users", () => {
	let db: NodePgDatabase<typeof schema>;

	beforeEach(async () => {
		db = await createTestDatabase();
	});

	describe("create", () => {
		it("should be able to create a user", async () => {
			const user = await call(
				createUser,
				{
					username: "testuser",
				},
				createTestContext(db),
			);

			expect(user).toStrictEqual({
				id: expect.any(Number),
				updatedAt: expect.any(Date),
				createdAt: expect.any(Date),
				discordId: null,
				guildedId: null,
				email: null,
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
				lastDailyAt: null,
				workCount: 0,
				lastWorkAt: null,
				messagesCount: 0,
				lastMessageAt: null,
				serverTagStreak: 0,
				maxServerTagStreak: 0,
				lastServerTagCheck: null,
				serverTagBadge: null,
				boostCount: 0,
				boostExpires: null,
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
			await expect(
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

			const result = await call(
				updateUser,
				{
					id: user.id,
					username: "anothertester",
					discordId: "some-discord-id",
				},
				createTestContext(db),
			);

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
			await expect(
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
			await expect(
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
			const result = await call(
				updateUser,
				{
					id: user.id,
					username: "sameusernametest", // Same username
					email: "newemail@example.com",
				},
				createTestContext(db),
			);

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

			expect(userWithEmail.email).toBe("test@example.com");
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
			expect(fullUser.email).toBe("full@example.com");
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

			await expect(
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

			await expect(
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
			expect(stats[0]?.lastDailyAt).toBeNull();
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

			await expect(
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

			const result = await call(
				updateUser,
				{
					id: testUser.id,
					username: "updatedtimestamp",
				},
				createTestContext(db),
			);

			expect(result.createdAt).toEqual(originalCreatedAt);
			expect(result.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
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
	let _db: NodePgDatabase<typeof schema>;

	beforeEach(async () => {
		_db = await createTestDatabase();
	});

	// Add tests for any user retrieval functions if they exist
	// For example: getUser, getUserById, getUserByDiscordId, etc.
});
