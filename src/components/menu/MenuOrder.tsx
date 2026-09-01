"use client";

import { useMemo, useState } from "react";
import type { CartItem, MenuItem, Place, Restaurant } from "@/types";

export default function MenuOrder({
  restaurant,
  place,
  items,
}: {
  restaurant: Restaurant;
  place: Place;
  items: MenuItem[];
}) {
  const [cart, setCart] = useState<Record<string, CartItem>>({});
  const [phone, setPhone] = useState("");
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cartList = Object.values(cart);
  const total = useMemo(
    () => cartList.reduce((s, i) => s + i.price_cents * i.quantity, 0),
    [cartList]
  );
  const count = cartList.reduce((s, i) => s + i.quantity, 0);

  function add(item: MenuItem) {
    setCart((c) => {
      const existing = c[item.id];
      return {
        ...c,
        [item.id]: existing
          ? { ...existing, quantity: existing.quantity + 1 }
          : {
              menu_item_id: item.id,
              name: item.name,
              price_cents: item.price_cents,
              quantity: 1,
            },
      };
    });
  }

  function remove(itemId: string) {
    setCart((c) => {
      const existing = c[itemId];
      if (!existing) return c;
      if (existing.quantity <= 1) {
        const { [itemId]: _, ...rest } = c;
        return rest;
      }
      return { ...c, [itemId]: { ...existing, quantity: existing.quantity - 1 } };
    });
  }

  async function checkout() {
    setError(null);
    if (cartList.length === 0) return;
    if (!phone.trim()) {
      setError("Add a phone number so we can text you the tracking link.");
      return;
    }
    setCheckingOut(true);

    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          place_id: place.id,
          restaurant_id: restaurant.id,
          phone: phone.trim(),
          items: cartList,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || "Checkout failed");
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setCheckingOut(false);
    }
  }

  // Group items by category for a tidy menu.
  const grouped = useMemo(() => {
    const g: Record<string, MenuItem[]> = {};
    for (const item of items) {
      const key = item.category?.trim() || "Menu";
      (g[key] ||= []).push(item);
    }
    return g;
  }, [items]);

  return (
    <div className="min-h-screen bg-neutral-50 pb-32">
      <header className="border-b border-neutral-200 bg-white px-5 py-5">
        <h1 className="text-xl font-semibold text-neutral-900">{restaurant?.name}</h1>
        <p className="mt-0.5 text-sm text-neutral-500">
          Delivering to <span className="font-medium text-neutral-700">{place.name}</span>
        </p>
      </header>

      <main className="mx-auto max-w-2xl px-5 py-6">
        {items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-300 p-10 text-center text-neutral-500">
            No items available right now. Please check back soon.
          </p>
        ) : (
          Object.entries(grouped).map(([category, group]) => (
            <section key={category} className="mb-8">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
                {category}
              </h2>
              <ul className="space-y-3">
                {group.map((item) => {
                  const qty = cart[item.id]?.quantity ?? 0;
                  return (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-4 rounded-xl border border-neutral-200 bg-white p-4"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-neutral-900">{item.name}</div>
                        {item.description && (
                          <p className="mt-0.5 text-sm text-neutral-500">
                            {item.description}
                          </p>
                        )}
                        <div className="mt-1 font-medium text-neutral-900">
                          ${(item.price_cents / 100).toFixed(2)}
                        </div>
                      </div>

                      {qty === 0 ? (
                        <button
                          onClick={() => add(item)}
                          className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark"
                        >
                          Add
                        </button>
                      ) : (
                        <div className="flex shrink-0 items-center gap-3">
                          <button
                            onClick={() => remove(item.id)}
                            className="h-8 w-8 rounded-lg border border-neutral-300 text-lg leading-none text-neutral-700 transition hover:bg-neutral-100"
                            aria-label={`Remove one ${item.name}`}
                          >
                            −
                          </button>
                          <span className="w-4 text-center font-medium">{qty}</span>
                          <button
                            onClick={() => add(item)}
                            className="h-8 w-8 rounded-lg bg-brand text-lg leading-none text-white transition hover:bg-brand-dark"
                            aria-label={`Add one ${item.name}`}
                          >
                            +
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </main>

      {/* Sticky cart / checkout bar */}
      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-neutral-200 bg-white p-4 shadow-[0_-4px_12px_rgba(0,0,0,0.04)]">
          <div className="mx-auto max-w-2xl space-y-3">
            <div className="flex items-center gap-3">
              <input
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Phone for order updates"
                className="flex-1 rounded-lg border border-neutral-300 px-3 py-2.5 outline-none focus:border-brand focus:ring-1 focus:ring-brand"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              onClick={checkout}
              disabled={checkingOut}
              className="flex w-full items-center justify-between rounded-lg bg-brand px-5 py-3.5 font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
            >
              <span>{checkingOut ? "Starting checkout…" : "Checkout"}</span>
              <span>
                {count} {count === 1 ? "item" : "items"} · ${(total / 100).toFixed(2)}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
