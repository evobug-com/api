import { createServer } from "node:http";
import { RPCHandler } from "@orpc/server/node";
import { CORSPlugin } from "@orpc/server/plugins";
import { router } from "./contract/router.ts";
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createTestDatabase } from "./contract/shared/test-utils.ts";
import type { DbUser } from "./db/schema.ts";
import * as schema from "./db/schema.ts";

if (process.env.DATABASE_URL === undefined)
	throw new Error("DATABASE_URL environment variable is not set. Please set it to your database URL.");

// Create connection pool for better performance
const pool = new Pool({
	connectionString: process.env.DATABASE_URL,
	max: 20, // Maximum number of clients in the pool
	idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
	connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
});

const db = process.env.USE_TEMP_DATABASE
	? await createTestDatabase()
	: drizzle(pool, {
			schema,
		});

// To detect if we are connected to the database, if not it will throw an error
await db.execute("SELECT 1");

const handler = new RPCHandler(router, {
	plugins: [new CORSPlugin()],
});

const server = createServer(async (req, res) => {
	const result = await handler.handle(req, res, {
		context: { headers: req.headers, db, user: null as unknown as DbUser },
	});

	if (!result.matched) {
		res.statusCode = 404;
		res.end("No procedure matched");
	}
});

server.listen(3001, "127.0.0.1", () => console.log("Listening on 127.0.0.1:3001"));

// Graceful shutdown
process.on("SIGTERM", async () => {
	console.log("SIGTERM signal received: closing HTTP server");
	server.close(() => {
		console.log("HTTP server closed");
	});
	await pool.end();
	console.log("Database pool closed");
});
