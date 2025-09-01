import type { DbViolation } from "../db/schema";

// Violation types enum
export enum ViolationType {
	SPAM = "SPAM",
	TOXICITY = "TOXICITY",
	NSFW = "NSFW",
	PRIVACY = "PRIVACY",
	IMPERSONATION = "IMPERSONATION",
	ILLEGAL = "ILLEGAL",
	ADVERTISING = "ADVERTISING",
	SELF_HARM = "SELF_HARM",
	EVASION = "EVASION",
	OTHER = "OTHER",
}

// Violation severity enum
export enum ViolationSeverity {
	LOW = "LOW",
	MEDIUM = "MEDIUM",
	HIGH = "HIGH",
	CRITICAL = "CRITICAL",
}

// Account standing enum
export enum AccountStanding {
	ALL_GOOD = "ALL_GOOD",
	LIMITED = "LIMITED",
	VERY_LIMITED = "VERY_LIMITED",
	AT_RISK = "AT_RISK",
	SUSPENDED = "SUSPENDED",
}

// Feature restrictions enum
export enum FeatureRestriction {
	MESSAGE_EMBED = "MESSAGE_EMBED",
	MESSAGE_ATTACH = "MESSAGE_ATTACH",
	MESSAGE_LINK = "MESSAGE_LINK",
	VOICE_SPEAK = "VOICE_SPEAK",
	VOICE_VIDEO = "VOICE_VIDEO",
	VOICE_STREAM = "VOICE_STREAM",
	REACTION_ADD = "REACTION_ADD",
	THREAD_CREATE = "THREAD_CREATE",
	NICKNAME_CHANGE = "NICKNAME_CHANGE",
	RATE_LIMIT = "RATE_LIMIT", // Rate limiting (3 messages per minute)
	TIMEOUT = "TIMEOUT", // Legacy, kept for backwards compatibility
}

// Review outcomes - matching database enum
export enum ReviewOutcome {
	APPROVED = "APPROVED",
	REJECTED = "REJECTED",
	PENDING = "PENDING",
}

// Severity score calculation based on violation type and severity
export function calculateSeverityScore(violations: DbViolation[]): number {
	let score = 0;

	for (const violation of violations) {
		// Skip expired violations
		if (violation.expiresAt && new Date(violation.expiresAt) < new Date()) {
			continue;
		}

		// Base score from severity
		let violationScore = 0;
		switch (violation.severity) {
			case ViolationSeverity.LOW:
				violationScore = 10;
				break;
			case ViolationSeverity.MEDIUM:
				violationScore = 25;
				break;
			case ViolationSeverity.HIGH:
				violationScore = 50;
				break;
			case ViolationSeverity.CRITICAL:
				violationScore = 100;
				break;
		}

		// Additional weight based on violation type
		switch (violation.type) {
			case ViolationType.PRIVACY:
			case ViolationType.ILLEGAL:
			case ViolationType.SELF_HARM:
				violationScore *= 1.5;
				break;
			case ViolationType.EVASION:
				violationScore *= 2; // Ban evasion is especially serious
				break;
		}

		score += violationScore;
	}

	return Math.round(score);
}

// Calculate account standing based on active violations
export function calculateAccountStanding(violations: DbViolation[]): AccountStanding {
	const activeViolations = violations.filter((v) => !isExpired(v));
	const severityScore = calculateSeverityScore(activeViolations);
	const violationCount = activeViolations.length;

	// Check for critical violations that warrant immediate suspension
	const hasCriticalViolation = activeViolations.some((v) => v.severity === ViolationSeverity.CRITICAL);

	if (hasCriticalViolation || severityScore >= 100) {
		return AccountStanding.SUSPENDED;
	}
	if (severityScore >= 75) {
		return AccountStanding.AT_RISK;
	}
	if (severityScore >= 50) {
		return AccountStanding.VERY_LIMITED;
	}
	if (severityScore >= 25 || violationCount > 0) {
		return AccountStanding.LIMITED;
	}
	return AccountStanding.ALL_GOOD;
}

// Check if a violation has expired
export function isExpired(violation: DbViolation): boolean {
	if (violation.expiresAt) {
		return new Date(violation.expiresAt) < new Date();
	}
	return false;
}

// Get default expiration time for violations (90 days for most, longer for severe)
export function getDefaultExpirationDays(severity: ViolationSeverity): number {
	switch (severity) {
		case ViolationSeverity.LOW:
			return 30;
		case ViolationSeverity.MEDIUM:
			return 90;
		case ViolationSeverity.HIGH:
			return 180;
		case ViolationSeverity.CRITICAL:
			return 365; // 1 year for critical violations
		default:
			return 90;
	}
}

// Map violation types to appropriate feature restrictions
export function getDefaultRestrictions(type: ViolationType, severity: ViolationSeverity): FeatureRestriction[] {
	const restrictions: FeatureRestriction[] = [];

	// Type-specific restrictions
	switch (type) {
		case ViolationType.SPAM:
			restrictions.push(FeatureRestriction.MESSAGE_LINK);
			if (severity !== ViolationSeverity.LOW) {
				restrictions.push(FeatureRestriction.MESSAGE_EMBED);
			}
			break;

		case ViolationType.NSFW:
			restrictions.push(FeatureRestriction.MESSAGE_ATTACH);
			restrictions.push(FeatureRestriction.MESSAGE_EMBED);
			if (severity === ViolationSeverity.HIGH || severity === ViolationSeverity.CRITICAL) {
				restrictions.push(FeatureRestriction.VOICE_VIDEO);
				restrictions.push(FeatureRestriction.VOICE_STREAM);
			}
			break;

		case ViolationType.TOXICITY:
			if (severity === ViolationSeverity.HIGH || severity === ViolationSeverity.CRITICAL) {
				restrictions.push(FeatureRestriction.VOICE_SPEAK);
				restrictions.push(FeatureRestriction.REACTION_ADD);
			}
			break;

		case ViolationType.IMPERSONATION:
			restrictions.push(FeatureRestriction.NICKNAME_CHANGE);
			break;

		case ViolationType.ADVERTISING:
			restrictions.push(FeatureRestriction.MESSAGE_LINK);
			restrictions.push(FeatureRestriction.MESSAGE_EMBED);
			break;

		case ViolationType.EVASION:
			// Ban evasion typically results in immediate suspension
			restrictions.push(FeatureRestriction.TIMEOUT);
			break;
	}

	// Severity-based additional restrictions
	if (severity === ViolationSeverity.CRITICAL) {
		restrictions.push(FeatureRestriction.TIMEOUT);
	}

	// Remove duplicates
	return [...new Set(restrictions)];
}

// Format violation for user display
export function formatViolationForUser(violation: DbViolation): {
	title: string;
	description: string;
	color: number;
} {
	const severityColors = {
		[ViolationSeverity.LOW]: 0xffd700, // Gold
		[ViolationSeverity.MEDIUM]: 0xff8c00, // Dark Orange
		[ViolationSeverity.HIGH]: 0xff4500, // Orange Red
		[ViolationSeverity.CRITICAL]: 0xdc143c, // Crimson
	};

	const typeLabels = {
		[ViolationType.SPAM]: "Spam",
		[ViolationType.TOXICITY]: "Toxické chování",
		[ViolationType.NSFW]: "Nevhodný obsah",
		[ViolationType.PRIVACY]: "Porušení soukromí",
		[ViolationType.IMPERSONATION]: "Vydávání se za někoho jiného",
		[ViolationType.ILLEGAL]: "Nelegální obsah",
		[ViolationType.ADVERTISING]: "Neoprávněná reklama",
		[ViolationType.SELF_HARM]: "Sebepoškozování",
		[ViolationType.EVASION]: "Obcházení banu",
		[ViolationType.OTHER]: "Jiné porušení",
	};

	const severityLabels = {
		[ViolationSeverity.LOW]: "Nízká",
		[ViolationSeverity.MEDIUM]: "Střední",
		[ViolationSeverity.HIGH]: "Vysoká",
		[ViolationSeverity.CRITICAL]: "Kritická",
	};

	return {
		title: `⚠️ Porušení pravidel - ${typeLabels[violation.type as ViolationType] || violation.type}`,
		description: `**Závažnost:** ${severityLabels[violation.severity as ViolationSeverity] || violation.severity}\n**Důvod:** ${violation.reason}`,
		color: severityColors[violation.severity as ViolationSeverity] || 0xff0000,
	};
}

// Get standing display information
export function getStandingDisplay(standing: AccountStanding): {
	label: string;
	emoji: string;
	color: number;
	description: string;
} {
	switch (standing) {
		case AccountStanding.ALL_GOOD:
			return {
				label: "Vše v pořádku",
				emoji: "✅",
				color: 0x00ff00,
				description: "Nemáš žádná aktivní porušení a máš přístup ke všem funkcím.",
			};
		case AccountStanding.LIMITED:
			return {
				label: "Omezený",
				emoji: "⚠️",
				color: 0xffd700,
				description: "Máš aktivní porušení, které dočasně omezilo přístup k některým funkcím.",
			};
		case AccountStanding.VERY_LIMITED:
			return {
				label: "Velmi omezený",
				emoji: "⚠️⚠️",
				color: 0xff8c00,
				description: "Máš jedno nebo více aktivních porušení, která omezila přístup k více funkcím.",
			};
		case AccountStanding.AT_RISK:
			return {
				label: "V ohrožení",
				emoji: "🚨",
				color: 0xff4500,
				description: "Máš vážná porušení. Jakékoli další porušení může vést k trvalému zákazu.",
			};
		case AccountStanding.SUSPENDED:
			return {
				label: "Pozastavený",
				emoji: "🔒",
				color: 0xdc143c,
				description: "Tvůj účet byl pozastaven kvůli závažným nebo opakovaným porušením.",
			};
	}
}
