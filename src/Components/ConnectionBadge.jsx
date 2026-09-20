// The only thing on screen that says the connection is in trouble.
//
// It renders NOTHING while everything is fine, which is almost always. A badge
// that is visible all game is a badge nobody reads; this one appearing means
// something. In particular it stays hidden for the first ~1.5s of the very
// first connect, because a fresh page load is "connecting" for a few hundred
// milliseconds every single time and flashing "Connecting…" at that is noise.
//
// Both screens already carry `data-client=""` on their root (BoardScreen.jsx
// and ClientScreen.jsx), so every colour below comes from the [data-client]
// block in src/styles/tokens.css and flips with the OS theme for free.
//
// Mounted by the TV and by the phone themselves:
//   <ConnectionBadge conn={conn} variant="tv" />       big, readable across a room
//   <ConnectionBadge conn={conn} variant="phone" />    compact pill, 44px tap target
//
// `conn` is what useGameRoom returns (and what useRealtimeUpdates returns for
// screens that do not use useGameRoom): { status, since, reconnect }.

import { useEffect, useState } from "react";
import s from "./connectionBadge.module.css";

// How long the initial "connecting" is allowed to pass in silence.
const GRACE_MS = 1500;

const TEXT = {
  connecting: "Connecting…",
  reconnecting: "Reconnecting…",
  offline: "Offline — check Wi-Fi",
};

export default function ConnectionBadge({ conn, variant = "phone", className }) {
  const status = conn?.status;
  const since = conn?.since ?? 0;

  // Nothing changes when the grace window runs out -- no state, no event -- so
  // without this the badge would stay hidden until something else re-rendered
  // the screen. One timer, only while it matters.
  const [, bump] = useState(0);
  useEffect(() => {
    if (status !== "connecting") return undefined;
    const left = GRACE_MS - (Date.now() - since);
    if (left <= 0) return undefined;
    const t = setTimeout(() => bump((n) => n + 1), left);
    return () => clearTimeout(t);
  }, [status, since]);

  if (!conn || !status || status === "live") return null;
  if (status === "connecting" && Date.now() - since < GRACE_MS) return null;

  const tone = status === "offline" ? s.offline : s.working;

  return (
    <div
      // polite, not assertive: this must never cut across a screen reader
      // mid-sentence during a turn. It is a background condition, not an alert.
      role="status"
      aria-live="polite"
      data-conn={status}
      className={[s.badge, variant === "tv" ? s.tv : s.phone, tone, className]
        .filter(Boolean)
        .join(" ")}
    >
      <span className={s.dot} aria-hidden="true" />
      <span className={s.label}>{TEXT[status] ?? "Connection problem"}</span>
      <button type="button" className={s.btn} onClick={() => conn.reconnect?.()}>
        Reconnect
      </button>
    </div>
  );
}
