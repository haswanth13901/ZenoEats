import { saveRestaurant } from "@/app/admin/actions";
import type { Restaurant } from "@/types";

export default function RestaurantForm({
  restaurant,
}: {
  restaurant: Restaurant | null;
}) {
  return (
    <form action={saveRestaurant} className="space-y-4">
      {restaurant && <input type="hidden" name="id" value={restaurant.id} />}

      <Field label="Restaurant name" name="name" defaultValue={restaurant?.name} required />
      <Field
        label="Kitchen address"
        name="address"
        defaultValue={restaurant?.address ?? ""}
        placeholder="123 Main St, Dallas, TX"
      />

      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Kitchen latitude"
          name="origin_lat"
          defaultValue={restaurant?.origin_lat?.toString() ?? ""}
          placeholder="32.7767"
        />
        <Field
          label="Kitchen longitude"
          name="origin_lng"
          defaultValue={restaurant?.origin_lng?.toString() ?? ""}
          placeholder="-96.7970"
        />
      </div>

      <button
        type="submit"
        className="rounded-lg bg-brand px-4 py-2 font-medium text-white transition hover:bg-brand-dark"
      >
        {restaurant ? "Save changes" : "Create restaurant"}
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  required,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-neutral-700">
        {label}
      </label>
      <input
        id={name}
        name={name}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-brand focus:ring-1 focus:ring-brand"
      />
    </div>
  );
}
