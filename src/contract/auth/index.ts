// import { z } from "zod";
// import { base } from "../shared/os.ts";
//
// /**
//  * Authentication session creation contract
//  * POST /auth/sessions - Creates a new authentication session (login)
//  * Accepts username or email with password
//  */
// export const createSession = base
// 	.input(
// 		z.object({
// 			usernameOrEmail: z.string(),
// 			password: passwordSchema,
// 		}),
// 	)
// 	.output(authPayloadSchema.nullable())
// 	.handler(async ({ input, context }) => {
// 		return {
// 			token: "wsome-tooken",
// 			user: {} as any,
// 		};
// 	});
//
// /**
//  * Authentication session deletion contract
//  * DELETE /auth/sessions - Terminates the current authentication session (logout)
//  * Requires authenticated user context
//  */
// export const deleteSession = base
// 	.input(z.void())
// 	.output(
// 		z.object({
// 			success: z.boolean(),
// 			message: z.string(),
// 		}),
// 	)
// 	.handler(async ({ input, context }) => {
// 		return {
// 			success: true,
// 			message: "Done",
// 		};
// 	});
