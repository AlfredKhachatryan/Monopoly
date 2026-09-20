// Connection state machine, shared by the real Supabase module
// (src/Hooks/supabase.jsx) and the offline mock (src/dev/mockSupabase.js).
//
// Nothing in here knows about Supabase. It is handed a `connect()` that opens
// one subscription and returns a teardown function, and it takes care of the
// part that is the same either way: what the status is called, when to give up
// on the transport and rebuild it, when to stop trying, and when to ask the
// caller to refetch.
//
// WHY A REFETCH IS THE ACTUAL FEATURE
// -----------------------------------
// Realtime does not replay. A phone that sleeps for a minute does not get the
// events it missed when it wakes; the socket either survived (and delivered
// nothing while the tab was frozen) or it died and a fresh one starts from
// "now". Either way the phone is holding a stale row and looks frozen to its
// owner. So every path back from being away ends in one refetch of the room:
//
//   * the channel reaching SUBSCRIBED again after a drop
//   * the tab becoming visible
//   * `pageshow` (iOS back/forward cache restore -- no visibilitychange fires)
//   * the browser reporting `online` again
//   * window focus
//   * a ~20s heartbeat while visible, for a socket that died silently
//
// Those first four all fire within a few milliseconds of each other when a
// phone unlocks, so the refetch is leading-edge debounced: the first one runs,
// the rest inside the cooldown are dropped.
//
// STATUS
// ------
//   connecting    first subscribe of this room has not landed yet
//   live          channel is SUBSCRIBED
//   reconnecting  channel errored / timed out / closed, and we are online
//   offline       navigator.onLine is false
//
// NOT FIGHTING supabase-js
// ------------------------
// @supabase/realtime-js already retries on its own, at two levels: the socket
// has a reconnectTimer, and each channel has a rejoinTimer that re-joins once
// the socket is back. If we tore the channel down the instant we saw
// CHANNEL_ERROR we would be racing that, and every race would leave a second
// channel on the same topic behind.
//
// So this is a WATCHDOG, not a competing retry loop. On an error we only start
// a clock. If supabase-js fixes itself before the clock runs out (it usually
// does, in about a second) we cancel and forget it. Only when the clock runs
// out with the channel still not SUBSCRIBED do we take over: tear the channel
// down, build a new one, and double the clock. That guarantees there is never
// more than one live channel per room and still puts a hard ceiling on how long
// a stuck channel can stay stuck.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// 1s, 2s, 4s, 8s, then 15s forever. Each value is how long supabase-js gets to
// heal itself before we rebuild the channel underneath it.
export const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];

// How long a freshly opened channel gets to say anything at all before we
// assume the subscribe itself is wedged and rebuild. Deliberately longer than
// realtime-js's own 10s join timeout (DEFAULT_TIMEOUT), which reports
// TIMED_OUT through the status callback and puts us on the backoff path
// properly -- this only covers a subscribe that never calls back at all.
const CONNECT_GRACE_MS = 12000;

// A phone that unlocks fires visibilitychange, focus, pageshow and sometimes
// online all at once. One refetch is enough for all of them.
const RESYNC_COOLDOWN_MS = 400;

// Cheap single-row select. Twenty seconds is often enough to catch a socket
// that went quiet without telling anyone, and rare enough that six phones on
// home Wi-Fi add up to one read every ~3s across the whole table.
export const HEARTBEAT_MS = 20000;

const now = () => Date.now();

// ---------------------------------------------------------------------------
// Dev-only inspection hook.
//
// `import.meta.env.DEV` is statically false in `npm run build`, so none of this
// reaches the bundle the phones load (checked: grep dist/assets/*.js for
// __conn after a build and there are no hits). It exists for two readers:
// the headless reconnect check, and whoever is standing next to a misbehaving
// phone with a laptop -- `__conn()` in the console of a `npm run dev` page
// answers "is this thing connected, and when did it last resync".
// ---------------------------------------------------------------------------
const DEV = typeof import.meta !== "undefined" && !!import.meta.env?.DEV;
const live = new Set();

if (DEV && typeof window !== "undefined") {
  window.__conn = () =>
    [...live].map((c) => ({
      key: c.key,
      status: c.status,
      since: c.since,
      attempt: c.attempt,
      resyncs: c.resyncs,
      lastResync: c.lastResync,
      // `__conn()[0].reconnect()` from the console does exactly what the
      // Reconnect button does, without needing the button on screen.
      reconnect: () => c.reconnect?.(),
    }));
}

const isOnline = () =>
  typeof navigator === "undefined" || navigator.onLine !== false;

const isHidden = () =>
  typeof document !== "undefined" && document.visibilityState === "hidden";

/**
 * True for "the request never reached the server", false for "the server
 * answered and said no".
 *
 * supabase-js turns a failed fetch into a PostgrestError with status 0, an
 * empty `code` and a message prefixed by the DOMException name -- typically
 * "TypeError: Failed to fetch", or "AbortError: ..." on a timeout. A rule
 * rejection from the game_action RPC comes back with an HTTP status (400) and
 * a Postgres error code (P0001 for a RAISE EXCEPTION), which is the signal
 * that the server thought about it and refused.
 */
export function isNetworkError(error, status) {
  if (!error) return false;
  if (status === 0) return true;
  if (typeof status === "number" && status >= 400) return false;
  if (!isOnline()) return true;
  const code = error.code ?? "";
  const message = String(error.message ?? "");
  if (code === "" && /^(TypeError|FetchError|AbortError|NetworkError)\b/.test(message)) {
    return true;
  }
  // Fetch failures surface under a handful of browser-specific wordings.
  return /failed to fetch|networkerror|network request failed|load failed|timeout/i.test(
    message,
  );
}

/**
 * Drives one subscription and reports its health.
 *
 * @param key       room id; falsy means "nothing to connect to"
 * @param connect   ({ onStatus }) => teardown. `onStatus` is called with the
 *                  raw channel status strings ("SUBSCRIBED", "CHANNEL_ERROR",
 *                  "TIMED_OUT", "CLOSED"). Must be safe to call repeatedly.
 * @param onResync  () => void, called when the caller should refetch the row.
 *                  Debounced. Optional -- a caller with nothing to refetch
 *                  (the Login screen, the figure picker) just omits it.
 *
 * @returns { status, since, reconnect }
 */
export function useRealtimeConnection(key, connect, onResync) {
  const connectRef = useRef(connect);
  connectRef.current = connect;
  const resyncRef = useRef(onResync);
  resyncRef.current = onResync;

  const [state, setState] = useState(() => ({
    status: isOnline() ? "connecting" : "offline",
    since: now(),
  }));

  // The effect below installs its imperative handles here so the stable
  // `reconnect` callback we hand out can reach them.
  const apiRef = useRef(null);

  useEffect(() => {
    if (!key) return undefined;

    // ---- scoped to this room, torn down with it --------------------------
    let dead = false; // this effect has been cleaned up
    let generation = 0; // bumped on every teardown; stale callbacks check it
    let attempt = 0; // index into BACKOFF_MS
    let teardown = null; // undo of the current connect()
    let watchdog = null; // setTimeout handle
    let heartbeat = null; // setInterval handle
    let subscribedOnce = false; // has this room ever been SUBSCRIBED?
    let lastResync = 0; // leading-edge debounce stamp
    let status = isOnline() ? "connecting" : "offline";

    setState({ status, since: now() });

    // Dev-only mirror (see the top of this file). `probe` is the same object
    // for the life of this room so window.__conn() reads current values.
    const probe = DEV
      ? { key, status, since: now(), attempt: 0, resyncs: 0, lastResync: null }
      : null;
    if (probe) live.add(probe);

    const setStatus = (next) => {
      if (dead || status === next) return;
      status = next;
      const at = now();
      if (probe) {
        probe.status = next;
        probe.since = at;
        probe.attempt = attempt;
      }
      setState({ status: next, since: at });
    };

    const resync = (reason, { force = false } = {}) => {
      if (dead || !resyncRef.current) return;
      const t = now();
      if (!force && t - lastResync < RESYNC_COOLDOWN_MS) return;
      lastResync = t;
      if (probe) {
        probe.resyncs += 1;
        probe.lastResync = reason;
      }
      try {
        resyncRef.current(reason);
      } catch {
        /* a refetch that throws must not take the connection down with it */
      }
    };

    const clearWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = null;
    };

    // Give supabase-js `wait` ms to recover on its own; if it has not by then,
    // rebuild the channel ourselves.
    const armWatchdog = (ms, force = false) => {
      clearWatchdog();
      // Paused while the tab is hidden or the device is offline: retrying into
      // a locked phone burns battery and inflates `attempt` for no reason.
      // `resume()` restarts it the moment either comes back.
      if (!force && (isHidden() || !isOnline())) return;
      const wait = ms ?? BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
      watchdog = setTimeout(() => {
        watchdog = null;
        if (dead || status === "live") return;
        attempt += 1;
        rebuild();
      }, wait);
    };

    const closeChannel = () => {
      generation += 1; // anything the old channel still says is now ignored
      const undo = teardown;
      teardown = null;
      if (!undo) return;
      try {
        undo();
      } catch {
        /* removeChannel on a dead socket can reject; nothing to do about it */
      }
    };

    const openChannel = () => {
      const mine = generation;
      try {
        teardown = connectRef.current({
          onStatus: (raw) => {
            if (dead || mine !== generation) return; // a channel we abandoned
            handleStatus(raw);
          },
        });
      } catch {
        teardown = null;
        setStatus("reconnecting");
        armWatchdog();
      }
    };
    // One channel per room, always: close before open, never the other way.
    //
    // `force` is the Reconnect button. navigator.onLine is a link-layer guess
    // and it is wrong often enough (captive portals, a phone that has joined
    // the Wi-Fi but not finished DHCP) that a button which refuses to try
    // because the browser said "offline" is a button that looks broken. So a
    // forced rebuild always gets one honest attempt; if it goes nowhere the
    // watchdog settles back to offline on its own.
    const rebuild = (force = false) => {
      clearWatchdog();
      closeChannel();
      if (!force && !isOnline()) {
        setStatus("offline");
        return;
      }
      setStatus(subscribedOnce ? "reconnecting" : "connecting");
      openChannel();
      armWatchdog(CONNECT_GRACE_MS, force); // a subscribe that never answers
    };

    const handleStatus = (raw) => {
      if (raw === "SUBSCRIBED") {
        clearWatchdog();
        attempt = 0;
        setStatus("live");
        // Only AFTER the first. The first SUBSCRIBED happens alongside the
        // caller's own initial fetch; refetching there would just be the same
        // row twice. Every later one means the socket was away and missed
        // whatever happened while it was.
        if (subscribedOnce) resync("resubscribed", { force: true });
        subscribedOnce = true;
        return;
      }
      if (raw !== "CHANNEL_ERROR" && raw !== "TIMED_OUT" && raw !== "CLOSED") {
        return;
      }
      if (!isOnline()) {
        clearWatchdog();
        setStatus("offline");
        return;
      }
      setStatus(subscribedOnce ? "reconnecting" : "connecting");
      armWatchdog();
    };

    // Coming back from anywhere: unlocked phone, re-focused tab, Wi-Fi back,
    // bfcache restore. Always resync; rebuild too if we are not live.
    const resume = (reason) => {
      if (dead) return;
      if (!isOnline()) {
        clearWatchdog();
        setStatus("offline");
        return;
      }
      if (status === "offline") setStatus(subscribedOnce ? "reconnecting" : "connecting");
      if (status !== "live") {
        attempt = 0; // a human is watching now; retry immediately, not in 15s
        rebuild();
      }
      resync(reason);
    };

    const onVisibility = () => {
      if (isHidden()) return;
      resume("visible");
    };
    const onPageShow = () => resume("pageshow");
    const onFocus = () => {
      if (isHidden()) return;
      resume("focus");
    };
    const onOnline = () => resume("online");
    const onOffline = () => {
      clearWatchdog();
      setStatus("offline");
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("pageshow", onPageShow);
      window.addEventListener("focus", onFocus);
      window.addEventListener("online", onOnline);
      window.addEventListener("offline", onOffline);
    }

    // Safety net for a socket that is dead but still says SUBSCRIBED: no
    // status ever changes, no event ever arrives, and nothing above would
    // notice. One cheap row read every 20s does.
    heartbeat = setInterval(() => {
      if (dead || isHidden() || !isOnline()) return;
      resync("heartbeat", { force: true });
    }, HEARTBEAT_MS);

    apiRef.current = {
      // Hard reset: drop the channel, build a fresh one, refetch now, and
      // forget the backoff. This is the "Reconnect" button.
      reconnect() {
        if (dead) return;
        attempt = 0;
        rebuild(true);
        resync("manual", { force: true });
      },
      resyncNow(reason) {
        resync(reason ?? "caller", { force: true });
      },
    };
    if (probe) probe.reconnect = apiRef.current.reconnect;

    openChannel();
    armWatchdog(CONNECT_GRACE_MS);

    return () => {
      dead = true;
      apiRef.current = null;
      if (probe) live.delete(probe);
      clearWatchdog();
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      // StrictMode mounts, unmounts and mounts again. `closeChannel` bumps the
      // generation first, so the discarded channel's CLOSED callback (which
      // supabase-js fires during unsubscribe) cannot be mistaken for a real
      // drop and trigger a reconnect of the channel that replaced it.
      closeChannel();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("pageshow", onPageShow);
        window.removeEventListener("focus", onFocus);
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
      }
    };
  }, [key]);

  const reconnect = useCallback(() => {
    apiRef.current?.reconnect();
  }, []);

  const resyncNow = useCallback((reason) => {
    apiRef.current?.resyncNow(reason);
  }, []);

  return useMemo(
    () => ({ status: state.status, since: state.since, reconnect, resyncNow }),
    [state.status, state.since, reconnect, resyncNow],
  );
}
