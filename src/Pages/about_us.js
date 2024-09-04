import { useEffect, useState } from "react";
import { Card_Map } from "../Components/Card_Map";
import Button from "../Components/Button";
import ShortUniqueId from "short-unique-id";
import { FigureBox } from "../Components/FigureBox";
import { useRealtimeUpdates, useFetch, updateDB } from "../Hooks/supabase";

function initialState() {
  const baseItems = [
    { header: "Старт", info: "Старт", color: "#000" },
    { header: "Зайка", info: "Ownd By ''", color: "#d92650", price: 60 },
    { header: "Community", info: "Community", color: "#000" },
    { header: "Статуя Гая", info: "Ownd By ''", color: "#d92650", price: 60 },
    { header: "Tax", info: "Tax", color: "#000" },
    { header: "RailRoad", info: "RailRoad", color: "#000" },
    { header: "Фирмини", info: "Ownd By ''", color: "#6F6CF5", price: 100 },
    { header: "Chance", info: "Chance", color: "#000" },
    { header: "Чинар", info: "Ownd By ''", color: "#6F6CF5", price: 100 },
    { header: "Циран", info: "Ownd By ''", color: "#6F6CF5", price: 120 },
    { header: "Jail", info: "Jail", color: "#000" },
    { header: "Дом Афо", info: "Ownd By ''", color: "#F5786C", price: 140 },
    { header: "Communal", info: "Light", color: "#000" },
    { header: "Дом Эро", info: "Ownd By ''", color: "#F5786C", price: 140 },
    { header: "Дом Коли", info: "Ownd By ''", color: "#F5786C", price: 160 },
    { header: "RailRoad", info: "RailRoad", color: "#000" },
    { header: "Далма Молл", info: "Ownd By ''", color: "#1F8F5D", price: 160 },
    { header: "Community", info: "Community", color: "#000" },
    { header: "Ереван Молл", info: "Ownd By ''", color: "#1F8F5D", price: 180 },
    { header: "Мега Молл", info: "Ownd By ''", color: "#1F8F5D", price: 200 },
    { header: "Park", info: "Park", color: "#000" },
    { header: "Minecraft", info: "Ownd By ''", color: "#1F8FFF", price: 220 },
    { header: "Chance", info: "Chance", color: "#000" },
    { header: "LOL", info: "Ownd By ''", color: "#1F8FFF", price: 220 },
    { header: "For Honor", info: "Ownd By ''", color: "#1F8FFF", price: 240 },
    { header: "RailRoad", info: "RailRoad", color: "#000" },
    { header: "Ubisoft", info: "Ownd By ''", color: "#F56CC6", price: 260 },
    { header: "Communal", info: "Water", color: "#000" },
    { header: "EGS", info: "Ownd By ''", color: "#F56CC6", price: 260 },
    { header: "Steam", info: "Ownd By ''", color: "#F56CC6", price: 280 },
    { header: "Jail", info: "Go To Jail", color: "#000" },
    { header: "Spotify", info: "Ownd By ''", color: "#0942B3", price: 300 },
    { header: "Community", info: "Community", color: "#000" },
    { header: "Discord", info: "Ownd By ''", color: "#0942B3", price: 300 },
    { header: "Windows", info: "Ownd By ''", color: "#0942B3", price: 320 },
    { header: "RailRoad", info: "RailRoad", color: "#000" },
    { header: "Chance", info: "Chance", color: "#000" },
    {
      header: "Rainbox 6 Siege",
      info: "Ownd By ''",
      color: "#DE951F",
      price: 350,
    },
    { header: "Tax", info: "Luxury Tax", color: "#000" },
    { header: "Dota 2", info: "Ownd By ''", color: "#DE951F", price: 400 },
  ];

  const obj = {};

  for (let i = 1; i <= baseItems.length; i++) {
    obj[i] = {
      fig0: false,
      fig1: false,
      fig2: false,
      fig3: false,
      name: `itemCard${i}`,
      color: baseItems[i - 1].color,
      header: baseItems[i - 1].header,
      info: baseItems[i - 1].info,
      price: baseItems[i - 1].price,
    };
  }

  return obj;
}

function Main() {
  const short = new ShortUniqueId({ length: 10 });

  const uuid = "v6Pstf";

  const [pos, setPos] = useState(initialState());
  const [userData, setUserData] = useState(null);

  const { data, error, loading } = useFetch(uuid);

  function updatePos(pos, user) {
    setPos(pos);
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

  useRealtimeUpdates(handleInserts);

  return (
    <>
      {/* <div className="bg"></div> */}
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
              ...figures
            } = value;

            return (
              <Card_Map
                className={name}
                key={key}
                color={color}
                header={header}
                info={info}
                price={price}
              >
                <FigureBox show={figures}></FigureBox>
              </Card_Map>
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
          <div className="BaseInfo flexCent" style={{ textAlign: "center" }}>
            {uuid}
            <br /> 192.168.0.221:3000/Login
          </div>
          <Button
            onClick={() => {
              // updateDB(uuid, { position: initialState() });\
              setPos(initialState());
            }}
          >
            Click
          </Button>
        </div>
      </div>
    </>
  );
}

export { Main };
