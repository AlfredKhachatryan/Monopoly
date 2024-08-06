import { useState, useEffect } from "react";
import Button from "../Components/Button";
import FormInput from "../Components/Input";
import { SelectFigure } from "../Components/SelectFigure";
import { Link } from "react-router-dom";
import { updateDB, useFetch, useRealtimeUpdates } from "../Hooks/supabase";

export function Login() {
  const [currentFig, setCurrenFig] = useState(null);
  const [inp, setInp] = useState({});
  const { data, error, loading } = useFetch(inp.uuid);
  const [players, SetPlayers] = useState(data ? data.Players : null);

  const handleInserts = (payload) => {
    SetPlayers(payload.new.Players);
  };

  useRealtimeUpdates(handleInserts);

  useEffect(() => {
    SetPlayers(data?.Players);
  }, [data]);

  function insert() {
    const newPlayer = { name: inp.name, figure: currentFig, money: 100 };
    var userData = { name: inp.name, figure: currentFig };
    localStorage.playerInfo = JSON.stringify(userData);
    if (inp.name && currentFig) {
      if (players) {
        updateDB(inp.uuid, {
          Players: [newPlayer, ...players],
        });
      } else {
        updateDB(inp.uuid, {
          Players: [newPlayer],
        });
      }
      setCurrenFig(null);
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
          />
          <br />
          <FormInput
            placeholder={"UUID"}
            onChange={(e) => setInp({ ...inp, uuid: e.target.value })}
          />
          <br />
          <Link to={"/Client"}>
            <Button
              onClick={() => {
                insert();
              }}
            >
              Join Game
            </Button>
          </Link>
          <br />
          <SelectFigure
            setParentFig={setCurrenFig}
            disabledFig={players ? players : []}
          ></SelectFigure>
        </div>
      </div>
    </>
  );
}
