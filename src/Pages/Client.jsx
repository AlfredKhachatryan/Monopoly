import { useEffect, useState, useRef } from "react";
import Button from "../Components/Button";
import Input from "../Components/Input";
import { SelectFigure } from "../Components/SelectFigure";
import { useRealtimeUpdates, updateDB, useFetch } from "../Hooks/supabase";
import { Link } from "react-router-dom";
import DiceRoller from "../Components/Dice";
import { Footer } from "../Components/Footer";
import { FigureBox } from "../Components/FigureBox";
let current = 0;
function Client() {
  // const PlayerId = JSON.parse(localStorage.playerInfo).playerId;
  let PlayerId;
  const uuid = "v6Pstf";
  const [pos, setPos] = useState(null);
  const [Players, setPlayers] = useState(null);
  const [PlayerInfo, setPlayerInfo] = useState(null);
  const { data, error, loading } = useFetch(uuid);
  const [currentPos, setCurrentPos] = useState(1);
  const [click, setClick] = useState(0);

  function setState(pos, curPlayer, Players, curPos) {
    setPos(pos);
    setPlayerInfo(curPlayer);
    setCurrentPos(curPos);
    setPlayers(Players);
  }

  // useEffect(() => {
  //   if (data) {
  //     const playerInfo = data.Players.filter((e) => e.playerId == PlayerId)[0];
  //     setState(data.position, playerInfo, data.Players, current);
  //     current = playerInfo?.position;
  //   }
  // }, [data]);

  const handleInserts = (payload) => {
    const playerInfo = payload.new.Players.filter(
      (e) => e.playerId == PlayerId
    )[0];
    current = playerInfo?.position;
    setState(payload.new.position, playerInfo, payload.new.Players, current);
  };

  // useRealtimeUpdates(handleInserts);

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

    const updatedArray = Players.map((item) =>
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
    <>
      <div className="bg"></div>
      <div
        style={{
          paddingTop: "1em",
          display: "flex",
          flexDirection: "column",
          // justifyContent: "space-between",
          // minHeight: "100dvh",
        }}
      >
        <div style={{ position: "relative", height: "10em", width: "100%" }}>
          <div className="sideBar">
            <div className="sideBarItem">
              <i className="fa-duotone fa-house"></i>
              &nbsp;
              <span>Houses</span>
            </div>
          </div>
          <div className="ClientMoney">
            <div style={{ color: "white" }}>
              <span>$2500</span>
            </div>
            <div className="divider"></div>
            <div style={{ color: "white" }} className="CMItemWallet">
              <i
                className="fa-regular fa-wallet"
                style={{ zIndex: 2, position: "relative" }}
              ></i>
            </div>
          </div>
          <div
            className="sideBar"
            style={{
              right: "0",
              height: "7em",
              bottom: "0",
              borderRadius: "5px 0px 0px 5px",
            }}
          >
            <div className="sideBarItem">
              <i className="fa-duotone fa-cards-blank"></i>
              &nbsp;
              <span>Cards</span>
            </div>
          </div>
        </div>
        <br />
        <br />
        <br />
        <div
          className=""
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            width: "60%",
            alignSelf: "center",
          }}
        >
          {/* <h1 style={{ textAlign: "center" }}>
            Name:
            {PlayerInfo?.name}
            <br />
            Pos:{currentPos}
          </h1> */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              width: "calc(180px + 2em)",
            }}
          >
            <DiceRoller click={click}></DiceRoller>
            <DiceRoller click={click}></DiceRoller>
          </div>
          <br />
          {/* <Button
            onClick={() => {
              // updatePos();
            }}
          >
            Move By
          </Button> */}
          <Button
            onClick={() => {
              setClick(1 + click);
            }}
            btnCont={{ "--accent": "#d92650" }}
          >
            Roll The Dice
          </Button>
          <br />
          {/* <Link to="/Login">
            <Button
            // onClick={() => {
            //   localStorage.clear();
            //   updateDB(uuid, {
            //     position: Object.fromEntries(
            //       Object.entries(pos).map(([key, value]) => [
            //         key,
            //         { ...value, [PlayerInfo.figure]: false },
            //       ])
            //     ),
            //     Players: Players.filter((e) => e.figure !== PlayerInfo.figure),
            //   });
            // }}
            >
              Leave
            </Button>
          </Link> */}
          <br />
        </div>

        <Footer></Footer>
      </div>
    </>
  );
}
export { Client };
