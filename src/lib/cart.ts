import type { CartItem, MenuItem } from "@/types";

/**
 * Cart state and the arithmetic over it, as pure functions.
 *
 * This lives outside the component so the money-adjacent logic can be tested
 * directly. Note what it is *not*: authoritative. The total computed here is
 * for display only — /api/checkout re-reads every price from menu_items and
 * recomputes, so a wrong number here is a UI bug, never a pricing one.
 */
export type Cart = Record<string, CartItem>;

/** Add one of `item`, or increment it if already present. */
export function addToCart(cart: Cart, item: MenuItem): Cart {
  const existing = cart[item.id];
  return {
    ...cart,
    [item.id]: existing
      ? { ...existing, quantity: existing.quantity + 1 }
      : {
          menu_item_id: item.id,
          name: item.name,
          price_cents: item.price_cents,
          quantity: 1,
        },
  };
}

/** Remove one of `itemId`, dropping the line entirely at zero. */
export function removeFromCart(cart: Cart, itemId: string): Cart {
  const existing = cart[itemId];
  if (!existing) return cart;

  if (existing.quantity <= 1) {
    const next = { ...cart };
    delete next[itemId];
    return next;
  }

  return { ...cart, [itemId]: { ...existing, quantity: existing.quantity - 1 } };
}

/** Set an explicit quantity. Zero or less removes the line. */
export function setQuantity(cart: Cart, itemId: string, quantity: number): Cart {
  const existing = cart[itemId];
  if (!existing) return cart;

  if (quantity <= 0) {
    const next = { ...cart };
    delete next[itemId];
    return next;
  }

  return { ...cart, [itemId]: { ...existing, quantity: Math.floor(quantity) } };
}

/** Display total in cents. Integer arithmetic — no floats anywhere near money. */
export function cartTotalCents(cart: Cart): number {
  return Object.values(cart).reduce(
    (sum, item) => sum + item.price_cents * item.quantity,
    0
  );
}

/** Total number of units, not distinct lines. */
export function cartCount(cart: Cart): number {
  return Object.values(cart).reduce((sum, item) => sum + item.quantity, 0);
}

/**
 * The checkout payload: what was ordered, never what it costs. Names and
 * prices are deliberately dropped — the server re-reads them.
 */
export function toCheckoutItems(
  cart: Cart
): { menu_item_id: string; quantity: number }[] {
  return Object.values(cart).map((item) => ({
    menu_item_id: item.menu_item_id,
    quantity: item.quantity,
  }));
}
