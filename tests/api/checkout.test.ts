import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSupabaseMock, type Handlers } from "../helpers/supabase-mock";

/**
 * Checkout route tests. The whole point of this file is the first describe
 * block: prices come from the database, never from the request.
 */

const PLACE = "11111111-1111-4111-8111-111111111111";
const RESTAURANT = "22222222-2222-4222-8222-222222222222";
const BURGER = "33333333-3333-4333-8333-333333333333";
const FRIES = "44444444-4444-4444-8444-444444444444";
const ORDER = "55555555-5555-4555-8555-555555555555";

let supabase: ReturnType<typeof createSupabaseMock>;
const sessionCreate = vi.fn();

vi.mock("@/lib/supabase-admin", () => ({
  createAdminClient: () => supabase.client,
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ checkout: { sessions: { create: sessionCreate } } }),
}));

/** Default happy-path database: one place, two available items, insert works. */
function defaultHandlers(overrides: Handlers = {}): Handlers {
  return {
    places: {
      select: { data: { id: PLACE, restaurant_id: RESTAURANT }, error: null },
    },
    menu_items: {
      select: {
        data: [
          {
            id: BURGER,
            name: "Burger",
            price_cents: 1250,
            is_available: true,
            restaurant_id: RESTAURANT,
          },
          {
            id: FRIES,
            name: "Fries",
            price_cents: 399,
            is_available: true,
            restaurant_id: RESTAURANT,
          },
        ],
        error: null,
      },
    },
    orders: {
      insert: { data: { id: ORDER }, error: null },
      update: { data: null, error: null },
      delete: { data: null, error: null },
    },
    order_items: { insert: { data: null, error: null } },
    ...overrides,
  };
}

function post(body: unknown) {
  return new NextRequest("http://localhost:3000/api/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    place_id: PLACE,
    restaurant_id: RESTAURANT,
    phone: "+14155550123",
    items: [{ menu_item_id: BURGER, quantity: 2 }],
    ...overrides,
  };
}

async function callRoute(body: unknown) {
  const { POST } = await import("@/app/api/checkout/route");
  const response = await POST(post(body));
  return { response, json: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  supabase = createSupabaseMock(defaultHandlers());
  sessionCreate.mockResolvedValue({
    id: "cs_test_123",
    url: "https://checkout.stripe.com/c/pay/cs_test_123",
  });
});

describe("server-side pricing", () => {
  it("computes the total from the database, not the request", async () => {
    const { response, json } = await callRoute(validBody());

    expect(response.status).toBe(200);
    expect(json.url).toContain("checkout.stripe.com");

    // 2 x 1250 from menu_items.
    const insert = supabase.call("orders", "insert");
    expect((insert?.payload as { total_cents: number }).total_cents).toBe(2500);
  });

  it("ignores a forged price_cents in the request body", async () => {
    // The attack: claim the burger costs one cent.
    const { response } = await callRoute(
      validBody({
        items: [
          { menu_item_id: BURGER, quantity: 2, price_cents: 1, name: "Burger" },
        ],
      })
    );

    expect(response.status).toBe(200);

    const insert = supabase.call("orders", "insert");
    expect((insert?.payload as { total_cents: number }).total_cents).toBe(2500);

    // And Stripe is asked to charge the real price, not the claimed one.
    const line = sessionCreate.mock.calls[0][0].line_items[0];
    expect(line.price_data.unit_amount).toBe(1250);
    expect(line.price_data.product_data.name).toBe("Burger");
  });

  it("takes item names from the database too", async () => {
    await callRoute(
      validBody({
        items: [{ menu_item_id: BURGER, quantity: 1, name: "Free Lunch" }],
      })
    );

    const line = sessionCreate.mock.calls[0][0].line_items[0];
    expect(line.price_data.product_data.name).toBe("Burger");
  });

  it("collapses duplicate lines for the same item before pricing", async () => {
    await callRoute(
      validBody({
        items: [
          { menu_item_id: BURGER, quantity: 1 },
          { menu_item_id: BURGER, quantity: 2 },
        ],
      })
    );

    const line_items = sessionCreate.mock.calls[0][0].line_items;
    expect(line_items).toHaveLength(1);
    expect(line_items[0].quantity).toBe(3);
    expect(
      (supabase.call("orders", "insert")?.payload as { total_cents: number })
        .total_cents
    ).toBe(3750);
  });

  it("prices a mixed cart correctly", async () => {
    await callRoute(
      validBody({
        items: [
          { menu_item_id: BURGER, quantity: 2 }, // 2500
          { menu_item_id: FRIES, quantity: 3 }, // 1197
        ],
      })
    );

    expect(
      (supabase.call("orders", "insert")?.payload as { total_cents: number })
        .total_cents
    ).toBe(3697);
  });
});

describe("input rejection", () => {
  it("rejects an empty cart", async () => {
    const { response } = await callRoute(validBody({ items: [] }));
    expect(response.status).toBe(400);
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const { response, json } = await callRoute("{not json");
    expect(response.status).toBe(400);
    expect(json.error).toMatch(/JSON/i);
  });

  it("rejects a negative quantity", async () => {
    const { response } = await callRoute(
      validBody({ items: [{ menu_item_id: BURGER, quantity: -5 }] })
    );
    expect(response.status).toBe(400);
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it("rejects a missing phone number", async () => {
    const { response } = await callRoute(validBody({ phone: "" }));
    expect(response.status).toBe(400);
  });

  it("creates no order when validation fails", async () => {
    await callRoute(validBody({ items: [] }));
    expect(supabase.call("orders", "insert")).toBeUndefined();
  });
});

describe("cross-restaurant and availability checks", () => {
  it("rejects a place belonging to another restaurant", async () => {
    supabase = createSupabaseMock(
      defaultHandlers({
        places: {
          select: {
            data: { id: PLACE, restaurant_id: "99999999-9999-4999-8999-999999999999" },
            error: null,
          },
        },
      })
    );

    const { response, json } = await callRoute(validBody());
    expect(response.status).toBe(400);
    expect(json.error).toMatch(/place/i);
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it("rejects an item from another restaurant's menu", async () => {
    supabase = createSupabaseMock(
      defaultHandlers({
        menu_items: {
          select: {
            data: [
              {
                id: BURGER,
                name: "Burger",
                price_cents: 1250,
                is_available: true,
                restaurant_id: "99999999-9999-4999-8999-999999999999",
              },
            ],
            error: null,
          },
        },
      })
    );

    const { response } = await callRoute(validBody());
    expect(response.status).toBe(400);
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it("rejects an unavailable item with 409", async () => {
    supabase = createSupabaseMock(
      defaultHandlers({
        menu_items: {
          select: {
            data: [
              {
                id: BURGER,
                name: "Burger",
                price_cents: 1250,
                is_available: false,
                restaurant_id: RESTAURANT,
              },
            ],
            error: null,
          },
        },
      })
    );

    const { response, json } = await callRoute(validBody());
    expect(response.status).toBe(409);
    expect(json.error).toMatch(/unavailable/i);
  });

  it("rejects an item id that does not exist", async () => {
    supabase = createSupabaseMock(
      defaultHandlers({ menu_items: { select: { data: [], error: null } } })
    );

    const { response } = await callRoute(validBody());
    expect(response.status).toBe(400);
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it("rejects a total below Stripe's 50-cent minimum", async () => {
    supabase = createSupabaseMock(
      defaultHandlers({
        menu_items: {
          select: {
            data: [
              {
                id: BURGER,
                name: "Mint",
                price_cents: 10,
                is_available: true,
                restaurant_id: RESTAURANT,
              },
            ],
            error: null,
          },
        },
      })
    );

    const { response, json } = await callRoute(
      validBody({ items: [{ menu_item_id: BURGER, quantity: 1 }] })
    );
    expect(response.status).toBe(400);
    expect(json.error).toMatch(/minimum/i);
  });
});

describe("order creation", () => {
  it("creates the order unpaid, with line items snapshotted from the database", async () => {
    await callRoute(
      validBody({ items: [{ menu_item_id: BURGER, quantity: 2, price_cents: 1 }] })
    );

    const order = supabase.call("orders", "insert")?.payload as Record<string, unknown>;
    expect(order.status).toBe("placed");
    expect(order.paid).toBeUndefined(); // DB default is false
    expect(order.place_id).toBe(PLACE);
    expect(order.customer_phone).toBe("+14155550123");

    const items = supabase.call("order_items", "insert")?.payload as Record<
      string,
      unknown
    >[];
    expect(items).toHaveLength(1);
    expect(items[0].price_cents).toBe(1250);
    expect(items[0].name).toBe("Burger");
    expect(items[0].quantity).toBe(2);
  });

  it("passes order_id to Stripe so the webhook can find the order", async () => {
    await callRoute(validBody());
    expect(sessionCreate.mock.calls[0][0].metadata).toEqual({ order_id: ORDER });
  });

  it("rolls the order back when line items fail to insert", async () => {
    supabase = createSupabaseMock(
      defaultHandlers({
        order_items: { insert: { data: null, error: { message: "insert failed" } } },
      })
    );

    const { response } = await callRoute(validBody());

    expect(response.status).toBe(500);
    // The order must not survive: paying for an order with no food is worse
    // than no order at all.
    expect(supabase.call("orders", "delete")).toBeDefined();
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it("cleans up the pending order when Stripe throws", async () => {
    sessionCreate.mockRejectedValue(new Error("stripe is down"));

    const { response } = await callRoute(validBody());

    expect(response.status).toBe(500);
    expect(supabase.call("orders", "delete")).toBeDefined();
  });

  it("returns 500 without calling Stripe when the order insert fails", async () => {
    supabase = createSupabaseMock(
      defaultHandlers({
        orders: { insert: { data: null, error: { message: "db down" } } },
      })
    );

    const { response } = await callRoute(validBody());
    expect(response.status).toBe(500);
    expect(sessionCreate).not.toHaveBeenCalled();
  });
});

describe("error responses", () => {
  it("never leaks internal error detail to the client", async () => {
    supabase = createSupabaseMock(
      defaultHandlers({
        orders: {
          insert: {
            data: null,
            error: { message: 'relation "orders" violates constraint xyz_pkey' },
          },
        },
      })
    );

    const { json } = await callRoute(validBody());
    expect(JSON.stringify(json)).not.toContain("xyz_pkey");
    expect(JSON.stringify(json)).not.toContain("constraint");
  });
});
