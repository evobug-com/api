-- Backfill: fix jsonb columns whose values were double-stringified by
-- the older bun-sql/postgres drizzle driver (the bug that drizzle-orm
-- 1.0.0-rc.1 fixed: "Fixed bun-sql/postgres ... json[b] data double
-- stringification"). Affected rows store a JSON string inside a jsonb
-- column instead of a JSON object/array, e.g.:
--
--   pg_typeof(metadata) = 'jsonb'  but  jsonb_typeof(metadata) = 'string'
--
-- and the value reads as `"{\"streak\":198,...}"` rather than
-- `{"streak":198,...}`.
--
-- The expression `(col #>> '{}')::jsonb` extracts the textual form of the
-- jsonb value (which is the original JSON-encoded string) and re-parses it
-- as jsonb. Idempotent: only rows still in the broken shape are touched.

UPDATE "user_achievements"
SET "metadata" = ("metadata" #>> '{}')::jsonb
WHERE jsonb_typeof("metadata") = 'string';
--> statement-breakpoint

UPDATE "command_history"
SET "metadata" = ("metadata" #>> '{}')::jsonb
WHERE jsonb_typeof("metadata") = 'string';
--> statement-breakpoint

UPDATE "messages_logs"
SET "editedContents" = ("editedContents" #>> '{}')::jsonb
WHERE jsonb_typeof("editedContents") = 'string';
--> statement-breakpoint

UPDATE "products"
SET "sizes" = ("sizes" #>> '{}')::jsonb
WHERE "sizes" IS NOT NULL AND jsonb_typeof("sizes") = 'string';
