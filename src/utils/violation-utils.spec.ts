import { describe, expect, it } from "bun:test";
import type { DbViolation } from "../db/schema";
import {
	AccountStanding,
	calculateAccountStanding,
	calculateSeverityScore,
	FeatureRestriction,
	getDefaultExpirationDays,
	getDefaultRestrictions,
	getStandingDisplay,
	isExpired,
	ViolationSeverity,
	ViolationType,
} from "./violation-utils";

describe("violation-utils", () => {
	describe("calculateSeverityScore", () => {
		it("should return 0 for no violations", () => {
			const score = calculateSeverityScore([]);
			expect(score).toBe(0);
		});

		it("should calculate correct score for LOW severity", () => {
			const violations: Partial<DbViolation>[] = [
				{
					type: ViolationType.SPAM,
					severity: ViolationSeverity.LOW,
					expiresAt: new Date(Date.now() + 86400000), // Not expired
				},
			];

			const score = calculateSeverityScore(violations as DbViolation[]);
			expect(score).toBe(10);
		});

		it("should calculate correct score for MEDIUM severity", () => {
			const violations: Partial<DbViolation>[] = [
				{
					type: ViolationType.TOXICITY,
					severity: ViolationSeverity.MEDIUM,
					expiresAt: new Date(Date.now() + 86400000),
				},
			];

			const score = calculateSeverityScore(violations as DbViolation[]);
			expect(score).toBe(25);
		});

		it("should calculate correct score for HIGH severity", () => {
			const violations: Partial<DbViolation>[] = [
				{
					type: ViolationType.NSFW,
					severity: ViolationSeverity.HIGH,
					expiresAt: new Date(Date.now() + 86400000),
				},
			];

			const score = calculateSeverityScore(violations as DbViolation[]);
			expect(score).toBe(50);
		});

		it("should calculate correct score for CRITICAL severity", () => {
			const violations: Partial<DbViolation>[] = [
				{
					type: ViolationType.ILLEGAL,
					severity: ViolationSeverity.CRITICAL,
					expiresAt: new Date(Date.now() + 86400000),
				},
			];

			const score = calculateSeverityScore(violations as DbViolation[]);
			expect(score).toBe(150); // 100 * 1.5 for ILLEGAL type
		});

		it("should apply 1.5x multiplier for PRIVACY violations", () => {
			const violations: Partial<DbViolation>[] = [
				{
					type: ViolationType.PRIVACY,
					severity: ViolationSeverity.MEDIUM,
					expiresAt: new Date(Date.now() + 86400000),
				},
			];

			const score = calculateSeverityScore(violations as DbViolation[]);
			expect(score).toBe(38); // Math.round(25 * 1.5)
		});

		it("should apply 1.5x multiplier for ILLEGAL violations", () => {
			const violations: Partial<DbViolation>[] = [
				{
					type: ViolationType.ILLEGAL,
					severity: ViolationSeverity.HIGH,
					expiresAt: new Date(Date.now() + 86400000),
				},
			];

			const score = calculateSeverityScore(violations as DbViolation[]);
			expect(score).toBe(75); // 50 * 1.5
		});

		it("should apply 1.5x multiplier for SELF_HARM violations", () => {
			const violations: Partial<DbViolation>[] = [
				{
					type: ViolationType.SELF_HARM,
					severity: ViolationSeverity.MEDIUM,
					expiresAt: new Date(Date.now() + 86400000),
				},
			];

			const score = calculateSeverityScore(violations as DbViolation[]);
			expect(score).toBe(38); // Math.round(25 * 1.5)
		});

		it("should apply 2x multiplier for EVASION violations", () => {
			const violations: Partial<DbViolation>[] = [
				{
					type: ViolationType.EVASION,
					severity: ViolationSeverity.HIGH,
					expiresAt: new Date(Date.now() + 86400000),
				},
			];

			const score = calculateSeverityScore(violations as DbViolation[]);
			expect(score).toBe(100); // 50 * 2
		});

		it("should skip expired violations", () => {
			const violations: Partial<DbViolation>[] = [
				{
					type: ViolationType.SPAM,
					severity: ViolationSeverity.LOW,
					expiresAt: new Date(Date.now() - 1000), // Expired
				},
				{
					type: ViolationType.TOXICITY,
					severity: ViolationSeverity.MEDIUM,
					expiresAt: new Date(Date.now() + 86400000), // Not expired
				},
			];

			const score = calculateSeverityScore(violations as DbViolation[]);
			expect(score).toBe(25); // Only count the non-expired violation
		});

		it("should sum scores for multiple violations", () => {
			const violations: Partial<DbViolation>[] = [
				{
					type: ViolationType.SPAM,
					severity: ViolationSeverity.LOW,
					expiresAt: new Date(Date.now() + 86400000),
				},
				{
					type: ViolationType.TOXICITY,
					severity: ViolationSeverity.MEDIUM,
					expiresAt: new Date(Date.now() + 86400000),
				},
				{
					type: ViolationType.NSFW,
					severity: ViolationSeverity.HIGH,
					expiresAt: new Date(Date.now() + 86400000),
				},
			];

			const score = calculateSeverityScore(violations as DbViolation[]);
			expect(score).toBe(85); // 10 + 25 + 50
		});

		it("should handle violations with null expiresAt", () => {
			const violations: Partial<DbViolation>[] = [
				{
					type: ViolationType.SPAM,
					severity: ViolationSeverity.LOW,
					expiresAt: null, // Never expires
				},
			];

			const score = calculateSeverityScore(violations as DbViolation[]);
			expect(score).toBe(10); // Should count as active
		});
	});

	describe("calculateAccountStanding", () => {
		it("should return ALL_GOOD for no violations", () => {
			const standing = calculateAccountStanding([]);
			expect(standing).toBe(AccountStanding.ALL_GOOD);
		});

		it("should return LIMITED for low severity score", () => {
			const violations: Partial<DbViolation>[] = [
				{
					type: ViolationType.SPAM,
					severity: ViolationSeverity.LOW,
					expiresAt: new Date(Date.now() + 86400000),
				},
			];

			const standing = calculateAccountStanding(violations as DbViolation[]);
			expect(standing).toBe(AccountStanding.LIMITED);
		});

		it("should return VERY_LIMITED for score >= 50", () => {
			const violations: Partial<DbViolation>[] = [
				{
					type: ViolationType.TOXICITY,
					severity: ViolationSeverity.MEDIUM,
					expiresAt: new Date(Date.now() + 86400000),
				},
				{
					type: ViolationType.SPAM,
					severity: ViolationSeverity.MEDIUM,
					expiresAt: new Date(Date.now() + 86400000),
				},
			];

			const standing = calculateAccountStanding(violations as DbViolation[]);
			expect(standing).toBe(AccountStanding.VERY_LIMITED);
		});

		it("should return AT_RISK for score >= 75", () => {
			const violations: Partial<DbViolation>[] = [
				{
					type: ViolationType.NSFW,
					severity: ViolationSeverity.HIGH,
					expiresAt: new Date(Date.now() + 86400000),
				},
				{
					type: ViolationType.TOXICITY,
					severity: ViolationSeverity.MEDIUM,
					expiresAt: new Date(Date.now() + 86400000),
				},
			];

			const standing = calculateAccountStanding(violations as DbViolation[]);
			expect(standing).toBe(AccountStanding.AT_RISK);
		});

		it("should return SUSPENDED for critical violation", () => {
			const violations: Partial<DbViolation>[] = [
				{
					type: ViolationType.ILLEGAL,
					severity: ViolationSeverity.CRITICAL,
					expiresAt: new Date(Date.now() + 86400000),
				},
			];

			const standing = calculateAccountStanding(violations as DbViolation[]);
			expect(standing).toBe(AccountStanding.SUSPENDED);
		});

		it("should return SUSPENDED for score >= 100", () => {
			const violations: Partial<DbViolation>[] = [
				{
					type: ViolationType.EVASION, // 2x multiplier
					severity: ViolationSeverity.HIGH, // 50 points * 2 = 100
					expiresAt: new Date(Date.now() + 86400000),
				},
			];

			const standing = calculateAccountStanding(violations as DbViolation[]);
			expect(standing).toBe(AccountStanding.SUSPENDED);
		});

		it("should only consider active violations", () => {
			const violations: Partial<DbViolation>[] = [
				{
					type: ViolationType.ILLEGAL,
					severity: ViolationSeverity.CRITICAL,
					expiresAt: new Date(Date.now() - 1000), // Expired
				},
				{
					type: ViolationType.SPAM,
					severity: ViolationSeverity.LOW,
					expiresAt: new Date(Date.now() + 86400000), // Active
				},
			];

			const standing = calculateAccountStanding(violations as DbViolation[]);
			expect(standing).toBe(AccountStanding.LIMITED); // Only LOW violation counts
		});
	});

	describe("isExpired", () => {
		it("should return true for expired violation", () => {
			const violation: Partial<DbViolation> = {
				expiresAt: new Date(Date.now() - 1000),
			};

			expect(isExpired(violation as DbViolation)).toBe(true);
		});

		it("should return false for future expiration", () => {
			const violation: Partial<DbViolation> = {
				expiresAt: new Date(Date.now() + 86400000),
			};

			expect(isExpired(violation as DbViolation)).toBe(false);
		});

		it("should return false for null expiration", () => {
			const violation: Partial<DbViolation> = {
				expiresAt: null,
			};

			expect(isExpired(violation as DbViolation)).toBe(false);
		});

		it("should handle exact current time", () => {
			const now = new Date();
			const violation: Partial<DbViolation> = {
				expiresAt: now,
			};

			// Should be considered expired if expiresAt equals current time
			expect(isExpired(violation as DbViolation)).toBe(false);
		});
	});

	describe("getDefaultExpirationDays", () => {
		it("should return 30 days for LOW severity", () => {
			expect(getDefaultExpirationDays(ViolationSeverity.LOW)).toBe(30);
		});

		it("should return 90 days for MEDIUM severity", () => {
			expect(getDefaultExpirationDays(ViolationSeverity.MEDIUM)).toBe(90);
		});

		it("should return 180 days for HIGH severity", () => {
			expect(getDefaultExpirationDays(ViolationSeverity.HIGH)).toBe(180);
		});

		it("should return 365 days for CRITICAL severity", () => {
			expect(getDefaultExpirationDays(ViolationSeverity.CRITICAL)).toBe(365);
		});
	});

	describe("getDefaultRestrictions", () => {
		describe("SPAM violations", () => {
			it("should restrict links for all severities", () => {
				const restrictions = getDefaultRestrictions(ViolationType.SPAM, ViolationSeverity.LOW);
				expect(restrictions).toContain(FeatureRestriction.MESSAGE_LINK);
			});

			it("should restrict embeds for non-LOW severity", () => {
				const mediumRestrictions = getDefaultRestrictions(ViolationType.SPAM, ViolationSeverity.MEDIUM);
				expect(mediumRestrictions).toContain(FeatureRestriction.MESSAGE_EMBED);

				const highRestrictions = getDefaultRestrictions(ViolationType.SPAM, ViolationSeverity.HIGH);
				expect(highRestrictions).toContain(FeatureRestriction.MESSAGE_EMBED);

				const lowRestrictions = getDefaultRestrictions(ViolationType.SPAM, ViolationSeverity.LOW);
				expect(lowRestrictions).not.toContain(FeatureRestriction.MESSAGE_EMBED);
			});
		});

		describe("NSFW violations", () => {
			it("should restrict attachments and embeds", () => {
				const restrictions = getDefaultRestrictions(ViolationType.NSFW, ViolationSeverity.MEDIUM);
				expect(restrictions).toContain(FeatureRestriction.MESSAGE_ATTACH);
				expect(restrictions).toContain(FeatureRestriction.MESSAGE_EMBED);
			});

			it("should restrict video and stream for HIGH/CRITICAL", () => {
				const highRestrictions = getDefaultRestrictions(ViolationType.NSFW, ViolationSeverity.HIGH);
				expect(highRestrictions).toContain(FeatureRestriction.VOICE_VIDEO);
				expect(highRestrictions).toContain(FeatureRestriction.VOICE_STREAM);

				const criticalRestrictions = getDefaultRestrictions(ViolationType.NSFW, ViolationSeverity.CRITICAL);
				expect(criticalRestrictions).toContain(FeatureRestriction.VOICE_VIDEO);
				expect(criticalRestrictions).toContain(FeatureRestriction.VOICE_STREAM);

				const lowRestrictions = getDefaultRestrictions(ViolationType.NSFW, ViolationSeverity.LOW);
				expect(lowRestrictions).not.toContain(FeatureRestriction.VOICE_VIDEO);
				expect(lowRestrictions).not.toContain(FeatureRestriction.VOICE_STREAM);
			});
		});

		describe("TOXICITY violations", () => {
			it("should restrict voice and reactions for HIGH/CRITICAL", () => {
				const highRestrictions = getDefaultRestrictions(ViolationType.TOXICITY, ViolationSeverity.HIGH);
				expect(highRestrictions).toContain(FeatureRestriction.VOICE_SPEAK);
				expect(highRestrictions).toContain(FeatureRestriction.REACTION_ADD);

				const criticalRestrictions = getDefaultRestrictions(ViolationType.TOXICITY, ViolationSeverity.CRITICAL);
				expect(criticalRestrictions).toContain(FeatureRestriction.VOICE_SPEAK);
				expect(criticalRestrictions).toContain(FeatureRestriction.REACTION_ADD);
			});

			it("should not restrict voice for LOW/MEDIUM", () => {
				const lowRestrictions = getDefaultRestrictions(ViolationType.TOXICITY, ViolationSeverity.LOW);
				expect(lowRestrictions).not.toContain(FeatureRestriction.VOICE_SPEAK);

				const mediumRestrictions = getDefaultRestrictions(ViolationType.TOXICITY, ViolationSeverity.MEDIUM);
				expect(mediumRestrictions).not.toContain(FeatureRestriction.VOICE_SPEAK);
			});
		});

		describe("IMPERSONATION violations", () => {
			it("should restrict nickname changes", () => {
				const restrictions = getDefaultRestrictions(ViolationType.IMPERSONATION, ViolationSeverity.LOW);
				expect(restrictions).toContain(FeatureRestriction.NICKNAME_CHANGE);
			});
		});

		describe("ADVERTISING violations", () => {
			it("should restrict links and embeds", () => {
				const restrictions = getDefaultRestrictions(ViolationType.ADVERTISING, ViolationSeverity.MEDIUM);
				expect(restrictions).toContain(FeatureRestriction.MESSAGE_LINK);
				expect(restrictions).toContain(FeatureRestriction.MESSAGE_EMBED);
			});
		});

		describe("EVASION violations", () => {
			it("should apply TIMEOUT restriction", () => {
				const restrictions = getDefaultRestrictions(ViolationType.EVASION, ViolationSeverity.HIGH);
				expect(restrictions).toContain(FeatureRestriction.TIMEOUT);
			});
		});

		describe("CRITICAL severity", () => {
			it("should always include TIMEOUT for CRITICAL", () => {
				const spamCritical = getDefaultRestrictions(ViolationType.SPAM, ViolationSeverity.CRITICAL);
				expect(spamCritical).toContain(FeatureRestriction.TIMEOUT);

				const toxicityCritical = getDefaultRestrictions(ViolationType.TOXICITY, ViolationSeverity.CRITICAL);
				expect(toxicityCritical).toContain(FeatureRestriction.TIMEOUT);

				const otherCritical = getDefaultRestrictions(ViolationType.OTHER, ViolationSeverity.CRITICAL);
				expect(otherCritical).toContain(FeatureRestriction.TIMEOUT);
			});
		});

		describe("Other violation types", () => {
			it("should return empty array for OTHER type with LOW severity", () => {
				const restrictions = getDefaultRestrictions(ViolationType.OTHER, ViolationSeverity.LOW);
				expect(restrictions).toEqual([]);
			});

			it("should return empty array for PRIVACY type with LOW severity", () => {
				const restrictions = getDefaultRestrictions(ViolationType.PRIVACY, ViolationSeverity.LOW);
				expect(restrictions).toEqual([]);
			});

			it("should return empty array for ILLEGAL type with LOW severity", () => {
				const restrictions = getDefaultRestrictions(ViolationType.ILLEGAL, ViolationSeverity.LOW);
				expect(restrictions).toEqual([]);
			});

			it("should return empty array for SELF_HARM type with LOW severity", () => {
				const restrictions = getDefaultRestrictions(ViolationType.SELF_HARM, ViolationSeverity.LOW);
				expect(restrictions).toEqual([]);
			});
		});

		it("should deduplicate restrictions", () => {
			// NSFW CRITICAL should have both type-specific and severity-specific TIMEOUT
			// but should only appear once
			const restrictions = getDefaultRestrictions(ViolationType.EVASION, ViolationSeverity.CRITICAL);
			const timeoutCount = restrictions.filter((r) => r === FeatureRestriction.TIMEOUT).length;
			expect(timeoutCount).toBe(1);
		});
	});

	describe("getStandingDisplay", () => {
		it("should return correct display for ALL_GOOD", () => {
			const display = getStandingDisplay(AccountStanding.ALL_GOOD);
			expect(display.label).toBe("Vše v pořádku");
			expect(display.emoji).toBeDefined();
			expect(display.color).toBeDefined();
			expect(display.description).toBeDefined();
		});

		it("should return correct display for LIMITED", () => {
			const display = getStandingDisplay(AccountStanding.LIMITED);
			expect(display.label).toBe("Omezený");
			expect(display.emoji).toBeDefined();
			expect(display.color).toBeDefined();
			expect(display.description).toBeDefined();
		});

		it("should return correct display for VERY_LIMITED", () => {
			const display = getStandingDisplay(AccountStanding.VERY_LIMITED);
			expect(display.label).toBe("Velmi omezený");
			expect(display.emoji).toBeDefined();
			expect(display.color).toBeDefined();
			expect(display.description).toBeDefined();
		});

		it("should return correct display for AT_RISK", () => {
			const display = getStandingDisplay(AccountStanding.AT_RISK);
			expect(display.label).toBe("V ohrožení");
			expect(display.emoji).toBeDefined();
			expect(display.color).toBeDefined();
			expect(display.description).toBeDefined();
		});

		it("should return correct display for SUSPENDED", () => {
			const display = getStandingDisplay(AccountStanding.SUSPENDED);
			expect(display.label).toBe("Pozastavený");
			expect(display.emoji).toBeDefined();
			expect(display.color).toBeDefined();
			expect(display.description).toBeDefined();
		});

		it("should return different colors for different standings", () => {
			const allGood = getStandingDisplay(AccountStanding.ALL_GOOD);
			const limited = getStandingDisplay(AccountStanding.LIMITED);
			const veryLimited = getStandingDisplay(AccountStanding.VERY_LIMITED);
			const atRisk = getStandingDisplay(AccountStanding.AT_RISK);
			const suspended = getStandingDisplay(AccountStanding.SUSPENDED);

			// Each standing should have a unique color
			const colors = [allGood.color, limited.color, veryLimited.color, atRisk.color, suspended.color];
			const uniqueColors = new Set(colors);
			expect(uniqueColors.size).toBe(5);
		});
	});
});
