import { PGlite } from "@electric-sql/pglite";
import { pushSchema } from "drizzle-kit/api";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core/db";
import { drizzle } from "drizzle-orm/pglite";
import type { DbUser } from "../../db/schema.ts";
import * as schema from "../../db/schema.ts";
import * as test from "node:test";
import {sql} from "drizzle-orm";

const client = new PGlite();
const testDb =  drizzle({ client, schema });
let created = false

export const createTestDatabase = async (shouldPushSchema = true) => {

    if(!created) {
        const {apply} = await pushSchema(schema, testDb as unknown as PgDatabase<any>);
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
	return testDb as any as NodePgDatabase<typeof schema>;
};

export const createTestContext = (db: NodePgDatabase<typeof schema>, user?: Partial<DbUser>) => {
	return {
		context: {
			db,
			user,
			headers: {},
		},
	};
};
