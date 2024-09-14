import { useEffect, useState, useRef } from "react";
import Button from "../Components/Button";
import Input from "../Components/Input";
import { SelectFigure } from "../Components/SelectFigure";
import { useRealtimeUpdates, updateDB, useFetch } from "../Hooks/supabase";
import { Link } from "react-router-dom";
import DiceRoller from "../Components/Dice";
import { Footer } from "../Components/Footer";
import { FigureBox } from "../Components/FigureBox";
import BG from "../Components/BG";
import {
  Card_Info,
  Chance_info,
  Cummunity_info,
  Tax_Info,
  RailRoad_Info,
  Jail_Info,
  Communal_Info,
  Park_Info,
  GTJ_Info,
  Start_Info,
} from "../Components/Card_info";
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
  min-height: 100dvh;
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

  const prevPos = useRef(currentPos);

  function BuyCard(data) {
    const obj = {};
    let baseItems;
    let position = pos;
    let Player = PlayerInfo;

    if (PlayerInfo.money - data.price >= 0) {
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
          start: baseItems[i - 1].start,
          community: baseItems[i - 1].community,
          tax: baseItems[i - 1].tax,
          road: baseItems[i - 1].road,
          chance: baseItems[i - 1].chance,
          jail: baseItems[i - 1].jail,
          communal: baseItems[i - 1].communal,
          parking: baseItems[i - 1].parking,
          GTJ: baseItems[i - 1].GTJ,
        };
      }

      Object.values(obj).forEach((item) => {
        const id = item.id;
        if (position[id]) {
          position[id].info = JSON.parse(localStorage.playerInfo).name; // Change some property
        }
      });

      setBoughtCards(obj);
      Player.money = PlayerInfo.money - data.price;
      setPlayerInfo(Player);
      updateDB(uuid, {
        position: position,
        Players: Players.filter((e) => e.figure == PlayerInfo.figure),
      });
    } else {
      console.log("Not Enough Money");
    }
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
    if (current !== prevPos.current) {
      setTimeout(() => {
        setHide(true);
        setShow(true);
      }, 1700);
    }
    prevPos.current = current;
    setState(payload.new.position, playerInfo, payload.new.Players, current);
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
      <BG />
      <MainContainer onClick={() => sidebar && setSidebar(false)}>
        {hideElem &&
          pos &&
          pos[PlayerInfo?.position] &&
          (() => {
            const currentPos = pos[PlayerInfo?.position]; // Access the current position data
            const {
              start,
              community,
              tax,
              road,
              chance,
              jail,
              communal,
              parking,
              GTJ,
            } = currentPos; // Destructure the keys from the current position object

            // Function to get the appropriate component based on the keys
            const getComponent = () => {
              if (start) return Start_Info;
              if (community) return Cummunity_info;
              if (tax) return Tax_Info;
              if (road) return RailRoad_Info;
              if (chance) return Chance_info;
              if (jail) return Jail_Info;
              if (communal) return Communal_Info;
              if (parking) return Park_Info;
              if (GTJ) return GTJ_Info;

              return Card_Info; // Fallback in case none of the above matches
            };

            const Component = getComponent(); // Get the component to render
            const currentCard = initialState()[PlayerInfo?.position]; // Retrieve current card info from the state

            return (
              <Component
                className={`fadeElem ${!show ? "fadeElem-exit" : ""}`}
                name={currentCard?.header}
                price={currentCard?.price}
                housePrice={50}
                show={hide}
                buy={BuyCard}
                card={currentCard}
              />
            );
          })()}
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
                    const { name, ...props } = value;
                    return (
                      <Card_Map
                        className={`${name} clientCard`}
                        onClick={(e) => e.stopPropagation()}
                        {...value}
                      />
                    );
                  })}
                </FlexRow>
              ))}
            </FlexColumn>
          </div>
          <ClientMoneyContainer>
            <span>${PlayerInfo?.money}</span>
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
                  ? { ...PlayerInfo, position: 5 }
                  : item
              );
              updateDB(uuid, {
                position: updateItem(PlayerInfo.figure, 5),
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
