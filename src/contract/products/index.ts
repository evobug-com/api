// import { z } from "zod";
// import { base } from "../shared/os.ts";
// import { booleanSchema, idSchema, productSchema } from "../shared/schemas";
//
// /**
//  * Product retrieval contract
//  * GET /products/{id} - Retrieves a specific product by ID
//  * Returns full product details including pricing and availability
//  */
// export const product = base
// 	.input(
// 		z.object({
// 			id: idSchema,
// 		}),
// 	)
// 	.output(productSchema.nullable());
//
// /**
//  * Products listing contract
//  * GET /products - Retrieves all products with optional filtering
//  * Supports filtering by active status
//  */
// export const products = base
// 	.input(
// 		z.object({
// 			activeOnly: booleanSchema.optional(),
// 		}),
// 	)
// 	.output(z.array(productSchema));
