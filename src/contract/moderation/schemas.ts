/**
 * Shared schemas for the moderation system
 * 
 * IMPORTANT: ID Types Documentation
 * =================================
 * 
 * userId (number) - Internal database ID from the users table
 *   - This is NOT the Discord or Guilded ID
 *   - This is an auto-incrementing integer primary key
 *   - Example: 123, 456, 789
 * 
 * discordId (string) - Discord's snowflake ID
 *   - This is stored in users.discordId column
 *   - Format: 17-19 digit string
 *   - Example: "123456789012345678"
 * 
 * guildedId (string) - Guilded's user ID
 *   - This is stored in users.guildedId column
 *   - Format: Alphanumeric string
 *   - Example: "EdV4eXpR"
 * 
 * guildId (string) - Server/Guild identifier
 *   - Represents the Discord/Guilded server
 *   - Example: "987654321098765432" (Discord) or "4Rqm1234" (Guilded)
 * 
 * To find a user by Discord/Guilded ID:
 * 1. First query the users table by discordId or guildedId
 * 2. Get the user.id (internal database ID)
 * 3. Use that ID for all moderation operations
 */

import { z } from "zod";
import { 
	guildIdSchema, 
	moderatorIdSchema, 
	userIdSchema,
	userLookupSchema 
} from "../shared/schemas";

// Re-export shared schemas for convenience in moderation context
export { 
	guildIdSchema, 
	moderatorIdSchema, 
	userIdSchema,
	userLookupSchema 
};

/**
 * Violation input schemas
 */
export const issueViolationInputSchema = z.object({
	userId: userIdSchema.describe("Internal database user ID (not Discord/Guilded ID)"),
	guildId: guildIdSchema.describe("Discord/Guilded server ID"),
	type: z.string().describe("Violation type (SPAM, TOXICITY, etc.)"),
	severity: z.string().describe("Violation severity (LOW, MEDIUM, HIGH, CRITICAL)"),
	reason: z.string().min(1).max(1000).describe("Detailed reason for the violation"),
	policyViolated: z.string().optional().describe("Specific policy that was violated"),
	contentSnapshot: z.string().optional().describe("Snapshot of the violating content"),
	context: z.string().optional().describe("Additional context about the violation"),
	issuedBy: moderatorIdSchema.describe("Internal database ID of the moderator issuing the violation"),
	expiresInDays: z.number().int().positive().optional().describe("Days until violation expires (default based on severity)"),
	restrictions: z.array(z.string()).optional().describe("Feature restrictions to apply"),
	actionsApplied: z.array(z.string()).optional().describe("Actions taken (e.g., message deleted, user timed out)"),
});

/**
 * List violations input schema
 */
export const listViolationsInputSchema = z.object({
	userId: userIdSchema.optional().describe("Filter by internal user ID"),
	guildId: guildIdSchema.describe("Required: Guild/server ID"),
	includeExpired: z.boolean().default(false).describe("Include expired violations"),
	limit: z.number().int().min(1).max(100).default(50),
	offset: z.number().int().min(0).default(0),
});

/**
 * Standing check input schema
 */
export const standingInputSchema = z.object({
	userId: userIdSchema.describe("Internal database user ID"),
	guildId: guildIdSchema.describe("Guild/server ID"),
});

/**
 * Suspension input schema
 */
export const createSuspensionInputSchema = z.object({
	userId: userIdSchema.describe("Internal database user ID to suspend"),
	guildId: guildIdSchema.describe("Guild/server ID"),
	reason: z.string().min(1).max(1000).describe("Reason for suspension"),
	duration: z.number().int().positive().optional().describe("Duration in days (omit for permanent)"),
	issuedBy: moderatorIdSchema.describe("Internal database ID of the moderator"),
});

/**
 * Review request input schema
 */
export const requestReviewInputSchema = z.object({
	violationId: z.number().int().positive().describe("Violation ID to review"),
	userId: userIdSchema.describe("Internal database ID of user requesting review"),
	reason: z.string().min(10).max(1000).describe("Reason for review request"),
});