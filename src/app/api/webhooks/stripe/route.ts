import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase-admin";
import { sendTrackingSms } from "@/lib/twilio";
import { recordSecurityAlert } from "@/lib/alerts";
import Stripe from "stripe";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Stripe webhook.
 *
 *  - checkout.session.completed / async_payment_succeeded → mark the order
 *    paid and text the customer their tracking link.
 *  - checkout.session.expired → cancel the abandoned order.
 *
 * The signature is verified against STRIPE_WEBHOOK_SECRET before anything
 * else happens.
 *
 * Status codes matter here: Stripe retries on any non-2xx. So a transient
 * failure (a database write we want retried) returns 500, while a permanent
 * one (an event we will never be able to process) returns 200 to stop the
 * retry loop — with a log line, not a silent drop.
 *
 * Every one of these event types must also be subscribed on the endpoint in
 * the Stripe dashboard. Stripe does not send events you have not selected, so
 * an unsubscribed type means this code never runs. See docs/SETUP.md.
 */

const PAID_EVENTS: Stripe.Event.Type[] = [
  "checkout.session.completed",
  // Async methods (bank debits) complete unpaid, then settle later.
  "checkout.session.async_payment_succeeded",
];

const HANDLED: Stripe.Event.Type[] = [
  ...PAID_EVENTS,
  "checkout.session.expired",
];

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("stripe webhook: STRIPE_WEBHOOK_SECRET is not configured");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, secret);
  } catch (err) {
    // Never log the body or the secret — only why verification failed.
    console.error(
      "stripe webhook: signature verification failed:",
      err instanceof Error ? err.message : "unknown error"
    );
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (!HANDLED.includes(event.type)) {
    return NextResponse.json({ received: true });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const orderId = session.metadata?.order_id;

  const supabase = createAdminClient();

  if (!orderId) {
    console.error(`stripe webhook: event ${event.id} has no order_id metadata`);
    if (event.type !== "checkout.session.expired") {
      await recordSecurityAlert(supabase, {
        kind: "missing_order_metadata",
        stripeEventId: event.id,
        detail: { session_id: session.id, amount_total: session.amount_total },
      });
    }
    return NextResponse.json({ received: true });
  }

  if (event.type === "checkout.session.expired") {
    return handleExpired(supabase, orderId, event.id);
  }

  return handlePaid(supabase, session, orderId, event.id);
}

/**
 * The customer never finished paying and Stripe has expired the session
 * (24 hours by default). The order row was created before checkout, so
 * without this it would sit in the table as an unpaid 'placed' order forever.
 */
async function handleExpired(
  supabase: AdminClient,
  orderId: string,
  eventId: string
) {
  // Conditional on still being unpaid and untouched: an order that somehow
  // got paid, or that staff already moved on, must not be cancelled from
  // under them.
  const { data: cancelled, error } = await supabase
    .from("orders")
    .update({ status: "cancelled" })
    .eq("id", orderId)
    .eq("paid", false)
    .eq("status", "placed")
    .select("id");

  if (error) {
    console.error(`stripe webhook: could not cancel expired order ${orderId}`);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  if (!cancelled || cancelled.length === 0) {
    // Already paid, already cancelled, or gone. Nothing to do — and nothing
    // worth retrying.
    return NextResponse.json({ received: true, noop: true });
  }

  console.info(
    `stripe webhook: cancelled abandoned order ${orderId} (event ${eventId})`
  );
  return NextResponse.json({ received: true, cancelled: true });
}

/** The money arrived. Mark the order paid, then text the tracking link. */
async function handlePaid(
  supabase: AdminClient,
  session: Stripe.Checkout.Session,
  orderId: string,
  eventId: string
) {
  // Async payment methods fire checkout.session.completed while still unpaid.
  // Marking the order paid here would hand out food before the money settles.
  if (session.payment_status !== "paid") {
    console.warn(
      `stripe webhook: order ${orderId} session is ${session.payment_status}, not marking paid`
    );
    return NextResponse.json({ received: true });
  }

  const { data: order, error: readError } = await supabase
    .from("orders")
    .select("id, total_cents, paid, customer_phone")
    .eq("id", orderId)
    .maybeSingle();

  if (readError) {
    console.error(`stripe webhook: could not read order ${orderId}`);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  if (!order) {
    // Retrying will not conjure the order. Stop the retry loop, keep the log,
    // and put it somewhere an operator will actually see.
    console.error(`stripe webhook: order ${orderId} not found for event ${eventId}`);
    await recordSecurityAlert(supabase, {
      kind: "order_not_found",
      orderId,
      stripeEventId: eventId,
      detail: { session_id: session.id, amount_total: session.amount_total },
    });
    return NextResponse.json({ received: true });
  }

  // The amount actually collected must match what we recorded. A mismatch
  // means the session was not created by this app's checkout route.
  if (session.amount_total !== order.total_cents) {
    console.error(
      `stripe webhook: amount mismatch on order ${orderId} ` +
        `(charged ${session.amount_total}, expected ${order.total_cents})`
    );
    // The order is left unpaid. Raise it where someone will see it: a
    // mismatch means this session was not created by our checkout route.
    await recordSecurityAlert(supabase, {
      kind: "amount_mismatch",
      orderId,
      stripeEventId: eventId,
      detail: {
        session_id: session.id,
        charged_cents: session.amount_total,
        expected_cents: order.total_cents,
      },
    });
    return NextResponse.json({ received: true });
  }

  // Idempotency at the database level: the update only matches while the order
  // is still unpaid, so a replayed event updates zero rows and sends no SMS.
  const { data: updated, error: updateError } = await supabase
    .from("orders")
    .update({ paid: true, status: "preparing" })
    .eq("id", orderId)
    .eq("paid", false)
    .select("id");

  if (updateError) {
    console.error(`stripe webhook: could not mark order ${orderId} paid`);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const alreadyProcessed = !updated || updated.length === 0;
  if (alreadyProcessed) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  if (order.customer_phone) {
    const trackingUrl = `${
      process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
    }/track/${orderId}`;
    try {
      await sendTrackingSms(order.customer_phone, trackingUrl);
    } catch (err) {
      // The payment succeeded; a failed text must not make Stripe retry.
      console.error(
        `stripe webhook: SMS failed for order ${orderId} (non-fatal):`,
        err instanceof Error ? err.message : "unknown error"
      );
    }
  }

  return NextResponse.json({ received: true });
}
