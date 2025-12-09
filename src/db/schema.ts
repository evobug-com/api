// noinspection JSUnusedGlobalSymbols

import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	serial,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";

// Helper for timestamptz (ALL timestamps should use this)
const timestamptz = (name?: string) => {
	if (name) return timestamp(name, { withTimezone: true });
	return timestamp({ withTimezone: true });
};

// Enums for constrained values
export const userRoleEnum = pgEnum("user_role", ["user", "admin", "moderator"]);
export const severityEnum = pgEnum("severity", ["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const reviewOutcomeEnum = pgEnum("review_outcome", ["APPROVED", "REJECTED", "PENDING"]);
export const orderStatusEnum = pgEnum("order_status", ["pending", "completed", "cancelled", "refunded"]);
export const assetTypeEnum = pgEnum("asset_type", ["stock_us", "stock_intl", "crypto"]);
export const transactionTypeEnum = pgEnum("transaction_type", ["buy", "sell"]);

// ============================================================================
// USERS TABLE - Core user data
// ============================================================================
export const usersTable = pgTable(
	"users",
	{
		// Use serial to allow explicit ID insertion during migration
		id: serial().primaryKey(),

		username: varchar({ length: 50 }).unique(),
		email: varchar({ length: 255 }).unique(),
		password: varchar({ length: 255 }),

		// Platform IDs
		guildedId: varchar({ length: 255 }),
		discordId: varchar({ length: 255 }),

		// Role with enum
		role: userRoleEnum("role").notNull().default("user"),

		// Standard timestamps
		createdAt: timestamptz().notNull().defaultNow(),
		updatedAt: timestamptz().notNull().defaultNow(),
	},
	(table) => [index("users_discord_idx").on(table.discordId), index("users_guilded_idx").on(table.guildedId)],
);

export type DbUser = typeof usersTable.$inferSelect;
export type InsertDbUser = typeof usersTable.$inferInsert;
export const userSchema = createSelectSchema(usersTable);
export const publicUserSchema = userSchema.omit({ password: true, email: true });
export const insertUserSchema = createInsertSchema(usersTable);
export const updateUserSchema = createUpdateSchema(usersTable);

export type DbUserWithRelations = DbUser & {
	orders: DbOrder[];
	reviews: DbUserReview[];
	violations: DbViolation[];
	suspensions: DbSuspension[];
	stats: DbUserStats[];
	statsLog: DbUserStatsLog[];
	eventParticipations: DbEventParticipant[];
};

// ============================================================================
// USER_REVIEWS TABLE
// ============================================================================
export const userReviewsTable = pgTable(
	"user_reviews",
	{
		id: serial().primaryKey(),
		userId: integer()
			.notNull()
			.references(() => usersTable.id, { onDelete: "cascade" }),

		// Rating with constraint
		rating: integer().notNull(),

		text: text().notNull(),
	},
	(table) => [
		index("user_reviews_userId_idx").on(table.userId),

		// Constraints
		check("user_reviews_rating_range", sql`${table.rating} >= 1 AND ${table.rating} <= 5`),
		check("user_reviews_text_length", sql`LENGTH(${table.text}) >= 50 AND LENGTH(${table.text}) <= 500`),
	],
);
export const userReviewsSchema = createSelectSchema(userReviewsTable);
export const insertUserReviewsSchema = createInsertSchema(userReviewsTable);
export const updateUserReviewsSchema = createUpdateSchema(userReviewsTable);

export type DbUserReview = typeof userReviewsTable.$inferSelect;
export type InsertDbUserReview = typeof userReviewsTable.$inferInsert;

export type DbUserReviewWithRelations = DbUserReview & {
	user: DbUser;
};

// ============================================================================
// VIOLATIONS TABLE
// ============================================================================
export const violationsTable = pgTable(
	"violations",
	{
		id: serial().primaryKey(),

		userId: integer("user_id")
			.notNull()
			.references(() => usersTable.id, { onDelete: "cascade" }),

		guildId: varchar({ length: 255 }).notNull(),

		// Violation Details
		type: varchar({ length: 50 }).notNull(), // SPAM, TOXICITY, NSFW, etc.
		severity: severityEnum().notNull(),
		policyViolated: varchar({ length: 255 }),
		reason: text().notNull(),
		contentSnapshot: text(),
		context: text(),

		// Enforcement
		actionsApplied: text(), // JSON array of actions
		restrictions: text(), // JSON array of feature restrictions

		// Metadata
		issuedBy: integer().references(() => usersTable.id, { onDelete: "set null" }),
		issuedAt: timestamptz().notNull().defaultNow(),
		expiresAt: timestamptz(),

		// Review
		reviewRequested: boolean().notNull().default(false),
		reviewedBy: integer().references(() => usersTable.id, { onDelete: "set null" }),
		reviewRequestedAt: timestamptz(),
		reviewedAt: timestamptz(),
		reviewOutcome: reviewOutcomeEnum(),
		reviewNotes: text(),

		createdAt: timestamptz().notNull().defaultNow(),
		updatedAt: timestamptz().notNull().defaultNow(),
	},
	(table) => [
		index("violations_userId_idx").on(table.userId),
		index("violations_issuedBy_idx").on(table.issuedBy),
		index("violations_reviewRequested_idx").on(table.reviewRequested),
		index("violations_severity_idx").on(table.severity),
	],
);

export const violationsSchema = createSelectSchema(violationsTable);
export const insertViolationsSchema = createInsertSchema(violationsTable);
export const updateViolationsSchema = createUpdateSchema(violationsTable);

export type DbViolation = typeof violationsTable.$inferSelect;
export type InsertDbViolation = typeof violationsTable.$inferInsert;

export type DbViolationWithRelations = DbViolation & {
	user: DbUser;
	issuer: DbUser;
	reviewer?: DbUser;
};

// ============================================================================
// SUSPENSIONS TABLE - Temporary user restrictions
// ============================================================================
export const suspensionsTable = pgTable(
	"suspensions",
	{
		id: serial().primaryKey(),

		userId: integer()
			.notNull()
			.references(() => usersTable.id, { onDelete: "cascade" }),

		guildId: varchar({ length: 255 }).notNull(),

		liftedAt: timestamptz(),
		liftedBy: integer().references(() => usersTable.id, { onDelete: "set null" }),
		liftReason: text(),

		// Make nullable for historical data where we don't know who issued it
		issuedBy: integer().references(() => usersTable.id, { onDelete: "set null" }),

		startedAt: timestamptz().notNull().defaultNow(),
		endsAt: timestamptz().notNull(),

		reason: text().notNull(),

		createdAt: timestamptz().notNull().defaultNow(),
		updatedAt: timestamptz().notNull().defaultNow(),
	},
	(table) => [
		index("suspensions_userId_idx").on(table.userId),
		index("suspensions_issuedBy_idx").on(table.issuedBy),
		index("suspensions_endsAt_idx").on(table.endsAt),
		index("suspensions_active_idx").on(table.userId, table.endsAt),
	],
);

export const suspensionsSchema = createSelectSchema(suspensionsTable);
export const insertSuspensionsSchema = createInsertSchema(suspensionsTable);
export const updateSuspensionsSchema = createUpdateSchema(suspensionsTable);

export type DbSuspension = typeof suspensionsTable.$inferSelect;
export type InsertDbSuspension = typeof suspensionsTable.$inferInsert;

export type DbSuspensionWithRelations = DbSuspension & {
	user: DbUser;
	issuer: DbUser;
	lifter?: DbUser;
};

// ============================================================================
// USER_STATS TABLE - Economy and activity stats (ONE per user)
// ============================================================================
export const userStatsTable = pgTable("user_stats", {
	id: serial("id").primaryKey(),

	// Foreign key with CASCADE delete
	userId: integer()
		.notNull()
		.unique()
		.references(() => usersTable.id, { onDelete: "cascade" }),

	// Daily activity tracking
	dailyStreak: integer().notNull().default(0),
	maxDailyStreak: integer().notNull().default(0),

	// Work activity
	workCount: integer().notNull().default(0),
	lastWorkAt: timestamptz(),

	// Messages (preserve from production)
	messagesCount: integer().notNull().default(0),
	lastMessageAt: timestamptz(),

	// Server Tag tracking
	serverTagStreak: integer().notNull().default(0),
	maxServerTagStreak: integer().notNull().default(0),
	lastServerTagCheck: timestamptz(),
	serverTagBadge: varchar({ length: 255 }), // Store badge ID to track if tag changes

	// Voice channel time tracking
	voiceTimeMinutes: integer().notNull().default(0), // Total time in voice channels (minutes)
	lastVoiceCheck: timestamptz(), // Last time we checked voice activity
	lastVoiceJoinedAt: timestamptz(), // When user last joined a voice channel

	// Economy totals
	coinsCount: integer().notNull().default(0),
	xpCount: integer().notNull().default(0),

	// Boosts
	boostCount: integer().notNull().default(0),
	boostExpires: timestamptz(),

	// Anti-automation tracking
	failedCaptchaCount: integer().notNull().default(0),
	lastCaptchaFailedAt: timestamptz(),
	suspiciousBehaviorScore: integer().notNull().default(0),
	lastSuspiciousActivityAt: timestamptz(),
	economyBannedUntil: timestamptz(),

	// Activity Points System
	activityPointsLifetime: integer().notNull().default(0),
	activityPointsWeekly: integer().notNull().default(0),
	activityPointsDailyCount: integer().notNull().default(0),
	lastActivityPointsDay: timestamptz(),
	lastActivityPointsReset: timestamptz(),

	updatedAt: timestamptz().notNull().defaultNow(),
});

export const userStatsSchema = createSelectSchema(userStatsTable);
export const insertUserStatsSchema = createInsertSchema(userStatsTable);
export const updateUserStatsSchema = createUpdateSchema(userStatsTable);

export type DbUserStats = typeof userStatsTable.$inferSelect;
export type InsertDbUserStats = typeof userStatsTable.$inferInsert;

export type DbUserStatsWithRelations = DbUserStats & {
	user: DbUser;
};

// ============================================================================
// USER_STATS_LOG TABLE - Activity history/audit log
// ============================================================================
export const userStatsLogTable = pgTable(
	"user_stats_log",
	{
		id: serial().primaryKey(),

		userId: integer()
			.notNull()
			.references(() => usersTable.id, { onDelete: "cascade" }),

		activityType: varchar({ length: 255 }).notNull(),
		notes: text(),

		xpEarned: integer().notNull().default(0),
		coinsEarned: integer().notNull().default(0),

		createdAt: timestamptz().notNull().defaultNow(),
		updatedAt: timestamptz().notNull().defaultNow(),
	},
	(table) => [index("user_stats_log_userId_idx").on(table.userId)],
);

export const userStatsLogSchema = createSelectSchema(userStatsLogTable);
export const insertUserStatsLogSchema = createInsertSchema(userStatsLogTable);
export const updateUserStatsLogSchema = createUpdateSchema(userStatsLogTable);

export type DbUserStatsLog = typeof userStatsLogTable.$inferSelect;
export type InsertDbUserStatsLog = typeof userStatsLogTable.$inferInsert;

export type DbUserStatsLogWithRelations = DbUserStatsLog & {
	user: DbUser;
};

// ============================================================================
// CAPTCHA_LOGS TABLE - Track all captcha attempts for pattern detection
// ============================================================================
export const captchaLogsTable = pgTable(
	"captcha_logs",
	{
		id: serial().primaryKey(),

		userId: integer()
			.notNull()
			.references(() => usersTable.id, { onDelete: "cascade" }),

		captchaType: varchar({ length: 50 }).notNull(), // math, emoji, word
		command: varchar({ length: 50 }).notNull(), // work, daily
		success: boolean().notNull(),
		responseTime: integer().notNull(), // in milliseconds
		clientIp: varchar({ length: 45 }), // To track if same IP is being used
		userAgent: text(), // To detect automated clients

		createdAt: timestamptz().notNull().defaultNow(),
	},
	(table) => [
		index("captcha_logs_userId_idx").on(table.userId),
		index("captcha_logs_createdAt_idx").on(table.createdAt),
		index("captcha_logs_userId_command_idx").on(table.userId, table.command),
	],
);

export const captchaLogsSchema = createSelectSchema(captchaLogsTable);
export const insertCaptchaLogsSchema = createInsertSchema(captchaLogsTable);

export type DbCaptchaLog = typeof captchaLogsTable.$inferSelect;
export type InsertDbCaptchaLog = typeof captchaLogsTable.$inferInsert;

// ============================================================================
// ORDERS TABLE
// ============================================================================
export const ordersTable = pgTable(
	"orders",
	{
		id: serial("id").primaryKey(),

		// Foreign keys
		userId: integer("user_id")
			.notNull()
			.references(() => usersTable.id, { onDelete: "cascade" }),

		productId: uuid()
			.notNull()
			.references(() => productsTable.id, { onDelete: "restrict" }),

		// Order details
		amount: integer().notNull().default(1),
		price: integer().notNull(),
		status: orderStatusEnum().notNull().default("completed"),

		// Size selection
		size: varchar({ length: 10 }),

		// Delivery information (preserve from production)
		deliveryName: varchar({ length: 255 }),
		deliveryPhone: varchar({ length: 50 }),
		deliveryAddress: text(),
		deliveryCity: varchar({ length: 100 }),
		deliveryPostalCode: varchar({ length: 20 }),
		deliveryNotes: text(),

		createdAt: timestamptz().notNull().defaultNow(),
		updatedAt: timestamptz().notNull().defaultNow(),
	},
	(table) => [
		index("orders_userId_idx").on(table.userId),
		index("orders_productId_idx").on(table.productId),
		index("orders_status_idx").on(table.status),
	],
);

export const ordersSchema = createSelectSchema(ordersTable);
export const insertOrdersSchema = createInsertSchema(ordersTable);
export const updateOrdersSchema = createUpdateSchema(ordersTable);

export type DbOrder = typeof ordersTable.$inferSelect;
export type InsertDbOrder = typeof ordersTable.$inferInsert;

export type DbOrderWithRelations = DbOrder & {
	user: DbUser;
	product: DbProduct;
};

// ============================================================================
// PRODUCTS TABLE
// ============================================================================
export const productsTable = pgTable(
	"products",
	{
		id: uuid().primaryKey().defaultRandom(),

		name: varchar({ length: 255 }).notNull(),
		description: text(),

		// Price with constraint
		price: integer().notNull(),

		imageUrl: varchar({ length: 500 }),

		// JSONB for sizes
		sizes: jsonb().$type<string[]>(),

		maxPerUser: integer().default(1),

		// Product status
		isActive: boolean().notNull().default(true),

		// Shipping details
		requiresDelivery: boolean().notNull().default(false),
		shippingCost: integer().default(0),

		createdAt: timestamptz().notNull().defaultNow(),
		updatedAt: timestamptz().notNull().defaultNow(),
	},
	(table) => [
		index("products_isActive_idx").on(table.isActive),
		check("products_price_positive", sql`${table.price} >= 0`),
		check("products_shipping_positive", sql`${table.shippingCost} >= 0`),
	],
);

export const productsSchema = createSelectSchema(productsTable);
export const insertProductsSchema = createInsertSchema(productsTable);
export const updateProductsSchema = createUpdateSchema(productsTable);

export type DbProduct = typeof productsTable.$inferSelect;
export type InsertDbProduct = typeof productsTable.$inferInsert;

// ============================================================================
// MESSAGES LOGS TABLE
// ============================================================================

export const messagesLogsTable = pgTable(
	"messages_logs",
	{
		id: serial().primaryKey(),

		userId: integer(), // can be linked later
		messageId: varchar({ length: 255 }).notNull(), // unique message id from platform
		platform: varchar({ length: 255 }).notNull(), // discord or guilded
		channelId: varchar({ length: 255 }).notNull(),
		content: text().notNull(),
		editedContents: jsonb().$type<string[]>().default([]), // store previous edits
		editCount: integer().notNull().default(0),
		createdAt: timestamptz().defaultNow().notNull(),
		updatedAt: timestamptz().defaultNow().notNull(),
		deletedAt: timestamptz(),
	},
	(table) => [
		// Unique constraint on messageId + platform combination
		index("messages_logs_messageId_platform_idx").on(table.messageId, table.platform),
	],
);

export const messagesLogsSchema = createSelectSchema(messagesLogsTable);
export const insertMessagesLogsSchema = createInsertSchema(messagesLogsTable);
export const updateMessagesLogsSchema = createUpdateSchema(messagesLogsTable);

export type DbMessageLog = typeof messagesLogsTable.$inferSelect;
export type InsertDbMessageLog = typeof messagesLogsTable.$inferInsert;

// ============================================================================
// EVENTS TABLE - Event definitions
// ============================================================================
export const eventsTable = pgTable(
	"events",
	{
		id: serial().primaryKey(),

		name: varchar({ length: 255 }).notNull().unique(),
		description: text(),
		imageUrl: text(),

		// Event timing - nullable for legacy events
		startDate: timestamptz(),
		endDate: timestamptz(),

		// Location - nullable for online events
		location: varchar({ length: 500 }),

		// Metadata
		maxParticipants: integer(),
		isActive: boolean().notNull().default(true),

		createdAt: timestamptz().notNull().defaultNow(),
		updatedAt: timestamptz().notNull().defaultNow(),
	},
	(table) => [index("events_isActive_idx").on(table.isActive), index("events_startDate_idx").on(table.startDate)],
);

export const eventsSchema = createSelectSchema(eventsTable);
export const insertEventsSchema = createInsertSchema(eventsTable);
export const updateEventsSchema = createUpdateSchema(eventsTable);

export type DbEvent = typeof eventsTable.$inferSelect;
export type InsertDbEvent = typeof eventsTable.$inferInsert;

// ============================================================================
// EVENT_PARTICIPANTS TABLE - User event participation
// ============================================================================
export const eventParticipantsTable = pgTable(
	"event_participants",
	{
		id: serial().primaryKey(),

		eventId: integer()
			.notNull()
			.references(() => eventsTable.id, { onDelete: "cascade" }),

		userId: integer()
			.notNull()
			.references(() => usersTable.id, { onDelete: "cascade" }),

		// Participation tracking
		registeredAt: timestamptz().notNull().defaultNow(),
		participatedAt: timestamptz(),

		// Additional fields
		notes: text(),

		createdAt: timestamptz().notNull().defaultNow(),
		updatedAt: timestamptz().notNull().defaultNow(),
	},
	(table) => [
		// Prevent duplicate registrations
		uniqueIndex("event_participants_event_id_user_id_idx").on(table.eventId, table.userId),

		index("event_participants_eventId_idx").on(table.eventId),
		index("event_participants_userId_idx").on(table.userId),
	],
);

export const eventParticipantsSchema = createSelectSchema(eventParticipantsTable);

export type DbEventParticipant = typeof eventParticipantsTable.$inferSelect;
export type InsertDbEventParticipant = typeof eventParticipantsTable.$inferInsert;

export type DbEventParticipantWithRelations = DbEventParticipant & {
	event: DbEvent;
	user: DbUser;
};

// ============================================================================
// ANTI-CHEAT SYSTEM TABLES
// ============================================================================

// ============================================================================
// COMMAND_HISTORY TABLE - Track all economy command executions
// ============================================================================
export const commandHistoryTable = pgTable(
	"command_history",
	{
		id: serial().primaryKey(),

		userId: integer()
			.notNull()
			.references(() => usersTable.id, { onDelete: "cascade" }),

		guildId: varchar({ length: 255 }).notNull(),
		commandName: varchar({ length: 100 }).notNull(), // "work", "daily"
		executedAt: timestamptz().notNull().defaultNow(),
		responseTime: integer(), // Milliseconds from command to response
		success: boolean().notNull().default(true),
		metadata: jsonb().$type<Record<string, unknown>>().default({}),

		createdAt: timestamptz().notNull().defaultNow(),
	},
	(table) => [
		index("command_history_userId_executedAt_idx").on(table.userId, table.executedAt),
		index("command_history_commandName_executedAt_idx").on(table.commandName, table.executedAt),
		index("command_history_recent_idx").on(table.executedAt),
	],
);

export const commandHistorySchema = createSelectSchema(commandHistoryTable);
export const insertCommandHistorySchema = createInsertSchema(commandHistoryTable);

export type DbCommandHistory = typeof commandHistoryTable.$inferSelect;
export type InsertDbCommandHistory = typeof commandHistoryTable.$inferInsert;

// ============================================================================
// USER_BEHAVIOR_METRICS TABLE - Statistical analysis results
// ============================================================================
export const userBehaviorMetricsTable = pgTable(
	"user_behavior_metrics",
	{
		userId: integer()
			.primaryKey()
			.references(() => usersTable.id, { onDelete: "cascade" }),

		guildId: varchar({ length: 255 }).notNull(),

		// Statistics
		totalCommands: integer().notNull().default(0),
		avgCommandInterval: integer(), // Average seconds between commands
		stddevCommandInterval: integer(), // Standard deviation in seconds
		coefficientVariation: integer(), // CV as percentage (multiplied by 100)

		// Timestamps
		lastCommandAt: timestamptz(),
		lastAnalysisAt: timestamptz(),
		updatedAt: timestamptz().notNull().defaultNow(),
	},
	(table) => [
		index("user_behavior_metrics_cv_idx").on(table.coefficientVariation),
		index("user_behavior_metrics_guildId_idx").on(table.guildId),
	],
);

export const userBehaviorMetricsSchema = createSelectSchema(userBehaviorMetricsTable);
export const insertUserBehaviorMetricsSchema = createInsertSchema(userBehaviorMetricsTable);

export type DbUserBehaviorMetrics = typeof userBehaviorMetricsTable.$inferSelect;
export type InsertDbUserBehaviorMetrics = typeof userBehaviorMetricsTable.$inferInsert;

// ============================================================================
// SUSPICION_SCORES TABLE - Detailed suspicion tracking
// ============================================================================
export const suspicionScoresTable = pgTable(
	"suspicion_scores",
	{
		id: serial().primaryKey(),

		userId: integer()
			.notNull()
			.references(() => usersTable.id, { onDelete: "cascade" }),

		guildId: varchar({ length: 255 }).notNull(),

		// Score breakdown
		totalScore: integer().notNull().default(0), // 0-100
		timingScore: integer().notNull().default(0), // 0-100
		behavioralScore: integer().notNull().default(0), // 0-100
		socialScore: integer().notNull().default(0), // 0-100
		accountScore: integer().notNull().default(0), // 0-100

		reason: text(), // Description of why score was assigned
		detectedAt: timestamptz().notNull().defaultNow(),

		// Resolution tracking
		resolved: boolean().notNull().default(false),
		resolvedAt: timestamptz(),
		resolutionNotes: text(),

		createdAt: timestamptz().notNull().defaultNow(),
		updatedAt: timestamptz().notNull().defaultNow(),
	},
	(table) => [
		index("suspicion_scores_userId_detectedAt_idx").on(table.userId, table.detectedAt),
		index("suspicion_scores_active_idx").on(table.userId, table.resolved, table.detectedAt),
		index("suspicion_scores_high_idx").on(table.totalScore, table.detectedAt),
	],
);

export const suspicionScoresSchema = createSelectSchema(suspicionScoresTable);
export const insertSuspicionScoresSchema = createInsertSchema(suspicionScoresTable);

export type DbSuspicionScore = typeof suspicionScoresTable.$inferSelect;
export type InsertDbSuspicionScore = typeof suspicionScoresTable.$inferInsert;

// ============================================================================
// TRUST_SCORES TABLE - Reputation system
// ============================================================================
export const trustScoresTable = pgTable("trust_scores", {
	userId: integer()
		.primaryKey()
		.references(() => usersTable.id, { onDelete: "cascade" }),

	guildId: varchar({ length: 255 }).notNull(),

	// Trust score (0-1000 scale, 500 is neutral)
	score: integer().notNull().default(500),

	// Score component breakdown
	accountFactorScore: integer().notNull().default(0), // Account age, avatar, etc.
	behavioralHistoryScore: integer().notNull().default(0), // Clean history
	transactionPatternScore: integer().notNull().default(0), // Normal patterns
	socialSignalScore: integer().notNull().default(0), // Social engagement

	// Violation tracking
	lastViolationAt: timestamptz(),
	cleanDays: integer().notNull().default(0), // Days since last violation

	updatedAt: timestamptz().notNull().defaultNow(),
});

export const trustScoresSchema = createSelectSchema(trustScoresTable);
export const insertTrustScoresSchema = createInsertSchema(trustScoresTable);

export type DbTrustScore = typeof trustScoresTable.$inferSelect;
export type InsertDbTrustScore = typeof trustScoresTable.$inferInsert;

// ============================================================================
// RATE_LIMIT_VIOLATIONS TABLE - Track rate limit breaches
// ============================================================================
export const rateLimitViolationsTable = pgTable(
	"rate_limit_violations",
	{
		id: serial().primaryKey(),

		userId: integer()
			.notNull()
			.references(() => usersTable.id, { onDelete: "cascade" }),

		guildId: varchar({ length: 255 }).notNull(),
		commandName: varchar({ length: 100 }),
		violationType: varchar({ length: 50 }), // "token_bucket", "sliding_window", "global"

		occurredAt: timestamptz().notNull().defaultNow(),
	},
	(table) => [
		index("rate_limit_violations_userId_occurredAt_idx").on(table.userId, table.occurredAt),
		index("rate_limit_violations_recent_idx").on(table.occurredAt),
	],
);

export const rateLimitViolationsSchema = createSelectSchema(rateLimitViolationsTable);
export const insertRateLimitViolationsSchema = createInsertSchema(rateLimitViolationsTable);

export type DbRateLimitViolation = typeof rateLimitViolationsTable.$inferSelect;
export type InsertDbRateLimitViolation = typeof rateLimitViolationsTable.$inferInsert;

// ============================================================================
// INVESTMENT SYSTEM TABLES - Virtual stock/crypto investing
// ============================================================================

// ============================================================================
// INVESTMENT_ASSETS TABLE - Available stocks/crypto for trading
// ============================================================================
export const investmentAssetsTable = pgTable(
	"investment_assets",
	{
		id: serial().primaryKey(),

		// Asset identification
		symbol: varchar({ length: 50 }).notNull().unique(), // e.g., "AAPL", "BTC-USD"
		name: varchar({ length: 255 }).notNull(), // e.g., "Apple Inc.", "Bitcoin"
		assetType: assetTypeEnum().notNull(),

		// Market/Exchange info
		exchange: varchar({ length: 100 }), // e.g., "NASDAQ", "NYSE", "Binance"
		currency: varchar({ length: 10 }).notNull().default("USD"), // Base currency

		// API mapping
		apiSource: varchar({ length: 50 }).notNull(), // "twelvedata", "coingecko"
		apiSymbol: varchar({ length: 100 }).notNull(), // API-specific symbol format

		// Trading config
		isActive: boolean().notNull().default(true),
		minInvestment: integer().notNull().default(100), // Minimum coins to invest

		// Metadata
		description: text(),
		logoUrl: varchar({ length: 500 }),

		createdAt: timestamptz().notNull().defaultNow(),
		updatedAt: timestamptz().notNull().defaultNow(),
	},
	(table) => [
		index("investment_assets_symbol_idx").on(table.symbol),
		index("investment_assets_type_active_idx").on(table.assetType, table.isActive),
		index("investment_assets_api_source_idx").on(table.apiSource),
	],
);

export const investmentAssetsSchema = createSelectSchema(investmentAssetsTable);
export const insertInvestmentAssetsSchema = createInsertSchema(investmentAssetsTable);
export const updateInvestmentAssetsSchema = createUpdateSchema(investmentAssetsTable);

export type DbInvestmentAsset = typeof investmentAssetsTable.$inferSelect;
export type InsertDbInvestmentAsset = typeof investmentAssetsTable.$inferInsert;

// ============================================================================
// INVESTMENT_PRICE_CACHE TABLE - Cache prices to minimize API calls
// ============================================================================
export const investmentPriceCacheTable = pgTable(
	"investment_price_cache",
	{
		id: serial().primaryKey(),

		assetId: integer()
			.notNull()
			.references(() => investmentAssetsTable.id, { onDelete: "cascade" }),

		// Price data (stored as integers to avoid floating point issues)
		// All prices in cents: $150.25 = 15025
		price: integer().notNull(), // Price in cents/smallest unit
		previousClose: integer(), // For calculating daily change
		change24h: integer(), // Change in cents
		changePercent24h: integer(), // Change as basis points (525 = 5.25%)

		// Volume and market data
		volume24h: varchar({ length: 50 }), // As string to handle large numbers
		marketCap: varchar({ length: 50 }),

		// Timestamps
		priceTimestamp: timestamptz().notNull(), // When price was fetched from API
		createdAt: timestamptz().notNull().defaultNow(),
	},
	(table) => [
		index("price_cache_asset_timestamp_idx").on(table.assetId, table.priceTimestamp),
		index("price_cache_recent_idx").on(table.priceTimestamp),
	],
);

export const investmentPriceCacheSchema = createSelectSchema(investmentPriceCacheTable);
export const insertInvestmentPriceCacheSchema = createInsertSchema(investmentPriceCacheTable);

export type DbInvestmentPriceCache = typeof investmentPriceCacheTable.$inferSelect;
export type InsertDbInvestmentPriceCache = typeof investmentPriceCacheTable.$inferInsert;

// ============================================================================
// INVESTMENT_PORTFOLIOS TABLE - User investment holdings
// ============================================================================
export const investmentPortfoliosTable = pgTable(
	"investment_portfolios",
	{
		id: serial().primaryKey(),

		userId: integer()
			.notNull()
			.references(() => usersTable.id, { onDelete: "cascade" }),

		assetId: integer()
			.notNull()
			.references(() => investmentAssetsTable.id, { onDelete: "restrict" }),

		// Holdings (quantity stored with 3 decimal precision: 10.5 shares = 10500)
		quantity: integer().notNull().default(0), // Shares/tokens * 1000
		averageBuyPrice: integer().notNull(), // Average price paid in cents

		// Calculated values
		totalInvested: integer().notNull().default(0), // Total coins spent buying
		realizedGains: integer().notNull().default(0), // Profit/loss from sells

		// Timestamps
		firstPurchaseAt: timestamptz().notNull().defaultNow(),
		lastTransactionAt: timestamptz().notNull().defaultNow(),
		updatedAt: timestamptz().notNull().defaultNow(),
	},
	(table) => [
		// Unique constraint: one portfolio entry per user per asset
		uniqueIndex("portfolio_user_asset_idx").on(table.userId, table.assetId),
		index("portfolio_user_idx").on(table.userId),
		index("portfolio_asset_idx").on(table.assetId),
	],
);

export const investmentPortfoliosSchema = createSelectSchema(investmentPortfoliosTable);
export const insertInvestmentPortfoliosSchema = createInsertSchema(investmentPortfoliosTable);
export const updateInvestmentPortfoliosSchema = createUpdateSchema(investmentPortfoliosTable);

export type DbInvestmentPortfolio = typeof investmentPortfoliosTable.$inferSelect;
export type InsertDbInvestmentPortfolio = typeof investmentPortfoliosTable.$inferInsert;

export type DbInvestmentPortfolioWithRelations = DbInvestmentPortfolio & {
	user: DbUser;
	asset: DbInvestmentAsset;
};

// ============================================================================
// INVESTMENT_TRANSACTIONS TABLE - Buy/sell transaction history
// ============================================================================
export const investmentTransactionsTable = pgTable(
	"investment_transactions",
	{
		id: serial().primaryKey(),

		userId: integer()
			.notNull()
			.references(() => usersTable.id, { onDelete: "cascade" }),

		assetId: integer()
			.notNull()
			.references(() => investmentAssetsTable.id, { onDelete: "restrict" }),

		// Transaction details
		transactionType: transactionTypeEnum().notNull(),
		quantity: integer().notNull(), // Shares/tokens * 1000
		pricePerUnit: integer().notNull(), // Price in cents at time of transaction

		// Costs
		subtotal: integer().notNull(), // quantity * pricePerUnit (in coins)
		feePercent: integer().notNull().default(150), // 1.5% = 150 basis points
		feeAmount: integer().notNull(), // Calculated fee in coins
		totalAmount: integer().notNull(), // Final amount (subtotal + fee for buy, subtotal - fee for sell)

		// Profit tracking (for sells)
		costBasis: integer(), // What was paid for these shares (for sells only)
		realizedGain: integer(), // Profit/loss on this transaction (for sells only)

		// Metadata
		notes: text(),

		createdAt: timestamptz().notNull().defaultNow(),
	},
	(table) => [
		index("transactions_user_idx").on(table.userId),
		index("transactions_asset_idx").on(table.assetId),
		index("transactions_user_created_idx").on(table.userId, table.createdAt),
		index("transactions_type_idx").on(table.transactionType),
	],
);

export const investmentTransactionsSchema = createSelectSchema(investmentTransactionsTable);
export const insertInvestmentTransactionsSchema = createInsertSchema(investmentTransactionsTable);

export type DbInvestmentTransaction = typeof investmentTransactionsTable.$inferSelect;
export type InsertDbInvestmentTransaction = typeof investmentTransactionsTable.$inferInsert;

export type DbInvestmentTransactionWithRelations = DbInvestmentTransaction & {
	user: DbUser;
	asset: DbInvestmentAsset;
};

// ============================================================================
// INVESTMENT_SYNC_LOG TABLE - Track API sync operations
// ============================================================================
export const investmentSyncLogTable = pgTable(
	"investment_sync_log",
	{
		id: serial().primaryKey(),

		// Sync details
		syncType: varchar({ length: 50 }).notNull(), // "scheduled", "manual"
		apiSource: varchar({ length: 50 }).notNull(), // "twelvedata", "coingecko"

		// Results
		assetsUpdated: integer().notNull().default(0),
		apiCallsUsed: integer().notNull().default(0),
		success: boolean().notNull(),
		errorMessage: text(),

		// Performance
		durationMs: integer(), // How long the sync took

		createdAt: timestamptz().notNull().defaultNow(),
	},
	(table) => [
		index("sync_log_created_idx").on(table.createdAt),
		index("sync_log_api_source_idx").on(table.apiSource, table.createdAt),
		index("sync_log_success_idx").on(table.success, table.createdAt),
	],
);

export const investmentSyncLogSchema = createSelectSchema(investmentSyncLogTable);
export const insertInvestmentSyncLogSchema = createInsertSchema(investmentSyncLogTable);

export type DbInvestmentSyncLog = typeof investmentSyncLogTable.$inferSelect;
export type InsertDbInvestmentSyncLog = typeof investmentSyncLogTable.$inferInsert;

// ============================================================================
// ACHIEVEMENTS SYSTEM TABLES
// ============================================================================

// ============================================================================
// ACHIEVEMENTS TABLE - Achievement definitions
// ============================================================================
export const achievementsTable = pgTable("achievements", {
	id: serial().primaryKey(),

	name: varchar({ length: 255 }).notNull(),
	description: text(),

	createdAt: timestamptz().notNull().defaultNow(),
	updatedAt: timestamptz().notNull().defaultNow(),
});

export const achievementsSchema = createSelectSchema(achievementsTable);
export const insertAchievementsSchema = createInsertSchema(achievementsTable);
export const updateAchievementsSchema = createUpdateSchema(achievementsTable);

export type DbAchievement = typeof achievementsTable.$inferSelect;
export type InsertDbAchievement = typeof achievementsTable.$inferInsert;

// ============================================================================
// USER_ACHIEVEMENTS TABLE - User progress and unlocks
// ============================================================================
export const userAchievementsTable = pgTable(
	"user_achievements",
	{
		id: serial().primaryKey(),

		userId: integer()
			.notNull()
			.references(() => usersTable.id, { onDelete: "cascade" }),

		achievementId: integer()
			.notNull()
			.references(() => achievementsTable.id, { onDelete: "cascade" }),

		// When null = in progress or not started
		// When set = achievement unlocked
		unlockedAt: timestamptz(),

		// Flexible JSON field for progress tracking
		// Examples: { "count": 47, "target": 100 }
		//           { "streak": 5, "best": 10 }
		//           { "value": 1500.50, "transactions": 12 }
		metadata: jsonb().$type<Record<string, unknown>>().default({}),

		createdAt: timestamptz().notNull().defaultNow(),
		updatedAt: timestamptz().notNull().defaultNow(),
	},
	(table) => [
		// Prevent duplicates - one entry per user per achievement
		uniqueIndex("user_achievements_user_achievement_idx").on(table.userId, table.achievementId),

		index("user_achievements_userId_idx").on(table.userId),
		index("user_achievements_achievementId_idx").on(table.achievementId),
		index("user_achievements_unlockedAt_idx").on(table.unlockedAt),
	],
);

export const userAchievementsSchema = createSelectSchema(userAchievementsTable);
export const insertUserAchievementsSchema = createInsertSchema(userAchievementsTable);
export const updateUserAchievementsSchema = createUpdateSchema(userAchievementsTable);

export type DbUserAchievement = typeof userAchievementsTable.$inferSelect;
export type InsertDbUserAchievement = typeof userAchievementsTable.$inferInsert;

export type DbUserAchievementWithRelations = DbUserAchievement & {
	user: DbUser;
	achievement: DbAchievement;
};
