import { createServerSupabase } from "@/lib/supabase-server";
import MenuItemForm from "@/components/admin/MenuItemForm";
import { deleteMenuItem } from "@/app/admin/actions";
import type { MenuItem } from "@/types";

export default async function AdminMenuPage() {
  const supabase = await createServerSupabase();
  const { data: items } = await supabase
    .from("menu_items")
    .select("*")
    .order("created_at", { ascending: false });

  const menu = (items ?? []) as MenuItem[];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-900">Menu</h1>
        <p className="mt-1 text-neutral-500">
          Add the dishes customers can order. Toggle availability without deleting.
        </p>
      </div>

      <section className="rounded-xl border border-neutral-200 bg-white p-6">
        <h2 className="text-lg font-medium text-neutral-900">Add an item</h2>
        <div className="mt-4">
          <MenuItemForm />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium text-neutral-900">
          Current items ({menu.length})
        </h2>
        {menu.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-neutral-500">
            No items yet. Add your first dish above.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
            {menu.map((item) => (
              <li key={item.id} className="flex items-center justify-between p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-neutral-900">{item.name}</span>
                    {!item.is_available && (
                      <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">
                        Unavailable
                      </span>
                    )}
                  </div>
                  {item.description && (
                    <p className="text-sm text-neutral-500">{item.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-medium text-neutral-900">
                    ${(item.price_cents / 100).toFixed(2)}
                  </span>
                  <form action={deleteMenuItem}>
                    <input type="hidden" name="id" value={item.id} />
                    <button className="text-sm text-red-600 hover:underline">Delete</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
