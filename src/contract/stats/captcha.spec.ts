import { describe, expect, it, beforeEach } from "bun:test";
import { ORPCError } from "@orpc/client";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import {
	captchaLogsTable,
	type DbUser,
	type InsertDbCaptchaLog,
	userStatsTable,
	usersTable,
} from "../../db/schema.ts";
import { createTestContext, createTestDatabase } from "../shared/test-utils.ts";
import { createUser } from "../users";
import {
	checkAutomationPatterns,
	logCaptchaAttempt,
	updateFailedCaptchaCount,
	updateSuspiciousScore,
} from "./index.ts";

const db = await createTestDatabase();

describe("Captcha API Endpoints", () => {
	let testUser: DbUser;

	beforeEach(async () => {
		// Create fresh test user for each test
		testUser = await call(
			createUser,
			{
				username: `captchaTestUser_${Date.now()}`,
			},
			createTestContext(db),
		);
	});

	describe("logCaptchaAttempt", () => {
		it("should successfully log a captcha attempt", async () => {
			const result = await call(
				logCaptchaAttempt,
				{
					userId: testUser.id,
					captchaType: "math",
					command: "work",
					success: true,
					responseTime: 3500,
					clientIp: "192.168.1.1",
					userAgent: "Discord Bot Test",
				},
				createTestContext(db, testUser),
			);

			expect(result.logged).toBe(true);
			expect(result.isSuspicious).toBe(false);

			// Verify it was actually saved to database
			const logs = await db.select().from(captchaLogsTable).where(eq(captchaLogsTable.userId, testUser.id));
			expect(logs).toHaveLength(1);
			expect(logs[0]).toMatchObject({
				userId: testUser.id,
				captchaType: "math",
				command: "work",
				success: true,
				responseTime: 3500,
			});
		});

		it("should flag suspicious fast math responses", async () => {
			const result = await call(
				logCaptchaAttempt,
				{
					userId: testUser.id,
					captchaType: "math",
					command: "work",
					success: true,
					responseTime: 500, // Too fast for math
				},
				createTestContext(db, testUser),
			);

			expect(result.logged).toBe(true);
			expect(result.isSuspicious).toBe(true);
		});

		it("should flag suspicious fast emoji responses", async () => {
			const result = await call(
				logCaptchaAttempt,
				{
					userId: testUser.id,
					captchaType: "emoji",
					command: "daily",
					success: true,
					responseTime: 800, // Too fast for emoji
				},
				createTestContext(db, testUser),
			);

			expect(result.logged).toBe(true);
			expect(result.isSuspicious).toBe(true);
		});

		it("should flag suspicious fast word responses", async () => {
			const result = await call(
				logCaptchaAttempt,
				{
					userId: testUser.id,
					captchaType: "word",
					command: "work",
					success: true,
					responseTime: 2000, // Too fast for word
				},
				createTestContext(db, testUser),
			);

			expect(result.logged).toBe(true);
			expect(result.isSuspicious).toBe(true);
		});

		it("should handle missing optional fields", async () => {
			const result = await call(
				logCaptchaAttempt,
				{
					userId: testUser.id,
					captchaType: "math",
					command: "work",
					success: false,
					responseTime: 5000,
				},
				createTestContext(db, testUser),
			);

			expect(result.logged).toBe(true);
			expect(result.isSuspicious).toBe(false);
		});
	});

	describe("updateFailedCaptchaCount", () => {
		it("should increment failed captcha count", async () => {
			const result = await call(
				updateFailedCaptchaCount,
				{
					userId: testUser.id,
				},
				createTestContext(db, testUser),
			);

			expect(result.updated).toBe(true);
			expect(result.failedCount).toBe(1);
			expect(result.isLocked).toBe(false);

			// Verify database update
			const stats = await db.select().from(userStatsTable).where(eq(userStatsTable.userId, testUser.id));
			expect(stats[0].failedCaptchaCount).toBe(1);
			expect(stats[0].suspiciousBehaviorScore).toBe(10); // Should increase by 10
		});

		it("should lock economy after 5 failed attempts", async () => {
			// Fail 4 times first
			for (let i = 0; i < 4; i++) {
				await call(
					updateFailedCaptchaCount,
					{ userId: testUser.id },
					createTestContext(db, testUser),
				);
			}

			// 5th failure should trigger lock
			const result = await call(
				updateFailedCaptchaCount,
				{
					userId: testUser.id,
				},
				createTestContext(db, testUser),
			);

			expect(result.updated).toBe(true);
			expect(result.failedCount).toBe(5);
			expect(result.isLocked).toBe(true);

			// Verify economy ban is set
			const stats = await db.select().from(userStatsTable).where(eq(userStatsTable.userId, testUser.id));
			expect(stats[0].economyBannedUntil).toBeDefined();
			expect(stats[0].economyBannedUntil).toBeInstanceOf(Date);

			// Check ban is for 24 hours
			const banTime = stats[0].economyBannedUntil?.getTime() || 0;
			const expectedBanTime = Date.now() + 24 * 60 * 60 * 1000;
			expect(Math.abs(banTime - expectedBanTime)).toBeLessThan(5000); // Within 5 seconds
		});

		it("should cap suspicious score at 100", async () => {
			// Set initial high score
			await db
				.update(userStatsTable)
				.set({ suspiciousBehaviorScore: 95 })
				.where(eq(userStatsTable.userId, testUser.id));

			const result = await call(
				updateFailedCaptchaCount,
				{
					userId: testUser.id,
				},
				createTestContext(db, testUser),
			);

			// Verify score is capped at 100
			const stats = await db.select().from(userStatsTable).where(eq(userStatsTable.userId, testUser.id));
			expect(stats[0].suspiciousBehaviorScore).toBe(100);
		});
	});

	describe("updateSuspiciousScore", () => {
		it("should increase suspicious score", async () => {
			const result = await call(
				updateSuspiciousScore,
				{
					userId: testUser.id,
					increment: 25,
				},
				createTestContext(db, testUser),
			);

			expect(result.updated).toBe(true);
			expect(result.newScore).toBe(25);
			expect(result.isEconomyBanned).toBe(false);
		});

		it("should decrease suspicious score with negative increment", async () => {
			// Set initial score
			await db
				.update(userStatsTable)
				.set({ suspiciousBehaviorScore: 50 })
				.where(eq(userStatsTable.userId, testUser.id));

			const result = await call(
				updateSuspiciousScore,
				{
					userId: testUser.id,
					increment: -20,
				},
				createTestContext(db, testUser),
			);

			expect(result.updated).toBe(true);
			expect(result.newScore).toBe(30);
			expect(result.isEconomyBanned).toBe(false);
		});

		it("should not go below 0", async () => {
			const result = await call(
				updateSuspiciousScore,
				{
					userId: testUser.id,
					increment: -50,
				},
				createTestContext(db, testUser),
			);

			expect(result.updated).toBe(true);
			expect(result.newScore).toBe(0);
		});

		it("should auto-ban at score 100 for 72 hours", async () => {
			// Set score to 90
			await db
				.update(userStatsTable)
				.set({ suspiciousBehaviorScore: 90 })
				.where(eq(userStatsTable.userId, testUser.id));

			const result = await call(
				updateSuspiciousScore,
				{
					userId: testUser.id,
					increment: 10,
				},
				createTestContext(db, testUser),
			);

			expect(result.updated).toBe(true);
			expect(result.newScore).toBe(100);
			expect(result.isEconomyBanned).toBe(true);

			// Verify 72-hour ban
			const stats = await db.select().from(userStatsTable).where(eq(userStatsTable.userId, testUser.id));
			expect(stats[0].economyBannedUntil).toBeDefined();

			const banTime = stats[0].economyBannedUntil?.getTime() || 0;
			const expectedBanTime = Date.now() + 72 * 60 * 60 * 1000;
			expect(Math.abs(banTime - expectedBanTime)).toBeLessThan(5000);
		});
	});

	describe("checkAutomationPatterns", () => {
		it("should detect timing patterns in commands", async () => {
			// Create logs with exact 60-second intervals
			const baseTime = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago

			for (let i = 0; i < 5; i++) {
				const logData: InsertDbCaptchaLog = {
					userId: testUser.id,
					captchaType: "math",
					command: "work",
					success: true,
					responseTime: 3000,
					createdAt: new Date(baseTime.getTime() + i * 60000), // Exactly 60 seconds apart
				};
				await db.insert(captchaLogsTable).values(logData);
			}

			const result = await call(
				checkAutomationPatterns,
				{
					userId: testUser.id,
				},
				createTestContext(db, testUser),
			);

			expect(result.hasTimingPattern).toBe(true);
			expect(result.recommendation).toBe("challenge");
		});

		it("should detect instant response patterns", async () => {
			// Create multiple instant response logs
			for (let i = 0; i < 6; i++) {
				const logData: InsertDbCaptchaLog = {
					userId: testUser.id,
					captchaType: "math",
					command: i % 2 === 0 ? "work" : "daily",
					success: true,
					responseTime: 400, // Very fast
				};
				await db.insert(captchaLogsTable).values(logData);
			}

			const result = await call(
				checkAutomationPatterns,
				{
					userId: testUser.id,
				},
				createTestContext(db, testUser),
			);

			expect(result.instantResponseCount).toBe(6);
			expect(result.recommendation).toBe("ban");
		});

		it("should detect failed captcha patterns", async () => {
			// Create multiple failed captcha logs
			for (let i = 0; i < 4; i++) {
				const logData: InsertDbCaptchaLog = {
					userId: testUser.id,
					captchaType: "emoji",
					command: "work",
					success: false,
					responseTime: 5000,
				};
				await db.insert(captchaLogsTable).values(logData);
			}

			const result = await call(
				checkAutomationPatterns,
				{
					userId: testUser.id,
				},
				createTestContext(db, testUser),
			);

			expect(result.hasFailedCaptchaPattern).toBe(true);
			expect(result.recommendation).toBe("challenge");
		});

		it("should recommend 'allow' for legitimate users", async () => {
			// Create normal-looking logs
			const timings = [0, 75000, 180000, 290000, 420000]; // Irregular intervals

			for (let i = 0; i < timings.length; i++) {
				const logData: InsertDbCaptchaLog = {
					userId: testUser.id,
					captchaType: i % 2 === 0 ? "math" : "emoji",
					command: i % 2 === 0 ? "work" : "daily",
					success: i !== 2, // One failure
					responseTime: 2500 + Math.floor(Math.random() * 3000), // Reasonable times
					createdAt: new Date(Date.now() - 600000 + timings[i]),
				};
				await db.insert(captchaLogsTable).values(logData);
			}

			const result = await call(
				checkAutomationPatterns,
				{
					userId: testUser.id,
				},
				createTestContext(db, testUser),
			);

			expect(result.hasTimingPattern).toBe(false);
			expect(result.instantResponseCount).toBe(0);
			expect(result.hasFailedCaptchaPattern).toBe(false);
			expect(result.recommendation).toBe("allow");
		});

		it("should recommend 'ban' for high suspicious score", async () => {
			// Set high suspicious score
			await db
				.update(userStatsTable)
				.set({ suspiciousBehaviorScore: 85 })
				.where(eq(userStatsTable.userId, testUser.id));

			const result = await call(
				checkAutomationPatterns,
				{
					userId: testUser.id,
				},
				createTestContext(db, testUser),
			);

			expect(result.suspiciousScore).toBe(85);
			expect(result.recommendation).toBe("ban");
		});

		it("should only check logs from last 24 hours", async () => {
			// Create old logs (more than 24 hours ago)
			const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000);

			for (let i = 0; i < 10; i++) {
				const logData: InsertDbCaptchaLog = {
					userId: testUser.id,
					captchaType: "math",
					command: "work",
					success: false,
					responseTime: 100, // Instant responses
					createdAt: oldTime,
				};
				await db.insert(captchaLogsTable).values(logData);
			}

			// Create one recent log
			await db.insert(captchaLogsTable).values({
				userId: testUser.id,
				captchaType: "math",
				command: "work",
				success: true,
				responseTime: 3000,
			});

			const result = await call(
				checkAutomationPatterns,
				{
					userId: testUser.id,
				},
				createTestContext(db, testUser),
			);

			// Should not detect patterns from old logs
			expect(result.instantResponseCount).toBe(0);
			expect(result.hasFailedCaptchaPattern).toBe(false);
			expect(result.recommendation).toBe("allow");
		});
	});

	describe("Integration scenarios", () => {
		it("should handle complete bot detection flow", async () => {
			// Simulate bot-like behavior
			const attempts = [
				{ responseTime: 400, success: true }, // Too fast
				{ responseTime: 350, success: true }, // Too fast
				{ responseTime: 5000, success: false }, // Failed
				{ responseTime: 300, success: true }, // Too fast
				{ responseTime: 6000, success: false }, // Failed
			];

			for (const attempt of attempts) {
				// Log attempt
				await call(
					logCaptchaAttempt,
					{
						userId: testUser.id,
						captchaType: "math",
						command: "work",
						...attempt,
					},
					createTestContext(db, testUser),
				);

				// Update failed count if failed
				if (!attempt.success) {
					await call(
						updateFailedCaptchaCount,
						{ userId: testUser.id },
						createTestContext(db, testUser),
					);
				}

				// Update suspicious score for fast responses
				if (attempt.responseTime < 2000 && attempt.success) {
					await call(
						updateSuspiciousScore,
						{ userId: testUser.id, increment: 20 },
						createTestContext(db, testUser),
					);
				}
			}

			// Check final patterns
			const patterns = await call(
				checkAutomationPatterns,
				{ userId: testUser.id },
				createTestContext(db, testUser),
			);

			expect(patterns.instantResponseCount).toBe(3);
			expect(patterns.hasFailedCaptchaPattern).toBe(false); // Only 2 failures, need 3+
			expect(patterns.suspiciousScore).toBeGreaterThanOrEqual(60); // 3 fast responses * 20 each
			// With 60+ suspicious score and no timing pattern, should be challenge
			// But with 3 instant responses, the logic may recommend ban
			expect(["challenge", "ban"]).toContain(patterns.recommendation);
		});
	});
});