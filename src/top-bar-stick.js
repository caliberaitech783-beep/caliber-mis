import { useRef } from "react";

// Owner, 19 Nov 2026: every report step heading stays in view under the app's top bar. The bar grows to two lines on
// narrow screens, so its bottom edge is measured, not assumed, and written once on the page as --mis-top-stick for the
// step headings (report-step-sticky.css). Nothing is written while the bar is not pinned, so headings then stick at 0.
export function topBarBottom(bar, view = window) {
  if (!bar) return 0;
  const style = view.getComputedStyle(bar);
  if (!["sticky", "fixed"].includes(style.position)) return 0;
  return Math.max(0, Math.ceil(bar.getBoundingClientRect().height + (parseFloat(style.top) || 0)));
}

// A ref for the top bar: pass it as ref={...} on the bar itself. Only refs are used, so the calling screen's useState
// order is left as it was.
export function useTopBarStick() {
  const stop = useRef(null);
  const attach = useRef(null);
  if (!attach.current) attach.current = (bar) => {
    stop.current?.();
    stop.current = null;
    if (!bar || typeof window === "undefined") return;
    const root = document.documentElement;
    const place = () => root.style.setProperty("--mis-top-stick", topBarBottom(bar) + "px");
    const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    watch?.observe(bar);
    window.addEventListener("resize", place);
    place();
    stop.current = () => { watch?.disconnect(); window.removeEventListener("resize", place); };
  };
  return attach.current;
}
