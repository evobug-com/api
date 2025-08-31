// import { z } from "zod";
// import { base } from "../shared/os.ts";
// import { booleanSchema, deliveryInfoInputSchema, idSchema, orderSchema, purchaseResultSchema } from "../shared/schemas";
//
// /**
//  * Order creation contract
//  * POST /orders - Creates a new product order
//  * Processes payment and creates order record
//  */
// export const createOrder = base
// 	.input(
// 		z.object({
// 			productId: idSchema,
// 			size: z.string(),
// 			deliveryInfo: deliveryInfoInputSchema.optional(),
// 		}),
// 	)
// 	.output(purchaseResultSchema);
//
// /**
//  * User orders retrieval contract
//  * GET /users/{userId}/orders - Retrieves all orders for a specific user
//  * Returns order history with status and details
//  */
// export const userOrders = base
// 	.input(
// 		z.object({
// 			userId: idSchema,
// 		}),
// 	)
// 	.output(z.array(orderSchema));
//
// /**
//  * Purchase verification contract
//  * GET /users/{userId}/purchases/{productId} - Checks if user has purchased a product
//  * Used for access control and purchase validation
//  */
// export const userPurchase = base
// 	.input(
// 		z.object({
// 			userId: idSchema,
// 			productId: idSchema,
// 		}),
// 	)
// 	.output(booleanSchema);
