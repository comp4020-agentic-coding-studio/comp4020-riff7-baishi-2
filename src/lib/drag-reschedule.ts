// Drag a session block to a new day/time. Nothing is saved by the drag itself:
// on drop it fills the confirm dialog's ordinary <form method="post"> and asks
// for a reason, so validation and persistence stay on the server.

export const SNAP_MINUTES = 15;

export const snapMinutes = (minutes: number, step = SNAP_MINUTES): number => Math.round(minutes / step) * step;

export const formatTime = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

// Keep a session of `duration` minutes fully inside [lo, hi].
export function clampStart(start: number, duration: number, lo: number, hi: number): number {
  return Math.min(Math.max(start, lo), Math.max(lo, hi - duration));
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

const DRAG_THRESHOLD_PX = 6;

export function enableDragReschedule(): void {
  const grid = document.querySelector<HTMLElement>(".week-grid");
  const dialog = document.querySelector<HTMLDialogElement>("#move-dialog");
  const hint = document.getElementById("drag-hint");
  if (!grid || !dialog || typeof dialog.showModal !== "function") return;

  const wide = window.matchMedia("(min-width: 46rem)");
  const startHour = Number(grid.dataset.startHour);
  const endHour = Number(grid.dataset.endHour);
  const week = grid.dataset.week ?? "";
  const tracks = [...grid.querySelectorAll<HTMLElement>(".track")];
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const blocks = [...grid.querySelectorAll<HTMLElement>(".block")];

  const active = () => wide.matches;
  const sync = () => {
    for (const b of blocks) b.classList.toggle("draggable", active());
    if (hint) hint.hidden = !active();
  };
  wide.addEventListener("change", sync);
  sync();

  const ghost = document.createElement("div");
  ghost.className = "drop-ghost";
  ghost.setAttribute("aria-hidden", "true");
  const ghostLabel = document.createElement("span");
  ghost.append(ghostLabel);

  const form = dialog.querySelector<HTMLFormElement>("form")!;
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  const summary = dialog.querySelector<HTMLElement>("#move-summary")!;
  const clashNote = dialog.querySelector<HTMLElement>("#move-clash")!;
  const reason = dialog.querySelector<HTMLInputElement>("#move-reason")!;
  dialog.querySelector("#move-cancel")?.addEventListener("click", () => dialog.close());

  const dayIndexAt = (x: number): number => {
    let best = 0;
    let bestDistance = Infinity;
    tracks.forEach((track, i) => {
      const r = track.getBoundingClientRect();
      const distance = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      if (distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    });
    return best;
  };

  for (const block of blocks) {
    block.addEventListener("pointerdown", (down) => {
      if (!active() || down.button !== 0) return;
      const fromTrack = block.parentElement as HTMLElement;
      const trackRect = fromTrack.getBoundingClientRect();
      const span = (endHour - startHour) * 60;
      const start = toMinutes(block.dataset.start ?? "00:00");
      const end = toMinutes(block.dataset.end ?? "00:00");
      const duration = end - start;
      const originX = down.clientX;
      const originY = down.clientY;
      let dragging = false;
      let target = { day: block.dataset.day ?? "Mon", start };

      const move = (e: PointerEvent) => {
        const dx = e.clientX - originX;
        const dy = e.clientY - originY;
        if (!dragging) {
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
          dragging = true;
          block.setPointerCapture(e.pointerId);
          block.classList.add("dragging");
        }
        block.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.04) rotate(-1deg)`;

        const dayIndex = dayIndexAt(e.clientX);
        const rawStart = start + (dy / trackRect.height) * span;
        const snapped = clampStart(snapMinutes(rawStart), duration, startHour * 60, endHour * 60);
        target = { day: dayNames[dayIndex], start: snapped };

        const overTrack = tracks[dayIndex];
        if (ghost.parentElement !== overTrack) overTrack.append(ghost);
        ghost.style.top = `${((snapped - startHour * 60) / span) * 100}%`;
        ghost.style.height = `${(duration / span) * 100}%`;
        ghostLabel.textContent = `${target.day} ${formatTime(snapped)}–${formatTime(snapped + duration)}`;

        const clash = blocks.some(
          (other) =>
            other !== block &&
            other.dataset.day === target.day &&
            toMinutes(other.dataset.start ?? "00:00") < snapped + duration &&
            snapped < toMinutes(other.dataset.end ?? "00:00") &&
            (other.dataset.tutor === block.dataset.tutor || other.dataset.room === block.dataset.room),
        );
        ghost.classList.toggle("clash", clash);
      };

      const finish = (e: PointerEvent) => {
        block.removeEventListener("pointermove", move);
        block.removeEventListener("pointerup", finish);
        block.removeEventListener("pointercancel", finish);
        if (!dragging) return;

        block.releasePointerCapture(e.pointerId);
        block.classList.remove("dragging");
        block.style.transform = "";
        const wasClash = ghost.classList.contains("clash");
        ghost.remove();
        // The drag's own click would otherwise follow the block's link.
        const swallowClick = (c: Event) => c.preventDefault();
        block.addEventListener("click", swallowClick, { capture: true });
        setTimeout(() => block.removeEventListener("click", swallowClick, { capture: true }), 50);

        const unchanged = target.day === block.dataset.day && target.start === start;
        if (e.type === "pointercancel" || unchanged) return;

        const newEnd = target.start + duration;
        field("critGroupId").value = block.dataset.group ?? "";
        field("week").value = week;
        field("day").value = target.day;
        field("startTime").value = formatTime(target.start);
        field("endTime").value = formatTime(newEnd);
        field("room").value = block.dataset.room ?? "";
        summary.textContent = `${block.dataset.name}: ${block.dataset.day} ${block.dataset.start}–${block.dataset.end} → ${target.day} ${formatTime(target.start)}–${formatTime(newEnd)} (week ${week})`;
        clashNote.hidden = !wasClash;
        reason.value = "";
        dialog.showModal();
        reason.focus();
      };

      block.addEventListener("pointermove", move);
      block.addEventListener("pointerup", finish);
      block.addEventListener("pointercancel", finish);
    });
  }
}
