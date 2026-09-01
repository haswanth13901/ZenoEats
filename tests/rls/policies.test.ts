import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parse } from "dotenv";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * RLS policy tests, run against a REAL Supabase project.
 *
 * These deliberately do not use the mock. Row Level Security is enforced by
 * Postgres, so a faked client asserting what we told it to return would prove
 * nothing — it would keep passing after someone dropped every policy. The only
 * honest test is a real anon key against a real database.
 *
 * Credentials come from .env.local, read directly rather than from process.env
 * because tests/setup.ts fills that with deliberate dummies. When .env.local is
 * absent — CI, a fresh clone — the whole suite skips rather than failing, and
 * says so.
 *
 * Nothing here mutates data. The write attempts are all expected to be denied,
 * and the update test snapshots the table to prove nothing changed even when
 * the API reports success.
 */

let env: Record<string, string> = {};
try {
  env = parse(readFileSync(resolve(process.cwd(), ".env.local")));
} catch {
  // No .env.local — handled by the skip below.
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(url && anonKey && serviceKey);

if (!configured) {
  console.warn(
    "\n  RLS tests skipped: .env.local with Supabase credentials not found.\n" +
      "  These verify real database policies and cannot run against a mock.\n"
  );
}

describe.skipIf(!configured)("RLS policies (live database)", () => {
  let anon: SupabaseClient;
  let admin: SupabaseClient;

  beforeAll(() => {
    anon = createClient(url, anonKey, { auth: { persistSession: false } });
    admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  });

  describe("the public menu stays readable — the ordering flow depends on it", () => {
    for (const table of ["restaurants", "places", "menu_items"]) {
      it(`anon can read ${table}`, async () => {
        const { error } = await anon.from(table).select("id").limit(1);
        expect(error).toBeNull();
      });
    }
  });

  describe("anon cannot write to public-read tables", () => {
    it("cannot insert a menu item", async () => {
      const { error } = await anon
        .from("menu_items")
        .insert({
          name: "rls-probe-should-fail",
          price_cents: 1,
          restaurant_id: "00000000-0000-4000-8000-000000000000",
        })
        .select();

      expect(error).not.toBeNull();
    });

    it("cannot insert a place", async () => {
      const { error } = await anon
        .from("places")
        .insert({
          name: "rls-probe-should-fail",
          lat: 0,
          lng: 0,
          restaurant_id: "00000000-0000-4000-8000-000000000000",
        })
        .select();

      expect(error).not.toBeNull();
    });

    it("cannot update a menu item's price", async () => {
      const { data: before } = await admin
        .from("menu_items")
        .select("id, price_cents")
        .limit(1)
        .maybeSingle();

      if (!before) return; // nothing to probe against

      await anon.from("menu_items").update({ price_cents: 1 }).eq("id", before.id);

      const { data: after } = await admin
        .from("menu_items")
        .select("price_cents")
        .eq("id", before.id)
        .single();

      expect(after!.price_cents).toBe(before.price_cents);
    });
  });

  describe("orders are not publicly readable (F3)", () => {
    it("has orders in the table, so the next assertion means something", async () => {
      const { count, error } = await admin
        .from("orders")
        .select("id", { count: "exact", head: true });

      expect(error).toBeNull();
      // If this is ever 0, the anon-returns-nothing test below is vacuous:
      // an empty table returns nothing to everybody.
      expect(count).toBeGreaterThan(0);
    });

    it("anon reading orders gets nothing", async () => {
      const { data, error } = await anon.from("orders").select("id, customer_phone");

      expect(error).toBeNull(); // RLS filters rows, it does not error
      expect(data).toEqual([]);
    });

    it("anon reading order_items gets nothing", async () => {
      const { data } = await anon.from("order_items").select("id");
      expect(data).toEqual([]);
    });

    it("anon reading driver_locations gets nothing", async () => {
      const { data } = await anon.from("driver_locations").select("order_id");
      expect(data).toEqual([]);
    });

    it("anon reading security_alerts gets nothing", async () => {
      const { data } = await anon.from("security_alerts").select("id");
      expect(data).toEqual([]);
    });

    it("no customer phone number is reachable with the anon key", async () => {
      const { data } = await anon.from("orders").select("customer_phone");
      const phones = (data ?? [])
        .map((row) => (row as { customer_phone: string | null }).customer_phone)
        .filter(Boolean);

      expect(phones).toEqual([]);
    });
  });

  describe("anon cannot modify orders", () => {
    it("cannot mark an order paid", async () => {
      // Snapshot first: PostgREST returns 204 for an update matching zero
      // rows, so the status code alone cannot tell us whether RLS held.
      const { data: before } = await admin
        .from("orders")
        .select("id, paid, status, updated_at")
        .order("created_at");

      await anon.from("orders").update({ paid: true, status: "delivered" }).neq(
        "id",
        "00000000-0000-4000-8000-000000000000"
      );

      const { data: after } = await admin
        .from("orders")
        .select("id, paid, status, updated_at")
        .order("created_at");

      expect(after).toEqual(before);
    });

    it("cannot insert an order", async () => {
      const { error } = await anon
        .from("orders")
        .insert({
          restaurant_id: "00000000-0000-4000-8000-000000000000",
          place_id: "00000000-0000-4000-8000-000000000000",
          total_cents: 1,
        })
        .select();

      expect(error).not.toBeNull();
    });

    it("cannot delete orders", async () => {
      const { count: before } = await admin
        .from("orders")
        .select("id", { count: "exact", head: true });

      await anon.from("orders").delete().neq("id", "00000000-0000-4000-8000-000000000000");

      const { count: after } = await admin
        .from("orders")
        .select("id", { count: "exact", head: true });

      expect(after).toBe(before);
    });
  });

  describe("anon cannot spoof a driver position (F5)", () => {
    it("cannot insert a driver location", async () => {
      const { data: order } = await admin.from("orders").select("id").limit(1).maybeSingle();
      if (!order) return;

      const { error } = await anon
        .from("driver_locations")
        .insert({ order_id: order.id, lat: 1, lng: 1 })
        .select();

      expect(error).not.toBeNull();

      // Belt and braces: prove nothing landed.
      const { data: rows } = await admin
        .from("driver_locations")
        .select("order_id")
        .eq("order_id", order.id);
      expect(rows ?? []).toEqual([]);
    });
  });

  describe("profiles are not enumerable by anon", () => {
    it("anon reading profiles gets nothing", async () => {
      const { data } = await anon.from("profiles").select("id, role");
      expect(data).toEqual([]);
    });

    it("anon cannot promote itself to admin", async () => {
      const { data: before } = await admin.from("profiles").select("id, role");

      await anon.from("profiles").update({ role: "admin" }).neq(
        "id",
        "00000000-0000-4000-8000-000000000000"
      );

      const { data: after } = await admin.from("profiles").select("id, role");
      expect(after).toEqual(before);
    });
  });
});
