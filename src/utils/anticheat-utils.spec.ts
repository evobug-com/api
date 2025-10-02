import { describe, expect, it } from "bun:test";
import {
	analyzeCommandSequences,
	analyzeSessionPatterns,
	calculateAccountFactorScore,
	calculateCoefficientVariation,
	calculateComprehensiveSuspicionScore,
	calculateSocialSignalScore,
	checkCooldownSnipping,
	determineEnforcementAction,
} from "./anticheat-utils.ts";

describe("Anti-Cheat Utilities", () => {
	describe("calculateCoefficientVariation", () => {
		it("should detect bot with extremely consistent timing (CV < 0.5%)", () => {
			// Bot executing commands every 3600 seconds ± 1 second
			const intervals = Array(50)
				.fill(0)
				.map(() => 3600 + (Math.random() - 0.5) * 2);

			const result = calculateCoefficientVariation(intervals);

			expect(result.isSuspicious).toBe(true);
			expect(result.suspicionLevel).toBe("extreme");
			expect(result.cv).toBeLessThan(0.5);
		});

		it("should allow normal human variation (CV > 5%)", () => {
			// Human with more variation: 3600 ± 500 seconds
			const intervals = Array(50)
				.fill(0)
				.map(() => 3600 + (Math.random() - 0.5) * 1000);

			const result = calculateCoefficientVariation(intervals);

			expect(result.isSuspicious).toBe(false);
			expect(result.suspicionLevel).toMatch(/none|low/); // Allow low since it's borderline
			expect(result.cv).toBeGreaterThan(3);
		});

		it("should flag suspicious timing (CV 0.5-2%)", () => {
			// Suspicious timing: 3600 ± 50 seconds
			const intervals = Array(50)
				.fill(0)
				.map(() => 3600 + (Math.random() - 0.5) * 100);

			const result = calculateCoefficientVariation(intervals);

			expect(result.isSuspicious).toBe(true);
			expect(result.suspicionLevel).toMatch(/medium|high/);
		});

		it("should return none for insufficient data", () => {
			const intervals = [3600]; // Only 1 interval

			const result = calculateCoefficientVariation(intervals);

			expect(result.isSuspicious).toBe(false);
			expect(result.suspicionLevel).toBe("none");
		});
	});

	describe("checkCooldownSnipping", () => {
		it("should detect cooldown snipping (commands at exact cooldown)", () => {
			// 80% of commands within 5 seconds of 3600
			const intervals = [
				...Array(40).fill(3600),
				...Array(10).fill(3500), // Some variation
			];

			const result = checkCooldownSnipping(intervals, 3600);

			expect(result.isSuspicious).toBe(true);
			expect(result.snipeRate).toBeGreaterThan(0.7);
		});

		it("should allow natural timing variation", () => {
			// Only 30% at exact cooldown
			const intervals = [...Array(15).fill(3600), ...Array(35).fill(3700)];

			const result = checkCooldownSnipping(intervals, 3600);

			expect(result.isSuspicious).toBe(false);
			expect(result.snipeRate).toBeLessThan(0.7);
		});
	});

	describe("analyzeSessionPatterns", () => {
		it("should detect 24/7 bot activity (no sleep pattern)", () => {
			// Commands every hour for 48 hours straight
			const timestamps = Array(48)
				.fill(0)
				.map((_, i) => new Date(Date.now() - i * 3600 * 1000));

			const result = analyzeSessionPatterns(timestamps.reverse());

			expect(result.hasSleepPattern).toBe(false);
			expect(result.suspicionScore).toBeGreaterThan(0);
			expect(result.reasons).toContain("No sleep pattern detected (longest break < 4 hours)");
		});

		it("should allow legitimate human activity with sleep breaks", () => {
			const now = Date.now();
			const timestamps = [
				new Date(now - 48 * 3600 * 1000), // 48h ago
				new Date(now - 40 * 3600 * 1000), // Active period
				new Date(now - 32 * 3600 * 1000),
				// 8 hour sleep break
				new Date(now - 24 * 3600 * 1000), // Next day
				new Date(now - 20 * 3600 * 1000), // Active period
				new Date(now - 16 * 3600 * 1000),
				// Another sleep break
				new Date(now - 8 * 3600 * 1000), // Today
				new Date(now - 4 * 3600 * 1000),
			];

			const result = analyzeSessionPatterns(timestamps);

			expect(result.hasSleepPattern).toBe(true);
			expect(result.suspicionScore).toBeLessThan(30);
		});
	});

	describe("analyzeCommandSequences", () => {
		it("should detect repetitive bot sequences", () => {
			// Bot repeating "work-work-work" pattern
			const commands = Array(30).fill(["work", "work", "work"]).flat();

			const result = analyzeCommandSequences(commands);

			expect(result.isSuspicious).toBe(true);
			expect(result.repetitionRate).toBeGreaterThan(0.7);
		});

		it("should allow varied human command patterns", () => {
			const commands = ["work", "daily", "work", "work", "daily", "work", "daily", "work"];

			const result = analyzeCommandSequences(commands);

			expect(result.isSuspicious).toBe(false);
		});
	});

	describe("calculateAccountFactorScore", () => {
		it("should flag new account without avatar", () => {
			const score = calculateAccountFactorScore(
				3, // 3 days old
				false, // no avatar
				0, // no messages
			);

			expect(score).toBeGreaterThan(70); // High suspicion
		});

		it("should trust established account with activity", () => {
			const score = calculateAccountFactorScore(
				180, // 6 months old
				true, // has avatar
				500, // 500 messages
			);

			expect(score).toBe(0); // No suspicion
		});
	});

	describe("calculateSocialSignalScore", () => {
		it("should flag users who only run commands (no social activity)", () => {
			const score = calculateSocialSignalScore(
				5, // 5 messages
				95, // 95 commands
			);

			expect(score).toBe(100); // Very suspicious
		});

		it("should allow users with healthy mix of activity", () => {
			const score = calculateSocialSignalScore(
				200, // 200 messages
				50, // 50 commands
			);

			expect(score).toBeLessThan(30); // Not suspicious
		});
	});

	describe("calculateComprehensiveSuspicionScore", () => {
		it("should weight all components correctly", () => {
			const result = calculateComprehensiveSuspicionScore({
				timingScore: 100, // Extreme timing suspicion
				behavioralScore: 0,
				rateLimitScore: 0,
				socialScore: 0,
				accountScore: 0,
			});

			// Only timing is suspicious: 100 * 0.25 = 25
			expect(result.totalScore).toBe(25);
		});

		it("should combine multiple suspicion signals", () => {
			const result = calculateComprehensiveSuspicionScore({
				timingScore: 100, // 25%
				behavioralScore: 80, // 25%
				rateLimitScore: 60, // 20%
				socialScore: 100, // 15%
				accountScore: 100, // 15%
			});

			// Expected: (100*0.25) + (80*0.25) + (60*0.2) + (100*0.15) + (100*0.15) = 87
			expect(result.totalScore).toBeGreaterThan(80);
		});
	});

	describe("determineEnforcementAction", () => {
		it("should not enforce for low suspicion scores", () => {
			const action = determineEnforcementAction(20, 500);

			expect(action.action).toBe("none");
		});

		it("should monitor for moderate suspicion (30-50)", () => {
			const action = determineEnforcementAction(40, 500);

			expect(action.action).toBe("monitor");
		});

		it("should require captcha for high suspicion (70-85)", () => {
			const action = determineEnforcementAction(75, 500);

			expect(action.action).toBe("captcha");
			expect(action.captchaType).toBe("image");
		});

		it("should restrict for critical suspicion (85+)", () => {
			const action = determineEnforcementAction(90, 500);

			expect(action.action).toBe("restrict");
			expect(action.restrictDuration).toBeDefined();
		});

		it("should apply rate limits for medium-high suspicion (50-70)", () => {
			const action = determineEnforcementAction(60, 500);

			// Could be rate_limit or captcha based on random chance
			expect(["rate_limit", "captcha"]).toContain(action.action);
		});
	});
});
