import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "http://192.168.0.221:54321";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const supabase = createClient(supabaseUrl, supabaseKey);

const useFetch = (uuid) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        let { data: dataBack, error } = await supabase
          .from("test")
          .select("*")
          .eq("uuid", uuid);

        if (error) throw error;

        setData(dataBack[0] ? dataBack[0] : null);
      } catch (error) {
        setError(error.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [uuid]);
  // console.log(data);
  return { data, error, loading };
};

const updateDB = async (uuid, prop) => {
  try {
    const { data, error } = await supabase
      .from("test")
      .update(prop)
      .eq("uuid", uuid)
      .select();

    if (error) throw error;
  } catch (error) {}
};

const useRealtimeUpdates = (callback) => {
  useEffect(() => {
    supabase
      .channel("test")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "test" },
        callback
      )
      .subscribe();
  }, [callback]);
};

export { useFetch, updateDB, useRealtimeUpdates };
