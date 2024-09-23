import { useEffect, useState } from "react";
import styled from "styled-components";
import { Icon } from "./Icon";
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
  width: 100%;
  min-width: 100px;
  height: 100%;
  background: #f5f5f5;
  padding: 1.25em 0.625em 0.313em 0.625em;
  transition: box-shadow 0.3s ease, transform 0.2s ease;
  position: relative;
  &:hover {
    box-shadow: 0 8px 50px #23232333;
  }
`;

const CardInfo = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: center;
  transition: transform 0.2s ease, opacity 0.2s ease;
  height: 100%;
`;

const CardAvatar = styled.div`
  width: 100%;
  background-color: #000;
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: center;
`;
const CardTitle = styled.div`
  color: #333;
  font-size: 12px;
  font-weight: 600;
`;

const CardSubtitle = styled.div`
  color: #333;
  font-size: 12px;
`;

function Card_Map({
  className,
  children,
  color,
  header,
  info,
  price,
  onClick,
}) {
  return (
    <Card className={className} onClick={onClick}>
      <CardAvatar className="card-avatar" style={{ backgroundColor: color }}>
        <CardSubtitle style={{ color: "#fff", padding: "2px" }}>
          {header}
        </CardSubtitle>
      </CardAvatar>
      <CardInfo className="card-info">
        <CardTitle>{info}</CardTitle>
        {children}
        <CardSubtitle>{price}$</CardSubtitle>
      </CardInfo>
    </Card>
  );
}
function CustomCard({
  className,
  children,
  bgColor,
  subtitle,
  icon,
  footer,
  iconColor,
  footerText,
  state,
  primary,
  secondary,
}) {
  return (
    <Card className={className}>
      <CardAvatar style={{ backgroundColor: bgColor }}>
        <CardSubtitle color="#000">{subtitle}</CardSubtitle>
      </CardAvatar>
      <CardInfo>
        {children}
        <CardTitle>
          {icon && (
            <Icon
              size={22}
              icon={icon}
              primary={primary}
              secondary={secondary}
              loop={false}
              state={state}
              // delay={iconDelay}
            ></Icon>
          )}
        </CardTitle>
        <CardSubtitle>{footerText}</CardSubtitle>
      </CardInfo>
    </Card>
  );
}
const Start_Card = (props) => (
  <CustomCard
    {...props}
    bgColor="#f5f5f5"
    subtitle="СТАРТ"
    footerText="Get 200$"
    icon={Finish}
    primary={"#d92650"}
    secondary={"#f5786c"}
  />
);

const Community_Card = (props) => (
  <CustomCard
    {...props}
    bgColor="#f5f5f5"
    subtitle="Community"
    footerText="Take The Card"
    icon={Chest}
    primary={"#de951f"}
    secondary={"#f5786c"}
  />
);

const Tax_Card = (props) => (
  <CustomCard
    {...props}
    bgColor="#f5f5f5"
    subtitle="Tax"
    footerText="Pay$$$"
    icon={Bank_Check}
    primary={"#1f8f5d"}
    secondary={"#29bc7a"}
  />
);

const RailRoad_Card = (props) => (
  <CustomCard
    {...props}
    subtitle={props.info}
    bgColor="#f5f5f5"
    footerText="200$"
    icon={Locomotive}
    primary={"#de951f"}
    secondary={"#865a13"}
  />
);
const Chance_Card = (props) => (
  <CustomCard
    {...props}
    bgColor="#f5f5f5"
    subtitle="Chance"
    footerText="Take The Card"
    icon={Slot}
    primary={"#d92650"}
    secondary={"#e05273"}
  />
);
const Jail_Card = (props) => (
  <CustomCard
    {...props}
    bgColor="#f5f5f5"
    subtitle="Jail"
    footerText="In Jail :((("
    icon={Handcuffs}
    primary={"#000"}
    secondary={"#767676"}
  />
);
const Communal_Card = (props) => (
  <CustomCard
    {...props}
    bgColor="#f5f5f5"
    subtitle={props.info + " Company"}
    footerText="150$"
    icon={props.info == "Water" ? Ocean : Bolt}
  ></CustomCard>
);
const Park_Card = (props) => (
  <CustomCard
    {...props}
    bgColor="#f5f5f5"
    subtitle={props.info}
    footerText="0$"
    icon={Garage}
    primary={"#767676"}
    secondary={"#b0b0b0"}
  />
);
const GTJ_Card = (props) => (
  <CustomCard
    {...props}
    bgColor="#f5f5f5"
    subtitle={props.info}
    footerText="Unlucky"
    icon={Handcuffs}
    primary={"#000"}
    secondary={"#767676"}
  />
);
export {
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
};
