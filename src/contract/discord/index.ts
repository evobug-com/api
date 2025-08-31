// import { z } from "zod";
// import { base } from "../shared/os.ts";
// import {
// 	discordVerificationResultSchema,
// 	idSchema,
// 	linkAccountResultSchema,
// 	messageLogSchema,
// 	userSchema,
// } from "../shared/schemas";
//
// /**
//  * Discord user lookup contract
//  * GET /discord/users?discord-id={discordId} - Finds a user by Discord ID
//  * Used for Discord bot integration
//  */
// export const userByDiscordId = base
// 	.input(
// 		z.object({
// 			discordId: z.string(),
// 		}),
// 	)
// 	.output(userSchema.nullable());
//
// /**
//  * Discord account linking contract
//  * POST /users/me/discord-link - Links a Discord account to the current user
//  * Requires authenticated user context
//  */
// export const createDiscordLink = base
// 	.input(
// 		z.object({
// 			discordId: z.string(),
// 		}),
// 	)
// 	.output(linkAccountResultSchema);
//
// /**
//  * Discord verification request contract
//  * POST /discord/verifications - Initiates Discord account verification
//  * Generates verification code for Discord bot
//  */
// export const createDiscordVerification = base.input(z.void()).output(discordVerificationResultSchema);
//
// /**
//  * Discord verification completion contract
//  * PUT /discord/verifications/{code} - Completes Discord account verification
//  * Validates verification code and links account
//  */
// export const updateDiscordVerification = base
// 	.input(
// 		z.object({
// 			code: z.string(),
// 			discordId: z.string(),
// 			userId: idSchema,
// 		}),
// 	)
// 	.output(linkAccountResultSchema);
//
// /**
//  * Discord user message logs retrieval contract
//  * GET /discord/message-logs?user-id={userId} - Gets message logs by Discord user ID
//  * Used for Discord moderation and history lookup
//  */
// export const messageLogs = base
// 	.input(
// 		z.object({
// 			discordUserId: z.string(),
// 			limit: z.int().min(1).max(100).optional(),
// 			offset: z.int().min(0).optional(),
// 		}),
// 	)
// 	.output(z.array(messageLogSchema));
