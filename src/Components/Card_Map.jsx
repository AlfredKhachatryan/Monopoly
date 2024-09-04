import { useEffect, useState } from "react";
import styled from "styled-components";

const Card = styled.div`
  width: 100%;
  min-width: 100px;
  height: 100%;
  background: #f5f5f5;
  padding: 20px 10px 5px 10px;
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
  font-size: 16px;
  font-weight: 600;
`;

const CardSubtitle = styled.div`
  color: #333;
  font-size: 12px;
`;

function Card_Map({ className, children, color, header, info, price }) {
  console.log(color);
  return (
    <Card className={className}>
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
export { Card_Map };
