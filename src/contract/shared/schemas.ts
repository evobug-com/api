/**
 * Shared schemas for use across all API contracts
 * 
 * These schemas provide type-safe ID validation and are used throughout
 * the API to ensure consistency and prevent ID type confusion.
 * 
 * IMPORTANT: 
 * - userId is ALWAYS an internal database ID (number)
 * - discordId is a Discord snowflake (string)
 * - guildedId is a Guilded ID (string)
 * - guildId is a server ID (string)
 */

import { z } from "zod";
import { 
	discordIdSchema, 
	guildIdSchema, 
	guildedIdSchema, 
	moderatorIdSchema, 
	userIdSchema 
} from "../../utils/branded-types";

// Re-export branded ID schemas for use across all contracts
export { 
	discordIdSchema, 
	guildIdSchema, 
	guildedIdSchema, 
	moderatorIdSchema, 
	userIdSchema 
};

/**
 * Common input for user lookup
 * Allows finding users by internal ID, Discord ID, or Guilded ID
 */
export const userLookupSchema = z
	.object({
		userId: userIdSchema.optional(),
		discordId: discordIdSchema.optional(),
		guildedId: guildedIdSchema.optional(),
	})
	.refine(
		(data) => data.userId || data.discordId || data.guildedId,
		"At least one ID type must be provided"
	)
	.describe("User lookup - provide either internal userId, discordId, or guildedId");

//
// export const authTokenSchema = z.object({
//   token: z.string(),
//   user: userSchema,
//   expiresAt: dateSchema,
// })
//
//
// // Leaderboard schemas
// export const leaderboardEntrySchema = z.object({
//   rank: z.int(),
//   user: userSchema,
//   stats: userStatsSchema,
// })
//
// export const leaderboardSchema = z.object({
//   entries: z.array(leaderboardEntrySchema),
//   totalUsers: z.int(),
// })
//
// // Activity result schemas
// export const activityResultSchema = z.object({
//   success: z.boolean(),
//   coinsEarned: z.int(),
//   xpEarned: z.int(),
//   newTotal: z.object({
//     coins: z.int(),
//     xp: z.int(),
//     level: z.int(),
//   }),
//   cooldownEndsAt: dateSchema,
//   message: z.string(),
// })
//
// // Additional schemas for compatibility with existing code
// export const authPayloadSchema = z.object({
//   token: z.string(),
//   user: userSchema,
// })
//
// export const linkAccountResultSchema = z.object({
//   success: z.boolean(),
//   message: z.string(),
//   user: userSchema.optional(),
// })
//
// export const discordVerificationResultSchema = z.object({
//   success: z.boolean(),
//   message: z.string(),
//   verificationCode: z.string(),
//   expiresAt: timestampSchema,
// })
//
// export const messageLogInputSchema = z.object({
//   messageId: z.string(),
//   platform: z.string(),
//   userId: z.string().optional(),
//   discordUserId: z.string().optional(),
//   guildedUserId: z.string().optional(),
//   guildId: z.string().optional(),
//   guildName: z.string().optional(),
//   channelId: z.string().optional(),
//   channelName: z.string().optional(),
//   content: z.string().optional(),
//   contentLength: z.int().min(0).optional(),
//   messageType: z.string().optional(),
//   isBot: z.boolean().optional(),
//   isSystem: z.boolean().optional(),
//   isWebhook: z.boolean().optional(),
//   hasAttachments: z.boolean().optional(),
//   attachmentCount: z.int().min(0).optional(),
//   hasEmbeds: z.boolean().optional(),
//   embedCount: z.int().min(0).optional(),
//   hasMentions: z.boolean().optional(),
//   mentionCount: z.int().min(0).optional(),
//   metadata: z.array(z.object({
//     metadataKey: z.string(),
//     metadataType: z.string(),
//     metadataValue: z.string().nullable().optional(),
//   })).optional(),
// })
//
// export const messageLogUpdateInputSchema = z.object({
//   content: z.string().optional(),
//   contentLength: z.int().min(0).optional(),
//   messageType: z.string().optional(),
//   hasAttachments: z.boolean().optional(),
//   attachmentCount: z.int().min(0).optional(),
//   hasEmbeds: z.boolean().optional(),
//   embedCount: z.int().min(0).optional(),
//   hasMentions: z.boolean().optional(),
//   mentionCount: z.int().min(0).optional(),
// })
//
// export const messageLogResultSchema = z.object({
//   success: z.boolean(),
//   message: z.string(),
//   messageLog: messageLogSchema.optional(),
// })
//
// export const messageLogsStatsSchema = z.object({
//   totalMessages: z.int().min(0),
//   totalCharacters: z.int().min(0),
//   averageLength: z.int().min(0),
//   editedMessages: z.int().min(0),
//   deletedMessages: z.int().min(0),
//   messagesWithAttachments: z.int().min(0),
//   messagesWithEmbeds: z.int().min(0),
//   messagesByType: z.array(z.object({
//     type: z.string(),
//     count: z.int().min(0),
//   })),
// })
//
// export const purchaseResultSchema = z.object({
//   success: z.boolean(),
//   message: z.string(),
//   order: orderSchema.optional(),
//   remainingCoins: z.int().min(0).optional(),
// })
//
// export const deliveryInfoInputSchema = z.object({
//   name: z.string(),
//   address: z.string(),
//   city: z.string(),
//   postalCode: z.string(),
//   phone: z.string(),
//   notes: z.string().optional(),
// })
//
// // Review schemas - extending the base user review
// export const reviewStatusEnum = z.enum(['pending', 'approved', 'rejected'])
//
// export const reviewSchema = userReviewSchema.extend({
//   promptUsed: z.string().nullable().optional(),
//   status: reviewStatusEnum,
//   depositAmount: z.int().min(0),
//   depositReturned: z.boolean(),
//   rejectionReason: z.string().nullable().optional(),
//   createdAt: timestampSchema,
//   updatedAt: timestampSchema,
//   reviewedAt: z.string().nullable().optional(),
//   reviewedBy: userSchema.optional(),
// })
//
// export const reviewInputSchema = z.object({
//   rating: z.int().min(1).max(5),
//   text: z.string().min(10).max(1000),
//   promptUsed: z.string().optional(),
// })
//
// export const reviewEligibilitySchema = z.object({
//   eligible: z.boolean(),
//   reason: z.string().optional(),
//   criteria: z.object({
//     messageCount: z.int().min(0),
//     joinedDays: z.int().min(0),
//     eventParticipation: z.int().min(0),
//     violations: z.int().min(0),
//   }),
//   depositRequired: z.int().min(0),
//   userBalance: z.int().min(0),
//   hasEnoughCoins: z.boolean(),
// })
//
// export const reviewSubmissionResultSchema = z.object({
//   success: z.boolean(),
//   message: z.string(),
//   review: reviewSchema.optional(),
//   depositTaken: z.int().min(0),
// })
//
// export const reviewModerationResultSchema = z.object({
//   success: z.boolean(),
//   message: z.string(),
//   depositReturned: z.int().min(0),
// })
//
// export const topUserSchema = z.object({
//   userId: z.string(),
//   user: userSchema.optional(),
//   rank: z.int().min(1),
//   xp: z.int().min(0),
//   coins: z.int().min(0),
//   level: z.int().min(0),
//   dailyStreak: z.int().min(0),
//   maxDailyStreak: z.int().min(0),
//   workCount: z.int().min(0),
// })
//
// export const eventParticipationResultSchema = z.object({
//   success: z.boolean(),
//   message: z.string(),
// })
//
// export const messageCountResultSchema = z.object({
//   success: z.boolean(),
//   newCount: z.int().min(0),
// })
//
// export const passwordChangeResultSchema = z.object({
//   success: z.boolean(),
//   message: z.string(),
// })
//
// // Warning schemas - extending the base warning
// export const warningSchema = userWarningSchema.extend({
//   isActive: z.boolean(),
//   warnedByUser: userSchema.optional(),
// })
//
// export const warnResultSchema = z.object({
//   warning: warningSchema,
//   message: z.string(),
//   totalActiveWarnings: z.int().min(0),
//   shouldBan: z.boolean(),
// })
//
// // Type exports for TypeScript usage
// export type User = z.infer<typeof userSchema>
// export type Product = z.infer<typeof productSchema>
// export type Order = z.infer<typeof orderSchema>
// export type Event = z.infer<typeof eventSchema>
// export type Leaderboard = z.infer<typeof leaderboardSchema>
