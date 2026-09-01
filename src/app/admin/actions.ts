"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase-server";

/** All actions rely on RLS: the caller's session must be an admin. */

async function requireAdmin() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return supabase;
}

// ---------- Restaurant ----------
export async function saveRestaurant(formData: FormData) {
  const supabase = await requireAdmin();
  const id = (formData.get("id") as string) || null;

  const payload = {
    name: formData.get("name") as string,
    address: (formData.get("address") as string) || null,
    origin_lat: parseFloat(formData.get("origin_lat") as string) || null,
    origin_lng: parseFloat(formData.get("origin_lng") as string) || null,
  };

  if (id) {
    await supabase.from("restaurants").update(payload).eq("id", id);
  } else {
    await supabase.from("restaurants").insert(payload);
  }
  revalidatePath("/admin");
}

// ---------- Menu items ----------
export async function saveMenuItem(formData: FormData) {
  const supabase = await requireAdmin();
  const id = (formData.get("id") as string) || null;

  const restaurant = await supabase
    .from("restaurants")
    .select("id")
    .limit(1)
    .maybeSingle();
  if (!restaurant.data) throw new Error("Create a restaurant first");

  const payload = {
    restaurant_id: restaurant.data.id,
    name: formData.get("name") as string,
    description: (formData.get("description") as string) || null,
    price_cents: Math.round(
      parseFloat((formData.get("price") as string) || "0") * 100
    ),
    category: (formData.get("category") as string) || null,
    is_available: formData.get("is_available") === "on",
  };

  if (id) {
    await supabase.from("menu_items").update(payload).eq("id", id);
  } else {
    await supabase.from("menu_items").insert(payload);
  }
  revalidatePath("/admin/menu");
}

export async function deleteMenuItem(formData: FormData) {
  const supabase = await requireAdmin();
  const id = formData.get("id") as string;
  await supabase.from("menu_items").delete().eq("id", id);
  revalidatePath("/admin/menu");
}

// ---------- Places ----------
export async function savePlace(formData: FormData) {
  const supabase = await requireAdmin();
  const id = (formData.get("id") as string) || null;

  const restaurant = await supabase
    .from("restaurants")
    .select("id")
    .limit(1)
    .maybeSingle();
  if (!restaurant.data) throw new Error("Create a restaurant first");

  const payload = {
    restaurant_id: restaurant.data.id,
    name: formData.get("name") as string,
    address: (formData.get("address") as string) || null,
    lat: parseFloat(formData.get("lat") as string),
    lng: parseFloat(formData.get("lng") as string),
  };

  if (id) {
    await supabase.from("places").update(payload).eq("id", id);
  } else {
    await supabase.from("places").insert(payload);
  }
  revalidatePath("/admin/places");
}

export async function deletePlace(formData: FormData) {
  const supabase = await requireAdmin();
  const id = formData.get("id") as string;
  await supabase.from("places").delete().eq("id", id);
  revalidatePath("/admin/places");
}
