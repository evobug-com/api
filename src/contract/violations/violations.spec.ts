import { beforeEach, describe, expect, it } from "bun:test";
import { ORPCError } from "@orpc/client";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { relations } from "../../db/relations.ts";
import type * as schema from "../../db/schema";
import { type DbUser, type DbViolation, violationsTable } from "../../db/schema";
import {
	AccountStanding,
	FeatureRestriction,
	ReviewOutcome,
	ViolationSeverity,
	ViolationType,
} from "../../utils/violation-utils";
import { createTestContext, createTestDatabase } from "../shared/test-utils";
import { createUser } from "../users";
import {
	bulkExpireViolations,
	expireViolation,
	getViolation,
	issueViolation,
	listViolations,
	updateViolationReview,
} from "./index";

describe("Violations", () => {
	let db: BunSQLDatabase<typeof schema, typeof relations>;
	let testUser: Omit<DbUser, "password" | "email">;
	let issuerUser: Omit<DbUser, "password" | "email">;
	let reviewerUser: Omit<DbUser, "password" | "email">;
	const testGuildId = "test-guild-123";

	beforeEach(async () => {
		db = await createTestDatabase();

		// Create test users
		testUser = await call(createUser, { username: "violationTestUser" }, createTestContext(db));

		issuerUser = await call(createUser, { username: "issuerUser" }, createTestContext(db));

		reviewerUser = await call(createUser, { username: "reviewerUser" }, createTestContext(db));
	});

	describe("issueViolation", () => {
		it("should successfully issue a violation with default settings", async () => {
			const result = await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.SPAM,
					severity: ViolationSeverity.LOW,
					reason: "Spamming chat with repeated messages",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			expect(result.violation).toBeDefined();
			expect(result.violation.userId).toBe(testUser.id);
			expect(result.violation.guildId).toBe(testGuildId);
			expect(result.violation.type).toBe(ViolationType.SPAM);
			expect(result.violation.severity).toBe(ViolationSeverity.LOW);
			expect(result.violation.reason).toBe("Spamming chat with repeated messages");
			expect(result.violation.issuedBy).toBe(issuerUser.id);
			expect(result.violation.expiresAt).toBeInstanceOf(Date);
			expect(result.accountStanding).toBe(AccountStanding.LIMITED);
			expect(result.message).toContain("Violation issued successfully");
		});

		it("should issue violation with custom expiration days", async () => {
			const customDays = 60;
			const result = await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.TOXICITY,
					severity: ViolationSeverity.MEDIUM,
					reason: "Toxic behavior",
					issuedBy: issuerUser.id,
					expiresInDays: customDays,
				},
				createTestContext(db, issuerUser),
			);

			if (!result.violation.expiresAt) {
				throw new Error("Expected violation to have expiration date");
			}
			const expiresAt = new Date(result.violation.expiresAt);
			const now = new Date();
			const diffInDays = Math.round((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

			expect(diffInDays).toBeGreaterThanOrEqual(customDays - 1);
			expect(diffInDays).toBeLessThanOrEqual(customDays + 1);
		});

		it("should apply appropriate restrictions based on violation type", async () => {
			const result = await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.NSFW,
					severity: ViolationSeverity.HIGH,
					reason: "Posting NSFW content",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			if (!result.violation.restrictions) {
				throw new Error("Expected violation to have restrictions");
			}
			const restrictions = JSON.parse(result.violation.restrictions);
			expect(restrictions).toContain(FeatureRestriction.MESSAGE_ATTACH);
			expect(restrictions).toContain(FeatureRestriction.MESSAGE_EMBED);
			expect(restrictions).toContain(FeatureRestriction.VOICE_VIDEO);
			expect(restrictions).toContain(FeatureRestriction.VOICE_STREAM);
		});

		it("should include custom restrictions when provided", async () => {
			const customRestrictions = [FeatureRestriction.VOICE_SPEAK, FeatureRestriction.THREAD_CREATE];

			const result = await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.OTHER,
					severity: ViolationSeverity.LOW,
					reason: "Custom violation",
					issuedBy: issuerUser.id,
					restrictions: customRestrictions,
				},
				createTestContext(db, issuerUser),
			);

			if (!result.violation.restrictions) {
				throw new Error("Expected violation to have restrictions");
			}
			const restrictions = JSON.parse(result.violation.restrictions);
			expect(restrictions).toEqual(customRestrictions);
		});

		it("should include optional fields when provided", async () => {
			const result = await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.PRIVACY,
					severity: ViolationSeverity.HIGH,
					reason: "Sharing private information",
					policyViolated: "Privacy Policy Section 3.2",
					contentSnapshot: "User shared: [redacted personal info]",
					context: "In #general channel during heated discussion",
					actionsApplied: ["message_deleted", "user_warned"],
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			expect(result.violation.policyViolated).toBe("Privacy Policy Section 3.2");
			expect(result.violation.contentSnapshot).toBe("User shared: [redacted personal info]");
			expect(result.violation.context).toBe("In #general channel during heated discussion");
			if (!result.violation.actionsApplied) {
				throw new Error("Expected violation to have actionsApplied");
			}
			expect(JSON.parse(result.violation.actionsApplied)).toEqual(["message_deleted", "user_warned"]);
		});

		it("should calculate SUSPENDED standing for critical violations", async () => {
			const result = await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.ILLEGAL,
					severity: ViolationSeverity.CRITICAL,
					reason: "Illegal content",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			expect(result.accountStanding).toBe(AccountStanding.SUSPENDED);
		});

		it("should escalate standing with multiple violations", async () => {
			// First violation - LOW
			const result1 = await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.SPAM,
					severity: ViolationSeverity.LOW,
					reason: "First offense",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);
			expect(result1.accountStanding).toBe(AccountStanding.LIMITED);

			// Second violation - MEDIUM (total score: 10 + 25 = 35, still LIMITED)
			const result2 = await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.TOXICITY,
					severity: ViolationSeverity.MEDIUM,
					reason: "Second offense",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);
			expect(result2.accountStanding).toBe(AccountStanding.LIMITED);

			// Third violation - HIGH
			const result3 = await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.NSFW,
					severity: ViolationSeverity.HIGH,
					reason: "Third offense",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);
			expect(result3.accountStanding).toBe(AccountStanding.AT_RISK);
		});

		it("should fail when issuer does not exist", async () => {
			expect(
				call(
					issueViolation,
					{
						userId: testUser.id,
						guildId: testGuildId,
						type: ViolationType.SPAM,
						severity: ViolationSeverity.LOW,
						reason: "Test",
						issuedBy: 999999,
					},
					createTestContext(db),
				),
			).rejects.toThrow(
				new ORPCError("NOT_FOUND", {
					message: "Issuer not found or does not have permission to issue violations / issueViolation",
				}),
			);
		});

		it("should fail when user does not exist", async () => {
			expect(
				call(
					issueViolation,
					{
						userId: 999999,
						guildId: testGuildId,
						type: ViolationType.SPAM,
						severity: ViolationSeverity.LOW,
						reason: "Test",
						issuedBy: issuerUser.id,
					},
					createTestContext(db, issuerUser),
				),
			).rejects.toThrow(
				new ORPCError("NOT_FOUND", { message: "User to be issued a violation not found / issueViolation" }),
			);
		});

		it("should handle ban evasion with appropriate restrictions", async () => {
			const result = await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.EVASION,
					severity: ViolationSeverity.CRITICAL,
					reason: "Ban evasion detected",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			if (!result.violation.restrictions) {
				throw new Error("Expected violation to have restrictions");
			}
			const restrictions = JSON.parse(result.violation.restrictions);
			expect(restrictions).toContain(FeatureRestriction.TIMEOUT);
			expect(result.accountStanding).toBe(AccountStanding.SUSPENDED);
		});
	});

	describe("listViolations", () => {
		it("should list active violations for a user", async () => {
			// Create multiple violations for testing
			await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.SPAM,
					severity: ViolationSeverity.LOW,
					reason: "Test violation 1",
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
					reason: "Test violation 2",
					issuedBy: issuerUser.id,
					expiresInDays: 60,
				},
				createTestContext(db, issuerUser),
			);

			// Create expired violation
			const expiredViolation = await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.ADVERTISING,
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
				.where(eq(violationsTable.id, expiredViolation.violation.id));
			const result = await call(
				listViolations,
				{
					userId: testUser.id,
					guildId: testGuildId,
					includeExpired: false,
				},
				createTestContext(db),
			);

			expect(result.violations).toHaveLength(2);
			expect(result.total).toBe(2);
			// LOW (10) + MEDIUM (25) = 35 points, which is LIMITED range (25-49)
			expect(result.accountStanding).toBe(AccountStanding.LIMITED);
		});

		it("should include expired violations when requested", async () => {
			// Create multiple violations for testing
			await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.SPAM,
					severity: ViolationSeverity.LOW,
					reason: "Test violation 1",
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
					reason: "Test violation 2",
					issuedBy: issuerUser.id,
					expiresInDays: 60,
				},
				createTestContext(db, issuerUser),
			);

			// Create expired violation
			const expiredViolation = await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.ADVERTISING,
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
				.where(eq(violationsTable.id, expiredViolation.violation.id));

			const result = await call(
				listViolations,
				{
					userId: testUser.id,
					guildId: testGuildId,
					includeExpired: true,
				},
				createTestContext(db),
			);

			expect(result.violations).toHaveLength(3);
			expect(result.total).toBe(3);
		});

		it("should list all violations for a guild when no userId provided", async () => {
			// Create violations for the main test user
			await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.SPAM,
					severity: ViolationSeverity.LOW,
					reason: "Test violation 1",
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
					reason: "Test violation 2",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			// Create violation for another user
			const otherUser = await call(createUser, { username: "otherViolationUser" }, createTestContext(db));

			await call(
				issueViolation,
				{
					userId: otherUser.id,
					guildId: testGuildId,
					type: ViolationType.NSFW,
					severity: ViolationSeverity.HIGH,
					reason: "Other user violation",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);

			const result = await call(
				listViolations,
				{
					guildId: testGuildId,
					includeExpired: false,
				},
				createTestContext(db),
			);

			expect(result.violations.length).toBeGreaterThanOrEqual(3);
			expect(result.accountStanding).toBeUndefined();
		});

		it("should respect limit and offset parameters", async () => {
			// Create multiple violations for testing
			for (let i = 0; i < 5; i++) {
				await call(
					issueViolation,
					{
						userId: testUser.id,
						guildId: testGuildId,
						type: ViolationType.SPAM,
						severity: ViolationSeverity.LOW,
						reason: `Test violation ${i}`,
						issuedBy: issuerUser.id,
						expiresInDays: 30,
					},
					createTestContext(db, issuerUser),
				);
			}

			const result = await call(
				listViolations,
				{
					userId: testUser.id,
					guildId: testGuildId,
					includeExpired: true,
					limit: 2,
					offset: 1,
				},
				createTestContext(db),
			);

			expect(result.violations).toHaveLength(2);
		});

		it("should return violations in descending order by issuedAt", async () => {
			// Create violations with small delays to ensure different timestamps
			for (let i = 0; i < 3; i++) {
				await call(
					issueViolation,
					{
						userId: testUser.id,
						guildId: testGuildId,
						type: ViolationType.SPAM,
						severity: ViolationSeverity.LOW,
						reason: `Test violation ${i}`,
						issuedBy: issuerUser.id,
					},
					createTestContext(db, issuerUser),
				);
				// Small delay to ensure different timestamps
				await new Promise((resolve) => setTimeout(resolve, 10));
			}

			const result = await call(
				listViolations,
				{
					userId: testUser.id,
					guildId: testGuildId,
					includeExpired: true,
				},
				createTestContext(db),
			);

			for (let i = 0; i < result.violations.length - 1; i++) {
				const currentViolation = result.violations[i];
				const nextViolation = result.violations[i + 1];
				if (!currentViolation) throw new Error("Current violation is undefined");
				if (!nextViolation) throw new Error("Next violation is undefined");
				// Ensure current issuedAt is >= next issuedAt
				const current = new Date(currentViolation.issuedAt);
				const next = new Date(nextViolation.issuedAt);
				expect(current.getTime()).toBeGreaterThanOrEqual(next.getTime());
			}
		});
	});

	describe("getViolation", () => {
		let violation: DbViolation;

		beforeEach(async () => {
			const result = await call(
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
			violation = result.violation;
		});

		it("should retrieve a specific violation by ID", async () => {
			const result = await call(getViolation, { violationId: violation.id }, createTestContext(db));

			expect(result.id).toBe(violation.id);
			expect(result.userId).toBe(testUser.id);
			expect(result.guildId).toBe(testGuildId);
			expect(result.type).toBe(ViolationType.SPAM);
		});

		it("should fail when violation does not exist", async () => {
			expect(call(getViolation, { violationId: 999999 }, createTestContext(db))).rejects.toThrow(
				new ORPCError("NOT_FOUND", { message: "Violation not found for the given ID / getViolation" }),
			);
		});
	});

	describe("expireViolation", () => {
		let violation: DbViolation;

		beforeEach(async () => {
			const result = await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.SPAM,
					severity: ViolationSeverity.LOW,
					reason: "Test violation",
					issuedBy: issuerUser.id,
					expiresInDays: 30,
				},
				createTestContext(db, issuerUser),
			);
			violation = result.violation;
		});

		it("should expire an active violation", async () => {
			const result = await call(
				expireViolation,
				{
					violationId: violation.id,
					expiredBy: reviewerUser.id,
				},
				createTestContext(db, reviewerUser),
			);

			expect(result.success).toBe(true);
			expect(result.message).toBe("Violation expired successfully");

			// Verify the violation is expired
			const expiredViolation = await db.query.violationsTable.findFirst({
				where: { id: violation.id },
			});

			expect(expiredViolation?.expiresAt).toBeDefined();
			if (!expiredViolation?.expiresAt) {
				throw new Error("Expected violation to have expiration date");
			}
			expect(new Date(expiredViolation.expiresAt).getTime()).toBeLessThanOrEqual(Date.now());
		});

		it("should fail when violation does not exist", async () => {
			expect(
				call(
					expireViolation,
					{
						violationId: 999999,
						expiredBy: reviewerUser.id,
					},
					createTestContext(db, reviewerUser),
				),
			).rejects.toThrow(
				new ORPCError("NOT_FOUND", { message: "Violation not found for the given ID / expireViolation" }),
			);
		});

		it("should fail when violation is already expired", async () => {
			// First expire the violation
			await call(
				expireViolation,
				{
					violationId: violation.id,
					expiredBy: reviewerUser.id,
				},
				createTestContext(db, reviewerUser),
			);

			// Try to expire again
			expect(() => {
				return call(
					expireViolation,
					{
						violationId: violation.id,
						expiredBy: reviewerUser.id,
					},
					createTestContext(db, reviewerUser),
				);
			}).toThrow(new ORPCError("CONFLICT", { message: "Violation is already expired" }));
		});
	});

	describe("updateViolationReview", () => {
		let violation: DbViolation;

		beforeEach(async () => {
			const result = await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: testGuildId,
					type: ViolationType.TOXICITY,
					severity: ViolationSeverity.MEDIUM,
					reason: "Test violation for review",
					issuedBy: issuerUser.id,
				},
				createTestContext(db, issuerUser),
			);
			violation = result.violation;
		});

		it("should approve a violation review", async () => {
			const result = await call(
				updateViolationReview,
				{
					violationId: violation.id,
					reviewedBy: reviewerUser.id,
					outcome: ReviewOutcome.APPROVED,
					notes: "Violation was justified",
				},
				createTestContext(db, reviewerUser),
			);

			expect(result.success).toBe(true);
			expect(result.violation.reviewOutcome).toBe(ReviewOutcome.APPROVED);
			expect(result.violation.reviewedBy).toBe(reviewerUser.id);
			expect(result.violation.reviewNotes).toBe("Violation was justified");
			expect(result.violation.reviewedAt).toBeInstanceOf(Date);
		});

		it("should reject a violation and expire it", async () => {
			const result = await call(
				updateViolationReview,
				{
					violationId: violation.id,
					reviewedBy: reviewerUser.id,
					outcome: ReviewOutcome.REJECTED,
					notes: "False positive",
				},
				createTestContext(db, reviewerUser),
			);

			expect(result.success).toBe(true);
			expect(result.violation.reviewOutcome).toBe(ReviewOutcome.REJECTED);
			expect(result.violation.expiresAt).toBeDefined();
			if (!result.violation.expiresAt) {
				throw new Error("Expected violation to have expiration date");
			}
			expect(new Date(result.violation.expiresAt).getTime()).toBeLessThanOrEqual(Date.now());
		});

		it("should update to pending status", async () => {
			const result = await call(
				updateViolationReview,
				{
					violationId: violation.id,
					reviewedBy: reviewerUser.id,
					outcome: ReviewOutcome.PENDING,
					notes: "Needs further investigation",
				},
				createTestContext(db, reviewerUser),
			);

			expect(result.success).toBe(true);
			expect(result.violation.reviewOutcome).toBe(ReviewOutcome.PENDING);
		});

		it("should fail when violation does not exist", async () => {
			expect(
				call(
					updateViolationReview,
					{
						violationId: 999999,
						reviewedBy: reviewerUser.id,
						outcome: ReviewOutcome.APPROVED,
					},
					createTestContext(db, reviewerUser),
				),
			).rejects.toThrow(
				new ORPCError("NOT_FOUND", { message: "Violation not found for the given ID / updateViolationReview" }),
			);
		});
	});

	describe("bulkExpireViolations", () => {
		it("should bulk expire violations before current date", async () => {
			// Create multiple violations with different expiration dates
			const yesterday = new Date();
			yesterday.setDate(yesterday.getDate() - 1);

			const tomorrow = new Date();
			tomorrow.setDate(tomorrow.getDate() + 1);

			// Create expired violations
			for (let i = 0; i < 3; i++) {
				const result = await call(
					issueViolation,
					{
						userId: testUser.id,
						guildId: testGuildId,
						type: ViolationType.SPAM,
						severity: ViolationSeverity.LOW,
						reason: `Expired violation ${i}`,
						issuedBy: issuerUser.id,
						expiresInDays: 1,
					},
					createTestContext(db, issuerUser),
				);

				await db
					.update(violationsTable)
					.set({ expiresAt: yesterday })
					.where(eq(violationsTable.id, result.violation.id));
			}

			// Create active violations
			for (let i = 0; i < 2; i++) {
				await call(
					issueViolation,
					{
						userId: testUser.id,
						guildId: testGuildId,
						type: ViolationType.TOXICITY,
						severity: ViolationSeverity.MEDIUM,
						reason: `Active violation ${i}`,
						issuedBy: issuerUser.id,
						expiresInDays: 30,
					},
					createTestContext(db, issuerUser),
				);
			}

			const result = await call(bulkExpireViolations, { guildId: testGuildId }, createTestContext(db));

			expect(result.success).toBe(true);
			expect(result.expiredCount).toBe(3);
			expect(result.message).toBe("Expired 3 violations");
		});

		it("should bulk expire violations before specific date", async () => {
			// Create violations with different expiration dates
			for (let i = 0; i < 5; i++) {
				await call(
					issueViolation,
					{
						userId: testUser.id,
						guildId: testGuildId,
						type: ViolationType.SPAM,
						severity: ViolationSeverity.LOW,
						reason: `Test violation ${i}`,
						issuedBy: issuerUser.id,
						expiresInDays: i + 10, // Different expiration days
					},
					createTestContext(db, issuerUser),
				);
			}

			const futureDate = new Date();
			futureDate.setDate(futureDate.getDate() + 40);

			const result = await call(
				bulkExpireViolations,
				{
					guildId: testGuildId,
					beforeDate: futureDate,
				},
				createTestContext(db),
			);

			expect(result.success).toBe(true);
			expect(result.expiredCount).toBe(5); // All violations should be expired
		});

		it("should return zero when no violations to expire", async () => {
			// Don't create any violations, just test on empty database
			const freshGuildId = `fresh-guild-${Date.now()}`;

			const result = await call(bulkExpireViolations, { guildId: freshGuildId }, createTestContext(db));

			expect(result.success).toBe(true);
			expect(result.expiredCount).toBe(0);
			expect(result.message).toBe("Expired 0 violations");
		});

		it("should only expire violations for specified guild", async () => {
			const otherGuildId = "other-guild-456";

			// Create violation for another guild
			await call(
				issueViolation,
				{
					userId: testUser.id,
					guildId: otherGuildId,
					type: ViolationType.SPAM,
					severity: ViolationSeverity.LOW,
					reason: "Other guild violation",
					issuedBy: issuerUser.id,
					expiresInDays: 1,
				},
				createTestContext(db, issuerUser),
			);

			const _result = await call(bulkExpireViolations, { guildId: testGuildId }, createTestContext(db));

			// Should not affect other guild's violations
			const otherGuildViolations = await db.query.violationsTable.findMany({
				where: { guildId: otherGuildId },
			});

			expect(otherGuildViolations.length).toBe(1);
			expect(otherGuildViolations[0]?.expiresAt).toBeDefined();
			if (!otherGuildViolations[0]?.expiresAt) {
				throw new Error("Expected violation to have expiration date");
			}
			expect(new Date(otherGuildViolations[0].expiresAt).getTime()).toBeGreaterThan(Date.now());
		});
	});

	describe("Edge cases and error handling", () => {
		it("should handle empty reason gracefully", async () => {
			expect(
				call(
					issueViolation,
					{
						userId: testUser.id,
						guildId: testGuildId,
						type: ViolationType.SPAM,
						severity: ViolationSeverity.LOW,
						reason: "",
						issuedBy: issuerUser.id,
					},
					createTestContext(db, issuerUser),
				),
			).rejects.toThrow();
		});

		it("should handle invalid violation type", async () => {
			expect(
				call(
					issueViolation,
					{
						userId: testUser.id,
						guildId: testGuildId,
						type: "INVALID_TYPE" as ViolationType,
						severity: ViolationSeverity.LOW,
						reason: "Test",
						issuedBy: issuerUser.id,
					},
					createTestContext(db, issuerUser),
				),
			).rejects.toThrow();
		});

		it("should handle invalid severity", async () => {
			expect(
				call(
					issueViolation,
					{
						userId: testUser.id,
						guildId: testGuildId,
						type: ViolationType.SPAM,
						severity: "INVALID_SEVERITY" as ViolationSeverity,
						reason: "Test",
						issuedBy: issuerUser.id,
					},
					createTestContext(db, issuerUser),
				),
			).rejects.toThrow();
		});

		it("should handle very long reason text", async () => {
			const longReason = "a".repeat(1001);

			expect(
				call(
					issueViolation,
					{
						userId: testUser.id,
						guildId: testGuildId,
						type: ViolationType.SPAM,
						severity: ViolationSeverity.LOW,
						reason: longReason,
						issuedBy: issuerUser.id,
					},
					createTestContext(db, issuerUser),
				),
			).rejects.toThrow();
		});

		it("should handle negative expiration days", async () => {
			expect(
				call(
					issueViolation,
					{
						userId: testUser.id,
						guildId: testGuildId,
						type: ViolationType.SPAM,
						severity: ViolationSeverity.LOW,
						reason: "Test",
						issuedBy: issuerUser.id,
						expiresInDays: -1,
					},
					createTestContext(db, issuerUser),
				),
			).rejects.toThrow();
		});
	});
});
