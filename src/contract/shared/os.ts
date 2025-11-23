import {onError, os, ValidationError} from "@orpc/server";
import type { HeadersInit } from "bun";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql/postgres";
import { z } from "zod";
import type { relations } from "../../db/relations.ts";
import type * as schema from "../../db/schema.ts";
import type { DbUser } from "../../db/schema.ts";
import {ORPCError} from "@orpc/client";

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
	}).use(onError((error) => {
		console.log(error)
		if (
			error instanceof ORPCError
			&& error.code === 'BAD_REQUEST'
			&& error.cause instanceof ValidationError
		) {
			// If you only use Zod you can safely cast to ZodIssue[]
			const zodError = new z.ZodError(error.cause.issues as z.core.$ZodIssue[])

			throw new ORPCError('INPUT_VALIDATION_FAILED', {
				status: 422,
				message: z.prettifyError(zodError),
				data: z.flattenError(zodError),
				cause: error.cause,
			})
		}

		if (
			error instanceof ORPCError
			&& error.code === 'INTERNAL_SERVER_ERROR'
			&& error.cause instanceof ValidationError
		) {
			throw new ORPCError('OUTPUT_VALIDATION_FAILED', {
				cause: error.cause,
			})
		}
	}))



;
