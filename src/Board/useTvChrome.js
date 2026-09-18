// Browser chrome for as long as the TV board is on screen.
//
// Same job as useClientChrome in src/Client/ClientScreen.jsx, and deliberately
// the same shape — but the TV is its own page and must not reach into the
// client's files. index.html declares one dark theme-color for the old dark
// Board and for Login; this board is a --ground page that follows the OS, so
// while it is mounted:
//
//   - <meta name="theme-color"> takes the computed --ground of the TV root and
//     follows a colour-scheme change,
//   - <body> gets `tv-active`, which tv.module.css paints the same --ground in
//     both themes (main.css otherwise paints it #191528, which shows as a band
//     round the letterbox on any browser that rubber-bands).
//
// Everything is put back on unmount, including the meta tags that were removed,
// in their original places.

import { useEffect } from "react";

export function useTvChrome(rootRef) {
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;

    const head = document.head;
    const previous = Array.from(head.querySelectorAll('meta[name="theme-color"]')).map(
      (node) => ({ node, parent: node.parentNode, next: node.nextSibling }),
    );
    previous.forEach(({ node }) => node.remove());

    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    head.appendChild(meta);
    document.body.classList.add("tv-active");

    const paint = () => {
      const ground = getComputedStyle(el).getPropertyValue("--ground").trim();
      if (ground) meta.setAttribute("content", ground);
    };
    paint();

    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    // one frame late, so the new token values have been applied
    const onScheme = () => requestAnimationFrame(paint);
    mq?.addEventListener?.("change", onScheme);

    return () => {
      mq?.removeEventListener?.("change", onScheme);
      meta.remove();
      previous.forEach(({ node, parent, next }) => parent?.insertBefore(node, next));
      document.body.classList.remove("tv-active");
    };
  }, [rootRef]);
}

export default useTvChrome;
