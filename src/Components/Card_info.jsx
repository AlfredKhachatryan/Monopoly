import React from "react";
import styled from "styled-components";
import Button from "./Button";
import { Icon } from "./Icon";

import House from "../Icons/House.json";
import Building from "../Icons/Building.json";

const Card = styled.div`
  width: 330px;
  height: 454px;
  background-image: linear-gradient(163deg, #d92650 0%, #d92650 100%);
  border-radius: 20px 20px 10px 10px;
  transition: all 0.3s;
  box-shadow: 0px 0px 30px 1px rgb(217 38 80 / 30%);
  position: absolute;
  top: calc(50% - 454px / 2 - 63px);
  left: calc(50% - 330px / 2);
  z-index: 2;
`;

const Card2 = styled.div`
  width: 330px;
  height: 454px;
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
const IconBlock = ({ count, icon, price, housePrice }) => (
  <IconContainer>
    <div style={{ display: "flex" }}>
      {[...Array(count)].map(() => (
        <Icon
          size={64 / count}
          icon={icon}
          primary={"#fff"}
          secondary={"#888"}
          loop={false}
          state={"in-reveal"}
        />
      ))}
    </div>

    <CardSubtitle>{price}$</CardSubtitle>
    <Button btnCont={{ "--accent": "#d92650", width: "25%" }}>
      {count * housePrice} $
    </Button>
  </IconContainer>
);
const Card_Info = () => {
  return (
    <>
      <CardOverlay></CardOverlay>
      <Card>
        <Card2>
          <CardBody>
            <CardTitle>Статуя Гая</CardTitle>
            <HotelContainer>
              <IconBlock
                count={1}
                icon={House}
                price={(5 * 60) / 10}
                housePrice={50}
              ></IconBlock>
              <IconBlock
                count={2}
                icon={House}
                price={(15 * 60) / 10}
                housePrice={50}
              ></IconBlock>
              <IconBlock
                count={3}
                icon={House}
                price={(45 * 60) / 10}
                housePrice={50}
              ></IconBlock>
              <IconBlock
                count={4}
                icon={House}
                price={(62.5 * 60) / 10}
                housePrice={50}
              ></IconBlock>
              <IconBlock
                count={1}
                icon={Building}
                price={(75 * 60) / 10}
                housePrice={400}
              ></IconBlock>
            </HotelContainer>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "0 5px",
              }}
            >
              <CardSubtitle>Price: {60 / 10}$</CardSubtitle>
              <CardSubtitle>Colour Set Price: {(2 * 60) / 10}$</CardSubtitle>
            </div>
          </CardBody>
        </Card2>
        <ButtonContainer>
          <Button btnCont={{ "--accent": "#d92650", width: "45%" }}>Buy</Button>
          <Button btnCont={{ "--accent": "#444", width: "45%" }}>Pass</Button>
        </ButtonContainer>
      </Card>
    </>
  );
};

export default Card_Info;
