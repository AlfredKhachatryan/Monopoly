import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import { BACKOFF_MS, isNetworkError, useRealtimeConnection } from "./connection";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill it in."
  );
}

// Realtime options. Every one of these is checked against the installed
// @supabase/realtime-js 2.10.2 (node_modules/@supabase/realtime-js/dist/module/
// RealtimeClient.d.ts lists the whole accepted option set) -- nothing here is
// assumed from the docs of a newer version.
//
//   heartbeatIntervalMs  default 30000. The socket pings on this interval and,
//                        if the previous ping was never answered, closes
//                        itself and reconnects. That is the ONLY thing that
//                        notices a socket which died without a close frame --
//                        exactly what a phone coming off a locked screen or a
//                        Wi-Fi blip leaves behind. At the default it can take
//                        60s to spot; at 15s it takes 30s. Six phones pinging
//                        every 15s is nothing.
//   reconnectAfterMs     default [1000, 2000, 5000, 10000] then 10000. Matched
//                        to the watchdog schedule in ./connection.js so the
//                        library's own socket retry and our channel watchdog
//                        step in time with each other instead of interleaving.
//
// NOT set: `worker: true`. The Web Worker heartbeat (which keeps pings going
// in a throttled background tab) does not exist in 2.10.2 -- grep the package
// for "worker" and there is not one hit. It landed in a later realtime-js.
// Passing it here would be silently ignored and would read like protection we
// do not have. Backgrounded tabs are covered by the visibility resync instead.
const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: {
    heartbeatIntervalMs: 15000,
    reconnectAfterMs: (tries) => BACKOFF_MS[tries - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1],
  },
});

// Dev-only handle for the headless connection checks: proves there is exactly
// one channel per room after a drop/reconnect cycle. `import.meta.env.DEV` is
// statically false in `npm run build`, so this whole block is dropped.
if (import.meta.env.DEV && typeof window !== "undefined") {
  window.__realtimeChannels = () => supabase.getChannels().map((c) => c.topic);
}

const useFetch = (uuid) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  // Refetch ordering, same idea as useGameRoom's: a ticket taken when the read
  // STARTS, so a slow reply cannot overwrite a fast one that started later.
  const ticket = useRef(0);
  const newestSettled = useRef(0);

  // Read the room again, on demand. Screens that use this hook rather than
  // useGameRoom (the Board, the Login page) have no other way to catch up on
  // what Realtime missed while they were away, so pass this straight to
  // useRealtimeUpdates as its third argument:
  //
  //   const { data, refetch } = useFetch(uuid);
  //   const conn = useRealtimeUpdates(uuid, handleInserts, refetch);
  //
  // and every resync trigger -- resubscribe, visible, pageshow, online, focus,
  // heartbeat -- repairs the screen. Without it the screen stays stale until
  // the next action anybody takes happens to arrive.
  const refetch = useCallback(async () => {
    if (!uuid) return;
    const mine = ++ticket.current;
    const { data: row, error: err } = await fetchRoom(uuid);
    if (mine <= newestSettled.current) return; // an older read, ignore it
    newestSettled.current = mine;
    // A network failure is not worth shouting about here: the connection badge
    // is already saying the same thing, and the next resync will try again.
    if (err) {
      if (!err.network) setError(err.message);
      return;
    }
    setError(null);
    setData(row);
  }, [uuid]);

  useEffect(() => {
    if (!uuid) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    ticket.current = 0;
    newestSettled.current = 0;

    const fetchData = async () => {
      const mine = ++ticket.current;
      try {
        setLoading(true);
        setError(null);
        let { data: dataBack, error } = await supabase
          .from("test")
          .select("*")
          .eq("uuid", uuid);

        if (error) throw error;

        if (!cancelled && mine > newestSettled.current) {
          newestSettled.current = mine;
          setData(dataBack[0] ? dataBack[0] : null);
        }
      } catch (error) {
        if (!cancelled) setError(error.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [uuid]);
  return { data, error, loading, refetch };
};

// One-shot read of a room. useFetch above is the hook version for a first
// paint; this is for refetching on demand (waking from sleep, reconnecting).
const fetchRoom = async (uuid) => {
  if (!uuid) return { data: null, error: null };
  const { data, error, status } = await supabase
    .from("test")
    .select("*")
    .eq("uuid", uuid)
    .maybeSingle();
  if (error) {
    error.network = isNetworkError(error, status);
    console.error(`fetchRoom failed for ${uuid}:`, error.message);
  }
  return { data: data ?? null, error };
};

// Every write goes through the game_action Postgres function (see
// supabase/migrations/20260918140000_game_rules.sql). It locks the room
// row and applies the action to the current DB state, so two phones acting at
// once cannot overwrite each other. Resolves to { data: row, error }; the
// error message is user-readable ("Not enough money", "Room is full", ...).
//
// Two very different things can go wrong and they deserve different words on
// screen, so the error carries `network`:
//
//   error.network === false  the server received it, thought about it and said
//                            no. `error.message` is the reason and is worth
//                            showing verbatim ("Not your turn").
//   error.network === true   the request never got an answer: Wi-Fi dropped,
//                            the phone was asleep, DNS died. `error.message`
//                            is "TypeError: Failed to fetch" or similar, which
//                            means nothing to a player -- the UI should say
//                            "Connection problem — try again" instead.
//
// There is deliberately NO automatic retry here. game_action is not
// idempotent: `roll` rolls the dice and moves a piece, `buy` spends money,
// `bid` raises the price. A request can fail on the way BACK -- the server
// already applied it and only the reply was lost -- and a silent retry would
// then roll twice or bid twice with nobody able to tell. The safe recovery is
// the refetch that the reconnect path does anyway: it shows the player what
// actually happened, and they decide whether to press the button again.
const gameAction = async (uuid, action, payload = {}) => {
  const { data, error, status } = await supabase.rpc("game_action", {
    room: uuid,
    action,
    payload,
  });

  if (error) {
    error.network = isNetworkError(error, status);
    console.error(
      `game_action ${action} failed for room ${uuid}${error.network ? " (network)" : ""}:`,
      error.message,
    );
  }
  return { data: Array.isArray(data) ? data[0] : data, error };
};

// Creates a fresh room. Retries on a code collision (unique violation).
const createGame = async (position, makeCode, attempts = 3) => {
  let lastError = null;
  for (let i = 0; i < attempts; i++) {
    const uuid = makeCode();
    const { error } = await supabase
      .from("test")
      .insert({ uuid, position, Players: [], current_order: 0 });

    if (!error) return { uuid, error: null };
    lastError = error;
    if (error.code !== "23505") break; // not a duplicate code, stop retrying
  }
  console.error("createGame failed:", lastError?.message);
  return { uuid: null, error: lastError };
};

// Subscribes to UPDATE events for one room only. The callback is kept in a
// ref so callers can pass a fresh closure every render without
// re-subscribing; the channel is removed on unmount / room change.
//
// `onResync` is called whenever the caller should refetch the room row,
// because something happened that Realtime cannot make up for: the channel
// came back after a drop, the tab became visible again, the phone came back
// online, the page was restored from the bfcache, or the ~20s heartbeat came
// round. Realtime never replays what it missed, so this is what actually
// un-freezes a phone that slept. Callers with nothing to refetch (the Login
// screen, the figure picker) just leave it out.
//
// Returns `conn` -- { status, since, reconnect } -- the same object
// useGameRoom re-exports and <ConnectionBadge> renders. Existing two-argument
// callers can ignore the return value; nothing about their behaviour changed.
//
// Everything about WHEN to retry and what the status is called lives in
// ./connection.js; this function only knows how to open and close one Supabase
// channel. `connect` is called again for each rebuild, always after the
// previous teardown has run, so there is exactly one channel per room.
const useRealtimeUpdates = (uuid, callback, onResync) => {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const connect = useCallback(
    ({ onStatus }) => {
      const channel = supabase
        .channel(`test:${uuid}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "test",
            filter: `uuid=eq.${uuid}`,
          },
          (payload) => callbackRef.current?.(payload)
        )
        .subscribe((status) => onStatus(status));

      return () => {
        // Not awaited on purpose. removeChannel() sends a leave push and waits
        // for the server to acknowledge it; on the exact failure we are
        // recovering from -- a socket that is already gone -- that never
        // arrives and resolves only on a 10s timeout. The channel is dropped
        // from supabase.getChannels() either way, and connection.js has
        // already stopped listening to this one.
        supabase.removeChannel(channel);
      };
    },
    [uuid]
  );

  return useRealtimeConnection(uuid, connect, onResync);
};

export { useFetch, fetchRoom, gameAction, createGame, useRealtimeUpdates };
