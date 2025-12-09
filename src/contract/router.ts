/**
 * Main contract router that combines all domain contracts
 * Organized following RESTful resource-based naming conventions
 * Each domain is properly separated by concern
 */

import {
	createAchievement,
	deleteAchievement,
	deleteUserAchievementProgress,
	getAchievement,
	getUserAchievementProgress,
	listAchievements,
	listUserAchievements,
	unlockAchievement,
	updateAchievement,
	upsertUserAchievement,
} from "./achievements";
import {
	analyzeTimingPatterns,
	calculateBehavioralScore,
	calculateSuspicionScore,
	getEnforcementAction,
	recordCommandExecution,
	recordRateLimitViolation,
	updateTrustScore,
} from "./anticheat";
import {
	createMessageLog,
	updateMessageDeletedStatus,
	updateMessageEditedStatus,
	updateMessageLog,
} from "./message-logs";
// Standing Management
import { calculateStanding, getBulkStandings, getStanding, getUserRestrictions } from "./standing";
// Authentication & Session Management
import { login, register, me, discordCallback } from "./auth";
// Shop System
import { listProducts, getProduct, purchase } from "./shop";
// Reviews System
import { list as listReviews, eligibility as reviewEligibility, myReview, submit as submitReview } from "./reviews";
// Stats & Rewards System
import {
	activityPointsLeaderboard,
	checkAutomationPatterns,
	checkMessageMilestone,
	checkServerTagStreak,
	checkVoiceTimeMilestone,
	claimDaily,
	claimWork,
	getServerTagStreak,
	getTodaysWorkCount,
	getUserActivityPoints,
	grantReward,
	leaderboard,
	logCaptchaAttempt,
	resetWeeklyActivityPoints,
	trackActivityPoints,
	updateFailedCaptchaCount,
	updateSuspiciousScore,
	userDailyCooldown,
	userStats,
	userStatsWithInvestments,
	userWorkCooldown,
} from "./stats";
// Review System (temporarily disabled - reviews are now part of violations table)
// import { cancelReview, getReviewStatus, listReviews, processReview, requestReview } from "./violation-reviews";
// Suspension Management
import {
	autoExpireSuspensions,
	checkSuspension,
	createSuspension,
	getSuspensionHistory,
	liftSuspension,
	listSuspensions,
} from "./suspensions";
// User Management
import {
	changePassword,
	createUser,
	getAllDiscordIds,
	getEconomyActivities,
	getUser,
	getUserOrders,
	linkEmail,
	requestDiscordVerification,
	setPassword,
	setUsername,
	updateUser,
} from "./users";
// Investment System
import {
	buyAsset,
	getInvestmentSummary,
	getPortfolio,
	getTransactionHistory,
	investmentLeaderboard,
	listAvailableAssets,
	sellAsset,
	syncPrices,
} from "./investments";
// Violations System
import {
	bulkExpireViolations,
	expireViolation,
	getViolation,
	issueViolation,
	listViolations,
	updateViolationReview,
} from "./violations";

export const router = {
	// Authentication endpoints
	auth: {
		login,      // POST /auth/login
		register,   // POST /auth/register
		me,         // GET /auth/me
		discordCallback, // GET /auth/discord/callback
	},

	// Shop endpoints
	shop: {
		products: {
			list: listProducts,   // GET /shop/products
			get: getProduct,      // GET /shop/products/{id}
		},
		purchase,                 // POST /shop/purchase
	},

	// Reviews endpoints
	reviews: {
		list: listReviews,         // GET /reviews
		eligibility: reviewEligibility, // GET /reviews/eligibility
		me: myReview,              // GET /reviews/me
		submit: submitReview,      // POST /reviews
	},

	// User management endpoints
	users: {
		create: createUser,
		get: getUser,
		update: updateUser,
		getAllDiscordIds: getAllDiscordIds, // GET /users/all-discord-ids - For batch operations
		orders: getUserOrders, // GET /users/{userId}/orders
		economyActivities: getEconomyActivities, // GET /users/{userId}/economy-activities
		password: {
			change: changePassword, // POST /users/me/password/change
			set: setPassword, // POST /users/me/password/set
		},
		linkEmail: linkEmail, // POST /users/me/email
		setUsername: setUsername, // POST /users/me/username
		discord: {
			requestVerification: requestDiscordVerification, // POST /users/me/discord/verification
		},
		//     me: currentUser, // GET /users/me
		//     leaderboard: leaderboard, // GET /users/leaderboard
		//     password: {
		//         update: updatePassword, // PUT /users/me/password
		//         create: createPassword, // POST /users/me/password (for passwordless accounts)
		//     },
		//     emailLink: {
		//         create: createEmailLink, // POST /users/me/email-link
		//     },
		//     eventParticipations: {
		//         create: createEventParticipation, // POST /users/{userId}/event-participations
		//     },
		//     messageCount: {
		//         update: updateMessageCount, // PUT /users/{userId}/message-count
		//     },
		//     messageLogs: {
		//         list: userMessageLogs, // GET /users/{userId}/message-logs
		//     },
		//     orders: {
		//         list: userOrders, // GET /users/{userId}/orders
		//     },
		//     purchases: {
		//         get: userPurchase, // GET /users/{userId}/purchases/{productId}
		//     },
		//     reviews: {
		//         get: userReview, // GET /users/{userId}/reviews
		//         eligibility: userReviewEligibility, // GET /users/{userId}/review-eligibility
		//     },
		//     warnings: {
		//         list: userWarnings, // GET /users/{userId}/warnings
		//         create: createWarning, // POST /users/{userId}/warnings
		//         deleteAll: deleteUserWarnings, // DELETE /users/{userId}/warnings
		//     },
		stats: {
			user: userStats,
			userWithInvestments: userStatsWithInvestments, // GET /users/stats/userWithInvestments - user stats with investment summary
			daily: {
				cooldown: userDailyCooldown,
				claim: claimDaily,
			},
			work: {
				cooldown: userWorkCooldown,
				claim: claimWork,
				todayCount: getTodaysWorkCount,
			},
			reward: {
				grant: grantReward, // POST /users/stats/reward/grant - Grant custom rewards for storytelling/quests
			},
			serverTag: {
				check: checkServerTagStreak,
				get: getServerTagStreak,
			},
			messages: {
				checkMilestone: checkMessageMilestone,
			},
			voiceTime: {
				checkMilestone: checkVoiceTimeMilestone,
			},
			captcha: {
				log: logCaptchaAttempt,
				failedCount: {
					update: updateFailedCaptchaCount,
				},
			},
			suspiciousScore: {
				update: updateSuspiciousScore,
			},
			automation: {
				checkPatterns: checkAutomationPatterns,
			},
			top: leaderboard,
			// Activity Points System
			activity: {
				track: trackActivityPoints, // POST /users/stats/activity/track - Award activity points
				leaderboard: activityPointsLeaderboard, // GET /users/stats/activity/leaderboard - Get activity rankings
				get: getUserActivityPoints, // GET /users/stats/activity/get - Get user's activity points
				resetWeekly: resetWeeklyActivityPoints, // POST /users/stats/activity/resetWeekly - Reset weekly points (scheduler)
			},
			//         get: userStats, // GET /users/{userId}/stats
			//         activities: userStatsActivities, // GET /users/{userId}/stats/activities
			//         update: updateUserStats, // PATCH /users/{userId}/stats
			//         workCooldown: userWorkCooldown, // GET /users/{userId}/stats/work-cooldown
			//         workActivities: {
			//             create: createWorkActivity, // POST /users/{userId}/stats/work-activities
			//         },
			//         dailyRecovery: {
			//             update: updateDailyRecovery, // PUT /users/{userId}/stats/daily-recovery
			//         },
			//         workRecovery: {
			//             update: updateWorkRecovery, // PUT /users/{userId}/stats/work-recovery
			//         },
		},

		// Anti-cheat endpoints
		anticheat: {
			command: {
				record: recordCommandExecution, // POST /users/anticheat/command/record
			},
			timing: {
				analyze: analyzeTimingPatterns, // POST /users/anticheat/timing/analyze
			},
			behavioral: {
				calculate: calculateBehavioralScore, // POST /users/anticheat/behavioral/calculate
			},
			suspicion: {
				calculate: calculateSuspicionScore, // POST /users/anticheat/suspicion/calculate
			},
			enforcement: {
				get: getEnforcementAction, // POST /users/anticheat/enforcement/get
			},
			trust: {
				update: updateTrustScore, // POST /users/anticheat/trust/update
			},
			rateLimit: {
				recordViolation: recordRateLimitViolation, // POST /users/anticheat/rateLimit/recordViolation
			},
		},

		// Investment endpoints
		investments: {
			buy: buyAsset, // POST /users/investments/buy
			sell: sellAsset, // POST /users/investments/sell
			portfolio: getPortfolio, // GET /users/investments/portfolio
			summary: getInvestmentSummary, // GET /users/investments/summary - aggregated investment stats
			leaderboard: investmentLeaderboard, // GET /users/investments/leaderboard - top investors
			assets: listAvailableAssets, // GET /users/investments/assets
			transactions: getTransactionHistory, // GET /users/investments/transactions
			sync: syncPrices, // POST /users/investments/sync - Manual price sync (admin only)
		},

		// Achievements endpoints
		achievements: {
			// Achievement definitions (CRUD)
			definitions: {
				create: createAchievement, // POST /users/achievements/definitions
				list: listAchievements, // GET /users/achievements/definitions
				get: getAchievement, // GET /users/achievements/definitions/{id}
				update: updateAchievement, // PUT /users/achievements/definitions/{id}
				delete: deleteAchievement, // DELETE /users/achievements/definitions/{id}
			},

			// User progress tracking
			progress: {
				upsert: upsertUserAchievement, // POST /users/achievements/progress
				get: getUserAchievementProgress, // GET /users/achievements/progress
				list: listUserAchievements, // GET /users/achievements/progress/list
				unlock: unlockAchievement, // PUT /users/achievements/progress/unlock
				delete: deleteUserAchievementProgress, // DELETE /users/achievements/progress
			},
		},
	},
	//
	// // Discord-specific endpoints
	// discord: {
	//     users: {
	//         findByDiscordId: userByDiscordId, // GET /discord/users?discord-id={discordId}
	//     },
	//     links: {
	//         create: createDiscordLink, // POST /discord/links
	//     },
	//     verifications: {
	//         create: createDiscordVerification, // POST /discord/verifications
	//         update: updateDiscordVerification, // PUT /discord/verifications/{code}
	//     },
	//     messageLogs: {
	//         list: discordMessageLogs, // GET /discord/message-logs?user-id={userId}
	//     },
	// },
	//
	// // Guilded-specific endpoints
	// guilded: {
	//     users: {
	//         findByGuildedId: userByGuildedId, // GET /guilded/users?guilded-id={guildedId}
	//     },
	//     links: {
	//         create: createGuildedLink, // POST /guilded/links
	//     },
	//     messageLogs: {
	//         list: guildedMessageLogs, // GET /guilded/message-logs?user-id={userId}
	//     },
	// },
	//
	// // Product catalog endpoints
	// products: {
	//     get: product, // GET /products/{id}
	//     list: products, // GET /products
	// },
	//
	// // Order management endpoints
	// orders: {
	//     create: createOrder, // POST /orders
	// },
	//
	// // Review system endpoints
	// reviews: {
	//     list: reviews, // GET /reviews?status=approved
	//     listPending: pendingReviews, // GET /reviews?status=pending
	//     create: createReview, // POST /reviews
	//     updateStatus: updateReviewStatus, // PATCH /reviews/{reviewId}
	// },
	//
	// // Legacy Warning system endpoints (deprecated - use violations instead)
	// warnings: {
	//     delete: deleteWarning, // DELETE /warnings/{warningId}
	// },
	//
	moderation: {
		violations: {
			issue: issueViolation, // POST /violations/issue
			list: listViolations, // GET /violations/list
			get: getViolation, // GET /violations/{id}
			expire: expireViolation, // PUT /violations/{id}/expire
			updateReview: updateViolationReview, // PUT /violations/{id}/review
			bulkExpire: bulkExpireViolations, // PUT /violations/bulk-expire
		},

		// Account Standing endpoints
		standing: {
			get: getStanding, // GET /standing/{userId}
			calculate: calculateStanding, // POST /standing/calculate
			bulk: getBulkStandings, // GET /standing/bulk
			restrictions: getUserRestrictions, // GET /standing/{userId}/restrictions
		},

		// Violation Review endpoints (temporarily disabled - reviews are now part of violations table)
		// reviews: {
		//     request: requestReview, // POST /reviews/request
		//     list: listReviews, // GET /reviews/list
		//     process: processReview, // PUT /reviews/{id}/process
		//     status: getReviewStatus, // GET /reviews/{violationId}/status
		//     cancel: cancelReview, // DELETE /reviews/{id}
		// },

		// Suspension Management endpoints
		suspensions: {
			create: createSuspension, // POST /suspensions/create
			lift: liftSuspension, // PUT /suspensions/lift
			check: checkSuspension, // GET /suspensions/check
			list: listSuspensions, // GET /suspensions/list
			history: getSuspensionHistory, // GET /suspensions/{userId}/history
			autoExpire: autoExpireSuspensions, // PUT /suspensions/auto-expire
		},
	},

	// Message logging endpoints
	messageLogs: {
		// get: messageLog, // GET /message-logs/{messageId}
		create: createMessageLog, // POST /message-logs
		update: updateMessageLog, // PATCH /message-logs/{messageId}
		// stats: messageLogStats, // GET /message-logs/stats
		updateDeletedStatus: updateMessageDeletedStatus, // PUT /message-logs/{messageId}/deleted
		updateEditedStatus: updateMessageEditedStatus, // PUT /message-logs/{messageId}/edited
	},
};
