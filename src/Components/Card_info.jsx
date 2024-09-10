import React, { useMemo } from "react";
import styled from "styled-components";
import Button from "./Button";
import { Icon } from "./Icon";

import House from "../Icons/House.json";
import Building from "../Icons/Building.json";
import Handcuffs from "../Icons/handcuffs.json";
import Chest from "../Icons/chest.json";
import Finish from "../Icons/Finish.json";
import Bank_Check from "../Icons/Bank_Check.json";
import Locomotive from "../Icons/Locomotive.json";
import Garage from "../Icons/Garage.json";
import Slot from "../Icons/Slot.json";
import Bolt from "../Icons/Bolt.json";
import Ocean from "../Icons/Ocean.json";

const Card = styled.div`
  width: 20em;
  height: 30em;
  background-image: linear-gradient(163deg, #d92650 0%, #d92650 100%);
  border-radius: 20px 20px 10px 10px;
  transition: all 0.3s;
  box-shadow: 0px 0px 30px 1px rgb(217 38 80 / 30%);
  position: absolute;
  top: calc(50% - 30em / 2 - 3em);
  left: calc(50% - 20em / 2);
  z-index: 2;
`;

const Card2 = styled.div`
  width: 20em;
  height: 30em;
  background-color: #1a1a1a;
  border-radius: 20px 20px 10px 10px;

  transition: all 0.2s;
  transform: scale(0.99);
  position: relative;
  text-align: center;
  padding: 10px;
`;
const CardOverlay = styled.div`
  width: 100dvw;
  height: 100dvh;
  background-color: #1a1a1ad4;
  position: absolute;
  top: 0;
  left: 0;
  z-index: 2;
  backdrop-filter: blur(3px);
`;
const CardTitle = styled.div`
  font-size: 22px;
`;

const CardSubtitle = styled.div`
  font-size: 18px;
`;
const CardBody = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  align-items: center;
`;

const ButtonContainer = styled.div`
  display: flex;
  justify-content: space-between;
  padding: 10px 0px;
`;
const HotelContainer = styled.div`
  display: flex;
  height: 100%;
  flex-direction: column;
`;

const IconContainer = styled.div`
  display: flex;
  align-items: center;
  height: 64px;
  justify-content: space-between;
  width: 100%;
`;

const PriceContainer = styled.div`
  display: flex;
  justify-content: space-between;
  padding: 0 5px;
`;

const Chance_Card = styled.div`
  box-shadow: 0 8px 50px #71717163;
  background: #f5f5f5;
  width: 90%;
  height: 8em;
  border-radius: 10px;
`;
const IconBlock = ({ count, icon, price, housePrice }) => (
  <IconContainer>
    <div style={{ display: "flex" }}>
      {[...Array(count)].map((_, i) => (
        <Icon
          key={i}
          size={64 / count}
          icon={icon}
          primary="#fff"
          secondary="#888"
          loop={false}
          state="in-reveal"
        />
      ))}
    </div>
    <CardSubtitle>{price}$</CardSubtitle>
    <Button btnCont={{ "--accent": "#d92650", width: "25%" }}>
      {count * housePrice}$
    </Button>
  </IconContainer>
);

const CardLayout = ({
  name,
  children,
  buy,
  card,
  show,
  actionText,
  altAction,
}) => (
  <>
    <CardOverlay />
    <Card>
      <Card2>
        <CardBody>
          <CardTitle>{name}</CardTitle>
          {children}
        </CardBody>
      </Card2>
      <CardActions
        buy={buy}
        card={card}
        show={show}
        actionText={actionText}
        altAction={altAction}
      />
    </Card>
  </>
);

const CardActions = ({ buy, card, show, actionText = "Buy", altAction }) => (
  <ButtonContainer>
    <Button
      btnCont={{ "--accent": "#d92650", width: altAction ? "45%" : null }}
      onClick={() => {
        buy(card);
        show(false);
      }}
    >
      {actionText}
    </Button>
    {altAction && (
      <Button
        btnCont={{ "--accent": "#444", width: "45%" }}
        onClick={() => show(false)}
      >
        Pass
      </Button>
    )}
  </ButtonContainer>
);

const Card_Info = ({ name, price, housePrice, show, className, buy, card }) => {
  const iconBlocks = [
    { count: 1, price: (5 * price) / 10 },
    { count: 2, price: (15 * price) / 10 },
    { count: 3, price: (45 * price) / 10 },
    { count: 4, price: (62.5 * price) / 10 },
    {
      count: 1,
      icon: Building,
      price: (75 * price) / 10,
      housePrice: housePrice * 8,
    },
  ];

  return (
    <div className={className}>
      <CardLayout
        name={name}
        buy={buy}
        card={card}
        show={show}
        altAction={true}
      >
        <CardSubtitle style={{ fontSize: "16px" }}>
          Price With Rent
        </CardSubtitle>
        {iconBlocks.map(({ count, price, icon = House }, i) => (
          <IconBlock
            key={i}
            count={count}
            icon={icon}
            price={price}
            housePrice={housePrice}
          />
        ))}
        <PriceContainer>
          <CardSubtitle>Price: {price / 10}$</CardSubtitle>
          <CardSubtitle>Colour Set Price: {(2 * price) / 10}$</CardSubtitle>
        </PriceContainer>
      </CardLayout>
    </div>
  );
};

const Chance_info = ({
  name,
  show,
  className,
  buy,
  card,
  primary,
  secondary,
}) => (
  <div className={className}>
    <CardLayout
      name={name}
      buy={buy}
      card={card}
      show={show}
      actionText={"Take a Card"}
    >
      <CardSubtitle>Take A Card</CardSubtitle>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Icon
          size={128}
          icon={Slot}
          primary={primary}
          secondary={secondary}
          loop={false}
        />
      </div>
      <Chance_Card>
        <CardTitle style={{ color: "#000", fontWeight: "600" }}>
          CHANCE
        </CardTitle>
      </Chance_Card>
    </CardLayout>
  </div>
);

export { Card_Info, Chance_info };
