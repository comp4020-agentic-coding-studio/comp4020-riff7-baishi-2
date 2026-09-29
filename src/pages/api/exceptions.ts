import type { APIRoute } from "astro";
import { ValidationError, addException } from "../../lib/db";
import { bus } from "../../lib/events";

// A plain HTML form POSTs here; the 303 redirect lands back on the same
// week's grid with the moved session highlighted. Other open tabs hear about
// the change over the SSE stream (see api/events.ts).
export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const field = (name: string) => String(form.get(name) ?? "").trim();
  const input = {
    critGroupId: Number(field("critGroupId")),
    week: Number(field("week")),
    day: field("day"),
    startTime: field("startTime"),
    endTime: field("endTime"),
    room: field("room"),
    reason: field("reason"),
  };

  try {
    addException(input);
  } catch (error) {
    if (error instanceof ValidationError) {
      // Send the draft back so a validation error never costs the user their typing.
      const query = new URLSearchParams({ error: error.message });
      if (Number.isInteger(input.week)) query.set("week", String(input.week));
      if (Number.isInteger(input.critGroupId)) query.set("group", String(input.critGroupId));
      for (const key of ["day", "startTime", "endTime", "room", "reason"] as const) {
        if (input[key]) query.set(key, input[key]);
      }
      return redirect(`/?${query}#reschedule`, 303);
    }
    throw error;
  }

  bus.emit("changed");
  const query = new URLSearchParams({
    week: String(input.week),
    flash: "moved",
    changed: String(input.critGroupId),
  });
  return redirect(`/?${query}#flash`, 303);
};
