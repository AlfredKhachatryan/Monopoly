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

const hexToRgb = (hex) => {
  const bigint = parseInt(hex.slice(1), 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `${r}, ${g}, ${b}`;
};

const Card = styled.div`
  width: 20em;
  height: 30em;
  background-image: linear-gradient(
    163deg,
    var(--primary) 0%,
    var(--secondary) 100%
  );
  border-radius: 20px 20px 10px 10px;
  transition: all 0.3s;
  box-shadow: 0px 0px 30px 1px rgba(${(props) => hexToRgb(props.primary)}, 0.3);
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
  align-self: stretch;
  margin-top: auto;
`;

const Chance_Card = styled.div`
  box-shadow: 0 8px 50px #71717163;
  background: #f5f5f5;
  width: 90%;
  height: 8em;
  border-radius: 10px;
`;
const IconBlock = ({ count, icon, price, housePrice, accent = "#d92650" }) => (
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
    <Button btnCont={{ "--accent": accent, width: "25%" }}>
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
  primary = "#d92650",
  secondary = "#d92650",
}) => (
  <>
    <CardOverlay />
    <Card
      style={{
        "--primary": primary,
        "--secondary": secondary,
      }}
      primary={secondary}
    >
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
        accent={primary}
      />
    </Card>
  </>
);

const CardActions = ({
  buy,
  card,
  show,
  actionText = "Buy",
  altAction,
  accent = "#d92650",
}) => (
  <ButtonContainer>
    <Button
      btnCont={{ "--accent": accent, width: altAction ? "45%" : null }}
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
        onClick={() => {
          show(false);
        }}
      >
        Pass
      </Button>
    )}
  </ButtonContainer>
);

const Base_Card = ({
  name,
  show,
  className,
  buy,
  card,
  icon,
  primaryColor,
  secondaryColor,
  title,
  community,
  actionText,
  subtitle,
  altAction,
  price,
  state,
  primary,
  secondary,
}) => (
  <div className={className}>
    <CardLayout
      name={name}
      buy={() => {
        console.log(card);
      }}
      card={card}
      show={show}
      actionText={actionText || "Take a Card"}
      altAction={altAction}
      primary={primaryColor}
      secondary={secondaryColor}
    >
      <CardSubtitle>{subtitle}</CardSubtitle>
      {price && <CardSubtitle>{price}$</CardSubtitle>}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Icon
          size={128}
          icon={icon}
          primary={primaryColor}
          secondary={secondaryColor}
          loop={false}
          state={state}
        />
      </div>
      {community && (
        <Chance_Card>
          <CardTitle style={{ color: "#000", fontWeight: "600" }}>
            {title}
          </CardTitle>
        </Chance_Card>
      )}
    </CardLayout>
  </div>
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
        primary={card.color}
        secondary={card.color}
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
            accent={card.color}
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

const Bought_Card_Info = ({
  name,
  price,
  housePrice,
  show,
  className,
  buy,
  card,
  pay,
}) => {
  return (
    <div className={className}>
      <CardLayout
        name={name}
        buy={pay}
        card={card}
        show={show}
        // altAction={true}
        primary={card.color}
        secondary={card.color}
      >
        <CardSubtitle style={{ fontSize: "16px" }}>Price</CardSubtitle>
        <PriceContainer>
          <CardSubtitle>Price: {price / 10}$</CardSubtitle>
        </PriceContainer>
      </CardLayout>
    </div>
  );
};
const Start_Info = (props) => (
  <Base_Card
    {...props}
    icon={Finish}
    primaryColor={"#d92650"}
    secondaryColor={"#f5786c"}
    actionText={"Get Money"}
    subtitle={"You receive 200$"}
  />
);
const Chance_info = (props) => (
  <Base_Card
    {...props}
    icon={Slot}
    primaryColor={"#d92650"}
    secondaryColor={"#e05273"}
    title={"CHANCE"}
    subtitle={"Take A Card"}
    community={true}
  />
);

const Cummunity_info = (props) => (
  <Base_Card
    {...props}
    icon={Chest}
    primaryColor={"#de951f"}
    secondaryColor={"#f5786c"}
    title={"COMMUNITY"}
    subtitle={"Take A Card"}
    community={true}
  />
);
const Tax_Info = (props) => (
  <Base_Card
    {...props}
    icon={Bank_Check}
    subtitle={"Pay$$$$"}
    primaryColor={"#1f8f5d"}
    secondaryColor={"#29bc7a"}
    actionText={"Pay"}
  />
);

const RailRoad_Info = (props) => (
  <Base_Card
    {...props}
    icon={Locomotive}
    altAction={true}
    primaryColor={"#de951f"}
    secondaryColor={"#865a13"}
    actionText={"Buy"}
    subtitle={"Take The Card"}
  />
);

const Jail_Info = (props) => (
  <Base_Card
    {...props}
    icon={Handcuffs}
    altAction={true}
    primaryColor={"#999999"}
    secondaryColor={"#767676"}
    actionText={"Pay"}
    price={200}
    subtitle={"Oh No Sister! You Stuck!"}
  />
);

const Communal_Info = (props) => (
  <Base_Card
    {...props}
    icon={props.card.info == "Water" ? Ocean : Bolt}
    altAction={true}
    primaryColor={props.card.info == "Water" ? "#0942b3" : "#de951f"}
    secondaryColor={props.card.info == "Water" ? "#1f8fff" : "#e9b563"}
    actionText={"Pay"}
    price={200}
    subtitle={props.card.info + " Company"}
    state={props.card.state}
  />
);

const Park_Info = (props) => (
  <Base_Card
    {...props}
    icon={Garage}
    primaryColor={"#888888"}
    secondaryColor={"#ffffff"}
    actionText={"Stay"}
    subtitle={"Just Free Parking"}
  />
);
const GTJ_Info = (props) => (
  <Base_Card
    {...props}
    icon={Handcuffs}
    altAction={true}
    primaryColor={"#999999"}
    secondaryColor={"#767676"}
    actionText={"Go"}
    price={200}
    subtitle={"Go To Jail"}
  />
);
export {
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
};
