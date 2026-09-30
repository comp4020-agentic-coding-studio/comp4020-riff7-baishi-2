# You are riffing on someone else's prototype

This repo is a copy of [`comp4020-crit7-baishi`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-baishi) at
`05f2118f` --- baishi's crit agent's shipped prototype for `07-anu-system`.
The copy is yours; their repo is untouched and off limits.

**The brief is to take this somewhere it hasn't been.** Not to restart it, not
to polish it, and not to finish the agent's to-do list. Read how they directed
the agent, find the thing the prototype implies but doesn't do, and build
that. You have the session's half-hour, so pick something you can get live.

**Nothing here is marked.** No cutoff, no reflection, no `PROCESS.md` entry,
no crit sweep, no repo of your own on the line. That is the point --- the
interesting move is the one you wouldn't risk in your own graded repo.

**What you show at the share-back** is the live site plus
`git diff riff-start`. Push early and keep `main` green.

**The agent's own spec tests are `spec/crit-7.test.ts` and `spec/readme.test.ts`.** They encode the crit brief,
not yours, and they gate the deploy --- a red check means no live site to show
at the share-back. If your riff moves past that brief, change them or delete
them; keep `spec/invariants.test.ts` green, since that one is true of any good
site.

Everything below this line was written for that crit submission. The marks,
the cutoff, the private-repo phase, the weekly `start` skill and the
reflection are all done, and none of it governs what you do here. Read it for
how they worked, not for what you owe.

---

# Your harness

This file is yours, and it arrives empty on purpose. The rules you hold the
agent to are part of what gets marked, so they should be rules you decided on.

Nothing about the starter is recorded here. What the repo ships is explained
where it lives --- `fly.toml`, the `Dockerfile`, the CI workflow and
`spec/README.md` each say what they fix --- and the
[course website](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/)
publishes this deliverable's brief and spec. Read them before you plan or build;
what the agent needs to carry from any of it is your call.

## Rules for this deliverable

- **The schema is ground truth; seed data is real, not invented.** Every
  crit group, slot time, tutor name and week-9 exception seeded in
  `src/lib/db.ts` traces to the course website's own published
  `api/crit-groups.json` — fetched, not guessed, per the standing "never
  guess a URL" rule, and legitimate here because the course's own
  three-layer doctrine names `/api/*.json` as public truth other layers are
  meant to sync. Don't invent a group, tutor, or exception that isn't in
  that source.
- **Derive, don't duplicate.** A session's date is computed from `weeks.monday`
  and the day offset (`sessionDate` in `src/lib/db.ts`), never stored — the
  same reasoning the schema's own header comment already states for the
  rest of the tables.
- **Validate server-side, in the data layer, not the route handler.** Astro
  API routes stay thin: parse the form, call `addException`/`cancelException`,
  handle `ValidationError`. The rules themselves (weekday only, end after
  start, reason required, one exception per group per week) live in
  `src/lib/db.ts` so `spec/crit-7.test.ts` can assert them against behaviour,
  not markup.
- **The write path works without client JavaScript; JS only enhances it.**
  Reschedule and cancel are plain `<form method="post">`s with a 303
  redirect. Drag-to-reschedule (`src/lib/drag-reschedule.ts`) is
  progressive enhancement: it only pre-fills the confirm dialog's ordinary
  form, so the server still validates everything and the click-to-edit panel
  works with JS off. Any further client JS needs the same property.
- **The event bus is single-process and that's a stated limitation, not a
  bug to hide.** `src/lib/events.ts` only works because this app runs one
  Fly.io machine. If a future run adds a second machine, the live-sync
  design needs to change with it, not silently stop working.
- **Every new checkable behaviour gets a line in `spec/crit-7.test.ts`,
  in the same run that adds it.** Deferring test coverage to a later run is
  how a "should be true" quietly becomes untrue.
