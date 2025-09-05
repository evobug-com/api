import { RPCHandler } from "@orpc/server/fetch";
import { CORSPlugin } from "@orpc/server/plugins";
import { router } from "./contract/router.ts";
import "dotenv/config";
import type { IncomingHttpHeaders } from "node:http";
import { drizzle } from "drizzle-orm/bun-sql";
import { createTestDatabase } from "./contract/shared/test-utils.ts";
import type { DbUser } from "./db/schema.ts";
import * as schema from "./db/schema.ts";

if (process.env.DATABASE_URL === undefined)
	throw new Error("DATABASE_URL environment variable is not set. Please set it to your database URL.");

const client = new Bun.SQL(process.env.DATABASE_URL, {
	max: 20, // Maximum 20 concurrent connections
	idleTimeout: 30, // Close idle connections after 30s
	maxLifetime: 3600, // Max connection lifetime 1 hour
	connectionTimeout: 10, // Connection timeout 10s
});

const db =
	process.env.USE_TEMP_DATABASE === "true"
		? await createTestDatabase()
		: drizzle({
                client,
				schema,
			});

// To detect if we are connected to the database, if not it will throw an error
await db.execute("SELECT 1");

const handler = new RPCHandler(router, {
	plugins: [new CORSPlugin()],
});

const server = Bun.serve({
	port: 3001,
	async fetch(request: Request) {
		const { matched, response } = await handler.handle(request, {
			context: { headers: request.headers as unknown as IncomingHttpHeaders, db, user: null as unknown as DbUser },
		});

		if (matched) {
			return response;
		}

		return new Response(`${request.url} - Not Found`, { status: 404 });
	},
});

console.log(`🚀 Server running at http://${server.hostname}:${server.port}`);

// Graceful shutdown
process.on("SIGTERM", async () => {
	console.log("SIGTERM signal received: closing HTTP server");
	await client.end();
	console.log("Database pool closed");
});
