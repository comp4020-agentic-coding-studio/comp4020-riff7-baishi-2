import { beforeAll, describe, expect, inject, it } from "vitest";
import { createReconnectGate } from "../src/lib/live-reload";
import { sessionDate } from "../src/lib/db";
import { clampStart, formatTime, snapMinutes } from "../src/lib/drag-reschedule";
import { type RosterInput, buildWeekGrid, pickCurrentWeek } from "../src/lib/schedule";

// This week's brief: model a slice of a real ANU system, wired end to end,
// with a core flow that survives a reload. The roster's core flow is
// rescheduling a crit group's session for one teaching week; these tests
// assert the contracts that make that a real persisted change, not just a
// page that renders — the same shape as the starter's own guestbook.test.ts
// asserted for the demo it replaces.
const baseUrl = inject("baseUrl");

// Astro checks form POSTs carry a same-origin Origin header (CSRF
// protection); browsers send it automatically, a bare fetch doesn't.
const post = (path: string, body: URLSearchParams) =>
  fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { origin: baseUrl },
    body,
    redirect: "manual",
  });

describe("rescheduling a session", () => {
  const reason = `spec probe ${process.hrtime.bigint()}`;

  it("accepts a valid reschedule and redirects back to the roster", async () => {
    const res = await post(
      "/api/exceptions",
      new URLSearchParams({
        critGroupId: "3", // baishi
        week: "8",
        day: "Thu",
        startTime: "11:00",
        endTime: "12:30",
        room: "",
        reason,
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(/^\/\?week=8&flash=moved&changed=3/);
  });

  it("persists the reschedule: a fresh page load shows it", async () => {
    const res = await fetch(new URL("/?week=8", baseUrl));
    const html = await res.text();
    expect(html).toContain(reason);
    expect(html).toContain("Thu 11:00–12:30");
  });

  it("falls back to the group's own room when none is given", async () => {
    const html = await (await fetch(new URL("/?week=8", baseUrl))).text();
    expect(html).toContain("Marie Reay Building (155), Room 4.03");
  });

  it("broadcasts the change over the SSE stream", async () => {
    const stream = await fetch(new URL("/api/events", baseUrl));
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const reader = stream.body?.getReader();
    if (!reader) throw new Error("no response body");

    await post(
      "/api/exceptions",
      new URLSearchParams({
        critGroupId: "4", // dachi
        week: "8",
        day: "Thu",
        startTime: "13:00",
        endTime: "14:30",
        room: "",
        reason: "live probe",
      }),
    );

    const decoder = new TextDecoder();
    let received = "";
    while (!received.includes("data: changed")) {
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended before the event arrived");
      received += decoder.decode(value, { stream: true });
    }
    await reader.cancel();
  }, 10_000);
});

describe("rescheduling the same week twice", () => {
  // addException deletes any existing exception for the same (critGroupId,
  // week) before inserting the new one -- the schema's own unique
  // constraint on that pair would otherwise reject the second insert. This
  // is the "one exception per group per week" rule CLAUDE.md names, and had
  // no test of its own: a naive read of that constraint could just as
  // easily mean "reject a second reschedule," which is not what the code
  // does.
  it("replaces the earlier exception rather than duplicating or rejecting it", async () => {
    await post(
      "/api/exceptions",
      new URLSearchParams({
        critGroupId: "6", // liuru
        week: "11",
        day: "Tue",
        startTime: "09:00",
        endTime: "10:00",
        room: "",
        reason: "first reschedule",
      }),
    );
    const res = await post(
      "/api/exceptions",
      new URLSearchParams({
        critGroupId: "6",
        week: "11",
        day: "Fri",
        startTime: "13:00",
        endTime: "14:00",
        room: "",
        reason: "second reschedule",
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(/^\/\?week=11&flash=moved/);

    const html = await (await fetch(new URL("/?week=11", baseUrl))).text();
    expect(html).not.toContain("first reschedule");
    expect(html).toContain("second reschedule");
    expect(html).toContain("Fri 13:00–14:00");
    // exactly one row for that group/week, not one for each reschedule
    expect(html.match(/second reschedule/g)?.length).toBe(1);
  });
});

describe("validation", () => {
  it("rejects a reason-free request without writing an exception", async () => {
    const res = await post(
      "/api/exceptions",
      new URLSearchParams({
        critGroupId: "3",
        week: "5",
        day: "Thu",
        startTime: "09:00",
        endTime: "10:00",
        room: "",
        reason: "",
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(/^\/\?error=/);

    const html = await (await fetch(new URL("/?week=5", baseUrl))).text();
    // week 5's standing Wednesday slot should be untouched
    expect(html).not.toContain("Thu 09:00–10:00");
  });

  it("rejects an end time that isn't after the start time", async () => {
    const res = await post(
      "/api/exceptions",
      new URLSearchParams({
        critGroupId: "3",
        week: "6",
        day: "Wed",
        startTime: "10:00",
        endTime: "09:00",
        room: "",
        reason: "bad range",
      }),
    );
    expect(res.headers.get("location")).toMatch(/^\/\?error=/);
  });

  it("rejects a weekend day", async () => {
    const res = await post(
      "/api/exceptions",
      new URLSearchParams({
        critGroupId: "3",
        week: "6",
        day: "Sat",
        startTime: "10:00",
        endTime: "11:00",
        room: "",
        reason: "weekend",
      }),
    );
    expect(res.headers.get("location")).toMatch(/^\/\?error=/);
  });
});

describe("live-reload reconnect gate", () => {
  // The client's EventSource reconnects on its own after any drop -- a
  // network blip, or on Fly.io the machine auto-stopping while idle -- but
  // the in-memory bus keeps no backlog of what it missed. Verified live with
  // agent-browser too (killing and restarting the preview server mid-session
  // to simulate a Fly auto-stop/wake cycle, see memory/now.md); this covers
  // the gate's own decision in isolation, cheaper than a browser round trip.
  it("does not reload on the first connect", () => {
    const shouldReloadOnOpen = createReconnectGate();
    expect(shouldReloadOnOpen()).toBe(false);
  });

  it("reloads on every reconnect after the first", () => {
    const shouldReloadOnOpen = createReconnectGate();
    shouldReloadOnOpen();
    expect(shouldReloadOnOpen()).toBe(true);
    expect(shouldReloadOnOpen()).toBe(true);
  });
});

describe("sessionDate", () => {
  // CLAUDE.md's own rule: a session's date is derived from the week's
  // Monday, never stored. Every roster row on the page renders through
  // this function, but nothing had asserted the arithmetic itself --
  // only eyeballed the rendered result against the real calendar.
  it("returns the Monday itself for a Mon session", () => {
    expect(sessionDate("2026-07-27", "Mon")).toBe("2026-07-27");
  });

  it("offsets forward within the same week for a later weekday", () => {
    expect(sessionDate("2026-07-27", "Wed")).toBe("2026-07-29");
  });

  it("crosses a month boundary using a real seeded week", () => {
    // Week 8's Monday (2026-09-28); its Friday session falls in October.
    expect(sessionDate("2026-09-28", "Fri")).toBe("2026-10-02");
  });
});

describe("cancelling a reschedule", () => {
  let exceptionId: string;

  beforeAll(async () => {
    await post(
      "/api/exceptions",
      new URLSearchParams({
        critGroupId: "5", // yunlin
        week: "3",
        day: "Fri",
        startTime: "09:00",
        endTime: "10:00",
        room: "",
        reason: "to be cancelled",
      }),
    );
    const html = await (await fetch(new URL("/?week=3&group=5", baseUrl))).text();
    // the cancel form's action follows its exception's reason text in the
    // rendered <li>, so anchor the search there rather than assuming an id
    const match = html.match(/to be cancelled[^]*?\/api\/exceptions\/(\d+)\/cancel/);
    if (!match) throw new Error("could not find the exception's cancel form in the roster page");
    exceptionId = match[1];
  });

  it("reverts the week to the group's standing slot", async () => {
    const res = await post(`/api/exceptions/${exceptionId}/cancel`, new URLSearchParams());
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(/flash=reverted/);

    const html = await (await fetch(new URL("/?week=3", baseUrl))).text();
    expect(html).not.toContain("to be cancelled");
  });
});

describe("the week grid view", () => {
  const roster: RosterInput[] = [
    { id: 1, agent: "a", name: "A", tutorName: "Tutor One", day: "Mon", startTime: "14:00", endTime: "15:30", room: "R1",
      sessions: [{ week: 1, day: "Mon", startTime: "14:00", endTime: "15:30", room: "R1", reason: null, exceptionId: null }] },
    { id: 2, agent: "b", name: "B", tutorName: "Tutor One", day: "Tue", startTime: "09:00", endTime: "10:30", room: "R2",
      sessions: [{ week: 1, day: "Mon", startTime: "15:00", endTime: "16:00", room: "R2", reason: "moved", exceptionId: 7 }] },
    { id: 3, agent: "c", name: "C", tutorName: "Tutor Two", day: "Fri", startTime: "18:00", endTime: "19:30", room: "R3",
      sessions: [{ week: 1, day: "Fri", startTime: "18:00", endTime: "19:30", room: "R3", reason: null, exceptionId: null }] },
  ];
  const grid = buildWeekGrid(roster, 1, "2026-07-27");

  it("places each session on its own day with a derived date", () => {
    expect(grid.days.map((d) => d.date)).toEqual(["2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31"]);
    expect(grid.days[0].sessions.map((s) => s.name)).toEqual(["A", "B"]);
    expect(grid.days[4].sessions.map((s) => s.name)).toEqual(["C"]);
  });

  it("flags two overlapping sessions that share a tutor as a clash", () => {
    const [a, b] = grid.days[0].sessions;
    expect(a.clash).toBe(true);
    expect(b.clash).toBe(true);
    expect(grid.days[4].sessions[0].clash).toBe(false);
  });

  it("puts overlapping sessions in separate lanes", () => {
    const [a, b] = grid.days[0].sessions;
    expect([a.lane, b.lane]).toEqual([0, 1]);
    expect(a.lanes).toBe(2);
  });

  it("gives a session that overlaps nothing the full column width", () => {
    const morning = buildWeekGrid(
      [{ ...roster[0], sessions: [{ ...roster[0].sessions[0], startTime: "09:00", endTime: "10:00" }] }, roster[0]],
      1,
      "2026-07-27",
    ).days[0].sessions;
    expect(morning.map((s) => s.lanes)).toEqual([1, 1]);
  });

  it("stretches the visible hours to fit a late session", () => {
    expect(grid.startHour).toBe(8);
    expect(grid.endHour).toBe(20);
  });
});

describe("pickCurrentWeek", () => {
  const weeks = [
    { week: 1, monday: "2026-07-27" },
    { week: 2, monday: "2026-08-03" },
    { week: 3, monday: "2026-08-10" },
  ];
  it("picks the week containing the date", () => {
    expect(pickCurrentWeek(weeks, "2026-08-05")).toBe(2);
  });
  it("uses week 1 before the semester and the last week after it", () => {
    expect(pickCurrentWeek(weeks, "2026-01-01")).toBe(1);
    expect(pickCurrentWeek(weeks, "2027-01-01")).toBe(3);
  });
});

describe("the timetable page", () => {
  it("shows a moved session in the grid with a Moved tag", async () => {
    const html = await (await fetch(new URL("/?week=9", baseUrl))).text();
    expect(html).toContain("Monday 5 October is the ACT Labour Day public holiday");
    expect(html).toContain('class="tag"');
  });

  it("offers an undo after a move, and undo reverts it", async () => {
    const move = await post(
      "/api/exceptions",
      new URLSearchParams({ critGroupId: "2", week: "10", day: "Fri", startTime: "10:00", endTime: "11:00", room: "", reason: "undo probe" }),
    );
    const html = await (await fetch(new URL(move.headers.get("location") ?? "/", baseUrl))).text();
    expect(html).toContain("Undo");
    const id = html.match(/\/api\/exceptions\/(\d+)\/cancel/)?.[1];
    if (!id) throw new Error("no undo form after a move");
    await post(`/api/exceptions/${id}/cancel`, new URLSearchParams({ week: "10", group: "2" }));
    const after = await (await fetch(new URL("/?week=10", baseUrl))).text();
    expect(after).not.toContain("undo probe");
  });

  it("sends a rejected draft back with the error and the typed values", async () => {
    const res = await post(
      "/api/exceptions",
      new URLSearchParams({ critGroupId: "3", week: "7", day: "Wed", startTime: "10:00", endTime: "09:00", room: "", reason: "keep my typing" }),
    );
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("reason=keep+my+typing");
    const html = await (await fetch(new URL(location, baseUrl))).text();
    expect(html).toContain('value="keep my typing"');
  });
});

describe("drag-to-reschedule maths", () => {
  it("snaps a raw drop time to the nearest 15 minutes", () => {
    expect(snapMinutes(14 * 60 + 7)).toBe(14 * 60);
    expect(snapMinutes(14 * 60 + 8)).toBe(14 * 60 + 15);
  });

  it("formats minutes as a zero-padded 24-hour time", () => {
    expect(formatTime(9 * 60 + 5)).toBe("09:05");
    expect(formatTime(17 * 60)).toBe("17:00");
  });

  it("keeps a dragged session inside the visible day", () => {
    expect(clampStart(7 * 60, 90, 8 * 60, 18 * 60)).toBe(8 * 60);
    expect(clampStart(17 * 60, 90, 8 * 60, 18 * 60)).toBe(16 * 60 + 30);
  });
});

describe("the drag enhancement's markup", () => {
  it("ships the confirm dialog as a plain post form to the same endpoint", async () => {
    const html = await (await fetch(new URL("/?week=8", baseUrl))).text();
    expect(html).toMatch(/<dialog id="move-dialog"[^]*?<form method="post" action="\/api\/exceptions"/);
  });

  it("tags every session block with the data the drag needs", async () => {
    const html = await (await fetch(new URL("/?week=8", baseUrl))).text();
    expect(html).toContain('data-start="14:00"');
    expect(html).toContain('data-tutor="Ushini Attanayake"');
  });
});
