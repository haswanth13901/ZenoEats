"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase-server";
import { requireRole } from "@/lib/auth";
import { isDriverTransition, nextStatus } from "@/lib/orders";
import type { OrderStatus } from "@/types";

/**
 * Driver-side order actions.
 *
 * Two layers guard these. requireRole rejects anyone who isn't staff, and the
 * update itself runs as the caller, so the "driver update assigned orders"
 * RLS policy (driver_id = auth.uid()) decides *which* orders they may touch.
 * This code never needs to check ownership itself — and must not, because the
 * database is the authority.
 */

const orderIdSchema = z.uuid("Invalid order id");

export async function driverAdvanceOrder(formData: FormData) {
  await requireRole("driver", "admin");
  const supabase = await createServerSupabase();

  const id = orderIdSchema.parse(formData.get("id"));
  const from = formData.get("from") as OrderStatus;
  const to = nextStatus(from);

  // A driver moves an order along exactly two edges: picked up, and dropped
  // off. Everything before that belongs to the kitchen.
  if (!to || !isDriverTransition(from, to)) {
    throw new Error("That isn't a change you can make to this order");
  }

  const { data, error } = await supabase
    .from("orders")
    .update({ status: to })
    .eq("id", id)
    .eq("status", from)
    .select("id");

  if (error) {
    console.error(`driver action: could not advance order ${id}:`, error.message);
    throw new Error("Could not update that order.");
  }

  // Zero rows means either someone else moved it, or RLS rejected the write
  // because it isn't this driver's order. Same message either way — don't
  // confirm to a caller whether an order they can't touch exists.
  if (!data || data.length === 0) {
    throw new Error("That order isn't yours to update, or it already moved on.");
  }

  revalidatePath("/driver");
}
