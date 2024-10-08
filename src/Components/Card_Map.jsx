import { useEffect, useState } from "react";
import styled, { keyframes } from "styled-components";
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

const anim = keyframes`
  0% {
    background-position: 0 0;
  }
  100% {
    background-position: -40px -40px;
  }
`;

const Fig1Border = styled.div`
  width: calc(100% + 0.625em * 2);
  height: calc(100% + 0.313em);
  --s: 40px; /* control the size */
  --c1: ${({ c1 }) =>
    c1 || "rgb(217, 38, 80)"}; /* allow passing color for c1 */
  --c2: #f5f5f5;
  --_g: var(--c2) 6% 14%, var(--c1) 16% 24%, var(--c2) 26% 34%,
    var(--c1) 36% 44%, var(--c2) 46% 54%, var(--c1) 56% 64%, var(--c2) 66% 74%,
    var(--c1) 76% 84%, var(--c2) 86% 94%;

  background: radial-gradient(
      100% 100% at 100% 0,
      var(--c1) 4%,
      var(--_g),
      #0008 96%,
      #0000
    ),
    radial-gradient(
        100% 100% at 0 100%,
        #0000,
        #0008 4%,
        var(--_g),
        var(--c1) 96%
      )
      var(--c1);

  background-size: var(--s) var(--s);
  position: absolute;
  z-index: 0;
  left: calc(-0.625em);
  top: calc(0.313em / 2 - 2px);
  animation: ${anim} 10s linear infinite;

  &::after {
    content: "";
    position: absolute;
    width: 100%;
    height: 100%;
    ${"" /* background-color: #110e1ba6; */}
    ${"" /* backdrop-filter: blur(1px); */}
    box-shadow: inset 0px 0 20px 10px #110e1ba6
  }
`;

const Card = styled.div`
  width: 100%;
  min-width: 7em;
  height: 5em;
  background: #f5f5f5;
  padding: 1.25em 0.625em 0.313em 0.625em;
  transition: box-shadow 0.3s ease, transform 0.2s ease;
  position: relative;
  @media (max-width: 1024px) {
    font-size: 12px;
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
const findTrueKey = (obj) => {
  return Object.keys(obj).find((key) => obj[key] === true);
};
const colors = {
  fig0: "#D92650",
  fig1: "#1F8F5D",
  fig2: "#F56CC6",
  fig3: "#6F6CF5",
};
function Card_Map({
  className,
  children,
  color,
  header,
  info,
  price,
  onClick,
  bought,
}) {
  return (
    <Card
      className={className}
      onClick={onClick}
      style={{ backgroundColor: color, boxShadow: `0 0 5px 0px ${color}` }}
    >
      <CardAvatar className="card-avatar" style={{ backgroundColor: color }}>
        <CardSubtitle style={{ color: "#fff", padding: "2px" }}>
          {header}
        </CardSubtitle>
      </CardAvatar>
      <CardInfo className="card-info">
        {/* {findTrueKey(bought) && <Fig1Border c1={colors[findTrueKey(bought)]} />} */}
        <CardTitle style={{ color: "#fff" }}></CardTitle>
        {children}
        <CardSubtitle
          style={{
            color: "#fff",
            zIndex: 1,
          }}
        >
          {price}$
        </CardSubtitle>
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
    <Card className={className} style={{ backgroundColor: "#15131b" }}>
      <CardAvatar style={{ backgroundColor: "#15131b" }}>
        <CardSubtitle style={{ color: "#fff" }}>{subtitle}</CardSubtitle>
      </CardAvatar>
      <CardInfo>
        {children}
        <CardTitle>
          {icon && (
            <Icon
              size={40}
              icon={icon}
              primary={primary}
              secondary={secondary}
              loop={false}
              state={state}
              // delay={iconDelay}
            ></Icon>
          )}
        </CardTitle>
        <CardSubtitle style={{ color: "#fff" }}>{footerText}</CardSubtitle>
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
    primary={"#f5f5f5"}
    secondary={"#b7b7b7"}
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
    primary={"#f5f5f5"}
    secondary={"#b7b7b7"}
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
