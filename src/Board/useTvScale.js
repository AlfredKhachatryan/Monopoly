// The TV is authored once, at 1920x1080, and scaled to whatever the screen is.
//
// Every size in tv.module.css (and in TvCenter / TvSide) is a plain pixel value
// in that space — no clamp(), no vw, no media queries — and this hook is the
// one place that knows about the real window. s = min(w/1920, h/1080), applied
// as a transform on .screen, so a 4K panel gets s = 2 and a laptop gets s < 1
// with identical layout and identical proportions.
//
// It is deliberately NOT capped at 1: on a real TV the board has to fill the
// screen.

import { useEffect, useState } from "react";

export const TV_W = 1920;
export const TV_H = 1080;

function fit() {
  if (typeof window === "undefined") return 1;
  const w = window.innerWidth || TV_W;
  const h = window.innerHeight || TV_H;
  const s = Math.min(w / TV_W, h / TV_H);
  return s > 0 && Number.isFinite(s) ? s : 1;
}

export function useTvScale() {
  const [scale, setScale] = useState(fit);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setScale((prev) => {
        const next = fit();
        // Float noise on a resize drag would otherwise re-render every frame
        // for a change nobody can see.
        return Math.abs(next - prev) < 0.0001 ? prev : next;
      });
    };
    const onResize = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    // A TV browser can change the visual viewport (a soft keyboard, a system
    // bar) without firing `resize` on window.
    window.visualViewport?.addEventListener?.("resize", onResize);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.visualViewport?.removeEventListener?.("resize", onResize);
    };
  }, []);

  return scale;
}

export default useTvScale;
