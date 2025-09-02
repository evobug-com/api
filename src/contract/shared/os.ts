import type { IncomingHttpHeaders } from "node:http";
import { os } from "@orpc/server";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { z } from "zod";
import type * as schema from "../../db/schema.ts";
import type { DbUser } from "../../db/schema.ts";

export const base = os
	.$context<{
		db: BunSQLDatabase<typeof schema>;
		user: Partial<DbUser> | undefined;
		headers: IncomingHttpHeaders;
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
