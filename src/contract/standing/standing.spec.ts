import { beforeEach, describe, expect, it } from "bun:test";
import { ORPCError } from "@orpc/client";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { relations } from "../../db/relations.ts";
import type * as schema from "../../db/schema";
import { type DbUser, violationsTable } from "../../db/schema";
import { AccountStanding, FeatureRestriction, ViolationSeverity, ViolationType } from "../../utils/violation-utils";
import { createTestContext, createTestDatabase } from "../shared/test-utils";
import { createUser } from "../users";
import { issueViolation } from "../violations";
import { calculateStanding, getBulkStandings, getStanding, getUserRestrictions } from "./index";

describe("Standing", () => {
	let db: BunSQLDatabase<typeof schema, typeof relations>;
	let testUser: DbUser;
	let issuerUser: DbUser;
	const testGuildId = "test-guild-123";

	beforeEach(async () => {
		db = await createTestDatabase();

		// Create test users
		testUser = (await call(createUser, { username: "standingTestUser" }, createTestContext(db))) as DbUser;

		issuerUser = (await call(createUser, { username: "standingIssuerUser" }, createTestContext(db))) as DbUser;
	});

	describe("getStanding", () => {
		it("should return ALL_GOOD standing for user with no violations", async () => {
			const result = await call(
				getStanding,
				{
					userId: testUser.id,
					guildId: testGuildId,
				},
				createTestContext(db),
			);

			expect(result.standing).toBe(AccountStanding.ALL_GOOD);
			expect(result.activeViolations).toBe(0);
			expect(result.totalViolations).toBe(0);
			expect(result.restrictions).toEqual([]);
			expect(result.severityScore).toBe(0);
			expect(result.standingDisplay).toBeDefined();
			expect(result.standingDisplay.label).toBe("Vše v pořádku");
			expect(result.nextExpirationDate).toBeNull();
		});

		it("should calculate LIMITED standing with one low violation", async () => {
			await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.SPAM,
					severity: ViolationSeverity.LOW,
					reason: "Test violation",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			const result = await call(
				getStanding,
				{
					userId: testUser.id,
					guildId: testGuildId,
				},
				createTestContext(db),
			);

			expect(result.standing).toBe(AccountStanding.LIMITED);
			expect(result.activeViolations).toBe(1);
			expect(result.totalViolations).toBe(1);
			expect(result.severityScore).toBe(10); // LOW = 10 points
			expect(result.restrictions.length).toBeGreaterThan(0);
		});

		it("should calculate VERY_LIMITED standing with multiple violations", async () => {
			// Add violations to reach VERY_LIMITED threshold
			await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.SPAM,
					severity: ViolationSeverity.MEDIUM,
					reason: "First violation",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.TOXICITY,
					severity: ViolationSeverity.MEDIUM,
					reason: "Second violation",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			const result = await call(
				getStanding,
				{
					userId: testUser.id,
					guildId: testGuildId,
				},
				createTestContext(db),
			);

			expect(result.standing).toBe(AccountStanding.VERY_LIMITED);
			expect(result.activeViolations).toBe(2);
			expect(result.severityScore).toBe(50); // MEDIUM = 25 * 2
		});

		it("should calculate AT_RISK standing with high severity violations", async () => {
			await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.NSFW,
					severity: ViolationSeverity.HIGH,
					reason: "Serious violation",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.TOXICITY,
					severity: ViolationSeverity.MEDIUM,
					reason: "Additional violation",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			const result = await call(
				getStanding,
				{
					userId: testUser.id,
					guildId: testGuildId,
				},
				createTestContext(db),
			);

			expect(result.standing).toBe(AccountStanding.AT_RISK);
			expect(result.severityScore).toBe(75); // HIGH = 50, MEDIUM = 25
		});

		it("should calculate SUSPENDED standing with critical violation", async () => {
			await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.ILLEGAL,
					severity: ViolationSeverity.CRITICAL,
					reason: "Critical violation",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			const result = await call(
				getStanding,
				{
					userId: testUser.id,
					guildId: testGuildId,
				},
				createTestContext(db),
			);

			expect(result.standing).toBe(AccountStanding.SUSPENDED);
			expect(result.severityScore).toBeGreaterThanOrEqual(100);
		});

		it("should aggregate restrictions from multiple violations", async () => {
			await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.SPAM,
					severity: ViolationSeverity.MEDIUM,
					reason: "Spam violation",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.NSFW,
					severity: ViolationSeverity.HIGH,
					reason: "NSFW violation",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			const result = await call(
				getStanding,
				{
					userId: testUser.id,
					guildId: testGuildId,
				},
				createTestContext(db),
			);

			// Should have combined restrictions from both violations
			expect(result.restrictions).toContain(FeatureRestriction.MESSAGE_LINK);
			expect(result.restrictions).toContain(FeatureRestriction.MESSAGE_EMBED);
			expect(result.restrictions).toContain(FeatureRestriction.MESSAGE_ATTACH);
			expect(result.restrictions).toContain(FeatureRestriction.VOICE_VIDEO);
			expect(result.restrictions).toContain(FeatureRestriction.VOICE_STREAM);
		});

		it("should not include expired violations in active count", async () => {
			// Create an expired violation
			const expiredResult = await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.SPAM,
					severity: ViolationSeverity.LOW,
					reason: "Expired violation",
					issuedBy: issuerUser.id,
					expiresInDays: 1,
				},
				createTestContext(db, issuerUser),
			);

			// Manually expire it
			await db
				.update(violationsTable)
				.set({ expiresAt: new Date(Date.now() - 1000) })
				.where(eq(violationsTable.id, expiredResult.violation.id));

			// Add an active violation
			await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.TOXICITY,
					severity: ViolationSeverity.MEDIUM,
					reason: "Active violation",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			const result = await call(
				getStanding,
				{
					userId: testUser.id,
					guildId: testGuildId,
				},
				createTestContext(db),
			);

			expect(result.activeViolations).toBe(1);
			expect(result.totalViolations).toBe(2);
			expect(result.standing).toBe(AccountStanding.LIMITED);
		});

		it("should find next expiration date among active violations", async () => {
			const now = new Date();

			// Create violations with different expiration dates
			await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.SPAM,
					severity: ViolationSeverity.LOW,
					reason: "30 day violation",
					issuedBy: issuerUser.id,
					expiresInDays: 30,
				},
				createTestContext(db, issuerUser),
			);

			await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.TOXICITY,
					severity: ViolationSeverity.MEDIUM,
					reason: "10 day violation",
					issuedBy: issuerUser.id,
					expiresInDays: 10,
				},
				createTestContext(db, issuerUser),
			);

			const result = await call(
				getStanding,
				{
					userId: testUser.id,
					guildId: testGuildId,
				},
				createTestContext(db),
			);

			expect(result.nextExpirationDate).toBeInstanceOf(Date);
			if (!result.nextExpirationDate) throw new Error("nextExpirationDate is null");
			// Should be approximately 10 days from now (the earliest expiration)
			const daysDiff = Math.round((result.nextExpirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
			expect(daysDiff).toBeGreaterThanOrEqual(9);
			expect(daysDiff).toBeLessThanOrEqual(11);
		});

		it("should return proper standing display information", async () => {
			const testCases = [
				{ standing: AccountStanding.ALL_GOOD, label: "Vše v pořádku" },
				{ standing: AccountStanding.LIMITED, label: "Omezený" },
				{ standing: AccountStanding.VERY_LIMITED, label: "Velmi omezený" },
				{ standing: AccountStanding.AT_RISK, label: "V ohrožení" },
				{ standing: AccountStanding.SUSPENDED, label: "Pozastavený" },
			];

			for (const testCase of testCases) {
				// Clear violations
				await db.delete(violationsTable).where(eq(violationsTable.userId, testUser.id));

				// Add violations to achieve the desired standing
				if (testCase.standing === AccountStanding.LIMITED) {
					await call(
						issueViolation,
						{
							userId: testUser.id,
							guildId: testGuildId,
							type: ViolationType.SPAM,
							severity: ViolationSeverity.LOW,
							reason: "Test",
							issuedBy: issuerUser.id,
						},
						createTestContext(db, issuerUser),
					);
				} else if (testCase.standing === AccountStanding.VERY_LIMITED) {
					await call(
						issueViolation,
						{
							userId: testUser.id,
							guildId: testGuildId,
							type: ViolationType.SPAM,
							severity: ViolationSeverity.MEDIUM,
							reason: "Test",
							issuedBy: issuerUser.id,
						},
						createTestContext(db, issuerUser),
					);
					await call(
						issueViolation,
						{
							userId: testUser.id,
							guildId: testGuildId,
							type: ViolationType.TOXICITY,
							severity: ViolationSeverity.MEDIUM,
							reason: "Test",
							issuedBy: issuerUser.id,
						},
						createTestContext(db, issuerUser),
					);
				} else if (testCase.standing === AccountStanding.AT_RISK) {
					await call(
						issueViolation,
						{
							userId: testUser.id,
							guildId: testGuildId,
							type: ViolationType.NSFW,
							severity: ViolationSeverity.HIGH,
							reason: "Test",
							issuedBy: issuerUser.id,
						},
						createTestContext(db, issuerUser),
					);
					await call(
						issueViolation,
						{
							userId: testUser.id,
							guildId: testGuildId,
							type: ViolationType.TOXICITY,
							severity: ViolationSeverity.MEDIUM,
							reason: "Test",
							issuedBy: issuerUser.id,
						},
						createTestContext(db, issuerUser),
					);
				} else if (testCase.standing === AccountStanding.SUSPENDED) {
					await call(
						issueViolation,
						{
							userId: testUser.id,
							guildId: testGuildId,
							type: ViolationType.ILLEGAL,
							severity: ViolationSeverity.CRITICAL,
							reason: "Test",
							issuedBy: issuerUser.id,
						},
						createTestContext(db, issuerUser),
					);
				}

				const result = await call(
					getStanding,
					{
						userId: testUser.id,
						guildId: testGuildId,
					},
					createTestContext(db),
				);

				expect(result.standingDisplay.label).toBe(testCase.label);
				expect(result.standingDisplay.emoji).toBeDefined();
				expect(result.standingDisplay.color).toBeDefined();
				expect(result.standingDisplay.description).toBeDefined();
			}
		});

		it("should fail when user does not exist", async () => {
			expect(
				call(
					getStanding,
					{
						userId: 999999,
						guildId: testGuildId,
					},
					createTestContext(db),
				),
			).rejects.toThrow(new ORPCError("NOT_FOUND", { message: "User not found for the given userId / getStanding" }));
		});

		it("should handle invalid JSON in restrictions gracefully", async () => {
			// Create a violation with invalid JSON in restrictions
			const [_violation] = await db
				.insert(violationsTable)
				.values({
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.SPAM,
					severity: ViolationSeverity.LOW,
					reason: "Test",
					restrictions: "invalid json",
					issuedBy: issuerUser.id,
					expiresAt: new Date(Date.now() + 86400000),
				})
				.returning();

			const result = await call(
				getStanding,
				{
					userId: testUser.id,
					guildId: testGuildId,
				},
				createTestContext(db),
			);

			// Should handle the invalid JSON gracefully
			expect(result.restrictions).toEqual([]);
			expect(result.standing).toBe(AccountStanding.LIMITED);
		});
	});

	describe("calculateStanding", () => {
		it("should calculate standing without additional data", async () => {
			await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.SPAM,
					severity: ViolationSeverity.MEDIUM,
					reason: "Test violation",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			const result = await call(
				calculateStanding,
				{
					userId: testUser.id,
					guildId: testGuildId,
				},
				createTestContext(db),
			);

			expect(result.standing).toBe(AccountStanding.LIMITED);
			expect(result.message).toContain("Account standing calculated");
		});

		it("should only consider active violations", async () => {
			// Create expired violation
			const expiredResult = await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.ILLEGAL,
					severity: ViolationSeverity.CRITICAL,
					reason: "Expired critical violation",
					issuedBy: issuerUser.id,
					expiresInDays: 1,
				},
				createTestContext(db, issuerUser),
			);

			// Expire it
			await db
				.update(violationsTable)
				.set({ expiresAt: new Date(Date.now() - 1000) })
				.where(eq(violationsTable.id, expiredResult.violation.id));

			// Add active low violation
			await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.SPAM,
					severity: ViolationSeverity.LOW,
					reason: "Active low violation",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			const result = await call(
				calculateStanding,
				{
					userId: testUser.id,
					guildId: testGuildId,
				},
				createTestContext(db),
			);

			// Should be LIMITED (from active LOW violation), not SUSPENDED (from expired CRITICAL)
			expect(result.standing).toBe(AccountStanding.LIMITED);
		});
	});

	describe("getBulkStandings", () => {
		let users: [
			Omit<DbUser, "password">,
			Omit<DbUser, "password">,
			Omit<DbUser, "password">,
			Omit<DbUser, "password">,
			Omit<DbUser, "password">,
		];

		beforeEach(async () => {
			users = [] as unknown as [DbUser, DbUser, DbUser, DbUser, DbUser];

			// Create multiple users with different violation profiles
			for (let i = 0; i < 5; i++) {
				const user = (await call(createUser, { username: `bulkUser${i}` }, createTestContext(db))) as DbUser;
				users.push(user);
			}

			// User 0: No violations (ALL_GOOD)
			// User 1: One low violation (LIMITED)
			await call(
				issueViolation,
				{
					userId: users[1]?.id,
					guildId: testGuildId,
					type: ViolationType.SPAM,
					severity: ViolationSeverity.LOW,
					reason: "Low violation",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			// User 2: Two medium violations (VERY_LIMITED)
			for (let i = 0; i < 2; i++) {
				await call(
					issueViolation,
					{
						userId: users[2]?.id,
						guildId: testGuildId,
						type: ViolationType.TOXICITY,
						severity: ViolationSeverity.MEDIUM,
						reason: `Medium violation ${i}`,
						issuedBy: issuerUser.id,
					},
					createTestContext(db, issuerUser),
				);
			}

			// User 3: High severity violations (AT_RISK)
			await call(
				issueViolation,
				{
					userId: users[3]?.id,
					guildId: testGuildId,
					type: ViolationType.NSFW,
					severity: ViolationSeverity.HIGH,
					reason: "High violation",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);
			await call(
				issueViolation,
				{
					userId: users[3]?.id,
					guildId: testGuildId,
					type: ViolationType.TOXICITY,
					severity: ViolationSeverity.MEDIUM,
					reason: "Additional violation",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			// User 4: Critical violation (SUSPENDED)
			await call(
				issueViolation,
				{
					userId: users[4]?.id,
					guildId: testGuildId,
					type: ViolationType.ILLEGAL,
					severity: ViolationSeverity.CRITICAL,
					reason: "Critical violation",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);
		});

		it("should get standings for multiple users", async () => {
			const userIds = users.map((u) => u.id);

			const result = await call(
				getBulkStandings,
				{
					userIds,
					guildId: testGuildId,
				},
				createTestContext(db),
			);

			expect(result).toHaveLength(5);

			// Check each user's standing
			const standingsMap = new Map(result.map((s) => [s.userId, s]));

			expect(standingsMap.get(users[0]?.id)?.standing).toBe(AccountStanding.ALL_GOOD);
			expect(standingsMap.get(users[1]?.id)?.standing).toBe(AccountStanding.LIMITED);
			expect(standingsMap.get(users[2]?.id)?.standing).toBe(AccountStanding.VERY_LIMITED);
			expect(standingsMap.get(users[3]?.id)?.standing).toBe(AccountStanding.AT_RISK);
			expect(standingsMap.get(users[4]?.id)?.standing).toBe(AccountStanding.SUSPENDED);
		});

		it("should sort results by severity score", async () => {
			const userIds = users.map((u) => u.id);

			const result = await call(
				getBulkStandings,
				{
					userIds,
					guildId: testGuildId,
				},
				createTestContext(db),
			);

			// Results should be sorted by severity score (highest first)
			for (let i = 0; i < result.length - 1; i++) {
				const currentItem = result[i];
				const nextItem = result[i + 1];
				if (currentItem?.severityScore === undefined || nextItem?.severityScore === undefined) {
					throw new Error("Severity score is undefined");
				}

				expect(currentItem.severityScore).toBeGreaterThanOrEqual(nextItem.severityScore);
			}
		});

		it("should handle empty user list", async () => {
			expect(
				call(
					getBulkStandings,
					{
						userIds: [],
						guildId: testGuildId,
					},
					createTestContext(db),
				),
			).rejects.toThrow();
		});

		it("should handle maximum user limit", async () => {
			const manyUserIds = Array.from({ length: 101 }, (_, i) => i + 1);

			expect(
				call(
					getBulkStandings,
					{
						userIds: manyUserIds,
						guildId: testGuildId,
					},
					createTestContext(db),
				),
			).rejects.toThrow();
		});

		it("should return correct active violation counts", async () => {
			const userIds = users.map((u) => u.id);

			const result = await call(
				getBulkStandings,
				{
					userIds,
					guildId: testGuildId,
				},
				createTestContext(db),
			);

			const standingsMap = new Map(result.map((s) => [s.userId, s]));

			expect(standingsMap.get(users[0]?.id)?.activeViolations).toBe(0);
			expect(standingsMap.get(users[1]?.id)?.activeViolations).toBe(1);
			expect(standingsMap.get(users[2]?.id)?.activeViolations).toBe(2);
			expect(standingsMap.get(users[3]?.id)?.activeViolations).toBe(2);
			expect(standingsMap.get(users[4]?.id)?.activeViolations).toBe(1);
		});
	});

	describe("getUserRestrictions", () => {
		it("should return empty restrictions for user with no violations", async () => {
			const result = await call(
				getUserRestrictions,
				{
					userId: testUser.id,
					guildId: testGuildId,
				},
				createTestContext(db),
			);

			expect(result.restrictions).toEqual([]);
			expect(Object.values(result.hasRestriction).every((v) => v === false)).toBe(true);
			expect(Object.values(result.canPerform).every((v) => v === true)).toBe(true);
		});

		it("should return restrictions from violations", async () => {
			await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.SPAM,
					severity: ViolationSeverity.MEDIUM,
					reason: "Spam violation",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			const result = await call(
				getUserRestrictions,
				{
					userId: testUser.id,
					guildId: testGuildId,
				},
				createTestContext(db),
			);

			expect(result.restrictions).toContain(FeatureRestriction.MESSAGE_LINK);
			expect(result.restrictions).toContain(FeatureRestriction.MESSAGE_EMBED);
			expect(result.hasRestriction[FeatureRestriction.MESSAGE_LINK]).toBe(true);
			expect(result.hasRestriction[FeatureRestriction.MESSAGE_EMBED]).toBe(true);
			expect(result.canPerform.sendLinks).toBe(false);
			expect(result.canPerform.sendEmbeds).toBe(false);
		});

		it("should handle TIMEOUT restriction affecting all capabilities", async () => {
			await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.EVASION,
					severity: ViolationSeverity.CRITICAL,
					reason: "Ban evasion",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			const result = await call(
				getUserRestrictions,
				{
					userId: testUser.id,
					guildId: testGuildId,
				},
				createTestContext(db),
			);

			expect(result.restrictions).toContain(FeatureRestriction.TIMEOUT);
			expect(result.hasRestriction[FeatureRestriction.TIMEOUT]).toBe(true);

			// TIMEOUT affects all capabilities
			expect(result.canPerform.sendMessages).toBe(false);
			expect(result.canPerform.sendEmbeds).toBe(false);
			expect(result.canPerform.sendAttachments).toBe(false);
			expect(result.canPerform.sendLinks).toBe(false);
			expect(result.canPerform.useVoice).toBe(false);
			expect(result.canPerform.useVideo).toBe(false);
			expect(result.canPerform.stream).toBe(false);
			expect(result.canPerform.addReactions).toBe(false);
			expect(result.canPerform.createThreads).toBe(false);
			expect(result.canPerform.changeNickname).toBe(false);
		});

		it("should merge restrictions from multiple violations", async () => {
			// Add NSFW violation (restricts attachments, embeds, video, stream)
			await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.NSFW,
					severity: ViolationSeverity.HIGH,
					reason: "NSFW violation",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			// Add toxicity violation (restricts voice, reactions)
			await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.TOXICITY,
					severity: ViolationSeverity.HIGH,
					reason: "Toxicity violation",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			const result = await call(
				getUserRestrictions,
				{
					userId: testUser.id,
					guildId: testGuildId,
				},
				createTestContext(db),
			);

			// Should have combined restrictions
			expect(result.restrictions).toContain(FeatureRestriction.MESSAGE_ATTACH);
			expect(result.restrictions).toContain(FeatureRestriction.MESSAGE_EMBED);
			expect(result.restrictions).toContain(FeatureRestriction.VOICE_VIDEO);
			expect(result.restrictions).toContain(FeatureRestriction.VOICE_STREAM);
			expect(result.restrictions).toContain(FeatureRestriction.VOICE_SPEAK);
			expect(result.restrictions).toContain(FeatureRestriction.REACTION_ADD);

			expect(result.canPerform.sendAttachments).toBe(false);
			expect(result.canPerform.useVoice).toBe(false);
			expect(result.canPerform.addReactions).toBe(false);
		});

		it("should not include expired violations in restrictions", async () => {
			// Create expired violation with restrictions
			const expiredResult = await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.NSFW,
					severity: ViolationSeverity.HIGH,
					reason: "Expired violation",
					issuedBy: issuerUser.id,
					expiresInDays: 1,
				},
				createTestContext(db, issuerUser),
			);

			// Expire it
			await db
				.update(violationsTable)
				.set({ expiresAt: new Date(Date.now() - 1000) })
				.where(eq(violationsTable.id, expiredResult.violation.id));

			const result = await call(
				getUserRestrictions,
				{
					userId: testUser.id,
					guildId: testGuildId,
				},
				createTestContext(db),
			);

			expect(result.restrictions).toEqual([]);
			expect(Object.values(result.canPerform).every((v) => v === true)).toBe(true);
		});

		it("should handle invalid JSON in restrictions field", async () => {
			// Create violation with invalid JSON
			await db.insert(violationsTable).values({
				userId: testUser.id,
				guildId: testGuildId,
				type: ViolationType.SPAM,
				severity: ViolationSeverity.LOW,
				reason: "Test",
				restrictions: "not valid json",
				issuedBy: issuerUser.id,
				expiresAt: new Date(Date.now() + 86400000),
			});

			const result = await call(
				getUserRestrictions,
				{
					userId: testUser.id,
					guildId: testGuildId,
				},
				createTestContext(db),
			);

			// Should handle gracefully and return empty restrictions
			expect(result.restrictions).toEqual([]);
			expect(Object.values(result.canPerform).every((v) => v === true)).toBe(true);
		});

		it("should deduplicate restrictions from multiple violations", async () => {
			// Add two violations with overlapping restrictions
			await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.SPAM,
					severity: ViolationSeverity.MEDIUM,
					reason: "First spam",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.ADVERTISING,
					severity: ViolationSeverity.MEDIUM,
					reason: "Advertising",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			const result = await call(
				getUserRestrictions,
				{
					userId: testUser.id,
					guildId: testGuildId,
				},
				createTestContext(db),
			);

			// Both violations add MESSAGE_LINK and MESSAGE_EMBED, but should only appear once
			const linkCount = result.restrictions.filter((r) => r === FeatureRestriction.MESSAGE_LINK).length;
			const embedCount = result.restrictions.filter((r) => r === FeatureRestriction.MESSAGE_EMBED).length;

			expect(linkCount).toBe(1);
			expect(embedCount).toBe(1);
		});
	});
});
