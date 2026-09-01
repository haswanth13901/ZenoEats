import { savePlace } from "@/app/admin/actions";

export default function PlaceForm() {
  return (
    <form action={savePlace} className="space-y-4">
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-neutral-700">
          Place name
        </label>
        <input
          id="name"
          name="name"
          required
          placeholder="Building C Lobby"
          className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-brand focus:ring-1 focus:ring-brand"
        />
      </div>

      <div>
        <label htmlFor="address" className="block text-sm font-medium text-neutral-700">
          Address
        </label>
        <input
          id="address"
          name="address"
          placeholder="500 Commerce St, Dallas, TX"
          className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-brand focus:ring-1 focus:ring-brand"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="lat" className="block text-sm font-medium text-neutral-700">
            Latitude
          </label>
          <input
            id="lat"
            name="lat"
            type="number"
            step="any"
            required
            placeholder="32.7801"
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-brand focus:ring-1 focus:ring-brand"
          />
        </div>
        <div>
          <label htmlFor="lng" className="block text-sm font-medium text-neutral-700">
            Longitude
          </label>
          <input
            id="lng"
            name="lng"
            type="number"
            step="any"
            required
            placeholder="-96.8000"
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-brand focus:ring-1 focus:ring-brand"
          />
        </div>
      </div>

      <button
        type="submit"
        className="rounded-lg bg-brand px-4 py-2 font-medium text-white transition hover:bg-brand-dark"
      >
        Add place &amp; generate QR
      </button>
    </form>
  );
}
