import { useEffect, useState, useRef } from "react";
import Button from "../Components/Button";
import { useRealtimeUpdates, updateDB, useFetch } from "../Hooks/supabase";
import { Link } from "react-router-dom";
import DiceRoller from "../Components/Dice";
import { Footer } from "../Components/Footer";
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
  Bought_Card_Info,
} from "../Components/Card_info";

import {
  MainContainer,
  RelativeDiv,
  FlexColumn,
  FlexRow,
  Sidebar,
  ClientMoneyContainer,
  DiceContainer,
  CenteredContent,
  Divider,
  SidebarCard,
  ButtonStyled,
} from "../Components/ClientElements";

import { Card_Map } from "../Components/Card_Map";
import { initialState } from "../Hooks/baseState";

import { groupByColor } from "../Hooks/groupByColor";

let current = 0;

function Client() {
  const PlayerId = JSON.parse(localStorage.playerInfo).playerId;

  // let PlayerId;
  const uuid = "v6Pstf";

  const { data, error, loading } = useFetch(uuid);

  const [pos, setPos] = useState(null);
  const [Players, setPlayers] = useState(null);
  const [PlayerInfo, setPlayerInfo] = useState(null);

  const [currentPos, setCurrentPos] = useState(1);
  const [click, setClick] = useState(0);
  const [result, setResult] = useState(0);
  const [resultShow, setResultShow] = useState(0);
  const [order, setOrder] = useState(0);

  const [diceRolled, setDiceRolled] = useState(false);
  const [show, setShow] = useState(false); //show Card
  const [hideElem, setHide] = useState(true);
  const [sidebar, setSidebar] = useState(false);
  const [isReveal, setIsReveal] = useState(false);

  const [BoughtCards, setBoughtCards] = useState({});

  const prevPos = useRef(currentPos);
  function BuyCard(data) {
    const figure = PlayerInfo.figure;
    const player = { ...PlayerInfo };
    const position = { ...pos };

    // Check if the player has enough money
    if (player.money < data.price) {
      console.log("Not Enough Money");
      return;
    }

    // Build the list of bought cards, including the new one
    const baseItems =
      Object.keys(BoughtCards).length > 0
        ? [...Object.values(BoughtCards), data]
        : [data];

    // Create the object to store bought cards
    const obj = baseItems.reduce((acc, item, index) => {
      acc[index + 1] = {
        name: "ClientCard",
        color: item.color,
        header: item.header,
        info: item.info,
        price: item.price,
        id: item.id,
        start: item.start,
        community: item.community,
        tax: item.tax,
        road: item.road,
        chance: item.chance,
        jail: item.jail,
        communal: item.communal,
        parking: item.parking,
        GTJ: item.GTJ,
      };
      return acc;
    }, {});

    // Update the position for each bought card based on figure
    Object.values(obj).forEach(({ id }) => {
      if (position[id]) {
        position[id].bought[figure] = true; // Mark the card as bought for this figure
      }
    });

    // Update the state with new bought cards and player info
    setBoughtCards(obj);
    player.money -= data.price;
    setPlayerInfo(player);

    // Update the database with the new positions and players
    updateDB(uuid, { position, Players });

    console.log(Players);
  }

  const items = Object.entries(BoughtCards);

  // Группируем элементы по цветам
  const groupedItems = groupByColor(items);

  function setState(pos, curPlayer, Players, curPos, order) {
    if (pos) {
      setPos(pos);
    }
    setPlayerInfo(curPlayer);
    setCurrentPos(curPos);
    setPlayers(Players);
    setOrder(order);
  }

  async function hide(state) {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    setShow(state);
    await wait(150);
    setHide(state);
    updateDB(uuid, {
      current_order: changeOrder(order),
    });
  }

  useEffect(() => {
    if (data) {
      const playerInfo = data.Players.filter((e) => e.playerId == PlayerId)[0];
      setState(
        data.position,
        playerInfo,
        data.Players,
        current,
        data.current_order
      );
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
    setState(
      payload.new.position,
      playerInfo,
      payload.new.Players,
      current,
      payload.new.current_order
    );
  };

  useRealtimeUpdates(handleInserts);

  const updateItem = (figKey, newPosition) => {
    const newState = { ...pos };
    let lastItemKey = null;
    //figX ex.fig0
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
  function changeOrder(order) {
    let currentOrder = order;
    if (Players.length - 1 <= currentOrder) {
      return (currentOrder = 0);
    } else {
      return ++currentOrder;
    }
  }
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
    setResult(0);
  }
  
  function removePlayer() {
    let order1 = order;
    const updatedPlayers = Players.filter(
      (e) => e.figure !== PlayerInfo.figure
    );
    const reorderedPlayers = updatedPlayers.map((player, index) => ({
      ...player,
      order: index, // Reassign the order based on their new position in the array
    }));
    updateDB(uuid, {
      position: Object.fromEntries(
        Object.entries(pos).map(([key, value]) => [
          key,
          { ...value, [PlayerInfo.figure]: false },
        ])
      ),
      Players: reorderedPlayers,
      current_order: order1 - 1,
    });
    localStorage.clear();
  }

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
              bought,
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
              if (Object.values(bought).some((value) => value === true)) {
                return Bought_Card_Info;
              }
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
                bought={bought}
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
              if (PlayerInfo.order == order) {
                setClick(1 + click);
                setResult(0);
                setDiceRolled(false);
                updatePos();
              } else {
                alert(0);
              }
            }}
            btnCont={{ "--accent": "#d92650" }}
          >
            Roll The Dice
          </ButtonStyled>
          <br />
          <Link to="/Login">
            <Button
              onClick={() => {
                removePlayer();
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
