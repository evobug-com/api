// import { z } from "zod";
// import { base } from "../shared/os.ts";
// import {
// 	idSchema,
// 	reviewEligibilitySchema,
// 	reviewInputSchema,
// 	reviewModerationResultSchema,
// 	reviewSchema,
// 	reviewStatusEnum,
// 	reviewSubmissionResultSchema,
// } from "../shared/schemas";
//
// /**
//  * User review retrieval contract
//  * GET /users/{userId}/reviews - Gets user's submitted review
//  */
// export const userReview = base
// 	.input(
// 		z.object({
// 			userId: idSchema,
// 		}),
// 	)
// 	.output(reviewSchema.nullable());
//
// /**
//  * Review eligibility check contract
//  * GET /users/{userId}/review-eligibility - Checks if user is eligible to submit a review
//  */
// export const userReviewEligibility = base
// 	.input(
// 		z.object({
// 			userId: idSchema,
// 		}),
// 	)
// 	.output(reviewEligibilitySchema);
//
// /**
//  * Approved reviews listing contract
//  * GET /reviews?status=approved - Gets all approved reviews
//  */
// export const reviews = base.input(z.void()).output(z.array(reviewSchema));
//
// /**
//  * Pending reviews listing contract
//  * GET /reviews?status=pending - Gets all pending reviews (admin only)
//  */
// export const pendingReviews = base.input(z.void()).output(z.array(reviewSchema));
//
// /**
//  * Review submission contract
//  * POST /reviews - Creates a new review submission
//  */
// export const createReview = base
// 	.input(
// 		z.object({
// 			review: reviewInputSchema,
// 		}),
// 	)
// 	.output(reviewSubmissionResultSchema);
//
// /**
//  * Review moderation contract
//  * PATCH /reviews/{reviewId} - Updates review status (approve/reject)
//  */
// export const updateReviewStatus = base
// 	.input(
// 		z.object({
// 			reviewId: idSchema,
// 			status: reviewStatusEnum,
// 			rejectionReason: z.string().optional(),
// 		}),
// 	)
// 	.output(reviewModerationResultSchema);
