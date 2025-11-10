import { PGlite } from "@electric-sql/pglite";
import { pushSchema } from "drizzle-kit/api-postgres";
import { sql } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql/postgres";
import type { PgDatabase } from "drizzle-orm/pg-core/db";
import { drizzle } from "drizzle-orm/pglite";
import type { PgliteDatabase } from "drizzle-orm/pglite/driver";
import { relations } from "../../db/relations.ts";
import type { DbUser } from "../../db/schema.ts";
import * as schema from "../../db/schema.ts";

let client!: PGlite;
let testDb!: PgliteDatabase<any>;
let created = false;

export const createTestDatabase = async (_shouldPushSchema = true) => {
	if (!created) {
		console.time("DB Init - Total");
		console.time("DB Init - PGlite creation");
		client = new PGlite();
		console.timeEnd("DB Init - PGlite creation");

		console.time("DB Init - Drizzle setup");
		testDb = drizzle({ client, schema, relations });
		console.timeEnd("DB Init - Drizzle setup");

		console.time("DB Init - pushSchema");
		const { apply } = await pushSchema(schema, testDb as unknown as PgDatabase<any>);
		console.timeEnd("DB Init - pushSchema");

		console.time("DB Init - apply");
		await apply();
		console.timeEnd("DB Init - apply");

		created = true;
		console.timeEnd("DB Init - Total");
	} else {
		console.time("DB Truncate");
		await testDb.execute(sql`DO $$
DECLARE
            r RECORD;
            BEGIN
    -- Loop through all tables in the public schema
            FOR r IN
            SELECT tablename
            FROM pg_tables
            WHERE schemaname = 'public'
                LOOP
        EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
            END LOOP;
            END $$;`);
		console.timeEnd("DB Truncate");
	}

	return testDb as any as BunSQLDatabase<typeof schema, typeof relations>;
};

export const createTestContext = (db: BunSQLDatabase<typeof schema, typeof relations>, user?: Partial<DbUser>) => {
	return {
		context: {
			db,
			user,
			headers: {},
		},
	};
};
