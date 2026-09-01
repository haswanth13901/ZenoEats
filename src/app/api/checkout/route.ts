import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase-admin";
import type { CartItem } from "@/types";

/**
 * Creates a Stripe Checkout session for a cart tied to a delivery place.
 * Body: { place_id, restaurant_id, phone, items: CartItem[] }
 */
export async function POST(req: NextRequest) {
  try {
    const { place_id, restaurant_id, phone, items } = await req.json();

    if (!place_id || !restaurant_id || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const stripe = getStripe();
    const supabase = createAdminClient();
    const total = (items as CartItem[]).reduce(
      (sum, i) => sum + i.price_cents * i.quantity,
      0
    );

    // Create a pending order first so the webhook can flip it to paid.
    const { data: order, error } = await supabase
      .from("orders")
      .insert({
        place_id,
        restaurant_id,
        customer_phone: phone,
        total_cents: total,
        status: "placed",
      })
      .select()
      .single();

    if (error || !order) {
      return NextResponse.json({ error: "Could not create order" }, { status: 500 });
    }

    await supabase.from("order_items").insert(
      (items as CartItem[]).map((i) => ({
        order_id: order.id,
        menu_item_id: i.menu_item_id,
        name: i.name,
        price_cents: i.price_cents,
        quantity: i.quantity,
      }))
    );

    const appUrl = process.env.NEXT_PUBLIC_APP_URL!;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: (items as CartItem[]).map((i) => ({
        quantity: i.quantity,
        price_data: {
          currency: "usd",
          product_data: { name: i.name },
          unit_amount: i.price_cents,
        },
      })),
      metadata: { order_id: order.id },
      success_url: `${appUrl}/track/${order.id}`,
      cancel_url: `${appUrl}/menu?place=${place_id}`,
    });

    await supabase
      .from("orders")
      .update({ stripe_session_id: session.id })
      .eq("id", order.id);

    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
