import { os } from "@orpc/server";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { z } from "zod";
import type { relations } from "../../db/relations.ts";
import type * as schema from "../../db/schema.ts";
import type { DbUser } from "../../db/schema.ts";
import type { HeadersInit } from "bun";

export const base = os
	.$context<{
		db: BunSQLDatabase<typeof schema, typeof relations>;
		user: Partial<DbUser> | undefined;
		headers: HeadersInit;
	}>()
	.errors({
		RATE_LIMITED: {
			message: "You are being rate limited",
			data: z.object({
				retryAfter: z.number(),
			}),
		},
		UNAUTHORIZED: {
			message: "You are not authorized to perform this action",
		},
		FORBIDDEN: {
			message: "Access forbidden",
		},
		NOT_FOUND: {
			message: "Resource not found",
		},
		BAD_REQUEST: {
			message: "Invalid request",
			data: z
				.object({
					field: z.string().optional(),
					reason: z.string().optional(),
				})
				.optional(),
		},
		CONFLICT: {
			message: "Resource conflict",
			data: z
				.object({
					reason: z.string(),
				})
				.optional(),
		},
		INTERNAL_ERROR: {
			message: "An internal error occurred",
		},
	});
