import { beforeEach, describe, expect, it } from "bun:test";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { relations } from "../../db/relations.ts";
import type * as schema from "../../db/schema.ts";
import { userStatsTable } from "../../db/schema.ts";
import { createTestContext, createTestDatabase } from "../shared/test-utils.ts";
import { createUser } from "../users/index.ts";
import { checkMessageMilestone } from "./index.ts";

describe("checkMessageMilestone API", () => {
	let db: BunSQLDatabase<typeof schema, typeof relations>;
	let testUserId: number;

	beforeEach(async () => {
		db = await createTestDatabase();
		const user = await call(
			createUser,
			{
				username: "testuser",
				discordId: "123456789",
			},
			createTestContext(db),
		);
		testUserId = user.id;
	});

	it("should increment message count", async () => {
		const result = await call(checkMessageMilestone, { userId: testUserId }, createTestContext(db));

		expect(result.updatedStats.messagesCount).toBe(1);
		expect(result.rewardEarned).toBe(false);
	});

	it("should reward at 100 messages milestone", async () => {
		// Set to 99 messages
		await db.update(userStatsTable).set({ messagesCount: 99 }).where(eq(userStatsTable.userId, testUserId));

		const result = await call(checkMessageMilestone, { userId: testUserId }, createTestContext(db));

		expect(result.updatedStats.messagesCount).toBe(100);
		expect(result.rewardEarned).toBe(true);
		expect(result.milestoneReached).toBe(100);
		expect(result.claimStats.earnedTotalCoins).toBe(1000);
		expect(result.claimStats.earnedTotalXp).toBe(500);
	});

	it("should apply correct multipliers for higher milestones", async () => {
		// Test 1000 milestone (1x multiplier)
		await db.update(userStatsTable).set({ messagesCount: 999 }).where(eq(userStatsTable.userId, testUserId));

		const result = await call(checkMessageMilestone, { userId: testUserId }, createTestContext(db));

		expect(result.milestoneReached).toBe(1000);
		expect(result.claimStats.earnedTotalCoins).toBe(10000);
		expect(result.claimStats.earnedTotalXp).toBe(5000);
	});

	it("should not reward between milestones", async () => {
		await db.update(userStatsTable).set({ messagesCount: 500 }).where(eq(userStatsTable.userId, testUserId));

		const result = await call(checkMessageMilestone, { userId: testUserId }, createTestContext(db));

		expect(result.updatedStats.messagesCount).toBe(501);
		expect(result.rewardEarned).toBe(false);
		expect(result.milestoneReached).toBeUndefined();
	});

	it("should update lastMessageAt timestamp", async () => {
		const result = await call(checkMessageMilestone, { userId: testUserId }, createTestContext(db));

		expect(result.updatedStats.lastMessageAt).toBeInstanceOf(Date);
	});
});
