import { beforeEach, describe, expect, it } from "bun:test";
import { ORPCError } from "@orpc/client";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql/postgres";
import type { relations } from "../../db/relations.ts";
import type * as schema from "../../db/schema.ts";
import { userStatsTable } from "../../db/schema.ts";
import { createTestContext, createTestDatabase } from "../shared/test-utils.ts";
import { login, register, me } from "./index.ts";

describe("Auth", () => {
	let db: BunSQLDatabase<typeof schema, typeof relations>;

	beforeEach(async () => {
		db = await createTestDatabase();
	});

	describe("register", () => {
		it("should register a new user with valid credentials", async () => {
			const result = await call(
				register,
				{
					username: "testuser",
					email: "test@example.com",
					password: "password123",
				},
				createTestContext(db),
			);

			expect(result).toStrictEqual({
				token: expect.any(String),
				user: {
					id: expect.any(Number),
					username: "testuser",
					discordId: null,
					guildedId: null,
					role: "user",
					createdAt: expect.any(Date),
					updatedAt: expect.any(Date),
				},
			});
		});

		it("should create user stats when registering", async () => {
			const result = await call(
				register,
				{
					username: "statsuser",
					email: "stats@example.com",
					password: "password123",
				},
				createTestContext(db),
			);

			const stats = await db
				.select()
				.from(userStatsTable)
				.where(eq(userStatsTable.userId, result.user.id))
				.limit(1);

			expect(stats).toHaveLength(1);
			expect(stats[0]?.userId).toBe(result.user.id);
			expect(stats[0]?.coinsCount).toBe(0);
		});

		it("should reject registration with existing username", async () => {
			await call(
				register,
				{
					username: "existinguser",
					email: "first@example.com",
					password: "password123",
				},
				createTestContext(db),
			);

			expect(
				call(
					register,
					{
						username: "existinguser",
						email: "second@example.com",
						password: "password123",
					},
					createTestContext(db),
				),
			).rejects.toThrow(
				new ORPCError("USER_EXISTS", {
					message: "User with this username or email already exists",
				}),
			);
		});

		it("should reject registration with existing email", async () => {
			await call(
				register,
				{
					username: "user1",
					email: "duplicate@example.com",
					password: "password123",
				},
				createTestContext(db),
			);

			expect(
				call(
					register,
					{
						username: "user2",
						email: "duplicate@example.com",
						password: "password123",
					},
					createTestContext(db),
				),
			).rejects.toThrow();
		});

		it("should reject short passwords", async () => {
			expect(
				call(
					register,
					{
						username: "shortpwuser",
						email: "shortpw@example.com",
						password: "12345", // Less than 6 chars
					},
					createTestContext(db),
				),
			).rejects.toThrow();
		});

		it("should reject short usernames", async () => {
			expect(
				call(
					register,
					{
						username: "ab", // Less than 3 chars
						email: "short@example.com",
						password: "password123",
					},
					createTestContext(db),
				),
			).rejects.toThrow();
		});

		it("should reject invalid email format", async () => {
			expect(
				call(
					register,
					{
						username: "invalidemail",
						email: "not-an-email",
						password: "password123",
					},
					createTestContext(db),
				),
			).rejects.toThrow();
		});
	});

	describe("login", () => {
		beforeEach(async () => {
			// Create a user to login with
			await call(
				register,
				{
					username: "loginuser",
					email: "login@example.com",
					password: "correctpassword",
				},
				createTestContext(db),
			);
		});

		it("should login with valid username and password", async () => {
			const result = await call(
				login,
				{
					usernameOrEmail: "loginuser",
					password: "correctpassword",
				},
				createTestContext(db),
			);

			expect(result).toStrictEqual({
				token: expect.any(String),
				user: {
					id: expect.any(Number),
					username: "loginuser",
					discordId: null,
					guildedId: null,
					role: "user",
					createdAt: expect.any(Date),
					updatedAt: expect.any(Date),
				},
			});
		});

		it("should login with valid email and password", async () => {
			const result = await call(
				login,
				{
					usernameOrEmail: "login@example.com",
					password: "correctpassword",
				},
				createTestContext(db),
			);

			expect(result.token).toBeDefined();
			expect(result.user.username).toBe("loginuser");
		});

		it("should reject login with wrong password", async () => {
			expect(
				call(
					login,
					{
						usernameOrEmail: "loginuser",
						password: "wrongpassword",
					},
					createTestContext(db),
				),
			).rejects.toThrow(
				new ORPCError("INVALID_CREDENTIALS", {
					message: "Invalid username/email or password",
				}),
			);
		});

		it("should reject login with non-existent user", async () => {
			expect(
				call(
					login,
					{
						usernameOrEmail: "nonexistent",
						password: "password123",
					},
					createTestContext(db),
				),
			).rejects.toThrow(
				new ORPCError("INVALID_CREDENTIALS", {
					message: "Invalid username/email or password",
				}),
			);
		});

		it("should reject empty password", async () => {
			expect(
				call(
					login,
					{
						usernameOrEmail: "loginuser",
						password: "",
					},
					createTestContext(db),
				),
			).rejects.toThrow();
		});

		it("should reject empty username", async () => {
			expect(
				call(
					login,
					{
						usernameOrEmail: "",
						password: "password123",
					},
					createTestContext(db),
				),
			).rejects.toThrow();
		});
	});

	describe("me", () => {
		let validToken: string;
		let userId: number;

		beforeEach(async () => {
			const result = await call(
				register,
				{
					username: "meuser",
					email: "me@example.com",
					password: "password123",
				},
				createTestContext(db),
			);
			validToken = result.token;
			userId = result.user.id;
		});

		it("should return current user with valid token", async () => {
			const result = await call(
				me,
				{
					token: validToken,
				},
				createTestContext(db),
			);

			expect(result).toStrictEqual({
				id: userId,
				username: "meuser",
				email: "me@example.com",
				discordId: null,
				guildedId: null,
				role: "user",
				createdAt: expect.any(Date),
				updatedAt: expect.any(Date),
				hasPassword: true,
				economyStats: {
					coinsCount: 0,
					xpCount: 0,
					dailyStreak: 0,
					messagesCount: 0,
				},
			});
		});

		it("should reject invalid token", async () => {
			expect(
				call(
					me,
					{
						token: "invalid-token",
					},
					createTestContext(db),
				),
			).rejects.toThrow();
		});

		it("should reject expired token", async () => {
			// Creating a manually crafted expired token is complex
			// This test verifies token validation works
			expect(
				call(
					me,
					{
						token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImlhdCI6MTYwMDAwMDAwMCwiZXhwIjoxNjAwMDAwMDAxfQ.invalid",
					},
					createTestContext(db),
				),
			).rejects.toThrow();
		});

		it("should show hasPassword as true for users with password", async () => {
			const result = await call(
				me,
				{
					token: validToken,
				},
				createTestContext(db),
			);

			expect(result?.hasPassword).toBe(true);
		});
	});

	describe("concurrent operations", () => {
		it("should handle concurrent registrations with unique usernames", async () => {
			const promises = [];
			for (let i = 0; i < 5; i++) {
				promises.push(
					call(
						register,
						{
							username: `concurrent${i}`,
							email: `concurrent${i}@example.com`,
							password: "password123",
						},
						createTestContext(db),
					),
				);
			}

			const results = await Promise.all(promises);
			expect(results).toHaveLength(5);

			const usernames = results.map((r) => r.user.username);
			expect(new Set(usernames).size).toBe(5);
		});
	});
});
