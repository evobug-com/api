import { ORPCError } from "@orpc/client";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
	violationsTable,
	violationsSchema,
	usersTable,
} from "../../db/schema";
import { ReviewOutcome } from "../../utils/violation-utils";
import { base } from "../shared/os";

// Review status enum
export enum ReviewStatus {
	PENDING = "PENDING",
	REVIEWING = "REVIEWING",
	COMPLETED = "COMPLETED",
}

/**
 * Request a review of a violation
 * POST /reviews/request
 */
export const requestReview = base
	.input(
		z.object({
			violationId: z.number().int().positive(),
			userId: z.number().int().positive(),
			reason: z.string().min(10).max(1000),
		}),
	)
	.output(
		z.object({
			violation: violationsSchema,
			message: z.string(),
		}),
	)
	.handler(async ({ input, context }) => {
		// Check if violation exists
		const violation = await context.db.query.violationsTable.findFirst({
			where: eq(violationsTable.id, input.violationId),
		});

		if (!violation) {
			throw new ORPCError("NOT_FOUND", { message: "Violation not found" });
		}

		// Check if the user is the one who received the violation
		if (violation.userId !== input.userId) {
			throw new ORPCError("FORBIDDEN", { message: "You can only request review for your own violations" });
		}

		// Check if violation is already expired
		if (violation.expiresAt && new Date(violation.expiresAt) < new Date()) {
			throw new ORPCError("CONFLICT", { message: "Cannot review an expired violation" });
		}

		if (violation.reviewOutcome === ReviewOutcome.REJECTED) {
			throw new ORPCError("CONFLICT", { message: "This violation has already been rejected" });
		}

		// Check if a review is already requested for this violation
		if (violation.reviewRequested && violation.reviewOutcome === ReviewOutcome.PENDING) {
			throw new ORPCError("CONFLICT", { message: "A review is already pending for this violation" });
		}

		// Update violation to mark review requested
		const [updatedViolation] = await context.db
			.update(violationsTable)
			.set({
				reviewRequested: true,
				reviewRequestedAt: new Date(),
				reviewOutcome: ReviewOutcome.PENDING,
				reviewNotes: input.reason,
				updatedAt: new Date(),
			})
			.where(eq(violationsTable.id, input.violationId))
			.returning();

		if (!updatedViolation) {
			throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to create review request" });
		}

		return {
			violation: updatedViolation,
			message: "Review request submitted successfully. A moderator will review your case soon.",
		};
	});

/**
 * List pending reviews for moderators
 * GET /reviews/list
 */
export const listReviews = base
	.input(
		z.object({
			guildId: z.string().min(1),
			status: z.nativeEnum(ReviewStatus).optional(),
			limit: z.number().int().min(1).max(100).default(50),
			offset: z.number().int().min(0).default(0),
		}),
	)
	.output(
		z.object({
			reviews: z.array(
				violationReviewsSchema.extend({
					violation: z.any(), // Will include violation details
					user: z.any(), // Will include user details
				}),
			),
			total: z.number(),
		}),
	)
	.handler(async ({ input, context }) => {
		// Get reviews with violation and user details
		const reviews = await context.db.query.violationReviewsTable.findMany({
			where: input.status ? eq(violationReviewsTable.status, input.status) : undefined,
			with: {
				violation: {
					with: {
						user: true,
						issuer: true,
					},
				},
				user: true,
			},
			limit: input.limit,
			offset: input.offset,
			orderBy: (reviews, { asc }) => [asc(reviews.createdAt)],
		});

		// Filter by guildId from the violation
		const filteredReviews = reviews.filter((review) => review.violation.guildId === input.guildId);

		return {
			reviews: filteredReviews,
			total: filteredReviews.length,
		};
	});

/**
 * Process a review (for moderators)
 * PUT /reviews/process
 */
export const processReview = base
	.input(
		z.object({
			reviewId: z.number().int().positive(),
			reviewedBy: z.number().int().positive(),
			outcome: z.nativeEnum(ReviewOutcome),
			notes: z.string().optional(),
		}),
	)
	.output(
		z.object({
			success: z.boolean(),
			message: z.string(),
			review: violationReviewsSchema,
		}),
	)
	.handler(async ({ input, context }) => {
		// Check if review exists
		const review = await context.db.query.violationReviewsTable.findFirst({
			where: eq(violationReviewsTable.id, input.reviewId),
			with: {
				violation: true,
			},
		});

		if (!review) {
			throw new ORPCError("NOT_FOUND", { message: "Review not found" });
		}

		if (review.status === ReviewStatus.COMPLETED) {
			throw new ORPCError("CONFLICT", { message: "This review has already been processed" });
		}

		// Check if reviewer exists and has permission
		const reviewer = await context.db.query.usersTable.findFirst({
			where: eq(usersTable.id, input.reviewedBy),
		});

		if (!reviewer) {
			throw new ORPCError("NOT_FOUND", { message: "Reviewer not found" });
		}

		// Update the review
		const [updatedReview] = await context.db
			.update(violationReviewsTable)
			.set({
				status: ReviewStatus.COMPLETED,
				reviewedBy: input.reviewedBy,
				outcome: input.outcome,
				notes: input.notes || null,
				updatedAt: new Date(),
			})
			.where(eq(violationReviewsTable.id, input.reviewId))
			.returning();

		if (!updatedReview) {
			throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to update review" });
		}

		// Update the violation based on outcome
		const violationUpdate: any = {
			reviewedBy: input.reviewedBy,
			reviewedAt: new Date(),
			reviewOutcome: input.outcome,
			reviewNotes: input.notes || null,
			updatedAt: new Date(),
		};

		// If overturned, expire the violation
		if (input.outcome === ReviewOutcome.OVERTURNED) {
			violationUpdate.expiredAt = new Date();
		}

		await context.db
			.update(violationsTable)
			.set(violationUpdate)
			.where(eq(violationsTable.id, review.violationId));

		return {
			success: true,
			message: `Review processed successfully. Outcome: ${input.outcome}`,
			review: updatedReview,
		};
	});

/**
 * Get review status for a violation
 * GET /reviews/status
 */
export const getReviewStatus = base
	.input(
		z.object({
			violationId: z.number().int().positive(),
		}),
	)
	.output(
		z.object({
			hasReview: z.boolean(),
			review: violationReviewsSchema.nullable(),
			canRequestReview: z.boolean(),
			reason: z.string().optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		// Get the violation
		const violation = await context.db.query.violationsTable.findFirst({
			where: eq(violationsTable.id, input.violationId),
		});

		if (!violation) {
			throw new ORPCError("NOT_FOUND", { message: "Violation not found" });
		}

		// Get any existing review
		const review = await context.db.query.violationReviewsTable.findFirst({
			where: eq(violationReviewsTable.violationId, input.violationId),
			orderBy: (reviews, { desc }) => [desc(reviews.createdAt)],
		});

		// Determine if user can request review
		let canRequestReview = true;
		let reason: string | undefined;

		if (violation.expiredAt) {
			canRequestReview = false;
			reason = "Violation has expired";
		} else if (violation.reviewOutcome === ReviewOutcome.OVERTURNED) {
			canRequestReview = false;
			reason = "Violation has already been overturned";
		} else if (review && review.status === ReviewStatus.PENDING) {
			canRequestReview = false;
			reason = "A review is already pending";
		} else if (review && review.status === ReviewStatus.COMPLETED) {
			canRequestReview = false;
			reason = "This violation has already been reviewed";
		}

		return {
			hasReview: !!review,
			review: review || null,
			canRequestReview,
			reason,
		};
	});

/**
 * Cancel a pending review
 * DELETE /reviews/cancel
 */
export const cancelReview = base
	.input(
		z.object({
			reviewId: z.number().int().positive(),
			userId: z.number().int().positive(),
		}),
	)
	.output(
		z.object({
			success: z.boolean(),
			message: z.string(),
		}),
	)
	.handler(async ({ input, context }) => {
		// Get the review
		const review = await context.db.query.violationReviewsTable.findFirst({
			where: eq(violationReviewsTable.id, input.reviewId),
		});

		if (!review) {
			throw new ORPCError("NOT_FOUND", { message: "Review not found" });
		}

		// Check if user owns the review
		if (review.userId !== input.userId) {
			throw new ORPCError("FORBIDDEN", { message: "You can only cancel your own reviews" });
		}

		// Check if review is still pending
		if (review.status !== ReviewStatus.PENDING) {
			throw new ORPCError("CONFLICT", { message: "Can only cancel pending reviews" });
		}

		// Delete the review
		await context.db.delete(violationReviewsTable).where(eq(violationReviewsTable.id, input.reviewId));

		// Update violation to unmark review requested
		await context.db
			.update(violationsTable)
			.set({
				reviewRequested: false,
				updatedAt: new Date(),
			})
			.where(eq(violationsTable.id, review.violationId));

		return {
			success: true,
			message: "Review request cancelled successfully",
		};
	});