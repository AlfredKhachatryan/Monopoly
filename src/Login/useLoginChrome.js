// Browser chrome, for as long as the login screen is on screen.
//
// Same idea (and the same restore-on-unmount discipline) as useClientChrome in
// src/Client/ClientScreen.jsx, written out here rather than imported: the
// controller's version also toggles the `client-active` body class from
// styles/tokens.css, which belongs to the controller and would tie the two
// screens together for nothing.
//
// index.html declares one dark theme-color, because the Board is a dark page.
// This screen is not: while it is mounted the meta takes the computed --ground
// of the login root (and follows an OS colour-scheme change), and <body> is
// painted the same colour inline — otherwise main.css's dark purple flashes
// under an iOS overscroll bounce and around the 440px column on a desktop.
// Everything is put back exactly as it was on unmount.

import { useEffect } from "react";

export function useLoginChrome(rootRef) {
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;

    const head = document.head;
    const previous = Array.from(head.querySelectorAll('meta[name="theme-color"]')).map((node) => ({
      node,
      parent: node.parentNode,
      next: node.nextSibling,
    }));
    previous.forEach(({ node }) => node.remove());

    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    head.appendChild(meta);

    // The inline value, not the computed one: restoring a computed colour
    // would leave an inline override behind on a body that had none.
    const previousBodyBg = document.body.style.backgroundColor;

    const paint = () => {
      const ground = getComputedStyle(el).getPropertyValue("--ground").trim();
      if (!ground) return;
      meta.setAttribute("content", ground);
      document.body.style.backgroundColor = ground;
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
      document.body.style.backgroundColor = previousBodyBg;
    };
  }, [rootRef]);
}

export default useLoginChrome;
