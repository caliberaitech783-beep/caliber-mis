import { useRef } from "react";

// Owner, 19 Nov 2026: the column headings of every step table stay in view as well, right under the step heading, which
// itself stays under the top bar (report-step-sticky.css). Every line of a step stays on the page, as before.
//  - --step-head on the step: the height of its heading.
//  - A table that fits the width (data-head="page"): the boxes around it stop scrolling sideways (data-head-fits), so its
//    heading row can stay in view with the page itself.
//  - A wider table keeps its sideways scroll (data-head="shift"): the page cannot hold its heading row there, so the row
//    is moved down as the page scrolls (--head-shift), as far as the table's last line.
export const STEP_TABLE_BOXES = ".reports-detail-table, .ar-grid-wrap, .report-totals-scroll, .mp-category";

function boxFits(box) {
  // A box may show an upright scroll bar, which takes width the table would have once the box stops scrolling: that
  // width counts as room, or a table that fits would be held in the box for good.
  const style = getComputedStyle(box);
  const upright = Math.max(0, box.offsetWidth - box.clientWidth - (parseFloat(style.borderLeftWidth) || 0) - (parseFloat(style.borderRightWidth) || 0));
  return box.scrollWidth <= box.clientWidth + upright + 1;
}

function mark(node, name, value) {
  if (value === false) { if (node.hasAttribute(name)) node.removeAttribute(name); return; }
  const text = value === true ? "" : String(value);
  if (node.getAttribute(name) !== text) node.setAttribute(name, text);
}

const ownTables = (section) => [...section.querySelectorAll("table")].filter((table) => table.tHead && table.closest("[data-step-look]") === section);

export function placeStepTableHeads(section) {
  const head = section.querySelector(":scope > .reports-section-heading");
  section.style.setProperty("--step-head", (head ? Math.ceil(head.getBoundingClientRect().height) : 0) + "px");
  const watched = [];
  for (const table of ownTables(section)) {
    const boxes = [];
    for (let node = table.parentElement; node && node !== section; node = node.parentElement) if (node.matches(STEP_TABLE_BOXES)) boxes.push(node);
    const fits = boxes.map((box) => { const ok = boxFits(box); mark(box, "data-head-fits", ok); return ok; });
    mark(table, "data-head", fits.every(Boolean) ? "page" : "shift");
    watched.push(table, ...boxes);
  }
  return watched;
}

// Moves the heading row of each wide table (data-head="shift") to the line under the step heading.
export function shiftStepTableHeads(section) {
  const head = section.querySelector(":scope > .reports-section-heading");
  const line = head ? head.getBoundingClientRect().bottom : 0;
  for (const table of ownTables(section)) {
    if (table.getAttribute("data-head") !== "shift") continue;
    // A box with its own upright scroll already holds the row at its top (Batch Status on the Reports page).
    const box = table.parentElement?.closest(STEP_TABLE_BOXES);
    const scrollsUpright = box && box.scrollHeight > box.clientHeight + 1 && getComputedStyle(box).overflowY !== "visible";
    const rect = table.getBoundingClientRect();
    const room = rect.height - table.tHead.getBoundingClientRect().height - (table.tFoot ? table.tFoot.getBoundingClientRect().height : 0);
    const shift = scrollsUpright ? 0 : Math.round(Math.max(0, Math.min(line - rect.top, room)));
    const value = shift + "px";
    if (table.style.getPropertyValue("--head-shift") !== value) table.style.setProperty("--head-shift", value);
  }
}

// A ref for a step section. `also` is called with the same element (the step's own scroll-into-view). Only refs are
// used, so ReportSection's useState order stays as it was.
export function useStepTableHeads(enabled, also) {
  const alsoRef = useRef(also);
  alsoRef.current = also;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const stop = useRef(null);
  const attach = useRef(null);
  if (!attach.current) attach.current = (section) => {
    stop.current?.();
    stop.current = null;
    alsoRef.current?.(section);
    if (!section || !enabledRef.current || typeof window === "undefined" || typeof ResizeObserver === "undefined") return;
    const wide = window.matchMedia?.("(min-width: 761px)");
    const seen = new Set();
    let placing = 0, shifting = 0;
    const watch = new ResizeObserver(() => schedulePlace());
    const place = () => {
      placing = 0;
      const head = section.querySelector(":scope > .reports-section-heading");
      for (const node of [head, ...placeStepTableHeads(section)]) if (node && !seen.has(node)) { seen.add(node); watch.observe(node); }
      shift();
    };
    const shift = () => { shifting = 0; if (!wide || wide.matches) shiftStepTableHeads(section); };
    const schedulePlace = () => { if (!placing) placing = requestAnimationFrame(place); };
    const scheduleShift = () => { if (!shifting) shifting = requestAnimationFrame(shift); };
    // Rows and steps are drawn after the section: new tables are picked up as they appear.
    const grows = typeof MutationObserver === "undefined" ? null : new MutationObserver(schedulePlace);
    grows?.observe(section, { childList: true, subtree: true });
    watch.observe(section);
    window.addEventListener("resize", schedulePlace);
    // Capture: the page may scroll in a box of its own as well as in the window.
    window.addEventListener("scroll", scheduleShift, { capture: true, passive: true });
    place();
    stop.current = () => {
      watch.disconnect(); grows?.disconnect();
      window.removeEventListener("resize", schedulePlace);
      window.removeEventListener("scroll", scheduleShift, { capture: true });
      if (placing) cancelAnimationFrame(placing);
      if (shifting) cancelAnimationFrame(shifting);
    };
  };
  return attach.current;
}
