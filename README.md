# Crit timetable

The ANU system this models is the one this agent group sits inside every week:
six crit groups, each with a tutor and a standing weekly slot, meeting through
a semester that has public holidays and a mid-semester break in it. The course
website publishes that roster as a hand-maintained
[`crit-groups.json`](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/api/crit-groups.json),
with a sparse `exceptions` array added by hand whenever a week's slot moves —
week 9 has exactly that: both of Ushini Attanayake's Monday groups, Shitao and
Bada, pushed off Monday 5 October, the ACT Labour Day public holiday, onto
Tuesday and Wednesday respectively. This app rebuilds that one mechanism as a
real, persisted, multi-user database instead of a JSON file someone edits by
hand: open a week's timetable, move a group's session for that one week, and
the change is a row in SQLite that every open tab learns about live.

The standing schedule (six groups, twelve teaching weeks, real tutor names and
slot times) and the two real week-9 exceptions are seeded verbatim from that
published JSON, so the app opens already showing the real state of the
course, not placeholder data. This repo began as a copy of another agent's
crit-roster prototype, which listed exceptions per group; this version turns
that list into a week-by-week timetable you can act on directly.

## What good looks like here

The core flow is rescheduling: pick a week, then either click a session and
fill in the side panel, or drag the session to its new day and time, and give
a reason. The timetable shows the session in its new place for that one week,
marked as moved, with an Undo that falls back to the standing slot. That flow
has to survive a reload (it's a database row, not client state) and has to
tell every other open tab without anyone refreshing by hand, because the real
system this models is inherently multi-tutor: more than one person can have
the timetable open at once, and a change one of them makes is exactly the kind
of thing the others need to know about.

Decisions this run made and why:

- **Validation lives server-side, not just in the form.** `<input required>`
  and `type="time"` catch the easy cases, but the actual rules — the day has
  to be a weekday, the end time has to be after the start time, a reason is
  mandatory — are enforced in `addException` (`src/lib/db.ts`) and re-checked
  by `spec/crit-7.test.ts`, because a form's client-side constraints are a
  convenience, not the contract. The side panel and the drag dialog post to
  the same endpoint, so both get the same rules.
- **The write path works without client JavaScript; JavaScript only enhances it.**
  Reschedule and undo are plain HTML forms POSTing to Astro API routes with a
  303 redirect back to the same week. Dragging (`src/lib/drag-reschedule.ts`)
  only pre-fills the confirm dialog's ordinary form, so the click-to-edit
  panel still works with JavaScript off. A scheduling timetable doesn't need
  optimistic UI or partial re-renders.
- **Dragging never saves by itself.** A drop opens a dialog that shows old and
  new time and asks for a reason before anything is written. Times snap to 15
  minutes, a session can't be dragged outside the visible day, and a landing
  spot that would overlap a session with the same tutor or room turns red
  first. Cancelling, or dropping back where it started, changes nothing.
- **Other tabs are told, not reloaded.** A change made in one tab shows a
  small banner in the others with a link to refresh, instead of an automatic
  `location.reload()`. Found by driving two real tabs: an automatic reload
  silently wiped a half-typed reschedule. A banner needs no dirty-tracking
  and can't lose a draft; `src/lib/live-reload.ts` keeps only the reconnect
  gate, so a tab that missed a change while its connection was down is told
  too.
- **Live sync is a single in-process event bus**, valid because this app runs
  on exactly one Fly.io machine (`fly.toml` pins `min-machines-running` /
  standalone HA off). A real multi-machine deployment would need a shared
  pub/sub layer instead — noted here because it's the kind of thing that's
  easy to get away with in a demo and wrong to ship without noticing.
- **The timetable layout is a pure function of the data.** `src/lib/schedule.ts`
  turns the roster into a week grid — dates derived from each week's Monday,
  overlapping sessions placed in side-by-side lanes, clashes flagged — with no
  database access, so its behaviour is tested directly rather than through
  markup.
- **Rescheduling twice in the same week replaces the existing exception**
  rather than stacking two, matching the real spreadsheet-style workflow this
  models: a week has at most one "what actually happened" entry.
- **What's out of scope**: there's no login and no per-tutor ownership of a
  reschedule — anyone with the URL can reschedule any group's session, which
  matches the real system (the JSON file is edited by whoever notices a
  holiday clash first) but wouldn't be right for a system with actual stakes.

`spec/crit-7.test.ts` enforces the reschedule/validation/undo contracts
described above against the built server, plus the grid layout and the drag
maths in isolation, and the shipped invariants (`spec/invariants.test.ts`)
check every route for a landmark nav, one `h1`, alt text and a clean axe-core
pass. Prose judgements — whether the copy reads well, whether the seeded data
is a fair sample of the real system — are mine, not the test suite's.
