import { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill it in."
  );
}

const supabase = createClient(supabaseUrl, supabaseKey);

const useFetch = (uuid) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uuid) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        let { data: dataBack, error } = await supabase
          .from("test")
          .select("*")
          .eq("uuid", uuid);

        if (error) throw error;

        if (!cancelled) setData(dataBack[0] ? dataBack[0] : null);
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
  return { data, error, loading };
};

// One-shot read of a room. useFetch above is the hook version for a first
// paint; this is for refetching on demand (waking from sleep, reconnecting).
const fetchRoom = async (uuid) => {
  if (!uuid) return { data: null, error: null };
  const { data, error } = await supabase
    .from("test")
    .select("*")
    .eq("uuid", uuid)
    .maybeSingle();
  if (error) console.error(`fetchRoom failed for ${uuid}:`, error.message);
  return { data: data ?? null, error };
};

// Every write goes through the game_action Postgres function (see
// supabase/migrations/20260918140000_game_rules.sql). It locks the room
// row and applies the action to the current DB state, so two phones acting at
// once cannot overwrite each other. Resolves to { data: row, error }; the
// error message is user-readable ("Not enough money", "Room is full", ...).
const gameAction = async (uuid, action, payload = {}) => {
  const { data, error } = await supabase.rpc("game_action", {
    room: uuid,
    action,
    payload,
  });

  if (error) {
    console.error(`game_action ${action} failed for room ${uuid}:`, error.message);
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
// `onSubscribed` fires every time the channel reaches SUBSCRIBED, which is the
// first connect and every reconnect after a drop. Callers use it to refetch,
// since anything that happened while the socket was down was never delivered.
const useRealtimeUpdates = (uuid, callback, onSubscribed) => {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const subscribedRef = useRef(onSubscribed);
  subscribedRef.current = onSubscribed;

  useEffect(() => {
    if (!uuid) return;

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
        (payload) => callbackRef.current(payload)
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") subscribedRef.current?.();
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [uuid]);
};

export { useFetch, fetchRoom, gameAction, createGame, useRealtimeUpdates };
