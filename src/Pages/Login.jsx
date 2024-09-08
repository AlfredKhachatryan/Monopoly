import { useState, useEffect } from "react";
import Button from "../Components/Button";
import FormInput from "../Components/Input";
import { SelectFigure } from "../Components/SelectFigure";
import { Link } from "react-router-dom";
import { updateDB, useFetch, useRealtimeUpdates } from "../Hooks/supabase";
import ShortUniqueId from "short-unique-id";
import { useNavigate } from "react-router-dom";
export function Login() {
  const short = new ShortUniqueId({ length: 6 });

  const [currentFig, setCurrenFig] = useState(null);
  const [inp, setInp] = useState({});
  const { data, error, loading } = useFetch(inp.uuid);
  const [players, SetPlayers] = useState(data ? data.Players : null);
  const [logged, setLogged] = useState(false);
  const navigate = useNavigate();
  const handleInserts = (payload) => {
    SetPlayers(payload.new.Players);
    if (localStorage.playerInfo !== undefined) {
      if (
        payload.new.Players?.filter(
          (e) => e.playerId == JSON.parse(localStorage?.playerInfo).playerId
        ) > 1
      ) {
        setLogged(true);
      } else {
        setLogged(false);
      }
    }
  };

  useRealtimeUpdates(handleInserts);

  useEffect(() => {
    SetPlayers(data?.Players);
    if (localStorage.playerInfo !== undefined) {
      if (
        data?.Players.filter(
          (e) => e.playerId == JSON.parse(localStorage?.playerInfo).playerId
        ).length > 1
      ) {
        setLogged(true);
      } else {
        setLogged(false);
      }
    }
  }, [data]);

  function insert() {
    const newPlayer = {
      name: inp.name,
      figure: currentFig,
      money: 100,
      position: 0,
      ...(!localStorage.playerInfo !== undefined
        ? {
            playerId: short.rnd(),
          }
        : {
            playerId: JSON.parse(localStorage.playerInfo).playerId,
          }),
    };

    localStorage.playerInfo = JSON.stringify(newPlayer);

    const insertingData = {
      position: {
        ...data?.position,
        1: {
          ...data?.position[1],
          [currentFig]: true,
        },
      },
    };
    if (logged) {
      navigate("/Client");
    } else if (inp.name && currentFig) {
      if (players) {
        updateDB(inp.uuid, {
          ...insertingData,
          Players: [newPlayer, ...players],
        });
      } else {
        updateDB(inp.uuid, {
          ...insertingData,
          Players: [newPlayer],
        });
      }
      setCurrenFig(null);
      navigate("/Client");
    } else {
      alert("lox");
    }
  }
  return (
    <>
      <div className="cont">
        <div className="">
          <FormInput
            placeholder={"Name"}
            onChange={(e) => setInp({ ...inp, name: e.target.value })}
            disabled={logged}
          />
          <br />
          <FormInput
            placeholder={"UUID"}
            onChange={(e) => setInp({ ...inp, uuid: e.target.value })}
          />
          <br />
          <Button
            onClick={() => {
              insert();
            }}
          >
            {logged ? "ReJoin To Game" : "Join Game"}
          </Button>
          <br />
          {!logged ? (
            <SelectFigure
              setParentFig={setCurrenFig}
              disabledFig={players ? players : []}
            />
          ) : (
            <SelectFigure
              setParentFig={setCurrenFig}
              disabledFig={[
                { figure: "fig0" },
                { figure: "fig1" },
                { figure: "fig2" },
                { figure: "fig3" },
              ]}
            />
          )}
        </div>
      </div>
    </>
  );
}
