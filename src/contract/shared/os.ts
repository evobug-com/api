import type { IncomingHttpHeaders } from "node:http";
import { os } from "@orpc/server";
import type { NodePgDatabase } from "drizzle-orm/node-postgres/driver";
import type * as schema from "../../db/schema.ts";
import type { DbUser } from "../../db/schema.ts";

export const base = os.$context<{
	db: NodePgDatabase<typeof schema>;
	user: Partial<DbUser> | undefined;
	headers: IncomingHttpHeaders;
}>();
