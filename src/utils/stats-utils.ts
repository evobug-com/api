/**
 * Calculate the level based on total XP using a progressive scaling formula
 * @param {number} totalXp - User's total XP
 * @returns {number} - User's calculated level
 */
export function calculateLevel(totalXp: number): number {
	// Base XP required for level 1
	const baseXp = 100;

	// Level scaling factor (makes higher levels require more XP)
	const scalingFactor = 1.5;

	// XP required to reach level n: baseXp * (level^scalingFactor)
	let level = 1;
	let xpThreshold = baseXp;

	while (totalXp >= xpThreshold) {
		level++;
		xpThreshold += Math.floor(baseXp * level ** scalingFactor);
	}

	return level;
}

export type LevelProgress = {
	currentXp: number;
	progressPercentage: number;
	xpForCurrentLevel: number;
	xpForNextLevel: number;
	xpNeeded: number;
	xpProgress: number;
	currentLevel: number;
};

/**
 * Calculate XP required for the next level
 * @param {number} totalXp - Current total XP
 * @returns {Object} - Progress information
 */
export function getLevelProgress(totalXp: number): LevelProgress {
	const currentLevel = calculateLevel(totalXp);
	const baseXp = 100;
	let xpForCurrentLevel = 0;
	let xpForNextLevel = baseXp;

	// Calculate XP threshold for current level
	for (let i = 1; i < currentLevel; i++) {
		xpForCurrentLevel += Math.floor(baseXp * i ** 1.5);
	}

	// Calculate XP threshold for next level
	xpForNextLevel = xpForCurrentLevel + Math.floor(baseXp * currentLevel ** 1.5);

	// Calculate progress percentage
	const xpProgress = totalXp - xpForCurrentLevel;
	const xpNeeded = xpForNextLevel - xpForCurrentLevel;
	const progressPercentage = Math.floor((xpProgress / xpNeeded) * 100);

	return {
		currentXp: totalXp,
		xpForCurrentLevel,
		xpForNextLevel,
		xpProgress,
		xpNeeded,
		progressPercentage,
		currentLevel,
	};
}

export type RewardStats = {
	baseCoins: number;
	baseXp: number;
	currentLevel: number;
	levelCoinsBonus: number;
	levelXpBonus: number;
	streakCoinsBonus: number;
	streakXpBonus: number;
	milestoneCoinsBonus: number;
	milestoneXpBonus: number;
	boostMultiplier: number;
	boostCoinsBonus: number;
	boostXpBonus: number;
	isMilestone: boolean;
	earnedTotalCoins: number;
	earnedTotalXp: number;
};

/**
 * Calculate rewards based on activity type and user stats
 * @param {string} type - Activity type ('daily' or 'work')
 * @param {number} level - User's current level
 * @param {number} streak - User's daily streak (for daily rewards)
 * @param {number} boostCount - Number of server boosts the user has
 * @returns {RewardStats} - Detailed reward breakdown
 */
export function calculateRewards(
	type: string,
	level: number = 1,
	streak: number = 0,
	boostCount: number = 0,
): RewardStats {
	let baseCoins = 0;
	let baseXp = 0;
	let levelCoinsBonus = 0;
	let levelXpBonus = 0;
	let streakCoinsBonus = 0;
	let streakXpBonus = 0;
	let milestoneCoinsBonus = 0;
	let milestoneXpBonus = 0;
	let isMilestone = false;

	if (type === "daily") {
		// Base rewards
		baseCoins = 100;
		baseXp = 50;

		// Level bonuses
		levelCoinsBonus = level * 5;
		levelXpBonus = level * 2;

		// Streak bonuses
		streakCoinsBonus = streak * 10;
		streakXpBonus = streak * 5;

		// Milestone bonus every 5 days
		if (streak > 0 && streak % 5 === 0) {
			isMilestone = true;
			milestoneCoinsBonus = 250;
			milestoneXpBonus = 100;
		}
	} else if (type === "work") {
		// Base work rewards
		baseCoins = 50;
		baseXp = 25;

		// Level bonuses for work
		levelCoinsBonus = level * 8;
		levelXpBonus = level * 3;

		// Small random bonus for work
		baseXp += Math.floor(Math.random() * 15);
		baseCoins += Math.floor(Math.random() * 30);
	}

	// Calculate boost multiplier: 1.1x per boost (e.g., 10 boosts = 2x rewards)
	// Formula: 1 + (boostCount * 0.1)
	const boostMultiplier = 1 + boostCount * 0.1;

	// Calculate base rewards before boost
	const baseEarnedCoins = baseCoins + levelCoinsBonus + streakCoinsBonus + milestoneCoinsBonus;
	const baseEarnedXp = baseXp + levelXpBonus + streakXpBonus + milestoneXpBonus;

	// Apply boost multiplier to get bonus amounts
	const boostCoinsBonus = Math.floor(baseEarnedCoins * (boostMultiplier - 1));
	const boostXpBonus = Math.floor(baseEarnedXp * (boostMultiplier - 1));

	// Calculate final totals with boost
	const earnedTotalCoins = baseEarnedCoins + boostCoinsBonus;
	const earnedTotalXp = baseEarnedXp + boostXpBonus;

	return {
		baseCoins,
		baseXp,
		currentLevel: level,
		levelCoinsBonus,
		levelXpBonus,
		streakCoinsBonus,
		streakXpBonus,
		milestoneCoinsBonus,
		milestoneXpBonus,
		boostMultiplier,
		boostCoinsBonus,
		boostXpBonus,
		isMilestone,
		earnedTotalCoins,
		earnedTotalXp,
	};
}

/**
 * Check for level up and calculate bonus coins
 */
export function processLevelUp(
	oldXp: number,
	newXp: number,
): { oldLevel: number; newLevel: number; bonusCoins: number } | undefined {
	const oldLevel = calculateLevel(oldXp);
	const newLevel = calculateLevel(newXp);

	if (newLevel > oldLevel) {
		const bonusCoins = (newLevel - oldLevel) * 100;
		return {
			oldLevel,
			newLevel,
			bonusCoins,
		};
	}

	return undefined;
}

/**
 * Create default claim stats for scenarios with no rewards
 */
export function createDefaultClaimStats(currentLevel: number): RewardStats {
	return {
		baseCoins: 0,
		baseXp: 0,
		currentLevel,
		levelCoinsBonus: 0,
		levelXpBonus: 0,
		streakCoinsBonus: 0,
		streakXpBonus: 0,
		milestoneCoinsBonus: 0,
		milestoneXpBonus: 0,
		boostMultiplier: 1,
		boostCoinsBonus: 0,
		boostXpBonus: 0,
		isMilestone: false,
		earnedTotalCoins: 0,
		earnedTotalXp: 0,
	};
}

/**
 * Create claim stats for server tag milestone rewards
 */
export function createServerTagMilestoneStats(currentLevel: number, milestoneNumber: number): RewardStats {
	const baseCoins = 250;
	const baseXp = 100;
	const milestoneMultiplier = Math.min(milestoneNumber / 5, 10); // Cap at 10x

	const coinsReward = baseCoins * milestoneMultiplier;
	const xpReward = baseXp * milestoneMultiplier;

	return {
		baseCoins,
		baseXp,
		currentLevel,
		levelCoinsBonus: 0,
		levelXpBonus: 0,
		streakCoinsBonus: 0,
		streakXpBonus: 0,
		milestoneCoinsBonus: coinsReward - baseCoins,
		milestoneXpBonus: xpReward - baseXp,
		boostMultiplier: 1,
		boostCoinsBonus: 0,
		boostXpBonus: 0,
		isMilestone: true,
		earnedTotalCoins: coinsReward,
		earnedTotalXp: xpReward,
	};
}

/**
 * Create claim stats for message milestone rewards
 */
export function createMessageMilestoneStats(currentLevel: number, milestoneCount: number): RewardStats {
	const baseCoins = 1000;
	const baseXp = 500;

	// Determine phase multiplier based on milestone reached - exponential scaling
	let phaseMultiplier = 1;
	if (milestoneCount === 100) phaseMultiplier = 1;
	else if (milestoneCount === 1000) phaseMultiplier = 5;
	else if (milestoneCount === 10000) phaseMultiplier = 15;
	else if (milestoneCount === 100000) phaseMultiplier = 50;
	else if (milestoneCount === 1000000) phaseMultiplier = 200;

	const coinsReward = baseCoins * phaseMultiplier;
	const xpReward = baseXp * phaseMultiplier;

	return {
		baseCoins,
		baseXp,
		currentLevel,
		levelCoinsBonus: 0,
		levelXpBonus: 0,
		streakCoinsBonus: 0,
		streakXpBonus: 0,
		milestoneCoinsBonus: coinsReward - baseCoins,
		milestoneXpBonus: xpReward - baseXp,
		boostMultiplier: 1,
		boostCoinsBonus: 0,
		boostXpBonus: 0,
		isMilestone: true,
		earnedTotalCoins: coinsReward,
		earnedTotalXp: xpReward,
	};
}

// Note: checkCooldown function removed as it's not needed with the current implementation
// Cooldown checking is now handled directly in the handler functions
