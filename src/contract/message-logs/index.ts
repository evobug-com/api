import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { insertMessagesLogsSchema, messagesLogsTable, usersTable } from "../../db/schema.ts";
import { base } from "../shared/os.ts";

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
/**
 * Message log creation contract
 * POST /message-logs - Creates a new message log entry
 * Records message for audit and moderation purpoces
 */
export const createMessageLog = base
	.input(insertMessagesLogsSchema)
	.output(z.boolean())
	.handler(async ({ input, context, errors }) => {
		if (!input.userId) {
			throw errors.BAD_REQUEST({
				data: {
					reason: "userId is required",
				},
			});
		}

		// Check if user exists
		const [user] = await context.db.select().from(usersTable).where(eq(usersTable.id, input.userId)).limit(1);

		if (!user) {
			throw errors.BAD_REQUEST({
				data: {
					reason: "User with the provided userId does not exist",
				},
			});
		}

		await context.db.insert(messagesLogsTable).values(input);
		return true;
	});

/**
 * Message log update contract
 * PATCH /message-logs - Updates an existing message log
 * Keeps track of all previous message contents in editedContents array
 */
export const updateMessageLog = base
	.input(
		z.object({
			messageId: z.string(),
			platform: z.string(),
			newContent: z.string(),
		}),
	)
	.output(
		z.object({
			id: z.number(),
			userId: z.number().nullable(),
			messageId: z.string(),
			platform: z.string(),
			channelId: z.string(),
			content: z.string(),
			editedContents: z.array(z.string()).nullable(),
			editCount: z.number(),
			createdAt: z.date(),
			updatedAt: z.date(),
			deletedAt: z.date().nullable(),
		}),
	)
	.handler(async ({ input, context, errors }) => {
		// Find the existing message log
		const [existingLog] = await context.db
			.select()
			.from(messagesLogsTable)
			.where(and(eq(messagesLogsTable.messageId, input.messageId), eq(messagesLogsTable.platform, input.platform)))
			.limit(1);

		if (!existingLog) {
			throw errors.NOT_FOUND({
				message: "Message log not found",
			});
		}

		// Prepare the edit history
		// Add the current content to the editedContents array before updating
		const previousContents = existingLog.editedContents || [];
		const updatedEditHistory = [...previousContents, existingLog.content];

		// Update the message log
		const [updatedLog] = await context.db
			.update(messagesLogsTable)
			.set({
				content: input.newContent,
				editedContents: updatedEditHistory,
				editCount: existingLog.editCount + 1,
				updatedAt: new Date(),
			})
			.where(and(eq(messagesLogsTable.messageId, input.messageId), eq(messagesLogsTable.platform, input.platform)))
			.returning();

		if (!updatedLog) {
			throw errors.INTERNAL_ERROR();
		}

		return updatedLog;
	});

/**
 * Message deletion marking contract
 * PUT /message-logs/deleted - Marks a message as deleted
 * Soft delete for audit trail preservation
 */
export const updateMessageDeletedStatus = base
	.input(
		z.object({
			messageId: z.string(),
			platform: z.string(),
		}),
	)
	.output(z.boolean())
	.handler(async ({ input, context, errors }) => {
		// Find the existing message log
		const [existingLog] = await context.db
			.select()
			.from(messagesLogsTable)
			.where(and(eq(messagesLogsTable.messageId, input.messageId), eq(messagesLogsTable.platform, input.platform)))
			.limit(1);

		if (!existingLog) {
			throw errors.NOT_FOUND({
				message: "Message log not found",
			});
		}

		// Mark as deleted
		const [updatedLog] = await context.db
			.update(messagesLogsTable)
			.set({
				deletedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(and(eq(messagesLogsTable.messageId, input.messageId), eq(messagesLogsTable.platform, input.platform)))
			.returning();

		return !!updatedLog;
	});

/**
 * Message edit marking contract
 * PUT /message-logs/edited - Marks a message as edited without changing content
 * Used when we want to track that a message was edited but don't have the new content
 */
export const updateMessageEditedStatus = base
	.input(
		z.object({
			messageId: z.string(),
			platform: z.string(),
		}),
	)
	.output(z.boolean())
	.handler(async ({ input, context, errors }) => {
		// Find the existing message log
		const [existingLog] = await context.db
			.select()
			.from(messagesLogsTable)
			.where(and(eq(messagesLogsTable.messageId, input.messageId), eq(messagesLogsTable.platform, input.platform)))
			.limit(1);

		if (!existingLog) {
			throw errors.NOT_FOUND({
				message: "Message log not found",
			});
		}

		// Just increment edit count without changing content
		const [updatedLog] = await context.db
			.update(messagesLogsTable)
			.set({
				editCount: existingLog.editCount + 1,
				updatedAt: new Date(),
			})
			.where(and(eq(messagesLogsTable.messageId, input.messageId), eq(messagesLogsTable.platform, input.platform)))
			.returning();

		return !!updatedLog;
	});
