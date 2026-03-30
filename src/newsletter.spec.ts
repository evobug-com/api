import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { handleNewsletterSubscribe } from "./newsletter.ts";

function mockFetch(handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response>): void {
	const mock = Object.assign(handler, { preconnect: globalThis.fetch.preconnect }) as typeof globalThis.fetch;
	globalThis.fetch = mock;
}

let ipCounter = 100;
function uniqueIp(): string {
	return `192.168.${Math.floor(ipCounter / 256)}.${ipCounter++ % 256}`;
}

function makeRequest(body?: unknown, headers?: Record<string, string>, method = "POST"): Request {
	return new Request("http://localhost/newsletter/subscribe", {
		method,
		headers: { "Content-Type": "application/json", "x-forwarded-for": uniqueIp(), ...headers },
		...(body !== undefined ? { body: JSON.stringify(body) } : {}),
	});
}

describe("Newsletter Subscribe", () => {
	const originalFetch = globalThis.fetch;
	let originalApiKey: string | undefined;
	let originalSegmentId: string | undefined;

	beforeEach(() => {
		originalApiKey = process.env.RESEND_API_KEY;
		originalSegmentId = process.env.RESEND_SEGMENT_ID;
		process.env.RESEND_API_KEY = "test-key";
		process.env.RESEND_SEGMENT_ID = "test-segment";

		mockFetch(async () => new Response(JSON.stringify({ id: "contact-123" }), { status: 200 }));
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		process.env.RESEND_API_KEY = originalApiKey;
		process.env.RESEND_SEGMENT_ID = originalSegmentId;
	});

	describe("Successful subscription", () => {
		it("should return success for valid email", async () => {
			const res = await handleNewsletterSubscribe(makeRequest({ email: "test@example.com" }));
			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json).toEqual({ success: true });
		});

		it("should send correct payload to Resend API", async () => {
			let capturedUrl = "";
			let capturedBody = "";
			let capturedHeaders: Record<string, string> = {};

			mockFetch(async (input, init) => {
				capturedUrl = input as string;
				capturedBody = init?.body as string;
				capturedHeaders = Object.fromEntries(new Headers(init?.headers).entries());
				return new Response(JSON.stringify({ id: "contact-123" }), { status: 200 });
			});

			await handleNewsletterSubscribe(makeRequest({ email: "test@example.com" }));

			expect(capturedUrl).toBe("https://api.resend.com/contacts");
			expect(JSON.parse(capturedBody)).toEqual({
				email: "test@example.com",
				unsubscribed: false,
				segments: [{ id: "test-segment" }],
			});
			expect(capturedHeaders["authorization"]).toBe("Bearer test-key");
		});
	});

	describe("Input validation", () => {
		it("should reject invalid email", async () => {
			const res = await handleNewsletterSubscribe(makeRequest({ email: "not-an-email" }));
			expect(res.status).toBe(400);
		});

		it("should reject empty email", async () => {
			const res = await handleNewsletterSubscribe(makeRequest({ email: "" }));
			expect(res.status).toBe(400);
		});

		it("should reject missing body", async () => {
			const req = new Request("http://localhost/newsletter/subscribe", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "not json",
			});
			const res = await handleNewsletterSubscribe(req);
			expect(res.status).toBe(400);
		});
	});

	describe("Resend API failure", () => {
		it("should return 502 when Resend returns 403", async () => {
			mockFetch(async () => new Response('{"error":"Invalid API key"}', { status: 403 }));
			const res = await handleNewsletterSubscribe(makeRequest({ email: "test@example.com" }));
			expect(res.status).toBe(502);
		});

		it("should return 502 when Resend returns 500", async () => {
			mockFetch(async () => new Response("Internal Server Error", { status: 500 }));
			const res = await handleNewsletterSubscribe(makeRequest({ email: "test@example.com" }));
			expect(res.status).toBe(502);
		});
	});

	describe("Missing env vars", () => {
		it("should return 500 when RESEND_API_KEY is missing", async () => {
			delete process.env.RESEND_API_KEY;
			const res = await handleNewsletterSubscribe(makeRequest({ email: "test@example.com" }));
			expect(res.status).toBe(500);
		});

		it("should return 500 when RESEND_SEGMENT_ID is missing", async () => {
			delete process.env.RESEND_SEGMENT_ID;
			const res = await handleNewsletterSubscribe(makeRequest({ email: "test@example.com" }));
			expect(res.status).toBe(500);
		});
	});

	describe("Rate limiting", () => {
		it("should allow 3 requests from the same IP", async () => {
			for (let i = 0; i < 3; i++) {
				const res = await handleNewsletterSubscribe(
					makeRequest({ email: `test${i}@example.com` }, { "x-forwarded-for": "10.0.0.1" }),
				);
				expect(res.status).toBe(200);
			}
		});

		it("should reject 4th request from the same IP", async () => {
			for (let i = 0; i < 3; i++) {
				await handleNewsletterSubscribe(
					makeRequest({ email: `test${i}@example.com` }, { "x-forwarded-for": "10.0.0.2" }),
				);
			}
			const res = await handleNewsletterSubscribe(
				makeRequest({ email: "test4@example.com" }, { "x-forwarded-for": "10.0.0.2" }),
			);
			expect(res.status).toBe(429);
		});

		it("should track rate limits per IP independently", async () => {
			for (let i = 0; i < 3; i++) {
				await handleNewsletterSubscribe(
					makeRequest({ email: `test${i}@example.com` }, { "x-forwarded-for": "10.0.0.3" }),
				);
			}
			// Different IP should still work
			const res = await handleNewsletterSubscribe(
				makeRequest({ email: "test@example.com" }, { "x-forwarded-for": "10.0.0.4" }),
			);
			expect(res.status).toBe(200);
		});
	});

	describe("CORS", () => {
		it("should handle OPTIONS preflight", async () => {
			const req = new Request("http://localhost/newsletter/subscribe", { method: "OPTIONS" });
			const res = await handleNewsletterSubscribe(req);
			expect(res.status).toBe(204);
			expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
			expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
		});

		it("should include CORS headers on success response", async () => {
			const res = await handleNewsletterSubscribe(
				makeRequest({ email: "test@example.com" }, { "x-forwarded-for": "10.0.0.5" }),
			);
			expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
		});

		it("should reject non-POST methods", async () => {
			const req = new Request("http://localhost/newsletter/subscribe", { method: "GET" });
			const res = await handleNewsletterSubscribe(req);
			expect(res.status).toBe(405);
		});
	});
});
