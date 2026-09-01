"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase";

/** Don't write more than one position every 10s, however chatty the GPS is. */
const MIN_INTERVAL_MS = 10_000;

/**
 * Streams the driver's position to `driver_locations` while they're on a
 * delivery. Writes go through the browser client as the signed-in driver, so
 * the "driver write locations" policy checks is_order_driver(order_id) on
 * every upsert — a driver cannot post a position for someone else's order
 * even by editing this component.
 *
 * Sharing is opt-in and stops when the driver stops it or leaves the page.
 */
export default function LocationShare({ orderId }: { orderId: string }) {
  const [sharing, setSharing] = useState(false);
  const [lastSent, setLastSent] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const watchId = useRef<number | null>(null);
  const lastPush = useRef(0);

  const stop = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    setSharing(false);
  }, []);

  // Never leave a GPS watch running after the component goes away.
  useEffect(() => stop, [stop]);

  function start() {
    setError(null);

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("This device can't share location.");
      return;
    }

    const supabase = createClient();

    watchId.current = navigator.geolocation.watchPosition(
      async (position) => {
        const now = Date.now();
        if (now - lastPush.current < MIN_INTERVAL_MS) return;
        lastPush.current = now;

        const { error: writeError } = await supabase
          .from("driver_locations")
          .upsert(
            {
              order_id: orderId,
              lat: position.coords.latitude,
              lng: position.coords.longitude,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "order_id" }
          );

        if (writeError) {
          // Most likely cause is the order no longer being assigned to them.
          console.error("location upsert failed:", writeError.message);
          setError("Couldn't send your location. Is this still your delivery?");
          return;
        }

        setError(null);
        setLastSent(new Date());
      },
      (geoError) => {
        setError(
          geoError.code === geoError.PERMISSION_DENIED
            ? "Location permission denied. Enable it to share your position."
            : "Couldn't read your location."
        );
        stop();
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 }
    );

    setSharing(true);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={sharing ? stop : start}
        className={
          sharing
            ? "rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 transition hover:bg-neutral-100"
            : "rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-neutral-700"
        }
      >
        {sharing ? "Stop sharing location" : "Share my location"}
      </button>

      {sharing && (
        <span className="flex items-center gap-1.5 text-xs text-neutral-500">
          <span
            aria-hidden
            className="h-2 w-2 animate-pulse rounded-full bg-green-500"
          />
          {lastSent
            ? `Last sent ${lastSent.toLocaleTimeString()}`
            : "Waiting for a GPS fix…"}
        </span>
      )}

      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
