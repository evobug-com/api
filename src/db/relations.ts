import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
	// ============================================================================
	// USERS TABLE RELATIONS
	// ============================================================================
	usersTable: {
		stats: r.one.userStatsTable({
			from: r.usersTable.id,
			to: r.userStatsTable.userId,
		}),
		statsLog: r.many.userStatsLogTable({
			from: r.usersTable.id,
			to: r.userStatsLogTable.userId,
		}),
		orders: r.many.ordersTable({
			from: r.usersTable.id,
			to: r.ordersTable.userId,
		}),
		violations: r.many.violationsTable({
			from: r.usersTable.id,
			to: r.violationsTable.userId,
		}),
		reviews: r.many.userReviewsTable({
			from: r.usersTable.id,
			to: r.userReviewsTable.userId,
		}),
		suspensions: r.many.suspensionsTable({
			from: r.usersTable.id,
			to: r.suspensionsTable.userId,
		}),
		eventParticipations: r.many.eventParticipantsTable({
			from: r.usersTable.id,
			to: r.eventParticipantsTable.userId,
		}),

		// Anti-cheat relations
		commandHistory: r.many.commandHistoryTable({
			from: r.usersTable.id,
			to: r.commandHistoryTable.userId,
		}),
		behaviorMetrics: r.one.userBehaviorMetricsTable({
			from: r.usersTable.id,
			to: r.userBehaviorMetricsTable.userId,
		}),
		suspicionScores: r.many.suspicionScoresTable({
			from: r.usersTable.id,
			to: r.suspicionScoresTable.userId,
		}),
		trustScore: r.one.trustScoresTable({
			from: r.usersTable.id,
			to: r.trustScoresTable.userId,
		}),
		rateLimitViolations: r.many.rateLimitViolationsTable({
			from: r.usersTable.id,
			to: r.rateLimitViolationsTable.userId,
		}),

		// Relations where user is the issuer/reviewer/lifter
		issuedViolations: r.many.violationsTable({
			from: r.usersTable.id,
			to: r.violationsTable.issuedBy,
			alias: "issued_violations",
		}),
		reviewedViolations: r.many.violationsTable({
			from: r.usersTable.id,
			to: r.violationsTable.reviewedBy,
			alias: "reviewed_violations",
		}),
		issuedSuspensions: r.many.suspensionsTable({
			from: r.usersTable.id,
			to: r.suspensionsTable.issuedBy,
			alias: "issued_suspensions",
		}),
		liftedSuspensions: r.many.suspensionsTable({
			from: r.usersTable.id,
			to: r.suspensionsTable.liftedBy,
			alias: "lifted_suspensions",
		}),
	},

	// ============================================================================
	// USER_REVIEWS TABLE RELATIONS
	// ============================================================================
	userReviewsTable: {
		user: r.one.usersTable({
			from: r.userReviewsTable.userId,
			to: r.usersTable.id,
		}),
	},

	// ============================================================================
	// VIOLATIONS TABLE RELATIONS
	// ============================================================================
	violationsTable: {
		user: r.one.usersTable({
			from: r.violationsTable.userId,
			to: r.usersTable.id,
		}),
		issuer: r.one.usersTable({
			from: r.violationsTable.issuedBy,
			to: r.usersTable.id,
			alias: "issuer_relation",
		}),
		reviewer: r.one.usersTable({
			from: r.violationsTable.reviewedBy,
			to: r.usersTable.id,
			alias: "reviewer_relation",
		}),
	},

	// ============================================================================
	// SUSPENSIONS TABLE RELATIONS
	// ============================================================================
	suspensionsTable: {
		user: r.one.usersTable({
			from: r.suspensionsTable.userId,
			to: r.usersTable.id,
		}),
		issuer: r.one.usersTable({
			from: r.suspensionsTable.issuedBy,
			to: r.usersTable.id,
			alias: "issuer_relation",
		}),
		lifter: r.one.usersTable({
			from: r.suspensionsTable.liftedBy,
			to: r.usersTable.id,
			alias: "lifter_relation",
		}),
	},

	// ============================================================================
	// USER_STATS TABLE RELATIONS
	// ============================================================================
	userStatsTable: {
		user: r.one.usersTable({
			from: r.userStatsTable.userId,
			to: r.usersTable.id,
		}),
	},

	// ============================================================================
	// USER_STATS_LOG TABLE RELATIONS
	// ============================================================================
	userStatsLogTable: {
		user: r.one.usersTable({
			from: r.userStatsLogTable.userId,
			to: r.usersTable.id,
		}),
	},

	// ============================================================================
	// ORDERS TABLE RELATIONS
	// ============================================================================
	ordersTable: {
		user: r.one.usersTable({
			from: r.ordersTable.userId,
			to: r.usersTable.id,
		}),
		product: r.one.productsTable({
			from: r.ordersTable.productId,
			to: r.productsTable.id,
		}),
	},

	// ============================================================================
	// PRODUCTS TABLE RELATIONS
	// ============================================================================
	productsTable: {
		orders: r.many.ordersTable({
			from: r.productsTable.id,
			to: r.ordersTable.productId,
		}),
	},

	// ============================================================================
	// MESSAGES_LOGS TABLE RELATIONS
	// ============================================================================
	messagesLogsTable: {
		user: r.one.usersTable({
			from: r.messagesLogsTable.userId,
			to: r.usersTable.id,
		}),
	},

	// ============================================================================
	// EVENTS TABLE RELATIONS
	// ============================================================================
	eventsTable: {
		participants: r.many.eventParticipantsTable({
			from: r.eventsTable.id,
			to: r.eventParticipantsTable.eventId,
		}),
	},

	// ============================================================================
	// EVENT_PARTICIPANTS TABLE RELATIONS
	// ============================================================================
	eventParticipantsTable: {
		event: r.one.eventsTable({
			from: r.eventParticipantsTable.eventId,
			to: r.eventsTable.id,
		}),
		user: r.one.usersTable({
			from: r.eventParticipantsTable.userId,
			to: r.usersTable.id,
		}),
	},

	// ============================================================================
	// ANTI-CHEAT SYSTEM RELATIONS
	// ============================================================================

	// Command History Relations
	commandHistoryTable: {
		user: r.one.usersTable({
			from: r.commandHistoryTable.userId,
			to: r.usersTable.id,
		}),
	},

	// User Behavior Metrics Relations
	userBehaviorMetricsTable: {
		user: r.one.usersTable({
			from: r.userBehaviorMetricsTable.userId,
			to: r.usersTable.id,
		}),
	},

	// Suspicion Scores Relations
	suspicionScoresTable: {
		user: r.one.usersTable({
			from: r.suspicionScoresTable.userId,
			to: r.usersTable.id,
		}),
	},

	// Trust Scores Relations
	trustScoresTable: {
		user: r.one.usersTable({
			from: r.trustScoresTable.userId,
			to: r.usersTable.id,
		}),
	},

	// Rate Limit Violations Relations
	rateLimitViolationsTable: {
		user: r.one.usersTable({
			from: r.rateLimitViolationsTable.userId,
			to: r.usersTable.id,
		}),
	},
}));
