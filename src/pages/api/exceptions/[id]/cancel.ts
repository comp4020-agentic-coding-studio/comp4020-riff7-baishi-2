import type { APIRoute } from "astro";
import { cancelException } from "../../../../lib/db";
import { bus } from "../../../../lib/events";

// Reverting a reschedule ("undo"): delete the one week's exception row, which
// drops that group back to its standing slot.
export const POST: APIRoute = async ({ params, request, redirect }) => {
  const id = Number(params.id);
  const form = await request.formData();
  const query = new URLSearchParams();
  const week = Number(form.get("week"));
  const group = Number(form.get("group"));

  if (Number.isInteger(id)) {
    cancelException(id);
    bus.emit("changed");
    query.set("flash", "reverted");
    if (Number.isInteger(group) && group > 0) query.set("changed", String(group));
  }
  if (Number.isInteger(week) && week > 0) query.set("week", String(week));
  return redirect(`/?${query}#flash`, 303);
};
