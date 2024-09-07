import React from "react";
import styled from "styled-components";
import Button from "./Button";
const Card = styled.div`
  width: 230px;
  height: 334px;
  background-image: linear-gradient(163deg, #d92650 0%, #d92650 100%);
  border-radius: 20px 20px 10px 10px;
  transition: all 0.3s;
  box-shadow: 0px 0px 30px 1px rgb(217 38 80 / 30%);
  position: absolute;
  top: calc(50% - 334px / 2 - 63px);
  left: calc(50% - 230px / 2);
  z-index: 2;
`;

const Card2 = styled.div`
  width: 230px;
  height: 334px;
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
  font-size: 12px;
`;
const CardBody = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`;
const Card_Info = () => {
  return (
    <>
      <CardOverlay></CardOverlay>
      <Card>
        <Card2>
          <CardBody>
            <CardTitle>Статуя Гая</CardTitle>
            <CardSubtitle>500$</CardSubtitle>
          </CardBody>
        </Card2>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "10px 0px",
          }}
        >
          <Button btnCont={{ "--accent": "#d92650", width: "45%" }}>Buy</Button>
          <Button btnCont={{ "--accent": "#444", width: "45%" }}>Ignore</Button>
        </div>
      </Card>
    </>
  );
};

export default Card_Info;
