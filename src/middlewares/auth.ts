import { os } from "@orpc/server";

export const authMiddleware = os.$context().middleware(async ({ next }) => {
	// Execute logic before the handler

	const result = await next({
		context: {
			user: null,
		},
	});

	// execute logic after the handler

	return result;
});
