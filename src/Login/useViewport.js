// The viewport, as a number the hero and the picker can be sized from.
//
// The character art is an <img> whose width and height are written as
// attributes by <Figure> (so nothing shifts while it loads), which means its
// size has to be decided in JS — a CSS clamp() cannot reach it. This is the
// smallest hook that does that: read the size, re-read it on resize and on a
// visualViewport change, and let the two callers derive their own numbers.
//
// visualViewport matters here specifically because of the on-screen keyboard:
// on iOS it shrinks the visual viewport without firing a window `resize`, so
// without this the hero would keep its full height behind the keyboard.

import { useEffect, useLayoutEffect, useRef, useState } from "react";

// How much room a box actually has, measured.
//
// The hero is the second row of the aura's grid (`minmax(0, 1fr)`) inside a
// flex child whose basis is 0, so the row's height is decided entirely by what
// is left over after the panel — never by what is inside it. That makes this
// safe to feed straight back into the art's own height with no layout loop:
// the measurement cannot change the measurement.
//
// It is also the only thing that gets the keyboard case right. A vh-based
// guess sized the hero for the screen and then had the panel cover its face;
// this sizes it for the gap that is genuinely there.
export function useFitHeight() {
  const ref = useRef(null);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect?.height ?? 0;
      setHeight((prev) => (Math.abs(prev - h) < 1 ? prev : h));
    });
    ro.observe(el);
    setHeight(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, []);

  return [ref, height];
}

function read() {
  if (typeof window === "undefined") return { vw: 390, vh: 844 };
  return {
    vw: window.innerWidth || 390,
    vh: window.visualViewport?.height || window.innerHeight || 844,
  };
}

export function useViewport() {
  const [size, setSize] = useState(read);

  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setSize(read()));
    };
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener?.("resize", onResize);
    // One read after mount: a headless screenshot run sets the viewport after
    // the first paint often enough that the initial useState value is stale.
    onResize();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener?.("resize", onResize);
    };
  }, []);

  return size;
}

export default useViewport;
