import { createServerSupabase } from "@/lib/supabase-server";
import PlaceForm from "@/components/admin/PlaceForm";
import PlaceQR from "@/components/admin/PlaceQR";
import { deletePlace } from "@/app/admin/actions";
import type { Place } from "@/types";

export default async function AdminPlacesPage() {
  const supabase = await createServerSupabase();
  const { data: places } = await supabase
    .from("places")
    .select("*")
    .order("created_at", { ascending: false });

  const list = (places ?? []) as Place[];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-900">Delivery places</h1>
        <p className="mt-1 text-neutral-500">
          Each place is a spot you deliver to. Print its QR there — scanning it opens
          the menu with that destination already set.
        </p>
      </div>

      <section className="rounded-xl border border-neutral-200 bg-white p-6">
        <h2 className="text-lg font-medium text-neutral-900">Add a place</h2>
        <div className="mt-4">
          <PlaceForm />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium text-neutral-900">
          Your places ({list.length})
        </h2>
        {list.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-neutral-500">
            No delivery places yet. Add one above to generate its QR code.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {list.map((place) => (
              <div
                key={place.id}
                className="flex items-start justify-between gap-4 rounded-xl border border-neutral-200 bg-white p-4"
              >
                <div className="min-w-0">
                  <div className="font-medium text-neutral-900">{place.name}</div>
                  {place.address && (
                    <p className="truncate text-sm text-neutral-500">{place.address}</p>
                  )}
                  <p className="mt-1 text-xs text-neutral-400">
                    {place.lat.toFixed(4)}, {place.lng.toFixed(4)}
                  </p>
                  <form action={deletePlace} className="mt-2">
                    <input type="hidden" name="id" value={place.id} />
                    <button className="text-sm text-red-600 hover:underline">Delete</button>
                  </form>
                </div>
                <PlaceQR placeId={place.id} placeName={place.name} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
