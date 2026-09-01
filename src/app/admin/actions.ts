"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase-server";
import { requireRole } from "@/lib/auth";

/**
 * All actions run as the caller, so RLS applies. `requireAdmin` checks the
 * role in the application layer too, and every write checks its error —
 * previously a write rejected by RLS returned silently and the page
 * re-rendered as though it had succeeded.
 */

async function requireAdmin() {
  await requireRole("admin");
  return createServerSupabase();
}

/** Supabase errors carry SQL detail; surface a clean message, log the rest. */
function assertOk(error: { message: string } | null, action: string): void {
  if (!error) return;
  console.error(`admin action "${action}" failed:`, error.message);
  throw new Error(`Could not ${action}. You may not have permission.`);
}

// ---------- Restaurant ----------
export async function saveRestaurant(formData: FormData) {
  const supabase = await requireAdmin();
  const id = (formData.get("id") as string) || null;

  const name = ((formData.get("name") as string) ?? "").trim();
  if (!name) throw new Error("Restaurant name is required");

  const lat = parseFloat(formData.get("origin_lat") as string);
  const lng = parseFloat(formData.get("origin_lng") as string);

  const payload = {
    name,
    address: ((formData.get("address") as string) || "").trim() || null,
    origin_lat: Number.isFinite(lat) ? lat : null,
    origin_lng: Number.isFinite(lng) ? lng : null,
  };

  const { error } = id
    ? await supabase.from("restaurants").update(payload).eq("id", id)
    : await supabase.from("restaurants").insert(payload);

  assertOk(error, "save the restaurant");
  revalidatePath("/admin");
}

// ---------- Menu items ----------
export async function saveMenuItem(formData: FormData) {
  const supabase = await requireAdmin();
  const id = (formData.get("id") as string) || null;

  const { data: restaurant, error: restaurantError } = await supabase
    .from("restaurants")
    .select("id")
    .limit(1)
    .maybeSingle();

  assertOk(restaurantError, "load the restaurant");
  if (!restaurant) throw new Error("Create a restaurant first");

  const name = ((formData.get("name") as string) ?? "").trim();
  if (!name) throw new Error("Item name is required");

  const price = parseFloat((formData.get("price") as string) || "0");
  if (!Number.isFinite(price) || price < 0) {
    throw new Error("Price must be a positive number");
  }

  const payload = {
    restaurant_id: restaurant.id,
    name,
    description: ((formData.get("description") as string) || "").trim() || null,
    price_cents: Math.round(price * 100),
    category: ((formData.get("category") as string) || "").trim() || null,
    is_available: formData.get("is_available") === "on",
  };

  const { error } = id
    ? await supabase.from("menu_items").update(payload).eq("id", id)
    : await supabase.from("menu_items").insert(payload);

  assertOk(error, "save the menu item");
  revalidatePath("/admin/menu");
}

export async function deleteMenuItem(formData: FormData) {
  const supabase = await requireAdmin();
  const id = formData.get("id") as string;
  if (!id) throw new Error("Missing item id");

  const { error } = await supabase.from("menu_items").delete().eq("id", id);
  assertOk(error, "delete the menu item");
  revalidatePath("/admin/menu");
}

// ---------- Places ----------
export async function savePlace(formData: FormData) {
  const supabase = await requireAdmin();
  const id = (formData.get("id") as string) || null;

  const { data: restaurant, error: restaurantError } = await supabase
    .from("restaurants")
    .select("id")
    .limit(1)
    .maybeSingle();

  assertOk(restaurantError, "load the restaurant");
  if (!restaurant) throw new Error("Create a restaurant first");

  const name = ((formData.get("name") as string) ?? "").trim();
  if (!name) throw new Error("Place name is required");

  const lat = parseFloat(formData.get("lat") as string);
  const lng = parseFloat(formData.get("lng") as string);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("A place needs valid coordinates");
  }

  const payload = {
    restaurant_id: restaurant.id,
    name,
    address: ((formData.get("address") as string) || "").trim() || null,
    lat,
    lng,
  };

  const { error } = id
    ? await supabase.from("places").update(payload).eq("id", id)
    : await supabase.from("places").insert(payload);

  assertOk(error, "save the place");
  revalidatePath("/admin/places");
}

export async function deletePlace(formData: FormData) {
  const supabase = await requireAdmin();
  const id = formData.get("id") as string;
  if (!id) throw new Error("Missing place id");

  const { error } = await supabase.from("places").delete().eq("id", id);
  assertOk(error, "delete the place");
  revalidatePath("/admin/places");
}
