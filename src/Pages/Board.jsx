import { useEffect, useState } from "react";
import { initialState } from "../Hooks/baseState";
import CardRenderer from "../Components/CardRenderer";
import Button from "../Components/Button";
import FormInput from "../Components/Input";
import { useRealtimeUpdates, useFetch, updateDB } from "../Hooks/supabase";
import { Chance } from "../Components/Chance";
import AnimatedNumbers from "../Components/AnimatedNumbers";

function readRoomId() {
  return (
    new URLSearchParams(window.location.search).get("room") ||
    localStorage.getItem("roomId") ||
    ""
  );
}

function Main() {
  // Room code: /?room=XXXX wins, then the last room used in this browser.
  // The TV usually opens the URL with the code; players type it on /Login.
  const [uuid, setUuid] = useState(readRoomId);
  const [roomInput, setRoomInput] = useState("");

  useEffect(() => {
    if (uuid) localStorage.setItem("roomId", uuid);
  }, [uuid]);

  const [pos, setPos] = useState(initialState());
  const [userData, setUserData] = useState(null);
  const [currentOrder, setCurrentOrder] = useState(null);
  const { data, error, loading } = useFetch(uuid);

  function updatePos(pos, user, order) {
    if (pos) {
      setPos(pos);
    }
    setUserData(user);
    setCurrentOrder(order);
  }

  useEffect(() => {
    if (data) {
      updatePos(data.position, data.Players, data.current_order);
    }
  }, [data]);

  const handleInserts = (payload) => {
    updatePos(
      payload.new.position,
      payload.new.Players,
      payload.new.current_order
    );
  };

  const handleClick = () => {
    updateDB(uuid, {
      position: initialState(),
    });
    setPos(initialState());
  };

  useRealtimeUpdates(uuid, handleInserts); //when DB is updated he does some function

  if (!uuid) {
    return (
      <>
        <div className="boardBG"></div>
        <div
          className="cont"
          style={{ alignItems: "center", flexDirection: "column" }}
        >
          <div style={{ width: "20em" }}>
            <br />
            <FormInput
              placeholder={"Room code"}
              value={roomInput}
              onChange={(e) => setRoomInput(e.target.value.trim())}
            />
            <br />
            <Button
              onClick={() => setUuid(roomInput)}
              disabled={!roomInput}
            >
              Open Board
            </Button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="boardBG"></div>
      <div className="cont">
        <div
          className="roomCode"
          style={{
            position: "absolute",
            top: "0.5em",
            left: "0.5em",
            padding: "0.3em 0.8em",
            borderRadius: "0.4em",
            background: "#14141463",
            fontSize: "1.1em",
          }}
        >
          Room: <b>{uuid}</b>
          {!loading && !data && (
            <span style={{ color: "#eb476d" }}> (not found)</span>
          )}
        </div>
        <div className="parent">
          <div className="innerBoard"></div>
          <CardRenderer pos={pos}></CardRenderer>
          <div className="ChanceOutline flexCent">
            <Chance txt={"Chance"}></Chance>
          </div>
          <div className="BonusOutline flexCent">
            <Chance txt={"Bonus"}></Chance>
          </div>
          <Button onClick={() => handleClick()}>Click</Button>
          <div
            className="PlayerInfo flexCent"
            style={{
              boxShadow: "0px 0px 15px 0px #eb476d85",
              border: "1px solid #eb476d",
            }}
          >
            {userData?.map(({ figure, name, money, order }) => (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "20px 1fr 2em",
                  gridTemplateRows: "25px",
                  flexDirection: "row",
                  width: "100%",
                  justifyContent: "center",
                  justifyItems: "center",
                  alignItems: "center",
                }}
                key={figure}
              >
                <div
                  className={`fig ${figure}`}
                  key={name}
                  style={{ filter: "none" }}
                >
                  <div
                    className="selectedFig"
                    style={{
                      backgroundColor: "#f5f5f560",
                    }}
                  ></div>
                </div>
                <span style={{ display: "flex" }}>
                  {name}:
                  <AnimatedNumbers
                    transitions={(index) => ({
                      type: "spring",
                      duration: index + 0.3,
                    })}
                    animateToNumber={money}
                  />
                  $
                </span>
                {order == currentOrder && (
                  <i
                    className="fa-solid fa-check fa-xl"
                    style={{ color: "#63E6BE" }}
                  ></i>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

export { Main };
