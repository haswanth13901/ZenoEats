import { createAdminClient } from "@/lib/supabase-admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export type AlertKind =
  /** Stripe charged an amount that doesn't match the recorded order total. */
  | "amount_mismatch"
  /** A paid session pointed at an order that doesn't exist. */
  | "order_not_found"
  /** A checkout session reached us without an order_id in its metadata. */
  | "missing_order_metadata";

export const ALERT_LABEL: Record<AlertKind, string> = {
  amount_mismatch: "Payment amount did not match the order",
  order_not_found: "Payment for an order that no longer exists",
  missing_order_metadata: "Checkout session with no order reference",
};

export const ALERT_EXPLANATION: Record<AlertKind, string> = {
  amount_mismatch:
    "Stripe reported a different amount than we recorded for this order. The " +
    "order was NOT marked paid. This usually means the checkout session was " +
    "not created by this app — treat it as a tampering attempt until proven " +
    "otherwise, and reconcile against the Stripe dashboard before refunding " +
    "or fulfilling anything.",
  order_not_found:
    "A payment succeeded for an order id that isn't in the database. Either " +
    "the order was deleted after checkout started, or the session came from " +
    "somewhere else. Check the Stripe event for what was actually charged.",
  missing_order_metadata:
    "A checkout session completed without the order_id this app always " +
    "attaches. Nothing could be marked paid. Look up the session in Stripe.",
};

/**
 * Record an anomaly for an operator to look at.
 *
 * Deliberately never throws. This is called from the Stripe webhook on paths
 * that must still return a correct status code — an alerting failure must not
 * turn into a retry storm or, worse, a 500 that makes Stripe replay a payment
 * event. Worst case we lose the alert and keep the log line.
 */
export async function recordSecurityAlert(
  supabase: AdminClient,
  alert: {
    kind: AlertKind;
    orderId?: string | null;
    stripeEventId?: string | null;
    detail?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    const { error } = await supabase.from("security_alerts").insert({
      kind: alert.kind,
      order_id: alert.orderId ?? null,
      stripe_event_id: alert.stripeEventId ?? null,
      detail: alert.detail ?? {},
    });

    // 23505 = unique violation: this event already raised this alert, which
    // is exactly what the index is for. Not a problem.
    if (error && error.code !== "23505") {
      console.error(`alerts: could not record ${alert.kind}:`, error.message);
    }
  } catch (err) {
    console.error(
      `alerts: could not record ${alert.kind}:`,
      err instanceof Error ? err.message : "unknown error"
    );
  }
}
