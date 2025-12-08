import { eq, getTableColumns } from "drizzle-orm";
import { z } from "zod";
import {
	userReviewsTable,
	usersTable,
	userStatsTable,
	publicUserSchema,
} from "../../db/schema.ts";
import { base } from "../shared/os.ts";

// Review with user info
const reviewWithUserSchema = z.object({
	id: z.number(),
	userId: z.number(),
	rating: z.number(),
	text: z.string(),
	user: publicUserSchema.optional(),
});

// Eligibility response
const eligibilityResponseSchema = z.object({
	eligible: z.boolean(),
	reason: z.string().optional(),
	hasEnoughCoins: z.boolean().optional(),
	depositRequired: z.number().optional(),
	userBalance: z.number().optional(),
	criteria: z.object({
		joinedDays: z.number(),
		messageCount: z.number(),
		eventParticipation: z.number(),
		violations: z.number(),
	}).optional(),
});

// Review submission response
const submitResponseSchema = z.object({
	success: z.boolean(),
	message: z.string(),
	depositTaken: z.number().optional(),
	review: reviewWithUserSchema.optional(),
});

/**
 * List approved reviews
 */
export const list = base
	.input(
		z.object({
			status: z.enum(["approved", "pending", "all"]).optional().default("approved"),
		}).optional()
	)
	.output(z.array(reviewWithUserSchema))
	.handler(async ({ context }) => {
		// Get all reviews with user info
		const reviews = await context.db
			.select({
				id: userReviewsTable.id,
				userId: userReviewsTable.userId,
				rating: userReviewsTable.rating,
				text: userReviewsTable.text,
			})
			.from(userReviewsTable);

		// Get user info for each review
		const reviewsWithUsers = await Promise.all(
			reviews.map(async (review) => {
				const { password: _, ...userFields } = getTableColumns(usersTable);
				const [user] = await context.db
					.select(userFields)
					.from(usersTable)
					.where(eq(usersTable.id, review.userId))
					.limit(1);

				return {
					...review,
					user: user || undefined,
				};
			})
		);

		return reviewsWithUsers;
	});

/**
 * Check user's eligibility to submit a review
 */
export const eligibility = base
	.input(
		z.object({
			token: z.string(),
			userId: z.string().optional(),
		})
	)
	.output(eligibilityResponseSchema)
	.handler(async ({ input, context, errors }) => {
		// Verify token
		const { jwtVerify } = await import("jose");
		const JWT_SECRET = new TextEncoder().encode(
			process.env.JWT_SECRET || "allcom-zone-secret-key-change-in-production"
		);

		let userId: number;
		try {
			const { payload } = await jwtVerify(input.token, JWT_SECRET);
			userId = payload.userId as number;
		} catch {
			throw errors.UNAUTHORIZED();
		}

		// Check if user already has a review
		const [existingReview] = await context.db
			.select()
			.from(userReviewsTable)
			.where(eq(userReviewsTable.userId, userId))
			.limit(1);

		if (existingReview) {
			return {
				eligible: false,
				reason: "You have already submitted a review",
			};
		}

		// Get user stats
		const [userStats] = await context.db
			.select()
			.from(userStatsTable)
			.where(eq(userStatsTable.userId, userId))
			.limit(1);

		if (!userStats) {
			return {
				eligible: false,
				reason: "User stats not found",
			};
		}

		// Eligibility criteria
		const depositRequired = 100; // 100 coins deposit
		const minCoins = depositRequired;
		const minMessages = 50;

		// Check coin balance
		if (userStats.coinsCount < minCoins) {
			return {
				eligible: false,
				reason: `You need at least ${minCoins} coins to submit a review`,
				hasEnoughCoins: false,
				depositRequired,
				userBalance: userStats.coinsCount,
			};
		}

		// Check message count
		if (userStats.messagesCount < minMessages) {
			return {
				eligible: false,
				reason: `You need at least ${minMessages} messages to submit a review`,
				criteria: {
					joinedDays: 0, // TODO: calculate from user creation date
					messageCount: userStats.messagesCount,
					eventParticipation: 0,
					violations: 0,
				},
			};
		}

		return {
			eligible: true,
			hasEnoughCoins: true,
			depositRequired,
			userBalance: userStats.coinsCount,
			criteria: {
				joinedDays: 0,
				messageCount: userStats.messagesCount,
				eventParticipation: 0,
				violations: 0,
			},
		};
	});

/**
 * Get user's own review
 */
export const myReview = base
	.input(
		z.object({
			token: z.string(),
			userId: z.string().optional(),
		})
	)
	.output(reviewWithUserSchema.nullable())
	.handler(async ({ input, context, errors }) => {
		// Verify token
		const { jwtVerify } = await import("jose");
		const JWT_SECRET = new TextEncoder().encode(
			process.env.JWT_SECRET || "allcom-zone-secret-key-change-in-production"
		);

		let userId: number;
		try {
			const { payload } = await jwtVerify(input.token, JWT_SECRET);
			userId = payload.userId as number;
		} catch {
			throw errors.UNAUTHORIZED();
		}

		// Get user's review
		const [review] = await context.db
			.select()
			.from(userReviewsTable)
			.where(eq(userReviewsTable.userId, userId))
			.limit(1);

		if (!review) {
			return null;
		}

		// Get user info
		const { password: _, ...userFields } = getTableColumns(usersTable);
		const [user] = await context.db
			.select(userFields)
			.from(usersTable)
			.where(eq(usersTable.id, userId))
			.limit(1);

		return {
			...review,
			user: user || undefined,
		};
	});

/**
 * Submit a new review
 */
export const submit = base
	.input(
		z.object({
			token: z.string(),
			rating: z.number().min(1).max(5),
			text: z.string().min(50).max(500),
			promptUsed: z.string().optional(),
		})
	)
	.output(submitResponseSchema)
	.errors({
		ALREADY_REVIEWED: {
			message: "You have already submitted a review",
		},
		NOT_ELIGIBLE: {
			message: "You are not eligible to submit a review",
		},
	})
	.handler(async ({ input, context, errors }) => {
		const { token, rating, text } = input;

		// Verify token
		const { jwtVerify } = await import("jose");
		const JWT_SECRET = new TextEncoder().encode(
			process.env.JWT_SECRET || "allcom-zone-secret-key-change-in-production"
		);

		let userId: number;
		try {
			const { payload } = await jwtVerify(token, JWT_SECRET);
			userId = payload.userId as number;
		} catch {
			throw errors.UNAUTHORIZED();
		}

		// Check if user already has a review
		const [existingReview] = await context.db
			.select()
			.from(userReviewsTable)
			.where(eq(userReviewsTable.userId, userId))
			.limit(1);

		if (existingReview) {
			throw errors.ALREADY_REVIEWED();
		}

		// Get user stats
		const [userStats] = await context.db
			.select()
			.from(userStatsTable)
			.where(eq(userStatsTable.userId, userId))
			.limit(1);

		if (!userStats) {
			throw errors.NOT_FOUND({ message: "User stats not found" });
		}

		const depositRequired = 100;

		// Check coin balance
		if (userStats.coinsCount < depositRequired) {
			throw errors.NOT_ELIGIBLE();
		}

		// Create review and deduct deposit in transaction
		const result = await context.db.transaction(async (db) => {
			// Deduct deposit
			await db
				.update(userStatsTable)
				.set({
					coinsCount: userStats.coinsCount - depositRequired,
					updatedAt: new Date(),
				})
				.where(eq(userStatsTable.userId, userId));

			// Create review
			const [review] = await db
				.insert(userReviewsTable)
				.values({
					userId,
					rating,
					text,
				})
				.returning();

			if (!review) {
				throw new Error("Failed to create review");
			}

			return review;
		});

		// Get user info
		const { password: _, ...userFields } = getTableColumns(usersTable);
		const [user] = await context.db
			.select(userFields)
			.from(usersTable)
			.where(eq(usersTable.id, userId))
			.limit(1);

		return {
			success: true,
			message: "Review submitted successfully",
			depositTaken: depositRequired,
			review: {
				id: result.id,
				userId: result.userId,
				rating: result.rating,
				text: result.text,
				user: user || undefined,
			},
		};
	});
