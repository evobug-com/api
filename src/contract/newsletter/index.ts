import { z } from "zod";
import { base } from "../shared/os.ts";

// Simple in-memory rate limiter: max 3 requests per IP per 10 minutes
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 3;

function isRateLimited(ip: string): boolean {
	const now = Date.now();
	const timestamps = rateLimitMap.get(ip) ?? [];
	const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

	if (recent.length >= RATE_LIMIT_MAX) {
		rateLimitMap.set(ip, recent);
		return true;
	}

	recent.push(now);
	rateLimitMap.set(ip, recent);
	return false;
}

// Periodic cleanup to prevent memory leak
setInterval(() => {
	const now = Date.now();
	for (const [ip, timestamps] of rateLimitMap) {
		const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
		if (recent.length === 0) rateLimitMap.delete(ip);
		else rateLimitMap.set(ip, recent);
	}
}, 60 * 1000);

export const subscribe = base
	.input(
		z.object({
			email: z.email(),
		}),
	)
	.output(
		z.object({
			success: z.boolean(),
		}),
	)
	.errors({
		RESEND_ERROR: {
			message: "Failed to subscribe",
		},
	})
	.handler(async ({ input, context, errors }) => {
		// Rate limit by IP
		const forwarded = (context.headers as Headers).get?.("x-forwarded-for");
		const ip = forwarded?.split(",")[0]?.trim() || "unknown";

		if (isRateLimited(ip)) {
			throw errors.RATE_LIMITED({ data: { retryAfter: 600 } });
		}

		const apiKey = process.env.RESEND_API_KEY;
		const segmentId = process.env.RESEND_SEGMENT_ID;

		if (!apiKey || !segmentId) {
			throw errors.INTERNAL_ERROR();
		}

		const res = await fetch("https://api.resend.com/contacts", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				email: input.email,
				unsubscribed: false,
				segments: [{ id: segmentId }],
			}),
		});

		if (!res.ok) {
			const body = await res.text();
			console.error(`Resend API error (${res.status}): ${body}`);
			throw errors.RESEND_ERROR();
		}

		return { success: true };
	});
