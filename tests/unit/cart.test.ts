import { describe, expect, it } from "vitest";
import {
  addToCart,
  cartCount,
  cartTotalCents,
  removeFromCart,
  setQuantity,
  toCheckoutItems,
  type Cart,
} from "@/lib/cart";
import type { MenuItem } from "@/types";

function item(id: string, price_cents: number, name = `Item ${id}`): MenuItem {
  return {
    id,
    restaurant_id: "r1",
    name,
    description: null,
    price_cents,
    photo_url: null,
    category: null,
    is_available: true,
  };
}

const burger = item("a", 1250, "Burger");
const fries = item("b", 399, "Fries");

describe("addToCart", () => {
  it("adds a new item with quantity 1", () => {
    const cart = addToCart({}, burger);
    expect(cart.a.quantity).toBe(1);
    expect(cart.a.menu_item_id).toBe("a");
    expect(cart.a.price_cents).toBe(1250);
  });

  it("increments rather than duplicating an existing item", () => {
    const cart = addToCart(addToCart({}, burger), burger);
    expect(Object.keys(cart)).toHaveLength(1);
    expect(cart.a.quantity).toBe(2);
  });

  it("does not mutate the cart it was given", () => {
    const before: Cart = addToCart({}, burger);
    const snapshot = JSON.stringify(before);
    addToCart(before, burger);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe("removeFromCart", () => {
  it("decrements when more than one", () => {
    const cart = removeFromCart(addToCart(addToCart({}, burger), burger), "a");
    expect(cart.a.quantity).toBe(1);
  });

  it("drops the line entirely at the last one", () => {
    const cart = removeFromCart(addToCart({}, burger), "a");
    expect(cart.a).toBeUndefined();
    expect(Object.keys(cart)).toHaveLength(0);
  });

  it("is a no-op for an item that isn't in the cart", () => {
    const cart = addToCart({}, burger);
    expect(removeFromCart(cart, "nope")).toBe(cart);
  });

  it("never produces a negative quantity", () => {
    let cart = addToCart({}, burger);
    for (let i = 0; i < 5; i++) cart = removeFromCart(cart, "a");
    expect(cart.a).toBeUndefined();
    expect(cartCount(cart)).toBe(0);
  });
});

describe("setQuantity", () => {
  it("sets an explicit quantity", () => {
    const cart = setQuantity(addToCart({}, burger), "a", 7);
    expect(cart.a.quantity).toBe(7);
  });

  it("removes the line at zero or below", () => {
    expect(setQuantity(addToCart({}, burger), "a", 0).a).toBeUndefined();
    expect(setQuantity(addToCart({}, burger), "a", -3).a).toBeUndefined();
  });

  it("floors fractional quantities — you cannot order half a burger", () => {
    expect(setQuantity(addToCart({}, burger), "a", 2.9).a.quantity).toBe(2);
  });
});

describe("cartTotalCents", () => {
  it("is zero for an empty cart", () => {
    expect(cartTotalCents({})).toBe(0);
  });

  it("multiplies price by quantity across lines", () => {
    let cart = addToCart({}, burger); // 1250
    cart = addToCart(cart, burger); // 2500
    cart = addToCart(cart, fries); // + 399
    expect(cartTotalCents(cart)).toBe(2899);
  });

  it("stays an exact integer where floats would drift", () => {
    // 10 x $0.29 is 290 cents. In float dollars this is 2.9000000000000004.
    let cart: Cart = {};
    const cheap = item("c", 29);
    for (let i = 0; i < 10; i++) cart = addToCart(cart, cheap);
    expect(cartTotalCents(cart)).toBe(290);
    expect(Number.isInteger(cartTotalCents(cart))).toBe(true);
  });
});

describe("cartCount", () => {
  it("counts units, not distinct lines", () => {
    let cart = addToCart({}, burger);
    cart = addToCart(cart, burger);
    cart = addToCart(cart, fries);
    expect(Object.keys(cart)).toHaveLength(2);
    expect(cartCount(cart)).toBe(3);
  });
});

describe("toCheckoutItems", () => {
  it("sends ids and quantities only — never names or prices", () => {
    const cart = addToCart(addToCart({}, burger), fries);
    const payload = toCheckoutItems(cart);

    expect(payload).toEqual([
      { menu_item_id: "a", quantity: 1 },
      { menu_item_id: "b", quantity: 1 },
    ]);

    // The guarantee that matters: no price reaches the wire from the client.
    for (const line of payload) {
      expect(Object.keys(line).sort()).toEqual(["menu_item_id", "quantity"]);
      expect(JSON.stringify(line)).not.toContain("price");
    }
  });
});
