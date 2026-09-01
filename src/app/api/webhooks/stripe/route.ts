import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase-admin";
import { sendTrackingSms } from "@/lib/twilio";
import Stripe from "stripe";

/**
 * Stripe webhook: on checkout.session.completed, mark the order paid
 * and text the customer their tracking link.
 * Signature is verified against STRIPE_WEBHOOK_SECRET.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig!,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.metadata?.order_id;

    if (orderId) {
      const supabase = createAdminClient();
      await supabase
        .from("orders")
        .update({ paid: true, status: "preparing" })
        .eq("id", orderId);

      const { data: order } = await supabase
        .from("orders")
        .select("customer_phone")
        .eq("id", orderId)
        .single();

      if (order?.customer_phone) {
        const trackingUrl = `${process.env.NEXT_PUBLIC_APP_URL}/track/${orderId}`;
        try {
          await sendTrackingSms(order.customer_phone, trackingUrl);
        } catch (e) {
          console.error("SMS failed (non-fatal):", e);
        }
      }
    }
  }

  return NextResponse.json({ received: true });
}
