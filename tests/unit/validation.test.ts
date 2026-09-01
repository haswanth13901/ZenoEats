import { describe, expect, it } from "vitest";
import { checkoutSchema, firstIssue } from "@/lib/validation";

const uuid = "11111111-1111-4111-8111-111111111111";
const uuid2 = "22222222-2222-4222-8222-222222222222";
const uuid3 = "33333333-3333-4333-8333-333333333333";

function body(overrides: Record<string, unknown> = {}) {
  return {
    place_id: uuid,
    restaurant_id: uuid2,
    phone: "+14155550123",
    items: [{ menu_item_id: uuid3, quantity: 2 }],
    ...overrides,
  };
}

describe("checkoutSchema", () => {
  it("accepts a well-formed order", () => {
    expect(checkoutSchema.safeParse(body()).success).toBe(true);
  });

  it("STRIPS client-sent prices rather than trusting them", () => {
    const result = checkoutSchema.safeParse(
      body({
        items: [
          { menu_item_id: uuid3, quantity: 1, price_cents: 1, name: "Free lunch" },
        ],
      })
    );

    expect(result.success).toBe(true);
    const item = result.data!.items[0] as Record<string, unknown>;
    expect(item.price_cents).toBeUndefined();
    expect(item.name).toBeUndefined();
    expect(Object.keys(item).sort()).toEqual(["menu_item_id", "quantity"]);
  });

  it("rejects an empty cart", () => {
    expect(checkoutSchema.safeParse(body({ items: [] })).success).toBe(false);
  });

  it("rejects a missing cart", () => {
    expect(checkoutSchema.safeParse(body({ items: undefined })).success).toBe(false);
  });

  it("rejects non-uuid ids", () => {
    expect(checkoutSchema.safeParse(body({ place_id: "not-a-uuid" })).success).toBe(false);
    expect(
      checkoutSchema.safeParse(body({ items: [{ menu_item_id: "x", quantity: 1 }] }))
        .success
    ).toBe(false);
  });

  describe("quantity", () => {
    const bad = [0, -1, -999, 1.5, NaN, Infinity, 100, "2", null];
    for (const quantity of bad) {
      it(`rejects ${String(quantity)}`, () => {
        const result = checkoutSchema.safeParse(
          body({ items: [{ menu_item_id: uuid3, quantity }] })
        );
        expect(result.success).toBe(false);
      });
    }

    it("accepts 1 and the 99 cap", () => {
      for (const quantity of [1, 99]) {
        expect(
          checkoutSchema.safeParse(body({ items: [{ menu_item_id: uuid3, quantity }] }))
            .success
        ).toBe(true);
      }
    });
  });

  describe("phone", () => {
    it("accepts common formats", () => {
      for (const phone of ["+14155550123", "4155550123", "+1 (415) 555-0123"]) {
        expect(checkoutSchema.safeParse(body({ phone })).success).toBe(true);
      }
    });

    it("rejects empty, too-short, and injection-shaped values", () => {
      for (const phone of ["", "123", "not a phone", "<script>alert(1)</script>"]) {
        expect(checkoutSchema.safeParse(body({ phone })).success).toBe(false);
      }
    });
  });

  it("caps the number of distinct lines", () => {
    const items = Array.from({ length: 51 }, () => ({
      menu_item_id: uuid3,
      quantity: 1,
    }));
    expect(checkoutSchema.safeParse(body({ items })).success).toBe(false);
  });
});

describe("firstIssue", () => {
  it("names the field that failed", () => {
    const result = checkoutSchema.safeParse(body({ phone: "" }));
    expect(result.success).toBe(false);
    expect(firstIssue(result.error!)).toContain("phone");
  });

  it("never echoes the submitted value back to the client", () => {
    const secret = "<script>alert('xss')</script>";
    const result = checkoutSchema.safeParse(body({ phone: secret }));
    expect(firstIssue(result.error!)).not.toContain(secret);
  });
});
