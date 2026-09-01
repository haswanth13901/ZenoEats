import { createServerSupabase } from "@/lib/supabase-server";
import RestaurantForm from "@/components/admin/RestaurantForm";

/** Admin overview: restaurant profile + at-a-glance counts. */
export default async function AdminOverviewPage() {
  const supabase = await createServerSupabase();

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("*")
    .limit(1)
    .maybeSingle();

  const [{ count: itemCount }, { count: placeCount }, { count: openOrders }] =
    await Promise.all([
      supabase.from("menu_items").select("*", { count: "exact", head: true }),
      supabase.from("places").select("*", { count: "exact", head: true }),
      // Only paid orders are real work. An order row is created before the
      // customer pays, so abandoned checkouts would otherwise sit in this
      // count as "open" forever.
      supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .eq("paid", true)
        .in("status", ["placed", "preparing", "ready", "out_for_delivery"]),
    ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-900">Overview</h1>
        <p className="mt-1 text-neutral-500">
          {restaurant
            ? `Managing ${restaurant.name}.`
            : "Set up your restaurant to start taking orders."}
        </p>
      </div>

      {restaurant && (
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Menu items" value={itemCount ?? 0} href="/admin/menu" />
          <Stat label="Delivery places" value={placeCount ?? 0} href="/admin/places" />
          <Stat label="Open orders" value={openOrders ?? 0} href="/admin/orders" />
        </div>
      )}

      <section className="rounded-xl border border-neutral-200 bg-white p-6">
        <h2 className="text-lg font-medium text-neutral-900">
          {restaurant ? "Restaurant details" : "Create your restaurant"}
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          This is your kitchen — its address sets the starting point for delivery routes.
        </p>
        <div className="mt-4">
          <RestaurantForm restaurant={restaurant ?? null} />
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <a
      href={href}
      className="rounded-xl border border-neutral-200 bg-white p-5 transition hover:border-brand"
    >
      <div className="text-3xl font-semibold text-neutral-900">{value}</div>
      <div className="mt-1 text-sm text-neutral-500">{label}</div>
    </a>
  );
}
