import { createServerSupabase } from "@/lib/supabase-server";
import { getStaffUser } from "@/lib/auth";
import { driverAdvanceOrder } from "@/app/driver/actions";
import LocationShare from "@/components/driver/LocationShare";
import { STATUS_LABEL, isDriverTransition, nextStatus } from "@/lib/orders";
import SignOutButton from "@/components/SignOutButton";
import type { OrderStatus } from "@/types";

export const dynamic = "force-dynamic";

interface DriverOrder {
  id: string;
  status: OrderStatus;
  total_cents: number;
  customer_phone: string | null;
  created_at: string;
  places: { name: string; address: string | null; lat: number; lng: number } | null;
  order_items: { id: string; name: string; quantity: number }[];
}

/**
 * The driver's run sheet: the orders assigned to them, what to collect, where
 * it goes, and the one button that moves each along.
 *
 * The query has no `driver_id` filter. It doesn't need one — the "driver read
 * assigned orders" policy restricts it to this driver's rows at the database.
 * An admin viewing this page sees the orders assigned to them personally,
 * which is the honest answer for a page called "your deliveries".
 */
export default async function DriverPage() {
  const user = await getStaffUser();
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, status, total_cents, customer_phone, created_at, " +
        "places(name, address, lat, lng), order_items(id, name, quantity)"
    )
    .eq("paid", true)
    .in("status", ["preparing", "ready", "out_for_delivery"])
    .order("created_at", { ascending: true });

  const orders = (data ?? []) as unknown as DriverOrder[];

  return (
    <main className="min-h-screen bg-neutral-50">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-5 py-4">
        <div>
          <span className="text-lg font-semibold text-neutral-900">ZenoEats</span>
          <p className="text-sm text-neutral-500">
            {user?.fullName ? `${user.fullName} · ` : ""}Your deliveries
          </p>
        </div>
        <SignOutButton />
      </header>

      <div className="mx-auto max-w-2xl px-5 py-6">
        {error ? (
          <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Could not load your deliveries. {error.message}
          </p>
        ) : orders.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-300 p-10 text-center text-neutral-500">
            Nothing assigned to you right now. Orders appear here once the
            kitchen assigns you a delivery.
          </p>
        ) : (
          <ul className="space-y-4">
            {orders.map((order) => (
              <li key={order.id}>
                <DeliveryCard order={order} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function DeliveryCard({ order }: { order: DriverOrder }) {
  const to = nextStatus(order.status);
  const canAdvance = to !== null && isDriverTransition(order.status, to);
  const actionLabel =
    order.status === "ready" ? "Picked up — on my way" : "Delivered";

  const mapsUrl = order.places
    ? `https://www.google.com/maps/dir/?api=1&destination=${order.places.lat},${order.places.lng}`
    : null;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-neutral-900">
              #{order.id.slice(0, 8)}
            </span>
            <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
              {STATUS_LABEL[order.status]}
            </span>
          </div>
          <p className="mt-1 font-medium text-neutral-900">
            {order.places?.name ?? "Unknown destination"}
          </p>
          {order.places?.address && (
            <p className="text-sm text-neutral-500">{order.places.address}</p>
          )}
        </div>
        {mapsUrl && (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 transition hover:bg-neutral-100"
          >
            Directions
          </a>
        )}
      </div>

      <ul className="mt-3 space-y-1 border-t border-neutral-100 pt-3 text-sm text-neutral-600">
        {order.order_items.map((item) => (
          <li key={item.id}>
            {item.quantity} × {item.name}
          </li>
        ))}
      </ul>

      {order.customer_phone && (
        <a
          href={`tel:${order.customer_phone}`}
          className="mt-3 inline-block text-sm text-brand hover:underline"
        >
          Call customer
        </a>
      )}

      <div className="mt-4 space-y-3 border-t border-neutral-100 pt-4">
        {order.status === "out_for_delivery" && (
          <LocationShare orderId={order.id} />
        )}

        {canAdvance ? (
          <form action={driverAdvanceOrder}>
            <input type="hidden" name="id" value={order.id} />
            <input type="hidden" name="from" value={order.status} />
            <button className="w-full rounded-lg bg-brand py-3 font-medium text-white transition hover:bg-brand-dark">
              {actionLabel}
            </button>
          </form>
        ) : (
          <p className="text-sm text-neutral-500">
            Waiting for the kitchen to mark this ready.
          </p>
        )}
      </div>
    </div>
  );
}
