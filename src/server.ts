import { RPCHandler } from "@orpc/server/fetch";
import { CORSPlugin } from "@orpc/server/plugins";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql/postgres";
import { drizzle } from "drizzle-orm/bun-sql";
import cron from "node-cron";
import { router } from "./contract/router.ts";
import { createTestDatabase } from "./contract/shared/test-utils.ts";
import { relations } from "./db/relations.ts";
import type { DbUser } from "./db/schema.ts";
import * as schema from "./db/schema.ts";
import { InvestmentSyncService } from "./services/investment-sync.ts";

// env variable USE_TEMP_DATABASE can be set to "true" or switch --temp-database to use a temporary in-memory database
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

if (process.env.DATABASE_URL === undefined)
	throw new Error("DATABASE_URL environment variable is not set. Please set it to your database URL.");

let client: Bun.SQL | undefined;
let db: BunSQLDatabase<typeof schema, typeof relations>;

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
});

// To detect if we are connected to the database, if not it will throw an error
await db.execute("SELECT 1");

// Investment price sync scheduler
// Runs every 4 hours (6 times per day): 0:00, 4:00, 8:00, 12:00, 16:00, 20:00
console.log("⏰ Starting investment price sync scheduler (every 4 hours)");
cron.schedule("0 */4 * * *", async () => {
	console.log("[Cron] Starting scheduled investment price sync...");
	try {
		const syncService = new InvestmentSyncService(db);
		const result = await syncService.syncAllAssets();

		if (result.success) {
			console.log(
				`[Cron] ✅ Sync completed: ${result.assetsUpdated} assets updated, ${result.apiCallsUsed} API calls used, took ${result.durationMs}ms`,
			);
		} else {
			console.error(
				`[Cron] ❌ Sync failed: ${result.errors.length} errors, ${result.assetsUpdated} assets updated, took ${result.durationMs}ms`,
			);
			console.error("[Cron] Errors:", result.errors);
		}
	} catch (error) {
		console.error("[Cron] Fatal error during price sync:", error);
	}
});

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
	if (client) {
		await client.end();
	}
	console.log("Database pool closed");
});
