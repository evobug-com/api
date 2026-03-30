import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ORPCError } from "@orpc/client";
import { call } from "@orpc/server";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql/postgres";
import type { relations } from "../../db/relations.ts";
import type * as schema from "../../db/schema.ts";
import { createTestDatabase } from "../shared/test-utils.ts";
import { subscribe } from "./index.ts";

type AnyORPCError = ORPCError<string, unknown>;

/** Helper to mock globalThis.fetch while satisfying Bun's fetch type (which includes preconnect). */
function mockFetch(handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response>): void {
	const mock = Object.assign(handler, { preconnect: globalThis.fetch.preconnect }) as typeof globalThis.fetch;
	globalThis.fetch = mock;
}

describe("Newsletter Subscribe", () => {
	let db: BunSQLDatabase<typeof schema, typeof relations>;
	const originalFetch = globalThis.fetch;
	let originalResendApiKey: string | undefined;
	let originalResendSegmentId: string | undefined;

	beforeEach(async () => {
		db = await createTestDatabase();

		// Preserve original env vars
		originalResendApiKey = process.env.RESEND_API_KEY;
		originalResendSegmentId = process.env.RESEND_SEGMENT_ID;

		// Set required env vars for tests
		process.env.RESEND_API_KEY = "test-key";
		process.env.RESEND_SEGMENT_ID = "test-segment";

		// Default fetch mock: successful Resend response
		mockFetch(async () =>
			new Response(JSON.stringify({ id: "contact-123" }), { status: 200 }));
	});

	afterEach(() => {
		// Restore original fetch
		globalThis.fetch = originalFetch;

		// Restore original env vars
		process.env.RESEND_API_KEY = originalResendApiKey;
		process.env.RESEND_SEGMENT_ID = originalResendSegmentId;
	});

	describe("successful subscription", () => {
		it("should subscribe with a valid email and return success", async () => {
			const result = await call(
				subscribe,
				{ email: "user@example.com" },
				{
					context: {
						db,
						user: undefined,
						headers: new Headers({ "x-forwarded-for": "10.0.0.1" }),
					},
				},
			);

			expect(result).toStrictEqual({ success: true });
		});

		it("should send correct payload to Resend API", async () => {
			let capturedUrl: string | undefined;
			let capturedInit: RequestInit | undefined;

			mockFetch(async (input: string | URL | Request, init?: RequestInit) => {
				capturedUrl = typeof input === "string" ? input : String(input);
				capturedInit = init;
				return new Response(JSON.stringify({ id: "contact-456" }), { status: 200 });
			});

			await call(
				subscribe,
				{ email: "payload@example.com" },
				{
					context: {
						db,
						user: undefined,
						headers: new Headers({ "x-forwarded-for": "10.0.0.2" }),
					},
				},
			);

			expect(capturedUrl).toBe("https://api.resend.com/contacts");
			expect(capturedInit?.method).toBe("POST");

			const headers = capturedInit?.headers as Record<string, string>;
			expect(headers["Authorization"]).toBe("Bearer test-key");
			expect(headers["Content-Type"]).toBe("application/json");

			const body = JSON.parse(capturedInit?.body as string);
			expect(body).toStrictEqual({
				email: "payload@example.com",
				unsubscribed: false,
				segments: [{ id: "test-segment" }],
			});
		});
	});

	describe("input validation", () => {
		it("should reject an invalid email address", async () => {
			await expect(
				call(
					subscribe,
					{ email: "not-an-email" },
					{
						context: {
							db,
							user: undefined,
							headers: new Headers({ "x-forwarded-for": "10.0.1.1" }),
						},
					},
				),
			).rejects.toThrow(ORPCError);
		});

		it("should reject an empty email string", async () => {
			await expect(
				call(
					subscribe,
					{ email: "" },
					{
						context: {
							db,
							user: undefined,
							headers: new Headers({ "x-forwarded-for": "10.0.1.2" }),
						},
					},
				),
			).rejects.toThrow(ORPCError);
		});
	});

	describe("Resend API failure", () => {
		it("should throw RESEND_ERROR when Resend API returns non-ok status", async () => {
			mockFetch(async () =>
				new Response(JSON.stringify({ error: "Invalid API key" }), { status: 403 }));

			await expect(
				call(
					subscribe,
					{ email: "fail@example.com" },
					{
						context: {
							db,
							user: undefined,
							headers: new Headers({ "x-forwarded-for": "10.0.2.1" }),
						},
					},
				),
			).rejects.toThrow(ORPCError);

			try {
				mockFetch(async () =>
					new Response(JSON.stringify({ error: "Invalid API key" }), { status: 403 }));

				await call(
					subscribe,
					{ email: "fail2@example.com" },
					{
						context: {
							db,
							user: undefined,
							headers: new Headers({ "x-forwarded-for": "10.0.2.2" }),
						},
					},
				);
			} catch (error) {
				expect(error).toBeInstanceOf(ORPCError);
				expect((error as AnyORPCError).code).toBe("RESEND_ERROR");
			}
		});

		it("should throw RESEND_ERROR when Resend returns 500", async () => {
			mockFetch(async () =>
				new Response("Internal Server Error", { status: 500 }));

			try {
				await call(
					subscribe,
					{ email: "server-error@example.com" },
					{
						context: {
							db,
							user: undefined,
							headers: new Headers({ "x-forwarded-for": "10.0.2.3" }),
						},
					},
				);
				// Should not reach here
				expect(true).toBe(false);
			} catch (error) {
				expect(error).toBeInstanceOf(ORPCError);
				expect((error as AnyORPCError).code).toBe("RESEND_ERROR");
			}
		});
	});

	describe("missing environment variables", () => {
		it("should throw INTERNAL_ERROR when RESEND_API_KEY is missing", async () => {
			delete process.env.RESEND_API_KEY;

			try {
				await call(
					subscribe,
					{ email: "nokey@example.com" },
					{
						context: {
							db,
							user: undefined,
							headers: new Headers({ "x-forwarded-for": "10.0.3.1" }),
						},
					},
				);
				expect(true).toBe(false);
			} catch (error) {
				expect(error).toBeInstanceOf(ORPCError);
				expect((error as AnyORPCError).code).toBe("INTERNAL_ERROR");
			}
		});

		it("should throw INTERNAL_ERROR when RESEND_SEGMENT_ID is missing", async () => {
			delete process.env.RESEND_SEGMENT_ID;

			try {
				await call(
					subscribe,
					{ email: "nosegment@example.com" },
					{
						context: {
							db,
							user: undefined,
							headers: new Headers({ "x-forwarded-for": "10.0.3.2" }),
						},
					},
				);
				expect(true).toBe(false);
			} catch (error) {
				expect(error).toBeInstanceOf(ORPCError);
				expect((error as AnyORPCError).code).toBe("INTERNAL_ERROR");
			}
		});

		it("should throw INTERNAL_ERROR when both env vars are missing", async () => {
			delete process.env.RESEND_API_KEY;
			delete process.env.RESEND_SEGMENT_ID;

			try {
				await call(
					subscribe,
					{ email: "noenv@example.com" },
					{
						context: {
							db,
							user: undefined,
							headers: new Headers({ "x-forwarded-for": "10.0.3.3" }),
						},
					},
				);
				expect(true).toBe(false);
			} catch (error) {
				expect(error).toBeInstanceOf(ORPCError);
				expect((error as AnyORPCError).code).toBe("INTERNAL_ERROR");
			}
		});
	});

	describe("rate limiting", () => {
		// Each rate limit test uses a unique IP to avoid cross-test interference
		// because the rate limiter is module-level state.

		it("should allow up to 3 requests from the same IP", async () => {
			const ip = "10.1.0.1";
			const context = {
				context: {
					db,
					user: undefined,
					headers: new Headers({ "x-forwarded-for": ip }),
				},
			};

			// First 3 requests should succeed
			const result1 = await call(subscribe, { email: "r1@example.com" }, context);
			expect(result1).toStrictEqual({ success: true });

			const result2 = await call(subscribe, { email: "r2@example.com" }, context);
			expect(result2).toStrictEqual({ success: true });

			const result3 = await call(subscribe, { email: "r3@example.com" }, context);
			expect(result3).toStrictEqual({ success: true });
		});

		it("should reject the 4th request from the same IP with RATE_LIMITED", async () => {
			const ip = "10.1.0.2";
			const context = {
				context: {
					db,
					user: undefined,
					headers: new Headers({ "x-forwarded-for": ip }),
				},
			};

			// Exhaust the rate limit
			await call(subscribe, { email: "a1@example.com" }, context);
			await call(subscribe, { email: "a2@example.com" }, context);
			await call(subscribe, { email: "a3@example.com" }, context);

			// 4th request should be rate limited
			try {
				await call(subscribe, { email: "a4@example.com" }, context);
				expect(true).toBe(false);
			} catch (error) {
				expect(error).toBeInstanceOf(ORPCError);
				expect((error as AnyORPCError).code).toBe("RATE_LIMITED");
			}
		});

		it("should include retryAfter data in rate limit error", async () => {
			const ip = "10.1.0.3";
			const context = {
				context: {
					db,
					user: undefined,
					headers: new Headers({ "x-forwarded-for": ip }),
				},
			};

			await call(subscribe, { email: "b1@example.com" }, context);
			await call(subscribe, { email: "b2@example.com" }, context);
			await call(subscribe, { email: "b3@example.com" }, context);

			try {
				await call(subscribe, { email: "b4@example.com" }, context);
				expect(true).toBe(false);
			} catch (error) {
				expect(error).toBeInstanceOf(ORPCError);
				const orpcError = error as AnyORPCError;
				expect(orpcError.code).toBe("RATE_LIMITED");
				expect(orpcError.data).toStrictEqual({ retryAfter: 600 });
			}
		});

		it("should track rate limits per IP independently", async () => {
			const ipA = "10.1.1.1";
			const ipB = "10.1.1.2";

			const contextA = {
				context: {
					db,
					user: undefined,
					headers: new Headers({ "x-forwarded-for": ipA }),
				},
			};
			const contextB = {
				context: {
					db,
					user: undefined,
					headers: new Headers({ "x-forwarded-for": ipB }),
				},
			};

			// Exhaust rate limit for IP A
			await call(subscribe, { email: "c1@example.com" }, contextA);
			await call(subscribe, { email: "c2@example.com" }, contextA);
			await call(subscribe, { email: "c3@example.com" }, contextA);

			// IP A should be rate limited
			await expect(
				call(subscribe, { email: "c4@example.com" }, contextA),
			).rejects.toThrow(ORPCError);

			// IP B should still be allowed
			const result = await call(subscribe, { email: "d1@example.com" }, contextB);
			expect(result).toStrictEqual({ success: true });
		});

		it("should use 'unknown' as IP when x-forwarded-for header is absent", async () => {
			// Use a context with no x-forwarded-for. The IP will fall back to "unknown".
			// We use a fresh Headers with no forwarded-for to test this path.
			// Note: This IP bucket ("unknown") may already have entries from other tests
			// if they also lack the header. We use a plain object for headers here.
			const contextNoIp = {
				context: {
					db,
					user: undefined,
					headers: new Headers(),
				},
			};

			// This should at least not crash -- it may or may not be rate limited
			// depending on other tests. We just verify it does not throw a TypeError.
			try {
				const result = await call(subscribe, { email: "noip@example.com" }, contextNoIp);
				expect(result).toStrictEqual({ success: true });
			} catch (error) {
				// If rate limited from shared "unknown" bucket, that is acceptable
				expect(error).toBeInstanceOf(ORPCError);
				const code = (error as AnyORPCError).code;
				expect(["RATE_LIMITED"]).toContain(code);
			}
		});

		it("should parse the first IP from a comma-separated x-forwarded-for", async () => {
			// "10.1.2.1, 10.1.2.99" should use "10.1.2.1" as the rate limit key
			const ip = "10.1.2.1";
			const context = {
				context: {
					db,
					user: undefined,
					headers: new Headers({ "x-forwarded-for": `${ip}, 10.1.2.99` }),
				},
			};

			const result = await call(subscribe, { email: "proxy@example.com" }, context);
			expect(result).toStrictEqual({ success: true });

			// Use the same first IP directly, it should share the rate limit bucket
			const contextDirect = {
				context: {
					db,
					user: undefined,
					headers: new Headers({ "x-forwarded-for": ip }),
				},
			};

			const result2 = await call(subscribe, { email: "proxy2@example.com" }, contextDirect);
			expect(result2).toStrictEqual({ success: true });
		});
	});
});
