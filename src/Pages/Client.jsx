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
  Owner_Card_Info,
} from "../Components/Card_info";

import {
  MainContainer,
  RelativeDiv,
  SideBar,
  DiceContainer,
  CenteredContent,
  SidebarCard,
  ButtonStyled,
  ClientMoney,
  HouseContainer,
} from "../Components/Client/ClientElements";

import CardRenderer from "../Components/CardRenderer";

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
  const [result, setResult] = useState(null);
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

    const otherPlayers = [...Players];

    // Check if the player has enough money
    if (player.money < data.price) {
      return console.log("Not Enough Money");
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

    const updatedPlayers = otherPlayers.map((p) => {
      if (p.figure === player.figure) {
        return player; // Update current player
      }
      return p; // Leave other players unchanged
    });
    // Update the database with the new positions and players
    updateDB(uuid, {
      position: position,
      Players: updatedPlayers,
    });
  }

  function Pay(card) {
    const player = { ...PlayerInfo };
    const otherPlayers = [...Players];

    const cardOwnerId = Object.entries(card.bought).filter(
      (e) => e[1] == true
    )[0][0];

    const cardOwnerInfo = Object.entries(otherPlayers)
      .map((e) => e[1])
      .filter((e) => e.figure == cardOwnerId)[0];

    let newPlayer = { ...player, money: player?.money - card.price / 10 };

    let newOwner = {
      ...cardOwnerInfo,
      money: cardOwnerInfo?.money + card.price / 10,
    };

    const updatedPlayers = otherPlayers.map((p) => {
      if (p.figure === player.figure) {
        return newPlayer; // Update current player
      } else if (p.figure === cardOwnerInfo.figure) {
        return newOwner; // Update card owner
      }
      return p; // Leave other players unchanged
    });

    updateDB(uuid, {
      Players: updatedPlayers,
    });
  }

  function PayTaxes(card) {
    const player = { ...PlayerInfo };
    const otherPlayers = [...Players];

    let newPlayer = { ...player, money: player?.money - card.price };

    const updatedPlayers = otherPlayers.map((p) => {
      if (p.figure === player.figure) {
        return newPlayer; // Update current player
      }
      return p; // Leave other players unchanged
    });

    updateDB(uuid, {
      Players: updatedPlayers,
    });
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

  useEffect(() => {
    console.log(result);
  }, [result]);
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
  function updatePos(result) {
    setIsReveal(false);
    setTimeout(() => {
      setIsReveal(true);
    }, 1500);
    setTimeout(() => {
      setIsReveal(false);
      setResultShow(0);
    }, 4500);
    current += result;
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
      current_order: order1 > 0 ? order1 - 1 : 0,
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
              if (
                Object.values(bought).some((value) => value === true) &&
                !bought[PlayerInfo.figure]
              ) {
                return Bought_Card_Info;
              }
              if (
                Object.values(bought).some((value) => value === true) &&
                bought[PlayerInfo.figure]
              ) {
                return Owner_Card_Info;
              }
              return Card_Info; // Fallback in case none of the above matches
            };

            const Component = getComponent(); // Get the component to render
            const currentCard = pos[PlayerInfo?.position]; // Retrieve current card info from the state

            return (
              <Component
                className={`fadeElem ${!show ? "fadeElem-exit" : ""}`}
                name={currentCard?.header}
                price={currentCard?.basePrice || currentCard?.price}
                housePrice={50}
                show={hide}
                buy={BuyCard}
                card={currentCard}
                bought={bought}
                pay={Pay}
                payTaxes={PayTaxes}
              />
            );
          })()}
        <RelativeDiv>
          <SideBar setSidebar={setSidebar} sidebar={sidebar} />

          <HouseContainer
            setSidebar={setSidebar}
            sidebar={sidebar}
            groupedItems={groupedItems}
          />
          <ClientMoney money={PlayerInfo?.money || 2000} />

          <SidebarCard>
            <div className="sideBarItem">
              <i className="fa-duotone fa-cards-blank"></i>&nbsp;
              <span>Cards</span>
            </div>
          </SidebarCard>
          {PlayerInfo?.order !== order && (
            <h3
              style={{
                position: "absolute",
                left: " calc(50% - 3em)",
                bottom: "2em",
              }}
            >
              Not Your Turn
            </h3>
          )}
        </RelativeDiv>

        <CenteredContent>
          <DiceContainer>
            <DiceRoller
              click={click}
              setResult={(e) => {
                setResult(e);
                setResultShow(e);
                updatePos(e); // Pass the result directly to updatePos
              }}
              setIsReveal={setIsReveal}
            />
          </DiceContainer>
          <br />
          <ButtonStyled
            onClick={() => {
              if (PlayerInfo?.order == order) {
                setClick(1 + click);
                setDiceRolled(false);
              } else {
                alert(0);
              }
            }}
            btnCont={{ "--accent": "#d92650" }}
            disabled={PlayerInfo?.order !== order}
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
