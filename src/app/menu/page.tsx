import { createServerSupabase } from "@/lib/supabase-server";
import MenuOrder from "@/components/menu/MenuOrder";
import type { MenuItem, Place, Restaurant } from "@/types";

/**
 * Customer ordering page. Reached by scanning a place's QR, which encodes
 * /menu?place={id}. Loads the place, its restaurant, and available items.
 */
export default async function MenuPage({
  searchParams,
}: {
  searchParams: Promise<{ place?: string }>;
}) {
  const { place: placeId } = await searchParams;
  const supabase = await createServerSupabase();

  if (!placeId) {
    return (
      <Notice
        title="No delivery place set"
        body="Scan the QR code at your location to start an order."
      />
    );
  }

  const { data: place } = await supabase
    .from("places")
    .select("*")
    .eq("id", placeId)
    .maybeSingle();

  if (!place) {
    return (
      <Notice
        title="We couldn't find that place"
        body="This QR code may be out of date. Ask staff for a current one."
      />
    );
  }

  const [{ data: restaurant }, { data: items }] = await Promise.all([
    supabase
      .from("restaurants")
      .select("*")
      .eq("id", (place as Place).restaurant_id)
      .maybeSingle(),
    supabase
      .from("menu_items")
      .select("*")
      .eq("restaurant_id", (place as Place).restaurant_id)
      .eq("is_available", true)
      .order("category", { ascending: true }),
  ]);

  return (
    <MenuOrder
      restaurant={restaurant as Restaurant}
      place={place as Place}
      items={(items ?? []) as MenuItem[]}
    />
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <h1 className="text-xl font-semibold text-neutral-900">{title}</h1>
        <p className="mt-2 text-neutral-500">{body}</p>
      </div>
    </main>
  );
}
