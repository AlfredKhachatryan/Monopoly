import { useEffect, useState } from "react";
import { initialState } from "../Hooks/baseState";
import CardRenderer from "../Components/CardRenderer";
import Button from "../Components/Button";
import FormInput from "../Components/Input";
import ShortUniqueId from "short-unique-id";
import {
  useRealtimeUpdates,
  useFetch,
  updateDB,
  createGame,
} from "../Hooks/supabase";
import { Chance } from "../Components/Chance";
import { useWalkingTokens } from "../Hooks/useWalkingTokens";
import { TokenLayer } from "../Components/TokenLayer";
import AnimatedNumbers from "../Components/AnimatedNumbers";
import {
  m,
  AnimatePresence,
  fade,
  fadeUp,
  stagger,
  pop,
} from "../Components/Motion";

const short = new ShortUniqueId({ length: 6 }); // room codes, e.g. "v6Pstf"

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
  const [hosting, setHosting] = useState(false);
  const [hostError, setHostError] = useState(null);

  useEffect(() => {
    if (!uuid) return;
    localStorage.setItem("roomId", uuid);
    // keep ?room= in the address bar so a refresh / bookmark keeps the room
    const url = new URL(window.location.href);
    if (url.searchParams.get("room") !== uuid) {
      url.searchParams.set("room", uuid);
      window.history.replaceState(null, "", url);
    }
  }, [uuid]);

  // Host: insert a fresh row with an empty board and open it here.
  async function hostGame() {
    setHosting(true);
    setHostError(null);
    const { uuid: newUuid, error } = await createGame(initialState(), () =>
      short.rnd(),
    );
    setHosting(false);
    if (error) {
      setHostError(error.message);
      return;
    }
    setPos(initialState());
    setUserData([]);
    setCurrentOrder(0);
    setUuid(newUuid);
  }

  const [pos, setPos] = useState(initialState());
  const [userData, setUserData] = useState(null);
  const [currentOrder, setCurrentOrder] = useState(null);
  const { data, loading } = useFetch(uuid);

  // Tokens walk cell by cell towards their DB position. They are drawn by
  // TokenLayer on top of the grid, so the cells themselves never re-render
  // while a token moves.
  const shownTokens = useWalkingTokens(pos);

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
      payload.new.current_order,
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
          <m.div
            style={{ width: "20em" }}
            variants={stagger}
            initial="hidden"
            animate="show"
          >
            <br />
            <m.div variants={fadeUp}>
              <FormInput
                placeholder={"Room code"}
                value={roomInput}
                onChange={(e) => setRoomInput(e.target.value.trim())}
              />
            </m.div>
            <br />
            <m.div variants={fadeUp}>
              <Button onClick={() => setUuid(roomInput)} disabled={!roomInput}>
                Open Board
              </Button>
            </m.div>
            <br />
            <m.div
              variants={fadeUp}
              style={{ textAlign: "center", opacity: 0.7 }}
            >
              or
            </m.div>
            <br />
            <m.div variants={fadeUp}>
              <Button onClick={hostGame} disabled={hosting}>
                {hosting ? "Creating..." : "Host New Game"}
              </Button>
            </m.div>
            <AnimatePresence>
              {hostError && (
                <m.p
                  key="hostError"
                  style={{ color: "#eb476d", textAlign: "center" }}
                  variants={fadeUp}
                  initial="hidden"
                  animate="show"
                  exit="exit"
                >
                  Could not create game: {hostError}
                </m.p>
              )}
            </AnimatePresence>
          </m.div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="boardBG"></div>
      <div className="cont">
        <m.div
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
          variants={fade}
          initial="hidden"
          animate="show"
        >
          Room: <b>{uuid}</b>
          {!loading && !data && (
            <span style={{ color: "#eb476d" }}> (not found)</span>
          )}
          <div style={{ marginTop: "0.4em" }}>
            <Button onClick={hostGame} disabled={hosting}>
              {hosting ? "Creating..." : "Host New Game"}
            </Button>
          </div>
          {hostError && (
            <div style={{ color: "#eb476d", fontSize: "0.8em" }}>
              {hostError}
            </div>
          )}
        </m.div>
        <div className="parent">
          <div className="innerBoard"></div>
          <CardRenderer pos={pos} showTokens={false}></CardRenderer>
          <TokenLayer shown={shownTokens} />
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
            <AnimatePresence>
              {userData?.map(({ figure, name, money, order }) => (
                <m.div
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
                  variants={fadeUp}
                  initial="hidden"
                  animate="show"
                  exit="exit"
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
                  <AnimatePresence>
                    {order == currentOrder && (
                      <m.i
                        key="turn"
                        className="fa-solid fa-check fa-xl"
                        style={{ color: "#63E6BE" }}
                        variants={pop}
                        initial="hidden"
                        animate="show"
                        exit="exit"
                      ></m.i>
                    )}
                  </AnimatePresence>
                </m.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </>
  );
}

export { Main };
