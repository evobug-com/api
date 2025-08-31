// import { z } from "zod";
// import { base } from "../shared/os.ts";
//
// /**
//  * Message log retrieval contract
//  * GET /message-logs/{messageId} - Retrieves a specific message log
//  * Returns message details including content and metadata
//  */
// export const messageLog = base
// 	.input(
// 		z.object({
// 			messageId: z.string(),
// 			platform: z.string(),
// 		}),
// 	)
// 	.output(messageLogSchema.nullable());
//
// /**
//  * User message logs retrieval contract
//  * GET /users/{userId}/message-logs - Gets message logs for a specific user
//  * Supports pagination and platform filtering
//  */
// export const userMessageLogs = base
// 	.input(
// 		z.object({
// 			userId: idSchema,
// 			platform: z.string().optional(),
// 			limit: z.int().min(1).max(100).optional(),
// 			offset: z.int().min(0).optional(),
// 		}),
// 	)
// 	.output(z.array(messageLogSchema));
//
// /**
//  * Message logs statistics retrieval contract
//  * GET /message-logs/stats - Gets aggregated message log statistics
//  * Provides analytics on message activity
//  */
// export const messageLogStats = base
// 	.input(
// 		z.object({
// 			userId: idSchema.optional(),
// 			platform: z.string().optional(),
// 		}),
// 	)
// 	.output(messageLogsStatsSchema);
//
// /**
//  * Message log creation contract
//  * POST /message-logs - Creates a new message log entry
//  * Records message for audit and moderation purpoces
//  */
// export const createMessageLog = base
// 	.input(
// 		z.object({
// 			messageData: messageLogInputSchema,
// 		}),
// 	)
// 	.output(messageLogResultSchema);
//
// /**
//  * Message log update contract
//  * PATCH /message-logs/{messageId} - Updates an existing message log
//  * Allows updating message content and metadata
//  */
// export const updateMessageLog = base
// 	.input(
// 		z.object({
// 			messageId: z.string(),
// 			platform: z.string(),
// 			updates: messageLogUpdateInputSchema,
// 		}),
// 	)
// 	.output(messageLogResultSchema);
//
// /**
//  * Message deletion marking contract
//  * PUT /message-logs/{messageId}/deleted - Marks a message as deleted
//  * Soft delete for audit trail preservation
//  */
// export const updateMessageDeletedStatus = base
// 	.input(
// 		z.object({
// 			messageId: z.string(),
// 			platform: z.string(),
// 		}),
// 	)
// 	.output(booleanSchema);
//
// /**
//  * Message edit marking contract
//  * PUT /message-logs/{messageId}/edited - Marks a message as edited
//  * Tracks message edit history
//  */
// export const updateMessageEditedStatus = base
// 	.input(
// 		z.object({
// 			messageId: z.string(),
// 			platform: z.string(),
// 		}),
// 	)
// 	.output(booleanSchema);
