import { useEffect, useState } from "react";
import { initialState } from "../Hooks/baseState";
import {
  Card_Map,
  Start_Card,
  Community_Card,
  Tax_Card,
  RailRoad_Card,
  Chance_Card,
  Jail_Card,
  Communal_Card,
  Park_Card,
  GTJ_Card,
} from "../Components/Card_Map";
import Button from "../Components/Button";
import ShortUniqueId from "short-unique-id";
import { FigureBox } from "../Components/FigureBox";
import { useRealtimeUpdates, useFetch, updateDB } from "../Hooks/supabase";

function Main() {
  const short = new ShortUniqueId({ length: 10 }); //genrates uuid for future
  const uuid = "v6Pstf"; // static uuid

  const [pos, setPos] = useState(initialState());
  const [userData, setUserData] = useState(null);

  const { data, error, loading } = useFetch(uuid);

  function updatePos(pos, user) {
    if (pos) {
      setPos(pos);
    }
    setUserData(user);
  }

  useEffect(() => {
    if (data) {
      updatePos(data.position, data.Players);
    }
  }, [data]);

  const handleInserts = (payload) => {
    updatePos(payload.new.position, payload.new.Players);
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
          {Object.entries(pos).map(([key, value]) => {
            const {
              name,
              color,
              header,
              info,
              price,
              start,
              community,
              tax,
              road,
              chance,
              jail,
              communal,
              parking,
              GTJ,
              icon,
              primary,
              secondary,
              state,
              id,
              bought,
              ...figures
            } = value;
            const getComponent = () => {
              if (start) return Start_Card;
              if (community) return Community_Card;
              if (tax) return Tax_Card;
              if (road) return RailRoad_Card;
              if (chance) return Chance_Card;
              if (jail) return Jail_Card;
              if (communal) return Communal_Card;
              if (parking) return Park_Card;
              if (GTJ) return GTJ_Card;
              return Card_Map; // Fallback in case none of the above matches
            };

            const Component = getComponent();
            return (
              <Component
                className={name}
                key={key}
                color={color}
                header={header}
                info={info}
                price={price}
                icon={icon}
                primary={primary} //colors for icon
                secondary={secondary} //colors for icon
                state={state} //animation for icon
              >
                <FigureBox
                  show={figures} //in each cell there is {fig0:false,fig1:false ...etc}
                  style={{ height: "30px", position: "absolute", zIndex: 2 }}
                />
              </Component>
            );
          })}
          <div className="ChanceOutline flexCent">Chance</div>
          <div className="BonusOutline flexCent">Bonus</div>
          <div className="PlayerInfo flexCent">
            {userData?.map(({ figure, name, money }) => (
              <>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    width: "80%",
                  }}
                >
                  <div className={`fig ${figure}`} key={name}></div>
                  &nbsp;
                  <span> {name}:</span>
                  <span>{money + "$"}</span>
                </div>
              </>
            ))}
          </div>
          {/* <div className="BaseInfo flexCent" style={{ textAlign: "center" }}>
            {uuid}
            <br /> 192.168.0.221:3000/Login
          </div> */}
          <Button onClick={() => handleClick()}>Click</Button>
        </div>
      </div>
    </>
  );
}

export { Main };
