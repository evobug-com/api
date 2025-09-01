import { relations, sql } from "drizzle-orm";
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
export const insertUserSchema = createInsertSchema(usersTable);
export const updateUserSchema = createUpdateSchema(usersTable);

export const usersRelations = relations(usersTable, ({ many, one }) => ({
	stats: one(userStatsTable, {
		fields: [usersTable.id],
		references: [userStatsTable.userId],
	}),
	statsLog: many(userStatsLogTable),
	orders: many(ordersTable),
	violations: many(violationsTable),
	reviews: many(userReviewsTable),
	suspensions: many(suspensionsTable),
	eventParticipations: many(eventParticipantsTable),
}));

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

export const userReviewsRelations = relations(userReviewsTable, ({ one }) => ({
	user: one(usersTable, {
		fields: [userReviewsTable.userId],
		references: [usersTable.id],
	}),
}));

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

export const violationsRelations = relations(violationsTable, ({ one }) => ({
	user: one(usersTable, {
		fields: [violationsTable.userId],
		references: [usersTable.id],
	}),
	issuer: one(usersTable, {
		fields: [violationsTable.issuedBy],
		references: [usersTable.id],
	}),
	reviewer: one(usersTable, {
		fields: [violationsTable.reviewedBy],
		references: [usersTable.id],
	}),
}));

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

export const suspensionsRelations = relations(suspensionsTable, ({ one }) => ({
	user: one(usersTable, {
		fields: [suspensionsTable.userId],
		references: [usersTable.id],
	}),
	issuer: one(usersTable, {
		fields: [suspensionsTable.issuedBy],
		references: [usersTable.id],
	}),
	lifter: one(usersTable, {
		fields: [suspensionsTable.liftedBy],
		references: [usersTable.id],
	}),
}));

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
	lastDailyAt: timestamptz(),

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

	// Economy totals
	coinsCount: integer().notNull().default(0),
	xpCount: integer().notNull().default(0),

	// Boosts
	boostCount: integer().notNull().default(0),
	boostExpires: timestamptz(),

	updatedAt: timestamptz().notNull().defaultNow(),
});

export const userStatsSchema = createSelectSchema(userStatsTable);
export const insertUserStatsSchema = createInsertSchema(userStatsTable);
export const updateUserStatsSchema = createUpdateSchema(userStatsTable);

export type DbUserStats = typeof userStatsTable.$inferSelect;
export type InsertDbUserStats = typeof userStatsTable.$inferInsert;

export const userStatsRelations = relations(userStatsTable, ({ one }) => ({
	user: one(usersTable, {
		fields: [userStatsTable.userId],
		references: [usersTable.id],
	}),
}));

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

export const userStatsLogRelations = relations(userStatsLogTable, ({ one }) => ({
	user: one(usersTable, {
		fields: [userStatsLogTable.userId],
		references: [usersTable.id],
	}),
}));

export type DbUserStatsLogWithRelations = DbUserStatsLog & {
	user: DbUser;
};

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

export const ordersRelations = relations(ordersTable, ({ one }) => ({
	user: one(usersTable, {
		fields: [ordersTable.userId],
		references: [usersTable.id],
	}),
	product: one(productsTable, {
		fields: [ordersTable.productId],
		references: [productsTable.id],
	}),
}));

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
		sizes: jsonb().$type<string[]>().default(sql`'["S","M","L","XL","XXL"]'::jsonb`),

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
		index("produts_isActive_idx").on(table.isActive),
		check("produts_price_positive", sql`${table.price} >= 0`),
		check("produts_shipping_positive", sql`${table.shippingCost} >= 0`),
	],
);

export const productsSchema = createSelectSchema(productsTable);
export const insertProductsSchema = createInsertSchema(productsTable);
export const updateProductsSchema = createUpdateSchema(productsTable);

export type DbProduct = typeof productsTable.$inferSelect;
export type InsertDbProduct = typeof productsTable.$inferInsert;

export const messagesLogsTable = pgTable("messages_logs", {
	id: serial().primaryKey(),

	userId: integer(), // can be linked later
	platform: varchar({ length: 255 }).notNull(), // discord or guilded
	channelId: varchar({ length: 255 }).notNull(),
	content: text().notNull(),
	editCount: integer().notNull().default(0),
	createdAt: timestamptz().defaultNow().notNull(),
	updatedAt: timestamptz().defaultNow().notNull(),
	deletedAt: timestamptz(),
});

export const messagesLogsSchema = createSelectSchema(messagesLogsTable);
export const insertMessagesLogsSchema = createInsertSchema(messagesLogsTable);
export const updateMessagesLogsSchema = createUpdateSchema(messagesLogsTable);

export type DbMessageLog = typeof messagesLogsTable.$inferSelect;
export type InsertDbMessageLog = typeof messagesLogsTable.$inferInsert;

export const messagesLogsRelations = relations(messagesLogsTable, ({ one }) => ({
	user: one(usersTable, {
		fields: [messagesLogsTable.userId],
		references: [usersTable.id],
	}),
}));

export type DbMessageLogWithRelations = DbMessageLog & {
	user: DbUser;
};

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

export const eventParticipantsRelations = relations(eventParticipantsTable, ({ one }) => ({
	event: one(eventsTable, {
		fields: [eventParticipantsTable.eventId],
		references: [eventsTable.id],
	}),
	user: one(usersTable, {
		fields: [eventParticipantsTable.userId],
		references: [usersTable.id],
	}),
}));

export type DbEventParticipantWithRelations = DbEventParticipant & {
	event: DbEvent;
	user: DbUser;
};
