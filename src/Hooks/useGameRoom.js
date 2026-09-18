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

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchRoom, gameAction, useRealtimeUpdates } from "./supabase";
import { playerByFig } from "./rules";

const ERROR_MS = 4000;

export function useGameRoom(uuid, playerId) {
  const [room, setRoom] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // The newest batch of events, or null. Bumped only by live updates.
  const [feed, setFeed] = useState(null);

  const seenSeq = useRef(null);
  const errorTimer = useRef(null);

  const apply = useCallback((row, { silent = false } = {}) => {
    if (!row) return false;
    const seq = row.game?.seq ?? 0;
    if (seenSeq.current !== null && seq <= seenSeq.current) return false;
    seenSeq.current = seq;
    setRoom(row);
    if (!silent) {
      setFeed({
        seq,
        actor: row.game?.actor ?? null,
        events: Array.isArray(row.game?.events) ? row.game.events : [],
      });
    }
    return true;
  }, []);

  const refetch = useCallback(async () => {
    if (!uuid) return;
    const { data, error: err } = await fetchRoom(uuid);
    if (err) {
      setFetchError(err.message);
      return;
    }
    setFetchError(null);
    // A refetch can only ever move us forward, so allow it past the seq guard
    // when the row is genuinely newer; `apply` handles that.
    apply(data, { silent: true });
  }, [uuid, apply]);

  // First load
  useEffect(() => {
    let cancelled = false;
    seenSeq.current = null;
    setRoom(null);
    setLoading(true);
    if (!uuid) {
      setLoading(false);
      return;
    }
    fetchRoom(uuid).then(({ data, error: err }) => {
      if (cancelled) return;
      if (err) setFetchError(err.message);
      else apply(data, { silent: true });
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [uuid, apply]);

  useRealtimeUpdates(uuid, (payload) => apply(payload.new), refetch);

  // A phone that sleeps misses every event while it is away, and if it slept
  // through the moment its turn began nothing will arrive to correct it. So
  // resync whenever the screen comes back or the network returns.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refetch);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refetch);
      window.removeEventListener("focus", onVisible);
    };
  }, [refetch]);

  useEffect(() => () => clearTimeout(errorTimer.current), []);

  // The only write path. The RPC returns the new row, so our own actions show
  // up immediately instead of waiting for the Realtime echo (which the seq
  // guard then ignores).
  const run = useCallback(
    async (action, payload = {}) => {
      setBusy(true);
      const res = await gameAction(uuid, action, { playerId, ...payload });
      setBusy(false);
      if (res.error) {
        setError(res.error.message);
        clearTimeout(errorTimer.current);
        errorTimer.current = setTimeout(() => setError(null), ERROR_MS);
      } else {
        apply(res.data);
      }
      return res;
    },
    [uuid, playerId, apply],
  );

  const board = room?.position ?? null;
  const players = room?.Players ?? [];
  const game = room?.game ?? {};
  const me = players.find((p) => p.playerId === playerId) ?? null;
  const phase = game.phase || "roll";
  const over = phase === "over";
  const current = players.find((p) => p.order === room?.current_order) ?? null;
  const myTurn = !!me && !!current && current.playerId === me.playerId && !me.bankrupt && !over;

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
  };
}
