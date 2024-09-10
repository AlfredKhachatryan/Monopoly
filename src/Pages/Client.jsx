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
import { initialState } from "../Hooks/baseState";
let current = 0;

const groupByColor = (items) => {
  const colorOrder = [
    "#D92650",
    "#6F6CF5",
    "#F5786C",
    "#1F8F5D",
    "#1F8FFF",
    "#F56CC6",
    "#0942B3",
    "#DE951F",
  ];
  const grouped = items.reduce((acc, [key, value]) => {
    if (!acc[value.color]) {
      acc[value.color] = [];
    }
    acc[value.color].push([key, value]);
    return acc;
  }, {});
  return colorOrder.reduce((acc, color) => {
    if (grouped[color]) {
      acc[color] = grouped[color];
    }
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
  const PlayerId = JSON.parse(localStorage.playerInfo).playerId;
  // let PlayerId;
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
  const [isReveal, setIsReveal] = useState(false);

  const [result, setResult] = useState(0);
  const [resultShow, setResultShow] = useState(0);
  const [diceRolled, setDiceRolled] = useState(false);
  const [BoughtCards, setBoughtCards] = useState({});
  function BuyCard(data) {
    const obj = {};
    let baseItems;
    let position = pos;


    if (Object.keys(BoughtCards).length > 0) {
      baseItems = [...Object.entries(BoughtCards).map((e) => e[1]), data];
    } else {
      baseItems = [data];
    }
    for (let i = 1; i <= baseItems.length; i++) {
      obj[i] = {
        name: `ClientCard`,
        color: baseItems[i - 1].color,
        header: baseItems[i - 1].header,
        info: baseItems[i - 1].info,
        price: baseItems[i - 1].price,
        id: baseItems[i - 1].id,
      };
    }

    setBoughtCards(obj);
    const newPos = Object.values(obj).forEach((item) => {
      const id = item.id;
      if (position[id]) {
        position[id].info = JSON.parse(localStorage.playerInfo).name; // Change some property
      }
    });
    updateDB(uuid, {
      position: position,
    });
  }

  const items = Object.entries(BoughtCards);

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
  useEffect(() => {
    if (data) {
      const playerInfo = data.Players.filter((e) => e.playerId == PlayerId)[0];
      setState(data.position, playerInfo, data.Players, current);
      current = playerInfo?.position;
    }
  }, [data]);

  const handleInserts = (payload) => {
    const playerInfo = payload.new.Players.filter(
      (e) => e.playerId == PlayerId
    )[0];
    current = playerInfo?.position;
    setState(payload.new.position, playerInfo, payload.new.Players, current);
    console.log(current);
    if (current !== 0 && current !== 1) {
      setHide(true);
      setShow(true);
    }
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
    setIsReveal(false);
    setTimeout(() => {
      setIsReveal(true);
    }, 1500);
    setTimeout(() => {
      setIsReveal(false);
      setResultShow(0);
    }, 4500);
    const number = result;
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
    console.log("result: " + result);
    setResult(0);
  }

  useEffect(() => {
    if (diceRolled) {
      updatePos();
    }
  }, [diceRolled, result]);
  return (
    <>
      <div className="bg"></div>
      <MainContainer onClick={() => sidebar && setSidebar(false)}>
        {hideElem && (
          <Card_Info
            className={`fadeElem ${!show ? "fadeElem-exit" : ""}`}
            name={initialState()[PlayerInfo?.position]?.header}
            price={initialState()[PlayerInfo?.position]?.price}
            housePrice={50}
            show={hide}
            buy={BuyCard}
            card={initialState()[PlayerInfo?.position]}
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
              setResult={(e) => {
                setResult((prevResult) => prevResult + e);
                setResultShow((prevResult) => prevResult + e);
              }}
              setIsReveal={setIsReveal}
            />
            <DiceRoller
              click={click}
              setResult={(e) => {
                setResult((prevResult) => prevResult + e);
                setResultShow((prevResult) => prevResult + e);
                setDiceRolled(true);
              }}
            />
          </DiceContainer>
          <br />
          <ButtonStyled
            onClick={() => {
              setClick(1 + click);
              setResult(0);
              setDiceRolled(false);
            }}
            btnCont={{ "--accent": "#d92650" }}
          >
            Roll The Dice
          </ButtonStyled>
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
                  Players: Players.filter(
                    (e) => e.figure !== PlayerInfo.figure
                  ),
                });
              }}
            >
              Leave
            </Button>
          </Link>
          <br />
          <Button
            onClick={() => {
              const updatedArray = Players.map((item) =>
                item.playerId === PlayerInfo.playerId
                  ? { ...PlayerInfo, position: 1 }
                  : item
              );
              updateDB(uuid, {
                position: updateItem(PlayerInfo.figure, 1),
                Players: updatedArray,
              });
            }}
          >
            Reset
          </Button>
        </CenteredContent>
        <Footer />
        <div id="diceResult" className={isReveal ? "reveal" : "hide"}>
          You've got: {resultShow}
        </div>
      </MainContainer>
    </>
  );
}
export { Client };
