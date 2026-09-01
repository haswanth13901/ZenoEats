import { z } from "zod";

/**
 * Input schemas for API routes. Everything crossing the network boundary is
 * parsed through one of these before it reaches business logic.
 *
 * Note what the checkout schema does NOT accept: prices. The client may send
 * `name` and `price_cents` (the cart carries them for rendering) but Zod
 * strips unknown keys, so they are dropped here and never reach the money
 * path. Prices are always re-read from `menu_items` server-side.
 */

/** E.164-ish. Deliberately permissive on formatting, strict on content. */
const phone = z
  .string()
  .trim()
  .min(7, "Phone number is too short")
  .max(20, "Phone number is too long")
  .regex(/^\+?[0-9][0-9\s().-]*$/, "Phone number contains invalid characters");

export const checkoutSchema = z.object({
  place_id: z.uuid(),
  restaurant_id: z.uuid(),
  phone,
  items: z
    .array(
      z.object({
        menu_item_id: z.uuid(),
        quantity: z.number().int().positive().max(99),
      })
    )
    .min(1, "Cart is empty")
    .max(50, "Too many distinct items"),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

/**
 * First validation message, safe to return to the client. Never includes the
 * submitted value — only which field failed and why.
 */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
