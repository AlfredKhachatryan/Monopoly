import { useEffect, useState, useRef } from "react";
import Button from "../Components/Button";
import Input from "../Components/Input";
import { SelectFigure } from "../Components/SelectFigure";
import { useRealtimeUpdates, updateDB, useFetch } from "../Hooks/supabase";
import { Link } from "react-router-dom";
function Client() {
  const PlayerInfo = JSON.parse(localStorage.playerInfo);
  const uuid = "v6Pstf";
  const [inp, setInp] = useState("");
  const [pos, setPos] = useState(null);

  const { data, error, loading } = useFetch(uuid);

  useEffect(() => {
    if (data) {
      setPos(data.position);
      console.log(data);
    }
  }, [data]);

  const handleInserts = (payload) => {
    setPos(payload.new.position);
    console.log("Update received:", payload);
  };

  useRealtimeUpdates(handleInserts);

  const updateItem = (figKey, newPosition) => {
    const newState = { ...pos };
    let lastItemKey = null;

    // Найти последний объект, где figX было true
    for (const [key, item] of Object.entries(newState)) {
      if (item[figKey] === true) {
        lastItemKey = key;
      }
    }

    // Установить figX в false в последнем найденном объекте
    if (lastItemKey) {
      newState[lastItemKey] = {
        ...newState[lastItemKey],
        [figKey]: false,
      };
    }

    // Установить figX в true в указанном объекте (newPosition)
    if (newState[newPosition]) {
      newState[newPosition] = {
        ...newState[newPosition],
        [figKey]: true,
      };
    }
    return newState;
  };
  return (
    <div className="cont">
      <div className="" style={{ display: "flex", flexDirection: "column" }}>
        <h1 style={{ textAlign: "center" }}>
          Name:
          {PlayerInfo.name}
        </h1>
        <br />
        <Input
          type="text"
          onChange={(e) => setInp(e.target.value)}
          placeholder={"Position"}
        />
        <br />
        <Button
          onClick={() => {
            setPos(updateItem(PlayerInfo.figure, Number(inp)));
            updateDB(uuid, {
              position: updateItem(PlayerInfo.figure, Number(inp)),
            });
          }}
        >
          Move By
        </Button>
        <br />
        <Link to="/Login">
          <Button
            onClick={() => {
              updateDB(uuid, {
                Players: data.Players.filter(
                  (e) => e.figure !== PlayerInfo.figure
                ),
              });
            }}
          >
            Leave
          </Button>
        </Link>
        <br />
      </div>
    </div>
  );
}
export { Client };
