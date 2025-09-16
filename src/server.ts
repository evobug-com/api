import { RPCHandler } from "@orpc/server/fetch";
import { CORSPlugin } from "@orpc/server/plugins";
import { router } from "./contract/router.ts";
import {type BunSQLDatabase, drizzle} from "drizzle-orm/bun-sql";
import { createTestDatabase } from "./contract/shared/test-utils.ts";
import { relations } from "./db/relations.ts";
import type { DbUser } from "./db/schema.ts";
import * as schema from "./db/schema.ts";

// env variable USE_TEMP_DATABASE can be set to "true" or switch --temp-database to use a temporary in-memory database
const isTempDatabase = process.env.USE_TEMP_DATABASE === "true" || Bun.argv.includes("--temp-database");
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

if (process.env.DATABASE_URL === undefined && !isTempDatabase)
	throw new Error("DATABASE_URL environment variable is not set. Please set it to your database URL.");

let client: Bun.SQL | undefined
let db: BunSQLDatabase<typeof schema, typeof relations>

if(isTempDatabase) {
    console.warn("⚠️ WARNING: Using a temporary database. All data will be lost when the server stops.");
    db = await createTestDatabase()
} else {
    client = new Bun.SQL(process.env.DATABASE_URL as string, {
        max: 20, // Maximum 20 concurrent connections
        idleTimeout: 30, // Close idle connections after 30s
        maxLifetime: 3600, // Max connection lifetime 1 hour
        connectionTimeout: 10, // Connection timeout 10s
    });
    db = drizzle({
        client: client as Bun.SQL,
        schema,
        relations,
    })
}

// To detect if we are connected to the database, if not it will throw an error
await db.execute("SELECT 1");

const handler = new RPCHandler(router, {
	plugins: [new CORSPlugin()],
});

const server = Bun.serve({
	port: PORT,
	async fetch(request: Request) {
		const { matched, response } = await handler.handle(request, {
			context: { headers: request.headers, db, user: null as unknown as DbUser },
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
    if(client) {
        await client.end();
    }
	console.log("Database pool closed");
});
