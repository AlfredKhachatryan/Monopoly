// Everything the phone needs to know about one room, and the only way it
// writes to it.
//
// Three sources push state at us: the first fetch, the reply to our own RPC,
// and Realtime events from everyone else. They can arrive out of order, so
// every update carries `game.seq` and anything not newer than what we already
// applied is dropped.
//
// Events are emitted only for updates that arrived live, never for a refetch.
// A refetch returns whatever the last action happened to be, and replaying that
// as if it just happened would pop the wrong thing on screen after a refresh.
// The log covers anything missed while away.
//
// STALENESS, AND WHY THE GUARD CANNOT SWALLOW A RESYNC
// ---------------------------------------------------
// `game.seq` is a per-room counter the RPC increments on every single action
// (`seq := coalesce((gm->>'seq')::integer, 0) + 1` -- see
// supabase/migrations/20260920100000_six_players.sql). It never resets, not
// even for new_game, so it is a true monotonic marker: a higher seq is always
// the later row, whichever path it arrived by.
//
// That makes the guard exactly right for a resync. A refetch that comes back
// with a NEWER row is applied (this is the whole point -- it is how a phone
// that slept catches up). A refetch that comes back with the row we already
// have is dropped, which is what "apply only if it differs" means here. And a
// slow refetch that resolves after a newer one already landed is dropped
// twice over: by its seq, and by the fetch ticket below.
//
// Two things the seq alone does not cover, so they are handled explicitly:
//   * rows with no `game` at all (a room created before the rules migration)
//     have seq 0 forever, and `0 <= 0` would freeze the phone permanently.
//     Those fall back to comparing the row itself.
//   * two refetches in flight at once. Each carries a ticket number, and a
//     reply older than the newest one already seen is thrown away before the
//     seq guard ever sees it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchRoom, gameAction, useRealtimeUpdates } from "./supabase";
import { playerByFig } from "./rules";

const ERROR_MS = 4000;

// A send that got no answer, or never left the phone. The message from the
// fetch layer ("TypeError: Failed to fetch") is not for players to read.
const NETWORK_MESSAGE = "Connection problem — try again";

// How long after one of OUR actions a Realtime echo should have come back.
// The RPC reply already gave us the new row, so this is not about the state --
// it is a liveness probe. Our own UPDATE is the one event we know for certain
// the server just published; if it does not reach us, the socket is dead
// regardless of what its status says.
const ECHO_MS = 1500;

// Consecutive silent actions before we stop trusting a "live" channel and
// rebuild it, and the minimum gap between two such rebuilds. Three, not one,
// because a single missed echo is just as likely to be a slow phone -- and
// rate-limited, so a room whose Realtime publication is misconfigured (no
// events will EVER arrive) degrades to one wasted rebuild every half minute
// instead of one per action.
const SILENT_ACTIONS_BEFORE_REBUILD = 3;
const FORCED_REBUILD_GAP_MS = 30000;

export function useGameRoom(uuid, playerId) {
  const [room, setRoom] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // The newest batch of events, or null. Bumped only by live updates.
  const [feed, setFeed] = useState(null);

  const seenSeq = useRef(null);
  // The newest seq whose `game.events` have actually been handed to the screen
  // as a feed. Deliberately NOT the same thing as `seenSeq`: adopting a row
  // (the state) and playing its beat (the dice reveal, the card, the pay FX,
  // the sound, and the `land` event the Buy offer used to hang on) are two
  // different jobs, and a silent resync does the first without the second.
  // See the rescue in `apply`.
  const shownSeq = useRef(null);
  const seenRow = useRef(null); // only read for rows that carry no seq
  const errorTimer = useRef(null);

  // Refetch ordering. `ticket` is handed out at the START of each fetch;
  // `newestSettled` is the highest ticket whose reply has come back. A reply
  // with a lower ticket started earlier and is, by definition, older data.
  const ticket = useRef(0);
  const newestSettled = useRef(0);

  // Liveness probe state (see ECHO_MS).
  const lastLiveEventAt = useRef(0);
  const echoTimer = useRef(null);
  const silentActions = useRef(0);
  const lastForcedRebuild = useRef(0);
  const connRef = useRef(null);

  const apply = useCallback((row, { silent = false } = {}) => {
    if (!row) return false;
    const rawSeq = row.game?.seq;
    const hasSeq = typeof rawSeq === "number" && Number.isFinite(rawSeq);

    let fresh; // newer than the row we are already holding
    let owed = false; // the row we hold, but its beat was never played

    if (hasSeq) {
      fresh = seenSeq.current === null || rawSeq > seenSeq.current;

      // THE RESCUE.
      //
      // A silent resync adopts the row and advances `seenSeq` WITHOUT
      // emitting a feed, and there are a lot of them: the 20s heartbeat,
      // window focus, visibilitychange, pageshow, online, a resubscribe, and
      // the ECHO_MS probe below. Any one of them can resolve inside the
      // window between the server committing an action and that action's LIVE
      // row reaching us -- our own RPC reply, or the Realtime event.
      //
      // When that happened, the live row arrived carrying a seq we had
      // already adopted, `rawSeq <= seenSeq` was true, and it was dropped
      // here as a stale duplicate. The state was fine (the resync had it) but
      // the BEAT was gone for good: no dice settling on the rolled faces, no
      // Chance/Chest overlay, no doubles FX, no pay FX, no sound -- and no
      // `land` event, which is what silently took the Buy offer away.
      //
      // Both rows are the same row, so there is nothing to reconcile: the
      // live arrival is simply still allowed to hand over its events, and
      // `shownSeq` guarantees that happens exactly once however the two
      // deliveries are ordered.
      //
      // Only for the row we are actually showing (`rawSeq === seenSeq`). A
      // live row that is genuinely BEHIND what is on screen -- an opponent
      // acted while our reply was in flight -- stays dropped: its events
      // describe a state the player has already been moved past, and playing
      // them would be a lie.
      owed =
        !silent &&
        !fresh &&
        rawSeq === seenSeq.current &&
        (shownSeq.current === null || rawSeq > shownSeq.current);

      if (!fresh && !owed) return false;
      if (fresh) {
        seenSeq.current = rawSeq;
        seenRow.current = null;
      }
    } else {
      // No usable seq (a pre-migration room, or a row inserted by createGame
      // before its first action). Nothing can be ordered, so fall back to
      // "did anything change at all" -- which still keeps a refetch from
      // re-firing the feed, and still keeps the phone from freezing.
      const fingerprint = JSON.stringify(row);
      if (seenRow.current === fingerprint) return false;
      seenRow.current = fingerprint;
      fresh = true;
    }

    if (fresh) setRoom(row);
    if (!silent && (fresh || owed)) {
      if (hasSeq) shownSeq.current = rawSeq;
      const next = {
        seq: rawSeq ?? 0,
        actor: row.game?.actor ?? null,
        events: Array.isArray(row.game?.events) ? row.game.events : [],
      };
      setFeed(next);
    }
    return true;
  }, []);

  // The resync. Everything that notices we might have missed something ends
  // up here: the channel resubscribing, the screen coming back, the network
  // coming back, the heartbeat, the Reconnect button. All of them are
  // debounced together in ./connection.js, so a phone unlocking -- which fires
  // visibilitychange, focus, pageshow and sometimes online within the same
  // few milliseconds -- costs one read, not four.
  const refetch = useCallback(async () => {
    if (!uuid) return;
    const mine = ++ticket.current;
    const { data, error: err } = await fetchRoom(uuid);
    if (mine <= newestSettled.current) return; // a newer fetch already landed
    newestSettled.current = mine;
    if (err) {
      // A refetch that failed because the network is down is not news: the
      // connection badge is already saying so, and a red banner on every
      // Wi-Fi blip would train everyone to ignore it. A real server-side
      // failure (RLS, a dropped table) still gets said out loud.
      if (!err.network) setFetchError(err.message);
      return;
    }
    setFetchError(null);
    // Silent: a refetch is not news, it is catching up. `apply` decides
    // whether this row is actually newer than what we already have.
    apply(data, { silent: true });
  }, [uuid, apply]);

  // First load
  useEffect(() => {
    let cancelled = false;
    seenSeq.current = null;
    shownSeq.current = null;
    seenRow.current = null;
    ticket.current = 0;
    newestSettled.current = 0;
    lastLiveEventAt.current = 0;
    silentActions.current = 0;
    setRoom(null);
    setLoading(true);
    if (!uuid) {
      setLoading(false);
      return;
    }
    const mine = ++ticket.current;
    fetchRoom(uuid).then(({ data, error: err }) => {
      if (cancelled) return;
      if (mine > newestSettled.current) {
        newestSettled.current = mine;
        // Unlike a later refetch, the very first one has to say something
        // when it fails -- there is no screen to fall back on.
        if (err) setFetchError(err.network ? NETWORK_MESSAGE : err.message);
        else apply(data, { silent: true });
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [uuid, apply]);

  const onRealtime = useCallback(
    (payload) => {
      // Stamped before the seq guard runs: even an echo of our own action
      // that gets dropped as a duplicate still proves the socket is alive.
      lastLiveEventAt.current = Date.now();
      silentActions.current = 0;
      apply(payload.new);
    },
    [apply],
  );

  // Owns the channel, the backoff, the online/visible/pageshow/focus resync
  // triggers and the heartbeat. Hands back the connection status the badge
  // renders. See ./connection.js.
  const conn = useRealtimeUpdates(uuid, onRealtime, refetch);
  connRef.current = conn;

  useEffect(
    () => () => {
      clearTimeout(errorTimer.current);
      clearTimeout(echoTimer.current);
    },
    [],
  );

  // The only write path. The RPC returns the new row, so our own actions show
  // up immediately instead of waiting for the Realtime echo (which the seq
  // guard then ignores).
  const run = useCallback(
    async (action, payload = {}) => {
      setBusy(true);
      const res = await gameAction(uuid, action, { playerId, ...payload });
      setBusy(false);
      if (res.error) {
        // A rule rejection is the server talking to the player and is worth
        // quoting. A network failure is not -- "TypeError: Failed to fetch"
        // tells them nothing they can act on.
        //
        // Nothing is retried automatically either way. game_action is not
        // idempotent (roll moves a piece, buy spends money, bid raises a
        // price) and a request can fail on the way BACK, with the server
        // having already applied it. Re-sending would roll twice. The resync
        // shows what really happened; the player decides whether to tap again.
        setError(res.error.network ? NETWORK_MESSAGE : res.error.message);
        clearTimeout(errorTimer.current);
        errorTimer.current = setTimeout(() => setError(null), ERROR_MS);
        // The request failed, so we may be holding a row the server has
        // already moved past. Ask.
        if (res.error.network) refetch();
      } else {
        apply(res.data);
        // Liveness probe. The server definitely just published an UPDATE for
        // this room. If it never reaches us, the channel is dead even though
        // it still says SUBSCRIBED -- the exact failure a phone brings back
        // from a locked screen.
        const sentAt = Date.now();
        clearTimeout(echoTimer.current);
        echoTimer.current = setTimeout(() => {
          if (lastLiveEventAt.current >= sentAt) return; // echo arrived, fine
          silentActions.current += 1;
          const c = connRef.current;
          const canRebuild =
            silentActions.current >= SILENT_ACTIONS_BEFORE_REBUILD &&
            c?.status === "live" &&
            Date.now() - lastForcedRebuild.current > FORCED_REBUILD_GAP_MS;
          if (canRebuild) {
            lastForcedRebuild.current = Date.now();
            silentActions.current = 0;
            c.reconnect(); // tears the channel down, rebuilds, and refetches
          } else {
            refetch();
          }
        }, ECHO_MS);
      }
      return res;
    },
    [uuid, playerId, apply, refetch],
  );

  const board = room?.position ?? null;
  const players = room?.Players ?? [];
  const game = room?.game ?? {};
  const me = players.find((p) => p.playerId === playerId) ?? null;
  const phase = game.phase || "roll";
  const over = phase === "over";
  const current = players.find((p) => p.order === room?.current_order) ?? null;
  const myTurn = !!me && !!current && current.playerId === me.playerId && !me.bankrupt && !over;

  // Undefined when there is no room to be connected to, so <ConnectionBadge>
  // renders nothing at all rather than "Connecting…" forever on a screen that
  // was never going to connect.
  const connection = useMemo(
    () => (uuid ? { status: conn.status, since: conn.since, reconnect: conn.reconnect } : undefined),
    [uuid, conn.status, conn.since, conn.reconnect],
  );

  return {
    room,
    board,
    players,
    game,
    me,
    current,
    phase,
    over,
    myTurn,
    winner: game.winner ? playerByFig(players, game.winner) : null,
    dice: Array.isArray(game.dice) ? game.dice : null,
    diceSum: Array.isArray(game.dice) ? game.dice[0] + game.dice[1] : 7,
    log: Array.isArray(game.log) ? game.log : [],
    loading,
    fetchError,
    busy,
    error,
    feed,
    run,
    refetch,
    conn: connection,
  };
}
