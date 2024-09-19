import { useState, useEffect } from "react";
import Button from "../Components/Button";
import FormInput from "../Components/Input";
import { SelectFigure } from "../Components/SelectFigure";
import { Link } from "react-router-dom";
import { updateDB, useFetch, useRealtimeUpdates } from "../Hooks/supabase";
import ShortUniqueId from "short-unique-id";
import { useNavigate } from "react-router-dom";
import BG from "../Components/BG";

export function Login() {
  const short = new ShortUniqueId({ length: 6 }); //generate uuid for user

  const [currentFig, setCurrenFig] = useState(null); //current figure ex.'fig0'

  const [inp, setInp] = useState({}); //input state

  const { data, error, loading } = useFetch(inp.uuid); //data from db

  const [players, SetPlayers] = useState(data ? data.Players : null); //if there is data  from db then on init its equal to data.Players

  const [logged, setLogged] = useState(false); //state for check if player was before in game

  const navigate = useNavigate();

  function getLogged(Player) {
    if (localStorage.playerInfo !== undefined) {
      const playerId = JSON.parse(localStorage?.playerInfo).playerId;

      if (Player?.filter((e) => e.playerId == playerId).length == 1) {
        setLogged(true);
      } else {
        setLogged(false);
      }
    }
  }

  const handleInserts = (payload) => {
    SetPlayers(payload.new.Players);
    getLogged(payload.new?.Players);
  };

  useRealtimeUpdates(handleInserts);

  useEffect(() => {
    SetPlayers(data?.Players);
    getLogged(data?.Players);
  }, [data]);

  function insert() {
    const newPlayer = {
      name: inp.name,
      figure: currentFig,
      money: 2500,
      position: 0,
      order: players?.length || 0, // Simplified order setting
      playerId: localStorage.playerInfo
        ? JSON.parse(localStorage.playerInfo).playerId
        : short.rnd(), // Assign playerId based on existence in localStorage
    };

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
      localStorage.playerInfo = JSON.stringify(newPlayer); //saving all in localStorage

      const updatedPlayers = players ? [newPlayer, ...players] : [newPlayer]; // Reduce repetition

      updateDB(inp.uuid, { ...insertingData, Players: updatedPlayers });

      setCurrenFig(null);

      navigate("/Client");
    } else {
      alert("Wrong Credentials");
    }
  }

  return (
    <>
      <BG />
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
