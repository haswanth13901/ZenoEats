import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase-admin";
import type { OrderStatus } from "@/types";

/**
 * Customer order tracking. Reached from Stripe's success_url and from the
 * confirmation SMS, both of which carry the order UUID.
 *
 * Read with the service-role client: `orders` has no public select policy
 * (see the note in schema.sql — RLS cannot express "only if you know the id",
 * so a blanket policy leaked the whole table). The UUID in the URL is the
 * capability here, and this page is careful to render only what the person
 * holding it already knows: their own items, total, and status. The stored
 * phone number is masked.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STEPS: { status: OrderStatus; label: string; blurb: string }[] = [
  { status: "preparing", label: "Preparing", blurb: "The kitchen is on it." },
  { status: "ready", label: "Ready", blurb: "Packed and waiting for a driver." },
  { status: "out_for_delivery", label: "On the way", blurb: "Your driver is en route." },
  { status: "delivered", label: "Delivered", blurb: "Enjoy!" },
];

function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return null;
  return `••• ••• ${digits.slice(-4)}`;
}

export default async function TrackOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const supabase = createAdminClient();

  const { data: order, error } = await supabase
    .from("orders")
    .select("id, status, paid, total_cents, customer_phone, created_at, place_id, restaurant_id")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error("Could not load this order");
  if (!order) notFound();

  const [{ data: items }, { data: place }, { data: restaurant }] = await Promise.all([
    supabase
      .from("order_items")
      .select("id, name, price_cents, quantity")
      .eq("order_id", order.id),
    supabase.from("places").select("name").eq("id", order.place_id).maybeSingle(),
    supabase
      .from("restaurants")
      .select("name")
      .eq("id", order.restaurant_id)
      .maybeSingle(),
  ]);

  const cancelled = order.status === "cancelled";
  const currentStep = STEPS.findIndex((s) => s.status === order.status);
  const phone = maskPhone(order.customer_phone);

  return (
    <main className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white px-5 py-5">
        <h1 className="text-xl font-semibold text-neutral-900">
          {restaurant?.name ?? "Your order"}
        </h1>
        <p className="mt-0.5 text-sm text-neutral-500">
          Order #{order.id.slice(0, 8)}
          {place?.name ? ` · delivering to ${place.name}` : ""}
        </p>
      </header>

      <div className="mx-auto max-w-2xl space-y-6 px-5 py-6">
        {!order.paid && !cancelled && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            We haven&apos;t received payment for this order yet. If you just paid, this
            page will catch up within a few seconds — refresh to check.
          </p>
        )}

        {cancelled ? (
          <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            This order was cancelled. If that&apos;s unexpected, contact the restaurant.
          </p>
        ) : (
          <section className="rounded-xl border border-neutral-200 bg-white p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
              Status
            </h2>
            <ol className="mt-4 space-y-4">
              {STEPS.map((step, index) => {
                const done = order.paid && currentStep >= index;
                const active = order.paid && currentStep === index;
                return (
                  <li key={step.status} className="flex gap-3">
                    <span
                      aria-hidden
                      className={`mt-1 h-3 w-3 shrink-0 rounded-full ${
                        done ? "bg-brand" : "bg-neutral-200"
                      }`}
                    />
                    <div>
                      <div
                        className={`font-medium ${
                          done ? "text-neutral-900" : "text-neutral-400"
                        }`}
                      >
                        {step.label}
                      </div>
                      {active && (
                        <p className="text-sm text-neutral-500">{step.blurb}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        <section className="rounded-xl border border-neutral-200 bg-white p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
            Your order
          </h2>
          <ul className="mt-4 divide-y divide-neutral-100">
            {(items ?? []).map((item) => (
              <li key={item.id} className="flex justify-between py-2.5 text-sm">
                <span className="text-neutral-700">
                  {item.quantity} × {item.name}
                </span>
                <span className="font-medium text-neutral-900">
                  ${((item.price_cents * item.quantity) / 100).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex justify-between border-t border-neutral-200 pt-3 font-medium">
            <span className="text-neutral-900">Total</span>
            <span className="text-neutral-900">
              ${(order.total_cents / 100).toFixed(2)}
            </span>
          </div>
          {phone && (
            <p className="mt-3 text-xs text-neutral-400">
              Updates sent to {phone}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
