// The light / dark / system switch, for both screens (spec §10).
//
// There is exactly one piece of state in here — "light", "dark" or "system" —
// and three places it has to be true at once:
//
//   1. localStorage "monopoly.theme"   so it survives a refresh and a rejoin
//   2. <html data-theme="…">           so styles/tokens.css can see it
//   3. every mounted control            so the TV toggle and the phone's
//                                       segmented control never disagree
//
// (1) and (2) are deliberately the SAME shape: "system" is stored as the
// ABSENCE of the key and rendered as the ABSENCE of the attribute, because
// System is not a third palette — it is "no answer from me, ask the OS". The
// prefers-color-scheme media queries in tokens.css are then left completely
// alone and keep working exactly as they did before this file existed.
//
// (3) is why this is a module-level store read through useSyncExternalStore
// rather than a useState in a provider. The board and the client are separate
// routes and there is never more than one of each on screen, but the sheet's
// control and a future second control would otherwise each hold their own copy,
// and the one that did not do the writing would keep rendering the old choice.
//
// FIRST PAINT: index.html re-applies the attribute from localStorage in a
// blocking inline <script> in <head>, before any CSS is applied to anything, so
// a player who chose dark never gets a white flash on the way in. This module
// applies it again on the first subscribe, which is what covers the dev
// harnesses (they mount into their own pages) and anything that writes the key
// from outside.

import { useCallback, useSyncExternalStore } from "react";

// Same naming as the only other persisted preference in the app,
// src/Hooks/useSound.js's "monopoly.muted".
export const THEME_KEY = "monopoly.theme";

// The order the three-way control renders in: the two answers first, then
// "let someone else decide".
export const THEME_MODES = ["light", "dark", "system"];

export const THEME_LABELS = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

function normalise(value) {
  return value === "light" || value === "dark" ? value : "system";
}

// Every localStorage access in this file is wrapped: Safari in private mode
// throws on read as well as on write, and a theme preference is not worth
// taking the whole screen down for.
function readStored() {
  try {
    return normalise(localStorage.getItem(THEME_KEY));
  } catch {
    return "system";
  }
}

/** Write the choice onto <html>. "system" REMOVES the attribute — see above. */
export function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === "light" || mode === "dark") root.setAttribute("data-theme", mode);
  else root.removeAttribute("data-theme");
}

// The browser's own status bar / tab strip.
//
// All three screens install a <meta name="theme-color"> from the computed
// --ground of their own root and refresh it when the OS colour-scheme changes
// (useTvChrome, useClientChrome, useLoginChrome — three copies of the same
// twenty lines, none of them this file's to edit). A MANUAL flip is not an OS
// change, so none of them would hear it and the phone would keep a black status
// bar over a white sheet. Repainting the meta from here covers all three at
// once and is idempotent with what they do: same element, same source value.
//
// One frame late, so the new attribute has actually been applied and
// getComputedStyle returns the token's new value rather than its old one.
function repaintThemeColor() {
  if (typeof document === "undefined") return;
  requestAnimationFrame(() => {
    try {
      const meta = document.head.querySelector('meta[name="theme-color"]');
      if (!meta) return;
      // A mounted client/TV root is the authority when there is one; otherwise
      // the page is a plain :root page and --bg is its ground.
      const host = document.querySelector("[data-client]");
      const value = host
        ? getComputedStyle(host).getPropertyValue("--ground").trim()
        : getComputedStyle(document.documentElement)
            .getPropertyValue("--bg")
            .trim();
      if (value) meta.setAttribute("content", value);
    } catch {
      // nothing on screen depends on this
    }
  });
}

let current = readStored();
const listeners = new Set();

function emit() {
  for (const fn of listeners) fn();
}

/** Set the mode, persist it, paint it, and tell every mounted control. */
export function setTheme(mode) {
  const next = normalise(mode);
  if (next === current) {
    // Still re-apply: a control can be asked for the mode that is already
    // stored while the attribute has been lost (a harness remount, someone
    // poking at the DOM), and being idempotent is cheaper than being clever.
    applyTheme(next);
    return;
  }
  current = next;
  try {
    if (next === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, next);
  } catch {
    // no persistence this session; the attribute below still works
  }
  applyTheme(next);
  repaintThemeColor();
  emit();
}

function subscribe(onChange) {
  // The store is created before React mounts anything, so the attribute may be
  // whatever index.html left (or nothing at all, in a harness). Re-assert it
  // the moment something actually cares.
  applyTheme(current);
  listeners.add(onChange);

  // Another tab — or the same phone in a second window — changed the key.
  // `storage` only fires in OTHER documents, so this can never loop.
  const onStorage = (e) => {
    if (e.key !== null && e.key !== THEME_KEY) return;
    const next = readStored();
    if (next === current) return;
    current = next;
    applyTheme(next);
    repaintThemeColor();
    emit();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

const getSnapshot = () => current;

// The OS half of "System". Only used to tell a control WHICH way System is
// currently pointing ("System · Dark"); the painting itself is done by the
// media queries in tokens.css and never by this.
const prefersDark = () => {
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  } catch {
    return false;
  }
};

function subscribeOS(onChange) {
  const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
  mq?.addEventListener?.("change", onChange);
  return () => mq?.removeEventListener?.("change", onChange);
}

/**
 * `theme`     the stored choice: "light" | "dark" | "system"
 * `resolved`  what is actually on screen right now: "light" | "dark"
 * `setTheme`  set the choice
 * `cycle`     light → dark → system → light, for a single-button toggle
 */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const osDark = useSyncExternalStore(subscribeOS, prefersDark, () => false);
  const resolved = theme === "system" ? (osDark ? "dark" : "light") : theme;

  const cycle = useCallback(() => {
    setTheme(
      current === "light" ? "dark" : current === "dark" ? "system" : "light",
    );
  }, []);

  return { theme, resolved, setTheme, cycle };
}

export default useTheme;
