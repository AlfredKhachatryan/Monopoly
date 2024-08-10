import { useEffect, useState, useRef } from "react";
import Button from "../Components/Button";
import Input from "../Components/Input";
import { SelectFigure } from "../Components/SelectFigure";
import { useRealtimeUpdates, updateDB, useFetch } from "../Hooks/supabase";
import { Link } from "react-router-dom";
let current = 0;
function Client() {
  const PlayerId = JSON.parse(localStorage.playerInfo).playerId;
  const uuid = "v6Pstf";
  const [pos, setPos] = useState(null);
  const [PlayerInfo, setPlayerInfo] = useState(null);
  const { data, error, loading } = useFetch(uuid);
  const [currentPos, setCurrentPos] = useState(1);

  function setState(pos, player) {
    setPos(pos);
    setPlayerInfo(player);
  }

  useEffect(() => {
    if (data) {
      const playerInfo = data.Players.filter((e) => e.playerId == PlayerId)[0];
      setState(data.position, playerInfo);
      current = playerInfo.position;
      setCurrentPos(current);
    }
  }, [data]);

  const handleInserts = (payload) => {
    const playerInfo = payload.new.Players.filter(
      (e) => e.playerId == PlayerId
    )[0];
    setState(payload.new.position, playerInfo);
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

  function updatePos() {
    const number = Math.floor(Math.random() * 6) + 1;
    current += number;
    console.log(number, current, currentPos);
    if (current > 36) {
      current = current - 36;
      setCurrentPos(current);
    } else {
      setCurrentPos(current);
    }

    setPos(updateItem(PlayerInfo.figure, current));

    const updatedArray = data.Players.map((item) =>
      item.playerId === PlayerInfo.playerId
        ? { ...PlayerInfo, position: current }
        : item
    );
    updateDB(uuid, {
      position: updateItem(PlayerInfo.figure, current),
      Players: updatedArray,
    });
  }

  return (
    <div className="cont">
      <div className="" style={{ display: "flex", flexDirection: "column" }}>
        <h1 style={{ textAlign: "center" }}>
          Name:
          {PlayerInfo?.name}
          <br />
          Pos:{currentPos}
        </h1>
        <br />
        <Button
          onClick={() => {
            updatePos();
          }}
        >
          Move By
        </Button>
        <br />
        <Link to="/Login">
          <Button
            onClick={() => {
              localStorage.clear();
              updateDB(uuid, {
                position: Object.fromEntries(
                  Object.entries(pos).map(([key, value]) => [
                    key,
                    { ...value, [PlayerInfo.figure]: false },
                  ])
                ),
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
