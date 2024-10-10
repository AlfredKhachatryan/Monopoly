import { useEffect, useState } from "react";
import { initialState } from "../Hooks/baseState";
import CardRenderer from "../Components/CardRenderer";
import Button from "../Components/Button";
import ShortUniqueId from "short-unique-id";
import { useRealtimeUpdates, useFetch, updateDB } from "../Hooks/supabase";
import { Chance } from "../Components/Chance";
function Main() {
  const short = new ShortUniqueId({ length: 10 }); //genrates uuid for future
  const uuid = "v6Pstf"; // static uuid

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

  useRealtimeUpdates(handleInserts); //when DB is updated he does some function

  return (
    <>
      <div className="boardBG"></div>
      <div className="cont">
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
                <div className={`fig ${figure}`} key={name}></div>
                <span>
                  {name}: {money + "$"}
                </span>
                {order == currentOrder && (
                  <i
                    class="fa-solid fa-check fa-xl"
                    style={{ color: "#63E6BE" }}
                  ></i>
                )}
              </div>
            ))}
          </div>
          {/* <div className="BaseInfo flexCent" style={{ textAlign: "center" }}>
            {uuid}
            <br /> 192.168.0.221:3000/Login
          </div> */}
        </div>
      </div>
    </>
  );
}

export { Main };
