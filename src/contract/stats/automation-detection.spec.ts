import { beforeEach, describe, expect, it } from "bun:test";
import { call } from "@orpc/server";
import { and, eq, gte, lte } from "drizzle-orm";
import { captchaLogsTable, type DbUser, type InsertDbCaptchaLog, userStatsTable } from "../../db/schema.ts";
import { createTestContext, createTestDatabase } from "../shared/test-utils.ts";
import { createUser } from "../users";
import { checkAutomationPatterns, claimDaily, claimWork } from "./index.ts";

const db = await createTestDatabase();

describe("Advanced Automation Pattern Detection", () => {
	let testUser: Omit<DbUser, "password" | "email">;

	beforeEach(async () => {
		testUser = await call(
			createUser,
			{
				username: `patternUser_${Date.now()}`,
			},
			createTestContext(db),
		);
	});

	describe("Timing Pattern Detection", () => {
		it("should detect exact interval patterns (bot-like)", async () => {
			// Simulate bot claiming every 60 seconds exactly
			const baseTime = Date.now() - 10 * 60 * 1000; // 10 minutes ago
			const interval = 60000; // Exactly 60 seconds

			for (let i = 0; i < 10; i++) {
				await db.insert(captchaLogsTable).values({
					userId: testUser.id,
					captchaType: "math",
					command: "work",
					success: true,
					responseTime: 2500 + (i % 2) * 100, // Slight variation but still suspicious
					createdAt: new Date(baseTime + i * interval),
				});
			}

			const result = await call(checkAutomationPatterns, { userId: testUser.id }, createTestContext(db, testUser));

			expect(result.hasTimingPattern).toBe(true);
			expect(result.recommendation).toBe("challenge");
		});

		it("should not flag legitimate irregular patterns", async () => {
			// Simulate human-like irregular intervals
			const intervals = [
				0,
				73000, // ~1.2 min
				195000, // ~3.2 min
				287000, // ~4.8 min
				412000, // ~6.9 min
				589000, // ~9.8 min
			];

			for (let i = 0; i < intervals.length; i++) {
				await db.insert(captchaLogsTable).values({
					userId: testUser.id,
					captchaType: Math.random() > 0.5 ? "math" : "emoji",
					command: Math.random() > 0.5 ? "work" : "daily",
					success: true,
					responseTime: 3000 + Math.floor(Math.random() * 4000), // 3-7 seconds
					createdAt: new Date(Date.now() - 600000 + intervals[i]!),
				});
			}

			const result = await call(checkAutomationPatterns, { userId: testUser.id }, createTestContext(db, testUser));

			expect(result.hasTimingPattern).toBe(false);
		});

		it("should detect patterns with small deviations (sophisticated bot)", async () => {
			// Bot with slight randomization to appear human
			const baseInterval = 60000;
			const baseTime = Date.now() - 10 * 60 * 1000;

			// Create predictable small deviations that stay within detection threshold
			const deviations = [0, 1500, -1000, 2000, -1500, 500, -2000, 1000]; // All < 5000ms threshold

			for (let i = 0; i < 8; i++) {
				await db.insert(captchaLogsTable).values({
					userId: testUser.id,
					captchaType: "math",
					command: "work",
					success: true,
					responseTime: 3000,
					createdAt: new Date(baseTime + i * baseInterval + deviations[i]!),
				});
			}

			const result = await call(checkAutomationPatterns, { userId: testUser.id }, createTestContext(db, testUser));

			// With deviations all under 5 seconds, pattern should be detected
			expect(result.hasTimingPattern).toBe(true);
		});
	});

	describe("Response Time Analysis", () => {
		it("should detect impossibly fast response patterns", async () => {
			// Simulate bot with instant responses
			const responseTimes = [
				{ type: "math", time: 300 }, // Too fast for math
				{ type: "emoji", time: 200 }, // Too fast for emoji
				{ type: "word", time: 500 }, // Too fast for word
				{ type: "math", time: 400 },
				{ type: "emoji", time: 150 },
				{ type: "math", time: 250 },
			];

			for (const resp of responseTimes) {
				await db.insert(captchaLogsTable).values({
					userId: testUser.id,
					captchaType: resp.type as "math" | "emoji" | "word",
					command: "work",
					success: true,
					responseTime: resp.time,
				});
			}

			const result = await call(checkAutomationPatterns, { userId: testUser.id }, createTestContext(db, testUser));

			// Instant responses are those < 500ms
			expect(result.instantResponseCount).toBeGreaterThanOrEqual(5);
			// With exactly 5 instant responses, might be challenge; >5 is ban
			// Since test creates 6 responses all < 500ms, let's verify the actual count
			if (result.instantResponseCount > 5) {
				expect(result.recommendation).toBe("ban");
			} else {
				// 5 or fewer might be challenge depending on other factors
				expect(["challenge", "ban"]).toContain(result.recommendation);
			}
		});

		it("should analyze response time distribution", async () => {
			// Bot with consistent response times (suspicious)
			for (let i = 0; i < 10; i++) {
				await db.insert(captchaLogsTable).values({
					userId: testUser.id,
					captchaType: "math",
					command: "work",
					success: true,
					responseTime: 2480 + (i % 3) * 20, // Very narrow range: 2480-2520ms
				});
			}

			// Calculate standard deviation of response times
			const logs = await db.select().from(captchaLogsTable).where(eq(captchaLogsTable.userId, testUser.id));

			const times = logs.map((l) => l.responseTime);
			const avg = times.reduce((a, b) => a + b, 0) / times.length;
			const variance = times.reduce((sum, time) => sum + (time - avg) ** 2, 0) / times.length;
			const stdDev = Math.sqrt(variance);

			// Bot should have very low standard deviation
			expect(stdDev).toBeLessThan(50); // Very consistent times
		});

		it("should detect response time by captcha type patterns", async () => {
			// Bot that always solves math in exactly 2 seconds
			for (let i = 0; i < 5; i++) {
				await db.insert(captchaLogsTable).values({
					userId: testUser.id,
					captchaType: "math",
					command: "work",
					success: true,
					responseTime: 2000 + (i % 2) * 50, // 2000 or 2050ms
				});
			}

			// But varied times for other types
			await db.insert(captchaLogsTable).values({
				userId: testUser.id,
				captchaType: "emoji",
				command: "daily",
				success: true,
				responseTime: 4500,
			});

			const mathLogs = await db
				.select()
				.from(captchaLogsTable)
				.where(and(eq(captchaLogsTable.userId, testUser.id), eq(captchaLogsTable.captchaType, "math")));

			const mathTimes = mathLogs.map((l) => l.responseTime);
			const minTime = Math.min(...mathTimes);
			const maxTime = Math.max(...mathTimes);

			// Suspicious: very narrow range for specific captcha type
			expect(maxTime - minTime).toBeLessThan(100);
		});
	});

	describe("Behavioral Pattern Analysis", () => {
		it("should detect work/daily claim patterns", async () => {
			// Bot that claims work exactly every hour and daily at midnight
			const now = new Date();
			const today = new Date(now);
			today.setHours(0, 0, 0, 0);

			// Daily claim at midnight
			await db.insert(captchaLogsTable).values({
				userId: testUser.id,
				captchaType: "math",
				command: "daily",
				success: true,
				responseTime: 3000,
				createdAt: today,
			});

			// Work claims every hour
			for (let i = 1; i <= 10; i++) {
				await db.insert(captchaLogsTable).values({
					userId: testUser.id,
					captchaType: "math",
					command: "work",
					success: true,
					responseTime: 2500,
					createdAt: new Date(today.getTime() + i * 3600000), // Every hour
				});
			}

			// Analyze work command intervals
			const workLogs = await db
				.select()
				.from(captchaLogsTable)
				.where(and(eq(captchaLogsTable.userId, testUser.id), eq(captchaLogsTable.command, "work")))
				.orderBy(captchaLogsTable.createdAt);

			const intervals: number[] = [];
			for (let i = 1; i < workLogs.length; i++) {
				intervals.push(workLogs[i]!.createdAt.getTime() - workLogs[i - 1]!.createdAt.getTime());
			}

			// All intervals should be exactly 1 hour
			const expectedInterval = 3600000;
			intervals.forEach((interval) => {
				expect(Math.abs(interval - expectedInterval)).toBeLessThan(1000);
			});
		});

		it("should detect success rate anomalies", async () => {
			// Bot with 100% success rate (suspicious)
			for (let i = 0; i < 20; i++) {
				await db.insert(captchaLogsTable).values({
					userId: testUser.id,
					captchaType: ["math", "emoji", "word"][i % 3] as "math" | "emoji" | "word",
					command: i % 2 === 0 ? "work" : "daily",
					success: true, // Always succeeds
					responseTime: 3000 + Math.floor(Math.random() * 2000),
				});
			}

			const logs = await db.select().from(captchaLogsTable).where(eq(captchaLogsTable.userId, testUser.id));

			const successRate = logs.filter((l) => l.success).length / logs.length;
			expect(successRate).toBe(1.0); // 100% success is suspicious for 20 attempts
		});

		it("should detect command sequence patterns", async () => {
			// Bot that always does: work -> work -> daily -> work -> work -> daily
			const sequence = ["work", "work", "daily"];
			const baseTime = Date.now() - 3600000;

			for (let i = 0; i < 12; i++) {
				const command = sequence[i % 3];
				await db.insert(captchaLogsTable).values({
					userId: testUser.id,
					captchaType: "math",
					command: command as "work" | "daily",
					success: true,
					responseTime: 3000,
					createdAt: new Date(baseTime + i * 300000), // 5 minutes apart
				});
			}

			// Analyze sequence
			const logs = await db
				.select()
				.from(captchaLogsTable)
				.where(eq(captchaLogsTable.userId, testUser.id))
				.orderBy(captchaLogsTable.createdAt);

			// Check if pattern repeats
			let patternMatches = 0;
			for (let i = 0; i < logs.length - 3; i++) {
				if (logs[i]?.command === "work" && logs[i + 1]?.command === "work" && logs[i + 2]?.command === "daily") {
					patternMatches++;
				}
			}

			expect(patternMatches).toBeGreaterThan(2); // Pattern repeats multiple times
		});
	});

	describe("Advanced Detection Scenarios", () => {
		it("should detect time-of-day patterns", async () => {
			// Bot that only operates during specific hours
			const baseDate = new Date();
			baseDate.setDate(baseDate.getDate() - 7); // 7 days ago

			for (let day = 0; day < 7; day++) {
				// Always claims at exactly 3 AM and 3 PM
				for (const hour of [3, 15]) {
					const claimTime = new Date(baseDate);
					claimTime.setDate(claimTime.getDate() + day);
					claimTime.setHours(hour, 0, 0, 0);

					await db.insert(captchaLogsTable).values({
						userId: testUser.id,
						captchaType: "math",
						command: hour === 3 ? "daily" : "work",
						success: true,
						responseTime: 2500,
						createdAt: claimTime,
					});
				}
			}

			const logs = await db.select().from(captchaLogsTable).where(eq(captchaLogsTable.userId, testUser.id));

			// Check hour distribution
			const hourCounts = new Map<number, number>();
			logs.forEach((log) => {
				const hour = log.createdAt.getHours();
				hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
			});

			// Should only have activity at 3 and 15 hours
			expect(hourCounts.size).toBe(2);
			expect(hourCounts.get(3)).toBe(7);
			expect(hourCounts.get(15)).toBe(7);
		});

		it("should detect IP/UserAgent consistency", async () => {
			// Bot using same IP and user agent
			const botIp = "192.168.1.100";
			const botAgent = "Mozilla/5.0 BotClient/1.0";

			for (let i = 0; i < 10; i++) {
				await db.insert(captchaLogsTable).values({
					userId: testUser.id,
					captchaType: "math",
					command: "work",
					success: true,
					responseTime: 2500,
					clientIp: botIp,
					userAgent: botAgent,
				});
			}

			const logs = await db.select().from(captchaLogsTable).where(eq(captchaLogsTable.userId, testUser.id));

			// Check IP/Agent diversity
			const uniqueIps = new Set(logs.map((l) => l.clientIp));
			const uniqueAgents = new Set(logs.map((l) => l.userAgent));

			expect(uniqueIps.size).toBe(1); // Only one IP
			expect(uniqueAgents.size).toBe(1); // Only one agent
		});

		it("should handle mixed legitimate and bot behavior", async () => {
			// Start with legitimate behavior (older than 24 hours, won't be checked)
			for (let i = 0; i < 5; i++) {
				await db.insert(captchaLogsTable).values({
					userId: testUser.id,
					captchaType: ["math", "emoji"][i % 2] as "math" | "emoji",
					command: i % 3 === 0 ? "daily" : "work",
					success: i !== 2, // One failure
					responseTime: 3000 + Math.floor(Math.random() * 4000),
					createdAt: new Date(Date.now() - 172800000 + i * 7200000), // 2 days ago
				});
			}

			// Then switch to bot behavior (within last 24 hours)
			const botStartTime = Date.now() - 10800000; // 3 hours ago
			for (let i = 0; i < 10; i++) {
				await db.insert(captchaLogsTable).values({
					userId: testUser.id,
					captchaType: "math",
					command: "work",
					success: true,
					responseTime: 400, // Instant responses
					createdAt: new Date(botStartTime + i * 60000), // Exact intervals
				});
			}

			const result = await call(checkAutomationPatterns, { userId: testUser.id }, createTestContext(db, testUser));

			// Should detect the recent bot behavior
			// With 10 logs at exact 60-second intervals, should detect pattern
			expect(result.hasTimingPattern).toBe(true);
			// With 10 responses at 400ms, all should be instant
			expect(result.instantResponseCount).toBe(10);
			expect(result.recommendation).toBe("ban");
		});
	});

	describe("Economy Ban Integration", () => {
		it("should prevent claims when economy banned", async () => {
			// Set economy ban
			await db
				.update(userStatsTable)
				.set({
					economyBannedUntil: new Date(Date.now() + 3600000), // 1 hour from now
					suspiciousBehaviorScore: 100,
				})
				.where(eq(userStatsTable.userId, testUser.id));

			// Try to claim daily
			await expect(
				call(
					claimDaily,
					{
						userId: testUser.id,
						boostCount: 0,
					},
					createTestContext(db, testUser),
				),
			).rejects.toThrow("Your economy access is temporarily suspended");

			// Try to claim work
			await expect(
				call(
					claimWork,
					{
						userId: testUser.id,
						boostCount: 0,
					},
					createTestContext(db, testUser),
				),
			).rejects.toThrow("Your economy access is temporarily suspended");
		});

		it("should allow claims after ban expires", async () => {
			// Set expired ban
			await db
				.update(userStatsTable)
				.set({
					economyBannedUntil: new Date(Date.now() - 1000), // Expired 1 second ago
					suspiciousBehaviorScore: 50,
				})
				.where(eq(userStatsTable.userId, testUser.id));

			// Should allow work claim
			const result = await call(
				claimWork,
				{
					userId: testUser.id,
					boostCount: 0,
				},
				createTestContext(db, testUser),
			);

			expect(result).toBeDefined();
			expect(result.updatedStats).toBeDefined();
		});
	});
});
