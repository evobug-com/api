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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

export async function handleNewsletterSubscribe(req: Request): Promise<Response> {
	// Handle CORS preflight
	if (req.method === "OPTIONS") {
		return new Response(null, { status: 204, headers: CORS_HEADERS });
	}

	if (req.method !== "POST") {
		return Response.json({ error: "Method not allowed" }, { status: 405, headers: CORS_HEADERS });
	}

	// Rate limit by IP
	const forwarded = req.headers.get("x-forwarded-for");
	const ip = forwarded?.split(",")[0]?.trim() || "unknown";

	if (isRateLimited(ip)) {
		return Response.json({ error: "Rate limited", retryAfter: 600 }, { status: 429, headers: CORS_HEADERS });
	}

	const apiKey = process.env.RESEND_API_KEY;
	const segmentId = process.env.RESEND_SEGMENT_ID;

	if (!apiKey || !segmentId) {
		console.error("Missing RESEND_API_KEY or RESEND_SEGMENT_ID");
		return Response.json({ error: "Newsletter not configured" }, { status: 500, headers: CORS_HEADERS });
	}

	let email: string;
	try {
		const body = (await req.json()) as { email?: string };
		email = body.email ?? "";
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400, headers: CORS_HEADERS });
	}

	if (!email || !EMAIL_RE.test(email)) {
		return Response.json({ error: "Invalid email" }, { status: 400, headers: CORS_HEADERS });
	}

	const res = await fetch("https://api.resend.com/contacts", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			email,
			unsubscribed: false,
			segments: [{ id: segmentId }],
		}),
	});

	if (!res.ok) {
		const body = await res.text();
		console.error(`Resend API error (${res.status}): ${body}`);
		return Response.json({ error: "Failed to subscribe" }, { status: 502, headers: CORS_HEADERS });
	}

	return Response.json({ success: true }, { headers: CORS_HEADERS });
}
