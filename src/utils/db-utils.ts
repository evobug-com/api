import { and, eq, or, type SQL, type SQLWrapper } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

interface ConditionInput<_T extends PgTable> {
	[key: string]: unknown;
}

interface ConditionConfig<T extends PgTable> {
	table: T;
	conditions: ConditionInput<T>;
	operator?: "and" | "or";
}

export function buildConditions<T extends PgTable>({
	table,
	conditions,
	operator = "or",
}: ConditionConfig<T>): SQL | undefined {
	const sqlConditions: SQL[] = [];

	for (const [columnName, value] of Object.entries(conditions)) {
		if (value !== undefined && value !== null) {
			const column = table[columnName as keyof typeof table] as SQLWrapper | undefined;
			if (column) {
				sqlConditions.push(eq(column, value));
			}
		}
	}

	if (sqlConditions.length === 0) {
		return undefined;
	}

	if (sqlConditions.length === 1) {
		return sqlConditions[0];
	}

	return operator === "and" ? and(...sqlConditions) : or(...sqlConditions);
}

export function buildOrConditions<T extends PgTable>(table: T, conditions: ConditionInput<T>) {
	return buildConditions({ table, conditions, operator: "or" });
}

export function buildAndConditions<T extends PgTable>(table: T, conditions: ConditionInput<T>) {
	return buildConditions({ table, conditions, operator: "and" });
}
