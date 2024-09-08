import { useEffect, useState, useRef } from "react";
import Button from "../Components/Button";
import Input from "../Components/Input";
import { SelectFigure } from "../Components/SelectFigure";
import { useRealtimeUpdates, updateDB, useFetch } from "../Hooks/supabase";
import { Link } from "react-router-dom";
import DiceRoller from "../Components/Dice";
import { Footer } from "../Components/Footer";
import { FigureBox } from "../Components/FigureBox";
import Card_Info from "../Components/Card_info";
import { Card_Map } from "../Components/Card_Map";
import styled from "styled-components";
let current = 0;
function initialState() {
  const obj = {};
  const baseItems = [
    { header: "Зайка", info: "Ownd By ''", color: "#d92650", price: 60 },
    { header: "Статуя Гая", info: "Ownd By ''", color: "#d92650", price: 60 },
    { header: "Фирмини", info: "Ownd By ''", color: "#6F6CF5", price: 100 },
    { header: "Чинар", info: "Ownd By ''", color: "#6F6CF5", price: 100 },
    { header: "Циран", info: "Ownd By ''", color: "#6F6CF5", price: 120 },
    { header: "Дом Афо", info: "Ownd By ''", color: "#F5786C", price: 140 },
    { header: "Дом Эро", info: "Ownd By ''", color: "#F5786C", price: 140 },
    { header: "Дом Коли", info: "Ownd By ''", color: "#F5786C", price: 160 },
    { header: "Далма Молл", info: "Ownd By ''", color: "#1F8F5D", price: 160 },
    { header: "Ереван Молл", info: "Ownd By ''", color: "#1F8F5D", price: 180 },
    { header: "Мега Молл", info: "Ownd By ''", color: "#1F8F5D", price: 200 },
    { header: "Minecraft", info: "Ownd By ''", color: "#1F8FFF", price: 220 },
    { header: "For Honor", info: "Ownd By ''", color: "#1F8FFF", price: 240 },
    { header: "Ubisoft", info: "Ownd By ''", color: "#F56CC6", price: 260 },
    { header: "EGS", info: "Ownd By ''", color: "#F56CC6", price: 260 },
    { header: "Steam", info: "Ownd By ''", color: "#F56CC6", price: 280 },
    { header: "Spotify", info: "Ownd By ''", color: "#0942B3", price: 300 },
    { header: "Discord", info: "Ownd By ''", color: "#0942B3", price: 300 },
    { header: "Windows", info: "Ownd By ''", color: "#0942B3", price: 320 },
    {
      header: "Rainbox 6 Siege",
      info: "Ownd By ''",
      color: "#DE951F",
      price: 350,
    },
    { header: "Dota 2", info: "Ownd By ''", color: "#DE951F", price: 400 },
  ];

  for (let i = 1; i <= baseItems.length; i++) {
    obj[i] = {
      fig0: false,
      fig1: false,
      fig2: false,
      fig3: false,
      name: `ClientCard`,
      color: baseItems[i - 1].color,
      header: baseItems[i - 1].header,
      info: baseItems[i - 1].info,
      price: baseItems[i - 1].price,
    };
  }

  return obj;
}
const sortedItems = Object.entries(initialState()).sort(
  ([keyA, valueA], [keyB, valueB]) => {
    return valueA.color.localeCompare(valueB.color);
  }
);

const groupByColor = (items) => {
  return items.reduce((acc, [key, value]) => {
    if (!acc[value.color]) {
      acc[value.color] = [];
    }
    acc[value.color].push([key, value]);
    return acc;
  }, {});
};

const MainContainer = styled.div`
  padding-top: 1em;
  display: flex;
  flex-direction: column;
  /* justify-content: space-between; */
  /* min-height: 100dvh; */
`;

const RelativeDiv = styled.div`
  position: relative;
  height: 10em;
  width: 100%;
`;

const FlexColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2em;
`;

const FlexRow = styled.div`
  display: flex;
  gap: 1em;
`;

const Sidebar = styled.div`
  position: absolute;
  width: 1.5em;
  height: 10em;
  border-radius: 0px 5px 5px 0px;
  background-color: #d92650;
  /* background-color: #4F8C5F; */
  color: white;
  display: flex;
  justify-content: center;
  align-items: center;
  flex-direction: column;
  z-index: 1;
  transition: 0.35s ease-in-out;
  left: 0;
  &.sideBarRight {
    left: 85vw;
    z-index: 7;
    box-shadow: 0 0 15px 5px #00000063;
  }
`;

const ClientMoneyContainer = styled.div`
  display: flex;
  color: white;
  align-items: center;
  font-size: 14px;
  font-weight: 500;
  align-self: end;
  min-width: 5em;
  height: 2rem;
  background-color: #d92650;
  position: absolute;
  right: 0;
  z-index: 1;
  border-radius: 5px 0px 0px 5px;
  padding: 0px 5px;
  display: grid;
  grid-template-columns: 1fr 2px 1em;
  grid-template-rows: 1fr;
  grid-column-gap: 10px;
  grid-row-gap: 10px;
  justify-items: center;
  align-items: center;
  z-index: 5;
  box-shadow: 0 0 15px 5px #00000052;
`;

const DiceContainer = styled.div`
  display: flex;
  justify-content: space-between;
  width: calc(180px + 2em);
`;

const CenteredContent = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 60%;
  align-self: center;
`;

const Divider = styled.div`
  border: 1px solid white;
  height: 100%;
`;

const SidebarCard = styled(Sidebar)`
  left: unset;
  right: 0;
  height: 7em;
  bottom: 0;
  border-radius: 5px 0px 0px 5px;
`;

const ButtonStyled = styled(Button)`
  /* You can move Button styles here */
`;

function Client() {
  // const PlayerId = JSON.parse(localStorage.playerInfo).playerId;
  let PlayerId;
  const uuid = "v6Pstf";
  const [pos, setPos] = useState(null);
  const [show, setShow] = useState(false); //show Card
  const [hideElem, setHide] = useState(true);
  const [sidebar, setSidebar] = useState(false);
  const [Players, setPlayers] = useState(null);
  const [PlayerInfo, setPlayerInfo] = useState(null);
  const { data, error, loading } = useFetch(uuid);
  const [currentPos, setCurrentPos] = useState(1);
  const [click, setClick] = useState(0);
  const [dice1Value, setDice1Value] = useState(0);
  const [dice2Value, setDice2Value] = useState(0);
  const [isReveal, setIsReveal] = useState(false);

  const items = Object.entries(initialState());

  // Группируем элементы по цветам
  const groupedItems = groupByColor(items);

  function setState(pos, curPlayer, Players, curPos) {
    setPos(pos);
    setPlayerInfo(curPlayer);
    setCurrentPos(curPos);
    setPlayers(Players);
  }

  async function hide(state) {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    setShow(state);
    await wait(150);
    setHide(state);
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
      <MainContainer onClick={() => sidebar && setSidebar(false)}>
        {hideElem && (
          <Card_Info
            className={`fadeElem ${!show ? "fadeElem-exit" : ""}`}
            name="Статуя Гая"
            price={60}
            housePrice={50}
            show={hide}
          />
        )}
        <RelativeDiv>
          <Sidebar
            className={` ${sidebar && "sideBarRight"}`}
            onClick={() => setSidebar(!sidebar)}
          >
            <div className="sideBarItem">
              <i className="fa-duotone fa-house"></i>&nbsp;<span>Houses</span>
            </div>
          </Sidebar>

          <div
            className={`HouseContainer ${sidebar && "HouseContainerShow"}`}
            onClick={() => setSidebar(false)}
          >
            <FlexColumn>
              {Object.entries(groupedItems).map(([color, items], index) => (
                <FlexRow key={index}>
                  {items.map(([key, value]) => {
                    const { name, header, info, price } = value;
                    return (
                      <Card_Map
                        className={`${name} clientCard`}
                        key={key}
                        color={color}
                        header={header}
                        info={info}
                        price={price}
                        onClick={(e) => e.stopPropagation()}
                      />
                    );
                  })}
                </FlexRow>
              ))}
            </FlexColumn>
          </div>

          <ClientMoneyContainer>
            <span>$2500</span>
            <Divider />
            <div className="CMItemWallet">
              <i
                className="fa-regular fa-wallet"
                style={{ zIndex: 2, position: "relative" }}
              ></i>
            </div>
          </ClientMoneyContainer>

          <SidebarCard>
            <div className="sideBarItem">
              <i className="fa-duotone fa-cards-blank"></i>&nbsp;
              <span>Cards</span>
            </div>
          </SidebarCard>
        </RelativeDiv>

        <CenteredContent>
          {/* <h1 style={{ textAlign: "center" }}>
            Name: {PlayerInfo?.name} <br /> Pos:{currentPos}
          </h1> */}
          <DiceContainer>
            <DiceRoller
              click={click}
              setResult={setDice1Value}
              setIsReveal={setIsReveal}
            />
            <DiceRoller click={click} setResult={setDice2Value} />
          </DiceContainer>
          <br />
          <ButtonStyled
            onClick={() => {
              setClick(1 + click);
              setIsReveal(false);
              setTimeout(() => {
                setIsReveal(true);
              }, 1500);
              setTimeout(() => {
                setIsReveal(false);
              }, 4500);
            }}
            btnCont={{ "--accent": "#d92650" }}
          >
            Roll The Dice
          </ButtonStyled>
          <br />
          {/* <Link to="/Login">
            <Button>Leave</Button>
          </Link> */}
          <br />
        </CenteredContent>
        <Footer />
        <div id="diceResult" className={isReveal ? "reveal" : "hide"}>
          You've got: {dice1Value + dice2Value}
        </div>
      </MainContainer>
    </>
  );
}
export { Client };
