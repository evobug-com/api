/**
 * Anti-cheat utility functions for calculating timing patterns, behavioral scores, and trust scores
 * Based on production anti-cheat system from ANTICHEAT.md
 */

// ============================================================================
// Types
// ============================================================================

export interface TimingAnalysisResult {
	mean: number; // Average interval in seconds
	stddev: number; // Standard deviation in seconds
	cv: number; // Coefficient of variation as percentage
	isSuspicious: boolean;
	suspicionLevel: "none" | "low" | "medium" | "high" | "extreme";
	reason?: string;
}

export interface BehavioralScoreResult {
	score: number; // 0-100
	hasNaturalBreaks: boolean;
	hasRepetitiveSequences: boolean;
	socialRatio: number;
	reasons: string[];
}

export interface SuspicionScoreBreakdown {
	totalScore: number; // 0-100
	timingScore: number; // 0-100
	behavioralScore: number; // 0-100
	socialScore: number; // 0-100
	accountScore: number; // 0-100
	rateLimitScore: number; // 0-100
}

export interface EnforcementAction {
	action: "none" | "monitor" | "rate_limit" | "captcha" | "restrict";
	message?: string;
	rateLimitMultiplier?: number; // For rate_limit action
	captchaType?: "button" | "image"; // For captcha action
	restrictDuration?: number; // For restrict action (milliseconds)
}

// ============================================================================
// Timing Analysis Functions
// ============================================================================

/**
 * Calculate coefficient of variation (CV) from a set of intervals
 * CV = (stddev / mean) * 100%
 *
 * Research shows:
 * - CV < 0.5% indicates automation with high confidence
 * - CV 0.5-2% warrants investigation
 * - CV 2-10% is normal human behavior
 * - CV > 10% indicates highly variable casual play
 */
export function calculateCoefficientVariation(intervals: number[]): TimingAnalysisResult {
	if (intervals.length < 2) {
		return {
			mean: 0,
			stddev: 0,
			cv: 0,
			isSuspicious: false,
			suspicionLevel: "none",
			reason: "Insufficient data for analysis",
		};
	}

	// Calculate mean
	const mean = intervals.reduce((sum, val) => sum + val, 0) / intervals.length;

	// Calculate variance and standard deviation
	const variance = intervals.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / intervals.length;
	const stddev = Math.sqrt(variance);

	// Calculate CV as percentage
	const cv = (stddev / mean) * 100;

	// Determine suspicion level
	let isSuspicious = false;
	let suspicionLevel: "none" | "low" | "medium" | "high" | "extreme" = "none";
	let reason: string | undefined;

	if (cv < 0.5) {
		isSuspicious = true;
		suspicionLevel = "extreme";
		reason = `Extremely consistent timing (CV: ${cv.toFixed(2)}%) - likely automated`;
	} else if (cv < 1) {
		isSuspicious = true;
		suspicionLevel = "high";
		reason = `Very consistent timing (CV: ${cv.toFixed(2)}%) - suspicious`;
	} else if (cv < 2) {
		isSuspicious = true;
		suspicionLevel = "medium";
		reason = `Consistent timing (CV: ${cv.toFixed(2)}%) - warrants investigation`;
	} else if (cv < 5) {
		suspicionLevel = "low";
		reason = `Slightly consistent timing (CV: ${cv.toFixed(2)}%) - monitor`;
	} else {
		suspicionLevel = "none";
		reason = `Normal human variation (CV: ${cv.toFixed(2)}%)`;
	}

	return {
		mean,
		stddev,
		cv,
		isSuspicious,
		suspicionLevel,
		reason,
	};
}

/**
 * Check if commands are being executed immediately after cooldown expires
 * This is a strong indicator of automation
 */
export function checkCooldownSnipping(intervals: number[], expectedCooldown: number): {
	snipeRate: number;
	isSuspicious: boolean;
	reason?: string;
} {
	if (intervals.length === 0) {
		return { snipeRate: 0, isSuspicious: false };
	}

	// Count intervals within 5 seconds of exact cooldown
	const snipes = intervals.filter((interval) => Math.abs(interval - expectedCooldown) < 5).length;

	const snipeRate = snipes / intervals.length;

	// If more than 70% of commands are within 5s of exact cooldown, it's suspicious
	const isSuspicious = snipeRate > 0.7;

	return {
		snipeRate,
		isSuspicious,
		reason: isSuspicious
			? `${(snipeRate * 100).toFixed(0)}% of commands executed at exact cooldown - likely automated`
			: undefined,
	};
}

/**
 * Calculate Z-scores for intervals to detect unnatural consistency
 * Z-scores near 0 consistently indicate impossibly perfect timing
 */
export function calculateZScores(intervals: number[]): {
	zScores: number[];
	hasUnnaturalConsistency: boolean;
	hasNaturalOutliers: boolean;
	reason?: string;
} {
	if (intervals.length < 3) {
		return {
			zScores: [],
			hasUnnaturalConsistency: false,
			hasNaturalOutliers: false,
		};
	}

	const mean = intervals.reduce((sum, val) => sum + val, 0) / intervals.length;
	const stddev = Math.sqrt(
		intervals.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / intervals.length,
	);

	const zScores = intervals.map((interval) => Math.abs((interval - mean) / stddev));

	// Count how many z-scores are consistently near zero (between -0.5 and +0.5)
	const nearZero = zScores.filter((z) => z < 0.5).length;
	const nearZeroRate = nearZero / zScores.length;

	// Humans naturally produce occasional extreme outliers (z > 3)
	const hasNaturalOutliers = zScores.some((z) => z > 3);

	// If > 80% of z-scores are near zero AND no natural outliers, it's suspicious
	const hasUnnaturalConsistency = nearZeroRate > 0.8 && !hasNaturalOutliers;

	return {
		zScores,
		hasUnnaturalConsistency,
		hasNaturalOutliers,
		reason: hasUnnaturalConsistency
			? "Impossibly consistent timing with no natural variation - likely automated"
			: undefined,
	};
}

// ============================================================================
// Behavioral Analysis Functions
// ============================================================================

/**
 * Analyze session patterns to detect 24/7 activity or impossibly long sessions
 * Legitimate users show 8-16 hour waking periods with 6-8 hour sleep gaps
 */
export function analyzeSessionPatterns(timestamps: Date[]): {
	sessionBreaks: number;
	longestBreak: number; // in seconds
	avgActiveGap: number; // Average time between commands during active sessions
	hasSleepPattern: boolean;
	suspicionScore: number; // 0-100
	reasons: string[];
} {
	if (timestamps.length < 2) {
		return {
			sessionBreaks: 0,
			longestBreak: 0,
			avgActiveGap: 0,
			hasSleepPattern: false,
			suspicionScore: 0,
			reasons: [],
		};
	}

	const gaps: number[] = [];
	for (let i = 1; i < timestamps.length; i++) {
		const gap = (timestamps[i]!.getTime() - timestamps[i - 1]!.getTime()) / 1000; // Convert to seconds
		gaps.push(gap);
	}

	// Count gaps > 1 hour as session breaks
	const sessionBreaks = gaps.filter((gap) => gap > 3600).length;

	// Find longest break
	const longestBreak = Math.max(...gaps, 0);

	// Calculate average gap during active sessions (gaps < 1 hour)
	const activeGaps = gaps.filter((gap) => gap < 3600);
	const avgActiveGap = activeGaps.length > 0 ? activeGaps.reduce((sum, gap) => sum + gap, 0) / activeGaps.length : 0;

	// Check for sleep pattern (at least one break > 4 hours)
	const hasSleepPattern = longestBreak > 14400; // 4 hours

	const reasons: string[] = [];
	let suspicionScore = 0;

	// No daily breaks
	if (sessionBreaks < 2) {
		suspicionScore += 25;
		reasons.push("No natural daily breaks detected");
	}

	// No sleep pattern
	if (!hasSleepPattern) {
		suspicionScore += 20;
		reasons.push("No sleep pattern detected (longest break < 4 hours)");
	}

	return {
		sessionBreaks,
		longestBreak,
		avgActiveGap,
		hasSleepPattern,
		suspicionScore,
		reasons,
	};
}

/**
 * Detect repetitive command sequences
 * Bots tend to execute the same sequence of commands repeatedly
 */
export function analyzeCommandSequences(commands: string[]): {
	topSequence: string;
	topSequenceFrequency: number;
	repetitionRate: number;
	isSuspicious: boolean;
	reason?: string;
} {
	if (commands.length < 3) {
		return {
			topSequence: "",
			topSequenceFrequency: 0,
			repetitionRate: 0,
			isSuspicious: false,
		};
	}

	// Build 3-command sequences
	const sequences = new Map<string, number>();
	for (let i = 0; i < commands.length - 2; i++) {
		const sequence = `${commands[i]}-${commands[i + 1]}-${commands[i + 2]}`;
		sequences.set(sequence, (sequences.get(sequence) || 0) + 1);
	}

	// Find most common sequence
	let topSequence = "";
	let topSequenceFrequency = 0;
	for (const [seq, freq] of sequences.entries()) {
		if (freq > topSequenceFrequency) {
			topSequence = seq;
			topSequenceFrequency = freq;
		}
	}

	const totalSequences = commands.length - 2;
	const repetitionRate = topSequenceFrequency / totalSequences;

	// If top sequence represents > 70% of all sequences, it's suspicious
	const isSuspicious = repetitionRate > 0.7;

	return {
		topSequence,
		topSequenceFrequency,
		repetitionRate,
		isSuspicious,
		reason: isSuspicious
			? `Highly repetitive command sequences (${(repetitionRate * 100).toFixed(0)}% same pattern)`
			: undefined,
	};
}

// ============================================================================
// Trust Score Calculation
// ============================================================================

/**
 * Calculate account factor score based on account age and completeness
 */
export function calculateAccountFactorScore(
	accountAge: number, // in days
	hasAvatar: boolean,
	messageCount: number,
): number {
	let score = 0;

	// Account age scoring (0-50 points)
	if (accountAge < 7) {
		score += 50; // New accounts are more suspicious
	} else if (accountAge < 30) {
		score += 25;
	} else if (accountAge < 90) {
		score += 10;
	}
	// else 0 points for established accounts

	// Avatar scoring (0-20 points)
	if (!hasAvatar) {
		score += 20;
	}

	// Message history (0-30 points)
	if (messageCount === 0) {
		score += 30;
	} else if (messageCount < 10) {
		score += 15;
	}

	return Math.min(100, score);
}

/**
 * Calculate social signal score based on non-command activity
 */
export function calculateSocialSignalScore(messageCount: number, commandCount: number): number {
	const totalActivity = messageCount + commandCount;
	if (totalActivity === 0) return 100; // No activity at all is very suspicious

	const commandRatio = commandCount / totalActivity;

	// Score based on command-to-total-activity ratio
	if (commandRatio > 0.9) return 100; // 90%+ commands = likely bot
	if (commandRatio > 0.7) return 60; // 70%+ commands = suspicious
	if (commandRatio > 0.5) return 30; // 50%+ commands = somewhat suspicious
	return 0; // Healthy mix of commands and social activity
}

// ============================================================================
// Comprehensive Scoring
// ============================================================================

/**
 * Calculate comprehensive suspicion score from all signals
 * Uses weighted scoring:
 * - Timing consistency: 25%
 * - Behavioral anomaly: 25%
 * - Rate limit violations: 20%
 * - Social signals: 15%
 * - Account factors: 15%
 */
export function calculateComprehensiveSuspicionScore(params: {
	timingScore: number;
	behavioralScore: number;
	rateLimitScore: number;
	socialScore: number;
	accountScore: number;
}): SuspicionScoreBreakdown {
	const weights = {
		timing: 0.25,
		behavioral: 0.25,
		rateLimit: 0.2,
		social: 0.15,
		account: 0.15,
	};

	const totalScore = Math.round(
		params.timingScore * weights.timing +
			params.behavioralScore * weights.behavioral +
			params.rateLimitScore * weights.rateLimit +
			params.socialScore * weights.social +
			params.accountScore * weights.account,
	);

	return {
		totalScore: Math.min(100, Math.max(0, totalScore)),
		timingScore: Math.min(100, Math.max(0, params.timingScore)),
		behavioralScore: Math.min(100, Math.max(0, params.behavioralScore)),
		socialScore: Math.min(100, Math.max(0, params.socialScore)),
		accountScore: Math.min(100, Math.max(0, params.accountScore)),
		rateLimitScore: Math.min(100, Math.max(0, params.rateLimitScore)),
	};
}

// ============================================================================
// Enforcement Decision
// ============================================================================

/**
 * Determine enforcement action based on suspicion score
 * Progressive enforcement ladder:
 * - Score 0-30: No action
 * - Score 30-50: Enhanced monitoring
 * - Score 50-70: Soft rate limit + occasional captcha
 * - Score 70-85: Mandatory captcha
 * - Score 85+: Temporary restriction + manual review
 */
export function determineEnforcementAction(suspicionScore: number, trustScore: number): EnforcementAction {
	if (suspicionScore < 30) {
		return { action: "none" };
	}

	if (suspicionScore < 50) {
		return {
			action: "monitor",
		};
	}

	if (suspicionScore < 70) {
		// 20% chance of captcha for medium-risk users
		// Higher trust score = lower captcha chance
		const captchaChance = trustScore > 700 ? 0.1 : 0.2;

		if (Math.random() < captchaChance) {
			return {
				action: "captcha",
				captchaType: "button",
				message: "Quick verification required",
			};
		}

		return {
			action: "rate_limit",
			rateLimitMultiplier: 0.7,
		};
	}

	if (suspicionScore < 85) {
		return {
			action: "captcha",
			captchaType: "image",
			message: "🛡️ Security verification required to continue",
		};
	}

	// Critical suspicion level - restrict and alert moderators
	return {
		action: "restrict",
		restrictDuration: 3600000, // 1 hour
		message:
			"⚠️ Your account has been temporarily restricted pending review. Please contact moderators if you believe this is an error.",
	};
}
