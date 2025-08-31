// import { z } from "zod";
// import { base } from "../shared/os.ts";
// import { linkAccountResultSchema, messageLogSchema, userSchema } from "../shared/schemas";
//
// /**
//  * Guilded user lookup contract
//  * GET /guilded/users?guilded-id={guildedId} - Finds a user by Guilded ID
//  * Used for Guilded bot integration
//  */
// export const userByGuildedId = base
// 	.input(
// 		z.object({
// 			guildedId: z.string(),
// 		}),
// 	)
// 	.output(userSchema.nullable());
//
// /**
//  * Guilded account linking contract
//  * POST /users/me/guilded-link - Links a Guilded account to the current user
//  * Requires authenticated user context
//  */
// export const createGuildedLink = base
// 	.input(
// 		z.object({
// 			guildedId: z.string(),
// 		}),
// 	)
// 	.output(linkAccountResultSchema);
//
// /**
//  * Guilded user message logs retrieval contract
//  * GET /guilded/message-logs?user-id={userId} - Gets message logs by Guilded user ID
//  * Used for Guilded moderation and history lookup
//  */
// export const messageLogs = base
// 	.input(
// 		z.object({
// 			guildedUserId: z.string(),
// 			limit: z.int().min(1).max(100).optional(),
// 			offset: z.int().min(0).optional(),
// 		}),
// 	)
// 	.output(z.array(messageLogSchema));
