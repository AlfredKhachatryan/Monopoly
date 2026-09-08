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

const updateDB = async (uuid, prop) => {
  const { data, error } = await supabase
    .from("test")
    .update(prop)
    .eq("uuid", uuid)
    .select();

  if (error) {
    console.error(`updateDB failed for room ${uuid}:`, error.message);
  }
  return { data, error };
};

// Subscribes to UPDATE events for one room only. The callback is kept in a
// ref so callers can pass a fresh closure every render without
// re-subscribing; the channel is removed on unmount / room change.
const useRealtimeUpdates = (uuid, callback) => {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [uuid]);
};

export { useFetch, updateDB, useRealtimeUpdates };
