/**
 * Main contract router that combines all domain contracts
 * Organized following RESTful resource-based naming conventions
 * Each domain is properly separated by concern
 */

import {
	createMessageLog,
	updateMessageDeletedStatus,
	updateMessageEditedStatus,
	updateMessageLog,
} from "./message-logs";
// Standing Management
import { calculateStanding, getBulkStandings, getStanding, getUserRestrictions } from "./standing";
// Authentication & Session Management
// import { createSession, deleteSession } from "./auth";
// Stats & Rewards System
import {
	checkAutomationPatterns,
	checkMessageMilestone,
	checkServerTagStreak,
	claimDaily,
	claimWork,
	getServerTagStreak,
	leaderboard,
	logCaptchaAttempt,
	updateFailedCaptchaCount,
	updateSuspiciousScore,
	userDailyCooldown,
	userStats,
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
import { createUser, getUser, updateUser } from "./users";
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
	// auth: {
	// 	sessions: {
	// 		create: createSession, // POST /auth/sessions (login)
	// 		delete: deleteSession, // DELETE /auth/sessions (logout)
	// 	},
	// },

	// User management endpoints
	users: {
		create: createUser,
		get: getUser,
		update: updateUser,
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
			daily: {
				cooldown: userDailyCooldown,
				claim: claimDaily,
			},
			work: {
				cooldown: userWorkCooldown,
				claim: claimWork,
			},
			serverTag: {
				check: checkServerTagStreak,
				get: getServerTagStreak,
			},
			messages: {
				checkMilestone: checkMessageMilestone,
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
