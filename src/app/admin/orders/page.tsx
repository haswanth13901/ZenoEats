import { createServerSupabase } from "@/lib/supabase-server";
import { advanceOrder, assignDriver, cancelOrder } from "@/app/admin/actions";
import { ADVANCE_LABEL, STATUS_LABEL, isTerminal, nextStatus } from "@/lib/orders";
import type { OrderStatus } from "@/types";

export const dynamic = "force-dynamic";

interface OrderRow {
  id: string;
  status: OrderStatus;
  paid: boolean;
  total_cents: number;
  customer_phone: string | null;
  driver_id: string | null;
  created_at: string;
  places: { name: string } | null;
  order_items: { id: string; name: string; quantity: number; price_cents: number }[];
}

interface DriverRow {
  id: string;
  full_name: string | null;
  role: string;
}

/**
 * The kitchen queue. Live orders first, oldest at the top — the one that has
 * been waiting longest is the one that needs attention.
 *
 * Only paid orders are actionable. Unpaid rows exist because the order is
 * created before checkout; they resolve themselves when Stripe reports the
 * session paid or expired, so they are shown separately and read-only.
 */
export default async function AdminOrdersPage() {
  const supabase = await createServerSupabase();

  const [{ data: orderData, error }, { data: driverData }] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "id, status, paid, total_cents, customer_phone, driver_id, created_at, " +
          "places(name), order_items(id, name, quantity, price_cents)"
      )
      .order("created_at", { ascending: true }),
    supabase
      .from("profiles")
      .select("id, full_name, role")
      .in("role", ["driver", "admin"]),
  ]);

  if (error) {
    return (
      <Panel tone="error">
        Could not load orders. {error.message}
      </Panel>
    );
  }

  const orders = (orderData ?? []) as unknown as OrderRow[];
  const drivers = (driverData ?? []) as DriverRow[];

  const live = orders.filter((o) => o.paid && !isTerminal(o.status));
  const finished = orders.filter((o) => o.paid && isTerminal(o.status));
  const unpaid = orders.filter((o) => !o.paid && o.status !== "cancelled");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-900">Orders</h1>
        <p className="mt-1 text-neutral-500">
          Paid orders move through the kitchen here. Assign a driver once an order
          is ready — that is what lets them see it in the driver view.
        </p>
      </div>

      <section>
        <SectionHeading>Live ({live.length})</SectionHeading>
        {live.length === 0 ? (
          <Panel>No live orders. New paid orders appear here automatically.</Panel>
        ) : (
          <ul className="space-y-3">
            {live.map((order) => (
              <li key={order.id}>
                <OrderCard order={order} drivers={drivers} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {unpaid.length > 0 && (
        <section>
          <SectionHeading>Awaiting payment ({unpaid.length})</SectionHeading>
          <Panel>
            These were started but not paid for. Stripe cancels them
            automatically when the checkout session expires — no action needed.
          </Panel>
          <ul className="mt-3 space-y-2">
            {unpaid.map((order) => (
              <li
                key={order.id}
                className="flex items-center justify-between rounded-lg border border-dashed border-neutral-300 px-4 py-2.5 text-sm text-neutral-500"
              >
                <span>
                  #{order.id.slice(0, 8)} · {order.places?.name ?? "Unknown place"}
                </span>
                <span>${(order.total_cents / 100).toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {finished.length > 0 && (
        <section>
          <SectionHeading>Finished ({finished.length})</SectionHeading>
          <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
            {finished.slice(0, 20).map((order) => (
              <li
                key={order.id}
                className="flex items-center justify-between px-4 py-3 text-sm"
              >
                <span className="text-neutral-700">
                  #{order.id.slice(0, 8)} · {order.places?.name ?? "Unknown place"}
                </span>
                <span className="flex items-center gap-3">
                  <StatusPill status={order.status} />
                  <span className="font-medium text-neutral-900">
                    ${(order.total_cents / 100).toFixed(2)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function OrderCard({
  order,
  drivers,
}: {
  order: OrderRow;
  drivers: DriverRow[];
}) {
  const advanceLabel = ADVANCE_LABEL[order.status];
  const canAdvance = nextStatus(order.status) !== null;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-neutral-900">
              #{order.id.slice(0, 8)}
            </span>
            <StatusPill status={order.status} />
          </div>
          <p className="mt-1 text-sm text-neutral-500">
            {order.places?.name ?? "Unknown place"}
            {order.customer_phone ? ` · ${order.customer_phone}` : ""}
          </p>
          <p className="text-xs text-neutral-400">
            Placed {new Date(order.created_at).toLocaleString()}
          </p>
        </div>
        <span className="text-lg font-semibold text-neutral-900">
          ${(order.total_cents / 100).toFixed(2)}
        </span>
      </div>

      <ul className="mt-3 space-y-1 border-t border-neutral-100 pt-3 text-sm text-neutral-600">
        {order.order_items.map((item) => (
          <li key={item.id}>
            {item.quantity} × {item.name}
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {canAdvance && advanceLabel && (
          <form action={advanceOrder}>
            <input type="hidden" name="id" value={order.id} />
            <input type="hidden" name="from" value={order.status} />
            <button className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark">
              {advanceLabel}
            </button>
          </form>
        )}

        <form action={assignDriver} className="flex items-center gap-2">
          <input type="hidden" name="id" value={order.id} />
          <select
            name="driver_id"
            defaultValue={order.driver_id ?? ""}
            className="rounded-lg border border-neutral-300 px-2 py-2 text-sm"
            aria-label={`Driver for order ${order.id.slice(0, 8)}`}
          >
            <option value="">No driver</option>
            {drivers.map((driver) => (
              <option key={driver.id} value={driver.id}>
                {driver.full_name ?? "Unnamed"}
                {driver.role === "admin" ? " (admin)" : ""}
              </option>
            ))}
          </select>
          <button className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 transition hover:bg-neutral-100">
            Assign
          </button>
        </form>

        <form action={cancelOrder} className="ml-auto">
          <input type="hidden" name="id" value={order.id} />
          <button className="rounded-lg px-3 py-2 text-sm text-red-600 transition hover:bg-red-50">
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: OrderStatus }) {
  const tone =
    status === "cancelled"
      ? "bg-red-50 text-red-700"
      : status === "delivered"
        ? "bg-green-50 text-green-700"
        : "bg-neutral-100 text-neutral-600";
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${tone}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
      {children}
    </h2>
  );
}

function Panel({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "error";
}) {
  const cls =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-700"
      : "border-dashed border-neutral-300 text-neutral-500";
  return (
    <p className={`rounded-xl border p-6 text-center text-sm ${cls}`}>{children}</p>
  );
}
