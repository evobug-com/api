/**
 * Branded types for better type safety across the API
 * These types help prevent mixing up different kinds of IDs
 */

import { z } from "zod";

// Brand symbols for nominal typing
declare const UserIdBrand: unique symbol;
declare const DiscordIdBrand: unique symbol;
declare const GuildedIdBrand: unique symbol;
declare const GuildIdBrand: unique symbol;
declare const ModeratorIdBrand: unique symbol;

/**
 * UserId - Internal database user ID (auto-incrementing integer)
 * This is the primary key in the users table
 */
export type UserId = number & { readonly [UserIdBrand]: typeof UserIdBrand };

/**
 * DiscordId - Discord's snowflake ID (string)
 * This is the user's Discord account ID
 */
export type DiscordId = string & { readonly [DiscordIdBrand]: typeof DiscordIdBrand };

/**
 * GuildedId - Guilded's user ID (string)
 * This is the user's Guilded account ID
 */
export type GuildedId = string & { readonly [GuildedIdBrand]: typeof GuildedIdBrand };

/**
 * GuildId - Discord/Guilded server ID (string)
 * This identifies which server the action is happening in
 */
export type GuildId = string & { readonly [GuildIdBrand]: typeof GuildIdBrand };

/**
 * ModeratorId - Same as UserId but semantically indicates a moderator
 * This is the internal database ID of the moderator performing an action
 */
export type ModeratorId = UserId & { readonly [ModeratorIdBrand]: typeof ModeratorIdBrand };

// Zod schemas with branding for runtime validation

/**
 * Schema for internal user ID
 * @example 123 (database auto-increment ID)
 */
export const userIdSchema = z
	.number()
	.int()
	.positive()
	.brand<"UserId">()
	.describe("Internal database user ID (not Discord/Guilded ID)");

/**
 * Schema for Discord user ID
 * @example "123456789012345678" (Discord snowflake)
 */
export const discordIdSchema = z
	.string()
	.regex(/^\d{17,19}$/, "Invalid Discord ID format")
	.brand<"DiscordId">()
	.describe("Discord user ID (snowflake)");

/**
 * Schema for Guilded user ID
 * @example "EdV4eXpR" (Guilded's ID format)
 */
export const guildedIdSchema = z
	.string()
	.min(1)
	.brand<"GuildedId">()
	.describe("Guilded user ID");

/**
 * Schema for server/guild ID
 * @example "987654321098765432" (Discord) or "4Rqm1234" (Guilded)
 */
export const guildIdSchema = z
	.string()
	.min(1)
	.brand<"GuildId">()
	.describe("Discord/Guilded server ID");

/**
 * Schema for moderator ID (same as user ID but with semantic meaning)
 */
export const moderatorIdSchema = userIdSchema
	.brand<"ModeratorId">()
	.describe("Internal database ID of the moderator");

// Helper functions for type conversions

/**
 * Convert a number to UserId (with validation)
 */
export function toUserId(id: number): UserId {
	return userIdSchema.parse(id) as unknown as UserId;
}

/**
 * Convert a string to DiscordId (with validation)
 */
export function toDiscordId(id: string): DiscordId {
	return discordIdSchema.parse(id) as unknown as DiscordId;
}

/**
 * Convert a string to GuildedId (with validation)
 */
export function toGuildedId(id: string): GuildedId {
	return guildedIdSchema.parse(id) as unknown as GuildedId;
}

/**
 * Convert a string to GuildId (with validation)
 */
export function toGuildId(id: string): GuildId {
	return guildIdSchema.parse(id) as unknown as GuildId;
}

/**
 * Convert a UserId to ModeratorId
 */
export function toModeratorId(id: UserId): ModeratorId {
	return id as ModeratorId;
}

// Type guards

export function isUserId(value: unknown): value is UserId {
	return userIdSchema.safeParse(value).success;
}

export function isDiscordId(value: unknown): value is DiscordId {
	return discordIdSchema.safeParse(value).success;
}

export function isGuildedId(value: unknown): value is GuildedId {
	return guildedIdSchema.safeParse(value).success;
}

export function isGuildId(value: unknown): value is GuildId {
	return guildIdSchema.safeParse(value).success;
}