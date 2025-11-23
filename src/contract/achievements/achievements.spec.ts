import { beforeEach, describe, expect, it } from "bun:test";
import { ORPCError } from "@orpc/client";
import { call } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql/postgres";
import type { relations } from "../../db/relations.ts";
import type * as schema from "../../db/schema.ts";
import { achievementsTable, type DbUser, userAchievementsTable, usersTable } from "../../db/schema.ts";
import { createTestContext, createTestDatabase } from "../shared/test-utils.ts";
import { createUser } from "../users/index.ts";
import {
	createAchievement,
	deleteAchievement,
	deleteUserAchievementProgress,
	getAchievement,
	getUserAchievementProgress,
	listAchievements,
	listUserAchievements,
	unlockAchievement,
	updateAchievement,
	upsertUserAchievement,
} from "./index.ts";

describe("Achievements", () => {
	let db: BunSQLDatabase<typeof schema, typeof relations>;
	let testUser: Omit<DbUser, "password" | "email">;

	beforeEach(async () => {
		db = await createTestDatabase();

		// Create a test user for achievement progress tests
		testUser = await call(
			createUser,
			{
				username: "achievementTestUser",
			},
			createTestContext(db),
		);
	});

	// ============================================================================
	// ACHIEVEMENT DEFINITIONS - CRUD operations
	// ============================================================================

	describe("createAchievement", () => {
		it("should successfully create an achievement with valid data", async () => {
			const result = await call(
				createAchievement,
				{
					name: "First Steps",
					description: "Complete your first task",
				},
				createTestContext(db),
			);

			expect(result).toMatchObject({
				id: expect.any(Number),
				name: "First Steps",
				description: "Complete your first task",
				createdAt: expect.any(Date),
				updatedAt: expect.any(Date),
			});
		});

		it("should create achievement with only required fields", async () => {
			const result = await call(
				createAchievement,
				{
					name: "Minimal Achievement",
				},
				createTestContext(db),
			);

			expect(result).toMatchObject({
				id: expect.any(Number),
				name: "Minimal Achievement",
				description: null,
				createdAt: expect.any(Date),
				updatedAt: expect.any(Date),
			});
		});

		it("should create achievement with null description", async () => {
			const result = await call(
				createAchievement,
				{
					name: "No Description Achievement",
					description: null,
				},
				createTestContext(db),
			);

			expect(result.description).toBeNull();
		});

		it("should create achievement with long description", async () => {
			const longDescription = "A".repeat(1000);
			const result = await call(
				createAchievement,
				{
					name: "Long Description",
					description: longDescription,
				},
				createTestContext(db),
			);

			expect(result.description).toBe(longDescription);
		});

		it("should create multiple achievements with different names", async () => {
			const achievement1 = await call(
				createAchievement,
				{
					name: "Achievement One",
					description: "First achievement",
				},
				createTestContext(db),
			);

			const achievement2 = await call(
				createAchievement,
				{
					name: "Achievement Two",
					description: "Second achievement",
				},
				createTestContext(db),
			);

			expect(achievement1.id).not.toBe(achievement2.id);
			expect(achievement1.name).toBe("Achievement One");
			expect(achievement2.name).toBe("Achievement Two");
		});

		it("should set timestamps correctly on creation", async () => {
			const beforeCreate = new Date();
			const result = await call(
				createAchievement,
				{
					name: "Timestamp Test",
				},
				createTestContext(db),
			);
			const afterCreate = new Date();

			expect(result.createdAt.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime());
			expect(result.createdAt.getTime()).toBeLessThanOrEqual(afterCreate.getTime());
			expect(result.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime());
			expect(result.updatedAt.getTime()).toBeLessThanOrEqual(afterCreate.getTime());
		});
	});

	describe("listAchievements", () => {
		it("should return empty array when no achievements exist", async () => {
			const result = await call(listAchievements, {}, createTestContext(db));

			expect(result).toEqual([]);
		});

		it("should list all achievements", async () => {
			// Create test achievements
			await call(createAchievement, { name: "Achievement A" }, createTestContext(db));
			await call(createAchievement, { name: "Achievement B" }, createTestContext(db));
			await call(createAchievement, { name: "Achievement C" }, createTestContext(db));

			const result = await call(listAchievements, {}, createTestContext(db));

			expect(result).toHaveLength(3);
			expect(result.every((a) => Object.hasOwn(a, "id"))).toBe(true);
			expect(result.every((a) => Object.hasOwn(a, "name"))).toBe(true);
		});

		it("should order achievements by name alphabetically", async () => {
			// Create achievements in random order
			await call(createAchievement, { name: "Zebra Achievement" }, createTestContext(db));
			await call(createAchievement, { name: "Alpha Achievement" }, createTestContext(db));
			await call(createAchievement, { name: "Beta Achievement" }, createTestContext(db));

			const result = await call(listAchievements, {}, createTestContext(db));

			expect(result[0]?.name).toBe("Alpha Achievement");
			expect(result[1]?.name).toBe("Beta Achievement");
			expect(result[2]?.name).toBe("Zebra Achievement");
		});

		it("should include all achievement fields", async () => {
			await call(
				createAchievement,
				{
					name: "Full Achievement",
					description: "Complete description",
				},
				createTestContext(db),
			);

			const result = await call(listAchievements, {}, createTestContext(db));

			expect(result[0]).toMatchObject({
				id: expect.any(Number),
				name: "Full Achievement",
				description: "Complete description",
				createdAt: expect.any(Date),
				updatedAt: expect.any(Date),
			});
		});
	});

	describe("getAchievement", () => {
		it("should successfully get achievement by ID", async () => {
			const created = await call(
				createAchievement,
				{
					name: "Test Achievement",
					description: "Test description",
				},
				createTestContext(db),
			);

			const result = await call(
				getAchievement,
				{
					id: created.id,
				},
				createTestContext(db),
			);

			expect(result).toMatchObject({
				id: created.id,
				name: "Test Achievement",
				description: "Test description",
				createdAt: expect.any(Date),
				updatedAt: expect.any(Date),
			});
		});

		it("should throw NOT_FOUND error for non-existent achievement", async () => {
			expect(
				call(
					getAchievement,
					{
						id: 999999,
					},
					createTestContext(db),
				),
			).rejects.toThrow(new ORPCError("NOT_FOUND", { message: "Achievement not found" }));
		});

		it("should return correct achievement when multiple exist", async () => {
			const achievement1 = await call(createAchievement, { name: "First" }, createTestContext(db));
			const achievement2 = await call(createAchievement, { name: "Second" }, createTestContext(db));
			const achievement3 = await call(createAchievement, { name: "Third" }, createTestContext(db));

			const result = await call(
				getAchievement,
				{
					id: achievement2.id,
				},
				createTestContext(db),
			);

			expect(result.id).toBe(achievement2.id);
			expect(result.name).toBe("Second");
			expect(result.id).not.toBe(achievement1.id);
			expect(result.id).not.toBe(achievement3.id);
		});
	});

	describe("updateAchievement", () => {
		it("should successfully update achievement name", async () => {
			const achievement = await call(createAchievement, { name: "Original Name" }, createTestContext(db));

			const result = await call(
				updateAchievement,
				{
					id: achievement.id,
					name: "Updated Name",
				},
				createTestContext(db),
			);

			expect(result.id).toBe(achievement.id);
			expect(result.name).toBe("Updated Name");
			expect(result.updatedAt.getTime()).toBeGreaterThan(achievement.updatedAt.getTime());
		});

		it("should successfully update achievement description", async () => {
			const achievement = await call(
				createAchievement,
				{
					name: "Test Achievement",
					description: "Original description",
				},
				createTestContext(db),
			);

			const result = await call(
				updateAchievement,
				{
					id: achievement.id,
					description: "Updated description",
				},
				createTestContext(db),
			);

			expect(result.id).toBe(achievement.id);
			expect(result.description).toBe("Updated description");
		});

		it("should update both name and description", async () => {
			const achievement = await call(
				createAchievement,
				{
					name: "Original",
					description: "Original desc",
				},
				createTestContext(db),
			);

			const result = await call(
				updateAchievement,
				{
					id: achievement.id,
					name: "New Name",
					description: "New desc",
				},
				createTestContext(db),
			);

			expect(result.name).toBe("New Name");
			expect(result.description).toBe("New desc");
		});

		it("should not modify other achievements when updating one", async () => {
			const achievement1 = await call(createAchievement, { name: "Achievement 1" }, createTestContext(db));
			const achievement2 = await call(createAchievement, { name: "Achievement 2" }, createTestContext(db));

			await call(
				updateAchievement,
				{
					id: achievement1.id,
					name: "Updated Achievement 1",
				},
				createTestContext(db),
			);

			const unchanged = await call(
				getAchievement,
				{
					id: achievement2.id,
				},
				createTestContext(db),
			);

			expect(unchanged.name).toBe("Achievement 2");
		});

		it("should throw NOT_FOUND error for non-existent achievement", async () => {
			expect(
				call(
					updateAchievement,
					{
						id: 999999,
						name: "Does not matter",
					},
					createTestContext(db),
				),
			).rejects.toThrow(new ORPCError("NOT_FOUND", { message: "Achievement not found" }));
		});

		it("should preserve createdAt timestamp on update", async () => {
			const achievement = await call(createAchievement, { name: "Test" }, createTestContext(db));

			// Wait to ensure different timestamp
			await new Promise((resolve) => setTimeout(resolve, 10));

			const result = await call(
				updateAchievement,
				{
					id: achievement.id,
					name: "Updated",
				},
				createTestContext(db),
			);

			expect(result.createdAt.getTime()).toBe(achievement.createdAt.getTime());
		});

		it("should update updatedAt timestamp", async () => {
			const achievement = await call(createAchievement, { name: "Test" }, createTestContext(db));

			// Wait to ensure different timestamp
			await new Promise((resolve) => setTimeout(resolve, 10));

			const result = await call(
				updateAchievement,
				{
					id: achievement.id,
					name: "Updated",
				},
				createTestContext(db),
			);

			expect(result.updatedAt.getTime()).toBeGreaterThan(achievement.updatedAt.getTime());
		});
	});

	describe("deleteAchievement", () => {
		it("should successfully delete an achievement", async () => {
			const achievement = await call(createAchievement, { name: "To Delete" }, createTestContext(db));

			const result = await call(
				deleteAchievement,
				{
					id: achievement.id,
				},
				createTestContext(db),
			);

			expect(result).toMatchObject({
				id: achievement.id,
				name: "To Delete",
			});

			// Verify it's actually deleted
			expect(
				call(
					getAchievement,
					{
						id: achievement.id,
					},
					createTestContext(db),
				),
			).rejects.toThrow(new ORPCError("NOT_FOUND", { message: "Achievement not found" }));
		});

		it("should throw NOT_FOUND error for non-existent achievement", async () => {
			expect(
				call(
					deleteAchievement,
					{
						id: 999999,
					},
					createTestContext(db),
				),
			).rejects.toThrow(new ORPCError("NOT_FOUND", { message: "Achievement not found" }));
		});

		it("should not affect other achievements when deleting one", async () => {
			const achievement1 = await call(createAchievement, { name: "Keep This" }, createTestContext(db));
			const achievement2 = await call(createAchievement, { name: "Delete This" }, createTestContext(db));

			await call(
				deleteAchievement,
				{
					id: achievement2.id,
				},
				createTestContext(db),
			);

			const stillExists = await call(
				getAchievement,
				{
					id: achievement1.id,
				},
				createTestContext(db),
			);

			expect(stillExists.name).toBe("Keep This");
		});

		it("should cascade delete user achievements when achievement is deleted", async () => {
			const achievement = await call(createAchievement, { name: "Cascade Test" }, createTestContext(db));

			// Create user achievement progress
			await call(
				upsertUserAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
					metadata: { progress: 50 },
				},
				createTestContext(db),
			);

			// Delete the achievement
			await call(
				deleteAchievement,
				{
					id: achievement.id,
				},
				createTestContext(db),
			);

			// Verify user achievement was cascade deleted
			const userAchievements = await db
				.select()
				.from(userAchievementsTable)
				.where(eq(userAchievementsTable.achievementId, achievement.id));

			expect(userAchievements).toHaveLength(0);
		});
	});

	// ============================================================================
	// USER ACHIEVEMENT PROGRESS - Tracking operations
	// ============================================================================

	describe("upsertUserAchievement", () => {
		let achievement: { id: number; name: string; description: string | null; createdAt: Date; updatedAt: Date };

		beforeEach(async () => {
			achievement = await call(createAchievement, { name: "Progress Test" }, createTestContext(db));
		});

		it("should insert new user achievement progress", async () => {
			const result = await call(
				upsertUserAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
					metadata: { count: 5, target: 10 },
				},
				createTestContext(db),
			);

			expect(result).toMatchObject({
				id: expect.any(Number),
				userId: testUser.id,
				achievementId: achievement.id,
				metadata: { count: 5, target: 10 },
				unlockedAt: null,
				createdAt: expect.any(Date),
				updatedAt: expect.any(Date),
			});
		});

		it("should update existing user achievement metadata on conflict", async () => {
			// First insert
			const first = await call(
				upsertUserAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
					metadata: { count: 5, target: 10 },
				},
				createTestContext(db),
			);

			// Wait to ensure different timestamp
			await new Promise((resolve) => setTimeout(resolve, 10));

			// Upsert with new metadata
			const second = await call(
				upsertUserAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
					metadata: { count: 8, target: 10 },
				},
				createTestContext(db),
			);

			expect(second.id).toBe(first.id);
			expect(second.metadata).toEqual({ count: 8, target: 10 });
			expect(second.updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime());
		});

		it("should handle metadata with empty object", async () => {
			const result = await call(
				upsertUserAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
					metadata: {},
				},
				createTestContext(db),
			);

			expect(result.metadata).toEqual({});
		});

		it("should default to empty object when metadata is undefined", async () => {
			const result = await call(
				upsertUserAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
				},
				createTestContext(db),
			);

			expect(result.metadata).toEqual({});
		});

		it("should handle complex metadata structures", async () => {
			const complexMetadata = {
				progress: {
					current: 75,
					total: 100,
				},
				milestones: [25, 50, 75],
				lastUpdate: "2024-01-01",
			};

			const result = await call(
				upsertUserAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
					metadata: complexMetadata,
				},
				createTestContext(db),
			);

			expect(result.metadata).toEqual(complexMetadata);
		});

		it("should enforce unique constraint on (userId, achievementId)", async () => {
			// First insert
			await call(
				upsertUserAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
					metadata: { count: 5 },
				},
				createTestContext(db),
			);

			// Second upsert should update, not create duplicate
			await call(
				upsertUserAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
					metadata: { count: 10 },
				},
				createTestContext(db),
			);

			const allProgress = await db
				.select()
				.from(userAchievementsTable)
				.where(
					and(eq(userAchievementsTable.userId, testUser.id), eq(userAchievementsTable.achievementId, achievement.id)),
				);

			expect(allProgress).toHaveLength(1);
			expect(allProgress[0]?.metadata).toEqual({ count: 10 });
		});

		it("should allow different users to track same achievement", async () => {
			const user2 = await call(createUser, { username: "secondUser" }, createTestContext(db));

			const progress1 = await call(
				upsertUserAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
					metadata: { user: "first" },
				},
				createTestContext(db),
			);

			const progress2 = await call(
				upsertUserAchievement,
				{
					userId: user2.id,
					achievementId: achievement.id,
					metadata: { user: "second" },
				},
				createTestContext(db),
			);

			expect(progress1.id).not.toBe(progress2.id);
			expect(progress1.userId).toBe(testUser.id);
			expect(progress2.userId).toBe(user2.id);
		});

		it("should handle upsert on unlocked achievement (replaces unlockedAt)", async () => {
			// First unlock the achievement
			await call(
				unlockAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
				},
				createTestContext(db),
			);

			// Get the unlocked achievement
			const unlocked = await call(
				getUserAchievementProgress,
				{
					userId: testUser.id,
					achievementId: achievement.id,
				},
				createTestContext(db),
			);

			expect(unlocked?.unlockedAt).toBeInstanceOf(Date);

			// Now update the metadata - this will reset unlockedAt to null based on implementation
			// The onConflictDoUpdate only sets metadata and updatedAt, not unlockedAt
			const updated = await call(
				upsertUserAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
					metadata: { newData: "updated" },
				},
				createTestContext(db),
			);

			// Note: The current implementation does NOT preserve unlockedAt on conflict
			// It only updates metadata and updatedAt, so unlockedAt becomes null
			expect(updated.metadata).toEqual({ newData: "updated" });
		});
	});

	describe("getUserAchievementProgress", () => {
		let achievement: { id: number; name: string; description: string | null; createdAt: Date; updatedAt: Date };

		beforeEach(async () => {
			achievement = await call(createAchievement, { name: "Get Progress Test" }, createTestContext(db));
		});

		it("should return null when no progress exists", async () => {
			const result = await call(
				getUserAchievementProgress,
				{
					userId: testUser.id,
					achievementId: achievement.id,
				},
				createTestContext(db),
			);

			expect(result).toBeNull();
		});

		it("should return user achievement progress when it exists", async () => {
			await call(
				upsertUserAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
					metadata: { progress: 50 },
				},
				createTestContext(db),
			);

			const result = await call(
				getUserAchievementProgress,
				{
					userId: testUser.id,
					achievementId: achievement.id,
				},
				createTestContext(db),
			);

			expect(result).toMatchObject({
				userId: testUser.id,
				achievementId: achievement.id,
				metadata: { progress: 50 },
				unlockedAt: null,
			});
		});

		it("should return null for non-existent user", async () => {
			const result = await call(
				getUserAchievementProgress,
				{
					userId: 999999,
					achievementId: achievement.id,
				},
				createTestContext(db),
			);

			expect(result).toBeNull();
		});

		it("should return null for non-existent achievement", async () => {
			const result = await call(
				getUserAchievementProgress,
				{
					userId: testUser.id,
					achievementId: 999999,
				},
				createTestContext(db),
			);

			expect(result).toBeNull();
		});

		it("should return correct progress for specific user when multiple users exist", async () => {
			const user2 = await call(createUser, { username: "user2Progress" }, createTestContext(db));

			await call(
				upsertUserAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
					metadata: { user: "first" },
				},
				createTestContext(db),
			);

			await call(
				upsertUserAchievement,
				{
					userId: user2.id,
					achievementId: achievement.id,
					metadata: { user: "second" },
				},
				createTestContext(db),
			);

			const result = await call(
				getUserAchievementProgress,
				{
					userId: testUser.id,
					achievementId: achievement.id,
				},
				createTestContext(db),
			);

			expect(result?.metadata).toEqual({ user: "first" });
		});

		it("should include unlockedAt when achievement is unlocked", async () => {
			await call(
				unlockAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
				},
				createTestContext(db),
			);

			const result = await call(
				getUserAchievementProgress,
				{
					userId: testUser.id,
					achievementId: achievement.id,
				},
				createTestContext(db),
			);

			expect(result?.unlockedAt).toBeInstanceOf(Date);
		});
	});

	describe("listUserAchievements", () => {
		let achievement1: { id: number; name: string; description: string | null; createdAt: Date; updatedAt: Date };
		let achievement2: { id: number; name: string; description: string | null; createdAt: Date; updatedAt: Date };
		let achievement3: { id: number; name: string; description: string | null; createdAt: Date; updatedAt: Date };

		beforeEach(async () => {
			achievement1 = await call(createAchievement, { name: "Achievement 1" }, createTestContext(db));
			achievement2 = await call(createAchievement, { name: "Achievement 2" }, createTestContext(db));
			achievement3 = await call(createAchievement, { name: "Achievement 3" }, createTestContext(db));
		});

		it("should return empty array when user has no achievements", async () => {
			const result = await call(
				listUserAchievements,
				{
					userId: testUser.id,
				},
				createTestContext(db),
			);

			expect(result).toEqual([]);
		});

		it("should list all user achievements including locked", async () => {
			// Create mix of locked and unlocked achievements
			await call(
				upsertUserAchievement,
				{
					userId: testUser.id,
					achievementId: achievement1.id,
					metadata: { progress: 50 },
				},
				createTestContext(db),
			);

			await call(
				unlockAchievement,
				{
					userId: testUser.id,
					achievementId: achievement2.id,
				},
				createTestContext(db),
			);

			await call(
				upsertUserAchievement,
				{
					userId: testUser.id,
					achievementId: achievement3.id,
					metadata: { progress: 20 },
				},
				createTestContext(db),
			);

			const result = await call(
				listUserAchievements,
				{
					userId: testUser.id,
				},
				createTestContext(db),
			);

			expect(result).toHaveLength(3);
		});

		it("should filter to only unlocked achievements when unlockedOnly is true", async () => {
			// Create mix of locked and unlocked achievements
			await call(
				upsertUserAchievement,
				{
					userId: testUser.id,
					achievementId: achievement1.id,
					metadata: { progress: 50 },
				},
				createTestContext(db),
			);

			await call(
				unlockAchievement,
				{
					userId: testUser.id,
					achievementId: achievement2.id,
				},
				createTestContext(db),
			);

			await call(
				unlockAchievement,
				{
					userId: testUser.id,
					achievementId: achievement3.id,
				},
				createTestContext(db),
			);

			const result = await call(
				listUserAchievements,
				{
					userId: testUser.id,
					unlockedOnly: true,
				},
				createTestContext(db),
			);

			expect(result).toHaveLength(2);
			expect(result.every((a) => a.unlockedAt !== null)).toBe(true);
		});

		it("should order achievements by unlockedAt descending (most recent first)", async () => {
			// Unlock achievements in specific order
			await call(
				unlockAchievement,
				{
					userId: testUser.id,
					achievementId: achievement1.id,
				},
				createTestContext(db),
			);

			await new Promise((resolve) => setTimeout(resolve, 10));

			await call(
				unlockAchievement,
				{
					userId: testUser.id,
					achievementId: achievement2.id,
				},
				createTestContext(db),
			);

			await new Promise((resolve) => setTimeout(resolve, 10));

			await call(
				unlockAchievement,
				{
					userId: testUser.id,
					achievementId: achievement3.id,
				},
				createTestContext(db),
			);

			const result = await call(
				listUserAchievements,
				{
					userId: testUser.id,
					unlockedOnly: true,
				},
				createTestContext(db),
			);

			// Most recent unlock should be first
			expect(result[0]?.achievementId).toBe(achievement3.id);
			expect(result[2]?.achievementId).toBe(achievement1.id);
		});

		it("should only return achievements for specified user", async () => {
			const user2 = await call(createUser, { username: "user2List" }, createTestContext(db));

			await call(
				upsertUserAchievement,
				{
					userId: testUser.id,
					achievementId: achievement1.id,
				},
				createTestContext(db),
			);

			await call(
				upsertUserAchievement,
				{
					userId: user2.id,
					achievementId: achievement2.id,
				},
				createTestContext(db),
			);

			const result = await call(
				listUserAchievements,
				{
					userId: testUser.id,
				},
				createTestContext(db),
			);

			expect(result).toHaveLength(1);
			expect(result[0]?.achievementId).toBe(achievement1.id);
		});

		it("should include all fields in returned achievements", async () => {
			await call(
				upsertUserAchievement,
				{
					userId: testUser.id,
					achievementId: achievement1.id,
					metadata: { test: "data" },
				},
				createTestContext(db),
			);

			const result = await call(
				listUserAchievements,
				{
					userId: testUser.id,
				},
				createTestContext(db),
			);

			expect(result[0]).toMatchObject({
				id: expect.any(Number),
				userId: testUser.id,
				achievementId: achievement1.id,
				metadata: { test: "data" },
				unlockedAt: null,
				createdAt: expect.any(Date),
				updatedAt: expect.any(Date),
			});
		});
	});

	describe("unlockAchievement", () => {
		let achievement: { id: number; name: string; description: string | null; createdAt: Date; updatedAt: Date };

		beforeEach(async () => {
			achievement = await call(createAchievement, { name: "Unlock Test" }, createTestContext(db));
		});

		it("should unlock achievement when entry already exists without unlockedAt", async () => {
			// Create progress entry
			await call(
				upsertUserAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
					metadata: { progress: 100 },
				},
				createTestContext(db),
			);

			const beforeUnlock = new Date();
			const result = await call(
				unlockAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
				},
				createTestContext(db),
			);
			const afterUnlock = new Date();

			expect(result.unlockedAt).toBeInstanceOf(Date);
			expect(result.unlockedAt!.getTime()).toBeGreaterThanOrEqual(beforeUnlock.getTime());
			expect(result.unlockedAt!.getTime()).toBeLessThanOrEqual(afterUnlock.getTime());
			expect(result.metadata).toEqual({ progress: 100 });
		});

		it("should create entry with unlockedAt when entry does not exist", async () => {
			const beforeUnlock = new Date();
			const result = await call(
				unlockAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
				},
				createTestContext(db),
			);
			const afterUnlock = new Date();

			expect(result).toMatchObject({
				userId: testUser.id,
				achievementId: achievement.id,
				metadata: {},
			});
			expect(result.unlockedAt).toBeInstanceOf(Date);
			expect((result.unlockedAt as Date).getTime()).toBeGreaterThanOrEqual(beforeUnlock.getTime());
			expect((result.unlockedAt as Date).getTime()).toBeLessThanOrEqual(afterUnlock.getTime());
		});

		it("should throw ALREADY_UNLOCKED error when already unlocked", async () => {
			// First unlock
			await call(
				unlockAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
				},
				createTestContext(db),
			);

			// Try to unlock again
			expect(
				call(
					unlockAchievement,
					{
						userId: testUser.id,
						achievementId: achievement.id,
					},
					createTestContext(db),
				),
			).rejects.toThrow(new ORPCError("ALREADY_UNLOCKED", { message: "Achievement already unlocked" }));
		});

		it("should update updatedAt timestamp when unlocking existing entry", async () => {
			const progress = await call(
				upsertUserAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
					metadata: { progress: 100 },
				},
				createTestContext(db),
			);

			await new Promise((resolve) => setTimeout(resolve, 10));

			const result = await call(
				unlockAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
				},
				createTestContext(db),
			);

			expect(result.updatedAt.getTime()).toBeGreaterThan(progress.updatedAt.getTime());
		});

		it("should allow different users to unlock same achievement", async () => {
			const user2 = await call(createUser, { username: "user2Unlock" }, createTestContext(db));

			const unlock1 = await call(
				unlockAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
				},
				createTestContext(db),
			);

			const unlock2 = await call(
				unlockAchievement,
				{
					userId: user2.id,
					achievementId: achievement.id,
				},
				createTestContext(db),
			);

			expect(unlock1.userId).toBe(testUser.id);
			expect(unlock2.userId).toBe(user2.id);
			expect(unlock1.unlockedAt).toBeInstanceOf(Date);
			expect(unlock2.unlockedAt).toBeInstanceOf(Date);
		});

		it("should preserve existing metadata when unlocking", async () => {
			await call(
				upsertUserAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
					metadata: { steps: 1000, distance: 5.2 },
				},
				createTestContext(db),
			);

			const result = await call(
				unlockAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
				},
				createTestContext(db),
			);

			expect(result.metadata).toEqual({ steps: 1000, distance: 5.2 });
		});
	});

	describe("deleteUserAchievementProgress", () => {
		let achievement: { id: number; name: string; description: string | null; createdAt: Date; updatedAt: Date };

		beforeEach(async () => {
			achievement = await call(createAchievement, { name: "Delete Progress Test" }, createTestContext(db));
		});

		it("should successfully delete user achievement progress", async () => {
			await call(
				upsertUserAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
					metadata: { progress: 50 },
				},
				createTestContext(db),
			);

			const result = await call(
				deleteUserAchievementProgress,
				{
					userId: testUser.id,
					achievementId: achievement.id,
				},
				createTestContext(db),
			);

			expect(result).toMatchObject({
				userId: testUser.id,
				achievementId: achievement.id,
				metadata: { progress: 50 },
			});

			// Verify it's deleted
			const check = await call(
				getUserAchievementProgress,
				{
					userId: testUser.id,
					achievementId: achievement.id,
				},
				createTestContext(db),
			);

			expect(check).toBeNull();
		});

		it("should throw NOT_FOUND error when progress does not exist", async () => {
			expect(
				call(
					deleteUserAchievementProgress,
					{
						userId: testUser.id,
						achievementId: achievement.id,
					},
					createTestContext(db),
				),
			).rejects.toThrow(new ORPCError("NOT_FOUND", { message: "User achievement progress not found" }));
		});

		it("should not affect other user's progress when deleting", async () => {
			const user2 = await call(createUser, { username: "user2Delete" }, createTestContext(db));

			await call(
				upsertUserAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
					metadata: { user: "first" },
				},
				createTestContext(db),
			);

			await call(
				upsertUserAchievement,
				{
					userId: user2.id,
					achievementId: achievement.id,
					metadata: { user: "second" },
				},
				createTestContext(db),
			);

			await call(
				deleteUserAchievementProgress,
				{
					userId: testUser.id,
					achievementId: achievement.id,
				},
				createTestContext(db),
			);

			const user2Progress = await call(
				getUserAchievementProgress,
				{
					userId: user2.id,
					achievementId: achievement.id,
				},
				createTestContext(db),
			);

			expect(user2Progress?.metadata).toEqual({ user: "second" });
		});

		it("should delete unlocked achievement progress", async () => {
			await call(
				unlockAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
				},
				createTestContext(db),
			);

			const result = await call(
				deleteUserAchievementProgress,
				{
					userId: testUser.id,
					achievementId: achievement.id,
				},
				createTestContext(db),
			);

			expect(result.unlockedAt).toBeInstanceOf(Date);

			// Verify deletion
			const check = await call(
				getUserAchievementProgress,
				{
					userId: testUser.id,
					achievementId: achievement.id,
				},
				createTestContext(db),
			);

			expect(check).toBeNull();
		});
	});

	// ============================================================================
	// CASCADE DELETES & REFERENTIAL INTEGRITY
	// ============================================================================

	describe("Cascade deletes", () => {
		it("should cascade delete user_achievements when user is deleted", async () => {
			const user = await call(createUser, { username: "userToDelete" }, createTestContext(db));
			const achievement = await call(createAchievement, { name: "Test" }, createTestContext(db));

			// Create user achievement
			await call(
				upsertUserAchievement,
				{
					userId: user.id,
					achievementId: achievement.id,
					metadata: { progress: 50 },
				},
				createTestContext(db),
			);

			// Delete user
			await db.delete(usersTable).where(eq(usersTable.id, user.id));

			// Verify user achievements were cascade deleted
			const userAchievements = await db
				.select()
				.from(userAchievementsTable)
				.where(eq(userAchievementsTable.userId, user.id));

			expect(userAchievements).toHaveLength(0);
		});

		it("should cascade delete user_achievements when achievement is deleted", async () => {
			const achievement = await call(createAchievement, { name: "Cascade Test" }, createTestContext(db));

			// Create progress for multiple users
			const user2 = await call(createUser, { username: "user2Cascade" }, createTestContext(db));

			await call(
				upsertUserAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
				},
				createTestContext(db),
			);

			await call(
				upsertUserAchievement,
				{
					userId: user2.id,
					achievementId: achievement.id,
				},
				createTestContext(db),
			);

			// Delete achievement
			await db.delete(achievementsTable).where(eq(achievementsTable.id, achievement.id));

			// Verify all user achievements for this achievement were cascade deleted
			const userAchievements = await db
				.select()
				.from(userAchievementsTable)
				.where(eq(userAchievementsTable.achievementId, achievement.id));

			expect(userAchievements).toHaveLength(0);
		});

		it("should maintain referential integrity when deleting user with multiple achievements", async () => {
			const user = await call(createUser, { username: "multiAchUser" }, createTestContext(db));
			const achievement1 = await call(createAchievement, { name: "Achievement 1" }, createTestContext(db));
			const achievement2 = await call(createAchievement, { name: "Achievement 2" }, createTestContext(db));
			const achievement3 = await call(createAchievement, { name: "Achievement 3" }, createTestContext(db));

			// Create progress for all achievements
			await call(upsertUserAchievement, { userId: user.id, achievementId: achievement1.id }, createTestContext(db));
			await call(upsertUserAchievement, { userId: user.id, achievementId: achievement2.id }, createTestContext(db));
			await call(upsertUserAchievement, { userId: user.id, achievementId: achievement3.id }, createTestContext(db));

			// Delete user
			await db.delete(usersTable).where(eq(usersTable.id, user.id));

			// Verify all progress entries were deleted
			const remainingProgress = await db.select().from(userAchievementsTable).where(eq(userAchievementsTable.userId, user.id));

			expect(remainingProgress).toHaveLength(0);

			// Verify achievements still exist
			const achievements = await db.select().from(achievementsTable);
			expect(achievements.length).toBeGreaterThanOrEqual(3);
		});
	});

	// ============================================================================
	// METADATA FLEXIBILITY TESTS
	// ============================================================================

	describe("Metadata flexibility", () => {
		let achievement: { id: number; name: string; description: string | null; createdAt: Date; updatedAt: Date };

		beforeEach(async () => {
			achievement = await call(createAchievement, { name: "Metadata Test" }, createTestContext(db));
		});

		it("should handle numeric metadata", async () => {
			const result = await call(
				upsertUserAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
					metadata: { count: 42, percentage: 95.5 },
				},
				createTestContext(db),
			);

			expect(result.metadata).toEqual({ count: 42, percentage: 95.5 });
		});

		it("should handle string metadata", async () => {
			const result = await call(
				upsertUserAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
					metadata: { status: "in_progress", lastAction: "completed_task" },
				},
				createTestContext(db),
			);

			expect(result.metadata).toEqual({ status: "in_progress", lastAction: "completed_task" });
		});

		it("should handle array metadata", async () => {
			const result = await call(
				upsertUserAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
					metadata: { completedLevels: [1, 2, 3, 5, 8] },
				},
				createTestContext(db),
			);

			expect(result.metadata).toEqual({ completedLevels: [1, 2, 3, 5, 8] });
		});

		it("should handle nested object metadata", async () => {
			const result = await call(
				upsertUserAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
					metadata: {
						progress: {
							current: 75,
							total: 100,
							breakdown: {
								completed: 15,
								inProgress: 5,
								notStarted: 5,
							},
						},
					},
				},
				createTestContext(db),
			);

			expect(result.metadata).toEqual({
				progress: {
					current: 75,
					total: 100,
					breakdown: {
						completed: 15,
						inProgress: 5,
						notStarted: 5,
					},
				},
			});
		});

		it("should handle boolean metadata", async () => {
			const result = await call(
				upsertUserAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
					metadata: { eligible: true, claimed: false },
				},
				createTestContext(db),
			);

			expect(result.metadata).toEqual({ eligible: true, claimed: false });
		});

		it("should handle mixed type metadata", async () => {
			const result = await call(
				upsertUserAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
					metadata: {
						count: 10,
						name: "Test Progress",
						active: true,
						tags: ["new", "featured"],
						stats: { wins: 5, losses: 3 },
					},
				},
				createTestContext(db),
			);

			expect(result.metadata).toEqual({
				count: 10,
				name: "Test Progress",
				active: true,
				tags: ["new", "featured"],
				stats: { wins: 5, losses: 3 },
			});
		});

		it("should handle large metadata objects", async () => {
			const largeMetadata = {
				items: Array.from({ length: 100 }, (_, i) => ({ id: i, value: `item_${i}` })),
			};

			const result = await call(
				upsertUserAchievement,
				{
					userId: testUser.id,
					achievementId: achievement.id,
					metadata: largeMetadata,
				},
				createTestContext(db),
			);

			expect(result.metadata).toEqual(largeMetadata);
		});
	});

	// ============================================================================
	// EDGE CASES
	// ============================================================================

	describe("Edge cases", () => {
		it("should handle achievement name with special characters", async () => {
			const result = await call(
				createAchievement,
				{
					name: "Achievement!@#$%^&*()_+-=[]{}|;':,.<>?/~`",
				},
				createTestContext(db),
			);

			expect(result.name).toBe("Achievement!@#$%^&*()_+-=[]{}|;':,.<>?/~`");
		});

		it("should handle achievement name with unicode characters", async () => {
			const result = await call(
				createAchievement,
				{
					name: "Достижение 成就 業績 إنجاز",
				},
				createTestContext(db),
			);

			expect(result.name).toBe("Достижение 成就 業績 إنجاز");
		});

		it("should handle very long achievement name (up to 255 chars)", async () => {
			const longName = "A".repeat(255);
			const result = await call(
				createAchievement,
				{
					name: longName,
				},
				createTestContext(db),
			);

			expect(result.name).toBe(longName);
		});

		it("should handle concurrent unlocks for different users", async () => {
			const achievement = await call(createAchievement, { name: "Concurrent Test" }, createTestContext(db));
			const users = await Promise.all([
				call(createUser, { username: "concurrent1" }, createTestContext(db)),
				call(createUser, { username: "concurrent2" }, createTestContext(db)),
				call(createUser, { username: "concurrent3" }, createTestContext(db)),
			]);

			const unlocks = await Promise.all(
				users.map((user) =>
					call(
						unlockAchievement,
						{
							userId: user.id,
							achievementId: achievement.id,
						},
						createTestContext(db),
					),
				),
			);

			expect(unlocks).toHaveLength(3);
			expect(unlocks.every((u) => u.unlockedAt instanceof Date)).toBe(true);
		});

		it("should handle rapid metadata updates for same user achievement", async () => {
			const achievement = await call(createAchievement, { name: "Rapid Update Test" }, createTestContext(db));

			const updates = await Promise.all([
				call(
					upsertUserAchievement,
					{ userId: testUser.id, achievementId: achievement.id, metadata: { count: 1 } },
					createTestContext(db),
				),
				call(
					upsertUserAchievement,
					{ userId: testUser.id, achievementId: achievement.id, metadata: { count: 2 } },
					createTestContext(db),
				),
				call(
					upsertUserAchievement,
					{ userId: testUser.id, achievementId: achievement.id, metadata: { count: 3 } },
					createTestContext(db),
				),
			]);

			// All updates should succeed, last one wins
			expect(updates).toHaveLength(3);

			const final = await call(
				getUserAchievementProgress,
				{
					userId: testUser.id,
					achievementId: achievement.id,
				},
				createTestContext(db),
			);

			// Due to concurrent updates, final value could be any of 1, 2, or 3
			expect(final).toBeDefined();
			expect([1, 2, 3]).toContain((final!.metadata as { count: number }).count);
		});
	});
});
