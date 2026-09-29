// Pure view-model for the week grid: no database, no I/O, so it can be unit
// tested directly. db.ts feeds it the roster; index.astro renders what it returns.

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;
export type Day = (typeof DAYS)[number];

// The real calendar date a (week, day) pair falls on, derived from the
// week's Monday rather than stored.
export function sessionDate(monday: string, day: string): string {
  const date = new Date(`${monday}T00:00:00Z`);
  const offset = DAYS.indexOf(day as Day);
  date.setUTCDate(date.getUTCDate() + Math.max(offset, 0));
  return date.toISOString().slice(0, 10);
}

export const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export type RosterSession = {
  week: number;
  day: string;
  startTime: string;
  endTime: string;
  room: string;
  reason: string | null;
  exceptionId: number | null;
};

export type RosterInput = {
  id: number;
  agent: string;
  name: string;
  tutorName: string;
  day: string;
  startTime: string;
  endTime: string;
  room: string;
  sessions: RosterSession[];
};

export type GridSession = {
  groupId: number;
  agent: string;
  name: string;
  tutorName: string;
  tutorIndex: number;
  day: string;
  startTime: string;
  endTime: string;
  room: string;
  reason: string | null;
  exceptionId: number | null;
  standing: { day: string; startTime: string; endTime: string; room: string };
  clash: boolean;
  lane: number;
  lanes: number;
  top: number;
  height: number;
};

export type GridDay = { day: Day; date: string; sessions: GridSession[] };

export type WeekGrid = {
  week: number;
  days: GridDay[];
  startHour: number;
  endHour: number;
  hours: number[];
};

const overlaps = (a: { startTime: string; endTime: string }, b: { startTime: string; endTime: string }) =>
  toMinutes(a.startTime) < toMinutes(b.endTime) && toMinutes(b.startTime) < toMinutes(a.endTime);

export function buildWeekGrid(roster: RosterInput[], week: number, monday: string): WeekGrid {
  const tutors = [...new Set(roster.map((g) => g.tutorName))].sort();

  const all: GridSession[] = [];
  for (const group of roster) {
    const session = group.sessions.find((s) => s.week === week);
    if (!session) continue;
    all.push({
      groupId: group.id,
      agent: group.agent,
      name: group.name,
      tutorName: group.tutorName,
      tutorIndex: tutors.indexOf(group.tutorName),
      day: session.day,
      startTime: session.startTime,
      endTime: session.endTime,
      room: session.room,
      reason: session.reason,
      exceptionId: session.exceptionId,
      standing: { day: group.day, startTime: group.startTime, endTime: group.endTime, room: group.room },
      clash: false,
      lane: 0,
      lanes: 1,
      top: 0,
      height: 0,
    });
  }

  // A clash is two sessions the same day that overlap in time and share a
  // tutor or a room -- exactly what a hand-edited reschedule can create.
  for (const a of all) {
    a.clash = all.some((b) => b !== a && b.day === a.day && overlaps(a, b) && (b.tutorName === a.tutorName || b.room === a.room));
  }

  const starts = all.map((s) => toMinutes(s.startTime));
  const ends = all.map((s) => toMinutes(s.endTime));
  const startHour = Math.min(8, ...starts.map((m) => Math.floor(m / 60)));
  const endHour = Math.max(18, ...ends.map((m) => Math.ceil(m / 60)));
  const span = (endHour - startHour) * 60;

  const days: GridDay[] = DAYS.map((day) => {
    const sessions = all.filter((s) => s.day === day).sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
    // Lanes are shared only within a cluster of mutually-overlapping
    // sessions, so a lone session keeps the full column width.
    let laneEnds: number[] = [];
    let cluster: GridSession[] = [];
    const closeCluster = () => {
      for (const s of cluster) s.lanes = Math.max(laneEnds.length, 1);
      laneEnds = [];
      cluster = [];
    };
    for (const s of sessions) {
      const start = toMinutes(s.startTime);
      if (laneEnds.length > 0 && Math.max(...laneEnds) <= start) closeCluster();
      let lane = laneEnds.findIndex((end) => end <= start);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = toMinutes(s.endTime);
      s.lane = lane;
      s.top = ((start - startHour * 60) / span) * 100;
      s.height = ((toMinutes(s.endTime) - start) / span) * 100;
      cluster.push(s);
    }
    closeCluster();
    return { day, date: sessionDate(monday, day), sessions };
  });

  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  return { week, days, startHour, endHour, hours };
}

// The teaching week containing `today`; before the semester starts, week 1;
// after it ends, the last week.
export function pickCurrentWeek(weeks: { week: number; monday: string }[], today: string): number {
  const sorted = [...weeks].sort((a, b) => a.monday.localeCompare(b.monday));
  let current = sorted[0]?.week ?? 1;
  for (const w of sorted) if (w.monday <= today) current = w.week;
  return current;
}
