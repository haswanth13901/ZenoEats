import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import Stripe from "stripe";
import { createSupabaseMock, type Handlers } from "../helpers/supabase-mock";

/**
 * Stripe webhook tests.
 *
 * Signature verification is NOT mocked. Payloads are signed with the real
 * Stripe SDK against the test secret, so these tests exercise the same HMAC
 * path production does — a mocked `constructEvent` would prove nothing about
 * whether we reject a forged payload.
 *
 * Supabase and Twilio are mocked. recordSecurityAlert is deliberately left
 * real, so the alerting path is covered too.
 */

const ORDER = "55555555-5555-4555-8555-555555555555";
const SECRET = process.env.STRIPE_WEBHOOK_SECRET!;
const signer = new Stripe("sk_test_dummy");

let supabase: ReturnType<typeof createSupabaseMock>;
const sendTrackingSms = vi.fn();

vi.mock("@/lib/supabase-admin", () => ({
  createAdminClient: () => supabase.client,
}));

vi.mock("@/lib/twilio", () => ({
  sendTrackingSms: (...args: unknown[]) => sendTrackingSms(...args),
}));

interface SessionOverrides {
  id?: string;
  metadata?: Record<string, string> | null;
  payment_status?: string;
  amount_total?: number;
}

function event(type: string, session: SessionOverrides = {}) {
  return {
    id: `evt_${Math.random().toString(36).slice(2, 10)}`,
    object: "event",
    type,
    data: {
      object: {
        id: "cs_test_123",
        object: "checkout.session",
        metadata: session.metadata === null ? {} : (session.metadata ?? { order_id: ORDER }),
        payment_status: session.payment_status ?? "paid",
        amount_total: session.amount_total ?? 2500,
        ...(session.id ? { id: session.id } : {}),
      },
    },
  };
}

/** A genuinely signed request, exactly as Stripe would send it. */
function signedRequest(payloadObject: unknown, secret = SECRET) {
  const payload = JSON.stringify(payloadObject);
  const header = signer.webhooks.generateTestHeaderString({ payload, secret });
  return new NextRequest("http://localhost:3000/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": header, "Content-Type": "application/json" },
    body: payload,
  });
}

async function callRoute(request: NextRequest) {
  const { POST } = await import("@/app/api/webhooks/stripe/route");
  const response = await POST(request);
  return { response, json: await response.json() };
}

/** Order exists, unpaid, total matches; the conditional update succeeds. */
function defaultHandlers(overrides: Handlers = {}): Handlers {
  return {
    orders: {
      select: {
        data: {
          id: ORDER,
          total_cents: 2500,
          paid: false,
          customer_phone: "+14155550123",
        },
        error: null,
      },
      update: { data: [{ id: ORDER }], error: null },
    },
    security_alerts: { insert: { data: null, error: null } },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  supabase = createSupabaseMock(defaultHandlers());
  sendTrackingSms.mockResolvedValue({ sid: "SM123" });
});

describe("signature verification", () => {
  it("rejects a request with no signature header", async () => {
    const request = new NextRequest("http://localhost:3000/api/webhooks/stripe", {
      method: "POST",
      body: JSON.stringify(event("checkout.session.completed")),
    });

    const { response, json } = await callRoute(request);

    expect(response.status).toBe(400);
    expect(json.error).toMatch(/signature/i);
    expect(supabase.calls).toHaveLength(0);
  });

  it("rejects a garbage signature", async () => {
    const request = new NextRequest("http://localhost:3000/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=deadbeef" },
      body: JSON.stringify(event("checkout.session.completed")),
    });

    const { response } = await callRoute(request);
    expect(response.status).toBe(400);
    expect(supabase.calls).toHaveLength(0);
  });

  it("rejects a payload signed with the wrong secret", async () => {
    const request = signedRequest(
      event("checkout.session.completed"),
      "whsec_an_attackers_own_secret"
    );

    const { response } = await callRoute(request);
    expect(response.status).toBe(400);
    expect(supabase.calls).toHaveLength(0);
  });

  it("rejects a body tampered with after signing", async () => {
    const original = event("checkout.session.completed", { amount_total: 2500 });
    const payload = JSON.stringify(original);
    const header = signer.webhooks.generateTestHeaderString({ payload, secret: SECRET });

    // Same signature, different body — the classic replay-with-edits attack.
    const tampered = JSON.stringify(
      event("checkout.session.completed", { amount_total: 1 })
    );

    const request = new NextRequest("http://localhost:3000/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": header },
      body: tampered,
    });

    const { response } = await callRoute(request);
    expect(response.status).toBe(400);
    expect(supabase.calls).toHaveLength(0);
  });

  it("accepts a correctly signed payload", async () => {
    const { response } = await callRoute(
      signedRequest(event("checkout.session.completed"))
    );
    expect(response.status).toBe(200);
  });
});

describe("checkout.session.completed — the happy path", () => {
  it("marks the order paid and preparing", async () => {
    const { response, json } = await callRoute(
      signedRequest(event("checkout.session.completed"))
    );

    expect(response.status).toBe(200);
    expect(json.received).toBe(true);

    const update = supabase.call("orders", "update");
    expect(update?.payload).toEqual({ paid: true, status: "preparing" });
  });

  it("sends the tracking SMS", async () => {
    await callRoute(signedRequest(event("checkout.session.completed")));

    expect(sendTrackingSms).toHaveBeenCalledTimes(1);
    const [to, url] = sendTrackingSms.mock.calls[0];
    expect(to).toBe("+14155550123");
    expect(url).toContain(`/track/${ORDER}`);
  });

  it("also handles async_payment_succeeded", async () => {
    const { response } = await callRoute(
      signedRequest(event("checkout.session.async_payment_succeeded"))
    );

    expect(response.status).toBe(200);
    expect(supabase.call("orders", "update")?.payload).toEqual({
      paid: true,
      status: "preparing",
    });
  });

  it("still returns 200 when the SMS fails — the payment already succeeded", async () => {
    sendTrackingSms.mockRejectedValue(new Error("twilio is down"));

    const { response } = await callRoute(
      signedRequest(event("checkout.session.completed"))
    );

    expect(response.status).toBe(200);
    expect(supabase.call("orders", "update")).toBeDefined();
  });
});

describe("idempotency", () => {
  it("is a no-op when the order was already paid", async () => {
    // The conditional update matches zero rows, exactly as Postgres would.
    supabase = createSupabaseMock(
      defaultHandlers({
        orders: {
          select: {
            data: { id: ORDER, total_cents: 2500, paid: true, customer_phone: "+1415" },
            error: null,
          },
          update: { data: [], error: null },
        },
      })
    );

    const { response, json } = await callRoute(
      signedRequest(event("checkout.session.completed"))
    );

    expect(response.status).toBe(200);
    expect(json.duplicate).toBe(true);
    expect(sendTrackingSms).not.toHaveBeenCalled();
  });

  it("guards the update with paid = false so a replay cannot double-process", async () => {
    await callRoute(signedRequest(event("checkout.session.completed")));

    const update = supabase.call("orders", "update");
    const eqFilters = supabase.filterArgs(update, "eq");

    expect(eqFilters).toContainEqual(["id", ORDER]);
    expect(eqFilters).toContainEqual(["paid", false]);
  });

  it("sends exactly one SMS across a delivery and its replay", async () => {
    await callRoute(signedRequest(event("checkout.session.completed")));
    expect(sendTrackingSms).toHaveBeenCalledTimes(1);

    // Redelivery: the order is now paid, so the conditional update misses.
    supabase = createSupabaseMock(
      defaultHandlers({
        orders: {
          select: {
            data: { id: ORDER, total_cents: 2500, paid: true, customer_phone: "+1415" },
            error: null,
          },
          update: { data: [], error: null },
        },
      })
    );

    await callRoute(signedRequest(event("checkout.session.completed")));
    expect(sendTrackingSms).toHaveBeenCalledTimes(1);
  });
});

describe("refusals", () => {
  it("does not mark paid when payment_status is unpaid", async () => {
    const { response } = await callRoute(
      signedRequest(
        event("checkout.session.completed", { payment_status: "unpaid" })
      )
    );

    expect(response.status).toBe(200);
    expect(supabase.call("orders", "update")).toBeUndefined();
    expect(sendTrackingSms).not.toHaveBeenCalled();
  });

  it("refuses an amount that doesn't match and raises an alert", async () => {
    const { response } = await callRoute(
      signedRequest(event("checkout.session.completed", { amount_total: 1 }))
    );

    expect(response.status).toBe(200);
    expect(supabase.call("orders", "update")).toBeUndefined();
    expect(sendTrackingSms).not.toHaveBeenCalled();

    const alert = supabase.call("security_alerts", "insert");
    const payload = alert?.payload as Record<string, unknown>;
    expect(payload.kind).toBe("amount_mismatch");
    expect(payload.order_id).toBe(ORDER);
    expect((payload.detail as Record<string, unknown>).charged_cents).toBe(1);
    expect((payload.detail as Record<string, unknown>).expected_cents).toBe(2500);
  });

  it("raises an alert when the order does not exist", async () => {
    supabase = createSupabaseMock(
      defaultHandlers({ orders: { select: { data: null, error: null } } })
    );

    const { response } = await callRoute(
      signedRequest(event("checkout.session.completed"))
    );

    expect(response.status).toBe(200); // retrying will not help
    expect(
      (supabase.call("security_alerts", "insert")?.payload as { kind: string }).kind
    ).toBe("order_not_found");
  });

  it("raises an alert when order_id metadata is missing", async () => {
    const { response } = await callRoute(
      signedRequest(event("checkout.session.completed", { metadata: null }))
    );

    expect(response.status).toBe(200);
    expect(
      (supabase.call("security_alerts", "insert")?.payload as { kind: string }).kind
    ).toBe("missing_order_metadata");
    expect(supabase.call("orders", "update")).toBeUndefined();
  });

  it("ignores event types it does not handle", async () => {
    const { response } = await callRoute(
      signedRequest(event("payment_intent.created"))
    );

    expect(response.status).toBe(200);
    expect(supabase.calls).toHaveLength(0);
  });
});

describe("checkout.session.expired", () => {
  it("cancels an abandoned order", async () => {
    supabase = createSupabaseMock(
      defaultHandlers({
        orders: { update: { data: [{ id: ORDER }], error: null } },
      })
    );

    const { response, json } = await callRoute(
      signedRequest(event("checkout.session.expired"))
    );

    expect(response.status).toBe(200);
    expect(json.cancelled).toBe(true);
    expect(supabase.call("orders", "update")?.payload).toEqual({
      status: "cancelled",
    });
  });

  it("only cancels while the order is still unpaid and untouched", async () => {
    await callRoute(signedRequest(event("checkout.session.expired")));

    const eqFilters = supabase.filterArgs(supabase.call("orders", "update"), "eq");
    expect(eqFilters).toContainEqual(["paid", false]);
    expect(eqFilters).toContainEqual(["status", "placed"]);
  });

  it("is a no-op when the order was already paid or moved on", async () => {
    supabase = createSupabaseMock(
      defaultHandlers({ orders: { update: { data: [], error: null } } })
    );

    const { response, json } = await callRoute(
      signedRequest(event("checkout.session.expired"))
    );

    expect(response.status).toBe(200);
    expect(json.noop).toBe(true);
  });

  it("raises no alert for an expired session without metadata", async () => {
    // Nothing suspicious about an abandoned session we can't map to an order.
    await callRoute(
      signedRequest(event("checkout.session.expired", { metadata: null }))
    );

    expect(supabase.call("security_alerts", "insert")).toBeUndefined();
  });
});

describe("status codes drive Stripe's retries", () => {
  it("returns 500 when the order read fails, so Stripe retries", async () => {
    supabase = createSupabaseMock(
      defaultHandlers({
        orders: { select: { data: null, error: { message: "connection reset" } } },
      })
    );

    const { response } = await callRoute(
      signedRequest(event("checkout.session.completed"))
    );

    expect(response.status).toBe(500);
  });

  it("returns 500 when marking paid fails, so the payment is not lost", async () => {
    supabase = createSupabaseMock(
      defaultHandlers({
        orders: {
          select: {
            data: { id: ORDER, total_cents: 2500, paid: false, customer_phone: null },
            error: null,
          },
          update: { data: null, error: { message: "deadlock detected" } },
        },
      })
    );

    const { response } = await callRoute(
      signedRequest(event("checkout.session.completed"))
    );

    expect(response.status).toBe(500);
    expect(sendTrackingSms).not.toHaveBeenCalled();
  });

  it("returns 500 when cancelling an expired order fails", async () => {
    supabase = createSupabaseMock(
      defaultHandlers({
        orders: { update: { data: null, error: { message: "timeout" } } },
      })
    );

    const { response } = await callRoute(
      signedRequest(event("checkout.session.expired"))
    );

    expect(response.status).toBe(500);
  });

  it("never leaks database error detail to Stripe", async () => {
    supabase = createSupabaseMock(
      defaultHandlers({
        orders: {
          select: { data: null, error: { message: 'FATAL: password authentication failed for user "postgres"' } },
        },
      })
    );

    const { json } = await callRoute(
      signedRequest(event("checkout.session.completed"))
    );

    expect(JSON.stringify(json)).not.toMatch(/password|postgres|FATAL/i);
  });
});
