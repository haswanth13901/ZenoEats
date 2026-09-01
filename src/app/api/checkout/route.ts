import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase-admin";
import { checkoutSchema, firstIssue } from "@/lib/validation";

/**
 * Creates a Stripe Checkout session for a cart tied to a delivery place.
 * Body: { place_id, restaurant_id, phone, items: [{ menu_item_id, quantity }] }
 *
 * The client sends *what* was ordered, never *what it costs*. Prices, names and
 * the order total are read from `menu_items` inside this handler, so a forged
 * `price_cents` in the request body has no effect on the amount charged or the
 * amount recorded.
 */

/** Stripe rejects payment intents below 50 cents. */
const MIN_TOTAL_CENTS = 50;

export async function POST(req: NextRequest) {
  let orderId: string | null = null;
  const supabase = createAdminClient();

  try {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
    }

    const parsed = checkoutSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { place_id, restaurant_id, phone, items } = parsed.data;

    // Collapse repeats so a cart with the same item twice becomes one line.
    const quantities = new Map<string, number>();
    for (const item of items) {
      quantities.set(
        item.menu_item_id,
        (quantities.get(item.menu_item_id) ?? 0) + item.quantity
      );
    }
    const menuItemIds = [...quantities.keys()];

    // The place must exist and belong to the restaurant being ordered from,
    // otherwise a caller could route another restaurant's food to their door.
    const { data: place, error: placeError } = await supabase
      .from("places")
      .select("id, restaurant_id")
      .eq("id", place_id)
      .maybeSingle();

    if (placeError) {
      return NextResponse.json({ error: "Could not verify delivery place" }, { status: 500 });
    }
    if (!place || place.restaurant_id !== restaurant_id) {
      return NextResponse.json({ error: "Unknown delivery place" }, { status: 400 });
    }

    // Authoritative prices. Never trust the cart.
    const { data: menuItems, error: menuError } = await supabase
      .from("menu_items")
      .select("id, name, price_cents, is_available, restaurant_id")
      .in("id", menuItemIds);

    if (menuError) {
      return NextResponse.json({ error: "Could not load menu" }, { status: 500 });
    }

    const byId = new Map((menuItems ?? []).map((m) => [m.id, m]));
    for (const id of menuItemIds) {
      const item = byId.get(id);
      if (!item || item.restaurant_id !== restaurant_id) {
        return NextResponse.json(
          { error: "One of those items is no longer on the menu" },
          { status: 400 }
        );
      }
      if (!item.is_available) {
        return NextResponse.json(
          { error: `"${item.name}" is currently unavailable` },
          { status: 409 }
        );
      }
    }

    const lines = menuItemIds.map((id) => {
      const item = byId.get(id)!;
      return {
        menu_item_id: id,
        name: item.name,
        price_cents: item.price_cents,
        quantity: quantities.get(id)!,
      };
    });

    const total = lines.reduce((sum, l) => sum + l.price_cents * l.quantity, 0);
    if (total < MIN_TOTAL_CENTS) {
      return NextResponse.json(
        { error: "Order total is below the minimum charge" },
        { status: 400 }
      );
    }

    // Create the pending order first so the webhook has something to flip.
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        place_id,
        restaurant_id,
        customer_phone: phone,
        total_cents: total,
        status: "placed",
      })
      .select("id")
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: "Could not create order" }, { status: 500 });
    }
    orderId = order.id;

    const { error: itemsError } = await supabase.from("order_items").insert(
      lines.map((l) => ({
        order_id: order.id,
        menu_item_id: l.menu_item_id,
        name: l.name,
        price_cents: l.price_cents,
        quantity: l.quantity,
      }))
    );

    // An order with no line items is worse than no order: the customer pays
    // and the kitchen sees nothing to cook. Roll back instead.
    if (itemsError) {
      await supabase.from("orders").delete().eq("id", order.id);
      orderId = null;
      return NextResponse.json({ error: "Could not create order" }, { status: 500 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      line_items: lines.map((l) => ({
        quantity: l.quantity,
        price_data: {
          currency: "usd",
          product_data: { name: l.name },
          unit_amount: l.price_cents,
        },
      })),
      metadata: { order_id: order.id },
      success_url: `${appUrl}/track/${order.id}`,
      cancel_url: `${appUrl}/menu?place=${place_id}`,
    });

    const { error: sessionIdError } = await supabase
      .from("orders")
      .update({ stripe_session_id: session.id })
      .eq("id", order.id);

    // Without the session id we lose the audit trail, but the order and the
    // payment are still linked by metadata.order_id, so let checkout proceed.
    if (sessionIdError) {
      console.error(`checkout: could not persist session id for order ${order.id}`);
    }

    return NextResponse.json({ url: session.url });
  } catch (err) {
    // Log the message only — error objects from Stripe carry request context.
    console.error(
      "checkout: unhandled error:",
      err instanceof Error ? err.message : "unknown error"
    );

    // Don't strand a pending order if Stripe threw after we inserted it.
    if (orderId) {
      await supabase
        .from("orders")
        .delete()
        .eq("id", orderId)
        .then(undefined, () => undefined);
    }

    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
