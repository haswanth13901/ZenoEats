import { saveMenuItem } from "@/app/admin/actions";

export default function MenuItemForm() {
  return (
    <form action={saveMenuItem} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-neutral-700">
            Item name
          </label>
          <input
            id="name"
            name="name"
            required
            placeholder="Margherita Pizza"
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-brand focus:ring-1 focus:ring-brand"
          />
        </div>
        <div>
          <label htmlFor="price" className="block text-sm font-medium text-neutral-700">
            Price (USD)
          </label>
          <input
            id="price"
            name="price"
            type="number"
            step="0.01"
            min="0"
            required
            placeholder="12.50"
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-brand focus:ring-1 focus:ring-brand"
          />
        </div>
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium text-neutral-700">
          Description
        </label>
        <input
          id="description"
          name="description"
          placeholder="Fresh tomato, mozzarella, basil"
          className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-brand focus:ring-1 focus:ring-brand"
        />
      </div>

      <div className="grid grid-cols-2 items-end gap-4">
        <div>
          <label htmlFor="category" className="block text-sm font-medium text-neutral-700">
            Category
          </label>
          <input
            id="category"
            name="category"
            placeholder="Pizza"
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-brand focus:ring-1 focus:ring-brand"
          />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-neutral-700">
          <input type="checkbox" name="is_available" defaultChecked className="h-4 w-4 accent-brand" />
          Available to order
        </label>
      </div>

      <button
        type="submit"
        className="rounded-lg bg-brand px-4 py-2 font-medium text-white transition hover:bg-brand-dark"
      >
        Add item
      </button>
    </form>
  );
}
