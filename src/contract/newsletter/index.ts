import { z } from "zod";
import { base } from "../shared/os.ts";

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
	.handler(async ({ input, errors }) => {
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
