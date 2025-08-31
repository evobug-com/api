import { describe, expect, it, beforeEach } from "bun:test";
import { ORPCError } from "@orpc/client";
import { call } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { type DbUser, type DbSuspension, suspensionsTable } from "../../db/schema";
import * as schema from "../../db/schema";
import { createTestContext, createTestDatabase } from "../shared/test-utils";
import { createUser } from "../users";
import {
	createSuspension,
	liftSuspension,
	checkSuspension,
	listSuspensions,
	getSuspensionHistory,
	autoExpireSuspensions,
} from "./index";

describe("Suspensions", () => {
	let db: NodePgDatabase<typeof schema>;
	let testUser: Omit<DbUser, "password">;
	let issuerUser: Omit<DbUser, "password">;
	let lifterUser: Omit<DbUser, "password">;
	const testGuildId = "test-guild-123";

	beforeEach(async () => {
		db = await createTestDatabase();
		
		// Create test users
		testUser = await call(
			createUser,
			{ username: "suspensionTestUser" },
			createTestContext(db),
		);
		
		issuerUser = await call(
			createUser,
			{ username: "suspensionIssuerUser" },
			createTestContext(db),
		);
		
		lifterUser = await call(
			createUser,
			{ username: "suspensionLifterUser" },
			createTestContext(db),
		);
	});

	describe("createSuspension", () => {
		it("should successfully create a suspension with default duration", async () => {
			const result = await call(
				createSuspension,
				{
					userId: testUser.id,
					guildId: testGuildId,
					reason: "Repeated violations",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			expect(result.suspension).toBeDefined();
			expect(result.suspension.userId).toBe(testUser.id);
			expect(result.suspension.guildId).toBe(testGuildId);
			expect(result.suspension.reason).toBe("Repeated violations");
			expect(result.suspension.issuedBy).toBe(issuerUser.id);
			expect(result.suspension.endsAt).toBeInstanceOf(Date);
			expect(result.suspension.liftedAt).toBeNull();
			expect(result.message).toContain("User has been suspended");
			expect(result.isPermanent).toBe(false);
			
			// Default duration should be 30 days
			const daysDiff = Math.round(
				(new Date(result.suspension.endsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
			);
			expect(daysDiff).toBeGreaterThanOrEqual(29);
			expect(daysDiff).toBeLessThanOrEqual(31);
		});

		it("should create suspension with custom duration", async () => {
			const customDays = 7;
			const result = await call(
				createSuspension,
				{
					userId: testUser.id,
					guildId: testGuildId,
					reason: "Minor offense",
					duration: customDays,
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			expect(result.suspension.endsAt).toBeInstanceOf(Date);
			expect(result.message).toContain(`suspended for ${customDays} days`);
			
			const daysDiff = Math.round(
				(new Date(result.suspension.endsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
			);
			expect(daysDiff).toBeGreaterThanOrEqual(customDays - 1);
			expect(daysDiff).toBeLessThanOrEqual(customDays + 1);
		});

		it("should fail when issuer does not exist", async () => {
			await expect(
				call(
					createSuspension,
					{
						userId: testUser.id,
						guildId: testGuildId,
						reason: "Test suspension",
						issuedBy: 999999,
					},
					createTestContext(db),
				),
			).rejects.toThrow(new ORPCError("NOT_FOUND", { message: "Issuer not found" }));
		});

		it("should fail when user does not exist", async () => {
			await expect(
				call(
					createSuspension,
					{
						userId: 999999,
						guildId: testGuildId,
						reason: "Test suspension",
						issuedBy: issuerUser.id,
					},
					createTestContext(db, issuerUser),
				),
			).rejects.toThrow(new ORPCError("NOT_FOUND", { message: "User not found" }));
		});

		it("should fail when user already has active suspension", async () => {
			// Create first suspension
			await call(
				createSuspension,
				{
					userId: testUser.id,
					guildId: testGuildId,
					reason: "First suspension",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			// Try to create second suspension
			await expect(
				call(
					createSuspension,
					{
						userId: testUser.id,
						guildId: testGuildId,
						reason: "Second suspension",
						issuedBy: issuerUser.id,
					},
					createTestContext(db, issuerUser),
				),
			).rejects.toThrow(new ORPCError("CONFLICT", { message: "User already has an active suspension" }));
		});

		it("should allow suspension after previous one expired", async () => {
			// Create first suspension
			const firstSuspension = await call(
				createSuspension,
				{
					userId: testUser.id,
					guildId: testGuildId,
					reason: "First suspension",
					duration: 1,
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			// Manually expire it
			await db
				.update(suspensionsTable)
				.set({ endsAt: new Date(Date.now() - 1000) })
				.where(eq(suspensionsTable.id, firstSuspension.suspension.id));

			// Should be able to create new suspension
			const result = await call(
				createSuspension,
				{
					userId: testUser.id,
					guildId: testGuildId,
					reason: "Second suspension",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			expect(result.suspension).toBeDefined();
			expect(result.suspension.id).not.toBe(firstSuspension.suspension.id);
		});

		it("should allow suspension after previous one was lifted", async () => {
			// Create and lift first suspension
			const firstSuspension = await call(
				createSuspension,
				{
					userId: testUser.id,
					guildId: testGuildId,
					reason: "First suspension",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			await call(
				liftSuspension,
				{
					userId: testUser.id,
					guildId: testGuildId,
					liftedBy: lifterUser.id,
					reason: "Appeal accepted",
				},
				createTestContext(db, lifterUser),
			);

			// Should be able to create new suspension
			const result = await call(
				createSuspension,
				{
					userId: testUser.id,
					guildId: testGuildId,
					reason: "Second suspension",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			expect(result.suspension).toBeDefined();
			expect(result.suspension.id).not.toBe(firstSuspension.suspension.id);
		});

		it("should handle very long suspension durations", async () => {
			const result = await call(
				createSuspension,
				{
					userId: testUser.id,
					guildId: testGuildId,
					reason: "Severe offense",
					duration: 365,
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			expect(result.suspension.endsAt).toBeInstanceOf(Date);
			const daysDiff = Math.round(
				(new Date(result.suspension.endsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
			);
			expect(daysDiff).toBeGreaterThanOrEqual(364);
			expect(daysDiff).toBeLessThanOrEqual(366);
		});
	});

	describe("liftSuspension", () => {
		let suspension: DbSuspension;

		beforeEach(async () => {
			const result = await call(
				createSuspension,
				{
					userId: testUser.id,
					guildId: testGuildId,
					reason: "Test suspension",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);
			suspension = result.suspension;
		});

		it("should successfully lift an active suspension", async () => {
			const result = await call(
				liftSuspension,
				{
					userId: testUser.id,
					guildId: testGuildId,
					liftedBy: lifterUser.id,
					reason: "Appeal accepted",
				},
				createTestContext(db, lifterUser),
			);

			expect(result.success).toBe(true);
			expect(result.message).toBe("Suspension lifted successfully");

			// Verify suspension was lifted
			const liftedSuspension = await db.query.suspensionsTable.findFirst({
				where: eq(suspensionsTable.id, suspension.id),
			});

			expect(liftedSuspension?.liftedAt).toBeInstanceOf(Date);
			expect(liftedSuspension?.liftedBy).toBe(lifterUser.id);
			expect(liftedSuspension?.liftReason).toBe("Appeal accepted");
		});

		it("should lift suspension without reason", async () => {
			const result = await call(
				liftSuspension,
				{
					userId: testUser.id,
					guildId: testGuildId,
					liftedBy: lifterUser.id,
				},
				createTestContext(db, lifterUser),
			);

			expect(result.success).toBe(true);

			const liftedSuspension = await db.query.suspensionsTable.findFirst({
				where: eq(suspensionsTable.id, suspension.id),
			});

			expect(liftedSuspension?.liftReason).toBeNull();
		});

		it("should fail when lifter does not exist", async () => {
			await expect(
				call(
					liftSuspension,
					{
						userId: testUser.id,
						guildId: testGuildId,
						liftedBy: 999999,
					},
					createTestContext(db),
				),
			).rejects.toThrow(new ORPCError("NOT_FOUND", { message: "Lifter not found" }));
		});

		it("should fail when no active suspension exists", async () => {
			// Lift the suspension first
			await call(
				liftSuspension,
				{
					userId: testUser.id,
					guildId: testGuildId,
					liftedBy: lifterUser.id,
				},
				createTestContext(db, lifterUser),
			);

			// Try to lift again
			await expect(
				call(
					liftSuspension,
					{
						userId: testUser.id,
						guildId: testGuildId,
						liftedBy: lifterUser.id,
					},
					createTestContext(db, lifterUser),
				),
			).rejects.toThrow(new ORPCError("NOT_FOUND", { message: "No active suspension found for this user" }));
		});

		it("should fail when user never had suspension", async () => {
			const newUser = await call(
				createUser,
				{ username: "neverSuspendedUser" },
				createTestContext(db),
			);

			await expect(
				call(
					liftSuspension,
					{
						userId: newUser.id,
						guildId: testGuildId,
						liftedBy: lifterUser.id,
					},
					createTestContext(db, lifterUser),
				),
			).rejects.toThrow(new ORPCError("NOT_FOUND", { message: "No active suspension found for this user" }));
		});
	});

	describe("checkSuspension", () => {
		it("should return not suspended for user with no suspensions", async () => {
			const result = await call(
				checkSuspension,
				{
					userId: testUser.id,
					guildId: testGuildId,
				},
				createTestContext(db),
			);

			expect(result.isSuspended).toBe(false);
			expect(result.suspension).toBeNull();
			expect(result.expiresIn).toBeNull();
			expect(result.isPermanent).toBe(false);
		});

		it("should return suspended status for active suspension", async () => {
			const suspensionResult = await call(
				createSuspension,
				{
					userId: testUser.id,
					guildId: testGuildId,
					reason: "Test suspension",
					duration: 7,
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			const result = await call(
				checkSuspension,
				{
					userId: testUser.id,
					guildId: testGuildId,
				},
				createTestContext(db),
			);

			expect(result.isSuspended).toBe(true);
			expect(result.suspension).toBeDefined();
			expect(result.suspension?.id).toBe(suspensionResult.suspension.id);
			expect(result.expiresIn).toBeGreaterThan(0);
			expect(result.expiresIn).toBeLessThanOrEqual(7);
			expect(result.isPermanent).toBe(false);
		});

		it("should return not suspended for lifted suspension", async () => {
			await call(
				createSuspension,
				{
					userId: testUser.id,
					guildId: testGuildId,
					reason: "Test suspension",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			await call(
				liftSuspension,
				{
					userId: testUser.id,
					guildId: testGuildId,
					liftedBy: lifterUser.id,
				},
				createTestContext(db, lifterUser),
			);

			const result = await call(
				checkSuspension,
				{
					userId: testUser.id,
					guildId: testGuildId,
				},
				createTestContext(db),
			);

			expect(result.isSuspended).toBe(false);
			expect(result.suspension).toBeNull();
			expect(result.expiresIn).toBeNull();
		});

		it("should return not suspended for expired suspension", async () => {
			const suspensionResult = await call(
				createSuspension,
				{
					userId: testUser.id,
					guildId: testGuildId,
					reason: "Test suspension",
					duration: 1,
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			// Manually expire it
			await db
				.update(suspensionsTable)
				.set({ endsAt: new Date(Date.now() - 1000) })
				.where(eq(suspensionsTable.id, suspensionResult.suspension.id));

			const result = await call(
				checkSuspension,
				{
					userId: testUser.id,
					guildId: testGuildId,
				},
				createTestContext(db),
			);

			expect(result.isSuspended).toBe(false);
			expect(result.suspension).toBeNull();
			expect(result.expiresIn).toBeNull();
		});

		it("should calculate correct days until expiration", async () => {
			const days = 10;
			await call(
				createSuspension,
				{
					userId: testUser.id,
					guildId: testGuildId,
					reason: "Test suspension",
					duration: days,
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			const result = await call(
				checkSuspension,
				{
					userId: testUser.id,
					guildId: testGuildId,
				},
				createTestContext(db),
			);

			expect(result.expiresIn).toBeGreaterThanOrEqual(days - 1);
			expect(result.expiresIn).toBeLessThanOrEqual(days);
		});
	});

	describe("listSuspensions", () => {
		beforeEach(async () => {
			// Create multiple test users
			const users = [];
			for (let i = 0; i < 5; i++) {
				const user = await call(
					createUser,
					{ username: `listTestUser${i}` },
					createTestContext(db),
				);
				users.push(user);
			}

			// Create various suspensions
			// Active suspensions
			for (let i = 0; i < 3; i++) {
				await call(
					createSuspension,
					{
						userId: users[i].id,
						guildId: testGuildId,
						reason: `Active suspension ${i}`,
						duration: 30,
						issuedBy: issuerUser.id,
					},
					createTestContext(db, issuerUser),
				);
			}

			// Lifted suspension
			const liftedResult = await call(
				createSuspension,
				{
					userId: users[3].id,
					guildId: testGuildId,
					reason: "Lifted suspension",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);
			await call(
				liftSuspension,
				{
					userId: users[3].id,
					guildId: testGuildId,
					liftedBy: lifterUser.id,
				},
				createTestContext(db, lifterUser),
			);

			// Expired suspension
			const expiredResult = await call(
				createSuspension,
				{
					userId: users[4].id,
					guildId: testGuildId,
					reason: "Expired suspension",
					duration: 1,
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);
			await db
				.update(suspensionsTable)
				.set({ endsAt: new Date(Date.now() - 1000) })
				.where(eq(suspensionsTable.id, expiredResult.suspension.id));
		});

		it("should list only active suspensions by default", async () => {
			const result = await call(
				listSuspensions,
				{
					guildId: testGuildId,
				},
				createTestContext(db),
			);

			expect(result.suspensions).toHaveLength(3);
			expect(result.total).toBe(3);
			
			// All should be active (not lifted, not expired)
			for (const suspension of result.suspensions) {
				expect(suspension.liftedAt).toBeNull();
				expect(new Date(suspension.endsAt).getTime()).toBeGreaterThan(Date.now());
			}
		});

		it("should list all suspensions when activeOnly is false", async () => {
			const result = await call(
				listSuspensions,
				{
					guildId: testGuildId,
					activeOnly: false,
				},
				createTestContext(db),
			);

			expect(result.suspensions).toHaveLength(5);
			expect(result.total).toBe(5);
		});

		it("should filter by userId", async () => {
			const user = await call(
				createUser,
				{ username: "specificUser" },
				createTestContext(db),
			);

			await call(
				createSuspension,
				{
					userId: user.id,
					guildId: testGuildId,
					reason: "User-specific suspension",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			const result = await call(
				listSuspensions,
				{
					guildId: testGuildId,
					userId: user.id,
				},
				createTestContext(db),
			);

			expect(result.suspensions).toHaveLength(1);
			expect(result.suspensions[0].userId).toBe(user.id);
		});

		it("should respect limit and offset", async () => {
			const result = await call(
				listSuspensions,
				{
					guildId: testGuildId,
					limit: 2,
					offset: 1,
				},
				createTestContext(db),
			);

			expect(result.suspensions).toHaveLength(2);
		});

		it("should return suspensions in descending order by startedAt", async () => {
			const result = await call(
				listSuspensions,
				{
					guildId: testGuildId,
					activeOnly: false,
				},
				createTestContext(db),
			);

			for (let i = 0; i < result.suspensions.length - 1; i++) {
				const current = new Date(result.suspensions[i].startedAt);
				const next = new Date(result.suspensions[i + 1].startedAt);
				expect(current.getTime()).toBeGreaterThanOrEqual(next.getTime());
			}
		});

		it("should include user, issuer, and lifter relationships", async () => {
			const user = await call(
				createUser,
				{ username: "relatedUser" },
				createTestContext(db),
			);

			await call(
				createSuspension,
				{
					userId: user.id,
					guildId: testGuildId,
					reason: "Test relations",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			await call(
				liftSuspension,
				{
					userId: user.id,
					guildId: testGuildId,
					liftedBy: lifterUser.id,
				},
				createTestContext(db, lifterUser),
			);

			const result = await call(
				listSuspensions,
				{
					guildId: testGuildId,
					userId: user.id,
					activeOnly: false,
				},
				createTestContext(db),
			);

			expect(result.suspensions[0].user).toBeDefined();
			expect(result.suspensions[0].issuer).toBeDefined();
			expect(result.suspensions[0].lifter).toBeDefined();
		});
	});

	describe("getSuspensionHistory", () => {
		it("should return empty history for user with no suspensions", async () => {
			const result = await call(
				getSuspensionHistory,
				{
					userId: testUser.id,
					guildId: testGuildId,
				},
				createTestContext(db),
			);

			expect(result.suspensions).toEqual([]);
			expect(result.totalSuspensions).toBe(0);
			expect(result.activeSuspension).toBeNull();
			expect(result.hasBeenSuspended).toBe(false);
		});

		it("should return complete suspension history", async () => {
			// Create first suspension and lift it
			await call(
				createSuspension,
				{
					userId: testUser.id,
					guildId: testGuildId,
					reason: "First offense",
					duration: 7,
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			await call(
				liftSuspension,
				{
					userId: testUser.id,
					guildId: testGuildId,
					liftedBy: lifterUser.id,
				},
				createTestContext(db, lifterUser),
			);

			// Create second suspension (active)
			const activeSuspension = await call(
				createSuspension,
				{
					userId: testUser.id,
					guildId: testGuildId,
					reason: "Second offense",
					duration: 30,
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			const result = await call(
				getSuspensionHistory,
				{
					userId: testUser.id,
					guildId: testGuildId,
				},
				createTestContext(db),
			);

			expect(result.suspensions).toHaveLength(2);
			expect(result.totalSuspensions).toBe(2);
			expect(result.activeSuspension).toBeDefined();
			expect(result.activeSuspension?.id).toBe(activeSuspension.suspension.id);
			expect(result.hasBeenSuspended).toBe(true);
		});

		it("should correctly identify active suspension", async () => {
			// Create expired suspension
			const expiredResult = await call(
				createSuspension,
				{
					userId: testUser.id,
					guildId: testGuildId,
					reason: "Expired suspension",
					duration: 1,
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);
			await db
				.update(suspensionsTable)
				.set({ endsAt: new Date(Date.now() - 1000) })
				.where(eq(suspensionsTable.id, expiredResult.suspension.id));

			// Create active suspension
			const activeResult = await call(
				createSuspension,
				{
					userId: testUser.id,
					guildId: testGuildId,
					reason: "Active suspension",
					duration: 30,
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			const result = await call(
				getSuspensionHistory,
				{
					userId: testUser.id,
					guildId: testGuildId,
				},
				createTestContext(db),
			);

			expect(result.activeSuspension?.id).toBe(activeResult.suspension.id);
			expect(result.totalSuspensions).toBe(2);
		});

		it("should order suspensions by most recent first", async () => {
			// Create multiple suspensions
			for (let i = 0; i < 3; i++) {
				const result = await call(
					createSuspension,
					{
						userId: testUser.id,
						guildId: testGuildId,
						reason: `Suspension ${i}`,
						duration: 1,
						issuedBy: issuerUser.id,
					},
					createTestContext(db, issuerUser),
				);

				// Expire immediately to allow next suspension
				await db
					.update(suspensionsTable)
					.set({ endsAt: new Date(Date.now() - 1000) })
					.where(eq(suspensionsTable.id, result.suspension.id));
				
				// Add small delay to ensure different timestamps
				await new Promise(resolve => setTimeout(resolve, 10));
			}

			const result = await call(
				getSuspensionHistory,
				{
					userId: testUser.id,
					guildId: testGuildId,
				},
				createTestContext(db),
			);

			// Verify descending order
			for (let i = 0; i < result.suspensions.length - 1; i++) {
				const current = new Date(result.suspensions[i].startedAt);
				const next = new Date(result.suspensions[i + 1].startedAt);
				expect(current.getTime()).toBeGreaterThanOrEqual(next.getTime());
			}
		});
	});

	describe("autoExpireSuspensions", () => {
		beforeEach(async () => {
			// Create expired suspensions
			for (let i = 0; i < 3; i++) {
				const user = await call(
					createUser,
					{ username: `expiredUser${i}` },
					createTestContext(db),
				);

				const result = await call(
					createSuspension,
					{
						userId: user.id,
						guildId: testGuildId,
						reason: `Expired suspension ${i}`,
						duration: 1,
						issuedBy: issuerUser.id,
					},
					createTestContext(db, issuerUser),
				);

				// Manually expire
				await db
					.update(suspensionsTable)
					.set({ endsAt: new Date(Date.now() - 1000) })
					.where(eq(suspensionsTable.id, result.suspension.id));
			}

			// Create active suspensions
			for (let i = 0; i < 2; i++) {
				const user = await call(
					createUser,
					{ username: `activeUser${i}` },
					createTestContext(db),
				);

				await call(
					createSuspension,
					{
						userId: user.id,
						guildId: testGuildId,
						reason: `Active suspension ${i}`,
						duration: 30,
						issuedBy: issuerUser.id,
					},
					createTestContext(db, issuerUser),
				);
			}

			// Create lifted suspension
			const liftedUser = await call(
				createUser,
				{ username: "liftedUser" },
				createTestContext(db),
			);

			await call(
				createSuspension,
				{
					userId: liftedUser.id,
					guildId: testGuildId,
					reason: "Already lifted",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			await call(
				liftSuspension,
				{
					userId: liftedUser.id,
					guildId: testGuildId,
					liftedBy: lifterUser.id,
				},
				createTestContext(db, lifterUser),
			);
		});

		it("should auto-expire expired suspensions", async () => {
			const result = await call(
				autoExpireSuspensions,
				{ guildId: testGuildId },
				createTestContext(db),
			);

			expect(result.success).toBe(true);
			expect(result.expiredCount).toBe(3);
			expect(result.message).toBe("Auto-expired 3 suspensions");

			// Verify they were actually lifted
			const expiredSuspensions = await db.query.suspensionsTable.findMany({
				where: and(
					eq(suspensionsTable.guildId, testGuildId),
					eq(suspensionsTable.liftReason, "Suspension expired automatically"),
				),
			});

			expect(expiredSuspensions).toHaveLength(3);
			for (const suspension of expiredSuspensions) {
				expect(suspension.liftedAt).toBeInstanceOf(Date);
				expect(suspension.liftReason).toBe("Suspension expired automatically");
			}
		});

		it("should not affect active suspensions", async () => {
			await call(
				autoExpireSuspensions,
				{ guildId: testGuildId },
				createTestContext(db),
			);

			// Check that active suspensions are still active
			const activeSuspensions = await db.query.suspensionsTable.findMany({
				where: and(
					eq(suspensionsTable.guildId, testGuildId),
					eq(suspensionsTable.reason, "Active suspension 0"),
				),
			});

			expect(activeSuspensions[0].liftedAt).toBeNull();
		});

		it("should not affect already lifted suspensions", async () => {
			const beforeLiftedSuspensions = await db.query.suspensionsTable.findMany({
				where: and(
					eq(suspensionsTable.guildId, testGuildId),
					eq(suspensionsTable.reason, "Already lifted"),
				),
			});

			await call(
				autoExpireSuspensions,
				{ guildId: testGuildId },
				createTestContext(db),
			);

			const afterLiftedSuspensions = await db.query.suspensionsTable.findMany({
				where: and(
					eq(suspensionsTable.guildId, testGuildId),
					eq(suspensionsTable.reason, "Already lifted"),
				),
			});

			// Should not change already lifted suspension
			expect(afterLiftedSuspensions[0].liftReason).not.toBe("Suspension expired automatically");
			expect(afterLiftedSuspensions[0].updatedAt.getTime()).toBe(
				beforeLiftedSuspensions[0].updatedAt.getTime()
			);
		});

		it("should only expire suspensions for specified guild", async () => {
			const otherGuildId = "other-guild-456";
			
			// Create expired suspension for another guild
			const otherUser = await call(
				createUser,
				{ username: "otherGuildUser" },
				createTestContext(db),
			);

			const otherResult = await call(
				createSuspension,
				{
					userId: otherUser.id,
					guildId: otherGuildId,
					reason: "Other guild suspension",
					duration: 1,
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			await db
				.update(suspensionsTable)
				.set({ endsAt: new Date(Date.now() - 1000) })
				.where(eq(suspensionsTable.id, otherResult.suspension.id));

			// Auto-expire for original guild
			await call(
				autoExpireSuspensions,
				{ guildId: testGuildId },
				createTestContext(db),
			);

			// Other guild's suspension should still be expired but not lifted
			const otherGuildSuspension = await db.query.suspensionsTable.findFirst({
				where: eq(suspensionsTable.id, otherResult.suspension.id),
			});

			expect(otherGuildSuspension?.liftedAt).toBeNull();
			expect(otherGuildSuspension?.liftReason).toBeNull();
		});

		it("should return zero when no suspensions to expire", async () => {
			// First expire all
			await call(
				autoExpireSuspensions,
				{ guildId: testGuildId },
				createTestContext(db),
			);

			// Try again
			const result = await call(
				autoExpireSuspensions,
				{ guildId: testGuildId },
				createTestContext(db),
			);

			expect(result.success).toBe(true);
			expect(result.expiredCount).toBe(0);
			expect(result.message).toBe("Auto-expired 0 suspensions");
		});
	});

	describe("Edge cases", () => {
		it("should handle empty reason gracefully", async () => {
			await expect(
				call(
					createSuspension,
					{
						userId: testUser.id,
						guildId: testGuildId,
						reason: "",
						issuedBy: issuerUser.id,
					},
					createTestContext(db, issuerUser),
				),
			).rejects.toThrow();
		});

		it("should handle very long reason text", async () => {
			const longReason = "a".repeat(1001);
			
			await expect(
				call(
					createSuspension,
					{
						userId: testUser.id,
						guildId: testGuildId,
						reason: longReason,
						issuedBy: issuerUser.id,
					},
					createTestContext(db, issuerUser),
				),
			).rejects.toThrow();
		});

		it("should handle negative duration", async () => {
			await expect(
				call(
					createSuspension,
					{
						userId: testUser.id,
						guildId: testGuildId,
						reason: "Test",
						duration: -1,
						issuedBy: issuerUser.id,
					},
					createTestContext(db, issuerUser),
				),
			).rejects.toThrow();
		});

		it("should handle zero duration", async () => {
			await expect(
				call(
					createSuspension,
					{
						userId: testUser.id,
						guildId: testGuildId,
						reason: "Test",
						duration: 0,
						issuedBy: issuerUser.id,
					},
					createTestContext(db, issuerUser),
				),
			).rejects.toThrow();
		});
	});
});