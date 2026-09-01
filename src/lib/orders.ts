import type { OrderStatus } from "@/types";

/**
 * The fulfilment pipeline, in order. `cancelled` is deliberately not part of
 * it — it is an exit, reachable from any live status, not a step.
 *
 * Kept as data rather than scattered conditionals so the admin console, the
 * driver view and the customer tracking page all agree on what "next" means.
 */
export const STATUS_FLOW: readonly OrderStatus[] = [
  "placed",
  "preparing",
  "ready",
  "out_for_delivery",
  "delivered",
] as const;

export const STATUS_LABEL: Record<OrderStatus, string> = {
  placed: "Placed",
  preparing: "Preparing",
  ready: "Ready",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

/** What staff click to move an order on. */
export const ADVANCE_LABEL: Partial<Record<OrderStatus, string>> = {
  placed: "Start preparing",
  preparing: "Mark ready",
  ready: "Send out for delivery",
  out_for_delivery: "Mark delivered",
};

/** The next status in the pipeline, or null if there is nowhere to go. */
export function nextStatus(current: OrderStatus): OrderStatus | null {
  const index = STATUS_FLOW.indexOf(current);
  if (index === -1) return null; // cancelled
  return STATUS_FLOW[index + 1] ?? null; // delivered is the end
}

/** Terminal states cannot be advanced or cancelled. */
export function isTerminal(status: OrderStatus): boolean {
  return status === "delivered" || status === "cancelled";
}

/** A driver only moves an order between these two. */
export function isDriverTransition(from: OrderStatus, to: OrderStatus): boolean {
  return (
    (from === "ready" && to === "out_for_delivery") ||
    (from === "out_for_delivery" && to === "delivered")
  );
}
