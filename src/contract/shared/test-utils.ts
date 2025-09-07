import { PGlite } from "@electric-sql/pglite";
import { pushSchema } from "drizzle-kit/api";
import { sql } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
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
		client = new PGlite();
		testDb = drizzle({ client, schema, relations });

		const { apply } = await pushSchema(schema, testDb as unknown as PgDatabase<any>);
		await apply();
		created = true;
	} else {
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
	}

	// biome-ignore lint/suspicious/noExplicitAny: This is for tests only, so using `any` is acceptable here.
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
